/**
 * Conditional-effect selection — shared between the power-display layer
 * (`powerDisplayUtils`, InfoPanel, MechanicAdjusters) and the dashboard calc
 * (`legacy-totals.oracle`).
 *
 * A power's `conditionalEffects` are contributions gated on a caster/target
 * state (Bio Armor adaptation modes, Hide, Domination, drowning, …). This
 * module decides *which* of those are active given the current toggle state.
 * It lives under `utils/` (rather than `components/info/`) so the calc layer
 * can import it without a backwards components→calc dependency.
 *
 * The display-side *merge* (`applyActiveConditionals`, which layers the active
 * subset onto a Power for rendering) stays in `powerDisplayUtils` — the calc
 * doesn't merge; it feeds each active conditional through the same active-power
 * bonus machinery so collisions sum correctly (see `expandActiveConditionals`).
 */

import type { ConditionalEffect, Power } from '@/types';

/**
 * Conditional `id`s that correspond to AT-inherent mechanics already
 * driven by the Header's mechanic bar (Domination, Hide, Fury, etc.).
 * For these ids:
 *   - The MechanicAdjusters InfoPanel section hides its toggle (the
 *     Header already owns the user-facing control).
 *   - `selectActiveConditionals` reads the corresponding existing state
 *     via the `atInherentState` argument instead of `mechanicAdjusters` /
 *     `globalAdjusters`. The merger still layers the binary's actual
 *     conditional templates on top of the base when the AT toggle is on.
 *   - The dashboard calc *skips* them (they already have dedicated total
 *     handling elsewhere) to avoid double-counting.
 *
 * Add new mappings here when a freshly-recognized gate id collides with
 * something the dashboard already controls. Keep curated rather than
 * auto-detected — the binary uses opaque attribute names like
 * `kStealth` that map to different mechanics per AT.
 */
export const AT_INHERENT_CONDITIONAL_IDS: ReadonlySet<string> = new Set([
  'domination',  // kStealth source> on Dominator powers
]);

/** State passed into `selectActiveConditionals` for AT-inherent lookup. */
export interface ATInherentState {
  dominationActive?: boolean;
  // Future entries when more AT inherents map to bin-level conditional gates:
  // stalkerHidden?: boolean;
  // furyLevel?: number;       // truthy iff > 0
  // scourgeActive?: boolean;
  // criticalHitsActive?: boolean;
  // containmentActive?: boolean;
  // sentinelCritActive?: boolean;
  // supremacyActive?: boolean;
}

/**
 * Pick the active subset of `power.conditionalEffects` based on the current
 * Mechanic Adjuster toggle state.
 *
 * Each entry's `scope` decides which map is consulted:
 * - `scope: 'global'` → caster-state mechanics share state across powers
 *   (Bio Armor adaptations, Hide, Domination, In Combat) and look up by
 *   bare `id` in `globalAdjusters`.
 * - `scope: 'per-power'` (or unspecified) → target-state mechanics keyed
 *   by `<powerName>:<id>` in `mechanicAdjusters`.
 *
 * Exception: ids in `AT_INHERENT_CONDITIONAL_IDS` are looked up via
 * `atInherentState` so the existing Header toggles drive them. Avoids
 * duplicating the user-facing control in two places.
 *
 * Falls back to the entry's `defaultActive` when the user hasn't touched
 * the toggle. The empty-array fast path is the common case.
 */
export function selectActiveConditionals(
  power: Power,
  mechanicAdjusters: Record<string, boolean>,
  globalAdjusters: Record<string, boolean>,
  atInherentState: ATInherentState = {},
  activeModes: readonly string[] = [],
): ConditionalEffect[] {
  const list = power.conditionalEffects;
  if (!list || list.length === 0) return [];
  const active: ConditionalEffect[] = [];
  for (const c of list) {
    const def = !!c.defaultActive;
    let on: boolean;
    if (c.sourceMode && activeModes.includes(c.sourceMode)) {
      // A caster mode the build is in is on, whatever the toggle says: with Radiance running,
      // every Light Affinity power applies its Radiance bonus. Mirrors
      // `coh_math::effective::active_conditionals`.
      on = true;
    } else if (AT_INHERENT_CONDITIONAL_IDS.has(c.id)) {
      // Read from the existing AT-inherent state instead of the new
      // mechanic-adjuster maps so the Header's toggle is the single
      // source of truth.
      switch (c.id) {
        case 'domination':
          on = atInherentState.dominationActive ?? def;
          break;
        default:
          on = def;
          break;
      }
    } else if (c.scope === 'global') {
      const v = globalAdjusters[c.id];
      on = v === undefined ? def : v;
    } else {
      const v = mechanicAdjusters[`${power.internalName}:${c.id}`];
      on = v === undefined ? def : v;
    }
    if (on) active.push(c);
  }
  return active;
}
