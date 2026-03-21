## Port of ObjectSpawner.cpp — spawns objects and NPCs from room JSON data.
class_name ObjectSpawner
extends RefCounted

const CATEGORY_COLORS = {
	"item": Color(0.8, 0.7, 0.2),
	"prop": Color(0.5, 0.35, 0.2),
	"building": Color(0.4, 0.4, 0.45),
	"terrain": Color(0.3, 0.5, 0.25),
	"creature": Color(0.7, 0.2, 0.2),
}
const NPC_COLOR = Color(0.4, 0.3, 0.7)
const DEFAULT_COLOR = Color(0.5, 0.5, 0.5)
const CombatantScript = preload("res://scripts/combat/combatant.gd")
const EnemyCombatAIScript = preload("res://scripts/combat/enemy_combat_ai.gd")
const CombatAnimatorScript = preload("res://scripts/combat/combat_animator.gd")
const CombatAnimationSyncScript = preload("res://scripts/combat/combat_animation_sync.gd")


func spawn_objects(objects: Array, room: Node3D) -> void:
	for obj_data in objects:
		var node := _create_object(obj_data)
		if node:
			room.add_child(node)
			print("ObjectSpawner: [%s] %s" % [obj_data.get("mesh", "?"), obj_data.get("description", "")])


func spawn_npcs(npcs: Array, room: Node3D) -> void:
	for npc_data in npcs:
		var node := _create_npc(npc_data)
		if node:
			room.add_child(node)
			print("ObjectSpawner: NPC [%s] %s" % [npc_data.get("name", "?"), npc_data.get("description", "")])


func _create_object(data: Dictionary) -> StaticBody3D:
	var mesh_name: String = data.get("mesh", "box")
	var scale_arr: Array = data.get("scale", [0.5, 0.5, 0.5])
	var pos_arr: Array = data.get("position", [0, 0, 0])
	var rot_arr: Array = data.get("rotation", [0, 0, 0])
	var category: String = data.get("category", "prop")
	var obj_id: String = data.get("id", "obj_%d" % randi())

	var sx := float(scale_arr[0])
	var sy := float(scale_arr[1])
	var sz := float(scale_arr[2])

	var body := StaticBody3D.new()
	body.name = obj_id
	# position.y is base of object; offset by half height so mesh center is correct
	body.position = Vector3(float(pos_arr[0]), float(pos_arr[1]) + sy / 2.0, float(pos_arr[2]))
	body.rotation_degrees = Vector3(float(rot_arr[0]), float(rot_arr[1]), float(rot_arr[2]))

	# Mesh
	var mesh_inst := MeshInstance3D.new()
	mesh_inst.mesh = _create_mesh(mesh_name, sx, sy, sz)

	var mat := StandardMaterial3D.new()
	mat.albedo_color = CATEGORY_COLORS.get(category, DEFAULT_COLOR)
	mesh_inst.material_override = mat
	body.add_child(mesh_inst)

	# Collision
	var collision := CollisionShape3D.new()
	collision.shape = _create_shape(mesh_name, sx, sy, sz)
	body.add_child(collision)

	# Semantic metadata (for AI and future phases)
	body.set_meta("description", data.get("description", "unknown object"))
	body.set_meta("category", category)
	body.set_meta("state", data.get("state", "intact"))
	body.set_meta("mood", data.get("mood", "neutral"))
	body.set_meta("interactive", data.get("interactive", false))
	body.set_meta("generate_3d", data.get("generate_3d", false))
	body.set_meta("scale_x", sx)
	body.set_meta("scale_y", sy)
	body.set_meta("scale_z", sz)
	if data.has("texture_prompt"):
		body.set_meta("texture_prompt", data.get("texture_prompt"))
	if data.has("model_prompt"):
		body.set_meta("model_prompt", data.get("model_prompt"))

	# Combat components
	if data.has("combat"):
		var combat_data: Dictionary = data.get("combat", {})
		var combatant = CombatantScript.new()
		combatant.name = "Combatant"
		combatant.max_health = combat_data.get("health", 50.0)
		combatant.health = combatant.max_health
		combatant.weapon_id = combat_data.get("weapon_id", "unarmed")
		body.add_child(combatant)

		var ai = EnemyCombatAIScript.new()
		ai.name = "EnemyCombatAI"
		if combat_data.has("personality"):
			ai.setup_personality(combat_data.get("personality", {}))
		body.add_child(ai)

		# Hide placeholder capsule mesh (replaced by 3D model)
		for child in body.get_children():
			if child is MeshInstance3D:
				child.visible = false

		# 3D animated model
		var animator = CombatAnimatorScript.new()
		animator.name = "CombatAnimator"
		animator.position.y = -sy / 2.0  # Body center is offset by sy/2, model origin at feet
		body.add_child(animator)

		var sync = CombatAnimationSyncScript.new()
		sync.name = "CombatAnimationSync"
		body.add_child(sync)

	return body


func _create_npc(data: Dictionary) -> StaticBody3D:
	var scale_arr: Array = data.get("scale", [0.5, 1.8, 0.5])
	var pos_arr: Array = data.get("position", [0, 0, 0])
	var rot_arr: Array = data.get("rotation", [0, 0, 0])
	var npc_name: String = data.get("name", "Stranger")
	var npc_id: String = data.get("id", "npc_%s" % npc_name.to_lower())

	var sx := float(scale_arr[0])
	var sy := float(scale_arr[1])
	var sz := float(scale_arr[2])

	var body := StaticBody3D.new()
	body.name = npc_id
	body.position = Vector3(float(pos_arr[0]), float(pos_arr[1]) + sy / 2.0, float(pos_arr[2]))
	body.rotation_degrees = Vector3(float(rot_arr[0]), float(rot_arr[1]), float(rot_arr[2]))

	var mesh_inst := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = maxf(sx, sz) / 2.0
	capsule.height = sy
	mesh_inst.mesh = capsule

	var mat := StandardMaterial3D.new()
	mat.albedo_color = NPC_COLOR
	mesh_inst.material_override = mat
	body.add_child(mesh_inst)

	var collision := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = maxf(sx, sz) / 2.0
	shape.height = sy
	collision.shape = shape
	body.add_child(collision)

	# NPC metadata
	body.set_meta("npc_name", npc_name)
	body.set_meta("description", data.get("description", "a shadowy figure"))
	body.set_meta("scale_y", sy)
	if data.has("sprite_prompt"):
		body.set_meta("sprite_prompt", data.get("sprite_prompt"))
	if data.has("dialogue_hint"):
		body.set_meta("dialogue_hint", data.get("dialogue_hint"))

	return body


func _create_mesh(mesh_name: String, sx: float, sy: float, sz: float) -> Mesh:
	match mesh_name:
		"box":
			var m := BoxMesh.new()
			m.size = Vector3(sx, sy, sz)
			return m
		"sphere":
			var m := SphereMesh.new()
			m.radius = maxf(sx, sz) / 2.0
			m.height = sy
			return m
		"cylinder":
			var m := CylinderMesh.new()
			m.height = sy
			m.top_radius = sx / 2.0
			m.bottom_radius = sz / 2.0
			return m
		"capsule":
			var m := CapsuleMesh.new()
			m.radius = maxf(sx, sz) / 2.0
			m.height = sy
			return m
		"cone":
			var m := CylinderMesh.new()
			m.height = sy
			m.top_radius = 0.0
			m.bottom_radius = maxf(sx, sz) / 2.0
			return m
		"plane":
			var m := PlaneMesh.new()
			m.size = Vector2(sx, sz)
			return m
		"torus":
			var m := TorusMesh.new()
			m.inner_radius = minf(sx, sz) / 4.0
			m.outer_radius = maxf(sx, sz) / 2.0
			return m
		_:
			var m := BoxMesh.new()
			m.size = Vector3(sx, sy, sz)
			return m


func _create_shape(mesh_name: String, sx: float, sy: float, sz: float) -> Shape3D:
	match mesh_name:
		"sphere":
			var s := SphereShape3D.new()
			s.radius = maxf(sx, sz) / 2.0
			return s
		"cylinder", "cone":
			var s := CylinderShape3D.new()
			s.height = sy
			s.radius = maxf(sx, sz) / 2.0
			return s
		"capsule":
			var s := CapsuleShape3D.new()
			s.radius = maxf(sx, sz) / 2.0
			s.height = sy
			return s
		_:
			var s := BoxShape3D.new()
			s.size = Vector3(sx, sy, sz)
			return s
