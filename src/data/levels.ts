/**
 * Level / progression facade.
 *
 * Per the multi-dataset plan, the actual level rules (max level, power-pick
 * cadence, slot-grant table, inherent power definitions) live in the active
 * dataset (e.g. `src/data/datasets/homecoming/levels.ts`).
 *
 * NOTE: this file uses direct `export * from` rather than the runtime
 * `getActiveDataset()` indirection seen in `archetypes.ts` / `at-tables.ts`.
 * That's intentional: most exports here are primitive constants
 * (`MAX_LEVEL`, `EPIC_POOL_LEVEL`, …) which JS doesn't allow live-binding
 * across module boundaries. The constants carry the shared (Homecoming/
 * Rebirth) schedule; anywhere a value genuinely differs per server
 * (Thunderspy's slot grants, pool cap, pool-unlock level) a `serverId`-keyed
 * getter (`getSlotGrants`, `getMaxPowerPools`, `getPoolUnlockLevel`) reads
 * the build's own generated leveling schedule — pass `build.serverId` there.
 */

export * from './datasets/homecoming/levels';

import {
  getInherentPowers as _getInherentPowersBase,
  getInherentPowerDef as _getInherentPowerDefBase,
  getArchetypeInherentPowers as _getArchetypeInherentPowersBase,
  type InherentPowerDef,
} from './datasets/homecoming/levels';
import { getActiveDataset } from './dataset';

/**
 * The active server's id, or `undefined` when no dataset is loaded yet (the
 * Homecoming lists apply until one is). Tolerant of the not-loaded case so
 * static lookups — and tests — work without booting a dataset.
 */
function activeServerId(): string | undefined {
  try {
    return getActiveDataset().id;
  } catch {
    return undefined;
  }
}

/**
 * Inherent membership is per-server, read from each fork's own export, so these
 * facade overrides just thread the active server through. They used to filter a
 * shared Homecoming list against a hand-written `inherentRules.excludeInherents`
 * — one entry long, naming Rebirth's missing Athletic Run — which is exactly the
 * shape that let Thunderspy go on being offered Ninja Run, Beast Run and five
 * prestige sprints it has never had (data-gaps-32). Absence is now data.
 *
 * The explicit named exports shadow the ones from `export *`.
 */
export function getInherentPowers(): InherentPowerDef[] {
  return _getInherentPowersBase(activeServerId());
}

/**
 * The active server's extra archetype inherents, or empty when no dataset is
 * loaded. Same tolerance as `activeExcludedInherents` — static lookups and
 * tests work without booting a dataset.
 */
function activeArchetypeInherents(): Record<string, readonly InherentPowerDef[]> {
  try {
    return getActiveDataset().inherentRules.archetypeInherents ?? {};
  } catch {
    return {};
  }
}

/**
 * Archetype inherents for the active server: the shared hand-written list
 * (Kheldian travel powers) plus anything this server grants that the shared
 * list doesn't carry.
 *
 * The shared list wins on an `internalName` clash. Thunderspy's export names
 * Energy Flight and Shadow Step alongside the two the shared list already has,
 * so without the dedup a Peacebringer would carry Energy Flight twice.
 *
 * The server additions come from `inherentRules.archetypeInherents`, generated
 * from that server's own `Inherent.Inherent` set — see
 * `scripts/convert-archetype-inherents.cjs`. On Thunderspy this is what
 * restores the Stalker's Hide and Placate, which that fork moved out of the
 * powersets (and whose vacated powerset name slots it then reused for other
 * powers, so the internal names alone are not evidence of reachability).
 */
export function getArchetypeInherentPowers(archetypeId?: string): InherentPowerDef[] {
  if (!archetypeId) return [];
  const shared = _getArchetypeInherentPowersBase(archetypeId);
  const extra = activeArchetypeInherents()[archetypeId];
  if (!extra?.length) return shared;
  const have = new Set(shared.map((p) => p.internalName));
  return [...shared, ...extra.filter((p) => !have.has(p.internalName))];
}

/**
 * The archetype inherents the power picker must hide from powerset rows: the
 * shared hand-written list only, whose members (the Kheldian travel powers)
 * also sit in the epic powersets as picks. The picker matches these by
 * internalName because Rebirth renames some in both places at once
 * (Shadow_Recall displays as "Starless Recall"), so display names can't pair
 * them.
 *
 * The generated server additions are deliberately not here. Their converter
 * (`convert-archetype-inherents.cjs`, rule 4) only emits a power when no
 * powerset in that dataset displays its name, so an addition never shadows a
 * pick. Its internal name still can collide with an unrelated power in a
 * reused name slot: Thunderspy refills the Stalker's vacated Hide/Placate
 * slots in all 28 Stalker sets (Spectral Melee's Possess IS
 * `Stalker_Melee.Spectral_Melee.Placate`), and filtering the picker on the
 * merged list hid every one of those powers (user report, 2026-08-15).
 */
export function getPickShadowingInherentPowers(archetypeId?: string): InherentPowerDef[] {
  return _getArchetypeInherentPowersBase(archetypeId);
}

/**
 * Name lookup against the active server's membership. Delegates
 * to the base resolver (which also covers archetype-specific inherents like
 * Kheldian travel powers), then falls back to the active server's own additions
 * so a saved build re-hydrates a power like Thunderspy's Hide by name.
 */
export function getInherentPowerDef(name: string): InherentPowerDef | undefined {
  const shared = _getInherentPowerDefBase(name, activeServerId());
  if (shared) return shared;
  for (const powers of Object.values(activeArchetypeInherents())) {
    const match = powers.find((p) => p.internalName === name);
    if (match) return match;
  }
  return undefined;
}
