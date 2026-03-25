## Reads player attack type selection (keys 1-5).
## Attack execution is handled by PlayerController._unhandled_input.
class_name PlayerCombatInput
extends Node

signal attack_type_changed(type_id: String)

const ATTACK_KEYS := {
	"attack_quick": "quick",
	"attack_heavy": "heavy",
	"attack_medium": "medium",
	"attack_defensive": "defensive",
	"attack_precise": "precise",
}

var selected_type: String = "quick"
var _combatant: Node


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")


func _unhandled_input(event: InputEvent) -> void:
	# Attack type selection (1-5)
	for action in ATTACK_KEYS:
		if event.is_action_pressed(action):
			selected_type = ATTACK_KEYS[action]
			attack_type_changed.emit(selected_type)
			get_viewport().set_input_as_handled()
			return


func _physics_process(_delta: float) -> void:
	if not _combatant:
		return
	var parent := get_parent()
	if parent is CharacterBody3D:
		var vel: Vector3 = parent.velocity
		var moving := Vector2(vel.x, vel.z).length() > 0.1
		_combatant.set_moving(moving)
