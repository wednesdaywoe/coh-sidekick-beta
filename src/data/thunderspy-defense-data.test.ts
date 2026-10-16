import { describe, it, expect } from 'vitest';
import { atomsOfType, defenseBuffValue, defenseBuffSuppressibleValue } from '@/data/core/atom-query';
import { POWER_POOLS_RAW } from '@/data/datasets/thunderspy/generated/power-pools';
import { FocusedFighting } from '@/data/datasets/thunderspy/generated/powersets/brute/secondary/super-reflexes/focused-fighting';

/**
 * Thunderspy defense-magnitude regression guard.
 *
 * Thunderspy's powers.bin uses an older AttribMod schema: multi-type buffs
 * (defense toggles) leave the front string-attrib array empty (or carry a bogus
 * `Buff_Def` meta) and store the affected positional/type attribs in a SEPARATE
 * post-requires INDEX array (attribIndex*4 → attrib name). The tspy template
 * parser only read the front array, so every defense toggle lost its attribs —
 * the converter then produced NO `defenseBuff`, and defense buffs contributed 0
 * to the planner's Defense totals (only proc IOs showed). The parser now reads
 * the index array for defense-buff templates. These assertions guard the data.
 */
function findPoolPower(name: string) {
  for (const pool of Object.values(POWER_POOLS_RAW as Record<string, { powers?: any[] }>)) {
    const p = pool.powers?.find((pw) => pw.name === name);
    if (p) return p;
  }
  return undefined;
}

/**
 * The defence the calc would spend, read the way the calc reads it.
 *
 * Was `!!(effects.defenseBuff || effects.defenseBuffSuppressible)` — the projected bag. The pool
 * partition kept its bag until the writer-side strip, which is the only reason this assertion
 * outlived the armor-toggle one below; both now state the same source. `defenseBuffValue` and
 * `defenseBuffSuppressibleValue` are the readers `character-totals` uses, so a parser regression
 * that stopped recovering the index-array attribs reds here and zeroes the total together,
 * rather than one of them going quiet.
 */
const hasDefense = (power: unknown) =>
  defenseBuffValue(power as never) !== undefined
  || defenseBuffSuppressibleValue(power as never) !== undefined;

describe('Thunderspy defense powers carry their defense magnitude', () => {
  it.each(['Maneuvers', 'Weave', 'Hover'])(
    'pool defense toggle %s has a defenseBuff',
    (name) => {
      const power = findPoolPower(name);
      expect(power, `${name} should exist in the tspy pools`).toBeDefined();
      expect(hasDefense(power), `${name} should carry defense`).toBe(true);
    },
  );

  it('armor toggle Focused Fighting carries positional (melee) defense', () => {
    // The affected attrib comes from the index array (HC parity: 'Melee'), not
    // the bogus 'Buff_Def' front token. Stated on the atoms — the `effects` bag
    // the bag-side projection provided is retired (data-gaps-327).
    const melee = atomsOfType(FocusedFighting, 'Defense')
      .filter((a) => a.aspect === 'Cur' && a.modifierTable === 'Melee_Buff_Def')
      .find((a) => a.subType === 'Melee');
    expect(melee, 'Focused Fighting should buff melee defense').toBeDefined();
    expect(melee!.scale).toBeGreaterThan(0);
  });
});
