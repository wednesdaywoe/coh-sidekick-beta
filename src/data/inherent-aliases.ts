/**
 * Retired inherent `internalName`s, mapped to the name the game actually uses.
 *
 * A build stores each inherent by `internalName`, so renaming one breaks every
 * build already saved under the old name. These eight were renamed when the
 * universal inherents stopped being hand-authored and started coming out of the
 * export (data-gaps-32 / data-gaps-33): the old names were invented by the hand
 * table and match nothing in any fork's data. `PowerSurge` was worse than
 * invented — Electric Armor has a real power by that name, so one address named
 * two different powers.
 *
 * The mapping is by DISPLAY name, which is the one thing that did not change:
 * `Inherent.Prestige.PowerSlide` and `Prestige.Prestige_Sprints.prestige_DVD_Glidep`
 * both show "Prestige Power Slide". Note how little the invented names told you
 * — the five prestige sprints map across in a scrambled order, which is exactly
 * the kind of thing a hand table gets wrong and nobody notices.
 *
 * This is a one-way migration table, not a lookup: nothing should ever write an
 * old name, and the entries only ever get read when an old build is loaded.
 */
export const RETIRED_INHERENT_NAMES: Readonly<Record<string, string>> = {
  // The free travel toggles. The game files all three under a `Prestige_` prefix.
  Ninja_Run: 'Prestige_Ninja_Run',
  Beast_Run: 'Prestige_Beast_Run',
  Athletic_Run: 'Prestige_Athletic_Run',
  // The prestige sprints, by display name:
  PowerSlide: 'prestige_DVD_Glidep', // Prestige Power Slide
  PowerRush: 'prestige_Gamestop_Sprintp', // Prestige Power Rush
  PowerSurge: 'prestige_generic_Sprintp', // Prestige Power Surge
  PowerDash: 'prestige_BestBuy_Sprintp', // Prestige Power Dash
  PowerQuick: 'prestige_EB_Sprintp', // Prestige Power Quick
};

/**
 * The current `internalName` for a stored one — itself, unless it is retired.
 *
 * A retired name that the active server does not grant still resolves here; the
 * caller finds nothing under the new name and drops the power, which is the
 * right answer. Thunderspy grants none of these eight.
 */
export function currentInherentName(storedName: string): string {
  return RETIRED_INHERENT_NAMES[storedName] ?? storedName;
}
