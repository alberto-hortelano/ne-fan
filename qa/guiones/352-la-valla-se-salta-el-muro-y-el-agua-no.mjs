/** Tanda BY («que pueda saltar»), visto por quien juega: con Espacio se pasa
 *  por ENCIMA de una valla, y no de un muro ni del agua. Y el salto de verdad
 *  sube la cámara: la elevación que publica el hook es la de core.
 *
 *  POR QUÉ ESTA PUERTA. Igual que el 350: la escena entra por `loadSceneRaw`
 *  —la misma puerta que el selector «Room»—, porque ninguna escena del motor
 *  falso pone una valla, un muro y un río en fila. Es un WORKAROUND declarado:
 *  el día que el motor declare una cerca, llegará por el mismo
 *  `planCollisionGrid`/`planCollisionGridEnElAire` del tile.
 *
 *  Todo se ANDA con la tecla de avance (inputDriver). Lo único que se coloca es
 *  el punto de SALIDA de cada carrera, a 20 cm de la cara del obstáculo; el
 *  salto se pide en el MISMO evaluate que se pulsa la tecla, que es lo que hace
 *  quien corre y salta a la vez. Cada «se cruza» tiene su control «sin saltar
 *  no», y cada «no se cruza» tiene el suyo en la valla: sin ellos, un jugador
 *  clavado o uno que atraviesa todo darían verdes.
 *
 *  LO QUE NO MIDE. El dintel del gate contra la cámara en el apogeo se candá en
 *  core (`PASO_LIBRE_M` incluye `SALTO_APOGEO_M`: `test/terrain-collision` y
 *  `test/lo-que-se-pinta-es-por-donde-se-pasa`); aquí se salta bajo el gate, se
 *  mira la foto y se afirma solo que la elevación observada no pasa del
 *  apogeo. La tecla Espacio REAL y el diálogo abierto los mide el 353: este
 *  corre con el driver de bench, que no pasa por la puerta del teclado.
 *
 *  Probado en negativo (implementacion.md de la tanda): con `enElAire: () =>
 *  false` en `main.ts` la carrera de la valla CON salto sale roja.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, modo maqueta (clay).
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["fake-ai"];

const frames = esperaDeFotogramas("mundo");

/** Radio del jugador en metros (`PLAYER_RADIUS_M`, core). Solo sirve aquí
 *  para colocar la salida y el umbral de «cruzado»; si cambiara en core, el
 *  guion colocaría mal y sus CONTROLES lo dirían. */
const RADIO = 0.4;

const ESCENA = {
  scene_id: "qa352",
  scene_description: "Banco de QA de la tanda BY: una valla de estacas, un muro, un río y una muralla con portón.",
  tile: { tx: 0, ty: 0 },
  biome: "grass",
  ground: [{ id: "rio", kind: "water", rect: [90, 36, 30, 6] }],
  volumes: [
    // Banda v ∈ [38,5; 41,5] en las tres: width 3 por defecto.
    { id: "valla", label: "cerca de madera", type: "wall", points: [[10, 40], [40, 40]], h: 2 },
    { id: "muro", label: "muro", type: "wall", points: [[50, 40], [80, 40]] },
    { id: "muralla", label: "muralla", type: "wall", points: [[0, 90], [128, 90]] },
    { id: "porton", label: "portón", type: "gate", at: [64, 90], w: 8, h: 3, orient: "x" },
  ],
  entities: [{ id: "player", kind: "player", name: "Tú", cell: [64, 114], footprint: [1, 1] }],
};

export default async function (ctx) {
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  await ctx.nefan("loadSceneRaw", ESCENA);
  await ctx.waitFor("el tile del guion está pintado", () => (window.__nefan.scene?.scene_id === "qa352" ? true : null), 30_000);
  const geo = await ctx.page.evaluate(() => {
    const g = window.__nefan.scene.terrain_grid;
    const vols = (window.__nefan.scene.__plan?.volumes ?? []).map((v) => v.id);
    return { ox: g.origin[0], oz: g.origin[1], mpc: g.meters_per_cell, vols, salto: window.__nefan.state().salto };
  });
  ctx.expect(
    "precondición: la escena está puesta con sus cuatro volúmenes, celdas de 0,5 m y el jugador en el suelo",
    geo.mpc === 0.5 && ESCENA.volumes.every((v) => geo.vols.includes(v.id)) && geo.salto?.fase === "suelo",
    JSON.stringify(geo),
  );
  if (geo.mpc !== 0.5) return;
  const X = (u) => geo.ox + u * geo.mpc;
  const Z = (v) => geo.oz + v * geo.mpc;

  /** Sale a 20 cm de la cara SUR (`caraV`, celdas) mirando al norte, anda y,
   *  si `salta`, pide el salto en el mismo instante. «Cruzado» = el cuerpo
   *  entero pasada la cara NORTE (`norteV`). Vigila la elevación máxima. */
  async function carrera({ u, caraV, norteV, salta, debe, aserto }) {
    const desde = { x: X(u), z: Z(caraV) + RADIO + 0.2 };
    const lim = Z(norteV) - RADIO;
    await ctx.nefan("setPlayerPos", desde.x, desde.z);
    await ctx.nefan("setYaw", Math.PI); // yaw 0 = +z (sur): π mira al norte
    await frames(ctx);
    await ctx.page.evaluate((s) => {
      window.__elevMax = 0;
      const d = window.__nefan.inputDriver;
      d.press("up");
      if (s) d.queueJump();
    }, salta);
    const { ocurrio } = await ctx.expectEspera(
      aserto,
      debe,
      (l) => {
        const st = window.__nefan.state();
        window.__elevMax = Math.max(window.__elevMax, st.salto.elevacion);
        return st.pos.z < l ? { z: st.pos.z } : null;
      },
      { sim: 3, arg: lim, tecla: "up", aserto },
    );
    // Que aterrice antes de medir dónde acabó.
    await ctx.waitFor("el jugador vuelve al suelo", () => (window.__nefan.state().salto.fase === "suelo" ? true : null), { sim: 2 });
    const fin = await ctx.page.evaluate(() => ({ z: window.__nefan.state().pos.z, elevMax: window.__elevMax }));
    ctx.log(`${aserto}: z ${desde.z.toFixed(2)} → ${fin.z.toFixed(2)} (cruzar < ${lim.toFixed(2)}) · elevación máx ${fin.elevMax.toFixed(3)} m · ocurrió=${ocurrio}`);
    return { ocurrio, ...fin };
  }

  // ── 1 · La valla (1 m): sin saltar frena, saltando se cruza ──────────────
  const vallaSin = await carrera({ u: 25, caraV: 41.5, norteV: 38.5, salta: false, debe: false, aserto: "control: la valla SIN saltar NO se cruza" });
  ctx.expect("control: sin saltar no se despega (elevación 0)", vallaSin.elevMax === 0, `${vallaSin.elevMax}`);
  const vallaCon = await carrera({ u: 25, caraV: 41.5, norteV: 38.5, salta: true, debe: true, aserto: "la valla (1 m) SALTANDO se cruza entera" });
  ctx.expect(
    "el salto sube de verdad la cámara: la elevación llega al apogeo (0,75 < máx ≤ 0,8 m, `SALTO_APOGEO_M`)",
    vallaCon.elevMax > 0.75 && vallaCon.elevMax <= 0.8 + 1e-9,
    `${vallaCon.elevMax.toFixed(3)} m`,
  );

  // ── 2 · El muro (2,5 m) y el río: saltando tampoco ───────────────────────
  await carrera({ u: 65, caraV: 41.5, norteV: 38.5, salta: true, debe: false, aserto: "el muro (2,5 m) SALTANDO NO se cruza" });
  await carrera({ u: 105, caraV: 42, norteV: 36, salta: true, debe: false, aserto: "el río SALTANDO NO se cruza" });

  /** Inclina la mirada con las flechas, paso a paso (15° por pulsación, como
   *  el jugador): calcado del 350. */
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
      await frames(ctx);
    }
  }

  // ── 3 · Fotos para la crítica visual: en el aire sobre la valla, y bajo el
  // dintel del portón en el apogeo. ─────────────────────────────────────────
  async function fotoEnElAire(nombre, pos, yaw, andando, pitch = 0) {
    await ctx.nefan("setPlayerPos", pos.x, pos.z);
    await ctx.nefan("setYaw", yaw);
    await mirar(pitch);
    await frames(ctx);
    await ctx.page.evaluate((a) => {
      const d = window.__nefan.inputDriver;
      if (a) d.press("up");
      d.queueJump();
    }, andando);
    const e = await ctx.waitFor(
      `${nombre}: el jugador sube por encima de 0,6 m`,
      () => {
        const s = window.__nefan.state().salto;
        return s.fase === "aire" && s.elevacion > 0.6 ? s.elevacion : null;
      },
      { sim: 1 },
    );
    await ctx.shot(nombre);
    const tras = (await ctx.nefan("state")).salto;
    await ctx.nefan("inputDriver.releaseAll");
    ctx.log(`${nombre}: elevación ${e.toFixed(2)} m antes de la foto, ${tras.elevacion.toFixed(2)} (${tras.fase}) después`);
    await ctx.waitFor("vuelve al suelo", () => (window.__nefan.state().salto.fase === "suelo" ? true : null), { sim: 2 });
    await mirar(0);
  }
  // Mirando abajo: con los ojos a 2,4 m, una valla de 1 m a menos de dos
  // metros cae por debajo del encuadre horizontal.
  await fotoEnElAire("saltando-la-valla-mirando-abajo", { x: X(25), z: Z(41.5) + RADIO + 0.2 }, Math.PI, true, -75);
  await fotoEnElAire("saltando-ante-el-porton", { x: X(64), z: Z(96) }, Math.PI, false);
  await fotoEnElAire("saltando-bajo-el-dintel", { x: X(64), z: Z(90) }, Math.PI, false);
  await fotoEnElAire("saltando-bajo-el-dintel-mirando-arriba", { x: X(64), z: Z(90) }, Math.PI, false, 45);

  // ── 4 · Y el portón se sigue cruzando saltando: las jambas quedan, el vano no.
  await carrera({ u: 64, caraV: 92.5, norteV: 87.5, salta: true, debe: true, aserto: "control: por el vano del portón se pasa también saltando" });
  await carrera({ u: 20, caraV: 91.5, norteV: 88.5, salta: true, debe: false, aserto: "la muralla (2,5 m) al lado del portón SALTANDO NO se cruza" });
}
