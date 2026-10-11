import { describe, expect, it } from 'vitest';
import type { PowerDamage, PowerDamageComponent } from '@/engine/engineTotalsMap';
import { damageFromProjection } from './damageFromProjection';

const component = (damageType: string, base: number, application: PowerDamageComponent['application']): PowerDamageComponent => ({
  damageType, table: 'Melee_Damage', base,
  total: { base, enhanced: base * 2, final: base * 3 },
  application, overTime: null, gate: null, tags: [],
});

const ledger = (components: PowerDamageComponent[], base: number): PowerDamage => ({
  components, unresolved: [], base, enhanced: base * 2, final: base * 3, capped: false,
});

describe('damageFromProjection', () => {
  it('reads the engine sums and names every landing type', () => {
    const r = damageFromProjection(ledger([
      component('Smashing', 15, 'always'),
      component('Energy', 15, 'always'),
      component('Fire', 14.3, 'dormant'),
    ], 30));
    expect(r).toEqual({ base: 30, enhanced: 60, final: 90, type: 'Smashing/Energy', capped: false });
  });

  it('declines a ledger with nothing that always lands', () => {
    // EM Pulse: its only row waits on `Electronic target.HasTag?`, and the empty sum is -0.
    expect(damageFromProjection(ledger([], -0))).toBeNull();
    expect(damageFromProjection(ledger([component('Fire', 5, 0.1)], -0))).toBeNull();
    expect(damageFromProjection(undefined)).toBeNull();
  });
});
