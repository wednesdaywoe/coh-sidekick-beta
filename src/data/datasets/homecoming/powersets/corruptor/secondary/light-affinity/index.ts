/**
 * Light Affinity Powerset
 * You can focus and refract beams of light to protect your allies and hamper your foes. Your Beams of light can charge up to Radiant Beams, casting new effects on everyone in range.
 *
 * Archetype: corruptor
 * Category: secondary
 * Source: corruptor_buff/light_affinity
 */

import type { Powerset } from '@/types';

import { ProtectiveBeam as ProtectiveBeam } from './protective-beam';
import { BlindingBeam as BlindingBeam } from './blinding-beam';
import { MirrorImage as MirrorImage } from './mirror-image';
import { ClarifyingBeam as ClarifyingBeam } from './clarifying-beam';
import { Lightfield as Lightfield } from './lightfield';
import { Magnify as Magnify } from './magnify';
import { SearingBeam as SearingBeam } from './searing-beam';
import { Spotlight as Spotlight } from './spotlight';
import { SanctuaryofLight as SanctuaryofLight } from './sanctuary-of-light';

export const powerset: Powerset = {
  id: 'corruptor/light-affinity',
  setPath: 'Corruptor_Buff.Light_Affinity',
  name: 'Light Affinity',
  buyRequires: [],
  buyRequiresFailed: "",
  specializeAt: 0,
  specializeRequires: [],
  description: "You can focus and refract beams of light to protect your allies and hamper your foes. Your Beams of light can charge up to Radiant Beams, casting new effects on everyone in range.",
  icon: 'kinetics_set.ico',
  archetype: 'corruptor',
  category: 'secondary',
  powers: [
    ProtectiveBeam,
    BlindingBeam,
    MirrorImage,
    ClarifyingBeam,
    Lightfield,
    Magnify,
    SearingBeam,
    Spotlight,
    SanctuaryofLight,
  ],
};

export default powerset;
