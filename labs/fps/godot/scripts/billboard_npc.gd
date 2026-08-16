class_name BillboardNpc
extends Node3D
## NPC como billboard cilíndrico 8-dir con los sprites y_bot del bench
## (labs/fps/sprites/<anim>/frontal_8/dir_D_frame_FFF.png, 256 px = 2.4 m).
## Réplica de makeNpc de lib.mjs / updateEntity de fps-gl.ts: quad de 2.4 m
## con los pies al 85 % desde arriba (plano hundido 0.36 m), rotación manual
## hacia la cámara (NO el flag billboard: el yaw decide la dirección del
## frame) e histéresis de ±(22.5°+10°) para no parpadear entre octantes.

const FRAME_WORLD_M := 2.4
const FEET_FROM_BOTTOM := 0.15
const DIR_HYST_RAD := PI / 18.0
const ANIM_FPS := 8.0

var npc_yaw := 0.0
var _mesh: MeshInstance3D
var _mat: StandardMaterial3D
var _frames: Array[Texture2D] = []
var _last_dir := -1
var _frame_idx := 0
var _accum := 0.0
var _sprites_dir := ""
var _anim := "idle"
var _static_pose := false


func setup(npc: Dictionary, sprites_dir: String, static_pose: bool) -> void:
	_sprites_dir = sprites_dir
	_anim = npc.get("anim", "idle")
	_static_pose = static_pose
	npc_yaw = deg_to_rad(float(npc.get("yawDeg", 0.0)))
	var pos: Array = npc.get("pos", [0, 0])
	position = Vector3(pos[0], 0, pos[1])
	var quad := QuadMesh.new()
	quad.size = Vector2(FRAME_WORLD_M, FRAME_WORLD_M)
	quad.center_offset = Vector3(0, FRAME_WORLD_M / 2.0 - FRAME_WORLD_M * FEET_FROM_BOTTOM, 0)
	_mesh = MeshInstance3D.new()
	_mesh.mesh = quad
	_mat = StandardMaterial3D.new()
	_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	_mat.alpha_scissor_threshold = 0.5
	_mat.roughness = 0.95
	_mat.metallic = 0.0
	_mesh.material_override = _mat
	_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(_mesh)


func _dir_count() -> int:
	return 8


func _load_frame(dir: int, frame: int) -> Texture2D:
	var path := _sprites_dir.path_join(_anim).path_join("frontal_8").path_join(
		"dir_%d_frame_%03d.png" % [dir, frame])
	if not FileAccess.file_exists(path):
		push_warning("BillboardNpc: sprite ausente %s" % path)
		return null
	var img := Image.load_from_file(path)
	if img == null:
		return null
	return ImageTexture.create_from_image(img)


func _process(delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var to_cam := cam.global_position - global_position
	var cam_yaw := atan2(to_cam.x, to_cam.z)
	# Billboard cilíndrico: el quad mira a la cámara (solo yaw). El QuadMesh
	# de Godot mira a +z con rotación 0 → rotation.y = yaw hacia la cámara.
	_mesh.rotation = Vector3(0, cam_yaw, 0)

	# Frame direccional con histéresis: rel = yaw_npc − yaw(npc→cám) (el
	# signo inverso espejaba los perfiles E/W; corregido con el juego).
	var rel := wrapf(npc_yaw - cam_yaw, -PI, PI)
	var step := TAU / _dir_count()
	var dir := wrapi(roundi(rel / step), 0, _dir_count())
	if _last_dir >= 0:
		var center := wrapf(_last_dir * step, -PI, PI)
		if absf(wrapf(rel - center, -PI, PI)) <= step / 2.0 + DIR_HYST_RAD:
			dir = _last_dir
	if not _static_pose:
		_accum += delta
		if _accum >= 1.0 / ANIM_FPS:
			_accum = 0.0
			_frame_idx += 1
	if dir != _last_dir or _mat.albedo_texture == null:
		_last_dir = dir
		_refresh_texture()
	elif not _static_pose:
		_refresh_texture()


func _refresh_texture() -> void:
	var count := _frame_count()
	if count <= 0:
		return
	var tex := _load_frame(_last_dir, _frame_idx % count)
	if tex != null:
		_mat.albedo_texture = tex


var _cached_count := -1
func _frame_count() -> int:
	if _cached_count >= 0:
		return _cached_count
	var meta_path := _sprites_dir.path_join(_anim).path_join("frontal_8").path_join("meta.json")
	if FileAccess.file_exists(meta_path):
		var meta: Variant = JSON.parse_string(FileAccess.get_file_as_string(meta_path))
		if meta is Dictionary:
			_cached_count = int(meta.get("frame_count", 1))
			return _cached_count
	_cached_count = 1
	return _cached_count
