import { describe, it, expect } from 'vitest';
import { DESCRIPTION_NOTES } from './description-notes';
import {
  sweepPowersets,
  sweepHybrids,
  DATASETS,
  type DivergenceCandidate,
} from '../../scripts/audit-description-divergence.cjs';

/**
 * The adjudicated description notes agree with the sweep, in both directions.
 *
 * A note says a power's in-game text promises something its data does not carry. Two ways that
 * goes wrong, and this grades both:
 *
 *   - A note OUTLIVES its divergence. The data is re-exported, the effect comes back, and the
 *     banner keeps telling players the description is unreliable. Every note must still be a
 *     live candidate.
 *   - A divergence arrives with NO note. Then the app is quietly showing a promise the data
 *     does not keep, which is the thing the notes exist to prevent — and it needs a person,
 *     because the same observation is what a parse gap looks like. A new candidate fails here
 *     rather than auto-generating a banner.
 *
 * So this is a set-equality tripwire, not a subset check. It is deliberately noisy on arrival of
 * anything new: the failure message is the handoff to adjudication.
 *
 * The corpus is the built `contract/` tree, which only the canonical repo holds — the beta ships
 * the same data as gzipped bundles. So the two corpus legs run there and announce themselves as
 * skipped here, the same split `lint-register-shape.cjs` rule 6 makes. The shape leg runs in both:
 * a malformed note is a malformed note wherever it is read.
 */

/** Every candidate the sweep reports, per dataset. */
function candidates(dataset: string): DivergenceCandidate[] {
  const ps = sweepPowersets(dataset);
  const hy = sweepHybrids(dataset);
  if (ps.missing && hy.missing) return [];
  return [...ps.found, ...hy.found];
}

/** Is the built contract tree present? Only the canonical repo holds it. */
const CORPUS = DATASETS.some((d) => !sweepPowersets(d).missing);
if (!CORPUS) {
  console.warn(
    '[description-notes] no contract/ tree in this repo — the sweep legs are SKIPPED here and ' +
      'run in the canonical repo, which builds the contract. The note-shape leg still runs.',
  );
}
const corpus = CORPUS ? it : it.skip;

describe('description notes', () => {
  corpus('sweeps a real corpus on every dataset', () => {
    // Anti-vacuous. A contract path that stops resolving, or a catalog join that silently
    // returns nothing, empties every assertion below — which is exactly how this sweep's own
    // first draft reported zero candidates while sitting on three.
    for (const dataset of DATASETS) {
      const ps = sweepPowersets(dataset);
      if (ps.missing) continue;
      expect(ps.scanned, `${dataset} powers swept`).toBeGreaterThan(2000);
    }
  });

  corpus('matches the sweep exactly — no note without a divergence, no divergence without a note', () => {
    for (const dataset of DATASETS) {
      const found = new Set(candidates(dataset).map((c) => c.key));
      const noted = new Set(
        DESCRIPTION_NOTES.filter((n) => n.datasets.includes(dataset)).map((n) => n.key),
      );
      const stale = [...noted].filter((k) => !found.has(k));
      const unadjudicated = [...found].filter((k) => !noted.has(k));
      expect(
        stale,
        `${dataset}: these notes no longer describe a divergence — the data may have been fixed; delete the note`,
      ).toEqual([]);
      expect(
        unadjudicated,
        `${dataset}: new description divergence(s). Do NOT just add a note — adjudicate first (census the shape fork-wide, find a same-fork control that reads correctly), because an absent effect is also what a parse gap looks like. See docs/gaps/ data-gaps-2`,
      ).toEqual([]);
    }
  });

  it('every note cites the register entry that adjudicated it', () => {
    for (const note of DESCRIPTION_NOTES) {
      // A worklog item id since the registers moved to worklog.jsonl (data-gaps-2).
      expect(note.gap, `${note.key}`).toMatch(/^[a-z]+(-[a-z]+)*-[0-9]+$/);
      expect(note.datasets.length, `${note.key} datasets`).toBeGreaterThan(0);
      expect(note.finding.length, `${note.key} finding`).toBeGreaterThan(15);
      // The short line renders inside a 120px band. Anything much longer is a sentence the
      // player reads half of; the context belongs on `detail`, which is a hover title.
      expect(note.finding.length, `${note.key} finding is too long for the band`).toBeLessThan(60);
      expect(note.detail.length, `${note.key} detail`).toBeGreaterThan(30);
    }
  });
});
