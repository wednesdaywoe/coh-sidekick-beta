import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A summon that names redirect POWERS instead of an entity, and how it finds its pet (ENT-16).
 *
 * An `EntCreate` template normally states an `entity_def`. Some state none and list redirect
 * powers instead, and nothing on the summoning power says which entity owns them — so the
 * generated summon carried a `powers` array and no `entity`, and every consumer that starts from
 * the entity name walked nothing. That was free for as long as no such summon had a payload:
 * Homecoming's fourteen redirect to powers no entity declares, and a walk that finds nothing
 * looks exactly like a walk over something empty. Brainstorm's reworked Poison Trap was the
 * first with a real one, and it lost the −1000% Regen its gas cloud still states.
 *
 * The converter now resolves the pointer from data on both sides: the entity's own
 * `defaults.power_full_names` (shipped as the `pet-entity-powers.json` sidecar) against the
 * summon's redirect list, matched as WHOLE SETS. Set equality is the load-bearing part —
 * generic powers like `Pets.ResistAll.ResistAll` are declared by most entities, so an
 * any-member match resolves Meteor to a Lore pet.
 *
 * This grades both halves, because a rule's mistakes live in what it turns away as much as in
 * what it accepts: every resolved summon must name the entity that declares exactly its powers,
 * and every summon still without an entity must be one NO entity declares. A miss and a
 * justified decline are indistinguishable from the counts alone.
 */

const DATASETS = ['homecoming', 'rebirth', 'thunderspy', 'brainstorm'] as const;
const ROOT = fileURLToPath(new URL('./datasets', import.meta.url));

type Summon = {
  entity?: string;
  entities?: unknown[];
  powers?: string[];
  resolvedEntities?: unknown[];
};

/** Every `"summon": { … }` object in a dataset's generated tree, with the file it came from. */
function summonsOf(dataset: string): { file: string; summon: Summon }[] {
  const base = path.join(ROOT, dataset, 'generated');
  const out: { file: string; summon: Summon }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.ts')) collect(p);
    }
  };
  const collect = (file: string) => {
    const text = fs.readFileSync(file, 'utf8');
    // Brace-matched slice rather than a regex: a summon carrying `resolvedEntities` nests
    // several levels of objects, and a non-greedy `\{[^}]*\}` silently truncates it to the
    // first inner brace — which reads as "no entity" on exactly the records this grades.
    for (let at = text.indexOf('"summon":'); at !== -1; at = text.indexOf('"summon":', at + 1)) {
      const open = text.indexOf('{', at);
      if (open === -1) continue;
      let depth = 0;
      let end = open;
      for (; end < text.length; end++) {
        if (text[end] === '{') depth++;
        else if (text[end] === '}' && --depth === 0) break;
      }
      out.push({
        file: path.relative(path.join(ROOT, dataset, 'generated'), file),
        summon: JSON.parse(text.slice(open, end + 1)) as Summon,
      });
    }
  };
  walk(base);
  return out;
}

/** Declared-power-set → entity, from the sidecar the converter joins against. */
function declaredSets(dataset: string): Map<string, string[]> {
  const raw = JSON.parse(
    fs.readFileSync(path.join(ROOT, dataset, 'pet-entity-powers.json'), 'utf8'),
  ) as Record<string, string[]>;
  const byKey = new Map<string, string[]>();
  for (const [entity, powers] of Object.entries(raw)) {
    const key = [...powers].sort().join('\n');
    byKey.set(key, [...(byKey.get(key) ?? []), entity]);
  }
  return byKey;
}

/**
 * Per dataset: summons that state redirect powers and no `entity_def`, and how many of those
 * an entity claims. Pinned in both directions — a drop means the join stopped resolving, a
 * rise means a fork started using the form and nobody looked.
 */
const EXPECTED: Record<(typeof DATASETS)[number], { withPowers: number; resolved: number }> = {
  // Geode ×3, Rise of the Phoenix ×5, the epic Tar Patch/Bonfire/Sleet shells ×5 and pool
  // Corrosive Vial. None resolves: all redirect to `Redirects.*`/`Pets.*_Epic.*` powers that no
  // entity declares, which is why the missing branch cost Homecoming nothing measurable.
  // Issue 28 Page 4 (live 2026-10-06) brought the beta's Poison Trap rework to Homecoming,
  // so it now reads the brainstorm figure below.
  homecoming: { withPowers: 18, resolved: 4 },
  rebirth: { withPowers: 0, resolved: 0 },
  thunderspy: { withPowers: 0, resolved: 0 },
  // Homecoming's fourteen plus the four Poison Traps the beta reworked into pseudo-pets —
  // the only members of the form anywhere whose redirect list an entity declares.
  brainstorm: { withPowers: 18, resolved: 4 },
};

describe.each(DATASETS)('redirect-power summons resolve their entity — %s', (dataset) => {
  const summons = summonsOf(dataset);
  const byKey = declaredSets(dataset);
  // The join's population, and the partition is deliberate: a summon carrying
  // `resolvedEntities` belongs to the pseudo-pet shell path, which names a shell rather than a
  // real entity ON PURPOSE (see the last check here). Grading those by the join's rule would
  // demand the double-count the shell path exists to avoid.
  const withPowers = summons.filter((s) => s.summon.powers?.length && !s.summon.resolvedEntities);

  it('resolves exactly the redirect summons an entity claims, and no others', () => {
    const entityLess = withPowers.filter((s) => !s.summon.entity && !s.summon.entities);
    const resolved = withPowers.filter(
      (s) => s.summon.entity && byKey.get([...s.summon.powers!].sort().join('\n'))?.length === 1,
    );
    expect(
      { withPowers: entityLess.length + resolved.length, resolved: resolved.length },
      `${dataset}: ${entityLess.map((s) => s.file).join(', ')}`,
    ).toEqual(EXPECTED[dataset]);
  });

  it('names the entity that declares exactly those powers, never a different one', () => {
    for (const { file, summon } of withPowers) {
      const claimants = byKey.get([...summon.powers!].sort().join('\n'));
      if (!claimants) continue;
      expect(claimants.length, `${file}: ${claimants.join(', ')} both declare this set`).toBe(1);
      expect(summon.entity, `${file} resolves to the wrong entity`).toBe(claimants[0]);
    }
  });

  it('declines only where no entity declares the set', () => {
    for (const { file, summon } of withPowers) {
      if (summon.entity || summon.entities) continue;
      expect(
        byKey.get([...summon.powers!].sort().join('\n')),
        `${file} was left entity-less though an entity declares its powers`,
      ).toBeUndefined();
    }
  });

  /**
   * The reason the resolution runs LAST in the converter rather than where the summon is first
   * built. A location pseudo-pet gets a synthesized ability list in `resolvedEntities`, and it is
   * pointed at its `priority_list` shell name precisely BECAUSE that name resolves to nothing in
   * the entity table: all three Rust consumers read the entity table FIRST and fall back to
   * `resolvedEntities` only when it produced nothing (`procs::pseudo_pet_abilities`,
   * `granted`, `buff_pets`). Give such a summon a real entity name and that fallback stops
   * firing — the synthesized list, which is the whole payload, is silently replaced by whatever
   * the named entity happens to hold. Resolving early did exactly that to Static Field, Carrion
   * Creepers and Shocking Grasp, whose shells happen to be backed by real entities too.
   *
   * Two powers may carry both, for opposite reasons, and each needs its own warrant:
   *
   *  - Sentinel Whirlpool, the reason the precedence exists: both blocks hold the SAME pet,
   *    identical row for row, so either source answers the same (ENT-8).
   *  - Spirit Tree, since ENT-17: the blocks are DISJOINT. The entity is real and holds a taunt
   *    and the tree's own resistances; the ally +Regen the power exists for lives only in the
   *    synthesized list. `buff_pets` reads whichever actually folded a row rather than whichever
   *    is present, so the aura lands and Whirlpool still doesn't double.
   *
   * A third entry is a finding, not a line to add: it means a payload was replaced rather than
   * complemented.
   */
  it('pairs a synthesized ability list with a real entity only where ENT-8 says it may', () => {
    const entities = new Set([...byKey.values()].flat());
    const both = summons
      .filter((s) => s.summon.resolvedEntities?.length && s.summon.entity)
      .filter((s) => entities.has(s.summon.entity!))
      .map((s) => `${s.file} → ${s.summon.entity}`)
      .sort();
    expect(both).toEqual(
      dataset === 'homecoming' || dataset === 'brainstorm'
        ? [
            'powersets/controller/primary/plant-control/spirit-tree.ts → Pets_Spirit_Tree',
            'powersets/dominator/primary/plant-control/spirit-tree.ts → Pets_Spirit_Tree',
            'powersets/sentinel/primary/water-blast/whirlpool.ts → Pets_Whirlpool_Sentinel',
          ]
        : [],
    );
  });
});
