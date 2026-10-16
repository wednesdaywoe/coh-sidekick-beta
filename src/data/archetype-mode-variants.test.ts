import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { ARCHETYPES } from '@/data/archetypes';
import { getPowersetsForArchetype } from '@/data/powersets';
import type { Power } from '@/types';

/**
 * The export answers the form question, on every fork, for archetype powersets.
 *
 * This is the census the hand tables hid. Rebirth's Kheldian redirects were carried as a
 * community mapping captured 2026-05-04, standing in for a Parse6 `Redirect` table nobody had
 * parsed yet; Thunderspy's Primalist shells were carried as a generated-but-parallel silo. Both
 * outlived their reason — the parser produces `modeVariants` on all three forks now — and
 * neither had a gate that would go red when the export caught up, because a hand table and the
 * export agreeing is not something either side measures. data-gaps-299 retired them; this is what
 * stands in their place.
 *
 * `pool-epic-mode-gates.test.ts` pins the same field across pool and epic powers and states
 * that both forks are structurally zero there. That is true of POOLS, and it is exactly why
 * this file exists: the Kheldian and Primalist carriers live in archetype powersets, which that
 * sweep never walks. Read the two together — neither alone covers the field.
 *
 * WHAT THIS GATE CANNOT SEE, stated rather than assumed:
 *   - A RENAMED variant target. Mutation-tested and deliberately left uncaught: the engine's
 *     `with_mode_variant` skips `internalName` when it overlays (the effective power keeps the
 *     base's identity, which every projected value is keyed to) and takes the atoms carried on
 *     the variant itself, so the target name is evidence for a reader, not an input to a number.
 *     A gate that went red on it would be pinning a string nothing reads.
 *   - Whether a variant's NUMBERS are right. It grades the redirect table's shape and reach,
 *     not the atoms behind it; `serverParity` and the projection corpus own the magnitudes.
 *   - A mode published by `setsModes` that redirects nothing. That is a legitimate shape (Power
 *     Boost's `BoostPower`), so its absence here is not evidence of a defect.
 *   - Homecoming's Kheldian population being SMALL is correct, not a hole: HC grants Nova and
 *     Dwarf as whole powersets of separately-slottable attacks, so only the two always-available
 *     inherent attacks per AT are redirected. Rebirth redirects the human attacks instead. The
 *     per-fork totals below encode that difference deliberately.
 */

const DATASETS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;

/**
 * Carrier counts per fork, pinned in both directions.
 *
 * A drop means the parser stopped producing a `Redirect` table the planner reads; a rise means
 * a fork started redirecting something new and nobody looked. Either way the number moving is
 * the report. These are archetype powersets only — pools are the sibling gate's population.
 */
const EXPECTED_CARRIERS: Record<(typeof DATASETS)[number], number> = {
  // 4 Kheldian inherent attacks + 5 Titan Weapons Momentum + 2 Seismic Blast + Shadow Step.
  homecoming: 12,
  // 17 Kheldian human attacks — the population the retired community mapping covered — + 5
  // Titan Weapons. Rebirth redirects the human attacks rather than granting form powersets.
  rebirth: 22,
  // 7 Primalist form shells + 5 Titan Weapons.
  thunderspy: 12,
  // Homecoming's twelve, measured on the i28p4 beta: neither new powerset redirects,
  // so Sonic Aura and Light Affinity add no carrier.
  brainstorm: 12,
};

/**
 * These counts were read independently off the contract bundles the Rust engine loads
 * (`contract/<fork>/bundle.json.gz`) and off the generated TS powersets this gate walks, and
 * they agree fork for fork. Two producers, one census — so a number moving here is a change in
 * the export, not a divergence between the two consumers of it.
 */

/** The display fields the mode overlay replaces. A variant must publish at least one. */
const OVERLAY_FIELDS = [
  'stats',
  'damage',
  'effects',
  'shortHelp',
  'description',
  'effectArea',
  'targetType',
  'powerType',
] as const;

describe.each(DATASETS)('archetype mode variants — %s', (datasetId) => {
  /**
   * Every copy of every archetype power, grouped by SET-QUALIFIED name.
   *
   * `internalName` alone is not unique across archetypes: Rebirth's Guardian carries a
   * `Luminous_Assault.Gleaming_Bolt` that is a different power from the Peacebringer's
   * `Luminous_Blast.Gleaming_Bolt`, and only the latter redirects. Keying on the bare name read
   * the two as one power disagreeing with itself. The set's own base name — `setPath` after the
   * dot, which drops the archetype prefix — separates those two while keeping Titan Weapons'
   * five archetype copies together, which is exactly the grouping this check needs.
   */
  let copies = new Map<string, Power[]>();
  let carriers: Power[] = [];

  beforeAll(async () => {
    await loadDataset(datasetId);
    copies = new Map();
    for (const set of Object.keys(ARCHETYPES).flatMap((id) => getPowersetsForArchetype(id))) {
      for (const power of set.powers) {
        const base = (set.setPath ?? set.id ?? '').split(/[./]/).pop() ?? '';
        const name = power.internalName ?? power.name;
        if (!name) continue;
        const key = `${base}.${name}`;
        const group = copies.get(key);
        if (group) group.push(power);
        else copies.set(key, [power]);
      }
    }
    carriers = [...copies.values()]
      .map((group) => group.find((p) => p.modeVariants && Object.keys(p.modeVariants).length > 0))
      .filter((p): p is Power => !!p);
  }, 120_000);

  it('carries the fork\'s redirect population, no more and no less', () => {
    const census = carriers
      .map((p) => `${p.internalName}:${Object.keys(p.modeVariants ?? {}).join('+')}`)
      .sort();
    console.log(`[mode-variants] ${datasetId} carriers=${carriers.length}\n  ${census.join('\n  ')}`);
    expect(carriers.length, `${datasetId} archetype modeVariants carriers`)
      .toBe(EXPECTED_CARRIERS[datasetId]);
  });

  /**
   * A shared power's redirect table must reach every archetype that gets the power.
   *
   * Titan Weapons is on five ATs and Momentum redirects the same five attacks on all of them,
   * so one AT's copy losing the table is drift, not data. Without this the census above cannot
   * see it: it takes the first copy that carries the table and never looks at the rest, which
   * is precisely how a mutation that stripped one AT's copy rode through green.
   */
  it('every archetype that gets a redirecting power gets the same table', () => {
    for (const [name, group] of copies) {
      const tables = group.map((p) => Object.keys(p.modeVariants ?? {}).sort().join('+'));
      const distinct = [...new Set(tables)];
      expect(distinct.length, `${name}: ${group.length} copies disagree — ${distinct.join(' | ')}`)
        .toBe(1);
    }
  });

  it('every variant is a real redirect target, not a copy of its base', () => {
    for (const power of carriers) {
      for (const [mode, variant] of Object.entries(power.modeVariants ?? {})) {
        expect(mode, `${power.internalName} mode key`).toMatch(/\S/);
        expect(variant.internalName, `${power.internalName}/${mode} target`).toBeTruthy();
        expect(variant.internalName, `${power.internalName}/${mode} redirects to itself`)
          .not.toBe(power.internalName);
      }
    }
  });

  it('every variant publishes something for the overlay to show', () => {
    for (const power of carriers) {
      for (const [mode, variant] of Object.entries(power.modeVariants ?? {})) {
        const published = OVERLAY_FIELDS.filter((f) => variant[f] !== undefined);
        expect(published.length, `${power.internalName}/${mode} publishes no display field`)
          .toBeGreaterThan(0);
      }
    }
  });
});
