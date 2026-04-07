## Attack area visualization — arc on ground showing range.
## For player: always shows preview of selected attack type, brighter during wind-up.
## For enemies: shows arc only during wind-up.
class_name AttackAreaVisual
extends MeshInstance3D

const CombatDataRef = preload("res://scripts/combat/combat_data.gd")

var _combatant: Node  # Combatant
var _animator: Node3D  # CombatAnimator (for forward direction)
var _config: Dictionary = {}
var _attack_types: Dictionary = {}
var _weapons: Dictionary = {}

# Whether this is the player (shows persistent preview) or enemy (only wind-up)
var is_player := false
var _selected_type: String = "quick"

# State
var _mode: String = ""  # "", "preview", "windup", "impact"
var _params: Dictionary = {}  # effective params for current attack
var _preview_params: Dictionary = {}  # params for preview (player selected type)
var _impact_quality: float = 0.0
var _fade_timer: float = 0.0
const FADE_DURATION := 0.4
const RING_STEPS := 16
const ANGLE_STEPS := 20

# Tint for enemy arcs (red-ish)
var _base_color := Color(1.0, 0.5, 0.1)  # orange for player
var _enemy_color := Color(1.0, 0.15, 0.1)  # red for enemies


func _ready() -> void:
	_combatant = get_parent().get_node_or_null("Combatant")
	_animator = get_parent().get_node_or_null("CombatAnimator")

	_config = CombatDataRef.load_config()
	_attack_types = _config.get("attack_types", {})
	_weapons = _config.get("weapons", {})

	if _combatant:
		_combatant.attack_started.connect(_on_attack_started)
		_combatant.attack_impacted.connect(_on_attack_impacted)

	# Listen for player attack type changes
	var pci: Node = get_parent().get_node_or_null("PlayerCombatInput")
	if pci:
		is_player = true
		pci.attack_type_changed.connect(_on_attack_type_changed)
		_update_preview_params()

	# Set up mesh and material
	mesh = ImmediateMesh.new()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.no_depth_test = true
	mat.render_priority = 1
	material_override = mat
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

	# Use global coordinates — don't rotate with parent
	top_level = true


func _process(delta: float) -> void:
	var im: ImmediateMesh = mesh as ImmediateMesh
	if not im or not _combatant:
		return

	# Handle impact fade
	if _mode == "impact":
		_fade_timer -= delta
		if _fade_timer <= 0.0:
			_mode = "" if not is_player else "preview"

	im.clear_surfaces()

	match _mode:
		"windup":
			_build_arc_mesh(im, _params, 0.7, true)
		"impact":
			_build_impact_mesh(im, _fade_timer / FADE_DURATION)
		"preview":
			if is_player and not _preview_params.is_empty():
				_build_arc_mesh(im, _preview_params, 0.25, true)


func _on_attack_started(type_id: String) -> void:
	if not _combatant:
		return
	var weapon_id: String = _combatant.weapon_id
	var weapon_data: Dictionary = _weapons.get(weapon_id, _weapons.get("unarmed", {}))
	_params = CombatDataRef.get_effective_params(type_id, _attack_types, weapon_data)
	if _params.is_empty():
		return
	_mode = "windup"


func _on_attack_impacted(_type_id: String) -> void:
	_impact_quality = _compute_quality()
	_mode = "impact"
	_fade_timer = FADE_DURATION


func _on_attack_type_changed(type_id: String) -> void:
	_selected_type = type_id
	_update_preview_params()


func _update_preview_params() -> void:
	if not _combatant:
		return
	var weapon_id: String = _combatant.weapon_id
	var weapon_data: Dictionary = _weapons.get(weapon_id, _weapons.get("unarmed", {}))
	_preview_params = CombatDataRef.get_effective_params(_selected_type, _attack_types, weapon_data)
	if _mode == "" and is_player:
		_mode = "preview"


func _get_forward_angle() -> float:
	if _animator:
		var fwd: Vector3 = _animator.global_transform.basis.z
		fwd.y = 0.0
		fwd = fwd.normalized()
		return atan2(fwd.x, fwd.z)
	return 0.0


func _get_owner_pos() -> Vector3:
	# Use CombatAnimator position if available (follows Hips bone during attacks)
	if _animator:
		var pos: Vector3 = _animator.global_position
		pos.y = 0.0
		return pos
	var parent := get_parent()
	if parent is Node3D:
		var pos: Vector3 = parent.global_position
		pos.y = 0.0
		return pos
	return Vector3.ZERO


func _build_arc_mesh(im: ImmediateMesh, params: Dictionary, base_opacity: float, use_gradient: bool) -> void:
	var opt_dist: float = params.get("optimal_distance", 1.5)
	var dist_tol: float = params.get("distance_tolerance", 1.0)
	var area_rad: float = params.get("area_radius", 1.0)

	var min_dist: float = maxf(0.0, opt_dist - dist_tol)
	var max_dist: float = opt_dist + dist_tol
	var half_angle: float = atan2(area_rad, opt_dist)
	var fwd_angle: float = _get_forward_angle()
	var owner_pos: Vector3 = _get_owner_pos()
	var dist_range: float = max_dist - min_dist
	var tint: Color = _base_color if is_player else _enemy_color

	im.surface_begin(Mesh.PRIMITIVE_TRIANGLES)

	for ri in range(RING_STEPS):
		var r0: float = min_dist + (float(ri) / RING_STEPS) * dist_range
		var r1: float = min_dist + (float(ri + 1) / RING_STEPS) * dist_range
		var r_mid: float = (r0 + r1) / 2.0
		var dist_factor: float = 1.0 - absf(r_mid - opt_dist) / dist_tol
		if dist_factor <= 0.0:
			continue

		for ai in range(ANGLE_STEPS):
			var a0: float = -half_angle + (float(ai) / ANGLE_STEPS) * half_angle * 2.0
			var a1: float = -half_angle + (float(ai + 1) / ANGLE_STEPS) * half_angle * 2.0
			var a_mid: float = (a0 + a1) / 2.0

			var offset_val: float = absf(sin(a_mid) * r_mid)
			var prec_factor: float = 1.0 - minf(offset_val / area_rad, 1.0)
			var quality: float = dist_factor * prec_factor
			if quality <= 0.01:
				continue

			var color: Color
			if use_gradient and is_player:
				# Player: red→green gradient by quality
				color = Color(1.0 - quality, quality, 0.16, quality * base_opacity)
			else:
				# Enemy or solid: tinted with quality-based alpha
				color = Color(tint.r, tint.g, tint.b, quality * base_opacity)

			im.surface_set_color(color)

			var angle_00: float = fwd_angle + a0
			var angle_01: float = fwd_angle + a1

			var v00 := Vector3(owner_pos.x + sin(angle_00) * r0, 0.02, owner_pos.z + cos(angle_00) * r0)
			var v10 := Vector3(owner_pos.x + sin(angle_01) * r0, 0.02, owner_pos.z + cos(angle_01) * r0)
			var v01 := Vector3(owner_pos.x + sin(angle_00) * r1, 0.02, owner_pos.z + cos(angle_00) * r1)
			var v11 := Vector3(owner_pos.x + sin(angle_01) * r1, 0.02, owner_pos.z + cos(angle_01) * r1)

			im.surface_add_vertex(v00)
			im.surface_add_vertex(v10)
			im.surface_add_vertex(v11)
			im.surface_add_vertex(v00)
			im.surface_add_vertex(v11)
			im.surface_add_vertex(v01)

	im.surface_end()


func _build_impact_mesh(im: ImmediateMesh, opacity_factor: float) -> void:
	var opt_dist: float = _params.get("optimal_distance", 1.5)
	var dist_tol: float = _params.get("distance_tolerance", 1.0)
	var area_rad: float = _params.get("area_radius", 1.0)

	var min_dist: float = maxf(0.0, opt_dist - dist_tol)
	var max_dist: float = opt_dist + dist_tol
	var half_angle: float = atan2(area_rad, opt_dist)
	var fwd_angle: float = _get_forward_angle()
	var owner_pos: Vector3 = _get_owner_pos()

	# Color based on impact quality
	var cr: float
	var cg: float
	var cb: float
	if _impact_quality > 0.7:
		cr = 0.31; cg = 1.0; cb = 0.31
	elif _impact_quality > 0.3:
		cr = 1.0; cg = 1.0; cb = 0.24
	elif _impact_quality > 0.0:
		cr = 1.0; cg = 0.31; cb = 0.24
	else:
		cr = 0.47; cg = 0.47; cb = 0.47

	var color := Color(cr, cg, cb, opacity_factor * 0.6)
	var dist_range: float = max_dist - min_dist

	im.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
	im.surface_set_color(color)

	var steps := 24
	var dist_steps := 4

	for di in range(dist_steps):
		var d0: float = min_dist + (float(di) / dist_steps) * dist_range
		var d1: float = min_dist + (float(di + 1) / dist_steps) * dist_range

		for si in range(steps):
			var a0: float = -half_angle + (float(si) / steps) * half_angle * 2.0
			var a1: float = -half_angle + (float(si + 1) / steps) * half_angle * 2.0
			var angle_00: float = fwd_angle + a0
			var angle_01: float = fwd_angle + a1

			var v00 := Vector3(owner_pos.x + sin(angle_00) * d0, 0.02, owner_pos.z + cos(angle_00) * d0)
			var v10 := Vector3(owner_pos.x + sin(angle_01) * d0, 0.02, owner_pos.z + cos(angle_01) * d0)
			var v01 := Vector3(owner_pos.x + sin(angle_00) * d1, 0.02, owner_pos.z + cos(angle_00) * d1)
			var v11 := Vector3(owner_pos.x + sin(angle_01) * d1, 0.02, owner_pos.z + cos(angle_01) * d1)

			im.surface_add_vertex(v00)
			im.surface_add_vertex(v10)
			im.surface_add_vertex(v11)
			im.surface_add_vertex(v00)
			im.surface_add_vertex(v11)
			im.surface_add_vertex(v01)

	im.surface_end()


func _compute_quality() -> float:
	if _params.is_empty() or not _combatant:
		return 0.0

	var owner_pos: Vector3 = _get_owner_pos()
	var fwd: Vector3 = Vector3.FORWARD
	if _animator:
		fwd = _animator.global_transform.basis.z
		fwd.y = 0.0
		fwd = fwd.normalized()

	var opt_dist: float = _params.get("optimal_distance", 1.5)
	var dist_tol: float = _params.get("distance_tolerance", 1.0)
	var area_rad: float = _params.get("area_radius", 1.0)

	var best_quality: float = 0.0

	# Scan room for other combatants
	var room: Node3D = get_parent().get_parent() if get_parent() else null
	if not room:
		return 0.0

	for child in room.get_children():
		var c: Node = child.get_node_or_null("Combatant")
		if not c or c == _combatant:
			continue
		if c.health <= 0.0:
			continue
		if not child is Node3D:
			continue

		var target_pos: Vector3 = child.global_position
		var dist: float = owner_pos.distance_to(target_pos)
		var dist_factor: float = maxf(0.0, 1.0 - absf(dist - opt_dist) / dist_tol)

		var dir: Vector3 = target_pos - owner_pos
		var perp_dist: float = absf(fwd.x * dir.z - fwd.z * dir.x)
		var prec_factor: float = maxf(0.0, 1.0 - perp_dist / area_rad)

		var quality: float = dist_factor * prec_factor
		best_quality = maxf(best_quality, quality)

	return best_quality
