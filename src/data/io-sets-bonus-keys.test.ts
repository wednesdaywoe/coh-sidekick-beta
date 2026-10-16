import { describe, it, expect } from 'vitest';
import { IO_SETS_RAW as HC_SETS } from '@/data/datasets/homecoming/io-sets-raw';
import { IO_SETS_RAW as RB_SETS } from '@/data/datasets/rebirth/io-sets-raw';
import { normalizeStatName } from '@/utils/calculations/set-bonuses';

/**
 * IO-set BONUS invariants — guards the binary-sourcing of set bonuses
 * (scripts/extract-rebirth-io-sets-v2.py).
 *
 * Two regression classes this catches, both of which the binary extractor
 * silently introduced before the bonus rewrite:
 *
 *  1. Unrecognized stat keys. A bonus `stat` the planner's normalizeStatName
 *     doesn't know is silently DROPPED from the build's totals. The early
 *     binary output emitted `cold_resistance` / `maxhp` / `maxendurance` /
 *     per-type mez resistances, none of which the planner maps — so resistance,
 *     max-HP and mez-resistance bonuses vanished. They must use the canonical
 *     keys (damage_resistance_(cold), maximum_hitpoints, mez_resistance_(all)…).
 *
 *  2. Value mis-scaling. Set-bonus values are scale × a per-attrib multiplier
 *     (damage ×250, max HP ×10, max endurance ×1, everything else ×100). A flat
 *     ×100 over-valued max HP 10× (1.125% → 11.25%) and under-valued damage.
 *     The range checks below would catch a re-introduction of that bug.
 *
 * Every emitted stat key must now resolve through normalizeStatName — either to
 * an internal key (modeled) or to `null` (explicitly ignored, e.g.
 * defense_(all), which is a summary line rather than a stat of its own). An
 * `undefined` result means the planner silently drops the bonus, which is the
 * regression this guards against.
 */
type Effect = { stat: string; value: number };
type Bonus = { pieces: number; effects?: Effect[] };
type Registry = Record<string, { bonuses?: Bonus[]; pieces?: Array<{ num: number; aspects?: string[]; proc?: boolean; name?: string; totalAspects?: number }> }>;

const KNOWN_UNMODELLED = new Set<string>();

function effects(reg: Registry): Array<{ setId: string; pieces: number; stat: string; value: number }> {
  const out: Array<{ setId: string; pieces: number; stat: string; value: number }> = [];
  for (const [setId, set] of Object.entries(reg)) {
    for (const bonus of set.bonuses ?? []) {
      for (const e of bonus.effects ?? []) out.push({ setId, pieces: bonus.pieces, stat: e.stat, value: e.value });
    }
  }
  return out;
}

describe.each([
  ['homecoming', HC_SETS as unknown as Registry],
  ['rebirth', RB_SETS as unknown as Registry],
])('IO-set bonus invariants (%s)', (_label, reg) => {
  it('every bonus stat key is planner-recognized (else silently dropped)', () => {
    const unknown = new Set<string>();
    for (const { stat } of effects(reg)) {
      if (KNOWN_UNMODELLED.has(stat)) continue;
      if (normalizeStatName(stat) === undefined) unknown.add(stat);
    }
    expect([...unknown].sort()).toEqual([]);
  });
});

describe('IO-set bonus key handling', () => {
  it('perception is modeled (Rectified Reticle → perceptionRadius global)', () => {
    expect(normalizeStatName('perception')).toBe('perceptionradius');
  });
  // data-gaps-188 — both of these used to resolve to null. The engine tracks them now, and the
  // shared vocabulary is generated from its contract, so the beta follows rather than decides.
  it('knockback_strength is modeled (offensive KB strength has its own stat)', () => {
    expect(normalizeStatName('knockback_strength')).toBe('knockbackstrength');
  });
  it('endurance_drain_resistance is modeled (it joins the attrib it shares)', () => {
    expect(normalizeStatName('endurance_drain_resistance')).toBe('debuffresistendurance');
  });
});

// Value anchors — exact, stable game values. They re-derive from the binary on
// every regen, so a scaling-multiplier regression flips them immediately.
describe('IO-set bonus value anchors (homecoming)', () => {
  const hc = HC_SETS as unknown as Registry;
  const val = (setId: string, pieces: number, stat: string) =>
    hc[setId]?.bonuses?.find((b) => b.pieces === pieces)?.effects?.find((e) => e.stat === stat)?.value;

  it('max-HP uses the ×10 modifier (not flat ×100)', () => {
    // Adrenal Adjustment 3pc: scale 0.1125 × 10 = 1.125% (the ×100 bug → 11.25).
    expect(val('adrenal_adjustment', 3, 'maximum_hitpoints')).toBeCloseTo(1.125, 3);
  });

  it('damage uses the ×250 modifier (not flat ×100)', () => {
    // Pounding Slugfest 4pc: scale 0.008 × 250 = 2.0% (the ×100 bug → 0.8).
    expect(val('pounding_slugfest', 4, 'damage')).toBeCloseTo(2.0, 3);
  });

  it('resistance + mez-resistance keep ×100 and canonical keys', () => {
    expect(val('absolute_amazement', 3, 'damage_resistance_(cold)')).toBeCloseTo(6.0, 3);
    expect(val('absolute_amazement', 3, 'mez_resistance_(all)')).toBeCloseTo(10.0, 3);
  });
});

describe('IO-set piece dilution (homecoming)', () => {
  const hc = HC_SETS as unknown as Registry;
  const piece = (setId: string, num: number) => hc[setId]?.pieces?.find((p) => p.num === num);

  it('Luck of the Gambler "Defense/+Recharge" dilutes its Defense as 2 aspects', () => {
    // The +Recharge global counts toward the dilution penalty — recovered from
    // the enhancement scale (0.625 = the 2-aspect modifier), NOT the 1-entry
    // aspect list. Guards the scale-derived totalAspects.
    const p = piece('luck_of_the_gambler', 6);
    expect(p?.aspects).toEqual(['Defense']);
    expect(p?.totalAspects).toBe(2);
  });

  it('ATO "#6" Recharge/Chance proc piece dilutes Recharge as 4 aspects', () => {
    const p = piece('superior_blasters_wrath', 6);
    expect(p?.aspects).toEqual(['Recharge']);
    expect(p?.totalAspects).toBe(4);
  });
});
