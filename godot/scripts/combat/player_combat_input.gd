## Reads player attack type selection (keys 1-9, driven by combat_config.json).
## Attack execution is handled by PlayerController._unhandled_input.
class_name PlayerCombatInput
extends Node

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

signal attack_type_changed(type_id: String)

# Number keys mapped to physical keycodes (KEY_1 = 49 .. KEY_9 = 57)
const KEY_CODES := [KEY_1, KEY_2, KEY_3, KEY_4, KEY_5, KEY_6, KEY_7, KEY_8, KEY_9]

var selected_type: String = ""
var _attack_type_ids: Array[String] = []  # ordered list from config
var _combatant: Node
var _pending_attack: Dictionary = {}  # Set by player_controller, read by logic_bridge


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")
	var config: Dictionary = CombatDataRef.load_config()
	var attack_types: Dictionary = config.get("attack_types", {})
	_attack_type_ids.clear()
	for type_id: String in attack_types:
		_attack_type_ids.append(type_id)
	if _attack_type_ids.size() > 0 and selected_type == "":
		selected_type = _attack_type_ids[0]


func _unhandled_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	var key: InputEventKey = event
	for i in range(mini(_attack_type_ids.size(), KEY_CODES.size())):
		if key.physical_keycode == KEY_CODES[i]:
			selected_type = _attack_type_ids[i]
			attack_type_changed.emit(selected_type)
			get_viewport().set_input_as_handled()
			return


func request_attack(type: String) -> void:
	_pending_attack = {"type": type}


func get_pending_attack() -> Dictionary:
	var result := _pending_attack
	_pending_attack = {}
	return result


func _physics_process(_delta: float) -> void:
	if not _combatant:
		return
	var parent := get_parent()
	if parent is CharacterBody3D:
		var vel: Vector3 = parent.velocity
		var moving := Vector2(vel.x, vel.z).length() > 0.1
		_combatant.set_moving(moving)
