import { describe, expect, it } from 'vitest';
import { rollsToHitFoes } from './HitChanceBadge';

describe('rollsToHitFoes', () => {
  it('a foe-targeted attack with no auto-hit rolls', () => {
    expect(rollsToHitFoes({ targetsAffected: ['Foe'], targetsAutoHit: ['None'] })).toBe(true);
  });

  it('a power that auto-hits foes never rolls', () => {
    expect(rollsToHitFoes({ targetsAffected: ['Foe'], targetsAutoHit: ['Foe'] })).toBe(false);
  });

  it('self and ally powers never roll against a foe', () => {
    expect(rollsToHitFoes({ targetsAffected: ['Self'], targetsAutoHit: ['Self'] })).toBe(false);
    expect(rollsToHitFoes({ targetsAffected: ['Friend', 'Self'], targetsAutoHit: ['Friend', 'Self'] })).toBe(false);
  });

  it('a power affecting friends and foes rolls only against the foes', () => {
    expect(rollsToHitFoes({ targetsAffected: ['Friend', 'Foe'], targetsAutoHit: ['None'] })).toBe(true);
  });

  it('a power whose executed child rolls counts as rolling (Spring Attack)', () => {
    expect(rollsToHitFoes({
      targetsAffected: ['Self'],
      targetsAutoHit: ['Self'],
      procRollSites: [{
        power: 'Redirects.Pool_Leaping.Spring_Attack', boostsAllowed: ['Damage'], radius: 15, arc: 0,
        targetsAffected: ['Foe'], targetsAutoHit: ['None'],
      }],
    })).toBe(true);
  });

  it('absent data is unknown, never "rolls"', () => {
    expect(rollsToHitFoes({ targetsAffected: ['Foe'] })).toBe(false);
    expect(rollsToHitFoes({})).toBe(false);
  });
});
