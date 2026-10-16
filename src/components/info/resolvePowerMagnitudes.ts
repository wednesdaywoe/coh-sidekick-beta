/**
 * Pure resolution of a power's granted buff/debuff magnitudes (PROD6B-2).
 *
 * This is the resolution half of `RegistryEffectsDisplay`, lifted out of the component so
 * it can be called without React. It answers "what rows does this power's effects bag
 * produce, and what are each row's three-tier numbers" — nothing about colors, grouping,
 * collapsing, or layout, which stay in the component.
 *
 * Two reasons it lives here rather than inline:
 *
 * 1. The engine now resolves the same rows (`coh_math`'s `granted.rs`, reading the shared
 *    `contract/effect-registry.json`). `powerProjectionParity.test.ts` diffs the engine's
 *    output against THIS function over all three forks' corpora — a gate that means
 *    something only because the component runs the same code path it grades.
 * 2. PROD6C-3 swaps the component onto the engine's projection. The shapes already match, and
 *    the inputs now partly do: the bag this resolves is one the surfaces BUILD at the render
 *    edge, and its power-only half is `buildDisplayEffects`, which the engine mirrors
 *    (PROD6C-3a). The transforms that still need build or UI state — the redirect / quick-snipe
 *    / conditional merge, per-target scaling, pseudo-pet effects — have to move into the engine
 *    before the call becomes a lookup; see the PROD6C-3 plan entry.
 *
 * The `getEffectBaseValue` / `calcEffectThreeTier` / mez-duration / knockback-distance
 * logic here was relocated unchanged, then corrected in one place: the mez / buff-debuff /
 * percent table reads used to be pinned to level 50 while the by-type and heal/absorb reads
 * used the build level. All of them now read the build level (PROD6B-2c — see
 * [`DEFAULT_TABLE_LEVEL`]).
 */
import type { NumberOrScaled, PowerEffects } from '@/types';
import { getScaleValue } from '@/types';
import { getPetTableValue, getTableValue } from '@/data/at-tables';
import {
  groupEffectsByCategory,
  isMezEffect,
  isByTypeObject,
  getByTypeAbbreviations,
  getByTypeFirstValue,
  type EffectDisplayConfig,
} from '@/data/core/effect-registry';
import { calculateBuffDebuffFraction } from '@/utils/calculations/buff-debuff';
import {
  calcThreeTier,
  calculateResistancePercent,
  expandByTypeEntries,
  expandProtectionEntries,
  type ThreeTierValues,
} from './powerDisplayUtils';

/**
 * What quantity a row's three-tier carries. A mez row shows a fixed magnitude beside an
 * enhanceable duration, so the two travel together.
 *
 * The four mez members are one decision, taken off the atom's `attribType` (data-gaps-167). That
 * field states which of the AttribMod's two numbers `scale × table` computes, and nothing
 * else on the row does: a Duration mez and a Magnitude mez are identical on effect type,
 * sub-type, sign, aspect, recipient and table, and differ only in what the product MEANS.
 * This used to be inferred from the table NAME — a `res_boolean` sniff — which was wrong in
 * both directions at once: it read every applied mez's duration as its magnitude, and read
 * every protection row off a `*_Ones` table as the def compiler's unscaled `Magnitude 1.0`
 * placeholder.
 *
 * `mez_expression`: valued by a stack-machine program rather than by its scale (Inner Will's
 * six break-free templates read whatever is mezzing you right now), so no static tier states
 * it. `mez_unstated`: the discriminator never reached the bag — a converter regression, not
 * a state the game has, which `mezAttribTypeStamped` fails on.
 *
 * `mez_constant`: `mod_Fill`'s `kModType_Constant` arm assigns the template's own magnitude
 * and duration straight across, so `scale x table` is the number that row DISCARDS. No mez
 * attrib carries one in any fork, and the engine's gate keeps it that way, so this member
 * exists to route the value rather than to render a number. It is declared here because the
 * engine declares it (data-gaps-50), not because the corpus reaches it.
 */
export type MagnitudeQuantity =
  | { kind: 'value' }
  | { kind: 'mez_duration'; magnitude: number }
  | { kind: 'mez_magnitude' }
  | { kind: 'mez_expression' }
  | { kind: 'mez_constant' }
  | { kind: 'mez_unstated' }
  | { kind: 'distance' };

export interface ResolvedMagnitude {
  /** Row key — the effect key, suffixed with the type for an expanded row. */
  rowKey: string;
  /** The registry key this row resolved through, un-suffixed. */
  effectKey: string;
  /** Registry config, with `format`/`label` overridden for the percent-form absorb row. */
  config: EffectDisplayConfig;
  /** Per-type row label, set only when the row came from an expansion. */
  expandedLabel?: string;
  /** The authored value this row resolved from. */
  rawValue: unknown;
  tiers: ThreeTierValues;
  quantity: MagnitudeQuantity;
  /** Abbreviated type summary for a COLLAPSED by-type row. */
  byTypeLabel?: string;
  /**
   * Which FACE a mez row wears (data-gaps-168), when the producer already knows.
   *
   * This resolver never sets it: the face is a fact about the POWER (does it affect a foe?)
   * and the resolver is handed a bag, not a power. Its consumer therefore keeps its own
   * `targetsAffected` sniff as the fallback. The engine, which has the power, resolves the
   * face into the row's `label` — so [`magnitudesFromProjection`] reads it back off that
   * label and states it here rather than re-deriving a verdict the engine already took.
   */
  mezFace?: 'protection' | 'self';
  /**
   * The effective duration in seconds, surfaced only on a MAGNITUDE-valued mez row
   * (data-gaps-330). The engine row carries it for every quantity a `durations` record exists
   * for; the tier on a `mez_duration` row already IS the seconds, so it stays unset there
   * and the surface never prints one number twice under two headings.
   */
  duration?: number;
}

export interface ResolveMagnitudesParams {
  effects: PowerEffects | undefined;
  archetypeId?: string;
  level?: number;
  /** This power's per-slot enhancement bonuses, keyed by aspect. */
  enhancementBonuses?: Record<string, number | undefined>;
  /** Build-wide globals, keyed by aspect (`convertGlobalBonusesToAspects`). */
  globalBonuses?: Record<string, number | undefined>;
  /**
   * Multiplier applied on the table-less fallback paths only. Always 1.0 in production: the
   * archetype-name rule that once supplied another value was measured dead and deleted
   * (PROD6B-2b). It stays a parameter because `supportModifierReach.test.ts` varies it to
   * detect which rows take those fallbacks, without reimplementing the resolution.
   */
  buffDebuffMod?: number;
}

/**
 * The level table reads assume when the caller supplies none. Every real call site passes
 * the build level.
 *
 * The game resolves a displayed magnitude at the character's level, never at a fixed one:
 * the client's own power-info window reads `class_GetNamedTableValue(pclass, table, iLevel)`
 * with `iLevel` set from `e->pchar->iLevel` / `iCombatLevel` at every entry point
 * (`uiPowerInfo.c` `modGetMagnitudeAndDuration`, `powerInfoSetLevel`), and the runtime uses
 * `iEffCombatLevel` (`attribmod.c` `mod_Fill`). ~70% of the AT tables vary across levels, so
 * a pinned read is a wrong number, not a stable one.
 */
const DEFAULT_TABLE_LEVEL = 50;

/**
 * Calculate three-tier values for an effect using its registry config. An effect with no
 * enhancement aspect is flat across all three tiers.
 */
function calcEffectThreeTier(
  config: EffectDisplayConfig,
  baseValue: number,
  enhancementBonuses: Record<string, number | undefined>,
  globalBonuses: Record<string, number | undefined>
): ThreeTierValues {
  const aspect = config.enhancementAspect;
  if (!aspect) return { base: baseValue, enhanced: baseValue, final: baseValue };
  return calcThreeTier(
    aspect,
    baseValue,
    enhancementBonuses,
    globalBonuses,
    config.strengthAspect ?? aspect
  );
}

/**
 * The `scale x table` terms a value carries when its pet rows named more than one AT table
 * (or one table under more than one pet class), instead of the single pair it cannot honestly
 * state. `synthesizePseudoPetEffects` writes it; see `mergePetContributions` for why.
 */
type ScaleTerm = { scale: number; table: string; petClass?: string };
function scaleTermsOf(value: unknown): ScaleTerm[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const terms = (value as { scaleTerms?: unknown }).scaleTerms;
  return Array.isArray(terms) ? (terms as ScaleTerm[]) : undefined;
}

/**
 * One `scale x table` term resolved into a number, against the class the term itself names.
 *
 * `class_GetNamedTableValue(pclass, name, level)` takes a class as well as a table name, and a
 * pseudo-pet's rows are a second character's — Choking Cloud's gas resolves against
 * `minion_pets`, not against the Controller who dropped it, and the two tables differ (data-gaps-105).
 * A term with no class is the power's own row (or an inline pseudo-pet shell with no
 * `villaindef.bin` record at all) and resolves against the build's archetype, as before.
 */
function termValue(term: ScaleTerm, archetypeId: string | undefined, level: number): number | undefined {
  if (term.petClass !== undefined) return getPetTableValue(term.petClass, term.table, level);
  return archetypeId ? getTableValue(archetypeId, term.table, level) : undefined;
}

/** `scale × table` for a single term, against the class the term itself names. */
function tableProduct(value: unknown, archetypeId: string | undefined, level: number): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('table' in value) || !('scale' in value)) return undefined;
  const term = value as ScaleTerm;
  const tableVal = termValue(term, archetypeId, level);
  return tableVal === undefined ? undefined : term.scale * tableVal;
}

/**
 * Get the base value from an effect: the one pair it states, or the several terms it carries.
 *
 * A `scaleTerms` value resolves each term through its OWN table and sums the resolved
 * MAGNITUDES, not the scales — the only order in which they are addable. The game computes
 * every AttribMod's magnitude as `scale × table[class][level]` at the template's own table, and
 * where it reduces several templates to one number it accumulates the resolved magnitudes.
 * Adding the scales first is the operation the game performs nowhere, and it is data-gaps-103;
 * summing the signed products first is the same mistake one step later, and it cancels rather
 * than adds — Ice Elemental's `rechargeDebuff` states `0.1` on `Melee_Ones` (+1) beside `0.2` on
 * `Ranged_Slow` (−1), two debuff contributions whose tables carry opposite signs, and `|0.1 −
 * 0.2| = 10%` where the pet really lowers recharge by 30%.
 *
 * A term that resolves to nothing contributes nothing, exactly as a lone unresolvable value
 * produces no row.
 */
function getEffectBaseValue(
  value: unknown,
  config: EffectDisplayConfig,
  buffDebuffMod: number,
  archetypeId?: string,
  level?: number
): number | null {
  // A by-type value the config does not expand collapses to its first entry, and that entry can
  // itself carry terms, so the collapse happens here rather than inside `termBaseValue` — a term
  // is never a by-type object, and reading the terms off the uncollapsed object would find none.
  if (config.canBeByType && isByTypeObject(value)) {
    const firstVal = getByTypeFirstValue(value as Record<string, unknown>);
    if (!firstVal) return null;
    value = firstVal;
  }
  const terms = scaleTermsOf(value);
  if (!terms) return termBaseValue(value, config, buffDebuffMod, archetypeId, level);
  const resolved = terms
    .map((term) => termBaseValue(term, config, buffDebuffMod, archetypeId, level))
    .filter((v): v is number => v !== null);
  return resolved.length > 0 ? resolved.reduce((a, b) => a + b, 0) : null;
}

/** Whether a value declares that the caster's Strength never reaches it. */
function ignoresStrength(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && (value as { ignoreStrength?: unknown }).ignoreStrength === true;
}

/**
 * The authored entry a row's BASE was actually read from.
 *
 * A `canBeByType` key the config does not expand (`slow`, `damageDebuff`) collapses to its
 * FIRST entry — `getEffectBaseValue` does the same — so the row shows one axis's number under
 * a summary label like `-Speed (FlyJmpHJmpRun)`. Any per-value mark has to follow that same
 * entry; the outer object carries none.
 */
function collapsedSource(value: unknown, config: EffectDisplayConfig): unknown {
  if (config.canBeByType && isByTypeObject(value)) {
    return getByTypeFirstValue(value as Record<string, unknown>) ?? value;
  }
  return value;
}

/**
 * One `scale × table` term's displayable base quantity, handling the different value types.
 * Never receives a by-type object or a `scaleTerms` value — `getEffectBaseValue` unwraps both.
 */
function termBaseValue(
  value: unknown,
  config: EffectDisplayConfig,
  buffDebuffMod: number,
  archetypeId?: string,
  level?: number
): number | null {
  // Handle mez effects (magnitude)
  if (config.format === 'mag') {
    if (typeof value === 'number') return value;
    if (isMezEffect(value)) {
      // A mez states ONE resolved number either way — `|scale × table|`, in seconds when the
      // atom says Duration and in magnitude points when it says Magnitude. What the flat
      // `mag` beside it means depends on the same field, so it is never the value here: on a
      // Duration row it is the rank the mez grabs, and on a Magnitude row it is the def
      // compiler's unscaled 1.0. Expression-valued and unstated rows have no resolvable base
      // at all; the row is built from the quantity alone.
      if (value.attribType !== 'Duration' && value.attribType !== 'Magnitude') return null;
      // Through `tableProduct`, so a merged pseudo-pet row resolves against the class it names
      // rather than the summoner's — Choking Cloud's gas is a second character (data-gaps-105).
      const product = tableProduct(value, archetypeId, level ?? DEFAULT_TABLE_LEVEL);
      return product === undefined ? null : Math.abs(product);
    }
    // ScaledEffect without mag (knockback, knockup, repel) — resolve via table when available
    {
      const product = tableProduct(value, archetypeId, level ?? DEFAULT_TABLE_LEVEL);
      if (product !== undefined) return Math.abs(product);
    }
    const scaled = getScaleValue(value as NumberOrScaled);
    if (scaled !== undefined) return scaled;
    return null;
  }

  // Handle buff/debuff calculation - returns decimal, multiply by 100 for percent display
  if (config.calculation === 'buff' || config.calculation === 'debuff') {
    const scaled = value as NumberOrScaled;
    const scaleNum = typeof scaled === 'number'
      ? scaled
      : (scaled && typeof scaled === 'object' && 'scale' in scaled
          ? (scaled as { scale: number }).scale
          : undefined);
    // Effects flagged as flat-percent-per-scale (e.g. maxHPBuff at 10%/scale)
    // intentionally ignore the AT-table reference: the game stores a heal-table
    // ref for bookkeeping but applies a fixed multiplier. See effect-registry.ts.
    if (config.flatPercentPerScale !== undefined && scaleNum !== undefined) {
      return Math.abs(scaleNum * config.flatPercentPerScale);
    }
    // Use AT table directly when available (accurate per-AT values)
    {
      const product = tableProduct(scaled, archetypeId, level ?? DEFAULT_TABLE_LEVEL);
      if (product !== undefined) return Math.abs(product) * 100;
    }
    // Fallback to legacy formula for plain number scales
    const result = calculateBuffDebuffFraction(scaled, buffDebuffMod, config.calculation);
    return result * 100;
  }

  // Handle scaled values
  const scaled = getScaleValue(value as NumberOrScaled);
  if (scaled === undefined) return null;

  // For percent format, multiply by baseMultiplier (default 100)
  // Accuracy uses 75 (base to-hit rate), other percents use 100
  if (config.format === 'percent') {
    // Use AT table directly when available (accurate per-AT values)
    const product = tableProduct(value, archetypeId, level ?? DEFAULT_TABLE_LEVEL);
    if (product !== undefined) return Math.abs(product) * 100;
    const multiplier = config.baseMultiplier ?? 100;
    return scaled * multiplier * buffDebuffMod;
  }

  // Heal / absorb resolve their scale through the table into an HP amount.
  if (config.valueFromTable) {
    const product = tableProduct(value, archetypeId, level ?? DEFAULT_TABLE_LEVEL);
    if (product !== undefined) return product;
  }

  return scaled;
}

/**
 * `*_Ones` tables (Melee_Ones, Ranged_Ones) are constant 1.0 across all ATs and levels —
 * they signal "scale is a % of target Max HP", not an HP value to scale through a Heal
 * table. Rebirth's Spirit Ward rework is the canonical case: scale 0.10 × Ranged_Ones means
 * 10% of the target's Max HP, NOT 0.10 HP.
 *
 * The recovered `maxHPFraction` form (Wild Bastion 0.25 = 25% of the caster's current Max
 * HP, from an Expression magnitude) says the same thing outright.
 */
function maxHPFractionPercent(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fraction = (value as { maxHPFraction?: number }).maxHPFraction;
  if (fraction != null) return fraction * 100;
  const table = (value as { table?: string }).table?.toLowerCase() ?? '';
  if (!table.endsWith('_ones')) return undefined;
  const scale = (value as { scale?: number }).scale;
  if (scale == null) return undefined;
  return scale * 100;
}

/**
 * Classify a `mag`-format effect off the discriminator the atom carries: a mez states its own
 * `attribType`, and a `{ scale, table }` with no `mag` at all is a distance.
 *
 * A pure function of the value and its registry config — no table read. The classification
 * used to depend on one (`tableVal > 0` stood in for "this is a duration"), which made the
 * row's unit hostage to whether the AT happened to carry the table.
 */
function classifyMagQuantity(value: unknown, config: EffectDisplayConfig): MagnitudeQuantity {
  if (config.format !== 'mag') return { kind: 'value' };
  if (isMezEffect(value)) {
    switch (value.attribType) {
      case 'Duration': return { kind: 'mez_duration', magnitude: value.mag };
      case 'Magnitude': return { kind: 'mez_magnitude' };
      case 'Expression': return { kind: 'mez_expression' };
      case 'Constant': return { kind: 'mez_constant' };
      default: return { kind: 'mez_unstated' };
    }
  }
  if (typeof value === 'object' && value !== null && 'scale' in value && 'table' in value) {
    return { kind: 'distance' };
  }
  return { kind: 'value' };
}

/**
 * Resolve every registered effect in a power's effects bag into a row's worth of
 * already-resolved numbers. Unregistered keys (the bag also carries `durations`,
 * `maxStacks`, … bookkeeping) and zero-valued effects produce no row.
 *
 * Rows come back UNFILTERED and UNSORTED: which categories to show, which execution stats
 * the caller owns, and how rows group and order are the component's business.
 */
export function resolvePowerMagnitudes({
  effects,
  archetypeId,
  level,
  enhancementBonuses = {},
  globalBonuses = {},
  buffDebuffMod = 1.0,
}: ResolveMagnitudesParams): ResolvedMagnitude[] {
  if (!effects) return [];

  const rows: ResolvedMagnitude[] = [];
  const push = (row: ResolvedMagnitude) => rows.push(row);

  for (const group of groupEffectsByCategory(effects as Record<string, unknown>)) {
    for (const { key, effectKey, value, config, fromSplitSlot } of group.effects) {
      // Handle expandByType effects (defense, resistance, elusivity, protection).
      // A split slot never expands: no split family ships a by-type half today, and
      // an expansion would read each entry's own (absent) mark instead of the slot's.
      if (!fromSplitSlot && config.expandByType && typeof value === 'object' && value !== null) {
        // Protection: expand mez magnitudes, never enhanceable
        if (config.format === 'mag') {
          for (const entry of expandProtectionEntries(value as Record<string, number>, config.label)) {
            push({
              rowKey: `${key}_${entry.typeKey}`,
              effectKey,
              config,
              expandedLabel: entry.typeLabel,
              rawValue: entry.magnitude,
              tiers: { base: entry.magnitude, enhanced: entry.magnitude, final: entry.magnitude },
              quantity: { kind: 'value' },
            });
          }
          continue;
        }

        // Defense, resistance, elusivity: expand by damage/defense type
        if (isByTypeObject(value)) {
          for (const entry of expandByTypeEntries(value as Record<string, unknown>, config.label, archetypeId, level)) {
            if (entry.basePercent === 0) continue;
            push({
              rowKey: `${key}_${entry.typeKey}`,
              effectKey,
              config,
              expandedLabel: entry.typeLabel,
              rawValue: entry.basePercent,
              tiers: calcEffectThreeTier(config, entry.basePercent, enhancementBonuses, globalBonuses),
              quantity: { kind: 'value' },
            });
          }
          continue;
        }

        // Scalar value on an effect that resolves through the table-base percent path.
        if (config.scalarFromTablePercent) {
          const pct = calculateResistancePercent(value as NumberOrScaled, archetypeId, level) * 100;
          if (pct === 0) continue;
          push({
            rowKey: `${key}__all`,
            effectKey,
            config,
            expandedLabel: config.label,
            rawValue: value,
            tiers: { base: pct, enhanced: pct, final: pct },
            quantity: { kind: 'value' },
          });
          continue;
        }
        // Otherwise fall through to the generic path.
      }

      // An effect authored as a fraction of Max HP reports a percent, not an amount — and
      // may carry ONLY a `maxHPFraction`, with no scale for the generic path to read.
      const percentForm = config.maxHpFractionPercentForm ? maxHPFractionPercent(value) : undefined;
      const rowConfig: EffectDisplayConfig = percentForm !== undefined
        ? { ...config, label: `${config.label} (% Max HP)`, format: 'percent' }
        : config;

      const quantity = classifyMagQuantity(value, config);
      // A row whose value the data does not state still gets a row. It carries no number —
      // the surface says so in words — because the alternatives are both worse: a fabricated
      // one is the soft-wrong data-gaps-167 was filed for, and dropping the row is the silent
      // omission data-gaps-101 measured, where a power's card simply lacked an effect the game shows.
      if (quantity.kind === 'mez_expression'
        || quantity.kind === 'mez_constant'
        || quantity.kind === 'mez_unstated') {
        push({
          rowKey: key,
          effectKey,
          config,
          rawValue: value,
          tiers: { base: 0, enhanced: 0, final: 0 },
          quantity,
        });
        continue;
      }

      const baseValue = percentForm !== undefined
        ? percentForm
        : getEffectBaseValue(value, config, buffDebuffMod, archetypeId, level);
      if (baseValue === null || baseValue === 0) continue;

      // A mez and a knockback's distance are scaled by the bonus named by the EFFECT key (a
      // hold reads the `hold` bonus), not by the config's enhancement aspect — which
      // `mag`-format effects do not declare. The coupling holds for both mez quantities: the
      // server applies Strength at the mod's own attrib offset before deciding which number
      // the product becomes (`attribmod.c` `mod_Fill`), so a Magnitude mez takes it on the
      // magnitude exactly as a Duration one takes it on the seconds.
      //
      // A split slot takes neither: the slot NAME is the IgnoreStrength mark, so the
      // row is flat at every tier (data-gaps-101). A value carrying the mark on itself is the
      // same verdict spelled the other way (data-gaps-99), and it is read off the entry the
      // BASE was read from: a `canBeByType` key the config does not expand collapses to
      // its first entry, and the outer object never carries a mark, so asking it
      // reported Ice Arrow's part-marked slow as wholly enhanceable.
      const unenhanceable = fromSplitSlot || ignoresStrength(collapsedSource(value, config));
      const tiers = unenhanceable
        ? { base: baseValue, enhanced: baseValue, final: baseValue }
        : quantity.kind === 'value'
          ? calcEffectThreeTier(rowConfig, baseValue, enhancementBonuses, globalBonuses)
          : calcThreeTier(effectKey, baseValue, enhancementBonuses, globalBonuses);

      push({
        rowKey: key,
        effectKey,
        config: rowConfig,
        rawValue: value,
        tiers,
        quantity,
        byTypeLabel: config.canBeByType && isByTypeObject(value)
          ? getByTypeAbbreviations(value as Record<string, unknown>)
          : undefined,
      });
    }
  }

  return rows;
}
