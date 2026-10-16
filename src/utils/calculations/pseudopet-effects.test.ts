import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { synthesizePseudoPetEffects } from './pet-damage';
import type { SummonEffect } from '@/types/power';

/**
 * Pseudo-pet enhanceable-effect unify.
 *
 * Location / patch powers (Glue Arrow, etc.) deliver their enhanceable debuffs
 * through a non-commandable pseudo-pet, carrying nothing on the parent power.
 * `synthesizePseudoPetEffects` lifts those debuffs into a PowerEffects fragment
 * so the parent's Power Effects block can scale them by the summoner's
 * enhancements (the pet inherits them via CopyBoosts).
 *
 * Three rules the shapes below encode, each of which this file used to assert the
 * opposite of:
 *
 *  • An `IgnoreStrength` debuff IS surfaced, carrying the mark, and renders flat.
 *    The converter reads the flag rather than discarding the template, and this
 *    merge is the only place a pseudo-pet's kit reaches the summoning power at
 *    all — so dropping the row showed nothing where the honest answer is
 *    "something the summoner's slotting does not reach" (data-gaps-99).
 *  • A movement key holds one value PER AXIS. Glue Arrow slows running by 0.72
 *    and caps jump height at 500 off the same table; one value per key can hold
 *    neither, and summing them gives 500.72 (data-gaps-100 / data-gaps-103).
 *  • Every row an entity supplies names the entity's own class, because that is
 *    the class its tables resolve against — not the summoner's (data-gaps-105).
 */
describe('synthesizePseudoPetEffects', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  it('lifts Glue Arrow pseudo-pet Slow into the parent effects, one value per axis', () => {
    const summon: SummonEffect = { isPseudoPet: false, entity: 'Pets_StickyArrow_Blaster', duration: 30 };
    const out = synthesizePseudoPetEffects(summon);
    expect(out).not.toBeNull();
    // The run slow the summoner can enhance, beside the jump-height CAP off the same
    // table, which it cannot. Two axes, two answers, and neither is 500.72.
    expect(out!.slow).toEqual({
      runSpeed: { scale: 0.72, table: 'Melee_Slow', petClass: 'minion_pets' },
      jumpHeight: { scale: 500, table: 'Melee_Slow', petClass: 'minion_pets', ignoreStrength: true },
    });
  });

  it('surfaces IgnoreStrength debuffs, marked rather than dropped', () => {
    const summon: SummonEffect = { isPseudoPet: false, entity: 'Pets_StickyArrow_Blaster' };
    const out = synthesizePseudoPetEffects(summon);
    expect(Object.keys(out ?? {})).toEqual(['slow', 'rechargeDebuff', 'movementCapDebuff']);
    // The mark is the claim the row makes about the summoner's slotting, so it has to be
    // on the value — a reader with no mark multiplies, and reports a number the game
    // never produces.
    expect(out!.rechargeDebuff).toMatchObject({ ignoreStrength: true });
  });

  it('lifts a location AoE hold (Shadow Field) into the parent effects as a MezEffect', () => {
    // Shadow Field applies ALL its control through Pets_Shadow_Field_Controller,
    // so the hold must be hoisted for it to appear in Power Effects at all.
    const summon: SummonEffect = { isPseudoPet: false, entity: 'Pets_Shadow_Field_Controller', duration: 45, copyBoosts: true };
    const out = synthesizePseudoPetEffects(summon);
    expect(out).not.toBeNull();
    // The guaranteed pulse (mag 3, scale 8) wins over the aura's 5% proc.
    // `attribType` rides with the row: the reader takes the mez's quantity off it, and a
    // merged pet row that arrived without one resolves as unstated (data-gaps-167).
    expect(out!.hold).toEqual(
      { mag: 3, scale: 8, table: 'Melee_Ones', attribType: 'Duration', petClass: 'minion_pets' });
    // The pet's ToHitDebuff still surfaces alongside the hold.
    expect(out!.tohitDebuff).toEqual({ scale: 1.5, table: 'Melee_DeBuff_ToHit', petClass: 'minion_pets' });
  });

  it('does not surface a low-chance mez proc as a guaranteed hold', () => {
    // Shadow Field's aura carries a 5%-chance mag-3 hold; only the guaranteed
    // Shadow_Field_Hold_Controller pulse (scale 8, not 4) should be chosen.
    const out = synthesizePseudoPetEffects({ isPseudoPet: false, entity: 'Pets_Shadow_Field_Controller' });
    expect(out!.hold).toMatchObject({ scale: 8 });
    expect((out!.hold as { scale: number }).scale).not.toBe(4);
  });

  it('returns null for commandable pets (real summons keep their Summons block)', () => {
    const summon: SummonEffect = { isPseudoPet: false, entity: 'MastermindPets_Assault_Bot' };
    expect(synthesizePseudoPetEffects(summon)).toBeNull();
  });

  it('returns null when there is no summon', () => {
    expect(synthesizePseudoPetEffects(undefined)).toBeNull();
  });
});
