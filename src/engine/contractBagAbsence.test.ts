/**
 * The shipped engine bundle carries no power `effects` bag.
 *
 * data-gaps-327's beta port emptied the bag from three surfaces, and this one is the last and the
 * least visible. The converters and the generated TS are source in this repo, so a bag coming
 * back there is a diff someone reads. `public/engine/contract/*.json.gz` is vendored build
 * output copied wholesale from canonical by `npm run build:engine`, and it is what USERS
 * download — a bag returning here is four binary blobs changing size, which nothing reads.
 *
 * The staleness half is already covered from the other side: canonical's CI runs
 * `scripts/engine-fingerprint.mjs` against this checkout, so these bundles cannot drift from
 * canonical's. That proves the copy is CURRENT; it says nothing about what is in it. This
 * grades the artifact itself, in the repo that ships it, so the claim does not rest on a chain
 * of two checks that both live somewhere else.
 *
 * The finish line is an identity, not a count. Every `effects` key in a bundle is one of:
 *
 *   - an ARRAY — not the bag at all, a different type sharing a name: a pet ability's effect
 *     list (`pet-entities`, and the same list reached through `powers[].summon`), an IO set
 *     bonus's effect list, a proc entry's. These are untouched by the strip and always will be.
 *   - an OBJECT under `conditionalEffects` — a bag, and a LIVE one. It is the supplier
 *     `expandActiveConditionals` reads to turn a stance or mode into a synthetic power, which
 *     has no atoms to be read from instead (data-gaps-328). The strip never targeted it.
 *
 * An object-valued `effects` anywhere else is the bag, and there is no third thing it could be.
 * So the check needs no slot roster and no expected number: it partitions every occurrence and
 * fails on the residue. Pre-vendor this repo shipped 13,754 of them across the four datasets
 * (3,683 / 3,161 / 3,143 / 3,767) at fourteen distinct parent sites — `powers`, `formVariants`,
 * each named `modeVariants` key, the inherent rosters, `archetypes[].inherent`. All fourteen
 * are covered by the one rule rather than enumerated, so a fifteenth is caught too.
 *
 * Non-vacuity is the other half, and it matters more here than usual: the assertion is an
 * ABSENCE over a file this test also decides how to read, so an empty bundle, a renamed
 * partition or a walk that silently visits nothing all pass by finding no bag. Each dataset
 * must therefore show powers, atoms, both surviving `effects` classes, and a bag count of zero
 * — and the roster of datasets is read off the directory rather than listed, so a fifth server
 * is graded on arrival instead of being skipped in silence.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const CONTRACT_DIR = fileURLToPath(new URL('../../public/engine/contract', import.meta.url));

/**
 * The one object-valued `effects` the strip deliberately left standing. Named rather than
 * matched loosely: if the conditional bag itself is ever retired, the count below goes to zero
 * and the non-vacuity arm reds, which is the right way for that to be noticed.
 */
const LIVE_BAG_PARENT = 'conditionalEffects';

type Census = {
  /** object-valued `effects` that is NOT a conditional's — the bag, and must be empty. */
  bagSites: Map<string, number>;
  conditionalBags: number;
  arrays: number;
  powers: number;
  atoms: number;
};

/**
 * Walk every node, classifying each `effects` by its value shape and its PARENT key.
 *
 * Parent-keyed rather than path-keyed on purpose. A full path distinguishes
 * `powersets.blaster/fire-blast.powers[]` from `epic-pools.flame_mastery.powers[]`, which is
 * detail this claim does not want: the bag is the same object wherever it hangs, and a path
 * roster would have to grow a row for every new home it found. The parent key is what actually
 * separates the two live classes from the dead one.
 */
function census(root: unknown): Census {
  const out: Census = {
    bagSites: new Map(),
    conditionalBags: 0,
    arrays: 0,
    powers: 0,
    atoms: 0,
  };

  const walk = (node: unknown, parent: string): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, parent);
      return;
    }
    if (node === null || typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    // A power is anything carrying the tuple stream; that is what the engine reads, and it is
    // also the population the absence is a claim about.
    if (Array.isArray(record.atoms)) {
      out.powers += 1;
      out.atoms += record.atoms.length;
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === 'effects') {
        if (Array.isArray(value)) out.arrays += 1;
        else if (value !== null && typeof value === 'object') {
          if (parent === LIVE_BAG_PARENT) out.conditionalBags += 1;
          else out.bagSites.set(parent, (out.bagSites.get(parent) ?? 0) + 1);
        }
      }
      // `effects` is transparent to the parent chain: a bag's own children are still described
      // by whatever held the bag, so a nested `summon` reports the site that owns it.
      walk(value, key === 'effects' ? parent : key);
    }
  };

  walk(root, 'ROOT');
  return out;
}

function datasets(): string[] {
  if (!fs.existsSync(CONTRACT_DIR)) return [];
  return fs
    .readdirSync(CONTRACT_DIR)
    .filter((name) => name.endsWith('.json.gz'))
    .map((name) => name.slice(0, -'.json.gz'.length))
    .sort();
}

describe('data-gaps-327 — the vendored engine bundle ships no power effects bag', () => {
  const ids = datasets();

  it('grades every dataset the contract directory holds', () => {
    // Read off disk rather than listed, so a new server is covered on arrival. The floor is the
    // four that exist; a drop below it means the walk lost its population, not that a server left.
    expect(ids.length, `no bundles under ${CONTRACT_DIR}`).toBeGreaterThanOrEqual(4);
  });

  for (const id of ids) {
    it(`${id}: every effects key is a pet/bonus/proc ARRAY or a live conditional bag`, () => {
      const bundle: unknown = JSON.parse(
        zlib.gunzipSync(fs.readFileSync(path.join(CONTRACT_DIR, `${id}.json.gz`))).toString('utf8'),
      );
      const seen = census(bundle);

      // Non-vacuity first: an absence proved over nothing is not a proof. Each of these was
      // present before the strip and is untouched by it, so all four are still true post-strip.
      expect(seen.powers, `${id}: no powers found — the walk visited nothing`).toBeGreaterThan(1000);
      expect(seen.atoms, `${id}: powers carry no atoms`).toBeGreaterThan(10000);
      expect(seen.arrays, `${id}: no array-valued effects — pet/bonus/proc lists went missing`).toBeGreaterThan(1000);
      expect(
        seen.conditionalBags,
        `${id}: no conditional bags — the live synthetic supplier (data-gaps-328) is gone`,
      ).toBeGreaterThan(100);

      const sites = [...seen.bagSites.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([parent, n]) => `  ${n} under <${parent}>`)
        .join('\n');
      expect(
        Object.fromEntries(seen.bagSites),
        `${id}: the power effects bag is back in the shipped bundle at these sites — users would ` +
          `download it, and nothing else in this repo reads these four files:\n${sites}\n` +
          `Re-run \`npm run build:engine\` against a canonical checkout whose ` +
          `\`scripts/keys/effects-bag-survivors.py\` exits 0.`,
      ).toEqual({});
    });
  }
});
