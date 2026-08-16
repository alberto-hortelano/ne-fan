class_name FpsController
extends CharacterBody3D
## Controller primera persona del bench: WASD relativo al yaw, ratón orienta
## (click captura el puntero, ESC lo suelta), Shift corre. Colisión simple:
## un BoxShape3D estático por AABB de prim sólida (misma regla que
## collidersFromPrims de lib.mjs: h>0.4, base<1.2, ni terrain/decor ni copas).

const EYE_M := 1.6
const WALK := 4.0
const RUN_SPEED := 6.5
const MOUSE_SENS := 0.0025

var _yaw := 0.0
var _cam: Camera3D
var _prims: Array = []


func setup(pos_xz: Array, yaw_idx: int, prims: Array) -> void:
	_prims = prims
	position = Vector3(pos_xz[0], 0, pos_xz[1])
	_yaw = yaw_idx * PI / 4.0
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.35
	capsule.height = 1.7
	shape.shape = capsule
	shape.position = Vector3(0, 0.85, 0)
	add_child(shape)
	_cam = Camera3D.new()
	_cam.fov = 70.0
	_cam.near = 0.3
	_cam.far = 600.0
	_cam.position = Vector3(0, EYE_M, 0)
	add_child(_cam)


func _ready() -> void:
	_cam.make_current()
	_apply_yaw()
	# Los colliders necesitan el padre (mundo): solo existe a partir de aquí.
	_add_colliders(_prims)


func _add_colliders(prims: Array) -> void:
	# Los colliders cuelgan del PADRE (mundo), no del body.
	var world := get_parent()
	if world == null:
		push_error("FpsController: sin padre para los colliders")
		return
	for prim in prims:
		var cat: String = prim.get("cat", "")
		if cat == "terrain" or cat == "decor":
			continue
		var pos: Array = prim["pos"]
		var size: Array = prim["size"]
		var h := float(size[1]) if size.size() > 1 else 0.0
		var base_y := float(pos[1])
		if prim.get("shape", "") == "polygon" or h <= 0.4 or base_y > 1.2:
			continue
		# Copas de árbol: esfera/cono elevado ya cae por base_y.
		var w: float
		var d: float
		match prim.get("shape", ""):
			"box", "gable":
				w = float(size[0])
				d = float(size[2])
			"cylinder", "cone":
				w = float(size[0]) * 2.0
				d = w
			_:
				continue
		var body := StaticBody3D.new()
		var cshape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(w, h, d)
		cshape.shape = box
		body.position = Vector3(pos[0], base_y + h / 2.0, pos[2])
		body.rotation = Vector3(0, float(prim.get("rotY", 0.0)), 0)
		body.add_child(cshape)
		world.add_child.call_deferred(body)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_yaw -= event.relative.x * MOUSE_SENS
		_apply_yaw()
	elif event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _apply_yaw() -> void:
	# Mismo criterio que el viewer: mirar = (sin yaw, 0, -cos yaw).
	rotation = Vector3(0, -_yaw, 0)


func _physics_process(_delta: float) -> void:
	var input_dir := Vector2.ZERO
	if Input.is_key_pressed(KEY_W):
		input_dir.y += 1
	if Input.is_key_pressed(KEY_S):
		input_dir.y -= 1
	if Input.is_key_pressed(KEY_D):
		input_dir.x += 1
	if Input.is_key_pressed(KEY_A):
		input_dir.x -= 1
	var speed := RUN_SPEED if Input.is_key_pressed(KEY_SHIFT) else WALK
	var fwd := Vector3(sin(_yaw), 0, -cos(_yaw))
	var right := Vector3(-fwd.z, 0, fwd.x)
	var motion := (fwd * input_dir.y + right * input_dir.x)
	if motion.length() > 0.001:
		motion = motion.normalized() * speed
	velocity = Vector3(motion.x, 0, motion.z)
	move_and_slide()
	position.y = 0.0
