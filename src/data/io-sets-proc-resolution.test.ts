import { describe, it, expect } from 'vitest';
import { PROC_DATABASE, findProcData } from '@/data/proc-data';
import { IO_SETS_RAW as HC_SETS } from '@/data/datasets/homecoming/io-sets-raw';
import { IO_SETS_RAW as RB_SETS } from '@/data/datasets/rebirth/io-sets-raw';
import { IO_SETS_RAW as TS_SETS } from '@/data/datasets/thunderspy/io-sets-raw';
import { IO_SETS_RAW as BS_SETS } from '@/data/datasets/brainstorm/io-sets-raw';

/**
 * Guard against the Steadfast/Stupefy proc mis-resolution class.
 *
 * A slotted piece resolves its effect through findProcData(piece.name, set.name).
 * When the name matches no proc-data key, findProcData falls through to its
 * set-name fallback, which returns the FIRST PROC_DATABASE entry for that set.
 * For a set with more than one special (Steadfast: +Def AND +KB Prot; Stupefy:
 * Chance-for-Stun AND Chance-for-Knockback) that silently shows the WRONG
 * effect — whichever entry the iteration order happens to reach first.
 *
 * Invariant: every proc piece in a set with >1 proc-data entry resolves by an
 * EXACT name match, never the ambiguous fallback.
 *
 * Piece names come from the boost power now, so the two sides of the match are
 * no longer written by the same hand: PROC_DATABASE is still a hand table in
 * proc-data.ts, carrying the vocabulary the extractor used to assemble. Where
 * they disagree, the exact match is lost and the ambiguous fallback is what
 * answers. The pinned list below is that disagreement, in full.
 */

/**
 * Proc pieces whose name no longer matches their PROC_DATABASE entry, because the
 * entry spells the piece the old extractor's way. Both sides describe the same
 * global — the game says "Resistance/Defense", the table says "Damage
 * Resistance/+Def(All)" — so the fallback currently lands on the right entry, but
 * only because it sorts ahead of Steadfast's Knockback Protection. Exit condition:
 * re-source PROC_DATABASE's keys from the binary, at which point this empties.
 */
const NAME_PREDATES_THE_BINARY: Record<string, string[]> = {
  homecoming: ['steadfast_protection #2'],
  rebirth: ['steadfast_protection #2'],
  // Measured 2026-08-22, when the sweep was widened past the two forks it had been
  // asking. The drift is the hand table's, so it is fork-wide — every fork that
  // ships Steadfast Protection carries it, and the two-fork sweep had been reporting
  // a two-fork defect.
  thunderspy: ['steadfast_protection #2'],
  brainstorm: ['steadfast_protection #2'],
};
function resolvesExactly(name: string, setName: string): boolean {
  if (PROC_DATABASE[`${setName}: ${name}`]) return true;
  if (PROC_DATABASE[name]) return true; // exact bare key
  for (const [key, data] of Object.entries(PROC_DATABASE)) {
    if ((data.ioName === name || key.endsWith(`: ${name}`)) && data.setName === setName) return true;
  }
  return false;
}

describe.each([
  ['homecoming', HC_SETS],
  ['rebirth', RB_SETS],
  ['thunderspy', TS_SETS],
  ['brainstorm', BS_SETS],
])('%s proc pieces resolve unambiguously', (dataset, REG) => {
  const ambiguous: string[] = [];

  for (const [setId, set] of Object.entries(REG)) {
    const dbEntries = Object.values(PROC_DATABASE).filter((d) => d.setName === set.name).length;
    if (dbEntries < 2) continue; // single-entry fallback can't pick the wrong one
    for (const piece of set.pieces.filter((p) => p.proc)) {
      const label = `${setId} #${piece.num}`;
      if (!resolvesExactly(piece.name, set.name)) ambiguous.push(label);
      it(`${label} "${piece.name}" resolves to an effect of its own set`, () => {
        // Weaker than an exact match, and it holds even for the pinned pieces:
        // whichever entry the fallback reaches must at least be this set's.
        expect(findProcData(piece.name, set.name)?.setName).toBe(set.name);
      });
    }
  }

  it('leans on the ambiguous set-name fallback for exactly the pinned pieces', () => {
    expect(ambiguous.sort()).toEqual([...(NAME_PREDATES_THE_BINARY[dataset] ?? [])].sort());
  });
});

/**
 * data-gaps-108. Every entry used to carry a hand-authored `setCategory` naming its
 * set's type, in front of the `type` each fork's registry already states. It was
 * wrong in 52 of 184 and nothing read it, so nothing could go red. It is deleted;
 * a consumer that needs the type derives it from the registry at the point of use.
 *
 * That derivation joins on `setName`, so this grades the join: every entry must
 * resolve to a real set in at least one fork. Cross-fork is load-bearing. The
 * table is shared and the Rebirth-only sets resolve nowhere else, so a
 * single-fork sweep reports defects that aren't.
 */
describe('proc entries join the IO-set registries by setName', () => {
  const REGISTRIES = { homecoming: HC_SETS, rebirth: RB_SETS, thunderspy: TS_SETS, brainstorm: BS_SETS };
  const typesFor = (setName: string) =>
    Object.entries(REGISTRIES).flatMap(([fork, reg]) => {
      const set = Object.values(reg).find((s) => s.name === setName);
      return set ? [[fork, set.type] as const] : [];
    });

  it('resolves every setName in at least one fork', () => {
    const unresolved = [...new Set(Object.values(PROC_DATABASE).map((d) => d.setName))]
      .filter((setName) => typesFor(setName).length === 0);
    expect(unresolved).toEqual([]);
  });

  /**
   * And the reason the authored field can't come back even spelled right: for
   * these the answer differs BY FORK, so one shared string is wrong somewhere
   * whatever it says. Four renamings, all Rebirth/Thunderspy against
   * Homecoming/Brainstorm: PBAoE for Melee AoE, Targeted AoE for Ranged AoE,
   * Threat Duration for Taunt, and the "& Sprints" travel headings. Pinned, so a
   * fork converging on one name is noticed.
   */
  it('pins the sets whose type is fork-dependent', () => {
    const split = [...new Set(Object.values(PROC_DATABASE).map((d) => d.setName))]
      .flatMap((setName) => {
        const types = new Set(typesFor(setName).map(([, t]) => t));
        return types.size > 1 ? [`${setName}: ${[...types].sort().join(' / ')}`] : [];
      });
    expect(split.sort()).toEqual([
      'Annihilation: Ranged AoE Damage / Targeted AoE Damage',
      'Armageddon: Melee AoE Damage / PBAoE Damage',
      'Avalanche: Melee AoE Damage / PBAoE Damage',
      'Celerity: Running / Running & Sprints',
      'Eradication: Melee AoE Damage / PBAoE Damage',
      'Frozen Blast: Ranged AoE Damage / Targeted AoE Damage',
      'Fury of the Gladiator: Melee AoE Damage / PBAoE Damage',
      'Javelin Volley: Ranged AoE Damage / Targeted AoE Damage',
      'Obliteration: Melee AoE Damage / PBAoE Damage',
      "Perfect Zinger: Taunt / Threat Duration",
      "Positron's Blast: Ranged AoE Damage / Targeted AoE Damage",
      'Ragnarok: Ranged AoE Damage / Targeted AoE Damage',
      "Scirocco's Dervish: Melee AoE Damage / PBAoE Damage",
      'Superior Avalanche: Melee AoE Damage / PBAoE Damage',
      'Superior Frozen Blast: Ranged AoE Damage / Targeted AoE Damage',
      'Triumphant Insult: Taunt / Threat Duration',
      'Unbounded Leap: Leaping / Leaping & Sprints',
    ]);
  });
});
