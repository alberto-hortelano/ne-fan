/** Internals WebGL de la vista FPS (import DINÁMICO desde FpsRenderer — three
 *  no entra en el bundle base). Port del bench labs/fps/lib.mjs con las
 *  convenciones del juego:
 *
 *  - Renderer y canvas PROPIOS, y desde que se retiraron la oblicua y el
 *    plató son también los ÚNICOS: este fichero es el único importador de
 *    three del cliente y el único contexto WebGL de la pestaña.
 *  - Un THREE.Group por tile (prims en metros, offset = world_rect del tile);
 *    materiales por grupo de caras indexados por celda del atlas — el clay es
 *    el color del prim y applyAtlas() los texturiza sin reconstruir geometría.
 *  - Billboards y_bot de 8 direcciones: la dirección es
 *    `yaw_entidad − yaw(entidad→cámara)` — misma familia que pickDirection de
 *    las otras vistas (allí la cámara está en +z ⇒ yaw(ent→cám) = 0). El signo
 *    invertido espeja izquierda/derecha: frente/espalda coinciden y solo se
 *    delata cuando el personaje CRUZA por delante (bug del playtest 2026-08-16).
 */

import * as THREE from "three";
import {
  DENSITY_M,
  SHAPE_GROUPS,
  type SurfaceAssign,
  type SurfaceCell,
  type SurfaceGroup,
  type SurfaceLayout,
  type SurfacePrim,
} from "@nefan-core/src/scene/greybox/surfaces.js";
import { reliefAtM, type ReliefGrid } from "@nefan-core/src/scene/blueprint/fps-relief.js";
import { GROUND_OVERLAY_Y_M } from "@nefan-core/src/scene/blueprint/fps-spec.js";
import {
  attackAreaMargin,
  attackAreaQuality,
  attackAreaReach,
} from "@nefan-core/src/combat/attack-area.js";
import { TILE_CELLS, TILE_MPC } from "@nefan-core/src/scene/tile.js";

/** Lado del tile en metros (64). */
const TILE_SIZE_M = TILE_CELLS * TILE_MPC;
import type { GreyboxLight } from "@nefan-core/src/scene/greybox/common.js";
import type { Vec3 } from "@nefan-core/src/types.js";
import type { Edge } from "@nefan-core/src/world-map/types.js";
import type { AttackTelegraph, Entity, PlayerView } from "./types.js";
import { SPRITE_PENDING, type SpriteRenderer } from "./sprite-renderer.js";

const EYE_M = 1.6;
const FOV_DEG = 70;
/** Duración del tween de giro (presentación; el estado es el yaw lógico). */
const TURN_TIME_S = 0.1;
/** El frame de 256 px del sheet cubre 2.4 m (SHEET_FRAME_WORLD_M). */
const FRAME_WORLD_M = 2.4;
/** Los pies caen al 85 % del frame desde arriba. */
const FEET_FROM_BOTTOM = 0.15;
const SKY_TOP = "#8db4d6";
const SKY_BOTTOM = "#d8cfb4";
const FOG_NEAR = 25;
const FOG_FAR = 90;

export interface AtlasImage {
  image: HTMLImageElement | ImageBitmap;
  kind: "tile" | "unique";
}

/** Modos de la tecla B: off → colisión → celdas de atlas. */
export type FpsDebugView = "off" | "collision" | "surfaces";

/** Celdas sólidas del tile activo, en METROS de mundo (esquina mínima). */
export interface FpsDebugCollision {
  cells: [number, number][];
  size: number;
}

/** Altura a la que va cualquier calco sobre el suelo, en metros. NO es un
 *  número de este fichero: sale de la cara alta del stack de rasgos planos que
 *  emite el greybox más su holgura, y ese techo lo fija —y lo canda— el core
 *  (`GROUND_OVERLAY_Y_M`). El cliente solo pinta a la altura que le dicen. */
const GROUND_OVERLAY_Y = GROUND_OVERLAY_Y_M;

/** Base del `renderOrder` de los calcos de suelo. Los rasgos de `ground` son
 *  coplanares por capa y su prioridad la resuelve el ORDEN DE PINTADO
 *  (`groundOrder` del core), no la altura. Va muy por debajo de 0 para que
 *  todos los calcos se pinten ANTES que el resto de transparentes de la
 *  escena —el muro de niebla (1) y el telegraph (2) incluidos—: un calco de
 *  suelo nunca debe taparlos. Con margen para las 1984 prims que el schema
 *  llega a permitir. */
const GROUND_DECAL_ORDER_BASE = -10000;

// ── Telegraph del ataque ──────────────────────────────────────────────────
/** Resolución de la rejilla del telegraph (avance × lateral). Topología fija:
 *  las posiciones se re-drapean cada frame y la calidad solo al cambiar los
 *  params del ataque. El lateral subió de 10 a 24 cuando el parche empezó a
 *  dibujar el arco del cono: con 10 pasos la cuerda salía facetada. */
const TELEGRAPH_U_STEPS = 24;
const TELEGRAPH_S_STEPS = 24;
/** Semiancho del contorno del borde, en metros. El área entera se ve, pero lo
 *  que hay que LEER es dónde deja de llegar el golpe: una banda de ±15 cm
 *  centrada en la frontera se distingue a los pies sin comerse un parche
 *  pequeño (`precise` tiene 0,7 m de radio). */
const TELEGRAPH_RIM_M = 0.15;
/** Margen que la rejilla se extiende MÁS ALLÁ del área. Sin él la mitad
 *  exterior del contorno quedaría recortada por el borde de la malla y la
 *  frontera volvería a leerse como un corte, no como un límite. */
const TELEGRAPH_PAD_M = TELEGRAPH_RIM_M * 1.4;
/** Alfa mínima del relleno DENTRO del área. La alfa era la calidad, así que
 *  donde el color decía "rojo, aquí ya casi no llegas" la alfa valía cero y no
 *  se veía nada: el jugador solo veía el punto dulce y no el alcance (#184).
 *  Con suelo, el degradado sigue diciendo dónde pega mejor y el área entera se
 *  ve. */
const TELEGRAPH_FILL_MIN_A = 0.28;
/** Altura del parche sobre el terreno: la de cualquier calco de suelo. Estuvo
 *  a 45 cm mientras la cámara era de yaw puro —el combate cuerpo a cuerpo
 *  (0,9–2,5 m) caía por debajo del encuadre y había que levantarlo para que
 *  asomara—. Con mirada vertical el jugador baja los ojos y lo ve entero, así
 *  que vuelve al suelo, que es donde informa sin mentir. */
const TELEGRAPH_Y_M = GROUND_OVERLAY_Y;
/** El overlay de la vista cenital se mira de frente; en primera persona el
 *  mismo parche se ve en rasante y la alfa efectiva por píxel se desploma.
 *  Ganancia propia de esta vista sobre la opacidad que manda el juego. */
const TELEGRAPH_GAIN = 2.2;

// ── Muro de niebla de la frontera ─────────────────────────────────────────
/** Alto del muro en metros: a 0,25 m del ojo tapa 88° de vertical; a 8 m
 *  (VEIL_M del FrontierManager) sigue por encima del borde superior del FOV. */
const VEIL_H_M = 12;
/** Sobreancho respecto al lado del tile: el difuminado lateral cae FUERA del
 *  tile, así que la frontera queda cubierta de esquina a esquina. */
const VEIL_OVERSHOOT_M = 12;
/** Metros hacia dentro del tile: el borde duro del suelo queda detrás. */
const VEIL_INSET_M = 0.25;
/** Aparición y disipación. La disipación ES el feedback de que el vecino
 *  llegó: lenta a propósito, para que se vea descubrir el terreno nuevo. */
const VEIL_FADE_IN_S = 0.4;
const VEIL_FADE_OUT_S = 0.9;
/** Alfa máxima al pie del muro. No 1.0: un negro/gris absoluto lee como
 *  telón; con 0,94 la niebla conserva algo de aire. */
const VEIL_MAX_ALPHA = 0.94;

/** Muro de niebla: un BANCO, no un telón. Denso a ras de suelo (tapa el corte
 *  del terreno en la frontera), aún denso a la altura del ojo, y disuelto por
 *  arriba. El color lo inyecta el uniforme: es la MISMA niebla que ya cierra
 *  el horizonte, acercada.
 *
 *  Lo que lo hacía leer como muro —o como tolvanera— era el borde de arriba:
 *  la niebla es del color del horizonte y por encima de él tiene AZUL detrás,
 *  así que aunque el alfa se difuminara, el color cantaba. La cura no es más
 *  transparencia, es FUNDIRSE: cada fragmento calcula la elevación de su
 *  propia dirección de vista y toma el color exacto que la cúpula del cielo
 *  pinta ahí (el mismo `mix(bottom, top, y*2.2)` de skyDome). Arriba el muro
 *  es literalmente el cielo que tiene detrás y deja de tener contorno; abajo,
 *  donde lo que tapa es terreno, sigue siendo niebla. El grano de dos
 *  frecuencias se apaga con la fusión: donde el muro es cielo, nada vibra. */
const VEIL_FRAGMENT = `
varying vec2 vUv;
varying vec3 vWorld;
uniform vec3 uColor;
uniform vec3 uSkyBottom;
uniform vec3 uSkyTop;
uniform float uOpacity;
void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  vec3 cielo = mix(uSkyBottom, uSkyTop, clamp(dir.y * 2.2, 0.0, 1.0));
  float fusion = smoothstep(-0.02, 0.32, dir.y);
  float alto = 1.0 - smoothstep(0.04, 0.62, vUv.y);
  float lados = smoothstep(0.0, 0.09, vUv.x) * smoothstep(0.0, 0.09, 1.0 - vUv.x);
  float n = sin(vUv.x * 13.0) * sin(vUv.y * 5.0 + 0.7)
          + 0.5 * sin(vUv.x * 29.0 + 2.1) * sin(vUv.y * 11.0);
  float grano = 0.07 * n * (1.0 - fusion);
  float a = clamp(uOpacity * alto * lados * (1.0 + grano), 0.0, 1.0);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(mix(uColor, cielo, fusion), a);
}`;

const VEIL_VERTEX = `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 mundo = modelMatrix * vec4(position, 1.0);
  vWorld = mundo.xyz;
  gl_Position = projectionMatrix * viewMatrix * mundo;
}`;

/** Telegraph: la calidad por vértice (0..1) es la MISMA que resuelve el daño
 *  (`attack-area` de core), así que el color no adorna — informa. Rojo en el
 *  borde del área, verde en el punto óptimo; en impacto, tinte plano de
 *  resultado.
 *
 *  Dos variables, no una. La calidad (`vQ`) dice CUÁNTO pega; el margen al
 *  borde (`vM`, metros, negativo dentro) dice HASTA DÓNDE llega. Antes la
 *  alfa era la calidad, y como el color rojo exige calidad 0, la rampa roja
 *  tenía alfa 0: el límite del área —lo único que evita fallar el golpe— era
 *  justo lo invisible. Ahora el relleno tiene suelo de alfa dentro del área y
 *  el borde se dibuja como CONTORNO desde el margen, que sí sabe distinguir
 *  "al filo" de "lejísimos". El contorno cubre los tres límites: el anillo
 *  radial, la banda lateral y el arco del cono frontal. */
const TELEGRAPH_FRAGMENT = `
varying float vQ;
varying float vM;
uniform float uOpacity;
uniform float uImpact;
uniform float uRim;
uniform float uFillMin;
uniform vec3 uImpactColor;
void main() {
  vec3 rojo = vec3(1.0, 0.18, 0.10);
  float dentro = step(vM, 0.0);
  float borde = 1.0 - smoothstep(0.0, uRim, abs(vM));
  // Relleno: suelo de alfa + degradado de calidad. En impacto, silueta plana
  // del área (el destello dice resultado, no alcance) y sin contorno.
  float relleno = dentro * mix(uFillMin + (1.0 - uFillMin) * vQ, 1.0, uImpact);
  float a = max(relleno, borde * (1.0 - uImpact)) * uOpacity;
  if (a <= 0.004) discard;
  vec3 windup = mix(rojo, vec3(0.20, 1.0, 0.28), vQ);
  // El contorno es rojo pase lo que pase: es el "hasta aquí".
  vec3 c = mix(mix(windup, rojo, borde), uImpactColor, uImpact);
  gl_FragColor = vec4(c, a);
}`;

const TELEGRAPH_VERTEX = `
attribute float aQuality;
attribute float aMargin;
varying float vQ;
varying float vM;
void main() {
  vQ = aQuality;
  vM = aMargin;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Tinte determinista por celda de atlas (modo surfaces). */
function tintColor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const c = new THREE.Color();
  c.setHSL((h % 360) / 360, 0.75, 0.55);
  return c.getHex();
}

interface TileEntry {
  group: THREE.Group;
  /** Materiales por celda del atlas (varios prims comparten celda). */
  materialsByCell: Map<string, THREE.MeshStandardMaterial[]>;
  /** Detalle procedural clay del suelo: se oculta con atlas aplicado. */
  detailMeshes: THREE.Mesh[];
  textured: boolean;
  /** Relieve del suelo (rejilla en metros) + origen del tile, para anclar
   *  cámara, billboards y entidades a la altura visual del terreno. */
  relief?: ReliefGrid;
  rect: { minX: number; minZ: number };
  /** Ambientación del tile: luces + cielo/niebla — se aplican cuando el
   *  JUGADOR pisa el tile (no "el último instalado"): cruzar la frontera
   *  día↔atardecer cambia la luz de verdad. */
  lightsM: GreyboxLight[];
  ambience?: { sky?: { top: string; bottom: string }; fog?: { color: string; near: number; far: number } };
  /** Cara ALTA real de los calcos de suelo instalados (metros de mundo,
   *  relieve incluido), y cuántos hay. No adorna: es lo que permite afirmar
   *  desde fuera —sin leer píxeles— que el telegraph del ataque se dibuja POR
   *  ENCIMA del suelo y no enterrado bajo un embarcadero, que es justo lo que
   *  pasaba (#185) y lo que ninguna captura demuestra por sí sola. */
  groundTopY: number;
  groundDecals: number;
}

function gableGeometry(w: number, h: number, d: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

/** Geometría de una prim (espejo de primitiveMesh del greybox de plató) +
 *  tamaños de cara para las UVs tileables. */
function primitiveGeometry(p: SurfacePrim): {
  geo: THREE.BufferGeometry;
  faceUvSizes: [number, number][] | null;
  extrude: boolean;
} {
  const s = p.size;
  switch (p.shape) {
    case "box": {
      // Suelo con relieve: box subdividida y tapa desplazada por la rejilla
      // (los faldones laterales siguen a la tapa — sin grietas en el borde).
      if (p.relief) {
        const grid = p.relief;
        const g = new THREE.BoxGeometry(s[0], s[1], s[2], grid.n, 1, grid.n);
        g.translate(0, s[1] / 2, 0);
        const posAttr = g.attributes.position;
        for (let vi = 0; vi < posAttr.count; vi++) {
          if (posAttr.getY(vi) < s[1] - 1e-6) continue;
          const lx = p.pos[0] + posAttr.getX(vi);
          const lz = p.pos[2] + posAttr.getZ(vi);
          posAttr.setY(vi, s[1] + reliefAtM(grid, lx, lz));
        }
        posAttr.needsUpdate = true;
        g.computeVertexNormals();
        return {
          geo: g,
          faceUvSizes: [[s[2], s[1]], [s[2], s[1]], [s[0], s[2]], [s[0], s[2]], [s[0], s[1]], [s[0], s[1]]],
          extrude: false,
        };
      }
      const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
      g.translate(0, s[1] / 2, 0);
      return {
        geo: g,
        faceUvSizes: [[s[2], s[1]], [s[2], s[1]], [s[0], s[2]], [s[0], s[2]], [s[0], s[1]], [s[0], s[1]]],
        extrude: false,
      };
    }
    case "gable":
      return { geo: gableGeometry(s[0], s[1], s[2]), faceUvSizes: null, extrude: true };
    case "cylinder": {
      const g = new THREE.CylinderGeometry(s[2] ?? s[0], s[0], s[1], 24);
      g.translate(0, s[1] / 2, 0);
      return {
        geo: g,
        faceUvSizes: [[2 * Math.PI * s[0], s[1]], [2 * s[0], 2 * s[0]], [2 * s[0], 2 * s[0]]],
        extrude: false,
      };
    }
    case "cone": {
      const g = new THREE.ConeGeometry(s[0], s[1], Math.max(3, Math.round(s[2] ?? 16)));
      g.translate(0, s[1] / 2, 0);
      return { geo: g, faceUvSizes: [[2 * Math.PI * s[0], Math.hypot(s[0], s[1])]], extrude: false };
    }
    case "sphere": {
      const r = s[0];
      const seg = Math.max(6, Math.round(s[1] ?? 16));
      const g = new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg / 2)));
      g.translate(0, r, 0);
      return { geo: g, faceUvSizes: [[2 * Math.PI * r, Math.PI * r]], extrude: false };
    }
    case "polygon": {
      const pts = p.points ?? [];
      if (pts.length < 3) throw new Error(`fps-gl: polygon con ${pts.length} points`);
      const t = s[0] ?? 0.02;
      const shape = new THREE.Shape();
      shape.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
      g.rotateX(Math.PI / 2);
      g.translate(0, t, 0);
      return { geo: g, faceUvSizes: null, extrude: true };
    }
    default:
      throw new Error(`fps-gl: shape desconocida "${(p as { shape: string }).shape}"`);
  }
}

function scaleGroupUVs(geo: THREE.BufferGeometry, group: { start: number; count: number }, su: number, sv: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return;
  // Caras MENORES que el periodo (props de <2.5 m) muestrean una fracción de
  // la celda: centrarla — el rango [0..frac] pegado al borde caía de lleno en
  // la banda del feather y la cara salía lavada (prueba real 2026-08-14).
  const ou = su < 1 ? (1 - su) / 2 : 0;
  const ov = sv < 1 ? (1 - sv) / 2 : 0;
  const index = geo.index;
  const seen = new Set<number>();
  for (let i = group.start; i < group.start + group.count; i++) {
    const v = index ? index.getX(i) : i;
    if (seen.has(v)) continue;
    seen.add(v);
    uv.setXY(v, uv.getX(v) * su + ou, uv.getY(v) * sv + ov);
  }
  uv.needsUpdate = true;
}

function normalizeGroupUVs(geo: THREE.BufferGeometry, group: { start: number; count: number }): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return;
  const index = geo.index;
  const verts = new Set<number>();
  for (let i = group.start; i < group.start + group.count; i++) verts.add(index ? index.getX(i) : i);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const v of verts) {
    minU = Math.min(minU, uv.getX(v));
    maxU = Math.max(maxU, uv.getX(v));
    minV = Math.min(minV, uv.getY(v));
    maxV = Math.max(maxV, uv.getY(v));
  }
  const du = maxU - minU || 1;
  const dv = maxV - minV || 1;
  for (const v of verts) uv.setXY(v, (uv.getX(v) - minU) / du, (uv.getY(v) - minV) / dv);
  uv.needsUpdate = true;
}

/** Textura radial compartida para los halos de luces prácticas. */
let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

function skyDome(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 12),
    new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(SKY_TOP) }, bottom: { value: new THREE.Color(SKY_BOTTOM) } },
      vertexShader:
        "varying float vY; void main(){ vY = normalize(position).y;" +
        " gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "varying float vY; uniform vec3 top; uniform vec3 bottom;" +
        " void main(){ gl_FragColor = vec4(mix(bottom, top, clamp(vY*2.2, 0.0, 1.0)), 1.0); }",
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  return m;
}

/** Rejilla del telegraph en el espacio (avance, lateral) del ataque: la
 *  topología no depende de los params, solo el contenido de los atributos. */
function buildTelegraphGeometry(): THREE.BufferGeometry {
  const nu = TELEGRAPH_U_STEPS + 1;
  const ns = TELEGRAPH_S_STEPS + 1;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nu * ns * 3), 3));
  geo.setAttribute("aQuality", new THREE.BufferAttribute(new Float32Array(nu * ns), 1));
  geo.setAttribute("aMargin", new THREE.BufferAttribute(new Float32Array(nu * ns), 1));
  const idx: number[] = [];
  for (let iu = 0; iu < TELEGRAPH_U_STEPS; iu++) {
    for (let is = 0; is < TELEGRAPH_S_STEPS; is++) {
      const a = iu * ns + is;
      idx.push(a, a + 1, a + ns, a + 1, a + ns + 1, a + ns);
    }
  }
  geo.setIndex(idx);
  return geo;
}

/** Extensión de la rejilla del telegraph en el plano (avance, lateral). La
 *  malla cubre el área MÁS un margen: el contorno del borde está centrado en
 *  la frontera, así que su mitad exterior necesita superficie donde pintarse.
 *  Una sola fuente para el drapeado y para los atributos — con dos, la calidad
 *  y las posiciones se desalinearían vértice a vértice. */
function telegraphExtent(params: AttackTelegraph["params"]): {
  uMin: number;
  uMax: number;
  sHalf: number;
} {
  const { cerca, lejos } = attackAreaReach(params);
  return {
    uMin: Math.max(0, cerca - TELEGRAPH_PAD_M),
    uMax: lejos + TELEGRAPH_PAD_M,
    sHalf: params.area_radius + TELEGRAPH_PAD_M,
  };
}

/** Calidad y margen por vértice. La fórmula NO vive aquí: es la de core
 *  (`attack-area`), la misma que resuelve el daño. El cliente solo pinta —
 *  cuando tenía copia propia, el parche podía divergir del resolver sin que
 *  nada fallara. Se calcula sobre (avance u, lateral s), así que no depende de
 *  dónde esté el jugador: solo de los params del ataque. */
function fillTelegraphQuality(geo: THREE.BufferGeometry, params: AttackTelegraph["params"]): void {
  const q = geo.attributes.aQuality as THREE.BufferAttribute;
  const m = geo.attributes.aMargin as THREE.BufferAttribute;
  const { uMin, uMax, sHalf } = telegraphExtent(params);
  let vi = 0;
  for (let iu = 0; iu <= TELEGRAPH_U_STEPS; iu++) {
    const u = uMin + ((uMax - uMin) * iu) / TELEGRAPH_U_STEPS;
    for (let is = 0; is <= TELEGRAPH_S_STEPS; is++) {
      const s = sHalf * ((2 * is) / TELEGRAPH_S_STEPS - 1);
      q.setX(vi, attackAreaQuality(params, u, s));
      m.setX(vi, attackAreaMargin(params, u, s));
      vi++;
    }
  }
  q.needsUpdate = true;
  m.needsUpdate = true;
}

/** Yaw de un vector XZ (0 = +z, crece hacia +x). */
const yawOf = (x: number, z: number) => Math.atan2(x, z);

/** Diferencia angular normalizada a (−π, π]. */
const angleDiff = (a: number, b: number) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

/** Margen de histéresis del frame direccional del billboard (~10°). */
const DIR_HYST_RAD = Math.PI / 18;

export class FpsGl {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private tiles = new Map<string, TileEntry>();
  /** Tile cuya ambientación (luces/cielo/niebla) está aplicada. */
  private ambienceKey: string | null = null;
  private lightsGroup: THREE.Group | null = null;
  private sky: THREE.Mesh;
  private billboards = new Map<
    string,
    { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; lastDir?: number }
  >();
  /** Ids que son PERSONAJE (sprite 8-dir de `updateEntity`), no decorado.
   *  El mapa de arriba lo comparten los dos, así que contar sus entradas no
   *  dice cuántos personajes hay montados: una escena con cajas satisface
   *  cualquier «hay al menos N billboards» con CERO personajes. */
  private billboardsPersonaje = new Set<string>();
  private texByImage = new WeakMap<HTMLImageElement, THREE.Texture>();
  private renderYaw = 0;
  /** Inclinación de la mirada en radianes (positivo = arriba). A diferencia
   *  del yaw NO se interpola: el tween del yaw existe para suavizar los
   *  saltos de 45° de ←/→, y un ratón con retardo en el eje vertical se
   *  siente roto. Los pasos de ↑/↓ son de 15°, que no necesitan filtro. */
  private lookPitch = 0;
  private lastNow = 0;
  /** Frames emitidos por render() — ver debugState. */
  private frames = 0;
  private activeKey: string | null = null;
  private debugView: FpsDebugView = "off";
  private collisionMesh: THREE.InstancedMesh | null = null;
  private forwardArrows = new Map<string, THREE.ArrowHelper>();
  /** map/color originales de los materiales tintados por el modo surfaces. */
  private tintSaved = new Map<THREE.MeshStandardMaterial, { map: THREE.Texture | null; color: number }>();
  /** Telegraph del ataque: parche de suelo con la calidad real del golpe. La
   *  malla se construye una vez y se reusa (un jugador ataca cada segundo);
   *  `paramsKey` evita recalcular la calidad por vértice cada frame. */
  private telegraphMesh: {
    mesh: THREE.Mesh;
    mat: THREE.ShaderMaterial;
    geo: THREE.BufferGeometry;
    paramsKey: string;
  } | null = null;
  /** Ataque en curso que el telegraph pinta, o null (apagado). */
  private telegraph: AttackTelegraph | null = null;
  /** Punto óptimo del golpe proyectado a píxeles del lienzo (solo debugState). */
  private telegraphScreen: { x: number; y: number; depthM: number } | null = null;
  /** Los dos BORDES del alcance (sobre la línea del forward) en píxeles del
   *  lienzo, o null cada uno si queda detrás del ojo. Solo debugState. */
  private telegraphBorde: {
    cerca: { x: number; y: number } | null;
    lejos: { x: number; y: number } | null;
  } | null = null;
  /** Recuento del episodio de telegraph que se está PINTANDO, frame a frame.
   *
   *  No es una traza de conveniencia: es la única forma honesta de afirmar
   *  nada sobre el telegraph desde fuera. Un modo dura décimas de segundo
   *  (el destello de impacto, 0,3 s) y el reloj que lo consume es el `delta`
   *  del game loop, que está TOPADO a 0,1 s — con la CPU ocupada el episodio
   *  dura más tiempo de pared del que tardó en sim, así que un observador
   *  externo que muestree una ventana fija se salta el destello o cierra la
   *  ventana antes de que el telegraph se apague. Contar aquí, donde se
   *  pinta, no se puede saltar ningún frame.
   *
   *  `episode` distingue un ataque del siguiente (sube al encenderse); el
   *  resto se acumula hasta que el telegraph se apaga solo (`ended`). Las
   *  posiciones de pantalla van como RANGO: quien lee decide el criterio
   *  ("está en cuadro") sin que el renderer tenga que conocerlo. */
  private telegraphEpisode: {
    episode: number;
    windupFrames: number;
    impactFrames: number;
    /** Frames de wind-up en los que el punto óptimo no era proyectable
     *  (queda detrás del ojo): ni dentro ni fuera del cuadro, ausente. */
    unprojectedFrames: number;
    screenYMin: number | null;
    screenYMax: number | null;
    optimalDistance: number;
    ended: boolean;
  } | null = null;
  /** Muro de niebla de la frontera. `opacity` es el tween 0..1 (la alfa real
   *  del material es ésta por VEIL_MAX_ALPHA y el perfil del shader). */
  private veil: {
    mesh: THREE.Mesh;
    mat: THREE.ShaderMaterial;
    edge: Edge;
    tileKey: string | null;
    opacity: number;
    target: number;
  } | null = null;
  /** Vectores de trabajo de projectToScreen (una etiqueta por NPC y frame). */
  private projNdc = new THREE.Vector3();
  private projView = new THREE.Vector3();
  /** Vector de trabajo de cameraRay (uno por frame). */
  private camDir = new THREE.Vector3();

  constructor(
    private canvas: HTMLCanvasElement,
    private spriteRenderer: SpriteRenderer | undefined,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Las luces del spec (ambient 0.85 + sol 1.6) están afinadas para el clay
    // cenital; con texturas albedo realistas la cara al sol CLIPPEA a blanco
    // (prueba real 2026-08-14: carros/puestos con la cara sur quemada). ACES
    // comprime las altas luces sin apagar la escena.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    // near 0.3 (no 0.1): ×3 de precisión de z-buffer — con 0.1 las cuatro
    // capas del suelo (separadas 2 cm entre sí) aún z-fighteaban a media
    // distancia. Nada renderiza a <0.3 m del ojo (radio jugador 0.4).
    this.cam = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.3, 600);
    this.sky = skyDome();
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(SKY_BOTTOM, FOG_NEAR, FOG_FAR);
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / Math.max(1, h);
    this.cam.updateProjectionMatrix();
  }

  installTile(
    key: string,
    primsM: SurfacePrim[],
    lightsM: GreyboxLight[],
    layout: SurfaceLayout,
    rect: { minX: number; minZ: number },
    ambience?: { sky?: { top: string; bottom: string }; fog?: { color: string; near: number; far: number } },
  ): void {
    this.removeTile(key);
    // Ambientación del tile (hora inferida): cielo y niebla siguen al ÚLTIMO
    // tile instalado (como las luces); sin ambience, constantes históricas.
    const skyMat = this.sky.material as THREE.ShaderMaterial;
    (skyMat.uniforms.top.value as THREE.Color).set(ambience?.sky?.top ?? SKY_TOP);
    (skyMat.uniforms.bottom.value as THREE.Color).set(ambience?.sky?.bottom ?? SKY_BOTTOM);
    this.scene.fog = ambience?.fog
      ? new THREE.Fog(ambience.fog.color, ambience.fog.near, ambience.fog.far)
      : new THREE.Fog(SKY_BOTTOM, FOG_NEAR, FOG_FAR);
    const group = new THREE.Group();
    group.position.set(rect.minX, 0, rect.minZ);
    const materialsByCell = new Map<string, THREE.MeshStandardMaterial[]>();
    const detailMeshes: THREE.Mesh[] = [];
    const cellByKey = new Map<string, SurfaceCell>();
    for (const page of layout.pages) for (const c of page.cells) cellByKey.set(c.key, c);
    const tileRelief = primsM.find((p) => p.relief)?.relief;
    let groundTopY = 0;
    let groundDecals = 0;

    primsM.forEach((prim, i) => {
      const assign: SurfaceAssign | undefined = layout.assign[i];
      const { geo, faceUvSizes, extrude } = primitiveGeometry(prim);
      const groups = SHAPE_GROUPS[prim.shape] ?? {};
      const clay = () =>
        prim.cat === "water"
          ? // Agua: lámina especular translúcida — la franja mate saturada
            // cantaba contra el terreno pintado.
            new THREE.MeshStandardMaterial({
              color: prim.color,
              roughness: 0.12,
              metalness: 0.25,
              transparent: true,
              opacity: 0.86,
            })
          : new THREE.MeshStandardMaterial({ color: prim.color, roughness: prim.roughness ?? 0.92 });

      const geoGroups = geo.groups.length
        ? geo.groups
        : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
      const groupMaterial: Partial<Record<SurfaceGroup, THREE.MeshStandardMaterial>> = {};
      let hasAnyCell = false;
      for (const [g, faceIdxs] of Object.entries(groups) as [SurfaceGroup, number[]][]) {
        const cellKey = assign?.groups?.[g] ?? null;
        const cell = cellKey ? cellByKey.get(cellKey) : null;
        const m = clay();
        groupMaterial[g] = m;
        if (cellKey && cell) {
          hasAnyCell = true;
          const list = materialsByCell.get(cellKey) ?? [];
          list.push(m);
          materialsByCell.set(cellKey, list);
          // UVs: metros/DENSITY_M para tileables; 0..1 para únicas.
          if (cell.kind === "tile") {
            if (faceUvSizes) {
              for (const fi of faceIdxs) {
                const gg = geoGroups[fi];
                if (!gg) continue;
                const [fw, fh] = faceUvSizes[fi];
                scaleGroupUVs(geo, gg, fw / DENSITY_M, fh / DENSITY_M);
              }
            } else if (extrude) {
              // ExtrudeGeometry: UVs ya en metros → 1 repetición cada DENSITY_M.
              for (const fi of faceIdxs) {
                const gg = geoGroups[fi];
                if (gg) scaleGroupUVs(geo, gg, 1 / DENSITY_M, 1 / DENSITY_M);
              }
            }
          } else if (extrude) {
            for (const fi of faceIdxs) {
              const gg = geoGroups[fi];
              if (gg) normalizeGroupUVs(geo, gg);
            }
          }
        }
      }
      // Overrides por SLOT (celda hero por cara n/s/e/w de un box): material
      // propio para esa cara con la imagen ENTERA (UVs renormalizadas a 0..1 —
      // el grupo pudo escalarlas a metros si su celda de grupo es tileable).
      const faceMaterial = new Map<number, THREE.MeshStandardMaterial>();
      if (assign?.faces) {
        for (const [slotStr, cellKey] of Object.entries(assign.faces)) {
          const slot = Number(slotStr);
          const cell = cellByKey.get(cellKey);
          const gg = geoGroups[slot];
          if (!cell || !gg) continue;
          hasAnyCell = true;
          const m = clay();
          faceMaterial.set(slot, m);
          const list = materialsByCell.get(cellKey) ?? [];
          list.push(m);
          materialsByCell.set(cellKey, list);
          normalizeGroupUVs(geo, gg);
        }
      }

      const nSlots = geo.groups.length || 1;
      const mats: THREE.Material[] = [];
      for (let slot = 0; slot < nSlots; slot++) {
        const fm = faceMaterial.get(slot);
        if (fm) {
          mats.push(fm);
          continue;
        }
        const g = (Object.entries(groups) as [SurfaceGroup, number[]][]).find(([, idxs]) =>
          idxs.includes(slot),
        )?.[0];
        mats.push((g && groupMaterial[g]) || clay());
      }
      // Calcos de suelo: coplanares por capa, y su prioridad la manda el
      // contrato (área→camino→agua→deck, juntas tras sus cajas), no la altura.
      // Se pintan en ese orden SIN escribir profundidad, que es como se
      // resuelve un decal: sin escalonarlos en Y el suelo tiene techo y deja
      // sitio al telegraph (#185). `transparent` los mete a todos en la misma
      // pasada ordenada — sin él el deck (opaco) se pintaría ANTES que el agua
      // (translúcida) y el agua lo taparía. `depthTest` se queda: un muro
      // delante del camino lo sigue tapando.
      if (prim.groundOrder !== undefined) {
        for (const m of mats) {
          const sm = m as THREE.MeshStandardMaterial;
          sm.transparent = true;
          sm.depthWrite = false;
        }
      }
      const mesh = new THREE.Mesh(geo, nSlots === 1 ? mats[0] : mats);
      if (prim.groundOrder !== undefined) {
        mesh.renderOrder = GROUND_DECAL_ORDER_BASE + prim.groundOrder;
      }
      mesh.position.set(...prim.pos);
      if (prim.rotY) mesh.rotation.y = prim.rotY;
      if (prim.rotX) mesh.rotation.x = prim.rotX;
      if (prim.rotZ) mesh.rotation.z = prim.rotZ;
      if (prim.scale) mesh.scale.set(...prim.scale);
      mesh.castShadow = !prim.noShadow;
      mesh.receiveShadow = true;
      // Cara ALTA del calco sobre su suelo local, medida ANTES del drapeado:
      // el telegraph también se drapea sobre el mismo relieve, así que lo que
      // decide si queda enterrado es la altura RELATIVA al terreno, no la
      // absoluta. (Bajo un rasgo de `ground` el relieve está aplanado, así que
      // ese drapeado es una constante que se cancela en los dos lados.)
      if (prim.groundOrder !== undefined) {
        groundDecals++;
        geo.computeBoundingBox();
        const top = mesh.position.y + (geo.boundingBox?.max.y ?? 0);
        if (top > groundTopY) groundTopY = top;
      }
      // Relieve: el detalle plano del suelo (manchas/piedritas/flores, sin
      // sombra) se DRAPEA vértice a vértice sobre la rejilla; el scatter 3D
      // (decor con sombra) y las prims `anchor` (vegetación/rocas de volumen
      // — el relieve NO se aplana bajo ellas) se anclan por su centro.
      if (tileRelief && !prim.relief) {
        if (prim.noShadow && (prim.cat === "terrain" || prim.cat === "decor") && !prim.rotX && !prim.rotZ) {
          const pa = geo.attributes.position;
          for (let vi = 0; vi < pa.count; vi++) {
            pa.setY(vi, pa.getY(vi) + reliefAtM(tileRelief, prim.pos[0] + pa.getX(vi), prim.pos[2] + pa.getZ(vi)));
          }
          pa.needsUpdate = true;
        } else if (prim.cat === "decor" || prim.anchor) {
          mesh.position.y += reliefAtM(tileRelief, prim.pos[0], prim.pos[2]);
        }
      }
      // Solo el detalle procedural SIN celda (elipses/piedritas clay) se
      // oculta al texturizar — los caminos/plazas del ground ya llevan la suya.
      if (prim.cat === "terrain" && prim.shape !== "box" && !hasAnyCell) detailMeshes.push(mesh);
      group.add(mesh);
    });

    this.scene.add(group);
    this.tiles.set(key, {
      group,
      materialsByCell,
      detailMeshes,
      textured: false,
      relief: tileRelief,
      rect,
      lightsM,
      ambience,
      groundTopY,
      groundDecals,
    });
    this.ambienceKey = null; // el próximo frame re-aplica la del tile del jugador
    // Luces: las del último tile instalado mandan (son fijas por bioma y
    // compartirlas evita duplicar soles con sombras).
    this.installLights(lightsM);
  }

  private installLights(lightsM: GreyboxLight[]): void {
    if (this.lightsGroup) {
      this.scene.remove(this.lightsGroup);
      this.lightsGroup.traverse((o) => {
        if ((o as THREE.Light).isLight) (o as THREE.Light).dispose?.();
      });
    }
    const holder = new THREE.Group();
    for (const l of lightsM) {
      if (l.kind === "ambient") holder.add(new THREE.AmbientLight(l.color, l.intensity));
      else if (l.kind === "hemi")
        holder.add(new THREE.HemisphereLight(l.color, l.groundColor ?? "#6a6055", l.intensity));
      else if (l.kind === "point") {
        const p = new THREE.PointLight(l.color, l.intensity, l.distance ?? 0, l.decay ?? 2);
        p.position.set(...(l.pos ?? [0, 1, 0]));
        holder.add(p);
        // Halo aditivo de la práctica: sin él, un farol encendido "no emite"
        // (crítica externa 2026-08-16 — lámparas apagadas al atardecer).
        const halo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowTexture(),
            color: l.color,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
          }),
        );
        halo.position.set(...(l.pos ?? [0, 1, 0]));
        halo.scale.set(1.6, 1.6, 1);
        holder.add(halo);
      } else {
        const sun = new THREE.DirectionalLight(l.color, l.intensity);
        sun.position.set(...(l.pos ?? [40, 60, 40]));
        if (l.castShadow) {
          sun.castShadow = true;
          sun.shadow.mapSize.set(2048, 2048);
          const span = 70;
          sun.shadow.camera.left = -span;
          sun.shadow.camera.right = span;
          sun.shadow.camera.top = span;
          sun.shadow.camera.bottom = -span;
          sun.shadow.camera.near = 1;
          sun.shadow.camera.far = 600;
          sun.shadow.bias = -0.0006;
          // A ras de suelo el acne del alero canta mucho más que en cenital.
          sun.shadow.normalBias = 0.06;
        }
        holder.add(sun, sun.target);
      }
    }
    this.lightsGroup = holder;
    this.scene.add(holder);
  }

  /** Aplica la ambientación del tile que PISA el jugador (luces, cielo y
   *  niebla) cuando cambia de tile — la del último instalado es solo el
   *  estado inicial. */
  private applyAmbienceAt(x: number, z: number): void {
    for (const [key, t] of this.tiles) {
      const size = TILE_SIZE_M;
      const lx = x - t.rect.minX;
      const lz = z - t.rect.minZ;
      if (lx < 0 || lx > size || lz < 0 || lz > size) continue;
      if (key === this.ambienceKey) return;
      this.ambienceKey = key;
      this.installLights(t.lightsM);
      const skyMat = this.sky.material as THREE.ShaderMaterial;
      (skyMat.uniforms.top.value as THREE.Color).set(t.ambience?.sky?.top ?? SKY_TOP);
      (skyMat.uniforms.bottom.value as THREE.Color).set(t.ambience?.sky?.bottom ?? SKY_BOTTOM);
      this.scene.fog = t.ambience?.fog
        ? new THREE.Fog(t.ambience.fog.color, t.ambience.fog.near, t.ambience.fog.far)
        : new THREE.Fog(SKY_BOTTOM, FOG_NEAR, FOG_FAR);
      return;
    }
  }

  /** Altura visual del suelo en coords de MUNDO — la piden las etiquetas de
   *  nombre, que cuelgan sobre la cabeza y no del plano y=0. */
  groundYAt(x: number, z: number): number {
    return this.reliefWorldAt(x, z);
  }

  /** Altura visual del terreno (relieve) en coords de MUNDO — 0 sin relieve.
   *  La colisión y el sim siguen en el plano: esto es presentación pura. */
  private reliefWorldAt(x: number, z: number): number {
    for (const t of this.tiles.values()) {
      if (!t.relief) continue;
      const size = t.relief.n * t.relief.stepM;
      const lx = x - t.rect.minX;
      const lz = z - t.rect.minZ;
      if (lx >= 0 && lx <= size && lz >= 0 && lz <= size) return reliefAtM(t.relief, lx, lz);
    }
    return 0;
  }

  removeTile(key: string): void {
    const entry = this.tiles.get(key);
    if (!entry) return;
    // Los materiales del tile mueren con él: fuera del snapshot del tinte.
    for (const mats of entry.materialsByCell.values()) {
      for (const m of mats) this.tintSaved.delete(m);
    }
    this.scene.remove(entry.group);
    entry.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    this.tiles.delete(key);
  }

  /** Vacía el mundo 3D (resetWorld del cliente: arranque de sesión, resume,
   *  fixtures). Sin esto los grupos de los tiles viejos se quedaban en la
   *  escena three y reaparecían como fantasmas al reanudar. */
  clearTiles(): void {
    for (const key of [...this.tiles.keys()]) this.removeTile(key);
    this.activeKey = null;
    this.ambienceKey = null;
    // El overlay de colisión y el velo son del tile activo: mueren con él.
    this.clearCollisionDebug();
    this.disposeVeil();
  }

  /** Inclinación de la MIRADA en radianes (positivo = arriba). El clamp vive
   *  en main.ts, que es quien acumula el ratón: aquí llega ya acotada. */
  setLookPitch(rad: number): void {
    this.lookPitch = rad;
  }

  /** Ojo y dirección REAL de la cámara del último frame pintado. La puntería
   *  la necesita entera —con pitch— para que apuntar sea apuntar: con la
   *  proyección horizontal, mirando al suelo seguirías "apuntando" al NPC que
   *  tienes delante. */
  cameraRay(): { origin: Vec3; dir: Vec3 } {
    this.cam.updateMatrixWorld();
    const o = this.cam.position;
    const d = this.camDir.set(0, 0, -1).applyQuaternion(this.cam.quaternion);
    return { origin: { x: o.x, y: o.y, z: o.z }, dir: { x: d.x, y: d.y, z: d.z } };
  }

  /** Punto de MUNDO → píxeles CSS del canvas, o null si cae detrás del ojo.
   *  Es lo que permite colgar las etiquetas de nombre en DOM sobre la cabeza
   *  del NPC sin re-implementar el tema del pack en un atlas de fuente. */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number; depthM: number } | null {
    this.cam.updateMatrixWorld();
    const view = this.projView.set(x, y, z).applyMatrix4(this.cam.matrixWorldInverse);
    // La cámara mira −z en su espacio: todo lo que tenga z ≥ −near está en el
    // ojo o detrás, y project() lo proyectaría espejado al otro lado.
    if (view.z > -this.cam.near) return null;
    const ndc = this.projNdc.set(x, y, z).project(this.cam);
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    return { x: (ndc.x * 0.5 + 0.5) * w, y: (-ndc.y * 0.5 + 0.5) * h, depthM: -view.z };
  }

  /** Telegraph del ataque en curso, o null para apagarlo. Se fija ANTES de
   *  render(): en WebGL no hay lienzo sobre el que pintar tras emitir el
   *  frame, así que el patrón "dibuja después" de las vistas 2D no vale. */
  setAttackTelegraph(t: AttackTelegraph | null): void {
    const antes = this.telegraph;
    this.telegraph = t;
    if (!t) {
      // El apagado es un flanco: main.ts llama con null en cada frame sin
      // ataque, y solo el primero cierra el episodio.
      if (antes && this.telegraphEpisode) this.telegraphEpisode.ended = true;
      if (this.telegraphMesh) this.telegraphMesh.mesh.visible = false;
      return;
    }
    if (!antes) {
      this.telegraphEpisode = {
        episode: (this.telegraphEpisode?.episode ?? 0) + 1,
        windupFrames: 0,
        impactFrames: 0,
        unprojectedFrames: 0,
        screenYMin: null,
        screenYMax: null,
        optimalDistance: t.params.optimal_distance,
        ended: false,
      };
    }
    const key = `${t.params.optimal_distance}|${t.params.distance_tolerance}|${t.params.area_radius}`;
    if (!this.telegraphMesh) {
      const geo = buildTelegraphGeometry();
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uOpacity: { value: 0 },
          uImpact: { value: 0 },
          uRim: { value: TELEGRAPH_RIM_M },
          uFillMin: { value: TELEGRAPH_FILL_MIN_A },
          uImpactColor: { value: new THREE.Color("#808080") },
        },
        vertexShader: TELEGRAPH_VERTEX,
        fragmentShader: TELEGRAPH_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // Es un parche de suelo alrededor del jugador: siempre en cámara, y su
      // caja envolvente cambia cada frame — el culling solo daría parpadeos.
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.telegraphMesh = { mesh, mat, geo, paramsKey: "" };
    }
    if (this.telegraphMesh.paramsKey !== key) {
      fillTelegraphQuality(this.telegraphMesh.geo, t.params);
      this.telegraphMesh.paramsKey = key;
    }
    this.telegraphMesh.mesh.visible = true;
  }

  /** Re-drapea el parche del telegraph sobre el relieve delante del jugador.
   *  Se hace por frame porque el jugador se mueve y gira durante el wind-up. */
  private updateTelegraph(): void {
    const t = this.telegraphMesh;
    const st = this.telegraph;
    if (!t || !st) return;
    const { player, params, mode, opacity, impactQuality } = st;
    const fLen = Math.hypot(player.forward.x, player.forward.z) || 1;
    const fx = player.forward.x / fLen;
    const fz = player.forward.z / fLen;
    // Right = forward girado 90° (mismo marco que el strafe de main.ts).
    const rx = -fz;
    const rz = fx;
    const { uMin, uMax, sHalf } = telegraphExtent(params);
    const pos = t.geo.attributes.position as THREE.BufferAttribute;
    let vi = 0;
    for (let iu = 0; iu <= TELEGRAPH_U_STEPS; iu++) {
      const u = uMin + ((uMax - uMin) * iu) / TELEGRAPH_U_STEPS;
      for (let is = 0; is <= TELEGRAPH_S_STEPS; is++) {
        const s = sHalf * ((2 * is) / TELEGRAPH_S_STEPS - 1);
        const wx = player.pos.x + fx * u + rx * s;
        const wz = player.pos.z + fz * u + rz * s;
        pos.setXYZ(vi++, wx, this.reliefWorldAt(wx, wz) + TELEGRAPH_Y_M, wz);
      }
    }
    pos.needsUpdate = true;
    // Dónde cae en PANTALLA el punto óptimo del golpe. No lo usa el render:
    // lo publica debugState para que se pueda afirmar sin leer píxeles que el
    // telegraph está EN CUADRO (con yaw puro caía por debajo del encuadre, y
    // ese era justo el problema que la mirada vertical resuelve).
    const ox = player.pos.x + fx * params.optimal_distance;
    const oz = player.pos.z + fz * params.optimal_distance;
    this.telegraphScreen = this.projectToScreen(ox, this.reliefWorldAt(ox, oz) + TELEGRAPH_Y_M, oz);
    // Y dónde caen los dos BORDES del alcance sobre la línea del forward. El
    // punto óptimo dice dónde se pega perfecto; esto dice hasta dónde llega,
    // que es lo que el issue #184 echaba en falta. Publicado por debugState,
    // se puede afirmar que la frontera está en cuadro sin leer píxeles.
    const alcance = attackAreaReach(params);
    const proyectarEnForward = (m: number): { x: number; y: number } | null => {
      const bx = player.pos.x + fx * m;
      const bz = player.pos.z + fz * m;
      const p = this.projectToScreen(bx, this.reliefWorldAt(bx, bz) + TELEGRAPH_Y_M, bz);
      return p ? { x: Math.round(p.x), y: Math.round(p.y) } : null;
    };
    this.telegraphBorde = {
      cerca: proyectarEnForward(alcance.cerca),
      lejos: proyectarEnForward(alcance.lejos),
    };
    this.tallyTelegraphFrame(mode);
    t.mat.uniforms.uOpacity.value = Math.min(1, Math.max(0, opacity) * TELEGRAPH_GAIN);
    t.mat.uniforms.uImpact.value = mode === "impact" ? 1 : 0;
    if (mode === "impact") {
      // Tramos de calidad del destello (heredados del 2D: verde/amarillo/
      // rojo según lo centrado que fuese el golpe).
      const c =
        impactQuality > 0.7 ? "#50ff50"
        : impactQuality > 0.3 ? "#ffff3c"
        : impactQuality > 0 ? "#ff503c"
        : "#787878";
      (t.mat.uniforms.uImpactColor.value as THREE.Color).set(c);
    }
  }

  /** Anota el frame recién drapeado en el episodio en curso. Se llama desde
   *  updateTelegraph() —después de proyectar el punto óptimo— porque lo que
   *  cuenta es lo que se PINTA, no lo que main.ts pidió. */
  private tallyTelegraphFrame(mode: AttackTelegraph["mode"]): void {
    const ep = this.telegraphEpisode;
    if (!ep) return;
    if (mode === "impact") {
      ep.impactFrames++;
      return;
    }
    ep.windupFrames++;
    const y = this.telegraphScreen?.y;
    if (y === undefined) {
      ep.unprojectedFrames++;
      return;
    }
    ep.screenYMin = ep.screenYMin === null ? y : Math.min(ep.screenYMin, y);
    ep.screenYMax = ep.screenYMax === null ? y : Math.max(ep.screenYMax, y);
  }

  /** Velo direccional de la frontera: muro de niebla sobre el borde del tile
   *  activo, o null para que se disipe. Quién DECIDE el velo sigue siendo el
   *  FrontierManager; esto solo lo pinta. */
  setVeil(edge: Edge | null): void {
    if (!edge) {
      if (this.veil) this.veil.target = 0;
      return;
    }
    const entry = this.activeKey ? this.tiles.get(this.activeKey) : null;
    if (!entry) return; // sin tile activo no hay frontera que pintar
    if (!this.veil) {
      const geo = new THREE.PlaneGeometry(TILE_SIZE_M + VEIL_OVERSHOOT_M, VEIL_H_M);
      geo.translate(0, VEIL_H_M / 2, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(SKY_BOTTOM) },
          uSkyBottom: { value: new THREE.Color(SKY_BOTTOM) },
          uSkyTop: { value: new THREE.Color(SKY_TOP) },
          uOpacity: { value: 0 },
        },
        vertexShader: VEIL_VERTEX,
        fragmentShader: VEIL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.veil = { mesh, mat, edge, tileKey: this.activeKey, opacity: 0, target: 1 };
      this.placeVeil(entry.rect, edge);
      return;
    }
    if (this.veil.edge !== edge || this.veil.tileKey !== this.activeKey) {
      // Recolocar sin reiniciar la alfa: al andar por una esquina el borde
      // más cercano cambia, y un parpadeo ahí delata la costura.
      this.veil.edge = edge;
      this.veil.tileKey = this.activeKey;
      this.placeVeil(entry.rect, edge);
    }
    this.veil.target = 1;
  }

  private placeVeil(rect: { minX: number; minZ: number }, edge: Edge): void {
    if (!this.veil) return;
    const cx = rect.minX + TILE_SIZE_M / 2;
    const cz = rect.minZ + TILE_SIZE_M / 2;
    const m = this.veil.mesh;
    if (edge === "north") m.position.set(cx, 0, rect.minZ + VEIL_INSET_M);
    else if (edge === "south") m.position.set(cx, 0, rect.minZ + TILE_SIZE_M - VEIL_INSET_M);
    else if (edge === "west") m.position.set(rect.minX + VEIL_INSET_M, 0, cz);
    else m.position.set(rect.minX + TILE_SIZE_M - VEIL_INSET_M, 0, cz);
    // El plano nace en XY mirando a +z: los bordes que corren en Z giran 90°.
    // DoubleSide hace irrelevante de qué lado se mire.
    m.rotation.y = edge === "east" || edge === "west" ? Math.PI / 2 : 0;
  }

  private updateVeil(dt: number): void {
    const v = this.veil;
    if (!v) return;
    const rate = dt / (v.target > v.opacity ? VEIL_FADE_IN_S : VEIL_FADE_OUT_S);
    const d = v.target - v.opacity;
    v.opacity = Math.abs(d) <= rate ? v.target : v.opacity + Math.sign(d) * rate;
    if (v.target === 0 && v.opacity <= 0.001) {
      this.disposeVeil();
      return;
    }
    // El color es el de la niebla VIGENTE (applyAmbienceAt la fija desde la
    // ambience del tile que pisa el jugador): cruzar a un tile nocturno
    // cambia la pared igual que cambia el horizonte. Y el cielo con el que se
    // funde por arriba se lee de la MISMA cúpula que se está pintando: de
    // noche el muro se disuelve en un cielo nocturno, no en el azul de una
    // constante.
    const fog = this.scene.fog;
    (v.mat.uniforms.uColor.value as THREE.Color).set(
      fog instanceof THREE.Fog ? fog.color : new THREE.Color(SKY_BOTTOM),
    );
    const skyMat = this.sky.material as THREE.ShaderMaterial;
    (v.mat.uniforms.uSkyBottom.value as THREE.Color).copy(skyMat.uniforms.bottom.value as THREE.Color);
    (v.mat.uniforms.uSkyTop.value as THREE.Color).copy(skyMat.uniforms.top.value as THREE.Color);
    v.mat.uniforms.uOpacity.value = v.opacity * VEIL_MAX_ALPHA;
  }

  private disposeVeil(): void {
    if (!this.veil) return;
    this.scene.remove(this.veil.mesh);
    this.veil.mesh.geometry.dispose();
    this.veil.mat.dispose();
    this.veil = null;
  }

  setActive(key: string | null): void {
    this.activeKey = key;
    // Solo el tile activo (y su sol global) proyecta sombras: N tiles × ~200
    // prims con sombras hunden el frame time.
    for (const [k, entry] of this.tiles) {
      const on = k === key;
      entry.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = on && !(mesh.userData.noShadow as boolean);
      });
    }
  }

  applyAtlas(key: string, images: Map<string, AtlasImage>): void {
    const entry = this.tiles.get(key);
    if (!entry) return;
    // Con el tinte de surfaces activo, restaurar antes de mutar los
    // materiales y re-tintar después (el snapshot quedaría stale).
    const retint = this.debugView === "surfaces";
    if (retint) this.clearTint();
    for (const [cellKey, { image, kind }] of images) {
      const mats = entry.materialsByCell.get(cellKey);
      if (!mats) continue;
      const tex = new THREE.Texture(image as HTMLImageElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      // Máxima anisotropía del hardware: la muralla (64 m de repeat) en
      // ángulo rasante escupía ruido de mip con anisotropy 4.
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      if (kind === "tile") tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      else tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      for (const m of mats) {
        m.map = tex;
        m.color.set("#ffffff");
        m.needsUpdate = true;
      }
    }
    // Con atlas, el detalle procedural clay lee como parches planos: fuera.
    for (const mesh of entry.detailMeshes) mesh.visible = false;
    entry.textured = true;
    if (retint) this.applyTint();
  }

  clearAtlas(key: string): void {
    const entry = this.tiles.get(key);
    if (!entry) return;
    const retint = this.debugView === "surfaces";
    if (retint) this.clearTint();
    for (const mats of entry.materialsByCell.values()) {
      for (const m of mats) {
        m.map?.dispose();
        m.map = null;
        m.needsUpdate = true;
      }
    }
    for (const mesh of entry.detailMeshes) mesh.visible = true;
    entry.textured = false;
    if (retint) this.applyTint();
  }

  /** Tecla B: overlay de debug. `collision` sólo aplica al modo collision. */
  setDebugView(mode: FpsDebugView, collision: FpsDebugCollision | null): void {
    if (this.debugView === "surfaces" && mode !== "surfaces") this.clearTint();
    if (this.debugView === "collision" && mode !== "collision") this.clearCollisionDebug();
    this.debugView = mode;
    if (mode === "collision") this.buildCollisionDebug(collision);
    else if (mode === "surfaces") {
      this.clearTint();
      this.applyTint();
    }
  }

  private buildCollisionDebug(c: FpsDebugCollision | null): void {
    this.clearCollisionDebug();
    if (!c || c.cells.length === 0) return;
    const geo = new THREE.PlaneGeometry(c.size, c.size);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3c3c,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const inst = new THREE.InstancedMesh(geo, mat, c.cells.length);
    const m = new THREE.Matrix4();
    c.cells.forEach(([x, z], i) => {
      m.makeTranslation(x + c.size / 2, GROUND_OVERLAY_Y, z + c.size / 2);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    this.collisionMesh = inst;
    this.scene.add(inst);
  }

  private clearCollisionDebug(): void {
    if (this.collisionMesh) {
      this.scene.remove(this.collisionMesh);
      this.collisionMesh.geometry.dispose();
      (this.collisionMesh.material as THREE.Material).dispose();
      this.collisionMesh = null;
    }
    for (const a of this.forwardArrows.values()) this.scene.remove(a);
    this.forwardArrows.clear();
  }

  private applyTint(): void {
    for (const entry of this.tiles.values()) {
      for (const [cellKey, mats] of entry.materialsByCell) {
        const color = tintColor(cellKey);
        for (const m of mats) {
          if (!this.tintSaved.has(m)) this.tintSaved.set(m, { map: m.map, color: m.color.getHex() });
          m.map = null;
          m.color.setHex(color);
          m.needsUpdate = true;
        }
      }
    }
  }

  private clearTint(): void {
    for (const [m, saved] of this.tintSaved) {
      m.map = saved.map;
      m.color.setHex(saved.color);
      m.needsUpdate = true;
    }
    this.tintSaved.clear();
  }

  /** Billboard 8-dir de una entidad con sprite; caja esquemática si no. */
  private updateEntity(e: Entity, now: number): void {
    this.billboardsPersonaje.add(e.id);
    let slot = this.billboards.get(e.id);
    if (!slot) {
      const geo = new THREE.PlaneGeometry(FRAME_WORLD_M, FRAME_WORLD_M);
      geo.translate(0, FRAME_WORLD_M / 2, 0);
      const mat = new THREE.MeshStandardMaterial({ alphaTest: 0.5, roughness: 0.95 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      slot = { mesh, mat };
      this.billboards.set(e.id, slot);
      this.scene.add(mesh);
    }
    slot.mesh.visible = true;
    slot.mesh.position.set(e.pos.x, this.reliefWorldAt(e.pos.x, e.pos.z) - FRAME_WORLD_M * FEET_FROM_BOTTOM, e.pos.z);
    const toCamX = this.cam.position.x - e.pos.x;
    const toCamZ = this.cam.position.z - e.pos.z;
    slot.mesh.rotation.y = yawOf(toCamX, toCamZ);
    // Modo collision: flecha del forward del sim sobre cada personaje
    // (diagnóstico de NPCs atascados cambiando de dirección).
    if (this.debugView === "collision" && e.forward) {
      const dir = new THREE.Vector3(e.forward.x, 0, e.forward.z).normalize();
      let arrow = this.forwardArrows.get(e.id);
      if (!arrow) {
        arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), 1.4, 0x22ddff, 0.4, 0.25);
        this.forwardArrows.set(e.id, arrow);
        this.scene.add(arrow);
      }
      arrow.position.set(e.pos.x, this.reliefWorldAt(e.pos.x, e.pos.z) + 2.1, e.pos.z);
      arrow.setDirection(dir);
      arrow.visible = true;
    }
    if (e.sprite && this.spriteRenderer) {
      const sheet = this.spriteRenderer.getCached(e.sprite.model, e.sprite.anim, e.sprite.angle);
      if (sheet) {
        const t = e.sprite.animStartedAt !== undefined ? (now - e.sprite.animStartedAt) / 1000 : now / 1000;
        const frame = this.spriteRenderer.pickFrame(sheet, t);
        const fwd = e.forward ?? { x: 0, y: 0, z: 1 };
        // rel = yaw_npc − yaw(npc→cám): dir 0 = de frente, d crece girando a
        // la derecha de pantalla (verificado contra los PNG del rig frontal_8;
        // toCam es npc→cámara). El orden inverso espejaba los perfiles E/W.
        const rel = yawOf(fwd.x, fwd.z) - yawOf(toCamX, toCamZ);
        const dirCount = sheet.directions || 8;
        const step = (2 * Math.PI) / dirCount;
        // Histéresis: en el borde entre dos octantes el frame conmutaba a
        // frecuencia de frame (yaw del sim + yaw de cámara son continuos).
        // Se conserva el octante vigente hasta salirse paso/2 + margen.
        let dir: number;
        if (
          slot.lastDir !== undefined &&
          Math.abs(angleDiff(rel, slot.lastDir * step)) <= step / 2 + DIR_HYST_RAD
        ) {
          dir = slot.lastDir;
        } else {
          dir = Math.round(rel / step) % dirCount;
          if (dir < 0) dir += dirCount;
          slot.lastDir = dir;
        }
        try {
          const img = this.spriteRenderer.pickImage(sheet, dir, frame);
          if (img !== SPRITE_PENDING) {
            let tex = this.texByImage.get(img);
            if (!tex) {
              tex = new THREE.Texture(img);
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.needsUpdate = true;
              this.texByImage.set(img, tex);
            }
            if (slot.mat.map !== tex) {
              slot.mat.map = tex;
              slot.mat.needsUpdate = true;
            }
          }
        } catch {
          // frame fuera de rango / 404: se conserva la última textura.
        }
        return;
      }
    }
    // Sin sprite: se deja el billboard con la última textura o vacío — las
    // entidades-objeto se pintan como caja abajo (updateObject).
  }

  private updateObject(e: Entity): void {
    let slot = this.billboards.get(e.id);
    if (!slot) {
      const sx = e.sizeXZ?.x ?? e.radius * 2;
      const sz = e.sizeXZ?.z ?? e.radius * 2;
      const sy = e.sizeY ?? 1;
      // La entity respeta su `shape` declarado (catálogo del world scene);
      // sin shape (o shape plano/exótico) cae a caja — nunca más un fanal
      // caído pintado como cajón.
      let geo: THREE.BufferGeometry;
      switch (e.shape) {
        case "cylinder":
        case "capsule":
          geo = new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 14);
          geo.translate(0, sy / 2, 0);
          break;
        case "sphere":
          geo = new THREE.SphereGeometry(Math.max(sx, sy) / 2, 14, 10);
          geo.translate(0, Math.max(sx, sy) / 2, 0);
          break;
        case "cone":
          geo = new THREE.ConeGeometry(sx / 2, sy, 14);
          geo.translate(0, sy / 2, 0);
          break;
        default:
          geo = new THREE.BoxGeometry(sx, sy, sz);
          geo.translate(0, sy / 2, 0);
      }
      // Paleta fps propia cuando la entity no declara color: main.ts rellena
      // "#666"/"#aa8" (defaults del 2D cenital) y ese gris canta en primera
      // persona — la mayoría de props de aldea son de madera.
      const declared = e.color && e.color !== "#666" && e.color !== "#aa8" ? e.color : undefined;
      const fallback =
        e.category === "item" ? "#b0a878"
        : e.category === "decor" ? "#8a7f6a"
        : "#7a5c3e";
      const mat = new THREE.MeshStandardMaterial({ color: declared ?? fallback, roughness: 0.92 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      slot = { mesh, mat };
      this.billboards.set(e.id, slot);
      this.scene.add(mesh);
    }
    slot.mesh.visible = true;
    slot.mesh.position.set(e.pos.x, this.reliefWorldAt(e.pos.x, e.pos.z), e.pos.z);
  }

  render(player: PlayerView, enemies: Entity[], objects: Entity[], npcs: Entity[]): void {
    this.frames++;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastNow) / 1000 || 0.016);
    this.lastNow = now;

    // Cámara: yaw lógico del forward (continuo — mouse look en main.ts); el
    // tween es presentación pura, con velocidad limitada (≈900°/s): suaviza
    // los saltos de 45° de ←/→ y actúa de filtro leve sobre el ratón.
    const targetYaw = yawOf(player.forward.x, player.forward.z);
    let d = targetYaw - this.renderYaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const step = (dt / TURN_TIME_S) * Math.PI * 0.5;
    this.renderYaw = Math.abs(d) <= step ? targetYaw : this.renderYaw + Math.sign(d) * step;
    this.applyAmbienceAt(player.pos.x, player.pos.z);
    this.cam.position.set(player.pos.x, this.reliefWorldAt(player.pos.x, player.pos.z) + EYE_M, player.pos.z);
    // rotation.y = π + yaw: la cámara de three mira −z con rotación 0 y
    // yawOf tiene 0 = +z (R_y(π+yaw)·(0,0,−1) = (sin yaw, 0, cos yaw)).
    // rotation.x = pitch en orden YXZ: el giro vertical se aplica en el marco
    // ya girado, así que mirar arriba es mirar arriba mires a donde mires
    // (con XYZ el eje se inclinaría con el yaw y la vista rolaría).
    this.cam.rotation.set(this.lookPitch, Math.PI + this.renderYaw, 0, "YXZ");
    this.sky.position.copy(this.cam.position);

    const seen = new Set<string>();
    for (const e of [...npcs, ...enemies]) {
      if (!e.alive && e.sprite === undefined) continue;
      seen.add(e.id);
      this.updateEntity(e, now);
    }
    for (const e of objects) {
      // Los edificios-entity legacy sí viven en el greybox (volumes); el resto
      // de entities de escena (props/decor/items) NO se derivan a prims — sin
      // esto eran invisibles en fps (mobiliario de interiores incluido).
      if (e.sceneDeclared && e.category === "building") continue;
      seen.add(e.id);
      this.updateObject(e);
    }
    for (const [id, slot] of this.billboards) {
      if (!seen.has(id)) {
        slot.mesh.visible = false;
        const arrow = this.forwardArrows.get(id);
        if (arrow) arrow.visible = false;
      }
    }

    this.updateTelegraph();
    this.updateVeil(dt);
    this.renderer.render(this.scene, this.cam);
  }

  debugState(): Record<string, unknown> {
    const t = this.telegraph;
    const v = this.veil;
    return {
      /** Frames EMITIDOS. Un renderer montado y con tiles instalados no
       *  demuestra que el juego pinte: el game loop puede estar saliendo por
       *  una guarda antes de llamar a render() y dejar el lienzo negro con la
       *  escena cargada (issue #215). Si esto no sube, nadie está pintando. */
      frames: this.frames,
      tiles: [...this.tiles.keys()],
      activeTile: this.activeKey,
      textured: [...this.tiles.entries()].filter(([, t2]) => t2.textured).map(([k]) => k),
      renderYawDeg: Math.round((this.renderYaw * 180) / Math.PI),
      /** Lo que la CÁMARA tiene aplicado (no lo que el input pidió): se lee
       *  de su rotación, así que un cable roto entre main.ts y el frame se ve
       *  aquí. Cero hasta el primer render. */
      pitchDeg: Math.round((this.cam.rotation.x * 180) / Math.PI),
      billboards: [...this.billboards.entries()].filter(([, s]) => s.mesh.visible).length,
      /** Solo los de PERSONAJE, visibles. `billboards` cuenta también el
       *  decorado (updateObject usa el mismo mapa), así que es lo que hay que
       *  mirar para afirmar que los personajes están montados. */
      billboardsPersonaje: [...this.billboards.entries()].filter(
        ([id, s]) => s.mesh.visible && this.billboardsPersonaje.has(id),
      ).length,
      debugView: this.debugView,
      /** El SUELO del tile activo frente a la cota de los calcos, en metros.
       *  `topY` es la cara alta real de los rasgos planos ya instalados
       *  (relieve incluido) y `overlayY` la altura a la que se dibuja el
       *  telegraph. Si `overlayY` no supera a `topY`, el parche está
       *  ENTERRADO y el jugador combate a ciegas — que es lo que ocurría en un
       *  tile de puerto (#185). Es lo que permite afirmarlo sin leer píxeles. */
      suelo: (() => {
        const t2 = this.activeKey ? this.tiles.get(this.activeKey) : null;
        return t2
          ? {
              topY: Math.round(t2.groundTopY * 10000) / 10000,
              overlayY: Math.round(GROUND_OVERLAY_Y * 10000) / 10000,
              holguraM: Math.round((GROUND_OVERLAY_Y - t2.groundTopY) * 10000) / 10000,
              calcos: t2.groundDecals,
            }
          : null;
      })(),
      viewport: { w: this.canvas.clientWidth || this.canvas.width, h: this.canvas.clientHeight || this.canvas.height },
      telegraph: t
        ? {
            mode: t.mode,
            opacity: Math.round(t.opacity * 1000) / 1000,
            optimalDistance: t.params.optimal_distance,
            areaRadius: t.params.area_radius,
            /** Píxeles del lienzo del punto óptimo, o null si queda detrás
             *  del ojo. Comparado con `viewport` dice si está en cuadro. */
            screen: this.telegraphScreen
              ? { x: Math.round(this.telegraphScreen.x), y: Math.round(this.telegraphScreen.y) }
              : null,
            /** Píxeles del lienzo de los dos bordes del ALCANCE sobre la línea
             *  del forward (cerca/lejos), o null los que queden detrás del
             *  ojo. Es lo que permite afirmar que el jugador ve dónde deja de
             *  llegar el golpe, no solo dónde pega perfecto. */
            borde: this.telegraphBorde ?? { cerca: null, lejos: null },
            alcance: attackAreaReach(t.params),
          }
        : null,
      /** Recuento del último episodio de telegraph (o del que corre). A
       *  diferencia de `telegraph`, que es una foto y se pierde los modos
       *  cortos, esto sobrevive al episodio: es lo que hay que mirar para
       *  afirmar que el destello de impacto ocurrió. */
      telegraphEpisode: this.telegraphEpisode ? { ...this.telegraphEpisode } : null,
      veil: v ? { edge: v.edge, opacity: Math.round(v.opacity * 1000) / 1000 } : null,
    };
  }

  dispose(): void {
    this.setDebugView("off", null);
    this.telegraph = null;
    if (this.telegraphMesh) {
      this.scene.remove(this.telegraphMesh.mesh);
      this.telegraphMesh.geo.dispose();
      this.telegraphMesh.mat.dispose();
      this.telegraphMesh = null;
    }
    this.disposeVeil();
    for (const key of [...this.tiles.keys()]) this.removeTile(key);
    this.billboardsPersonaje.clear();
    for (const slot of this.billboards.values()) {
      this.scene.remove(slot.mesh);
      slot.mesh.geometry.dispose();
      slot.mat.map?.dispose();
      slot.mat.dispose();
    }
    this.billboards.clear();
    this.renderer.dispose();
  }
}
