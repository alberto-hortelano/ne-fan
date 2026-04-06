## Spawns procedural vegetation: grass (MultiMesh), bushes (MultiMesh), trees (individual nodes).
class_name VegetationSpawner
extends RefCounted


func spawn_grass(config: Dictionary, ground_size: Vector2, parent: Node3D, exclusion_zones: Array = []) -> MultiMeshInstance3D:
	var density: int = int(config.get("density", 2000))
	var radius: float = float(config.get("radius", 20.0))
	var scale_range: Array = config.get("scale_range", [0.3, 0.6])
	var scale_min: float = float(scale_range[0])
	var scale_max: float = float(scale_range[1])
	var seed_val: int = int(config.get("seed", 12345))

	var cross_mesh := _create_cross_mesh(1.0)
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.instance_count = density
	multi.mesh = cross_mesh

	var rng := RandomNumberGenerator.new()
	rng.seed = seed_val
	var half_w: float = minf(ground_size.x / 2.0, radius)
	var half_d: float = minf(ground_size.y / 2.0, radius)

	for i in density:
		var x: float = rng.randf_range(-half_w, half_w)
		var z: float = rng.randf_range(-half_d, half_d)
		# Skip if inside an exclusion zone (building area)
		if _in_exclusion_zone(x, z, exclusion_zones):
			var t := Transform3D()
			t = t.scaled(Vector3.ZERO)
			multi.set_instance_transform(i, t)
			continue
		var s: float = rng.randf_range(scale_min, scale_max)
		var rot_y: float = rng.randf_range(0, TAU)
		var t := Transform3D()
		t = t.scaled(Vector3(s, s, s))
		t = t.rotated(Vector3.UP, rot_y)
		t.origin = Vector3(x, 0, z)
		multi.set_instance_transform(i, t)

	var inst := MultiMeshInstance3D.new()
	inst.name = "Grass"
	inst.multimesh = multi

	# Material with alpha scissor for cutout transparency
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.25, 0.45, 0.15)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = 0.5
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	inst.material_override = mat

	# Store sprite_prompt for AI sprite generation (image with transparent background)
	if config.has("sprite_prompt"):
		inst.set_meta("sprite_prompt", config.get("sprite_prompt"))
	elif config.has("texture_prompt"):
		inst.set_meta("texture_prompt", config.get("texture_prompt"))
		inst.set_meta("tiling", [1, 1])

	parent.add_child(inst)
	return inst


func spawn_bushes(config: Dictionary, ground_size: Vector2, parent: Node3D, exclusion_zones: Array = []) -> MultiMeshInstance3D:
	var count: int = int(config.get("count", 30))
	var radius: float = float(config.get("radius", 22.0))
	var scale_range: Array = config.get("scale_range", [0.5, 1.2])
	var scale_min: float = float(scale_range[0])
	var scale_max: float = float(scale_range[1])
	var seed_val: int = int(config.get("seed", 54321))

	var cross_mesh := _create_cross_mesh(1.0)
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.instance_count = count
	multi.mesh = cross_mesh

	var rng := RandomNumberGenerator.new()
	rng.seed = seed_val
	var half_w: float = minf(ground_size.x / 2.0, radius)
	var half_d: float = minf(ground_size.y / 2.0, radius)

	for i in count:
		var x: float = rng.randf_range(-half_w, half_w)
		var z: float = rng.randf_range(-half_d, half_d)
		if _in_exclusion_zone(x, z, exclusion_zones):
			var t := Transform3D()
			t = t.scaled(Vector3.ZERO)
			multi.set_instance_transform(i, t)
			continue
		var s: float = rng.randf_range(scale_min, scale_max)
		var rot_y: float = rng.randf_range(0, TAU)
		var t := Transform3D()
		t = t.scaled(Vector3(s, s, s))
		t = t.rotated(Vector3.UP, rot_y)
		t.origin = Vector3(x, 0, z)
		multi.set_instance_transform(i, t)

	var inst := MultiMeshInstance3D.new()
	inst.name = "Bushes"
	inst.multimesh = multi

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.2, 0.4, 0.12)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = 0.5
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	inst.material_override = mat

	if config.has("sprite_prompt"):
		inst.set_meta("sprite_prompt", config.get("sprite_prompt"))
	elif config.has("texture_prompt"):
		inst.set_meta("texture_prompt", config.get("texture_prompt"))
		inst.set_meta("tiling", [1, 1])

	parent.add_child(inst)
	return inst


func spawn_trees(config: Dictionary, parent: Node3D, exclusion_zones: Array = []) -> Node3D:
	var count: int = int(config.get("count", 40))
	var inner_r: float = float(config.get("ring_inner_radius", 18.0))
	var outer_r: float = float(config.get("ring_outer_radius", 25.0))
	var trunk_h_range: Array = config.get("trunk_height_range", [4.0, 8.0])
	var trunk_r_range: Array = config.get("trunk_radius_range", [0.2, 0.5])
	var canopy_r_range: Array = config.get("canopy_radius_range", [2.0, 4.0])
	var seed_val: int = int(config.get("seed", 99999))

	var container := Node3D.new()
	container.name = "Trees"

	var rng := RandomNumberGenerator.new()
	rng.seed = seed_val

	for i in count:
		# Distribute in ring around clearing
		var angle: float = rng.randf_range(0, TAU)
		var dist: float = rng.randf_range(inner_r, outer_r)
		var x: float = cos(angle) * dist
		var z: float = sin(angle) * dist

		if _in_exclusion_zone(x, z, exclusion_zones):
			continue

		var trunk_h: float = rng.randf_range(float(trunk_h_range[0]), float(trunk_h_range[1]))
		var trunk_r: float = rng.randf_range(float(trunk_r_range[0]), float(trunk_r_range[1]))
		var canopy_r: float = rng.randf_range(float(canopy_r_range[0]), float(canopy_r_range[1]))

		var tree := _create_tree(trunk_h, trunk_r, canopy_r, config, i)
		tree.position = Vector3(x, 0, z)
		# Random Y rotation for variety
		tree.rotation.y = rng.randf_range(0, TAU)
		container.add_child(tree)

	parent.add_child(container)
	return container


func _create_tree(trunk_h: float, trunk_r: float, canopy_r: float,
					config: Dictionary, index: int) -> Node3D:
	var tree := Node3D.new()
	tree.name = "Tree_%d" % index

	# --- Trunk: CylinderMesh with collision ---
	var trunk_body := StaticBody3D.new()
	trunk_body.name = "Trunk"
	trunk_body.position.y = trunk_h / 2.0

	var trunk_mesh_inst := MeshInstance3D.new()
	var trunk_mesh := CylinderMesh.new()
	trunk_mesh.height = trunk_h
	trunk_mesh.top_radius = trunk_r * 0.7
	trunk_mesh.bottom_radius = trunk_r
	trunk_mesh_inst.mesh = trunk_mesh

	var trunk_mat := StandardMaterial3D.new()
	trunk_mat.albedo_color = Color(0.35, 0.22, 0.12)
	trunk_mesh_inst.material_override = trunk_mat
	trunk_body.add_child(trunk_mesh_inst)

	var trunk_col := CollisionShape3D.new()
	var trunk_shape := CylinderShape3D.new()
	trunk_shape.height = trunk_h
	trunk_shape.radius = trunk_r
	trunk_col.shape = trunk_shape
	trunk_body.add_child(trunk_col)

	if config.has("trunk_texture_prompt"):
		trunk_body.set_meta("texture_prompt", config.get("trunk_texture_prompt"))
		trunk_body.set_meta("tiling", [1, 2])

	tree.add_child(trunk_body)

	# --- Canopy: cross-billboard (2 planes at 90 degrees) ---
	var canopy_h: float = canopy_r * 2.0
	var canopy := Node3D.new()
	canopy.name = "Canopy"
	canopy.position.y = trunk_h * 0.75  # Canopy starts at 75% trunk height

	# Plane 1
	var plane1 := MeshInstance3D.new()
	var pm1 := PlaneMesh.new()
	pm1.size = Vector2(canopy_r * 2.0, canopy_h)
	plane1.mesh = pm1
	plane1.rotation_degrees.x = 90.0  # Stand upright
	var canopy_mat := _create_canopy_material()
	plane1.material_override = canopy_mat
	canopy.add_child(plane1)

	# Plane 2 (rotated 90 degrees around Y)
	var plane2 := MeshInstance3D.new()
	var pm2 := PlaneMesh.new()
	pm2.size = Vector2(canopy_r * 2.0, canopy_h)
	plane2.mesh = pm2
	plane2.rotation_degrees.x = 90.0
	plane2.rotation_degrees.y = 90.0
	plane2.material_override = canopy_mat
	canopy.add_child(plane2)

	if config.has("foliage_sprite_prompt"):
		# Use sprite (image with transparent bg) for canopy
		plane1.set_meta("sprite_prompt", config.get("foliage_sprite_prompt"))
		plane2.set_meta("sprite_prompt", config.get("foliage_sprite_prompt"))
	elif config.has("foliage_texture_prompt"):
		canopy.set_meta("texture_prompt", config.get("foliage_texture_prompt"))
		canopy.set_meta("tiling", [1, 1])
		plane1.set_meta("texture_prompt", config.get("foliage_texture_prompt"))
		plane1.set_meta("tiling", [1, 1])
		plane2.set_meta("texture_prompt", config.get("foliage_texture_prompt"))
		plane2.set_meta("tiling", [1, 1])

	tree.add_child(canopy)

	return tree


func _create_canopy_material() -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.15, 0.4, 0.1)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = 0.4
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	return mat


func _create_cross_mesh(size: float) -> ArrayMesh:
	"""Create two intersecting quads at 90 degrees as a single mesh."""
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)

	var half := size / 2.0
	var height := size

	# Plane 1: along X axis (front/back)
	_add_quad(st, Vector3(-half, 0, 0), Vector3(half, 0, 0),
			Vector3(half, height, 0), Vector3(-half, height, 0))

	# Plane 2: along Z axis (left/right)
	_add_quad(st, Vector3(0, 0, -half), Vector3(0, 0, half),
			Vector3(0, height, half), Vector3(0, height, -half))

	st.generate_normals()
	return st.commit()


## Check if a position (x, z) falls inside any exclusion zone (Rect2 in XZ plane).
func _in_exclusion_zone(x: float, z: float, zones: Array) -> bool:
	for zone in zones:
		var r: Rect2 = zone as Rect2
		if r.has_point(Vector2(x, z)):
			return true
	return false


func _add_quad(st: SurfaceTool, bl: Vector3, br: Vector3, tr: Vector3, tl: Vector3) -> void:
	"""Add a quad (two triangles) with UV coordinates to a SurfaceTool."""
	# Triangle 1: bl, br, tr
	st.set_uv(Vector2(0, 1))
	st.add_vertex(bl)
	st.set_uv(Vector2(1, 1))
	st.add_vertex(br)
	st.set_uv(Vector2(1, 0))
	st.add_vertex(tr)

	# Triangle 2: bl, tr, tl
	st.set_uv(Vector2(0, 1))
	st.add_vertex(bl)
	st.set_uv(Vector2(1, 0))
	st.add_vertex(tr)
	st.set_uv(Vector2(0, 0))
	st.add_vertex(tl)
