/**
 * Hit Chance Alert — a badge on every picked power that rolls to hit foes and lands under
 * the 95% cap against the chosen target (header Target level + incarnate shift setting).
 *
 * The chance is the engine's own per-power read (`PowerProjection.hitChance`): base ToHit
 * for the level gap, plus the build's ToHit buffs, times this power's final accuracy.
 */

import { Tooltip } from '@/components/ui';
import { lookupPower } from '@/data';
import { usePowerProjection } from '@/hooks/useCalculatedStats';
import { useUIStore } from '@/stores';
import type { Power, SelectedPower } from '@/types';

/** The game's hit-chance ceiling. */
const HIT_CAP = 0.95;

/**
 * Whether this power rolls to hit a foe. A power carries an accuracy whether or not it ever
 * rolls — self toggles and auto-hit debuff patches do too — so accuracy alone says nothing.
 * The export's EntsAffected / EntsAutoHit pair does: a foe it can affect but does not
 * auto-hit is a foe it rolls against. An absent EntsAutoHit is unknown, not "rolls".
 */
function targetsRoll({ targetsAffected: affected, targetsAutoHit: autoHit }: Pick<Power, 'targetsAffected' | 'targetsAutoHit'>): boolean {
  if (!affected || !autoHit) return false;
  if (autoHit.includes('Any')) return false;
  return affected.some((t) => (t === 'Foe' || t === 'Any') && !autoHit.includes('Foe'));
}

/**
 * ...or whether a child it executes with the caster's slotting does: Spring Attack's own
 * power only teleports the caster, and the attack that rolls is its child. The child's roll
 * uses the parent's slotting, and in today's data the child's base accuracy matches the
 * parent's (Fault's second child is the one exception, at 1.0 over 0.8, so it lands more often
 * than the badge says).
 */
export function rollsToHitFoes(
  power: Pick<Power, 'targetsAffected' | 'targetsAutoHit' | 'procRollSites'>,
): boolean {
  return targetsRoll(power) || (power.procRollSites ?? []).some(targetsRoll);
}

export function HitChanceBadge({ power }: { power?: SelectedPower }) {
  const enabled = useUIStore((s) => s.hitChanceAlertEnabled);
  const targetLevelOffset = useUIStore((s) => s.targetLevelOffset);
  const hitChance = usePowerProjection(
    enabled ? power?.powerSet : undefined,
    power?.internalName,
  )?.hitChance;

  if (!enabled || !power || hitChance == null || hitChance >= HIT_CAP - 1e-9) return null;
  // Read the current data, not the build's saved copy, which predates newer fields.
  if (!rollsToHitFoes(lookupPower(power.powerSet, power.internalName)?.power ?? power)) return null;

  const pct = (hitChance * 100).toFixed(1);
  const target = targetLevelOffset > 0 ? `+${targetLevelOffset}` : `${targetLevelOffset}`;
  return (
    <Tooltip
      content={
        <div className="text-[11px] max-w-[14rem]">
          {pct}% chance to hit a {target} target, under the 95% cap. More Accuracy or ToHit
          raises it.
        </div>
      }
      position="top"
      delay={100}
    >
      <span className="ml-1 flex-shrink-0 rounded border border-[var(--color-warning)] px-1 text-[9px] leading-tight text-[var(--color-warning)] tabular-nums">
        {Math.floor(hitChance * 100)}%
      </span>
    </Tooltip>
  );
}
