// MUST be first: installs an in-memory localStorage before the store module is
// evaluated (the store caches its persist storage at eval time).
import '@/test/localstorage-polyfill';
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { createEmptyBuild } from '@/types/build';
import { useBuildStore } from '@/stores/buildStore';
import { useUIStore } from '@/stores/uiStore';
import { canRelocateSlot } from './slot-levels';
import { enhancementAllowedInPower } from './enhancement-eligibility';

/**
 * "Move a slot between powers" (relocation), distinct from the slot-LEVEL move.
 *
 * Relocation frees an allocated slot from one power and places it on another,
 * carrying the slot's enhancement when the destination power accepts it (else
 * the slot lands empty). The slot budget is net-neutral. These tests pin the
 * eligibility predicate, the validity guards, and the store mutation.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const genericIO = (stat: string): any => ({
  type: 'io-generic',
  id: `io-${stat}`,
  name: `${stat} IO`,
  icon: '',
  stat,
  value: 0,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const special = (stats: string[]): any => ({
  type: 'special',
  id: 'hami-1',
  name: 'Hami-O',
  icon: '',
  category: 'hamidon',
  aspects: stats.map((s) => ({ stat: s, value: 1 })),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pow = (
  internalName: string,
  slots: any[],
  opts: { maxSlots?: number; allowedEnhancements?: string[]; allowedSetCategories?: string[] } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any => ({
  internalName,
  name: internalName,
  level: 1,
  maxSlots: opts.maxSlots ?? 6,
  slots,
  allowedEnhancements: opts.allowedEnhancements ?? ['Recharge', 'Accuracy'],
  allowedSetCategories: opts.allowedSetCategories ?? [],
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

// Sum of budget-counted (extra) slots across non-inherent powers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extraSlots = (powers: any[]): number =>
  powers.reduce((n, p) => n + Math.max(0, p.slots.length - 1), 0);

describe('enhancementAllowedInPower', () => {
  it('allows a single-aspect enhancer when its stat is in allowedEnhancements', () => {
    const power = { allowedEnhancements: ['Recharge', 'Accuracy'] };
    expect(enhancementAllowedInPower(genericIO('Recharge'), power)).toBe(true);
    expect(enhancementAllowedInPower(genericIO('Damage'), power)).toBe(false);
  });

  it('allows a special (Hami) when ANY aspect is allowed', () => {
    const power = { allowedEnhancements: ['Defense'] };
    expect(enhancementAllowedInPower(special(['Damage', 'Defense']), power)).toBe(true);
    expect(enhancementAllowedInPower(special(['Damage', 'Accuracy']), power)).toBe(false);
  });

  it('rejects an IO set piece when the power surfaces no matching set category', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setPiece: any = {
      type: 'io-set', id: 'p', name: 'p', icon: '', setId: 'Whatever',
      setName: 'Whatever', pieceNum: 1, aspects: [], isProc: false, isUnique: false,
    };
    expect(enhancementAllowedInPower(setPiece, { allowedSetCategories: [] })).toBe(false);
  });
});

describe('canRelocateSlot', () => {
  it('accepts a user slot moving to a different power with room', () => {
    const b = makeBuild(
      [pow('Alpha', [null, genericIO('Recharge')]), pow('Beta', [null])],
      [entry('Alpha', 1, 5)]
    );
    expect(canRelocateSlot(b, { powerName: 'Alpha', slotIndex: 1, category: 'primary' }, { powerName: 'Beta', category: 'primary' }, true)).toBe(true);
  });

  it('rejects moving the free base slot (index 0)', () => {
    const b = makeBuild([pow('Alpha', [null]), pow('Beta', [null])], []);
    expect(canRelocateSlot(b, { powerName: 'Alpha', slotIndex: 0, category: 'primary' }, { powerName: 'Beta', category: 'primary' }, true)).toBe(false);
  });

  it('rejects relocating onto the same power', () => {
    const b = makeBuild([pow('Alpha', [null, null])], [entry('Alpha', 1, 5)]);
    expect(canRelocateSlot(b, { powerName: 'Alpha', slotIndex: 1, category: 'primary' }, { powerName: 'Alpha', category: 'primary' }, true)).toBe(false);
  });

  it('rejects a full target (slots.length >= maxSlots)', () => {
    const full = pow('Beta', [null, null, null, null, null, null], { maxSlots: 6 });
    const b = makeBuild([pow('Alpha', [null, genericIO('Recharge')]), full], [entry('Alpha', 1, 5)]);
    expect(canRelocateSlot(b, { powerName: 'Alpha', slotIndex: 1, category: 'primary' }, { powerName: 'Beta', category: 'primary' }, true)).toBe(false);
  });
});

describe('moveSlot store action (homecoming)', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
    // issues-3: the store action reads live Level Up mode; these tests pin its
    // schedule-aware (on) behavior.
    useUIStore.setState({ levelUpMode: true });
  });

  const seed = (beta: ReturnType<typeof pow>) => {
    const b = makeBuild(
      [pow('Alpha', [null, genericIO('Recharge')]), beta],
      [entry('Alpha', 1, 5)]
    );
    useBuildStore.setState({ build: b });
  };

  it('carries the enhancement when the target allows it, net-neutral on budget', () => {
    seed(pow('Beta', [null], { allowedEnhancements: ['Recharge'] }));
    const before = extraSlots(useBuildStore.getState().build.primary.powers);

    const result = useBuildStore.getState().moveSlot(
      { powerName: 'Alpha', slotIndex: 1, category: 'primary' },
      { powerName: 'Beta', category: 'primary' }
    );

    expect(result.ok).toBe(true);
    expect(result.enhancementDropped).toBe(false);

    const powers = useBuildStore.getState().build.primary.powers;
    const alpha = powers.find((p) => p.internalName === 'Alpha')!;
    const beta = powers.find((p) => p.internalName === 'Beta')!;
    expect(alpha.slots.length).toBe(1); // lost its extra slot
    expect(beta.slots.length).toBe(2); // gained one
    expect(beta.slots[1]).toMatchObject({ type: 'io-generic', stat: 'Recharge' });
    expect(extraSlots(powers)).toBe(before); // budget unchanged

    // slotOrder: Alpha's extra entry gone, Beta gained one.
    const order = useBuildStore.getState().build.slotOrder;
    expect(order.some((e) => e.powerName === 'Alpha' && e.slotIndex === 1)).toBe(false);
    expect(order.some((e) => e.powerName === 'Beta' && e.slotIndex === 1)).toBe(true);
  });

  it('drops the enhancement (slot moves empty) when the target rejects it', () => {
    seed(pow('Beta', [null], { allowedEnhancements: ['Accuracy'] })); // no Recharge
    const result = useBuildStore.getState().moveSlot(
      { powerName: 'Alpha', slotIndex: 1, category: 'primary' },
      { powerName: 'Beta', category: 'primary' }
    );

    expect(result.ok).toBe(true);
    expect(result.enhancementDropped).toBe(true);

    const beta = useBuildStore.getState().build.primary.powers.find((p) => p.internalName === 'Beta')!;
    expect(beta.slots.length).toBe(2);
    expect(beta.slots[1]).toBeNull();
  });

  it('refuses an invalid move without mutating the build', () => {
    seed(pow('Beta', [null], { allowedEnhancements: ['Recharge'] }));
    const result = useBuildStore.getState().moveSlot(
      { powerName: 'Alpha', slotIndex: 0, category: 'primary' }, // free slot
      { powerName: 'Beta', category: 'primary' }
    );
    expect(result.ok).toBe(false);
    const powers = useBuildStore.getState().build.primary.powers;
    expect(powers.find((p) => p.internalName === 'Alpha')!.slots.length).toBe(2);
    expect(powers.find((p) => p.internalName === 'Beta')!.slots.length).toBe(1);
  });
});

describe('pieceSlottableNow (B3 — bulk placement skips ineligible pieces)', () => {
  // A unique-only set shaped like a Superior ATO: every piece unique, category 'ato'.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atoSet: any = {
    id: 'superior-test-ato',
    name: 'Superior Test ATO',
    category: 'ato',
    pieces: [1, 2, 3, 4, 5, 6].map((num) => ({
      num,
      name: `Piece ${num}`,
      aspects: ['Damage'],
      proc: false,
      unique: true,
    })),
  };
  const pieceIn = (num: number) => ({ type: 'io-set', setId: 'superior-test-ato', pieceNum: num });

  it('refuses a piece already slotted in the current power', async () => {
    const { pieceSlottableNow } = await import('./enhancement-eligibility');
    const slots = [pieceIn(2), pieceIn(4), null, null];
    expect(
      pieceSlottableNow(atoSet, atoSet.pieces[1], slots, { compareMode: false, isUniqueSlotted: () => true }),
    ).toBe(false);
  });

  it('refuses a unique piece consumed elsewhere in the build', async () => {
    const { pieceSlottableNow } = await import('./enhancement-eligibility');
    expect(
      pieceSlottableNow(atoSet, atoSet.pieces[0], [null], {
        compareMode: false,
        isUniqueSlotted: (setId, num) => setId === 'superior-test-ato' && num === 1,
      }),
    ).toBe(false);
  });

  it('accepts the free pieces of the reported drag (1st→3rd with 2nd/4th slotted)', async () => {
    const { pieceSlottableNow } = await import('./enhancement-eligibility');
    const slots = [pieceIn(2), pieceIn(4), null, null];
    const opts = {
      compareMode: false,
      isUniqueSlotted: (_setId: string, num: number) => [2, 4].includes(num),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const placeable = (atoSet.pieces as any[])
      .slice(0, 3)
      .filter((p) => pieceSlottableNow(atoSet, p, slots, opts))
      .map((p) => p.num);
    expect(placeable).toEqual([1, 3]);
  });

  it('compare mode ignores the build-wide unique check but not the in-power one', async () => {
    const { pieceSlottableNow } = await import('./enhancement-eligibility');
    const slots = [pieceIn(2), null];
    const opts = { compareMode: true, isUniqueSlotted: () => true };
    expect(pieceSlottableNow(atoSet, atoSet.pieces[0], slots, opts)).toBe(true);
    expect(pieceSlottableNow(atoSet, atoSet.pieces[1], slots, opts)).toBe(false);
  });
});
