/**
 * Incarnate System Type Definitions
 *
 * The Incarnate System is available at level 50 and provides 6 special slots
 * with craftable powers organized in trees with 4 tiers.
 */

// ============================================
// CORE TYPES
// ============================================

/**
 * The main incarnate slots.
 *
 * `genesis` is a 7th slot released only on the Rebirth server. All three exports
 * define it, but HC and Thunderspy ship dormant placeholders (data-gaps-47), so it
 * is a partner-slot amplifier offered in the UI only on Rebirth — see
 * `getSelectableIncarnateSlotIds()`. It is still a first-class member of this
 * union so build state, serialization and export handle it uniformly.
 */
export type IncarnateSlotId = 'alpha' | 'judgement' | 'interface' | 'destiny' | 'lore' | 'hybrid' | 'genesis';

/**
 * Power rarity tiers (Common -> Very Rare)
 */
export type IncarnateTier = 'common' | 'uncommon' | 'rare' | 'veryrare';

/**
 * Power branch (core vs radial, or base for tier 1)
 */
export type IncarnateBranch = 'base' | 'core' | 'radial';

// ============================================
// SLOT & TREE DEFINITIONS
// ============================================

/**
 * Definition for an incarnate slot (Alpha, Judgement, etc.)
 */
export interface IncarnateSlotDefinition {
  id: IncarnateSlotId;
  name: string;
  displayName: string;
  icon: string;
  color: string; // UI color for the slot
  trees: IncarnateTree[];
}

/**
 * A tree within a slot (e.g., Musculature, Cardiac for Alpha)
 */
export interface IncarnateTree {
  id: string;           // e.g., "musculature", "cardiac"
  name: string;         // e.g., "Musculature", "Cardiac"
  description: string;  // What this tree focuses on
  powers: IncarnatePower[];
}

// ============================================
// POWER DEFINITIONS
// ============================================

/**
 * An individual incarnate power
 */
export interface IncarnatePower {
  id: string;           // e.g., "musculature_core_paragon"
  fullName: string;     // e.g., "Incarnate.Alpha.Musculature_Core_Paragon"
  displayName: string;  // e.g., "Musculature Core Paragon"
  shortHelp: string;    // Brief description
  displayHelp: string;  // Full description (may contain HTML)
  icon: string;         // Icon filename
  tier: IncarnateTier;
  branch: IncarnateBranch;
  treeId: string;       // Parent tree id
  slotId: IncarnateSlotId;
  powerType: string;    // 'Auto', 'Click', 'Toggle', etc.
}

// ============================================
// BUILD STATE
// ============================================

/**
 * Selected incarnate power in a build
 */
export interface SelectedIncarnatePower {
  slotId: IncarnateSlotId;
  powerId: string;
  powerName: string;
  displayName: string;
  icon: string;
  tier: IncarnateTier;
  treeId: string;
  treeName: string;
}

/**
 * Incarnate state within a build
 */
export interface IncarnateBuildState {
  alpha: SelectedIncarnatePower | null;
  judgement: SelectedIncarnatePower | null;
  interface: SelectedIncarnatePower | null;
  destiny: SelectedIncarnatePower | null;
  lore: SelectedIncarnatePower | null;
  hybrid: SelectedIncarnatePower | null;
  /** Released on Rebirth only; null on HC/tspy builds (slot dormant there). */
  genesis: SelectedIncarnatePower | null;
}

/**
 * Active state for incarnate slots that provide stat bonuses
 * Alpha, Destiny, Hybrid, Interface can be toggled on/off for dashboard calculations
 */
export interface IncarnateActiveState {
  alpha: boolean;
  destiny: boolean;
  hybrid: boolean;
  interface: boolean;
  judgement: boolean;
  lore: boolean;
  genesis: boolean;
}

/**
 * Slots that can be toggled for stat calculations
 *
 * Note: alpha, destiny, hybrid, interface toggles affect dashboard calculations.
 * judgement and lore toggles are cosmetic-only (their in-combat click/summon
 * powers don't contribute passive stats; level shift is gated by the separate
 * incarnateLevelShiftActive flag, not per-slot active state).
 */
export type ToggleableIncarnateSlot = 'alpha' | 'destiny' | 'hybrid' | 'interface' | 'judgement' | 'lore' | 'genesis';

// ============================================
// CRAFTING TYPES
// ============================================

/**
 * Salvage item IDs (PascalCase identifiers matching game data)
 */
export type SalvageId =
  // Common (20 threads each)
  | 'ArcaneCantrip' | 'BiomorphicGoo' | 'DetailedReports' | 'EnchantedSand'
  | 'GenomicAnalysis' | 'MeditationTechniques' | 'NanotechGrowthMedium' | 'SuperchargedCapacitor'
  // Uncommon (60 threads each)
  | 'CytoliticInfusion' | 'DimensionalPocket' | 'GluonCompound' | 'WornSpellbook'
  // Rare (8 empyrean each)
  | 'AncientTexts' | 'ExoticIsotope' | 'SemiConsciousEnergy' | 'SuperconductiveMembrane'
  // Very Rare (30 empyrean each)
  | 'FavoroftheWell' | 'ForbiddenTechnique' | 'InfiniteTessellation'
  | 'LivingRelic' | 'SelfEvolvingAlloy' | 'ThaumicResonator';

/**
 * Rarity for incarnate salvage components
 */
export type SalvageRarity = 'common' | 'uncommon' | 'rare' | 'very-rare';

/**
 * A single salvage requirement (quantity + item)
 */
export interface SalvageRequirement {
  salvageId: SalvageId;
  quantity: number;
}

/**
 * Crafting variant key within a tier
 * T1: core only. T2: core/radial. T3: core/core_2/radial/radial_2. T4: core/radial.
 */
export type CraftingVariantKey = 'core' | 'radial' | 'core_2' | 'radial_2';

/**
 * Component requirements for one variant of one tier
 */
export interface CraftingVariant {
  name: string;
  salvage: SalvageRequirement[];
  prerequisites: string[];
}

/**
 * Recipe costs for one tier (currencies + incarnate components)
 */
export interface TierRecipe {
  threads: number;
  empyrean: number;
  /** Incarnate Component descriptions (e.g., "3x Common Alpha Component") */
  incarnateComponents: string[];
  /** Prerequisite tier keys (e.g., ["t1"], ["t2"], ["t3_core","t3_radial"]) */
  requires: string[];
}

/**
 * Currency conversion rates
 */
export interface CraftingConversions {
  empyreanToThreads: number;
  favorOfWellToEmpyrean: number;
}

/**
 * Composite key for a checklist item.
 * Format: "{slotId}:{treeId}:{tier}:{variant}:{item}"
 */
export type CraftingChecklistKey = string;

/**
 * Crafting checklist state: maps composite keys to checked status
 */
export type CraftingChecklistState = Record<CraftingChecklistKey, boolean>;

/**
 * Crafting nodes already obtained, on the way to the selected end-goal power.
 *
 * Keyed by `{slotId}:{treeId}:{nodePath}` where nodePath is a node's unique
 * position in the crafting dependency tree (e.g. "alpha:vigor:4c/3c2/2c"). A
 * checked node means you already hold that crafted ability, so it — and every
 * lower node consumed to make it — drops out of the remaining shopping list.
 *
 * Like the crafting checklist, this is device-local crafting *progress* rather
 * than part of the shareable build identity.
 */
export type IncarnateObtainedState = Record<string, boolean>;

/**
 * Create empty crafting checklist state
 */
export function createEmptyCraftingChecklistState(): CraftingChecklistState {
  return {};
}

/**
 * Create empty incarnate obtained-tier state
 */
export function createEmptyIncarnateObtainedState(): IncarnateObtainedState {
  return {};
}

/**
 * Build a consistent checklist key
 */
export function craftingKey(
  slotId: string, treeId: string, tier: number, variant: string, item: string
): CraftingChecklistKey {
  return `${slotId}:${treeId}:${tier}:${variant}:${item}`;
}

// ============================================
// CONSTANTS
// ============================================

/**
 * Ordered list of incarnate slots
 */
export const INCARNATE_SLOT_ORDER: IncarnateSlotId[] = [
  'alpha',
  'judgement',
  'interface',
  'destiny',
  'lore',
  'hybrid',
  'genesis',
];

/**
 * Tier progression order
 */
export const INCARNATE_TIER_ORDER: IncarnateTier[] = [
  'common',
  'uncommon',
  'rare',
  'veryrare',
];

/**
 * Level required for incarnate powers
 */
export const INCARNATE_REQUIRED_LEVEL = 50;

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Create empty incarnate build state
 */
export function createEmptyIncarnateBuildState(): IncarnateBuildState {
  return {
    alpha: null,
    judgement: null,
    interface: null,
    destiny: null,
    lore: null,
    hybrid: null,
    genesis: null,
  };
}

/**
 * Create default incarnate active state (all enabled by default)
 */
export function createDefaultIncarnateActiveState(): IncarnateActiveState {
  return {
    alpha: true,
    destiny: true,
    hybrid: true,
    interface: true,
    judgement: true,
    lore: true,
    genesis: true,
  };
}

/**
 * Infer tier from power name patterns
 *
 * Incarnate powers follow these naming patterns by slot:
 * - Alpha: Boost (common), Core/Radial Boost (uncommon), Total/Partial Revamp (rare), Paragon (very rare)
 * - Judgement: Judgement (common), Core/Radial Judgement (uncommon), Total/Partial Judgement (rare), Final Judgement (very rare)
 * - Interface: Interface (common), Core/Radial Interface (uncommon), Total/Partial Conversion (rare), Flawless Interface (very rare)
 * - Destiny: varies by tree
 * - Lore: Ally (common), Core/Radial Ally (uncommon), Total/Partial Improved Ally (rare), Superior Ally (very rare)
 * - Hybrid: varies by tree
 */
export function inferTierFromPowerName(powerName: string): IncarnateTier {
  const lowerName = powerName.toLowerCase();

  // Very Rare (Tier 4): Check for all very rare keywords across all slots
  // Alpha: Paragon | Judgement: Final | Interface: Flawless | Lore: Superior | Destiny/Hybrid: Epiphany, Genesis, Embodiment
  if (lowerName.includes('paragon') ||
      lowerName.includes('final') ||
      lowerName.includes('flawless') ||
      lowerName.includes('superior') ||
      lowerName.includes('epiphany') ||
      lowerName.includes('genesis') ||
      lowerName.includes('embodiment')) {
    return 'veryrare';
  }

  // Rare (Tier 3): Total/Partial variants
  if (lowerName.includes('total') || lowerName.includes('partial')) {
    return 'rare';
  }

  // Uncommon (Tier 2): Has Core/Radial but not the very rare or rare keywords
  if (lowerName.includes('core') || lowerName.includes('radial')) {
    return 'uncommon';
  }

  // Common (Tier 1): Base power without Core/Radial modifier
  return 'common';
}

/**
 * Infer tier for a Genesis-slot power.
 *
 * Genesis powers can't use `inferTierFromPowerName` because every one of them
 * contains the word "Genesis", which that function treats as a Very Rare marker
 * (it's the Destiny/Hybrid T4 keyword). Genesis uses its own naming ladder:
 *   common   = "<Tree> Genesis"                 (no branch keyword)
 *   uncommon = "<Tree> Core/Radial Genesis"
 *   rare     = "<Tree> Total/Partial ... Genesis"
 *   veryrare = "<Tree> Core/Radial Flawless Genesis"
 */
export function inferGenesisTier(powerName: string): IncarnateTier {
  const l = powerName.toLowerCase();
  if (l.includes('flawless')) return 'veryrare';
  if (l.includes('total') || l.includes('partial')) return 'rare';
  if (l.includes('core') || l.includes('radial')) return 'uncommon';
  return 'common';
}

/**
 * Infer branch from power name
 */
export function inferBranchFromPowerName(powerName: string): IncarnateBranch {
  const lowerName = powerName.toLowerCase();

  if (lowerName.includes('radial')) return 'radial';
  if (lowerName.includes('core')) return 'core';
  return 'base';
}
