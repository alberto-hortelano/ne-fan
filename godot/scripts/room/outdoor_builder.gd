## Builds outdoor zones from JSON data: ground plane, sky, vegetation, fog, lighting.
## Follows same pattern as RoomBuilder (RefCounted, Dictionary -> Node3D).
class_name OutdoorBuilder
extends RefCounted

const ObjectSpawnerScript = preload("res://scripts/room/object_spawner.gd")
const LightPlacerScript = preload("res://scripts/room/light_placer.gd")
const ExitBuilderScript = preload("res://scripts/room/exit_builder.gd")
const VegetationSpawnerScript = preload("res://scripts/room/vegetation_spawner.gd")
const ChunkManagerScript = preload("res://scripts/world/chunk_manager.gd")

const GROUND_COLOR = Color(0.25, 0.35, 0.15)

var object_spawner = ObjectSpawnerScript.new()
var light_placer = LightPlacerScript.new()
var exit_builder = ExitBuilderScript.new()
var vegetation_spawner = VegetationSpawnerScript.new()
var exit_areas: Array[Area3D] = []


func build_outdoor(data: Dictionary) -> Node3D:
	exit_areas.clear()

	var room := Node3D.new()
	room.name = data.get("room_id", "OutdoorZone")

	var dims: Dictionary = data.get("dimensions", {"width": 50.0, "depth": 50.0})
	var w: float = float(dims.get("width", 50.0))
	var d: float = float(dims.get("depth", 50.0))
	var terrain_data: Dictionary = data.get("terrain", {})

	# Sky + fog + directional light
	var sky_data: Dictionary = data.get("sky", {})
	var fog_data: Dictionary = data.get("fog", {})
	var lighting_data: Dictionary = data.get("lighting", {})
	light_placer.place_outdoor_lights(lighting_data, sky_data, fog_data, room)

	var veg_data: Dictionary = data.get("vegetation", {})

	if terrain_data.get("chunked", false):
		# Infinite chunked terrain — ChunkManager handles ground + vegetation
		var chunk_mgr := ChunkManagerScript.new()
		chunk_mgr.name = "ChunkManager"
		chunk_mgr.setup(terrain_data, veg_data)
		room.add_child(chunk_mgr)
	else:
		# Static ground plane + vegetation
		_build_ground(room, w, d, terrain_data)
		var ground_size := Vector2(w, d)
		if veg_data.has("grass"):
			vegetation_spawner.spawn_grass(veg_data.get("grass"), ground_size, room)
		if veg_data.has("bushes"):
			vegetation_spawner.spawn_bushes(veg_data.get("bushes"), ground_size, room)
		if veg_data.has("trees"):
			vegetation_spawner.spawn_trees(veg_data.get("trees"), room)

	# Objects & NPCs (reuse existing spawner)
	object_spawner.spawn_objects(data.get("objects", []), room)
	object_spawner.spawn_npcs(data.get("npcs", []), room)

	# Exits (supports both wall-based and positional)
	exit_areas = exit_builder.build_exits(data.get("exits", []), dims, room)

	return room


func _build_ground(room: Node3D, w: float, d: float, terrain_data: Dictionary) -> void:
	var body := StaticBody3D.new()
	body.name = "Ground"
	body.position = Vector3(0, 0, 0)
	room.add_child(body)

	var mesh_inst := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(w, d)
	mesh_inst.mesh = plane

	var mat := StandardMaterial3D.new()
	mat.albedo_color = GROUND_COLOR
	mesh_inst.material_override = mat
	body.add_child(mesh_inst)

	# Collision: thin box at ground level
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(w, 0.1, d)
	collision.shape = shape
	collision.position.y = -0.05
	body.add_child(collision)

	# Texture metadata for AI texture generation
	if terrain_data.has("ground_texture_prompt"):
		body.set_meta("texture_prompt", terrain_data.get("ground_texture_prompt"))
	if terrain_data.has("tiling"):
		body.set_meta("tiling", terrain_data.get("tiling"))
	else:
		body.set_meta("tiling", [4, 4])
