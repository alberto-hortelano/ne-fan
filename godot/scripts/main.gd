extends Node3D

const RoomBuilderScript = preload("res://scripts/room/room_builder.gd")
const TextureLoaderScript = preload("res://scripts/ai_assets/texture_loader.gd")
const ModelLoaderScript = preload("res://scripts/ai_assets/model_loader.gd")
const SpriteLoaderScript = preload("res://scripts/ai_assets/sprite_loader.gd")
const GameHUDScript = preload("res://scripts/ui/game_hud.gd")
const CombatManagerScript = preload("res://scripts/combat/combat_manager.gd")
const CombatHUDScript = preload("res://scripts/combat/combat_hud.gd")
const CombatantScript = preload("res://scripts/combat/combatant.gd")
const PlayerCombatInputScript = preload("res://scripts/combat/player_combat_input.gd")
const CombatAnimatorScript = preload("res://scripts/combat/combat_animator.gd")
const CombatAnimationSyncScript = preload("res://scripts/combat/combat_animation_sync.gd")
const DevMenuScript = preload("res://scripts/ui/dev_menu.gd")
const CameraControllerScript = preload("res://scripts/player/camera_controller.gd")

var _room_files: Array[String] = []
var _dev_menu: CanvasLayer
var _camera_controller: Node3D

var _room_builder = RoomBuilderScript.new()
var _texture_loader = TextureLoaderScript.new()
var _model_loader = ModelLoaderScript.new()
var _sprite_loader = SpriteLoaderScript.new()
var _hud: CanvasLayer
var _combat_manager: Node  # CombatManager
var _combat_hud  # CombatHUD
var _player_combatant: Node  # Combatant
var _current_room: Node3D = null
var _transitioning := false

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

	_combat_manager.register_combatant(_player_combatant)
	_combat_hud.set_player_combatant(_player_combatant)
	player_input.attack_type_changed.connect(_combat_hud.on_attack_type_changed)
	_combat_manager.combat_result.connect(_combat_hud.on_combat_result)
	_player_combatant.damage_received.connect(_on_player_damage_received)

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

	# Logic bridge (TS combat authority)
	LogicBridge._player = _player
	LogicBridge._player_combatant = _player_combatant

	# AI client
	AIClient.room_generated.connect(_on_room_generated)
	AIClient.generation_failed.connect(_on_generation_failed)
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

	# Make player collision capsule semi-visible for dev
	_make_player_capsule_visible()

	# Load initial room
	_load_room_from_file(0)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_F1: _load_room_from_file(0)
			KEY_F2: _load_room_from_file(1)
			KEY_F3: _load_room_from_file(2)
			KEY_F12: _dev_menu.toggle()
			KEY_R:
				if _player_combatant.health <= 0.0:
					if LogicBridge.is_connected_to_bridge():
						LogicBridge.send_respawn()
					else:
						respawn_player()
			KEY_F5:
				if GameState.save_to_disk():
					_hud.show_brief_message("Partida guardada")
			KEY_F9:
				if GameState.load_from_disk():
					_hud.show_brief_message("Partida cargada")
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
	game.sort()
	style.sort()
	dev.sort()
	_room_files = []
	_room_files.append_array(game)
	_room_files.append_array(style)
	_room_files.append_array(dev)
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
	load_room_by_path(_room_files[index])


# --- AI room generation (exit transitions) ---

func _on_exit_entered(body: Node3D, area: Area3D) -> void:
	if body != _player or _transitioning:
		return

	var exit_wall: String = area.get_meta("wall", "north")
	var target_hint: String = area.get_meta("target_hint", "")

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

	# AI assets (async, progressive)
	_texture_loader.load_room_textures(_current_room)
	_model_loader.load_room_models(_current_room)
	_sprite_loader.load_room_sprites(_current_room)

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

	# Sync player state from store (logic is the authority)
	var stored_hp: float = GameStore.state.player.hp
	if stored_hp > 0:
		_player_combatant.health = stored_hp
		_player_combatant.state = 0  # IDLE
		_player_combatant.current_attack_type = ""
		var player_sync = _player.get_node_or_null("CombatAnimationSync")
		if player_sync:
			player_sync.reset()
	GameState.player_health = _player_combatant.health

	# Position player
	_player.position = player_pos
	_player.velocity = Vector3.ZERO

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
	if LogicBridge.is_connected_to_bridge():
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
		LogicBridge.send_room_loaded(data.get("room_id", "unknown"), bridge_enemies)

	# Update state
	GameState.mark_room_visited(data.get("room_id", "unknown"), data)

	# Fade in
	if fade:
		await _hud.fade_in(0.4)
