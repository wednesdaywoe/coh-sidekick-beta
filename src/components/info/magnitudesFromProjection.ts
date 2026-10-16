/**
 * The engine's resolved granted magnitudes, reshaped into the rows `RegistryEffectsDisplay`
 * renders (data-gaps-329 / PROD6C-3).
 *
 * The display used to resolve its own rows from a bag the surface built. That bag's only
 * authored source was the power's wire `effects`, and data-gaps-327 removed it, so
 * `buildDisplayEffects` now returns the keys it mints for itself and nothing else. Around
 * 2,700 powers per fork carry atoms and produce no effect row at all. The engine never had
 * that problem: `granted::atom_seed` projects the display bag from the atom stream, resolves
 * it, and hands back the finished rows. This maps those rows onto the shape the component
 * already renders, which is what makes the swap a re-point rather than a rewrite.
 *
 * Three things the engine states that the resolver's shape has nowhere to put, and where they
 * go instead:
 *
 * - The mez FACE. `mez_face_label` suffixes a protection row with "Prot" and a self-directed
 *   one with "(Self)". Those live in `label`, so the label renders as-is and the verdict is
 *   restated on [`ResolvedMagnitude.mezFace`] for the grouping pass, rather than sniffed a
 *   second time off a `rawValue` these rows do not carry.
 * - `ignoresStrength`. The engine already collapsed such a row to three equal tiers, which is
 *   the whole of what the flag drives here.
 * - `rawValue`. There is no authored value behind an engine row, and the field stays
 *   `undefined`. Its consumers all guard with `isMezEffect` / `isScaledEffect`, so they
 *   decline rather than break; see the note on `RegistryEffectsDisplay`'s `rows` prop.
 *
 * Presentation the engine does not carry (`colorClass`, `enhancementAspect`, `canBeByType`)
 * joins from the local registry by `effectKey`. Both sides read the same generated
 * `contract/effect-registry.json`, so a key the engine resolved and this one does not hold is
 * a vendor skew, not a row to draw in a default style.
 */
import type { GrantedMagnitude } from '@/engine/engineTotalsMap';
import { EFFECT_REGISTRY, type EffectDisplayConfig } from '@/data/core/effect-registry';
import type { MagnitudeQuantity, ResolvedMagnitude } from './resolvePowerMagnitudes';

/** The suffixes `mez_face_label` appends, checked longest-first so one cannot shadow the
 *  other. Read as a pair with that engine function; they are one decision. */
const FACE_SUFFIXES: ReadonlyArray<[string, 'protection' | 'self']> = [
  [' (Self)', 'self'],
  [' Prot', 'protection'],
];

function mezFaceOf(label: string): 'protection' | 'self' | undefined {
  return FACE_SUFFIXES.find(([suffix]) => label.endsWith(suffix))?.[1];
}

/**
 * Did this row come from a by-type / protection expansion?
 *
 * The engine keys an expanded row `{effect_key}_{type_key}` (`resistance_fire`,
 * `protection_hold`, and `{effect_key}__all` for the collapsed case) and every other row by
 * its bag key. A split slot is the near miss to check against: `defenseUnenhanced` also
 * differs from its `defense` effect key, and correctly reads as NOT expanded, because the
 * converter's mark is a bare suffix rather than a `_` join.
 */
function isExpanded(row: GrantedMagnitude): boolean {
  return row.rowKey !== row.effectKey && row.rowKey.startsWith(`${row.effectKey}_`);
}

/**
 * Narrow the wire quantity to the display union, refusing an unrecognized kind.
 *
 * Both unions are hand-declared against the engine's `GrantedQuantity`, and a widened enum
 * obliges every exhaustive reader (data-gaps-50). A cast here would let a new engine member
 * reach the render sites as a kind none of them has an arm for, which is a blank row rather
 * than a report, so this refuses instead (Rule 1).
 */
function quantityOf(row: GrantedMagnitude): MagnitudeQuantity {
  const { kind } = row.quantity;
  switch (kind) {
    case 'mez_duration':
      return { kind, magnitude: row.quantity.magnitude ?? 0 };
    case 'value':
    case 'mez_magnitude':
    case 'mez_expression':
    case 'mez_constant':
    case 'mez_unstated':
    case 'distance':
      return { kind };
    default:
      throw new Error(
        `magnitudesFromProjection: engine row ${row.rowKey} carries quantity kind `
        + `'${kind satisfies never}', which no display arm handles`
      );
  }
}

export function magnitudesFromProjection(rows: GrantedMagnitude[]): ResolvedMagnitude[] {
  const out: ResolvedMagnitude[] = [];

  for (const row of rows) {
    const base = EFFECT_REGISTRY[row.effectKey];
    if (!base) continue;
    const expanded = isExpanded(row);

    // An expanded row's own label goes to `expandedLabel`; its CONFIG stays the registry entry
    // untouched, which is both the family label the collapsed group header shows and the object
    // the component compares by REFERENCE when deciding consecutive rows are one group. Handing
    // an expansion its own config silently stops that collapse, which reads as a layout change
    // rather than as a bug.
    //
    // Every other row takes the engine's label and format, because the engine qualifies them:
    // the mez face, and the percent-form absorb row whose value is a fraction of Max HP.
    const config = expanded || (row.label === base.label && row.format === base.format)
      ? base
      : { ...base, label: row.label, format: row.format as EffectDisplayConfig['format'] };

    out.push({
      rowKey: row.rowKey,
      effectKey: row.effectKey,
      config,
      expandedLabel: expanded ? row.label : undefined,
      rawValue: undefined,
      tiers: row.value,
      quantity: quantityOf(row),
      byTypeLabel: row.byTypeLabel ?? undefined,
      mezFace: mezFaceOf(row.label),
      // The seconds only reach a row whose tier is not already them: a `mez_duration` row's
      // tier IS the seconds, so the engine states `duration: null` there (recorded_duration)
      // and the surface must not print the same number twice. data-gaps-330.
      duration: row.duration ?? undefined,
    });
  }
  return out;
}
