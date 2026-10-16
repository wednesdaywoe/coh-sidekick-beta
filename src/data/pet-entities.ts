/**
 * Pet entities facade.
 *
 * The 24K-line PET_ENTITIES record (pet abilities + upgrade tiers used
 * for pet damage calculation: Mastermind summons, Voltaic Sentinel,
 * Lore pets, etc.) lives in the active dataset (e.g.
 * `src/data/datasets/homecoming/pet-entities.ts`). This file re-exports
 * the type definitions and forwards data reads through the active
 * dataset.
 */

import { getActiveDataset } from './dataset';
import type {
  PetDamageEntry,
  PetEffect,
  PetAbility,
  PetUpgradeTier,
  PetEntity,
} from './dataset';

export type { PetDamageEntry, PetEffect, PetAbility, PetUpgradeTier, PetEntity };

const objectProxy = <T extends object>(getter: () => T): T =>
  new Proxy({} as T, {
    get: (_, key) => Reflect.get(getter(), key),
    has: (_, key) => Reflect.has(getter(), key),
    ownKeys: () => Reflect.ownKeys(getter()),
    getOwnPropertyDescriptor: (_, key) => Reflect.getOwnPropertyDescriptor(getter(), key),
  });

export const PET_ENTITIES: Record<string, PetEntity> = objectProxy(
  () => getActiveDataset().petEntities,
);

/**
 * Look up a pet entity, tolerating an un-prefixed name. Some powers' EntCreate
 * P-hash resolves (via `priority_list`) to a bare entity name like "Sleet" /
 * "Liquefy" whose actual PET_ENTITIES key is `Pets_Sleet` / `Pets_Liquefy`.
 * Falls back to the `Pets_`-prefixed key so those summons resolve to their real
 * (complete) pet entity instead of showing nothing. Returns undefined if neither
 * exists (e.g. a generic shell like "Meteor" handled via `resolvedEntities`).
 */
export function getPetEntity(name: string | undefined): PetEntity | undefined {
  if (!name) return undefined;
  return PET_ENTITIES[name] ?? PET_ENTITIES[`Pets_${name}`];
}

/**
 * The pseudo-pets one summon reference actually delivers: the named entity, then the ones its
 * own powers create in place (`createsEntities`), transitively. Twin of the engine's
 * `granted::summoned_entity_chain`.
 *
 * A pet's payload can be one summon deeper — Poison Trap's pet carries only a Self_Destruct and
 * a self-resistance, and the choke and vomit live in the gas cloud that Self_Destruct leaves
 * behind as the trap dies. Stopping at the named entity showed the power doing nothing at all
 * (data-gaps-98 step 4). Only in-place summons are here; the converter has already excluded the
 * `target: AnyAffected` ones, which spawn a copy per foe hit and would report a bounce chain as
 * if every link landed on the same target.
 *
 * Commandability is checked here rather than by callers, so the root and its descendants answer
 * to one rule — a directable combat pet keeps its own Summons block instead of folding into the
 * summoning power, at either depth — and its subtree is not descended into.
 */
export function getSummonedEntityChain(name: string | undefined): PetEntity[] {
  const root = getPetEntity(name);
  if (!root) return [];

  const out: PetEntity[] = [];
  const seen = new Set<string>();
  const queue: (string | undefined)[] = [name];
  while (queue.length > 0) {
    const entity = getPetEntity(queue.shift());
    if (!entity || entity.commandable || seen.has(entity.name)) continue;
    seen.add(entity.name);
    out.push(entity);
    queue.push(...(entity.createsEntities ?? []));
  }
  return out;
}

