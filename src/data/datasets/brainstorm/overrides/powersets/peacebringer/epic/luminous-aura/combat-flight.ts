/**
 * Combat Flight — OVERRIDES LAYER
 *
 * Hand-written deltas applied on top of the generated power object via
 * `withOverrides()`. The generated layer is now sourced from the live HC
 * binary (exported_powers/), so the legacy numeric pins that used to live
 * here were stale CoD2 values and have been retired (2026-06 override audit).
 * Any remaining entries are display fixes or planner-only enrichments the
 * parser doesn't emit yet — prefer fixing the parser/converter over re-adding
 * an override. See GAME-DATA-PRINCIPLES.md §13 and src/data/README.md.
 *
 * data-gaps-292: dropped `stats.castTime`. The export's `activation_time` is 0.
 *
 * data-gaps-292: dropped `description` / `shortHelp` — the export's `display_help` and
 * `display_short_help` are what the game itself shows, and the converter emits both. The text
 * here was a second source: "Moderate DMG" where the export writes "DMG", a "Damage: Moderate"
 * tail the export has no such line for. It masked data-gaps-293's glued sentences, which is fixed
 * at the converter now.
 *
 * data-gaps-292: emptied. What was left restated the generated value exactly, which is the
 * shape data-gaps-291 caught: invisible until the export under it moves, and then `withOverrides`
 * replaces the whole value and the stale copy wins.
 */
import type { Power } from '@/types';

export const overrides: Partial<Power> = {};
