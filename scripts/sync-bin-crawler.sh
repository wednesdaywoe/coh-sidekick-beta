#!/usr/bin/env bash
# Refresh this repo's VENDORED copy of the bin crawler and its exports.
#
#   ./scripts/sync-bin-crawler.sh                 # find the canonical checkout
#   ./scripts/sync-bin-crawler.sh ../coh-sidekick-next
#   SIDEKICK_CANONICAL_REPO=/path/to/repo ./scripts/sync-bin-crawler.sh
#   ./scripts/sync-bin-crawler.sh --allow-dirty   # stamp a dirty canonical anyway
#
# `coh-sidekick-next` is canonical for `tools/bin-crawler` (the parser) and for
# `exported_powers` (what that parser produced). This repo ships the crawler as
# part of the Sidekick tool suite, so both paths must physically exist here — but
# they are a copy, and the flow is one-way. Edit the parser THERE, re-export
# THERE, then run this. Editing either path here strands the fix in one repo,
# which is what happened to HC-3.
#
# The copy is a MIRROR, not an overlay: tracked files under the synced paths are
# removed before extracting, so a file deleted upstream disappears here too. The
# archive is built and verified before anything is removed, and everything
# removed is committed content, so a failed run is recoverable with
# `git checkout -- tools/bin-crawler exported_powers`.
#
# The sync writes `tools/bin-crawler-vendored.json`; the guard in
# `src/data/bin-crawler-vendored.test.ts` reads it. Commit the result — this
# script deliberately does not, so the diff gets reviewed like any other.

set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"

SYNCED_PATHS=(tools/bin-crawler exported_powers)

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
pass() { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

ALLOW_DIRTY=0
EXPLICIT=""
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -*) die "unknown flag: $arg" ;;
    *)  EXPLICIT="$arg" ;;
  esac
done

# ---- locate the canonical checkout ----
step "Locate the canonical checkout"
CANONICAL="$(node -e '
  import("./scripts/bin-crawler-fingerprint.mjs").then((m) => {
    const p = m.resolveCanonicalRepo(process.argv[1] || undefined);
    if (!p) process.exit(3);
    console.log(p);
  });
' "$EXPLICIT")" || die "cannot find the canonical checkout.
Pass it as an argument, or set SIDEKICK_CANONICAL_REPO, or place it at ../coh-sidekick-next.
It must contain both ${SYNCED_PATHS[*]}."
git -C "$CANONICAL" rev-parse --git-dir >/dev/null 2>&1 || die "$CANONICAL is not a git repo"
[[ "$(cd "$CANONICAL" && pwd -P)" != "$(cd "$REPO_ROOT" && pwd -P)" ]] \
  || die "canonical resolves to this repo — nothing to sync from"
pass "canonical: $CANONICAL"

# ---- refuse to record a provenance that is not reproducible ----
step "Check the canonical working tree is clean"
DIRTY="$(git -C "$CANONICAL" status --porcelain -- "${SYNCED_PATHS[@]}")"
if [[ -n "$DIRTY" ]]; then
  printf '%s\n' "$DIRTY" | head -20
  if [[ "$ALLOW_DIRTY" -eq 0 ]]; then
    die "the canonical checkout has uncommitted changes under the synced paths.
The record would name a commit that does not describe what was copied.
Commit there first, or re-run with --allow-dirty."
  fi
  printf '\033[1;33m! syncing from a DIRTY canonical tree (--allow-dirty)\033[0m\n'
else
  pass "clean"
fi
HEAD_SHA="$(git -C "$CANONICAL" rev-parse --short=10 HEAD)"

# ---- build the archive first; nothing is removed until this succeeds ----
step "Archive ${SYNCED_PATHS[*]} from $HEAD_SHA"
TMPDIR_SYNC="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SYNC"' EXIT
TARBALL="$TMPDIR_SYNC/bin-crawler-sync.tar"
# From the working tree, not HEAD: --allow-dirty must copy what is actually there.
tar -cf "$TARBALL" -C "$CANONICAL" \
    --exclude='__pycache__' --exclude='*.pyc' --exclude='*.pyo' \
    "${SYNCED_PATHS[@]}"
[[ -s "$TARBALL" ]] || die "archive is empty — wrong canonical path?"
FILE_COUNT="$(tar -tf "$TARBALL" | grep -cv '/$' || true)"
[[ "$FILE_COUNT" -gt 1000 ]] || die "archive holds only $FILE_COUNT files — refusing a suspiciously small sync"
pass "$FILE_COUNT files staged"

# ---- mirror ----
step "Replace the vendored copy"
git ls-files -z -- "${SYNCED_PATHS[@]}" | xargs -0 --no-run-if-empty rm -f
tar -xf "$TARBALL" -C "$REPO_ROOT"
# Directories emptied by an upstream deletion would otherwise linger untracked.
for p in "${SYNCED_PATHS[@]}"; do
  [[ -d "$p" ]] && find "$p" -type d -empty -delete || true
done
pass "extracted"

# ---- record what was copied ----
# Stage first: the digests are taken over TRACKED files, so a file that arrived
# in this sync and is not yet in the index would be silently left out of the
# record it is supposed to describe.
step "Stage the copy"
git add -A -- "${SYNCED_PATHS[@]}"
pass "staged"

step "Write tools/bin-crawler-vendored.json"
node scripts/bin-crawler-fingerprint.mjs --write-record --canonical "$CANONICAL"

# ---- report ----
step "Result"
git status --porcelain -- "${SYNCED_PATHS[@]}" tools/bin-crawler-vendored.json | head -20
CHANGED="$(git status --porcelain -- "${SYNCED_PATHS[@]}" | wc -l)"
if [[ "$CHANGED" -eq 0 ]]; then
  pass "already in sync with $HEAD_SHA — nothing changed"
else
  printf '\n\033[1;33m%s file(s) changed.\033[0m Next:\n' "$CHANGED"
  printf '  1. npm run regen        # exported_powers feeds the converters\n'
  printf '  2. npm test             # the vendoring + export-staleness guards\n'
  printf '  3. review the diff and commit\n'
fi
