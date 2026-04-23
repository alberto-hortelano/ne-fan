## Read-only browser of the active NarrativeState. Tecla H abre/cierra.
## Panel izquierdo: árbol cronológico con escenas, spawns, diálogos.
## Panel derecho: detalle del nodo seleccionado.
extends CanvasLayer

const META_KEY := &"hb_node_data"

var _root_panel: PanelContainer
var _tree: Tree
var _detail_label: RichTextLabel
var _open := false


func _ready() -> void:
	layer = 50
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_ui()
	_root_panel.visible = false


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_H:
			toggle()
			get_viewport().set_input_as_handled()


func toggle() -> void:
	_open = not _open
	_root_panel.visible = _open
	if _open:
		_refresh()
		# Free the mouse so the user can interact with the tree
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	else:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _build_ui() -> void:
	_root_panel = PanelContainer.new()
	_root_panel.set_anchors_preset(Control.PRESET_CENTER)
	_root_panel.custom_minimum_size = Vector2(900, 600)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.04, 0.03, 0.06, 0.96)
	style.border_color = Color(0.5, 0.4, 0.2)
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(12)
	_root_panel.add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	_root_panel.add_child(vbox)

	# Header
	var header := Label.new()
	header.text = "📜  HISTORIA DE LA PARTIDA  (H para cerrar)"
	header.add_theme_font_size_override("font_size", 18)
	header.add_theme_color_override("font_color", Color(0.9, 0.75, 0.4))
	vbox.add_child(header)

	# Split: tree on the left, detail on the right
	var split := HSplitContainer.new()
	split.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.split_offset = 380
	vbox.add_child(split)

	_tree = Tree.new()
	_tree.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tree.hide_root = true
	_tree.item_selected.connect(_on_tree_item_selected)
	split.add_child(_tree)

	_detail_label = RichTextLabel.new()
	_detail_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_detail_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_detail_label.bbcode_enabled = true
	_detail_label.text = "[i]Selecciona un evento del árbol para ver el detalle.[/i]"
	_detail_label.add_theme_font_size_override("normal_font_size", 14)
	split.add_child(_detail_label)

	add_child(_root_panel)


func _refresh() -> void:
	_tree.clear()
	var root := _tree.create_item()
	# Session header
	var sess := _tree.create_item(root)
	sess.set_text(0, "🎮 Session: %s" % NarrativeState.session_id)
	sess.set_metadata(0, {
		"kind": "session",
		"data": {
			"session_id": NarrativeState.session_id,
			"game_id": NarrativeState.game_id,
			"created_at": NarrativeState.created_at,
			"updated_at": NarrativeState.updated_at,
			"story_so_far": NarrativeState.story_so_far,
		},
	})

	# Group events by scene
	var scene_items: Dictionary = {}  # scene_id -> TreeItem
	for scene_id in NarrativeState.scenes_loaded.keys():
		var sd: Dictionary = NarrativeState.scenes_loaded[scene_id]
		var item := _tree.create_item(sess)
		item.set_text(0, "🌍 Scene: %s" % scene_id)
		item.set_metadata(0, {
			"kind": "scene",
			"scene_id": scene_id,
			"data": sd,
		})
		scene_items[scene_id] = item

	# Entities under each scene
	for e in NarrativeState.entities:
		var ed: Dictionary = e
		var sid: String = ed.get("scene_id", "")
		var parent: TreeItem = scene_items.get(sid, sess)
		var item := _tree.create_item(parent)
		var kind: String = ed.get("type", "?")
		var icon: String = "🧝"
		if kind == "building":
			icon = "🏠"
		elif kind == "object":
			icon = "📦"
		elif kind == "enemy":
			icon = "💀"
		var reason: String = ed.get("spawn_reason", "")
		item.set_text(0, "%s %s (%s) [%s]" % [icon, ed.get("id", ""), kind, reason])
		item.set_metadata(0, {"kind": "entity", "data": ed})

	# Dialogues under each scene (or under session if no scene)
	for d in NarrativeState.dialogue_history:
		var dd: Dictionary = d
		var sid: String = dd.get("scene_id", "")
		var parent: TreeItem = scene_items.get(sid, sess)
		var item := _tree.create_item(parent)
		var speaker: String = dd.get("speaker", "?")
		var idx: int = int(dd.get("chosen_index", -1))
		var free: String = dd.get("free_text", "")
		var label: String = "💬 %s" % speaker
		if free != "":
			label += " (texto libre)"
		elif idx >= 0:
			label += " (opción %d)" % (idx + 1)
		item.set_text(0, label)
		item.set_metadata(0, {"kind": "dialogue", "data": dd})

		# Show consequences as children
		for c in dd.get("narrative_consequences", []):
			var citem := _tree.create_item(item)
			var ctype: String = c.get("type", "?")
			var ctext: String = ""
			if ctype == "story_update":
				ctext = "✏️ %s" % String(c.get("delta", ""))
			elif ctype == "spawn_entity":
				ctext = "✨ Spawn %s: %s" % [c.get("entity_kind", "?"), c.get("description", "")]
			elif ctype == "schedule_event":
				ctext = "⏰ %s [%s]" % [c.get("description", ""), c.get("trigger", "")]
			else:
				ctext = "%s" % ctype
			citem.set_text(0, ctext.substr(0, 80))
			citem.set_metadata(0, {"kind": "consequence", "data": c, "event_id": dd.get("id", "")})


func _on_tree_item_selected() -> void:
	var item := _tree.get_selected()
	if not item:
		return
	var meta = item.get_metadata(0)
	if not meta is Dictionary:
		return
	var md: Dictionary = meta
	var kind: String = md.get("kind", "")
	var data: Dictionary = md.get("data", {})
	match kind:
		"session":
			_show_session_detail(data)
		"scene":
			_show_scene_detail(md.get("scene_id", ""), data)
		"entity":
			_show_entity_detail(data)
		"dialogue":
			_show_dialogue_detail(data)
		"consequence":
			_show_consequence_detail(data, md.get("event_id", ""))


func _show_session_detail(d: Dictionary) -> void:
	var s := "[b]Sesión narrativa[/b]\n\n"
	s += "ID: %s\n" % d.get("session_id", "")
	s += "Juego: %s\n" % d.get("game_id", "")
	s += "Iniciada: %s\n" % d.get("created_at", "")
	s += "Última actualización: %s\n\n" % d.get("updated_at", "")
	s += "[b]Story so far[/b]\n"
	var story: String = d.get("story_so_far", "")
	s += story if story != "" else "[i]Aún sin historia.[/i]"
	_detail_label.text = s


func _show_scene_detail(scene_id: String, d: Dictionary) -> void:
	var s := "[b]Escena: %s[/b]\n\n" % scene_id
	s += "Cargada: %s\n" % d.get("loaded_at", "")
	var sd: Dictionary = d.get("scene_data", {})
	s += "Descripción: %s\n\n" % sd.get("room_description", "")
	var refs: Array = d.get("asset_refs", [])
	if refs.size() > 0:
		s += "Assets usados: %d\n" % refs.size()
	_detail_label.text = s


func _show_entity_detail(d: Dictionary) -> void:
	var s := "[b]Entidad: %s[/b]\n\n" % d.get("id", "?")
	s += "Tipo: %s\n" % d.get("type", "?")
	s += "Escena: %s\n" % d.get("scene_id", "?")
	s += "Posición: %s\n" % d.get("position", [])
	s += "Spawneada en: %s\n" % d.get("spawned_at", "")
	s += "Razón: [color=#aacc88]%s[/color]\n" % d.get("spawn_reason", "")
	var spawn_event: String = d.get("spawn_event_id", "")
	if spawn_event != "":
		s += "Causa: diálogo %s\n\n" % spawn_event
	var inner: Dictionary = d.get("data", {})
	var desc: String = inner.get("description", "")
	if desc != "":
		s += "[b]Descripción[/b]\n%s\n" % desc
	_detail_label.text = s


func _show_dialogue_detail(d: Dictionary) -> void:
	var s := "[b]Diálogo: %s[/b]\n\n" % d.get("speaker", "?")
	s += "[color=#888]%s[/color]\n\n" % d.get("timestamp", "")
	s += "%s\n\n" % d.get("text", "")
	var choices: Array = d.get("choices", [])
	var chosen: int = int(d.get("chosen_index", -1))
	for i in range(choices.size()):
		var ctext: String = ""
		var c = choices[i]
		ctext = String(c.get("text", "")) if c is Dictionary else String(c)
		if i == chosen:
			s += "  [color=#88dd88]► [%d] %s[/color]\n" % [i + 1, ctext]
		else:
			s += "  [color=#666]   [%d] %s[/color]\n" % [i + 1, ctext]
	var free: String = d.get("free_text", "")
	if free != "":
		s += "\n[b]Respuesta libre del jugador[/b]\n[color=#ffcc66]\"%s\"[/color]\n" % free
	var consequences: Array = d.get("narrative_consequences", [])
	if consequences.size() > 0:
		s += "\n[b]Consecuencias narrativas[/b] (%d)\n" % consequences.size()
		for c in consequences:
			s += "  • %s\n" % c.get("type", "?")
	_detail_label.text = s


func _show_consequence_detail(d: Dictionary, event_id: String) -> void:
	var s := "[b]Consecuencia narrativa[/b]\n\n"
	s += "Tipo: %s\n" % d.get("type", "?")
	s += "Causada por evento: %s\n\n" % event_id
	for k in d.keys():
		if k == "type":
			continue
		s += "[color=#888]%s:[/color] %s\n" % [k, d[k]]
	_detail_label.text = s
