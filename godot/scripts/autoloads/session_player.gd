## Replays a recorded session by restoring snapshots sequentially.
## Toggle with F11 (loads most recent recording).
extends Node

var _playing := false
var _snapshots: Array = []
var _events: Array = []
var _current_idx: int = 0
var _start_time_ms: int = 0
var _player_node: CharacterBody3D = null


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_F11:
			if _playing:
				stop()
			else:
				_play_latest()


func _process(_delta: float) -> void:
	if not _playing or _current_idx >= _snapshots.size():
		if _playing and _current_idx >= _snapshots.size():
			stop()
		return

	var elapsed: int = Time.get_ticks_msec() - _start_time_ms
	var snap: Dictionary = _snapshots[_current_idx]
	var snap_time: int = snap.get("meta", {}).get("elapsed_ms", 0)

	if elapsed >= snap_time:
		_apply_snapshot(snap)
		_current_idx += 1


func play(recording: Dictionary) -> void:
	_snapshots = recording.get("snapshots", [])
	_events = recording.get("events", [])
	if _snapshots.is_empty():
		print("SessionPlayer: no snapshots to play")
		return

	_current_idx = 0
	_start_time_ms = Time.get_ticks_msec()
	_playing = true

	# Disable player input during replay
	_player_node = get_tree().current_scene.get_node_or_null("Player")
	if _player_node:
		_player_node.set_physics_process(false)
		_player_node.set_process_unhandled_input(false)

	print("SessionPlayer: playing %d snapshots" % _snapshots.size())


func stop() -> void:
	_playing = false
	_current_idx = 0

	# Re-enable player input
	if _player_node and is_instance_valid(_player_node):
		_player_node.set_physics_process(true)
		_player_node.set_process_unhandled_input(true)

	print("SessionPlayer: stopped")


func is_playing() -> bool:
	return _playing


func _apply_snapshot(snap: Dictionary) -> void:
	# Restore player position and camera
	var player_data: Dictionary = snap.get("player", {})
	if _player_node and is_instance_valid(_player_node):
		var pos: Array = player_data.get("pos", [0, 0, 0])
		_player_node.position = Vector3(pos[0], pos[1], pos[2])

		var pivot: Node3D = _player_node.get_node_or_null("CameraPivot")
		if pivot:
			pivot.rotation.y = player_data.get("camera_yaw", 0.0)
			pivot.rotation.x = player_data.get("camera_pitch", 0.0)

	# Update store state (without re-dispatching)
	GameStore.state = snap.duplicate(true)


func _play_latest() -> void:
	var dir_path := ProjectSettings.globalize_path("res://").path_join("recordings")
	var dir := DirAccess.open(dir_path)
	if not dir:
		print("SessionPlayer: no recordings found")
		return

	# Find most recent recording
	var latest_file := ""
	dir.list_dir_begin()
	var file_name := dir.get_next()
	while file_name != "":
		if file_name.ends_with(".json") and file_name > latest_file:
			latest_file = file_name
		file_name = dir.get_next()
	dir.list_dir_end()

	if latest_file.is_empty():
		print("SessionPlayer: no recordings found")
		return

	var path := dir_path.path_join(latest_file)
	var file := FileAccess.open(path, FileAccess.READ)
	if not file:
		print("SessionPlayer: cannot open %s" % path)
		return

	var data = JSON.parse_string(file.get_as_text())
	file.close()
	if data == null:
		print("SessionPlayer: invalid recording file")
		return

	print("SessionPlayer: loading %s" % latest_file)
	play(data)
