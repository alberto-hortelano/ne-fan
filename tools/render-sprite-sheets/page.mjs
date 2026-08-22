/** Escena three.js que renderiza las hojas de sprites Mixamo.
 *
 * Es el port 1:1 de la escena de Godot que había en
 * `godot/scenes/dev/sprite_sheet_renderer.tscn` + `scripts/dev/sprite_sheet_renderer.gd`:
 * cámara ortográfica, UNA luz direccional y NADA de ambiente (el SubViewport
 * usaba `own_world_3d` + `transparent_bg`, así que no había WorldEnvironment;
 * meter un AmbientLight aquí aclararía las sombras y rompería la paridad).
 *
 * Vive en el navegador porque three.js necesita un contexto WebGL real; el que
 * conduce es `render.mjs`, que la carga en Chrome headless y llama a
 * `window.__spriteSetup` / `window.__spriteRenderDirection`.
 *
 * Fail-loud: cualquier invariante roto (modelo sin skeleton, animación sin
 * pistas, escala fuera de rango humanoide) lanza. `render.mjs` lo convierte en
 * salida distinta de cero. Nunca se devuelve un frame vacío en silencio.
 */
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

/** Colocación de la cámara para cada ángulo soportado. Espejo exacto de
 *  ANGLE_CAMERA en el renderizador de Godot: la cámara se sitúa sobre un rayo
 *  de longitud `distance` desde el punto mirado, con el picado pedido, y el
 *  tamaño ortográfico deja margen sobre la cabeza y bajo los pies de un
 *  humanoide de ~1,8 m. */
const ANGLE_CAMERA = {
  // El ojo del cliente va a 1,8-3,2 m y ve a los personajes con ~5-11° de
  // depresión; -8° es el compromiso. Es el ÚNICO ángulo: el cliente lo tiene
  // fijo (`worldAngle`), así que una hoja en cualquier otro no la pinta nadie.
  frontal_8: { pitchDeg: -8.0, distance: 4.0, ortho: 2.4 },
};

/** Centro del cuerpo de un humanoide Mixamo de 1,8 m (pose de reposo). Se mira
 *  ahí para encuadrar de pies a cabeza con margen simétrico. */
const TARGET_HEIGHT = 0.95;

/** Dirección de la luz, ya convertida del Euler YXZ de Godot.
 *  `rotation_degrees = (-50, 30, 0)` con orden YXZ aplicado sobre -Z da
 *  (-0.321394, -0.766044, -0.556670): luz desde arriba a la izquierda, para que
 *  la silueta se lea en cualquier orientación. En three la dirección la fija el
 *  par (position, target): se coloca la luz en -dirección y el target en el
 *  origen. */
const LIGHT_DIR = new THREE.Vector3(-0.32139380, -0.76604444, -0.55667040);

/** Animaciones cuyo root motion horneado saca al personaje de la celda del
 *  sprite. En ellas se congela Hips XZ en su primer keyframe. */
const LOCOMOTION_ANIMS = ["walk", "run", "walk_back", "strafe_left", "strafe_right"];

const state = {
  renderer: null,
  scene: null,
  camera: null,
  pivot: null,
  mixer: null,
  clip: null,
};

/** Un FBX de Mixamo viene en centímetros y `FBXLoader` NO normaliza unidades
 *  (el importador de Godot sí lo hacía). Se detecta por la altura del bbox de
 *  la pose de reposo y se corrige con un factor explícito. */
function unitScaleFor(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`modelo sin geometría medible (bbox alto=${height})`);
  }
  const scale = height > 10 ? 0.01 : 1.0;
  const metres = height * scale;
  if (metres < 0.3 || metres > 10) {
    throw new Error(
      `altura implausible tras normalizar unidades: ${metres.toFixed(3)} m ` +
        `(bbox crudo=${height.toFixed(3)}, escala=${scale}) — revisa el FBX`,
    );
  }
  return { scale, metres };
}

/** El nodo de una pista es todo lo que hay antes del último punto:
 *  "mixamorigHips.position" → "mixamorigHips". */
function trackNode(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0) throw new Error(`pista sin propiedad: "${name}"`);
  return { node: name.slice(0, dot), prop: name.slice(dot) };
}

/** Prefijo de hueso del skeleton: lo que precede a "Hips" en el nombre del
 *  hueso raíz. Mixamo exporta `mixamorig:Hips`, que cada importador sanea a su
 *  manera (`mixamorigHips` en three, `mixamorig_Hips` en Godot), y algunos
 *  personajes traen `mixamorig1_`. */
function detectBonePrefix(names) {
  for (const name of names) {
    if (name.endsWith("Hips")) return name.slice(0, name.length - "Hips".length);
  }
  throw new Error(`no hay hueso terminado en "Hips" entre ${names.length} nombres`);
}

/** Reescribe el prefijo de las pistas al del skeleton que las va a recibir.
 *  Equivalente a `_remap_animation_bones` en GDScript, donde las rutas eran
 *  "../Skeleton3D:mixamorig_Hips". */
function remapTrackPrefix(clip, from, to) {
  if (from === to) return 0;
  let remapped = 0;
  for (const track of clip.tracks) {
    const { node, prop } = trackNode(track.name);
    if (!node.startsWith(from)) continue;
    track.name = to + node.slice(from.length) + prop;
    remapped += 1;
  }
  if (remapped === 0) {
    throw new Error(`ninguna pista empezaba por "${from}" (skeleton usa "${to}")`);
  }
  return remapped;
}

/** El root motion horneado de las locomociones de Mixamo desplaza al personaje
 *  a lo largo del ciclo, así que se sale de la celda del sprite. Se congela
 *  Hips en X y Z a su primer keyframe, preservando Y para que sobreviva el
 *  balanceo de la cabeza. Mismo patrón que `_lock_hips_xz_if_locomotion`. */
function lockHipsXZ(clip, animId) {
  if (!LOCOMOTION_ANIMS.includes(animId)) return 0;
  for (const track of clip.tracks) {
    const { node, prop } = trackNode(track.name);
    if (prop !== ".position" || !node.includes("Hips")) continue;
    const v = track.values;
    const keys = v.length / 3;
    if (keys === 0) continue;
    const baseX = v[0];
    const baseZ = v[2];
    for (let k = 0; k < keys; k += 1) {
      v[k * 3] = baseX;
      v[k * 3 + 2] = baseZ;
    }
    return keys;
  }
  throw new Error(`"${animId}" es locomoción pero no tiene pista de posición de Hips`);
}

const _scratchColor = new THREE.Color();

/** Rugosidad por defecto: **mate**. No es un número elegido a ojo, es el default
 *  de `StandardMaterial3D` — el material que construía el importador que produjo
 *  las hojas de referencia, que NO mapeaba el exponente de Phong del FBX. Está
 *  medido: derivando la rugosidad del exponente (`sqrt(2/(s+2))`, que da 0,30
 *  para el paladín) el lóbulo especular queda tan cerrado que quema los realces
 *  en 352 de 352 fotogramas; a rugosidad ≥ 0,5 los quemados caen a cero y el
 *  rango de luminancia se estrecha según sube, hasta casar en 1,0. */
const DEFAULT_ROUGHNESS = 1.0;

/** `FBXLoader` construye `MeshPhongMaterial`; el importador que hizo las hojas
 *  de referencia construía un material PBR. No es lo mismo, y la diferencia no
 *  es de brillo sino de INFORMACIÓN: el especular de Phong es un lóbulo duro que
 *  quema los realces —en el paladín apaga la heráldica del escudo, que es diseño
 *  del personaje, y ningún ajuste de exposición posterior la recupera— mientras
 *  aplasta las sombras a negro. Por eso la media no lo ve: lo que el reflejo
 *  quema por un lado lo compensa la sombra por el otro.
 *
 *  Se convierte a `MeshStandardMaterial` (GGX + Fresnel dieléctrico F0=0.04, que
 *  es exactamente el `specular = 0.5` por defecto del original). El
 *  `SpecularColor` del FBX se descarta a propósito: en PBR no es un color, es el
 *  F0 fijo del dieléctrico.
 *
 *  Los materiales se comparten entre mallas, así que se cachea por uuid. */
function toStandardMaterial(phong, cache, roughnessOverride) {
  if (phong.isMeshStandardMaterial) return phong;
  const hit = cache.get(phong.uuid);
  if (hit) return hit;
  const std = new THREE.MeshStandardMaterial({
    name: phong.name,
    color: phong.color,
    map: phong.map ?? null,
    normalMap: phong.normalMap ?? null,
    normalScale: phong.normalScale?.clone(),
    emissive: phong.emissive,
    emissiveMap: phong.emissiveMap ?? null,
    alphaMap: phong.alphaMap ?? null,
    aoMap: phong.aoMap ?? null,
    transparent: phong.transparent,
    opacity: phong.opacity,
    alphaTest: phong.alphaTest,
    side: phong.side,
    vertexColors: phong.vertexColors,
    roughness: roughnessOverride ?? DEFAULT_ROUGHNESS,
    metalness: 0,
  });
  cache.set(phong.uuid, std);
  return std;
}

/** El FBX guarda los colores planos de material (diffuse, specular, emissive)
 *  en LINEAL, y así los leía el importador de Godot. `FBXLoader` los mete por
 *  la vía sRGB, con lo que el albedo acaba ~3,5× oscuro y hay que compensarlo
 *  subiendo la luz — que además cambia el contraste, no solo el brillo. Aquí se
 *  reinterpretan los mismos números como lineales. NO toca a las texturas, que
 *  sí son sRGB de verdad. */
function fbxColorToLinear(color) {
  if (!color?.isColor) return;
  color.getRGB(_scratchColor, THREE.SRGBColorSpace);
  color.setRGB(_scratchColor.r, _scratchColor.g, _scratchColor.b, THREE.LinearSRGBColorSpace);
}

function loadFbx(url) {
  return new Promise((resolve, reject) => {
    new FBXLoader().load(
      url,
      resolve,
      undefined,
      (err) => reject(new Error(`FBX no cargado (${url}): ${err?.message ?? err}`)),
    );
  });
}

/** Prepara escena, cámara, luz, modelo y animación. Devuelve los datos que el
 *  CLI necesita para decidir cuántos frames pedir y qué escribir en meta.json. */
window.__spriteSetup = async function spriteSetup(opts) {
  const { modelUrl, animUrl, animId, angle, width, height, lightIntensity, durationOverride, roughness } = opts;
  const cfg = ANGLE_CAMERA[angle];
  if (!cfg) {
    throw new Error(`ángulo desconocido "${angle}" (soportados: ${Object.keys(ANGLE_CAMERA)})`);
  }
  if (typeof durationOverride !== "number" || durationOverride <= 0) {
    throw new Error(`durationOverride inválido: ${durationOverride}`);
  }

  // Sin antialias: las hojas de Godot tienen alfa binario (0 o 255) porque el
  // SubViewport no llevaba MSAA. Con MSAA la silueta cambiaría de cobertura.
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = null;

  const target = new THREE.Vector3(0, TARGET_HEIGHT, 0);
  const pitch = THREE.MathUtils.degToRad(cfg.pitchDeg);
  // forward = (0, sin(pitch), -cos(pitch)) mirando hacia -Z; la cámara se pone
  // en target - forward × distance.
  const forward = new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch));
  const halfV = cfg.ortho / 2;
  const halfH = halfV * (width / height);
  const camera = new THREE.OrthographicCamera(-halfH, halfH, halfV, -halfV, 0.01, 100);
  camera.position.copy(target).addScaledVector(forward, -cfg.distance);
  camera.lookAt(target);
  scene.add(camera);

  const light = new THREE.DirectionalLight(0xffffff, lightIntensity);
  light.position.copy(LIGHT_DIR).multiplyScalar(-10);
  light.target.position.set(0, 0, 0);
  scene.add(light);
  scene.add(light.target);

  const pivot = new THREE.Group();
  scene.add(pivot);

  const model = await loadFbx(modelUrl);
  const { scale, metres } = unitScaleFor(model);
  // El wrapper lleva la escala para no pisar la transformada propia del FBX; al
  // colgar de él, las pistas de posición (en cm) quedan también normalizadas.
  const unitWrap = new THREE.Group();
  unitWrap.scale.setScalar(scale);
  unitWrap.add(model);
  pivot.add(unitWrap);

  const boneNames = [];
  const stdCache = new Map();
  const roughnesses = [];
  model.traverse((n) => {
    if (n.isBone) boneNames.push(n.name);
    if (!n.isMesh) return;
    n.frustumCulled = false;
    const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    const converted = mats.map((m) => {
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      for (const key of ["color", "emissive"]) fbxColorToLinear(m[key]);
      const std = toStandardMaterial(m, stdCache, roughness);
      roughnesses.push(Number(std.roughness.toFixed(3)));
      return std;
    });
    if (converted.length > 0) n.material = Array.isArray(n.material) ? converted : converted[0];
  });
  if (boneNames.length === 0) throw new Error(`el modelo ${modelUrl} no trae huesos`);
  const bonePrefix = detectBonePrefix(boneNames);

  const animRoot = await loadFbx(animUrl);
  // Mixamo llama "mixamo.com" a la única pista del FBX de animación; si el
  // importador la renombra, se toma la última, como hacía Godot.
  const clips = animRoot.animations;
  if (!clips || clips.length === 0) throw new Error(`${animUrl} no trae animaciones`);
  const clip = clips.find((c) => c.name === "mixamo.com") ?? clips[clips.length - 1];
  if (clip.tracks.length === 0) throw new Error(`la animación de ${animUrl} no tiene pistas`);

  const clipPrefix = detectBonePrefix(clip.tracks.map((t) => trackNode(t.name).node));
  const remapped = remapTrackPrefix(clip, clipPrefix, bonePrefix);
  const hipsKeys = lockHipsXZ(clip, animId);

  // `FBXLoader` fija la duración en el último keyframe; el intervalo que declara
  // el AnimationStack (que es el que usaba Godot) suele ser mayor. Lo lee
  // `fbx-anim-span.mjs` en Node y llega ya resuelto.
  const trackDuration = clip.duration;
  clip.duration = durationOverride;

  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();

  Object.assign(state, { renderer, scene, camera, pivot, mixer, clip });

  return {
    duration: clip.duration,
    trackDuration,
    trackCount: clip.tracks.length,
    bonePrefix,
    clipPrefix,
    remapped,
    hipsKeys,
    unitScale: scale,
    modelHeightMetres: Number(metres.toFixed(4)),
    boneCount: boneNames.length,
    roughnesses: [...new Set(roughnesses)].sort((x, y) => x - y),
  };
};

/** Renderiza los `frameCount` fotogramas de una dirección y devuelve sus PNG en
 *  data-URL. Se agrupa por dirección para no hacer 353 viajes por CDP. */
window.__spriteRenderDirection = function spriteRenderDirection(dir, directions, frameCount, fps) {
  const { renderer, scene, camera, pivot, mixer, clip } = state;
  if (!renderer) throw new Error("__spriteRenderDirection antes de __spriteSetup");
  pivot.rotation.set(0, (2 * Math.PI * dir) / directions, 0);
  const frameStep = 1 / fps;
  const out = [];
  for (let f = 0; f < frameCount; f += 1) {
    mixer.setTime(Math.min(clip.duration, frameStep * f));
    renderer.render(scene, camera);
    out.push(renderer.domElement.toDataURL("image/png"));
  }
  return out;
};

/** Gancho de depuración: la escena montada (materiales, cámara, luz), para
 *  inspeccionarla desde la consola cuando un render no casa. */
window.__spriteDebugState = state;

window.__spriteReady = true;
