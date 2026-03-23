## Combat state display — state managed by nefan-core via LogicBridge.
## Signals are emitted by LogicBridge when it receives state updates.
class_name Combatant
extends Node

signal attack_started(type_id: String)
signal attack_impacted(type_id: String)
signal damage_received(amount: float, from: Node)
signal died()

enum State { IDLE, MOVING, WINDING_UP, ATTACKING }

var state: State = State.IDLE
var health: float = 100.0
var max_health: float = 100.0
var weapon_id: String = "unarmed"
var current_attack_type: String = ""


func set_moving(moving: bool) -> void:
	if state == State.WINDING_UP or state == State.ATTACKING:
		return
	state = State.MOVING if moving else State.IDLE


func get_current_action() -> String:
	match state:
		State.IDLE:
			return "idle"
		State.MOVING:
			return "moving"
		State.WINDING_UP, State.ATTACKING:
			return current_attack_type
	return "idle"


func get_forward_direction() -> Vector3:
	var parent_3d := get_parent() as Node3D
	if parent_3d == null:
		return Vector3.FORWARD
	# For player: use model (CombatAnimator) forward direction
	var model := parent_3d.get_node_or_null("CombatAnimator") as Node3D
	if model:
		var fwd: Vector3 = -model.global_transform.basis.z
		return Vector3(fwd.x, 0, fwd.z).normalized()
	var fwd: Vector3 = -parent_3d.global_transform.basis.z
	return Vector3(fwd.x, 0, fwd.z).normalized()


func get_global_position() -> Vector3:
	var parent := get_parent()
	if parent and parent is Node3D:
		return parent.global_position
	return Vector3.ZERO
