import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IO_SET_CATEGORIES } from '@/types/common';
import { CATEGORY_PRIORITY } from './enhancement-registry';
import { IO_SETS_RAW as HOMECOMING } from './datasets/homecoming/io-sets-raw';
import { IO_SETS_RAW as REBIRTH } from './datasets/rebirth/io-sets-raw';
import { IO_SETS_RAW as THUNDERSPY } from './datasets/thunderspy/io-sets-raw';

/**
 * Slotting reach: can the picker actually offer every set the fork ships?
 *
 * A set is offered by a power when the set's `type` string equals one of the
 * power's `allowedSetCategories` strings. Both are the same binary field —
 * `BoostSet.GroupName`, the heading the client itself groups by — but they travel
 * to the planner down two different paths: the set's through the IO-sets extractor,
 * the power's through the bin exporter's reversed category index. Nothing else
 * compares them, so a set whose `type` no power lists simply never appears, in
 * silence, with every other guard green.
 *
 * That is how data-gaps-40 sat open: four Thunderspy sets — Overwhelming Force, Subaluwa
 * and both Primalist ATOs — reached no power at all, and the labels on 25 more were
 * Homecoming's spelling of a heading Thunderspy renames. The two arms agreed with
 * each other while both disagreed with the game, which is why a same-derivation
 * cross-check could not see it; this one joins the two shipped artifacts instead.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DATASETS = [
  ['homecoming', HOMECOMING],
  ['rebirth', REBIRTH],
  ['thunderspy', THUNDERSPY],
] as const;

/**
 * Every distinct `allowedSetCategories` string in a dataset's generated tree.
 *
 * The whole tree, not just `powersets/` — pools, epics and inherents carry the field
 * too, and a scope that stopped at powersets would call Rebirth's Inexhaustibility
 * reachable on the strength of a category only `Inherent.Inherent.Rest` states.
 */
function offeredCategories(dataset: string): Set<string> {
  const root = path.join(HERE, 'datasets', dataset, 'generated');
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const text = fs.readFileSync(full, 'utf8');
        for (const block of text.matchAll(/"allowedSetCategories":\s*\[([^\]]*)\]/gs)) {
          for (const m of block[1].matchAll(/"([^"]+)"/g)) found.add(m[1]);
        }
      }
    }
  };
  walk(root);
  return found;
}

describe.each(DATASETS)('IO set slotting reach — %s', (dataset, registry) => {
  const offered = offeredCategories(dataset);
  const sets = Object.entries(registry);

  it('the powers offer at least one category (the sweep is reading something)', () => {
    expect(offered.size).toBeGreaterThan(20);
    expect(sets.length).toBeGreaterThan(200);
  });

  // Empty on every fork, and Rebirth's entry going away is the point.
  //
  // Inexhaustibility is a one-piece Rebirth enhancement whose whole allowed-powers
  // list is `Inherent.Inherent.Rest`, and its heading had no host because the
  // planner's Rest was a hand-written entry that stated no set categories at all.
  // Rebirth's export states `allowed_set_categories: ["Rest Buff"]` on that very
  // record, so sourcing Rest gave the heading its host (data-gaps-33). data-gaps-38 was
  // closed by decision — "Rest stays unmodeled" — and the decision is now moot.
  //
  // Kept as an empty allowlist rather than deleted: a set the picker can never
  // show is worth naming if one ever appears again.
  const NO_HOST_POWER: Record<string, string[]> = {
    homecoming: [],
    rebirth: [],
    thunderspy: [],
  };

  it('every set is offered by some power — no set the picker can never show', () => {
    const unreachable = sets
      .filter(([, set]) => !offered.has(set.type))
      .map(([id, set]) => `${id} (type ${JSON.stringify(set.type)})`)
      .sort();
    expect(unreachable).toEqual(NO_HOST_POWER[dataset]);
  });

  it('every offered category is a heading some set on this fork carries', () => {
    // Clean since data-gaps-39 closed: the pool and epic converters used to answer
    // `allowed_set_categories: null` with an inference heuristic written in
    // Homecoming's vocabulary, which on the forks named headings no set there
    // carries ("Melee AoE Damage" from Rebirth's Psionic Tornado).
    const setTypes = new Set(sets.map(([, set]) => set.type));
    expect([...offered].filter((c) => !setTypes.has(c)).sort()).toEqual([]);
  });

  it('both sides speak the shared category vocabulary', () => {
    const known = new Set<string>(IO_SET_CATEGORIES);
    expect([...new Set(sets.map(([, s]) => s.type))].filter((t) => !known.has(t)).sort()).toEqual([]);
    expect([...offered].filter((c) => !known.has(c)).sort()).toEqual([]);
  });

  it('the picker can order every heading it will be handed', () => {
    // A heading missing from CATEGORY_PRIORITY never becomes a power's default
    // sidebar filter, which is the same silence the retired lookup table produced.
    const ordered = new Set<string>(CATEGORY_PRIORITY);
    expect([...new Set(sets.map(([, s]) => s.type))].filter((t) => !ordered.has(t)).sort()).toEqual([]);
  });
});

/**
 * The half the heading-join above cannot see: a converter that invents a REAL
 * heading for a power the game lists in no set offers genuine sets where the
 * game refuses them, and every category still matches something. That was
 * data-gaps-39's actual damage — Teleport sets in Jaunt, Healing sets in Rebirth's
 * Hoarfrost — 33 pool/epic powers across the forks, none of them visible to
 * the reach sweep. So this joins the generated pool/epic categories back to
 * the export: a power offers set categories only if its own
 * `allowed_set_categories` (boostsets.bin reversed) grants them.
 */
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

describe("Thunderspy's four unreachable sets (the data-gaps-40 cases)", () => {
  const offered = offeredCategories('thunderspy');

  // Named individually because the sweep above would still pass if the extractor
  // dropped these records altogether rather than mistyping them — an absent set is
  // trivially not unreachable.
  it.each([
    ['overwhelming_force', 'Universal Damage Sets'],
    ['kb', 'Universal Damage Sets'],
    ['primalists_nature', 'Primalist Archetype Sets'],
    ['superior_primalists_nature', 'Primalist Archetype Sets'],
  ])('%s is present, typed %s, and offered by a power', (setId, type) => {
    expect(THUNDERSPY[setId]?.type).toBe(type);
    expect(offered.has(type)).toBe(true);
  });
});

describe('fork category spellings', () => {
  // Homecoming and the forks name four headings differently. Both spellings are
  // real; pinning them keeps a future "tidy-up" from collapsing one into the other
  // and silently unslotting nine sets on two forks.
  it.each([
    ['Melee AoE Damage', 'PBAoE Damage', 'cleaving_blow'],
    ['Ranged AoE Damage', 'Targeted AoE Damage', 'positrons_blast'],
    ['Threat Duration', 'Taunt', 'mocking_beratement'],
  ])('Homecoming says %s where the forks say %s', (hcName, forkName, setId) => {
    expect(HOMECOMING[setId]?.type).toBe(hcName);
    expect(REBIRTH[setId]?.type).toBe(forkName);
    expect(THUNDERSPY[setId]?.type).toBe(forkName);
  });
});

/**
 * The class rather than the instance: a heading vocabulary is complete or it is absent.
 *
 * The three cases above each grade one *named* list — `IO_SET_CATEGORIES`,
 * `CATEGORY_PRIORITY` — and are blind to a fourth list nobody thought to name here.
 * The twin carried exactly that: an `IO_SET_TYPE_TO_CATEGORY` keyed by heading and
 * mapping all 56 to themselves, interposed between a set's `type` and a power's
 * category by `getIOSetsForCategory`, `getIOSetsForPower`, the set-bonus lookup modal
 * and the proc-potential scorer. It agreed with the data on every row, so no test
 * could have caught it by value — but it answered `undefined` for a heading it had
 * not been told about, and a heading it has not been told about is exactly what the
 * next fork ships. That is data-gaps-40's failure mode rebuilt, waiting for the data to
 * move.
 *
 * So this grades no particular list. Any export keyed by slotting headings is a
 * vocabulary, and a vocabulary that is missing one is a silent drop — including one
 * added after this file was written.
 *
 * Which is the point: its first run found a third list, in this repo, that the twin
 * had nothing to do with. `SET_CATEGORY_TO_ENHANCEMENT` in `enhancement-registry.ts`
 * stated 53 of the 56 — no Guardian Archetype Sets, no Rest Buff, no Universal
 * Control Duration Sets — behind a reader that answered `|| []`, so those three
 * headings reported that nothing enhances them. It had no consumer left, and its own
 * comments called it a fallback superseded by the binary, so it was deleted rather
 * than completed; hardcoding the three missing rows would have been the Rule 0 breach
 * the table already was.
 */
describe('every heading vocabulary in the data layer is complete', () => {
  const HEADINGS = new Set<string>(IO_SET_CATEGORIES);

  /**
   * A record keyed by headings, or an array of them.
   *
   * Keyed by *most* of its keys being headings, not by a count of them: several
   * headings are also enhancement stat names, so `STAT_ICON_MAP` matches nine of
   * the 56 while being no kind of slotting vocabulary. A real one is all headings
   * (both live lists are 56 of 56); the overlap tops out at a third.
   */
  function headingKeys(value: unknown): string[] | null {
    let keys: string[];
    if (Array.isArray(value)) {
      if (!value.every((v) => typeof v === 'string')) return null;
      keys = value as string[];
    } else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      keys = Object.keys(value);
    } else {
      return null;
    }
    if (!keys.length) return null;
    return keys.filter((k) => HEADINGS.has(k)).length / keys.length > 0.5 ? keys : null;
  }

  it('and there are some, so the sweep is not vacuously green', async () => {
    const found = await headingVocabularies();
    expect(found.map(([name]) => name).sort()).toEqual(['CATEGORY_PRIORITY', 'IO_SET_CATEGORIES']);
  });

  it('each states all 56 headings, so none can answer `undefined` for a real set', async () => {
    for (const [name, keys] of await headingVocabularies()) {
      const missing = [...HEADINGS].filter((h) => !keys.includes(h)).sort();
      expect(missing, `${name} is missing headings a fork's sets carry`).toEqual([]);
    }
  });

  async function headingVocabularies(): Promise<[string, string[]][]> {
    const mods: [string, Record<string, unknown>][] = [
      ['@/types/common', await import('@/types/common')],
      ['@/data/io-sets', await import('./io-sets')],
      ['@/data/enhancement-registry', await import('./enhancement-registry')],
    ];
    const found: [string, string[]][] = [];
    for (const [, mod] of mods) {
      for (const [name, value] of Object.entries(mod)) {
        const keys = headingKeys(value);
        if (keys) found.push([name, keys]);
      }
    }
    return found;
  }
});
