## Manages optional services: enable/disable, persistence, status checks.
## Used by the title screen panel and respected by AIClient/LogicBridge/CombatAnimator.
extends Node

signal status_changed(service_id: String)
signal enabled_changed(service_id: String, enabled: bool)

const SETTINGS_PATH := "user://service_settings.json"
const AI_SERVER_URL := "http://127.0.0.1:8765"

## Service definitions. Order matters for the UI display.
const SERVICES := [
	{
		"id": "ai_server",
		"name": "AI Server",
		"description": "Generación de texturas, skins y modelos",
		"default": true,
	},
	{
		"id": "logic_bridge",
		"name": "Logic Bridge",
		"description": "Lógica de combate compartida (TS)",
		"default": true,
	},
	{
		"id": "meshy_3d",
		"name": "Meshy 3D",
		"description": "Generación remota de modelos GLB",
		"default": true,
	},
	{
		"id": "ai_vision",
		"name": "AI Vision",
		"description": "Colocación inteligente de armas",
		"default": false,
	},
]

# enabled[service_id] = bool
var enabled: Dictionary = {}

# status[service_id] = { "state": "ready"|"down"|"fallback"|"disabled"|"unknown",
#                        "message": str, "last_check": float }
var status: Dictionary = {}

var _backend_status_http: HTTPRequest = null


func _ready() -> void:
	_load_settings()
	# Initialize status for all services
	for s in SERVICES:
		var sid: String = s["id"]
		if not status.has(sid):
			status[sid] = {"state": "unknown", "message": "", "last_check": 0.0}
	# Listen for LogicBridge connection changes so the panel updates immediately
	call_deferred("_hook_logic_bridge")


func _hook_logic_bridge() -> void:
	var bridge: Node = get_node_or_null("/root/LogicBridge")
	if bridge and bridge.has_signal("connection_changed"):
		bridge.connection_changed.connect(_on_bridge_connection_changed)
		# Sync current state in case it connected before we hooked
		if bridge.has_method("is_connected_to_bridge") and bridge.is_connected_to_bridge():
			_set_status("logic_bridge", "ready", "conectado a :9877")


func _on_bridge_connection_changed(connected: bool) -> void:
	if connected:
		_set_status("logic_bridge", "ready", "conectado a :9877")
	else:
		_set_status("logic_bridge", "down", "no conectado a :9877")


func is_enabled(service_id: String) -> bool:
	if enabled.has(service_id):
		return bool(enabled[service_id])
	for s in SERVICES:
		if s["id"] == service_id:
			return bool(s["default"])
	return false


func set_enabled(service_id: String, value: bool) -> void:
	if is_enabled(service_id) == value:
		return
	enabled[service_id] = value
	_save_settings()
	enabled_changed.emit(service_id, value)
	if not value:
		_set_status(service_id, "disabled", "deshabilitado por el usuario")
	else:
		_set_status(service_id, "unknown", "comprobando...")
		check_service(service_id)
	status_changed.emit(service_id)


func get_state(service_id: String) -> String:
	if not is_enabled(service_id):
		return "disabled"
	return status.get(service_id, {}).get("state", "unknown")


func get_message(service_id: String) -> String:
	if not is_enabled(service_id):
		return "deshabilitado"
	return status.get(service_id, {}).get("message", "")


## Trigger a status check for all enabled services.
func check_all() -> void:
	for s in SERVICES:
		var sid: String = s["id"]
		if is_enabled(sid):
			check_service(sid)


func check_service(service_id: String) -> void:
	match service_id:
		"ai_server":
			_check_ai_server()
		"logic_bridge":
			_check_logic_bridge()
		"meshy_3d", "ai_vision":
			_check_backend_status()


# ----------------------------------------------------------------------
# Individual checks
# ----------------------------------------------------------------------

func _check_ai_server() -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.timeout = 3.0
	http.request_completed.connect(func(_result: int, code: int,
			_h: PackedStringArray, body: PackedByteArray):
		if code == 200:
			var text: String = body.get_string_from_utf8()
			var data: Variant = JSON.parse_string(text)
			if typeof(data) == TYPE_DICTIONARY and data.get("status") == "ready":
				_set_status("ai_server", "ready", "OK")
			else:
				_set_status("ai_server", "down", "respuesta inválida")
		else:
			_set_status("ai_server", "down", "HTTP %d (¿arrancado?)" % code)
		http.queue_free()
	)
	var err := http.request(AI_SERVER_URL + "/health")
	if err != OK:
		_set_status("ai_server", "down", "no se pudo conectar")
		http.queue_free()


func _check_logic_bridge() -> void:
	var bridge: Node = get_node_or_null("/root/LogicBridge")
	if not bridge:
		_set_status("logic_bridge", "down", "autoload no presente")
		return
	if bridge.has_method("is_connected_to_bridge") and bridge.is_connected_to_bridge():
		_set_status("logic_bridge", "ready", "conectado a :9877")
	else:
		_set_status("logic_bridge", "down", "no conectado a :9877")


func _check_backend_status() -> void:
	# Single GET that reports both meshy_3d and ai_vision status
	if _backend_status_http != null and is_instance_valid(_backend_status_http):
		return  # Already in flight
	_backend_status_http = HTTPRequest.new()
	add_child(_backend_status_http)
	_backend_status_http.timeout = 5.0
	_backend_status_http.request_completed.connect(func(_result: int, code: int,
			_h: PackedStringArray, body: PackedByteArray):
		if code != 200:
			if is_enabled("meshy_3d"):
				_set_status("meshy_3d", "down", "AI server no disponible")
			if is_enabled("ai_vision"):
				_set_status("ai_vision", "down", "AI server no disponible")
		else:
			var text: String = body.get_string_from_utf8()
			var data: Variant = JSON.parse_string(text)
			if typeof(data) == TYPE_DICTIONARY:
				if is_enabled("meshy_3d"):
					var ms: Dictionary = data.get("meshy_3d", {})
					_set_status("meshy_3d", ms.get("state", "unknown"), ms.get("message", ""))
				if is_enabled("ai_vision"):
					var vs: Dictionary = data.get("ai_vision", {})
					_set_status("ai_vision", vs.get("state", "unknown"), vs.get("message", ""))
		if is_instance_valid(_backend_status_http):
			_backend_status_http.queue_free()
		_backend_status_http = null
	)
	var err := _backend_status_http.request(AI_SERVER_URL + "/backend_status")
	if err != OK:
		if is_enabled("meshy_3d"):
			_set_status("meshy_3d", "down", "no se pudo conectar")
		if is_enabled("ai_vision"):
			_set_status("ai_vision", "down", "no se pudo conectar")
		_backend_status_http.queue_free()
		_backend_status_http = null


# ----------------------------------------------------------------------
# Persistence
# ----------------------------------------------------------------------

func _load_settings() -> void:
	if not FileAccess.file_exists(SETTINGS_PATH):
		return
	var f := FileAccess.open(SETTINGS_PATH, FileAccess.READ)
	if not f:
		return
	var data: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(data) == TYPE_DICTIONARY:
		var raw: Dictionary = data.get("enabled", {})
		for key in raw.keys():
			enabled[key] = bool(raw[key])


func _save_settings() -> void:
	var f := FileAccess.open(SETTINGS_PATH, FileAccess.WRITE)
	if not f:
		return
	f.store_string(JSON.stringify({"enabled": enabled}, "  "))
	f.close()


func _set_status(service_id: String, state: String, message: String) -> void:
	status[service_id] = {
		"state": state,
		"message": message,
		"last_check": Time.get_unix_time_from_system(),
	}
	status_changed.emit(service_id)
