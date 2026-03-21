extends SceneTree

func _init():
	var xbot = load("res://assets/characters/Sword and Shield Pack/X Bot.fbx")
	if xbot:
		var instance = xbot.instantiate()
		print("=== X Bot ===")
		_print_tree(instance, 0)
		instance.free()
	else:
		print("X Bot not found")

	var anim = load("res://assets/characters/Sword and Shield Pack/sword and shield attack.fbx")
	if anim:
		var instance = anim.instantiate()
		print("=== Attack Anim ===")
		_print_tree(instance, 0)
		for child in instance.get_children():
			if child is AnimationPlayer:
				print("AnimPlayer libs: %s" % str(child.get_animation_library_list()))
				for lib_name in child.get_animation_library_list():
					var lib = child.get_animation_library(lib_name)
					print("  Library '%s': %s" % [lib_name, str(lib.get_animation_list())])
		instance.free()
	else:
		print("Attack anim not found")

	quit()

func _print_tree(node: Node, depth: int):
	var indent = "  ".repeat(depth)
	print("%s%s (%s)" % [indent, node.name, node.get_class()])
	if depth < 4:
		for child in node.get_children():
			_print_tree(child, depth + 1)
