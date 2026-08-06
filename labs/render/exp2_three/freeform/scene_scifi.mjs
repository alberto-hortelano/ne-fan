// scene_scifi.mjs — E2b: escena escrita LIBREMENTE por el motor narrativo
// (Claude) SOLO a partir de la descripción del lugar:
//   "La Plaza de la colonia Umbral bajo un cielo ocre: losas de hormigón, el
//    mástil de comunicaciones y los puestos del mercado de intercambio. La
//    avenida norte baja desde los bloques de vivienda y la cantina El Filtro
//    abre su puerta al oeste."
// Tile 128×128 celdas. El manifest registra huella + altura de cada objeto.

export const manifest = {
  tile: "scifi_freeform",
  objects: [
    { id: "mastil_com", type: "tower", label: "mástil de comunicaciones", footprint: [61, 57, 67, 63], h: 18, solid: true, tall: true },
    { id: "puesto_mercado_1", type: "prop", label: "puesto del mercado", footprint: [50, 66, 56, 71], h: 3, solid: true, tall: false },
    { id: "puesto_mercado_2", type: "prop", label: "puesto del mercado", footprint: [70, 68, 76, 73], h: 3, solid: true, tall: false },
    { id: "puesto_mercado_3", type: "prop", label: "puesto del mercado", footprint: [60, 74, 66, 79], h: 3, solid: true, tall: false },
    { id: "bloque_vivienda_o", type: "building", label: "bloque de viviendas oeste", footprint: [30, 4, 58, 24], h: 9, solid: true, tall: true },
    { id: "bloque_vivienda_e", type: "building", label: "bloque de viviendas este", footprint: [70, 4, 98, 24], h: 9, solid: true, tall: true },
    { id: "cantina_filtro", type: "building", label: "cantina El Filtro", footprint: [18, 50, 40, 72], h: 5, solid: true, tall: true, cutaway: true, door: { edge: "e", at: 58 } },
  ],
  roads: [
    { id: "avenida_norte", from: [64, 0], to: [64, 52], w: 8 },
    { id: "acceso_oeste", from: [40, 61], to: [56, 61], w: 5 },
  ],
  plaza: { center: [64, 66], rx: 22, ry: 16 },
};

function fpBox(THREE, ctx, fp, h, tex, tint = 0xffffff, y0 = 0) {
  const [u0, v0, u1, v1] = fp;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(u1 - u0, h, v1 - v0),
    new THREE.MeshLambertMaterial({ map: ctx.texture(tex), color: tint }),
  );
  mesh.position.set((u0 + u1) / 2, y0 + h / 2, (v0 + v1) / 2);
  return mesh;
}

export async function build(THREE, ctx) {
  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(128, 128),
    new THREE.MeshLambertMaterial({ map: ctx.texture("concrete", [7, 7]) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(64, 0, 64);
  group.add(ground);

  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshLambertMaterial({ map: ctx.texture("concrete", [4, 3]), color: 0xb9b4a6 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.scale.set(manifest.plaza.rx, manifest.plaza.ry, 1);
  plaza.position.set(manifest.plaza.center[0], 0.05, manifest.plaza.center[1]);
  group.add(plaza);

  for (const r of manifest.roads) {
    const len = Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(len, r.w),
      new THREE.MeshLambertMaterial({ map: ctx.texture("metal_plate", [len / 10, 1]), color: 0x8f8b80 }),
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

    if (o.type === "tower") {
      // Mástil: base + fuste esbelto + antenas.
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(w / 2, w / 2 + 0.5, 1.4, 16),
        new THREE.MeshLambertMaterial({ map: ctx.texture("concrete") }),
      );
      base.position.set(cx, 0.7, cz);
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 1.1, o.h, 10),
        new THREE.MeshLambertMaterial({ map: ctx.texture("metal_plate", [1, 4]) }),
      );
      mast.position.set(cx, o.h / 2, cz);
      const dish = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xd8d5c9 }),
      );
      dish.rotation.z = Math.PI / 3;
      dish.position.set(cx + 1, o.h * 0.8, cz);
      node.add(base, mast, dish);
    } else if (o.type === "prop") {
      const mostrador = fpBox(THREE, ctx, o.footprint, 1.3, "metal_plate", 0x9a9588);
      const toldo = new THREE.Mesh(
        new THREE.BoxGeometry(w + 1, 0.18, d + 1),
        new THREE.MeshLambertMaterial({ map: ctx.texture("neon_trim"), color: 0x8898a8 }),
      );
      toldo.position.set(cx, o.h, cz);
      for (const [px, pz] of [[u0 + 0.4, v0 + 0.4], [u1 - 0.4, v0 + 0.4], [u0 + 0.4, v1 - 0.4], [u1 - 0.4, v1 - 0.4]]) {
        const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, o.h, 6), new THREE.MeshLambertMaterial({ color: 0x55585e }));
        poste.position.set(px, o.h / 2, pz);
        node.add(poste);
      }
      node.add(mostrador, toldo);
    } else if (o.type === "building" && o.cutaway) {
      // Cantina El Filtro: abierta, puerta al ESTE; muros N y O altos.
      const t = 1.4;
      const tint = 0x8c8f94;
      node.add(fpBox(THREE, ctx, [u0, v0, u1, v0 + t], o.h, "concrete", tint));
      node.add(fpBox(THREE, ctx, [u0, v0, u0 + t, v1], o.h, "concrete", tint));
      node.add(fpBox(THREE, ctx, [u0, v1 - t, u1, v1], 1.6, "concrete", tint));
      // Muro este bajo con hueco de puerta en o.door.at.
      const daZ = o.door.at;
      node.add(fpBox(THREE, ctx, [u1 - t, v0, u1, daZ - 2], 1.6, "concrete", tint));
      node.add(fpBox(THREE, ctx, [u1 - t, daZ + 2, u1, v1], 1.6, "concrete", tint));
      node.add(fpBox(THREE, ctx, o.footprint, 0.12, "wood_planks"));
      const barra = fpBox(THREE, ctx, [u0 + 2, v0 + 3, u0 + 12, v0 + 5], 1.5, "metal_plate");
      node.add(barra);
      for (const [mx, mz] of [[cx - 3, cz + 2], [cx + 3, cz + 5], [cx + 1, cz - 3]]) {
        const mesa = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 1, 10), new THREE.MeshLambertMaterial({ map: ctx.texture("metal_plate") }));
        mesa.position.set(mx, 0.6, mz);
        node.add(mesa);
      }
    } else if (o.type === "building") {
      node.add(fpBox(THREE, ctx, o.footprint, o.h, "concrete", 0x9a9da2));
      const azotea = fpBox(THREE, ctx, [u0 - 0.5, v0 - 0.5, u1 + 0.5, v1 + 0.5], 0.5, "metal_plate", 0xffffff, o.h);
      node.add(azotea);
      // Franjas de ventanas iluminadas en la fachada sur.
      for (let fy = 2; fy < o.h - 1; fy += 2.4) {
        for (let fx = u0 + 2; fx < u1 - 2; fx += 3.2) {
          const win = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 1, 0.15),
            new THREE.MeshLambertMaterial({ color: 0xe8c26a, emissive: 0x886422 }),
          );
          win.position.set(fx, fy, v1 + 0.05);
          node.add(win);
        }
      }
    }
    group.add(node);
  }

  return { group, manifest };
}
