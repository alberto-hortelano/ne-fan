// 01_calle — greybox 3D de la calle mayor curva al atardecer.
// Mundo en metros: x este (+derecha), z norte NEGATIVO, y altura.
// Sol bajo del oeste (x−): fachadas del lado este (derecha) doradas,
// soportales del oeste a contraluz. La calle gira al este en z≈−45 y se
// pierde tras las casas; la torre asoma sobre el codo.
import { makeLib } from "../lib.mjs";

export async function build(THREE) {
  const L = makeLib(THREE);
  const g = new THREE.Group();

  // ---- suelo y calle -------------------------------------------------
  g.add(L.ground(400, 0x9a9080));
  const street = [
    [0.5, 8], [0.5, -12], [2, -28], [7, -44], [16, -54], [27, -60],
  ];
  g.add(L.ribbon(street, 6.8, 0xa9a091));
  // roderas: dos cintas estrechas más oscuras dentro de la calzada
  g.add(L.ribbon(street.map(([x, z]) => [x - 1.1, z]), 0.5, 0x8d8474, "street", 0.04));
  g.add(L.ribbon(street.map(([x, z]) => [x + 1.1, z]), 0.5, 0x8d8474, "street", 0.04));

  // ---- lado oeste (izquierda): soportales a contraluz ---------------
  // edificio sobre el pórtico, en dos cuerpos de altura distinta
  g.add(L.house({ id: "soportal_a", x: -8.2, z: -12.5, w: 9, d: 13, h: 7.4, roofH: 2.4, ridge: "z", wall: 0xa89c8c, roof: 0x7d7264 }));
  g.add(L.house({ id: "soportal_b", x: -7.6, z: -25.5, w: 9.5, d: 12, h: 6.1, roofH: 2.1, ridge: "z", wall: 0xb0a494, roof: 0x847a6c }));
  // losa del pórtico + pilares en el filo de la calle
  const slab = L.box(3.6, 0.7, 25, 0x968b7b, "building");
  slab.position.set(-5.1, 0, -18.5);
  slab.translateY(3.3);
  g.add(slab);
  for (const z of [-7.5, -12.5, -17.5, -22.5, -27.5]) {
    const p = L.box(0.65, 3.3, 0.65, 0x9a8f7f, "building");
    p.position.set(-3.5, 0, z);
    g.add(p);
  }
  // pilar de PRIMER TÉRMINO que enmarca por la izquierda
  const nearPillar = L.box(0.9, 4.2, 0.9, 0x8d8272, "building");
  nearPillar.position.set(-3.2, 0, 3.2);
  g.add(nearPillar);

  // ---- lado este (derecha): fachadas doradas al sol -----------------
  g.add(L.house({ id: "casa_e1", x: 11, z: -3.5, w: 10, d: 12, h: 6.6, roofH: 2.6, ridge: "x", wall: 0xc2b4a0, roof: 0x8a7e6e }));
  g.add(L.house({ id: "casa_e2", x: 9.2, z: -17, w: 8.5, d: 11, h: 5.4, roofH: 2.0, ridge: "z", wall: 0xbcae9a, roof: 0x827868 }));
  g.add(L.house({ id: "casa_e3", x: 11.5, z: -29, w: 9, d: 10, h: 7.0, roofH: 2.4, ridge: "x", rot: -0.18, wall: 0xc6b8a2, roof: 0x8d8170 }));
  g.add(L.house({ id: "casa_e4", x: 16.5, z: -40, w: 9, d: 10, h: 5.8, roofH: 2.2, ridge: "z", rot: -0.5, wall: 0xbdaf9b, roof: 0x847a6a }));
  g.add(L.house({ id: "casa_e5", x: 24, z: -50, w: 9, d: 9, h: 6.4, roofH: 2.3, ridge: "x", rot: -0.85, wall: 0xc0b29c, roof: 0x877c6c }));

  // ---- cierre del codo (lado oeste al fondo) ------------------------
  g.add(L.house({ id: "casa_w3", x: -2.5, z: -41, w: 10, d: 11, h: 6.2, roofH: 2.2, ridge: "x", rot: 0.12, wall: 0xab9f8f, roof: 0x7c7264 }));
  g.add(L.house({ id: "casa_w4", x: 3, z: -52, w: 11, d: 10, h: 5.6, roofH: 2.0, ridge: "z", rot: -0.35, wall: 0xa79b8b, roof: 0x787060 }));

  // ---- torre en el codo (punto focal) -------------------------------
  const towerGrp = new THREE.Group();
  towerGrp.add(L.box(6, 15, 6, 0xb3a58f, "building"));
  const towerRoof = L.pyramid(6.6, 4.2, 0x6e6456);
  towerRoof.position.y = 15;
  towerGrp.add(towerRoof);
  towerGrp.position.set(9, 0, -62);
  g.add(towerGrp);
  L.manifest.push({ id: "torre", cat: "building", x: 9, z: -62, w: 6, d: 6, h: 19.2 });

  // ---- huecos en la fachada dorada visible (casa_e2, cara oeste x=4.95)
  for (const wy of [1.9, 3.6]) {
    for (const wz of [-13.5, -16, -18.5, -21]) {
      const win = L.box(0.14, 1.2, 1.0, 0x3a342c, "building");
      win.position.set(4.9, wy, wz);
      g.add(win);
    }
  }
  const door = L.box(0.14, 2.2, 1.4, 0x352f27, "building");
  door.position.set(4.9, 0, -14.7);
  g.add(door);
  // huecos bajo el soportal (cara este del cuerpo, x=-3.7)
  for (const wz of [-9, -14, -19, -24, -28]) {
    const arcDoor = L.box(0.12, 2.4, 1.6, 0x39322a, "building");
    arcDoor.position.set(-3.66, 0, wz);
    g.add(arcDoor);
  }
  // ventanas altas sobre el pórtico
  for (const wz of [-8.5, -12.5, -16.5, -20.5, -24.5, -28.5]) {
    const win = L.box(0.1, 1.2, 0.95, 0x6a604f, "building");
    win.position.set(-3.66, 5.1, wz);
    g.add(win);
  }

  // ---- chimeneas (variedad de silueta) ------------------------------
  for (const [x, y, z] of [[7, 8.2, -6], [12, 8.4, -31], [-9, 8.8, -14]]) {
    const c = L.box(0.9, 1.6, 0.9, 0x94897b, "building");
    c.position.set(x, 0, z);
    c.translateY(y);
    g.add(c);
  }

  // ---- carro con barricas (primer término derecho) ------------------
  const cart = new THREE.Group();
  const body = L.box(1.8, 0.5, 3, 0x8c7c64, "prop");
  body.translateY(0.75);
  cart.add(body);
  for (const s of [-1, 1]) {
    const wheel = L.cylinder(0.55, 0.14, 0x776a54, "prop");
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(s * 1.0, 0.55, 0.4);
    cart.add(wheel);
  }
  for (const [bx, bz] of [[-0.4, -0.5], [0.4, -0.5], [0, 0.4]]) {
    const b = L.barrel(bx, bz);
    b.position.y = 1.25;
    cart.add(b);
  }
  cart.position.set(4.4, 0, -10.5);
  cart.rotation.y = 0.25;
  g.add(cart);
  L.manifest.push({ id: "carro", cat: "prop", x: 5.2, z: -10.5, w: 2, d: 3.4, h: 2.1 });
  g.add(L.barrel(-2.2, -9.5));

  // ---- fondo: tejados en calima + colinas ---------------------------
  for (const [x, z, w, h] of [
    [2, -74, 12, 6], [16, -80, 14, 7.5], [-10, -78, 10, 5],
    [30, -74, 10, 6.5], [8, -88, 16, 8],
  ]) {
    g.add(L.house({ x, z, w, d: 9, h, roofH: h * 0.35, ridge: Math.abs(x) % 2 ? "x" : "z", wall: 0xa39a8e, roof: 0x8a8176 }));
  }
  g.add(L.hill(260, 26, 0x8f8a80, 30, -150));
  g.add(L.hill(320, 18, 0x968f84, -80, -160));

  // ---- luz y atmósfera ----------------------------------------------
  // sol bajo del suroeste, RASANTE a lo largo de la calle: charcos de luz en
  // el codo y la torre, primer término en sombra abierta (relleno alto)
  g.add(L.sun(0xffcf9a, 3.4, [-42, 28, 65], [8, 0, -45], 110));
  g.add(new THREE.HemisphereLight(0x9aa2c8, 0x6b6055, 1.35));
  g.add(L.sky(0x50506e, 0xd9a06a));

  return {
    group: g,
    camera: { pos: [0, 1.7, 3], look: [2.2, 1.8, -48], fov: 33 },
    background: new THREE.Color(0xd9a06a),
    fog: new THREE.Fog(0xc39a74, 35, 150),
    depthMax: 90,
    manifest: L.manifest,
  };
}
