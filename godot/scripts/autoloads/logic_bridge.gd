## WebSocket client to nefan-core logic bridge (localhost:9877).
## Sends player inputs each physics frame, receives combat state.
## Falls back to local combat when bridge is not available.
extends Node

const NodeAccess = preload("res://scripts/util/node_access.gd")
const BRIDGE_URL := "ws://127.0.0.1:9877"

signal connection_changed(connected: bool)

# ── Protocolo de sesión canónico (start_session/resume_session, paridad con
# el cliente HTML). Señales emitidas al recibir mensajes del bridge.
signal session_started(ok: bool, session_id: String, game_id: String, is_resume: bool, state: Dictionary, error: String)
signal narrative_scene(scene_id: String, scene_data: Dictionary)
signal narrative_spawn(effect: Dictionary)
signal narrative_dialogue(speaker: String, text: String, choices: Array)
signal narrative_story_delta(delta: String)
signal narrative_ambient(message: String)
signal narrative_status_changed(phase: String, kind: String, message: String)
signal session_saved(ok: bool)
# Emitida al terminar de procesar un narrative_event, incluso con effects
# vacíos. Permite a la UI liberar esperas ("Claude piensa...") aunque el motor
# narrativo no devuelva ningún efecto visible.
signal narrative_event_done(event_id: String)

var _socket := WebSocketPeer.new()
var _connected := false
var _enabled := false  # Only active when bridge is available
var _retry_timer := 0.0
var _retry_interval := 5.0

var _player: CharacterBody3D = null
var _player_combatant: Node = null  # Combatant
# Cola FIFO de mensajes emitidos antes de conectar; se drena en orden al abrir
# el socket. (Antes era un slot único que un segundo send pisaba.)
var _pending_out: Array[Dictionary] = []
var _next_request_id := 0
# Cache id → Node para no recorrer el árbol entero por cada enemigo/NPC en
# cada state_update. La validez se comprueba al leer (is_instance_valid), así
# que un cambio de room o un despawn invalidan la entrada sin hooks extra.
var _node_cache: Dictionary = {}


func _ready() -> void:
	# Listen for explicit enable/disable from the user (not status updates)
	var settings: Node = get_node_or_null("/root/ServiceSettings")
	if settings and settings.has_signal("enabled_changed"):
		settings.enabled_changed.connect(_on_enabled_changed)
	# Try to connect on startup
	_try_connect()


func _on_enabled_changed(service_id: String, enabled_now: bool) -> void:
	if service_id != "logic_bridge":
		return
	if enabled_now:
		_try_connect()
	else:
		_socket.close()
		_enabled = false
		_connected = false


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
			connection_changed.emit(true)
			# Drain queued messages in the order they were requested
			for pending: Dictionary in _pending_out:
				_socket.send_text(JSON.stringify(pending))
				print("LogicBridge: sent pending %s" % pending.get("type", "?"))
			_pending_out.clear()

		# Read incoming messages
		while _socket.get_available_packet_count() > 0:
			var data := _socket.get_packet().get_string_from_utf8()
			_handle_message(data)

	elif state == WebSocketPeer.STATE_CLOSED:
		var was_connected := _connected
		_connected = false
		_enabled = false
		if was_connected:
			push_warning("LogicBridge: disconnected from bridge — combat falls back to local logic")
			connection_changed.emit(false)


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
	_send_or_queue(msg, "room '%s' (%d enemies)" % [room_id, enemies.size()])


func send_respawn() -> void:
	if not _connected:
		return
	_socket.send_text(JSON.stringify({"type": "respawn"}))


func send_start_session(game_id: String, appearance: Dictionary = {}) -> void:
	"""Arranca una sesión canónica en el bridge (NarrativeState + plugins).
	La respuesta llega como session_started; la escena inicial, como
	narrative_event → señal narrative_scene."""
	var msg := {
		"type": "start_session",
		"requestId": _make_request_id(),
		"gameId": game_id,
	}
	if not appearance.is_empty():
		msg["appearance"] = {
			"model_id": String(appearance.get("model_id", "")),
			"skin_path": String(appearance.get("skin_path", "")),
		}
	_send_or_queue(msg, "start_session '%s'" % game_id)


func send_resume_session(session_id: String) -> void:
	"""Reanuda una sesión guardada del bridge. Responde session_started con
	el SessionData completo; la escena la materializa el cliente desde
	state.scenes_loaded (el bridge no re-difunde escena en resume)."""
	_send_or_queue(
		{"type": "resume_session", "requestId": _make_request_id(), "sessionId": session_id},
		"resume_session '%s'" % session_id,
	)


func send_save_session() -> void:
	"""Pide al bridge que snapshotee el runtime (pos/HP del sim) y persista la
	sesión. Responde session_saved."""
	_send_or_queue(
		{"type": "save_session", "requestId": _make_request_id()},
		"save_session",
	)


func send_dialogue_choice(speaker: String, chosen_text: String, choice_index: int, free_text: String = "") -> void:
	"""Reporta la elección de diálogo por el ciclo canónico del bridge
	(recordDialogueEvent + reportPlayerChoice + plugins). El eventId lo crea
	el bridge; el campo va vacío por contrato."""
	var msg := {
		"type": "dialogue_choice",
		"eventId": "",
		"choiceIndex": choice_index,
		"speaker": speaker,
		"chosenText": chosen_text,
	}
	if free_text != "":
		msg["freeText"] = free_text
	_send_or_queue(msg, "dialogue_choice")


func send_interact_entity(entity_id: String, entity_name: String) -> void:
	"""Interacción con una entidad narrativa (tecla E sobre un NPC): el bridge
	genera el saludo y responde con narrative_event (show_dialogue...)."""
	_send_or_queue(
		{"type": "interact_entity", "entityId": entity_id, "entityName": entity_name},
		"interact_entity '%s'" % entity_id,
	)


func _send_or_queue(msg: Dictionary, label: String) -> void:
	if not _connected:
		_pending_out.append(msg)
		print("LogicBridge: queued %s for when bridge connects" % label)
		return
	_socket.send_text(JSON.stringify(msg))
	print("LogicBridge: sent %s" % label)


func _make_request_id() -> String:
	_next_request_id += 1
	return "gd_%d" % _next_request_id


func is_connected_to_bridge() -> bool:
	return _connected


func _try_connect() -> void:
	# Respect ServiceSettings: don't connect if disabled
	var settings: Node = get_node_or_null("/root/ServiceSettings")
	if settings and not settings.is_enabled("logic_bridge"):
		_enabled = false
		return
	# Don't reconnect if socket is already open or in progress
	var ready_state := _socket.get_ready_state()
	if ready_state != WebSocketPeer.STATE_CLOSED:
		return
	var err := _socket.connect_to_url(BRIDGE_URL)
	if err == OK:
		_enabled = true
	else:
		_enabled = false


func _handle_message(data: String) -> void:
	var msg = JSON.parse_string(data)
	if msg == null or not msg is Dictionary:
		# Fail-loud: surface malformed frames instead of silently dropping them.
		# Truncate the preview so a hostile/garbled stream doesn't flood logs.
		var preview: String = data.substr(0, 200)
		if data.length() > 200:
			preview += "…"
		push_error("LogicBridge: cannot parse WS frame as Dictionary: %s" % preview)
		return

	var msg_type: String = msg.get("type", "")
	match msg_type:
		"state_update":
			_apply_state_update(msg)
		"session_started":
			_on_session_started_msg(msg)
		"narrative_event":
			_on_narrative_event_msg(msg)
		"narrative_status":
			narrative_status_changed.emit(
				String(msg.get("phase", "")),
				String(msg.get("kind", "")),
				String(msg.get("message", "")),
			)
		"session_saved":
			session_saved.emit(bool(msg.get("ok", false)))
		"pong":
			pass
		_:
			# Unknown message type — log so we notice protocol drift instead of
			# silently dropping a frame the bridge added without our knowing.
			if msg_type != "":
				push_warning("LogicBridge: unknown message type '%s'" % msg_type)


func _on_session_started_msg(msg: Dictionary) -> void:
	var ok: bool = bool(msg.get("ok", false))
	var state_v: Variant = msg.get("state", {})
	var state: Dictionary = state_v if state_v is Dictionary else {}
	if ok and state.is_empty():
		# Fail-loud: un session_started ok sin SessionData rompería la
		# hidratación del espejo — mejor verlo aquí que aguas abajo.
		push_error("LogicBridge: session_started ok=true sin 'state' — frame malformado")
	session_started.emit(
		ok,
		String(msg.get("sessionId", "")),
		String(msg.get("gameId", "")),
		bool(msg.get("isResume", false)),
		state,
		String(msg.get("error", "")),
	)


func _on_narrative_event_msg(msg: Dictionary) -> void:
	var effects_v: Variant = msg.get("effects", [])
	if not effects_v is Array:
		push_error("LogicBridge: narrative_event sin 'effects' Array — frame malformado")
		return
	for effect_v: Variant in (effects_v as Array):
		if not effect_v is Dictionary:
			push_error("LogicBridge: effect no-Dictionary en narrative_event")
			continue
		var effect: Dictionary = effect_v
		var kind: String = String(effect.get("kind", ""))
		match kind:
			"spawn_entity":
				var data_v: Variant = effect.get("data", {})
				var data: Dictionary = data_v if data_v is Dictionary else {}
				var scene_v: Variant = data.get("scene")
				if scene_v is Dictionary:
					# Una escena completa (scene_init / lazy realize del mapa).
					narrative_scene.emit(String(effect.get("entityId", "")), scene_v)
				else:
					# Entidad suelta con posición ya resuelta por el bridge.
					narrative_spawn.emit(effect)
			"show_dialogue":
				var choices_v: Variant = effect.get("choices", [])
				var choices: Array = choices_v if choices_v is Array else []
				narrative_dialogue.emit(
					String(effect.get("speaker", "")), String(effect.get("text", "")), choices
				)
			"story_delta":
				narrative_story_delta.emit(String(effect.get("delta", "")))
			"ambient_message":
				narrative_ambient.emit(String(effect.get("message", "")))
			"schedule_event", "plugin_applied":
				# Paridad con el cliente HTML: informativos, sin materialización.
				print("LogicBridge: effect %s recibido" % kind)
			_:
				push_warning("LogicBridge: unknown effect kind '%s'" % kind)
	narrative_event_done.emit(String(msg.get("eventId", "")))


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

	# Update enemy Combatant nodes in the scene. The Player node is the
	# anchor we walk up from — its parent is the current room container.
	# `null` is acceptable here only during title-screen / scene-transition
	# windows; _find_enemy_node handles null root by returning null, so the
	# subsequent loop becomes a no-op rather than crashing.
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
				# Emit signal before resetting state so listeners can read attack type
				var attacker_id: String = event.get("combatantId", "")
				var attack_type: String = event.get("attackType", "")
				if attacker_id == "player":
					if _player_combatant:
						_player_combatant.attack_impacted.emit(attack_type)
						_player_combatant.state = 0  # IDLE
						_player_combatant.current_attack_type = ""
				else:
					var enode: Node = _find_enemy_node(room, attacker_id)
					if enode:
						var c: Node = enode.get_node_or_null("Combatant")
						if c:
							c.attack_impacted.emit(attack_type)
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
				var psync: Node = NodeAccess.must_get_node(_player, "CombatAnimationSync", "logic_bridge player_respawned") if _player else null
				if psync:
					psync.reset()
				var panim: Node = NodeAccess.must_get_node(_player, "CombatAnimator", "logic_bridge player_respawned") if _player else null
				if panim:
					panim.travel("idle")


func _find_enemy_node(root: Node, enemy_id: String) -> Node:
	if not root:
		return null
	var cached: Variant = _node_cache.get(enemy_id)
	# is_instance_valid PRIMERO: sobre una instancia liberada, cualquier otra
	# operación (`is`, atributos) lanza "previously freed instance".
	if (
		is_instance_valid(cached)
		and cached is Node
		and not cached.is_queued_for_deletion()
		and String(cached.name) == enemy_id
		and root.is_ancestor_of(cached)
	):
		return cached
	var found: Node = _search_node_recursive(root, enemy_id)
	if found:
		_node_cache[enemy_id] = found
	else:
		_node_cache.erase(enemy_id)
	return found


func _search_node_recursive(root: Node, enemy_id: String) -> Node:
	for child in root.get_children():
		if String(child.name) == enemy_id:
			return child
		var found: Node = _search_node_recursive(child, enemy_id)
		if found:
			return found
	return null
