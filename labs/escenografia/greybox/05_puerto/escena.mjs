// 05_puerto — greybox 3D del muelle fluvial al amanecer con niebla.
// El canto del muelle corta la escena en gran diagonal (agua al este); la
// grúa de rueda queda en SILUETA contra el agua peltre (punto focal). Sol
// recién salido del este, muy bajo y velado; el candil del fielato es el
// único punto cálido. Niebla densa que disuelve la orilla opuesta.
import { makeLib } from "../lib.mjs";

export async function build(THREE) {
  const L = makeLib(THREE);
  const g = new THREE.Group();

  // ---- agua y muelle -------------------------------------------------
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: 0x707a88, roughness: 0.3 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.05;
  water.userData.cat = "water";
  water.userData.noShadow = true;
  g.add(water);

  // plataforma del muelle: polígono con el canto en diagonal NE
  const dockPts = [
    [-90, 40], [-6, 20], [30, -52], [38, -160], [-90, -160],
  ];
  const shape = new THREE.Shape();
  dockPts.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const dockGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false });
  dockGeo.rotateX(-Math.PI / 2); // (x, -z) → XZ, extrusión hacia +y
  dockGeo.translate(0, -1.4 + 0, 0);
  const dock = new THREE.Mesh(dockGeo, L.mat(0x8d8578, 0.95));
  dock.userData.cat = "terrain";
  g.add(dock);
  L.manifest.push({ id: "muelle", cat: "terrain", note: "canto diagonal de (-6,20) a (30,-52)" });

  // bordillo del cantil (remate que marca el borde)
  const kerb = L.box(0.35, 0.25, 79, 0x5a5248, "terrain");
  kerb.position.set(11.7, 0, -16.15);
  kerb.rotation.y = Math.atan2(36, 72);
  g.add(kerb);

  // rastro del sol naciente sobre el agua
  const glint = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 70),
    new THREE.MeshBasicMaterial({
      color: 0xe8d4a8, transparent: true, opacity: 0.4, depthWrite: false,
    }),
  );
  glint.rotation.x = -Math.PI / 2;
  glint.rotation.z = -0.5;
  glint.position.set(38, -1.0, -55);
  glint.userData.cat = "water";
  glint.userData.noShadow = true;
  g.add(glint);

  // norays a lo largo del canto
  for (const t of [0.25, 0.42, 0.6, 0.78]) {
    const x = -6 + 36 * t;
    const z = 20 - 72 * t;
    const bollard = L.cylinder(0.2, 0.55, 0x6b6154, "prop");
    bollard.position.set(x - 1.3, 0, z - 0.65);
    g.add(bollard);
  }

  // ---- grúa de rueda (punto focal, en silueta) -----------------------
  const crane = new THREE.Group();
  const base = L.box(3.2, 0.5, 2.6, 0x6b6053, "prop");
  crane.add(base);
  // rueda de pisar
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 0.9, 24),
    L.mat(0x5d5346, 0.9),
  );
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(-0.6, 2.6, 0);
  wheel.userData.cat = "prop";
  crane.add(wheel);
  // soportes en A
  for (const s of [-1, 1]) {
    const leg = L.box(0.3, 3.4, 0.3, 0x685e50, "prop");
    leg.position.set(-0.6, 0, s * 1.05);
    leg.rotation.x = s * 0.16;
    crane.add(leg);
  }
  // pescante inclinado hacia +x (el agua): tip en (5.5, 5.2) local
  const jib = L.box(0.28, 6.5, 0.28, 0x685e50, "prop");
  jib.position.set(0.4, 1.2, 0);
  jib.rotation.z = -0.9;
  crane.add(jib);
  const rope = L.cylinder(0.04, 2.6, 0x4a4238, "prop");
  rope.position.set(5.5, 2.6, 0);
  crane.add(rope);
  const bale = L.box(1.0, 0.9, 0.9, 0x5f5648, "prop");
  bale.position.set(5.5, 1.7, 0);
  crane.add(bale);
  crane.position.set(11, 0, -30);
  crane.rotation.y = -1.23; // rueda de cara a cámara, pescante siguiendo el canto
  g.add(crane);
  L.manifest.push({ id: "grua", cat: "prop", x: 11, z: -30, w: 4, d: 3, h: 5.8 });

  // ---- gabarra amarrada tras el cantil -------------------------------
  const barge = new THREE.Group();
  const hull = L.box(3.4, 1.1, 9, 0x4f4840, "prop");
  hull.position.y = -1.0;
  barge.add(hull);
  const mast = L.cylinder(0.12, 4.2, 0x453d34, "prop");
  mast.position.set(0, -0.9, 1.5);
  mast.rotation.z = 0.07;
  barge.add(mast);
  barge.position.set(26, 0, -38);
  barge.rotation.y = -1.1;
  g.add(barge);
  L.manifest.push({ id: "gabarra", cat: "prop", x: 26, z: -38, w: 3.4, d: 9, h: 1.6 });

  // bote de remos pequeño, más cerca
  const boat = new THREE.Group();
  const bh = L.box(1.3, 0.55, 3.4, 0x554c42, "prop");
  bh.position.y = -0.95;
  boat.add(bh);
  boat.position.set(16, 0, -16);
  boat.rotation.y = -0.9;
  g.add(boat);

  // ---- fielato con candil (único punto cálido) -----------------------
  g.add(L.house({ id: "fielato", x: -7.5, z: -19, w: 4.2, d: 5.5, h: 3.4, roofH: 1.4, ridge: "z", wall: 0x8d8274, roof: 0x6d6457 }));
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 2.2, roughness: 0.6,
  });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), lampMat);
  lamp.position.set(-5.2, 2.6, -16.4);
  lamp.userData.cat = "decor";
  g.add(lamp);
  const lampLight = new THREE.PointLight(0xffb060, 14, 16, 1.8);
  lampLight.position.set(-5.1, 2.6, -16.2);
  g.add(lampLight);

  // ---- redes secándose (bastidores) ----------------------------------
  function netRack(x, z, rot) {
    const r = new THREE.Group();
    for (const s of [-1.4, 1.4]) {
      const post = L.box(0.14, 2.1, 0.14, 0x5d5548, "prop");
      post.position.set(s, 0, 0);
      r.add(post);
    }
    const bar = L.box(3.1, 0.1, 0.1, 0x5d5548, "prop");
    bar.translateY(2.0);
    r.add(bar);
    const net = L.box(2.7, 1.6, 0.05, 0x6a635a, "decor");
    net.translateY(0.35);
    r.add(net);
    r.position.set(x, 0, z);
    r.rotation.y = rot;
    return r;
  }
  g.add(netRack(-3.5, -30, 0.5));
  g.add(netRack(-6.5, -35, 0.75));

  // ---- primer término: barricas, cajas, rollo de cuerda --------------
  g.add(L.barrel(-2.6, -4.2));
  g.add(L.barrel(-1.7, -3.4));
  g.add(L.barrel(-2.1, -4.2 + 0.0));
  g.add(L.crate(2.4, -6.5, 1.0, 0.5));
  g.add(L.crate(3.3, -6.1, 0.7, 0.1));
  const coil = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.16, 10, 24),
    L.mat(0x6e6456, 0.95),
  );
  coil.rotation.x = -Math.PI / 2;
  coil.position.set(0.6, 0.16, -8.5);
  coil.userData.cat = "prop";
  g.add(coil);

  // ---- orilla opuesta en la niebla -----------------------------------
  g.add(L.hill(160, 7, 0x8a8d90, 55, -95));
  g.add(L.hill(120, 5, 0x90928f, 10, -105));
  for (const [x, z] of [[38, -80], [48, -85]]) {
    g.add(L.house({ x, z, w: 5, d: 5, h: 3, roofH: 1.2, ridge: "x", wall: 0x8c8e8e, roof: 0x7e807f }));
  }

  // ---- luz y atmósfera ----------------------------------------------
  g.add(L.sun(0xffc890, 2.4, [90, 9, -35], [0, 0, -20], 100));
  g.add(new THREE.HemisphereLight(0x9aa8bc, 0x5c5a55, 1.35));
  g.add(L.sky(0x8c96a6, 0xd8c8a4));

  return {
    group: g,
    camera: { pos: [-1, 1.8, 4], look: [4.5, 1.3, -42], fov: 33 },
    background: new THREE.Color(0xd8c8a4),
    fog: new THREE.Fog(0xb6bac0, 22, 105),
    depthMax: 80,
    manifest: L.manifest,
  };
}
