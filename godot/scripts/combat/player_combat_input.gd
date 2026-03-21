## Reads player input and drives the sibling Combatant component.
class_name PlayerCombatInput
extends Node

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

signal attack_type_changed(type_id: String)

const ATTACK_KEYS := {
	"attack_quick": "quick",
	"attack_heavy": "heavy",
	"attack_medium": "medium",
	"attack_defensive": "defensive",
	"attack_precise": "precise",
}

var selected_type: String = "quick"
var _combatant: Node  # Combatant
var _config: Dictionary = {}
var _attack_types: Dictionary = {}
var _weapons: Dictionary = {}


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")
	_config = CombatDataRef.load_config()
	_attack_types = _config.get("attack_types", {})
	_weapons = _config.get("weapons", {})


func _unhandled_input(event: InputEvent) -> void:
	if not _combatant:
		return

	# Attack type selection (1-5)
	for action in ATTACK_KEYS:
		if event.is_action_pressed(action):
			selected_type = ATTACK_KEYS[action]
			attack_type_changed.emit(selected_type)
			get_viewport().set_input_as_handled()
			return

	# Execute attack (LMB)
	if event.is_action_pressed("attack_execute"):
		var c_weapon: String = _combatant.weapon_id
		var weapon_data: Dictionary = _weapons.get(c_weapon, _weapons.get("unarmed", {}))
		var wind_up: float = CombatDataRef.get_effective_wind_up(
			_attack_types.get(selected_type, {}), weapon_data, selected_type
		)
		_combatant.start_attack(selected_type, wind_up)
		get_viewport().set_input_as_handled()


func _physics_process(_delta: float) -> void:
	if not _combatant:
		return
	var parent := get_parent()
	if parent is CharacterBody3D:
		var vel: Vector3 = parent.velocity
		var moving := Vector2(vel.x, vel.z).length() > 0.1
		_combatant.set_moving(moving)
