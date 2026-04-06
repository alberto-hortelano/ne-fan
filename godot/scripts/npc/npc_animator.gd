## Loads Mixamo FBX character + ambient animations for non-combat NPCs.
## Simplified version of CombatAnimator — no combat state machine, no collision sync.
## NPCs play a single looping animation (sitting, talking, drinking, etc.)
class_name NpcAnimator
extends Node3D

const DEFAULT_ANIM_DIR := "res://assets/characters/mixamo/ambient_anims/"

var model_path: String = ""
var anim_dir: String = DEFAULT_ANIM_DIR
var default_animation: String = "idle"

const ANIM_MAP := {
	"idle": "idle_neutral",
	"walk": "walking",
	"look_around": "idle_look_around",
	"breathing": "idle_breathing",
	"sitting": "sitting_idle",
	"sitting_talk": "sitting_talking",
	"talking": "standing_talking",
	"drinking": "drinking",
	"praying": "praying_kneel",
	"waving": "waving",
	"leaning": "leaning_wall",
	"wounded": "wounded_idle",
	"lying": "lying_down",
	"arms_crossed": "arms_crossed",
	"salute": "salute",
}

const NON_LOOPING := ["salute"]

var _anim_player: AnimationPlayer
var _anim_tree: AnimationTree
var _playback: AnimationNodeStateMachinePlayback
var _skeleton: Skeleton3D


func _ready() -> void:
	if model_path == "":
		push_error("NpcAnimator: model_path not set")
		return
	_load_model()
	_load_animations()
	_setup_animation_tree()
	_lock_all_hips_xz()
	# Play default animation after tree is active
	call_deferred("_play_default")
	print("NpcAnimator: loaded %s with %d animations" % [model_path.get_file(), _get_anim_count()])


func _play_default() -> void:
	if _playback and default_animation != "":
		var anim_name: String = default_animation
		# Map common aliases
		if anim_name == "idle_neutral":
			anim_name = "idle"
		if _anim_player and _anim_player.has_animation_library(""):
			var lib: AnimationLibrary = _anim_player.get_animation_library("")
			if lib.has_animation(anim_name):
				_playback.travel(anim_name)


func _load_model() -> void:
	var scene: PackedScene = load(model_path)
	if not scene:
		push_error("NpcAnimator: cannot load %s" % model_path)
		return

	var instance: Node3D = scene.instantiate()
	_clear_owner_recursive(instance)

	_skeleton = instance.get_node_or_null("Skeleton3D")
	if _skeleton:
		instance.remove_child(_skeleton)
		add_child(_skeleton)

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

	var lib: AnimationLibrary
	if _anim_player.has_animation_library(""):
		lib = _anim_player.get_animation_library("")
	else:
		lib = AnimationLibrary.new()
		_anim_player.add_animation_library("", lib)

	for anim_name in ANIM_MAP:
		var fbx_name: String = ANIM_MAP[anim_name]
		var path: String = anim_dir + fbx_name + ".fbx"
		if not ResourceLoader.exists(path):
			continue
		var scene: PackedScene = load(path)
		if not scene:
			continue

		var instance: Node3D = scene.instantiate()
		var src_player: AnimationPlayer = instance.get_node_or_null("AnimationPlayer")
		if src_player and src_player.has_animation_library(""):
			var src_lib: AnimationLibrary = src_player.get_animation_library("")
			var src_anim_name: String = ""
			if src_lib.has_animation("mixamo_com"):
				src_anim_name = "mixamo_com"
			elif src_lib.get_animation_list().size() > 0:
				src_anim_name = src_lib.get_animation_list()[-1]
			if src_anim_name != "":
				var animation: Animation = src_lib.get_animation(src_anim_name).duplicate()
				if anim_name in NON_LOOPING:
					animation.loop_mode = Animation.LOOP_NONE
				else:
					animation.loop_mode = Animation.LOOP_LINEAR
				if lib.has_animation(anim_name):
					lib.remove_animation(anim_name)
				lib.add_animation(anim_name, animation)
		instance.queue_free()


func _setup_animation_tree() -> void:
	_anim_tree = AnimationTree.new()
	_anim_tree.name = "AnimationTree"
	_anim_tree.anim_player = _anim_player.get_path()

	var state_machine := AnimationNodeStateMachine.new()

	var lib: AnimationLibrary = _anim_player.get_animation_library("")
	for anim_name in lib.get_animation_list():
		var node := AnimationNodeAnimation.new()
		node.animation = anim_name
		state_machine.add_node(anim_name, node)

	# All ambient anims can transition freely between each other
	var anim_list: Array = lib.get_animation_list()
	for from in anim_list:
		for to in anim_list:
			if from != to:
				var t := AnimationNodeStateMachineTransition.new()
				t.xfade_time = 0.3
				state_machine.add_transition(from, to, t)

	_anim_tree.tree_root = state_machine
	_anim_tree.active = true
	add_child(_anim_tree)

	_playback = _anim_tree.get("parameters/playback")


func _lock_all_hips_xz() -> void:
	"""Lock Hips XZ on ALL ambient animations — NPCs don't move."""
	if not _anim_player or not _anim_player.has_animation_library(""):
		return
	var lib: AnimationLibrary = _anim_player.get_animation_library("")
	for anim_name in lib.get_animation_list():
		var anim: Animation = lib.get_animation(anim_name)
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


# --- Public API ---


func play(anim_name: String) -> void:
	if _playback:
		_playback.travel(anim_name)


func apply_skin(texture_path: String) -> void:
	var tex: Texture2D = load(texture_path)
	if not tex or not _skeleton:
		return
	for child in _skeleton.get_children():
		if child is MeshInstance3D:
			var mesh_inst: MeshInstance3D = child
			for surf_idx in range(mesh_inst.get_surface_override_material_count()):
				var mat: Material = mesh_inst.get_active_material(surf_idx)
				if mat is StandardMaterial3D:
					var new_mat: StandardMaterial3D = mat.duplicate()
					new_mat.albedo_texture = tex
					mesh_inst.set_surface_override_material(surf_idx, new_mat)


func _get_anim_count() -> int:
	if _anim_player and _anim_player.has_animation_library(""):
		return _anim_player.get_animation_library("").get_animation_list().size()
	return 0


func _clear_owner_recursive(node: Node) -> void:
	node.owner = null
	for child in node.get_children():
		_clear_owner_recursive(child)
