import { describe, it, expect } from 'vitest';
import type { PlannerSectionConfig } from '@/types';
import {
  toColumns,
  fromColumns,
  applyDrop,
  shiftColumn,
  reconcilePlannerColumns,
  isPreAtomicSplitCategory,
} from './planner-layout';

/** Default-shaped single-row layout: six sections, one per column. */
const singleRow: PlannerSectionConfig[] = [
  { id: 'available', visible: true, column: 0 },
  { id: 'primary', visible: true, column: 1 },
  { id: 'secondary', visible: true, column: 2 },
  { id: 'pool', visible: true, column: 3 },
  { id: 'epic', visible: true, column: 4 },
  { id: 'info', visible: true, column: 5 },
];

const ids = (list: PlannerSectionConfig[]) => list.map((s) => s.id);
const shape = (list: PlannerSectionConfig[]) => toColumns(list).map((rows) => rows.map((r) => r.id));

describe('toColumns / fromColumns', () => {
  it('groups by column ascending, preserving array order within a column', () => {
    const stacked: PlannerSectionConfig[] = [
      { id: 'available', visible: true, column: 0 },
      { id: 'primary', visible: true, column: 1 },
      { id: 'secondary', visible: true, column: 1 },
      { id: 'info', visible: true, column: 2 },
    ];
    expect(shape(stacked)).toEqual([['available'], ['primary', 'secondary'], ['info']]);
  });

  it('falls back to array index when column is missing (no accidental stacking)', () => {
    const legacy: PlannerSectionConfig[] = [
      { id: 'available', visible: true },
      { id: 'primary', visible: true },
    ];
    expect(shape(legacy)).toEqual([['available'], ['primary']]);
  });

  it('fromColumns densifies column indices in column-major order', () => {
    const cols: PlannerSectionConfig[][] = [
      [{ id: 'primary', visible: true, column: 7 }],
      [{ id: 'info', visible: true, column: 9 }, { id: 'available', visible: true, column: 9 }],
    ];
    const flat = fromColumns(cols);
    expect(ids(flat)).toEqual(['primary', 'info', 'available']);
    expect(flat.map((s) => s.column)).toEqual([0, 1, 1]);
  });
});

describe('applyDrop', () => {
  it('stacks below a target into the same column', () => {
    const next = applyDrop(singleRow, 'info', 'primary', 'below');
    // info leaves column 5, joins primary's column under it; columns re-densify.
    expect(shape(next)).toEqual([
      ['available'], ['primary', 'info'], ['secondary'], ['pool'], ['epic'],
    ]);
  });

  it('stacks above a target into the same column', () => {
    const next = applyDrop(singleRow, 'info', 'primary', 'above');
    expect(shape(next)).toEqual([
      ['available'], ['info', 'primary'], ['secondary'], ['pool'], ['epic'],
    ]);
  });

  it('colBefore inserts the dragged section as its own column left of target', () => {
    const next = applyDrop(singleRow, 'info', 'available', 'colBefore');
    expect(shape(next)).toEqual([
      ['info'], ['available'], ['primary'], ['secondary'], ['pool'], ['epic'],
    ]);
  });

  it('colAfter inserts right of target', () => {
    const next = applyDrop(singleRow, 'available', 'info', 'colAfter');
    expect(shape(next)).toEqual([
      ['primary'], ['secondary'], ['pool'], ['epic'], ['info'], ['available'],
    ]);
  });

  it('resets the moved section rowWeight so it starts balanced', () => {
    const withWeight: PlannerSectionConfig[] = [
      { id: 'primary', visible: true, column: 0, rowWeight: 3 },
      { id: 'info', visible: true, column: 1 },
    ];
    const next = applyDrop(withWeight, 'primary', 'info', 'below');
    const moved = next.find((s) => s.id === 'primary')!;
    expect(moved.rowWeight).toBeUndefined();
  });

  it('clears the receiving column rowWeights when stacking (content-first re-layout)', () => {
    // A previously-resized column (primary/secondary carry rowWeights); dropping
    // info into it must reset all three so the column re-sizes to content.
    const resizedStack: PlannerSectionConfig[] = [
      { id: 'primary', visible: true, column: 0, rowWeight: 2 },
      { id: 'secondary', visible: true, column: 0, rowWeight: 1 },
      { id: 'info', visible: true, column: 1 },
    ];
    const next = applyDrop(resizedStack, 'info', 'primary', 'below');
    const col0 = next.filter((s) => s.column === 0);
    expect(col0.map((s) => s.id)).toEqual(['primary', 'info', 'secondary']);
    expect(col0.every((s) => s.rowWeight === undefined)).toBe(true);
  });

  it('leaves rowWeights untouched for a colBefore/colAfter (new-column) drop', () => {
    const resizedStack: PlannerSectionConfig[] = [
      { id: 'primary', visible: true, column: 0, rowWeight: 2 },
      { id: 'secondary', visible: true, column: 0, rowWeight: 1 },
      { id: 'info', visible: true, column: 1 },
    ];
    const next = applyDrop(resizedStack, 'info', 'primary', 'colBefore');
    // primary/secondary stay stacked+weighted; info is its own new column.
    const stayed = next.filter((s) => ['primary', 'secondary'].includes(s.id));
    expect(stayed.map((s) => s.rowWeight)).toEqual([2, 1]);
  });

  it('is a no-op when dragging onto itself', () => {
    expect(applyDrop(singleRow, 'info', 'info', 'below')).toBe(singleRow);
  });

  it('collapses the emptied column (no gaps left behind)', () => {
    // Move the middle section out to stack under info; the vacated column 2
    // collapses so indices stay dense (last column holds the new stack).
    const next = applyDrop(singleRow, 'secondary', 'info', 'below');
    expect(shape(next)).toEqual([
      ['available'], ['primary'], ['pool'], ['epic'], ['info', 'secondary'],
    ]);
    expect(next.map((s) => s.column)).toEqual([0, 1, 2, 3, 4, 4]);
  });
});

describe('shiftColumn', () => {
  it('moves a section one column left', () => {
    const next = shiftColumn(singleRow, 'secondary', -1);
    expect(shape(next)).toEqual([
      ['available'], ['secondary'], ['primary'], ['pool'], ['epic'], ['info'],
    ]);
  });

  it('moves a section one column right', () => {
    const next = shiftColumn(singleRow, 'primary', 1);
    expect(shape(next)).toEqual([
      ['available'], ['secondary'], ['primary'], ['pool'], ['epic'], ['info'],
    ]);
  });

  it('un-stacks: a stacked section pops into its own column', () => {
    const stacked: PlannerSectionConfig[] = [
      { id: 'available', visible: true, column: 0 },
      { id: 'primary', visible: true, column: 1 },
      { id: 'info', visible: true, column: 1 },
    ];
    // info shifted right leaves the shared column and becomes its own.
    const next = shiftColumn(stacked, 'info', 1);
    expect(shape(next)).toEqual([['available'], ['primary'], ['info']]);
  });

  it('clamps at the left edge (harmless no-op reinsert)', () => {
    const next = shiftColumn(singleRow, 'available', -1);
    expect(shape(next)).toEqual(shape(singleRow));
  });
});

describe('reconcilePlannerColumns (merge migration)', () => {
  it('backfills column for legacy (pre-rearrangeable-layout-11) entries, reproducing the single row', () => {
    const legacyKept: PlannerSectionConfig[] = [
      { id: 'available', visible: true },
      { id: 'primary', visible: true },
      { id: 'secondary', visible: false },
    ];
    const out = reconcilePlannerColumns(legacyKept, []);
    expect(out.map((s) => s.column)).toEqual([0, 1, 2]);
    expect(ids(out)).toEqual(['available', 'primary', 'secondary']);
  });

  it('appends new sections in fresh trailing columns', () => {
    const kept: PlannerSectionConfig[] = [
      { id: 'available', visible: true, column: 0 },
      { id: 'primary', visible: true, column: 1 },
    ];
    const missing: PlannerSectionConfig[] = [{ id: 'epic', visible: true, column: 4 }];
    const out = reconcilePlannerColumns(kept, missing);
    expect(shape(out)).toEqual([['available'], ['primary'], ['epic']]);
    expect(out.find((s) => s.id === 'epic')!.column).toBe(2);
  });

  it('preserves an existing stack while appending', () => {
    const kept: PlannerSectionConfig[] = [
      { id: 'available', visible: true, column: 0 },
      { id: 'primary', visible: true, column: 1 },
      { id: 'secondary', visible: true, column: 1 },
    ];
    const missing: PlannerSectionConfig[] = [{ id: 'epic', visible: true, column: 9 }];
    const out = reconcilePlannerColumns(kept, missing);
    expect(shape(out)).toEqual([['available'], ['primary', 'secondary'], ['epic']]);
  });
});

describe('isPreAtomicSplitCategory (upgrade migration guard)', () => {
  it('flags the pre-rearrangeable-layout-8 layout (combined pool, no inherent split)', () => {
    // The oldest shape: pool holds pool+epic+inherent, no atomic ids at all.
    const preLay8 = [
      { id: 'available' }, { id: 'primary' }, { id: 'secondary' },
      { id: 'pool' }, { id: 'info' },
    ];
    expect(isPreAtomicSplitCategory(preLay8)).toBe(true);
  });

  it('flags the rearrangeable-layout-8–12 layout (separate `inherent`, still no atomic ids)', () => {
    const lay8 = [
      { id: 'available' }, { id: 'primary' }, { id: 'secondary' },
      { id: 'pool' }, { id: 'inherent' }, { id: 'info' },
    ];
    expect(isPreAtomicSplitCategory(lay8)).toBe(true);
  });

  it('does NOT flag a post-split layout (has an atomic id) — customization is preserved', () => {
    const postSplit = [
      { id: 'available' }, { id: 'primary' }, { id: 'epic' },
      { id: 'inherent-fitness' }, { id: 'info' },
    ];
    expect(isPreAtomicSplitCategory(postSplit)).toBe(false);
  });

  it('does NOT flag an empty layout (first-time user falls through to default elsewhere)', () => {
    expect(isPreAtomicSplitCategory([])).toBe(false);
  });
});
