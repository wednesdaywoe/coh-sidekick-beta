/**
 * Enhancement-curves facade.
 *
 * The curve data (ED thresholds, boost-type→schedule assignment, per-level
 * strength curves, multi-aspect scale, relative-level attenuation, exemplar
 * magnitude handicaps) lives in each dataset's generated module
 * (`src/data/datasets/<id>/generated/enhancement-curves.ts`, emitted from the
 * binary export by data-gaps-324 SW3 and staleness-guarded against it both
 * directions). This facade forwards reads to whichever dataset is currently
 * active, mirroring `at-tables.ts`.
 */

import { getActiveDataset } from './dataset';
import type { EnhancementCurvesData } from './dataset';

export type { EnhancementCurvesData, EnhancementSchedule, OriginTier } from './dataset';

export function getEnhancementCurves(): EnhancementCurvesData {
  return getActiveDataset().enhancementCurves;
}
