import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getDestinyEffects, getHybridEffects, getAlphaEffects } from '@/data';
import { calculateCharacterTotals } from '@/utils/calculations/character-totals';
import { createEmptyBuild } from '@/types/build';
import { createDefaultIncarnateActiveState } from '@/types/incarnate';
import type { SelectedIncarnatePower } from '@/types/incarnate';

/**
 * Incarnate effect-completeness audit (2026-07-03).
 *
 * The Destiny/Hybrid converter was an allowlist keyed on Homecoming's Parse7
 * (attrib, aspect) pairs; anything unmapped hit a silent `continue`, so whole
 * effect categories were dropped and several powers rendered empty or wrong:
 *   - Rebirth Destiny: the heal (Heal_Dmg/Absolute) and core-path +Max HP
 *     (HitPoints/Maximum) were dropped — rebirth_core_invocation generated `{}`.
 *   - Clarion Destiny: mez protection (all six control types) + KB/KU protection
 *     were dropped (skipped with an "targets enemies" comment), and its mez
 *     RESISTANCE was flattened into debuffResistance, showing a bogus 300%.
 *   - Rebirth/Parse6 Clarion Radial: an aspect=Strength "+buff-strength"
 *     amplifier leaked ~20 lowercased junk keys via `attrib.toLowerCase()`.
 *   - Hybrid Support: aspect=Strength +damage/+accuracy was dropped, and a
 *     uniform multi-attrib buff summed per attrib (8 damage types → 8×).
 *
 * These guard the fixes: the effects are present, correct, and not N×-inflated.
 */

const REBIRTH_TIERS = [
  'rebirth_invocation', 'rebirth_core_invocation', 'rebirth_radial_invocation',
  'rebirth_partial_core_invocation', 'rebirth_partial_radial_invocation',
  'rebirth_total_core_invocation', 'rebirth_total_radial_invocation',
  'rebirth_core_epiphany', 'rebirth_radial_epiphany',
];
// Rebirth's Core path (invocation excluded — the T1 has heal only) grants +Max HP.
const REBIRTH_MAXHP_TIERS = [
  'rebirth_core_epiphany', 'rebirth_partial_core_invocation', 'rebirth_total_core_invocation',
];
const CLARION_TIERS = [
  'clarion_invocation', 'clarion_core_invocation', 'clarion_radial_invocation',
  'clarion_partial_core_invocation', 'clarion_partial_radial_invocation',
  'clarion_total_core_invocation', 'clarion_total_radial_invocation',
  'clarion_core_epiphany', 'clarion_radial_epiphany',
];

function destinySlot(powerId: string): SelectedIncarnatePower {
  return {
    slotId: 'destiny', powerId, powerName: powerId, displayName: powerId,
    icon: '', tier: 'rare', treeId: 'clarion', treeName: 'Clarion',
  };
}
function scrapperBuild(destiny: SelectedIncarnatePower | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = createEmptyBuild();
  b.level = 50;
  b.archetype = { id: 'scrapper', name: 'Scrapper', stats: null, inherent: null };
  if (destiny) b.incarnates.destiny = destiny;
  return b;
}

describe('Homecoming Destiny — dropped effects are now exposed', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  it('Rebirth exposes its click heal for every tier (was empty {})', () => {
    for (const id of REBIRTH_TIERS) {
      const fx = getDestinyEffects(id);
      expect(fx, `missing ${id}`).toBeDefined();
      expect(fx!.healScale, `${id} heal dropped`).toBeGreaterThan(0);
      expect(fx!.healTable).toBe('Ranged_Tempdamage');
    }
    // The formerly-empty core tiers now carry real data.
    expect(getDestinyEffects('rebirth_core_invocation')!.healScale).toBe(6);
    expect(getDestinyEffects('rebirth_invocation')!.healScale).toBe(5);
  });

  it('Rebirth Core-path tiers carry a +Max HP buff (stored as a fraction)', () => {
    for (const id of REBIRTH_MAXHP_TIERS) {
      const fx = getDestinyEffects(id);
      expect(fx!.maxHP, `${id} maxHP`).toBeGreaterThan(0);
      // scale 2 → +20% (scale × 0.1 fraction), consumed as ×100.
      expect(fx!.maxHP).toBeCloseTo(0.2, 6);
    }
    // Radial path heals+regens instead — no Max HP.
    expect(getDestinyEffects('rebirth_radial_epiphany')!.maxHP).toBeUndefined();
  });

  it('Clarion exposes mez + KB protection for every tier (was dropped)', () => {
    for (const id of CLARION_TIERS) {
      const fx = getDestinyEffects(id);
      expect(fx!.mezProtection, `${id} mezProtection`).toBeGreaterThan(0);
      expect(fx!.kbProtection, `${id} kbProtection`).toBeGreaterThan(0);
    }
    const core = getDestinyEffects('clarion_core_epiphany')!;
    expect(core.mezProtection).toBe(21);
    expect(core.kbProtection).toBe(10.5);
  });

  it('Clarion debuffResistance is the real (Repel) value; PvP-only status-resistance is excluded from PvE', () => {
    const core = getDestinyEffects('clarion_core_epiphany')!;
    // Repel resistance (0.7) is the genuine PvE debuff-resistance value; it used
    // to masquerade as "300% Debuff Resistance" when the confuse/status
    // resistance (2.1) was mis-bucketed here.
    expect(core.debuffResistance).toBeCloseTo(0.7, 6);
    // The bogus number is gone: debuffResistance is no longer the confuse mag.
    expect(core.debuffResistance).not.toBeCloseTo(2.1, 3);
    // The mez/status DURATION resistance (2.1) is `is_pvp=PVP_ONLY` in the bin —
    // Destiny PvP-awareness (converter) now correctly drops it from PvE totals,
    // so it must NOT surface here (was leaking as a bogus 210% PvE status resist).
    expect(core.statusResistance).toBeUndefined();
  });

  it('Incandescence Radial surfaces its run-speed buff (was dropped)', () => {
    const fx = getDestinyEffects('incandescence_radial_epiphany')!;
    expect(fx.runSpeed).toBeCloseTo(0.35, 6);
  });

  it('Clarion mez + KB protection feed the status-protection totals (was display-only)', () => {
    const base = calculateCharacterTotals(scrapperBuild(null), false, createDefaultIncarnateActiveState(), { combatMode: false });
    const withClarion = calculateCharacterTotals(
      scrapperBuild(destinySlot('clarion_core_epiphany')), false, createDefaultIncarnateActiveState(), { combatMode: false },
    );
    const g = withClarion.globalBonuses;
    // A flat magnitude to all six control types...
    for (const key of ['protHold', 'protStun', 'protImmobilize', 'protSleep', 'protConfuse', 'protFear'] as const) {
      expect(g[key], `${key}`).toBeGreaterThan(base.globalBonuses[key]);
    }
    // ...uniformly (Clarion protects every control type equally).
    expect(g.protHold).toBe(g.protStun);
    expect(g.protHold).toBe(g.protFear);
    // ...and knockback protection is its own total.
    expect(g.protKnockback).toBeGreaterThan(base.globalBonuses.protKnockback);
  });
});

describe('Hybrid Support — aspect=Strength buffs, not N×-inflated', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  it('surfaces +damage/+accuracy strength as a single buff (not 8× summed)', () => {
    // T4 Support (Total Radial Graft) buffs +6% damage strength across all eight
    // damage types in ONE template — must read 0.06, not 8 × 0.06 = 0.48.
    const fx = getHybridEffects('support_total_radial_graft');
    expect(fx, 'missing support_total_radial_graft').toBeDefined();
    expect(fx!.frontLoaded.damage).toBeCloseTo(0.06, 6);
    expect(fx!.frontLoaded.accuracy).toBeCloseTo(0.06, 6);
    // Distinct defense positions still each apply.
    expect(fx!.frontLoaded.defMelee).toBeCloseTo(0.06, 6);
  });
});

describe('Hybrid Support Core — leaguemate buff is not dropped (deductive-schema-harness-8)', () => {
  // The Core Support Hybrids gate their buff with `enttype target> player eq`
  // (the player-leaguemate value the caster receives) + `enttype target> critter
  // eq` (pets, "doubled in strength"). extractHybrid recognized only empty-req /
  // self-RPN / per-target-RPN, so the whole Core buff was routed nowhere and the
  // caster saw an empty frontLoaded — while the Radial line (empty req) worked.
  // Fixed by recognizing the `player eq` leaguemate pattern via POLARITY
  // (a beneficial buff, scale > 0) and a case-insensitive match — NOT the
  // parser's is_pvp flag, which Parse6 (Rebirth/Thunderspy) synthesizes as
  // PVP_ONLY for every `player eq` group. Values + key-sets are the in-game help.
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  const CORE_TIERS = [
    'support_core_genome', 'support_total_core_graft',
    'support_partial_core_graft', 'support_core_embodiment',
  ];

  it('every Core tier surfaces a non-empty caster buff (was empty {})', () => {
    for (const id of CORE_TIERS) {
      const fx = getHybridEffects(id);
      expect(fx, `missing ${id}`).toBeDefined();
      expect(Object.keys(fx!.frontLoaded).length, `${id} frontLoaded empty`).toBeGreaterThan(0);
    }
  });

  it('Support Core Embodiment grants +6% Damage/Accuracy/Defense(All) to the caster', () => {
    // Help: "+Damage, +Accuracy, +Defense(All) to all leaguemates ... doubled for
    // pets". The caster is a player-leaguemate → gets the 0.06 (not the 0.12 pet) value.
    const fx = getHybridEffects('support_core_embodiment')!;
    expect(fx.frontLoaded.damage).toBeCloseTo(0.06, 6);
    expect(fx.frontLoaded.accuracy).toBeCloseTo(0.06, 6);
    expect(fx.frontLoaded.defMelee).toBeCloseTo(0.06, 6);
    expect(fx.frontLoaded.defPsionic).toBeCloseTo(0.06, 6); // Defense(All)
  });

  it('Support Core Genome buffs only the six help-listed defense positions', () => {
    // Help: "+Damage(All) and Defense(Melee, AoE, Smashing, Lethal, Energy, Negative)".
    const fx = getHybridEffects('support_core_genome')!;
    expect(fx.frontLoaded.damage).toBeCloseTo(0.02, 6);
    expect(fx.frontLoaded.defMelee).toBeCloseTo(0.02, 6);
    expect(fx.frontLoaded.defEnergy).toBeCloseTo(0.02, 6);
    // not in the help list, and no accuracy on this tier:
    expect(fx.frontLoaded).not.toHaveProperty('defFire');
    expect(fx.frontLoaded).not.toHaveProperty('accuracy');
  });
});

describe('Rebirth dataset (Parse6) — no junk keys, no N× collapse', () => {
  beforeAll(async () => {
    await loadDataset('rebirth');
  });

  it('Clarion mez protection is not 6×-inflated (Parse6 splits the six types)', () => {
    // HC packs all six mez types into one template; Parse6 emits one per type.
    // Collapsing same-duration duplicates keeps the magnitude at 21, not 126.
    expect(getDestinyEffects('clarion_core_epiphany')!.mezProtection).toBe(21);
  });

  it('no lowercased junk keys leak from the aspect=Strength catch-all', () => {
    // Rebirth's Clarion Radial is a broad "+buff-strength" amplifier; the old
    // `attrib.toLowerCase()` fallthrough leaked keys like melee/tohit/absorb/held.
    const JUNK = [
      'melee', 'ranged', 'area', 'smashing', 'lethal', 'fire', 'cold', 'energy',
      'psionic', 'toxic', 'tohit', 'absorb', 'range', 'held', 'stunned', 'sleep',
      'confused', 'immobilized', 'terrorized', 'afraid', 'runningspeed', 'flyingspeed',
    ];
    for (const id of CLARION_TIERS) {
      const fx = getDestinyEffects(id);
      if (!fx) continue;
      for (const junk of JUNK) {
        expect(fx, `${id} leaked junk key '${junk}'`).not.toHaveProperty(junk);
      }
    }
  });

  it('Ageless Radial debuff resistance is consolidated to ~50% (was scattered)', () => {
    const fx = getDestinyEffects('ageless_radial_epiphany')!;
    expect(fx.debuffResistance).toBeCloseTo(0.5, 6);
  });

  it('Support Core Hybrid leaguemate buff survives Parse6 (deductive-schema-harness-8) — two traps', () => {
    // Rebirth's Support Core showed an EMPTY caster buff for two Parse6-only
    // reasons the HC-tuned code missed:
    //   1. CASE — Rebirth writes `Enttype target> player eq` (capital E); the
    //      leaguemate match was lowercase-only.
    //   2. SYNTHESIZED is_pvp — Parse6 has no is_pvp field, so the bin parser
    //      derives it from the requires target-type and marks every `player eq`
    //      group PVP_ONLY. The old guard (`is_pvp != PVP_ONLY`) then dropped it.
    // Fixed by keying on polarity (scale > 0) + a case-insensitive match. HC's
    // explicit is_pvp=EITHER for the same buff is the ground truth.
    const emb = getHybridEffects('support_core_embodiment')!;
    expect(emb, 'Support Core Embodiment missing').toBeDefined();
    expect(Object.keys(emb.frontLoaded).length, 'empty frontLoaded').toBeGreaterThan(0);
    expect(emb.frontLoaded.damage).toBeCloseTo(0.06, 6);
    expect(emb.frontLoaded.accuracy).toBeCloseTo(0.06, 6);
    expect(emb.frontLoaded.defMelee).toBeCloseTo(0.06, 6);
  });

  it('Support Core damage is not 8×-inflated by the Parse6 per-attrib split', () => {
    // HC packs eight `*_Dmg` types into one template; Parse6 emits eight groups.
    // All collapse to the one `damage` stat — without the (bucket,key,scale)
    // dedup they sum to +48% for a +6% buff. Must read 0.06, not 0.48.
    expect(getHybridEffects('support_core_embodiment')!.frontLoaded.damage).toBeCloseTo(0.06, 6);
    expect(getHybridEffects('support_core_genome')!.frontLoaded.damage).toBeCloseTo(0.02, 6);
  });
});

describe('Thunderspy dataset (Parse6) — Support Hybrid parity', () => {
  beforeAll(async () => {
    await loadDataset('thunderspy');
  });

  it('Support Core line surfaces non-empty caster frontLoaded buffs', () => {
    for (const id of ['support_core_genome', 'support_total_core_graft', 'support_core_embodiment']) {
      const fx = getHybridEffects(id);
      expect(fx, `missing ${id}`).toBeDefined();
      expect(Object.keys(fx!.frontLoaded).length, `${id} frontLoaded empty`).toBeGreaterThan(0);
      expect(fx!.frontLoaded.damage, `${id} damage`).toBeGreaterThan(0);
      // The tspy bin's index array names only the Melee defense position
      // (count=1, byte-verified 2026-07-07) — defMelee, not the old
      // `Defense`-category defenseAll guess.
      expect(fx!.frontLoaded.defMelee, `${id} defMelee`).toBeGreaterThan(0);
    }
  });

  it('Support passives include enduranceDiscount by tier (was missing linkage)', () => {
    expect(getHybridEffects('support_genome')!.passive.enduranceDiscount).toBeCloseTo(0.025, 6);
    expect(getHybridEffects('support_core_genome')!.passive.enduranceDiscount).toBeCloseTo(0.05, 6);
    expect(getHybridEffects('support_total_core_graft')!.passive.enduranceDiscount).toBeCloseTo(0.075, 6);
    expect(getHybridEffects('support_core_embodiment')!.passive.enduranceDiscount).toBeCloseTo(0.1, 6);
  });
});

// Thunderspy (Parse6) omits the Grant_Power linkage on Alpha main powers (they
// carry only a bare `Ones` marker), so extractGrantedPowers found nothing and
// every one of the 72 Alpha entries rendered empty — a slotted Agility/Cardiac/…
// gave the tspy planner ZERO enhancement. The converter now recovers the linkage
// from the parallel Homecoming alpha power and resolves it against tspy's OWN
// silent-file scales, folding in tspy's split `Ones` ED-bypass template.
describe('Thunderspy dataset (Parse6) — Alpha enhancement linkage', () => {
  beforeAll(async () => {
    await loadDataset('thunderspy');
  });

  it('Alpha entries are populated (recovered linkage), not empty', () => {
    // Every ability core-paragon grants its full 3-aspect set.
    const agility = getAlphaEffects('agility_core_paragon')!;
    expect(agility.enduranceModification, 'agility endMod').toBeGreaterThan(0);
    expect(agility.recharge, 'agility recharge').toBeGreaterThan(0);
    expect(agility.defense, 'agility defense').toBeGreaterThan(0);

    const musculature = getAlphaEffects('musculature_core_paragon')!;
    expect(musculature.damage, 'musc damage').toBeGreaterThan(0);
  });

  it('folds the split `Ones` ED-bypass portion into the total (regular + Ones)', () => {
    // tspy stores accuracy as Accuracy(0.11) + Ones(0.22); the total is 0.33,
    // matching HC — the pre-fix firstAttrib-only sum would have kept only 0.11.
    // Nerve Core Paragon grants accuracy_plus_very_rare (0.15 + 0.30 = 0.45).
    expect(getAlphaEffects('nerve_core_paragon')!.accuracy).toBeCloseTo(0.45, 4);
    // Agility Core Paragon's enduranceModification = recovery_plus_very_rare
    // (Endurance 0.15 + Ones 0.30 = 0.45).
    expect(getAlphaEffects('agility_core_paragon')!.enduranceModification).toBeCloseTo(0.45, 4);
    // Recharge has no ED-bypass split (Ones=0); recharge_very_rare stays 0.33.
    expect(getAlphaEffects('agility_core_paragon')!.recharge).toBeCloseTo(0.33, 4);
  });
});
