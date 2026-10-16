/**
 * BPORT4 — reader census for the `effects` bag: every seam, and what it reads after the strip.
 *
 * BPORT1 measured SUPPLY per slot. This measures the other half: every place the bag is READ,
 * what that read binds to, and whether the supplier behind it survives BPORT7's regen. The
 * stream doc's population came from a file-level `grep` for `.effects`, and that instrument is
 * wrong in three separate directions — each of which this script fixes, and each of which
 * changed a verdict:
 *
 *   1. **It counts prose.** A doc comment naming the slot an atom query replaces
 *      (`atom-query.ts` does this 49 times) is not a read. Comments are stripped by a scanner
 *      here, not by a line-prefix heuristic, so a trailing `// … effects.foo` goes too.
 *   2. **It cannot see an alias.** `const e = power.effects` followed by `e.tohitBuff` is a bag
 *      read that no `effects.<slot>` regex matches. Three of the port's own files bind the bag
 *      to `e`, `bag` or `nextEffects` and then read it through the alias.
 *   3. **It cannot see a roster.** The same blindness BPORT3 found on `resolvePowerMagnitudes`:
 *      a reader that walks `SELF_BUFF_KEYS` or `FOE_DEBUFF_KEYS` names no slot at the read site.
 *      BPORT1's `DYNAMIC_READ_SITES` is the register for those and is consulted here.
 *
 * And it over-counts files in the other direction: a `.effects` on a set bonus tier, a pet
 * ability, a proc entry or a `ConditionalEffect` is not the power bag at all. Those are
 * separated by BINDING, not by name.
 *
 * WHAT A VERDICT MEANS. The strip empties supplier 1 (`power.effects`) and nothing else —
 * measured, not assumed: the canonical repo finished its own strip and still ships 498
 * `"effects"` keys in its homecoming powersets, every one of them a
 * `conditionalEffects[].effects`. So a seam survives iff the slot it reads has supply from 2-5
 * AND the reader can reach that supplier:
 *
 *   supplier 2 (conditional bag)   reaches a reader that reads a `ConditionalEffect`
 *   supplier 3 (buff-pet aura)     reaches a buff-pet aura consumer
 *   suppliers 4/5 (display mints)  reach the display closure — the files that build a display
 *                                  bag, plus the files those hand one to as a prop
 *
 * The prop hop is the question BPORT1 deferred ("a surface handed the bag as a prop is
 * undetectable by import edge"). It is answered here by derivation rather than by a table:
 * {@link propFeeds} finds every `<Component effects={…}>` JSX attribute, resolves the component
 * to the file that declares it, and reports whether EVERY feeder is a display-bag builder.
 *
 * THE SIBLING COMPARISON HAS ITS OWN BLIND SPOT, and BPORT5 walked into it. Every question this
 * script asks the other repo is keyed by PATH, so a file canonical kept under a different name
 * answers "no counterpart" — which is the strongest verdict available, reached without a lookup.
 * PROD7 renamed this repo's legacy calc and canonical's copy stayed put, so the oracle's 165
 * seams all read `absent` and its migrated twin was invisible. {@link RENAMED_COUNTERPART} is
 * the register that resolves those, and it is checked against the code before it is believed.
 *
 * Run: `node scripts/beta-bag-reader-census.cjs` (`--json` for the dump, `--sibling <path>` to
 * partition the population against the other repo the way the stream doc did).
 */

require('tsx/cjs');
const fs = require('fs');
const path = require('path');

const supply = require('./beta-bag-supply-census.cjs');

const REPO = path.resolve(__dirname, '..');

/**
 * Source with every comment blanked out, positions preserved.
 *
 * A line-prefix test (`/^\s*(\/\/|\*)/`) was the first cut and it under-reported: it keeps a
 * trailing `x = 1; // reads effects.foo` and it mis-reads a continuation line inside a block
 * comment that happens not to start with `*`. This is a real scanner — it tracks string and
 * template literals so a `"//"` inside a string is not mistaken for a comment — and blanking
 * rather than deleting keeps every line and column number the same as the file's.
 */
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
    } else if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Every non-test `.ts`/`.tsx` under `src/`, repo-relative and sorted. */
function sourceFiles() {
  const files = [];
  const roots = [path.join(REPO, 'src')];
  while (roots.length) {
    const dir = roots.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { roots.push(p); continue; }
      if (!/\.tsx?$/.test(e.name) || /\.(test|spec)\.tsx?$/.test(e.name)) continue;
      files.push(path.relative(REPO, p));
    }
  }
  return files.sort();
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/**
 * The expression a read falls back FROM, or null when it stands alone.
 *
 * Written as three steps rather than one regex because the one regex got it wrong twice: a
 * greedy identifier class swallowed the `null` out of `x == null &&` and reported the guard as
 * the literal, and a leading `!` with nothing before it reported `undefined`. Peel the operator,
 * peel a null/undefined comparison, then take the identifier path that is left — and refuse
 * anything that is not one.
 */
function guardExpr(before) {
  const op = before.match(/(?:\?\?|\|\||&&)\s*!*\s*$/);
  if (!op) return null;
  let lhs = before.slice(0, op.index).trim();
  lhs = lhs.replace(/\s*[!=]==?\s*(?:null|undefined)\s*$/, '').trim().replace(/^!+/, '');
  const m = lhs.match(/([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)$/);
  if (!m) return null;
  const expr = m[1].replace(/\s+/g, '');
  return /^(?:null|undefined|true|false)$/.test(expr) ? null : expr;
}

/**
 * The file-level `.effects` sweep the stream doc's census was built on, reproduced exactly.
 *
 * Kept because the four-bucket partition (27 both-read / 7 identical / 6 beta-only / 2 migrated)
 * is the population BPORT4 was scoped against, and a re-cut that cannot reproduce the old number
 * is indistinguishable from a re-cut that lost half of it. The seam census below is the answer;
 * this is the receipt that it is answering the right question.
 */
function fileSweep() {
  return sourceFiles().filter((f) => /\.effects\b/.test(fs.readFileSync(path.join(REPO, f), 'utf8')));
}

/**
 * Counterparts the fork renamed on ONE side, and the register that has to earn its keep.
 *
 * Every sibling comparison here is path-keyed, so a file the other repo kept under a different
 * name reads as "beta-only, no counterpart" — the strongest possible claim, made by a lookup
 * that never happened. PROD7 quarantined this repo's legacy calc into `legacy-totals.oracle.ts`
 * and left canonical's copy where it was; canonical then migrated that copy in place through its
 * own data-gaps-327. So the oracle's 165 seams all reported `absent`, and BPORT5 was scoped as a
 * choice between two ways to FREEZE the oracle — because the census said the migrated twin it
 * could carry did not exist.
 *
 * A hand-kept map earns the same distrust as {@link rosterSeams}' register, and for the same
 * reason: it describes code, so it is checked against the code. {@link assertCounterpartsLive}
 * refuses a mapping whose target is gone or has stopped being the same file.
 */
const RENAMED_COUNTERPART = {
  'src/utils/calculations/legacy-totals.oracle.ts': 'src/utils/calculations/character-totals.ts',
};

/** Top-level `function` names, which is all the lineage check needs and the cheapest to read. */
function declNames(abs) {
  const src = stripComments(fs.readFileSync(abs, 'utf8'));
  return new Set([...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]));
}

/**
 * The register is only usable while its two files are still the same file.
 *
 * A rename map is a claim about lineage, and lineage rots quietly: the day canonical splits
 * `character-totals.ts` the way PROD7 split this one, the mapping starts grading two unrelated
 * modules and reports the difference as work. So the door is shared declarations — 31 of the
 * oracle's 34 functions are in canonical's copy today — and anything under two-thirds throws
 * rather than answers.
 */
function assertCounterpartsLive(siblingRoot) {
  for (const [mine, theirs] of Object.entries(RENAMED_COUNTERPART)) {
    const abs = path.join(siblingRoot, theirs);
    if (!fs.existsSync(abs)) throw new Error(`RENAMED_COUNTERPART: ${mine} -> ${theirs} is absent in ${siblingRoot}`);
    const ours = declNames(path.join(REPO, mine));
    const theirNames = declNames(abs);
    const shared = [...ours].filter((n) => theirNames.has(n)).length;
    const ratio = ours.size ? shared / ours.size : 0;
    if (ratio < 2 / 3) {
      throw new Error(
        `RENAMED_COUNTERPART: ${mine} -> ${theirs} shares only ${shared}/${ours.size} declarations; ` +
        'the two have stopped being the same file and the mapping must be re-adjudicated',
      );
    }
  }
}

/** Where the sibling keeps this file, following a one-sided rename. */
function counterpartOf(rel) {
  return RENAMED_COUNTERPART[rel] ?? rel;
}

/**
 * Partition the sweep against the other repo: the stream doc's four buckets, plus `renamed`.
 *
 * The fifth is not a subdivision of the others — it is the population `betaOnly` was wrong
 * about. BPORT3 adjudicated five beta-only readers and named the oracle as a sixth it was not
 * taking; the sixth was never beta-only, it was renamed.
 */
function partition(files, siblingRoot) {
  const buckets = { bothRead: [], identical: [], betaOnly: [], migrated: [], renamed: [] };
  for (const f of files) {
    if (RENAMED_COUNTERPART[f]) { buckets.renamed.push(f); continue; }
    const theirs = path.join(siblingRoot, f);
    if (!fs.existsSync(theirs)) { buckets.betaOnly.push(f); continue; }
    const mine = fs.readFileSync(path.join(REPO, f));
    if (mine.equals(fs.readFileSync(theirs))) { buckets.identical.push(f); continue; }
    if (/\.effects\b/.test(fs.readFileSync(theirs, 'utf8'))) buckets.bothRead.push(f);
    else buckets.migrated.push(f);
  }
  return buckets;
}

/**
 * Bag reads in one file, comments already gone.
 *
 * `binding` is what the read is anchored to and it is the whole discrimination: `own` is a
 * property access on some object (supplier 1 unless that object is a conditional), `param` is a
 * bare `effects.<slot>` — the file was handed a bag and cannot know whose — and `alias:<expr>`
 * is a local bound from a `.effects` and then read through.
 */
function seamsIn(rel, declared, root = REPO) {
  const raw = fs.readFileSync(path.join(root, rel), 'utf8');
  const src = stripComments(raw);
  const seams = [];

  // The alias bindings first, because a guard that reads through one (`e?.hold || e?.stun`) is
  // not a guard, and the direct finder below has to be able to tell.
  //
  // The right-hand side is a CHAIN, not an identifier: `getArchetype('dominator')?.inherent
  // ?.effects` binds the Dominator inherent's bag through two optional hops, and an
  // identifier-only pattern reported that file as reading nothing at all. Braces and spreads
  // are excluded from the chain on purpose — `{ ...effects }` is a COPY, and the copy's keys
  // get written, not read.
  const aliasBinds = [...src.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+?)?=\s*([A-Za-z_$][\w$]*(?:\s*\??[.(\[][^;\n]*?)?)\??\.\s*effects\b(?!\s*\??\.)/g,
  )].filter((b) => b[1] !== 'effects'); // the bare form is finder 1's
  const aliases = new Set(aliasBinds.map((b) => b[1]));

  const seen = new Set();
  const push = (index, slot, binding, owner) => {
    if (!declared.has(slot)) return;
    if (seen.has(index)) return; // one read, however many alias bindings led the finder to it
    seen.add(index);
    // An assignment is not a read. `legacy-totals.oracle.ts` MINTS the buff-pet aura slots
    // onto a synthesized bag (`effects.regenBuff = sc`); counted as reads, a supplier looked
    // like a spender. `=>` and `==` are not assignments and stay.
    const after = src.slice(index, src.indexOf('\n', index) + 1 || undefined);
    if (/^\s*=(?![=>])/.test(after.replace(/^[\w$?.[\]]*/, ''))) return;
    // Is this read the RIGHT-HAND side of a `??`, `||` or a negated `&&` chain? That is the
    // difference between a seam whose death is a wrong number and one whose death is dead
    // code, and it is the materiality line BPORT1 declined to draw. The left-hand expression
    // comes back with it, because "the LHS covers" is a claim about supply that has to be
    // measured, not assumed.
    const before = src.slice(src.lastIndexOf('\n', index) + 1, index);
    const guardedBy = guardExpr(before);
    seams.push({
      index, file: rel, line: lineOf(src, index), slot, binding, owner, guardedBy,
      // A guard only covers if it reads something OTHER than the bag. `e?.hold || e?.stun`
      // looks guarded and is not: both arms die together. This is the difference between
      // "the strip makes this dead code" and "the strip makes this wrong".
      guardCovers: !!guardedBy && !/\beffects\b/.test(guardedBy) && !aliases.has(guardedBy.split(/[?.[]/)[0]),
    });
  };

  // 1. direct — `<owner>?.effects?.<slot>` and the bare `effects.<slot>` a parameter gives.
  for (const m of src.matchAll(/(?:([A-Za-z_$][\w$]*)\s*\??\.\s*)?\beffects\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) {
    push(m.index, m[2], m[1] ? 'own' : 'param', m[1] ?? null);
  }

  // 2. alias — `const e = power.effects` binds the bag to a name the regex above cannot follow.
  //    Scoped to the file rather than to the binding's block: an alias re-bound to something
  //    else later would over-report, which is the safe direction for a census whose job is to
  //    stop a read going unseen.
  const computedSeen = new Set();
  for (const [, alias, owner] of aliasBinds) {
    for (const m of src.matchAll(new RegExp(String.raw`\b${alias}\s*\??\.\s*([A-Za-z_$][\w$]*)`, 'g'))) {
      push(m.index, m[1], `alias:${owner}`, owner);
    }
    // A computed read through the alias (`e[k]`) names no slot; the roster finder owns it.
    for (const m of src.matchAll(new RegExp(String.raw`\b${alias}\s*\[`, 'g'))) {
      if (computedSeen.has(m.index)) continue;
      computedSeen.add(m.index);
      seams.push({ index: m.index, file: rel, line: lineOf(src, m.index), slot: null, binding: `alias:${owner}`, owner, computed: true });
    }
  }

  return seams;
}

/**
 * Roster-driven reads: a reader that tests a list of keys against the bag names no slot.
 *
 * BPORT1's `DYNAMIC_READ_SITES` is the register — imported rather than restated, because a
 * roster listed in two places is a roster that will disagree with itself. Sites whose file no
 * longer exists throw there, so this cannot silently thin out.
 */
function rosterSeams(declared) {
  // The register describes code, so check it against the code before minting from it. A site
  // whose constant has been deleted mints casualties for a read that no longer exists — the
  // failure BPORT6 hit with `ROUTED_SUBTYPES`, and the one direction a stale roster fails in
  // that nobody re-reads, because it reports MORE work rather than less.
  supply.assertSitesLive();
  const seams = [];
  for (const site of supply.DYNAMIC_READ_SITES) {
    const keys = site.derive ? site.derive(declared) : site.keys;
    for (const slot of keys) {
      if (!declared.has(slot)) continue;
      seams.push({ file: site.file, line: null, slot, binding: `roster:${site.symbol}`, owner: null });
    }
  }
  return seams;
}

/**
 * What the sibling did with a ROSTER-bound seam, which `seamsIn` alone cannot answer.
 *
 * A roster seam names no slot in its own source — `effects[key]` over a `DOMINATION_MEZ_KEYS`
 * loop — so it is minted from {@link rosterSeams}, a hand-kept register, rather than found by
 * the finder. The sibling comparison ran the FINDER over canonical and asked whether the slot
 * came back, which for these seams it never can: the finder is not the thing that produced
 * them. Every roster seam therefore reported `migrated-there` unconditionally, and BPORT6
 * caught it the only way it could be caught — by opening canonical's copy. Six of the eight
 * were wrong: canonical's `getPowerDominationSummary` is byte-identical to this one and reads
 * `effects[key]` exactly as it does, so "carry canonical's arm" named an arm that does not
 * exist. The other two (`ROUTED_SUBTYPES`) were right by accident.
 *
 * The register's own `symbol` is the decidable question: a roster of bag-slot names has one
 * purpose, so canonical still declaring it means canonical still reads through it. That is
 * the limit of this test and it is stated rather than hidden — a sibling that kept the
 * constant and stopped indexing the bag with it would read as `reads-too` here.
 */
function siblingRosterVerdict(seam, siblingRoot) {
  const symbol = seam.binding.slice('roster:'.length);
  const theirs = path.join(siblingRoot, counterpartOf(seam.file));
  if (!fs.existsSync(theirs)) return 'absent';
  const src = stripComments(fs.readFileSync(theirs, 'utf8'));
  const declares = new RegExp(`(?:const|let|var|function)\\s+${symbol}\\b`).test(src);
  return declares ? 'reads-too' : 'migrated-there';
}

/**
 * Which files are handed a display bag as a `effects={…}` prop, and by whom.
 *
 * BPORT1 could not answer this — its closure is discovered by import edge, and a prop crosses
 * no import edge in the direction that matters. Derived here: find every JSX `effects={…}`
 * attribute, read the component name off the tag, resolve that name to the file that exports
 * it, and record the feeder. A component every one of whose feeders builds a display bag DOES
 * reach the mints; one with a feeder outside the closure does not, and is reported as split.
 */
function propFeeds(files) {
  const declaredIn = new Map(); // component name -> file that exports it
  for (const f of files) {
    const src = stripComments(fs.readFileSync(path.join(REPO, f), 'utf8'));
    for (const m of src.matchAll(/\bexport\s+(?:default\s+)?(?:const|function)\s+([A-Z][\w$]*)/g)) {
      if (!declaredIn.has(m[1])) declaredIn.set(m[1], f);
    }
    for (const m of src.matchAll(/\b(?:const|function)\s+([A-Z][\w$]*)/g)) {
      if (!declaredIn.has(m[1])) declaredIn.set(m[1], f);
    }
  }
  const feeds = new Map(); // fed file -> Set(feeder files)
  for (const f of files) {
    const src = stripComments(fs.readFileSync(path.join(REPO, f), 'utf8'));
    for (const m of src.matchAll(/<([A-Z][\w$]*)\b([^>]*?)\beffects\s*=\s*\{/gs)) {
      const target = declaredIn.get(m[1]);
      if (!target || target === f) continue;
      if (!feeds.has(target)) feeds.set(target, new Set());
      feeds.get(target).add(f);
    }
  }
  return feeds;
}

/**
 * The atom-query symbols the sibling's copy of a file imports and this one does not.
 *
 * A file that reads the bag in both repos has not necessarily been left alone in both. The
 * atom-native readers all live in one module, so the import list is the cheapest honest signal
 * for "canonical grew an arm here": non-empty means the beta's copy is behind by exactly those
 * calls, whatever the bag read next to them looks like.
 */
function atomArmGap(rel, siblingRoot) {
  const imports = (root) => {
    const p = path.join(root, root === REPO ? rel : counterpartOf(rel));
    if (!fs.existsSync(p)) return new Set();
    const src = stripComments(fs.readFileSync(p, 'utf8'));
    const out = new Set();
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*core\/atom-query['"]/g)) {
      for (const name of m[1].split(',')) {
        const t = name.trim().split(/\s+as\s+/)[0].trim();
        if (t) out.add(t);
      }
    }
    return out;
  };
  const mine = imports(REPO);
  return [...imports(siblingRoot)].filter((x) => !mine.has(x)).sort();
}

/**
 * Does the left-hand arm of a `power.stats?.X ?? power.effects?.Y` seam actually carry the value?
 *
 * `guardCovers` above is a claim about SHAPE — the guard reads something other than the bag.
 * Whether it reads something *present* is a different question and the only one that decides
 * whether the strip turns the seam into dead code or into a zero. data-gaps-159 is the standing
 * proof that the shape can be right and the answer still no: a comment promised `enrich` would
 * project `stats`, it never did, and seventy-odd epic toggles drained to nothing behind a
 * fallback that looked covered.
 *
 * Counts, per (stats key, bag slot) pair, the powers the bag supplies and `stats` does not.
 * `bagOnly` is the casualty count for that seam; 0 means the guard is real.
 */
function guardCoverage(pairs, datasets) {
  const tally = {};
  for (const [guard, slot] of pairs) tally[`${guard}/${slot}`] = { stats: 0, bag: 0, bagOnly: 0 };
  supply.stubViteOnlyModules();
  let powers = 0;
  for (const dataset of datasets) {
    for (const file of supply.generatedModules(dataset)) {
      for (const power of supply.collectBagCarriers(require(file))) {
        powers++;
        const stats = power.stats && typeof power.stats === 'object' ? power.stats : {};
        const bag = power.effects && typeof power.effects === 'object' && !Array.isArray(power.effects) ? power.effects : {};
        for (const [guard, slot] of pairs) {
          const t = tally[`${guard}/${slot}`];
          // `stats.recharge` reads the execution-stats object; a bare `damage` is the power's
          // own top-level field. Both are arms a seam falls back FROM, and both have to be
          // measured on the same population as the slot they guard.
          const hasStats = guard.startsWith('stats.')
            ? stats[guard.slice(6)] != null
            : power[guard] != null;
          const hasBag = bag[slot] != null;
          if (hasStats) t.stats++;
          if (hasBag) t.bag++;
          if (hasBag && !hasStats) t.bagOnly++;
        }
      }
    }
  }
  return { powers, tally };
}

/**
 * The census. Every seam, with the slot's supply row and the verdict the strip gives it.
 *
 * `postStrip` is the supply that outlives BPORT7 — everything but supplier 1. A seam whose slot
 * has `postStrip > 0` is only safe if the reader can REACH that supplier, which is what
 * `reaches` says; the two together are the verdict.
 */
function readerCensus({ siblingRoot = null, datasets } = {}) {
  const sup = supply.census(datasets ? { datasets } : undefined);
  const bySlot = new Map(sup.rows.map((r) => [r.slot, r]));
  const declared = new Set(sup.slots);
  const files = sourceFiles();
  const builders = new Set(sup.displayBagBuilders);
  const feeds = propFeeds(files);

  const reachesDisplay = (f) => {
    if (builders.has(f)) return 'builds';
    const fed = feeds.get(f);
    if (!fed) return 'no';
    return [...fed].every((g) => builders.has(g) || reachesDisplayShallow(g)) ? 'prop-fed' : 'prop-fed-split';
  };
  const reachesDisplayShallow = (f) => builders.has(f);

  const seams = [];
  for (const f of files) seams.push(...seamsIn(f, declared));
  seams.push(...rosterSeams(declared));

  for (const s of seams) {
    const row = s.slot ? bySlot.get(s.slot) : null;
    s.supply = row ? { own: row.own, cond: row.cond, pet: row.petReachable, disp: row.displayMint, pspet: row.pseudoPetMint } : null;
    s.postStrip = row ? row.cond + row.petReachable + row.displayMint + row.pseudoPetMint : null;
    s.display = reachesDisplay(s.file);
    const mint = row ? row.displayMint + row.pseudoPetMint : 0;
    if (!row) s.verdict = 'computed';
    else if (row.supply === 0) s.verdict = 'dead-today';
    else if (row.own === 0) s.verdict = 'leave';
    else if (s.postStrip === 0) s.verdict = 'dies';
    else if (mint > 0 && s.display !== 'no') s.verdict = 'leave';
    // A read the file did not itself take off a power is the one case this cannot settle
    // alone: the bag came from a caller, and WHICH bag decides the answer. Reported as a
    // question rather than folded into either verdict — the mistake BPORT1 named and refused
    // to make when it left `readFilesOutsideDisplay` undecided.
    else if (mint > 0 && (s.binding === 'param' || s.binding.startsWith('roster:'))) s.verdict = 'caller-decides';
    else s.verdict = 'dies';
    // `dies-guarded` is the same death behind a left-hand arm that does NOT read the bag: the
    // strip makes it dead code rather than a wrong number, PROVIDED the LHS is supplied. That
    // proviso is a measurement, not a reading — `guardCovers` says the shape is right, and the
    // stream doc's adjudication says whether the LHS actually carries the value.
    if (s.verdict === 'dies' && s.guardCovers) s.verdict = 'dies-guarded';
  }

  // The `stats` arms every guarded seam leans on, derived from the seams rather than listed:
  // a seam that starts guarding on a new key joins the coverage measurement by itself.
  // Two sources, and the second is the one that answers "is this a casualty or a rename".
  // (a) every guard a seam already falls back FROM, and (b) `stats.<slot>` for every slot with
  // a dying seam — because a dying read whose value also rides `stats` is a seam waiting for a
  // left-hand arm, and one whose `stats` column is 0 is a value the strip actually takes away.
  const pairs = [...new Set([
    ...seams.filter((s) => s.guardCovers && s.slot).map((s) => {
      const key = s.guardedBy.split(/[?.]+/).filter(Boolean).pop();
      return `${/\bstats\b/.test(s.guardedBy) ? `stats.${key}` : key}|${s.slot}`;
    }),
    ...seams.filter((s) => s.verdict === 'dies' && s.slot).map((s) => `stats.${s.slot}|${s.slot}`),
  ])]
    .sort()
    .map((k) => k.split('|'));
  const coverage = pairs.length ? guardCoverage(pairs, sup.datasets) : { powers: 0, tally: {} };

  const readerFiles = [...new Set(seams.map((s) => s.file))].sort();
  const sweep = fileSweep();
  if (siblingRoot) assertCounterpartsLive(siblingRoot);
  const buckets = siblingRoot ? partition(sweep, siblingRoot) : null;

  // What the other repo did with the SAME seam. "Both repos read it" was the stream doc's
  // bucket, and it is a file-level fact that hides the one thing the adjudication needs: a
  // file can read the bag in both repos while canonical has already grown an atom arm and
  // kept the bag only behind it. So the seam's answer is "carry canonical's arm", not
  // "leave, matching canonical". Per SLOT, not per file.
  //
  // `reads-too` is a LOWER bound on that, and `StatsDashboard` is the proof: canonical calls
  // `movementCapBumpValue(p)` and falls back to `effects.movementCapBump` only when the atoms
  // answer nothing, so the slot is named in both copies while only one of them depends on it.
  // {@link atomArmGap} measures that second half — the atom-query imports canonical's copy of
  // a file has and the beta's does not.
  if (siblingRoot) {
    const theirSeams = new Map();
    for (const s of seams) {
      if (theirSeams.has(s.file)) continue;
      const theirs = path.join(siblingRoot, counterpartOf(s.file));
      theirSeams.set(s.file, fs.existsSync(theirs)
        ? new Set(seamsIn(path.relative(siblingRoot, theirs), declared, siblingRoot).map((t) => t.slot))
        : null);
    }
    for (const s of seams) {
      const theirs = theirSeams.get(s.file);
      s.sibling = theirs === null ? 'absent'
        : s.binding.startsWith('roster:') ? siblingRosterVerdict(s, siblingRoot)
        : theirs.has(s.slot) ? 'reads-too' : 'migrated-there';
      s.atomArmGap = theirs === null ? [] : atomArmGap(s.file, siblingRoot);
    }
  }

  return { supply: sup, seams, readerFiles, sweep, buckets, builders: [...builders].sort(), feeds, coverage };
}

function report(c) {
  const out = [];
  out.push('=== BPORT4 — beta bag reader census ===\n');

  out.push(`file-level \`.effects\` sweep: ${c.sweep.length} non-test source files`);
  if (c.buckets) {
    const b = c.buckets;
    out.push(`  both-read ${b.bothRead.length} | identical ${b.identical.length} | ` +
             `beta-only ${b.betaOnly.length} | migrated-in-canonical ${b.migrated.length} | ` +
             `renamed ${b.renamed.length}`);
    for (const f of b.renamed) out.push(`      ${f}  ->  ${counterpartOf(f)}`);
  }
  const proseOnly = c.sweep.filter((f) => !c.readerFiles.includes(f));
  out.push(`  ${proseOnly.length} of those carry NO bag seam — their \`.effects\` is a set-bonus tier,`);
  out.push('  a pet ability, a proc entry, a conditional, a local array or a comment.');
  const missed = c.readerFiles.filter((f) => !c.sweep.includes(f));
  out.push(`  ${missed.length} bag reader(s) the sweep never saw (parameter-fed or roster-driven):`);
  for (const f of missed) out.push(`    ${f}`);
  out.push('');

  out.push(`seams: ${c.seams.length} in ${c.readerFiles.length} files\n`);
  const tally = {};
  for (const s of c.seams) tally[s.verdict] = (tally[s.verdict] ?? 0) + 1;
  out.push(`  ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join('  |  ')}\n`);

  const byFile = new Map();
  for (const s of c.seams) {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file).push(s);
  }
  out.push('file'.padEnd(62) + 'seams  display     verdicts');
  out.push('-'.repeat(120));
  for (const f of c.readerFiles) {
    const ss = byFile.get(f);
    const v = {};
    for (const s of ss) v[s.verdict] = (v[s.verdict] ?? 0) + 1;
    out.push(f.padEnd(62) + String(ss.length).padStart(5) + '  ' +
             (ss[0].display).padEnd(10) + '  ' +
             Object.entries(v).sort().map(([k, n]) => `${k} ${n}`).join(', '));
  }

  const dying = c.seams.filter((s) => s.verdict === 'dies' || s.verdict === 'dies-guarded');
  const slots = [...new Set(dying.map((s) => s.slot))].sort();
  out.push(`\nSEAMS THAT GO TO ZERO AT BPORT7 (${dying.length} sites, ${slots.length} slots):`);
  for (const slot of slots) {
    const ss = dying.filter((s) => s.slot === slot);
    out.push(`  ${slot.padEnd(26)} own ${String(ss[0].supply.own).padStart(5)}  ` +
             `${ss.length} site(s): ${[...new Set(ss.map((s) => s.file))].join(', ')}`);
  }

  const cov = Object.entries(c.coverage.tally);
  if (cov.length) {
    const covered = cov.filter(([, v]) => v.bagOnly === 0);
    const bare = cov.filter(([, v]) => v.bagOnly > 0);
    out.push(`\nDOES A SECOND ARM COVER? (${c.coverage.powers} powers) — a dying read is dead CODE`);
    out.push('where the same number also rides `stats` or the top level, and a dying NUMBER where it does not.');
    out.push('  ' + 'arm / bag slot'.padEnd(34) + 'arm'.padStart(8) + 'bag'.padStart(8) + 'BAG-ONLY'.padStart(10));
    for (const [k, v] of covered) {
      out.push('  ' + k.padEnd(34) + String(v.stats).padStart(8) + String(v.bag).padStart(8) + String(v.bagOnly).padStart(10));
    }
    out.push(`  — the other ${bare.length} dying slots have NO second arm: every carrier is a casualty.`);
    out.push('    ' + bare.map(([k, v]) => `${k.split('/')[1]} ${v.bagOnly}`).join(', '));
  }

  const dyingIn = c.seams.filter((s) => (s.verdict === 'dies' || s.verdict === 'caller-decides') && s.sibling);
  if (dyingIn.length) {
    const byWhere = { 'migrated-there': [], 'reads-too': [], absent: [] };
    for (const s of dyingIn) byWhere[s.sibling].push(s);
    out.push('\nWHAT CANONICAL DID WITH THE SAME SEAM — the stream doc expected "mostly leave,');
    out.push('matching canonical". Per slot rather than per file, it is mostly the opposite:');
    for (const [where, ss] of Object.entries(byWhere)) {
      const files = [...new Set(ss.map((s) => s.file))].sort();
      out.push(`  ${where.padEnd(16)} ${String(ss.length).padStart(4)} seam(s) in ${files.length} file(s)`);
      for (const f of files) {
        const of = ss.filter((s) => s.file === f);
        const slots = [...new Set(of.map((s) => s.slot))].sort();
        out.push(`      ${f.padEnd(56)} ${slots.join(', ')}`);
        const gap = of[0].atomArmGap ?? [];
        if (gap.length) {
          const shown = gap.slice(0, 5).join(', ');
          const more = gap.length > 5 ? ` (+${gap.length - 5} more)` : '';
          out.push(`      ${' '.repeat(56)} + canonical calls ${shown}${more} — this repo calls none of them`);
        }
      }
    }
  }

  out.push('\nprop feeds (who hands a display bag to whom):');
  for (const [target, from] of [...c.feeds].sort()) {
    const all = [...from].every((g) => c.builders.includes(g));
    out.push(`  ${target.padEnd(56)} ${all ? 'ALL builders' : 'SPLIT'}  <- ${[...from].join(', ')}`);
  }

  return out.join('\n');
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--sibling');
  const siblingRoot = i >= 0 ? path.resolve(argv[i + 1]) : null;
  const c = readerCensus({ siblingRoot });
  if (argv.includes('--json')) {
    const { supply: _s, feeds, ...rest } = c;
    console.log(JSON.stringify({ ...rest, feeds: Object.fromEntries([...feeds].map(([k, v]) => [k, [...v]])) }, null, 2));
  } else {
    console.log(report(c));
  }
}

/**
 * Every bag seam in one file, with no dataset walk behind it.
 *
 * The finders are source-only; only the VERDICTS need supply. Exported separately so a guard
 * can ask "which files read `effects.summon`" without paying for 12.5k modules — and so the
 * roster BPORT3 pinned with a regex can inherit the alias and chained-alias finders instead of
 * keeping a second, blinder copy of the same question.
 */
function bagSeams(rel) {
  return seamsIn(rel, new Set(supply.declaredSlots()));
}

/**
 * The same finder pointed at the other repo's copy, following a one-sided rename.
 *
 * The slot vocabulary stays THIS repo's: canonical's `PowerEffects` has moved on, and the
 * question here is what canonical did with the slots the beta still reads, not what its own
 * declaration says today.
 */
function siblingSeams(rel, siblingRoot) {
  return seamsIn(counterpartOf(rel), new Set(supply.declaredSlots()), siblingRoot);
}

module.exports = {
  readerCensus, report, stripComments, seamsIn, bagSeams, siblingSeams, propFeeds, fileSweep,
  partition, guardExpr, RENAMED_COUNTERPART, counterpartOf, assertCounterpartsLive,
};
