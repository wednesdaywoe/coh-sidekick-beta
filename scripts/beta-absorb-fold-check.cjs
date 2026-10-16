/**
 * BPORT7 pre-regen check: the data-gaps-163 fold comparison window. `node scripts/beta-absorb-fold-check.cjs`.
 *
 * Grades, on all four forks, every power whose PRE-STRIP bag carries an
 * `effects.absorb` slot against the atom readers:
 *   - `{scale, table}` slots  -> raw scale vs `absorbValue` (flat fold) scale
 *   - `{maxHPFraction}` slots -> fraction vs `absorbMaxHPFractionValue`
 * The flat fold SUMS identical rows; the bag stores scale/N + maxStacks=N
 * (convert-powerset.cjs:7286), so N-row powers read N x the bag's raw scale.
 * One-shot measurement; the bag dies at the BPORT7 regen. Findings and the
 * corrected 169/171 reading: data-gaps-163 in canonical's docs/gaps/stat-routing.md.
 */
require('tsx/cjs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
// The generated modules import via the Vite `@/` alias, which tsx's CJS hook
// does not map. One shim, listed here rather than blanket.
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(REPO, 'src', request.slice(2));
  return origResolve.call(this, request, ...rest);
};
// Same two Vite-only stubs the supply census pre-seeds (its lines 230-271).
function stubViteOnlyModules() {
  const resolvePath = (p) => (typeof p === 'string' && p.startsWith('/') ? `/${p.slice(1)}` : p);
  const unreachable = (name) => () => {
    throw new Error(`absorb-fold-check: stubbed engine export ${name}() was called`);
  };
  const stubs = {
    'src/utils/paths.ts': { BASE_URL: '/', resolvePath, getImagePath: (p) => resolvePath(`/img/${p}`) },
    'src/engine/engine.ts': {
      recalcJson: unreachable('recalcJson'),
      whatIfVocabulary: unreachable('whatIfVocabulary'),
      loadDataset: unreachable('loadDataset'),
      projectPowerJson: unreachable('projectPowerJson'),
      targetRanksJson: unreachable('targetRanksJson'),
    },
  };
  for (const [rel, exports] of Object.entries(stubs)) {
    const id = require.resolve(path.join(REPO, rel));
    if (require.cache[id]) continue;
    require.cache[id] = { id, filename: id, loaded: true, children: [], paths: [], exports };
  }
}
const { collectPowers } = require(path.join(REPO, 'scripts/planb-shadow-sweep.cjs'));
const { ALL_DATASETS } = require(path.join(REPO, 'scripts/_dataset-paths.cjs'));
const { activateDataset } = require(path.join(REPO, 'src/data/dataset.ts'));
const { absorbValue, absorbMaxHPFractionValue, baseAtoms } = require(path.join(REPO, 'src/data/core/atom-query.ts'));

const perDs = {};
let total = 0, agree = 0;
const divergent = [];

// Stacking-keyed fold, reconstructed from the BPORT11 description: "a Replace row counts one
// application, a Stack row sums to its cap". Rows group by (scale, table, target) identity, the
// pre-scan's allMatch key (convert-powerset.cjs:6255-6258); count is 1 when every row is
// stacking==='Replace', else min(size, stackCap). The re-run found the bag's maxStacks is
// template-scoped, not stacking-keyed — see the data-gaps-163 narrative.
function stackingFold(power) {
  const rows = baseAtoms(power).filter(
    (a) => a.effectType === 'Absorb'
      && a.aspect !== 'Str'
      && !(a.aspect === 'Max' && a.attribType === 'Expression')
      && !!a.modifierTable,
  );
  if (!rows.length) return undefined;
  const groups = new Map();
  for (const a of rows) {
    const k = JSON.stringify([a.scale ?? 0, a.modifierTable, a.toWho ?? null]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  return [...groups.values()].map((g) => {
    const allReplace = g.every((a) => a.stacking === 'Replace');
    const cap = Math.max(...g.map((a) => a.stackCap ?? Infinity));
    const count = allReplace ? 1 : Math.min(g.length, cap === Infinity ? g.length : cap);
    return {
      scale: g[0].scale, table: g[0].modifierTable, toWho: g[0].toWho ?? null,
      n: g.length, count, allReplace,
      stacking: [...new Set(g.map((a) => a.stacking))].join('|'),
      stackCap: cap === Infinity ? null : cap,
    };
  });
}

const foldPerDs = {};
let foldAgree = 0, scaleOnlyAgree = 0, fullTotalAgree = 0;
const foldDivergent = [];
const scaleOnlyDivergent = [];
const fullTotalDivergent = [];

stubViteOnlyModules();
for (const ds of ALL_DATASETS) {
  const mod = require(path.join(REPO, 'src/data/datasets', ds, 'index.ts'));
  activateDataset(mod.default);
  const powers = collectPowers(mod.default);
  let n = 0, a = 0, fracSlots = 0;
  let fn = 0, fa = 0;
  for (const p of powers) {
    const bag = p.effects && p.effects.absorb;
    if (bag === undefined || bag === null) continue;
    n++;
    const name = p.name || p.id || '(unnamed)';
    if (typeof bag === 'object' && 'maxHPFraction' in bag) {
      fracSlots++;
      const frac = absorbMaxHPFractionValue(p);
      if (frac !== undefined && Math.abs(frac - bag.maxHPFraction) < 1e-6) a++;
      else divergent.push({ ds, name, kind: 'maxHPFraction', bag: bag.maxHPFraction, atom: frac });
    } else {
      const flat = absorbValue(p);
      const atomScale = flat ? flat.scale : undefined;
      if (atomScale !== undefined && Math.abs(atomScale - bag.scale) < 1e-6) a++;
      else divergent.push({
        ds, name, kind: 'scale', bag: bag.scale, atom: atomScale,
        maxStacks: p.effects.maxStacks ?? null,
        ratio: atomScale !== undefined && bag.scale ? +(atomScale / bag.scale).toFixed(3) : null,
      });

      // stacking-keyed fold vs the bag, three comparison semantics
      fn++;
      const fold = stackingFold(p);
      const bagStacks = p.effects.maxStacks || 1;
      const foldSum = fold ? fold.reduce((s, g) => s + g.scale * g.count, 0) : undefined;
      if (fold && fold.length === 1
        && Math.abs(fold[0].scale - bag.scale) < 1e-6
        && fold[0].count === bagStacks) { fa++; }
      else foldDivergent.push({ ds, name, bag: { scale: bag.scale, maxStacks: bagStacks }, fold });
      // (a) scale-only: fold row-scale sum vs bag scale
      if (foldSum !== undefined && Math.abs(foldSum - bag.scale) < 1e-6) scaleOnlyAgree++;
      else scaleOnlyDivergent.push({ ds, name, foldSum, bagScale: bag.scale });
      // (b) full-stack total: fold sum(scale*count) vs bag scale*maxStacks
      if (foldSum !== undefined && Math.abs(foldSum - bag.scale * bagStacks) < 1e-6) fullTotalAgree++;
      else fullTotalDivergent.push({ ds, name, foldSum, bagTotal: bag.scale * bagStacks });
    }
  }
  foldPerDs[ds] = { carriers: fn, agree: fa };
  perDs[ds] = { powers: powers.length, carriers: n, agree: a, maxHPFractionSlots: fracSlots };
  total += n; agree += a; foldAgree += fa;
}

console.log(JSON.stringify({
  perDs, total, agree, divergentCount: divergent.length, divergent,
  fold: {
    perDs: foldPerDs, agree: foldAgree, divergentCount: foldDivergent.length, divergent: foldDivergent,
    scaleOnlyAgree, fullTotalAgree,
    scaleOnlyDivergent, fullTotalDivergent,
  },
}, null, 1));
