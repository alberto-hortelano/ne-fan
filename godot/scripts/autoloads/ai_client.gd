## HTTP client for ai_server endpoints.
extends Node

signal room_generated(room_data: Dictionary)
signal generation_failed(error: String)

const SERVER_URL = "http://127.0.0.1:8765"

var _http: HTTPRequest
var _generating := false


func _ready() -> void:
	_http = HTTPRequest.new()
	_http.timeout = 60.0
	add_child(_http)
	_http.request_completed.connect(_on_request_completed)


func is_generating() -> bool:
	return _generating


func generate_room(world_state: Dictionary) -> void:
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
