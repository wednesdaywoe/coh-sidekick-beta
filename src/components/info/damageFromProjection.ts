/**
 * The engine's per-power damage ledger, reshaped into the `PowerDamageResult` the damage block
 * renders — for the powers `calculatePowerDamage` cannot see.
 *
 * That calculator reads the converter's `power.damage`, which collects unconditional rows only.
 * Attune's every damage row is gated on `distance 40 <=`, so the converter left the field off and
 * the block drew nothing. The engine answers the gate (a target being hit is within the power's
 * reach) and resolves the hit; Mud Pots, whose row the converter misses outright, comes through
 * the same way.
 *
 * Only `'always'` components count, the same set the engine's own totals sum. A chance row is a
 * further hit and a dormant one is inert; an unresolved row (EM Pulse vs Electronic) is not in
 * `components` at all and stays with the conditional display that already owns it.
 */
import type { PowerDamage } from '@/engine/engineTotalsMap';
import type { PowerDamageResult } from '@/utils/calculations';

export function damageFromProjection(damage: PowerDamage | undefined): PowerDamageResult | null {
  if (!damage) return null;
  const always = damage.components.filter((c) => c.application === 'always');
  // `> 0`, not truthiness: an empty sum arrives as -0.
  if (!always.length || !(damage.base > 0)) return null;
  return {
    base: damage.base,
    enhanced: damage.enhanced,
    final: damage.final,
    type: [...new Set(always.map((c) => c.damageType))].join('/'),
    capped: damage.capped,
  };
}
