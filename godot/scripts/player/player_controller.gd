## Player movement controller with combat actions.
## Camera-relative movement, Souls-Like attack patterns.
extends CharacterBody3D

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

const MODEL_TURN_SPEED := 10.0
const POS_THRESHOLD := 0.1
const YAW_THRESHOLD := 0.02
const DASH_POWER := 8.0

var _camera: Node3D = null
var _model: Node3D = null
var _sync: Node = null  # CombatAnimationSync
var _last_dispatched_pos := Vector3.ZERO
var _last_dispatched_yaw := 0.0
var _move_direction := Vector3.ZERO
var _horizontal_velocity := Vector3.ZERO

var _walk_speed := 1.9
var _sprint_speed := 3.8
var _jump_velocity := 4.5
var _is_sprinting := false


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	var config: Dictionary = CombatDataRef.load_config()
	var player_cfg: Dictionary = config.get("player", {})
	_walk_speed = player_cfg.get("walk_speed", 1.9)
	_sprint_speed = player_cfg.get("sprint_speed", 3.8)
	_jump_velocity = player_cfg.get("jump_velocity", 4.5)


func set_camera(camera: Node3D) -> void:
	_camera = camera


func _unhandled_input(event: InputEvent) -> void:
	if not _sync:
		_sync = get_node_or_null("CombatAnimationSync")

	# Attack (LMB) — always uses selected type, no combos
	if event.is_action_pressed("attack_execute") and _sync:
		var pci = get_node_or_null("PlayerCombatInput")
		var attack_type: String = pci.selected_type if pci else "quick"
		_sync.attack(attack_type)
		if pci:
			pci.request_attack(attack_type)


func _physics_process(delta: float) -> void:
	if not _sync:
		_sync = get_node_or_null("CombatAnimationSync")

	# Gravity
	if not is_on_floor():
		velocity += get_gravity() * delta

	# Jump — keeps current horizontal velocity (no stopping)
	if Input.is_action_just_pressed("jump") and is_on_floor():
		if _sync and _sync.is_interruptible():
			velocity.y = _jump_velocity
			_sync.jump()
			# Don't zero horizontal velocity — player keeps moving

	# Input
	var input_dir := Input.get_vector("move_left", "move_right", "move_forward", "move_backward")
	var has_input := input_dir.length() > 0.01
	var can_move: bool = _sync == null or _sync.is_interruptible()

	# Camera-relative movement direction
	var direction := Vector3.ZERO
	if _camera and has_input:
		var cam_basis: Basis = _camera.get_camera_basis()
		var forward := -cam_basis.z
		forward.y = 0
		forward = forward.normalized()
		var right := cam_basis.x
		right.y = 0
		right = right.normalized()
		direction = (forward * -input_dir.y + right * input_dir.x).normalized()

	# Speed
	var movement_speed := 0.0
	_is_sprinting = false
	if can_move and has_input:
		if Input.is_action_pressed("sprint"):
			movement_speed = _sprint_speed
			_is_sprinting = true
		else:
			movement_speed = _walk_speed
		_move_direction = direction

	# Apply velocity
	var acceleration := 15.0

	if _sync and _sync.is_attacking and not _sync.get_current_state() == "jump":
		# During attacks (not jump): almost no movement
		_horizontal_velocity = _horizontal_velocity.lerp(Vector3.ZERO, acceleration * delta)
	elif has_input and can_move:
		_horizontal_velocity = _horizontal_velocity.lerp(direction * movement_speed, acceleration * delta)
	elif not is_on_floor():
		# In air: maintain momentum (reduced deceleration)
		_horizontal_velocity = _horizontal_velocity.lerp(_horizontal_velocity * 0.99, 2.0 * delta)
	else:
		_horizontal_velocity = _horizontal_velocity.lerp(Vector3.ZERO, acceleration * delta)

	velocity.x = _horizontal_velocity.x
	velocity.z = _horizontal_velocity.z

	move_and_slide()

	# Rotate model toward movement direction (not during attacks)
	if not _model:
		_model = get_node_or_null("CombatAnimator")
	if _model and _move_direction.length() > 0.01:
		if can_move:
			var target_yaw: float = atan2(_move_direction.x, _move_direction.z)
			_model.rotation.y = lerp_angle(_model.rotation.y, target_yaw, MODEL_TURN_SPEED * delta)

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
