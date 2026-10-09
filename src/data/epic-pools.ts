/**
 * Epic/Patron Pool data and accessor functions
 * Migrated from legacy/js/data/epics/
 *
 * Epic pools are archetype-specific power pools that unlock at level 35.
 * Heroes have Epic Power Pools, Villains have Patron Power Pools.
 */

import type {
  Power,
  PowerEffects,
  IOSetCategory,
  EnhancementStatType,
  PowerType,
} from '@/types';
import { getActiveDataset } from './dataset';
import { EPIC_POOL_LEVEL, EPIC_TIER_REQUIREMENTS } from './levels';

// ============================================
// EPIC POOL TYPES
// ============================================

export interface EpicPool {
  id: string;
  name: string;
  displayName: string;
  archetype: string;
  description: string;
  icon: string;
  minLevel: number;
  powers: Power[];
}

export type EpicPoolRegistry = Record<string, EpicPool>;

// ============================================
// RAW DATA TYPES (for conversion)
// ============================================

interface LegacyEpicPowerEffects {
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

interface LegacyEpicPower {
  name: string;
  fullName?: string;
  rank: number;
  available: number;
  description: string;
  shortHelp?: string;
  icon: string;
  powerType: string;
  requires?: string[];
  maxSlots: number;
  allowedEnhancements: string[];
  allowedSetCategories: string[];
  /** The transitional effects bag. Absent since the atom1-13 strip took it out of the
   *  epic contract; still present on POOL powers, whose converter kept it. Optional
   *  because this transform serves data from both sides of that line. */
  /** The power's atom stream, the primary side of every reader seam. Carried by
   *  `MINTED_FIELDS`; declared here so the pick is typed rather than indexed loosely. */
  atoms?: Power['atoms'];
  /** EntsAffected — the power-level recipient list `reachesCaster` resolves an atom's
   *  `AnyAffected` pronoun against (TARGETS-3). */
  targetsAffected?: string[];
  targetsAutoHit?: string[];
  effects?: LegacyEpicPowerEffects;
  quickSnipe?: Power['quickSnipe'];
  // Game "mode" gating — the combat states a caster can be in (Kheldian
  // Nova/Dwarf forms, Titan Momentum, Domination, Granite, Swap Ammo, travel
  // toggles). Stamped by `assignModes` in scripts/convert-powerset.cjs, which
  // the epic converter shares with the powerset and pool converters.
  //
  // These are TOP-LEVEL keys on the converted power — siblings of `powerType`,
  // NOT members of `effects` — so the `...effectFields` spread in
  // transformEpicPower cannot reach them. Declared here and re-emitted by
  // `pickModeGates` below; see that helper for what omitting them cost.
  //
  // `modesDisallowed` is the only one epic data carries today (401/405 HC
  // powers), because convert-epic-pools.cjs does not call `extractModeVariants`
  // and epic powers set/suspend/require no modes. The other four are carried
  // anyway: the stamping code is shared, so an epic power that starts gating
  // must not need a second round of this same bug to be noticed.
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

interface LegacyEpicPool {
  id: string;
  name: string;
  displayName?: string;
  archetype: string;
  description: string;
  icon: string;
  requires?: string[];
  minLevel: number;
  powers: LegacyEpicPower[];
}

export type LegacyEpicPoolRegistry = Record<string, LegacyEpicPool>;

// ============================================
// DATA TRANSFORMATION
// ============================================

/**
 * The mode-gating fields, in the order the converter documents them.
 * Mirrors `MODE_GATE_FIELDS` in src/data/power-pools.ts — the two facades are
 * near-duplicate transforms by design, and mode gating is not pool- or
 * epic-specific. `pool-epic-mode-gates.test.ts` pins both lists against what
 * the converter actually stamps on the generated data.
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
 * `transformEpicPower` returns an explicit top-level whitelist, and until this
 * helper existed the mode fields were simply not on it: every consumer that
 * reached an epic power through `lookupPower` (which resolves epics via
 * `getEpicPool`) saw `undefined` and read that as "this power is ungated" —
 * the same defect as the pool facade's, and fixed the same way.
 *
 * What it actually costs is smaller here than on the pools, and worth stating
 * so nobody re-derives it: no epic power on any of the three servers gates a
 * Kheldian form, because epic pools are gated on `Disable_Epic` /
 * `Disable_Pool` / `Disable_Toggle`, none of which any power SETS. The one live
 * form gate in epic data is Thunderspy's, where Tarantula Conversion sets
 * `Widow_Tarantula_Mode` and 11 VEAT patron clicks (Leviathan / Mu / Soul
 * Mastery) refuse it — those were being offered in Tarantula form, and are not
 * any more.
 *
 * **Absent stays absent.** The converter omits an empty mode array rather than
 * emitting `[]` (see `assignModes`), and every consumer treats a missing key as
 * "no gating", so copying only the keys that are present keeps the transformed
 * power shaped like the raw one instead of littering it with `undefined`s.
 */
function pickModeGates(legacy: LegacyEpicPower): ModeGates {
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

function pickMinted(legacy: LegacyEpicPower): Minted {
  const minted: Record<string, unknown> = {};
  for (const field of MINTED_FIELDS) {
    const value = legacy[field];
    if (value !== undefined) minted[field] = value;
  }
  return minted as Minted;
}

/**
 * Transform legacy epic power to typed Power
 */
function transformEpicPower(legacy: LegacyEpicPower): Power {
  // Destructure stats that need renaming, spread the rest through directly.
  //
  // The bag left the epic contract with atom1-13 and this went on destructuring it, so
  // `getEpicPoolsForArchetype` threw on every dataset and no epic pool could be listed or
  // picked at all. Every scalar below also rides `legacy.stats`, which `pickMinted` carries
  // through untouched and which the consumers already prefer
  // (`power.stats?.recharge ?? power.effects?.recharge`), so a bagless power loses nothing
  // by taking the `{}` branch — including the toggle endurance conversion, which
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
  // Clicks pay a flat cost per activation and must NOT be divided by the tick
  // period (doing so doubled e.g. Power Boost's 9.75 to 19.5). Mirrors the
  // isToggle gating in power-pools.ts:transformPoolPower.
  const isToggle = legacy.powerType === 'Toggle';
  const endPerSec = endurance
    ? (isToggle ? endurance / (activatePeriod || 0.5) : endurance)
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
    requires: legacy.requires,
    ...(legacy.quickSnipe ? { quickSnipe: legacy.quickSnipe } : {}),
    ...pickModeGates(legacy),
    ...pickMinted(legacy),
    // Emitted only when the legacy power actually carried a bag. A bagless epic power must
    // read `effects === undefined`, the same as every powerset power post-strip: the display
    // and toggle paths gate on `if (!power.effects)`, and an all-undefined object is truthy
    // enough to send them down the populated branch with nothing in it.
    ...(legacy.effects ? {
      effects: {
        // Stats (renamed from legacy format)
        accuracy,
        range,
        recharge,
        enduranceCost: endPerSec,
        castTime: activationTime,
        effectArea: effectArea as PowerEffects['effectArea'],
        radius,
        arc,
        maxTargets,
        // All other effects pass through directly (damage, buffs, debuffs,
        // mez, protection, resistance, movement, stealth, summon, etc.)
        ...effectFields,
      } as PowerEffects,
    } : {}),
  };
}

/**
 * Transform legacy epic pool to typed EpicPool
 */
function transformEpicPool(legacy: LegacyEpicPool): EpicPool {
  return {
    id: legacy.id,
    name: legacy.name,
    displayName: legacy.displayName || legacy.name,
    archetype: legacy.archetype,
    description: legacy.description,
    icon: legacy.icon,
    minLevel: legacy.minLevel,
    powers: legacy.powers.map(transformEpicPower),
  };
}

/**
 * Transform entire registry
 */
function transformRegistry(legacy: LegacyEpicPoolRegistry): EpicPoolRegistry {
  const registry: EpicPoolRegistry = {};
  for (const [id, pool] of Object.entries(legacy)) {
    registry[id] = transformEpicPool(pool);
  }
  return registry;
}

// ============================================
// EPIC POOL REGISTRY
// ============================================

// Lazy-cache the transformed registry per dataset. The raw registry rides in
// the active dataset's dynamic chunk via `getActiveDataset().epicPoolsRaw`
// (not a static cross-dataset import), so only the active server's epic-pool
// data is downloaded; the transform runs once per dataset on first access.
const _registryCache = new Map<string, EpicPoolRegistry>();

function _activeRegistry(): EpicPoolRegistry {
  const ds = getActiveDataset();
  let r = _registryCache.get(ds.id);
  if (!r) {
    r = transformRegistry(ds.epicPoolsRaw);
    _registryCache.set(ds.id, r);
  }
  return r;
}

/**
 * Get all epic pools
 */
export function getAllEpicPools(): EpicPoolRegistry {
  return _activeRegistry();
}

// ============================================
// ACCESSOR FUNCTIONS
// ============================================

/**
 * Get an epic pool by ID (e.g., "sentinel_dark_mastery")
 */
export function getEpicPool(id: string): EpicPool | undefined {
  return _activeRegistry()[id];
}

// Hero ATs that lack patron pool data use their villain counterpart's patron pools.
// All ATs can access patron pools in-game (unlocked via going rogue/villain).
// Blasters are paired with Mastermind here because the in-game proliferation
// gave Blaster patron pools (Leviathan, Soul) the heavy-hitting Mastermind
// roster (School of Sharks + Knockout Blow / Chum Spray + Spirit Shark Jaws
// for Leviathan, etc.) — not Corruptor's lighter Hibernate / Coralax-summon
// roster. Mace and Mu Mastery are already authored natively for Blaster, so
// only Leviathan and Soul fall back, and they need the Mastermind variant.
const PATRON_POOL_FALLBACK: Record<string, string> = {
  defender: 'corruptor',
  tanker: 'brute',
  scrapper: 'stalker',
  controller: 'dominator',
  blaster: 'mastermind',
};

// Villain ATs that lack epic pool data use their hero counterpart's epic pools.
// Epic pools were proliferated to villain ATs in-game.
const EPIC_POOL_FALLBACK: Record<string, string> = {
  corruptor: 'defender',
  brute: 'tanker',
  stalker: 'scrapper',
  dominator: 'controller',
  mastermind: 'defender',
};

const PATRON_POOL_NAMES = new Set(['Leviathan Mastery', 'Mace Mastery', 'Mu Mastery', 'Soul Mastery']);

// Game `@Class_<Name>` tokens → our archetype ids. Epic/ancillary pools gate
// their powers with `requires` expressions like `$archetype @Class_Mastermind ==`
// (or `… @Class_Defender == @Class_Corruptor == ||` for a shared copy). This is
// the authoritative game restriction on which archetypes may take the pool.
const CLASS_TOKEN_TO_AT: Record<string, string> = {
  blaster: 'blaster', brute: 'brute', controller: 'controller', corruptor: 'corruptor',
  defender: 'defender', dominator: 'dominator', mastermind: 'mastermind', scrapper: 'scrapper',
  sentinel: 'sentinel', stalker: 'stalker', tanker: 'tanker', peacebringer: 'peacebringer',
  warshade: 'warshade', arachnos_soldier: 'arachnos_soldier', arachnos_widow: 'arachnos_widow',
  guardian: 'guardian',
};

/**
 * The set of archetype ids a pool is gated to, read from its powers' `requires`
 * `@Class_<Name>` tokens. An empty set means the pool carries no archetype gate
 * (unrestricted / legacy data without baked-in class expressions). No pool uses
 * a negated (`!=`) class gate, so every `@Class` token is an allow.
 */
function poolArchetypeGate(pool: EpicPool): Set<string> {
  const gate = new Set<string>();
  for (const power of pool.powers) {
    if (!power.requires?.length) continue;
    // Joined only to ask a question of it — never split back apart (COND-8).
    const req = power.requires.join(' ');
    const re = /@Class_([A-Za-z_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(req)) !== null) {
      const at = CLASS_TOKEN_TO_AT[m[1].toLowerCase()];
      if (at) gate.add(at);
    }
  }
  return gate;
}

/**
 * Whether the game's `@Class` gate on a pool admits the given archetype.
 * Ungated pools (empty set) are treated as admitted so legacy data without
 * baked-in class expressions keeps its prior behavior.
 */
function poolAdmitsArchetype(pool: EpicPool, normalizedId: string): boolean {
  const gate = poolArchetypeGate(pool);
  return gate.size === 0 || gate.has(normalizedId);
}

/**
 * Get epic pools for a specific archetype
 * @param archetypeId - The archetype ID (e.g., "sentinel", "blaster")
 * @returns Array of epic pools available to that archetype
 */
export function getEpicPoolsForArchetype(archetypeId: string): EpicPool[] {
  // Normalize archetype ID (handle "arachnos-soldier" vs "arachnos_soldier")
  const normalizedId = archetypeId.toLowerCase().replace(/-/g, '_');

  // Special case: Arachnos Widow shares patron pools with Arachnos Soldier
  // In-game, both VEATs can access the same patron pools (Leviathan, Mace, Mu, Soul)
  const archTypesToMatch = normalizedId === 'arachnos_widow'
    ? ['arachnos_widow', 'arachnos_soldier']
    : [normalizedId];

  const registry = _activeRegistry();
  const pools = Object.values(registry).filter(
    (pool) => archTypesToMatch.includes(pool.archetype.toLowerCase())
  );

  // Fill in missing patron pools from villain counterpart. Patron pools are
  // genuinely cross-AT in-game (a rogue Blaster can take them), but our data
  // only holds one AT's *copy* of each — whose `@Class` gate names that copy's
  // owner, not everyone who can pick it. So patron borrowing is matched by
  // pool name only; the gate is deliberately NOT consulted here.
  const patronFallbackAT = PATRON_POOL_FALLBACK[normalizedId];
  if (patronFallbackAT) {
    const existingNames = new Set(pools.map(p => p.displayName || p.name));
    const fallbackPools = Object.values(registry).filter(
      (pool) => pool.archetype.toLowerCase() === patronFallbackAT
        && PATRON_POOL_NAMES.has(pool.displayName || pool.name)
        && !existingNames.has(pool.displayName || pool.name)
    );
    pools.push(...fallbackPools);
  }

  // Fill in missing ancillary pools from the hero counterpart, but only those
  // the game actually lets this AT take. The borrowed copy carries an
  // authoritative `@Class` gate (e.g. Defender's shared pools gate
  // `@Class_Defender == @Class_Corruptor ==` — Corruptor is admitted, but a
  // Mastermind borrowing from Defender is not). Without this guard the name
  // dedup leaks every non-colliding hero pool onto the villain AT — the
  // Mastermind-shows-Defender-masteries bug.
  const epicFallbackAT = EPIC_POOL_FALLBACK[normalizedId];
  if (epicFallbackAT) {
    const existingNames = new Set(pools.map(p => p.displayName || p.name));
    const fallbackPools = Object.values(registry).filter(
      (pool) => pool.archetype.toLowerCase() === epicFallbackAT
        && !PATRON_POOL_NAMES.has(pool.displayName || pool.name)
        && !existingNames.has(pool.displayName || pool.name)
        && poolAdmitsArchetype(pool, normalizedId)
    );
    pools.push(...fallbackPools);
  }

  return pools;
}

// ============================================
// EPIC POWER AVAILABILITY CHECKING
// ============================================

/**
 * Check if epic pools are available at the given level
 */
export function areEpicPoolsUnlocked(level: number): boolean {
  return level >= EPIC_POOL_LEVEL;
}

/**
 * Check if a specific epic pool power is available based on level and selected powers
 *
 * Rules:
 * - Epic pools unlock at level 35
 * - First two powers (rank 1-2) are available at level 35
 * - Third power (rank 3) requires level 38 AND 1 power from the pool
 * - Fourth power (rank 4) requires level 41 AND 1 power from the pool
 * - Fifth power (rank 5) requires level 44 AND 2 powers from the pool
 *
 * @param power - The power to check
 * @param level - Current character level
 * @param selectedPowersInPool - Array of power names already selected from this pool
 */
/**
 * Whether a server's epic pools enforce Homecoming's rank-based tier
 * prerequisites (deeper powers require prior picks + a higher level).
 * Homecoming and Rebirth do; Thunderspy's epic pools are flat (no
 * prerequisites). New servers default to the tiered model.
 */
function epicPoolsHaveTierPrereqs(datasetId: string): boolean {
  return datasetId !== 'thunderspy';
}

export function isEpicPowerAvailable(
  power: Power,
  level: number,
  selectedPowersInPool: string[]
): boolean {
  // Epic pools not available before level 35
  if (level < EPIC_POOL_LEVEL) return false;

  // Powers with available=-1 are auto-granted powers that should never be shown in selection
  if (power.available < 0) {
    return false;
  }

  // Per-server rule: the rank-based tier prerequisites (deeper powers need
  // prior picks + a higher level) are a Homecoming/Rebirth convention.
  // Thunderspy's epic pools are FLAT — once epic pools unlock, any power is
  // selectable with no prior-pick requirement (Tspy dev-confirmed: e.g. Body
  // Mastery's Physical Perfection can be taken as your only pick). Enforcing the
  // HC tiers uniformly wrongly blocked those picks on Thunderspy.
  if (!epicPoolsHaveTierPrereqs(getActiveDataset().id)) {
    return true;
  }

  const rank = power.rank || 1;
  const numSelectedPowers = selectedPowersInPool.length;

  // Rank 1-2: Available at level 35 (epic pool unlock)
  if (rank <= 2) {
    return level >= EPIC_TIER_REQUIREMENTS.TIER_1_2.minLevel;
  }

  // Rank 3: Requires level 38 and 1 power from the pool
  if (rank === 3) {
    if (level < EPIC_TIER_REQUIREMENTS.TIER_3.minLevel) return false;
    return numSelectedPowers >= EPIC_TIER_REQUIREMENTS.TIER_3.requiredPowers;
  }

  // Rank 4: Requires level 41 and 1 power from the pool
  if (rank === 4) {
    if (level < EPIC_TIER_REQUIREMENTS.TIER_4.minLevel) return false;
    return numSelectedPowers >= EPIC_TIER_REQUIREMENTS.TIER_4.requiredPowers;
  }

  // Rank 5+: Requires level 44 and 2 powers from the pool
  if (rank >= 5) {
    if (level < EPIC_TIER_REQUIREMENTS.TIER_5.minLevel) return false;
    return numSelectedPowers >= EPIC_TIER_REQUIREMENTS.TIER_5.requiredPowers;
  }

  return false;
}

