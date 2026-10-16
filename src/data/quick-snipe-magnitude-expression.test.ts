import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { Power } from '@/types';
import { loadDataset } from '@/data/dataset';
import { calculatePowerDamage } from '@/utils/calculations/damage';
import { applyQuickSnipe } from '@/utils/quick-snipe';
import { ProtonVolley } from './datasets/homecoming/generated/powersets/blaster/primary/radiation-blast/proton-volley';
import { SniperBlast } from './datasets/homecoming/generated/powersets/blaster/primary/energy-blast/sniper-blast';
import { Zapp } from './datasets/homecoming/generated/powersets/blaster/primary/electrical-blast/zapp';
import { BlazingBolt } from './datasets/homecoming/generated/powersets/blaster/primary/fire-blast/blazing-bolt';
import { ProtonVolley as DomProtonVolley } from './datasets/homecoming/generated/powersets/dominator/secondary/radioactive-assault/proton-volley';
import { SniperBlast as DomSniperBlast } from './datasets/homecoming/generated/powersets/dominator/secondary/energy-assault/sniper-blast';

/**
 * `extractDamage` reads `magnitude_expression` (convert-powerset.cjs).
 *
 * A template's `magnitude_expression` is an RPN program the game runs to compute that
 * AttribMod's magnitude; `scale` alone is not the answer when one is present. HC's fast
 * ("Quick") snipe redirects store the whole SHOT in `scale` and put the per-tick divisor
 * or the damage-type split in the program — so reading `scale` verbatim over-reported
 * Proton Volley's quick form by exactly 4× and mis-split Sniper Blast's.
 *
 * The converter folds ONLY the statically-constant factor and treats the ToHit ramp as an
 * OPAQUE FACTOR OF 1. That is deliberate: the three ramp families store their scale at
 * DIFFERENT reference points (blaster/corruptor/defender `0.210526316 * 1 +` and epic
 * `0.314285714 * 1 +` are 1.0 at neutral ToHit; dominator `0.25 * .75 +` is 0.75 there),
 * so evaluating the ramp numerically would silently move powers that are correct today.
 * Whether snipe damage should respond to +ToHit at all is a separate product question.
 *
 * The independent confirmation that dividing is right: HC encodes the SAME modeling two
 * ways. Dominator's Proton Volley Quick stores `scale 0.89` for its 4-tick DoT with a
 * bare-`*` program (already divided in the data — 3.56 / 4), while Blaster's stores
 * `scale 2.28` with `4 /` in the program. Folding makes the blaster path agree with the
 * dominator path's convention exactly (GAME-DATA-PRINCIPLES §5, sibling-path oracle).
 */

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  evalMagnitudeExpression: evalMagnitudeExpressionRaw, stdResultCoefficient: stdResultCoefficientRaw,
  extractDamage, parseAbsorbMaxHPFraction,
  extractQuickSnipeData, DAMAGE_TYPES,
} = require('../../scripts/convert-powerset.cjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { tokensFromText } = require('../../scripts/_gate-tokens.cjs');

// The wire carries expressions as token arrays (data-gaps-123); the literals authored in
// this file are text, so tokenize them here — never inside the converter.
const stdResultCoefficient = (expr: string | readonly string[], ctx: object) =>
  stdResultCoefficientRaw(Array.isArray(expr) ? expr : tokensFromText(expr), ctx);
const evalMagnitudeExpression = (expr: string | readonly string[], ctx: object) =>
  evalMagnitudeExpressionRaw(Array.isArray(expr) ? expr : tokensFromText(expr), ctx);

const EXPORT_ROOT = fileURLToPath(new URL('../../exported_powers', import.meta.url));

// Homecoming lives flat at the export root; every other dataset sits in a named subdir.
// The sweep is Homecoming-only, so those subdirs are skipped — derived from ALL_DATASETS
// rather than listed, because a hand-written skip list goes quiet on the next fork added.
// Brainstorm proved it: unlisted, it swept as if it were Homecoming and doubled every count
// under a pin that reads as coverage.
const FORK_DIRS: ReadonlySet<string> = new Set(
  (require('../../scripts/_dataset-paths.cjs').ALL_DATASETS as string[]).filter(
    (d) => d !== 'homecoming',
  ),
);

/** The blaster/corruptor/defender ToHit ramp prefix — every snipe program starts here. */
const RAMP_BCD = 'cur.kToHit source> 0.75 - 0.22 / -1.0 1.0 minmax 0.210526316 * 1 +';
/** The dominator ramp: a DIFFERENT reference point (0.75 at neutral ToHit, not 1.0). */
const RAMP_DOM = 'cur.kToHit source> 0.75 - 0.22 / -1.0 1.0 minmax 0.25 * .75 +';
/** The epic-pool ramp. */
const RAMP_EPIC = 'cur.kToHit source> 0.75 - 0.22 / -1.0 1.0 minmax 0.314285714 * 1 +';

beforeAll(async () => {
  await loadDataset('homecoming');
});

// ---------------------------------------------------------------------------
// 1. The evaluator itself
// ---------------------------------------------------------------------------

describe('magnitude_expression evaluator — folds the constant, drops the ramp', () => {
  it('a ramp-only program is a factor of 1 in ALL THREE ramp families', () => {
    // This is the load-bearing control. If the ramp were evaluated numerically the
    // dominator family would come out at 0.75 and every dominator snipe would move.
    expect(stdResultCoefficient(`${RAMP_BCD} @StdResult *`, {})).toBe(1);
    expect(stdResultCoefficient(`${RAMP_DOM} @StdResult *`, {})).toBe(1);
    expect(stdResultCoefficient(`${RAMP_EPIC} @StdResult *`, {})).toBe(1);
    expect(stdResultCoefficient('@StdResult', {})).toBe(1);
  });

  it('folds the per-tick divisor and the type split', () => {
    expect(stdResultCoefficient(`${RAMP_BCD} @StdResult * 4 /`, {})).toBe(0.25);
    expect(stdResultCoefficient(`${RAMP_BCD} @StdResult * 0.3 *`, {})).toBeCloseTo(0.3, 12);
    expect(stdResultCoefficient(`${RAMP_BCD} @StdResult * 0.7 *`, {})).toBeCloseTo(0.7, 12);
    expect(stdResultCoefficient(`${RAMP_BCD} @StdResult * 3 / 0.33 *`, {})).toBeCloseTo(0.11, 12);
  });

  it('evaluates the PREFIX, not just a tail — penetrating_ray\'s own scalars', () => {
    // `activatetime power.base> 0.70 * rechargetime power.base> 0.04 * + 0.40 +` is the
    // whole magnitude. penetrating_ray_normal.json (activation 3.4, recharge 12.0) gives
    // 0.7×3.4 + 0.04×12 + 0.40 = 3.26 — and that same file carries a NON-Expression PvP
    // sibling with a literal scale of 3.26. The Quick file's 1.67 gives 2.049, and ITS
    // sibling is a literal 2.049. Two exact, independent confirmations.
    const PROG = 'activatetime power.base> 0.70 * rechargetime power.base> 0.04 * + 0.40 + @StdResult *';
    expect(stdResultCoefficient(PROG, { activationTime: 3.4, rechargeTime: 12.0 })).toBeCloseTo(3.26, 12);
    expect(stdResultCoefficient(PROG, { activationTime: 1.67, rechargeTime: 12.0 })).toBeCloseTo(2.049, 12);
    // A tail-only rule would emit 1/3 here and miss the 3.26 entirely.
    expect(stdResultCoefficient(`${PROG} 3 /`, { activationTime: 3.4, rechargeTime: 12.0 }))
      .toBeCloseTo(3.26 / 3, 12);
  });

  it('BAILS on anything it cannot evaluate whole — the default outcome', () => {
    const bails = [
      // areafactor is unresolved. Folding the `10 /` before hitting it would be a 10× UNDER-read.
      '.8 RechargeTime power.base> 1 25 minmax * 1.8 + 2 * @StdResult * 10 / areafactor power.base> / .15 *',
      'activatetime power.base> 0 3 minmax areafactor power.base> / @StdResult *',
      '.11 activateperiod power.base> 0 2 minmax * @StdResult * areafactor power.base> /',
      // Runtime reads with no static value.
      'distance 25 - 0 40 minmax 40 / 1 + @StdResult *',
      '1 1 @ToHit - @ToHitRoll * - @StdResult *',
      '@StdResult Pool.Fighting.Kick source.ownPowerNum? .15 * Pool.Fighting.Cross_Punch source.ownPowerNum? .15 * + 1 + *',
      'now KineticAssaultSecondaries source.TokenTime> - 25 / 1 + @StdResult *',
      '30 source.TeamSize> 0.03 * 0.07 + rand >= @StdResult *',
      // Resolves, but not to `k × @StdResult`.
      'Max.kHitPoints target> 0.9 * Cur.kHitPoints target> -',
    ];
    for (const e of bails) expect(stdResultCoefficient(e, { activationTime: 2, rechargeTime: 20 })).toBeNull();
  });

  it('a ZERO activation/recharge time is ABSENCE, not the number zero', () => {
    // Every damage-proc / granted-power shell declares activation_time 0.0, recharge_time
    // 0.0 — their `power.base>` reads bind at runtime to the HOST power that triggered
    // them, which the converter cannot identify. Reading those zeros as literals turns the
    // standard proc formula into a constant 0.40 and `activatetime power.base> @StdResult *`
    // into a flat ZERO (21 templates rescaled to 40%, one heal deleted outright).
    const PROC = 'activatetime power.base> 0.70 * rechargetime power.base> 0 20 minmax 0.04 * + 0.40 + @StdResult *';
    expect(stdResultCoefficient(PROC, { activationTime: 0, rechargeTime: 0 })).toBeNull();
    expect(stdResultCoefficient('activatetime power.base> @StdResult *', { activationTime: 0 })).toBeNull();
    // …but a power that DOES declare a cast resolves normally.
    expect(stdResultCoefficient(PROC, { activationTime: 1.5, rechargeTime: 10 })).toBeCloseTo(1.85, 12);
  });

  it('minmax pops hi-first: `value lo hi minmax` clamps value to [lo, hi]', () => {
    // Read the other way round every ramp would collapse to a constant.
    expect(evalMagnitudeExpression('5 0 3 minmax @StdResult *', {})).toMatchObject({ k: 3, syms: ['std'] });
    expect(evalMagnitudeExpression('-5 0 3 minmax @StdResult *', {})).toMatchObject({ k: 0, syms: ['std'] });
    expect(evalMagnitudeExpression('2 0 3 minmax @StdResult *', {})).toMatchObject({ k: 2, syms: ['std'] });
  });

  it('rejects a program that resolves to the wrong SYMBOL', () => {
    // Shape-checked, not just "did it evaluate" — a MaxHP-fraction absorb program must
    // not be mistaken for a damage coefficient.
    expect(evalMagnitudeExpression('Max.kHitPoints source> 0.25 * @Strength *', {}))
      .toMatchObject({ k: 0.25, syms: ['maxhp.source', 'strength'] });
    expect(stdResultCoefficient('Max.kHitPoints source> 0.25 * @Strength *', {})).toBeNull();
  });

  it('the absorb parser rides the same evaluator and keeps source ≠ target', () => {
    // `parseAbsorbMaxHPFraction` used to carry its own `source>`-anchored regexes; it now
    // asserts on the evaluator's symbol multiset instead, so this file has ONE RPN reader.
    // The distinction it must preserve: `Max.kHitPoints target>` is a fraction of the
    // RECIPIENT's max HP (Particle Shielding, Spirit Ward, Guardian's Gift — 100+ ally
    // shields), which the caster-side `maxHPFraction` field cannot express. Collapsing
    // source and target would silently recover all of them at the caster's HP.
    const P = parseAbsorbMaxHPFraction;
    expect(P('Max.kHitPoints source> 0.25 * @Strength *', 1.0, 'Ranged_Ones', false))
      .toEqual({ fraction: 0.25, appliesStrength: true });
    expect(P('Max.kHitPoints source> 0.25 * @Strength *', 1.0, 'Ranged_Ones', true))
      .toEqual({ fraction: 0.25, appliesStrength: false }); // IgnoreStrength blocks fStr
    expect(P('Max.kHitPoints source> 0.1 *', 1.0, 'Melee_Ones', false))
      .toEqual({ fraction: 0.1, appliesStrength: false });
    // `@StdResult` shape: a bare fraction only on a `_ones` table.
    expect(P('Max.kHitPoints source> @StdResult *', 0.3, 'Melee_Ones', false))
      .toEqual({ fraction: 0.3, appliesStrength: true });
    expect(P('Max.kHitPoints source> @StdResult *', 0.3, 'Melee_HealSelf', false)).toBeNull();
    // The controls.
    expect(P('Max.kHitPoints target> 0.075 * @Strength *', 1.0, 'Melee_Ones', false)).toBeNull();
    expect(P('Max.kHitPoints target> 0.05 *', 1.0, 'Melee_Ones', false)).toBeNull();
    // Master Brawler reads live HP + endurance — unevaluable, left duration-only.
    expect(P('100 kHitPoints% source> - kEndurance% source> + 200 / @StdResult *',
      4.0, 'Melee_HealSelf', false)).toBeNull();
  });

  it('extractDamage multiplies scale by the folded factor and nothing else', () => {
    const t = (expr: string) => ({
      attribs: ['Energy_Dmg'], aspect: 'Absolute', table: 'Ranged_Damage',
      scale: 2.28, duration: '1.6 seconds', application_period: 0.5,
      magnitude_expression: tokensFromText(expr),
    });
    expect(extractDamage([t(`${RAMP_BCD} @StdResult * 4 /`)]))
      .toEqual({ type: 'Energy', scale: 0.57, table: 'Ranged_Damage', duration: 1.6, tickRate: 0.5 });
    // Ramp-only and un-evaluable programs both leave scale exactly as the binary stored it.
    expect(extractDamage([t(`${RAMP_BCD} @StdResult *`)])).toMatchObject({ scale: 2.28 });
    expect(extractDamage([t('distance 25 - 0 40 minmax 40 / 1 + @StdResult *')])).toMatchObject({ scale: 2.28 });
    expect(extractDamage([t('')])).toMatchObject({ scale: 2.28 });
  });
});

// ---------------------------------------------------------------------------
// 2. The generated data — folded values and controls
// ---------------------------------------------------------------------------

type DamageEntry = { type: string; scale: number; table?: string; duration?: number; tickRate?: number };
const quickDamage = (p: Power): DamageEntry[] => {
  expect(p.quickSnipe, 'power has no quickSnipe block').toBeTruthy();
  const d = p.quickSnipe!.damage;
  return (Array.isArray(d) ? d : [d]) as unknown as DamageEntry[];
};

describe('quick-snipe damage — the folded values', () => {
  it('Proton Volley Quick: 2.28 → 0.57 per tick (× 4 ticks = 2.28 shot total)', () => {
    const d = quickDamage(ProtonVolley);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: 'Energy', scale: 0.57, duration: 1.6, tickRate: 0.5 });
    // The divisor in the program IS the tick count the display multiplies back.
    expect(Math.floor(d[0].duration! / d[0].tickRate! + 1e-4) + 1).toBe(4);
    expect(d[0].scale * 4).toBeCloseTo(2.28, 10);
  });

  it('Sniper Blast Quick: 2.28 splits 0.684 Smashing + 1.596 Energy (sum 2.28)', () => {
    const d = quickDamage(SniperBlast);
    expect(d).toHaveLength(2);
    expect(d.find((e) => e.type === 'Smashing')!.scale).toBeCloseTo(0.684, 10);
    expect(d.find((e) => e.type === 'Energy')!.scale).toBeCloseTo(1.596, 10);
    expect(d.reduce((s, e) => s + e.scale, 0)).toBeCloseTo(2.28, 10);
  });

  it('the folded Proton Volley now matches the flat-hit snipes shot-for-shot at L50', () => {
    const ctx = { level: 50, archetypeId: 'blaster' as const };
    const pv = calculatePowerDamage(applyQuickSnipe(ProtonVolley, true), ctx)!;
    const zapp = calculatePowerDamage(applyQuickSnipe(Zapp, true), ctx)!;
    // Proton Volley Quick is a pure DoT; Zapp Quick is a single hit. Both are the same
    // 2.28 shot, so their SHOT TOTALS must agree — they did NOT before the fold, when
    // Proton Volley read 2.28 per tick and the display multiplied it back by 4.
    const pvShot = pv.dotDamage!.base * pv.dotDamage!.effectiveTicks;
    expect(pv.dotDamage!.ticks).toBe(4);
    expect(pvShot).toBeCloseTo(zapp.base, 4);
    // Absolute pins, so an AT-table change is visible here too.
    expect(pvShot).toBeCloseTo(142.6438655, 5);
    expect(pvShot * 4).toBeCloseTo(570.575462, 5); // what it used to report
  });
});

/**
 * Re-derive quickSnipe damage from the COMMITTED export through the converter's own
 * `extractQuickSnipeData`, rather than only reading the committed generated file.
 *
 * The pinned-artifact assertions above go red on a bad *regen*; these go red on a bad
 * *converter* even without one, which is the failure the regen-diff CI cannot see until
 * someone re-runs it. Both directions matter (GAME-DATA-PRINCIPLES §14).
 */
describe('quick-snipe damage — re-derived from the export by the converter', () => {
  const rawPower = (rel: string) =>
    JSON.parse(fs.readFileSync(path.join(EXPORT_ROOT, rel), 'utf8'));
  const derive = (rel: string): DamageEntry[] => {
    const q = extractQuickSnipeData(rawPower(rel));
    expect(q, `no quickSnipe derived from ${rel}`).toBeTruthy();
    return q.damage as DamageEntry[];
  };

  it('Proton Volley (blaster / corruptor / defender) derives 0.57, not 2.28', () => {
    for (const rel of [
      'blaster_ranged/radiation_blast/proton_volley.json',
      'corruptor_ranged/radiation_blast/proton_volley.json',
      'defender_ranged/radiation_blast/proton_volley.json',
    ]) {
      expect(derive(rel), rel).toEqual([
        { type: 'Energy', scale: 0.57, table: 'Ranged_Damage', duration: 1.6, tickRate: 0.5 },
      ]);
    }
  });

  it('Sniper Blast (blaster / corruptor / defender) derives the 0.684 / 1.596 split', () => {
    for (const rel of [
      'blaster_ranged/energy_blast/sniper_blast.json',
      'corruptor_ranged/energy_blast/sniper_blast.json',
      'defender_ranged/energy_blast/sniper_blast.json',
    ]) {
      const d = derive(rel);
      expect(d.find((e) => e.type === 'Smashing')!.scale, rel).toBeCloseTo(0.684, 10);
      expect(d.find((e) => e.type === 'Energy')!.scale, rel).toBeCloseTo(1.596, 10);
    }
  });

  it('the dominator + bare-tail snipes re-derive UNCHANGED from their raw scales', () => {
    // Ramp-only programs ⇒ k = 1 ⇒ the fold is a no-op, byte for byte.
    expect(derive('dominator_assault/radioactive_assault/proton_volley.json')).toEqual([
      { type: 'Energy', scale: 0.89, table: 'Ranged_Damage', duration: 1.6, tickRate: 0.5 },
    ]);
    expect(derive('dominator_assault/energy_assault/sniper_blast.json')).toEqual([
      { type: 'Smashing', scale: 1.424, table: 'Ranged_Damage' },
      { type: 'Energy', scale: 2.136, table: 'Ranged_Damage' },
    ]);
    expect(derive('blaster_ranged/electrical_blast/zapp.json')).toEqual([
      { type: 'Energy', scale: 2.28, table: 'Ranged_Damage' },
    ]);
    expect(derive('blaster_ranged/dark_blast/moonbeam.json')).toEqual([
      { type: 'Negative', scale: 2.28, table: 'Ranged_Damage' },
    ]);
  });
});

describe('quick-snipe damage — the controls (MUST NOT move)', () => {
  it('all 8 dominator quick snipes keep their raw export scales', () => {
    // Dominator programs are ramp-only (`0.25 * .75 +` … `@StdResult *`), so k === 1.
    // HC already divided these in the data — 0.89 IS 3.56/4.
    expect(quickDamage(DomProtonVolley)).toEqual([
      { type: 'Energy', scale: 0.89, table: 'Ranged_Damage', duration: 1.6, tickRate: 0.5 },
    ]);
    expect(quickDamage(DomSniperBlast)).toEqual([
      { type: 'Smashing', scale: 1.424, table: 'Ranged_Damage' },
      { type: 'Energy', scale: 2.136, table: 'Ranged_Damage' },
    ]);
  });

  it('the bare-tail blaster snipes keep 2.28', () => {
    expect(quickDamage(Zapp)).toEqual([{ type: 'Energy', scale: 2.28, table: 'Ranged_Damage' }]);
  });

  it("Blazing Bolt's genuine burn DoT survives untouched (no expression on it)", () => {
    // 0.225 / 3.1s / 1.0s, chance-gated + cancel-on-miss. It has NO magnitude_expression,
    // so the fold must not see it at all.
    const burn = quickDamage(BlazingBolt).find((e) => e.duration);
    expect(burn).toMatchObject({ type: 'Fire', scale: 0.225, duration: 3.1, tickRate: 1 });
    const baseBurn = (BlazingBolt.damage as DamageEntry[]).find((e) => e.duration);
    expect(baseBurn).toMatchObject({ type: 'Fire', scale: 0.225, duration: 3.1, tickRate: 1 });
  });
});

// ---------------------------------------------------------------------------
// 3. Corpus gate — the fold's blast radius, with counts
// ---------------------------------------------------------------------------

/**
 * Sweep every Homecoming export template that `extractDamage` would look at and
 * partition it by what the evaluator does. The point is the SHAPE of the partition:
 * the only value-changing folds in the whole corpus are the four snipe programs.
 * A new fold appearing anywhere else fails here with its file named.
 *
 * Counts are printed, not merely asserted — a blank where a number belongs is an
 * INVALID run, not a green one (GAME-DATA-PRINCIPLES §14).
 */
describe('corpus sweep — nothing outside the snipe programs folds', () => {
  type Row = { file: string; k: number; from: number; to: number };
  const changed: Row[] = [];
  const byCoefficient = new Map<string, number>();
  let gated = 0;
  let withExpression = 0;
  let noOpFolds = 0;

  beforeAll(() => {
    const walk = (dir: string, top: string | null): string[] => {
      const out: string[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (top === null && (FORK_DIRS.has(e.name) || e.name === 'tables')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p, top ?? e.name));
        else if (e.name.endsWith('.json') && e.name !== 'index.json') out.push(p);
      }
      return out;
    };

    type Tmpl = {
      attribs?: string[]; aspect?: string; table?: string; scale?: number;
      magnitude_expression?: string[];
    };
    type Group = { templates?: Tmpl[]; child_effects?: Group[]; activation_effects?: Group[] };
    const allTemplates = (groups: Group[] | undefined): Tmpl[] => {
      const out: Tmpl[] = [];
      for (const g of groups ?? []) {
        out.push(...(g.templates ?? []));
        out.push(...allTemplates(g.child_effects), ...allTemplates(g.activation_effects));
      }
      return out;
    };

    for (const file of walk(EXPORT_ROOT, null)) {
      let json: { effects?: Group[]; activation_time?: number; recharge_time?: number };
      try {
        json = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // A malformed export file is a real problem, but it is THIS sweep's job to be
        // loud about coverage, not to swallow it — record it as a zero-template file.
        continue;
      }
      if (!json?.effects) continue;
      const ctx = { activationTime: json.activation_time, rechargeTime: json.recharge_time };

      for (const t of allTemplates(json.effects)) {
        // Mirror extractDamage's own gate.
        if (!t.attribs || !t.scale) continue;
        const attrib = t.attribs[0]?.toLowerCase();
        const damageType = DAMAGE_TYPES[attrib] ?? (attrib === 'damage' ? 'Special' : undefined);
        if (!damageType) continue;
        const aspect = t.aspect?.toLowerCase();
        if (attrib !== 'damage' && !attrib.endsWith('_dmg') && (aspect === 'current' || aspect === 'cur')) continue;
        if (aspect && !['absolute', 'current', 'cur', 'abs'].includes(aspect)) continue;
        if (/debuff|buff/i.test(t.table ?? '')) continue;
        gated++;

        const expr: string[] = t.magnitude_expression ?? [];
        if (!expr.length) continue;
        withExpression++;
        const k = stdResultCoefficient(expr, ctx);
        if (k === null) continue;
        byCoefficient.set(String(k), (byCoefficient.get(String(k)) ?? 0) + 1);
        if (k === 1) { noOpFolds++; continue; }
        changed.push({
          file: path.relative(EXPORT_ROOT, file), k,
          from: t.scale, to: Number((t.scale * k).toPrecision(12)),
        });
      }
    }

    console.log(
      `[fold sweep] damage-gated templates=${gated}  with magnitude_expression=${withExpression}  ` +
      `no-op folds (k=1)=${noOpFolds}  value-changing folds=${changed.length}  ` +
      `coefficients=${JSON.stringify(Object.fromEntries(byCoefficient))}`,
    );
  });

  it('the sweep actually covered the corpus (a zero here is an INVALID run)', () => {
    // Homecoming only (the fork subdirs and tables/ are skipped); ~14,976 / ~459 today.
    expect(gated).toBeGreaterThan(14000);
    expect(withExpression).toBeGreaterThan(400);
    // The ramp-only programs must be SEEN and resolved to 1 — not merely bailed on.
    // If they started bailing, the controls below would pass for the wrong reason.
    expect(noOpFolds).toBe(96);
  });

  it('every value-changing fold is a snipe program in a snipe file', () => {
    expect(changed.length).toBeGreaterThan(0);
    for (const row of changed) {
      expect(row.file, `unexpected fold in ${row.file} (${row.from} → ${row.to})`)
        .toMatch(/(_snipe\/|mission_maker_attacks\/)/);
    }
  });

  it('the folded coefficients are exactly the four snipe shapes plus the no-op', () => {
    const ks = [...byCoefficient.keys()].map(Number).sort((a, b) => a - b);
    expect(ks.map((k) => Number(k.toPrecision(6)))).toEqual([
      0.11,               // `@StdResult * 3 / 0.33 *`  (penetrating_ray DoT)
      0.25,               // `@StdResult * 4 /`         (proton_volley)
      0.3,                // `@StdResult * 0.3 *`       (sniper_blast smashing)
      0.683,              // penetrating_ray PvP, activation 1.67
      0.7,                // `@StdResult * 0.7 *`       (sniper_blast energy)
      1,                  // ramp-only — the no-op
      1.08667,            // penetrating_ray PvP, activation 3.4
    ]);
  });
});
