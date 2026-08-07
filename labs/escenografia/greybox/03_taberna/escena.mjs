// 03_taberna — greybox 3D de la sala de la posada del Roble, media tarde.
// Cámara DENTRO de la sala a altura de ojos, fuga en el tercio izquierdo.
// Luz: lámina dorada de la ventana oeste (derecha de cámara: el muro oeste
// queda a la izquierda) + boca de la chimenea como única fuente cálida
// saturada. Resto en penumbra marrón cálida.
import { makeLib } from "../lib.mjs";

export async function build(THREE) {
  const L = makeLib(THREE);
  const g = new THREE.Group();

  const W = 12; // ancho de la sala (x)
  const D = 16; // fondo (z, hacia -z)
  const H = 3.3; // altura al techo

  // ---- suelo de tablas, techo y muros --------------------------------
  g.add(L.ground(60, 0x6d5a42)); // tablas gastadas
  // lámina de luz de la ventana oeste sobre el suelo (diagonal)
  const pool = L.box(3.4, 0.02, 5.2, 0xcaa96e, "terrain");
  pool.position.set(-1.6, 0.02, -6.2);
  pool.rotation.y = 0.5;
  pool.userData.noShadow = true;
  g.add(pool);

  const wallMat = 0x8a7458;
  // muro norte (fondo) con puerta de cocina entreabierta
  const back = L.box(W, H, 0.4, wallMat, "building");
  back.position.set(0, 0, -D + 0.2);
  g.add(back);
  // hoja de luz cálida por la puerta entreabierta del fondo
  const kitchenDoor = L.box(1.1, 2.1, 0.1, 0xb87e46, "building");
  kitchenDoor.position.set(-3.4, 0, -D + 0.5);
  g.add(kitchenDoor);
  // muro oeste (izquierda) con ventana emplomada (hueco claro)
  const west = L.box(0.4, H, D, wallMat, "building");
  west.position.set(-W / 2 + 0.2, 0, -D / 2);
  g.add(west);
  const window_ = L.box(0.12, 1.5, 2.4, 0xe8d9a8, "building");
  window_.position.set(-W / 2 + 0.45, 1.2, -7);
  g.add(window_);
  // muro este (derecha) con la chimenea de piedra
  const east = L.box(0.4, H, D, wallMat, "building");
  east.position.set(W / 2 - 0.2, 0, -D / 2);
  g.add(east);
  // chimenea: cuerpo de piedra + boca encendida + campana
  const hearth = L.box(1.4, 2.6, 3.2, 0x8d8678, "building");
  hearth.position.set(W / 2 - 0.9, 0, -8.4);
  g.add(hearth);
  const fire = L.box(0.4, 1.4, 2.0, 0xffa04e, "prop");
  fire.position.set(W / 2 - 1.75, 0.15, -8.4);
  g.add(fire);
  L.manifest.push({ id: "chimenea", cat: "prop", x: W / 2 - 1, z: -8.4, w: 1.4, d: 3.2, h: 2.6 });
  // techo bajo con vigas ennegrecidas
  const ceiling = L.box(W, 0.25, D, 0x4e4030, "building");
  ceiling.position.set(0, 0, -D / 2);
  ceiling.translateY(H);
  g.add(ceiling);
  for (let z = -2.5; z > -D + 1; z -= 2.6) {
    const beam = L.box(W, 0.3, 0.35, 0x3d3226, "building");
    beam.position.set(0, 0, z);
    beam.translateY(H - 0.3);
    g.add(beam);
    // jamones y ristras colgando de algunas vigas
    if (z < -4 && z > -12) {
      const ham = L.cylinder(0.16, 0.55, 0x7c4a33, "prop");
      ham.position.set(-2 + (z % 3), H - 0.85, z);
      g.add(ham);
    }
  }

  // ---- mobiliario ----------------------------------------------------
  const table = (x, z, rot = 0, w = 2.0, d = 1.0) => {
    const t = L.box(w, 0.78, d, 0x7a6448, "prop");
    t.position.set(x, 0, z);
    t.rotation.y = rot;
    return t;
  };
  const stool = (x, z) => {
    const s = L.cylinder(0.24, 0.5, 0x6b563c, "prop");
    s.position.set(x, 0, z);
    return s;
  };
  // mesa del primer término, recortada abajo-derecha, con jarra y hogaza
  g.add(table(2.6, -2.2, 0.18, 2.4, 1.2));
  const jug = L.cylinder(0.13, 0.34, 0x9a5f3d, "prop");
  jug.position.set(2.2, 0.78, -2.1);
  g.add(jug);
  const bread = L.box(0.42, 0.16, 0.26, 0xc0985f, "prop");
  bread.position.set(3.0, 0.78, -2.4);
  g.add(bread);
  L.manifest.push({ id: "mesa_cercana", cat: "prop", x: 2.6, z: -2.2, w: 2.4, d: 1.2, h: 0.78 });
  // tonel cortado abajo-izquierda (primer término)
  const nearBarrel = L.cylinder(0.55, 1.1, 0x7c6749, "prop");
  nearBarrel.position.set(-3.6, 0, -1.2);
  g.add(nearBarrel);
  // sala: mesas y taburetes desparejos
  g.add(table(-1.8, -6.6, -0.3));
  g.add(stool(-0.7, -6.2));
  g.add(stool(-2.9, -7.2));
  g.add(table(2.4, -9.8, 0.4));
  g.add(stool(1.4, -9.3));
  g.add(stool(3.4, -10.4));
  // banqueta volcada junto a la lumbre
  const fallen = L.cylinder(0.24, 0.5, 0x6b563c, "prop");
  fallen.rotation.z = Math.PI / 2;
  fallen.position.set(3.9, 0.24, -7.6);
  g.add(fallen);
  // banco arrimado a la chimenea
  const bench = L.box(2.2, 0.45, 0.5, 0x6f5a40, "prop");
  bench.position.set(3.6, 0, -8.4);
  bench.rotation.y = Math.PI / 2;
  g.add(bench);

  // ---- barra del posadero al fondo ----------------------------------
  const counter = L.box(4.6, 1.05, 0.8, 0x5e4a33, "prop");
  counter.position.set(1.6, 0, -13.6);
  g.add(counter);
  L.manifest.push({ id: "barra", cat: "prop", x: 1.6, z: -13.6, w: 4.6, d: 0.8, h: 1.05 });
  for (const [bx, bz] of [[0.6, -15.1], [2.0, -15.2], [3.3, -15.0]]) {
    const b = L.barrel(bx, bz, 0.5, 1.0);
    g.add(b);
  }
  // estante de jarras sobre los toneles
  const shelf = L.box(3.6, 0.12, 0.4, 0x4e4030, "prop");
  shelf.position.set(1.8, 0, -15.55);
  shelf.translateY(2.0);
  g.add(shelf);
  for (const jx of [0.6, 1.3, 2.0, 2.7]) {
    const jr = L.cylinder(0.11, 0.26, 0x9a6a45, "prop");
    jr.position.set(jx, 2.12, -15.55);
    g.add(jr);
  }

  // ---- luz y atmósfera ----------------------------------------------
  // lámina de la ventana oeste: dir light baja cruzando en diagonal
  const win = new THREE.DirectionalLight(0xe8c98a, 4.2);
  win.position.set(-16, 4.5, -3);
  win.target.position.set(2, 0, -9);
  win.castShadow = true;
  win.shadow.mapSize.set(2048, 2048);
  win.shadow.camera.left = -14; win.shadow.camera.right = 14;
  win.shadow.camera.top = 12; win.shadow.camera.bottom = -12;
  g.add(win, win.target);
  // fuego de la chimenea: puntual naranja que baña su rincón
  const fireLight = new THREE.PointLight(0xff8a3c, 42, 13, 1.6);
  fireLight.position.set(W / 2 - 2.1, 0.9, -8.4);
  g.add(fireLight);
  // luz cálida por la puerta de la cocina
  const doorLight = new THREE.PointLight(0xe0a45c, 5, 6, 2.0);
  doorLight.position.set(-3.4, 1.1, -14.8);
  g.add(doorLight);
  // penumbra ambiente marrón cálida
  g.add(new THREE.HemisphereLight(0x8a7a64, 0x453a2c, 1.7));

  return {
    group: g,
    camera: { pos: [-1.4, 1.55, 1.8], look: [1.2, 1.4, -14], fov: 46 },
    background: new THREE.Color(0x241d16),
    fog: new THREE.Fog(0x352a1f, 16, 40),
    depthMax: 22,
    manifest: L.manifest,
  };
}
