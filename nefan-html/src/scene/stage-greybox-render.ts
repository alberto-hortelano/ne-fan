/** Intérprete three.js del GreyboxSpec — la ÚNICA pieza con GL del pipeline.
 *
 *  Renderiza el spec (nefan-core/src/scene/stage/greybox.ts) a un canvas
 *  1024² que es el plano base del repintado (clay → gpt-image-2). Aquí no se
 *  calcula NADA de proyección: la cámara viene cocida en spec.camera y su
 *  equivalencia con stageToViewAt está garantizada por tests de core. El PNG
 *  resultante NO es byte-determinista (WebGL) — la clave de caché es el hash
 *  del spec canónico, nunca los píxeles. */

import * as THREE from "three";
import type { GreyboxSpec, GreyboxPrimitive } from "@nefan-core/src/scene/stage/greybox.js";
import { STAGE_RENDER_SIZE } from "@nefan-core/src/scene/stage/segments.js";

let renderer: THREE.WebGLRenderer | null = null;

function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  r.setSize(STAGE_RENDER_SIZE, STAGE_RENDER_SIZE, false);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.domElement.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    renderer = null; // el siguiente render crea un contexto nuevo
  });
  renderer = r;
  return r;
}

function material(color: string, roughness = 0.92): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** Prisma a dos aguas: cumbrera a lo largo del eje z local, base en y=0.
 *  size = [w, h, d] como en el spec. */
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

function primitiveMesh(p: GreyboxPrimitive): THREE.Mesh {
  let geo: THREE.BufferGeometry;
  switch (p.shape) {
    case "box": {
      const [w, h, d] = p.size;
      geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(0, h / 2, 0); // origen en la BASE (contrato del spec)
      break;
    }
    case "gable": {
      const [w, h, d] = p.size;
      geo = gableGeometry(w, h, d);
      break;
    }
    case "cylinder": {
      const [r, h, rTop] = p.size;
      geo = new THREE.CylinderGeometry(rTop ?? r, r, h, 24);
      geo.translate(0, h / 2, 0);
      break;
    }
    case "cone": {
      const [r, h, segments] = p.size;
      geo = new THREE.ConeGeometry(r, h, Math.max(3, Math.round(segments ?? 16)));
      geo.translate(0, h / 2, 0);
      break;
    }
    case "polygon": {
      // Contorno plano horizontal: points absolutos [x, z], grosor en size[0];
      // pos solo aporta la y de la base (contrato de greybox/common.ts).
      const pts = p.points ?? [];
      if (pts.length < 3) throw new Error(`greybox polygon con ${pts.length} points (mínimo 3)`);
      const t = p.size[0] ?? 0.02;
      const shape = new THREE.Shape();
      shape.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
      g.rotateX(Math.PI / 2); // el shape vive en XY → tumbarlo al plano XZ
      g.translate(0, t, 0); // extrusión hacia ARRIBA desde la base y=0
      geo = g;
      break;
    }
  }
  const mesh = new THREE.Mesh(geo, material(p.color, p.roughness ?? 0.92));
  mesh.position.set(...p.pos);
  if (p.rotY) mesh.rotation.y = p.rotY;
  mesh.castShadow = !p.noShadow;
  mesh.receiveShadow = true;
  return mesh;
}

/** Plano de cielo con gradiente vertical, lejos al norte, sin niebla. */
function skyMesh(top: string, bottom: string, zNorth: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(top) },
      bottom: { value: new THREE.Color(bottom) },
    },
    vertexShader:
      "varying float vY; void main(){ vY = uv.y;" +
      " gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "varying float vY; uniform vec3 top; uniform vec3 bottom;" +
      " void main(){ gl_FragColor = vec4(mix(bottom, top, vY), 1.0); }",
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1200), mat);
  m.position.set(0, 300, zNorth);
  return m;
}

/** Monta escena+cámara del spec, filtrando primitivas, y la renderiza a un
 *  canvas 2D nuevo de STAGE_RENDER_SIZE². `transparent` omite fondo/cielo y
 *  deja alpha 0 fuera de las mallas (recortes clay). */
function renderSpec(
  spec: GreyboxSpec,
  keep: (p: GreyboxPrimitive) => boolean,
  transparent: boolean,
): HTMLCanvasElement {
  const r = getRenderer();
  const scene = new THREE.Scene();
  if (!transparent) {
    if (spec.fog) scene.fog = new THREE.Fog(spec.fog.color, spec.fog.near, spec.fog.far);
    if (spec.sky) {
      scene.background = new THREE.Color(spec.sky.bottom);
      scene.add(skyMesh(spec.sky.top, spec.sky.bottom, spec.camera.pos[2] - 600));
    } else {
      scene.background = new THREE.Color("#0c0a0e");
    }
  }

  const shadowSpan = Math.max(40, spec.proj.width_m * 1.5 + spec.proj.depth_m);
  for (const l of spec.lights) {
    if (l.kind === "ambient") {
      scene.add(new THREE.AmbientLight(l.color, l.intensity));
    } else if (l.kind === "hemi") {
      scene.add(new THREE.HemisphereLight(l.color, l.groundColor ?? "#6a6055", l.intensity));
    } else {
      const sun = new THREE.DirectionalLight(l.color, l.intensity);
      sun.position.set(...(l.pos ?? [40, 60, 40]));
      sun.target.position.set(0, 0, 0);
      if (l.castShadow) {
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -shadowSpan;
        sun.shadow.camera.right = shadowSpan;
        sun.shadow.camera.top = shadowSpan;
        sun.shadow.camera.bottom = -shadowSpan;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 500;
        sun.shadow.bias = -0.0006;
      }
      scene.add(sun, sun.target);
    }
  }

  for (const p of spec.primitives) {
    if (keep(p)) scene.add(primitiveMesh(p));
  }

  // Cámara EXACTA del spec: mirada horizontal al norte, frame simétrico
  // respecto al horizonte recortado al view_box con setViewOffset.
  const cam = new THREE.PerspectiveCamera(spec.camera.fov_y_deg, spec.camera.aspect, 0.3, 1200);
  cam.position.set(...spec.camera.pos);
  cam.lookAt(spec.camera.pos[0], spec.camera.pos[1], spec.camera.pos[2] - 1);
  const vo = spec.camera.view_offset;
  cam.setViewOffset(vo.fullW, vo.fullH, vo.x, vo.y, vo.w, vo.h);
  cam.updateProjectionMatrix();

  try {
    r.setClearColor(0x000000, transparent ? 0 : 1);
    r.render(scene, cam);
    const out = document.createElement("canvas");
    out.width = STAGE_RENDER_SIZE;
    out.height = STAGE_RENDER_SIZE;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("renderGreybox: sin contexto 2d");
    ctx.drawImage(r.domElement, 0, 0, STAGE_RENDER_SIZE, STAGE_RENDER_SIZE);
    return out;
  } finally {
    // Liberar la escena (el renderer singleton se conserva).
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

/** Renderiza el spec COMPLETO (plano base del repintado). */
export function renderGreybox(spec: GreyboxSpec): HTMLCanvasElement {
  return renderSpec(spec, () => true, false);
}

/** Render por CAPAS del clay para el modo vector: placa (escena sin
 *  volúmenes) + un recorte RGBA por volumen del manifest, todos con la misma
 *  cámara/luces. Al ser render PROPIO (no pintura IA), las siluetas del spec
 *  son exactas — la prohibición de recortar con siluetas declaradas aplica
 *  solo a imágenes repintadas. */
export function renderGreyboxLayers(spec: GreyboxSpec): {
  plate: HTMLCanvasElement;
  cutouts: Array<{ volId: string; canvas: HTMLCanvasElement }>;
} {
  const plate = renderSpec(spec, (p) => p.volId === undefined, false);
  const volIds = [...new Set(spec.manifest.map((m) => m.id))];
  const cutouts = volIds.map((volId) => ({
    volId,
    // Las primitivas llevan el MISMO id "vol_<id>" que el manifest.
    canvas: renderSpec(spec, (p) => p.volId === volId, true),
  }));
  return { plate, cutouts };
}
