// Agua de la cala: refleja analíticamente el mismo cielo del sky shader,
// fresnel a color profundo, transparencia a guijarro en la orilla, bruma en
// la bocana y caminos de luz view-dependent (banda cámara→farol con destello
// por ruido) para el faro y los farolillos.
shader_type spatial;
render_mode unshaded, cull_back;

uniform vec3 light_pos[4];
uniform vec3 light_col[4];

const vec3 HOR_W = vec3(0.86, 0.44, 0.15);
const vec3 HOR_E = vec3(0.24, 0.21, 0.33);
const vec3 MID = vec3(0.42, 0.30, 0.44);
const vec3 ZEN = vec3(0.075, 0.115, 0.225);

varying vec3 v_world;

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

vec3 sky_color(vec3 d) {
	vec3 dir = normalize(d);
	float h = clamp(dir.y, 0.0, 1.0);
	vec2 az = normalize(dir.xz + vec2(1e-5, 0.0));
	float west = clamp(dot(az, vec2(-1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
	vec3 hor = mix(HOR_E, HOR_W, pow(west, 1.6));
	vec3 col = mix(hor, MID, smoothstep(0.0, 0.22, h));
	col = mix(col, ZEN, smoothstep(0.14, 0.65, h));
	float glow = pow(west, 7.0) * pow(1.0 - h, 4.0);
	col += vec3(1.0, 0.42, 0.12) * glow * 0.55;
	return col;
}

void vertex() {
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 cam = CAMERA_POSITION_WORLD;
	vec3 v = normalize(v_world - cam);
	float n1 = vnoise(v_world.xz * 0.55) - 0.5;
	float n2 = vnoise(v_world.xz * 1.7 + 31.0) - 0.5;
	vec3 n = normalize(vec3(n1 * 0.10 + n2 * 0.05, 1.0, n1 * 0.07 + n2 * 0.05));
	vec3 r = reflect(v, n);
	r.y = max(r.y, 0.015);
	vec3 sky = sky_color(r);
	vec3 deep = vec3(0.07, 0.105, 0.16);
	float fres = pow(1.0 - clamp(dot(-v, n), 0.0, 1.0), 2.4);
	vec3 col = mix(deep, sky * 0.78, 0.36 + 0.64 * fres);
	col *= 0.82 + 0.18 * vnoise(v_world.xz * 0.9 + 7.0);
	float shore = smoothstep(6.0, 9.8, v_world.x);
	col = mix(col, vec3(0.23, 0.20, 0.15), shore * 0.55);
	for (int i = 0; i < 4; i++) {
		vec2 a = cam.xz;
		vec2 b = light_pos[i].xz;
		vec2 ab = b - a;
		float len2 = max(dot(ab, ab), 1e-4);
		float t = clamp(dot(v_world.xz - a, ab) / len2, 0.0, 1.0);
		vec2 p = a + ab * t;
		float d = length(v_world.xz - p);
		float w = 0.25 + light_pos[i].y * 0.12 + t * 0.7;
		float band = exp(-d * d / (w * w));
		float sparkle = smoothstep(0.5, 0.82, vnoise(v_world.xz * vec2(1.2, 2.8) + float(i) * 13.0));
		float dist_l = length(v_world.xz - b);
		float fall = 1.0 / (1.0 + dist_l * dist_l * 0.004);
		col += light_col[i] * band * sparkle * fall;
	}
	float mist = 1.0 - smoothstep(-75.0, -25.0, v_world.x);
	col = mix(col, vec3(0.32, 0.31, 0.42), mist * 0.45);
	// paleta en sRGB → lineal (ver sky_brumaluz.gdshader)
	ALBEDO = pow(col, vec3(2.2)) * 1.2;
}
