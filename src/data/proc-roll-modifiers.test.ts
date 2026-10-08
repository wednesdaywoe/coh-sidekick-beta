import { describe, it, expect, beforeAll } from 'vitest';
import { loadDataset } from '@/data/dataset';
import { getProcPotential } from './proc-potential';
import { getPPMAreaDenominator } from './proc-data';
import { ChainInduction } from './datasets/homecoming/generated/powersets/brute/primary/electrical-melee/chain-induction';
import { ChainLightning } from './datasets/homecoming/generated/powersets/blaster/primary/storm-blast/chain-lightning';
import { SonicBoom } from './datasets/homecoming/generated/powersets/brute/secondary/sonic-aura/sonic-boom';
import { TripMine } from './datasets/homecoming/generated/powersets/defender/primary/traps/trip-mine';
import type { Power } from '@/types/power';

/**
 * The PPM inputs HC authored in 2026 (field 41b) and its chain area factor —
 * the TypeScript twin of the engine's `proc_area_factor.rs`, with the same
 * hand-worked figures. Both damage procs used are 3.5 PPM (Obliteration for
 * the melee powers, Positron's Blast for the ranged one); nothing is slotted,
 * so a click's window is its base recharge.
 */
function procChance(
  power: Power,
  setName = 'Obliteration',
  ioName = 'Chance for Smashing Damage',
): number {
  const entry = getProcPotential(power)?.entries.find(
    (e) => e.setName === setName && e.ioName === ioName,
  );
  if (!entry) throw new Error(`${power.internalName}: no ${setName} "${ioName}" in the pool`);
  return entry.chance;
}

describe('PPM area-factor override, chain area and PPMMod', () => {
  beforeAll(async () => {
    await loadDataset('homecoming');
  });

  it('a chain scores radius × targets: Chain Induction (10ft, 5 targets) → 56%', () => {
    const denom = 0.25 + 0.75 * (1 + 0.15 * 10 * 5 / 10);
    expect(getPPMAreaDenominator(10, 360, { chainMaxTargets: 5 })).toBeCloseTo(denom, 9);
    expect(procChance(ChainInduction)).toBeCloseTo(3.5 * (14 + 1) / (60 * denom), 9);
  });

  it('a chain over ten targets costs more than a sphere: Chain Lightning (12ft, 16)', () => {
    const denom = 0.25 + 0.75 * (1 + 0.15 * 12 * 16 / 10);
    expect(procChance(ChainLightning, "Positron's Blast", 'Chance for Energy Damage')).toBeCloseTo(3.5 * (16 + 1.17) / (60 * denom), 9);
  });

  it('an override replaces the geometry: Trip Mine (AF 2.8)', () => {
    const denom = 0.25 + 0.75 * 2.8;
    expect(procChance(TripMine)).toBeCloseTo(3.5 * (30 + 2.77) / (60 * denom), 9);
  });

  it('Sonic Boom rolls on its 15ft pet at the pet\'s PPMMod 2 → 43.4%', () => {
    const denom = 0.25 + 0.75 * (1 + 0.15 * 15);
    expect(procChance(SonicBoom)).toBeCloseTo(3.5 * 2 * 10 / (60 * denom), 9);
  });
});
