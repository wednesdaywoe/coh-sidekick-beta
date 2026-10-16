#!/usr/bin/env node
/**
 * audit-description-divergence.cjs — powers whose in-game description promises an effect the
 * planner's own data does not carry.
 *
 * REPORTS, never asserts. City of Heroes descriptions fall behind the powers they describe, and
 * a divergence is worth surfacing to a player (docs/gaps/sets-boosts-incarnates.md, data-gaps-2).
 * But the sentence "the description is wrong" is the same sentence a parse gap produces, so
 * nothing here decides anything: it hands candidates to a person, who adjudicates the way
 * data-gaps-2 was adjudicated and adds the survivor to src/data/description-notes.ts.
 *
 *   node scripts/audit-description-divergence.cjs [--dataset <id>]
 *
 * READ THE CONTRACT, NOT exported_powers. 340 Homecoming powers (350 on Brainstorm, 0 on the
 * forks) sit in exported_powers as a record with effect groups and zero templates — Burn,
 * Instant Healing, Grounded, Consume — and are filled in downstream. Sweeping the raw tree
 * reports every one of them as an effectless power that promises effects. The contract is also
 * the honest source on its own terms: it is what the planner shows, and the note is about what
 * the planner shows.
 *
 * What it declines, and why the decline list is measured rather than guessed: an effect can
 * arrive one hop away, through a summoned entity (`EntCreate` — Sanctuary of Light's protection
 * is on the patch it drops) or a mechanic power (`Meta` — Rebirth's Resolve). This sweep does
 * not follow the hop, so those are declined and COUNTED, not silently dropped. The first draft
 * guessed at `Summon|Redirect|GrantPower` and declined nothing, which is how both of them turned
 * up as candidates.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATASETS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'];

/** Mez sub-types carrying protection as a negative magnitude. `MezResist` is a different axis. */
const MEZ = /^(Held|Stunned|Sleep|Immobilized|Confused|Terrorized|Afraid)$/;
const KNOCK = /^(Knockback|Knockup|Repel)$/;

/**
 * The claim vocabulary, deliberately small. Every family here is one a description states in
 * words a regex can pin and the data answers with one atom shape. "Defense" and "resistance"
 * are not here: descriptions hedge them across allies, pets and conditions, and the false
 * positives would outnumber the findings.
 */
const FAMILIES = [
  { id: 'Status Protection', claim: /status protection|mez protection/i, sub: MEZ },
  { id: 'Knockback Protection', claim: /knockback protection|protection (from|against) knockback/i, sub: KNOCK },
];

/** Effect types whose payload lives in another record this sweep does not follow. */
const HOPS = /^(EntCreate|Meta|Redirect|GrantPower|ExecutePower)$/i;

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (f.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function powersIn(file) {
  let d;
  try {
    d = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
  const raw = Array.isArray(d) ? d : d.powers || Object.values(d);
  return (Array.isArray(raw) ? raw : []).filter((p) => p && p.internalName);
}

function sweepPowersets(dataset) {
  const dir = path.join(ROOT, 'contract', dataset, 'powersets');
  const found = [];
  let scanned = 0;
  let declined = 0;
  if (!fs.existsSync(dir)) return { found, scanned, declined, missing: true };
  for (const file of walk(dir)) {
    for (const pw of powersIn(file)) {
      scanned++;
      const help = `${pw.description || ''} ${pw.shortHelp || ''}`;
      const atoms = pw.atoms || [];
      const hops = atoms.some((a) => HOPS.test(String(a[0])));
      for (const fam of FAMILIES) {
        if (!fam.claim.test(help)) continue;
        const carried = atoms.some(
          (a) => String(a[0]) === 'Mez' && fam.sub.test(String(a[1])) && Number(a[2]) < 0,
        );
        if (carried) continue;
        if (hops) {
          declined++;
          continue;
        }
        found.push({ key: `power:${pw.internalName}`, name: pw.internalName, family: fam.id });
      }
    }
  }
  return { found, scanned, declined, missing: false };
}

/**
 * The incarnate blocks, which are their own namespace: the contract states a Hybrid as flat stat
 * layers rather than atoms, so the check is whether any layer carries a `prot*` key.
 */
function sweepHybrids(dataset) {
  const file = path.join(ROOT, 'contract', dataset, 'incarnate.json');
  const found = [];
  let scanned = 0;
  if (!fs.existsSync(file)) return { found, scanned, declined: 0, missing: true };
  const d = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const hybrids = d.hybridEffects || d.GENERATED_HYBRID_EFFECTS || {};
  // The catalog keys its powers by `internalName` (`Melee_Genome_8`) where the effect tables key
  // by a lowercased id, so the join is on the normalised name. It carries `shortHelp` only — the
  // long `display_help` never reaches the contract for incarnates — so the claim vocabulary here
  // is matched against the short line, which is narrower than the powerset leg gets.
  const catalogFile = path.join(ROOT, 'contract', dataset, 'incarnate-catalog.json');
  const help = new Map();
  if (fs.existsSync(catalogFile)) {
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf-8'));
    for (const slot of catalog.slots || []) {
      for (const pw of slot.powers || []) {
        help.set(String(pw.internalName || '').toLowerCase(), `${pw.shortHelp || ''} ${pw.displayName || ''}`);
      }
    }
  }
  if (help.size === 0) return { found, scanned: 0, declined: 0, missing: true };
  for (const [id, fx] of Object.entries(hybrids)) {
    scanned++;
    const text = help.get(id.toLowerCase()) || '';
    for (const fam of FAMILIES) {
      if (!fam.claim.test(text)) continue;
      const carried = [fx.passive, fx.frontLoaded, fx.perTarget].some((layer) =>
        Object.keys(layer || {}).some((k) => k.startsWith('prot')),
      );
      if (carried) continue;
      found.push({ key: `incarnate:${id}`, name: id, family: fam.id });
    }
  }
  return { found, scanned, declined: 0, missing: false };
}

function main() {
  const arg = process.argv.indexOf('--dataset');
  const only = arg >= 0 ? process.argv[arg + 1] : null;
  const report = {};
  for (const dataset of DATASETS) {
    if (only && dataset !== only) continue;
    const ps = sweepPowersets(dataset);
    const hy = sweepHybrids(dataset);
    report[dataset] = {
      candidates: [...ps.found, ...hy.found],
      scanned: ps.scanned + hy.scanned,
      declined: ps.declined,
      missing: ps.missing || hy.missing,
    };
  }
  for (const [dataset, r] of Object.entries(report)) {
    if (r.missing) {
      console.log(`\n== ${dataset}: no contract built — NOT SWEPT`);
      continue;
    }
    const uniq = [...new Map(r.candidates.map((c) => [`${c.key}|${c.family}`, c])).values()];
    console.log(
      `\n== ${dataset}: swept ${r.scanned}, ${uniq.length} candidate(s), ${r.declined} declined (effect may live one hop away)`,
    );
    for (const c of uniq) console.log(`   ${c.key}  promises ${c.family}, data carries none`);
  }
  console.log('\nCandidates are not findings. Adjudicate each the way data-gaps-2 was — census the');
  console.log('shape fork-wide and find a same-fork control — before adding it to');
  console.log('src/data/description-notes.ts.');
  return report;
}

if (require.main === module) main();
module.exports = { sweepPowersets, sweepHybrids, DATASETS };
