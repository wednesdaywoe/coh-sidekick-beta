/**
 * Player-facing vocabulary for a pet's computed effects.
 *
 * The calc layer names effects with the internal discriminators it needs
 * (`SelfMezResistance`, `ResistanceDebuff`), and a raw scale × table product is
 * a bare fraction. Both are correct and neither is readable: "SelfResistance
 * 0.21" tells a player nothing, where "Resist (Smash/Leth) +21%" is the stat
 * they already know from the in-game info window.
 *
 * Two rules this module exists to hold:
 *
 *  1. **A number needs its sub-types.** "+5%" is not a stat; "+5% Ranged
 *     defense" is. `PetEffect` has always carried `resistanceTypes` /
 *     `defenseTypes` / `mezTypes` / `debuffTypes`; nothing displayed them.
 *
 *  2. **The pet's own defenses are not things it does to you.** A summon is a
 *     second character (COH-DATA-MODEL §6), so its resistance and mez protection
 *     belong in a different list from the -Defense it lands on enemies. Flattened
 *     into one column they read as a single undifferentiated pile.
 */

import type { PetEffectComputed } from '@/utils/calculations/pet-damage';

/** The part of an effect that names it — shared by the raw `PetEffect` on an
 *  ability and the `PetEffectComputed` in an aggregated list, so a label reads
 *  the same wherever it is drawn. */
export interface PetEffectSubtyped {
  type: string;
  defenseTypes?: readonly string[];
  resistanceTypes?: readonly string[];
  mezTypes?: readonly string[];
  debuffTypes?: readonly string[];
}

/** Effect type display info. */
export const EFFECT_DISPLAY: Record<string, { label: string; color: string }> = {
  Heal: { label: 'Heal', color: 'text-green-400' },
  Sleep: { label: 'Sleep', color: 'text-purple-400' },
  Hold: { label: 'Hold', color: 'text-purple-400' },
  Stun: { label: 'Stun', color: 'text-purple-400' },
  Fear: { label: 'Fear', color: 'text-purple-400' },
  Confuse: { label: 'Confuse', color: 'text-purple-400' },
  Immobilize: { label: 'Immobilize', color: 'text-purple-400' },
  Knockback: { label: 'Knockback', color: 'text-cyan-400' },
  Knockup: { label: 'Knockup', color: 'text-cyan-400' },
  Taunt: { label: 'Taunt', color: 'text-yellow-400' },
  EndDrain: { label: '-End', color: 'text-blue-400' },
  RecoveryDebuff: { label: '-Recovery', color: 'text-blue-400' },
  ToHitDebuff: { label: '-ToHit', color: 'text-orange-400' },
  DefenseDebuff: { label: '-Defense', color: 'text-orange-400' },
  ResistanceDebuff: { label: '-Resistance', color: 'text-orange-400' },
  DamageDebuff: { label: '-Damage', color: 'text-orange-400' },
  RechargeDebuff: { label: '-Recharge', color: 'text-teal-400' },
  Slow: { label: '-Speed', color: 'text-teal-400' },
  // Ally-facing pseudo-pet field buffs / protection (EMP Field, Faraday Cage).
  ResistanceBuff: { label: '+Resistance', color: 'text-green-400' },
  // Buff-pet auras (Force Field Generator, Barrier Reef, Triage Beacon) — the
  // persistent AoE buffs a summoned buff drone projects onto the team.
  DefenseBuff: { label: '+Defense', color: 'text-green-400' },
  Absorb: { label: 'Absorb', color: 'text-green-400' },
  RegenBuff: { label: '+Regen', color: 'text-green-400' },
  RecoveryBuff: { label: '+Recovery', color: 'text-green-400' },
  ToHitBuff: { label: '+ToHit', color: 'text-green-400' },
  RechargeBuff: { label: '+Recharge', color: 'text-green-400' },
  HoldProtection: { label: 'Hold Protection', color: 'text-sky-400' },
  StunProtection: { label: 'Stun Protection', color: 'text-sky-400' },
  SleepProtection: { label: 'Sleep Protection', color: 'text-sky-400' },
  ImmobilizeProtection: { label: 'Immob Protection', color: 'text-sky-400' },
  FearProtection: { label: 'Fear Protection', color: 'text-sky-400' },
  ConfuseProtection: { label: 'Confuse Protection', color: 'text-sky-400' },
  KnockbackProtection: { label: 'KB Protection', color: 'text-sky-400' },
  KnockupProtection: { label: 'KB Protection', color: 'text-sky-400' },
  EndDrainResist: { label: 'End Drain Resist', color: 'text-sky-400' },
  RecoveryDebuffResist: { label: '-Recovery Resist', color: 'text-sky-400' },
  RegenDebuffResist: { label: '-Regen Resist', color: 'text-sky-400' },
  RechargeDebuffResist: { label: '-Recharge Resist', color: 'text-sky-400' },
  // The mez RESISTANCE faces — a shorter mez, as against the PROTECTION faces above,
  // which are a magnitude the mez has to exceed at all. Two different mechanics that a
  // shared label would run together.
  HoldResist: { label: 'Hold Resist', color: 'text-sky-400' },
  StunResist: { label: 'Stun Resist', color: 'text-sky-400' },
  SleepResist: { label: 'Sleep Resist', color: 'text-sky-400' },
  ImmobilizeResist: { label: 'Immob Resist', color: 'text-sky-400' },
  FearResist: { label: 'Fear Resist', color: 'text-sky-400' },
  ConfuseResist: { label: 'Confuse Resist', color: 'text-sky-400' },
  KnockbackResist: { label: 'KB Resist', color: 'text-sky-400' },
  KnockupResist: { label: 'KB Resist', color: 'text-sky-400' },
  TauntResist: { label: 'Taunt Resist', color: 'text-sky-400' },
  ToHitDebuffResist: { label: '-ToHit Resist', color: 'text-sky-400' },
  DefenseDebuffResist: { label: '-Defense Resist', color: 'text-sky-400' },
  HealResist: { label: 'Heal Resist', color: 'text-sky-400' },
  // The three the data-gaps-98/data-gaps-104 vocabulary added on the applied side.
  RegenDebuff: { label: '-Regen', color: 'text-orange-400' },
  MovementCapDebuff: { label: '-Speed Cap', color: 'text-teal-400' },
  DamageBuff: { label: '+Damage', color: 'text-green-400' },
  EnduranceGain: { label: '+End', color: 'text-blue-400' },
  // The pet's OWN defensive profile (target: Self templates). These describe the
  // summon's stat sheet, not anything it applies to a target — see SELF_EFFECTS.
  SelfResistance: { label: 'Resist', color: 'text-orange-300' },
  SelfDefense: { label: 'Defense', color: 'text-purple-300' },
  SelfMezProtection: { label: 'Protection', color: 'text-sky-400' },
  SelfMezResistance: { label: 'Mez Resist', color: 'text-sky-400' },
  SelfDebuffResistance: { label: 'Debuff Resist', color: 'text-sky-400' },
};

/**
 * The pet's own character stats, as opposed to what it does to a target.
 *
 * Everything else in a pet's effect list happens to somebody else — an enemy it
 * debuffs, an ally its aura buffs. These are the summon's own armour, and mixing
 * the two is most of why the list reads as noise: a Soldier's "+21% Smashing
 * resistance" and its "-3.8% Defense" on enemies are opposite-facing facts
 * printed identically.
 */
export const SELF_EFFECTS = new Set([
  'SelfResistance', 'SelfDefense', 'SelfMezProtection', 'SelfMezResistance',
  'SelfDebuffResistance',
]);

export function isSelfEffect(eff: { type: string }): boolean {
  return SELF_EFFECTS.has(eff.type);
}

// Pet/pseudo-pet effects whose computed `value` is a fraction → show as a percent
// (the label already carries the sign for debuffs, e.g. "-ToHit 5%"). Everything
// else shows its calculated magnitude: mez as "mag N (Ns)", KB/-end/heal as the raw value.
const PERCENT_PET_EFFECTS = new Set([
  'RechargeDebuff', 'Slow', 'ToHitDebuff', 'DefenseDebuff', 'ResistanceDebuff', 'DamageDebuff', 'RecoveryDebuff',
  'ResistanceBuff',
  // Buff-pet aura percentages (Absorb is shown as raw HP points, not a percent).
  'DefenseBuff', 'RegenBuff', 'RecoveryBuff', 'ToHitBuff', 'RechargeBuff',
  // Ally debuff resistances from a summoned field render as a resistance percent.
  'EndDrainResist', 'RecoveryDebuffResist', 'RegenDebuffResist', 'RechargeDebuffResist',
]);

// The pet's own percentage stats, rendered with an explicit + / − sign. Unlike a
// debuff — whose label already says "-ToHit" — "Resist (Eng)" is the same label
// whether the pet resists energy or is vulnerable to it, so for SelfResistance
// the sign has to live in the number. SelfDefense joins it for symmetry (the
// two sit side by side in the same block and read as a pair).
const SIGNED_PERCENT_PET_EFFECTS = new Set(['SelfResistance', 'SelfDefense']);
// The two self stats the converter gates on `scale > 0`, so they can never be
// negative and a "+" would be decoration rather than information.
const PLAIN_PERCENT_SELF_EFFECTS = new Set(['SelfMezResistance', 'SelfDebuffResistance']);

const MEZ_PET_EFFECTS = new Set(['Stun', 'Hold', 'Sleep', 'Fear', 'Confuse', 'Immobilize']);
// Mez/knock protection — a protection MAGNITUDE (value = scale × table), shown as
// "Mag N". Covers both the ally-facing field version (Faraday Cage) and the pet's
// own (`SelfMezProtection`).
const PROTECTION_PET_EFFECTS = new Set([
  'HoldProtection', 'StunProtection', 'SleepProtection', 'ImmobilizeProtection',
  'FearProtection', 'ConfuseProtection', 'KnockbackProtection', 'KnockupProtection',
  'SelfMezProtection',
]);

/** Compact damage-type names, matching the ones used in the damage breakdown. */
const SUBTYPE_LABEL: Record<string, string> = {
  smashing: 'Smash', lethal: 'Leth', fire: 'Fire', cold: 'Cold',
  energy: 'Eng', negative: 'Neg', psionic: 'Psi', toxic: 'Tox',
  melee: 'Melee', ranged: 'Ranged', aoe: 'AoE',
  // Debuff-resistance keys (SELF_DEBUFF_RES_ATTRIBS in the converter).
  runSpeed: 'Run', jumpSpeed: 'Jump', flySpeed: 'Fly', recharge: 'Recharge',
  heal: 'Heal', maxHP: 'Max HP', recovery: 'Recovery', endurance: 'End',
  toHit: 'ToHit',
};

/** Damage resistance covers eight types; defense covers those plus the three
 *  positions. A list naming every one of them is "All" — spelling out eleven
 *  abbreviations is a wall the reader has to parse to learn nothing. */
const ALL_DAMAGE_TYPES = 8;
const ALL_DEFENSE_VECTORS = 11;
const POSITIONS = ['melee', 'ranged', 'aoe'];

/**
 * The sub-types an effect covers, e.g. "Smash/Leth" or "Ranged".
 *
 * Returns '' when the effect carries none, which is the honest answer for the
 * scalar effects (Taunt, -End) and for synthesized pseudo-pets, whose templates
 * never went through the villain-def classifier that produces these lists.
 */
export function petEffectSubtypes(eff: PetEffectSubtyped): string {
  const list = eff.resistanceTypes ?? eff.defenseTypes ?? eff.mezTypes ?? eff.debuffTypes;
  if (!list || list.length === 0) return '';
  if (eff.resistanceTypes && list.length >= ALL_DAMAGE_TYPES) return 'All';
  if (eff.defenseTypes) {
    if (list.length >= ALL_DEFENSE_VECTORS) return 'All';
    // Positional defense is the axis most builds are actually played on, so
    // name it as one thing rather than three.
    if (list.length === POSITIONS.length && POSITIONS.every((p) => list.includes(p))) {
      return 'All Positions';
    }
    if (list.length >= ALL_DAMAGE_TYPES && !list.some((t) => POSITIONS.includes(t))) {
      return 'All Types';
    }
  }
  return list.map((t) => SUBTYPE_LABEL[t] ?? t).join('/');
}

/** "Resist (Smash/Leth)" — the label a player reads, sub-types included. */
export function petEffectLabel(eff: PetEffectSubtyped): string {
  const base = EFFECT_DISPLAY[eff.type]?.label ?? eff.type;
  const sub = petEffectSubtypes(eff);
  return sub ? `${base} (${sub})` : base;
}

/**
 * A negative self-resistance is a vulnerability, not armour — the converter
 * preserves that sign deliberately (`extractSelfBuff`) and it must not read as a
 * buff. `value` is the computed signed product; `scale` is the raw signed input,
 * so this reads the same on an aggregated effect and on an ability's own template.
 */
export function petEffectColor(eff: PetEffectSubtyped & { value?: number; scale?: number }): string {
  if (eff.type === 'SelfResistance' && (eff.value ?? eff.scale ?? 0) < 0) return 'text-red-400';
  return EFFECT_DISPLAY[eff.type]?.color ?? 'text-slate-300';
}

/**
 * Format a computed pet effect value — percentages for the percentage stats,
 * "Mag N" for protection, mag + duration for applied mez, raw points for the
 * rest. Replaces showing the bare table × scale fraction (e.g. 0.05), which read
 * as a meaningless modifier.
 */
export function formatPetEffectValue(eff: PetEffectComputed): string {
  const { type, value, magnitude } = eff;
  if (SIGNED_PERCENT_PET_EFFECTS.has(type)) {
    if (value === undefined) return '—';
    const pct = value * 100;
    const digits = Math.abs(pct) < 10 ? 1 : 0;
    return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(digits)}%`;
  }
  if (PERCENT_PET_EFFECTS.has(type) || PLAIN_PERCENT_SELF_EFFECTS.has(type)) {
    if (value === undefined) return '—';
    // Mez resistance shortens the mez; at 100% it is already gone, so anything
    // at or beyond that is immunity. The untauntable pets carry this as a
    // literal 10000% marker, which printed as a percentage reads as a bug.
    if (PLAIN_PERCENT_SELF_EFFECTS.has(type) && value >= 1) return 'Immune';
    const pct = value * 100;
    return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
  }
  if (MEZ_PET_EFFECTS.has(type)) {
    const mag = magnitude !== undefined ? `mag ${magnitude}` : '';
    const dur = value !== undefined && value > 0 ? ` ${value.toFixed(1)}s` : '';
    return (mag + dur).trim() || '—';
  }
  if (PROTECTION_PET_EFFECTS.has(type)) {
    // Protection magnitude = scale × table (the resolved `value`), not a duration.
    // Most are whole numbers (mag 4 Placate); a trailing ".0" on every one of
    // them is noise, so only show a decimal when there is one.
    if (value === undefined) return '—';
    return `Mag ${Number.isInteger(value) ? value : value.toFixed(1)}`;
  }
  // Knockback / Knockup / Taunt / EndDrain / Heal: the computed value/points.
  if (value !== undefined) return value.toFixed(2);
  if (magnitude !== undefined) return `mag ${magnitude}`;
  return '—';
}

/** "Resist (Smash/Leth) +21%" — one self-contained line. */
export function formatPetEffect(eff: PetEffectComputed): string {
  return `${petEffectLabel(eff)} ${formatPetEffectValue(eff)}`;
}

/**
 * Split a pet's effects into what it IS and what it DOES, preserving order
 * within each. Both lists can be empty.
 */
export function partitionPetEffects(effects: PetEffectComputed[]): {
  self: PetEffectComputed[];
  applied: PetEffectComputed[];
} {
  const self: PetEffectComputed[] = [];
  const applied: PetEffectComputed[] = [];
  for (const eff of effects) (isSelfEffect(eff) ? self : applied).push(eff);
  return { self, applied };
}

/**
 * True when an ability is the pet's stat sheet rather than something it does.
 *
 * An always-on power that deals no damage and whose every effect lands on the
 * pet itself IS the pet's defensive profile — the Soldier's `Resistance`, the
 * `Equip` that replaces it, the `Tactical_Upgrade` that adds ranged defence.
 * Listing those beside its attacks reads as three more things the henchman
 * does, when their entire content is already shown under "Its own defenses".
 *
 * Deliberately narrow. A passive that touches anybody else (the Demon Prince's
 * Chilling Embrace) is an aura the pet projects and stays on the list; so does
 * a click self-buff, which is a choice the pet makes rather than a standing
 * stat.
 */
export function isPetStatCarrier(ability: {
  type: string;
  damage: readonly unknown[];
  effects?: readonly PetEffectSubtyped[];
}): boolean {
  if (ability.type !== 'Auto') return false;
  if (ability.damage.length > 0) return false;
  const effects = ability.effects ?? [];
  return effects.length > 0 && effects.every(isSelfEffect);
}

/** Internal effect-area enum → the spelling the game uses. */
const EFFECT_AREA_LABEL: Record<string, string> = {
  SingleTarget: 'Single Target',
  Character: 'Self',
  Sphere: 'Sphere',
  Cone: 'Cone',
  Location: 'Location',
  Box: 'Box',
};

export function formatEffectArea(area: string): string {
  return EFFECT_AREA_LABEL[area] ?? area.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Pseudo-pet summon durations at or above this are the data's "permanent" sentinel (99999s) —
 *  a persistent pet with no bounded lifespan on the wire. Real patches last seconds to a
 *  minute, well under this. */
export const PERMANENT_PSEUDOPET_DURATION = 1000;

/**
 * A summon's lifetime, as every surface should print it.
 *
 * The sentinel rendered verbatim reads as a number somebody forgot to fix rather than as "this
 * henchman stays until it dies". Shared because three surfaces print this fact and they did not
 * agree: the InfoPanel's pet block formatted it, the picker tooltip printed `({duration}s)` raw
 * and so showed `99999s`, and `buildDisplayEffects` backfilled it into the `buffDuration` slot,
 * where it collided with the engine's own answer for that key (PROD6B-BETA-PARITY class 2).
 */
export function formatSummonDuration(duration?: number): string {
  if (!duration || duration >= PERMANENT_PSEUDOPET_DURATION) return 'permanent';
  return `${duration}s`;
}
