/**
 * Archetype type definitions
 */

import type { Faction, PowerType } from './common';

// ============================================
// DAMAGE MODIFIERS
// ============================================

export interface DamageModifiers {
  melee: number;
  ranged: number;
  aoe: number;
}

// ============================================
// ARCHETYPE STATS
// ============================================

/** One value per travel axis, keyed as the calc totals key them. */
export interface MovementAxes {
  runSpeed: number;
  flySpeed: number;
  jumpSpeed: number;
  jumpHeight: number;
}

/** Per-level ceiling per travel axis (index = level − 1). */
export interface MovementAxisTables {
  runSpeed: number[];
  flySpeed: number[];
  jumpSpeed: number[];
  jumpHeight: number[];
}

/**
 * An archetype's numbers. The binary half is spread in from each dataset's
 * `generated/archetype-stats.generated.ts` (convert-archetypes.cjs, off classes.bin), so this
 * type has to declare every key that emitter writes — a spread is exempt from excess-property
 * checking, so an undeclared field is not a tsc error here, just a field no consumer can read.
 * `archetype-stats-fidelity.test.ts` reads the shipped data and holds the type to it.
 */

export interface ArchetypeStats {
  /** Base HP at level 50 (attrib_max.hit_points[49]) */
  baseHP: number;
  /** HP cap at level 50 (attrib_max_max.hit_points[49]) */
  maxHP: number;
  /** Base HP per level, index 0 = level 1 through index 49 = level 50 */
  hpTable: number[];
  /** HP cap per level, index 0 = level 1 through index 49 = level 50 */
  hpCapTable: number[];
  /** Absorb ceiling at level 50 (attrib_max_max.absorb[49]). Its own row, not a second
   *  statement of the HP one: Homecoming's Dominator absorbs to 1070.9 against a 1017.4
   *  baseHP (DATA-GAP-REGISTER data-gaps-87). */
  absorbCap: number;
  /** Absorb ceiling per level, index 0 = level 1 through index 49 = level 50 */
  absorbCapTable: number[];
  /** Base endurance pool */
  baseEndurance: number;
  /** Base endurance recovery rate */
  baseRecovery: number;
  /** Base threat level (aggro generation) */
  baseThreat: number;
  /** Damage modifiers by attack type */
  damageModifier: DamageModifiers;
  /** Buff/debuff effectiveness modifier */
  buffDebuffModifier: number;
  /** Total damage strength multiplier cap (e.g., 4.0 = 400%) */
  damageCap: number;
  /** RechargeTime net-strength floor (ClampStrength StrengthMin). 0.25 on every class on
   *  every fork: the −75% debuff floor, so a power slows to at most 4× its base recharge. */
  rechargeFloor: number;
  /** RechargeTime net-strength cap (ClampStrength StrengthMaxTable at level 50). 5.0 on every
   *  class on every fork, the +400% recharge cap. */
  rechargeCap: number;
  /** EnduranceDiscount net-strength floor (ClampStrength StrengthMin). 0.0001 on every class,
   *  which is the epsilon the server adds to the divisor rather than a real floor, so an
   *  endurance debuff is effectively unbounded. */
  enduranceFloor: number;
  /** EnduranceDiscount net-strength cap (ClampStrength StrengthMaxTable at level 50). 5.0 on
   *  every class, the +400% discount cap. */
  enduranceCap: number;
  /**
   * Hand-curated 0.45. This is the purple-patch defense SOFTCAP under a wrong
   * name — a level-diff threshold defense legitimately exceeds, not a clamp.
   * `getDefenseSoftcap` is the sourced answer; this survives as a fallback.
   * The real defense clamp is {@link defenseCeilingTable}.
   */
  defenseCap: number;
  /** Resistance cap as decimal (e.g., 0.75 = 75%) */
  resistanceCap: number;

  // The attribute ceilings ClampCur bounds attrCur against, read from the class binary's
  // AttribMaxTable (DATA-GAP-REGISTER data-gaps-183). Each cap is an ABSOLUTE attribute value, so the
  // percentage a dashboard shows is only recoverable against that class's own base — which is
  // why the bases ride along, and why the published percentage is not a per-class constant: the
  // Arachnos classes author a higher regeneration base under the same 5.0 ceiling, so they cap
  // at 1667% where a Blaster caps at 2000%. All tables are indexed by level − 1.

  /** ToHit base (0.75 on every class) — what the game's hit-chance formula starts from. */
  toHitBase: number;
  /** Per-level ToHit ceiling, absolute (0.95 at level 1 rising to 2.0035 at 50, every class). */
  toHitCapTable: number[];
  /** Regeneration base, absolute. 0.25, and 0.30 on the Arachnos pair and Thunderspy's
   *  Primalist. */
  regenerationBase: number;
  /** Per-level regeneration ceiling, absolute. Read against {@link regenerationBase} it is
   *  1667% on the Arachnos pair, 2000% standard, 2500% on Brute/Tanker/Guardian/Primalist and
   *  3000% on Scrapper/Stalker. */
  regenerationCapTable: number[];
  /** Recovery base, absolute. 1.0, and 1.05 on the Arachnos pair and Primalist. */
  recoveryBase: number;
  /** Per-level recovery ceiling, absolute. Read against {@link recoveryBase} it is 476% on the
   *  Arachnos classes and Primalist, 500% standard, 625% on Defender and 750% on
   *  Controller/Dominator/Mastermind. */
  recoveryCapTable: number[];
  /** The real per-level defense clamp, NOT the softcap {@link defenseCap} misnames. Three
   *  curves across the classes, 1.75 to 2.2505 at level 50. One curve per archetype: every
   *  typed defense row the binary authors agrees with every other on the same archetype. */
  defenseCeilingTable: number[];
  /** The lowest ClampCur lets a debuff push typed defense (AttribMin's scalar, −1.0 on every
   *  player archetype). The game writes "your defense is negated" as a saturating magnitude,
   *  so without this the debuff resolves to nothing (DATA-GAP-REGISTER data-gaps-194). */
  defenseFloor: number;
  /** Base max endurance per level (a flat 100 on every player archetype). */
  maxEnduranceTable: number[];
  /** Max-endurance ceiling per level (120 at level 1 rising to 365 at 50) —
   *  how far +MaxEnd buffs can raise {@link maxEnduranceTable}. */
  maxEnduranceCapTable: number[];

  /** Travel scales at rest, one per axis (1.0 = 21 ft/s for the speeds, 4 ft for jump). */
  movementBase: MovementAxes;
  /** The lowest scale ClampCur lets a debuff push each axis to (AttribMin). 0.1 run/fly and
   *  0.0 jump on every player class, so a grounding power leaves a crawl rather than a negative
   *  speed (DATA-GAP-REGISTER data-gaps-193). */
  movementFloor: MovementAxes;
  /** Per-level ceiling per travel axis, in the same scale units as {@link movementBase}. */
  movementCapTable: MovementAxisTables;

  /** The game's own class token (`Class_Blaster`) — what the effect gates compare against, so
   *  an archetype-forked atom can be matched to a build. */
  className: string;
}

// ============================================
// INHERENT POWER
// ============================================

export interface InherentPower {
  /** Display name of the inherent */
  name: string;
  /** Description of what it does */
  description: string;
  /** Optional icon override (defaults to auto-generated from archetype + power name) */
  icon?: string;
  /**
   * Activation type. Most archetype inherents are passive/always-on ('Auto'),
   * which is the default when this is omitted. Set explicitly for the rare
   * player-activated inherent — e.g. Dominator's Domination is a 'Click' with
   * a recharge/duration cycle, so it must be perma-trackable rather than
   * treated as an auto power.
   */
  powerType?: PowerType;
  /** Optional effects data (recharge, duration, etc.) for display in the info panel */
  effects?: import('./power').PowerEffects;
}

// ============================================
// ARCHETYPE BRANCHES (For Epic ATs like Arachnos)
// ============================================

/**
 * A branch carries no level. Its own powersets carry `specializeAt` from the
 * binary and the character level is one higher, so a hand-typed copy here would
 * be a second statement of a value the export owns.
 */
export interface ArchetypeBranch {
  /** Display name of the branch (e.g., "Bane Spider", "Fortunata") */
  name: string;
  /** Additional primary powerset for this branch (optional) */
  primarySet?: string;
  /** Additional secondary powerset for this branch */
  secondarySet: string;
}

export type ArchetypeBranchId =
  | 'bane-spider'
  | 'crab-spider'
  | 'night-widow'
  | 'fortunata'
  // Thunderspy-only — custom third Widow branch
  | 'tarantula';

// ============================================
// ARCHETYPE DEFINITION
// ============================================

export interface Archetype {
  /** Display name (e.g., "Blaster") */
  name: string;
  /** Hero or villain */
  side: Faction;
  /** Short description of the archetype's role */
  description: string;
  /** The archetype's inherent power */
  inherent: InherentPower;
  /** Base stats and modifiers */
  stats: ArchetypeStats;
  /** Available primary powerset IDs (e.g., "blaster/fire-blast") */
  primarySets: string[];
  /** Available secondary powerset IDs */
  secondarySets: string[];
  /** Branching specializations (for Arachnos Epic ATs) */
  branches?: Partial<Record<ArchetypeBranchId, ArchetypeBranch>>;
}

// ============================================
// ARCHETYPE ID
// ============================================

export type ArchetypeId =
  // Heroes
  | 'blaster'
  | 'controller'
  | 'defender'
  | 'scrapper'
  | 'tanker'
  | 'sentinel'      // HC-only (i25)
  | 'guardian'      // Rebirth-only — Assault primary + Composition secondary
  // Villains
  | 'brute'
  | 'corruptor'
  | 'dominator'
  | 'mastermind'
  | 'stalker'
  // Epic Archetypes - Kheldians (Hero)
  | 'peacebringer'
  | 'warshade'
  // Epic Archetypes - Arachnos (Villain)
  | 'arachnos-soldier'
  | 'arachnos-widow'
  // Thunderspy-only — custom Kheldian-style form-shifter AT
  | 'primalist';

// ============================================
// ARCHETYPE REGISTRY
// ============================================

// Partial because not every dataset ships every archetype — Rebirth's i25
// snapshot predates HC's Sentinel addition, for example. Consumers already
// route most reads through `getArchetype(id)` which returns
// `Archetype | undefined`.
export type ArchetypeRegistry = Partial<Record<ArchetypeId, Archetype>>;
