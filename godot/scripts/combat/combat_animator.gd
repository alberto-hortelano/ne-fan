## Loads Mixamo FBX character + animations, maps combat states to animations.
class_name CombatAnimator
extends Node3D

const BASE_MODEL_PATH := "res://assets/characters/Sword and Shield Pack/Paladin J Nordstrom.fbx"
const ANIM_DIR := "res://assets/characters/Sword and Shield Pack/"

# Map combat states/types to FBX filenames (without .fbx)
const ANIM_MAP := {
	"idle": "sword and shield idle",
	"run": "sword and shield run",
	"walk": "sword and shield walk",
	"quick": "sword and shield attack",
	"heavy": "sword and shield slash",
	"medium": "sword and shield attack (2)",
	"defensive": "sword and shield block",
	"precise": "sword and shield slash (3)",
	"hit": "sword and shield impact",
	"death": "sword and shield death",
	"turn": "sword and shield turn",
	"kick": "sword and shield kick",
	"casting": "sword and shield casting",
	"block_idle": "sword and shield block idle",
	"power_up": "sword and shield power up",
	"jump": "sword and shield jump",
	"draw_sword_1": "draw sword 1",
	"draw_sword_2": "draw sword 2",
}

var _anim_player: AnimationPlayer
var _current_anim: String = ""
var _skeleton: Skeleton3D

var _hips_idx: int = -1
var _root_motion_enabled := true
var _base_pos_y: float = 0.0
var _prev_hips_xz := Vector2.ZERO


func _ready() -> void:
	_load_model()
	_load_animations()
	play("idle")
	# Detach from parent transform so moving the body doesn't move the model
	top_level = true
	# Sync initial position to parent — model origin is at feet (y=0)
	var body := get_parent()
	if body:
		global_position = body.global_position
	# Run after AnimationPlayer so bones are updated
	process_priority = 100
	if _skeleton:
		_hips_idx = _skeleton.find_bone("mixamorig_Hips")
		if _hips_idx >= 0:
			var rest: Transform3D = _skeleton.get_bone_rest(_hips_idx)
			_prev_hips_xz = Vector2(rest.origin.x, rest.origin.z)


func _process(_delta: float) -> void:
	var body := get_parent()
	if not body:
		return
	# Keep model Y in sync with body (handles teleports, gravity, etc)
	global_position.y = body.global_position.y
	if not _root_motion_enabled or not _skeleton or _hips_idx < 0:
		return
	# With top_level=true, moving body doesn't move the model (no feedback loop).
	# Sync body global XZ to Hips bone world XZ position.
	var hips_world: Vector3 = get_hips_world_position()
	body.global_position.x = hips_world.x
	body.global_position.z = hips_world.z


func get_hips_world_position() -> Vector3:
	"""Returns the world position of the Hips bone (where the character actually is)."""
	if _skeleton and _hips_idx >= 0:
		var hips_pose: Transform3D = _skeleton.get_bone_global_pose(_hips_idx)
		return _skeleton.global_transform * hips_pose.origin
	return global_position


func _load_model() -> void:
	var scene: PackedScene = load(BASE_MODEL_PATH)
	if not scene:
		push_error("CombatAnimator: cannot load %s" % BASE_MODEL_PATH)
		return

	var instance: Node3D = scene.instantiate()

	# Clear owners before reparenting to avoid "inconsistent owner" issues
	_clear_owner_recursive(instance)

	# Extract skeleton and meshes
	_skeleton = instance.get_node_or_null("Skeleton3D")
	if _skeleton:
		instance.remove_child(_skeleton)
		add_child(_skeleton)

	# Get or create AnimationPlayer
	var src_player: AnimationPlayer = instance.get_node_or_null("AnimationPlayer")
	if src_player:
		instance.remove_child(src_player)
		add_child(src_player)
		_anim_player = src_player
	else:
		_anim_player = AnimationPlayer.new()
		add_child(_anim_player)

	instance.queue_free()


func _load_animations() -> void:
	if not _anim_player:
		return

	# Ensure we have a default library
	var lib: AnimationLibrary
	if _anim_player.has_animation_library(""):
		lib = _anim_player.get_animation_library("")
	else:
		lib = AnimationLibrary.new()
		_anim_player.add_animation_library("", lib)

	for anim_name in ANIM_MAP:
		var fbx_name: String = ANIM_MAP[anim_name]
		var path: String = ANIM_DIR + fbx_name + ".fbx"
		var scene: PackedScene = load(path)
		if not scene:
			print("CombatAnimator: missing %s" % path)
			continue

		var instance: Node3D = scene.instantiate()
		var src_player: AnimationPlayer = instance.get_node_or_null("AnimationPlayer")
		if src_player and src_player.has_animation_library(""):
			var src_lib: AnimationLibrary = src_player.get_animation_library("")
			# Prefer "mixamo_com" over "Take 001" (T-pose from individual downloads)
			var src_anim_name: String = ""
			if src_lib.has_animation("mixamo_com"):
				src_anim_name = "mixamo_com"
			elif src_lib.get_animation_list().size() > 0:
				src_anim_name = src_lib.get_animation_list()[-1]
			if src_anim_name != "":
				var animation: Animation = src_lib.get_animation(src_anim_name).duplicate()
				animation.loop_mode = Animation.LOOP_LINEAR
				if lib.has_animation(anim_name):
					lib.remove_animation(anim_name)
				lib.add_animation(anim_name, animation)
		instance.queue_free()

	print("CombatAnimator: loaded %d animations" % lib.get_animation_list().size())


func play(anim_name: String, speed: float = 1.0) -> void:
	if not _anim_player:
		return
	if anim_name == _current_anim and _anim_player.is_playing():
		return
	if _anim_player.has_animation(anim_name):
		_anim_player.play(anim_name, -1, speed)
		_current_anim = anim_name
	else:
		# Fallback to idle
		if anim_name != "idle" and _anim_player.has_animation("idle"):
			_anim_player.play("idle")
			_current_anim = "idle"


func play_once(anim_name: String, speed: float = 1.0) -> void:
	if not _anim_player:
		return
	if _anim_player.has_animation(anim_name):
		_anim_player.play(anim_name, -1, speed)
		_current_anim = anim_name


func is_playing() -> bool:
	return _anim_player and _anim_player.is_playing()


func get_current() -> String:
	return _current_anim


func apply_skin(texture_path: String) -> void:
	"""Replace albedo texture on all mesh materials with a custom skin."""
	var tex: Texture2D = load(texture_path)
	if not tex:
		push_error("CombatAnimator: cannot load skin %s" % texture_path)
		return
	if not _skeleton:
		return
	var count: int = 0
	for child in _skeleton.get_children():
		if child is MeshInstance3D:
			var mesh_inst: MeshInstance3D = child
			for surf_idx in range(mesh_inst.get_surface_override_material_count()):
				var mat: Material = mesh_inst.get_active_material(surf_idx)
				if mat is StandardMaterial3D:
					var new_mat: StandardMaterial3D = mat.duplicate()
					new_mat.albedo_texture = tex
					mesh_inst.set_surface_override_material(surf_idx, new_mat)
					count += 1
				elif mat is BaseMaterial3D:
					var new_mat: BaseMaterial3D = mat.duplicate()
					new_mat.albedo_texture = tex
					mesh_inst.set_surface_override_material(surf_idx, new_mat)
					count += 1
	print("CombatAnimator: skin applied to %d surfaces" % count)


func lock_in_place() -> void:
	"""Fix all loaded animations to stay in place (for showcase/preview)."""
	_root_motion_enabled = false
	if not _anim_player:
		return
	if _anim_player.has_animation_library(""):
		var lib: AnimationLibrary = _anim_player.get_animation_library("")
		for anim_name in lib.get_animation_list():
			var anim: Animation = lib.get_animation(anim_name)
			_fix_root_motion(anim)


func _fix_root_motion(anim: Animation) -> void:
	# Fix XZ drift on Hips position track while keeping Y (height) intact.
	# Locks XZ to the first keyframe value so the character stays in place
	# but can still bob up/down, crouch, fall on death, etc.
	for i in range(anim.get_track_count()):
		if anim.track_get_type(i) == Animation.TYPE_POSITION_3D:
			var path_str: String = str(anim.track_get_path(i))
			if "Hips" in path_str:
				var kc: int = anim.track_get_key_count(i)
				if kc == 0:
					continue
				var base: Vector3 = anim.track_get_key_value(i, 0)
				for k in range(kc):
					var p: Vector3 = anim.track_get_key_value(i, k)
					p.x = base.x
					p.z = base.z
					anim.track_set_key_value(i, k, p)
				break


func _clear_owner_recursive(node: Node) -> void:
	node.owner = null
	for child in node.get_children():
		_clear_owner_recursive(child)
