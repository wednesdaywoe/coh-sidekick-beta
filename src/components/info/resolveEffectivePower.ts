/**
 * The **effective power** — which power a display surface is actually showing (PROD6C-3k).
 *
 * `buildDisplayEffects` and the bag transforms beside it are pure functions of one power
 * object. This resolves WHICH power that object is, from the build's combat state:
 *
 * 1. **mode redirect** — while a caster mode is live, the game's PowerRedirector fires a
 *    different record entirely (a Kheldian attack in Nova form, a Titan Weapons attack under
 *    Momentum). The converter carries the whole table as `power.modeVariants`.
 * 2. **form variant** — an ordered table of alternate records gated by a condition string read
 *    verbatim off the binary (`power.formVariants`, first match wins) rather than a mode key —
 *    Energy Manipulation's Stun becoming a slower AoE under Power Boost. `conditionExpr.ts`
 *    evaluates the condition; canonical closed the matching engine side 2026-08-07
 *    (`coh_math::effective::with_form_variant`) — see docs/gaps/engine-beta-parity.md issues-1.
 * 3. **quick snipe** — in combat, a snipe shows its fast cast/range and the quick form's damage.
 *    Which state actually GATES the fast form is fork-specific and lives in
 *    `power.quickSnipe.condition` (data-gaps-146) — see docs/gaps/engine-beta-parity.md issues-2.
 * 4. **mid-combat cast** — an opener with a separate `midCombatCast` uses it when NOT hidden;
 *    the slow interruptible animation is the from-Hide one.
 * 5. **active conditionals** — the mode-gated contributions whose toggle is on merge onto
 *    `effects` and `damage`, with the additive collisions returned as `extraInstances`.
 *
 * Extracted from `InfoPanel`'s memos so the panel, the picker tooltip, and the engine gate all
 * resolve the same power.
 *
 * The engine mirrors every rule here in `coh_math/src/effective.rs`; the projection's values
 * describe this power, keyed to the base power's identity.
 */

import { applyQuickSnipe } from '@/utils/quick-snipe';
import { selectActiveConditionals, type ATInherentState } from '@/utils/conditional-effects';
import { applyActiveConditionals, type ApplyConditionalsResult } from './powerDisplayUtils';
import { stanceAdjusterOverrides, getArchetype } from '@/data';
import { evaluateCondition, evaluateConditionTri, type ConditionContext } from '@/utils/conditionExpr';
import type { Power } from '@/types/power';
import type { Build } from '@/types/build';
import type { ArchetypeId } from '@/types/archetype';

/** The caster's current (buffed, UNCLAMPED) ToHit fraction the forks' fast-snipe gate reads
 *  (`cur.kToHit source> .97 >=`, data-gaps-146) — archetype `toHitBase` + the build's global ToHit
 *  bonus/100, exactly `crates/coh_math/src/projection.rs`'s `gate_context`
 *  (`caps.to_hit_base + g.to_hit / 100.0`). Single-sourced so every `resolveEffectivePower`
 *  caller feeds `EffectivePowerState.currentToHit` the same number. 0.75 is the documented
 *  `AttribBase` ToHit shared by every archetype on every fork, so it's a safe default for the
 *  rare caller resolving a power before an archetype is picked — not a guess. */
export function currentToHitFraction(archetypeId: string | null | undefined, globalBonuses: { toHit: number }): number {
  const toHitBase = (archetypeId ? getArchetype(archetypeId as ArchetypeId) : undefined)?.stats.toHitBase ?? 0.75;
  return toHitBase + globalBonuses.toHit / 100;
}

/** The build/UI state the resolution reads. */
export interface EffectivePowerState {
  /** Sustained-combat mode — the quick-snipe gate. */
  combatMode: boolean;
  /** The caster is hidden (Stalker from-Hide opener state) — suppresses the mid-combat cast. */
  hidden: boolean;
  /** `scope: 'global'` toggles by conditional id, already carrying the build's stance overrides
   *  (see `effectiveGlobalAdjusters`). */
  globalAdjusters: Record<string, boolean>;
  /** `scope: 'per-power'` toggles, keyed `<internalName>:<id>`. */
  mechanicAdjusters: Record<string, boolean>;
  /** AT-inherent mechanics the Header owns rather than the toggle maps. */
  atInherentState?: ATInherentState;
  /** Caster modes the player has switched on (Kheldian/Primalist forms, Momentum, Seismic
   *  Power) — the `power.modeVariants` keys. Absent means no mode is live. */
  activeModes?: readonly string[];
  /** The build the power belongs to — walked for `source.ownPower?` / `source.ownPowerNum?`
   *  (`formVariants`/`quickSnipe` condition reads) so every caller doesn't re-derive the same
   *  walk. Every real caller already builds `activeModes` from this same `build`. */
  build: Build;
  /** The caster's current (buffed, UNCLAMPED) ToHit fraction — archetype `toHitBase` + the
   *  build's global ToHit bonus/100. Read by `cur.kToHit source>`, the forks' fast-snipe gate
   *  (data-gaps-146). Mirrors `crates/coh_math/src/projection.rs`'s `gate_context` exactly
   *  (`caps.to_hit_base + g.to_hit / 100.0`) — required rather than defaulted so a caller that
   *  forgets it fails to compile instead of silently never firing the fork gate. */
  currentToHit: number;
}

/** Every power-path key (`Pool.Teleportation.Team_Teleport`-style, plus the bare internal
 *  name as a fallback) a build's OWN picks can answer `source.ownPower?` for. A temp/granted/
 *  redirect-only power (`Temporary_Powers.*`, `Redirects.*`) is never in these lists, so it
 *  reads correctly as unowned with no separate categorization needed. */
function buildOwnedPowerIndex(build: Build): Map<string, number> {
  const index = new Map<string, number>();
  const add = (powers?: { internalName: string; fullName?: string }[]) => {
    for (const p of powers ?? []) {
      const keys = new Set(
        [p.internalName, p.fullName, p.fullName?.split('.').pop()]
          .filter((k): k is string => !!k)
          .map((k) => k.toLowerCase()),
      );
      for (const key of keys) index.set(key, (index.get(key) ?? 0) + 1);
    }
  };
  add(build.primary?.powers);
  add(build.secondary?.powers);
  build.pools?.forEach((pool) => add(pool.powers));
  add(build.epicPool?.powers);
  add(build.inherents);
  return index;
}

/** The `ConditionContext` `formVariants`/`quickSnipe` conditions evaluate against, built once
 *  per resolution from the state every caller already assembles. */
function toConditionContext(state: EffectivePowerState): ConditionContext {
  // `Source.Mode?` gate tokens are `k`-prefixed (`kBoostPower`) while `setsModes` — and so
  // `activeModes`, which mirrors it — publishes the bare mode (`BoostPower`), so both spellings
  // go in. Exactly `crates/coh_math/src/gather.rs`'s `collect_source_modes`.
  const liveModes = new Set<string>();
  for (const m of state.activeModes ?? []) {
    const lower = m.toLowerCase();
    liveModes.add(lower);
    liveModes.add(`k${lower}`);
  }
  // The engine binds `kEngaged`/`kOutOfCombat` from the combat-mode flag rather than reading
  // them from `activeModes` (`gather::live_modes`, `ENGAGED_MODES`/`OUT_OF_COMBAT_MODES`) —
  // mirrored here so `kEngaged Source.Mode?` (Homecoming's quick-snipe gate) resolves the
  // same way.
  liveModes.add(state.combatMode ? 'kengaged' : 'koutofcombat');
  liveModes.add(state.combatMode ? 'engaged' : 'outofcombat');
  const owned = buildOwnedPowerIndex(state.build);
  const ownsPower = (path: string) => {
    const tail = path.split('.').pop() ?? path;
    return owned.has(path.toLowerCase()) || owned.has(tail.toLowerCase());
  };
  const ownedPowerCount = (path: string) => {
    const tail = path.split('.').pop() ?? path;
    return owned.get(path.toLowerCase()) ?? owned.get(tail.toLowerCase()) ?? 0;
  };
  return { liveModes, ownsPower, ownedPowerCount, currentToHit: state.currentToHit };
}

/**
 * The variant `power.formVariants` redirects to — the first whose condition evaluates true,
 * or the power itself. The base keeps its identity (`internalName`) and the redirect's own
 * `condition`/`internalName` are excluded from the merge for the same reason
 * `applyModeRedirect` keeps the base identity: slots, enhancements and the picker entry live
 * on the base power, and every variant shares them.
 *
 * The walk is three-valued, matching `effective::with_form_variant` branch for branch: true
 * selects and stops, false moves to the next variant, and a condition the build can't answer
 * ABANDONS the walk with the base standing. That last branch is the whole point (U8). The
 * variants are ordered and the later ones are fallbacks, so treating "can't tell" as "no" walks
 * straight past the unanswerable gate into a fallback the game would never have reached —
 * which is how Assassin's Strike picked its Quick form off an unbound `kMeter`.
 */
export function applyFormVariant(power: Power, ctx: ConditionContext): Power {
  const variants = power.formVariants;
  if (!variants?.length) return power;
  let match: (typeof variants)[number] | undefined;
  for (const variant of variants) {
    // A variant with no condition at all is skipped, not treated as unknown: the engine's
    // `json_tokens` returns None there and the loop simply continues.
    if (!variant.condition) continue;
    const verdict = evaluateConditionTri(variant.condition, ctx);
    if (verdict === undefined) return power;
    if (verdict) {
      match = variant;
      break;
    }
  }
  if (!match) return power;
  const { condition: _condition, internalName: _internalName, ...overrides } = match;
  return { ...power, ...overrides };
}

/**
 * The variant the game redirects to while one of `activeModes` is live, or the power itself.
 *
 * The base keeps its identity — slots, enhancements and picker entry live there and every mode
 * shares them — so only what the power DOES is replaced. When more than one live mode has a
 * variant, the power's own table order decides, which is the order the binary lists the
 * redirects in.
 */
export function applyModeRedirect(power: Power, activeModes: readonly string[] | undefined): Power {
  if (!power.modeVariants || !activeModes?.length) return power;
  const mode = Object.keys(power.modeVariants).find((m) => activeModes.includes(m));
  if (mode === undefined) return power;
  return { ...power, ...power.modeVariants[mode] };
}

/**
 * The global toggle map with the build's stance state overlaid — the selected Bio Armor
 * adaptation / Staff form is build-scoped (`activeSubPower`), so it wins over a stale UI toggle,
 * exactly as the dashboard calc overlays it. Every surface that resolves an effective power reads
 * the map through here so the three cannot drift.
 */
export function effectiveGlobalAdjusters(
  build: Build,
  globalAdjusters: Record<string, boolean>,
): Record<string, boolean> {
  const stancePowers: { internalName: string; activeSubPower?: string }[] = [];
  const addStance = (powers?: { internalName: string; activeSubPower?: string }[]) =>
    powers?.forEach((p) => stancePowers.push({ internalName: p.internalName, activeSubPower: p.activeSubPower }));
  addStance(build.primary?.powers);
  addStance(build.secondary?.powers);
  build.pools?.forEach((pool) => addStance(pool.powers));
  addStance(build.epicPool?.powers);
  return { ...globalAdjusters, ...stanceAdjusterOverrides(stancePowers) };
}

/**
 * Whether the caster is actually hidden. The alpha-strike scenario needs the Hide power in the
 * build — without it `stalkerHidden` would model an impossible state — so the toggle alone is not
 * the answer. Single-sourced here because three surfaces and the engine adapter all need it.
 */
export function isCasterHidden(build: Build, stalkerHidden: boolean): boolean {
  return stalkerHidden && build.secondary.powers.some((p) => p.internalName === 'Hide');
}

/** Whether `power`'s fast-snipe form is actually live under `state` — the same fork-aware gate
 *  `resolveEffectivePower` evaluates internally, exposed separately for surfaces that only need
 *  the yes/no (InfoPanel's "(Quick)" badge) without re-deriving the whole effective power. */
export function isQuickSnipeActive(power: Power, state: EffectivePowerState): boolean {
  return power.quickSnipe != null && evaluateCondition(power.quickSnipe.condition, toConditionContext(state));
}

export function resolveEffectivePower(power: Power, state: EffectivePowerState): ApplyConditionalsResult {
  const conditionCtx = toConditionContext(state);
  const redirected = applyFormVariant(applyModeRedirect(power, state.activeModes), conditionCtx);
  // Which state actually gates the fast form is fork-specific (data-gaps-146): Homecoming reads
  // `kEngaged Source.Mode?`, which `toConditionContext` binds from `state.combatMode` the same
  // way the engine does; Rebirth/Thunderspy read `cur.kToHit source> .97 >=` instead, which
  // `state.combatMode` alone can never satisfy. Evaluating the condition (rather than trusting
  // the toggle) is what makes this fork-correct.
  const quickSnipeGate = redirected.quickSnipe ? evaluateCondition(redirected.quickSnipe.condition, conditionCtx) : false;
  const sniped = applyQuickSnipe(redirected, quickSnipeGate);
  // Assassin's Strike fires its slow interruptible animation from Hide (the displayed base cast)
  // but a much faster Quick animation mid-combat. Mirror the from-Hide toggle that already drives
  // its damage so the cast time matches the state: not hidden → the fast uninterruptible cast.
  const cast =
    sniped.midCombatCast == null || state.hidden
      ? sniped
      : { ...sniped, stats: { ...sniped.stats, castTime: sniped.midCombatCast, interruptTime: undefined, timeToRoot: undefined } };
  const active = selectActiveConditionals(
    cast,
    state.mechanicAdjusters,
    state.globalAdjusters,
    state.atInherentState ?? {},
    state.activeModes ?? [],
  );
  if (active.length === 0) return { power: cast, extraInstances: {} };
  return applyActiveConditionals(cast, active);
}
