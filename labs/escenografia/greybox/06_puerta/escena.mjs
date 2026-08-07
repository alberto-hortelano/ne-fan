// 06_puerta — greybox 3D de la Puerta del Poniente con el sol poniéndose
// justo tras el arco: muralla a contraluz (silueta morada), el vano como un
// ascua y el chorro de luz derramándose calzada abajo hacia cámara.
import { makeLib } from "../lib.mjs";

export async function build(THREE) {
  const L = makeLib(THREE);
  const g = new THREE.Group();

  // ---- suelo y calzada ----------------------------------------------
  g.add(L.ground(400, 0x7d6c60));
  const road = [
    [1.5, 10], [0.8, -4], [0.2, -14], [0, -24], [0, -34],
  ];
  g.add(L.ribbon(road, 5.4, 0x86756a, "street", 0.1));
  // chorro de luz por el arco: lámina cálida calzada abajo + roderas encendidas
  g.add(L.ribbon([[0, -33], [0.4, -20], [1.0, -6], [1.6, 8]], 2.6, 0xd89a58, "street", 0.16));
  g.add(L.ribbon([[-0.9, -32], [-0.6, -18], [0.0, -2]], 0.4, 0xe8b070, "street", 0.2));
  g.add(L.ribbon([[1.0, -32], [1.4, -18], [2.0, -2]], 0.4, 0xe8b070, "street", 0.2));

  // ---- muralla a contraluz ------------------------------------------
  const WALL_Z = -34;
  const wallC = 0x5f5062; // silueta morada, abierta
  const merlonC = 0x6a5a6e;
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
    const drum = L.cylinder(3.4, 12.5, 0x655468, "building");
    drum.position.set(s * 6.2, 0, WALL_Z);
    g.add(drum);
    const cap = L.cylinder(3.7, 1.1, 0x5a4a5e, "building");
    cap.position.set(s * 6.2, 12.5, WALL_Z);
    g.add(cap);
    // almenas del cubo
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      const mer = L.box(0.8, 0.7, 0.6, 0x5a4a5e, "building");
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
  // EL ASCUA: plano emisivo llenando el vano (el sol justo detrás)
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 8.8),
    new THREE.MeshBasicMaterial({ color: 0xffcf86 }),
  );
  glow.position.set(0, 4.4, WALL_Z + 0.2);
  L.tag(glow, "building");
  glow.userData.noShadow = true;
  g.add(glow);
  // hoja del portón abierta hacia dentro (silueta contra el ascua)
  const gateLeaf = L.box(2.6, 7.6, 0.35, 0x2e2620, "prop");
  gateLeaf.position.set(-2.6, 0, WALL_Z - 0.9);
  gateLeaf.rotation.y = -0.55;
  g.add(gateLeaf);
  // pendón lacio del cubo derecho
  const banner = L.box(0.9, 4.6, 0.08, 0x5e3038, "prop");
  banner.position.set(6.2, 0, WALL_Z + 1.6);
  banner.translateY(6.8);
  g.add(banner);

  // ---- por el vano: colinas ámbar y el camino que sigue -------------
  g.add(L.hill(90, 9, 0x8a6a54, -10, -70));
  g.add(L.hill(70, 6, 0x96745a, 25, -75));

  // ---- primer término: crucero inclinado y rocas en silueta ---------
  const cross = new THREE.Group();
  const shaft = L.box(0.5, 3.4, 0.5, 0x5c5156, "prop");
  cross.add(shaft);
  const arm = L.box(1.7, 0.45, 0.45, 0x5c5156, "prop");
  arm.position.y = 2.6;
  cross.add(arm);
  const base = L.box(1.4, 0.55, 1.4, 0x635459, "prop");
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
    const r = L.box(s * 1.6, s, s * 1.3, 0x615459, "rock");
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
  // contraluz total: el sol DETRÁS de la puerta, de cara a cámara
  g.add(L.sun(0xffb870, 3.2, [2, 10, -70], [0.5, 0, 6], 110));
  // rim/relleno frío tenue para que el primer término no muera en negro
  g.add(new THREE.HemisphereLight(0x8a7a96, 0x4a4038, 1.7));
  // rebote frontal suave: el personaje y el primer término se leen sin
  // matar el contraluz (sin sombras — es luz de relleno)
  const bounce = new THREE.DirectionalLight(0xd8a878, 1.1);
  bounce.position.set(6, 12, 40);
  bounce.target.position.set(0, 2, -20);
  g.add(bounce, bounce.target);
  g.add(L.sky(0x5a4468, 0xf0a860, -400));

  return {
    group: g,
    camera: { pos: [0.8, 1.7, 6], look: [0, 4.5, -34], fov: 38 },
    background: new THREE.Color(0xe8a05c),
    fog: new THREE.Fog(0xb98a68, 34, 120),
    depthMax: 80,
    manifest: L.manifest,
  };
}
