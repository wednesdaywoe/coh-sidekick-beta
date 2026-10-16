import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getPowerset, STANCE_GROUPS, findStanceParent } from '@/data';
import { importMidsBuild } from '@/utils/mids-import';

/**
 * Bio Armor's Adaptation stance can desync because `internalName` is NOT unique
 * within a powerset. On Scrapper/Brute/Tanker Bio Armor TWO powers match the
 * stance group's `parents: ['Adaptation', 'Evolution']`:
 *
 *   - internal "Evolution"  = the real stance SWITCHER (display "Adaptation"),
 *     a `parentMechanic` that grants the Defensive/Offensive/Efficient chips.
 *   - internal "Adaptation" = "Evolving Armor", a DIFFERENT +Res toggle.
 *
 * `findStanceParent` used to return the FIRST `parents` match, so it could bind
 * to Evolving Armor instead of the switcher — while the subpower stance chips
 * (which filter by `requires`) always bind to the switcher. The two surfaces
 * then drift. The fix disambiguates to the `parentMechanic` switcher.
 *
 * On Stalker/Sentinel there is NO "Evolution" power; the switcher is internally
 * "Adaptation". The Mids importer collapsed its reverse map last-write-wins to
 * "Evolution" and wrote `activeSubPower` only onto a power named "Evolution" —
 * which does not exist on those ATs, dropping the imported stance.
 */

const bioGroup = STANCE_GROUPS.find((g) => g.key === 'adaptation')!;

describe('Adaptation stance internalName collision (homecoming)', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  it('findStanceParent binds to the switcher (Evolution), NOT Evolving Armor (Adaptation), even when Evolving Armor is ordered first', () => {
    const set = getPowerset('scrapper/bio-armor')!;
    const evolution = set.powers.find((p) => p.internalName === 'Evolution')!;
    const evolvingArmor = set.powers.find((p) => p.internalName === 'Adaptation')!;
    expect(evolution, 'scrapper Evolution switcher').toBeTruthy();
    expect(evolvingArmor, 'scrapper Adaptation (Evolving Armor)').toBeTruthy();
    // Sanity: the switcher is mechanic-classified, Evolving Armor is not.
    // `hiddenPassive` since data-gaps-57 landed the ShowInManage read — the
    // game itself hides the switcher from the manage screen.
    expect(evolution.mechanicType).toBe('hiddenPassive');
    expect(evolvingArmor.mechanicType).toBeUndefined();

    // Evolving Armor ordered FIRST — the old first-match logic returned it.
    const parent = findStanceParent([evolvingArmor, evolution], bioGroup);
    expect(parent?.internalName).toBe('Evolution');
    expect(parent).toBe(evolution);

    // Order-independent: switcher first must also resolve to the switcher.
    expect(findStanceParent([evolution, evolvingArmor], bioGroup)).toBe(evolution);
  });

  it('Mids import restores the stance onto the Stalker switcher (internal "Adaptation"), not dropped', () => {
    const mbd = JSON.stringify({
      BuiltWith: { App: 'Mids Reborn', Version: '3.8.1.0', Database: 'Homecoming' },
      Level: '49',
      Class: 'Class_Stalker',
      Origin: 'Natural',
      Name: 'Bio Stalker',
      PowerSets: ['Stalker_Melee.Martial_Arts', 'Stalker_Defense.Bio_Organic_Armor'],
      PowerEntries: [
        { PowerName: 'Stalker_Melee.Martial_Arts.Thunder_Kick', Level: 1, StatInclude: false, SlotEntries: [] },
        { PowerName: 'Stalker_Defense.Bio_Organic_Armor.Adaptation', Level: 2, StatInclude: false, SlotEntries: [] },
        { PowerName: 'Stalker_Defense.Bio_Organic_Armor.Defensive_Adaptation', Level: 2, StatInclude: true, SlotEntries: [] },
      ],
    });

    const result = importMidsBuild(mbd);
    expect(result.success, 'import succeeds').toBe(true);
    const powers = [
      ...(result.build!.primary?.powers ?? []),
      ...(result.build!.secondary?.powers ?? []),
    ];
    const switcher = powers.find((p) => p.internalName === 'Adaptation');
    expect(switcher, 'Stalker Adaptation switcher was imported').toBeTruthy();
    expect(switcher!.activeSubPower, 'imported stance applied to switcher, not dropped').toBe(
      'Defensive_Adaptation',
    );
  });
});
