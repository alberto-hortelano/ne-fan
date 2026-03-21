extends SceneTree

func _init():
	# Check base model AnimationPlayer root and skeleton path
	var xbot = load("res://assets/characters/Sword and Shield Pack/X Bot.fbx")
	if xbot:
		var inst = xbot.instantiate()
		var ap = inst.get_node_or_null("AnimationPlayer") as AnimationPlayer
		if ap:
			print("=== X Bot AnimPlayer ===")
			print("Root node: '%s'" % ap.root_node)
			for lib_name in ap.get_animation_library_list():
				var lib = ap.get_animation_library(lib_name)
				for anim_name in lib.get_animation_list():
					var anim = lib.get_animation(anim_name)
					print("Anim '%s': %d tracks" % [anim_name, anim.get_track_count()])
					for i in range(mini(anim.get_track_count(), 3)):
						print("  track[%d]: path='%s' type=%d" % [i, anim.track_get_path(i), anim.track_get_type(i)])
		inst.free()

	# Check attack anim tracks
	var attack = load("res://assets/characters/Sword and Shield Pack/sword and shield attack.fbx")
	if attack:
		var inst = attack.instantiate()
		var ap = inst.get_node_or_null("AnimationPlayer") as AnimationPlayer
		if ap:
			print("=== Attack AnimPlayer ===")
			print("Root node: '%s'" % ap.root_node)
			for lib_name in ap.get_animation_library_list():
				var lib = ap.get_animation_library(lib_name)
				for anim_name in lib.get_animation_list():
					var anim = lib.get_animation(anim_name)
					print("Anim '%s': %d tracks, len=%.2f" % [anim_name, anim.get_track_count(), anim.length])
					for i in range(mini(anim.get_track_count(), 3)):
						print("  track[%d]: path='%s'" % [i, anim.track_get_path(i)])
		inst.free()

	quit()
