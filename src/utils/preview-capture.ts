/**
 * Singleton bridge from the always-mounted off-screen `<BuildPreviewCard>`
 * (see `SharePreviewCapture`) to `shareBuild()` in `sharedBuilds.ts`, which is
 * a plain service module and can't use React hooks itself. The component
 * registers its capture node on mount/update; `capturePreviewPng()` rasterizes
 * whatever is currently registered — i.e. the live build at call time.
 *
 * Best-effort by design: a share must never fail because the preview capture
 * wasn't ready or the DOM rasterizer errored. Callers get `null` on any
 * failure and proceed without a preview image.
 */

import { renderNodeToPng } from '@/utils/export-image';

/**
 * Set by main.tsx during a `?previewCapture=<id>` boot (see
 * streams/BUILD_PREVIEW_BACKFILL_PLAN.md, build-preview-backfill-4/5): `ready` is true only
 * once `id`'s real build_json has loaded into the store. The capture-mode
 * reporting pass (build-preview-backfill-5) must check this before uploading anything — a
 * fetch failure otherwise silently captures the default empty build and
 * uploads it as if it were `id`'s real preview.
 */
declare global {
  interface Window {
    __previewCapture?: { id: string; ready: boolean };
  }
}

let captureNode: HTMLElement | null = null;

/** Called by SharePreviewCapture on mount/unmount. Not for other callers. */
export function registerPreviewCaptureNode(node: HTMLElement | null): void {
  captureNode = node;
}

/** Rasterize the currently-registered preview card. `null` if no card is
 *  mounted yet (very early in app load) or rendering fails for any reason —
 *  never throws. Scale 1: this is a small unfurl thumbnail, not a download. */
export async function capturePreviewPng(): Promise<Blob | null> {
  if (!captureNode) return null;
  try {
    return await renderNodeToPng(captureNode, { scale: 1 });
  } catch (err) {
    console.error('Preview image capture failed:', err);
    return null;
  }
}

/** Same capture, base64-encoded (no `data:` prefix) for the share-build edge
 *  function's JSON body. `null` on any failure — see capturePreviewPng. */
export async function capturePreviewBase64(): Promise<string | null> {
  const blob = await capturePreviewPng();
  if (!blob) return null;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch (err) {
    console.error('Preview image encode failed:', err);
    return null;
  }
}
