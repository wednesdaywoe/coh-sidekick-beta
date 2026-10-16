/**
 * Forum-friendly build export — generates a human-readable summary of a
 * build in BBCode, Markdown, or Plain Text. Modelled on Mids Reborn's
 * Forum Post format so the output reads natively in any CoH community
 * forum thread, subreddit, or Discord post.
 *
 * Three output formats:
 *   - 'plain'    — no markup (works everywhere; safest paste)
 *   - 'bbcode'   — phpBB / vBulletin style ([b], [i], [list], [hr])
 *   - 'markdown' — CommonMark (Reddit, Discord, modern forums)
 *
 * Short link generation is the caller's responsibility — this module
 * only formats the build body so the modal can present "Copy Text" and
 * "Copy Short Link" as separate clipboard actions.
 */
import type { Build, SelectedPower, Enhancement } from '@/types';
import { INCARNATE_SLOT_ORDER } from '@/types';
import { computeExportSlotLevels } from '@/utils/slot-levels';
import { powerKey, type PowerCategory } from '@/utils/power-key';
import { getIOSet } from '@/data';

export type ForumExportFormat = 'plain' | 'bbcode' | 'markdown';

export interface ForumExportOptions {
  includeIncarnates?: boolean;
  includeSetBonuses?: boolean;
}

/**
 * Generate a forum-ready build summary string in the requested format.
 */
export function generateForumExport(
  build: Build,
  format: ForumExportFormat,
  levelUpMode: boolean,
  options: ForumExportOptions = {},
): string {
  const { includeIncarnates = true, includeSetBonuses = true } = options;
  const fmt = formatter(format);
  // Outside Level Up mode a slot carries no real level (issues-3); this is a
  // synthetic, schedule-legal placement for the printed text, not a claim
  // about the build's actual leveling history.
  const slotLevels = computeExportSlotLevels(build, levelUpMode);

  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────
  const archetypeName = build.archetype.name || 'Hero';
  const buildName = build.name?.trim();
  if (buildName) lines.push(fmt.heading(buildName));
  lines.push(fmt.heading(`Level ${build.level} ${archetypeName}`));
  lines.push(fmt.italic('Build plan made with CoH Sidekick'));
  lines.push('');

  // ── Powersets ──────────────────────────────────────────────────
  if (build.primary.name) {
    lines.push(`${fmt.bold('Primary Powerset:')} ${build.primary.name}`);
  }
  if (build.secondary.name) {
    lines.push(`${fmt.bold('Secondary Powerset:')} ${build.secondary.name}`);
  }
  build.pools.forEach((pool, idx) => {
    if (pool.name) {
      lines.push(`${fmt.bold(`Pool Powerset (#${idx + 1}):`)} ${pool.name}`);
    }
  });
  if (build.epicPool?.name) {
    lines.push(`${fmt.bold('Epic Powerset:')} ${build.epicPool.name}`);
  }
  lines.push('');
  lines.push(fmt.hr());
  lines.push('');

  // ── Powers ─────────────────────────────────────────────────────
  lines.push(fmt.bold('Powers Taken:'));
  lines.push('');

  // Category travels with the power: `computeAllSlotLevels` keys on
  // `category:internalName`, and looking it up by display name missed on every
  // power, so every exported slot printed its power's pick level (issues-6).
  const allPowers: { power: SelectedPower; category: PowerCategory }[] = [
    ...build.primary.powers.map((power) => ({ power, category: 'primary' as const })),
    ...build.secondary.powers.map((power) => ({ power, category: 'secondary' as const })),
    ...build.pools.flatMap((p) => p.powers.map((power) => ({ power, category: 'pool' as const }))),
    ...(build.epicPool?.powers ?? []).map((power) => ({ power, category: 'epic' as const })),
    ...(build.inherents ?? [])
      .filter((p) => p.slots.some((s) => s !== null))
      .map((power) => ({ power, category: 'inherent' as const })),
  ];
  const ordered = [...allPowers].sort((a, b) => a.power.level - b.power.level);

  for (const { power, category } of ordered) {
    lines.push(fmt.bold(`Level ${power.level}: ${power.name}`));
    const levels = slotLevels.get(powerKey(category, power.internalName)) ?? [];
    const slotItems: string[] = [];
    power.slots.forEach((enh, idx) => {
      if (!enh) return;
      // First slot uses 'A' (the auto-grant); subsequent slots show their
      // taken-level. Matches Mids' convention so paste-readers parse it. A slot
      // the schedule could not place prints '?' rather than a stand-in level.
      const level = levels[idx];
      const slotPrefix =
        idx === 0 ? 'A' : level === null || level === undefined ? '?' : String(level);
      slotItems.push(`${slotPrefix}: ${formatEnhancementName(enh)}`);
    });
    if (slotItems.length > 0) {
      lines.push(...fmt.list(slotItems));
    }
    lines.push('');
  }

  // ── Set bonuses ────────────────────────────────────────────────
  if (includeSetBonuses) {
    const setSummary = summarizeSetBonuses(allPowers.map((p) => p.power));
    if (setSummary.length > 0) {
      lines.push(fmt.hr());
      lines.push('');
      lines.push(fmt.bold('Set Bonuses:'));
      lines.push('');
      for (const entry of setSummary) {
        lines.push(fmt.bold(`${entry.setName} (${entry.pieceCount} pieces in ${entry.powerName})`));
        if (entry.bonuses.length > 0) {
          lines.push(...fmt.list(entry.bonuses));
        }
        lines.push('');
      }
    }
  }

  // ── Incarnates ─────────────────────────────────────────────────
  if (includeIncarnates && build.incarnates) {
    const incarnateLines: string[] = [];
    for (const slot of INCARNATE_SLOT_ORDER) {
      const pick = build.incarnates[slot];
      if (!pick) continue;
      const tierLabel =
        pick.tier === 'veryrare' ? 'T4' :
        pick.tier === 'rare' ? 'T3' :
        pick.tier === 'uncommon' ? 'T2' : 'T1';
      const slotName = slot.charAt(0).toUpperCase() + slot.slice(1);
      incarnateLines.push(`${fmt.bold(`${slotName}:`)} ${pick.displayName} (${tierLabel})`);
    }
    if (incarnateLines.length > 0) {
      lines.push(fmt.hr());
      lines.push('');
      lines.push(fmt.bold('Incarnates:'));
      lines.push('');
      lines.push(...incarnateLines);
      lines.push('');
    }
  }

  // Collapse trailing blank lines and ensure a single trailing newline.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────
// Formatters (one per output format)
// ─────────────────────────────────────────────────────────────────

interface Formatter {
  bold(s: string): string;
  italic(s: string): string;
  heading(s: string): string;
  hr(): string;
  /** Render a list. Returns the lines to push (so BBCode can wrap [list]/[/list]). */
  list(items: string[]): string[];
}

const plainFormatter: Formatter = {
  bold: (s) => s,
  italic: (s) => s,
  heading: (s) => s,
  hr: () => '----------------------------------------',
  list: (items) => items.map((i) => `  ${i}`),
};

const bbcodeFormatter: Formatter = {
  bold: (s) => `[b]${s}[/b]`,
  italic: (s) => `[i]${s}[/i]`,
  heading: (s) => `[b]${s}[/b]`,
  hr: () => '[hr]',
  list: (items) => ['[list]', ...items.map((i) => `[*]${i}`), '[/list]'],
};

const markdownFormatter: Formatter = {
  bold: (s) => `**${s}**`,
  italic: (s) => `*${s}*`,
  heading: (s) => `**${s}**`,
  hr: () => '---',
  list: (items) => items.map((i) => `- ${i}`),
};

function formatter(format: ForumExportFormat): Formatter {
  switch (format) {
    case 'bbcode':   return bbcodeFormatter;
    case 'markdown': return markdownFormatter;
    default:         return plainFormatter;
  }
}

// ─────────────────────────────────────────────────────────────────
// Enhancement name rendering
// ─────────────────────────────────────────────────────────────────

/** Signed level offset suffix, or '' when the slot sits at even/unboosted. */
function levelOffsetSuffix(offset?: number): string {
  if (!offset) return '';
  return offset > 0 ? `+${offset}` : `${offset}`;
}

function formatEnhancementName(enh: Enhancement): string {
  switch (enh.type) {
    case 'io-set': {
      const level = enh.attuned ? '∞' : enh.level ?? 50;
      return `${enh.setName}: ${enh.name} (${level}${levelOffsetSuffix(enh.boost)})`;
    }
    case 'io-generic':
      return `${enh.name} (${enh.level ?? 50})`;
    // Origin and special enhancements carry a RELATIVE level, and an exported
    // build that omits it reads as a full-strength one. A -3 SO is worth x0.70
    // on Homecoming, so the reader needs to see it.
    case 'origin':
      return `${enh.name}${levelOffsetSuffix(enh.boost) && ` (${levelOffsetSuffix(enh.boost)})`}`;
    case 'special':
      return `${enh.name}${levelOffsetSuffix(enh.boost) && ` (${levelOffsetSuffix(enh.boost)})`}`;
  }
}

// ─────────────────────────────────────────────────────────────────
// Set-bonus summary (per power × set)
// ─────────────────────────────────────────────────────────────────

interface SetBonusEntry {
  powerName: string;
  setName: string;
  pieceCount: number;
  bonuses: string[];
}

function summarizeSetBonuses(allPowers: SelectedPower[]): SetBonusEntry[] {
  const out: SetBonusEntry[] = [];
  for (const power of allPowers) {
    // Count pieces by set within this power.
    const piecesBySet = new Map<string, number>();
    for (const enh of power.slots) {
      if (!enh || enh.type !== 'io-set') continue;
      piecesBySet.set(enh.setId, (piecesBySet.get(enh.setId) ?? 0) + 1);
    }
    for (const [setId, pieceCount] of piecesBySet.entries()) {
      if (pieceCount < 2) continue; // 1-piece doesn't trigger a set bonus
      const setDef = getIOSet(setId);
      if (!setDef) continue;
      const earned = setDef.bonuses.filter((b) => b.pieces <= pieceCount);
      const bonusStrs: string[] = [];
      for (const tier of earned) {
        for (const eff of tier.effects) {
          bonusStrs.push(eff.desc);
        }
      }
      if (bonusStrs.length > 0) {
        out.push({
          powerName: power.name,
          setName: setDef.name,
          pieceCount,
          bonuses: bonusStrs,
        });
      }
    }
  }
  return out;
}
