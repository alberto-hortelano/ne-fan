## Loads Mixamo FBX character + animations, sets up AnimationTree with StateMachine.
## Animations are purely visual — all movement is via CharacterBody3D velocity.
## Pattern follows: https://github.com/catprisbrey/Third-Person-Controller--SoulsLIke-Godot4
class_name CombatAnimator
extends Node3D

const BASE_MODEL_PATH := "res://assets/characters/Sword and Shield Pack/Paladin J Nordstrom.fbx"
const ANIM_DIR := "res://assets/characters/Sword and Shield Pack/"

# Map combat states/types to FBX filenames (without .fbx)
const ANIM_MAP := {
	"idle": "sword and shield idle",
	"run": "sword and shield run",
	"walk": "sword and shield walk",
	"quick": "sword and shield attack (4)",
	"heavy": "sword and shield slash",
	"medium": "sword and shield slash (5)",
	"defensive": "sword and shield block",
	"precise": "sword and shield slash (3)",
	"hit": "sword and shield impact",
	"death": "sword and shield death",
	"turn": "sword and shield turn",
	"kick": "sword and shield kick",
	"casting": "sword and shield casting",
	"block_idle": "sword and shield block idle",
	"power_up": "sword and shield power up",
	"jump": "sword and shield jump (2)",
	"draw_sword_1": "draw sword 1",
	"draw_sword_2": "draw sword 2",
}

# Animations that loop
const LOOPING_ANIMS := ["idle", "walk", "run", "block_idle"]

var _anim_player: AnimationPlayer
var _anim_tree: AnimationTree
var _playback: AnimationNodeStateMachinePlayback
var _current_anim: String = ""
var _skeleton: Skeleton3D
var _hips_idx: int = -1
var _collision_shape: CollisionShape3D = null
var _collision_rest_pos := Vector3(0, 0.9, 0)


func _ready() -> void:
	_load_model()
	_load_animations()
	_setup_animation_tree()
	_lock_all_hips_xz()
	# Cache collision shape for syncing during attacks
	process_priority = 100  # Run after AnimationPlayer
	var body := get_parent()
	if body:
		_collision_shape = body.get_node_or_null("CollisionShape3D")
		if _collision_shape:
			_collision_rest_pos = _collision_shape.position
	print("CombatAnimator: loaded %d animations" % _get_anim_count())


func _process(_delta: float) -> void:
	if not _skeleton or _hips_idx < 0 or not _collision_shape:
		return

	var body := get_parent()
	if not body:
		return

	var sync = body.get_node_or_null("CombatAnimationSync")
	var is_action: bool = sync != null and sync.is_attacking

	if is_action:
		# Move collision shape to where the Hips bone is
		# get_bone_global_pose gives position in skeleton space
		# Convert to body-local space accounting for model rotation
		var hips_global: Transform3D = _skeleton.get_bone_global_pose(_hips_idx)
		var hips_in_skel: Vector3 = hips_global.origin
		# Skeleton is child of CombatAnimator, which is child of body
		# Transform: skeleton-local → animator-local → body-local
		var hips_in_body: Vector3 = global_transform * _skeleton.transform * hips_in_skel
		var body_global: Vector3 = get_parent().global_position
		var offset: Vector3 = hips_in_body - body_global
		_collision_shape.position.x = offset.x
		_collision_shape.position.z = offset.z
	else:
		# Return to rest position
		_collision_shape.position = _collision_rest_pos


func _load_model() -> void:
	var scene: PackedScene = load(BASE_MODEL_PATH)
	if not scene:
		push_error("CombatAnimator: cannot load %s" % BASE_MODEL_PATH)
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

	if _skeleton:
		_hips_idx = _skeleton.find_bone("mixamorig_Hips")

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
		var path: String = ANIM_DIR + fbx_name + ".fbx"
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
				# Set loop mode based on animation type
				if anim_name in LOOPING_ANIMS:
					animation.loop_mode = Animation.LOOP_LINEAR
				else:
					animation.loop_mode = Animation.LOOP_NONE
				if lib.has_animation(anim_name):
					lib.remove_animation(anim_name)
				lib.add_animation(anim_name, animation)
		instance.queue_free()


func _setup_animation_tree() -> void:
	"""Create AnimationTree with StateMachine programmatically."""
	_anim_tree = AnimationTree.new()
	_anim_tree.name = "AnimationTree"
	_anim_tree.anim_player = _anim_player.get_path()

	var state_machine := AnimationNodeStateMachine.new()

	# Add animation nodes for each loaded animation
	var lib: AnimationLibrary = _anim_player.get_animation_library("")
	for anim_name in lib.get_animation_list():
		var node := AnimationNodeAnimation.new()
		node.animation = anim_name
		state_machine.add_node(anim_name, node)

	# Add transitions: locomotion states can transition freely
	var locomotion := ["idle", "walk", "run"]
	for from in locomotion:
		for to in locomotion:
			if from != to and state_machine.has_node(from) and state_machine.has_node(to):
				var t := AnimationNodeStateMachineTransition.new()
				t.xfade_time = 0.15
				state_machine.add_transition(from, to, t)

	# From locomotion to one-shot animations (attacks, jump, etc.)
	var one_shots := ["quick", "heavy", "medium", "defensive", "precise",
					  "kick", "hit", "death", "jump", "casting", "turn",
					  "power_up", "draw_sword_1", "draw_sword_2"]
	for action in one_shots:
		if not state_machine.has_node(action):
			continue
		for from in locomotion:
			if state_machine.has_node(from):
				var t := AnimationNodeStateMachineTransition.new()
				t.xfade_time = 0.1
				state_machine.add_transition(from, action, t)
		# Auto-return to idle after one-shot completes
		var t_back := AnimationNodeStateMachineTransition.new()
		t_back.xfade_time = 0.1
		t_back.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_AT_END
		t_back.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_AUTO
		state_machine.add_transition(action, "idle", t_back)

	_anim_tree.tree_root = state_machine
	_anim_tree.active = true
	add_child(_anim_tree)

	_playback = _anim_tree.get("parameters/playback")


func _lock_all_hips_xz() -> void:
	"""Lock Hips XZ on locomotion animations only (walk/run).
	These have significant drift that conflicts with WASD movement.
	Other animations (idle, attacks) have ~0 drift and play naturally."""
	if not _anim_player or not _anim_player.has_animation_library(""):
		return
	# Only lock animations with significant root motion drift
	var lock_list := ["walk", "run"]
	var lib: AnimationLibrary = _anim_player.get_animation_library("")
	for anim_name in lock_list:
		if not lib.has_animation(anim_name):
			continue
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


# ─── Public API ───


func travel(anim_name: String) -> void:
	"""Transition to animation via AnimationTree StateMachine (smooth blend)."""
	if _playback:
		_playback.travel(anim_name)
	_current_anim = anim_name


func start(anim_name: String) -> void:
	"""Jump directly to animation (no blend, for interrupts like roll)."""
	if _playback:
		_playback.start(anim_name)
	_current_anim = anim_name


func play(anim_name: String, _speed: float = 1.0) -> void:
	"""Legacy API — routes to travel() for backwards compatibility."""
	travel(anim_name)


func play_once(anim_name: String, _speed: float = 1.0) -> void:
	"""Legacy API — routes to travel() for backwards compatibility."""
	travel(anim_name)


func get_current() -> String:
	if _playback:
		var node: StringName = _playback.get_current_node()
		return String(node)
	return _current_anim


func get_current_length() -> float:
	var current: String = get_current()
	if _anim_player and _anim_player.has_animation(current):
		return _anim_player.get_animation(current).length
	return 0.0


func is_playing() -> bool:
	return _anim_player and _anim_player.is_playing()


func apply_skin(texture_path: String) -> void:
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
	"""Already locked — all animations are in place by default."""
	pass


func _get_anim_count() -> int:
	if _anim_player and _anim_player.has_animation_library(""):
		return _anim_player.get_animation_library("").get_animation_list().size()
	return 0


func _clear_owner_recursive(node: Node) -> void:
	node.owner = null
	for child in node.get_children():
		_clear_owner_recursive(child)
