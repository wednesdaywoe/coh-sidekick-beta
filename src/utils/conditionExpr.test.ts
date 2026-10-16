import { describe, it, expect } from 'vitest';
import { evaluateCondition, evaluateConditionTri, type ConditionContext } from '@/utils/conditionExpr';
import { applyFormVariant } from '@/components/info/resolveEffectivePower';
import type { Power } from '@/types/power';

/**
 * U8: the evaluator was two-valued, and `applyFormVariant` walked an ordered list with it.
 *
 * Folding "can't tell" into "no" is right for `quickSnipe`, which asks one condition and lets a
 * definite no and an unanswerable gate both leave the base standing — that is the engine's own
 * `fast_form_selected`. It is wrong for a list walk: `with_form_variant` abandons the walk at an
 * indeterminate branch, and skipping past it instead selects a fallback the game never reaches.
 *
 * These grade both halves of that, plus the Kleene propagation that only becomes observable once
 * a caller ACTS on unknown. While every unknown collapsed to `false`, `false && unknown` reached
 * the right answer by luck; with the walk stopping on unknown, the absorbing cases have to be
 * genuinely absorbed or nine Arachnos cloak variants start diverging from the engine in the
 * opposite direction from the one U8 names.
 */

const ctx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
  liveModes: new Set(),
  ownsPower: () => false,
  ownedPowerCount: () => 0,
  currentToHit: 0.75,
  ...over,
});

const t = (s: string, c: ConditionContext = ctx()) => evaluateConditionTri(s.split(' '), c);

describe('evaluateConditionTri — the third value', () => {
  it('answers definitely where the build can answer', () => {
    expect(t('cur.kToHit source> .97 >=')).toBe(false);
    expect(t('cur.kToHit source> .97 >=', ctx({ currentToHit: 0.99 }))).toBe(true);
    expect(t('kEngaged Source.Mode?', ctx({ liveModes: new Set(['kengaged']) }))).toBe(true);
    expect(t('1')).toBe(true);
    expect(t('0')).toBe(false);
  });

  it('is unknown where a static build has no value, rather than false', () => {
    // The U8 gate itself. `kMeter` is live rotation state; the engine's gate context refuses it.
    expect(t('kMeter source> .9 <')).toBeUndefined();
    // Target-relative readers have no one target in a totals calculation.
    expect(t('target.isFriend? !')).toBeUndefined();
    expect(t('enttype target> critter eq')).toBeUndefined();
    expect(t('distance 79 <')).toBeUndefined();
  });

  it('propagates unknown outward where there is no absorbing operand', () => {
    expect(t('kMeter source> .9 < !')).toBeUndefined();
    expect(t('kMeter source> 5 ==')).toBeUndefined();
    expect(t('kMeter source> critter eq')).toBeUndefined();
  });

  it('absorbs unknown Kleene-style when the definite sibling settles it', () => {
    // data-gaps-121's own example: mode off makes the conjunction false, unvaluable `distance` or not.
    expect(t('kBoostRange Source.Mode? distance 7 > &&')).toBe(false);
    expect(t('kBoostRange Source.Mode? distance 7 > &&', ctx({ liveModes: new Set(['kboostrange']) }))).toBeUndefined();
    expect(t('1 distance 7 > ||')).toBe(true);
    expect(t('0 distance 7 > ||')).toBeUndefined();
  });

  it('reads a cosmetic @-constant as a symbol operand, so its comparison is a definite no', () => {
    // Arachnos cloak variants. Treating `@CustomFX` as unresolvable would abandon the walk;
    // the engine pushes it as a symbol and `eq` reads definitely false.
    expect(t('@CustomFX Crabpack eq @CustomFX CrabpackTintable eq || Training_Gadgets.Crab_Spider_Training.Crab_Spider_Armor source.ownPower? &&')).toBe(false);
  });

  it('is unknown for a malformed program too — both are Err(_) to the engine', () => {
    expect(t('')).toBeUndefined();
    expect(evaluateConditionTri([], ctx())).toBeUndefined();
    expect(t('Crabpack !')).toBeUndefined();
    expect(t('5 +')).toBeUndefined();
  });

  it('evaluateCondition folds unknown to false, for the callers where that is right', () => {
    expect(evaluateCondition('kMeter source> .9 <'.split(' '), ctx())).toBe(false);
    expect(evaluateCondition('1'.split(' '), ctx())).toBe(true);
  });
});

// `stats.recharge`, not a top-level scalar: that is the shape the generated variants
// ship, and `applyFormVariant` spreads the variant over the power, so a variant that
// states `stats` replaces the object wholesale.
const power = (variants: { internalName: string; condition: string[]; recharge: number }[]) =>
  ({
    name: 'Assassin’s Claw',
    internalName: 'Assassins_Claw',
    stats: { recharge: 15 },
    formVariants: variants.map(({ internalName, condition, recharge }) => ({
      internalName,
      condition,
      stats: { recharge },
    })),
  }) as unknown as Power;

describe('applyFormVariant — the walk stops where the engine stops', () => {
  it('keeps the base when an unanswerable gate sits in front of a constant-true fallback', () => {
    // The shipped shape: `kMeter source> .9 <` then `1`. Two-valued, the walk skipped the first
    // and took the second, giving recharge 14 against the export's 15.
    const p = power([
      { internalName: 'Assassins_Claw_Quick', condition: ['kMeter', 'source>', '.9', '<'], recharge: 14 },
      { internalName: 'Assassins_Claw_Stealth', condition: ['1'], recharge: 13 },
    ]);
    expect(applyFormVariant(p, ctx()).stats?.recharge).toBe(15);
  });

  it('still selects a variant whose gate reads definitely true', () => {
    const p = power([
      { internalName: 'Quick', condition: ['kEngaged', 'Source.Mode?'], recharge: 14 },
      { internalName: 'Fallback', condition: ['1'], recharge: 13 },
    ]);
    expect(applyFormVariant(p, ctx({ liveModes: new Set(['kengaged']) })).stats?.recharge).toBe(14);
  });

  it('still walks past a variant whose gate reads definitely false', () => {
    const p = power([
      { internalName: 'Quick', condition: ['kEngaged', 'Source.Mode?'], recharge: 14 },
      { internalName: 'Fallback', condition: ['1'], recharge: 13 },
    ]);
    expect(applyFormVariant(p, ctx()).stats?.recharge).toBe(13);
  });

  it('walks past an absorbed unknown, which is a definite false and not a stop', () => {
    const p = power([
      { internalName: 'Ranged', condition: ['kBoostRange', 'Source.Mode?', 'distance', '7', '>', '&&'], recharge: 14 },
      { internalName: 'Fallback', condition: ['1'], recharge: 13 },
    ]);
    expect(applyFormVariant(p, ctx()).stats?.recharge).toBe(13);
  });
});
