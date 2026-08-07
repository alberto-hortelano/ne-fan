// 04_bosque — greybox 3D de la senda del arroyo Cierzo, primera hora de la
// tarde. Cámara a ras de senda mirando al norte; el camino en S cruza el
// arroyo por un puentecillo de tablones y se pierde hacia un claro dorado
// entre los troncos. Profundidad por valor: oscuro delante, luminoso detrás.
import { makeLib } from "../lib.mjs";

export async function build(THREE) {
  const L = makeLib(THREE);
  const g = new THREE.Group();

  // ---- suelo, senda y arroyo -----------------------------------------
  g.add(L.ground(400, 0x6b6848)); // hojarasca y agujas
  const path = [
    [0.4, 8], [-0.8, -6], [-3.2, -16], [-1.0, -26], [3.4, -34], [3.8, -44], [1.5, -56],
  ];
  g.add(L.ribbon(path, 2.8, 0xb5a37e, "street", 0.14));
  // arroyo cruzando en diagonal, reflejando cielo (único azul)
  g.add(L.ribbon(
    [[-30, -18], [-12, -21], [-2, -24], [8, -25], [26, -23], [42, -18]],
    5.2, 0xa4c4dc, "water", 0.1,
  ));

  // ---- puente de tablones con una sola baranda ----------------------
  const bridge = new THREE.Group();
  const deck = L.box(3.0, 0.22, 5.2, 0x9a917e, "prop");
  deck.position.set(0, 0.28, 0);
  bridge.add(deck);
  // baranda única (lado oeste), combada: tres postes + pasamanos
  for (const bz of [-2.2, 0, 2.2]) {
    const post = L.box(0.16, 1.0, 0.16, 0x776e5c, "prop");
    post.position.set(-1.35, 0.4, bz);
    bridge.add(post);
  }
  const rail = L.box(0.12, 0.12, 5.0, 0x776e5c, "prop");
  rail.position.set(-1.35, 1.28, 0);
  rail.rotation.x = 0.04;
  bridge.add(rail);
  bridge.position.set(-1.2, 0, -24.5);
  bridge.rotation.y = 0.12;
  g.add(bridge);
  L.manifest.push({ id: "puente", cat: "prop", x: -1.2, z: -24.5, w: 3, d: 5.2, h: 1.4 });

  // ---- árboles: tronco cilíndrico + copa esférica -------------------
  const tree = (x, z, trunkH, trunkR, canopyR, trunkC = 0x6e6250, canopyC = 0x47563a) => {
    const grp = new THREE.Group();
    const t = L.cylinder(trunkR, trunkH, trunkC, "tree");
    grp.add(t);
    const c = new THREE.Mesh(
      new THREE.SphereGeometry(canopyR, 14, 10),
      L.mat(canopyC, 0.95),
    );
    c.position.y = trunkH + canopyR * 0.55;
    c.scale.y = 0.8;
    // las copas NO proyectan: la luz moteada baña senda y arroyo (el dosel
    // real filtra luz; una esfera opaca apagaría todo el término medio)
    c.userData.noShadow = true;
    L.tag(c, "tree");
    grp.add(c);
    grp.position.set(x, 0, z);
    return grp;
  };

  // (1) troncos ENORMES de primer término, recortados por el encuadre
  g.add(tree(-5.2, -1.5, 13, 1.1, 6.5, 0x574c3e, 0x39452e));
  g.add(tree(6.2, -4.0, 12, 0.95, 6.0, 0x5c5142, 0x3c4830));
  // (2) hayas medias flanqueando senda y arroyo
  g.add(tree(-7.5, -14, 10, 0.7, 4.8));
  g.add(tree(7.8, -17, 11, 0.75, 5.2));
  g.add(tree(-6.0, -30, 10, 0.65, 4.6));
  g.add(tree(8.5, -33, 9, 0.6, 4.2));
  g.add(tree(-9.5, -40, 11, 0.7, 5.0));
  // (3) cortina de troncos pálidos comidos por la luz del claro
  for (const [x, z] of [[-4, -52], [2, -55], [7, -51], [-8, -56], [11, -57], [-1, -60], [5, -62]]) {
    const t = L.cylinder(0.5, 11, 0xb9ac8a, "tree");
    t.position.set(x, 0, z);
    g.add(t);
  }
  // dosel oscuro cerrando arriba (dos copas gigantes sobre el primer término)
  const canopyTop = new THREE.Mesh(new THREE.SphereGeometry(11, 14, 10), L.mat(0x2e3a26, 0.95));
  canopyTop.position.set(-4, 16, -6);
  canopyTop.scale.y = 0.55;
  canopyTop.userData.noShadow = true;
  L.tag(canopyTop, "tree");
  g.add(canopyTop);
  const canopyTop2 = new THREE.Mesh(new THREE.SphereGeometry(10, 14, 10), L.mat(0x33402a, 0.95));
  canopyTop2.position.set(7, 15, -9);
  canopyTop2.scale.y = 0.55;
  canopyTop2.userData.noShadow = true;
  L.tag(canopyTop2, "tree");
  g.add(canopyTop2);

  // ---- vida del claro ------------------------------------------------
  // tronco caído con musgo, de banco que no usa nadie
  const log = L.cylinder(0.32, 3.2, 0x6a6a4a, "prop");
  log.rotation.z = Math.PI / 2;
  log.rotation.y = -0.35;
  log.position.set(-6.2, 0.32, -11.5);
  g.add(log);
  L.manifest.push({ id: "tronco_caido", cat: "prop", x: -6.2, z: -11.5, w: 3.2, d: 0.7, h: 0.7 });
  // rocas del arroyo
  for (const [x, z, s] of [[-3.6, -21.5, 0.7], [2.8, -26.5, 0.55], [6.5, -24, 0.8], [-7, -23, 0.5]]) {
    const r = L.box(s * 1.5, s, s * 1.2, 0x8a877c, "rock");
    r.position.set(x, 0, z);
    r.rotation.y = x * 0.7;
    g.add(r);
  }
  // setas rojas al pie del haya grande
  for (const [x, z] of [[-4.2, -3.8], [-3.7, -4.3], [-4.6, -4.5]]) {
    const m = L.cylinder(0.09, 0.22, 0xa8503c, "prop", 0.16);
    m.position.set(x, 0, z);
    g.add(m);
  }
  // helechos (conos verdes bajos)
  for (const [x, z] of [[-6.5, -10], [5.5, -8.5], [-8, -19], [9, -21], [-5, -35], [7, -37]]) {
    const f = L.cylinder(0.7, 0.9, 0x4c5c34, "bush", 0.05);
    f.position.set(x, 0, z);
    g.add(f);
  }

  // ---- luz y atmósfera ----------------------------------------------
  // sol alto filtrado desde arriba-izquierda; el CLARO del fondo es la zona
  // más luminosa (fog claro y cálido + cortina de troncos pálidos)
  g.add(L.sun(0xffe9b8, 3.4, [-14, 55, -6], [3, 0, -30], 90));
  g.add(new THREE.HemisphereLight(0x93a37c, 0x4a4634, 1.45));
  g.add(L.sky(0xcfd8b8, 0xf2e6b0, -420));

  return {
    group: g,
    camera: { pos: [0.2, 1.6, 5], look: [0.5, 2.2, -50], fov: 40 },
    background: new THREE.Color(0xe8dfae),
    fog: new THREE.Fog(0xd8cf9e, 30, 95),
    depthMax: 70,
    manifest: L.manifest,
  };
}
