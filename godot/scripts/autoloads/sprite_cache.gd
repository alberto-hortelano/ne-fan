## Godot-side sprite cache + HTTP client for NPC sprite generation.
extends Node

signal sprite_ready(hash_key: String, texture: ImageTexture)
signal sprite_failed(hash_key: String, error: String)

const SERVER_URL = "http://127.0.0.1:8765"
const CACHE_DIR = "user://cache/sprites/"

var _pending: Dictionary = {}


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(CACHE_DIR)


func hash_prompt(prompt: String) -> String:
	return prompt.strip_edges().to_lower().sha256_text().substr(0, 16)


func request_sprite(prompt: String) -> void:
	var key := hash_prompt(prompt)
	if _pending.has(key):
		return
	_pending[key] = true

	# Check disk cache
	var cache_path := CACHE_DIR + key + ".png"
	if FileAccess.file_exists(cache_path):
		var img := Image.new()
		if img.load(cache_path) == OK:
			var tex := ImageTexture.create_from_image(img)
			sprite_ready.emit(key, tex)
			_pending.erase(key)
			print("SpriteCache: %s from disk" % key)
			return

	# Request from server
	var http := HTTPRequest.new()
	http.timeout = 120.0
	get_tree().root.call_deferred("add_child", http)
	await get_tree().process_frame

	var json_str := JSON.stringify({"prompt": prompt})
	var headers := PackedStringArray(["Content-Type: application/json"])
	http.request_completed.connect(_on_gen_response.bind(key, http), CONNECT_ONE_SHOT)
	http.request(SERVER_URL + "/generate_sprite", headers, HTTPClient.METHOD_POST, json_str)


func _on_gen_response(result: int, response_code: int,
						_headers: PackedStringArray, body: PackedByteArray,
						key: String, http: HTTPRequest) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		_cleanup(key, http, "generation failed: %d/%d" % [result, response_code])
		return

	var data = JSON.parse_string(body.get_string_from_utf8())
	if data == null or not data.has("sprite_url"):
		_cleanup(key, http, "invalid response")
		return

	# Fetch sprite PNG
	var url: String = SERVER_URL + data.get("sprite_url", "")
	http.request_completed.connect(_on_sprite_fetched.bind(key, http), CONNECT_ONE_SHOT)
	http.request(url)


func _on_sprite_fetched(result: int, response_code: int,
						_headers: PackedStringArray, body: PackedByteArray,
						key: String, http: HTTPRequest) -> void:
	http.queue_free()

	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		_pending.erase(key)
		sprite_failed.emit(key, "fetch failed")
		return

	# Save to disk
	var cache_path := CACHE_DIR + key + ".png"
	var file := FileAccess.open(cache_path, FileAccess.WRITE)
	if file:
		file.store_buffer(body)
		file.close()

	# Create texture
	var img := Image.new()
	if img.load_png_from_buffer(body) != OK:
		_pending.erase(key)
		sprite_failed.emit(key, "image decode failed")
		return

	var tex := ImageTexture.create_from_image(img)
	_pending.erase(key)
	sprite_ready.emit(key, tex)
	print("SpriteCache: %s complete (%dx%d)" % [key, img.get_width(), img.get_height()])


func _cleanup(key: String, http: HTTPRequest, error: String) -> void:
	http.queue_free()
	_pending.erase(key)
	sprite_failed.emit(key, error)
	push_warning("SpriteCache: %s - %s" % [key, error])
