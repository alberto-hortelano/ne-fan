// Cala de Brumaluz — implementación three.js LIBRE de DESCRIPCION.md.
// Autoría directa del modelo: geometría procedural, texturas canvas, shaders
// propios (cielo con estrellas, agua con caminos de luz view-dependent).
// Ejes: +x este, +z sur, oeste = mar. y=0 nivel del mar.
import * as THREE from "three";
import { populate } from "./scatter.js";
import { compileGenerators } from "./gen-json.js";

// ---------- utilidades ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260815);

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 8;
  return t;
}

// ---------- texturas procedurales ----------
function texMottle(base, spot, n = 380, alpha = 0.10) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      g.fillStyle = spot;
      g.globalAlpha = alpha * (0.4 + rng() * 0.6);
      const r = 3 + rng() * 14;
      g.beginPath(); g.arc(rng() * w, rng() * h, r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }, { repeat: [1, 1] });
}
function texPlanks(base = "#6d5a44", seam = "#463726", vertical = false) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const p = (i / n) * (vertical ? w : h);
      g.fillStyle = `rgba(0,0,0,${0.10 + rng() * 0.22})`;
      if (vertical) g.fillRect(p, 0, w / n, h); else g.fillRect(0, p, w, h / n);
      g.fillStyle = seam;
      if (vertical) g.fillRect(p, 0, 2, h); else g.fillRect(0, p, w, 2);
      // veta
      g.strokeStyle = `rgba(30,22,12,0.25)`;
      for (let v = 0; v < 5; v++) {
        g.beginPath();
        if (vertical) { const x = p + 4 + rng() * (w / n - 8); g.moveTo(x, 0); g.lineTo(x + (rng() - 0.5) * 8, h); }
        else { const y = p + 4 + rng() * (h / n - 8); g.moveTo(0, y); g.lineTo(w, y + (rng() - 0.5) * 8); }
        g.stroke();
      }
    }
  }, { repeat: [1, 1] });
}
function texTiles(base = "#7a5648") {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const rows = 9, cols = 8;
    for (let r = 0; r < rows; r++) {
      for (let cI = 0; cI < cols; cI++) {
        const x = (cI + (r % 2 ? 0.5 : 0)) * (w / cols), y = r * (h / rows);
        const dk = 0.75 + rng() * 0.45;
        g.fillStyle = `rgba(${(122 * dk) | 0},${(86 * dk) | 0},${(72 * dk) | 0},0.9)`;
        g.beginPath(); g.ellipse(x, y + h / rows, w / cols * 0.52, h / rows * 0.72, 0, Math.PI, 0); g.fill();
        g.strokeStyle = "rgba(20,12,10,0.5)"; g.stroke();
      }
    }
  }, { repeat: [2, 2] });
}
function texStone(base = "#6f6a62") {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#4a463f"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const dk = 0.7 + rng() * 0.6;
      g.fillStyle = `rgba(${(111 * dk) | 0},${(106 * dk) | 0},${(98 * dk) | 0},1)`;
      const x = rng() * w, y = rng() * h, rw = 14 + rng() * 26, rh = 9 + rng() * 15;
      g.beginPath(); g.ellipse(x, y, rw / 2, rh / 2, rng(), 0, 7); g.fill();
    }
  }, { repeat: [2, 1] });
}
function texCobbles() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#3c3f46"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      const dk = 0.65 + rng() * 0.7;
      g.fillStyle = `rgba(${(92 * dk) | 0},${(96 * dk) | 0},${(106 * dk) | 0},1)`;
      g.beginPath(); g.ellipse(rng() * w, rng() * h, 5 + rng() * 8, 4 + rng() * 6, rng(), 0, 7); g.fill();
    }
    // brillo húmedo
    g.fillStyle = "rgba(180,190,215,0.06)";
    for (let i = 0; i < 60; i++) { g.beginPath(); g.arc(rng() * w, rng() * h, 3 + rng() * 5, 0, 7); g.fill(); }
  }, { repeat: [8, 8] });
}
function texPebbles() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#7d7663"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const dk = 0.6 + rng() * 0.8;
      g.fillStyle = `rgba(${(150 * dk) | 0},${(140 * dk) | 0},${(120 * dk) | 0},1)`;
      g.beginPath(); g.ellipse(rng() * w, rng() * h, 3 + rng() * 6, 2.4 + rng() * 4.4, rng(), 0, 7); g.fill();
    }
  }, { repeat: [10, 10] });
}
function texScrub() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#57633f"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const dk = 0.6 + rng() * 0.8;
      g.fillStyle = `rgba(${(100 * dk) | 0},${(116 * dk) | 0},${(74 * dk) | 0},1)`;
      g.beginPath(); g.arc(rng() * w, rng() * h, 3 + rng() * 9, 0, 7); g.fill();
    }
  }, { repeat: [8, 8] });
}
function texNet() {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(28,24,20,0.85)"; g.lineWidth = 1.4;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(0, (i / 8) * h - w / 2); g.lineTo(w, (i / 8) * h + w / 2); g.stroke();
      g.beginPath(); g.moveTo(0, (i / 8) * h + w / 2); g.lineTo(w, (i / 8) * h - w / 2); g.stroke();
    }
  }, { repeat: [4, 2], srgb: true });
}
function texGlow(inner = "255,196,110", mid = "255,150,60") {
  return canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    r.addColorStop(0, `rgba(${inner},0.95)`);
    r.addColorStop(0.35, `rgba(${mid},0.35)`);
    r.addColorStop(1, `rgba(${mid},0)`);
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}
function texMist() {
  return canvasTex(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const r = g.createRadialGradient(rng() * w, h * (0.35 + rng() * 0.4), 2, rng() * w, h / 2, 30 + rng() * 60);
      r.addColorStop(0, "rgba(168,178,205,0.16)");
      r.addColorStop(1, "rgba(168,178,205,0)");
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }
  });
}
function texCloud() {
  return canvasTex(512, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 34; i++) {
      const x = w * (0.08 + rng() * 0.84), y = h * (0.3 + rng() * 0.34), rr = 22 + rng() * 46;
      const r = g.createRadialGradient(x, y, 2, x, y, rr);
      r.addColorStop(0, "rgba(38,40,66,0.55)");
      r.addColorStop(1, "rgba(38,40,66,0)");
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }
    // borde inferior encendido
    for (let i = 0; i < 22; i++) {
      const x = w * (0.1 + rng() * 0.8), y = h * (0.62 + rng() * 0.2), rr = 10 + rng() * 26;
      const r = g.createRadialGradient(x, y, 1, x, y, rr);
      r.addColorStop(0, "rgba(232,150,60,0.30)");
      r.addColorStop(1, "rgba(232,150,60,0)");
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }
  });
}
function texCloudDay() {
  return canvasTex(512, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      const x = w * (0.08 + rng() * 0.84), y = h * (0.3 + rng() * 0.34), rr = 24 + rng() * 48;
      const r = g.createRadialGradient(x, y, 2, x, y, rr);
      r.addColorStop(0, "rgba(240,243,248,0.4)");
      r.addColorStop(1, "rgba(240,243,248,0)");
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }
  });
}
function texMoon() {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(240,238,225,0.95)";
    g.beginPath(); g.arc(w / 2, h / 2, 26, 0, 7); g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.arc(w / 2 - 14, h / 2 - 7, 24, 0, 7); g.fill();
    g.globalCompositeOperation = "source-over";
    const r = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, 60);
    r.addColorStop(0, "rgba(235,232,215,0.25)"); r.addColorStop(1, "rgba(235,232,215,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}
function texSmoke() {
  return canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    r.addColorStop(0, "rgba(150,150,165,0.30)");
    r.addColorStop(1, "rgba(150,150,165,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}
function texSign() {
  return canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = "#4a3a26"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#2a2014"; g.lineWidth = 5; g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = "#d8cba0";
    g.beginPath(); // pez basto
    g.ellipse(w * 0.44, h * 0.5, 30, 12, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(w * 0.66, h * 0.5); g.lineTo(w * 0.82, h * 0.3); g.lineTo(w * 0.82, h * 0.7); g.fill();
  });
}

// ---------- cielo (GLSL compartido con el agua) ----------
const SKY_GLSL = /* glsl */ `
  vec3 skyColor(vec3 d) {
    vec3 dir = normalize(d);
    float h = clamp(dir.y, 0.0, 1.0);
    vec2 az = normalize(dir.xz + vec2(1e-5, 0.0));
    float west = clamp(dot(az, vec2(-1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
    // tarde clara de gameplay: celeste -> azul, oeste apenas dorado
    vec3 horW = vec3(0.95, 0.87, 0.72);
    vec3 horE = vec3(0.78, 0.83, 0.88);
    vec3 hor = mix(horE, horW, pow(west, 1.6));
    vec3 mid = vec3(0.58, 0.72, 0.86);
    vec3 zen = vec3(0.30, 0.49, 0.76);
    vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));
    col = mix(col, zen, smoothstep(0.14, 0.65, h));
    float glow = pow(west, 7.0) * pow(1.0 - h, 4.0);
    col += vec3(1.0, 0.8, 0.5) * glow * 0.25;
    return col;
  }
  float hash13(vec3 p) {
    p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
`;

function buildSky(scene) {
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = skyColor(dir);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(geo, mat));
}

// ---------- agua con caminos de luz ----------
function buildWater(scene, camera, streakLights) {
  const N = streakLights.length;
  const uniforms = {
    uCam: { value: camera.position },
    uLightPos: { value: streakLights.map((l) => new THREE.Vector3(...l.pos)) },
    uLightCol: { value: streakLights.map((l) => new THREE.Color(l.color).multiplyScalar(l.k)) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: false,
    defines: { NL: N },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vW;
      uniform vec3 uCam;
      uniform vec3 uLightPos[NL];
      uniform vec3 uLightCol[NL];
      ${SKY_GLSL}
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash13(vec3(i, 1.0)), b = hash13(vec3(i + vec2(1, 0), 1.0));
        float c = hash13(vec3(i + vec2(0, 1), 1.0)), d = hash13(vec3(i + vec2(1, 1), 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        vec3 V = normalize(vW - uCam);
        // normal ondulada suave (marea alta y quieta)
        float n1 = vnoise(vW.xz * 0.55) - 0.5;
        float n2 = vnoise(vW.xz * 1.7 + 31.0) - 0.5;
        vec3 N = normalize(vec3(n1 * 0.10 + n2 * 0.05, 1.0, n1 * 0.07 + n2 * 0.05));
        vec3 R = reflect(V, N);
        R.y = max(R.y, 0.015);
        vec3 sky = skyColor(R);
        vec3 deep = vec3(0.07, 0.13, 0.15);
        float fres = pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 2.4);
        vec3 col = mix(deep, sky * 0.78, 0.36 + 0.64 * fres);
        col *= 0.82 + 0.18 * vnoise(vW.xz * 0.9 + 7.0);
        // transparencia a guijarro cerca de la orilla (x -> 10)
        float shore = smoothstep(6.0, 9.8, vW.x);
        col = mix(col, vec3(0.23, 0.20, 0.15), shore * 0.55);
        // caminos de luz: banda vertical entre cámara y cada luz, rota por oleaje
        for (int i = 0; i < NL; i++) {
          vec2 A = uCam.xz, B = uLightPos[i].xz;
          vec2 AB = B - A;
          float len2 = max(dot(AB, AB), 1e-4);
          float t = clamp(dot(vW.xz - A, AB) / len2, 0.0, 1.0);
          vec2 P = A + AB * t;
          float d = length(vW.xz - P);
          float w = 0.25 + uLightPos[i].y * 0.12 + t * 0.7;
          float band = exp(-d * d / (w * w));
          float sparkle = smoothstep(0.5, 0.82, vnoise(vW.xz * vec2(1.2, 2.8) + float(i) * 13.0));
          float distToL = length(vW.xz - B);
          float fall = 1.0 / (1.0 + distToL * distToL * 0.004);
          col += uLightCol[i] * band * sparkle * fall;
        }
        // bruma de la bocana come el agua lejana
        float mist = 1.0 - smoothstep(-75.0, -25.0, vW.x);
        col = mix(col, vec3(0.60, 0.65, 0.72), mist * 0.4);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(260, 200, 1, 1);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(-45, 0, 0);
  scene.add(m);
}

// ---------- terreno ----------
function groundH(x, z) {
  let y;
  if (x < 10) y = -0.8;
  else if (x < 16) y = -0.5 + ((x - 10) / 6) * 2.3;
  else y = 1.8;
  if (x > 28) y += (x - 28) * 0.30;
  if (z > 15) y += 1.5;
  if (z > 23) y += 2.1;
  if (z < -17) y += (-17 - z) * 0.22;
  y += (Math.sin(x * 0.7) * Math.cos(z * 0.9)) * 0.05;
  return y;
}

function buildTerrain(scene, mats) {
  const x0 = 7, x1 = 60, z0 = -34, z1 = 40, nx = 106, nz = 148;
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const cPeb = new THREE.Color("#c4b494"), cCob = new THREE.Color("#9aa0ac"),
    cScr = new THREE.Color("#7e8a56"), cAll = new THREE.Color("#a8acb4");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundH(x, z));
    let c;
    if (x < 16.5) c = cPeb;
    else if (z > 5.4 && z < 8.6 && x < 42) c = cAll; // callejón
    else if (z > 14.5 || x > 30) c = cScr;
    else c = cCob;
    const j = 0.9 + rng() * 0.2;
    col[i * 3] = c.r * j; col[i * 3 + 1] = c.g * j; col[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: mats.pebbles, roughness: 0.95,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  scene.add(m);
  // cabo norte tras el espigón (que el espigón no nazca de la nada)
  const cg = new THREE.PlaneGeometry(46, 22, 40, 18);
  cg.rotateX(-Math.PI / 2);
  cg.translate(-11, 0, -27);
  const cp = cg.attributes.position;
  const cc = new Float32Array(cp.count * 3);
  const cCol = new THREE.Color("#5c6644");
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), z = cp.getZ(i);
    const t = Math.min(1, Math.max(0, (-16 - z) / 14));
    let y = -1.2 + t * t * 7.5 + Math.sin(x * 0.35) * 0.5 * t;
    cp.setY(i, y);
    const j = 0.8 + rng() * 0.35;
    cc[i * 3] = cCol.r * j; cc[i * 3 + 1] = cCol.g * j; cc[i * 3 + 2] = cCol.b * j;
  }
  cg.setAttribute("color", new THREE.BufferAttribute(cc, 3));
  cg.computeVertexNormals();
  const scrubFar = mats.scrub.clone();
  scrubFar.repeat.set(2, 2);
  scrubFar.needsUpdate = true;
  const cm = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({
    vertexColors: true, map: scrubFar, roughness: 1,
  }));
  cm.receiveShadow = true;
  scene.add(cm);
}

// ---------- geometría a dos aguas ----------
function gableGeo(w, h, d) {
  // caballete a lo largo de z (profundidad d); base w
  const hw = w / 2, hd = d / 2;
  const v = [];
  const quad = (a, b, c, dd) => v.push(...a, ...b, ...c, ...a, ...c, ...dd);
  const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd];
  const P = [0, h, -hd], Q = [0, h, hd];
  // faldón oeste (−x) y este (+x) — CCW visto desde fuera (three)
  quad(A, D, Q, P);
  quad(C, B, P, Q);
  // hastiales
  v.push(...B, ...A, ...P);
  v.push(...D, ...C, ...Q);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  const uv = [];
  for (let i = 0; i < v.length / 3; i++) uv.push((v[i * 3] + v[i * 3 + 2]) * 0.22, v[i * 3 + 1] * 0.4);
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

// ---------- casas ----------
function addBox(parent, w, h, d, x, y, z, mat, { rotY = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.rotation.y = rotY;
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}

function makeWindow(parent, x, y, z, rotY, lit, mats, { w = 0.55, h = 0.8 } = {}) {
  const mat = lit
    ? new THREE.MeshStandardMaterial({ color: "#201812", emissive: new THREE.Color("#ffb15e"), emissiveIntensity: 0.22 })
    : new THREE.MeshStandardMaterial({ color: "#26303c", roughness: 0.25 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.y = rotY;
  parent.add(m);
  // marco
  const fr = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.14, h + 0.14),
    new THREE.MeshStandardMaterial({ color: "#3a3228" }));
  fr.position.set(x, y, z); fr.rotation.y = rotY;
  fr.translateZ(-0.012);
  parent.add(fr);
}

function house(scene, mats, { x, z, wFront, depth, floors, stone = false, ridgeAlongZ = true, litWindows = [], chimney = false }) {
  const g = new THREE.Group();
  const y0 = groundH(x, z) - 0.15;
  const hWall = floors * 2.55;
  let wallTex = stone ? mats.stone : mats.whitewash;
  if (stone) {
    wallTex = mats.stone.clone();
    wallTex.repeat.set(3, 2);
    wallTex.needsUpdate = true;
  }
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex, roughness: 0.88,
    color: stone ? "#b6b0a4" : "#ded8d2",
  });
  // cuerpo: frente mira al oeste (−x): wFront a lo largo de z, depth a lo largo de x
  addBox(g, depth, hWall, wFront, x, y0, z, wallMat);
  const roofMat = new THREE.MeshStandardMaterial({ map: mats.tiles, roughness: 0.85, color: "#8c7a72" });
  const rh = 1.4 + rng() * 0.7;
  const roofG = ridgeAlongZ ? gableGeo(depth + 0.7, rh, wFront + 0.5) : gableGeo(wFront + 0.5, rh, depth + 0.7);
  const roof = new THREE.Mesh(roofG, roofMat);
  roof.position.set(x, y0 + hWall, z);
  if (!ridgeAlongZ) roof.rotation.y = Math.PI / 2;
  roof.castShadow = true; roof.receiveShadow = true;
  g.add(roof);
  // ventanas cara oeste
  const westX = x - depth / 2 - 0.02;
  const rows = floors;
  let wi = 0;
  for (let f = 0; f < rows; f++) {
    for (let k = -1; k <= 1; k += 2) {
      const wy = y0 + 1.5 + f * 2.5;
      const wz = z + k * wFront * 0.24;
      makeWindow(g, westX, wy, wz, -Math.PI / 2, litWindows.includes(wi), mats);
      wi++;
    }
  }
  if (chimney) {
    const cm = addBox(g, 0.55, 1.5, 0.55, x + depth * 0.2, y0 + hWall + rh - 0.4, z - wFront * 0.25,
      new THREE.MeshStandardMaterial({ map: mats.stone, color: "#8a857c" }));
    g.userData.chimneyTop = new THREE.Vector3(x + depth * 0.2, y0 + hWall + rh + 1.15, z - wFront * 0.25);
  }
  scene.add(g);
  return g;
}

// ---------- barcas ----------
function boat(scene, mats, { x, z, y = null, rotY = 0, rotZ = 0, color, name = "" }) {
  const g = new THREE.Group();
  const hullGeo = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
  hull.scale.set(2.3, 1.05, 0.85);
  hull.castShadow = true;
  g.add(hull);
  // borda
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 8, 36),
    new THREE.MeshStandardMaterial({ map: mats.planks, color: "#7a6448" }));
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(2.3, 0.85, 0.5);
  g.add(rim);
  // interior oscuro
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.96, 28),
    new THREE.MeshStandardMaterial({ color: "#241d14", side: THREE.DoubleSide }));
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = -0.04;
  cap.scale.set(2.3, 0.85, 1); // tras rotX: x=eslora, z(local y)=manga
  g.add(cap);
  // banco
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.35),
    new THREE.MeshStandardMaterial({ map: mats.planks }));
  bench.position.y = 0.02;
  g.add(bench);
  g.position.set(x, y ?? 0.32, z);
  g.rotation.set(0, rotY, rotZ);
  scene.add(g);
  return g;
}

// ---------- figuras humanas (siluetas con volumen) ----------
function figure(scene, { x, y, z, rotY = 0, sitting = false, color = "#232830" }) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, sitting ? 0.42 : 0.55, 4, 10), mat);
  torso.position.y = sitting ? 0.62 : 0.95;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), mat);
  head.position.y = sitting ? 1.05 : 1.46;
  g.add(head);
  if (sitting) {
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.5, 3, 8), mat);
      leg.position.set(0.18, 0.15, s * 0.11);
      leg.rotation.z = -0.25;
      g.add(leg);
    }
  } else {
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.62, 3, 8), mat);
      leg.position.set(0, 0.36, s * 0.09);
      g.add(leg);
    }
  }
  g.traverse((o) => { o.castShadow = true; });
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  scene.add(g);
  return g;
}

// ---------- escena ----------
export async function boot() {
  const P = new URLSearchParams(location.search);
  const POSE = P.get("pose") || "p0";

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color("#c2ccd6"), 80, 280);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 1200);
  const poses = {
    p0: { pos: [-11, 3.8, -9.5], look: [26, 1.8, 7] },
    p1: { pos: [8, 2.6, 0.8], look: [-24, 4.5, -14] },
    p2: { pos: [31, 4.4, 7.0], look: [8, 1.0, 2.5] },
    p3: { pos: [12.0, 2.6, 8.2], look: [16.3, 2.3, 1.6] },
  };
  const pose = poses[POSE] ?? poses.p0;
  camera.position.set(...pose.pos);
  camera.lookAt(...pose.look);

  // materiales compartidos
  const mats = {
    whitewash: (() => { const t = texMottle("#c9c2ba", "#a89f93", 300, 0.08); t.repeat.set(3, 2); return t; })(),
    stone: texStone(),
    tiles: texTiles(),
    planks: texPlanks(),
    planksV: texPlanks("#5d4c3a", "#3a2d1e", true),
    cobbles: texCobbles(),
    pebbles: (() => { const t = texPebbles(); t.repeat.set(16, 16); t.anisotropy = 16; return t; })(),
    scrub: texScrub(),
    net: texNet(),
    glow: texGlow(),
    glowCool: texGlow("235,240,255", "170,190,235"),
    mist: texMist(),
    cloud: texCloud(),
    cloudDay: texCloudDay(),
    moon: texMoon(),
    smoke: texSmoke(),
    sign: texSign(),
  };

  buildSky(scene);

  // ---- luces de ambiente ----
  const hemi = new THREE.HemisphereLight("#b8cade", "#5c564a", 1.05);
  scene.add(hemi);
  const key = new THREE.DirectionalLight("#fff2dc", 2.4);
  key.position.set(-45, 55, 18);
  key.target.position.set(24, 2, 2);
  scene.add(key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -55; key.shadow.camera.right = 55;
  key.shadow.camera.top = 55; key.shadow.camera.bottom = -55;
  key.shadow.camera.far = 250;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.8;
  scene.add(key);
  const fill = new THREE.DirectionalLight("#9db4d8", 0.5);
  fill.position.set(30, 60, 40);
  scene.add(fill);

  // ---- agua (los caminos de luz necesitan las posiciones de los faroles) ----
  // de día los faroles no dibujan caminos en el agua (k≈0); faro testimonial
  const streaks = [
    { pos: [-24, 10.2, -14], color: "#ffca7a", k: 0.1 },
    { pos: [3, 3.1, -0.6], color: "#ff9e4a", k: 0.0 },
    { pos: [6.5, 3.1, 3.6], color: "#ff9e4a", k: 0.0 },
    { pos: [16.2, 4.3, 3.4], color: "#ffab55", k: 0.0 },
  ];
  buildWater(scene, camera, streaks);
  buildTerrain(scene, mats);

  // ---- espigón + faro ----
  {
    const jettyTex = mats.stone.clone();
    jettyTex.repeat.set(10, 2);
    jettyTex.needsUpdate = true;
    const stoneMat = new THREE.MeshStandardMaterial({ map: jettyTex, color: "#cbc2b2", roughness: 0.95 });
    addBox(scene, 36, 2.6, 3.2, -9, -1.3, -14, stoneMat);
    addBox(scene, 36, 0.55, 0.5, -9, 1.3, -15.4, stoneMat); // parapeto lado mar
    for (const bx of [-2, -11, -20]) {
      const nor = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.4, 10),
        new THREE.MeshStandardMaterial({ color: "#20242a", roughness: 0.5, metalness: 0.6 }));
      nor.position.set(bx, 1.5, -13.6);
      nor.castShadow = true;
      scene.add(nor);
    }
    // faro
    const g = new THREE.Group();
    const towerMat = new THREE.MeshStandardMaterial({
      map: canvasTex(64, 256, (gg, w, h) => {
        gg.fillStyle = "#ddd6cc"; gg.fillRect(0, 0, w, h);
        gg.fillStyle = "#a83226";
        gg.fillRect(0, h * 0.30, w, h * 0.14);
        gg.fillRect(0, h * 0.62, w, h * 0.14);
      }),
      roughness: 0.8,
    });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.7, 9, 24), towerMat);
    tower.position.y = 4.5; tower.castShadow = true;
    g.add(tower);
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.28, 24),
      new THREE.MeshStandardMaterial({ color: "#232830" }));
    gallery.position.y = 9.15;
    g.add(gallery);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.25, 16),
      new THREE.MeshStandardMaterial({ color: "#402c14", emissive: new THREE.Color("#ffca7a"), emissiveIntensity: 0.9 }));
    lantern.position.y = 9.9;
    g.add(lantern);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.9, 16),
      new THREE.MeshStandardMaterial({ color: "#1c2026" }));
    cap.position.y = 10.9;
    g.add(cap);
    const lampLight = new THREE.PointLight("#ffca7a", 25, 50, 1.8);
    lampLight.position.y = 9.9;
    g.add(lampLight);
    g.position.set(-24, 1.2, -14);
    scene.add(g);
    // casa del farero
    const kh = new THREE.Group();
    addBox(kh, 3.2, 2.6, 2.6, 0, 0, 0, new THREE.MeshStandardMaterial({ map: mats.stone, color: "#c0baae" }));
    const shed = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.18, 3.0),
      new THREE.MeshStandardMaterial({ map: mats.tiles, color: "#7c6a62" }));
    shed.position.set(0, 2.75, 0); shed.rotation.z = 0.18;
    shed.castShadow = true;
    kh.add(shed);
    makeWindow(kh, -1.62, 1.4, 0, -Math.PI / 2, true, mats, { w: 0.5, h: 0.6 });
    kh.position.set(-20.4, 1.2, -15.9);
    scene.add(kh);
  }

  // ---- muelle de madera ----
  {
    const deckMat = new THREE.MeshStandardMaterial({ map: mats.planks, color: "#7d6a52", roughness: 0.9 });
    const deck = addBox(scene, 18.5, 0.28, 3.6, 7, 0.86, 1.5, deckMat);
    deck.material.map = mats.planks;
    const pileMat = new THREE.MeshStandardMaterial({ map: mats.planksV, color: "#4e3f30" });
    for (let px = -1.5; px <= 15; px += 3.2) {
      for (const pz of [-0.15, 3.15]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.6, 10), pileMat);
        pile.position.set(px, -0.2, pz);
        scene.add(pile);
      }
    }
    // farolillos
    for (const [lx, lz] of [[3, -0.6], [6.5, 3.6]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.9, 8), pileMat);
      post.position.set(lx, 1.95, lz);
      post.castShadow = true;
      scene.add(post);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2),
        new THREE.MeshStandardMaterial({ color: "#3a3126", emissive: new THREE.Color("#ffca7a"), emissiveIntensity: 0.05 }));
      lamp.position.set(lx, 3.0, lz);
      scene.add(lamp);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.14, 4),
        new THREE.MeshStandardMaterial({ color: "#1c1812" }));
      cap.position.set(lx, 3.2, lz);
      scene.add(cap);
    }
    // cajas de pescado
    const crateMat = new THREE.MeshStandardMaterial({ map: mats.planks, color: "#8a7a5e" });
    addBox(scene, 0.8, 0.35, 0.55, 14.6, 1.0, 0.4, crateMat, { rotY: 0.2 });
    addBox(scene, 0.8, 0.35, 0.55, 14.6, 1.35, 0.42, crateMat, { rotY: -0.12 });
    addBox(scene, 0.8, 0.35, 0.55, 15.5, 1.0, 0.9, crateMat, { rotY: 0.4 });
    // nasas
    for (let i = 0; i < 6; i++) {
      const nasa = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.5, 10),
        new THREE.MeshStandardMaterial({ map: mats.net, color: "#7a6a48", transparent: false }));
      const nx = 15.4 + (i % 3) * 0.8, nz = 4.6 + Math.floor(i / 3) * 0.8;
      nasa.position.set(nx, groundH(nx, nz) + 0.28 + (i === 5 ? 0.55 : 0), nz);
      nasa.castShadow = true;
      scene.add(nasa);
    }
  }

  // ---- barcas ----
  boat(scene, mats, { x: 3.5, z: 5.6, rotY: 0.35, color: "#4a6d92" });   // La Garza (azul)
  boat(scene, mats, { x: 1.2, z: -2.6, rotY: -0.2, color: "#5a7052" }); // verde musgo
  boat(scene, mats, { x: 14.2, z: 13.0, y: 1.15, rotY: 2.3, rotZ: 0.42, color: "#7a4634" }); // varada

  // ---- redes tendidas ----
  {
    const postMat = new THREE.MeshStandardMaterial({ map: mats.planksV, color: "#4e3f30" });
    for (const nz of [-4.5, -8]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 8), postMat);
      p.position.set(13.2, groundH(13.2, nz) + 1.1, nz);
      scene.add(p);
    }
    const net = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.6),
      new THREE.MeshStandardMaterial({ map: mats.net, transparent: true, side: THREE.DoubleSide, alphaTest: 0.15 }));
    net.position.set(13.2, groundH(13.2, -6.2) + 1.35, -6.25);
    net.rotation.y = Math.PI / 2;
    scene.add(net);
    for (let i = 0; i < 6; i++) {
      const cork = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
        new THREE.MeshStandardMaterial({ color: "#b09468" }));
      cork.position.set(13.2, groundH(13.2, -6.2) + 2.1, -4.7 - i * 0.6);
      scene.add(cork);
    }
  }

  // ---- casas del frente ----
  const houses = [
    { x: 19, z: 2.8, wFront: 6, depth: 5, floors: 1, litWindows: [0, 1], tavern: true },
    { x: 20, z: -3.8, wFront: 4.5, depth: 5, floors: 2, stone: true, litWindows: [2], chimney: true },
    { x: 19.5, z: -9.2, wFront: 5, depth: 4.5, floors: 2, litWindows: [1] },
    { x: 21, z: 11, wFront: 5, depth: 5, floors: 1, litWindows: [0] },
    { x: 27, z: 13.5, wFront: 4.5, depth: 4, floors: 1, stone: true, litWindows: [] },
    { x: 26.5, z: 0.5, wFront: 5.5, depth: 5, floors: 2, litWindows: [3], chimney: true, ridgeAlongZ: false },
    { x: 27.5, z: -7, wFront: 5, depth: 4.5, floors: 1, stone: true, litWindows: [] },
  ];
  let smoking = null;
  for (const spec of houses) {
    const g = house(scene, mats, spec);
    if (spec.x === 26.5) smoking = g;
  }

  // ---- taberna: porche, farol, barril, cartel, tabernera ----
  {
    const y0 = groundH(19, 2.8) - 0.15;
    const woodMat = new THREE.MeshStandardMaterial({ map: mats.planksV, color: "#5d4c38" });
    // porche
    for (const pz of [0.6, 5.0]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 2.3, 8), woodMat);
      post.position.set(14.9, y0 + 1.15, pz);
      post.castShadow = true;
      scene.add(post);
    }
    const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 5.4),
      new THREE.MeshStandardMaterial({ map: mats.tiles, color: "#77655d" }));
    porchRoof.position.set(15.6, y0 + 2.5, 2.8);
    porchRoof.rotation.z = 0.22;
    porchRoof.castShadow = true;
    scene.add(porchRoof);
    // puerta abierta con luz derramada
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.9),
      new THREE.MeshStandardMaterial({ color: "#100a06", emissive: new THREE.Color("#ffb868"), emissiveIntensity: 0.3 }));
    door.position.set(16.44, y0 + 1.05, 2.6);
    door.rotation.y = -Math.PI / 2;
    scene.add(door);
    const doorLight = new THREE.SpotLight("#ffb868", 5, 7, 1.0, 0.6, 1.6);
    doorLight.position.set(16.2, y0 + 1.7, 2.6);
    doorLight.target.position.set(13.8, y0, 2.6);
    scene.add(doorLight, doorLight.target);
    // farol sobre la puerta (apagado de día)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2),
      new THREE.MeshStandardMaterial({ color: "#3a3126", emissive: new THREE.Color("#ffca7a"), emissiveIntensity: 0.05 }));
    lamp.position.set(16.2, y0 + 2.6, 3.4);
    scene.add(lamp);
    // barril
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.85, 14),
      new THREE.MeshStandardMaterial({ map: mats.planksV, color: "#6d5233" }));
    barrel.position.set(15.6, y0 + 0.43, 4.6);
    barrel.castShadow = true;
    scene.add(barrel);
    // cartel colgado
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.65),
      new THREE.MeshStandardMaterial({ map: mats.sign, side: THREE.DoubleSide }));
    sign.position.set(15.8, y0 + 2.15, 0.9);
    sign.rotation.y = -Math.PI / 2 + 0.15;
    scene.add(sign);
    // tabernera a contraluz
    figure(scene, { x: 15.5, y: y0, z: 2.65, rotY: Math.PI / 2, color: "#1d222c" });
  }

  // ---- callejón: farol a media cuesta ----
  {
    const x = 27.5, z = 8.2, y0 = groundH(x, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.2, 8),
      new THREE.MeshStandardMaterial({ color: "#22262c", metalness: 0.5, roughness: 0.5 }));
    post.position.set(x, y0 + 1.6, z);
    post.castShadow = true;
    scene.add(post);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2),
      new THREE.MeshStandardMaterial({ color: "#3a3126", emissive: new THREE.Color("#ffca7a"), emissiveIntensity: 0.05 }));
    lamp.position.set(x, y0 + 3.25, z);
    scene.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.14, 4),
      new THREE.MeshStandardMaterial({ color: "#1c1812" }));
    cap.position.set(x, y0 + 3.45, z);
    scene.add(cap);
  }

  // ---- muretes de bancal ----
  {
    const wallMat = new THREE.MeshStandardMaterial({ map: mats.stone, color: "#7b756b" });
    for (const [zw, hw] of [[15, 1.7], [23, 2.3]]) {
      for (let sx = 16; sx < 56; sx += 8) {
        const yb = groundH(sx + 4, zw - 0.6);
        addBox(scene, 8.2, hw, 0.7, sx + 4, yb - 0.3, zw, wallMat);
      }
    }
  }

  // ---- vegetación: higuera + cipreses ----
  {
    const trunkMat = new THREE.MeshStandardMaterial({ color: "#4c4034", roughness: 1 });
    const figY = groundH(24, 18);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 2.0, 8), trunkMat);
    trunk.position.set(24, figY + 1.0, 18);
    trunk.rotation.z = 0.3;
    trunk.castShadow = true;
    scene.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: "#2e3d26", roughness: 1 });
    for (const [dx, dy, dz, s] of [[-1.1, 2.4, 0, 2.6], [0.6, 2.9, 0.7, 2.2], [0.1, 2.6, -0.9, 2.0]]) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), leafMat);
      blob.position.set(24 + dx, figY + dy, 18 + dz);
      blob.scale.set(s, s * 0.55, s * 0.8);
      blob.castShadow = true;
      scene.add(blob);
    }
    const cypMat = new THREE.MeshStandardMaterial({ color: "#1e2a1c", roughness: 1 });
    for (const [cx, cz, ch] of [[32, 26.5, 5.5], [35.5, 28, 6.5], [38.5, 26, 5]]) {
      const cy = groundH(cx, cz);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.75, ch, 10), cypMat);
      cone.position.set(cx, cy + ch / 2, cz);
      cone.castShadow = true;
      scene.add(cone);
    }
  }

  // ---- ermita ----
  {
    const x = 37, z = 30;
    const y0 = groundH(x, z) - 0.1;
    const em = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ map: mats.whitewash, color: "#cac3bb" });
    addBox(em, 3.4, 2.6, 4.6, 0, 0, 0, wallMat);
    const roof = new THREE.Mesh(gableGeo(3.9, 1.2, 5.1),
      new THREE.MeshStandardMaterial({ map: mats.tiles, color: "#84726a" }));
    roof.position.y = 2.6;
    roof.castShadow = true;
    em.add(roof);
    // espadaña con campana
    addBox(em, 1.5, 1.7, 0.35, 0, 3.5, -2.2, wallMat);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.8),
      new THREE.MeshBasicMaterial({ color: "#20283f", side: THREE.DoubleSide }));
    hole.position.set(0, 4.35, -2.2 + 0.19);
    em.add(hole);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: "#5c5030", metalness: 0.7, roughness: 0.4 }));
    bell.position.set(0, 4.4, -2.2);
    em.add(bell);
    const spTop = new THREE.Mesh(gableGeo(1.7, 0.5, 0.5), wallMat);
    spTop.position.set(0, 5.35, -2.2);
    spTop.rotation.y = Math.PI / 2;
    em.add(spTop);
    em.position.set(x, y0, z);
    em.rotation.y = 0.2;
    em.traverse((o) => { o.castShadow = true; });
    scene.add(em);
  }

  // ---- pescador sentado en el muelle ----
  figure(scene, { x: -1.4, y: 1.0, z: 1.0, rotY: -Math.PI / 2, sitting: true, color: "#262c38" });
  {
    // caña + sedal
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 2.4, 6),
      new THREE.MeshStandardMaterial({ color: "#3a2f22" }));
    rod.position.set(-2.6, 1.9, 1.0);
    rod.rotation.z = 1.0;
    scene.add(rod);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-3.75, 2.4, 1.0), new THREE.Vector3(-3.9, 0.02, 1.0),
    ]);
    scene.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: "#0c0c10" })));
  }

  // ---- gaviotas ----
  {
    const gm = new THREE.MeshStandardMaterial({ color: "#8f8d88", roughness: 0.95 });
    const spots = [[-6, 1.85, -15.3], [-14, 1.85, -15.3], [3, 1.05, 2.9], [14.5, 2.15, 13.5]];
    for (const [gx, gy, gz] of spots) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), gm);
      body.scale.set(1.5, 0.9, 0.8);
      b.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), gm);
      head.position.set(0.16, 0.12, 0);
      b.add(head);
      b.position.set(gx, gy, gz);
      b.rotation.y = rng() * 6.3;
      scene.add(b);
    }
  }

  // ---- humo de chimenea ----
  if (smoking?.userData.chimneyTop) {
    const top = smoking.userData.chimneyTop;
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: mats.smoke, transparent: true, depthWrite: false, opacity: 0.16 - i * 0.018,
        color: "#d8dce4",
      }));
      s.position.set(top.x + i * 0.55 + rng() * 0.3, top.y + i * 0.75, top.z + (rng() - 0.5) * 0.4);
      const sc = 0.8 + i * 0.55;
      s.scale.set(sc, sc, 1);
      scene.add(s);
    }
  }

  // ---- bruma de la bocana ----
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mats.mist, transparent: true, depthWrite: false, opacity: 0.28,
    }));
    s.position.set(-34 - i * 11, 2.2 + rng() * 1.5, -22 + i * 10 + (rng() - 0.5) * 8);
    s.scale.set(46, 9, 1);
    scene.add(s);
  }

  // ---- nubes blancas de tarde ----
  for (const [cx, cy, cz, sw] of [[-260, 46, -70, 200], [-240, 30, 60, 160], [-190, 62, -10, 150]]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mats.cloudDay, transparent: true, depthWrite: false, opacity: 0.55,
    }));
    s.position.set(cx, cy, cz);
    s.scale.set(sw, sw * 0.2, 1);
    scene.add(s);
  }

  // ---- scatter declarativo (lo que emitiría el motor narrativo) ----
  // Run 003: los generadores ya NO son código — son JSON puro
  // (generadores.json, árbol de primitivas con rangos) validado y compilado
  // por gen-json.js. Es el formato que el motor narrativo podría emitir.
  const gspecs = await (await fetch(new URL("./generadores.json", import.meta.url))).json();
  const generators = compileGenerators(gspecs);
  // altura del cabo norte (malla propia, no groundH)
  const headlandH = (x, z) => {
    const t = Math.min(1, Math.max(0, (-16 - z) / 14));
    return -1.2 + t * t * 7.5 + Math.sin(x * 0.35) * 0.5 * t;
  };
  const zones = [
    { kind: "pino", shape: { type: "poly", pts: [[18, 25.4], [58, 25.4], [58, 40], [14, 38]] }, density: 0.045, sink: 0.3 },
    { kind: "pino", shape: { type: "rect", x0: -28, z0: -36, x1: 5, z1: -21 }, density: 0.035, groundH: headlandH, minY: 0.4, sink: 0.3 },
    { kind: "matorral", shape: { type: "rect", x0: 16.5, z0: 15.8, x1: 52, z1: 22.6 }, density: 0.09 },
    { kind: "matorral", shape: { type: "rect", x0: 29, z0: -14, x1: 52, z1: 15 }, density: 0.05 },
    { kind: "matorral", shape: { type: "rect", x0: 16.5, z0: -16, x1: 29, z1: -11 }, density: 0.05 },
    { kind: "roca", shape: { type: "rect", x0: 10, z0: -16, x1: 16.2, z1: 14.5 }, density: 0.09, sink: 0.12 },
    { kind: "roca", shape: { type: "rect", x0: 16.5, z0: 15.8, x1: 52, z1: 22.6 }, density: 0.02, sink: 0.12 },
    { kind: "olivo", shape: { type: "rect", x0: 17, z0: 16.2, x1: 50, z1: 22.2 }, density: 0.018, sink: 0.15 },
    { kind: "junco", shape: { type: "rect", x0: 9.4, z0: -11, x1: 12.2, z1: 14.5 }, density: 0.6, minY: -0.5, maxY: 0.7, sink: 0.05 },
  ];
  const exclusions = [
    ...houses.map((hh) => ({
      x0: hh.x - hh.depth / 2 - 0.9, z0: hh.z - hh.wFront / 2 - 0.9,
      x1: hh.x + hh.depth / 2 + 0.9, z1: hh.z + hh.wFront / 2 + 0.9,
    })),
    { x0: -3.5, z0: -1.2, x1: 17, z1: 4.4 },   // muelle + arranque
    { x0: 16, z0: 4.9, x1: 46, z1: 9.1 },       // callejón
    { x0: 13.2, z0: -0.2, x1: 17, z1: 5.8 },    // porche taberna
    { x0: 33, z0: 26, x1: 41, z1: 34 },         // ermita
    { cx: 24, cz: 18, r: 3.6 },                 // higuera
    { cx: 35.5, cz: 27, r: 5 },                 // cipreses
    { cx: 14.2, cz: 13.0, r: 2.6 },             // barca varada
    { x0: 12.4, z0: -9.2, x1: 14.2, z1: -3.6 }, // redes
    { x0: 14.8, z0: 4.0, x1: 17.6, z1: 6.2 },   // nasas
    { x0: 26.3, z0: 7.2, x1: 28.7, z1: 9.2 },   // farol del callejón
  ];
  const counts = populate(scene, zones, generators, { groundH, seed: 7, exclusions });
  const countsDiv = document.createElement("div");
  countsDiv.id = "scatter-counts";
  countsDiv.style.display = "none";
  countsDiv.textContent = JSON.stringify(counts);
  document.body.appendChild(countsDiv);

  // ---- render ----
  const fit = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  addEventListener("resize", fit);
  fit();
  let frames = 0;
  const tick = () => {
    fit();
    if (++frames < 8) requestAnimationFrame(tick);
    else window.__ready = true;
  };
  requestAnimationFrame(tick);
}
