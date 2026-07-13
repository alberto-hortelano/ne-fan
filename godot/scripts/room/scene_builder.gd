## Construye la world scene normalizada — el contrato de render único que
## emite el bridge (formatDToWorld en nefan-core): suelo plano dimensionado,
## objects/npcs con posiciones en METROS, lighting{} opcional (fixtures) con
## default de sol direccional. La conversión celdas→metros vive en nefan-core;
## NUNCA se porta a GDScript (regla core-first).
class_name SceneBuilder
extends RefCounted

const ObjectSpawnerScript = preload("res://scripts/room/object_spawner.gd")
const LightPlacerScript = preload("res://scripts/room/light_placer.gd")

const GROUND_COLOR = Color(0.25, 0.35, 0.15)

var object_spawner = ObjectSpawnerScript.new()
var light_placer = LightPlacerScript.new()


func build_scene(data: Dictionary) -> Node3D:
	var room := Node3D.new()
	room.name = data.get("scene_id", data.get("room_id", "Scene"))

	if data.has("size") and data.has("entities") and not data.has("objects"):
		push_error(
			"scene_builder: escena Format D sin normalizar (size+entities sin objects). "
			+ "El bridge (o dump-scene) debe convertirla con formatDToWorld — Godot no proyecta celdas."
		)
		return room

	_build_ground(room, data)
	object_spawner.spawn_objects(data.get("objects", []), room)
	object_spawner.spawn_npcs(data.get("npcs", []), room)
	light_placer.place_lights(data.get("lighting", {}), room)
	return room


## Posición inicial del player: __player_start de la escena; si no, centro del
## world_rect (los tiles traen coordenadas GLOBALES del plano continuo);
## fallback el origen (comportamiento histórico de las fixtures de test).
static func spawn_position(data: Dictionary) -> Vector3:
	var ps: Variant = data.get("__player_start")
	if ps is Dictionary and ps.has("x") and ps.has("z"):
		return Vector3(float(ps.get("x")), 1.0, float(ps.get("z")))
	var wr: Variant = data.get("world_rect")
	if wr is Dictionary:
		var cx: float = (float(wr.get("minX", 0.0)) + float(wr.get("maxX", 0.0))) / 2.0
		var cz: float = (float(wr.get("minZ", 0.0)) + float(wr.get("maxZ", 0.0))) / 2.0
		return Vector3(cx, 1.0, cz)
	return Vector3(0, 1, 0)


func _build_ground(room: Node3D, data: Dictionary) -> void:
	var dims: Dictionary = data.get("dimensions", {"width": 50.0, "depth": 50.0})
	var w: float = float(dims.get("width", 50.0))
	var d: float = float(dims.get("depth", 50.0))
	var terrain_v: Variant = data.get("terrain")
	var terrain: Dictionary = terrain_v if terrain_v is Dictionary else {}

	# Los tiles del plano continuo traen posiciones GLOBALES: el suelo se
	# centra en el world_rect de la escena, no en el origen.
	var center := Vector3.ZERO
	var wr: Variant = data.get("world_rect")
	if wr is Dictionary:
		center = Vector3(
			(float(wr.get("minX", -w / 2.0)) + float(wr.get("maxX", w / 2.0))) / 2.0,
			0.0,
			(float(wr.get("minZ", -d / 2.0)) + float(wr.get("maxZ", d / 2.0))) / 2.0,
		)

	var body := StaticBody3D.new()
	body.name = "Ground"
	body.position = center
	room.add_child(body)

	var mesh_inst := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(w, d)
	mesh_inst.mesh = plane

	var mat := StandardMaterial3D.new()
	var color_arr: Array = terrain.get("color", [GROUND_COLOR.r, GROUND_COLOR.g, GROUND_COLOR.b])
	mat.albedo_color = Color(float(color_arr[0]), float(color_arr[1]), float(color_arr[2]))
	mesh_inst.material_override = mat
	body.add_child(mesh_inst)

	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(w, 0.1, d)
	collision.shape = shape
	collision.position.y = -0.05
	body.add_child(collision)

	# Metas para el pipeline de texturas IA (fixtures con texture_prompt).
	var ground_prompt: String = terrain.get("texture_prompt", "")
	if not ground_prompt.is_empty():
		body.set_meta("texture_prompt", ground_prompt)
	body.set_meta("tiling", terrain.get("tiling", [4, 4]))
