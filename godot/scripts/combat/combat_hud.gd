## Combat UI overlay: top bar with HP bars + attack selector (like HTML version).
## Attack types are read from combat_config.json — add/modify types there.
class_name CombatHUD
extends CanvasLayer

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

var _attack_type_order: Array[String] = []

const BAR_WIDTH := 120.0
const BAR_HEIGHT := 12.0
const ACTIVE_COLOR := Color(1.0, 0.85, 0.2)
const INACTIVE_COLOR := Color(0.5, 0.5, 0.5, 0.7)
const ACTIVE_BG := Color(0.3, 0.25, 0.1, 0.8)
const INACTIVE_BG := Color(0.15, 0.15, 0.15, 0.6)

var _player_hp_bar: ColorRect
var _player_hp_bg: ColorRect
var _player_hp_label: Label
var _enemy_hp_bar: ColorRect
var _enemy_hp_bg: ColorRect
var _enemy_hp_label: Label
var _attack_slots: Array[PanelContainer] = []
var _attack_labels: Array[Label] = []
var _selected_type: String = "quick"

var _player_combatant: Node
var _target_combatant: Node

# Combat log
var _log_container: VBoxContainer
const LOG_MAX_LINES := 8
const LOG_FADE_TIME := 8.0


func _ready() -> void:
	layer = 11

	# Top bar background
	var top_bar := PanelContainer.new()
	top_bar.anchors_preset = Control.PRESET_TOP_WIDE
	top_bar.offset_bottom = 32
	var bar_style := StyleBoxFlat.new()
	bar_style.bg_color = Color(0.08, 0.08, 0.1, 0.85)
	bar_style.content_margin_left = 12
	bar_style.content_margin_right = 12
	bar_style.content_margin_top = 4
	bar_style.content_margin_bottom = 4
	top_bar.add_theme_stylebox_override("panel", bar_style)
	add_child(top_bar)

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 16)
	top_bar.add_child(hbox)

	# --- Player HP ---
	var player_section := HBoxContainer.new()
	player_section.add_theme_constant_override("separation", 6)
	hbox.add_child(player_section)

	var player_label := Label.new()
	player_label.text = "Player"
	player_label.add_theme_font_size_override("font_size", 12)
	player_label.add_theme_color_override("font_color", Color(0.7, 0.7, 0.7))
	player_section.add_child(player_label)

	var player_bar_container := Control.new()
	player_bar_container.custom_minimum_size = Vector2(BAR_WIDTH, BAR_HEIGHT)
	player_section.add_child(player_bar_container)

	_player_hp_bg = ColorRect.new()
	_player_hp_bg.color = Color(0.25, 0.05, 0.05, 0.8)
	_player_hp_bg.size = Vector2(BAR_WIDTH, BAR_HEIGHT)
	_player_hp_bg.position.y = 4
	player_bar_container.add_child(_player_hp_bg)

	_player_hp_bar = ColorRect.new()
	_player_hp_bar.color = Color(0.8, 0.15, 0.1)
	_player_hp_bar.size = Vector2(BAR_WIDTH, BAR_HEIGHT)
	_player_hp_bar.position.y = 4
	player_bar_container.add_child(_player_hp_bar)

	_player_hp_label = Label.new()
	_player_hp_label.text = "100"
	_player_hp_label.add_theme_font_size_override("font_size", 12)
	_player_hp_label.add_theme_color_override("font_color", Color(0.9, 0.85, 0.7))
	player_section.add_child(_player_hp_label)

	# --- Enemy HP ---
	var enemy_section := HBoxContainer.new()
	enemy_section.add_theme_constant_override("separation", 6)
	hbox.add_child(enemy_section)

	var enemy_label := Label.new()
	enemy_label.text = "Enemy"
	enemy_label.add_theme_font_size_override("font_size", 12)
	enemy_label.add_theme_color_override("font_color", Color(0.7, 0.7, 0.7))
	enemy_section.add_child(enemy_label)

	var enemy_bar_container := Control.new()
	enemy_bar_container.custom_minimum_size = Vector2(BAR_WIDTH, BAR_HEIGHT)
	enemy_section.add_child(enemy_bar_container)

	_enemy_hp_bg = ColorRect.new()
	_enemy_hp_bg.color = Color(0.25, 0.05, 0.05, 0.8)
	_enemy_hp_bg.size = Vector2(BAR_WIDTH, BAR_HEIGHT)
	_enemy_hp_bg.position.y = 4
	enemy_bar_container.add_child(_enemy_hp_bg)

	_enemy_hp_bar = ColorRect.new()
	_enemy_hp_bar.color = Color(0.6, 0.1, 0.1)
	_enemy_hp_bar.size = Vector2(BAR_WIDTH, BAR_HEIGHT)
	_enemy_hp_bar.position.y = 4
	enemy_bar_container.add_child(_enemy_hp_bar)

	_enemy_hp_label = Label.new()
	_enemy_hp_label.text = "--"
	_enemy_hp_label.add_theme_font_size_override("font_size", 12)
	_enemy_hp_label.add_theme_color_override("font_color", Color(0.9, 0.85, 0.7))
	enemy_section.add_child(_enemy_hp_label)

	# --- Spacer ---
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hbox.add_child(spacer)

	# --- Attack type selector (from config) ---
	var config: Dictionary = CombatDataRef.load_config()
	var attack_types: Dictionary = config.get("attack_types", {})
	var idx := 0
	for type_id: String in attack_types:
		_attack_type_order.append(type_id)
		idx += 1
		var display: String = attack_types[type_id].get("display_name", type_id)
		var slot_panel := PanelContainer.new()
		var slot_style := StyleBoxFlat.new()
		slot_style.bg_color = INACTIVE_BG
		slot_style.border_color = INACTIVE_COLOR
		slot_style.border_width_left = 1
		slot_style.border_width_right = 1
		slot_style.border_width_top = 1
		slot_style.border_width_bottom = 1
		slot_style.content_margin_left = 4
		slot_style.content_margin_right = 4
		slot_style.content_margin_top = 1
		slot_style.content_margin_bottom = 1
		slot_panel.add_theme_stylebox_override("panel", slot_style)
		hbox.add_child(slot_panel)
		_attack_slots.append(slot_panel)

		var slot_label := Label.new()
		slot_label.text = "%d:%s" % [idx, display]
		slot_label.add_theme_font_size_override("font_size", 12)
		slot_panel.add_child(slot_label)
		_attack_labels.append(slot_label)

	if _attack_type_order.size() > 0:
		_selected_type = _attack_type_order[0]
	_update_slot_colors()

	# Combat log (bottom-left) — uses PanelContainer with dark background for visibility
	var vp_size: Vector2 = get_viewport().get_visible_rect().size
	var log_panel := PanelContainer.new()
	var log_style := StyleBoxFlat.new()
	log_style.bg_color = Color(0.0, 0.0, 0.0, 0.5)
	log_style.content_margin_left = 8
	log_style.content_margin_right = 8
	log_style.content_margin_top = 4
	log_style.content_margin_bottom = 4
	log_style.corner_radius_top_left = 4
	log_style.corner_radius_top_right = 4
	log_panel.add_theme_stylebox_override("panel", log_style)
	log_panel.position = Vector2(8, vp_size.y - 150)
	log_panel.size = Vector2(380, 140)
	log_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(log_panel)

	_log_container = VBoxContainer.new()
	_log_container.add_theme_constant_override("separation", 2)
	_log_container.alignment = BoxContainer.ALIGNMENT_END
	_log_container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	log_panel.add_child(_log_container)


func set_player_combatant(c: Node) -> void:
	_player_combatant = c


func set_target(c: Node) -> void:
	_target_combatant = c


func on_attack_type_changed(type_id: String) -> void:
	_selected_type = type_id
	_update_slot_colors()


func on_combat_result(attacker: Node, defender: Node, damage: float) -> void:
	_spawn_damage_number(defender, damage)


func _process(_delta: float) -> void:
	if _player_combatant:
		var p_hp: float = _player_combatant.health
		var p_max: float = _player_combatant.max_health
		var ratio: float = p_hp / maxf(p_max, 1.0)
		_player_hp_bar.size.x = BAR_WIDTH * ratio
		_player_hp_label.text = "%.0f" % p_hp

	if _target_combatant:
		var e_hp: float = _target_combatant.health
		var e_max: float = _target_combatant.max_health
		var ratio: float = e_hp / maxf(e_max, 1.0)
		_enemy_hp_bar.size.x = BAR_WIDTH * ratio
		_enemy_hp_label.text = "%.0f" % e_hp


func _update_slot_colors() -> void:
	for i in range(_attack_slots.size()):
		var type_id: String = _attack_type_order[i]
		var is_active: bool = type_id == _selected_type
		var style: StyleBoxFlat = _attack_slots[i].get_theme_stylebox("panel").duplicate()
		if is_active:
			style.border_color = ACTIVE_COLOR
			style.bg_color = ACTIVE_BG
			_attack_labels[i].add_theme_color_override("font_color", ACTIVE_COLOR)
		else:
			style.border_color = INACTIVE_COLOR
			style.bg_color = INACTIVE_BG
			_attack_labels[i].add_theme_color_override("font_color", INACTIVE_COLOR)
		_attack_slots[i].add_theme_stylebox_override("panel", style)


func _spawn_damage_number(target: Node, damage: float) -> void:
	var label := Label.new()
	label.text = "%.0f" % damage
	label.add_theme_font_size_override("font_size", 22)
	label.add_theme_color_override("font_color", Color(1, 0.3, 0.2))
	label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	label.add_theme_constant_override("shadow_offset_x", 1)
	label.add_theme_constant_override("shadow_offset_y", 1)
	label.z_index = 100
	label.position = Vector2(
		get_viewport().get_visible_rect().size.x / 2.0 + randf_range(-50, 50),
		get_viewport().get_visible_rect().size.y / 3.0 + randf_range(-20, 20),
	)
	add_child(label)
	var tween := create_tween()
	tween.set_parallel(true)
	tween.tween_property(label, "position:y", label.position.y - 60, 0.8)
	tween.tween_property(label, "modulate:a", 0.0, 0.8).set_delay(0.3)
	tween.set_parallel(false)
	tween.tween_callback(label.queue_free)


func add_log_message(msg: String, color: Color = Color(0.8, 0.8, 0.7)) -> void:
	if not _log_container:
		return
	var label := Label.new()
	label.text = msg
	label.add_theme_font_size_override("font_size", 12)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
	label.add_theme_constant_override("shadow_offset_x", 1)
	label.add_theme_constant_override("shadow_offset_y", 1)
	_log_container.add_child(label)
	# Remove oldest if too many
	while _log_container.get_child_count() > LOG_MAX_LINES:
		var oldest: Node = _log_container.get_child(0)
		_log_container.remove_child(oldest)
		oldest.queue_free()
	# Fade out and remove after delay
	var tween := create_tween()
	tween.tween_interval(LOG_FADE_TIME - 1.0)
	tween.tween_property(label, "modulate:a", 0.0, 1.0)
	tween.tween_callback(label.queue_free)
