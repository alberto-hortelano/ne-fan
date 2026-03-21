## Godot-side texture cache + HTTP client for ai_server texture endpoints.
extends Node

signal texture_ready(hash_key: String, map_type: String, texture: ImageTexture)
signal texture_failed(hash_key: String, error: String)

const SERVER_URL = "http://127.0.0.1:8765"
const CACHE_DIR = "user://cache/textures/"

# Track in-flight requests to avoid duplicates
var _pending: Dictionary = {}  # hash_key -> true
var _http_pool: Array[HTTPRequest] = []
const POOL_SIZE = 4


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(CACHE_DIR)
	for i in POOL_SIZE:
		var http := HTTPRequest.new()
		http.timeout = 120.0
		add_child(http)
		_http_pool.append(http)


func hash_prompt(prompt: String) -> String:
	return prompt.strip_edges().to_lower().sha256_text().substr(0, 16)


func request_texture_set(prompt: String) -> void:
	"""Request albedo + normal for a prompt. Emits texture_ready for each."""
	var key := hash_prompt(prompt)

	if _pending.has(key):
		return  # Already in flight
	_pending[key] = true

	# Check local disk cache first
	if _load_from_disk(key, "albedo") and _load_from_disk(key, "normal"):
		_pending.erase(key)
		return

	# Request generation from server
	_request_generation(prompt, key)


func _load_from_disk(key: String, map_type: String) -> bool:
	var path := CACHE_DIR + key + "/" + map_type + ".png"
	if not FileAccess.file_exists(path):
		return false
	var img := Image.new()
	var err := img.load(path)
	if err != OK:
		return false
	var tex := ImageTexture.create_from_image(img)
	texture_ready.emit(key, map_type, tex)
	return true


func _save_to_disk(key: String, map_type: String, data: PackedByteArray) -> void:
	var dir_path := CACHE_DIR + key + "/"
	DirAccess.make_dir_recursive_absolute(dir_path)
	var file := FileAccess.open(dir_path + map_type + ".png", FileAccess.WRITE)
	if file:
		file.store_buffer(data)
		file.close()


func _get_http() -> HTTPRequest:
	for http in _http_pool:
		if not http.get_meta("busy", false):
			http.set_meta("busy", true)
			return http
	# All busy, create a temporary one
	var http := HTTPRequest.new()
	http.timeout = 120.0
	add_child(http)
	http.set_meta("busy", true)
	http.set_meta("temp", true)
	return http


func _release_http(http: HTTPRequest) -> void:
	http.set_meta("busy", false)
	if http.get_meta("temp", false):
		http.queue_free()


func _request_generation(prompt: String, key: String) -> void:
	var http := _get_http()
	var json_str := JSON.stringify({"prompt": prompt})
	var headers := PackedStringArray(["Content-Type: application/json"])

	# Disconnect any previous signal
	if http.request_completed.is_connected(_on_generation_response):
		http.request_completed.disconnect(_on_generation_response)

	http.request_completed.connect(_on_generation_response.bind(key, prompt, http), CONNECT_ONE_SHOT)
	var err := http.request(SERVER_URL + "/generate_texture", headers, HTTPClient.METHOD_POST, json_str)
	if err != OK:
		_release_http(http)
		_pending.erase(key)
		texture_failed.emit(key, "HTTP request failed: %d" % err)


func _on_generation_response(result: int, response_code: int,
								_headers: PackedStringArray, body: PackedByteArray,
								key: String, prompt: String, http: HTTPRequest) -> void:
	_release_http(http)

	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		_pending.erase(key)
		texture_failed.emit(key, "Server error: %d/%d" % [result, response_code])
		return

	var data = JSON.parse_string(body.get_string_from_utf8())
	if data == null or not data is Dictionary:
		_pending.erase(key)
		texture_failed.emit(key, "Invalid response")
		return

	# Fetch albedo and normal PNGs
	var albedo_url: String = data.get("albedo_url", "")
	var normal_url: String = data.get("normal_url", "")

	if albedo_url:
		_fetch_map(key, "albedo", SERVER_URL + albedo_url)
	if normal_url:
		_fetch_map(key, "normal", SERVER_URL + normal_url)


func _fetch_map(key: String, map_type: String, url: String) -> void:
	var http := _get_http()

	if http.request_completed.is_connected(_on_map_fetched):
		http.request_completed.disconnect(_on_map_fetched)

	http.request_completed.connect(_on_map_fetched.bind(key, map_type, http), CONNECT_ONE_SHOT)
	http.request(url)


func _on_map_fetched(result: int, response_code: int,
						_headers: PackedStringArray, body: PackedByteArray,
						key: String, map_type: String, http: HTTPRequest) -> void:
	_release_http(http)

	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		texture_failed.emit(key, "%s fetch failed" % map_type)
		return

	# Save to disk cache
	_save_to_disk(key, map_type, body)

	# Create texture
	var img := Image.new()
	var err := img.load_png_from_buffer(body)
	if err != OK:
		texture_failed.emit(key, "%s image decode failed" % map_type)
		return

	var tex := ImageTexture.create_from_image(img)
	texture_ready.emit(key, map_type, tex)

	# Check if all maps fetched for this key
	if map_type == "normal":
		_pending.erase(key)
		print("TextureCache: %s complete" % key)
