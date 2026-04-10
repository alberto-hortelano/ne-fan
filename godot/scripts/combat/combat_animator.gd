## Loads Mixamo FBX character + animations, sets up AnimationTree with upper/lower body blending.
## Two layers: locomotion (full body base) + combat (upper body filtered via Blend2).
## Animations are purely visual — all movement is via CharacterBody3D velocity.
## Pattern follows: https://github.com/catprisbrey/Third-Person-Controller--SoulsLIke-Godot4
class_name CombatAnimator
extends Node3D

const DEFAULT_MODEL_PATH := "res://assets/characters/Sword and Shield Pack/character.fbx"
const DEFAULT_ANIM_DIR := "res://assets/characters/Sword and Shield Pack/"

# Configurable per-instance (set before _ready or via set_character_model)
var model_path: String = DEFAULT_MODEL_PATH
var anim_dir: String = DEFAULT_ANIM_DIR

# Map combat states/types to FBX filenames (without .fbx)
const ANIM_MAP := {
	"idle": "sword and shield idle",
	"run": "sword and shield run",
	"walk": "sword and shield walk",
	"walk_back": "sword and shield walk (2)",
	"strafe_left": "sword and shield strafe",
	"strafe_right": "sword and shield strafe (2)",
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
const LOOPING_ANIMS := ["idle", "walk", "run", "walk_back", "strafe_left", "strafe_right", "block_idle", "turn"]

var _anim_player: AnimationPlayer
var _anim_tree: AnimationTree
var _locomotion_playback: AnimationNodeStateMachinePlayback
var _combat_playback: AnimationNodeStateMachinePlayback
var _current_anim: String = ""
var _skeleton: Skeleton3D
var _hips_idx: int = -1
var _collision_shape: CollisionShape3D = null
var _collision_rest_pos := Vector3(0, 0.9, 0)

# One-shot animations (attacks, reactions) — used for routing travel() calls
const ONE_SHOT_SET := {
	"quick": true, "heavy": true, "medium": true, "defensive": true, "precise": true,
	"kick": true, "hit": true, "death": true, "jump": true, "casting": true,
	"power_up": true, "draw_sword_1": true, "draw_sword_2": true,
}

# Full-body animations — both layers play these (no split)
const FULL_BODY_SET := {
	"death": true, "hit": true, "jump": true,
}


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
		# Convert hips world position to body-local space (accounts for body rotation)
		var hips_global: Transform3D = _skeleton.get_bone_global_pose(_hips_idx)
		var hips_world: Vector3 = global_transform * _skeleton.transform * hips_global.origin
		var offset_local: Vector3 = body.to_local(hips_world)
		_collision_shape.position.x = offset_local.x
		_collision_shape.position.z = offset_local.z
	else:
		# Return to rest position
		_collision_shape.position = _collision_rest_pos


func set_character_model(path: String) -> void:
	"""Set a custom character model path. Call before _ready or use reload_model()."""
	model_path = path
	# Derive anim_dir from model path's directory
	anim_dir = path.get_base_dir() + "/"


func reload_model() -> void:
	"""Reload the character with current model_path. Use after set_character_model()."""
	# Clean up existing skeleton and animation player
	if _skeleton:
		_skeleton.queue_free()
		_skeleton = null
	if _anim_player:
		_anim_player.queue_free()
		_anim_player = null
	if _anim_tree:
		_anim_tree.queue_free()
		_anim_tree = null
	_locomotion_playback = null
	_combat_playback = null
	_hips_idx = -1
	# Rebuild
	_load_model()
	_load_animations()
	_setup_animation_tree()
	_lock_all_hips_xz()
	print("CombatAnimator: reloaded with %s (%d animations)" % [model_path, _get_anim_count()])


func _load_model() -> void:
	var scene: PackedScene = load(model_path)
	if not scene:
		push_error("CombatAnimator: cannot load %s" % model_path)
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
		var path: String = anim_dir + fbx_name + ".fbx"
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
	"""Create AnimationTree with BlendTree: locomotion (full body) + combat (upper body filtered)."""
	_anim_tree = AnimationTree.new()
	_anim_tree.name = "AnimationTree"
	_anim_tree.anim_player = _anim_player.get_path()

	var blend_tree := AnimationNodeBlendTree.new()

	var lib: AnimationLibrary = _anim_player.get_animation_library("")
	var locomotion := ["idle", "walk", "run", "walk_back", "strafe_left", "strafe_right", "turn"]
	var one_shots := ["quick", "heavy", "medium", "defensive", "precise",
					  "kick", "hit", "death", "jump", "casting",
					  "power_up", "draw_sword_1", "draw_sword_2"]

	# Full-body one-shots that also need to be in the locomotion layer
	var loco_one_shots := ["jump", "death", "hit"]

	# ── Locomotion StateMachine (lower body always) ──
	var loco_sm := AnimationNodeStateMachine.new()
	for anim_name in locomotion:
		if lib.has_animation(anim_name):
			var node := AnimationNodeAnimation.new()
			node.animation = anim_name
			loco_sm.add_node(anim_name, node)
	for from in locomotion:
		for to in locomotion:
			if from != to and loco_sm.has_node(from) and loco_sm.has_node(to):
				var t := AnimationNodeStateMachineTransition.new()
				t.xfade_time = 0.15
				loco_sm.add_transition(from, to, t)
	# Add full-body one-shots to locomotion layer (jump, death, hit)
	for action in loco_one_shots:
		if not lib.has_animation(action):
			continue
		var node := AnimationNodeAnimation.new()
		node.animation = action
		loco_sm.add_node(action, node)
		for from in locomotion:
			if loco_sm.has_node(from):
				var t := AnimationNodeStateMachineTransition.new()
				t.xfade_time = 0.1
				loco_sm.add_transition(from, action, t)
		var t_back := AnimationNodeStateMachineTransition.new()
		t_back.xfade_time = 0.1
		t_back.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_AT_END
		t_back.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_AUTO
		loco_sm.add_transition(action, "idle", t_back)

	# ── Combat StateMachine (upper body: locomotion mirror + one-shots) ──
	var combat_sm := AnimationNodeStateMachine.new()
	# Add locomotion mirrors so upper body stays in sync when not attacking
	for anim_name in locomotion:
		if lib.has_animation(anim_name):
			var node := AnimationNodeAnimation.new()
			node.animation = anim_name
			combat_sm.add_node(anim_name, node)
	for from in locomotion:
		for to in locomotion:
			if from != to and combat_sm.has_node(from) and combat_sm.has_node(to):
				var t := AnimationNodeStateMachineTransition.new()
				t.xfade_time = 0.15
				combat_sm.add_transition(from, to, t)
	# Add one-shot actions
	for action in one_shots:
		if lib.has_animation(action):
			var node := AnimationNodeAnimation.new()
			node.animation = action
			combat_sm.add_node(action, node)
	# Transitions: locomotion → one-shot, one-shot → idle (auto-return)
	for action in one_shots:
		if not combat_sm.has_node(action):
			continue
		for from in locomotion:
			if combat_sm.has_node(from):
				var t := AnimationNodeStateMachineTransition.new()
				t.xfade_time = 0.1
				combat_sm.add_transition(from, action, t)
		var t_back := AnimationNodeStateMachineTransition.new()
		t_back.xfade_time = 0.1
		t_back.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_AT_END
		t_back.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_AUTO
		combat_sm.add_transition(action, "idle", t_back)

	# ── Blend2 with upper body bone filter ──
	var blend2 := AnimationNodeBlend2.new()
	blend2.filter_enabled = true
	for bone_path in _get_upper_body_filter_paths():
		blend2.set_filter_path(bone_path, true)

	# ── Assemble BlendTree ──
	blend_tree.add_node("locomotion_sm", loco_sm)
	blend_tree.add_node("combat_sm", combat_sm)
	blend_tree.add_node("upper_blend", blend2)
	blend_tree.connect_node("upper_blend", 0, "locomotion_sm")
	blend_tree.connect_node("upper_blend", 1, "combat_sm")
	blend_tree.connect_node("output", 0, "upper_blend")

	_anim_tree.tree_root = blend_tree
	_anim_tree.active = true
	add_child(_anim_tree)

	# Set blend amount to 1.0 (always blend upper body from combat layer)
	_anim_tree.set("parameters/upper_blend/blend_amount", 1.0)

	_locomotion_playback = _anim_tree.get("parameters/locomotion_sm/playback")
	_combat_playback = _anim_tree.get("parameters/combat_sm/playback")


func _get_upper_body_filter_paths() -> Array[NodePath]:
	"""Walk skeleton from mixamorig_Spine downward, return all bone NodePaths for filtering."""
	var paths: Array[NodePath] = []
	if not _skeleton:
		return paths
	var spine_idx: int = _skeleton.find_bone("mixamorig_Spine")
	if spine_idx < 0:
		push_warning("CombatAnimator: mixamorig_Spine bone not found, upper body filter disabled")
		return paths
	_collect_bone_filter_paths(spine_idx, paths)
	print("CombatAnimator: upper body filter = %d bones" % paths.size())
	return paths


func _collect_bone_filter_paths(bone_idx: int, result: Array[NodePath]) -> void:
	"""Recursively collect bone filter paths (Skeleton3D:bone_name format)."""
	var bone_name: String = _skeleton.get_bone_name(bone_idx)
	# Filter path format: relative path from AnimationPlayer root to Skeleton3D + :bone_name
	result.append(NodePath("Skeleton3D:" + bone_name))
	for i in range(_skeleton.get_bone_count()):
		if _skeleton.get_bone_parent(i) == bone_idx:
			_collect_bone_filter_paths(i, result)


func _lock_all_hips_xz() -> void:
	"""Lock Hips XZ on locomotion animations only (walk/run).
	These have significant drift that conflicts with WASD movement.
	Other animations (idle, attacks) have ~0 drift and play naturally."""
	if not _anim_player or not _anim_player.has_animation_library(""):
		return
	# Only lock animations with significant root motion drift
	var lock_list := ["walk", "run", "walk_back", "strafe_left", "strafe_right"]
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
	"""Backward-compatible: routes to correct layer based on animation type."""
	if anim_name in FULL_BODY_SET:
		travel_full_body(anim_name)
	elif anim_name in ONE_SHOT_SET:
		travel_combat(anim_name)
	else:
		# Locomotion: drive both layers in sync
		travel_locomotion(anim_name)
		travel_combat(anim_name)
	_current_anim = anim_name


func start(anim_name: String) -> void:
	"""Backward-compatible: immediate transition, routes to correct layer."""
	if anim_name in FULL_BODY_SET:
		start_full_body(anim_name)
	elif anim_name in ONE_SHOT_SET:
		start_combat(anim_name)
	else:
		if _locomotion_playback:
			_locomotion_playback.start(anim_name)
		if _combat_playback:
			_combat_playback.start(anim_name)
	_current_anim = anim_name


func travel_locomotion(anim_name: String) -> void:
	"""Drive the locomotion (lower body) layer."""
	if _locomotion_playback:
		_locomotion_playback.travel(anim_name)


func travel_combat(anim_name: String) -> void:
	"""Drive the combat (upper body) layer."""
	if _combat_playback:
		_combat_playback.travel(anim_name)


func start_combat(anim_name: String) -> void:
	"""Immediate transition on combat (upper body) layer."""
	if _combat_playback:
		_combat_playback.start(anim_name)


func travel_full_body(anim_name: String) -> void:
	"""Drive both layers (for death, hit, jump)."""
	travel_locomotion(anim_name)
	travel_combat(anim_name)


func start_full_body(anim_name: String) -> void:
	"""Immediate transition on both layers."""
	if _locomotion_playback:
		_locomotion_playback.start(anim_name)
	if _combat_playback:
		_combat_playback.start(anim_name)


func play(anim_name: String, _speed: float = 1.0) -> void:
	"""Legacy API — routes to travel() for backwards compatibility."""
	travel(anim_name)


func play_once(anim_name: String, _speed: float = 1.0) -> void:
	"""Legacy API — routes to travel() for backwards compatibility."""
	travel(anim_name)


func get_current() -> String:
	"""Returns combat layer state (backward compatible with is_attacking checks)."""
	if _combat_playback:
		var node: StringName = _combat_playback.get_current_node()
		return String(node)
	return _current_anim


func get_locomotion_current() -> String:
	"""Returns locomotion layer state."""
	if _locomotion_playback:
		return String(_locomotion_playback.get_current_node())
	return "idle"


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
