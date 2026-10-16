/**
 * useSlotLevels - Memoized hook that computes slot level assignments for the current build.
 *
 * Returns a Map keyed by `powerKey`, each value parallel to the power's slots
 * array. A `null` entry is a slot the grant schedule could not place —
 * surface it, never substitute a number for it. Outside Level Up mode the
 * map is empty: a slot carries no level at all in free-form planning
 * (issues-3), and every consumer already treats a missing entry as nothing to
 * show. Recalculates whenever the build or the mode changes.
 */

import { useMemo } from 'react';
import { useBuildStore, useUIStore } from '@/stores';
import { computeAllSlotLevels, type SlotLevel } from '@/utils/slot-levels';

export function useSlotLevels(): Map<string, SlotLevel[]> {
  const build = useBuildStore((s) => s.build);
  const levelUpMode = useUIStore((s) => s.levelUpMode);
  return useMemo(() => computeAllSlotLevels(build, levelUpMode), [build, levelUpMode]);
}
