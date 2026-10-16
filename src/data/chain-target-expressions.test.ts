import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeChainTarget, describeTargetCap } from '@/utils/chain-expressions';

/** An expression WRITTEN as text in this file. The pipeline carries token lists
 *  (data-gaps-123); only the literals authored below need splitting, and naming it keeps
 *  the two apart. */
const toks = (text: string) => text.split(' ');

/**
 * Guards the two chain-power RPN expressions recovered from powers.bin
 * (fields 43b / 38 → `chainTargetExpression` / `maxTargetsExpression`) and the
 * Info-panel humanizers that render them. The oracle values are the HC dev's
 * `.powers` source — see streams/HOMECOMING_PARSER.md ("Chain / max-targets
 * expression fields"). The Electrical Affinity circuits are the canonical
 * carriers: Rejuvenating = HP-priority, Energizing = End-priority, Empowering =
 * proximity-only; every circuit's cap grows with the Static buff.
 */

/** A token-array field, read out of the generated file ON DISK.
 *
 *  Read from the serialized text rather than by importing the module, so what is
 *  graded is what the converter actually wrote. No token contains `]`, so the
 *  match to the first closing bracket is exact. */
function gen(rel: string): (key: string) => string[] | undefined {
  const p = fileURLToPath(
    new URL(`./datasets/homecoming/generated/powersets/${rel}`, import.meta.url),
  );
  const text = fs.readFileSync(p, 'utf8');
  return (key: string) => {
    const m = text.match(new RegExp(`"${key}": (\\[[^\\]]*\\])`));
    return m ? (JSON.parse(m[1]) as string[]) : undefined;
  };
}

const AFF = 'defender/primary/electrical-affinity';

describe('ChainTarget / MaxTargetsExpr survive the export→convert pipeline', () => {
  it('Rejuvenating Circuit: HP-priority ChainTarget + Static-scaled cap', () => {
    const p = gen(`${AFF}/rejuvenating-circuit.ts`);
    expect(p('chainTargetExpression')).toEqual(
      toks('101 kHitPoints% target> - enttype maintarget> enttype target> eq 99 * 1 + * 1 prevdistance / +'),
    );
    expect(p('maxTargetsExpression')).toEqual(
      toks('4 Redirects.Shock_Therapy.Shock_Therapy_Static source.ownPowerNum? 3 * +'),
    );
  });

  it('Energizing Circuit: Endurance-priority ChainTarget', () => {
    const p = gen(`${AFF}/energizing-circuit.ts`);
    expect(p('chainTargetExpression')?.slice(0, 4)).toEqual(toks('101 kEndurance% target> -'));
  });

  it('Empowering Circuit: proximity-only ChainTarget (no stat clause)', () => {
    const p = gen(`${AFF}/empowering-circuit.ts`);
    expect(p('chainTargetExpression')).toEqual(
      toks('enttype maintarget> enttype target> eq 99 * 1 + 1 prevdistance / +'),
    );
    expect(p('chainTargetExpression')).not.toContain('kHitPoints%');
    expect(p('chainTargetExpression')).not.toContain('kEndurance%');
  });

  it('a Tanker AoE melee attack carries the Gauntlet MaxTargetsExpr', () => {
    // Gauntlet raises the target cap on Tanker melee AoEs (bin field 38).
    const p = gen('tanker/secondary/battle-axe/cleave.ts');
    expect(p('maxTargetsExpression')?.length).toBeGreaterThan(0);
    expect(p('maxTargetsExpression')).toContain('kDisable_GauntletTargetCap');
  });
});

describe('chain-expression humanizers', () => {
  it('describeChainTarget maps the circuit patterns', () => {
    const rej = '101 kHitPoints% target> - enttype maintarget> enttype target> eq 99 * 1 + * 1 prevdistance / +';
    const ene = '101 kEndurance% target> - enttype maintarget> enttype target> eq 99 * 1 + * 1 prevdistance / +';
    const emp = 'enttype maintarget> enttype target> eq 99 * 1 + 1 prevdistance / +';
    expect(describeChainTarget(toks(rej))).toBe('Most-injured ally (lowest HP)');
    expect(describeChainTarget(toks(ene))).toBe('Lowest-endurance ally');
    expect(describeChainTarget(toks(emp))).toBe('Nearest target'); // proximity-only
    expect(describeChainTarget(toks('some unknown tokens'))).toBe('Weighted selection');
  });

  it('HP/End priority wins over the proximity tiebreaker in the same expression', () => {
    // The HP-priority expression also contains `prevdistance`; the stat clause
    // must be reported, not "Nearest target".
    expect(describeChainTarget(toks('101 kHitPoints% ... prevdistance / +'))).toBe('Most-injured ally (lowest HP)');
  });

  it('describeTargetCap distinguishes Static-stack vs Gauntlet vs generic', () => {
    expect(describeTargetCap(toks('4 Redirects.Shock_Therapy.Shock_Therapy_Static source.ownPowerNum? 3 * +')))
      .toBe('Grows with Static stacks');
    expect(describeTargetCap(toks('16 kDisable_GauntletTargetCap owner.Mode? 6 * -'))).toBe('Raised by Gauntlet');
    expect(describeTargetCap(toks('7 something? 2 * +'))).toBe('Conditional');
  });
});
