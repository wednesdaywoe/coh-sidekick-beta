/**
 * BPORT3 — the adjudication of the six beta-only bag readers.
 *
 * These six have no canonical counterpart, so there is no post-strip verdict to copy: each
 * one owes its own answer to "does BPORT7's regen break this, and what does it read".
 * `legacy-totals.oracle.ts` is the sixth and belongs to BPORT5. The other five split three
 * ways, and this file pins the three verdicts, because each rests on a source-shape fact
 * that a later edit can quietly reverse.
 *
 * Why here rather than in the census: the census measures SUPPLY, per slot. Every claim
 * below is about a READER — which bag reaches it, whose keys it walks, what its callers hand
 * it — and none of them is expressible as a supply count. Two of the five are invisible to a
 * supply census by construction: they name no slot at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
// Source-scanning only — no dataset walk, so this stays a cheap in-process require rather
// than the child process the supply census needs.
const { bagSeams } = createRequire(import.meta.url)(
  path.join(REPO, 'scripts/beta-bag-reader-census.cjs'),
) as { bagSeams: (rel: string) => { slot: string; line: number | null; binding: string }[] };
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');

/** Every non-test `.ts`/`.tsx` under `src/`, as {rel, src}. */
function sourceFiles(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const stack = [path.join(REPO, 'src')];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!/\.tsx?$/.test(e.name) || /\.(test|spec)\.tsx?$/.test(e.name)) continue;
      out.push({ rel: path.relative(REPO, p), src: readFileSync(p, 'utf8') });
    }
  }
  return out;
}

/**
 * The files whose import statements bind `symbol`.
 *
 * Matched on the `import { … } from` form spanning newlines, not on a bare mention: three of
 * the four call sites below name the symbol in a comment as well, and a mention-based match
 * would credit `PowerInfoBlocks.tsx` with rendering something it only refers to.
 */
function importersOf(files: { rel: string; src: string }[], symbol: string): string[] {
  const re = new RegExp(String.raw`import\s*\{[^}]*\b${symbol}\b[^}]*\}\s*from`, 's');
  return files.filter((f) => re.test(f.src)).map((f) => f.rel).sort();
}

const FILES = sourceFiles();

describe('BPORT3 — petEffectDisplay.ts is not a bag reader at all', () => {
  // It matched the `.effects` sweep that built the 43-file reader census, and the match is a
  // false positive: its one read is `ability.effects`, a pet ability's PetEffect ARRAY. The
  // bag and this field share a name and nothing else, so BPORT7 cannot touch it. Pinned
  // because the next sweep will match it again and the answer should not be re-derived.
  const src = read('src/components/info/petEffectDisplay.ts');

  it('reads only a pet ability\'s effect array', () => {
    const reads = [...src.matchAll(/(\w+)(?:\?)?\.effects\b/g)].map((m) => m[1]);
    expect(new Set(reads)).toEqual(new Set(['ability']));
  });

  it('types that field as a PetEffect array, never as PowerEffects', () => {
    expect(src).toContain('effects?: readonly PetEffectSubtyped[]');
    expect(src).not.toContain('PowerEffects');
  });
});

describe('BPORT3 — resolvePowerMagnitudes.ts reads the display bag, through the registry', () => {
  const src = read('src/components/info/resolvePowerMagnitudes.ts');

  it('names no bag slot of its own', () => {
    // The reason a census keyed on `effects.<slot>` reported no reader for eleven slots this
    // walk renders. Its domain is `EFFECT_REGISTRY`, resolved at runtime, so the only way to
    // credit it is to derive that roster — which `beta-bag-supply-census.cjs` now does.
    expect(src).toContain('groupEffectsByCategory(effects as Record<string, unknown>)');
    expect([...src.matchAll(/\beffects(?:\?)?\.[A-Za-z_]/g)]).toHaveLength(0);
  });

  it('is reached only through callers that build a display bag', () => {
    // The reach question the census defers per seam, answered for this one. The mint-only
    // slots (`castTime`, `enduranceCost`, `healing`, …) therefore DO supply it — unlike the
    // totals oracle, which reads the same names and builds no display bag.
    const displayBuilders = new Set(
      FILES.filter((f) => /import\s*\{[^}]*\b(buildDisplayEffects|withPseudoPetEffects|withTargetsHit)\b[^}]*\}\s*from/s.test(f.src))
        .map((f) => f.rel),
    );
    const direct = importersOf(FILES, 'resolvePowerMagnitudes');
    expect(direct).toEqual(['src/components/info/SharedPowerComponents.tsx']);

    // SharedPowerComponents is a component library, not a display-bag builder — the bag
    // arrives as a prop. So the question passes up to whoever renders the component.
    const renderers = importersOf(FILES, 'RegistryEffectsDisplay');
    expect(renderers.length).toBeGreaterThan(0);
    for (const r of renderers) expect(displayBuilders, r).toContain(r);
  });
});

describe('BPORT3 — characterStateAdapter.ts reads supplier 2, not the power bag', () => {
  const src = read('src/engine/characterStateAdapter.ts');

  it('reads a conditional\'s bag and never a power\'s', () => {
    // `adjusterAffectsSelfTotals` asks a `ConditionalEffect` for its keys.
    // `conditionalEffects[].effects` is untouched by the converter strip, so this reader
    // survives BPORT7 whole — the one verdict here that needs no follow-up work.
    expect(src).toContain('const effects = (c as { effects?: Record<string, unknown> }).effects');
    expect([...src.matchAll(/\bpower(?:\?)?\.effects\b/g)]).toHaveLength(0);
  });

  it('tests those keys against a roster with four names no bag can carry', () => {
    // `regeneration`, `recovery`, `maxEndurance` and `maxHealth` are not `PowerEffects`
    // slots and appear in no emitted bag on any of the four datasets. Inert arms, not a
    // bug — but a roster half of whose misses are unreachable is worth stating, and the
    // census reports them under `dynamicKeysUndeclared`. Six more members are declared
    // slots with zero conditional supply, which the census tracks per slot.
    const set = src.slice(src.indexOf('const SELF_TOTAL_EFFECT_KEYS'));
    const keys = [...set.slice(0, set.indexOf(']')).matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((m) => m[1]);
    expect(keys).toHaveLength(32);
    const declared = read('src/types/power.ts');
    const body = declared.slice(declared.indexOf('export interface PowerEffects {'));
    const slots = new Set([...body.slice(0, body.indexOf('\n}')).matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]));
    expect(keys.filter((k) => !slots.has(k)))
      .toEqual(['regeneration', 'recovery', 'maxEndurance', 'maxHealth']);
  });
});

/**
 * The `summon` slot, which is BPORT3's one finding that changes another item's scope.
 *
 * `summon` has 1,435 carriers across the four datasets and no mint, so it dies exactly when
 * BPORT7's regen lands. BPORT2 found this on `BuffPetAuraToggle.tsx` and deferred that ONE
 * file to BPORT7, because a reader can only move to `power.summon` once a converter writes
 * it. The same crossing was owed to every reader the census named — eleven files, forty-four
 * sites — and the beta shipped zero powers carrying a top-level `summon`, so none of them
 * may move first. Canonical recorded the cost of getting this wrong in `Power.summon`'s own
 * doc: retiring the bag "took the pets with it and 400+ summoners per fork went dark"
 * (data-gaps-22).
 *
 * BPORT7 crossed it. The twenty-four power-bag reads (twenty-three own, one alias) now read
 * `power.summon`, and `buildDisplayEffects` mints the display bag's `summon` from the top
 * level, because the bag spread no longer carries it. What the roster below pins is what
 * SURVIVES: the eighteen display-bag reads in three files, all `param` binding — they read
 * the bag the mint builds, not the power's, so the regen does not touch them.
 *
 * Counts are per-file match counts, not per-file line counts. The first census of this taken
 * by eye read nine files and twenty-two sites, because a line-oriented grep counts a JSX
 * block rendering six fields of the same object once and missed `DamageBlock.tsx` outright.
 *
 * BPORT4 added the eleventh, and the reason it was missing is the same class of blindness
 * this entry found on `resolvePowerMagnitudes`: `PowersetCompareModal` binds the bag to a
 * local (`const e = power.effects`) and reads `e?.summon` through it, which no
 * `effects.summon` pattern can see. The roster is therefore no longer taken with a regex —
 * it comes from the reader census's finders, so an alias, a chained receiver
 * (`getArchetype(…)?.inherent?.effects`) or a comment cannot move it again without the
 * finders moving too.
 */
const SUMMON_BAG_READERS: Record<string, number> = {
  'src/components/info/DamageBlock.tsx': 2,
  'src/components/info/InfoPanel.tsx': 3,
  'src/components/info/PowerInfoTooltip.tsx': 13,
};

describe('BPORT3 — the summon slot crosses with its writer, or the pets go dark', () => {
  it('the surviving by-name readers are the display-bag reads the mint supplies', () => {
    const found: Record<string, number> = {};
    for (const f of FILES) {
      // `resolvePowerMagnitudes` reads `summon` too, through the registry rather than by
      // name, and it is BPORT3's own verdict rather than a crossing owed to BPORT7 — the
      // roster here is the by-name readers, which is what "must move when the writer moves"
      // means. Roster reads are excluded by asking for a line.
      const n = bagSeams(f.rel).filter((s) => s.slot === 'summon' && s.line != null).length;
      if (n > 0) found[f.rel] = n;
    }
    expect(found).toEqual(SUMMON_BAG_READERS);
  });

  it('every power-bag converter lifts the slot, so the crossing is owed to no one', () => {
    // The alarm form of this assertion reds the moment a converter lands the lift without
    // the readers moving; BPORT7 answered it in one change. The five lifters are the
    // converters that write a power bag at all — the other convert-*.cjs files emit
    // non-power data and never had the slot to lift.
    const scripts = readdirSync(path.join(REPO, 'scripts')).filter((f) => /^convert-.*\.cjs$/.test(f));
    const lifts = scripts.filter((f) => /\bpower\.summon\s*=/.test(read(`scripts/${f}`))).sort();
    expect(lifts).toEqual([
      'convert-accolades.cjs',
      'convert-basic-inherents.cjs',
      'convert-epic-pools.cjs',
      'convert-pool-powers.cjs',
      'convert-powerset.cjs',
    ]);
  });
});

describe('data-gaps-329 — the roster of RegistryEffectsDisplay call sites', () => {
  // The swap is only as wide as its call sites, and `powerProjectionParity`'s gate names them
  // one by one — so it is blind to a FOURTH surface that ships on the bag path by never
  // appearing in its list. This pins the roster; that gate grades the members.
  //
  // `CompareSlottingModal` is the reason the distinction is worth having. It sat outside the
  // swap on the reading that `project_power` resolves the build's own slotting while the
  // modal's subject is a hypothetical one — but PROD6D's `useHypotheticalCalculation` IS the
  // hypothetical run, and the modal was already reading `enhancementBonuses` off that
  // projection while resolving its rows from the stripped bag beside it.
  it('is exactly the three surfaces the parity gate grades', () => {
    expect(importersOf(FILES, 'RegistryEffectsDisplay')).toEqual([
      'src/components/info/InfoPanel.tsx',
      'src/components/info/PowerInfoTooltip.tsx',
      'src/components/modals/CompareSlottingModal.tsx',
    ]);
  });
});
