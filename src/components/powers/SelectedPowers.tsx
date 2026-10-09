/**
 * SelectedPowers component - shows powers that have been selected
 * Renders inline within a column (column headers are in PlannerPage)
 */

import { useState } from 'react';
import { useBuildStore, useUIStore } from '@/stores';
import { useShowSlotLevels } from '@/stores/uiStore';
import type { PowerCategory } from '@/stores';
import type { SelectedPower, Power } from '@/types';
import { getPowerIconPath, getPowerset, hasGrantedPowers, getGrantedPowerGroup, GRANTED_POWER_GROUPS } from '@/data';
import { resolvePath } from '@/utils/paths';
import { Tooltip } from '@/components/ui';
import { useSlotLevels } from '@/hooks';
import { powerKey } from '@/utils/power-key';
import { PowerRow } from './PowerRow';
import { shouldShowToggle } from './power-row-utils';

interface SelectedPowersProps {
  category: 'primary' | 'secondary';
}

export function SelectedPowers({ category }: SelectedPowersProps) {
  const [collapsed, setCollapsed] = useState(false);
  const build = useBuildStore((s) => s.build);
  const removePower = useBuildStore((s) => s.removePower);
  const addSlot = useBuildStore((s) => s.addSlot);
  const removeSlot = useBuildStore((s) => s.removeSlot);
  const clearEnhancement = useBuildStore((s) => s.clearEnhancement);
  const togglePowerActive = useBuildStore((s) => s.togglePowerActive);
  const setActiveSubPower = useBuildStore((s) => s.setActiveSubPower);
  const setInfoPanelContent = useUIStore((s) => s.setInfoPanelContent);
  const lockInfoPanel = useUIStore((s) => s.lockInfoPanel);
  const unlockInfoPanel = useUIStore((s) => s.unlockInfoPanel);
  const infoPanelLocked = useUIStore((s) => s.infoPanel.locked);
  const lockedContent = useUIStore((s) => s.infoPanel.lockedContent);
  const openEnhancementPicker = useUIStore((s) => s.openEnhancementPicker);
  const openCompareSlotting = useUIStore((s) => s.openCompareSlotting);
  const showSlotLevels = useShowSlotLevels();
  const slotLevelsMap = useSlotLevels();

  const selection = category === 'primary' ? build.primary : build.secondary;
  const powersetId = selection.id || '';

  // Sort powers by their position in the powerset (available level)
  // Exclude auto-granted sub-powers from the main list (they render under their parent)
  const powers = [...selection.powers]
    .filter(p => !p.isAutoGranted)
    .sort((a, b) => a.available - b.available);

  const handleRemove = (powerName: string) => {
    removePower(category as PowerCategory, powerName);
  };

  const handleAddSlots = (powerName: string, count: number) => {
    for (let i = 0; i < count; i++) {
      addSlot(powerName, category);
    }
  };

  const handleRemoveSlot = (powerName: string, slotIndex: number) => {
    removeSlot(powerName, slotIndex, category);
  };

  const handleRemoveAllSlots = (powerName: string, totalSlots: number) => {
    for (let i = totalSlots - 1; i > 0; i--) {
      removeSlot(powerName, i, category);
    }
  };

  const handlePowerHover = (power: SelectedPower) => {
    const powerPowerSet = power.powerSet || powersetId;
    if (powerPowerSet) {
      setInfoPanelContent({
        type: 'power',
        powerName: power.internalName,
        powerSet: powerPowerSet,
      });
    }
  };

  const handlePowerLeave = () => {
    // Don't clear — keep showing the last-hovered power until a new one is hovered
  };

  const handleEnhancementHover = (powerName: string, slotIndex: number) => {
    setInfoPanelContent({
      type: 'slotted-enhancement',
      powerName,
      // Mirrors handlePowerHover: prefer the power's own set, fall back to this
      // section's. Required so a name reused in another powerset can't resolve
      // to the wrong power's enhancement.
      powerSet: powers.find((p) => p.internalName === powerName)?.powerSet || powersetId || '',
      slotIndex,
    });
  };

  const handleClearEnhancement = (powerName: string, slotIndex: number) => {
    clearEnhancement(powerName, slotIndex, category);
  };

  const handleClearAllEnhancements = (powerName: string, totalSlots: number) => {
    for (let i = 0; i < totalSlots; i++) {
      clearEnhancement(powerName, i, category);
    }
  };

  const handlePowerRightClick = (e: React.MouseEvent, power: SelectedPower) => {
    e.preventDefault();
    const powerPowerSet = power.powerSet || powersetId;
    if (!powerPowerSet) return;

    if (infoPanelLocked && lockedContent?.type === 'power' && lockedContent.powerName === power.internalName) {
      unlockInfoPanel();
    } else {
      lockInfoPanel({
        type: 'power',
        powerName: power.internalName,
        powerSet: powerPowerSet,
      });
    }
  };

  if (powers.length === 0) {
    return (
      <div className="text-xs text-slate-400 italic py-4 text-center">
        {selection.name ? 'Select powers from the available list' : 'Select a powerset first'}
      </div>
    );
  }

  const getSubPowers = (parentPowerName: string): Power[] =>
    getGrantedStanceSubPowers(parentPowerName, powersetId);

  /** Get slottable sub-powers from the build (form sub-powers like Bright Nova Bolt) */
  const getSlottableSubPowers = (parentPowerName: string): SelectedPower[] => {
    const group = GRANTED_POWER_GROUPS[parentPowerName];
    if (!group?.slottable) return [];
    return selection.powers.filter(p =>
      p.isAutoGranted && p.grantedByPower === parentPowerName
    );
  };

  return (
    <div>
      {/* Collapsible header */}
      <div
        className="flex items-center gap-1 mb-1.5 cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={`text-[10px] text-slate-500 transition-transform ${collapsed ? '' : 'rotate-90'}`}>
          ▶
        </span>
        <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
          {selection.name || (category === 'primary' ? 'Primary' : 'Secondary')}
        </h4>
        <span className="text-[9px] text-slate-600">({powers.length})</span>
      </div>

      {/* Collapsible power list */}
      {!collapsed && (
        <div className="space-y-0.5">
          {powers.map((power) => {
            const isLocked = infoPanelLocked &&
              lockedContent?.type === 'power' &&
              lockedContent.powerName === power.internalName;

            const subPowers = getSubPowers(power.internalName);
            const grantedGroup = getGrantedPowerGroup(power.internalName);
            const slottableSubPowers = getSlottableSubPowers(power.internalName);

            return (
              <div key={power.name}>
                <PowerRow
                  name={power.name}
                  iconSrc={getPowerIconPath(power.icon)}
                  size="lg"
                  stackedLayout
                  level={power.level}
                  isLocked={isLocked}
                  selectedPower={power}
                  powerCategory={category}
                  toggleSize={shouldShowToggle(power) ? 'md' : undefined}
                  isActive={power.isActive ?? false}
                  onToggle={() => togglePowerActive(power.internalName, category)}
                  slots={power.slots}
                  maxSlots={power.maxSlots}
                  onRemove={() => handleRemove(power.internalName)}
                  onAddSlots={(count) => handleAddSlots(power.internalName, count)}
                  onRemoveSlot={(index) => handleRemoveSlot(power.internalName, index)}
                  onRemoveAllSlots={() => handleRemoveAllSlots(power.internalName, power.slots.length)}
                  onClearEnhancement={(index) => handleClearEnhancement(power.internalName, index)}
                  onClearAllEnhancements={() => handleClearAllEnhancements(power.internalName, power.slots.length)}
                  onOpenPicker={(slotIndex) => openEnhancementPicker(power.internalName, power.powerSet || powersetId, slotIndex, undefined, undefined, category)}
                  onHover={() => handlePowerHover(power)}
                  onLeave={handlePowerLeave}
                  onEnhancementHover={(index) => handleEnhancementHover(power.internalName, index)}
                  onRightClick={(e) => handlePowerRightClick(e, power)}
                  onCompareSlotting={() => openCompareSlotting(power.internalName, power.powerSet || powersetId)}
                  onInfoClick={() => {
                    const ps = power.powerSet || powersetId;
                    if (ps) {
                      if (isLocked) {
                        unlockInfoPanel();
                      } else {
                        lockInfoPanel({ type: 'power', powerName: power.internalName, powerSet: ps });
                      }
                    }
                  }}
                  slotLevels={showSlotLevels ? slotLevelsMap.get(powerKey(category, power.internalName)) : undefined}
                />

                {/* Granted sub-powers display (simple toggles) */}
                {subPowers.length > 0 && (
                  <GrantedSubPowers
                    subPowers={subPowers}
                    parentPower={power}
                    powersetName={selection.name}
                    isMutuallyExclusive={grantedGroup?.mutuallyExclusive ?? false}
                    activeSubPower={power.activeSubPower}
                    onSetActive={(subPowerName) => setActiveSubPower(power.internalName, subPowerName)}
                  />
                )}

                {/* Slottable form sub-powers (full PowerRow with slots) */}
                {slottableSubPowers.length > 0 && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l-2 border-slate-700/50 pl-1">
                    {slottableSubPowers.map((subPower) => {
                      const subIsLocked = infoPanelLocked &&
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
                          onAddSlots={(count) => handleAddSlots(subPower.internalName, count)}
                          onRemoveSlot={(index) => handleRemoveSlot(subPower.internalName, index)}
                          onRemoveAllSlots={() => handleRemoveAllSlots(subPower.internalName, subPower.slots.length)}
                          onClearEnhancement={(index) => handleClearEnhancement(subPower.internalName, index)}
                          onClearAllEnhancements={() => handleClearAllEnhancements(subPower.internalName, subPower.slots.length)}
                          onOpenPicker={(slotIndex) => openEnhancementPicker(subPower.internalName, subPower.powerSet || powersetId, slotIndex, undefined, undefined, category)}
                          onHover={() => handlePowerHover(subPower)}
                          onLeave={handlePowerLeave}
                          onEnhancementHover={(index) => handleEnhancementHover(subPower.internalName, index)}
                          onRightClick={(e) => handlePowerRightClick(e, subPower)}
                          onCompareSlotting={() => openCompareSlotting(subPower.internalName, subPower.powerSet || powersetId)}
                          onInfoClick={() => {
                            const ps = subPower.powerSet || powersetId;
                            if (ps) {
                              if (subIsLocked) {
                                unlockInfoPanel();
                              } else {
                                lockInfoPanel({ type: 'power', powerName: subPower.internalName, powerSet: ps });
                              }
                            }
                          }}
                          slotLevels={showSlotLevels ? slotLevelsMap.get(powerKey(category, subPower.internalName)) : undefined}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// GRANTED SUB-POWERS COMPONENT
// ============================================

/**
 * The non-slottable granted sub-powers (stance chips like Bio Armor's
 * Defensive/Offensive/Efficient Adaptation) that belong to `parentPowerName`
 * within `powersetId`. Slottable granted groups (Kheldian forms) are rendered
 * differently and excluded here. Shared by both the "By Powerset" list
 * (SelectedPowers) and the "By Level" grid (ChronologicalPowerSlot).
 */
export function getGrantedStanceSubPowers(parentPowerName: string, powersetId: string): Power[] {
  if (!hasGrantedPowers(parentPowerName)) return [];
  const group = getGrantedPowerGroup(parentPowerName);
  if (!group || group.slottable) return [];
  const powerset = getPowerset(powersetId);
  if (!powerset) return [];
  return powerset.powers.filter(p =>
    group.grantedPowers.includes(p.internalName) &&
    // A stance only belongs to THIS parent if it actually requires it. Bio
    // Armor's form-switcher is internally "Evolution" on Scrapper/Brute/Tanker
    // (which also have a separate internal-"Adaptation" +Res toggle) but
    // "Adaptation" on Stalker/Sentinel — the requires check keeps the stance
    // chips on the real switcher in every archetype. Powers without a
    // `requires` (e.g. Boomerang Slice) keep their existing behavior.
    (!p.requires?.length || p.requires[p.requires.length - 1].endsWith(`.${parentPowerName}`))
  );
}

interface GrantedSubPowersProps {
  subPowers: Power[];
  parentPower: SelectedPower;
  powersetName: string;
  isMutuallyExclusive: boolean;
  activeSubPower?: string;
  onSetActive: (subPowerName: string | null) => void;
}

/**
 * Displays granted sub-powers below a parent power
 * For mutually exclusive powers (like Adaptation stances), shows radio-style selection
 */
export function GrantedSubPowers({
  subPowers,
  powersetName: _powersetName,
  isMutuallyExclusive,
  activeSubPower,
  onSetActive,
}: GrantedSubPowersProps) {
  return (
    <div className="ml-6 mt-0.5 space-y-0.5">
      {subPowers.map((subPower) => {
        const isActive = activeSubPower === subPower.internalName;

        return (
          <div
            key={subPower.internalName}
            className={`
              flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm
              border transition-colors
              ${isActive
                ? 'bg-slate-700/50 border-green-600/50'
                : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'
              }
            `}
          >
            {/* Sub-power icon and name */}
            <img
              src={getPowerIconPath(subPower.icon)}
              alt=""
              className="w-4 h-4 rounded-sm flex-shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).src = resolvePath('/img/Unknown.png');
              }}
            />
            <span className={`text-xs truncate flex-1 ${isActive ? 'text-green-300' : 'text-slate-400'}`}>
              {subPower.name}
            </span>

            {/* Toggle/Radio button for sub-power */}
            {isMutuallyExclusive ? (
              <Tooltip
                content={
                  isActive
                    ? `${subPower.name} is active`
                    : `Activate ${subPower.name}`
                }
              >
                <button
                  onClick={() => onSetActive(isActive ? null : subPower.internalName)}
                  className={`
                    w-4 h-4 rounded-full border-2 flex items-center justify-center
                    transition-colors
                    ${isActive
                      ? 'border-green-500 bg-green-500'
                      : 'border-slate-500 hover:border-green-400'
                    }
                  `}
                >
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </button>
              </Tooltip>
            ) : (
              <Tooltip
                content={
                  isActive
                    ? `${subPower.name} ON`
                    : `${subPower.name} OFF`
                }
              >
                <button
                  onClick={() => onSetActive(isActive ? null : subPower.internalName)}
                  className={`
                    relative w-6 h-3 rounded-full transition-colors duration-200
                    ${isActive ? 'bg-green-600' : 'bg-slate-600'}
                  `}
                >
                  <span
                    className={`
                      absolute top-[2px] left-[2px] w-2 h-2 rounded-full bg-white shadow-sm
                      transition-transform duration-200
                      ${isActive ? 'translate-x-3' : 'translate-x-0'}
                    `}
                  />
                </button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
