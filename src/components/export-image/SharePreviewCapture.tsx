/**
 * Always-mounted, invisible off-screen render of the current build's
 * BuildPreviewCard, kept in sync with live build state so `shareBuild()`
 * (a plain service module, no hooks) can grab a fresh social-preview PNG at
 * share time via `capturePreviewPng()` — see `preview-capture.ts`.
 *
 * Mount once near the root of the authenticated planner view (StatsDashboard),
 * unconditionally — unlike BuildImageModal's identical off-screen technique,
 * this isn't gated by a modal's `isOpen`, since a share can happen at any time.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useBuildStore, useUIStore } from '@/stores';
import { useCalculatedStats, useCharacterCalculation } from '@/hooks';
import { getBaselineHealth } from '@/utils/calculations/stats';
import { computeAllStats } from '@/utils/detailed-totals';
import { getDefenseSoftcap } from '@/data/purple-patch';
import { BuildPreviewCard } from './BuildPreviewCard';
import { registerPreviewCaptureNode, capturePreviewBase64 } from '@/utils/preview-capture';
import { useEngineStore } from '@/engine/engineStore';
import { submitPreviewBackfill } from '@/services/sharedBuilds';

/** Give the wasm engine this long to finish loading before giving up on a
 *  `?previewCapture=` boot — see build-preview-backfill-5. Generous: a hidden iframe has no
 *  user waiting on it, so there's no UX cost to erring toward patience. */
const CAPTURE_TIMEOUT_MS = 15000;

export function SharePreviewCapture() {
  const build = useBuildStore((s) => s.build);
  const targetLevelOffset = useUIStore((s) => s.targetLevelOffset);
  const contentMode = useUIStore((s) => s.contentMode);
  const rechargeMidsStyle = useUIStore((s) => s.rechargeMidsStyle);
  const defenseSoftcap = getDefenseSoftcap(targetLevelOffset, contentMode);

  const stats = useCalculatedStats();
  const calcResult = useCharacterCalculation();

  const allStats = useMemo(() => {
    const h = getBaselineHealth(build.archetype?.id ?? undefined, build.level);
    return computeAllStats(
      stats,
      calcResult.globalBonuses,
      calcResult.breakdown,
      h.baseHealth,
      h.maxHealth,
      build.archetype?.id ?? undefined,
      rechargeMidsStyle,
      defenseSoftcap,
    );
  }, [stats, calcResult, build.archetype?.id, build.level, rechargeMidsStyle, defenseSoftcap]);

  const nodeRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    registerPreviewCaptureNode(nodeRef.current);
    return () => registerPreviewCaptureNode(null);
  });

  // Capture-mode reporting (build-preview-backfill-5): a `?previewCapture=` boot captures
  // itself once and reports to the parent iframe host — a no-op in every
  // other boot, since `window.__previewCapture` is only ever set by
  // main.tsx's capture-mode branch.
  const engineLoaded = useEngineStore((s) => s.loaded[build.serverId] ?? false);
  const capturingRef = useRef(false);
  useEffect(() => {
    const capture = window.__previewCapture;
    if (!capture || capturingRef.current) return;

    const report = (status: 'done' | 'failed') => {
      window.parent.postMessage(
        { type: 'coh-sidekick-preview-capture', id: capture.id, status },
        window.location.origin,
      );
    };

    // The target build itself never loaded (build-preview-backfill-4's fetch failed) — nothing
    // in the store is worth capturing. Report immediately, don't wait on the
    // engine (it would just capture the default empty build).
    if (!capture.ready) {
      capturingRef.current = true;
      report('failed');
      return;
    }

    if (!engineLoaded) return; // wait for a later render once it flips true

    capturingRef.current = true;
    const timeout = setTimeout(() => report('failed'), CAPTURE_TIMEOUT_MS);
    (async () => {
      const base64 = await capturePreviewBase64();
      const ok = base64 ? await submitPreviewBackfill(capture.id, base64) : false;
      clearTimeout(timeout);
      report(ok ? 'done' : 'failed');
    })();
    return () => clearTimeout(timeout);
  }, [engineLoaded, build.serverId]);

  return (
    <div aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none', opacity: 0 }}>
      <div ref={nodeRef}>
        <BuildPreviewCard build={build} allStats={allStats} netEndPerSec={calcResult.globalBonuses.netEndPerSec ?? 0} />
      </div>
    </div>
  );
}
