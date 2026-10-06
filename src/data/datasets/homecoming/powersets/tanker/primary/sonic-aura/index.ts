/**
 * Sonic Aura Powerset
 * You can use your ability to manipulate sound and vibrations to protect yourself from incoming attacks as well as debuff the resistances of enemies around you. Although you specialize in preventing damage, you also can use various techniques to recover health over time and travel quickly.
 *
 * Archetype: tanker
 * Category: primary
 * Source: tanker_defense/sonic_aura
 */

import type { Powerset } from '@/types';

import { SonicDiffusion as SonicDiffusion } from './sonic-diffusion';
import { AttenuationBlanket as AttenuationBlanket } from './attenuation-blanket';
import { SomaticTherapy as SomaticTherapy } from './somatic-therapy';
import { HarmonicDistortion as HarmonicDistortion } from './harmonic-distortion';
import { DisruptionAura as DisruptionAura } from './disruption-aura';
import { SupersonicFlow as SupersonicFlow } from './supersonic-flow';
import { NoiseCancellation as NoiseCancellation } from './noise-cancellation';
import { SonicBoom as SonicBoom } from './sonic-boom';
import { PerfectHarmony as PerfectHarmony } from './perfect-harmony';

export const powerset: Powerset = {
  id: 'tanker/sonic-aura',
  setPath: 'Tanker_Defense.Sonic_Aura',
  name: 'Sonic Aura',
  buyRequires: [],
  buyRequiresFailed: "",
  specializeAt: 0,
  specializeRequires: [],
  description: "You can use your ability to manipulate sound and vibrations to protect yourself from incoming attacks as well as debuff the resistances of enemies around you. Although you specialize in preventing damage, you also can use various techniques to recover health over time and travel quickly.",
  icon: 'fiery_aura_set.ico',
  archetype: 'tanker',
  category: 'primary',
  powers: [
    SonicDiffusion,
    AttenuationBlanket,
    SomaticTherapy,
    HarmonicDistortion,
    DisruptionAura,
    SupersonicFlow,
    NoiseCancellation,
    SonicBoom,
    PerfectHarmony,
  ],
};

export default powerset;
