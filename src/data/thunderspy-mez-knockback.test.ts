import { describe, it, expect } from 'vitest';
import { atomsOf, type AtomSource } from '@/data/core/atom-query';
// Recovered APPLIED mez / offensive knockback — read straight from the committed
// generated base (pre-override), so a future regen can't silently undo the fix.
import { Fossilize } from './datasets/thunderspy/generated/powersets/controller/primary/earth-control/fossilize';
import { Blind } from './datasets/thunderspy/generated/powersets/controller/primary/illusion-control/blind';
import { FreezeRay } from './datasets/thunderspy/generated/powersets/blaster/primary/ice-blast/freeze-ray';
import { CobraStrike } from './datasets/thunderspy/generated/powersets/tanker/secondary/martial-arts/cobra-strike';
import { EMPPulse } from './datasets/thunderspy/generated/powersets/controller/secondary/radiation-emission/emp-pulse';
import { FootStomp } from './datasets/thunderspy/generated/powersets/brute/primary/super-strength/foot-stomp';
import { Geyser } from './datasets/thunderspy/generated/powersets/blaster/primary/water-blast/geyser';
// Guard negative case: a Self-targeted +mez-strength self-buff whose index names a mez.
import { PowerBoost } from './datasets/thunderspy/generated/powersets/blaster/secondary/energy-manipulation/power-boost';
// Sign-rule negative case: a foe Hold carrying a negative-scale Stun debuff artifact.
import { TimeStop } from './datasets/thunderspy/generated/powersets/defender/primary/time-manipulation/time-stop';
// Protection carve-out: self armor and ally mez shield, both foe-less by nature.
import { Fortification } from './datasets/thunderspy/generated/powersets/arachnos-soldier/epic/crab-spider-training/fortification';
import { ClearMind } from './datasets/thunderspy/generated/powersets/defender/primary/empathy/clear-mind';

/**
 * Thunderspy applied-mez & offensive-knockback recovery — the DATA-DRIVEN fix.
 *
 * Thunderspy's AttribMod schema names the APPLIED mez/KB only in the post-`requires`
 * INDEX array (the front string is the enhancement/duration CATEGORY — a Hold reads
 * front `Immobilize`/`Sleep`, a Stun reads `Stun`), stores the real Magnitude in the
 * post-table slot (k+12, not the flat template `magnitude`), and drops the AttribMod
 * aspect + per-template target. The parser historically read only the front, so every
 * mez was MISLABELLED (Blind/Fossilize emitted `immobilize` instead of `hold`) at a
 * flat Mag 1, and every `Ones`-front mez / offensive knockdown was dropped entirely.
 *
 * The fix (`_parse_effect_template_thunderspy`) relabels the front to the lone index
 * mez attrib and adopts the k+12 Magnitude (verified: index type == HC on 415/422
 * shared powers, k+12 == HC magnitude exactly where tspy didn't rebalance). Offensive
 * knockback/knockup is relabeled from a `Ones` front only when instant (duration 0) and
 * positive — durational / protection KB stays excluded (GAME-DATA-PRINCIPLES §3). The
 * self/ally target-trap (a self-buff whose index names a mez) is vetoed by
 * `guardThunderspyAppliedMez` on the power's `targets_affected` (§7).
 *
 * These re-read the recovered shape from the committed dataset (GAME-DATA-PRINCIPLES
 * §9). The data-gaps-327 bag strip retired the `effects` projection these once asserted on;
 * the claims are now stated on the ATOMS, discriminated the way a surfacing fix must
 * be (subtype + face + sign), never by the attrib NAME.
 */
/** True when the power carries an always-on atom of `effectType`+`subType` matching `pred`. */
function hasAtom(
  power: AtomSource,
  effectType: string,
  subType: string,
  pred: (a: ReturnType<typeof atomsOf>[number]) => boolean = () => true,
) {
  return atomsOf(power).some(
    (a) => a.effectType === effectType && a.subType?.toLowerCase() === subType.toLowerCase() && pred(a),
  );
}

describe('Thunderspy applied-mez & knockback recovery (data-driven)', () => {
  // --- Type corrected from the index array (front != applied mez) -----------
  it('Blind is a Mag-3 Hold, not the front-string Immobilize', () => {
    // front `Immobilize` (enhancement category) → index `Held`; k+12 Magnitude 3.
    const hold = atomsOf(Blind).find((a) => a.effectType === 'Mez' && a.subType === 'Held' && a.magnitude === 3);
    expect(hold).toBeDefined();
    expect(hold!.scale).toBe(10);
    expect(hold!.modifierTable).toBe('Ranged_Immobilize');
    expect(hold!.attribType).toBe('Duration');
    // No Immobilize-slot atom — the fix relabelled the front, it did not keep it.
    expect(hasAtom(Blind, 'Mez', 'Immobilized')).toBe(false);
  });

  it('Fossilize is a Mag-3 Hold (was mislabelled immobilize Mag 1)', () => {
    const hold = atomsOf(Fossilize).find((a) => a.effectType === 'Mez' && a.subType === 'Held' && a.magnitude === 3);
    expect(hold).toBeDefined();
    expect(hold!.scale).toBe(12);
    expect(hold!.modifierTable).toBe('Ranged_Immobilize');
    expect(hasAtom(Fossilize, 'Mez', 'Immobilized')).toBe(false);
  });

  it('Freeze Ray is a Mag-3 Hold even though its front string / table is Sleep', () => {
    const hold = atomsOf(FreezeRay).find((a) => a.effectType === 'Mez' && a.subType === 'Held' && a.magnitude === 3);
    expect(hold).toBeDefined();
    expect(hold!.scale).toBe(8);
    expect(hold!.modifierTable).toBe('Ranged_Sleep');
    expect(hasAtom(FreezeRay, 'Mez', 'Sleep')).toBe(false);
  });

  // --- Magnitude corrected from the placeholder (type already matched) -------
  it('Cobra Strike keeps its Stun type but at the real Mag 3 (was Mag 1)', () => {
    const stun = atomsOf(CobraStrike).find((a) => a.effectType === 'Mez' && a.subType === 'Stunned' && a.magnitude === 3);
    expect(stun).toBeDefined();
    expect(stun!.scale).toBe(10);
    expect(stun!.modifierTable).toBe('Melee_Stun');
  });

  // --- PBAoE control cast on Self but foe-facing → KEPT (targets_affected=Foe)
  it('EMP Pulse (PBAoE, target_type Self) keeps its Mag-3 Hold — targets_affected is Foe', () => {
    const hold = atomsOf(EMPPulse).find((a) => a.effectType === 'Mez' && a.subType === 'Held' && a.magnitude === 3);
    expect(hold).toBeDefined();
    expect(hold!.scale).toBe(15);
    expect(hold!.modifierTable).toBe('Ranged_Immobilize');
  });

  // --- Offensive knockdown / knockup recovered from a Ones front ------------
  it('Foot Stomp recovers its offensive knockdown (Ones-front, instant)', () => {
    const kb = atomsOf(FootStomp).find((a) => a.effectType === 'Mez' && a.subType === 'Knockback');
    expect(kb).toBeDefined();
    expect(kb!.scale).toBeCloseTo(0.67, 5);
    expect(kb!.modifierTable).toBe('Melee_Ones');
    expect(kb!.duration).toBe(0); // instant — durational / protection KB stays excluded
  });

  it('Geyser recovers its offensive knockup', () => {
    const ku = atomsOf(Geyser).find((a) => a.effectType === 'Mez' && a.subType === 'Knockup');
    expect(ku).toBeDefined();
    expect(ku!.scale).toBeCloseTo(1.5, 5);
    expect(ku!.modifierTable).toBe('Ranged_Ones');
    expect(ku!.duration).toBe(0);
  });

  // --- Aspect distinguishes mez-STRENGTH from applied mez (data-gaps-75) --------------
  it('Power Boost gains its mez-STRENGTH buff (specialBuff.stun), not an applied Stun', () => {
    // Power Boost is a +Strength self-buff (the Power Boost family): its `Stun` template is
    // aspect=Strength, toWho=Self — a buff to the CASTER'S stun MAGNITUDE (the atom type is
    // `Enhancement`, subType `Stunned`), not an applied Stun mez (type `Mez`). Before data-gaps-75
    // recovered the AttribMod aspect, the blank aspect (plus targets_affected=['Self']) made
    // guardThunderspyAppliedMez drop the whole template, so the power carried nothing.
    const strength = atomsOf(PowerBoost).find(
      (a) => a.effectType === 'Enhancement' && (a.subType ?? '').toLowerCase() === 'stunned' && a.aspect === 'Str',
    );
    expect(strength).toBeDefined();
    expect(strength!.scale).toBeCloseTo(0.75, 5);
    expect(strength!.modifierTable).toBe('Melee_Ones');
    expect(strength!.ignoreStrength).toBe(true);
    // And it is STILL not an applied Stun mez.
    expect(hasAtom(PowerBoost, 'Mez', 'Stun')).toBe(false);
  });

  // --- Sign rule: a negative-scale mez on a duration table is not applied --------
  it('Time Stop is a pure Hold — its negative-scale Stun artifact is not emitted', () => {
    const hold = atomsOf(TimeStop).find((a) => a.effectType === 'Mez' && a.subType === 'Held' && a.magnitude === 3);
    expect(hold).toBeDefined();
    expect(hold!.scale).toBe(8);
    expect(hold!.modifierTable).toBe('Ranged_Immobilize');
    // The negative-scale Stun artifact must not surface as applied Stun.
    expect(hasAtom(TimeStop, 'Mez', 'Stun')).toBe(false);
  });

  // --- Mez PROTECTION shares the mez slots and is foe-less too ------------------
  // The target-trap veto keys on "affects no foe", which is also true of every armor
  // and ally mez shield. Negative scale at aspect=Cur is the discriminator: applied
  // control is always positive. Dropping these left the whole Thunderspy fork
  // without status protection while its HC and Rebirth twins carried it.
  it('Fortification keeps its self status protection (Rebirth twin carries the same −24)', () => {
    // attribType `Magnitude`, a `res_boolean` table, signed scale, toWho Self — the
    // reading is the atom's, not a bag spelling.
    for (const sub of ['Stunned', 'Sleep', 'Immobilized', 'Held']) {
      const prot = atomsOf(Fortification).find((a) => a.effectType === 'Mez' && a.subType === sub);
      expect(prot, `missing protection.${sub}`).toBeDefined();
      expect(prot!.scale).toBe(-24);
      expect(prot!.modifierTable).toBe('Melee_Res_Boolean');
      expect(prot!.attribType).toBe('Magnitude');
      expect(prot!.toWho).toBe('Self');
    }
  });

  it('Clear Mind keeps its ALLY-cast protection — recipient is not part of the test', () => {
    // toWho `Target`, not `Self`: the protection rule is sign + face, nothing else — so
    // the signed scale rides with no self mark. Fear is the `Terrorized` subtype.
    for (const sub of ['Held', 'Terrorized']) {
      const prot = atomsOf(ClearMind).find((a) => a.effectType === 'Mez' && a.subType === sub);
      expect(prot, `missing protection.${sub}`).toBeDefined();
      expect(prot!.scale).toBe(-30);
      expect(prot!.modifierTable).toBe('Ranged_Res_Boolean');
      expect(prot!.attribType).toBe('Magnitude');
    }
  });
});