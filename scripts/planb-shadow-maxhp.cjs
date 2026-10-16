/**
 * Plan B, Phase 2 Slice 5 — max-HP reconstruction shadow (both the enhanceable
 * `maxHPBuff` and the IgnoreStrength `maxHPBuffUnenhanced` twin).
 *
 * Proves that the atom list reproduces the bag's +MaxHP twin family WITHOUT reading
 * the bag — the precondition for migrating those two appliers in character-totals.ts:
 *
 *   BAG   — `effects.maxHPBuff` / `effects.maxHPBuffUnenhanced`, what the calc reads
 *           today (each `{ scale, table }`; both halves co-apply and sum, the
 *           enhanceable one alone scaled by +Healing strength).
 *   ATOMS — `maxHPBuffValue(power, {ignoreStrength})`: the MaxHP buff atoms (aspect
 *           Max, not a debuff), split by `ignoreStrength`, rebuilt via the shared
 *           `perTargetValueOf`.
 *
 * The `*Unenhanced` twin is the whole point of this slice — a hand-rolled parallel
 * slot collapses into one `ignoreStrength` filter. Both halves are checked here so
 * the split is proven, not assumed.
 *
 * Scope note: regen/recovery (the other two `*Unenhanced` twins) are NOT covered —
 * their bag values also depend on `foldResourceSlot`'s same-table SUM, a regen-only
 * `StackByAttribAndKey` skip, and a description-text target-trap filter, none of
 * which is on the wire atom. They have their own shadow: planb-shadow-resources.cjs.
 *
 * Exit code is nonzero on any divergence — this GATES, like planb-shadow-resistance.
 *
 * Usage:
 *   node scripts/planb-shadow-maxhp.cjs
 *   node scripts/planb-shadow-maxhp.cjs --dataset homecoming
 *   node scripts/planb-shadow-maxhp.cjs --power "High Pain Tolerance"
 */

require('tsx/cjs');
const fs = require('fs');
const path = require('path');
const { sweepDataset } = require('./planb-shadow-sweep.cjs');
const { maxHPBuffValue } = require('../src/data/core/atom-query.ts');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const POWER_FILTER = argVal('--power');
const DATASETS = (() => {
  const picked = argv.flatMap((a, i) => (a === '--dataset' && argv[i + 1] ? [argv[i + 1]] : []));
  return picked.length ? picked : require('./_dataset-paths.cjs').ALL_DATASETS;
})();

const r4 = (n) => Math.round((n || 0) * 1e4) / 1e4;

const SLOTS = [
  { slot: 'maxHPBuff', fn: (p) => maxHPBuffValue(p) },
  { slot: 'maxHPBuffUnenhanced', fn: (p) => maxHPBuffValue(p, { ignoreStrength: true }) },
];

/** Normalize a bag or atom slot value to `{ scale, perTarget }` (or undefined). */
function norm(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return { scale: r4(Math.abs(v)), perTarget: 0 };
  return { scale: r4(Math.abs(v.scale)), perTarget: r4(v.perTarget) };
}
const eq = (a, b) => (!a && !b) || (a && b && a.scale === b.scale && a.perTarget === b.perTarget);

const stats = { powers: 0, noBag: 0, slots: 0, agree: 0 };
const findings = [];

function checkPower(dataset, power, genPath) {
  const name = power.name || genPath;
  if (POWER_FILTER && !name.toLowerCase().includes(POWER_FILTER.toLowerCase())) return;
  stats.powers++;
  // data-gaps-327 (BPORT7) removed the bag this gate compares against; bag-less powers are vacuous rows, named in the tail.
  if (!power.effects || !Object.keys(power.effects).length) { stats.noBag++; return; }
  const eff = power.effects || {};

  for (const { slot, fn } of SLOTS) {
    const bag = norm(eff[slot]);
    const atom = norm(fn(power));
    if (!bag && !atom) continue;
    stats.slots++;
    if (eq(bag, atom)) stats.agree++;
    else {
      findings.push({ dataset, name, slot, bag, atom });
      if (POWER_FILTER) console.log(`  [DIVERGE] ${name} ${slot}  bag=${JSON.stringify(bag)} atom=${JSON.stringify(atom)}`);
    }
  }
}

// Sweeps the dataset's WHOLE generated tree (see planb-shadow-sweep.cjs) — including
// power-pools.ts / epic-pools.ts, which every shadow's hand-rolled sweep used to miss.
function sweep(dataset) {
  sweepDataset(dataset, (power, rel) => checkPower(dataset, power, rel));
}

for (const ds of DATASETS) sweep(ds);

// Every swept power bag-less: the run checks nothing and the tail names it.
const VACUOUS = stats.powers > 0 && stats.noBag === stats.powers;

console.log(`\nPlan B Slice 5 — max-HP reconstruction (maxHPBuff + maxHPBuffUnenhanced twin)`);
console.log(`  powers swept:  ${stats.powers}`);
console.log(`  slots:         ${stats.slots}`);
console.log(`  agree:         ${stats.agree}`);
console.log(`  diverge:       ${findings.length}`);

for (const f of findings.slice(0, 60)) {
  console.log(`\n  [DIVERGE] ${f.name} (${f.dataset}) ${f.slot}`);
  console.log(`      bag  : ${JSON.stringify(f.bag)}`);
  console.log(`      atom : ${JSON.stringify(f.atom)}`);
}
if (findings.length > 60) console.log(`\n  ... and ${findings.length - 60} more`);

if (findings.length) {
  console.log('\nFAIL — atom-derived max-HP diverges from the bag. Fix before migrating the applier.');
  process.exit(1);
}
if (VACUOUS) {
  console.log(`\nVACUOUS — bag absent: ${stats.noBag} powers swept, 0 checks — vacuous post-data-gaps-327.`);
  console.log('   The atom side is graded by the converter gates, not here.');
} else {
  console.log('\nOK — atom-derived maxHPBuff + maxHPBuffUnenhanced reproduce the bag corpus-wide.');
}
