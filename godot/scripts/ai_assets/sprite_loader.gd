## Walks room NPC nodes, requests AI sprites, replaces capsule meshes with billboard Sprite3D.
class_name SpriteLoader
extends RefCounted

var _pending_npcs: Dictionary = {}  # hash_key -> Array[StaticBody3D]


func load_room_sprites(room: Node3D) -> void:
	_pending_npcs.clear()

	if not SpriteCache.sprite_ready.is_connected(_on_sprite_ready):
		SpriteCache.sprite_ready.connect(_on_sprite_ready)

	_scan_node(room)


func cleanup() -> void:
	_pending_npcs.clear()
	if SpriteCache.sprite_ready.is_connected(_on_sprite_ready):
		SpriteCache.sprite_ready.disconnect(_on_sprite_ready)


func _scan_node(node: Node) -> void:
	if node is StaticBody3D and node.has_meta("sprite_prompt"):
		# Skip NPCs that will use 3D models instead of sprites
		if node.get_meta("generate_3d", false):
			return
		var prompt: String = node.get_meta("sprite_prompt")
		if not prompt.is_empty():
			_register_npc(prompt, node)

	for child in node.get_children():
		_scan_node(child)


func _register_npc(prompt: String, body: StaticBody3D) -> void:
	var key := SpriteCache.hash_prompt(prompt)

	if not _pending_npcs.has(key):
		_pending_npcs[key] = []
	_pending_npcs[key].append(body)

	SpriteCache.request_sprite(prompt)


func _on_sprite_ready(hash_key: String, texture: ImageTexture) -> void:
	if not _pending_npcs.has(hash_key):
		return

	for body in _pending_npcs[hash_key]:
		if is_instance_valid(body):
			_apply_sprite(body, texture)

	_pending_npcs.erase(hash_key)


func _apply_sprite(body: StaticBody3D, texture: ImageTexture) -> void:
	# Remove existing capsule mesh
	for child in body.get_children():
		if child is MeshInstance3D:
			child.queue_free()

	# Create billboard Sprite3D
	var sprite := Sprite3D.new()
	sprite.texture = texture
	sprite.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	sprite.transparent = true
	sprite.no_depth_test = false
	sprite.shaded = true
	sprite.double_sided = true
	sprite.alpha_cut = SpriteBase3D.ALPHA_CUT_OPAQUE_PREPASS

	# Scale sprite to match NPC height
	var desired_height: float = body.get_meta("scale_y", 1.8)
	if texture.get_height() > 0:
		sprite.pixel_size = desired_height / float(texture.get_height())

	body.add_child(sprite)

	var npc_name: String = body.get_meta("npc_name", "?")
	print("SpriteLoader: %s -> billboard sprite" % npc_name)
