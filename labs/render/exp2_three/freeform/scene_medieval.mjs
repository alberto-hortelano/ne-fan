// scene_medieval.mjs — E2b: escena escrita LIBREMENTE por el motor narrativo
// (Claude) SOLO a partir de la descripción del lugar:
//   "La plazuela de las Cuatro Calles, entre la catedral y Zocodover: un pozo
//    de brocal gastado, el puesto del cambista, la taberna de la Serrana y el
//    horno del barrio. Al este, un tramo de adarve con su torre y su arco abre
//    la calle real hacia Zocodover; al suroeste, una tapia guarda el huerto de
//    los canónigos."
// Tile de 128×128 celdas (1 celda = 2 m; un personaje ≈ 3.6 celdas).
// El manifest es el REGISTRO del motor: huellas [minU,minV,maxU,maxV] en
// celdas + altura, del que el juego deriva colisión y occluders con baseline.

export const manifest = {
  tile: "medieval_freeform",
  objects: [
    { id: "pozo_brocal", type: "fountain", label: "pozo de brocal gastado", footprint: [58, 56, 64, 62], h: 2, solid: true, tall: false },
    { id: "puesto_cambista", type: "prop", label: "puesto del cambista", footprint: [48, 63, 54, 67], h: 3, solid: true, tall: false },
    { id: "taberna_serrana", type: "building", label: "taberna de la Serrana", footprint: [36, 40, 54, 52], h: 5, solid: true, tall: true, cutaway: true, door: { edge: "s", at: 44 } },
    { id: "horno_barrio", type: "building", label: "horno del barrio", footprint: [66, 68, 78, 78], h: 5, solid: true, tall: true, door: { edge: "n", at: 71 } },
    { id: "adarve_n", type: "wall", label: "adarve (tramo norte)", footprint: [98, 0, 102, 56], h: 9, solid: true, tall: true },
    { id: "adarve_s", type: "wall", label: "adarve (tramo sur)", footprint: [98, 72, 102, 128], h: 9, solid: true, tall: true },
    { id: "torre_adarve", type: "tower", label: "torre del adarve", footprint: [95, 30, 105, 40], h: 13, solid: true, tall: true },
    { id: "arco_real", type: "gate", label: "arco de la calle real", footprint: [98, 56, 102, 72], h: 8, solid: false, tall: true },
    { id: "tapia_huerto", type: "wall", label: "tapia del huerto", footprint: [8, 84, 40, 118], h: 3.5, solid: true, tall: false, hollow: true },
    { id: "huerto_frutal_1", type: "tree", label: "frutal del huerto", footprint: [13, 92, 19, 98], h: 7, solid: true, tall: true },
    { id: "huerto_frutal_2", type: "tree", label: "frutal del huerto", footprint: [24, 90, 30, 96], h: 7, solid: true, tall: true },
    { id: "huerto_frutal_3", type: "tree", label: "frutal del huerto", footprint: [15, 103, 21, 109], h: 7, solid: true, tall: true },
    { id: "huerto_frutal_4", type: "tree", label: "frutal del huerto", footprint: [27, 101, 33, 107], h: 7, solid: true, tall: true },
  ],
  roads: [
    { id: "calle_real", from: [64, 64], to: [128, 64], w: 6 },
    { id: "calle_n", from: [60, 0], to: [60, 56], w: 5 },
    { id: "calle_s", from: [62, 68], to: [66, 128], w: 5 },
    { id: "calle_o", from: [0, 62], to: [56, 62], w: 5 },
  ],
  plaza: { center: [60, 60], rx: 16, ry: 12 },
};

function fpBox(THREE, ctx, fp, h, tex, tint = 0xffffff, y0 = 0) {
  const [u0, v0, u1, v1] = fp;
  const geom = new THREE.BoxGeometry(u1 - u0, h, v1 - v0);
  const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ map: ctx.texture(tex), color: tint }));
  mesh.position.set((u0 + u1) / 2, y0 + h / 2, (v0 + v1) / 2);
  return mesh;
}

export async function build(THREE, ctx) {
  const group = new THREE.Group();

  // Suelo: tierra apisonada, con la plazuela empedrada y las cuatro calles.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(128, 128),
    new THREE.MeshLambertMaterial({ map: ctx.texture("dirt", [8, 8]) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(64, 0, 64);
  group.add(ground);

  const cobble = new THREE.MeshLambertMaterial({ map: ctx.texture("cobblestone", [4, 3]) });
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(1, 40), cobble);
  plaza.rotation.x = -Math.PI / 2;
  plaza.scale.set(manifest.plaza.rx, manifest.plaza.ry, 1);
  plaza.position.set(manifest.plaza.center[0], 0.05, manifest.plaza.center[1]);
  group.add(plaza);

  for (const r of manifest.roads) {
    const len = Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(len, r.w),
      new THREE.MeshLambertMaterial({ map: ctx.texture("cobblestone", [len / 8, 1]) }),
    );
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = -Math.atan2(r.to[1] - r.from[1], r.to[0] - r.from[0]);
    road.position.set((r.from[0] + r.to[0]) / 2, 0.04, (r.from[1] + r.to[1]) / 2);
    group.add(road);
  }

  for (const o of manifest.objects) {
    const node = new THREE.Group();
    node.name = o.id;
    const [u0, v0, u1, v1] = o.footprint;
    const cx = (u0 + u1) / 2, cz = (v0 + v1) / 2;
    const w = u1 - u0, d = v1 - v0;

    if (o.type === "fountain") {
      const brocal = new THREE.Mesh(
        new THREE.CylinderGeometry(w / 2, w / 2 + 0.3, 1.4, 20),
        new THREE.MeshLambertMaterial({ map: ctx.texture("stone_wall", [3, 1]) }),
      );
      brocal.position.set(cx, 0.7, cz);
      const agua = new THREE.Mesh(
        new THREE.CylinderGeometry(w / 2 - 0.6, w / 2 - 0.6, 0.1, 20),
        new THREE.MeshLambertMaterial({ map: ctx.texture("water") }),
      );
      agua.position.set(cx, 1.3, cz);
      node.add(brocal, agua);
    } else if (o.type === "prop") {
      const mostrador = fpBox(THREE, ctx, o.footprint, 1.4, "wood_planks");
      const toldo = new THREE.Mesh(
        new THREE.BoxGeometry(w + 1, 0.2, d + 1),
        new THREE.MeshLambertMaterial({ color: 0x8a4a3a }),
      );
      toldo.position.set(cx, o.h, cz);
      for (const [px, pz] of [[u0 + 0.4, v0 + 0.4], [u1 - 0.4, v0 + 0.4], [u0 + 0.4, v1 - 0.4], [u1 - 0.4, v1 - 0.4]]) {
        const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, o.h, 6), new THREE.MeshLambertMaterial({ color: 0x5a4630 }));
        poste.position.set(px, o.h / 2, pz);
        node.add(poste);
      }
      node.add(mostrador, toldo);
    } else if (o.type === "building" && o.cutaway) {
      // Taberna abierta (cutaway): muros N y O altos, S y E bajos, suelo de tablones y mesas.
      const t = 1.2;
      const tint = 0xcfc0a2;
      node.add(fpBox(THREE, ctx, [u0, v0, u1, v0 + t], o.h, "plaster", tint));
      node.add(fpBox(THREE, ctx, [u0, v0, u0 + t, v1], o.h, "plaster", tint));
      node.add(fpBox(THREE, ctx, [u0, v1 - t, u1, v1], 1.5, "plaster", tint));
      node.add(fpBox(THREE, ctx, [u1 - t, v0, u1, v1], 1.5, "plaster", tint));
      const suelo = fpBox(THREE, ctx, o.footprint, 0.12, "wood_planks");
      node.add(suelo);
      for (const [mx, mz] of [[cx - 4, cz - 1], [cx + 2, cz + 2], [cx + 5, cz - 2]]) {
        const mesa = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 2.4), new THREE.MeshLambertMaterial({ map: ctx.texture("wood_planks") }));
        mesa.position.set(mx, 0.6, mz);
        node.add(mesa);
      }
    } else if (o.type === "building") {
      node.add(fpBox(THREE, ctx, o.footprint, o.h, "plaster", 0xc9b89a));
      const rise = Math.min(w, d) * 0.4;
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2 - 0.6, 0); shape.lineTo(0, rise); shape.lineTo(d / 2 + 0.6, 0); shape.closePath();
      const roofG = new THREE.ExtrudeGeometry(shape, { depth: w + 1.2, bevelEnabled: false });
      const uvA = roofG.attributes.uv;
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) / 8, uvA.getY(i) / 8);
      uvA.needsUpdate = true;
      roofG.translate(0, 0, -(w + 1.2) / 2);
      roofG.rotateY(Math.PI / 2);
      const roof = new THREE.Mesh(roofG, new THREE.MeshLambertMaterial({ map: ctx.texture("roof_tiles"), color: 0xa05a38 }));
      roof.position.set(cx, o.h, cz);
      node.add(roof);
      if (o.door) {
        const dm = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.3), new THREE.MeshLambertMaterial({ color: 0x2a2018 }));
        dm.position.set(o.door.at + 1.5, 1.5, o.door.edge === "s" ? v1 : v0);
        node.add(dm);
      }
    } else if (o.type === "wall" && o.hollow) {
      // Tapia perimetral del huerto: cuatro tramos finos.
      const t = 1.2;
      node.add(fpBox(THREE, ctx, [u0, v0, u1, v0 + t], o.h, "stone_wall", 0xc0b49a));
      node.add(fpBox(THREE, ctx, [u0, v1 - t, u1, v1], o.h, "stone_wall", 0xc0b49a));
      node.add(fpBox(THREE, ctx, [u0, v0, u0 + t, v1], o.h, "stone_wall", 0xc0b49a));
      node.add(fpBox(THREE, ctx, [u1 - t, v0, u1, v1], o.h, "stone_wall", 0xc0b49a));
    } else if (o.type === "wall") {
      node.add(fpBox(THREE, ctx, o.footprint, o.h, "stone_wall"));
      for (let z = v0 + 1; z < v1 - 1; z += 2.4) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 1, 1), new THREE.MeshLambertMaterial({ map: ctx.texture("stone_wall") }));
        m.position.set(cx, o.h + 0.5, z);
        node.add(m);
      }
    } else if (o.type === "tower") {
      const r = w / 2;
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 1.06, o.h, 20),
        new THREE.MeshLambertMaterial({ map: ctx.texture("stone_wall", [4, 2]) }),
      );
      cyl.position.set(cx, o.h / 2, cz);
      node.add(cyl);
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: ctx.texture("stone_wall") }));
        m.position.set(cx + Math.cos(a) * (r - 0.5), o.h + 0.5, cz + Math.sin(a) * (r - 0.5));
        node.add(m);
      }
    } else if (o.type === "gate") {
      // Arco en el adarve: jambas al norte y sur del vano, dintel encima.
      const jamb = 2;
      node.add(fpBox(THREE, ctx, [u0, v0, u1, v0 + jamb], o.h, "stone_wall"));
      node.add(fpBox(THREE, ctx, [u0, v1 - jamb, u1, v1], o.h, "stone_wall"));
      node.add(fpBox(THREE, ctx, [u0, v0, u1, v1], 1.6, "stone_wall", 0xffffff, o.h - 1.6));
    } else if (o.type === "tree") {
      const s = w / 6;
      const trunkH = 3.2 * s * 1.6;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5 * s, 0.7 * s, trunkH, 8),
        new THREE.MeshLambertMaterial({ map: ctx.texture("bark") }),
      );
      trunk.position.set(cx, trunkH / 2, cz);
      node.add(trunk);
      const fol = new THREE.MeshLambertMaterial({ map: ctx.texture("foliage", [2, 2]) });
      for (const [dx, dz, r] of [[0, 0, 2.6], [1.5, 0.7, 1.8], [-1.4, -0.6, 1.9]]) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(r * s * 1.2, 12, 10), fol);
        ball.position.set(cx + dx * s, trunkH + 1.4 * s, cz + dz * s);
        node.add(ball);
      }
    }
    group.add(node);
  }

  return { group, manifest };
}
