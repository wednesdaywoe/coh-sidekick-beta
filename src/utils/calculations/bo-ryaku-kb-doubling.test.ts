import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { legacyCalculateCharacterTotals as calculateCharacterTotals } from '@/utils/calculations/legacy-totals.oracle';
import { getTableValue } from '@/data/at-tables';
import { createEmptyBuild } from '@/types/build';

/**
 * Regression guard for the Bo Ryaku (Ninjitsu) KB-protection doubling.
 *
 * Bo Ryaku carries paired Knockup/Knockback protection at an equal magnitude. In
 * CoH these are the SAME physical KB-protection stat; the mezProtTypes loop maps
 * both knockup->protKnockback AND knockback->protKnockback, and summing them via
 * `+=` would DOUBLE the value (bug: Bo Ryaku ~14 instead of ~7). The guard is the
 * per-power `max` fold that counts the pair once while still stacking across powers.
 *
 * KB/KU protection is now atom-native (ATOM15 / data-gaps-206) — the value + the
 * self-protection discriminator come from `kbProtectionValue(power, field)`, not the
 * bag + effectArea/powerType proxy. So these mocks carry self-directed KB protection
 * ATOMS: Bo Ryaku's `MezResist/Knockback +5 (Res)` + `Mez/Knockback -15 (Cur)`
 * (Self, Melee_Res_Boolean) accumulate to 20; the second power is an Acrobatics-shaped
 * `Mez/Knockback -10 (Cur, Self, Melee_Ones)`. Tuple order = ATOM_TUPLE_FIELDS
 * (effectType, subType, scale, magnitude, duration, modifierTable, aspect, attribType, toWho, pvMode).
 */

const boRyaku = () => ({
  name: 'Bo Ryaku',
  internalName: 'Bo_Ryaku',
  powerType: 'Auto',
  targetType: 'Self',
  effectArea: 'SingleTarget',
  isActive: true,
  slots: [],
  // A non-empty bag clears the `if (!power.effects) continue` active-power gate;
  // it deliberately carries NO knockback/knockup key, so the credited protection
  // can ONLY come from the atoms below — proving the source is atom-native.
  effects: {},
  atoms: [
    ['MezResist', 'Knockback', 5, 1, 0, 'Melee_Res_Boolean', 'Res', 'Magnitude', 'Self', 'PvE'],
    ['Mez', 'Knockback', -15, 1, 0, 'Melee_Res_Boolean', 'Cur', 'Magnitude', 'Self', 'PvE'],
    ['MezResist', 'Knockup', 5, 1, 0, 'Melee_Res_Boolean', 'Res', 'Magnitude', 'Self', 'PvE'],
    ['Mez', 'Knockup', -15, 1, 0, 'Melee_Res_Boolean', 'Cur', 'Magnitude', 'Self', 'PvE'],
  ],
});

// A second Self KB-protection power (Acrobatics-shaped: self aspect=Cur on Melee_Ones,
// credited via the atom's toWho=Self) used to prove different powers still STACK.
const secondKbPower = () => ({
  name: 'Second KB Power',
  internalName: 'Second_KB_Power',
  powerType: 'Toggle',
  targetType: 'Self',
  effectArea: 'SingleTarget',
  isActive: true,
  slots: [],
  effects: {},
  atoms: [
    ['Mez', 'Knockback', -10, 1, 0, 'Melee_Ones', 'Cur', 'Magnitude', 'Self', 'PvE'],
    ['Mez', 'Knockup', -10, 1, 0, 'Melee_Ones', 'Cur', 'Magnitude', 'Self', 'PvE'],
  ],
});

function scrapperBuildWith(powers: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = createEmptyBuild();
  b.level = 50;
  b.archetype = { id: 'scrapper', name: 'Scrapper', stats: null, inherent: null };
  b.secondary = { powers };
  return b;
}

/**
 * Graded against the TS ORACLE, not the engine, deliberately.
 *
 * These cases feed the calc SYNTHETIC power definitions — hand-authored `atoms` tuples on a
 * power the dataset does not contain — to pin one applier rule in isolation. The engine cannot
 * consume that: it resolves a selected power's effects from its own contract bundle by
 * (powerSet, internalName), so a fabricated def resolves to nothing and the case would grade an
 * empty result rather than the rule it describes. `legacyCalculateCharacterTotals` is the same
 * calculation over the build object, kept as the independent oracle `serverParity` diffs the
 * engine against on all three datasets — so the rule stays graded, and the engine's own
 * agreement with this calc stays graded there, on real powers.
 */
describe('Bo Ryaku KB-protection doubling', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  it('counts a power\'s Knockback+Knockup protection ONCE (not summed)', () => {
    const tableVal = getTableValue('scrapper', 'melee_res_boolean', 50)!;
    const perField = 20 * tableVal;

    const t = calculateCharacterTotals(scrapperBuildWith([boRyaku()]), false, undefined, {
      combatMode: false,
    });

    // Correct: a single field's magnitude, NOT knockback + knockup summed.
    expect(t.globalBonuses.protKnockback).toBeCloseTo(perField, 5);

    // And the breakdown/tooltip must not list the same power twice for KB prot.
    const kbBreakdown = t.breakdown?.get('protKnockback');
    if (kbBreakdown) {
      const boRyakuSources = kbBreakdown.sources.filter((s) => s.name === 'Bo Ryaku');
      expect(boRyakuSources.length).toBe(1);
    }
  });

  it('still STACKS knockback protection across different powers', () => {
    const resBoolVal = getTableValue('scrapper', 'melee_res_boolean', 50)!;
    const onesVal = getTableValue('scrapper', 'melee_ones', 50)!;
    const boRyakuMag = 20 * resBoolVal; // one field
    const secondMag = 10 * onesVal; // one field

    const t = calculateCharacterTotals(
      scrapperBuildWith([boRyaku(), secondKbPower()]),
      false,
      undefined,
      { combatMode: false }
    );

    // Two distinct powers → their (de-duped) KB protections add together.
    expect(t.globalBonuses.protKnockback).toBeCloseTo(boRyakuMag + secondMag, 5);
  });
});
