extends Node3D
## M0: smoke test de captura headless bajo xvfb — una caja sobre suelo con sol,
## SDFGI y SSAO (efectivos solo en Forward+). Uso:
##   xvfb-run -a godot --path labs/fps/godot --rendering-method forward_plus \
##     res://smoke_test.tscn -- --out /tmp/smoke_fp.png
## Sale con exit 0 si escribió el PNG; exit 1 en cualquier fallo (fail-loud).

const EYE_M := 1.6


func _ready() -> void:
	var out_path := _arg_value("--out")
	if out_path == "":
		push_error("smoke_test: falta --out <ruta.png>")
		get_tree().quit(1)
		return
	_build_scene()
	await _capture(out_path)


func _arg_value(flag: String) -> String:
	var args := OS.get_cmdline_user_args()
	for i in args.size():
		if args[i] == flag and i + 1 < args.size():
			return args[i + 1]
	return ""


func _build_scene() -> void:
	var floor_mesh := MeshInstance3D.new()
	var floor_box := BoxMesh.new()
	floor_box.size = Vector3(20, 0.1, 20)
	floor_mesh.mesh = floor_box
	floor_mesh.position = Vector3(0, -0.05, 0)
	var floor_mat := StandardMaterial3D.new()
	floor_mat.albedo_color = Color.html("#8d6f4e")
	floor_mat.roughness = 0.92
	floor_mesh.material_override = floor_mat
	add_child(floor_mesh)

	var box := MeshInstance3D.new()
	var box_mesh := BoxMesh.new()
	box_mesh.size = Vector3(2, 3, 2)
	box.mesh = box_mesh
	box.position = Vector3(0, 1.5, -6)
	var box_mat := StandardMaterial3D.new()
	box_mat.albedo_color = Color.html("#c9b89a")
	box_mat.roughness = 0.92
	box.material_override = box_mat
	add_child(box)

	var sun := DirectionalLight3D.new()
	sun.position = Vector3(-40, 70, 110)
	sun.look_at_from_position(sun.position, Vector3.ZERO, Vector3.UP)
	sun.light_energy = 1.6
	sun.shadow_enabled = true
	add_child(sun)

	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color.html("#8db4d6")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color.WHITE
	env.ambient_light_energy = 0.85
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.1
	# Efectos Forward+-only: en gl_compatibility se ignoran con warning del motor.
	env.sdfgi_enabled = true
	env.ssao_enabled = true
	var world_env := WorldEnvironment.new()
	world_env.environment = env
	add_child(world_env)

	var cam := Camera3D.new()
	cam.fov = 70.0
	cam.near = 0.3
	cam.far = 600.0
	cam.position = Vector3(0, EYE_M, 2)
	add_child(cam)
	cam.make_current()


func _capture(out_path: String) -> void:
	# Espera de frames reales: SDFGI necesita varios para converger algo.
	for i in 12:
		await RenderingServer.frame_post_draw
	var img: Image = get_viewport().get_texture().get_image()
	if img == null:
		push_error("smoke_test: viewport sin imagen (¿--headless?)")
		get_tree().quit(1)
		return
	var err := img.save_png(out_path)
	if err != OK:
		push_error("smoke_test: save_png falló (%d) en %s" % [err, out_path])
		get_tree().quit(1)
		return
	print("smoke_test: PNG escrito en ", out_path)
	get_tree().quit(0)
