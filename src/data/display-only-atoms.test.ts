import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomsOf, atomsOfType, baseAtoms, isDisplayOnly } from './core/atom-query';
import { ATOM_TUPLE_FIELDS, decodeAtoms } from './core/atomic-effect';
import type { EncodedAtom } from './core/atomic-effect';

/**
 * A row the client prints but never applies, and why the totals must skip it.
 *
 * An effect group tagged `DisplayOnly` exists so the tooltip can quote a number the power
 * causes somewhere else. Brainstorm's Disruption Strike states its −2.5 resistance debuff
 * that way, and the converter's ToWho fold lands it on `Target` — which `reachesCaster`
 * resolves as the caster on a `["Self"]` power (TARGETS-3). Rest's real −10 crash has that
 * exact shape, so the tag is the only thing telling a tooltip twin from a genuine self
 * penalty. Nothing read it, and the phantom reached the self-resistance applier on all eight
 * damage types.
 *
 * The corpus half of this gate is thin and can't be made thicker: exactly one such group
 * exists across all four datasets. So the rules the corpus never exercises — token-wise
 * matching, and `atomsOf` staying complete — are graded on constructed atoms instead. A
 * corpus can't grade a scope nothing in it violates.
 */

const DATASETS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;
const ROOT = fileURLToPath(new URL('./datasets', import.meta.url));
const TAGS_IDX = ATOM_TUPLE_FIELDS.indexOf('tags' as never);

/** An atom carrying just an effectType and a `tags` string, built through the real encoding. */
function atom(tags?: string) {
  const tuple = new Array(ATOM_TUPLE_FIELDS.length).fill(null) as unknown as EncodedAtom;
  (tuple as unknown[])[0] = 'Resistance';
  if (tags !== undefined) (tuple as unknown[])[TAGS_IDX] = tags;
  return tuple;
}

/** Every generated power file under a dataset's powersets tree. */
function powerFiles(dataset: string): string[] {
  const root = path.join(ROOT, dataset, 'generated', 'powersets');
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Decoded atoms whose committed tuple names the tag, with the dataset each came from. */
function displayOnlyRows(): { dataset: string; file: string; tags: string }[] {
  const out: { dataset: string; file: string; tags: string }[] = [];
  for (const dataset of DATASETS) {
    for (const file of powerFiles(dataset)) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('DisplayOnly')) continue;
      for (const line of src.split('\n')) {
        const trimmed = line.trim().replace(/,$/, '');
        if (!trimmed.startsWith('[') || !trimmed.includes('DisplayOnly')) continue;
        const [decoded] = decodeAtoms([JSON.parse(trimmed) as EncodedAtom]);
        if (decoded?.tags) out.push({ dataset, file, tags: decoded.tags });
      }
    }
  }
  return out;
}

describe('DisplayOnly atoms are printed, never totalled', () => {
  it('matches the tag token-wise, not as a substring', () => {
    const t = (tags?: string) => isDisplayOnly(decodeAtoms([atom(tags)])[0]);
    expect(t('DisplayOnly')).toBe(true);
    expect(t('ResDebuffProc,DisplayOnly')).toBe(true);
    expect(t('DisplayOnly,ResDebuffProc')).toBe(true);
    expect(t('A,DisplayOnly,B')).toBe(true);
    // The whole reason the match is delimiter-anchored: a tag that merely CONTAINS the
    // token is a different tag, and a naive `includes` would silence it.
    expect(t('NotDisplayOnly')).toBe(false);
    expect(t('DisplayOnlyish')).toBe(false);
    expect(t('ResDebuffProc')).toBe(false);
    expect(t(undefined)).toBe(false);
  });

  it('drops the row from both totals entry points but not from atomsOf', () => {
    const power = { atoms: [atom('ResDebuffProc'), atom('DisplayOnly'), atom()] } as never;
    // Printing the row is the whole reason it exists, so the complete list keeps it.
    expect(atomsOf(power)).toHaveLength(3);
    expect(atomsOfType(power, 'Resistance')).toHaveLength(2);
    expect(baseAtoms(power)).toHaveLength(2);
    expect(atomsOfType(power, 'Resistance').some(isDisplayOnly)).toBe(false);
    expect(baseAtoms(power).some(isDisplayOnly)).toBe(false);
  });

  it('recognizes every DisplayOnly row the committed corpus carries', () => {
    const rows = displayOnlyRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.tags.split(',')).toContain('DisplayOnly');
      expect(isDisplayOnly(decodeAtoms([atom(r.tags)])[0])).toBe(true);
    }
    // Pinned: Sonic Aura's Disruption Strike is the only carrier, on Brainstorm and, since
    // Issue 28 Page 4 went live (2026-10-06), Homecoming. A dataset growing one should be
    // adjudicated here rather than absorbed — the game uses it for more than resistance.
    expect(new Set(rows.map((r) => r.dataset))).toEqual(new Set(['homecoming', 'brainstorm']));
  });
});
