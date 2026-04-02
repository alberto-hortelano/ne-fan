class_name ExitBuilder
extends RefCounted

const EXIT_COLOR = Color(0.1, 0.1, 0.15, 0.8)


func build_exits(exits: Array, dims: Dictionary, room: Node3D) -> Array[Area3D]:
	var areas: Array[Area3D] = []
	var w: float = float(dims.get("width", 10.0))
	var h: float = float(dims.get("height", 4.0))
	var d: float = float(dims.get("depth", 8.0))

	for exit_data in exits:
		var area := _create_exit_trigger(exit_data, w, h, d)
		if area:
			room.add_child(area)
			areas.append(area)

	return areas


func _create_exit_trigger(data: Dictionary, w: float, h: float, d: float) -> Area3D:
	# Positional exit (outdoor zones): placed at explicit coordinates
	if data.has("position"):
		return _create_positioned_exit(data)

	var wall: String = data.get("wall", "north")
	var offset: float = float(data.get("offset", 0.0))
	var exit_size: Array = data.get("size", [2.0, 3.0])
	var exit_w: float = float(exit_size[0])
	var exit_h: float = float(exit_size[1])

	var area := Area3D.new()
	area.name = "Exit_%s" % wall
	area.set_meta("description", data.get("description", ""))
	area.set_meta("target_hint", data.get("target_hint", ""))
	area.set_meta("wall", wall)

	# Position trigger in the exit gap
	var pos := Vector3.ZERO
	var trigger_depth := 0.5  # thickness of trigger zone
	var trigger_size := Vector3.ZERO

	match wall:
		"north":
			pos = Vector3(offset, exit_h / 2.0, -d / 2.0)
			trigger_size = Vector3(exit_w, exit_h, trigger_depth)
		"south":
			pos = Vector3(offset, exit_h / 2.0, d / 2.0)
			trigger_size = Vector3(exit_w, exit_h, trigger_depth)
		"east":
			pos = Vector3(w / 2.0, exit_h / 2.0, offset)
			trigger_size = Vector3(trigger_depth, exit_h, exit_w)
		"west":
			pos = Vector3(-w / 2.0, exit_h / 2.0, offset)
			trigger_size = Vector3(trigger_depth, exit_h, exit_w)
		_:
			return null

	area.position = pos

	# Collision shape for trigger detection
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = trigger_size
	collision.shape = shape
	area.add_child(collision)

	# Visual indicator: dark semi-transparent plane at exit
	var mesh_inst := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(exit_w, exit_h, 0.02)
	mesh_inst.mesh = box

	var mat := StandardMaterial3D.new()
	mat.albedo_color = EXIT_COLOR
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mesh_inst.material_override = mat

	# Rotate visual plane for east/west exits
	if wall == "east" or wall == "west":
		mesh_inst.rotation_degrees.y = 90.0

	area.add_child(mesh_inst)

	# Only detect player (layer 1), don't be detectable
	area.monitoring = true
	area.monitorable = false
	area.collision_layer = 0
	area.collision_mask = 1

	return area


func _create_positioned_exit(data: Dictionary) -> Area3D:
	var pos_arr: Array = data.get("position", [0, 0, 0])
	var exit_size: Array = data.get("size", [3.0, 4.0])
	var exit_w: float = float(exit_size[0])
	var exit_h: float = float(exit_size[1])
	var rot_y: float = float(data.get("rotation_y", 0.0))

	var area := Area3D.new()
	area.name = "Exit_pos_%d_%d" % [int(pos_arr[0]), int(pos_arr[2])]
	area.set_meta("description", data.get("description", ""))
	area.set_meta("target_hint", data.get("target_hint", ""))
	area.set_meta("wall", data.get("wall", "north"))
	area.position = Vector3(float(pos_arr[0]), float(pos_arr[1]) + exit_h / 2.0, float(pos_arr[2]))
	area.rotation_degrees.y = rot_y

	# Collision shape
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(exit_w, exit_h, 0.5)
	collision.shape = shape
	area.add_child(collision)

	# Visual indicator
	var mesh_inst := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(exit_w, exit_h, 0.02)
	mesh_inst.mesh = box
	var mat := StandardMaterial3D.new()
	mat.albedo_color = EXIT_COLOR
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mesh_inst.material_override = mat
	area.add_child(mesh_inst)

	# Only detect player
	area.monitoring = true
	area.monitorable = false
	area.collision_layer = 0
	area.collision_mask = 1

	return area
