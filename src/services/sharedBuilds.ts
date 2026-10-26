/**
 * Service layer for shared builds — handles all Supabase interactions
 */

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { SharedBuild, ShareBuildInput, SearchFilters, SearchResult, BuildVisibility } from '@/types/shared';
import { capturePreviewBase64 } from '@/utils/preview-capture';
import { CURRENT_PREVIEW_TEMPLATE_VERSION } from '@/components/export-image/BuildPreviewCard';
import type { BuildExport } from '@/types/build';
import { DEFAULT_BUILD_NAME } from '@/types/build';
import { publicProviderName } from '@/utils/author-identity';
import { QUICK_SHARE_CACHE_KEY, clearQuickShareCache } from './quickShareCache';

export { clearQuickShareCache };

const DEFAULT_PAGE_SIZE = 20;
const OWNER_TOKENS_KEY = 'coh-planner-owner-tokens';
const FAVORITES_KEY = 'coh-planner-favorites';

/**
 * Hourly save/share limits. **Mirrors `supabase/functions/share-build/index.ts`.**
 * The server is authoritative and returns the live values on every response; these
 * are used for the proactive hint shown *before* any call, and as a fallback when
 * the response is the older plain shape (function not yet redeployed).
 */
export const RATE_LIMITS = {
  share: 10, // public shares per hour
  vault: 50, // saved (private library) builds per hour
  windowHours: 1,
} as const;

export type RateLimitAction = 'share' | 'vault';

/** Rate-limit counters returned by the edge function on a successful save. */
export interface RateLimitInfo {
  action: RateLimitAction;
  limit: number;
  remaining: number;
}

/** Thrown when a save/share hits the hourly limit. Carries the bucket, the limit,
 *  and how long until a slot frees up (so the UI can show a precise countdown). */
export class RateLimitError extends Error {
  readonly action: RateLimitAction;
  readonly limit: number;
  /** Seconds until the oldest request ages out (0 when the server is the older
   *  build that doesn't report it — UI then says "within the hour"). */
  readonly retryAfterSeconds: number;
  readonly resetAt: string | null;
  constructor(opts: {
    action: RateLimitAction;
    limit: number;
    retryAfterSeconds: number;
    resetAt: string | null;
    message?: string;
  }) {
    super(opts.message || 'Rate limit exceeded. Please try again later.');
    this.name = 'RateLimitError';
    this.action = opts.action;
    this.limit = opts.limit;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.resetAt = opts.resetAt;
  }
}

// ---- Favorites management (localStorage cache + account sync when logged in) ----
//
// The localStorage list is the always-available source of truth for the UI: it
// works logged-out and gives an instant toggle. When a user is signed in, every
// change is *also* mirrored to the `favorites` table (best-effort, fire-and-
// forget) and `syncFavorites()` reconciles the two on login, so favourites
// follow the account across devices. See syncFavorites for the merge semantics.

function getFavoriteIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveFavoriteIds(ids: string[]): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}

/** The signed-in user's id, or null when logged out / Supabase not configured. */
function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

export function isFavorite(buildId: string): boolean {
  return getFavoriteIds().includes(buildId);
}

export function toggleFavorite(buildId: string): boolean {
  const ids = getFavoriteIds();
  const index = ids.indexOf(buildId);
  const nowFav = index < 0;
  if (index >= 0) {
    ids.splice(index, 1);
  } else {
    ids.push(buildId);
  }
  saveFavoriteIds(ids);

  // Mirror to the account so the change follows the user to other devices.
  // Fire-and-forget: the local list is already updated, so the UI is correct
  // even if the network write fails or the user is logged out.
  const userId = currentUserId();
  if (supabase && userId) {
    void persistFavorite(buildId, userId, nowFav);
  }
  return nowFav;
}

/** Write a single favourite change through to the `favorites` table. */
async function persistFavorite(buildId: string, userId: string, favorited: boolean): Promise<void> {
  if (!supabase) return;
  try {
    if (favorited) {
      await supabase
        .from('favorites')
        .upsert({ user_id: userId, build_id: buildId }, { onConflict: 'user_id,build_id' });
    } else {
      await supabase.from('favorites').delete().eq('user_id', userId).eq('build_id', buildId);
    }
  } catch {
    // Best-effort — the local list is authoritative for the current session and
    // syncFavorites will reconcile on the next login.
  }
}

/**
 * Reconcile local favourites with the signed-in user's server-side favourites.
 *
 * Non-destructive **union** merge: any locally-favourited build is pushed up,
 * any server favourite is pulled down, and the local cache becomes the union of
 * both. This is what makes the first login after favouriting-while-logged-out
 * "just work", and lets a build favourited on one device appear on another.
 *
 * Call once whenever auth resolves to a user. Best-effort: on any error the
 * local list is left untouched.
 */
export async function syncFavorites(): Promise<void> {
  const userId = currentUserId();
  if (!supabase || !userId) return;

  const localIds = getFavoriteIds();

  const { data, error } = await supabase
    .from('favorites')
    .select('build_id')
    .eq('user_id', userId);
  if (error) return; // keep the local list as-is

  const serverIds = (data ?? []).map((r) => r.build_id as string);
  const serverSet = new Set(serverIds);

  // Push local-only favourites up. Insert per-row (not one batch) so a favourite
  // pointing at a since-deleted build fails only its own row via the FK, instead
  // of aborting the whole push.
  const toInsert = localIds.filter((id) => !serverSet.has(id));
  if (toInsert.length > 0) {
    await Promise.allSettled(
      toInsert.map((build_id) =>
        supabase!
          .from('favorites')
          .upsert({ user_id: userId, build_id }, { onConflict: 'user_id,build_id' }),
      ),
    );
  }

  // Local cache becomes the union of both sides.
  saveFavoriteIds(Array.from(new Set([...localIds, ...serverIds])));
}

/**
 * Clear the local favourites cache. Called on logout so a second user on the
 * same browser doesn't inherit (or accidentally push up) the previous user's
 * favourites. This is safe because a signed-in user's favourites live on their
 * account and are pulled back down by syncFavorites on their next login.
 */
export function clearFavoritesCache(): void {
  localStorage.removeItem(FAVORITES_KEY);
}

/** Fetch all favorited builds from Supabase */
export async function getFavoriteBuilds(): Promise<SharedBuild[]> {
  if (!supabase) return [];
  const ids = getFavoriteIds();
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('shared_builds_with_author')
    .select('*')
    .in('id', ids)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as SharedBuild[];
}

// ---- Owner token management (localStorage) ----

function getOwnerTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OWNER_TOKENS_KEY) || '{}');
  } catch {
    return {};
  }
}

function setOwnerToken(buildId: string, token: string): void {
  const tokens = getOwnerTokens();
  tokens[buildId] = token;
  localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify(tokens));
}

function removeOwnerToken(buildId: string): void {
  const tokens = getOwnerTokens();
  delete tokens[buildId];
  localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify(tokens));
}

/** Get the owner token for a build (null if not owned) */
export function getOwnerToken(buildId: string): string | null {
  return getOwnerTokens()[buildId] ?? null;
}

/** Check if the current browser owns a given build (via token or Discord account) */
export function isOwnedBuild(buildId: string, build?: SharedBuild | null): boolean {
  if (getOwnerToken(buildId) !== null) return true;
  const user = useAuthStore.getState().user;
  if (user && build?.user_id === user.id) return true;
  return false;
}

/** Get all owned build IDs (for the update-existing UI) */
export function getOwnedBuildIds(): string[] {
  return Object.keys(getOwnerTokens());
}

/** Reclaim ownership of a build by manually entering an owner token */
export function reclaimBuild(buildId: string, token: string): void {
  setOwnerToken(buildId, token);
}

// ---- API functions ----

/** Check if Supabase is configured */
export function isShareEnabled(): boolean {
  return supabase !== null;
}

function rateLimitLabel(action: RateLimitAction): string {
  return action === 'vault' ? 'saved builds' : 'public shares';
}

/** Friendly message for a hit rate limit — a precise countdown when the server
 *  reports `retryAfterSeconds`, else a generic "within the hour". */
export function formatRateLimitMessage(err: RateLimitError): string {
  const base = `You've hit the hourly limit (${err.limit} ${rateLimitLabel(err.action)}).`;
  if (err.retryAfterSeconds > 0) {
    const mins = Math.max(1, Math.ceil(err.retryAfterSeconds / 60));
    return `${base} Try again in ~${mins} min${mins === 1 ? '' : 's'}.`;
  }
  return `${base} Please try again within the hour.`;
}

/** Proactive one-liner for the save/share UI (shown before any limit is hit). */
export function rateLimitHint(action: RateLimitAction): string {
  const limit = action === 'vault' ? RATE_LIMITS.vault : RATE_LIMITS.share;
  return `Up to ${limit} ${rateLimitLabel(action)} per hour.`;
}

/** Share a build to the public repository (create or update) */
export async function shareBuild(input: ShareBuildInput): Promise<{ id: string; url: string; updated?: boolean; rateLimit?: RateLimitInfo }> {
  if (!supabase) throw new Error('Sharing is not configured');

  const buildData = input.build_json;
  const archetype = buildData.build.archetype;
  const primary = buildData.build.primary;
  const secondary = buildData.build.secondary;

  const payload: Record<string, unknown> = {
    name: input.name || buildData.build.name || DEFAULT_BUILD_NAME,
    description: input.description,
    archetype: archetype.id || '',
    archetype_name: archetype.name || '',
    primary_set: primary.id || '',
    primary_name: primary.name || '',
    secondary_set: secondary.id || '',
    secondary_name: secondary.name || '',
    level: buildData.build.level,
    author_name: input.author_name,
    server: input.server,
    tags: input.tags,
    build_json: buildData,
  };
  // Only send visibility when the caller explicitly set it. Omitting it on an
  // update tells the backend to PRESERVE the row's current visibility — so a
  // re-save (vault/quick-share) can't silently revert a build the user made
  // public via the visibility toggle. (Must not default this to 'public' here,
  // or the omission would itself flip the row public.)
  if (input.visibility !== undefined) payload.visibility = input.visibility;

  // Best-effort social-preview image: the off-screen SharePreviewCapture
  // renders whatever build is currently live, which is always the build
  // being shared here (all three share entry points act on the active
  // build). A capture failure must not block the share — omit the field.
  const previewImage = await capturePreviewBase64();
  if (previewImage) payload.preview_image_base64 = previewImage;

  // If updating an existing build, attach credentials (token and/or JWT via auth header)
  if (input.existingId) {
    const ownerToken = getOwnerToken(input.existingId);
    const user = useAuthStore.getState().user;
    if (!ownerToken && !user) throw new Error('No owner token or login session for this build');
    payload.existing_id = input.existingId;
    if (ownerToken) payload.owner_token = ownerToken;
  }

  // Refresh auth session to avoid 401 from expired JWT
  const user = useAuthStore.getState().user;
  if (user) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      throw new Error('Session expired — please log in again');
    }
  }

  const { data, error } = await supabase.functions.invoke('share-build', {
    body: payload,
  });

  if (error) {
    // Pull the JSON body from the failed Response (supabase-js stashes it on
    // `error.context`). Used both for the message and to detect rate limiting.
    let body: { error?: string; code?: string; action?: string; limit?: number; retryAfterSeconds?: number; resetAt?: string } | null = null;
    let status: number | undefined;
    try {
      if (error.context && typeof error.context.json === 'function') {
        status = error.context.status;
        body = await error.context.json();
      }
    } catch {
      /* non-JSON body */
    }

    // Rate limit (HTTP 429). New server sends a structured body; older builds
    // (function not yet redeployed) send only `{ error }` at status 429 — fall
    // back to the mirrored constants so the message is still useful.
    const isRateLimited = status === 429 || body?.code === 'rate_limited' || /rate limit/i.test(body?.error || '');
    if (isRateLimited) {
      const action: RateLimitAction = body?.action === 'vault' || body?.action === 'share'
        ? body.action
        : (input.visibility === 'private' || input.visibility === 'unlisted' ? 'vault' : 'share');
      throw new RateLimitError({
        action,
        limit: body?.limit ?? (action === 'vault' ? RATE_LIMITS.vault : RATE_LIMITS.share),
        retryAfterSeconds: body?.retryAfterSeconds ?? 0,
        resetAt: body?.resetAt ?? null,
        message: body?.error,
      });
    }

    throw new Error(body?.error || error.message || 'Failed to share build');
  }
  if (data?.error) throw new Error(data.error);

  // Store owner token on new creates
  if (data.owner_token) {
    setOwnerToken(data.id, data.owner_token);
  }

  return {
    id: data.id,
    url: `${window.location.origin}/builds/${data.id}`,
    updated: data.updated ?? false,
    rateLimit: data.rateLimit as RateLimitInfo | undefined,
  };
}

/** Editable metadata fields on a saved build (everything except the build itself). */
export interface BuildMetadataPatch {
  name?: string;
  description?: string;
  server?: string;
  tags?: string[];
  author_name?: string;
}

/**
 * Update only the editable metadata of an owned build (name/description/server/
 * tags/author), leaving the build_json and current visibility untouched.
 *
 * The share-build edge function's update branch overwrites ALL metadata columns
 * wholesale, so we resend the existing build_json plus any fields the caller
 * isn't changing (falling back to the build's current values) — otherwise an
 * omitted field would be blanked. `visibility` is deliberately omitted so the
 * update preserves the row's current visibility (and is metered as a cheap
 * vault action rather than a public share).
 */
export async function updateBuildMetadata(existing: SharedBuild, patch: BuildMetadataPatch): Promise<void> {
  await shareBuild({
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description ?? '',
    author_name: patch.author_name ?? existing.author_name ?? '',
    server: patch.server ?? existing.server ?? '',
    tags: patch.tags ?? existing.tags ?? [],
    build_json: existing.build_json,
    existingId: existing.id,
  });
}

// ---- Quick share (one-click unlisted short link) ----

interface QuickShareCache {
  shareId: string;
  fingerprint: string;
  /** CURRENT_PREVIEW_TEMPLATE_VERSION at the time this row's image was last
   *  captured. A cache hit whose build is unchanged but whose template has
   *  since moved on must still re-share (see quickShareBuild) — otherwise
   *  repeatedly clicking "Copy Short Link" on the same build could never
   *  pick up a template fix, only the automatic backfill would (and only
   *  once someone opens the link in a browser). Absent on a cache written
   *  before this field existed, which correctly reads as "stale". */
  templateVersion?: number;
}

function readQuickShareCache(): QuickShareCache | null {
  try {
    const raw = localStorage.getItem(QUICK_SHARE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuickShareCache;
    if (typeof parsed?.shareId !== 'string' || typeof parsed?.fingerprint !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeQuickShareCache(cache: QuickShareCache): void {
  localStorage.setItem(QUICK_SHARE_CACHE_KEY, JSON.stringify(cache));
}

async function fingerprintBuild(buildExport: BuildExport): Promise<string> {
  const json = JSON.stringify(buildExport.build);
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  // 16 hex chars (64 bits) is plenty to avoid collisions for one user
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** One-click unlisted share. Auth required.
 *
 * Behavior:
 *   - If the current build matches the cached fingerprint, returns the cached
 *     URL with no network call (instant re-copy).
 *   - Else, updates the cached share row in place via `existingId` (or creates
 *     a new row on the first share, or if the cached row is no longer ownable).
 *     The cache belongs to the build in the planner: loading or starting a
 *     different one clears it (buildStore), so this update is only ever an
 *     edit of the same build, never a different build overwriting a link.
 *   - The created build is `visibility: 'unlisted'` — reachable by anyone
 *     with the exact URL but not surfaced in search/browse or listable via
 *     the anon API.
 */
export async function quickShareBuild(buildExport: BuildExport): Promise<{ url: string }> {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error('Sign in with Discord to create a short link.');

  const fingerprint = await fingerprintBuild(buildExport);
  const cached = readQuickShareCache();

  if (cached && cached.fingerprint === fingerprint && cached.templateVersion === CURRENT_PREVIEW_TEMPLATE_VERSION) {
    return { url: `${window.location.origin}/builds/${cached.shareId}` };
  }

  // Generate a meaningful name (mirrors the fallback in ExportImportModal)
  let name = buildExport.build.name;
  if (!name || /^untitled\s*build$/i.test(name.trim())) {
    const at = buildExport.build.archetype?.name || '';
    const pri = buildExport.build.primary?.name || '';
    const sec = buildExport.build.secondary?.name || '';
    name = ['Generic ' + at, pri, sec].filter(Boolean).join(' - ') || 'Shared Build';
  }

  const authorName = publicProviderName(user.user_metadata);

  const shareInput: ShareBuildInput = {
    name,
    description: '',
    author_name: authorName,
    server: (buildExport.build.serverId as string | undefined) || '',
    tags: [],
    build_json: buildExport,
    visibility: 'unlisted',
  };

  // Try updating the cached row first; if it fails (deleted, ownership lost,
  // edge function rejects), fall back to creating a new one.
  if (cached) {
    try {
      // Preserve the row's current visibility on update (drop visibility) —
      // the user may have made this build public via the toggle since it was
      // first quick-shared; a re-share must not silently revert it to unlisted.
      const { visibility: _ignored, ...updateInput } = shareInput;
      const result = await shareBuild({ ...updateInput, existingId: cached.shareId });
      writeQuickShareCache({ shareId: result.id, fingerprint, templateVersion: CURRENT_PREVIEW_TEMPLATE_VERSION });
      return { url: result.url };
    } catch (e) {
      // A rate limit means a retry-as-create would just burn a second slot and
      // fail again — surface it now. Other failures (stale cache, lost
      // ownership) fall through to create a fresh row.
      if (e instanceof RateLimitError) throw e;
    }
  }

  const result = await shareBuild(shareInput);
  writeQuickShareCache({ shareId: result.id, fingerprint, templateVersion: CURRENT_PREVIEW_TEMPLATE_VERSION });
  return { url: result.url };
}

/** Delete a shared build (requires ownership via token or Discord auth) */
export async function deleteBuild(id: string): Promise<void> {
  if (!supabase) throw new Error('Sharing is not configured');

  const ownerToken = getOwnerToken(id);
  const user = useAuthStore.getState().user;
  if (!ownerToken && !user) throw new Error('No owner token or login session for this build');

  // Refresh auth session to avoid 401 from expired JWT
  if (user) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      throw new Error('Session expired — please log in again');
    }
  }

  const { data, error } = await supabase.functions.invoke('delete-build', {
    body: { id, owner_token: ownerToken || undefined },
  });

  if (error) {
    let msg = 'Failed to delete build';
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        msg = body?.error || msg;
      } else {
        msg = error.message || msg;
      }
    } catch {
      msg = error.message || msg;
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);

  removeOwnerToken(id);
}

/** Fetch a single shared build by ID (joined with author profile if any).
 *
 * Tries the direct RLS-governed table read first — it covers public builds
 * and the caller's own rows at any visibility. A miss (RLS hides the row —
 * a non-owner reading an unlisted build, since unlisted has no anon/
 * authenticated grant) falls back to the `get-build` edge function, the
 * only path a non-owner reads an unlisted build through.
 */
export async function getSharedBuild(id: string): Promise<SharedBuild | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('shared_builds_with_author')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (data) return data as SharedBuild;
  if (error) return null;

  const { data: fnData, error: fnError } = await supabase.functions.invoke('get-build', {
    body: { id },
  });
  if (fnError || fnData?.error) return null;
  return fnData as SharedBuild;
}

/** Increment view count (fire-and-forget) */
export function incrementViews(id: string): void {
  if (!supabase) return;
  supabase.rpc('increment_views', { build_id: id }).then(() => {});
}

/**
 * Submit a preview image captured for `id` by the hidden capture-mode boot
 * (see streams/BUILD_PREVIEW_BACKFILL_PLAN.md, build-preview-backfill-5/6) — no auth, since
 * any visitor's browser can be the one that generates it. The backend only
 * accepts this when `id`'s stored image is missing or behind the current
 * template version; returns false on any failure (never throws — the caller
 * reports completion to its parent either way).
 */
export async function submitPreviewBackfill(id: string, previewImageBase64: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.functions.invoke('backfill-preview', {
      body: { id, preview_image_base64: previewImageBase64 },
    });
    return !error && !data?.error;
  } catch {
    return false;
  }
}

/** Search shared builds with filters and pagination */
export async function searchSharedBuilds(filters: SearchFilters = {}): Promise<SearchResult> {
  if (!supabase) {
    return { builds: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE, totalPages: 0 };
  }

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('shared_builds_with_author')
    .select('*', { count: 'exact' })
    .eq('visibility', 'public');

  // Apply filters
  if (filters.archetype) {
    query = query.eq('archetype', filters.archetype);
  }
  if (filters.primarySet) {
    query = query.eq('primary_set', filters.primarySet);
  }
  if (filters.secondarySet) {
    query = query.eq('secondary_set', filters.secondarySet);
  }
  // authorId is the canonical filter (matches a specific user account).
  // authorName is only used as a filter when there's no authorId — primarily
  // for clicks on anonymous (no user_id) build cards. When both are present,
  // authorName is treated as a display label for the active-filter banner only.
  if (filters.authorId) {
    query = query.eq('user_id', filters.authorId);
  } else if (filters.authorName) {
    query = query.eq('author_name', filters.authorName);
  }
  if (filters.query?.trim()) {
    query = query.textSearch('name', filters.query.trim(), { type: 'websearch' });
  }

  // Apply sorting
  if (filters.sortBy === 'views') {
    query = query.order('views', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  // Apply pagination
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) throw new Error(error.message);

  const total = count ?? 0;

  return {
    builds: (data ?? []) as SharedBuild[],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** Fetch all builds owned by the authenticated user */
export async function getMyBuilds(): Promise<SharedBuild[]> {
  if (!supabase) return [];

  const user = useAuthStore.getState().user;
  if (!user) return [];

  const { data, error } = await supabase
    .from('shared_builds_with_author')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    // Gracefully handle missing user_id column (migration not yet applied)
    if (error.message.includes('user_id') && error.message.includes('does not exist')) {
      return [];
    }
    throw new Error(error.message);
  }
  return (data ?? []) as SharedBuild[];
}

/** Set the visibility of an owned build (requires Discord login) */
export async function updateBuildVisibility(id: string, visibility: BuildVisibility): Promise<void> {
  if (!supabase) throw new Error('Sharing is not configured');

  const user = useAuthStore.getState().user;
  if (!user) throw new Error('Must be logged in to change build visibility');

  // Refresh auth session to avoid 401 from expired JWT
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    throw new Error('Session expired — please log in again');
  }

  const { data, error } = await supabase.functions.invoke('update-build-visibility', {
    body: { id, visibility },
  });

  if (error) {
    let msg = 'Failed to update visibility';
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        msg = body?.error || msg;
      } else {
        msg = error.message || msg;
      }
    } catch {
      msg = error.message || msg;
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
}

/** Claim existing token-owned builds by linking them to the authenticated user account */
export async function claimBuilds(): Promise<{ claimed: string[]; failed: string[] }> {
  if (!supabase) throw new Error('Sharing is not configured');

  const user = useAuthStore.getState().user;
  if (!user) throw new Error('Must be logged in to claim builds');

  const tokens = getOwnerTokens();
  if (Object.keys(tokens).length === 0) {
    return { claimed: [], failed: [] };
  }

  // Refresh auth session to avoid 401 from expired JWT
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    throw new Error('Session expired — please log in again');
  }

  const { data, error } = await supabase.functions.invoke('claim-builds', {
    body: { owner_tokens: tokens },
  });

  if (error) {
    let msg = 'Failed to claim builds';
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        msg = body?.error || msg;
      } else {
        msg = error.message || msg;
      }
    } catch {
      msg = error.message || msg;
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);

  return { claimed: data.claimed ?? [], failed: data.failed ?? [] };
}
