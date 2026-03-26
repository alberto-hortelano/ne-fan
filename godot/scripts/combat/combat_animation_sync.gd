## Animation state machine — Souls-Like pattern with combos, roll, and actions.
## Controls AnimationTree via travel()/start() based on player state.
class_name CombatAnimationSync
extends Node

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

var _animator: Node  # CombatAnimator
var _combatant: Node  # Combatant
var _sprint_speed := 3.8

# State booleans (Souls-Like pattern)
var is_attacking := false
var is_rolling := false
var is_dead := false

# One-shot animations that block movement and other actions
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


func _process(_delta: float) -> void:
	if not _animator or is_dead:
		return

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
	var parent := get_parent()
	if not parent is CharacterBody3D:
		return
	var speed: float = Vector2(parent.velocity.x, parent.velocity.z).length()
	var current: String = _animator.get_current()

	if speed > _sprint_speed * 0.7:
		if current != "run":
			_animator.travel("run")
	elif speed > 0.3:
		if current != "walk":
			_animator.travel("walk")
	else:
		if current != "idle":
			_animator.travel("idle")


# ─── Public API ───


func attack(type: String) -> void:
	"""Execute selected attack type. Only from idle/walk/run."""
	if not _animator or is_dead or is_attacking:
		return
	_animator.travel(type)
	is_attacking = true


func roll() -> void:
	"""Dodge roll with instant transition (interrupts locomotion)."""
	if not _animator or is_dead or is_attacking:
		return
	# Use start() for instant snap (no blend), like Souls-Like
	_animator.start("kick")  # Using kick as roll placeholder
	is_rolling = true
	is_attacking = true  # Blocks other actions during roll


func jump() -> void:
	"""Jump animation."""
	if not _animator or is_dead or is_attacking:
		return
	_animator.travel("jump")
	is_attacking = true  # Blocks other actions during jump


func special_attack() -> void:
	"""Special attack while sprinting."""
	if not _animator or is_dead:
		return
	_animator.travel("heavy")
	is_attacking = true


func request_action(action: String) -> void:
	"""Generic action request (backwards compatibility)."""
	if action == "jump":
		jump()
	elif action in ONE_SHOT_ANIMS:
		attack(action)


func _on_damage_received(_amount: float, _from: Node) -> void:
	if not _animator or is_dead:
		return
	_animator.start("hit")
	is_attacking = true


func _on_died() -> void:
	if not _animator:
		return
	is_dead = true
	_animator.start("death")
	is_attacking = true


func reset() -> void:
	is_dead = false
	is_attacking = false
	is_rolling = false
	if _animator:
		_animator.travel("idle")


func get_current_state() -> String:
	if _animator:
		return _animator.get_current()
	return "idle"


func is_interruptible() -> bool:
	return not is_attacking and not is_dead
