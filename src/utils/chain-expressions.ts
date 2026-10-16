/**
 * Humanizers for the two chain-power RPN expressions the bin parser recovers
 * from powers.bin (fields 43b / 38) and the converter carries onto `Power`:
 *
 *   - `chainTargetExpression` — ChainTarget: which target a chain jumps to next.
 *   - `maxTargetsExpression`  — MaxTargetsExpr: a conditional target cap that
 *     overrides the static `stats.maxTargets` when its condition holds.
 *
 * The raw token lists (e.g. `101 kHitPoints% target> - … prevdistance / +`) are
 * meaningless to players, so the Info panel shows these short descriptions and
 * keeps the raw expression on hover. Verified against the HC `.powers` oracle —
 * see streams/HOMECOMING_PARSER.md ("Chain / max-targets expression fields").
 *
 * Both take the token list and join it only to ASK a question of it: every probe
 * below is a substring test, and a token boundary can neither create nor destroy
 * a substring. Nothing here splits the joined text back apart, which is the step
 * data-gaps-123 was about.
 */

/** The expression as one line of text, for probing and for the hover title. */
export function expressionText(expr: readonly string[] | undefined): string {
  return (expr ?? []).join(' ');
}

/** Describe the next-jump rule of a ChainTarget expression. The Electrical
 *  Affinity circuits weight selection by a stat deficit (`kHitPoints%` /
 *  `kEndurance%` / `kAbsorb%`) and break ties by proximity (`prevdistance`);
 *  pure-proximity chains carry only `prevdistance`. Check the stat clauses
 *  first — the stat-priority expressions ALSO contain `prevdistance`. */
export function describeChainTarget(expr: readonly string[]): string {
  const text = expressionText(expr);
  if (/kHitPoints%/.test(text)) return 'Most-injured ally (lowest HP)';
  if (/kEndurance%/.test(text)) return 'Lowest-endurance ally';
  if (/kAbsorb%/.test(text)) return 'Ally with least absorb';
  if (/\bprevdistance\b/.test(text)) return 'Nearest target';
  return 'Weighted selection';
}

/** Describe a conditional MaxTargetsExpr cap. The circuits grow their cap while
 *  the Static buff is stacked (`… source.ownPowerNum? …`); Gauntlet attacks
 *  raise theirs via `GauntletTargetCap`. Everything else is surfaced generically
 *  (the raw expression rides along as the row's hover title). */
export function describeTargetCap(expr: readonly string[]): string {
  const text = expressionText(expr);
  if (/ownPowerNum/.test(text) && /Shock_Therapy/.test(text)) return 'Grows with Static stacks';
  if (/GauntletTargetCap/.test(text)) return 'Raised by Gauntlet';
  return 'Conditional';
}
