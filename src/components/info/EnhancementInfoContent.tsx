/**
 * EnhancementInfoContent - Shared component for rendering enhancement details
 * Used by both PowerInfoTooltip (floating tooltip) and InfoPanel (side panel)
 */

import { useBuildStore, useUIStore } from '@/stores';
import { useBonusTracking, useSlotLevels } from '@/hooks';
import { powerKey, type PowerCategory } from '@/utils/power-key';
import { getIOSet, lookupPower, findProcData, resolveProcPieceName, procEffectSummary, getProcEffectLabel, getProcEffectColor, isProcAlwaysOn, resolveProcRollGeometry, procRollsInPatch, powerFiresProcs, interpolateProcDamage, calculateProcChance, calculateProcsPerMinute, calculateProcDPS, calculateAutoToggleProcChance, calculateAutoToggleProcsPerMinute, arcToDegrees } from '@/data';
import { resolveProcAreaGeometry, resolveProcPatchDuration, resolveProcRollModifiers } from '@/utils/calculations/pet-damage';
import {
  normalizeAspectName,
  readAspectDisplayValue,
  normalizeStatName,
  getTotalBonusCount,
  isBonusCapped,
  enhancementLevelMultiplier,
  getMultiAspectModifier,
  getEffectiveAspectCount,
  calculateSingleEnhancementValues,
} from '@/utils/calculations';
import { formatBonusDesc } from '@/utils/set-bonus-format';
import {
  IOSetIcon,
  GenericIOIcon,
  OriginEnhancementIcon,
  SpecialEnhancementIcon,
} from '@/components/enhancements/EnhancementIcon';
import { findSelectedPowerInBuild } from './powerDisplayUtils';
import type { IOSetEnhancement, GenericIOEnhancement, OriginEnhancement, SpecialEnhancement, Enhancement } from '@/types';

/** Matches the slot badge's own wording for an unplaceable slot (SLOT-1). */
const UNPLACED_SLOT_TITLE =
  'This slot has no level the game could grant it — the build wants more slots at this power\u2019s level or later than the schedule issues.';


/**
 * How a slot's stored level offset reads to the player. A booster combine is a
 * bonus ("+3 Boosted"); a negative is an out-levelled enhancement, which is a
 * penalty and has to say so — the panel used to render only the positive half,
 * so an under-level piece looked identical to an even one.
 */
function levelOffsetLabel(offset: number): string {
  return offset > 0 ? `+${offset} Boosted` : `${offset} Under Level`;
}

function levelOffsetClass(offset: number): string {
  return offset > 0 ? 'text-green-400' : 'text-red-400';
}

interface EnhancementInfoContentProps {
  powerName: string;
  /** REQUIRED — a power's identity is (powerSet, internalName). Internal names
   *  are reused across powersets, so resolving by bare name can show a different
   *  power's enhancement. See `findSelectedPowerInBuild`. */
  powerSet: string;
  slotIndex: number;
}

export function EnhancementInfoContent({ powerName, powerSet, slotIndex }: EnhancementInfoContentProps) {
  const build = useBuildStore((s) => s.build);
  const exemplarMode = useUIStore((s) => s.exemplarMode);
  const exemplarLevelSetting = useUIStore((s) => s.exemplarLevel);
  const exemplarLevel = exemplarMode ? exemplarLevelSetting : undefined;
  const bonusTracking = useBonusTracking();
  const slotLevelsMap = useSlotLevels();

  // The power this panel describes. Resolved ONCE via the shared, powerset-aware
  // lookup — this file previously hand-rolled the same primary→secondary→pools→
  // epic→inherent search three times, each matching on bare `internalName`, so
  // each was independently wrong for a collided name.
  const power = findSelectedPowerInBuild(powerName, powerSet, build);

  // Which bucket the power came from, for the slot-levels key. Identity comparison is
  // sound: `findSelectedPowerInBuild` returns the build's own object.
  const powerCategory: PowerCategory | null = !power
    ? null
    : build.primary.powers.includes(power)
      ? 'primary'
      : build.secondary.powers.includes(power)
        ? 'secondary'
        : build.pools.some((pool) => pool.powers.includes(power))
          ? 'pool'
          : build.epicPool?.powers.includes(power)
            ? 'epic'
            : 'inherent';
  // The level this slot was placed at — same derivation the power list's slot-level
  // chips use (respec vs leveling mode aware). `null` means the grant schedule
  // had nothing left this slot could legally occupy (SLOT-1).
  const slotLevel = powerCategory
    ? slotLevelsMap.get(powerKey(powerCategory, powerName))?.[slotIndex]
    : undefined;

  const findEnhancement = (): Enhancement | null => power?.slots[slotIndex] ?? null;

  // Count how many pieces of a set are slotted in this power
  const countSetPiecesInPower = (setId: string): number => {
    if (!power) return 0;

    return power.slots.filter(
      (s: Enhancement | null) => s && s.type === 'io-set' && (s as IOSetEnhancement).setId === setId
    ).length;
  };

  const enhancement = findEnhancement();

  if (!enhancement) {
    return <div className="text-slate-400 text-xs">No enhancement</div>;
  }

  // IO Set Enhancement
  if (enhancement.type === 'io-set') {
    const ioEnh = enhancement as IOSetEnhancement;
    const ioSet = getIOSet(ioEnh.setId);
    const piecesSlotted = countSetPiecesInPower(ioEnh.setId);
    // Use set data icon (authoritative) with fallback to stored icon
    const rawIcon = ioSet?.icon || ioEnh.icon || 'Unknown.png';
    const iconName = rawIcon.includes('/')
      ? rawIcon.split('/').pop() || 'Unknown.png'
      : rawIcon;

    // What this slotted piece actually contributes, straight from the calculation that
    // credits it on the dashboard (PROD6E-2).
    const slottedValues = calculateSingleEnhancementValues(enhancement, build.level, getIOSet, exemplarLevel);
    // Proc DAMAGE is the exception: it scales with the CHARACTER's (combat) level, never the
    // IO's crafted level (a level-21 and a level-50 proc deal identical damage on a level-50
    // char — "slot the cheapest proc"). Enhancement VALUES do scale with IO level, which is
    // why the proc payload can't reuse them. interpolateProcDamage clamps to the proc's own
    // levelRange. (@Redlynne report, 2026-06-12.)
    const procDamageLevel = build.level || 50;
    // Look up the piece data so we can use its display name as a fallback
    // signal for special segments (e.g. "/+Run Speed", "/Fast Snipe") that
    // don't appear in the aspects array but still count toward the
    // multi-aspect penalty. Mirrors the main calc engine's behavior.
    const piece = ioSet?.pieces.find((p) => p.num === ioEnh.pieceNum);
    const pieceTotalAspects = (piece as { totalAspects?: number } | undefined)?.totalAspects;
    const rawAspectCount = ioEnh.aspects.filter(a => normalizeAspectName(a) !== null).length || ioEnh.aspects.length;
    const effectiveAspectCount = getEffectiveAspectCount(
      ioEnh.aspects.slice(0, rawAspectCount),
      !!ioEnh.isProc,
      pieceTotalAspects,
    );
    const aspectModifier = getMultiAspectModifier(effectiveAspectCount);

    const calculateAspectValue = (aspect: string): number | null =>
      readAspectDisplayValue(aspect, slottedValues);

    return (
      <div className="space-y-2 max-w-[320px]">
        {/* Enhancement header with set name */}
        <div className="flex items-center gap-2">
          <IOSetIcon
            icon={iconName}
            attuned={ioEnh.attuned}
            category={ioSet?.category}
            size={28}
            alt={enhancement.name}
            className="flex-shrink-0"
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-yellow-400 leading-tight">
              {ioEnh.setName}
              {ioSet && <span className="text-yellow-600 font-normal ml-1">({ioEnh.pieceNum}/{ioSet.pieces.length})</span>}
            </h3>
            <span className="text-xs text-[var(--color-link)]">{resolveProcPieceName(enhancement.name, ioEnh.setName, ioEnh.isProc)}</span>
          </div>
        </div>

        {/* Proc Effect section - shown for proc enhancements */}
        {ioEnh.isProc && (
          <div className="bg-amber-900/30 border border-amber-700/50 rounded p-1.5">
            <div className="text-[11px] text-amber-400 uppercase mb-1 font-semibold">Proc Effect</div>
            {/* Look up detailed proc data */}
            {(() => {
              const procData = findProcData(enhancement.name, ioEnh.setName);

              if (procData) {
                // Binary-sourced structured effects (falls back to mechanics parse),
                // summarized to the legacy primary/secondary shape for display.
                const effect = procEffectSummary(procData);
                const effectColorClass = getProcEffectColor(effect.category);
                const categoryLabel = getProcEffectLabel(effect.category);
                const isAlwaysOn = isProcAlwaysOn(procData);

                // Get category-specific badge colors
                const BADGE_COLORS: Record<string, string> = {
                  'Damage': 'bg-red-900/50 text-red-300',
                  'Endurance': 'bg-blue-900/50 text-blue-300',
                  'Heal': 'bg-emerald-900/50 text-emerald-300',
                  'Absorb': 'bg-cyan-900/50 text-cyan-300',
                  'Resistance': 'bg-orange-900/50 text-orange-300',
                  'Defense': 'bg-purple-900/50 text-purple-300',
                  'ToHit': 'bg-yellow-900/50 text-yellow-300',
                  'Regeneration': 'bg-green-900/50 text-green-300',
                  'Recovery': 'bg-blue-900/50 text-blue-300',
                  'Recharge': 'bg-amber-900/50 text-amber-300',
                  'RunSpeed': 'bg-teal-900/50 text-teal-300',
                  'MaxHP': 'bg-pink-900/50 text-pink-300',
                  'KnockbackProtection': 'bg-slate-700 text-slate-300',
                  'Stealth': 'bg-gray-700 text-gray-300',
                  'Control': 'bg-indigo-900/50 text-indigo-300',
                  'Debuff': 'bg-rose-900/50 text-rose-300',
                  'Special': 'bg-slate-700 text-slate-300',
                };
                const badgeColors = BADGE_COLORS[effect.category] || 'bg-slate-700 text-slate-300';
                const secondaryBadgeColors = effect.secondaryCategory
                  ? BADGE_COLORS[effect.secondaryCategory] || 'bg-slate-700 text-slate-300'
                  : undefined;

                return (
                  <div className="space-y-1">
                    {/* Effect name and category */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium ${effectColorClass}`}>
                        {procData.ioName}
                      </span>
                      <span className={`text-[10px] px-1 py-0.5 rounded ${badgeColors}`}>
                        {categoryLabel}
                      </span>
                      {effect.secondaryCategory && secondaryBadgeColors && (
                        <span className={`text-[10px] px-1 py-0.5 rounded ${secondaryBadgeColors}`}>
                          {getProcEffectLabel(effect.secondaryCategory)}
                        </span>
                      )}
                      {isAlwaysOn && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-green-900/50 text-green-300">
                          Always On
                        </span>
                      )}
                    </div>

                    {/* Detailed mechanics */}
                    <div className="text-[11px] text-slate-300 bg-slate-800/50 rounded px-1.5 py-1">
                      {procData.mechanics}
                    </div>

                    {/* Effect details based on category */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                      {procData.ppm !== null && (
                        <div>
                          <span className="text-slate-400">PPM:</span>
                          <span className="text-amber-300 ml-1 font-medium">{procData.ppm}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-slate-400">Type:</span>
                        <span className={`ml-1 ${
                          procData.type === 'Proc120s' ? 'text-purple-400' :
                          procData.type === 'Global' ? 'text-green-400' :
                          'text-amber-300'
                        }`}>
                          {procData.type === 'Proc120s' ? '100% (120s)' : procData.type}
                        </span>
                      </div>
                      {/* Show parsed effect values */}
                      {effect.value !== undefined && effect.category === 'Damage' && effect.valueMax && (
                        <div>
                          <span className="text-slate-400">Dmg:</span>
                          <span className="text-red-400 ml-1">
                            {interpolateProcDamage(effect.value, effect.valueMax, procData.levelRange, procDamageLevel)} {effect.effectType}
                          </span>
                        </div>
                      )}
                      {effect.value !== undefined && !(effect.category === 'Damage' && effect.valueMax !== undefined) && (
                        <div>
                          <span className="text-slate-400">Value:</span>
                          <span className={`${effectColorClass} ml-1`}>
                            {effect.category === 'KnockbackProtection' ? `Mag ${effect.value}` :
                             effect.category === 'Stealth' ? `${effect.value} ft` :
                             `${effect.value}%`}
                            {effect.effectType ? ` ${effect.effectType}` : ''}
                          </span>
                        </div>
                      )}
                      {effect.duration && (
                        <div>
                          <span className="text-slate-400">Dur:</span>
                          <span className="text-cyan-300 ml-1">{effect.duration}s</span>
                        </div>
                      )}
                      {/* Secondary effect (for combined procs like Numina's, Panacea) */}
                      {effect.secondaryCategory && effect.secondaryValue !== undefined && (
                        <div>
                          <span className="text-slate-400">+{getProcEffectLabel(effect.secondaryCategory)}:</span>
                          <span className={`${getProcEffectColor(effect.secondaryCategory)} ml-1`}>
                            {effect.secondaryValue}%
                            {effect.secondaryEffectType ? ` ${effect.secondaryEffectType}` : ''}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* PPM Calculation - show for PPM-based procs */}
                    {procData.ppm !== null && (() => {
                      // The power this enhancement is slotted in. Both halves are
                      // resolved by (powerSet, internalName): `power` via the
                      // shared build lookup above, and the base definition via
                      // `lookupPower`, which searches the right powerset/pool/epic
                      // rather than guessing a category from a bare name.
                      //
                      // The hand-rolled search this replaces was collision-blind
                      // twice over (its `getPower(build.primary.id, powerName)`
                      // could read a same-named power out of the wrong set) and
                      // silently omitted `epicPool` entirely, so epic powers got
                      // no PPM data at all.
                      const powerData = power
                        ? { selected: power, base: lookupPower(powerSet, powerName)?.power ?? null }
                        : null;
                      if (!powerData) return null;

                      const { selected, base } = powerData;
                      const powerType = selected.powerType?.toLowerCase() || base?.powerType?.toLowerCase() || 'click';
                      const isAutoOrToggle = powerType === 'auto' || powerType === 'toggle';
                      // Propel & co.: the radius is a secondary knockback splash — every
                      // proc in the power rolls the single-target area-factor.
                      const procsOnlyOnMainTarget =
                        selected.procsOnlyOnMainTarget ?? base?.procsOnlyOnMainTarget;
                      // ProcAllowed kNone: no PPM chance exists against this
                      // power, so print nothing rather than a number the game
                      // will never honour. The rest of the tooltip (the proc's
                      // own effects) still renders.
                      if (!powerFiresProcs(selected) || !powerFiresProcs(base)) return null;
                      // Area-factor override, chain cap and PPMMod of the power the roll happens in.
                      const rollMods = resolveProcRollModifiers(base ?? selected);

                      // Auto/Toggle powers, and the patch a rain summons, both
                      // roll on the proc's own 10s period instead of a recharge
                      // window. A patch differs in one way: it lives long enough
                      // for several of those periods, so the cast is worth
                      // `rolls` checks rather than one. See resolveProcRollSchedule.
                      const patchDuration = resolveProcPatchDuration(
                        base?.effects?.radius || selected.effects?.radius || 0,
                        base?.summon ?? selected.summon,
                      );
                      if (isAutoOrToggle || patchDuration != null) {
                        const togArcRaw = base?.effects?.arc ?? selected.effects?.arc;
                        const patchArea = resolveProcAreaGeometry(
                          base?.effects?.radius || selected.effects?.radius || 0,
                          arcToDegrees(togArcRaw) || undefined,
                          base?.summon ?? selected.summon,
                        );
                        const { radius: togRadius, arcDegrees: togArc } = resolveProcRollGeometry(
                          procsOnlyOnMainTarget,
                          patchArea.radius,
                          patchArea.arcDegrees,
                        );
                        const rolls = patchDuration != null
                          ? procRollsInPatch(
                              patchDuration,
                              (base?.effects?.recharge || selected.effects?.recharge || 0)
                                + (base?.effects?.castTime || selected.effects?.castTime || 0),
                            )
                          : 1;
                        const procChance = calculateAutoToggleProcChance(procData.ppm, togRadius, togArc, rollMods);
                        // Per minute: a toggle checks 6×/min flat, whereas a patch
                        // gets `rolls` checks per cast on the parent's cycle.
                        const cycle = (base?.effects?.recharge || selected.effects?.recharge || 0)
                          + (base?.effects?.castTime || selected.effects?.castTime || 0);
                        const procsPerMin = patchDuration != null && cycle > 0
                          ? procChance * rolls * (60 / cycle)
                          : calculateAutoToggleProcsPerMinute(procData.ppm, togRadius, togArc, rollMods);

                        return (
                          <div className="mt-1 pt-1 border-t border-amber-700/30">
                            <div className="text-[10px] text-amber-400/70 uppercase mb-0.5">
                              PPM Calculation ({patchDuration != null ? 'patch' : powerType})
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                              <div>
                                <span className="text-slate-400">Chance/tick:</span>
                                <span className="text-amber-300 ml-1">{(procChance * 100).toFixed(1)}%</span>
                              </div>
                              <div>
                                <span className="text-slate-400">Procs/min:</span>
                                <span className="text-green-400 ml-1">{procsPerMin.toFixed(2)}</span>
                              </div>
                              {effect.category === 'Damage' && effect.value !== undefined && effect.valueMax !== undefined && (
                                <div>
                                  <span className="text-slate-400">DPS:</span>
                                  <span className="text-red-400 ml-1">
                                    {((procsPerMin * interpolateProcDamage(effect.value, effect.valueMax, procData.levelRange, procDamageLevel)) / 60).toFixed(1)}
                                  </span>
                                </div>
                              )}
                              {/* Endurance per second for endurance procs */}
                              {effect.category === 'Endurance' && effect.value !== undefined && (
                                <div>
                                  <span className="text-slate-400">End/sec:</span>
                                  <span className="text-blue-400 ml-1">
                                    {((procsPerMin * effect.value) / 60).toFixed(2)}
                                  </span>
                                </div>
                              )}
                              {/* HP per second for heal procs */}
                              {effect.category === 'Heal' && effect.value !== undefined && (
                                <div>
                                  <span className="text-slate-400">HP%/sec:</span>
                                  <span className="text-green-400 ml-1">
                                    {((procsPerMin * effect.value) / 60).toFixed(2)}%
                                  </span>
                                </div>
                              )}
                              {/* Recovery rate for recovery procs */}
                              {effect.category === 'Recovery' && effect.value !== undefined && (
                                <div>
                                  <span className="text-slate-400">Rec%/sec:</span>
                                  <span className="text-blue-300 ml-1">
                                    {((procsPerMin * effect.value) / 60).toFixed(2)}%
                                  </span>
                                </div>
                              )}
                              {/* Regen rate for regeneration procs */}
                              {effect.category === 'Regeneration' && effect.value !== undefined && (
                                <div>
                                  <span className="text-slate-400">Regen%/sec:</span>
                                  <span className="text-green-300 ml-1">
                                    {((procsPerMin * effect.value) / 60).toFixed(2)}%
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="text-[9px] text-slate-400 mt-0.5 italic">
                              {patchDuration != null
                                ? `Patch: rolls on the summon every 10s (${rolls}/cast) — recharge does not change the chance`
                                : 'Auto/Toggle: 10s pseudo-recharge, 6 checks/min'}
                            </div>
                          </div>
                        );
                      }

                      // For Click powers, need recharge and cast time
                      const recharge = base?.effects?.recharge || selected.effects?.recharge || 0;
                      const castTime = base?.effects?.castTime || selected.effects?.castTime || 1;
                      const arcRaw = base?.effects?.arc ?? selected.effects?.arc;
                      const { radius, arcDegrees } = resolveProcRollGeometry(
                        procsOnlyOnMainTarget,
                        base?.effects?.radius || selected.effects?.radius || 0,
                        arcToDegrees(arcRaw) || undefined,
                      );

                      if (recharge <= 0) return null; // Can't calculate without recharge

                      const procChance = calculateProcChance(procData.ppm, recharge, castTime, radius, arcDegrees, 0, rollMods);
                      const procsPerMin = calculateProcsPerMinute(procData.ppm, recharge, castTime, radius, 0, arcDegrees, 0, rollMods);

                      return (
                        <div className="mt-1 pt-1 border-t border-amber-700/30">
                          <div className="text-[10px] text-amber-400/70 uppercase mb-0.5">PPM Calculation</div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                            <div>
                              <span className="text-slate-400">Chance:</span>
                              <span className="text-amber-300 ml-1">{(procChance * 100).toFixed(1)}%</span>
                            </div>
                            <div>
                              <span className="text-slate-400">Procs/min:</span>
                              <span className="text-green-400 ml-1">{procsPerMin.toFixed(2)}</span>
                            </div>
                            {effect.category === 'Damage' && effect.value !== undefined && effect.valueMax !== undefined && (() => {
                              const dmgAtLevel = interpolateProcDamage(effect.value, effect.valueMax, procData.levelRange, procDamageLevel);
                              return (
                                <div>
                                  <span className="text-slate-400">DPS:</span>
                                  <span className="text-red-400 ml-1">
                                    {calculateProcDPS(procData.ppm, dmgAtLevel, dmgAtLevel, recharge, castTime, radius, 0, arcDegrees, rollMods).toFixed(1)}
                                  </span>
                                </div>
                              );
                            })()}
                            {/* Endurance per second for endurance procs */}
                            {effect.category === 'Endurance' && effect.value !== undefined && (
                              <div>
                                <span className="text-slate-400">End/sec:</span>
                                <span className="text-blue-400 ml-1">
                                  {((procsPerMin * effect.value) / 60).toFixed(2)}
                                </span>
                              </div>
                            )}
                            {/* HP per second for heal procs */}
                            {effect.category === 'Heal' && effect.value !== undefined && (
                              <div>
                                <span className="text-slate-400">HP%/sec:</span>
                                <span className="text-green-400 ml-1">
                                  {((procsPerMin * effect.value) / 60).toFixed(2)}%
                                </span>
                              </div>
                            )}
                            {/* Recovery rate for recovery procs */}
                            {effect.category === 'Recovery' && effect.value !== undefined && (
                              <div>
                                <span className="text-slate-400">Rec%/sec:</span>
                                <span className="text-blue-300 ml-1">
                                  {((procsPerMin * effect.value) / 60).toFixed(2)}%
                                </span>
                              </div>
                            )}
                            {/* Regen rate for regeneration procs */}
                            {effect.category === 'Regeneration' && effect.value !== undefined && (
                              <div>
                                <span className="text-slate-400">Regen%/sec:</span>
                                <span className="text-green-300 ml-1">
                                  {((procsPerMin * effect.value) / 60).toFixed(2)}%
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="text-[9px] text-slate-400 mt-0.5 italic">
                            Base: {recharge.toFixed(1)}s rech, {castTime.toFixed(2)}s cast{radius > 0 ? `, ${radius}ft AoE` : ''}
                          </div>
                        </div>
                      );
                    })()}

                    {/* PvP notes if any */}
                    {procData.pvpNotes && (
                      <div className="text-[10px] text-orange-400/80">
                        PvP: {procData.pvpNotes}
                      </div>
                    )}
                  </div>
                );
              } else {
                // Fallback to basic display if no proc data found
                const name = enhancement.name.toLowerCase();
                let effectText = enhancement.name;
                if (name.includes('chance for')) {
                  effectText = enhancement.name.replace(/^Chance for /i, '');
                } else if (name.includes('chance to')) {
                  effectText = enhancement.name.replace(/^Chance to /i, '');
                }

                return (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-amber-200">{effectText}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 italic">
                      Proc effects trigger based on PPM (Procs Per Minute) formula
                    </div>
                  </>
                );
              }
            })()}
          </div>
        )}

        {/* Enhances section — shown whenever the piece enhances aspects, even
            for hybrid global/proc IOs (LotG Defense/+Recharge, Steadfast
            Resistance/+Def) that BOTH proc and enhance a stat. Pure procs
            carry an empty `aspects` array, so this stays hidden for them. */}
        {ioEnh.aspects.length > 0 && (
          <div className="bg-slate-800/50 rounded p-1.5">
            <div className="text-xs text-slate-300 uppercase mb-1 font-medium">Enhances:</div>
            {ioEnh.aspects.map((aspect, i) => {
              const value = calculateAspectValue(aspect);
              return (
                <div key={i} className="flex justify-between items-baseline text-sm">
                  <span className="text-slate-200">{aspect}</span>
                  {value !== null && (
                    <span className="text-green-400 font-mono">
                      +{(value * 100).toFixed(2)}%
                    </span>
                  )}
                </div>
              );
            })}
            {effectiveAspectCount > 1 && (
              <div className="text-xs text-slate-300 mt-1 italic">
                {(aspectModifier * 100).toFixed(1)}% per aspect ({rawAspectCount} aspect{rawAspectCount !== 1 ? 's' : ''}{ioEnh.isProc ? ' + proc' : ''})
              </div>
            )}
          </div>
        )}

        {/* Level and flags */}
        <div className="text-xs flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="text-slate-300">
            {ioEnh.attuned ? (
              <span className="text-purple-400">Attuned (scales to Lvl {build.level})</span>
            ) : (
              <>Level: <span className="text-slate-200">{enhancement.level}</span></>
            )}
          </span>
          {slotLevel !== undefined && (
            slotLevel === null ? (
              <span className="text-red-400" title={UNPLACED_SLOT_TITLE}>
                No grantable level
              </span>
            ) : (
              <span className="text-slate-300">
                Slotted at Lvl <span className="text-slate-200">{slotLevel}</span>
              </span>
            )
          )}
          {ioEnh.isUnique && (
            <span className="text-red-400">Unique</span>
          )}
          {enhancement.boost ? (
            <span className={levelOffsetClass(enhancement.boost)}>{levelOffsetLabel(enhancement.boost)}</span>
          ) : null}
        </div>

        {/* Set pieces — the whole set's piece list, the ones slotted in this power lit
            (the Mids presentation: what you have and what's left to slot, at a glance) */}
        {ioSet && (() => {
          const slottedPieceNums = new Set(
            (power?.slots ?? [])
              .filter((s): s is IOSetEnhancement =>
                !!s && s.type === 'io-set' && (s as IOSetEnhancement).setId === ioEnh.setId)
              .map((s) => s.pieceNum)
          );
          return (
            <div className="border-t border-slate-700 pt-2">
              <div className="text-xs text-slate-300 uppercase mb-1 font-medium">
                Set Pieces ({piecesSlotted}/{ioSet.pieces.length} slotted)
              </div>
              <div className="space-y-0.5">
                {ioSet.pieces.map((p) => {
                  const slotted = slottedPieceNums.has(p.num);
                  return (
                    <div
                      key={p.num}
                      className={`text-xs flex items-center gap-1.5 ${slotted ? 'text-cyan-300' : 'text-slate-500'}`}
                    >
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${slotted ? 'bg-cyan-300' : 'border border-slate-500'}`}
                      />
                      {p.name || `Piece ${p.num}`}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Set Bonuses */}
        {ioSet && ioSet.bonuses.length > 0 && (() => {
          const hasPvPEffects = ioSet.category === 'pvp' && ioSet.bonuses.some(b => b.effects.some(e => e.pvp));
          return (
            <div className="border-t border-slate-700 pt-2">
              <div className="text-xs text-slate-300 uppercase mb-1 font-medium">
                Set Bonuses ({piecesSlotted}/{ioSet.pieces.length} slotted)
              </div>
              <div className="space-y-0.5">
                {ioSet.bonuses.map((bonus, idx) => {
                  const pveEffects = hasPvPEffects ? bonus.effects.filter(e => !e.pvp) : bonus.effects;
                  if (pveEffects.length === 0) return null;
                  const isActive = piecesSlotted >= bonus.pieces;
                  return (
                    <div
                      key={idx}
                      className={`text-sm ${isActive ? 'text-green-400' : 'text-slate-300'}`}
                    >
                      <span className={`font-medium ${isActive ? 'text-green-500' : 'text-slate-400'}`}>
                        {bonus.pieces}pc:
                      </span>{' '}
                      {pveEffects.map((eff, i) => {
                        const normalized = isActive ? normalizeStatName(eff.stat) : null;
                        const totalCount = normalized ? getTotalBonusCount(bonusTracking, normalized, eff.value) : 0;
                        const capped = normalized ? isBonusCapped(bonusTracking, normalized, eff.value) : false;
                        const formatted = formatBonusDesc(eff.desc, eff.stat, eff.value);
                        return (
                          <span key={i} className={capped ? 'text-warning-fg' : ''}>
                            {i > 0 && ', '}
                            {formatted}
                            {isActive && totalCount > 0 && (
                              <span className={`ml-0.5 text-xs ${capped ? 'text-warning-fg font-semibold' : 'text-slate-300'}`}>
                                ({totalCount}/5)
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {hasPvPEffects && (
                <>
                  <div className="text-xs text-red-400 uppercase mt-2 mb-0.5 font-medium">PvP Only</div>
                  <div className="space-y-0.5">
                    {ioSet.bonuses.map((bonus, idx) => {
                      const pvpEffects = bonus.effects.filter(e => e.pvp);
                      if (pvpEffects.length === 0) return null;
                      const isActive = piecesSlotted >= bonus.pieces;
                      return (
                        <div
                          key={idx}
                          className={`text-sm ${isActive ? 'text-red-300' : 'text-slate-400'}`}
                        >
                          <span className={`font-medium ${isActive ? 'text-red-400' : 'text-slate-500'}`}>
                            {bonus.pieces}pc:
                          </span>{' '}
                          {pvpEffects.map((eff, i) => (
                            <span key={i}>
                              {i > 0 && ', '}
                              {eff.desc}
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  // Generic IO Enhancement
  if (enhancement.type === 'io-generic') {
    const genericEnh = enhancement as GenericIOEnhancement;
    return (
      <div className="space-y-1.5 max-w-[250px]">
        <div className="flex items-center gap-2">
          <GenericIOIcon
            stat={genericEnh.stat}
            size={24}
            alt={enhancement.name}
            className="flex-shrink-0"
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--color-link)] leading-tight">{enhancement.name}</h3>
            <span className="text-[11px] text-slate-300">Generic IO</span>
          </div>
        </div>
        <div className="text-xs">
          <span className="text-slate-300">Enhances: </span>
          <span className="text-green-400">{genericEnh.stat}</span>
          <span className="text-slate-300"> by </span>
          <span className="text-green-400">
            {(genericEnh.value * enhancementLevelMultiplier(enhancement)).toFixed(1)}%
          </span>
        </div>
        <div className="text-xs flex gap-3">
          {enhancement.level && (
            <span className="text-slate-300">
              Level: <span className="text-slate-200">{enhancement.level}</span>
            </span>
          )}
          {slotLevel !== undefined && (
            slotLevel === null ? (
              <span className="text-red-400" title={UNPLACED_SLOT_TITLE}>
                No grantable level
              </span>
            ) : (
              <span className="text-slate-300">
                Slotted at Lvl <span className="text-slate-200">{slotLevel}</span>
              </span>
            )
          )}
          {enhancement.boost ? (
            <span className={levelOffsetClass(enhancement.boost)}>{levelOffsetLabel(enhancement.boost)}</span>
          ) : null}
        </div>
      </div>
    );
  }

  // Origin Enhancement (SO/DO/TO)
  if (enhancement.type === 'origin') {
    const originEnh = enhancement as OriginEnhancement;
    return (
      <div className="space-y-1.5 max-w-[250px]">
        <div className="flex items-center gap-2">
          <OriginEnhancementIcon
            stat={originEnh.stat}
            tier={originEnh.tier}
            origin={originEnh.origin}
            size={24}
            alt={enhancement.name}
            className="flex-shrink-0"
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--color-link)] leading-tight">{enhancement.name}</h3>
            <span className="text-[11px] text-slate-300">{originEnh.tier}</span>
          </div>
        </div>
        <div className="text-xs">
          <span className="text-slate-300">Enhances: </span>
          <span className="text-green-400">{originEnh.stat}</span>
          <span className="text-slate-300"> by </span>
          <span className="text-green-400">
            {(originEnh.value * enhancementLevelMultiplier(enhancement)).toFixed(1)}%
          </span>
        </div>
        {enhancement.boost ? (
          <div className={`text-xs ${levelOffsetClass(enhancement.boost)}`}>{levelOffsetLabel(enhancement.boost)}</div>
        ) : null}
      </div>
    );
  }

  // Special Enhancement (Hamidon, etc.)
  if (enhancement.type === 'special') {
    const specialEnh = enhancement as SpecialEnhancement;
    // Extract icon filename from the full path if needed
    const iconName = specialEnh.icon?.includes('/')
      ? specialEnh.icon.split('/').pop() || 'Unknown.png'
      : specialEnh.icon || 'Unknown.png';

    return (
      <div className="space-y-1.5 max-w-[250px]">
        <div className="flex items-center gap-2">
          <SpecialEnhancementIcon
            icon={iconName}
            size={24}
            alt={enhancement.name}
            className="flex-shrink-0"
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-purple-400 leading-tight">{enhancement.name}</h3>
            <span className="text-[11px] text-slate-300 capitalize">{specialEnh.category}</span>
          </div>
        </div>
        <div className="text-xs">
          <span className="text-slate-300">Enhances: </span>
          <span className="text-green-400">
            {specialEnh.aspects.map(a => {
              const boosted = a.value * enhancementLevelMultiplier(enhancement);
              return `${a.stat} +${boosted.toFixed(1)}%`;
            }).join(', ')}
          </span>
        </div>
        {enhancement.boost ? (
          <div className={`text-xs ${levelOffsetClass(enhancement.boost)}`}>{levelOffsetLabel(enhancement.boost)}</div>
        ) : null}
      </div>
    );
  }

  return <div className="text-slate-400 text-xs">Unknown enhancement type</div>;
}
