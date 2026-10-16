/**
 * Attack Chain Builder modal.
 *
 * Click powers to greedily pack an attack rotation (one animation at a time).
 * The scheduler anchors recharge to cast END — `findSlot` in attack-chain.ts is
 * explicit that a prior cast at [start, end] makes the power ready at
 * `end + effRech` — so this docstring's old claim of "anchored to cast start"
 * was simply wrong about the module it pointed at. The TIMELINE below still
 * draws both cooldown visuals from cast start (`cdW`, `overStart`), which is a
 * real rendering discrepancy of one animation length, tracked separately; it is
 * a drawing bug, not the scheduling rule. Drag a bar on the
 * timeline to reorder the cast sequence; grab empty space to pan. Surfaces
 * cycle time, DPS, dead time, and an endurance gain/spend model with a
 * sustainability sawtooth. All per-power numbers come from the live build via
 * the same calc the power tooltips use (attack-chain-powers.ts).
 *
 * CROSS-FORM ROTATIONS. A Kheldian chain can shapeshift mid-rotation. The
 * palette is a UNION across caster forms, so a power the current form cannot
 * cast is DIMMED rather than absent — you can see what a switch would unlock —
 * and a `→ Form` chip appends the shift as a step like any other pick. Because a
 * union palette cannot prevent an illegal pick, `computeChain` detects one
 * instead and this surface marks it (red ring, ⚠, the reason on hover) while
 * still showing every number: a half-shifted chain is one the user is mid-edit
 * on. The Form control picks where the rotation OPENS, not where it lives.
 *
 * The shift cost is an ASSUMPTION, and the surface says so wherever it shows.
 * By default a switch costs only the blocking segment its animation actually
 * locks you out for, because a chain that attacks straight afterwards cancels
 * the rest by construction; the "Play shift animations in full" checkbox charges
 * the whole shift instead. Cycle and DPS carry a persistent marker while it is
 * on, the clipboard export names whichever assumption produced its numbers, and
 * the Efficiency help says outright that a switch counts as busy but deals no
 * damage. See SHAPESHIFT_BLOCKING_CAST / SHAPESHIFT_FULL_ANIM for provenance.
 */

import { useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import {
  useBuildStore,
  useUIStore,
  useScourgeActive,
  useContainmentActive,
  useCriticalHitsActive,
  useStalkerHidden,
  useStalkerTeamSize,
  useStalkerCritActive,
  useSentinelCritActive,
  useDominationActive,
} from '@/stores';
import { effectiveGlobalAdjusters } from '@/components/info/resolveEffectivePower';
import { useCharacterCalculation } from '@/hooks/useCalculatedStats';
import {
  buildChainPowers,
  buildFormModes,
  getEnduranceParams,
  getBuildGlobalRecharge,
  chainWhatIfRows,
  sequenceToIds,
  idsToSequence,
  SHAPESHIFT_BLOCKING_CAST,
  SHAPESHIFT_FULL_ANIM,
} from '@/utils/calculations/attack-chain-powers';
import { calculateArcanaTime } from '@/utils/calculations';
import { humanise, whatIfControls } from './whatIfControls';
import { useWhatIfActive, WhatIfChip } from './WhatIfChipPanel';
import { modeLabel } from '@/utils/mode-suppression';
import type { AttackChain } from '@/types';
import { getArchetype } from '@/data';
import {
  replayChain,
  computeChain,
  effectiveRecharge,
  type RechargeBounds,
  powerMetricValue,
  powerMetricCeiling,
  nextPickForm,
  nextPickContext,
  activationForm,
  chainDotTickProbability,
  type ChainForm,
  type ChainPower,
  type FormContext,
  type IllegalCast,
  type PowerMetric,
} from '@/utils/calculations/attack-chain';

interface AttackChainModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// A `switch` (Kheldian shapeshift) gets a hue of its own, deliberately far from
// the three power hues AND from every semantic colour on the timeline (the green
// active band, the red dead gaps, the amber DoT ticks, the blue endurance
// track). It has to be unmistakable: a switch deals no damage, so its `rel` is
// always 0 and it draws as the palest bar there is — 0.26s of it by default,
// which is precisely the width a user reads as a gap between two attacks rather
// than as a step that cost them time.
const TYPE_HUE: Record<ChainPower['type'], number> = { attack: 258, utility: 152, buff: 35, switch: 315 };
/** Hard edge on switch bars/chips, for the same reason — a bright ring so the
 *  sliver reads as deliberate. */
const SWITCH_EDGE = 'hsl(315, 85%, 78%)';
/** Outline + marker colour for a cast the caster's live form does not allow. */
const ILLEGAL_EDGE = '#F87171';
const LABEL_W = 116;
const LANE_H = 24;
const MIN_PX = 4; // low enough to fit very long recharges (e.g. 50s+ nukes)
const MAX_PX = 80;

// What-if global-recharge slider. Spans a heavy stacked enemy −recharge debuff
// (Heat Loss alone ≈ −300%) through the +400% recharge-strength buff cap. 0 = the
// build exactly as slotted. Values are % points added to the build's global
// recharge; the per-power ClampStrength bounds (RechargeBounds in attack-chain.ts)
// keeps every result honest no matter how deep the debuff is dialled.
/** The one chain-moving stat with a dedicated control of its own (the labelled track below), so
 *  the compact row list skips it rather than offering the same layer entry twice. */
const RECHARGE_STAT = 'recharge';
const WHATIF_RECH_MIN = -300;
const WHATIF_RECH_MAX = 400;
const WHATIF_RECH_STEP = 5;
// Labelled/clickable ticks along the track (0 is emphasized as the build anchor).
const WHATIF_RECH_TICKS = [-300, -200, -100, 0, 100, 200, 300, 400];
/** Fraction (0–100%) along the slider track for a what-if value. */
const whatIfTrackPct = (v: number) =>
  ((v - WHATIF_RECH_MIN) / (WHATIF_RECH_MAX - WHATIF_RECH_MIN)) * 100;

/** Short label for the power-ranking metric (legend + palette tooltips). See
 *  powerMetricValue in attack-chain.ts. */
const METRIC_LABEL: Record<PowerMetric, string> = { damage: 'dmg', dpa: 'DPA', dps: 'DPS' };

/** Option A coloring: type sets the hue, relative damage sets richness. */
function barFill(type: ChainPower['type'], rel: number): string {
  return `hsl(${TYPE_HUE[type]}, ${30 + rel * 55}%, ${66 - rel * 28}%)`;
}
function cdFill(type: ChainPower['type']): string {
  return `hsl(${TYPE_HUE[type]}, 38%, 24%)`;
}
/** Translucent fill of the bar color — tints palette/rotation chips with the
 *  power's damage color (the visual link to its timeline bar) while keeping the
 *  label readable. */
function chipBg(type: ChainPower['type'], rel: number): string {
  // Stronger saturation + ~45% opacity so chips read as clearly colored (and
  // the damage gradient is visible) while the dark base keeps the label legible.
  return `hsla(${TYPE_HUE[type]}, ${45 + rel * 45}%, ${60 - rel * 26}%, 0.45)`;
}

/** Drop-indicator color for the rotation strip. Deliberately NOT a type hue
 *  (purple/green/amber) so the insert cursor + held-chip ring read as UI, not
 *  a power category. */
const CURSOR_COLOR = '#f1f5f9';

/** Hatched amber band for recharge overshoot — a power that has finished
 *  recharging but hasn't been recast yet because another animation is still
 *  playing ("waiting"). Striped so it reads as idle-ready, distinct
 *  from the solid orange DoT ticks and the dark cooldown bar. */
const READY_FILL =
  'repeating-linear-gradient(45deg, rgba(124,140,162,0.55) 0 4px, rgba(124,140,162,0.18) 4px 8px)';

/** Colors the cooldown/idle stem while a self-buff (azure) or foe-debuff (amber)
 *  is active. The color edge = expiry: keep it touching the next cast for full
 *  uptime with no wasted early recast. Cool = good (buff), warm = debuff. */
const WINDOW_COLOR: Record<'buff' | 'debuff', string> = {
  buff: 'rgba(96, 165, 235, 0.6)',
  debuff: 'rgba(224, 160, 46, 0.6)',
};

function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}

/** A caster form's name for a control or a chip — `null` is human. Straight
 *  through `modeLabel`, the same helper the InfoPanel's "Requires: <mode>"
 *  annotation uses, so a form reads identically everywhere in the app. */
const formLabel = (mode: string | null): string => (mode === null ? 'Human' : modeLabel(mode));
/** The same name inside a sentence that already supplies the word "form"
 *  ("cannot be cast in <X> form"). `modeLabel` hands back display names that
 *  carry it themselves — "Dwarf Form", "Nova Form" — and "in Dwarf Form form" is
 *  not a sentence. */
const formNoun = (mode: string | null): string => formLabel(mode).replace(/\s+Form$/i, '');
/** A switch step's destination, for its chip / lane label. Uses the form
 *  TOGGLE's own name ("Black Dwarf") — the words on the player's tray — in
 *  preference to the mode id's generic label ("Dwarf Form"), and says plain
 *  "Human" for the step that drops the form (whose ChainPower is named "Human
 *  Form"). `buildFormSwitchPowers` always names a switch after its toggle, so
 *  the `formLabel` arm is defensive only. */
const switchTarget = (p: ChainPower): string =>
  p.switchTo == null ? 'Human' : p.name || formLabel(p.switchTo);

/** `IllegalCast.reason` is display-ready except for the RAW mode id it names —
 *  the calc layer deliberately owns no pretty labels. Swap that one id using the
 *  structured `form` field rather than pattern-matching the sentence, so a
 *  reworded reason keeps working. */
const prettyReason = (bad: IllegalCast): string =>
  bad.form ? bad.reason.replace(bad.form, formNoun(bad.form)) : bad.reason;

// The two shapeshift costs, in the units the user sees them in: the raw
// animation seconds the sequencer declares, and the ArcanaTime the chain
// actually charges. Derived from the same constants the model uses — never
// retyped here, or the tooltip and the timeline could disagree.
const SHIFT_BLOCKING_ARCANA = calculateArcanaTime(SHAPESHIFT_BLOCKING_CAST);
const SHIFT_FULL_ARCANA = calculateArcanaTime(SHAPESHIFT_FULL_ANIM);

/**
 * The provenance sentence for the shift cost, shown wherever a switch's price
 * appears. It is not decoration: 2.03s is an INFERRED number and the user is
 * entitled to know it is inferred, and from what.
 *
 * Claims only what the sequencer data supports. An earlier draft said Homecoming
 * had "deliberately left" the zero activation time in place; nothing in the
 * decode speaks to any live team's intent, and a tooltip is not the place to
 * invent one.
 */
const SHIFT_PROVENANCE =
  `Kheldian form toggles declare no activation time, and the sequencer splits the shapeshift ` +
  `move in two: a blocking segment of ${fmt(SHAPESHIFT_BLOCKING_CAST, 3)}s (2 frames at 30fps), ` +
  `then a tail that any attack or movement interrupts. A chain that casts immediately after ` +
  `switching cancels that tail by construction, so by default a switch costs only its ` +
  `${fmt(SHIFT_BLOCKING_ARCANA, 2)}s blocking segment. Turn on "Play shift animations in full" ` +
  `to charge the whole ${fmt(SHAPESHIFT_FULL_ANIM, 2)}s shift instead ` +
  `(${fmt(SHIFT_FULL_ARCANA, 2)}s of ArcanaTime). That ${fmt(SHAPESHIFT_FULL_ANIM, 2)}s is not ` +
  `declared on your power; it is what the game declares on seven sibling powers performing the ` +
  `same shapeshift.`;

export function AttackChainModal({ isOpen, onClose }: AttackChainModalProps) {
  const build = useBuildStore((s) => s.build);

  // The metric that ranks powers everywhere here — palette order, bar/chip
  // color intensity, and compactness weighting (persisted across sessions).
  const powerMetric = useUIStore((s) => s.chainPowerMetric);
  const setPowerMetric = useUIStore((s) => s.setChainPowerMetric);
  const effectWindowsOn = useUIStore((s) => s.chainShowEffectWindows);
  const setEffectWindowsOn = useUIStore((s) => s.setChainShowEffectWindows);
  // Combat Mode is the app-wide "in combat" (kEngaged) toggle. A snipe's quick
  // form fires while in combat OR while the +22% ToHit Marksman buff is active —
  // so Combat Mode drives the kEngaged half here, mirroring the InfoPanel which
  // also swaps in quickSnipe stats when Combat Mode is on. The ToHit half stays
  // in replayChain (permanent ToHit ≥ threshold / Build Up windows).
  const combatMode = useUIStore((s) => s.combatMode);
  const toggleCombatMode = useUIStore((s) => s.toggleCombatMode);
  const showToast = useUIStore((s) => s.showToast);

  // Saved chains live on the build (so they travel with the character).
  const savedChains = build.attackChains ?? [];
  const saveAttackChain = useBuildStore((s) => s.saveAttackChain);
  const updateAttackChain = useBuildStore((s) => s.updateAttackChain);
  const renameAttackChain = useBuildStore((s) => s.renameAttackChain);
  const deleteAttackChain = useBuildStore((s) => s.deleteAttackChain);
  // Which saved chain is loaded into the working sequence (null = unsaved
  // scratch), and the inline name field for new / save-as / rename.
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ mode: 'new' | 'saveas' | 'rename'; value: string } | null>(null);

  // AT hit-time mechanic toggles (crit / scourge / containment / …) — same
  // sources the power tooltips use, so the chain DPS matches them.
  const scourgeActive = useScourgeActive();
  const containmentActive = useContainmentActive();
  const criticalHitsActive = useCriticalHitsActive();
  const stalkerHidden = useStalkerHidden();
  const stalkerTeamSize = useStalkerTeamSize();
  const stalkerCritActive = useStalkerCritActive();
  const sentinelCritActive = useSentinelCritActive();
  // Conditional-effect toggles (Gravity Control's Impact, Bio Armor stances,
  // Domination) — the same maps the InfoPanel resolves a power under, so a bonus
  // the tooltip shows is a bonus the chain's DPS counts.
  const mechanicAdjusters = useUIStore((s) => s.mechanicAdjusters);
  const globalAdjusters = useUIStore((s) => s.globalAdjusters);
  const dominationActive = useDominationActive();
  // Per-power targets-hit slider (drives the endurance gain of Dark Consumption
  // / Consume / Power Sink, scaled per foe — same setting the dashboard uses).
  const targetsHitValues = useUIStore((s) => s.targetsHitValues);

  // Caster form. Kheldian Nova/Dwarf attacks are auto-granted by the form toggle and
  // usable only inside that form, while the human powers are disallowed inside it. The
  // roster used to be rebuilt per form, which confined a chain to the one it was built
  // in; it is now a UNION across forms, so this selects only where the rotation OPENS —
  // `switch` steps move it from there. Empty for every build with no form to enter.
  const formModes = useMemo(() => buildFormModes(build), [build]);
  const [startForm, setStartForm] = useState<string | null>(null);
  // Charge each switch its full uncancelled shapeshift animation instead of the
  // blocking segment. OFF is the default and the default is a claim: a chain that
  // attacks straight after switching animation-cancels the tail, so it never pays it.
  // Part of the saved chain's identity (AttackChain.fullShiftAnimations), not a view
  // setting — the same order under the other assumption is a different rotation.
  const [fullShiftAnimations, setFullShiftAnimations] = useState(false);

  // The dashboard's calculation, not a fresh bare one. Calling
  // `calculateCharacterTotals(build)` here passed NO options, so every global the
  // chain reads — damage, recharge, ToHit, endurance — was computed with the
  // targets-hit sliders empty, no incarnates, no exemplar and every adjuster at
  // its default. Rage was the reported symptom: its stack slider moved the
  // dashboard and not the chain, and "Off" still counted one stack here because
  // an absent slider entry reads as the base 1-stack value. Sharing the hook also
  // means this modal hits the same memo cache as the rest of the app.
  const calc = useCharacterCalculation();

  // The archetype's binary-sourced stats — the ClampStrength bounds the chain divides by, the
  // endurance pool it drains, and every ceiling the what-if sliders below reach to. Read once:
  // nothing in this modal may invent one of these numbers (data-gaps-183).
  const archetypeStats = useMemo(
    () => (build.archetype?.id ? getArchetype(build.archetype.id)?.stats ?? null : null),
    [build.archetype?.id],
  );

  const { powers, endParams, buildGlobalRech, permanentToHit } = useMemo(() => {
    const hasHide = build.secondary.powers.some((p) => p.internalName === 'Hide');
    const mechCtx = {
      archetypeId: build.archetype?.id ?? undefined,
      containmentActive,
      scourgeActive,
      criticalHitsActive,
      stalkerCritActive,
      sentinelCritActive,
      effectiveHidden: stalkerHidden && hasHide,
      stalkerTeamSize,
    };
    return {
      // The roster no longer depends on the caster form — one union across every
      // form, one set of ids, whatever the caster is wearing. Which VARIANT a cast
      // fires is a per-cast question the SCHEDULER answers from the live form, so
      // the form belongs in `formCtx` below and not in this memo (nor its deps).
      powers: buildChainPowers(build, calc.globalBonuses, mechCtx, targetsHitValues, {
        globalAdjusters: effectiveGlobalAdjusters(build, globalAdjusters),
        mechanicAdjusters,
        atInherentState: { dominationActive },
      }),
      endParams: getEnduranceParams(calc.globalBonuses, archetypeStats, build.level),
      buildGlobalRech: getBuildGlobalRecharge(calc.globalBonuses),
      // Always-on ToHit (% points) — drives the fast-snipe rule in replayChain.
      permanentToHit: calc.globalBonuses.toHit,
    };
  }, [build, calc, archetypeStats, containmentActive, scourgeActive, criticalHitsActive, stalkerCritActive, sentinelCritActive, stalkerHidden, stalkerTeamSize, targetsHitValues, mechanicAdjusters, globalAdjusters, dominationActive]);

  const [sequence, setSequence] = useState<number[]>([]);
  // The recharge what-if is ONE ENTRY in the shared team-buff layer, not a number this modal
  // owns: `buildGlobalRech` already carries it (the engine injects the layer into the
  // accumulators before projection, so `calc.globalBonuses.recharge` is already simulated).
  // Keeping a second local copy here would double-count the same adjustment.
  const whatIfBuffs = useUIStore((s) => s.whatIfBuffs);
  const setWhatIfBuff = useUIStore((s) => s.setWhatIfBuff);
  const openWhatIfBuffsModal = useUIStore((s) => s.openWhatIfBuffsModal);
  const extraRech = whatIfBuffs.recharge ?? 0;
  const setExtraRech = (v: number) => setWhatIfBuff('recharge', v);
  // Chip-activation for the OTHER team buffs (recharge keeps its dedicated slider above).
  // The layer is shared, so a buff set in the WhatIfBuffsModal arrives here already active.
  const { activeStats: whatIfActive, toggle: toggleWhatIf } = useWhatIfActive(whatIfBuffs, setWhatIfBuff);
  const [px, setPx] = useState(38);

  // Timeline reorder: dragging a bar moves that cast in the sequence. Bars are
  // monotonic in time == sequence order (the packer casts strictly in order),
  // so a single x-threshold picks the insert gap. Nothing shuffles until drop —
  // the grabbed bar gets a ring and a full-height insert cursor marks the gap.
  const reorderRef = useRef<{ from: number; insertAt: number } | null>(null);
  const [reorder, setReorder] = useState<{ from: number; left: number } | null>(null);

  // Grab-to-pan the timeline (mouse) from empty lane space / labels. Bars
  // intercept pointerdown (stopPropagation) to start a reorder instead, so a
  // pan only begins when you grab the background. Touch keeps native scrolling.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const dragMoved = useRef(false);
  const onTimelinePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const el = scrollRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    dragMoved.current = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 4) dragMoved.current = true;
      if (dragMoved.current) el.scrollLeft = startScroll - dx;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const globalRech = buildGlobalRech;
  // What the build reaches on its own, for the slider's zero-point readout.
  const unsimulatedRech = buildGlobalRech - extraRech;

  // The archetype's own ClampStrength bounds on the recharge divisor, read from the class
  // binary rather than assumed. Without the CAP half the what-if slider could drive a chain
  // past the +400% recharge cap the game enforces (WHAT-IF-BUFFS-PLAN WIF19); without the
  // FLOOR half a deep debuff could take the divisor through zero. A build with no archetype
  // yet has no bounds to read, and the modal cannot schedule without them.
  const rechargeBounds = useMemo<RechargeBounds | null>(
    () => (archetypeStats ? { floor: archetypeStats.rechargeFloor, cap: archetypeStats.rechargeCap } : null),
    [archetypeStats],
  );

  // The OTHER team buffs a chain's numbers move with — damage, endurance discount, the
  // endurance pool, recovery and always-on ToHit (recharge keeps its own richer control above).
  // Which stats these are is measured, not chosen here: `attack-chain-sensitivity.test.ts`
  // pushes every key the layer offers through this whole pipeline and holds
  // `CHAIN_WHAT_IF_STATS` to exactly the set that moved a number.
  const otherWhatIf = useMemo(() => {
    const rows = chainWhatIfRows(calc.globalBonuses, archetypeStats, build.level, whatIfBuffs)
      .filter((row) => row.stat !== RECHARGE_STAT);
    const labels = new Map(whatIfControls(rows.map((row) => row.stat)).map((c) => [c.stat, c]));
    return rows.map((row) => ({ ...row, control: labels.get(row.stat) }));
  }, [calc.globalBonuses, archetypeStats, build.level, whatIfBuffs]);

  // How many distinct chain powers are pinned at the game's 4× recharge floor
  // (net strength at the archetype's own StrengthMin, i.e. the divisor is at the floor)
  // under the current what-if. Once a power is floored, more −recharge can't slow
  // it further — surfacing it keeps a correct cap from reading as a stuck slider
  // (the "why did it stop at −75%?" gotcha on a low-recharge build).
  const rechargeFloor = useMemo(() => {
    const seen = new Set<number>();
    let total = 0;
    let floored = 0;
    for (const pi of sequence) {
      if (seen.has(pi)) continue;
      seen.add(pi);
      const p = powers[pi];
      if (!p || p.baseRecharge <= 0) continue;
      total += 1;
      if (extraRech < 0 && rechargeBounds != null
          && 1 + p.rechargeEnh + globalRech / 100 <= rechargeBounds.floor + 1e-9) {
        floored += 1;
      }
    }
    return { total, floored, all: total > 0 && floored === total };
  }, [sequence, powers, globalRech, extraRech, rechargeBounds]);

  // The ONE form context. `replayChain`, `nextPickForm` and `computeChain` must all
  // be handed the same one: the scheduler resolves each cast's form from it, the
  // palette previews the next pick through it, and the legality walk replays the
  // caster form over it. Hand two of them different objects and a chip advertises
  // one form's variant while the timeline schedules another's.
  const formCtx = useMemo<FormContext>(
    () => ({ permanentToHit, forceFastSnipe: combatMode, startForm, fullShiftAnimations }),
    [permanentToHit, combatMode, startForm, fullShiftAnimations],
  );

  const activations = useMemo(
    () => (rechargeBounds ? replayChain(powers, sequence, globalRech, rechargeBounds, formCtx) : []),
    [powers, sequence, globalRech, rechargeBounds, formCtx],
  );

  // The form a palette tap of `pi` would fire in — resolved through the same
  // predicate the scheduler uses, against the charge ledger the sequence has
  // banked, the power that would precede the pick, and the slot the pick would
  // land in. So a chip advertises the cast a tap actually schedules instead of
  // the power's flat fields, which for every form-bearing power are permanently
  // the form the chain will NOT fire.
  const paletteForm = (pi: number): ChainForm | undefined =>
    rechargeBounds
      ? nextPickForm(powers, sequence, activations, pi, globalRech, rechargeBounds, formCtx)
      : undefined;

  // The caster form a tap RIGHT NOW would happen in — the same walk replayChain
  // makes, so the palette's "can I cast this" answer and the timeline's legality
  // verdict cannot disagree. Drives the dimming below: an out-of-form power stays
  // on the palette (dimmed) rather than vanishing, so a user can see what a switch
  // would unlock instead of guessing at an absence.
  const nextForm = useMemo(
    () => nextPickContext(powers, sequence, activations, formCtx).currentForm ?? null,
    [powers, sequence, activations, formCtx],
  );
  /** Whether `p` can be cast in the form the NEXT pick lands in. Untagged powers
   *  (every power on a build that cannot shapeshift) are always castable. */
  const castableNext = (p: ChainPower): boolean =>
    !p.castableModes || p.castableModes.includes(nextForm);

  // A power's value under the chosen metric, measured on the form given (omit
  // for the base form). Closes over the live global recharge so DPS tracks the
  // what-if slider.
  const metricVal = (p: ChainPower, form?: ChainForm) =>
    rechargeBounds ? powerMetricValue(p, powerMetric, globalRech, rechargeBounds, form) : 0;

  // Snipe surfacing: if the chain holds a snipe (a power with a ToHit-gated fast
  // form), expose its threshold so we can guide the user to the controls that
  // make it cast quick — Combat Mode (in-combat) or enough always-on ToHit.
  const fastSnipe = useMemo(() => {
    for (const p of powers) {
      const f = p.forms?.find((x) => x.kind === 'fast' && x.trigger.type === 'tohit');
      if (f && f.trigger.type === 'tohit') return { threshold: f.trigger.threshold };
    }
    return null;
  }, [powers]);
  const toHitMeetsThreshold = fastSnipe != null && permanentToHit >= fastSnipe.threshold;
  const result = useMemo(
    () =>
      rechargeBounds
        ? computeChain(powers, activations, globalRech, rechargeBounds, endParams, powerMetric, formCtx)
        : null,
    [powers, activations, globalRech, rechargeBounds, endParams, powerMetric, formCtx],
  );

  // Casts the live caster form does not allow, keyed by pick index so a bar and a
  // rotation-order step can both find their own. Shown, never hidden: the numbers
  // above still count these casts because a partially-illegal chain is one the user
  // is mid-edit on, so the surface's job is to mark them, not to quietly drop them.
  const illegalBySeq = useMemo(() => {
    const m = new Map<number, IllegalCast>();
    for (const bad of result?.illegal ?? []) m.set(bad.seq, bad);
    return m;
  }, [result]);

  // Does this rotation actually shapeshift? Gates every honesty marker below — a
  // build with a form but a single-form chain pays no shift cost, and a note about
  // an assumption that changes nothing is noise.
  const chainHasSwitch = useMemo(
    () => sequence.some((pi) => powers[pi]?.type === 'switch'),
    [sequence, powers],
  );

  // When the build's power set changes underneath us (power ids shift), re-map
  // the loaded saved chain to the new powers (dropping any now-missing power);
  // if nothing is loaded, clear the scratch sequence. Keyed by power ids so a
  // mere re-slot (which doesn't change ids) leaves the working chain alone.
  //
  // Picking a different caster form no longer lands here: the roster is a union
  // across forms, so `powers` (and this key) are identical whichever form the
  // chain opens in. `loadChain` maps against it directly for the same reason.
  const powersKey = powers.map((p) => p.id).join('|');
  const [lastKey, setLastKey] = useState(powersKey);
  if (powersKey !== lastKey) {
    setLastKey(powersKey);
    const chain = selectedChainId ? savedChains.find((c) => c.id === selectedChainId) : null;
    setSequence(chain ? idsToSequence(powers, chain.powers) : []);
  }

  const addPower = (pi: number) => setSequence((s) => [...s, pi]);
  const removeBar = (seq: number) => setSequence((s) => s.filter((_, i) => i !== seq));
  const clear = () => setSequence([]);

  // Copy the settled rotation order as plain text (for sharing / notes).
  //
  // A cross-form rotation carries its shift assumption out with it. Note which way
  // round: the DEFAULT is the animation-cancelled reading, so the DEFAULT export is
  // the one that needs the note — its cycle and DPS assume the player cancels every
  // shift by attacking out of it, which is execution the text alone does not
  // convey. A bare "3.4s → 210 DPS" pasted into Discord is exactly how an
  // execution-dependent figure escapes as a universal one.
  const copySequence = () => {
    const steps = sequence
      .map((pi) => {
        const p = powers[pi];
        if (!p) return null;
        // A switch is a step, not a separator — bracket it so the arrow chain
        // still reads as a cast order in plain text.
        return p.type === 'switch' ? `[shift: ${switchTarget(p)}]` : p.name;
      })
      .filter(Boolean);
    if (steps.length === 0) return;
    const lines: string[] = [];
    if (startForm !== null) lines.push(`Opens in ${formLabel(startForm)}.`);
    lines.push(steps.join(' → '));
    if (chainHasSwitch) {
      lines.push(
        fullShiftAnimations
          ? `(Form switches charged at the full ${fmt(SHAPESHIFT_FULL_ANIM, 2)}s shift animation.)`
          : `(Form switches charged at the ${fmt(SHIFT_BLOCKING_ARCANA, 2)}s blocking segment only —`
            + ` these numbers assume you animation-cancel every shift by attacking straight out of it.)`,
      );
    }
    const text = lines.join('\n');
    const clip = navigator.clipboard;
    if (!clip) {
      showToast({ message: 'Clipboard unavailable', tone: 'warning' });
      return;
    }
    clip.writeText(text).then(
      () => showToast({ message: 'Rotation order copied to clipboard', tone: 'success' }),
      () => showToast({ message: 'Could not copy rotation order', tone: 'warning' }),
    );
  };
  const reorderSeq = (from: number, to: number) =>
    setSequence((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.length || to >= s.length) return s;
      const a = [...s];
      const [moved] = a.splice(from, 1);
      a.splice(to, 0, moved);
      return a;
    });

  // --- Saved-chain wiring ---------------------------------------------------
  // The working sequence as stable ids, and whether it diverges from the loaded
  // saved chain (drives the "unsaved" dot + what Save does).
  const currentIds = sequenceToIds(powers, sequence);
  const selectedChain = selectedChainId ? savedChains.find((c) => c.id === selectedChainId) ?? null : null;
  const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  // Both modelling assumptions count as part of the chain, exactly as the cast
  // order does. The same ids opened in a different form fire different variants
  // and flag different casts; the same ids under the other shift assumption are a
  // slower rotation with a lower DPS. Either one silently reading as "no changes"
  // is how one press of Save overwrites a rotation with numbers its author never
  // chose — so both mark the chain unsaved.
  const modified = selectedChain
    ? !sameIds(currentIds, selectedChain.powers)
      || startForm !== (selectedChain.startForm ?? null)
      || fullShiftAnimations !== (selectedChain.fullShiftAnimations ?? false)
    : sequence.length > 0;

  const loadChain = (c: AttackChain) => {
    setSelectedChainId(c.id);
    setNaming(null);
    // Restore the assumptions the chain's numbers were settled under, BEFORE its
    // order: opening form and shift cost both feed `formCtx`, and a rotation
    // replayed under the wrong one is a different rotation.
    setStartForm(c.startForm ?? null);
    setFullShiftAnimations(c.fullShiftAnimations ?? false);
    // The roster is a union across forms and does not depend on either setting, so
    // mapping against the current `powers` is correct here and needs no second
    // pass. (It used to be rebuilt per form, which is why this had to lean on the
    // powersKey block below to re-map after the roster caught up.)
    setSequence(idsToSequence(powers, c.powers));
  };
  const newChain = () => {
    setSequence([]);
    setSelectedChainId(null);
    setNaming(null);
  };
  const onSaveClick = () => {
    if (sequence.length === 0) return;
    if (selectedChain) {
      updateAttackChain(selectedChain.id, currentIds, startForm, fullShiftAnimations);
      showToast({ message: `Saved "${selectedChain.name}"`, tone: 'success' });
    } else {
      setNaming({ mode: 'new', value: '' });
    }
  };
  const startNaming = (mode: 'saveas' | 'rename') =>
    setNaming({ mode, value: mode === 'rename' ? selectedChain?.name ?? '' : '' });
  const confirmNaming = () => {
    if (!naming) return;
    const name = naming.value.trim();
    if (!name) return;
    if (naming.mode === 'rename') {
      if (selectedChain) renameAttackChain(selectedChain.id, name);
    } else {
      const id = saveAttackChain(name, currentIds, startForm, fullShiftAnimations);
      setSelectedChainId(id);
      showToast({ message: `Saved "${name}"`, tone: 'success' });
    }
    setNaming(null);
  };
  const onDelete = () => {
    if (!selectedChain) return;
    const nm = selectedChain.name;
    deleteAttackChain(selectedChain.id);
    setSelectedChainId(null);
    setSequence([]);
    showToast({ message: `Deleted "${nm}"`, tone: 'info' });
  };

  // Grab a bar to reorder its cast. Hit-tests pointer-x against every bar's
  // centre (sorted by screen position == sequence order) to find the insert gap
  // 0..N, and parks a full-height insert cursor at that gap's leading edge. On
  // release we map the gap to a target index (accounting for removing the
  // source) and commit — replayChain then re-packs the timeline once.
  const startBarDrag = (e: React.PointerEvent, from: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); // don't let the timeline pan handler fire
    e.preventDefault();
    reorderRef.current = { from, insertAt: from };

    const update = (clientX: number) => {
      const cont = lanesRef.current;
      const st = reorderRef.current;
      if (!cont || !st) return;
      const bars = (Array.from(cont.querySelectorAll('[data-bar]')) as HTMLElement[])
        .map((el) => ({ seq: Number(el.dataset.seq), rect: el.getBoundingClientRect() }))
        .sort((a, b) => a.rect.left - b.rect.left);
      if (bars.length === 0) return;
      let insertAt = 0;
      for (const b of bars) if (clientX > b.rect.left + b.rect.width / 2) insertAt++;
      const atEnd = insertAt >= bars.length;
      const edge = atEnd ? bars[bars.length - 1].rect.right : bars[insertAt].rect.left;
      st.insertAt = insertAt;
      setReorder({ from: st.from, left: edge - cont.getBoundingClientRect().left });
    };

    update(e.clientX);
    const move = (ev: PointerEvent) => update(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const st = reorderRef.current;
      reorderRef.current = null;
      setReorder(null);
      if (st) {
        const to = st.insertAt > st.from ? st.insertAt - 1 : st.insertAt;
        reorderSeq(st.from, to);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Sort palette: attacks first, then everything else (buff/utility) by metric.
  // Rank attacks ahead of non-attacks, then order by the chosen metric — a total
  // order (the old `attack ? -1 : 1` form was non-antisymmetric once a third
  // 'buff' type existed, giving buff-vs-utility an arbitrary order).
  //
  // The metric is measured on each power's RESOLVED form, so the order tracks
  // the chips' own numbers. attack-chain.ts documents the metric as "STABLE
  // per-power" and this narrows that: stable against how many times a power is
  // cast this rotation (which is what the note is about), NOT against which form
  // it fires in. Ranking a quick snipe by the slow charged cast's damage is
  // ranking it by a number the chip no longer shows and the chain never deals —
  // the exact mis-advice this whole change is about. So order, printed value and
  // tint all move together; the form label in the tooltip says why.
  //
  // Switches sort into a band of their own at the end. They carry no metric at
  // all (zero damage, so every metric is 0) and would otherwise scatter through
  // the buff/utility tail in whatever order the roster happened to build them;
  // as a fixed trailing group they are where a cross-form user can always find
  // them. Deliberately NOT sorted by castability — a dimmed chip that jumps
  // position every time you add a step is worse than one that sits still.
  const palette = useMemo(() => {
    const rank = (p: ChainPower) => (p.type === 'attack' ? 0 : p.type === 'switch' ? 2 : 1);
    return powers
      .map((p, i) => ({ p, i, form: paletteForm(i) }))
      .sort((a, b) => {
        if (rank(a.p) !== rank(b.p)) return rank(a.p) - rank(b.p);
        return metricVal(b.p, b.form) - metricVal(a.p, a.form);
      });
  }, [powers, powerMetric, globalRech, rechargeBounds, sequence, activations, formCtx]);

  const usedPis = useMemo(() => [...new Set(activations.map((a) => a.pi))], [activations]);
  // Metric-intensity reference over the WHOLE build (not just the chain) so a
  // power's color is stable and identical across the palette and timeline — the
  // visual link between the two areas.
  //
  // Deliberately each power's CEILING across all its forms, not its currently-
  // displayed value: that keeps the top of the colour ramp fixed when Combat
  // Mode or a charge flips a power's form, so only the chips whose form actually
  // changed re-tint instead of the whole palette re-shading around a moved
  // denominator. It also guarantees every form's `rel` lands in [0,1] — a
  // from-Hide Assassin's Strike is ~3.17× its own base and would otherwise drive
  // barFill's lightness negative. Needs neither permanentToHit nor combatMode as
  // a dep: spanning every form is exactly what makes it independent of them.
  const maxMetric = useMemo(
    () =>
      Math.max(
        0,
        ...powers.map((p) =>
          rechargeBounds ? powerMetricCeiling(p, powerMetric, globalRech, rechargeBounds) : 0,
        ),
      ),
    [powers, powerMetric, globalRech, rechargeBounds],
  );

  const cycleSec = result?.cycleSec ?? 0;
  const maxCdEnd = activations.length
    ? Math.max(
        ...activations.map(
          (a) => a.start + (rechargeBounds ? effectiveRecharge(powers[a.pi], globalRech, rechargeBounds) : 0),
        ),
      )
    : 0;
  const displaySec = Math.max(cycleSec, maxCdEnd);
  const displayW = displaySec * px;
  const end = result?.endurance ?? null;
  // Instant endurance restored by click recovery powers (Dark Consumption etc.)
  // — a lump (refills on cast, not over time). Sum across the distinct recovery
  // powers in the chain, capped at the bar.
  // Without an archetype there is no bar to cap the lump against, so it stays uncapped rather
  // than being clamped to an invented one — the same reason `endParams` is nullable.
  const clickRestore = usedPis.reduce((s, pi) => s + (powers[pi].endGain ?? 0), 0);
  const instantRestore = endParams ? Math.min(endParams.maxEnd, clickRestore) : clickRestore;
  // Continuous net shown as "Net end" = Recovery − Spend, so the three /s stats
  // reconcile. Click recovery is a lump (instantRestore) and feeds Sustain
  // instead — folding its averaged rate into Net end here would make the visible
  // Recovery/Spend/Net numbers fail to add up.
  const passiveNet = end ? end.recoveryPerSec - end.togglePerSec - end.attackPerSec : 0;

  // Cycle and the DPS derived from it carry a PERSISTENT marker rather than a
  // toast, plus a leading clause on their help text. A figure that only holds
  // under an execution assumption has to say so at the moment it is read, not
  // once when the box was ticked.
  //
  // WHICH numbers the assumption moves depends on the rotation, so the pill goes
  // on every tile it COULD move rather than on the packed-bound answer alone.
  // Two regimes, both real:
  //   packed-bound (past ~+250% global recharge on the motivating Warshade
  //     rotation): the cycle itself pays — 8.71s → 12.67s, 57.19 → 39.32 DPS.
  //   recharge-bound (ordinary slotting, the COMMON case): the extra animation
  //     is absorbed by dead time the loop already had. Cycle, Total dmg and DPS
  //     come out bit-for-bit identical (22.24s / 22.40 DPS either way) and
  //     Efficiency moves instead, 39% → 57%.
  // Marking only Cycle and DPS therefore put the pill on two numbers the box had
  // not changed while the one it had changed wore none. Efficiency now carries it
  // too. See the two-regime gate in attack-chain-cross-form.test.ts.
  //
  // And the pill rides BOTH states, because the default is an assumption too —
  // "you cancel every shift" is a claim about execution exactly as much as "you
  // never do". A number that only holds under an assumption says so at the
  // moment it is read; silence is what a plain, unconditional number looks like.
  const shiftMarker = !chainHasSwitch ? undefined : fullShiftAnimations ? 'full shift' : 'cancelled';

  // Casts the live form does not allow stay IN the totals — computeChain reports
  // a chain the user is mid-edit on rather than silently dropping steps — so the
  // headline reads higher than the rotation can deliver. On the motivating
  // Warshade rotation with the shift deleted, the two orphaned Dwarf attacks are
  // 37.5% of Total dmg and push DPS to 1.60x its legal reading (22.40 vs 13.99).
  // The per-bar rings and the timeline legend already flag them, but both sit
  // rows away from the stat grid, so the number a user actually quotes carried
  // nothing. This puts it on the tiles the illegal casts inflate.
  const illegalMarker =
    illegalBySeq.size > 0
      ? `${illegalBySeq.size} wrong form`
      : undefined;
  const illegalHelpClause =
    illegalBySeq.size === 0
      ? ''
      : `⚠ ${illegalBySeq.size} step${illegalBySeq.size === 1 ? '' : 's'} can't be cast in the form live at that point in the rotation, and ${illegalBySeq.size === 1 ? 'it is' : 'they are'} still counted here — so this number is higher than the rotation can actually deliver. Add the form switch ${illegalBySeq.size === 1 ? 'it needs' : 'they need'}, or remove ${illegalBySeq.size === 1 ? 'it' : 'them'}. `;
  const shiftHelpClause = !chainHasSwitch
    ? ''
    : fullShiftAnimations
      ? `Assumes you play each form switch's animation in FULL (${fmt(SHIFT_FULL_ARCANA, 2)}s per shift) rather than cancelling it. `
      : `Assumes you animation-cancel each form switch by attacking straight out of it, so a shift costs only its ${fmt(SHIFT_BLOCKING_ARCANA, 2)}s blocking segment. `;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Attack Chain Builder" size="full">
      <div className="space-y-3 text-[13px] text-gray-300 p-0.5">
        {/* Saved chains — named rotations stored on the character */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Chains</span>
          <div className="flex flex-wrap items-center gap-1">
            {savedChains.map((c) => {
              const active = c.id === selectedChainId;
              return (
                <button
                  key={c.id}
                  onClick={() => loadChain(c)}
                  className={`h-7 px-2.5 rounded border text-xs ${
                    active
                      ? 'border-emerald-500 text-gray-100 bg-emerald-900/20'
                      : 'border-gray-700 text-gray-300 hover:border-gray-500'
                  }`}
                  title={active && modified ? `${c.name} — unsaved changes` : c.name}
                >
                  {c.name}
                  {active && modified && <span className="text-amber-400" aria-label="unsaved"> •</span>}
                </button>
              );
            })}
            <button
              onClick={newChain}
              className={`h-7 px-2.5 rounded border border-dashed text-xs ${
                selectedChainId === null
                  ? 'border-emerald-600 text-gray-200'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
              title="Start a new, unsaved chain"
            >
              + New
            </button>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {naming ? (
              <>
                <input
                  autoFocus
                  value={naming.value}
                  onChange={(e) => setNaming((n) => (n ? { ...n, value: e.target.value } : n))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmNaming();
                    if (e.key === 'Escape') setNaming(null);
                  }}
                  placeholder={naming.mode === 'rename' ? 'New name' : 'Chain name'}
                  className="h-7 w-40 px-2 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs"
                />
                <button
                  onClick={confirmNaming}
                  disabled={!naming.value.trim()}
                  className="h-7 px-2.5 rounded border border-emerald-600 text-emerald-300 text-xs hover:border-emerald-400 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => setNaming(null)}
                  className="h-7 px-2 rounded border border-gray-700 text-gray-400 text-xs hover:border-gray-500"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onSaveClick}
                  disabled={sequence.length === 0 || (!!selectedChain && !modified)}
                  className="h-7 px-2.5 rounded border border-gray-700 text-gray-300 text-xs hover:border-gray-500 disabled:opacity-40"
                  title={selectedChain ? 'Save changes to this chain' : 'Save the current rotation as a new chain'}
                >
                  {selectedChain ? 'Save' : 'Save as…'}
                </button>
                {selectedChain && (
                  <>
                    <button
                      onClick={() => startNaming('saveas')}
                      disabled={sequence.length === 0}
                      className="h-7 px-2.5 rounded border border-gray-700 text-gray-300 text-xs hover:border-gray-500 disabled:opacity-40"
                      title="Save the current rotation as a new chain"
                    >
                      Save as…
                    </button>
                    <button
                      onClick={() => startNaming('rename')}
                      className="h-7 px-2.5 rounded border border-gray-700 text-gray-300 text-xs hover:border-gray-500"
                    >
                      Rename
                    </button>
                    <button
                      onClick={onDelete}
                      className="h-7 px-2.5 rounded border border-gray-700 text-red-400/80 text-xs hover:border-red-500/60 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Starting form — only for builds that have a form to enter. This no longer
              * confines the chain: the palette is a union across forms and a `→ Form`
              * switch chip moves the caster mid-rotation. What it picks is where the
              * rotation OPENS, which decides which variant each cast fires and which
              * casts are flagged as uncastable. */}
            {formModes.length > 0 && (
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label="Starting caster form"
                title="The form the rotation opens in. Add a “→ Form” step from the palette to switch mid-chain."
              >
                <span className="text-[11px] text-gray-500 mr-0.5">Opens in</span>
                {[null, ...formModes].map((mode) => {
                  const isActive = startForm === mode;
                  return (
                    <button
                      key={mode ?? 'human'}
                      type="button"
                      onClick={() => setStartForm(mode)}
                      aria-pressed={isActive}
                      className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                        isActive
                          ? 'bg-[var(--color-selected)]/40 border-[var(--color-selected)] text-[var(--color-link)]'
                          : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {formLabel(mode)}
                    </button>
                  );
                })}
              </div>
            )}
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={effectWindowsOn}
                onChange={(e) => setEffectWindowsOn(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-amber-500"
              />
              Buff/debuff windows
            </label>
            {fastSnipe && (
              <label
                className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none"
                title={
                  toHitMeetsThreshold
                    ? `Your always-on ToHit (${permanentToHit.toFixed(1)}%) already clears the +${fastSnipe.threshold}% fast-snipe threshold, so snipes cast quick regardless of Combat Mode.`
                    : `Snipes cast quick while in combat (kEngaged) or with +${fastSnipe.threshold}% ToHit. Turn on Combat Mode to use the quick form; otherwise the slow charged cast is shown. Your always-on ToHit is ${permanentToHit.toFixed(1)}%.`
                }
              >
                <input
                  type="checkbox"
                  checked={combatMode || toHitMeetsThreshold}
                  disabled={toHitMeetsThreshold}
                  onChange={toggleCombatMode}
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-amber-500 disabled:opacity-50"
                />
                Combat Mode (quick snipe)
              </label>
            )}
            {/* The shift-cost assumption. Same shape and weight as Combat Mode beside
              * it: both are "how do you actually play this", not view settings, and
              * both change the numbers. Default OFF — the blocking segment only. */}
            {formModes.length > 0 && (
              <label
                className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none"
                title={SHIFT_PROVENANCE}
              >
                <input
                  type="checkbox"
                  checked={fullShiftAnimations}
                  onChange={(e) => setFullShiftAnimations(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-amber-500"
                />
                Play shift animations in full
              </label>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-gray-500 mr-1">Zoom</span>
            <button
              onClick={() => setPx((v) => Math.max(MIN_PX, Math.round(v / 1.3)))}
              className="w-7 h-7 rounded border border-gray-700 hover:border-gray-500 text-gray-400"
            >
              −
            </button>
            <button
              onClick={() => setPx((v) => Math.min(MAX_PX, Math.round(v * 1.3)))}
              className="w-7 h-7 rounded border border-gray-700 hover:border-gray-500 text-gray-400"
            >
              +
            </button>
            <button
              onClick={() => {
                // Fit the whole loop (incl. a long recharge) into the visible
                // width in one click — sizes px so displaySec spans the track.
                const el = scrollRef.current;
                if (!el || displaySec <= 0) return;
                const avail = el.clientWidth - LABEL_W - 8;
                if (avail > 0) setPx(Math.max(MIN_PX, Math.min(MAX_PX, avail / displaySec)));
              }}
              className="ml-1 h-7 px-2.5 rounded border border-gray-700 hover:border-gray-500 text-gray-400 text-xs"
              title="Fit the whole cycle (including recharge) to the window"
            >
              Fit
            </button>
            <button
              onClick={clear}
              className="ml-1 h-7 px-2.5 rounded border border-gray-700 hover:border-gray-500 text-gray-400 text-xs"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Simulates recharge buffs and debuffs. Drag to simulate a global recharge buff (right) or an enemy −recharge debuff (left) and watch the rotation's cycle/DPS respond live. Check how much −recharge your build can eat before the chain degrades. */}
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                +/- Recharge Simulation
              </span>
              <span className="text-[11px] text-gray-600">
                Build <span className="text-emerald-400 font-medium">+{fmt(unsimulatedRech, 0)}%</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] tabular-nums">
                {extraRech === 0 ? (
                  <span className="text-gray-500">No adjustment</span>
                ) : extraRech > 0 ? (
                  <span className="text-emerald-400">
                    +{fmt(extraRech, 0)}% simulated → <span className="font-medium">+{fmt(globalRech, 0)}%</span> global
                  </span>
                ) : (
                  <span className="text-amber-400">
                    −{fmt(-extraRech, 0)}% simulated debuff → <span className="font-medium">{globalRech >= 0 ? '+' : ''}{fmt(globalRech, 0)}%</span> global
                  </span>
                )}
              </span>
              {extraRech !== 0 && (
                <button
                  onClick={() => setExtraRech(0)}
                  className="h-5 px-1.5 rounded border border-gray-700 text-gray-400 text-[10px] hover:border-gray-500"
                  title="Reset the what-if recharge to your build's value"
                >
                  Reset
                </button>
              )}
              <button
                onClick={openWhatIfBuffsModal}
                className="h-5 px-1.5 rounded border border-gray-700 text-gray-400 text-[10px] hover:border-gray-500"
                title="Every other stat a teammate can buff — the same layer this slider writes to"
              >
                All team buffs…
              </button>
            </div>
          </div>

          {/* Track: amber (debuff) ← 0 → emerald (buff), with a range input over it. */}
          <div className="relative h-5">
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full"
              style={{
                background: `linear-gradient(90deg, rgba(224,160,46,0.55) 0%, rgba(224,160,46,0.18) ${whatIfTrackPct(0).toFixed(1)}%, rgba(52,211,153,0.18) ${whatIfTrackPct(0).toFixed(1)}%, rgba(52,211,153,0.55) 100%)`,
              }}
            />
            {WHATIF_RECH_TICKS.map((t) => (
              <div
                key={t}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ${
                  t === 0 ? 'w-0.5 h-4 bg-gray-300' : 'w-px h-2.5 bg-gray-600'
                }`}
                style={{ left: `${whatIfTrackPct(t)}%` }}
              />
            ))}
            <input
              type="range"
              min={WHATIF_RECH_MIN}
              max={WHATIF_RECH_MAX}
              step={WHATIF_RECH_STEP}
              value={extraRech}
              onChange={(e) =>
                setExtraRech(
                  Math.max(WHATIF_RECH_MIN, Math.min(WHATIF_RECH_MAX, Number(e.target.value) || 0)),
                )
              }
              aria-label="What-if global recharge (negative simulates an enemy recharge debuff)"
              className="absolute inset-0 w-full h-5 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-gray-400 [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-gray-400 [&::-moz-range-thumb]:cursor-pointer"
            />
          </div>

          {/* Tick labels — click to jump to a preset debuff/buff amount. */}
          <div className="relative h-4 mt-1">
            {WHATIF_RECH_TICKS.map((t) => (
              <button
                key={t}
                onClick={() => setExtraRech(t)}
                className={`absolute -translate-x-1/2 text-[9px] tabular-nums hover:text-gray-200 ${
                  t === 0
                    ? 'text-gray-300 font-medium'
                    : t < 0
                      ? 'text-amber-500/70'
                      : 'text-emerald-500/70'
                }`}
                style={{ left: `${whatIfTrackPct(t)}%` }}
                title={`Set what-if recharge to ${t > 0 ? '+' : ''}${t}%`}
              >
                {t > 0 ? '+' : ''}
                {t}
              </button>
            ))}
          </div>
          <div className="flex justify-between items-center mt-0.5 gap-2">
            <span className="text-[9px] text-amber-500/60 whitespace-nowrap">◄ enemy −recharge</span>
            <span className="text-[9px] text-gray-600 text-center">
              −recharge floors at 4× base (−75%) — a power never fully stops
            </span>
            <span className="text-[9px] text-emerald-500/60 whitespace-nowrap">recharge buff ►</span>
          </div>

          {/* At-the-floor notice: a correct 4× cap otherwise reads as a stuck
              slider, so say so plainly. */}
          {rechargeFloor.floored > 0 && (
            <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-300">
              {rechargeFloor.all
                ? 'Ooof. You’ve hit the −recharge floor. Every power in the chain is capped at 4× its base recharge (the game’s −75% net-strength limit), Add global recharge or slot recharge for more punishment.'
                : `You’re at your −recharge floor on ${rechargeFloor.floored} of ${rechargeFloor.total} chain powers. They are capped at 4× base recharge and won’t slow further; the rest still have recharge headroom before they cap.`}
            </div>
          )}

          {/* The rest of the chain-moving team buffs. Each slider spans the archetype's OWN
              exported ceiling for that stat, mirrored to the debuff side — the game caps the
              buff half, and a hand-set range would be a guess about a number the export owns. */}
          <div className="mt-3 border-t border-gray-800 pt-2 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Other team buffs this chain responds to
              <span className="ml-1 font-normal normal-case tracking-normal text-gray-600">
                — tap a chip to add its slider
              </span>
            </div>
            {/* One chip per chain-moving stat; only an activated chip takes up a slider row. */}
            <div className="flex flex-wrap gap-1">
              {otherWhatIf.map((row) => (
                <WhatIfChip
                  key={row.stat}
                  control={row.control ?? { stat: row.stat, label: humanise(row.stat), category: 'offense', color: 'text-gray-300', unit: '' }}
                  active={whatIfActive.has(row.stat)}
                  value={whatIfBuffs[row.stat] ?? 0}
                  onToggle={() => toggleWhatIf(row.stat)}
                />
              ))}
            </div>
            {otherWhatIf.filter((row) => whatIfActive.has(row.stat)).map((row) => {
              const simulated = whatIfBuffs[row.stat] ?? 0;
              const label = row.control?.label ?? humanise(row.stat);
              const unit = row.control?.unit ?? '';
              return (
                <div key={row.stat} className="flex items-center gap-2 text-[11px]">
                  <span className={`w-28 shrink-0 truncate ${row.control?.color ?? 'text-gray-300'}`}>
                    {label}
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums text-gray-600">
                    Build {fmt(row.fromBuild, 0)}{unit}
                  </span>
                  {row.ceiling === null ? (
                    <span className="flex-1 text-[10px] text-amber-400/80">
                      no exported ceiling for this archetype — value only
                    </span>
                  ) : (
                    <input
                      type="range"
                      min={-row.ceiling}
                      max={row.ceiling}
                      step={5}
                      value={simulated}
                      onChange={(e) => setWhatIfBuff(row.stat, Number(e.target.value) || 0)}
                      aria-label={`${label} team-buff simulation`}
                      className="flex-1 h-4 cursor-pointer accent-purple-400"
                    />
                  )}
                  <input
                    type="number"
                    step={5}
                    value={simulated}
                    onChange={(e) => setWhatIfBuff(row.stat, Number(e.target.value) || 0)}
                    aria-label={`${label} team-buff simulation, exact value`}
                    className="w-16 shrink-0 rounded border border-gray-700 bg-gray-900 px-1 py-0.5 text-right tabular-nums text-gray-200"
                  />
                  <span
                    className={`w-24 shrink-0 text-right tabular-nums ${
                      simulated === 0 ? 'text-gray-600' : simulated > 0 ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {simulated === 0 ? '—' : `→ ${fmt(row.current, 0)}${unit}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Palette */}
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Available powers — tap to add
              {/* Which form the next tap lands in — the thing that decides whether
                * a chip is dimmed, so it has to be readable beside them. Only
                * mentions dimming when something actually is dimmed. */}
              {formModes.length > 0 && (
                <span className="ml-1 font-normal normal-case tracking-normal text-gray-600">
                  — you’re in {formLabel(nextForm)}
                  {palette.some(({ p }) => !castableNext(p)) && '; dimmed chips need a form switch first'}
                </span>
              )}
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-gray-500">
              Rank by
              <select
                value={powerMetric}
                onChange={(e) => setPowerMetric(e.target.value as PowerMetric)}
                className="h-6 px-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 text-[11px]"
                title="Metric that ranks powers — palette order, color intensity, and compactness weighting"
              >
                <option value="damage">Damage (total dmg)</option>
                <option value="dpa">DPA (dmg / actvn)</option>
                <option value="dps">DPS (dmg / actvn + rech)</option>
              </select>
            </label>
          </div>
          {palette.length === 0 ? (
            <div className="text-[12px] text-gray-500 py-2">
              No click attacks in this build yet. Add some powers first.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {palette.map(({ p, i, form }) => {
                // Everything the chip prints comes from the form a tap would
                // actually schedule (`form`), not the power's flat fields. Those
                // are permanently the SLOW charged snipe, the slow Energy
                // Transfer and the mid-combat Assassin's Strike, so a quick snipe
                // used to advertise the slow cast's 5.03 dmg against the 2.81 it
                // delivers — the reported "hovering a quick snipe shows the slow
                // snipe details".
                const effCast = form?.cast ?? p.cast;
                const rel = maxMetric > 0 ? metricVal(p, form) / maxMetric : 0;
                const isSwitch = p.type === 'switch';
                // Castable in the form the next tap would land in? A union palette
                // can no longer PREVENT an illegal pick by leaving the chip out, so
                // it dims it instead — visible, still clickable, and `computeChain`
                // flags the cast if you take it anyway. Showing it is the point: a
                // user needs to see what a switch would unlock.
                const castable = castableNext(p);
                // Powers that carry a special chain mechanic: an alternate cast
                // form (snipes, Energy Transfer, Assassin's Strike from-Hide, a
                // caster-form variant) or a charge that enables one (Total Focus,
                // Placate). Flag them so the build/spend pieces stand out; the hint
                // is trigger-aware. Switches are excluded — their whole chip is
                // about the mechanic already, and their only form is the opt-in
                // shift animation, which the checkbox above owns.
                const specialForm = isSwitch
                  ? undefined
                  : p.forms?.find((f) => f.kind === 'fast') ?? p.forms?.[0];
                const special = specialForm
                  ? specialForm.trigger.type === 'tohit'
                    ? `Has a fast form — auto-fires with ≥${specialForm.trigger.threshold}% ToHit (Build Up / Aim / Tactics)`
                    : specialForm.trigger.type === 'hidden'
                      ? `Has a slow from-Hide form — auto-fires as the opener or right after Placate`
                      : specialForm.trigger.type === 'mode'
                        ? `Becomes ${specialForm.label} in ${formNoun(specialForm.trigger.mode)} form — same tray slot, same cooldown`
                        : specialForm.trigger.type === 'charge'
                          ? `Has a ${specialForm.label} fast form — auto-fires when its charge is available`
                          : null
                  : p.grants === 'hidden'
                    ? `Re-Hides you — lets the next Assassin's Strike use its from-Hide form`
                    : p.grants
                      ? `Grants ${p.grants.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} — enables a fast form later in the chain`
                      : null;
                const label = isSwitch ? `→ ${switchTarget(p)}` : p.name;
                const title = isSwitch
                  ? `Switch to ${switchTarget(p)} · costs ${fmt(effCast, 2)}s`
                    + `${p.endCost > 0 ? ` · ${fmt(p.endCost, 2)} end` : ''}`
                    + `${p.baseRecharge > 0 ? ` · re-entry cooldown ${fmt(p.baseRecharge, 1)}s` : ''}`
                    + `\n${SHIFT_PROVENANCE}`
                    + (castable ? '' : `\n⚠ You are already in this form.`)
                  : `${p.name}${form ? ` · ${form.label}` : ''} · cast ${fmt(effCast, 2)}s · rech ${fmt(p.baseRecharge, 1)}s · ${fmt(metricVal(p, form), powerMetric === 'damage' ? 0 : 1)} ${METRIC_LABEL[powerMetric]}`
                    + (form ? `\n⚡ Fires its ${form.label} form here — cast and damage are that form's` : '')
                    + (special ? `\n⚡ ${special}` : '')
                    + (castable
                      ? ''
                      : `\n⚠ Not castable in ${formNoun(nextForm)} form — add a form switch before it, or it will be flagged on the timeline.`);
                return (
                  <button
                    key={p.id}
                    onClick={() => addPower(i)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs ${
                      castable
                        ? 'border-gray-700 hover:border-gray-500 text-gray-200'
                        : 'border-gray-800 border-dashed text-gray-500 hover:border-gray-600'
                    }`}
                    style={{
                      borderLeftWidth: 2,
                      borderLeftColor: isSwitch ? SWITCH_EDGE : barFill(p.type, rel),
                      background: chipBg(p.type, rel),
                      // Dimmed, not hidden — see `castable` above.
                      ...(castable ? {} : { opacity: 0.45 }),
                      ...(isSwitch
                        ? { boxShadow: `inset 0 0 0 1px ${SWITCH_EDGE}` }
                        : special
                          ? { boxShadow: 'inset 0 0 0 1px rgba(255,224,138,0.55)' }
                          : {}),
                    }}
                    title={title}
                  >
                    {/* The switch chip's own "→ Form" label already announces what it
                        is, so it takes the ring and the hue instead of a glyph. */}
                    {!isSwitch && special && (
                      <span style={{ color: '#FFE08A', fontSize: 10, lineHeight: 1 }}>⚡</span>
                    )}
                    <span>{label}</span>
                    <span className="text-[10px] text-gray-500">{fmt(effCast, 2)}s</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Chain timeline
              <span className="font-normal normal-case text-gray-600"> · drag a bar to reorder</span>
            </span>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-gray-500">
              <span className="flex items-center gap-1.5">
                low
                <span
                  className="inline-block w-12 h-2 rounded"
                  style={{ background: `linear-gradient(90deg, ${barFill('attack', 0)}, ${barFill('attack', 1)})` }}
                />
                high {METRIC_LABEL[powerMetric]}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#1D9E75', opacity: 0.55 }} />
                active time
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#E24B4A', opacity: 0.65 }} />
                dead time
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2 rounded-sm" style={{ background: READY_FILL }} />
                waiting
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-[2px] h-2.5 rounded-sm" style={{ background: '#F2A83A', opacity: 0.85 }} />
                DoT tick
              </span>
              {effectWindowsOn && (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-2 rounded-sm" style={{ background: WINDOW_COLOR.buff }} />
                    buff
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-2 rounded-sm" style={{ background: WINDOW_COLOR.debuff }} />
                    debuff
                  </span>
                </>
              )}
              {chainHasSwitch && (
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-2 rounded-sm"
                    style={{ background: barFill('switch', 0), boxShadow: `inset 0 0 0 1px ${SWITCH_EDGE}` }}
                  />
                  form switch
                </span>
              )}
              {illegalBySeq.size > 0 && (
                <span className="flex items-center gap-1.5 text-red-400">
                  <span
                    className="inline-block w-3 h-2 rounded-sm"
                    style={{ boxShadow: `inset 0 0 0 1.5px ${ILLEGAL_EDGE}` }}
                  />
                  wrong form ({illegalBySeq.size})
                </span>
              )}
              {result && (
                <span
                  className={
                    result.efficiency >= 95
                      ? 'text-emerald-400'
                      : result.efficiency >= 80
                        ? 'text-amber-400'
                        : 'text-red-400'
                  }
                >
                  {result.efficiency >= 95 ? 'Tight loop' : `${fmt(result.deadTime, 2)}s dead`}
                </span>
              )}
            </div>
          </div>

          {activations.length === 0 ? (
            <div className="text-[12px] text-gray-500 py-6 text-center">
              Tap powers above to build a chain.
            </div>
          ) : (
            <div
              ref={scrollRef}
              onPointerDown={onTimelinePointerDown}
              className="overflow-x-auto select-none cursor-grab active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: 'none' }}
            >
              {/* Lanes */}
              <div ref={lanesRef} style={{ position: 'relative', minWidth: LABEL_W + displayW }}>
                {usedPis.map((pi) => {
                  const p = powers[pi];
                  const mine = activations.filter((a) => a.pi === pi);
                  const effRech = rechargeBounds ? effectiveRecharge(p, globalRech, rechargeBounds) : 0;
                  const isSwitch = p.type === 'switch';
                  const laneName = isSwitch ? `→ ${switchTarget(p)}` : p.name;
                  return (
                    <div key={pi} style={{ display: 'flex', alignItems: 'center', height: LANE_H, marginBottom: 3 }}>
                      <div
                        style={{ width: LABEL_W, flexShrink: 0, paddingRight: 8, ...(isSwitch && { color: SWITCH_EDGE }) }}
                        className="text-[11px] text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis"
                        title={isSwitch ? `Switch to ${switchTarget(p)}\n${SHIFT_PROVENANCE}` : p.name}
                      >
                        {laneName}
                        {mine.length > 1 && <span className="text-gray-600"> ×{mine.length}</span>}
                      </div>
                      <div style={{ position: 'relative', height: LANE_H, width: displayW, flexShrink: 0 }}>
                        {mine.map((act, mi) => {
                          const x = act.start * px;
                          // An alternate form (e.g. fast Energy Transfer) shortens
                          // the animation — the bar width must follow the form's
                          // cast, not the base, or a fast cast would render long.
                          const form = activationForm(powers, act);
                          const effCast = form?.cast ?? p.cast;
                          const w = Math.max(effCast * px, 6);
                          // Per-CAST, not per-lane: two casts of one power can run
                          // different forms, and this bar is one of them. A
                          // from-Hide Assassin's Strike hits ~3.17× the mid-combat
                          // base beside it in the same lane, so tinting both from
                          // the power's flat damage would print one colour over two
                          // very different hits. maxMetric spans every form, so rel
                          // stays in [0,1] whichever form this is.
                          const rel = maxMetric > 0 ? metricVal(p, form) / maxMetric : 0;
                          // Cooldown stem: drawn from the end of THIS cast's bar, so
                          // it must net off the form's animation, not the base's.
                          const cdW = Math.max(0, effRech - effCast) * px;
                          // Recharge overshoot ("waiting"): from when this
                          // cast's recharge completes (or its animation ends, if
                          // it recharges mid-cast) until the next cast of this
                          // power — the next in-lane cast, or across the loop
                          // boundary. Clipped to the cycle so it doesn't spill
                          // into the next loop.
                          const overStart = Math.max(act.start + effRech, act.end);
                          const nextStart =
                            mi + 1 < mine.length ? mine[mi + 1].start : mine[0].start + cycleSec;
                          const overEnd = Math.min(nextStart, cycleSec);
                          const overW = overEnd - overStart;
                          // Buff/debuff "active window": colour the stem from the
                          // cast's end to expiry (cast + duration), clipped to the
                          // visible track. The colour edge marks when the effect
                          // falls off — the moment to refresh.
                          const win = effectWindowsOn ? p.effectWindow : undefined;
                          const winLeft = x + w;
                          const winW = win
                            ? Math.min(act.start + win.duration, displaySec) * px - winLeft
                            : 0;
                          // A cast the caster's live form does not allow. Marked, not
                          // removed — the numbers above still count it, because a
                          // half-shifted chain is one the user is mid-edit on.
                          const bad = act.seq !== undefined ? illegalBySeq.get(act.seq) : undefined;
                          return (
                            <div key={act.seq}>
                              {/* recharge (cooldown) */}
                              {cdW > 0 && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: x + w,
                                    top: LANE_H / 2 - 3,
                                    width: cdW,
                                    height: 6,
                                    background: cdFill(p.type),
                                    borderRadius: '0 2px 2px 0',
                                  }}
                                />
                              )}
                              {/* waiting (recharge overshoot) */}
                              {overW > 0.001 && (
                                <div
                                  title={`waiting ${fmt(overW, 2)}s — ${p.name} has recharged but you're still mid-animation`}
                                  style={{
                                    position: 'absolute',
                                    left: overStart * px,
                                    top: LANE_H / 2 - 3,
                                    width: overW * px,
                                    height: 6,
                                    background: READY_FILL,
                                    borderRadius: 2,
                                  }}
                                />
                              )}
                              {/* buff/debuff active window — colours the stem
                                  over the cooldown/idle bars until the effect
                                  expires (the colour edge = refresh point). */}
                              {win && winW > 0 && (
                                <div
                                  title={`${p.name} ${win.kind} active ${fmt(win.duration, 0)}s — colour ends at expiry`}
                                  style={{
                                    position: 'absolute',
                                    left: winLeft,
                                    top: LANE_H / 2 - 3,
                                    width: winW,
                                    height: 6,
                                    background: WINDOW_COLOR[win.kind],
                                    borderRadius: '0 2px 2px 0',
                                    zIndex: 1,
                                  }}
                                />
                              )}
                              {/* after-cast DoT ticks */}
                              {p.dot &&
                                Array.from({ length: p.dot.ticks }).map((_, t) => {
                                  const tickT = act.start + effCast + (t + 1) * p.dot!.period;
                                  const inWin = tickT <= cycleSec;
                                  // Fade each mark by its landing probability so
                                  // cancel-on-miss / chance-gated decay reads visually.
                                  const prob = chainDotTickProbability(p.dot!, t + 1);
                                  return (
                                    <div
                                      key={t}
                                      style={{
                                        position: 'absolute',
                                        left: tickT * px - 1,
                                        top: (LANE_H - 10) / 2,
                                        width: 2,
                                        height: 10,
                                        background: '#F2A83A',
                                        borderRadius: 1,
                                        opacity: (inWin ? 0.85 : 0.25) * prob,
                                        zIndex: 2,
                                      }}
                                    />
                                  );
                                })}
                              {/* activation bar (drag to reorder) + remove ✕ */}
                              <div
                                className="group cursor-grab active:cursor-grabbing touch-none"
                                data-bar
                                data-seq={act.seq}
                                onPointerDown={(e) => {
                                  if (act.seq !== undefined) startBarDrag(e, act.seq);
                                }}
                                style={{
                                  position: 'absolute',
                                  left: x,
                                  top: 3,
                                  width: w,
                                  height: LANE_H - 6,
                                  background: barFill(p.type, rel),
                                  borderRadius: 3,
                                  zIndex: 2,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'flex-end',
                                  overflow: 'visible',
                                  // Rings, innermost first. A switch always carries its
                                  // own so the 0.26s sliver reads as a step rather than
                                  // as the gap between two attacks; an illegal cast
                                  // carries a red one over the top of whatever else it
                                  // has; the grab ring wins while dragging.
                                  ...(isSwitch && { boxShadow: `inset 0 0 0 1.5px ${SWITCH_EDGE}` }),
                                  ...(bad && {
                                    boxShadow: `inset 0 0 0 1.5px ${ILLEGAL_EDGE}, 0 0 0 1.5px ${ILLEGAL_EDGE}`,
                                    zIndex: 3,
                                  }),
                                  ...(reorder?.from === act.seq && {
                                    boxShadow: `0 0 0 2px ${CURSOR_COLOR}, 0 3px 8px rgba(0,0,0,0.45)`,
                                    zIndex: 3,
                                  }),
                                }}
                                title={
                                  (isSwitch
                                    ? `Switch to ${switchTarget(p)} · ${fmt(effCast, 2)}s`
                                      + `${form ? ` (${form.label})` : ''} @ ${fmt(act.start, 2)}s`
                                      + `\n${SHIFT_PROVENANCE}`
                                    : `${p.name}${form ? ` · ${form.label} (${fmt(effCast, 2)}s)` : ''} @ ${fmt(act.start, 2)}s`)
                                  + (bad ? `\n⚠ ${prettyReason(bad)}` : '')
                                  + '\n— drag to reorder'
                                }
                              >
                                {/* Cast badge. ⇄ marks a form switch (its own kind of
                                    step, not an attack); ⚡ marks a cast the engine
                                    upgraded to an alternate form, so a shortened bar
                                    isn't mistaken for a different power; ⚠ overrides
                                    both on a cast the live form doesn't allow. */}
                                {(bad || isSwitch || form) && (
                                  <span
                                    style={{
                                      position: 'absolute',
                                      left: 2,
                                      top: 1,
                                      fontSize: 9,
                                      lineHeight: 1,
                                      color: bad ? ILLEGAL_EDGE : isSwitch ? SWITCH_EDGE : '#FFE08A',
                                      pointerEvents: 'none',
                                      zIndex: 3,
                                    }}
                                  >
                                    {bad ? '⚠' : isSwitch ? '⇄' : '⚡'}
                                  </span>
                                )}
                                {/* Larger transparent hit target around a small
                                    visible dot — forgiving to click, especially
                                    on narrow (fast-cast) bars. */}
                                <button
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={() => {
                                    if (act.seq !== undefined) removeBar(act.seq);
                                  }}
                                  style={{
                                    position: 'absolute',
                                    top: -9,
                                    right: -9,
                                    width: 26,
                                    height: 26,
                                    padding: 0,
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    touchAction: 'none',
                                  }}
                                  title="Remove this power"
                                >
                                  <span
                                    className="opacity-40 group-hover:opacity-100 transition-opacity"
                                    style={{
                                      width: 16,
                                      height: 16,
                                      borderRadius: 8,
                                      background: '#1a2335',
                                      border: '1px solid rgba(255,255,255,0.2)',
                                      color: '#c8d4e0',
                                      fontSize: 9,
                                      lineHeight: 1,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }}
                                  >
                                    ✕
                                  </span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* loop boundary line */}
                <div
                  style={{
                    position: 'absolute',
                    left: LABEL_W + cycleSec * px,
                    top: 0,
                    width: 2,
                    height: '100%',
                    background: '#1D9E75',
                    opacity: 0.55,
                  }}
                />

                {/* reorder insert cursor — full-height line marking the drop gap */}
                {reorder && (
                  <div
                    style={{
                      position: 'absolute',
                      left: reorder.left - 2,
                      top: 0,
                      width: 4,
                      height: '100%',
                      background: CURSOR_COLOR,
                      borderRadius: 2,
                      boxShadow: `0 0 6px ${CURSOR_COLOR}`,
                      pointerEvents: 'none',
                      zIndex: 4,
                    }}
                  />
                )}
              </div>

              {/* Activity / dead-time bar */}
              <div style={{ position: 'relative', height: 8, marginLeft: LABEL_W, minWidth: displayW, marginTop: 4 }}>
                <div
                  style={{ position: 'absolute', left: 0, top: 1, width: cycleSec * px, height: 6, background: '#1D9E75', opacity: 0.25, borderRadius: 3 }}
                />
                {result?.deadGaps.map((g, i) => (
                  <div
                    key={i}
                    style={{ position: 'absolute', left: g.start * px, top: 1, width: (g.end - g.start) * px, height: 6, background: '#E24B4A', opacity: 0.65, borderRadius: 2 }}
                  />
                ))}
              </div>

              {/* Ruler */}
              <Ruler maxSec={displaySec} px={px} marginLeft={LABEL_W} />

              {/* Endurance sawtooth */}
              {end && (
                <EnduranceTrack end={end} px={px} cycleSec={cycleSec} marginLeft={LABEL_W} />
              )}
            </div>
          )}
        </div>

        {/* Rotation quick reference — the settled rotation order, copyable */}
        {sequence.length > 0 && (
          <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                Rotation order
              </div>
              <button
                onClick={copySequence}
                className="h-6 px-2 rounded border border-gray-700 hover:border-gray-500 text-gray-400 text-[11px]"
                title="Copy the rotation order to the clipboard"
              >
                Copy
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] leading-relaxed">
              {sequence.map((pi, idx) => {
                const p = powers[pi];
                if (!p) return null;
                // `idx` IS the Activation.seq replayChain stamps (it walks the
                // sequence in order), so the illegal map keys line up directly.
                const bad = illegalBySeq.get(idx);
                const isSwitch = p.type === 'switch';
                return (
                  <span key={idx} className="flex items-center gap-1">
                    {idx > 0 && <span className="text-gray-600">→</span>}
                    <span
                      className={bad ? 'rounded px-1 border border-dashed cursor-help' : undefined}
                      style={{
                        color: bad ? ILLEGAL_EDGE : `hsl(${TYPE_HUE[p.type]}, 55%, 72%)`,
                        ...(bad && { borderColor: ILLEGAL_EDGE }),
                      }}
                      title={bad ? `⚠ ${prettyReason(bad)}` : undefined}
                    >
                      {bad && '⚠ '}
                      {isSwitch ? `⇄ ${switchTarget(p)}` : p.name}
                    </span>
                  </span>
                );
              })}
            </div>
            {chainHasSwitch && (
              // Persistent, not a toast: the assumption the numbers were computed
              // under has to be readable at the same moment as the numbers.
              <div className="mt-2 text-[10px] leading-snug text-gray-500" title={SHIFT_PROVENANCE}>
                {fullShiftAnimations
                  ? `Form switches charged at the FULL ${fmt(SHAPESHIFT_FULL_ANIM, 2)}s shift animation `
                    + `(${fmt(SHIFT_FULL_ARCANA, 2)}s each).`
                  : `Form switches charged at the ${fmt(SHIFT_BLOCKING_ARCANA, 2)}s blocking segment only — `
                    + `assumes you animation-cancel every shift by attacking straight out of it.`}
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-2">
          <Stat
            label="Cycle"
            value={result ? fmt(cycleSec, 2) : '—'}
            unit="s"
            marker={shiftMarker}
            invalid={illegalMarker}
            help={`${illegalHelpClause}${shiftHelpClause}How long one full loop of the rotation takes before it repeats. This is the last power's end time, OR — if a long-recharge power hasn't recovered by then — extended until every power is ready to fire again. Each power's animation lock (ArcanaTime) and its effective recharge are both built into this number.`}
          />
          <Stat
            label="Total dmg"
            value={result ? fmt(result.totalDamage, 0) : '—'}
            invalid={illegalMarker}
            help={`${illegalHelpClause}Total damage dealt across one full cycle — every power's hit, in-cycle damage-over-time ticks, and expected proc damage. DoT ticks that would land after the loop repeats are not counted.`}
          />
          <Stat
            label="DPS"
            value={result ? fmt(result.dps, 1) : '—'}
            marker={shiftMarker}
            invalid={illegalMarker}
            help={`${illegalHelpClause}${shiftHelpClause}Damage per second = Total damage ÷ Cycle time. The sustained throughput of the rotation, including any idle time inside the cycle.`}
          />
          <Stat
            label="Efficiency"
            value={result ? fmt(result.efficiency, 0) : '—'}
            unit="%"
            marker={shiftMarker}
            // A form switch is a genuine activation, so the lane really is busy and
            // the maths is right to count it. Which makes the READING the trap: a
            // rotation that spends two seconds shapeshifting can score "Tight loop"
            // while dealing no damage for those two seconds. Named here rather than
            // special-cased in the maths — excluding switches would be a soft-wrong
            // number in the other direction, reporting idle time the player does not
            // have.
            //
            // The good/warn TONE is suppressed once a rotation shifts, because it
            // ran backwards: admitting you do not animation-cancel LENGTHENS the
            // busy lane, so on ⇄Dwarf → Strike → Smite → ⇄Human it moves 48% → 99%
            // — amber "needs work" to emerald "tight loop" — for a rotation now
            // spending 4.49s of a 7.72s cycle shapeshifting, with damage and DPS
            // unchanged. Rewarding the honest answer with a greener tile is worse
            // than declining to grade: the number still shows, the verdict does not.
            tone={
              result && !chainHasSwitch
                ? result.efficiency >= 95
                  ? 'good'
                  : result.efficiency < 80
                    ? 'warn'
                    : undefined
                : undefined
            }
            help="measures how often your character is activating powers (cycle − dead time) ÷ cycle. 100% = you are always activating something (the red gaps on the timeline are dead time). Form switches count as activating — the animation lane really is busy — but they deal no damage, so a shapeshifting rotation can read as a tight loop while spending part of it not attacking. Compare DPS, not Efficiency, across chains that shift."
          />
          <Stat
            label="Compact."
            value={result && result.compactness !== null ? fmt(result.compactness, 0) : '—'}
            unit="%"
            tone={
              result && result.compactness !== null
                ? result.compactness >= 95
                  ? 'good'
                  : result.compactness < 80
                    ? 'warn'
                    : undefined
                : undefined
            }
            help="Compactness — measures how often powers are idle (off cooldown, waiting to be used), weighted by the selected power metric (damage / DPA / DPS). For each power: min(1, times activation × effective recharge ÷ cycle)"
          />
          <Stat
            label="Recovery"
            value={end ? `+${fmt(end.recoveryPerSec, 2)}` : '—'}
            unit="/s"
            tone="good"
            help="Endurance recovered per second from your recovery rate (before subtracting toggles and attack costs)."
          />
          {instantRestore > 0.5 && (
            <Stat
              label="Click +End"
              value={`+${fmt(instantRestore, 0)}`}
              unit="end"
              tone="good"
              help="Endurance restored per cycle by click recovery powers in the chain (Dark Consumption / Consume / Power Sink), scaled by your targets-hit setting for each."
            />
          )}
          <Stat
            label="Spend"
            value={end ? `−${fmt(end.togglePerSec + end.attackPerSec, 2)}` : '—'}
            unit="/s"
            help="Endurance drained per second: active toggle upkeep plus the average attack cost spread over the cycle."
          />
          <Stat
            label="Net end"
            value={end ? `${passiveNet >= 0 ? '+' : ''}${fmt(passiveNet, 2)}` : '—'}
            unit="/s"
            tone={end ? (passiveNet >= -0.001 ? 'good' : 'warn') : undefined}
            help="Recovery minus total spend, per second. Positive (green) = endurance grows over time; negative (amber) = the rotation drains your bar."
          />
          <Stat
            label="Sustain"
            value={
              !end
                ? '—'
                : end.stallTime !== null
                  ? `stall ${fmt(end.stallTime, 0)}s`
                  : end.sustainable
                    ? 'yes'
                    : `${fmt(end.timeToEmpty ?? 0, 0)}s`
            }
            tone={end ? (end.sustainable && end.stallTime === null ? 'good' : 'warn') : undefined}
            help="Can you run this rotation forever from a full bar? 'yes' = endurance never bottoms out. 'stall Ns' = the bar hits zero mid-cast at N seconds and the chain breaks. A bare 'Ns' = not stalling yet but slowly draining, emptying in about N seconds."
          />
        </div>
      </div>
    </Modal>
  );
}

function Ruler({ maxSec, px, marginLeft }: { maxSec: number; px: number; marginLeft: number }) {
  const interval = maxSec > 20 ? 5 : maxSec > 10 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = 0; t <= Math.ceil(maxSec); t += interval) ticks.push(t);
  return (
    <div style={{ position: 'relative', height: 16, marginLeft, minWidth: maxSec * px, marginTop: 3 }}>
      {ticks.map((t) => (
        <div key={t} style={{ position: 'absolute', left: t * px, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 1, height: 4, background: 'rgba(255,255,255,0.14)' }} />
          <span className="text-[9px] text-gray-600 mt-0.5">{t}s</span>
        </div>
      ))}
    </div>
  );
}

function EnduranceTrack({
  end,
  px,
  cycleSec,
  marginLeft,
}: {
  end: NonNullable<ReturnType<typeof computeChain>>['endurance'];
  px: number;
  cycleSec: number;
  marginLeft: number;
}) {
  if (!end || end.track.length < 2) return null;
  const H = 38;
  const horizon = end.track[end.track.length - 1].t;
  const w = Math.max(horizon * px, 40);
  // Endurance is the game's blue bar; sustainability is conveyed by the Sustain
  // stat card and the red stall marker rather than recoloring the whole track.
  const color = '#3B9EE8';
  const pts = end.track.map((p) => `${p.t * px},${H - p.frac * H}`).join(' ');
  const areaPts = `0,${H} ${pts} ${w},${H}`;
  const loopLines: number[] = [];
  for (let t = cycleSec; t <= horizon + 0.01; t += cycleSec) loopLines.push(t);

  return (
    <div style={{ marginLeft, minWidth: w, marginTop: 6 }}>
      <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-0.5">
        Endurance (from full)
      </div>
      <svg width={w} height={H} style={{ display: 'block' }}>
        <polygon points={areaPts} fill={color} opacity={0.16} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />
        {loopLines.map((t, i) => (
          <line key={i} x1={t * px} y1={0} x2={t * px} y2={H} stroke="#1D9E75" strokeWidth={1} opacity={0.3} />
        ))}
        {end.stallTime !== null && (
          <circle cx={end.stallTime * px} cy={H} r={3} fill="#E24B4A" />
        )}
      </svg>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  tone,
  help,
  marker,
  invalid,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'good' | 'warn';
  /** Plain-language explanation shown on hover (native tooltip). */
  help?: string;
  /** A non-default modelling assumption this number was computed under, printed
   *  as a small pill beside the label. Persistent BY DESIGN: a toast at the
   *  moment the assumption changed is gone by the time anyone reads the number,
   *  which is exactly when they need to know it is not the default. */
  marker?: string;
  /** Set when the number counts casts the caster's live form does not allow, so
   *  it reads HIGHER than the rotation can actually deliver. Rendered red rather
   *  than amber: an assumption pill qualifies a number, this one says it is
   *  currently wrong. */
  invalid?: string;
}) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : 'text-gray-200';
  return (
    <div
      className={`rounded-md bg-gray-800/60 px-3 py-2.5${help ? ' cursor-help' : ''}`}
      title={help}
    >
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</span>
        {help && <span className="text-[9px] text-gray-600 leading-none">ⓘ</span>}
        {invalid ? (
          <span className="ml-auto rounded-sm border border-red-500/50 bg-red-500/10 px-1 text-[9px] leading-tight text-red-300">
            ⚠ {invalid}
          </span>
        ) : (
          marker && (
            <span className="ml-auto rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 text-[9px] leading-tight text-amber-300">
              {marker}
            </span>
          )
        )}
      </div>
      <span className={`text-base font-medium ${color}`}>{value}</span>
      {unit && <span className="text-[11px] text-gray-500 ml-0.5">{unit}</span>}
    </div>
  );
}
