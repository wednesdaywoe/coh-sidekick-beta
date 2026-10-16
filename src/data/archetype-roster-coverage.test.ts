/**
 * Every converted powerset is pickable, and every pickable powerset was converted.
 *
 * An archetype's `primarySets` / `secondarySets` decide what the Build Identity menu offers,
 * and they are a hand-maintained list in each dataset's `archetypes.ts`. The converter writes
 * powerset directories; nothing joined the two, so a set could convert cleanly, ship in the
 * contract, pass every corpus gate — and be unpickable, because no roster named it.
 *
 * That is not hypothetical (data-gaps-282). Homecoming shipped Sonic Melee, Wind Control and the
 * Stalker's Stone Armor unreachable, and Brainstorm added Light Affinity and Sonic Aura to the
 * same silence: 23 powersets across the two forks, converted and invisible. The roster generator
 * (`scripts/generate-archetypes.cjs`) derives these lists from disk and would have been right,
 * but it is a bootstrap script and no regen step runs it.
 *
 * Both directions, because each catches a different mistake: a set on disk and off the roster is
 * unreachable content, and a set on the roster with no directory is a menu entry that resolves to
 * nothing. The two read different halves of the tree, and the asymmetry is real rather than
 * convenient: the rosters OWN `primary/` and `secondary/`, so anything there and unnamed is a
 * finding, while a Kheldian names its `epic/` form sets in those same two arrays — so the
 * dangling check has to resolve against `epic/` too or it would report the forms as broken.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ARCHETYPES as HOMECOMING } from '@/data/datasets/homecoming/archetypes';
import { ARCHETYPES as REBIRTH } from '@/data/datasets/rebirth/archetypes';
import { ARCHETYPES as THUNDERSPY } from '@/data/datasets/thunderspy/archetypes';
import { ARCHETYPES as BRAINSTORM } from '@/data/datasets/brainstorm/archetypes';

const REGISTRIES = {
  homecoming: HOMECOMING,
  rebirth: REBIRTH,
  thunderspy: THUNDERSPY,
  brainstorm: BRAINSTORM,
} as const;

const ROOT = path.join(__dirname, 'datasets');

/** `<archetype>/<set>` for every converted primary/secondary powerset directory. */
function convertedSets(dataset: string, slots: readonly string[]): Set<string> {
  const base = path.join(ROOT, dataset, 'powersets');
  const out = new Set<string>();
  for (const at of fs.readdirSync(base)) {
    for (const slot of slots) {
      const dir = path.join(base, at, slot);
      if (!fs.existsSync(dir)) continue;
      for (const set of fs.readdirSync(dir)) out.add(`${at}/${set}`);
    }
  }
  return out;
}

/** Every id the rosters name, across archetypes. */
function rosteredSets(registry: Record<string, { primarySets?: string[]; secondarySets?: string[] }>) {
  const out = new Set<string>();
  for (const at of Object.values(registry)) {
    for (const id of [...(at.primarySets ?? []), ...(at.secondarySets ?? [])]) out.add(id);
  }
  return out;
}

describe.each(Object.keys(REGISTRIES))('archetype roster ↔ converted powersets — %s', (dataset) => {
  const registry = REGISTRIES[dataset as keyof typeof REGISTRIES] as never;
  const rostered = rosteredSets(registry);

  it('offers every powerset the converter produced', () => {
    const converted = convertedSets(dataset, ['primary', 'secondary']);
    const unreachable = [...converted].filter((id) => !rostered.has(id)).sort();
    expect(
      unreachable,
      `${dataset}: converted but unpickable — no archetype roster names ${unreachable.join(', ')}`,
    ).toEqual([]);
  });

  it('offers no powerset the converter did not produce', () => {
    const converted = convertedSets(dataset, ['primary', 'secondary', 'epic']);
    const dangling = [...rostered].filter((id) => !converted.has(id)).sort();
    expect(
      dangling,
      `${dataset}: rostered with no powerset directory — ${dangling.join(', ')}`,
    ).toEqual([]);
  });
});
