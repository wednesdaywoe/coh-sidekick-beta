import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { PET_ENTITIES } from '@/data/pet-entities';
import { PET_TABLES } from '@/data/at-tables';
import { getArchetype } from '@/data/archetypes';
import { getPetClassStats, getPetBaseStats, getPetClassAttribs } from './pet-stats';

/**
 * A pet's own character stats (COH-DATA-MODEL §6).
 *
 * Two things are load-bearing here and they fail in opposite directions:
 *
 *  1. COVERAGE — every class a summon actually declares must resolve. The pet
 *     class list used to be hardcoded to Homecoming's spellings, so on Rebirth
 *     and Thunderspy `minion_henchman` / `lt_praetoriangrunt` / `boss_henchman`
 *     were absent from PET_TABLES entirely. That is not a visible error: it
 *     reads as a Mastermind henchman that deals no damage and has no hit
 *     points. The gate below is per dataset for exactly that reason — the two
 *     forks that were broken are the two a Homecoming-only test can't see.
 *
 *  2. PROVENANCE — the numbers must come from the PET's class row, never the
 *     caster's archetype. A Bruiser caps resistance at 90% and its Mastermind
 *     at 75%; reading the caster's row would put the wrong ceiling on the pet
 *     and, worse, invites the reverse mistake of putting a pet stat on the
 *     character sheet.
 */

const DATASETS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;

const declaredClasses = (): Map<string, string[]> => {
  const byClass = new Map<string, string[]>();
  for (const [name, entity] of Object.entries(PET_ENTITIES)) {
    const list = byClass.get(entity.characterClass) ?? [];
    list.push(name);
    byClass.set(entity.characterClass, list);
  }
  return byClass;
};

describe.each(DATASETS)('pet class stats (%s)', (datasetId) => {
  beforeAll(async () => {
    await loadDataset(datasetId);
  });

  it('resolves a stat block for every class a summon declares', () => {
    const byClass = declaredClasses();
    expect(byClass.size, 'no pet entities loaded — fixture is not exercising anything').toBeGreaterThan(5);

    const unresolved = [...byClass.entries()]
      .filter(([cls]) => getPetClassStats(cls, 50) === null)
      .map(([cls, names]) => `${cls} (${names.length} entities, e.g. ${names[0]})`);

    expect(unresolved).toEqual([]);
  });

  it('gives every class a positive, level-increasing hit point curve', () => {
    const bad: string[] = [];
    for (const cls of declaredClasses().keys()) {
      const l1 = getPetClassStats(cls, 1);
      const l50 = getPetClassStats(cls, 50);
      if (!l1 || !l50) continue; // the coverage test above owns this failure
      if (!(l1.hitPoints > 0) || !(l50.hitPoints > l1.hitPoints)) {
        bad.push(`${cls}: ${l1.hitPoints} -> ${l50.hitPoints}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('clamps past the end of the table rather than reading off it', () => {
    const l50 = getPetClassStats('minion_pets', 50);
    const l54 = getPetClassStats('minion_pets', 54);
    expect(l50).toBeTruthy();
    expect(l54?.hitPoints).toBe(l50?.hitPoints);
    expect(getPetClassStats('minion_pets', 0)?.hitPoints).toBe(
      getPetClassStats('minion_pets', 1)?.hitPoints,
    );
  });

  it('returns null for a class it has no row for — never a zeroed pet', () => {
    expect(getPetClassStats('class_that_does_not_exist', 50)).toBeNull();
    expect(getPetClassAttribs('class_that_does_not_exist')).toBeNull();
    expect(getPetBaseStats('Entity_That_Does_Not_Exist', 50)).toBeNull();
  });

  it("reports the PET's caps, not the summoning archetype's", () => {
    // The pet's ceiling is its own class row's, and it diverges from the
    // caster's in BOTH directions: a Fire Imp caps resistance at 90% where a
    // Mastermind caps at 75%, and a Posse member caps at 70% — lower than the
    // Mastermind that summoned it. Neither direction survives if a stat block
    // starts reading the caster's row, and an inequality against the archetype
    // would only catch one of them.
    const mm = getArchetype('mastermind');
    expect(mm, 'mastermind archetype').toBeTruthy();

    for (const [cls, names] of declaredClasses()) {
      const stats = getPetClassStats(cls, 50);
      if (!stats) continue;
      expect(stats.characterClass, `${cls} (${names[0]})`).toBe(cls);
      expect(stats.hitPoints, `${cls} HP is the archetype's`).not.toBeCloseTo(
        mm!.stats.baseHP,
        3,
      );
    }
  });

  it('reports a coherent recharge clamp for every class', () => {
    // Shape only — the VALUE is a fork decision, not a constant. Homecoming
    // pins its summon classes at floor === cap === 1 (a pet's recharge can be
    // neither buffed nor debuffed); Rebirth and Thunderspy leave every class on
    // the player interval 0.25..5. The anchored block below asserts that split
    // explicitly, so a fork changing its mind reds there rather than here.
    const bad: string[] = [];
    for (const cls of declaredClasses().keys()) {
      const stats = getPetClassStats(cls, 50);
      if (!stats) continue;
      const b = stats.rechargeBounds;
      if (!b) bad.push(`${cls}: no recharge bounds`);
      else if (!(b.floor > 0) || !(b.cap >= b.floor)) bad.push(`${cls}: ${b.floor}..${b.cap}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('pet class stats — anchored values (homecoming)', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  it('matches the binary class rows for the classes players actually summon', () => {
    // Straight from exported_powers/tables/*.json `attribs`. The same field on
    // a player class reproduces the known in-game numbers exactly (Blaster
    // 1204.8 HP at 50, Mastermind 803.2), which is what establishes that this
    // is literal max HP and not a scale needing a multiplier.
    const imp = getPetClassStats('minion_pets', 50);
    expect(imp?.hitPoints).toBeCloseTo(1070.9, 1);
    expect(imp?.hpCap).toBeCloseTo(1606.3, 1);
    expect(imp?.resistanceCap).toBeCloseTo(0.9, 4);
    // 4 -> 5 with Issue 28 Page 4 (live 2026-10-06): the +400% damage cap raise covers AT pets
    // and henchmen, so minion_pets' class row moved with it. Not a new pet class.
    expect(imp?.damageCap).toBe(5);
    expect(imp?.baseThreat).toBe(1.5);
    expect(imp?.movement?.runSpeed).toBe(1.5);

    const bruiser = getPetBaseStats('MastermindPets_Thug_Boss', 50);
    expect(bruiser?.characterClass).toBe('henchman_boss');
    expect(bruiser?.hitPoints).toBeCloseTo(963.8, 1);
    expect(bruiser?.baseThreat).toBe(3);
  });

  it('separates the henchman tiers — they are three different class rows', () => {
    const minion = getPetClassStats('henchman_minion', 50)!.hitPoints;
    const lt = getPetClassStats('henchman_lt', 50)!.hitPoints;
    const boss = getPetClassStats('henchman_boss', 50)!.hitPoints;
    expect(minion).toBeLessThan(lt);
    expect(lt).toBeLessThan(boss);
  });

  it('records the Homecoming pet recharge pin, and that the other forks lack it', async () => {
    // HC forked its summon classes specifically to pin them: `minion_pets`,
    // `henchman_*` and the `*_pet` Lore classes all clamp net recharge strength
    // to exactly ×1, which is why recharge copied onto a Homecoming pet does
    // nothing to its attack cadence. Rebirth and Thunderspy did not fork —
    // their `minion_pets` sits on the player interval. Anything a stat block or
    // a damage layer says about pet recharge has to be per fork.
    for (const cls of ['minion_pets', 'henchman_boss', 'lt_praetoriangrunt_pet']) {
      expect(getPetClassStats(cls, 50)?.rechargeBounds, cls).toEqual({ floor: 1, cap: 1 });
    }
    for (const other of ['rebirth', 'thunderspy'] as const) {
      await loadDataset(other);
      expect(getPetClassStats('minion_pets', 50)?.rechargeBounds, other).toEqual({
        floor: 0.25,
        cap: 5,
      });
    }
    await loadDataset('homecoming');
  });

  it('keeps the class rows attached to the same table set they came from', () => {
    // attribs and named_tables are extracted from one file per class; a class
    // present in PET_TABLES with tables but no attribs means the attribs
    // extraction quietly stopped firing.
    const missing = Object.entries(PET_TABLES)
      .filter(([, data]) => Object.keys(data.tables).length > 0 && !data.attribs)
      .map(([cls]) => cls);
    expect(missing).toEqual([]);
  });
});
