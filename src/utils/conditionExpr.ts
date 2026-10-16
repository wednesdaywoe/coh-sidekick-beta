/**
 * A minimal evaluator for the CoH RPN condition language, scoped to exactly the vocabulary
 * that appears in `quickSnipe.condition` / `formVariants[].condition` across all three forks
 * today (`condition` is the only place either string exists on `Power` — see
 * docs/gaps/engine-beta-parity.md). NOT a general port of canonical's `coh_math::expr`
 * (~1200 lines, 47 readers, probabilistic Die/Range values) — this only needs the
 * source-relative subset those two fields actually use.
 *
 * The grammar is whitespace-delimited postfix (reverse Polish): each token either pushes a
 * value or pops its operands and pushes a result, and the result is whatever sits on top of
 * the stack once every token has run (`cur.kToHit source> .97 >=` pushes `cur.kToHit`, reads
 * it via `source>`, pushes `.97`, then `>=` pops both and pushes the comparison).
 *
 * A token this can't resolve — a target-relative reader (`target.isFriend?`, `enttype
 * target>`, `distance`), or a source reader whose attribute a static build has no value for
 * (`kMeter source>`) — pushes UNKNOWN rather than aborting, and unknown propagates through
 * the operators the way canonical's `Value::Unknown` does (data-gaps-121). `evaluateConditionTri`
 * reports a program that ends unknown as `undefined`, canonical's `EvalError::Indeterminate`.
 *
 * Propagation is Kleene, not merely sticky, and the difference is load-bearing: `&&`/`||`
 * absorb an unknown when the definite sibling settles it, so `kBoostRange Source.Mode?
 * distance 7 > &&` is definitely FALSE with the mode off even though no planner can value
 * `distance`. Everything else carries the unknown outward — a comparison or an `eq` with an
 * unknown operand is unknown, and `!unknown` is unknown, since negation has no absorbing
 * operand. A symbol where a number or a boolean belongs stays a hard fault, as it is there:
 * Kleene absorbs unknowns, never grammar faults. Both faults and unknowns surface here as the
 * one `undefined`, which is what the engine's callers do with `Err(_)` either way.
 *
 * Whether "can't tell" may be folded into "no" is the CALLER's question, not this module's,
 * and the two callers answer it differently (U8):
 *
 * - Asking one condition, `fast_form_selected`-style, the fold is sound: the engine is
 *   `matches!(eval_bool(…), Ok(true))`, so a definite no and an unanswerable gate both leave
 *   the base record standing. `evaluateCondition` is that fold, and `quickSnipe` uses it.
 * - Walking an ORDERED list, it is not. `with_form_variant` matches three ways — `Ok(true)`
 *   selects and stops, `Ok(false)` moves on, `Err(_)` returns None and abandons the walk. Fold
 *   the third into the second and the walk keeps going, so a constant-true fallback parked
 *   behind an unanswerable branch gets selected. That is Assassin's Strike: `kMeter` is
 *   rotation state no static build can answer, and a constant-true `1` sits right behind it.
 *   `applyFormVariant` therefore reads the tri-valued form and stops where the engine stops.
 *
 * This module was two-valued until 2026-08-21, and the fold looked correct because it was
 * checked against `fast_form_selected` — the caller for which it IS correct. Kleene came in
 * with it: while every unknown collapsed to `false` the absorbing cases reached the same
 * answer by luck, and only a caller that ACTS on unknown can tell the two apart.
 */

export interface ConditionContext {
  /** Every mode live right now, lower-cased — the build's own `activeModes` (Kheldian forms,
   *  Momentum, Bio Armor adaptations, …) PLUS the synthetic `kengaged` / `koutofcombat` the
   *  engine itself binds from the combat-mode toggle (`gather::live_modes`,
   *  `ENGAGED_MODES`/`OUT_OF_COMBAT_MODES`). Read by `Source.Mode?`. */
  liveModes: ReadonlySet<string>;
  /** Does the build have a power matching this dotted export path (`Pool.Teleportation.
   *  Team_Teleport`) selected in primary/secondary/pools/epic/inherents? Read by
   *  `source.ownPower?`. A temp/granted/redirect-only power (`Temporary_Powers.*`,
   *  `Redirects.*`) is never in a build's own picks, so it correctly reads unowned with no
   *  special-casing needed. */
  ownsPower: (path: string) => boolean;
  /** The same lookup as a count — 0 when not owned. Read by `source.ownPowerNum?`. Real
   *  in-combat stack counters (Blood Frenzy, Tidal Power) are rotation state a static build
   *  can't answer either, and for the same reason never appear in the build's own power
   *  lists, so this also naturally reads 0 for them. */
  ownedPowerCount: (path: string) => number;
  /** The caster's current (buffed, UNCLAMPED) ToHit fraction — archetype `toHitBase` + the
   *  build's global ToHit bonus/100, exactly `crates/coh_math/src/projection.rs`'s
   *  `gate_context` (`caps.to_hit_base + g.to_hit / 100.0`). Read by `cur.kToHit source>`. */
  currentToHit: number;
}

/** A grammar fault: a symbol where a number or boolean belongs, a stack that won't reduce.
 *  Distinct from UNKNOWN, which is a well-formed program whose value a build can't supply. */
class Malformed extends Error {}

/** Canonical's `Value::Unknown` — a value the context can't supply, riding the stack so the
 *  operators can absorb or propagate it rather than aborting at the reader. */
const UNKNOWN: unique symbol = Symbol('unknown');

type Val = number | string | typeof UNKNOWN;

const NUMBER_TOKEN = /^-?\.?\d/;

/** Three-valued truth: `undefined` for unknown. A symbol has no truth value — that's a fault. */
function kleeneTruth(v: Val): boolean | undefined {
  if (v === UNKNOWN) return undefined;
  if (typeof v !== 'number') throw new Malformed(`symbol ${v} used as a boolean`);
  return v !== 0;
}

function asNumber(v: Val): number {
  if (typeof v !== 'number') throw new Malformed(`${String(v)} used as a number`);
  return v;
}

function asSymbol(v: Val): string {
  if (typeof v !== 'string') throw new Malformed(`${String(v)} used as a symbol`);
  return v;
}

function pop(stack: Val[]): Val {
  if (stack.length === 0) throw new Malformed('stack underflow');
  return stack.pop() as Val;
}

function boolNum(b: boolean): number {
  return b ? 1 : 0;
}

/** Arity for the readers this corpus actually holds, transcribed from canonical's
 *  `reader_arity` for exactly those tokens. A `>`/`?` token absent here is NOT assumed to be a
 *  nullary reader: it falls through as a symbol and faults at the first operator that pops it,
 *  so a newly-shipped reader breaks loudly instead of silently eating an operand. Keyed
 *  case-folded because the export spells the same reader three ways (`Source.Mode?`,
 *  `source.mode?`). */
const READER_ARITY: ReadonlyMap<string, number> = new Map([
  ['source>', 1],
  ['target>', 1],
  ['source.ownpower?', 1],
  ['source.ownpowernum?', 1],
  ['source.mode?', 1],
  ['target.isfriend?', 0],
  ['distance', 0],
]);

/** Read a reader against `ctx`, or UNKNOWN where a static build has no answer. The
 *  target-relative readers are unknown by construction — a totals calculation has no one
 *  target — which is canonical's `SourceContext` verdict for the same tokens. */
function readReader(reader: string, operands: Val[], ctx: ConditionContext): Val {
  switch (reader) {
    case 'source.mode?':
      return boolNum(ctx.liveModes.has(asSymbol(operands[0]).toLowerCase()));
    case 'source.ownpower?':
      return boolNum(ctx.ownsPower(asSymbol(operands[0])));
    case 'source.ownpowernum?':
      return ctx.ownedPowerCount(asSymbol(operands[0]));
    case 'source>': {
      // The one source attribute a build can value. `kMeter` and friends are live rotation
      // state, unknown here exactly as they are in the engine's gate context.
      const attribute = asSymbol(operands[0]);
      return attribute.toLowerCase() === 'cur.ktohit' ? ctx.currentToHit : UNKNOWN;
    }
    default:
      // `target>`, `target.isFriend?`, `distance` — well-formed, unanswerable.
      return UNKNOWN;
  }
}

/** Evaluate one postfix condition against `ctx`, as the token list the wire holds (data-gaps-123:
 *  tokens arrive pre-split and are never re-split, so multi-word tokens survive intact).
 *  `undefined` is "can't tell" — the program is unknown, or it is malformed. Callers that walk
 *  an ordered list must handle it separately from `false`; see the module doc. */
export function evaluateConditionTri(
  condition: readonly string[],
  ctx: ConditionContext,
): boolean | undefined {
  const tokens = condition.filter(Boolean);
  const stack: Val[] = [];
  try {
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (NUMBER_TOKEN.test(token) && !Number.isNaN(Number(token))) {
        stack.push(Number(token));
        continue;
      }
      switch (lower) {
        case '&&':
        case '||': {
          // Kleene. The absorbing operand settles the result whatever the sibling is, so this
          // is checked before either operand's truth is demanded — which is also what keeps a
          // symbol sibling from raising a fault the pre-Kleene machine never reached.
          const b = pop(stack);
          const a = pop(stack);
          const absorbing = lower === '||';
          if (a === UNKNOWN || b === UNKNOWN) {
            const known = a === UNKNOWN ? b : a;
            const settles = known !== UNKNOWN && typeof known === 'number' && (known !== 0) === absorbing;
            stack.push(settles ? boolNum(absorbing) : UNKNOWN);
            break;
          }
          const [ta, tb] = [kleeneTruth(a), kleeneTruth(b)];
          stack.push(boolNum(lower === '&&' ? Boolean(ta && tb) : Boolean(ta || tb)));
          break;
        }
        // Negation has no absorbing operand, so `!unknown` is unknown.
        case '!': {
          const truth = kleeneTruth(pop(stack));
          stack.push(truth === undefined ? UNKNOWN : boolNum(!truth));
          break;
        }
        // `==` is numeric-only (canonical's `Op::NumberEqual`) — a symbol operand faults
        // rather than coercing. `eq` (below) is the separate symbol-or-number comparator.
        // Both, and the ordered comparisons, carry an unknown operand outward BEFORE the
        // symbol fault, matching canonical's arm order.
        case '==':
        case '>=':
        case '>':
        case '<': {
          const b = pop(stack);
          const a = pop(stack);
          if (a === UNKNOWN || b === UNKNOWN) {
            stack.push(UNKNOWN);
            break;
          }
          const [x, y] = [asNumber(a), asNumber(b)];
          const result =
            lower === '==' ? x === y : lower === '>=' ? x >= y : lower === '>' ? x > y : x < y;
          stack.push(boolNum(result));
          break;
        }
        // Symbol-or-number equality, case-insensitive for symbols — the export carries
        // casing variants of the same identity (`Class_Scrapper` / `class_scrapper`). A
        // number against a symbol is a definite no, not a fault.
        case 'eq': {
          const b = pop(stack);
          const a = pop(stack);
          if (a === UNKNOWN || b === UNKNOWN) {
            stack.push(UNKNOWN);
            break;
          }
          const result =
            typeof a === 'number' && typeof b === 'number'
              ? a === b
              : typeof a === 'string' && typeof b === 'string'
                ? a.toLowerCase() === b.toLowerCase()
                : false;
          stack.push(boolNum(result));
          break;
        }
        default: {
          const arity = READER_ARITY.get(lower);
          if (arity === undefined) {
            // Not a reader this grammar knows: a power path, a mode id, a `@`-constant. All
            // of them are operands. `@CustomFX Crabpack eq` is a symbol comparison that reads
            // definitely false, not something unresolvable — treating it as a fault was what
            // made the Arachnos cloak variants diverge from the engine.
            stack.push(token);
            break;
          }
          const operands: Val[] = [];
          for (let i = 0; i < arity; i += 1) operands.unshift(pop(stack));
          stack.push(readReader(lower, operands, ctx));
        }
      }
    }
    if (stack.length === 0) throw new Malformed('empty expression');
    return kleeneTruth(stack[stack.length - 1]);
  } catch (err) {
    if (err instanceof Malformed) return undefined;
    throw err;
  }
}

/** `evaluateConditionTri` with "can't tell" folded into "no". Correct only where a single
 *  condition is being asked and an unanswerable gate should leave the base record standing —
 *  the `fast_form_selected` shape. A caller walking an ordered list wants the tri-valued form. */
export function evaluateCondition(condition: readonly string[], ctx: ConditionContext): boolean {
  return evaluateConditionTri(condition, ctx) === true;
}
