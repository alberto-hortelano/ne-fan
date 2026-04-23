## Title screen — game selector shown on startup.
## Emits game_selected(game_id, scene_path, session_id) when the player picks a
## game. session_id is "" for a new game, or the saved session id when resuming.
extends CanvasLayer

const NarrativeStateScript = preload("res://scripts/autoloads/narrative_state.gd")

signal game_selected(game_id: String, scene_path: String, session_id: String)

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

# Service status UI
var _service_rows: Dictionary = {}  # service_id -> { check: CheckBox, dot: ColorRect, label: Label }
var _refresh_timer: Timer = null


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
		btn.text = "  + %s  " % game.title  # "+" hints at "new game"
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

		# Resume buttons for any existing saves of this game
		_add_resume_buttons(vbox, game_id, scene_path)

	# Focus first button
	if _buttons.size() > 0:
		_buttons[0].call_deferred("grab_focus")

	# Show mouse cursor
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

	# Service status panel — bottom-right corner
	_create_services_panel()


func _create_services_panel() -> void:
	var settings: Node = get_node_or_null("/root/ServiceSettings")
	if not settings:
		return

	var panel := PanelContainer.new()
	panel.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	panel.position = Vector2(-360, -260)
	panel.custom_minimum_size = Vector2(340, 220)

	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.06, 0.04, 0.08, 0.92)
	panel_style.border_color = Color(0.4, 0.28, 0.12)
	panel_style.set_border_width_all(1)
	panel_style.set_corner_radius_all(8)
	panel_style.set_content_margin_all(14)
	panel.add_theme_stylebox_override("panel", panel_style)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	panel.add_child(vbox)

	var header := Label.new()
	header.text = "SERVICIOS"
	header.add_theme_font_size_override("font_size", 14)
	header.add_theme_color_override("font_color", Color(0.85, 0.65, 0.3))
	vbox.add_child(header)

	for s in settings.SERVICES:
		var sid: String = s["id"]
		var row := _create_service_row(sid, s["name"], s["description"])
		vbox.add_child(row)

	add_child(panel)

	# Initial status checks
	settings.check_all()
	settings.status_changed.connect(_on_service_status_changed)

	# Periodic refresh every 5 seconds
	_refresh_timer = Timer.new()
	_refresh_timer.wait_time = 5.0
	_refresh_timer.autostart = true
	_refresh_timer.timeout.connect(func(): settings.check_all())
	add_child(_refresh_timer)


func _create_service_row(service_id: String, name: String, description: String) -> Control:
	var settings: Node = get_node("/root/ServiceSettings")

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.tooltip_text = description

	# Checkbox
	var check := CheckBox.new()
	check.text = ""
	check.button_pressed = settings.is_enabled(service_id)
	check.toggled.connect(func(pressed: bool):
		settings.set_enabled(service_id, pressed)
	)
	row.add_child(check)

	# Status dot (colored circle)
	var dot := ColorRect.new()
	dot.custom_minimum_size = Vector2(10, 10)
	dot.color = Color(0.4, 0.4, 0.4)
	# Center vertically
	var dot_wrap := CenterContainer.new()
	dot_wrap.custom_minimum_size = Vector2(14, 0)
	dot_wrap.add_child(dot)
	row.add_child(dot_wrap)

	# Name label
	var name_lbl := Label.new()
	name_lbl.text = name
	name_lbl.add_theme_font_size_override("font_size", 13)
	name_lbl.add_theme_color_override("font_color", Color(0.85, 0.85, 0.85))
	name_lbl.custom_minimum_size.x = 100
	row.add_child(name_lbl)

	# Status message
	var msg_lbl := Label.new()
	msg_lbl.text = ""
	msg_lbl.add_theme_font_size_override("font_size", 11)
	msg_lbl.add_theme_color_override("font_color", Color(0.55, 0.55, 0.55))
	msg_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	msg_lbl.clip_text = true
	row.add_child(msg_lbl)

	_service_rows[service_id] = {
		"check": check,
		"dot": dot,
		"label": msg_lbl,
	}
	# Apply current status immediately
	_update_row_visuals(service_id)
	return row


func _on_service_status_changed(service_id: String) -> void:
	if not _service_rows.has(service_id):
		return
	_update_row_visuals(service_id)


func _update_row_visuals(service_id: String) -> void:
	var settings: Node = get_node_or_null("/root/ServiceSettings")
	if not settings or not _service_rows.has(service_id):
		return
	var row: Dictionary = _service_rows[service_id]
	var state: String = settings.get_state(service_id)
	var msg: String = settings.get_message(service_id)

	var dot_color: Color
	match state:
		"ready":
			dot_color = Color(0.3, 0.85, 0.3)
		"fallback":
			dot_color = Color(0.95, 0.7, 0.2)
		"down":
			dot_color = Color(0.9, 0.25, 0.25)
		"disabled":
			dot_color = Color(0.35, 0.35, 0.35)
		_:
			dot_color = Color(0.55, 0.55, 0.55)
	row["dot"].color = dot_color
	row["label"].text = msg if msg != "" else state


func _add_resume_buttons(vbox: VBoxContainer, game_id: String, scene_path: String) -> void:
	var saves: Array = NarrativeStateScript.list_saved_sessions()
	for entry in saves:
		if entry.get("game_id", "") != game_id:
			continue
		var session_id: String = entry.get("session_id", "")
		var updated: String = entry.get("updated_at", "")
		var summary: String = entry.get("summary", "")
		var entity_count: int = int(entry.get("entity_count", 0))
		var resume_btn := Button.new()
		var label_text := "  ▶ Continuar  "
		if updated != "":
			label_text += "(%s)" % updated.substr(0, 16).replace("T", " ")
		if entity_count > 0:
			label_text += "  · %d entidades" % entity_count
		resume_btn.text = label_text
		resume_btn.add_theme_font_size_override("font_size", 18)
		resume_btn.custom_minimum_size = Vector2(400, 40)
		resume_btn.focus_mode = Control.FOCUS_ALL
		var rstyle := StyleBoxFlat.new()
		rstyle.bg_color = Color(0.06, 0.10, 0.06)
		rstyle.border_color = Color(0.25, 0.55, 0.25)
		rstyle.set_border_width_all(1)
		rstyle.set_corner_radius_all(4)
		rstyle.set_content_margin_all(8)
		resume_btn.add_theme_stylebox_override("normal", rstyle)
		var rhover := rstyle.duplicate()
		rhover.bg_color = Color(0.10, 0.18, 0.10)
		rhover.border_color = Color(0.4, 0.85, 0.4)
		resume_btn.add_theme_stylebox_override("hover", rhover)
		resume_btn.add_theme_stylebox_override("focus", rhover)
		var captured_session := session_id
		resume_btn.pressed.connect(func(): _on_resume_pressed(game_id, scene_path, captured_session))
		vbox.add_child(resume_btn)
		if summary != "":
			var lbl := Label.new()
			lbl.text = "    " + summary
			lbl.add_theme_font_size_override("font_size", 11)
			lbl.add_theme_color_override("font_color", Color(0.4, 0.55, 0.4))
			lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
			vbox.add_child(lbl)


func _on_game_pressed(game_id: String, scene_path: String) -> void:
	game_selected.emit(game_id, scene_path, "")
	queue_free()


func _on_resume_pressed(game_id: String, scene_path: String, session_id: String) -> void:
	print("TitleScreen: resuming session %s" % session_id)
	game_selected.emit(game_id, scene_path, session_id)
	queue_free()
