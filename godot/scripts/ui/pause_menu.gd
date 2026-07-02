## Menú de pausa (overlay CanvasLayer). Sólo construye la UI y emite señales;
## congelar/descongelar player, bridge y room es responsabilidad de main.gd.
extends CanvasLayer

signal resume_requested
signal return_to_title_requested


func _ready() -> void:
	layer = 21
	process_mode = Node.PROCESS_MODE_ALWAYS

	var bg := ColorRect.new()
	bg.color = Color(0, 0, 0, 0.6)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 20)
	center.add_child(vbox)

	var title := Label.new()
	title.text = "PAUSA"
	title.add_theme_font_size_override("font_size", 42)
	title.add_theme_color_override("font_color", Color(0.85, 0.65, 0.3))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	var btn_resume := _make_button("Continuar")
	btn_resume.pressed.connect(func() -> void: resume_requested.emit())
	vbox.add_child(btn_resume)

	var btn_title := _make_button("Volver al titulo")
	btn_title.pressed.connect(func() -> void: return_to_title_requested.emit())
	vbox.add_child(btn_title)

	btn_resume.call_deferred("grab_focus")


func _make_button(text: String) -> Button:
	var btn_style := StyleBoxFlat.new()
	btn_style.bg_color = Color(0.12, 0.08, 0.18)
	btn_style.border_color = Color(0.5, 0.35, 0.15)
	btn_style.set_border_width_all(2)
	btn_style.set_corner_radius_all(6)
	btn_style.set_content_margin_all(12)

	var hover_style: StyleBoxFlat = btn_style.duplicate()
	hover_style.bg_color = Color(0.2, 0.12, 0.25)
	hover_style.border_color = Color(0.85, 0.65, 0.3)

	var btn := Button.new()
	btn.text = text
	btn.add_theme_font_size_override("font_size", 24)
	btn.custom_minimum_size = Vector2(300, 55)
	btn.add_theme_stylebox_override("normal", btn_style)
	btn.add_theme_stylebox_override("hover", hover_style)
	btn.add_theme_stylebox_override("focus", hover_style)
	return btn
