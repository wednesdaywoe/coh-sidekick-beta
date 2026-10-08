/**
 * Proc-bomb POTENTIAL — what a power could host if you slotted it for procs,
 * before any slotting exists.
 *
 * A power is a good proc vehicle by a coincidence of three properties it owns
 * outright, none of which is visible from its damage numbers:
 *
 *  1. **Which sets it allows.** `allowedSetCategories` decides the proc
 *     inventory. A melee attack that also holds accepts both Melee Damage and
 *     Hold sets, so it can host procs from a union no pure attack can — a
 *     genuinely unusual union is worth more than any single category.
 *  2. **Recharge.** PPM chance rises with the recharge window, but it is a
 *     THRESHOLD, not a gradient: a 3.5 PPM proc reaches the 90% ceiling at a
 *     ~15.4s cycle and a 4.5 PPM purple at ~12s. Past that, extra recharge buys
 *     nothing. What long recharge really buys is the LOW-PPM utility procs —
 *     a 2.5 PPM knockdown is near-unusable in a 10s attack and caps out in a
 *     180s one. That is the non-obvious half of the mechanic.
 *  3. **Geometry.** The PPM area denominator divides the chance by up to ~2.4×
 *     for a wide AoE, so radius is a straight tax — except when
 *     `ProcMainTargetOnly` is set, where an AoE rolls at single-target odds.
 *
 * This module deliberately computes NO single "goodness" score. Damage is the
 * commonest thing players chase, but -Res, knockdown, stun and -ToHit procs are
 * equally real build goals, and any weighting that collapses them into one
 * number is the app imposing a playstyle. What it returns instead is the
 * COMPOSITION — which effect categories are available and how many of each run
 * at the ceiling — and lets the caller (or the player's tracked stats) decide
 * what matters. See `procPotentialTier` for the one weighting-free ranking.
 *
 * Everything here is BASE potential: base recharge, no enhancement, no build.
 * That is what makes it a property of the power rather than of a build.
 */

import type { Power, ProcRollSite } from '@/types/power';
import type { IOSetCategory, IOSetRarity } from '@/types';
import { getIOSetsForPower } from './io-sets';
import {
  PROC_DATABASE,
  getProcEffects,
  arcToDegrees,
  resolveProcRollGeometry,
  resolveProcRollSchedule,
  calculateScheduledProcChance,
  powerFiresProcs,
  resolveProcRollSite,
  getPPMAreaDenominator,
  type ProcData,
} from './proc-data';
import {
  procRollSiteModifiers,
  resolveProcAreaGeometry,
  resolveProcPatchDuration,
  resolveProcRollModifiers,
} from '@/utils/calculations/pet-damage';

/** The PPM formula's hard ceiling. A proc at this value cannot be improved. */
export const PROC_CHANCE_CAP = 0.9;

/** One PPM proc a power could slot, with its chance at base recharge. */
export interface ProcPotentialEntry {
  /** PROC_DATABASE key — stable identity. */
  key: string;
  setName: string;
  ioName: string;
  ppm: number;
  /**
   * Chance of ONE roll at base recharge with this power's roll geometry. Equal
   * to the chance per activation except on a patch power, which gets `rolls` of
   * them per cast — see `ProcPotential.rolls`.
   */
  chance: number;
  /** True when `chance` is at the 90% ceiling — more recharge buys nothing. */
  atCap: boolean;
  rarity: IOSetRarity;
  /** Effect category from the binary-sourced proc effects (Damage, Control, …). */
  category: string;
  /** Sub-type within the category (Hold, Knockdown, Resistance, …), if any. */
  effectType?: string;
  /** Which of the power's allowed categories admits this proc. */
  viaCategory: IOSetCategory;
  /**
   * The executed child this proc rolls in, when the power itself does not —
   * see `Power.procRollSites`. Absent on every power that rolls its own.
   */
  viaPower?: string;
}

/** One row of the composition table: an effect category and how it fares here. */
export interface ProcCompositionRow {
  category: string;
  /** Distinct sub-types present, e.g. ['Hold', 'Knockdown'] under Control. */
  effectTypes: string[];
  /** Distinct procs in this category the power can slot. */
  total: number;
  /** How many of those run at the 90% ceiling at base recharge. */
  atCap: number;
}

export interface ProcPotential {
  entries: ProcPotentialEntry[];
  /** Composition rows, richest category first. The headline output. */
  composition: ProcCompositionRow[];
  /** Distinct PPM procs slottable. */
  total: number;
  /** How many run at the 90% ceiling at base recharge. */
  atCap: number;
  /** Distinct very-rare (purple) sets contributing procs — L50-only, unique per build. */
  purpleSets: string[];
  /** Always-on globals (LotG, Steadfast…) available. Not PPM, counted separately. */
  globalCount: number;
  /** Slots the power can hold — the ceiling on how much of this pool is usable. */
  maxSlots: number;

  // --- the inputs, surfaced so the UI can explain the number ---
  /**
   * Window ONE roll was scored against. The power's base recharge normally; the
   * proc's own 10s period for an auto/toggle or a patch power, where recharge
   * has no bearing at all.
   */
  recharge: number;
  castTime: number;
  /**
   * Independent rolls per activation. 1 everywhere except a summoned patch,
   * which rolls every 10s for as long as it lives — 2 for a 15s rain, 5 for a
   * 45s Bonfire. Expected procs per cast is `rolls × chance`.
   */
  rolls: number;
  /** Radius procs actually roll against, post-pseudo-pet and ProcMainTargetOnly. */
  radius: number;
  arcDegrees: number;
  /** PPM area denominator; 1.0 means no AoE penalty. */
  areaDenominator: number;
  /** True when the roll geometry came from a summoned patch/rain, not the power. */
  fromPseudoPet: boolean;
  /** True when ProcMainTargetOnly forced an AoE to roll single-target. */
  mainTargetOnly: boolean;
  /**
   * True when HC's `ProcAllowed kNone` says no PPM proc rolls anywhere for this
   * power. `entries` is then empty by construction and the recharge/geometry
   * fields describe a window nothing rolls in; `globalCount` still stands.
   */
  procsDisallowed: boolean;
  /**
   * True on the powers whose `kNone` shell hands its slotting to executed
   * children: procs DO fire, but each entry was scored against the geometry of
   * the child that can hold it (over this power's own window), so the flat
   * radius/areaDenominator fields above describe the shell and not any roll.
   * Read `entries[].viaPower` for the one that scored each row, and do not
   * print the flat geometry when this is set.
   */
  rollsInExecutedChildren: boolean;
}

/** Effect category + sub-type a proc reads as in the composition table. */
function classifyProc(data: ProcData): { category: string; effectType?: string } {
  const effects = getProcEffects(data);
  // A proc's headline effect is its first; secondaries (Gaussian's +ToHit
  // riding along with its +Damage) are real but not what it is slotted for.
  const primary = effects[0];
  if (!primary) return { category: 'Other' };

  // The source data files Build Up procs under category "Damage" alongside procs
  // that DEAL damage, which conflates two unrelated build propositions: "adds
  // 71.75 Fire damage to this attack" versus "grants +100% Damage for 10s".
  // It also surfaces as a nonsense sub-type, since the buff's scope is recorded
  // as effectType "All" and there is no all-types damage proc in the game.
  //
  // Duration is the discriminator: a damage proc resolves instantly and carries
  // none, a timed buff always does. Across the catalogue this separates exactly
  // the three Build Up procs (Decimation, Gaussian's, Soulbound Allegiance) and
  // touches nothing else — `proc-potential.test.ts` pins both halves.
  if (primary.category === 'Damage' && primary.duration != null) {
    // No sub-type: "All" only ever meant "buffs every damage type", which the
    // label already says.
    return { category: 'Damage Buff' };
  }

  return { category: primary.category, effectType: primary.effectType };
}

/**
 * The roll schedule and geometry a power's procs actually see.
 *
 * Both halves of the pseudo-pet case are handled here, and they are separate
 * facts about the same summon. Rains, patches, Caltrops and Burn carry radius 0
 * on the parent with the real footprint on the summon — missing the RADIUS
 * scores 264 HC powers as single-target and overstates them badly. Missing the
 * CLOCK is the bigger error: the patch is an `Auto` with recharge 0, so its
 * procs roll against the proc's own 10s period every 10 seconds it lives, and
 * the parent's long recharge never enters the formula at all. That is measured,
 * not inferred — see `resolveProcRollSchedule` for the Sleet experiment that
 * killed the 90% this function used to report.
 *
 * A consequence worth stating plainly, because it is where the badge changed:
 * a patch power's per-roll chance is small (a 3.5 PPM proc in a 20ft rain sits
 * at 17.9%) and no amount of recharge moves it, so no rain can reach the 90%
 * ceiling and none of them score as proc bombs any more. What a rain offers is
 * several modest rolls instead of one good one — real, and worth knowing, but
 * not the "many procs at once" the badge is for.
 */
function resolveProcContext(power: Power) {
  const stats = power.stats ?? {};

  const directRadius = stats.radius ?? 0;
  const area = resolveProcAreaGeometry(
    directRadius,
    // `stats.arc` is the raw binary value (radians); the geometry resolvers
    // expect degrees.
    arcToDegrees(stats.arc),
    power.summon,
  );
  const roll = resolveProcRollGeometry(power.procsOnlyOnMainTarget, area.radius, area.arcDegrees);
  const mods = resolveProcRollModifiers(power);
  const schedule = resolveProcRollSchedule({
    powerType: power.powerType,
    baseRecharge: stats.recharge ?? 0,
    castTime: stats.castTime ?? 0,
    patchDuration: resolveProcPatchDuration(directRadius, power.summon),
  });

  return {
    schedule,
    recharge: schedule.window,
    castTime: schedule.castTime,
    rolls: schedule.rolls,
    radius: roll.radius,
    arcDegrees: roll.arcDegrees,
    mods,
    areaDenominator: getPPMAreaDenominator(roll.radius, roll.arcDegrees, mods),
    fromPseudoPet: directRadius <= 0 && area.radius > 0,
    mainTargetOnly: !!power.procsOnlyOnMainTarget,
    procsDisallowed: !powerFiresProcs(power),
    rollsInExecutedChildren: power.procsAllowed === false
      && (power.procRollSites?.length ?? 0) > 0,
  };
}

/**
 * The roll geometry of one `procRollSites` child, over the shell's schedule.
 * A site moves WHERE a proc rolls, not when — the window stays the recharge of
 * the power the player presses. See `collectProcRollSites` for the pylon
 * measurements that separate the two.
 */
function resolveSiteContext(ctx: ReturnType<typeof resolveProcContext>, site: ProcRollSite) {
  const roll = resolveProcRollGeometry(
    site.procsOnlyOnMainTarget, site.radius, arcToDegrees(site.arc) || undefined);
  return {
    schedule: ctx.schedule,
    radius: roll.radius,
    arcDegrees: roll.arcDegrees,
    mods: procRollSiteModifiers(site),
  };
}

/**
 * Memo keyed on the Power OBJECT, not on a name.
 *
 * `internalName` is not globally unique (1,078 distinct names across 3,364
 * generated HC powers, with real cross-powerset collisions), and `fullName` is
 * unpopulated — a name key would serve one power's proc pool for another's.
 * Generated powers are module-level constants, so object identity is stable for
 * the process, separates datasets for free (different modules, different
 * objects), and a WeakMap can't leak. A caller passing a freshly-built power
 * object just recomputes.
 */
const _cache = new WeakMap<Power, ProcPotential>();

/**
 * What this power could host if slotted for procs, at base recharge.
 *
 * Pure in the power, so results are memoized. Returns `null` for a power that
 * accepts no IO sets at all (most inherents, some redirects).
 *
 * A power HC marks `ProcAllowed kNone` returns a result with no PPM entries and
 * `procsDisallowed: true` — not `null`, because its globals are still real.
 * That drops it to tier 0, which is the whole point: the loudest false badges
 * were long-recharge flagged powers (Paralyzing Blast at 240s, Spring Attack at
 * 120s) where every proc in the pool pinned to the 90% cap.
 *
 * The powers carrying `procRollSites` are the exception and keep a badge:
 * their kNone shell hands its slotting to executed children, so each entry is
 * scored against the child that can hold it — the child's geometry over this
 * power's own window — and names it in `viaPower`. `rollsInExecutedChildren`
 * marks them, and the flat radius/areaDenominator fields describe the shell
 * rather than any roll — do not print them for those powers.
 */
export function getProcPotential(power: Power): ProcPotential | null {
  const categories = power.allowedSetCategories ?? [];
  if (categories.length === 0) return null;

  const cached = _cache.get(power);
  if (cached) return cached;

  const ctx = resolveProcContext(power);
  const entries: ProcPotentialEntry[] = [];
  const seen = new Set<string>();
  const purpleSets = new Set<string>();
  let globalCount = 0;

  // The pool is enumerated from PROC_DATABASE, joined to the power's slottable
  // sets by SET NAME — not by walking each set's proc pieces.
  //
  // The IO-set registry's piece names come from the binary and frequently don't
  // match the proc catalogue's ioName ("Basilisk's Gaze :: Chance" for what the
  // catalogue calls "Chance for Recharge Slow"; "Lockdown :: Chance for Hold"
  // vs "Chance for Hold Mag 2"). That mismatch is why `findProcData` needs its
  // fuzzy set-name fallback at all. Walking pieces and joining strictly dropped
  // 6 of Ice Arrow's 11 procs; joining loosely would invent procs instead.
  // `data.setName` sidesteps the naming problem entirely: the catalogue already
  // states which set each proc belongs to.
  const setsByName = new Map<string, ReturnType<typeof getIOSetsForPower>[number]>();
  for (const set of getIOSetsForPower(categories)) setsByName.set(set.name, set);

  for (const [procKey, data] of Object.entries(PROC_DATABASE)) {
    const set = setsByName.get(data.setName);
    if (!set) continue; // set isn't slottable here (or isn't in this dataset)

    // A proc can appear under both a bare and a set-prefixed key.
    const identity = `${data.setName}::${data.ioName}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    if (data.type === 'Global') {
      globalCount++;
      continue;
    }
    // ProcAllowed kNone: nothing rolls against this power's recharge, so there
    // is no chance to report and the pool is empty by construction. Reached
    // after the Global branch on purpose — globals aren't rolled, so a
    // Mastermind summon still hosts Call to Arms +Def and Expedient
    // Reinforcement +Res, and the badge should keep saying so.
    if (ctx.procsDisallowed) continue;
    // Proc120s and any PPM-less entry can't use the PPM formula.
    if (data.type !== 'Proc' || data.ppm == null) continue;

    // On a kNone shell that delegates, the child whose `BoostsAllowed` can
    // hold this piece is what rolls it — and a piece no child can hold rolls
    // nowhere, which is why an unrouted proc drops out rather than falling
    // back to the shell's geometry. A piece TWO children could hold has no
    // single roll and drops out the same way; the slotted surfaces carry the
    // loud marker (DATA-GAP-REGISTER HC-4).
    let site: ProcRollSite | null;
    try {
      site = resolveProcRollSite(power.procRollSites, data.boostsAllowed);
    } catch {
      continue;
    }
    if (ctx.rollsInExecutedChildren && !site) continue;
    const roll = site ? resolveSiteContext(ctx, site) : ctx;

    const chance = calculateScheduledProcChance(
      data.ppm,
      roll.schedule,
      roll.radius,
      roll.arcDegrees,
      0,
      roll.mods,
    );
    const { category, effectType } = classifyProc(data);
    if (set.category === 'purple') purpleSets.add(set.name);

    entries.push({
      key: procKey,
      setName: set.name,
      ioName: data.ioName,
      ppm: data.ppm,
      chance,
      // Float comparison against the clamp: the formula returns exactly
      // PROC_CHANCE_CAP once clamped, but never trust an === on a float.
      atCap: chance >= PROC_CHANCE_CAP - 1e-9,
      rarity: set.category,
      category,
      effectType,
      // Which of the power's categories admitted this set — the union is the
      // whole point, so the UI can name where an unusual proc came from.
      viaCategory: categories.find((c) => setMatchesCategory(set.type, c)) ?? categories[0],
      ...(site ? { viaPower: site.power } : {}),
    });
  }

  entries.sort((a, b) => b.chance - a.chance || a.setName.localeCompare(b.setName));

  // `schedule` is the resolver's internal handle; its three fields are already
  // published flat as recharge/castTime/rolls, so it stays out of the result.
  const { schedule: _schedule, ...published } = ctx;
  const result: ProcPotential = {
    entries,
    composition: buildComposition(entries),
    total: entries.length,
    atCap: entries.filter((e) => e.atCap).length,
    purpleSets: [...purpleSets].sort(),
    globalCount,
    maxSlots: power.maxSlots ?? 6,
    ...published,
  };
  _cache.set(power, result);
  return result;
}

/**
 * Does an IO set's `type` fall under this power-facing category?
 *
 * Both sides are `BoostSet.GroupName` read twice, so they compare as strings —
 * see BOOST-2 for what the lookup table that used to sit here cost.
 */
function setMatchesCategory(setType: string, category: IOSetCategory): boolean {
  return setType === category;
}

/**
 * How strong a proc vehicle this is. 0 = unremarkable (no badge), 1 = proc bomb,
 * 2 = exceptional.
 *
 * The threshold is **`atCap >= maxSlots`**: every slot could hold a proc running
 * at the 90% ceiling. That states the proc-bomb proposition as a fact about the
 * power rather than an opinion about it, and it is why pool size is the wrong
 * headline — 14 procs at 22% (Shadow Punch, 3s recharge) is not a proc bomb,
 * while 12 procs all at 90% (Dark Consumption, 180s) plainly is. It also scales
 * with the power's own slot ceiling instead of a magic constant.
 *
 * Tier 2 additionally wants twice the slots' worth of capped procs AND at least
 * three distinct effect categories among them — an embarrassment of riches, and
 * enough variety to support genuinely different builds. Counting categories
 * rather than scoring them keeps the app out of deciding which is better.
 *
 * Deliberately blind to what each proc DOES. -Res, knockdown, stun and -ToHit
 * are real build goals; a damage weighting here would have argued against
 * exactly the slotting choices that motivated this feature.
 *
 * **Patch powers score 0 and that is intended.** Once a rain's rolls are scored
 * against the proc's own 10s period (`resolveProcRollSchedule`) rather than the
 * parent's recharge, nothing slotted in one can approach the ceiling, so Sleet,
 * Bonfire, Tar Patch and the rest lose the badge. A rain does re-roll — two
 * modest chances instead of one good one, with Achilles' -Res genuinely
 * re-applying mid-patch — and that is a real reason to slot procs there. It is
 * not what "proc bomb" means: the metaphor is many procs landing at once, which
 * is exactly the cap count this tier measures. The re-roll is reported as
 * `rolls` for anyone who wants it.
 *
 * Calibrated against all 3,159 Homecoming powers with a proc pool: ~15% reach
 * tier 1+, ~9% tier 2. In a 24-power build that is a handful of badges, not a
 * wall of them.
 */
export type ProcPotentialTier = 0 | 1 | 2;

export function procPotentialTier(potential: ProcPotential): ProcPotentialTier {
  const slots = Math.max(1, potential.maxSlots);
  if (potential.atCap < slots) return 0;
  const cappedCategories = potential.composition.filter((r) => r.atCap > 0).length;
  return potential.atCap >= slots * 2 && cappedCategories >= 3 ? 2 : 1;
}

export const PROC_TIER_LABEL: Record<ProcPotentialTier, string> = {
  0: '',
  1: 'Proc bomb',
  2: 'Exceptional proc bomb',
};

function buildComposition(entries: ProcPotentialEntry[]): ProcCompositionRow[] {
  const byCategory = new Map<string, ProcCompositionRow>();
  for (const e of entries) {
    let row = byCategory.get(e.category);
    if (!row) {
      row = { category: e.category, effectTypes: [], total: 0, atCap: 0 };
      byCategory.set(e.category, row);
    }
    row.total++;
    if (e.atCap) row.atCap++;
    if (e.effectType && !row.effectTypes.includes(e.effectType)) row.effectTypes.push(e.effectType);
  }
  for (const row of byCategory.values()) row.effectTypes.sort();
  // At-cap first: a category where everything fires is the reason to slot here.
  return [...byCategory.values()].sort(
    (a, b) => b.atCap - a.atCap || b.total - a.total || a.category.localeCompare(b.category),
  );
}

