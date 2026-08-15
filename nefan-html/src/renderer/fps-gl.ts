/** Internals WebGL de la vista FPS (import DINÁMICO desde FpsRenderer — three
 *  no entra en el bundle salvo que la vista se active). Port del bench
 *  labs/fps/lib.mjs con las convenciones del juego:
 *
 *  - Renderer y canvas PROPIOS: el singleton offscreen de
 *    stage-greybox-render sigue libre para clay/thumbnails.
 *  - Un THREE.Group por tile (prims en metros, offset = world_rect del tile);
 *    materiales por grupo de caras indexados por celda del atlas — el clay es
 *    el color del prim y applyAtlas() los texturiza sin reconstruir geometría.
 *  - Billboards y_bot de 8 direcciones: la dirección es
 *    `yaw(cámara→entidad) − yaw_entidad` (signo CALIBRADO en el bench con la
 *    pasada cardinal S/E/N/W — NO usar pickDirection, gira al revés).
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
import type { GreyboxLight } from "@nefan-core/src/scene/greybox/common.js";
import type { Entity } from "./canvas-renderer.js";
import type { PlayerView } from "./renderer2d.js";
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

/** Modos de la tecla B en fps (espejo del ciclo de las otras vistas). */
export type FpsDebugView = "off" | "collision" | "surfaces";

/** Celdas sólidas del tile activo, en METROS de mundo (esquina mínima). */
export interface FpsDebugCollision {
  cells: [number, number][];
  size: number;
}

/** Altura del overlay de colisión: por encima del stack de suelo (deck top
 *  ~0.105 m + stagger de fps-spec). */
const DEBUG_COLLISION_Y = 0.2;

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
  private lightsGroup: THREE.Group | null = null;
  private sky: THREE.Mesh;
  private billboards = new Map<
    string,
    { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; lastDir?: number }
  >();
  private texByImage = new WeakMap<HTMLImageElement, THREE.Texture>();
  private renderYaw = 0;
  private lastNow = 0;
  private activeKey: string | null = null;
  private debugView: FpsDebugView = "off";
  private collisionMesh: THREE.InstancedMesh | null = null;
  private forwardArrows = new Map<string, THREE.ArrowHelper>();
  /** map/color originales de los materiales tintados por el modo surfaces. */
  private tintSaved = new Map<THREE.MeshStandardMaterial, { map: THREE.Texture | null; color: number }>();

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
    // near 0.3 (no 0.1): ×3 de precisión de z-buffer — con 0.1 las capas del
    // suelo (separadas 2 mm por el stagger de fps-spec) aún z-fighteaban a
    // media distancia. Nada renderiza a <0.3 m del ojo (radio jugador 0.4).
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
  ): void {
    this.removeTile(key);
    const group = new THREE.Group();
    group.position.set(rect.minX, 0, rect.minZ);
    const materialsByCell = new Map<string, THREE.MeshStandardMaterial[]>();
    const detailMeshes: THREE.Mesh[] = [];
    const cellByKey = new Map<string, SurfaceCell>();
    for (const page of layout.pages) for (const c of page.cells) cellByKey.set(c.key, c);

    primsM.forEach((prim, i) => {
      const assign: SurfaceAssign | undefined = layout.assign[i];
      const { geo, faceUvSizes, extrude } = primitiveGeometry(prim);
      const groups = SHAPE_GROUPS[prim.shape] ?? {};
      const clay = () =>
        new THREE.MeshStandardMaterial({ color: prim.color, roughness: prim.roughness ?? 0.92 });

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
          const geoGroups = geo.groups.length
            ? geo.groups
            : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
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

      const nSlots = geo.groups.length || 1;
      const mats: THREE.Material[] = [];
      for (let slot = 0; slot < nSlots; slot++) {
        const g = (Object.entries(groups) as [SurfaceGroup, number[]][]).find(([, idxs]) =>
          idxs.includes(slot),
        )?.[0];
        mats.push((g && groupMaterial[g]) || clay());
      }
      const mesh = new THREE.Mesh(geo, nSlots === 1 ? mats[0] : mats);
      mesh.position.set(...prim.pos);
      if (prim.rotY) mesh.rotation.y = prim.rotY;
      if (prim.rotX) mesh.rotation.x = prim.rotX;
      mesh.castShadow = !prim.noShadow;
      mesh.receiveShadow = true;
      // Solo el detalle procedural SIN celda (elipses/piedritas clay) se
      // oculta al texturizar — los caminos/plazas del ground ya llevan la suya.
      if (prim.cat === "terrain" && prim.shape !== "box" && !hasAnyCell) detailMeshes.push(mesh);
      group.add(mesh);
    });

    this.scene.add(group);
    this.tiles.set(key, { group, materialsByCell, detailMeshes, textured: false });
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
      m.makeTranslation(x + c.size / 2, DEBUG_COLLISION_Y, z + c.size / 2);
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
    slot.mesh.position.set(e.pos.x, -FRAME_WORLD_M * FEET_FROM_BOTTOM, e.pos.z);
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
      arrow.position.set(e.pos.x, 2.1, e.pos.z);
      arrow.setDirection(dir);
      arrow.visible = true;
    }
    if (e.sprite && this.spriteRenderer) {
      const sheet = this.spriteRenderer.getCached(e.sprite.model, e.sprite.anim, e.sprite.angle);
      if (sheet) {
        const t = e.sprite.animStartedAt !== undefined ? (now - e.sprite.animStartedAt) / 1000 : now / 1000;
        const frame = this.spriteRenderer.pickFrame(sheet, t);
        const fwd = e.forward ?? { x: 0, y: 0, z: 1 };
        // Signo calibrado (bench cardinal): rel = yaw(cam→npc) − yaw_npc.
        const rel = yawOf(toCamX, toCamZ) - yawOf(fwd.x, fwd.z);
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
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      geo.translate(0, sy / 2, 0);
      const mat = new THREE.MeshStandardMaterial({ color: e.color || "#8a6b4a", roughness: 0.92 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      slot = { mesh, mat };
      this.billboards.set(e.id, slot);
      this.scene.add(mesh);
    }
    slot.mesh.visible = true;
    slot.mesh.position.set(e.pos.x, 0, e.pos.z);
  }

  render(player: PlayerView, enemies: Entity[], objects: Entity[], npcs: Entity[]): void {
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
    this.cam.position.set(player.pos.x, EYE_M, player.pos.z);
    // rotation.y = π + yaw: la cámara de three mira −z con rotación 0 y
    // yawOf tiene 0 = +z (R_y(π+yaw)·(0,0,−1) = (sin yaw, 0, cos yaw)).
    this.cam.rotation.set(0, Math.PI + this.renderYaw, 0, "YXZ");
    this.sky.position.copy(this.cam.position);

    const seen = new Set<string>();
    for (const e of [...npcs, ...enemies]) {
      if (!e.alive && e.sprite === undefined) continue;
      seen.add(e.id);
      this.updateEntity(e, now);
    }
    for (const e of objects) {
      // Los objetos DECLARADOS por la escena ya están en el greybox del tile
      // (volumes declarados o derivados de entities): una caja encima los
      // duplicaría. Solo se pintan los spawns dinámicos (react_to_player).
      if (e.sceneDeclared) continue;
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

    this.renderer.render(this.scene, this.cam);
  }

  debugState(): Record<string, unknown> {
    return {
      tiles: [...this.tiles.keys()],
      activeTile: this.activeKey,
      textured: [...this.tiles.entries()].filter(([, t]) => t.textured).map(([k]) => k),
      renderYawDeg: Math.round((this.renderYaw * 180) / Math.PI),
      billboards: [...this.billboards.entries()].filter(([, s]) => s.mesh.visible).length,
      debugView: this.debugView,
    };
  }

  dispose(): void {
    this.setDebugView("off", null);
    for (const key of [...this.tiles.keys()]) this.removeTile(key);
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
