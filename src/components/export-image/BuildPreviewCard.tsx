/**
 * BuildPreviewCard — the compact 1200x880 card rasterized into a build's
 * social share-preview image. Distinct from BuildImageCard (the full "Export
 * as Image" poster): fixed size, and each power reduced to its icon plus its
 * slotted enhancements — no power names, no enhancement names, no per-slot
 * values, none of which survive embed scale.
 *
 * Everything here is sized against a ~400px render, not the 1200px source:
 * Discord scales the og:image to roughly a third of its width in a desktop
 * channel, so a 20px label is 6px on screen. Three rounds of this template
 * shipped type that was fine at full res and unreadable in the embed, and the
 * lesson they converged on is in
 * streams/BUILD_PREVIEW_IMAGE_PLAN.md: content density is the lever, not type
 * size — the way to make one atom bigger is to remove another.
 *
 * v6 is the first round that buys density back rather than spending it, on a
 * user's suggestion. Two changes carry it:
 *
 *   - **Def/res as a bar matrix, not tiles.** A bar carries its value in
 *     length, which survives the downscale that four-digit type does not, so
 *     all nineteen defense/resistance values now fit in less card than v5's
 *     six tiles spent on six numbers (see `preview-defres-bars.ts`).
 *   - **Powers in Mids order, 8 to a column.** A build is at most 24 picks, so
 *     three columns of eight is exact — no wrapping, no overflow case, and the
 *     column break lands on a pick boundary. Reading down a column gives level
 *     order, so the card shows what was taken AND when. This is what pays for
 *     the grid: laying each power's slots out horizontally beside its icon,
 *     rather than stacked underneath as v5 did, cuts a row from ~131px to
 *     ~50px. The two changes are a package — the grid does not fit without it.
 *
 * 880 tall rather than the 1.91:1 (1200x630) OG convention: Discord fits an
 * embed image to a fixed width and lets it run taller, so height past 630 is
 * free room that costs no legibility. Past roughly 4:3 (1200x900) it starts
 * fitting to HEIGHT instead and the card renders narrower — which shrinks the
 * type — so 880 sits just under that turn. The wider web still assumes 1.91:1:
 * a platform that crops to it (Twitter/X's summary_large_image) will trim the
 * title and footer bands. Discord is what this card is for.
 *
 * Pure and prop-driven, same shape as BuildImageCard: takes the build and the
 * already-computed detailed-totals sections, no calculation of its own.
 */

import { forwardRef } from 'react';
import { DEFAULT_BUILD_NAME } from '@/types/build';
import type { Build } from '@/types/build';
import { getPowerIconPath } from '@/data';
import { resolvePath } from '@/utils/paths';
import type { StatSection, StatRow } from '@/utils/detailed-totals';
import type { StatValue } from '@/data/stat-definitions';
import { getHeadlineStats } from '@/utils/preview-headline-stats';
import { getBuildPowers, getSlottedInherents } from '@/utils/build-powers';
import { getDefResMatrix, barGeometry, type DefResBar } from '@/utils/preview-defres-bars';
import type { SelectedPower } from '@/types/power';
import type { Enhancement } from '@/types/enhancement';
import { SlottedEnhancementIcon } from '@/components/powers/SlottedEnhancementIcon';

export const PREVIEW_CARD_WIDTH = 1200;
export const PREVIEW_CARD_HEIGHT = 880;

/**
 * Bump this whenever this file's visual template changes (layout, type
 * scale, content shown) — it's how a build's stored `preview_template_version`
 * is judged stale and due for regeneration (see
 * streams/BUILD_PREVIEW_BACKFILL_PLAN.md, build-preview-backfill-1). Duplicated in every
 * edge function that writes `preview_template_version`
 * (supabase/functions/share-build, supabase/functions/backfill-preview) —
 * Deno functions can't import frontend TS, so update every copy by hand.
 */
export const CURRENT_PREVIEW_TEMPLATE_VERSION = 6;

/**
 * Preview-only value formatting, by stat id, where the dashboard's own format
 * is too long for a tile at this scale. Reads the same `stat.value` the
 * dashboard does — this picks a shorter rendering of that number, it does not
 * recompute it.
 *
 * `regeneration` is here because its dashboard format is `12.24/s (+128%)`,
 * which overruns the tile and spills into its neighbour (found live in a
 * posted Discord embed). `recharge` because two decimals of a Mids-style
 * `132.50%` is a digit of precision nobody reads at a third of full size.
 */
const PREVIEW_VALUE_FORMAT: Record<string, (v: StatValue) => string> = {
  regeneration: (v) =>
    typeof v === 'object' && v !== null && 'perSec' in v
      ? `${(v as { perSec: number }).perSec.toFixed(2)}/s`
      : String(v),
  recharge: (v) => `${(100 + Number(v)).toFixed(1)}%`,
};

function formatStat(stat: StatRow): string {
  return (PREVIEW_VALUE_FORMAT[stat.id] ?? stat.format)(stat.value);
}

interface BuildPreviewCardProps {
  build: Build;
  allStats: StatSection[];
  /** globalBonuses.netEndPerSec — not in `allStats` (computeAllStats scopes to
   *  DETAILED_STATS, which excludes it; see preview-headline-stats.ts). */
  netEndPerSec: number;
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-800/70 border border-slate-700 px-3 py-1 text-center">
      <div className="text-[22px] text-slate-400 uppercase tracking-wide truncate leading-tight">{label}</div>
      <div className={`text-[38px] font-semibold tabular-nums truncate leading-tight ${color}`}>{value}</div>
    </div>
  );
}

/**
 * One hue per block, so defense and resistance separate at a glance rather
 * than by reading their headings — at a third of full size the headings are
 * the first thing to go, and the shape of each block is what survives.
 */
interface BarHue {
  fill: string;
  capped: string;
}
const DEFENSE_HUE: BarHue = { fill: 'bg-cyan-400', capped: 'bg-cyan-200' };
const RESIST_HUE: BarHue = { fill: 'bg-amber-500', capped: 'bg-amber-300' };

const BAR_TRACK_PX = 100;
const BAR_HEIGHT_PX = 14;

/**
 * One def/res value: its initial, then a track whose FILL is the value.
 *
 * A soft-capped track runs wider than the cap and carries a tick at it, so a
 * build sitting on the softcap and a build well past it don't render as the
 * same full bar — defense past the softcap is real and load-bearing, and the
 * card would otherwise misreport the stat this audience reads first. A hard
 * cap gets no tick: the engine already clamped, so the track's end IS the cap.
 *
 * The tick is 2px of near-white rather than a hairline: at embed scale a 1px
 * 40%-opacity rule disappears entirely, which would take the softcap reading
 * with it.
 */
function Bar({ bar, hue }: { bar: DefResBar; hue: BarHue }) {
  const { fill, tick, atCap } = barGeometry(bar);
  return (
    <div className="flex items-center gap-1.5" title={`${bar.label} ${bar.value.toFixed(1)}%`}>
      <span className="text-[20px] text-slate-400 tabular-nums leading-none w-[16px] text-right">{bar.letter}</span>
      <div
        className="relative rounded-sm bg-slate-800 border border-slate-700 overflow-hidden"
        style={{ width: BAR_TRACK_PX, height: BAR_HEIGHT_PX }}
      >
        <div
          className={`absolute inset-y-0 left-0 ${atCap ? hue.capped : hue.fill}`}
          style={{ width: `${fill * 100}%` }}
        />
        {tick !== null && (
          <div className="absolute inset-y-0 w-[2px] bg-slate-200" style={{ left: `${tick * 100}%` }} />
        )}
      </div>
    </div>
  );
}

/** One labelled block of bars, laid out in `cols` columns filling down. */
function BarBlock({ title, bars, cols, hue }: { title: string; bars: DefResBar[]; cols: number; hue: BarHue }) {
  if (bars.length === 0) return null;
  return (
    <div>
      <div className="text-[18px] text-slate-500 uppercase tracking-wider mb-1">{title}</div>
      <div
        className="grid gap-x-3 gap-y-1"
        style={{
          gridTemplateColumns: `repeat(${cols}, max-content)`,
          gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${Math.ceil(bars.length / cols)}, min-content)`,
        }}
      >
        {bars.map((bar) => (
          <Bar key={bar.id} bar={bar} hue={hue} />
        ))}
      </div>
    </div>
  );
}

const POWER_ICON_PX = 46;
const SLOT_ICON_PX = 40;
const POWERS_PER_COLUMN = 8;

/**
 * One power as one row: its icon, then its slots inline to the right.
 *
 * Horizontal rather than v5's stacked icon-over-slots, and that is what makes
 * the 8x3 grid fit at all — stacking cost ~131px of height per power against
 * ~50px here, and eight stacked rows overrun the whole card. The slot art
 * under public/img/Enhancements is natively 30x30, so 36 is a mild upscale
 * spent on width the three-column layout has to spare; it costs no row height,
 * which is the dimension actually under pressure.
 *
 * Empty slots still draw as rings: a six-slotted power and a one-slotted one
 * must not read the same, and the ring is what carries "this pick has slots
 * left in it".
 */
function PowerRow({ power }: { power: SelectedPower }) {
  const slots: (Enhancement | null)[] = power.slots ?? [];
  return (
    <div className="flex items-center gap-2 shrink-0">
      <img
        src={getPowerIconPath(power.icon)}
        alt=""
        title={`${power.name} (level ${power.level})`}
        className="rounded-lg shrink-0"
        style={{ width: POWER_ICON_PX, height: POWER_ICON_PX }}
        onError={(e) => {
          (e.target as HTMLImageElement).src = resolvePath('/img/Unknown.png');
        }}
      />
      <div className="flex gap-[3px]">
        {slots.map((slot, i) =>
          slot ? (
            <SlottedEnhancementIcon key={i} enhancement={slot} size={SLOT_ICON_PX} />
          ) : (
            <span
              key={i}
              className="inline-block rounded-full border border-slate-700 bg-slate-800/60"
              style={{ width: SLOT_ICON_PX, height: SLOT_ICON_PX }}
            />
          ),
        )}
      </div>
    </div>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const BuildPreviewCard = forwardRef<HTMLDivElement, BuildPreviewCardProps>(function BuildPreviewCard(
  { build, allStats, netEndPerSec },
  ref,
) {
  const at = build.archetype?.name || 'Unknown AT';
  const pri = build.primary?.name;
  const sec = build.secondary?.name;
  const combo = [pri, sec].filter(Boolean).join(' / ');
  const headline = getHeadlineStats(allStats);
  const matrix = getDefResMatrix(allStats);
  // Mids-order pick list: level-sorted, auto-granted sub-powers excluded, so
  // the count is the build's 24-pick budget and three columns of eight is
  // exact. Reading down a column is reading up the levels.
  const columns = chunk(getBuildPowers(build), POWERS_PER_COLUMN);
  // Inherents are worth a row only once something is slotted in them — which
  // on a real build means Health, Stamina and a slotted Brawl. Selected by
  // that property rather than by name: a build that put a Celerity in Sprint
  // should show it, and Rule 0 forbids the power names in a conditional here
  // anyway.
  const inherents = getSlottedInherents(build);
  const netEndLabel = `${netEndPerSec >= 0 ? '+' : ''}${netEndPerSec.toFixed(2)}/s`;
  const netEndColor = netEndPerSec < 0 ? 'text-red-400' : 'text-emerald-300';

  return (
    <div
      ref={ref}
      className="bg-gray-950 text-gray-100 p-7 flex flex-col overflow-hidden"
      style={{
        width: PREVIEW_CARD_WIDTH,
        height: PREVIEW_CARD_HEIGHT,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-slate-700 pb-2">
        <div className="min-w-0">
          <div className="text-[48px] font-bold text-slate-50 leading-tight truncate">
            {build.name || DEFAULT_BUILD_NAME}
          </div>
          <div className="text-[26px] text-cyan-300 leading-tight">
            {at}
            {combo && <span className="text-slate-400"> — {combo}</span>}
          </div>
        </div>
        <div className="text-right text-[24px] text-slate-300 shrink-0">Level {build.level}</div>
      </div>

      {/* Stat band — the bar matrix carries every def/res value, the tiles
          carry the four numbers that have no ceiling to scale a bar against. */}
      <div className="flex items-start justify-between gap-6 mt-2">
        <div className="flex items-start gap-6">
          <BarBlock title="Defense" bars={matrix.typedDefense} cols={2} hue={DEFENSE_HUE} />
          <BarBlock title="Position" bars={matrix.positionalDefense} cols={1} hue={DEFENSE_HUE} />
          <BarBlock title="Resist" bars={matrix.resistance} cols={2} hue={RESIST_HUE} />
        </div>
        <div className="grid grid-cols-2 gap-2 w-[400px] shrink-0">
          {headline.map((stat) => (
            <StatTile key={stat.id} label={stat.label} value={formatStat(stat)} color={stat.color} />
          ))}
          <StatTile label="Net End" value={netEndLabel} color={netEndColor} />
        </div>
      </div>

      {/* Powers in pick order, 8 to a column. A build under level 50 simply
          fills fewer rows; overflow-hidden is a backstop, not the layout. */}
      <div className="mt-3 flex-1 min-h-0 overflow-hidden flex justify-between gap-4">
        {columns.map((column, ci) => (
          <div key={ci} className="flex flex-col gap-1.5">
            {column.map((power) => (
              <PowerRow key={`${power.powerSet}:${power.internalName}`} power={power} />
            ))}
          </div>
        ))}
      </div>

      {inherents.length > 0 && (
        <div className="flex items-center gap-4 pt-2 border-t border-slate-800">
          <span className="text-[18px] text-slate-500 uppercase tracking-wider shrink-0">Inherent</span>
          <div className="flex gap-4 overflow-hidden">
            {inherents.map((power) => (
              <PowerRow key={`inherent:${power.internalName}`} power={power} />
            ))}
          </div>
        </div>
      )}

      <div className="pt-1.5 mt-1.5 border-t border-slate-800 text-[20px] text-slate-500">
        coh-sidekick.com
      </div>
    </div>
  );
});
