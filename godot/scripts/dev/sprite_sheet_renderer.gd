## Headless sprite-sheet renderer for Mixamo characters.
##
## Loads a Mixamo FBX, plays one named animation, and writes PNG frames for
## every facing direction at the chosen camera angle. The angle MUST match the
## ANGLE_PROMPT_FRAGMENTS used by ai_server/sprite_generator.py so AI-generated
## world props share the same projection as the player/NPC sprites.
##
## CLI invocation (via tools/render_sprite_sheets.py):
##   godot --path godot --headless --rendering-method gl_compatibility \
##         res://scenes/dev/sprite_sheet_renderer.tscn -- \
##         --model paladin --anim idle --angle isometric_30 \
##         --out /home/al/code/ne-fan/nefan-html/public/sprites \
##         [--directions 8] [--width 256] [--height 256] [--fps 12]
##
## Output layout (one PNG per direction × frame):
##   {out}/{model}/{anim}/{angle}/dir_{N}_frame_{F:03}.png
##   {out}/{model}/{anim}/{angle}/meta.json
##
## meta.json schema:
##   {model, anim, angle, frame_count, fps, duration, directions, frame_width,
##    frame_height, generated_at}
extends Node3D

const ANIM_FBX_DIR := "res://assets/characters/Sword and Shield Pack/"
# Map of animation_id -> FBX filename (without extension). Mirrors the subset
# combat_animator.gd uses, plus a couple of ambient ones the 2D client needs
# straight away (talking/drinking/wounded handled via ambient_anims).
const ANIM_MAP := {
	"idle": "sword and shield idle",
	"walk": "sword and shield walk",
	"run": "sword and shield run",
	"quick": "sword and shield attack (4)",
	"heavy": "sword and shield slash",
	"medium": "sword and shield slash (5)",
	"defensive": "sword and shield block",
	"precise": "sword and shield slash (3)",
	"hit_react": "sword and shield impact",
	"death": "sword and shield death",
}
const AMBIENT_FBX_DIR := "res://assets/characters/mixamo/ambient_anims/"
const AMBIENT_ANIM_MAP := {
	"talking": "standing_talking",
	"drinking": "drinking",
	"wounded_idle": "wounded_idle",
	"sitting_idle": "sitting_idle",
	"waving": "waving",
	"praying": "praying_kneel",
}

# Camera placement for each supported angle. The camera is placed on a ray of
# length `distance` from the look-at target at the requested pitch, and the
# orthogonal size is large enough so a ~1.8 m tall humanoid fits with margin
# above the head and below the feet.
const ANGLE_CAMERA := {
	"top_down": {"pitch_deg": -90.0, "distance": 4.0, "ortho": 2.4},
	"isometric_30": {"pitch_deg": -30.0, "distance": 4.0, "ortho": 2.4},
	"isometric_45": {"pitch_deg": -45.0, "distance": 4.0, "ortho": 2.4},
	"frontal": {"pitch_deg": 0.0, "distance": 4.0, "ortho": 2.4},
}

# Mid-body of a 1.8 m Mixamo humanoid (X-bot rest pose). Used as the look-at
# target so the camera frames feet-to-head with even margin top and bottom.
const TARGET_HEIGHT := 0.95

@onready var _viewport: SubViewport = $SubViewport
@onready var _camera: Camera3D = $SubViewport/Camera3D
@onready var _light: DirectionalLight3D = $SubViewport/DirectionalLight3D
@onready var _pivot: Node3D = $SubViewport/Pivot

var _model_id := "paladin"
var _anim_id := "idle"
var _angle := "isometric_30"
var _out_root := "user://sprite_sheets"
var _directions := 8
var _frame_width := 256
var _frame_height := 256
var _target_fps := 12

var _model_root: Node3D
var _skeleton: Skeleton3D
var _anim_player: AnimationPlayer
var _bone_prefix := "mixamorig_"


func _ready() -> void:
	_parse_cli_args()
	print("renderer: model=%s anim=%s angle=%s dirs=%d fps=%d" % [
		_model_id, _anim_id, _angle, _directions, _target_fps])
	_viewport.size = Vector2i(_frame_width, _frame_height)
	_viewport.transparent_bg = true
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_position_camera(_angle)
	print("renderer: camera positioned for angle=%s" % _angle)
	if not _load_model(_model_id):
		_fatal("could not load model: %s" % _model_id)
		return
	print("renderer: model loaded, skeleton=%s anim_player=%s prefix=%s" % [
		_skeleton, _anim_player, _bone_prefix])
	if not _load_animation(_anim_id):
		_fatal("could not load animation: %s" % _anim_id)
		return
	print("renderer: animation '%s' staged (length=%.2fs)" % [
		_anim_id, _anim_player.get_animation("__rendered__").length])
	# Defer one frame so the viewport has size before we render.
	await get_tree().process_frame
	await _render_all_directions()
	get_tree().quit(0)


func _parse_cli_args() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	var i := 0
	while i < args.size():
		var key := String(args[i])
		var val := String(args[i + 1]) if i + 1 < args.size() else ""
		match key:
			"--model": _model_id = val; i += 2
			"--anim": _anim_id = val; i += 2
			"--angle": _angle = val; i += 2
			"--out": _out_root = val; i += 2
			"--directions": _directions = int(val); i += 2
			"--width": _frame_width = int(val); i += 2
			"--height": _frame_height = int(val); i += 2
			"--fps": _target_fps = int(val); i += 2
			_:
				i += 1
	if not ANGLE_CAMERA.has(_angle):
		_fatal("unknown angle '%s' (must be one of %s)" % [_angle, ANGLE_CAMERA.keys()])


func _position_camera(angle_id: String) -> void:
	var cfg: Dictionary = ANGLE_CAMERA[angle_id]
	_camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	_camera.size = float(cfg["ortho"])
	var pitch_rad := deg_to_rad(float(cfg["pitch_deg"]))
	var distance := float(cfg["distance"])
	var target := Vector3(0, TARGET_HEIGHT, 0)
	# Place the camera so its forward (target − cam_pos) has the requested pitch:
	# forward = (0, sin(pitch), −cos(pitch)) when looking towards −Z.
	# cam_pos = target − forward × distance
	var fwd := Vector3(0, sin(pitch_rad), -cos(pitch_rad))
	# Top-down (pitch = ±90°) collapses cos to 0 and forward becomes vertical;
	# look_at would fail with up=+Y, so place the camera straight above and
	# pick a stable up axis (−Z keeps the model oriented head-up in screen).
	if abs(cos(pitch_rad)) < 0.001:
		_camera.transform = Transform3D.IDENTITY
		_camera.global_position = target + Vector3(0, distance, 0)
		_camera.look_at(target, Vector3(0, 0, -1))
	else:
		_camera.transform = Transform3D.IDENTITY
		_camera.global_position = target - fwd * distance
		_camera.look_at(target, Vector3.UP)
	# Light from above-left so silhouettes read clearly at every facing.
	_light.rotation_degrees = Vector3(-50.0, 30.0, 0.0)


func _load_model(model_id: String) -> bool:
	var path := "res://assets/characters/mixamo/%s/character.fbx" % model_id
	var scene: PackedScene = load(path)
	if not scene:
		return false
	# Clear any previous model
	for child in _pivot.get_children():
		_pivot.remove_child(child)
		child.queue_free()
	var instance: Node3D = scene.instantiate()
	_pivot.add_child(instance)
	_model_root = instance
	_skeleton = instance.get_node_or_null("Skeleton3D")
	if not _skeleton:
		_skeleton = instance.find_child("Skeleton3D", true, false)
	_anim_player = instance.get_node_or_null("AnimationPlayer")
	if not _anim_player:
		_anim_player = instance.find_child("AnimationPlayer", true, false)
	if _skeleton:
		_bone_prefix = _detect_bone_prefix()
	return _skeleton != null and _anim_player != null


func _detect_bone_prefix() -> String:
	for i in _skeleton.get_bone_count():
		var bn := _skeleton.get_bone_name(i)
		if bn.ends_with("Hips"):
			var idx := bn.find("Hips")
			return bn.substr(0, idx)
	return "mixamorig_"


func _load_animation(anim_id: String) -> bool:
	if not _anim_player:
		return false
	var fbx_path := _anim_fbx_path(anim_id)
	if fbx_path == "":
		return false
	var anim_scene: PackedScene = load(fbx_path)
	if not anim_scene:
		return false
	var anim_inst: Node3D = anim_scene.instantiate()
	var src: AnimationPlayer = anim_inst.get_node_or_null("AnimationPlayer")
	if not src:
		src = anim_inst.find_child("AnimationPlayer", true, false)
	if not src or not src.has_animation_library(""):
		anim_inst.queue_free()
		return false
	var src_lib: AnimationLibrary = src.get_animation_library("")
	var src_name := ""
	if src_lib.has_animation("mixamo_com"):
		src_name = "mixamo_com"
	elif src_lib.get_animation_list().size() > 0:
		src_name = src_lib.get_animation_list()[-1]
	if src_name == "":
		anim_inst.queue_free()
		return false
	var animation: Animation = src_lib.get_animation(src_name).duplicate()
	_remap_animation_bones(animation)
	_lock_hips_xz_if_locomotion(animation, anim_id)
	# Stage on the model's existing AnimationPlayer so its tracks resolve
	# against the right Skeleton3D.
	var lib: AnimationLibrary
	if _anim_player.has_animation_library(""):
		lib = _anim_player.get_animation_library("")
	else:
		lib = AnimationLibrary.new()
		_anim_player.add_animation_library("", lib)
	if lib.has_animation("__rendered__"):
		lib.remove_animation("__rendered__")
	lib.add_animation("__rendered__", animation)
	anim_inst.queue_free()
	return true


func _anim_fbx_path(anim_id: String) -> String:
	if ANIM_MAP.has(anim_id):
		return ANIM_FBX_DIR + ANIM_MAP[anim_id] + ".fbx"
	if AMBIENT_ANIM_MAP.has(anim_id):
		return AMBIENT_FBX_DIR + AMBIENT_ANIM_MAP[anim_id] + ".fbx"
	return ""


func _remap_animation_bones(animation: Animation) -> void:
	# Animations come in with `mixamorig_` prefix; rewrite if model uses a
	# different one (mixamorig1_, etc.). Track paths look like
	# "../Skeleton3D:mixamorig_Hips".
	if _bone_prefix == "mixamorig_":
		return
	for t in animation.get_track_count():
		var path := str(animation.track_get_path(t))
		if path.find(":mixamorig_") >= 0:
			var fixed := path.replace(":mixamorig_", ":" + _bone_prefix)
			animation.track_set_path(t, NodePath(fixed))


const _LOCOMOTION_ANIMS := ["walk", "run", "walk_back", "strafe_left", "strafe_right"]


func _lock_hips_xz_if_locomotion(animation: Animation, anim_id: String) -> void:
	# Mixamo locomotion baked-in root motion shifts the character forward across the cycle,
	# so it walks out of the sprite cell. Lock Hips XZ to its first keyframe (preserve Y so
	# the head bob survives). Same pattern as combat_animator._lock_all_hips_xz().
	if not _LOCOMOTION_ANIMS.has(anim_id):
		return
	for i in range(animation.get_track_count()):
		if animation.track_get_type(i) != Animation.TYPE_POSITION_3D:
			continue
		var path_str: String = str(animation.track_get_path(i))
		if not ("Hips" in path_str):
			continue
		var kc: int = animation.track_get_key_count(i)
		if kc == 0:
			continue
		var base: Vector3 = animation.track_get_key_value(i, 0)
		for k in range(kc):
			var p: Vector3 = animation.track_get_key_value(i, k)
			p.x = base.x
			p.z = base.z
			animation.track_set_key_value(i, k, p)
		print("renderer: locked Hips XZ for '%s' (%d keys)" % [anim_id, kc])
		return


func _render_all_directions() -> void:
	var anim: Animation = _anim_player.get_animation("__rendered__")
	if not anim:
		_fatal("staged animation missing")
		return
	var duration: float = anim.length
	var frame_step := 1.0 / float(_target_fps)
	var frame_count: int = max(1, int(round(duration / frame_step)))

	var out_dir := "%s/%s/%s/%s" % [_out_root, _model_id, _anim_id, _angle]
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(out_dir))

	print("renderer: rendering %d dirs × %d frames (duration=%.2fs)" % [
		_directions, frame_count, duration])
	for d in _directions:
		var yaw_deg := 360.0 * float(d) / float(_directions)
		_pivot.rotation = Vector3(0, deg_to_rad(yaw_deg), 0)
		for f in frame_count:
			var t: float = min(duration, frame_step * float(f))
			# seek_to() on the player so the AnimationTree-less playback honors
			# the time we want; AnimationPlayer.seek with update=true forces a
			# pose update on the skeleton this frame.
			_anim_player.play("__rendered__")
			_anim_player.seek(t, true)
			_anim_player.pause()
			# Wait for the rendering server to process the pose change.
			await RenderingServer.frame_post_draw
			var img: Image = _viewport.get_texture().get_image()
			var name := "dir_%d_frame_%03d.png" % [d, f]
			var path := "%s/%s" % [out_dir, name]
			img.save_png(path)

	var meta := {
		"model": _model_id,
		"anim": _anim_id,
		"angle": _angle,
		"directions": _directions,
		"frame_count": frame_count,
		"fps": _target_fps,
		"duration": duration,
		"frame_width": _frame_width,
		"frame_height": _frame_height,
		"generated_at": Time.get_datetime_string_from_system(true),
	}
	var meta_path := "%s/meta.json" % out_dir
	var f := FileAccess.open(meta_path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(meta, "\t"))
		f.close()
	print("sprite_sheet_renderer: wrote %d × %d frames to %s" % [_directions, frame_count, out_dir])


func _fatal(msg: String) -> void:
	push_error("sprite_sheet_renderer: %s" % msg)
	OS.alert(msg, "sprite_sheet_renderer")
	get_tree().quit(1)
