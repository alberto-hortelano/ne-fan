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
}

var _anim_player: AnimationPlayer
var _current_anim: String = ""
var _skeleton: Skeleton3D


var _hips_idx: int = -1


func _ready() -> void:
	_load_model()
	_load_animations()
	play("idle")
	if _skeleton:
		_hips_idx = _skeleton.find_bone("mixamorig_Hips")


func _process(_delta: float) -> void:
	# Prevent root motion drift: lock Hips bone XZ to origin each frame
	if _skeleton and _hips_idx >= 0:
		var pos: Vector3 = _skeleton.get_bone_pose_position(_hips_idx)
		pos.x = 0.0
		pos.z = 0.0
		_skeleton.set_bone_pose_position(_hips_idx, pos)


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
			for src_anim_name in src_lib.get_animation_list():
				var animation: Animation = src_lib.get_animation(src_anim_name).duplicate()
				_strip_root_motion(animation)
				if lib.has_animation(anim_name):
					lib.remove_animation(anim_name)
				lib.add_animation(anim_name, animation)
				break  # Only take first animation from each FBX
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


func _strip_root_motion(anim: Animation) -> void:
	# Remove Hips position track to prevent animation drift
	var i: int = anim.get_track_count() - 1
	while i >= 0:
		if anim.track_get_type(i) == Animation.TYPE_POSITION_3D:
			var path_str: String = str(anim.track_get_path(i))
			if "Hips" in path_str:
				anim.remove_track(i)
		i -= 1


func _clear_owner_recursive(node: Node) -> void:
	node.owner = null
	for child in node.get_children():
		_clear_owner_recursive(child)
