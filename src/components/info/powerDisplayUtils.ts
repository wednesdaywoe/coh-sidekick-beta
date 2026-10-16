/**
 * Shared utility functions and constants for power display components.
 * Used by both PowerInfoTooltip and InfoPanel to avoid code duplication.
 */

import type {
  ArchetypeId,
  ConditionalEffect,
  DefenseByType,
  ResistanceByType,
  MovementByType,
  NumberOrScaled,
  Power,
  PowerEffects,
  ScaledDamageEntry,
  SelectedPower,
} from '@/types';
import type { CharacterGlobalBonuses } from '@/utils/calculations';
import { getTableValue } from '@/data/at-tables';
import { getArchetype } from '@/data/archetypes';

// ============================================
// ARCHETYPE CAPS (sourced from archetypes.ts)
// ============================================

export function getDamageCap(archetypeId: string): number {
  return getArchetype(archetypeId as ArchetypeId)?.stats.damageCap ?? 4.0;
}

export function getDefenseCap(archetypeId: string): number {
  return getArchetype(archetypeId as ArchetypeId)?.stats.defenseCap ?? 0.45;
}

export function getResistanceCap(archetypeId: string): number {
  return getArchetype(archetypeId as ArchetypeId)?.stats.resistanceCap ?? 0.75;
}

// ============================================
// TABLE BASE VALUES
// These are the base percentages per scale point from AT tables
// ============================================
export const TABLE_BASE_VALUES: Record<string, number> = {
  // Resistance tables (10% per scale)
  'melee_res_dmg': 0.10,
  'ranged_res_dmg': 0.10,
  'melee_debuff_res_dmg': 0.10,
  'ranged_debuff_res_dmg': 0.10,
  // Defense tables (varies, but typically around 2-3% per scale for buffs)
  'melee_buff_def': 0.02,
  'ranged_buff_def': 0.02,
  'melee_debuff_def': 0.05,
  'ranged_debuff_def': 0.05,
  // Slow/Movement tables
  'ranged_slow': 0.10,
  'melee_slow': 0.10,
  // Default fallback
  'default': 0.10,
};

export type EffectCategory = 'buff' | 'debuff';

/**
 * Get the base value for a table name.
 * If archetype and level are provided, uses AT-specific tables first.
 */
export function getTableBaseValue(tableName: string | undefined, archetype?: string, level?: number): number {
  if (!tableName) return TABLE_BASE_VALUES['default'];
  const key = tableName.toLowerCase();

  // "Ones" tables (Melee_Ones, Ranged_Ones) are constant 1.0 for all ATs
  if (key.endsWith('_ones')) return 1.0;

  // Try AT-specific table first
  if (archetype) {
    const atValue = getTableValue(archetype, key, level ?? 50);
    if (atValue !== undefined) return atValue;
  }

  return TABLE_BASE_VALUES[key] ?? TABLE_BASE_VALUES['default'];
}

/**
 * Calculate the final percentage value for a resistance/defense effect
 * Formula: scale × table_base_value (AT-specific when archetype provided)
 */
export function calculateResistancePercent(effect: NumberOrScaled | undefined, archetype?: string, level?: number): number {
  if (!effect) return 0;
  if (typeof effect === 'number') return effect;
  const baseValue = getTableBaseValue(effect.table, archetype, level);
  return effect.scale * baseValue;
}

/**
 * Check if all values in an array are approximately the same
 */
export function allValuesSame(values: number[]): boolean {
  if (values.length === 0) return true;
  const first = values[0];
  return values.every(v => Math.abs(v - first) < 0.001);
}

/**
 * Check if an effect value is a "by-type" object (DefenseByType, ResistanceByType, MovementByType)
 * vs a simple NumberOrScaled value
 */
export function isByTypeObject(value: NumberOrScaled | DefenseByType | ResistanceByType | MovementByType | undefined): value is DefenseByType | ResistanceByType | MovementByType {
  if (!value) return false;
  if (typeof value === 'number') return false;
  // ScaledEffect has 'scale' and 'table'
  if ('scale' in value && 'table' in value) return false;
  // Otherwise it's a ByType object with damage/defense type keys
  return true;
}

/**
 * Get the first/total value from a by-type object for simple display
 * Returns the first defined value, used when displaying a single summary value
 */
export function getByTypeFirstValue(byType: DefenseByType | ResistanceByType | MovementByType): NumberOrScaled | undefined {
  // Defense/Resistance type keys
  const defResKeys = ['smashing', 'lethal', 'fire', 'cold', 'energy', 'negative', 'psionic', 'toxic', 'melee', 'ranged', 'aoe'];
  // Movement type keys
  const movementKeys = ['runSpeed', 'flySpeed', 'jumpHeight', 'jumpSpeed', 'fly', 'movementControl', 'movementFriction'];
  const allKeys = [...defResKeys, ...movementKeys];
  for (const key of allKeys) {
    if ((byType as Record<string, NumberOrScaled | undefined>)[key] !== undefined) {
      return (byType as Record<string, NumberOrScaled | undefined>)[key];
    }
  }
  return undefined;
}

/**
 * Format a decimal value as a percentage string
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Type labels for damage/defense/resistance types (short form)
 */
export const TYPE_LABELS_SHORT: Record<string, string> = {
  smashing: 'S', lethal: 'L', fire: 'F', cold: 'C',
  energy: 'E', negative: 'N', psionic: 'P', toxic: 'T',
  melee: 'Mel', ranged: 'Rng', aoe: 'AoE',
};

/**
 * Type labels for damage/defense/resistance types (full form)
 */
export const TYPE_LABELS_FULL: Record<string, string> = {
  smashing: 'Smash', lethal: 'Lethal', fire: 'Fire', cold: 'Cold',
  energy: 'Energy', negative: 'Neg', psionic: 'Psi', toxic: 'Toxic',
  melee: 'Melee', ranged: 'Ranged', aoe: 'AoE', all: 'All',
  // Movement speed types (used by slow effects)
  runSpeed: 'Run', flySpeed: 'Fly', jumpSpeed: 'Jump', jumpHeight: 'Jump Height',
  // Debuff resistance stat types
  defense: 'Defense', endurance: 'End', tohit: 'ToHit',
  movement: 'Slow', regeneration: 'Regen', recovery: 'Recovery',
  recharge: 'Recharge', perception: 'Percep',
  // Resistance subtypes
  heal: 'Heal',
  // Mez types (for -Special/+Special display)
  hold: 'Hold', stun: 'Stun', immobilize: 'Immob',
  sleep: 'Sleep', confuse: 'Confuse', fear: 'Fear',
  knockback: 'KB', knockup: 'KU', repel: 'Repel',
};

/**
 * Movement type labels
 */
export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  runSpeed: 'Run Speed', flySpeed: 'Fly Speed',
  jumpSpeed: 'Jump Speed', jumpHeight: 'Jump Height',
  fly: 'Flight', movementControl: 'Move Control', movementFriction: 'Friction',
};

/**
 * Three-tier calculation result
 */
export interface ThreeTierValues {
  base: number;
  enhanced: number;
  final: number;
}

/**
 * Calculate three-tier stats (Base/Enhanced/Final) for key values.
 *
 * This is the single source of truth for three-tier math. All display
 * components (InfoPanel, PowerInfoTooltip, SharedPowerComponents)
 * should delegate to this function rather than implementing their own formulas.
 *
 * Formulas by aspect type:
 * - Reductions (endurance, recharge): base / (1 + bonus) — lower is better
 * - Multiplicative (everything else): base * (1 + bonus) — higher is better
 *
 * `strengthAspect` splits the two lookups where one boost enhances several attribs: the
 * slotted bonus is keyed by `aspect`, the build-wide global and +Strength by `strengthAspect`.
 * Defaults to `aspect`, which is every effect but absorb.
 */
export function calcThreeTier(
  aspect: string,
  baseValue: number,
  enhancementBonuses: Record<string, number | undefined>,
  globalBonuses: Record<string, number | undefined>,
  strengthAspect: string = aspect
): ThreeTierValues {
  const enhBonus = enhancementBonuses[aspect] || 0;
  const globalBonus = globalBonuses[strengthAspect] || 0;

  let enhanced: number;
  let final: number;

  if (aspect === 'endurance' || aspect === 'recharge') {
    // Divisive reduction: base / (1 + bonus) — matches CoH game formula
    // Enhancement and global bonuses combine ADDITIVELY in one denominator
    enhanced = baseValue / Math.max(1, 1 + enhBonus);
    final = baseValue / Math.max(1, 1 + enhBonus + globalBonus);
  } else {
    // Strength multiplier: base * (1 + bonus) — matches CoH game formula
    // Enhancement and global bonuses combine ADDITIVELY in one multiplier
    enhanced = baseValue * (1 + enhBonus);
    final = baseValue * (1 + enhBonus + globalBonus);
  }

  return { base: baseValue, enhanced, final };
}

// ============================================
// GLOBAL BONUS CONVERSION
// ============================================

/**
 * Maps enhancement aspect keys to their corresponding CharacterGlobalBonuses field names.
 * Only aspects where a global bonus directly modifies a power's output are included.
 *
 * This is the single source of truth for bridging the dashboard's global stats
 * (percentage values, e.g. 50 = +50%) with the per-power three-tier calculation
 * (decimal multipliers, e.g. 0.5 = +50%).
 *
 * Add new entries here when the dashboard gains a global bonus that should affect
 * per-power calculations (e.g. a new global heal bonus).
 */
const GLOBAL_BONUS_ASPECT_MAP: [string, keyof CharacterGlobalBonuses][] = [
  ['damage', 'damage'],
  ['accuracy', 'accuracy'],
  ['recharge', 'recharge'],
  ['endurance', 'endurance'],
  ['range', 'range'],
  // NB `tohit` is deliberately absent. `globalBonuses.toHit` is the character's
  // ToHit TOTAL — the sum of every +ToHit buff running, Rage's own included — and
  // the only row that reads the `tohit` aspect is `tohitBuff`. Feeding the total in
  // as a strength multiplier made a ToHit buff enhance itself: two stacks of Rage
  // (+40% ToHit) displayed its own +ToHit row at 40 × 1.40. What actually scales a
  // ToHit buff is ToHit enhancement plus ToHit STRENGTH (Power Boost), which is the
  // `1 + enhBonuses.tohit + strengthBuffs.toHit` the dashboard totals use — so the
  // strength half arrives through `withStrengthBonuses` below instead.
  ['heal', 'healOther'],
  // Offensive mez/control duration → power effect keys (terror → 'fear').
  // Produces e.g. result['immobilize'] = immobilizeDuration / 100, which the
  // mez-duration rows in SharedPowerComponents read as a global multiplier.
  ['immobilize', 'immobilizeDuration'],
  ['hold', 'holdDuration'],
  ['stun', 'stunDuration'],
  ['sleep', 'sleepDuration'],
  ['confuse', 'confuseDuration'],
  ['fear', 'terrorDuration'],
];

/**
 * Convert CharacterGlobalBonuses (percentage values from the dashboard calculation)
 * to enhancement-aspect-keyed decimal multipliers for three-tier power display.
 *
 * Used by InfoPanel and PowerInfoTooltip to ensure consistent
 * global bonus application across all power display surfaces.
 */
export function convertGlobalBonusesToAspects(
  globalBonuses: CharacterGlobalBonuses
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [aspect, field] of GLOBAL_BONUS_ASPECT_MAP) {
    const value = globalBonuses[field];
    if (value) {
      result[aspect] = value / 100;
    }
  }
  return result;
}

/**
 * The mez effect keys a single `strengthMez` fraction feeds — the same six the
 * mez-duration rows read their global from (`GLOBAL_BONUS_ASPECT_MAP` above).
 */
const STRENGTH_MEZ_ASPECTS = ['immobilize', 'hold', 'stun', 'sleep', 'confuse', 'fear'];

/**
 * Augment aspect-keyed globals with the active +Strength self-buffs (Power Boost family).
 *
 * Strength is a non-ED multiplier on the caster's OWN matching output, so it lands in the
 * Final column exactly like a global bonus (`final = base × (1 + enh + global)`). Only
 * the families with no other global coupling are folded: defense, absorb and mez have no
 * entry in `GLOBAL_BONUS_ASPECT_MAP` at all, and heal-strength is genuinely additive with the
 * +Heal set bonus already there. Absorb is keyed apart from heal because the server reads
 * Strength at the mod's own attrib offset, and every +Heal set bonus targets `Heal_Dmg`
 * alone — the absorb rows reach `absorb` through the registry's `strengthAspect`.
 * Damage is deliberately left out: the family grants no damage strength, so folding it
 * would double-count against the +Damage global already in the map. ToHit used to be
 * left out too, on the reading that the dashboard totals "have already folded ToHit
 * strength into the field those rows read" — but that field is `toHit`, the character's
 * ToHit TOTAL, not a strength, and using a total as a multiplier is what made a +ToHit
 * buff scale by its own output. The map no longer carries `tohit`; the strength half
 * belongs here with the rest. The fields are stored as FRACTIONS by
 * `calculateCharacterTotals` (`collectStrengthBuffs`), so they add without the /100.
 *
 * The engine owns this rule (`granted.rs` `STRENGTH_ASPECTS`); this is its beta twin, kept
 * as the reference `powerProjectionParity.test.ts` grades the engine against.
 */
export function withStrengthBonuses(
  aspectBonuses: Record<string, number>,
  globalBonuses: CharacterGlobalBonuses
): Record<string, number> {
  const out: Record<string, number> = { ...aspectBonuses };
  const add = (aspect: string, value: number | undefined) => {
    if (value) out[aspect] = (out[aspect] || 0) + value;
  };
  add('defense', globalBonuses.strengthDefense);
  add('heal', globalBonuses.strengthHeal);
  add('absorb', globalBonuses.strengthAbsorb);
  add('tohit', globalBonuses.strengthToHit);
  for (const aspect of STRENGTH_MEZ_ASPECTS) add(aspect, globalBonuses.strengthMez);
  return out;
}

/**
 * Find a selected power in the build.
 *
 * **A power's identity is `(powerSet, internalName)` — never `internalName`
 * alone.** `internalName` is NOT globally unique and cannot be: CoH identity is
 * powerset + name, and HC freely reuses an internal slot name across powersets
 * when it reworks a power. Every dataset has ~23-28 REACHABLE collisions — two
 * different powers sharing one internal name that a single build can hold at
 * once:
 *
 *   [dominator] `Consume`        = Consume (secondary)   vs Melt Armor (epic)
 *   [dominator] `Fire_Blast`     = Fire Blast (secondary) vs Rain of Fire (epic)
 *   [blaster]   `Power_Boost`    = Power Boost (secondary) vs Summon Spiderlings (epic)
 *   [controller] `Invisibility`  = Superior Invisibility (primary) vs Infiltration (pool)
 *
 * The data is correct; the bug was here. Searching primary → secondary → pools →
 * epic on bare name returns whichever comes FIRST, so a Blaster with Energy
 * Manipulation + Mace Mastery (a common pairing) saw the wrong power's slots —
 * silently, since the build data itself stayed right.
 *
 * `powerSet` is REQUIRED rather than optional on purpose: every call site
 * already has it (they resolve the definition with `lookupPower(powerSet,
 * powerName)` on the neighbouring line), and an optional param would let the
 * same omission reappear the first time someone is in a hurry.
 */
export function findSelectedPowerInBuild(
  powerName: string,
  powerSet: string,
  build: {
    primary: { powers: SelectedPower[] };
    secondary: { powers: SelectedPower[] };
    pools: { powers: SelectedPower[] }[];
    epicPool?: { powers: SelectedPower[] } | null;
    inherents: SelectedPower[];
  }
): SelectedPower | null {
  const matches = (p: SelectedPower) =>
    p.internalName === powerName && p.powerSet === powerSet;

  const primary = build.primary.powers.find(matches);
  if (primary) return primary;
  const secondary = build.secondary.powers.find(matches);
  if (secondary) return secondary;
  for (const pool of build.pools) {
    const poolPower = pool.powers.find(matches);
    if (poolPower) return poolPower;
  }
  if (build.epicPool) {
    const epic = build.epicPool.powers.find(matches);
    if (epic) return epic;
  }
  // Check inherent powers
  const inherent = build.inherents.find(matches);
  if (inherent) return inherent;
  return null;
}

// ============================================
// BY-TYPE EXPANSION HELPERS
// ============================================

/**
 * Mez protection type labels for expanded protection rows
 */
const MEZ_LABELS: Record<string, string> = {
  stun: 'Stun', hold: 'Hold', immobilize: 'Immob',
  sleep: 'Sleep', confuse: 'Confuse', fear: 'Fear', knockback: 'KB',
};

/** Exported for the PROD6B-2 drift gate only — this vocabulary is shared with the engine via
 *  `contract/effect-registry.json`, so the gate must be able to read it. */
export const MEZ_LABELS_FOR_DRIFT_GATE = MEZ_LABELS;

/**
 * Expand a by-type object (DefenseByType, ResistanceByType, ElusivityByType)
 * into individual type entries with calculated percentage values.
 *
 * If all values are the same, returns a single summary entry with label "Def (All)".
 * Otherwise returns per-type entries like "Def: Smash", "Def: Lethal".
 */
export function expandByTypeEntries(
  obj: Record<string, unknown>,
  labelPrefix: string,
  archetype?: string,
  level?: number
): Array<{ typeKey: string; typeLabel: string; basePercent: number }> {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== 0);
  if (entries.length === 0) return [];

  const resolved = entries.map(([typeKey, value]) => ({
    typeKey,
    basePercent: calculateResistancePercent(value as NumberOrScaled, archetype, level) * 100,
  }));

  // When all types share the same value and cover all primary damage types, show a single "(All)" row
  const percentValues = resolved.map(r => r.basePercent);
  const ALL_PRIMARY_DAMAGE_TYPES = ['smashing', 'lethal', 'fire', 'cold', 'energy', 'negative', 'psionic', 'toxic'];
  const typeKeys = new Set(resolved.map(r => r.typeKey));
  const hasAllKey = typeKeys.has('all');
  const coversAllPrimary = hasAllKey || ALL_PRIMARY_DAMAGE_TYPES.every(t => typeKeys.has(t));
  if (allValuesSame(percentValues) && coversAllPrimary) {
    return [{
      typeKey: '_all',
      typeLabel: `${labelPrefix} (All)`,
      basePercent: resolved[0].basePercent,
    }];
  }

  return resolved.map(({ typeKey, basePercent }) => ({
    typeKey,
    typeLabel: `${labelPrefix}: ${TYPE_LABELS_FULL[typeKey] || typeKey}`,
    basePercent,
  }));
}

/**
 * Expand ProtectionEffects into individual mez type entries.
 * Returns entries like "Prot: Stun", "Prot: Hold" with magnitude values.
 */
export function expandProtectionEntries(
  protection: Record<string, number>,
  labelPrefix: string
): Array<{ typeKey: string; typeLabel: string; magnitude: number }> {
  const entries = Object.entries(protection).filter(([, v]) => v !== undefined && v !== 0);
  if (entries.length === 0) return [];

  return entries.map(([typeKey, value]) => ({
    typeKey,
    typeLabel: `${labelPrefix}: ${MEZ_LABELS[typeKey] || typeKey}`,
    magnitude: value,
  }));
}

// ============================================
// CONDITIONAL EFFECT MERGING
// ============================================

// `selectActiveConditionals`, `AT_INHERENT_CONDITIONAL_IDS`, and `ATInherentState`
// moved to `@/utils/conditional-effects` so the dashboard calc can select active
// conditionals without a backwards components→calc import. Re-exported here so
// existing importers (InfoPanel, MechanicAdjusters, SharedPowerComponents) are
// unaffected.
export {
  selectActiveConditionals,
  AT_INHERENT_CONDITIONAL_IDS,
} from '@/utils/conditional-effects';
export type { ATInherentState } from '@/utils/conditional-effects';

/**
 * Layer active conditional contributions on top of the base power's damage
 * and effects. Returns a new Power object suitable for downstream damage
 * calculation / effect rendering.
 *
 * Merging rules respect each conditional's `mode`:
 *
 * - **Damage** is always concatenated. Each active conditional's `damage`
 *   entries append to the base array. Calc downstream sums them up just
 *   like multi-component base damage (Charged Shot's Disintegration bonus
 *   stacks on top of base when toggled on).
 *
 * - **Effects** depend on `mode`:
 *   - `mode: 'replace'` (mutex with a base sibling): shallow-merge — the
 *     conditional's fields override base on shared keys. Suffocate's
 *     drowning -Def replaces base "if NOT drowning" -Def. Bio Armor's
 *     selected adaptation replaces baseline self-buffs.
 *   - `mode: 'additive'` (default — independent stacking): merge fields
 *     the base doesn't have, but **leave shared keys untouched**. Two
 *     simultaneous mez instances aren't displayed as one combined row
 *     yet, so we avoid replacing the base mez with a misleading single-
 *     instance "stronger" version. Suffocate's Stealthed hold doesn't
 *     bump the displayed hold duration; the additional hold cast is the
 *     intended game behavior, awaiting multi-instance display.
 */
/**
 * One simultaneous instance of an effect that the additive merger couldn't
 * fold into the displayed power because the base already has a value for
 * that key. The renderer surfaces these as extra rows under the matching
 * base row (e.g. "Hold Mag 3 (12.0s)" base row followed by
 * "+ Mag 3 (12.0s) (from Stealthed)" instance row).
 */
export interface ExtraInstance {
  /** The conditional's value for the colliding key (same shape as base). */
  value: unknown;
  /** Human-readable origin — the conditional's `label` (e.g. "Stealthed"). */
  sourceLabel: string;
  /** The originating conditional's `id`. Lets the renderer route AT-inherent
   *  collisions (e.g. `domination`) to their dedicated inline display instead
   *  of a generic "+ … (from …)" row. */
  conditionalId?: string;
}

export interface ApplyConditionalsResult {
  /** Merged power with damage/effects updated for `replace` mode and additive
   *  fills (keys not present in base). */
  power: Power;
  /** Additive collisions — keys where both base and conditional have values.
   *  Keyed by effect name (`hold`, `defenseDebuff`, etc.). The renderer
   *  shows each entry as a distinct row alongside the base. */
  extraInstances: Record<string, ExtraInstance[]>;
}

/**
 * Bag keys that are per-effect METADATA rather than effects in their own right.
 * A conditional carrying one of these has not added an effect the user can be
 * told about, and colliding on one is not a second simultaneous instance.
 * Shared by the merger and the contribution description so the two cannot drift.
 */
export const METADATA_EFFECT_KEYS: ReadonlySet<string> = new Set([
  'durations', 'buffDuration', 'effectDuration',
]);

export function applyActiveConditionals(
  power: Power,
  active: ConditionalEffect[],
): ApplyConditionalsResult {
  const extraInstances: Record<string, ExtraInstance[]> = {};
  if (active.length === 0) return { power, extraInstances };

  // --- damage ---
  // A base row names the toggles it's mutex with in `displacedBy` (the ones whose
  // predicate its own gate negates), so an active one takes its place rather than
  // stacking on top of it. Without this the two halves of a swap both showed:
  // Temporal Mending read 1.75 + 2.625 with Temporal Selection on, and Crushing
  // Uppercut read 3.18 + 3.339 at Combo Level 1 (backlog-2).
  //
  // Rows with no `displacedBy` are untouched however the conditional is tagged. Psi
  // Blade's Insight is `mode: 'replace'` off a negated gate on its GrantPower atom
  // while its own damage is a genuinely extra DoT, so swapping the array wholesale
  // would delete the base strike.
  const activeIds = new Set(active.map((c) => c.id));
  const baseDamageArr: ScaledDamageEntry[] = (power.damage
    ? Array.isArray(power.damage)
      ? [...power.damage]
      : [power.damage]
    : []
  ).filter((row) => !row.displacedBy?.some((id) => activeIds.has(id)));
  const merged: ScaledDamageEntry[] = baseDamageArr;
  for (const c of active) {
    if (!c.damage) continue;
    if (Array.isArray(c.damage)) merged.push(...c.damage);
    else merged.push(c.damage);
  }
  const nextDamage: Power['damage'] =
    merged.length === 0 ? undefined
      : merged.length === 1 ? merged[0]
        : merged;

  // --- effects ---
  let nextEffects: PowerEffects | undefined = power.effects ? { ...power.effects } : undefined;
  for (const c of active) {
    if (!c.effects) continue;
    if (c.mode === 'replace') {
      // Mutex with a base sibling — shallow-merge with conditional winning.
      nextEffects = nextEffects ? { ...nextEffects, ...c.effects } : { ...c.effects };
    } else {
      // Additive (default). For keys not present in base, fill in. For
      // colliding keys, record the conditional's value as an `extraInstance`
      // so the renderer can show it as a separate row — that's the multi-
      // instance case (two simultaneous Mag-3 holds, etc.). Replacing the
      // base value would misleadingly show a single "stronger" effect.
      if (!nextEffects) {
        nextEffects = { ...c.effects };
      } else {
        for (const [k, v] of Object.entries(c.effects)) {
          if (!(k in nextEffects)) {
            (nextEffects as Record<string, unknown>)[k] = v;
          } else if (!METADATA_EFFECT_KEYS.has(k)) {
            // `durations` is a metadata bag (per-effect duration overrides)
            // and the `*Duration` metadata fields aren't independent
            // instances — skip them as collision sources.
            (extraInstances[k] ??= []).push({ value: v, sourceLabel: c.label, conditionalId: c.id });
          }
        }
      }
    }
  }

  return {
    power: { ...power, damage: nextDamage, effects: nextEffects },
    extraInstances,
  };
}

/**
 * Describe what an active *additive* conditional would contribute on top of
 * the base power. Used by `MechanicAdjusters` to surface the existence of
 * collisions the merger silently drops (multi-instance mez display is a
 * separate workstream — until then, this annotation is the only hint the
 * user has that toggling a conditional with a collision actually does
 * something at the game level).
 *
 * `replace`-mode conditionals already overwrite base in the displayed
 * power, so they're excluded from the collision set.
 */
export interface AdjusterContribution {
  /** Effect keys present on the conditional but absent from base — these
   *  appear in the merged power after toggle-on. Surfacing them is mainly
   *  documentation; the main display already shows them. */
  newKeys: string[];
  /** Effect keys present on BOTH conditional and base — the additive merger
   *  leaves the base value untouched, so toggling on adds a second simul-
   *  taneous instance the planner doesn't render yet. The toggle row needs
   *  a "+" annotation so the user knows the conditional isn't a no-op. */
  collisionKeys: string[];
  /** Whether the conditional adds damage on top of base. Always tracked
   *  separately from effects since damage is always concatenated. */
  addsDamage: boolean;
}

export function describeAdjusterContribution(
  power: Power,
  c: ConditionalEffect,
): AdjusterContribution {
  const newKeys: string[] = [];
  const collisionKeys: string[] = [];
  if (c.mode !== 'replace' && c.effects) {
    const baseEffects = (power.effects ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(c.effects)) {
      // Per-effect metadata, not a primary effect — skip so we don't surface it
      // as a collision. This used to skip only `durations`, while the merger
      // above skipped all three, so the hint advertised an "extra Buff Duration
      // instance" that `applyActiveConditionals` never actually records (visible
      // on every Bio Armor stance row — screenshot 2026-07-26). Both now read the
      // same set, so the hint cannot claim a duplicate the merger dropped.
      if (METADATA_EFFECT_KEYS.has(k)) continue;
      if (k in baseEffects) collisionKeys.push(k);
      else newKeys.push(k);
    }
  }
  const addsDamage = !!c.damage && (Array.isArray(c.damage) ? c.damage.length > 0 : true);
  return { newKeys, collisionKeys, addsDamage };
}

/**
 * Title-case a camelCase or underscore-separated effect key. Used by the
 * MechanicAdjusters annotation rows.
 *
 *   `hold` → "Hold"
 *   `defenseDebuff` → "Defense Debuff"
 *   `damage_buff` → "Damage Buff"
 */
export function prettifyEffectKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}
