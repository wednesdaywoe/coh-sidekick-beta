import { describe, it, expect } from 'vitest';
import { resolveProcRollGeometry, findProcData, calculateProcChance } from './proc-data';
import { calculateSlottedProcDamagePerCast } from '@/utils/calculations/power-proc-damage';
import { Propel as DominatorPropel } from './datasets/homecoming/generated/powersets/dominator/primary/gravity-control/propel';
import { LightningClap as BruteLightningClap } from './datasets/homecoming/generated/powersets/brute/primary/electrical-melee/lightning-clap';
import { LightningClap as StalkerLightningClap } from './datasets/homecoming/generated/powersets/stalker/primary/electrical-melee/lightning-clap';
import { FocusedBurst as ScrapperFocusedBurst } from './datasets/homecoming/generated/powersets/scrapper/primary/kinetic-melee/focused-burst';
import { FocusedBurst as TankerFocusedBurst } from './datasets/homecoming/generated/powersets/tanker/secondary/kinetic-melee/focused-burst';
import type { IOSetEnhancement } from '@/types';

/**
 * Guard for the "main-target-only" proc area-factor rule.
 *
 * Propel carries a 15ft AoE radius, but that radius belongs to its knockback
 * splash — the power lands on the main target only. EVERY proc slotted in it
 * therefore rolls the single-target area-factor: `ProcMainTargetOnly` is a
 * property of the POWER, not of the individual proc, so Force Feedback
 * (+Recharge) scores exactly like a damage proc does.
 *
 * MEASURED IN GAME 2026-07-28 (Propel + Explosive Strike 3.5 PPM, no recharge
 * slotted, single target): 66 hits → 43 procs = 65.2%. The single-target model
 * predicts 58.7% (z = +1.06, consistent); the 15ft-AoE model predicts 21.9%
 * (z = +8.51, p = 5.6e-14 — excluded). A second run on Lightning Clap
 * (2026-07-29, 65 hits → 61 procs = 93.8%) agrees. Do not "fix" this back to an
 * AoE denominator; the numbers are in docs/DATA-GAP-REGISTER-RESOLVED.md data-gaps-115.
 *
 * The flag now comes from the bin (data-gaps-115), which is why the first test can exist
 * at all: it reads converted data. The hardcoded set it replaced was keyed by
 * `internalName` and so could not even represent what the game actually
 * authors — the same power name is flagged on some archetypes and not others.
 */
describe('main-target-only proc area factor', () => {
  it('reaches the converted data per AT copy, not per power name', () => {
    // Propel: flagged, and its AoE radius is still present — the two coexist,
    // which is the whole point (the radius is the knockback, not the payload).
    expect(DominatorPropel.procsOnlyOnMainTarget).toBe(true);
    expect(DominatorPropel.stats?.radius).toBe(15);

    // Lightning Clap is authored flagged on Brute and NOT on Stalker, at
    // different radii. A name-keyed override could only ever get one of these
    // right; both copies are real powers a build can hold.
    expect(BruteLightningClap.procsOnlyOnMainTarget).toBe(true);
    expect(StalkerLightningClap.procsOnlyOnMainTarget).toBeUndefined();
    expect(StalkerLightningClap.stats?.radius).toBeGreaterThan(0);

    // Focused Burst: flagged on Scrapper alone of the four melee ATs that get it.
    expect(ScrapperFocusedBurst.procsOnlyOnMainTarget).toBe(true);
    expect(TankerFocusedBurst.procsOnlyOnMainTarget).toBeUndefined();
  });

  it('scores a damage proc in a 15ft power single-target when main-target-only', () => {
    // Minimal Propel-shaped slot: one foe-damage proc.
    const dmgSlot = {
      type: 'io-set',
      setId: 'unbreakable-constraint',
      setName: 'Unbreakable Constraint',
      pieceNum: 6,
      aspects: [],
      isProc: true,
      isUnique: true,
      id: 'test-proc',
      name: 'Chance for Smashing Damage',
      level: 50,
    } as unknown as IOSetEnhancement;

    // Propel's real timing: base recharge 8s, cast 2.07s.
    const base = {
      slots: [dmgSlot],
      baseRecharge: 8,
      castTime: 2.07,
      arcDegrees: 360,
      rechargeEnh: 0,
      buildLevel: 50,
    };

    const aoe = calculateSlottedProcDamagePerCast({ ...base, radius: 15 });
    const flagged = calculateSlottedProcDamagePerCast({
      ...base,
      radius: 15,
      procsOnlyOnMainTarget: DominatorPropel.procsOnlyOnMainTarget,
    });
    const trueSingleTarget = calculateSlottedProcDamagePerCast({ ...base, radius: 0 });

    // Sanity: the proc actually contributes damage (effects are populated).
    expect(aoe).toBeGreaterThan(0);
    // The flag makes a 15ft power's damage proc behave exactly like a
    // single-target power (radius 0) — the AoE penalty is removed.
    expect(flagged).toBeCloseTo(trueSingleTarget, 6);
    // And that is strictly more than the AoE-penalized value.
    expect(flagged).toBeGreaterThan(aoe);
  });

  it('scores Force Feedback single-target too — the flag is per-power, not per-proc', () => {
    // Force Feedback (+Recharge, no damage payload) must ride the same rule as a
    // damage proc. Every PPM surface goes through resolveProcRollGeometry, so
    // proving the seam returns single-target geometry proves it for all of them.
    const forceFeedback = findProcData('Chance for Recharge Buff', 'Force Feedback');
    expect(forceFeedback).toBeTruthy();
    const ppm = forceFeedback!.ppm;
    expect(ppm).toBeTruthy();

    const propel = resolveProcRollGeometry(DominatorPropel.procsOnlyOnMainTarget, 15, 360);
    expect(propel).toEqual({ radius: 0, arcDegrees: 360 });

    // Propel's timing (8s recharge, 2.07s cast): the single-target roll, not the
    // AoE-penalized one.
    const rolled = calculateProcChance(ppm!, 8, 2.07, propel.radius, propel.arcDegrees);
    expect(rolled).toBeCloseTo(calculateProcChance(ppm!, 8, 2.07, 0, 360), 10);
    expect(rolled).toBeGreaterThan(calculateProcChance(ppm!, 8, 2.07, 15, 360));
  });

  it('leaves an unflagged AoE alone and normalizes its arc', () => {
    // An unflagged 15ft AoE keeps its footprint...
    expect(resolveProcRollGeometry(undefined, 15, 360)).toEqual({ radius: 15, arcDegrees: 360 });
    // ...a cone keeps a real arc...
    expect(resolveProcRollGeometry(undefined, 40, 30)).toEqual({ radius: 40, arcDegrees: 30 });
    // ...and a missing/zero arc on an AoE, or any arc on a single-target power,
    // reads 360.
    expect(resolveProcRollGeometry(false, 15, undefined)).toEqual({ radius: 15, arcDegrees: 360 });
    expect(resolveProcRollGeometry(false, 0, 30)).toEqual({ radius: 0, arcDegrees: 360 });
  });
});
