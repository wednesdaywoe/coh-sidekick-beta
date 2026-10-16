/**
 * Plan B, Phase 2 Slice 7 — movement-buff reconstruction shadow (`effects.movement`).
 *
 * Proves that the atom list reproduces the bag's movement map WITHOUT reading the bag —
 * the precondition for migrating the movement applier in character-totals.ts:
 *
 *   BAG   — `effects.movement`, what the calc reads today: a map of axis →
 *           `{ scale, table, stackKey?, suppressible? }`, iterated by the applier and
 *           resolved through the AT table into a run/fly/jump percent.
 *   ATOMS — `movementBuffValue(power)`: base Movement atoms, with the bag's routing
 *           chain (Res → debuffResistance, self+Str → specialBuff, self+Max+scale>0 →
 *           movementCapBump, Max+slow → movementCapDebuff, slow → slow, else self /
 *           current) reproduced from `aspect` / `toWho` / `scale` / `modifierTable`,
 *           which are all on the wire.
 *
 * Checked in BOTH directions, per slot, so an over-production (an atom minting a
 * movement entry the bag never had — the failure mode a fallback CANNOT protect
 * against) is as loud as a drop.
 *
 * THE TWO SIDES NO LONGER HAVE THE SAME SHAPE, and that is the point of the fix
 * this gate was written before. The bag is a map — one value per axis — and
 * `movementBuffValue` now returns a LIST, keyed by axis plus `ignoreStrength` plus
 * `suppressible`, because a power may buff one axis twice and the map kept only the
 * last write (data-gaps-198: Sprint reported +50% run where the game gives +100%). So a
 * bag entry is graded against the atom entries FOR ITS AXIS, and an axis carrying
 * more than one lands in its own bucket:
 *
 *   agree        — the axis holds exactly one atom entry and the bag states it.
 *   split        — the axis holds several and the bag states one of them. This is the
 *                  bag being wrong on purpose; it is what data-gaps-198 fixed. Pinned by
 *                  name in EXPECTED_SPLITS, so a NEW one is loud and so is a lost one
 *                  (which would be the fix regressing).
 *   fork         — no atom entry, because the build-agnostic reader abstains on an
 *                  archetype-forked slot; asked again per archetype (see below).
 *   silenced     — every atom on the axis is a chance-0 sentinel naming no mode, so the
 *                  reader answers EMPTY and the bag value is not spent. Pinned by name in
 *                  EXPECTED_ABSTENTIONS; not scored as agreement, because the claim that
 *                  the atoms reproduce the bag is deliberately false there.
 *   diverge      — anything else. GATES.
 *
 * Grading the axes with one entry against the bag while naming the axes with several
 * is the only honest reading available: on a split axis the bag has no second slot to
 * hold the second value, so "reproduces the bag" is a claim that cannot be true there
 * and must not be asserted.
 *
 * The three metadata axes are checked alongside the value, because the applier reads
 * all of them and two of them decide whether the buff applies at all:
 *   - `table` — a movement scale is meaningless without it (Swift's 0.1 is +35% on
 *     `Melee_SpeedRunning`, not +10%);
 *   - `stackKey` — the mutual-suppression group (`TravelBuff`); only the strongest
 *     member of a group applies, so a dropped key silently stacks CJ + SJ + SS;
 *   - `suppressible` — combat suppression (Super Speed's run buff, Fly's speed).
 *
 * SCOPE — Thunderspy movement is now COVERED (this note previously claimed the opposite
 * — "tspy has NO movement data, +0 everywhere, aspect always empty"; corrected 2026-07-19,
 * all three claims are now false). `MOVEMENT_TYPES` (bag) and `MOVEMENT_AXIS` (bridge) both
 * map tspy's `SpeedRunning`/`SpeedJumping`/`SpeedFlying` spelling onto the Run/Fly/Jump axes,
 * and the data-gaps-75 step-1 typing recovery filled in `aspect` (tspy is now ~4.8% aspect-empty,
 * was ~98%), so the speed-buff-vs-travel-cap distinction IS recoverable. This gate reports
 * ~95 tspy movement axis slots (bag == atoms, 0 divergence) — real data on both sides, not a
 * vacuous agree. (data-gaps-75 step 2 also mapped the bare `Friction`/`Control` respellings, but
 * `movement.rs` excludes those axes from every total by design.) Coverage still prints per
 * dataset so any genuine zero stays visible rather than hiding in a corpus-wide total.
 *
 * WHAT THIS GATE CANNOT SEE, stated because it looks covered and is not: the `slow`
 * map's SPLIT key. Collapsing `selfSlowValue` back to one entry per axis leaves every
 * number here green, because no power in the corpus reaches this gate with more than one
 * self-directed slow entry on an axis. The two that did — Rebirth's Aerobatics and Solar
 * Glide, whose `+0.5 / -0.5` pairs are the reason `slow` became atom-native at all — now
 * abstain outright, every atom they carry being a chance-0 sentinel. The key is graded by
 * a constructed case instead, `the_minus_half_of_a_pair_splits_on_the_same_key_as_the_plus`
 * in crates/coh_math/src/appliers/movement.rs: a corpus cannot grade a scope nothing in
 * it violates. Verified by mutation — that collapse is the one mutant this gate survives.
 *
 * Exit code is nonzero on any divergence — this GATES.
 *
 * Usage:
 *   node scripts/planb-shadow-movement.cjs
 *   node scripts/planb-shadow-movement.cjs --dataset homecoming
 *   node scripts/planb-shadow-movement.cjs --power "Super Speed"
 *
 * ARCHETYPE FORK: a slot the converter resolved across the whole roster reads as
 * `undefined` from the build-agnostic atom readers and populated in the bag. That is
 * not a divergence — it is checked, per archetype, through
 * `planb-shadow-sweep.forkResolvedViews`, and counted separately in the summary.
 */

require('tsx/cjs');
const { sweepDataset, forkResolvedAgrees } = require('./planb-shadow-sweep.cjs');
const { movementBuffValue, selfSlowValue } = require('../src/data/core/atom-query.ts');

const argv = process.argv.slice(2);
const argVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const POWER_FILTER = argVal('--power');
const DATASETS = (() => {
  const picked = argv.flatMap((a, i) => (a === '--dataset' && argv[i + 1] ? [argv[i + 1]] : []));
  return picked.length ? picked : require('./_dataset-paths.cjs').ALL_DATASETS;
})();

const r4 = (n) => Math.round((n || 0) * 1e4) / 1e4;

/** The four axes that reach a character total; see MOVEMENT_AXIS_TO_KEY in atom-query. */
const AXES = ['runSpeed', 'flySpeed', 'jumpSpeed', 'jumpHeight'];

/**
 * The keys `effects.slow` uses, which are the four above plus the two axes that carry a
 * modelled global on the penalty side and none on the buff side (data-gaps-190), plus `fly` —
 * the kFly flight-MODE grant, which the bag's key map routes to the flySpeed global and
 * the atom side deliberately does not. Listed so the sweep VISITS `fly` and can count
 * what it drops, rather than never looking.
 */
const SLOW_AXES = [...AXES, 'movementControl', 'movementFriction', 'fly'];

/**
 * Normalize one axis entry to the tuple the applier actually consumes. A scale-0 entry
 * with no metadata contributes literally nothing (resolveMovementTotals filters
 * `value !== 0`), so it normalizes to absent on both sides — the "compare what survives
 * to a total" doctrine. A genuine 0-vs-nonzero mismatch still shows as present/absent.
 */
function norm(v) {
  if (v === undefined || v === null) return undefined;
  const e = typeof v === 'number' ? { scale: v, table: '' } : v;
  const scale = r4(Math.abs(e.scale));
  if (scale === 0) return undefined;
  return {
    scale,
    table: (e.table || '').toLowerCase(),
    stackKey: e.stackKey || null,
    suppressible: !!e.suppressible,
  };
}
const eq = (a, b) =>
  (!a && !b) ||
  (!!a && !!b && a.scale === b.scale && a.table === b.table &&
   a.stackKey === b.stackKey && a.suppressible === b.suppressible);

/**
 * The same comparison for `effects.slow`, minus the two travel-metadata fields.
 *
 * Not a relaxation to make something pass — it is what the applier spends. A self slow
 * writes its global directly: no suppress group, no combat check, `resolveScaledEffect`
 * on the scale and table alone. The converter's `slow` branch never calls
 * `attachTravelMeta`, so the bag states neither field while the atoms state both, and
 * grading them here would pin converter silence rather than a number.
 *
 * That the atoms carry `suppressible: true` on Super Speed's control/friction slow and
 * nothing reads it IS a live question — whether a suppressible self penalty should drop
 * in combat. It is not this one, and answering it moves totals. Recorded on data-gaps-198.
 */
const eqValue = (a, b) =>
  (!a && !b) || (!!a && !!b && a.scale === b.scale && a.table === b.table);

/** The atom entries for one axis, normalized to what the bag could have held. */
const axisEntries = (list, axis) =>
  (list || []).filter((e) => e.axis === axis).map(norm).filter(Boolean);

/**
 * Every axis the atom side splits and the bag cannot, pinned by name and count.
 *
 * These are the powers data-gaps-198 was filed for — the sprint family's enhanceable /
 * `IgnoreStrength` run pair, plus the two axes where Thunderspy folds its travel band
 * onto the same axis (Sprint IS that fork's free travel toggle, ATOM-BAG-6). Pinned
 * rather than counted because both directions are worth a failure: a new split is an
 * axis nobody has read yet, and a LOST split is data-gaps-198's fix regressing back into
 * the last-write-wins map it replaced — which is exactly the shape no parity gate
 * could see, because both engines agreed on it.
 *
 * The count is of entries that survive `norm` (a scale-0 entry reaches no total).
 */
const EXPECTED_SPLITS = {
  'homecoming|Sprint|runSpeed': 2,
  'homecoming|Prestige Power Slide|runSpeed': 2,
  'homecoming|Prestige Power Rush|runSpeed': 2,
  'homecoming|Prestige Power Surge|runSpeed': 2,
  'homecoming|Prestige Power Dash|runSpeed': 2,
  'homecoming|Prestige Power Quick|runSpeed': 2,
  // Brainstorm's six mirror Homecoming's because the powers ARE Homecoming's: every
  // one of these files is byte-identical across the two datasets, atoms and bag alike.
  // A mirror on that footing, not on the shape looking familiar.
  'brainstorm|Sprint|runSpeed': 2,
  'brainstorm|Prestige Power Slide|runSpeed': 2,
  'brainstorm|Prestige Power Rush|runSpeed': 2,
  'brainstorm|Prestige Power Surge|runSpeed': 2,
  'brainstorm|Prestige Power Dash|runSpeed': 2,
  'brainstorm|Prestige Power Quick|runSpeed': 2,
  'rebirth|Sprint|runSpeed': 2,
  'rebirth|Prestige Power Slide|runSpeed': 2,
  'rebirth|Prestige Power Rush|runSpeed': 2,
  'rebirth|Prestige Power Surge|runSpeed': 2,
  'rebirth|Prestige Power Dash|runSpeed': 2,
  'rebirth|Prestige Power Quick|runSpeed': 2,
  'thunderspy|Sprint|runSpeed': 3,
  'thunderspy|Sprint|jumpHeight': 2,
  // The fly axis, split as of data-gaps-198's close. Every Parse6 travel power states its
  // speed as several rows — an enhanceable half, an IgnoreStrength half, and on the
  // pool powers a suppressible travel band — against one normalising minus in `slow`.
  // Held to one slot the plus read half of what the game gives while the whole minus
  // landed: Combat Flight -51% where the game gives -1%, Rebirth's Fly -18% where it
  // gives +161%.
  'rebirth|Hover|flySpeed': 2,
  'rebirth|Combat Flight|flySpeed': 2,
  'rebirth|Fly|flySpeed': 3,
  'rebirth|Energy Flight|flySpeed': 3,
  'rebirth|Jetpack|flySpeed': 3,
  'rebirth|Mystic Flight|flySpeed': 3,
  'thunderspy|Combat Flight|flySpeed': 2,
  'thunderspy|Fly|flySpeed': 3,
  'thunderspy|Energy Flight|flySpeed': 3,
  'thunderspy|Jetpack|flySpeed': 3,
  'thunderspy|Mystic Flight|flySpeed': 3,
};

/**
 * Axes the atom side deliberately reads as EMPTY where the bag states a value.
 *
 * Empty since data-gaps-126. The four entries this held — Rebirth's Aerobatics, Solar Glide,
 * Afterburner and Quantum Acceleration fly axes — were `chance: 0` groups whose tags the
 * Parse6 export used to drop, so they read as mode-less sentinels and the atom side
 * silenced the axis while the bag still held a value. With the tags on the wire (data-gaps-11)
 * and the corpus-wide chance-mod pass gating their groups on the minted `kFlightActive`
 * mode (data-gaps-126), BOTH sides now read the axis as conditional: the bag's collector drops
 * the mode-gated group and the base atom reader drops the `gated` atom, so the axis is
 * empty-vs-empty and needs no pin. The rows themselves still exist, gated — a build
 * running a flight toggle gets them through the mode machinery, not through base.
 *
 * The pin mechanism stays: a NEW entry is an axis whose whole contribution has quietly
 * become a sentinel the bag still spends, and it must be read, not re-pinned by reflex.
 */
/**
 * The kFly flight-MODE kills, pinned by name and magnitude.
 *
 * `slowKeyMap` sends both `flySpeed` and `fly` to the flySpeed global, and `fly` is the
 * kFly grant — the switch that says whether the character can fly at all, not how fast.
 * So a grounding power's mode kill was being SPENT as a flight-speed percentage: these
 * nine entries put -1000% on any build running Granite Armor or Rooted, and -1,000,000%
 * on one running Hibernate, Icy Bastion or Geode. It is the +200% Fly double-count
 * (COH-DATA-MODEL §3) in the debuff direction — a mode magnitude read as a speed.
 *
 * The atom side has no key for `FlyMode` on either map, so it drops them. Since
 * data-gaps-174 the converter drops them from the display slow slots too — the bag no
 * longer states a `fly` axis, so this pin is EMPTY, and its live direction is the
 * `NEW kFly mode kill, never read` check below: an entry reappearing here means the
 * extractor has resumed folding the mode axis into `slow`. The retired population
 * (Geode/Granite/Hibernate/Icy Bastion at 10000, Parse6 Granite/Rooted at 10; HC
 * Rooted already gone via data-gaps-126's `kGraniteRoot` gating) is in the data-gaps-174
 * census, docs/gaps/stat-routing.md.
 */
const EXPECTED_MODE_KILLS = {};

const EXPECTED_ABSTENTIONS = {};

/**
 * The bag credits the caster with a buff the power hands to somebody else, and the atom
 * side declines it (data-gaps-63).
 *
 * These powers state their movement rows at `AnyAffected` and name no `Self` in their own
 * `targetsAffected`: Speed Boost and Enforced Morale are `['Friend']` ally buffs a
 * character cannot cast on himself, and Temporal Bomb is `['None']` — a bomb placed on the
 * ground. The bag's routing asked the atom who it landed on, got "whoever the power
 * affects", and kept the slot; the applier's `aspect === 'Cur'` arm then spent it, so
 * casting Speed Boost on an ally gave the CASTER +50% run and fly.
 *
 * Pinned both ways. A LOST entry means the join stopped declining an ally buff, and a NEW
 * one is a power whose caster just lost movement he may be entitled to.
 *
 * No Thunderspy rows, and that absence is read rather than pending: tspy rebalanced Speed
 * Boost to `['Friend', 'Self']`, so the caster IS entitled and the axis agrees outright; its
 * Enforced Morale states no movement at all, and neither Parse6 fork has Temporal Bomb.
 */
const EXPECTED_ALLY_ONLY = {
  // dataset-absent: thunderspy — tspy rebalanced Speed Boost to ['Friend','Self'], so its
  // caster IS entitled and the axis agrees outright; its Enforced Morale states no movement
  // at all, and neither Parse6 fork has Temporal Bomb. Read, not pending.
  'homecoming|Speed Boost|runSpeed': true,
  'homecoming|Speed Boost|flySpeed': true,
  'homecoming|Enforced Morale|runSpeed': true,
  'homecoming|Enforced Morale|flySpeed': true,
  'homecoming|Enforced Morale|jumpSpeed': true,
  'homecoming|Enforced Morale|jumpHeight': true,
  'homecoming|Temporal Bomb|runSpeed': true,
  'homecoming|Temporal Bomb|flySpeed': true,
  // Same five powers on Brainstorm, same verdict, same identity check as the splits
  // above: targetType, targetsAffected, atoms and bag all byte-identical to HC's.
  'brainstorm|Speed Boost|runSpeed': true,
  'brainstorm|Speed Boost|flySpeed': true,
  'brainstorm|Enforced Morale|runSpeed': true,
  'brainstorm|Enforced Morale|flySpeed': true,
  'brainstorm|Enforced Morale|jumpSpeed': true,
  'brainstorm|Enforced Morale|jumpHeight': true,
  'brainstorm|Temporal Bomb|runSpeed': true,
  'brainstorm|Temporal Bomb|flySpeed': true,
  'rebirth|Speed Boost|runSpeed': true,
  'rebirth|Speed Boost|flySpeed': true,
  'rebirth|Enforced Morale|runSpeed': true,
  'rebirth|Enforced Morale|flySpeed': true,
  'rebirth|Enforced Morale|jumpSpeed': true,
  'rebirth|Enforced Morale|jumpHeight': true,
};

/**
 * The other direction: the atom side states a row the bag never had, because the power
 * writes it at `AnyAffected` and its own `targetsAffected` names `Self` (data-gaps-63).
 *
 * Four shapes, all adjudicated against the power's own data:
 *   * **Rest** — `['Self']`, and every movement row `-1000 × Melee_Ones`. Resting grounds
 *     you; the row is the caster's and always was.
 *   * **Team Teleport** — `['DeadOrAliveTeammate', 'Self']`. The caster teleports with the
 *     team and gets the same brief hover.
 *   * **Granite Armor / Rooted** on the Parse6 forks — a `-500 × Melee_Ones` jump-height
 *     kill, the only `AnyAffected` row in an otherwise entirely `Self` power. Homecoming
 *     writes the same grounding as a `Self` cap debuff, which is why it is not here.
 *
 * The magnitudes are switches rather than percentages, and nothing floors them yet: the
 * game's `ClampCur` bounds a current attribute below by its `AttribMin` row, which this
 * pipeline does not export (DATA-GAP-REGISTER data-gaps-193). That is a display gap on top of
 * a correct read, and it predates this: Homecoming's Granite Armor has been stating
 * `-189%` jump speed at `Self` all along.
 */
const EXPECTED_CASTER_RECOVERIES = {
  'homecoming|Rest|runSpeed': true,
  'homecoming|Rest|flySpeed': true,
  'homecoming|Rest|jumpSpeed': true,
  'homecoming|Rest|jumpHeight': true,
  'homecoming|Team Teleport|flySpeed': true,
  'homecoming|Team Teleport|movementControl': true,
  'homecoming|Team Teleport|movementFriction': true,
  'brainstorm|Rest|runSpeed': true,
  'brainstorm|Rest|flySpeed': true,
  'brainstorm|Rest|jumpSpeed': true,
  'brainstorm|Rest|jumpHeight': true,
  'brainstorm|Team Teleport|flySpeed': true,
  'brainstorm|Team Teleport|movementControl': true,
  'brainstorm|Team Teleport|movementFriction': true,
  'thunderspy|Team Teleport|flySpeed': true,
  'thunderspy|Team Teleport|movementControl': true,
  'thunderspy|Team Teleport|movementFriction': true,
  'rebirth|Granite Armor|jumpHeight': true,
  'rebirth|Rooted|jumpHeight': true,
  'thunderspy|Granite Armor|jumpHeight': true,
  'thunderspy|Rooted|jumpHeight': true,
};

/**
 * The pin only means anything over the whole corpus — a filtered run cannot see a
 * split it never swept, so it would read every absence as a LOST one.
 */
const PINNED_DATASETS = [...new Set(Object.keys(EXPECTED_SPLITS).map((k) => k.split('|')[0]))];
const FULL_RUN = !POWER_FILTER && PINNED_DATASETS.every((d) => DATASETS.includes(d));

const stats = { powers: 0, noBag: 0, slots: 0, agree: 0, forkResolved: 0, split: 0, abstain: 0, slow: 0,
  allyOnly: 0, recovered: 0 };
const perDataset = {};
const findings = [];
const splitsSeen = {};
const abstentionsSeen = {};
const allyOnlySeen = {};
const recoveriesSeen = {};
const slowFindings = [];
const slowSplitsSeen = {};
const modeKillsSeen = {};

function checkPower(dataset, power, genPath) {
  const name = power.name || genPath;
  if (POWER_FILTER && !name.toLowerCase().includes(POWER_FILTER.toLowerCase())) return;
  stats.powers++;
  perDataset[dataset] = perDataset[dataset] || { powers: 0, slots: 0 };
  perDataset[dataset].powers++;
  // data-gaps-327 (BPORT7) removed the bag this gate compares against; bag-less powers are vacuous rows, named in the tail.
  if (!power.effects || !Object.keys(power.effects).length) { stats.noBag++; return; }

  // Before the movement map's own early return: a grounding power (Hibernate, Icy
  // Bastion, Geode, Homecoming's Granite Armor) states a self slow and no movement buff
  // at all, so gating the slow sweep behind the movement map's presence made the pin
  // blind to exactly the four largest mode kills in the corpus.
  checkSlow(dataset, name, power);

  const bagMap = power.effects?.movement;
  const atomList = movementBuffValue(power);
  if (!bagMap && !atomList) return;

  for (const axis of AXES) {
    const bag = norm(bagMap?.[axis]);
    const entries = axisEntries(atomList, axis);
    if (!bag && !entries.length) continue;
    stats.slots++;
    perDataset[dataset].slots++;

    // One entry: the plain claim, both directions.
    if (bag && entries.length === 1 && eq(bag, entries[0])) {
      stats.agree++;
      continue;
    }
    // Several entries: the bag holds one of them and has nowhere to put the rest.
    if (bag && entries.length > 1 && entries.some((e) => eq(e, bag))) {
      stats.split++;
      splitsSeen[`${dataset}|${name}|${axis}`] = entries.length;
      continue;
    }
    // No entry: the build-agnostic reader abstains on an archetype-forked slot, so
    // ask each archetype's resolved view instead (see `forkResolvedAgrees`). A view
    // that splits the axis is not a resolution — read the lone entry or nothing.
    if (bag && !entries.length && forkResolvedAgrees(dataset, power, bag, (src) => {
      const view = axisEntries(movementBuffValue(src), axis);
      return view.length === 1 ? view[0] : undefined;
    }, eq)) {
      stats.agree++;
      stats.forkResolved++;
      continue;
    }
    // The atom side reads this axis as empty because every atom on it is a chance-0
    // sentinel naming no mode, and it ANSWERS empty rather than abstaining, so the bag's
    // value is not spent. "The atoms reproduce the bag" is deliberately false here, so it
    // is named rather than scored either way. See EXPECTED_ABSTENTIONS.
    if (bag && !entries.length && EXPECTED_ABSTENTIONS[`${dataset}|${name}|${axis}`]) {
      stats.abstain++;
      abstentionsSeen[`${dataset}|${name}|${axis}`] = true;
      continue;
    }
    // The two data-gaps-63 classes: the bag crediting the caster with somebody else's buff,
    // and the atom side stating a row the bag's recipient test dropped. Both are the fix
    // rather than a divergence, and both are pinned by name.
    const targetsKey = `${dataset}|${name}|${axis}`;
    if (bag && !entries.length && EXPECTED_ALLY_ONLY[targetsKey]) {
      stats.allyOnly++;
      allyOnlySeen[targetsKey] = true;
      continue;
    }
    if (!bag && entries.length && EXPECTED_CASTER_RECOVERIES[targetsKey]) {
      stats.recovered++;
      recoveriesSeen[targetsKey] = true;
      continue;
    }
    findings.push({ dataset, name, axis, bag, entries });
    if (POWER_FILTER) {
      console.log(`  [DIVERGE] ${name} ${axis}  bag=${JSON.stringify(bag)} atoms=${JSON.stringify(entries)}`);
    }
  }
}

/**
 * The same claim for `effects.slow`, self-directed entries only — the map the applier
 * spends through `selfSlowValue`, `?? bag`.
 *
 * It is graded here and not in a gate of its own because the two maps are one thing:
 * a travel power's plus and its minus on one axis are two halves of one authored pair,
 * and the whole reason `slow` became atom-native is that splitting the plus while the
 * minus stayed collapsed counts one without the other. A gate that watched only the
 * plus could not see that.
 *
 * `movementCapDebuff` is NOT covered — it is still a bag read on both engines, so
 * there is no atom claim to grade.
 */
function checkSlow(dataset, name, power) {
  const bagMap = power.effects?.slow;
  const atomList = selfSlowValue(power);
  if (!bagMap && !atomList) return;
  for (const axis of SLOW_AXES) {
    const raw = bagMap?.[axis];
    // The applier reads the self-directed entries and no others; a foe slow shares
    // this map and is not the caster's.
    const bag = raw && typeof raw === 'object' && raw.toWho === 'Self' ? norm(raw) : undefined;
    const entries = axisEntries(atomList, axis);
    if (!bag && !entries.length) continue;
    stats.slow++;
    if (bag && entries.length === 1 && eqValue(bag, entries[0])) continue;
    if (bag && entries.length > 1 && entries.some((e) => eqValue(e, bag))) {
      slowSplitsSeen[`${dataset}|${name}|${axis}`] = entries.length;
      continue;
    }
    if (bag && !entries.length && EXPECTED_ABSTENTIONS[`${dataset}|${name}|${axis}`]) continue;
    if (bag && !entries.length && EXPECTED_ALLY_ONLY[`${dataset}|${name}|${axis}`]) {
      stats.allyOnly++;
      allyOnlySeen[`${dataset}|${name}|${axis}`] = true;
      continue;
    }
    if (!bag && entries.length && EXPECTED_CASTER_RECOVERIES[`${dataset}|${name}|${axis}`]) {
      stats.recovered++;
      recoveriesSeen[`${dataset}|${name}|${axis}`] = true;
      continue;
    }
    // `fly` is the kFly flight-MODE grant, which the bag's `slowKeyMap` sends to the
    // flySpeed global and the atom side has no key for. That is the fix, not a
    // divergence — censused against EXPECTED_MODE_KILLS instead of graded here.
    if (axis === 'fly') {
      modeKillsSeen[`${dataset}|${name}`] = raw.scale;
      // The magnitude must not have found its way onto the speed axis by another
      // route. A mode kill spent as a speed is the whole defect.
      if (axisEntries(atomList, 'flySpeed').some((e) => e.scale === r4(Math.abs(raw.scale)))) {
        slowFindings.push({ dataset, name, axis: 'flySpeed', bag: norm(raw),
          entries: axisEntries(atomList, 'flySpeed') });
      }
      continue;
    }
    slowFindings.push({ dataset, name, axis, bag, entries });
  }
}

for (const ds of DATASETS) sweepDataset(ds, (power, rel) => checkPower(ds, power, rel));

// Every swept power bag-less: the run checks nothing, the tail names it, and the
// bag-derived split census below is waived.
const VACUOUS = stats.powers > 0 && stats.noBag === stats.powers;

console.log('\nPlan B Slice 7 — movement-buff reconstruction (effects.movement)');
console.log(`  powers swept:  ${stats.powers}`);
console.log(`  axis slots:    ${stats.slots}`);
console.log(`  agree:         ${stats.agree}  (of which archetype-fork resolved: ${stats.forkResolved})`);
console.log(`  split axes:    ${stats.split}  (atoms hold a pair the bag has one slot for — data-gaps-198)`);
console.log(`  silenced:      ${stats.abstain}  (every atom on the axis is a chance-0 sentinel naming no mode)`);
console.log(`  ally-only:     ${stats.allyOnly}  (bag credits the caster a buff the power hands elsewhere — data-gaps-63)`);
console.log(`  recovered:     ${stats.recovered}  (atoms state a row the bag's recipient test dropped — data-gaps-63)`);
console.log(`  diverge:       ${findings.length}`);
console.log(`  slow slots:    ${stats.slow}  (effects.slow, self-directed — split axes: ${Object.keys(slowSplitsSeen).length}, diverge: ${slowFindings.length})`);
console.log('  coverage by dataset (a zero here means the DATASET has no movement data,');
console.log('  not that the gate skipped it — see the Thunderspy note in the header):');
for (const ds of DATASETS) {
  const d = perDataset[ds] || { powers: 0, slots: 0 };
  console.log(`      ${ds.padEnd(12)} ${String(d.slots).padStart(5)} axis slots over ${d.powers} powers`);
}

for (const f of findings.concat(slowFindings).slice(0, 60)) {
  console.log(`\n  [DIVERGE] ${f.name} (${f.dataset}) ${f.axis}`);
  console.log(`      bag   : ${JSON.stringify(f.bag)}`);
  console.log(`      atoms : ${JSON.stringify(f.entries)}`);
}
const totalDiverge = findings.length + slowFindings.length;
if (totalDiverge > 60) console.log(`\n  ... and ${totalDiverge - 60} more`);

// The split census, checked against its pin. A filtered run sees only part of the
// corpus, so it prints the census and asserts nothing about it.
const pinFailures = [];
if (FULL_RUN && !VACUOUS) {
  for (const [key, n] of Object.entries(splitsSeen)) {
    if (EXPECTED_SPLITS[key] === undefined) pinFailures.push(`NEW split, never read: ${key} (${n} entries)`);
    else if (EXPECTED_SPLITS[key] !== n) pinFailures.push(`split changed size: ${key} — pinned ${EXPECTED_SPLITS[key]}, found ${n}`);
  }
  for (const key of Object.keys(EXPECTED_SPLITS)) {
    if (splitsSeen[key] === undefined) pinFailures.push(`LOST split: ${key} — the axis collapsed back to one entry`);
  }
  // Both directions again, for the same reason: a NEW abstention is an axis whose whole
  // movement contribution has quietly become a sentinel, and a LOST one is either the
  // sentinel rule regressing or the converter having stopped writing the bag value the
  // fallback spends.
  for (const key of Object.keys(abstentionsSeen)) {
    if (!EXPECTED_ABSTENTIONS[key]) pinFailures.push(`NEW abstention, never read: ${key}`);
  }
  for (const key of Object.keys(EXPECTED_ABSTENTIONS)) {
    if (!abstentionsSeen[key]) pinFailures.push(`LOST abstention: ${key} — the atom side now states this axis`);
  }
  // The two data-gaps-63 classes, both ways. A NEW entry is a power whose caster just gained
  // or lost a movement row and wants adjudicating against its own `targetsAffected`; a LOST
  // one is the join regressing.
  for (const key of Object.keys(allyOnlySeen)) {
    if (!EXPECTED_ALLY_ONLY[key]) pinFailures.push(`NEW ally-only slot, never read: ${key}`);
  }
  for (const key of Object.keys(EXPECTED_ALLY_ONLY)) {
    if (!allyOnlySeen[key]) pinFailures.push(`LOST ally-only slot: ${key} — the caster is being credited again`);
  }
  for (const key of Object.keys(recoveriesSeen)) {
    if (!EXPECTED_CASTER_RECOVERIES[key]) pinFailures.push(`NEW caster recovery, never read: ${key}`);
  }
  for (const key of Object.keys(EXPECTED_CASTER_RECOVERIES)) {
    if (!recoveriesSeen[key]) pinFailures.push(`LOST caster recovery: ${key} — the atom side dropped this row`);
  }
  for (const [key, scale] of Object.entries(modeKillsSeen)) {
    if (EXPECTED_MODE_KILLS[key] === undefined) pinFailures.push(`NEW kFly mode kill, never read: ${key} (${scale})`);
    else if (EXPECTED_MODE_KILLS[key] !== scale) pinFailures.push(`kFly mode kill changed: ${key} — pinned ${EXPECTED_MODE_KILLS[key]}, found ${scale}`);
  }
  for (const key of Object.keys(EXPECTED_MODE_KILLS)) {
    if (modeKillsSeen[key] === undefined) pinFailures.push(`LOST kFly mode kill: ${key} — the converter no longer states it`);
  }
}
console.log('\n  split axes (the bag holds one of these values and has no slot for the rest):');
for (const [key, n] of Object.entries(splitsSeen).sort()) console.log(`      ${key}  ${n} entries`);
if (Object.keys(slowSplitsSeen).length) {
  console.log('  split axes in effects.slow (the minus half of the same pairs):');
  for (const [key, n] of Object.entries(slowSplitsSeen).sort()) console.log(`      ${key}  ${n} entries`);
}
if (Object.keys(modeKillsSeen).length) {
  console.log('  kFly mode kills dropped from the speed axis (bag spends them, atoms do not):');
  for (const [key, v] of Object.entries(modeKillsSeen).sort()) console.log(`      ${key}  ${v}x`);
}
if (Object.keys(abstentionsSeen).length) {
  console.log('  silenced axes (every atom a mode-less chance-0 sentinel; the bag value is NOT spent):');
  for (const key of Object.keys(abstentionsSeen).sort()) console.log(`      ${key}`);
}
if (!FULL_RUN) console.log('      (filtered run — the pin is not checked)');
for (const f of pinFailures) console.log(`  [PIN] ${f}`);

if (totalDiverge || pinFailures.length) {
  if (totalDiverge) {
    console.log('\nFAIL — atom-derived movement diverges from the bag. Fix before migrating the applier.');
  }
  if (pinFailures.length) {
    console.log('\nFAIL — the split-axis census moved. Read each line above before re-pinning it.');
  }
  process.exit(1);
}
if (VACUOUS) {
  console.log(`\nVACUOUS — bag absent: ${stats.noBag} powers swept, 0 checks — vacuous post-data-gaps-327.`);
  console.log('   The atom side is graded by the converter gates, not here.');
} else {
  console.log('\nOK — every bag movement entry is reproduced by an atom entry on its axis.');
  console.log(FULL_RUN
    ? '   The axes the atom side splits are exactly the pinned ones.'
    : '   The split pin was NOT checked — this run swept part of the corpus.');
}
