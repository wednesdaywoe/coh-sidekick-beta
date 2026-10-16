/**
 * Which duration a rendered effect row states, and which one the power-level row states.
 *
 * A module of its own for the reason `resolvePowerMagnitudes` is one: the precedence is the
 * subject under test, and `RegistryEffectsDisplay` is a React component with no render harness
 * in this repo. Grading it through the component would mean grading it through nothing.
 *
 * The precedence exists because the same question has three possible answers after data-gaps-327
 * (PROD6B-BETA-PARITY class 2):
 *
 *  - the ENGINE row's `duration`, which is `recorded_duration` off the atom-derived `durations`
 *    map, so it is the base power's own clock;
 *  - the display bag's per-effect `durations` map;
 *  - the bag's power-level `buffDuration`.
 *
 * The last two are what a stripped bag leaves behind, and they state something else. Dual
 * Pistols' `Executioners_Shot` carries a 10s `buffDuration` that belongs to the `iceammo`
 * conditional entry, on a power whose only ungated duration is the 8s `-Def`. Dark Miasma's
 * `Howling_Twilight` carries 1s, the `EntCreate` marker picked up by the summon-lifespan
 * backfill that fires only because the bag has no duration left to block it, on a power whose
 * debuffs run 30s. So the row wins wherever there is a row, and the bag still answers for a
 * caller that resolved the bag itself.
 */

/** The shape this reads off a rendered row — the engine's duration, when it carries one. */
export interface RowDurationSource {
  duration?: number;
  category?: string;
  effectKey: string;
}

/** The bag's two duration sources, as `RegistryEffectsDisplay` reads them off `effects`. */
export interface BagDurations {
  durations?: Record<string, number>;
  buffDuration?: number;
}

/**
 * The duration to annotate one row with, or `undefined` for none.
 *
 * Execution stats (End Cost, Rech Time, Accuracy, Pwr Range, Activation, Radius, Arc, Max
 * Targets) are instantaneous, so the power-level fallback must not reach them — stamping it
 * produced a bogus "(2s)" on every such row. An explicit per-effect entry still reaches them,
 * because the bag only records one where the power states one.
 */
export function effectRowDuration(
  row: RowDurationSource,
  bag: BagDurations,
): number | undefined {
  if (row.duration != null && row.duration > 0) return row.duration;
  const baseKey = row.effectKey.includes('_') ? row.effectKey.split('_')[0] : row.effectKey;
  const explicit = bag.durations?.[row.effectKey] ?? bag.durations?.[baseKey];
  if (explicit != null) return explicit;
  if (row.category === 'execution') return undefined;
  return bag.buffDuration;
}

/**
 * The power-level duration row, or `undefined` when the power has no single honest answer.
 *
 * Agreement is required at every step: a power with genuinely mixed durations gets no
 * power-level row and keeps showing them inline, because one number here would be a claim the
 * power does not make.
 */
export function powerLevelDuration(
  rows: RowDurationSource[],
  bag: BagDurations,
): number | undefined {
  const timed = rows.filter((r) => r.category !== 'execution');
  const fromRows = agreed(timed.map((r) => r.duration));
  if (fromRows != null) return fromRows;
  if (bag.buffDuration != null && bag.buffDuration > 0) return bag.buffDuration;
  return agreed(rows.map((r) => effectRowDuration(r, bag)));
}

function agreed(values: (number | undefined)[]): number | undefined {
  const durs = values.filter((d): d is number => d != null && d > 0);
  if (durs.length === 0) return undefined;
  return durs.every((d) => Math.abs(d - durs[0]) < 0.001) ? durs[0] : undefined;
}
