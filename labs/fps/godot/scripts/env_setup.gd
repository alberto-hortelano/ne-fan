class_name EnvSetup
## Environment + luces del vocabulario GreyboxLight, en dos modos:
##  - "parity": réplica de labs/fps/viewer.html + lib.mjs (ACES 1.1, fog
##    lineal, cielo gradiente, sol 2048 ORTHOGONAL, sin GI) para capturas
##    comparables 1:1 con three.js.
##  - "quality": el techo de Godot Forward+ — SDFGI + SSAO + soft shadows
##    PSSM 4 splits + sombras en las omni. Mismo tonemap/fog/cielo que
##    paridad para que el color siga siendo comparable.
## La equivalencia de intensidades three↔Godot NO es 1:1: las constantes
## *_SCALE de abajo se calibran en M4 contra capturas three (mediana de
## luminancia) y quedan congeladas aquí.

const SKY_SHADER := "res://scripts/sky_gradient.gdshader"

# Calibración three → Godot (M4): iterada contra las capturas three
# (compare.py --calibrate) hasta casar la mediana de luminancia.
const SUN_ENERGY_SCALE := 0.19
const AMBIENT_ENERGY_SCALE := 0.33
const POINT_ENERGY_SCALE := 0.30
# three PointLight(intensity, distance, decay=2): en Godot la omni con
# atenuación cuadrática física se aproxima con attenuation ~1.5-2.
const OMNI_ATTENUATION := 2.0


static func apply(root: Node3D, lights: Array, env_spec: Dictionary, mode: String) -> void:
	var quality := mode == "quality"
	var env := Environment.new()

	# --- Cielo / fondo ---
	var sky_spec: Variant = env_spec.get("sky")
	if sky_spec is Dictionary:
		var sky_mat := ShaderMaterial.new()
		sky_mat.shader = load(SKY_SHADER)
		# three muestra el gradiente como BYTES del valor lineal (su shader no
		# tonemapea ni re-encodea): para que encode_srgb(tonemap(u)) devuelva
		# ese mismo byte, u debe linealizarse DOS veces (y compensar exposure).
		var top := Color.html(sky_spec["top"]).srgb_to_linear().srgb_to_linear()
		var bottom := Color.html(sky_spec["bottom"]).srgb_to_linear().srgb_to_linear()
		top = Color(top.r / 1.6, top.g / 1.6, top.b / 1.6)
		bottom = Color(bottom.r / 1.6, bottom.g / 1.6, bottom.b / 1.6)
		sky_mat.set_shader_parameter("top_color", Vector3(top.r, top.g, top.b))
		sky_mat.set_shader_parameter("bottom_color", Vector3(bottom.r, bottom.g, bottom.b))
		var sky := Sky.new()
		sky.sky_material = sky_mat
		env.background_mode = Environment.BG_SKY
		env.sky = sky
	else:
		env.background_mode = Environment.BG_COLOR
		env.background_color = Color.html("#0a0908")

	# --- Niebla (lineal por profundidad, como THREE.Fog) ---
	var fog_spec: Variant = env_spec.get("fog")
	if fog_spec is Dictionary:
		env.fog_enabled = true
		env.fog_mode = Environment.FOG_MODE_DEPTH
		env.fog_light_color = Color.html(fog_spec["color"])
		env.fog_depth_begin = float(fog_spec["near"])
		env.fog_depth_end = float(fog_spec["far"])
		env.fog_depth_curve = 1.0
		# El skyDome de three no recibe fog (fog:false).
		env.fog_sky_affect = 0.0

	# --- Tonemap (three: ACESFilmic, exposure 1.1) ---
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.1

	env.glow_enabled = false

	# --- Ambient + hemi (Godot tiene UNA luz ambiente: se combinan) ---
	var ambient_energy := 0.0
	var ambient_color := Color.WHITE
	for l in lights:
		var kind: String = l.get("kind", "")
		if kind == "ambient":
			ambient_color = Color.html(l["color"])
			ambient_energy += float(l["intensity"])
		elif kind == "hemi":
			# Aproximación (Godot no tiene hemisférica): media cielo/suelo
			# sumada al ambiente. Limitación documentada en el veredicto.
			var top := Color.html(l["color"])
			var ground := Color.html(l.get("groundColor", "#6a6055"))
			var mid := top.lerp(ground, 0.5)
			var w := float(l["intensity"])
			var total := ambient_energy + w
			if total > 0.0:
				ambient_color = ambient_color.lerp(mid, w / total)
			ambient_energy += w
	if ambient_energy > 0.0:
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.ambient_light_color = ambient_color
		env.ambient_light_energy = ambient_energy * AMBIENT_ENERGY_SCALE

	# --- Modo calidad: GI + oclusión ---
	if quality:
		env.sdfgi_enabled = true
		env.sdfgi_min_cell_size = 0.2
		env.ssao_enabled = true
		# El ambiente plano baja: SDFGI ya rebota luz (tuning M6).
		env.ambient_light_energy = env.ambient_light_energy * 0.5

	var world_env := WorldEnvironment.new()
	world_env.name = "WorldEnv"
	world_env.environment = env
	root.add_child(world_env)

	# --- Luces puntuales y sol ---
	for l in lights:
		var kind: String = l.get("kind", "")
		if kind == "ambient" or kind == "hemi":
			continue
		if kind == "point":
			var omni := OmniLight3D.new()
			omni.light_color = Color.html(l["color"])
			omni.light_energy = float(l["intensity"]) * POINT_ENERGY_SCALE
			var dist := float(l.get("distance", 0.0))
			omni.omni_range = dist if dist > 0.0 else 60.0
			omni.omni_attenuation = OMNI_ATTENUATION
			var pos: Array = l.get("pos", [0, 1, 0])
			omni.position = Vector3(pos[0], pos[1], pos[2])
			# three no proyecta sombra en las point del bench; en calidad sí.
			omni.shadow_enabled = quality
			root.add_child(omni)
		else:
			# sun (DirectionalLight three con target en (32,0,32), lib.mjs:233)
			var sun := DirectionalLight3D.new()
			sun.light_color = Color.html(l["color"])
			sun.light_energy = float(l["intensity"]) * SUN_ENERGY_SCALE
			# Con SDFGI el sol es también la fuente del rebote: sin este boost
			# los exteriores del modo calidad quedan apagados (tuning M6).
			if quality:
				sun.light_energy *= 2.2
			var spos: Array = l.get("pos", [40, 60, 40])
			sun.position = Vector3(spos[0], spos[1], spos[2])
			sun.look_at_from_position(sun.position, Vector3(32, 0, 32), Vector3.UP)
			if l.get("castShadow", false):
				sun.shadow_enabled = true
				if quality:
					sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
					sun.directional_shadow_max_distance = 150.0
					sun.light_angular_distance = 0.5
					sun.shadow_blur = 1.5
				else:
					sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
					sun.directional_shadow_max_distance = 120.0
					# El acne del alero (sawtooth) se mata con normal bias,
					# como el normalBias 0.06 de three (escalas distintas).
					sun.shadow_normal_bias = 2.0
			root.add_child(sun)
