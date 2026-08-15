// lib.mjs — helpers three.js del bench FPS. makeFpsLib(THREE) devuelve los
// constructores de escena (prim → mesh multi-material con UVs en metros),
// colisión AABB, cielo y el banco de sprites y_bot (billboards 8-dir).
// La geometría replica primitiveMesh() de nefan-html/src/scene/
// stage-greybox-render.ts (base en y=0, gable extruido en z, polygon en XZ).

import { SHAPE_GROUPS, DENSITY_M } from "./surfaces.mjs";

export function makeFpsLib(THREE) {
  function gableGeometry(w, h, d) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return g;
  }

  /** Geometría de una primitiva + spec de grupos de material.
   *  Devuelve { geo, groupMats: {side: idx|null, ...}, faceUvSizes } donde
   *  faceUvSizes[i] = [w,h] de mundo del grupo de three.js i (para tilear). */
  function primitiveGeometry(p) {
    const s = p.size;
    switch (p.shape) {
      case "box": {
        const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
        g.translate(0, s[1] / 2, 0);
        return { geo: g, faceUvSizes: [[s[2], s[1]], [s[2], s[1]], [s[0], s[2]], [s[0], s[2]], [s[0], s[1]], [s[0], s[1]]] };
      }
      case "gable": {
        const g = gableGeometry(s[0], s[1], s[2]);
        return { geo: g, faceUvSizes: null, extrude: true };
      }
      case "cylinder": {
        const g = new THREE.CylinderGeometry(s[2] ?? s[0], s[0], s[1], 24);
        g.translate(0, s[1] / 2, 0);
        return { geo: g, faceUvSizes: [[2 * Math.PI * s[0], s[1]], [2 * s[0], 2 * s[0]], [2 * s[0], 2 * s[0]]] };
      }
      case "cone": {
        const g = new THREE.ConeGeometry(s[0], s[1], Math.max(3, Math.round(s[2] ?? 16)));
        g.translate(0, s[1] / 2, 0);
        return { geo: g, faceUvSizes: [[2 * Math.PI * s[0], Math.hypot(s[0], s[1])]] };
      }
      case "sphere": {
        const r = s[0];
        const seg = Math.max(6, Math.round(s[1] ?? 16));
        const g = new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg / 2)));
        g.translate(0, r, 0);
        return { geo: g, faceUvSizes: [[2 * Math.PI * r, Math.PI * r]] };
      }
      case "polygon": {
        const pts = p.points ?? [];
        if (pts.length < 3) throw new Error(`polygon con ${pts.length} points`);
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
        throw new Error(`shape desconocida: ${p.shape}`);
    }
  }

  /** Escala las UVs de un rango de vértices de un grupo de three.js. */
  function scaleGroupUVs(geo, group, su, sv) {
    const uv = geo.attributes.uv;
    if (!uv) return;
    const index = geo.index;
    const seen = new Set();
    for (let i = group.start; i < group.start + group.count; i++) {
      const v = index ? index.getX(i) : i;
      if (seen.has(v)) continue;
      seen.add(v);
      uv.setXY(v, uv.getX(v) * su, uv.getY(v) * sv);
    }
    uv.needsUpdate = true;
  }

  /** Banco de texturas de un run: textures/<cellKey>.png con wrap por kind.
   *  Sin run (null) todas las consultas devuelven null (modo clay). */
  function makeTexLib(runUrl, layout) {
    const loader = new THREE.TextureLoader();
    const cache = new Map();
    const cellsByKey = new Map();
    const pending = [];
    if (layout) {
      for (const page of layout.pages) for (const c of page.cells) cellsByKey.set(c.key, c);
    }
    return {
      pending,
      cell: (key) => cellsByKey.get(key) ?? null,
      get(key) {
        if (!runUrl || !cellsByKey.has(key)) return null;
        if (cache.has(key)) return cache.get(key);
        const cell = cellsByKey.get(key);
        const promise = new Promise((resolve, reject) => {
          loader.load(
            `${runUrl}/textures/${key}.png`,
            (t) => {
              t.colorSpace = THREE.SRGBColorSpace;
              t.anisotropy = 4;
              if (cell.kind === "tile") t.wrapS = t.wrapT = THREE.RepeatWrapping;
              else t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
              resolve(t);
            },
            undefined,
            (err) => reject(new Error(`textura ${key}: ${err?.message ?? "fallo de carga"}`)),
          );
        });
        pending.push(promise);
        const tex = { promise, texture: null };
        promise.then((t) => (tex.texture = t));
        cache.set(key, tex);
        return tex;
      },
    };
  }

  /** Mesh de una primitiva con materiales por grupo de caras. `assignEntry`
   *  viene de surfaceCells (groups → cellKey|null); texLib resuelve celdas. */
  function primitiveMesh(p, assignEntry, texLib, { filter = "linear" } = {}) {
    const { geo, faceUvSizes, extrude } = primitiveGeometry(p);
    const groups = SHAPE_GROUPS[p.shape];
    const clay = () => new THREE.MeshStandardMaterial({ color: p.color, roughness: p.roughness ?? 0.92 });

    // Un material por GRUPO lógico (side/top/...), compartido por sus caras.
    const groupMaterial = {};
    for (const [group, faceIdxs] of Object.entries(groups)) {
      const cellKey = assignEntry?.groups?.[group] ?? null;
      const cell = cellKey && texLib.cell(cellKey);
      const entry = cellKey && texLib.get(cellKey);
      if (!entry) {
        groupMaterial[group] = clay();
      } else {
        const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: p.roughness ?? 0.92 });
        entry.promise
          .then((t) => {
            const tex = t.clone();
            tex.needsUpdate = true;
            if (filter === "nearest") {
              tex.magFilter = THREE.NearestFilter;
              tex.minFilter = THREE.NearestMipmapLinearFilter;
            }
            m.map = tex;
            m.needsUpdate = true;
          })
          .catch((err) => {
            // Run incompleto (p.ej. C-local sin heroes): degradar a clay, no
            // a blanco, y avisar una sola vez por consola.
            m.color = new THREE.Color(p.color);
            console.warn(`textura ${cellKey} ausente — clay:`, err.message);
          });
        groupMaterial[group] = m;
      }
      // UVs en metros para celdas tileables; 0..1 para únicas.
      if (cell && cell.kind === "tile") {
        if (faceUvSizes) {
          const geoGroups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
          for (const fi of faceIdxs) {
            const gg = geoGroups[fi];
            if (!gg) continue;
            const [fw, fh] = faceUvSizes[fi];
            scaleGroupUVs(geo, gg, fw / DENSITY_M, fh / DENSITY_M);
          }
        } else if (extrude) {
          // ExtrudeGeometry: UVs ya en unidades de mundo → 1 repetición cada
          // DENSITY_M metros.
          for (const fi of faceIdxs) {
            const gg = geo.groups[fi];
            if (gg) scaleGroupUVs(geo, gg, 1 / DENSITY_M, 1 / DENSITY_M);
          }
        }
      } else if (cell && extrude) {
        // Celda única sobre extrude: normalizar las UVs del grupo a 0..1.
        for (const fi of faceIdxs) {
          const gg = geo.groups[fi];
          if (gg) normalizeGroupUVs(geo, gg);
        }
      }
    }

    const nSlots = geo.groups.length || 1;
    const mats = [];
    for (let i = 0; i < nSlots; i++) {
      const group = Object.entries(groups).find(([, idxs]) => idxs.includes(i))?.[0] ?? "side";
      mats.push(groupMaterial[group] ?? clay());
    }
    const mesh = new THREE.Mesh(geo, nSlots === 1 ? mats[0] : mats);
    mesh.position.set(...p.pos);
    if (p.rotY) mesh.rotation.y = p.rotY;
    if (p.rotX) mesh.rotation.x = p.rotX;
    mesh.castShadow = !p.noShadow;
    mesh.receiveShadow = true;
    return mesh;
  }

  function normalizeGroupUVs(geo, group) {
    const uv = geo.attributes.uv;
    if (!uv) return;
    const index = geo.index;
    const verts = new Set();
    for (let i = group.start; i < group.start + group.count; i++) verts.add(index ? index.getX(i) : i);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const v of verts) {
      minU = Math.min(minU, uv.getX(v)); maxU = Math.max(maxU, uv.getX(v));
      minV = Math.min(minV, uv.getY(v)); maxV = Math.max(maxV, uv.getY(v));
    }
    const du = maxU - minU || 1, dv = maxV - minV || 1;
    for (const v of verts) uv.setXY(v, (uv.getX(v) - minU) / du, (uv.getY(v) - minV) / dv);
    uv.needsUpdate = true;
  }

  /** Luces del vocabulario GreyboxLight. */
  function buildLights(lights) {
    const out = [];
    for (const l of lights) {
      if (l.kind === "ambient") out.push(new THREE.AmbientLight(l.color, l.intensity));
      else if (l.kind === "hemi") out.push(new THREE.HemisphereLight(l.color, l.groundColor ?? "#6a6055", l.intensity));
      else if (l.kind === "point") {
        const p = new THREE.PointLight(l.color, l.intensity, l.distance ?? 0, l.decay ?? 2);
        p.position.set(...(l.pos ?? [0, 1, 0]));
        out.push(p);
      } else {
        const sun = new THREE.DirectionalLight(l.color, l.intensity);
        sun.position.set(...(l.pos ?? [40, 60, 40]));
        sun.target.position.set(32, 0, 32);
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
          // A ras de suelo el acne del alero (sawtooth en las coronaciones)
          // se ve mucho más que en la cenital: normalBias lo elimina.
          sun.shadow.normalBias = 0.06;
        }
        const g = new THREE.Group();
        g.add(sun, sun.target);
        out.push(g);
      }
    }
    return out;
  }

  /** Cúpula de cielo con gradiente vertical (BackSide, sin fog). */
  function skyDome(top, bottom) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
        vertexShader:
          "varying float vY; void main(){ vY = normalize(position).y;" +
          " gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "varying float vY; uniform vec3 top; uniform vec3 bottom;" +
          " void main(){ gl_FragColor = vec4(mix(bottom, top, clamp(vY*2.2, 0.0, 1.0)), 1.0); }",
        side: 1, // BackSide
        depthWrite: false,
        fog: false,
      }),
    );
    m.userData.sky = true;
    return m;
  }

  /** AABBs de colisión [x0,z0,x1,z1] desde las prims. Regla: sólida si tiene
   *  cuerpo (h>0.4), arranca por debajo de la cintura (baseY<1.2) y no es
   *  suelo/detalle. Los dinteles (base 2.1) y techos quedan fuera. */
  function collidersFromPrims(prims) {
    const boxes = [];
    for (const p of prims) {
      const h = p.shape === "polygon" ? (p.size[0] ?? 0) : p.size[1];
      const baseY = p.pos[1];
      if (p.cat === "terrain" || p.cat === "decor") continue;
      if (p.shape === "cone" && p.cat === "tree") continue; // copa
      if (h <= 0.4 || baseY > 1.2) continue;
      if (p.shape === "box" || p.shape === "gable") {
        const hw = p.size[0] / 2, hd = p.size[2] / 2;
        if (p.rotY) {
          const c = Math.abs(Math.cos(p.rotY)), s = Math.abs(Math.sin(p.rotY));
          const rw = hw * c + hd * s, rd = hw * s + hd * c;
          boxes.push([p.pos[0] - rw, p.pos[2] - rd, p.pos[0] + rw, p.pos[2] + rd]);
        } else {
          boxes.push([p.pos[0] - hw, p.pos[2] - hd, p.pos[0] + hw, p.pos[2] + hd]);
        }
      } else if (p.shape === "cylinder" || p.shape === "cone" || p.shape === "sphere") {
        const r = p.size[0];
        boxes.push([p.pos[0] - r, p.pos[2] - r, p.pos[0] + r, p.pos[2] + r]);
      }
      // polygon alto no aparece en estas escenas; si llega, su AABB:
      else if (p.shape === "polygon" && p.points) {
        const xs = p.points.map((q) => q[0]), zs = p.points.map((q) => q[1]);
        boxes.push([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]);
      }
    }
    return boxes;
  }

  /** Círculo r contra AABBs, resolución por ejes (deslizamiento). */
  function makeCollider(boxes, r = 0.35) {
    const hits = (x, z) =>
      boxes.some(([x0, z0, x1, z1]) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r);
    return {
      move(x, z, dx, dz) {
        let nx = x + dx, nz = z;
        if (hits(nx, nz)) nx = x;
        nz = z + dz;
        if (hits(nx, nz)) nz = z;
        return [nx, nz];
      },
      hits,
    };
  }

  // --- Sprites y_bot -------------------------------------------------------
  const ANIM_LOOPS = new Set(["idle", "walk", "run"]);
  const FRAME_WORLD_M = 2.4; // el frame de 256 cubre 2.4 m (SHEET_FRAME_WORLD_M)
  const FEET_FROM_BOTTOM = 0.15; // los pies caen al 85% del frame desde arriba

  function makeSpriteBank(rootUrl, angle = "frontal_8") {
    const loader = new THREE.TextureLoader();
    const metas = new Map();
    const frames = new Map();
    return {
      metaSync: (anim) => metas.get(anim) ?? null,
      async meta(anim) {
        if (metas.has(anim)) return metas.get(anim);
        const res = await fetch(`${rootUrl}/${anim}/${angle}/meta.json`);
        if (!res.ok) throw new Error(`meta ${anim}/${angle}: HTTP ${res.status}`);
        const m = await res.json();
        metas.set(anim, m);
        return m;
      },
      /** Textura del frame o null si aún carga (se mantiene la anterior). */
      frame(anim, dir, idx) {
        const key = `${anim}/${dir}/${idx}`;
        if (frames.has(key)) return frames.get(key).texture;
        const url = `${rootUrl}/${anim}/${angle}/dir_${dir}_frame_${String(idx).padStart(3, "0")}.png`;
        const slot = { texture: null };
        frames.set(key, slot);
        loader.load(url, (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          slot.texture = t;
        });
        return null;
      },
      /** Precarga un (anim, dir) completo; resuelve al terminar. */
      async preload(anim, dir) {
        const m = await this.meta(anim);
        await Promise.all(
          Array.from({ length: m.frame_count }, (_, i) => {
            const key = `${anim}/${dir}/${i}`;
            if (frames.get(key)?.texture) return null;
            const url = `${rootUrl}/${anim}/${angle}/dir_${dir}_frame_${String(i).padStart(3, "0")}.png`;
            return new Promise((resolve) => {
              loader.load(url, (t) => {
                t.colorSpace = THREE.SRGBColorSpace;
                frames.set(key, { texture: t });
                resolve();
              }, undefined, () => resolve());
            });
          }),
        );
      },
    };
  }

  /** Yaw de un vector XZ (0 = +z, crece hacia +x — convención pickDirection). */
  const yawOf = (x, z) => Math.atan2(x, z);

  /** Billboard y_bot de 8 direcciones. npcDef: {id, pos|path, yawDeg, anim, speed}. */
  function makeNpc(def, bank) {
    const geo = new THREE.PlaneGeometry(FRAME_WORLD_M, FRAME_WORLD_M);
    geo.translate(0, FRAME_WORLD_M / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ alphaTest: 0.5, roughness: 0.95, transparent: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    const start = def.path ? def.path[0] : def.pos;
    const state = {
      def, mesh, t: Math.random() * 2,
      x: start[0], z: start[1],
      yaw: ((def.yawDeg ?? 0) * Math.PI) / 180,
      leg: 0, legT: 0,
    };
    mesh.position.set(state.x, -FRAME_WORLD_M * FEET_FROM_BOTTOM, state.z);
    return {
      mesh,
      async init() {
        await bank.meta(def.anim);
      },
      update(dt, cam) {
        state.t += dt;
        if (def.path) {
          const speed = def.speed ?? 1.1;
          const target = def.path[(state.leg + 1) % def.path.length];
          const dx = target[0] - state.x, dz = target[1] - state.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.08) state.leg = (state.leg + 1) % def.path.length;
          else {
            state.x += (dx / dist) * speed * dt;
            state.z += (dz / dist) * speed * dt;
            state.yaw = yawOf(dx, dz);
          }
        }
        const m = bank.metaSync(def.anim);
        if (!m) return;
        const toCam = [cam.position.x - state.x, cam.position.z - state.z];
        // Calibrado empíricamente (bench cardinal S/E/N/W): el set frontal_8
        // gira en sentido contrario a yaw_npc − yaw(toCam) — con el orden
        // invertido los perfiles E/W salen del lado correcto.
        const rel = yawOf(toCam[0], toCam[1]) - state.yaw;
        const dirCount = m.directions ?? 8;
        let dir = Math.round(rel / ((2 * Math.PI) / dirCount)) % dirCount;
        if (dir < 0) dir += dirCount;
        const looping = ANIM_LOOPS.has(def.anim);
        const idx = looping
          ? Math.floor(state.t * m.fps) % m.frame_count
          : Math.min(Math.floor(state.t * m.fps), m.frame_count - 1);
        const tex = bank.frame(def.anim, dir, idx);
        if (tex) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
        mesh.position.set(state.x, -FRAME_WORLD_M * FEET_FROM_BOTTOM, state.z);
        mesh.rotation.y = yawOf(toCam[0], toCam[1]);
      },
    };
  }

  return {
    primitiveMesh,
    buildLights,
    skyDome,
    collidersFromPrims,
    makeCollider,
    makeTexLib,
    makeSpriteBank,
    makeNpc,
    FRAME_WORLD_M,
  };
}
