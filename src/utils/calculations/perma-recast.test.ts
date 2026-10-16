/**
 * recastVerdict — the atoms' authored stacking flavour, read for the caster-side
 * window, is the only thing that may answer "does recasting early overlap". The
 * TS twin of the engine's `coh_math::perma` unit tests: unanimous Replace reads
 * as refreshes (Farsight's shape), self-Stack with room reads as stacks (Siphon
 * Speed's shape), and a mix / an unproven flavour / a foe-owned clock all refuse
 * a verdict rather than guess.
 */
import { describe, it, expect } from 'vitest';
import { recastVerdict } from './perma';
import type { Power } from '@/types';

/** One atom tuple in wire order through `stackCap` (index 12). */
const atomStacking = (duration: number, toWho: string, stacking: string, cap: number) => [
  'Defense', 'All', 1.0, 1.0, duration, 'Ranged_Buff_Def', 'Cur', 'Magnitude',
  toWho, 'Any', false, stacking, cap,
];

// `targetsAffected` is what resolves a `Target` atom's pronoun (data-gaps-63) — the
// real Farsight carries `['Teammate', 'Self']`, so its caster is among the affected.
const recastPower = (atoms: unknown[], targetsAffected = ['Teammate', 'Self']): Power =>
  ({
    name: 'Sight',
    internalName: 'X.Y.Sight',
    powerType: 'Click',
    targetsAffected,
    atoms,
  }) as unknown as Power;

describe('recastVerdict', () => {
  it('unanimous Replace reads as refreshes (Farsight shape)', () => {
    const power = recastPower([
      atomStacking(120, 'Target', 'Replace', 2),
      atomStacking(120, 'Target', 'Replace', 2),
    ]);
    expect(recastVerdict(power, 120)).toBe('refreshes');
  });

  it('self Stack with room reads as stacks (Siphon Speed shape)', () => {
    const power = recastPower([atomStacking(120, 'Self', 'Stack', 2)]);
    expect(recastVerdict(power, 120)).toBe('stacks');
  });

  it('a mixed family refuses a verdict', () => {
    const power = recastPower([
      atomStacking(120, 'Self', 'Replace', 2),
      atomStacking(120, 'Self', 'Stack', 2),
    ]);
    expect(recastVerdict(power, 120)).toBeUndefined();
  });

  it('an unproven flavour refuses a verdict', () => {
    const power = recastPower([atomStacking(120, 'Self', 'Extend', 2)]);
    expect(recastVerdict(power, 120)).toBeUndefined();
  });

  it('a stack capped at one refuses a verdict', () => {
    const power = recastPower([atomStacking(120, 'Self', 'Stack', 1)]);
    expect(recastVerdict(power, 120)).toBeUndefined();
  });

  it("a foe-aimed power's Target atoms time the foe's clock, not the caster's", () => {
    const power = recastPower([atomStacking(120, 'Target', 'Replace', 2)], ['Foe']);
    expect(recastVerdict(power, 120)).toBeUndefined();
  });
});
