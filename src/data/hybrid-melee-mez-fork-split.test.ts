import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXPORTED } from './export-manifests';

/**
 * data-gaps-2 — Homecoming dropped the Melee Hybrid's status protection at T3-Radial and T4, and
 * left the tooltip claiming it. The forks kept the rows, and their tooltips are right.
 *
 * This pins an UPSTREAM fact, not a defect of ours. It exists because the observation is one
 * step from a false accusation in either direction: an absent effect a tooltip promises looks
 * exactly like a parser dropping a template, and the reason it isn't one here is measured, not
 * argued. The Parse7 reader emits packed negative mez rows on 408 Homecoming powers (564
 * carrying one at all), including `melee_genome_4` in this very file family and group position.
 * A reader that could not see the shape would have missed those too.
 *
 * So the tripwire runs both ways. If a Homecoming re-export restores the rows, the game changed
 * back and the tooltip is right again. If the forks lose them, suspect the parse — nothing about
 * Rebirth or Thunderspy should move here on its own.
 */

const MEZ = /^(Held|Stunned|Sleep|Immobilized|Confused|Terrorized|Afraid)$/;

/** The three tiers Homecoming stripped, and one that kept its rows as the control. */
const STRIPPED = ['melee_genome_7', 'melee_genome_8', 'melee_genome_9'];
const KEPT = 'melee_genome_4';

/** Homecoming keeps the legacy flat layout; the rest are namespaced. */
function hybridDir(dataset: string): string {
  const namespaced = join(EXPORTED, dataset, 'incarnate', 'hybrid');
  return dataset === 'homecoming' && !existsSync(namespaced)
    ? join(EXPORTED, 'incarnate', 'hybrid')
    : namespaced;
}

function read(dataset: string, id: string) {
  const d = JSON.parse(readFileSync(join(hybridDir(dataset), `${id}.json`), 'utf-8'));
  const help = `${d.display_help || ''} ${d.display_short_help || ''}`;
  const protection = (d.effects || []).some((e: { templates?: Array<{ attribs?: string[]; scale?: number }> }) =>
    (e.templates || []).some((t) => (t.attribs || []).some((a) => MEZ.test(a)) && (t.scale || 0) < 0),
  );
  return { protection, claimsProtection: /status protection/i.test(help) };
}

describe('Melee Hybrid status protection', () => {
  it('is absent on the Homecoming lineage at the three tiers whose prose still promises it', () => {
    // Brainstorm is Homecoming's open beta, so it is a second export of the same lineage rather
    // than an independent witness. It is here to catch the lineage moving as a whole.
    for (const dataset of ['homecoming', 'brainstorm']) {
      for (const id of STRIPPED) {
        const r = read(dataset, id);
        expect(r.claimsProtection, `${dataset}/${id} prose`).toBe(true);
        expect(r.protection, `${dataset}/${id} effects — if this is now true, HC restored the rows`).toBe(false);
      }
      // The control: same fork, same family, same group position, rows present. This is what
      // makes the absence above a statement about the data instead of about the reader.
      expect(read(dataset, KEPT).protection, `${dataset}/${KEPT}`).toBe(true);
    }
  });

  it('survives on the forks, where the same prose is accurate', () => {
    for (const dataset of ['rebirth', 'thunderspy']) {
      for (const id of [...STRIPPED, KEPT]) {
        const r = read(dataset, id);
        expect(r.protection, `${dataset}/${id} — if this is now false, suspect the parse`).toBe(true);
        expect(r.claimsProtection, `${dataset}/${id} prose`).toBe(true);
      }
    }
  });
});
