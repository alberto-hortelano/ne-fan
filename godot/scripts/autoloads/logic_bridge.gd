## WebSocket client to nefan-core logic bridge (localhost:9877).
## Sends player inputs each physics frame, receives combat state + scenario updates.
## Falls back to local combat when bridge is not available.
extends Node

const BRIDGE_URL := "ws://127.0.0.1:9877"

signal scenario_dialogue(speaker: String, text: String, choices: Array)
signal scenario_objective(text: String)
signal scenario_change_scene(scene_data: Dictionary)
signal scenario_spawn_npc(data: Dictionary)
signal scenario_despawn_npc(npc_id: String)
signal scenario_spawn_enemy(data: Dictionary)
signal scenario_give_weapon(weapon_id: String)
signal scenario_spawn_objects(objects: Array)

var _socket := WebSocketPeer.new()
var _connected := false
var _enabled := false  # Only active when bridge is available
var _retry_timer := 0.0
var _retry_interval := 5.0

var _player: CharacterBody3D = null
var _player_combatant: Node = null  # Combatant
var _pending_room: Dictionary = {}  # Room data to send when bridge connects


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
			# Send pending room data that was queued before connection
			if not _pending_room.is_empty():
				_socket.send_text(JSON.stringify(_pending_room))
				print("LogicBridge: sent pending room: %s" % _pending_room.get("roomId", ""))
				_pending_room = {}

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
	var model: Node3D = _player.get_node_or_null("CombatAnimator")
	var fwd := Vector3.FORWARD
	if model:
		# Mixamo model visual forward is +Z, so basis.z IS the forward direction
		fwd = model.global_transform.basis.z
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


func send_room_loaded(room_id: String, enemies: Array, dimensions: Dictionary = {}) -> void:
	"""Notify bridge of a room change with enemy data."""
	var msg := {
		"type": "load_room",
		"roomId": room_id,
		"enemies": enemies,
	}
	if not dimensions.is_empty():
		msg["dimensions"] = {"width": dimensions.get("width", 20.0), "depth": dimensions.get("depth", 20.0)}
	if not _connected:
		# Store for when bridge connects
		_pending_room = msg
		print("LogicBridge: queued room '%s' (%d enemies) for when bridge connects" % [room_id, enemies.size()])
		return
	_socket.send_text(JSON.stringify(msg))
	print("LogicBridge: sent room '%s' (%d enemies)" % [room_id, enemies.size()])


func send_respawn() -> void:
	if not _connected:
		return
	_socket.send_text(JSON.stringify({"type": "respawn"}))


func send_load_game(game_id: String) -> void:
	var msg := {"type": "load_game", "gameId": game_id}
	if not _connected:
		_pending_room = msg
		print("LogicBridge: queued load_game '%s' for when bridge connects" % game_id)
		return
	_socket.send_text(JSON.stringify(msg))
	print("LogicBridge: sent load_game '%s'" % game_id)


func send_scenario_event(event: String, data: Dictionary = {}) -> void:
	if not _connected:
		return
	var msg := {"type": "scenario_event", "event": event, "data": data}
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
			# Apply position from nefan-core
			var pos_data: Dictionary = enemy_data.get("pos", {})
			if not pos_data.is_empty() and enemy_node is Node3D:
				enemy_node.position.x = pos_data.get("x", enemy_node.position.x)
				enemy_node.position.z = pos_data.get("z", enemy_node.position.z)
			# Apply facing direction
			var fwd_data: Dictionary = enemy_data.get("forward", {})
			if not fwd_data.is_empty():
				var animator: Node3D = enemy_node.get_node_or_null("CombatAnimator")
				if animator:
					var fx: float = fwd_data.get("x", 0.0)
					var fz: float = fwd_data.get("z", -1.0)
					if absf(fx) > 0.01 or absf(fz) > 0.01:
						animator.rotation.y = atan2(fx, fz)
			# Apply HP changes
			var c: Node = enemy_node.get_node_or_null("Combatant")
			if c:
				var old_ehp: float = c.health
				if absf(old_ehp - hp) > 0.01:
					c.health = hp
					c.damage_received.emit(old_ehp - hp, _player_combatant)
				# Update HP label
				var hp_label: Label3D = enemy_node.get_node_or_null("HPLabel")
				if hp_label:
					hp_label.text = "%d" % int(hp)
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
			"player_respawned":
				print("Bridge: player respawned with HP %.0f" % event.get("hp", 100))
				if _player_combatant:
					_player_combatant.health = _player_combatant.max_health
					_player_combatant.state = 0
					_player_combatant.current_attack_type = ""
				if _player:
					_player.position = Vector3(0, 1, 4)
					_player.velocity = Vector3.ZERO
				var psync = _player.get_node_or_null("CombatAnimationSync") if _player else null
				if psync:
					psync.reset()
				var panim = _player.get_node_or_null("CombatAnimator") if _player else null
				if panim:
					panim.play("idle")


	# Update NPC positions/animations from scenario
	var npcs: Array = msg.get("npcs", [])
	for npc_data: Dictionary in npcs:
		var npc_id: String = npc_data.get("id", "")
		var npc_node: Node = _find_enemy_node(room, npc_id)
		if not npc_node:
			continue
		# Position
		var npc_pos: Dictionary = npc_data.get("pos", {})
		if not npc_pos.is_empty() and npc_node is Node3D:
			npc_node.position.x = npc_pos.get("x", npc_node.position.x)
			npc_node.position.z = npc_pos.get("z", npc_node.position.z)
		# Animation
		var npc_anim: String = npc_data.get("animation", "")
		if npc_anim != "":
			var animator: Node = npc_node.get_node_or_null("NpcAnimator")
			if animator and animator.has_method("play"):
				animator.play(npc_anim)
		# Facing
		var npc_facing: Dictionary = npc_data.get("facing", {})
		if not npc_facing.is_empty():
			var animator: Node = npc_node.get_node_or_null("NpcAnimator")
			if animator:
				var fx: float = npc_facing.get("x", 0.0)
				var fz: float = npc_facing.get("z", -1.0)
				if absf(fx) > 0.01 or absf(fz) > 0.01:
					animator.rotation.y = atan2(fx, fz)
		# Visibility
		if npc_data.has("visible"):
			var vis: bool = npc_data.get("visible", true)
			if npc_node is Node3D:
				npc_node.visible = vis

	# Process scenario updates
	var scenario: Dictionary = msg.get("scenario", {})
	if not scenario.is_empty():
		if scenario.has("dialogue"):
			var dlg: Dictionary = scenario.get("dialogue", {})
			var speaker: String = dlg.get("speaker", "")
			var text: String = dlg.get("text", "")
			var choices: Array = dlg.get("choices", [])
			scenario_dialogue.emit(speaker, text, choices)
		if scenario.has("objective"):
			scenario_objective.emit(scenario.get("objective", ""))
		if scenario.has("change_scene"):
			scenario_change_scene.emit(scenario.get("change_scene", {}))
		if scenario.has("spawn_npc"):
			scenario_spawn_npc.emit(scenario.get("spawn_npc", {}))
		if scenario.has("despawn_npc"):
			scenario_despawn_npc.emit(scenario.get("despawn_npc", ""))
		if scenario.has("spawn_enemy"):
			scenario_spawn_enemy.emit(scenario.get("spawn_enemy", {}))
		if scenario.has("give_weapon"):
			scenario_give_weapon.emit(scenario.get("give_weapon", ""))
		if scenario.has("spawn_objects"):
			scenario_spawn_objects.emit(scenario.get("spawn_objects", []))


func _find_enemy_node(root: Node, enemy_id: String) -> Node:
	if not root:
		return null
	# Search all descendants (enemy is inside room container)
	for child in root.get_children():
		if child.name == enemy_id:
			return child
		var found: Node = _find_enemy_node(child, enemy_id)
		if found:
			return found
	return null
