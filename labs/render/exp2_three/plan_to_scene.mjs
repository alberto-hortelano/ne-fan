// plan_to_scene.mjs — E2a: escena three.js DETERMINISTA construida desde el
// plan declarado (map_ground + volumes). Unidades = celdas (1 celda = 2 m);
// alturas también en celdas (un personaje ≈ 3.6). El suelo es el raster del
// map_ground compuesto (ground crop 0..128); los volúmenes se levantan como
// mallas con texturas IA locales. La cizalla oblicua la aplica el viewer.

const WALL_TEX = { plaster: "plaster", stone: "stone_wall", timber: "wood_planks", brick: "stone_wall", metal: "metal_plate" };

function scaleBoxUVs(THREE, geom, sx, sy, sz, density = 8) {
  // BoxGeometry trae UV 0..1 por cara; escala cada cara a dims/density para
  // que la textura repita proporcional al tamaño real.
  const uv = geom.attributes.uv;
  const faces = [
    [sz, sy], [sz, sy], // px, nx
    [sx, sz], [sx, sz], // py, ny
    [sx, sy], [sx, sy], // pz, nz
  ];
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = faces[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * (fw / density), uv.getY(i) * (fh / density));
    }
  }
  uv.needsUpdate = true;
  return geom;
}

function box(THREE, ctx, w, h, d, tex, color = 0xffffff) {
  const geom = scaleBoxUVs(THREE, new THREE.BoxGeometry(w, h, d), w, h, d);
  const mat = new THREE.MeshLambertMaterial({ map: ctx.texture(tex), color });
  return new THREE.Mesh(geom, mat);
}

function gableRoof(THREE, ctx, w, d, rise, axis, color) {
  // Prisma triangular con caballete a lo largo de `axis`.
  const along = axis === "y" ? d : w;
  const across = axis === "y" ? w : d;
  const shape = new THREE.Shape();
  shape.moveTo(-across / 2, 0);
  shape.lineTo(0, rise);
  shape.lineTo(across / 2, 0);
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: along, bevelEnabled: false });
  // Las UV del extrude vienen en unidades de mundo: reescalar a ~1 repetición
  // por cada `density` unidades o la textura colapsa a su color medio.
  const uv = geom.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 8, uv.getY(i) / 8);
  uv.needsUpdate = true;
  geom.translate(0, 0, -along / 2);
  if (axis !== "y") geom.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshLambertMaterial({ map: ctx.texture("roof_tiles"), color: color ?? 0xffffff }),
  );
  return mesh;
}

function crenellations(THREE, ctx, group, cx, cz, topY, halfW, halfD, tex) {
  for (let i = -1; i <= 1; i += 2) {
    for (let o = -halfW + 1; o <= halfW - 1; o += 2.4) {
      const m1 = box(THREE, ctx, 1, 1, 1, tex);
      m1.position.set(cx + o, topY + 0.5, cz + i * halfD);
      group.add(m1);
    }
  }
}

/** Divide el intervalo [a,b] quitando los huecos `gaps` = [[g0,g1],...]. */
function carve(a, b, gaps) {
  let spans = [[a, b]];
  for (const [g0, g1] of gaps) {
    const next = [];
    for (const [s0, s1] of spans) {
      if (g1 <= s0 || g0 >= s1) { next.push([s0, s1]); continue; }
      if (g0 > s0) next.push([s0, g0]);
      if (g1 < s1) next.push([g1, s1]);
    }
    spans = next;
  }
  return spans.filter(([s0, s1]) => s1 - s0 > 0.3);
}

export async function build(THREE, ctx) {
  const group = new THREE.Group();
  const plan = ctx.plan;
  //: Vanos de gates: los muros que los cruzan deben tallar el hueco (la
  //: colisión ya lo limpia — clearGatePassage —; el visual tiene que coincidir).
  const gates = plan.volumes.filter((v) => v.type === "gate");
  //: Unidades de oclusión para la demo: {id, footprint:[u0,v0,u1,v1], h,
  //: node, proximityOnly?}. footprint = huella de colisión/depth del juego
  //: (árboles: solo el tronco; su copa se funde por proximidad, no por
  //: "detrás", igual que los overhead del cliente 2D).
  const occluders = [];

  // --- suelo: raster del map_ground compuesto (0..128), y=0 ---
  if (ctx.ground) {
    const t = new THREE.TextureLoader().load(ctx.ground);
    t.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(128, 128),
      new THREE.MeshLambertMaterial({ map: t }),
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set(64, 0, 64);
    g.name = "ground";
    group.add(g);
  }

  for (const v of plan.volumes) {
    const node = new THREE.Group();
    node.name = v.id;
    const color = (hex) => (hex ? new THREE.Color(hex) : new THREE.Color(0xffffff));

    if (v.type === "building") {
      const [u0, v0, w, d] = v.rect;
      const wallH = v.wall_h ?? 5;
      const tex = WALL_TEX[v.walls?.material] ?? "plaster";
      const tint = color(v.walls?.color);
      if (v.cutaway) {
        // Muros traseros (N y O) altos; frontales (S y E) bajos; suelo de
        // madera. Cada muro talla los huecos de sus `doors` (el jugador debe
        // VER por dónde se entra — la colisión ya deja el hueco).
        const t = 1.2, lowH = 1.6;
        const floor = box(THREE, ctx, w, 0.15, d, "wood_planks");
        floor.position.set(u0 + w / 2, 0.1, v0 + d / 2);
        node.add(floor);
        const doorGaps = (edge, base) => (v.doors ?? [])
          .filter((dr) => dr.edge === edge)
          .map((dr) => [base + dr.at, base + dr.at + (dr.w ?? 4)]);
        const wallStrips = (edge, isX, base, lo, hi, hgt) => {
          const grp = new THREE.Group();
          for (const [s0, s1] of carve(lo, hi, doorGaps(edge, isX ? u0 : v0))) {
            const seg = isX
              ? box(THREE, ctx, s1 - s0, hgt, t, tex, tint)
              : box(THREE, ctx, t, hgt, s1 - s0, tex, tint);
            if (isX) seg.position.set((s0 + s1) / 2, hgt / 2, base);
            else seg.position.set(base, hgt / 2, (s0 + s1) / 2);
            grp.add(seg);
          }
          node.add(grp);
          return grp;
        };
        const backN = wallStrips("n", true, v0 + t / 2, u0, u0 + w, wallH);
        const backW = wallStrips("w", false, u0 + t / 2, v0, v0 + d, wallH);
        wallStrips("s", true, v0 + d - t / 2, u0, u0 + w, lowH);
        wallStrips("e", false, u0 + w - t / 2, v0, v0 + d, lowH);
        // Cutaway: como en el compositor, SOLO los muros traseros ocluyen
        // (cada uno su unidad, con huella fina) — el interior nunca se funde.
        occluders.push(
          { id: `${v.id}:back_n`, footprint: [u0, v0, u0 + w, v0 + t], h: wallH, node: backN },
          { id: `${v.id}:back_w`, footprint: [u0, v0, u0 + t, v0 + d], h: wallH, node: backW },
        );
      } else {
        const body = box(THREE, ctx, w, wallH, d, tex, tint);
        body.position.set(u0 + w / 2, wallH / 2, v0 + d / 2);
        node.add(body);
        const kind = v.roof?.kind ?? "gable";
        if (kind === "flat" || kind === "none") {
          const slab = box(THREE, ctx, w + 0.8, 0.4, d + 0.8, "concrete");
          slab.position.set(u0 + w / 2, wallH + 0.2, v0 + d / 2);
          if (kind === "flat") node.add(slab);
        } else {
          const axis = v.roof?.axis ?? (w >= d ? "x" : "y");
          const rise = Math.min(w, d) * 0.45;
          const roof = gableRoof(THREE, ctx, w + 1.2, d + 1.2, rise, axis, color(v.roof?.color));
          roof.position.set(u0 + w / 2, wallH, v0 + d / 2);
          node.add(roof);
        }
        for (const door of v.doors ?? []) {
          const dw = door.w ?? 3;
          const dm = new THREE.Mesh(
            new THREE.BoxGeometry(door.edge === "e" || door.edge === "w" ? 0.3 : dw, 3, door.edge === "e" || door.edge === "w" ? dw : 0.3),
            new THREE.MeshLambertMaterial({ color: 0x2a2018 }),
          );
          const at = door.at ?? 0;
          if (door.edge === "s") dm.position.set(u0 + at + dw / 2, 1.5, v0 + d);
          if (door.edge === "n") dm.position.set(u0 + at + dw / 2, 1.5, v0);
          if (door.edge === "e") dm.position.set(u0 + w, 1.5, v0 + at + dw / 2);
          if (door.edge === "w") dm.position.set(u0, 1.5, v0 + at + dw / 2);
          node.add(dm);
        }
      }
    } else if (v.type === "wall") {
      const width = v.width ?? 3;
      const h = v.h ?? 6;
      const pts = v.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
        const len = Math.hypot(x2 - x1, z2 - z1);
        // Tallar los vanos de los gates que caen SOBRE este segmento (el
        // muro no debe pintarse a través del arco).
        const dirU = (x2 - x1) / (len || 1), dirV = (z2 - z1) / (len || 1);
        const gateGaps = [];
        for (const g of gates) {
          const t = (g.at[0] - x1) * dirU + (g.at[1] - z1) * dirV; // proyección
          if (t < -2 || t > len + 2) continue;
          const px = x1 + dirU * t, pz = z1 + dirV * t;
          if (Math.hypot(g.at[0] - px, g.at[1] - pz) > width / 2 + 2) continue;
          const gw = g.w ?? 8;
          gateGaps.push([t - gw / 2, t + gw / 2]);
        }
        // Tramos de ~14 celdas: cada uno es su propia unidad de oclusión (si
        // no, una muralla de 128 celdas se fundiría entera).
        const spans = carve(0, len, gateGaps);
        const chunks = [];
        for (const [s0, s1] of spans) {
          const n = Math.max(1, Math.ceil((s1 - s0) / 14));
          for (let c = 0; c < n; c++) chunks.push([s0 + ((s1 - s0) * c) / n, s0 + ((s1 - s0) * (c + 1)) / n]);
        }
        chunks.forEach(([t0, t1], ci) => {
          const f0 = t0 / len, f1 = t1 / len;
          const ax = x1 + (x2 - x1) * f0, az = z1 + (z2 - z1) * f0;
          const bx = x1 + (x2 - x1) * f1, bz = z1 + (z2 - z1) * f1;
          const clen = t1 - t0;
          const segGroup = new THREE.Group();
          const seg = box(THREE, ctx, clen + width, h, width, "stone_wall");
          seg.position.set((ax + bx) / 2, h / 2, (az + bz) / 2);
          seg.rotation.y = -Math.atan2(bz - az, bx - ax);
          segGroup.add(seg);
          if (v.crenellated) {
            for (let o = width / 2; o < clen; o += 2.4) {
              const f = o / clen;
              const m = box(THREE, ctx, 1, 1, width + 0.4, "stone_wall");
              m.position.set(ax + (bx - ax) * f, h + 0.5, az + (bz - az) * f);
              segGroup.add(m);
            }
          }
          node.add(segGroup);
          occluders.push({
            id: `${v.id}:${i}:${ci}`,
            footprint: [
              Math.min(ax, bx) - width / 2, Math.min(az, bz) - width / 2,
              Math.max(ax, bx) + width / 2, Math.max(az, bz) + width / 2,
            ],
            h,
            node: segGroup,
          });
        });
      }
    } else if (v.type === "tower") {
      const r = v.r ?? 5, h = v.h ?? 10;
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 1.08, h, 24),
        new THREE.MeshLambertMaterial({ map: ctx.texture("stone_wall", [4, 2]) }),
      );
      cyl.position.set(v.at[0], h / 2, v.at[1]);
      node.add(cyl);
      if (v.crenellated) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
          const m = box(THREE, ctx, 1, 1, 1, "stone_wall");
          m.position.set(v.at[0] + Math.cos(a) * (r - 0.5), h + 0.5, v.at[1] + Math.sin(a) * (r - 0.5));
          node.add(m);
        }
      }
    } else if (v.type === "gate") {
      // Gatehouse legible desde la cenital: jambas robustas + DINTEL de madera
      // oscura más ANCHO que el muro (cruza y se distingue del aparejo) +
      // almenas en las jambas. El vano en sí queda tapado por la tapa del
      // tramo sur (proyección correcta) — al cruzarlo, el fade lo revela.
      const w = v.w ?? 8, h = v.h ?? 7;
      const jambW = 2.2;
      const [gx, gz] = v.at;
      const j1 = box(THREE, ctx, 5, h, jambW, "stone_wall");
      const j2 = box(THREE, ctx, 5, h, jambW, "stone_wall");
      const lintel = box(THREE, ctx, 6.5, 1.8, w + 2 * jambW, "wood_planks", 0x6b4a2c);
      // El vano corre en z (gate sobre muro N-S; orient "y" del contrato).
      j1.position.set(gx, h / 2, gz - w / 2 - jambW / 2);
      j2.position.set(gx, h / 2, gz + w / 2 + jambW / 2);
      lintel.position.set(gx, h - 0.9, gz);
      node.add(j1, j2, lintel);
      for (const zz of [gz - w / 2 - jambW / 2, gz + w / 2 + jambW / 2]) {
        for (const xx of [gx - 1.8, gx, gx + 1.8]) {
          const m = box(THREE, ctx, 1.1, 1.1, 1.1, "stone_wall");
          m.position.set(xx, h + 0.55, zz);
          node.add(m);
        }
      }
    } else if (v.type === "tree") {
      const s = v.s ?? 1;
      const trunkH = 3.2 * s;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45 * s, 0.6 * s, trunkH, 8),
        new THREE.MeshLambertMaterial({ map: ctx.texture("bark") }),
      );
      trunk.position.set(v.at[0], trunkH / 2, v.at[1]);
      node.add(trunk);
      const fol = new THREE.MeshLambertMaterial({ map: ctx.texture("foliage", [2, 2]) });
      const canopyY = trunkH + 1.6 * s;
      for (const [dx, dz, r] of [[0, 0, 2.4], [1.4, 0.6, 1.7], [-1.3, -0.5, 1.8], [0.3, -1.2, 1.6]]) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(r * s, 12, 10), fol);
        ball.position.set(v.at[0] + dx * s, canopyY + (Math.abs(dx) < 0.5 ? 0.5 : 0), v.at[1] + dz * s);
        node.add(ball);
      }
    } else if (v.type === "bush") {
      const s = v.s ?? 1;
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(1.2 * s, 10, 8),
        new THREE.MeshLambertMaterial({ map: ctx.texture("foliage", [1.5, 1.5]) }),
      );
      ball.position.set(v.at[0], 0.9 * s, v.at[1]);
      ball.scale.y = 0.75;
      node.add(ball);
    } else if (v.type === "rock") {
      const s = v.s ?? 1;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.2 * s, 0),
        new THREE.MeshLambertMaterial({ map: ctx.texture("stone_wall") }),
      );
      rock.position.set(v.at[0], 0.8 * s, v.at[1]);
      rock.scale.y = 0.7;
      node.add(rock);
    } else if (v.type === "fountain") {
      const r = v.r ?? 4;
      const basin = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 1.1, 24),
        new THREE.MeshLambertMaterial({ map: ctx.texture("stone_wall", [3, 1]) }),
      );
      basin.position.set(v.at[0], 0.55, v.at[1]);
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.82, r * 0.82, 0.12, 24),
        new THREE.MeshLambertMaterial({ map: ctx.texture("water") }),
      );
      water.position.set(v.at[0], 1.12, v.at[1]);
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.7, 2.6, 12),
        new THREE.MeshLambertMaterial({ map: ctx.texture("stone_wall") }),
      );
      pillar.position.set(v.at[0], 1.3, v.at[1]);
      node.add(basin, water, pillar);
    } else if (v.type === "prop") {
      const h = v.h ?? 2;
      let w = 2, d = 2, cx0, cz0;
      if (v.rect) {
        [cx0, cz0] = [v.rect[0] + v.rect[2] / 2, v.rect[1] + v.rect[3] / 2];
        w = v.rect[2]; d = v.rect[3];
      } else {
        [cx0, cz0] = v.at;
      }
      const m = box(THREE, ctx, w, h, d, "wood_planks", v.color ? new THREE.Color(v.color) : 0xffffff);
      m.position.set(cx0, h / 2, cz0);
      node.add(m);
    }
    // Unidad de oclusión del volumen (muros y cutaway ya emitieron las suyas).
    if (v.type === "building" && !v.cutaway) {
      const [u0, v0, w, d] = v.rect;
      occluders.push({ id: v.id, footprint: [u0, v0, u0 + w, v0 + d], h: (v.wall_h ?? 5) + Math.min(w, d) * 0.45, node });
    } else if (v.type === "tower") {
      const r = v.r ?? 5;
      occluders.push({ id: v.id, footprint: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r], h: v.h ?? 10, node });
    } else if (v.type === "gate") {
      const w = v.w ?? 8;
      occluders.push({ id: v.id, footprint: [v.at[0] - 2, v.at[1] - w / 2, v.at[0] + 2, v.at[1] + w / 2], h: v.h ?? 7, node });
    } else if (v.type === "tree") {
      const s = v.s ?? 1;
      occluders.push({
        id: v.id,
        footprint: [v.at[0] - 0.9 * s, v.at[1] - 0.9 * s, v.at[0] + 0.9 * s, v.at[1] + 0.9 * s],
        h: 5 * s,
        node,
        proximityOnly: true, // la copa tapa siempre; solo se funde por cercanía
      });
    } else if (v.type === "prop" && (v.h ?? 2) > 4) {
      const fp = v.rect ? [v.rect[0], v.rect[1], v.rect[0] + v.rect[2], v.rect[1] + v.rect[3]] : [v.at[0] - 2, v.at[1] - 2, v.at[0] + 2, v.at[1] + 2];
      occluders.push({ id: v.id, footprint: fp, h: v.h ?? 5, node });
    }
    group.add(node);
  }

  return { group, manifest: null, occluders };
}
