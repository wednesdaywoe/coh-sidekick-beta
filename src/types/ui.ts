/**
 * UI state type definitions
 */

import type { EnhancementStatType, EnhancementTier, IOSetRarity } from './common';
import type { Enhancement } from './enhancement';

// ============================================
// ENHANCEMENT PICKER MODAL VIEWS
// ============================================

export type ModalView =
  | 'category'        // Main category selection
  | 'io-sets'         // IO set browsing
  | 'io-set-detail'   // Specific set's pieces
  | 'io-generic'      // Generic IO selection
  | 'special'         // Hamidon/Titan/etc
  | 'origin';         // SO/DO/TO selection

// ============================================
// ENHANCEMENT PICKER STATE
// ============================================

export interface EnhancementPickerState {
  /** Is the modal open? */
  isOpen: boolean;
  /** Current view in the modal */
  currentView: ModalView;
  /** Navigation history for back button */
  viewStack: ModalView[];
  /** Power being enhanced */
  currentPowerName: string | null;
  /** Powerset of the power being enhanced */
  currentPowerSet: string | null;
  /** Build category of the power (primary/secondary/pool/epic/inherent) for disambiguation */
  currentPowerCategory: string | null;
  /** Slot index being filled */
  currentSlotIndex: number;
  /** Current IO set category filter */
  currentCategory: IOSetRarity | 'all' | null;
  /** Selected IO set (when viewing details) */
  selectedSetId: string | null;
  /** Optional override for enhancement selection (used by Compare Slotting modal) */
  onOverrideSelect: ((slotIndex: number, enhancement: Enhancement) => void) | null;
  /** Virtual slots used for empty-slot detection when override is active (e.g. compare modal) */
  virtualSlots: (Enhancement | null)[] | null;
}

// ============================================
// GENERIC/ORIGIN ENHANCEMENT PICKER STATE
// ============================================

export interface GenericPickerState {
  /** Selected enhancement stat type */
  selectedType: EnhancementStatType;
}

export interface OriginPickerState {
  /** Selected enhancement stat type */
  selectedType: EnhancementStatType;
  /** Selected tier (TO/DO/SO) */
  selectedTier: EnhancementTier;
}

// ============================================
// STATS DASHBOARD STATE
// ============================================

export interface StatDisplayConfig {
  /** Stat identifier */
  stat: string;
  /** Whether to show this stat */
  visible: boolean;
  /** Display order */
  order: number;
}

// ============================================
// PLANNER LAYOUT STATE
// ============================================

/**
 * Identifiers for the rearrangeable planner columns. Category view uses
 * available/primary/secondary/pool/inherent/info; chronological view uses
 * available/bylevel/info. `info` is shared by both. The power-pool, epic and
 * inherent trays are split into atomic sections (goal 2): `pool` (power pools
 * only), `epic` (epic/patron), and one section per inherent group
 * (`inherent-fitness` / `inherent-basic` / `inherent-prestige` /
 * `inherent-archetype`), so each can be placed, stacked or hidden on its own.
 * The default layout stacks the atomic sections into shared columns so the row
 * stays 6 columns wide (see `defaultPlannerLayout`).
 */
export type PlannerSectionId =
  | 'available'
  | 'primary'
  | 'secondary'
  | 'pool'
  | 'epic'
  | 'inherent-fitness'
  | 'inherent-basic'
  | 'inherent-prestige'
  | 'inherent-archetype'
  | 'info'
  | 'bylevel';

export interface PlannerSectionConfig {
  /** Which section this entry positions */
  id: PlannerSectionId;
  /** Whether the section is shown in the desktop (lg+) grid */
  visible: boolean;
  /**
   * Horizontal grid track weight in fr units (defaults to 1 when omitted). Lets
   * a section's column claim more horizontal space than its siblings — e.g. the
   * chronological "Powers by Level" grid is 2fr. When several sections stack in
   * one column (see `column`), the column's horizontal weight is taken from the
   * topmost section (first in array order within that column).
   */
  weight?: number;
  /**
   * rearrangeable-layout-11 — which desktop grid *column* this section occupies (0-based). Two or
   * more sections sharing a `column` value stack vertically in one column, in
   * array order (top → bottom). Columns render left-to-right by ascending
   * `column` value. Omitted only in legacy persisted state predating rearrangeable-layout-11;
   * `merge()` backfills it (each section its own column = the historical single
   * row). Kept dense (0..N-1) by the planner-layout helpers after every edit.
   */
  column?: number;
  /**
   * rearrangeable-layout-11 — vertical fr weight *within* a stacked column (defaults to 1). Only
   * meaningful when the section shares its `column` with others; the vertical
   * resize divider drives it, mirroring `weight` on the horizontal axis.
   */
  rowWeight?: number;
  /**
   * Whether this section is collapsed to just its header bar (body hidden). The
   * cell-header chevron toggles it; persisted so a user's collapse choices (and
   * the default layout's initial collapsed sections) survive reload.
   */
  collapsed?: boolean;
}

/**
 * Per-view-mode desktop column arrangement. A flat list per view; the
 * left-to-right / top-to-bottom 2D layout is derived from each entry's `column`
 * (horizontal group) and array order (vertical order within a group). Persisted
 * so a user's layout survives reload. Kept flat (rather than nested columns) so
 * `merge()`'s append-new / drop-unknown reconcile stays a simple list filter.
 */
export interface PlannerLayoutState {
  category: PlannerSectionConfig[];
  chronological: PlannerSectionConfig[];
}

// ============================================
// TOOLTIP STATE
// ============================================

export interface TooltipState {
  /** Is tooltip visible? */
  visible: boolean;
  /** Tooltip content (could be power, enhancement, etc.) */
  content: TooltipContent | null;
  /** Position */
  position: { x: number; y: number };
}

export type TooltipContent =
  | { type: 'power'; powerName: string; powerSet: string }
  | { type: 'enhancement'; enhancement: unknown }
  | { type: 'set-bonus'; setId: string }
  | { type: 'stat'; stat: string; value: number };

// ============================================
// INFO PANEL STATE
// ============================================

export interface InfoPanelState {
  /** Is the info panel enabled? */
  enabled: boolean;
  /** Current content to display */
  content: InfoPanelContent | null;
  /** Is the info panel locked to current content? */
  locked: boolean;
  /** Locked content (separate from hoverable content) */
  lockedContent: InfoPanelContent | null;
  /** Is power info tooltip enabled? */
  tooltipEnabled: boolean;
  /** Is the info panel undocked into a separate window? */
  undocked: boolean;
}

export type InfoPanelContent =
  | { type: 'power'; powerName: string; powerSet: string }
  | { type: 'enhancement'; enhancementId: string }
  | { type: 'set'; setId: string }
  // `powerSet` is REQUIRED: a power's identity is (powerSet, internalName), never
  // internalName alone — internal names are reused across powersets, so resolving
  // this content by bare name can show a different power's enhancement. Matches
  // the `power` variant above. See `findSelectedPowerInBuild`.
  | { type: 'slotted-enhancement'; powerName: string; powerSet: string; slotIndex: number }
  | { type: 'incarnate'; slotId: string; powerId: string };

// ============================================
// GLOBAL UI STATE
// ============================================

export interface UIState {
  /** Enhancement picker modal state */
  enhancementPicker: EnhancementPickerState;

  /** Generic enhancement picker state */
  genericPicker: GenericPickerState;

  /** Origin enhancement picker state */
  originPicker: OriginPickerState;

  /** Global IO level for calculations */
  globalIOLevel: number;

  /** Attunement toggle */
  attunementEnabled: boolean;

  /** Hints/help visibility */
  hintsEnabled: boolean;

  /** Info panel state */
  infoPanel: InfoPanelState;

  /** Stats display configuration */
  statsConfig: StatDisplayConfig[];

  /** Tooltip state */
  tooltip: TooltipState;
}

// ============================================
// DEFAULT UI STATE FACTORY
// ============================================

export function createDefaultUIState(): UIState {
  return {
    enhancementPicker: {
      isOpen: false,
      currentView: 'category',
      viewStack: [],
      currentPowerName: null,
      currentPowerSet: null,
      currentPowerCategory: null,
      currentSlotIndex: 0,
      currentCategory: null,
      selectedSetId: null,
      onOverrideSelect: null,
      virtualSlots: null,
    },
    genericPicker: {
      selectedType: 'Damage',
    },
    originPicker: {
      selectedType: 'Damage',
      selectedTier: 'SO',
    },
    globalIOLevel: 50,
    attunementEnabled: false,
    hintsEnabled: true,
    infoPanel: {
      enabled: true,
      content: null,
      locked: false,
      lockedContent: null,
      tooltipEnabled: false,
      undocked: false,
    },
    statsConfig: [],
    tooltip: {
      visible: false,
      content: null,
      position: { x: 0, y: 0 },
    },
  };
}
