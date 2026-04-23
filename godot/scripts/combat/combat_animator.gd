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
	"attack_1": "sword and shield attack",
	"attack_2": "sword and shield attack (2)",
	"attack_3": "sword and shield attack (3)",
	"slash_2": "sword and shield slash (2)",
	"slash_4": "sword and shield slash (4)",
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
var _bone_prefix: String = "mixamorig_"

# One-shot animations (attacks, reactions) — used for routing travel() calls
const ONE_SHOT_SET := {
	"quick": true, "heavy": true, "medium": true, "defensive": true, "precise": true,
	"attack_1": true, "attack_2": true, "attack_3": true, "slash_2": true, "slash_4": true,
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
	# Clean up existing nodes immediately (not queue_free) to avoid name conflicts
	if _anim_tree:
		_anim_tree.name = "_old_tree"
		remove_child(_anim_tree)
		_anim_tree.free()
		_anim_tree = null
	if _anim_player:
		_anim_player.name = "_old_player"
		remove_child(_anim_player)
		_anim_player.free()
		_anim_player = null
	if _skeleton:
		_skeleton.name = "_old_skeleton"
		remove_child(_skeleton)
		_skeleton.free()
		_skeleton = null
	_locomotion_playback = null
	_combat_playback = null
	_hips_idx = -1
	_bone_prefix = "mixamorig_"
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
	if not _skeleton:
		# Some Mixamo FBX exports nest Skeleton3D under an intermediate node
		_skeleton = instance.find_child("Skeleton3D", true, false)
	if _skeleton:
		if _skeleton.get_parent():
			_skeleton.get_parent().remove_child(_skeleton)
		_skeleton.name = "Skeleton3D"
		add_child(_skeleton)

	var src_player: AnimationPlayer = instance.get_node_or_null("AnimationPlayer")
	if not src_player:
		src_player = instance.find_child("AnimationPlayer", true, false)
	if src_player:
		if src_player.get_parent():
			src_player.get_parent().remove_child(src_player)
		add_child(src_player)
		_anim_player = src_player
	else:
		_anim_player = AnimationPlayer.new()
		add_child(_anim_player)

	# Ensure AnimationPlayer resolves tracks from CombatAnimator (our parent of Skeleton3D)
	_anim_player.root_node = NodePath("..")

	if _skeleton:
		_hips_idx = _skeleton.find_bone("mixamorig_Hips")
		if _hips_idx < 0:
			# Detect alternate bone prefix (mixamorig1_, mixamorig5_, etc.)
			_bone_prefix = _detect_bone_prefix()
			if _bone_prefix != "mixamorig_":
				_hips_idx = _skeleton.find_bone(_bone_prefix + "Hips")
				print("CombatAnimator: detected bone prefix '%s' (hips_idx=%d)" % [_bone_prefix, _hips_idx])

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
				# Remap bone names if model uses different prefix
				_remap_animation_bones(animation)
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
	var locomotion := ["idle", "walk", "run", "walk_back", "strafe_left", "strafe_right", "turn", "block_idle"]
	var one_shots := ["quick", "heavy", "medium", "defensive", "precise",
					  "attack_1", "attack_2", "attack_3", "slash_2", "slash_4",
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

	# ── TimeScale for combat speed adjustment ──
	var time_scale := AnimationNodeTimeScale.new()

	# ── Assemble BlendTree ──
	blend_tree.add_node("locomotion_sm", loco_sm)
	blend_tree.add_node("combat_sm", combat_sm)
	blend_tree.add_node("combat_speed", time_scale)
	blend_tree.add_node("upper_blend", blend2)
	blend_tree.connect_node("combat_speed", 0, "combat_sm")
	blend_tree.connect_node("upper_blend", 0, "locomotion_sm")
	blend_tree.connect_node("upper_blend", 1, "combat_speed")
	blend_tree.connect_node("output", 0, "upper_blend")

	_anim_tree.tree_root = blend_tree
	_anim_tree.active = true
	add_child(_anim_tree)

	# Set blend amount to 1.0 (always blend upper body from combat layer)
	_anim_tree.set("parameters/upper_blend/blend_amount", 1.0)
	# Default combat speed scale
	_anim_tree.set("parameters/combat_speed/scale", 1.0)

	_locomotion_playback = _anim_tree.get("parameters/locomotion_sm/playback")
	_combat_playback = _anim_tree.get("parameters/combat_sm/playback")


func _get_upper_body_filter_paths() -> Array[NodePath]:
	"""Walk skeleton from mixamorig_Spine downward, return all bone NodePaths for filtering."""
	var paths: Array[NodePath] = []
	if not _skeleton:
		return paths
	var spine_idx: int = _skeleton.find_bone(_bone_prefix + "Spine")
	if spine_idx < 0:
		push_warning("CombatAnimator: %sSpine bone not found, upper body filter disabled" % _bone_prefix)
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


func set_combat_speed_scale(scale: float) -> void:
	"""Set playback speed for combat (upper body) layer only."""
	if _anim_tree:
		_anim_tree.set("parameters/combat_speed/scale", scale)


func get_combat_speed_scale() -> float:
	if _anim_tree:
		return _anim_tree.get("parameters/combat_speed/scale")
	return 1.0


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


func attach_weapon() -> void:
	"""Attach sword + shield to hand bones via BoneAttachment3D.
	Tries AI-generated GLB models first, falls back to procedural meshes."""
	if not _skeleton:
		return
	# Remove any previously attached weapons
	detach_weapon()
	# Sword on right hand
	var right_bone: String = _bone_prefix + "RightHand"
	var right_idx: int = _skeleton.find_bone(right_bone)
	if right_idx >= 0:
		var sword_attach := BoneAttachment3D.new()
		sword_attach.name = "SwordAttach"
		sword_attach.bone_name = right_bone
		_skeleton.add_child(sword_attach)
		var sword := _create_sword_mesh()
		sword_attach.add_child(sword)
		# Try to replace with AI-generated model
		_try_generate_weapon("single medieval longsword weapon, straight steel blade with crossguard and pommel, isolated object on white background",
			sword_attach, false)
	# Shield on left hand
	var left_bone: String = _bone_prefix + "LeftHand"
	var left_idx: int = _skeleton.find_bone(left_bone)
	if left_idx >= 0:
		var shield_attach := BoneAttachment3D.new()
		shield_attach.name = "ShieldAttach"
		shield_attach.bone_name = left_bone
		_skeleton.add_child(shield_attach)
		var shield := _create_shield_mesh()
		shield_attach.add_child(shield)
		# Try to replace with AI-generated model
		_try_generate_weapon("single medieval round wooden shield with iron rim and boss, isolated object on white background",
			shield_attach, true)
	print("CombatAnimator: weapon attached to skeleton")


func detach_weapon() -> void:
	"""Remove any dynamically attached weapons."""
	if not _skeleton:
		return
	var sword := _skeleton.get_node_or_null("SwordAttach")
	if sword:
		sword.free()
	var shield := _skeleton.get_node_or_null("ShieldAttach")
	if shield:
		shield.free()


func _create_sword_mesh() -> Node3D:
	# Blade perpendicular to forearm, extending forward from grip
	var pivot := Node3D.new()
	pivot.name = "SwordPivot"
	pivot.rotation_degrees = Vector3(0, 0, -90)
	# Blade
	var blade_inst := MeshInstance3D.new()
	blade_inst.name = "Blade"
	var blade := BoxMesh.new()
	blade.size = Vector3(0.06, 0.8, 0.02)
	blade_inst.mesh = blade
	blade_inst.position = Vector3(0, 0.4, 0)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.8, 0.8, 0.85)
	mat.metallic = 0.9
	mat.roughness = 0.2
	blade_inst.material_override = mat
	pivot.add_child(blade_inst)
	# Crossguard
	var guard_inst := MeshInstance3D.new()
	guard_inst.name = "Guard"
	var guard := BoxMesh.new()
	guard.size = Vector3(0.15, 0.03, 0.03)
	guard_inst.mesh = guard
	guard_inst.position = Vector3(0, -0.02, 0)
	var guard_mat := StandardMaterial3D.new()
	guard_mat.albedo_color = Color(0.45, 0.35, 0.15)
	guard_mat.metallic = 0.7
	guard_mat.roughness = 0.4
	guard_inst.material_override = guard_mat
	pivot.add_child(guard_inst)
	# Handle
	var handle_inst := MeshInstance3D.new()
	handle_inst.name = "Handle"
	var handle := CylinderMesh.new()
	handle.height = 0.12
	handle.top_radius = 0.015
	handle.bottom_radius = 0.015
	handle_inst.mesh = handle
	handle_inst.position = Vector3(0, -0.1, 0)
	var handle_mat := StandardMaterial3D.new()
	handle_mat.albedo_color = Color(0.3, 0.2, 0.1)
	handle_mat.roughness = 0.8
	handle_inst.material_override = handle_mat
	pivot.add_child(handle_inst)
	return pivot


func _create_shield_mesh() -> Node3D:
	var pivot := Node3D.new()
	pivot.name = "ShieldPivot"
	pivot.rotation_degrees = Vector3(0, 0, -90)
	# Shield body
	var body_inst := MeshInstance3D.new()
	body_inst.name = "ShieldBody"
	var shield := BoxMesh.new()
	shield.size = Vector3(0.35, 0.45, 0.03)
	body_inst.mesh = shield
	body_inst.position = Vector3(0, 0.1, -0.08)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.35, 0.25, 0.12)
	mat.metallic = 0.3
	mat.roughness = 0.6
	body_inst.material_override = mat
	pivot.add_child(body_inst)
	# Metal rim
	var rim_inst := MeshInstance3D.new()
	rim_inst.name = "Rim"
	var rim := BoxMesh.new()
	rim.size = Vector3(0.38, 0.48, 0.015)
	rim_inst.mesh = rim
	rim_inst.position = Vector3(0, 0.1, -0.07)
	var rim_mat := StandardMaterial3D.new()
	rim_mat.albedo_color = Color(0.5, 0.45, 0.35)
	rim_mat.metallic = 0.8
	rim_mat.roughness = 0.4
	rim_inst.material_override = rim_mat
	pivot.add_child(rim_inst)
	return pivot


func lock_in_place() -> void:
	"""Already locked — all animations are in place by default."""
	pass


func _get_anim_count() -> int:
	if _anim_player and _anim_player.has_animation_library(""):
		return _anim_player.get_animation_library("").get_animation_list().size()
	return 0


func _try_generate_weapon(prompt: String, attach_node: BoneAttachment3D,
		is_shield: bool) -> void:
	"""Try to generate a GLB weapon model via AI. On success, replaces the procedural mesh.
	Uses vision-guided orientation when available; falls back to bbox heuristic."""
	var ai_client: Node = get_node_or_null("/root/AIClient")
	if not ai_client or not ai_client.has_method("generate_model"):
		return
	var hash_key: String = str(prompt.hash())
	ai_client.generate_model(prompt, func(glb_path: String):
		if glb_path == "" or not is_instance_valid(attach_node):
			return
		var mesh_node: MeshInstance3D = _load_glb_mesh(glb_path)
		if not mesh_node or not mesh_node.mesh:
			return
		# Remove the procedural mesh
		for child in attach_node.get_children():
			child.queue_free()
		var pivot := Node3D.new()
		pivot.name = "WeaponPivot"
		pivot.add_child(mesh_node)
		attach_node.add_child(pivot)
		_orient_weapon_async(mesh_node, pivot, is_shield, hash_key)
	, "normal")


func _orient_weapon_async(mesh_node: MeshInstance3D, pivot: Node3D,
		is_shield: bool, hash_key: String) -> void:
	"""Orient a weapon mesh: try cache → vision → bbox heuristic."""
	# 1. Cache hit?
	var cached: Dictionary = _load_cached_weapon_xform(hash_key)
	if not cached.is_empty():
		_apply_cached_weapon_xform(mesh_node, pivot, cached)
		print("CombatAnimator: applied cached vision transform for %s" % hash_key)
		return

	# 2. Vision pipeline: render 3 views, send to Claude, build transform
	var settings: Node = get_node_or_null("/root/ServiceSettings")
	var enabled := true
	if settings:
		enabled = settings.is_enabled("ai_vision")

	if enabled:
		var success := await _orient_with_vision(mesh_node, pivot, is_shield, hash_key)
		if success:
			print("CombatAnimator: vision-oriented weapon (%s)" % hash_key)
			return

	# 3. Fallback: bbox heuristic
	print("CombatAnimator: falling back to bbox heuristic for %s" % hash_key)
	_auto_orient_weapon(mesh_node, pivot, is_shield)


func _orient_with_vision(mesh_node: MeshInstance3D, pivot: Node3D,
		is_shield: bool, hash_key: String) -> bool:
	"""Render mesh from 3 angles, ask vision LLM for orientation, apply transform.
	Returns true on success, false if vision was unavailable or returned bad data."""
	if not is_instance_valid(self) or not is_inside_tree():
		push_warning("CombatAnimator: cannot run vision pipeline (invalid instance)")
		return false

	var weapon_type: String = "shield" if is_shield else "sword"
	print("CombatAnimator: starting vision orient for %s (hash=%s)" % [weapon_type, hash_key])

	# Render the 3 angles offscreen
	var renderer := preload("res://scripts/combat/weapon_vision_renderer.gd")
	var image_paths: Array[String] = await renderer.render_angles(mesh_node, hash_key, self)
	if image_paths.is_empty():
		push_warning("CombatAnimator: WeaponVisionRenderer produced no images — vision aborted")
		return false

	# Call vision API
	var ai_client: Node = get_node_or_null("/root/AIClient")
	if not ai_client or not ai_client.has_method("analyze_weapon"):
		push_warning("CombatAnimator: AIClient.analyze_weapon not available")
		return false

	var done := false
	var result: Dictionary = {}
	ai_client.analyze_weapon(image_paths, weapon_type, "weapon_orient",
		func(r: Dictionary):
			result = r
			done = true
	)

	# Wait for callback. The bridge fails fast (~1s) when no MCP listener,
	# so the typical wait is either ~1s (no listener) or ~5-30s (Claude analyzing).
	var started: int = Time.get_ticks_msec()
	while not done and Time.get_ticks_msec() - started < 240000:
		await get_tree().process_frame

	var elapsed: float = (Time.get_ticks_msec() - started) / 1000.0
	if not done:
		push_warning("CombatAnimator: vision request timed out after %.1fs" % elapsed)
		return false
	if result.is_empty():
		push_warning("CombatAnimator: vision returned empty result after %.1fs — " % elapsed +
			"check AI server logs for details (likely no MCP listener — start Claude Code from project root)")
		return false
	print("CombatAnimator: vision result received in %.1fs (confidence=%.2f, type=%s)" % [
		elapsed, float(result.get("confidence", 0)), str(result.get("weapon_type", "?"))])

	# Build and apply the transform from the semantic vectors
	var aabb: AABB = mesh_node.mesh.get_aabb()
	_build_pivot_transform_from_vision(result, aabb, mesh_node, pivot, is_shield)

	# Cache the result
	_save_cached_weapon_xform(hash_key, pivot.transform, mesh_node.transform,
		float(result.get("confidence", 0.0)),
		String(result.get("notes", "")),
		float(result.get("grip_length_normalized", 0.15)))
	return true


func _build_pivot_transform_from_vision(vision: Dictionary, aabb: AABB,
		mesh_inst: MeshInstance3D, pivot: Node3D, is_shield: bool) -> void:
	"""Convert semantic vectors (grip + blade dir + up dir) into a transform that
	aligns the weapon with the canonical Mixamo hand bone frame."""
	var grip_n: Vector3 = _array_to_vec3(vision.get("grip_point_normalized", [0.5, 0.5, 0.5]))
	var blade_dir: Vector3 = _array_to_vec3(vision.get("blade_direction", [0, 1, 0])).normalized()
	var up_dir: Vector3 = _array_to_vec3(vision.get("up_direction", [1, 0, 0])).normalized()

	# Convert normalized grip to mesh-local coords
	var bbox_min: Vector3 = aabb.position
	var bbox_size: Vector3 = aabb.size
	var grip_local: Vector3 = bbox_min + Vector3(
		grip_n.x * bbox_size.x,
		grip_n.y * bbox_size.y,
		grip_n.z * bbox_size.z,
	)

	# Target frame in the Mixamo right-hand bone space:
	# - Sword/blade weapon: blade extends along -X (out of the palm), back of blade along +Z
	# - Shield: flat face along -Z (away from forearm), top along +Y
	var target_forward: Vector3
	var target_up: Vector3
	if is_shield:
		target_forward = Vector3(0, 0, -1)
		target_up = Vector3(0, 1, 0)
	else:
		target_forward = Vector3(-1, 0, 0)
		target_up = Vector3(0, 0, 1)

	# Build orthonormal source frame from vision vectors
	var src_x := blade_dir
	var src_y := up_dir - src_x * up_dir.dot(src_x)
	if src_y.length() < 0.01:
		# Degenerate; pick an arbitrary perpendicular
		src_y = src_x.cross(Vector3(0, 0, 1))
		if src_y.length() < 0.01:
			src_y = src_x.cross(Vector3(0, 1, 0))
	src_y = src_y.normalized()
	var src_z := src_x.cross(src_y).normalized()

	# Build target orthonormal frame
	var dst_x := target_forward
	var dst_y := target_up
	var dst_z := dst_x.cross(dst_y).normalized()

	# Source basis as columns: maps (1,0,0) -> src_x, (0,1,0) -> src_y, (0,0,1) -> src_z
	var src_basis := Basis(src_x, src_y, src_z).transposed()
	var dst_basis := Basis(dst_x, dst_y, dst_z).transposed()
	var rot_basis: Basis = dst_basis * src_basis.inverse()

	# Scale the weapon to a hand-appropriate size
	var max_extent: float = max(bbox_size.x, max(bbox_size.y, bbox_size.z))
	var target_len: float = 0.40 if is_shield else 0.70
	var scale_f: float = target_len / max(max_extent, 0.001)

	# Apply: pivot does rotation+scale, then translates so grip lands at origin
	var scaled_basis: Basis = rot_basis.scaled(Vector3(scale_f, scale_f, scale_f))
	var grip_in_pivot: Vector3 = scaled_basis * grip_local
	pivot.transform = Transform3D(scaled_basis, -grip_in_pivot)

	# Reset mesh transform — pivot does all the work
	mesh_inst.transform = Transform3D.IDENTITY


func _array_to_vec3(arr) -> Vector3:
	if arr is Array and arr.size() >= 3:
		return Vector3(float(arr[0]), float(arr[1]), float(arr[2]))
	return Vector3.ZERO


# ----------------------------------------------------------------------
# Cache helpers for vision-derived weapon transforms
# ----------------------------------------------------------------------

const WEAPON_XFORM_CACHE_DIR := "user://cache/weapon_xforms"
const WEAPON_XFORM_SCHEMA_VERSION := 1


func _load_cached_weapon_xform(hash_key: String) -> Dictionary:
	var path := "%s/%s.json" % [WEAPON_XFORM_CACHE_DIR, hash_key]
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if not f:
		return {}
	var text: String = f.get_as_text()
	f.close()
	var data: Variant = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		return {}
	if int(data.get("version", 0)) != WEAPON_XFORM_SCHEMA_VERSION:
		return {}
	return data


func _save_cached_weapon_xform(hash_key: String, pivot_xform: Transform3D,
		mesh_xform: Transform3D, confidence: float, notes: String,
		grip_length: float) -> void:
	DirAccess.make_dir_recursive_absolute(WEAPON_XFORM_CACHE_DIR)
	var b: Basis = pivot_xform.basis
	var data := {
		"version": WEAPON_XFORM_SCHEMA_VERSION,
		"schema": "vision-weapon-orient",
		"prompt_hash": hash_key,
		"pivot_basis_x": [b.x.x, b.x.y, b.x.z],
		"pivot_basis_y": [b.y.x, b.y.y, b.y.z],
		"pivot_basis_z": [b.z.x, b.z.y, b.z.z],
		"pivot_origin": [pivot_xform.origin.x, pivot_xform.origin.y, pivot_xform.origin.z],
		"mesh_origin": [mesh_xform.origin.x, mesh_xform.origin.y, mesh_xform.origin.z],
		"confidence": confidence,
		"grip_length_normalized": grip_length,
		"notes": notes,
		"created_at": Time.get_datetime_string_from_system(),
	}
	var path := "%s/%s.json" % [WEAPON_XFORM_CACHE_DIR, hash_key]
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data, "  "))
		f.close()
		print("CombatAnimator: cached weapon transform at %s" % path)


func _apply_cached_weapon_xform(mesh_inst: MeshInstance3D, pivot: Node3D,
		cached: Dictionary) -> void:
	var bx: Vector3 = _array_to_vec3(cached.get("pivot_basis_x", [1, 0, 0]))
	var by: Vector3 = _array_to_vec3(cached.get("pivot_basis_y", [0, 1, 0]))
	var bz: Vector3 = _array_to_vec3(cached.get("pivot_basis_z", [0, 0, 1]))
	var origin: Vector3 = _array_to_vec3(cached.get("pivot_origin", [0, 0, 0]))
	pivot.transform = Transform3D(Basis(bx, by, bz), origin)
	mesh_inst.transform = Transform3D.IDENTITY


func _load_glb_mesh(glb_path: String) -> MeshInstance3D:
	"""Load a GLB file and return the first MeshInstance3D found.
	Bakes parent transforms into the mesh node so no hierarchy is lost."""
	var file := FileAccess.open(glb_path, FileAccess.READ)
	if not file:
		return null
	var glb_data: PackedByteArray = file.get_buffer(file.get_length())
	file.close()
	var gltf_doc := GLTFDocument.new()
	var gltf_state := GLTFState.new()
	var err := gltf_doc.append_from_buffer(glb_data, "", gltf_state)
	if err != OK:
		push_warning("CombatAnimator: failed to parse GLB: %d" % err)
		return null
	var scene: Node = gltf_doc.generate_scene(gltf_state)
	if not scene:
		return null
	var mesh_inst: MeshInstance3D = _find_mesh_instance(scene)
	if mesh_inst:
		# Walk up the hierarchy to bake all parent transforms into the mesh node
		var baked_xform := mesh_inst.transform
		var node: Node = mesh_inst.get_parent()
		while node and node != scene:
			if node is Node3D:
				baked_xform = node.transform * baked_xform
			node = node.get_parent()
		if scene is Node3D:
			baked_xform = scene.transform * baked_xform
		if mesh_inst.get_parent():
			mesh_inst.get_parent().remove_child(mesh_inst)
		mesh_inst.transform = baked_xform
		var s: Vector3 = baked_xform.basis.get_scale()
		print("CombatAnimator: GLB baked scale=(%.1f, %.1f, %.1f)" % [s.x, s.y, s.z])
		scene.queue_free()
		return mesh_inst
	scene.queue_free()
	return null


func _find_mesh_instance(node: Node) -> MeshInstance3D:
	if node is MeshInstance3D:
		return node
	for child in node.get_children():
		var found: MeshInstance3D = _find_mesh_instance(child)
		if found:
			return found
	return null


func _auto_orient_weapon(mesh_inst: MeshInstance3D, pivot: Node3D, is_shield: bool) -> void:
	"""Analyze mesh geometry to auto-orient a weapon. Finds the longest axis (blade),
	identifies the grip end (thinnest cross-section), and orients for the hand bone.
	For shields, orients the flat face outward."""
	var mesh: Mesh = mesh_inst.mesh
	if not mesh or mesh.get_surface_count() == 0:
		pivot.rotation_degrees = Vector3(0, 0, -90)
		return

	# Extract all vertices from the mesh
	var vertices: PackedVector3Array = PackedVector3Array()
	for surf_idx in range(mesh.get_surface_count()):
		var arrays: Array = mesh.surface_get_arrays(surf_idx)
		if arrays.size() > 0 and arrays[Mesh.ARRAY_VERTEX] is PackedVector3Array:
			vertices.append_array(arrays[Mesh.ARRAY_VERTEX])

	if vertices.size() < 10:
		pivot.rotation_degrees = Vector3(0, 0, -90)
		return

	# Find bounding box
	var bb_min := vertices[0]
	var bb_max := vertices[0]
	for v in vertices:
		bb_min.x = minf(bb_min.x, v.x)
		bb_min.y = minf(bb_min.y, v.y)
		bb_min.z = minf(bb_min.z, v.z)
		bb_max.x = maxf(bb_max.x, v.x)
		bb_max.y = maxf(bb_max.y, v.y)
		bb_max.z = maxf(bb_max.z, v.z)

	var bb_size: Vector3 = bb_max - bb_min
	var bb_center: Vector3 = (bb_min + bb_max) * 0.5

	if is_shield:
		_orient_shield(mesh_inst, pivot, bb_size, bb_center)
	else:
		_orient_blade_weapon(mesh_inst, pivot, vertices, bb_size, bb_center)


func _orient_blade_weapon(mesh_inst: MeshInstance3D, pivot: Node3D,
		vertices: PackedVector3Array, bb_size: Vector3, bb_center: Vector3) -> void:
	"""Orient a bladed weapon (sword/axe/mace). Finds the long axis as blade direction,
	then identifies the grip end as the thinner half."""
	# Find the longest axis = blade direction
	var longest_axis: int = 0  # 0=X, 1=Y, 2=Z
	var max_extent: float = bb_size.x
	if bb_size.y > max_extent:
		longest_axis = 1
		max_extent = bb_size.y
	if bb_size.z > max_extent:
		longest_axis = 2
		max_extent = bb_size.z

	# Split vertices along the longest axis at the center to find grip vs blade end
	# The grip end has fewer/tighter vertices (thinner cross-section)
	var center_val: float = bb_center[longest_axis]
	var low_spread: float = 0.0
	var high_spread: float = 0.0
	var low_count: int = 0
	var high_count: int = 0

	# Measure average cross-section spread in each half
	for v in vertices:
		var cross_dist: float = 0.0
		match longest_axis:
			0: cross_dist = absf(v.y - bb_center.y) + absf(v.z - bb_center.z)
			1: cross_dist = absf(v.x - bb_center.x) + absf(v.z - bb_center.z)
			2: cross_dist = absf(v.x - bb_center.x) + absf(v.y - bb_center.y)
		if v[longest_axis] < center_val:
			low_spread += cross_dist
			low_count += 1
		else:
			high_spread += cross_dist
			high_count += 1

	var avg_low: float = low_spread / maxf(low_count, 1)
	var avg_high: float = high_spread / maxf(high_count, 1)

	# The grip end is the thinner half (lower average cross-section spread)
	# grip_direction: -1 means grip is on the low side, +1 means grip is on the high side
	var grip_on_low: bool = avg_low < avg_high

	# Scale the weapon to a reasonable size for a hand weapon
	var target_length: float = 0.70
	var scale_factor: float = target_length / maxf(max_extent, 0.01)
	mesh_inst.scale = Vector3(scale_factor, scale_factor, scale_factor)

	# Position: offset so the grip end aligns with the attachment point (hand bone origin)
	# The grip is at one end of the bounding box along the longest axis
	var grip_offset: float
	if grip_on_low:
		grip_offset = -bb_center[longest_axis] + bb_size[longest_axis] * 0.4
	else:
		grip_offset = -bb_center[longest_axis] - bb_size[longest_axis] * 0.4

	var pos_offset := Vector3.ZERO
	pos_offset[longest_axis] = grip_offset
	mesh_inst.position = pos_offset * scale_factor

	# Rotate pivot so the blade axis aligns perpendicular to the forearm
	# The hand bone Y axis points along the forearm, we want the blade
	# to extend perpendicular (along the X axis after rotation)
	match longest_axis:
		0:  # Blade along mesh X → rotate so it goes along bone -X (perpendicular to forearm)
			pivot.rotation_degrees = Vector3(0, 0, -90)
		1:  # Blade along mesh Y → already along bone Y, rotate to be perpendicular
			pivot.rotation_degrees = Vector3(0, 0, -90)
		2:  # Blade along mesh Z → rotate so it goes perpendicular
			pivot.rotation_degrees = Vector3(90, 0, -90)

	print("CombatAnimator: auto-orient blade: axis=%d, scale=%.2f, grip_on_low=%s, bb_size=%s, verts=%d" % [
		longest_axis, scale_factor, str(grip_on_low), str(bb_size), vertices.size()])


func _orient_shield(mesh_inst: MeshInstance3D, pivot: Node3D,
		bb_size: Vector3, bb_center: Vector3) -> void:
	"""Orient a shield. Finds the thinnest axis (flat face) and orients it outward."""
	# Find the thinnest axis = the flat/face direction of the shield
	var thinnest_axis: int = 0
	var min_extent: float = bb_size.x
	if bb_size.y < min_extent:
		thinnest_axis = 1
		min_extent = bb_size.y
	if bb_size.z < min_extent:
		thinnest_axis = 2
		min_extent = bb_size.z

	# Scale to reasonable shield size
	var widest: float = maxf(bb_size.x, maxf(bb_size.y, bb_size.z))
	var scale_factor: float = 0.40 / maxf(widest, 0.01)
	mesh_inst.scale = Vector3(scale_factor, scale_factor, scale_factor)
	mesh_inst.position = -bb_center * scale_factor

	# Rotate so flat face points outward from the forearm (along bone -Z)
	match thinnest_axis:
		0: pivot.rotation_degrees = Vector3(0, 0, -90)
		1: pivot.rotation_degrees = Vector3(0, 0, -90)
		2: pivot.rotation_degrees = Vector3(0, 0, -90)

	print("CombatAnimator: auto-orient shield: thin_axis=%d, scale=%.2f" % [thinnest_axis, scale_factor])


func _detect_bone_prefix() -> String:
	"""Detect the bone naming prefix used by this skeleton (mixamorig_, mixamorig1_, etc.)."""
	if not _skeleton:
		return "mixamorig_"
	for i in range(_skeleton.get_bone_count()):
		var bone_name: String = _skeleton.get_bone_name(i)
		if "Hips" in bone_name:
			return bone_name.replace("Hips", "")
	return "mixamorig_"


func _remap_animation_bones(anim: Animation) -> void:
	"""Remap animation track paths from mixamorig_ to the model's bone prefix."""
	if _bone_prefix == "mixamorig_":
		return
	for i in range(anim.get_track_count()):
		var path: NodePath = anim.track_get_path(i)
		var path_str: String = str(path)
		if "mixamorig_" in path_str:
			var new_path_str: String = path_str.replace("mixamorig_", _bone_prefix)
			anim.track_set_path(i, NodePath(new_path_str))


func _clear_owner_recursive(node: Node) -> void:
	node.owner = null
	for child in node.get_children():
		_clear_owner_recursive(child)
