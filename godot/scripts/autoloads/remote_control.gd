## TCP remote control for automated testing. Listens on port 9876.
## Commands (JSON per line):
##   {"cmd":"screenshot","path":"/tmp/godot_screen.png"}
##   {"cmd":"key","action":"move_forward","duration":1.0}
##   {"cmd":"mouse","dx":100,"dy":-30}
##   {"cmd":"status"}
##   {"cmd":"wait","seconds":0.5}
extends Node

const PORT = 9876

var _server := TCPServer.new()
var _peer: StreamPeerTCP = null
var _buffer := ""

# Keys held with timer
var _held_actions: Dictionary = {}  # action_name → seconds_remaining


func _ready() -> void:
	var err := _server.listen(PORT)
	if err == OK:
		print("RemoteControl: listening on :%d" % PORT)
	else:
		push_warning("RemoteControl: failed to listen on :%d (err=%d)" % [PORT, err])


func _process(delta: float) -> void:
	# Accept new connections
	if _server.is_connection_available():
		if _peer and _peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			_peer.disconnect_from_host()
		_peer = _server.take_connection()
		print("RemoteControl: client connected")

	# Release held keys
	var to_release: Array[String] = []
	for action in _held_actions:
		_held_actions[action] -= delta
		if _held_actions[action] <= 0:
			Input.action_release(action)
			to_release.append(action)
	for action in to_release:
		_held_actions.erase(action)

	# Read from client
	if _peer == null:
		return
	_peer.poll()
	if _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		_peer = null
		return

	var avail := _peer.get_available_bytes()
	if avail > 0:
		var chunk := _peer.get_utf8_string(avail)
		_buffer += chunk
		# Process complete lines
		while "\n" in _buffer:
			var idx := _buffer.find("\n")
			var line := _buffer.substr(0, idx).strip_edges()
			_buffer = _buffer.substr(idx + 1)
			if not line.is_empty():
				var response := _handle(line)
				_send(response)


func _send(text: String) -> void:
	if _peer and _peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
		_peer.put_data((text + "\n").to_utf8_buffer())


func _handle(line: String) -> String:
	var json = JSON.parse_string(line)
	if json == null or not json is Dictionary:
		return '{"error":"invalid json"}'

	var cmd: String = json.get("cmd", "")
	match cmd:
		"screenshot":
			return _cmd_screenshot(json)
		"key":
			return _cmd_key(json)
		"mouse":
			return _cmd_mouse(json)
		"status":
			return _cmd_status()
		"load_room":
			return _cmd_load_room(json)
		"save":
			return '{"ok":%s}' % str(GameState.save_to_disk()).to_lower()
		"load":
			return '{"ok":%s}' % str(GameState.load_from_disk()).to_lower()
		"teleport":
			return _cmd_teleport(json)
		"look_at":
			return _cmd_look_at(json)
		"wait":
			return '{"ok":true}'
		"record_start":
			SessionRecorder.start_recording()
			return '{"ok":true,"recording":true}'
		"record_stop":
			var rec_path: String = SessionRecorder.stop_recording()
			return '{"ok":true,"path":"%s"}' % rec_path
		"store_snapshot":
			return JSON.stringify(GameStore.snapshot())
		"respawn":
			if LogicBridge.is_connected_to_bridge():
				LogicBridge.send_respawn()
			else:
				get_tree().current_scene.respawn_player()
			return '{"ok":true}'
		"play_anim":
			return _cmd_play_anim(json)
		_:
			return '{"error":"unknown cmd: %s"}' % cmd


func _cmd_screenshot(args: Dictionary) -> String:
	var path: String = args.get("path", "/tmp/godot_screen.png")
	var img := get_viewport().get_texture().get_image()
	if img == null:
		return '{"error":"no viewport image"}'
	var err := img.save_png(path)
	if err != OK:
		return '{"error":"save failed: %d"}' % err
	return '{"ok":true,"path":"%s","size":[%d,%d]}' % [path, img.get_width(), img.get_height()]


func _cmd_key(args: Dictionary) -> String:
	var action: String = args.get("action", "")
	if action.is_empty():
		return '{"error":"missing action"}'
	var duration: float = args.get("duration", 0.0)

	if duration > 0:
		# Hold: use Input.action_press for continuous state (movement)
		Input.action_press(action)
		_held_actions[action] = duration
		return '{"ok":true,"held":%.1f}' % duration
	else:
		# Tap: generate InputEventAction so _unhandled_input fires
		var ev := InputEventAction.new()
		ev.action = action
		ev.pressed = args.get("pressed", true)
		Input.parse_input_event(ev)
		return '{"ok":true}'


func _cmd_mouse(args: Dictionary) -> String:
	var dx: float = args.get("dx", 0)
	var dy: float = args.get("dy", 0)
	var sensitivity := 0.003
	var player := get_tree().current_scene.get_node_or_null("Player")
	if not player:
		return '{"error":"no player"}'
	var cam := get_tree().current_scene.get_node_or_null("CameraController")
	if not cam:
		return '{"error":"no camera"}'
	cam._yaw -= dx * sensitivity
	cam._pitch -= dy * sensitivity
	cam._pitch = clampf(cam._pitch, -PI / 3.0, PI / 4.0)
	return '{"ok":true}'


func _cmd_load_room(args: Dictionary) -> String:
	var index: int = args.get("index", 0)
	var main_scene := get_tree().current_scene
	if main_scene.has_method("_load_room_from_file"):
		main_scene.call("_load_room_from_file", index)
		return '{"ok":true,"index":%d}' % index
	return '{"error":"main scene has no _load_room_from_file"}'


func _cmd_teleport(args: Dictionary) -> String:
	var player := get_tree().current_scene.get_node_or_null("Player") as CharacterBody3D
	if not player:
		return '{"error":"no player"}'
	var x: float = args.get("x", player.position.x)
	var y: float = args.get("y", player.position.y)
	var z: float = args.get("z", player.position.z)
	player.position = Vector3(x, y, z)
	player.velocity = Vector3.ZERO
	return '{"ok":true,"pos":[%.2f,%.2f,%.2f]}' % [x, y, z]


func _cmd_look_at(args: Dictionary) -> String:
	var cam := get_tree().current_scene.get_node_or_null("CameraController")
	if not cam:
		return '{"error":"no camera"}'
	var yaw: float = args.get("yaw", 0.0)
	var pitch: float = args.get("pitch", -0.2)
	cam._yaw = deg_to_rad(yaw)
	cam._pitch = pitch
	return '{"ok":true,"yaw":%.1f,"pitch":%.2f}' % [yaw, pitch]


func _cmd_status() -> String:
	var main_scene := get_tree().current_scene
	var player := main_scene.get_node_or_null("Player") as Node3D

	var info := {}
	if player:
		info["player_pos"] = [snappedf(player.position.x, 0.01),
								snappedf(player.position.y, 0.01),
								snappedf(player.position.z, 0.01)]
	var cam := main_scene.get_node_or_null("CameraController")
	if cam:
		info["camera_yaw"] = snappedf(rad_to_deg(cam._yaw), 0.1)
		info["camera_pitch"] = snappedf(cam._pitch, 0.01)
	var ray = main_scene.get_node_or_null("Player/InteractionRay")
	info["has_ray"] = ray != null
	if ray and ray.is_colliding():
		var col = ray.get_collider()
		info["ray_hit"] = col.name if col else "null"
		info["ray_hit_npc"] = col.has_meta("npc_name") if col else false
	info["room"] = GameState.current_room_id
	info["rooms_visited"] = GameState.visited_rooms.size()
	info["fps"] = Engine.get_frames_per_second()
	info["player_health"] = GameState.player_health
	# Combat info
	var player_combatant = main_scene.get_node_or_null("Player/Combatant")
	if player_combatant:
		info["combat_hp"] = snappedf(player_combatant.health, 0.1)
		info["combat_state"] = player_combatant.get_current_action()
		info["combat_weapon"] = player_combatant.weapon_id
	return JSON.stringify(info)


func _cmd_play_anim(args: Dictionary) -> String:
	var anim_name: String = args.get("name", "")
	if anim_name.is_empty():
		return '{"error":"missing name"}'
	var player := get_tree().current_scene.get_node_or_null("Player")
	if not player:
		return '{"error":"no player"}'
	var animator = player.get_node_or_null("CombatAnimator")
	if not animator:
		return '{"error":"no animator"}'
	# Disable combat sync while previewing
	var sync = player.get_node_or_null("CombatAnimationSync")
	if sync:
		sync.set_process(false)
	animator.play(anim_name)
	# Get animation duration
	var duration: float = 0.0
	if animator._anim_player and animator._anim_player.has_animation(anim_name):
		duration = animator._anim_player.get_animation(anim_name).length
	return '{"ok":true,"name":"%s","duration":%.3f}' % [anim_name, duration]
