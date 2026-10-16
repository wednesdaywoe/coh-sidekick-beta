/**
 * Foresight — OVERRIDES LAYER
 *
 * Hand-written deltas applied on top of the generated power object via
 * `withOverrides()`. The generated layer is now sourced from the live HC
 * binary (exported_powers/), so the legacy numeric pins that used to live
 * here were stale CoD2 values and have been retired (2026-06 override audit).
 * Any remaining entries are display fixes or planner-only enrichments the
 * parser doesn't emit yet — prefer fixing the parser/converter over re-adding
 * an override. See GAME-DATA-PRINCIPLES.md §13 and src/data/README.md.
 *
 * Retired 2026-07-18 (ATOM4 finding): the `elusivity.all` entry hand-copied this
 * power's Base_Defense@Resistance DDR value into a second bag slot, which the
 * calc sums into debuffResistDefense — double-counting defense-debuff-resistance.
 * The binary grants it ONCE (one Base_Defense@Resistance template → the
 * `debuffResistance.defense` bag / `Defense aspect=Res` atom); real elusivity is a
 * distinct PvP-only stat (the aspect=Strength `*_Elusivity` atoms). Do not re-add.
 *
 * Retired 2026-07-18 (data-gaps-205 finding): the `specialBuff` mez block (hold/stun/
 * immobilize/sleep/confuse/fear @ 0.25 Melee_Ones) hand-copied this power's mez
 * RESISTANCE into a slot the calc reads as mez STRENGTH — the same over-credit as
 * the elusivity entry, one aspect over. Foresight's binary carries exactly one mez
 * template, `aspect: Resistance` (six MezResist aspect=Res atoms), and the generated
 * layer already routes it correctly to `effects.mezResistance`. There is no
 * aspect=Strength mez template, so crediting any `strengthMez` is a fabrication.
 * The atom-native path reconstructs specialBuff from atoms (aspect=Str only), so it
 * reads 0 here regardless; this entry only inflated the transitional bag. Do not
 * re-add. See DATA-GAP-REGISTER data-gaps-205 and coh_math test
 * `strength::tests::mez_resistance_atoms_are_not_mez_strength`.
 *
 * data-gaps-292: dropped `allowedSetCategories` — the export states the list per power and
 * the converter emits it. Every copy in this layer restated that list, reordered it, or stated
 * `[]` where the generated layer's absence already means the same thing to `sets_for_power`.
 * Caltrops was one of the restatements until Brainstorm's export moved under it (data-gaps-291).
 */
import type { Power } from '@/types';

export const overrides: Partial<Power> = {};
