import { describe, it, expect, beforeAll } from 'vitest';
import type { DatasetId } from '@/data/dataset';
import { loadDataset, isHomecomingGame } from './dataset';
import { getAccolades, accoladeId, accoladeFaction, accoladeRequiredModes } from './accolades';
import { maxEndBuffValue, maxHPBuffValue } from './core/atom-query';
import type { AccoladePower } from './accolades';

// The derived +Max HP (% — 10 per scale point, IgnoreStrength) and +Max End (flat) an
// accolade grants, read off the power exactly as the totals calc reads it. This is the
// fidelity claim: the values come from the exported atoms, not the removed hand-built silo.
// Both halves ask the atoms. `endFlat` read `effects.maxEndBuff` until the bag strip, which
// left it 0 on every row while the expected table below stayed right.
function statOf(power: AccoladePower): { hpPct: number; endFlat: number } {
  const hp = maxHPBuffValue(power, { ignoreStrength: true });
  const hpPct = hp === undefined ? 0 : (typeof hp === 'number' ? hp : hp.scale) * 10;
  const end = maxEndBuffValue(power);
  const endFlat = end === undefined ? 0 : (typeof end === 'number' ? end : end.scale);
  return { hpPct, endFlat };
}

describe('accolades derived from the exported Accolades powerset', () => {
  let byId: Map<string, AccoladePower>;
  beforeAll(async () => {
    await loadDataset('homecoming');
    byId = new Map(getAccolades().map((p) => [accoladeId(p), p]));
  });

  it('surfaces the obtainable stat accolades the beta silo dropped', () => {
    // Labyrinth Conqueror and Mazebreaker are genuinely earned (Labyrinth of Fog), so they stay.
    for (const id of ['labyrinth_conqueror', 'mazebreaker']) {
      expect(byId.has(id), id).toBe(true);
    }
  });

  it('excludes the unobtainable accolades the export still carries', () => {
    // Super Patriot and Iron Man are awarded by no badge and granted through no path in any
    // dataset, so they must not be offered even though they match the stat-toggle shape.
    for (const id of ['iron_man', 'super_patriot']) {
      expect(byId.has(id), id).toBe(false);
    }
  });

  it('excludes click/travel/summon accolades (no +Max HP/End buff)', () => {
    for (const id of ['eye_of_the_magus', 'long_range_teleport', 'portable_workbench']) {
      expect(byId.has(id), id).toBe(false);
    }
  });

  it.each([
    // id                        hpPct  endFlat   note
    ['the_atlas_medallion',        0,     5], //  hero  +5 End
    ['freedom_phalanx_reserve',   10,     0], //  hero  +10% HP
    ['task_force_commander',       5,     0], //  hero  +5% HP
    ['portal_jockey',              5,     5], //  hero  +5% HP +5 End
    ['marshall',                   0,     5], //  villain +5 End ONLY (silo faked a +5% HP)
    ['born_in_battle',             5,     5], //  villain +5% HP +5 End (silo DROPPED the HP)
    ['high_pain_threshold',       10,     0], //  villain +10% HP
    ['invader',                    5,     0], //  villain +5% HP
    ['labyrinth_conqueror',        5,     5], //  any    +5% HP +5 End
    ['mazebreaker',                0,     5], //  any    +5 End
  ])('%s grants +%i%% HP, +%i End', (id, hpPct, endFlat) => {
    const power = byId.get(id as string);
    expect(power, id as string).toBeDefined();
    expect(statOf(power!)).toEqual({ hpPct, endFlat });
  });

  it('reads faction from the activateRequires gate', () => {
    expect(accoladeFaction(byId.get('the_atlas_medallion')!)).toBe('hero');
    expect(accoladeFaction(byId.get('marshall')!)).toBe('villain');
    expect(accoladeFaction(byId.get('mazebreaker')!)).toBe('any');
  });

  // The shipped gates are all a bare `type char> <faction> eq`, on which a substring search of
  // the joined text agrees with the token-pair read on every row — so the corpus cannot tell a
  // correct reader from a lucky one. These are the violating cases the data does not contain:
  // the faction word present but NOT as the operand `eq` consumes. Joining is for asking a
  // question, never for re-splitting one (COND-8).
  it.each([
    [['type', 'char>', 'villain', 'eq', 'hero', 'teamup', 'neq'], 'villain'],
    [['type', 'char>', 'hero', 'neq'], 'any'],
    [['zone', 'name>', 'hero_hideout', 'streq'], 'any'],
  ])('%s reads as %s', (gate, expected) => {
    expect(accoladeFaction({ activateRequires: gate } as AccoladePower)).toBe(expected);
  });
});

// The silo's defining error was not any single magnitude — it was serving ONE curated list to
// every fork. Membership is per-fork data, so it gets a per-fork census: the Labyrinth of Fog
// pair is Homecoming's alone, and a fork that grows or drops a stat accolade reds this rather
// than silently shipping another server's roster.
describe('the accolade roster is each fork\'s own', () => {
  const EXPECTED: Record<string, string[]> = {
    homecoming: [
      'the_atlas_medallion', 'freedom_phalanx_reserve', 'task_force_commander',
      'portal_jockey', 'marshall', 'high_pain_threshold', 'born_in_battle', 'invader',
      'labyrinth_conqueror', 'mazebreaker',
    ],
    rebirth: [
      'the_atlas_medallion', 'freedom_phalanx_reserve', 'task_force_commander',
      'portal_jockey', 'marshall', 'high_pain_threshold', 'born_in_battle', 'invader',
    ],
    // Brainstorm is the Homecoming install one shard over, so it carries Homecoming's
    // accolades — the Labyrinth pair included. Written out rather than aliased to the entry
    // above: this table exists to catch a fork silently shipping another server's roster,
    // and an alias would make that impossible to see for the one pair that differs.
    brainstorm: [
      'the_atlas_medallion', 'freedom_phalanx_reserve', 'task_force_commander',
      'portal_jockey', 'marshall', 'high_pain_threshold', 'born_in_battle', 'invader',
      'labyrinth_conqueror', 'mazebreaker',
    ],
    thunderspy: [
      'the_atlas_medallion', 'freedom_phalanx_reserve', 'task_force_commander',
      'portal_jockey', 'marshall', 'high_pain_threshold', 'born_in_battle', 'invader',
    ],
  };

  it.each(Object.keys(EXPECTED))('%s offers exactly its own stat accolades', async (dataset) => {
    await loadDataset(dataset as DatasetId);
    expect(getAccolades().map(accoladeId).sort()).toEqual([...EXPECTED[dataset]].sort());
  });

  // The accolade converter was the fourth tree to call `assignModes` and the last to get it,
  // so `modesRequired` read empty on every accolade and the two zone-gated ones presented as
  // permanent buffs. The gather folds them into the totals either way, so the picker's warning
  // is the only thing that says the buff is conditional — which makes an empty read here a
  // silent wrong number, not a missing feature.
  it('carries the zone gate the game states on the Labyrinth pair', async () => {
    await loadDataset('homecoming');
    const byName = new Map(getAccolades().map((p) => [accoladeId(p), p]));
    for (const id of ['labyrinth_conqueror', 'mazebreaker']) {
      expect(byName.get(id)!.modesRequired, id).toEqual(['InLabyrinth']);
      expect(accoladeRequiredModes(byName.get(id)!), id).toEqual(['In Labyrinth']);
    }
  });

  it('gates no other accolade on any fork', async () => {
    for (const fork of ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const) {
      await loadDataset(fork);
      const gated = getAccolades()
        .filter((p) => accoladeRequiredModes(p).length > 0)
        .map(accoladeId)
        .sort();
      // The Labyrinth pair is the Homecoming GAME's, so both its rings gate; the other
      // two forks have no Labyrinth of Fog and gate nothing.
      expect(gated, fork).toEqual(
        isHomecomingGame(fork) ? ['labyrinth_conqueror', 'mazebreaker'] : [],
      );
    }
  });

  it('the Labyrinth of Fog pair is the Homecoming game\'s, on both its rings', () => {
    for (const fork of ['rebirth', 'thunderspy']) {
      expect(EXPECTED[fork]).not.toContain('labyrinth_conqueror');
      expect(EXPECTED[fork]).not.toContain('mazebreaker');
    }
    expect(EXPECTED.homecoming).toContain('labyrinth_conqueror');
    expect(EXPECTED.homecoming).toContain('mazebreaker');
  });
});
