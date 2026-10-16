/**
 * Special-enhancement registries facade — reads the ACTIVE dataset's
 * generated Hamidon/Titan/Hydra/D-Sync/prestige registries (data-gaps-324 item 9).
 * Per-dataset by necessity: HC carries 20 Hamidons and the D-Sync family at
 * the Hamidon rate; the forks carry the classic 11 Hamidons, legacy 25/15
 * Titan/Hydra, and no D-Sync at all.
 */

import { getActiveDataset } from './dataset';
import type { SpecialEnhancementsData, GeneratedSpecialEnhancementDef } from './dataset';
import type { SpecialCategory } from '@/utils/enhancement-uid';

export type { SpecialEnhancementsData, GeneratedSpecialEnhancementDef } from './dataset';
export type { SpecialCategory } from '@/utils/enhancement-uid';

export function getSpecialEnhancements(): SpecialEnhancementsData {
  return getActiveDataset().specialEnhancements;
}

/** One category's registry from the active dataset ('d-sync' maps to the
 * generated module's `dsync` key). Empty on datasets without the family. */
export function getSpecialRegistry(
  category: SpecialCategory,
): Record<string, GeneratedSpecialEnhancementDef> {
  const data = getSpecialEnhancements();
  switch (category) {
    case 'hamidon':
      return data.hamidon;
    case 'titan':
      return data.titan;
    case 'hydra':
      return data.hydra;
    case 'd-sync':
      return data.dsync;
    case 'prestige':
      return data.prestige;
  }
}
