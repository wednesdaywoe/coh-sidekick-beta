/**
 * Batch Powerset Conversion Script
 *
 * Converts ALL raw Homecoming power data to the new modular structure.
 * Usage: node scripts/convert-all-powersets.cjs [--force]
 *   --force  Reconvert even if output directory already exists
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseDatasetArg } = require('./_dataset-paths.cjs');

// CATEGORY_MAP is the single raw-category → archetype/type routing table; the
// per-powerset converter owns it and this orchestrator only iterates it.
const { RAW_DATA_PATH, CATEGORY_MAP } = require('./convert-powerset.cjs');

const datasetId = parseDatasetArg();
// Forward `--dataset <id>` to each child convert-powerset.cjs invocation
// so the per-powerset converter writes into the same dataset folder.
const datasetFlag = `--dataset ${datasetId}`;

const force = process.argv.includes('--force');


let converted = 0;
let failed = 0;
let skipped = 0;
const errors = [];

// Where the per-powerset converter's COMPOSED output lands, and the suffix this
// script stages a previous copy under while the child regenerates it.
const POWERSETS_ROOT = `./src/data/datasets/${datasetId}/powersets`;
const STAGED_SUFFIX = '.regen-prev';

/**
 * Reconcile any staging directory a previous run left behind.
 *
 * Staging is only ever transient: each one is removed on success or renamed
 * back on failure. A leftover therefore means the process died between the two
 * — a SIGKILL, a lost terminal — and which copy is authoritative depends on
 * whether the child got far enough to recreate the live directory:
 *
 *   live present  → the child finished; the staged copy is the superseded one.
 *   live absent   → the staged copy is the ONLY copy. Deleting it here would be
 *                   data-gaps-317 again, committed by the very code meant to prevent it.
 *
 * Runs before the conversion loop so a leftover can never reach
 * `generate-powerset-index.cjs`, which indexes any directory holding an
 * `index.ts` and would otherwise publish the staged copy as a second powerset.
 */
function reclaimStagedOutput(root) {
  if (!fs.existsSync(root)) return;
  for (const archetype of fs.readdirSync(root)) {
    const archetypePath = path.join(root, archetype);
    if (!fs.statSync(archetypePath).isDirectory()) continue;
    for (const type of fs.readdirSync(archetypePath)) {
      const typePath = path.join(archetypePath, type);
      if (!fs.statSync(typePath).isDirectory()) continue;
      for (const entry of fs.readdirSync(typePath)) {
        if (!entry.endsWith(STAGED_SUFFIX)) continue;
        const staged = path.join(typePath, entry);
        const live = staged.slice(0, -STAGED_SUFFIX.length);
        if (fs.existsSync(live)) {
          fs.rmSync(staged, { recursive: true, force: true });
          console.log(`  [RECLAIM] discarded superseded ${staged}`);
        } else {
          fs.renameSync(staged, live);
          console.log(`  [RECLAIM] restored ${live} from an interrupted run`);
        }
      }
    }
  }
}

console.log(`=== Batch Powerset Conversion${force ? ' (FORCE)' : ''} ===\n`);

reclaimStagedOutput(POWERSETS_ROOT);

// Bin export writes categories at <RAW_DATA_PATH>/<category>/.
// Old CoD2 layout had an extra `powers/` segment. Probe both.
const powersPath = (() => {
  const newLayout = RAW_DATA_PATH;  // categories are direct children
  const oldLayout = path.join(RAW_DATA_PATH, 'powers');
  // Detect by checking for any known category directory
  for (const cat of Object.keys(CATEGORY_MAP)) {
    if (fs.existsSync(path.join(newLayout, cat))) return newLayout;
    if (fs.existsSync(path.join(oldLayout, cat))) return oldLayout;
  }
  return newLayout;
})();

for (const [category, info] of Object.entries(CATEGORY_MAP)) {
  const categoryPath = path.join(powersPath, category);

  if (!fs.existsSync(categoryPath)) {
    // console.log(`[SKIP] Category not found: ${category}`);
    continue;
  }

  const powersets = fs.readdirSync(categoryPath)
    .filter(item => {
      const itemPath = path.join(categoryPath, item);
      return fs.statSync(itemPath).isDirectory();
    });

  console.log(`\n--- ${category} (${powersets.length} powersets) ---`);

  for (const powerset of powersets) {
    // Output dir matches the per-powerset converter's destination so the
    // [EXISTS] / --force / staging checks all line up with the actual write
    // path. All datasets write under `src/data/datasets/<id>/powersets/...`.
    const outputDir = `${POWERSETS_ROOT}/${info.archetype}/${info.type}/${powerset.replace(/_/g, '-')}`;

    // Check if already converted (skip unless --force)
    if (!force && fs.existsSync(outputDir) && fs.existsSync(path.join(outputDir, 'index.ts'))) {
      console.log(`  [EXISTS] ${info.archetype}/${powerset}`);
      skipped++;
      continue;
    }

    // Stage the previous output aside rather than deleting it: the child writes
    // a fresh directory, and only a child that SUCCEEDED gets to make its
    // absence permanent. Deleting first is what turned a transient child death
    // — a throw, or the 30s timeout below under load — into ten missing files
    // (Homecoming's Sentinel Willpower, data-gaps-317, 2026-08-10). Exiting 1 made
    // that loss loud; staging makes it not happen.
    const staged = force && fs.existsSync(outputDir) ? `${outputDir}${STAGED_SUFFIX}` : null;
    if (staged) {
      fs.rmSync(staged, { recursive: true, force: true });
      fs.renameSync(outputDir, staged);
    }

    try {
      console.log(`  [CONVERT] ${category}/${powerset} -> ${info.archetype}/${info.type}/${powerset}`);
      execSync(`node scripts/convert-powerset.cjs ${category} ${powerset} ${datasetFlag}`, {
        // Child stdout is the per-power listing (thousands of lines); its stderr is the
        // converter's warning path — a record it read but could not use. Piping BOTH made every
        // such warning vanish from the batch run that regen actually uses.
        stdio: ['ignore', 'pipe', 'inherit'],
        timeout: 30000
      });
      if (staged) fs.rmSync(staged, { recursive: true, force: true });
      converted++;
    } catch (err) {
      // Put the previous output back. A failed regen leaves the tree as it
      // found it, so `git status` reports the failure alone rather than a
      // deletion the run's own error message has to be trusted to explain.
      if (staged) {
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.renameSync(staged, outputDir);
      }
      const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
      console.log(`  [ERROR] ${category}/${powerset}: ${stderr.split('\n')[0]}`);
      errors.push({ category, powerset, error: stderr });
      failed++;
    }
  }
}

console.log('\n=== Summary ===');
console.log(`Converted: ${converted}`);
console.log(`Skipped (already exists): ${skipped}`);
console.log(`Failed: ${failed}`);

if (errors.length > 0) {
  console.log('\n=== Errors ===');
  for (const e of errors) {
    console.log(`  ${e.category}/${e.powerset}: ${e.error.split('\n')[0]}`);
  }
}

// Reporting a failed child as success is how Homecoming's Sentinel Willpower left
// the tree with a green `npm run regen` (2026-08-10): ten files gone, the run's
// exit code 0, and nothing downstream noticing until an import failed hours later.
// The staging above means the previous output survives, so this is no longer a
// data-loss alarm — but a regen that could not convert a powerset has not
// regenerated it, and the tree is now a mix of fresh and stale. That is exactly
// the staleness the regen-and-diff guard exists to catch, and it can only catch it
// if the run says so.
if (failed > 0) {
  console.error(
    `\nconvert-all-powersets: ${failed} powerset(s) failed to convert. Their previous output `
      + 'was restored, so the tree is a MIX of freshly-converted and stale powersets.',
  );
  process.exit(1);
}
