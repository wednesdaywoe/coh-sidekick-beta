/**
 * CompareSlottingModal - Compare different enhancement configurations for a power
 *
 * Opens from the slot context menu. Users can create multiple copies of a power
 * with different slotting, hover to compare stats in real-time, and apply a
 * chosen configuration to their build.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useBuildStore, useUIStore } from '@/stores';
import { getBaseToHit } from '@/data/purple-patch';
import { lookupPower, getIOSet, getPowerIconPath } from '@/data';
import { calculatePowerEnhancementBonuses } from '@/utils/calculations/enhancement-values';
import { calculatePowerDamage } from '@/utils/calculations/damage';
import { getAlphaEnhancementBonuses } from '@/utils/calculations/character-totals';
import { computeSetTracking } from '@/utils/calculations/set-tracking';
import { projectionKey } from '@/engine/engineTotalsMap';
import { getBaselineHealth } from '@/utils/calculations/stats';
import { useGlobalBonuses, useCharacterCalculation, useHypotheticalCalculation, convertToLegacyStats } from '@/hooks';
import { convertGlobalBonusesToAspects, withStrengthBonuses, findSelectedPowerInBuild } from '@/components/info/powerDisplayUtils';
import { buildDisplayEffects } from '@/components/info/buildDisplayEffects';
import { magnitudesFromProjection } from '@/components/info/magnitudesFromProjection';
import { STAT_DEFINITIONS } from '@/data/stat-definitions';
import type { StatValue } from '@/data/stat-definitions';

import { RegistryEffectsDisplay } from '@/components/info/SharedPowerComponents';
import { PetDamageDisplay } from '@/components/info/InfoPanel';
import { SetBonusSummary } from '@/components/enhancements/SetBonusDisplay';
import { SlottedEnhancementIcon } from '@/components/powers/SlottedEnhancementIcon';
import { resolvePath } from '@/utils/paths';
import { Modal, ModalBody } from './Modal';
import type { Enhancement, ArchetypeId, SetBonus } from '@/types';
import type { ComparisonCopy } from '@/stores';
import type { EnhancementBonuses } from '@/utils/calculations/enhancement-values';

/** Row 0 — the live mirror of the build's actual slotting. Never stored. */
const CURRENT_COPY_ID = 0;

/**
 * Force a saved copy to the power's current slot count. A copy is a fixed-length
 * array captured when it was made; the user can add or remove slots on the real
 * power afterwards, and a mismatched length would otherwise render the wrong
 * number of circles and let Apply write past the end of the power.
 */
export function reconcileLength(
  slots: (Enhancement | null)[],
  slotCount: number
): (Enhancement | null)[] {
  if (slots.length === slotCount) return slots;
  if (slots.length > slotCount) return slots.slice(0, slotCount);
  return [...slots, ...new Array<Enhancement | null>(slotCount - slots.length).fill(null)];
}

/**
 * Apply one slot edit to a saved row, against whatever the store holds *now*.
 * Kept pure and separate from the component because it must run off the store's
 * latest value rather than a render snapshot: slotting a multi-piece selection
 * calls this once per piece within a single tick, and a snapshot-based write
 * would land only the last piece.
 */
export function applySlotEditToStoredCopies(
  stored: ComparisonCopy[],
  copyId: number,
  slotCount: number,
  mapSlots: (slots: (Enhancement | null)[]) => (Enhancement | null)[]
): ComparisonCopy[] {
  return stored.map((c) => {
    const slots = reconcileLength(c.slots, slotCount);
    return c.id === copyId ? { ...c, slots: mapSlots(slots) } : { ...c, slots };
  });
}

export function CompareSlottingModal() {
  const isOpen = useUIStore((s) => s.compareSlottingOpen);
  const compareTarget = useUIStore((s) => s.compareSlottingPower);
  const closeModal = useUIStore((s) => s.closeCompareSlotting);
  const openCompareSlotting = useUIStore((s) => s.openCompareSlotting);
  const openEnhancementPicker = useUIStore((s) => s.openEnhancementPicker);
  const setStoredCopies = useUIStore((s) => s.setCompareSlottingCopies);

  const build = useBuildStore((s) => s.build);
  const setEnhancement = useBuildStore((s) => s.setEnhancement);
  const clearEnhancement = useBuildStore((s) => s.clearEnhancement);

  const globalBonuses = useGlobalBonuses();
  const targetLevelOffset = useUIStore((s) => s.targetLevelOffset);
  const incarnateActive = useUIStore((s) => s.incarnateActive);

  // Row 0's slots. Local because the row mirrors the build: it re-seeds
  // whenever the real slotting changes, so nothing worth keeping lives here.
  const [currentSlots, setCurrentSlots] = useState<(Enhancement | null)[]>([]);
  const [hoveredCopyId, setHoveredCopyId] = useState<number | null>(null);
  const [appliedCopyId, setAppliedCopyId] = useState<number | null>(null);

  const targetKey = compareTarget
    ? `${compareTarget.powerSet}::${compareTarget.powerName}`
    : null;

  // The user-made rows for this power, surviving close/reopen and power switching.
  const storedCopies = useUIStore((s) => (targetKey ? s.compareSlottingCopies[targetKey] : undefined));

  // Resolve the power definition
  const lookupResult = useMemo(() => {
    if (!compareTarget) return null;
    return lookupPower(compareTarget.powerSet, compareTarget.powerName) ?? null;
  }, [compareTarget]);
  const power = lookupResult?.power ?? null;

  // Find the current build slotting
  const selectedPower = useMemo(() => {
    if (!compareTarget) return null;
    return findSelectedPowerInBuild(compareTarget.powerName, compareTarget.powerSet, build);
  }, [compareTarget, build]);

  // Build list of all slotted powers for the power selector dropdown
  const allBuildPowers = useMemo(() => {
    const powers: { name: string; internalName: string; powerSet: string; category: string }[] = [];
    for (const p of build.primary.powers) {
      powers.push({ name: p.name, internalName: p.internalName, powerSet: p.powerSet, category: build.primary.name });
    }
    for (const p of build.secondary.powers) {
      powers.push({ name: p.name, internalName: p.internalName, powerSet: p.powerSet, category: build.secondary.name });
    }
    for (const pool of build.pools) {
      for (const p of pool.powers) {
        powers.push({ name: p.name, internalName: p.internalName, powerSet: p.powerSet, category: pool.name });
      }
    }
    if (build.epicPool) {
      for (const p of build.epicPool.powers) {
        powers.push({ name: p.name, internalName: p.internalName, powerSet: p.powerSet, category: build.epicPool.name });
      }
    }
    for (const p of build.inherents) {
      if (p.slots.length > 0) {
        powers.push({ name: p.name, internalName: p.internalName, powerSet: p.powerSet || 'Inherent', category: 'Inherent' });
      }
    }
    return powers;
  }, [build]);

  // Group powers by category for optgroup rendering
  const powersByCategory = useMemo(() => {
    const groups = new Map<string, { name: string; internalName: string; powerSet: string }[]>();
    for (const p of allBuildPowers) {
      if (!groups.has(p.category)) groups.set(p.category, []);
      groups.get(p.category)!.push({ name: p.name, internalName: p.internalName, powerSet: p.powerSet });
    }
    return groups;
  }, [allBuildPowers]);

  // Re-seed the "Current" row from the build. Keyed on the build's actual
  // slotting (not just the power name) so applying a copy — or slotting the
  // power outside this modal — is reflected here instead of leaving row 0
  // showing a snapshot that silently disagrees with the build. `isOpen` is a
  // dep for the same reason: row 0 is a mirror, so it starts each visit at
  // what the build actually holds, and scratch edits to it don't outlive the
  // session the way the saved rows do.
  const buildSlotsSignature = useMemo(
    () => JSON.stringify(selectedPower?.slots ?? []),
    [selectedPower]
  );
  useEffect(() => {
    setCurrentSlots(selectedPower ? [...selectedPower.slots] : []);
  }, [isOpen, targetKey, buildSlotsSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hover/apply highlighting is about the row under the cursor, so it means
  // nothing once the power changes.
  useEffect(() => {
    setHoveredCopyId(null);
    setAppliedCopyId(null);
  }, [targetKey]);

  // Current row first, then the saved rows — each forced to the power's
  // present slot count, so every consumer below sees correct-length arrays.
  const copies = useMemo<ComparisonCopy[]>(() => {
    if (!selectedPower) return [];
    const slotCount = selectedPower.slots.length;
    return [
      { id: CURRENT_COPY_ID, slots: reconcileLength(currentSlots, slotCount) },
      ...(storedCopies ?? []).map((c) => ({ ...c, slots: reconcileLength(c.slots, slotCount) })),
    ];
  }, [selectedPower, currentSlots, storedCopies]);

  // Replace the whole saved-row list — adding, duplicating and removing rows,
  // each of which is one write per gesture. Always fed from `copies`, which is
  // already length-reconciled, so a stale-length copy is repaired the first time
  // it is touched rather than being written back short. Slot edits do NOT come
  // through here: they can arrive several to a tick, so they go through the
  // store's updater form instead.
  const commitCopies = useCallback((next: ComparisonCopy[]) => {
    if (targetKey) setStoredCopies(targetKey, next);
  }, [targetKey, setStoredCopies]);

  const updateCopySlots = useCallback((
    copyId: number,
    mapSlots: (slots: (Enhancement | null)[]) => (Enhancement | null)[]
  ) => {
    if (copyId === CURRENT_COPY_ID) {
      setCurrentSlots((prev) => mapSlots(prev));
      return;
    }
    if (!targetKey || !selectedPower) return;
    const slotCount = selectedPower.slots.length;
    setStoredCopies(targetKey, (prev) =>
      applySlotEditToStoredCopies(prev, copyId, slotCount, mapSlots)
    );
  }, [targetKey, selectedPower, setStoredCopies]);

  // Computed values shared across copies. Strength folded in for the same reason
  // the InfoPanel and the picker tooltip do it — the +Strength self-buffs are part
  // of the Final column, and a comparison that omitted them would rank slottings
  // against different numbers than the panel the user opened it from.
  const globalBonusesForCalc = useMemo(
    () => withStrengthBonuses(convertGlobalBonusesToAspects(globalBonuses), globalBonuses),
    [globalBonuses]
  );

  const alphaBonuses = useMemo<EnhancementBonuses>(
    () => getAlphaEnhancementBonuses(build.incarnates, incarnateActive),
    [build.incarnates, incarnateActive]
  );

  const archetypeId = build.archetype.id;
  const mergedEffects = useMemo(
    () => (power && compareTarget ? buildDisplayEffects(power) : {}),
    [power, compareTarget]
  );

  const exemplarMode = useUIStore((s) => s.exemplarMode);
  const exemplarLevel = useUIStore((s) => s.exemplarLevel);

  // Compute enhancement bonuses for a set of slots
  const computeBonuses = useCallback((slots: (Enhancement | null)[]) => {
    if (!power) return {};
    const bonuses = calculatePowerEnhancementBonuses(
      { name: power.name, slots },
      build.level,
      getIOSet,
      exemplarMode ? exemplarLevel : undefined
    );
    // Merge alpha bonuses
    for (const [aspect, value] of Object.entries(alphaBonuses)) {
      if (value !== undefined) bonuses[aspect] = (bonuses[aspect] || 0) + value;
    }
    return bonuses;
  }, [power, build.level, alphaBonuses, exemplarMode, exemplarLevel]);

  // Compute damage for a set of slots
  const computeDamage = useCallback((enhBonuses: EnhancementBonuses) => {
    if (!power?.damage || !compareTarget) return null;
    const isPrimary = compareTarget.powerSet === build.primary.id;
    const isSecondary = compareTarget.powerSet === build.secondary.id;
    const powersetCategory = isPrimary ? 'PRIMARY' : isSecondary ? 'SECONDARY' : undefined;
    return calculatePowerDamage(
      power,
      {
        level: build.level,
        archetypeId: archetypeId as ArchetypeId | undefined,
        primaryName: lookupResult?.powersetName || '',
        primaryCategory: powersetCategory,
      },
      { damage: enhBonuses.damage || 0 },
      globalBonusesForCalc.damage ?? 0,
      0
    );
  }, [power, compareTarget, build.level, archetypeId, globalBonusesForCalc.damage, build.primary.id, build.secondary.id, lookupResult]);

  // The copy being displayed in the info panel (hovered or first)
  const activeCopy = hoveredCopyId !== null
    ? copies.find(c => c.id === hoveredCopyId) ?? copies[0]
    : copies[0];

  // The build as it would be with the active copy's slots on the target power. Assembling it
  // here rather than inside the calculation memo is what lets ONE engine run serve both the
  // dashboard deltas below and the per-power numbers the effect rows read (PROD6D).
  const hypotheticalBuild = useMemo(() => {
    if (!activeCopy || !compareTarget) return null;

    const replacePower = <T extends { name: string; internalName: string; slots: (Enhancement | null)[] }>(p: T): T =>
      p.internalName === compareTarget.powerName ? { ...p, slots: [...activeCopy.slots] } : p;

    const hypoBuild = {
      ...build,
      primary: { ...build.primary, powers: build.primary.powers.map(replacePower) },
      secondary: { ...build.secondary, powers: build.secondary.powers.map(replacePower) },
      pools: build.pools.map(pool => ({ ...pool, powers: pool.powers.map(replacePower) })),
      epicPool: build.epicPool
        ? { ...build.epicPool, powers: build.epicPool.powers.map(replacePower) }
        : null,
      inherents: build.inherents.map(replacePower),
      sets: {} as typeof build.sets, // placeholder, computed below
    };
    hypoBuild.sets = computeSetTracking(hypoBuild);
    return hypoBuild;
  }, [activeCopy, compareTarget, build]);

  // Run under the SAME context the current column came from — `useHypotheticalCalculation`
  // reads it from the one place `useCharacterCalculation` does, so a delta can only report the
  // slotting under test and never a difference in exemplar level, target level or combat mode.
  const hypotheticalResult = useHypotheticalCalculation(hypotheticalBuild);

  // The projection for the target power under the hypothetical slotting — the engine already
  // resolved it while computing the dashboard deltas above, so nothing here recomputes it
  // (PROD6D). `null` until the dataset is loaded; `computeBonuses` covers that boot window.
  const activeProjection = useMemo(
    () => (hypotheticalResult && compareTarget
      ? hypotheticalResult.powerProjection.get(
          projectionKey(compareTarget.powerSet, compareTarget.powerName)
        ) ?? null
      : null),
    [hypotheticalResult, compareTarget]
  );

  const activeEnhBonuses = useMemo(
    () => activeProjection?.enhancementBonuses
      ?? (activeCopy ? computeBonuses(activeCopy.slots) : {}),
    [activeProjection, activeCopy, computeBonuses]
  );

  // The effect rows, taken from that same projection rather than resolved from the display bag
  // (data-gaps-329, carried here 2026-09-07). The engine seeds its rows from the power's ATOMS, so
  // it resolves a power whose authored `effects` data-gaps-327 removed; `buildDisplayEffects` alone
  // mints only its own keys and this panel rendered almost nothing. The rows answer the
  // hypothetical slotting because `activeProjection` IS the hypothetical run — the same one
  // `activeEnhBonuses` and the dashboard deltas read. `undefined` until the engine has loaded,
  // which is the window the bag path still covers.
  const effectRows = useMemo(
    () => (activeProjection ? magnitudesFromProjection(activeProjection.grantedMagnitudes) : undefined),
    [activeProjection]
  );

  const activeDamage = useMemo(
    () => computeDamage(activeEnhBonuses),
    [computeDamage, activeEnhBonuses]
  );

  const iconSrc = power ? getPowerIconPath(power.icon) : '';

  // ============================================
  // SET BONUSES for active copy
  // ============================================
  const activeSetBonuses = useMemo(() => {
    if (!activeCopy) return [];

    // Group slotted IO-set enhancements by setId
    const setsInPower: Record<string, Set<number>> = {};
    for (const slot of activeCopy.slots) {
      if (!slot || slot.type !== 'io-set') continue;
      const { setId, pieceNum } = slot as Enhancement & { setId: string; pieceNum: number };
      if (!setsInPower[setId]) setsInPower[setId] = new Set();
      setsInPower[setId].add(pieceNum);
    }

    const results: Array<{
      setId: string;
      setName: string;
      totalPieces: number;
      slottedPieces: number;
      bonuses: SetBonus[];
    }> = [];

    for (const [setId, pieces] of Object.entries(setsInPower)) {
      const ioSet = getIOSet(setId);
      if (!ioSet) continue;
      const slottedPieces = pieces.size;
      if (slottedPieces < 2) continue; // Need at least 2 pieces for any bonus
      results.push({
        setId,
        setName: ioSet.name,
        totalPieces: ioSet.pieces.length,
        slottedPieces,
        bonuses: ioSet.bonuses,
      });
    }

    return results;
  }, [activeCopy]);

  // ============================================
  // DASHBOARD STATS: hypothetical build calculation
  // ============================================
  const statsConfig = useUIStore((s) => s.statsConfig);

  const currentCalcResult = useCharacterCalculation();

  const health = useMemo(
    () => getBaselineHealth(build.archetype?.id ?? undefined, build.level),
    [build.archetype?.id, build.level]
  );
  const baseHP = health.baseHealth;
  const maxHPCap = health.maxHealth;

  // Current stats in legacy format (for STAT_DEFINITIONS getValue)
  const currentLegacyStats = useMemo(
    () => convertToLegacyStats(currentCalcResult.stats, currentCalcResult),
    [currentCalcResult]
  );

  // Visible dashboard stat IDs (filtered to those that exist in STAT_DEFINITIONS)
  const visibleStatIds = useMemo(() =>
    statsConfig
      .filter((c) => c.visible && STAT_DEFINITIONS[c.stat])
      .sort((a, b) => a.order - b.order)
      .map((c) => c.stat),
    [statsConfig]
  );


  const hypotheticalLegacyStats = useMemo(
    () => (hypotheticalResult && visibleStatIds.length > 0
      ? convertToLegacyStats(hypotheticalResult.stats, hypotheticalResult)
      : null),
    [hypotheticalResult, visibleStatIds.length]
  );

  // Helper: extract numeric value from a StatValue for delta computation
  const getNumericValue = useCallback((v: StatValue): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseFloat(v) || 0;
    if (typeof v === 'object' && v !== null) {
      if ('protection' in v) return v.protection; // MezStatValue: compare protection
      if ('buff' in v) return v.buff; // CompoundStatValue: compare buff %
      if ('first' in v) return Math.max((v as { first: number; second: number }).first, (v as { first: number; second: number }).second); // PairedStatValue: use max for comparison
    }
    return 0;
  }, []);

  // Handler: open picker for a comparison copy slot
  const handleSlotClick = useCallback((copyId: number, slotIndex: number) => {
    if (!compareTarget) return;
    const copy = copies.find(c => c.id === copyId);
    if (!copy) return;
    const overrideHandler = (si: number, enhancement: Enhancement) => {
      updateCopySlots(copyId, (slots) => slots.map((s, i) => (i === si ? enhancement : s)));
    };
    openEnhancementPicker(compareTarget.powerName, compareTarget.powerSet, slotIndex, overrideHandler, copy.slots);
  }, [compareTarget, copies, openEnhancementPicker, updateCopySlots]);

  // Handler: clear enhancement from a comparison copy slot
  const handleClearSlot = useCallback((copyId: number, slotIndex: number) => {
    updateCopySlots(copyId, (slots) => slots.map((s, i) => (i === slotIndex ? null : s)));
  }, [updateCopySlots]);

  // IDs only have to be unique within one power's list, and the counter that
  // used to hand them out was module state reset on open — which would collide
  // with saved rows the moment those outlived a close.
  const nextCopyId = useCallback(
    () => copies.reduce((max, c) => Math.max(max, c.id), CURRENT_COPY_ID) + 1,
    [copies]
  );

  // Handler: add new empty copy
  const handleAddCopy = useCallback(() => {
    if (!selectedPower) return;
    commitCopies([
      ...copies.slice(1),
      { id: nextCopyId(), slots: new Array(selectedPower.slots.length).fill(null) },
    ]);
  }, [selectedPower, copies, commitCopies, nextCopyId]);

  // Handler: duplicate a copy
  const handleDuplicateCopy = useCallback((copyId: number) => {
    const source = copies.find(c => c.id === copyId);
    if (!source) return;
    const stored = copies.slice(1);
    // Duplicating "Current" has no predecessor among the saved rows, so it
    // lands at the front of them — still directly below the row it came from.
    const insertAt = copyId === CURRENT_COPY_ID
      ? 0
      : stored.findIndex(c => c.id === copyId) + 1;
    const next = [...stored];
    next.splice(insertAt, 0, { id: nextCopyId(), slots: [...source.slots] });
    commitCopies(next);
  }, [copies, commitCopies, nextCopyId]);

  // Handler: remove a copy (never the live "Current" row)
  const handleRemoveCopy = useCallback((copyId: number) => {
    if (copyId === CURRENT_COPY_ID) return;
    commitCopies(copies.slice(1).filter(c => c.id !== copyId));
  }, [copies, commitCopies]);

  // Handler: apply a copy's slotting to the actual build
  const handleApply = useCallback((copyId: number) => {
    if (!compareTarget) return;
    const copy = copies.find(c => c.id === copyId);
    if (!copy) return;

    // Clear all slots then set the copy's enhancements
    const numSlots = copy.slots.length;
    for (let i = 0; i < numSlots; i++) {
      clearEnhancement(compareTarget.powerName, i);
    }
    copy.slots.forEach((enh, i) => {
      if (enh) setEnhancement(compareTarget.powerName, i, enh);
    });

    // Flash feedback
    setAppliedCopyId(copyId);
    setTimeout(() => setAppliedCopyId(null), 1200);
  }, [compareTarget, copies, setEnhancement, clearEnhancement]);

  if (!isOpen) return null;

  // Power selector dropdown — shared between "no power" and "power selected" states
  const powerSelector = (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-gray-300 shrink-0">Power:</label>
      <select
        value={compareTarget ? `${compareTarget.powerSet}::${compareTarget.powerName}` : ''}
        onChange={(e) => {
          if (!e.target.value) return;
          const [powerSet, powerName] = e.target.value.split('::');
          openCompareSlotting(powerName, powerSet);
        }}
        className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 max-w-md"
      >
        <option value="">Select a power...</option>
        {Array.from(powersByCategory.entries()).map(([category, powers]) => (
          <optgroup key={category} label={category}>
            {powers.map((p) => (
              <option key={`${p.powerSet}::${p.internalName}`} value={`${p.powerSet}::${p.internalName}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );

  // No power selected — show picker only
  if (!compareTarget || !power) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={closeModal}
        title="Compare Slotting"
        size="full"
      >
        <ModalBody>
          <div className="max-w-lg mx-auto mt-8 space-y-6">
            {powerSelector}
            <p className="text-sm text-gray-500 text-center">
              Select a power to compare slotting configurations.
            </p>
          </div>
        </ModalBody>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title={`Compare Slotting: ${power.name}`}
      size="full"
    >
      <ModalBody>
        {/* Power selector */}
        <div className="mb-4">
          {powerSelector}
        </div>

        <div className="flex flex-col md:flex-row gap-4 min-h-0 md:min-h-[400px]">
          {/* Stats panel - shown first on mobile (top), right side on desktop */}
          <div className="w-full md:w-[320px] flex-shrink-0 overflow-y-auto max-h-[40vh] md:max-h-none md:h-[70vh] bg-slate-900/50 rounded-lg border border-slate-700 p-3 order-1 md:order-2">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">
              {hoveredCopyId !== null
                ? `Showing: ${copies.findIndex(c => c.id === hoveredCopyId) === 0 ? 'Current' : `Copy ${copies.findIndex(c => c.id === hoveredCopyId)}`}`
                : 'Showing: Current'
              }
            </div>
            <RegistryEffectsDisplay
              effects={mergedEffects}
              allowedEnhancements={power.allowedEnhancements}
              enhancementBonuses={activeEnhBonuses}
              globalBonuses={globalBonusesForCalc}
              archetypeId={archetypeId ?? undefined}
              level={build.level}
              targetsAffected={power.targetsAffected}
              rows={effectRows}
              categories={['execution', 'buff', 'debuff', 'control', 'protection', 'movement']}
              damage={activeDamage}
              duration={mergedEffects?.buffDuration as number | undefined}
              purplePatchInfo={{
                factor: Math.min(0.95, Math.max(0.05, getBaseToHit(targetLevelOffset - globalBonuses.levelShift) + globalBonuses.toHit / 100)) / 0.75,
                offset: targetLevelOffset,
                toHitBonus: globalBonuses.toHit,
                combatModifier: globalBonuses.combatModifier ?? 1,
              }}
            />

            {/* Pet Damage section */}
            {power.summon && (
              <div className="mt-3 pt-3 border-t border-slate-700">
                <PetDamageDisplay
                  summon={power.summon}
                  level={build.level}
                  enhancementDamageBonus={activeEnhBonuses.damage || 0}
                  globalDamageBonus={globalBonusesForCalc.damage ?? 0}
                />
              </div>
            )}

            {/* Dashboard Stats Impact section */}
            {visibleStatIds.length > 0 && hypotheticalLegacyStats && (
              <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                  Stats Impact
                </div>
                <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] gap-x-2 gap-y-0.5 items-center tabular-nums text-[10px]">
                  {visibleStatIds.map((statId) => {
                    const def = STAT_DEFINITIONS[statId];
                    if (!def) return null;

                    const currentValue = def.getValue(currentLegacyStats, baseHP, maxHPCap);
                    const hypoValue = def.getValue(hypotheticalLegacyStats, baseHP, maxHPCap);
                    const currentNum = getNumericValue(currentValue);
                    const hypoNum = getNumericValue(hypoValue);
                    const delta = hypoNum - currentNum;

                    return (
                      <React.Fragment key={statId}>
                        <span className="text-slate-400 text-xs">{def.label}</span>
                        <span className="text-slate-500 text-right">{def.format(currentValue)}</span>
                        <span className="text-slate-600">&rarr;</span>
                        <span className="text-slate-200 text-right">{def.format(hypoValue)}</span>
                        <span className={`text-right font-medium ${
                          Math.abs(delta) < 0.005 ? 'text-slate-600' :
                          delta > 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {Math.abs(delta) < 0.005 ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Set Bonuses section */}
            {activeSetBonuses.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">
                  Set Bonuses
                </div>
                <div className="space-y-2">
                  {activeSetBonuses.map((item) => (
                    <SetBonusSummary
                      key={item.setId}
                      setId={item.setId}
                      setName={item.setName}
                      totalPieces={item.totalPieces}
                      slottedPieces={item.slottedPieces}
                      bonuses={item.bonuses}
                      bonusTracking={currentCalcResult.bonusTracking}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Comparison copies panel - below stats on mobile, left side on desktop */}
          <div className="flex-1 space-y-2 overflow-y-auto max-h-[50vh] md:max-h-[70vh] pr-1 order-2 md:order-1">
            {copies.map((copy, idx) => (
              <div
                key={copy.id}
                className={`
                  rounded-lg border p-3 cursor-pointer transition-all
                  ${hoveredCopyId === copy.id
                    ? 'border-[var(--color-selected)] bg-slate-700/50'
                    : appliedCopyId === copy.id
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                  }
                `}
                onMouseEnter={() => setHoveredCopyId(copy.id)}
                onMouseLeave={() => setHoveredCopyId(null)}
              >
                {/* Copy header */}
                <div className="flex items-center gap-2 mb-2">
                  <img
                    src={iconSrc}
                    alt=""
                    className="w-5 h-5 rounded-sm flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = resolvePath('/img/Unknown.png');
                    }}
                  />
                  <span className="text-xs text-slate-300 font-medium flex-1">
                    {idx === 0 ? 'Current' : `Copy ${idx}`}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDuplicateCopy(copy.id); }}
                      className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-600"
                      title="Duplicate this configuration"
                    >
                      Copy
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleApply(copy.id); }}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-primary)]/30 text-link hover:bg-[var(--color-primary)]/50 hover:text-white"
                      title="Apply this slotting to your build"
                    >
                      Apply
                    </button>
                    {idx > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemoveCopy(copy.id); }}
                        className="text-[10px] px-1 py-0.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-600"
                        title="Remove this copy"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Enhancement slots */}
                <div className="flex gap-1.5 items-center">
                  {copy.slots.map((slot, slotIdx) => (
                    <div
                      key={slotIdx}
                      className={`
                        w-8 h-8 flex-shrink-0 rounded-full border flex items-center justify-center
                        cursor-pointer transition-transform hover:scale-110
                        ${slot
                          ? 'border-transparent bg-transparent'
                          : 'border-slate-600 bg-slate-700/50 text-slate-500 hover:border-[var(--color-selected)] hover:bg-slate-600'
                        }
                      `}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSlotClick(copy.id, slotIdx);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (slot) handleClearSlot(copy.id, slotIdx);
                      }}
                      title={slot ? `${slot.name} - right-click to remove` : `Empty slot ${slotIdx + 1} - click to add`}
                    >
                      {slot ? (
                        <SlottedEnhancementIcon enhancement={slot} size={32} />
                      ) : (
                        <span className="text-slate-400 text-xs">+</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Add copy button */}
            <button
              onClick={handleAddCopy}
              className="w-full rounded-lg border border-dashed border-slate-600 p-3 text-slate-500 hover:text-slate-300 hover:border-slate-400 transition-colors flex items-center justify-center gap-1"
            >
              <span className="text-lg">+</span>
              <span className="text-xs">Add Configuration</span>
            </button>
          </div>

        </div>
      </ModalBody>
    </Modal>
  );
}
