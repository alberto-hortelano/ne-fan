## Centralized state store. Read anywhere, write only via dispatch().
## All writes emit state_changed so any module can listen to changes.
extends Node

signal state_changed(event_name: String, payload: Dictionary)

var state: Dictionary = {
	"world": {
		"room_id": "",
		"room_data": {},
		"rooms_visited": {},
		"region": "forgotten_depths",
		"time_of_day": "night",
		"atmosphere": "ominous",
	},
	"player": {
		"pos": [0.0, 0.0, 0.0],
		"velocity": [0.0, 0.0, 0.0],
		"camera_yaw": 0.0,
		"camera_pitch": 0.0,
		"hp": 100.0,
		"max_hp": 100.0,
		"weapon_id": "short_sword",
		"combat_state": "idle",
		"attack_type": "",
		"level": 1,
		"class": "rogue",
		"gold": 0,
		"inventory": [],
		"active_quests": [],
	},
	"enemies": [],
	"narrative": {
		"story_so_far": "",
		"last_dialogue": "",
		"last_interaction": "",
	},
	"meta": {
		"fps": 0.0,
		"elapsed_ms": 0,
		"recording": false,
	},
}

# Selective listeners: event_name -> Array[Callable]
var _listeners: Dictionary = {}


func dispatch(event_name: String, payload: Dictionary = {}) -> void:
	_apply(event_name, payload)
	state_changed.emit(event_name, payload)
	if _listeners.has(event_name):
		for cb: Callable in _listeners[event_name]:
			cb.call(payload)


func on(event_name: String, callback: Callable) -> void:
	if not _listeners.has(event_name):
		_listeners[event_name] = []
	_listeners[event_name].append(callback)


func off(event_name: String, callback: Callable) -> void:
	if _listeners.has(event_name):
		_listeners[event_name].erase(callback)


func snapshot() -> Dictionary:
	return state.duplicate(true)


func restore(snap: Dictionary) -> void:
	state = snap.duplicate(true)
	state_changed.emit("state_restored", {})


func save_to_disk(path: String = "user://save.json") -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if not file:
		push_error("GameStore: cannot save to %s" % path)
		return false
	file.store_string(JSON.stringify(state, "\t"))
	file.close()
	print("GameStore: saved to %s" % path)
	return true


func load_from_disk(path: String = "user://save.json") -> bool:
	var file := FileAccess.open(path, FileAccess.READ)
	if not file:
		return false
	var data = JSON.parse_string(file.get_as_text())
	file.close()
	if data == null or not data is Dictionary:
		push_error("GameStore: invalid save file")
		return false
	restore(data)
	print("GameStore: loaded from %s" % path)
	return true


func _apply(event_name: String, payload: Dictionary) -> void:
	match event_name:
		"player_moved":
			state.player.pos = payload.get("pos", state.player.pos)
			state.player.velocity = payload.get("velocity", state.player.velocity)
		"camera_rotated":
			state.player.camera_yaw = payload.get("yaw", state.player.camera_yaw)
			state.player.camera_pitch = payload.get("pitch", state.player.camera_pitch)
		"player_damaged":
			state.player.hp = payload.get("new_hp", state.player.hp)
		"player_healed":
			state.player.hp = payload.get("new_hp", state.player.hp)
		"player_died":
			state.player.hp = 0.0
			state.player.combat_state = "dead"
		"attack_started":
			var attacker_id: String = payload.get("attacker_id", "")
			var attack_type: String = payload.get("type", "")
			if attacker_id == "player":
				state.player.combat_state = "winding_up"
				state.player.attack_type = attack_type
			else:
				_update_enemy(attacker_id, "combat_state", "winding_up")
		"attack_landed":
			var target_id: String = payload.get("target_id", "")
			var new_hp: float = payload.get("new_hp", 0.0)
			if target_id == "player":
				state.player.hp = new_hp
			else:
				_update_enemy(target_id, "hp", new_hp)
		"enemy_died":
			var enemy_id: String = payload.get("enemy_id", "")
			_update_enemy(enemy_id, "alive", false)
			_update_enemy(enemy_id, "hp", 0.0)
		"enemy_damaged":
			var enemy_id: String = payload.get("enemy_id", "")
			_update_enemy(enemy_id, "hp", payload.get("new_hp", 0.0))
		"combat_state_changed":
			var entity_id: String = payload.get("entity_id", "")
			var new_state: String = payload.get("state", "idle")
			if entity_id == "player":
				state.player.combat_state = new_state
			else:
				_update_enemy(entity_id, "combat_state", new_state)
		"room_changed":
			state.world.room_id = payload.get("room_id", "")
			state.world.room_data = payload.get("room_data", {})
			state.enemies = payload.get("enemies", [])
		"room_visited":
			var room_id: String = payload.get("room_id", "")
			var room_data: Dictionary = payload.get("room_data", {})
			state.world.rooms_visited[room_id] = room_data
		"object_interacted":
			state.narrative.last_interaction = payload.get("description", "")
		"npc_talked":
			state.narrative.last_dialogue = payload.get("dialogue", "")
		"weapon_changed":
			state.player.weapon_id = payload.get("weapon_id", state.player.weapon_id)
		"meta_update":
			for key: String in payload:
				state.meta[key] = payload[key]


func _update_enemy(enemy_id: String, key: String, value: Variant) -> void:
	for enemy: Dictionary in state.enemies:
		if enemy.get("id", "") == enemy_id:
			enemy[key] = value
			return
