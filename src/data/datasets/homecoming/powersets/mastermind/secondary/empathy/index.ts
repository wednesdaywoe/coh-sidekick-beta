/**
 * Empathy Powerset
 * Empathy gives you the ability to heal and aid allies as well as yourself. Empathy has no offensive powers, but its heals and buffs are unmatched, converting excess healing into absorb shields.
 *
 * Archetype: mastermind
 * Category: secondary
 * Source: mastermind_buff/empathy
 */

import type { Powerset } from '@/types';

import { SiphonEnergy as SiphonEnergy } from './siphon-energy';
import { HealOther as HealOther } from './heal-other';
import { AbsorbPain as AbsorbPain } from './absorb-pain';
import { Resurrect as Resurrect } from './resurrect';
import { ClearMind as ClearMind } from './clear-mind';
import { Fortitude as Fortitude } from './fortitude';
import { RecoveryAura as RecoveryAura } from './recovery-aura';
import { RegenerationAura as RegenerationAura } from './regeneration-aura';
import { AdrenalinBoost as AdrenalinBoost } from './adrenalin-boost';

export const powerset: Powerset = {
  id: 'mastermind/empathy',
  setPath: 'Mastermind_Buff.Empathy',
  name: 'Empathy',
  buyRequires: [],
  buyRequiresFailed: "",
  specializeAt: 0,
  specializeRequires: [],
  description: "Empathy gives you the ability to heal and aid allies as well as yourself. Empathy has no offensive powers, but its heals and buffs are unmatched, converting excess healing into absorb shields.",
  icon: 'empathy_set.ico',
  archetype: 'mastermind',
  category: 'secondary',
  powers: [
    SiphonEnergy,
    HealOther,
    AbsorbPain,
    Resurrect,
    ClearMind,
    Fortitude,
    RecoveryAura,
    RegenerationAura,
    AdrenalinBoost,
  ],
};

export default powerset;
