// MUST be first: installs an in-memory localStorage before the store module is
// evaluated (the store caches its persist storage at eval time).
import '@/test/localstorage-polyfill';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { createEmptyBuild } from '@/types/build';
import { slimBuild } from '@/utils/build-serialization';
import { useBuildStore } from '@/stores/buildStore';
import { QUICK_SHARE_CACHE_KEY } from '@/services/quickShareCache';

/**
 * "Copy Short Link" keeps one row per browser and updates it when the build changes. A user
 * linked build A, loaded build B and copied its link, and A's link now showed B (2026-10-26).
 * The cache has to be forgotten whenever a DIFFERENT build enters the planner.
 */

const CACHED = JSON.stringify({ shareId: 'row-a', fingerprint: 'abc', templateVersion: 1 });

beforeAll(async () => {
  await loadDataset('homecoming');
});

beforeEach(() => {
  localStorage.setItem(QUICK_SHARE_CACHE_KEY, CACHED);
});

describe('the short-link cache follows the build in the planner', () => {
  it('is forgotten when a build is imported', () => {
    const build = createEmptyBuild('homecoming');
    build.archetype = { id: 'controller', name: 'Controller', stats: null, inherent: null } as never;
    expect(useBuildStore.getState().importBuild(JSON.stringify({ version: 4, build: slimBuild(build) }))).toBe(true);
    expect(localStorage.getItem(QUICK_SHARE_CACHE_KEY)).toBeNull();
  });

  it('is forgotten on New Build', () => {
    useBuildStore.getState().resetBuild();
    expect(localStorage.getItem(QUICK_SHARE_CACHE_KEY)).toBeNull();
  });

  it('survives an edit to the same build', () => {
    useBuildStore.getState().setLevel(40);
    expect(localStorage.getItem(QUICK_SHARE_CACHE_KEY)).toBe(CACHED);
  });
});
