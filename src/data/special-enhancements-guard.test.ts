import { describe, it, expect } from 'vitest';

import { SPECIAL_ENHANCEMENTS as HOMECOMING } from './datasets/homecoming/generated/special-enhancements';
import { SPECIAL_ENHANCEMENTS as REBIRTH } from './datasets/rebirth/generated/special-enhancements';
import { SPECIAL_ENHANCEMENTS as THUNDERSPY } from './datasets/thunderspy/generated/special-enhancements';
import { SPECIAL_ENHANCEMENTS as BRAINSTORM } from './datasets/brainstorm/generated/special-enhancements';
import type { SpecialEnhancementsData } from './datasets/homecoming/generated/special-enhancements';
import { normalizeAspectName } from '@/utils/calculations/enhancement-values';

/**
 * Guards on the generated special-enhancement registries (data-gaps-324 item 9).
 *
 * The entry IDS are load-bearing outside the data layer: icon filenames
 * (`HONucleolus.png`, `TNPeridont.png`, …) and saved-build slots
 * (`${category}-${id}`) reference them, so the converter must keep emitting
 * the legacy ids exactly — including the `peridont` typo id the icon file is
 * keyed on. The STAT vocabulary must stay inside `normalizeAspectName`'s
 * domain or the calc engine silently drops the aspect.
 */

const LEGACY_IDS = {
  hamidon: [
    'nucleolus', 'centriole', 'enzyme', 'lysosome', 'membrane', 'peroxisome',
    'ribosome', 'golgi', 'endoplasm', 'cytoskeleton', 'microfilament',
    'vesicle', 'stereocilia', 'microtubule', 'karyoplasm', 'microvillus',
    'chromatin', 'ectosome', 'amyloplast', 'chloroplast',
  ],
  titan: [
    'amethyst', 'calcite', 'citrine', 'diamond', 'gypsum', 'kyanite',
    'peridont', 'quartz', 'selenite', 'tanzanite', 'zeolite',
  ],
  hydra: [
    'antiproton', 'delta', 'electron', 'gluon', 'graviton', 'neutrino',
    'neutron', 'positron', 'proton', 'quark', 'theta',
  ],
  dsync: [
    'acceleration', 'binding', 'conduit', 'containment', 'deceleration',
    'drain', 'efficiency', 'elusivity', 'empowerment', 'extension',
    'fortification', 'guidance', 'marginalization', 'obfuscation',
    'optimization', 'provocation', 'reconstitution', 'reconstruction',
    'shifting', 'siphon',
  ],
  prestige: [
    'clockwork_efficiency', 'might_of_the_empire', 'resistance_tactics',
    'syndicate_techniques', 'will_of_the_seers',
  ],
} as const;

const FAMILIES = ['hamidon', 'titan', 'hydra', 'dsync', 'prestige'] as const;

const DATASETS: Array<{ id: string; data: SpecialEnhancementsData }> = [
  { id: 'homecoming', data: HOMECOMING },
  { id: 'rebirth', data: REBIRTH },
  { id: 'thunderspy', data: THUNDERSPY },
  { id: 'brainstorm', data: BRAINSTORM },
];

describe.each(DATASETS)('special-enhancement registries: $id', ({ id, data }) => {
  it('carries the dataset id it was generated for', () => {
    expect(data.dataset).toBe(id);
  });

  it('every id is a legacy id (icons and saved builds reference them)', () => {
    for (const family of FAMILIES) {
      const legacy = new Set<string>(LEGACY_IDS[family]);
      for (const entryId of Object.keys(data[family])) {
        expect(legacy.has(entryId), `${family}/${entryId} is not a legacy id`).toBe(true);
      }
    }
  });

  it('every aspect stat normalizes into the engine aspect vocabulary', () => {
    for (const family of FAMILIES) {
      for (const [entryId, def] of Object.entries(data[family])) {
        expect(def.name.length, `${family}/${entryId}: empty name`).toBeGreaterThan(0);
        expect(def.aspects.length, `${family}/${entryId}: no aspects`).toBeGreaterThan(0);
        for (const aspect of def.aspects) {
          expect(
            normalizeAspectName(aspect.stat),
            `${family}/${entryId}: stat "${aspect.stat}" outside the engine vocabulary`,
          ).not.toBeNull();
          expect(aspect.value, `${family}/${entryId}: non-positive value`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('per-dataset registry divergence (the reason these are generated per dataset)', () => {
  it('Homecoming carries all four families at the Hamidon rate, incl. D-Sync', () => {
    expect(Object.keys(HOMECOMING.hamidon)).toHaveLength(20);
    expect(Object.keys(HOMECOMING.dsync)).toHaveLength(20);
    expect(HOMECOMING.titan.diamond.aspects.map((a) => a.value)).toEqual([33.33, 33.33]);
    expect(HOMECOMING.titan.peridont.name).toBe('Titan Peridot Shard');
  });

  it('the forks carry the classic 11 Hamidons, legacy 25/15 Titan/Hydra, and no D-Sync', () => {
    for (const data of [REBIRTH, THUNDERSPY]) {
      expect(Object.keys(data.hamidon)).toHaveLength(11);
      expect(Object.keys(data.dsync)).toHaveLength(0);
      expect(data.titan.diamond.aspects.map((a) => a.value)).toEqual([25, 25]);
      const peridontResistance = data.titan.peridont.aspects.find((a) => a.stat === 'Resistance');
      expect(peridontResistance?.value).toBe(15);
    }
  });
});
