import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A converter that invents a REAL set heading for a power the game lists in no
 * set offers genuine sets where the game refuses them, and every category still
 * matches something — so no heading-vocabulary check can see it. That was
 * data-gaps-39's actual damage: the pool/epic converters answered
 * `allowed_set_categories: null` with an inference heuristic, and the picker
 * offered Teleport sets in Jaunt and Healing sets in Rebirth's Hoarfrost. So
 * this joins the generated pool/epic categories back to the export: a power
 * offers set categories only if its own `allowed_set_categories`
 * (boostsets.bin's per-set power lists, reversed) grants them.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe.each(['homecoming', 'rebirth', 'thunderspy', 'brainstorm'])(
  'pool/epic categories are raw-backed — %s',
  (dataset) => {
    const exportRoot =
      dataset === 'homecoming'
        ? path.join(HERE, '../../exported_powers')
        : path.join(HERE, '../../exported_powers', dataset);

    const rawCategories = new Map<string, unknown>();
    for (const branch of ['pool', 'epic']) {
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.json')) {
            const j = JSON.parse(fs.readFileSync(full, 'utf8'));
            if (j?.full_name) rawCategories.set(j.full_name.toLowerCase(), j.allowed_set_categories);
          }
        }
      };
      walk(path.join(exportRoot, branch));
    }

    const generated: { fullName: string; cats: string[] }[] = [];
    for (const file of ['power-pools.ts', 'epic-pools.ts']) {
      const text = fs.readFileSync(path.join(HERE, 'datasets', dataset, 'generated', file), 'utf8');
      const re = /"fullName":\s*"([^"]+)"|"allowedSetCategories":\s*\[([^\]]*)\]/gs;
      let m;
      let current: string | null = null;
      while ((m = re.exec(text)) !== null) {
        if (m[1] !== undefined) {
          current = m[1];
        } else if (current) {
          const cats = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
          generated.push({ fullName: current, cats });
        }
      }
    }

    it('the join is reading something on both sides', () => {
      expect(rawCategories.size).toBeGreaterThan(100);
      expect(generated.filter((g) => g.cats.length > 0).length).toBeGreaterThan(50);
    });

    it('every offered category is one the export grants that power', () => {
      const unbacked = generated
        .filter((g) => g.cats.length > 0)
        .map((g) => {
          const raw = rawCategories.get(g.fullName.toLowerCase());
          if (!Array.isArray(raw) || raw.length === 0) {
            return `${g.fullName}: offers [${g.cats.join(', ')}] but the export lists it in no set`;
          }
          const granted = new Set(raw as string[]);
          const invented = g.cats.filter((c) => !granted.has(c));
          return invented.length > 0
            ? `${g.fullName}: offers [${invented.join(', ')}] beyond the export's grant`
            : null;
        })
        .filter((x): x is string => x !== null);
      expect(unbacked).toEqual([]);
    });
  },
);
