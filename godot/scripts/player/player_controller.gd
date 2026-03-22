extends CharacterBody3D

const SPEED := 3.0
const SPRINT_SPEED := 5.5
const JUMP_VELOCITY := 4.5
const MOUSE_SENSITIVITY := 0.003
const MODEL_TURN_SPEED := 10.0
const POS_THRESHOLD := 0.1
const YAW_THRESHOLD := 0.02

@onready var _camera_pivot: Node3D = $CameraPivot
var _model: Node3D = null
var _last_dispatched_pos := Vector3.ZERO
var _last_dispatched_yaw := 0.0


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_camera_pivot.rotation.y -= event.relative.x * MOUSE_SENSITIVITY
		_camera_pivot.rotation.x -= event.relative.y * MOUSE_SENSITIVITY
		_camera_pivot.rotation.x = clampf(_camera_pivot.rotation.x, -PI / 3.0, PI / 4.0)

	if event.is_action_pressed("ui_cancel"):
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		else:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta

	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = JUMP_VELOCITY

	var input_dir := Input.get_vector("move_left", "move_right", "move_forward", "move_backward")

	# Movement relative to camera facing direction
	var cam_basis := _camera_pivot.global_transform.basis
	var forward := -cam_basis.z
	forward.y = 0
	forward = forward.normalized()
	var right := cam_basis.x
	right.y = 0
	right = right.normalized()

	var direction := (forward * -input_dir.y + right * input_dir.x).normalized()

	var speed := SPRINT_SPEED if Input.is_action_pressed("sprint") else SPEED

	if direction:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
	else:
		velocity.x = move_toward(velocity.x, 0, speed)
		velocity.z = move_toward(velocity.z, 0, speed)

	move_and_slide()

	# Dispatch state changes (throttled)
	if position.distance_to(_last_dispatched_pos) > POS_THRESHOLD:
		_last_dispatched_pos = position
		GameStore.dispatch("player_moved", {
			"pos": [position.x, position.y, position.z],
			"velocity": [velocity.x, velocity.y, velocity.z],
		})
	var yaw: float = _camera_pivot.rotation.y
	if absf(yaw - _last_dispatched_yaw) > YAW_THRESHOLD:
		_last_dispatched_yaw = yaw
		GameStore.dispatch("camera_rotated", {
			"yaw": yaw,
			"pitch": _camera_pivot.rotation.x,
		})

	# Rotate model to face camera yaw
	if not _model:
		_model = get_node_or_null("CombatAnimator")
	if _model:
		var target_yaw: float = _camera_pivot.rotation.y + PI
		_model.rotation.y = lerp_angle(_model.rotation.y, target_yaw, MODEL_TURN_SPEED * delta)
