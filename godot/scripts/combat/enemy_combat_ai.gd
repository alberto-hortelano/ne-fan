## AI controller for enemy combatants. Decides attacks based on personality.
class_name EnemyCombatAI
extends Node

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

var aggression: float = 0.5
var preferred_attacks: Array = ["medium"]
var reaction_time: float = 0.8
var combat_range: float = 4.0
var target: Node = null  # Combatant

var _combatant: Node  # Combatant
var _timer: float = 0.0
var _config: Dictionary = {}
var _attack_types: Dictionary = {}
var _weapons: Dictionary = {}


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")
	_config = CombatDataRef.load_config()
	_attack_types = _config.get("attack_types", {})
	_weapons = _config.get("weapons", {})
	# Enemies are static in v1
	if _combatant:
		_combatant.set_moving(false)


func _process(delta: float) -> void:
	# Skip local AI when TS bridge handles decisions
	if LogicBridge.is_connected_to_bridge():
		return
	if not _combatant or _combatant.health <= 0.0 or not target:
		return
	if target.health <= 0.0:
		return

	_timer += delta
	if _timer < reaction_time:
		return
	_timer = 0.0

	# Check range before anything else — no attacks from across the room
	var my_pos: Vector3 = _combatant.get_global_position()
	var target_pos: Vector3 = target.get_global_position()
	var dist: float = my_pos.distance_to(target_pos)
	if dist > combat_range:
		return

	# Decide whether to attack based on aggression
	if randf() > aggression:
		return

	var chosen: String = _pick_attack(dist)
	if chosen == "":
		return

	var c_weapon: String = _combatant.weapon_id
	var weapon_data: Dictionary = _weapons.get(c_weapon, _weapons.get("unarmed", {}))
	var wind_up: float = CombatDataRef.get_effective_wind_up(
		_attack_types.get(chosen, {}), weapon_data, chosen
	)
	_combatant.start_attack(chosen, wind_up)


func _pick_attack(dist: float) -> String:
	# If close, prefer quick attacks; if far, prefer heavy
	var candidates: Array = preferred_attacks.duplicate()
	if candidates.is_empty():
		candidates = ["medium"]

	# Weight preferred attacks but also consider distance
	if dist < 1.5 and "quick" in _attack_types:
		candidates.append("quick")
	elif dist > 2.5 and "heavy" in _attack_types:
		candidates.append("heavy")

	return candidates[randi() % candidates.size()]


func setup_personality(personality: Dictionary) -> void:
	aggression = personality.get("aggression", 0.5)
	var pa = personality.get("preferred_attacks", ["medium"])
	preferred_attacks = pa if pa is Array else ["medium"]
	reaction_time = personality.get("reaction_time", 0.8)
