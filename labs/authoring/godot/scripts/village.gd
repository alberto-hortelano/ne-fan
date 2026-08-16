class_name Village
extends RefCounted
## Construcción de la Cala de Brumaluz (DESCRIPCION.md) por código.
## Mismas coordenadas que la implementación three.js: +x este, +z sur,
## oeste = mar, y=0 nivel del mar.

const TexRef := preload("res://scripts/tex.gd")

static var rng := RandomNumberGenerator.new()
static var mats: Dictionary = {}
static var chimney_tops: Array[Vector3] = []


static func ground_h(x: float, z: float) -> float:
	var y: float
	if x < 10.0:
		y = -0.8
	elif x < 16.0:
		y = -0.5 + ((x - 10.0) / 6.0) * 2.3
	else:
		y = 1.8
	if x > 28.0:
		y += (x - 28.0) * 0.30
	if z > 15.0:
		y += 1.5
	if z > 23.0:
		y += 2.1
	if z < -17.0:
		y += (-17.0 - z) * 0.22
	y += sin(x * 0.7) * cos(z * 0.9) * 0.05
	return y


# ---------- helpers ----------

static func _stone_mat() -> StandardMaterial3D:
	# triplanar: sin él, la caja de 36 m del espigón estira las celdas en vetas
	var m := _mat(TexRef.noise_tex(12, 0.05, true, Color("#4a463f"), Color("#8a857c")), Color.WHITE, 0.95)
	m.uv1_triplanar = true
	m.uv1_scale = Vector3(0.35, 0.35, 0.35)
	return m

static func _mat(tex: Texture2D, col: Color, rough: float, uv: float = 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	if tex != null:
		m.albedo_texture = tex
	m.albedo_color = col
	m.roughness = rough
	m.uv1_scale = Vector3(uv, uv, uv)
	return m


static func _emissive(col: Color, emis: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.emission_enabled = true
	m.emission = emis
	m.emission_energy_multiplier = energy
	return m


static func _add(root: Node3D, mesh: Mesh, pos: Vector3, mat: Material, rot := Vector3.ZERO, shadow := true) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.rotation = rot
	if mat != null:
		mi.material_override = mat
	if not shadow:
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	return mi


static func _box(root: Node3D, size: Vector3, base_pos: Vector3, mat: Material, rot_y := 0.0) -> MeshInstance3D:
	var bm := BoxMesh.new()
	bm.size = size
	return _add(root, bm, base_pos + Vector3(0, size.y / 2.0, 0), mat, Vector3(0, rot_y, 0))


static func _heightfield(x0: float, x1: float, z0: float, z1: float, nx: int, nz: int,
		hfun: Callable, cfun: Callable) -> ArrayMesh:
	var pos := PackedVector3Array()
	var nrm := PackedVector3Array()
	var col := PackedColorArray()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	for j in nz + 1:
		for i in nx + 1:
			var x: float = lerpf(x0, x1, float(i) / float(nx))
			var z: float = lerpf(z0, z1, float(j) / float(nz))
			var y: float = hfun.call(x, z)
			pos.append(Vector3(x, y, z))
			var e := 0.4
			var hx0: float = hfun.call(x - e, z)
			var hx1: float = hfun.call(x + e, z)
			var hz0: float = hfun.call(x, z - e)
			var hz1: float = hfun.call(x, z + e)
			nrm.append(Vector3(hx0 - hx1, 2.0 * e, hz0 - hz1).normalized())
			col.append(cfun.call(x, z))
			uv.append(Vector2(x, z) * 0.45)
	for j in nz:
		for i in nx:
			var a := j * (nx + 1) + i
			var b := a + 1
			var c := a + nx + 1
			var d := c + 1
			idx.append_array([a, b, c, b, d, c])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = pos
	arrays[Mesh.ARRAY_NORMAL] = nrm
	arrays[Mesh.ARRAY_COLOR] = col
	arrays[Mesh.ARRAY_TEX_UV] = uv
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


# ---------- construcción ----------

static func build(root: Node3D) -> void:
	rng.seed = 20260815
	mats = {
		"whitewash": _mat(TexRef.noise_tex(11, 0.02, false, Color("#b9b0a6"), Color("#ded8d2")), Color.WHITE, 0.88, 2.0),
		"stone": _stone_mat(),
		"tiles": _mat(TexRef.tiles(Color("#7a5648")), Color("#6a5a56"), 0.85, 1.0),
		"planks": _mat(TexRef.planks(Color("#6d5a44"), Color("#463726"), false), Color("#b09a7c"), 0.9, 1.0),
		"planks_v": _mat(TexRef.planks(Color("#5d4c3a"), Color("#3a2d1e"), true), Color("#8a7458"), 0.9, 1.0),
		"dark_wood": _mat(null, Color("#4e3f30"), 0.9),
		"iron": _mat(null, Color("#20242a"), 0.5),
	}
	_terrain(root)
	_water(root)
	_jetty_and_faro(root)
	_dock(root)
	_boats(root)
	_nets(root)
	_houses(root)
	_tavern(root)
	_alley_lamp(root)
	_walls_and_vegetation(root)
	_ermita(root)
	_figures(root)
	_gulls(root)
	_smoke(root)


static func _terrain(root: Node3D) -> void:
	var peb := TexRef.noise_tex(21, 0.16, true, Color("#3f3b30"), Color("#6a614c"))
	var hfun := func(x: float, z: float) -> float: return ground_h(x, z)
	var cfun := func(x: float, z: float) -> Color:
		var c: Color
		if x < 16.5:
			c = Color("#8a7f68")
		elif z > 5.4 and z < 8.6 and x < 42.0:
			c = Color("#5a5e68")
		elif z > 14.5 or x > 30.0:
			c = Color("#4a5438")
		else:
			c = Color("#565a64")
		return c.darkened(rng.randf() * 0.15)
	var mesh := _heightfield(7, 60, -34, 40, 106, 148, hfun, cfun)
	var m := _mat(peb, Color.WHITE, 0.95, 1.0)
	m.vertex_color_use_as_albedo = true
	m.uv1_scale = Vector3(0.5, 0.5, 0.5)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	_add(root, mesh, Vector3.ZERO, m)
	# cabo norte tras el espigón
	var scrub := TexRef.noise_tex(22, 0.09, false, Color("#232a1e"), Color("#42502f"))
	var hfun2 := func(x: float, z: float) -> float:
		var t: float = clampf((-16.0 - z) / 14.0, 0.0, 1.0)
		return -1.2 + t * t * 7.5 + sin(x * 0.35) * 0.5 * t
	var cfun2 := func(_x: float, _z: float) -> Color:
		return Color("#3c4432").darkened(rng.randf() * 0.2)
	var mesh2 := _heightfield(-34, 12, -38, -16, 40, 18, hfun2, cfun2)
	var m2 := _mat(scrub, Color.WHITE, 1.0, 1.0)
	m2.vertex_color_use_as_albedo = true
	m2.cull_mode = BaseMaterial3D.CULL_DISABLED
	_add(root, mesh2, Vector3.ZERO, m2)


static func _water(root: Node3D) -> void:
	var pm := PlaneMesh.new()
	pm.size = Vector2(260, 200)
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/water.gdshader")
	sm.set_shader_parameter("light_pos", PackedVector3Array([
		Vector3(-24, 10.2, -14), Vector3(3, 3.1, -0.6), Vector3(6.5, 3.1, 3.6), Vector3(16.2, 4.3, 3.4),
	]))
	sm.set_shader_parameter("light_col", PackedVector3Array([
		Vector3(1.0, 0.79, 0.48) * 1.5, Vector3(1.0, 0.62, 0.29) * 0.5,
		Vector3(1.0, 0.62, 0.29) * 0.5, Vector3(1.0, 0.67, 0.33) * 0.3,
	]))
	var mi := _add(root, pm, Vector3(-45, 0, 0), sm, Vector3.ZERO, false)
	mi.extra_cull_margin = 16.0


static func _jetty_and_faro(root: Node3D) -> void:
	var stone: StandardMaterial3D = mats["stone"]
	_box(root, Vector3(36, 2.6, 3.2), Vector3(-9, -1.3, -14), stone)
	_box(root, Vector3(36, 0.55, 0.5), Vector3(-9, 1.3, -15.4), stone)
	for bx: float in [-2.0, -11.0, -20.0]:
		var cm := CylinderMesh.new()
		cm.top_radius = 0.13
		cm.bottom_radius = 0.16
		cm.height = 0.4
		_add(root, cm, Vector3(bx, 1.5, -13.6), mats["iron"])
	# faro
	var g := Node3D.new()
	g.position = Vector3(-24, 1.2, -14)
	root.add_child(g)
	var tower := CylinderMesh.new()
	tower.top_radius = 1.05
	tower.bottom_radius = 1.7
	tower.height = 9
	_add(g, tower, Vector3(0, 4.5, 0), _mat(TexRef.lighthouse_bands(), Color.WHITE, 0.8))
	var gal := CylinderMesh.new()
	gal.top_radius = 1.5
	gal.bottom_radius = 1.5
	gal.height = 0.28
	_add(g, gal, Vector3(0, 9.15, 0), _mat(null, Color("#232830"), 0.7))
	var lant := CylinderMesh.new()
	lant.top_radius = 0.85
	lant.bottom_radius = 0.85
	lant.height = 1.25
	_add(g, lant, Vector3(0, 9.9, 0), _emissive(Color("#402c14"), Color("#ffca7a"), 7.0))
	var cap := CylinderMesh.new()
	cap.top_radius = 0.0
	cap.bottom_radius = 1.15
	cap.height = 0.9
	_add(g, cap, Vector3(0, 10.9, 0), _mat(null, Color("#1c2026"), 0.8))
	var lamp := OmniLight3D.new()
	lamp.position = Vector3(0, 9.9, 0)
	lamp.light_color = Color("#ffca7a")
	lamp.light_energy = 10.0
	lamp.omni_range = 80.0
	lamp.shadow_enabled = true
	g.add_child(lamp)
	# casa del farero
	var kh := Node3D.new()
	kh.position = Vector3(-20.4, 1.2, -15.9)
	root.add_child(kh)
	_box(kh, Vector3(3.2, 2.6, 2.6), Vector3.ZERO, mats["stone"])
	var shed := BoxMesh.new()
	shed.size = Vector3(3.5, 0.18, 3.0)
	_add(kh, shed, Vector3(0, 2.75, 0), mats["tiles"], Vector3(0, 0, 0.18))
	_window(kh, Vector3(-1.62, 1.4, 0), -PI / 2.0, true)


static func _dock(root: Node3D) -> void:
	_box(root, Vector3(18.5, 0.28, 3.6), Vector3(7, 0.72, 1.5), mats["planks"])
	var pile := CylinderMesh.new()
	pile.top_radius = 0.14
	pile.bottom_radius = 0.16
	pile.height = 2.6
	var px := -1.5
	while px <= 15.0:
		for pz: float in [-0.15, 3.15]:
			_add(root, pile, Vector3(px, -0.2, pz), mats["dark_wood"])
		px += 3.2
	for l: Array in [[3.0, -0.6], [6.5, 3.6]]:
		_lamp_post(root, Vector3(l[0], 0, l[1]), 1.0, 1.9)
	# cajas de pescado
	for c: Array in [[14.6, 1.0, 0.4, 0.2], [14.6, 1.35, 0.42, -0.12], [15.5, 1.0, 0.9, 0.4]]:
		_box(root, Vector3(0.8, 0.35, 0.55), Vector3(c[0], c[1], c[2]), mats["planks"], c[3])
	# nasas
	var nasa := CylinderMesh.new()
	nasa.top_radius = 0.28
	nasa.bottom_radius = 0.36
	nasa.height = 0.5
	var net_mat := _mat(TexRef.net(), Color("#7a6a48"), 0.9)
	for i in 6:
		var nx := 15.4 + float(i % 3) * 0.8
		var nz := 4.6 + float(i / 3) * 0.8
		var ny := ground_h(nx, nz) + 0.28 + (0.55 if i == 5 else 0.0)
		_add(root, nasa, Vector3(nx, ny, nz), net_mat)


## Farolillo: poste + caja emisiva + caperuza + omni con sombra.
static func _lamp_post(root: Node3D, base: Vector3, ground_y: float, post_h: float) -> void:
	var post := CylinderMesh.new()
	post.top_radius = 0.06
	post.bottom_radius = 0.08
	post.height = post_h
	_add(root, post, Vector3(base.x, ground_y + post_h / 2.0 + 0.05, base.z), mats["dark_wood"])
	var lamp := BoxMesh.new()
	lamp.size = Vector3(0.2, 0.26, 0.2)
	_add(root, lamp, Vector3(base.x, ground_y + post_h + 0.25, base.z), _emissive(Color("#2a2016"), Color("#ffca7a"), 4.0))
	var cap := CylinderMesh.new()
	cap.top_radius = 0.0
	cap.bottom_radius = 0.19
	cap.height = 0.14
	_add(root, cap, Vector3(base.x, ground_y + post_h + 0.45, base.z), _mat(null, Color("#1c1812"), 0.8))
	var ol := OmniLight3D.new()
	ol.position = Vector3(base.x, ground_y + post_h + 0.2, base.z)
	ol.light_color = Color("#ff9e4a")
	ol.light_energy = 2.4
	ol.omni_range = 14.0
	ol.shadow_enabled = true
	root.add_child(ol)


static func _boat(root: Node3D, x: float, z: float, y: float, rot_y: float, rot_z: float, col: Color) -> void:
	var g := Node3D.new()
	g.position = Vector3(x, y, z)
	g.rotation = Vector3(0, rot_y, rot_z)
	root.add_child(g)
	var hull := SphereMesh.new()
	hull.radius = 1.0
	hull.height = 1.0
	hull.is_hemisphere = true
	var hull_mi := _add(g, hull, Vector3.ZERO, _mat(null, col, 0.75), Vector3(PI, 0, 0))
	hull_mi.scale = Vector3(2.3, 1.05, 0.85)
	var rim := TorusMesh.new()
	rim.inner_radius = 0.93
	rim.outer_radius = 1.07
	var rim_mi := _add(g, rim, Vector3.ZERO, _mat(null, Color("#5a4834"), 0.9))
	rim_mi.scale = Vector3(2.3, 0.6, 0.85)
	# tapa oscura SOBRE el disco plano del hemisferio (que sale pálido)
	var cap := CylinderMesh.new()
	cap.top_radius = 0.985
	cap.bottom_radius = 0.985
	cap.height = 0.03
	var cap_mi := _add(g, cap, Vector3(0, 0.012, 0), _mat(null, Color("#241d14"), 1.0))
	cap_mi.scale = Vector3(2.3, 1, 0.85)
	var bench := BoxMesh.new()
	bench.size = Vector3(0.5, 0.06, 1.35)
	_add(g, bench, Vector3(0, 0.02, 0), mats["planks"])


static func _boats(root: Node3D) -> void:
	_boat(root, 3.5, 5.6, 0.32, 0.35, 0.0, Color("#3a6ba0"))
	_boat(root, 1.2, -2.6, 0.32, -0.2, 0.0, Color("#4c6a44"))
	_boat(root, 14.2, 13.0, 1.15, 2.3, 0.42, Color("#7a4634"))


static func _nets(root: Node3D) -> void:
	var post := CylinderMesh.new()
	post.top_radius = 0.06
	post.bottom_radius = 0.08
	post.height = 2.2
	for nz: float in [-4.5, -8.0]:
		_add(root, post, Vector3(13.2, ground_h(13.2, nz) + 1.1, nz), mats["dark_wood"])
	var qm := QuadMesh.new()
	qm.size = Vector2(3.5, 1.6)
	var nm := _mat(TexRef.net(), Color("#3a332c"), 0.9)
	nm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	nm.cull_mode = BaseMaterial3D.CULL_DISABLED
	nm.uv1_scale = Vector3(2, 1, 1)
	_add(root, qm, Vector3(13.2, ground_h(13.2, -6.2) + 1.35, -6.25), nm, Vector3(0, PI / 2.0, 0))
	var cork := SphereMesh.new()
	cork.radius = 0.06
	cork.height = 0.12
	for i in 6:
		_add(root, cork, Vector3(13.2, ground_h(13.2, -6.2) + 2.1, -4.7 - float(i) * 0.6), _mat(null, Color("#b09468"), 0.9))


static func _window(parent: Node3D, pos: Vector3, rot_y: float, lit: bool) -> void:
	var frame := QuadMesh.new()
	frame.size = Vector2(0.69, 0.94)
	_add(parent, frame, pos + Vector3(cos(rot_y + PI / 2.0), 0, -sin(rot_y + PI / 2.0)) * -0.012, _mat(null, Color("#3a3228"), 0.9), Vector3(0, rot_y, 0), false)
	var win := QuadMesh.new()
	win.size = Vector2(0.55, 0.8)
	var m := _emissive(Color("#301f10"), Color("#ffb15e"), 2.2) if lit else _mat(null, Color("#131720"), 0.4)
	_add(parent, win, pos, m, Vector3(0, rot_y, 0), false)


static func _house(root: Node3D, x: float, z: float, w_front: float, depth: float, floors: int,
		stone: bool, ridge_along_z: bool, lit: Array, chimney: bool) -> void:
	var g := Node3D.new()
	root.add_child(g)
	var y0 := ground_h(x, z) - 0.15
	var h_wall := float(floors) * 2.55
	var wall: StandardMaterial3D = mats["stone"] if stone else mats["whitewash"]
	_box(g, Vector3(depth, h_wall, w_front), Vector3(x, y0, z), wall)
	var rh := 1.4 + rng.randf() * 0.7
	var roof := PrismMesh.new()
	roof.left_to_right = 0.5
	if ridge_along_z:
		roof.size = Vector3(depth + 0.7, rh, w_front + 0.5)
		_add(g, roof, Vector3(x, y0 + h_wall + rh / 2.0, z), mats["tiles"])
	else:
		roof.size = Vector3(w_front + 0.5, rh, depth + 0.7)
		_add(g, roof, Vector3(x, y0 + h_wall + rh / 2.0, z), mats["tiles"], Vector3(0, PI / 2.0, 0))
	var west_x := x - depth / 2.0 - 0.02
	var wi := 0
	for f in floors:
		for k: float in [-1.0, 1.0]:
			_window(g, Vector3(west_x, y0 + 1.5 + float(f) * 2.5, z + k * w_front * 0.24), -PI / 2.0, wi in lit)
			wi += 1
	if chimney:
		_box(g, Vector3(0.55, 1.5, 0.55), Vector3(x + depth * 0.2, y0 + h_wall + rh - 0.4, z - w_front * 0.25), mats["stone"])
		chimney_tops.append(Vector3(x + depth * 0.2, y0 + h_wall + rh + 1.15, z - w_front * 0.25))


static func _houses(root: Node3D) -> void:
	chimney_tops.clear()
	_house(root, 19, 2.8, 6, 5, 1, false, true, [0, 1], false)      # taberna
	_house(root, 20, -3.8, 4.5, 5, 2, true, true, [2], true)
	_house(root, 19.5, -9.2, 5, 4.5, 2, false, true, [1], false)
	_house(root, 21, 11, 5, 5, 1, false, true, [0], false)
	_house(root, 27, 13.5, 4.5, 4, 1, true, true, [], false)
	_house(root, 26.5, 0.5, 5.5, 5, 2, false, false, [3], true)
	_house(root, 27.5, -7, 5, 4.5, 1, true, true, [], false)
	# luces prácticas de dos ventanas clave
	for wpos: Array in [[16.4, 3.3, -3.8], [17.2, 2.9, -9.2]]:
		var ol := OmniLight3D.new()
		ol.position = Vector3(wpos[0], wpos[1], wpos[2])
		ol.light_color = Color("#ffb15e")
		ol.light_energy = 1.0
		ol.omni_range = 9.0
		ol.shadow_enabled = true
		root.add_child(ol)


static func _tavern(root: Node3D) -> void:
	var y0 := ground_h(19, 2.8) - 0.15
	var post := CylinderMesh.new()
	post.top_radius = 0.09
	post.bottom_radius = 0.1
	post.height = 2.3
	for pz: float in [0.6, 5.0]:
		_add(root, post, Vector3(14.9, y0 + 1.15, pz), mats["planks_v"])
	var roof := BoxMesh.new()
	roof.size = Vector3(2.4, 0.12, 5.4)
	_add(root, roof, Vector3(15.6, y0 + 2.5, 2.8), mats["tiles"], Vector3(0, 0, 0.22))
	# puerta abierta con luz derramada
	var door := QuadMesh.new()
	door.size = Vector2(0.95, 1.9)
	_add(root, door, Vector3(16.44, y0 + 1.05, 2.6), _emissive(Color("#100a06"), Color("#ffb868"), 2.6), Vector3(0, -PI / 2.0, 0), false)
	var spot := SpotLight3D.new()
	spot.position = Vector3(16.2, y0 + 1.7, 2.6)
	spot.light_color = Color("#ffb868")
	spot.light_energy = 6.0
	spot.spot_range = 9.0
	spot.spot_angle = 55.0
	spot.shadow_enabled = true
	root.add_child(spot)
	spot.look_at_from_position(spot.position, Vector3(13.8, y0, 2.6))
	# farol sobre la puerta
	var lamp := BoxMesh.new()
	lamp.size = Vector3(0.2, 0.26, 0.2)
	_add(root, lamp, Vector3(16.2, y0 + 2.6, 3.4), _emissive(Color("#2a2016"), Color("#ffca7a"), 4.0))
	var ol := OmniLight3D.new()
	ol.position = Vector3(16.2, y0 + 2.6, 3.4)
	ol.light_color = Color("#ffab55")
	ol.light_energy = 1.8
	ol.omni_range = 12.0
	ol.shadow_enabled = true
	root.add_child(ol)
	# barril y cartel
	var barrel := CylinderMesh.new()
	barrel.top_radius = 0.4
	barrel.bottom_radius = 0.4
	barrel.height = 0.85
	_add(root, barrel, Vector3(15.6, y0 + 0.43, 4.6), mats["planks_v"])
	var sign := QuadMesh.new()
	sign.size = Vector2(0.9, 0.65)
	var sm := _mat(TexRef.sign_fish(), Color.WHITE, 0.85)
	sm.cull_mode = BaseMaterial3D.CULL_DISABLED
	_add(root, sign, Vector3(15.8, y0 + 2.15, 0.9), sm, Vector3(0, -PI / 2.0 + 0.15, 0))
	_figure(root, Vector3(15.5, y0, 2.65), PI / 2.0, false, Color("#1d222c"))


static func _alley_lamp(root: Node3D) -> void:
	var x := 27.5
	var z := 8.2
	var y0 := ground_h(x, z)
	var post := CylinderMesh.new()
	post.top_radius = 0.07
	post.bottom_radius = 0.1
	post.height = 3.2
	_add(root, post, Vector3(x, y0 + 1.6, z), mats["iron"])
	var lamp := BoxMesh.new()
	lamp.size = Vector3(0.2, 0.26, 0.2)
	_add(root, lamp, Vector3(x, y0 + 3.25, z), _emissive(Color("#2a2016"), Color("#ffca7a"), 4.0))
	var cap := CylinderMesh.new()
	cap.top_radius = 0.0
	cap.bottom_radius = 0.19
	cap.height = 0.14
	_add(root, cap, Vector3(x, y0 + 3.45, z), _mat(null, Color("#1c1812"), 0.8))
	var ol := OmniLight3D.new()
	ol.position = Vector3(x, y0 + 3.1, z)
	ol.light_color = Color("#ffab55")
	ol.light_energy = 2.2
	ol.omni_range = 14.0
	ol.shadow_enabled = true
	root.add_child(ol)


static func _walls_and_vegetation(root: Node3D) -> void:
	for wall: Array in [[15.0, 1.7], [23.0, 2.3]]:
		var sx := 16.0
		while sx < 56.0:
			var yb := ground_h(sx + 4.0, wall[0] - 0.6)
			_box(root, Vector3(8.2, wall[1], 0.7), Vector3(sx + 4.0, yb - 0.3, wall[0]), mats["stone"])
			sx += 8.0
	# higuera
	var fig_y := ground_h(24, 18)
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.22
	trunk.bottom_radius = 0.34
	trunk.height = 2.0
	_add(root, trunk, Vector3(24, fig_y + 1.0, 18), _mat(null, Color("#4c4034"), 1.0), Vector3(0, 0, 0.3))
	var leaf_mat := _mat(null, Color("#2e3d26"), 1.0)
	for blob: Array in [[-1.1, 2.4, 0.0, 2.6], [0.6, 2.9, 0.7, 2.2], [0.1, 2.6, -0.9, 2.0]]:
		var s := SphereMesh.new()
		s.radius = 1.0
		s.height = 2.0
		var mi := _add(root, s, Vector3(24 + blob[0], fig_y + blob[1], 18 + blob[2]), leaf_mat)
		mi.scale = Vector3(blob[3], blob[3] * 0.55, blob[3] * 0.8)
	# cipreses
	var cyp_mat := _mat(null, Color("#1e2a1c"), 1.0)
	for c: Array in [[32.0, 26.5, 5.5], [35.5, 28.0, 6.5], [38.5, 26.0, 5.0]]:
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = 0.75
		cone.height = c[2]
		_add(root, cone, Vector3(c[0], ground_h(c[0], c[1]) + c[2] / 2.0, c[1]), cyp_mat)


static func _ermita(root: Node3D) -> void:
	var g := Node3D.new()
	g.position = Vector3(37, ground_h(37, 30) - 0.1, 30)
	g.rotation.y = 0.2
	root.add_child(g)
	_box(g, Vector3(3.4, 2.6, 4.6), Vector3.ZERO, mats["whitewash"])
	var roof := PrismMesh.new()
	roof.left_to_right = 0.5
	roof.size = Vector3(3.9, 1.2, 5.1)
	_add(g, roof, Vector3(0, 3.2, 0), mats["tiles"])
	_box(g, Vector3(1.5, 1.7, 0.35), Vector3(0, 3.5, -2.2), mats["whitewash"])
	var hole := QuadMesh.new()
	hole.size = Vector2(0.55, 0.8)
	var hm := _mat(null, Color("#20283f"), 0.8)
	hm.cull_mode = BaseMaterial3D.CULL_DISABLED
	_add(g, hole, Vector3(0, 4.35, -2.01), hm)
	var bell := CylinderMesh.new()
	bell.top_radius = 0.0
	bell.bottom_radius = 0.16
	bell.height = 0.3
	_add(g, bell, Vector3(0, 4.4, -2.2), _mat(null, Color("#5c5030"), 0.4))
	var top := PrismMesh.new()
	top.left_to_right = 0.5
	top.size = Vector3(0.5, 0.5, 1.7)
	_add(g, top, Vector3(0, 5.6, -2.2), mats["whitewash"])


static func _figure(root: Node3D, pos: Vector3, rot_y: float, sitting: bool, col: Color) -> void:
	var g := Node3D.new()
	g.position = pos
	g.rotation.y = rot_y
	root.add_child(g)
	var m := _mat(null, col, 0.95)
	var torso := CapsuleMesh.new()
	torso.radius = 0.17
	torso.height = (0.42 if sitting else 0.55) + 0.34
	_add(g, torso, Vector3(0, 0.62 if sitting else 0.95, 0), m)
	var head := SphereMesh.new()
	head.radius = 0.115
	head.height = 0.23
	_add(g, head, Vector3(0, 1.05 if sitting else 1.46, 0), m)
	var leg := CapsuleMesh.new()
	leg.radius = 0.07
	leg.height = (0.5 if sitting else 0.62) + 0.14
	for s: float in [-1.0, 1.0]:
		if sitting:
			_add(g, leg, Vector3(0.18, 0.15, s * 0.11), m, Vector3(0, 0, -0.25))
		else:
			_add(g, leg, Vector3(0, 0.36, s * 0.09), m)


static func _figures(root: Node3D) -> void:
	# pescador sentado al borde del muelle, con caña y sedal
	_figure(root, Vector3(-1.4, 0.86, 1.0), -PI / 2.0, true, Color("#262c38"))
	var rod := CylinderMesh.new()
	rod.top_radius = 0.015
	rod.bottom_radius = 0.03
	rod.height = 2.4
	_add(root, rod, Vector3(-2.6, 1.76, 1.0), _mat(null, Color("#3a2f22"), 0.9), Vector3(0, 0, 1.0))
	var line := CylinderMesh.new()
	line.top_radius = 0.008
	line.bottom_radius = 0.008
	line.height = 2.4
	_add(root, line, Vector3(-3.83, 1.1, 1.0), _mat(null, Color("#0c0c10"), 0.9))


static func _gulls(root: Node3D) -> void:
	var gm := _mat(null, Color("#8f8d88"), 0.95)
	for s: Array in [[-6.0, 1.85, -15.3], [-14.0, 1.85, -15.3], [3.0, 1.05, 2.9], [14.5, 2.15, 13.5]]:
		var g := Node3D.new()
		g.position = Vector3(s[0], s[1], s[2])
		g.rotation.y = rng.randf() * TAU
		root.add_child(g)
		var body := SphereMesh.new()
		body.radius = 0.12
		body.height = 0.24
		var mi := _add(g, body, Vector3.ZERO, gm)
		mi.scale = Vector3(1.5, 0.9, 0.8)
		var head := SphereMesh.new()
		head.radius = 0.07
		head.height = 0.14
		_add(g, head, Vector3(0.16, 0.12, 0), gm)


static func _smoke(root: Node3D) -> void:
	if chimney_tops.is_empty():
		return
	var top := chimney_tops[chimney_tops.size() - 1]
	var tex := TexRef.soft_blob(Color(0.60, 0.63, 0.72, 0.55))
	for i in 7:
		var qm := QuadMesh.new()
		var sc := 0.8 + float(i) * 0.55
		qm.size = Vector2(sc, sc)
		var m := StandardMaterial3D.new()
		m.albedo_texture = tex
		m.albedo_color = Color(1, 1, 1, 0.22 - float(i) * 0.024)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		var pos := top + Vector3(float(i) * 0.55 + rng.randf() * 0.3, float(i) * 0.75, (rng.randf() - 0.5) * 0.4)
		_add(root, qm, pos, m, Vector3.ZERO, false)
