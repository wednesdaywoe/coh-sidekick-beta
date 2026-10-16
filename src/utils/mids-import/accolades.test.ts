import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { importMidsBuild } from '@/utils/mids-import';
import { getAccolade, getAccolades, getAllAccolades, accoladeId } from '@/data/accolades';

/**
 * data-gaps-231 — accolades arrived as `Temporary_Powers.Accolades.*` and the importer's
 * blanket temp-power skip dropped every one of them silently, with `warnings: []` telling
 * the user nothing was lost. The build that surfaced it carried four (Atlas Medallion,
 * Task Force Commander, Portal Jockey, Freedom Phalanx Reserve), so its imported HP and
 * End sat below the Mids original with nothing on screen to say why.
 *
 * The population here is the dataset's own roster rather than a list of four names: a
 * hand table is right only where it was written, and the failure being guarded is exactly
 * a name the roster has and the importer does not.
 */

beforeAll(async () => {
  await loadDataset('homecoming');
});

/** A minimal well-formed .mbd carrying the given accolade entries. */
function mbdWith(entries: Array<{ name: string; StatInclude?: boolean }>): string {
  return JSON.stringify({
    BuiltWith: { App: 'Mids Reborn', Version: '3.7.5.21', Database: 'Homecoming' },
    Level: '49',
    Class: 'Class_Stalker',
    Origin: 'Natural',
    Name: 'Accolade probe',
    PowerSets: ['Stalker_Melee.Martial_Arts', 'Stalker_Defense.Willpower'],
    PowerEntries: [
      { PowerName: 'Stalker_Melee.Martial_Arts.Storm_Kick', Level: 1, StatInclude: true, SlotEntries: [] },
      ...entries.map(({ name, StatInclude = true }) => ({
        PowerName: `Temporary_Powers.Accolades.${name}`,
        Level: 50,
        StatInclude,
        SlotEntries: [],
      })),
    ],
  });
}

describe('Mids .mbd import — accolades', () => {
  it('lands every stat toggle in the roster, under an id the roster resolves', () => {
    const toggles = getAccolades();
    expect(toggles.length).toBeGreaterThan(0);

    const result = importMidsBuild(mbdWith(toggles.map((a) => ({ name: a.internalName }))));

    expect(result.warnings).toEqual([]);
    expect(result.build?.accolades).toEqual(toggles.map(accoladeId));
    for (const id of result.build?.accolades ?? []) {
      expect(getAccolade(id)).toBeDefined();
    }
  });

  it('carries the four the reported build lost', () => {
    const result = importMidsBuild(
      mbdWith([
        { name: 'The_Atlas_Medallion' },
        { name: 'Task_Force_Commander' },
        { name: 'Portal_Jockey' },
        { name: 'Freedom_Phalanx_Reserve' },
      ]),
    );

    expect(result.build?.accolades).toEqual([
      'the_atlas_medallion',
      'task_force_commander',
      'portal_jockey',
      'freedom_phalanx_reserve',
    ]);
  });

  // The two skips below are stated on inputs that would otherwise land: a bare
  // `toEqual([])` passes for any importer that declines everything, including the
  // broken one this row was opened against.
  it('declines an accolade the user excluded from their Mids totals', () => {
    const landed = importMidsBuild(mbdWith([{ name: 'Portal_Jockey' }]));
    expect(landed.build?.accolades).toEqual(['portal_jockey']);

    const excluded = importMidsBuild(mbdWith([{ name: 'Portal_Jockey', StatInclude: false }]));
    expect(excluded.build?.accolades).toEqual([]);
    expect(excluded.warnings).toEqual([]);
  });

  it('declines a real accolade that carries no permanent buff, silently', () => {
    const noBuff = getAllAccolades().find(
      (a) => !getAccolades().some((t) => t.internalName === a.internalName),
    );
    expect(noBuff).toBeDefined();

    const result = importMidsBuild(mbdWith([{ name: noBuff!.internalName }]));
    expect(result.build?.accolades).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.summary.powersFailed).toBe(0);
  });

  it('warns on a name in neither roster rather than dropping it', () => {
    const result = importMidsBuild(mbdWith([{ name: 'Medal_Of_Nothing' }]));

    expect(result.build?.accolades).toEqual([]);
    expect(result.warnings).toEqual([
      {
        type: 'power',
        midsName: 'Temporary_Powers.Accolades.Medal_Of_Nothing',
        message: 'Accolade not found in this dataset',
      },
    ]);
    expect(result.summary.powersFailed).toBe(1);
  });

  it('still skips non-accolade temporary powers without warning', () => {
    const mbd = JSON.stringify({
      BuiltWith: { App: 'Mids Reborn', Version: '3.7.5.21', Database: 'Homecoming' },
      Level: '49',
      Class: 'Class_Stalker',
      Origin: 'Natural',
      Name: 'Temp probe',
      PowerSets: ['Stalker_Melee.Martial_Arts', 'Stalker_Defense.Willpower'],
      PowerEntries: [
        { PowerName: 'Stalker_Melee.Martial_Arts.Storm_Kick', Level: 1, StatInclude: true, SlotEntries: [] },
        { PowerName: 'Temporary_Powers.Temporary_Powers.Nemesis_Staff', Level: 50, StatInclude: true, SlotEntries: [] },
      ],
    });

    const result = importMidsBuild(mbd);
    expect(result.build?.accolades).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
