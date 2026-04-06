## Title screen — game selector shown on startup.
## Emits game_selected(game_id, scene_path) when the player picks a game.
extends CanvasLayer

signal game_selected(game_id: String, scene_path: String)

## Each entry: { id, title, scene_path, description }
var _games: Array[Dictionary] = [
	{
		"id": "tavern_intro",
		"title": "The Calling",
		"scene_path": "res://test_rooms/millhaven.json",
		"description": "Eres un sirviente en la taberna La Rueda Rota. Unos extraños llegan buscandote.",
	},
]

var _panel: PanelContainer
var _selected_index := 0
var _buttons: Array[Button] = []


func _ready() -> void:
	layer = 20
	process_mode = Node.PROCESS_MODE_ALWAYS

	# Full-screen dark background
	var bg := ColorRect.new()
	bg.color = Color(0.03, 0.02, 0.05, 1.0)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	# Center container
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 30)
	center.add_child(vbox)

	# Title
	var title := Label.new()
	title.text = "NEVER ENDING FANTASY"
	title.add_theme_font_size_override("font_size", 48)
	title.add_theme_color_override("font_color", Color(0.85, 0.65, 0.3))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	# Subtitle
	var subtitle := Label.new()
	subtitle.text = "Elige tu aventura"
	subtitle.add_theme_font_size_override("font_size", 20)
	subtitle.add_theme_color_override("font_color", Color(0.6, 0.6, 0.6))
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(subtitle)

	# Spacer
	var spacer := Control.new()
	spacer.custom_minimum_size.y = 20
	vbox.add_child(spacer)

	# Game buttons
	for game in _games:
		var btn := Button.new()
		btn.text = "  %s  " % game.title
		btn.add_theme_font_size_override("font_size", 28)
		btn.custom_minimum_size = Vector2(400, 70)
		btn.focus_mode = Control.FOCUS_ALL

		# Style
		var style := StyleBoxFlat.new()
		style.bg_color = Color(0.12, 0.08, 0.18)
		style.border_color = Color(0.5, 0.35, 0.15)
		style.set_border_width_all(2)
		style.set_corner_radius_all(6)
		style.set_content_margin_all(12)
		btn.add_theme_stylebox_override("normal", style)

		var hover_style := style.duplicate()
		hover_style.bg_color = Color(0.2, 0.12, 0.25)
		hover_style.border_color = Color(0.85, 0.65, 0.3)
		btn.add_theme_stylebox_override("hover", hover_style)
		btn.add_theme_stylebox_override("focus", hover_style)

		var pressed_style := style.duplicate()
		pressed_style.bg_color = Color(0.3, 0.15, 0.1)
		btn.add_theme_stylebox_override("pressed", pressed_style)

		var game_id: String = game.id
		var scene_path: String = game.scene_path
		btn.pressed.connect(func(): _on_game_pressed(game_id, scene_path))
		vbox.add_child(btn)
		_buttons.append(btn)

		# Description under button
		var desc := Label.new()
		desc.text = game.description
		desc.add_theme_font_size_override("font_size", 14)
		desc.add_theme_color_override("font_color", Color(0.5, 0.5, 0.5))
		desc.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		desc.custom_minimum_size.x = 500
		vbox.add_child(desc)

	# Focus first button
	if _buttons.size() > 0:
		_buttons[0].call_deferred("grab_focus")

	# Show mouse cursor
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _on_game_pressed(game_id: String, scene_path: String) -> void:
	game_selected.emit(game_id, scene_path)
	# Hide and free
	queue_free()
