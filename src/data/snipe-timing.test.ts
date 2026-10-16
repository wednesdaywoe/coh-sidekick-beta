import { describe, it, expect } from 'vitest';
import { applyQuickSnipe } from '@/utils/quick-snipe';
import { RangedShot } from './datasets/homecoming/generated/powersets/blaster/primary/archery/ranged-shot';
import { RangedShot as RebirthRangedShot } from './datasets/rebirth/generated/powersets/blaster/primary/archery/ranged-shot';
import { LightningClap } from './datasets/homecoming/generated/powersets/dominator/secondary/electricity-assault/lightning-clap';

/**
 * Snipe base timing comes from the Normal (not-in-combat) redirect variant, not
 * the redirect shell — see extractSnipeBaseTiming in convert-powerset.cjs. The
 * shell's activation_time mirrors the fast (Quick) anim, so reading it made the
 * slotted snipe look instant even when slow. These load real snipes from the
 * committed dataset and lock in the fix against a future regen reverting it.
 */
describe('snipe base timing (Normal-variant cast, not the redirect shell)', () => {
  it('Ranged Shot: slow base cast 3.67s + 2s interrupt; fast form on quickSnipe', () => {
    expect(RangedShot.stats?.castTime).toBe(3.67); // NOT the shell's 1.67
    expect(RangedShot.stats?.interruptTime).toBe(2);
    expect(RangedShot.quickSnipe?.stats.castTime).toBe(1.67); // in-combat fast form

    // The fast form must not inherit the base's interrupt window.
    const fast = applyQuickSnipe(RangedShot, true);
    expect(fast.stats?.castTime).toBe(1.67);
    expect(fast.stats?.interruptTime).toBeUndefined();
  });

  it('detects snipes by the redirect pattern, not the (recycled) internal name', () => {
    // internalName "lightning_clap" is the Electricity Assault snipe "Zapp" —
    // recycled name; classified as a snipe by the STRUCTURE of its redirect pair
    // (the branch that drops the default form's interrupt), not by its gate text.
    expect(LightningClap.name).toBe('Zapp');
    expect(LightningClap.stats?.castTime).toBe(3.33);
    expect(LightningClap.stats?.interruptTime).toBe(2);
    expect(LightningClap.quickSnipe).toBeTruthy();
  });

  it('Rebirth snipes carry a fast form too, gated on the build ToHit', () => {
    // This case used to assert `quickSnipe` was UNDEFINED here, on the premise that
    // "Rebirth bakes the slow timing onto the base power (no Quick/Normal redirect)".
    // The premise was false and the assertion pinned a defect: Rebirth ships the same
    // redirect pair, gated on `cur.kToHit source> .97 >=` rather than Homecoming's
    // `kEngaged`/`Experienced_Marksman`, and the old detector matched only the latter —
    // so all 47 Rebirth and 8 Thunderspy snipes showed no fast form at all
    // (DATA-GAP-REGISTER data-gaps-146). The base timing assertions below were always right
    // and still come from the default (slow) branch.
    expect(RebirthRangedShot.stats?.castTime).toBe(4.67);
    expect(RebirthRangedShot.stats?.interruptTime).toBe(3);
    expect(RebirthRangedShot.quickSnipe?.stats.castTime).toBe(1.67);
    // The gate travels VERBATIM, token for token: nothing in the pipeline re-derives the
    // threshold, and nothing joins the tokens into a string it would later have to split
    // back apart (DATA-GAP-REGISTER data-gaps-123).
    expect(RebirthRangedShot.quickSnipe?.condition).toEqual([
      'cur.kToHit',
      'source>',
      '.97',
      '>=',
    ]);
  });
});
