## Manages infinite terrain chunks: loads/unloads based on player position.
## Add as child of a Node3D scene. Call setup() then set_player().
class_name ChunkManager
extends Node3D

const TerrainGeneratorScript = preload("res://scripts/world/terrain_generator.gd")
const VegetationSpawnerScript = preload("res://scripts/room/vegetation_spawner.gd")

const CHUNK_SIZE := 32.0
const LOAD_RADIUS := 2       # Load chunks within ±2 = 5×5 grid
const UNLOAD_RADIUS := 4     # Free chunks beyond this
const UPDATE_INTERVAL := 0.5 # Seconds between chunk checks

var _terrain_gen: RefCounted  # TerrainGenerator
var _veg_spawner: RefCounted  # VegetationSpawner
var _loaded_chunks: Dictionary = {}  # Vector2i -> Node3D
var _player: Node3D = null
var _last_player_chunk := Vector2i(99999, 99999)
var _timer: float = 0.0
var _ground_color := Color(0.25, 0.35, 0.15)

# Config from JSON
var _terrain_config: Dictionary = {}
var _vegetation_config: Dictionary = {}
var _ground_texture_prompt: String = ""
var _ground_tiling: Array = [4, 4]

# Grass LOD: don't render grass beyond this distance
var _grass_visibility_end: float = 50.0


func setup(terrain_data: Dictionary, vegetation_data: Dictionary) -> void:
	_terrain_config = terrain_data
	_vegetation_config = vegetation_data
	_ground_texture_prompt = terrain_data.get("ground_texture_prompt", "")
	_ground_tiling = terrain_data.get("tiling", [4, 4])

	_terrain_gen = TerrainGeneratorScript.new()
	_terrain_gen.setup(
		int(terrain_data.get("noise_seed", 42)),
		float(terrain_data.get("noise_frequency", 0.03)),
		int(terrain_data.get("noise_octaves", 4)),
		float(terrain_data.get("height_scale", 2.0))
	)

	_veg_spawner = VegetationSpawnerScript.new()


func set_player(player: Node3D) -> void:
	_player = player
	# Force immediate chunk generation around player
	_update_chunks()


func _process(delta: float) -> void:
	if _player == null:
		return
	_timer += delta
	if _timer < UPDATE_INTERVAL:
		return
	_timer = 0.0
	_update_chunks()


func _update_chunks() -> void:
	var player_chunk := _world_to_chunk(_player.global_position)

	if player_chunk == _last_player_chunk:
		return
	_last_player_chunk = player_chunk

	# Load missing chunks within radius
	for x in range(-LOAD_RADIUS, LOAD_RADIUS + 1):
		for z in range(-LOAD_RADIUS, LOAD_RADIUS + 1):
			var coord := player_chunk + Vector2i(x, z)
			if not _loaded_chunks.has(coord):
				_load_chunk(coord)

	# Unload distant chunks
	var to_unload: Array[Vector2i] = []
	for coord: Vector2i in _loaded_chunks:
		var dist: int = maxi(absi(coord.x - player_chunk.x), absi(coord.y - player_chunk.y))
		if dist > UNLOAD_RADIUS:
			to_unload.append(coord)

	for coord in to_unload:
		_unload_chunk(coord)


func _load_chunk(coord: Vector2i) -> void:
	var chunk := Node3D.new()
	chunk.name = "Chunk_%d_%d" % [coord.x, coord.y]
	chunk.position = Vector3(float(coord.x) * CHUNK_SIZE, 0, float(coord.y) * CHUNK_SIZE)

	# Terrain mesh
	var terrain_body := StaticBody3D.new()
	terrain_body.name = "Terrain"
	chunk.add_child(terrain_body)

	var mesh: ArrayMesh = _terrain_gen.generate_chunk_mesh(coord, CHUNK_SIZE)
	var mesh_inst := MeshInstance3D.new()
	mesh_inst.mesh = mesh

	var mat := StandardMaterial3D.new()
	mat.albedo_color = _ground_color
	mesh_inst.material_override = mat
	terrain_body.add_child(mesh_inst)

	# Collision
	var col := CollisionShape3D.new()
	var height_shape: HeightMapShape3D = _terrain_gen.generate_collision(coord, CHUNK_SIZE)
	col.shape = height_shape
	# HeightMapShape3D needs scaling to match chunk size
	var res: int = height_shape.map_width
	var scale_xz: float = CHUNK_SIZE / float(res - 1)
	col.scale = Vector3(scale_xz, 1.0, scale_xz)
	terrain_body.add_child(col)

	# Texture metadata
	if _ground_texture_prompt != "":
		terrain_body.set_meta("texture_prompt", _ground_texture_prompt)
		terrain_body.set_meta("tiling", _ground_tiling)

	# Per-chunk vegetation
	_spawn_chunk_vegetation(chunk, coord)

	add_child(chunk)
	_loaded_chunks[coord] = chunk


func _unload_chunk(coord: Vector2i) -> void:
	if _loaded_chunks.has(coord):
		var chunk: Node3D = _loaded_chunks[coord]
		chunk.queue_free()
		_loaded_chunks.erase(coord)


func _spawn_chunk_vegetation(chunk: Node3D, coord: Vector2i) -> void:
	var chunk_ground := Vector2(CHUNK_SIZE, CHUNK_SIZE)

	if _vegetation_config.has("grass"):
		var grass_cfg: Dictionary = _vegetation_config.get("grass").duplicate()
		# Scale density proportionally to chunk size vs original radius
		var original_radius: float = float(grass_cfg.get("radius", 20.0))
		var original_density: int = int(grass_cfg.get("density", 2000))
		var chunk_area: float = CHUNK_SIZE * CHUNK_SIZE
		var original_area: float = PI * original_radius * original_radius
		var density_ratio: float = chunk_area / maxf(original_area, 1.0)
		grass_cfg["density"] = int(float(original_density) * density_ratio)
		grass_cfg["radius"] = CHUNK_SIZE  # Fill entire chunk
		# Unique seed per chunk for variety
		grass_cfg["seed"] = int(grass_cfg.get("seed", 42)) + coord.x * 7919 + coord.y * 6271

		var grass_inst: MultiMeshInstance3D = _veg_spawner.spawn_grass(grass_cfg, chunk_ground, chunk)
		# LOD: hide grass beyond distance
		grass_inst.visibility_range_end = _grass_visibility_end
		grass_inst.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF

	if _vegetation_config.has("bushes"):
		var bush_cfg: Dictionary = _vegetation_config.get("bushes").duplicate()
		var original_radius: float = float(bush_cfg.get("radius", 22.0))
		var original_count: int = int(bush_cfg.get("count", 30))
		var chunk_area: float = CHUNK_SIZE * CHUNK_SIZE
		var original_area: float = PI * original_radius * original_radius
		var density_ratio: float = chunk_area / maxf(original_area, 1.0)
		bush_cfg["count"] = maxi(int(float(original_count) * density_ratio), 3)
		bush_cfg["radius"] = CHUNK_SIZE
		bush_cfg["seed"] = int(bush_cfg.get("seed", 77)) + coord.x * 4967 + coord.y * 8363

		var bush_inst: MultiMeshInstance3D = _veg_spawner.spawn_bushes(bush_cfg, chunk_ground, chunk)
		bush_inst.visibility_range_end = _grass_visibility_end * 1.5
		bush_inst.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF

	if _vegetation_config.has("trees"):
		var tree_cfg: Dictionary = _vegetation_config.get("trees").duplicate()
		# Scatter trees randomly in chunk instead of ring pattern
		var original_count: int = int(tree_cfg.get("count", 40))
		var original_inner: float = float(tree_cfg.get("ring_inner_radius", 18.0))
		var original_outer: float = float(tree_cfg.get("ring_outer_radius", 28.0))
		var ring_area: float = PI * (original_outer * original_outer - original_inner * original_inner)
		var chunk_area: float = CHUNK_SIZE * CHUNK_SIZE
		var density_ratio: float = chunk_area / maxf(ring_area, 1.0)
		var chunk_tree_count: int = maxi(int(float(original_count) * density_ratio * 0.5), 2)
		# Override to scatter mode (no ring)
		tree_cfg["count"] = chunk_tree_count
		tree_cfg["ring_inner_radius"] = 0.0
		tree_cfg["ring_outer_radius"] = CHUNK_SIZE / 2.0
		tree_cfg["seed"] = int(tree_cfg.get("seed", 99)) + coord.x * 3571 + coord.y * 9241

		_veg_spawner.spawn_trees(tree_cfg, chunk)


func _world_to_chunk(world_pos: Vector3) -> Vector2i:
	return Vector2i(
		int(floorf(world_pos.x / CHUNK_SIZE + 0.5)),
		int(floorf(world_pos.z / CHUNK_SIZE + 0.5))
	)
