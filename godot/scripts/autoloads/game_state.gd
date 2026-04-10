## Port of WorldStateManager.cpp — tracks world, player, and room state for LLM.
extends Node

signal room_entered(room_id: String, description: String, ambient_event: String)

# World
var region := "The Ashwood Dungeon, level 1"
var time_of_day := "eternal_darkness"
var atmosphere := "ancient, dangerous, forgotten"
var style_token := "dark fantasy concept art, detailed stone architecture"

# Player
var player_level := 1
var player_class := "rogue"
var player_health := 100.0
var player_gold := 0
var inventory_summary := "shortsword, lockpicks"
var active_quests: Array[String] = []

# Story
var story_so_far := "The adventurer descends into the depths of the Ashwood Dungeon, seeking answers about the ancient artifact."

# Room tracking
var visited_rooms: Dictionary = {}  # room_id -> room_data
var current_room_id := ""

# Opposite wall mapping for room transitions
const OPPOSITE_WALL = {
	"north": "south",
	"south": "north",
	"east": "west",
	"west": "east",
}


func serialize_world_state(entry_wall: String = "south", target_hint: String = "") -> Dictionary:
	var existing_objects := []
	for room_id in visited_rooms:
		var room = visited_rooms[room_id]
		for obj in room.get("objects", []):
			existing_objects.append({
				"description": obj.get("description", ""),
				"category": obj.get("category", "prop"),
			})

	return {
		"world": {
			"region": region,
			"time_of_day": time_of_day,
			"atmosphere": atmosphere,
			"style_token": style_token,
		},
		"player": {
			"level": player_level,
			"class": player_class,
			"health": player_health,
			"gold": player_gold,
			"inventory_summary": inventory_summary,
			"active_quests": active_quests,
		},
		"current_room": {
			"visited": current_room_id in visited_rooms,
			"existing_objects": existing_objects,
		},
		"story_so_far": story_so_far,
		"rooms_visited": visited_rooms.size(),
		"entry_wall": entry_wall,
		"target_hint": target_hint,
	}


func reset() -> void:
	"""Clear all mutable state between games."""
	visited_rooms.clear()
	current_room_id = ""
	story_so_far = ""
	player_health = 100.0
	player_gold = 0
	active_quests.clear()


func mark_room_visited(room_id: String, room_data: Dictionary) -> void:
	visited_rooms[room_id] = room_data
	current_room_id = room_id
	room_entered.emit(
		room_id,
		room_data.get("room_description", ""),
		room_data.get("ambient_event", ""),
	)


func save_to_disk(path: String = "user://save.json") -> bool:
	var data := {
		"region": region,
		"time_of_day": time_of_day,
		"atmosphere": atmosphere,
		"style_token": style_token,
		"player_level": player_level,
		"player_class": player_class,
		"player_health": player_health,
		"player_gold": player_gold,
		"inventory_summary": inventory_summary,
		"active_quests": active_quests,
		"story_so_far": story_so_far,
		"current_room_id": current_room_id,
		"visited_rooms": visited_rooms,
	}
	var file := FileAccess.open(path, FileAccess.WRITE)
	if not file:
		return false
	file.store_string(JSON.stringify(data, "\t"))
	file.close()
	print("GameState: saved to %s" % path)
	return true


func load_from_disk(path: String = "user://save.json") -> bool:
	if not FileAccess.file_exists(path):
		return false
	var file := FileAccess.open(path, FileAccess.READ)
	if not file:
		return false
	var data = JSON.parse_string(file.get_as_text())
	file.close()
	if data == null or not data is Dictionary:
		return false

	region = data.get("region", region)
	time_of_day = data.get("time_of_day", time_of_day)
	atmosphere = data.get("atmosphere", atmosphere)
	style_token = data.get("style_token", style_token)
	player_level = data.get("player_level", player_level)
	player_class = data.get("player_class", player_class)
	player_health = data.get("player_health", player_health)
	player_gold = data.get("player_gold", player_gold)
	inventory_summary = data.get("inventory_summary", inventory_summary)
	active_quests.assign(data.get("active_quests", []))
	story_so_far = data.get("story_so_far", story_so_far)
	current_room_id = data.get("current_room_id", "")
	visited_rooms = data.get("visited_rooms", {})
	print("GameState: loaded from %s (%d rooms)" % [path, visited_rooms.size()])
	return true


func has_save(path: String = "user://save.json") -> bool:
	return FileAccess.file_exists(path)


func get_entry_position(entry_wall: String, dims: Dictionary) -> Vector3:
	var w: float = float(dims.get("width", 10.0))
	var d: float = float(dims.get("depth", 8.0))
	match entry_wall:
		"south": return Vector3(0, 1, d / 2.0 - 1.5)
		"north": return Vector3(0, 1, -d / 2.0 + 1.5)
		"east": return Vector3(w / 2.0 - 1.5, 1, 0)
		"west": return Vector3(-w / 2.0 + 1.5, 1, 0)
	return Vector3(0, 1, 0)
