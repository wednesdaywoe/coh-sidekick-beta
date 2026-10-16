/**
 * Plan B Slice 7 — regression guard for the atom-native movement applier.
 *
 * `legacy-totals.oracle.ts` now sources the movement buff map from
 * `movementBuffValue(power)` (atoms) instead of `effects.movement`. This asserts the
 * LIVE atom path returns what the calc needs, on the real generated data, for the
 * shapes the migration had to get right. Corpus-wide equality vs the bag is proven
 * separately by `scripts/planb-shadow-movement.cjs` (281/281, mutation-tested on 12
 * axes); this pins the headline cases in CI.
 *
 * The cases, and why each is here:
 *   - Super Speed  — the travel archetype: a suppressible, TravelBuff-keyed run buff
 *     that must NOT absorb the power's separate travel-CAP raise (aspect Max, 1.938 ×
 *     Melee_Ones). Reporting 1.938×Melee_Ones instead of 1.0×Melee_SpeedRunning was
 *     the original bag-vs-array collapse this whole plan is named for.
 *   - Fly / Hover  — the kFly split. Both carry a `fly` mode grant (scale 2) alongside
 *     a real FlyingSpeed buff; reading the grant as a speed buff double-counts Fly by
 *     +200%. Hover is the sharp case: kFly 2.0 and FlyingSpeed 0 share the `Melee_Ones`
 *     table, so ONLY the subType split (`FlyMode` vs `Fly`) separates them.
 *   - Combat Jumping — keyed but NOT suppressible: it keeps working in combat, which is
 *     its whole point. Proves `suppressible` is read per atom, not per travel power.
 *   - Swift — an unkeyed, unsuppressed, always-on buff (the null-stackKey path that
 *     stacks additively rather than suppress-grouping).
 */
import { describe, it, expect } from 'vitest';
import { movementBuffValue } from '@/data/core/atom-query';
import { POWER_POOLS_RAW } from '@/data/datasets/homecoming/generated/power-pools';
import { POWER_POOLS_RAW as TSPY_POOLS_RAW } from '@/data/datasets/thunderspy/generated/power-pools';

type Pools = Record<string, { powers?: Array<Record<string, unknown>> }>;
const pools = POWER_POOLS_RAW as unknown as Pools;
const tspyPools = TSPY_POOLS_RAW as unknown as Pools;

function pool(poolId: string, name: string) {
  const p = pools[poolId]?.powers?.find((x) => x.name === name);
  if (!p) throw new Error(`fixture missing: ${poolId}/${name}`);
  return p as Parameters<typeof movementBuffValue>[0];
}

function tspyPool(poolId: string, name: string) {
  const p = tspyPools[poolId]?.powers?.find((x) => x.name === name);
  if (!p) throw new Error(`tspy fixture missing: ${poolId}/${name}`);
  return p as Parameters<typeof movementBuffValue>[0];
}


/**
 * The entry on one axis. `movementBuffValue` returns a LIST — an axis can hold
 * more than one entry now that the key carries `ignoreStrength` and
 * `suppressible` — but every power here buffs each of its axes exactly once, so
 * a single lookup still says everything these assertions mean to say. `only`
 * makes that a claim rather than an assumption: it fails loudly if an axis ever
 * grows a second entry, instead of quietly asserting against the first.
 */
function only(mv: ReturnType<typeof movementBuffValue>, axis: string) {
  const hits = (mv ?? []).filter((e) => e.axis === axis);
  if (hits.length > 1) throw new Error(`${axis} has ${hits.length} entries, expected at most one`);
  return hits[0];
}

describe('atom-native movement — Super Speed (keyed + suppressible, cap raise peeled off)', () => {
  const mv = movementBuffValue(pool('speed', 'Super Speed'))!;

  it('reports the real run buff (1.0 × Melee_SpeedRunning), not the travel-cap raise', () => {
    expect(only(mv, 'runSpeed')!).toBeDefined();
    expect(only(mv, 'runSpeed')!.scale).toBeCloseTo(1);
    // The 1.938 × Melee_Ones cap bump is aspect=Max and belongs to movementCapBump.
    // If it leaked in here, the run speed would resolve off the wrong table entirely.
    expect(only(mv, 'runSpeed')!.table).toBe('Melee_SpeedRunning');
  });

  it('carries the TravelBuff suppress group and the combat-suppression flag', () => {
    expect(only(mv, 'runSpeed')!.stackKey).toBe('TravelBuff');
    expect(only(mv, 'runSpeed')!.suppressible).toBe(true);
  });

  it('keeps its jump ride-along on its own axes and tables', () => {
    expect(only(mv, 'jumpHeight')!.scale).toBeCloseTo(0.1);
    expect(only(mv, 'jumpHeight')!.table).toBe('Melee_Leap');
    expect(only(mv, 'jumpSpeed')!.scale).toBeCloseTo(0.075);
    expect(only(mv, 'jumpSpeed')!.table).toBe('Melee_SpeedJumping');
  });
});

describe('atom-native movement — the kFly mode grant is not a speed buff', () => {
  it('Fly reports its FlyingSpeed buff (1.1788), never the kFly grant (2.0)', () => {
    const mv = movementBuffValue(pool('flight', 'Fly'))!;
    expect(only(mv, 'flySpeed')!.scale).toBeCloseTo(1.1788);
    expect(only(mv, 'flySpeed')!.table).toBe('Melee_SpeedFlying');
    expect(only(mv, 'flySpeed')!.suppressible).toBe(true);
  });

  it('Hover yields NO flySpeed entry — its only fly-speed atom is scale 0', () => {
    // The sharp case: Hover's kFly grant (2.0) and its FlyingSpeed (0) BOTH sit on
    // Melee_Ones, so scale and table cannot tell them apart — only the FlyMode/Fly
    // subType split can. A regression here shows up as Hover granting +200% fly speed.
    const mv = movementBuffValue(pool('flight', 'Hover'))!;
    expect(only(mv, 'flySpeed')?.scale ?? 0).toBe(0);
    expect(only(mv, 'flySpeed')?.scale).not.toBe(2);
  });
});

describe('atom-native movement — suppressible is per atom, not per travel power', () => {
  it('Combat Jumping is TravelBuff-keyed but NOT combat-suppressed', () => {
    const mv = movementBuffValue(pool('leaping', 'Combat Jumping'))!;
    expect(only(mv, 'jumpHeight')!.stackKey).toBe('TravelBuff');
    expect(only(mv, 'jumpHeight')!.suppressible).toBeUndefined();
  });

  it('Super Jump, the same pool, IS suppressed', () => {
    const mv = movementBuffValue(pool('leaping', 'Super Jump'))!;
    expect(only(mv, 'jumpHeight')!.stackKey).toBe('TravelBuff');
    expect(only(mv, 'jumpHeight')!.suppressible).toBe(true);
  });
});

describe('atom-native movement — Swift (unkeyed, always-on)', () => {
  it('has no suppress group and no combat suppression, so it stacks additively', () => {
    const mv = movementBuffValue(pool('fitness', 'Swift'))!;
    expect(only(mv, 'runSpeed')!.scale).toBeCloseTo(0.1);
    expect(only(mv, 'runSpeed')!.table).toBe('Melee_SpeedRunning');
    expect(only(mv, 'runSpeed')!.stackKey).toBeUndefined();
    expect(only(mv, 'runSpeed')!.suppressible).toBeUndefined();
    expect(only(mv, 'flySpeed')!.table).toBe('Melee_SpeedFlying');
  });
});

describe('atom-native movement — Thunderspy travel powers (the blackout fix)', () => {
  // Regression guard for the Thunderspy movement blackout: every tspy travel power gave
  // +0 movement because tspy names the attrib `SpeedRunning`/`SpeedJumping`/`SpeedFlying`
  // (unmapped) AND drops the per-template target (so the self routing never fired). The
  // fix maps the spelling and resolves the empty target from `targets_affected: ['Self']`.
  // These fixtures come from the tspy tree specifically — the HC tree never exercised the
  // bug. NB the fix is applied by the POOL converter too (these are pool powers), which is
  // a separate pipeline from the powerset one.
  it('Super Speed resolves its run buff (was +0)', () => {
    const mv = movementBuffValue(tspyPool('speed', 'Super Speed'))!;
    expect(mv).toBeDefined();
    expect(only(mv, 'runSpeed')!.scale).toBeCloseTo(1.25);
    expect(only(mv, 'runSpeed')!.table).toBe('Melee_SpeedRunning');
  });
  // Fly's slot used to be CONTESTED, and is not any more. tspy pairs each of its two
  // `Melee_SpeedFlying` buffs with a `Melee_Ones` companion, and — unlike HC, which
  // types that companion aspect=Maximum so it routes to the cap-bump slot — tspy
  // types it Current, so it belongs in `flySpeed` too. The 0.8 companion was
  // invisible until the parser read every AttribMod in an element (data-gaps-74); the
  // aspect is not a misread (tspy's movement aspect distribution matches HC and
  // Rebirth corpus-wide).
  //
  // This test used to assert only "a table-backed, non-zero fly speed", deliberately
  // declining to say which of the rows won last-write-wins — the honest claim while
  // the axis held one slot. data-gaps-198 split it, so all three rows survive and the
  // claim can be the whole recovery rather than the fact that some of it happened.
  // See DATA-GAP-REGISTER data-gaps-74 and data-gaps-198.
  it('Fly resolves every one of its fly-speed buffs (was +0, then was one of three)', () => {
    const fly = tspyPool('flight', 'Fly');
    const mv = movementBuffValue(fly)!;
    const hits = mv.filter((e) => e.axis === 'flySpeed');
    expect(
      hits.map((e) => [e.scale, e.table, Boolean(e.ignoreStrength), Boolean(e.suppressible)]),
    ).toEqual([
      [1, 'Melee_Ones', true, false],
      [1.25, 'Melee_SpeedFlying', false, true],
      [0.8, 'Melee_Ones', true, true],
    ]);
  });
  it('Super Jump resolves its jump-speed buff (was +0)', () => {
    const mv = movementBuffValue(tspyPool('leaping', 'Super Jump'))!;
    expect(only(mv, 'jumpSpeed')!.scale).toBeCloseTo(1.25);
    expect(only(mv, 'jumpSpeed')!.table).toBe('Melee_SpeedJumping');
  });
});
