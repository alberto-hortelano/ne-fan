/** Dynamic animation selector — picks the best-fitting animation for given combat parameters.
 *
 * Scores each candidate animation on reach fit, sweep arc fit, and speed scale fit.
 * Returns the best match with the computed speed_scale to apply to the AnimationTree. */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export interface AnimIntrinsics {
  fbx_name: string;
  duration: number;
  has_steps: boolean;
  visual_reach_m: number;
  visual_sweep_deg: number;
  max_hips_displacement_m: number;
  impact_fraction: number;
  style: string;
}

export interface EffectiveParams {
  optimal_distance: number;
  distance_tolerance: number;
  area_radius: number;
  base_damage: number;
  damage_reduction: number;
  wind_up_time: number;
}

export interface MatchResult {
  animation_key: string;
  speed_scale: number;
  score: number;
}

// Weight distribution for scoring
const REACH_WEIGHT = 0.4;
const ARC_WEIGHT = 0.3;
const SPEED_WEIGHT = 0.3;

// Acceptable speed_scale range — outside this the animation looks unnatural
const MIN_SPEED_SCALE = 0.6;
const MAX_SPEED_SCALE = 1.8;

/** Load animation intrinsics from JSON file. */
export function loadIntrinsics(
  path?: string,
): Record<string, AnimIntrinsics> {
  const filePath =
    path ??
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../data/animation_intrinsics.json",
    );
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  return raw.attack_animations as Record<string, AnimIntrinsics>;
}

/** Convert area_radius at optimal_distance to expected sweep angle in degrees. */
function areaRadiusToSweepDeg(
  areaRadius: number,
  optimalDistance: number,
): number {
  if (optimalDistance <= 0) return 180;
  return 2 * Math.atan(areaRadius / optimalDistance) * (180 / Math.PI);
}

/** Score how well a value matches a target (0-1, 1 = perfect match). */
function fitScore(actual: number, target: number): number {
  if (target <= 0 && actual <= 0) return 1;
  const maxVal = Math.max(actual, target, 0.001);
  return Math.max(0, 1 - Math.abs(actual - target) / maxVal);
}

/** Score the speed_scale (penalizes values outside acceptable range). */
function speedFitScore(speedScale: number): number {
  if (speedScale >= MIN_SPEED_SCALE && speedScale <= MAX_SPEED_SCALE) {
    // Within range: slight preference for 1.0x
    return Math.max(0, 1 - Math.abs(1 - speedScale) * 0.3);
  }
  // Outside range: sharp penalty
  if (speedScale < MIN_SPEED_SCALE) {
    return Math.max(0, speedScale / MIN_SPEED_SCALE - 0.5);
  }
  return Math.max(0, 1 - (speedScale - MAX_SPEED_SCALE) * 0.5);
}

/** Select the best animation for the given effective combat parameters.
 *
 * @param params - Effective attack parameters (already weapon-modified)
 * @param intrinsics - Animation intrinsics catalog
 * @param exclude - Animation keys to exclude (e.g., animations with steps)
 * @returns Best match with animation_key, speed_scale, and score
 */
export function selectAnimation(
  params: EffectiveParams,
  intrinsics: Record<string, AnimIntrinsics>,
  exclude?: Set<string>,
): MatchResult {
  const expectedSweepDeg = areaRadiusToSweepDeg(
    params.area_radius,
    params.optimal_distance,
  );

  let bestResult: MatchResult = {
    animation_key: "quick",
    speed_scale: 1.0,
    score: 0,
  };

  for (const [key, anim] of Object.entries(intrinsics)) {
    // Skip excluded animations
    if (exclude?.has(key)) continue;
    // Skip animations with forward steps
    if (anim.has_steps) continue;
    // Skip non-attack styles
    if (anim.style === "kick") continue;

    // Compute speed_scale: adjust playback so impact aligns with wind_up_time
    const impactTimeAt1x = anim.duration * anim.impact_fraction;
    const speedScale =
      params.wind_up_time > 0 ? impactTimeAt1x / params.wind_up_time : 1.0;

    // Score components
    const reachScore = fitScore(anim.visual_reach_m, params.optimal_distance);
    const arcScore = fitScore(anim.visual_sweep_deg, expectedSweepDeg);
    const speedScore = speedFitScore(speedScale);

    const totalScore =
      reachScore * REACH_WEIGHT +
      arcScore * ARC_WEIGHT +
      speedScore * SPEED_WEIGHT;

    if (totalScore > bestResult.score) {
      bestResult = {
        animation_key: key,
        speed_scale: Math.max(
          MIN_SPEED_SCALE,
          Math.min(MAX_SPEED_SCALE, speedScale),
        ),
        score: totalScore,
      };
    }
  }

  return bestResult;
}

/** Get all animations ranked by fit for the given parameters. */
export function rankAnimations(
  params: EffectiveParams,
  intrinsics: Record<string, AnimIntrinsics>,
): MatchResult[] {
  const expectedSweepDeg = areaRadiusToSweepDeg(
    params.area_radius,
    params.optimal_distance,
  );

  const results: MatchResult[] = [];

  for (const [key, anim] of Object.entries(intrinsics)) {
    if (anim.has_steps || anim.style === "kick") continue;

    const impactTimeAt1x = anim.duration * anim.impact_fraction;
    const speedScale =
      params.wind_up_time > 0 ? impactTimeAt1x / params.wind_up_time : 1.0;

    const reachScore = fitScore(anim.visual_reach_m, params.optimal_distance);
    const arcScore = fitScore(anim.visual_sweep_deg, expectedSweepDeg);
    const speedScore = speedFitScore(speedScale);

    results.push({
      animation_key: key,
      speed_scale: Math.max(
        MIN_SPEED_SCALE,
        Math.min(MAX_SPEED_SCALE, speedScale),
      ),
      score:
        reachScore * REACH_WEIGHT +
        arcScore * ARC_WEIGHT +
        speedScore * SPEED_WEIGHT,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
