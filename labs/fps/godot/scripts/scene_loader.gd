class_name SceneLoader
## Carga los datos del bench (escena.json volcada por dump_escena.mjs, el
## layout.json congelado de un run y sus texturas PNG por celda) y fabrica los
## StandardMaterial3D. Fail-loud: cualquier fichero ausente o JSON inválido
## hace push_error y devuelve vacío — main.gd aborta con quit(1).

const DEFAULT_ROUGHNESS := 0.92


static func read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("SceneLoader: no existe %s" % path)
		return {}
	var text := FileAccess.get_file_as_string(path)
	var data: Variant = JSON.parse_string(text)
	if data == null or not (data is Dictionary):
		push_error("SceneLoader: JSON inválido en %s" % path)
		return {}
	return data


## escena.json de labs/fps/escenas/<name>/ (regenerar con dump_escena.mjs).
static func load_scene(base_dir: String, scene_name: String) -> Dictionary:
	return read_json(base_dir.path_join("escenas").path_join(scene_name).path_join("escena.json"))


## layout.json congelado del run (celdas + assign por índice de prim).
static func load_layout(run_dir: String) -> Dictionary:
	return read_json(run_dir.path_join("layout.json"))


## cellKey → celda del layout.
static func cells_by_key(layout: Dictionary) -> Dictionary:
	var out: Dictionary = {}
	for page in layout.get("pages", []):
		for cell in page.get("cells", []):
			out[cell["key"]] = cell
	return out


## primIndex → {grupo: cellKey|null} del layout congelado.
static func assign_by_prim(layout: Dictionary) -> Dictionary:
	var out: Dictionary = {}
	for entry in layout.get("assign", []):
		out[int(entry["primIndex"])] = entry.get("groups", {})
	return out


## Banco de materiales de un run: celda → StandardMaterial3D con la PNG del
## run como albedo (repeat solo si kind=="tile"). Compartidos entre prims.
class MaterialBank:
	var run_dir := ""
	var cells: Dictionary = {}
	var _tex_cache: Dictionary = {}
	var _mat_cache: Dictionary = {}
	var _clay_cache: Dictionary = {}
	var missing: Array[String] = []

	func _texture(cell_key: String) -> Texture2D:
		if _tex_cache.has(cell_key):
			return _tex_cache[cell_key]
		var path := run_dir.path_join("textures").path_join(cell_key + ".png")
		var tex: Texture2D = null
		if FileAccess.file_exists(path):
			var img := Image.load_from_file(path)
			if img != null:
				img.generate_mipmaps()
				tex = ImageTexture.create_from_image(img)
		if tex == null:
			# Run incompleto (p.ej. C-local sin heroes): degradar a clay, como
			# hace el viewer three.js, avisando una sola vez.
			missing.append(cell_key)
			push_warning("SceneLoader: textura %s ausente en %s — clay" % [cell_key, run_dir])
		_tex_cache[cell_key] = tex
		return tex

	func clay(color_hex: String, roughness: float) -> StandardMaterial3D:
		var key := "%s|%f" % [color_hex, roughness]
		if _clay_cache.has(key):
			return _clay_cache[key]
		var m := StandardMaterial3D.new()
		m.albedo_color = Color.html(color_hex)
		m.roughness = roughness
		m.metallic = 0.0
		_clay_cache[key] = m
		return m

	## Material para (celda, roughness); null si la celda no existe en el run
	## (el caller cae a clay).
	func textured(cell_key: String, roughness: float) -> StandardMaterial3D:
		if not cells.has(cell_key):
			return null
		var mkey := "%s|%f" % [cell_key, roughness]
		if _mat_cache.has(mkey):
			return _mat_cache[mkey]
		var tex := _texture(cell_key)
		if tex == null:
			return null
		var cell: Dictionary = cells[cell_key]
		var m := StandardMaterial3D.new()
		m.albedo_color = Color.WHITE
		m.albedo_texture = tex
		m.roughness = roughness
		m.metallic = 0.0
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		if cell.get("kind", "tile") == "tile":
			m.texture_repeat = true
		else:
			m.texture_repeat = false
		_mat_cache[mkey] = m
		return m


static func make_bank(run_dir: String, layout: Dictionary) -> MaterialBank:
	var bank := MaterialBank.new()
	bank.run_dir = run_dir
	bank.cells = cells_by_key(layout)
	return bank
