## HTTP client for ai_server endpoints.
extends Node

signal room_generated(room_data: Dictionary)
signal generation_failed(error: String)
signal narrative_consequences(event_id: String, consequences: Array)

const SERVER_URL = "http://127.0.0.1:8765"

var _http: HTTPRequest
var _generating := false


## Check if a service is enabled in ServiceSettings (returns true if autoload missing).
func _service_enabled(service_id: String) -> bool:
	var settings: Node = get_node_or_null("/root/ServiceSettings")
	if not settings:
		return true
	return settings.is_enabled(service_id)


func _ready() -> void:
	_http = HTTPRequest.new()
	_http.timeout = 60.0
	add_child(_http)
	_http.request_completed.connect(_on_request_completed)


func is_generating() -> bool:
	return _generating


func report_player_choice(event_id: String, speaker: String, chosen_text: String,
		free_text: String, narrative_context: Dictionary) -> void:
	"""Tell the narrative engine that the player made a dialogue choice. The
	engine may respond with consequences (story_update, spawn_entity, ...)
	which we re-emit on the narrative_consequences signal so main.gd can apply
	them in-world."""
	if not _service_enabled("ai_server"):
		return
	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 60.0
	var json_str := JSON.stringify({
		"event_id": event_id,
		"speaker": speaker,
		"chosen_text": chosen_text,
		"free_text": free_text,
		"context": narrative_context,
	})
	var headers := PackedStringArray(["Content-Type: application/json"])
	http.request_completed.connect(func(_r, code, _h, body: PackedByteArray):
		http.queue_free()
		if code != 200:
			push_warning("AIClient: report_player_choice HTTP %d" % code)
			return
		var data = JSON.parse_string(body.get_string_from_utf8())
		if data == null or not data is Dictionary:
			return
		var consequences: Array = data.get("consequences", [])
		if consequences.size() > 0:
			print("AIClient: %d narrative consequences for event %s" % [consequences.size(), event_id])
		narrative_consequences.emit(event_id, consequences)
	)
	var err := http.request(SERVER_URL + "/report_player_choice", headers, HTTPClient.METHOD_POST, json_str)
	if err != OK:
		push_warning("AIClient: report_player_choice request failed: %d" % err)
		http.queue_free()


func notify_session_start(session_id: String, game_id: String, is_resume: bool) -> void:
	"""Inform ai_server (and through it, Claude via MCP) that a new playthrough
	has started or been resumed. Fire-and-forget — no callback needed."""
	if not _service_enabled("ai_server"):
		return
	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 5.0
	var json_str := JSON.stringify({
		"session_id": session_id,
		"game_id": game_id,
		"is_resume": is_resume,
	})
	var headers := PackedStringArray(["Content-Type: application/json"])
	http.request_completed.connect(func(_r, code, _h, _b):
		if code != 200:
			push_warning("AIClient: notify_session_start HTTP %d" % code)
		http.queue_free()
	)
	var err := http.request(SERVER_URL + "/notify_session", headers, HTTPClient.METHOD_POST, json_str)
	if err != OK:
		push_warning("AIClient: notify_session HTTP request failed: %d" % err)
		http.queue_free()


func generate_room(world_state: Dictionary) -> void:
	if not _service_enabled("ai_server"):
		generation_failed.emit("AI server disabled in settings")
		return
	if _generating:
		generation_failed.emit("Already generating a room")
		return

	_generating = true
	var json_str := JSON.stringify(world_state)
	var headers := PackedStringArray(["Content-Type: application/json"])
	var err := _http.request(SERVER_URL + "/generate_room", headers, HTTPClient.METHOD_POST, json_str)
	if err != OK:
		_generating = false
		generation_failed.emit("HTTP request failed: %d" % err)


func check_server() -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 3.0
	http.request_completed.connect(func(_r, code, _h, _b):
		if code == 200:
			print("AIClient: Server is ready")
		else:
			print("AIClient: Server not available (start with: python ai_server/main.py)")
		http.queue_free()
	)
	http.request(SERVER_URL + "/health")


func _on_request_completed(result: int, response_code: int,
							_headers: PackedStringArray, body: PackedByteArray) -> void:
	_generating = false

	if result != HTTPRequest.RESULT_SUCCESS:
		var msg := "Connection failed (result=%d). Is ai_server running?" % result
		push_warning(msg)
		generation_failed.emit(msg)
		return

	if response_code != 200:
		var msg := "Server error: HTTP %d" % response_code
		push_warning(msg)
		generation_failed.emit(msg)
		return

	var text := body.get_string_from_utf8()
	var data = JSON.parse_string(text)
	if data == null or not data is Dictionary:
		generation_failed.emit("Invalid JSON from server")
		return

	print("AIClient: Room received - %s (%d objects, %d npcs)" % [
		data.get("room_id", "?"),
		data.get("objects", []).size(),
		data.get("npcs", []).size(),
	])
	room_generated.emit(data)


func generate_skin(prompt: String, callback: Callable) -> void:
	"""Generate a character skin via AI. Calls callback(path: String) when done."""
	if not _service_enabled("ai_server"):
		print("AIClient: skin generation disabled by service settings")
		callback.call("")
		return
	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 30.0
	var json_str := JSON.stringify({"prompt": prompt})
	var headers := PackedStringArray(["Content-Type: application/json"])
	http.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, body: PackedByteArray):
		if result != HTTPRequest.RESULT_SUCCESS or code != 200:
			push_warning("AIClient: skin generation failed (result=%d, code=%d)" % [result, code])
			callback.call("")
			http.queue_free()
			return
		var text: String = body.get_string_from_utf8()
		var data: Variant = JSON.parse_string(text)
		if data == null or not data is Dictionary or not data.has("skin_url"):
			callback.call("")
			http.queue_free()
			return
		var skin_url: String = SERVER_URL + data.get("skin_url", "")
		# Download the skin PNG
		_download_skin(skin_url, prompt, callback)
		http.queue_free()
	)
	var err := http.request(SERVER_URL + "/generate_skin", headers, HTTPClient.METHOD_POST, json_str)
	if err != OK:
		push_warning("AIClient: skin request failed: %d" % err)
		callback.call("")
		http.queue_free()


func _download_skin(url: String, prompt: String, callback: Callable) -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 15.0
	http.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, body: PackedByteArray):
		if result != HTTPRequest.RESULT_SUCCESS or code != 200 or body.size() == 0:
			callback.call("")
			http.queue_free()
			return
		# Save to user://skins/
		DirAccess.make_dir_recursive_absolute("user://skins")
		var hash_str: String = TextureCache.hash_prompt(prompt)
		var save_path: String = "user://skins/ai_%s.png" % hash_str
		var file := FileAccess.open(save_path, FileAccess.WRITE)
		if file:
			file.store_buffer(body)
			file.close()
			# Load as Image to create a usable texture
			var img := Image.new()
			var load_err := img.load(ProjectSettings.globalize_path(save_path))
			if load_err == OK:
				print("AIClient: skin saved to %s" % save_path)
				callback.call(save_path)
			else:
				push_warning("AIClient: failed to load saved skin as image")
				callback.call(save_path)
		else:
			callback.call("")
		http.queue_free()
	)
	http.request(url)


func fetch_model_by_hash(hash_str: String, callback: Callable) -> void:
	"""Fetch a cached GLB model by its server-side hash, skipping generation.
	Used when the narrative engine reuses an existing asset via model_hash."""
	if hash_str == "":
		callback.call("")
		return
	var cache_path: String = "user://cache/models/%s.glb" % hash_str
	if FileAccess.file_exists(cache_path):
		callback.call(cache_path)
		return
	# Download directly from server cache endpoint
	_download_model(SERVER_URL + "/cache/model/" + hash_str, hash_str, callback)


func generate_model(prompt: String, callback: Callable, quality: String = "fast") -> void:
	"""Generate a 3D GLB model via AI. Calls callback(glb_path: String) when done."""
	if not _service_enabled("ai_server") or not _service_enabled("meshy_3d"):
		print("AIClient: model generation disabled by service settings")
		callback.call("")
		return
	# Check cache first
	var hash_str: String = TextureCache.hash_prompt(prompt)
	var cache_path: String = "user://cache/models/%s.glb" % hash_str
	if FileAccess.file_exists(cache_path):
		print("AIClient: model cache hit for '%s'" % prompt)
		callback.call(cache_path)
		return
	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 600.0  # Meshy can take 2-5 minutes per model
	var json_str := JSON.stringify({"prompt": prompt, "quality": quality})
	var headers := PackedStringArray(["Content-Type: application/json"])
	http.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, body: PackedByteArray):
		if result != HTTPRequest.RESULT_SUCCESS or code != 200:
			push_warning("AIClient: model generation failed (result=%d, code=%d)" % [result, code])
			callback.call("")
			http.queue_free()
			return
		var text: String = body.get_string_from_utf8()
		var data: Variant = JSON.parse_string(text)
		if data == null or not data is Dictionary or not data.has("model_url"):
			callback.call("")
			http.queue_free()
			return
		var model_url: String = SERVER_URL + data.get("model_url", "")
		_download_model(model_url, hash_str, callback)
		http.queue_free()
	)
	var err := http.request(SERVER_URL + "/generate_model", headers, HTTPClient.METHOD_POST, json_str)
	if err != OK:
		push_warning("AIClient: model request failed: %d" % err)
		callback.call("")
		http.queue_free()


func _download_model(url: String, hash_str: String, callback: Callable) -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 30.0
	http.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, body: PackedByteArray):
		if result != HTTPRequest.RESULT_SUCCESS or code != 200 or body.size() == 0:
			push_warning("AIClient: model download failed")
			callback.call("")
			http.queue_free()
			return
		DirAccess.make_dir_recursive_absolute("user://cache/models")
		var save_path: String = "user://cache/models/%s.glb" % hash_str
		var file := FileAccess.open(save_path, FileAccess.WRITE)
		if file:
			file.store_buffer(body)
			file.close()
			print("AIClient: model saved to %s (%d bytes)" % [save_path, body.size()])
			callback.call(save_path)
		else:
			callback.call("")
		http.queue_free()
	)
	http.request(url)


func analyze_weapon(image_paths: Array, weapon_type: String, kind: String,
		callback: Callable, context: Dictionary = {}) -> void:
	"""Send weapon images to ai_server for vision-based orientation.
	Calls callback(result_dict) — empty dict on failure (caller falls back)."""
	if not _service_enabled("ai_server") or not _service_enabled("ai_vision"):
		print("AIClient: vision analysis disabled by service settings")
		callback.call({})
		return
	var images: Array = []
	for path in image_paths:
		var p: String = str(path)
		if not FileAccess.file_exists(p):
			continue
		var f := FileAccess.open(p, FileAccess.READ)
		if not f:
			continue
		var bytes: PackedByteArray = f.get_buffer(f.get_length())
		f.close()
		# Derive view name from filename: weapon_vision_{hash}_{view}.png
		var base: String = p.get_file().get_basename()
		var parts: PackedStringArray = base.split("_")
		var view_name: String = parts[parts.size() - 1] if parts.size() > 0 else "unknown"
		images.append({
			"view": view_name,
			"media_type": "image/png",
			"data_b64": Marshalls.raw_to_base64(bytes),
		})

	if images.is_empty():
		callback.call({})
		return

	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 240.0  # Vision can take a while via Claude
	var json_str := JSON.stringify({
		"kind": kind,
		"weapon_type": weapon_type,
		"images": images,
		"context": context,
	})
	var headers := PackedStringArray(["Content-Type: application/json"])
	http.request_completed.connect(func(result: int, code: int,
			_h: PackedStringArray, body: PackedByteArray):
		if result != HTTPRequest.RESULT_SUCCESS or code != 200:
			push_warning("AIClient: vision request failed (result=%d, code=%d)" % [result, code])
			callback.call({})
			http.queue_free()
			return
		var text: String = body.get_string_from_utf8()
		var data: Variant = JSON.parse_string(text)
		if typeof(data) != TYPE_DICTIONARY or data.has("error"):
			print("AIClient: vision unavailable, will use fallback")
			callback.call({})
		else:
			callback.call(data)
		http.queue_free()
	)
	var err := http.request(SERVER_URL + "/analyze_weapon", headers,
			HTTPClient.METHOD_POST, json_str)
	if err != OK:
		push_warning("AIClient: vision HTTP request failed: %d" % err)
		callback.call({})
		http.queue_free()
