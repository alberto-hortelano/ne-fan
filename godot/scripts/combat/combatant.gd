## Combat component — attach as child of any spatial node (player or enemy).
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

var _wind_up_timer: float = 0.0
var _wind_up_duration: float = 0.0


func _process(delta: float) -> void:
	if state == State.WINDING_UP:
		_wind_up_timer += delta
		if _wind_up_timer >= _wind_up_duration:
			state = State.ATTACKING
			attack_impacted.emit(current_attack_type)
			# Return to idle after impact frame
			state = State.IDLE
			current_attack_type = ""


func start_attack(type_id: String, wind_up_time: float) -> bool:
	if state == State.WINDING_UP or state == State.ATTACKING:
		return false
	state = State.WINDING_UP
	current_attack_type = type_id
	_wind_up_timer = 0.0
	_wind_up_duration = wind_up_time
	attack_started.emit(type_id)
	return true


func receive_damage(amount: float, from: Node = null) -> void:
	if health <= 0.0:
		return
	health = maxf(health - amount, 0.0)
	damage_received.emit(amount, from)
	if health <= 0.0:
		died.emit()


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

	# Player: use CameraPivot direction
	var pivot := parent_3d.get_node_or_null("CameraPivot") as Node3D
	if pivot:
		var fwd: Vector3 = -pivot.global_transform.basis.z
		return Vector3(fwd.x, 0, fwd.z).normalized()

	# Enemies: use parent's forward (-Z in local space)
	var fwd: Vector3 = -parent_3d.global_transform.basis.z
	return Vector3(fwd.x, 0, fwd.z).normalized()


func get_global_position() -> Vector3:
	var parent := get_parent()
	if parent and parent is Node3D:
		return parent.global_position
	return Vector3.ZERO
