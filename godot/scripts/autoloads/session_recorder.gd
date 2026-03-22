## Records game sessions via periodic snapshots of GameStore + event log.
## Toggle with F10. Saves to user://recordings/.
extends Node

const SNAPSHOT_INTERVAL := 2.0  # seconds

var _recording := false
var _start_time_ms: int = 0
var _timer: float = 0.0
var _snapshots: Array = []
var _events: Array = []


func _ready() -> void:
	GameStore.state_changed.connect(_on_state_changed)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_F10:
			if _recording:
				stop_recording()
			else:
				start_recording()


func _process(delta: float) -> void:
	if not _recording:
		return
	_timer += delta
	if _timer >= SNAPSHOT_INTERVAL:
		_timer = 0.0
		_capture_snapshot()


func start_recording() -> void:
	_recording = true
	_start_time_ms = Time.get_ticks_msec()
	_timer = 0.0
	_snapshots.clear()
	_events.clear()
	GameStore.dispatch("meta_update", {"recording": true})
	_capture_snapshot()
	print("SessionRecorder: recording started")


func stop_recording() -> String:
	_recording = false
	_capture_snapshot()  # Final snapshot
	GameStore.dispatch("meta_update", {"recording": false})

	var path := _save_recording()
	print("SessionRecorder: recording saved to %s (%d snapshots, %d events)" % [
		path, _snapshots.size(), _events.size()
	])
	return path


func is_recording() -> bool:
	return _recording


func _capture_snapshot() -> void:
	var snap := GameStore.snapshot()
	snap.meta.elapsed_ms = Time.get_ticks_msec() - _start_time_ms
	_snapshots.append(snap)


func _on_state_changed(event_name: String, payload: Dictionary) -> void:
	if not _recording:
		return
	# Skip high-frequency events and meta updates
	if event_name in ["player_moved", "camera_rotated", "meta_update", "state_restored"]:
		return
	_events.append({
		"t": Time.get_ticks_msec() - _start_time_ms,
		"event": event_name,
		"data": payload.duplicate(true),
	})


func _save_recording() -> String:
	var dir_path := ProjectSettings.globalize_path("res://").path_join("recordings")
	DirAccess.make_dir_recursive_absolute(dir_path)

	var dt := Time.get_datetime_string_from_system().replace(":", "").replace("-", "").replace("T", "_")
	var path := "%s/session_%s.json" % [dir_path, dt]

	var recording := {
		"version": 1,
		"start_time": Time.get_datetime_string_from_system(),
		"interval_s": SNAPSHOT_INTERVAL,
		"snapshot_count": _snapshots.size(),
		"event_count": _events.size(),
		"snapshots": _snapshots,
		"events": _events,
	}

	var file := FileAccess.open(path, FileAccess.WRITE)
	if not file:
		push_error("SessionRecorder: cannot save to %s" % path)
		return ""
	file.store_string(JSON.stringify(recording, "\t"))
	file.close()
	return path
