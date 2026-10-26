/** Which row "Copy Short Link" last made, and for which build. Its own module so the build
 *  store can forget it without importing the share service. */
export const QUICK_SHARE_CACHE_KEY = 'coh-planner-quick-share';

/** Clear the quick-share cache. Called on logout, so a different user on the same browser
 *  doesn't update the previous user's unlisted build, and whenever a different build is
 *  loaded or started, so its short link doesn't rewrite the one already sent for the last. */
export function clearQuickShareCache(): void {
  // Guarded: this now runs inside every import, and blocked or absent storage must not fail one.
  try {
    localStorage.removeItem(QUICK_SHARE_CACHE_KEY);
  } catch {
    // Nothing stored can be forgotten.
  }
}
