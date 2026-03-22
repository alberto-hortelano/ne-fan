## Syncs Combatant state changes to CombatAnimator playback.
## Add as sibling of Combatant and CombatAnimator on the same parent node.
class_name CombatAnimationSync
extends Node

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

var _combatant: Node  # Combatant
var _animator: Node  # CombatAnimator
var _dead := false
var _playing_action := false  # True while attack/hit/death animation plays
var _run_threshold := 4.25  # midpoint between walk and sprint


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")
	_animator = get_parent().get_node_or_null("CombatAnimator")
	var config: Dictionary = CombatDataRef.load_config()
	var pcfg: Dictionary = config.get("player", {})
	var walk: float = pcfg.get("walk_speed", 3.0)
	var sprint: float = pcfg.get("sprint_speed", 5.5)
	_run_threshold = (walk + sprint) / 2.0

	if _combatant:
		_combatant.attack_started.connect(_on_attack_started)
		_combatant.damage_received.connect(_on_damage_received)
		_combatant.died.connect(_on_died)


func _process(_delta: float) -> void:
	if not _combatant or not _animator or _dead:
		return

	# Let action animations (attack/hit) finish before returning to idle/move
	if _playing_action:
		if _animator.is_playing():
			return
		_playing_action = false

	var state: int = _combatant.state

	# 0=IDLE, 1=MOVING, 2=WINDING_UP, 3=ATTACKING
	match state:
		0:  # IDLE
			var cam_pivot: Node3D = get_parent().get_node_or_null("CameraPivot")
			if cam_pivot and _animator:
				var yaw_diff: float = absf(wrapf(cam_pivot.rotation.y + PI - _animator.rotation.y, -PI, PI))
				if yaw_diff > 0.5:
					_animator.play("turn")
				else:
					_animator.play("idle")
			else:
				_animator.play("idle")
		1:  # MOVING
			var parent = get_parent()
			if parent is CharacterBody3D:
				var spd: float = Vector2(parent.velocity.x, parent.velocity.z).length()
				if spd > _run_threshold:
					_animator.play("run")
				else:
					_animator.play("walk")
			else:
				_animator.play("idle")


func _on_attack_started(type_id: String) -> void:
	if not _animator or _dead:
		return
	_playing_action = true
	_animator.play_once(type_id)


func _on_damage_received(_amount: float, _from: Node) -> void:
	if not _animator or _dead or _playing_action:
		return
	_playing_action = true
	_animator.play_once("hit")


func _on_died() -> void:
	if not _animator:
		return
	_dead = true
	_playing_action = true
	_animator.play_once("death")


func reset() -> void:
	_dead = false
	_playing_action = false
	if _animator:
		_animator.play("idle")
