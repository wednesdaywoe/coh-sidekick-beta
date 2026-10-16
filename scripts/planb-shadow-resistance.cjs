/**
 * Plan B, Phase 2 Slice 3 — resistance reconstruction shadow (buff + self-penalty).
 *
 * Proves that the atom list reproduces the bag's per-damage-type +resistance BUFF
 * (`effects.resistance`) AND the self-directed −resistance PENALTY (the
 * `toWho:'Self'` entries of `effects.resistanceDebuff`) WITHOUT reading the bag —
 * the precondition for migrating those two appliers in character-totals.ts.
 *
 *   BAG   — `effects.resistance[type]` / `effects.resistanceDebuff[type]`, what the
 *           calc reads today. The buff's `{ scale, perTarget }` comes from
 *           `computeAoePerTargetPatches` (Bio Armor's Evolving Armor grows per foe).
 *   ATOMS — `resistanceBuffValue` / `resistanceSelfDebuffValue`: per-type, rebuilt
 *           from the base Resistance atoms (aspect Res), with perTarget from the
 *           converter-stamped increment atoms.
 *
 * Scope: the EIGHT standard damage-type resistance globals (Smashing…Psionic), the
 * only resistance types the calc totals. The atom bridge and the bag disagree on
 * how they LABEL every other subType (`All` from `base_defense`@Res → the bag routes
 * it to `debuffResistance`; exotic Radiation/Sonic/etc. the bag drops; `Heal` →
 * `HealResistance`) — but none of those reaches a `res<Type>` total, so both sides
 * add zero and comparing them would only measure a naming difference. See
 * `RESIST_STD_SUBTYPES` in atom-query.ts.
 *
 * Exit code is nonzero on any divergence — this GATES, like planb-shadow-pertarget.
 *
 * Usage:
 *   node scripts/planb-shadow-resistance.cjs
 *   node scripts/planb-shadow-resistance.cjs --dataset homecoming
 *   node scripts/planb-shadow-resistance.cjs --power "Evolving Armor"
 *
 * ARCHETYPE FORK: a slot the converter resolved across the whole roster reads as
 * `undefined` from the build-agnostic atom readers and populated in the bag. That is
 * not a divergence — it is checked, per archetype, through
 * `planb-shadow-sweep.forkResolvedViews`, and counted separately in the summary.
 */

require('tsx/cjs');
const fs = require('fs');
const path = require('path');
const { sweepDataset, forkResolvedAgrees } = require('./planb-shadow-sweep.cjs');
const { resistanceBuffValue, resistanceSelfDebuffValue } = require('../src/data/core/atom-query.ts');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const argVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const POWER_FILTER = argVal('--power');
const DATASETS = (() => {
  const picked = argv.flatMap((a, i) => (a === '--dataset' && argv[i + 1] ? [argv[i + 1]] : []));
  return picked.length ? picked : require('./_dataset-paths.cjs').ALL_DATASETS;
})();

const STD_TYPES = ['smashing', 'lethal', 'fire', 'cold', 'energy', 'negative', 'toxic', 'psionic'];
const r4 = (n) => Math.round((n || 0) * 1e4) / 1e4;

/** Normalize a bag buff slot value to `{ scale, perTarget }`. */
function bagBuff(v) {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return { scale: r4(Math.abs(v)), perTarget: 0 };
  return { scale: r4(Math.abs(v.scale)), perTarget: r4(v.perTarget) };
}
function atomBuff(v) {
  return v ? { scale: r4(Math.abs(v.scale)), perTarget: r4(v.perTarget) } : undefined;
}
const eqBuff = (a, b) => (!a && !b) || (a && b && a.scale === b.scale && a.perTarget === b.perTarget);

/** Bag self-penalty scale for a type (only the `toWho:'Self'` entry counts). */
function bagSelf(v) {
  if (!v || typeof v !== 'object' || v.toWho !== 'Self') return undefined;
  return r4(Math.abs(v.scale));
}
function atomSelf(v) {
  return v ? r4(Math.abs(v.scale)) : undefined;
}

const stats = { powers: 0, noBag: 0, buffTypes: 0, buffAgree: 0, forkResolved: 0, perTargetTypes: 0, selfTypes: 0,
  selfAgree: 0, selfRecovered: 0 };
const selfRecoveriesSeen = {};
const findings = [];

function checkPower(dataset, power, genPath) {
  const name = power.name || genPath;
  if (POWER_FILTER && !name.toLowerCase().includes(POWER_FILTER.toLowerCase())) return;
  stats.powers++;
  // data-gaps-327 (BPORT7) removed the bag this gate compares against; bag-less powers are vacuous rows, named in the tail.
  if (!power.effects || !Object.keys(power.effects).length) { stats.noBag++; return; }

  const bagRes = power.effects && typeof power.effects.resistance === 'object' ? power.effects.resistance : {};
  const bagDeb = power.effects && typeof power.effects.resistanceDebuff === 'object' ? power.effects.resistanceDebuff : {};
  const atomRes = resistanceBuffValue(power) || {};
  const atomDeb = resistanceSelfDebuffValue(power) || {};

  for (const t of STD_TYPES) {
    // --- BUFF ---
    const bag = bagBuff(bagRes[t]);
    const atom = atomBuff(atomRes[t]);
    if (bag || atom) {
      stats.buffTypes++;
      if ((bag && bag.perTarget) || (atom && atom.perTarget)) stats.perTargetTypes++;
      const agrees = eqBuff(bag, atom)
        // The build-agnostic reader abstains on an archetype-forked slot; ask each
        // archetype's resolved view instead (see `forkResolvedAgrees`).
        || (!atom && bag && forkResolvedAgrees(dataset, power, bag,
          (src) => atomBuff((resistanceBuffValue(src) || {})[t]), eqBuff));
      if (agrees) { stats.buffAgree++; stats.forkResolved += eqBuff(bag, atom) ? 0 : 1; }
      else {
        findings.push({ kind: 'buff', dataset, name, type: t, bag, atom });
        if (POWER_FILTER) console.log(`  [DIVERGE buff] ${name} ${t}  bag=${JSON.stringify(bag)} atom=${JSON.stringify(atom)}`);
      }
    }
    // --- SELF PENALTY ---
    const bagS = bagSelf(bagDeb[t]);
    const atomS = atomSelf(atomDeb[t]);
    if (bagS !== undefined || atomS !== undefined) {
      stats.selfTypes++;
      if (bagS === atomS) stats.selfAgree++;
      // Rest states its `-10 x Melee_Ones` resistance crash at `AnyAffected` on a `['Self']`
      // power, so the row is the caster's and the bag's recipient test — which reads the atom
      // alone — never wrote the slot. Resting leaves you with ~-1000% resistance, which is what
      // the power is for. Pinned by name so a second power joining this class gets adjudicated
      // rather than absorbed (data-gaps-63).
      else if (bagS === undefined && atomS !== undefined && name === 'Rest') {
        stats.selfRecovered++;
        selfRecoveriesSeen[`${dataset}|${name}`] = true;
      }
      else {
        findings.push({ kind: 'self', dataset, name, type: t, bag: bagS, atom: atomS });
        if (POWER_FILTER) console.log(`  [DIVERGE self] ${name} ${t}  bag=${bagS} atom=${atomS}`);
      }
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
// bag-derived recovery pin below is waived.
const VACUOUS = stats.powers > 0 && stats.noBag === stats.powers;

console.log(`\nPlan B Slice 3 — resistance reconstruction (buff + self-penalty)`);
console.log(`  powers swept:        ${stats.powers}`);
console.log(`  buff type-slots:     ${stats.buffTypes}  (of which per-target: ${stats.perTargetTypes})`);
console.log(`  buff agree:          ${stats.buffAgree}  (of which archetype-fork resolved: ${stats.forkResolved})`);
console.log(`  self type-slots:     ${stats.selfTypes}`);
console.log(`  self agree:          ${stats.selfAgree}`);
console.log(`  self recovered:      ${stats.selfRecovered}  (Rest's AnyAffected crash, dropped by the bag's recipient test — data-gaps-63)`);
// Both ways: a fork that stopped recovering Rest's crash is the join regressing, and this
// gate would otherwise read the silence as agreement.
const EXPECTED_SELF_RECOVERIES = ['homecoming|Rest', 'rebirth|Rest', 'thunderspy|Rest', 'brainstorm|Rest'];
const recoveryPinFailures = VACUOUS ? [] : [
  ...Object.keys(selfRecoveriesSeen).filter((k) => !EXPECTED_SELF_RECOVERIES.includes(k))
    .map((k) => `NEW self recovery, never read: ${k}`),
  // Only datasets this run swept can be reported lost. Without the guard a single-dataset
  // invocation fails on every fork it was never asked to look at.
  ...EXPECTED_SELF_RECOVERIES.filter((k) => DATASETS.includes(k.split('|')[0]) && !selfRecoveriesSeen[k])
    .map((k) => `LOST self recovery: ${k} — the caster's crash is being dropped again`),
];
for (const line of recoveryPinFailures) console.log(`  [PIN] ${line}`);
console.log(`  diverge:             ${findings.length}`);

for (const f of findings.slice(0, 50)) {
  console.log(`\n  [DIVERGE ${f.kind}] ${f.name} (${f.dataset}) ${f.type}`);
  console.log(`      bag  : ${JSON.stringify(f.bag)}`);
  console.log(`      atom : ${JSON.stringify(f.atom)}`);
}
if (findings.length > 50) console.log(`\n  ... and ${findings.length - 50} more`);

if (findings.length) {
  console.log('\nFAIL — atom-derived resistance diverges from the bag. Fix before migrating the applier.');
  process.exit(1);
}
// Separate banner: the pin can fire on a clean corpus, and a reader who sees "diverges"
// above `diverge: 0` reaches for the wrong half of the gate.
if (recoveryPinFailures.length) {
  console.log('\nFAIL — the self-recovery roster moved. No divergence; see the [PIN] lines above.');
  process.exit(1);
}
if (VACUOUS) {
  console.log(`\nVACUOUS — bag absent: ${stats.noBag} powers swept, 0 checks — vacuous post-data-gaps-327.`);
  console.log('   The atom side is graded by the converter gates, not here.');
} else {
  console.log('\nOK — atom-derived resistance buff + self-penalty reproduce the bag corpus-wide (8 standard types).');
}
