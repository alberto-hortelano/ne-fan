## Animation state machine — Souls-Like pattern with upper/lower body blending.
## Locomotion always drives lower body; attacks only affect upper body.
## Death/hit/jump are full-body. Detects movement by position delta.
class_name CombatAnimationSync
extends Node

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

var _animator: Node  # CombatAnimator
var _combatant: Node  # Combatant
var _sprint_speed := 3.8
var _animation_intrinsics: Dictionary = {}
var _attack_types: Dictionary = {}
var _weapons: Dictionary = {}

# State
var is_attacking := false
var is_rolling := false
var is_dead := false

# Movement detection (works for enemies without velocity)
var _prev_pos := Vector3.ZERO
var _movement_speed := 0.0

const ONE_SHOT_ANIMS := [
	"quick", "heavy", "medium", "defensive", "precise",
	"attack_1", "attack_2", "attack_3", "slash_2", "slash_4",
	"kick", "hit", "death", "jump", "casting", "power_up",
	"draw_sword_1", "draw_sword_2",
]

# These animations block ALL movement (full-body override)
const MOVEMENT_BLOCKING_ANIMS := ["death", "hit", "power_up"]


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")
	_animator = get_parent().get_node_or_null("CombatAnimator")
	var config: Dictionary = CombatDataRef.load_config()
	var pcfg: Dictionary = config.get("player", {})
	_sprint_speed = pcfg.get("sprint_speed", 3.8)
	_attack_types = config.get("attack_types", {})
	_weapons = config.get("weapons", {})
	_load_animation_intrinsics()

	if _combatant:
		_combatant.damage_received.connect(_on_damage_received)
		_combatant.died.connect(_on_died)
		_combatant.attack_started.connect(_on_attack_started)

	var parent := get_parent()
	if parent is Node3D:
		_prev_pos = parent.global_position


func _process(delta: float) -> void:
	if not _combatant or not _animator or is_dead:
		return

	# Calculate movement speed from position delta (works for enemies)
	var parent := get_parent()
	if parent is Node3D:
		var current_pos: Vector3 = parent.global_position
		_movement_speed = current_pos.distance_to(_prev_pos) / maxf(delta, 0.001)
		_prev_pos = current_pos

	var combat_current: String = _animator.get_current()

	# Update is_attacking based on combat layer animation
	if combat_current in ONE_SHOT_ANIMS:
		is_attacking = true
	else:
		if is_attacking:
			# Attack just ended — reset combat speed scale
			_animator.set_combat_speed_scale(1.0)
		is_attacking = false
		is_rolling = false

	# Locomotion always runs (drives lower body independently)
	_update_locomotion()


func _update_locomotion() -> void:
	# Use position-based speed (works for both player and enemy)
	var speed: float = _movement_speed

	# For CharacterBody3D (player), also check velocity
	var parent := get_parent()
	if parent is CharacterBody3D:
		speed = maxf(speed, Vector2(parent.velocity.x, parent.velocity.z).length())

	# Check player input direction for directional animations
	var turning := false
	var local_input := Vector2.ZERO
	if parent.has_method("is_turning"):
		turning = parent.is_turning()
	if parent.has_method("get_local_input"):
		local_input = parent.get_local_input()

	# Determine target locomotion animation
	var target_anim := "idle"
	var loco_current: String = _animator.get_locomotion_current()

	if speed > _sprint_speed * 0.7:
		target_anim = "run"
	elif speed > 0.3:
		target_anim = "walk"
		if local_input.y > 0.5:
			target_anim = "walk_back"
		elif absf(local_input.x) > absf(local_input.y):
			target_anim = "strafe_right" if local_input.x < 0 else "strafe_left"
	elif turning:
		target_anim = "turn"

	# Always drive locomotion layer (lower body)
	if loco_current != target_anim:
		_animator.travel_locomotion(target_anim)

	# When not attacking, also sync combat layer to match locomotion (upper body follows)
	if not is_attacking:
		var combat_current: String = _animator.get_current()
		if combat_current != target_anim:
			_animator.travel_combat(target_anim)


# ─── Public API ───


func attack(type: String) -> void:
	if not _animator or is_dead or is_attacking:
		return
	# Select best animation and speed for current parameters
	var match_result: Dictionary = _select_best_animation(type)
	var anim_key: String = match_result.get("key", type)
	var speed: float = match_result.get("speed_scale", 1.0)
	_animator.set_combat_speed_scale(speed)
	# Only upper body plays attack — legs keep locomotion
	_animator.travel_combat(anim_key)
	is_attacking = true


func roll() -> void:
	if not _animator or is_dead or is_attacking:
		return
	_animator.start_combat("kick")
	is_rolling = true
	is_attacking = true


func jump() -> void:
	if not _animator or is_dead or is_attacking:
		return
	# Jump is full-body
	_animator.travel_full_body("jump")
	is_attacking = true


func request_action(action: String) -> void:
	if action == "jump":
		jump()
	elif action in ONE_SHOT_ANIMS:
		attack(action)


func _on_attack_started(type_id: String) -> void:
	if not _animator or is_dead:
		return
	if not is_attacking:
		# Only upper body plays attack
		_animator.travel_combat(type_id)
		is_attacking = true


func _on_damage_received(amount: float, _from: Node) -> void:
	if not _animator or is_dead:
		return
	# Hit reaction — full body interrupt
	_animator.start_full_body("hit")
	is_attacking = true
	# 3D damage number
	_spawn_damage_number(amount)
	# Hit flash
	_flash_hit()


func _on_died() -> void:
	if not _animator:
		return
	is_dead = true
	# Death is full body
	_animator.start_full_body("death")
	is_attacking = true
	# Disable collision and fade after death animation
	var tween := create_tween()
	tween.tween_interval(2.5)
	tween.tween_callback(_cleanup_dead)


func _cleanup_dead() -> void:
	var parent := get_parent()
	var col: CollisionShape3D = parent.get_node_or_null("CollisionShape3D")
	if col:
		col.disabled = true
	var anim: Node3D = parent.get_node_or_null("CombatAnimator")
	if anim:
		anim.visible = false
	# Hide HP label
	var hp_label: Node = parent.get_node_or_null("HPLabel")
	if hp_label:
		hp_label.visible = false


func _spawn_damage_number(amount: float) -> void:
	var label := Label3D.new()
	label.text = "%.0f" % absf(amount)
	label.font_size = 64
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.position = Vector3(randf_range(-0.3, 0.3), 2.2, 0)
	label.modulate = Color(1, 0.3, 0.1)
	label.outline_size = 8
	get_parent().add_child(label)
	var tween := label.create_tween()
	tween.set_parallel(true)
	tween.tween_property(label, "position:y", label.position.y + 1.5, 0.8)
	tween.tween_property(label, "modulate:a", 0.0, 0.6).set_delay(0.2)
	tween.set_parallel(false)
	tween.tween_callback(label.queue_free)


func _flash_hit() -> void:
	var anim: Node = get_parent().get_node_or_null("CombatAnimator")
	if not anim:
		return
	var skeleton: Node = anim.get_node_or_null("Skeleton3D")
	if not skeleton:
		return
	for child in skeleton.get_children():
		if child is MeshInstance3D:
			for surf_idx in range(child.get_surface_override_material_count()):
				var mat: Material = child.get_active_material(surf_idx)
				if mat is StandardMaterial3D:
					var orig: Color = mat.albedo_color
					mat.albedo_color = Color(1, 0.2, 0.2)
					var tw := create_tween()
					tw.tween_property(mat, "albedo_color", orig, 0.2)
			break  # Only flash first mesh


func reset() -> void:
	is_dead = false
	is_attacking = false
	is_rolling = false
	_movement_speed = 0.0
	if _animator:
		_animator.travel_full_body("idle")
	# Re-enable collision and visibility after death
	var parent := get_parent()
	var col: CollisionShape3D = parent.get_node_or_null("CollisionShape3D")
	if col:
		col.disabled = false
	var anim: Node3D = parent.get_node_or_null("CombatAnimator")
	if anim:
		anim.visible = true


func get_current_state() -> String:
	if _animator:
		return _animator.get_current()
	return "idle"


func is_interruptible() -> bool:
	if is_dead:
		return false
	# Attacks no longer block movement (upper/lower body split).
	# Only truly immobilizing animations block movement.
	var combat_current: String = _animator.get_current() if _animator else ""
	return combat_current not in MOVEMENT_BLOCKING_ANIMS


func _load_animation_intrinsics() -> void:
	var path := "res://data/animation_intrinsics.json"
	var file := FileAccess.open(path, FileAccess.READ)
	if not file:
		return
	var data = JSON.parse_string(file.get_as_text())
	file.close()
	if data is Dictionary and data.has("attack_animations"):
		_animation_intrinsics = data["attack_animations"]
		print("CombatAnimationSync: loaded %d animation intrinsics" % _animation_intrinsics.size())


func _select_best_animation(attack_type: String) -> Dictionary:
	"""Select best animation for given attack parameters. Returns {key, speed_scale}."""
	if _animation_intrinsics.is_empty() or _attack_types.is_empty():
		return {"key": attack_type, "speed_scale": 1.0}

	# Get effective params for this attack type + current weapon
	var weapon_id: String = _combatant.weapon_id if _combatant else "unarmed"
	var weapon_data: Dictionary = _weapons.get(weapon_id, {})
	var params: Dictionary = CombatDataRef.get_effective_params(attack_type, _attack_types, weapon_data)
	if params.is_empty():
		return {"key": attack_type, "speed_scale": 1.0}

	var optimal_dist: float = params.get("optimal_distance", 1.5)
	var area_radius: float = params.get("area_radius", 1.2)
	var wind_up: float = params.get("wind_up_time", 0.3)

	# Expected sweep angle from area_radius at optimal_distance
	var expected_sweep: float = rad_to_deg(2.0 * atan(area_radius / maxf(optimal_dist, 0.01)))

	var best_key: String = attack_type
	var best_speed: float = 1.0
	var best_score: float = -1.0

	for anim_key in _animation_intrinsics:
		var anim: Dictionary = _animation_intrinsics[anim_key]
		if anim.get("has_steps", false):
			continue
		if anim.get("style", "") == "kick":
			continue

		var reach: float = anim.get("visual_reach_m", 0.5)
		var sweep: float = anim.get("visual_sweep_deg", 90.0)
		var duration: float = anim.get("duration", 1.0)
		var impact_frac: float = anim.get("impact_fraction", 0.3)

		# Speed scale: align impact with wind_up_time
		var impact_time: float = duration * impact_frac
		var speed_scale: float = impact_time / maxf(wind_up, 0.01)

		# Score: reach fit (40%), arc fit (30%), speed fit (30%)
		var reach_score: float = maxf(0.0, 1.0 - absf(reach - optimal_dist) / maxf(reach, optimal_dist))
		var arc_score: float = maxf(0.0, 1.0 - absf(sweep - expected_sweep) / maxf(sweep, expected_sweep))

		# Speed fit: prefer 1.0x, penalize outside [0.6, 1.8]
		var speed_score: float = 0.0
		if speed_scale >= 0.6 and speed_scale <= 1.8:
			speed_score = maxf(0.0, 1.0 - absf(1.0 - speed_scale) * 0.3)
		elif speed_scale < 0.6:
			speed_score = maxf(0.0, speed_scale / 0.6 - 0.5)
		else:
			speed_score = maxf(0.0, 1.0 - (speed_scale - 1.8) * 0.5)

		var total: float = reach_score * 0.4 + arc_score * 0.3 + speed_score * 0.3

		if total > best_score:
			best_score = total
			best_key = anim_key
			best_speed = clampf(speed_scale, 0.6, 1.8)

	return {"key": best_key, "speed_scale": best_speed}
