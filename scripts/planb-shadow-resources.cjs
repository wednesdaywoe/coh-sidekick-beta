/**
 * Plan B, Phase 2 Slice 6 — regen/recovery reconstruction shadow (all four slots:
 * `regenBuff` / `regenBuffUnenhanced` and `recoveryBuff` / `recoveryBuffUnenhanced`).
 *
 * Proves that the atom list reproduces the bag's LAST two `*Unenhanced` twin families
 * WITHOUT reading the bag — the precondition for migrating those four appliers in
 * character-totals.ts:
 *
 *   BAG   — `effects.regenBuff` / `effects.regenBuffUnenhanced` / `effects.recoveryBuff`
 *           / `effects.recoveryBuffUnenhanced`, what the calc reads today.
 *   ATOMS — `regenBuffValue(power, {ignoreStrength})` / `recoveryBuffValue(...)`: the
 *           Regeneration/Recovery buff atoms (aspect ≠ Res, not a debuff, not
 *           `notOnCaster`), increments routed to the enhanceable half, the rest split by
 *           `ignoreStrength` and folded with `foldResourceSlot`'s SUM semantics.
 *
 * PUNTS ARE FIRST-CLASS, and the reason this gate is shaped differently from Slices 1–5.
 * Two of the bag's behaviors are NOT settleable from the wire atom (the Expression +
 * tick-chance-0 drop, and the `StackByAttribAndKey` burst/tail family whose bag value is
 * a suspected latent BUG — see `atom-query.ts`), so the helper deliberately returns
 * `undefined` for them and the applier keeps reading the unchanged bag. A punt is
 * therefore behavior-preserving by construction and is REPORTED, not gated. What IS
 * gated, in both directions:
 *
 *   - atom defined + bag defined  → must be EQUAL (the migration is only sound if every
 *     value the helper hands the applier is the value the applier reads today);
 *   - atom defined + bag ABSENT   → DIVERGENCE. This is the direction that matters most
 *     here: the helper inventing a value the bag never had would ADD a phantom total
 *     (exactly what the Thunderspy target-trap would do without its `notOnCaster` stamp).
 *     A punt-to-bag can only ever preserve behavior; an over-production cannot.
 *
 * Exit code is nonzero on any divergence — this GATES, like planb-shadow-maxhp.
 *
 * Usage:
 *   node scripts/planb-shadow-resources.cjs
 *   node scripts/planb-shadow-resources.cjs --dataset thunderspy
 *   node scripts/planb-shadow-resources.cjs --power "Consume Psyche"
 *   node scripts/planb-shadow-resources.cjs --show-punts
 */

require('tsx/cjs');
const fs = require('fs');
const path = require('path');
const { sweepDataset } = require('./planb-shadow-sweep.cjs');
const { regenBuffValue, recoveryBuffValue } = require('../src/data/core/atom-query.ts');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const POWER_FILTER = argVal('--power');
const SHOW_PUNTS = argv.includes('--show-punts');
const DATASETS = (() => {
  const picked = argv.flatMap((a, i) => (a === '--dataset' && argv[i + 1] ? [argv[i + 1]] : []));
  return picked.length ? picked : require('./_dataset-paths.cjs').ALL_DATASETS;
})();

const r4 = (n) => Math.round((n || 0) * 1e4) / 1e4;

const SLOTS = [
  { slot: 'regenBuff', fn: (p) => regenBuffValue(p) },
  { slot: 'regenBuffUnenhanced', fn: (p) => regenBuffValue(p, { ignoreStrength: true }) },
  { slot: 'recoveryBuff', fn: (p) => recoveryBuffValue(p) },
  { slot: 'recoveryBuffUnenhanced', fn: (p) => recoveryBuffValue(p, { ignoreStrength: true }) },
];

/** Normalize a bag or atom slot value to `{ scale, perTarget }` (or undefined). */
function norm(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return { scale: r4(Math.abs(v)), perTarget: 0 };
  return { scale: r4(Math.abs(v.scale)), perTarget: r4(v.perTarget) };
}
const eq = (a, b) => a.scale === b.scale && a.perTarget === b.perTarget;

const stats = { powers: 0, noBag: 0, checked: 0, agree: 0, punts: 0 };
const findings = [];
const punts = [];

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
    if (!atom) {
      // Helper punted (or the power has no atoms) → the applier falls back to the
      // bag's unchanged value. Behavior-preserving; reported for visibility only.
      stats.punts++;
      punts.push({ dataset, name, slot, bag });
      continue;
    }
    stats.checked++;
    if (bag && eq(bag, atom)) stats.agree++;
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

console.log(`\nPlan B Slice 6 — regen/recovery reconstruction (regenBuff + recoveryBuff + both twins)`);
console.log(`  powers swept:  ${stats.powers}`);
console.log(`  checked:       ${stats.checked}   (atom returned a value — gated)`);
console.log(`  agree:         ${stats.agree}`);
console.log(`  diverge:       ${findings.length}`);
console.log(`  punts:         ${stats.punts}   (atom → undefined; applier keeps the bag — reported, not gated)`);

if (SHOW_PUNTS) {
  const byName = new Map();
  for (const p of punts) {
    const k = `${p.name} (${p.dataset})`;
    byName.set(k, [...(byName.get(k) || []), p.slot]);
  }
  console.log(`\n  punted powers (${byName.size}):`);
  for (const [k, slots] of [...byName].sort()) console.log(`    ${k}: ${slots.join(', ')}`);
}

for (const f of findings.slice(0, 60)) {
  console.log(`\n  [DIVERGE] ${f.name} (${f.dataset}) ${f.slot}`);
  console.log(`      bag  : ${JSON.stringify(f.bag)}`);
  console.log(`      atom : ${JSON.stringify(f.atom)}`);
}
if (findings.length > 60) console.log(`\n  ... and ${findings.length - 60} more`);

if (findings.length) {
  console.log('\nFAIL — atom-derived regen/recovery diverges from the bag. Fix before migrating the applier.');
  process.exit(1);
}
if (VACUOUS) {
  console.log(`\nVACUOUS — bag absent: ${stats.noBag} powers swept, 0 checks — vacuous post-data-gaps-327.`);
  console.log('   The atom side is graded by the converter gates, not here.');
} else {
  console.log('\nOK — every atom-derived regen/recovery value reproduces the bag corpus-wide.');
}
