## Static helpers for legacy room transitions: opposite-wall lookup and the
## entry position for a player coming through a given wall. Kept as a standalone
## script (no autoload) because callers are few and the logic is pure.
class_name RoomGeometry
extends RefCounted

const OPPOSITE_WALL := {
	"north": "south",
	"south": "north",
	"east": "west",
	"west": "east",
}


static func opposite_wall(wall: String) -> String:
	return OPPOSITE_WALL.get(wall, "south")


static func get_entry_position(entry_wall: String, dims: Dictionary) -> Vector3:
	var w: float = float(dims.get("width", 10.0))
	var d: float = float(dims.get("depth", 8.0))
	match entry_wall:
		"south": return Vector3(0, 1, d / 2.0 - 1.5)
		"north": return Vector3(0, 1, -d / 2.0 + 1.5)
		"east": return Vector3(w / 2.0 - 1.5, 1, 0)
		"west": return Vector3(-w / 2.0 + 1.5, 1, 0)
	return Vector3(0, 1, 0)
