import { describe, it, expect } from 'vitest';
import { Gloom } from './datasets/thunderspy/generated/powersets/blaster/primary/dark-blast/gloom';
import { FireBreath } from './datasets/thunderspy/generated/powersets/blaster/primary/fire-blast/fire-breath';
import { TenebrousTentacles } from './datasets/thunderspy/generated/powersets/blaster/primary/dark-blast/tenebrous-tentacles';

/**
 * Thunderspy DoT tickRate recovery.
 *
 * Thunderspy uses a pre-Homecoming binary format whose AttribMod templates store
 * attribs as string names; the parser's `_parse_effect_template_thunderspy` scans
 * the tail for the modifier table, then reads the canonical CoH post-table block
 * (scale, duration, magnitude, two expr arrays, delay, application_period, …).
 * It originally stopped after duration, so `application_period` (the DoT tick
 * interval) was never captured: every Thunderspy DoT exported `duration` with NO
 * `tickRate`, and the calc — which requires BOTH duration>0 and tickRate>0 — never
 * surfaced a DoT line. 372 damage blocks had a duration and 0 had a tickRate.
 *
 * Period lives at table+28 (delay at table+24, tick_chance at table+32), identical
 * to HC's Parse7 layout. These lock the fix against a regen silently dropping it.
 *
 * NB: Thunderspy rebalanced several DoTs away from their HC timing — its player
 * Gloom is a 1.5s / 0.2s window (8 ticks), not HC's 3.6s / 0.5s — so the duration
 * is asserted at the Thunderspy-native value, not the HC one.
 */
describe('Thunderspy DoT tickRate', () => {
  // `damage` is a single entry for a one-component attack and an ARRAY once a power
  // carries more than one damage type. Tenebrous Tentacles became the latter under
  // data-gaps-74 (its Negative burst rides a sibling AttribMod of the same element as the
  // Smashing DoT, so only one of the two was reachable before) — take the ticking
  // component either way, which is what this file is about.
  const single = (p: { damage?: unknown }) => {
    const d = p.damage as
      | { duration?: number; tickRate?: number }
      | { duration?: number; tickRate?: number }[]
      | undefined;
    const entries = Array.isArray(d) ? d : d ? [d] : [];
    return (entries.find((e) => (e.tickRate ?? 0) > 0) ?? entries[0]) as
      | { duration: number; tickRate: number }
      | undefined;
  };

  // ticks fire at 0, period, 2·period, …, duration ⇒ floor(duration/period)+1
  const ticks = (d: number, p: number) => Math.floor(d / p + 1e-4) + 1;

  it('Gloom carries a tickRate (was dropped → no DoT line)', () => {
    const d = single(Gloom)!;
    expect(d.duration).toBeCloseTo(1.5, 3);
    expect(d.tickRate).toBeGreaterThan(0);
    expect(d.tickRate).toBeCloseTo(0.2, 3);
    expect(ticks(d.duration, d.tickRate)).toBe(8);
  });

  it('Fire Breath is a 3-tick cone (duration 2.1 / period 1.0)', () => {
    const d = single(FireBreath)!;
    expect(d.duration).toBeCloseTo(2.1, 3);
    expect(d.tickRate).toBeCloseTo(1.0, 3);
    expect(ticks(d.duration, d.tickRate)).toBe(3);
  });

  it('Tenebrous Tentacles is an 8-tick DoT (duration 7.1 / period 1.0)', () => {
    const d = single(TenebrousTentacles)!;
    expect(d.duration).toBeCloseTo(7.1, 3);
    expect(d.tickRate).toBeCloseTo(1.0, 3);
    expect(ticks(d.duration, d.tickRate)).toBe(8);
  });
});
