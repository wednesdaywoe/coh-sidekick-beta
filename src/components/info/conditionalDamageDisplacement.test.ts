/**
 * backlog-2 — the mutex half of a `mode: 'replace'` conditional.
 *
 * A power can carry two damage groups gated on a predicate and on its negation, which makes
 * them the same template read under opposite conditions. Turning the toggle on has to swap
 * them, not stack them. It stacked them for as long as `applyActiveConditionals` had a damage
 * branch, because that branch read `c.damage` and never `c.mode`: Temporal Mending showed
 * 1.75 + 2.625 with Temporal Selection on, Crushing Uppercut 3.18 + 3.339 at Combo Level 1.
 *
 * `powerProjectionParity` caught two of the 167 powers involved, and only because healing is
 * the one damage row that also surfaces as a granted magnitude. Nothing else diffs the damage
 * array against the engine, so that gate's silence was about its own reach. This one sweeps
 * the array directly.
 *
 * Two halves, because the fix has two:
 *
 *   1. The converter joins each base damage row to the toggles it's mutex with. Graded
 *      against `power.atoms`, which reaches the file through `templatesToAtoms` rather than
 *      `extractDamage` and carries each row's gate verbatim — so the two agreeing is a real
 *      statement about the join and not one field read twice.
 *   2. The merger drops exactly the displaced rows. Graded on the merged array.
 *
 * The counters at the end are what make it non-vacuous. A corpus where every replace-mode
 * toggle displaces something cannot tell this fix from swapping the whole array, and Psi
 * Blade is the case that separates them: it's tagged `replace` off a negated gate on its
 * GrantPower atom while its own damage is a genuinely extra DoT.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getPowersetsForArchetype } from '@/data/powersets';
import { STANDARD_ARCHETYPE_IDS } from '@/data/archetypes';
import { atomsOf } from '@/data/core/atom-query';
import { applyActiveConditionals } from './powerDisplayUtils';
import type { ConditionalEffect, Power, ScaledDamageEntry } from '@/types/power';

const SERVERS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;

/** Damage rows as an array, whatever shape the power stores them in. */
function damageRows(damage: Power['damage']): ScaledDamageEntry[] {
  if (!damage) return [];
  return Array.isArray(damage) ? damage : [damage];
}

/**
 * The toggle ids an atom's gate switches OFF, read off the RPN the way the converter's
 * `_negatedOwnPowerPredicates` does: walk back from each `!` to the nearest `<side>.ownPower?`
 * and take the dotted power name in front of it. The id is that name's leaf, lowercased,
 * which is the shape `collectConditionalsGrouped` keys its groups by.
 *
 * Deriving it here rather than reading a field the converter also wrote is the point. If the
 * two derivations part company the gate says so instead of agreeing with itself.
 */
function negatedToggleIds(requires: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!requires?.length) return out;
  for (let i = requires.length - 1; i > 0; i--) {
    if (requires[i] !== '!') continue;
    for (let j = i - 1; j >= 0; j--) {
      const m = requires[j].match(/^(target|source)\.ownPower\?$/);
      if (m && j > 0) {
        const leaf = requires[j - 1].split('.').pop();
        if (leaf) out.add(leaf.toLowerCase());
        break;
      }
    }
  }
  return out;
}

/** Every power in the fork's archetype powersets, deduped by identity. */
function corpus(): Power[] {
  const seen = new Set<Power>();
  for (const atId of STANDARD_ARCHETYPE_IDS) {
    for (const ps of getPowersetsForArchetype(atId)) {
      for (const power of ps.powers) seen.add(power);
    }
  }
  return [...seen];
}

describe.each(SERVERS)('backlog-2 replace-mode damage displacement — %s', (server) => {
  let powers: Power[];

  beforeAll(async () => {
    await loadDataset(server);
    powers = corpus();
  }, 120000);

  it('the converter joins each displaced row to the toggle its own gate negates', () => {
    const missing: string[] = [];
    const invented: string[] = [];
    let joined = 0;

    for (const power of powers) {
      const replaceIds = new Set(
        (power.conditionalEffects ?? []).filter((c) => c.mode === 'replace').map((c) => c.id),
      );
      const conditionalIds = new Set((power.conditionalEffects ?? []).map((c) => c.id));
      const rows = damageRows(power.damage);
      if (rows.length === 0) continue;

      // What the atoms say this power's damage is gated OUT by, restricted to gates that
      // actually have a toggle — a negated predicate with no conditional sibling is a base
      // case with nothing to swap to, and displacing it would delete the row outright.
      const fromAtoms = new Set<string>();
      for (const atom of atomsOf(power)) {
        if (atom.effectType !== 'Damage' && atom.effectType !== 'Heal') continue;
        for (const id of negatedToggleIds(atom.requiresExpression)) {
          if (replaceIds.has(id)) fromAtoms.add(id);
        }
      }

      const fromRows = new Set(rows.flatMap((row) => row.displacedBy ?? []));
      for (const id of fromAtoms) {
        if (!fromRows.has(id)) missing.push(`${power.internalName}: atoms gate damage out under '${id}', no row names it`);
      }
      for (const id of fromRows) {
        if (!conditionalIds.has(id)) invented.push(`${power.internalName}: row names '${id}', which is not a conditional on this power`);
        else if (!fromAtoms.has(id)) invented.push(`${power.internalName}: row names '${id}', but no damage atom's gate negates it`);
      }
      if (fromRows.size > 0) joined += 1;
    }

    expect(missing).toEqual([]);
    expect(invented).toEqual([]);
    // A fork whose corpus joined nothing would pass both lists above by having no data, and
    // that is exactly the state the converter change is meant to leave behind.
    expect(joined, `${server}: no power joined a damage row to a toggle`).toBeGreaterThan(0);
  });

  it('an active toggle takes the place of the rows it displaces, and only those', () => {
    const deltas: string[] = [];
    let displacing = 0;
    let additiveReplace = 0;

    for (const power of powers) {
      for (const c of power.conditionalEffects ?? []) {
        if (c.mode !== 'replace' || !c.damage) continue;
        const base = damageRows(power.damage);
        const expectedKept = base.filter((row) => !row.displacedBy?.includes(c.id));
        const merged = damageRows(applyActiveConditionals(power, [c as ConditionalEffect]).power.damage);

        const dropped = base.length - expectedKept.length;
        if (dropped > 0) displacing += 1;
        else additiveReplace += 1;

        for (const row of expectedKept) {
          if (!merged.includes(row)) deltas.push(`${power.internalName}+${c.id}: dropped an undisplaced ${row.type} ${row.scale}`);
        }
        for (const row of base) {
          if (!expectedKept.includes(row) && merged.includes(row)) {
            deltas.push(`${power.internalName}+${c.id}: kept the ${row.type} ${row.scale} row the toggle replaces`);
          }
        }
        for (const row of damageRows(c.damage)) {
          if (!merged.includes(row)) deltas.push(`${power.internalName}+${c.id}: the toggle's own ${row.type} ${row.scale} row is missing`);
        }
      }
    }

    expect(deltas).toEqual([]);
    expect(displacing, `${server}: no replace toggle displaces a row — the swap is ungraded here`).toBeGreaterThan(0);
    // The other arm. Without it a merger that swapped the whole array would pass everything
    // above, because nothing would be left to notice it deleted rows it shouldn't have.
    expect(
      additiveReplace,
      `${server}: every replace toggle displaces something — this corpus cannot tell a targeted swap from a wholesale one`,
    ).toBeGreaterThan(0);
  });
});
