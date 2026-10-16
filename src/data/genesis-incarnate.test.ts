import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getGenesisEffects, getSelectableIncarnateSlotIds } from '@/data';
import { GENERATED_GENESIS_EFFECTS } from '@/data/datasets/rebirth/generated/incarnate-effects';

/**
 * Genesis is Rebirth's 7th incarnate slot — a partner-slot AMPLIFIER, not a flat
 * global-buff slot (verified against the Rebirth wiki):
 *   Data    → Lore pets' damage (+ flat pet Max HP)
 *   Fate    → Destiny slot ability effects
 *   Socket  → Interface procs AND the player's Max HP / Max Endurance
 *   Verdict → Judgement attack damage
 * The per-tier amplification is a clean 2.5 / 5 / 7.5 / 10%. These tests pin the
 * generated data's targeting + magnitudes and the Rebirth-only slot gating so a
 * future re-gen or naive "apply as global buff" change can't silently regress it.
 */

const TIERS = new Set([0.025, 0.05, 0.075, 0.1]);
const TREE_TO_SLOT: Record<string, string> = {
  data: 'lore', fate: 'destiny', socket: 'interface', verdict: 'judgement',
};

describe('Genesis generated data (Rebirth)', () => {
  it('has all 36 abilities across the 4 trees', () => {
    const entries = Object.values(GENERATED_GENESIS_EFFECTS);
    expect(entries).toHaveLength(36);
    for (const tree of ['data', 'fate', 'socket', 'verdict']) {
      expect(entries.filter((e) => e.tree === tree)).toHaveLength(9);
    }
  });

  it('every ability targets its correct partner slot with a clean tier percent', () => {
    for (const e of Object.values(GENERATED_GENESIS_EFFECTS)) {
      expect(e.enhancesSlot).toBe(TREE_TO_SLOT[e.tree]);
      expect(TIERS.has(e.tierPercent), `${e.displayName} tier=${e.tierPercent}`).toBe(true);
    }
  });

  it('only Data carries a flat Lore-pet Max HP (= tierPercent × 2000)', () => {
    for (const e of Object.values(GENERATED_GENESIS_EFFECTS)) {
      if (e.tree === 'data') {
        expect(e.loreMaxHP).toBeCloseTo(e.tierPercent * 2000, 6);
      } else {
        expect(e.loreMaxHP).toBeUndefined();
      }
    }
  });

  it('resolves each tree\'s below-45 exemplar power to the right kind', () => {
    const byKind = (id: string) => GENERATED_GENESIS_EFFECTS[id].exemplarEffect?.kind;
    expect(byKind('verdict_core_flawless_genesis')).toBe('attack');
    expect(byKind('socket_core_flawless_genesis')).toBe('proc');
    expect(byKind('data_genesis')).toBe('summon');
    expect(byKind('fate_genesis')).toBe('buff');
    // Every ability resolves an exemplar effect.
    for (const e of Object.values(GENERATED_GENESIS_EFFECTS)) {
      expect(e.exemplarEffect, e.displayName).toBeTruthy();
    }
  });

  it('Fate Ageless exemplar carries a +recharge self-buff (feeds the dashboard below 45)', () => {
    const ex = GENERATED_GENESIS_EFFECTS['fate_genesis'].exemplarEffect as { kind: string; stats?: { recharge?: number } };
    expect(ex.kind).toBe('buff');
    expect(ex.stats?.recharge).toBeGreaterThan(0);
  });

  it('pins the four Very Rare (Core Flawless) tiers at 10%', () => {
    expect(GENERATED_GENESIS_EFFECTS['data_core_flawless_genesis']).toMatchObject({
      tree: 'data', enhancesSlot: 'lore', tierPercent: 0.1, loreMaxHP: 200,
    });
    expect(GENERATED_GENESIS_EFFECTS['socket_core_flawless_genesis']).toMatchObject({
      tree: 'socket', enhancesSlot: 'interface', tierPercent: 0.1,
    });
    expect(GENERATED_GENESIS_EFFECTS['fate_core_flawless_genesis']).toMatchObject({
      tree: 'fate', enhancesSlot: 'destiny', tierPercent: 0.1,
    });
    expect(GENERATED_GENESIS_EFFECTS['verdict_core_flawless_genesis']).toMatchObject({
      tree: 'verdict', enhancesSlot: 'judgement', tierPercent: 0.1,
    });
  });
});

describe('Genesis slot gating — Rebirth', () => {
  beforeAll(async () => {
    await loadDataset('rebirth');
  });

  it('offers the genesis slot in the picker', () => {
    expect(getSelectableIncarnateSlotIds()).toContain('genesis');
  });

  it('resolves Genesis effects from both the bare key and the full power name', () => {
    const bare = getGenesisEffects('socket_core_flawless_genesis');
    const full = getGenesisEffects('Incarnate.Genesis.Socket_Core_Flawless_Genesis');
    expect(bare?.tierPercent).toBe(0.1);
    expect(full?.enhancesSlot).toBe('interface');
    expect(bare).toEqual(full);
  });
});

// HC and Thunderspy both export a genesis table, but every power is a dormant
// placeholder (authored help = "… text", reused Interface icons) — the slot was
// defined but never enabled. Both must hide the slot AND serve no effects, so a
// deserialized cross-dataset build can't apply an unreleased amplifier. See the
// data-gaps-47 register entry.
describe.each(['homecoming', 'thunderspy'] as const)(
  'Genesis slot gating — %s (dormant placeholder)',
  (datasetId) => {
    beforeAll(async () => {
      await loadDataset(datasetId);
    });

    it('hides the genesis slot', () => {
      expect(getSelectableIncarnateSlotIds()).not.toContain('genesis');
    });

    it('returns no Genesis effects', () => {
      expect(getGenesisEffects('socket_core_flawless_genesis')).toBeNull();
    });
  },
);
