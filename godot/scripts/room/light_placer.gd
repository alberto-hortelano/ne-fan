class_name LightPlacer
extends RefCounted

# DEV: boost ambient so objects are visible during development. Set to 1.0 for production.
const DEV_AMBIENT_BOOST = 3.0


func place_lights(lighting_data: Dictionary, room: Node3D) -> void:
	if lighting_data.is_empty():
		_place_default_light(room)
		return

	# Ambient via WorldEnvironment
	var ambient: Dictionary = lighting_data.get("ambient", {})
	_setup_ambient(ambient, room)

	# Individual lights
	var lights: Array = lighting_data.get("lights", [])
	for i in lights.size():
		_create_light(lights[i], i, room)


func _setup_ambient(ambient: Dictionary, room: Node3D) -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR

	var color_arr: Array = ambient.get("color", [0.05, 0.03, 0.02])
	var bg_color := Color(float(color_arr[0]), float(color_arr[1]), float(color_arr[2]))
	env.background_color = bg_color

	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.6, 0.55, 0.5)
	env.ambient_light_energy = float(ambient.get("intensity", 0.3)) * DEV_AMBIENT_BOOST

	env.glow_enabled = true
	env.glow_intensity = 0.3

	var world_env := WorldEnvironment.new()
	world_env.name = "RoomEnvironment"
	world_env.environment = env
	room.add_child(world_env)


func _create_light(data: Dictionary, index: int, room: Node3D) -> void:
	var light_type: String = data.get("type", "point")
	var pos_arr: Array = data.get("position", [0, 3, 0])
	var color_arr: Array = data.get("color", [1.0, 1.0, 1.0])
	var intensity: float = float(data.get("intensity", 1.0))
	var range_val: float = float(data.get("range", 10.0))

	var pos := Vector3(float(pos_arr[0]), float(pos_arr[1]), float(pos_arr[2]))
	var color := Color(float(color_arr[0]), float(color_arr[1]), float(color_arr[2]))

	match light_type:
		"point":
			var light := OmniLight3D.new()
			light.name = "Light_%d" % index
			light.position = pos
			light.light_color = color
			light.light_energy = intensity
			light.omni_range = range_val
			light.shadow_enabled = true
			room.add_child(light)
		"spot":
			var light := SpotLight3D.new()
			light.name = "SpotLight_%d" % index
			light.position = pos
			light.light_color = color
			light.light_energy = intensity
			light.spot_range = range_val
			light.spot_angle = float(data.get("angle", 45.0))
			light.shadow_enabled = true
			room.add_child(light)
			var dir_arr: Array = data.get("direction", [0, -1, 0])
			var dir := Vector3(float(dir_arr[0]), float(dir_arr[1]), float(dir_arr[2]))
			if dir.length() > 0.01:
				var target := pos + dir.normalized()
				var up := Vector3.RIGHT if absf(dir.normalized().dot(Vector3.UP)) > 0.99 else Vector3.UP
				light.look_at(target, up)


func place_outdoor_lights(lighting_data: Dictionary, sky_data: Dictionary,
							fog_data: Dictionary, room: Node3D) -> void:
	var env := Environment.new()

	# Sky
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()

	var time_of_day: String = sky_data.get("time_of_day", "day")
	match time_of_day:
		"dawn":
			sky_mat.sky_top_color = Color(0.3, 0.25, 0.5)
			sky_mat.sky_horizon_color = Color(0.8, 0.5, 0.3)
			sky_mat.ground_bottom_color = Color(0.15, 0.1, 0.08)
			sky_mat.ground_horizon_color = Color(0.6, 0.4, 0.3)
		"day":
			sky_mat.sky_top_color = Color(0.2, 0.4, 0.8)
			sky_mat.sky_horizon_color = Color(0.7, 0.8, 0.9)
			sky_mat.ground_bottom_color = Color(0.2, 0.15, 0.1)
			sky_mat.ground_horizon_color = Color(0.5, 0.5, 0.45)
		"dusk":
			sky_mat.sky_top_color = Color(0.15, 0.1, 0.3)
			sky_mat.sky_horizon_color = Color(0.8, 0.35, 0.15)
			sky_mat.ground_bottom_color = Color(0.1, 0.08, 0.05)
			sky_mat.ground_horizon_color = Color(0.5, 0.3, 0.15)
		"night":
			sky_mat.sky_top_color = Color(0.02, 0.02, 0.08)
			sky_mat.sky_horizon_color = Color(0.05, 0.05, 0.12)
			sky_mat.ground_bottom_color = Color(0.01, 0.01, 0.02)
			sky_mat.ground_horizon_color = Color(0.04, 0.04, 0.08)

	if sky_data.has("sky_top_color"):
		var c: Array = sky_data.get("sky_top_color")
		sky_mat.sky_top_color = Color(float(c[0]), float(c[1]), float(c[2]))
	if sky_data.has("sky_horizon_color"):
		var c: Array = sky_data.get("sky_horizon_color")
		sky_mat.sky_horizon_color = Color(float(c[0]), float(c[1]), float(c[2]))

	sky_mat.use_debanding = true
	sky.sky_material = sky_mat
	env.sky = sky

	# Ambient light — use COLOR source (sky-based gives near-zero at night)
	var ambient: Dictionary = lighting_data.get("ambient", {})
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.6, 0.55, 0.5)
	env.ambient_light_energy = float(ambient.get("intensity", 0.5)) * DEV_AMBIENT_BOOST

	env.glow_enabled = true
	env.glow_intensity = 0.2

	# Fog
	if fog_data.get("enabled", true):
		env.fog_enabled = true
		var fog_color_arr: Array = fog_data.get("color", [0.05, 0.08, 0.06])
		env.fog_light_color = Color(float(fog_color_arr[0]), float(fog_color_arr[1]), float(fog_color_arr[2]))
		env.fog_density = float(fog_data.get("density", 0.02))
		env.fog_aerial_perspective = 0.3

	var world_env := WorldEnvironment.new()
	world_env.name = "RoomEnvironment"
	world_env.environment = env
	room.add_child(world_env)

	# Directional light (sun/moon)
	var dir_light := DirectionalLight3D.new()
	dir_light.name = "SunMoon"
	match time_of_day:
		"dawn":
			dir_light.light_color = Color(1.0, 0.7, 0.4)
			dir_light.light_energy = 0.6
			dir_light.rotation_degrees = Vector3(-20, 30, 0)
		"day":
			dir_light.light_color = Color(1.0, 0.95, 0.85)
			dir_light.light_energy = 1.0
			dir_light.rotation_degrees = Vector3(-45, 30, 0)
		"dusk":
			dir_light.light_color = Color(1.0, 0.5, 0.2)
			dir_light.light_energy = 0.5
			dir_light.rotation_degrees = Vector3(-15, -30, 0)
		"night":
			dir_light.light_color = Color(0.4, 0.5, 0.8)
			dir_light.light_energy = 0.5
			dir_light.rotation_degrees = Vector3(-30, 60, 0)
	dir_light.shadow_enabled = true
	room.add_child(dir_light)

	# Additional point/spot lights from JSON (campfires, glowing mushrooms, etc.)
	var lights: Array = lighting_data.get("lights", [])
	for i in lights.size():
		_create_light(lights[i], i, room)


func _place_default_light(room: Node3D) -> void:
	var light := OmniLight3D.new()
	light.name = "DefaultLight"
	light.position = Vector3(0, 3, 0)
	light.light_color = Color(1.0, 0.9, 0.7)
	light.light_energy = 1.5
	light.omni_range = 12.0
	light.shadow_enabled = true
	room.add_child(light)

	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.05, 0.03, 0.02)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.6, 0.55, 0.5)
	env.ambient_light_energy = 0.3 * DEV_AMBIENT_BOOST


	var world_env := WorldEnvironment.new()
	world_env.name = "RoomEnvironment"
	world_env.environment = env
	room.add_child(world_env)
