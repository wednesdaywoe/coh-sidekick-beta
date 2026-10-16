/**
 * Shared React components for power display.
 * Used by both PowerInfoTooltip (compact) and InfoPanel (expanded).
 */

import { useState } from 'react';
import type { PowerEffects, SpecialEffect } from '@/types';
import type { ExtraInstance } from './powerDisplayUtils';
import { isScaledEffect } from '@/types';
import { AT_INHERENT_CONDITIONAL_IDS } from './powerDisplayUtils';
import {
  resolvePowerMagnitudes,
  type MagnitudeQuantity,
  type ResolvedMagnitude,
} from './resolvePowerMagnitudes';
import type { ThreeTierValues } from './powerDisplayUtils';
import { effectRowDuration, powerLevelDuration, type BagDurations } from './effectRowDuration';
import { abbreviateDamageType, type PowerDamageResult } from '@/utils/calculations';
import {
  CATEGORY_CONFIG,
  formatEffectValueForConfig,
  isMezEffect,
  type EffectCategory,
  type EffectDisplayConfig,
  type GroupedEffect,
} from '@/data/effect-registry';
import { getTableValue } from '@/data/at-tables';
import { Tooltip } from '@/components/ui/Tooltip';

// ============================================
// THREE-TIER DISPLAY COMPONENTS
// ============================================

interface ThreeTierHeaderProps {
  /** Use compact sizing for tooltips */
  compact?: boolean;
}

/**
 * Header row for three-tier stat display (Base/Enhanced/Final)
 */
export function ThreeTierHeader({ compact = false }: ThreeTierHeaderProps) {
  const gridCols = compact
    ? 'grid-cols-[4rem_1fr_1fr_1fr]'
    : 'grid-cols-[5rem_1fr_1fr_1fr]';
  const fontSize = compact ? 'text-[10px]' : 'text-[11px]';

  return (
    <div className={`grid ${gridCols} gap-1 ${fontSize} text-slate-400 uppercase mb-0.5 border-b border-slate-700 pb-0.5`}>
      <span>Stat</span>
      <span>Base</span>
      <span>{compact ? 'Enh' : 'Enhanced'}</span>
      <span>Final</span>
    </div>
  );
}

interface ThreeTierStatRowProps {
  label: string;
  base: number;
  enhanced: number;
  final: number;
  format?: 'number' | 'percent' | 'seconds' | 'feet';
  colorClass?: string;
  /** Use compact sizing for tooltips */
  compact?: boolean;
  /** Whether this stat can be enhanced. When true, always shows values; when false, shows "—" for Enhanced/Final */
  enhanceable?: boolean;
}

/**
 * Single row in a three-tier stat display.
 * Enhanceable stats always show values in all three columns (even when identical).
 * Non-enhanceable stats show "—" for Enhanced and Final.
 */
export function ThreeTierStatRow({
  label,
  base,
  enhanced,
  final,
  format = 'number',
  colorClass = 'text-slate-200',
  compact = false,
  enhanceable = true,
}: ThreeTierStatRowProps) {
  const formatValue = (v: number) => {
    switch (format) {
      case 'percent':
        return `${(v * 100).toFixed(2)}%`;
      case 'seconds':
        return `${v.toFixed(2)}s`;
      case 'feet':
        return `${v.toFixed(0)}ft`;
      default:
        return v.toFixed(2);
    }
  };

  const hasEnhancement = Math.abs(enhanced - base) > 0.001;
  const hasGlobal = Math.abs(final - enhanced) > 0.001;

  const gridCols = compact
    ? 'grid-cols-[4rem_1fr_1fr_1fr]'
    : 'grid-cols-[5rem_1fr_1fr_1fr]';
  const fontSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
      <span className={colorClass}>{label}</span>
      <span className="text-slate-200">{formatValue(base)}</span>
      {enhanceable ? (
        <span className={hasEnhancement ? 'text-green-400' : 'text-slate-300'}>
          {formatValue(enhanced)}
        </span>
      ) : (
        <span className="text-slate-500">—</span>
      )}
      {enhanceable ? (
        <span className={`font-semibold ${hasGlobal ? 'text-amber-400' : 'text-slate-300'}`}>
          {formatValue(final)}
        </span>
      ) : (
        <span className="text-slate-500">—</span>
      )}
    </div>
  );
}

// ============================================
// DAMAGE DISPLAY COMPONENTS
// ============================================

interface DamageThreeTierHeaderProps {
  finalColumnHeader?: string;
  compact?: boolean;
}

/**
 * Header for damage three-tier display with custom final column
 */
export function DamageThreeTierHeader({
  finalColumnHeader = 'Final',
  compact = false,
}: DamageThreeTierHeaderProps) {
  const fontSize = compact ? 'text-[10px]' : 'text-[11px]';
  const gridCols = compact
    ? 'grid-cols-[3rem_1fr_1fr_1fr]'
    : 'grid-cols-[4rem_1fr_1fr_1fr]';

  return (
    <div className={`grid ${gridCols} gap-1 ${fontSize} text-slate-400 uppercase mb-0.5 border-b border-slate-700 pb-0.5`}>
      <span>Type</span>
      <span>Base</span>
      <span>Enhanced</span>
      <span>{finalColumnHeader}</span>
    </div>
  );
}

interface DamageRowProps {
  type: string;
  base: number;
  enhanced: number;
  final: number;
  typeColorClass?: string;
  finalColorClass?: string;
  compact?: boolean;
  dimmed?: boolean;
}

/**
 * Single row in damage display.
 * Damage is always enhanceable — always shows values in all three columns.
 */
export function DamageRow({
  type,
  base,
  enhanced,
  final,
  typeColorClass = 'text-red-400',
  finalColorClass = 'text-amber-400',
  compact = false,
  dimmed = false,
}: DamageRowProps) {
  const hasEnh = Math.abs(enhanced - base) > 0.001;
  const hasGlobal = Math.abs(final - enhanced) > 0.001;

  const gridCols = compact
    ? 'grid-cols-[3rem_1fr_1fr_1fr]'
    : 'grid-cols-[4rem_1fr_1fr_1fr]';
  const fontSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div className={`grid ${gridCols} gap-1 items-baseline ${fontSize} ${dimmed ? 'opacity-40' : ''}`}>
      <span className={dimmed ? 'text-slate-400' : typeColorClass}>{type}</span>
      <span className={dimmed ? 'text-slate-400' : 'text-slate-200'}>{base.toFixed(1)}</span>
      <span className={dimmed ? 'text-slate-500' : (hasEnh ? 'text-green-400' : 'text-slate-300')}>
        {enhanced.toFixed(1)}
      </span>
      <span className={`font-semibold ${dimmed ? 'text-slate-500' : (hasGlobal ? finalColorClass : 'text-slate-300')}`}>
        {final.toFixed(1)}
      </span>
    </div>
  );
}

// ============================================
// COLLAPSIBLE EFFECT GROUP
// ============================================

/** Minimum number of expanded entries to trigger collapsible behavior */
const COLLAPSE_THRESHOLD = 2;

/** Large expanded groups (e.g. Power Boost's 22-entry "+Special" strength list)
 *  start collapsed so they don't flood the panel — the summary row still shows
 *  the value. Smaller groups (mez protection ~6, debuff resistance 7) stay open. */
const DEFAULT_COLLAPSED_AT = 8;

interface DisplayableEffect {
  effect: GroupedEffect;
  baseValue: number;
  tiers: ThreeTierValues;
  /** What {@link tiers} is a quantity OF, as `resolvePowerMagnitudes` classified it. The
   *  `mag`-format rows used to re-derive this here from the raw value's shape, which put a
   *  third copy of the mez rule in the render edge and got it wrong for every row whose
   *  `scale × table` is a magnitude rather than seconds (data-gaps-167). */
  quantity: MagnitudeQuantity;
  byTypeLabel?: string;
  expandedLabel?: string;
  /** The effective duration in seconds. Set on a MAGNITUDE-valued engine mez row (data-gaps-330);
   *  absent on a `mez_duration` row (tier IS the seconds) and on any resolver-built row.
   *  Rendered as `(8s)` beside the rank, replacing the pre-strip `durations`-map lookup. */
  duration?: number;
  /** The mez FACE, when the row's producer already took that verdict. Set on an engine row,
   *  absent on a resolved one; see [`isProtectionMez`]. */
  mezFace?: 'protection' | 'self';
  /** Dominator inherent bonus for this mez — the extra stacking mez the power's
   *  `domination` conditionalEffect grants while Domination is active (sourced
   *  from the matching `extraInstances` collision). Present only on powers that
   *  carry the tag; drives the "+mag while Domination active" inline display. */
  dominationBonus?: { mag: number; scale: number; table: string };
}

/** A group of effects that share the same base config from expandByType */
type EffectGroup = {
  type: 'single';
  item: DisplayableEffect;
} | {
  type: 'group';
  label: string;
  colorClass: string;
  items: DisplayableEffect[];
}

/** Collapsible wrapper for a group of expanded effects (e.g., 7 debuff resistance types) */
function CollapsibleEffectGroup({
  label,
  colorClass,
  items,
  gridCols,
  fontSize,
  dominationActive,
  finalColumnColor,
}: {
  label: string;
  colorClass: string;
  items: DisplayableEffect[];
  gridCols: string;
  fontSize: string;
  dominationActive: boolean;
  finalColumnColor: string;
}) {
  const [collapsed, setCollapsed] = useState(items.length >= DEFAULT_COLLAPSED_AT);

  // Check if all values are the same for a compact summary
  const allSameBase = items.every(i => Math.abs(i.tiers.base - items[0].tiers.base) < 0.01);
  const summaryValue = allSameBase ? items[0].tiers.base : null;

  // Precision is owned by each effect's registry config; see formatEffectValueForConfig.
  const formatValue = formatEffectValueForConfig;

  // For mixed values, show min-max range
  const minBase = Math.min(...items.map(i => i.tiers.base));
  const maxBase = Math.max(...items.map(i => i.tiers.base));

  return (
    <>
      {/* Clickable summary row */}
      <div
        role="button"
        aria-expanded={!collapsed}
        title={collapsed ? `Show all ${items.length} ${label} entries` : `Collapse ${label} list`}
        className={`grid ${gridCols} gap-1 items-baseline ${fontSize} cursor-pointer select-none hover:bg-slate-700/30 -mx-0.5 px-0.5 rounded`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={colorClass}>
          <span className={`inline-block text-[10px] mr-0.5 transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          {label} ({items.length})
        </span>
        {summaryValue !== null ? (
          <>
            <span className="text-slate-200">{formatValue(summaryValue, items[0].effect.config)}</span>
            <span className="text-slate-500">—</span>
            <span className="text-slate-500">—</span>
          </>
        ) : (
          <>
            <span className="text-slate-200">{formatValue(minBase, items[0].effect.config)} – {formatValue(maxBase, items[0].effect.config)}</span>
            <span className="text-slate-500">—</span>
            <span className="text-slate-500">—</span>
          </>
        )}
      </div>

      {/* Expanded entries */}
      {!collapsed && items.map(({ effect, tiers, expandedLabel: elabel, dominationBonus }) => {
        const { key, config } = effect;
        const enhanceable = !!config.enhancementAspect;
        const hasEnh = Math.abs(tiers.enhanced - tiers.base) > 0.001;
        const hasFinal = Math.abs(tiers.final - tiers.enhanced) > 0.001;
        // Strip the group-label prefix from child rows so we don't repeat
        // "Debuff Res:" / "Status Res:" / "Prot:" — the group header already
        // owns that label. `expandByTypeEntries` and `expandProtectionEntries`
        // emit labels like "Debuff Res: Recovery"; render children as just
        // "Recovery" when the prefix matches the parent group's label.
        const baseLabel = elabel || config.label;
        const itemLabel = elabel && elabel.startsWith(`${label}: `)
          ? elabel.slice(label.length + 2)
          : baseLabel;

        if (config.format === 'mag') {
          // Domination inherent: add this power's actual `Tag "Domination"` mez
          // bonus (data-driven, per-power) when Domination is active. Only powers
          // that carry the tag have `dominationBonus`; a control effect without
          // it (e.g. an epic hold) is correctly left unboosted.
          const dom = dominationActive ? dominationBonus : undefined;
          const rawMag = dom ? tiers.base + dom.mag : tiers.base;
          const magStr = Number.isInteger(rawMag) ? rawMag.toString() : rawMag.toFixed(1);
          const magColorClass = dom ? 'text-pink-400' : config.colorClass;
          return (
            <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize} ml-2`}>
              <span className={magColorClass}>{itemLabel}</span>
              <span className="text-slate-200">Mag {magStr}</span>
              <span className="text-slate-500">—</span>
              <span className="text-slate-500">—</span>
            </div>
          );
        }

        return (
          <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize} ml-2`}>
            <span className={config.colorClass}>{itemLabel}</span>
            <span className="text-slate-200">{formatValue(tiers.base, config)}</span>
            {enhanceable ? (
              <span className={hasEnh ? 'text-green-400' : 'text-slate-300'}>
                {formatValue(tiers.enhanced, config)}
              </span>
            ) : (
              <span className="text-slate-500">—</span>
            )}
            {enhanceable ? (
              <span className={hasFinal ? finalColumnColor : 'text-slate-300'}>
                {formatValue(tiers.final, config)}
              </span>
            ) : (
              <span className="text-slate-500">—</span>
            )}
          </div>
        );
      })}
    </>
  );
}

// User-facing sections for the Power Effects table — MEZ / BUFFS / DEBUFFS /
// SPECIAL. Multiple registry categories collapse into one section: protection
// + movement both fold into BUFFS so a player's defensive buffs and travel
// powers sit next to their offensive +DMG/+Rech buffs rather than under a
// half-empty "Protection" subhead.
//
// Headers stay neutral (slate-500) so they don't compete with the actual
// effect rows for attention; the row labels themselves carry the color
// information per the registry's per-effect colorClass.
type EffectSection = 'MEZ' | 'BUFFS' | 'DEBUFFS' | 'SPECIAL';
const SECTION_PRIORITY: Record<EffectSection, number> = {
  MEZ: 1, BUFFS: 2, DEBUFFS: 3, SPECIAL: 4,
};
const SECTION_COLOR_NEUTRAL = 'text-slate-400';

function sectionForCategory(cat: EffectCategory): EffectSection | null {
  switch (cat) {
    case 'control': return 'MEZ';
    case 'buff': case 'protection': case 'movement': return 'BUFFS';
    case 'debuff': return 'DEBUFFS';
    case 'special': return 'SPECIAL';
    default: return null;
  }
}

function sectionPriorityForCategory(cat: EffectCategory): number {
  const s = sectionForCategory(cat);
  return s ? SECTION_PRIORITY[s] : 99;
}

/**
 * Render an additive extra-instance row beneath the matching base effect.
 * Used by the SUFFOCATE-WITH-STEALTHED case: base hold Mag 3 / 12s + the
 * conditional hold Mag 3 / 12s render as two distinct rows so the user
 * can see the simultaneous instances. Format mirrors the base row but
 * dimmed and prefixed with `+` and suffixed with `(from <Source>)`.
 */
/**
 * Compact "unresistable" marker for HC's split-debuff twin rows. The full word
 * overflowed the fixed-width label column, so the second (unresistable) half is
 * now flagged with a small superscript-style asterisk carrying a hover/touch
 * tooltip instead. The trigger is focusable so it also surfaces on keyboard
 * focus and on touch (tap → focus).
 */
function UnresistableMark() {
  return (
    <Tooltip
      content="Unresistable — this half ignores the target's debuff resistance. Both halves apply."
      position="top"
      triggerClassName="inline-block align-baseline"
    >
      <span tabIndex={0} aria-label="unresistable" className="text-slate-400 cursor-help ml-0.5">*</span>
    </Tooltip>
  );
}

function renderExtraInstanceRow(params: {
  key: string;
  baseKey: string;
  baseConfig: EffectDisplayConfig | null;
  extra: ExtraInstance;
  gridCols: string;
  fontSize: string;
  archetypeId?: string;
  level?: number;
  effectDur?: number;
}): React.ReactNode {
  const { key, baseKey, baseConfig, extra, gridCols, fontSize, archetypeId, level, effectDur } = params;
  const value = extra.value;
  const labelPrefix = baseConfig?.label ?? prettyKeyFallback(baseKey);
  const sourceTag = (
    <span className="text-cyan-400/70 italic ml-1">(from {extra.sourceLabel})</span>
  );
  const colorClass = baseConfig?.colorClass ?? 'text-slate-300';
  const durationSuffix = effectDur != null
    ? <span className="text-slate-400 font-normal text-[11px] ml-0.5">({effectDur}s)</span>
    : null;

  // Mez (format='mag'): show "+ Mag X (Ys)" matching the base row's shape.
  if (baseConfig?.format === 'mag' && isMezEffect(value) && archetypeId && level) {
    const tableVal = getTableValue(archetypeId, value.table, level);
    const baseDuration = tableVal !== undefined ? Math.abs(value.scale * tableVal) : undefined;
    const magStr = Number.isInteger(value.mag) ? value.mag.toString() : value.mag.toFixed(1);
    return (
      <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
        <span className={colorClass}>+ {labelPrefix}{durationSuffix}</span>
        <span className="text-slate-300">
          Mag {magStr}{baseDuration != null ? ` (${baseDuration.toFixed(1)}s)` : ''}
          {sourceTag}
        </span>
        <span className="text-slate-500">—</span>
        <span className="text-slate-500">—</span>
      </div>
    );
  }

  // Percent-format effects (rechargeDebuff, damageDebuff, resistance, etc.):
  // resolve the scaled value through the AT table the same way the base row
  // does so the user sees "-8%" alongside "-40%" rather than a raw "0.08"
  // that looks like an unrelated number. Falls through to the raw-scale
  // fallback when we can't resolve the value cleanly.
  if (baseConfig?.format === 'percent' && typeof value === 'object' && value !== null && 'scale' in value && 'table' in value) {
    const v = value as { scale: number; table: string };
    let percent: number | null = null;
    if (archetypeId) {
      const tableVal = getTableValue(archetypeId, v.table, level ?? 50);
      if (tableVal !== undefined) {
        percent = Math.abs(v.scale * tableVal) * 100;
      }
    }
    if (percent === null) {
      // *_ones tables (Melee_Ones, Ranged_Ones, Ranged_Slow at 1.0) return 1.0;
      // matches the convention already in `getTableBaseValue`.
      percent = Math.abs(v.scale) * 100;
    }
    const signed = (baseConfig.calculation === 'debuff' ? '-' : '+') + percent.toFixed(2) + '%';
    return (
      <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
        <span className={colorClass}>+ {labelPrefix}{durationSuffix}</span>
        <span className="text-slate-300">
          {signed}
          {sourceTag}
        </span>
        <span className="text-slate-500">—</span>
        <span className="text-slate-500">—</span>
      </div>
    );
  }

  // Generic numeric / scaled fallback — render the raw value as a hint.
  // Buff/debuff additive collisions don't currently produce these in
  // practice (game-side those stack via the strength multiplier and the
  // base value already reflects that). Keep the fallback so unexpected
  // collisions still get surfaced rather than silently dropped.
  return (
    <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
      <span className={colorClass}>+ {labelPrefix}{durationSuffix}</span>
      <span className="text-slate-300">
        {summarizeExtraValue(value)}
        {sourceTag}
      </span>
      <span className="text-slate-500">—</span>
      <span className="text-slate-500">—</span>
    </div>
  );
}

function prettyKeyFallback(k: string): string {
  return k.replace(/_/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function summarizeExtraValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toFixed(2);
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'scale' in v) {
    const s = (v as { scale: unknown }).scale;
    return typeof s === 'number' ? s.toFixed(2) : String(s);
  }
  return '·';
}

function sectionForGroup(g: EffectGroup): EffectSection | null {
  const cat = g.type === 'group'
    ? g.items[0]?.effect.config.category
    : g.item.effect.config.category;
  return cat ? sectionForCategory(cat) : null;
}

/**
 * Group consecutive expanded effects that share the same config into collapsible groups.
 * Effects with expandedLabel from the same config become a group if there are >= COLLAPSE_THRESHOLD entries.
 */
function groupEffectsForDisplay(effects: DisplayableEffect[]): EffectGroup[] {
  const result: EffectGroup[] = [];
  let i = 0;

  while (i < effects.length) {
    const current = effects[i];

    // Check if this starts a group of expanded effects
    if (current.expandedLabel) {
      const config = current.effect.config;
      const groupItems: DisplayableEffect[] = [current];

      // Collect consecutive effects with the same config
      let j = i + 1;
      while (j < effects.length && effects[j].expandedLabel && effects[j].effect.config === config) {
        groupItems.push(effects[j]);
        j++;
      }

      if (groupItems.length >= COLLAPSE_THRESHOLD) {
        result.push({ type: 'group', label: config.label, colorClass: config.colorClass, items: groupItems });
      } else {
        // Too few to collapse, render individually
        for (const item of groupItems) {
          result.push({ type: 'single', item });
        }
      }
      i = j;
    } else {
      result.push({ type: 'single', item: current });
      i++;
    }
  }

  return result;
}

// ============================================
// REGISTRY-DRIVEN EFFECTS DISPLAY
// ============================================

interface RegistryEffectsDisplayProps {
  effects: PowerEffects;
  /** Allowed enhancement types for this power */
  allowedEnhancements?: string[];
  /** Enhancement bonuses by aspect */
  enhancementBonuses?: Record<string, number | undefined>;
  /** Global bonuses by aspect */
  globalBonuses?: Record<string, number | undefined>;
  /** Archetype ID for AT-specific table lookups (resistance, etc.) */
  archetypeId?: string;
  /** Character level for AT-specific table lookups */
  level?: number;
  /** Categories to include (default: execution, buff, debuff) */
  categories?: EffectCategory[];
  /** Whitelist of execution-category keys to render (e.g. ['accuracy',
   *  'enduranceCost', 'recharge']). When omitted, all execution effects
   *  in the included categories render. Lets the InfoPanel show only the
   *  three enhanceable stats here while a sibling block handles the rest. */
  executionKeys?: string[];
  /** Use compact sizing for tooltips */
  compact?: boolean;
  /** Whether Domination is active */
  dominationActive?: boolean;
  /** Optional header text (shown above the table) */
  header?: string;
  /** Optional duration to show in header */
  duration?: number;
  /** Calculated damage data (optional, includes dotDamage for DoT) */
  damage?: PowerDamageResult | null;
  /** Custom final column header (e.g., "w/ Scourge", "w/ Fury") */
  finalColumnHeader?: string;
  /** Color class for final column values (e.g., "text-cyan-400" for Scourge) */
  finalColumnColor?: string;
  /** Function to apply inherent bonus to damage values */
  applyInherentBonus?: (value: number) => number;
  /** Power-level proc / state-grant entries for the SPECIAL section
   *  ("+X% chance to grant <name> on target", "+Y% chance Knockback").
   *  Renders as plain rows under a SPECIAL subheader; not enhanceable. */
  specialEffects?: SpecialEffect[];
  /** Additive collisions captured by `applyActiveConditionals` — keyed by
   *  effect name (e.g. `hold`, `defenseDebuff`). Each entry is rendered as
   *  an extra row beneath the matching base row, so simultaneous instances
   *  (Suffocate's base Mag-3 hold + Stealthed Mag-3 hold) are both visible. */
  extraInstances?: Record<string, ExtraInstance[]>;
  /** Purple patch info for adjusting accuracy and damage final values */
  purplePatchInfo?: { factor: number; offset: number; toHitBonus?: number; combatModifier: number };
  /** The power's `targets_affected` — needed to read the mez FACE off the value's own
   *  protection spelling instead of sniffing table names (data-gaps-168). */
  targetsAffected?: string[];
  /**
   * Already-resolved rows, used INSTEAD of resolving `effects` here (data-gaps-329).
   *
   * A surface that holds an engine projection passes `magnitudesFromProjection(...)` and gets
   * the rows the engine resolved from the atom stream. A surface that does not keeps the
   * `effects` path, which resolves whatever the display bag still carries — and since
   * data-gaps-327 that is the keys `buildDisplayEffects` mints for itself, so a power whose effects
   * were authored on the wire renders nothing at all through it.
   *
   * The two row sources differ in one respect the render sites have to tolerate: an engine
   * row carries no `rawValue`, because no authored value stands behind it. Every consumer of
   * that field guards with `isMezEffect` / `isScaledEffect` and so declines rather than
   * breaking, which costs the `durationVariants` annotation and the Domination substitution
   * on an engine row. `effects` is still read for `durations` and the header, so a surviving
   * bag annotates its rows exactly as before.
   */
  rows?: ResolvedMagnitude[];
}

/** Get con-colored arrow symbol for target level offset (matches in-game con system) */
export function getConArrow(offset: number): { symbol: string; colorClass: string } | null {
  if (offset === 0) return null;
  if (offset <= -3) return { symbol: '\u25B2', colorClass: 'text-slate-300' };
  if (offset === -2) return { symbol: '\u25B2', colorClass: 'text-green-400' };
  if (offset === -1) return { symbol: '\u25B2', colorClass: 'text-blue-400' };
  if (offset === 1) return { symbol: '\u25BC', colorClass: 'text-yellow-400' };
  if (offset === 2) return { symbol: '\u25BC', colorClass: 'text-orange-400' };
  if (offset === 3) return { symbol: '\u25BC', colorClass: 'text-red-400' };
  return { symbol: '\u25BC', colorClass: 'text-purple-400' }; // +4, +5
}

/**
 * Registry-driven power effects display using three-tier table format.
 * Replaces hardcoded effect checks with registry-based rendering.
 */
export function RegistryEffectsDisplay({
  effects,
  allowedEnhancements = [],
  enhancementBonuses = {},
  globalBonuses = {},
  archetypeId,
  level,
  categories = ['execution', 'buff', 'debuff'],
  executionKeys,
  compact = false,
  dominationActive = false,
  header,
  duration: _duration,
  damage,
  finalColumnHeader = 'Final',
  finalColumnColor = 'text-amber-400',
  applyInherentBonus,
  purplePatchInfo,
  specialEffects,
  extraInstances,
  targetsAffected,
  rows,
}: RegistryEffectsDisplayProps) {
  const allowedSet = new Set(allowedEnhancements);

  // Per-effect durations for annotations
  const durations = effects?.durations as Record<string, number> | undefined;
  const buffDur = effects?.buffDuration as number | undefined;

  // The precedence lives in `effectRowDuration.ts` so it can be graded without a render
  // harness. Re-surfacing the duration is the only place users see "-Recharge lasts 15s" —
  // `buffDuration` is not rendered as a primary value and the `duration` prop is unused.
  const bagDurations: BagDurations = { durations, buffDuration: buffDur };
  const getEffectDuration = (effectKey: string, category?: string, rowDuration?: number) =>
    effectRowDuration({ effectKey, category, duration: rowDuration }, bagDurations);

  // Map enhancement type names to registry aspect names
  const enhancementToAspect: Record<string, string> = {
    'EnduranceReduction': 'endurance',
    'Recharge': 'recharge',
    'Accuracy': 'accuracy',
    'Range': 'range',
  };

  // Check if an execution effect should be shown (must be allowed enhancement)
  const executionKeysSet = executionKeys ? new Set(executionKeys) : null;
  const shouldShowExecutionEffect = (key: string, config: EffectDisplayConfig): boolean => {
    if (config.category !== 'execution') return true;

    // Honor the per-key whitelist when caller passes one (InfoPanel scopes this
    // section to accuracy/end/recharge/healing; sibling GeneralStatsBlock owns
    // the geometry stats). `healing` is execution-categorized but has no other
    // home — dropping it here removes the heal row from the panel entirely.
    if (executionKeysSet && !executionKeysSet.has(key)) return false;

    // Find the enhancement type that enables this effect
    const enhType = Object.entries(enhancementToAspect).find(([, aspect]) => aspect === config.enhancementAspect)?.[0];
    if (!enhType) return true; // Non-enhanceable execution stats (castTime, radius, etc.)

    // If the power has no allowed enhancements at all, show all execution stats (e.g., inherent powers)
    if (allowedSet.size === 0) return true;

    return allowedSet.has(enhType);
  };

  // Every row's numbers, already resolved. A caller holding an engine projection supplies
  // them; otherwise they resolve here from the display bag, and `resolvePowerMagnitudes` is
  // a module of its own so the engine's `granted.rs` can be graded against the code path
  // this component actually renders (PROD6B-2). Everything below is display policy.
  const resolved = rows ?? resolvePowerMagnitudes({
    effects,
    archetypeId,
    level,
    enhancementBonuses,
    globalBonuses,
  });

  const displayableEffects: DisplayableEffect[] = [];
  for (const row of resolved) {
    if (!categories.includes(row.config.category as EffectCategory)) continue;
    if (!shouldShowExecutionEffect(row.effectKey, row.config)) continue;

    // The Domination bonus for this mez rides in as an `extraInstances` collision from the
    // power's `domination` conditionalEffect (id 'domination'); surface it inline instead of
    // as a generic "+…" row.
    const domExtra = extraInstances?.[row.effectKey]?.find((e) => e.conditionalId === 'domination');
    const dominationBonus = domExtra && isMezEffect(domExtra.value) ? domExtra.value : undefined;

    displayableEffects.push({
      effect: { key: row.rowKey, effectKey: row.effectKey, value: row.rawValue, config: row.config },
      baseValue: row.tiers.base,
      tiers: row.tiers,
      quantity: row.quantity,
      byTypeLabel: row.byTypeLabel,
      expandedLabel: row.expandedLabel,
      mezFace: row.mezFace,
      duration: row.duration,
      dominationBonus,
    });
  }

  // Return null only if no effects AND no damage to display
  if (displayableEffects.length === 0 && !damage) return null;

  // Sort by user-facing section first (MEZ → BUFFS → DEBUFFS → SPECIAL),
  // then by registry category priority within the section, then by effect
  // priority. Prevents debuff effects from being interleaved between buff
  // and protection rows when those all collapse into the BUFFS section.
  displayableEffects.sort((a, b) => {
    const sectA = sectionPriorityForCategory(a.effect.config.category);
    const sectB = sectionPriorityForCategory(b.effect.config.category);
    if (sectA !== sectB) return sectA - sectB;
    const catA = CATEGORY_CONFIG[a.effect.config.category]?.priority ?? 99;
    const catB = CATEGORY_CONFIG[b.effect.config.category]?.priority ?? 99;
    if (catA !== catB) return catA - catB;
    return (a.effect.config.priority ?? 99) - (b.effect.config.priority ?? 99);
  });

  // Group mez protection effects (hold/stun/immobilize/sleep/confuse/fear) into a collapsible group
  // Also group knockback/knockup when they share the same magnitude
  const MEZ_PROT_KEYS = new Set(['hold', 'stun', 'immobilize', 'sleep', 'confuse', 'fear']);
  const KB_KEYS = new Set(['knockback', 'knockup']);
  const mezProtConfig: EffectDisplayConfig = {
    label: 'Status Prot',
    category: 'control',
    colorClass: 'text-pink-400',
    format: 'mag',
    priority: 1,
  };
  const kbConfig: EffectDisplayConfig = {
    label: 'KB Prot',
    category: 'control',
    colorClass: 'text-pink-400',
    format: 'mag',
    priority: 10,
  };

  // Distinguish mez PROTECTION from APPLIED mez. The FACE reads the same discriminator pair
  // the applier credits (data-gaps-168): the converter's protection spelling — negative scale,
  // data-gaps-52's first spelling, negative magnitude its second, an Expression-valued row — on a
  // power that affects no foe. The `res_boolean` table sniff this used to be was wrong in
  // both directions: every `*_Ones` armor (Bane/Crab/Wolf Spider, the SFC accolade) missed
  // the group, and a spelled foe control on a Res_Boolean table would have been kept. A bare
  // number is the protection magnitude as a different producer shapes it, and still is.
  const FOE_TARGETS = ['Foe', 'DeadFoe', 'DeadOrAliveFoe', 'Any'];
  const powerAffectsFoe = (targetsAffected ?? []).some((t) => FOE_TARGETS.includes(t));
  const isProtectionMez = (item: DisplayableEffect): boolean => {
    // An engine row already carries the verdict: `mez_face_label` took it from the same
    // spelling-plus-recipient pair, on the power rather than on a `targetsAffected` the
    // caller had to remember to pass. Sniffing it again off a `rawValue` that row does not
    // have would read every protection mez as applied control.
    if (item.mezFace) return item.mezFace === 'protection';
    const v = item.effect.value as
      | { scale?: number; mag?: number; attribType?: string }
      | number
      | undefined
      | null;
    if (typeof v === 'number') return true; // bare protection magnitude
    if (!v || typeof v !== 'object') return false;
    const spelled = (v.scale ?? 0) < 0 || (v.mag ?? 0) < 0 || v.attribType === 'Expression';
    return spelled && !powerAffectsFoe;
  };

  // Find and group consecutive mez protection effects
  const grouped: DisplayableEffect[] = [];
  let i = 0;
  while (i < displayableEffects.length) {
    const eff = displayableEffects[i];
    const rawKey = eff.effect.key;

    // Check for mez protection group
    if (MEZ_PROT_KEYS.has(rawKey) && eff.effect.config.format === 'mag' && isProtectionMez(eff)) {
      const groupItems: DisplayableEffect[] = [];
      let j = i;
      while (j < displayableEffects.length && MEZ_PROT_KEYS.has(displayableEffects[j].effect.key) && displayableEffects[j].effect.config.format === 'mag' && isProtectionMez(displayableEffects[j])) {
        groupItems.push(displayableEffects[j]);
        j++;
      }
      if (groupItems.length >= 2) {
        // Assign shared config and expandedLabel for collapsible grouping
        for (const item of groupItems) {
          grouped.push({
            ...item,
            effect: { ...item.effect, config: mezProtConfig },
            expandedLabel: item.effect.config.label,
          });
        }
      } else {
        grouped.push(...groupItems);
      }
      i = j;
      continue;
    }

    // Check for KB/KU group
    if (KB_KEYS.has(rawKey) && eff.effect.config.format === 'mag') {
      const groupItems: DisplayableEffect[] = [];
      let j = i;
      while (j < displayableEffects.length && KB_KEYS.has(displayableEffects[j].effect.key) && displayableEffects[j].effect.config.format === 'mag') {
        groupItems.push(displayableEffects[j]);
        j++;
      }
      if (groupItems.length >= 2) {
        for (const item of groupItems) {
          grouped.push({
            ...item,
            effect: { ...item.effect, config: kbConfig },
            expandedLabel: item.effect.config.label,
          });
        }
      } else {
        grouped.push(...groupItems);
      }
      i = j;
      continue;
    }

    grouped.push(eff);
    i++;
  }
  displayableEffects.length = 0;
  displayableEffects.push(...grouped);

  // Label column is wide enough for the longest stat label ("Max Targets")
  // so two-word labels never wrap to a second line and break row alignment.
  const gridCols = compact
    ? 'grid-cols-[5rem_1fr_1fr_1fr]'
    : 'grid-cols-[5.5rem_1fr_1fr_1fr]';
  const fontSize = compact ? 'text-xs' : 'text-sm';
  const headerFontSize = compact ? 'text-[10px]' : 'text-[11px]';

  // Power-level duration, surfaced as its own row instead of being stamped onto
  // every effect label as a "(Ns)" parenthetical — that repeated the same value
  // down the column and pushed the label past its fixed track.
  const hasTimedEffect = displayableEffects.some((e) => e.effect.config.category !== 'execution');
  const powerDuration = powerLevelDuration(
    displayableEffects.map((e) => ({
      effectKey: e.effect.key,
      category: e.effect.config.category,
      duration: e.duration,
    })),
    bagDurations,
  );

  return (
    <div>
      {/* Section header if provided */}
      {header && (
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
          {header}
        </h4>
      )}
      <div className="bg-slate-800/50 rounded p-2">
        {/* Table header */}
        <div className={`grid ${gridCols} gap-1 ${headerFontSize} text-slate-400 uppercase mb-0.5 border-b border-slate-700 pb-0.5`}>
          <span>Stat</span>
          <span>Base</span>
          <span>{compact ? 'Enh' : 'Enhanced'}</span>
          <span>{finalColumnHeader}</span>
        </div>

        {/* Damage row(s) - rendered first (damage is always enhanceable) */}
        {damage && (() => {
          const dot = damage.dotDamage;
          const hasDirectDamage = dot ? Math.abs(damage.base - dot.base) > 0.001 : true;
          const isPureDot = dot && !hasDirectDamage;

          const hasEnh = Math.abs(damage.enhanced - damage.base) > 0.001;
          const finalDamage = applyInherentBonus ? applyInherentBonus(damage.final) : damage.final;
          const hasFinal = Math.abs(finalDamage - damage.enhanced) > 0.001;

          // Purple patch combat modifier for damage
          const combatMod = purplePatchInfo?.combatModifier ?? 1;
          const showCombatMod = purplePatchInfo && purplePatchInfo.offset !== 0 && combatMod !== 1;
          const dmgConArrow = showCombatMod ? getConArrow(purplePatchInfo.offset) : null;
          const adjustedFinal = showCombatMod ? finalDamage * combatMod : finalDamage;
          const cappedClass = damage.capped ? 'underline decoration-dotted decoration-amber-400/50' : '';

          // DoT per-tick final (with inherent bonus)
          const dotFinalDamage = dot && applyInherentBonus ? applyInherentBonus(dot.final) : dot?.final ?? 0;
          const adjustedDotFinal = showCombatMod ? dotFinalDamage * combatMod : dotFinalDamage;

          // DoT totals — probability-weighted ticks (cancel-on-miss / chance-gated).
          const dotEffTicks = dot ? dot.effectiveTicks : 0;
          const dotTotalBase = dot ? dot.base * dotEffTicks : 0;
          const dotTotalEnhanced = dot ? dot.enhanced * dotEffTicks : 0;
          const dotTotalFinal = dot ? adjustedDotFinal * dotEffTicks : 0;

          return (
            <>
              {/* Direct damage row (or per-tick for pure DoT) */}
              <div className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
                <span className="text-red-400">{isPureDot ? `${abbreviateDamageType(damage.type)}/tick` : abbreviateDamageType(damage.type)}</span>
                <span className="text-slate-200">{damage.base.toFixed(2)}</span>
                <span className={hasEnh ? 'text-green-400' : 'text-slate-300'}>
                  {damage.enhanced.toFixed(2)}
                </span>
                <span className={`${hasFinal || showCombatMod ? finalColumnColor : 'text-slate-300'} ${cappedClass}`}>
                  {adjustedFinal.toFixed(2)}
                  {dmgConArrow && <span className={`${dmgConArrow.colorClass} ml-0.5 text-[11px]`}>{dmgConArrow.symbol}</span>}
                </span>
              </div>

              {/* DoT per-tick row (only for mixed direct+DoT) */}
              {dot && hasDirectDamage && (() => {
                const dotHasEnh = Math.abs(dot.enhanced - dot.base) > 0.001;
                const dotHasFinal = Math.abs(dotFinalDamage - dot.enhanced) > 0.001;
                return (
                  <div className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
                    <span className="text-red-400">{abbreviateDamageType(dot.type)}/tick</span>
                    <span className="text-slate-200">{dot.base.toFixed(2)}</span>
                    <span className={dotHasEnh ? 'text-green-400' : 'text-slate-300'}>
                      {dot.enhanced.toFixed(2)}
                    </span>
                    <span className={`${dotHasFinal || showCombatMod ? finalColumnColor : 'text-slate-300'} ${cappedClass}`}>
                      {adjustedDotFinal.toFixed(2)}
                      {dmgConArrow && <span className={`${dmgConArrow.colorClass} ml-0.5 text-[11px]`}>{dmgConArrow.symbol}</span>}
                    </span>
                  </div>
                );
              })()}

              {/* DoT total row */}
              {dot && (() => {
                const hasTotalEnh = Math.abs(dotTotalEnhanced - dotTotalBase) > 0.001;
                const hasTotalFinal = Math.abs(dotTotalFinal - dotTotalEnhanced) > 0.001;
                return (
                  <>
                    <div className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
                      <span className="text-orange-400">DoT</span>
                      <span className="text-slate-200">{dotTotalBase.toFixed(2)}</span>
                      <span className={hasTotalEnh ? 'text-green-400' : 'text-slate-300'}>
                        {dotTotalEnhanced.toFixed(2)}
                      </span>
                      <span className={`${hasTotalFinal || showCombatMod ? finalColumnColor : 'text-slate-300'} ${cappedClass}`}>
                        {dotTotalFinal.toFixed(2)}
                        {dmgConArrow && <span className={`${dmgConArrow.colorClass} ml-0.5 text-[11px]`}>{dmgConArrow.symbol}</span>}
                      </span>
                    </div>
                    <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-orange-400/70 italic mt-0.5 ml-1`}>
                      {dot.ticks} ticks over {dot.duration}s ({Number(dot.tickRate.toFixed(2))}s/tick)
                      {dot.chance !== undefined && ` @ ${Math.round(dot.chance * 100)}% (${dot.effectiveTicks.toFixed(2)} avg)`}
                    </div>
                  </>
                );
              })()}

              {/* Unknown damage indicator */}
              {damage.unknown && (
                <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-400 italic mt-0.5 ml-1`}>
                  * Actual damage varies
                </div>
              )}
            </>
          );
        })()}

      {/* Effects — sectioned by MEZ / BUFFS / DEBUFFS / SPECIAL with
        * collapsible groups for long expanded-by-type lists. The outer
        * flatMap inserts a section header whenever the effect category
        * transitions to a different user-facing section. */}
      {groupEffectsForDisplay(displayableEffects).flatMap((group, groupIdx, all) => {
        const section = sectionForGroup(group);
        const prevSection = groupIdx > 0 ? sectionForGroup(all[groupIdx - 1]) : null;
        const showHeader = section !== null && section !== prevSection;
        const sectionHeader = showHeader ? (
          <div
            key={`section-${section}-${groupIdx}`}
            className={`${headerFontSize} ${SECTION_COLOR_NEUTRAL} font-semibold uppercase tracking-wider mt-1.5 first:mt-0`}
          >
            {section}
          </div>
        ) : null;
        const itemNode = ((): React.ReactNode => {
        if (group.type === 'group') {
          return (
            <CollapsibleEffectGroup
              key={`group-${groupIdx}`}
              label={group.label}
              colorClass={group.colorClass}
              items={group.items}
              gridCols={gridCols}
              fontSize={fontSize}
              dominationActive={dominationActive}
              finalColumnColor={finalColumnColor}
            />
          );
        }

        const { effect, tiers, quantity, byTypeLabel, expandedLabel, duration: rowDuration } = group.item;
        const { key, value: rawValue, config } = effect;
        const enhanceable = !!config.enhancementAspect;
        const hasEnh = Math.abs(tiers.enhanced - tiers.base) > 0.001;
        const hasFinal = Math.abs(tiers.final - tiers.enhanced) > 0.001;

        // Build label — expanded label takes precedence. The by-type breakdown
        // (e.g. -Speed's RunSpeed / JumpHeight / FlyJump attribs) is no longer
        // baked into the visible label: a long list overflowed the fixed label
        // column and collided with the value columns. It moves to a hover
        // tooltip on the standard row instead.
        const label0 = expandedLabel || config.label;
        // data-gaps-168: a self-directed mez row (the caster's own root — Hibernate, Icy
        // Bastion) states its recipient instead of reading as foe control. The protection
        // rows already say caster-facing, so the group does not earn a redundant mark.
        const label =
          MEZ_PROT_KEYS.has(key)
          && isMezEffect(rawValue)
          && rawValue.toWho === 'Self'
          && !isProtectionMez(group.item)
            ? `${label0} (Self)`
            : label0;

        // Handle mez effects (magnitude format)
        if (config.format === 'mag') {
          // Domination inherent: add this power's actual Domination bonus when
          // active — extra magnitude AND longer duration (the tagged mez stacks
          // onto the base). The bonus arrives as an `extraInstances` collision
          // from the power's `domination` conditionalEffect; only tagged powers
          // carry it, so an untagged control effect is correctly left alone.
          const domExtra = dominationActive
            ? extraInstances?.[key]?.find((e) => e.conditionalId === 'domination')
            : undefined;
          const dom = domExtra && isMezEffect(domExtra.value) ? domExtra.value : undefined;
          // The mez rank this row applies at. A duration row carries it beside the tiers
          // (the tiers are seconds); every other `mag` row's tiers ARE the rank (data-gaps-167).
          const ownMag = quantity.kind === 'mez_duration' ? quantity.magnitude : tiers.base;
          const rawMag = dom ? ownMag + dom.mag : ownMag;
          const magStr = Number.isInteger(rawMag) ? rawMag.toString() : rawMag.toFixed(1);
          const colorClass = dom ? 'text-pink-400' : config.colorClass;

          // A mez the data does not value: an expression reads live character state (Inner
          // Will takes whatever is mezzing you), and an unstated one lost its `attribType`
          // on the way to the bag — a converter regression, worded so it reads as one.
          if (quantity.kind === 'mez_expression'
            || quantity.kind === 'mez_constant'
            || quantity.kind === 'mez_unstated') {
            return (
              <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
                <span className={colorClass}>{label}</span>
                <span className="text-slate-400 italic">
                  {quantity.kind === 'mez_expression' ? 'Varies' : 'unstated'}
                </span>
                <span className="text-slate-500">—</span>
                <span className="text-slate-500">—</span>
              </div>
            );
          }

          // Duration-based mez (stun, hold, etc.) — magnitude is fixed, duration is enhanceable
          // `quantity` is the classification; the raw value is not consulted again. It used
          // to be re-tested here, which dropped the row for any producer that resolves the
          // quantity without carrying an authored value (data-gaps-329's engine rows).
          if (quantity.kind === 'mez_duration' && archetypeId && level) {
            // Under Domination the effective hold is the tagged bonus (it stacks
            // onto the base with a longer duration), so display uses its scale/table.
            // Undominated, the resolved tier IS the duration, so it is read rather than
            // recomputed. Domination substitutes the tagged bonus's own scale and table
            // (the extra mez stacks onto the base with a longer duration), and that value
            // never went through the resolver, so it still resolves here.
            const baseDuration = dom
              ? (() => {
                  const domTableVal = getTableValue(archetypeId, dom.table, level);
                  return domTableVal !== undefined ? Math.abs(dom.scale * domTableVal) : undefined;
                })()
              : tiers.base;

            if (baseDuration !== undefined && baseDuration > 0) {
              const enhBonus = enhancementBonuses[key] || 0;
              const enhancedDuration = baseDuration * (1 + enhBonus);
              // No global mez bonus exists, but support it for correctness
              const globalBonus = globalBonuses[key] || 0;
              // Enemy-level scaling (purple patch). Mez is the effect class the
              // game flags UseDurationCombatMods — verified against Rebirth's
              // decodable flag: it maps to exactly {Held, Immobilized, Stunned,
              // Sleep, Confused, Terrorized, Afraid}. So a hold that lasts 12s on
              // an even-con enemy lasts 12·0.48 ≈ 5.8s on a +4. The game keeps a
              // separate `pfDuration` array from the magnitude one, but it is
              // server-side (not in the client bins) and the wikis document mez
              // duration as scaling by the same combat-mod curve as damage — so we
              // reuse the already-computed magnitude modifier here (same
              // effectiveLevelDiff, so level-shift is honored). If HC's real
              // pfDuration ever surfaces and diverges, thread a distinct
              // `durationCombatModifier` through purplePatchInfo — this is the only
              // consumer.
              const durCombatMod = purplePatchInfo && purplePatchInfo.offset !== 0
                ? purplePatchInfo.combatModifier
                : 1;
              const finalDuration = baseDuration * (1 + enhBonus + globalBonus) * durCombatMod;
              const durConArrow = durCombatMod !== 1 ? getConArrow(purplePatchInfo!.offset) : null;
              const hasEnh = Math.abs(enhancedDuration - baseDuration) > 0.001;
              const hasFinal = Math.abs(finalDuration - enhancedDuration) > 0.001;

              // Magnitude rides with the stat label (a fixed quantity that
              // identifies which ranks the mez grabs), leaving Base/Enhanced/Final
              // to carry only the duration — the value that actually changes across
              // tiers. Under Domination the boosted mag + [Dom] tag go pink.
              return (
                <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
                  <span className={`${colorClass} flex flex-col leading-tight`}>
                    <span>{label}</span>
                    <span className="text-[10px]">
                      <span className={dom ? 'text-pink-300' : 'text-slate-400'}>Mag {magStr}</span>
                      {dom && (
                        <span className="text-pink-300 ml-1">[Dom]</span>
                      )}
                    </span>
                  </span>
                  <span className="text-slate-200">{baseDuration.toFixed(1)}s</span>
                  <span className={hasEnh ? 'text-green-400' : 'text-slate-300'}>
                    {enhancedDuration.toFixed(1)}s
                  </span>
                  <span className={hasFinal ? finalColumnColor : 'text-slate-300'}>
                    {finalDuration.toFixed(1)}s
                    {durConArrow && <span className={`${durConArrow.colorClass} ml-0.5 text-[11px]`}>{durConArrow.symbol}</span>}
                  </span>
                </div>
              );
            }
          }

          // Distance-based mez (knockback, knockup, repel) — no mag, distance is enhanceable
          if (quantity.kind === 'distance') {
            const enhBonus = enhancementBonuses[key] || 0;
            const globalBonus = globalBonuses[key] || 0;
            const enhanced = tiers.base * (1 + enhBonus);
            const final_ = tiers.base * (1 + enhBonus + globalBonus);
            const hasEnh = Math.abs(enhanced - tiers.base) > 0.001;
            const hasFinal = Math.abs(final_ - enhanced) > 0.001;

            return (
              <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
                <span className={colorClass}>{label}</span>
                <span className="text-slate-200">{tiers.base.toFixed(1)}</span>
                <span className={hasEnh ? 'text-green-400' : 'text-slate-300'}>
                  {enhanced.toFixed(1)}
                </span>
                <span className={hasFinal ? finalColumnColor : 'text-slate-300'}>
                  {final_.toFixed(1)}
                </span>
              </div>
            );
          }

          // Magnitude-valued mez, and the plain-number protection entries the `protection`
          // key expands to. The tiers are the RANK here, and the duration is the template's
          // own — the display bag used to record it under `durations` (data-gaps-167), but data-gaps-327
          // removed that and data-gaps-330 moved the seconds onto the ENGINE row, which a
          // `mez_magnitude` row carries (`GrantedMagnitude::duration` → `ResolvedMagnitude`).
          // A `mez_magnitude` row is enhanceable on the same coupling a duration row is; an
          // expanded protection number is not.
          let mezDuration = rowDuration;
          if (mezDuration == null || mezDuration <= 0) mezDuration = undefined;
          const magEnhanceable = quantity.kind === 'mez_magnitude'
            && Math.abs(tiers.final - tiers.base) > 0.001;
          const magEnh = Math.abs(tiers.enhanced - tiers.base) > 0.001;
          const magFinal = Math.abs(tiers.final - tiers.enhanced) > 0.001;

          return (
            <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
              <span className={colorClass}>{label}</span>
              <span className="text-slate-200">
                Mag {magStr}
                {mezDuration != null && (
                  <span className="text-slate-300 ml-1">({mezDuration.toFixed(1)}s)</span>
                )}
                {dom && (
                  <span className="text-pink-300 text-[10px] ml-1">[Dom]</span>
                )}
              </span>
              {magEnhanceable ? (
                <>
                  <span className={magEnh ? 'text-green-400' : 'text-slate-300'}>
                    Mag {tiers.enhanced.toFixed(1)}
                  </span>
                  <span className={magFinal ? finalColumnColor : 'text-slate-300'}>
                    Mag {tiers.final.toFixed(1)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-slate-500">—</span>
                  <span className="text-slate-500">—</span>
                </>
              )}
            </div>
          );
        }

        // Standard three-tier row \u2014 precision owned by the effect's registry
        // config (see formatEffectValueForConfig).
        const formatValue = (v: number) => formatEffectValueForConfig(v, config);

        // When this debuff applies as multiple instances at different durations
        // (EMP -Regen 15s + 45s), annotate the primary row with its own duration
        // so it reads unambiguously against the sibling variant rows appended
        // below. Only for effects that carry `durationVariants`.
        const primaryVariantDur = (isScaledEffect(rawValue) && rawValue.durationVariants?.length)
          ? durations?.[key]
          : undefined;

        return (
          <div key={key} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
            <span
              className={`${config.colorClass} min-w-0 truncate ${byTypeLabel ? 'underline decoration-dotted decoration-slate-500/70 underline-offset-2 cursor-help' : ''}`}
              title={byTypeLabel ? `Affects: ${byTypeLabel}` : undefined}
            >
              {label}
              {primaryVariantDur != null && (
                <span className="text-slate-400 font-normal text-[11px] ml-0.5">
                  ({Number.isInteger(primaryVariantDur) ? primaryVariantDur : primaryVariantDur.toFixed(1)}s)
                </span>
              )}
            </span>
            <span className="text-slate-200">{formatValue(tiers.base)}</span>
            {enhanceable ? (
              <span className={hasEnh ? 'text-green-400' : 'text-slate-300'}>
                {formatValue(tiers.enhanced)}
              </span>
            ) : (
              <span className="text-slate-500">—</span>
            )}
            {enhanceable ? (() => {
              const isAccuracy = key === 'accuracy' && purplePatchInfo;
              const conArrow = isAccuracy ? getConArrow(purplePatchInfo.offset) : null;
              const hasToHitMod = isAccuracy && (purplePatchInfo.offset !== 0 || (purplePatchInfo.toHitBonus ?? 0) !== 0);
              const rawFinal = hasToHitMod ? tiers.final * purplePatchInfo!.factor : tiers.final;
              const adjustedFinal = isAccuracy ? Math.min(95, rawFinal) : rawFinal;
              const isCapped = isAccuracy && rawFinal > 95;
              const isAdjusted = hasToHitMod;
              // Tooltip explaining the level-differential adjustment so the user
              // can tell why "Final" differs from "Enhanced" — the arrow alone
              // doesn't communicate that purple-patch ToHit is doing the math.
              let accTitle: string | undefined;
              if (hasToHitMod) {
                const off = purplePatchInfo!.offset;
                const offText = off > 0 ? `+${off}` : `${off}`;
                const effectiveToHitPct = (purplePatchInfo!.factor * 75).toFixed(1);
                const tohitBonus = purplePatchInfo!.toHitBonus ?? 0;
                const bonusPart = tohitBonus !== 0
                  ? ` (includes your ${tohitBonus > 0 ? '+' : ''}${tohitBonus.toFixed(1)}% ToHit bonus)`
                  : '';
                accTitle = `Adjusted for level differential vs ${offText} target — effective base ToHit ${effectiveToHitPct}%${bonusPart}.${isCapped ? ' Hit chance capped at 95%.' : ''}`;
              }
              return (
                <span className={isCapped ? 'text-orange-400' : hasFinal || isAdjusted ? finalColumnColor : 'text-slate-300'} title={accTitle}>
                  {formatValue(adjustedFinal)}
                  {isCapped && (
                    <span className="text-slate-400 text-[11px] ml-0.5">({formatValue(rawFinal)})</span>
                  )}
                  {conArrow && (
                    <span className={`${conArrow.colorClass} ml-0.5 text-[11px]`}>{conArrow.symbol}</span>
                  )}
                </span>
              );
            })() : (
              <span className="text-slate-500">—</span>
            )}
          </div>
        );
        })();
        // Render extra-instance rows for additive collisions on this group's
        // key (e.g. Suffocate's Stealthed Mag-3 hold on top of base Mag-3).
        const itemKey = group.type === 'single' ? group.item.effect.key : null;
        // AT-inherent collisions (Domination) on a MEZ row are surfaced inline
        // on the base row (+mag, longer duration) + the dedicated Domination
        // badge, so drop the duplicate extra row there. Non-mez Domination
        // collisions (e.g. a summon override) have no inline path — keep their row.
        const inlineHandlesDom = group.type === 'single' && group.item.effect.config.format === 'mag';
        const extras = ((itemKey && extraInstances?.[itemKey]) || [])
          .filter((e) => !(inlineHandlesDom && e.conditionalId && AT_INHERENT_CONDITIONAL_IDS.has(e.conditionalId)));
        const extraRows = extras.map((extra, i) => renderExtraInstanceRow({
          key: `${itemKey}-extra-${groupIdx}-${i}`,
          baseKey: itemKey!,
          baseConfig: group.type === 'single' ? group.item.effect.config : null,
          extra,
          gridCols,
          fontSize,
          archetypeId,
          level,
          effectDur: itemKey
            ? getEffectDuration(
                itemKey,
                group.type === 'single' ? group.item.effect.config.category : undefined,
                group.type === 'single' ? group.item.duration : undefined,
              )
            : undefined,
        }));
        const result: React.ReactNode[] = [];
        if (sectionHeader) result.push(sectionHeader);
        result.push(itemNode);
        result.push(...extraRows);
        // Second "(unresistable)" row for HC's split debuffs (Flash Arrow -ToHit,
        // Poison Gas -DMG): the power applies an equal half that ignores the
        // target's debuff resistance. Same value/tiers as the resistable half —
        // only the label differs. The converter tags the effect `unresistable`.
        if (group.type === 'single') {
          const gi = group.item;
          const gv = gi.effect.value;
          if (
            gi.effect.config.format === 'percent' &&
            gv && typeof gv === 'object' && 'unresistable' in gv &&
            (gv as { unresistable?: boolean }).unresistable
          ) {
            const cfg = gi.effect.config;
            const fv = (v: number) => formatEffectValueForConfig(v, cfg);
            const enh = !!cfg.enhancementAspect;
            const hasE = Math.abs(gi.tiers.enhanced - gi.tiers.base) > 0.001;
            const hasF = Math.abs(gi.tiers.final - gi.tiers.enhanced) > 0.001;
            result.push(
              <div key={`${gi.effect.key}-unres-${groupIdx}`} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
                <span className={cfg.colorClass}>
                  {cfg.label}
                  <UnresistableMark />
                </span>
                <span className="text-slate-200">{fv(gi.tiers.base)}</span>
                {enh
                  ? <span className={hasE ? 'text-green-400' : 'text-slate-300'}>{fv(gi.tiers.enhanced)}</span>
                  : <span className="text-slate-500">—</span>}
                {enh
                  ? <span className={hasF ? finalColumnColor : 'text-slate-300'}>{fv(gi.tiers.final)}</span>
                  : <span className="text-slate-500">—</span>}
              </div>
            );
          }
        }
        // Duration-variant rows for debuffs the power applies more than once at
        // different durations (EMP -Regen 15s + 45s, Thunderous Blast -Recovery
        // 10s + 20s). The primary row (annotated with its own duration above)
        // holds the longest-lived instance; each variant is the same debuff on
        // the same table at a shorter duration, so its value scales linearly
        // from the primary's tiers — keeping formatting identical without
        // re-deriving the AT-table math.
        if (group.type === 'single') {
          const gi = group.item;
          const gv = gi.effect.value;
          if (
            gi.effect.config.format === 'percent' &&
            isScaledEffect(gv) && gv.durationVariants?.length && gv.scale
          ) {
            const cfg = gi.effect.config;
            const fv = (v: number) => formatEffectValueForConfig(v, cfg);
            const enh = !!cfg.enhancementAspect;
            for (const [vi, variant] of gv.durationVariants.entries()) {
              const ratio = variant.scale / gv.scale;
              const vBase = gi.tiers.base * ratio;
              const vEnh = gi.tiers.enhanced * ratio;
              const vFinal = gi.tiers.final * ratio;
              const hasE = Math.abs(vEnh - vBase) > 0.001;
              const hasF = Math.abs(vFinal - vEnh) > 0.001;
              const durStr = Number.isInteger(variant.duration)
                ? variant.duration
                : variant.duration.toFixed(1);
              result.push(
                <div key={`${gi.effect.key}-durvar-${groupIdx}-${vi}`} className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
                  <span className={cfg.colorClass}>
                    {cfg.label}
                    <span className="text-slate-400 font-normal text-[11px] ml-0.5">({durStr}s)</span>
                  </span>
                  <span className="text-slate-200">{fv(vBase)}</span>
                  {enh
                    ? <span className={hasE ? 'text-green-400' : 'text-slate-300'}>{fv(vEnh)}</span>
                    : <span className="text-slate-500">—</span>}
                  {enh
                    ? <span className={hasF ? finalColumnColor : 'text-slate-300'}>{fv(vFinal)}</span>
                    : <span className="text-slate-500">—</span>}
                </div>
              );
            }
          }
        }
        return result;
      })}

      {/* Power duration — its own row rather than a parenthetical repeated on
        * every timed effect's label. Only shown when the power actually has a
        * timed (non-execution) effect. */}
      {powerDuration != null && hasTimedEffect && (
        <div className={`grid ${gridCols} gap-1 items-baseline ${fontSize}`}>
          <span className="text-slate-400">Duration</span>
          <span className="text-slate-300">
            {Number.isInteger(powerDuration) ? powerDuration : powerDuration.toFixed(1)}s
          </span>
          <span className="text-slate-500">—</span>
          <span className="text-slate-500">—</span>
        </div>
      )}

      {/* SPECIAL — chance procs / state-grant entries surfaced from
        * `specialEffects`. Emits its own neutral subheader (same style as
        * MEZ / BUFFS / DEBUFFS) and one plain-text row per entry. */}
      {specialEffects && specialEffects.length > 0 && (
        <>
          <div className={`${headerFontSize} ${SECTION_COLOR_NEUTRAL} font-semibold uppercase tracking-wider mt-1.5`}>
            SPECIAL
          </div>
          {specialEffects.map((sp, i) => (
            <div key={`special-${i}`} className={`${fontSize} text-slate-300 ml-1`}>
              <span className="text-cyan-400">+{(sp.chance * 100).toFixed(2)}%</span>{' '}
              {sp.kind === 'grant'
                ? <>chance to grant <span className="text-slate-100">{sp.label}</span> on target</>
                : <>chance to <span className="text-slate-100">{sp.label}</span></>}
            </div>
          ))}
        </>
      )}
      </div>
    </div>
  );
}
