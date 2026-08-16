// Cielo de anochecer de Brumaluz: gradiente ámbar→malva→azul tinta con glow
// al oeste, nubes alargadas procedurales a contraluz, estrellas débiles y
// luna creciente. Todo analítico (sin texturas).
shader_type sky;

const vec3 HOR_W = vec3(0.86, 0.44, 0.15);
const vec3 HOR_E = vec3(0.24, 0.21, 0.33);
const vec3 MID = vec3(0.42, 0.30, 0.44);
const vec3 ZEN = vec3(0.075, 0.115, 0.225);

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash13(vec3(i, 1.0));
	float b = hash13(vec3(i + vec2(1.0, 0.0), 1.0));
	float c = hash13(vec3(i + vec2(0.0, 1.0), 1.0));
	float d = hash13(vec3(i + vec2(1.0, 1.0), 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
	return vnoise(p) * 0.55 + vnoise(p * 2.13 + 17.0) * 0.3 + vnoise(p * 4.7 + 41.0) * 0.15;
}

void sky() {
	vec3 dir = EYEDIR;
	float h = clamp(dir.y, 0.0, 1.0);
	vec2 az = normalize(dir.xz + vec2(1e-5, 0.0));
	float west = clamp(dot(az, vec2(-1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
	vec3 hor = mix(HOR_E, HOR_W, pow(west, 1.6));
	vec3 col = mix(hor, MID, smoothstep(0.0, 0.22, h));
	col = mix(col, ZEN, smoothstep(0.14, 0.65, h));
	float glow = pow(west, 7.0) * pow(1.0 - h, 4.0);
	col += vec3(1.0, 0.42, 0.12) * glow * 0.55;

	// nubes alargadas a contraluz, solo banda baja del oeste
	if (dir.y > 0.02 && dir.y < 0.42) {
		// proyección gnomónica (continua): el atan(az) dejaba costura al sur
		vec2 cp = vec2(dir.x / (dir.y + 0.35) * 1.4, dir.y * 16.0 + dir.z / (dir.y + 0.35) * 0.6);
		float n = fbm(cp);
		float band = smoothstep(0.04, 0.13, dir.y) * (1.0 - smoothstep(0.24, 0.4, dir.y));
		float cl = smoothstep(0.52, 0.72, n) * band * pow(west, 1.4);
		float rim = (smoothstep(0.5, 0.56, n) - smoothstep(0.58, 0.75, n)) * band * west;
		col = mix(col, vec3(0.15, 0.15, 0.26), cl * 0.85);
		col += vec3(0.9, 0.42, 0.16) * rim * 0.22 * (1.0 - h);
	}

	// estrellas débiles arriba
	if (dir.y > 0.22) {
		vec3 cell = floor(dir * 240.0);
		float s = hash13(cell);
		if (s > 0.9975) {
			float tw = 0.35 + 0.65 * hash13(cell + 7.0);
			col += vec3(0.8, 0.85, 1.0) * tw * smoothstep(0.22, 0.5, dir.y) * 0.55;
		}
	}

	// luna creciente al sureste, alta
	vec3 moon_dir = normalize(vec3(0.50, 0.33, 0.81));
	float ang = acos(clamp(dot(dir, moon_dir), -1.0, 1.0));
	float disc = 1.0 - smoothstep(0.020, 0.024, ang);
	vec3 moon_dir2 = normalize(moon_dir + vec3(-0.014, 0.007, 0.0));
	float ang2 = acos(clamp(dot(dir, moon_dir2), -1.0, 1.0));
	float disc2 = 1.0 - smoothstep(0.017, 0.023, ang2);
	float crescent = clamp(disc - disc2 * 0.95, 0.0, 1.0);
	col += vec3(0.92, 0.90, 0.82) * crescent * 1.6;
	col += vec3(0.9, 0.88, 0.8) * exp(-ang * 26.0) * 0.10;

	// Los valores de la paleta son sRGB (lo que quiero VER); Godot espera
	// lineal y luego aplica ACES+encode: linealizar y compensar mediostonos.
	COLOR = pow(col, vec3(2.2)) * 1.2;
}
