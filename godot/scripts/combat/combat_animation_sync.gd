## Animation state machine — Souls-Like pattern.
## Handles locomotion, attacks, hits, death for both player and enemies.
## Detects movement by position delta (works for StaticBody3D enemies too).
class_name CombatAnimationSync
extends Node

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

var _animator: Node  # CombatAnimator
var _combatant: Node  # Combatant
var _sprint_speed := 3.8

# State
var is_attacking := false
var is_rolling := false
var is_dead := false

# Movement detection (works for enemies without velocity)
var _prev_pos := Vector3.ZERO
var _movement_speed := 0.0

const ONE_SHOT_ANIMS := [
	"quick", "heavy", "medium", "defensive", "precise",
	"kick", "hit", "death", "jump", "casting", "power_up",
	"draw_sword_1", "draw_sword_2",
]


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")
	_animator = get_parent().get_node_or_null("CombatAnimator")
	var config: Dictionary = CombatDataRef.load_config()
	var pcfg: Dictionary = config.get("player", {})
	_sprint_speed = pcfg.get("sprint_speed", 3.8)

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

	var current: String = _animator.get_current()

	# Update is_attacking based on current animation
	if current in ONE_SHOT_ANIMS:
		is_attacking = true
	else:
		is_attacking = false
		is_rolling = false

	# Locomotion (only when not in a one-shot)
	if not is_attacking:
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

	var current: String = _animator.get_current()
	if speed > _sprint_speed * 0.7:
		if current != "run":
			_animator.travel("run")
	elif speed > 0.3:
		# Pick directional animation based on local input
		var target_anim := "walk"
		if local_input.y > 0.5:
			target_anim = "walk_back"
		elif absf(local_input.x) > absf(local_input.y):
			target_anim = "strafe_right" if local_input.x < 0 else "strafe_left"
		if current != target_anim:
			_animator.travel(target_anim)
	elif turning:
		if current != "turn":
			_animator.travel("turn")
	else:
		if current != "idle":
			_animator.travel("idle")


# ─── Public API ───


func attack(type: String) -> void:
	if not _animator or is_dead or is_attacking:
		return
	_animator.travel(type)
	is_attacking = true


func roll() -> void:
	if not _animator or is_dead or is_attacking:
		return
	_animator.start("kick")
	is_rolling = true
	is_attacking = true


func jump() -> void:
	if not _animator or is_dead or is_attacking:
		return
	_animator.travel("jump")
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
		_animator.travel(type_id)
		is_attacking = true


func _on_damage_received(amount: float, _from: Node) -> void:
	if not _animator or is_dead:
		return
	# Hit reaction — interrupt current action
	_animator.start("hit")
	is_attacking = true
	# 3D damage number
	_spawn_damage_number(amount)
	# Hit flash
	_flash_hit()


func _on_died() -> void:
	if not _animator:
		return
	is_dead = true
	_animator.start("death")
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
		_animator.travel("idle")
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
	return not is_attacking and not is_dead
