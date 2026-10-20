/**
 * Incarnate Component Requirements
 *
 * Per-slot, per-tree salvage requirements for crafting incarnate powers.
 * Ported from CoH-Incarnate-Calculator/js/incarnate-components.js.
 * That source had every tier-3 radial pair swapped (Total/Partial); fixed here
 * against baserecipes.bin, where `radial` is Total and `radial_2` is Partial.
 */

import type { IncarnateSlotId, CraftingVariantKey, CraftingVariant, SalvageRequirement } from '@/types';
import { parseSalvageString } from './incarnate-salvage';

// ============================================
// RAW DATA TYPES
// ============================================

interface RawVariant {
  salvage: string[];
  prerequisites: string[];
}

type RawTierData = Partial<Record<CraftingVariantKey, RawVariant>>;
type RawTreeData = Record<string, RawTierData>;
type RawSlotData = Record<string, RawTreeData>;

// ============================================
// RAW COMPONENT DATA
// ============================================

const ALPHA_DATA: RawSlotData = {
  Vigor: {
    tier1: { core: { salvage: ['1x EnchantedSand', '1x SuperchargedCapacitor', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['2x ArcaneCantrip', '1x GluonCompound'], prerequisites: ['Vigor_Boost'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x GenomicAnalysis', '1x DimensionalPocket'], prerequisites: ['Vigor_Boost'] },
    },
    tier3: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x AncientTexts'], prerequisites: ['Vigor_Core_Boost'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Vigor_Core_Boost'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x DetailedReports', '1x ExoticIsotope'], prerequisites: ['Vigor_Radial_Boost'] },
      radial_2: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Vigor_Radial_Boost'] },
    },
    tier4: {
      core: { salvage: ['1x MeditationTechniques', '1x DetailedReports', '1x ThaumicResonator'], prerequisites: ['Vigor_Total_Core_Revamp', 'Vigor_Partial_Core_Revamp'] },
      radial: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x SelfEvolvingAlloy'], prerequisites: ['Vigor_Total_Radial_Revamp', 'Vigor_Partial_Radial_Revamp'] },
    },
  },
  Spiritual: {
    tier1: { core: { salvage: ['1x EnchantedSand', '1x SuperchargedCapacitor', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['2x ArcaneCantrip', '1x GluonCompound'], prerequisites: ['Spiritual_Boost'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x GenomicAnalysis', '1x DimensionalPocket'], prerequisites: ['Spiritual_Boost'] },
    },
    tier3: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x AncientTexts'], prerequisites: ['Spiritual_Core_Boost'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Spiritual_Core_Boost'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x DetailedReports', '1x ExoticIsotope'], prerequisites: ['Spiritual_Radial_Boost'] },
      radial_2: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Spiritual_Radial_Boost'] },
    },
    tier4: {
      core: { salvage: ['1x MeditationTechniques', '1x DetailedReports', '1x ThaumicResonator'], prerequisites: ['Spiritual_Total_Core_Revamp', 'Spiritual_Partial_Core_Revamp'] },
      radial: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x SelfEvolvingAlloy'], prerequisites: ['Spiritual_Total_Radial_Revamp', 'Spiritual_Partial_Radial_Revamp'] },
    },
  },
  Resilient: {
    tier1: { core: { salvage: ['1x BiomorphicGoo', '1x ArcaneCantrip', '1x MeditationTechniques'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['2x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Resilient_Boost'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x ArcaneCantrip', '1x CytoliticInfusion'], prerequisites: ['Resilient_Boost'] },
    },
    tier3: {
      core: { salvage: ['2x EnchantedSand', '1x SuperconductiveMembrane'], prerequisites: ['Resilient_Core_Boost'] },
      core_2: { salvage: ['1x GenomicAnalysis', '1x ArcaneCantrip', '1x ExoticIsotope'], prerequisites: ['Resilient_Core_Boost'] },
      radial: { salvage: ['2x EnchantedSand', '1x SuperconductiveMembrane'], prerequisites: ['Resilient_Radial_Boost'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x ArcaneCantrip', '1x ExoticIsotope'], prerequisites: ['Resilient_Radial_Boost'] },
    },
    tier4: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x ForbiddenTechnique'], prerequisites: ['Resilient_Total_Core_Revamp', 'Resilient_Partial_Core_Revamp'] },
      radial: { salvage: ['1x EnchantedSand', '1x MeditationTechniques', '1x ThaumicResonator'], prerequisites: ['Resilient_Total_Radial_Revamp', 'Resilient_Partial_Radial_Revamp'] },
    },
  },
  Nerve: {
    tier1: { core: { salvage: ['1x BiomorphicGoo', '1x ArcaneCantrip', '1x MeditationTechniques'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['2x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Nerve_Boost'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x ArcaneCantrip', '1x CytoliticInfusion'], prerequisites: ['Nerve_Boost'] },
    },
    tier3: {
      core: { salvage: ['2x EnchantedSand', '1x SuperconductiveMembrane'], prerequisites: ['Nerve_Core_Boost'] },
      core_2: { salvage: ['1x GenomicAnalysis', '1x ArcaneCantrip', '1x ExoticIsotope'], prerequisites: ['Nerve_Core_Boost'] },
      radial: { salvage: ['2x EnchantedSand', '1x SuperconductiveMembrane'], prerequisites: ['Nerve_Radial_Boost'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x ArcaneCantrip', '1x ExoticIsotope'], prerequisites: ['Nerve_Radial_Boost'] },
    },
    tier4: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x ForbiddenTechnique'], prerequisites: ['Nerve_Total_Core_Revamp', 'Nerve_Partial_Core_Revamp'] },
      radial: { salvage: ['1x EnchantedSand', '1x MeditationTechniques', '1x ThaumicResonator'], prerequisites: ['Nerve_Total_Radial_Revamp', 'Nerve_Partial_Radial_Revamp'] },
    },
  },
  Musculature: {
    tier1: { core: { salvage: ['1x BiomorphicGoo', '1x MeditationTechniques', '1x GenomicAnalysis'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x ArcaneCantrip', '1x DetailedReports', '1x WornSpellbook'], prerequisites: ['Musculature_Boost'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x EnchantedSand', '1x GluonCompound'], prerequisites: ['Musculature_Boost'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['Musculature_Core_Boost'] },
      core_2: { salvage: ['2x NanotechGrowthMedium', '1x ExoticIsotope'], prerequisites: ['Musculature_Core_Boost'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x MeditationTechniques', '1x SuperconductiveMembrane'], prerequisites: ['Musculature_Radial_Boost'] },
      radial_2: { salvage: ['1x SuperchargedCapacitor', '1x MeditationTechniques', '1x ExoticIsotope'], prerequisites: ['Musculature_Radial_Boost'] },
    },
    tier4: {
      core: { salvage: ['1x ArcaneCantrip', '1x NanotechGrowthMedium', '1x ForbiddenTechnique'], prerequisites: ['Musculature_Total_Core_Revamp', 'Musculature_Partial_Core_Revamp'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x MeditationTechniques', '1x SelfEvolvingAlloy'], prerequisites: ['Musculature_Total_Radial_Revamp', 'Musculature_Partial_Radial_Revamp'] },
    },
  },
  Intuition: {
    tier1: { core: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x BiomorphicGoo'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x GenomicAnalysis', '1x CytoliticInfusion'], prerequisites: ['Intuition_Boost'] },
      radial: { salvage: ['1x DetailedReports', '1x BiomorphicGoo', '1x GluonCompound'], prerequisites: ['Intuition_Boost'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x ArcaneCantrip', '1x AncientTexts'], prerequisites: ['Intuition_Core_Boost'] },
      core_2: { salvage: ['1x BiomorphicGoo', '1x ArcaneCantrip', '1x SuperconductiveMembrane'], prerequisites: ['Intuition_Core_Boost'] },
      radial: { salvage: ['1x DetailedReports', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Intuition_Radial_Boost'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x ExoticIsotope'], prerequisites: ['Intuition_Radial_Boost'] },
    },
    tier4: {
      core: { salvage: ['1x EnchantedSand', '1x GenomicAnalysis', '1x LivingRelic'], prerequisites: ['Intuition_Total_Core_Revamp', 'Intuition_Partial_Core_Revamp'] },
      radial: { salvage: ['1x EnchantedSand', '1x MeditationTechniques', '1x ThaumicResonator'], prerequisites: ['Intuition_Total_Radial_Revamp', 'Intuition_Partial_Radial_Revamp'] },
    },
  },
  Cardiac: {
    tier1: { core: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x BiomorphicGoo'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x GenomicAnalysis', '1x CytoliticInfusion'], prerequisites: ['Cardiac_Boost'] },
      radial: { salvage: ['1x DetailedReports', '1x BiomorphicGoo', '1x GluonCompound'], prerequisites: ['Cardiac_Boost'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x ArcaneCantrip', '1x AncientTexts'], prerequisites: ['Cardiac_Core_Boost'] },
      core_2: { salvage: ['1x BiomorphicGoo', '1x ArcaneCantrip', '1x SuperconductiveMembrane'], prerequisites: ['Cardiac_Core_Boost'] },
      radial: { salvage: ['1x DetailedReports', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Cardiac_Radial_Boost'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x ExoticIsotope'], prerequisites: ['Cardiac_Radial_Boost'] },
    },
    tier4: {
      core: { salvage: ['1x EnchantedSand', '1x GenomicAnalysis', '1x LivingRelic'], prerequisites: ['Cardiac_Total_Core_Revamp', 'Cardiac_Partial_Core_Revamp'] },
      radial: { salvage: ['1x EnchantedSand', '1x MeditationTechniques', '1x ThaumicResonator'], prerequisites: ['Cardiac_Total_Radial_Revamp', 'Cardiac_Partial_Radial_Revamp'] },
    },
  },
  Agility: {
    tier1: { core: { salvage: ['1x BiomorphicGoo', '1x MeditationTechniques', '1x GenomicAnalysis'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x ArcaneCantrip', '1x DetailedReports', '1x WornSpellbook'], prerequisites: ['Agility_Boost'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x EnchantedSand', '1x GluonCompound'], prerequisites: ['Agility_Boost'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['Agility_Core_Boost'] },
      core_2: { salvage: ['2x NanotechGrowthMedium', '1x ExoticIsotope'], prerequisites: ['Agility_Core_Boost'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x MeditationTechniques', '1x SuperconductiveMembrane'], prerequisites: ['Agility_Radial_Boost'] },
      radial_2: { salvage: ['1x SuperchargedCapacitor', '1x MeditationTechniques', '1x ExoticIsotope'], prerequisites: ['Agility_Radial_Boost'] },
    },
    tier4: {
      core: { salvage: ['1x ArcaneCantrip', '1x NanotechGrowthMedium', '1x ForbiddenTechnique'], prerequisites: ['Agility_Total_Core_Revamp', 'Agility_Partial_Core_Revamp'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x MeditationTechniques', '1x SelfEvolvingAlloy'], prerequisites: ['Agility_Total_Radial_Revamp', 'Agility_Partial_Radial_Revamp'] },
    },
  },
};

const JUDGEMENT_DATA: RawSlotData = {
  Vorpal: {
    tier1: { core: { salvage: ['1x DetailedReports', '1x MeditationTechniques', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x NanotechGrowthMedium', '1x CytoliticInfusion'], prerequisites: ['Vorpal_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x MeditationTechniques', '1x DimensionalPocket'], prerequisites: ['Vorpal_Judgement'] },
    },
    tier3: {
      core: { salvage: ['1x NanotechGrowthMedium', '1x EnchantedSand', '1x SemiConsciousEnergy'], prerequisites: ['Vorpal_Core_Judgement'] },
      core_2: { salvage: ['1x GenomicAnalysis', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Vorpal_Core_Judgement'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x SuperchargedCapacitor', '1x SuperconductiveMembrane'], prerequisites: ['Vorpal_Radial_Judgement'] },
      radial_2: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Vorpal_Radial_Judgement'] },
    },
    tier4: {
      core: { salvage: ['1x BiomorphicGoo', '1x DetailedReports', '1x SelfEvolvingAlloy'], prerequisites: ['Vorpal_Total_Core_Judgement', 'Vorpal_Partial_Core_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x EnchantedSand', '1x ForbiddenTechnique'], prerequisites: ['Vorpal_Total_Radial_Judgement', 'Vorpal_Partial_Radial_Judgement'] },
    },
  },
  Void: {
    tier1: { core: { salvage: ['1x GenomicAnalysis', '1x EnchantedSand', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x WornSpellbook'], prerequisites: ['Void_Judgement'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x DimensionalPocket'], prerequisites: ['Void_Judgement'] },
    },
    tier3: {
      core: { salvage: ['1x DetailedReports', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Void_Core_Judgement'] },
      core_2: { salvage: ['2x GenomicAnalysis', '1x SemiConsciousEnergy'], prerequisites: ['Void_Core_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Void_Radial_Judgement'] },
      radial_2: { salvage: ['1x EnchantedSand', '1x GenomicAnalysis', '1x ExoticIsotope'], prerequisites: ['Void_Radial_Judgement'] },
    },
    tier4: {
      core: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x LivingRelic'], prerequisites: ['Void_Total_Core_Judgement', 'Void_Partial_Core_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x MeditationTechniques', '1x ForbiddenTechnique'], prerequisites: ['Void_Total_Radial_Judgement', 'Void_Partial_Radial_Judgement'] },
    },
  },
  Pyronic: {
    tier1: { core: { salvage: ['2x SuperchargedCapacitor', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x EnchantedSand', '1x ArcaneCantrip', '1x GluonCompound'], prerequisites: ['Pyronic_Judgement'] },
      radial: { salvage: ['1x DetailedReports', '1x GenomicAnalysis', '1x CytoliticInfusion'], prerequisites: ['Pyronic_Judgement'] },
    },
    tier3: {
      core: { salvage: ['1x NanotechGrowthMedium', '1x DetailedReports', '1x ExoticIsotope'], prerequisites: ['Pyronic_Core_Judgement'] },
      core_2: { salvage: ['1x GenomicAnalysis', '1x MeditationTechniques', '1x SuperconductiveMembrane'], prerequisites: ['Pyronic_Core_Judgement'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Pyronic_Radial_Judgement'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x ExoticIsotope'], prerequisites: ['Pyronic_Radial_Judgement'] },
    },
    tier4: {
      core: { salvage: ['1x GenomicAnalysis', '1x BiomorphicGoo', '1x SelfEvolvingAlloy'], prerequisites: ['Pyronic_Total_Core_Judgement', 'Pyronic_Partial_Core_Judgement'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x EnchantedSand', '1x ThaumicResonator'], prerequisites: ['Pyronic_Total_Radial_Judgement', 'Pyronic_Partial_Radial_Judgement'] },
    },
  },
  Ion: {
    tier1: { core: { salvage: ['1x NanotechGrowthMedium', '1x SuperchargedCapacitor', '1x DetailedReports'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x BiomorphicGoo', '1x DetailedReports', '1x WornSpellbook'], prerequisites: ['Ion_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x DetailedReports', '1x GluonCompound'], prerequisites: ['Ion_Judgement'] },
    },
    tier3: {
      core: { salvage: ['1x BiomorphicGoo', '1x MeditationTechniques', '1x AncientTexts'], prerequisites: ['Ion_Core_Judgement'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x DetailedReports', '1x SemiConsciousEnergy'], prerequisites: ['Ion_Core_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Ion_Radial_Judgement'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Ion_Radial_Judgement'] },
    },
    tier4: {
      core: { salvage: ['1x GenomicAnalysis', '1x MeditationTechniques', '1x ThaumicResonator'], prerequisites: ['Ion_Total_Core_Judgement', 'Ion_Partial_Core_Judgement'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x NanotechGrowthMedium', '1x LivingRelic'], prerequisites: ['Ion_Total_Radial_Judgement', 'Ion_Partial_Radial_Judgement'] },
    },
  },
  Cryonic: {
    tier1: { core: { salvage: ['1x DetailedReports', '1x MeditationTechniques', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x NanotechGrowthMedium', '1x CytoliticInfusion'], prerequisites: ['Cryonic_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x MeditationTechniques', '1x DimensionalPocket'], prerequisites: ['Cryonic_Judgement'] },
    },
    tier3: {
      core: { salvage: ['1x NanotechGrowthMedium', '1x EnchantedSand', '1x SemiConsciousEnergy'], prerequisites: ['Cryonic_Core_Judgement'] },
      core_2: { salvage: ['1x GenomicAnalysis', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Cryonic_Core_Judgement'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x SuperchargedCapacitor', '1x SuperconductiveMembrane'], prerequisites: ['Cryonic_Radial_Judgement'] },
      radial_2: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Cryonic_Radial_Judgement'] },
    },
    tier4: {
      core: { salvage: ['1x BiomorphicGoo', '1x DetailedReports', '1x SelfEvolvingAlloy'], prerequisites: ['Cryonic_Total_Core_Judgement', 'Cryonic_Partial_Core_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x EnchantedSand', '1x ForbiddenTechnique'], prerequisites: ['Cryonic_Total_Radial_Judgement', 'Cryonic_Partial_Radial_Judgement'] },
    },
  },
  Mighty: {
    tier1: { core: { salvage: ['1x GenomicAnalysis', '1x EnchantedSand', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x WornSpellbook'], prerequisites: ['Mighty_Judgement'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x DimensionalPocket'], prerequisites: ['Mighty_Judgement'] },
    },
    tier3: {
      core: { salvage: ['1x DetailedReports', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Mighty_Core_Judgement'] },
      core_2: { salvage: ['2x GenomicAnalysis', '1x SemiConsciousEnergy'], prerequisites: ['Mighty_Core_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Mighty_Radial_Judgement'] },
      radial_2: { salvage: ['1x EnchantedSand', '1x GenomicAnalysis', '1x ExoticIsotope'], prerequisites: ['Mighty_Radial_Judgement'] },
    },
    tier4: {
      core: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x LivingRelic'], prerequisites: ['Mighty_Total_Core_Judgement', 'Mighty_Partial_Core_Judgement'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x MeditationTechniques', '1x ForbiddenTechnique'], prerequisites: ['Mighty_Total_Radial_Judgement', 'Mighty_Partial_Radial_Judgement'] },
    },
  },
};

const INTERFACE_DATA: RawSlotData = {
  Spectral: {
    tier1: { core: { salvage: ['1x GenomicAnalysis', '1x EnchantedSand', '1x SuperchargedCapacitor'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x CytoliticInfusion'], prerequisites: ['Spectral_Interface'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x DetailedReports', '1x GluonCompound'], prerequisites: ['Spectral_Interface'] },
    },
    tier3: {
      core: { salvage: ['1x ArcaneCantrip', '1x EnchantedSand', '1x ExoticIsotope'], prerequisites: ['Spectral_Core_Interface'] },
      core_2: { salvage: ['1x ArcaneCantrip', '1x BiomorphicGoo', '1x ExoticIsotope'], prerequisites: ['Spectral_Core_Interface'] },
      radial: { salvage: ['1x DetailedReports', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Spectral_Radial_Interface'] },
      radial_2: { salvage: ['1x SuperchargedCapacitor', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Spectral_Radial_Interface'] },
    },
    tier4: {
      core: { salvage: ['1x DetailedReports', '1x SuperchargedCapacitor', '1x LivingRelic'], prerequisites: ['Spectral_Total_Core_Conversion', 'Spectral_Partial_Core_Conversion'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x SelfEvolvingAlloy'], prerequisites: ['Spectral_Total_Radial_Conversion', 'Spectral_Partial_Radial_Conversion'] },
    },
  },
  Reactive: {
    tier1: { core: { salvage: ['1x SuperchargedCapacitor', '1x MeditationTechniques', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x EnchantedSand', '1x SuperchargedCapacitor', '1x GluonCompound'], prerequisites: ['Reactive_Interface'] },
      radial: { salvage: ['2x SuperchargedCapacitor', '1x DimensionalPocket'], prerequisites: ['Reactive_Interface'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x SuperchargedCapacitor', '1x SemiConsciousEnergy'], prerequisites: ['Reactive_Core_Interface'] },
      core_2: { salvage: ['1x BiomorphicGoo', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Reactive_Core_Interface'] },
      radial: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['Reactive_Radial_Interface'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x MeditationTechniques', '1x AncientTexts'], prerequisites: ['Reactive_Radial_Interface'] },
    },
    tier4: {
      core: { salvage: ['1x MeditationTechniques', '1x DetailedReports', '1x LivingRelic'], prerequisites: ['Reactive_Total_Core_Conversion', 'Reactive_Partial_Core_Conversion'] },
      radial: { salvage: ['2x ArcaneCantrip', '1x SelfEvolvingAlloy'], prerequisites: ['Reactive_Total_Radial_Conversion', 'Reactive_Partial_Radial_Conversion'] },
    },
  },
  Preemptive: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x SuperchargedCapacitor', '1x GenomicAnalysis'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x DetailedReports', '1x SuperchargedCapacitor', '1x WornSpellbook'], prerequisites: ['Preemptive_Interface'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x GenomicAnalysis', '1x CytoliticInfusion'], prerequisites: ['Preemptive_Interface'] },
    },
    tier3: {
      core: { salvage: ['2x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Preemptive_Core_Interface'] },
      core_2: { salvage: ['1x NanotechGrowthMedium', '1x SuperchargedCapacitor', '1x SuperconductiveMembrane'], prerequisites: ['Preemptive_Core_Interface'] },
      radial: { salvage: ['2x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Preemptive_Radial_Interface'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x DetailedReports', '1x AncientTexts'], prerequisites: ['Preemptive_Radial_Interface'] },
    },
    tier4: {
      core: { salvage: ['1x ArcaneCantrip', '1x BiomorphicGoo', '1x ThaumicResonator'], prerequisites: ['Preemptive_Total_Core_Conversion', 'Preemptive_Partial_Core_Conversion'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x ForbiddenTechnique'], prerequisites: ['Preemptive_Total_Radial_Conversion', 'Preemptive_Partial_Radial_Conversion'] },
    },
  },
  Paralytic: {
    tier1: { core: { salvage: ['1x NanotechGrowthMedium', '1x DetailedReports', '1x BiomorphicGoo'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x ArcaneCantrip', '1x DimensionalPocket'], prerequisites: ['Paralytic_Interface'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x NanotechGrowthMedium', '1x CytoliticInfusion'], prerequisites: ['Paralytic_Interface'] },
    },
    tier3: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x BiomorphicGoo', '1x SuperconductiveMembrane'], prerequisites: ['Paralytic_Core_Interface'] },
      core_2: { salvage: ['1x NanotechGrowthMedium', '1x MeditationTechniques', '1x SemiConsciousEnergy'], prerequisites: ['Paralytic_Core_Interface'] },
      radial: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x ExoticIsotope'], prerequisites: ['Paralytic_Radial_Interface'] },
      radial_2: { salvage: ['1x DetailedReports', '1x EnchantedSand', '1x SemiConsciousEnergy'], prerequisites: ['Paralytic_Radial_Interface'] },
    },
    tier4: {
      core: { salvage: ['1x ArcaneCantrip', '1x SuperchargedCapacitor', '1x ForbiddenTechnique'], prerequisites: ['Paralytic_Total_Core_Conversion', 'Paralytic_Partial_Core_Conversion'] },
      radial: { salvage: ['1x DetailedReports', '1x MeditationTechniques', '1x SelfEvolvingAlloy'], prerequisites: ['Paralytic_Total_Radial_Conversion', 'Paralytic_Partial_Radial_Conversion'] },
    },
  },
  Gravitic: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x SuperchargedCapacitor', '1x GenomicAnalysis'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x DetailedReports', '1x SuperchargedCapacitor', '1x WornSpellbook'], prerequisites: ['Gravitic_Interface'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x GenomicAnalysis', '1x CytoliticInfusion'], prerequisites: ['Gravitic_Interface'] },
    },
    tier3: {
      core: { salvage: ['2x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Gravitic_Core_Interface'] },
      core_2: { salvage: ['1x NanotechGrowthMedium', '1x SuperchargedCapacitor', '1x SuperconductiveMembrane'], prerequisites: ['Gravitic_Core_Interface'] },
      radial: { salvage: ['2x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Gravitic_Radial_Interface'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x DetailedReports', '1x AncientTexts'], prerequisites: ['Gravitic_Radial_Interface'] },
    },
    tier4: {
      core: { salvage: ['1x ArcaneCantrip', '1x BiomorphicGoo', '1x ThaumicResonator'], prerequisites: ['Gravitic_Total_Core_Conversion', 'Gravitic_Partial_Core_Conversion'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x ForbiddenTechnique'], prerequisites: ['Gravitic_Total_Radial_Conversion', 'Gravitic_Partial_Radial_Conversion'] },
    },
  },
  Diamagnetic: {
    tier1: { core: { salvage: ['1x GenomicAnalysis', '1x EnchantedSand', '1x SuperchargedCapacitor'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x CytoliticInfusion'], prerequisites: ['Diamagnetic_Interface'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x DetailedReports', '1x GluonCompound'], prerequisites: ['Diamagnetic_Interface'] },
    },
    tier3: {
      core: { salvage: ['1x ArcaneCantrip', '1x EnchantedSand', '1x ExoticIsotope'], prerequisites: ['Diamagnetic_Core_Interface'] },
      core_2: { salvage: ['1x ArcaneCantrip', '1x BiomorphicGoo', '1x ExoticIsotope'], prerequisites: ['Diamagnetic_Core_Interface'] },
      radial: { salvage: ['1x DetailedReports', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Diamagnetic_Radial_Interface'] },
      radial_2: { salvage: ['1x SuperchargedCapacitor', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Diamagnetic_Radial_Interface'] },
    },
    tier4: {
      core: { salvage: ['1x DetailedReports', '1x SuperchargedCapacitor', '1x LivingRelic'], prerequisites: ['Diamagnetic_Total_Core_Conversion', 'Diamagnetic_Partial_Core_Conversion'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x SelfEvolvingAlloy'], prerequisites: ['Diamagnetic_Total_Radial_Conversion', 'Diamagnetic_Partial_Radial_Conversion'] },
    },
  },
  Degenerative: {
    tier1: { core: { salvage: ['1x NanotechGrowthMedium', '1x DetailedReports', '1x BiomorphicGoo'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x ArcaneCantrip', '1x DimensionalPocket'], prerequisites: ['Degenerative_Interface'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x NanotechGrowthMedium', '1x CytoliticInfusion'], prerequisites: ['Degenerative_Interface'] },
    },
    tier3: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x BiomorphicGoo', '1x SuperconductiveMembrane'], prerequisites: ['Degenerative_Core_Interface'] },
      core_2: { salvage: ['1x NanotechGrowthMedium', '1x MeditationTechniques', '1x SemiConsciousEnergy'], prerequisites: ['Degenerative_Core_Interface'] },
      radial: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x ExoticIsotope'], prerequisites: ['Degenerative_Radial_Interface'] },
      radial_2: { salvage: ['1x DetailedReports', '1x EnchantedSand', '1x SemiConsciousEnergy'], prerequisites: ['Degenerative_Radial_Interface'] },
    },
    tier4: {
      core: { salvage: ['1x ArcaneCantrip', '1x SuperchargedCapacitor', '1x ForbiddenTechnique'], prerequisites: ['Degenerative_Total_Core_Conversion', 'Degenerative_Partial_Core_Conversion'] },
      radial: { salvage: ['1x DetailedReports', '1x MeditationTechniques', '1x SelfEvolvingAlloy'], prerequisites: ['Degenerative_Total_Radial_Conversion', 'Degenerative_Partial_Radial_Conversion'] },
    },
  },
  Cognitive: {
    tier1: { core: { salvage: ['1x SuperchargedCapacitor', '1x MeditationTechniques', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x EnchantedSand', '1x SuperchargedCapacitor', '1x GluonCompound'], prerequisites: ['Cognitive_Interface'] },
      radial: { salvage: ['2x SuperchargedCapacitor', '1x DimensionalPocket'], prerequisites: ['Cognitive_Interface'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x SuperchargedCapacitor', '1x SemiConsciousEnergy'], prerequisites: ['Cognitive_Core_Interface'] },
      core_2: { salvage: ['1x BiomorphicGoo', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Cognitive_Core_Interface'] },
      radial: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['Cognitive_Radial_Interface'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x MeditationTechniques', '1x AncientTexts'], prerequisites: ['Cognitive_Radial_Interface'] },
    },
    tier4: {
      core: { salvage: ['1x MeditationTechniques', '1x DetailedReports', '1x LivingRelic'], prerequisites: ['Cognitive_Total_Core_Conversion', 'Cognitive_Partial_Core_Conversion'] },
      radial: { salvage: ['2x ArcaneCantrip', '1x SelfEvolvingAlloy'], prerequisites: ['Cognitive_Total_Radial_Conversion', 'Cognitive_Partial_Radial_Conversion'] },
    },
  },
};

const LORE_DATA: RawSlotData = {
  Warworks: {
    tier1: { core: { salvage: ['2x ArcaneCantrip', '1x MeditationTechniques'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x EnchantedSand', '1x ArcaneCantrip', '1x WornSpellbook'], prerequisites: ['Warworks_Ally'] },
      radial: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x CytoliticInfusion'], prerequisites: ['Warworks_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x ArcaneCantrip', '1x SuperchargedCapacitor', '1x SuperconductiveMembrane'], prerequisites: ['Warworks_Core_Ally'] },
      core_2: { salvage: ['1x ArcaneCantrip', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Warworks_Core_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x GenomicAnalysis', '1x AncientTexts'], prerequisites: ['Warworks_Radial_Ally'] },
      radial_2: { salvage: ['1x EnchantedSand', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Warworks_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SelfEvolvingAlloy'], prerequisites: ['Warworks_Total_Core_Improved_Ally', 'Warworks_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x SuperchargedCapacitor', '1x LivingRelic'], prerequisites: ['Warworks_Total_Radial_Improved_Ally', 'Warworks_Partial_Radial_Improved_Ally'] },
    },
  },
  Vanguard: {
    tier1: { core: { salvage: ['2x ArcaneCantrip', '1x MeditationTechniques'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x EnchantedSand', '1x ArcaneCantrip', '1x WornSpellbook'], prerequisites: ['Vanguard_Ally'] },
      radial: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x CytoliticInfusion'], prerequisites: ['Vanguard_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x ArcaneCantrip', '1x SuperchargedCapacitor', '1x SuperconductiveMembrane'], prerequisites: ['Vanguard_Core_Ally'] },
      core_2: { salvage: ['1x ArcaneCantrip', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Vanguard_Core_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x GenomicAnalysis', '1x AncientTexts'], prerequisites: ['Vanguard_Radial_Ally'] },
      radial_2: { salvage: ['1x EnchantedSand', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Vanguard_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SelfEvolvingAlloy'], prerequisites: ['Vanguard_Total_Core_Improved_Ally', 'Vanguard_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x SuperchargedCapacitor', '1x LivingRelic'], prerequisites: ['Vanguard_Total_Radial_Improved_Ally', 'Vanguard_Partial_Radial_Improved_Ally'] },
    },
  },
  Tsoo: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x BiomorphicGoo', '1x EnchantedSand', '1x WornSpellbook'], prerequisites: ['Tsoo_Ally'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x SuperchargedCapacitor', '1x DimensionalPocket'], prerequisites: ['Tsoo_Ally'] },
    },
    tier3: {
      core: { salvage: ['2x EnchantedSand', '1x SuperconductiveMembrane'], prerequisites: ['Tsoo_Core_Ally'] },
      core_2: { salvage: ['1x BiomorphicGoo', '1x EnchantedSand', '1x SuperconductiveMembrane'], prerequisites: ['Tsoo_Core_Ally'] },
      radial: { salvage: ['1x DetailedReports', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Tsoo_Radial_Ally'] },
      radial_2: { salvage: ['2x EnchantedSand', '1x SemiConsciousEnergy'], prerequisites: ['Tsoo_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x GenomicAnalysis', '1x ThaumicResonator'], prerequisites: ['Tsoo_Total_Core_Improved_Ally', 'Tsoo_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x ForbiddenTechnique'], prerequisites: ['Tsoo_Total_Radial_Improved_Ally', 'Tsoo_Partial_Radial_Improved_Ally'] },
    },
  },
  Talons: {
    tier1: { core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Talons_of_Vengeance_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x WornSpellbook'], prerequisites: ['Talons_of_Vengeance_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Talons_of_Vengeance_Core_Ally'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SemiConsciousEnergy'], prerequisites: ['Talons_of_Vengeance_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Talons_of_Vengeance_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Talons_of_Vengeance_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x GenomicAnalysis', '1x LivingRelic'], prerequisites: ['Talons_of_Vengeance_Total_Core_Improved_Ally', 'Talons_of_Vengeance_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x ArcaneCantrip', '1x ForbiddenTechnique'], prerequisites: ['Talons_of_Vengeance_Total_Radial_Improved_Ally', 'Talons_of_Vengeance_Partial_Radial_Improved_Ally'] },
    },
  },
  Storm: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x BiomorphicGoo', '1x EnchantedSand', '1x WornSpellbook'], prerequisites: ['Storm_Elemental_Ally'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x SuperchargedCapacitor', '1x DimensionalPocket'], prerequisites: ['Storm_Elemental_Ally'] },
    },
    tier3: {
      core: { salvage: ['2x EnchantedSand', '1x SuperconductiveMembrane'], prerequisites: ['Storm_Elemental_Core_Ally'] },
      core_2: { salvage: ['1x BiomorphicGoo', '1x EnchantedSand', '1x SuperconductiveMembrane'], prerequisites: ['Storm_Elemental_Core_Ally'] },
      radial: { salvage: ['1x DetailedReports', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Storm_Elemental_Radial_Ally'] },
      radial_2: { salvage: ['2x EnchantedSand', '1x SemiConsciousEnergy'], prerequisites: ['Storm_Elemental_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x GenomicAnalysis', '1x ThaumicResonator'], prerequisites: ['Storm_Elemental_Total_Core_Improved_Ally', 'Storm_Elemental_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x ForbiddenTechnique'], prerequisites: ['Storm_Elemental_Total_Radial_Improved_Ally', 'Storm_Elemental_Partial_Radial_Improved_Ally'] },
    },
  },
  Seers: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x BiomorphicGoo', '1x NanotechGrowthMedium', '1x WornSpellbook'], prerequisites: ['Seers_Ally'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x SuperchargedCapacitor', '1x DimensionalPocket'], prerequisites: ['Seers_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x EnchantedSand', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['Seers_Core_Ally'] },
      core_2: { salvage: ['1x BiomorphicGoo', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['Seers_Core_Ally'] },
      radial: { salvage: ['1x DetailedReports', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Seers_Radial_Ally'] },
      radial_2: { salvage: ['1x NanotechGrowthMedium', '1x EnchantedSand', '1x SemiConsciousEnergy'], prerequisites: ['Seers_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x GenomicAnalysis', '1x ThaumicResonator'], prerequisites: ['Seers_Total_Core_Improved_Ally', 'Seers_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x BiomorphicGoo', '1x ForbiddenTechnique'], prerequisites: ['Seers_Total_Radial_Improved_Ally', 'Seers_Partial_Radial_Improved_Ally'] },
    },
  },
  Rularuu: {
    tier1: { core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Rularuu_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x WornSpellbook'], prerequisites: ['Rularuu_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Rularuu_Core_Ally'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SemiConsciousEnergy'], prerequisites: ['Rularuu_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Rularuu_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Rularuu_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x GenomicAnalysis', '1x LivingRelic'], prerequisites: ['Rularuu_Total_Core_Improved_Ally', 'Rularuu_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x ArcaneCantrip', '1x ForbiddenTechnique'], prerequisites: ['Rularuu_Total_Radial_Improved_Ally', 'Rularuu_Partial_Radial_Improved_Ally'] },
    },
  },
  Robotic: {
    tier1: { core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Robotic_Drones_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x WornSpellbook'], prerequisites: ['Robotic_Drones_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Robotic_Drones_Core_Ally'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x ExoticIsotope'], prerequisites: ['Robotic_Drones_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Robotic_Drones_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['Robotic_Drones_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x NanotechGrowthMedium', '1x ThaumicResonator'], prerequisites: ['Robotic_Drones_Total_Core_Improved_Ally', 'Robotic_Drones_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x ArcaneCantrip', '1x SelfEvolvingAlloy'], prerequisites: ['Robotic_Drones_Total_Radial_Improved_Ally', 'Robotic_Drones_Partial_Radial_Improved_Ally'] },
    },
  },
  Rikti: {
    tier1: { core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Rikti_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x CytoliticInfusion'], prerequisites: ['Rikti_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x DetailedReports', '1x SuperconductiveMembrane'], prerequisites: ['Rikti_Core_Ally'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x DetailedReports', '1x ExoticIsotope'], prerequisites: ['Rikti_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Rikti_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x DetailedReports', '1x SuperconductiveMembrane'], prerequisites: ['Rikti_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['1x GenomicAnalysis', '1x DetailedReports', '1x LivingRelic'], prerequisites: ['Rikti_Total_Core_Improved_Ally', 'Rikti_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x ArcaneCantrip', '1x SelfEvolvingAlloy'], prerequisites: ['Rikti_Total_Radial_Improved_Ally', 'Rikti_Partial_Radial_Improved_Ally'] },
    },
  },
  Polar: {
    tier1: { core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Polar_Lights_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x WornSpellbook'], prerequisites: ['Polar_Lights_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Polar_Lights_Core_Ally'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x ArcaneCantrip', '1x AncientTexts'], prerequisites: ['Polar_Lights_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Polar_Lights_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x ArcaneCantrip', '1x SemiConsciousEnergy'], prerequisites: ['Polar_Lights_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x ArcaneCantrip', '1x LivingRelic'], prerequisites: ['Polar_Lights_Total_Core_Improved_Ally', 'Polar_Lights_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['2x ArcaneCantrip', '1x ForbiddenTechnique'], prerequisites: ['Polar_Lights_Total_Radial_Improved_Ally', 'Polar_Lights_Partial_Radial_Improved_Ally'] },
    },
  },
  Phantom: {
    tier1: { core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Phantom_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x GluonCompound'], prerequisites: ['Phantom_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Phantom_Core_Ally'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x AncientTexts'], prerequisites: ['Phantom_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Phantom_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x ExoticIsotope'], prerequisites: ['Phantom_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x EnchantedSand', '1x LivingRelic'], prerequisites: ['Phantom_Total_Core_Improved_Ally', 'Phantom_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x ArcaneCantrip', '1x ForbiddenTechnique'], prerequisites: ['Phantom_Total_Radial_Improved_Ally', 'Phantom_Partial_Radial_Improved_Ally'] },
    },
  },
  Nemesis: {
    tier1: { core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Nemesis_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x CytoliticInfusion'], prerequisites: ['Nemesis_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x ExoticIsotope'], prerequisites: ['Nemesis_Core_Ally'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x SemiConsciousEnergy'], prerequisites: ['Nemesis_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Nemesis_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['Nemesis_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x NanotechGrowthMedium', '1x LivingRelic'], prerequisites: ['Nemesis_Total_Core_Improved_Ally', 'Nemesis_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x ArcaneCantrip', '1x SelfEvolvingAlloy'], prerequisites: ['Nemesis_Total_Radial_Improved_Ally', 'Nemesis_Partial_Radial_Improved_Ally'] },
    },
  },
  Longbow: {
    tier1: { core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x GluonCompound'], prerequisites: ['Longbow_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x CytoliticInfusion'], prerequisites: ['Longbow_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SemiConsciousEnergy'], prerequisites: ['Longbow_Core_Ally'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x ExoticIsotope'], prerequisites: ['Longbow_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Longbow_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x ExoticIsotope'], prerequisites: ['Longbow_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x NanotechGrowthMedium', '1x ThaumicResonator'], prerequisites: ['Longbow_Total_Core_Improved_Ally', 'Longbow_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x ArcaneCantrip', '1x SelfEvolvingAlloy'], prerequisites: ['Longbow_Total_Radial_Improved_Ally', 'Longbow_Partial_Radial_Improved_Ally'] },
    },
  },
  Knives: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x BiomorphicGoo', '1x GenomicAnalysis'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x ArcaneCantrip', '1x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['Knives_of_Vengeance_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x CytoliticInfusion'], prerequisites: ['Knives_of_Vengeance_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Knives_of_Vengeance_Core_Ally'] },
      core_2: { salvage: ['1x ArcaneCantrip', '1x NanotechGrowthMedium', '1x SemiConsciousEnergy'], prerequisites: ['Knives_of_Vengeance_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Knives_of_Vengeance_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['Knives_of_Vengeance_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x NanotechGrowthMedium', '1x LivingRelic'], prerequisites: ['Knives_of_Vengeance_Total_Core_Improved_Ally', 'Knives_of_Vengeance_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x ArcaneCantrip', '1x ThaumicResonator'], prerequisites: ['Knives_of_Vengeance_Total_Radial_Improved_Ally', 'Knives_of_Vengeance_Partial_Radial_Improved_Ally'] },
    },
  },
  IDF: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x BiomorphicGoo', '1x GenomicAnalysis'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x ArcaneCantrip', '1x EnchantedSand', '1x DimensionalPocket'], prerequisites: ['IDF_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x CytoliticInfusion'], prerequisites: ['IDF_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['IDF_Core_Ally'] },
      core_2: { salvage: ['1x ArcaneCantrip', '1x NanotechGrowthMedium', '1x SemiConsciousEnergy'], prerequisites: ['IDF_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['IDF_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x SuperconductiveMembrane'], prerequisites: ['IDF_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x NanotechGrowthMedium', '1x LivingRelic'], prerequisites: ['IDF_Total_Core_Improved_Ally', 'IDF_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x ArcaneCantrip', '1x ThaumicResonator'], prerequisites: ['IDF_Total_Radial_Improved_Ally', 'IDF_Partial_Radial_Improved_Ally'] },
    },
  },
  Clockwork: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x MeditationTechniques'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x SuperchargedCapacitor', '1x GluonCompound'], prerequisites: ['Clockwork_Ally'] },
      radial: { salvage: ['2x BiomorphicGoo', '1x WornSpellbook'], prerequisites: ['Clockwork_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x DetailedReports', '1x ExoticIsotope'], prerequisites: ['Clockwork_Core_Ally'] },
      core_2: { salvage: ['2x MeditationTechniques', '1x SemiConsciousEnergy'], prerequisites: ['Clockwork_Core_Ally'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x MeditationTechniques', '1x ExoticIsotope'], prerequisites: ['Clockwork_Radial_Ally'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Clockwork_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x MeditationTechniques', '1x ThaumicResonator'], prerequisites: ['Clockwork_Total_Core_Improved_Ally', 'Clockwork_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x ForbiddenTechnique'], prerequisites: ['Clockwork_Total_Radial_Improved_Ally', 'Clockwork_Partial_Radial_Improved_Ally'] },
    },
  },
  Cimeroran: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x MeditationTechniques'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x SuperchargedCapacitor', '1x GluonCompound'], prerequisites: ['Cimeroran_Ally'] },
      radial: { salvage: ['2x BiomorphicGoo', '1x DimensionalPocket'], prerequisites: ['Cimeroran_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x DetailedReports', '1x ExoticIsotope'], prerequisites: ['Cimeroran_Core_Ally'] },
      core_2: { salvage: ['2x MeditationTechniques', '1x SemiConsciousEnergy'], prerequisites: ['Cimeroran_Core_Ally'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x MeditationTechniques', '1x ExoticIsotope'], prerequisites: ['Cimeroran_Radial_Ally'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Cimeroran_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x MeditationTechniques', '1x ThaumicResonator'], prerequisites: ['Cimeroran_Total_Core_Improved_Ally', 'Cimeroran_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x ForbiddenTechnique'], prerequisites: ['Cimeroran_Total_Radial_Improved_Ally', 'Cimeroran_Partial_Radial_Improved_Ally'] },
    },
  },
  Carnival: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x MeditationTechniques'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x BiomorphicGoo', '1x SuperchargedCapacitor', '1x GluonCompound'], prerequisites: ['Carnival_Ally'] },
      radial: { salvage: ['2x BiomorphicGoo', '1x WornSpellbook'], prerequisites: ['Carnival_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x DetailedReports', '1x SemiConsciousEnergy'], prerequisites: ['Carnival_Core_Ally'] },
      core_2: { salvage: ['2x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Carnival_Core_Ally'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x BiomorphicGoo', '1x ExoticIsotope'], prerequisites: ['Carnival_Radial_Ally'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Carnival_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x BiomorphicGoo', '1x ThaumicResonator'], prerequisites: ['Carnival_Total_Core_Improved_Ally', 'Carnival_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x ForbiddenTechnique'], prerequisites: ['Carnival_Total_Radial_Improved_Ally', 'Carnival_Partial_Radial_Improved_Ally'] },
    },
  },
  Banished: {
    tier1: { core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x GluonCompound'], prerequisites: ['Banished_Pantheon_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x EnchantedSand', '1x CytoliticInfusion'], prerequisites: ['Banished_Pantheon_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x GenomicAnalysis', '1x SemiConsciousEnergy'], prerequisites: ['Banished_Pantheon_Core_Ally'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x ExoticIsotope'], prerequisites: ['Banished_Pantheon_Core_Ally'] },
      radial: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Banished_Pantheon_Radial_Ally'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x NanotechGrowthMedium', '1x ExoticIsotope'], prerequisites: ['Banished_Pantheon_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['2x NanotechGrowthMedium', '1x ThaumicResonator'], prerequisites: ['Banished_Pantheon_Total_Core_Improved_Ally', 'Banished_Pantheon_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x ArcaneCantrip', '1x SelfEvolvingAlloy'], prerequisites: ['Banished_Pantheon_Total_Radial_Improved_Ally', 'Banished_Pantheon_Partial_Radial_Improved_Ally'] },
    },
  },
  Arachnos: {
    tier1: { core: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x MeditationTechniques'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x BiomorphicGoo', '1x SuperchargedCapacitor', '1x GluonCompound'], prerequisites: ['Arachnos_Ally'] },
      radial: { salvage: ['2x BiomorphicGoo', '1x CytoliticInfusion'], prerequisites: ['Arachnos_Ally'] },
    },
    tier3: {
      core: { salvage: ['1x GenomicAnalysis', '1x DetailedReports', '1x ExoticIsotope'], prerequisites: ['Arachnos_Core_Ally'] },
      core_2: { salvage: ['2x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Arachnos_Core_Ally'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x BiomorphicGoo', '1x ExoticIsotope'], prerequisites: ['Arachnos_Radial_Ally'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x BiomorphicGoo', '1x AncientTexts'], prerequisites: ['Arachnos_Radial_Ally'] },
    },
    tier4: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x BiomorphicGoo', '1x ThaumicResonator'], prerequisites: ['Arachnos_Total_Core_Improved_Ally', 'Arachnos_Partial_Core_Improved_Ally'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x DetailedReports', '1x SelfEvolvingAlloy'], prerequisites: ['Arachnos_Total_Radial_Improved_Ally', 'Arachnos_Partial_Radial_Improved_Ally'] },
    },
  },
};

const DESTINY_DATA: RawSlotData = {
  Incandescence: {
    tier1: { core: { salvage: ['1x EnchantedSand', '1x ArcaneCantrip', '1x BiomorphicGoo'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x NanotechGrowthMedium', '1x BiomorphicGoo', '1x GluonCompound'], prerequisites: ['Incandescence_Invocation'] },
      radial: { salvage: ['1x DetailedReports', '1x NanotechGrowthMedium', '1x WornSpellbook'], prerequisites: ['Incandescence_Invocation'] },
    },
    tier3: {
      core: { salvage: ['1x EnchantedSand', '1x DetailedReports', '1x SemiConsciousEnergy'], prerequisites: ['Incandescence_Core_Invocation'] },
      core_2: { salvage: ['1x BiomorphicGoo', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Incandescence_Core_Invocation'] },
      radial: { salvage: ['1x DetailedReports', '1x SuperchargedCapacitor', '1x SemiConsciousEnergy'], prerequisites: ['Incandescence_Radial_Invocation'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x BiomorphicGoo', '1x SuperconductiveMembrane'], prerequisites: ['Incandescence_Radial_Invocation'] },
    },
    tier4: {
      core: { salvage: ['1x DetailedReports', '1x BiomorphicGoo', '1x SelfEvolvingAlloy'], prerequisites: ['Incandescence_Total_Core_Invocation', 'Incandescence_Partial_Core_Invocation'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x ArcaneCantrip', '1x ThaumicResonator'], prerequisites: ['Incandescence_Total_Radial_Invocation', 'Incandescence_Partial_Radial_Invocation'] },
    },
  },
  Rebirth: {
    tier1: { core: { salvage: ['2x GenomicAnalysis', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['2x SuperchargedCapacitor', '1x WornSpellbook'], prerequisites: ['Rebirth_Invocation'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x BiomorphicGoo', '1x DimensionalPocket'], prerequisites: ['Rebirth_Invocation'] },
    },
    tier3: {
      core: { salvage: ['1x NanotechGrowthMedium', '1x GenomicAnalysis', '1x AncientTexts'], prerequisites: ['Rebirth_Core_Invocation'] },
      core_2: { salvage: ['2x NanotechGrowthMedium', '1x SemiConsciousEnergy'], prerequisites: ['Rebirth_Core_Invocation'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Rebirth_Radial_Invocation'] },
      radial_2: { salvage: ['1x EnchantedSand', '1x DetailedReports', '1x AncientTexts'], prerequisites: ['Rebirth_Radial_Invocation'] },
    },
    tier4: {
      core: { salvage: ['1x EnchantedSand', '1x DetailedReports', '1x LivingRelic'], prerequisites: ['Rebirth_Total_Core_Invocation', 'Rebirth_Partial_Core_Invocation'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x EnchantedSand', '1x ForbiddenTechnique'], prerequisites: ['Rebirth_Total_Radial_Invocation', 'Rebirth_Partial_Radial_Invocation'] },
    },
  },
  Clarion: {
    tier1: { core: { salvage: ['1x EnchantedSand', '1x ArcaneCantrip', '1x BiomorphicGoo'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x NanotechGrowthMedium', '1x BiomorphicGoo', '1x GluonCompound'], prerequisites: ['Clarion_Invocation'] },
      radial: { salvage: ['1x DetailedReports', '1x NanotechGrowthMedium', '1x WornSpellbook'], prerequisites: ['Clarion_Invocation'] },
    },
    tier3: {
      core: { salvage: ['1x EnchantedSand', '1x DetailedReports', '1x SemiConsciousEnergy'], prerequisites: ['Clarion_Core_Invocation'] },
      core_2: { salvage: ['1x BiomorphicGoo', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Clarion_Core_Invocation'] },
      radial: { salvage: ['1x DetailedReports', '1x SuperchargedCapacitor', '1x SemiConsciousEnergy'], prerequisites: ['Clarion_Radial_Invocation'] },
      radial_2: { salvage: ['1x GenomicAnalysis', '1x BiomorphicGoo', '1x SuperconductiveMembrane'], prerequisites: ['Clarion_Radial_Invocation'] },
    },
    tier4: {
      core: { salvage: ['1x DetailedReports', '1x BiomorphicGoo', '1x SelfEvolvingAlloy'], prerequisites: ['Clarion_Total_Core_Invocation', 'Clarion_Partial_Core_Invocation'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x ArcaneCantrip', '1x ThaumicResonator'], prerequisites: ['Clarion_Total_Radial_Invocation', 'Clarion_Partial_Radial_Invocation'] },
    },
  },
  Barrier: {
    tier1: { core: { salvage: ['1x NanotechGrowthMedium', '1x ArcaneCantrip', '1x GenomicAnalysis'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x DetailedReports', '1x MeditationTechniques', '1x GluonCompound'], prerequisites: ['Barrier_Invocation'] },
      radial: { salvage: ['1x MeditationTechniques', '1x ArcaneCantrip', '1x DimensionalPocket'], prerequisites: ['Barrier_Invocation'] },
    },
    tier3: {
      core: { salvage: ['1x MeditationTechniques', '1x BiomorphicGoo', '1x SuperconductiveMembrane'], prerequisites: ['Barrier_Core_Invocation'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x SuperchargedCapacitor', '1x SemiConsciousEnergy'], prerequisites: ['Barrier_Core_Invocation'] },
      radial: { salvage: ['1x DetailedReports', '1x EnchantedSand', '1x SemiConsciousEnergy'], prerequisites: ['Barrier_Radial_Invocation'] },
      radial_2: { salvage: ['1x SuperchargedCapacitor', '1x ArcaneCantrip', '1x AncientTexts'], prerequisites: ['Barrier_Radial_Invocation'] },
    },
    tier4: {
      core: { salvage: ['1x NanotechGrowthMedium', '1x GenomicAnalysis', '1x ForbiddenTechnique'], prerequisites: ['Barrier_Total_Core_Invocation', 'Barrier_Partial_Core_Invocation'] },
      radial: { salvage: ['1x DetailedReports', '1x GenomicAnalysis', '1x LivingRelic'], prerequisites: ['Barrier_Total_Radial_Invocation', 'Barrier_Partial_Radial_Invocation'] },
    },
  },
  Ageless: {
    tier1: { core: { salvage: ['1x GenomicAnalysis', '1x NanotechGrowthMedium', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['2x MeditationTechniques', '1x WornSpellbook'], prerequisites: ['Ageless_Invocation'] },
      radial: { salvage: ['1x DetailedReports', '1x GenomicAnalysis', '1x CytoliticInfusion'], prerequisites: ['Ageless_Invocation'] },
    },
    tier3: {
      core: { salvage: ['1x EnchantedSand', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Ageless_Core_Invocation'] },
      core_2: { salvage: ['1x NanotechGrowthMedium', '1x ArcaneCantrip', '1x SemiConsciousEnergy'], prerequisites: ['Ageless_Core_Invocation'] },
      radial: { salvage: ['1x EnchantedSand', '1x GenomicAnalysis', '1x SuperconductiveMembrane'], prerequisites: ['Ageless_Radial_Invocation'] },
      radial_2: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x SemiConsciousEnergy'], prerequisites: ['Ageless_Radial_Invocation'] },
    },
    tier4: {
      core: { salvage: ['2x BiomorphicGoo', '1x SelfEvolvingAlloy'], prerequisites: ['Ageless_Total_Core_Invocation', 'Ageless_Partial_Core_Invocation'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x DetailedReports', '1x LivingRelic'], prerequisites: ['Ageless_Total_Radial_Invocation', 'Ageless_Partial_Radial_Invocation'] },
    },
  },
};

const HYBRID_DATA: RawSlotData = {
  Support: {
    tier1: { core: { salvage: ['2x SuperchargedCapacitor', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x EnchantedSand', '1x ArcaneCantrip', '1x GluonCompound'], prerequisites: ['Support_Genome'] },
      radial: { salvage: ['1x DetailedReports', '1x GenomicAnalysis', '1x CytoliticInfusion'], prerequisites: ['Support_Genome'] },
    },
    tier3: {
      core: { salvage: ['1x NanotechGrowthMedium', '1x DetailedReports', '1x ExoticIsotope'], prerequisites: ['Support_Core_Genome'] },
      core_2: { salvage: ['1x GenomicAnalysis', '1x MeditationTechniques', '1x SuperconductiveMembrane'], prerequisites: ['Support_Core_Genome'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Support_Radial_Genome'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x EnchantedSand', '1x ExoticIsotope'], prerequisites: ['Support_Radial_Genome'] },
    },
    tier4: {
      core: { salvage: ['1x GenomicAnalysis', '1x BiomorphicGoo', '1x SelfEvolvingAlloy'], prerequisites: ['Support_Total_Core_Graft', 'Support_Partial_Core_Graft'] },
      radial: { salvage: ['1x BiomorphicGoo', '1x EnchantedSand', '1x ThaumicResonator'], prerequisites: ['Support_Total_Radial_Graft', 'Support_Partial_Radial_Graft'] },
    },
  },
  Melee: {
    tier1: { core: { salvage: ['1x NanotechGrowthMedium', '1x SuperchargedCapacitor', '1x DetailedReports'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x BiomorphicGoo', '1x DetailedReports', '1x WornSpellbook'], prerequisites: ['Melee_Genome'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x DetailedReports', '1x GluonCompound'], prerequisites: ['Melee_Genome'] },
    },
    tier3: {
      core: { salvage: ['1x BiomorphicGoo', '1x MeditationTechniques', '1x AncientTexts'], prerequisites: ['Melee_Core_Genome'] },
      core_2: { salvage: ['1x MeditationTechniques', '1x DetailedReports', '1x SemiConsciousEnergy'], prerequisites: ['Melee_Core_Genome'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Melee_Radial_Genome'] },
      radial_2: { salvage: ['1x MeditationTechniques', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Melee_Radial_Genome'] },
    },
    tier4: {
      core: { salvage: ['1x GenomicAnalysis', '1x MeditationTechniques', '1x ThaumicResonator'], prerequisites: ['Melee_Total_Core_Graft', 'Melee_Partial_Core_Graft'] },
      radial: { salvage: ['1x SuperchargedCapacitor', '1x NanotechGrowthMedium', '1x LivingRelic'], prerequisites: ['Melee_Total_Radial_Graft', 'Melee_Partial_Radial_Graft'] },
    },
  },
  Control: {
    tier1: { core: { salvage: ['1x DetailedReports', '1x MeditationTechniques', '1x EnchantedSand'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x SuperchargedCapacitor', '1x NanotechGrowthMedium', '1x CytoliticInfusion'], prerequisites: ['Control_Genome'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x MeditationTechniques', '1x DimensionalPocket'], prerequisites: ['Control_Genome'] },
    },
    tier3: {
      core: { salvage: ['1x NanotechGrowthMedium', '1x EnchantedSand', '1x SemiConsciousEnergy'], prerequisites: ['Control_Core_Genome'] },
      core_2: { salvage: ['1x GenomicAnalysis', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Control_Core_Genome'] },
      radial: { salvage: ['1x GenomicAnalysis', '1x SuperchargedCapacitor', '1x SuperconductiveMembrane'], prerequisites: ['Control_Radial_Genome'] },
      radial_2: { salvage: ['1x EnchantedSand', '1x BiomorphicGoo', '1x SemiConsciousEnergy'], prerequisites: ['Control_Radial_Genome'] },
    },
    tier4: {
      core: { salvage: ['1x BiomorphicGoo', '1x DetailedReports', '1x SelfEvolvingAlloy'], prerequisites: ['Control_Total_Core_Graft', 'Control_Partial_Core_Graft'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x EnchantedSand', '1x ForbiddenTechnique'], prerequisites: ['Control_Total_Radial_Graft', 'Control_Partial_Radial_Graft'] },
    },
  },
  Assault: {
    tier1: { core: { salvage: ['1x GenomicAnalysis', '1x EnchantedSand', '1x ArcaneCantrip'], prerequisites: [] } },
    tier2: {
      core: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x WornSpellbook'], prerequisites: ['Assault_Genome'] },
      radial: { salvage: ['1x ArcaneCantrip', '1x GenomicAnalysis', '1x DimensionalPocket'], prerequisites: ['Assault_Genome'] },
    },
    tier3: {
      core: { salvage: ['1x DetailedReports', '1x NanotechGrowthMedium', '1x AncientTexts'], prerequisites: ['Assault_Core_Genome'] },
      core_2: { salvage: ['2x GenomicAnalysis', '1x SemiConsciousEnergy'], prerequisites: ['Assault_Core_Genome'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x SuperchargedCapacitor', '1x ExoticIsotope'], prerequisites: ['Assault_Radial_Genome'] },
      radial_2: { salvage: ['1x EnchantedSand', '1x GenomicAnalysis', '1x ExoticIsotope'], prerequisites: ['Assault_Radial_Genome'] },
    },
    tier4: {
      core: { salvage: ['1x DetailedReports', '1x ArcaneCantrip', '1x LivingRelic'], prerequisites: ['Assault_Total_Core_Graft', 'Assault_Partial_Core_Graft'] },
      radial: { salvage: ['1x NanotechGrowthMedium', '1x MeditationTechniques', '1x ForbiddenTechnique'], prerequisites: ['Assault_Total_Radial_Graft', 'Assault_Partial_Radial_Graft'] },
    },
  },
};

const RAW_COMPONENTS: Record<IncarnateSlotId, RawSlotData> = {
  alpha: ALPHA_DATA,
  judgement: JUDGEMENT_DATA,
  interface: INTERFACE_DATA,
  lore: LORE_DATA,
  destiny: DESTINY_DATA,
  hybrid: HYBRID_DATA,
  // Genesis (Rebirth-only) salvage isn't catalogued yet; the slot is excluded
  // from the crafting UI, so an empty map is correct (accessors return null).
  genesis: {},
};

// ============================================
// LORE TREE NAME MAPPING
// ============================================

export const LORE_TREE_NAME_MAP: Record<string, string> = {
  'Arachnos': 'Arachnos',
  'Banished': 'Banished',
  'Banished Pantheon': 'Banished',
  'Carnival': 'Carnival',
  'Carnival of Shadows': 'Carnival',
  'Cimeroran': 'Cimeroran',
  'Clockwork': 'Clockwork',
  'Drones': 'Robotic',
  'Robotic Drones': 'Robotic',
  'Elementals': 'Storm',
  'Storm Elemental': 'Storm',
  'IDF': 'IDF',
  'Knives': 'Knives',
  'Knives of Artemis': 'Knives',
  'Lights': 'Polar',
  'Polar Lights': 'Polar',
  'Longbow': 'Longbow',
  'Nemesis': 'Nemesis',
  'Phantoms': 'Phantom',
  'Rikti': 'Rikti',
  'Rularuu': 'Rularuu',
  'Seers': 'Seers',
  'Talons': 'Talons',
  'Talons of Vengeance': 'Talons',
  'Tsoo': 'Tsoo',
  'Vanguard': 'Vanguard',
  'WarWorks': 'Warworks',
  'Praetorian Clockwork': 'Warworks',
};

// ============================================
// PROCESSED DATA CACHE
// ============================================

type ProcessedTree = Record<number, Partial<Record<CraftingVariantKey, CraftingVariant>>>;
type ProcessedSlot = Record<string, ProcessedTree>;
let _processedCache: Record<IncarnateSlotId, ProcessedSlot> | null = null;

function processRawData(): Record<IncarnateSlotId, ProcessedSlot> {
  const result = {} as Record<IncarnateSlotId, ProcessedSlot>;

  for (const [slotId, slotData] of Object.entries(RAW_COMPONENTS)) {
    const processedSlot: ProcessedSlot = {};

    for (const [treeName, treeData] of Object.entries(slotData)) {
      const processedTree: ProcessedTree = {};

      for (const [tierKey, tierData] of Object.entries(treeData)) {
        const tierNum = parseInt(tierKey.replace('tier', ''), 10);
        const processedTier: Partial<Record<CraftingVariantKey, CraftingVariant>> = {};

        for (const [variantKey, variantData] of Object.entries(tierData as Record<string, RawVariant>)) {
          processedTier[variantKey as CraftingVariantKey] = {
            name: variantKey,
            salvage: variantData.salvage.map(parseSalvageString),
            prerequisites: variantData.prerequisites,
          };
        }

        processedTree[tierNum] = processedTier;
      }

      processedSlot[treeName] = processedTree;
    }

    result[slotId as IncarnateSlotId] = processedSlot;
  }

  return result;
}

function ensureProcessed(): Record<IncarnateSlotId, ProcessedSlot> {
  if (!_processedCache) {
    _processedCache = processRawData();
  }
  return _processedCache;
}

// ============================================
// PUBLIC API
// ============================================

export function getComponentTreeKey(slotId: IncarnateSlotId, treeName: string): string {
  if (slotId === 'lore') {
    return LORE_TREE_NAME_MAP[treeName] || treeName;
  }
  return treeName;
}

export function getTreeComponents(
  slotId: IncarnateSlotId,
  treeName: string
): Record<number, Partial<Record<CraftingVariantKey, CraftingVariant>>> | null {
  const data = ensureProcessed();
  const key = getComponentTreeKey(slotId, treeName);
  return data[slotId]?.[key] || null;
}

export function getVariantComponents(
  slotId: IncarnateSlotId,
  treeName: string,
  tier: number,
  variant: CraftingVariantKey
): CraftingVariant | null {
  const tree = getTreeComponents(slotId, treeName);
  return tree?.[tier]?.[variant] || null;
}

export function getCumulativeSalvage(
  slotId: IncarnateSlotId,
  treeName: string,
  tier: number,
  variant: CraftingVariantKey
): SalvageRequirement[] {
  const tree = getTreeComponents(slotId, treeName);
  if (!tree) return [];

  const salvage: SalvageRequirement[] = [];
  // Collect salvage from T1 up to target tier
  for (let t = 1; t <= tier; t++) {
    const tierData = tree[t];
    if (!tierData) continue;
    // For the target tier, use the specified variant; for lower tiers, use the matching branch
    const branch = variant.startsWith('radial') ? 'radial' : 'core';
    let v: CraftingVariantKey;
    if (t === tier) {
      v = variant;
    } else if (t === 1) {
      v = 'core'; // T1 always has only 'core'
    } else {
      v = branch as CraftingVariantKey;
    }
    const variantData = tierData[v];
    if (variantData) {
      salvage.push(...variantData.salvage);
    }
  }
  return salvage;
}
