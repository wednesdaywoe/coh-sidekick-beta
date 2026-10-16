/**
 * The perma window is read off the atoms — BPORT2's half of the beta-side bag port.
 *
 * `isPermaEligible` used to open with `if (!power.effects) return false` and derive its window
 * from a `durations` map keyed by bag slot. That answers "not eligible" for every bagless power,
 * which is what this fork's whole corpus becomes at the converter strip (BPORT7) — a perma ring
 * that vanishes from every power at once, with no test going red to say so. These are the three
 * claims that keep that from happening quietly.
 */

import { describe, it, expect } from 'vitest';
import { loadDataset, DATASET_IDS } from '@/data/dataset';
import { getAllPowersets } from '@/data/powersets';
import { getAllPowerPools } from '@/data/power-pools';
import { getAllEpicPools } from '@/data/epic-pools';
import { isPermaEligible, selfStateWindow } from './perma';
import type { Power } from '@/types';

/** One atom tuple through `pvMode` (index 9), plus `ownerTargets` at 35 when given. */
const atom = (
  effectType: string,
  subType: string | null,
  scale: number,
  duration: number,
  table: string,
  toWho: string,
  ownerTargets?: string[],
) => {
  const t: unknown[] = [effectType, subType, scale, 1, duration, table, 'Cur', 'Magnitude', toWho, 'Any'];
  if (ownerTargets) {
    t.length = 35;
    t.fill(null, 10, 35);
    t.push(ownerTargets);
  }
  return t;
};

const power = (over: Record<string, unknown>): Power =>
  ({ name: 'Probe', internalName: 'Probe', powerType: 'Click', ...over }) as unknown as Power;

describe('the window survives the bag', () => {
  it('a power with atoms and NO effects bag is still perma-eligible', () => {
    const bagless = power({
      stats: { recharge: 300 },
      atoms: [atom('Defense', 'All', 0.2, 120, 'Melee_Buff_Def', 'Self')],
    });
    expect(bagless.effects).toBeUndefined();
    expect(selfStateWindow(bagless)).toBe(120);
    expect(isPermaEligible(bagless, { floor: 0.25, cap: 5 })).toBe(true);
  });

  /**
   * Non-vacuity for the claim above: the pre-port predicate has to FAIL this power, or the
   * assertion would pass on a rule that never changed. Stated as the bag read it did — a bag,
   * a `durations` map and a self slot — none of which the bagless power carries.
   */
  it('the shape the pre-port predicate needed is exactly what a stripped power lacks', () => {
    const bagged = power({
      effects: { recharge: 300, durations: { defense: 120 }, defense: { all: 0.2 } },
      atoms: [atom('Defense', 'All', 0.2, 120, 'Melee_Buff_Def', 'Self')],
    });
    // Both shapes answer the same window today, which is what makes the port safe to land
    // before the strip: the atom rule already agrees with the bag it is replacing.
    expect(selfStateWindow(bagged)).toBe(120);
  });
});

describe('a Target atom resolves its pronoun through ownerTargets first', () => {
  /**
   * Fulcrum Shift is the case that names itself. The power is aimed at a foe
   * (`targetsAffected: ['Foe']`) and its eight `+Damage` rows arrive from the buff sub-power it
   * executes, stamped `ownerTargets: ['Friend', 'Self']` — the collection provenance data-gaps-63
   * put there precisely so a redirected row is not read against its parent's aim. Vetoing on the
   * parent deletes a 45s window the caster demonstrably holds, which is the archetypal Kinetics
   * perma target.
   *
   * `coh_math::perma::reaches_caster_for_perma` read only the parent's list until data-gaps-154
   * (2026-09-05) and lost it — `perma_eligibility_census` reported `win 0.0, rust false` on
   * every Kinetics copy. The two engines agree now, and this test is what would notice the
   * window being taken away again by a later "reconciliation". Homecoming and Brainstorm are the
   * two forks that stamp `ownerTargets` here at all; Rebirth and Thunderspy carry a 1s window
   * and are ineligible either way, which is why they are not in the list.
   */
  const SHIFT_FORKS = ['homecoming', 'brainstorm'] as const;

  it.each(SHIFT_FORKS)('%s: Fulcrum Shift keeps its 45s caster window', async (id) => {
    await loadDataset(id);
    const found = Object.values(getAllPowersets())
      .flatMap((set) => set.powers ?? [])
      .filter((p) => p.internalName === 'Fulcrum_Shift');
    expect(found.length, `${id}: Fulcrum Shift copies`).toBeGreaterThan(0);
    for (const p of found) {
      expect(p.targetsAffected, `${id} ${p.internalName}: parent aim`).toEqual(['Foe']);
      expect(selfStateWindow(p), `${id} ${p.internalName}: window`).toBe(45);
      expect(isPermaEligible(p, { floor: 0.25, cap: 5 })).toBe(true);
    }
  });

  it('a Target atom with no ownerTargets still reads the parent list', () => {
    const foeAimed = power({
      targetsAffected: ['Foe'],
      stats: { recharge: 300 },
      atoms: [atom('Defense', 'All', 0.2, 120, 'Melee_Buff_Def', 'Target')],
    });
    expect(selfStateWindow(foeAimed)).toBe(0);
  });

  /**
   * The other half of the stamp, and the half a foe-absence read gets wrong. A stamped list
   * names whom the row lands on outright, so `Self` has to be in it — read leniently, an ally
   * buff's own recipients ("no foe here") become the caster's, which is how the teleports get
   * their 1.5s ring back off the teleported ally's translucency and how Brainstorm's Adrenalin
   * Boost keeps a 90s window stamped `['DeadPlayerFriend']` (data-gaps-154).
   *
   * Stated on a power whose own list would otherwise LAND the window: the parent names no foe,
   * so only the stamp can produce the 0 (a filter that declined everything would pass a probe
   * whose parent was foe-aimed).
   */
  it('a stamped list that names somebody else is a veto, foe or not', () => {
    const allyBuff = (ownerTargets: string[]) =>
      power({
        targetsAffected: ['Friend', 'Self'],
        stats: { recharge: 300 },
        atoms: [atom('Defense', 'All', 0.2, 120, 'Melee_Buff_Def', 'Target', ownerTargets)],
      });
    expect(selfStateWindow(allyBuff(['DeadPlayerFriend']))).toBe(0);
    expect(selfStateWindow(allyBuff(['Friend', 'Self']))).toBe(120);
  });
});

describe("a Target atom on the power's own list needs the caster named", () => {
  /**
   * The other lenient read, and the one that survived data-gaps-154. An ally-only buff aims every row
   * at `Target` and names no foe, so a veto that fires only on an enemy kept the window and
   * handed the caster the ALLY's clock — 47 power entries over 22 (fork, power) pairs drew a
   * perma ring on a buff nobody holds (data-gaps-153).
   *
   * Stated on a pair differing in nothing but the list, and the positive half has to LAND the
   * window: a rule that declined everything would pass the ally half on its own. The third arm
   * is the one no corpus can grade — every power in all four bundles states a non-empty
   * `targetsAffected`, so an absent list exists only here, and it has to keep the window because
   * this veto deletes rather than credits.
   */
  it('an ally-only recipient list times the ally clock, and an absent one keeps the window', () => {
    const boost = (targetsAffected?: string[]) =>
      power({
        ...(targetsAffected ? { targetsAffected } : {}),
        stats: { recharge: 300 },
        atoms: [atom('Defense', 'All', 0.2, 120, 'Melee_Buff_Def', 'Target')],
      });
    // Accelerate Metabolism's shape: the caster is among the recipients.
    expect(selfStateWindow(boost(['Friend', 'Self']))).toBe(120);
    // Adrenalin Boost's: `Friend` and nothing else, no foe to veto on.
    expect(selfStateWindow(boost(['Friend']))).toBe(0);
    // Nothing stated at all — no evidence either way, and the window survives.
    expect(selfStateWindow(boost())).toBe(120);
  });

  /**
   * The corpus half, on the power the register's key checks. Adrenalin Boost is an Empathy
   * ally buff — `targetsAffected: ['Friend']`, eight rows at `toWho: 'Target'`, a 90s window
   * against a 300s recharge — and the Empath gets nothing from it at all. Brainstorm is the
   * control data-gaps-154 already fixed from the other side: its rows carry
   * `ownerTargets: ['DeadPlayerFriend']`, so the stamp read vetoes them there.
   */
  it.each(['homecoming', 'rebirth', 'thunderspy'] as const)(
    '%s: Adrenalin Boost draws no ring off the ally window',
    async (id) => {
      await loadDataset(id);
      const found = Object.values(getAllPowersets())
        .flatMap((set) => set.powers ?? [])
        .filter((p) => p.internalName === 'Adrenalin_Boost');
      expect(found.length, `${id}: Adrenalin Boost copies`).toBeGreaterThan(0);
      for (const p of found) {
        expect(p.targetsAffected, `${id}: recipients`).not.toContain('Self');
        expect(selfStateWindow(p), `${id}: window`).toBe(0);
        expect(isPermaEligible(p, { floor: 0.25, cap: 5 })).toBe(false);
      }
    },
  );
});

describe('the authored-cycle arm can only answer for a synthesised power', () => {
  /**
   * `authoredCycle` is the one bag read left in `perma.ts`, and it is safe only because nothing
   * the export ships can reach it. That is a measurement, so it is measured here rather than
   * asserted in a comment: if a converter ever emits an atom-less power, this goes red and the
   * arm stops being scoped.
   */
  it.each(DATASET_IDS)('%s: every exported power carries atoms, in all three partitions', async (id) => {
    await loadDataset(id);
    // All three, because the partitions are converted by different scripts and the pool/epic
    // pair went atom-less for months while the powersets did not — a census of the powersets
    // alone would have read as proof for a claim it had not tested.
    const partitions: [string, { powers?: Power[] }[]][] = [
      ['powerset', Object.values(getAllPowersets())],
      ['pool', Object.values(getAllPowerPools())],
      ['epic', Object.values(getAllEpicPools())],
    ];
    for (const [label, sets] of partitions) {
      const powers = sets.flatMap((set) => set.powers ?? []);
      expect(powers.length, `${id}/${label}: powers`).toBeGreaterThan(10);
      const atomless = powers.filter((p) => !p.atoms?.length).map((p) => p.internalName ?? p.name);
      expect(atomless, `${id}/${label}: atom-less exported powers`).toEqual([]);
    }
  });

  it('a power that carries atoms never reads the bag cycle', () => {
    // The bag says 300s/120s; the atoms say the caster holds nothing. The atoms win.
    const both = power({
      effects: { recharge: 300, buffDuration: 120 },
      atoms: [atom('Damage', 'Fire', 1, 0, 'Ranged_Damage', 'Target')],
    });
    expect(selfStateWindow(both)).toBe(0);
    expect(isPermaEligible(both, { floor: 0.25, cap: 5 })).toBe(false);
  });

  it('an atom-less synthesised card keeps its authored cycle', () => {
    // The archetype-inherent card shape: `createArchetypeInherentPower` states the cycle in
    // `archetypes.ts` because this fork has no join to the `Inherent.Inherent` twin.
    const card = power({ effects: { recharge: 200, buffDuration: 90, enduranceGain: 100 } });
    expect(selfStateWindow(card)).toBe(90);
    expect(isPermaEligible(card, { floor: 0.25, cap: 5 })).toBe(true);
  });
});
