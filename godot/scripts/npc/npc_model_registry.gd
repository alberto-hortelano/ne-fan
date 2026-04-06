## Registry mapping character_type strings to Mixamo FBX model paths.
class_name NpcModelRegistry
extends RefCounted

const MODELS := {
	# Ambient NPCs
	"peasant_female": "res://assets/characters/mixamo/ambient/peasant_female/character.fbx",
	"peasant_male": "res://assets/characters/mixamo/ambient/peasant_male/character.fbx",
	"knight": "res://assets/characters/mixamo/ambient/knight/character.fbx",
	"mage": "res://assets/characters/mixamo/ambient/mage/character.fbx",
	"rogue": "res://assets/characters/mixamo/ambient/rogue/character.fbx",
	"soldier": "res://assets/characters/mixamo/ambient/soldier/character.fbx",
	# Combat models (existing)
	"mutant": "res://assets/characters/mixamo/mutant/character.fbx",
	"skeletonzombie": "res://assets/characters/mixamo/skeletonzombie/character.fbx",
	"warrok": "res://assets/characters/mixamo/warrok/character.fbx",
}


static func get_model_path(character_type: String) -> String:
	return MODELS.get(character_type, "")


static func is_valid_type(character_type: String) -> bool:
	return MODELS.has(character_type)
