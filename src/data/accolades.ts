/**
 * Accolade toggles — DERIVED from the exported Accolades powerset, never hand-authored.
 *
 * Accolades are ordinary auto-on Self powers (`Temporary_Powers.Accolades`), extracted
 * to each dataset's `generated/accolades.ts` (`ACCOLADES_POWERSET`). The planner presents
 * the *permanent stat* ones as independent on/off toggles (DATA-GAP ACCOLADE-1; the beta's
 * hand-built silo that used to live here is removed).
 *
 * The toggle set is DERIVED, not a curated name list: a stat toggle is an `Auto` power
 * whose atoms carry a +Max HP / +Max End buff. Click/travel/summon accolades (Eye of
 * the Magus, Long Range Teleport, …) carry no such buff and drop out. Deriving surfaces
 * the four the silo wrongly dropped (Iron Man, Super Patriot, Labyrinth Conqueror,
 * Mazebreaker) and carries each buff's real magnitude from its atoms — the silo
 * mis-transcribed several (Marshal's phantom +HP, Born In Battle's dropped +HP).
 *
 * Faction is read from the power's `activateRequires` gate (`… hero eq` / `… villain eq`);
 * the planner shows it as a label and lets each toggle stand alone (no mutual exclusion —
 * the real gates don't 1:1-pair). [[derive-dont-invent]]
 */

import type { Power } from '@/types';
import { maxEndBuffValue, maxHPBuffValue } from './core/atom-query';
import { getActiveDataset, type DatasetId } from './dataset';
import { ACCOLADES_POWERSET as HOMECOMING_ACCOLADES } from './datasets/homecoming/generated/accolades';
import { ACCOLADES_POWERSET as REBIRTH_ACCOLADES } from './datasets/rebirth/generated/accolades';
import { ACCOLADES_POWERSET as THUNDERSPY_ACCOLADES } from './datasets/thunderspy/generated/accolades';
import { ACCOLADES_POWERSET as BRAINSTORM_ACCOLADES } from './datasets/brainstorm/generated/accolades';

/** A generated accolade power carries the hero/villain gate the main Power shape omits. */
export type AccoladePower = Power & { activateRequires?: string[] };

export type AccoladeFaction = 'hero' | 'villain' | 'any';

/**
 * One entry per dataset, and no `default` arm: the switch this replaced fell through to
 * Homecoming, so Brainstorm — which HAS its own generated accolades — silently read live's.
 * A record typed on `DatasetId` cannot compile with a dataset missing, which is the only
 * shape that grows when the roster does.
 */
const ACCOLADES_BY_DATASET: Record<DatasetId, unknown> = {
  homecoming: HOMECOMING_ACCOLADES,
  rebirth: REBIRTH_ACCOLADES,
  thunderspy: THUNDERSPY_ACCOLADES,
  brainstorm: BRAINSTORM_ACCOLADES,
};

function activeAccoladePowerset(): { powers: AccoladePower[] } {
  return ACCOLADES_BY_DATASET[getActiveDataset().id] as { powers: AccoladePower[] };
}

/**
 * A stat toggle carries a permanent +Max HP / +Max End buff, asked of the atoms.
 *
 * The three queries are the three bag slots this used to read (`maxEndBuff`,
 * `maxHPBuff`, `maxHPBuffUnenhanced`), and both MaxHP halves are asked because
 * `ignoreStrength` is the axis the bag minted a second slot for. Every accolade in
 * all four datasets carries the IgnoreStrength half, so the enhanceable query is the
 * one that costs nothing and catches a fork that ships the other.
 *
 * Reading the bag here is what emptied the roster: the bag strip left accolades with
 * 0 slots and 20-28 atoms per fork, `isStatToggle` returned false for all 96, and the
 * accolade fold at `character-totals.ts` never ran at all. A dead reader upstream of
 * the calc, not a wrong number in it.
 */
function isStatToggle(power: AccoladePower): boolean {
  if (power.powerType !== 'Auto') return false;
  return (
    maxEndBuffValue(power) !== undefined ||
    maxHPBuffValue(power) !== undefined ||
    maxHPBuffValue(power, { ignoreStrength: true }) !== undefined
  );
}

/** The stored/selected id for an accolade — its internal name, lower-cased. */
export function accoladeId(power: AccoladePower): string {
  return power.internalName.toLowerCase();
}

/**
 * Hero/villain gate read from the power's `activateRequires` (faction-less ⇒ 'any').
 *
 * The gate is `type char> hero eq`, and the read is the token PAIR rather than a
 * substring of the joined text: the expression is a token array on the wire
 * (COND-8), and asking for an adjacent pair is the same question the game's own
 * postfix evaluator asks — the operand and the comparison that consumes it.
 */
export function accoladeFaction(power: AccoladePower): AccoladeFaction {
  const gate = power.activateRequires ?? [];
  const compared = (faction: string) =>
    gate.some((token, i) => token === faction && gate[i + 1] === 'eq');
  if (compared('hero')) return 'hero';
  if (compared('villain')) return 'villain';
  return 'any';
}

/**
 * Accolade powers present in the exported set but awarded by no badge, so unobtainable in-game
 * yet matching the stat-toggle shape. Dropped from the picker so the list shows only what a
 * player can actually earn (reported as unobtainable accolades).
 *
 * Verified against the Unofficial Homecoming Wiki: neither appears in the hero/villain
 * accolade badge lists, and neither is granted through any inherent, prestige, or leveling
 * path in any dataset's `levels.json`. The roster is derived, not hand-authored, so this is
 * the one curated exception — and a fork that later activates one needs only remove it here.
 */
const UNOBTAINABLE_ACCOLADES = new Set(['Super_Patriot', 'Iron_Man']);

/** The permanent stat-buff accolades the planner offers as toggles, in game order. */
export function getAccolades(): AccoladePower[] {
  return activeAccoladePowerset()
    .powers
    .filter(isStatToggle)
    .filter((power) => !UNOBTAINABLE_ACCOLADES.has(power.internalName));
}

/**
 * Every accolade the export carries, toggle or not.
 *
 * The Mids importer needs the wider roster to tell two skips apart: a name that is a real
 * accolade with no stat buff (Eye of the Magus) has no toggle by design and drops silently,
 * while a name in neither list is a roster divergence and has to warn. Reading only
 * `getAccolades()` collapses those two into one silent drop, which is the shape that let
 * MBDIMPORT-1 sit unnoticed.
 */
export function getAllAccolades(): AccoladePower[] {
  return activeAccoladePowerset().powers;
}

/**
 * Modes the game requires for this accolade's buff to apply, as display labels.
 *
 * Empty for the permanent ones, which is nearly all of them. The totals fold every selected
 * accolade unconditionally, so a non-empty list means the buff is real but conditional and the
 * picker has to say so. Read off `modesRequired`, so a fork that gates a different accolade
 * needs no code change. The accolade converter was the fourth tree to call `assignModes` and
 * the last to get it, which is why this read empty everywhere until 2026-08-21.
 */
export function accoladeRequiredModes(power: AccoladePower): string[] {
  return (power.modesRequired ?? []).map(spacedMode);
}

/**
 * A mode key spelled for display: `InLabyrinth` reads as "In Labyrinth". Separators and
 * camel-case seams become spaces and nothing else changes, matching `coh_data`'s `mode_label`.
 *
 * Deliberately not the beta's `modeLabel` from mode-suppression.ts, which maps a curated set of
 * form tokens to nicer names (`FastMode` → "Momentum"). That map doesn't know these tokens, and
 * exporting a second `modeLabel` would put two readers of the same name in two barrels with
 * import order deciding.
 */
function spacedMode(token: string): string {
  return token.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Resolve a selected accolade id to its power (active dataset), or undefined. */
export function getAccolade(id: string): AccoladePower | undefined {
  return getAccolades().find((power) => accoladeId(power) === id);
}
