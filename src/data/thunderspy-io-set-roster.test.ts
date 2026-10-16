import { describe, it, expect } from 'vitest';
import { IO_SETS_RAW as TSPY_SETS } from '@/data/datasets/thunderspy/io-sets-raw';
import { IO_SETS_RAW as HC_SETS } from '@/data/datasets/homecoming/io-sets-raw';

/**
 * Thunderspy IO-set roster, extracted from Thunderspy's own boostsets.bin
 * (scripts/extract-rebirth-io-sets-v2.py --dataset thunderspy) instead of the
 * old placeholder that re-exported Homecoming's entire registry wholesale.
 *
 * The wholesale re-export was the root cause of two reported bug classes:
 *   1. HC-only sets that don't exist on Thunderspy leaked in (Sudden
 *      Acceleration, Synapse's Shock, Power Transfer, Hypersonic, + 13 more).
 *   2. Thunderspy-only sets were missing entirely.
 *
 * These invariants guard against a regression back to the HC roster.
 */
/**
 * A set entry with the fields each fork states for itself removed, so two forks'
 * copies of one set can be compared for the structure they genuinely share.
 *
 * `rarity` and `type` are per-fork binary tokens (Thunderspy labels its second ATO
 * families ECATO2/ECSATO2 where Homecoming uses ECATO/ECSATO for both, and the
 * forks spell four slotting headings differently). Piece NAMES joined them in
 * 2026-08: every fork names its pieces from its own boost powers, and the strings
 * differ — Homecoming's ATO pieces carry an archetype qualifier the others don't.
 * BONUSES joined them in data-gaps-5 step 2: each fork's tiers resolve from its own
 * export, and the authorings differ (HC re-rounded defense scales to 4dp and
 * offset its damage tiers +0.025), so only the tier/piece structure is shared.
 */
function sharedStructure(set: Record<string, unknown>) {
  const { rarity: _rarity, type: _type, bonuses: _bonuses, ...rest } = set;
  return {
    ...rest,
    pieces: (rest.pieces as Array<Record<string, unknown>>).map(({ name: _name, ...piece }) => piece),
  };
}

describe('Thunderspy IO-set roster', () => {
  it('excludes the HC-only sets that are not on Thunderspy', () => {
    // The four the player reported, plus a few of the other HC-only sets that
    // aren't in tspy's boostsets.bin.
    for (const id of [
      'sudden_acceleration',
      'synapses_shock',
      'power_transfer',
      'hypersonic',
    ]) {
      expect(TSPY_SETS, `${id} should NOT be on Thunderspy`).not.toHaveProperty(id);
      expect(HC_SETS, `${id} sanity: is an HC set`).toHaveProperty(id);
    }
  });

  it('has Overwhelming Force AND Subaluwa as distinct Universal Damage sets', () => {
    // Both exist on Thunderspy (verified in-game 2026-07-02): Overwhelming Force
    // is the natively-attuned universal-damage set — its boostsets.bin record
    // states no conversion groups, so it carries no rarity, so build_sets drops it
    // and it's re-injected from HC's hand entry (HC_WHOLESET_SETS). Subaluwa is a
    // SEPARATE tspy-only crafted knockback set (record `kb`). An earlier pass
    // wrongly assumed OF had been reworked *into* Subaluwa and dropped it.
    expect(TSPY_SETS, 'Overwhelming Force should be present').toHaveProperty('overwhelming_force');
    expect(sharedStructure(TSPY_SETS['overwhelming_force'])).toEqual(
      sharedStructure(HC_SETS['overwhelming_force']),
    );
    // Distinct sets, distinct icons.
    expect(TSPY_SETS['overwhelming_force'].name).toBe('Overwhelming Force');
    expect(TSPY_SETS['kb'].name).toBe('Subaluwa');
    expect(TSPY_SETS['overwhelming_force'].icon).toBe('UD_Overwhelming_Force.png');
    expect(TSPY_SETS['kb'].icon).toBe('UD_Subaluwa.png');
  });

  it('keeps sets shared with Homecoming, reusing HC\'s curated data', () => {
    for (const id of [
      'kinetic_combat',
      'luck_of_the_gambler',
      'essence_transfer',
      'superior_essence_transfer',
    ]) {
      expect(TSPY_SETS, `${id} should be present`).toHaveProperty(id);
      // A shared set reuses HC's entry for the aspect lists this fork's own
      // extraction is missing; see `sharedStructure` for what each fork keeps
      // stating for itself.
      expect(typeof TSPY_SETS[id].rarity).toBe('string');
      expect(typeof HC_SETS[id].rarity).toBe('string');
      expect(sharedStructure(TSPY_SETS[id])).toEqual(sharedStructure(HC_SETS[id]));
    }
  });

  it('a shared set\'s bonus VALUES are Thunderspy\'s own, not Homecoming\'s', () => {
    // Kinetic Combat 4pc melee defense: tspy's export authors the exact scale
    // 0.01875 (→ 1.875) where HC re-rounded to 0.0188 (→ 1.88). The pair going
    // equal again means _reuse_hand_entry is back to shipping HC's tiers.
    const tier = (sets: typeof TSPY_SETS, id: string, pieces: number) =>
      sets[id].bonuses.find((b) => b.pieces === pieces)!.effects;
    expect(tier(TSPY_SETS, 'kinetic_combat', 4)).toContainEqual(
      expect.objectContaining({ stat: 'defense_(melee)', value: 1.875 }),
    );
    expect(tier(HC_SETS, 'kinetic_combat', 4)).toContainEqual(
      expect.objectContaining({ stat: 'defense_(melee)', value: 1.88 }),
    );
  });

  it('has strictly fewer sets than HC (HC-only sets removed)', () => {
    expect(Object.keys(TSPY_SETS).length).toBeLessThan(Object.keys(HC_SETS).length);
  });

  it('includes Subaluwa (Universal Damage) with the correct pieces + bonuses', () => {
    const sub = TSPY_SETS['kb'];
    expect(sub, 'Subaluwa (kb) should be present').toBeDefined();
    expect(sub.name).toBe('Subaluwa');
    expect(sub.type).toBe('Universal Damage Sets');
    // 6 pieces: 5 aspect pieces + the Chance for Knockback proc.
    expect(sub.pieces).toHaveLength(6);
    expect(sub.pieces[0].aspects).toEqual(['Accuracy', 'Damage']);
    expect(sub.pieces.some((p) => p.proc && /knockback/i.test(p.name))).toBe(true);
    // Bonuses derived from the authoritative Set_Bonus names + binary scales,
    // cross-checked against Overwhelming Force: +3% Damage and +2.5%/1.25%
    // Energy/Ranged defense.
    const effs = sub.bonuses.flatMap((b) => b.effects);
    expect(effs).toContainEqual(expect.objectContaining({ stat: 'damage', value: 3 }));
    expect(effs).toContainEqual(expect.objectContaining({ stat: 'defense_(energy)', value: 2.5 }));
    expect(effs).toContainEqual(expect.objectContaining({ stat: 'defense_(ranged)', value: 1.25 }));
    // Paired resist must NOT be double-emitted (planner auto-pairs lethal↔smashing).
    expect(effs.some((e) => e.stat === 'damage_resistance_(smashing)')).toBe(false);
  });

  it('includes the Primalist ATO sets under the Primalist Archetype category', () => {
    for (const id of ['primalists_nature', 'superior_primalists_nature']) {
      expect(TSPY_SETS, `${id} should be present`).toHaveProperty(id);
      expect(TSPY_SETS[id].category).toBe('ato');
      expect(TSPY_SETS[id].type).toBe('Primalist Archetype Sets');
      expect(TSPY_SETS[id].pieces).toHaveLength(6);
    }
  });
});
