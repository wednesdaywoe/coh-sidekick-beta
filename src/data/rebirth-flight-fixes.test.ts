import { movementCapBumpValue } from '@/data/core/atom-query';
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import {
  getPowerPool,
  hasGrantedPowers,
  getGrantedPowerGroup,
  getInherentPowers,
  getInherentPowerDef,
} from '@/data';
import { getEffectiveMovementCaps, MOVEMENT_CAPS, MPH_PER_SCALE } from '@/data/core/movement-constants';

/**
 * @Redlynne Rebirth Flight pool report:
 *
 *   3) Group Fly should be unlocked by Fly + Aerobatics, but wasn't.
 *   4) Dive Attack + Fly should unlock Afterburner (increased max fly speed).
 *   2) Athletic Run was showing under Inherents (Rebirth has no Prestige
 *      Athletic Run — it ships Pool.Utility_Belt.Athletics instead).
 *
 * Rebirth reworked the Flight pool with reused internal names — Aerobatics is
 * internally "Group_Fly" and Dive Attack is "Afterburner". Each grants a free
 * bonus power (Group_Fly_Free / Fly_Afterburner) ONLY when Fly is also trained.
 * Verified against z_rebirth_bin.pigg: both bonus powers carry auto_issue=true.
 */

describe('Rebirth Flight pool bonus-power fixes', () => {
  beforeAll(async () => {
    await loadDataset('rebirth');
  });

  // ---- Issue 1: the bonus powers exist in the Flight pool data ------------
  it('the Flight pool carries both auto-granted bonus powers', () => {
    const flight = getPowerPool('flight');
    const names = flight?.powers.map((p) => p.internalName) ?? [];
    expect(names).toContain('Group_Fly_Free'); // free Group Fly
    expect(names).toContain('Fly_Afterburner'); // free Afterburner
    // Both are auto-granted (hidden from the picker).
    expect(flight?.powers.find((p) => p.internalName === 'Group_Fly_Free')?.available).toBeLessThan(0);
    expect(flight?.powers.find((p) => p.internalName === 'Fly_Afterburner')?.available).toBeLessThan(0);
  });

  // ---- Issues 3 & 4: conjunctive grant wiring (Aerobatics+Fly, Dive+Fly) --
  it('Aerobatics (Group_Fly) grants Group Fly and also requires Fly', () => {
    expect(hasGrantedPowers('Group_Fly')).toBe(true);
    const group = getGrantedPowerGroup('Group_Fly');
    expect(group?.grantedPowers).toContain('Group_Fly_Free');
    expect(group?.alsoRequires).toContain('Fly');
  });

  it('Dive Attack (Afterburner) grants Afterburner and also requires Fly', () => {
    expect(hasGrantedPowers('Afterburner')).toBe(true);
    const group = getGrantedPowerGroup('Afterburner');
    expect(group?.grantedPowers).toContain('Fly_Afterburner');
    expect(group?.alsoRequires).toContain('Fly');
  });

  it('HC\'s Fly -> Fly_Boost grant does not apply on Rebirth (no Fly_Boost power)', () => {
    expect(hasGrantedPowers('Fly')).toBe(false);
  });

  // ---- Issue 4: Afterburner raises the max fly-speed cap ------------------
  // Data-driven since 2026-07-12: the cap raise is the power's own
  // aspect=Maximum template (effects.movementCapBump), not a hardcoded
  // per-fullName table. Rebirth's Fly_Afterburner carries +1.0 fly-cap units
  // (z_rebirth_bin.pigg); Rebirth's Fly has NO Maximum template (unlike HC),
  // so Afterburner is the only fly-cap source there.
  it('Rebirth Afterburner (Fly_Afterburner) bumps the fly-speed cap', () => {
    const flight = getPowerPool('flight');
    const afterburner = flight?.powers.find((p) => p.internalName === 'Fly_Afterburner');
    // `movementCapBumpValue` rather than `effects.movementCapBump`: the pool bag went with the
    // writer-side strip, and this is the reader the cap resolve uses.
    const bump = movementCapBumpValue(afterburner!)?.find((e) => e.axis === 'flySpeed');
    expect(bump).toBeDefined();
    expect(bump!.scale).toBeGreaterThan(0);
    const caps = getEffectiveMovementCaps([{ stat: 'flySpeed', scale: bump!.scale, stackKey: bump!.stackKey, suppressible: bump!.suppressible }]);
    expect(caps.flySpeed).toBeCloseTo(MOVEMENT_CAPS.flySpeed + bump!.scale * MPH_PER_SCALE, 2);
    expect(caps.flySpeed).toBeGreaterThan(MOVEMENT_CAPS.flySpeed);
  });

  // ---- Issue 2: Athletic Run is not granted on Rebirth -------------------
  // Absence is DATA now, not a hand-written exclusion list: Rebirth's export has
  // no Athletic Run record anywhere, so its generated inherent module has no
  // entry to offer. The old `inherentRules.excludeInherents` was one name long
  // and is what let Thunderspy go on being offered all three runs (data-gaps-32).
  it('Athletic Run is excluded from Rebirth inherents', () => {
    expect(getInherentPowers().some((p) => p.internalName === 'Prestige_Athletic_Run')).toBe(false);
    expect(getInherentPowerDef('Prestige_Athletic_Run')).toBeUndefined();
    // Sibling prestige runs are unaffected.
    expect(getInherentPowerDef('Prestige_Ninja_Run')).toBeDefined();
  });
});
