## Syncs player state to AnimationTree via conditions and travel().
## Pattern: https://github.com/catprisbrey/Third-Person-Controller--SoulsLIke-Godot4
class_name CombatAnimationSync
extends Node

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

var _animator: Node  # CombatAnimator
var _combatant: Node  # Combatant
var _dead := false
var _is_attacking := false
var _sprint_speed := 3.8
var _current_state := "idle"


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")
	_animator = get_parent().get_node_or_null("CombatAnimator")
	var config: Dictionary = CombatDataRef.load_config()
	var pcfg: Dictionary = config.get("player", {})
	_sprint_speed = pcfg.get("sprint_speed", 3.8)

	if _combatant:
		_combatant.attack_started.connect(_on_attack_started)
		_combatant.damage_received.connect(_on_damage_received)
		_combatant.died.connect(_on_died)


func _process(_delta: float) -> void:
	if not _combatant or not _animator or _dead:
		return

	# Check if current animation is a one-shot (attack/hit/etc)
	var current: String = _animator.get_current()
	var is_one_shot: bool = current in ["quick", "heavy", "medium", "defensive",
		"precise", "kick", "hit", "jump", "casting", "power_up",
		"draw_sword_1", "draw_sword_2", "death"]

	if is_one_shot:
		_is_attacking = true
		_current_state = current
		return

	_is_attacking = false

	# Locomotion based on velocity
	var parent := get_parent()
	if parent is CharacterBody3D:
		var speed: float = Vector2(parent.velocity.x, parent.velocity.z).length()
		if speed > _sprint_speed * 0.7:
			if _current_state != "run":
				_animator.travel("run")
				_current_state = "run"
		elif speed > 0.3:
			if _current_state != "walk":
				_animator.travel("walk")
				_current_state = "walk"
		else:
			if _current_state != "idle":
				_animator.travel("idle")
				_current_state = "idle"


func request_action(action: String) -> void:
	"""Request a one-shot action (attack, jump, etc). Uses travel() for queue."""
	if not _animator or _dead or _is_attacking:
		return
	_animator.travel(action)
	_is_attacking = true
	_current_state = action


func _on_attack_started(type_id: String) -> void:
	if not _animator or _dead:
		return
	request_action(type_id)


func _on_damage_received(_amount: float, _from: Node) -> void:
	if not _animator or _dead:
		return
	_animator.start("hit")  # start() = instant, no blend
	_is_attacking = true
	_current_state = "hit"


func _on_died() -> void:
	if not _animator:
		return
	_dead = true
	_animator.start("death")
	_is_attacking = true
	_current_state = "death"


func reset() -> void:
	_dead = false
	_is_attacking = false
	_current_state = "idle"
	if _animator:
		_animator.travel("idle")


func get_current_state() -> String:
	return _current_state


func is_interruptible() -> bool:
	return not _is_attacking and not _dead
