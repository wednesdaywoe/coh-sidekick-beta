/**
 * Attack Chain Builder — data wiring.
 *
 * Derives `ChainPower[]` and the character endurance parameters from the LIVE
 * build, reusing the same calc functions the power tooltips use so the chain's
 * numbers match the rest of the app. Pure scheduling/endurance math lives in
 * `attack-chain.ts`; this layer is the only part that touches build/data.
 */

import type { ArchetypeStats, Build, SelectedPower, PowerEffects } from '@/types';
import { hasSelfDirectedPenalty, INCARNATE_REQUIRED_LEVEL } from '@/types';
import { getIOSet, arcToDegrees, getJudgementEffects, STANCE_GROUPS, toStancePowers, activeStanceOptionId } from '@/data';
import { getTableValue, calculateIncarnateDamage } from '@/data/at-tables';
import {
  calculatePowerEnhancementBonuses,
  calculatePowerDamage,
  calculateArcanaTime,
  calculateCharacterTotals,
  calculateDamageWithATTable,
  dotTickCount,
} from '@/utils/calculations';
import { calcThreeTier, convertGlobalBonusesToAspects, applyActiveConditionals } from '@/components/info/powerDisplayUtils';
import { selectActiveConditionals, type ATInherentState } from '@/utils/conditional-effects';
import { calculateSlottedProcDamagePerCast } from './power-proc-damage';
import { resolveProcAreaGeometry, resolveProcPatchDuration } from './pet-damage';
import { atMechanicMultiplier, applyAtMechanicBonus, type AtMechanicContext } from './power-at-mechanics';
import { applyQuickSnipe } from '@/utils/quick-snipe';
import { applyModeRedirect } from '@/components/info/resolveEffectivePower';
import type { ChainPower, ChainDoT, ChainForm, ChainPowerType, EnduranceParams, FormTrigger } from './attack-chain';

type CalcResult = ReturnType<typeof calculateCharacterTotals>;
type GlobalBonuses = CalcResult['globalBonuses'];

/**
 * Expected per-attack damage contributed by GRANTED DoT procs (Molten Embrace,
 * Bio Armor Offensive Adaptation, Toxins, Envenomed Blades, …). These live on
 * a hidden Temporary_Powers power the granting power hands out and proc off the
 * player's OWN attacks, so every attack in the chain carries the expected
 * contribution (`tickChance × per-tick × ticks`). A granting power counts only
 * when it is actually active: stance-gated ones (Bio adaptation) only when its
 * option is the build's selected stance (`activeSubPower`); plain passives and
 * toggles whenever taken.
 */
function grantedDoTPerAttack(
  build: Build,
  archetypeId: string | undefined,
  enhDamage: number,
  globalDamageBuffs: number,
): number {
  if (!archetypeId) return 0;
  const stancePowers = toStancePowers(
    build.primary?.powers,
    build.secondary?.powers,
    ...(build.pools ?? []).map((pool) => pool.powers),
    build.epicPool?.powers,
  );
  let total = 0;
  for (const p of allBuildPowers(build)) {
    const procs = p.grantedDamageProcs;
    if (!procs || procs.length === 0) continue;
    // Stance-gated granting power (Bio Offensive Adaptation): only its own
    // stance is selected. Same gate the Mechanic Adjusters picker reads.
    const group = STANCE_GROUPS.find((g) => g.options.some((o) => o.subPower === p.internalName));
    if (group) {
      const option = group.options.find((o) => o.subPower === p.internalName);
      if (!option || activeStanceOptionId(stancePowers, group) !== option.id) continue;
    }
    for (const proc of procs) {
      const ticks = proc.period && proc.duration ? dotTickCount(proc.duration, proc.period) : 1;
      const perTick = proc.damage.reduce((sum, d) => {
        const v = calculateDamageWithATTable(
          d.scale, d.table, archetypeId, build.level,
          proc.enhanceable ? enhDamage : 0,
          proc.enhanceable ? globalDamageBuffs : 0,
        ) ?? 0;
        return sum + v;
      }, 0);
      total += (proc.tickChance ?? 1) * perTick * ticks;
    }
  }
  return total;
}

interface Candidate {
  /** The variant for `modes[0]` — the power's DEFAULT numbers in this chain. */
  power: SelectedPower;
  /** Every caster form this power is castable in, `null` = human. Never empty
   *  (a power castable in no form is not a candidate at all). */
  modes: (string | null)[];
  /** The mode-redirected power for each entry of `modes`. */
  variants: Map<string | null, SelectedPower>;
  /** The UNREDIRECTED internalName. A mode redirect renames the power
   *  (`Gleaming_Bolt` → `Dwarf_Gleaming_Bolt`), and the chain id must not move
   *  with the caster's form: it is one tray slot on one cooldown. */
  internalName: string;
  powersetName: string;
  /** Powerset id (e.g. "scrapper/dark-melee") — gates the AT crit mechanic. */
  powersetId: string;
  category?: 'PRIMARY' | 'SECONDARY';
  /** stable bucket prefix so ids don't collide across sets/pools. */
  bucket: string;
}

// Base timing/cost reads that handle the data-shape split: primary/secondary
// powers carry these under `stats`, but pool / epic / patron powers (built by
// power-pools.ts / epic-pools.ts, which rename activationTime → castTime) carry
// them under `effects` with no `stats` block. Read `stats` first, then `effects`.
const powerCastTime = (p: SelectedPower): number => p.stats?.castTime ?? p.effects?.castTime ?? 0;
const powerBaseRecharge = (p: SelectedPower): number => p.stats?.recharge ?? p.effects?.recharge ?? 0;
const powerEndCost = (p: SelectedPower): number => p.stats?.endurance ?? p.effects?.enduranceCost ?? 0;
const powerRadius = (p: SelectedPower): number => p.stats?.radius ?? p.effects?.radius ?? 0;
const powerArc = (p: SelectedPower): number | undefined => p.stats?.arc ?? p.effects?.arc;

/**
 * Powers with an alternate "build/spend" cast form in the chain, keyed by
 * internalName. Slice 1: Energy Transfer's Energy-Focus fast cast — the only
 * divergence from the base power is the animation time (1.0s vs the base
 * 2.67s); damage and endurance match, so the form spec carries just `castTime`.
 * The fast form is gated on an `energy_focus` charge that Total Focus grants
 * (see CHARGE_GRANTS). Sourced from the redirect data
 * (exported_powers/redirects/energy_melee/energy_transfer_fast.json).
 *
 * This table lives at the chain layer for now; once the converter extracts
 * redirect forms it migrates onto the Power data. Reserved triggers (`tohit`
 * for fast snipes, `hidden` for Assassin's Strike) plug in here too.
 */
interface FormSpec {
  id: string;
  label: string;
  kind: 'fast' | 'slow';
  /** Overrides the base cast time (seconds, pre-ArcanaTime); omit to inherit. */
  castTime?: number;
  trigger: FormTrigger;
}
const POWER_FORMS: Record<string, FormSpec[]> = {
  Energy_Transfer: [
    { id: 'fast', label: 'Energy Focus', kind: 'fast', castTime: 1.0, trigger: { type: 'charge', resource: 'energy_focus' } },
  ],
};
/** internalName → the consumable charge the power grants when cast. Placate
 *  re-Hides you, so it grants `hidden` — the marker the chain checks to let an
 *  immediately-following Assassin's Strike fire its slow from-Hide form. */
const CHARGE_GRANTS: Record<string, string> = { Total_Focus: 'energy_focus', Placate: 'hidden' };

/**
 * A caster-form switch, in seconds of RAW animation (pre-ArcanaTime). These two
 * are CHAIN-LAYER modelling constants and live here beside {@link POWER_FORMS}
 * for the same reason it does.
 *
 * They must never be written into the export tree, a dataset's generated layer,
 * or a dataset overrides file. Both are INFERRED; putting an inferred number
 * where extracted data lives makes it indistinguishable from extracted data, and
 * it would then survive a future re-export as a stale pin.
 *
 * ── Where they come from ────────────────────────────────────────────────────
 * The four Kheldian form toggles (Black Dwarf, Dark Nova, Bright Nova, White
 * Dwarf) carry `activation_time 0.0`. That is REAL data, not an extraction gap.
 * Decoding `bin_sequencers.pigg → bin/sequencers.bin` shows why — the sequencer
 * author SPLIT the shapeshift move in two:
 *
 *   TRANSFORM_KHELDIAN   (ground, move 2563)  <body>/PRE_POISON  frames 1 → 2
 *                                             + FEET/TRANSFORM.FX
 *   TRANSFORM_KHELDIAN2  (move 2564)          <body>/PRE_POISON  frames 3 → end
 *
 * The first segment is the BLOCKING cast: 2 frames = 0.0667s at 30fps, with the
 * frame rate calibrated against 96 move↔power pairs — exact hits that reproduce
 * the 2-dp rounding in the power definitions. From frame 3 the second move
 * auto-chains as a NON-blocking segment carrying eight interrupt states
 * (<DEATHIRQ> <HITIRQ> <REACTIRQ> <ATTACKIRQ> <BLOCKIRQ> <MOVEIRQ>
 * <IRQEMOTESALL> <IRQENCOUNTERS>), so attacking or moving truncates it. That is
 * the animation-cancel Homecoming players use, and it is a consequence of where
 * the move was split. (Deliberately not written as "frames 3-124": 124 is the
 * shared clip's length, which the next paragraph refutes as evidence about this
 * power — quoting it here as the segment's extent would state the refuted
 * reading as fact two lines before refuting it.)
 *
 * The full uncancelled shift is 2.033s = 61 frames. It is NOT the 124-frame
 * (4.133s) clip: that reading was REFUTED — 124 frames is the length of the
 * shared clip, and the power→move binding is by NAME only, so the clip's length
 * is not evidence about this power. The 61 frames come from a sibling-power
 * oracle instead: seven sibling powers performing the same shapeshift with the
 * same BLASTERSHAPSHIFT FX (including NPC re-issues of these very powers), plus
 * DEACTIVATE_KHELDIAN — the return to human — reading 61 independently.
 *
 * ── Why 0.067 and not 0 ─────────────────────────────────────────────────────
 * 0.067 is a measured number, and `calculateArcanaTime` treats it as one:
 * (ceil(0.067 / 0.132) + 1) × 0.132 = 0.264s. Passing 0 instead takes the
 * function's `<= 0` branch and returns a bare 0.132s tick, which is a different
 * — and wrong — answer.
 */
export const SHAPESHIFT_BLOCKING_CAST = 0.067;
/** @see SHAPESHIFT_BLOCKING_CAST — 61 frames at 30fps, the uncancelled shift. */
export const SHAPESHIFT_FULL_ANIM = 2.033;

/** Every power the build holds, across primary, secondary, pools and the epic pool. */
function allBuildPowers(build: Build): SelectedPower[] {
  return [
    ...(build.primary?.powers ?? []),
    ...(build.secondary?.powers ?? []),
    ...(build.pools?.flatMap((pool) => pool.powers ?? []) ?? []),
    ...(build.epicPool?.powers ?? []),
  ];
}

/**
 * The caster forms this build can build a chain in — the Kheldian Nova/Dwarf forms, and
 * nothing else unless a fork adds a mode shaped the same way.
 *
 * Derived, never listed. A mode qualifies when the build can enter it (some power the
 * build holds `setsModes` it) AND entering it changes what can be cast (some click the
 * build holds requires it or is disallowed in it). The second half is what keeps the
 * selector honest: the form toggles also set `Suppress_PoolToggles` and `Disable_Walk`,
 * which gate no click and so are never offered; Granite Armor's `Granite_Mode` gates only
 * two global-boost redirects, so a Stone build gets no selector at all.
 *
 * It is also what confines the gate in {@link castableInMode} to forms. `modesRequired`
 * carries plenty that is NOT a form — Titan Weapons' Momentum (`FastMode`), Swap Ammo's
 * `LethalAmmo`, the `*On` travel toggles — and those stay out because the only click that
 * requires one is its own toggle's free rider, which is not chain material (see below).
 */
export function buildFormModes(build: Build): string[] {
  const powers = allBuildPowers(build);
  const settable = new Set<string>();
  for (const p of powers) for (const mode of p.setsModes ?? []) settable.add(mode);
  if (settable.size === 0) return [];

  const gating = new Set<string>();
  for (const p of powers) {
    if (p.powerType !== 'Click') continue;
    // Only a click that could actually sit in a chain makes a mode a FORM — the same
    // free-rider predicate `collectCandidates` applies below, and for the same reason.
    // Three HC travel pools ship a setter/gate pair entirely inside the pool: Speed of
    // Sound → Jaunt, Mighty Leap → Stomp, Mystic Flight → Translocation. Each rider is
    // auto-granted, carries an empty `boosts_allowed`, and is `modesRequired` on its
    // parent toggle's `*On` mode — so without this the selector offered a bogus "Mystic
    // Flight active" form whose candidate roster is identical to Human's. (Invisible
    // until the pool facade started carrying `setsModes` / `modesRequired` at all; it
    // dropped both, which is why the docstring above could once claim the travel
    // toggles had no setter/gate pair.) A Kheldian form's attacks are auto-granted too
    // and are exactly the powers the form exists for — they are slottable, which is
    // what separates the two.
    if (p.isAutoGranted && !p.allowedEnhancements?.length) continue;
    for (const mode of p.modesRequired ?? []) if (settable.has(mode)) gating.add(mode);
    for (const mode of p.modesDisallowed ?? []) if (settable.has(mode)) gating.add(mode);
  }
  return [...gating];
}

/**
 * The form switches a cross-form chain can schedule: one per form the build can
 * enter, plus one back to human.
 *
 * A switch is a first-class {@link ChainPower} (`type: 'switch'`) rather than a
 * timeline annotation, so `findSlot` reserves its animation and the
 * one-animation-at-a-time invariant covers it for free — and its recharge lane
 * is the toggle's own.
 *
 * Everything except the cast time is READ FROM THE TOGGLE. The form toggle is
 * not a `Click`, so it never reaches {@link collectCandidates}; this builds from
 * its `SelectedPower` directly, through the same helpers every other ChainPower
 * uses. That is where the 1s floor on re-shift cadence comes from (the Kheldian
 * toggles carry `recharge_time 1.0`), and the 0.13 endurance the shift costs —
 * neither is invented here. Only `cast` is a modelling constant
 * ({@link SHAPESHIFT_BLOCKING_CAST}); the opt-in full animation rides as a
 * `manual` form so flipping the assumption does not rebuild the roster.
 *
 * `globalForCalc` is the same aspect map {@link buildChainPowers} passes to
 * `calcThreeTier`, so a switch's endurance is reduced by the build's global
 * end-cost bonuses exactly like every attack's. Omit it and you get the
 * unreduced cost.
 */
export function buildFormSwitchPowers(
  build: Build,
  globalForCalc: ReturnType<typeof convertGlobalBonusesToAspects> = {},
): ChainPower[] {
  const modes = buildFormModes(build);
  if (modes.length === 0) return [];
  const powers = allBuildPowers(build);

  /** The uncancelled tail, as the opt-in alternate form. */
  const fullShift = (endCost: number): ChainForm => ({
    id: 'full',
    label: 'Full shift animation',
    kind: 'slow',
    cast: calculateArcanaTime(SHAPESHIFT_FULL_ANIM),
    damage: 0,
    endCost,
    dot: null,
    trigger: { type: 'manual' },
  });

  const out: ChainPower[] = [];
  for (const mode of modes) {
    // The power that ENTERS this form, under the same free-rider discipline
    // buildFormModes applies to the gating click: an auto-granted power with an
    // empty `boosts_allowed` is a travel toggle's rider, never a form toggle.
    const toggle = powers.find(
      (p) => p.setsModes?.includes(mode) && !(p.isAutoGranted && !p.allowedEnhancements?.length),
    );
    if (!toggle) continue;
    const enh = calculatePowerEnhancementBonuses(
      { name: toggle.name, slots: toggle.slots }, build.level, getIOSet,
    );
    const fixed = toggle.strengthsDisallowed?.includes('RechargeTime');
    // For a toggle `stats.endurance` is the per-period drain, which the game
    // also charges once at activation — that activation charge is what a shift
    // costs. The ongoing drain is already in the build's `togglePerSec`.
    const endCost = calcThreeTier('endurance', powerEndCost(toggle), enh, globalForCalc).final;
    out.push({
      id: `switch:${mode}`,
      name: toggle.name,
      type: 'switch',
      switchTo: mode,
      cast: calculateArcanaTime(SHAPESHIFT_BLOCKING_CAST),
      baseRecharge: powerBaseRecharge(toggle),
      rechargeEnh: fixed ? 0 : (enh.recharge || 0),
      ...(fixed ? { fixedRecharge: true } : {}),
      endCost,
      damage: 0,
      dot: null,
      // Shifting Nova → Dwarf is one click, so every form but the destination is
      // a legal starting point. Re-entering the form you are wearing is not.
      castableModes: [null, ...modes].filter((m) => m !== mode),
      forms: [fullShift(endCost)],
    } satisfies ChainPower);
  }
  if (out.length === 0) return [];

  out.push({
    id: 'switch:human',
    name: 'Human Form',
    type: 'switch',
    switchTo: null,
    cast: calculateArcanaTime(SHAPESHIFT_BLOCKING_CAST),
    // Dropping a form is a DETOGGLE: no activation cost and no cooldown of its
    // own. The 1s recharge on a form toggle gates re-ENTERING that form, which
    // the per-form switches above already carry. Deliberately not borrowed from
    // one of those toggles — WHICH form is being dropped is a timeline fact, not
    // a build fact, so there is no single toggle to read. Known simplification:
    // the dropped form's own lane is therefore not put on cooldown here.
    baseRecharge: 0,
    rechargeEnh: 0,
    endCost: 0,
    damage: 0,
    dot: null,
    castableModes: [...modes],
    forms: [fullShift(0)],
  } satisfies ChainPower);
  return out;
}

/**
 * Whether `power` can be cast while `mode` is the live form (null = no form).
 *
 * Both halves of the binary's gate are read, and they are not complements:
 * `modesDisallowed` is what refuses the cast, while a power with a `modeVariants`
 * redirect into a form is deliberately absent from it — the game plays the form's
 * version instead (see `Power.modesDisallowed`).
 *
 * A requirement is only enforced when the required mode is one of this build's
 * `formModes`, so Momentum- and ammo-gated attacks are unaffected.
 */
function castableInMode(power: SelectedPower, mode: string | null, formModes: string[]): boolean {
  if (mode && power.modesDisallowed?.includes(mode)) return false;
  for (const required of power.modesRequired ?? []) {
    if (formModes.includes(required) && required !== mode) return false;
  }
  return true;
}

/** Click powers (attacks, click buffs, click controls) from every powerset.
 *  Toggles/autos/passives can't sit in an attack chain, so they're excluded.
 *
 *  Returns the UNION across caster forms — one candidate per power, tagged with
 *  every form it can be cast in and carrying that form's redirect. It used to
 *  take a single `mode` and drop every other form's roster, which is what
 *  confined a chain to one form; a cross-form rotation needs them all present at
 *  once so the palette can DIM an unavailable power rather than hide it, and so
 *  `Bolt → shift → Bolt` stays one power on one cooldown lane.
 *
 *  The result does NOT depend on which form the chain opens in — one roster with
 *  one set of ids, whatever the caster is wearing. Which VARIANT a cast uses is a
 *  per-cast question the scheduler answers from the live form. */
function collectCandidates(build: Build): Candidate[] {
  const out: Candidate[] = [];
  const formModes = buildFormModes(build);
  // Human FIRST, and unconditionally: `modes[0]` becomes the ChainPower's base
  // and every other castable mode rides beside it as a `mode` form. Human has to
  // be the base wherever it is castable at all, because a `mode` trigger names a
  // form and there is no trigger meaning "no form" — human cannot be expressed
  // as a sibling, so it must be what the siblings fall back to.
  const ordered: (string | null)[] = [null, ...formModes];
  const add = (
    powers: SelectedPower[] | undefined,
    powersetName: string,
    powersetId: string,
    bucket: string,
    category?: 'PRIMARY' | 'SECONDARY',
  ) => {
    powers?.forEach((p) => {
      if (p.powerType !== 'Click') return;
      // Auto-granted powers don't cost a pick, which says nothing about whether they
      // can be cast in a rotation — the Kheldian form attacks are auto-granted and are
      // the whole rotation in that form. What separates them from the free riders a
      // travel power hands out (Double Jump, Translocation, Jaunt) is that the game
      // lets you slot them: those carry an empty `boosts_allowed` in the export.
      if (p.isAutoGranted && !p.allowedEnhancements?.length) return;
      // Needs a cast time from EITHER shape (stats or effects) to sit in a chain.
      if (p.stats?.castTime == null && p.effects?.castTime == null) return;
      const modes = ordered.filter((m) => castableInMode(p, m, formModes));
      if (modes.length === 0) return;
      const variants = new Map<string | null, SelectedPower>(
        modes.map((m) => [m, m ? (applyModeRedirect(p, [m]) as SelectedPower) : p]),
      );
      out.push({
        power: variants.get(modes[0])!,
        modes,
        variants,
        internalName: p.internalName,
        powersetName,
        powersetId,
        category,
        bucket,
      });
    });
  };
  add(build.primary?.powers, build.primary?.name ?? 'Primary', build.primary?.id ?? '', 'pri', 'PRIMARY');
  add(build.secondary?.powers, build.secondary?.name ?? 'Secondary', build.secondary?.id ?? '', 'sec', 'SECONDARY');
  build.pools?.forEach((pool, i) => add(pool.powers, pool.name ?? 'Pool', pool.id ?? '', `pool${i}`));
  add(build.epicPool?.powers, build.epicPool?.name ?? 'Epic', build.epicPool?.id ?? '', 'epic');
  return out;
}

/** Resolve an effect's duration (s) from the per-effect `durations` map: try
 *  each key in priority order (exact, then any duration key whose base — before
 *  a `_suffix` like the strength meta-template discriminator — matches), then
 *  the supplied power-level fallbacks. 0 when nothing positive is found. Shared
 *  by the self-buff and foe-debuff window helpers so they resolve identically. */
function resolveEffectDuration(
  e: PowerEffects,
  keys: readonly string[],
  fallbacks: ReadonlyArray<number | undefined>,
): number {
  const durs = e.durations;
  if (durs) {
    for (const k of keys) {
      const exact = durs[k];
      if (typeof exact === 'number' && exact > 0) return exact;
      for (const dk of Object.keys(durs)) {
        if (dk.split('_')[0] === k) {
          const v = durs[dk];
          if (typeof v === 'number' && v > 0) return v;
        }
      }
    }
  }
  for (const f of fallbacks) if (typeof f === 'number' && f > 0) return f;
  return 0;
}

/** Self-buff fields for offensive click buffs (Build Up / Aim / Soul Drain /
 *  Hasten / Follow Up) — separate from the foe-debuff keys, so a −ToHit debuff
 *  never lands here. */
const SELF_BUFF_KEYS = ['damageBuff', 'tohitBuff', 'rechargeBuff'] as const;

/** Self-buff window (seconds), or 0 when the power isn't a self-buff. */
function selfBuffWindow(power: SelectedPower): number {
  const e = power.effects;
  if (!e) return 0;
  const present = SELF_BUFF_KEYS.filter((k) => e[k] != null);
  if (present.length === 0) return 0;
  return resolveEffectDuration(e, present, [e.buffDuration]);
}

/** Window (seconds) during which this power's ToHit buff is active — Build Up,
 *  Aim, Soul Drain. Gated specifically on a ToHit buff (not the broader
 *  self-buff set) so a recharge-only buff like Hasten doesn't wrongly mark a
 *  snipe fast. 0 when the power grants no ToHit buff. */
function toHitBuffWindow(power: SelectedPower): number {
  const e = power.effects;
  if (!e || (e.tohitBuff == null && e.tohitBuffUnenhanced == null)) return 0;
  return selfBuffWindow(power);
}

/** Foe-debuff keys (target-facing) that warrant a duration "window" on the
 *  timeline. Deliberately a CURATED subset of the effect-registry's
 *  `category: 'debuff'` entries — not all of them qualify: `enduranceCrash` is a
 *  self-penalty crash, and `enduranceDrain` / `specialDebuff` are instant or
 *  odd-shaped, none of which represent a maintained foe debuff. Driving this
 *  from the registry verbatim would draw spurious windows for those. Powers
 *  with a self-directed penalty (`toWho:'Self'`, Granite Armor etc.) reuse some
 *  of these as self-downsides and are excluded by `foeDebuffWindow`. */
const FOE_DEBUFF_KEYS = [
  'tohitDebuff',
  'defenseDebuff',
  'resistanceDebuff',
  'damageDebuff',
  'regenDebuff',
  'recoveryDebuff',
  'rechargeDebuff',
  'accuracyDebuff',
  'slow',
  'threatDebuff',
  'perceptionDebuff',
] as const;

/** Foe-debuff window (seconds) for any power applying a debuff to enemies —
 *  Touch of Fear −ToHit, Dark Melee −ToHit, −Res/−Regen attacks, etc. Unlike
 *  self-buffs this applies to damaging attacks too. Uses the duration of
 *  whichever present debuff actually has one (not blindly the first key), then
 *  the power-level debuff/effect duration. 0 = no debuff. */
function foeDebuffWindow(power: SelectedPower): number {
  const e = power.effects;
  if (!e || hasSelfDirectedPenalty(e)) return 0;
  const present = FOE_DEBUFF_KEYS.filter((k) => e[k] != null);
  if (present.length === 0) return 0;
  return resolveEffectDuration(e, present, [e.effectDuration, e.buffDuration]);
}

/** Self endurance gained on cast by a click recovery power (Dark Consumption /
 *  Consume / Power Sink), scaled by the targets-hit slider. enduranceGain is a
 *  percent of the 100-endurance base (so the resolved value ≈ endurance points);
 *  EndMod enhancement scales it. The per-target formula matches the InfoPanel:
 *  scale + perTarget·(targetsHit − 1) — at 0 targets a per-foe power nets 0. */
function selfEnduranceGain(
  power: SelectedPower,
  targetsHit: number,
  endMod: number,
  archetypeId: string,
  level: number,
): number {
  const eg = power.effects?.enduranceGain;
  if (eg == null) return 0;
  let value: number;
  if (typeof eg === 'number') {
    value = eg;
  } else {
    const scale = eg.scale + (eg.perTarget ?? 0) * (targetsHit - 1);
    value = scale * (getTableValue(archetypeId, eg.table, level) ?? 1);
  }
  value *= 1 + endMod;
  return value > 0 ? value : 0;
}

/** The build's slotted Judgement power as a ChainPower, or null if none is
 *  selected (or the build's level is below the incarnate threshold — no slot
 *  access, no chain candidate). Judgement is modeled separately from
 *  `collectCandidates`/`deriveDamage`: it isn't a `SelectedPower` (no `stats`/
 *  `effects`/`slots` — see `SelectedIncarnatePower`), its damage comes from
 *  the display-only `JudgementEffects` registry via `calculateIncarnateDamage`
 *  (unenhanceable — Judgement can't be slotted, so there's no ED/set-bonus
 *  path to run), and its 90s recharge is flat: neither slotted IOs nor global
 *  recharge bonuses affect it in-game, hence `fixedRecharge: true`. */
function buildJudgementChainPower(build: Build, archetypeId: string | undefined): ChainPower | null {
  const sel = build.incarnates?.judgement;
  if (!sel || build.level < INCARNATE_REQUIRED_LEVEL) return null;
  const fx = getJudgementEffects(sel.powerId);
  if (!fx) return null;
  const damage = archetypeId ? calculateIncarnateDamage(fx.damageScale, fx.tableName, archetypeId, build.level) : null;
  return {
    id: `judgement:${sel.powerId}`,
    name: sel.displayName,
    type: 'attack',
    cast: calculateArcanaTime(fx.activationTime),
    baseRecharge: fx.rechargeTime,
    rechargeEnh: 0,
    fixedRecharge: true,
    endCost: 0,
    damage: damage ?? 0,
    dot: null,
  } satisfies ChainPower;
}

/**
 * The conditional-effect toggle state the chain resolves each power under — the
 * SAME maps the InfoPanel reads, so a bonus the tooltip shows is a bonus the
 * chain's DPS counts. Defaults to the empty maps, which means every conditional
 * falls back to its own `defaultActive` (Gravity Control's Impact is on).
 *
 * Deliberately NOT `resolveEffectivePower`: that resolver also swaps in a
 * snipe's quick form and Assassin's Strike's mid-combat cast, and the chain
 * models both of those as ALTERNATE FORMS on one timeline rather than as a
 * single current state. Only the conditional merge is shared. Mode redirects
 * (`power.modeVariants` — Kheldian forms, Momentum) ride the same alternate-form
 * machinery, one `mode`-triggered {@link ChainForm} per caster form.
 */
export interface ChainConditionalState {
  /** `scope: 'global'` toggles by conditional id — pass through
   *  `effectiveGlobalAdjusters` so the build's live stance wins over a stale toggle. */
  globalAdjusters?: Record<string, boolean>;
  /** `scope: 'per-power'` toggles, keyed `<internalName>:<id>`. */
  mechanicAdjusters?: Record<string, boolean>;
  /** AT-inherent mechanics the Header owns rather than the toggle maps. */
  atInherentState?: ATInherentState;
  // NOTE: the caster form used to live here as `formMode` — "the one form this chain lives
  // in" — because the roster was rebuilt per form and a chain could not leave the one it was
  // built in. A chain now SPANS forms via `switch` steps, so the roster is a union and does
  // not depend on the form at all. What remains of that field is `FormContext.startForm`,
  // "the form the chain OPENS in", which the SCHEDULER reads (replayChain / nextPickForm /
  // computeChain) — not this builder.
}

/** Build the per-power chain data for the current build. `targetsHit` maps a
 *  power's name → the targets-hit slider value (for per-target effects like the
 *  endurance gain on Dark Consumption); defaults to none. */
export function buildChainPowers(
  build: Build,
  globalBonuses: GlobalBonuses,
  mechCtx: AtMechanicContext,
  targetsHit: Record<string, number> = {},
  conditionalState: ChainConditionalState = {},
): ChainPower[] {
  const globalForCalc = convertGlobalBonusesToAspects(globalBonuses);
  const archetypeId = build.archetype?.id ?? undefined;

  const judgement = buildJudgementChainPower(build, archetypeId);

  const { globalAdjusters = {}, mechanicAdjusters = {}, atInherentState = {} } = conditionalState;
  // Non-empty only for a build that can shapeshift. It is what turns
  // `castableModes` on: with no form to be in, every cast is trivially legal and
  // tagging every power with `[null]` would be noise the legality walk re-checks
  // for nothing.
  const formModes = buildFormModes(build);

  const powers = collectCandidates(build).map(({
    power, modes, variants, internalName, powersetName, powersetId, category, bucket,
  }) => {
    // Conditional contributions whose gate is on (Gravity Control's Impact, a
    // Bio Armor stance, Domination). Selected ONCE from the base power — every
    // cast form shares the same `conditionalEffects` and the same toggle key —
    // then merged per form rather than once up front, because `applyQuickSnipe`
    // REPLACES `damage` outright and would drop an earlier merge. No power today
    // has both a conditional and an alternate form, so that ordering is
    // defensive; it costs nothing and stops the pairing being a latent bug.
    const activeConditionals = selectActiveConditionals(power, mechanicAdjusters, globalAdjusters, atInherentState);
    const withConditionals = <T extends SelectedPower>(p: T): T =>
      activeConditionals.length === 0 ? p : (applyActiveConditionals(p, activeConditionals).power as T);
    // The power as the rest of this function should read it — effect windows and
    // the click endurance gain included, not just damage.
    const effectivePower = withConditionals(power);

    const enh = calculatePowerEnhancementBonuses(
      { name: power.name, slots: power.slots },
      build.level,
      getIOSet,
    );

    const baseRecharge = powerBaseRecharge(power);
    const baseEnd = powerEndCost(power);
    const endCost = calcThreeTier('endurance', baseEnd, enh, globalForCalc).final;

    // AT hit-time multiplier (crit / scourge / containment / assassination /
    // opportunity) — applies to base damage + DoT, NOT procs. 1.0 when no
    // mechanic is active. For DPS a chance-AVERAGED crit is the right model,
    // so the Scrapper flat ×1.10 stays here; the InfoPanel's "w/ Crit" column
    // instead shows the power's own crit rows (see power-at-mechanics.ts).
    const mechMult = atMechanicMultiplier(powersetId, mechCtx, power.fromHideBonus);

    // Assassin's Strike models from-Hide POSITIONALLY (opener / post-Placate)
    // via a slow `hidden` form, not the global hidden toggle. So its base is the
    // fast mid-combat Quick cast with the mid-combat multiplier (the global
    // toggle is ignored for AS to avoid double-counting), and the from-Hide hit
    // becomes an alternate form below. Only HC's two-redirect AS carries
    // midCombatCast; Rebirth's single-form AS falls through to the normal path.
    const isAS = power.fromHideBonus != null && power.midCombatCast != null;
    const asMidPower: SelectedPower | null = isAS
      ? { ...power, stats: { ...power.stats, castTime: power.midCombatCast, interruptTime: undefined } }
      : null;
    const basePower = asMidPower ?? power;
    const baseMult = isAS
      ? atMechanicMultiplier(powersetId, { ...mechCtx, effectiveHidden: false })
      : mechMult;
    const cast = calculateArcanaTime(powerCastTime(basePower));

    // Derive a form's chain damage (direct + in-cast DoT × AT mult + procs) and
    // its after-cast DoT. Run for the base power, and again for a snipe's
    // In-Combat fast variant — which has BOTH lower damage and a shorter cast
    // (→ different proc chance), so the fast form's numbers must be recomputed,
    // not scaled from the slow form's. `mult` defaults to the base power's AT
    // multiplier; a form (AS from-Hide) can pass its own.
    const deriveDamage = (raw: SelectedPower, mult: number = baseMult): { damage: number; dot: ChainDoT | null } => {
      const p = withConditionals(raw);
      const hasDamage = !!p.damage || !!p.effects?.damage;
      const dmg = hasDamage
        ? calculatePowerDamage(
            p,
            { level: build.level, archetypeId, primaryName: powersetName, primaryCategory: category },
            { damage: enh.damage || 0 },
            globalForCalc.damage ?? 0,
            0,
          )
        : null;
      // Pure-DoT powers carry the per-tick value in `final`; mirror DamageBlock's
      // detection so a tick isn't double-counted.
      const dotData = dmg?.dotDamage ?? null;
      const isPureDot = dotData ? Math.abs((dmg?.base ?? 0) - dotData.base) <= 0.001 : false;
      const directHit = isPureDot ? 0 : (dmg?.final ?? 0);
      // Probability-weighted ticks (cancel-on-miss / chance-gated) for the
      // in-cast fold; the trailing DoT weights per tick on the timeline instead.
      const dotTotal = dotData ? dotData.final * dotData.effectiveTicks : 0;
      // A DoT that fits inside the animation ticks during the swing (fold into
      // the hit); one that outlasts it lingers after the cast (trailing marks).
      const rawCastP = powerCastTime(p);
      const dotInCast = !!dotData && dotData.duration > 0 && dotData.duration <= rawCastP + 0.05;
      // Slotted-proc damage keys off the recharge window (base, shrunk by this
      // power's own recharge and widened back by the build's global) and the cast
      // time, so a shorter (fast-snipe) cast yields a different PPM chance.
      // Summon-shell AoEs (rains, Bonfire, Lightning Rod) carry radius 0 on the
      // parent, so the raw read scored their procs single-target — and the patch
      // owns the roll CLOCK as well as the footprint. Both come off the summon.
      const directRadiusP = powerRadius(p);
      const { radius: radiusP, arcDegrees: arcP } = resolveProcAreaGeometry(
        directRadiusP, arcToDegrees(powerArc(p)) || undefined, p.summon);
      const procDmg = calculateSlottedProcDamagePerCast({
        slots: p.slots,
        baseRecharge,
        castTime: rawCastP,
        radius: radiusP,
        arcDegrees: arcP,
        rechargeEnh: enh.recharge || 0,
        globalRechargeEnh: globalForCalc.recharge || 0,
        buildLevel: build.level,
        procsOnlyOnMainTarget: p.procsOnlyOnMainTarget,
        procsAllowed: p.procsAllowed,
        procRollSites: p.procRollSites,
        powerType: p.powerType,
        patchDuration: resolveProcPatchDuration(directRadiusP, p.summon),
      });
      const dot = dotData && !dotInCast
        ? {
            ticks: dotData.ticks,
            period: dotData.tickRate,
            perTick: dotData.final * mult,
            ...(dotData.chance !== undefined ? { chance: dotData.chance } : {}),
            ...(dotData.cancelOnMiss ? { cancelOnMiss: true } : {}),
          }
        : null;
      // The AT's hit-time mechanic multiplies the hit, but NOT the slice carried
      // by entries the game never mints an `*_InherentDamage` twin of — Gravity
      // Control's Impact. Folding Impact in and then doubling the sum would read
      // (1.96 + 0.49) × 2 where the game gives 1.96 × 2 + 0.49. Same seam the
      // InfoPanel's damage column uses, so the two surfaces cannot diverge.
      const exempt = isPureDot ? 0 : (dmg?.atMechanicExemptDamage?.final ?? 0);
      // Granted DoT procs (Molten Embrace, Bio Offensive Adaptation, …) fire off
      // the player's attacks at their expected per-cast value — folded into the
      // per-attack damage the chain schedules, exactly the open-item ask. Gated
      // on `hasDamage` so a pure buff (Build Up) doesn't gain pseudo-attack
      // damage and flip its chain classification.
      const grantedDmg = hasDamage
        ? grantedDoTPerAttack(build, archetypeId, enh.damage || 0, globalForCalc.damage ?? 0)
        : 0;
      const damage = applyAtMechanicBonus(directHit + (dotInCast ? dotTotal : 0), mult, exempt) + procDmg + grantedDmg;
      return { damage, dot };
    };

    const { damage, dot } = deriveDamage(basePower);
    // Snipe In-Combat (fast) form: applyQuickSnipe swaps in the reduced-damage,
    // shorter-cast variant; the chain auto-uses it when the build meets the
    // fast-snipe ToHit threshold or a ToHit-buff window is active (replayChain).
    const fastPower = power.quickSnipe ? applyQuickSnipe(power, true) : null;
    const fastSnipe = fastPower ? deriveDamage(fastPower) : null;
    // Self-buff (Build Up / Aim / Soul Drain / Follow Up / Power Siphon) and foe
    // debuff (Touch of Fear −ToHit, −Res/−Def attacks) windows. Both ride on
    // damaging attacks too — Soul Drain & Follow Up deal damage AND self-buff —
    // so neither is gated on damage. Self-buff wins if a power does both.
    const buffDur = selfBuffWindow(effectivePower);
    const debuffDur = buffDur > 0 ? 0 : foeDebuffWindow(effectivePower);
    const effectWindow =
      buffDur > 0
        ? { kind: 'buff' as const, duration: buffDur }
        : debuffDur > 0
          ? { kind: 'debuff' as const, duration: debuffDur }
          : undefined;
    const type: ChainPowerType =
      damage > 0 || dot ? 'attack' : buffDur > 0 ? 'buff' : 'utility';

    const endGain = selfEnduranceGain(
      effectivePower,
      // The targets-hit slider is keyed by internalName everywhere (dashboard,
      // active-buffs) — match that so the user's setting actually applies. The
      // UNREDIRECTED name: a mode redirect renames the power, and the slider the
      // user moved is on the tray slot, not on the form's version of it.
      targetsHit[internalName] ?? 0,
      enh.enduranceMod || 0,
      archetypeId ?? '',
      build.level,
    );

    // Alternate cast forms. Energy Transfer's fast cast comes from POWER_FORMS
    // (reuses the base damage, overrides only the animation). Snipes add an
    // In-Combat fast form synthesized from quickSnipe — its own reduced damage
    // and ~1.67s cast — gated on the ToHit fast-snipe rule.
    const forms: ChainForm[] = (POWER_FORMS[internalName] ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      cast: s.castTime != null ? calculateArcanaTime(s.castTime) : cast,
      damage,
      endCost,
      dot,
      trigger: s.trigger,
    }));
    if (fastPower && fastSnipe) {
      forms.push({
        id: 'fast',
        label: 'Fast Snipe',
        kind: 'fast',
        cast: calculateArcanaTime(powerCastTime(fastPower)),
        damage: fastSnipe.damage,
        endCost,
        dot: fastSnipe.dot,
        trigger: { type: 'tohit', threshold: 22 },
      });
    }
    if (isAS) {
      // From-Hide form: the slow interruptible animation (the original base
      // castTime) delivering the guaranteed Assassination hit (mid-combat base ×
      // (1 + fromHideBonus), procs excluded). Legal as the rotation opener or
      // immediately after Placate (replayChain enforces the position).
      const hidden = deriveDamage(power, 1 + (power.fromHideBonus ?? 0));
      forms.push({
        id: 'hidden',
        label: 'From Hide',
        kind: 'slow',
        cast: calculateArcanaTime(powerCastTime(power)),
        damage: hidden.damage,
        endCost,
        dot: hidden.dot,
        trigger: { type: 'hidden' },
      });
    }
    // Caster-form variants as sibling forms on the SAME ChainPower. Gleaming
    // Bolt and Dwarf Gleaming Bolt are one tray slot on one cooldown, so they
    // must not become two ChainPowers — `findSlot` keys its recharge lane on
    // `pi`, and a split would let `Bolt → shift → Bolt` fire twice off one
    // cooldown and report ~2× the true DPS.
    //
    // `modes[0]` is already the base above, so only the rest need a form; and a
    // mode whose redirect changes nothing measurable gets none at all, since the
    // base numbers already answer for it.
    //
    // Two things a ChainForm cannot carry, and so are read from the base variant
    // for every form:
    //  - RECHARGE, which is the point (one power, one cooldown lane). A handful
    //    of redirects do author their own — HC's Glinting Eye 4s → 5s in Nova and
    //    Ebon Eye the same, plus a longer list on Rebirth — so an in-form cast of
    //    one of those is scheduled against the human cooldown. Modelling it would
    //    mean per-form lanes, which is exactly the ~2× DPS bug above;
    //  - the effect WINDOWS (`effectWindow` / `tohitWindow`), same as for the
    //    fast-snipe and from-Hide forms.
    for (const mode of modes.slice(1)) {
      if (mode === null) continue; // human is never a redirect target
      const variant = variants.get(mode)!;
      const vCast = calculateArcanaTime(powerCastTime(variant));
      const vEnd = calcThreeTier('endurance', powerEndCost(variant), enh, globalForCalc).final;
      const v = deriveDamage(variant);
      const same =
        Math.abs(vCast - cast) < 1e-9 &&
        Math.abs(v.damage - damage) < 1e-9 &&
        Math.abs(vEnd - endCost) < 1e-9 &&
        JSON.stringify(v.dot ?? null) === JSON.stringify(dot ?? null);
      if (same) continue;
      forms.push({
        id: `mode:${mode}`,
        // The redirect renames the power (Dwarf Gleaming Bolt); that name is the
        // most useful thing to show on the chip, so prefer it over the mode id.
        label: variant.name !== power.name ? variant.name : mode,
        kind: 'mode',
        cast: vCast,
        damage: v.damage,
        endCost: vEnd,
        dot: v.dot,
        trigger: { type: 'mode', mode },
      });
    }

    const grants = CHARGE_GRANTS[internalName];
    // Window (seconds) during which this power's ToHit buff makes a snipe fast
    // (Build Up / Aim / Soul Drain) — NOT a recharge-only buff like Hasten.
    const tohitWin = toHitBuffWindow(effectivePower);

    return {
      // The UNREDIRECTED internalName, so the id does not move with the caster's
      // form. `pri:Gleaming_Bolt` in human and `pri:Dwarf_Gleaming_Bolt` in
      // Dwarf would be two ids for one power — two entries in a union palette,
      // two saved-chain keys, and two recharge lanes.
      id: `${bucket}:${internalName}`,
      name: power.name,
      type,
      cast,
      baseRecharge,
      // StrengthsDisallowed('RechargeTime'): no recharge strength applies at
      // all (slotted or global) — same fixed-cooldown semantics as Judgement's
      // fixedRecharge. (GlobalStrengthsDisallowed isn't representable in
      // ChainPower's single global-slider model; its only recharge carrier,
      // Kuji-In Rin, is a click armor that never enters an attack chain.)
      rechargeEnh: power.strengthsDisallowed?.includes('RechargeTime') ? 0 : (enh.recharge || 0),
      ...(power.strengthsDisallowed?.includes('RechargeTime') ? { fixedRecharge: true } : {}),
      endCost,
      endGain: endGain || undefined,
      damage,
      dot,
      effectWindow,
      ...(forms.length ? { forms } : {}),
      ...(grants && { grants }),
      ...(tohitWin ? { tohitWindow: tohitWin } : {}),
      // Only a build that can shapeshift carries a gate worth checking; without
      // one every cast is trivially legal and the tag would be dead weight.
      ...(formModes.length ? { castableModes: modes } : {}),
    } satisfies ChainPower;
  });

  // Form switches are chain steps like any other: they animate, they hold a
  // recharge lane, and they move the form later casts resolve against.
  return [...powers, ...buildFormSwitchPowers(build, globalForCalc), ...(judgement ? [judgement] : [])];
}

/**
 * The what-if team-buff stats a chain's numbers actually move with — the sliders the Attack
 * Chain Builder offers, out of the layer's full vocabulary.
 *
 * MEASURED, not chosen: `attack-chain-sensitivity.test.ts` pushes every key the engine's
 * vocabulary offers through this whole pipeline and holds this list to exactly the set that
 * changed a chain number. A stat that stops mattering cannot linger as a control that does
 * nothing, and one the chain grows a dependency on fails the test until it is offered.
 */
export const CHAIN_WHAT_IF_STATS = [
  'damage', 'endurance', 'maxEndurance', 'recharge', 'recovery', 'toHit',
] as const;

/** A per-level table's value at `level`, clamped to the table's ends (index 0 = level 1). */
function atLevel(table: number[], level: number): number {
  return table[Math.min(Math.max(Math.round(level), 1), table.length) - 1];
}

/**
 * A buff ceiling expressed over the class's own base, as the percentage a planner shows
 * (data-gaps-183). The ceiling is an ABSOLUTE attribute value, so it says nothing on its own —
 * `5.0 / 0.25 - 1 = +1900%` is a Blaster's regeneration ceiling, and the same 5.0 over an
 * Arachnos Soldier's 0.30 base is +1567%.
 */
function buffCeilingPercent(capTable: number[], base: number, level: number): number | null {
  if (!capTable?.length || !(base > 0)) return null;
  return (atLevel(capTable, level) / base - 1) * 100;
}

/**
 * Character endurance parameters for the sustainability sim.
 *
 * Both the bar and the rate it refills at come from the archetype's own export (data-gaps-183), not
 * from a literal: the pool is `maxEnduranceTable` plus the build's +MaxEnd, clamped to
 * `maxEnduranceCapTable`, and the recovery percentage is clamped to the class's recovery
 * ceiling. This used to open `100 + maxEndurance` with no clamp on either — a hardcoded pool
 * and a rate a team buff could push arbitrarily past what the game allows.
 *
 * `null` when the build has no archetype to read: there is no bar to drain, and the modal says
 * so rather than draining an invented one.
 */
export function getEnduranceParams(
  globalBonuses: GlobalBonuses,
  stats: ArchetypeStats | null | undefined,
  level: number,
): EnduranceParams | null {
  if (!stats?.maxEnduranceTable?.length || !stats?.maxEnduranceCapTable?.length) return null;
  const maxEnd = Math.min(
    atLevel(stats.maxEnduranceTable, level) + (globalBonuses.maxEndurance || 0),
    atLevel(stats.maxEnduranceCapTable, level),
  );
  const recoveryCeiling = buffCeilingPercent(stats.recoveryCapTable, stats.recoveryBase, level);
  const recovery = recoveryCeiling === null
    ? (globalBonuses.recovery || 0)
    : Math.min(globalBonuses.recovery || 0, recoveryCeiling);
  return {
    maxEnd,
    recoveryPerSec: (maxEnd / 60) * (1 + recovery / 100),
    togglePerSec: globalBonuses.toggleEndCost || 0,
  };
}

/** One chain-side what-if control: where the stat stands now, and where it stops. */
export interface ChainWhatIfRow {
  /** The `GlobalBonuses` field the what-if layer is keyed by. */
  stat: (typeof CHAIN_WHAT_IF_STATS)[number];
  /** The value the chain is computing with, in the layer's units — layer included, ceiling
   *  applied where the chain runs on a clamped figure. */
  current: number;
  /** What the build reaches WITHOUT the layer, measured off the raw accumulator. Deriving it as
   *  `current − simulated` breaks the moment a ceiling binds: a +5000% recovery what-if against
   *  a +400% ceiling would have the surface reading "Build −4600%". */
  fromBuild: number;
  /** The archetype's ceiling for it, or null when the dataset ships none. */
  ceiling: number | null;
}

/**
 * The chain-side what-if controls, each carrying the value the chain is using and the ceiling
 * the archetype's export sets for it.
 *
 * The accessors travel with the stat list for the same reason the rebuild's do: a name on its
 * own would leave a surface to invent a slider range, and the export owns every one of these
 * numbers. A reduction aspect's `ClampStrength` cap is a net-strength multiplier, so the most a
 * global can be worth is `(cap − 1) × 100`.
 */
export function chainWhatIfRows(
  globalBonuses: GlobalBonuses,
  stats: ArchetypeStats | null | undefined,
  level: number,
  layer: Record<string, number> = {},
): ChainWhatIfRow[] {
  const strengthCap = (cap: number | undefined) =>
    typeof cap === 'number' ? (cap - 1) * 100 : null;
  const pool = stats?.maxEnduranceTable?.length && stats?.maxEnduranceCapTable?.length
    ? { base: atLevel(stats.maxEnduranceTable, level), cap: atLevel(stats.maxEnduranceCapTable, level) }
    : null;
  const ceilings: Record<ChainWhatIfRow['stat'], number | null> = {
    damage: strengthCap(stats?.damageCap),
    endurance: strengthCap(stats?.enduranceCap),
    recharge: strengthCap(stats?.rechargeCap),
    maxEndurance: pool ? pool.cap - pool.base : null,
    recovery: stats ? buffCeilingPercent(stats.recoveryCapTable, stats.recoveryBase, level) : null,
    toHit: stats ? buffCeilingPercent(stats.toHitCapTable, stats.toHitBase, level) : null,
  };
  // The RAW accumulator per stat — build plus layer, before any ceiling.
  const accumulated: Record<ChainWhatIfRow['stat'], number> = {
    damage: globalBonuses.damage || 0,
    endurance: globalBonuses.endurance || 0,
    recharge: globalBonuses.recharge || 0,
    maxEndurance: globalBonuses.maxEndurance || 0,
    recovery: globalBonuses.recovery || 0,
    toHit: globalBonuses.toHit || 0,
  };
  return CHAIN_WHAT_IF_STATS.map((stat) => ({
    stat,
    // The clamped figure where the chain runs on one: the endurance sim binds recovery to its
    // ceiling. The snipe rule reads the accumulator's ToHit directly, so that one is raw.
    current: stat === 'recovery' && ceilings.recovery !== null
      ? Math.min(accumulated.recovery, ceilings.recovery)
      : accumulated[stat],
    fromBuild: accumulated[stat] - (layer[stat] ?? 0),
    ceiling: ceilings[stat],
  }));
}

/** The build's global recharge bonus as a percentage (e.g. 70 = +70%). */
export function getBuildGlobalRecharge(globalBonuses: GlobalBonuses): number {
  return globalBonuses.recharge || 0;
}

// ---------------------------------------------------------------------------
// Saved-chain persistence: convert between the runtime pi-sequence (indices
// into ChainPower[]) and the stable id list stored on the build. Storing
// indices would break the moment the build's power set changes; ids
// ("bucket:internalName") are stable, so a saved chain survives reload, export,
// and share — and gracefully drops any power that's no longer picked.
// ---------------------------------------------------------------------------

/** The stable internalName portion of a ChainPower id ("bucket:internalName").
 *  Fallback match key so a saved chain survives pool-slot reshuffles (which can
 *  change the bucket prefix) as long as the power is still in the build. */
function chainIdInternalName(id: string): string {
  const i = id.indexOf(':');
  return i >= 0 ? id.slice(i + 1) : id;
}

/** A working pi-sequence → the stable id list stored in a saved AttackChain. */
export function sequenceToIds(powers: ChainPower[], sequence: number[]): string[] {
  return sequence.map((pi) => powers[pi]?.id).filter((id): id is string => !!id);
}

/** A saved AttackChain's id list → a pi-sequence for the CURRENT build's
 *  powers. Matches each id exactly, then falls back to its internalName; ids
 *  with no surviving power are dropped. */
export function idsToSequence(powers: ChainPower[], ids: string[]): number[] {
  const out: number[] = [];
  for (const id of ids) {
    let pi = powers.findIndex((p) => p.id === id);
    if (pi < 0) {
      const inm = chainIdInternalName(id);
      pi = powers.findIndex((p) => chainIdInternalName(p.id) === inm);
    }
    if (pi >= 0) out.push(pi);
  }
  return out;
}
