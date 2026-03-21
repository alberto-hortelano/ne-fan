## Combat UI overlay: HP bars, attack type selector, floating damage numbers.
class_name CombatHUD
extends CanvasLayer

const ATTACK_TYPE_ORDER := ["quick", "heavy", "medium", "defensive", "precise"]
const ATTACK_TYPE_LABELS := {
	"quick": "1:Ráp",
	"heavy": "2:Fue",
	"medium": "3:Med",
	"defensive": "4:Def",
	"precise": "5:Pre",
}
const HP_BAR_WIDTH := 200.0
const HP_BAR_HEIGHT := 16.0
const ACTIVE_COLOR := Color(1.0, 0.85, 0.3)
const INACTIVE_COLOR := Color(0.5, 0.5, 0.5, 0.7)

var _player_hp_bar: ColorRect
var _player_hp_bg: ColorRect
var _player_hp_label: Label
var _enemy_hp_bar: ColorRect
var _enemy_hp_bg: ColorRect
var _enemy_hp_label: Label
var _enemy_hp_container: Control
var _attack_slots: Array[Label] = []
var _selected_type: String = "quick"

var _player_combatant: Node
var _target_combatant: Node


func _ready() -> void:
	layer = 11

	# --- Player HP (bottom-left) ---
	var player_container := Control.new()
	player_container.anchors_preset = Control.PRESET_BOTTOM_LEFT
	player_container.offset_left = 20
	player_container.offset_top = -50
	add_child(player_container)

	_player_hp_bg = ColorRect.new()
	_player_hp_bg.color = Color(0.2, 0.0, 0.0, 0.6)
	_player_hp_bg.size = Vector2(HP_BAR_WIDTH, HP_BAR_HEIGHT)
	player_container.add_child(_player_hp_bg)

	_player_hp_bar = ColorRect.new()
	_player_hp_bar.color = Color(0.8, 0.15, 0.1)
	_player_hp_bar.size = Vector2(HP_BAR_WIDTH, HP_BAR_HEIGHT)
	player_container.add_child(_player_hp_bar)

	_player_hp_label = Label.new()
	_player_hp_label.position = Vector2(0, -20)
	_player_hp_label.add_theme_font_size_override("font_size", 14)
	_player_hp_label.add_theme_color_override("font_color", Color(0.9, 0.85, 0.7))
	_player_hp_label.text = "HP: 100/100"
	player_container.add_child(_player_hp_label)

	# --- Enemy HP (top-center) ---
	_enemy_hp_container = Control.new()
	_enemy_hp_container.anchors_preset = Control.PRESET_CENTER_TOP
	_enemy_hp_container.offset_left = -HP_BAR_WIDTH / 2.0
	_enemy_hp_container.offset_top = 20
	_enemy_hp_container.visible = false
	add_child(_enemy_hp_container)

	_enemy_hp_bg = ColorRect.new()
	_enemy_hp_bg.color = Color(0.2, 0.0, 0.0, 0.6)
	_enemy_hp_bg.size = Vector2(HP_BAR_WIDTH, HP_BAR_HEIGHT)
	_enemy_hp_container.add_child(_enemy_hp_bg)

	_enemy_hp_bar = ColorRect.new()
	_enemy_hp_bar.color = Color(0.7, 0.1, 0.1)
	_enemy_hp_bar.size = Vector2(HP_BAR_WIDTH, HP_BAR_HEIGHT)
	_enemy_hp_container.add_child(_enemy_hp_bar)

	_enemy_hp_label = Label.new()
	_enemy_hp_label.position = Vector2(0, -20)
	_enemy_hp_label.add_theme_font_size_override("font_size", 14)
	_enemy_hp_label.add_theme_color_override("font_color", Color(0.9, 0.85, 0.7))
	_enemy_hp_label.text = ""
	_enemy_hp_container.add_child(_enemy_hp_label)

	# --- Attack type selector (bottom-center) ---
	var slot_container := HBoxContainer.new()
	slot_container.anchors_preset = Control.PRESET_CENTER_BOTTOM
	slot_container.offset_top = -30
	slot_container.offset_left = -(ATTACK_TYPE_ORDER.size() * 60) / 2.0
	add_child(slot_container)

	for type_id in ATTACK_TYPE_ORDER:
		var slot := Label.new()
		slot.text = ATTACK_TYPE_LABELS.get(type_id, type_id)
		slot.add_theme_font_size_override("font_size", 14)
		slot.custom_minimum_size = Vector2(55, 24)
		slot.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		slot_container.add_child(slot)
		_attack_slots.append(slot)

	_update_slot_colors()


func set_player_combatant(c: Node) -> void:
	_player_combatant = c


func set_target(c: Node) -> void:
	_target_combatant = c
	_enemy_hp_container.visible = (c != null)


func on_attack_type_changed(type_id: String) -> void:
	_selected_type = type_id
	_update_slot_colors()


func on_combat_result(attacker: Node, defender: Node, damage: float) -> void:
	_spawn_damage_number(defender, damage)


func _process(_delta: float) -> void:
	# Update player HP bar
	if _player_combatant:
		var p_hp: float = _player_combatant.health
		var p_max: float = _player_combatant.max_health
		var ratio: float = p_hp / maxf(p_max, 1.0)
		_player_hp_bar.size.x = HP_BAR_WIDTH * ratio
		_player_hp_label.text = "HP: %.0f/%.0f" % [p_hp, p_max]

	# Update enemy HP bar
	if _target_combatant and _enemy_hp_container.visible:
		var e_hp: float = _target_combatant.health
		var e_max: float = _target_combatant.max_health
		if e_hp <= 0.0:
			_enemy_hp_container.visible = false
		else:
			var ratio: float = e_hp / maxf(e_max, 1.0)
			_enemy_hp_bar.size.x = HP_BAR_WIDTH * ratio
			var ename: String = _target_combatant.get_parent().name if _target_combatant.get_parent() else "Enemy"
			_enemy_hp_label.text = "%s: %.0f/%.0f" % [ename, e_hp, e_max]


func _update_slot_colors() -> void:
	for i in range(_attack_slots.size()):
		var type_id: String = ATTACK_TYPE_ORDER[i]
		if type_id == _selected_type:
			_attack_slots[i].add_theme_color_override("font_color", ACTIVE_COLOR)
		else:
			_attack_slots[i].add_theme_color_override("font_color", INACTIVE_COLOR)


func _spawn_damage_number(target: Node, damage: float) -> void:
	var label := Label.new()
	label.text = "%.0f" % damage
	label.add_theme_font_size_override("font_size", 22)
	label.add_theme_color_override("font_color", Color(1, 0.3, 0.2))
	label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	label.add_theme_constant_override("shadow_offset_x", 1)
	label.add_theme_constant_override("shadow_offset_y", 1)
	label.z_index = 100

	# Position at screen center-ish with random offset
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
