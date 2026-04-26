## Persistent narrative state for the open-world RPG.
## Tracks world+player+story+spawned entities+dialogue history. Serializes to
## ~/code/ne-fan/saves/{session_id}/state.json — a shared filesystem path so
## the HTML 2D client (via nefan-core/bridge) and Godot read the same saves.
## The narrative engine reads this for context and the title screen lists
## resumable sessions.
extends Node

const SCHEMA_VERSION := 1
const SAVES_DIR_FALLBACK := "user://saves/"


static func _saves_dir() -> String:
	## Prefer the shared filesystem path under $HOME/code/ne-fan/saves/, falling
	## back to user:// when the env var isn't set (e.g. exported builds).
	var override: String = OS.get_environment("NEFAN_SAVES_DIR")
	if override != "":
		if not override.ends_with("/"):
			override += "/"
		return override
	var home: String = OS.get_environment("HOME")
	if home != "":
		return home + "/code/ne-fan/saves/"
	return SAVES_DIR_FALLBACK


# Saves dir is resolved lazily because each call may rely on env vars set up
# during _ready. Constant kept for backwards compat with code that referenced
# it; see _saves_dir() for the live value.
var SAVES_DIR := _saves_dir()

signal session_started(session_id: String, game_id: String, is_resume: bool)
signal session_saved(session_id: String, path: String)

# --- Active session data (loaded from disk or built fresh) ---

var session_id := ""
var game_id := ""
var created_at := ""
var updated_at := ""

var world: Dictionary = {
	"name": "",
	"atmosphere": "",
	"style_token": "",
	"active_scene_id": "",
}

var player: Dictionary = {
	"level": 1,
	"class": "rogue",
	"health": 100.0,
	"gold": 0,
	"inventory": [],
	"appearance": {"model_id": "pete", "skin_path": ""},
	"position": [0.0, 1.0, 0.0],
	"current_scene_id": "",
}

var story_so_far := ""

# scene_id → { scene_data, loaded_at, asset_refs }
var scenes_loaded: Dictionary = {}

# Array of entity dicts: { id, type, scene_id, spawned_at, spawn_reason,
#                           spawn_event_id, position, data, asset_refs }
var entities: Array = []

# Array of dialogue event dicts: { id, timestamp, scene_id, speaker, text,
#                                   choices, chosen_index, free_text,
#                                   narrative_consequences }
var dialogue_history: Array = []

# Last 100 entries from the asset manifest (refreshed on save)
var asset_index_snapshot: Array = []

var _next_event_seq := 0
var _dirty := false


func _ready() -> void:
	SAVES_DIR = _saves_dir()
	DirAccess.make_dir_recursive_absolute(SAVES_DIR)
	print("NarrativeState: saves dir = %s" % SAVES_DIR)


# ----------------------------------------------------------------------
# Session lifecycle
# ----------------------------------------------------------------------

func start_new_session(p_game_id: String) -> String:
	session_id = _generate_session_id()
	game_id = p_game_id
	created_at = Time.get_datetime_string_from_system(true)
	updated_at = created_at
	world = {
		"name": "",
		"atmosphere": "",
		"style_token": "",
		"active_scene_id": "",
	}
	player = {
		"level": 1,
		"class": "rogue",
		"health": 100.0,
		"gold": 0,
		"inventory": [],
		"appearance": {"model_id": "pete", "skin_path": ""},
		"position": [0.0, 1.0, 0.0],
		"current_scene_id": "",
	}
	story_so_far = ""
	scenes_loaded = {}
	entities = []
	dialogue_history = []
	asset_index_snapshot = []
	_next_event_seq = 0
	_dirty = true
	session_started.emit(session_id, game_id, false)
	print("NarrativeState: new session %s for game %s" % [session_id, game_id])
	return session_id


func load_session(p_session_id: String) -> bool:
	var path := SAVES_DIR + p_session_id + "/state.json"
	if not FileAccess.file_exists(path):
		print("NarrativeState: no save at %s" % path)
		return false
	var f := FileAccess.open(path, FileAccess.READ)
	if not f:
		return false
	var data = JSON.parse_string(f.get_as_text())
	f.close()
	if data == null or not data is Dictionary:
		print("NarrativeState: corrupted save %s" % path)
		return false
	var ver: int = int(data.get("schema_version", 0))
	if ver != SCHEMA_VERSION:
		# Future: migrate. For now, refuse loudly.
		push_warning("NarrativeState: schema version %d not supported" % ver)
		return false
	session_id = data.get("session_id", "")
	game_id = data.get("game_id", "")
	created_at = data.get("created_at", "")
	updated_at = data.get("updated_at", "")
	world = data.get("world", world)
	player = data.get("player", player)
	story_so_far = data.get("story_so_far", "")
	scenes_loaded = data.get("scenes_loaded", {})
	entities = data.get("entities", [])
	dialogue_history = data.get("dialogue_history", [])
	asset_index_snapshot = data.get("asset_index_snapshot", [])
	_next_event_seq = int(data.get("_next_event_seq", dialogue_history.size()))
	_dirty = false
	session_started.emit(session_id, game_id, true)
	print("NarrativeState: loaded session %s (%d entities, %d dialogues)" % [
		session_id, entities.size(), dialogue_history.size()])
	return true


func save() -> bool:
	if session_id == "":
		push_warning("NarrativeState: cannot save without an active session")
		return false
	updated_at = Time.get_datetime_string_from_system(true)
	var dir := SAVES_DIR + session_id + "/"
	DirAccess.make_dir_recursive_absolute(dir)
	var path := dir + "state.json"
	var data := {
		"schema_version": SCHEMA_VERSION,
		"session_id": session_id,
		"game_id": game_id,
		"created_at": created_at,
		"updated_at": updated_at,
		"world": world,
		"player": player,
		"story_so_far": story_so_far,
		"scenes_loaded": scenes_loaded,
		"entities": entities,
		"dialogue_history": dialogue_history,
		"asset_index_snapshot": asset_index_snapshot,
		"_next_event_seq": _next_event_seq,
	}
	var f := FileAccess.open(path, FileAccess.WRITE)
	if not f:
		push_warning("NarrativeState: failed to open %s for writing" % path)
		return false
	f.store_string(JSON.stringify(data, "\t"))
	f.close()
	_dirty = false
	session_saved.emit(session_id, path)
	print("NarrativeState: saved %s" % path)
	return true


static func list_saved_sessions() -> Array:
	"""Return a list of {session_id, game_id, updated_at, summary, scene_count,
	entity_count} for every save under the shared saves dir. Sorted desc."""
	var result: Array = []
	var saves_dir: String = _saves_dir()
	if not DirAccess.dir_exists_absolute(saves_dir):
		return result
	var d := DirAccess.open(saves_dir)
	if not d:
		return result
	d.list_dir_begin()
	var name := d.get_next()
	while name != "":
		if d.current_is_dir() and name != "." and name != "..":
			var path := saves_dir + name + "/state.json"
			if FileAccess.file_exists(path):
				var f := FileAccess.open(path, FileAccess.READ)
				if f:
					var data = JSON.parse_string(f.get_as_text())
					f.close()
					if data is Dictionary:
						var summary: String = data.get("story_so_far", "")
						if summary.length() > 80:
							summary = summary.substr(0, 77) + "..."
						result.append({
							"session_id": data.get("session_id", name),
							"game_id": data.get("game_id", "?"),
							"updated_at": data.get("updated_at", ""),
							"summary": summary,
							"scene_count": (data.get("scenes_loaded", {}) as Dictionary).size(),
							"entity_count": (data.get("entities", []) as Array).size(),
						})
		name = d.get_next()
	d.list_dir_end()
	# Sort by updated_at descending (newest first)
	result.sort_custom(func(a, b): return String(a["updated_at"]) > String(b["updated_at"]))
	return result


# ----------------------------------------------------------------------
# Recording mutations
# ----------------------------------------------------------------------

func record_scene_loaded(scene_id: String, scene_data: Dictionary, asset_refs: Array = []) -> void:
	scenes_loaded[scene_id] = {
		"scene_data": scene_data,
		"loaded_at": Time.get_datetime_string_from_system(true),
		"asset_refs": asset_refs,
	}
	world["active_scene_id"] = scene_id
	player["current_scene_id"] = scene_id
	_dirty = true


func record_entity_spawned(entity_id: String, entity_type: String, scene_id: String,
		position: Array, data: Dictionary, spawn_reason: String = "scene_init",
		spawn_event_id: String = "", asset_refs: Array = []) -> void:
	entities.append({
		"id": entity_id,
		"type": entity_type,
		"scene_id": scene_id,
		"spawned_at": Time.get_datetime_string_from_system(true),
		"spawn_reason": spawn_reason,
		"spawn_event_id": spawn_event_id,
		"position": position,
		"data": data,
		"asset_refs": asset_refs,
	})
	_dirty = true


func record_entity_despawned(entity_id: String) -> void:
	for i in range(entities.size() - 1, -1, -1):
		if entities[i].get("id", "") == entity_id:
			entities.remove_at(i)
			_dirty = true
			return


func record_dialogue_event(speaker: String, text: String, choices: Array,
		chosen_index: int, free_text: String = "") -> String:
	var event_id := _next_event_id()
	dialogue_history.append({
		"id": event_id,
		"timestamp": Time.get_datetime_string_from_system(true),
		"scene_id": world.get("active_scene_id", ""),
		"speaker": speaker,
		"text": text,
		"choices": choices,
		"chosen_index": chosen_index,
		"free_text": free_text,
		"narrative_consequences": [],
	})
	_dirty = true
	return event_id


func record_narrative_consequence(event_id: String, consequence: Dictionary) -> void:
	for evt in dialogue_history:
		if evt.get("id", "") == event_id:
			(evt["narrative_consequences"] as Array).append(consequence)
			_dirty = true
			return


func update_player_position(pos: Vector3, scene_id: String = "") -> void:
	player["position"] = [pos.x, pos.y, pos.z]
	if scene_id != "":
		player["current_scene_id"] = scene_id
	_dirty = true


func update_player_appearance(model_id: String, skin_path: String) -> void:
	player["appearance"] = {"model_id": model_id, "skin_path": skin_path}
	_dirty = true


func is_dirty() -> bool:
	return _dirty


# ----------------------------------------------------------------------
# Serialization for the LLM (subset of state)
# ----------------------------------------------------------------------

func serialize_for_llm(verbosity: String = "compact") -> Dictionary:
	"""Compact view used by the narrative engine in room/scene/event requests."""
	var recent_dialogues: Array = []
	var n: int = mini(dialogue_history.size(), 5)
	for i in range(dialogue_history.size() - n, dialogue_history.size()):
		var d: Dictionary = dialogue_history[i]
		var chosen: String = ""
		var idx: int = int(d.get("chosen_index", -1))
		var ch_arr: Array = d.get("choices", [])
		if idx >= 0 and idx < ch_arr.size():
			chosen = String(ch_arr[idx])
		recent_dialogues.append({
			"speaker": d.get("speaker", ""),
			"chosen": chosen,
			"free_text": d.get("free_text", ""),
		})
	var compact_entities: Array = []
	for e in entities:
		compact_entities.append({
			"id": e.get("id", ""),
			"type": e.get("type", ""),
			"scene_id": e.get("scene_id", ""),
			"position": e.get("position", []),
			"spawn_reason": e.get("spawn_reason", ""),
		})
	return {
		"session_id": session_id,
		"game_id": game_id,
		"world": world,
		"player": player,
		"story_so_far": story_so_far,
		"current_scene_id": world.get("active_scene_id", ""),
		"entities": compact_entities,
		"recent_dialogues": recent_dialogues,
		"rooms_visited": scenes_loaded.size(),
	}


# ----------------------------------------------------------------------
# Internals
# ----------------------------------------------------------------------

func _generate_session_id() -> String:
	# Time-prefixed pseudo-uuid; sortable by creation time.
	var ts: int = Time.get_unix_time_from_system()
	var rnd: int = randi() & 0xFFFFFF
	return "%d-%06x" % [ts, rnd]


func _next_event_id() -> String:
	_next_event_seq += 1
	return "evt_%04d" % _next_event_seq
