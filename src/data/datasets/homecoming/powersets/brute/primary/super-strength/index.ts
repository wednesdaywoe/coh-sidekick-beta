/**
 * Super Strength Powerset
 * Super Strength gives you combat powers derived from your super-human physical strength. Super Strength powers tend to knock foes back.
 *
 * Archetype: brute
 * Category: primary
 * Source: brute_melee/super_strength
 */

import type { Powerset } from '@/types';

import { Jab as Jab } from './jab';
import { Punch as Punch } from './punch';
import { Haymaker as Haymaker } from './haymaker';
import { Rage as Rage } from './rage';
import { HandClap as HandClap } from './hand-clap';
import { Taunt as Taunt } from './taunt';
import { KnockoutBlow as KnockoutBlow } from './knockout-blow';
import { Hurl as Hurl } from './hurl';
import { FootStomp as FootStomp } from './foot-stomp';

export const powerset: Powerset = {
  id: 'brute/super-strength',
  setPath: 'Brute_Melee.Super_Strength',
  name: 'Super Strength',
  buyRequires: [],
  buyRequiresFailed: "",
  specializeAt: 0,
  specializeRequires: [],
  description: "Super Strength gives you combat powers derived from your super-human physical strength. Super Strength powers tend to knock foes back.",
  icon: 'super_strength_set.ico',
  archetype: 'brute',
  category: 'primary',
  powers: [
    Jab,
    Punch,
    Haymaker,
    Rage,
    HandClap,
    Taunt,
    KnockoutBlow,
    Hurl,
    FootStomp,
  ],
};

export default powerset;
