/**
 * Power Pool data and accessor functions
 * Migrated from legacy/js/data/pools/
 *
 * Power Pools are secondary power sets that any character can take.
 * Players can select up to 4 pools total.
 */

import type {
  PowerPool,
  Power,
  PowerEffects,
  IOSetCategory,
  EnhancementStatType,
  PowerType,
} from '@/types';
import { getActiveDataset } from './dataset';
import { getPoolUnlockLevel } from './levels';

// ============================================
// POWER POOL REGISTRY TYPE
// ============================================

export type PowerPoolRegistry = Record<string, PowerPool>;

// ============================================
// RAW DATA TYPES (for conversion)
// ============================================

interface LegacyPoolPowerEffects {
  // Stats (renamed during transformation)
  accuracy?: number;
  range?: number;
  recharge?: number;
  endurance?: number;
  activatePeriod?: number;
  activationTime?: number;
  effectArea?: string;
  radius?: number;
  arc?: number;
  maxTargets?: number;
  // All other effect fields pass through directly
  [key: string]: unknown;
}

interface LegacyPoolPower {
  name: string;
  fullName?: string;
  rank: number;
  available: number;
  description: string;
  shortHelp?: string;
  icon: string;
  powerType: string;
  /** Ally/foe/self targeting (e.g. "Teammate" for Grant Invisibility). Drives
   *  the ally-only filter that keeps ally-buff defense out of the caster's
   *  totals — must be carried through the transform or that filter sees
   *  undefined and the buff leaks into self stats. */
  targetType?: string;
  requires?: string[];
  maxSlots: number;
  allowedEnhancements: string[];
  allowedSetCategories: string[];
  /** The power's atom stream, the primary side of every reader seam. Carried by
   *  `MINTED_FIELDS`; declared here so the pick is typed rather than indexed loosely. */
  atoms?: Power['atoms'];
  /** EntsAffected — the power-level recipient list `reachesCaster` resolves an atom's
   *  `AnyAffected` pronoun against (TARGETS-3). */
  targetsAffected?: string[];
  targetsAutoHit?: string[];
  /** The transitional effects bag. Absent since the pool converter stopped emitting it
   *  (REBUILD-PROGRESS `effects` bag removal, writer side) — the epic side lost it at
   *  atom1-13 and this one followed. Optional because a legacy or vendored registry
   *  predating the strip still carries one and must keep transforming. */
  effects?: LegacyPoolPowerEffects;
  // Game "mode" gating — the combat states a caster can be in (Kheldian
  // Nova/Dwarf forms, Titan Momentum, Domination, Granite, Swap Ammo, travel
  // toggles). Stamped by `assignModes` / `extractModeVariants` in
  // scripts/convert-powerset.cjs, which the pool and epic converters share
  // precisely because pool powers carry the Kheldian form gates too.
  //
  // These are TOP-LEVEL keys on the converted power — siblings of `powerType`,
  // NOT members of `effects` — so the `...effectFields` spread in
  // transformPoolPower cannot reach them. Declared here and re-emitted by
  // `pickModeGates` below; see that helper for what omitting them cost.
  modesDisallowed?: string[];
  modesRequired?: string[];
  setsModes?: string[];
  modesSuspended?: string[];
  modeVariants?: Record<string, Partial<Power>>;
  // Minted by the converter in the archetype-power shape, and top-level for the same reason the
  // mode gates are: `pickMinted` carries them.
  stats?: Power['stats'];
  effectArea?: Power['effectArea'];
  damage?: Power['damage'];
}

interface LegacyPowerPool {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  icon: string;
  requires?: string[];
  powers: LegacyPoolPower[];
}

export type LegacyPowerPoolRegistry = Record<string, LegacyPowerPool>;

// ============================================
// DATA TRANSFORMATION
// ============================================

/**
 * The mode-gating fields, in the order the converter documents them.
 *
 * Kept as a list (rather than five hand-written property assignments) so the
 * facade's coverage of the converter's mode contract is one greppable place;
 * `pool-epic-mode-gates.test.ts` pins this list against what the converter
 * actually stamps on the generated data.
 *
 * The epic facade carries the identical list — the two transforms are
 * near-duplicates of each other by design, and mode gating is not epic- or
 * pool-specific.
 */
const MODE_GATE_FIELDS = [
  'modesDisallowed',
  'modesRequired',
  'setsModes',
  'modesSuspended',
  'modeVariants',
] as const;

type ModeGates = Pick<Power, (typeof MODE_GATE_FIELDS)[number]>;

/**
 * Lift the mode gates off the raw power verbatim.
 *
 * `transformPoolPower` returns an explicit top-level whitelist, and until this
 * helper existed the mode fields were simply not on it: every consumer that
 * reached a pool power through `lookupPower` (which resolves pools via
 * `getPowerPool`) saw `undefined` and read that as "this power is ungated".
 * The visible symptom was `castableInMode` in the Attack Chain Builder offering
 * Boxing, Kick, Cross Punch and Hasten inside Nova/Dwarf form — all four of
 * which Homecoming's binary explicitly forbids there, and 46 of the 71 live HC
 * pool powers with them. (Thunderspy is the one exception on Hasten: its copy
 * carries `Disable_Pool` only. The facade's job is to be faithful, not to
 * normalize that away.)
 *
 * **Absent stays absent.** The converter omits an empty mode array rather than
 * emitting `[]` (see `assignModes`), and every consumer treats a missing key as
 * "no gating", so copying only the keys that are present keeps the transformed
 * power byte-shaped like the raw one instead of littering it with `undefined`s.
 */
function pickModeGates(legacy: LegacyPoolPower): ModeGates {
  const gates: Record<string, unknown> = {};
  for (const field of MODE_GATE_FIELDS) {
    const value = legacy[field];
    if (value !== undefined) gates[field] = value;
  }
  return gates as ModeGates;
}

/**
 * The fields the converter now mints at the top level, in the shape an archetype power
 * publishes (`scripts/_power-stats.cjs`, atom-migration job 2). Both shapes ship while the bag's
 * execution keys are still written, so a `stats` here sits beside the renamed copies below and
 * states the same numbers. Carried by list for the reason `pickModeGates` exists: this transform
 * is a top-level whitelist, and a field it does not name reaches no consumer.
 */
// `atoms` and `targetsAffected` ride along because the atom-native readers are the
// PRIMARY side of every `xxxValue(power) ?? effects.xxx` seam, and a transform that
// drops the atom stream leaves a pool or epic power answerable only by its bag.
// `targetsAffected` travels with them: it is the power-level list `reachesCaster`
// consults to resolve an `AnyAffected` atom's pronoun, so atoms without it are a
// question the readers cannot answer (TARGETS-3).
// `targetsAutoHit` is its pair, which the Hit Chance Alert reads to tell an attack that rolls
// from one that never misses.
const MINTED_FIELDS = ['stats', 'effectArea', 'damage', 'atoms', 'targetsAffected', 'targetsAutoHit'] as const;

type Minted = Pick<Power, (typeof MINTED_FIELDS)[number]>;

function pickMinted(legacy: LegacyPoolPower): Minted {
  const minted: Record<string, unknown> = {};
  for (const field of MINTED_FIELDS) {
    const value = legacy[field];
    if (value !== undefined) minted[field] = value;
  }
  return minted as Minted;
}

/**
 * Transform legacy pool power to typed Power
 */
function transformPoolPower(legacy: LegacyPoolPower): Power {
  // Destructure stats that need renaming, spread the rest through directly.
  //
  // The bag left the pool contract with the writer-side strip and this went on destructuring
  // it, which is the failure `transformEpicPower` already took: an unguarded destructure of an
  // absent bag throws, and the whole partition stops listing. Every scalar below also rides
  // `legacy.stats`, which `pickMinted` carries through untouched and which the consumers
  // already prefer (`power.stats?.recharge ?? power.effects?.recharge`), so a bagless power
  // loses nothing by taking the `{}` branch — including the toggle endurance conversion, which
  // `character-totals.ts` performs off `stats.endurance / stats.activatePeriod` when no
  // `effects.enduranceCost` is there to prefer.
  const {
    endurance,
    activatePeriod,
    activationTime,
    accuracy,
    range,
    recharge,
    effectArea,
    radius,
    arc,
    maxTargets,
    ...effectFields
  } = legacy.effects ?? {};

  // Toggle endurance is per-tick in the binary data — convert to per-second.
  // Default activate period is 0.5s (standard toggle tick rate) when not explicit.
  // For clicks, endurance is a flat cost per activation.
  const isToggle = legacy.powerType === 'Toggle';
  const effectivePeriod = isToggle ? (activatePeriod ?? 0.5) : undefined;
  const endCost = endurance
    ? (effectivePeriod ? endurance / effectivePeriod : endurance)
    : undefined;

  return {
    name: legacy.name,
    internalName: legacy.fullName?.split('.').pop()?.replace(/\s+/g, '_') ?? legacy.name.replace(/\s+/g, '_'),
    fullName: legacy.fullName,
    available: legacy.available,
    rank: legacy.rank,
    maxSlots: legacy.maxSlots,
    allowedEnhancements: legacy.allowedEnhancements as EnhancementStatType[],
    allowedSetCategories: legacy.allowedSetCategories as IOSetCategory[],
    description: legacy.description,
    shortHelp: legacy.shortHelp,
    icon: legacy.icon,
    powerType: legacy.powerType as PowerType,
    targetType: legacy.targetType as Power['targetType'],
    requires: legacy.requires,
    ...pickModeGates(legacy),
    ...pickMinted(legacy),
    // Emitted only when the legacy power actually carried a bag. A bagless pool power must
    // read `effects === undefined`, the same as every powerset and epic power post-strip: the
    // display and toggle paths gate on `if (!power.effects)`, and an all-undefined object is
    // truthy enough to send them down the populated branch with nothing in it.
    ...(legacy.effects ? {
      effects: {
        // Stats (renamed from legacy format)
        accuracy,
        range,
        recharge,
        enduranceCost: endCost,
        castTime: activationTime,
        effectArea: effectArea as PowerEffects['effectArea'],
        radius,
        arc,
        maxTargets,
        // All other effects pass through directly (damage, buffs, debuffs,
        // mez, movement, stealth, summon, resistance, defense, etc.)
        ...effectFields,
      } as PowerEffects,
    } : {}),
  };
}

/**
 * Transform legacy power pool to typed PowerPool
 */
function transformPowerPool(legacy: LegacyPowerPool): PowerPool {
  return {
    id: legacy.id,
    name: legacy.name,
    displayName: legacy.displayName,
    description: legacy.description,
    icon: legacy.icon,
    requires: legacy.requires,
    powers: legacy.powers.map(transformPoolPower),
  };
}

/**
 * Transform entire registry
 */
function transformRegistry(legacy: LegacyPowerPoolRegistry): PowerPoolRegistry {
  const registry: PowerPoolRegistry = {};
  for (const [id, pool] of Object.entries(legacy)) {
    registry[id] = transformPowerPool(pool);
  }
  return registry;
}

// ============================================
// POWER POOL REGISTRY
// ============================================

// Lazy-cache the transformed registry per dataset. The raw registry rides in
// the active dataset's dynamic chunk via `getActiveDataset().powerPoolsRaw`
// (not a static cross-dataset import), so only the active server's power-pool
// data is downloaded; the transform runs once per dataset on first access.
const _registryCache = new Map<string, PowerPoolRegistry>();

function _activeRegistry(): PowerPoolRegistry {
  const ds = getActiveDataset();
  let r = _registryCache.get(ds.id);
  if (!r) {
    // Drop dormant pools — present in this server's bins but not released
    // (their powers are locked behind a dev-only `accesslevel > 0` gate,
    // flagged `dormant` at convert time by scripts/convert-pool-powers.cjs).
    // Filtered here (not deleted from the generated data) so the set stays
    // available for a possible future "show unreleased" toggle. This is the
    // pool analog of the powerset dormancy filter in src/data/powersets.ts,
    // and replaces the former hand-maintained per-dataset pool allowlist.
    const raw = ds.powerPoolsRaw as unknown as Record<string, { dormant?: boolean }>;
    const live: Record<string, unknown> = {};
    for (const [poolId, pool] of Object.entries(raw)) {
      if (!pool.dormant) live[poolId] = pool;
    }
    r = transformRegistry(live as unknown as LegacyPowerPoolRegistry);
    _registryCache.set(ds.id, r);
  }
  return r;
}

/**
 * Get all power pools
 */
export function getAllPowerPools(): PowerPoolRegistry {
  return _activeRegistry();
}

// ============================================
// ACCESSOR FUNCTIONS
// ============================================

/**
 * Get a power pool by ID (e.g., "speed", "fighting")
 */
export function getPowerPool(id: string): PowerPool | undefined {
  return _activeRegistry()[id];
}

/**
 * Get all pool IDs
 */
export function getPowerPoolIds(): string[] {
  return Object.keys(_activeRegistry());
}

/**
 * Get a specific power from a pool
 */
export function getPoolPower(poolId: string, powerName: string): Power | undefined {
  const pool = getPowerPool(poolId);
  return pool?.powers.find((p) => p.internalName === powerName);
}

/**
 * Get powers available at or before a given level (including rank 1 and 2)
 * Note: available is 0-indexed (available=0 means level 1)
 */
export function getPoolPowersAvailableAtLevel(poolId: string, level: number): Power[] {
  const pool = getPowerPool(poolId);
  if (!pool) return [];
  return pool.powers.filter((p) => p.available < level && p.available >= 0);
}

/**
 * Get the tier-unlocking powers for a pool (typically rank 1 and 2)
 */
export function getPoolEntryPowers(poolId: string): Power[] {
  const pool = getPowerPool(poolId);
  if (!pool) return [];
  return pool.powers.filter((p) => p.available === 0 && !p.requires?.length);
}

/**
 * Check if prerequisites are met for a pool power
 * @param poolId - The pool ID
 * @param powerName - The power to check
 * @param selectedPowers - Array of power names already selected from this pool
 */
export function arePoolPrerequisitesMet(
  poolId: string,
  powerName: string,
  selectedPowers: string[]
): boolean {
  const power = getPoolPower(poolId, powerName);
  if (!power) return false;

  // No requires means no prerequisites
  if (!power.requires?.length) return true;

  // Parse the requires expression
  // Format: "Pool.Speed.Flurry && Pool.Speed.Hasten || Pool.Speed.Flurry && Pool.Speed.Super_Speed"
  // Or count: "Pool.Force_of_Will.Mighty_Leap + Pool.Force_of_Will.Project_Will + ... > 1"
  const tokens = power.requires;

  // Helper: resolve a "Pool.X.Power_Name" atom to its internalName (last segment)
  const resolveAtom = (atom: string): string => {
    const parts = atom.trim().split('.');
    return parts[parts.length - 1];
  };

  // Raw .def `requires` strings are Reverse Polish Notation: operators come
  // after their operands. Two RPN flavors appear in pool data:
  //   • Boolean: `A B && C D && || E F && ||` — Group Fly tier-4 prereqs.
  //   • Count:   `A B + C + N >`              — Sorcery Enflame requires
  //                                            (count of selected from set) > N.
  // Splitting on `||`/`&&`/`+` as infix mangles compound atoms like
  // "Pool.X.A Pool.X.B" into one token whose last segment is just B.
  const lastTok = tokens[tokens.length - 1];
  const isBoolRpn = lastTok === '!' || lastTok === '&&' || lastTok === '||';
  const isCountRpn = lastTok === '>' || lastTok === '>=' || lastTok === '<' || lastTok === '<=';

  if (isBoolRpn) {
    const stack: boolean[] = [];
    for (const tok of tokens) {
      if (tok === '!') {
        if (stack.length < 1) return false;
        stack.push(!stack.pop()!);
      } else if (tok === '&&') {
        if (stack.length < 2) return false;
        const b = stack.pop()!;
        const a = stack.pop()!;
        stack.push(a && b);
      } else if (tok === '||') {
        if (stack.length < 2) return false;
        const b = stack.pop()!;
        const a = stack.pop()!;
        stack.push(a || b);
      } else {
        stack.push(selectedPowers.includes(resolveAtom(tok)));
      }
    }
    return stack.length === 1 ? stack[0] : false;
  }

  if (isCountRpn) {
    const stack: number[] = [];
    for (const tok of tokens) {
      if (tok === '+') {
        if (stack.length < 2) return false;
        const b = stack.pop()!;
        const a = stack.pop()!;
        stack.push(a + b);
      } else if (tok === '>' || tok === '>=' || tok === '<' || tok === '<=') {
        if (stack.length < 2) return false;
        const threshold = stack.pop()!;
        const count = stack.pop()!;
        return tok === '>'  ? count > threshold
             : tok === '>=' ? count >= threshold
             : tok === '<'  ? count < threshold
             :                count <= threshold;
      } else {
        const n = Number(tok);
        if (!isNaN(n) && /^\d+$/.test(tok)) {
          stack.push(n);
        } else {
          stack.push(selectedPowers.includes(resolveAtom(tok)) ? 1 : 0);
        }
      }
    }
    return false;
  }

  // Infix fallbacks below parse a LEGACY hand-edited grammar, not the game's RPN — its
  // operators sit between their operands and its atoms are dotted power paths with no
  // spaces, so joining and re-splitting is the format's own round trip rather than the
  // token-boundary guess COND-8 was about.
  const requiresExpr = tokens.join(' ');

  // Infix count expression fallback: "A + B + C > N"
  if (requiresExpr.includes('>') && requiresExpr.includes('+')) {
    const [sumPart, thresholdPart] = requiresExpr.split('>').map((s) => s.trim());
    const threshold = parseInt(thresholdPart, 10);
    if (!isNaN(threshold)) {
      const atoms = sumPart.split('+').map((s) => s.trim());
      const count = atoms.filter((a) => selectedPowers.includes(resolveAtom(a))).length;
      return count > threshold;
    }
  }

  // Infix fallback (legacy / hand-edited overrides).
  // Split by || (OR conditions)
  const orConditions = requiresExpr.split('||').map((s) => s.trim());

  // Check if any OR condition is satisfied
  return orConditions.some((orCond) => {
    // Split by && (AND conditions)
    const andConditions = orCond.split('&&').map((s) => s.trim());

    // All AND conditions must be met
    return andConditions.every((andCond) => {
      const reqPowerName = resolveAtom(andCond);
      return selectedPowers.includes(reqPowerName);
    });
  });
}

// ============================================
// POOL CATEGORY INFO
// ============================================

export interface PoolCategoryInfo {
  id: string;
  name: string;
  pools: string[];
}

/**
 * Standard pool categories
 */
export const POOL_CATEGORIES: PoolCategoryInfo[] = [
  {
    id: 'travel',
    name: 'Travel',
    pools: ['flight', 'leaping', 'speed', 'teleportation'],
  },
  {
    id: 'combat',
    name: 'Combat',
    pools: ['fighting', 'presence', 'invisibility', 'force_of_will'],
  },
  {
    id: 'support',
    name: 'Support',
    pools: ['medicine', 'leadership'],
  },
  {
    id: 'utility',
    name: 'Utility',
    pools: ['sorcery', 'experimentation'],
  },
];

/**
 * Mutually exclusive pool groups. Only one pool from each group can be taken.
 *
 * The one group is the Specialized pools, and the game states the rule itself — each of
 * these five sets carries a `SetBuyRequires` listing the other four's powers, failing with
 * "You can only have one Specialized power pool in your build." All three forks agree on
 * the same five.
 *
 * This table is a HARDCODE RESTATING THAT EXPORTED RULE, which is a Rule 0 violation and is
 * here only because the converter does not emit `buyRequires` yet — see
 * `scripts/convert-pool-powers.cjs`. It named three for as long as it was hand-written, and
 * missed Gadgetry and Utility Belt. Homecoming was spared because both are dormant there, so
 * the live registry never offered them; Rebirth (Gadgetry live) and Thunderspy (both live)
 * were not, and could hold two or three Specialized pools the game refuses by name.
 *
 * Names all five regardless of dormancy: dormancy is a release state and the gate is on the
 * powerset record either way, so a pool that goes live later must arrive already excluded
 * rather than needing this table edited a third time.
 *
 * Widening it closes the hole; it does not stop the table drifting again. Retire it by
 * emitting `buyRequires` onto the pool record and evaluating that in `getExcludedPools`,
 * which also reaches the VEAT branch gate (`SpecializeAt`) that no group of pool ids can
 * express.
 */
export const POOL_EXCLUSION_GROUPS: string[][] = [
  ['sorcery', 'experimentation', 'force_of_will', 'gadgetry', 'utility_belt'],
];

/**
 * Get the exclusion group a pool belongs to, if any.
 * Returns the other pool IDs in the group that conflict, or null.
 */
export function getExcludedPools(poolId: string): string[] | null {
  for (const group of POOL_EXCLUSION_GROUPS) {
    if (group.includes(poolId)) {
      return group.filter((id) => id !== poolId);
    }
  }
  return null;
}

/**
 * Get pools in a category
 */
export function getPoolsByCategory(categoryId: string): PowerPool[] {
  const category = POOL_CATEGORIES.find((c) => c.id === categoryId);
  if (!category) return [];
  const registry = _activeRegistry();
  return category.pools.map((poolId) => registry[poolId]).filter(Boolean) as PowerPool[];
}

// ============================================
// POWER AVAILABILITY CHECKING
// ============================================

/**
 * Check if power pools are available at the given level
 */
export function arePoolsUnlocked(level: number): boolean {
  return level >= getPoolUnlockLevel(getActiveDataset().id);
}

/**
 * Check if a specific pool power is available based on level and selected powers.
 *
 * Fully DATA-DRIVEN — no rank heuristics or hard-coded travel-power lists.
 * Every gate comes from fields the bin parser already extracts:
 *   - Pools unlock at the active dataset's schedules.bin level
 *     (getPoolUnlockLevel: level 4 on the shared schedule, level 1 on
 *     Thunderspy).
 *   - `power.available` is the power's own 0-indexed unlock level and is the
 *     authoritative level gate, clamped to the pool-unlock floor:
 *       available 0  → level 4 (e.g. Boxing, Flurry — gated by pool unlock)
 *       available 3  → level 4 (early travel: Super Speed, Fly, Jetpack…)
 *       available 13 → level 14 (e.g. Tough, Weave, Whirlwind)
 *   - `power.requires` carries every prerequisite: intra-pool counts
 *     ("2 of {Flurry, Hasten, Super Speed}" for Whirlwind) and mutual-exclusion
 *     locks ("Strike !" on Boxing). Evaluated by arePoolPrerequisitesMet;
 *     empty requires → no prerequisite.
 *
 * This replaces the legacy rank→level mapping + EARLY_TRAVEL_POWERS list, which
 * only approximated what `available` + `requires` already state exactly — and
 * which mis-gated datasets whose pools diverge from Homecoming's 5-power shape
 * (e.g. Thunderspy's 8-power Fighting pool, Rebirth's non-standard unlock levels).
 *
 * @param poolId - The pool ID
 * @param power - The power to check
 * @param level - Current character level
 * @param selectedPowersInPool - Array of power names already selected from this pool
 */
export function isPowerAvailableInPool(
  poolId: string,
  power: Power,
  level: number,
  selectedPowersInPool: string[]
): boolean {
  // Pools as a whole unlock at level 4.
  const poolUnlockLevel = getPoolUnlockLevel(getActiveDataset().id);
  if (level < poolUnlockLevel) return false;

  // available = -1 marks auto-granted sub-powers (Afterburner from Fly, Bio
  // Armor adaptations, etc.) — never user-pickable.
  if (power.available < 0) return false;

  // Data-driven level gate (the power's own unlock level, clamped to the floor).
  if (level < Math.max(poolUnlockLevel, power.available + 1)) return false;

  // Data-driven prerequisites (intra-pool counts + mutual-exclusion locks).
  return arePoolPrerequisitesMet(poolId, power.internalName, selectedPowersInPool);
}

/**
 * Get all available powers from a pool based on level and already selected powers
 * This filters out already selected powers and checks level/prerequisite requirements
 */
export function getAvailablePoolPowers(
  poolId: string,
  level: number,
  selectedPowersInPool: string[]
): Power[] {
  const pool = getPowerPool(poolId);
  if (!pool) return [];

  return pool.powers.filter((power) => {
    // Skip already selected powers
    if (selectedPowersInPool.includes(power.internalName)) return false;
    // Check availability
    return isPowerAvailableInPool(poolId, power, level, selectedPowersInPool);
  });
}
