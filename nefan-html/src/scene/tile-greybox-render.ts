/** Intérprete three.js del TileGreyboxSpec (tile oblicuo) — GL solo aquí y en
 *  stage-greybox-render (comparten renderer singleton y primitiveMesh).
 *
 *  La cámara reproduce EXACTAMENTE la proyección del compositor
 *  (blueprint/projection.ts): ortográfica CENITAL (x de vista = x de mundo,
 *  y de vista = z de mundo) + CIZALLA en la matriz del grupo raíz
 *  (x' = x + kx·y, z' = z − ky·y — la y se conserva para que el z-buffer
 *  ordene). Equivalencia con pt(u,v,h) garantizada por tests de core.
 *
 *  Salida: el CLAY base del tile (sin los tramos de occluder — los pinta el
 *  depth-sort) con alpha fuera del cuadrado del tile (la silueta del
 *  compositing/maskByBlueprint), más un canvas RGBA por occluder renderizado
 *  re-encuadrando la MISMA cámara a su bbox — píxel a píxel lo mismo que la
 *  base en su posición. El PNG NO es byte-determinista: la clave de caché es
 *  el hash del spec canónico, jamás los píxeles. */

import * as THREE from "three";
import {
  CANOPY_OPACITY,
  type TileGreyboxSpec,
  type TileOccluderSpec,
} from "@nefan-core/src/scene/blueprint/index.js";
import { getRenderer, primitiveMesh } from "./stage-greybox-render.js";

export interface TileGreyboxRender {
  /** Clay del tile (canvas view_box·px_per_cell), alpha fuera del suelo. */
  base: HTMLCanvasElement;
  /** Un canvas por occluder (tamaño bbox·px_per_cell). Las copas (overhead)
   *  llevan CANOPY_OPACITY ya horneada en el alpha. */
  occluders: Array<{ occ: TileOccluderSpec; canvas: HTMLCanvasElement }>;
}

/** Renderiza una vista [minX, minY, w, h] (unidades del view_box) a canvas. */
function renderView(
  r: THREE.WebGLRenderer,
  scene: THREE.Scene,
  minX: number,
  minY: number,
  w: number,
  h: number,
  px: number,
): HTMLCanvasElement {
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000);
  const cx = minX + w / 2;
  const cz = minY + h / 2;
  cam.position.set(cx, 400, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  cam.updateProjectionMatrix();
  const pw = Math.max(1, Math.round(w * px));
  const ph = Math.max(1, Math.round(h * px));
  r.setSize(pw, ph, false);
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  const out = document.createElement("canvas");
  out.width = pw;
  out.height = ph;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("renderTileGreybox: sin contexto 2d");
  ctx.drawImage(r.domElement, 0, 0, pw, ph);
  return out;
}

export function renderTileGreybox(spec: TileGreyboxSpec): TileGreyboxRender {
  const r = getRenderer();
  const scene = new THREE.Scene();

  for (const l of spec.lights) {
    if (l.kind === "ambient") {
      scene.add(new THREE.AmbientLight(l.color, l.intensity));
    } else if (l.kind === "hemi") {
      scene.add(new THREE.HemisphereLight(l.color, l.groundColor ?? "#6a6055", l.intensity));
    } else {
      const sun = new THREE.DirectionalLight(l.color, l.intensity);
      sun.position.set(...(l.pos ?? [-80, 140, 220]));
      sun.target.position.set(64, 0, 64);
      if (l.castShadow) {
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -110;
        sun.shadow.camera.right = 110;
        sun.shadow.camera.top = 110;
        sun.shadow.camera.bottom = -110;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 600;
        sun.shadow.bias = -0.0006;
      }
      scene.add(sun, sun.target);
    }
  }

  // Grupo raíz con la CIZALLA del spec (misma matriz que el viewer del bench).
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.matrix.set(
    1, spec.camera.kx, 0, 0,
    0, 1, 0, 0,
    0, -spec.camera.ky, 1, 0,
    0, 0, 0, 1,
  );
  scene.add(root);

  // Una malla por primitiva; los passes alternan visible (una sola escena).
  const meshes: THREE.Mesh[] = spec.primitives.map((p) => {
    const m = primitiveMesh(p);
    root.add(m);
    return m;
  });

  const px = spec.camera.px_per_cell;
  const vb = spec.camera.view_box;
  const occPrimIdx = new Set(spec.occluders.flatMap((o) => o.prims));

  try {
    // ── Base: todo MENOS los tramos de occluder (los pinta el depth-sort). ──
    meshes.forEach((m, i) => {
      m.visible = !occPrimIdx.has(i);
    });
    const base = renderView(r, scene, vb.minX, vb.minY, vb.width, vb.height, px);

    // ── Un pase por occluder: solo sus primitivas, re-encuadrado a su bbox. ─
    const occluders: TileGreyboxRender["occluders"] = [];
    for (const occ of spec.occluders) {
      const mine = new Set(occ.prims);
      meshes.forEach((m, i) => {
        m.visible = mine.has(i);
      });
      const [bx, by, bw, bh] = occ.bbox;
      if (!(bw > 0) || !(bh > 0)) continue;
      let canvas = renderView(r, scene, bx, by, bw, bh, px);
      if (occ.overhead) {
        // Copa: la traslucidez se hornea UNA vez en el canvas del recorte.
        const out = document.createElement("canvas");
        out.width = canvas.width;
        out.height = canvas.height;
        const ctx = out.getContext("2d")!;
        ctx.globalAlpha = CANOPY_OPACITY;
        ctx.drawImage(canvas, 0, 0);
        canvas = out;
      }
      occluders.push({ occ, canvas });
    }
    return { base, occluders };
  } finally {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      }
    });
  }
}
