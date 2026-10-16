/**
 * Global "stance" selectors — sets whose powers are gated on a mutually
 * exclusive caster stance.
 *
 * Single source of truth: the stance lives in the **parent power's
 * `activeSubPower`** (build-scoped, serialized, the same field Dual Pistols ammo
 * uses). Taking the parent (Bio Armor's Adaptation / "Evolution", Staff
 * Fighting's Staff Mastery) auto-grants the stance/form sub-powers as chips, and
 * selecting one sets `parent.activeSubPower`. Every consumer derives the active
 * stance from that field:
 *   - the dashboard calc (`expandActiveConditionals` via `stanceAdjusterOverrides`),
 *   - the InfoPanel conditional merge, and
 *   - the header + per-power stance selectors (which write it back via
 *     `setActiveSubPower`).
 *
 * The mode-gated `conditionalEffects` on each power are keyed by the bare
 * conditional `id` (e.g. `defensiveadaptation`, `perfection_of_body_level_3`);
 * `subPower` maps each option to the `activeSubPower` value that selects it.
 *
 *  - **Bio Armor — Adaptation** (Defensive / Offensive / Efficient): drives
 *    survivability totals. Note the data id for the Efficient stance is the
 *    legacy "rested"; the sub-power and label use the in-game "Efficient".
 *  - **Staff Fighting — Form / Perfection** (Body / Mind / Soul): the form chip
 *    sets the stance; selecting it assumes max (Lvl 3) Perfection of that form,
 *    applying the finisher bonuses on Sky Splitter / Eye of the Storm.
 */

export interface StanceOption {
  /** Conditional id in the generated `conditionalEffects[].id`. */
  id: string;
  /** Full label (tooltip / per-power radio). */
  label: string;
  /** Short label for the header button. */
  short: string;
  /** The parent's `activeSubPower` value that selects this stance — the
   *  auto-granted sub-power's internalName (see `GRANTED_POWER_GROUPS`).
   *  Omitted for a group's *default* option (the state with no sub-power
   *  selected — e.g. Dual Pistols Standard ammo), which clears `activeSubPower`. */
  subPower?: string;
}

export interface StanceGroup {
  /** Unique key (React key + radio group name). */
  key: string;
  /** Header chip label, e.g. "Adaptation" / "Staff Form". */
  headerLabel: string;
  /** Tooltip describing the control. */
  tooltip: string;
  /** Tailwind classes for the active (selected) button. */
  activeClass: string;
  /** The mutually exclusive options (one active at a time). */
  options: readonly StanceOption[];
  /** Parent power internalName(s) that grant this stance — the form-switcher.
   *  Bio Armor is "Adaptation" on Stalker/Sentinel and "Evolution" on
   *  Scrapper/Brute/Tanker; Staff Fighting is "Staff Mastery". The stance is
   *  available iff one of these is in the build, and selecting a stance writes
   *  that parent's `activeSubPower`. */
  parents: readonly string[];
  /** Option id that is active when no sub-power is selected (the default state).
   *  Dual Pistols' Standard ammo applies its -Def whenever no special ammo is
   *  loaded — even with no Swap Ammo power taken. Groups without a default
   *  (adaptation, staff) have no stance until one is explicitly chosen. */
  defaultOptionId?: string;
}

export const STANCE_GROUPS: readonly StanceGroup[] = [
  {
    key: 'adaptation',
    headerLabel: 'Adaptation',
    tooltip:
      'Bio Armor stance. Selecting a mode applies its mode-gated bonuses (Defensive +Def/+HP, Offensive +ToHit/-Regen, Efficient +Regen/+Recovery) across every Bio Armor power and the dashboard totals. Mutually exclusive — re-click to clear.',
    activeClass: 'bg-emerald-700/50 border-emerald-500 text-emerald-100',
    parents: ['Adaptation', 'Evolution'],
    options: [
      { id: 'defensiveadaptation', label: 'Defensive Adaptation', short: 'Defensive', subPower: 'Defensive_Adaptation' },
      { id: 'offensiveadaptation', label: 'Offensive Adaptation', short: 'Offensive', subPower: 'Offensive_Adaptation' },
      { id: 'restedadaptation', label: 'Efficient Adaptation', short: 'Efficient', subPower: 'Efficient_Adaptation' },
    ],
  },
  {
    key: 'staff-form',
    headerLabel: 'Staff Form',
    tooltip:
      'Staff Fighting form. Assumes max (Lvl 3) Perfection of the selected form, applying its finisher bonuses (Body +Smashing/+Res, Mind +Psionic/+ToHit, Soul +Energy/+Regen/+Recovery) to Sky Splitter and Eye of the Storm. Mutually exclusive — re-click to clear.',
    activeClass: 'bg-amber-700/50 border-amber-500 text-amber-100',
    parents: ['Staff_Mastery'],
    options: [
      { id: 'perfection_of_body_level_3', label: 'Perfection of Body', short: 'Body', subPower: 'Form_of_the_Body' },
      { id: 'perfection_of_mind_level_3', label: 'Perfection of Mind', short: 'Mind', subPower: 'Form_of_the_Mind' },
      { id: 'perfection_of_soul_level_3', label: 'Perfection of Soul', short: 'Soul', subPower: 'Form_of_the_Soul' },
    ],
  },
  {
    key: 'swap-ammo',
    headerLabel: 'Ammo',
    tooltip:
      "Dual Pistols loaded ammo. Each attack's secondary effect changes with the ammo: Standard -Def, Cryo -Recharge, Chemical -Damage, Incendiary fire DoT (and the secondary damage type converts). Mutually exclusive; Standard is the default when no ammo is loaded.",
    activeClass: 'bg-sky-700/50 border-sky-500 text-sky-100',
    parents: ['Swap_Ammo'],
    defaultOptionId: 'lethalammo',
    options: [
      { id: 'lethalammo', label: 'Standard Ammo', short: 'Standard' },
      { id: 'cryoammunition', label: 'Cryo Ammo', short: 'Cryo', subPower: 'Cryo_Ammunition' },
      { id: 'chemicalammunition', label: 'Chemical Ammo', short: 'Chemical', subPower: 'Chemical_Ammunition' },
      { id: 'incendiaryammunition', label: 'Incendiary Ammo', short: 'Incendiary', subPower: 'Incendiary_Ammunition' },
    ],
  },
] as const;

/** Minimal shape the derive/lookup helpers need from a build power. */
export interface StancePowerLike {
  internalName: string;
  activeSubPower?: string;
  /** Distinguishes the stance SWITCHER (the mechanic-classified record that
   *  grants the stance chips — `parentMechanic`, or `hiddenPassive` since the
   *  data-gaps-57 flag read) from a same-internalName impostor. Bio Armor's
   *  switcher is internal "Evolution" (Scrapper/Brute/Tanker) or "Adaptation"
   *  (Stalker/Sentinel); the "Evolving Armor" +Res toggle *also* has
   *  internalName "Adaptation" but carries no mechanicType at all. */
  mechanicType?: string;
}

/**
 * Flatten a build's powers into the shape the stance helpers need.
 *
 * Exists so callers can't hand-roll the projection and quietly drop
 * `mechanicType` — which is exactly what defeated `findStanceParent`'s
 * disambiguation once (the InfoPanel picker narrowed each power to
 * `{ internalName, activeSubPower }`, so the helper fell back to pick order and
 * bound Bio Armor's stance to "Evolving Armor" instead of the real switcher).
 * Every field the helpers read is copied here, in one place.
 */
export function toStancePowers(
  ...groups: (readonly StancePowerLike[] | undefined)[]
): StancePowerLike[] {
  const out: StancePowerLike[] = [];
  for (const g of groups) {
    for (const p of g ?? []) {
      out.push({
        internalName: p.internalName,
        activeSubPower: p.activeSubPower,
        mechanicType: p.mechanicType,
      });
    }
  }
  return out;
}

/** The stance group a conditional `id` belongs to, or undefined if the id isn't
 *  a gated stance option. Lets consumers treat stance conditionals specially. */
export function stanceGroupForConditionalId(id: string): StanceGroup | undefined {
  return STANCE_GROUPS.find((g) => g.options.some((o) => o.id === id));
}

/** Is this power a stance/mechanic SWITCHER — the record the stance chips hang
 *  off? Two classes qualify: `parentMechanic` (a visible mechanic parent like
 *  Swap Ammo) and `hiddenPassive` (a set-mechanic grant the game hands out and
 *  hides from the manage screen — Bio Armor's Adaptation, Staff Mastery, per
 *  data-gaps-57's `ShowInManage kFalse` read). Before that read landed the
 *  hidden class could not occur and every switcher stamped `parentMechanic`;
 *  the def flags now separate them, and a switcher can be either. */
function isStanceSwitcher(p: StancePowerLike): boolean {
  return p.mechanicType === 'parentMechanic' || p.mechanicType === 'hiddenPassive';
}

/** The group's enabling parent power present in `powers`, or undefined. The
 *  stance is only available — and only settable — when this exists.
 *
 *  `internalName` is NOT unique within a powerset, so a bare `parents` match can
 *  bind to the WRONG power: on Scrapper/Brute/Tanker Bio Armor both the switcher
 *  (internal "Evolution") and the unrelated "Evolving Armor" +Res toggle
 *  (internal "Adaptation") match `parents: ['Adaptation', 'Evolution']`. The
 *  real switcher — the one whose granted stance chips `requires` it, and the one
 *  the subpower chips (Surface A) bind to — is the mechanic-classified record
 *  (see `isStanceSwitcher`); the impostor toggle carries no `mechanicType` at
 *  all. Pick the switcher over any same-name impostor so every stance surface
 *  resolves to the same parent. Falls back to the first match when nothing is
 *  tagged (single candidate, or callers passing minimal power shapes). */
export function findStanceParent(
  powers: readonly StancePowerLike[],
  group: StanceGroup,
): StancePowerLike | undefined {
  const candidates = powers.filter((p) => group.parents.includes(p.internalName));
  if (candidates.length <= 1) return candidates[0];
  return candidates.find(isStanceSwitcher) ?? candidates[0];
}

/** The active option id for a group given the build's powers. Reads the
 *  selected sub-power from the parent's `activeSubPower`; when nothing is
 *  selected, falls back to the group's `defaultOptionId` (so Dual Pistols'
 *  Standard ammo applies even with no Swap Ammo power), or null for groups
 *  with no default (adaptation, staff). */
export function activeStanceOptionId(
  powers: readonly StancePowerLike[],
  group: StanceGroup,
): string | null {
  const parent = findStanceParent(powers, group);
  const selected = parent?.activeSubPower
    ? group.options.find((o) => o.subPower && o.subPower === parent.activeSubPower)?.id ?? null
    : null;
  return selected ?? group.defaultOptionId ?? null;
}

/**
 * Derive the effective on/off state of EVERY stance conditional id from the
 * build's `activeSubPower` selections. Inactive options are set explicitly to
 * `false` so callers can overlay this onto the UI `globalAdjusters` map and have
 * `activeSubPower` win (overriding any stale global toggle). The result is what
 * the calc / InfoPanel merge consult for stance conditionals.
 */
export function stanceAdjusterOverrides(
  powers: readonly StancePowerLike[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const group of STANCE_GROUPS) {
    const activeId = activeStanceOptionId(powers, group);
    for (const o of group.options) out[o.id] = o.id === activeId;
  }
  return out;
}
