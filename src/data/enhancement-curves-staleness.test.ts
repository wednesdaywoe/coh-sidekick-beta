import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import type { EnhancementCurvesData, EnhancementSchedule } from './datasets/homecoming/generated/enhancement-curves';
import { ENHANCEMENT_CURVES as HOMECOMING_CURVES } from './datasets/homecoming/generated/enhancement-curves';
import { ENHANCEMENT_CURVES as REBIRTH_CURVES } from './datasets/rebirth/generated/enhancement-curves';
import { ENHANCEMENT_CURVES as THUNDERSPY_CURVES } from './datasets/thunderspy/generated/enhancement-curves';
import { ENHANCEMENT_CURVES as BRAINSTORM_CURVES } from './datasets/brainstorm/generated/enhancement-curves';

/**
 * Enhancement-curves staleness guard (data-gaps-324 SW3) — generated == export,
 * both directions.
 *
 * The generated `enhancement-curves.ts` modules are what the engine will read
 * (SW5/SW6); the committed `exported_powers/**` JSON is the truth they derive
 * from. The CI regen-diff guard catches converter-output drift, but not a
 * converter that silently mis-derives in the same way twice. This test
 * re-derives every field from the export with an independent implementation
 * and asserts full equality:
 *
 *   export -> generated: every dim_returns boost type, tier triple, curve
 *     value, and boost_effectiveness entry appears in the module unchanged.
 *   generated -> export: deep equality means the module carries nothing the
 *     export doesn't back (no extra boost types, schedules, or values).
 *
 * The derivation rules replicated here are the ones proven in
 * scripts/derive-source1-constants.py (SW1 §1–§5, SW2 census); a divergence
 * between this test and convert-enhancement-curves.cjs surfaces as a red
 * guard, never a silent gap.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require_ = createRequire(import.meta.url);
const { derivePlayerArchetypes } = require_('../../scripts/_player-classes.cjs') as {
  derivePlayerArchetypes: (tablesDir: string) => string[];
};

// Schedule identity by dim_returns tier-start triple (SW1 §1). Must match
// SCHEDULE_BY_TRIPLE in convert-enhancement-curves.cjs.
const SCHEDULE_BY_TRIPLE = new Map<string, EnhancementSchedule>([
  ['0.7,0.9,1', 'A'],
  ['0.4,0.5,0.6', 'B'],
  ['0.8,1,1.2', 'C'],
  ['1.2,1.5,1.8', 'D'],
]);

interface DimReturnTier {
  start: number;
  handicap: number;
}
interface DimReturnEntry {
  is_default: boolean;
  boost_types: string[];
  returns: Array<{ tiers: DimReturnTier[] }>;
}
interface ExportCurves {
  dim_returns: DimReturnEntry[];
  boost_effectiveness: { above: number[]; below: number[]; boosters: number[] };
}

const DATASETS: Array<{ id: string; module: EnhancementCurvesData }> = [
  { id: 'homecoming', module: HOMECOMING_CURVES },
  { id: 'rebirth', module: REBIRTH_CURVES },
  { id: 'thunderspy', module: THUNDERSPY_CURVES },
  { id: 'brainstorm', module: BRAINSTORM_CURVES },
];

function exportRoot(datasetId: string): string {
  // HC ships at the legacy flat layout; other datasets are namespaced.
  const namespaced = join(REPO_ROOT, 'exported_powers', datasetId);
  if (datasetId === 'homecoming' && !existsSync(join(namespaced, 'enhancement_curves.json'))) {
    return join(REPO_ROOT, 'exported_powers');
  }
  return namespaced;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

// Strip float32 storage noise from an authored decimal.
function authored(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

function scheduleOf(entry: DimReturnEntry): EnhancementSchedule {
  const key = entry.returns[0].tiers.map((t) => String(authored(t.start))).join(',');
  const letter = SCHEDULE_BY_TRIPLE.get(key);
  if (!letter) throw new Error(`Unknown tier triple ${key}`);
  return letter;
}

describe.each(DATASETS)('enhancement curves staleness: $id', ({ id, module }) => {
  const root = exportRoot(id);
  const exportCurves = readJson<ExportCurves>(join(root, 'enhancement_curves.json'));

  it('carries the dataset id it was generated for', () => {
    expect(module.dataset).toBe(id);
  });

  it('dim_returns reproduces the schedule map, thresholds, and tier effectiveness', () => {
    const expectedBoostTypes: Record<string, EnhancementSchedule> = {};
    const expectedThresholds: Partial<Record<EnhancementSchedule, number[]>> = {};
    let expectedDefault: EnhancementSchedule | null = null;
    let expectedTierEffectiveness: number[] | null = null;

    for (const entry of exportCurves.dim_returns) {
      const letter = scheduleOf(entry);
      expectedThresholds[letter] = entry.returns[0].tiers.map((t) => authored(t.start));
      const handicaps = entry.returns[0].tiers.map((t) => authored(t.handicap));
      if (expectedTierEffectiveness === null) expectedTierEffectiveness = handicaps;
      expect(handicaps).toEqual(expectedTierEffectiveness);
      if (entry.is_default) {
        expectedDefault = letter;
      } else {
        for (const boostType of entry.boost_types) expectedBoostTypes[boostType] = letter;
      }
    }

    expect(module.defaultSchedule).toBe(expectedDefault);
    expect(module.tierEffectiveness).toEqual(expectedTierEffectiveness);
    expect(module.boostTypeSchedules).toEqual(expectedBoostTypes);

    const moduleThresholds = Object.fromEntries(
      Object.entries(module.schedules).map(([letter, curve]) => [letter, curve.edThresholds]),
    );
    expect(moduleThresholds).toEqual(expectedThresholds);
  });

  it('strength curves equal the source tables on every player class (Melee and Ranged)', () => {
    const tablesDir = join(root, 'tables');
    let classesChecked = 0;
    for (const archetype of derivePlayerArchetypes(tablesDir)) {
      const filePath = join(tablesDir, `${archetype}.json`);
      const namedTables = readJson<{ named_tables: Record<string, number[]> }>(filePath).named_tables;
      classesChecked += 1;
      for (const curve of Object.values(module.schedules)) {
        expect(namedTables[curve.sourceTable]).toEqual(curve.strengthByBoostLevel);
        const rangedTwin = namedTables[curve.sourceTable.replace('Melee_', 'Ranged_')];
        expect(rangedTwin).toEqual(curve.strengthByBoostLevel);
      }
    }
    expect(classesChecked).toBeGreaterThanOrEqual(15);
  });

  it('boost_effectiveness curves are carried verbatim', () => {
    expect(module.boostEffectiveness).toEqual(exportCurves.boost_effectiveness);
  });

  it('origin tiers reproduce from the per-tier boost families, both directions', () => {
    // Independent re-derivation of the SW8 grid: walk every origin-family
    // piece, place its fScale in its (tier, schedule) cell, and require exact
    // equality with the module — extra module cells fail via toEqual just as
    // missing ones do. Deliberately re-implements segment -> schedule with the
    // engine-facing boost-type map rather than sharing converter code.
    const SEGMENT_BOOST_TYPE: Record<string, string | null> = {
      accuracy: null, confuse: null, damage: null, defense_debuff: null,
      drain_endurance: null, endurance_discount: null, fear: null, fly: null,
      heal: null, hold: null, immobilize: null, intangible: null, jump: null,
      recharge: null, recovery: null, run: null, sleep: null, snare: null,
      stun: null, taunt: null,
      range: 'Range', defense_buff: 'Buff_Defense', tohit_buff: 'Buff_ToHit',
      tohit_debuff: 'Debuff_ToHit', interrupt: 'Interrupt',
      knockback: 'Knockback', res_damage: 'Res_Damage',
    };
    // Outside the grid: cone (no engine aspect; game-side DO authoring is
    // two-valued) and the Going Rogue prestige pieces under generic_.
    const SKIPPED = new Set([
      'cone', 'clockwork_efficiency', 'might_of_the_empire',
      'resistance_tactics', 'syndicate_techniques', 'will_of_the_seers',
    ]);
    const ORIGIN_NAMES = new Set(['magic', 'mutation', 'natural', 'science', 'technology']);

    const grid: Record<string, Record<string, number>> = { TO: {}, DO: {}, SO: {} };
    const boostsDir = join(root, 'boosts');
    for (const dir of readdirSync(boostsDir)) {
      const parts = dir.split('_');
      let tier: 'TO' | 'DO' | 'SO';
      let segment: string;
      if (parts[0] === 'generic') {
        tier = 'TO';
        segment = parts.slice(1).join('_');
      } else if (ORIGIN_NAMES.has(parts[0])) {
        tier = ORIGIN_NAMES.has(parts[1]) ? 'DO' : 'SO';
        segment = parts.slice(tier === 'DO' ? 2 : 1).join('_');
      } else {
        continue;
      }
      if (SKIPPED.has(segment)) continue;
      expect(SEGMENT_BOOST_TYPE[segment], `${dir}: unknown origin segment`).not.toBeUndefined();
      const file = join(boostsDir, dir, `${dir}.json`);
      if (!existsSync(file)) continue;
      const piece = readJson<{
        effects?: Array<{ templates?: Array<{ aspect?: string; flags?: string[] | null; table?: string; scale?: number | null; attribs?: string[] }> }>;
      }>(file);
      const scales = new Set<number>();
      for (const effect of piece.effects ?? []) {
        for (const template of effect.templates ?? []) {
          if (template.aspect !== 'Strength') continue;
          if (template.flags != null && !template.flags.includes('Boost')) continue;
          if (template.table !== 'Melee_Ones') continue;
          if (template.scale == null) continue;
          if (template.attribs?.length === 1 && template.attribs[0] === 'Ones') continue;
          scales.add(authored(template.scale));
        }
      }
      if (scales.size === 0) continue;
      expect(scales.size, `${dir}: multiple enhancement scales`).toBe(1);
      const boostType = SEGMENT_BOOST_TYPE[segment];
      const schedule = boostType === null
        ? module.defaultSchedule
        : (module.boostTypeSchedules[boostType] ?? module.defaultSchedule);
      const scale = scales.values().next().value as number;
      if (schedule in grid[tier]) {
        expect(grid[tier][schedule], `${dir}: (${tier}, ${schedule}) cell not uniform`).toBe(scale);
      } else {
        grid[tier][schedule] = scale;
      }
    }
    expect(module.originTiers).toEqual(grid);
  });

  it('multi-aspect ladder equals the crafted-corpus modal census', () => {
    const boostsDir = join(root, 'boosts');
    const scalesBySegmentCount = new Map<number, Map<number, number>>();
    for (const dir of readdirSync(boostsDir)) {
      if (!dir.startsWith('crafted_')) continue;
      const file = join(boostsDir, dir, `${dir}.json`);
      if (!existsSync(file)) continue;
      const piece = readJson<{
        display_name?: string;
        effects?: Array<{ templates?: Array<{ aspect?: string; flags?: string[] | null; table?: string; scale?: number }> }>;
      }>(file);
      const displayName = piece.display_name ?? '';
      if (!displayName.includes(':')) continue;
      const scales = new Set<number>();
      for (const effect of piece.effects ?? []) {
        for (const template of effect.templates ?? []) {
          if (template.aspect !== 'Strength') continue;
          if (template.flags != null && !template.flags.includes('Boost')) continue;
          if (!/_(20|33|40|60)$/.test(template.table ?? '')) continue;
          scales.add(Math.round((template.scale ?? 0) * 1e5) / 1e5);
        }
      }
      if (scales.size !== 1) continue;
      const count = Math.min(displayName.split(':')[1].split('/').length, 4);
      const dist = scalesBySegmentCount.get(count) ?? new Map<number, number>();
      const scale = scales.values().next().value as number;
      dist.set(scale, (dist.get(scale) ?? 0) + 1);
      scalesBySegmentCount.set(count, dist);
    }

    const expectedLadder = [1, 2, 3, 4].map((count) => {
      const dist = scalesBySegmentCount.get(count);
      expect(dist, `no crafted pieces with ${count} name segments`).toBeDefined();
      const ranked = [...dist!.entries()].sort((a, b) => b[1] - a[1]);
      expect(
        ranked.length === 1 || ranked[0][1] > ranked[1][1],
        `${count}-aspect modal is ambiguous: ${JSON.stringify(ranked.slice(0, 3))}`,
      ).toBe(true);
      return ranked[0][0];
    });
    expect(module.multiAspectScale).toEqual(expectedLadder);
  });
});
