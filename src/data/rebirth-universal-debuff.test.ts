import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Rebirth "Universal Debuff" category (Witchcraft / Superior Witchcraft).
 *
 * These are multi-aspect debuff event sets (pieces span Defense + Slow + ToHit
 * Debuff). The binary tags them `ECToHitDeBuff` (one of their aspects), which made
 * the exporter label every power that can slot them — via ANY of those aspects —
 * as accepting "To Hit Debuff". That wrongly implied Tar Patch (a Slow/-Res patch
 * with NO to-hit debuff) takes ToHit-debuff sets. The record's own GroupName says
 * "Universal Debuff" and always did — first restored by a curated override, then read
 * straight off the record at data-gaps-40 when the whole inference chain came out.
 */
function gen(rel: string): string {
  const p = fileURLToPath(new URL(`./datasets/rebirth/generated/powersets/${rel}`, import.meta.url));
  return fs.readFileSync(p, 'utf8');
}
function setCats(text: string): string[] {
  const m = text.match(/"allowedSetCategories":\s*\[([^\]]*)\]/s);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

describe('Rebirth Universal Debuff (Witchcraft) categorization', () => {
  it('Tar Patch takes Universal Debuff, NOT To Hit Debuff (slots Witchcraft via Slow)', () => {
    const cats = setCats(gen('defender/primary/dark-miasma/tar-patch.ts'));
    expect(cats).toContain('Universal Debuff');
    expect(cats).toContain('Slow Movement');
    expect(cats).not.toContain('To Hit Debuff');
  });

  it('a genuine -ToHit power (Darkest Night) KEEPS To Hit Debuff and also gains Universal Debuff', () => {
    const cats = setCats(gen('defender/primary/dark-miasma/darkest-night.ts'));
    expect(cats).toContain('To Hit Debuff');     // it has a real to-hit debuff
    expect(cats).toContain('Universal Debuff');  // Witchcraft also slots here
  });
});
