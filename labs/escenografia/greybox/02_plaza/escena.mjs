// 02_plaza — greybox 3D de la plaza del mercado a media mañana.
// Sol del sureste (x+, detrás-derecha): la iglesia del lado este arroja su
// sombra diagonal hacia el noroeste; la fuente queda AL SOL contra esa
// sombra (punto focal, tercio izquierdo). Hueco entre los tejados del norte
// con la vega pálida de fondo.
import { makeLib } from "../lib.mjs";

export async function build(THREE) {
  const L = makeLib(THREE);
  const g = new THREE.Group();

  // ---- suelo ---------------------------------------------------------
  g.add(L.ground(400, 0xa39a8a));
  // losa de la plaza, un punto más clara
  const plaza = L.ribbon([[0, 8], [0, -20], [0, -44]], 44, 0xaea593, "street", 0.015);
  g.add(plaza);

  // ---- iglesia (lado este, cierra la derecha) ------------------------
  const church = new THREE.Group();
  const nave = L.box(13, 11, 26, 0xb0a28c, "building");
  nave.position.set(0, 0, 0);
  church.add(nave);
  const naveRoof = L.gable(13, 26, 3.5, 0x7e7466);
  naveRoof.position.y = 11;
  church.add(naveRoof);
  // torre al extremo sur
  const tower = L.box(7, 20, 7, 0xb3a58f, "building");
  tower.position.set(-1, 0, 15);
  church.add(tower);
  const towerRoof = L.pyramid(7.4, 4.5, 0x6e6456);
  towerRoof.position.set(-1, 20, 15);
  church.add(towerRoof);
  // contrafuertes en la cara oeste (hacia la plaza)
  for (const bz of [-10, -4, 2, 8]) {
    const b = L.box(1.4, 6.5, 1.7, 0xb5a68e, "building");
    b.position.set(-7.2, 0, bz);
    church.add(b);
  }
  // portada
  const portal = L.box(0.4, 4.2, 3, 0x4a4136, "building");
  portal.position.set(-6.7, 0, 11);
  church.add(portal);
  // rosetón oscuro en la cara sur de la torre
  const rose = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 0.16, 24),
    L.mat(0x4a4136, 0.9),
  );
  rose.rotation.x = Math.PI / 2;
  rose.position.set(-1, 14.5, 18.55);
  rose.userData.cat = "building";
  church.add(rose);
  church.position.set(21, 0, -22);
  g.add(church);
  L.manifest.push({ id: "iglesia", cat: "building", x: 21, z: -22, w: 13, d: 26, h: 14.5 });
  L.manifest.push({ id: "torre_iglesia", cat: "building", x: 20, z: -7, w: 7, d: 7, h: 24.5 });

  // ---- caserío oeste (izquierda) -------------------------------------
  g.add(L.house({ id: "casa_w1", x: -19, z: -8, w: 9, d: 12, h: 6.8, roofH: 2.4, ridge: "z", wall: 0xc0b29c, roof: 0x8a7e6e }));
  g.add(L.house({ id: "casa_w2", x: -20, z: -21, w: 10, d: 11, h: 5.6, roofH: 2.0, ridge: "x", wall: 0xb8aa96, roof: 0x827868 }));
  g.add(L.house({ id: "casa_w3", x: -19, z: -33, w: 9, d: 11, h: 7.2, roofH: 2.6, ridge: "z", rot: 0.1, wall: 0xc4b6a0, roof: 0x8d8170 }));

  // ---- caserío norte con HUECO a la vega -----------------------------
  g.add(L.house({ id: "casa_n1", x: -9, z: -42, w: 12, d: 9, h: 6.4, roofH: 2.3, ridge: "x", wall: 0xa89a86, roof: 0x847a6a }));
  g.add(L.house({ id: "casa_n2", x: 10, z: -43, w: 11, d: 9, h: 5.2, roofH: 1.9, ridge: "x", rot: -0.08, wall: 0xaca08c, roof: 0x7c7264 }));
  // vega pálida tras el hueco: campos y colinas en calima
  g.add(L.hill(200, 14, 0xa8a494, -10, -120));
  g.add(L.hill(260, 22, 0x9d9a8e, 60, -150));
  for (const [x, z, w, h] of [[-2, -75, 6, 3.5], [4, -85, 7, 4]]) {
    g.add(L.house({ x, z, w, d: 6, h, roofH: h * 0.35, ridge: "x", wall: 0xa9a296, roof: 0x938b7e }));
  }

  // ---- fuente (punto focal, tercio izquierdo) ------------------------
  const fountain = new THREE.Group();
  const basin = L.cylinder(2.0, 0.6, 0x9c9180, "prop");
  fountain.add(basin);
  const stem = L.cylinder(0.24, 1.8, 0x968b78, "prop");
  stem.position.y = 0.6;
  fountain.add(stem);
  const bowl = L.cylinder(0.5, 0.18, 0x9c9180, "prop", 0.4);
  bowl.position.y = 2.15;
  fountain.add(bowl);
  const water = L.cylinder(1.85, 0.06, 0x6a7888, "water");
  water.position.y = 0.57;
  water.userData.noShadow = true;
  fountain.add(water);
  fountain.position.set(-6.5, 0, -17);
  g.add(fountain);
  L.manifest.push({ id: "fuente", cat: "prop", x: -6.5, z: -17, w: 4.6, d: 4.6, h: 2.8 });

  // ---- puestos del mercado (término medio, lado este) ----------------
  function stall(x, z, rot, aw = 0xb8a06a) {
    const s = new THREE.Group();
    for (const [px, pz] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]]) {
      const post = L.box(0.18, 2.4, 0.18, 0x7c6f5a, "prop");
      post.position.set(px, 0, pz);
      s.add(post);
    }
    const counter = L.box(3.2, 0.9, 1.9, 0x8a7c64, "prop");
    counter.position.y = 0.0;
    s.add(counter);
    const awning = L.box(3.8, 0.12, 2.6, aw, "prop");
    awning.position.set(0, 0, 0.1);
    awning.translateY(2.35);
    awning.rotation.x = 0.18;
    s.add(awning);
    s.position.set(x, 0, z);
    s.rotation.y = rot;
    L.manifest.push({ id: `puesto_${x}_${z}`, cat: "prop", x, z, w: 3.8, d: 2.6, h: 2.6 });
    return s;
  }
  g.add(stall(4, -13, 0.25));
  g.add(stall(8, -21, -0.15, 0xa89058));
  g.add(stall(0, -27, 0.5));

  // ---- primer término: mesa con calabazas + barricas -----------------
  const table = new THREE.Group();
  const top = L.box(2.6, 0.14, 1.3, 0x8a7c64, "prop");
  top.translateY(0.82);
  table.add(top);
  for (const [lx, lz] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]]) {
    const leg = L.box(0.14, 0.82, 0.14, 0x7c6f5a, "prop");
    leg.position.set(lx, 0, lz);
    table.add(leg);
  }
  for (const [px, pz, r] of [[-0.7, 0, 0.34], [0, -0.15, 0.3], [0.65, 0.1, 0.36], [0.2, 0.3, 0.26]]) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(r, 18, 12),
      L.mat(0xb08a5a, 0.85),
    );
    p.scale.y = 0.72;
    p.position.set(px, 0.96 + r * 0.6, pz);
    p.userData.cat = "prop";
    table.add(p);
  }
  table.position.set(2.6, 0, -3.0);
  table.rotation.y = -0.35;
  g.add(table);
  L.manifest.push({ id: "mesa_calabazas", cat: "prop", x: 2.6, z: -3.0, w: 2.6, d: 1.3, h: 1.3 });
  g.add(L.barrel(-6.6, -2.2));
  g.add(L.barrel(-7.4, -1.3));
  g.add(L.crate(5.8, -5.5, 0.9, 0.4));

  // ---- luz y atmósfera ----------------------------------------------
  g.add(L.sun(0xffe8c0, 3.5, [60, 45, 45], [-5, 0, -22], 110));
  g.add(new THREE.HemisphereLight(0xbcd0e8, 0x968872, 1.25));
  g.add(L.sky(0x7fa3cc, 0xe6dfc9));

  return {
    group: g,
    camera: { pos: [-3, 1.75, 9], look: [-0.5, 2.0, -40], fov: 35 },
    background: new THREE.Color(0xe6dfc9),
    fog: new THREE.Fog(0xd8d2c0, 55, 220),
    depthMax: 100,
    manifest: L.manifest,
  };
}
