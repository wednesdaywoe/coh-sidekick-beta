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
 * Emptied under data-gaps-291. This file arrived as a copy of Homecoming's, where its
 * `allowedSetCategories` restates the generated value verbatim and so costs
 * nothing. Brainstorm's export is a release later and grants Caltrops Knockback
 * and Accuracy enhancement; `withOverrides` replaces the whole array, so the
 * inherited copy outranked the newer export and took Knockback sets off the
 * power. The generated layer is right on its own.
 */
import type { Power } from '@/types';

export const overrides: Partial<Power> = {};
