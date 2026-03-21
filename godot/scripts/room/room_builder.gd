class_name RoomBuilder
extends RefCounted

const ObjectSpawnerScript = preload("res://scripts/room/object_spawner.gd")
const LightPlacerScript = preload("res://scripts/room/light_placer.gd")
const ExitBuilderScript = preload("res://scripts/room/exit_builder.gd")

const WALL_THICKNESS = 0.15
const FLOOR_COLOR = Color(0.3, 0.28, 0.25)
const CEILING_COLOR = Color(0.2, 0.2, 0.22)
const WALL_COLORS = {
	"north": Color(0.35, 0.33, 0.38),
	"south": Color(0.38, 0.35, 0.33),
	"east": Color(0.33, 0.38, 0.30),
	"west": Color(0.36, 0.33, 0.35),
}

var object_spawner = ObjectSpawnerScript.new()
var light_placer = LightPlacerScript.new()
var exit_builder = ExitBuilderScript.new()
var exit_areas: Array[Area3D] = []


func build_room(data: Dictionary) -> Node3D:
	exit_areas.clear()

	var room := Node3D.new()
	room.name = data.get("room_id", "Room")

	var dims: Dictionary = data.get("dimensions", {"width": 10.0, "height": 4.0, "depth": 8.0})
	var w: float = float(dims.get("width", 10.0))
	var h: float = float(dims.get("height", 4.0))
	var d: float = float(dims.get("depth", 8.0))

	var surfaces: Dictionary = data.get("surfaces", {})
	var exits: Array = data.get("exits", [])

	# Floor (top surface at y=0)
	_create_surface(room, "Floor",
		Vector3(0, -WALL_THICKNESS / 2.0, 0),
		Vector3(w, WALL_THICKNESS, d),
		FLOOR_COLOR, surfaces.get("floor", {}))

	# Ceiling (bottom surface at y=h)
	_create_surface(room, "Ceiling",
		Vector3(0, h + WALL_THICKNESS / 2.0, 0),
		Vector3(w, WALL_THICKNESS, d),
		CEILING_COLOR, surfaces.get("ceiling", {}))

	# Build wall surface lookup
	var wall_surface_map := {}
	for wall_data in surfaces.get("walls", []):
		wall_surface_map[wall_data.get("side", "")] = wall_data

	# Walls
	_build_walls(room, w, h, d, exits, wall_surface_map)

	# Objects & NPCs
	object_spawner.spawn_objects(data.get("objects", []), room)
	object_spawner.spawn_npcs(data.get("npcs", []), room)

	# Lighting
	light_placer.place_lights(data.get("lighting", {}), room)

	# Exit triggers
	exit_areas = exit_builder.build_exits(exits, dims, room)

	return room


func _build_walls(room: Node3D, w: float, h: float, d: float,
					exits: Array, wall_surfaces: Dictionary) -> void:
	var sides := {
		"north": {"pos": Vector3(0, h / 2.0, -d / 2.0), "length": w, "axis": "x"},
		"south": {"pos": Vector3(0, h / 2.0, d / 2.0), "length": w, "axis": "x"},
		"east": {"pos": Vector3(w / 2.0, h / 2.0, 0), "length": d, "axis": "z"},
		"west": {"pos": Vector3(-w / 2.0, h / 2.0, 0), "length": d, "axis": "z"},
	}

	for side_name in sides:
		var info: Dictionary = sides[side_name]
		var wall_exits := _get_exits_for_wall(side_name, exits)
		var color: Color = WALL_COLORS.get(side_name, Color(0.35, 0.35, 0.35))
		var surface_data: Dictionary = wall_surfaces.get(side_name, {})
		var length: float = info.length

		# Full wall size
		var full_size: Vector3
		if info.axis == "x":
			full_size = Vector3(length, h, WALL_THICKNESS)
		else:
			full_size = Vector3(WALL_THICKNESS, h, length)

		if wall_exits.is_empty():
			_create_surface(room, "Wall_%s" % side_name, info.pos, full_size, color, surface_data)
		else:
			# Phase 1: handle first exit only
			_create_wall_with_gap(room, side_name, info, wall_exits[0], h, length, color, surface_data)


func _create_wall_with_gap(room: Node3D, side_name: String, info: Dictionary,
							exit_data: Dictionary, wall_h: float, wall_len: float,
							color: Color, surface_data: Dictionary) -> void:
	var axis: String = info.axis
	var half_len := wall_len / 2.0

	var offset: float = float(exit_data.get("offset", 0.0))
	var exit_size: Array = exit_data.get("size", [2.0, 3.0])
	var exit_w: float = float(exit_size[0])
	var exit_h: float = float(exit_size[1])

	var left_start := -half_len
	var left_end := offset - exit_w / 2.0
	var right_start := offset + exit_w / 2.0
	var right_end := half_len

	# Left segment
	var left_len := left_end - left_start
	if left_len > 0.01:
		var center := (left_start + left_end) / 2.0
		var seg_pos := Vector3.ZERO
		var seg_size := Vector3.ZERO
		if axis == "x":
			seg_pos = Vector3(center, wall_h / 2.0, info.pos.z)
			seg_size = Vector3(left_len, wall_h, WALL_THICKNESS)
		else:
			seg_pos = Vector3(info.pos.x, wall_h / 2.0, center)
			seg_size = Vector3(WALL_THICKNESS, wall_h, left_len)
		_create_surface(room, "Wall_%s_L" % side_name, seg_pos, seg_size, color, surface_data)

	# Right segment
	var right_len := right_end - right_start
	if right_len > 0.01:
		var center := (right_start + right_end) / 2.0
		var seg_pos := Vector3.ZERO
		var seg_size := Vector3.ZERO
		if axis == "x":
			seg_pos = Vector3(center, wall_h / 2.0, info.pos.z)
			seg_size = Vector3(right_len, wall_h, WALL_THICKNESS)
		else:
			seg_pos = Vector3(info.pos.x, wall_h / 2.0, center)
			seg_size = Vector3(WALL_THICKNESS, wall_h, right_len)
		_create_surface(room, "Wall_%s_R" % side_name, seg_pos, seg_size, color, surface_data)

	# Top segment (above exit opening)
	var top_h := wall_h - exit_h
	if top_h > 0.01:
		var center_y := exit_h + top_h / 2.0
		var seg_pos := Vector3.ZERO
		var seg_size := Vector3.ZERO
		if axis == "x":
			seg_pos = Vector3(offset, center_y, info.pos.z)
			seg_size = Vector3(exit_w, top_h, WALL_THICKNESS)
		else:
			seg_pos = Vector3(info.pos.x, center_y, offset)
			seg_size = Vector3(WALL_THICKNESS, top_h, exit_w)
		_create_surface(room, "Wall_%s_T" % side_name, seg_pos, seg_size, color, surface_data)


func _create_surface(parent: Node3D, surface_name: String, pos: Vector3,
						size: Vector3, color: Color, surface_data: Dictionary = {}) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = surface_name
	body.position = pos
	parent.add_child(body)

	var mesh_inst := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh_inst.mesh = box

	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mesh_inst.material_override = mat
	body.add_child(mesh_inst)

	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)

	# Store metadata for future texture generation
	if surface_data.has("texture_prompt"):
		body.set_meta("texture_prompt", surface_data.get("texture_prompt"))
	if surface_data.has("tiling"):
		body.set_meta("tiling", surface_data.get("tiling"))

	return body


func _get_exits_for_wall(wall_name: String, exits: Array) -> Array:
	var result := []
	for exit in exits:
		if exit.get("wall", "") == wall_name:
			result.append(exit)
	return result
