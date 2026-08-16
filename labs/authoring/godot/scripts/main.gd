extends Node3D
## Cala de Brumaluz — bench de autoría libre en Godot 4.6 (Forward+).
##
## Captura headless (patrón labs/fps/godot, JAMÁS --headless):
##   xvfb-run -a godot --path labs/authoring/godot --rendering-method forward_plus \
##     res://main.tscn -- --pose p0 --out /abs/p0.png [--frames 45]
## Sin --pose/--out deja la cámara en p0 (inspección manual).

const VillageRef := preload("res://scripts/village.gd")

const POSES := {
	"p0": [Vector3(-11, 3.8, -9.5), Vector3(26, 1.8, 7)],
	"p1": [Vector3(8, 2.6, 0.8), Vector3(-24, 4.5, -14)],
	"p2": [Vector3(31.5, 4.9, 7.4), Vector3(7, 0.8, 1.8)],
	"p3": [Vector3(12.0, 2.6, 8.2), Vector3(16.3, 2.3, 1.6)],
}


func _ready() -> void:
	var args := _parse_args(OS.get_cmdline_user_args())
	VillageRef.build(self)
	_setup_environment()
	_setup_lights()
	var pose_id: String = args.get("pose", "p0")
	if not POSES.has(pose_id):
		push_error("main: pose desconocida '%s' (p0..p3)" % pose_id)
		get_tree().quit(1)
		return
	var cam := Camera3D.new()
	cam.fov = 62.0
	cam.near = 0.3
	cam.far = 1200.0
	add_child(cam)
	var p: Array = POSES[pose_id]
	cam.look_at_from_position(p[0], p[1])
	cam.make_current()
	if args.has("out"):
		await _capture(args["out"], int(args.get("frames", "45")))


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


func _setup_environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_mat := ShaderMaterial.new()
	sky_mat.shader = load("res://shaders/sky_brumaluz.gdshader")
	sky.sky_material = sky_mat
	env.sky = sky
	# ambiente muestreado del propio cielo (el malva del oeste baña la escena)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 1.0
	env.ambient_light_energy = 1.0
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.15
	# GI en tiempo real: las ventanas/faroles emisivos rebotan de verdad
	env.sdfgi_enabled = true
	env.sdfgi_min_cell_size = 0.3
	env.sdfgi_bounce_feedback = 0.4
	env.sdfgi_energy = 1.2
	env.ssao_enabled = true
	env.ssao_intensity = 2.0
	# bloom real para faro/farolillos/ventanas
	env.glow_enabled = true
	env.glow_intensity = 0.55
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 1.0
	# niebla volumétrica global suave + banco denso en la bocana (FogVolume)
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.0045
	env.volumetric_fog_albedo = Color("#98a0b8")
	env.volumetric_fog_length = 160.0
	env.volumetric_fog_ambient_inject = 0.12
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var fog := FogVolume.new()
	fog.size = Vector3(60, 12, 80)
	fog.position = Vector3(-48, 3, -8)
	var fm := FogMaterial.new()
	fm.density = 0.08
	fm.edge_fade = 0.55
	fm.albedo = Color(0.62, 0.65, 0.78)
	fog.material = fm
	add_child(fog)


func _setup_lights() -> void:
	# clave ámbar del cielo del oeste, rasante
	var key := DirectionalLight3D.new()
	key.light_color = Color("#e8964a")
	key.light_energy = 0.5
	key.shadow_enabled = true
	key.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	key.directional_shadow_blend_splits = true
	key.light_angular_distance = 1.2
	add_child(key)
	key.look_at_from_position(Vector3(-80, 16, -18), Vector3(24, 2, 2))
	# relleno frío cenital muy suave (además del ambient del cielo)
	var fill := DirectionalLight3D.new()
	fill.light_color = Color("#46538a")
	fill.light_energy = 0.15
	add_child(fill)
	fill.look_at_from_position(Vector3(30, 60, 40), Vector3(0, 0, 0))


func _capture(out_path: String, frames: int) -> void:
	for i in maxi(frames, 4):
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
