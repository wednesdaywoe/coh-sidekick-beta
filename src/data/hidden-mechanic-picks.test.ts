import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getAllPowersets } from '@/data';
import { isBuyablePick } from '@/data/power-requires';
import type { Power } from '@/types';

/**
 * data-gaps-56 — hidden from the Manage screen is not the same as not for sale.
 *
 * data-gaps-57 taught the converter to classify a power as `hiddenPassive`/`hiddenAuto` from
 * its `ShowInManage kFalse` + `MaxBoosts 0` flags, and both planners then read that class as
 * "never a pick". It isn't one: `ShowInManage` says only that the power gets no row on the
 * enhancement Manage screen, which every slotless power carries whether or not the game
 * sells it. Bio Armor's Adaptation and Staff Fighting's Staff Mastery are hidden there and
 * still cost a power pick, so the filter took a pick away from eight powersets on HC and its
 * mirrors — reported from the beta as "the Bio Armor Adaptation power option is missing".
 *
 * `free` is the axis that separates the two: `character_CountPowersBought`
 * (`character_level.c:447`) skips exactly the powers the game hands over, and AutoIssue
 * forces Free (`powers_load.c:950`). Every hidden row in every bundle splits cleanly on it —
 * Seismic Shockwaves and the forks' curated helpers are free, Adaptation / Staff Mastery /
 * Fate Sealed are not.
 *
 * Three legs, because the first two grade the rule and only the third would have caught the
 * original: data-gaps-57's gates asserted that hidden powers stay out of the pick list, which
 * is half a question, and stayed green over a corpus where the other half was wrong.
 */

const DATASETS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;

/** The hidden-classified powers a picker could plausibly offer — i.e. at a real unlock level. */
function hiddenAtPickableLevel(powers: Power[]): Power[] {
  return powers.filter(
    (p) =>
      (p.mechanicType === 'hiddenPassive' || p.mechanicType === 'hiddenAuto') &&
      // The auto-grant sentinel, signed and in HC's unsigned spelling.
      !(p.available < 0 || p.available >= 0x80000000),
  );
}

/**
 * Floors per dataset, measured 2026-08-26. A zero on either side means that side stopped
 * being graded — absence and "the classifier went unreachable again" have the same shape,
 * and only the floor separates them (the data-gaps-57 lesson, applied to both halves).
 */
const FLOORS: Record<(typeof DATASETS)[number], { handedOver: number; sold: number }> = {
  // Shockwaves ×4 handed over; Adaptation ×5 + Staff Mastery ×3 + Fate Sealed sold.
  homecoming: { handedOver: 4, sold: 9 },
  // Clear Skies ×2, Group Energy Flight, Quantum Acceleration handed over.
  rebirth: { handedOver: 4, sold: 7 },
  // Centered / In Touch handed over; Organic Armor's Adaptation ×3 sold.
  thunderspy: { handedOver: 2, sold: 3 },
  brainstorm: { handedOver: 4, sold: 9 },
};

/**
 * The VEAT branch sets, the only powersets that legitimately offer fewer than nine picks —
 * they are half-sets a character specializes into at 24, not full primaries. Named rather
 * than thresholded so a NEW short set is a red, which is exactly what data-gaps-56 produced.
 */
const SHORT_BY_DESIGN = /^arachnos-(soldier|widow)\//;

for (const ds of DATASETS) {
  describe(`hidden set mechanics — ${ds}`, () => {
    beforeAll(async () => {
      await loadDataset(ds);
    });

    it('a hidden mechanic the game hands over is never offered as a pick', () => {
      let graded = 0;
      const offered: string[] = [];
      for (const [id, ps] of Object.entries(getAllPowersets())) {
        for (const p of hiddenAtPickableLevel(ps.powers)) {
          if (!(p.free || p.autoIssue)) continue;
          graded++;
          if (isBuyablePick(p)) offered.push(`${id}:${p.name}`);
        }
      }
      expect(offered).toEqual([]);
      expect(graded).toBeGreaterThanOrEqual(FLOORS[ds].handedOver);
    });

    it('a hidden mechanic the game SELLS stays a pick (data-gaps-56)', () => {
      let graded = 0;
      const withheld: string[] = [];
      for (const [id, ps] of Object.entries(getAllPowersets())) {
        for (const p of hiddenAtPickableLevel(ps.powers)) {
          if (p.free || p.autoIssue) continue;
          graded++;
          if (!isBuyablePick(p)) withheld.push(`${id}:${p.name}`);
        }
      }
      expect(withheld).toEqual([]);
      expect(graded).toBeGreaterThanOrEqual(FLOORS[ds].sold);
    });

    /**
     * The structural oracle, and the only leg that does not restate the rule it is grading:
     * a full AT powerset offers nine picks. 320 of HC's 328 standard sets did; the eight
     * that did not were exactly the eight the hidden-mechanic filter had emptied a slot
     * from. A filter that swallows a real pick shows up here whatever axis it keys on.
     */
    it('every full AT powerset offers nine picks', () => {
      const short: string[] = [];
      let graded = 0;
      for (const [id, ps] of Object.entries(getAllPowersets())) {
        if (SHORT_BY_DESIGN.test(id)) continue;
        graded++;
        const buyable = ps.powers.filter(isBuyablePick).length;
        if (buyable < 9) short.push(`${id}=${buyable}`);
      }
      expect(short).toEqual([]);
      expect(graded).toBeGreaterThanOrEqual(280);
    });
  });
}
