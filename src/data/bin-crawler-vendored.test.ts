import { describe, it, expect } from 'vitest';
import {
  REPO_ROOT,
  VENDOR_RECORD,
  fingerprintRepo,
  readVendorRecord,
  resolveCanonicalRepo,
} from '../../scripts/bin-crawler-fingerprint.mjs';

/**
 * Vendored-copy guard — the cross-repo currency gate.
 *
 * `tools/bin-crawler` and `exported_powers` live here because this repo ships
 * the crawler with the Sidekick tool suite, but `coh-sidekick-next` owns them.
 * `scripts/sync-bin-crawler.sh` copies them across and records what it copied in
 * `tools/bin-crawler-vendored.json`.
 *
 * The failure this exists to prevent has already happened once: HC-3's parser
 * decode landed in the canonical repo while this one kept a hardcoded stand-in,
 * and nothing went red — the export-staleness guard compares this repo's exports
 * against THIS repo's parser, so a copy that is uniformly twelve days behind is
 * perfectly self-consistent and perfectly stale.
 *
 * Two checks, because the copy can fall behind in two directions:
 *
 *   1. Edited HERE — the working tree stops matching the record. Runs anywhere,
 *      including CI, and needs nothing but this checkout. This is the hard one:
 *      it makes "just patch it locally, port it later" impossible to commit.
 *
 *   2. Moved on THERE — the canonical checkout no longer matches the record.
 *      Only runs on a machine that has both, which is where every one of these
 *      edits is actually made; skipped elsewhere rather than faked. That leaves
 *      a real hole (a machine with only this repo cannot know it is behind), and
 *      closing it properly means CI reading the canonical repo — which needs a
 *      token while that repo is private.
 *
 * Both digests come from `scripts/bin-crawler-fingerprint.mjs`, the same module
 * the sync script writes with, so the recorder and the checker cannot disagree
 * about the recipe.
 */

const record = readVendorRecord(REPO_ROOT);
const canonical = resolveCanonicalRepo();

const SYNC_HINT =
  'Run ./scripts/sync-bin-crawler.sh (it rewrites the record) and commit the result.';

describe('vendored bin-crawler guard (this repo ↔ coh-sidekick-next)', () => {
  it('carries a well-formed vendoring record', () => {
    expect(
      record,
      `Missing ${VENDOR_RECORD}. ${SYNC_HINT}`,
    ).not.toBeNull();
    expect(record!.schema).toBe('bin-crawler-vendored/1');
    expect(record!.synced_from_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(record!.tree_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(record!.export_manifest_digest).toMatch(/^[0-9a-f]{64}$/);
    // Ten stamps today: powers/tables/entities across three datasets, plus
    // salvage. A drop means an export tree arrived unstamped and the digest is
    // quietly covering less than it reads like it does.
    expect(record!.export_manifest_count).toBeGreaterThanOrEqual(10);
  });

  it('has an unmodified copy of tools/bin-crawler', () => {
    const here = fingerprintRepo(REPO_ROOT);
    expect(
      here.tree_fingerprint,
      `tools/bin-crawler in this repo does not match ${VENDOR_RECORD}. It is a VENDORED ` +
        `COPY — coh-sidekick-next is canonical. Move the change there, re-export there if ` +
        `it touched the parser, then re-sync. ${SYNC_HINT}`,
    ).toBe(record!.tree_fingerprint);
  });

  it('has the exports that were copied with it', () => {
    const here = fingerprintRepo(REPO_ROOT);
    expect(
      here.export_manifest_digest,
      `The exported_powers stamps in this repo do not match ${VENDOR_RECORD} — the parser ` +
        `copy and the export copy came from different syncs. ${SYNC_HINT}`,
    ).toBe(record!.export_manifest_digest);
  });

  const describeCrossRepo = canonical ? describe : describe.skip;
  describeCrossRepo('canonical checkout is present on this machine', () => {
    it('has not moved ahead of the vendored copy', () => {
      const there = fingerprintRepo(canonical!);
      expect(
        there.tree_fingerprint,
        `tools/bin-crawler in the canonical repo (${canonical}) has moved ahead of this ` +
          `copy, last synced from ${record!.synced_from_commit.slice(0, 10)} ` +
          `("${record!.synced_from_subject}"). ${SYNC_HINT}`,
      ).toBe(record!.tree_fingerprint);
      expect(
        there.export_manifest_digest,
        `exported_powers in the canonical repo (${canonical}) was re-exported after this ` +
          `copy was taken — the parser may be identical while the game data is not. ${SYNC_HINT}`,
      ).toBe(record!.export_manifest_digest);
    });
  });
});
