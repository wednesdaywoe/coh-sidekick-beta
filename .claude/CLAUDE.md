# CoH-Planner Development Notes

## Development Philosophy

Prefer fixing root problems properly over quick fixes. The planner's systems (AT tables,
enhancement calculations, power effects, set bonuses) interact enough that a surface patch
usually relocates the bug rather than removing it.

**Before touching game data (bin parser, converters, calc), read
[GAME-DATA-PRINCIPLES.md](GAME-DATA-PRINCIPLES.md)** — the durable principles and the specific
gotchas. For the structural *why* behind them — how CoH models a power as a flat list of atomic
effects, the discriminators that distinguish them, and why any name-bucketed representation
collapses — read [COH-DATA-MODEL.md](../COH-DATA-MODEL.md) first.

The running issue log is `streams/HOMECOMING_PARSER.md`, cited from 17 files here
(`See HOMECOMING_PARSER`); the DSH harness log is `streams/DEDUCTIVE_SCHEMA_HARNESS.md`, cited
from 11. Both were copied from `coh-sidekick-1.0`, which is retired; this repo now owns them
and edits them in place.

## The engine and the rebuild

The calculation engine is the rebuild's Rust (`coh-sidekick-experiment`, remote
`wednesdaywoe/coh-sidekick-rebuild`), compiled to WebAssembly and committed under
`src/engine/wasm*/` with the data bundles in `public/engine/contract/`. A math fix is made in
the rebuild, then `npm run build:engine` here (it finds `../coh-sidekick-experiment`, or
`COH_REBUILD_DIR`). The converters under `scripts/` belong to this repo alone and are edited
here; the two-repo sync tooling (`sync-shared`, `verify-sync`, `sync-manifest.json`) is gone.
`coh-sidekick-1.0` is retired and nothing here reads it.

## Source Data

The raw source data (`raw_data_homecoming-*`) is gitignored due to the enormous number of files.
This project exists on two machines (PC and Laptop), each with their own local copy.

The binary parser reads directly from the HC `.pigg` archives (`bin.pigg`, `bin_powers.pigg`,
etc.) in the assets directory (e.g. `G:\Homecoming\assets\live`). The HC launcher updates these
on every game patch, so whenever the parser runs it reads current data — no manual extraction
step required.

**Note on format changes:** HC occasionally adds new fields to the binary format when patching.
The parser auto-detects format version (e.g. the post-2025 "field 45b" between box_size and
range in powers.bin). If data looks wrong after an HC patch, investigate the binary layout for
new/changed fields.

## Bin Crawler Export

Generates CoD2-compatible structured JSON from the binary parser, filtered to the 34
player-relevant categories out of 204 (`PLAYER_CATEGORIES` in
`tools/bin-crawler/bin_crawler/export_powers.py`). This replaces the dependency on the external
City of Data 2.0 raw data archive.

Run with: `py -3 tools/bin-crawler/bin_crawler/export_powers.py` (or
`py -3 -m bin_crawler.export_powers` from inside `tools/bin-crawler/`). CLI flags, the
assets-dir resolution rules, verification accuracy against CoD2, and binary layout notes are in
[docs/bin-crawler.md](../docs/bin-crawler.md).

Key parser files (under `tools/bin-crawler/bin_crawler/`): `parser/_dataclasses.py`
(EffectGroup/EffectTemplate), `parser/_enums.py` (ATTRIB_NAME, aspect/type/stack enums),
`parser/_powers.py` (effect parser), `export_powers.py` (export script at package root).

### `tools/bin-crawler/` and `exported_powers/` are VENDORED — do not edit them here

**`coh-sidekick-experiment` is canonical for the parser and for the exports it produces.** This repo
ships the crawler as part of the Sidekick tool suite, so both paths must physically exist here,
but they are a one-way copy. Edit the parser *there*, re-export *there*, then run
[`scripts/sync-bin-crawler.sh`](../scripts/sync-bin-crawler.sh) here and commit the refreshed
tree. Everything downstream — the converters under `scripts/`, `src/`, `generated/` — is owned
by this repo and edited normally.

The sync records what it copied in `tools/bin-crawler-vendored.json`;
[`bin-crawler-vendored.test.ts`](../src/data/bin-crawler-vendored.test.ts) checks it two ways.
Editing either path here goes red anywhere, including CI. A canonical repo that has moved ahead
goes red only on a machine that has both checked out — which is where the edits actually happen,
but it does mean a machine holding only this repo cannot tell it is behind.

Why this exists: HC-3's parser decode landed in the canonical repo while this one kept a
hardcoded stand-in, and nothing went red for twelve days. `export-staleness.test.ts` compares
this repo's exports against *this* repo's parser, so a copy that is uniformly stale is also
perfectly self-consistent.

### Re-export discipline (enforced 2026-07-07): a parser change means re-export ALL datasets

`exported_powers/` is the committed converter input and CANNOT be regenerated in CI (no `.pigg`,
no Python), so the `generated/` regen-diff can't cover it. Instead each dataset carries an
`_export_manifest.json` stamped by `export_powers.py` with a fingerprint of the powers-exporter
source (`parser/*.py` + `export_powers.py`, via `_export_fingerprint.py`); the vitest guard
[`export-staleness.test.ts`](../src/data/export-staleness.test.ts) recomputes it and fails if any
dataset's committed export was produced by a different parser than what's committed. To make it
green after touching the parser, re-export each dataset to its committed root and commit the
refreshed tree (a `--categories` subset export deliberately does NOT stamp — partial trees can't
claim whole-dataset currency):

- HC → `--assets-dir <…/Homecoming/assets/live> --output-dir exported_powers`
- Rebirth → `--assets-dir <…/Sweet Tea/rebirth> --output-dir exported_powers/rebirth`
- Thunderspy → `--assets-dir <…/Sweet Tea/tspy> --output-dir exported_powers/thunderspy`

Then `npm run regen` and commit `generated/` too. (This is the "re-export de-risk" workflow from
GAME-DATA-PRINCIPLES, now gated. `entities`/`salvage`/`tables` come from separate exporters and
are not yet manifest-guarded.)
