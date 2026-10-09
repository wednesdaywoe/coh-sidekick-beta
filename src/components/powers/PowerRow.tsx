/**
 * PowerRow - Unified power row component used across all planner views
 *
 * Renders a power's icon, name, level, enhancement slots, and toggle switch.
 * Supports multiple size variants and layout modes.
 */

import { useState, useCallback, useMemo } from 'react';
import type { Enhancement, SelectedPower } from '@/types';
import { resolvePath } from '@/utils/paths';
import { powerIllegalSlotIndices } from '@/utils/build-enhancement-validation';
import { useIsTouchDevice, useOffendingPowerReasons } from '@/hooks';
import { Tooltip } from '@/components/ui';
import { TouchableSlot } from './TouchableSlot';
import { DraggableSlotGhost } from './DraggableSlotGhost';
import { SlottedEnhancementList } from './SlottedEnhancementList';
import { SlottedSetBonuses } from './SlottedSetBonuses';
import { PermaRing } from './PermaRing';
import { ProcPotentialBadge } from './ProcPotentialBadge';
import { HitChanceBadge } from './HitChanceBadge';
import type { SlotSize } from './TouchableSlot';
import { useBuildStore, useUIStore, type PowerCategory } from '@/stores';
import { isMovableSlot, type SlotLevel, type SlotLevelRef, type PowerRef } from '@/utils/slot-levels';

type PowerRowSize = 'xs' | 'sm' | 'md' | 'lg';

/** Stable empty set so the invalid-slots memo doesn't churn for clean powers. */
const EMPTY_INVALID_SET: ReadonlySet<number> = new Set();

const SLOT_SIZE_MAP: Record<PowerRowSize, SlotSize> = {
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'md',
};

const GHOST_SIZE_MAP: Record<PowerRowSize, 'xs' | 'sm' | 'md'> = {
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'md',
};

const ICON_CLASS_MAP: Record<PowerRowSize, string> = {
  xs: 'w-4 h-4',
  sm: 'w-4 h-4',
  md: 'w-4 h-4',
  lg: 'w-6 h-6',
};

const TOGGLE_CONFIG = {
  md: { outer: 'w-6 h-3', knob: 'w-2 h-2', translate: 'translate-x-3', offset: 'top-[2px] left-[2px]' },
  sm: { outer: 'w-5 h-2.5', knob: 'w-1.5 h-1.5', translate: 'translate-x-2.5', offset: 'top-[2px] left-[2px]' },
};

interface PowerRowProps {
  name: string;
  iconSrc: string;
  size?: PowerRowSize;
  stackedLayout?: boolean;
  level?: number;
  showRemove?: boolean;
  showAutoLabel?: boolean;
  categoryBorder?: string;
  muted?: boolean;
  toggleSize?: 'sm' | 'md';
  isActive?: boolean;
  onToggle?: () => void;
  slots: (Enhancement | null)[];
  maxSlots: number;
  isLocked?: boolean;
  onRemove?: () => void;
  onAddSlots?: (count: number) => void;
  onRemoveSlot?: (slotIndex: number) => void;
  onRemoveAllSlots?: () => void;
  onClearEnhancement?: (slotIndex: number) => void;
  onClearAllEnhancements?: () => void;
  onOpenPicker?: (slotIndex: number) => void;
  onHover?: () => void;
  onLeave?: () => void;
  onEnhancementHover?: (slotIndex: number) => void;
  onRightClick?: (e: React.MouseEvent) => void;
  onCompareSlotting?: () => void;
  onInfoClick?: () => void;
  slotLevels?: SlotLevel[];
  /** Full power object for perma ring display */
  selectedPower?: SelectedPower;
  /** The power the Hit Chance Alert reads, for a row that does not pass `selectedPower`
   *  (a form's nested sub-power). */
  hitChancePower?: SelectedPower;
  /** Store category for this power — enables the slot-level move feature
   *  (addresses slots unambiguously). Falls back to by-name resolution when
   *  omitted. */
  powerCategory?: PowerCategory;
}

export function PowerRow({
  name,
  iconSrc,
  size = 'md',
  stackedLayout = false,
  level,
  showRemove = true,
  showAutoLabel = false,
  categoryBorder,
  muted = false,
  toggleSize,
  isActive = false,
  onToggle,
  slots,
  maxSlots,
  isLocked = false,
  onRemove,
  onAddSlots,
  onRemoveSlot,
  onRemoveAllSlots,
  onClearEnhancement,
  onClearAllEnhancements,
  onOpenPicker,
  onHover,
  onLeave,
  onEnhancementHover,
  onRightClick,
  onCompareSlotting,
  onInfoClick,
  slotLevels,
  selectedPower,
  hitChancePower,
  powerCategory,
}: PowerRowProps) {
  const isTouch = useIsTouchDevice();
  // On touch devices, suppress hover-triggered info panel — use the info button instead
  const hoverHandler = isTouch ? undefined : onHover;
  const leaveHandler = isTouch ? undefined : onLeave;
  // Bonus Cap Alert: powers contributing a Rule-of-5-rejected bonus get a
  // warning ring so users can see *which* powers to retune. Empty set when the
  // alert is disabled, so this is a no-op then.
  const offendingReasons = useOffendingPowerReasons();
  const cappedReasons = offendingReasons.get(name);
  const isOverCap = !!cappedReasons?.length;
  // Tooltip for the warning ring: name the exact capped bonus(es) — often a
  // hidden component bundled into a differently-named set bonus (e.g. a
  // resistance set silently carrying Mez Resistance) — and reassure that the
  // power's other set bonuses still count.
  const overCapTitle = cappedReasons?.length
    ? `Rule of 5 — over the cap and not counting:\n${cappedReasons
        .map((r) => `• ${r.label} ${r.display}`)
        .join('\n')}\nThis power's other set bonuses still apply. Swap one of the sets sharing this bonus to recover the wasted slot.`
    : undefined;
  const slotSize = SLOT_SIZE_MAP[size];
  const ghostSize = GHOST_SIZE_MAP[size];
  const iconClass = ICON_CLASS_MAP[size];
  const iconPixelSize = size === 'lg' ? 24 : 16;

  // --- Slot-level move (Mids-style "drag a slot's level to another power") ---
  // The source slot is armed via the context menu (stored in uiStore); the next
  // slot the user clicks becomes the swap target. Enhancers never move — only
  // the grant levels swap (see applySlotLevelMove).
  const internalName = selectedPower?.internalName;
  // Slots holding an enhancement the game wouldn't allow here (mis-routed by an
  // import or a permuted-internal-name powerset). Excluded from all totals by
  // the calc; flagged in the UI so the user can move or clear them.
  const invalidSlots = useMemo(
    () => (selectedPower ? new Set(powerIllegalSlotIndices(selectedPower)) : EMPTY_INVALID_SET),
    [selectedPower],
  );
  const slotMoveSource = useUIStore((s) => s.slotMoveSource);
  const beginSlotLevelMove = useUIStore((s) => s.beginSlotLevelMove);
  const cancelSlotLevelMove = useUIStore((s) => s.cancelSlotLevelMove);
  const moveSlotLevel = useBuildStore((s) => s.moveSlotLevel);
  const canMoveSlotLevel = useBuildStore((s) => s.canMoveSlotLevel);
  const build = useBuildStore((s) => s.build);
  const moveActive = !!slotMoveSource;

  const slotRef = (index: number): SlotLevelRef => ({
    powerName: internalName ?? name,
    slotIndex: index,
    category: powerCategory,
  });
  const isMoveSourceSlot = (index: number): boolean =>
    !!slotMoveSource &&
    slotMoveSource.powerName === (internalName ?? name) &&
    slotMoveSource.slotIndex === index;

  // --- Slot relocation (move a slot between powers) ---
  // Armed via the context menu; the next eligible POWER the user clicks
  // receives the slot (and its enhancement, when the destination allows it).
  // See moveSlot / canRelocateSlot. Mutually exclusive with slot-level move.
  const slotRelocateSource = useUIStore((s) => s.slotRelocateSource);
  const beginSlotRelocate = useUIStore((s) => s.beginSlotRelocate);
  const cancelSlotRelocate = useUIStore((s) => s.cancelSlotRelocate);
  const moveSlot = useBuildStore((s) => s.moveSlot);
  const canMoveSlot = useBuildStore((s) => s.canMoveSlot);
  const showToast = useUIStore((s) => s.showToast);
  const relocateActive = !!slotRelocateSource;

  const powerRef = (): PowerRef => ({ powerName: internalName ?? name, category: powerCategory });
  const isRelocateSourcePower = (): boolean =>
    !!slotRelocateSource && slotRelocateSource.powerName === (internalName ?? name);
  // Whether THIS power is a valid destination for the armed relocation.
  const isRelocateTarget = (): boolean =>
    relocateActive && !isRelocateSourcePower() && canMoveSlot(slotRelocateSource!, powerRef());

  // Combined per-slot highlight. The two move modes are mutually exclusive, so
  // at most one path is live. Relocation highlights whole powers: the source
  // slot pulses magenta; every slot of an eligible target glows green.
  const highlightFor = (index: number): 'source' | 'target' | null => {
    if (moveActive) {
      if (isMoveSourceSlot(index)) return 'source';
      return canMoveSlotLevel(slotMoveSource!, slotRef(index)) ? 'target' : null;
    }
    if (relocateActive) {
      if (isRelocateSourcePower()) return slotRelocateSource!.slotIndex === index ? 'source' : null;
      return isRelocateTarget() ? 'target' : null;
    }
    return null;
  };

  // Complete the armed relocation onto THIS power, or cancel when this power
  // isn't an eligible destination (source power / full power / wrong category).
  const completeRelocationHere = () => {
    if (isRelocateTarget()) {
      const result = moveSlot(slotRelocateSource!, powerRef());
      if (result.ok && result.enhancementDropped) {
        showToast({
          message: `Enhancement didn't fit ${name} — slot moved empty.`,
          tone: 'warning',
        });
      }
    }
    cancelSlotRelocate();
  };

  // While a relocation is armed, the ENTIRE row is one click target: capture
  // the click before any child (slot, toggle, +, name) can act on it.
  const handleRowClickCapture = (e: React.MouseEvent) => {
    if (!relocateActive) return;
    e.stopPropagation();
    completeRelocationHere();
  };

  const handleSlotClick = (index: number) => {
    // During a relocation the row-level capture handler owns the click; this
    // path only runs for normal (non-relocation) interactions.
    if (relocateActive) return;
    // Slot-level move: a click completes (valid target) or cancels (anything else).
    if (moveActive) {
      if (!isMoveSourceSlot(index)) {
        moveSlotLevel(slotMoveSource!, slotRef(index));
      }
      cancelSlotLevelMove();
      return;
    }
    onOpenPicker?.(index);
  };

  // Row-level relocation affordance: magenta ring on the source power, emerald
  // ring + pointer on eligible destinations, dimmed for ineligible powers.
  const rowRelocateClass = relocateActive
    ? isRelocateSourcePower()
      ? 'ring-1 ring-sk-magenta/70 cursor-pointer'
      : isRelocateTarget()
        ? 'ring-1 ring-emerald-400/70 cursor-pointer'
        : 'opacity-60'
    : '';

  // Remove multiple empty slots from the end (used by right-click drag on empty slots)
  const handleRemoveMultipleSlots = (count: number) => {
    if (!onRemoveSlot) return;
    let removed = 0;
    for (let i = slots.length - 1; i > 0 && removed < count; i--) {
      if (slots[i] === null) {
        onRemoveSlot(i);
        removed++;
      }
    }
  };

  // Clear multiple enhancements from the end (used by right-click drag on filled slots)
  const handleClearMultipleEnhancements = (count: number) => {
    if (!onClearEnhancement) return;
    let cleared = 0;
    for (let i = slots.length - 1; i >= 0 && cleared < count; i--) {
      if (slots[i] !== null) {
        onClearEnhancement(i);
        cleared++;
      }
    }
  };

  const removableSlotCount = slots.filter((s, i) => i > 0 && s === null).length;
  const filledSlotCount = slots.filter(s => s !== null).length;

  // Touch-only read-only inspection: expand a text list of slotted enhancements
  // so users can check what's slotted without tapping a slot (which opens the
  // editing picker). Desktop keeps hover-to-inspect, so this stays hidden there.
  const [showSlotting, setShowSlotting] = useState(false);

  // Track drag state for slot highlighting
  const [dragHighlight, setDragHighlight] = useState<{ mode: 'slots' | 'enhancements'; count: number } | null>(null);
  const handleDragStateChange = useCallback((state: { mode: 'slots' | 'enhancements'; count: number } | null) => {
    setDragHighlight(state);
  }, []);

  // Compute which slot indices are highlighted during drag
  const highlightedSlots = new Map<number, 'slot' | 'enhancement'>();
  if (dragHighlight) {
    let remaining = dragHighlight.count;
    for (let i = slots.length - 1; i >= 0 && remaining > 0; i--) {
      if (dragHighlight.mode === 'enhancements' && slots[i] !== null) {
        highlightedSlots.set(i, 'enhancement');
        remaining--;
      } else if (dragHighlight.mode === 'slots' && i > 0 && slots[i] === null) {
        highlightedSlots.set(i, 'slot');
        remaining--;
      }
    }
  }

  const renderIcon = (extraClass?: string) => {
    const img = (
      <img
        src={iconSrc}
        alt=""
        className={`${iconClass} rounded-sm${extraClass ? ` ${extraClass}` : ''}`}
        onError={(e) => {
          (e.target as HTMLImageElement).src = resolvePath('/img/Unknown.png');
        }}
      />
    );
    if (selectedPower) {
      return <PermaRing power={selectedPower} size={iconPixelSize}>{img}</PermaRing>;
    }
    return img;
  };

  const handleSlotMouseEnter = (index: number, hasEnhancement: boolean) => {
    if (isTouch) return;
    if (hasEnhancement) {
      onEnhancementHover?.(index);
    } else {
      onHover?.();
    }
  };

  // Outer container classes
  const bgClass = muted ? 'bg-slate-800/50' : 'bg-slate-800';
  const borderClass = isLocked
    ? `${categoryBorder ? 'border-l-4 border-l-amber-500' : ''} border-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.4)] bg-gradient-to-r from-amber-500/10 to-slate-800`
    : categoryBorder
      ? `${categoryBorder} border-slate-700 hover:border-slate-600`
      : 'border-slate-700 hover:border-slate-600';
  // Layered after borderClass so the warning ring wins regardless of locked /
  // category-tinted variants. ring-inset keeps it from interfering with the
  // existing border on adjacent rows.
  const overCapClass = isOverCap
    ? 'ring-2 ring-inset ring-[var(--color-warning)]'
    : '';

  // Indent spacer for inline layout row 2
  const getIndentWidth = () => {
    if (level !== undefined) return 'w-7';
    return 'w-5';
  };

  // Upper-right action buttons (info / compare slotting / remove).
  // Shared between the stacked and inline layouts so both Category and
  // Chronological views render identical controls.
  const ACTION_BTN =
    'w-6 h-6 flex items-center justify-center rounded text-slate-200 ' +
    'opacity-100 hover:bg-slate-700/60 transition-colors flex-shrink-0';
  const renderActions = () => (
    <div className="flex items-center gap-0.5 ml-1 flex-shrink-0">
      {isTouch && (
        <button
          onClick={() => setShowSlotting((v) => !v)}
          className={`w-6 h-6 flex items-center justify-center rounded-md border transition-colors flex-shrink-0 text-link ${
            showSlotting
              ? 'border-[var(--color-selected)] bg-[var(--color-selected)]/30'
              : 'border-[var(--color-selected)]/60 bg-[var(--color-selected)]/15 hover:bg-[var(--color-selected)]/25'
          }`}
          title={showSlotting ? 'Hide slotted enhancements' : 'Show slotted enhancements'}
          aria-expanded={showSlotting}
          aria-label="Show slotted enhancements"
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${showSlotting ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
      {onInfoClick && (
        <button
          onClick={onInfoClick}
          className={`${ACTION_BTN} hover:text-blue-400`}
          title="Power info"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
      {onCompareSlotting && (
        <button
          onClick={onCompareSlotting}
          className={`${ACTION_BTN} hover:text-sk-magenta`}
          title="Compare slotting"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
        </button>
      )}
      {showRemove && onRemove && (
        <button
          onClick={onRemove}
          className={`${ACTION_BTN} ring-1 ring-slate-600/70 hover:ring-red-400/70 hover:text-red-400`}
          title="Remove power"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );

  const renderNameRow = () => (
    <div className="flex items-center min-w-0">
      <span
        className="text-xs text-slate-200 truncate flex-1 min-w-0 cursor-default"
        onMouseEnter={hoverHandler}
        onContextMenu={onRightClick}
        title={isLocked ? 'Right-click to unlock power info' : 'Right-click to lock power info'}
      >
        {name}
      </span>
      {showAutoLabel && (
        <span className="text-[9px] text-slate-500 ml-1 flex-shrink-0">(Auto)</span>
      )}
      <HitChanceBadge power={selectedPower ?? hitChancePower} />
      <ProcPotentialBadge power={selectedPower} />
      {/* Toggle lives in the name row (stacked layout) rather than beside the
          slots: a 6-slot row + ghost already fills a narrow column, and letting
          the toggle share that row pushed the ghost — and the bottom-aligned
          icon — onto a third line. Up here it never competes with the slots. */}
      <span className="ml-1 flex-shrink-0 flex items-center">{renderToggle()}</span>
      {renderActions()}
    </div>
  );

  const renderSlots = () => (
    <div className="flex gap-0.5 items-center flex-1 flex-wrap">
      {slots.map((slot, index) => (
        <TouchableSlot
          key={index}
          slot={slot}
          index={index}
          canRemoveSlot={index > 0}
          size={slotSize}
          slotLevel={slotLevels?.[index]}
          onClick={() => handleSlotClick(index)}
          onMouseEnter={() => handleSlotMouseEnter(index, !!slot)}
          onClearEnhancement={() => onClearEnhancement?.(index)}
          onRemoveSlot={() => onRemoveSlot?.(index)}
          onClearAllEnhancements={() => onClearAllEnhancements?.()}
          onRemoveAllSlots={() => onRemoveAllSlots?.()}
          onCompareSlotting={onCompareSlotting}
          onRemoveSlots={onRemoveSlot ? handleRemoveMultipleSlots : undefined}
          onClearEnhancements={onClearEnhancement ? handleClearMultipleEnhancements : undefined}
          removableSlotCount={removableSlotCount}
          filledSlotCount={filledSlotCount}
          onDragStateChange={handleDragStateChange}
          highlightRemoval={highlightedSlots.get(index) ?? null}
          invalid={!!slot && invalidSlots.has(index)}
          moveHighlight={highlightFor(index)}
          onMoveSlotLevel={
            internalName && !moveActive && !relocateActive && isMovableSlot(build, slotRef(index))
              ? () => beginSlotLevelMove(slotRef(index))
              : undefined
          }
          onMoveSlotToPower={
            internalName && !moveActive && !relocateActive && isMovableSlot(build, slotRef(index))
              ? () => beginSlotRelocate(slotRef(index))
              : undefined
          }
        />
      ))}
      {onAddSlots && (
        <DraggableSlotGhost
          powerName={name}
          currentSlots={slots.length}
          maxSlots={maxSlots}
          onAddSlots={onAddSlots}
          onRemoveSlots={onRemoveSlot ? handleRemoveMultipleSlots : undefined}
          size={ghostSize}
        />
      )}
    </div>
  );

  const renderToggle = () => {
    if (!toggleSize || !onToggle) return null;
    const config = TOGGLE_CONFIG[toggleSize];
    return (
      <Tooltip
        content={
          isActive
            ? 'Power ON - stats included in calculations'
            : 'Power OFF - click to include in stats'
        }
      >
        <button
          onClick={onToggle}
          className={`
            flex-shrink-0 relative ${config.outer} rounded-full transition-colors duration-200
            ${isActive ? 'bg-green-600' : 'bg-slate-600'}
          `}
        >
          <span
            className={`
              absolute ${config.offset} ${config.knob} rounded-full bg-white shadow-sm
              transition-transform duration-200
              ${isActive ? config.translate : 'translate-x-0'}
            `}
          />
        </button>
      </Tooltip>
    );
  };

  if (stackedLayout) {
    // Stacked layout: Level+Icon left column, Name+Slots right column
    return (
      <div
        className={`flex flex-col px-1.5 py-1 ${bgClass} border rounded-sm group transition-colors ${borderClass} ${overCapClass} ${rowRelocateClass}`}
        title={overCapTitle}
        onClickCapture={handleRowClickCapture}
        onMouseEnter={hoverHandler}
        onMouseLeave={leaveHandler}
        data-info-hover="power"
        {...(toggleSize && onToggle ? { 'data-onboarding': 'power-toggle' } : {})}
      >
        <div className="flex min-w-0">
          {/* Left column: Level on top, icon underneath */}
          <div className={`flex flex-col items-center flex-shrink-0 mr-1 ${level !== undefined ? 'justify-between' : 'justify-center'}`}>
            {level !== undefined && (
              <span className="text-[10px] font-semibold text-slate-400 leading-tight">L{level}</span>
            )}
            {renderIcon(level !== undefined ? 'mt-0.5' : undefined)}
          </div>

          {/* Right column: Name+toggle (row 1) + Slots (row 2). The toggle is in
              the name row (see renderNameRow) so the slot row gets the full width
              and the 6-slot + ghost run never wraps onto a third line. */}
          <div className="flex flex-col flex-1 min-w-0">
            {renderNameRow()}
            <div className="flex items-center mt-0.5">
              {renderSlots()}
            </div>
          </div>
        </div>
        {isTouch && showSlotting && (
          <>
            <SlottedEnhancementList slots={slots} invalidSlots={invalidSlots} onSelectSlot={handleSlotClick} />
            <SlottedSetBonuses slots={slots} />
          </>
        )}
      </div>
    );
  }

  // Inline layout: Row 1 = Level Icon Name X, Row 2 = indent Slots Toggle
  return (
    <div
      className={`flex flex-col px-1.5 py-1 ${bgClass} border rounded-sm group transition-colors ${borderClass} ${overCapClass} ${rowRelocateClass}`}
      title={overCapTitle}
      onClickCapture={handleRowClickCapture}
      onMouseEnter={hoverHandler}
      onMouseLeave={leaveHandler}
      data-info-hover="power"
      {...(toggleSize && onToggle ? { 'data-onboarding': 'power-toggle' } : {})}
    >
      {/* Row 1: Level · Icon · Name | Auto | X */}
      <div className="flex items-center min-w-0">
        {level !== undefined && (
          <span className="text-[10px] font-semibold text-slate-400 w-5 text-right flex-shrink-0 mr-1">L{level}</span>
        )}
        <span className="flex-shrink-0 mr-1">
          {renderIcon()}
        </span>
        <span
          className="text-xs text-slate-200 truncate flex-1 min-w-0 cursor-default"
          onMouseEnter={hoverHandler}
          onContextMenu={onRightClick}
          title={isLocked ? 'Right-click to unlock power info' : 'Right-click to lock power info'}
        >
          {name}
        </span>
        {showAutoLabel && (
          <span className="text-[9px] text-slate-400 ml-1 flex-shrink-0">(Auto)</span>
        )}
        <HitChanceBadge power={selectedPower ?? hitChancePower} />
        {renderActions()}
      </div>

      {/* Row 2: Indent + Slots + Toggle */}
      <div className="flex items-center mt-0.5">
        <div className={`${getIndentWidth()} flex-shrink-0`} />
        {renderSlots()}
        {renderToggle()}
      </div>

      {isTouch && showSlotting && (
        <SlottedEnhancementList slots={slots} invalidSlots={invalidSlots} onSelectSlot={handleSlotClick} />
      )}
    </div>
  );
}
