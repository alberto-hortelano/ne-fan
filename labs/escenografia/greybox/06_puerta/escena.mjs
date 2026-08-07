// 06_puerta — greybox 3D de la Puerta del Poniente a media tarde: sol
// FRONTAL-LATERAL desde el suroeste (lado cámara — los personajes compuestos
// deben compartir la luz: nada de contraluces), muralla de sillería legible,
// rastrillo levantado visible en el vano y la calzada con roderas.
import { makeLib } from "../lib.mjs";

export async function build(THREE) {
  const L = makeLib(THREE);
  const g = new THREE.Group();

  // ---- suelo y calzada ----------------------------------------------
  g.add(L.ground(400, 0x8a7a66));
  const road = [
    [1.5, 10], [0.8, -4], [0.2, -14], [0, -24], [0, -34],
  ];
  g.add(L.ribbon(road, 5.4, 0x9a8878, "street", 0.1));
  // roderas de carro marcadas en la calzada
  g.add(L.ribbon([[-0.9, -32], [-0.6, -18], [0.0, -2], [0.4, 8]], 0.45, 0x83705f, "street", 0.16));
  g.add(L.ribbon([[1.0, -32], [1.4, -18], [2.0, -2], [2.4, 8]], 0.45, 0x83705f, "street", 0.16));

  // ---- muralla a contraluz ------------------------------------------
  const WALL_Z = -34;
  const wallC = 0x9c9082; // sillería al sol de la tarde
  const merlonC = 0xa89c8c;
  const wall = (x, w, h = 8.5) => {
    const m = L.box(w, h, 2.6, wallC, "building");
    m.position.set(x, 0, WALL_Z);
    g.add(m);
    // almenas
    for (let i = -w / 2 + 0.8; i < w / 2 - 0.4; i += 1.7) {
      const mer = L.box(0.9, 0.8, 2.6, merlonC, "building");
      mer.position.set(x + i, 0, WALL_Z);
      mer.translateY(h);
      g.add(mer);
    }
  };
  wall(-24.5, 41); // lienzo oeste, se pierde a la izquierda
  wall(24.5, 41); // lienzo este
  // cubos de la puerta (tambores redondos)
  for (const s of [-1, 1]) {
    const drum = L.cylinder(3.4, 12.5, 0x968a7c, "building");
    drum.position.set(s * 6.2, 0, WALL_Z);
    g.add(drum);
    const cap = L.cylinder(3.7, 1.1, 0xa89c8c, "building");
    cap.position.set(s * 6.2, 12.5, WALL_Z);
    g.add(cap);
    // almenas del cubo
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      const mer = L.box(0.8, 0.7, 0.6, 0xa89c8c, "building");
      mer.position.set(s * 6.2 + Math.cos(a) * 3.3, 13.6, WALL_Z + Math.sin(a) * 3.3);
      g.add(mer);
    }
  }
  L.manifest.push({ id: "puerta", cat: "building", x: 0, z: WALL_Z, w: 12, d: 3, h: 13 });
  // dintel sobre el vano + arco
  const lintel = L.box(6.8, 4.2, 2.6, wallC, "building");
  lintel.position.set(0, 0, WALL_Z);
  lintel.translateY(8.8);
  g.add(lintel);
  // Vano en penumbra con el camino continuando al otro lado
  const inner = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 8.8),
    new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 }),
  );
  inner.position.set(0, 4.4, WALL_Z + 0.2);
  L.tag(inner, "building");
  inner.userData.noShadow = true;
  g.add(inner);
  // Rastrillo LEVANTADO: la fila de púas asoma bajo el dintel
  for (let bx = -2.4; bx <= 2.4; bx += 0.8) {
    const spike = L.box(0.18, 1.3, 0.18, 0x3a332c, "prop");
    spike.position.set(bx, 7.4, WALL_Z + 0.3);
    g.add(spike);
  }
  // hoja del portón abierta hacia dentro (silueta contra el ascua)
  const gateLeaf = L.box(2.6, 7.6, 0.35, 0x5c4a36, "prop");
  gateLeaf.position.set(-2.6, 0, WALL_Z - 0.9);
  gateLeaf.rotation.y = -0.55;
  g.add(gateLeaf);
  // pendón lacio del cubo derecho
  const banner = L.box(0.9, 4.6, 0.08, 0x8a4048, "prop");
  banner.position.set(6.2, 0, WALL_Z + 1.6);
  banner.translateY(6.8);
  g.add(banner);

  // ---- por el vano: colinas ámbar y el camino que sigue -------------
  g.add(L.hill(90, 9, 0x8a8a6e, -10, -70));
  g.add(L.hill(70, 6, 0x96967a, 25, -75));

  // ---- primer término: crucero inclinado y rocas en silueta ---------
  const cross = new THREE.Group();
  const shaft = L.box(0.5, 3.4, 0.5, 0x8f867c, "prop");
  cross.add(shaft);
  const arm = L.box(1.7, 0.45, 0.45, 0x8f867c, "prop");
  arm.position.y = 2.6;
  cross.add(arm);
  const base = L.box(1.4, 0.55, 1.4, 0x968c80, "prop");
  cross.add(base);
  cross.position.set(5.2, 0, -6);
  cross.rotation.z = -0.09;
  g.add(cross);
  L.manifest.push({ id: "crucero", cat: "prop", x: 5.2, z: -6, w: 1.7, d: 1.4, h: 3.4 });
  // cardos al pie del crucero
  for (const [x, z] of [[4.6, -5.2], [5.9, -5.5], [5.4, -6.9]]) {
    const t = L.cylinder(0.3, 0.7, 0x555c42, "bush", 0.03);
    t.position.set(x, 0, z);
    g.add(t);
  }
  // rocas abajo-izquierda
  for (const [x, z, s] of [[-5.8, -7, 0.9], [-7.2, -5.5, 0.6], [-4.9, -8.6, 0.5]]) {
    const r = L.box(s * 1.6, s, s * 1.3, 0x8a8276, "rock");
    r.position.set(x, 0, z);
    r.rotation.y = x;
    g.add(r);
  }
  // grajos en las almenas (puntos negros)
  for (const [x, y] of [[-3.2, 9.6], [2.1, 9.6], [7.3, 14.5]]) {
    const bird = L.box(0.32, 0.3, 0.18, 0x1d1a18, "prop");
    bird.position.set(x, 0, WALL_Z);
    bird.translateY(y);
    g.add(bird);
  }

  // ---- luz y atmósfera ----------------------------------------------
  // sol de media tarde desde el SUROESTE (lado cámara): la muralla y el
  // primer término comparten la luz que llevarán los personajes compuestos —
  // nada de contraluces (los sprites llevan luz genérica)
  g.add(L.sun(0xffd9a8, 3.0, [-48, 34, 55], [0, 4, -30], 110));
  g.add(new THREE.HemisphereLight(0xa8b0c8, 0x6b6055, 1.25));
  g.add(L.sky(0x7590b0, 0xd8c8a8, -400));

  return {
    group: g,
    camera: { pos: [0.8, 1.7, 6], look: [0, 4.5, -34], fov: 38 },
    background: new THREE.Color(0xd8c8a8),
    fog: new THREE.Fog(0xbcc0b8, 40, 130),
    depthMax: 80,
    manifest: L.manifest,
  };
}
