import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getPetEntity } from '@/data/pet-entities';
import { getPowerset } from '@/data';
import { getTableValue } from '@/data/at-tables';
import { calculatePetDamage, calculateResolvedPseudoPetDamage } from './pet-damage';
import { dotTickCount } from './damage';
import type { Power } from '@/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Trip Mine damage (report 2026-07-26: "on Defender/Blaster the damage is
 * incorrectly very high"; "Dominator Trip Mine has no damage currently").
 *
 * A Trip Mine is a summon: the damage lives on the pet, and the InfoPanel turns
 * it into a per-cast number as `damagePerHit × firesPerSpawn`. Three separate
 * defects met there:
 *
 *  1. `firesPerSpawn` divided the 260s summon window by the attack's cycle time,
 *     so a mine that detonates ONCE read as 13 detonations. Only the
 *     Controller/Corruptor/Mastermind mine escaped — its shared entity carries a
 *     1000s attack recharge, which rounds the same formula down to 1 by accident.
 *     Fixed by `PetEntity.oneShot`, stamped by the converter from the pet's
 *     bundled immediate Self_Destruct.
 *  2. The converter dropped the effect group's `chance`, so the mines' 50%-chance
 *     third Fire template was summed at full value (~+14%).
 *  3. The Dominator's mine redirects only to `TripMine_Resistance` and
 *     `TripMine_Info` — the real `TripMine` is executed by the pet's
 *     Self_Destruct and never redirected — and the pseudo-pet resolver dropped
 *     `*_Info` as tooltip-only, leaving nothing to resolve.
 *
 * Expected values are level 50, unslotted, `minion_pets` melee_damage = 55.66
 * (the Dominator's resolved pseudo-pet reads the SUMMONER's table instead).
 *
 * Issue 28 Page 4 (live 2026-10-06) retired the per-AT Traps mines: Traps and Devices now share
 * one pseudo-pet (`Villain_Pets.Traps_Trip_Mine`) on the summoner's own modifiers. Its 50% third
 * Fire sits in a child group, which the resolved path summed whole until the converter learned to
 * carry a per-hit `chance` — defect 2 again, on the new path.
 */
describe('Trip Mine damage (homecoming)', () => {
  beforeAll(async () => { await loadDataset('homecoming'); });

  const SUMMON_WINDOW = 260;

  it('Pets_Mine is marked oneShot', () => {
    expect(getPetEntity('Pets_Mine')?.oneShot).toBe(true);
  });

  it('a mine fires once, not once per attack-recharge over the summon window', () => {
    // Guards the bug's actual mechanism: the naive formula must still disagree,
    // else this test would pass for the wrong reason on any future data change.
    const r = calculatePetDamage('Pets_Mine', 50, 1, SUMMON_WINDOW, 0, false, 0, [])!;
    const naiveFires = dotTickCount(SUMMON_WINDOW, r.abilities[0].cycleTime);
    expect(naiveFires).toBeGreaterThan(1);
    expect(r.oneShot).toBe(true);
  });

  const MINE_HOLDERS: [string, string][] = [
    ['blaster', 'blaster/devices'],
    ['defender', 'defender/traps'],
    ['controller', 'controller/traps'],
    ['corruptor', 'corruptor/traps'],
    ['mastermind', 'mastermind/traps'],
  ];
  const resolvedMine = (setId: string) => {
    const power = getPowerset(setId)?.powers
      .find((p: Power) => p.internalName === 'Trip_Mine') as Power | undefined;
    return (power?.summon as any)?.resolvedEntities?.[0];
  };

  it('weights the 50%-chance third Fire template instead of summing it whole', () => {
    const mine = resolvedMine('defender/traps');
    expect(mine, 'defender Trip Mine resolvedEntities').toBeTruthy();
    expect(mine.abilities[0].damage.map((d: any) => d.chance)).toEqual([undefined, undefined, 0.5]);
  });

  it.each(MINE_HOLDERS)('per-detonation damage is 2 + 1 + 0.5x1 on the %s table (%s)', (at, setId) => {
    const r = calculateResolvedPseudoPetDamage(resolvedMine(setId), at, 50, 0, false, 0, false)!;
    expect(r, `${setId} resolves`).toBeTruthy();
    // Defect 1 on the new path: without it the 260s window read as nine detonations.
    expect(r.oneShot, `${setId} is a one-shot`).toBe(true);
    // 3.5, not the 4.0 a whole third Fire would give.
    expect(r.abilities[0].damagePerHit).toBeCloseTo(3.5 * Math.abs(getTableValue(at, 'Melee_Damage', 50)!), 0);
  });

  it("the Dominator's mine resolves damage from its Info redirect", () => {
    const power = getPowerset('dominator/arsenal-assault')?.powers
      .find((p: Power) => p.internalName === 'Trip_Mine') as Power | undefined;
    // The writer lifts `summon` out of the bag to the top level (STRIP-1/BPORT7); the bag
    // slot it used to sit in is gone.
    const resolved = (power?.summon as any)?.resolvedEntities?.[0];
    expect(resolved, 'Dominator Trip Mine resolvedEntities').toBeTruthy();

    const r = calculateResolvedPseudoPetDamage(resolved, 'dominator', 50, 0, false, 0, false)!;
    expect(r).toBeTruthy();
    const dmg = r.abilities[0].damagePerHit;
    expect(dmg).toBeGreaterThan(0);
    // 1.0954 × dominator melee_damage(50) = 58.39. The PvP twin (0.9077 ×
    // Melee_PvPDamage) must NOT also be counted.
    expect(dmg).toBeCloseTo(1.0954 * 58.39, 0);
  });
});
