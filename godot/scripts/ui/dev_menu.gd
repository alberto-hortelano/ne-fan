## Dev menu overlay — lists rooms, shows debug info. Toggle with F12.
extends CanvasLayer

signal room_selected(file_path: String)

var _panel: PanelContainer
var _vbox: VBoxContainer
var _info_label: Label
var _room_list: VBoxContainer
var _visible := false


func _ready() -> void:
	layer = 100
	visible = false

	_panel = PanelContainer.new()
	_panel.anchor_left = 0.0
	_panel.anchor_top = 0.0
	_panel.offset_left = 8
	_panel.offset_top = 8
	_panel.offset_right = 280
	_panel.offset_bottom = 600

	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.08, 0.08, 0.1, 0.92)
	style.corner_radius_top_left = 4
	style.corner_radius_top_right = 4
	style.corner_radius_bottom_left = 4
	style.corner_radius_bottom_right = 4
	style.content_margin_left = 10
	style.content_margin_right = 10
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	_panel.add_theme_stylebox_override("panel", style)
	add_child(_panel)

	_vbox = VBoxContainer.new()
	_panel.add_child(_vbox)

	# Title
	var title := Label.new()
	title.text = "Dev Menu [F12]"
	title.add_theme_color_override("font_color", Color(1.0, 0.8, 0.2))
	title.add_theme_font_size_override("font_size", 16)
	_vbox.add_child(title)

	# Debug info
	_info_label = Label.new()
	_info_label.add_theme_color_override("font_color", Color(0.6, 0.6, 0.6))
	_info_label.add_theme_font_size_override("font_size", 11)
	_vbox.add_child(_info_label)

	# Separator
	_vbox.add_child(HSeparator.new())

	# Room list container
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 400)
	_vbox.add_child(scroll)

	_room_list = VBoxContainer.new()
	scroll.add_child(_room_list)


func set_rooms(room_files: Array[String]) -> void:
	for child in _room_list.get_children():
		child.queue_free()

	var current_cat := ""
	for file_path: String in room_files:
		var fname: String = file_path.get_file().replace(".json", "")

		# Category header
		var cat := "game"
		if "/dev/" in file_path:
			cat = "dev"
		elif "style_" in fname:
			cat = "style"

		if cat != current_cat:
			current_cat = cat
			var header := Label.new()
			header.text = "— %s —" % cat.to_upper()
			header.add_theme_color_override("font_color", Color(0.5, 0.5, 0.4))
			header.add_theme_font_size_override("font_size", 10)
			_room_list.add_child(header)

		var btn := Button.new()
		btn.text = fname
		btn.flat = true
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.add_theme_color_override("font_color", Color(0.8, 0.85, 0.9))
		btn.add_theme_color_override("font_hover_color", Color(1.0, 0.9, 0.3))
		btn.add_theme_font_size_override("font_size", 13)
		btn.pressed.connect(_on_room_pressed.bind(file_path))
		_room_list.add_child(btn)


func _on_room_pressed(file_path: String) -> void:
	room_selected.emit(file_path)
	toggle()


func toggle() -> void:
	_visible = not _visible
	visible = _visible
	if _visible:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	else:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func update_info(fps: float, pos: Vector3, room: String, bridge: bool) -> void:
	_info_label.text = "FPS: %d  Room: %s\nPos: %.1f, %.1f, %.1f\nBridge: %s" % [
		fps, room, pos.x, pos.y, pos.z,
		"connected" if bridge else "local"
	]


func _process(_delta: float) -> void:
	if not _visible:
		return
	var player: Node3D = get_tree().current_scene.get_node_or_null("Player")
	var pos: Vector3 = player.position if player else Vector3.ZERO
	update_info(
		Engine.get_frames_per_second(),
		pos,
		GameStore.state.world.room_id,
		LogicBridge.is_connected_to_bridge()
	)
