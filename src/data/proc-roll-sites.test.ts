import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getAllPowersets } from '@/data/powersets';
import { getAllIOSets } from '@/data/io-sets';
import {
  powerFiresProcs,
  resolveProcRollSite,
  resolveProcRollGeometry,
  findProcData,
  getProcEffects,
  arcToDegrees,
  PROC_DATABASE,
} from './proc-data';
import { getProcPotential } from './proc-potential';
import { calculateSlottedProcDamagePerCast } from '@/utils/calculations/power-proc-damage';
import { Fault } from './datasets/homecoming/generated/powersets/brute/primary/stone-melee/fault';
import { Whitecap } from './datasets/homecoming/generated/powersets/defender/primary/marine-affinity/whitecap';
import { HypnotizingLights } from './datasets/homecoming/generated/powersets/controller/primary/pyrotechnic-control/hypnotizing-lights';
import { POWER_POOLS_RAW } from './datasets/homecoming/power-pools-raw';
import { FireImps } from './datasets/homecoming/generated/powersets/controller/primary/fire-control/fire-imps';
import type { Power } from '@/types/power';
import type { IOSet, IOSetEnhancement } from '@/types';

/**
 * Proc roll sites — the other half of `ProcAllowed kNone` (reworked 2026-08-09).
 *
 * Eleven Homecoming player powers pair the flag with a `CopyBoosts`
 * `kExecutePower` child: the shell's own activation is not a proc window, but
 * the shell has handed its slotting to the child, and the child rolls in its
 * place. Reading only the kNone half reported all of them (Fault ×4
 * archetypes, Whitecap ×4, Hypnotizing Lights ×2, Spring Attack) as firing
 * nothing — a confident zero on powers that fire, which is the bug this file
 * exists to keep closed.
 *
 * What is pinned here, in order of how load-bearing it is — every mechanism
 * claim below was measured against a pylon on 2026-08-09 (Fault 48 casts,
 * Spring Attack 30):
 *
 *  - **Routing is by `boostsAllowed`, not set categories.** A proc piece is
 *    one real boost type plus the five origins, and it rolls in the child
 *    whose own `BoostsAllowed` can hold it — `CopyBoosts` filtering by boost
 *    type, which is what dissociated Fault's proc onto the cone's own to-hit
 *    roll. The set-category reading excluded Spring Attack (child lists no
 *    set categories, fired 26/28) and called Hypnotizing Lights' Sleep procs
 *    dead (its wide child lists no set categories either, but takes `Sleep`).
 *  - **The window is the SHELL's; a site carries geometry only.** Fault paid
 *    37/45 = 0.822 where the parent's 22.1s window against the cone's area
 *    factor predicts 0.820 and the child's own 6s predicts 0.301 — the
 *    child-window scoring this file used to pin, wrong by 2.7×.
 *  - **A site moves the one roll; it never adds one.** Both Fault children
 *    execute every cast and no cast ever paid two procs.
 *  - **A piece TWO children could hold has no single roll and fails loud.**
 *    The multi-mez ATO procs in Hypnotizing Lights are that shape today —
 *    DATA-GAP-REGISTER data-gaps-109 files the residual — and each surface contains
 *    the throw as a per-piece marker rather than a crash.
 */

const HC = (p: unknown) => p as Power;

/** A proc piece's routing key, shaped as the extractor emits it. */
const boosts = (type: string) =>
  [type, 'Natural', 'Technology', 'Magic', 'Mutation', 'Science'];

/** The multi-mez ATO shape: one piece slottable in any mez power. */
const MEZ_ATO_BOOSTS = [
  'Hold', 'Stun', 'Sleep', 'Immobilize', 'Fear', 'Confuse',
  'Natural', 'Technology', 'Magic', 'Mutation', 'Science',
];

/** Spring Attack, which lives in a pool and so has no generated module. */
function springAttack(): Power {
  const leaping = (POWER_POOLS_RAW as unknown as Record<string, { powers?: Power[] }>).leaping;
  const power = leaping?.powers?.find((p) => p.name === 'Spring Attack');
  if (!power) throw new Error('Leaping has no Spring Attack');
  return power;
}

/** A slotted piece of `set`, standing in for what the picker would produce. */
function slotted(set: IOSet, pieceName: string): IOSetEnhancement {
  const piece = set.pieces.find((p) => p.name === pieceName);
  if (!piece) throw new Error(`${set.name} has no piece "${pieceName}"`);
  return {
    id: `${set.id}-${piece.num}`,
    type: 'io-set',
    name: piece.name,
    setId: set.id!,
    setName: set.name,
    pieceNum: piece.num,
    isProc: true,
    level: 50,
  } as unknown as IOSetEnhancement;
}

/**
 * A set of this category holding a foe-damage proc — derived rather than named,
 * so the gate keeps working when HC adds or renames a set. Returns the set and
 * the proc piece's name.
 */
function damageProcOfCategory(category: string): { set: IOSet; piece: string } {
  for (const set of Object.values(getAllIOSets())) {
    if (set.type !== category) continue;
    for (const piece of set.pieces) {
      if (!piece.proc) continue;
      const data = findProcData(piece.name, set.name);
      if (!data || data.ppm == null) continue;
      const dmg = getProcEffects(data).find(
        (e) => e.category === 'Damage' && e.value !== undefined && e.valueMax !== undefined,
      );
      if (dmg) return { set, piece: piece.name };
    }
  }
  throw new Error(`no damage proc in any "${category}" set`);
}

const DAMAGE_INPUT = {
  baseRecharge: 20,
  castTime: 2.1,
  radius: 0,
  arcDegrees: 360,
  rechargeEnh: 0,
  buildLevel: 50,
};

describe('proc roll sites', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  describe('the sites survive the converter', () => {
    it('Fault carries both executed children, keyed and geometry-only', () => {
      const sites = HC(Fault).procRollSites ?? [];
      expect(sites.map((s) => s.power)).toEqual([
        'Redirects.Stone_Melee.Fault_Brute',
        'Redirects.Stone_Melee.Fault_Cone_Brute',
      ]);
      // The routing keys: Damage on the cone and only the cone, Stun/Knockback
      // on the sphere and only the sphere — and the lists legitimately SHARE
      // Range and Accuracy, pinned so "the sites must partition" cannot creep
      // back in (no proc is a Range or an Accuracy boost).
      const [sphere, cone] = sites.map((s) => s.boostsAllowed);
      expect(sphere).toContain('Stun');
      expect(sphere).toContain('Knockback');
      expect(sphere).not.toContain('Damage');
      expect(cone).toContain('Damage');
      expect(cone).not.toContain('Stun');
      expect(sphere).toContain('Accuracy');
      expect(cone).toContain('Accuracy');
      // The children's geometry is not the shell's radius 0.
      expect(sites.map((s) => s.radius)).toEqual([15, 20]);
      // And geometry is ALL a site offers: the window is the shell's own
      // recharge and cast (measured — parent 22.1s predicts 0.820, the child's
      // 6s predicts 0.301, Fault paid 0.822). A site carrying a schedule would
      // be overriding the right window with the wrong one, which is what
      // shipped first.
      for (const site of sites) {
        expect(site).not.toHaveProperty('baseRecharge');
        expect(site).not.toHaveProperty('castTime');
        expect(site).not.toHaveProperty('powerType');
        expect(site).not.toHaveProperty('setCategories');
      }
    });

    it('reports every delegating power as firing, despite the kNone flag', () => {
      for (const power of [Fault, Whitecap, HypnotizingLights, springAttack()]) {
        expect({ name: HC(power).name, flagged: HC(power).procsAllowed, fires: powerFiresProcs(HC(power)) })
          .toEqual({ name: HC(power).name, flagged: false, fires: true });
      }
    });

    it('Spring Attack carries its site — the ProcSeparately gate excluded it', () => {
      // Its child has `CopyBoosts` and no `ProcSeparately`; the flag governs
      // per-target re-rolls, not delegation, and keying on it was what zeroed
      // the reporter's own first example (measured firing 26/28 casts).
      const sites = springAttack().procRollSites ?? [];
      expect(sites.map((s) => s.power)).toEqual(['Redirects.Pool_Leaping.Spring_Attack']);
      expect(sites[0].boostsAllowed).toEqual(['Knockback', 'Damage', 'Accuracy']);
    });

    it('CONTROL: a pet summon has no site and still fires nothing', () => {
      expect(HC(FireImps).procRollSites).toBeUndefined();
      expect(powerFiresProcs(HC(FireImps))).toBe(false);
    });
  });

  describe('routing a piece to its child', () => {
    it('sends a Damage boost to the cone and a Stun boost to the sphere', () => {
      const sites = HC(Fault).procRollSites!;
      expect(resolveProcRollSite(sites, boosts('Damage'))?.power)
        .toBe('Redirects.Stone_Melee.Fault_Cone_Brute');
      expect(resolveProcRollSite(sites, boosts('Stun'))?.power)
        .toBe('Redirects.Stone_Melee.Fault_Brute');
      // And a real catalogue entry routes by the same key it was emitted with.
      const { set, piece } = damageProcOfCategory('Ranged AoE Damage');
      const data = findProcData(piece, set.name)!;
      expect(resolveProcRollSite(sites, data.boostsAllowed)?.power)
        .toBe('Redirects.Stone_Melee.Fault_Cone_Brute');
    });

    it('sends Sleep to the wide child — the category model called this dead', () => {
      // The wide child lists no IO set categories, which the old routing read
      // as "accepts nothing" and a gate here pinned as Sleep firing nowhere.
      // Its BoostsAllowed takes `Sleep`; a Sleep proc piece is a Sleep boost.
      const sites = HC(HypnotizingLights).procRollSites!;
      expect(resolveProcRollSite(sites, boosts('Sleep'))?.power)
        .toBe('Redirects.Pyrotechnic_Control.Hypnotizing_Lights');
      expect(resolveProcRollSite(sites, boosts('Confuse'))?.power)
        .toBe('Redirects.Pyrotechnic_Control.HypnotizingLights_Narrow');
    });

    it('a piece no child can hold routes nowhere', () => {
      // Fault's children take no Sleep boost between them.
      expect(resolveProcRollSite(HC(Fault).procRollSites!, boosts('Sleep'))).toBeNull();
      // No sites at all is the ordinary power, and never throws — even for a
      // piece with no key to route by.
      expect(resolveProcRollSite(undefined, undefined)).toBeNull();
    });

    it('a piece two children could hold fails loud (DATA-GAP-REGISTER data-gaps-109)', () => {
      // The multi-mez ATO procs list every mez type, so Hypnotizing Lights'
      // Sleep-taking wide child and Confuse-taking narrow child BOTH qualify.
      // The export runs one of the two children per cast (a single template
      // naming both, count 1) and what a both-children piece does there is
      // unmeasured — so the routing refuses to pick a geometry.
      const sites = HC(HypnotizingLights).procRollSites!;
      expect(() => resolveProcRollSite(sites, MEZ_ATO_BOOSTS)).toThrow(/no single roll/);
      // The real catalogue entry is that shape.
      const wotc = PROC_DATABASE['Will of the Controller: Recharge/Chance for Psionic Damage'];
      expect(wotc.boostsAllowed).toEqual(expect.arrayContaining(['Sleep', 'Confuse']));
      expect(() => resolveProcRollSite(sites, wotc.boostsAllowed)).toThrow(/no single roll/);
    });

    it('a piece with no key on a delegating power fails loud too', () => {
      // An extractor gap is a routing question the model cannot answer around;
      // answering "nowhere" would be the silent zero this file exists to kill.
      expect(() => resolveProcRollSite(HC(Fault).procRollSites!, undefined)).toThrow();
      expect(() => resolveProcRollSite(HC(Fault).procRollSites!, [])).toThrow();
    });
  });

  describe('proc damage', () => {
    it('pays out in Fault on the SHELL\'s window over the cone\'s geometry', () => {
      const { set, piece } = damageProcOfCategory('Ranged AoE Damage');
      const slots = [slotted(set, piece)];
      const paid = calculateSlottedProcDamagePerCast({
        ...DAMAGE_INPUT, slots, procsAllowed: false, procRollSites: HC(Fault).procRollSites,
      });
      expect(paid).toBeGreaterThan(0);

      // The exact claim, as an equality: routing to the cone must price the
      // piece as if the SHELL's own window carried the CONE's geometry. This
      // is what the pylon measured (0.822 paid vs 0.820 predicted) and what
      // child-window scoring — wrong by 2.7× — fails.
      const cone = HC(Fault).procRollSites![1];
      const geometry = resolveProcRollGeometry(
        cone.procsOnlyOnMainTarget, cone.radius, arcToDegrees(cone.arc) || undefined);
      const asShellWindowConeGeometry = calculateSlottedProcDamagePerCast({
        ...DAMAGE_INPUT, radius: geometry.radius, arcDegrees: geometry.arcDegrees, slots,
      });
      expect(paid).toBeCloseTo(asShellWindowConeGeometry, 10);

      // The cone's area factor is a real tax, so the routed number is smaller
      // than the shell's radius-0 reading — a fix that merely un-flagged the
      // power would land on the larger one.
      const asShell = calculateSlottedProcDamagePerCast({ ...DAMAGE_INPUT, slots });
      expect(paid).toBeLessThan(asShell);
    });

    it('pays out in Whitecap and in Spring Attack', () => {
      const { set, piece } = damageProcOfCategory('Melee AoE Damage');
      for (const power of [Whitecap, springAttack()]) {
        const paid = calculateSlottedProcDamagePerCast({
          ...DAMAGE_INPUT,
          slots: [slotted(set, piece)],
          procsAllowed: false,
          procRollSites: HC(power).procRollSites,
        });
        expect({ name: HC(power).name, pays: paid > 0 })
          .toEqual({ name: HC(power).name, pays: true });
      }
    });

    it('MUTANT: the same slotting pays nothing once the sites are gone', () => {
      // The sites, not the un-flagging, are what pays out. Drop them and the
      // kNone flag is back in sole charge.
      const { set, piece } = damageProcOfCategory('Ranged AoE Damage');
      expect(calculateSlottedProcDamagePerCast({
        ...DAMAGE_INPUT, slots: [slotted(set, piece)], procsAllowed: false,
      })).toBe(0);
    });
  });

  describe('the proc-potential lens', () => {
    it('badges Fault off its children, and says so', () => {
      const p = getProcPotential(HC(Fault))!;
      expect(p.procsDisallowed).toBe(false);
      expect(p.rollsInExecutedChildren).toBe(true);
      expect(p.total).toBeGreaterThan(0);
      // Every entry names the child that scored it — nothing was quietly
      // scored against the shell's radius.
      expect(p.entries.every((e) => !!e.viaPower)).toBe(true);
    });

    it('badges Spring Attack — the old model pinned it empty', () => {
      const p = getProcPotential(springAttack())!;
      expect({ disallowed: p.procsDisallowed, children: p.rollsInExecutedChildren })
        .toEqual({ disallowed: false, children: true });
      expect(p.total).toBeGreaterThan(0);
    });

    it('contains the Hypnotizing Lights collision instead of crashing', () => {
      // The pool enumerates the multi-mez ATO procs (Controller Archetype Sets
      // are slottable here); their two-children collision drops out of the
      // pool rather than taking the badge down. The slotted surfaces carry the
      // loud marker.
      const p = getProcPotential(HC(HypnotizingLights))!;
      expect(p.rollsInExecutedChildren).toBe(true);
      expect(p.total).toBeGreaterThan(0);
    });
  });

  describe('the corpus', () => {
    function sitesPowers(): Power[] {
      const out: Power[] = [];
      for (const set of Object.values(getAllPowersets())) {
        for (const power of set.powers ?? []) {
          if (power.procRollSites?.length) out.push(power);
        }
      }
      if (springAttack().procRollSites?.length) out.push(springAttack());
      return out;
    }

    it('every power with sites is flagged kNone, and the population is eleven', () => {
      const powers = sitesPowers();
      for (const power of powers) {
        expect({ name: power.name, flagged: power.procsAllowed })
          .toEqual({ name: power.name, flagged: false });
      }
      // Fault ×4 archetypes, Whitecap ×4, Hypnotizing Lights ×2, Spring
      // Attack. Rebirth and Thunderspy rebalanced their Spring Attack into a
      // direct AoE, so this is a Homecoming population.
      expect(powers.length).toBe(11);
    });

    it('no piece reaches two sites, outside the filed data-gaps-109 residual', () => {
      let collisions = 0;
      for (const power of sitesPowers()) {
        const sites = power.procRollSites!;
        for (const [key, data] of Object.entries(PROC_DATABASE)) {
          if (data.type !== 'Proc' || !data.boostsAllowed?.length) continue;
          const hits = sites.filter(
            (s) => s.boostsAllowed.some((b) => data.boostsAllowed!.includes(b)));
          if (hits.length <= 1) continue;
          // The known shape: a multi-mez ATO piece in Hypnotizing Lights,
          // Sleep wide and Confuse narrow. Anything else is a collision the
          // model has never seen.
          expect({
            key,
            power: power.name,
            sleep: data.boostsAllowed.includes('Sleep'),
            confuse: data.boostsAllowed.includes('Confuse'),
          }).toEqual({ key, power: 'Hypnotizing Lights', sleep: true, confuse: true });
          collisions++;
        }
      }
      // The residual is a live population: if HC re-authors it away, retire
      // the register entry and this exemption together.
      expect(collisions).toBeGreaterThan(0);
    });
  });
});
