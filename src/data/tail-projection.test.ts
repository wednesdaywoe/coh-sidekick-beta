import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards on the AttribMod-tail converter projection (DATA-GAP-REGISTER data-gaps-81
 * residual, closed 2026-07-20), scanning the COMMITTED generated data with no
 * raw-export dependency — same standing as converter-invariants.test.ts.
 *
 *   1. `requiredEvents` reaches the atom wire (tuple field 30) and every
 *      carrier is `gated` — an event-gated mod (bonus damage vs Held/Slept
 *      targets, per-mez debuffs) fires only while the event is live, so it
 *      must never sit in the unconditional base. Pinned on the three powers
 *      whose base bags the projection corrected.
 *   2. The alpha ED-bypass split is emitted per aspect and is always a
 *      sub-slice of the total (the BoostIgnoreDiminishing / `Ones` portion of
 *      the silent grant). Pinned per dataset, including the Thunderspy
 *      divergence the old per-tier ratio fabricated away.
 *
 * If one of these fails, regenerate the affected data or fix the converter —
 * don't edit the generated file.
 */

const DATASETS_DIR = fileURLToPath(new URL('./datasets', import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(DATASETS_DIR, f), 'utf8');

// ATOM_TUPLE_FIELDS positions (see src/data/core/atomic-effect.ts). Kept as
// numbers so this file stays alias-free and runnable in the pipeline checkout.
const GATED_IDX = 23;
const REQUIRED_EVENTS_IDX = 29;

/** Parse every atom tuple out of a generated power/pool file. */
function atomsOf(source: string): (string | number | boolean | null)[][] {
  const out: (string | number | boolean | null)[][] = [];
  for (const m of source.matchAll(/^\s+(\[.*\]),?$/gm)) {
    try {
      const t = JSON.parse(m[1]);
      if (Array.isArray(t) && typeof t[0] === 'string') out.push(t);
    } catch {
      /* non-tuple bracket line (e.g. string arrays) — not an atom */
    }
  }
  return out;
}

function requiredEventAtoms(source: string) {
  return atomsOf(source).filter((t) => typeof t[REQUIRED_EVENTS_IDX] === 'string');
}

describe('requiredEvents projection (atom wire field 30)', () => {
  it('every requiredEvents carrier is gated — event-gated mods are never base', () => {
    const roots = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'].map((ds) =>
      path.join(DATASETS_DIR, ds, 'generated'),
    );
    const offenders: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts')) {
          for (const t of requiredEventAtoms(fs.readFileSync(p, 'utf8'))) {
            if (t[GATED_IDX] !== true) offenders.push(`${p}: ${JSON.stringify(t)}`);
          }
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });

  it('Sonic Thrust carries the Held,Sleep gate on its event-gated Energy damage', () => {
    const src = read('homecoming/generated/powersets/stalker/primary/sonic-melee/sonic-thrust.ts');
    const gates = requiredEventAtoms(src).map((t) => t[REQUIRED_EVENTS_IDX]);
    expect(gates).toContain('Held,Sleep');
  });

  it('Confounding Chant keeps ONE base Psionic DoT; the Stunned-only twin is gated', () => {
    const src = read(
      'homecoming/generated/powersets/dominator/primary/symphony-control/confounding-chant.ts',
    );
    const damage = atomsOf(src).filter((t) => t[0] === 'Damage' && t[1] === 'Psionic');
    const base = damage.filter((t) => t[GATED_IDX] !== true);
    const stunnedGated = damage.filter((t) => t[REQUIRED_EVENTS_IDX] === 'Stunned');
    expect(base).toHaveLength(1);
    expect(stunnedGated).toHaveLength(1);
    expect(stunnedGated[0][GATED_IDX]).toBe(true);
  });

  it('epic Possess: the -ToHit vs Confused is gated, not a base debuff', () => {
    const src = read('homecoming/generated/epic-pools.ts');
    const gated = atomsOf(src).filter(
      (t) => t[0] === 'ToHit' && t[REQUIRED_EVENTS_IDX] === 'Confused',
    );
    expect(gated.length).toBeGreaterThan(0);
    for (const t of gated) expect(t[GATED_IDX]).toBe(true);
  });
});

describe('alpha ED-bypass split (GENERATED_ALPHA_ED_BYPASS)', () => {
  function tables(ds: string) {
    const src = read(`${ds}/generated/incarnate-effects.ts`);
    const grab = (name: string): Record<string, Record<string, number>> => {
      const m = src.match(new RegExp(`export const ${name}[^{]*\\{([\\s\\S]*?)\\n\\};`));
      expect(m, `${ds}: ${name} missing`).toBeTruthy();
      const entries: Record<string, Record<string, number>> = {};
      for (const row of m![1].matchAll(/'([^']+)': (\{.*\}),/g)) {
        entries[row[1]] = JSON.parse(row[2]);
      }
      return entries;
    };
    return { totals: grab('GENERATED_ALPHA_EFFECTS'), bypass: grab('GENERATED_ALPHA_ED_BYPASS') };
  }

  it.each(['homecoming', 'rebirth', 'thunderspy', 'brainstorm'])(
    '%s: every bypass value is a sub-slice of its aspect total',
    (ds) => {
      const { totals, bypass } = tables(ds);
      expect(Object.keys(bypass).length).toBeGreaterThan(0);
      for (const [power, aspects] of Object.entries(bypass)) {
        for (const [aspect, value] of Object.entries(aspects)) {
          const total = totals[power]?.[aspect];
          expect(total, `${ds}/${power}.${aspect} bypass without total`).toBeDefined();
          expect(value).toBeGreaterThan(0);
          expect(value).toBeLessThanOrEqual(total! + 1e-9);
        }
      }
    },
  );

  it('homecoming Musculature Radial Paragon: 33% damage with 22% bypass (2/3)', () => {
    const { totals, bypass } = tables('homecoming');
    expect(totals['musculature_radial_paragon'].damage).toBeCloseTo(0.33, 9);
    expect(bypass['musculature_radial_paragon'].damage).toBeCloseTo(0.22, 9);
  });

  it('thunderspy Agility recharge: 33% with 22% bypass, read from the flag', () => {
    // tspy reported no bypass at all until its AttribMod flags word was decoded
    // (data-gaps-74) — the absence was a parse gap, not a fork difference. Its silent file
    // splits 0.11 plain + 0.22 `BoostIgnoreDiminishing`, the same 2/3 Homecoming's
    // Musculature carries above. Still read from the DATA, never a per-tier ratio.
    const { totals, bypass } = tables('thunderspy');
    expect(totals['agility_core_paragon'].recharge).toBeCloseTo(0.33, 9);
    expect(bypass['agility_core_paragon'].recharge).toBeCloseTo(0.22, 9);
  });
});
