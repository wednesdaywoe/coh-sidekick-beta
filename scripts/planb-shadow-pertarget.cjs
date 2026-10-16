/**
 * Plan B, Phase 2 Slices 1–2 — perTarget reconstruction shadow (ToHit + Damage).
 *
 * Proves that the atom list reproduces the bag's per-target `{ scale, perTarget }`
 * for `tohitBuff` AND `damageBuff` WITHOUT reading the bag — the precondition for
 * migrating those appliers off the bag while the per-foe sliders (Soul Drain at
 * 1 vs 8 targets) keep working.
 *
 *   BAG   — `effects.<slot>` (`{ scale, table, perTarget? }`), what the calc reads
 *           today. Its perTarget comes from `computeAoePerTargetPatches`.
 *   ATOMS — `toHitBuffValue` / `damageBuffValue`: `perTarget` is Σ of the
 *           converter-stamped increment atoms, `scale` the N=1 value.
 *
 * The stamp is what makes this exact: the atom's own `stacking` can't identify a
 * per-target increment on its own (Invincibility's `Continuous` reaches the atom
 * since data-gaps-66, but the flavor is only one of `computeAoePerTargetPatches`'
 * terms), and the AoE geometry / redirect / Defiance provenance never reaches the
 * runtime — so the converter decides and stamps, as it does for `gated` (Slice 0).
 *
 * `damageBuff` is harder than `tohitBuff` (scalar): a +damage buff explodes into
 * one atom per damage type, so `damageBuffValue` collapses that dimension (dedup
 * by `(|scale|, table)`, matching the converter's `sumDistinctScale`), keeps the
 * dominant table (dropping a Defiance rider), and derives N=1 from `toWho` so AAO
 * (Self increment) and Fulcrum Shift (Target increment, redirect-stamped) both
 * reproduce. Other effect types (regen, recovery, defense, endurance) carry
 * perTarget too and migrate in their own slices; Phalanx's self-counted residual
 * lives there.
 *
 * One class is graded by a DIFFERENT assertion than equality: a power whose whole
 * `damageBuff` is Defiance. There the reader rejects the slot on purpose and the bag
 * keeps it, so "atoms reproduce the bag" is the wrong property — the gate asserts the
 * rejection held (empty atom read, bag still populated) and counts it separately.
 *
 * Exit code is nonzero on any divergence — this GATES, unlike the triage reports.
 *
 * Usage:
 *   node scripts/planb-shadow-pertarget.cjs
 *   node scripts/planb-shadow-pertarget.cjs --dataset homecoming
 *   node scripts/planb-shadow-pertarget.cjs --power "Soul Drain"
 */

require('tsx/cjs');
const fs = require('fs');
const path = require('path');
const { sweepDataset } = require('./planb-shadow-sweep.cjs');
const {
  toHitBuffValue, damageBuffValue, damageBuffIsDefianceOnly, baseAtoms,
} = require('../src/data/core/atom-query.ts');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const POWER_FILTER = argVal('--power');
const DATASETS = (() => {
  const picked = argv.flatMap((a, i) => (a === '--dataset' && argv[i + 1] ? [argv[i + 1]] : []));
  return picked.length ? picked : require('./_dataset-paths.cjs').ALL_DATASETS;
})();

const r4 = (n) => Math.round((n || 0) * 1e4) / 1e4;

/** Normalize a bag slot value to `{ scale, perTarget }` for comparison. */
function bagValue(v) {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return { scale: r4(Math.abs(v)), perTarget: 0 };
  return { scale: r4(Math.abs(v.scale)), perTarget: r4(v.perTarget) };
}
function atomCmpOf(v) {
  return v ? { scale: r4(v.scale), perTarget: r4(v.perTarget) } : undefined;
}

const SLOTS = [
  { key: 'tohitBuff', get: (p) => toHitBuffValue(p) },
  { key: 'tohitBuffUnenhanced', get: (p) => toHitBuffValue(p, { ignoreStrength: true }) },
  { key: 'damageBuff', get: (p) => damageBuffValue(p) },
];

/** The effectType whose base atom VALUES each buff slot. */
const SLOT_EFFECT_TYPE = { tohitBuff: 'ToHit', tohitBuffUnenhanced: 'ToHit', damageBuff: 'DamageBuff' };

/**
 * Whether this slot's buff is EXPRESSION-VALUED for `power` — its value is a runtime
 * `magnitude_expression` (evaluated by the calc's expr VM), not a static `scale`. Brute Fury's
 * `Rage_Buff` is the case: eight `DamageBuff` atoms of `attribType 'Expression'` carrying
 * `kRage source> .02 *`, which the calc DERIVES at build time (Pass 3, `inherents::fury_damage_derived`)
 * — never through this bag applier. The bag can't represent an expression, so it stores a lossy
 * `scale:0` placeholder, while `damageBuffValue`/`toHitBuffValue` (scale-based) correctly return
 * undefined. The scale/perTarget shadow — a precondition for migrating the BAG applier — therefore
 * does not apply here, so the slot is skipped (mirroring how planb-shadow-resources PUNTS on
 * Expression-typed resource templates rather than gating them). Scale-valued buffs (Vigilance's
 * `*Uniqueness` steps included) are unaffected.
 */
function isExpressionValued(power, slotKey) {
  const effectType = SLOT_EFFECT_TYPE[slotKey];
  return baseAtoms(power).some((a) => a.effectType === effectType && a.attribType === 'Expression');
}

const stats = { powers: 0, noBag: 0, withToHit: 0, agree: 0, perTargetPowers: 0, defianceRejected: 0, recoveredN1: 0 };
const recoveredSeen = {};
const findings = [];

function checkPower(dataset, power, genPath) {
  const name = power.name || genPath;
  if (POWER_FILTER && !name.toLowerCase().includes(POWER_FILTER.toLowerCase())) return;
  stats.powers++;
  // data-gaps-327 (BPORT7) removed the bag this gate compares against; bag-less powers are vacuous rows, named in the tail.
  if (!power.effects || !Object.keys(power.effects).length) { stats.noBag++; return; }

  for (const slot of SLOTS) {
    // Expression-valued buffs (Fury's Rage_Buff) carry no static scale/perTarget — the calc derives
    // them from their magnitude_expression (Pass 3), never through this bag applier — so skip them.
    if (isExpressionValued(power, slot.key)) continue;
    const bag = bagValue(power.effects?.[slot.key]);
    const atomCmp = atomCmpOf(slot.get(power));
    if (!bag && !atomCmp) continue;
    stats.withToHit++;
    if ((bag && bag.perTarget) || (atomCmp && atomCmp.perTarget)) stats.perTargetPowers++;

    // A Defiance-only `damageBuff` is a DELIBERATE reader-side rejection, not a failed
    // reconstruction: `damageBuffValue` finds the slot and drops all of it, while the
    // converter still routes the same value into the bag's named slot. Equality is the
    // wrong assertion here — so grade the rejection instead of waiving it. The atom read
    // must be EMPTY and the bag must still hold the value the reader declines to count,
    // which is what makes the `?? effects.damageBuff` fallback's own guard meaningful.
    // A power that merely carries a Defiance rider beside a real buff is not this case
    // (`damageBuffIsDefianceOnly` is false) and stays graded by equality below.
    if (slot.key === 'damageBuff' && damageBuffIsDefianceOnly(power)) {
      stats.defianceRejected++;
      if (atomCmp === undefined && bag !== undefined) continue;
      findings.push({ dataset, name, slot: slot.key, bag, atoms: atomCmp, defiance: true });
      continue;
    }

    const eq = bag && atomCmp && bag.scale === atomCmp.scale && bag.perTarget === atomCmp.perTarget;
    if (eq) { stats.agree++; continue; }

    // Fulcrum Shift's N=1 value, where the bag is short by one increment (data-gaps-63).
    //
    // The power executes two redirects: `KineticTransfer` puts a +2 buff on every FRIEND
    // near each foe it hits, and `KineticTransferBuffSelf` puts a flat +4 on the caster.
    // Both leaves are `['Friend', 'Self']` powers, so at one foe the caster gets 4 + 2 = 6
    // and each further foe adds another 2. The converter's `firstTargetExcluded` asked
    // `selfIsCountedTarget` of the SHELL, which is `['Foe']`, and so counted the flat 4
    // alone; the atom route reads each increment's own `ownerTargets` and gets 6.
    //
    // The bag is the loser here, and it stays wrong: rewriting `computeAoePerTargetPatches`
    // is a separate change with its own blast radius. The runtime reads the atom side, and
    // this pin is what keeps the difference deliberate.
    const RECOVERED_N1 = { 'Fulcrum Shift': { bag: 4, atoms: 6 } };
    const pin = slot.key === 'damageBuff' ? RECOVERED_N1[name] : undefined;
    if (pin && bag && atomCmp && bag.scale === pin.bag && atomCmp.scale === pin.atoms
        && bag.perTarget === atomCmp.perTarget) {
      stats.recoveredN1++;
      recoveredSeen[`${dataset}|${name}`] = true;
      continue;
    }

    findings.push({ dataset, name, slot: slot.key, bag, atoms: atomCmp });
    if (POWER_FILTER) {
      console.log(`\n=== ${name} [${dataset}] ${slot.key} ===`);
      console.log('  bag  :', JSON.stringify(bag));
      console.log('  atoms:', JSON.stringify(atomCmp));
    }
  }
}

// Sweeps the dataset's WHOLE generated tree (see planb-shadow-sweep.cjs) — including
// power-pools.ts / epic-pools.ts, which every shadow's hand-rolled sweep used to miss.
function sweep(dataset) {
  sweepDataset(dataset, (power, rel) => checkPower(dataset, power, rel));
}

for (const ds of DATASETS) sweep(ds);

// Every swept power bag-less: the run checks nothing, the tail names it, and the
// bag-derived pins below are waived.
const VACUOUS = stats.powers > 0 && stats.noBag === stats.powers;

console.log(`\nPlan B Slices 1-2 — perTarget reconstruction (tohitBuff + damageBuff)`);
console.log(`  powers swept:        ${stats.powers}`);
console.log(`  buff slots checked:  ${stats.withToHit}`);
console.log(`  of which per-target: ${stats.perTargetPowers}`);
console.log(`  agree:               ${stats.agree}`);
console.log(`  defiance-rejected:   ${stats.defianceRejected} (graded as empty-atoms + bag-holds)`);
console.log(`  N=1 recovered:       ${stats.recoveredN1} (Fulcrum Shift's redirect-delivered self increment — data-gaps-63)`);
// Both ways: the redirect chain that delivers the caster's own increment is a Parse7
// authoring, so only the HC-lineage datasets recover it, 4 Kinetics ATs each. The Parse6
// forks author Fulcrum Shift without it. A dataset appearing or dropping out here is the
// join moving, not the data.
const EXPECTED_N1_RECOVERIES = [
  // dataset-absent: rebirth, thunderspy — the redirect chain that delivers the caster's own
  // increment is a Parse7 authoring, and the Parse6 forks author Fulcrum Shift without it.
  'homecoming|Fulcrum Shift',
  'brainstorm|Fulcrum Shift',
];
const n1PinFailures = VACUOUS ? [] : [
  ...Object.keys(recoveredSeen).filter((k) => !EXPECTED_N1_RECOVERIES.includes(k))
    .map((k) => `NEW N=1 recovery, never read: ${k}`),
  // Only datasets this run actually swept can be reported lost. Without the guard a
  // single-dataset invocation fails on every fork it was never asked to look at.
  ...EXPECTED_N1_RECOVERIES.filter((k) => DATASETS.includes(k.split('|')[0]) && !recoveredSeen[k])
    .map((k) => `LOST N=1 recovery: ${k} — the caster's own increment is being dropped again`),
];
for (const line of n1PinFailures) console.log(`  [PIN] ${line}`);
console.log(`  diverge:             ${findings.length}`);

for (const f of findings.slice(0, 40)) {
  console.log(`\n  [DIVERGE] ${f.name} (${f.dataset}) ${f.slot}${f.defiance ? ' — Defiance rejection did not hold' : ''}`);
  console.log(`      bag  : ${JSON.stringify(f.bag)}`);
  console.log(`      atoms: ${JSON.stringify(f.atoms)}`);
}
if (findings.length > 40) console.log(`\n  ... and ${findings.length - 40} more`);

if (findings.length) {
  console.log('\nFAIL — atom-derived tohitBuff/damageBuff diverges from the bag. Fix before migrating the applier.');
  process.exit(1);
}
// Separate banner: the pin can fire on a clean corpus, and a reader who sees "diverges"
// above `diverge: 0` reaches for the wrong half of the gate.
if (n1PinFailures.length) {
  console.log('\nFAIL — the N=1 recovery roster moved. No divergence; see the [PIN] lines above.');
  process.exit(1);
}

// The Defiance arm above must GRADE something. Homecoming is the only fork that can
// carry the tag (Parse6 has no effect group to hang one on), so a zero there means the
// rejection stopped happening — the arm would then be waiving a class that no longer
// exists while reporting the same green as a corpus it actually checked.
if (!VACUOUS && DATASETS.includes('homecoming') && stats.defianceRejected === 0) {
  console.log('\nFAIL — no Defiance-only damageBuff found in homecoming. The reader-side '
    + 'rejection this gate grades has vanished; re-measure before trusting the green.');
  process.exit(1);
}
if (VACUOUS) {
  console.log(`\nVACUOUS — bag absent: ${stats.noBag} powers swept, 0 checks — vacuous post-data-gaps-327.`);
  console.log('   The atom side is graded by the converter gates, not here.');
} else {
  console.log('\nOK — atom-derived tohitBuff + damageBuff (scale + perTarget) reproduce the bag corpus-wide.');
}
