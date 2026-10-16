import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { declaredFields as readDeclared } from './declared-fields';
import { getAllPowersets } from '@/data/powersets';

/**
 * Every key the converter emits onto a Power or a Powerset must be declared on the type.
 *
 * The gap this closes is structural, not cosmetic. Generated modules are written as
 * `export const Aim: Power = { … }`, so an undeclared key is an excess-property error and
 * tsc is supposed to be the guard — but only the beta's tsc ever runs. The rebuild's dies
 * early on missing React deps and never reaches a generated file, so for as long as the two
 * repos held different copies of this type, nothing graded the rebuild's at all.
 *
 * It went unnoticed at scale. When power.ts was reconciled on 2026-08-21 the rebuild's copy
 * was missing fourteen fields its own converter writes, `autoIssue` and `free` among them,
 * on all 8,500-odd powers across the three forks. Same class as the `grantEdges` find that
 * opened data-gaps-299: emitted, consumed, never declared.
 *
 * Reading the shipped data rather than the type keeps the direction right — the export is
 * the source of truth, so an emitted key is the evidence and the type is what has to answer
 * for it.
 */

const FORKS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;

const declaredFields = (iface: string) => readDeclared('src/types/power.ts', iface);

describe('every emitted Power / Powerset key is declared on its type', () => {
  const powerKeys = new Map<string, Set<string>>();
  const setKeys = new Map<string, Set<string>>();

  beforeAll(async () => {
    for (const fork of FORKS) {
      await loadDataset(fork);
      const pk = new Set<string>(), sk = new Set<string>();
      for (const set of Object.values(getAllPowersets())) {
        if (!set) continue;
        for (const k of Object.keys(set)) sk.add(k);
        for (const power of set.powers ?? []) for (const k of Object.keys(power)) pk.add(k);
      }
      powerKeys.set(fork, pk);
      setKeys.set(fork, sk);
    }
  }, 300_000);

  it('the census is non-empty on every fork, so an all-green run means something', () => {
    for (const fork of FORKS) {
      expect(setKeys.get(fork)!.size, `${fork} powersets`).toBeGreaterThan(10);
      expect(powerKeys.get(fork)!.size, `${fork} powers`).toBeGreaterThan(20);
    }
  });

  it('Power declares every key the converter writes onto a power', () => {
    const declared = declaredFields('Power');
    // Guard the reader itself: a regex that stopped matching would declare nothing and
    // pass everything.
    expect(declared.has('internalName')).toBe(true);
    expect(declared.size).toBeGreaterThan(40);
    for (const fork of FORKS) {
      const undeclared = [...powerKeys.get(fork)!].filter((k) => !declared.has(k)).sort();
      expect(undeclared, `${fork}: emitted onto Power but undeclared`).toEqual([]);
    }
  });

  it('Powerset declares every key the converter writes onto a set', () => {
    const declared = declaredFields('Powerset');
    expect(declared.has('setPath')).toBe(true);
    for (const fork of FORKS) {
      const undeclared = [...setKeys.get(fork)!].filter((k) => !declared.has(k)).sort();
      expect(undeclared, `${fork}: emitted onto Powerset but undeclared`).toEqual([]);
    }
  });

  it('the fields the 2026-08-21 reconciliation added are the ones the data carries', () => {
    // Pins the find rather than the fix: these are emitted on every fork, and every one of
    // them was undeclared on the rebuild's copy of the type.
    const declared = declaredFields('Power');
    for (const f of ['autoIssue', 'free', 'formVariants', 'targetsAffected']) {
      expect(declared.has(f), `Power.${f} must stay declared`).toBe(true);
      for (const fork of FORKS)
        expect(powerKeys.get(fork)!.has(f), `${fork} must still emit ${f}`).toBe(true);
    }
  });
});
