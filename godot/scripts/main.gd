extends Node3D

const RoomBuilderScript = preload("res://scripts/room/room_builder.gd")
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
const CharacterEditorScript = preload("res://scripts/ui/character_editor.gd")
const NpcModelRegistryScript = preload("res://scripts/npc/npc_model_registry.gd")

var _room_files: Array[String] = []
var _dev_menu: CanvasLayer
var _camera_controller: Node3D
var _dialogue_ui: Node  # DialogueUI

var _room_builder = RoomBuilderScript.new()
var _texture_loader = TextureLoaderScript.new()
var _model_loader = ModelLoaderScript.new()
var _hud: CanvasLayer
var _combat_manager: Node  # CombatManager
var _combat_hud  # CombatHUD
var _player_combatant: Node  # Combatant
var _current_room: Node3D = null
var _transitioning := false
var _scenario_active := false
var _returning_to_title := false
var _pause_menu: CanvasLayer = null
var _paused := false
var _pending_game_id := ""
var _pending_scene_path := ""
var _pending_session_id := ""
# Cache of the last dialogue shown so we can record it on choice
var _last_dialogue_speaker := ""
var _last_dialogue_text := ""
var _last_dialogue_choices: Array = []
# Free-text reply in flight: the scripted scenario is paused waiting for
# Claude's reaction. When the reaction arrives (or the player advances past
# Claude's injected dialogue), we resume the script with the remembered
# fallback choice so the beat machine never stays stuck.
var _pending_free_text_event_id := ""
var _pending_free_text_orig_choices: Array = []
var _pending_free_text_pending: bool = false
var _claude_injected_dialogue: bool = false
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

	# AI client
	AIClient.room_generated.connect(_on_room_generated)
	AIClient.generation_failed.connect(_on_generation_failed)
	AIClient.narrative_consequences.connect(_on_narrative_consequences)
	AIClient.check_server()

	# Interaction system
	var ray = _player.get_node_or_null("InteractionRay")
	if ray:
		ray.target_changed.connect(_on_target_changed)
		ray.interacted.connect(_on_interacted)

	# Room info display
	GameState.room_entered.connect(_on_room_entered)

	# Scan test rooms dynamically
	_scan_rooms()

	# Dev menu
	_dev_menu = DevMenuScript.new()
	_dev_menu.room_selected.connect(_on_dev_room_selected)
	_dev_menu.animation_selected.connect(_on_dev_animation_selected)
	add_child(_dev_menu)
	_dev_menu.call_deferred("set_rooms", _room_files)
	_dev_menu.call_deferred("set_animations", CombatAnimatorScript.ANIM_MAP.keys())

	# Dialogue UI
	_dialogue_ui = DialogueUIScript.new()
	_dialogue_ui.name = "DialogueUI"
	add_child(_dialogue_ui)
	_dialogue_ui.dialogue_advanced.connect(_on_dialogue_advanced)
	_dialogue_ui.dialogue_choice_made.connect(_on_dialogue_choice_made)

	# History browser (tecla H)
	var history_browser := HistoryBrowserScript.new()
	history_browser.name = "HistoryBrowser"
	add_child(history_browser)

	# Scenario signals from LogicBridge
	LogicBridge.scenario_dialogue.connect(_on_scenario_dialogue)
	LogicBridge.scenario_objective.connect(_on_scenario_objective)
	LogicBridge.scenario_change_scene.connect(_on_scenario_change_scene)
	LogicBridge.scenario_spawn_npc.connect(_on_scenario_spawn_npc)
	LogicBridge.scenario_despawn_npc.connect(_on_scenario_despawn_npc)
	LogicBridge.scenario_spawn_enemy.connect(_on_scenario_spawn_enemy)
	LogicBridge.scenario_give_weapon.connect(_on_scenario_give_weapon)
	LogicBridge.scenario_spawn_objects.connect(_on_scenario_spawn_objects)

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
			KEY_F1: _load_room_from_file(0)
			KEY_F2: _load_room_from_file(1)
			KEY_F3: _load_room_from_file(2)
			KEY_F4:
				_reset_game_state()
				_scenario_active = true
				_player.visible = true
				_player.set_physics_process(true)
				Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
				LogicBridge.send_load_game("tavern_intro")
				_hud.show_brief_message("Cargando escenario...")
			KEY_F12: _dev_menu.toggle()
			KEY_R:
				if _player_combatant.health <= 0.0:
					if LogicBridge.is_connected_to_bridge():
						LogicBridge.send_respawn()
					else:
						respawn_player()
			KEY_F5:
				# Save both: GameState (combat-side) and NarrativeState (canonical session)
				var ok_legacy: bool = GameState.save_to_disk()
				var ok_narrative: bool = NarrativeState.save() if NarrativeState.session_id != "" else false
				if ok_legacy or ok_narrative:
					_hud.show_brief_message("Partida guardada")
			KEY_F9:
				if GameState.load_from_disk():
					_hud.show_brief_message("Partida cargada")
					# Restore player appearance
					_apply_player_appearance(GameState.player_model_id, GameState.player_skin_path)
					# Reload current room from visited_rooms
					if GameState.visited_rooms.has(GameState.current_room_id):
						_apply_room(GameState.visited_rooms[GameState.current_room_id], Vector3(0, 1, 0), false)


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


func _on_player_damage_received(amount: float, _from: Node) -> void:
	GameState.player_health = _player_combatant.health


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


func _on_room_entered(room_id: String, description: String, _ambient: String) -> void:
	_hud.show_room_info(room_id, description)


func respawn_player() -> void:
	_combat_manager.clear_pending()
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
	GameState.player_health = _player_combatant.max_health
	GameStore.state.player.hp = _player_combatant.max_health
	GameStore.state.player.combat_state = "idle"
	_player.position = Vector3(0, 1, 4)
	_player.velocity = Vector3.ZERO
	var player_sync = _player.get_node_or_null("CombatAnimationSync")
	if player_sync:
		player_sync.reset()
	var player_anim = _player.get_node_or_null("CombatAnimator")
	if player_anim:
		player_anim.play("idle")
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

	_pause_menu = CanvasLayer.new()
	_pause_menu.name = "PauseMenu"
	_pause_menu.layer = 21
	_pause_menu.process_mode = Node.PROCESS_MODE_ALWAYS

	var bg := ColorRect.new()
	bg.color = Color(0, 0, 0, 0.6)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	_pause_menu.add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_pause_menu.add_child(center)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 20)
	center.add_child(vbox)

	var title := Label.new()
	title.text = "PAUSA"
	title.add_theme_font_size_override("font_size", 42)
	title.add_theme_color_override("font_color", Color(0.85, 0.65, 0.3))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	var btn_style := StyleBoxFlat.new()
	btn_style.bg_color = Color(0.12, 0.08, 0.18)
	btn_style.border_color = Color(0.5, 0.35, 0.15)
	btn_style.set_border_width_all(2)
	btn_style.set_corner_radius_all(6)
	btn_style.set_content_margin_all(12)

	var hover_style := btn_style.duplicate()
	hover_style.bg_color = Color(0.2, 0.12, 0.25)
	hover_style.border_color = Color(0.85, 0.65, 0.3)

	var btn_resume := Button.new()
	btn_resume.text = "Continuar"
	btn_resume.add_theme_font_size_override("font_size", 24)
	btn_resume.custom_minimum_size = Vector2(300, 55)
	btn_resume.add_theme_stylebox_override("normal", btn_style)
	btn_resume.add_theme_stylebox_override("hover", hover_style)
	btn_resume.add_theme_stylebox_override("focus", hover_style)
	btn_resume.pressed.connect(_unpause)
	vbox.add_child(btn_resume)

	var btn_title := Button.new()
	btn_title.text = "Volver al titulo"
	btn_title.add_theme_font_size_override("font_size", 24)
	btn_title.custom_minimum_size = Vector2(300, 55)
	btn_title.add_theme_stylebox_override("normal", btn_style.duplicate())
	btn_title.add_theme_stylebox_override("hover", hover_style.duplicate())
	btn_title.add_theme_stylebox_override("focus", hover_style.duplicate())
	btn_title.pressed.connect(_on_pause_return_to_title)
	vbox.add_child(btn_title)

	add_child(_pause_menu)
	btn_resume.call_deferred("grab_focus")


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
	_scenario_active = false
	# GameState
	GameState.reset()
	# GameStore narrative
	GameStore.state.narrative.story_so_far = ""
	GameStore.state.narrative.last_dialogue = ""
	GameStore.state.narrative.last_interaction = ""
	GameStore.state.world.rooms_visited.clear()
	# Combat
	_combat_manager.clear_pending()
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
	GameStore.state.player.hp = _player_combatant.max_health
	GameStore.state.player.combat_state = "idle"

	var player_sync = _player.get_node_or_null("CombatAnimationSync")
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
	var style: Array[String] = []
	var dev: Array[String] = []
	_scan_room_dir("res://test_rooms", false)
	# Separate into categories
	var all := _room_files.duplicate()
	_room_files.clear()
	for f: String in all:
		var fname: String = f.get_file()
		if fname.begins_with("style_"):
			style.append(f)
		else:
			game.append(f)
	_scan_room_dir("res://test_rooms/dev", false)
	for f: String in _room_files:
		dev.append(f)
	var stress: Array[String] = []
	_room_files.clear()
	_scan_room_dir("res://test_rooms/stress", false)
	for f: String in _room_files:
		stress.append(f)
	game.sort()
	style.sort()
	dev.sort()
	stress.sort()
	_room_files = []
	_room_files.append_array(game)
	_room_files.append_array(style)
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
	_scenario_active = false
	if _dialogue_ui:
		_dialogue_ui.hide_all()
	load_room_by_path(file_path)


func _on_dev_animation_selected(anim_name: String) -> void:
	var animator = _player.get_node_or_null("CombatAnimator")
	if animator:
		animator.play(anim_name)
	# Disable combat animation sync while previewing
	var sync = _player.get_node_or_null("CombatAnimationSync")
	if sync:
		sync.set_process(false)


func _reactivate_animation_sync() -> void:
	var sync = _player.get_node_or_null("CombatAnimationSync")
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
	_apply_room(data, Vector3(0, 1, 0), false)


func _load_room_from_file(index: int) -> void:
	if index < 0 or index >= _room_files.size():
		return
	_scenario_active = false
	if _dialogue_ui:
		_dialogue_ui.hide_all()
	load_room_by_path(_room_files[index])


# --- AI room generation (exit transitions) ---

func _on_exit_entered(body: Node3D, area: Area3D) -> void:
	if body != _player or _transitioning:
		return

	var exit_wall: String = area.get_meta("wall", "north")
	var target_hint: String = area.get_meta("target_hint", "")

	# Notify scenario runner of exit (may trigger beat advancement)
	LogicBridge.send_scenario_event("exit_entered", {"exitWall": exit_wall})

	# If a scenario game is active, let the ScenarioRunner handle scene transitions
	if _scenario_active:
		return

	# Check cache
	var cache_key := "%s_%s" % [GameState.current_room_id, exit_wall]
	if GameState.visited_rooms.has(cache_key):
		var entry_wall: String = GameState.OPPOSITE_WALL.get(exit_wall, "south")
		var cached_data: Dictionary = GameState.visited_rooms[cache_key]
		var dims: Dictionary = cached_data.get("dimensions", {})
		_apply_room(cached_data, GameState.get_entry_position(entry_wall, dims), true)
		return

	# Freeze player + fade out
	_transitioning = true
	_player.velocity = Vector3.ZERO
	_player.set_physics_process(false)
	_hud.hide_prompt()
	_hud.hide_text_panel()

	var entry_wall: String = GameState.OPPOSITE_WALL.get(exit_wall, "south")
	var world_state := GameState.serialize_world_state(entry_wall, target_hint)
	set_meta("_pending_entry_wall", entry_wall)
	set_meta("_pending_cache_key", cache_key)

	await _hud.fade_out(0.4)
	AIClient.generate_room(world_state)


func _on_room_generated(room_data: Dictionary) -> void:
	_transitioning = false
	_player.set_physics_process(true)
	var entry_wall: String = get_meta("_pending_entry_wall", "south")
	var cache_key: String = get_meta("_pending_cache_key", "")

	if cache_key:
		GameState.visited_rooms[cache_key] = room_data

	var dims: Dictionary = room_data.get("dimensions", {})
	_apply_room(room_data, GameState.get_entry_position(entry_wall, dims), true)


func _on_generation_failed(error: String) -> void:
	_transitioning = false
	_player.set_physics_process(true)
	print("Generation failed: %s" % error)
	_load_room_from_file(0)
	await _hud.fade_in(0.3)


# --- Room building ---

func _apply_room(data: Dictionary, player_pos: Vector3, fade: bool = false) -> void:
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

	_current_room = _room_builder.build_room(data)
	add_child(_current_room)

	for area in _room_builder.exit_areas:
		area.body_entered.connect(_on_exit_entered.bind(area))

	# Set player reference for ChunkManager (if outdoor chunked terrain)
	var chunk_mgr = _current_room.get_node_or_null("ChunkManager")
	if chunk_mgr:
		chunk_mgr.set_player(_player)

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

	# Reset player state on room change
	_player_combatant.health = _player_combatant.max_health
	_player_combatant.state = 0  # IDLE
	_player_combatant.current_attack_type = ""
	GameState.player_health = _player_combatant.max_health
	GameStore.state.player.hp = _player_combatant.max_health
	GameStore.state.player.combat_state = "idle"
	var player_sync = _player.get_node_or_null("CombatAnimationSync")
	if player_sync:
		player_sync.reset()

	# Position player and re-enable physics
	# Wait a frame for collision shapes to register before enabling physics
	_player.position = player_pos
	_player.velocity = Vector3.ZERO
	await get_tree().physics_frame
	await get_tree().physics_frame
	_player.position = player_pos
	_player.velocity = Vector3.ZERO
	_player.set_physics_process(true)

	# Dispatch room change to store
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
	GameStore.dispatch("room_changed", {
		"room_id": data.get("room_id", "unknown"),
		"room_data": data,
		"enemies": enemies_state,
	})

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
	LogicBridge.send_room_loaded(data.get("room_id", "unknown"), bridge_enemies, dims)

	# Update state
	GameState.mark_room_visited(data.get("room_id", "unknown"), data)

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
	# Apply appearance to player
	_apply_player_appearance(model_id, skin_path)
	# Continue with game start
	_start_game(_pending_game_id, _pending_scene_path, _pending_session_id)


func _on_editor_cancelled() -> void:
	_character_editor = null
	# Return to title screen
	var title_screen := TitleScreenScript.new()
	title_screen.name = "TitleScreen"
	title_screen.game_selected.connect(_on_title_game_selected)
	add_child(title_screen)


func _apply_player_appearance(model_id: String, skin_path: String) -> void:
	var animator: Node3D = _player.get_node_or_null("CombatAnimator")
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
	# Persist
	GameStore.dispatch("appearance_changed", {"model_id": model_id, "skin_path": skin_path})
	GameState.player_model_id = model_id
	GameState.player_skin_path = skin_path


func _start_game(game_id: String, scene_path: String, resume_session_id: String = "") -> void:
	_reset_game_state()
	_scenario_active = true
	_player.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

	# Establish a NarrativeState session: either fresh or resumed from save
	if resume_session_id != "":
		if not NarrativeState.load_session(resume_session_id):
			print("main: failed to resume session %s — starting fresh" % resume_session_id)
			NarrativeState.start_new_session(game_id)
	else:
		NarrativeState.start_new_session(game_id)
	# Tell the MCP bridge so Claude knows what session is in flight
	if LogicBridge.has_method("send_session_start"):
		LogicBridge.send_session_start(NarrativeState.session_id, game_id, resume_session_id != "")
	# Notify ai_server so Claude sees session info in narrative requests
	AIClient.notify_session_start(NarrativeState.session_id, game_id, resume_session_id != "")

	# Send load_game to bridge — it will respond with change_scene + spawn_npc
	LogicBridge.send_load_game(game_id)
	if not LogicBridge.is_connected_to_bridge():
		# Fallback: load room from disk when no bridge available
		load_room_by_path(scene_path)
	# Player physics re-enabled by _apply_room when room arrives


# --- Scenario handlers ---


func _on_scenario_dialogue(speaker: String, text: String, choices: Array) -> void:
	if not _scenario_active:
		return
	_last_dialogue_speaker = speaker
	_last_dialogue_text = text
	_last_dialogue_choices = choices
	_dialogue_ui.show_dialogue(speaker, text, choices)


func _on_scenario_objective(text: String) -> void:
	if not _scenario_active:
		return
	_dialogue_ui.show_objective(text)


func _on_scenario_change_scene(scene_data: Dictionary) -> void:
	if not _scenario_active:
		return
	_apply_room(scene_data, Vector3(0, 1, 0), true)
	# Record into the narrative session for save/resume
	var scene_id: String = scene_data.get("room_id", scene_data.get("scene_id", ""))
	if scene_id != "":
		NarrativeState.record_scene_loaded(scene_id, scene_data, [])


func _on_scenario_spawn_npc(data: Dictionary) -> void:
	if not _scenario_active or not _current_room:
		return
	var spawner = ObjectSpawnerScript.new()
	var npc_data := {
		"id": data.get("id", "npc"),
		"name": data.get("name", "Stranger"),
		"character_type": data.get("character_type", "peasant_male"),
		"animation": data.get("animation", "idle"),
		"position": data.get("position", [0, 0, 0]),
		"scale": [0.5, 1.8, 0.5],
		"description": data.get("name", ""),
	}
	spawner.spawn_npcs([npc_data], _current_room)
	print("Scenario: spawned NPC '%s' (%s)" % [data.get("name", ""), data.get("character_type", "")])
	NarrativeState.record_entity_spawned(
		npc_data["id"], "npc", NarrativeState.world.get("active_scene_id", ""),
		npc_data["position"], data, "scenario"
	)


func _on_scenario_despawn_npc(npc_id: String) -> void:
	if not _scenario_active or not _current_room:
		return
	var node := _current_room.get_node_or_null(npc_id)
	if node:
		node.queue_free()
		print("Scenario: despawned NPC '%s'" % npc_id)
	NarrativeState.record_entity_despawned(npc_id)


func _on_scenario_spawn_enemy(data: Dictionary) -> void:
	if not _scenario_active or not _current_room:
		return
	var spawner = ObjectSpawnerScript.new()
	var combat_data: Dictionary = data.get("combat", {})
	var pos: Array = data.get("position", [0, 0, 0])
	var obj_data := {
		"id": data.get("id", "enemy"),
		"mesh": "capsule",
		"position": pos,
		"rotation": [0, 0, 0],
		"scale": [0.6, 1.8, 0.6],
		"category": "creature",
		"description": "enemy",
		"character_model": "",
		"combat": {
			"health": combat_data.get("health", 80),
			"weapon_id": combat_data.get("weapon_id", "unarmed"),
			"personality": combat_data.get("personality", {}),
		},
	}
	# Map character_type to model path
	var char_type: String = data.get("character_type", "")
	if char_type == "mutant":
		obj_data["character_model"] = "res://assets/characters/mixamo/mutant/character.fbx"
	elif char_type == "warrok":
		obj_data["character_model"] = "res://assets/characters/mixamo/warrok/character.fbx"
	elif char_type == "skeletonzombie":
		obj_data["character_model"] = "res://assets/characters/mixamo/skeletonzombie/character.fbx"
	spawner.spawn_objects([obj_data], _current_room)

	# Register with combat manager
	for child in _current_room.get_children():
		if child.name == data.get("id", ""):
			var c = child.get_node_or_null("Combatant")
			if c:
				_combat_manager.register_combatant(c)
	print("Scenario: spawned enemy '%s'" % data.get("id", ""))
	NarrativeState.record_entity_spawned(
		obj_data["id"], "enemy", NarrativeState.world.get("active_scene_id", ""),
		obj_data["position"], data, "scenario"
	)


func _on_scenario_give_weapon(weapon_id: String) -> void:
	if not _scenario_active:
		return
	if _player_combatant:
		_player_combatant.weapon_id = weapon_id
		GameStore.dispatch("weapon_changed", {"weapon_id": weapon_id})
		_hud.show_brief_message("Obtienes: %s" % weapon_id)
		print("Scenario: gave weapon '%s'" % weapon_id)


func _on_scenario_spawn_objects(objects: Array) -> void:
	if not _scenario_active or not _current_room:
		return
	var spawner := ObjectSpawnerScript.new()
	spawner.spawn_objects(objects, _current_room)
	print("Scenario: spawned %d dynamic objects" % objects.size())
	for obj in objects:
		var obj_id: String = obj.get("id", "")
		if obj_id == "":
			continue
		NarrativeState.record_entity_spawned(
			obj_id, "object", NarrativeState.world.get("active_scene_id", ""),
			obj.get("position", [0, 0, 0]), obj, "scenario"
		)


func _on_dialogue_advanced() -> void:
	# If the player is advancing past a Claude-injected dialogue, use this
	# moment to resume the scripted scenario that we paused when the player
	# wrote free text. Otherwise we'd remain stuck waiting for a beat that
	# never triggers.
	if _claude_injected_dialogue and _pending_free_text_pending:
		_resume_script_after_free_text()
		return
	LogicBridge.send_scenario_event("dialogue_advanced")


func _on_dialogue_choice_made(choice_index: int, free_text: String = "") -> void:
	var speaker: String = _last_dialogue_speaker
	var text: String = _last_dialogue_text
	var choices: Array = _last_dialogue_choices

	# If the player was replying to a Claude-injected dialogue, treat the
	# choice as "advance past it" and resume the scripted script (Claude's
	# injected choices are freeform — they don't map onto scripted beats).
	if _claude_injected_dialogue and _pending_free_text_pending:
		# Record the Claude sub-dialogue into the session for replay/history,
		# but don't re-trigger another Claude call (it would loop).
		NarrativeState.record_dialogue_event(speaker, text, choices, choice_index, free_text)
		_resume_script_after_free_text()
		return

	var event_id: String = NarrativeState.record_dialogue_event(
		speaker, text, choices, choice_index, free_text
	)

	if choice_index < 0:
		# Free text: PAUSE the scripted scenario and wait for Claude's
		# reaction. We do NOT fall through to choice 0 — that would make
		# the scripted response fire immediately, which is exactly what
		# the player is trying to override.
		_pending_free_text_event_id = event_id
		_pending_free_text_orig_choices = choices.duplicate()
		_pending_free_text_pending = true
		_claude_injected_dialogue = false
		_hud.show_text_panel("🤔 Claude piensa en cómo responde el mundo...")
		AIClient.report_player_choice(event_id, speaker, "", free_text,
			NarrativeState.serialize_for_llm("compact"))
	else:
		# Numbered choice: advance the scripted scenario immediately and
		# (in parallel) let Claude react, but without pausing the game.
		LogicBridge.send_scenario_event("dialogue_choice", {
			"choiceIndex": choice_index,
			"freeText": free_text,
		})
		var chosen_text: String = ""
		if choice_index < choices.size():
			var c = choices[choice_index]
			chosen_text = String(c.get("text", "")) if c is Dictionary else String(c)
		AIClient.report_player_choice(event_id, speaker, chosen_text, free_text,
			NarrativeState.serialize_for_llm("compact"))


func _resume_script_after_free_text() -> void:
	"""Release the free-text pause and advance the scripted scenario with the
	fallback action we remembered when the player first typed."""
	var orig_choices: Array = _pending_free_text_orig_choices
	_pending_free_text_event_id = ""
	_pending_free_text_orig_choices = []
	_pending_free_text_pending = false
	_claude_injected_dialogue = false
	_hud.hide_text_panel()
	if orig_choices.size() > 0:
		LogicBridge.send_scenario_event("dialogue_choice", {"choiceIndex": 0})
	else:
		LogicBridge.send_scenario_event("dialogue_advanced")


func _on_narrative_consequences(event_id: String, consequences: Array) -> void:
	"""Apply consequences emitted by the narrative engine after a player choice."""
	var is_free_text_pending: bool = (
		_pending_free_text_pending and event_id == _pending_free_text_event_id
	)
	var injected_dialogue_this_round := false

	# Clear the persistent "Claude piensa..." placeholder now that we have
	# a response. Individual consequence handlers below may show their own
	# brief messages on top.
	if is_free_text_pending:
		_hud.hide_text_panel()

	if consequences.is_empty():
		if is_free_text_pending:
			# Claude had nothing to add — resume the scripted scenario so
			# the player isn't stuck with a hidden dialogue state.
			_hud.show_brief_message("💭 El silencio responde al viento...")
			_resume_script_after_free_text()
		else:
			_hud.show_brief_message("💭 El mundo sigue su curso...")
		return

	for c in consequences:
		if not c is Dictionary:
			continue
		var ctype: String = c.get("type", "")
		match ctype:
			"dialogue":
				var spk: String = String(c.get("speaker", "?"))
				var txt: String = String(c.get("text", ""))
				var chx_raw = c.get("choices", [])
				var chx: Array = chx_raw if chx_raw is Array else []
				if txt == "":
					continue
				_last_dialogue_speaker = spk
				_last_dialogue_text = txt
				_last_dialogue_choices = chx
				_dialogue_ui.show_dialogue(spk, txt, chx)
				injected_dialogue_this_round = true
				if is_free_text_pending:
					_claude_injected_dialogue = true
			"story_update":
				var delta: String = c.get("delta", "")
				if delta != "":
					if NarrativeState.story_so_far == "":
						NarrativeState.story_so_far = delta
					else:
						NarrativeState.story_so_far += "\n\n" + delta
					if not injected_dialogue_this_round:
						_hud.show_brief_message("📖 " + delta.substr(0, 60))
			"spawn_entity":
				_apply_spawn_entity_consequence(c, event_id)
			"schedule_event":
				print("Narrative: scheduled event '%s' (trigger=%s)" % [
					c.get("description", ""), c.get("trigger", "")])
		# Record the consequence so the history browser (Phase 4) can show it
		NarrativeState.record_narrative_consequence(event_id, c)

	# If Claude didn't inject any dialogue in response to free text we need
	# to release the paused scenario so the game can continue; otherwise the
	# player sees nothing on screen and the beat machine hangs.
	if is_free_text_pending and not injected_dialogue_this_round:
		_resume_script_after_free_text()


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
