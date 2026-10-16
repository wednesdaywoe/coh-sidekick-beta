import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import {
  getEffectiveAspectCount,
  parseIOSetPieceValues,
} from './enhancement-values';

// The value curves read from the active dataset (data-gaps-324 SW5); the expected
// percentages below are Homecoming's.
beforeAll(async () => {
  await loadDataset('homecoming');
});

/**
 * Regression: Heal/Absorb share one enhancement category, so a piece listing
 * both must count as a SINGLE aspect slot for the multi-aspect scheduling
 * penalty — Absorb surfaces as its own enhanced stat but must not dilute the
 * per-aspect value.
 *
 * Bug report (Doctored Wounds @ L50, Schedule A base = 0.424):
 *   - "Heal/Absorb/Recharge"  → 2 aspects → 26.5% each (was wrongly 21.2%)
 *   - "Heal/Absorb" (pure Heal) → 1 aspect → 42.4% (was wrongly 26.5%)
 *   - "Endurance/Recharge" (no Heal/Absorb) → 2 aspects → 26.5% (unchanged)
 */
describe('Heal/Absorb counts as a single aspect slot', () => {
  it('collapses the Heal+Absorb pair in the effective aspect count', () => {
    // pure Heal (Heal/Absorb) → 1
    expect(getEffectiveAspectCount(['Heal', 'Absorb'], false, undefined)).toBe(1);
    // Heal/Recharge (Heal/Absorb/Recharge) → 2
    expect(
      getEffectiveAspectCount(['Heal', 'Absorb', 'Recharge'], false, undefined),
    ).toBe(2);
    // Endurance/Heal (Endurance/Heal/Absorb) → 2
    expect(
      getEffectiveAspectCount(['Endurance', 'Heal', 'Absorb'], false, undefined),
    ).toBe(2);
    // Endurance/Heal/Recharge (Endurance/Heal/Absorb/Recharge) → 3
    expect(
      getEffectiveAspectCount(['Endurance', 'Heal', 'Absorb', 'Recharge'], false, undefined),
    ).toBe(3);
  });

  it('does not affect pieces without the Heal+Absorb pair', () => {
    expect(getEffectiveAspectCount(['Endurance', 'Recharge'], false, undefined)).toBe(2);
    expect(getEffectiveAspectCount(['Recharge'], false, undefined)).toBe(1);
  });

  it('values Doctored Wounds pieces per the bug report (@ L50)', () => {
    const round = (v: number) => Math.round(v * 1000) / 10; // → percent, 1 decimal

    const healRecharge = parseIOSetPieceValues(['Heal', 'Absorb', 'Recharge'], 50, false, undefined);
    expect(round(healRecharge.heal)).toBe(26.5);
    expect(round(healRecharge.absorb)).toBe(26.5);
    expect(round(healRecharge.recharge)).toBe(26.5);

    const pureHeal = parseIOSetPieceValues(['Heal', 'Absorb'], 50, false, undefined);
    expect(round(pureHeal.heal)).toBe(42.4);
    expect(round(pureHeal.absorb)).toBe(42.4);

    const endRecharge = parseIOSetPieceValues(['Endurance', 'Recharge'], 50, false, undefined);
    expect(round(endRecharge.endurance)).toBe(26.5);
    expect(round(endRecharge.recharge)).toBe(26.5);
  });
});
