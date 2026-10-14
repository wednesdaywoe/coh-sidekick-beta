import { describe, it, expect, beforeEach } from 'vitest';
import { rememberVaultLink, recallVaultLink } from '@/utils/url-build-sync';

// Node has no sessionStorage; a Map-backed stand-in is all these two touch.
beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe('library link across a hash reload', () => {
  it('comes back for the hash it was recorded against', () => {
    rememberVaultLink('own-hash', 'entry-1');
    expect(recallVaultLink('own-hash')).toBe('entry-1');
  });

  it('never attaches to a different hash, such as a share link opened in this tab', () => {
    rememberVaultLink('own-hash', 'entry-1');
    expect(recallVaultLink('someone-elses-hash')).toBeUndefined();
  });

  it('is forgotten once the build is unlinked', () => {
    rememberVaultLink('own-hash', 'entry-1');
    rememberVaultLink('own-hash', undefined);
    expect(recallVaultLink('own-hash')).toBeUndefined();
  });
});
