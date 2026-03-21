## RayCast3D that detects interactive objects and NPCs under the crosshair.
extends RayCast3D

signal target_changed(body: StaticBody3D)
signal interacted(body: StaticBody3D)

var _current_target: StaticBody3D = null


func _ready() -> void:
	target_position = Vector3(0, 0, -5.0)
	enabled = true
	collision_mask = 1
	# Exclude the player's own CharacterBody3D
	var player := _find_player()
	if player:
		add_exception(player)


func _find_player() -> CharacterBody3D:
	var node := get_parent()
	while node:
		if node is CharacterBody3D:
			return node
		node = node.get_parent()
	return null


func _physics_process(_delta: float) -> void:
	if not is_colliding():
		if _current_target != null:
			_current_target = null
			target_changed.emit(null)
		return

	var collider = get_collider()
	if collider is StaticBody3D:
		var is_interactive: bool = collider.get_meta("interactive", false)
		var is_npc: bool = collider.has_meta("npc_name")
		if is_interactive or is_npc:
			if collider != _current_target:
				_current_target = collider
				target_changed.emit(_current_target)
			return

	if _current_target != null:
		_current_target = null
		target_changed.emit(null)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("interact") and _current_target != null:
		interacted.emit(_current_target)
