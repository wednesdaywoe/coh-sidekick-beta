/**
 * Live URL ↔ build sync.
 *
 * The planner page calls `useUrlBuildSync()` to:
 *   1. On first mount (after store hydration), if the URL hash holds a
 *      build, decode it and load it into the store.
 *   2. Subscribe to store changes and rewrite the URL hash (debounced)
 *      so the URL always reflects the current build.
 *
 * Encoding: `slimBuild()` → JSON → deflate-raw → base64. This is the
 * same pipeline as the existing `/import` route, so links produced here
 * are also valid `/import#…` links and vice versa.
 */

import { useEffect, useRef } from 'react';
import { useBuildStore } from '@/stores';
import { encodeBuildToHash } from '@/utils/build-serialization';
import { decodeImportFragment } from '@/utils/import-url';
import type { Build } from '@/types';

// Re-export for existing consumers; the encoder now lives (store-free) next to
// slimBuild in build-serialization so buildStore can reach it without a cycle.
export { encodeBuildToHash };

const SYNC_DEBOUNCE_MS = 300;

/** Build the full shareable URL for a given build, anchored to the planner ("/"). */
export function buildShareUrl(build: Build): string {
  const hash = encodeBuildToHash(build);
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/\/(import|builds|author|settings).*$/, '/') || '/';
  url.search = '';
  url.searchParams.set('serverId', build.serverId);
  url.hash = hash;
  return url.toString();
}

const VAULT_LINK_KEY = 'coh-planner-url-vault-link';

/**
 * The hash carries the build but not the library entry it was loaded from, so a
 * reload that re-imports the hash used to drop the link and turn "Update Saved
 * Build" back into "Save to Library" — a duplicate entry on the next save. This
 * remembers the pair per tab; the hash import restores the link only when the
 * incoming hash is the one recorded here. A share link opened fresh has no
 * matching record and stays unlinked, so it can never overwrite the viewer's
 * own entry.
 */
export function rememberVaultLink(hash: string, vaultId: string | undefined): void {
  try {
    if (vaultId) sessionStorage.setItem(VAULT_LINK_KEY, JSON.stringify({ hash, vaultId }));
    else sessionStorage.removeItem(VAULT_LINK_KEY);
  } catch {
    // Storage unavailable — the link just doesn't survive a reload.
  }
}

export function recallVaultLink(hash: string): string | undefined {
  try {
    const record = JSON.parse(sessionStorage.getItem(VAULT_LINK_KEY) ?? 'null');
    return record?.hash === hash && typeof record.vaultId === 'string' ? record.vaultId : undefined;
  } catch {
    return undefined;
  }
}

/** Replace the current URL with `?serverId=<id>#<hash>` without adding a history entry. */
function writeUrl(build: Build): void {
  const hash = encodeBuildToHash(build);
  rememberVaultLink(hash, build.vaultId);
  const url = new URL(window.location.href);
  url.searchParams.set('serverId', build.serverId);
  const next = `${url.pathname}${url.search}#${hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.replaceState(null, '', next);
  }
}

/**
 * Bidirectional URL ↔ build store sync. Mount once on the planner page.
 *
 * Initial-load behaviour: if the URL already has a hash and it doesn't
 * match the persisted build, import the URL's build (treating shared
 * links as authoritative on first visit). The serverId query param is
 * already consumed by `main.tsx` before React mounts, so the correct
 * dataset is loaded by the time we get here.
 */
export function useUrlBuildSync(): void {
  const hasHydrated = useBuildStore((s) => s._hasHydrated);
  const importBuild = useBuildStore((s) => s.importBuild);
  const importedRef = useRef(false);

  // One-shot: hydrate from URL on first ready render
  useEffect(() => {
    if (!hasHydrated || importedRef.current) return;
    importedRef.current = true;

    const fragment = window.location.hash;
    if (!fragment || fragment === '#') return;

    const currentBuild = useBuildStore.getState().build;
    let currentEncoded = '';
    try {
      currentEncoded = encodeBuildToHash(currentBuild);
    } catch {
      // ignore — fall through and try to import the URL
    }

    const incoming = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    if (incoming === currentEncoded) return; // already in sync

    // Preserve device-local crafting/shopping progress across URL imports.
    // These fields aren't part of the shareable build identity (their keys
    // reference inventory items, not powers), so they shouldn't be wiped
    // when a URL load replaces the build — including the user's own reload
    // case where syncBuildDefinitions might shift hashes out of alignment.
    const priorChecklist = currentBuild.craftingChecklist;
    const priorObtained = currentBuild.incarnateObtained;
    const priorShopping = currentBuild.shoppingListAcquired;
    const vaultId = recallVaultLink(incoming);

    try {
      const json = decodeImportFragment(incoming);
      const ok = importBuild(json);
      if (ok) {
        const after = useBuildStore.getState().build;
        // Re-apply prior progress on top of the imported build
        useBuildStore.setState({
          build: {
            ...after,
            ...(vaultId ? { vaultId } : {}),
            craftingChecklist: { ...priorChecklist, ...after.craftingChecklist },
            incarnateObtained: { ...priorObtained, ...after.incarnateObtained },
            shoppingListAcquired: { ...priorShopping, ...after.shoppingListAcquired },
          },
        });
      }
    } catch (err) {
      console.warn('[url-build-sync] failed to decode URL hash:', err);
    }
  }, [hasHydrated, importBuild]);

  // Continuous: write store changes back to the URL (debounced)
  useEffect(() => {
    if (!hasHydrated) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    // Initial write so a freshly-loaded planner has a valid live link
    writeUrl(useBuildStore.getState().build);

    const unsubscribe = useBuildStore.subscribe((state, prev) => {
      if (state.build === prev.build) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          writeUrl(state.build);
        } catch (err) {
          console.warn('[url-build-sync] failed to write URL:', err);
        }
      }, SYNC_DEBOUNCE_MS);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [hasHydrated]);
}
