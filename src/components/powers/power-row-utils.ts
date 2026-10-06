/**
 * Shared utilities for power row rendering
 * Consolidates shouldShowToggle and hasHealingDamage
 * that were previously duplicated across multiple components.
 */

import {
  type AtomSource,
  absorbMaxHPFractionValue,
  absorbValue,
  baseAtoms,
  damageBuffValue,
  debuffResistanceValue,
  defenseBuffValue,
  enduranceDiscountValue,
  enduranceGainValue,
  isDebuffAtom,
  maxEndBuffValue,
  maxHPBuffValue,
  mezResistanceValue,
  perceptionBuffValue,
  rangeBuffValue,
  rechargeBuffValue,
  recoveryBuffValue,
  regenBuffValue,
  resistanceBuffValue,
  selfDamageDebuffValue,
  selfSlowValue,
  specialBuffValue,
  toHitBuffValue,
} from '@/data/core/atom-query';

/**
 * Check if a power has a Heal-type damage entry (one-shot heals/drains).
 * Powers like Dark Regeneration, Dull Pain, Life Drain have these.
 */
export function hasHealingDamage(power: { damage?: unknown }): boolean {
  if (!power.damage) return false;
  if (Array.isArray(power.damage)) {
    return power.damage.some((d: { type?: string }) => d.type === 'Heal');
  }
  return (power.damage as { type?: string }).type === 'Heal';
}

/**
 * Did the query find anything?
 *
 * Not the same as `!== undefined`. The by-type queries answer with a map and the movement
 * ones with an array, and both can come back EMPTY when the power carries atoms of that
 * family but none on the arm asked for — `selfSlowValue` returns `[]` for every foe attack
 * with a slow rider, which is most of them. Read as presence, that empty answer hands a
 * toggle to hundreds of attack powers that never had one.
 */
function answered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * The caster-facing buff questions, asked of the atoms.
 *
 * Each entry is the atom-native twin of one bag slot this predicate used to test with
 * `key in power.effects`. BPORT7 empties that object, at which point the old enumeration
 * would answer false for every click power that has a toggle and each one would lose it
 * silently — so the port lands here, while the bag is still populated and old-vs-new is
 * measurable on real data.
 *
 * It was measured: over 14,249 powers on all four datasets, in all three partitions, the
 * two predicates agree on 14,164. Every one of the 85 divergences is adjudicated in
 * `toggle-roster-atom-native.verify.test.ts`, and none of them is this list being narrower
 * than it should be.
 *
 * The enumeration was 35 keys; 21 survive here. The other 14 reached **no** click power that
 * could arrive at this predicate, and split three ways:
 *
 *  - **Ten names that only ever existed one level down.** `runSpeed`, `flySpeed`,
 *    `jumpHeight`, `jumpSpeed`, `fly`, `movementControl`, `movementFriction` live under
 *    `effects.movement` / `effects.slow`; `stealthPvE`, `stealthPvP`, `translucency` under
 *    `effects.stealth`. `key in effects` reads the top level, so the "Movement buffs" and
 *    "Stealth" clauses never matched a power — not at the strip, ever. The cast to
 *    `Record<string, unknown>` is what kept the type from saying so, and the four movement
 *    names ARE declared on `PowerEffects`, marked `@deprecated Use movement.X instead`.
 *  - **Two names with no referent at either depth** — `speedBuff` and `enduranceBuff`.
 *  - **Two that are real but unreachable here** — `defenseBuffSuppressible` and `threatBuff`
 *    appear on Toggle powers only, which return true above without consulting this
 *    predicate, and top-level `defense` was never emitted (the converter writes defense
 *    positions to `defenseBuff`).
 *
 * So dropping the 14 changes no power's answer, and the measurement above is the proof
 * rather than the claim. Restoring the movement and stealth intent would ADD powers, which
 * is a roster change and not this migration's to make.
 *
 * Ordered by how many click powers each reaches, so the common cases short-circuit first.
 */
const CASTER_BUFF_QUERIES: readonly ((power: AtomSource) => unknown)[] = [
  damageBuffValue,            // 1232
  toHitBuffValue,             // 767
  resistanceBuffValue,        // 553
  enduranceGainValue,         // 488
  debuffResistanceValue,      // 422
  defenseBuffValue,           // 348
  recoveryBuffValue,          // 345
  regenBuffValue,             // 282
  mezResistanceValue,         // 250
  rechargeBuffValue,          // 225
  maxHPBuffValue,             // 205
  absorbValue,                // 136
  enduranceDiscountValue,     // 97
  recoveryBuffUnenhanced,     // 82
  specialBuffValue,           // 76
  perceptionBuffValue,        // 73
  absorbMaxHPFractionValue,   // 69
  rangeBuffValue,             // 61
  tohitBuffUnenhanced,        // 48
  maxEndBuffValue,            // 31
  regenBuffUnenhanced,        // 26
];

/**
 * The three `*Unenhanced` bag slots were the one `ignoreStrength` axis re-minted as parallel
 * keys. The atom queries take it as an option, so the twin is the same function asked the
 * other way — not a second slot.
 */
function recoveryBuffUnenhanced(power: AtomSource) {
  return recoveryBuffValue(power, { ignoreStrength: true });
}
function regenBuffUnenhanced(power: AtomSource) {
  return regenBuffValue(power, { ignoreStrength: true });
}
function tohitBuffUnenhanced(power: AtomSource) {
  return toHitBuffValue(power, { ignoreStrength: true });
}

/**
 * The atom twin of `hasSelfDirectedPenalty` — a penalty the caster writes on himself
 * (Granite Armor's -damage/-recharge, the Kheldian Steps' self movement slow) is a real
 * caster effect, so such a click power gets a toggle.
 *
 * The bag predicate tested four `toWho:'Self'` debuff slots plus a nested `slow` map. Two of
 * them, `rechargeDebuff` and `accuracyDebuff`, carry no self-directed row anywhere in the
 * corpus; the other three do. `slow` is the only arm any power depends on ALONE — the
 * Kheldian Steps, Shadow Step, and the three Team Teleport copies this migration hands a
 * toggle BACK to — so it is the one whose loss would shrink the roster.
 *
 * ToHit has no `self*` query on the atom side, and is asked inline rather than by minting one
 * for a single call site: a base ToHit atom, aimed at the caster, on the debuff arm.
 */
function hasSelfDirectedAtomPenalty(power: AtomSource): boolean {
  if (answered(selfDamageDebuffValue(power))) return true;
  if (answered(selfSlowValue(power))) return true;
  return baseAtoms(power).some(
    (a) => a.effectType === 'ToHit' && a.toWho === 'Self' && isDebuffAtom(a),
  );
}

/** targetType values where the power cannot be cast on self — buffs go to allies only. */
const ALLY_ONLY_TARGETS = new Set(['ally', 'ally (alive)']);

function isDamagingAttack(power: { damage?: unknown }): boolean {
  // True when the power directly deals damage to enemies. The shared check
  // below uses this to skip the per-cast `damageBuff` field on attack
  // powers — that field encodes Defiance / Containment / Combo-Mastery
  // procs, not a persistent self-buff worth tracking via a toggle. Heal-
  // type damage entries (Dull Pain, Dark Regeneration) don't count as
  // attacks here.
  if (!power.damage) return false;
  const entries = Array.isArray(power.damage) ? power.damage : [power.damage];
  return entries.some((d) => {
    const entry = d as { type?: string; scale?: number };
    return entry?.type !== 'Heal' && (entry?.scale ?? 0) > 0;
  });
}

function hasPersistentBuffEffects(power: AtomSource & { damage?: unknown }): boolean {
  if (hasSelfDirectedAtomPenalty(power)) return true;
  // Damage attacks: damageBuff is a per-cast Defiance proc, and rangeBuff
  // is the Fast Snipe per-power range bump (gated on ≥22% ToHit buff in
  // game). Neither is a persistent caster buff worth toggling at the
  // build level — Fast Snipe state is the right knob for snipe damage/
  // range, not a generic active-power flag. Real persistent self-buffs
  // (resistance, defense, mez resistance, etc.) on the same power still
  // trigger the toggle.
  //
  // There is no `specialBuff` skip here, and its absence is deliberate. The bag path had to
  // drop the whole slot on a non-self-targeted power, because a legacy foe -Special debuff
  // (Benumb, Weaken, Time Stop) stored its magnitude as a POSITIVE `specialBuff` with nothing
  // on the slot to say whose strength it was. `specialBuffValue` asks `reachesCaster` of each
  // ATOM, so the recipient is answered a level down and a power-level skip on top of it is
  // inert — verified by mutation: removing it changes no power's answer.
  const attack = isDamagingAttack(power);
  return CASTER_BUFF_QUERIES.some((query) => {
    if (attack && (query === damageBuffValue || query === rangeBuffValue)) return false;
    return answered(query(power));
  });
}

/**
 * `targetsAffected` tokens naming only a defeated ally — never the living caster. A power whose
 * every recipient is one of these reaches the caster only through an atom aimed at `Self`
 * (Conduit of Pain's empowerment); without one, its buffs are the corpse's. HC Resurrect grew
 * recharge and absorb riders in Issue 28 Page 4, and those queries do not ask the recipient.
 */
const DEAD_ALLY_ONLY = new Set([
  'DeadPlayerFriend',
  'DeadFriend',
  'DeadLeaguemate',
  'DeadTeammate',
  'DeadMyPet',
]);

function affectsCaster(power: AtomSource & { targetType?: string }): boolean {
  if (power.targetType && ALLY_ONLY_TARGETS.has(power.targetType.toLowerCase())) return false;
  const affected = power.targetsAffected ?? [];
  if (affected.length > 0 && affected.every((t) => DEAD_ALLY_ONLY.has(t))) {
    return baseAtoms(power).some((a) => a.toWho === 'Self');
  }
  return true;
}

/**
 * Determine if a power should show a toggle switch for stat calculations.
 * - Toggle powers (always)
 * - Click powers with persistent buff effects that apply to the caster
 *   (Build Up, Aim, Hasten, Healing Flames, Vengeance, Granite Armor's self-penalty, etc.)
 * - Excluded: ally-only buffs (Speed Boost, Fortitude), one-shot damage/heal-only
 *   clicks (Inferno, Dark Regeneration), interruptible snipes (no persistent caster buff)
 */
export function shouldShowToggle(power: AtomSource & {
  powerType?: string;
  targetType?: string;
  shortHelp?: string;
  damage?: unknown;
}): boolean {
  const powerType = power.powerType?.toLowerCase();
  if (powerType === 'toggle') return true;
  if (powerType !== 'click') return false;
  if (!affectsCaster(power)) return false;
  return hasPersistentBuffEffects(power);
}
