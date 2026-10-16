/**
 * Categorization for the Set Bonus Totals popup, grouped the way a CoH player
 * expects (General / Health & Endurance / Defense / Resistance / Mez-Debuff
 * Resistance / Movement).
 *
 * Keyed by the *normalized* stat names produced by `collectAllSetBonuses` /
 * `normalizeStatName` (e.g. "defEnergy", "resLethal", "mezresist") — NOT the
 * raw "defense_(energy)" form. Each entry assigns a group and a row label;
 * paired defense/resistance stats (S/L, F/C, E/N) deliberately share a label so
 * the duplicate the engine emits for the pair collapses to one row.
 *
 * `set-bonus-groups.test.ts` asserts every normalized stat the engine can emit
 * has an entry here, so a new bonus stat can't silently fall into "Misc".
 */

import { formatBonusValue } from '@/utils/set-bonus-format';

export interface StatGroupInfo {
  group: string;
  label: string;
}

export const STAT_GROUP_INFO: Record<string, StatGroupInfo> = {
  // General — offense buffs, recharge, range, knockback
  damage: { group: 'General', label: 'Damage' },
  accuracy: { group: 'General', label: 'Accuracy' },
  tohit: { group: 'General', label: 'ToHit' },
  recharge: { group: 'General', label: 'Recharge' },
  range: { group: 'General', label: 'Range' },
  perceptionradius: { group: 'General', label: 'Perception' },
  kbprotection: { group: 'General', label: 'KB Protection' },
  // The offensive twin of the row above — how hard YOUR knockback hits, not how well you
  // resist theirs. Two different stats, so they get two rows.
  knockbackstrength: { group: 'General', label: 'KB Strength' },
  kbresistance: { group: 'General', label: 'KB Resistance' },
  // Health & Endurance
  maxhp: { group: 'Health & Endurance', label: 'Max HP' },
  regeneration: { group: 'Health & Endurance', label: 'Regeneration' },
  maxend: { group: 'Health & Endurance', label: 'Max Endurance' },
  recovery: { group: 'Health & Endurance', label: 'Recovery' },
  endrdx: { group: 'Health & Endurance', label: 'End Discount' },
  healOther: { group: 'Health & Endurance', label: 'Heal' },
  // Defense (positional + typed; pairs share a label)
  defMelee: { group: 'Defense', label: 'Melee' },
  defRanged: { group: 'Defense', label: 'Ranged' },
  defAoE: { group: 'Defense', label: 'AoE' },
  defSmashing: { group: 'Defense', label: 'Smashing/Lethal' },
  defLethal: { group: 'Defense', label: 'Smashing/Lethal' },
  defFire: { group: 'Defense', label: 'Fire/Cold' },
  defCold: { group: 'Defense', label: 'Fire/Cold' },
  defEnergy: { group: 'Defense', label: 'Energy/Negative' },
  defNegative: { group: 'Defense', label: 'Energy/Negative' },
  defPsionic: { group: 'Defense', label: 'Psionic' },
  defToxic: { group: 'Defense', label: 'Toxic' },
  // Resistance (typed; pairs share a label)
  resSmashing: { group: 'Resistance', label: 'Smashing/Lethal' },
  resLethal: { group: 'Resistance', label: 'Smashing/Lethal' },
  resFire: { group: 'Resistance', label: 'Fire/Cold' },
  resCold: { group: 'Resistance', label: 'Fire/Cold' },
  resEnergy: { group: 'Resistance', label: 'Energy/Negative' },
  resNegative: { group: 'Resistance', label: 'Energy/Negative' },
  resPsionic: { group: 'Resistance', label: 'Psionic' },
  resToxic: { group: 'Resistance', label: 'Toxic' },
  resAll: { group: 'Resistance', label: 'All' },
  // Mez / Debuff Resistance
  mezresist: { group: 'Mez/Debuff Res', label: 'Mez Resistance' },
  debuffresistrecharge: { group: 'Mez/Debuff Res', label: 'Slow Res (Rech)' },
  debuffresistslow: { group: 'Mez/Debuff Res', label: 'Slow Res (Move)' },
  debuffresistendurance: { group: 'Mez/Debuff Res', label: 'End Drain Res' },
  // data-gaps-185: a unique's global repel protection, re-encoded by the vocab as its own stat
  mezResistRepel: { group: 'Mez/Debuff Res', label: 'Repel Resistance' },
  // Mez / control duration (offensive — boosts the mez you apply)
  immobilizeDuration: { group: 'Mez Duration', label: 'Immobilize' },
  holdDuration: { group: 'Mez Duration', label: 'Hold' },
  stunDuration: { group: 'Mez Duration', label: 'Stun' },
  sleepDuration: { group: 'Mez Duration', label: 'Sleep' },
  confuseDuration: { group: 'Mez Duration', label: 'Confuse' },
  terrorDuration: { group: 'Mez Duration', label: 'Fear' },
  // Movement
  runspeed: { group: 'Movement', label: 'Run Speed' },
  flyspeed: { group: 'Movement', label: 'Fly Speed' },
  jumpspeed: { group: 'Movement', label: 'Jump Speed' },
  jumpheight: { group: 'Movement', label: 'Jump Height' },
};

/** Display order for the broad groups. Unlisted groups (e.g. "Misc") sort last. */
export const SET_BONUS_GROUP_ORDER = [
  'General', 'Health & Endurance', 'Defense', 'Resistance', 'Mez Duration', 'Mez/Debuff Res', 'Movement', 'Misc',
];

/**
 * Maps a dashboard `breakdown` map key → the normalized `STAT_GROUP_INFO` key.
 *
 * Always-on global IO procs (LotG +Recharge, Numina/Miracle +Rec/+Reg, Steadfast
 * /Gladiator's +Def(All), Kismet +ToHit, …) are NOT set bonuses, so they never
 * enter the set-bonus Rule-of-5 map the Set Bonus Totals popup reads. They DO
 * land in the per-stat `breakdown` (as `type: 'proc'` sources), which the
 * dashboard tiles and Detailed Totals modal already display. To surface them in
 * the Set Bonus Totals popup too, we fold those proc sources into the matching
 * row — but the breakdown's stat keys differ from the popup's grouping keys for
 * a handful of stats (`toHit` vs `tohit`, `maxHP` vs `maxhp`, `protKnockback` vs
 * `kbprotection`, …). This map covers exactly the keys `applySingleProcEffect`
 * can emit; anything not listed (e.g. Build Up proc `damage`) is intentionally
 * excluded from the totals window.
 */
export const PROC_BREAKDOWN_KEY_TO_GROUP_KEY: Record<string, string> = {
  recharge: 'recharge',
  recovery: 'recovery',
  regeneration: 'regeneration',
  maxHP: 'maxhp',
  toHit: 'tohit',
  runSpeed: 'runspeed',
  // Defense (positional + typed) — keys already match STAT_GROUP_INFO
  defMelee: 'defMelee',
  defRanged: 'defRanged',
  defAoE: 'defAoE',
  defSmashing: 'defSmashing',
  defLethal: 'defLethal',
  defFire: 'defFire',
  defCold: 'defCold',
  defEnergy: 'defEnergy',
  defNegative: 'defNegative',
  defPsionic: 'defPsionic',
  defToxic: 'defToxic',
  // Resistance (typed) — keys already match STAT_GROUP_INFO
  resSmashing: 'resSmashing',
  resLethal: 'resLethal',
  resFire: 'resFire',
  resCold: 'resCold',
  resEnergy: 'resEnergy',
  resNegative: 'resNegative',
  resPsionic: 'resPsionic',
  resToxic: 'resToxic',
  // Mez / Debuff Resistance
  mezResist: 'mezresist',
  debuffResistSlow: 'debuffresistslow',
  debuffResistRecharge: 'debuffresistrecharge',
  protKnockback: 'kbprotection',
};

/**
 * Resolve a dashboard `breakdown` map key (a global stat key like `mezResist`,
 * `maxHP`, `resFire`) to its human-readable Set Bonus Totals label. Tries the
 * direct key, then the case-normalized form (the breakdown uses camelCase global
 * keys; STAT_GROUP_INFO keys are a mix of camelCase — `resFire`, `defMelee` —
 * and all-lowercase — `mezresist`, `maxhp`). Falls back to the raw key rather
 * than dropping it. Used by the Rule-of-5 ring tooltip to name *which* capped
 * bonus a power contributes — often a hidden bundled component (a resistance set
 * silently carrying "Mez Resistance").
 */
export function statKeyToLabel(breakdownKey: string): string {
  const normalized = breakdownKey.toLowerCase().replace(/[^a-z]/g, '');
  return STAT_GROUP_INFO[breakdownKey]?.label ?? STAT_GROUP_INFO[normalized]?.label ?? breakdownKey;
}

/**
 * Dashboard `breakdownKey` → the normalized set-bonus stat name(s) that satisfy
 * it, for the "tracked stats" highlight in the enhancement picker.
 *
 * These are two DIFFERENT vocabularies and they diverge three ways:
 *
 *  1. **Case / rename.** `maxHP` vs `maxhp`, `toHit` vs `tohit`, `runSpeed` vs
 *     `runspeed`, `endurance` vs `endrdx`, `protKnockback` vs `kbprotection`.
 *  2. **Granularity.** IO sets grant one undifferentiated "Mez Resistance (All)"
 *     (`mezresist`); the dashboard tracks it per mez type. `useCalculatedStats`
 *     folds `global.mezResist` into the six STATUS mezzes only — Knockback has
 *     its own `kbresistance`, and Taunt/Placate never receive it — so the
 *     one-to-many mapping stops at those six.
 *  3. **Coverage.** 23 tracked stats have no set-bonus equivalent at all (mez
 *     PROTECTION, absorb, stealth, threat, most debuff resistances). Those are
 *     listed in TRACKED_STATS_WITHOUT_SET_BONUSES rather than merely omitted,
 *     so `set-bonus-tracked-match.test.ts` can pin the full 68-key vocabulary
 *     and a newly-defined stat can't silently join the unmatchable pile.
 *
 * Before this map, the matcher compared RAW tracked keys against NORMALIZED
 * bonus stats, so only the 26 keys that happen to be spelled identically in both
 * vocabularies could ever match: tracking Max HP highlighted 0 of 107 HC sets
 * that grant it, and Mez Resistance 0 of 146.
 *
 * Typed resistances also accept `resAll` — `collectAllSetBonuses` expands an
 * "all damage resistance" bonus into all eight types, so tracking Fire Res must
 * light up a set granting Res(All). Paired stats (S/L, F/C, E/N) are NOT listed
 * here; `buildTrackedStatTargets` applies `getPairedStat` on top, because the
 * engine emits both halves of a pair from a single bonus.
 */
export const TRACKED_STAT_TO_BONUS_STATS: Record<string, readonly string[]> = {
  // --- Identity: tracked key is already a normalized bonus stat ---
  damage: ['damage'],
  accuracy: ['accuracy'],
  recharge: ['recharge'],
  recovery: ['recovery'],
  regeneration: ['regeneration'],
  range: ['range'],
  healOther: ['healOther'],
  defMelee: ['defMelee'],
  defRanged: ['defRanged'],
  defAoE: ['defAoE'],
  defSmashing: ['defSmashing'],
  defLethal: ['defLethal'],
  defFire: ['defFire'],
  defCold: ['defCold'],
  defEnergy: ['defEnergy'],
  defNegative: ['defNegative'],
  defPsionic: ['defPsionic'],
  defToxic: ['defToxic'],
  // --- Typed resistance: also satisfied by a Res(All) bonus ---
  resSmashing: ['resSmashing', 'resAll'],
  resLethal: ['resLethal', 'resAll'],
  resFire: ['resFire', 'resAll'],
  resCold: ['resCold', 'resAll'],
  resEnergy: ['resEnergy', 'resAll'],
  resNegative: ['resNegative', 'resAll'],
  resPsionic: ['resPsionic', 'resAll'],
  resToxic: ['resToxic', 'resAll'],
  // --- Renamed beyond case ---
  toHit: ['tohit'],
  endurance: ['endrdx'],
  maxHP: ['maxhp'],
  maxEndurance: ['maxend'],
  runSpeed: ['runspeed'],
  flySpeed: ['flyspeed'],
  jumpSpeed: ['jumpspeed'],
  jumpHeight: ['jumpheight'],
  perceptionRadius: ['perceptionradius'],
  protKnockback: ['kbprotection'],
  mezResistKnockback: ['kbresistance'],
  debuffResistRecharge: ['debuffresistrecharge'],
  debuffResistSlow: ['debuffresistslow'],
  // --- One-to-many: "Mez Resistance (All)" covers the six status mezzes ---
  mezResistHold: ['mezresist'],
  mezResistStun: ['mezresist'],
  mezResistImmobilize: ['mezresist'],
  mezResistSleep: ['mezresist'],
  mezResistConfuse: ['mezresist'],
  mezResistFear: ['mezresist'],
};

/**
 * Tracked stats no IO set bonus can grant. Tracking one of these is legitimate
 * (the dashboard tile still works) — it simply highlights no sets. Listed
 * explicitly so the vocabulary test distinguishes "correctly unmatchable" from
 * "accidentally unmapped".
 *
 * Mez PROTECTION is the big one: sets grant `knockback_protection` and nothing
 * else, so `protKnockback` is mapped above while its eight siblings are not.
 */
export const TRACKED_STATS_WITHOUT_SET_BONUSES: readonly string[] = [
  'absorb',
  'healReceived',
  'levelShift',
  'threatLevel',
  'toggleEndCost',
  'stealthRadiusPvE',
  'stealthRadiusPvP',
  // Mez protection — only knockback has a set-bonus form
  'protHold',
  'protStun',
  'protImmobilize',
  'protSleep',
  'protConfuse',
  'protFear',
  'protRepel',
  // Mez resistance types outside the "(All)" umbrella
  'mezResistTaunt',
  'mezResistPlacate',
  // Debuff resistances with no set-bonus form (only Slow and Recharge have one)
  'debuffResistDefense',
  'debuffResistEndurance',
  'debuffResistPerception',
  'debuffResistRecovery',
  'debuffResistRegeneration',
  'debuffResistToHit',
  'debuffResistAccuracy',
  'debuffResistRange',
];

/**
 * Short label for a normalized set-bonus stat, for space-constrained inline
 * display (the tracked-bonus chips in the enhancement picker).
 *
 * STAT_GROUP_INFO labels are written to be read UNDER a group heading, so
 * several are ambiguous standalone: Defense "Melee" and Resistance "All" both
 * lose their meaning without the column they sit in. Defense and Resistance
 * labels therefore get their group folded back in as a prefix; every other
 * group's labels are already self-describing.
 */
export function statKeyToChipLabel(normalizedStat: string): string {
  const info = STAT_GROUP_INFO[normalizedStat];
  if (!info) return statKeyToLabel(normalizedStat);
  if (info.group === 'Defense') return `Def ${info.label}`;
  if (info.group === 'Resistance') return `Res ${info.label}`;
  return info.label;
}

/**
 * Render a set-bonus value for inline display.
 *
 * Almost every bonus is a percentage, but knockback PROTECTION is a magnitude
 * the source data stores ×100 ("+400.0% Knockback Protection" = mag 4) — the
 * same ×0.01 the totals engine applies in STAT_TO_GLOBAL. Showing the raw 400%
 * would read as an enormous bonus rather than the mag-4 it is.
 */
export function formatTrackedBonusAmount(normalizedStat: string, value: number): string {
  if (normalizedStat === 'kbprotection') return `Mag ${formatBonusValue(value * 0.01)}`;
  return `+${formatBonusValue(value)}%`;
}

/**
 * Breakdown/global keys that a SET BONUS can produce which are renamed BEYOND
 * case from their STAT_GROUP_INFO tracking key, and which no proc emits (so they
 * are intentionally absent from PROC_BREAKDOWN_KEY_TO_GROUP_KEY). Kept separate
 * from that map so the popup's proc-fold contract ("exactly proc keys") is
 * unchanged. Source of truth for the rename: STAT_TO_GLOBAL in
 * src/utils/calculations/legacy-totals.oracle.ts — when an engine stat's global key
 * diverges from its normalized name, add the reverse here so the over-cap mute
 * (written from the popup, read against the breakdown) still round-trips.
 */
const OVERCAP_BREAKDOWN_ALIASES: Record<string, string> = {
  maxEndurance: 'maxend',
  endurance: 'endrdx',
  mezResistKnockback: 'kbresistance',
};

/**
 * Canonical key for the per-build over-cap mute set (`Build.mutedOverCapStats`).
 *
 * A mute is WRITTEN from a Set Bonus Totals popup row (`row.stat`, a
 * STAT_GROUP_INFO key like `defEnergy` / `mezresist`) but READ against a raw
 * dashboard `breakdown` key (`defEnergy`, `defNegative`, `mezResist`, `maxHP`, …).
 * Those vocabularies differ in case AND in pairing: the popup collapses each
 * paired defense/resistance stat (defEnergy + defNegative → one "Energy/Negative"
 * row) while the breakdown keeps both halves as separate keys. A bare stat key
 * would silence only one half of a pair.
 *
 * So the canonical form is `group|label`. STAT_GROUP_INFO deliberately gives a
 * pair the SAME label, so both halves collapse to one canonical key — muting the
 * row silences every breakdown member it represents; the group prefix keeps
 * Defense "Energy/Negative" distinct from Resistance "Energy/Negative". Proc /
 * breakdown camelCase keys are first remapped into the STAT_GROUP_INFO vocabulary
 * (mezResist→mezresist, maxHP→maxhp, …); an unmapped exotic stat falls back to a
 * stable normalized token so the write and read sides still agree.
 */
export function toCanonicalStatKey(rawKey: string): string {
  // Idempotent: a canonical key ("group|label" or "misc|token") already contains
  // "|", which no raw stat/breakdown key ever does. Return it unchanged so applying
  // this twice (the popup and the store both canonicalize on the write path) can't
  // corrupt it into a "misc|<mash>" that never matches the read side.
  if (rawKey.includes('|')) return rawKey;
  const remapped =
    PROC_BREAKDOWN_KEY_TO_GROUP_KEY[rawKey] ?? OVERCAP_BREAKDOWN_ALIASES[rawKey] ?? rawKey;
  const info =
    STAT_GROUP_INFO[remapped] ??
    STAT_GROUP_INFO[remapped.toLowerCase().replace(/[^a-z0-9]/g, '')];
  if (info) return `${info.group}|${info.label}`;
  return `misc|${remapped.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/** True when `rawKey`'s canonical stat is in the muted set. */
export function isOverCapMuted(rawKey: string, muted: readonly string[]): boolean {
  if (muted.length === 0) return false;
  return muted.includes(toCanonicalStatKey(rawKey));
}
