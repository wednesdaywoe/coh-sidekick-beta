import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getPowerset, findStanceParent, toStancePowers, activeStanceOptionId, STANCE_GROUPS } from '@/data';
import { useBuildStore } from '@/stores/buildStore';
import type { Power, SelectedPower } from '@/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The Adaptation stance parent must resolve to the SWITCHER on every surface.
 *
 * Scrapper/Brute/Tanker Bio Armor has two powers matching
 * `STANCE_GROUPS.adaptation.parents`:
 *   • display "Adaptation"     / internal `Evolution`  — the switcher (`hiddenPassive`)
 *   • display "Evolving Armor" / internal `Adaptation` — an unrelated +Res toggle
 *
 * `findStanceParent` disambiguates on the mechanic classification, so any
 * caller that hands it powers WITHOUT that field silently falls back to
 * `candidates[0]` — i.e. to whichever the user picked FIRST. The picker then
 * writes `activeSubPower` onto Evolving Armor while the Header and the calc read
 * it off Evolution, and the stance desyncs (report 2026-07-26: "tied to picking
 * Adaptation after first picking a power with the toggles in their power info").
 *
 * The culprit was MechanicAdjusters' `buildPowers` projection, which narrowed
 * each power to `{ internalName, activeSubPower }`. (Serialization is fine —
 * `hydratePowers` spreads the full def back on import; the round-trip test below
 * pins that, since it is the other way the field could go missing.)
 */

const GROUP = STANCE_GROUPS.find((g) => g.key === 'adaptation')!;

describe('Adaptation stance parent resolution (HC scrapper)', () => {
  beforeAll(async () => { await loadDataset('homecoming'); });

  const pick = (internal: string): SelectedPower => {
    const def = getPowerset('scrapper/bio-armor')!.powers.find((p: Power) => p.internalName === internal)!;
    return { ...def, powerSet: 'scrapper/bio-armor', level: 1, slots: [], isActive: true } as SelectedPower;
  };

  it('the dataset really does offer two candidates, only one mechanic-classified', () => {
    const set = getPowerset('scrapper/bio-armor')!;
    const candidates = set.powers.filter((p: Power) => GROUP.parents.includes(p.internalName));
    expect(candidates.map((p: Power) => p.internalName).sort()).toEqual(['Adaptation', 'Evolution']);
    // `hiddenPassive` since data-gaps-57: the switcher authors `ShowInManage
    // kFalse`, so it classifies as the hidden set-mechanic it is, and the
    // impostor toggle carries no mechanicType at all.
    expect(candidates.filter((p: Power) => p.mechanicType != null).map((p: Power) => [p.internalName, p.mechanicType]))
      .toEqual([['Evolution', 'hiddenPassive']]);
  });

  it('resolves the switcher regardless of pick order', () => {
    const evolvingArmorFirst = [pick('Adaptation'), pick('Evolution')];
    const switcherFirst = [pick('Evolution'), pick('Adaptation')];
    expect(findStanceParent(evolvingArmorFirst, GROUP)?.internalName).toBe('Evolution');
    expect(findStanceParent(switcherFirst, GROUP)?.internalName).toBe('Evolution');
  });

  // The InfoPanel picker flattens the build through `toStancePowers` before
  // calling `findStanceParent`. That projection is the seam the bug lived in: any
  // narrowing that omits `mechanicType` silently reverts the helper to pick order.
  it('the build→stance projection preserves the discriminator', () => {
    const flattened = toStancePowers([pick('Adaptation'), pick('Evolution')]);
    expect(flattened.map((p) => p.mechanicType)).toEqual([undefined, 'hiddenPassive']);
    // …and therefore still resolves the switcher from the breaking pick order.
    expect(findStanceParent(flattened, GROUP)?.internalName).toBe('Evolution');
  });

  // The regression the report describes: a build that has been saved and reloaded
  // (or arrived via a share link) must still resolve the switcher. `mechanicType`
  // is static def metadata, so it has to be re-attached on rehydrate the same way
  // powerType/targetType/effectArea already are.
  it('survives an export → import round-trip', () => {
    useBuildStore.getState().resetBuild();
    useBuildStore.setState((s) => ({
      build: {
        ...s.build,
        serverId: 'homecoming',
        level: 50,
        archetype: { id: 'scrapper', name: 'Scrapper', stats: null, inherent: null } as any,
        // Evolving Armor picked FIRST — the order that breaks the fallback.
        secondary: { id: 'scrapper/bio-armor', name: 'Bio Armor', powers: [pick('Adaptation'), pick('Evolution')] } as any,
      },
    }));

    const json = useBuildStore.getState().exportBuild();
    // The serializer is deliberately slim — prove it drops the discriminator, so
    // this test fails for the right reason if that ever changes.
    expect(JSON.stringify(JSON.parse(json))).not.toContain('hiddenPassive');

    useBuildStore.getState().resetBuild();
    expect(useBuildStore.getState().importBuild(json)).toBe(true);

    const powers = useBuildStore.getState().build.secondary.powers;
    expect(powers.map((p) => p.internalName).sort()).toEqual(['Adaptation', 'Evolution']);
    expect(findStanceParent(powers, GROUP)?.internalName).toBe('Evolution');
  });

  // The reported failure state (screenshot 2026-07-26): the header chip and the
  // power-list stance chips both read Offensive while the picker inside Evolving
  // Armor's own Power Info reads Efficient. That is two different powers holding
  // two different `activeSubPower` values — the switcher (`Evolution`) and the
  // impostor (`Adaptation`) — with each surface bound to a different one.
  //
  // All three surfaces resolve through the same helper, so pinning the helper on
  // the divergent state pins all three: the switcher's value is the answer, and
  // the impostor's stale value is ignored no matter what order they were picked.
  it('every surface reads the switcher when the impostor holds a stale stance', () => {
    const switcher = { ...pick('Evolution'), activeSubPower: 'Offensive_Adaptation' };
    const impostor = { ...pick('Adaptation'), activeSubPower: 'Efficient_Adaptation' };
    for (const powers of [[switcher, impostor], [impostor, switcher]]) {
      // Header / mids-import surface: real SelectedPower objects.
      expect(activeStanceOptionId(powers, GROUP)).toBe('offensiveadaptation');
      // Power-info picker surface: the same build through the stance projection.
      const parent = findStanceParent(toStancePowers(powers), GROUP)!;
      expect(parent.internalName).toBe('Evolution');
      expect(activeStanceOptionId([parent], GROUP)).toBe('offensiveadaptation');
    }
  });

  // A build corrupted by the old picker carries `activeSubPower` on the impostor.
  // The engine reads that field per power, so the stance would stay on even after
  // the user cleared it — the write has to be authoritative for the whole group.
  it('setting the stance clears a stray selection on the same-group impostor', () => {
    useBuildStore.getState().resetBuild();
    useBuildStore.setState((s) => ({
      build: {
        ...s.build,
        serverId: 'homecoming',
        level: 50,
        archetype: { id: 'scrapper', name: 'Scrapper', stats: null, inherent: null } as any,
        secondary: {
          id: 'scrapper/bio-armor',
          name: 'Bio Armor',
          powers: [
            { ...pick('Adaptation'), activeSubPower: 'Defensive_Adaptation' }, // stale, on the impostor
            pick('Evolution'),
          ],
        } as any,
      },
    }));

    useBuildStore.getState().setActiveSubPower('Evolution', 'Offensive_Adaptation');

    const byName = new Map(
      useBuildStore.getState().build.secondary.powers.map((p) => [p.internalName, p.activeSubPower]),
    );
    expect(byName.get('Evolution')).toBe('Offensive_Adaptation');
    expect(byName.get('Adaptation')).toBeUndefined();
  });
});
