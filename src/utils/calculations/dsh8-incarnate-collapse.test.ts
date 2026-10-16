import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * deductive-schema-harness-8 — regression guard for the incarnate collapse detector
 * (`scripts/dsh8-incarnate-collapse-detector.cjs`). It sweeps the Hybrid + Destiny
 * buff slots per dataset, keying INPUT by the deductive-schema-harness-4 bridge (`ingestExportPower`) and
 * OUTPUT by the generated `incarnate-effects.ts`, and flags a "class-present,
 * sibling-missing" multi-type collapse (the Support Core defense drop's shape).
 *
 * This asserts the gate stays at ZERO high-confidence collapses across all three
 * datasets — so a future incarnate-converter or bridge change that re-drops a buff
 * sibling fails here. Non-gating class-absent rows are tracked as coverage
 * residuals, not collapse defects.
 *
 * See streams/DEDUCTIVE_SCHEMA_HARNESS.md (deductive-schema-harness-8).
 */

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const DETECTOR = path.join(REPO, 'scripts', 'dsh8-incarnate-collapse-detector.cjs');

function runDetector(dataset: string): { collapses: number; groups: number; checked: number } {
  // Redirect the detector's worklist side-effect file to tmp — this gate reads
  // stdout only, and writing the committed worklist would dirty the tree with
  // whichever dataset ran last.
  const worklist = path.join(os.tmpdir(), `dsh8-worklist-${dataset}-${process.pid}.json`);
  const out = execFileSync('node', [DETECTOR, '--dataset', dataset, '--worklist', worklist], {
    cwd: REPO, encoding: 'utf-8', timeout: 60_000,
  });
  const m = out.match(/HIGH-confidence collapses:\s*(\d+)\s*\((\d+)\s*groups\)/);
  const c = out.match(/atoms checked:\s*(\d+)/);
  if (!m) throw new Error(`detector output not parseable:\n${out}`);
  return { collapses: parseInt(m[1], 10), groups: parseInt(m[2], 10), checked: c ? parseInt(c[1], 10) : 0 };
}

describe('deductive-schema-harness-8 incarnate collapse detector — gate', () => {
  for (const ds of ['homecoming', 'rebirth', 'thunderspy', 'brainstorm']) {
    it(`${ds}: zero high-confidence multi-type collapses in Hybrid + Destiny`, () => {
      const r = runDetector(ds);
      expect(r.collapses, `${ds} high-confidence collapse groups: ${r.groups}`).toBe(0);
    });
  }

  it('homecoming: the detector actually inspects buff atoms (not a vacuous pass)', () => {
    // guard against the gate passing because nothing was checked (e.g. a broken
    // source path). HC has ~hundreds of checkable Hybrid+Destiny buff atoms.
    expect(runDetector('homecoming').checked).toBeGreaterThan(200);
  });
});
