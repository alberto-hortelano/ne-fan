## HUD: room info, interaction prompts, text panel, fade overlay, crosshair.
extends CanvasLayer

var _room_label: Label
var _prompt_label: Label
var _text_panel: PanelContainer
var _text_label: Label
var _fade_rect: ColorRect
var _crosshair: ColorRect

var _room_tween: Tween
var _text_visible := false


func _ready() -> void:
	layer = 10

	# Crosshair (center dot)
	_crosshair = ColorRect.new()
	_crosshair.color = Color(1, 1, 1, 0.6)
	_crosshair.custom_minimum_size = Vector2(4, 4)
	_crosshair.anchors_preset = Control.PRESET_CENTER
	_crosshair.position = Vector2(-2, -2)
	add_child(_crosshair)

	# Room label (top-left)
	_room_label = Label.new()
	_room_label.anchors_preset = Control.PRESET_TOP_LEFT
	_room_label.offset_left = 20
	_room_label.offset_top = 20
	_room_label.add_theme_font_size_override("font_size", 22)
	_room_label.add_theme_color_override("font_color", Color(0.9, 0.85, 0.7))
	_room_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_room_label.add_theme_constant_override("shadow_offset_x", 2)
	_room_label.add_theme_constant_override("shadow_offset_y", 2)
	_room_label.modulate.a = 0
	add_child(_room_label)

	# Interaction prompt (bottom-center)
	_prompt_label = Label.new()
	_prompt_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	_prompt_label.offset_top = -60
	_prompt_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_prompt_label.add_theme_font_size_override("font_size", 18)
	_prompt_label.add_theme_color_override("font_color", Color(1, 0.95, 0.8))
	_prompt_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
	_prompt_label.add_theme_constant_override("shadow_offset_x", 1)
	_prompt_label.add_theme_constant_override("shadow_offset_y", 1)
	_prompt_label.visible = false
	add_child(_prompt_label)

	# Text panel (center, for descriptions/dialogue)
	_text_panel = PanelContainer.new()
	_text_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_text_panel.custom_minimum_size = Vector2(500, 100)
	_text_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_text_panel.grow_vertical = Control.GROW_DIRECTION_BOTH

	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.05, 0.03, 0.02, 0.85)
	style.border_color = Color(0.6, 0.5, 0.3, 0.6)
	style.border_width_left = 2
	style.border_width_right = 2
	style.border_width_top = 2
	style.border_width_bottom = 2
	style.corner_radius_top_left = 4
	style.corner_radius_top_right = 4
	style.corner_radius_bottom_left = 4
	style.corner_radius_bottom_right = 4
	style.content_margin_left = 16
	style.content_margin_right = 16
	style.content_margin_top = 12
	style.content_margin_bottom = 12
	_text_panel.add_theme_stylebox_override("panel", style)

	var margin := MarginContainer.new()
	_text_panel.add_child(margin)

	_text_label = Label.new()
	_text_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_text_label.add_theme_font_size_override("font_size", 16)
	_text_label.add_theme_color_override("font_color", Color(0.9, 0.85, 0.75))
	margin.add_child(_text_label)

	_text_panel.visible = false
	add_child(_text_panel)

	# Fade overlay (full screen black)
	_fade_rect = ColorRect.new()
	_fade_rect.color = Color(0, 0, 0, 0)
	_fade_rect.anchors_preset = Control.PRESET_FULL_RECT
	_fade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_fade_rect)


func show_room_info(room_id: String, description: String) -> void:
	_room_label.text = "%s\n%s" % [room_id.replace("_", " ").capitalize(), description]
	_room_label.modulate.a = 1.0

	if _room_tween:
		_room_tween.kill()
	_room_tween = create_tween()
	_room_tween.tween_interval(5.0)
	_room_tween.tween_property(_room_label, "modulate:a", 0.0, 2.0)


func show_prompt(text: String) -> void:
	_prompt_label.text = text
	_prompt_label.visible = true


func hide_prompt() -> void:
	_prompt_label.visible = false


func show_text_panel(text: String) -> void:
	_text_label.text = text
	_text_panel.visible = true
	_text_visible = true


func hide_text_panel() -> void:
	_text_panel.visible = false
	_text_visible = false


func is_text_panel_visible() -> bool:
	return _text_visible


func show_brief_message(text: String, duration: float = 2.0) -> void:
	show_text_panel(text)
	await get_tree().create_timer(duration).timeout
	hide_text_panel()


func fade_out(duration: float = 0.4) -> void:
	var tween := create_tween()
	tween.tween_property(_fade_rect, "color:a", 1.0, duration)
	await tween.finished


func fade_in(duration: float = 0.4) -> void:
	var tween := create_tween()
	tween.tween_property(_fade_rect, "color:a", 0.0, duration)
	await tween.finished
