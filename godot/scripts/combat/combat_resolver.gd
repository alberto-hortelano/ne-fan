## Pure math functions for combat resolution. No state, no side effects.
class_name CombatResolver
extends RefCounted


static func calculate_distance_factor(actual_distance: float, optimal_distance: float, tolerance: float) -> float:
	var deviation := absf(actual_distance - optimal_distance)
	if deviation >= tolerance:
		return 0.0
	return 1.0 - (deviation / tolerance)


static func calculate_precision_factor(offset: float, radius: float) -> float:
	if offset >= radius:
		return 0.0
	return 1.0 - (offset / radius)


static func calculate_offset_from_attack_center(attacker_pos: Vector3, attacker_fwd: Vector3, defender_pos: Vector3) -> float:
	var to_defender := defender_pos - attacker_pos
	# Project onto XZ plane
	var fwd_xz := Vector3(attacker_fwd.x, 0, attacker_fwd.z).normalized()
	var to_def_xz := Vector3(to_defender.x, 0, to_defender.z)
	# Perpendicular distance = magnitude of cross product (Y component) / |fwd|
	# Since fwd_xz is normalized, just take the Y component of cross product
	return absf(fwd_xz.cross(to_def_xz).y)


static func resolve_attack(
	attacker_pos: Vector3,
	attacker_fwd: Vector3,
	defender_pos: Vector3,
	defender_action: String,
	effective_params: Dictionary,
	tactical_matrix: Dictionary,
	attack_type_id: String,
) -> float:
	var actual_distance := attacker_pos.distance_to(defender_pos)
	var offset := calculate_offset_from_attack_center(attacker_pos, attacker_fwd, defender_pos)

	var distance_factor := calculate_distance_factor(
		actual_distance,
		effective_params.get("optimal_distance", 1.5),
		effective_params.get("distance_tolerance", 1.0),
	)
	var precision_factor := calculate_precision_factor(
		offset,
		effective_params.get("area_radius", 1.0),
	)

	# Tactical factor from matrix
	var tactical_factor := 1.0
	var row: Dictionary = tactical_matrix.get(attack_type_id, {})
	tactical_factor = row.get(defender_action, 1.0)

	var base_damage: float = effective_params.get("base_damage", 10.0)

	return distance_factor * precision_factor * tactical_factor * base_damage


static func apply_defensive_reduction(damage: float, reduction: float) -> float:
	return damage * (1.0 - clampf(reduction, 0.0, 1.0))
