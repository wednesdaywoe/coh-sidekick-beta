/**
 * Super Strength Powerset
 * Super Strength gives you combat powers derived from your super-human physical strength. Super Strength powers tend to knock foes back.
 *
 * Archetype: tanker
 * Category: secondary
 * Source: tanker_melee/super_strength
 */

import type { Powerset } from '@/types';

import { Jab as Jab } from './jab';
import { Punch as Punch } from './punch';
import { Haymaker as Haymaker } from './haymaker';
import { Taunt as Taunt } from './taunt';
import { Rage as Rage } from './rage';
import { HandClap as HandClap } from './hand-clap';
import { KnockoutBlow as KnockoutBlow } from './knockout-blow';
import { Hurl as Hurl } from './hurl';
import { FootStomp as FootStomp } from './foot-stomp';

export const powerset: Powerset = {
  id: 'tanker/super-strength',
  setPath: 'Tanker_Melee.Super_Strength',
  name: 'Super Strength',
  buyRequires: [],
  buyRequiresFailed: "",
  specializeAt: 0,
  specializeRequires: [],
  description: "Super Strength gives you combat powers derived from your super-human physical strength. Super Strength powers tend to knock foes back.",
  icon: 'super_strength_set.ico',
  archetype: 'tanker',
  category: 'secondary',
  powers: [
    Jab,
    Punch,
    Haymaker,
    Taunt,
    Rage,
    HandClap,
    KnockoutBlow,
    Hurl,
    FootStomp,
  ],
};

export default powerset;
