/**
 * Print Build - generates a standalone HTML document for printing
 *
 * Page 1: Header, stats, Primary & Secondary powersets
 * Page 2: Pool powers, Epic pool, Incarnate powers
 *
 * Opens in a new tab with browser-native print dialog.
 */

import type { Build, SelectedPower } from '@/types';
import type { Enhancement } from '@/types/enhancement';
import type { IncarnateBuildState } from '@/types/incarnate';
import { INCARNATE_SLOT_ORDER } from '@/types';
import { calculateCharacterTotals, type GlobalBonuses } from '@/utils/calculations/character-totals';
import { computeExportSlotLevels, type SlotLevel } from '@/utils/slot-levels';
import { powerKey, type PowerCategory } from '@/utils/power-key';
import { getIOSet } from '@/data';

// ============================================
// HELPERS
// ============================================

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STAT_ABBR: Record<string, string> = {
  // Aspect strings as they appear in IO set data
  'Damage': 'Dmg',
  'Accuracy': 'Acc',
  'Recharge': 'Rech',
  'Endurance': 'End',
  'Range': 'Rng',
  'Defense': 'Def',
  'Damage Resistance': 'Res',
  'Heal': 'Heal',
  'ToHit': 'ToHit',
  'ToHit Debuff': 'TH Dbf',
  'Defense Debuff': 'Def Dbf',
  'Hold': 'Hold',
  'Stun': 'Stun',
  'Immobilize': 'Immob',
  'Sleep': 'Sleep',
  'Confuse': 'Conf',
  'Terrorize': 'Fear',
  'Knockback': 'KB',
  'Run': 'Run',
  'Move Speed': 'Move',
  'Jump': 'Jump',
  'Fly': 'Fly',
  'Mez': 'Mez',
  'Threat': 'Threat',
  'Slow': 'Slow',
  'EndMod': 'EndMod',
  'InterruptTime': 'Intr',
  'KnockToKnockDown': 'KD',
  // EnhancementStatType aliases (used elsewhere)
  'EnduranceReduction': 'End',
  'Resistance': 'Res',
  'Healing': 'Heal',
  'Run Speed': 'Run',
  'Fear': 'Fear',
  'Taunt': 'Taunt',
  'Intangible': 'Intang',
  'EnduranceModification': 'EndMod',
  'Interrupt': 'Intr',
  'Mez Duration': 'Mez',
  'Absorb': 'Absorb',
};

function abbrStat(stat: string): string {
  return STAT_ABBR[stat] || stat;
}

/** Shorten common proc/special enhancement text */
function abbrProcText(text: string): string {
  return text
    .replace('Negative Energy Damage', 'Neg Energy Dmg')
    .replace('Psionic Damage', 'Psi Dmg')
    .replace('Smashing Damage', 'Smash Dmg')
    .replace('Lethal Damage', 'Lethal Dmg')
    .replace('Cold Damage', 'Cold Dmg')
    .replace('Toxic Damage', 'Toxic Dmg')
    .replace('Fire Damage', 'Fire Dmg')
    .replace('Energy Damage', 'Energy Dmg')
    .replace('Knockback Protection', 'KB Prot')
    .replace('KnockToKnockDown', 'KB > KD')
    .replace('Knockback', 'KB')
    .replace('Knockdown', 'KD')
    .replace('Recharge Power', 'Rech')
    .replace('Mez Protection,Resistance', 'Mez Prot')
    .replace('Build Up', 'BU')
    .replace('Regeneration', 'Regen')
    .replace('Recovery', 'Recov')
    .replace('-Recharge', '-Rech')
    .replace('+Recharge', '+Rech')
    .replace('Endurance', 'End')
    .replace('Perception', 'Perc');
}

function formatEnhancementName(enh: Enhancement): string {
  switch (enh.type) {
    case 'io-set': {
      const setDef = getIOSet(enh.setId);
      const isAlwaysAttuned = setDef?.category === 'ato' || setDef?.category === 'event';
      const lvl = (enh.attuned || isAlwaysAttuned) ? '\u221E' : `${enh.level ?? 50}`;
      let statStr: string;
      if (enh.isProc) {
        // Abbreviate stat aspects, then append shortened "Chance for X" from the name
        const abbrParts = enh.aspects.map(abbrStat);
        const chanceMatch = enh.name.match(/Chance for .+$/);
        if (chanceMatch) abbrParts.push(abbrProcText(chanceMatch[0]));
        statStr = abbrParts.length > 0 ? esc(abbrParts.join('/')) : esc(abbrProcText(enh.name));
      } else {
        statStr = enh.aspects.map(abbrStat).join('/');
      }
      return `${lvl} ${esc(enh.setName)} - ${statStr}`;
    }
    case 'io-generic':
      return `${enh.level ?? 50} IO ${abbrStat(enh.stat)}`;
    case 'origin':
      return `${enh.tier} ${abbrStat(enh.stat)}`;
    case 'special':
      return esc(enh.name);
  }
}

const SLOT_LABELS: Record<string, string> = {
  alpha: 'Alpha',
  judgement: 'Judgement',
  interface: 'Interface',
  destiny: 'Destiny',
  lore: 'Lore',
  hybrid: 'Hybrid',
};

// ============================================
// STAT SECTIONS
// ============================================

function statRow(label: string, value: number, suffix = '%'): string {
  if (value === 0) return '';
  return `<tr><td>${esc(label)}</td><td class="val">${value.toFixed(2)}${suffix}</td></tr>`;
}

function statSection(title: string, rows: string): string {
  if (!rows.trim()) return '';
  return `
    <div class="stat-group">
      <h3>${esc(title)}</h3>
      <table>${rows}</table>
    </div>`;
}

function buildStatsHTML(g: GlobalBonuses): string {
  const offense = [
    statRow('Damage', g.damage),
    statRow('Accuracy', g.accuracy),
    statRow('To-Hit', g.toHit),
    statRow('Recharge', g.recharge),
    statRow('Endurance Discount', g.endurance),
    statRow('Range', g.range),
  ].join('');

  const defense = [
    statRow('Melee', g.defMelee),
    statRow('Ranged', g.defRanged),
    statRow('AoE', g.defAoE),
    statRow('Smashing', g.defSmashing),
    statRow('Lethal', g.defLethal),
    statRow('Fire', g.defFire),
    statRow('Cold', g.defCold),
    statRow('Energy', g.defEnergy),
    statRow('Negative', g.defNegative),
    statRow('Psionic', g.defPsionic),
    statRow('Toxic', g.defToxic),
  ].join('');

  const resistance = [
    statRow('Smashing', g.resSmashing),
    statRow('Lethal', g.resLethal),
    statRow('Fire', g.resFire),
    statRow('Cold', g.resCold),
    statRow('Energy', g.resEnergy),
    statRow('Negative', g.resNegative),
    statRow('Psionic', g.resPsionic),
    statRow('Toxic', g.resToxic),
  ].join('');

  const health = [
    statRow('Max HP', g.maxHP),
    statRow('Regeneration', g.regeneration),
    statRow('Recovery', g.recovery),
    statRow('Max Endurance', g.maxEndurance),
    statRow('Net End/sec', g.netEndPerSec, '/s'),
  ].join('');

  const movement = [
    statRow('Run Speed', g.runSpeed),
    statRow('Jump Height', g.jumpHeight),
    statRow('Fly Speed', g.flySpeed),
  ].join('');

  const protection = [
    statRow('Hold', g.protHold, ' pts'),
    statRow('Stun', g.protStun, ' pts'),
    statRow('Immobilize', g.protImmobilize, ' pts'),
    statRow('Sleep', g.protSleep, ' pts'),
    statRow('Confuse', g.protConfuse, ' pts'),
    statRow('Fear', g.protFear, ' pts'),
    statRow('Knockback', g.protKnockback, ' pts'),
  ].join('');

  const debuffRes = [
    statRow('Slow', g.debuffResistSlow),
    statRow('Defense', g.debuffResistDefense),
    statRow('Recharge', g.debuffResistRecharge),
    statRow('To-Hit', g.debuffResistToHit),
    statRow('Endurance', g.debuffResistEndurance),
    statRow('Recovery', g.debuffResistRecovery),
    statRow('Regeneration', g.debuffResistRegeneration),
  ].join('');

  return `
    <div class="stats-grid">
      ${statSection('Offense', offense)}
      ${statSection('Defense', defense)}
      ${statSection('Resistance', resistance)}
      ${statSection('Survival & Mobility', health + movement)}
      ${statSection('Mez Protection', protection)}
      ${statSection('Debuff Resistance', debuffRes)}
    </div>`;
}

// ============================================
// POWER LIST
// ============================================

function powerRow(
  power: SelectedPower,
  category: PowerCategory,
  slotLevels: Map<string, SlotLevel[]>
): string {
  // Keyed by powerKey, not by display name: `computeAllSlotLevels` has always
  // returned `category:internalName`, so a display-name lookup missed on every
  // power and every printed slot fell back to its power's pick level (issues-6).
  const levels = slotLevels.get(powerKey(category, power.internalName));

  const slots = power.slots
    .map((enh, idx) => {
      if (!enh) return null;
      // `?` is a slot the schedule could not place. Printing the pick level in
      // its place is what made the fabrication invisible.
      const level = levels?.[idx];
      const slotLevel = level === null || level === undefined ? '?' : level;
      return `<div class="slot"><span class="slot-level">(${slotLevel})</span> ${formatEnhancementName(enh)}</div>`;
    })
    .filter(Boolean)
    .join('');

  const emptySlots = power.slots.filter((s) => s === null).length;
  const emptyStr = emptySlots > 0 && power.slots.some(s => s !== null)
    ? `<div class="slot empty">${emptySlots} empty slot${emptySlots > 1 ? 's' : ''}</div>`
    : '';

  return `
    <div class="power">
      <div class="power-header">
        <span class="power-level">L${power.level}</span>
        <span class="power-name">${esc(power.name)}</span>
        <span class="power-type">${esc(power.powerType)}</span>
      </div>
      ${slots || emptyStr ? `<div class="slots">${slots}${emptyStr}</div>` : ''}
    </div>`;
}

function powersetSection(
  title: string,
  powers: SelectedPower[],
  category: PowerCategory,
  slotLevels: Map<string, SlotLevel[]>
): string {
  if (powers.length === 0) return '';
  const sorted = [...powers].sort((a, b) => a.level - b.level);
  return `
    <div class="powerset">
      <h2>${esc(title)}</h2>
      ${sorted.map((p) => powerRow(p, category, slotLevels)).join('')}
    </div>`;
}

// ============================================
// INCARNATE SECTION
// ============================================

function buildIncarnateHTML(incarnates: IncarnateBuildState | undefined): string {
  if (!incarnates) return '';

  const filled = INCARNATE_SLOT_ORDER.filter((id) => incarnates[id] !== null);
  if (filled.length === 0) return '';

  const rows = INCARNATE_SLOT_ORDER.map((id) => {
    const power = incarnates[id];
    if (!power) return '';
    const tierLabel = power.tier === 'veryrare' ? 'Very Rare' :
      power.tier.charAt(0).toUpperCase() + power.tier.slice(1);
    return `
      <div class="incarnate-row">
        <span class="incarnate-slot">${esc(SLOT_LABELS[id] || id)}</span>
        <span class="incarnate-name">${esc(power.displayName)}</span>
        <span class="incarnate-tree">${esc(power.treeName)}</span>
        <span class="incarnate-tier">${esc(tierLabel)}</span>
      </div>`;
  }).join('');

  return `
    <div class="powerset">
      <h2>Incarnate Powers</h2>
      ${rows}
    </div>`;
}

// ============================================
// MAIN GENERATOR
// ============================================

export function generatePrintHTML(build: Build, levelUpMode: boolean): string {
  const result = calculateCharacterTotals(build);
  const g = result.globalBonuses;
  // Outside Level Up mode a slot carries no real level (issues-3); this is a
  // synthetic, schedule-legal placement for the printed sheet, not a claim
  // about the build's actual leveling history.
  const slotLevels = computeExportSlotLevels(build, levelUpMode);

  // Build all powerset sections as individual blocks for the column flow
  const allPowersetSections: string[] = [];
  allPowersetSections.push(powersetSection(build.primary.name, build.primary.powers, 'primary', slotLevels));
  allPowersetSections.push(powersetSection(build.secondary.name, build.secondary.powers, 'secondary', slotLevels));
  for (const pool of build.pools) {
    allPowersetSections.push(powersetSection(pool.name, pool.powers, 'pool', slotLevels));
  }
  if (build.epicPool) {
    allPowersetSections.push(powersetSection(build.epicPool.name, build.epicPool.powers, 'epic', slotLevels));
  }
  if (build.inherents && build.inherents.length > 0) {
    const slottedInherents = build.inherents.filter(p => p.slots.some(s => s !== null));
    allPowersetSections.push(powersetSection('Inherent Powers', slottedInherents, 'inherent', slotLevels));
  }
  const incarnateSection = buildIncarnateHTML(build.incarnates);
  if (incarnateSection) allPowersetSections.push(incarnateSection);

  const powerSectionsHTML = allPowersetSections.filter(Boolean).join('');

  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(build.name || 'Build')} - ${esc(build.archetype.name)}</title>
<style>
  @page { margin: 0.5in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 11px;
    line-height: 1.4;
    color: #1a1a1a;
    max-width: 7.5in;
    margin: 0 auto;
    padding: 0.25in;
  }

  /* Header */
  .header {
    border-bottom: 2px solid #333;
    padding-bottom: 6px;
    margin-bottom: 8px;
  }
  .header h1 {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 1px;
  }
  .header .subtitle {
    font-size: 12px;
    color: #555;
  }
  .header .meta {
    font-size: 9px;
    color: #888;
    margin-top: 2px;
  }

  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    margin-bottom: 10px;
    padding: 6px;
    background: #f8f8f8;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  .stat-group h3 {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #444;
    border-bottom: 1px solid #ccc;
    padding-bottom: 1px;
    margin-bottom: 2px;
  }
  .stat-group table { width: 100%; border-collapse: collapse; }
  .stat-group td { padding: 0; font-size: 9px; line-height: 1.3; }
  .stat-group td.val { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }

  /* Power Sections - CSS columns for balanced flow */
  .powers-flow {
    column-count: 2;
    column-gap: 16px;
  }
  .powerset {
    margin-bottom: 8px;
    break-inside: avoid-column;
  }
  .powerset h2 {
    font-size: 12px;
    font-weight: 700;
    color: #333;
    border-bottom: 1px solid #999;
    padding-bottom: 1px;
    margin-bottom: 3px;
  }
  .power {
    margin-bottom: 3px;
    break-inside: avoid;
  }
  .power-header {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .power-level {
    font-size: 9px;
    font-weight: 700;
    color: #666;
    min-width: 22px;
  }
  .power-name {
    font-weight: 600;
    font-size: 10px;
  }
  .power-type {
    font-size: 8px;
    color: #888;
    font-style: italic;
  }
  .slots {
    margin-left: 27px;
    margin-top: 1px;
    margin-bottom: 2px;
  }
  .slot {
    font-size: 9px;
    color: #555;
    line-height: 1.25;
  }
  .slot .slot-level {
    color: #999;
    font-size: 8px;
  }
  .slot.empty {
    color: #aaa;
    font-style: italic;
  }

  /* Incarnate */
  .incarnate-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 1px 0;
  }
  .incarnate-slot {
    font-size: 9px;
    font-weight: 700;
    color: #666;
    min-width: 55px;
  }
  .incarnate-name {
    font-weight: 600;
    font-size: 10px;
  }
  .incarnate-tree {
    font-size: 9px;
    color: #555;
  }
  .incarnate-tier {
    font-size: 8px;
    color: #888;
    font-style: italic;
  }

  /* Footer */
  .footer {
    margin-top: 8px;
    padding-top: 4px;
    border-top: 1px solid #ccc;
    font-size: 8px;
    color: #aaa;
    text-align: center;
  }

  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>${esc(build.name || 'Unnamed Build')}</h1>
    <div class="subtitle">
      Level ${build.level} ${esc(build.archetype.name)}
      &mdash; ${esc(build.settings.origin)}
      &mdash; ${esc(build.primary.name)} / ${esc(build.secondary.name)}
    </div>
    <div class="meta">Generated ${esc(date)} by Sidekick (coh-sidekick.com)</div>
  </div>

  ${buildStatsHTML(g)}

  <div class="powers-flow">
    ${powerSectionsHTML}
  </div>

  <div class="footer">
    Sidekick &mdash; coh-sidekick.com
  </div>

  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;
}

/**
 * Open the print HTML in a new browser tab
 */
export function openPrintView(build: Build, levelUpMode: boolean): void {
  const html = generatePrintHTML(build, levelUpMode);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Clean up after a delay to let the tab load
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
