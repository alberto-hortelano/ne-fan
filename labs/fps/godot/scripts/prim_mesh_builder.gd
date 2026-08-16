class_name PrimMeshBuilder
## Prim declarativa → ArrayMesh con UNA surface por grupo de caras
## (side/top/bottom/caps), réplica de primitiveGeometry() de labs/fps/lib.mjs:
## base en y=0, gable extruido en z y centrado, polygon con points absolutos
## en XZ. Devuelve {"mesh": ArrayMesh, "groups": Array[String]} donde
## groups[i] es el nombre del grupo de la surface i.
##
## UVs horneadas al construir (regla del bench three.js):
##  - celda "tile": u,v en repeticiones = metros_de_cara / DENSITY_M (2.5)
##  - celda "unique" o clay: 0..1 por cara
##  - v crece hacia ABAJO de la cara (convención de imagen de Godot; three
##    llega al mismo resultado visual vía flipY) → textura siempre derecha.
##
## Winding: Godot pinta como frontal el sentido HORARIO visto desde fuera
## (contrario a three) — quad() ya enrolla en horario.

const DENSITY_M := 2.5
const CYL_SEGS := 24

## Acumulador de una surface del ArrayMesh.
class SurfAcc:
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()

	func add_vert(p: Vector3, n: Vector3, uv: Vector2) -> int:
		verts.append(p)
		normals.append(n)
		uvs.append(uv)
		return verts.size() - 1

	## Cuadrilátero p0..p3 con normal exterior n. Winding-agnóstico: la normal
	## geométrica de los puntos decide el orden de emisión para que la cara
	## frontal (horaria en Godot) quede SIEMPRE del lado de n.
	func quad(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, n: Vector3,
			uv0: Vector2, uv1: Vector2, uv2: Vector2, uv3: Vector2) -> void:
		var a := add_vert(p0, n, uv0)
		var b := add_vert(p1, n, uv1)
		var c := add_vert(p2, n, uv2)
		var d := add_vert(p3, n, uv3)
		if (p1 - p0).cross(p2 - p0).dot(n) > 0.0:
			indices.append_array(PackedInt32Array([a, c, b, a, d, c]))
		else:
			indices.append_array(PackedInt32Array([a, b, c, a, c, d]))

	func tri(p0: Vector3, p1: Vector3, p2: Vector3, n: Vector3,
			uv0: Vector2, uv1: Vector2, uv2: Vector2) -> void:
		var a := add_vert(p0, n, uv0)
		var b := add_vert(p1, n, uv1)
		var c := add_vert(p2, n, uv2)
		if (p1 - p0).cross(p2 - p0).dot(n) > 0.0:
			indices.append_array(PackedInt32Array([a, c, b]))
		else:
			indices.append_array(PackedInt32Array([a, b, c]))

	func is_empty() -> bool:
		return indices.is_empty()

	func commit(mesh: ArrayMesh) -> void:
		var arrays: Array = []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = verts
		arrays[Mesh.ARRAY_NORMAL] = normals
		arrays[Mesh.ARRAY_TEX_UV] = uvs
		arrays[Mesh.ARRAY_INDEX] = indices
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)


## tile_by_group[grupo] = true si la celda asignada a ese grupo es tileable
## (UVs en metros/DENSITY_M); false/ausente = 0..1 (unique o clay).
static func build(prim: Dictionary, tile_by_group: Dictionary) -> Dictionary:
	var shape: String = prim.get("shape", "")
	match shape:
		"box":
			return _build_box(prim, tile_by_group)
		"gable":
			return _build_gable(prim, tile_by_group)
		"cylinder":
			return _build_cylinder(prim, tile_by_group)
		"cone":
			return _build_cone(prim, tile_by_group)
		"sphere":
			return _build_sphere(prim, tile_by_group)
		"polygon":
			return _build_polygon(prim, tile_by_group)
	push_error("PrimMeshBuilder: shape desconocida '%s'" % shape)
	return {}


## UV de una cara: (u01,v01) con v01=0 ARRIBA; si tile, escala a metros/2.5.
static func _uv(tile: bool, face_w: float, face_h: float, u01: float, v01: float) -> Vector2:
	if tile:
		return Vector2(u01 * face_w / DENSITY_M, v01 * face_h / DENSITY_M)
	return Vector2(u01, v01)


static func _build_box(prim: Dictionary, tg: Dictionary) -> Dictionary:
	var s: Array = prim["size"]
	var w := float(s[0])
	var h := float(s[1])
	var d := float(s[2])
	var hx := w / 2.0
	var hz := d / 2.0
	var side := SurfAcc.new()
	var top := SurfAcc.new()
	var bottom := SurfAcc.new()
	var ts: bool = tg.get("side", false)
	var tt: bool = tg.get("top", false)
	var tb: bool = tg.get("bottom", false)

	# Caras laterales: u horizontal a lo largo de la cara, v de arriba (0) a
	# abajo. +x mira al este, +z al sur.
	# +x: [d,h]
	side.quad(Vector3(hx, h, -hz), Vector3(hx, h, hz), Vector3(hx, 0, hz), Vector3(hx, 0, -hz),
		Vector3(1, 0, 0),
		_uv(ts, d, h, 0, 0), _uv(ts, d, h, 1, 0), _uv(ts, d, h, 1, 1), _uv(ts, d, h, 0, 1))
	# -x: [d,h]
	side.quad(Vector3(-hx, h, hz), Vector3(-hx, h, -hz), Vector3(-hx, 0, -hz), Vector3(-hx, 0, hz),
		Vector3(-1, 0, 0),
		_uv(ts, d, h, 0, 0), _uv(ts, d, h, 1, 0), _uv(ts, d, h, 1, 1), _uv(ts, d, h, 0, 1))
	# +z: [w,h]
	side.quad(Vector3(-hx, h, hz), Vector3(hx, h, hz), Vector3(hx, 0, hz), Vector3(-hx, 0, hz),
		Vector3(0, 0, 1),
		_uv(ts, w, h, 0, 0), _uv(ts, w, h, 1, 0), _uv(ts, w, h, 1, 1), _uv(ts, w, h, 0, 1))
	# -z: [w,h]
	side.quad(Vector3(hx, h, -hz), Vector3(-hx, h, -hz), Vector3(-hx, 0, -hz), Vector3(hx, 0, -hz),
		Vector3(0, 0, -1),
		_uv(ts, w, h, 0, 0), _uv(ts, w, h, 1, 0), _uv(ts, w, h, 1, 1), _uv(ts, w, h, 0, 1))
	# top (+y): [w,d]
	top.quad(Vector3(-hx, h, -hz), Vector3(hx, h, -hz), Vector3(hx, h, hz), Vector3(-hx, h, hz),
		Vector3(0, 1, 0),
		_uv(tt, w, d, 0, 0), _uv(tt, w, d, 1, 0), _uv(tt, w, d, 1, 1), _uv(tt, w, d, 0, 1))
	# bottom (-y): [w,d]
	bottom.quad(Vector3(-hx, 0, hz), Vector3(hx, 0, hz), Vector3(hx, 0, -hz), Vector3(-hx, 0, -hz),
		Vector3(0, -1, 0),
		_uv(tb, w, d, 0, 0), _uv(tb, w, d, 1, 0), _uv(tb, w, d, 1, 1), _uv(tb, w, d, 0, 1))
	return _commit([[side, "side"], [top, "top"], [bottom, "bottom"]])


static func _build_gable(prim: Dictionary, tg: Dictionary) -> Dictionary:
	var s: Array = prim["size"]
	var w := float(s[0])
	var h := float(s[1])
	var d := float(s[2])
	var hx := w / 2.0
	var hz := d / 2.0
	var caps := SurfAcc.new()
	var side := SurfAcc.new()
	var tc: bool = tg.get("caps", false)
	var ts: bool = tg.get("side", false)

	# Hastiales (caps): triángulo (-w/2,0)(w/2,0)(0,h) en ±z. UVs del extrude
	# de three = coords de shape en metros; unique se normaliza a 0..1 sobre
	# el bbox [w,h] — aquí emitimos directamente esa forma (v invertida).
	var cap_uv := func(x: float, y: float) -> Vector2:
		if tc:
			return Vector2((x + hx) / DENSITY_M, (h - y) / DENSITY_M)
		return Vector2((x + hx) / w, (h - y) / h)
	# cap +z
	caps.tri(Vector3(-hx, 0, hz), Vector3(hx, 0, hz), Vector3(0, h, hz), Vector3(0, 0, 1),
		cap_uv.call(-hx, 0.0), cap_uv.call(hx, 0.0), cap_uv.call(0.0, h))
	# cap -z
	caps.tri(Vector3(hx, 0, -hz), Vector3(-hx, 0, -hz), Vector3(0, h, -hz), Vector3(0, 0, -1),
		cap_uv.call(hx, 0.0), cap_uv.call(-hx, 0.0), cap_uv.call(0.0, h))

	# Laterales del extrude (three genera TODAS las paredes del contorno,
	# base incluida): u = avance por el contorno, v = profundidad (0..d).
	var slope := sqrt(hx * hx + h * h)
	var side_uv := func(u_m: float, v_m: float, u_span: float) -> Vector2:
		if ts:
			return Vector2(u_m / DENSITY_M, v_m / DENSITY_M)
		return Vector2(u_m / u_span, v_m / d)
	# Base (arista (-hx,0)→(hx,0)), normal -y.
	side.quad(Vector3(-hx, 0, -hz), Vector3(hx, 0, -hz), Vector3(hx, 0, hz), Vector3(-hx, 0, hz),
		Vector3(0, -1, 0),
		side_uv.call(0.0, 0.0, w), side_uv.call(w, 0.0, w),
		side_uv.call(w, d, w), side_uv.call(0.0, d, w))
	# Faldón este (arista (hx,0)→(0,h)), normal exterior (h, hx)/|..| en XY.
	var ne := Vector3(h, hx, 0).normalized()
	side.quad(Vector3(hx, 0, hz), Vector3(0, h, hz), Vector3(0, h, -hz), Vector3(hx, 0, -hz),
		ne,
		side_uv.call(0.0, 0.0, slope), side_uv.call(slope, 0.0, slope),
		side_uv.call(slope, d, slope), side_uv.call(0.0, d, slope))
	# Faldón oeste (arista (0,h)→(-hx,0)).
	var nw := Vector3(-h, hx, 0).normalized()
	side.quad(Vector3(0, h, hz), Vector3(-hx, 0, hz), Vector3(-hx, 0, -hz), Vector3(0, h, -hz),
		nw,
		side_uv.call(0.0, 0.0, slope), side_uv.call(slope, 0.0, slope),
		side_uv.call(slope, d, slope), side_uv.call(0.0, d, slope))
	return _commit([[caps, "caps"], [side, "side"]])


static func _build_cylinder(prim: Dictionary, tg: Dictionary) -> Dictionary:
	var s: Array = prim["size"]
	var r := float(s[0])
	var h := float(s[1])
	var r_top := float(s[2]) if s.size() > 2 and s[2] != null else r
	var side := SurfAcc.new()
	var top := SurfAcc.new()
	var bottom := SurfAcc.new()
	var ts: bool = tg.get("side", false)
	var face_w := TAU * r
	# Normal del tronco: inclinada si r_top != r.
	var slope_y := (r - r_top) / h if h > 0.0 else 0.0
	for i in CYL_SEGS:
		var a0 := TAU * float(i) / CYL_SEGS
		var a1 := TAU * float(i + 1) / CYL_SEGS
		var n0 := Vector3(cos(a0), slope_y, sin(a0)).normalized()
		var n1 := Vector3(cos(a1), slope_y, sin(a1)).normalized()
		var b0 := Vector3(cos(a0) * r, 0, sin(a0) * r)
		var b1 := Vector3(cos(a1) * r, 0, sin(a1) * r)
		var t0 := Vector3(cos(a0) * r_top, h, sin(a0) * r_top)
		var t1 := Vector3(cos(a1) * r_top, h, sin(a1) * r_top)
		var u0 := float(i) / CYL_SEGS
		var u1 := float(i + 1) / CYL_SEGS
		var i_t0 := side.add_vert(t0, n0, _uv(ts, face_w, h, u0, 0))
		var i_t1 := side.add_vert(t1, n1, _uv(ts, face_w, h, u1, 0))
		var i_b1 := side.add_vert(b1, n1, _uv(ts, face_w, h, u1, 1))
		var i_b0 := side.add_vert(b0, n0, _uv(ts, face_w, h, u0, 1))
		side.indices.append_array(PackedInt32Array([i_t0, i_b1, i_t1, i_t0, i_b0, i_b1]))
	if r_top > 0.001:
		_cap_fan(top, r_top, h, Vector3(0, 1, 0), tg.get("top", false), 2.0 * r)
	_cap_fan(bottom, r, 0.0, Vector3(0, -1, 0), tg.get("bottom", false), 2.0 * r)
	return _commit([[side, "side"], [top, "top"], [bottom, "bottom"]])


## Tapa circular en y=y_at con normal n (±y). UV: círculo unidad en 0..1
## (three cachea [2r,2r] como tamaño de cara para el tileo).
static func _cap_fan(acc: SurfAcc, radius: float, y_at: float, n: Vector3,
		tile: bool, face_m: float) -> void:
	var center := acc.add_vert(Vector3(0, y_at, 0), n, _uv(tile, face_m, face_m, 0.5, 0.5))
	var ring := PackedInt32Array()
	for i in CYL_SEGS + 1:
		var a := TAU * float(i % CYL_SEGS) / CYL_SEGS
		var u01 := 0.5 + 0.5 * cos(a)
		var v01 := 0.5 + 0.5 * sin(a)
		ring.append(acc.add_vert(
			Vector3(cos(a) * radius, y_at, sin(a) * radius), n,
			_uv(tile, face_m, face_m, u01, v01)))
	for i in CYL_SEGS:
		if n.y > 0:
			acc.indices.append_array(PackedInt32Array([center, ring[i + 1], ring[i]]))
		else:
			acc.indices.append_array(PackedInt32Array([center, ring[i], ring[i + 1]]))


static func _build_cone(prim: Dictionary, tg: Dictionary) -> Dictionary:
	var s: Array = prim["size"]
	var r := float(s[0])
	var h := float(s[1])
	var segs := maxi(3, roundi(float(s[2])) if s.size() > 2 and s[2] != null else 16)
	var side := SurfAcc.new()
	var ts: bool = tg.get("side", false)
	var face_w := TAU * r
	var face_h := sqrt(r * r + h * h)
	var slope_y := r / h if h > 0.0 else 0.0
	for i in segs:
		var a0 := TAU * float(i) / segs
		var a1 := TAU * float(i + 1) / segs
		var am := (a0 + a1) / 2.0
		var n0 := Vector3(cos(a0), slope_y, sin(a0)).normalized()
		var n1 := Vector3(cos(a1), slope_y, sin(a1)).normalized()
		var nm := Vector3(cos(am), slope_y, sin(am)).normalized()
		var u0 := float(i) / segs
		var u1 := float(i + 1) / segs
		side.tri(
			Vector3(0, h, 0),
			Vector3(cos(a1) * r, 0, sin(a1) * r),
			Vector3(cos(a0) * r, 0, sin(a0) * r),
			nm,
			_uv(ts, face_w, face_h, (u0 + u1) / 2.0, 0),
			_uv(ts, face_w, face_h, u1, 1),
			_uv(ts, face_w, face_h, u0, 1))
		# tri() enrolla para normal saliente con orden antihorario: aquí lo
		# damos ya orientado (ápice, b1, b0 visto desde fuera es antihorario).
	# Tapa de base (three la genera; comparte material side).
	_cap_fan(side, r, 0.0, Vector3(0, -1, 0), false, 2.0 * r)
	return _commit([[side, "side"]])


static func _build_sphere(prim: Dictionary, tg: Dictionary) -> Dictionary:
	var s: Array = prim["size"]
	var r := float(s[0])
	var seg := maxi(6, roundi(float(s[1])) if s.size() > 1 and s[1] != null else 16)
	var rings := maxi(4, seg / 2)
	var acc := SurfAcc.new()
	var ts: bool = tg.get("side", false)
	var face_w := TAU * r
	var face_h := PI * r
	var grid: Array = []
	for j in rings + 1:
		var v01 := float(j) / rings
		var phi := PI * v01
		var row := PackedInt32Array()
		for i in seg + 1:
			var u01 := float(i) / seg
			var theta := TAU * u01
			var n := Vector3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta))
			row.append(acc.add_vert(n * r + Vector3(0, r, 0), n, _uv(ts, face_w, face_h, u01, v01)))
		grid.append(row)
	for j in rings:
		for i in seg:
			var a: int = grid[j][i]
			var b: int = grid[j][i + 1]
			var c: int = grid[j + 1][i + 1]
			var d: int = grid[j + 1][i]
			acc.indices.append_array(PackedInt32Array([a, b, c, a, c, d]))
	return _commit([[acc, "side"]])


static func _build_polygon(prim: Dictionary, tg: Dictionary) -> Dictionary:
	var s: Array = prim["size"]
	var t: float = float(s[0]) if s.size() > 0 and s[0] != null else 0.02
	var pts_in: Array = prim.get("points", [])
	if pts_in.size() < 3:
		push_error("PrimMeshBuilder: polygon con %d points" % pts_in.size())
		return {}
	var pts := PackedVector2Array()
	for p in pts_in:
		pts.append(Vector2(float(p[0]), float(p[1])))
	var tris := Geometry2D.triangulate_polygon(pts)
	if tris.is_empty():
		push_error("PrimMeshBuilder: polygon no triangulable (%d points)" % pts.size())
		return {}
	var caps := SurfAcc.new()
	var side := SurfAcc.new()
	var tc: bool = tg.get("caps", false)
	var ts: bool = tg.get("side", false)
	# bbox para normalizar UVs unique (como normalizeGroupUVs de three).
	var mn := pts[0]
	var mx := pts[0]
	for p in pts:
		mn = mn.min(p)
		mx = mx.max(p)
	var span := (mx - mn).max(Vector2(1e-6, 1e-6))
	var cap_uv := func(p: Vector2) -> Vector2:
		if tc:
			return Vector2(p.x / DENSITY_M, p.y / DENSITY_M)
		return (p - mn) / span
	# Tapa superior (y=t, normal +y) y tapa inferior (y=0, normal -y).
	for k in range(0, tris.size(), 3):
		var a := pts[tris[k]]
		var b := pts[tris[k + 1]]
		var c := pts[tris[k + 2]]
		# Godot triangula en el winding del polígono de entrada; orientar por
		# la normal calculada del triángulo proyectado.
		var cw := (b - a).cross(c - a) < 0.0
		var top_a := Vector3(a.x, t, a.y)
		var top_b := Vector3(b.x, t, b.y)
		var top_c := Vector3(c.x, t, c.y)
		if cw:
			caps.tri(top_a, top_b, top_c, Vector3(0, 1, 0), cap_uv.call(a), cap_uv.call(b), cap_uv.call(c))
		else:
			caps.tri(top_a, top_c, top_b, Vector3(0, 1, 0), cap_uv.call(a), cap_uv.call(c), cap_uv.call(b))
		var bot_a := Vector3(a.x, 0, a.y)
		var bot_b := Vector3(b.x, 0, b.y)
		var bot_c := Vector3(c.x, 0, c.y)
		if cw:
			caps.tri(bot_a, bot_c, bot_b, Vector3(0, -1, 0), cap_uv.call(a), cap_uv.call(c), cap_uv.call(b))
		else:
			caps.tri(bot_a, bot_b, bot_c, Vector3(0, -1, 0), cap_uv.call(a), cap_uv.call(b), cap_uv.call(c))
	# Paredes: un quad por arista, u = avance por el contorno, v = grosor.
	var perim := 0.0
	for i in pts.size():
		perim += pts[i].distance_to(pts[(i + 1) % pts.size()])
	var walked := 0.0
	# Winding del contorno (para orientar la normal hacia fuera).
	var area2 := 0.0
	for i in pts.size():
		var p0 := pts[i]
		var p1 := pts[(i + 1) % pts.size()]
		area2 += p0.x * p1.y - p1.x * p0.y
	var ccw_in_xz := area2 < 0.0  # en XZ (y de pantalla invertida) el signo se voltea
	for i in pts.size():
		var p0 := pts[i]
		var p1 := pts[(i + 1) % pts.size()]
		var elen := p0.distance_to(p1)
		if elen < 1e-6:
			continue
		var edge := (p1 - p0) / elen
		var n := Vector3(edge.y, 0, -edge.x) if ccw_in_xz else Vector3(-edge.y, 0, edge.x)
		var wall_uv := func(u_m: float, v01: float) -> Vector2:
			if ts:
				return Vector2(u_m / DENSITY_M, v01 * t / DENSITY_M)
			return Vector2(u_m / perim, v01)
		side.quad(
			Vector3(p0.x, t, p0.y), Vector3(p1.x, t, p1.y),
			Vector3(p1.x, 0, p1.y), Vector3(p0.x, 0, p0.y), n,
			wall_uv.call(walked, 0.0), wall_uv.call(walked + elen, 0.0),
			wall_uv.call(walked + elen, 1.0), wall_uv.call(walked, 1.0))
		walked += elen
	return _commit([[caps, "caps"], [side, "side"]])


static func _commit(pairs: Array) -> Dictionary:
	var mesh := ArrayMesh.new()
	var groups: Array[String] = []
	for pair in pairs:
		var acc: SurfAcc = pair[0]
		if acc.is_empty():
			continue
		acc.commit(mesh)
		groups.append(pair[1])
	return {"mesh": mesh, "groups": groups}
