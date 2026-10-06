/**
 * Caltrops — OVERRIDES LAYER
 *
 * Hand-written deltas applied on top of the generated power object via
 * `withOverrides()`. The generated layer is now sourced from the live HC
 * binary (exported_powers/), so the legacy numeric pins that used to live
 * here were stale CoD2 values and have been retired (2026-06 override audit).
 * Any remaining entries are display fixes or planner-only enrichments the
 * parser doesn't emit yet — prefer fixing the parser/converter over re-adding
 * an override. See GAME-DATA-PRINCIPLES.md §13 and src/data/README.md.
 *
 * OVERRIDE-5: dropped `allowedSetCategories` — the export states the list per power and
 * the converter emits it. Every copy in this layer restated that list, reordered it, or stated
 * `[]` where the generated layer's absence already means the same thing to `sets_for_power`.
 * Caltrops was one of the restatements until Brainstorm's export moved under it (BRAIN-2).
 */
import type { Power } from '@/types';

export const overrides: Partial<Power> = {};
