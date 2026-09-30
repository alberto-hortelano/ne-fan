/** Tanda BT, visto por quien juega: por un portón en un muro NORTE-SUR se pasa,
 *  a un cutaway se entra por sus puertas `n`, `w` y `e`, y contra el muro que
 *  acaba en campo abierto se llega hasta donde se VE acabar.
 *
 *  POR QUÉ ESTA PUERTA. Ninguna escena viva trae lo que la tanda afirma: las
 *  tres fixtures del selector «Room» no llevan ningún `gate` y su único
 *  cutaway (`zorder_test`, la cabaña) solo tiene puerta `s`; el motor falso
 *  sirve un `gate` `orient:"x"` y una taberna con puerta `s`. Un portón en `y`
 *  o una puerta `n/w/e` de cutaway solo los puede declarar el motor real. Así
 *  que la escena entra por `loadSceneRaw`, la MISMA puerta que el selector
 *  «Room» (`load_room` al bridge: el sim colisiona con `planCollisionGrid`
 *  sobre el plan, igual que en partida), como los guiones 79 y 150. Es un
 *  WORKAROUND declarado en `docs/agents/2026-09-30-tanda-bt-los-volumenes-sin-ejercer/qa.md`:
 *  el jugador no puede llegar a este tile por el flujo normal hoy, y eso es un
 *  hecho del bench, no del juego.
 *
 *  Todo se ANDA (tecla de avance, sim del bridge), nada se teletransporta a la
 *  meta. Cada «se pasa» tiene su control «por el muro de al lado no se pasa»:
 *  sin él, un collider vacío daría los tres verdes.
 *
 *  §4 — la tapa de `markBand`. `volumeCollisionGrid` marcaba un muro como las
 *  celdas a ≤ width/2 de su trazo, lo que incluía un semicírculo de radio
 *  width/2 MÁS ALLÁ de cada extremo, mientras el greybox (`wallPrims`) corta
 *  los tramos en seco en [0, len]: con `width` 12 (el máximo del zod), 3 m de
 *  muro invisible en cada punta (H1 del QA de la tanda BT, medido aquí mismo
 *  cuando era agujero conocido: 2,93–3,07 m). Arreglado en la misma tanda: la
 *  banda acaba en seco en las PUNTAS LIBRES y conserva la tapa en los vértices
 *  compartidos. Se MIDE andando contra la punta y contra el costado (el
 *  costado da el radio del cuerpo, que se descuenta): el muro invisible que
 *  queda tiene que ser ≈ 0.
 *
 *  Probado en negativo (qa.md): con el `case "n"` de `markBuilding` borrado, o
 *  la rama `y` de `clearGatePassage` sin limpiar, el bloque correspondiente
 *  sale rojo; con la tapa de vuelta en las puntas libres, el §4 sale rojo.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, modo maqueta (clay).
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["fake-ai"];

const frames = esperaDeFotogramas("mundo");

/** Tile (0,0) de pruebas, Format D. Celdas de 0,5 m; x = −32 + u·0,5. */
const ESCENA = {
  scene_id: "qa330",
  scene_description: "Banco de QA de la tanda BT: portón en muro norte-sur, cutaway con puertas n/w/e y un muro que acaba en campo abierto.",
  tile: { tx: 0, ty: 0 },
  biome: "grass",
  ground: [],
  volumes: [
    { id: "muro_ns", label: "muralla norte-sur", type: "wall", points: [[30, 10], [30, 118]], width: 3, h: 6 },
    { id: "porton_y", label: "portón", type: "gate", at: [30, 64], w: 8, h: 8, orient: "y" },
    {
      id: "casa_abierta", label: "casa abierta", type: "building", rect: [56, 30, 24, 18], cutaway: true,
      doors: [{ edge: "n", at: 4, w: 4 }, { edge: "w", at: 6, w: 4 }, { edge: "e", at: 8, w: 4 }],
    },
    { id: "muro_grueso", label: "muro grueso", type: "wall", points: [[70, 90], [100, 90]], width: 12, h: 5 },
  ],
  entities: [{ id: "player", kind: "player", name: "Tú", cell: [10, 10], footprint: [1, 1] }],
};

const YAW = { sur: 0, este: Math.PI / 2, norte: Math.PI, oeste: -Math.PI / 2 };

/** Anda desde `desde` con `yaw` hasta que `meta(pos)` se cumple o se agota el
 *  presupuesto. El signo (debe / no debe) es dato del llamante y se AFIRMA con
 *  `expectEspera`: en el negativo el timeout ES el éxito. */
async function andar(ctx, { desde, yaw, eje, signo, meta, debe, aserto }) {
  await ctx.nefan("setPlayerPos", desde.x, desde.z);
  await ctx.nefan("setYaw", yaw);
  await frames(ctx);
  const { ocurrio } = await ctx.expectEspera(
    aserto,
    debe,
    (a) => {
      const p = window.__nefan.state().pos;
      const v = a.eje === "x" ? p.x : p.z;
      return a.signo * v >= a.signo * a.meta ? { x: p.x, z: p.z } : null;
    },
    { sim: 8, arg: { eje, signo, meta }, tecla: "up", aserto },
  );
  const fin = (await ctx.nefan("state")).pos;
  ctx.log(`${aserto}: (${desde.x.toFixed(2)}, ${desde.z.toFixed(2)}) → (${fin.x.toFixed(2)}, ${fin.z.toFixed(2)}) · meta ${eje}${signo > 0 ? "≥" : "≤"}${meta.toFixed(2)} · ocurrió=${ocurrio}`);
  return { ocurrio, fin };
}

export default async function (ctx) {
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  await ctx.nefan("loadSceneRaw", ESCENA);
  await ctx.waitFor("el tile del guion está pintado", () => (window.__nefan.scene?.scene_id === "qa330" ? true : null), 30_000);
  const geo = await ctx.page.evaluate(() => {
    const g = window.__nefan.scene.terrain_grid;
    const vols = (window.__nefan.scene.__plan?.volumes ?? []).map((v) => v.id);
    return { ox: g.origin[0], oz: g.origin[1], mpc: g.meters_per_cell, vols };
  });
  ctx.expect(
    "precondición: la escena del guion está puesta con sus cuatro volúmenes y celdas de 0,5 m",
    geo.mpc === 0.5 && ["muro_ns", "porton_y", "casa_abierta", "muro_grueso"].every((id) => geo.vols.includes(id)),
    JSON.stringify(geo),
  );
  if (geo.mpc !== 0.5) return;
  const X = (u) => geo.ox + u * geo.mpc;
  const Z = (v) => geo.oz + v * geo.mpc;

  // ── 1 · Portón `orient:"y"`: el muro corre norte-sur y se cruza hacia el este
  await andar(ctx, {
    desde: { x: X(22), z: Z(64) }, yaw: YAW.este, eje: "x", signo: 1, meta: X(38), debe: true,
    aserto: "se CRUZA el muro norte-sur por el vano del portón en `y`",
  });
  await ctx.nefan("setPlayerPos", X(22), Z(64));
  await ctx.nefan("setYaw", YAW.este);
  await frames(ctx);
  await ctx.shot("porton-en-y-desde-el-oeste");
  await andar(ctx, {
    desde: { x: X(22), z: Z(40) }, yaw: YAW.este, eje: "x", signo: 1, meta: X(38), debe: false,
    aserto: "control: 12 m al norte del portón el mismo muro NO se cruza",
  });

  // ── 2 · Cutaway: se entra por n, w y e; por el sur (sin puerta) no ─────
  const puertas = [
    { edge: "n", desde: { x: X(62), z: Z(24) }, yaw: YAW.sur, eje: "z", signo: 1, meta: Z(36) },
    { edge: "w", desde: { x: X(50), z: Z(38) }, yaw: YAW.este, eje: "x", signo: 1, meta: X(62) },
    { edge: "e", desde: { x: X(86), z: Z(40) }, yaw: YAW.oeste, eje: "x", signo: -1, meta: X(74) },
  ];
  for (const p of puertas) {
    await andar(ctx, { ...p, debe: true, aserto: `se ENTRA en el cutaway por su puerta \`${p.edge}\`` });
    await frames(ctx);
    await ctx.shot(`dentro-por-la-puerta-${p.edge}`);
  }
  await andar(ctx, {
    desde: { x: X(68), z: Z(54) }, yaw: YAW.norte, eje: "z", signo: -1, meta: Z(42), debe: false,
    aserto: "control: por el muro sur del cutaway, que no tiene puerta, NO se entra",
  });

  // ── 3 (§4) · El muro grueso que acaba en campo abierto ──────────────────
  // Costado: el muro pintado llega a v=96 (width 12, eje en v=90). Andando al
  // norte contra él, el jugador para a `radio` de la cara: eso MIDE el radio.
  const costado = await andar(ctx, {
    desde: { x: X(85), z: Z(106) }, yaw: YAW.norte, eje: "z", signo: -1, meta: Z(95), debe: false,
    aserto: "control: contra el COSTADO del muro grueso el jugador se para (no lo atraviesa)",
  });
  const radio = costado.fin.z - Z(96);
  // Punta: el muro pintado acaba en u=100. Andando al oeste por su eje.
  const punta = await andar(ctx, {
    desde: { x: X(118), z: Z(90) }, yaw: YAW.oeste, eje: "x", signo: -1, meta: X(99), debe: false,
    aserto: "control: contra la PUNTA del muro grueso el jugador se para",
  });
  const hueco = punta.fin.x - X(100) - radio;
  ctx.log(`§4: radio del cuerpo medido en el costado ${radio.toFixed(2)} m · parada ante la punta a ${(punta.fin.x - X(100)).toFixed(2)} m de lo pintado · muro invisible ${hueco.toFixed(2)} m`);
  ctx.expect(
    "precondición §4: el costado frena a una distancia de cuerpo (0 < radio < 1 m)",
    radio > 0 && radio < 1,
    `${radio.toFixed(3)} m`,
  );
  await ctx.nefan("setYaw", YAW.oeste);
  await frames(ctx);
  await ctx.shot("parado-ante-la-punta-del-muro-grueso");
  // Era el AGUJERO CONOCIDO H1 (≈3 m de muro invisible): markBand ya no pone
  // tapa en las puntas libres. Queda la holgura de la rejilla y la medida.
  ctx.expect(
    "se llega hasta la punta VISIBLE de un muro de width 12: sin muro invisible delante (|hueco| < 0,3 m)",
    Math.abs(hueco) < 0.3,
    `${hueco.toFixed(2)} m`,
  );
}
