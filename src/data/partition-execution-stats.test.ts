import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The minted `stats` block says what the export record says.
 *
 * The pool, epic, accolade and inherent converters kept a power's execution stats in the
 * `effects` bag under the export's own field names; `scripts/_power-stats.cjs` now mints the
 * same `stats` object an archetype power publishes (atom-migration, display item job 2). The
 * Rust gate `partition_execution_stats_parity` grades the migration — did any projected number
 * MOVE — and it dies with the bag, because it compares the two shapes against each other. This
 * one compares against the raw export instead, so it survives the bag's deletion and is the
 * standing answer to "is the number right", not just "did it change".
 *
 * The field map below is spelled out independently of the mint on purpose. A test that called
 * `powerStats` would be asking the converter whether it agrees with itself.
 *
 * `castTime` / `interruptTime` / `timeToRoot` are skipped on a power carrying `quickSnipe`: the
 * shell record's `activation_time` is the FAST anim, and the converter deliberately overrides
 * those three with the slow branch's real timing (data-gaps-146).
 */

const REPO = process.cwd();
const DATASETS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;

/** `stats` key → the export field it is read from. */
const FIELD_MAP: Record<string, string> = {
  accuracy: 'accuracy',
  range: 'range',
  radius: 'radius',
  arc: 'arc',
  recharge: 'recharge_time',
  endurance: 'endurance_cost',
  castTime: 'activation_time',
  interruptTime: 'interrupt_time',
  activatePeriod: 'activate_period',
  maxTargets: 'max_targets_hit',
  timeToRoot: 'time_to_root',
};

/** Overridden by the slow form's own timing wherever a fast form exists. */
const SNIPE_OVERRIDDEN = new Set(['castTime', 'interruptTime', 'timeToRoot']);

/** The bin enum → the planner's narrower EffectArea, as the converters normalize it. */
const EFFECT_AREA: Record<string, string> = {
  SingleTarget: 'SingleTarget',
  Cone: 'Cone',
  Sphere: 'AoE',
  Location: 'Location',
  Chain: 'Chain',
};

interface RawRecord {
  full_name?: string;
  [field: string]: unknown;
}

/** Every export record of one dataset, keyed by its case-folded `full_name`. */
function exportIndex(dataset: string): Map<string, RawRecord> {
  const base = path.join(REPO, 'exported_powers');
  const root = dataset === 'homecoming' && !fs.existsSync(path.join(base, dataset))
    ? base
    : path.join(base, dataset);
  const index = new Map<string, RawRecord>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Every fork's tree sits under `exported_powers/<ds>/`, so Homecoming's root walk must
        // not descend into them and index another server's records as its own.
        if (DATASETS.includes(entry.name as (typeof DATASETS)[number])) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.json') || entry.name === 'index.json') continue;
      let json: RawRecord;
      try {
        json = JSON.parse(fs.readFileSync(full, 'utf-8'));
      } catch {
        continue;
      }
      if (typeof json?.full_name === 'string') {
        index.set(json.full_name.toLowerCase(), json);
      }
    }
  };
  walk(root);
  return index;
}

interface GeneratedPower {
  name: string;
  fullName?: string;
  stats?: Record<string, number>;
  effectArea?: string;
  quickSnipe?: unknown;
}

/** Every generated power of the four partitions the mint covers. */
function partitionPowers(dataset: string): GeneratedPower[] {
  const dir = path.join(REPO, 'src', 'data', 'datasets', dataset, 'generated');
  const out: GeneratedPower[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.name === 'string' && node.stats) out.push(node as unknown as GeneratedPower);
    Object.values(node).forEach(collect);
  };
  for (const file of ['power-pools', 'epic-pools', 'accolades', 'inherents', 'basic-inherents']) {
    const source = path.join(dir, `${file}.ts`);
    if (!fs.existsSync(source)) continue;
    // The generated modules are one `export const X = <literal>;` each, so the literal is
    // readable without a TS import — which keeps this test off the runtime facades and on what
    // the converter actually wrote.
    const text = fs.readFileSync(source, 'utf-8');
    for (const match of text.matchAll(/^export const \w+(?::[^=]+)? = ([[{][\s\S]*?);\n/gm)) {
      collect(JSON.parse(match[1]));
    }
  }
  return out;
}

describe('partition execution stats', () => {
  for (const dataset of DATASETS) {
    it(`${dataset}: every minted stat matches its export record`, () => {
      const records = exportIndex(dataset);
      const powers = partitionPowers(dataset);
      // A dataset whose powers resolve no record would compare nothing and read green.
      expect(powers.length).toBeGreaterThan(400);

      const mismatches: string[] = [];
      let compared = 0;
      let unmatched = 0;

      for (const power of powers) {
        const record = power.fullName && records.get(power.fullName.toLowerCase());
        if (!record) {
          unmatched += 1;
          continue;
        }
        for (const [key, value] of Object.entries(power.stats ?? {})) {
          if (power.quickSnipe && SNIPE_OVERRIDDEN.has(key)) continue;
          const authored = record[FIELD_MAP[key]];
          compared += 1;
          if (authored !== value) {
            mismatches.push(`${power.fullName} ${key}: export ${authored}, minted ${value}`);
          }
        }
        if (power.effectArea !== undefined) {
          const authored = EFFECT_AREA[String(record.effect_area)];
          compared += 1;
          if (authored !== power.effectArea) {
            mismatches.push(
              `${power.fullName} effectArea: export ${record.effect_area}, minted ${power.effectArea}`,
            );
          }
        }
      }

      // A record the index cannot resolve is a power this oracle does not grade, so the count
      // is asserted rather than left to be discovered as a silent shrink of the corpus.
      expect({ dataset, unmatched }).toEqual({ dataset, unmatched: 0 });
      // Floor, not a count: the two repos hold different partitions. `inherents.ts` is
      // canonical-only, so the beta grades ~300 fewer values on each fork.
      expect(compared).toBeGreaterThan(2700);
      expect(mismatches.slice(0, 10)).toEqual([]);
    });
  }
});
