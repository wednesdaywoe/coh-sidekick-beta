import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { createEmptyBuild } from '@/types/build';
import { powerKey } from '@/utils/power-key';
import {
  canMoveSlotLevel,
  applySlotLevelMove,
  isMovableSlot,
  computeAllSlotLevels,
} from './slot-levels';

/**
 * Mids-style "move a slot's level to another power": swap the GRANT LEVELS of
 * two allocated slots while leaving their enhancers exactly where they are.
 *
 * The data model decouples the two: slot levels live in `build.slotOrder`,
 * enhancers in `power.slots[i]`. So a level move is purely a slotOrder edit and
 * never touches an enhancer. These tests pin both halves of that contract.
 *
 * Explicit slotOrder levels use values that exist in the slot-grant schedule
 * (SLOT_GRANTS has two grants at each of 5/7/9/25), so leveling-mode compute
 * honors them verbatim and the assertions are deterministic.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pow = (internalName: string, level: number, slotCount: number): any => ({
  internalName,
  name: internalName,
  level,
  slots: Array(slotCount).fill(null),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry = (powerName: string, slotIndex: number, level: number): any => ({
  powerName,
  slotIndex,
  category: 'primary',
  level,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBuild(primary: any[], slotOrder: any[]): any {
  const b = createEmptyBuild() as any;
  b.level = 50;
  b.primary.powers = primary;
  b.slotOrder = slotOrder;
  return b;
}

const KEY = (name: string) => powerKey('primary', name);

describe('slot-level move — Homecoming', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  it('swaps two slots’ levels, leaving every other slot put', () => {
    const b = makeBuild(
      [pow('Alpha', 1, 3), pow('Beta', 1, 2)],
      [entry('Alpha', 1, 5), entry('Alpha', 2, 7), entry('Beta', 1, 9)]
    );
    const src = { powerName: 'Alpha', slotIndex: 1, category: 'primary' as const };
    const tgt = { powerName: 'Beta', slotIndex: 1, category: 'primary' as const };

    expect(canMoveSlotLevel(b, src, tgt, true)).toBe(true);
    const moved = applySlotLevelMove(b, src, tgt, true);
    expect(moved).not.toBeNull();

    const after = computeAllSlotLevels(moved!, true);
    expect(after.get(KEY('Alpha'))![1]).toBe(9); // got Beta's level
    expect(after.get(KEY('Beta'))![1]).toBe(5); // got Alpha's level
    expect(after.get(KEY('Alpha'))![2]).toBe(7); // untouched peer slot
  });

  it('never moves enhancers — they stay with their (power, slotIndex)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enhA: any = { id: 'enhA', name: 'Enh A' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enhB: any = { id: 'enhB', name: 'Enh B' };
    const alpha = pow('Alpha', 1, 2);
    const beta = pow('Beta', 1, 2);
    alpha.slots[1] = enhA;
    beta.slots[1] = enhB;

    const b = makeBuild([alpha, beta], [entry('Alpha', 1, 5), entry('Beta', 1, 9)]);
    const moved = applySlotLevelMove(
      b,
      { powerName: 'Alpha', slotIndex: 1, category: 'primary' },
      { powerName: 'Beta', slotIndex: 1, category: 'primary' },
      true
    );
    expect(moved).not.toBeNull();

    const movedAlpha = moved!.primary.powers.find((p) => p.internalName === 'Alpha')!;
    const movedBeta = moved!.primary.powers.find((p) => p.internalName === 'Beta')!;
    expect(movedAlpha.slots[1]).toBe(enhA); // same enhancer, new level
    expect(movedBeta.slots[1]).toBe(enhB);
  });

  it('rejects a swap that would drop a slot below its power’s pick level', () => {
    const b = makeBuild(
      [pow('Low', 1, 2), pow('High', 20, 2)],
      [entry('Low', 1, 5), entry('High', 1, 25)]
    );
    const src = { powerName: 'Low', slotIndex: 1, category: 'primary' as const };
    const tgt = { powerName: 'High', slotIndex: 1, category: 'primary' as const };
    // Low's level-5 slot can't move onto High (pick level 20).
    expect(canMoveSlotLevel(b, src, tgt, true)).toBe(false);
    expect(applySlotLevelMove(b, src, tgt, true)).toBeNull();
  });

  it('rejects the free base slot (index 0) as either endpoint', () => {
    const b = makeBuild(
      [pow('Alpha', 1, 2), pow('Beta', 1, 2)],
      [entry('Alpha', 1, 5), entry('Beta', 1, 9)]
    );
    expect(
      canMoveSlotLevel(
        b,
        { powerName: 'Alpha', slotIndex: 0, category: 'primary' },
        { powerName: 'Beta', slotIndex: 1, category: 'primary' },
        true
      )
    ).toBe(false);
    expect(isMovableSlot(b, { powerName: 'Alpha', slotIndex: 0, category: 'primary' })).toBe(false);
    expect(isMovableSlot(b, { powerName: 'Alpha', slotIndex: 1, category: 'primary' })).toBe(true);
  });

  it('rejects moving a slot onto itself', () => {
    const b = makeBuild([pow('Alpha', 1, 2)], [entry('Alpha', 1, 5)]);
    const same = { powerName: 'Alpha', slotIndex: 1, category: 'primary' as const };
    expect(canMoveSlotLevel(b, same, same, true)).toBe(false);
  });

  it('works from respec-computed levels (empty slotOrder) by freezing levels first', () => {
    // "Respec mode" here means `computeSlotLevelsRespec` — an empty `slotOrder`
    // within Level Up mode — not issues-3's `levelUpMode: false`. This test stays
    // on `levelUpMode: true` throughout to exercise that internal path.
    const b = makeBuild([pow('Alpha', 1, 3), pow('Beta', 1, 2)], []);
    const before = computeAllSlotLevels(b, true);
    const beforeAlpha1 = before.get(KEY('Alpha'))![1];
    const beforeBeta1 = before.get(KEY('Beta'))![1];
    expect(beforeAlpha1).not.toBe(beforeBeta1); // distinct so the swap is observable

    const moved = applySlotLevelMove(
      b,
      { powerName: 'Alpha', slotIndex: 1, category: 'primary' },
      { powerName: 'Beta', slotIndex: 1, category: 'primary' },
      true
    );
    expect(moved).not.toBeNull();
    expect(moved!.slotOrder.length).toBeGreaterThan(0); // frozen

    const after = computeAllSlotLevels(moved!, true);
    expect(after.get(KEY('Alpha'))![1]).toBe(beforeBeta1);
    expect(after.get(KEY('Beta'))![1]).toBe(beforeAlpha1);
  });

  it('resolves category by name when the ref omits it', () => {
    const b = makeBuild(
      [pow('Alpha', 1, 2), pow('Beta', 1, 2)],
      [entry('Alpha', 1, 5), entry('Beta', 1, 9)]
    );
    // No `category` on either ref — resolveRef falls back to by-name search.
    const moved = applySlotLevelMove(
      b,
      { powerName: 'Alpha', slotIndex: 1 },
      { powerName: 'Beta', slotIndex: 1 },
      true
    );
    expect(moved).not.toBeNull();
    const after = computeAllSlotLevels(moved!, true);
    expect(after.get(KEY('Alpha'))![1]).toBe(9);
    expect(after.get(KEY('Beta'))![1]).toBe(5);
  });
});

describe('isMovableSlot — auto-granted inherent slots (Rebirth)', () => {
  beforeAll(async () => {
    await loadDataset('rebirth');
  });

  it('treats Health’s auto-granted slots as immovable, user slots as movable', () => {
    // Health at L50: base slot + 2 auto-granted (grants at 8, 16) + 1 user slot.
    // `inherentSlotCount` is the per-power record of how many of its slots are
    // auto-granted (set when the build is assembled).
    const b = createEmptyBuild() as ReturnType<typeof createEmptyBuild>;
    b.level = 50;
    const health = pow('Health', 1, 4);
    health.inherentSlotCount = 2;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b as any).inherents = [health];

    const ref = (slotIndex: number) => ({ powerName: 'Health', slotIndex, category: 'inherent' as const });
    expect(isMovableSlot(b, ref(0))).toBe(false); // base
    expect(isMovableSlot(b, ref(1))).toBe(false); // auto-granted
    expect(isMovableSlot(b, ref(2))).toBe(false); // auto-granted
    expect(isMovableSlot(b, ref(3))).toBe(true); // first user slot
  });
});
