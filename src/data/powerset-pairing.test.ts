import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getAllPowersets, getPowerset, getPowersetsForArchetype } from '@/data/powersets';
import { isPairable, pairingStarvation, setKey, setKeyFromId } from '@/data/power-requires';

/**
 * Some primary/secondary pairings are unbuildable, and the game says so through per-power
 * `BuyRequires` rather than any set-level field: each side's level-1 powers name the other
 * side under a negation, so taking the pair leaves you with no first power to buy.
 *
 * The pinned cases below are read off the authoritative authored `.powers` defs, NOT off the
 * export the code under test consumes — otherwise this grades the data against itself. Their
 * defs read:
 *
 *   Brute_Defense.Shield_Defense.Deflection   BuyRequires  ...Titan_Weapons || ... !
 *   Brute_Melee.Titan_Weapons.Crushing_Blow   BuyRequires  Brute_Defense.Shield_Defense !
 *   Brute_Defense.Stone_Armor.Rock_Armor      BuyRequires  Brute_Melee.Claws !
 *   Brute_Melee.Claws.Strike                  BuyRequires  Brute_Defense.Shield_Defense ! Brute_Defense.Stone_Armor ! &&
 *
 * The per-fork blocks assert properties instead of a pinned roster, because the roster is a
 * fork's content and moves when a fork adds a weapon set.
 */

const FORKS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;

/** Every (primary, secondary) pair for one archetype prefix, as the dropdowns would offer them. */
function pairsFor(archetype: string) {
  const sets = getPowersetsForArchetype(archetype);
  const primaries = sets.filter((s) => (s.category ?? '').toLowerCase() === 'primary');
  const secondaries = sets.filter((s) => (s.category ?? '').toLowerCase() === 'secondary');
  return primaries.flatMap((p) => secondaries.map((s) => [p, s] as const));
}

describe('homecoming pairings named by the authored defs', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  }, 60_000);

  it('refuses the weapon-set pairings Shield Defense excludes', () => {
    for (const weapon of ['titan-weapons', 'claws', 'katana', 'dual-blades', 'spines', 'staff-fighting']) {
      expect(
        isPairable(getPowerset(`brute/${weapon}`), getPowerset('brute/shield-defense')),
        `brute/${weapon} + shield-defense should be unbuildable`,
      ).toBe(false);
    }
  });

  // Issue 28 Page 4 (live 2026-10-06): "This powerset is no longer mutually exclusive with
  // Stone Armor on Tankers and Brutes." The defs stopped naming the exclusion, so the pair opens.
  it('allows Claws + Stone Armor since Issue 28 Page 4', () => {
    expect(isPairable(getPowerset('brute/claws'), getPowerset('brute/stone-armor'))).toBe(true);
    expect(isPairable(getPowerset('tanker/stone-armor'), getPowerset('tanker/claws'))).toBe(true);
  });

  it('allows a weapon set with an armour set that does not exclude it', () => {
    expect(isPairable(getPowerset('brute/titan-weapons'), getPowerset('brute/invulnerability'))).toBe(true);
    expect(isPairable(getPowerset('brute/claws'), getPowerset('brute/willpower'))).toBe(true);
  });

  it('allows an unarmed set with Shield Defense', () => {
    expect(isPairable(getPowerset('brute/super-strength'), getPowerset('brute/shield-defense'))).toBe(true);
    expect(isPairable(getPowerset('brute/dark-melee'), getPowerset('brute/shield-defense'))).toBe(true);
  });

  it('names the starved side, so the UI can say which set is the problem', () => {
    const starved = pairingStarvation(getPowerset('brute/titan-weapons'), getPowerset('brute/shield-defense'));
    expect(starved.map((s) => s.id).sort()).toEqual(['brute/shield-defense', 'brute/titan-weapons']);
  });

  it('never blocks a set against itself or against a missing set', () => {
    expect(isPairable(getPowerset('brute/claws'), getPowerset('brute/claws'))).toBe(true);
    expect(isPairable(getPowerset('brute/claws'), undefined)).toBe(true);
  });
});

describe.each(FORKS)('%s pairing properties', (fork) => {
  beforeAll(async () => {
    await loadDataset(fork);
  }, 60_000);

  const ARCHETYPES = ['brute', 'scrapper', 'tanker', 'stalker'];

  it('blocks at least one pairing, so the rule is reachable on this fork', () => {
    const blocked = ARCHETYPES.flatMap(pairsFor).filter(([a, b]) => !isPairable(a, b));
    expect(blocked.length).toBeGreaterThan(0);
  });

  it('leaves the large majority of pairings buildable', () => {
    const all = ARCHETYPES.flatMap(pairsFor);
    const blocked = all.filter(([a, b]) => !isPairable(a, b));
    // A decode that mistook the negation's sense would invert this ratio rather than empty it.
    expect(blocked.length).toBeLessThan(all.length / 4);
  });

  it('is symmetric — order of the two sets cannot change the verdict', () => {
    for (const [a, b] of ARCHETYPES.flatMap(pairsFor)) {
      expect(isPairable(a, b), `${a.id} + ${b.id}`).toBe(isPairable(b, a));
    }
  });

  it('gates all but a handful of blocked pairings from both sides', () => {
    // `pairingStarvation` reports a pair blocked when EITHER side starves, so it does not
    // require reciprocity — which makes this a check on the DATA rather than on the code.
    //
    // It is also the assertion that caught the real defect here: it began as "both sides,
    // always" and failed on four pairs, three of which turned out to be the evaluator
    // resolving `Scrapper_Melee.Quills` and `Stalker_Melee.Ninja_Sword` against an id slug
    // that renamed sets do not have. With that fixed the only survivor is Thunderspy leaving
    // Stone Armor's Stone Skin ungated while Claws still excludes Stone Armor — a genuine
    // fork divergence. Keep the bound tight: a rise here means gates are going dark again.
    const oneSided = ARCHETYPES.flatMap(pairsFor)
      .map(([a, b]) => [a, b, pairingStarvation(a, b)] as const)
      .filter(([, , starved]) => starved.length === 1)
      .map(([a, b, starved]) => `${a.id} + ${b.id} → only ${starved[0].id}`);
    expect(oneSided.length, `one-sided gates on ${fork}: ${oneSided.join(', ')}`).toBeLessThanOrEqual(1);
  });
});

describe.each(FORKS)('%s requires tokens resolve to a real powerset', (fork) => {
  beforeAll(async () => {
    await loadDataset(fork);
  }, 60_000);

  /**
   * A two-segment `requires` token names a powerset, and the evaluator answers by looking it
   * up. A token that matches nothing evaluates to "not held" — the gate goes quiet instead of
   * going wrong, which is why Shield Defense excluded Scrapper Spines for years without
   * anyone noticing: the gate said `Scrapper_Melee.Quills` and the lookup was keyed on the
   * `spines` id slug. This sweeps every shipped token so the next rename fails loudly here.
   */
  it('has no powerset token that matches nothing', () => {
    const live = new Set(
      Object.values(getAllPowersets())
        .map((s) => setKeyFromId(s.id, s.setPath))
        .filter((k): k is string => k !== undefined),
    );
    const unresolved = new Set<string>();
    for (const set of Object.values(getAllPowersets())) {
      for (const power of set.powers) {
        if (!power.requires?.length) continue;
        for (const tok of power.requires.map((t) => t.replace(/,$/, '')).filter(Boolean)) {
          const parts = tok.split('.');
          if (parts.length !== 2) continue;
          if (!live.has(setKey(parts[1]))) unresolved.add(`${tok} (named by ${set.id}/${power.internalName})`);
        }
      }
    }
    expect([...unresolved]).toEqual([]);
  });
});
