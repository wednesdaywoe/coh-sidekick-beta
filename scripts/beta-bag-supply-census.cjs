/**
 * BPORT1 — supply census for the `effects` bag, across all four datasets.
 *
 * The data-gaps-327 beta port (`docs/streams/strip1-beta-port.md` in the canonical repo) has to
 * decide, per bag slot, whether the reader that spends it is doing work or standing over an
 * empty shelf. Reading the reader cannot answer that: ~30 of the ~45 slot reads are
 * `atomFn(power) ?? effects.slot` seams whose right-hand side still serves atom-less
 * synthetics, so a seam that looks retired is load-bearing and a seam that looks live may
 * never fire. Only supply settles it, and **supply 0 in every supplier is the only thing
 * that proves a branch dead**.
 *
 * There are FIVE suppliers. The stream doc named three; the two it did not name are the
 * display edge's, and they are the reason a naive census reports `castTime`, `enduranceCost`
 * and `healing` as dead branches when every power's info panel spends them:
 *
 *   1. `power.effects`                — the converter-emitted bag on a generated power.
 *   2. `power.conditionalEffects[].effects` — the per-conditional delta bag. Powers get these
 *      from mode/stance gates; `expandActiveConditionals` turns an active one into a
 *      synthetic power whose whole payload is that bag, so it reaches every slot reader
 *      with no atom behind it.
 *   3. `buffPetAuraEffects`           — seven slots minted in-process from a pet entity's
 *      ally auras (`getBuffPetSources`). These are `PetEffect` rows off the pet's own
 *      abilities; no player power's atom list carries them.
 *   4. `buildDisplayEffects(power)`   — the display bag (PROD6C-3a). It spreads the authored
 *      bag and then MINTS on top of it out of `power.stats` (`enduranceCost`, `castTime`,
 *      `recharge`, `accuracy`, `range`, `radius`, `maxTargets`, `arc`), out of the damage
 *      array (`healing`), out of a summon's lifespan (`buffDuration`), and out of the nested
 *      `movement` container (the flat `fly` / `runSpeed` / `jumpSpeed` / `jumpHeight` axes).
 *      Every InfoPanel / tooltip / compare-modal read goes through this, so a slot with no
 *      converter supply can still be spent on every power that has the stat.
 *   5. `withPseudoPetEffects(power, …)` — merges a pseudo-pet's synthesized debuffs UNDER
 *      the display bag, filling keys the parent does not carry (Glue Arrow delivers its
 *      whole enhanceable debuff through a pet).
 *
 * `withTargetsHit` sits between (4) and (5) and is deliberately not counted: it rescales
 * values that are already present and mints no key, so it cannot move a slot off zero.
 *
 * The mapping in (3) lives in a `switch` inside the frozen `legacy-totals.oracle.ts` and is
 * restated here as {@link BUFF_PET_MINTED_SLOTS} rather than imported, because the oracle
 * does not export it and this census is not a reason to edit a file whose header says it
 * gains nothing. `beta-bag-supply-census.test.ts` holds the tripwire that fails when the
 * oracle's switch and this table part company. (4) and (5) are called directly — no table to
 * drift.
 *
 * WHAT THIS DOES NOT DECIDE. Presence is the census's answer. Whether a present value is
 * *material* — a scale-0 row, a `{translucency:…}` authoring artifact, a foe-facing value a
 * self-directed gate drops — is a per-slot credit predicate, and that adjudication is
 * BPORT4's, one seam at a time. `nonZero` below is advisory: any numeric leaf ≠ 0, which
 * over-counts a live table name beside a dead scale and is reported only to say which DEAD
 * verdicts are dead by absence and which by vacuity.
 *
 * Run: `node scripts/beta-bag-supply-census.cjs` (add `--json` for the machine-readable
 * dump). Importable: `require('./beta-bag-supply-census.cjs').census()`.
 */

require('tsx/cjs');
const fs = require('fs');
const path = require('path');

const { REPO, collectPowers } = require('./planb-shadow-sweep.cjs');
const { ALL_DATASETS } = require('./_dataset-paths.cjs');

/**
 * The bag's declared vocabulary, read out of the `PowerEffects` interface rather than
 * listed here.
 *
 * A hand-copied roster is how a slot gets added to the type and silently skipped by the
 * census that was supposed to grade it. Parsing the interface means a new slot joins the
 * population by construction; a slot the parse cannot find is a hard failure, not a
 * shorter list.
 */
function declaredSlots() {
  const src = fs.readFileSync(path.join(REPO, 'src/types/power.ts'), 'utf8');
  const start = src.indexOf('export interface PowerEffects {');
  if (start === -1) throw new Error('PowerEffects interface not found in src/types/power.ts');
  const end = src.indexOf('\n}', start);
  if (end === -1) throw new Error('PowerEffects interface has no closing brace');
  const body = src.slice(start, end);
  const slots = [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]);
  if (slots.length < 50) {
    throw new Error(`PowerEffects parse found only ${slots.length} slots — the shape changed`);
  }
  return slots;
}

/**
 * The seven slots `buffPetAuraEffects` writes, keyed by the `PetEffect.type` that mints
 * each. Mirrors the oracle's switch; the test asserts it still does.
 */
const BUFF_PET_MINTED_SLOTS = {
  DefenseBuff: 'defense',
  ResistanceBuff: 'resistance',
  Absorb: 'absorb',
  RegenBuff: 'regenBuff',
  RecoveryBuff: 'recoveryBuff',
  ToHitBuff: 'tohitBuffUnenhanced',
  RechargeBuff: 'rechargeBuff',
};

/**
 * Bag reads whose key is computed, with the constant that supplies the key domain.
 *
 * A regex over `effects.slot` cannot see these, and a census that quietly omits them
 * reports "no reader" for a slot eight lines of the totals depend on. Each entry names
 * where the domain is declared so a reader can check the copy against its source.
 *
 * A site states its domain one of two ways. `keys` is a literal roster, for the three
 * places a short list is written out at the read site; a name there that `PowerEffects`
 * does not declare is a typo and throws. `derive` parses the domain out of its declaring
 * file, for the two rosters too long to copy — BPORT3's finding was that both of those
 * had no entry here at all, and the census consequently reported eleven slots the info
 * panel renders on every power as "bag with no spender". A derived roster may legitimately
 * name something the type does not declare (`SELF_TOTAL_EFFECT_KEYS` names four such), so
 * those are reported under `dynamicKeysUndeclared` rather than thrown on: the roster is
 * the code's own claim about the bag, and a claim the type contradicts is a finding.
 *
 * The register is checked against the code by {@link assertSitesLive}, because a hand-kept
 * roster can go stale in the direction that reads as progress. `ROUTED_SUBTYPES` left this
 * list at BPORT6: `power-row-utils` went atom-native and deleted the constant, and until the
 * check landed the site went on minting two seams for a read that no longer existed — two
 * casualties reported for a migration that had already happened.
 */
const DYNAMIC_READ_SITES = [
  {
    file: 'src/utils/calculations/legacy-totals.oracle.ts',
    symbol: 'mezProtTypes',
    keys: ['hold', 'stun', 'immobilize', 'sleep', 'confuse', 'fear', 'knockback', 'knockup'],
  },
  {
    file: 'src/utils/calculations/inherents.ts',
    symbol: 'DOMINATION_MEZ_KEYS',
    keys: ['hold', 'stun', 'sleep', 'immobilize', 'confuse', 'fear'],
  },
  {
    // `resolvePowerMagnitudes` never names a slot. It walks `Object.entries(effects)` and
    // keeps whatever `EFFECT_REGISTRY` registers (`groupEffectsByCategory`), so its domain
    // is the registry's key set.
    //
    // It lists as OUTSIDE the display closure below, which is the honest report and not the
    // answer: the closure is discovered one hop, by import of `buildDisplayEffects`, and
    // this file imports none. BPORT3 adjudicated the reach question the report defers — its
    // sole importer is `SharedPowerComponents`, and all three renderers of that component's
    // `RegistryEffectsDisplay` (InfoPanel, PowerInfoTooltip, CompareSlottingModal) do build
    // a display bag, so the mint-only slots DO supply it. Pinned in `beta-display.test.ts`
    // rather than folded into the closure here, because widening the discovery rule to a
    // transitive one absorbs 21 files including the two (`DamageBlock`, `PowerInfoBlocks`)
    // this census deliberately leaves undecided.
    file: 'src/components/info/resolvePowerMagnitudes.ts',
    symbol: 'EFFECT_REGISTRY',
    derive: (declared) => registryKeys(declared),
  },
  {
    // `adjusterAffectsSelfTotals` tests a conditional's bag keys against a roster. Its
    // supplier is #2, never `power.effects`, so a slot with zero `cond` supply is inert
    // here however well supplied it is elsewhere.
    file: 'src/engine/characterStateAdapter.ts',
    symbol: 'SELF_TOTAL_EFFECT_KEYS',
    derive: () => setLiteralKeys('src/engine/characterStateAdapter.ts', 'SELF_TOTAL_EFFECT_KEYS'),
  },
];

/**
 * Every site in {@link DYNAMIC_READ_SITES} still declares the constant it names.
 *
 * The `derive` sites check themselves — they parse the declaration, and throw when it is
 * gone. The `keys` sites copy the roster instead, so nothing tied them to the code they
 * describe: a site whose constant had been deleted kept minting its seams forever, and the
 * seams it minted were casualties of a strip that could no longer reach them.
 *
 * Throws rather than skips, for the same reason the missing-file case throws: a register
 * that thins out silently reports LESS work, which is the direction a reader will not
 * question.
 */
function assertSitesLive() {
  for (const site of DYNAMIC_READ_SITES) {
    const abs = path.join(REPO, site.file);
    if (!fs.existsSync(abs)) throw new Error(`dynamic read site file missing: ${site.file}`);
    // Only the copied rosters. A `derive` site parses its constant out of wherever it lives
    // and throws there when it is gone, and that constant is often imported rather than
    // declared at the read site — `EFFECT_REGISTRY` is `effect-registry.ts`'s.
    if (site.derive) continue;
    const src = fs.readFileSync(abs, 'utf8');
    if (!new RegExp(`(?:const|let|var|function)\\s+${site.symbol}\\b`).test(src)) {
      throw new Error(
        `dynamic read site ${site.symbol} is no longer declared in ${site.file} — `
        + 'if the read was migrated, drop the entry; if it was renamed, rename it here.',
      );
    }
  }
}

/**
 * Every key `EFFECT_REGISTRY` registers, plus the `<base>Unenhanced` spelling of each.
 *
 * Parsed rather than listed for the reason {@link declaredSlots} is: a registration added
 * tomorrow joins the census by itself. The split-slot half is part of the domain because
 * `groupEffectsByCategory` resolves an unregistered `fooUnenhanced` through `foo` — the
 * converter's IgnoreStrength verdict spelled as a key — so those slots are read by the same
 * walk without appearing in the registry.
 */
function registryKeys(declared) {
  const src = fs.readFileSync(path.join(REPO, 'src/data/core/effect-registry.ts'), 'utf8');
  const start = src.indexOf('export const EFFECT_REGISTRY');
  if (start === -1) throw new Error('EFFECT_REGISTRY not found in src/data/core/effect-registry.ts');
  const end = src.indexOf('\n};', start);
  if (end === -1) throw new Error('EFFECT_REGISTRY has no closing brace');
  const keys = [...src.slice(start, end).matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*\{/gm)].map((m) => m[1]);
  if (keys.length < 50) {
    throw new Error(`EFFECT_REGISTRY parse found only ${keys.length} keys -- the shape changed`);
  }
  // Only the split halves the type actually declares. `groupEffectsByCategory` would resolve
  // any `fooUnenhanced` through `foo`, but a spelling `PowerEffects` does not declare is one
  // no bag carries, so generating all 69 would report sixty-odd inert names as findings.
  return [...keys, ...keys.map((k) => `${k}Unenhanced`).filter((k) => declared.has(k))];
}

/** The string members of a `new Set([...])` const, for a roster written out at its read site. */
function setLiteralKeys(rel, symbol) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const start = src.indexOf(`const ${symbol}`);
  if (start === -1) throw new Error(`${symbol} not found in ${rel}`);
  const open = src.indexOf('new Set([', start);
  const close = src.indexOf(']', open);
  if (open === -1 || close === -1) throw new Error(`${symbol} in ${rel} is not a \`new Set([...])\` literal`);
  const keys = [...src.slice(open, close).matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((m) => m[1]);
  if (keys.length === 0) throw new Error(`${symbol} in ${rel} parsed to an empty roster`);
  return keys;
}

/**
 * Pre-seed the require cache for the two modules the display path pulls in that cannot load
 * outside Vite.
 *
 * `buildDisplayEffects` imports `healing`, which reaches `@/data`'s barrel and from there the
 * whole calculation index — so requiring it drags in two browser-only module scopes. Neither
 * is on any path the census evaluates:
 *
 *   - `src/utils/paths.ts` reads `import.meta.env.BASE_URL` at module scope, `undefined`
 *     under tsx's CJS hook. It resolves asset URLs.
 *   - `src/engine/engine.ts` imports the wasm binary as a `?url` asset, which the CJS loader
 *     tries to parse as JavaScript. Only `engineTotals` / two components call into it.
 *
 * Two stubs, listed, rather than a blanket loader shim: a Vite-only module that appears in
 * this closure LATER should break the census loudly and get adjudicated, not be papered over
 * in advance. The engine's exports throw for the same reason — reaching one would mean the
 * census had started measuring something it has no business evaluating.
 */
const VITE_ONLY_STUBS = () => {
  const resolvePath = (p) => (typeof p === 'string' && p.startsWith('/') ? `/${p.slice(1)}` : p);
  const unreachable = (name) => () => {
    throw new Error(`beta-bag-supply-census: stubbed engine export ${name}() was called`);
  };
  return {
    'src/utils/paths.ts': { BASE_URL: '/', resolvePath, getImagePath: (p) => resolvePath(`/img/${p}`) },
    'src/engine/engine.ts': {
      recalcJson: unreachable('recalcJson'),
      whatIfVocabulary: unreachable('whatIfVocabulary'),
      loadDataset: unreachable('loadDataset'),
      projectPowerJson: unreachable('projectPowerJson'),
      targetRanksJson: unreachable('targetRanksJson'),
    },
  };
};

function stubViteOnlyModules() {
  for (const [rel, exports] of Object.entries(VITE_ONLY_STUBS())) {
    const id = require.resolve(path.join(REPO, rel));
    if (require.cache[id]) continue;
    require.cache[id] = { id, filename: id, loaded: true, children: [], paths: [], exports };
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Any numeric leaf ≠ 0, anywhere in the value. Advisory only — see the header. */
function hasNonZeroNumber(value, depth = 0) {
  if (depth > 6) return false;
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.some((v) => hasNonZeroNumber(v, depth + 1));
  if (isPlainObject(value)) return Object.values(value).some((v) => hasNonZeroNumber(v, depth + 1));
  return false;
}

/**
 * Every named node in a generated module that carries a bag, a conditional list, or atoms.
 *
 * Deliberately WIDER than the shared sweep's `isPower`, which requires an `atoms` array.
 * That predicate is right for a gate comparing atom output to bag output — a power with no
 * atoms has nothing to compare — and wrong for a supply census, where a bag with no atoms
 * behind it is the single most interesting row on the sheet. The two populations are
 * reconciled per dataset (`narrowMissed`) rather than assumed equal.
 *
 * `effects` is required to be an object: `resolvedPseudoPets` ability rows carry a `name`
 * and an `effects` ARRAY of effect rows, which is a different shape wearing the same field
 * name.
 */
function collectBagCarriers(node, out = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const v of node) collectBagCarriers(v, out, seen);
    return out;
  }
  if (typeof node.name === 'string'
    && (Array.isArray(node.atoms) || isPlainObject(node.effects) || Array.isArray(node.conditionalEffects))) {
    out.push(node);
  }
  for (const v of Object.values(node)) collectBagCarriers(v, out, seen);
  return out;
}

function generatedModules(dataset) {
  const root = path.join(REPO, 'src/data/datasets', dataset, 'generated');
  if (!fs.existsSync(root)) throw new Error(`dataset "${dataset}" has no generated tree at ${root}`);
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.ts') && e.name !== 'index.ts') files.push(p);
    }
  }
  return files.sort();
}

/**
 * Activate `dataset` so the pet-entity facade resolves against it, then hand back the
 * readers whose answers depend on which dataset is active.
 *
 * `getBuffPetSources` and `withPseudoPetEffects` both reach `PET_ENTITIES` through
 * `getActiveDataset()`, so a census that forgot to switch would grade three datasets
 * against Homecoming's pet roster and call the agreement evidence.
 */
function readersFor(dataset) {
  stubViteOnlyModules();
  const { activateDataset } = require(path.join(REPO, 'src/data/dataset.ts'));
  const mod = require(path.join(REPO, 'src/data/datasets', dataset, 'index.ts'));
  activateDataset(mod.default);
  const { PET_ENTITIES } = require(path.join(REPO, 'src/data/pet-entities.ts'));
  const { getBuffPetSources } = require(path.join(REPO, 'src/utils/calculations/buff-pet-auras.ts'));
  const { buildDisplayEffects, withPseudoPetEffects } = require(path.join(REPO, 'src/components/info/buildDisplayEffects.ts'));
  return { PET_ENTITIES, getBuffPetSources, buildDisplayEffects, withPseudoPetEffects };
}

function emptyTally(slots) {
  const t = {};
  for (const s of slots) {
    t[s] = {
      own: 0, ownNonZero: 0, cond: 0, condNonZero: 0,
      petReachable: 0, petRoster: 0, displayMint: 0, pseudoPetMint: 0,
    };
  }
  return t;
}

function addInto(target, source) {
  for (const [slot, counts] of Object.entries(source)) {
    for (const [k, v] of Object.entries(counts)) target[slot][k] += v;
  }
}

/**
 * Walk one dataset and count, per slot, how many carriers each of the three suppliers has.
 *
 * `own` and `cond` count CARRIERS, not values: one power with `effects.defense` counts once
 * however many damage types the container holds, because the question is whether any power
 * would feed the reader at all.
 */
function censusDataset(dataset, slots) {
  const tally = emptyTally(slots);
  const undeclared = new Map();
  const undeclaredMints = new Map();
  let powers = 0;
  let conditionals = 0;
  let bagCarriers = 0;
  let bagWithoutAtoms = 0;
  let narrowMissed = 0;
  let displayFailures = 0;

  const { PET_ENTITIES, getBuffPetSources, buildDisplayEffects, withPseudoPetEffects } = readersFor(dataset);

  for (const file of generatedModules(dataset)) {
    const mod = require(file);
    const wide = collectBagCarriers(mod);
    const narrow = new Set(collectPowers(mod));
    for (const power of wide) {
      powers++;
      if (!narrow.has(power)) narrowMissed++;

      const bag = isPlainObject(power.effects) ? power.effects : null;
      if (bag) {
        bagCarriers++;
        if (!Array.isArray(power.atoms)) bagWithoutAtoms++;
        for (const [key, value] of Object.entries(bag)) {
          if (value === undefined) continue;
          if (!(key in tally)) {
            undeclared.set(key, (undeclared.get(key) ?? 0) + 1);
            continue;
          }
          tally[key].own += 1;
          if (hasNonZeroNumber(value)) tally[key].ownNonZero += 1;
        }
      }

      for (const c of power.conditionalEffects ?? []) {
        conditionals++;
        if (!isPlainObject(c.effects)) continue;
        for (const [key, value] of Object.entries(c.effects)) {
          if (value === undefined) continue;
          if (!(key in tally)) {
            undeclared.set(key, (undeclared.get(key) ?? 0) + 1);
            continue;
          }
          tally[key].cond += 1;
          if (hasNonZeroNumber(value)) tally[key].condNonZero += 1;
        }
      }

      // Supply (3) as the totals actually reaches it: through a summon the player owns.
      // The roster count below is the upper bound — an entity that mints the slot whether
      // or not any player power summons it.
      const summon = bag?.summon;
      if (summon) {
        const minted = new Set();
        for (const src of getBuffPetSources(summon)) {
          for (const aura of src.auras) {
            const slot = BUFF_PET_MINTED_SLOTS[aura.type];
            if (slot) minted.add(slot);
          }
        }
        for (const slot of minted) tally[slot].petReachable += 1;
      }

      // Suppliers (4) and (5), counted as MINTS: a key the display bag carries that the
      // authored bag did not. Counting presence instead would just restate `own` for every
      // key the spread carried through, and the question here is what the display edge adds.
      const authored = new Set(bag ? Object.keys(bag) : []);
      let displayBag;
      try {
        displayBag = buildDisplayEffects(power);
      } catch {
        // A power the display path cannot build is a finding, not a skip — a census that
        // swallowed it would under-report every slot that power supplies.
        displayFailures++;
        continue;
      }
      const noteMint = (key, field) => {
        if (authored.has(key)) return;
        if (!(key in tally)) {
          undeclaredMints.set(key, (undeclaredMints.get(key) ?? 0) + 1);
          return;
        }
        tally[key][field] += 1;
      };
      for (const key of Object.keys(displayBag)) noteMint(key, 'displayMint');
      const withPet = withPseudoPetEffects(power, displayBag);
      if (withPet !== displayBag) {
        const displayed = new Set(Object.keys(displayBag));
        for (const key of Object.keys(withPet)) {
          if (!displayed.has(key)) noteMint(key, 'pseudoPetMint');
        }
      }
    }
  }

  for (const name of Object.keys(PET_ENTITIES)) {
    const minted = new Set();
    for (const src of getBuffPetSources({ entity: name })) {
      for (const aura of src.auras) {
        const slot = BUFF_PET_MINTED_SLOTS[aura.type];
        if (slot) minted.add(slot);
      }
    }
    for (const slot of minted) tally[slot].petRoster += 1;
  }

  return {
    tally,
    undeclared: Object.fromEntries(undeclared),
    undeclaredMints: Object.fromEntries(undeclaredMints),
    counts: { powers, conditionals, bagCarriers, bagWithoutAtoms, narrowMissed, displayFailures },
  };
}

/**
 * Every `effects.<slot>` read in non-test source, keyed by slot.
 *
 * Derived rather than listed for the same reason the vocabulary is: a read site added
 * tomorrow joins the census by itself. The bare-`effects` form is matched (not just
 * `power.effects`) because the seams destructure, and a local named `effects` that is not a
 * bag is filtered out by intersecting against the declared vocabulary — which also means a
 * read of a slot the type does not declare is invisible here and shows up instead as a
 * `readsUndeclared` row.
 */
/**
 * The files that build a display bag themselves, by importing `buildDisplayEffects` (or one of
 * the two transforms that run on its output).
 *
 * A mint-only slot — supply 4 or 5 and nothing from the converter — is spendable ONLY where
 * the display bag reaches. A read of such a slot in a file outside this set is reading the
 * authored bag, and for that reader the slot has no supply at all. The set is the direct
 * importers only: a surface handed the bag as a prop (`DamageBlock`, `PowerInfoBlocks`) is not
 * detectable this way and shows up as "outside", which is a question to answer per seam rather
 * than a verdict. Naming the ambiguity beats a list that silently decides it.
 */
function displayBagBuilders() {
  const builders = new Set(['src/components/info/buildDisplayEffects.ts']);
  const roots = [path.join(REPO, 'src')];
  while (roots.length) {
    const dir = roots.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { roots.push(p); continue; }
      if (!/\.tsx?$/.test(e.name) || /\.(test|spec)\.tsx?$/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (/import\s*\{[^}]*\b(buildDisplayEffects|withPseudoPetEffects|withTargetsHit)\b/.test(src)) {
        builders.add(path.relative(REPO, p));
      }
    }
  }
  return builders;
}

function readSites(slots) {
  const declared = new Set(slots);
  const bySlot = new Map();
  const readsUndeclared = new Map();
  const roots = [path.join(REPO, 'src')];
  const files = [];
  while (roots.length) {
    const dir = roots.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { roots.push(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (/\.(test|spec)\.tsx?$/.test(e.name)) continue;
      files.push(p);
    }
  }
  for (const file of files.sort()) {
    const rel = path.relative(REPO, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\beffects(?:\?)?\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        const slot = m[1];
        const bucket = declared.has(slot) ? bySlot : readsUndeclared;
        if (!bucket.has(slot)) bucket.set(slot, []);
        // `??` on the same line is the atom-vs-bag seam shape the port cares about. A
        // heuristic, and labelled as one: a seam split across two lines reads as `direct`.
        bucket.get(slot).push({ file: rel, line: i + 1, seam: line.includes('??') ? 'fallback' : 'direct' });
      }
    });
  }
  const dynamicKeysUndeclared = {};
  assertSitesLive();
  for (const site of DYNAMIC_READ_SITES) {
    for (const slot of site.derive ? site.derive(declared) : site.keys) {
      if (!declared.has(slot)) {
        // A hand-written roster naming a slot the type does not declare is a typo. A
        // derived one is the declaring code's own claim, and a claim the type contradicts
        // is a finding to report — the roster names a key no bag can ever carry, so that
        // arm of the reader is inert.
        if (!site.derive) throw new Error(`dynamic read site ${site.symbol} names undeclared slot "${slot}"`);
        (dynamicKeysUndeclared[site.symbol] ??= []).push(slot);
        continue;
      }
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot).push({ file: site.file, line: null, seam: `dynamic:${site.symbol}` });
    }
  }
  return { bySlot, readsUndeclared, dynamicKeysUndeclared };
}

function census({ datasets = ALL_DATASETS } = {}) {
  const slots = declaredSlots();
  const total = emptyTally(slots);
  const perDataset = {};
  const undeclared = new Map();
  const undeclaredMints = new Map();
  const counts = {};

  for (const dataset of datasets) {
    const r = censusDataset(dataset, slots);
    perDataset[dataset] = r.tally;
    counts[dataset] = r.counts;
    addInto(total, r.tally);
    for (const [k, v] of Object.entries(r.undeclared)) undeclared.set(k, (undeclared.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(r.undeclaredMints)) undeclaredMints.set(k, (undeclaredMints.get(k) ?? 0) + v);
  }

  const { bySlot, readsUndeclared, dynamicKeysUndeclared } = readSites(slots);
  const builders = displayBagBuilders();

  const rows = slots.map((slot) => {
    const t = total[slot];
    const dataSupply = t.own + t.cond;
    const mintSupply = t.petReachable + t.displayMint + t.pseudoPetMint;
    const supply = dataSupply + mintSupply;
    const sites = bySlot.get(slot) ?? [];
    return {
      slot,
      ...t,
      dataSupply,
      mintSupply,
      supply,
      verdict: supply === 0 ? 'DEAD' : 'LIVE',
      // The distinction the port turns on. A slot supplied only by a mint survives the
      // converter strip untouched, because the mint reads `stats` / pet rows / a summon's
      // lifespan, none of which the strip removes; a slot supplied only by the data goes to
      // zero the moment BPORT7 lands. Neither is "dead" — they die on different days.
      survivesStrip: dataSupply === 0 && mintSupply > 0,
      diesWithStrip: mintSupply === 0 && dataSupply > 0,
      // A slot whose only non-zero count is `own`/`cond` at zero materiality: dead by
      // vacuity rather than by absence. BPORT4 owes the per-slot predicate that settles it.
      vacuous: supply > 0 && t.ownNonZero + t.condNonZero + mintSupply === 0,
      readCount: sites.length,
      readFiles: [...new Set(sites.map((s) => s.file))].sort(),
      readFilesOutsideDisplay: [...new Set(sites.map((s) => s.file))].filter((f) => !builders.has(f)).sort(),
      seams: sites,
    };
  });

  return {
    datasets,
    slots,
    rows,
    perDataset,
    counts,
    undeclaredInData: Object.fromEntries(undeclared),
    undeclaredMints: Object.fromEntries(undeclaredMints),
    readsUndeclared: Object.fromEntries([...readsUndeclared].map(([k, v]) => [k, v.length])),
    dynamicKeysUndeclared,
    buffPetMintedSlots: BUFF_PET_MINTED_SLOTS,
    displayBagBuilders: [...builders].sort(),
  };
}

function report(result) {
  const out = [];
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);

  out.push('=== BPORT1 — beta bag supply census ===\n');
  out.push(`datasets: ${result.datasets.join(', ')}`);
  for (const ds of result.datasets) {
    const c = result.counts[ds];
    out.push(`  ${pad(ds, 12)} powers ${num(c.powers, 5)}  bag-carriers ${num(c.bagCarriers, 5)}`
      + `  conditionals ${num(c.conditionals, 4)}  bag-without-atoms ${num(c.bagWithoutAtoms, 4)}`
      + `  missed-by-narrow-isPower ${num(c.narrowMissed, 4)}`
      + `  display-build-failures ${num(c.displayFailures, 4)}`);
  }

  const read = result.rows.filter((r) => r.readCount > 0);
  const dead = read.filter((r) => r.verdict === 'DEAD');
  const vacuous = read.filter((r) => r.vacuous);
  const mintOnly = read.filter((r) => r.survivesStrip);
  out.push('');
  out.push(`${result.slots.length} declared slots; ${read.length} read by non-test source;`
    + ` ${dead.length} of those have ZERO supply from any of the five suppliers.`);
  out.push(`${mintOnly.length} read slots are minted-only — no converter supply, so the strip`
    + ' does not touch them.');
  out.push('');

  out.push(`${pad('slot', 26)}${num('own', 6)}${num('nz', 6)}${num('cond', 6)}${num('nz', 5)}`
    + `${num('pet', 5)}${num('roster', 7)}${num('disp', 7)}${num('pspet', 7)}  ${pad('verdict', 10)}`
    + `${num('reads', 6)}  files`);
  out.push('-'.repeat(140));
  for (const r of result.rows) {
    if (r.readCount === 0 && r.supply === 0) continue;
    const flag = r.verdict === 'DEAD' ? 'DEAD' : r.survivesStrip ? 'LIVE-mint' : 'LIVE';
    out.push(`${pad(r.slot, 26)}${num(r.own, 6)}${num(r.ownNonZero, 6)}${num(r.cond, 6)}${num(r.condNonZero, 5)}`
      + `${num(r.petReachable, 5)}${num(r.petRoster, 7)}${num(r.displayMint, 7)}${num(r.pseudoPetMint, 7)}`
      + `  ${pad(flag + (r.vacuous ? '*' : ''), 10)}`
      + `${num(r.readCount, 6)}  ${r.readFiles.length <= 3 ? r.readFiles.join(', ') : `${r.readFiles.length} files`}`);
  }
  out.push('');
  out.push('disp / pspet — keys MINTED on top of the authored bag by buildDisplayEffects and');
  out.push('withPseudoPetEffects; a key the spread carried through is not counted twice.');
  out.push('LIVE-mint — no converter supply at all: the strip leaves this slot exactly as it is.');
  out.push('* vacuous — supply exists but every value has an all-zero numeric leaf set (advisory).');

  if (mintOnly.length) {
    out.push('');
    out.push(`READ, MINTED, NO CONVERTER SUPPLY (${mintOnly.length}) — survives BPORT7 untouched,`);
    out.push('but only where the minting bag REACHES. Display bag builders:');
    for (const f of result.displayBagBuilders) out.push(`    ${f}`);
    for (const r of mintOnly) {
      out.push('');
      out.push(`  ${r.slot} — display ${r.displayMint}, pseudo-pet ${r.pseudoPetMint}, buff-pet ${r.petReachable}`);
      if (r.readFilesOutsideDisplay.length === 0) {
        out.push('    every read site builds the display bag itself — supply reaches all of them.');
      } else {
        out.push(`    ${r.readFilesOutsideDisplay.length} read site file(s) OUTSIDE the display closure —`);
        out.push('    each is either prop-fed the display bag or reading the authored one, and for the');
        out.push('    latter this slot has no supply at all. Per-seam adjudication (BPORT3/BPORT4):');
        for (const f of r.readFilesOutsideDisplay) out.push(`      ${f}`);
      }
    }
  }

  const unreadButSupplied = result.rows.filter((r) => r.readCount === 0 && r.supply > 0);
  if (unreadButSupplied.length) {
    out.push('');
    out.push(`SUPPLIED BUT NEVER READ (${unreadButSupplied.length}) — bag the converter emits and nothing spends:`);
    for (const r of unreadButSupplied) out.push(`  ${pad(r.slot, 26)} own ${r.own}  cond ${r.cond}`);
  }

  if (dead.length) {
    out.push('');
    out.push(`READ WITH ZERO SUPPLY (${dead.length}) — the only branches this census proves dead:`);
    for (const r of dead) {
      out.push(`  ${pad(r.slot, 26)} ${r.readCount} read site(s): ${r.readFiles.join(', ')}`);
    }
  }
  const dataOnly = read.filter((r) => r.diesWithStrip);
  if (dataOnly.length) {
    out.push('');
    out.push(`READ, CONVERTER-SUPPLIED ONLY (${dataOnly.length}) — every one of these reads`);
    out.push('goes to zero the moment BPORT7 regenerates the datasets:');
    for (const r of dataOnly) {
      out.push(`  ${pad(r.slot, 26)} own ${num(r.own, 5)}  cond ${num(r.cond, 4)}  ${r.readCount} read site(s)`);
    }
  }
  if (vacuous.length) {
    out.push('');
    out.push(`READ, SUPPLIED, ALL-ZERO (${vacuous.length}) — a credit predicate may still make these dead (BPORT4):`);
    for (const r of vacuous) out.push(`  ${pad(r.slot, 26)} own ${r.own}  cond ${r.cond}`);
  }

  const dynamicUndeclared = Object.entries(result.dynamicKeysUndeclared);
  if (dynamicUndeclared.length) {
    out.push('');
    out.push(`!!! INERT NAMES IN A DYNAMIC READER'S ROSTER (${dynamicUndeclared.length}) — the reader tests for`);
    out.push('keys the type does not declare and no bag carries, so those arms never match:');
    for (const [symbol, keys] of dynamicUndeclared) out.push(`  ${pad(symbol, 26)} ${keys.join(', ')}`);
  }

  const undeclaredData = Object.entries(result.undeclaredInData);
  if (undeclaredData.length) {
    out.push('');
    out.push(`!!! UNDECLARED KEYS IN THE DATA (${undeclaredData.length}) — the converter emits what the type does not declare:`);
    for (const [k, n] of undeclaredData) out.push(`  ${pad(k, 26)} ${n} carriers`);
  }
  const undeclaredMinted = Object.entries(result.undeclaredMints);
  if (undeclaredMinted.length) {
    out.push('');
    out.push(`!!! UNDECLARED KEYS MINTED AT THE DISPLAY EDGE (${undeclaredMinted.length}) — the display`);
    out.push('bag is typed `PowerEffects` and carries keys that interface does not declare:');
    for (const [k, n] of undeclaredMinted) out.push(`  ${pad(k, 26)} ${n} powers`);
  }
  const undeclaredReads = Object.entries(result.readsUndeclared);
  if (undeclaredReads.length) {
    out.push('');
    out.push(`reads of names outside the PowerEffects vocabulary (${undeclaredReads.length}) — locals named`
      + ' `effects` that are not the bag, or a read of a slot the type does not declare:');
    for (const [k, n] of undeclaredReads) out.push(`  ${pad(k, 26)} ${n} site(s)`);
  }

  out.push('');
  out.push('buff-pet minted slots (supplier 3), by the PetEffect type that mints each:');
  for (const [type, slot] of Object.entries(result.buffPetMintedSlots)) {
    const row = result.rows.find((r) => r.slot === slot);
    out.push(`  ${pad(type, 18)} -> ${pad(slot, 22)} reachable ${num(row.petReachable, 4)}  roster ${num(row.petRoster, 4)}`);
  }

  return out.join('\n');
}

// The walk is exported alongside the census because BPORT4's reader census has to ask a
// question of the same population — "does the `stats` arm of a `stats.x ?? effects.y` seam
// carry a value where the bag does" — and a second copy of "which modules are a dataset" is
// how the two censuses would come to disagree about what they measured.
module.exports = {
  census, report, BUFF_PET_MINTED_SLOTS, DYNAMIC_READ_SITES, assertSitesLive, declaredSlots,
  generatedModules, collectBagCarriers, stubViteOnlyModules,
};

if (require.main === module) {
  const result = census();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(report(result));
  }
}
