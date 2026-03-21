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
			var dir_arr: Array = data.get("direction", [0, -1, 0])
			var dir := Vector3(float(dir_arr[0]), float(dir_arr[1]), float(dir_arr[2]))
			if dir.length() > 0.01:
				var target := pos + dir.normalized()
				var up := Vector3.RIGHT if absf(dir.normalized().dot(Vector3.UP)) > 0.99 else Vector3.UP
				light.look_at(target, up)
			room.add_child(light)


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
