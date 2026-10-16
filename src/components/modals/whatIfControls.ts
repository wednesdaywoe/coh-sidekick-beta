/**
 * What-if control descriptions — one place both surfaces read a stat's label and colour from.
 *
 * The full layer lives in `WhatIfBuffsModal`; the Attack Chain Builder offers the subset a
 * chain's numbers actually move with. Sharing this derivation is what keeps the same stat from
 * being labelled two ways depending on which modal you opened.
 *
 * **No stat is named here.** A control exists when the engine's vocabulary offers the key AND
 * some `STAT_DEFINITIONS` entry renders it, and its label, section and colour are read off that
 * entry.
 */

import { STAT_DEFINITIONS, STAT_CATEGORY } from '@/data/core/stat-definitions';

export interface WhatIfControl {
  /** The `GlobalBonuses` key the layer is keyed by. */
  stat: string;
  label: string;
  category: string;
  color: string;
  /** Display unit, concatenated after the value like the dashboard does ('%', 'Mag', ''). */
  unit: string;
}

/** Section display names, in the canonical `STAT_SECTIONS` order. */
export const CATEGORY_LABELS: Record<string, string> = {
  offense: 'Offense',
  'health-endurance': 'Health & Endurance',
  movement: 'Movement',
  'stealth-perception': 'Stealth & Perception',
  defense: 'Defense',
  resistance: 'Resistance',
  'status-protection': 'Status Protection',
  'status-resistance': 'Status Resistance',
  'debuff-resistance': 'Debuff Resistance',
};

/** `defSmashing` → `Def Smashing`. Used only where no dashboard row names the key alone. */
export function humanise(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The controls for `vocabulary`, in the order given.
 *
 * A stat qualifies when some `STAT_DEFINITIONS` entry names it as its `breakdownKey` — that is
 * what "a surface renders this number" means, and it is what keeps a routable-but-unspent key
 * (`mezResist`, whose row was retired — DATA-GAP-REGISTER data-gaps-185) from becoming a control
 * that moves nothing.
 */
export function whatIfControls(vocabulary: readonly string[]): WhatIfControl[] {
  const byBreakdownKey = new Map<string, { id: string; label: string; color: string; unit: string }>();
  for (const def of Object.values(STAT_DEFINITIONS)) {
    if (def.breakdownKey && !byBreakdownKey.has(def.breakdownKey)) {
      byBreakdownKey.set(def.breakdownKey, {
        id: def.id,
        label: def.label,
        color: def.color,
        // The row's own breakdown unit — '%' by default, 'Mag' for status protection, '' for
        // unitless counts (level shift) — so a control can't claim a unit its row doesn't.
        unit: def.breakdownUnit ?? '%',
      });
    }
  }
  const controls: WhatIfControl[] = [];
  for (const stat of vocabulary) {
    const row = byBreakdownKey.get(stat);
    if (!row) continue;
    controls.push({
      stat,
      // The row's label is short-form for the dashboard's narrow columns ("Dmg", "Acc"). A
      // control gets whichever is clearer: the row label where it is not an abbreviation of
      // the key, else the humanised key.
      label: row.label.length >= 6 ? row.label : humanise(stat),
      category: STAT_CATEGORY[row.id] ?? 'offense',
      color: row.color,
      unit: row.unit,
    });
  }
  return controls;
}
