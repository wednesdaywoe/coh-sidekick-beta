/**
 * Every composed power key must resolve in the contract bundle the wasm engine reads.
 *
 * The build stores `internalName`, the engine looks it up in the vendored contract, and Rust's
 * lookup is case-sensitive. The two sides come from different places: the TS layer is
 * `generated/` composed with `overrides/` in this repo, while `public/engine/contract/*.json.gz`
 * is vendored from canonical. Fix one side there and re-vendor without the other and the keys
 * part company, which is what data-gaps-312 did here. Twenty-two Widow/Soldier branch powers kept
 * the beta's `Frt_`/`Nw_`/`Cs_`/`Ws_` re-casing against the bin's `FRT_`/`NW_`/`CS_`/`WS_`,
 * every card and slot rendered, and only the totals were short.
 *
 * `override-identity-fields.test.ts` guards the cause (an override must not restate
 * `internalName`). This guards the symptom, so a re-casing arriving by any other route is still
 * caught.
 *
 * Powerset tree only. Pool and epic powers are keyed by `fullName` in the contract and carry no
 * `internalName`, so they need a different join; no pool or epic override sets `internalName`
 * today, which is why the gap is filed rather than covered.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DATASETS_DIR = fileURLToPath(new URL('../data/datasets', import.meta.url));
const CONTRACT_DIR = fileURLToPath(new URL('../../public/engine/contract', import.meta.url));

type ContractBundle = {
  powersets: Record<string, { powers?: { internalName?: string }[] }>;
};

function datasets(): string[] {
  if (!fs.existsSync(DATASETS_DIR)) return [];
  return fs
    .readdirSync(DATASETS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(CONTRACT_DIR, `${e.name}.json.gz`)))
    .map((e) => e.name);
}

function walkTs(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(p, out);
    else if (entry.name.endsWith('.ts') && entry.name !== 'index.ts') out.push(p);
  }
  return out;
}

/**
 * The composed key: the override's `internalName` when it sets one, else the generated one.
 * Read as text rather than imported, so the file the converter wrote is what gets graded.
 */
function internalNameOf(file: string): string | null {
  const m = fs.readFileSync(file, 'utf8').match(/^\s*"?internalName"?:\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

describe('composed power keys resolve in the vendored contract', () => {
  const ids = datasets();

  it('finds a dataset to grade', () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  for (const id of ids) {
    it(`${id}: every powerset power is a key the engine can look up`, () => {
      const bundle = JSON.parse(
        zlib.gunzipSync(fs.readFileSync(path.join(CONTRACT_DIR, `${id}.json.gz`))).toString('utf8'),
      ) as ContractBundle;
      const contract = new Map(
        Object.entries(bundle.powersets).map(([key, set]) => [
          key,
          new Set((set.powers ?? []).map((p) => p.internalName)),
        ]),
      );

      const genRoot = path.join(DATASETS_DIR, id, 'generated', 'powersets');
      const ovRoot = path.join(DATASETS_DIR, id, 'overrides', 'powersets');
      const files = walkTs(genRoot);
      expect(files.length, `${id} has no generated powerset files`).toBeGreaterThan(0);

      const unresolvable: string[] = [];
      for (const file of files) {
        const rel = path.relative(genRoot, file);
        const generated = internalNameOf(file);
        if (!generated) continue;
        const overridePath = path.join(ovRoot, rel);
        const name =
          (fs.existsSync(overridePath) ? internalNameOf(overridePath) : null) ?? generated;

        const [archetype, , powerset] = rel.split(path.sep);
        const key = `${archetype}/${powerset}`;
        const powers = contract.get(key);
        if (!powers) unresolvable.push(`${key} — no such powerset in the contract`);
        else if (!powers.has(name)) unresolvable.push(`${key}/${name} — not a power the contract carries`);
      }

      expect(
        unresolvable,
        `${id}: the engine cannot resolve these build keys, so their effects drop out of the ` +
          `totals while the UI still renders them:\n${unresolvable.join('\n')}`,
      ).toEqual([]);
    });
  }
});
