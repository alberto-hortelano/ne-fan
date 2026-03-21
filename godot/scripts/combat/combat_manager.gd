## Orchestrates combat: resolves impacts, applies damage, handles simultaneous attacks.
class_name CombatManager
extends Node

signal combat_result(attacker: Node, defender: Node, damage: float)
signal combatant_died(combatant: Node)

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")
const CombatResolverRef = preload("res://scripts/combat/combat_resolver.gd")
const SIMULTANEOUS_WINDOW := 0.05

var _config: Dictionary = {}
var _attack_types: Dictionary = {}
var _weapons: Dictionary = {}
var _tactical_matrix: Dictionary = {}
var _combatants: Array = []
var _pending_impacts: Array[Dictionary] = []  # {combatant, type_id, time}
var _time_acc: float = 0.0


func _ready() -> void:
	_config = CombatDataRef.load_config()
	_attack_types = _config.get("attack_types", {})
	_weapons = _config.get("weapons", {})
	_tactical_matrix = _config.get("tactical_matrix", {})


func register_combatant(c: Node) -> void:
	if c in _combatants:
		return
	_combatants.append(c)
	c.attack_impacted.connect(_on_attack_impacted.bind(c))
	c.died.connect(_on_combatant_died.bind(c))


func unregister_combatant(c: Node) -> void:
	_combatants.erase(c)
	if c.attack_impacted.is_connected(_on_attack_impacted.bind(c)):
		c.attack_impacted.disconnect(_on_attack_impacted.bind(c))
	if c.died.is_connected(_on_combatant_died.bind(c)):
		c.died.disconnect(_on_combatant_died.bind(c))


func _on_attack_impacted(type_id: String, attacker: Node) -> void:
	_pending_impacts.append({
		"attacker": attacker,
		"type_id": type_id,
		"time": _time_acc,
	})


func _physics_process(delta: float) -> void:
	_time_acc += delta
	if _pending_impacts.is_empty():
		return

	# Group impacts within the simultaneous window
	var batch: Array[Dictionary] = []
	var cutoff := _time_acc - SIMULTANEOUS_WINDOW
	var remaining: Array[Dictionary] = []

	for impact in _pending_impacts:
		if impact.time <= cutoff:
			batch.append(impact)
		else:
			remaining.append(impact)

	if batch.is_empty():
		# Check if oldest impact has waited long enough
		var oldest_time: float = _pending_impacts[0].time
		if _time_acc - oldest_time >= SIMULTANEOUS_WINDOW:
			batch = _pending_impacts.duplicate()
			remaining = []
		else:
			return

	_pending_impacts = remaining
	_resolve_batch(batch)


func _resolve_batch(batch: Array[Dictionary]) -> void:
	for impact in batch:
		var attacker: Node = impact.attacker
		var type_id: String = impact.type_id
		var a_health: float = attacker.health
		if a_health <= 0.0:
			continue

		var a_weapon: String = attacker.weapon_id
		var weapon_data: Dictionary = _weapons.get(a_weapon, _weapons.get("unarmed", {}))
		var effective_params: Dictionary = CombatDataRef.get_effective_params(type_id, _attack_types, weapon_data)

		var attacker_pos: Vector3 = attacker.get_global_position()
		var attacker_fwd: Vector3 = attacker.get_forward_direction()

		# Find closest enemy in front
		var best_target: Node = null
		var best_damage: float = 0.0

		for target in _combatants:
			var t_health: float = target.health
			if target == attacker or t_health <= 0.0:
				continue

			var target_pos: Vector3 = target.get_global_position()
			var defender_action: String = target.get_current_action()

			var damage: float = CombatResolverRef.resolve_attack(
				attacker_pos, attacker_fwd, target_pos,
				defender_action, effective_params, _tactical_matrix, type_id,
			)

			if damage <= 0.0:
				continue

			# Apply defensive reduction
			if defender_action == "defensive":
				var t_weapon: String = target.weapon_id
				var def_weapon: Dictionary = _weapons.get(t_weapon, _weapons.get("unarmed", {}))
				var def_params: Dictionary = CombatDataRef.get_effective_params("defensive", _attack_types, def_weapon)
				damage = CombatResolverRef.apply_defensive_reduction(damage, def_params.get("damage_reduction", 0.0))

			if damage > best_damage:
				best_damage = damage
				best_target = target

		if best_target and best_damage > 0.0:
			best_target.receive_damage(best_damage, attacker)
			combat_result.emit(attacker, best_target, best_damage)
			var a_name: String = attacker.get_parent().name if attacker.get_parent() else "?"
			var t_name: String = best_target.get_parent().name if best_target.get_parent() else "?"
			var t_hp: float = best_target.health
			print("Combat: %s -> %s: %.1f dmg (HP: %.0f)" % [a_name, t_name, best_damage, t_hp])


func _on_combatant_died(combatant: Node) -> void:
	combatant_died.emit(combatant)
	var c_name: String = combatant.get_parent().name if combatant.get_parent() else "?"
	print("Combat: %s died" % c_name)
