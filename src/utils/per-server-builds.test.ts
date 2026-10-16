import { describe, it, expect } from 'vitest';
import {
  migratePerServerState,
  selectActiveBuild,
  composePersistedState,
  serializeBuildForStorage,
  isKnownServerId,
} from '@/utils/per-server-builds';
import { DATASET_IDS } from '@/data/dataset';
import { createEmptyBuild } from '@/types/build';
import type { Build } from '@/types/build';

/** A recognizable build for a given server (archetype id = server name). */
function buildFor(serverId: Build['serverId'], archetypeId: string): Build {
  const b = createEmptyBuild(serverId);
  b.archetype = { id: archetypeId, name: archetypeId, stats: null, inherent: null } as never;
  return b;
}

describe('migratePerServerState', () => {
  it('migrates the legacy single-slot { build } shape, filing it under its server', () => {
    const legacy = { build: serializeBuildForStorage(buildFor('rebirth', 'mastermind')) };
    const out = migratePerServerState(legacy, 0);
    expect(out.activeServerId).toBe('rebirth');
    expect(Object.keys(out.buildsByServer)).toEqual(['rebirth']);
    expect((out.buildsByServer.rebirth as { archetype: { id: string } }).archetype.id).toBe('mastermind');
  });

  it('defaults a legacy build with an unknown serverId to homecoming', () => {
    const legacy = { build: { serverId: 'bogus', archetype: { id: 'blaster' } } };
    const out = migratePerServerState(legacy, 0);
    expect(out.activeServerId).toBe('homecoming');
    expect(Object.keys(out.buildsByServer)).toEqual(['homecoming']);
  });

  it('passes through already-migrated per-server state (idempotent)', () => {
    const state = { activeServerId: 'thunderspy', buildsByServer: { thunderspy: { serverId: 'thunderspy' } } };
    const out = migratePerServerState(state, 1);
    expect(out).toEqual(state);
    // Double-migrate is a no-op.
    expect(migratePerServerState(out, 1)).toEqual(state);
  });

  it('returns an empty homecoming workspace for garbage/empty input', () => {
    expect(migratePerServerState(undefined)).toEqual({ activeServerId: 'homecoming', buildsByServer: {} });
    expect(migratePerServerState({})).toEqual({ activeServerId: 'homecoming', buildsByServer: {} });
  });
});

describe('selectActiveBuild', () => {
  const persisted = composePersistedState(buildFor('homecoming', 'controller'), {
    rebirth: serializeBuildForStorage(buildFor('rebirth', 'mastermind')),
  });

  it('returns the loaded server\'s build and preserves the others untouched', () => {
    const { build, inactiveServerBuilds } = selectActiveBuild(persisted, 'homecoming');
    expect((build as { archetype: { id: string } }).archetype.id).toBe('controller');
    expect(build.serverId).toBe('homecoming');
    expect(Object.keys(inactiveServerBuilds)).toEqual(['rebirth']);
    expect((inactiveServerBuilds.rebirth as { archetype: { id: string } }).archetype.id).toBe('mastermind');
  });

  it('honors a deeplink to a server with a stored build, preserving the previously-active one', () => {
    const { build, inactiveServerBuilds } = selectActiveBuild(persisted, 'rebirth');
    expect((build as { archetype: { id: string } }).archetype.id).toBe('mastermind');
    expect(build.serverId).toBe('rebirth');
    // The Homecoming build is preserved, not clobbered.
    expect(Object.keys(inactiveServerBuilds)).toEqual(['homecoming']);
  });

  it('lands a fresh empty build (stamped to the loaded server) when none is stored — the deeplink-for-new-visitor case', () => {
    const { build, inactiveServerBuilds } = selectActiveBuild(persisted, 'thunderspy');
    expect(build.serverId).toBe('thunderspy');
    expect((build as { archetype: { id: string | null } }).archetype.id).toBeNull();
    // Both existing builds are carried over.
    expect(Object.keys(inactiveServerBuilds).sort()).toEqual(['homecoming', 'rebirth']);
  });
});

describe('composePersistedState round-trip', () => {
  it('preserves all three servers across a select → compose cycle', () => {
    // Active Homecoming build, plus stored Rebirth + Thunderspy builds.
    const start = {
      activeServerId: 'homecoming' as const,
      buildsByServer: {
        homecoming: serializeBuildForStorage(buildFor('homecoming', 'controller')),
        rebirth: serializeBuildForStorage(buildFor('rebirth', 'mastermind')),
        thunderspy: serializeBuildForStorage(buildFor('thunderspy', 'blaster')),
      },
    };
    const { build, inactiveServerBuilds } = selectActiveBuild(start, 'homecoming');
    // Recompose from the (deserialized-enough) active build + carried blobs.
    const recomposed = composePersistedState(build as unknown as Build, inactiveServerBuilds);
    expect(recomposed.activeServerId).toBe('homecoming');
    expect(Object.keys(recomposed.buildsByServer).sort()).toEqual(['homecoming', 'rebirth', 'thunderspy']);
  });
});

describe('isKnownServerId', () => {
  // Swept from DATASET_IDS rather than listed. This read `homecoming, rebirth, thunderspy`
  // and called them "the three shipped datasets" for as long as there were four — the
  // predicate itself was already roster-driven (`isDatasetId`), so Brainstorm was accepted
  // in the product and unasserted here. A hand list is a second roster, and the second one
  // is the one that goes stale (data-gaps-285).
  it('accepts every shipped dataset and rejects others', () => {
    expect(DATASET_IDS.length).toBeGreaterThan(0);
    for (const id of DATASET_IDS) {
      expect(isKnownServerId(id), `${id} is a known server id`).toBe(true);
    }
    expect(isKnownServerId('bogus')).toBe(false);
    expect(isKnownServerId(undefined)).toBe(false);
  });
});
