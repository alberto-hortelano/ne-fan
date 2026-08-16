extends Node3D
## Bench FPS Godot — carga una escena declarativa de labs/fps y la renderiza.
##
## Batch (captura headless, patrón tools/render_sprite_sheets.py):
##   xvfb-run -a godot --path labs/fps/godot --rendering-method forward_plus \
##     res://main.tscn -- --scene exterior --mode parity [--run 015_ext_nano] \
##     --pose p0 --out /abs/p0.png [--frames 12]
## Interactivo (sin --pose/--out): WASD + ratón (click captura), Shift correr.
##
## --mode parity|quality (default parity), --clay fuerza clay aunque haya run.

const PrimMeshBuilderRef := preload("res://scripts/prim_mesh_builder.gd")
const SceneLoaderRef := preload("res://scripts/scene_loader.gd")
const EnvSetupRef := preload("res://scripts/env_setup.gd")
const FpsControllerRef := preload("res://scripts/fps_controller.gd")
const BillboardNpcRef := preload("res://scripts/billboard_npc.gd")

const EYE_M := 1.6

var _scene_data: Dictionary = {}
var _mode := "parity"


func _ready() -> void:
	var args := _parse_args(OS.get_cmdline_user_args())
	var scene_name: String = args.get("scene", "")
	if scene_name == "":
		push_error("main: falta --scene <interior|exterior|...>")
		get_tree().quit(1)
		return
	_mode = args.get("mode", "parity")
	if _mode != "parity" and _mode != "quality":
		push_error("main: --mode debe ser parity|quality, no '%s'" % _mode)
		get_tree().quit(1)
		return

	var base_dir := _labs_fps_dir()
	_scene_data = SceneLoaderRef.load_scene(base_dir, scene_name)
	if _scene_data.is_empty():
		get_tree().quit(1)
		return

	# Layout + banco de materiales (clay si no hay --run o se fuerza --clay).
	var bank: SceneLoaderRef.MaterialBank = null
	var assign: Dictionary = {}
	var run_name: String = args.get("run", "")
	if run_name != "" and not args.has("clay"):
		var run_dir := base_dir.path_join("runs").path_join(run_name)
		var layout := SceneLoaderRef.load_layout(run_dir)
		if layout.is_empty():
			get_tree().quit(1)
			return
		bank = SceneLoaderRef.make_bank(run_dir, layout)
		assign = SceneLoaderRef.assign_by_prim(layout)

	_build_prims(bank, assign)
	EnvSetupRef.apply(self, _scene_data["lights"], _scene_data.get("env", {}), _mode)
	_spawn_npcs(base_dir, args.has("pose"))

	if args.has("pose") and args.has("out"):
		var pose := _find_pose(args["pose"])
		if pose.is_empty():
			push_error("main: pose '%s' no existe en %s" % [args["pose"], scene_name])
			get_tree().quit(1)
			return
		await _capture(pose, args["out"], int(args.get("frames", "0")))
	else:
		_start_interactive()


func _parse_args(argv: PackedStringArray) -> Dictionary:
	var out: Dictionary = {}
	var i := 0
	while i < argv.size():
		var a := argv[i]
		if a.begins_with("--"):
			var key := a.substr(2)
			if i + 1 < argv.size() and not argv[i + 1].begins_with("--"):
				out[key] = argv[i + 1]
				i += 2
			else:
				out[key] = ""
				i += 1
		else:
			push_error("main: argumento inesperado '%s'" % a)
			i += 1
	return out


## labs/fps/ = padre del directorio del proyecto (labs/fps/godot/).
func _labs_fps_dir() -> String:
	return ProjectSettings.globalize_path("res://").path_join("..").simplify_path()


func _build_prims(bank: SceneLoaderRef.MaterialBank, assign: Dictionary) -> void:
	var prims: Array = _scene_data["prims"]
	var built := 0
	for i in prims.size():
		var prim: Dictionary = prims[i]
		var groups_assign: Dictionary = assign.get(i, {})
		# tile_by_group: el builder hornea UVs en metros SOLO para celdas tile.
		var tile_by_group: Dictionary = {}
		for group in groups_assign:
			var cell_key: Variant = groups_assign[group]
			if cell_key is String and bank != null and bank.cells.has(cell_key):
				tile_by_group[group] = bank.cells[cell_key].get("kind", "tile") == "tile"
		var result: Dictionary = PrimMeshBuilderRef.build(prim, tile_by_group)
		if result.is_empty():
			push_error("main: prim %d (%s) no construida" % [i, prim.get("shape", "?")])
			continue
		var mesh_inst := MeshInstance3D.new()
		mesh_inst.mesh = result["mesh"]
		var roughness := float(prim.get("roughness", SceneLoaderRef.DEFAULT_ROUGHNESS))
		var color_hex: String = prim.get("color", "#888888")
		var groups: Array = result["groups"]
		for si in groups.size():
			var mat: StandardMaterial3D = null
			var cell_key: Variant = groups_assign.get(groups[si])
			if cell_key is String and bank != null:
				mat = bank.textured(cell_key, roughness)
			if mat == null:
				var clay_bank := bank if bank != null else SceneLoaderRef.MaterialBank.new()
				mat = clay_bank.clay(color_hex, roughness)
			mesh_inst.set_surface_override_material(si, mat)
		var pos: Array = prim["pos"]
		mesh_inst.position = Vector3(pos[0], pos[1], pos[2])
		# Orden de three: rotation.y y rotation.x como euler YXZ del nodo.
		mesh_inst.rotation = Vector3(float(prim.get("rotX", 0.0)), float(prim.get("rotY", 0.0)), 0.0)
		if prim.get("noShadow", false):
			mesh_inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mesh_inst)
		built += 1
	print("main: %d/%d prims construidas" % [built, prims.size()])


func _spawn_npcs(base_dir: String, static_pose: bool) -> void:
	var sprites_dir := base_dir.path_join("sprites")
	if not DirAccess.dir_exists_absolute(sprites_dir):
		push_warning("main: sin sprites y_bot en %s — NPCs omitidos" % sprites_dir)
		return
	for npc in _scene_data.get("npcs", []):
		var data: Dictionary = npc
		# Patrullas (path): en el bench se colocan en su primer waypoint.
		if not data.has("pos") and data.has("path"):
			data = data.duplicate()
			data["pos"] = data["path"][0]
		var bb: Node3D = BillboardNpcRef.new()
		bb.setup(data, sprites_dir, static_pose)
		add_child(bb)


func _find_pose(pose_id: String) -> Dictionary:
	for pose in _scene_data.get("poses", []):
		if pose.get("id", "") == pose_id:
			return pose
	return {}


func _make_camera(pos_xz: Array, yaw_idx: int) -> Camera3D:
	var cam := Camera3D.new()
	cam.fov = 70.0
	cam.near = 0.3
	cam.far = 600.0
	cam.position = Vector3(pos_xz[0], EYE_M, pos_xz[1])
	# Convención del viewer: cam.rotation.y = -yaw, yaw = yawIdx*45°
	# (yaw 0 mira a -z, crece hacia +x).
	cam.rotation = Vector3(0, -yaw_idx * PI / 4.0, 0)
	return cam


func _capture(pose: Dictionary, out_path: String, frames: int) -> void:
	var cam := _make_camera(pose["pos"], int(pose.get("yawIdx", 0)))
	add_child(cam)
	cam.make_current()
	# SDFGI/temporales necesitan converger; en paridad basta con drenar la
	# carga de texturas.
	var n := frames if frames > 0 else (30 if _mode == "quality" else 4)
	for i in n:
		await RenderingServer.frame_post_draw
	var img: Image = get_viewport().get_texture().get_image()
	if img == null:
		push_error("main: viewport sin imagen (¿--headless?)")
		get_tree().quit(1)
		return
	var err := img.save_png(out_path)
	if err != OK:
		push_error("main: save_png falló (%d) en %s" % [err, out_path])
		get_tree().quit(1)
		return
	print("main: captura %s" % out_path)
	get_tree().quit(0)


func _start_interactive() -> void:
	var start: Dictionary = _scene_data.get("playerStart", {"pos": [32, 48], "yawIdx": 0})
	var controller := FpsControllerRef.new()
	controller.setup(start["pos"], int(start.get("yawIdx", 0)), _scene_data["prims"])
	add_child(controller)
