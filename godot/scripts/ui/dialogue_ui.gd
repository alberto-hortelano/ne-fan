## Dialogue UI: bottom-screen panel with speaker name, typewriter text, and choices.
## Blocks player movement while active. E/Space to advance, 1-3 to pick choice.
class_name DialogueUI
extends CanvasLayer

signal dialogue_advanced
signal dialogue_choice_made(choice_index: int)

var _panel: PanelContainer
var _vbox: VBoxContainer
var _speaker_label: Label
var _text_label: Label
var _choices_container: VBoxContainer
var _objective_label: Label

var _active := false
var _choices: Array = []
var _full_text := ""
var _char_index := 0
var _char_timer := 0.0
const CHAR_SPEED := 40.0  # characters per second


func _ready() -> void:
	layer = 11

	# Dialogue panel (bottom of screen)
	_panel = PanelContainer.new()
	_panel.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_panel.offset_top = -180
	_panel.offset_left = 100
	_panel.offset_right = -100
	_panel.offset_bottom = -20

	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.02, 0.01, 0.01, 0.9)
	style.corner_radius_top_left = 8
	style.corner_radius_top_right = 8
	style.corner_radius_bottom_left = 8
	style.corner_radius_bottom_right = 8
	style.content_margin_left = 20
	style.content_margin_right = 20
	style.content_margin_top = 12
	style.content_margin_bottom = 12
	_panel.add_theme_stylebox_override("panel", style)

	_vbox = VBoxContainer.new()
	_vbox.add_theme_constant_override("separation", 6)
	_panel.add_child(_vbox)

	# Speaker name
	_speaker_label = Label.new()
	_speaker_label.add_theme_font_size_override("font_size", 20)
	_speaker_label.add_theme_color_override("font_color", Color(0.95, 0.8, 0.3))
	_vbox.add_child(_speaker_label)

	# Dialogue text
	_text_label = Label.new()
	_text_label.add_theme_font_size_override("font_size", 16)
	_text_label.add_theme_color_override("font_color", Color(0.9, 0.88, 0.82))
	_text_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_vbox.add_child(_text_label)

	# Choices container
	_choices_container = VBoxContainer.new()
	_choices_container.add_theme_constant_override("separation", 4)
	_vbox.add_child(_choices_container)

	_panel.visible = false
	add_child(_panel)

	# Objective label (top-right)
	_objective_label = Label.new()
	_objective_label.anchors_preset = Control.PRESET_TOP_RIGHT
	_objective_label.offset_right = -20
	_objective_label.offset_top = 60
	_objective_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_objective_label.add_theme_font_size_override("font_size", 16)
	_objective_label.add_theme_color_override("font_color", Color(0.7, 0.85, 1.0, 0.9))
	_objective_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_objective_label.add_theme_constant_override("shadow_offset_x", 1)
	_objective_label.add_theme_constant_override("shadow_offset_y", 1)
	_objective_label.visible = false
	add_child(_objective_label)


func _process(delta: float) -> void:
	if not _active:
		return

	# Typewriter effect
	if _char_index < _full_text.length():
		_char_timer += delta * CHAR_SPEED
		while _char_timer >= 1.0 and _char_index < _full_text.length():
			_char_index += 1
			_char_timer -= 1.0
		_text_label.text = _full_text.substr(0, _char_index)


func _unhandled_input(event: InputEvent) -> void:
	if not _active:
		return

	if event is InputEventKey and event.pressed and not event.echo:
		var key := event as InputEventKey

		# If text is still typing, skip to end
		if _char_index < _full_text.length():
			if key.keycode == KEY_E or key.keycode == KEY_SPACE or key.keycode == KEY_ENTER:
				_char_index = _full_text.length()
				_text_label.text = _full_text
				get_viewport().set_input_as_handled()
				return

		# If choices are showing, pick one
		if _choices.size() > 0:
			var choice_idx := -1
			if key.keycode == KEY_1:
				choice_idx = 0
			elif key.keycode == KEY_2:
				choice_idx = 1
			elif key.keycode == KEY_3:
				choice_idx = 2
			if choice_idx >= 0 and choice_idx < _choices.size():
				_hide_dialogue()
				dialogue_choice_made.emit(choice_idx)
				get_viewport().set_input_as_handled()
				return

		# Advance dialogue (no choices)
		if _choices.size() == 0:
			if key.keycode == KEY_E or key.keycode == KEY_SPACE or key.keycode == KEY_ENTER:
				_hide_dialogue()
				dialogue_advanced.emit()
				get_viewport().set_input_as_handled()


func show_dialogue(speaker: String, text: String, choices: Array = []) -> void:
	_speaker_label.text = speaker
	_full_text = text
	_char_index = 0
	_char_timer = 0.0
	_text_label.text = ""
	_choices = choices
	_active = true
	_panel.visible = true

	# Clear old choice labels
	for child in _choices_container.get_children():
		child.queue_free()

	# Add choice labels
	if choices.size() > 0:
		for i in range(choices.size()):
			var choice_label := Label.new()
			choice_label.text = "[%d] %s" % [i + 1, choices[i]]
			choice_label.add_theme_font_size_override("font_size", 15)
			choice_label.add_theme_color_override("font_color", Color(0.6, 0.9, 0.6))
			_choices_container.add_child(choice_label)

	# Keep mouse captured — dialogue uses keyboard only (E/Space/1-3)


func show_objective(text: String) -> void:
	_objective_label.text = text
	_objective_label.visible = text != ""


func _hide_dialogue() -> void:
	_active = false
	_panel.visible = false


func hide_all() -> void:
	"""Hide both dialogue panel and objective label. Called on room/game transitions."""
	_hide_dialogue()
	_objective_label.visible = false


func is_active() -> bool:
	return _active
