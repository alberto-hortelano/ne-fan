extends Node3D

const SceneBuilderScript = preload("res://scripts/room/scene_builder.gd")
const TextureLoaderScript = preload("res://scripts/ai_assets/texture_loader.gd")
const ModelLoaderScript = preload("res://scripts/ai_assets/model_loader.gd")
const GameHUDScript = preload("res://scripts/ui/game_hud.gd")
const CombatManagerScript = preload("res://scripts/combat/combat_manager.gd")
const CombatHUDScript = preload("res://scripts/combat/combat_hud.gd")
const CombatantScript = preload("res://scripts/combat/combatant.gd")
const PlayerCombatInputScript = preload("res://scripts/combat/player_combat_input.gd")
const CombatAnimatorScript = preload("res://scripts/combat/combat_animator.gd")
const CombatAnimationSyncScript = preload("res://scripts/combat/combat_animation_sync.gd")
const AttackAreaVisualScript = preload("res://scripts/combat/attack_area_visual.gd")
const DevMenuScript = preload("res://scripts/ui/dev_menu.gd")
const CameraControllerScript = preload("res://scripts/player/camera_controller.gd")
const DialogueUIScript = preload("res://scripts/ui/dialogue_ui.gd")
const HistoryBrowserScript = preload("res://scripts/ui/history_browser.gd")
const ObjectSpawnerScript = preload("res://scripts/room/object_spawner.gd")
const TitleScreenScript = preload("res://scripts/ui/title_screen.gd")
const PauseMenuScript = preload("res://scripts/ui/pause_menu.gd")
const DialogueFlowScript = preload("res://scripts/narrative/dialogue_flow.gd")
const CharacterEditorScript = preload("res://scripts/ui/character_editor.gd")
const NpcModelRegistryScript = preload("res://scripts/npc/npc_model_registry.gd")
const NodeAccess = preload("res://scripts/util/node_access.gd")

var _room_files: Array[String] = []
var _dev_menu: CanvasLayer
var _camera_controller: Node3D
var _dialogue_ui: Node  # DialogueUI

var _scene_builder = SceneBuilderScript.new()
var _texture_loader = TextureLoaderScript.new()
var _model_loader = ModelLoaderScript.new()
var _hud: CanvasLayer
var _combat_manager: Node  # CombatManager
var _combat_hud  # CombatHUD
var _player_combatant: Node  # Combatant
var _current_room: Node3D = null
# Spawn de la escena actual (__player_start / world_rect / origen) — lo fija
# _apply_room; lo usan los respawns (main y logic_bridge) en vez de hardcodes.
var _current_spawn := Vector3(0, 1, 4)
var _transitioning := false
var _session_active := false
var _returning_to_title := false
var _pause_menu: CanvasLayer = null
var _paused := false
var _pending_game_id := ""
var _pending_scene_path := ""
var _pending_session_id := ""
var _dialogue_flow: Node = null  # DialogueFlow — máquina de diálogo/free-text
var _character_editor: CanvasLayer = null

@onready var _player: CharacterBody3D = $Player


func _ready() -> void:
	# HUD
	_hud = GameHUDScript.new()
	add_child(_hud)

	# Combat system
	_combat_manager = CombatManagerScript.new()
	_combat_manager.name = "CombatManager"
	add_child(_combat_manager)

	_combat_hud = CombatHUDScript.new()
	_combat_hud.name = "CombatHUD"
	add_child(_combat_hud)

	# Player combat components
	_player_combatant = CombatantScript.new()
	_player_combatant.name = "Combatant"
	_player_combatant.weapon_id = "short_sword"
	_player.add_child(_player_combatant)

	var player_input = PlayerCombatInputScript.new()
	player_input.name = "PlayerCombatInput"
	_player.add_child(player_input)

	var player_animator = CombatAnimatorScript.new()
	player_animator.name = "CombatAnimator"
	player_animator.position.y = -0.05  # Small offset, model feet near ground
	_player.add_child(player_animator)
	player_animator.apply_skin("res://assets/characters/Sword and Shield Pack/skin_white_gold.png")

	var player_sync = CombatAnimationSyncScript.new()
	player_sync.name = "CombatAnimationSync"
	_player.add_child(player_sync)

	var attack_area_visual = AttackAreaVisualScript.new()
	attack_area_visual.name = "AttackAreaVisual"
	_player.add_child(attack_area_visual)

	_combat_manager.register_combatant(_player_combatant)
	_combat_hud.set_player_combatant(_player_combatant)
	player_input.attack_type_changed.connect(_combat_hud.on_attack_type_changed)
	_combat_manager.combat_result.connect(_combat_hud.on_combat_result)
	_player_combatant.damage_received.connect(_on_player_damage_received)
	_player_combatant.damage_received.connect(_on_player_damage_log)
	_player_combatant.died.connect(_on_player_died)

	# Independent camera (NOT child of player)
	_camera_controller = CameraControllerScript.new()
	_camera_controller.name = "CameraController"
	add_child(_camera_controller)
	_camera_controller.set_target(_player)
	_player.set_camera(_camera_controller)

	# SpringArm3D + Camera3D as children of camera controller
	var spring_arm := SpringArm3D.new()
	spring_arm.name = "SpringArm"
	spring_arm.spring_length = 3.5
	spring_arm.margin = 0.3
	# Slight vertical offset so camera looks from above-behind
	spring_arm.position = Vector3(0, 0.3, 0)
	_camera_controller.add_child(spring_arm)

	var camera := Camera3D.new()
	camera.name = "Camera3D"
	spring_arm.add_child(camera)

	# Exclude player from SpringArm collision (prevents camera going to head)
	spring_arm.add_excluded_object(_player.get_rid())

	# Logic bridge (TS combat authority)
	LogicBridge._player = _player
	LogicBridge._player_combatant = _player_combatant

	# AI client — las consequences las aplica DialogueFlow; main sólo materializa spawns
	# OK: main es la escena raíz, vida == app — no necesita auto_disconnect
	AIClient.narrative_consequences.connect(
		func(event_id: String, consequences: Array) -> void:
			_dialogue_flow.handle_consequences(event_id, consequences))
	AIClient.check_server()

	# Interaction system
	var ray: Node = NodeAccess.must_get_node(_player, "InteractionRay", "main._ready interaction")
	if ray:
		ray.target_changed.connect(_on_target_changed)
		ray.interacted.connect(_on_interacted)

	# Scan test rooms dynamically
	_scan_rooms()

	# Dev menu
	_dev_menu = DevMenuScript.new()
	_dev_menu.room_selected.connect(_on_dev_room_selected)
	_dev_menu.animation_selected.connect(_on_dev_animation_selected)
	add_child(_dev_menu)
	_dev_menu.call_deferred("set_rooms", _room_files)
	_dev_menu.call_deferred("set_animations", CombatAnimatorScript.ANIM_MAP.keys())

	# Dialogue UI + máquina de diálogo narrativo
	_dialogue_ui = DialogueUIScript.new()
	_dialogue_ui.name = "DialogueUI"
	add_child(_dialogue_ui)
	_dialogue_flow = DialogueFlowScript.new()
	_dialogue_flow.name = "DialogueFlow"
	add_child(_dialogue_flow)
	_dialogue_flow.setup(_dialogue_ui, _hud)
	_dialogue_flow.spawn_entity_requested.connect(_apply_spawn_entity_consequence)

	# History browser (tecla H)
	var history_browser := HistoryBrowserScript.new()
	history_browser.name = "HistoryBrowser"
	add_child(history_browser)

	# Canonical session signals from LogicBridge (start_session/resume_session)
	# OK: main es la escena raíz, vida == app — no necesita auto_disconnect
	LogicBridge.session_started.connect(_on_bridge_session_started)
	LogicBridge.narrative_scene.connect(_on_narrative_scene)
	LogicBridge.narrative_spawn.connect(_on_narrative_spawn)
	LogicBridge.narrative_dialogue.connect(_on_narrative_dialogue)
	LogicBridge.narrative_status_changed.connect(_on_narrative_status)
	LogicBridge.narrative_story_delta.connect(_on_narrative_story_delta)
	LogicBridge.narrative_ambient.connect(_on_narrative_ambient)
	LogicBridge.session_saved.connect(_on_bridge_session_saved)

	# Make player collision capsule semi-visible for dev
	#_make_player_capsule_visible()

	# Disable player until a game is selected
	_player.set_physics_process(false)
	_player.visible = false

	# Show title screen
	var title_screen := TitleScreenScript.new()
	title_screen.name = "TitleScreen"
	title_screen.game_selected.connect(_on_title_game_selected)
	add_child(title_screen)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		_toggle_pause()
		get_viewport().set_input_as_handled()
		return

	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_F12: _dev_menu.toggle()
			KEY_R:
				if _player_combatant.health <= 0.0:
					if LogicBridge.is_connected_to_bridge():
						LogicBridge.send_respawn()
					else:
						respawn_player()
			KEY_F5:
				if NarrativeState.bridge_authoritative:
					# El bridge snapshotea pos/HP del sim y escribe el save; el
					# resultado llega por session_saved. Si el bridge cayó, NO
					# hay save de emergencia local (reintroduciría el doble
					# escritor de state.json) — fail-loud en HUD.
					if LogicBridge.is_connected_to_bridge():
						LogicBridge.send_save_session()
					else:
						push_warning("F5: bridge caído — el save canónico no está disponible")
						_hud.show_brief_message("⚠ Bridge caído: no se puede guardar", 4.0)
				elif NarrativeState.session_id != "" and NarrativeState.save():
					_hud.show_brief_message("Partida guardada")
				else:
					push_warning("F5: no active session to save")
			KEY_F9:
				# Quick-load: en canónico, el bridge relee el último save y
				# responde session_started(is_resume) → _materialize_resumed_state
				# (escena + posición + HP + entities). Multi-slot va por el título.
				if NarrativeState.bridge_authoritative:
					if LogicBridge.is_connected_to_bridge() and NarrativeState.session_id != "":
						LogicBridge.send_resume_session(NarrativeState.session_id)
					else:
						push_warning("F9: bridge caído — el load canónico no está disponible")
						_hud.show_brief_message("⚠ Bridge caído: no se puede cargar", 4.0)
				elif NarrativeState.session_id == "":
					push_warning("F9: no active session to reload")
				elif NarrativeState.load_session(NarrativeState.session_id):
					_hud.show_brief_message("Partida cargada")
					var appearance: Dictionary = NarrativeState.player.get("appearance", {})
					_apply_player_appearance(appearance.get("model_id", "pete"), appearance.get("skin_path", ""))
					var active_id: String = NarrativeState.world.get("active_scene_id", "")
					if active_id != "" and NarrativeState.scenes_loaded.has(active_id):
						var scene_record: Dictionary = NarrativeState.scenes_loaded[active_id]
						var f9_scene: Dictionary = scene_record.get("scene_data", {})
						_apply_room(f9_scene, SceneBuilderScript.spawn_position(f9_scene), false)


# --- Interaction ---

func _on_target_changed(body: StaticBody3D) -> void:
	if body == null:
		_hud.hide_prompt()
		return

	if body.has_meta("npc_name"):
		_hud.show_prompt("[E] Hablar con %s" % body.get_meta("npc_name"))
	elif body.get_meta("interactive", false):
		_hud.show_prompt("[E] Examinar")
	else:
		_hud.hide_prompt()


func _on_interacted(body: StaticBody3D) -> void:
	if _hud.is_text_panel_visible():
		_hud.hide_text_panel()
		return

	# Canónico: hablar con un NPC arranca el ciclo interact_entity del bridge
	# (saludo generado por el motor narrativo → show_dialogue, paridad HTML).
	# El examine local de metadata queda para props y para el modo offline.
	if NarrativeState.bridge_authoritative and body.has_meta("npc_name"):
		if LogicBridge.is_connected_to_bridge():
			LogicBridge.send_interact_entity(String(body.name), String(body.get_meta("npc_name", "")))
			_hud.show_brief_message("...")
			return
		push_warning("main: bridge caído — interacción narrativa no disponible")

	var text := ""
	if body.has_meta("npc_name"):
		var name: String = body.get_meta("npc_name", "")
		var desc: String = body.get_meta("description", "")
		var hint: String = body.get_meta("dialogue_hint", "")
		text = "[%s]\n%s" % [name, desc]
		if hint:
			text += "\n\n\"%s\"" % hint
	else:
		text = body.get_meta("description", "No hay nada especial.")

	_hud.show_text_panel(text)


func _on_player_damage_received(_amount: float, _from: Node) -> void:
	# HP lives in _player_combatant (visual) and is mirrored to GameStore via
	# the bridge's apply_state_update events. No third copy needed.
	pass


func _on_player_damage_log(amount: float, _from: Node) -> void:
	if amount > 0:
		_combat_hud.add_log_message("Player hit: -%.1f HP" % amount, Color(1.0, 0.6, 0.4))


func _on_enemy_damage_log(amount: float, _from: Node, enemy_name: String) -> void:
	if amount > 0:
		_combat_hud.add_log_message("%s hit: -%.1f HP" % [enemy_name, amount], Color(0.9, 0.9, 0.7))
	# Check for death
	var room := _current_room
	if room:
		var enemy_node: Node = room.get_node_or_null(enemy_name)
		if enemy_node:
			var c: Node = enemy_node.get_node_or_null("Combatant")
			if c and c.health <= 0.0:
				_combat_hud.add_log_message("%s killed!" % enemy_name, Color(1.0, 0.85, 0.2))


func respawn_player() -> void:
	# Reset all enemy combatants to idle
	if _current_room:
		for child in _current_room.get_children():
			var c = child.get_node_or_null("Combatant")
			if c:
				c.state = 0
				c.current_attack_type = ""
				c.health = c.max_health
	_player_combatant.health = _player_combatant.max_health
	_player_combatant.state = 0  # IDLE
	_player_combatant.current_attack_type = ""
	GameStore.dispatch("player_respawned", {"hp": _player_combatant.max_health})
	_player.position = _current_spawn
	_player.velocity = Vector3.ZERO
	var player_sync: Node = NodeAccess.must_get_node(_player, "CombatAnimationSync", "main.respawn_player")
	if player_sync:
		player_sync.reset()
	var player_anim: Node = NodeAccess.must_get_node(_player, "CombatAnimator", "main.respawn_player")
	if player_anim:
		player_anim.travel("idle")
	_hud.show_brief_message("Respawn")


func _on_player_died() -> void:
	# Guard against re-entry: bridge may emit `died` multiple times after auto-respawn
	if _returning_to_title:
		return
	_returning_to_title = true
	_combat_hud.add_log_message("HAS MUERTO", Color(1, 0.2, 0.2))
	# Wait for death animation to play out, then return to title
	await get_tree().create_timer(2.5).timeout
	return_to_title()
	_returning_to_title = false


func _toggle_pause() -> void:
	if _paused:
		_unpause()
	else:
		_pause()


func _pause() -> void:
	if _paused or not _current_room:
		return
	_paused = true
	# Freeze player
	_player.set_physics_process(false)
	_player.set_process_input(false)
	# Freeze bridge (stops sending input to TS, stops processing combat ticks)
	LogicBridge.set_physics_process(false)
	LogicBridge.set_process(false)
	# Freeze room children (enemy animations, AI, combat sync)
	for child in _current_room.get_children():
		child.set_process(false)
		child.set_physics_process(false)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

	_pause_menu = PauseMenuScript.new()
	_pause_menu.name = "PauseMenu"
	_pause_menu.resume_requested.connect(_unpause)
	_pause_menu.return_to_title_requested.connect(_on_pause_return_to_title)
	add_child(_pause_menu)


func _unpause() -> void:
	if not _paused:
		return
	_paused = false
	# Unfreeze player
	_player.set_physics_process(true)
	_player.set_process_input(true)
	# Unfreeze bridge
	LogicBridge.set_physics_process(true)
	LogicBridge.set_process(true)
	# Unfreeze room children
	if _current_room:
		for child in _current_room.get_children():
			child.set_process(true)
			child.set_physics_process(true)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if _pause_menu:
		_pause_menu.queue_free()
		_pause_menu = null


func _on_pause_return_to_title() -> void:
	_unpause()
	return_to_title()


func _reset_game_state() -> void:
	"""Full reset between games — clears UI, scenario, state, combat."""
	# UI overlays
	if _dialogue_ui:
		_dialogue_ui.hide_all()
	_hud.hide_prompt()
	_hud.hide_text_panel()
	# Scenario
	_session_active = false
	GameStore.state.world.rooms_visited.clear()
	# Combat
	_combat_hud.set_target(null)


func return_to_title() -> void:
	_reset_game_state()

	# Tear down current room
	if _current_room:
		for child in _current_room.get_children():
			var c = child.get_node_or_null("Combatant")
			if c:
				_combat_manager.unregister_combatant(c)
		_current_room.queue_free()
		_current_room = null

	# Reset player state
	_player_combatant.health = _player_combatant.max_health
	_player_combatant.state = 0  # IDLE
	_player_combatant.current_attack_type = ""
	GameStore.dispatch("player_respawned", {"hp": _player_combatant.max_health})

	var player_sync: Node = NodeAccess.must_get_node(_player, "CombatAnimationSync", "main.return_to_title")
	if player_sync:
		player_sync.reset()

	# Hide and freeze player
	_player.velocity = Vector3.ZERO
	_player.set_physics_process(false)
	_player.visible = false

	# Release mouse
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

	# Recreate title screen if not already present
	if not has_node("TitleScreen"):
		var title_screen := TitleScreenScript.new()
		title_screen.name = "TitleScreen"
		title_screen.game_selected.connect(_on_title_game_selected)
		add_child(title_screen)


# --- Room scanning and loading ---

func _scan_rooms() -> void:
	_room_files.clear()
	var game: Array[String] = []
	var dev: Array[String] = []
	_scan_room_dir("res://test_rooms", false)
	for f: String in _room_files:
		game.append(f)
	_room_files.clear()
	_scan_room_dir("res://test_rooms/dev", false)
	for f: String in _room_files:
		dev.append(f)
	var stress: Array[String] = []
	_room_files.clear()
	_scan_room_dir("res://test_rooms/stress", false)
	for f: String in _room_files:
		stress.append(f)
	game.sort()
	dev.sort()
	stress.sort()
	_room_files = []
	_room_files.append_array(game)
	_room_files.append_array(dev)
	_room_files.append_array(stress)
	print("Scanned %d rooms" % _room_files.size())


func _scan_room_dir(dir_path: String, recurse: bool = false) -> void:
	var dir := DirAccess.open(dir_path)
	if not dir:
		return
	dir.list_dir_begin()
	var fname := dir.get_next()
	while fname != "":
		var full := dir_path + "/" + fname
		if dir.current_is_dir() and fname != "." and fname != ".." and recurse:
			_scan_room_dir(full, true)
		elif fname.ends_with(".json"):
			_room_files.append(full)
		fname = dir.get_next()


func _on_dev_room_selected(file_path: String) -> void:
	_session_active = false
	if _dialogue_ui:
		_dialogue_ui.hide_all()
	load_room_by_path(file_path)


func _on_dev_animation_selected(anim_name: String) -> void:
	var animator: Node = NodeAccess.must_get_node(_player, "CombatAnimator", "main dev anim preview")
	if animator:
		animator.travel(anim_name)
	# Disable combat animation sync while previewing
	var sync: Node = NodeAccess.must_get_node(_player, "CombatAnimationSync", "main dev anim preview")
	if sync:
		sync.set_process(false)


func _reactivate_animation_sync() -> void:
	var sync: Node = NodeAccess.must_get_node(_player, "CombatAnimationSync", "main._reactivate_animation_sync")
	if sync:
		sync.set_process(true)
		sync.reset()


func _make_player_capsule_visible() -> void:
	var col_shape: CollisionShape3D = _player.get_node_or_null("CollisionShape3D")
	if not col_shape:
		return
	var shape: Shape3D = col_shape.shape
	if not shape:
		return
	var mesh_inst := MeshInstance3D.new()
	mesh_inst.name = "DebugCapsule"
	if shape is CapsuleShape3D:
		var capsule_mesh := CapsuleMesh.new()
		capsule_mesh.radius = shape.radius + 0.02
		capsule_mesh.height = shape.height
		mesh_inst.mesh = capsule_mesh
	else:
		var box_mesh := BoxMesh.new()
		box_mesh.size = Vector3(0.62, 1.82, 0.62)
		mesh_inst.mesh = box_mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.1, 1.0, 0.2, 0.4)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mesh_inst.material_override = mat
	col_shape.add_child(mesh_inst)


func load_room_by_path(file_path: String) -> void:
	_reactivate_animation_sync()
	var file := FileAccess.open(file_path, FileAccess.READ)
	if not file:
		push_error("Cannot open room: %s" % file_path)
		return
	var data = JSON.parse_string(file.get_as_text())
	file.close()
	if data == null:
		return
	_apply_room(data, SceneBuilderScript.spawn_position(data), false)


func _load_room_from_file(index: int) -> void:
	if index < 0 or index >= _room_files.size():
		return
	_session_active = false
	if _dialogue_ui:
		_dialogue_ui.hide_all()
	load_room_by_path(_room_files[index])


# --- Room building ---

func _apply_room(data: Dictionary, player_pos: Vector3, fade: bool = false, reset_hp: bool = true) -> void:
	# Clear stale UI from previous room
	if _dialogue_ui:
		_dialogue_ui.hide_all()
	_hud.hide_prompt()
	_hud.hide_text_panel()

	# Freeze player during room swap to prevent falling through void
	_player.set_physics_process(false)
	_player.velocity = Vector3.ZERO

	# Unregister old room combatants
	if _current_room:
		for child in _current_room.get_children():
			var c = child.get_node_or_null("Combatant")
			if c:
				_combat_manager.unregister_combatant(c)
		_current_room.queue_free()
		_current_room = null
		await get_tree().process_frame

	_current_room = _scene_builder.build_scene(data)
	add_child(_current_room)

	# AI assets (async, progressive)
	_texture_loader.load_room_textures(_current_room)
	_model_loader.load_room_models(_current_room)


	# Register enemy combatants and set AI target to player
	_combat_hud.set_target(null)
	var first_enemy := true
	for child in _current_room.get_children():
		var combatant = child.get_node_or_null("Combatant")
		if combatant:
			_combat_manager.register_combatant(combatant)
			var ai = child.get_node_or_null("EnemyCombatAI")
			if ai:
				ai.target = _player_combatant
			if first_enemy:
				_combat_hud.set_target(combatant)
				first_enemy = false
			# Connect enemy damage to combat log
			var enemy_name: String = child.name
			combatant.damage_received.connect(_on_enemy_damage_log.bind(enemy_name))

	# Reset player state on room change. En el flujo canónico (reset_hp=false)
	# cambiar de escena NO cura: el HP lo gobierna el bridge (Fase 1).
	if reset_hp:
		_player_combatant.health = _player_combatant.max_health
	_player_combatant.state = 0  # IDLE
	_player_combatant.current_attack_type = ""
	GameStore.dispatch("player_respawned", {"hp": _player_combatant.health})
	var player_sync: Node = NodeAccess.must_get_node(_player, "CombatAnimationSync", "main._apply_room")
	if player_sync:
		player_sync.reset()

	# Position player and re-enable physics
	# Wait a frame for collision shapes to register before enabling physics
	_current_spawn = player_pos
	_player.position = player_pos
	_player.velocity = Vector3.ZERO
	await get_tree().physics_frame
	await get_tree().physics_frame
	_player.position = player_pos
	_player.velocity = Vector3.ZERO
	_player.set_physics_process(true)

	# Dispatch room change (world-only) and the enemy projection separately,
	# so a room_changed without enemies no longer wipes the list — see
	# next.md §1.3 and nefan-core/src/store/state-projection.ts.
	GameStore.dispatch("room_changed", {
		"room_id": data.get("scene_id", data.get("room_id", "unknown")),
		"room_data": data,
	})
	var enemies_state: Array = []
	for child in _current_room.get_children():
		var c = child.get_node_or_null("Combatant")
		if c:
			enemies_state.append({
				"id": child.name,
				"pos": [child.position.x, child.position.y, child.position.z],
				"hp": c.health,
				"max_hp": c.max_health,
				"weapon_id": c.weapon_id,
				"combat_state": "idle",
				"alive": true,
			})
	GameStore.dispatch("enemies_projected", {"enemies": enemies_state})

	# Notify bridge of room change with enemy personalities
	# (send_room_loaded queues data if bridge not yet connected)
	var bridge_enemies: Array = []
	for child in _current_room.get_children():
		var c = child.get_node_or_null("Combatant")
		var ai = child.get_node_or_null("EnemyCombatAI")
		if c and ai:
			bridge_enemies.append({
				"id": child.name,
				"position": {"x": child.position.x, "y": child.position.y, "z": child.position.z},
				"health": c.health,
				"weaponId": c.weapon_id,
				"personality": {
					"aggression": ai.aggression,
					"preferred_attacks": ai.preferred_attacks,
					"reaction_time": ai.reaction_time,
					"combat_range": ai.combat_range,
				}
			})
	var dims: Dictionary = data.get("dimensions", {})
	LogicBridge.send_room_loaded(data.get("scene_id", data.get("room_id", "unknown")), bridge_enemies, dims)

	# Surface room metadata in the HUD. The canonical session record is owned
	# by NarrativeState — recorded by the scenario change_scene handler and by
	# the open-world scene loader; the HUD update belongs here because it is
	# the only universally applicable side-effect (dev rooms, scenario rooms,
	# F1/F2/F3 all hit this path).
	_hud.show_room_info(
		String(data.get("scene_id", data.get("room_id", "unknown"))),
		String(data.get("scene_description", data.get("room_description", ""))),
	)

	# Fade in
	if fade:
		await _hud.fade_in(0.4)


# --- Title screen ---


func _on_title_game_selected(game_id: String, scene_path: String, session_id: String = "") -> void:
	print("Title: %s game '%s' from '%s'" % ["resuming" if session_id != "" else "starting", game_id, scene_path])
	_pending_game_id = game_id
	_pending_scene_path = scene_path
	_pending_session_id = session_id
	# Show character editor before starting the game (skip if resuming — appearance is in the save)
	if session_id != "":
		_start_game(_pending_game_id, _pending_scene_path, _pending_session_id)
		return
	_character_editor = CharacterEditorScript.new()
	_character_editor.name = "CharacterEditor"
	_character_editor.appearance_confirmed.connect(_on_appearance_confirmed)
	_character_editor.cancelled.connect(_on_editor_cancelled)
	add_child(_character_editor)


func _on_appearance_confirmed(model_id: String, skin_path: String) -> void:
	_character_editor = null
	# Apply appearance to player (visual)
	_apply_player_appearance(model_id, skin_path)
	# Start the game — this creates the session (bridge o local)
	_start_game(_pending_game_id, _pending_scene_path, _pending_session_id)
	# En canónico la appearance viaja en start_session y vuelve dentro del
	# SessionData (la sesión aún no existe aquí — es asíncrona); sólo el
	# fallback offline (sesión local síncrona) la persiste en el mirror.
	if not LogicBridge.is_connected_to_bridge() and NarrativeState.session_id != "":
		NarrativeState.update_player_appearance(model_id, skin_path)


func _on_editor_cancelled() -> void:
	_character_editor = null
	# Return to title screen
	var title_screen := TitleScreenScript.new()
	title_screen.name = "TitleScreen"
	title_screen.game_selected.connect(_on_title_game_selected)
	add_child(title_screen)


func _apply_player_appearance(model_id: String, skin_path: String) -> void:
	var animator: Node3D = NodeAccess.must_get_node(_player, "CombatAnimator", "main._apply_player_appearance")
	if not animator:
		return
	var data: Dictionary = NpcModelRegistryScript.get_model_data(model_id)
	var model_path: String = data.get("path", "")
	if model_path != "" and model_path != animator.model_path:
		animator.set_character_model(model_path)
		animator.anim_dir = NpcModelRegistryScript.COMBAT_ANIM_DIR
		animator.position.y = data.get("y_offset", -0.05)
		animator.reload_model()
	# Apply model scale (varies per character for height diversity)
	var model_scale: float = data.get("model_scale", 1.0)
	animator.scale = Vector3(model_scale, model_scale, model_scale)
	if skin_path != "":
		animator.apply_skin(skin_path)
	# Attach weapon if model doesn't have one baked in
	if not data.get("has_weapon", false):
		animator.attach_weapon()
	else:
		animator.detach_weapon()
	# Reflect the new appearance in the runtime store. Persistence to the
	# canonical NarrativeState happens at the call site that owns the session
	# lifecycle (`_on_appearance_confirmed` for new games, `F9`/`_start_game`
	# for resumes), because at this point we may not have a session yet.
	GameStore.dispatch("appearance_changed", {"model_id": model_id, "skin_path": skin_path})


func _start_game(game_id: String, scene_path: String, resume_session_id: String = "") -> void:
	_reset_game_state()
	_session_active = true
	_player.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

	if LogicBridge.is_connected_to_bridge():
		# Flujo canónico: la sesión vive en el bridge (NarrativeState TS +
		# plugins). La respuesta llega por la señal session_started; la escena
		# inicial, por narrative_scene (nuevo juego) o se materializa desde el
		# SessionData (resume). El player queda congelado hasta que haya escena.
		if resume_session_id != "":
			LogicBridge.send_resume_session(resume_session_id)
			_hud.show_brief_message("Reanudando sesión...")
		else:
			var appearance: Dictionary = GameStore.state.player.appearance
			LogicBridge.send_start_session(game_id, appearance)
			_hud.show_brief_message("Creando sesión...")
		return

	# Fallback offline (sin bridge): sesión local del mirror GD, sin motor
	# narrativo ni plugins. Escena inicial desde disco.
	if resume_session_id != "":
		if not NarrativeState.load_session(resume_session_id):
			push_warning("main: failed to resume session %s — starting fresh" % resume_session_id)
			NarrativeState.start_new_session(game_id)
	else:
		NarrativeState.start_new_session(game_id)
	# Notify ai_server so Claude sees session info in narrative requests
	AIClient.notify_session_start(NarrativeState.session_id, game_id, resume_session_id != "")
	load_room_by_path(scene_path)
	# Player physics re-enabled by _apply_room when room arrives


func _on_bridge_session_started(ok: bool, p_session_id: String, _p_game_id: String, is_resume: bool, state: Dictionary, error: String) -> void:
	if not ok:
		push_error("main: bridge session failed: %s" % error)
		_hud.show_brief_message("⚠ Error de sesión: %s" % error, 4.0)
		return_to_title()
		return
	NarrativeState.hydrate_from_session_data(state, is_resume)
	print("main: bridge session %s (%s)" % [p_session_id, "resume" if is_resume else "new"])
	# Asegura el estado in-game: un resume puede llegar sin pasar por
	# _start_game (F9 / remote "load" tras una muerte que volvió al título).
	_session_active = true
	_player.visible = true
	if has_node("TitleScreen"):
		get_node("TitleScreen").queue_free()
	if is_resume:
		var appearance: Dictionary = NarrativeState.player.get("appearance", {})
		_apply_player_appearance(
			String(appearance.get("model_id", "pete")), String(appearance.get("skin_path", ""))
		)
		_materialize_resumed_state(state)
	# Nuevo juego: la escena inicial llega por narrative_scene cuando el motor
	# narrativo la genera; narrative_status va informando en el HUD.


func _materialize_resumed_state(state: Dictionary) -> void:
	"""Reconstruye el mundo desde el SessionData del bridge: escena activa,
	posición y HP del save, y entities dinámicas re-materializadas."""
	var world_d: Dictionary = state.get("world", {})
	var active_id: String = String(world_d.get("active_scene_id", ""))
	var scenes: Dictionary = state.get("scenes_loaded", {})
	if active_id == "" or not scenes.has(active_id):
		push_error("main: resume sin escena activa materializable (active_scene_id='%s')" % active_id)
		_hud.show_brief_message("⚠ El save no tiene escena activa", 4.0)
		return
	var scene_record: Dictionary = scenes[active_id]
	var player_d: Dictionary = state.get("player", {})
	var pos_arr: Array = player_d.get("position", [0.0, 1.0, 0.0])
	var spawn_pos := Vector3(float(pos_arr[0]), float(pos_arr[1]), float(pos_arr[2]))
	await _apply_room(scene_record.get("scene_data", {}), spawn_pos, true, false)
	# Entities dinámicas (spawneadas después de la génesis de la escena); los
	# NPCs scene_init ya vienen dentro del scene_data.
	var respawned := 0
	for ent_v: Variant in state.get("entities", []):
		if not ent_v is Dictionary:
			continue
		var ent: Dictionary = ent_v
		if String(ent.get("scene_id", "")) != active_id:
			continue
		if String(ent.get("spawn_reason", "")) == "scene_init":
			continue
		_materialize_entity_record(ent)
		respawned += 1
	# HP del save al runtime (la Fase 1 del bridge ya resembró su sim igual)
	var hp: float = float(player_d.get("health", _player_combatant.max_health))
	_player_combatant.health = hp
	GameStore.dispatch("player_respawned", {"hp": hp})
	print("main: resume materializado — escena %s, %d entities, hp %.0f" % [active_id, respawned, hp])


func _materialize_entity_record(ent: Dictionary) -> void:
	"""Materializa un EntityRecord del save (o un effect ya normalizado) en la
	escena actual SIN registrarlo en NarrativeState (ya está registrado)."""
	if not _current_room:
		push_error("main: no hay escena para materializar entity '%s'" % ent.get("id", "?"))
		return
	var ent_id: String = String(ent.get("id", ""))
	var ent_type: String = String(ent.get("type", "object"))
	var pos: Array = ent.get("position", [0.0, 0.0, 0.0])
	var data: Dictionary = ent.get("data", {})
	var spawner = ObjectSpawnerScript.new()
	match ent_type:
		"npc":
			spawner.spawn_npcs([{
				"id": ent_id,
				"name": String(data.get("name", "Stranger")),
				"character_type": String(data.get("character_type", "peasant_male")),
				"animation": String(data.get("animation", "idle")),
				"position": pos,
				"scale": [0.5, 1.8, 0.5],
				"description": String(data.get("description", data.get("name", ""))),
			}], _current_room)
		"enemy":
			var combat_data: Dictionary = data.get("combat", {})
			var obj_data := {
				"id": ent_id,
				"mesh": "capsule",
				"position": pos,
				"rotation": [0, 0, 0],
				"scale": [0.6, 1.8, 0.6],
				"category": "creature",
				"description": String(data.get("description", "enemy")),
				"character_model": "",
				"combat": {
					"health": combat_data.get("health", 80),
					"weapon_id": combat_data.get("weapon_id", "unarmed"),
					"personality": combat_data.get("personality", {}),
				},
			}
			var char_type: String = String(data.get("character_type", ""))
			if char_type != "":
				var model_path: String = NpcModelRegistryScript.get_model_path(char_type)
				if model_path != "":
					obj_data["character_model"] = model_path
			spawner.spawn_objects([obj_data], _current_room)
			var enemy_node := _current_room.get_node_or_null(ent_id)
			if enemy_node:
				var c = enemy_node.get_node_or_null("Combatant")
				if c:
					_combat_manager.register_combatant(c)
		_:
			# object / building / prop — si el data ya trae un obj completo del
			# spawner (tiene "mesh"), usarlo tal cual; si no, construir uno.
			var obj: Dictionary
			if data.has("mesh"):
				obj = data.duplicate(true)
				obj["id"] = ent_id
				obj["position"] = pos
			else:
				obj = {
					"id": ent_id,
					"mesh": "box",
					"position": pos,
					"rotation": [0, 0, 0],
					"scale": [3.0, 3.0, 3.0] if ent_type == "building" else [0.5, 0.5, 0.5],
					"category": "building" if ent_type == "building" else "prop",
					"description": String(data.get("description", ent_type)),
				}
				if data.has("texture_hash"):
					obj["texture_hash"] = data["texture_hash"]
				if data.has("model_hash"):
					obj["model_hash"] = data["model_hash"]
			spawner.spawn_objects([obj], _current_room)


# --- Canonical narrative handlers (bridge session) ---


func _on_narrative_scene(scene_id: String, scene_data: Dictionary) -> void:
	if not _session_active:
		return
	# El bridge ya registró la escena en SU NarrativeState (el canónico); el
	# espejo GD la refleja en memoria para el history browser y F9. save()
	# está bloqueado por bridge_authoritative, así que no hay doble escritor.
	NarrativeState.record_scene_loaded(scene_id, scene_data, [])
	_apply_room(scene_data, SceneBuilderScript.spawn_position(scene_data), true, false)


func _on_narrative_dialogue(speaker: String, text: String, choices: Array) -> void:
	if not _session_active or text == "":
		return
	_dialogue_flow.show_dialogue(speaker, text, choices)


func _on_narrative_spawn(effect: Dictionary) -> void:
	if not _session_active or not _current_room:
		return
	var pos: Array = effect.get("position", [0.0, 0.0, 0.0])
	var data: Dictionary = effect.get("data", {})
	# El effect lleva nombre/descripción top-level; fusiónalos en data para el
	# materializador (sin pisar los que ya vengan).
	var merged: Dictionary = data.duplicate(true)
	if not merged.has("name") and effect.has("name"):
		merged["name"] = effect["name"]
	if not merged.has("description"):
		merged["description"] = effect.get("description", "")
	var ent := {
		"id": String(effect.get("entityId", "")),
		"type": String(effect.get("entityKind", "object")),
		"position": pos,
		"data": merged,
	}
	_materialize_entity_record(ent)
	# Espejo en memoria (el registro canónico ya lo hizo el bridge)
	NarrativeState.record_entity_spawned(
		ent["id"], ent["type"], NarrativeState.world.get("active_scene_id", ""),
		pos, merged, "narrative_event", String(effect.get("eventId", ""))
	)
	var desc: String = String(effect.get("description", ""))
	_hud.show_brief_message("✨ %s" % desc.substr(0, 40))


func _on_narrative_status(phase: String, kind: String, message: String) -> void:
	if not _session_active:
		return
	match phase:
		"generating":
			_hud.show_brief_message(message if message != "" else "Generando...", 8.0)
		"error":
			push_warning("main: narrative_status error (%s): %s" % [kind, message])
			_hud.show_brief_message("⚠ %s" % message, 5.0)
		"ready":
			pass


func _on_narrative_story_delta(delta: String) -> void:
	if not NarrativeState.bridge_authoritative or delta == "":
		return
	# Espejo en memoria del story_so_far canónico (el bridge ya lo aplicó)
	if NarrativeState.story_so_far == "":
		NarrativeState.story_so_far = delta
	else:
		NarrativeState.story_so_far += "\n\n" + delta


func _on_narrative_ambient(message: String) -> void:
	if not _session_active or message == "":
		return
	_hud.show_brief_message(message, 4.0)


func _on_bridge_session_saved(ok: bool) -> void:
	if ok:
		_hud.show_brief_message("Partida guardada")
	else:
		push_warning("main: el bridge no pudo guardar la sesión")
		_hud.show_brief_message("⚠ Error al guardar", 4.0)


# --- Scenario handlers ---


func _apply_spawn_entity_consequence(c: Dictionary, event_id: String) -> void:
	"""Materialize a narrative-driven spawn into the current scene."""
	if not _current_room:
		return
	var kind: String = c.get("entity_kind", "object")
	var description: String = c.get("description", "an entity")
	var hint: String = c.get("position_hint", "near_player")
	# Resolve a plausible position relative to the player
	var spawn_pos := _resolve_position_hint(hint)
	var entity_id := "narr_%s_%d" % [kind, int(Time.get_unix_time_from_system())]
	var spawner = ObjectSpawnerScript.new()
	if kind == "npc":
		var npc_data := {
			"id": entity_id,
			"name": c.get("name", "Stranger"),
			"character_type": "peasant_male",
			"animation": "idle",
			"position": [spawn_pos.x, spawn_pos.y, spawn_pos.z],
			"scale": [0.5, 1.8, 0.5],
			"description": description,
			"dialogue_hint": description,
		}
		spawner.spawn_npcs([npc_data], _current_room)
	else:
		var obj_data := {
			"id": entity_id,
			"mesh": "box",
			"position": [spawn_pos.x, spawn_pos.y, spawn_pos.z],
			"rotation": [0, 0, 0],
			"scale": [3.0, 3.0, 3.0] if kind == "building" else [0.5, 0.5, 0.5],
			"category": "building" if kind == "building" else "prop",
			"description": description,
		}
		# Reuse cached assets when Claude provided hashes
		if c.has("texture_hash"):
			obj_data["texture_hash"] = c["texture_hash"]
		if c.has("model_hash"):
			obj_data["model_hash"] = c["model_hash"]
		spawner.spawn_objects([obj_data], _current_room)
	# Record into NarrativeState so it survives save/resume
	NarrativeState.record_entity_spawned(
		entity_id, kind, NarrativeState.world.get("active_scene_id", ""),
		[spawn_pos.x, spawn_pos.y, spawn_pos.z], c, "narrative_request", event_id
	)
	_hud.show_brief_message("✨ %s aparece" % description.substr(0, 40))
	print("Narrative: spawned %s '%s' at %s (event=%s)" % [kind, description, spawn_pos, event_id])


func _resolve_position_hint(hint: String) -> Vector3:
	"""Convert a textual position hint from the narrative engine into a world
	position relative to the player. Best-effort — anything unrecognized falls
	through to 'near_player'."""
	var base: Vector3 = _player.global_position if _player else Vector3.ZERO
	var fwd := Vector3(0, 0, -1)
	if _player:
		var anim: Node3D = _player.get_node_or_null("CombatAnimator")
		if anim:
			fwd = anim.global_transform.basis.z
			fwd.y = 0.0
			fwd = fwd.normalized()
	match hint:
		"near_player":
			return base + fwd * 5.0
		"distant_north":
			return base + Vector3(0, 0, -50)
		"distant_south":
			return base + Vector3(0, 0, 50)
		"distant_east":
			return base + Vector3(50, 0, 0)
		"distant_west":
			return base + Vector3(-50, 0, 0)
		_:
			# Unknown hint — try to parse "distant_<dir>" or fall back to near_player
			return base + fwd * 10.0
