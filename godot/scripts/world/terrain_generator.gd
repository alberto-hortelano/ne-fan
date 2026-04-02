## Generates terrain mesh chunks using FastNoiseLite heightmap displacement.
class_name TerrainGenerator
extends RefCounted

var _noise: FastNoiseLite
var _height_scale: float = 2.0
var _subdivisions: int = 16


func setup(noise_seed: int, frequency: float, octaves: int, height_scale: float) -> void:
	_noise = FastNoiseLite.new()
	_noise.seed = noise_seed
	_noise.frequency = frequency
	_noise.fractal_octaves = octaves
	_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	_height_scale = height_scale


func generate_chunk_mesh(chunk_coord: Vector2i, chunk_size: float) -> ArrayMesh:
	"""Build a subdivided plane with Y displaced by noise. Returns ArrayMesh."""
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)

	var subs: int = _subdivisions
	var step: float = chunk_size / float(subs)
	# World offset for this chunk
	var wx: float = float(chunk_coord.x) * chunk_size
	var wz: float = float(chunk_coord.y) * chunk_size

	# Generate vertices grid
	var verts: Array[Vector3] = []
	var uvs: Array[Vector2] = []
	for iz in subs + 1:
		for ix in subs + 1:
			var lx: float = float(ix) * step - chunk_size / 2.0
			var lz: float = float(iz) * step - chunk_size / 2.0
			var world_x: float = wx + lx
			var world_z: float = wz + lz
			var h: float = _noise.get_noise_2d(world_x, world_z) * _height_scale
			verts.append(Vector3(lx, h, lz))
			uvs.append(Vector2(float(ix) / float(subs), float(iz) / float(subs)))

	# Build triangles
	var row: int = subs + 1
	for iz in subs:
		for ix in subs:
			var i00: int = iz * row + ix
			var i10: int = iz * row + ix + 1
			var i01: int = (iz + 1) * row + ix
			var i11: int = (iz + 1) * row + ix + 1

			# Triangle 1
			st.set_uv(uvs[i00])
			st.add_vertex(verts[i00])
			st.set_uv(uvs[i10])
			st.add_vertex(verts[i10])
			st.set_uv(uvs[i11])
			st.add_vertex(verts[i11])

			# Triangle 2
			st.set_uv(uvs[i00])
			st.add_vertex(verts[i00])
			st.set_uv(uvs[i11])
			st.add_vertex(verts[i11])
			st.set_uv(uvs[i01])
			st.add_vertex(verts[i01])

	st.generate_normals()
	return st.commit()


func generate_collision(chunk_coord: Vector2i, chunk_size: float) -> HeightMapShape3D:
	"""Generate HeightMapShape3D for physics collision."""
	var res: int = _subdivisions + 1
	var step: float = chunk_size / float(_subdivisions)
	var wx: float = float(chunk_coord.x) * chunk_size
	var wz: float = float(chunk_coord.y) * chunk_size

	var heights := PackedFloat32Array()
	heights.resize(res * res)

	for iz in res:
		for ix in res:
			var world_x: float = wx + float(ix) * step - chunk_size / 2.0
			var world_z: float = wz + float(iz) * step - chunk_size / 2.0
			heights[iz * res + ix] = _noise.get_noise_2d(world_x, world_z) * _height_scale

	var shape := HeightMapShape3D.new()
	shape.map_width = res
	shape.map_depth = res
	shape.map_data = heights
	return shape


func get_height_at(world_x: float, world_z: float) -> float:
	"""Sample terrain height at a world position."""
	if _noise == null:
		return 0.0
	return _noise.get_noise_2d(world_x, world_z) * _height_scale
