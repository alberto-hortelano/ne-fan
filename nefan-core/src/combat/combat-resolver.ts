/** Pure math functions for combat resolution. No state, no side effects.
 *  Canonical implementation — the client has no combat logic (display only). */

import type { Vec3, EffectiveParams } from "../types.js";
import { distance, sub, cross, dot, normalized } from "../vec3.js";

/** ¿El defensor está en el semiespacio FRONTAL del atacante (dentro de un
 *  cono de ~120°)? La precisión sola mide distancia perpendicular a la línea
 *  del forward tratada como infinita, así que sin este gate un objetivo justo
 *  a la espalda (offset 0) recibía calidad perfecta. Espejo del cono del
 *  shooting-combat-system. */
export function isInFront(attackerFwd: Vec3, attackerPos: Vec3, defenderPos: Vec3): boolean {
  const toDefXz = normalized({
    x: defenderPos.x - attackerPos.x,
    y: 0,
    z: defenderPos.z - attackerPos.z,
  });
  const fwdXz = normalized({ x: attackerFwd.x, y: 0, z: attackerFwd.z });
  // dot > 0.5 ⇒ dentro de ±60° del frente. En distancia ~0 (toDefXz nulo) el
  // producto es 0 y no se golpea, coherente con "cuerpo a cuerpo real".
  return dot(fwdXz, toDefXz) > 0.5;
}

export function calculateDistanceFactor(
  actualDistance: number,
  optimalDistance: number,
  tolerance: number,
): number {
  const deviation = Math.abs(actualDistance - optimalDistance);
  if (deviation >= tolerance) return 0.0;
  return 1.0 - deviation / tolerance;
}

export function calculatePrecisionFactor(
  offset: number,
  radius: number,
): number {
  if (offset >= radius) return 0.0;
  return 1.0 - offset / radius;
}

export function calculateOffsetFromAttackCenter(
  attackerPos: Vec3,
  attackerFwd: Vec3,
  defenderPos: Vec3,
): number {
  const toDefender = sub(defenderPos, attackerPos);
  // Project onto XZ plane
  const fwdXz = normalized({ x: attackerFwd.x, y: 0, z: attackerFwd.z });
  const toDefXz = { x: toDefender.x, y: 0, z: toDefender.z };
  // Perpendicular distance = |cross(fwdXz, toDefXz).y|
  return Math.abs(cross(fwdXz, toDefXz).y);
}

export function resolveAttack(
  attackerPos: Vec3,
  attackerFwd: Vec3,
  defenderPos: Vec3,
  defenderAction: string,
  effectiveParams: EffectiveParams,
  tacticalMatrix: Record<string, Record<string, number>>,
  attackTypeId: string,
): number {
  // Solo se golpea al frente: la precisión trata la línea del forward como
  // infinita, así que un objetivo a la espalda pasaría con offset 0.
  if (!isInFront(attackerFwd, attackerPos, defenderPos)) return 0;

  const actualDistance = distance(attackerPos, defenderPos);
  const offset = calculateOffsetFromAttackCenter(attackerPos, attackerFwd, defenderPos);

  const distanceFactor = calculateDistanceFactor(
    actualDistance,
    effectiveParams.optimal_distance,
    effectiveParams.distance_tolerance,
  );
  const precisionFactor = calculatePrecisionFactor(
    offset,
    effectiveParams.area_radius,
  );

  // Tactical factor from matrix
  const row = tacticalMatrix[attackTypeId] ?? {};
  const tacticalFactor = row[defenderAction] ?? 1.0;

  const baseDamage = effectiveParams.base_damage;

  return distanceFactor * precisionFactor * tacticalFactor * baseDamage;
}

export function applyDefensiveReduction(
  damage: number,
  reduction: number,
): number {
  return damage * (1.0 - Math.max(0.0, Math.min(1.0, reduction)));
}
