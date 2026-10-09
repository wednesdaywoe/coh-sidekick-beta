/**
 * ChronologicalPowerSlot - Individual slot in the chronological power view
 *
 * Shows either a power with enhancements or an empty slot placeholder.
 * Includes category color coding, all standard interactions, and
 * drag-and-drop support for reordering powers.
 */

import { useBuildStore, useUIStore } from '@/stores';
import { useShowSlotLevels } from '@/stores/uiStore';
import type { PowerCategory as StorePowerCategory } from '@/stores';
import { getPowerIconPath, getGrantedPowerGroup } from '@/data';
import { useSlotLevels } from '@/hooks';
import { powerKey } from '@/utils/power-key';
import { PowerRow } from './PowerRow';
import { shouldShowToggle } from './power-row-utils';
import { GrantedSubPowers } from './SelectedPowers';
import type { CategorizedPower, PowerCategory, DragState } from './ChronologicalPowerView';

// Category colors for left border
const CATEGORY_COLORS: Record<PowerCategory, string> = {
  primary: 'border-l-4 border-l-yellow-500',
  secondary: 'border-l-4 border-l-blue-500',
  pool: 'border-l-4 border-l-green-500',
  epic: 'border-l-4 border-l-purple-500',
};

/**
 * Map chronological category to store category for removal
 */
function mapCategoryToStoreCategory(category: PowerCategory): StorePowerCategory {
  switch (category) {
    case 'primary':
      return 'primary';
    case 'secondary':
      return 'secondary';
    case 'pool':
      return 'pool';
    case 'epic':
      return 'epic';
    default:
      return 'pool';
  }
}

interface ChronologicalPowerSlotProps {
  level: number;
  power: CategorizedPower | null;
  slotKey: string;
  isPrimarySlot?: boolean;
  isSecondarySlot?: boolean;
  dragState: DragState | null;
  onPowerDragStart?: (power: CategorizedPower) => void;
  onPowerDragEnd?: () => void;
}

export function ChronologicalPowerSlot({
  level,
  power,
  slotKey,
  isPrimarySlot,
  isSecondarySlot,
  dragState,
  onPowerDragStart,
  onPowerDragEnd,
}: ChronologicalPowerSlotProps) {
  const removePower = useBuildStore((s) => s.removePower);
  const addSlot = useBuildStore((s) => s.addSlot);
  const removeSlot = useBuildStore((s) => s.removeSlot);
  const clearEnhancement = useBuildStore((s) => s.clearEnhancement);
  const togglePowerActive = useBuildStore((s) => s.togglePowerActive);
  const setActiveSubPower = useBuildStore((s) => s.setActiveSubPower);
  const movePowerLevel = useBuildStore((s) => s.movePowerLevel);
  const swapPowerLevels = useBuildStore((s) => s.swapPowerLevels);
  const setInfoPanelContent = useUIStore((s) => s.setInfoPanelContent);
  const lockInfoPanel = useUIStore((s) => s.lockInfoPanel);
  const unlockInfoPanel = useUIStore((s) => s.unlockInfoPanel);
  const infoPanelLocked = useUIStore((s) => s.infoPanel.locked);
  const lockedContent = useUIStore((s) => s.infoPanel.lockedContent);
  const openEnhancementPicker = useUIStore((s) => s.openEnhancementPicker);
  const openCompareSlotting = useUIStore((s) => s.openCompareSlotting);
  const showSlotLevels = useShowSlotLevels();
  const slotLevelsMap = useSlotLevels();

  const iconSrc = power ? getPowerIconPath(power.icon) : '';

  // Drag state for this slot
  const isDragging = dragState && power && dragState.draggedPower.internalName === power.internalName;
  const isValidTarget = dragState && !isDragging && dragState.validTargets.has(slotKey);
  const isInvalidTarget = dragState && !isDragging && !dragState.validTargets.has(slotKey);

  const handleDragOver = (e: React.DragEvent) => {
    if (isValidTarget) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isValidTarget || !dragState) return;

    if (power) {
      // Swap with occupied slot. Both categories are passed: internalName is not
      // unique across categories, so resolving either end by bare name can swap
      // the wrong power's level.
      // NB derive the target's category from `power` here rather than reading the
      // `storeCategory` const below: that binding is declared after this
      // component's `if (!power)` early return, so a closure reading it on the
      // empty-slot path would throw.
      swapPowerLevels(
        dragState.draggedPower.internalName,
        mapCategoryToStoreCategory(dragState.draggedPower.category),
        power.internalName,
        mapCategoryToStoreCategory(power.category),
      );
    } else {
      // Move to empty slot
      movePowerLevel(
        mapCategoryToStoreCategory(dragState.draggedPower.category),
        dragState.draggedPower.internalName,
        level,
      );
    }
    onPowerDragEnd?.();
  };

  if (!power) {
    // Render empty slot placeholder - structured like PowerRow stacked layout for matching height
    return (
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`flex flex-col px-1.5 py-1 bg-slate-800/50 border rounded-sm transition-colors ${
          isValidTarget
            ? 'border-[var(--color-selected)] border-dashed bg-[var(--color-selected)]/10'
            : 'border-dashed border-slate-700'
        }`}
      >
        <div className="flex min-w-0">
          {/* Left column: Level + empty icon space (matches PowerRow stacked layout) */}
          <div className="flex flex-col items-center flex-shrink-0 mr-1 justify-between">
            <span className="text-[10px] font-semibold text-slate-400 leading-tight">L{level}</span>
            <div className="w-6 h-6 mt-0.5" />
          </div>
          {/* Right column: Label + spacer (matches name row + slots row) */}
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-xs text-slate-400 italic">
              {isPrimarySlot
                ? 'Primary power'
                : isSecondarySlot
                ? 'Secondary power'
                : 'Empty slot'}
            </span>
            <div className="h-6 mt-0.5" />
          </div>
        </div>
      </div>
    );
  }

  const isInfoLocked =
    infoPanelLocked &&
    lockedContent?.type === 'power' &&
    lockedContent.powerName === power.internalName;

  const storeCategory = mapCategoryToStoreCategory(power.category);

  const handleRemove = () => {
    removePower(storeCategory, power.internalName);
  };

  const handleAddSlots = (count: number) => {
    for (let i = 0; i < count; i++) {
      addSlot(power.internalName, storeCategory);
    }
  };

  const handleClearAllEnhancements = () => {
    for (let i = 0; i < power.slots.length; i++) {
      clearEnhancement(power.internalName, i, storeCategory);
    }
  };

  const handleRemoveAllSlots = () => {
    for (let i = power.slots.length - 1; i > 0; i--) {
      removeSlot(power.internalName, i, storeCategory);
    }
  };

  const handlePowerHover = () => {
    if (power.powerSet) {
      setInfoPanelContent({
        type: 'power',
        powerName: power.internalName,
        powerSet: power.powerSet,
      });
    }
  };

  const handlePowerLeave = () => {
    // Don't clear — keep showing the last-hovered power until a new one is hovered
  };

  const handleEnhancementHover = (index: number) => {
    setInfoPanelContent({
      type: 'slotted-enhancement',
      powerName: power.internalName,
      powerSet: power.powerSet,
      slotIndex: index,
    });
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!power.powerSet) return;

    if (
      infoPanelLocked &&
      lockedContent?.type === 'power' &&
      lockedContent.powerName === power.internalName
    ) {
      unlockInfoPanel();
    } else {
      lockInfoPanel({
        type: 'power',
        powerName: power.internalName,
        powerSet: power.powerSet,
      });
    }
  };

  const canDrag = !power.isLocked && !power.isAutoGranted;

  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) return;
        e.dataTransfer.setData('text/plain', power.name);
        e.dataTransfer.effectAllowed = 'move';
        // Use setTimeout so the drag image captures the element before we apply opacity
        setTimeout(() => onPowerDragStart?.(power), 0);
      }}
      onDragEnd={() => onPowerDragEnd?.()}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`transition-opacity ${
        isDragging ? 'opacity-40' : ''
      } ${
        isValidTarget ? 'ring-2 ring-[var(--color-primary)] ring-inset rounded-sm' : ''
      } ${
        isInvalidTarget ? 'opacity-30' : ''
      }`}
    >
      <PowerRow
        name={power.name}
        iconSrc={iconSrc}
        size="lg"
        stackedLayout
        selectedPower={power}
        powerCategory={storeCategory}
        level={level}
        isLocked={isInfoLocked}
        categoryBorder={CATEGORY_COLORS[power.category]}
        toggleSize={shouldShowToggle(power) ? 'md' : undefined}
        isActive={power.isActive ?? false}
        onToggle={() => togglePowerActive(power.internalName, storeCategory)}
        slots={power.slots}
        maxSlots={power.maxSlots}
        onRemove={handleRemove}
        onAddSlots={handleAddSlots}
        onRemoveSlot={(index) => removeSlot(power.internalName, index, storeCategory)}
        onRemoveAllSlots={handleRemoveAllSlots}
        onClearEnhancement={(index) => clearEnhancement(power.internalName, index, storeCategory)}
        onClearAllEnhancements={handleClearAllEnhancements}
        onOpenPicker={(slotIndex) => openEnhancementPicker(power.internalName, power.powerSet, slotIndex, undefined, undefined, storeCategory)}
        onHover={handlePowerHover}
        onLeave={handlePowerLeave}
        onEnhancementHover={handleEnhancementHover}
        onRightClick={handleRightClick}
        onCompareSlotting={() => openCompareSlotting(power.internalName, power.powerSet)}
        slotLevels={showSlotLevels ? slotLevelsMap.get(powerKey(power.category, power.internalName)) : undefined}
        onInfoClick={() => {
          if (power.powerSet) {
            if (isInfoLocked) {
              unlockInfoPanel();
            } else {
              lockInfoPanel({
                type: 'power',
                powerName: power.internalName,
                powerSet: power.powerSet,
              });
            }
          }
        }}
      />

      {/* Slottable form sub-powers (e.g. Kheldian Nova/Dwarf attacks). These are
          auto-granted and don't occupy their own slot, so they render nested
          under the parent toggle — mirroring the "By Powerset" layout. */}
      {power.slottableSubPowers && power.slottableSubPowers.length > 0 && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l-2 border-slate-700/50 pl-1">
          {power.slottableSubPowers.map((subPower) => {
            const subIsLocked =
              infoPanelLocked &&
              lockedContent?.type === 'power' &&
              lockedContent.powerName === subPower.internalName;

            return (
              <PowerRow
                key={subPower.name}
                hitChancePower={subPower}
                name={subPower.name}
                iconSrc={getPowerIconPath(subPower.icon)}
                size="lg"
                stackedLayout
                isLocked={subIsLocked}
                showRemove={false}
                showAutoLabel
                slots={subPower.slots}
                maxSlots={subPower.maxSlots}
                onAddSlots={(count) => {
                  for (let i = 0; i < count; i++) addSlot(subPower.internalName, storeCategory);
                }}
                onRemoveSlot={(index) => removeSlot(subPower.internalName, index, storeCategory)}
                onRemoveAllSlots={() => {
                  for (let i = subPower.slots.length - 1; i > 0; i--) removeSlot(subPower.internalName, i, storeCategory);
                }}
                onClearEnhancement={(index) => clearEnhancement(subPower.internalName, index, storeCategory)}
                onClearAllEnhancements={() => {
                  for (let i = 0; i < subPower.slots.length; i++) clearEnhancement(subPower.internalName, i, storeCategory);
                }}
                onOpenPicker={(slotIndex) => openEnhancementPicker(subPower.internalName, subPower.powerSet || power.powerSet, slotIndex, undefined, undefined, storeCategory)}
                onHover={() => {
                  const ps = subPower.powerSet || power.powerSet;
                  if (ps) setInfoPanelContent({ type: 'power', powerName: subPower.internalName, powerSet: ps });
                }}
                onLeave={handlePowerLeave}
                onEnhancementHover={(index) => setInfoPanelContent({ type: 'slotted-enhancement', powerName: subPower.internalName, powerSet: subPower.powerSet || power.powerSet, slotIndex: index })}
                onRightClick={(e) => {
                  e.preventDefault();
                  const ps = subPower.powerSet || power.powerSet;
                  if (!ps) return;
                  if (infoPanelLocked && lockedContent?.type === 'power' && lockedContent.powerName === subPower.internalName) {
                    unlockInfoPanel();
                  } else {
                    lockInfoPanel({ type: 'power', powerName: subPower.internalName, powerSet: ps });
                  }
                }}
                onCompareSlotting={() => openCompareSlotting(subPower.internalName, subPower.powerSet || power.powerSet)}
                onInfoClick={() => {
                  const ps = subPower.powerSet || power.powerSet;
                  if (!ps) return;
                  if (subIsLocked) {
                    unlockInfoPanel();
                  } else {
                    lockInfoPanel({ type: 'power', powerName: subPower.internalName, powerSet: ps });
                  }
                }}
                slotLevels={showSlotLevels ? slotLevelsMap.get(powerKey(power.category, subPower.internalName)) : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Non-slottable granted stance chips (Bio Armor Adaptation's Defensive/
          Offensive/Efficient). Auto-granted and don't occupy a slot, so they
          render as selectable chips under the parent — mirroring the "By
          Powerset" layout so the active stance is switchable here too. */}
      {power.stanceSubPowers && power.stanceSubPowers.length > 0 && (
        <GrantedSubPowers
          subPowers={power.stanceSubPowers}
          parentPower={power}
          powersetName={power.powerSet}
          isMutuallyExclusive={getGrantedPowerGroup(power.internalName)?.mutuallyExclusive ?? false}
          activeSubPower={power.activeSubPower}
          onSetActive={(subPowerName) => setActiveSubPower(power.internalName, subPowerName)}
        />
      )}
    </div>
  );
}

export default ChronologicalPowerSlot;
