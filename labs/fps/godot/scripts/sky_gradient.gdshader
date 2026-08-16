// Cielo gradiente vertical — réplica del skyDome de labs/fps/lib.mjs:
// mix(bottom, top, clamp(dir.y * 2.2, 0, 1)).
shader_type sky;

// SIN source_color: three emite el gradiente en lineal crudo sin tonemap
// (quirk de su ShaderMaterial) — el valor ya llega pre-compensado desde
// EnvSetup para que el resultado tonemapeado de Godot case con esa referencia.
uniform vec3 top_color = vec3(0.553, 0.706, 0.839);
uniform vec3 bottom_color = vec3(0.847, 0.812, 0.706);

void sky() {
	float t = clamp(EYEDIR.y * 2.2, 0.0, 1.0);
	COLOR = mix(bottom_color, top_color, t);
}
