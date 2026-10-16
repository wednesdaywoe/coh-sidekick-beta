import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { whatIfVocabulary } from '@/engine/engine';
import { createEmptyBuild } from '@/types/build';
import { getArchetype } from '@/data';
import { calculateCharacterTotals } from './character-totals';
import {
  buildChainPowers,
  getEnduranceParams,
  getBuildGlobalRecharge,
  chainWhatIfRows,
  CHAIN_WHAT_IF_STATS,
} from './attack-chain-powers';
import { Flares } from '@/data/datasets/homecoming/generated/powersets/blaster/primary/fire-blast/flares';
import { FireBlast } from '@/data/datasets/homecoming/generated/powersets/blaster/primary/fire-blast/fire-blast';
import { FireBall } from '@/data/datasets/homecoming/generated/powersets/blaster/primary/fire-blast/fire-ball';
import { BlazingBolt } from '@/data/datasets/homecoming/generated/powersets/blaster/primary/fire-blast/blazing-bolt';

/**
 * Which team buffs the Attack Chain Builder's own sliders offer — measured, not declared.
 *
 * The chain modal offers a SUBSET of the what-if layer: the stats a rotation's timing, damage
 * and endurance actually move with. That subset is the kind of list that rots quietly — the
 * chain grows or loses a dependency, and the modal keeps offering a control that changes
 * nothing (or stops offering one that would). Nothing fails and the numbers stay plausible.
 *
 * So `CHAIN_WHAT_IF_STATS` is not trusted here. Every key the engine's vocabulary offers is
 * pushed through the whole chain pipeline — totals → chain powers → endurance params → the
 * recharge divisor and the always-on ToHit the snipe rule reads — and the declaration is held
 * to exactly the set that moved something.
 *
 * The rebuild runs the same measurement against its own chain (`chain_sensitivity_gate.rs`).
 * The two sets are NOT expected to match: this planner resolves the fast-snipe form from
 * `permanentToHit`, so +ToHit moves a chain here and does not there (DATA-GAP-REGISTER
 * data-gaps-127). A difference is a finding to record, not a bug to smooth over.
 */

const SET = 'blaster/fire-blast';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blasterBuild(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = createEmptyBuild();
  b.level = 50;
  b.archetype = { id: 'blaster', name: 'Blaster', stats: null, inherent: null };
  b.primary = {
    id: SET,
    name: 'Fire Blast',
    // The snipe is picked deliberately: its fast form is gated on always-on ToHit, which is the
    // one chain dependency unique to this planner.
    powers: [Flares, FireBlast, FireBall, BlazingBolt].map((p) => ({
      ...p, powerSet: SET, level: 1, slots: [],
    })),
  };
  return b;
}

/** Everything the chain modal draws a number from, as one comparable string. */
function chainSignature(whatIfBuffs: Record<string, number>): string {
  const build = blasterBuild();
  const calc = calculateCharacterTotals(build, false, undefined, { whatIfBuffs });
  const mechCtx = { archetypeId: 'blaster' } as never;
  const powers = buildChainPowers(build, calc.globalBonuses, mechCtx);
  expect(powers.length, 'the probe build schedules nothing — this test would grade air').toBeGreaterThan(2);
  return JSON.stringify({
    powers,
    endurance: getEnduranceParams(calc.globalBonuses, getArchetype('blaster')?.stats, build.level),
    globalRecharge: getBuildGlobalRecharge(calc.globalBonuses),
    permanentToHit: calc.globalBonuses.toHit,
  });
}

describe('Attack Chain Builder — which team buffs move a chain', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  it('offers a slider for exactly the stats that change a chain number', () => {
    const baseline = chainSignature({});
    const vocabulary = whatIfVocabulary();
    expect(vocabulary.length, 'the engine returned no what-if vocabulary').toBeGreaterThan(40);

    const measured = vocabulary
      .filter((stat) => chainSignature({ [stat]: 60 }) !== baseline)
      .sort();

    expect(measured).toEqual([...CHAIN_WHAT_IF_STATS].sort());
  });

  it('drains the exported endurance pool, and binds it at the archetype ceiling', () => {
    // The sim used to open `100 + maxEndurance` — a hardcoded pool with no clamp on either the
    // pool or the recovery rate. Both are the export's (data-gaps-183), and a what-if is exactly what
    // reaches the ceiling: no real build gets near +265 max endurance.
    const stats = getArchetype('blaster')!.stats;
    const build = blasterBuild();
    const basePool = stats.maxEnduranceTable[build.level - 1];
    const poolCap = stats.maxEnduranceCapTable[build.level - 1];

    const unbuffed = getEnduranceParams(
      calculateCharacterTotals(build, false, undefined, {}).globalBonuses, stats, build.level,
    )!;
    expect(unbuffed.maxEnd).toBe(basePool);

    const pushed = calculateCharacterTotals(build, false, undefined, {
      whatIfBuffs: { maxEndurance: 100_000, recovery: 100_000 },
    }).globalBonuses;
    const buffed = getEnduranceParams(pushed, stats, build.level)!;
    expect(buffed.maxEnd).toBe(poolCap);
    // …and the rate is the CLAMPED recovery over that bar, not the raw accumulator's.
    const recoveryCeiling = (stats.recoveryCapTable[build.level - 1] / stats.recoveryBase - 1) * 100;
    expect(buffed.recoveryPerSec).toBeCloseTo((poolCap / 60) * (1 + recoveryCeiling / 100), 6);
    expect(pushed.recovery).toBeGreaterThan(recoveryCeiling);
  });

  it("reports the build's own value even where the ceiling binds", () => {
    // A control shows "Build X → Y simulated". Deriving X as `current − simulated` is the trap:
    // against a bound ceiling that reads as a large negative, so X comes off the raw accumulator.
    const stats = getArchetype('blaster')!.stats;
    const build = blasterBuild();
    const layer = { recovery: 5000 };
    const calc = calculateCharacterTotals(build, false, undefined, { whatIfBuffs: layer });
    const rows = chainWhatIfRows(calc.globalBonuses, stats, build.level, layer);
    const recovery = rows.find((r) => r.stat === 'recovery')!;

    const clean = calculateCharacterTotals(build, false, undefined, {});
    expect(recovery.fromBuild).toBeCloseTo(clean.globalBonuses.recovery, 6);
    expect(recovery.current).toBe(recovery.ceiling);
    expect(recovery.current).toBeLessThan(5000);
  });

  it('gives a build with no archetype no endurance bar rather than an invented one', () => {
    const build = blasterBuild();
    build.archetype = null;
    const calc = calculateCharacterTotals(build, false, undefined, {});
    expect(getEnduranceParams(calc.globalBonuses, null, build.level)).toBeNull();
  });

  it('leaves a stat the chain ignores alone however hard it is pushed', () => {
    // The negative control: if the signature were over-sensitive, every stat would measure as
    // chain-moving and the check above would be vacuous in the direction that matters.
    const baseline = chainSignature({});
    for (const stat of ['defMelee', 'resSmashing', 'maxHP', 'regeneration']) {
      expect(chainSignature({ [stat]: 100_000 }), `${stat} moved a chain number`).toBe(baseline);
    }
  });
});
