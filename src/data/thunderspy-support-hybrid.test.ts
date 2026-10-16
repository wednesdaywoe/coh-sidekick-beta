import { describe, it, expect } from 'vitest';
import { GENERATED_HYBRID_EFFECTS as TSPY_HYBRID } from '@/data/datasets/thunderspy/generated/incarnate-effects';
import { GENERATED_HYBRID_EFFECTS as HC_HYBRID } from '@/data/datasets/homecoming/generated/incarnate-effects';

/**
 * Thunderspy Support Hybrid — generic-attrib map (deductive-schema-harness-8).
 *
 * Thunderspy stores each hybrid buff with a generic front-category token
 * (`Damage`/`Ones`/`Defense`/`Accuracy`) and all-zero aspect bytes; the REAL
 * affected attribs live in the post-`requires` index array. The bin parser now
 * relabels the front to the resolved index attribs and synthesizes the aspect
 * (see `_parse_effect_template_thunderspy` in _powers.py), so the export carries
 * real per-attrib rows like HC/Rebirth and the converter's shared branches apply:
 * `*_Dmg`@Strength → damage, `Accuracy`@Strength → accuracy, and the index-named
 * defense position (`Melee`@Current) → defMelee. Note the tspy bin names ONLY
 * the Melee position for the Support defense row (count=1 in the index array,
 * verified against the raw bytes 2026-07-07) — the earlier `Defense`→defenseAll
 * category guess overstated it, and even HC's tier-1 row is Melee/Smashing/Lethal,
 * not all 11.
 *
 * The excluded `Ones`/`Stunned` tokens are the help's "+Special" (heal- and
 * mez-strength) that HC and Rebirth both drop (team buff-strength, no self stat).
 *
 * These tests pin the fix so a re-gen can't silently drop the Support tree back
 * to empty, and pin the cross-server value agreement (tspy did not rebalance).
 */

// Support Hybrid tiers, by generated slug → expected player-facing scale.
// tspy's `player eq` leaguemate branch scale == HC's leaguemate scale exactly.
const SUPPORT_TIERS: Record<string, number> = {
  support_genome: 0.02, // Support Genome (base)
  support_genome_2: 0.02, // Support Core Genome
  support_genome_3: 0.02, // Support Radial Genome
  support_genome_4: 0.04, // Support Total Core Graft
  support_genome_5: 0.03, // Support Partial Core Graft
  support_genome_6: 0.08, // Support Partial Radial Graft
  support_genome_7: 0.06, // Support Total Radial Graft
  support_genome_8: 0.06, // Support Core Embodiment
  support_genome_9: 0.08, // Support Radial Embodiment
};

// The Radial/Graft tiers that grant +Accuracy (present on both HC and tspy).
const HAS_ACCURACY = new Set([
  'support_genome_3', 'support_genome_4', 'support_genome_6',
  'support_genome_7', 'support_genome_8', 'support_genome_9',
]);

describe('Thunderspy Support Hybrid generic-attrib map', () => {
  it('every Support tier now renders a non-empty frontLoaded buff', () => {
    for (const id of Object.keys(SUPPORT_TIERS)) {
      const e = TSPY_HYBRID[id];
      expect(e, id).toBeTruthy();
      expect(Object.keys(e.frontLoaded).length, `${id} frontLoaded empty`).toBeGreaterThan(0);
    }
  });

  it('maps Damage→damage and the index-named Defense position→defMelee at the correct scale on every tier', () => {
    for (const [id, scale] of Object.entries(SUPPORT_TIERS)) {
      const fl = TSPY_HYBRID[id].frontLoaded as Record<string, number>;
      expect(fl.damage, `${id} damage`).toBeCloseTo(scale, 6);
      expect(fl.defMelee, `${id} defMelee`).toBeCloseTo(scale, 6);
    }
  });

  it('emits accuracy on exactly the tiers that grant it (matching HC)', () => {
    for (const id of Object.keys(SUPPORT_TIERS)) {
      const fl = TSPY_HYBRID[id].frontLoaded as Record<string, number>;
      if (HAS_ACCURACY.has(id)) {
        expect(fl.accuracy, `${id} should have accuracy`).toBeCloseTo(SUPPORT_TIERS[id], 6);
      } else {
        expect(fl.accuracy, `${id} should NOT have accuracy`).toBeUndefined();
      }
    }
  });

  it('drops the "+Special" tokens — no heal/mez-strength keys leak into the buff', () => {
    for (const id of Object.keys(SUPPORT_TIERS)) {
      const fl = TSPY_HYBRID[id].frontLoaded as Record<string, number>;
      // Ones (heal + non-stun mez strength) and Stunned map to nothing. Defense
      // POSITIONS and TYPES are not leaks — Rebirth's Support Genome tiers carry the
      // same Melee/Area/Smashing/Lethal/Energy/Negative rows one per AttribMod, where
      // tspy packs them into one multi-attrib mod that was unreachable until the
      // parser walked every sub-record (data-gaps-74). What this guards is that no heal or
      // mez-strength key appears.
      const allowed = /^(damage|accuracy|def[A-Z]\w*)$/;
      for (const k of Object.keys(fl)) {
        expect(allowed.test(k), `${id} unexpected key ${k}`).toBe(true);
      }
    }
  });

  it('agrees with HC on damage/accuracy scale + accuracy presence (no tspy rebalance)', () => {
    for (const id of Object.keys(SUPPORT_TIERS)) {
      const tspy = TSPY_HYBRID[id].frontLoaded as Record<string, number>;
      const hc = HC_HYBRID[id].frontLoaded as Record<string, number>;
      expect(tspy.damage, `${id} damage vs HC`).toBeCloseTo(hc.damage, 6);
      expect('accuracy' in tspy, `${id} accuracy presence vs HC`).toBe('accuracy' in hc);
      if ('accuracy' in hc) {
        expect(tspy.accuracy, `${id} accuracy vs HC`).toBeCloseTo(hc.accuracy, 6);
      }
    }
  });
});
