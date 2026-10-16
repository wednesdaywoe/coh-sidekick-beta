/**
 * Plan B Slices 1-2 — regression guard for the atom-native ToHit + Damage appliers.
 *
 * `legacy-totals.oracle.ts` now sources +ToHit / +Damage from `toHitBuffValue(power)`
 * / `damageBuffValue(power)` (atoms) instead of the `effects.*` bag. This asserts
 * the LIVE atom path returns the value the calc needs, on the real generated data,
 * for the shapes the migration had to get right:
 *   - per-target (Soul Drain: 1.0 flat + 0.2/foe → the per-foe slider),
 *   - per-target where the atom's own `stacking` does not settle it (Invincibility
 *     is `Continuous`, which the atom now carries since data-gaps-66 but which is not
 *     on its own a per-target increment — the converter-STAMPED one is),
 *   - burst/tail (Inner Light: sustained 0.77 ToHit tail, NOT the 2.77 overlap sum),
 *   - +Damage's per-damage-type explosion (collapsed, not 8× summed),
 *   - a redirect-sourced increment (Fulcrum Shift: base 4 + 2/foe from the chain),
 *   - a non-uniform +Damage (Embrace of Fire: +8 all types, not the +10 Fire tail).
 * Corpus-wide equality vs the bag is proven separately by
 * `scripts/planb-shadow-pertarget.cjs`; this pins the headline cases in CI.
 */
import { describe, it, expect } from 'vitest';
import { toHitBuffValue, damageBuffValue } from '@/data/core/atom-query';
import { SoulDrain } from '@/data/datasets/homecoming/generated/powersets/scrapper/primary/dark-melee/soul-drain';
import { Invincibility } from '@/data/datasets/homecoming/generated/powersets/scrapper/secondary/invulnerability/invincibility';
import { BuildUp as InnerLight } from '@/data/datasets/homecoming/generated/powersets/peacebringer/epic/luminous-blast/build-up';
import { AgainstallOdds } from '@/data/datasets/homecoming/generated/powersets/brute/secondary/shield-defense/against-all-odds';
import { FulcrumShift } from '@/data/datasets/homecoming/generated/powersets/corruptor/secondary/kinetics/fulcrum-shift';
import { FieryEmbrace } from '@/data/datasets/homecoming/generated/powersets/dominator/secondary/fiery-assault/fiery-embrace';

// Mirror adjustForPerTarget: scale + perTarget × (N − 1), with N=1 the base.
const perTargetAt = (scale: number, perTarget: number, n: number) =>
  n <= 0 ? 0 : n === 1 ? scale : scale + perTarget * (n - 1);

describe('atom-native ToHit — Soul Drain per-foe scaling (the slider)', () => {
  const v = toHitBuffValue(SoulDrain)!;
  it('reconstructs 1.0 flat + 0.2/foe as { scale: 1.2, perTarget: 0.2 }', () => {
    expect(v).toBeDefined();
    expect(v.scale).toBeCloseTo(1.2);
    expect(v.perTarget).toBeCloseTo(0.2);
    expect(v.table).toBe('Melee_Buff_ToHit');
  });
  it('scales from 1 to 8 targets like the bag would (0.2 per extra foe)', () => {
    expect(perTargetAt(v.scale, v.perTarget!, 1)).toBeCloseTo(1.2);
    expect(perTargetAt(v.scale, v.perTarget!, 8)).toBeCloseTo(1.2 + 0.2 * 7); // 2.6
  });
});

describe('atom-native ToHit — Invincibility (Continuous increment, stamp-only)', () => {
  it('recovers perTarget from the stamp even though the atom stacking reads "No"', () => {
    const v = toHitBuffValue(Invincibility)!;
    expect(v).toBeDefined();
    expect(v.scale).toBeCloseTo(0.2);
    expect(v.perTarget).toBeCloseTo(0.2); // would be 0 if we re-derived off `stacking`
  });
});

describe('atom-native ToHit — Inner Light burst/tail (sustained value)', () => {
  it('returns the 0.77 tail (not the 2.77 first-10s overlap), no perTarget', () => {
    const v = toHitBuffValue(InnerLight)!;
    expect(v).toBeDefined();
    expect(v.scale).toBeCloseTo(0.77);
    expect(v.perTarget ?? 0).toBe(0);
  });
});

describe('atom-native Damage — Soul Drain per-foe scaling (the slider)', () => {
  const v = damageBuffValue(SoulDrain)!;
  it('collapses the 8 damage-type atoms to { scale: 4.8, perTarget: 0.8 }', () => {
    expect(v).toBeDefined();
    expect(v.scale).toBeCloseTo(4.8); // 4.0 base + 0.8/foe at N=1, NOT 8× that
    expect(v.perTarget).toBeCloseTo(0.8);
    expect(v.table).toBe('Melee_Buff_Dmg');
  });
  it('scales from 1 to 8 targets like the bag would (+0.8 per extra foe)', () => {
    expect(perTargetAt(v.scale, v.perTarget!, 8)).toBeCloseTo(4.8 + 0.8 * 7); // 10.4
  });
});

describe('atom-native Damage — Against All Odds (Self increment counts at N=1)', () => {
  it('reconstructs 1.0 flat + 0.55/foe as { scale: 1.55, perTarget: 0.55 }', () => {
    const v = damageBuffValue(AgainstallOdds)!;
    expect(v.scale).toBeCloseTo(1.55); // Self increment lands on the caster at N=1
    expect(v.perTarget).toBeCloseTo(0.55);
  });
});

describe('atom-native Damage — Fulcrum Shift (redirect increment, Target toWho)', () => {
  it('recovers { scale: 6, perTarget: 2 } — the flat self buff plus the first foe`s', () => {
    const v = damageBuffValue(FulcrumShift)!;
    // The increment is `AnyAffected`, and until data-gaps-63 that read as "not the caster's",
    // so N=1 was the flat 4 alone. Both of this power's leaves are `['Friend', 'Self']`
    // powers — `KineticTransferBuffSelf` puts the flat +4 on the caster and
    // `KineticTransferBuff` puts +2 on every friend near each foe — so at one foe he has
    // 4 + 2, and each further foe adds another 2. `ownerTargets` is what carries the
    // leaves' own targets past the `['Foe']` shell that collected them.
    expect(v.scale).toBeCloseTo(6);
    expect(v.perTarget).toBeCloseTo(2); // converter-stamped onto the base atoms
  });
});

describe('atom-native Damage — non-uniform + burst/tail (majority type, no perTarget)', () => {
  it('Inner Light returns the 3.2 damage tail (not the 8.0 burst), no perTarget', () => {
    const v = damageBuffValue(InnerLight)!;
    expect(v.scale).toBeCloseTo(3.2);
    expect(v.perTarget ?? 0).toBe(0);
  });
  it('Embrace of Fire returns +8 (all 7 non-Fire types), NOT the +10 Fire-only tail', () => {
    const v = damageBuffValue(FieryEmbrace)!;
    expect(v.scale).toBeCloseTo(8); // majority damage-type value wins the single slot
    expect(v.perTarget ?? 0).toBe(0);
  });
});
