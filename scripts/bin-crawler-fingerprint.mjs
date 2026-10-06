/**
 * Vendored-copy fingerprints for `tools/bin-crawler` + `exported_powers`.
 *
 * This repo SHIPS the bin crawler as part of the Sidekick tool suite, but does
 * not own it: `coh-sidekick-experiment` is canonical for both the parser and the
 * exports it produces. What lives here is a vendored copy, refreshed by
 * `scripts/sync-bin-crawler.sh` and recorded in `tools/bin-crawler-vendored.json`.
 *
 * The sync script and the guard (`src/data/bin-crawler-vendored.test.ts`) both
 * call into THIS module rather than each implementing the hash. The existing
 * export-staleness guard has to mirror `_export_fingerprint.py` by hand and
 * carries a warning about that dual implementation; here there is only one, so
 * the two sides cannot silently drift apart.
 *
 * Two digests, covering the two ways the copy can fall behind:
 *
 *   tree_fingerprint        — every file under `tools/bin-crawler`. Catches a
 *                             parser/exporter edit, in either repo.
 *   export_manifest_digest  — the ten `_export_manifest.json` stamps under
 *                             `exported_powers`. Catches a re-export that the
 *                             tree fingerprint cannot see: an HC game patch
 *                             changes the .pigg data and therefore the exported
 *                             JSON, while the parser source stays byte-identical.
 *                             Ten small files instead of hashing 55,749.
 *
 * Run directly to inspect or to write the record:
 *
 *   node scripts/bin-crawler-fingerprint.mjs                    # this repo
 *   node scripts/bin-crawler-fingerprint.mjs <repo-root>        # another
 *   node scripts/bin-crawler-fingerprint.mjs --write-record --canonical <path>
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The paths the sync mirrors, repo-relative. Order is the archive order. */
export const SYNCED_PATHS = ['tools/bin-crawler', 'exported_powers'];

/** Where the sync records what it copied and from which canonical commit. */
export const VENDOR_RECORD = 'tools/bin-crawler-vendored.json';

export const CANONICAL_REMOTE = 'git@github.com:wednesdaywoe/coh-sidekick-rebuild.git';

/**
 * The COMMITTED files under `relDir`, as absolute paths.
 *
 * Tracked-only, via git, rather than a filesystem walk: the vendored copy is
 * what this repo ships, and a dev machine's bin-crawler directory also holds
 * things that are emphatically not part of it — `__pycache__`, and a gitignored
 * `tools/bin-crawler/exported_powers/` scratch dir that a local export run
 * leaves behind (100 MB of it here, absent in the canonical checkout, which
 * would make the two structurally incomparable forever).
 *
 * Enumerating this way also means the digest never depends on which local
 * exports a machine happens to have run.
 */
function trackedFiles(repoRoot, relDir) {
  let out;
  try {
    out = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', '--', relDir], {
      encoding: 'utf-8',
      maxBuffer: 1 << 28,
    });
  } catch (e) {
    throw new Error(`cannot list tracked files under ${relDir} in ${repoRoot} — ` +
                    `is it a git checkout? (${e.message})`);
  }
  const files = out.split('\0').filter(Boolean);
  if (files.length === 0) throw new Error(`no tracked files under ${relDir} in ${repoRoot}`);
  return files.map((p) => join(repoRoot, p));
}

/**
 * sha256 over a set of files as sorted `posix-relpath\0bytes\0` records — the
 * same recipe the export manifests use, so the two digests read alike.
 * `base` is what relative paths are taken from, so a digest is comparable
 * across two checkouts sitting at different absolute paths.
 */
function foldFiles(files, base) {
  const entries = files
    .map((f) => {
      const rel = relative(base, f).split('\\').join('/');
      if (!existsSync(f)) {
        throw new Error(`${rel} is tracked but missing from the working tree — ` +
                        `a partial sync? Re-run scripts/sync-bin-crawler.sh.`);
      }
      return { rel, bytes: readFileSync(f) };
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const h = createHash('sha256');
  for (const e of entries) {
    h.update(e.rel, 'utf-8');
    h.update(Buffer.from([0]));
    h.update(e.bytes);
    h.update(Buffer.from([0]));
  }
  return h.digest('hex');
}

/** sha256 of every committed file under `<repoRoot>/tools/bin-crawler`. */
export function treeFingerprint(repoRoot) {
  const root = join(repoRoot, 'tools', 'bin-crawler');
  if (!existsSync(root)) throw new Error(`no tools/bin-crawler under ${repoRoot}`);
  return foldFiles(trackedFiles(repoRoot, 'tools/bin-crawler'), root);
}

/**
 * sha256 of the export stamps under `<repoRoot>/exported_powers`.
 *
 * Only the exporter-written `_export_manifest.json` / `salvage_export_manifest.json`
 * stamps count. `thunderspy/.../telekinetic_assault/manifest.json` is powerset
 * content, not a stamp, and is deliberately not matched.
 */
export function exportManifestDigest(repoRoot) {
  const root = join(repoRoot, 'exported_powers');
  if (!existsSync(root)) throw new Error(`no exported_powers under ${repoRoot}`);
  const stamps = trackedFiles(repoRoot, 'exported_powers').filter((f) => {
    const name = f.split(/[\\/]/).pop();
    return name === '_export_manifest.json' || name === 'salvage_export_manifest.json';
  });
  if (stamps.length === 0) {
    throw new Error(`no _export_manifest.json stamps under ${root} — unstamped export tree?`);
  }
  return { digest: foldFiles(stamps, root), count: stamps.length };
}

/** Both digests for a checkout, plus the stamp count for the failure message. */
export function fingerprintRepo(repoRoot) {
  const { digest, count } = exportManifestDigest(repoRoot);
  return {
    tree_fingerprint: treeFingerprint(repoRoot),
    export_manifest_digest: digest,
    export_manifest_count: count,
  };
}

/**
 * Where the canonical checkout lives on THIS machine, or null.
 *
 * Explicit env var first (the two dev machines shelve it differently), then the
 * conventional sibling directory. A path only counts if it actually carries
 * both synced paths, so a half-made directory reads as absent rather than as a
 * broken canonical.
 */
export function resolveCanonicalRepo(explicit) {
  const candidates = [
    explicit,
    process.env.SIDEKICK_CANONICAL_REPO,
    resolve(REPO_ROOT, '..', 'coh-sidekick-experiment'),
  ].filter(Boolean);
  for (const c of candidates) {
    const p = resolve(c);
    if (SYNCED_PATHS.every((rel) => existsSync(join(p, rel)))) return p;
  }
  return null;
}

/** `{ commit, subject, date }` of the canonical checkout's HEAD. */
export function canonicalHead(repoRoot) {
  const out = execFileSync('git', ['-C', repoRoot, 'log', '-1', '--format=%H%n%s%n%cI'], {
    encoding: 'utf-8',
  }).split('\n');
  return { commit: out[0], subject: out[1], date: out[2] };
}

/** Read the committed vendoring record, or null when this repo has none yet. */
export function readVendorRecord(repoRoot = REPO_ROOT) {
  const path = join(repoRoot, VENDOR_RECORD);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Write the record describing the copy now sitting in THIS repo. Digests are
 * taken from this repo (post-extract), provenance from the canonical checkout —
 * so a record that disagrees with either side is itself the failure signal.
 */
export function writeVendorRecord(canonicalPath, repoRoot = REPO_ROOT) {
  const head = canonicalHead(canonicalPath);
  const record = {
    schema: 'bin-crawler-vendored/1',
    note:
      'tools/bin-crawler and exported_powers are a VENDORED COPY. coh-sidekick-experiment ' +
      'is canonical for both — edit the parser there, re-export there, then run ' +
      'scripts/sync-bin-crawler.sh here. Do not hand-edit either path in this repo; ' +
      'src/data/bin-crawler-vendored.test.ts will catch it.',
    canonical_repo: CANONICAL_REMOTE,
    synced_paths: SYNCED_PATHS,
    synced_from_commit: head.commit,
    synced_from_subject: head.subject,
    synced_from_date: head.date,
    ...fingerprintRepo(repoRoot),
  };
  writeFileSync(join(repoRoot, VENDOR_RECORD), JSON.stringify(record, null, 2) + '\n');
  return record;
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--write-record')) {
    const canonical = resolveCanonicalRepo(argv[argv.indexOf('--canonical') + 1]);
    if (!canonical) {
      console.error('cannot locate the canonical checkout — pass --canonical <path>');
      process.exit(1);
    }
    const record = writeVendorRecord(canonical);
    console.log(`${VENDOR_RECORD} written: ${record.synced_from_commit.slice(0, 10)} ` +
                `tree ${record.tree_fingerprint.slice(0, 12)} ` +
                `stamps ${record.export_manifest_digest.slice(0, 12)} (${record.export_manifest_count})`);
  } else {
    const root = argv[0] ? resolve(argv[0]) : REPO_ROOT;
    console.log(JSON.stringify({ repo: root, ...fingerprintRepo(root) }, null, 2));
  }
}
