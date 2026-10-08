/**
 * STACKINFO-1 — the targets-hit slider, from the data that raises it to the control that shows it.
 *
 * `getStackingInfo` read the authored `effects` object for both of its arms and opened with
 * `if (!power.effects) return null`. STRIP-1 emptied that object corpus-wide, so it answered
 * `null` for every power on every fork and `InfoPanel.tsx` rendered no slider at all — the AoE
 * self-buff family showed its one-target value with no way to say how many foes it hit. The one
 * gate over it skipped itself on the same emptied data, which is why the regression outlasted
 * every failure that was loud.
 *
 * Two halves, because each is passable while the other fails:
 *
 * - **The data.** Both arms answer from the atoms, and each is floored SEPARATELY. The stack arm
 *   is the dominant subpopulation by roughly three to one, so a per-foe arm that went blind again
 *   would barely move a combined count.
 * - **The surface.** The panel's slider is gated on this function's result and its value reaches
 *   the engine, so a correct answer that no control reads is not a fix. There is no render
 *   harness in this repo, so that half is asserted against the source the way the BPORT1 census
 *   asserts the frozen oracle's switch.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDataset, DATASET_IDS, type DatasetId } from '@/data/dataset';
import { getAllPowersets } from '@/data/powersets';
import { getAllPowerPools } from '@/data/power-pools';
import { getAllEpicPools } from '@/data/epic-pools';
import { carriesPerTarget, maxStackCap } from '@/data/core/atom-query';
import { getStackingInfo } from './buildDisplayEffects';
import type { Power } from '@/types/power';

const REPO = join(import.meta.dirname ?? '', '..', '..', '..');

/** Every power a display surface can reach, deduplicated — powersets, pools and epics. */
function allPowers(): Power[] {
  const out: Power[] = [];
  const add = (r: Record<string, { powers?: Power[] }>) => {
    for (const group of Object.values(r)) out.push(...(group.powers ?? []));
  };
  add(getAllPowersets() as Record<string, { powers?: Power[] }>);
  add(getAllPowerPools() as Record<string, { powers?: Power[] }>);
  add(getAllEpicPools() as Record<string, { powers?: Power[] }>);
  const seen = new Set<string>();
  return out.filter((p) => seen.size !== seen.add(p.internalName).size);
}

/**
 * Does this power's AUTHORED bag state a stack — the metadata `getStackingInfo` used to read?
 *
 * Only the stacking keys. A power whose bag still carries a `stealth` or a `buffDuration` (31 on
 * homecoming, none elsewhere) is not a power whose slider could have come from the bag.
 */
function authoredStackingMetadata(power: Power): boolean {
  const effects = power.effects as Record<string, unknown> | undefined;
  if (!effects) return false;
  if (typeof effects.maxStacks === 'number') return true;
  const carries = (value: unknown): boolean =>
    typeof value === 'object' && value !== null
    && ('perTarget' in value || 'maxHPFractionPerTarget' in value);
  return Object.values(effects).some(
    (value) => carries(value)
      || (typeof value === 'object' && value !== null
        && Object.values(value as Record<string, unknown>).some(carries)),
  );
}

describe('STACKINFO-1 — the slider the atoms raise', () => {
  it.each(DATASET_IDS)('%s offers both arms, and neither is empty', async (server: DatasetId) => {
    await loadDataset(server);
    let perFoe = 0;
    let stacks = 0;
    let bagBacked = 0;
    for (const power of allPowers()) {
      const info = getStackingInfo(power);
      if (!info) continue;
      if (info.label === 'Targets Hit') {
        perFoe += 1;
        // The arm's own terms, restated: a per-foe increment on an atom and a bound to drag it
        // between. Restating rather than calling keeps the test from agreeing with the reader
        // however the reader is spelled.
        expect(carriesPerTarget(power), `${power.internalName} has no per-foe atom`).toBe(true);
        if (power.perTargetMaxTargets) {
          // Redirect-counted (Fulcrum Shift): one cast's foes, times however many casts can
          // stand at once — a whole number of casts, at least one.
          expect(info.perCast).toBe(power.perTargetMaxTargets);
          expect(info.maxStacks % power.perTargetMaxTargets).toBe(0);
          expect(info.maxStacks).toBeGreaterThanOrEqual(power.perTargetMaxTargets);
        } else {
          expect(info.maxStacks).toBe(power.stats?.maxTargets);
        }
        expect(info.minStacks === 0 || info.minStacks === 1).toBe(true);
      } else {
        stacks += 1;
        expect(info.label).toBe('Stacks');
        expect(info.minStacks).toBe(0);
        expect(info.maxStacks, `${power.internalName} stack depth`).toBe(maxStackCap(power));
      }
      if (authoredStackingMetadata(power)) bagBacked += 1;
    }
    // Floored per arm. A combined count stays healthy while the smaller arm dies.
    expect(perFoe, `${server}: no power carries a per-foe slider`).toBeGreaterThan(0);
    expect(stacks, `${server}: no power carries a stack-count slider`).toBeGreaterThan(0);
    // …and neither arm CAN have come from the bag: not one power that gets a slider carries the
    // authored metadata the old reader read. Asked of the stacking keys alone, not of the whole
    // `effects` object — 31 homecoming powers still carry an authored `stealth` or `buffDuration`,
    // and a bag being non-empty is a different fact from a bag stating a stack. This is the
    // assertion that would have caught the regression on the day STRIP-1 landed.
    expect(
      bagBacked,
      `${server}: ${bagBacked} slider carriers still author their own \`perTarget\` / ` +
        `\`maxStacks\` — if that is real the census needs re-measuring, and if it is not, the ` +
        `reader is back on the bag`,
    ).toBe(0);
    // eslint-disable-next-line no-console
    console.warn(`[STACKINFO-1] ${server}: ${perFoe} per-foe sliders, ${stacks} stack-count sliders`);
  }, 120000);
});

describe('STACKINFO-1 — the surface that shows it', () => {
  let panel = '';
  beforeAll(() => {
    panel = readFileSync(join(REPO, 'src/components/info/InfoPanel.tsx'), 'utf8');
  });

  it('gates the panel slider on this function and nothing else', () => {
    expect(panel).toContain('getStackingInfo(power)');
    // The control itself: rendered only when the call answered, and bounded by what it answered
    // with. A slider whose range came from anywhere else would not move when this does.
    expect(panel).toContain('{stackingInfo && ');
    expect(panel).toContain('min={stackingInfo.minStacks}');
    expect(panel).toContain('max={stackingInfo.maxStacks}');
    expect(panel).toContain('{stackingInfo.label}');
  });

  it('sends the setting to the key the engine adapter reads', () => {
    // `characterStateAdapter` maps `targetsHitValues[internalName]` onto each selected power's
    // `targets_hit`, which is the whole path from this control to a number on screen now that
    // the rendered rows come from the projection (ENGLAG-1). A slider writing anywhere else
    // would move nothing.
    expect(panel).toContain('setTargetsHit(powerName, Number(e.target.value))');
    expect(panel).toContain('s.targetsHitValues[powerName]');
    const adapter = readFileSync(join(REPO, 'src/engine/characterStateAdapter.ts'), 'utf8');
    expect(adapter).toContain('targets_hit: p.internalName in targetsHitValues');
  });
});
