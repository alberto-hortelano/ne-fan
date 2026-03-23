## Player movement controller. Camera is external (set via set_camera).
## Model rotates toward movement direction, not camera direction.
extends CharacterBody3D

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

const MODEL_TURN_SPEED := 10.0
const POS_THRESHOLD := 0.1
const YAW_THRESHOLD := 0.02

var _camera: Node3D = null  # CameraController (external)
var _model: Node3D = null
var _last_dispatched_pos := Vector3.ZERO
var _last_dispatched_yaw := 0.0
var _move_direction := Vector3.ZERO  # last non-zero movement direction

var _walk_speed := 3.0
var _sprint_speed := 5.5
var _jump_velocity := 4.5


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	var config: Dictionary = CombatDataRef.load_config()
	var player_cfg: Dictionary = config.get("player", {})
	_walk_speed = player_cfg.get("walk_speed", 3.0)
	_sprint_speed = player_cfg.get("sprint_speed", 5.5)
	_jump_velocity = player_cfg.get("jump_velocity", 4.5)


func set_camera(camera: Node3D) -> void:
	_camera = camera


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta

	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = _jump_velocity

	var input_dir := Input.get_vector("move_left", "move_right", "move_forward", "move_backward")

	# Movement relative to camera facing direction
	var direction := Vector3.ZERO
	if _camera and input_dir.length() > 0.01:
		var cam_basis: Basis = _camera.get_camera_basis()
		var forward := -cam_basis.z
		forward.y = 0
		forward = forward.normalized()
		var right := cam_basis.x
		right.y = 0
		right = right.normalized()
		direction = (forward * -input_dir.y + right * input_dir.x).normalized()

	var speed := _sprint_speed if Input.is_action_pressed("sprint") else _walk_speed

	if direction:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
		_move_direction = direction
	else:
		velocity.x = move_toward(velocity.x, 0, speed)
		velocity.z = move_toward(velocity.z, 0, speed)

	move_and_slide()

	# Rotate model toward movement direction (not camera)
	if not _model:
		_model = get_node_or_null("CombatAnimator")
	if _model and _move_direction.length() > 0.01:
		var target_yaw: float = atan2(_move_direction.x, _move_direction.z)
		_model.rotation.y = lerp_angle(_model.rotation.y, target_yaw, MODEL_TURN_SPEED * delta)

	# Sync body position to where animation moved the model (root motion)
	# The Hips bone moves with the animation; we follow it.
	if _model and _model._skeleton and _model._hips_idx >= 0:
		var hips_global: Vector3 = _model._skeleton.global_position
		var hips_bone_pos: Vector3 = _model._skeleton.get_bone_global_pose(_model._hips_idx).origin
		var hips_world: Vector3 = _model._skeleton.global_transform * hips_bone_pos
		# Move body XZ to match hips, keep body Y from physics
		var offset_x: float = hips_world.x - global_position.x
		var offset_z: float = hips_world.z - global_position.z
		if absf(offset_x) > 0.01 or absf(offset_z) > 0.01:
			position.x += offset_x
			position.z += offset_z
			# Compensate model so it doesn't double-move (body moved, model is child)
			_model.position.x -= offset_x
			_model.position.z -= offset_z

	# Dispatch state changes (throttled)
	if position.distance_to(_last_dispatched_pos) > POS_THRESHOLD:
		_last_dispatched_pos = position
		GameStore.dispatch("player_moved", {
			"pos": [position.x, position.y, position.z],
			"velocity": [velocity.x, velocity.y, velocity.z],
		})
	if _camera:
		var yaw: float = _camera.get_camera_yaw()
		if absf(yaw - _last_dispatched_yaw) > YAW_THRESHOLD:
			_last_dispatched_yaw = yaw
			GameStore.dispatch("camera_rotated", {
				"yaw": yaw,
				"pitch": _camera.rotation.x,
			})
