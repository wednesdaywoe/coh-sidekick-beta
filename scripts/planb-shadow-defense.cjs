/**
 * Plan B, Phase 2 Slice 4 — defense reconstruction shadow (buff + suppressible).
 *
 * Proves the atom list reproduces the bag's two per-position/type +defense slots
 * WITHOUT reading the bag — the precondition for migrating both defense appliers
 * in character-totals.ts:
 *
 *   BAG   — `effects.defenseBuff[type]` (always on) and
 *           `effects.defenseBuffSuppressible[type]` (dropped in combat), what the
 *           calc reads today. Their `{ scale, perTarget }` comes from
 *           `computeAoePerTargetPatches` (Invincibility's +Def grows per foe).
 *   ATOMS — `defenseBuffValue` / `defenseBuffSuppressibleValue`: per-type, rebuilt
 *           from the base `Defense` atoms, split on the converter-stamped
 *           `suppressible` flag (`_suppressedByEvents || _combatGated`) — the exact
 *           discriminator the bag's two slots encode.
 *
 * This slice is the FIRST that needed a converter change to make the atom list
 * complete: until the `suppressible` stamp, Hide's always-on +0.25 and its
 * combat-suppressed +0.5 defense were byte-identical on the wire (same PvE/Self/
 * table, differing only in scale), so the split was unrecoverable. The stamp is
 * what this shadow guards.
 *
 * Scope: the ELEVEN standard defense globals — the three positions (Melee/Ranged/
 * AoE) and eight damage types (Smashing…Psionic), the only defense types the calc
 * totals. `All` (from a `base_defense` template) is one value on all eleven, and
 * since data-gaps-197 the atom readers expand it so. The bag cannot: it stores such a
 * row as a SCALAR ScaledEffect (`{scale, table}`, never a `def<Type>` key). That
 * is a GRADED divergence, not an excused one — `expandScalarAll` rewrites the bag
 * slot by the same stated rule (the scalar's value must appear on all eleven keys)
 * and the comparison stays exact, so only the DECISION to expand is exempt from
 * the shadow; the values are not. A bag slot that mixes a scalar with typed keys
 * fits neither shape and fails loudly. See `DEFENSE_STD_SUBTYPES` in atom-query.ts.
 *
 * Exit code is nonzero on any divergence — this GATES, like planb-shadow-resistance.
 *
 * Usage:
 *   node scripts/planb-shadow-defense.cjs
 *   node scripts/planb-shadow-defense.cjs --dataset homecoming
 *   node scripts/planb-shadow-defense.cjs --power "Hide"
 *
 * ARCHETYPE FORK: a slot the converter resolved across the whole roster reads as
 * `undefined` from the build-agnostic atom readers and populated in the bag. That is
 * not a divergence — it is checked, per archetype, through
 * `planb-shadow-sweep.forkResolvedViews`, and counted separately in the summary.
 *
 * TEAM-ONLY: the other deliberate silence, and the one place this shadow's premise
 * stops holding. Grant Cover's defense rows are aimed at the team and carry the
 * `target != source` clause, so the atom reader declines them for the caster while the
 * bag keeps the slot — the power card still shows allies what they receive. That is
 * atoms saying MORE than the bag, not less, and equality would be the bug. Counted
 * separately, and narrowed by `defenseBuffIsTeamOnly` so it can only excuse a power
 * whose every defense row says so. See data-gaps-222.
 */

require('tsx/cjs');
const fs = require('fs');
const path = require('path');
const { sweepDataset, forkResolvedAgrees } = require('./planb-shadow-sweep.cjs');
const { defenseBuffValue, defenseBuffSuppressibleValue, defenseBuffIsTeamOnly } = require('../src/data/core/atom-query.ts');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const POWER_FILTER = argVal('--power');
const DATASETS = (() => {
  const picked = argv.flatMap((a, i) => (a === '--dataset' && argv[i + 1] ? [argv[i + 1]] : []));
  return picked.length ? picked : require('./_dataset-paths.cjs').ALL_DATASETS;
})();

// The 11 standard defense globals (positions + damage types), lowercase-keyed as
// the bag and the atom helpers emit them.
const STD_TYPES = [
  'melee', 'ranged', 'aoe',
  'smashing', 'lethal', 'fire', 'cold', 'energy', 'negative', 'toxic', 'psionic',
];
const r4 = (n) => Math.round((n || 0) * 1e4) / 1e4;

/**
 * A reconstructed defense of exactly 0 with no per-target growth contributes 0 to
 * every total, so it is behaviourally ABSENT — treat it as `undefined`. The bag is
 * inconsistent here (Thunderspy Fortify Pack's pet-granted defense yields an empty
 * `effects` bag, while Rebirth's Fortify Pack and Thunderspy Superior Invisibility
 * keep a `{scale:0}` entry), and `defenseBuffValue` drops such entries. Comparing
 * "what survives to a total" (the resistance-slice doctrine) collapses that
 * incidental difference; a genuine mismatch (one side 0, the other non-zero) still
 * shows as present-vs-absent and is caught. */
const nz = (o) => (o && o.scale === 0 && !o.perTarget ? undefined : o);

/** Normalize a bag defense slot value to `{ scale, perTarget }` (scalar or ScaledEffect). */
function bagVal(v) {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return nz({ scale: r4(Math.abs(v)), perTarget: 0 });
  if (typeof v !== 'object') return undefined;
  return nz({ scale: r4(Math.abs(v.scale)), perTarget: r4(v.perTarget) });
}
function atomVal(v) {
  return v ? nz({ scale: r4(Math.abs(v.scale)), perTarget: r4(v.perTarget) }) : undefined;
}
const eq = (a, b) => (!a && !b) || (a && b && a.scale === b.scale && a.perTarget === b.perTarget);

const stats = {
  powers: 0,
  noBag: 0,
  buffTypes: 0, buffAgree: 0, buffPerTarget: 0, buffForkResolved: 0, buffTeamOnly: 0,
  suppTypes: 0, suppAgree: 0, suppPerTarget: 0, scalarAllExpanded: 0,
};
const findings = [];

/**
 * The data-gaps-197 graded divergence: a bag defense slot holding a `base_defense` row is
 * a SCALAR ScaledEffect (`{scale, table}`), while the atom readers expand that row
 * onto all eleven standard keys. Rewrite the bag by the same stated rule — the
 * scalar's value on every key — so the per-type comparison stays exact. Only the
 * decision to expand is exempt from the shadow; the values are not (each of the
 * eleven must still match the atom side, both directions). A slot carrying BOTH a
 * scalar `scale` and a `def<Type>` key fits neither the scalar nor the typed shape,
 * so it fails loudly rather than being half-expanded.
 */
function expandScalarAll(name, slot) {
  if (typeof slot?.scale !== 'number') return slot; // typed (or absent) — untouched
  if (STD_TYPES.some((t) => t in slot)) {
    throw new Error(
      `planb-shadow-defense: '${name}' bag defense slot mixes a scalar with typed keys ` +
      `(${Object.keys(slot).join(',')}) — neither shape's rule covers it`,
    );
  }
  stats.scalarAllExpanded++;
  return Object.fromEntries(STD_TYPES.map((t) => [t, slot]));
}

function checkPower(dataset, power, genPath) {
  const name = power.name || genPath;
  if (POWER_FILTER && !name.toLowerCase().includes(POWER_FILTER.toLowerCase())) return;
  stats.powers++;
  // data-gaps-327 (BPORT7) removed the bag this gate compares against; bag-less powers are vacuous rows, named in the tail.
  if (!power.effects || !Object.keys(power.effects).length) { stats.noBag++; return; }
  const eff = power.effects || {};
  const bagBuff = expandScalarAll(name, typeof eff.defenseBuff === 'object' ? eff.defenseBuff : {});
  const bagSupp = expandScalarAll(name, typeof eff.defenseBuffSuppressible === 'object' ? eff.defenseBuffSuppressible : {});
  const atomBuff = defenseBuffValue(power) || {};
  const atomSupp = defenseBuffSuppressibleValue(power) || {};

  for (const t of STD_TYPES) {
    const bag = bagVal(bagBuff[t]);
    const atom = atomVal(atomBuff[t]);
    if (bag || atom) {
      stats.buffTypes++;
      if ((bag && bag.perTarget) || (atom && atom.perTarget)) stats.buffPerTarget++;
      // The build-agnostic reader abstains on an archetype-forked slot; ask each
      // archetype's resolved view instead (see `forkResolvedAgrees`).
      if (eq(bag, atom)) stats.buffAgree++;
      else if (!atom && bag && defenseBuffIsTeamOnly(power)) {
        stats.buffAgree++;
        stats.buffTeamOnly++;
      } else if (!atom && bag && forkResolvedAgrees(dataset, power, bag,
        (src) => atomVal((defenseBuffValue(src) || {})[t]), eq)) {
        stats.buffAgree++;
        stats.buffForkResolved++;
      } else findings.push({ kind: 'buff', dataset, name, type: t, bag, atom });
    }
    const bagS = bagVal(bagSupp[t]);
    const atomS = atomVal(atomSupp[t]);
    if (bagS || atomS) {
      stats.suppTypes++;
      if ((bagS && bagS.perTarget) || (atomS && atomS.perTarget)) stats.suppPerTarget++;
      if (eq(bagS, atomS)) stats.suppAgree++;
      else findings.push({ kind: 'suppressible', dataset, name, type: t, bag: bagS, atom: atomS });
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

console.log(`\nPlan B Slice 4 — defense reconstruction (buff + suppressible)`);
console.log(`  powers swept:        ${stats.powers}`);
console.log(`  buff type-slots:     ${stats.buffTypes}  (of which per-target: ${stats.buffPerTarget})`);
console.log(`  buff agree:          ${stats.buffAgree}  (archetype-fork resolved: ${stats.buffForkResolved}; team-only abstentions: ${stats.buffTeamOnly})`);
console.log(`  suppress type-slots: ${stats.suppTypes}  (of which per-target: ${stats.suppPerTarget})`);
console.log(`  suppress agree:      ${stats.suppAgree}`);
console.log(`  scalar-All expanded: ${stats.scalarAllExpanded}  (data-gaps-197 graded divergence: bag base_defense scalar → 11 keys)`);
console.log(`  diverge:             ${findings.length}`);

for (const f of findings.slice(0, 50)) {
  console.log(`\n  [DIVERGE ${f.kind}] ${f.name} (${f.dataset}) ${f.type}`);
  console.log(`      bag  : ${JSON.stringify(f.bag)}`);
  console.log(`      atom : ${JSON.stringify(f.atom)}`);
}
if (findings.length > 50) console.log(`\n  ... and ${findings.length - 50} more`);

if (findings.length) {
  console.log('\nFAIL — atom-derived defense diverges from the bag. Fix before migrating the applier.');
  process.exit(1);
}
if (VACUOUS) {
  console.log(`\nVACUOUS — bag absent: ${stats.noBag} powers swept, 0 checks — vacuous post-data-gaps-327.`);
  console.log('   The atom side is graded by the converter gates, not here.');
} else {
  console.log('\nOK — atom-derived defense buff + suppressible reproduce the bag corpus-wide (11 standard globals).');
}
