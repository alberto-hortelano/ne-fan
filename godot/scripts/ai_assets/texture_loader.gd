## Walks room nodes, requests AI textures, applies them to materials when ready.
class_name TextureLoader
extends RefCounted

# hash_key -> Array of {mesh_instance: MeshInstance3D, material: StandardMaterial3D, tiling: Array}
var _pending_materials: Dictionary = {}


func load_room_textures(room: Node3D) -> void:
	_pending_materials.clear()

	# Connect to cache signals
	if not TextureCache.texture_ready.is_connected(_on_texture_ready):
		TextureCache.texture_ready.connect(_on_texture_ready)

	# Walk all children looking for texture_prompt metadata
	_scan_node(room)


func cleanup() -> void:
	_pending_materials.clear()
	if TextureCache.texture_ready.is_connected(_on_texture_ready):
		TextureCache.texture_ready.disconnect(_on_texture_ready)


func _scan_node(node: Node) -> void:
	if node is StaticBody3D and node.has_meta("texture_prompt"):
		var prompt: String = node.get_meta("texture_prompt")
		var tiling: Array = node.get_meta("tiling", [1, 1])
		var is_flat_image: bool = node.get_meta("display", "") == "flat_image"
		var mesh_inst := _find_mesh_instance(node)
		if mesh_inst and mesh_inst.material_override:
			if is_flat_image:
				# Enable transparency for flat decorative images
				var mat: StandardMaterial3D = mesh_inst.material_override
				mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				mat.alpha_scissor_threshold = 0.5
				mat.cull_mode = BaseMaterial3D.CULL_DISABLED
			_register_material(prompt, mesh_inst, mesh_inst.material_override, tiling)
	elif node is MultiMeshInstance3D and node.has_meta("texture_prompt"):
		# Vegetation: MultiMesh instances (grass, bushes) with material_override
		var prompt: String = node.get_meta("texture_prompt")
		var tiling: Array = node.get_meta("tiling", [1, 1])
		if node.material_override:
			_register_material(prompt, node, node.material_override, tiling)
	elif node is MeshInstance3D and node.has_meta("texture_prompt"):
		# Direct MeshInstance3D (tree canopy planes, etc.)
		var prompt: String = node.get_meta("texture_prompt")
		var tiling: Array = node.get_meta("tiling", [1, 1])
		if node.material_override:
			_register_material(prompt, node, node.material_override, tiling)

	for child in node.get_children():
		_scan_node(child)


func _find_mesh_instance(parent: Node) -> MeshInstance3D:
	for child in parent.get_children():
		if child is MeshInstance3D:
			return child
	return null


func _register_material(prompt: String, mesh_inst: MeshInstance3D,
						material: StandardMaterial3D, tiling: Array) -> void:
	var key := TextureCache.hash_prompt(prompt)

	if not _pending_materials.has(key):
		_pending_materials[key] = []

	_pending_materials[key].append({
		"mesh_instance": mesh_inst,
		"material": material,
		"tiling": tiling,
	})

	# Request texture generation
	TextureCache.request_texture_set(prompt)


func _on_texture_ready(hash_key: String, map_type: String, texture: ImageTexture) -> void:
	if not _pending_materials.has(hash_key):
		return

	for entry in _pending_materials[hash_key]:
		var mat: StandardMaterial3D = entry["material"]
		var tiling: Array = entry["tiling"]
		var mesh_inst: MeshInstance3D = entry["mesh_instance"]

		if not is_instance_valid(mesh_inst):
			continue

		match map_type:
			"albedo":
				mat.albedo_color = Color.WHITE
				mat.albedo_texture = texture
				if tiling.size() >= 2:
					mat.uv1_scale = Vector3(float(tiling[0]), float(tiling[1]), 1)
			"normal":
				mat.normal_enabled = true
				mat.normal_texture = texture
				if tiling.size() >= 2:
					mat.uv1_scale = Vector3(float(tiling[0]), float(tiling[1]), 1)
