/**
 * Calculated Stats Hooks
 *
 * These hooks compute derived statistics from the build state using
 * the unified calculation system that handles:
 * - Set bonuses with Rule of 5
 * - Active power buffs
 * - Inherent power bonuses
 * - Stat breakdown tracking for tooltips
 */

import { useEffect, useMemo } from 'react';
import { useBuildStore, useUIStore } from '@/stores';
import { loadDataset, projectPowerJson, targetRanksJson, type ServerId } from '@/engine/engine';
import { useEngineStore } from '@/engine/engineStore';
import { mapOnePowerProjection, projectionKey, type EnginePowerProjection, type PowerDamage, type PowerProjection } from '@/engine/engineTotalsMap';
import { getIOSet } from '@/data';
import { computeOffendingPowerReasons, type CappedBonusReason } from '@/utils/over-cap-mute';
import type { Build, SetBonus } from '@/types';
import type { ProcSettings } from '@/stores/uiStore';
import type { BonusTracking } from '@/utils/calculations';
import {
  calculateCharacterTotals,
  type CharacterStats,
  type CharacterCalculationResult,
  type DashboardStatBreakdown,
  type StatSource,
} from '@/utils/calculations';

/** All procs disabled — used when master Proc toggle is off */
const ALL_PROCS_DISABLED: ProcSettings = {
  damage: false, recovery: false, regeneration: false, recharge: false,
  toHit: false, defense: false, resistance: false, buildUp: false, movement: false,
};

// ============================================
// RE-EXPORT TYPES
// ============================================

export type { CharacterStats, DashboardStatBreakdown, StatSource };

// ============================================
// LEGACY INTERFACE (for backward compatibility)
// ============================================

export interface CalculatedStats {
  // Damage
  damageBuff: number;

  // Accuracy
  accuracyBuff: number;
  toHitBuff: number;

  // Recharge
  rechargeBuff: number;

  // Endurance
  enduranceReduction: number;
  maxEndurance: number;
  recoveryBuff: number;

  // Defense (by type)
  defense: {
    smashing: number;
    lethal: number;
    fire: number;
    cold: number;
    energy: number;
    negative: number;
    psionic: number;
    toxic: number;
    melee: number;
    ranged: number;
    aoe: number;
  };

  // Resistance (by type)
  resistance: {
    smashing: number;
    lethal: number;
    fire: number;
    cold: number;
    energy: number;
    negative: number;
    psionic: number;
    toxic: number;
  };

  // Health
  maxHP: number;
  hpBuff: number;
  regenBuff: number;

  // Movement
  runSpeed: number;
  jumpHeight: number;
  jumpSpeed: number;
  flySpeed: number;

  // Mez Resistance
  mezResistance: {
    hold: number;
    stun: number;
    immobilize: number;
    sleep: number;
    confuse: number;
    fear: number;
    knockback: number;
  };

  // Mez Protection (magnitude points)
  mezProtection: {
    hold: number;
    stun: number;
    immobilize: number;
    sleep: number;
    confuse: number;
    fear: number;
    knockback: number;
  };

  // Debuff Resistance
  debuffResistance: {
    slow: number;
    defense: number;
    recharge: number;
    endurance: number;
    recovery: number;
    tohit: number;
    regeneration: number;
    perception: number;
    // data-gaps-171. Off `global`, not `charStats`: neither has a CharacterStats twin.
    accuracy: number;
    range: number;
  };

  // Global modifiers from set bonuses
  globalRecharge: number;
  globalAccuracy: number;
  globalDamage: number;
}

// ============================================
// CONVERSION HELPERS
// ============================================

/**
 * Convert new CharacterStats to legacy CalculatedStats format
 */
export function convertToLegacyStats(
  charStats: CharacterStats,
  result: CharacterCalculationResult
): CalculatedStats {
  const global = result.globalBonuses;

  return {
    // Offense
    damageBuff: charStats.damage,
    accuracyBuff: charStats.accuracy,
    toHitBuff: charStats.tohit,
    rechargeBuff: charStats.recharge,
    enduranceReduction: charStats.endrdx,
    maxEndurance: 100 + global.maxEndurance,
    recoveryBuff: charStats.recovery,

    // Defense
    defense: {
      smashing: global.defSmashing,
      lethal: global.defLethal,
      fire: global.defFire,
      cold: global.defCold,
      energy: global.defEnergy,
      negative: global.defNegative,
      psionic: global.defPsionic,
      toxic: global.defToxic,
      melee: global.defMelee,
      ranged: global.defRanged,
      aoe: global.defAoE,
    },

    // Resistance
    resistance: {
      smashing: global.resSmashing,
      lethal: global.resLethal,
      fire: global.resFire,
      cold: global.resCold,
      energy: global.resEnergy,
      negative: global.resNegative,
      psionic: global.resPsionic,
      toxic: global.resToxic,
    },

    // Health
    maxHP: global.maxHP,
    hpBuff: global.maxHP,
    regenBuff: charStats.regeneration,

    // Movement
    runSpeed: charStats.runspeed,
    jumpHeight: charStats.jumpheight,
    jumpSpeed: charStats.jumpspeed,
    flySpeed: charStats.flyspeed,

    // Mez Resistance: generic (from IO sets) + per-type (from active power effects).
    // Generic "Mez Resistance (All)" (global.mezResist) covers the six status
    // mezzes only — Knockback is NOT a status mez and is governed by its own
    // separate Knockback Resistance, so it does NOT pick up global.mezResist.
    mezResistance: {
      hold: global.mezResist + global.mezResistHold,
      stun: global.mezResist + global.mezResistStun,
      immobilize: global.mezResist + global.mezResistImmobilize,
      sleep: global.mezResist + global.mezResistSleep,
      confuse: global.mezResist + global.mezResistConfuse,
      fear: global.mezResist + global.mezResistFear,
      knockback: global.mezResistKnockback,
    },

    // Mez Protection (per-type magnitude from active powers + IO sets)
    mezProtection: {
      hold: global.protHold,
      stun: global.protStun,
      immobilize: global.protImmobilize,
      sleep: global.protSleep,
      confuse: global.protConfuse,
      fear: global.protFear,
      knockback: global.protKnockback,
    },

    // Debuff Resistance
    debuffResistance: {
      slow: charStats.debuffResistSlow,
      defense: charStats.debuffResistDefense,
      recharge: charStats.debuffResistRecharge,
      endurance: charStats.debuffResistEndurance,
      recovery: charStats.debuffResistRecovery,
      tohit: charStats.debuffResistToHit,
      regeneration: charStats.debuffResistRegeneration,
      perception: charStats.debuffResistPerception,
      accuracy: global.debuffResistAccuracy,
      range: global.debuffResistRange,
    },

    // Global modifiers
    globalRecharge: charStats.recharge,
    globalAccuracy: charStats.accuracy,
    globalDamage: charStats.damage,
  };
}

// ============================================
// SHARED CALCULATION CACHE
// ============================================

/**
 * Cross-instance memo. React's `useMemo` is scoped to one component instance and
 * is NOT shared, but the calc hooks below are consumed by many *per-instance*
 * components — every PowerRow (Bonus Cap rings), every PowerSlot (Rule-of-5
 * tracking), every PermaRing / PowerInfoTooltip / picker row (power projection)
 * — so a full build mounts ~150+ callers. Without a shared cache each instance
 * runs the entire (now engine-backed) `calculateCharacterTotals` on every state
 * change that touches a calc input, and that N× redundant recompute is the
 * ~0.5-1s click stall.
 *
 * All mounted consumers read the same store values within one render pass, so a
 * single-entry cache keyed on the exact dependency tuple collapses those N runs
 * into one: the first caller computes, every other caller in the same pass (and
 * until an input actually changes) reuses the result. `Object.is` per dep —
 * identical to what the per-instance `useMemo` compares — keeps it correct: any
 * real input change misses the cache and recomputes once.
 *
 * The KEY REQUIREMENT is that the dep tuple compares equal *across instances*.
 * Store values (Zustand refs, primitives) satisfy this; a value each instance
 * builds itself in its own `useMemo` (e.g. an `options` object) does NOT — it is
 * a fresh reference per instance and silently defeats the cache. `useCalculationContext`
 * is therefore itself routed through one of these shared memos so the `options`
 * object handed to the calc cache is one shared reference, not 150 equal-but-distinct ones.
 */
export function createSharedSingleEntryMemo<T>() {
  let cachedDeps: readonly unknown[] | null = null;
  let cachedResult: T | null = null;
  let filled = false;
  const get = (deps: readonly unknown[], compute: () => T): T => {
    if (
      filled &&
      cachedDeps !== null &&
      cachedDeps.length === deps.length &&
      cachedDeps.every((d, i) => Object.is(d, deps[i]))
    ) {
      return cachedResult as T;
    }
    const result = compute();
    cachedDeps = deps;
    cachedResult = result;
    filled = true;
    return result;
  };
  const reset = () => {
    cachedDeps = null;
    cachedResult = null;
    filled = false;
  };
  return { get, reset };
}

const sharedCalcMemo = createSharedSingleEntryMemo<CharacterCalculationResult>();
const sharedContextMemo = createSharedSingleEntryMemo<CalculationContext>();

/** Test-only: clear the shared caches so cases don't leak into each other. */
export function _resetSharedCalcCache(): void {
  sharedCalcMemo.reset();
  sharedContextMemo.reset();
}

export function getSharedCharacterCalculation(
  deps: readonly unknown[],
  compute: () => CharacterCalculationResult
): CharacterCalculationResult {
  return sharedCalcMemo.get(deps, compute);
}

// ============================================
// MAIN HOOKS
// ============================================

/**
 * Every non-build input `calculateCharacterTotals` takes, read from the stores once.
 *
 * Extracted so a surface that calculates a HYPOTHETICAL build — `CompareSlottingModal`, which
 * re-slots one power and shows the deltas — runs it under the *identical* context the current
 * numbers came from. Assembling that context a second time is how a delta ends up reporting a
 * difference in exemplar level or combat mode rather than in the slotting under test.
 */
export interface CalculationContext {
  exemplarMode: Parameters<typeof calculateCharacterTotals>[1];
  incarnateActive: Parameters<typeof calculateCharacterTotals>[2];
  options: Parameters<typeof calculateCharacterTotals>[3];
}

export function useCalculationContext(): CalculationContext {
  const exemplarMode = useUIStore((state) => state.exemplarMode);
  const exemplarLevel = useUIStore((state) => state.exemplarLevel);
  const incarnateActive = useUIStore((state) => state.incarnateActive);
  const incarnateLevelShift = useUIStore((state) => state.incarnateLevelShift);
  const procSettings = useUIStore((state) => state.procSettings);
  const procsEnabled = useUIStore((state) => state.includeProcDamageInDPS);
  const targetsHitValues = useUIStore((state) => state.targetsHitValues);
  const targetLevelOffset = useUIStore((state) => state.targetLevelOffset);
  const vigilanceTeamSize = useUIStore((state) => state.vigilanceTeamSize);
  const furyLevel = useUIStore((state) => state.furyLevel);
  const combatMode = useUIStore((state) => state.combatMode);
  const globalAdjusters = useUIStore((state) => state.globalAdjusters);
  const mechanicAdjusters = useUIStore((state) => state.mechanicAdjusters);
  const destinyTime = useUIStore((state) => state.destinyTime);
  const hybridTargetsHit = useUIStore((state) => state.hybridTargetsHit);
  // Display-only projection inputs (PROD6C-3k): they resolve each power's effective form.
  const dominationActive = useUIStore((state) => state.dominationActive);
  const stalkerHidden = useUIStore((state) => state.stalkerHidden);
  const whatIfBuffs = useUIStore((state) => state.whatIfBuffs);

  // When master Proc toggle is off, disable all proc categories
  const effectiveProcSettings = procsEnabled ? procSettings : ALL_PROCS_DISABLED;

  // Route through a shared single-entry memo so ALL instances get the SAME
  // context object reference (every dep here is a store value — a Zustand ref or
  // a primitive — so the tuple compares equal across instances). This is what
  // keeps the downstream `getSharedCharacterCalculation` cache effective: if each
  // instance built its own `options` object (a fresh ref per `useMemo`), the calc
  // cache would miss on every instance and every consumer would re-run the engine.
  return useMemo(() => {
    const deps = [exemplarMode, exemplarLevel, incarnateActive, incarnateLevelShift, effectiveProcSettings, targetsHitValues, targetLevelOffset, vigilanceTeamSize, furyLevel, combatMode, globalAdjusters, mechanicAdjusters, destinyTime, hybridTargetsHit, dominationActive, stalkerHidden, whatIfBuffs] as const;
    return sharedContextMemo.get(deps, () => ({
      exemplarMode,
      incarnateActive,
      options: {
        procSettings: effectiveProcSettings,
        targetsHitValues,
        exemplarLevel: exemplarMode ? exemplarLevel : undefined,
        targetLevelOffset,
        vigilanceTeamSize,
        furyLevel,
        incarnateLevelShift,
        combatMode,
        globalAdjusters,
        mechanicAdjusters,
        destinyTime,
        hybridTargetsHit,
        dominationActive,
        stalkerHidden,
        whatIfBuffs,
      },
    }));
  }, [exemplarMode, exemplarLevel, incarnateActive, incarnateLevelShift, effectiveProcSettings, targetsHitValues, targetLevelOffset, vigilanceTeamSize, furyLevel, combatMode, globalAdjusters, mechanicAdjusters, destinyTime, hybridTargetsHit, dominationActive, stalkerHidden, whatIfBuffs]);
}

/**
 * Full calculation result with breakdown data
 */
export function useCharacterCalculation(): CharacterCalculationResult {
  const build = useBuildStore((state) => state.build);
  const { exemplarMode, incarnateActive, options } = useCalculationContext();

  // SPIKE5 — load the engine dataset for this build's server once; `engineLoaded` flips the
  // memo below from boot-time empty totals to real engine numbers when the wasm handle is ready.
  const engineLoaded = useEngineStore((state) => state.loaded[build.serverId] ?? false);
  useEffect(() => {
    loadDataset(build.serverId as ServerId)
      .then(() => useEngineStore.getState().markLoaded(build.serverId))
      .catch((e) => useEngineStore.getState().setError(String(e)));
  }, [build.serverId]);

  // The per-instance useMemo skips work when THIS component re-renders with
  // unchanged deps; the shared cache (keyed on the same dep tuple) skips the
  // redundant recompute ACROSS the ~150 other instances in the same render pass.
  return useMemo(() => {
    const deps = [build, exemplarMode, incarnateActive, options, engineLoaded] as const;
    return getSharedCharacterCalculation(deps, () =>
      calculateCharacterTotals(build, exemplarMode, incarnateActive, options)
    );
  }, [build, exemplarMode, incarnateActive, options, engineLoaded]);
}

/**
 * The same calculation over a build the user has not committed — "what would this slotting do".
 *
 * Deliberately outside the shared cache: the cache is keyed on the store state every other
 * consumer shares, and a hypothetical build is by definition not that. `null` for no override,
 * so a caller can hold the hook unconditionally and pay nothing when no comparison is open.
 */
export function useHypotheticalCalculation(
  hypotheticalBuild: Build | null,
): CharacterCalculationResult | null {
  const serverId = useBuildStore((state) => state.build.serverId);
  const engineLoaded = useEngineStore((state) => state.loaded[serverId] ?? false);
  const { exemplarMode, incarnateActive, options } = useCalculationContext();

  return useMemo(() => {
    if (!hypotheticalBuild) return null;
    return calculateCharacterTotals(hypotheticalBuild, exemplarMode, incarnateActive, options);
  }, [hypotheticalBuild, exemplarMode, incarnateActive, options, engineLoaded]);
}

/**
 * Calculate all derived stats from the current build (legacy format).
 *
 * This is *definitionally* `convertToLegacyStats(useCharacterCalculation())` —
 * it consumes the single shared calculation rather than running
 * `calculateCharacterTotals` a second time. Previously it recomputed with a
 * different option set (it omitted `targetLevelOffset`), so the legacy-stats
 * view and the breakdown view could transiently disagree and the engine ran
 * twice on every render of the dashboard/totals modal.
 */
export function useCalculatedStats(): CalculatedStats {
  const result = useCharacterCalculation();
  return useMemo(() => convertToLegacyStats(result.stats, result), [result]);
}

/**
 * Get global bonuses that affect all powers
 */
export function useGlobalBonuses() {
  const result = useCharacterCalculation();
  return result.globalBonuses;
}

/**
 * Get breakdown for a specific stat (for tooltips)
 */
export function useStatBreakdown(stat: string): DashboardStatBreakdown | undefined {
  const result = useCharacterCalculation();
  return result.breakdown.get(stat);
}

/**
 * Get the full per-stat breakdown map (every contributing source, including
 * always-on proc globals). The Set Bonus Totals popup uses this to fold proc
 * globals (LotG +Recharge, etc.) into the set-bonus rows.
 */
export function useStatBreakdowns(): Map<string, DashboardStatBreakdown> {
  const result = useCharacterCalculation();
  return result.breakdown;
}

/**
 * One power's engine-resolved non-DPS values — the execution three-tiers, ArcanaTime, perma
 * tracking, and the buff/debuff magnitudes it grants (PROD6C).
 *
 * A power the build HOLDS comes out of the calculation's own projection at no extra cost. A
 * power it does not — the info surfaces render whatever you hover in the picker — is projected
 * on demand against the exact `CharacterState` those totals ran on, so a hovered power's
 * numbers come from the same engine pass as a picked one's rather than from a second
 * calculator. The on-demand call costs one engine run per distinct power, memoized here.
 *
 * `null` while the dataset is still loading, and for a ref the dataset has no power for — the
 * caller renders the row as unavailable rather than substituting a fabricated value (Rule 1).
 */
export function usePowerProjection(
  powerSet: string | undefined,
  internalName: string | undefined,
): PowerProjection | null {
  const result = useCharacterCalculation();
  const serverId = useBuildStore((state) => state.build.serverId);
  // The slider value the display bag's per-target transform reads (PROD6C-3b). A HELD power
  // carries it on its own selection, so only the on-demand call below needs it passed.
  const targetsHit = useUIStore((state) => (internalName ? state.targetsHitValues[internalName] : undefined));
  const { powerProjection, engineStateJson } = result;

  return useMemo(() => {
    if (!powerSet || !internalName) return null;
    const held = powerProjection.get(projectionKey(powerSet, internalName));
    if (held) return held;
    if (engineStateJson === null) return null;

    const json = projectPowerJson(serverId as ServerId, engineStateJson, powerSet, internalName, targetsHit);
    if (json === null) return null;
    const projected = JSON.parse(json) as EnginePowerProjection | null;
    return projected ? mapOnePowerProjection(projected) : null;
  }, [powerSet, internalName, powerProjection, engineStateJson, serverId, targetsHit]);
}

/** One rank from the engine's target vocabulary — the export's own segment + class tokens. */
interface TargetRankEntry {
  segment: string;
  classes: string[];
}

/** Per-server cache: the vocabulary is a corpus walk on the wasm side, and it only changes
 *  with the dataset, so one derivation per server is the right cost. */
const targetRanksCache = new Map<ServerId, TargetRankEntry[]>();

/**
 * The class token to evaluate a rank's gates against — the first class in the rank's sorted
 * list, the same "stable choice, not a preferred flavour" the rebuild's
 * `TargetRank::representative` makes. The vocabulary is the engine's own (`target_ranks`,
 * derived from the gates), so no rank or class name is authored on this side. `null` until
 * the dataset loads, or when this dataset's gates never name the segment — the caller shows
 * nothing rather than guessing a target.
 */
function targetClassForSegment(server: ServerId, segment: string): string | null {
  let ranks = targetRanksCache.get(server);
  if (!ranks) {
    const json = targetRanksJson(server);
    if (json === null) return null;
    ranks = JSON.parse(json) as TargetRankEntry[];
    targetRanksCache.set(server, ranks);
  }
  return ranks.find((r) => r.segment === segment)?.classes[0] ?? null;
}

/**
 * This power's damage ledger resolved against a critter target of `rankSegment` — what the
 * Damage block's "w/ Crit" column reads (the Scrapper crit is rank-forked rows in the
 * power's own data, so it only resolves once a target rank is named).
 *
 * Runs the projection on the SAME `CharacterState` the totals ran on, with only the target
 * identity overridden — so the certain components match the panel's own damage, and the
 * rank-forked rows resolve instead of sitting in `unresolved`. Pass `undefined` power refs
 * to skip the engine run entirely (a projection is a full totals pass).
 */
export function usePowerDamageVsRank(
  powerSet: string | undefined,
  internalName: string | undefined,
  rankSegment: string,
): PowerDamage | null {
  const result = useCharacterCalculation();
  const serverId = useBuildStore((state) => state.build.serverId) as ServerId;
  const targetsHit = useUIStore((state) => (internalName ? state.targetsHitValues[internalName] : undefined));
  const { engineStateJson } = result;

  return useMemo(() => {
    if (!powerSet || !internalName || engineStateJson === null) return null;
    const targetClass = targetClassForSegment(serverId, rankSegment);
    if (targetClass === null) return null;
    const state = JSON.parse(engineStateJson) as { combat?: Record<string, unknown> };
    state.combat = { ...(state.combat ?? {}), target_class: targetClass, target_is_player: false };
    const json = projectPowerJson(serverId, JSON.stringify(state), powerSet, internalName, targetsHit);
    if (json === null) return null;
    const projected = JSON.parse(json) as EnginePowerProjection | null;
    return projected ? mapOnePowerProjection(projected).damage : null;
  }, [powerSet, internalName, engineStateJson, serverId, targetsHit, rankSegment]);
}

// ============================================
// SLOT COUNTING HOOKS
// ============================================

/**
 * Count total enhancement slots used
 */
export function useTotalSlotsUsed(): number {
  return useBuildStore((state) => state.getTotalSlotsUsed());
}

/**
 * Count remaining enhancement slots
 */
export function useSlotsRemaining(): number {
  return useBuildStore((state) => state.getSlotsRemaining());
}

/**
 * Get all active set bonuses with details
 */
export function useActiveSetBonuses(): Array<{
  setId: string;
  setName: string;
  piecesSlotted: number;
  bonuses: SetBonus[];
}> {
  const build = useBuildStore((state) => state.build);

  return useMemo(() => {
    const results: Array<{
      setId: string;
      setName: string;
      piecesSlotted: number;
      bonuses: SetBonus[];
    }> = [];

    for (const [setId, tracking] of Object.entries(build.sets)) {
      const ioSet = getIOSet(setId);
      if (!ioSet) continue;

      const activeBonuses = ioSet.bonuses.filter((b) => b.pieces <= tracking.count);

      if (activeBonuses.length > 0) {
        results.push({
          setId,
          setName: ioSet.name,
          piecesSlotted: tracking.count,
          bonuses: activeBonuses,
        });
      }
    }

    return results;
  }, [build.sets]);
}

/**
 * Get Rule of 5 bonus tracking data for displaying (x/5) indicators
 */
export function useBonusTracking(): BonusTracking {
  const result = useCharacterCalculation();
  return result.bonusTracking;
}

/** A specific Rule-of-5-capped bonus a power contributes — the human-readable
 *  stat label and its value, pre-formatted for display (e.g. "Mez Resistance",
 *  "+10%"). Drives the orange-ring tooltip so the user can see *which* bonus is
 *  over the cap — often a hidden component bundled into a differently-named set
 *  bonus (a resistance set silently carrying Mez Resistance, etc.). */
export type { CappedBonusReason };

/**
 * Map of `power.name` → the distinct Rule-of-5-capped bonuses it contributes.
 * A power is "offending" if it feeds *any* (pool, stat, value) bucket that's hit
 * the cap — including the 5 accepted sources, not just the rejected 6th+, since
 * the powers in a full bucket are interchangeable (unslotting any one resolves
 * it). Set bonuses and proc globals cap in separate pools; see `CAP_POOL` in
 * over-cap-mute.ts for why that axis is part of the bucket identity.
 *
 * The reasons name the specific capped stat + value so the orange-ring tooltip
 * can explain *why* a power is flagged — crucial when the culprit is a hidden
 * component (e.g. the "+10% Mez Resistance (All)" silently bundled into a
 * resistance set bonus), which the user would never spot by checking the
 * headline stat. Empty map when Bonus Cap Alert is disabled.
 */
export function useOffendingPowerReasons(): Map<string, CappedBonusReason[]> {
  const enabled = useUIStore((s) => s.ruleOf5AlertEnabled);
  const muted = useBuildStore((s) => s.build.mutedOverCapStats);
  const { breakdown } = useCharacterCalculation();
  return useMemo(
    () => computeOffendingPowerReasons(breakdown, enabled, muted),
    [breakdown, enabled, muted],
  );
}

/**
 * Set of `power.name` values that contribute to any Rule-of-5-capped bucket.
 * Thin wrapper over {@link useOffendingPowerReasons} for callers that only need
 * membership (the ring on/off decision).
 */
export function useOffendingPowerNames(): Set<string> {
  const reasons = useOffendingPowerReasons();
  return useMemo(() => new Set(reasons.keys()), [reasons]);
}
