## Renders a weapon mesh from front/side/top angles into PNG files.
## Used by the vision-guided weapon orientation pipeline in CombatAnimator.
##
## Usage:
##   var paths: Array = await WeaponVisionRenderer.render_angles(mesh_inst, hash_key, root_node)
##   # paths contains 3 absolute paths: [front, side, top]
class_name WeaponVisionRenderer
extends RefCounted

const RENDER_SIZE := Vector2i(512, 512)


## Render a weapon mesh from 3 orthographic angles. Returns absolute paths
## to the saved PNGs in user://tmp/. The caller is responsible for any cleanup.
##
## - mesh_source: a MeshInstance3D containing the weapon mesh (we use its .mesh resource)
## - hash_key: identifier used in the output filename (typically the prompt hash)
## - root: any node in the live scene tree (used to add the SubViewport temporarily)
static func render_angles(mesh_source: MeshInstance3D, hash_key: String,
		root: Node) -> Array[String]:
	if not mesh_source or not mesh_source.mesh:
		return []
	if not root or not root.is_inside_tree():
		return []

	var mesh: Mesh = mesh_source.mesh
	var aabb: AABB = mesh.get_aabb()

	# Build offscreen viewport
	var vp := SubViewport.new()
	vp.size = RENDER_SIZE
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	vp.transparent_bg = false
	vp.msaa_3d = Viewport.MSAA_4X
	vp.own_world_3d = true  # Isolated 3D world

	# White background environment
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.95, 0.95, 0.95)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.85, 0.85, 0.85)
	env.ambient_light_energy = 1.2
	var world_env := WorldEnvironment.new()
	world_env.environment = env
	vp.add_child(world_env)

	# 3-point lighting
	var key_light := DirectionalLight3D.new()
	key_light.rotation_degrees = Vector3(-35, 30, 0)
	key_light.light_energy = 1.4
	vp.add_child(key_light)

	var fill_light := DirectionalLight3D.new()
	fill_light.rotation_degrees = Vector3(-20, -120, 0)
	fill_light.light_energy = 0.6
	vp.add_child(fill_light)

	var back_light := DirectionalLight3D.new()
	back_light.rotation_degrees = Vector3(40, 180, 0)
	back_light.light_energy = 0.5
	vp.add_child(back_light)

	# Clone mesh at origin so the camera framing is consistent
	var mesh_copy := MeshInstance3D.new()
	mesh_copy.mesh = mesh
	mesh_copy.position = -aabb.get_center()
	vp.add_child(mesh_copy)

	# Camera positioned to fit the mesh comfortably
	var cam := Camera3D.new()
	cam.fov = 30
	cam.current = true
	vp.add_child(cam)

	# Attach to the live scene tree so rendering happens
	root.add_child(vp)

	# Compute camera distance from the longest extent so the mesh always fits
	var max_extent: float = max(aabb.size.x, max(aabb.size.y, aabb.size.z))
	var distance: float = max_extent * 1.8

	DirAccess.make_dir_recursive_absolute("user://tmp")
	var out: Array[String] = []

	var views := [
		{"name": "front", "pos": Vector3(0, 0, distance),    "up": Vector3(0, 1, 0)},
		{"name": "side",  "pos": Vector3(distance, 0, 0),    "up": Vector3(0, 1, 0)},
		{"name": "top",   "pos": Vector3(0, distance, 0.01), "up": Vector3(0, 0, -1)},
	]

	for v in views:
		cam.position = v.pos
		cam.look_at(Vector3.ZERO, v.up)
		vp.render_target_update_mode = SubViewport.UPDATE_ONCE
		# Wait two frames so the texture is fully rendered
		await root.get_tree().process_frame
		await root.get_tree().process_frame
		var tex: ViewportTexture = vp.get_texture()
		if tex == null:
			continue
		var img: Image = tex.get_image()
		if img == null:
			continue
		var path: String = "user://tmp/weapon_vision_%s_%s.png" % [hash_key, v.name]
		var err: int = img.save_png(path)
		if err == OK:
			out.append(ProjectSettings.globalize_path(path))

	# Cleanup
	vp.queue_free()
	print("WeaponVisionRenderer: rendered %d views for %s" % [out.size(), hash_key])
	return out
