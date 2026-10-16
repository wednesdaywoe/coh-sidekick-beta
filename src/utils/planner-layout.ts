/**
 * planner-layout — pure helpers for the rearrangeable-layout-11 2D planner dock grid.
 *
 * The persisted layout slice (`uiStore.plannerLayout[view]`) is a *flat*
 * `PlannerSectionConfig[]`. The 2D layout is derived, not stored:
 *   • horizontal grouping/order  ← each entry's `column` value (ascending)
 *   • vertical order within a column ← array order (top → bottom)
 *
 * These helpers convert between the flat list and a columns-of-rows view, and
 * apply the two mutations the UI needs (drag-drop stacking/reordering, and the
 * menu's stepwise column shift). Every mutation renormalizes `column` to a dense
 * 0..N-1 range and re-emits the array in column-major order, so the flat list a
 * mutation returns is always canonical.
 *
 * Kept pure + dependency-free so the store's `merge()` migration, the page, and
 * the layout menu all share one source of truth (and it's unit-testable).
 */

import type { PlannerSectionConfig, PlannerSectionId } from '@/types';

/** Where a dragged section lands relative to the cell it's dropped on. */
export type DropZone = 'above' | 'below' | 'colBefore' | 'colAfter';

/** Section ids introduced by the atomic-section split (goal 2): `epic` + the
 *  four `inherent-*` groups, which replaced the combined `pool`/`inherent`
 *  columns. Used to tell a post-split saved layout from a pre-split one. */
const ATOMIC_SPLIT_SECTION_IDS = new Set<string>([
  'epic',
  'inherent-fitness',
  'inherent-basic',
  'inherent-prestige',
  'inherent-archetype',
]);

/**
 * True when a persisted *category* layout predates the atomic-section split — it
 * has entries but references none of the new atomic ids. Such a layout must be
 * migrated wholesale to the current default: the normal append-missing reconcile
 * would scatter the five new sections into their own trailing columns (the
 * "every cell its own column" regression on upgrade). A post-split layout has at
 * least one atomic id and reconciles normally, preserving user customization.
 */
export function isPreAtomicSplitCategory(saved: { id: string }[]): boolean {
  return saved.length > 0 && !saved.some((s) => ATOMIC_SPLIT_SECTION_IDS.has(s.id));
}

/**
 * Group a flat section list into columns of stacked rows. Columns come out
 * ordered left-to-right (ascending `column`); rows within a column keep the
 * flat list's order (top → bottom). A missing `column` falls back to the
 * entry's array index, so an un-normalized list degrades to one-section-per-
 * column rather than silently stacking everything into column 0.
 */
export function toColumns(sections: PlannerSectionConfig[]): PlannerSectionConfig[][] {
  const byColumn = new Map<number, PlannerSectionConfig[]>();
  sections.forEach((section, index) => {
    const col = section.column ?? index;
    const rows = byColumn.get(col);
    if (rows) rows.push(section);
    else byColumn.set(col, [section]);
  });
  return [...byColumn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, rows]) => rows);
}

/**
 * Flatten a columns-of-rows structure back to the canonical flat list: dense
 * `column` indices (0..N-1) and column-major array order. Preserves every other
 * field on each config.
 */
export function fromColumns(columns: PlannerSectionConfig[][]): PlannerSectionConfig[] {
  const out: PlannerSectionConfig[] = [];
  columns.forEach((rows, columnIndex) => {
    rows.forEach((section) => out.push({ ...section, column: columnIndex }));
  });
  return out;
}

/**
 * Apply a drag-drop: move `dragId` to land at `targetId` per `zone`.
 *   above/below  → stack into the target's column, just before/after it
 *   colBefore/After → become its own new column to the left/right of target's
 * Returns a fresh canonical list (dense columns, column-major order). When
 * stacking (above/below), the whole receiving column's `rowWeight`s are cleared
 * so the column re-defaults to content-based sizing (each cell as tall as its
 * contents) rather than inheriting a stale manual split — the requested UX.
 */
export function applyDrop(
  sections: PlannerSectionConfig[],
  dragId: PlannerSectionId,
  targetId: PlannerSectionId,
  zone: DropZone,
): PlannerSectionConfig[] {
  if (dragId === targetId) return sections;

  const columns = toColumns(sections).map((rows) => [...rows]);

  // Pull the dragged section out of wherever it currently lives.
  let dragged: PlannerSectionConfig | undefined;
  for (const rows of columns) {
    const idx = rows.findIndex((s) => s.id === dragId);
    if (idx !== -1) {
      dragged = { ...rows.splice(idx, 1)[0], rowWeight: undefined };
      break;
    }
  }
  if (!dragged) return sections;

  const pruned = columns.filter((rows) => rows.length > 0);

  // Locate the drop target in the post-removal structure.
  let targetCol = -1;
  let targetRow = -1;
  for (let c = 0; c < pruned.length; c++) {
    const r = pruned[c].findIndex((s) => s.id === targetId);
    if (r !== -1) {
      targetCol = c;
      targetRow = r;
      break;
    }
  }
  if (targetCol === -1) return sections;

  if (zone === 'above' || zone === 'below') {
    pruned[targetCol].splice(zone === 'above' ? targetRow : targetRow + 1, 0, dragged);
    // Stacking changed the column's makeup — drop any manual split so it re-lays
    // out content-first (see doc comment). Keeps a column's cells all-or-nothing
    // on `rowWeight`, so the render never mixes content- and weight-driven cells.
    pruned[targetCol] = pruned[targetCol].map((s) => ({ ...s, rowWeight: undefined }));
  } else if (zone === 'colBefore') pruned.splice(targetCol, 0, [dragged]);
  else pruned.splice(targetCol + 1, 0, [dragged]);

  return fromColumns(pruned);
}

/**
 * Menu fallback: move the section one column left (`dir = -1`) or right
 * (`dir = 1`), popping it into its own single-section column. (Creating stacks
 * is a drag-only gesture; the menu handles horizontal ordering + show/hide.)
 */
export function shiftColumn(
  sections: PlannerSectionConfig[],
  id: PlannerSectionId,
  dir: -1 | 1,
): PlannerSectionConfig[] {
  const columns = toColumns(sections);
  const currentCol = columns.findIndex((rows) => rows.some((s) => s.id === id));
  if (currentCol === -1) return sections;

  const section = columns[currentCol].find((s) => s.id === id)!;
  const remaining = columns
    .map((rows) => rows.filter((s) => s.id !== id))
    .filter((rows) => rows.length > 0);

  const insertAt = Math.max(0, Math.min(remaining.length, currentCol + dir));
  remaining.splice(insertAt, 0, [{ ...section, rowWeight: undefined }]);
  return fromColumns(remaining);
}

/**
 * `merge()` reconcile: fold the sections kept from persisted state together with
 * the default sections newly appended (ids added since the user last saved),
 * producing a canonical flat list. Legacy entries without a `column` backfill to
 * their array index (reproducing the historical one-column-per-section row);
 * appended sections land in fresh trailing columns.
 */
export function reconcilePlannerColumns(
  kept: PlannerSectionConfig[],
  missing: PlannerSectionConfig[],
): PlannerSectionConfig[] {
  const keptFixed = kept.map((s, i) => ({ ...s, column: s.column ?? i }));
  const maxColumn = keptFixed.reduce((max, s) => Math.max(max, s.column ?? 0), -1);
  const missingFixed = missing.map((s, i) => ({ ...s, column: maxColumn + 1 + i }));
  return fromColumns(toColumns([...keptFixed, ...missingFixed]));
}
