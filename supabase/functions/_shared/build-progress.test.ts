/**
 * A build's shopping progress stays on private rows only. The rule is in
 * `build-progress.ts`; the source guards below check that both write paths
 * that can leave a row readable by others apply it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { progressMayStay, withoutProgress } from './build-progress';

const read = (name: string) =>
  readFileSync(new URL(`../${name}/index.ts`, import.meta.url), 'utf8');

describe('progressMayStay', () => {
  it('keeps progress on a private row only', () => {
    expect(progressMayStay('private')).toBe(true);
    expect(progressMayStay('unlisted')).toBe(false);
    expect(progressMayStay('public')).toBe(false);
  });

  it('refuses anything it does not recognise', () => {
    expect(progressMayStay(null)).toBe(false);
    expect(progressMayStay(undefined)).toBe(false);
    expect(progressMayStay('')).toBe(false);
    expect(progressMayStay('Private')).toBe(false);
  });
});

describe('withoutProgress', () => {
  const saved = {
    version: 5,
    build: { dataset: 'homecoming', level: 50, progress: { enhancements: { 'generic:Defense|50|0|0': 1 } } },
  };

  it('drops build.progress and nothing else', () => {
    expect(withoutProgress(saved)).toEqual({ version: 5, build: { dataset: 'homecoming', level: 50 } });
  });

  it('leaves the caller’s object alone', () => {
    withoutProgress(saved);
    expect(saved.build.progress).toBeDefined();
  });

  it('passes through a build with no progress, or a body of the wrong shape', () => {
    const plain = { version: 5, build: { level: 50 } };
    expect(withoutProgress(plain)).toBe(plain);
    expect(withoutProgress(null)).toBe(null);
    expect(withoutProgress('text')).toBe('text');
    expect(withoutProgress({ version: 5 })).toEqual({ version: 5 });
  });
});

describe('the write paths apply it', () => {
  it('share-build strips on both the update and the insert', () => {
    const source = read('share-build');
    expect(source).toMatch(/progressMayStay\(effectiveVisibility\)/);
    expect(source).toMatch(/progressMayStay\(visibility\)/);
  });

  it('update-build-visibility strips when a row leaves private', () => {
    const source = read('update-build-visibility');
    expect(source).toMatch(/progressMayStay\(visibility\)/);
    expect(source).toMatch(/withoutProgress\(/);
  });
});
