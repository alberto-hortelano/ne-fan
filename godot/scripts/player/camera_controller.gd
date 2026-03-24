## Independent third-person camera that follows the player with smooth interpolation.
## NOT a child of the player — orbits around them independently.
extends Node3D

const MOUSE_SENSITIVITY := 0.003
const FOLLOW_SPEED := 8.0  # how fast camera follows player position
const MIN_PITCH := -PI / 3.0  # -60°
const MAX_PITCH := PI / 6.0   # 30°

@export var target_path: NodePath
var _target: Node3D = null
var _yaw := 0.0
var _pitch := -0.15  # slight downward look


func _ready() -> void:
	# Will be set by main.gd if target_path is empty
	if not target_path.is_empty():
		_target = get_node(target_path)


func set_target(node: Node3D) -> void:
	_target = node


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_yaw -= event.relative.x * MOUSE_SENSITIVITY
		_pitch -= event.relative.y * MOUSE_SENSITIVITY
		_pitch = clampf(_pitch, MIN_PITCH, MAX_PITCH)

	if event.is_action_pressed("ui_cancel"):
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		else:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _physics_process(delta: float) -> void:
	if not _target:
		return

	# Follow the Hips bone if available (where the character actually is)
	var follow_pos: Vector3 = _target.global_position
	var animator = _target.get_node_or_null("CombatAnimator")
	if animator and animator.has_method("get_hips_world_position"):
		follow_pos = animator.get_hips_world_position()
	var target_pos: Vector3 = follow_pos + Vector3(0, 0.5, 0)
	global_position = global_position.lerp(target_pos, FOLLOW_SPEED * delta)

	# Apply yaw and pitch rotation
	rotation.y = _yaw
	rotation.x = _pitch


func detach(pos: Vector3, yaw: float, pitch: float) -> void:
	"""Stop following target, position camera at absolute coordinates."""
	_target = null
	global_position = pos
	_yaw = yaw
	_pitch = pitch
	rotation.y = _yaw
	rotation.x = _pitch


func attach(target: Node3D) -> void:
	"""Resume following target."""
	_target = target


func get_camera_yaw() -> float:
	return _yaw


func get_camera_basis() -> Basis:
	return global_transform.basis
