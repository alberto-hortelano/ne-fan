## Walks room nodes, finds generate_3d objects, requests GLB from server, replaces primitives.
class_name ModelLoader
extends RefCounted

const SERVER_URL = "http://127.0.0.1:8765"
const CACHE_DIR = "user://cache/models/"

var _pending: Dictionary = {}  # hash_key -> Array[StaticBody3D]
var _http_nodes: Array[HTTPRequest] = []
var _scene_tree: SceneTree


func load_room_models(room: Node3D) -> void:
	_pending.clear()
	_scene_tree = room.get_tree()
	DirAccess.make_dir_recursive_absolute(CACHE_DIR)
	_scan_node(room)


func _scan_node(node: Node) -> void:
	if node is StaticBody3D and node.get_meta("generate_3d", false):
		var prompt: String = node.get_meta("model_prompt", "")
		if not prompt.is_empty():
			_request_model(prompt, node)
	for child in node.get_children():
		_scan_node(child)


func _hash_prompt(prompt: String) -> String:
	return prompt.strip_edges().to_lower().sha256_text().substr(0, 16)


func _request_model(prompt: String, body: StaticBody3D) -> void:
	var key := _hash_prompt(prompt)
	var scale: Array = [body.get_meta("scale_x", 0.5), body.get_meta("scale_y", 0.5), body.get_meta("scale_z", 0.5)]

	# Check local disk cache
	var cache_path := CACHE_DIR + key + ".glb"
	if FileAccess.file_exists(cache_path):
		var file := FileAccess.open(cache_path, FileAccess.READ)
		if file:
			var glb_data := file.get_buffer(file.get_length())
			file.close()
			_apply_model(body, glb_data)
			print("ModelLoader: cached %s" % key)
			return

	# Queue for server generation
	if not _pending.has(key):
		_pending[key] = []
	_pending[key].append(body)

	# Only send one request per unique prompt
	if _pending[key].size() == 1:
		_send_generation_request(prompt, key, scale)


func _send_generation_request(prompt: String, key: String, scale: Array) -> void:
	var http := HTTPRequest.new()
	http.timeout = 300.0  # TripoSG can take ~2min per model
	_scene_tree.root.call_deferred("add_child", http)
	_http_nodes.append(http)
	# Wait one frame for add_child to complete
	await _scene_tree.process_frame

	var json_str := JSON.stringify({"prompt": prompt, "scale": scale})
	var headers := PackedStringArray(["Content-Type: application/json"])

	http.request_completed.connect(_on_gen_response.bind(key, http), CONNECT_ONE_SHOT)
	http.request(SERVER_URL + "/generate_model", headers, HTTPClient.METHOD_POST, json_str)


func _on_gen_response(result: int, response_code: int,
						_headers: PackedStringArray, body: PackedByteArray,
						key: String, http: HTTPRequest) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		print("ModelLoader: generation failed for %s (err %d/%d)" % [key, result, response_code])
		_cleanup_http(http)
		_pending.erase(key)
		return

	var data = JSON.parse_string(body.get_string_from_utf8())
	if data == null or not data.has("model_url"):
		print("ModelLoader: invalid response for %s" % key)
		_cleanup_http(http)
		_pending.erase(key)
		return

	# Fetch the GLB file
	var model_url: String = SERVER_URL + data.get("model_url", "")
	http.request_completed.connect(_on_glb_fetched.bind(key, http), CONNECT_ONE_SHOT)
	http.request(model_url)


func _on_glb_fetched(result: int, response_code: int,
						_headers: PackedStringArray, body: PackedByteArray,
						key: String, http: HTTPRequest) -> void:
	_cleanup_http(http)

	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		print("ModelLoader: GLB fetch failed for %s" % key)
		_pending.erase(key)
		return

	# Save to disk cache
	var cache_path := CACHE_DIR + key + ".glb"
	var file := FileAccess.open(cache_path, FileAccess.WRITE)
	if file:
		file.store_buffer(body)
		file.close()

	# Apply to all pending bodies with this key
	for obj_body in _pending.get(key, []):
		if is_instance_valid(obj_body):
			_apply_model(obj_body, body)

	_pending.erase(key)
	print("ModelLoader: %s applied" % key)


func _apply_model(body: StaticBody3D, glb_data: PackedByteArray) -> void:
	var gltf_doc := GLTFDocument.new()
	var gltf_state := GLTFState.new()
	var err := gltf_doc.append_from_buffer(glb_data, "", gltf_state)
	if err != OK:
		print("ModelLoader: GLB parse error %d" % err)
		return

	var gltf_scene: Node3D = gltf_doc.generate_scene(gltf_state)
	if gltf_scene == null:
		print("ModelLoader: generate_scene returned null")
		return

	# Find the old MeshInstance3D to replace
	var old_mesh: MeshInstance3D = null
	for child in body.get_children():
		if child is MeshInstance3D:
			old_mesh = child
			break

	# Find MeshInstance3D in GLB scene
	var new_mesh := _find_mesh_recursive(gltf_scene)
	if new_mesh == null:
		gltf_scene.queue_free()
		return

	# Remove old primitive mesh
	if old_mesh:
		old_mesh.queue_free()

	# Reparent GLB mesh to the body
	new_mesh.get_parent().remove_child(new_mesh)
	body.add_child(new_mesh)
	new_mesh.position = Vector3.ZERO
	new_mesh.rotation = Vector3.ZERO

	# Clean up remaining GLB scene
	gltf_scene.queue_free()


func _find_mesh_recursive(node: Node) -> MeshInstance3D:
	if node is MeshInstance3D:
		return node
	for child in node.get_children():
		var found := _find_mesh_recursive(child)
		if found:
			return found
	return null


func _cleanup_http(http: HTTPRequest) -> void:
	_http_nodes.erase(http)
	http.queue_free()
