## Registry mapping character_type strings to Mixamo FBX model paths and metadata.
## Used by ObjectSpawner (NPCs/enemies) and CharacterEditor (player customization).
class_name NpcModelRegistry
extends RefCounted

const MODELS := {
	"paladin": {
		"path": "res://assets/characters/mixamo/paladin/character.fbx",
		"display_name": "Paladin",
		"description": "Caballero con armadura completa, espada y escudo",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": true,
		"model_scale": 1.0,
	},
	"peasant_girl": {
		"path": "res://assets/characters/mixamo/peasant_girl/character.fbx",
		"display_name": "Peasant Girl",
		"description": "Joven campesina con vestido largo y pelo recogido",
		"category": "ambient",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 0.92,
	},
	"erika_archer": {
		"path": "res://assets/characters/mixamo/erika_archer/character.fbx",
		"display_name": "Erika",
		"description": "Arquera encapuchada con arco y carcaj",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": true,
		"model_scale": 0.95,
	},
	"romero": {
		"path": "res://assets/characters/mixamo/romero/character.fbx",
		"display_name": "Romero",
		"description": "Zombie con ropa rasgada y piel putrefacta",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 1.0,
	},
	"eve": {
		"path": "res://assets/characters/mixamo/eve/character.fbx",
		"display_name": "Eve",
		"description": "Guerrera agil con armadura ligera y detalles dorados",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 0.95,
	},
	"akai": {
		"path": "res://assets/characters/mixamo/akai/character.fbx",
		"display_name": "Akai",
		"description": "Asesina encapuchada con armadura de cuero oscuro",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 0.97,
	},
	"parasite": {
		"path": "res://assets/characters/mixamo/parasite/character.fbx",
		"display_name": "Parasite",
		"description": "Criatura monstruosa deforme con garras y piel desgarrada",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 1.1,
	},
	"zombiegirl": {
		"path": "res://assets/characters/mixamo/zombiegirl/character.fbx",
		"display_name": "Zombiegirl",
		"description": "Zombie femenina con pelo largo y ropa desgarrada",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 0.97,
	},
	"dreyar": {
		"path": "res://assets/characters/mixamo/dreyar/character.fbx",
		"display_name": "Dreyar",
		"description": "Caballero oscuro con armadura pesada y capa",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 0.28,
	},
	"nightshade": {
		"path": "res://assets/characters/mixamo/nightshade/character.fbx",
		"display_name": "Nightshade",
		"description": "Hechicero demoniaco con armadura ornamentada y cuernos",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 1.05,
	},
	"drake": {
		"path": "res://assets/characters/mixamo/drake/character.fbx",
		"display_name": "Drake",
		"description": "Guerrero corpulento de piel oscura con armadura tribal",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 1.05,
	},
	"maynard": {
		"path": "res://assets/characters/mixamo/maynard/character.fbx",
		"display_name": "Maynard",
		"description": "Criatura musculosa sin pelo con piel curtida",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 1.02,
	},
	"brute": {
		"path": "res://assets/characters/mixamo/brute/character.fbx",
		"display_name": "Brute",
		"description": "Hombre robusto con barba, brazo mecanico y pantalones militares",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 1.08,
	},
	"arissa": {
		"path": "res://assets/characters/mixamo/arissa/character.fbx",
		"display_name": "Arissa",
		"description": "Hechicera con capa oscura, tatuajes y top revelador",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 0.95,
	},
	"morak": {
		"path": "res://assets/characters/mixamo/morak/character.fbx",
		"display_name": "Morak",
		"description": "Guerrero orco con armadura de hueso y hombreras con pinchos",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 1.1,
	},
	"pete": {
		"path": "res://assets/characters/mixamo/pete/character.fbx",
		"display_name": "Pete",
		"description": "Guerrero medieval con cota de malla, detalles de cuero y casco metalico",
		"category": "combat",
		"y_offset": -0.05,
		"has_weapon": false,
		"model_scale": 1.0,
	},
}

## Combat animation directory shared by all models when used as player/enemy.
const COMBAT_ANIM_DIR := "res://assets/characters/Sword and Shield Pack/"


static func get_model_path(character_type: String) -> String:
	var entry: Variant = MODELS.get(character_type, null)
	if entry is Dictionary:
		return entry.get("path", "")
	return ""


static func get_model_data(character_type: String) -> Dictionary:
	return MODELS.get(character_type, {})


static func is_valid_type(character_type: String) -> bool:
	return MODELS.has(character_type)


static func get_all_ids() -> Array[String]:
	var ids: Array[String] = []
	for key in MODELS:
		ids.append(key)
	return ids


static func get_available_skins(model_id: String) -> Array[String]:
	"""Return custom skins for this model (skin_*.png files in the model's directory).
	Excludes character_N.png files which are FBX-embedded UV maps, not interchangeable skins."""
	var data: Dictionary = MODELS.get(model_id, {})
	var model_path: String = data.get("path", "")
	if model_path == "":
		return []
	var dir_path: String = model_path.get_base_dir()
	var skins: Array[String] = []
	var dir := DirAccess.open(dir_path)
	if not dir:
		return skins
	dir.list_dir_begin()
	var file_name: String = dir.get_next()
	while file_name != "":
		if not dir.current_is_dir():
			var base: String = file_name.replace(".import", "")
			# Only include skin_*.png files (custom skins), not character_N.png (FBX UV maps)
			if base.begins_with("skin_") and base.ends_with(".png"):
				var skin_path: String = dir_path + "/" + base
				if skin_path not in skins:
					skins.append(skin_path)
		file_name = dir.get_next()
	dir.list_dir_end()
	skins.sort()
	return skins
