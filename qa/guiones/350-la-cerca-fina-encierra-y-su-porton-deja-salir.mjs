/** Tanda BV (#788), visto por quien juega: una cerca FINA (`wall` de `width`
 *  0,3 celdas = 15 cm pintados) que cierra un recinto NO se atraviesa, ni
 *  alineada a los ejes con el trazo sobre la frontera de celdas (el caso en que
 *  el `markBand` por centro de celda no marcaba NINGUNA celda) ni girada 30°;
 *  y la misma cerca con un portón, o con un hueco, sí deja salir.
 *
 *  POR QUÉ ESTA PUERTA. Ninguna escena viva trae un muro de `width` < 1 (el
 *  motor usa hoy 1, 2 y 5), así que la escena entra por `loadSceneRaw` —la
 *  misma puerta que el selector «Room»: `load_room` al bridge y el sim colisiona
 *  con `planCollisionGrid` sobre el plan, como en partida—, igual que el 330.
 *  Es un WORKAROUND declarado en el qa.md de la tanda: el jugador no puede
 *  llegar hoy a este tile por el flujo normal; el día que el motor declare una
 *  empalizada fina, llegará por el mismo `planCollisionGrid`.
 *
 *  Todo se ANDA con la tecla de avance (inputDriver, sim del bridge). Lo único
 *  que se coloca es el punto de SALIDA de cada carrera, dentro del recinto.
 *  Cada «no se sale» tiene su control «por el portón / por el hueco sí»: sin
 *  él, un jugador clavado daría todos los verdes.
 *
 *  Además MIDE (y afirma con holgura de una celda) dónde te frena la cerca
 *  respecto de donde se PINTA: la colisión puede ser más gruesa que lo pintado
 *  (requisito 2: render ≠ colisión), pero no más de lo que da redondear la
 *  banda hasta la celda. La referencia es un muro de `width` 2 alineado cuyas
 *  caras caen en frontera de celda (colisión = pintura): la parada ante él es
 *  el radio del cuerpo, y se descuenta.
 *
 *  Probado en negativo (qa.md de la tanda): con el `collision.ts` de `main`
 *  (3d0b30b3) las carreras contra la cerca de eje salen rojas.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, modo maqueta (clay).
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["fake-ai"];

const frames = esperaDeFotogramas("mundo");

const W = 0.3; // grosor de la cerca en celdas (15 cm)

/** Cuadrado de lado 2·s celdas centrado en c, girado `grados`, como polilínea
 *  (cerrada si `cerrada`, repitiendo el primer punto). */
function cuadrado(c, s, grados) {
  const a = (grados * Math.PI) / 180;
  const rot = ([u, v]) => [c[0] + u * Math.cos(a) - v * Math.sin(a), c[1] + u * Math.sin(a) + v * Math.cos(a)];
  return [[-s, -s], [s, -s], [s, s], [-s, s]].map(rot);
}

const A = { c: [25, 25], s: 15 }; // eje, trazo en u,v enteros = frontera de celdas
const B = { c: [90, 30], s: 12, g: 30 }; // girada 30°
const C = { c: [25, 85], s: 15 }; // eje, con portón en el lado este
const D = { c: [90, 92], s: 12, g: 30 }; // girada 30°, con un hueco de 8 celdas (4 m)

const esqB = cuadrado(B.c, B.s, B.g);
const esqD = cuadrado(D.c, D.s, D.g);
const finD = [esqD[3][0] + (esqD[0][0] - esqD[3][0]) * (16 / 24), esqD[3][1] + (esqD[0][1] - esqD[3][1]) * (16 / 24)];
const huecoD = [(finD[0] + esqD[0][0]) / 2, (finD[1] + esqD[0][1]) / 2];

const cerrar = (pts) => [...pts, pts[0]];
const ESCENA = {
  scene_id: "qa350",
  scene_description: "Banco de QA de la tanda BV: cercas finas (15 cm) que encierran, una con portón y otra con hueco.",
  tile: { tx: 0, ty: 0 },
  biome: "grass",
  ground: [],
  volumes: [
    { id: "cerca_eje", label: "cerca de eje", type: "wall", points: cerrar(cuadrado(A.c, A.s, 0)), width: W, h: 1.4 },
    { id: "cerca_girada", label: "cerca girada", type: "wall", points: cerrar(esqB), width: W, h: 1.4 },
    { id: "cerca_porton", label: "cerca con portón", type: "wall", points: cerrar(cuadrado(C.c, C.s, 0)), width: W, h: 1.4 },
    { id: "porton", label: "portón", type: "gate", at: [C.c[0] + C.s, C.c[1]], w: 8, h: 3, orient: "y" },
    { id: "cerca_hueco", label: "cerca con hueco", type: "wall", points: [...esqD, finD], width: W, h: 1.4 },
    { id: "muro_ref", label: "muro de referencia", type: "wall", points: [[50, 64], [76, 64]], width: 2, h: 3 },
  ],
  entities: [{ id: "player", kind: "player", name: "Tú", cell: [64, 114], footprint: [1, 1] }],
};

const yawHacia = (dx, dz) => Math.atan2(dx, dz); // yaw 0 = +z (sur), π/2 = +x (este)

export default async function (ctx) {
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  await ctx.nefan("loadSceneRaw", ESCENA);
  await ctx.waitFor("el tile del guion está pintado", () => (window.__nefan.scene?.scene_id === "qa350" ? true : null), 30_000);
  const geo = await ctx.page.evaluate(() => {
    const g = window.__nefan.scene.terrain_grid;
    const vols = (window.__nefan.scene.__plan?.volumes ?? []).map((v) => v.id);
    return { ox: g.origin[0], oz: g.origin[1], mpc: g.meters_per_cell, vols };
  });
  const ids = ESCENA.volumes.map((v) => v.id);
  ctx.expect(
    "precondición: la escena del guion está puesta con sus seis volúmenes y celdas de 0,5 m",
    geo.mpc === 0.5 && ids.every((id) => geo.vols.includes(id)),
    JSON.stringify(geo),
  );
  if (geo.mpc !== 0.5) return;
  const X = (u) => geo.ox + u * geo.mpc;
  const Z = (v) => geo.oz + v * geo.mpc;

  /** Inclina la mirada con las flechas (↓/↑), el gesto del jugador: cada
   *  PULSACIÓN es un paso de 15° (`mirada.ts` mira el flanco), así que se
   *  pulsa y se suelta paso a paso. */
  async function mirar(grados) {
    for (let i = 0; i < 8; i++) {
      const actual = (await ctx.nefan("state")).pitchDeg;
      if (Math.abs(actual - grados) < 1) break;
      const tecla = grados < actual ? "turnDown" : "turnUp";
      await ctx.holdUntil(
        tecla,
        `la mirada da un paso desde ${actual.toFixed(0)}° hacia ${grados}°`,
        (a) => (Math.abs(window.__nefan.state().pitchDeg - a) > 1 ? true : null),
        { sim: 2 },
        actual,
      );
      await frames(ctx); // que el sim vea la tecla SUELTA: si no, no hay flanco
    }
  }

  /** Dos fotos donde se quedó el jugador: con la mirada horizontal y mirando
   *  abajo. A 0,9 m de una cerca de 1,4 m con la mirada horizontal, la cerca
   *  cae por debajo del encuadre: la foto útil para el director de arte es
   *  mirando abajo, como haría el jugador al chocar con «nada». */
  async function fotos(nombre) {
    await frames(ctx);
    await ctx.shot(nombre);
    await mirar(-30);
    await ctx.shot(`${nombre}-mirando-abajo`);
    await mirar(0);
  }

  /** Sale del centro `c` (celdas) hacia `rumbo` (dx, dz). «Fuera» = más lejos
   *  del centro que el radio circunscrito del recinto + 0,5 m. */
  async function carrera({ c, s, rumbo, debe, aserto, sprint = false }) {
    const cx = X(c[0]);
    const cz = Z(c[1]);
    const fuera = s * Math.SQRT2 * geo.mpc + 0.5;
    await ctx.nefan("setPlayerPos", cx, cz);
    await ctx.nefan("setYaw", yawHacia(rumbo[0], rumbo[1]));
    await frames(ctx);
    if (sprint) await ctx.nefan("inputDriver.press", "sprint");
    const { ocurrio } = await ctx.expectEspera(
      aserto,
      debe,
      (a) => {
        const p = window.__nefan.state().pos;
        return Math.hypot(p.x - a.cx, p.z - a.cz) > a.fuera ? { x: p.x, z: p.z } : null;
      },
      { sim: 8, arg: { cx, cz, fuera }, tecla: "up", aserto },
    );
    const fin = (await ctx.nefan("state")).pos;
    ctx.log(`${aserto}: (${cx.toFixed(2)}, ${cz.toFixed(2)}) → (${fin.x.toFixed(2)}, ${fin.z.toFixed(2)}) · dist ${Math.hypot(fin.x - cx, fin.z - cz).toFixed(2)} m (fuera > ${fuera.toFixed(2)}) · ocurrió=${ocurrio}`);
    return { ocurrio, fin };
  }

  // ── 0 · Referencia: muro width 2 de eje (cara sur pintada en v=65) ───────
  await ctx.nefan("setPlayerPos", X(63), Z(72));
  await ctx.nefan("setYaw", Math.PI);
  await frames(ctx);
  await ctx.expectEspera(
    "el muro de referencia se atraviesa",
    false,
    (lim) => (window.__nefan.state().pos.z < lim ? true : null),
    { sim: 6, arg: Z(64), tecla: "up", aserto: "control: el muro de referencia (width 2) frena" },
  );
  const radio = (await ctx.nefan("state")).pos.z - Z(65);
  ctx.expect("precondición: ante una cara que coincide con su celda, el cuerpo para a un radio (0 < r < 1 m)", radio > 0 && radio < 1, `${radio.toFixed(3)} m`);

  // ── 1 · Cerca de eje, trazo sobre la frontera de celdas ──────────────────
  const rumbos4 = { este: [1, 0], oeste: [-1, 0], norte: [0, -1], sur: [0, 1] };
  const paradas = {};
  for (const [nombre, r] of Object.entries(rumbos4)) {
    const { fin } = await carrera({
      ...A, rumbo: r, debe: false,
      aserto: `la cerca de EJE (15 cm, trazo en frontera de celda) NO deja salir hacia el ${nombre}`,
    });
    paradas[nombre] = fin;
  }
  const paradaEste = paradas.este;
  await ctx.nefan("setPlayerPos", paradaEste.x, paradaEste.z);
  await ctx.nefan("setYaw", Math.PI / 2);
  await fotos("cerca-de-eje-parado-ante-ella");
  await carrera({ ...A, rumbo: [1, -1], debe: false, aserto: "la cerca de EJE NO deja salir por la ESQUINA noreste" });
  await carrera({ ...A, rumbo: [1, 0.2], debe: false, sprint: true, aserto: "la cerca de EJE NO deja salir ESPRINTANDO en rasante" });

  // Dónde frena vs dónde se pinta: cara oeste de la cerca este en u = 40 − 0,15.
  const caraPintada = X(A.c[0] + A.s) - (W / 2) * geo.mpc;
  const hueco = caraPintada - paradaEste.x;
  const sobra = hueco - radio;
  ctx.log(`cerca de eje: parada a ${hueco.toFixed(2)} m de la cara PINTADA · radio medido ${radio.toFixed(2)} m · colisión invisible ${sobra.toFixed(2)} m`);
  ctx.expect(
    "la cerca de eje frena a no más de una celda (0,5 m) por delante de lo pintado, descontado el cuerpo",
    sobra > -0.05 && sobra <= 0.5,
    `${sobra.toFixed(3)} m`,
  );

  // ── 2 · Cerca girada 30° ─────────────────────────────────────────────────
  // Normales de los cuatro lados y las cuatro esquinas del cuadrado girado.
  const lados = [0, 1, 2, 3].map((i) => {
    const [p, q] = [esqB[i], esqB[(i + 1) % 4]];
    return [(p[0] + q[0]) / 2 - B.c[0], (p[1] + q[1]) / 2 - B.c[1]];
  });
  const paradasB = [];
  for (const [i, r] of lados.entries()) {
    const { fin } = await carrera({ ...B, rumbo: r, debe: false, aserto: `la cerca GIRADA 30° NO deja salir por su lado ${i}` });
    paradasB.push(fin);
  }
  await ctx.nefan("setPlayerPos", paradasB[0].x, paradasB[0].z);
  await ctx.nefan("setYaw", yawHacia(lados[0][0], lados[0][1]));
  await fotos("cerca-girada-parado-ante-ella");
  for (const [i, e] of esqB.entries()) {
    await carrera({ ...B, rumbo: [e[0] - B.c[0], e[1] - B.c[1]], debe: false, aserto: `la cerca GIRADA 30° NO deja salir por su esquina ${i}` });
  }
  await carrera({ ...B, rumbo: [lados[1][0] + 0.3 * lados[2][0], lados[1][1] + 0.3 * lados[2][1]], debe: false, sprint: true, aserto: "la cerca GIRADA NO deja salir ESPRINTANDO en rasante" });

  // Foto del portón desde dentro del recinto, para la crítica visual.
  await ctx.nefan("setPlayerPos", X(C.c[0] + 6), Z(C.c[1]));
  await ctx.nefan("setYaw", Math.PI / 2);
  await frames(ctx);
  await ctx.shot("porton-en-la-cerca-fina-desde-dentro");

  // ── 3 · Controles: la misma cerca con portón y con hueco SÍ deja salir ───
  await carrera({ ...C, rumbo: [1, 0], debe: true, aserto: "control: por el PORTÓN de la cerca fina se SALE" });
  await fotos("salido-por-el-porton");
  await carrera({ ...C, rumbo: [-1, 0], debe: false, aserto: "control del control: por el lado opuesto al portón NO se sale" });
  await carrera({ ...D, rumbo: [huecoD[0] - D.c[0], huecoD[1] - D.c[1]], debe: true, aserto: "control: por el HUECO de 4 m de la cerca girada se SALE" });
  await carrera({ ...D, rumbo: [-(huecoD[0] - D.c[0]), -(huecoD[1] - D.c[1])], debe: false, aserto: "control del control: por el lado cerrado de la cerca con hueco NO se sale" });

  // Vista de conjunto para la crítica visual: desde fuera, mirando la cerca de eje.
  await ctx.nefan("setPlayerPos", X(50), Z(25));
  await ctx.nefan("setYaw", -Math.PI / 2);
  await frames(ctx);
  await ctx.shot("cerca-de-eje-desde-fuera");
}
