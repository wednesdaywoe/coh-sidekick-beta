/**
 * Adjudicated description notes — powers whose in-game text promises something the planner's
 * data does not carry.
 *
 * City of Heroes descriptions fall behind the powers they describe, and a player reading a
 * promise the game no longer keeps deserves to be told. What this file is careful about is the
 * OTHER reading of the same observation: an effect a description promises and our data lacks is
 * indistinguishable, from the power alone, from an effect our parser dropped. So nothing lands
 * here from a heuristic. `scripts/audit-description-divergence.cjs` sweeps and REPORTS; a person
 * adjudicates each candidate the way data-gaps-2 was (census the shape fork-wide, find a same-fork
 * control that reads correctly), and only the survivor is written down, with its register id.
 *
 * That is also why this is not a Rule 0 violation. The rule bans hardcoding a value the export
 * owns, and the export cannot state "my own description is stale" — it has no field for it. Nor
 * is any of it branched on: the renderer asks whether a key has a note, never which power it is.
 *
 * The note's voice is deliberately unconfident. We are reporting a disagreement between two
 * sources, not ruling on it, and the player is the one standing in the game where it can be
 * settled in ten seconds.
 */

export interface DescriptionNote {
  /** Namespaced subject. `incarnate:<powerId>` today; `power:<internalName>` when one is adjudicated. */
  key: string;
  /** Dataset ids the divergence was adjudicated on. A fork not listed here reads correctly. */
  datasets: string[];
  /**
   * What Sidekick finds, phrased as a reading and kept SHORT — it renders inside a 120px
   * header band, and a banner that overflows it presents as a sentence cut off mid-clause.
   */
  finding: string;
  /** The longer context, carried on hover so the short line stays inside the band. */
  detail: string;
  /** The register entry carrying the adjudication and its evidence. */
  gap: string;
}

/**
 * One entry, and the sweep finds no others on any fork. The Melee Hybrid's status protection was
 * removed on the Homecoming lineage at Total Radial Graft and both T4 Embodiments; the
 * descriptions still list it, and the Rebirth and Thunderspy versions still carry the rows.
 */
export const DESCRIPTION_NOTES: DescriptionNote[] = [
  {
    key: 'incarnate:melee_genome_7',
    datasets: ['homecoming', 'brainstorm'],
    finding: 'no Status Protection on this power',
    detail:
      'The Rebirth and Thunderspy versions of this power do carry status protection; the '
      + 'Homecoming data does not, though its description still lists it.',
    gap: 'data-gaps-2',
  },
  {
    key: 'incarnate:melee_genome_8',
    datasets: ['homecoming', 'brainstorm'],
    finding: 'no Status Protection on this power',
    detail:
      'The Rebirth and Thunderspy versions of this power do carry status protection; the '
      + 'Homecoming data does not, though its description still lists it.',
    gap: 'data-gaps-2',
  },
  {
    key: 'incarnate:melee_genome_9',
    datasets: ['homecoming', 'brainstorm'],
    finding: 'no Status Protection on this power',
    detail:
      'The Rebirth and Thunderspy versions of this power do carry status protection; the '
      + 'Homecoming data does not, though its description still lists it.',
    gap: 'data-gaps-2',
  },
];

/** The note for a subject on a dataset, or null. Keyed lookup — no power name is branched on. */
export function getDescriptionNote(key: string, dataset: string): DescriptionNote | null {
  return DESCRIPTION_NOTES.find((n) => n.key === key && n.datasets.includes(dataset)) ?? null;
}
