extends SceneTree

func _init():
	var scene = load("res://assets/characters/Sword and Shield Pack/X Bot.fbx")
	if not scene:
		print("Cannot load X Bot")
		quit()
		return
	var instance = scene.instantiate()
	var skel = instance.get_node_or_null("Skeleton3D")
	if skel:
		for child in skel.get_children():
			if child is MeshInstance3D:
				var aabb = child.get_aabb()
				print("Mesh: %s AABB: pos=%s size=%s" % [child.name, str(aabb.position), str(aabb.size)])
				print("  Global: %s" % str(child.global_transform))
		print("Skeleton bone count: %d" % skel.get_bone_count())
		if skel.get_bone_count() > 0:
			print("Root bone pos: %s" % str(skel.get_bone_global_pose(0).origin))
	print("Instance transform: %s" % str(instance.transform))
	instance.free()
	quit()
