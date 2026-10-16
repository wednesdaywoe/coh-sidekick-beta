/**
 * The output mapper must fold EVERY per-source ledger the engine files.
 *
 * The engine grew its provenance ledgers (per-power, incarnate, stealth) after the beta swapped
 * onto it, and `engineTotals` kept reading only the four it knew about. Nothing failed: the
 * totals were right, `mapSetBonusBreakdown` still populated the map, and every breakdown panel
 * rendered — showing set bonuses and nothing else. An armour toggle's Defense and Resistance,
 * which is most of what a breakdown exists to explain, silently had no row.
 *
 * A test of the mapper's own arithmetic could not have caught that: each `add*Breakdown` was
 * correct about the ledger it was given. The missing fact was that a ledger existed and was not
 * being read, so this test asks the ENGINE what it filed and then checks the map against it —
 * a ledger added tomorrow and left unfolded turns this red on the first run.
 *
 * Runs on the wasm-node target, like `serverParity`, and through `engineCalculate` itself so it
 * grades the path the browser takes rather than a second assembly of it.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDataset } from '@/data/dataset';
import { getArchetype, STANDARD_ARCHETYPE_IDS } from '@/data/archetypes';
import { getPowersetsForArchetype } from '@/data/powersets';
import { getAllIncarnateSlots } from '@/data/incarnates';
import { getAccolades, accoladeId } from '@/data/accolades';
import { getAvailableGenericIOs, createGenericIOEnhancement } from '@/data/enhancement-registry';
import { withoutIllegalSlots } from '@/utils/build-enhancement-validation';
import { createEmptyBuild } from '@/types/build';
import { engineCalculate } from './engineTotals';
import { toCharacterStateJson, type AdapterCalcContext } from './characterStateAdapter';
import type { EngineTotals } from './engineTotalsMap';
import type { Build } from '@/types/build';
import type { Power, SelectedPower } from '@/types/power';
import type { StatSource } from '@/utils/calculations';

const require = createRequire(import.meta.url);

const SERVERS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;
type Server = (typeof SERVERS)[number];

const NODE_ENGINE = join(__dirname, 'wasm-node', 'coh_wasm.cjs');
const BUNDLE_DIR = join(__dirname, '..', '..', 'public', 'engine', 'contract');
const artifactsReady =
  existsSync(NODE_ENGINE) && SERVERS.every((s) => existsSync(join(BUNDLE_DIR, `${s}.json.gz`)));

type EngineHandle = { recalculate: (json: string) => string };
const nodeEngine = artifactsReady
  ? (require('./wasm-node/coh_wasm.cjs') as { load_dataset: (bytes: Uint8Array) => EngineHandle })
  : null;

const handles = new Map<Server, EngineHandle>();
function engineHandle(server: Server): EngineHandle {
  const cached = handles.get(server);
  if (cached) return cached;
  const handle = nodeEngine!.load_dataset(new Uint8Array(readFileSync(join(BUNDLE_DIR, `${server}.json.gz`))));
  handles.set(server, handle);
  return handle;
}

// The defaults the totals hook passes when the UI supplies no options.
const CTX: AdapterCalcContext = {
  exemplarMode: false,
  exemplarLevel: 50,
  incarnateActive: { alpha: true, destiny: true, hybrid: true, interface: true, judgement: true, lore: true, genesis: true },
  incarnateLevelShift: null,
  targetsHitValues: {},
  targetLevelOffset: 0,
  vigilanceTeamSize: 0,
  furyLevel: 75,
  combatMode: false,
  destinyTime: null,
  hybridTargetsHit: null,
  globalAdjusters: {},
  mechanicAdjusters: {},
  dominationActive: false,
  stalkerHidden: false,
  whatIfBuffs: {},
};

/** An armoured build, assembled from the fork's own registries (no proper nouns, Rule 0): the
 *  first standard archetype whose primary set is defensive, every power it can hold at 50
 *  switched on and slotted with valid generic IOs. Drives the per-power ledger hard — armour
 *  toggles are exactly the contributions the regression hid. */
function buildFor(server: Server, atId: string): Build {
  const build = createEmptyBuild(server);
  build.level = 50;
  const at = getArchetype(atId as Parameters<typeof getArchetype>[0]);
  build.archetype = { id: atId, name: at?.name ?? atId, stats: null, inherent: null } as Build['archetype'];

  const setsFor = (category: string) =>
    getPowersetsForArchetype(atId as Parameters<typeof getPowersetsForArchetype>[0]).filter(
      (ps) => (ps.category ?? '').toLowerCase() === category && !ps.dormant,
    );
  const selectFrom = (powersetId: string, powers: Power[]): SelectedPower[] =>
    powers
      .filter((p) => p.available >= 0 && p.available < 50)
      .map((p) => ({
        ...p,
        powerSet: powersetId,
        level: p.available + 1,
        slots: getAvailableGenericIOs(p).slice(0, 3).map((stat) => createGenericIOEnhancement(stat, 50)),
        isActive: p.powerType === 'Toggle' || p.powerType === 'Auto',
      }));

  const primary = setsFor('primary')[0];
  const secondary = setsFor('secondary')[0];
  if (primary) build.primary = { id: primary.id!, name: primary.name, powers: selectFrom(primary.id!, primary.powers) };
  if (secondary) build.secondary = { id: secondary.id!, name: secondary.name, powers: selectFrom(secondary.id!, secondary.powers) };

  // Accolades are the ledger's third `kind`, and the only contributors the build stores as bare
  // ids rather than as picked powers — which is what made their rows fall back to the internal
  // name until the resolver learned to read the registry. Every toggle the fork offers: the
  // hero/villain gates are the game's, and the planner lets each stand alone (data-gaps-44).
  build.accolades = getAccolades().map(accoladeId);

  // One incarnate per slot the fork offers, top tier of the first tree — the incarnate ledger is
  // the second of the three that went unread, and it files nothing on an unslotted build.
  for (const slot of getAllIncarnateSlots()) {
    const tree = slot.trees[0];
    const power = tree?.powers[tree.powers.length - 1];
    if (!power) continue;
    build.incarnates[slot.id] = {
      slotId: slot.id,
      powerId: power.id,
      powerName: power.fullName,
      displayName: power.displayName,
      icon: power.icon,
      tier: power.tier,
      treeId: power.treeId,
      treeName: tree.name,
    };
  }
  return withoutIllegalSlots(build);
}

/** Every ledger row the engine filed, flattened to `(key, value)` — what the map must contain a
 *  source for. Read from the engine's OWN output, so a ledger this file has never heard of still
 *  shows up here and turns the coverage check red. */
function engineLedgerRows(totals: EngineTotals): { key: string; value: number }[] {
  const arrays: { key: string; value: number }[][] = [
    totals.proc_breakdown.map((r) => ({ key: r.breakdown_key, value: r.value })),
    totals.buff_pet_breakdown.map((r) => ({ key: r.breakdown_key, value: r.value })),
    totals.movement_breakdown.map((r) => ({ key: r.breakdown_key, value: r.value })),
    totals.stealth_breakdown.map((r) => ({ key: r.breakdown_key, value: r.value })),
    totals.power_breakdown.map((r) => ({ key: r.breakdown_key, value: r.value })),
    totals.incarnate_breakdown.map((r) => ({ key: r.breakdown_key, value: r.value })),
  ];
  return arrays.flat();
}

/** Sum by key. */
function sumByKey(rows: { key: string; value: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.key, (out.get(row.key) ?? 0) + row.value);
  return out;
}

// The engine computes in f32; summing widened f32s in a different order than the engine added
// them leaves error in the hundredths on totals in the hundreds.
const TOLERANCE = 0.05;

/** The armoured build for this fork: the standard archetype that files BOTH defense and
 *  resistance rows, and the most rows overall among those that do — chosen by asking the ENGINE
 *  rather than by naming an archetype, so a fork with a different roster still gets a fixture the
 *  def/res assertion can grade.
 *
 *  Both halves have to be scored, not their sum. Scoring the combined count picked a set with ten
 *  defense keys and no resistance at all on one fork, and the resistance half of the assertion
 *  then passed over an empty group. */
function armouredBuild(server: Server): { build: Build; totals: EngineTotals } {
  let best: { build: Build; totals: EngineTotals; score: [number, number] } | null = null;
  for (const atId of STANDARD_ARCHETYPE_IDS) {
    const build = buildFor(server, atId);
    const totals = JSON.parse(engineHandle(server).recalculate(toCharacterStateJson(build, CTX))) as EngineTotals;
    const keys = new Set(totals.power_breakdown.map((r) => r.breakdown_key));
    const both = [...keys].some((k) => k.startsWith('def')) && [...keys].some((k) => k.startsWith('res'));
    const score: [number, number] = [both ? 1 : 0, totals.power_breakdown.length];
    if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
      best = { build, totals, score };
    }
  }
  return best!;
}

const suite = artifactsReady ? describe : describe.skip;
if (!artifactsReady) {
  // eslint-disable-next-line no-console
  console.warn('[breakdown ledger fold] skipped — engine artifacts absent; run `npm run build:engine`.');
}

suite('the breakdown map folds every engine ledger', () => {
  for (const server of SERVERS) {
    describe(server, () => {
      let totals: EngineTotals;
      let sources: Map<string, StatSource[]>;

      beforeAll(async () => {
        await loadDataset(server);
        const fixture = armouredBuild(server);
        totals = fixture.totals;
        const result = engineCalculate(fixture.build, CTX);
        expect(result, 'engineCalculate returned null — dataset not loaded').not.toBeNull();
        sources = new Map(
          [...result!.breakdown].map(([key, entry]) => [key, entry.sources.filter((s) => s.type !== 'set-bonus')]),
        );
      });

      it('carries one source per ledger row, with the row value intact', () => {
        const expected = sumByKey(engineLedgerRows(totals));
        expect(expected.size, 'the engine filed no ledger rows at all — the fixture is not exercising the calc').toBeGreaterThan(0);

        const missing: string[] = [];
        for (const [key, total] of expected) {
          const got = (sources.get(key) ?? []).reduce((sum, s) => sum + s.value, 0);
          if (Math.abs(got - total) > TOLERANCE) missing.push(`${key}: engine ${total} vs breakdown ${got}`);
        }
        expect(missing).toEqual([]);
      });

      it('files nothing the engine did not', () => {
        const known = sumByKey(engineLedgerRows(totals));
        const orphans = [...sources].filter(([key, rows]) => rows.length > 0 && !known.has(key)).map(([key]) => key);
        expect(orphans).toEqual([]);
      });

      it('is not grading an empty fixture', () => {
        // The coverage check above is satisfied by "no rows, no sources", so the two ledgers this
        // build is built to exercise have to be shown non-empty or it proves nothing.
        expect(totals.power_breakdown.length).toBeGreaterThan(0);
        expect(totals.incarnate_breakdown.length).toBeGreaterThan(0);
        const types = new Set([...sources.values()].flat().map((s) => s.type));
        expect([...types].sort()).toEqual(expect.arrayContaining(['active-power', 'incarnate']));
      });

      it('labels every source with a display name, not an internal one', () => {
        // A row the resolver cannot place falls back to the raw internal name — readable enough
        // to pass a reviewer's eye ("The_Atlas_Medallion") and wrong on screen. Accolades are the
        // case that actually failed, so they get the exact check; the rest get the tell.
        const accoladeNames = new Set(getAccolades().map((p) => p.name));
        const rows = [...sources.values()].flat();
        const accolades = rows.filter((s) => s.type === 'accolade');
        expect(accolades.length).toBeGreaterThan(0);
        expect(accolades.filter((s) => !accoladeNames.has(s.name))).toEqual([]);
        expect(rows.filter((s) => s.type === 'active-power' && s.name.includes('_'))).toEqual([]);
      });

      it('explains defense and resistance with active-power rows', () => {
        // The regression's own shape: set bonuses survived, power contributions vanished. On an
        // armour build every def/res total is carried by toggles, so an empty active-power group
        // here is the bug, not a thin fixture.
        const activePowerKeys = [...sources]
          .filter(([, rows]) => rows.some((s) => s.type === 'active-power'))
          .map(([key]) => key);
        expect(activePowerKeys.some((k) => k.startsWith('def'))).toBe(true);
        expect(activePowerKeys.some((k) => k.startsWith('res'))).toBe(true);
      });
    });
  }
});
