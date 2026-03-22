## WebSocket client to nefan-core logic bridge (localhost:9877).
## Sends player inputs each physics frame, receives combat state updates.
## Falls back to local combat when bridge is not available.
extends Node

const BRIDGE_URL := "ws://127.0.0.1:9877"

var _socket := WebSocketPeer.new()
var _connected := false
var _enabled := false  # Only active when bridge is available
var _retry_timer := 0.0
var _retry_interval := 5.0

var _player: CharacterBody3D = null
var _player_combatant: Node = null  # Combatant


func _ready() -> void:
	# Try to connect on startup
	_try_connect()


func _process(delta: float) -> void:
	if not _enabled:
		_retry_timer += delta
		if _retry_timer >= _retry_interval:
			_retry_timer = 0.0
			_try_connect()
		return

	_socket.poll()
	var state := _socket.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		if not _connected:
			_connected = true
			print("LogicBridge: connected to %s" % BRIDGE_URL)

		# Read incoming messages
		while _socket.get_available_packet_count() > 0:
			var data := _socket.get_packet().get_string_from_utf8()
			_handle_message(data)

	elif state == WebSocketPeer.STATE_CLOSED:
		_connected = false
		_enabled = false
		print("LogicBridge: disconnected")


func _physics_process(delta: float) -> void:
	if not _connected or not _player:
		return

	# Collect inputs
	var pos: Vector3 = _player.global_position
	var pivot: Node3D = _player.get_node_or_null("CameraPivot")
	var fwd := Vector3.FORWARD
	if pivot:
		fwd = -pivot.global_transform.basis.z
		fwd.y = 0
		fwd = fwd.normalized()

	var moving: bool = _player.velocity.length() > 0.1

	# Check for attack request
	var attack_requested := false
	var attack_type := ""
	if _player_combatant:
		var pci = _player.get_node_or_null("PlayerCombatInput")
		if pci and pci.has_method("get_pending_attack"):
			var pending: Dictionary = pci.get_pending_attack()
			if not pending.is_empty():
				attack_requested = true
				attack_type = pending.get("type", "")

	var msg := {
		"type": "input",
		"delta": delta,
		"inputs": {
			"playerPosition": {"x": pos.x, "y": pos.y, "z": pos.z},
			"playerForward": {"x": fwd.x, "y": fwd.y, "z": fwd.z},
			"playerMoving": moving,
			"attackRequested": attack_requested,
			"attackType": attack_type,
		}
	}

	_socket.send_text(JSON.stringify(msg))


func send_room_loaded(room_id: String, enemies: Array) -> void:
	"""Notify bridge of a room change with enemy data."""
	if not _connected:
		return
	var msg := {
		"type": "load_room",
		"roomId": room_id,
		"enemies": enemies,
	}
	_socket.send_text(JSON.stringify(msg))


func is_connected_to_bridge() -> bool:
	return _connected


func _try_connect() -> void:
	var err := _socket.connect_to_url(BRIDGE_URL)
	if err == OK:
		_enabled = true
	else:
		_enabled = false


func _handle_message(data: String) -> void:
	var msg = JSON.parse_string(data)
	if msg == null or not msg is Dictionary:
		return

	var msg_type: String = msg.get("type", "")
	match msg_type:
		"state_update":
			_apply_state_update(msg)
		"pong":
			pass


func _apply_state_update(msg: Dictionary) -> void:
	# Update player HP via Combatant node (triggers signals for HUD/animations)
	var player_hp: float = msg.get("playerHp", -1.0)
	if player_hp >= 0 and _player_combatant:
		var old_hp: float = _player_combatant.health
		if absf(old_hp - player_hp) > 0.01:
			_player_combatant.health = player_hp
			_player_combatant.damage_received.emit(old_hp - player_hp, null)
			GameStore.dispatch("player_damaged", {"new_hp": player_hp, "amount": old_hp - player_hp, "from": "bridge"})
			if player_hp <= 0.0:
				_player_combatant.died.emit()

	# Update enemy Combatant nodes in the scene
	var room: Node3D = get_tree().current_scene.get_node_or_null("Player")
	if room:
		room = room.get_parent()
	var enemies: Array = msg.get("enemies", [])
	for enemy_data: Dictionary in enemies:
		var enemy_id: String = enemy_data.get("id", "")
		var hp: float = enemy_data.get("hp", 0.0)
		var alive: bool = enemy_data.get("alive", true)
		var enemy_node: Node = _find_enemy_node(room, enemy_id)
		if enemy_node:
			var c: Node = enemy_node.get_node_or_null("Combatant")
			if c:
				var old_ehp: float = c.health
				if absf(old_ehp - hp) > 0.01:
					c.health = hp
					c.damage_received.emit(old_ehp - hp, _player_combatant)
				if not alive and old_ehp > 0:
					c.health = 0.0
					c.died.emit()

	# Process events for combat log
	var events: Array = msg.get("events", [])
	for event: Dictionary in events:
		var event_type: String = event.get("type", "")
		match event_type:
			"attack_landed":
				print("Bridge: %s -> %s: %.1f dmg" % [
					event.get("attackerId", "?"),
					event.get("targetId", "?"),
					event.get("damage", 0.0)])
			"attack_started":
				# Trigger wind-up animation on the attacker
				var attacker_id: String = event.get("combatantId", "")
				if attacker_id == "player":
					if _player_combatant:
						_player_combatant.state = 2  # WINDING_UP
						_player_combatant.current_attack_type = event.get("attackType", "")
						_player_combatant.attack_started.emit(event.get("attackType", ""))
				else:
					var enode: Node = _find_enemy_node(room, attacker_id)
					if enode:
						var c: Node = enode.get_node_or_null("Combatant")
						if c:
							c.state = 2  # WINDING_UP
							c.current_attack_type = event.get("attackType", "")
							c.attack_started.emit(event.get("attackType", ""))
			"attack_impacted":
				# Return to idle after impact
				var attacker_id: String = event.get("combatantId", "")
				if attacker_id == "player":
					if _player_combatant:
						_player_combatant.state = 0  # IDLE
						_player_combatant.current_attack_type = ""
				else:
					var enode: Node = _find_enemy_node(room, attacker_id)
					if enode:
						var c: Node = enode.get_node_or_null("Combatant")
						if c:
							c.state = 0
							c.current_attack_type = ""
			"died":
				print("Bridge: %s died" % event.get("combatantId", "?"))


func _find_enemy_node(room: Node, enemy_id: String) -> Node:
	if not room:
		return null
	for child in room.get_children():
		if child.name == enemy_id:
			return child
	return null
