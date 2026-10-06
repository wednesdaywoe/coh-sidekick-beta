/**
 * Sonic Aura Powerset
 * You can use your ability to manipulate sound and vibrations to protect yourself from incoming attacks as well as debuff the resistances of enemies around you. Although you specialize in preventing damage, you also can use various techniques to recover health over time and travel quickly.
 *
 * Archetype: sentinel
 * Category: secondary
 * Source: sentinel_defense/sonic_aura
 */

import type { Powerset } from '@/types';

import { SonicDiffusion as SonicDiffusion } from './sonic-diffusion';
import { AttenuationBlanket as AttenuationBlanket } from './attenuation-blanket';
import { SomaticTherapy as SomaticTherapy } from './somatic-therapy';
import { HarmonicDistortion as HarmonicDistortion } from './harmonic-distortion';
import { DisruptionStrike as DisruptionStrike } from './disruption-strike';
import { SupersonicFlow as SupersonicFlow } from './supersonic-flow';
import { NoiseCancellation as NoiseCancellation } from './noise-cancellation';
import { SonicBoom as SonicBoom } from './sonic-boom';
import { PerfectHarmony as PerfectHarmony } from './perfect-harmony';

export const powerset: Powerset = {
  id: 'sentinel/sonic-aura',
  setPath: 'Sentinel_Defense.Sonic_Aura',
  name: 'Sonic Aura',
  buyRequires: [],
  buyRequiresFailed: "",
  specializeAt: 0,
  specializeRequires: [],
  description: "You can use your ability to manipulate sound and vibrations to protect yourself from incoming attacks as well as debuff the resistances of enemies around you. Although you specialize in preventing damage, you also can use various techniques to recover health over time and travel quickly.",
  icon: 'fiery_aura_set.ico',
  archetype: 'sentinel',
  category: 'secondary',
  powers: [
    SonicDiffusion,
    AttenuationBlanket,
    SomaticTherapy,
    HarmonicDistortion,
    DisruptionStrike,
    SupersonicFlow,
    NoiseCancellation,
    SonicBoom,
    PerfectHarmony,
  ],
};

export default powerset;
