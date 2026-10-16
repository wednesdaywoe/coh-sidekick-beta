# scripts/attic — retired scripts

Scripts no longer wired into regen-all, package.json, CI, or any other script,
kept for reference (full history follows each file via `git log --follow`).
Nothing here runs; do not wire anything in this directory into the pipeline.

Both repos hold this directory, with the same seven files, and that is
deliberate. Retiring a script in one repo only used to MOVE it out of the path
the sync manifest keys on, so a file that still sat at `scripts/X` in the other
repo stopped being paired with anything and was graded by neither side. That is
how `push-changelog-discord.ts` drifted 100 lines: the beta gained id-keyed
dedup and unknown-flag rejection, the canonical copy sat in this directory at
the pre-fix text, and no guard could see the pair. So the attic is mirrored, and
`scripts/verify-sync.cjs` refuses an attic file that has a live twin at
`scripts/` in the other repo.

Why each landed here (archived 2026-07-19, per CODEBASE-AUDIT.md):

- `planb-shadow-tohit.cjs` — Plan B Slice 1 prototype; superseded by
  `planb-shadow-pertarget.cjs`, which regen-all runs.
- `dsh6-shadow-atoms.cjs` — deductive-schema-harness-6 exploration probe; the gating detector is
  `dsh6-collapse-detector.cjs`, which regen-all runs.
- `migrate-to-layered.cjs` — one-off migration to the layered
  `{generated,overrides,powersets}` tree; the migration is long complete.
- `reconvert-redirect-powersets.cjs` — one-off against the pre-layered `powers/`
  layout; redirect powersets are handled by `convert-all-powersets.cjs` normally.
- `env-shim.ts` — a standalone `import.meta.env` preload from the beta's Vite
  toolchain, superseded on both sides: the canonical pipeline's loader is
  `ts-esm-register.mjs`, and the beta's `env-loader.ts` carries its own copy of
  the shim inline, so nothing has imported this file in either repo for months.
- `extract-genesis-icons.py` / `extract-thunderspy-icons.py` — one-off icon
  extractions; the extracted assets are committed. Kept because they are the
  only record of where `public/img/powers/` came from.

NOT archived, despite looking orphaned from the pipeline wiring:

- `bridge-attrib-one.cjs` — invoked as a CLI at runtime by
  `extract-proc-data.py` and `extract-rebirth-io-sets-v2.py` (`_BRIDGE_CLI`).
- `extract-proc-data.py` — the live manual (.pigg-dependent) generator of the
  committed `src/data/generated/proc-*.generated.ts` files; alongside
  `extract-rebirth-io-sets-v2.py` in regen-all's "NOT covered" list (the
  latter dropped its own .pigg dependency 2026-07-20 — reads the committed
  export now — but stays manual/uncovered for the same reason: it writes
  io-sets-raw.ts, not generated/).

Two scripts that used to be listed here were not retired at all, only retired
HERE: `push-changelog-discord.ts` and `delete-user-shared-builds.ts` are wired
into the beta's `package.json` and the beta runs them. They are the beta's, and
the manifest says so in `betaOnly` — an archived copy of a file the other repo
still maintains is a decoy, not an archive.
