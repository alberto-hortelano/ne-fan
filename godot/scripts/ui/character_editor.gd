## Character editor UI — select model and skin before starting the game.
## Shows a 3D preview of the character with idle animation.
extends CanvasLayer

signal appearance_confirmed(model_id: String, skin_path: String)
signal cancelled()

const NpcModelRegistryScript = preload("res://scripts/npc/npc_model_registry.gd")
const CombatAnimatorScript = preload("res://scripts/combat/combat_animator.gd")

var _selected_model_id := "pete"
var _selected_skin_path := ""

# Preview 3D
var _viewport: SubViewport
var _preview_camera: Camera3D
var _preview_animator: Node3D  # CombatAnimator instance
var _preview_root: Node3D

# UI elements
var _model_buttons: Dictionary = {}  # model_id -> Button
var _skin_container: HBoxContainer
var _skin_buttons: Array[Button] = []
var _generate_input: LineEdit
var _generate_btn: Button
var _status_label: Label

# Drag rotation
var _dragging := false
var _preview_yaw := 0.0


func _ready() -> void:
	layer = 20
	process_mode = Node.PROCESS_MODE_ALWAYS

	# Full-screen dark background
	var bg := ColorRect.new()
	bg.color = Color(0.03, 0.02, 0.05, 0.95)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	# Main layout: HBox with preview on left, controls on right
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 40)
	margin.add_theme_constant_override("margin_right", 40)
	margin.add_theme_constant_override("margin_top", 30)
	margin.add_theme_constant_override("margin_bottom", 30)
	add_child(margin)

	var main_hbox := HBoxContainer.new()
	main_hbox.add_theme_constant_override("separation", 30)
	margin.add_child(main_hbox)

	# --- Left side: 3D Preview ---
	var preview_panel := _create_preview_panel()
	preview_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	preview_panel.size_flags_stretch_ratio = 1.2
	main_hbox.add_child(preview_panel)

	# --- Right side: Controls ---
	var controls := _create_controls_panel()
	controls.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main_hbox.add_child(controls)

	# Load initial model
	_load_preview_model(_selected_model_id)
	_refresh_skin_buttons()
	_highlight_model_button(_selected_model_id)

	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _create_preview_panel() -> PanelContainer:
	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.08, 0.06, 0.1)
	style.border_color = Color(0.5, 0.35, 0.15)
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	panel.add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 10)
	panel.add_child(vbox)

	# Title
	var title := Label.new()
	title.text = "VISTA PREVIA"
	title.add_theme_font_size_override("font_size", 18)
	title.add_theme_color_override("font_color", Color(0.85, 0.65, 0.3))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	# SubViewport for 3D preview
	_viewport = SubViewport.new()
	_viewport.size = Vector2i(600, 700)
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_viewport.transparent_bg = true
	_viewport.msaa_3d = Viewport.MSAA_4X

	_preview_root = Node3D.new()
	_preview_root.name = "PreviewRoot"
	_viewport.add_child(_preview_root)

	# Camera
	_preview_camera = Camera3D.new()
	_preview_camera.position = Vector3(0, 1.0, 3.0)
	_preview_camera.look_at(Vector3(0, 0.8, 0))
	_preview_camera.fov = 35
	_viewport.add_child(_preview_camera)

	# Lighting
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-45, 30, 0)
	light.light_energy = 1.5
	light.shadow_enabled = false
	_viewport.add_child(light)

	var fill_light := DirectionalLight3D.new()
	fill_light.rotation_degrees = Vector3(-20, -120, 0)
	fill_light.light_energy = 0.5
	fill_light.shadow_enabled = false
	_viewport.add_child(fill_light)

	# Environment for ambient
	var env := Environment.new()
	env.ambient_light_color = Color(0.3, 0.25, 0.35)
	env.ambient_light_energy = 0.8
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.08, 0.06, 0.1)
	var world_env := WorldEnvironment.new()
	world_env.environment = env
	_viewport.add_child(world_env)

	# SubViewportContainer to display the 3D preview
	var container := SubViewportContainer.new()
	container.size_flags_vertical = Control.SIZE_EXPAND_FILL
	container.stretch = true
	container.add_child(_viewport)
	vbox.add_child(container)

	# Hint
	var hint := Label.new()
	hint.text = "Arrastra para rotar"
	hint.add_theme_font_size_override("font_size", 12)
	hint.add_theme_color_override("font_color", Color(0.4, 0.4, 0.4))
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(hint)

	return panel


func _create_controls_panel() -> VBoxContainer:
	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 20)

	# --- Title ---
	var title := Label.new()
	title.text = "EDITOR DE PERSONAJE"
	title.add_theme_font_size_override("font_size", 32)
	title.add_theme_color_override("font_color", Color(0.85, 0.65, 0.3))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	# --- Model selector ---
	var model_label := Label.new()
	model_label.text = "Modelo"
	model_label.add_theme_font_size_override("font_size", 20)
	model_label.add_theme_color_override("font_color", Color(0.7, 0.7, 0.7))
	vbox.add_child(model_label)

	var model_scroll := ScrollContainer.new()
	model_scroll.custom_minimum_size.y = 60
	model_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	model_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	vbox.add_child(model_scroll)

	var model_hbox := HBoxContainer.new()
	model_hbox.add_theme_constant_override("separation", 8)
	model_scroll.add_child(model_hbox)

	for model_id in NpcModelRegistryScript.get_all_ids():
		var data: Dictionary = NpcModelRegistryScript.get_model_data(model_id)
		var btn := Button.new()
		btn.text = "  %s  " % data.get("display_name", model_id)
		btn.add_theme_font_size_override("font_size", 16)
		btn.custom_minimum_size = Vector2(120, 45)

		var style := _make_button_style(Color(0.12, 0.08, 0.18))
		btn.add_theme_stylebox_override("normal", style)
		btn.add_theme_stylebox_override("hover", _make_button_style(Color(0.2, 0.12, 0.25), Color(0.85, 0.65, 0.3)))
		btn.add_theme_stylebox_override("pressed", _make_button_style(Color(0.3, 0.15, 0.1)))

		var mid: String = model_id
		btn.pressed.connect(func(): _on_model_selected(mid))
		model_hbox.add_child(btn)
		_model_buttons[model_id] = btn

	# --- Skin selector ---
	var skin_label := Label.new()
	skin_label.text = "Apariencia"
	skin_label.add_theme_font_size_override("font_size", 20)
	skin_label.add_theme_color_override("font_color", Color(0.7, 0.7, 0.7))
	vbox.add_child(skin_label)

	var skin_scroll := ScrollContainer.new()
	skin_scroll.custom_minimum_size.y = 60
	skin_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	skin_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	vbox.add_child(skin_scroll)

	_skin_container = HBoxContainer.new()
	_skin_container.add_theme_constant_override("separation", 8)
	skin_scroll.add_child(_skin_container)

	# --- AI Skin Generator ---
	var gen_label := Label.new()
	gen_label.text = "Generar skin con IA"
	gen_label.add_theme_font_size_override("font_size", 20)
	gen_label.add_theme_color_override("font_color", Color(0.7, 0.7, 0.7))
	vbox.add_child(gen_label)

	var gen_hbox := HBoxContainer.new()
	gen_hbox.add_theme_constant_override("separation", 8)
	vbox.add_child(gen_hbox)

	_generate_input = LineEdit.new()
	_generate_input.placeholder_text = "ej: armadura negra con detalles dorados"
	_generate_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_generate_input.add_theme_font_size_override("font_size", 14)
	_generate_input.custom_minimum_size.y = 40
	gen_hbox.add_child(_generate_input)

	_generate_btn = Button.new()
	_generate_btn.text = "  Generar  "
	_generate_btn.add_theme_font_size_override("font_size", 14)
	_generate_btn.custom_minimum_size = Vector2(100, 40)
	var gen_style := _make_button_style(Color(0.15, 0.1, 0.05), Color(0.7, 0.5, 0.2))
	_generate_btn.add_theme_stylebox_override("normal", gen_style)
	_generate_btn.add_theme_stylebox_override("hover", _make_button_style(Color(0.25, 0.15, 0.05), Color(0.85, 0.65, 0.3)))
	_generate_btn.pressed.connect(_on_generate_pressed)
	gen_hbox.add_child(_generate_btn)

	# Status label
	_status_label = Label.new()
	_status_label.text = ""
	_status_label.add_theme_font_size_override("font_size", 13)
	_status_label.add_theme_color_override("font_color", Color(0.5, 0.5, 0.5))
	vbox.add_child(_status_label)

	# Spacer
	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	vbox.add_child(spacer)

	# --- Action buttons ---
	var action_hbox := HBoxContainer.new()
	action_hbox.add_theme_constant_override("separation", 20)
	action_hbox.alignment = BoxContainer.ALIGNMENT_CENTER
	vbox.add_child(action_hbox)

	var cancel_btn := Button.new()
	cancel_btn.text = "  Cancelar  "
	cancel_btn.add_theme_font_size_override("font_size", 22)
	cancel_btn.custom_minimum_size = Vector2(180, 55)
	cancel_btn.add_theme_stylebox_override("normal", _make_button_style(Color(0.1, 0.06, 0.06), Color(0.5, 0.3, 0.3)))
	cancel_btn.add_theme_stylebox_override("hover", _make_button_style(Color(0.2, 0.08, 0.08), Color(0.7, 0.4, 0.4)))
	cancel_btn.pressed.connect(func(): cancelled.emit(); queue_free())
	action_hbox.add_child(cancel_btn)

	var confirm_btn := Button.new()
	confirm_btn.text = "  Confirmar  "
	confirm_btn.add_theme_font_size_override("font_size", 22)
	confirm_btn.custom_minimum_size = Vector2(180, 55)
	confirm_btn.add_theme_stylebox_override("normal", _make_button_style(Color(0.08, 0.12, 0.06), Color(0.4, 0.6, 0.3)))
	confirm_btn.add_theme_stylebox_override("hover", _make_button_style(Color(0.12, 0.2, 0.08), Color(0.5, 0.8, 0.3)))
	confirm_btn.pressed.connect(_on_confirm)
	action_hbox.add_child(confirm_btn)

	return vbox


# --- Preview model management ---


func _load_preview_model(model_id: String) -> void:
	# Remove old preview
	if _preview_animator:
		_preview_animator.queue_free()
		_preview_animator = null

	var data: Dictionary = NpcModelRegistryScript.get_model_data(model_id)
	var model_path: String = data.get("path", "")
	if model_path == "":
		return

	var animator := CombatAnimatorScript.new()
	animator.name = "PreviewAnimator"
	animator.model_path = model_path
	animator.anim_dir = NpcModelRegistryScript.COMBAT_ANIM_DIR
	animator.position.y = data.get("y_offset", -0.05)
	var model_scale: float = data.get("model_scale", 1.0)
	animator.scale = Vector3(model_scale, model_scale, model_scale)
	_preview_root.add_child(animator)
	_preview_root.rotation_degrees.y = _preview_yaw
	_preview_animator = animator

	# Start idle animation after the tree is ready
	animator.call_deferred("travel_locomotion", "idle")
	animator.call_deferred("travel_combat", "idle")

	# Apply skin if one is selected
	if _selected_skin_path != "":
		animator.call_deferred("apply_skin", _selected_skin_path)


func _refresh_skin_buttons() -> void:
	# Clear existing
	for btn in _skin_buttons:
		btn.queue_free()
	_skin_buttons.clear()

	# "Default" button (no skin override)
	var default_btn := Button.new()
	default_btn.text = "  Original  "
	default_btn.add_theme_font_size_override("font_size", 14)
	default_btn.custom_minimum_size = Vector2(100, 40)
	default_btn.add_theme_stylebox_override("normal", _make_button_style(Color(0.12, 0.08, 0.18)))
	default_btn.add_theme_stylebox_override("hover", _make_button_style(Color(0.2, 0.12, 0.25), Color(0.85, 0.65, 0.3)))
	default_btn.pressed.connect(func(): _on_skin_selected(""))
	_skin_container.add_child(default_btn)
	_skin_buttons.append(default_btn)

	# Discovered skins for the selected model
	var skins: Array[String] = NpcModelRegistryScript.get_available_skins(_selected_model_id)
	for skin_path in skins:
		var btn := Button.new()
		var file_name: String = skin_path.get_file().get_basename()
		btn.text = "  %s  " % file_name
		btn.add_theme_font_size_override("font_size", 14)
		btn.custom_minimum_size = Vector2(100, 40)
		btn.add_theme_stylebox_override("normal", _make_button_style(Color(0.12, 0.08, 0.18)))
		btn.add_theme_stylebox_override("hover", _make_button_style(Color(0.2, 0.12, 0.25), Color(0.85, 0.65, 0.3)))
		var sp: String = skin_path
		btn.pressed.connect(func(): _on_skin_selected(sp))
		_skin_container.add_child(btn)
		_skin_buttons.append(btn)

	# Also add user-generated skins from user://skins/
	var user_dir := DirAccess.open("user://skins")
	if user_dir:
		user_dir.list_dir_begin()
		var f: String = user_dir.get_next()
		while f != "":
			if not user_dir.current_is_dir() and f.ends_with(".png"):
				var user_path: String = "user://skins/" + f
				var btn := Button.new()
				btn.text = "  %s  " % f.get_basename()
				btn.add_theme_font_size_override("font_size", 14)
				btn.custom_minimum_size = Vector2(100, 40)
				btn.add_theme_stylebox_override("normal", _make_button_style(Color(0.1, 0.08, 0.15)))
				btn.add_theme_stylebox_override("hover", _make_button_style(Color(0.2, 0.12, 0.25), Color(0.85, 0.65, 0.3)))
				var up: String = user_path
				btn.pressed.connect(func(): _on_skin_selected(up))
				_skin_container.add_child(btn)
				_skin_buttons.append(btn)
			f = user_dir.get_next()
		user_dir.list_dir_end()


func _highlight_model_button(model_id: String) -> void:
	for mid: String in _model_buttons:
		var btn: Button = _model_buttons[mid]
		if mid == model_id:
			btn.add_theme_stylebox_override("normal", _make_button_style(Color(0.2, 0.12, 0.25), Color(0.85, 0.65, 0.3)))
		else:
			btn.add_theme_stylebox_override("normal", _make_button_style(Color(0.12, 0.08, 0.18)))


# --- Callbacks ---


func _on_model_selected(model_id: String) -> void:
	_selected_model_id = model_id
	_selected_skin_path = ""
	_load_preview_model(model_id)
	_refresh_skin_buttons()
	_highlight_model_button(model_id)
	var data: Dictionary = NpcModelRegistryScript.get_model_data(model_id)
	_status_label.text = "Modelo: %s" % data.get("display_name", model_id)


func _on_skin_selected(skin_path: String) -> void:
	_selected_skin_path = skin_path
	if _preview_animator and _preview_animator.has_method("apply_skin"):
		if skin_path != "":
			_preview_animator.apply_skin(skin_path)
		else:
			# Reload model to reset to original textures
			_load_preview_model(_selected_model_id)
	if skin_path == "":
		_status_label.text = "Apariencia: Original"
	else:
		_status_label.text = "Apariencia: %s" % skin_path.get_file().get_basename()


func _on_generate_pressed() -> void:
	var prompt: String = _generate_input.text.strip_edges()
	if prompt == "":
		_status_label.text = "Escribe una descripcion para generar la skin"
		return
	_generate_btn.disabled = true
	_status_label.text = "Generando skin..."
	# Use AIClient autoload if available
	var ai_client: Node = get_node_or_null("/root/AIClient")
	if ai_client and ai_client.has_method("generate_skin"):
		ai_client.generate_skin(prompt, _on_skin_generated)
	else:
		_status_label.text = "AI server no disponible (lanza ./start.sh y elige preset 1 o 6)"
		_generate_btn.disabled = false


func _on_skin_generated(skin_path: String) -> void:
	_generate_btn.disabled = false
	if skin_path == "":
		_status_label.text = "Error al generar skin"
		return
	_status_label.text = "Skin generada: %s" % skin_path.get_file().get_basename()
	_selected_skin_path = skin_path
	if _preview_animator and _preview_animator.has_method("apply_skin"):
		_preview_animator.apply_skin(skin_path)
	# Refresh skin list to include the new one
	_refresh_skin_buttons()


func _on_confirm() -> void:
	appearance_confirmed.emit(_selected_model_id, _selected_skin_path)
	queue_free()


# --- Input: drag to rotate preview ---


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb: InputEventMouseButton = event
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_dragging = mb.pressed
	elif event is InputEventMouseMotion and _dragging:
		var mm: InputEventMouseMotion = event
		_preview_yaw += mm.relative.x * 0.5
		if _preview_root:
			_preview_root.rotation_degrees.y = _preview_yaw


# --- Helpers ---


func _make_button_style(bg: Color, border: Color = Color(0.5, 0.35, 0.15)) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = bg
	style.border_color = border
	style.set_border_width_all(2)
	style.set_corner_radius_all(6)
	style.set_content_margin_all(8)
	return style
