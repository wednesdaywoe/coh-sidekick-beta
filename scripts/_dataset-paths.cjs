/**
 * Shared CLI/path helper for the conversion scripts in this folder.
 *
 * Each script writes generated TypeScript into `src/data/`. As individual
 * data files migrate into `src/data/datasets/<id>/`, the script that
 * regenerates them needs to route to the dataset folder instead of the
 * legacy path (otherwise it clobbers the runtime facade with raw data).
 *
 * Usage:
 *
 *     const { parseDatasetArg, datasetPath, dataPath } = require('./_dataset-paths.cjs');
 *     const datasetId = parseDatasetArg();          // "homecoming" by default
 *     const atTablesOut = datasetPath(datasetId, 'at-tables.ts');
 *     const legacyOut   = dataPath('io-sets-raw.ts');
 *
 * The `--dataset <id>` flag is recognized in `process.argv`. If absent,
 * defaults to `'homecoming'` so existing muscle memory keeps working.
 *
 * `datasetPath` is for files that have ALREADY moved into the dataset
 * folder (per MULTI_DATASET_PLAN.md). `dataPath` is for files that
 * haven't migrated yet — when they migrate, switch their generator over
 * to `datasetPath`.
 */

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Every dataset the pipeline builds, in regen order. The single source — the roster
 * was copy-pasted across ~25 scripts, and a paste is how a new dataset gets converted
 * by some of them and silently skipped by the rest (the deductive-schema-harness-8 Clarion-leak shape).
 *
 * `brainstorm` is Homecoming's open beta (the Brainstorm server), a first-class shipping
 * dataset rather than a ring Homecoming reads. It trails HC's content by one release
 * cycle in the other direction: it holds what live is ABOUT to get.
 *
 * Adding a name here does NOT finish the job. A site keyed BY dataset name — an
 * expected-count table, a per-fork floor — keeps its old keys and goes quiet on the
 * new one rather than failing. `scripts/audit-dataset-roster.cjs` is the census that
 * finds those.
 */
const ALL_DATASETS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'];

const KNOWN_DATASETS = new Set(ALL_DATASETS);

/**
 * Read `--dataset <id>` (or `--dataset=<id>`) from argv. Returns the id
 * or `'homecoming'` if no flag was provided.
 */
function parseDatasetArg(argv = process.argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset' && i + 1 < argv.length) return validate(argv[i + 1]);
    if (a.startsWith('--dataset=')) return validate(a.slice('--dataset='.length));
  }
  return 'homecoming';
}

function validate(id) {
  if (!KNOWN_DATASETS.has(id)) {
    throw new Error(
      `Unknown dataset "${id}". Known: ${[...KNOWN_DATASETS].join(', ')}. ` +
      `Add it to KNOWN_DATASETS in scripts/_dataset-paths.cjs first.`,
    );
  }
  return id;
}

/**
 * Resolve a path under `src/data/datasets/<id>/`. Use this for files that
 * have already migrated into the per-dataset folder.
 */
function datasetPath(datasetId, ...sub) {
  return path.join(REPO_ROOT, 'src', 'data', 'datasets', datasetId, ...sub);
}

/**
 * Resolve a path under `src/data/` directly. Use this for files that
 * haven't migrated yet — when they do, switch to `datasetPath` and the
 * facade at the original path will continue to work.
 */
function dataPath(...sub) {
  return path.join(REPO_ROOT, 'src', 'data', ...sub);
}

module.exports = {
  ALL_DATASETS,
  parseDatasetArg,
  datasetPath,
  dataPath,
  REPO_ROOT,
};
