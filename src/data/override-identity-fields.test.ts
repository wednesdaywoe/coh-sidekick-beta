import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * data-gaps-312 guard — the override layer must not restate the identity and
 * placement fields the export owns.
 *
 * `withOverrides()` shallow-replaces a key, so an override entry is
 * indistinguishable from converter output by the time anything reads the
 * composed power. Two fields are owned outright by the binary and an override
 * that restates them is a copy that goes stale (data-gaps-311's shape) or a
 * contradiction of a directly-stated field (data-gaps-312's shape):
 *
 *   - `internalName` is the binary's `name` — the key a saved build writes down.
 *     Re-casing it (the beta's `Frt_`/`Nw_` convention over the bin's `FRT_`/`NW_`)
 *     is a key the game never uses, so a build keyed on it does not round-trip.
 *     An override must NEVER set it; if the case is wrong the parser is the fix.
 *
 *   - `targetType` is the bin's `target_type`, mapped by the converter. An
 *     override that sets it to a value the generated layer disagrees with is
 *     asserting a target the binary never stated (the Omega-Maneuver `Location`
 *     and Frenzy `Self` contradictions); a hand refinement with no source (the
 *     76 `Foe` → `Foe (Alive)` pins, which `formatTargetType` renders
 *     identically) is the same defect wearing a milder face. Either way the
 *     fix belongs in the converter, not the override.
 *
 * Found 2026-08-19 by censusing the override layer for data-gaps-311: 99
 * `targetType` entries and 22 re-cased `internalName` entries, plus the Widow
 * Strike/Lunge pair's swapped `name`/`icon`/`available` (the authored
 * `raw defs/Widow_Training/*.powers` oracle confirmed the bin's swap is the
 * game's own data, so the override was the wrong side). All retired.
 *
 * This runs in CI with NO raw data — it scans the committed generated/ and
 * overrides/ `.ts` files directly, so a hand-added restating override is
 * caught at PR time.
 */

const DATASETS_DIR = fileURLToPath(new URL('./datasets', import.meta.url));
const DATASETS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'];

function walkTs(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(p, out);
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Extract the object literal from a `export const <name>: (Partial<>)?Power = {...};`
 * file and parse it. The generated layer is strict JSON; a few hand-written
 * overrides use bare keys / single quotes / trailing commas, so fall back to a
 * tolerant normalisation before giving up.
 */
function parsePowerObject(file: string): Record<string, unknown> | null {
  const txt = fs.readFileSync(file, 'utf8');
  const m = txt.match(/:\s*(?:Partial<\w+>\s*=\s*|Power\s*=\s*)(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) return null;
  const body = m[1];
  try {
    return JSON.parse(body);
  } catch {
    // Tolerant pass: quote bare keys, drop trailing commas, single→double quotes.
    const norm = body
      .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":')
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/'/g, '"');
    try {
      return JSON.parse(norm);
    } catch {
      return null;
    }
  }
}

const overrideFiles = DATASETS.flatMap((ds) =>
  walkTs(path.join(DATASETS_DIR, ds, 'overrides')).filter((f) => !f.endsWith('index.ts')),
);

describe('data-gaps-312: the override layer does not restate export-owned identity fields', () => {
  it('examines a non-trivial number of override files (vacuity floor)', () => {
    // The layer carried 200+ override files at the time this guard was written;
    // a count near zero means the walk is broken and the invariants below are
    // passing vacuously.
    expect(overrideFiles.length).toBeGreaterThan(50);
  });

  it('no override sets internalName (the bin owns the build key)', () => {
    const offenders: string[] = [];
    for (const f of overrideFiles) {
      const o = parsePowerObject(f);
      if (o && 'internalName' in o) {
        offenders.push(`${path.relative(DATASETS_DIR, f)}: ${JSON.stringify(o.internalName)}`);
      }
    }
    expect(offenders, `overrides restating internalName:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no override sets targetType to a value the generated layer disagrees with', () => {
    const offenders: string[] = [];
    for (const f of overrideFiles) {
      const o = parsePowerObject(f);
      if (!o || !('targetType' in o)) continue;
      const twin = f.replace(/\/overrides\//, '/generated/');
      const g = fs.existsSync(twin) ? parsePowerObject(twin) : null;
      if (g && 'targetType' in g && g.targetType !== o.targetType) {
        offenders.push(
          `${path.relative(DATASETS_DIR, f)}: override ${JSON.stringify(o.targetType)} vs generated ${JSON.stringify(g.targetType)}`,
        );
      }
    }
    expect(offenders, `overrides contradicting the generated targetType:\n${offenders.join('\n')}`).toEqual([]);
  });
});
