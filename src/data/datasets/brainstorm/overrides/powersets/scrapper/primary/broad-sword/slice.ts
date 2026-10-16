/**
 * Slice — OVERRIDES LAYER
 *
 * Hand-written deltas applied on top of the generated power object via
 * `withOverrides()`. The generated layer is now sourced from the live HC
 * binary (exported_powers/), so the legacy numeric pins that used to live
 * here were stale CoD2 values and have been retired (2026-06 override audit).
 * Any remaining entries are display fixes or planner-only enrichments the
 * parser doesn't emit yet — prefer fixing the parser/converter over re-adding
 * an override. See GAME-DATA-PRINCIPLES.md §13 and src/data/README.md.
 *
 * data-gaps-292: emptied. The export states the Slice / Boomerang Slice exclusion as
 * `requires: [<the other power>, '!']` on both powers on all four archetypes, and
 * `pick_rules::requires_met` evaluates it. This hand `excludes` covered 1 of those 8.
 */
import type { Power } from '@/types';

export const overrides: Partial<Power> = {};
