## Animation state machine — manages transitions, queuing, blending.
## Mirrors nefan-core AnimationController logic in GDScript.
class_name CombatAnimationSync
extends Node

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

var _combatant: Node  # Combatant
var _animator: Node  # CombatAnimator
var _dead := false

# State machine
var _current_state := "idle"
var _current_time := 0.0
var _queue: Array[String] = []

# Config (loaded from combat_config.json)
var _animations: Dictionary = {}  # name → {duration, interruptible, loops, category}
var _default_blend := 0.15
var _auto_return := "idle"
var _turn_threshold := 1.571  # 90° in radians
var _sprint_speed := 3.8

# Turn detection
var _prev_move_dir := Vector3.ZERO
var _turning := false


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")
	_animator = get_parent().get_node_or_null("CombatAnimator")

	var config: Dictionary = CombatDataRef.load_config()
	_animations = config.get("animations", {})
	var trans: Dictionary = config.get("transitions", {})
	_default_blend = trans.get("default_blend", 0.15)
	_auto_return = trans.get("auto_return", "idle")
	var thresh_deg: float = trans.get("turn_threshold_deg", 90)
	_turn_threshold = deg_to_rad(thresh_deg)

	var pcfg: Dictionary = config.get("player", {})
	_sprint_speed = pcfg.get("sprint_speed", 3.8)

	if _combatant:
		_combatant.attack_started.connect(_on_attack_started)
		_combatant.damage_received.connect(_on_damage_received)
		_combatant.died.connect(_on_died)


func _process(delta: float) -> void:
	if not _combatant or not _animator or _dead:
		return

	var anim_cfg: Dictionary = _animations.get(_current_state, {})
	var duration: float = anim_cfg.get("duration", 1.0)
	var loops: bool = anim_cfg.get("loops", true)
	var interruptible: bool = anim_cfg.get("interruptible", true)

	_current_time += delta

	# Non-looping completed → transition
	if not loops and _current_time >= duration:
		if _queue.size() > 0:
			var next: String = _queue.pop_front()
			_transition_to(next, 0.1)
		else:
			_transition_to(_auto_return, 0.1)
		return

	# Only handle movement if interruptible
	if not interruptible:
		return

	# Detect turning
	var parent := get_parent()
	if parent is CharacterBody3D:
		var vel: Vector3 = parent.velocity
		var speed: float = Vector2(vel.x, vel.z).length()
		var move_dir := Vector3(vel.x, 0, vel.z).normalized() if speed > 0.1 else Vector3.ZERO

		# Check for significant direction change
		_turning = false
		if move_dir.length() > 0.5 and _prev_move_dir.length() > 0.5:
			var angle: float = _prev_move_dir.angle_to(move_dir)
			if angle > _turn_threshold:
				_turning = true
		if move_dir.length() > 0.5:
			_prev_move_dir = move_dir

		# Turn animation
		if _turning and _current_state != "turn":
			_transition_to("turn", 0.1)
			return

		# Locomotion based on speed
		var target_state := "idle"
		if speed > _sprint_speed * 0.7:
			target_state = "run"
		elif speed > 0.1:
			target_state = "walk"

		if target_state != _current_state:
			_transition_to(target_state, _default_blend)


func request_action(action: String) -> void:
	"""Request a combat/special action. Queues if current is non-interruptible."""
	if not _animations.has(action):
		return

	var current_cfg: Dictionary = _animations.get(_current_state, {})
	var interruptible: bool = current_cfg.get("interruptible", true)

	if interruptible:
		_transition_to(action, 0.1)
	else:
		if _queue.size() < 3:
			_queue.append(action)


func _transition_to(state: String, blend_time: float) -> void:
	_current_state = state
	_current_time = 0.0
	var cfg: Dictionary = _animations.get(state, {})
	var loops: bool = cfg.get("loops", true)
	if loops:
		_animator.play(state)
	else:
		_animator.play_once(state)


func _on_attack_started(type_id: String) -> void:
	if not _animator or _dead:
		return
	request_action(type_id)


func _on_damage_received(_amount: float, _from: Node) -> void:
	if not _animator or _dead:
		return
	# Force hit regardless of current state
	_transition_to("hit", 0.0)


func _on_died() -> void:
	if not _animator:
		return
	_dead = true
	_transition_to("death", 0.0)


func reset() -> void:
	_dead = false
	_current_state = "idle"
	_current_time = 0.0
	_queue.clear()
	_prev_move_dir = Vector3.ZERO
	if _animator:
		_animator.play("idle")


func get_current_state() -> String:
	return _current_state


func is_interruptible() -> bool:
	var cfg: Dictionary = _animations.get(_current_state, {})
	return cfg.get("interruptible", true)
