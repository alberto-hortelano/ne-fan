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

	# Extract exclusion zones from building objects (vegetation shouldn't grow inside buildings)
	var exclusion_zones: Array = _extract_building_zones(data.get("objects", []))

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
			vegetation_spawner.spawn_grass(veg_data.get("grass"), ground_size, room, exclusion_zones)
		if veg_data.has("bushes"):
			vegetation_spawner.spawn_bushes(veg_data.get("bushes"), ground_size, room, exclusion_zones)
		if veg_data.has("trees"):
			vegetation_spawner.spawn_trees(veg_data.get("trees"), room, exclusion_zones)

	# Objects & NPCs (reuse existing spawner)
	object_spawner.spawn_objects(data.get("objects", []), room)
	object_spawner.spawn_npcs(data.get("npcs", []), room)

	# Exits (supports both wall-based and positional)
	exit_areas = exit_builder.build_exits(data.get("exits", []), dims, room)

	return room


## Extract rectangular exclusion zones from building objects (floor pieces).
## Returns array of Rect2 in XZ plane where vegetation should not spawn.
func _extract_building_zones(objects: Array) -> Array:
	var zones: Array = []
	for obj in objects:
		if obj.get("category", "") != "building":
			continue
		var pos: Array = obj.get("position", [0, 0, 0])
		var scale: Array = obj.get("scale", [1, 1, 1])
		var sx: float = float(scale[0])
		var sy: float = float(scale[1])
		var sz: float = float(scale[2])
		# Only use floor-like pieces (thin and wide) to define the zone
		# Floor: thin Y (< 0.5), wide XZ
		if sy < 0.5 and sx > 1.0 and sz > 1.0:
			var cx: float = float(pos[0])
			var cz: float = float(pos[2])
			# Add margin around building
			var margin: float = 1.0
			zones.append(Rect2(cx - sx / 2.0 - margin, cz - sz / 2.0 - margin, sx + margin * 2, sz + margin * 2))
	return zones


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
	var ground_prompt: String = terrain_data.get("ground_texture_prompt", terrain_data.get("texture_prompt", ""))
	if not ground_prompt.is_empty():
		body.set_meta("texture_prompt", ground_prompt)
	if terrain_data.has("tiling"):
		body.set_meta("tiling", terrain_data.get("tiling"))
	else:
		body.set_meta("tiling", [4, 4])
