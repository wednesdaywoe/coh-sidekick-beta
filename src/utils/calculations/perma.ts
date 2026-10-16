/**
 * Perma tracker calculations
 *
 * A power is "perma" when its effective recharge time is equal to or less than
 * its duration, meaning it can be reactivated immediately when it expires.
 *
 * "Its duration" is the CASTER-SIDE window (`selfStateWindow`) — the longest state the
 * caster is actually keeping up, never the bag's `buffDuration`, which is a plurality
 * vote over every timed effect and on a debuffing power reports the FOE's clock.
 *
 * Formula:
 *   duration       = the longest caster-side state's own duration
 *   rechargeNeeded = (baseRecharge / duration) - 1  (total +rech% required for perma)
 *   totalRecharge  = slottedRecharge + globalRecharge (combined from slotting + set bonuses)
 *   netStrength    = clamp(1 + totalRecharge, bounds.floor, bounds.cap)
 *   permaPercent   = (netStrength - 1) / rechargeNeeded * 100  (0% = no bonuses, 100% = perma)
 *   effectiveRecharge = baseRecharge / netStrength
 *
 * Every input comes from the atom stream (data-gaps-155, ported from the 1.0 fork 2026-09-04).
 * The window used to be read off the `effects` bag — a `durations` map keyed by bag slot,
 * gated behind `if (!power.effects) return false` — so it answered "not eligible" for every
 * bagless power, which is what the whole corpus becomes once the writer-side strip lands here
 * (BPORT7). Agreeing with the engine is the point, because the panel gates on this predicate
 * and then renders `coh_math::perma`'s numbers. It is not the same code, though: the engine
 * derives its window from `window_slots`, a mirror of the converter's slot routing, and this
 * reads the atoms. Measured old-rule-vs-new over 21,372 entries on four forks, 0 powers lose
 * eligibility and 57 rows gain it. The two places the mirror could not follow the atoms were
 * data-gaps-154, closed 2026-09-05 in the engine — the redirect stamp below and a self-directed debuff
 * outside the mirror's four penalty slots — so what remains between the two engines is the
 * vendored artifact's lag, rostered in `powerProjectionParity`'s `MIRROR_BLIND_ROWS`.
 */

import type { SelectedPower, Power } from '@/types';
import { atomsOf, baseAtoms, reachesCaster } from '@/data/core/atom-query';
import { landsOnCaster, type AtomicEffect } from '@/data/core/atomic-effect';
import type { EnhancementBonuses } from './enhancement-values';

/**
 * The archetype's RechargeTime `ClampStrength` interval — the bounds the server
 * holds NET recharge strength to (floor 0.25 = the −75% debuff floor, cap 5.0 =
 * +400%). Sourced per class from the export via `AT_TABLES[...].rechargeBounds`.
 *
 * Unlike most reduction clamps this one is genuinely REACHABLE, so it has to be
 * honoured twice over: recharge past the cap must stop buying a faster cycle,
 * and a power whose cycle still can't fit its window at the cap can never be
 * permaed at all. `undefined` leaves both tests out rather than inventing a
 * ceiling — absence is not a number (Rule 1).
 */
export interface RechargeBounds {
  floor: number;
  cap: number;
}

/**
 * How re-firing the power while its caster-side window is still running combines
 * with the copy already up — "does casting early double the buff, or just restart
 * the clock". Read off the atoms' authored stacking flavour, never inferred from
 * durations.
 */
export type RecastBehavior = 'refreshes' | 'stacks';

/**
 * The recast verdict for the caster-side window at `seconds`: every atom that
 * times that window and lands on the caster is classified by its authored
 * stacking flavour, and only a unanimous family yields a verdict. A mix — or a
 * flavour whose recast semantics this repo has not proven (`Extend` lengthens,
 * `Overlap`/`Maximize`/`Ignore`/`Suppress`/`StackThenIgnore`/`Continuous` each
 * mean something else) — yields `undefined`: a single badge would misdescribe at
 * least one row, and an absent verdict is "unstated", never a claim.
 *
 * The duration join and the caster filter are `casterHoldsStateAt`'s, for the
 * same reason it needs them: the bag's slots carry no target, so the atoms are
 * the only place the export records *whose* clock the flavour governs.
 */
export function recastVerdict(power: Power | SelectedPower, seconds: number): RecastBehavior | undefined {
  let refreshes = false;
  let stacks = false;
  for (const atom of atomsOf(power)) {
    if (!atom.duration) continue;
    if (Math.abs(atom.duration - seconds) > DURATION_MATCH_TOLERANCE) continue;
    if (!atomReachesCaster(atom, power)) continue;
    switch (atom.stacking) {
      case 'Replace':
      case 'Refresh':
        refreshes = true;
        break;
      // The converter's own self-stacking rule (`detectSelfStacking`): these two
      // accumulate only with room above one copy. A capped-at-one or cap-less
      // read is unproven, so it refuses a verdict rather than guessing.
      case 'Stack':
      case 'RefreshToCount':
        if ((atom.stackCap ?? 0) > 1) {
          stacks = true;
          break;
        }
        return undefined;
      case 'Extend':
      case 'Overlap':
      case 'Maximize':
      case 'Ignore':
      case 'Suppress':
      case 'StackThenIgnore':
      case 'Continuous':
      case 'Yes':
      case 'No':
        return undefined;
    }
  }
  if (refreshes && !stacks) return 'refreshes';
  if (stacks && !refreshes) return 'stacks';
  // No atom timed the window, or the families disagree across rows.
  return undefined;
}

export interface PermaInfo {
  /** Base recharge time in seconds */
  baseRecharge: number;
  /** Power duration in seconds */
  duration: number;
  /** Effective recharge after enhancements and global bonuses */
  effectiveRecharge: number;
  /** Total +recharge% needed to reach perma (as decimal, e.g. 2.75 = 275%) */
  rechargeNeeded: number;
  /** Current total +recharge% (slotted + global, as decimal) */
  totalRecharge: number;
  /** Percentage (0-100, capped at 100) — progress toward required recharge */
  permaPercent: number;
  /** True when the power can be kept up permanently */
  isPerma: boolean;
  /**
   * Whether recasting inside the window stacks or merely refreshes
   * (`recastVerdict` at this window's duration); absent when the atoms don't
   * state a single answer.
   */
  recast?: RecastBehavior;
}

/**
 * Check if a power is eligible for perma tracking.
 *
 * A power is perma-eligible when keeping it active permanently is meaningful:
 * - Must be a Click power. Toggles re-apply on a tick cadence (their
 *   `buffDuration` is per-tick refresh, e.g. 0.75s, not a window between
 *   activations) and Auto powers fire automatically — neither has a perma
 *   gap to close. Charged Armor and other defense toggles were
 *   incorrectly tracked because both have recharge + per-tick duration.
 * - Must have a positive recharge AND a caster-side window to keep up — one and
 *   the same test, since `selfStateWindow` is 0 exactly when the power leaves no
 *   such state. Foe debuffs and mez don't count: those expire on the target, and
 *   the planner doesn't model refreshing them by re-firing on cadence.
 * - Perma must be REACHABLE: the cycle at the archetype's maximum recharge
 *   strength still has to fit inside the window (`recharge / bounds.cap <=
 *   duration`). This is the same comparison `calculatePermaInfo` makes for
 *   `isPerma`, evaluated at the ceiling, so eligibility and the ring can no
 *   longer disagree about what is possible.
 * - For powers that deal damage (attacks): require recharge >= 2× duration, since
 *   the duration is typically a hold/mez that roughly matches recharge (Dark Grasp).
 *   This still includes buff-attacks like Soul Drain (120s rech / 30s dur).
 * - For non-damage powers (buffs, summons): require recharge > duration, a looser
 *   threshold that includes Lightning Storm (90s rech / 60s dur).
 *
 * This replaced a `PRACTICAL_RECHARGE_CAP = 5` threshold that was wrong twice:
 * the exported ceiling is a net STRENGTH of 5.0 (i.e. +400%, not the "+500%
 * global recharge cap" its comment claimed), and it was compared against
 * `recharge/duration - 1`, so the gate actually admitted every ratio up to and
 * including 6.0. The band between was powers whose ring the planner drew and the
 * arithmetic could never fill — a large cluster sitting at exactly ratio 6.00
 * (Placate 60/10, Zapp 24/4, Wormhole and Category Five 90/15).
 */
export function isPermaEligible(
  power: Power | SelectedPower,
  bounds?: RechargeBounds,
): boolean {
  if (power.powerType === 'Toggle' || power.powerType === 'Auto') return false;

  const recharge = getRecharge(power);
  const duration = selfStateWindow(power);
  if (recharge <= 0 || duration <= 0) return false;

  if (bounds && recharge / bounds.cap > duration) return false;

  const hasDamage = !!(power as Power).damage;
  return hasDamage ? recharge >= duration * 2 : recharge > duration;
}

/**
 * Effect families a caster-side state can live in — `coh_math::perma::SELF_BUFF_KEYS` in atom
 * vocabulary, which is the bag slot list this file used to carry (`tohitBuff`, `defense`,
 * `absorb`, `specialBuff`, …) asked one layer up, where the export states it. Deliberately not
 * the whole enum: applied control, damage and the instantaneous heal are things that happen TO
 * someone, not states the caster holds.
 */
const SELF_STATE_TYPES: ReadonlySet<string> = new Set([
  'ToHit', 'DamageBuff', 'Defense', 'Resistance', 'Elusivity', 'RechargeTime', 'Recovery',
  'Regeneration', 'Endurance', 'EnduranceDiscount', 'MaxHP', 'MaxEndurance', 'Range',
  'Perception', 'Stealth', 'Movement', 'Absorb', 'MezResist', 'Enhancement', 'Accuracy',
]);

/** `recastVerdict` joins atoms back to a window someone else computed — the engine's `duration`
 *  at the call site in `InfoPanel`, {@link selfStateWindow}'s here — and both round out of the
 *  same source string the atom parses, so they agree exactly today. The tolerance degrades a
 *  future rounding change into a missed verdict rather than a wrong badge. */
const DURATION_MATCH_TOLERANCE = 1e-3;

/**
 * Whether an atom's effect reaches the caster. `notOnCaster` is explicit and
 * decides on its own. An absent or `Unspecified` target proves nothing and reads
 * as "reaches the caster", so missing evidence can never manufacture a veto.
 * Every named recipient goes through `reachesCaster`: the anchored ones answer
 * for themselves, and a `Target` atom resolves through the power's own
 * `targetsAffected` (data-gaps-63). That join replaces the old `targetType`
 * foe-guess, which read "whoever this power is aimed at" as "an enemy" and only
 * survived because the archetypal perma powers carry `targetType: 'Self'`.
 */
function atomReachesCaster(atom: AtomicEffect, power: Power | SelectedPower): boolean {
  if (atom.notOnCaster === true) return false;
  if (!atom.toWho || atom.toWho === 'Unspecified') return true;
  return reachesCaster(atom, power);
}

/**
 * Does this atom's effect reach the caster, for the purpose of the WINDOW?
 * `coh_math::perma::reaches_caster_for_perma`.
 *
 * The sibling above and this one ask the same question under opposite burdens of proof, which
 * is why the file carries both. {@link atomReachesCaster} resolves a named recipient through
 * `reachesCaster`'s data-gaps-63 join, because `recastVerdict` is issuing a CLAIM about how a
 * recast combines and a guess there prints a wrong badge. This one decides whether to VETO a
 * window, so an absent recipient reads as reaching the caster: missing evidence can never
 * delete a window (Rule 1).
 *
 * **One rule over both lists: is the caster named among the recipients**, with an absent list
 * the only exception. That is why this is not `reachesCaster`'s `affectsCaster`, which answers
 * false for a list that is not there as readily as for one naming somebody else.
 *
 * Which list resolves the pronoun is `ownerTargets` first and the power's own only after
 * (data-gaps-63, and the same order {@link reachesCaster} reads them in). `ownerTargets` is stamped
 * by the collectors exactly when a template was pulled out of ANOTHER power's file, so on a
 * redirect it carries the executed power's recipients rather than the caster's aim. Fulcrum
 * Shift is the case that names itself: the parent is `targetsAffected: ['Foe']` and its eight
 * `+Damage` rows arrive from the buff sub-power stamped `['Friend', 'Self']`, so reading the
 * parent's list vetoes a 45s window the caster demonstrably holds — the archetypal Kinetics
 * perma. Only Homecoming and Brainstorm stamp `ownerTargets` on those rows; Rebirth and
 * Thunderspy carry a 1s window there and stay ineligible in both engines, which is a fork-side
 * residual and not this rule's business.
 *
 * **Why a union answers a per-row question.** Both lists once had their own burden here: the
 * stamped one named its recipients outright, while the power's own `targetsAffected` is a union
 * over every row, so the read was lenient — no `Self` proves nothing, only a foe entry is
 * evidence against. That inverts the one direction a union is sound in. A union is a SUPERSET
 * of every row's recipients, so `Self` in it does not put THIS row on the caster, but `Self`
 * missing from it puts no row of the power on him, this one included. The weak direction is the
 * positive one; the negative direction is a proof.
 *
 * Both halves cost a shipped ring. Reading the stamped list leniently gives Recall Friend and
 * Shadow Recall a 1.5s ring off the TELEPORTED ally's translucency — the rings data-gaps-156 had just
 * removed — and hands Brainstorm's Adrenalin Boost a 90s window stamped `['DeadPlayerFriend']`
 * (data-gaps-154). Reading the power's own list leniently hands the caster every ally-only buff's
 * clock, because such a power names `Friend` and no foe at all: 47 power entries over 22
 * (fork, power) pairs drew a ring on a buff nobody holds — Adrenalin Boost, Painbringer, Amp Up,
 * Fortify Pack, Experimental Injection, Mutation, Elixir of Life, Thunderspy's Motivate and
 * Discipline Allies and its two teleports (data-gaps-153, closed 2026-09-05;
 * `coh_math::perma::target_recipients_reach_caster` is the twin). The archetypal perma team
 * buffs are separated by the same field and keep their windows: Accelerate Metabolism and
 * Chrono Shift state `['Friend', 'Self']`, Farsight `['Teammate', 'Self']`.
 */
function reachesCasterForPerma(a: AtomicEffect, power: Power | SelectedPower): boolean {
  if (a.notOnCaster === true) return false;
  // A marker mod attaches to a map marker entity, never to a character.
  if (a.toWho === 'Marker') return false;
  if (a.toWho === 'Target' || a.toWho === 'TargetOnly' || a.toWho === 'TargetOnlyAndPets') {
    const owner = a.ownerTargets;
    if (owner?.length) return owner.includes('Self');
    const targets = power.targetsAffected;
    return targets?.length ? targets.includes('Self') : true;
  }
  return true;
}

/**
 * Is this atom a state the caster is in, rather than one applied to someone else?
 *
 * Two tests, and the second is the one the family alone can't answer. A DEBUFF row routes to a
 * `*Debuff` slot, and of those only the four the converter's self-penalty branches tag
 * (damage / recharge / tohit / accuracy) are ever the caster's — each still having to prove
 * `toWho: 'Self'`, which is Granite Armor's −damage and Burnout's endurance crash. Everything
 * else that routes to a debuff slot is the FOE's state. That is the same partition the deleted
 * `SELF_BUFF_KEYS` / `SELF_PENALTY_KEYS` pair drew, minus the slot names.
 *
 * The debuff face is spelled two ways and both have to be read: a negative scale, and the
 * table. A foe slow is a POSITIVE scale on `*_Slow` (Spin's 0.2 on `Melee_Slow`), and reading
 * only the sign hands the caster every PBAoE's slow window.
 */
function carriesCasterState(a: AtomicEffect): boolean {
  const family = SELF_STATE_TYPES.has(a.effectType)
    // Mez at aspect `Res` is protection — a caster state. Applied mez is not.
    || (a.effectType === 'Mez' && a.aspect === 'Res')
    // Healing STRENGTH routes to `specialBuff` and holds a window (Field Medic's 60s); the heal
    // itself is `Abs`, a heal-over-time tick window rather than a state.
    || ((a.effectType === 'Heal' || a.effectType === 'HealResistance') && a.aspect !== 'Abs');
  if (!family) return false;
  const table = (a.modifierTable ?? '').toLowerCase();
  const debuff = (a.scale ?? 0) < 0 || table.includes('debuff') || table.includes('slow');
  return !debuff || landsOnCaster(a);
}

/**
 * The recharge-and-window cycle a PLANNER-SYNTHESISED power states by hand — the one shape the
 * atom rule cannot answer for, and the only one this file still reads a bag for.
 *
 * `createArchetypeInherentPower` builds the archetype cards out of `archetypes.ts` metadata:
 * a hand-authored `effects` bag, no atoms and no `stats`. Domination is the only Click among
 * the fourteen, and its 200s / 90s cycle is written there rather than read from the export,
 * because this fork carries no join from an archetype's declared inherent to the
 * `Inherent.Inherent` power holding it. (The 1.0 fork closed that join under data-gaps-277 and its
 * card now carries the twin's own stats and atoms; until the same join lands here, an
 * atom-only window would take Domination's perma ring away.)
 *
 * Scoped on "no atoms at all", which is checkable and self-retiring rather than a preference:
 * measured over all four contract bundles and the generated powerset layer, **every** exported
 * power carries atoms — 0 of 3417 / 2855 / 2884 / 3498 are atom-less — so this arm can only
 * ever answer for something the planner made up. It is emphatically NOT a fallback for a power
 * whose atoms carry no caster-side window: that answer is 0, and it stays 0.
 */
function authoredCycle(power: Power | SelectedPower): { recharge: number; window: number } | undefined {
  if (atomsOf(power).length > 0) return undefined;
  const bag = power.effects;
  if (!bag) return undefined;
  const recharge = typeof bag.recharge === 'number' && bag.recharge > 0 ? bag.recharge : 0;
  const window = typeof bag.buffDuration === 'number' && bag.buffDuration > 0 ? bag.buffDuration : 0;
  return recharge > 0 && window > 0 ? { recharge, window } : undefined;
}

/**
 * How long the caster holds something worth keeping up, in seconds; 0 when there is no such
 * state, which is what makes eligibility one test rather than two
 * (`coh_math::perma::self_state_window_from_atoms`).
 *
 * Two sources. A summon's lifetime rides `summonWindow`, stamped by the converter's own summon
 * resolution on the row it read — which `EntCreate` row IS the power's window is a question no
 * rule over `duration` can answer (data-gaps-14). Gated rows count there: Soul Extraction's ghosts are
 * tier-gated and exactly one materializes, so the stamp is the admission and the gate is not.
 * Everything else is the longest window a base caster-state atom holds open.
 *
 * The longest window wins when several qualify — perma tracking is about the state that has to
 * survive the recharge gap, and a shorter buff riding along re-applies with the power either way.
 */
export function selfStateWindow(power: Power | SelectedPower): number {
  const authored = authoredCycle(power);
  if (authored) return authored.window;

  let window = 0;
  for (const a of atomsOf(power)) {
    if (a.summonWindow !== undefined && a.summonWindow > 0) window = Math.max(window, a.summonWindow);
  }
  for (const a of baseAtoms(power)) {
    if (!(a.duration > 0)) continue;
    if (!carriesCasterState(a)) continue;
    if (!reachesCasterForPerma(a, power)) continue;
    window = Math.max(window, a.duration);
  }
  return window;
}

/**
 * Calculate perma info for a power.
 *
 * @param power - The power definition
 * @param enhBonuses - Enhancement bonuses for the power (from calculatePowerEnhancementBonuses)
 * @param globalRecharge - Global recharge bonus as a decimal (e.g., 0.7 for 70%)
 */
export function calculatePermaInfo(
  power: Power | SelectedPower,
  enhBonuses: EnhancementBonuses,
  globalRecharge: number,
  bounds?: RechargeBounds,
): PermaInfo | null {
  // Toggles and autos don't have a perma cycle (see isPermaEligible).
  if (power.powerType === 'Toggle' || power.powerType === 'Auto') return null;

  const baseRecharge = getRecharge(power);
  const duration = selfStateWindow(power);
  if (baseRecharge <= 0 || duration <= 0) return null;

  // StrengthsDisallowed('RechargeTime'): the game applies NO recharge strength
  // to this power — Hasten, set bonuses, and slotted IOs are all ignored (Rune
  // of Protection, the armor T9s, some MM summons). GlobalStrengthsDisallowed
  // keeps slotted enhancement but ignores globals (Kuji-In Rin). Server-side
  // .powers data, HC only; see Power.strengthsDisallowed.
  const rechargeLocked = power.strengthsDisallowed?.includes('RechargeTime') ?? false;
  const globalLocked = rechargeLocked
    || (power.globalStrengthsDisallowed?.includes('RechargeTime') ?? false);
  const slottedRecharge = rechargeLocked ? 0 : (enhBonuses.recharge ?? 0);
  const totalRecharge = slottedRecharge + (globalLocked ? 0 : globalRecharge);

  // Both numbers below read the CLAMPED net strength, because the game has only
  // the clamped one. `totalRecharge` stays raw for display — it is what the build
  // actually carries — but a build past the +400% cap does not cycle faster and
  // does not get any closer to perma either. Without bounds there is no ceiling to
  // measure against, so it stands aside rather than inventing one; the old
  // `Math.max(1, …)` floor is subsumed by the real exported floor.
  const netStrength = bounds
    ? Math.min(Math.max(1 + totalRecharge, bounds.floor), bounds.cap)
    : Math.max(1, 1 + totalRecharge);
  const effectiveRecharge = baseRecharge / netStrength;
  const rechargeNeeded = (baseRecharge / duration) - 1; // e.g. 450/120 - 1 = 2.75
  const permaPercent = rechargeNeeded > 0
    ? Math.min(100, ((netStrength - 1) / rechargeNeeded) * 100)
    : 100;

  return {
    baseRecharge,
    duration,
    effectiveRecharge,
    rechargeNeeded,
    totalRecharge,
    permaPercent,
    isPerma: effectiveRecharge <= duration,
    recast: recastVerdict(power, duration),
  };
}

/**
 * Base recharge, from `power.stats` — the one place the export states it.
 *
 * The `effects.recharge` arm that stood first here read a bag slot the converter writes from
 * the same source `stats.recharge` comes from — measured across the four bundles it is present
 * on 475 / 443 / 433 / 475 powers, agrees with `stats` on every one and is never the only
 * source — so it dies with the bag. What survives it is {@link authoredCycle}, which is a
 * different claim: a synthesised card states a recharge no export row holds.
 */
function getRecharge(power: Power | SelectedPower): number {
  if (power.stats?.recharge && power.stats.recharge > 0) return power.stats.recharge;
  return authoredCycle(power)?.recharge ?? 0;
}

