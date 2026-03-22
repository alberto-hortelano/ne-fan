## Enemy AI — decisions handled by nefan-core via LogicBridge.
## Kept as a node for personality data (loaded from room JSON).
class_name EnemyCombatAI
extends Node

var aggression: float = 0.5
var preferred_attacks: Array = ["medium"]
var reaction_time: float = 0.8
var combat_range: float = 4.0
var target: Node = null


func setup_personality(personality: Dictionary) -> void:
	aggression = personality.get("aggression", 0.5)
	var pa = personality.get("preferred_attacks", ["medium"])
	preferred_attacks = pa if pa is Array else ["medium"]
	reaction_time = personality.get("reaction_time", 0.8)
