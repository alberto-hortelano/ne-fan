/** ¿EL ALDEANO RODEA POR DENTRO DEL MUNDO, O SE SALE A LA «ZONA SIN GENERAR»? (#618 — QA de la tanda BO)
 *
 *  POR QUÉ EXISTE. El A* de la tanda BO busca en una ventana de 3×3 tiles y
 *  un tile SIN REALIZAR no aporta colisiones: cuenta libre, igual que para el
 *  paso (`implementacion.md`, «Qué NO queda cubierto»). Lo que no decía nadie
 *  es que el buscador lo APROVECHA: si una banda sólida cruza el tile de lado a
 *  lado —una muralla, un río—, el camino más corto pasa POR FUERA del tile,
 *  rodeando su extremo sobre la llanura de arena de «Zona sin generar», donde
 *  el jugador no puede entrar sin aceptar «¿Explorar…?». Medido en scratch
 *  (QA de BO) sobre 300 pares libres al azar: 21 rutas de robledo (7 %) y 136
 *  de puerto (45 %) salen del tile. El steering de antes no apuntaba ahí.
 *
 *  El tile que sirve el motor falso tiene esa banda: una muralla de tres filas
 *  de lado a lado con un portillo en el centro. Esto es el juego entero desde
 *  el arranque, por los canales del motor (`map_upsert_place` +
 *  `npc_set_directive`), y la posición que el jugador VE (`__nefan.npcs()`).
 *
 *   1 · Se localiza la banda EN LA ESCENA SERVIDA (sin coordenadas escritas a
 *       mano): la fila del tile sólida en ≥ 80 % de su ancho. Dos puntos libres
 *       a 5 m a cada lado, a 3 m del borde oeste. CONTROL: la recta entre ellos
 *       pisa la banda, y el portillo está lejos (rodear por dentro es largo).
 *   2 · El tabernero va al primero (CONTROL: llega sin salir del tile).
 *   3 · Luego al segundo. AFIRMA: ningún punto de su traza sale del
 *       `world_rect` del tile. Llegue o no, se fotografía donde está.
 *
 *  NACIÓ ROJO sobre `d0d1903b`: el tabernero rodea la punta oeste de la
 *  muralla por x ≈ −32,7 (fuera del tile, sobre la arena) y la captura lo
 *  enseña de pie en la «Zona sin generar».
 *
 *  VERDE desde la 2ª vuelta de BO: para PLANIFICAR, un tile sin generar es
 *  sólido (`buscarRuta` en `bridge/sim-collision.ts`); el tabernero cruza por
 *  el portillo.
 *
 *  PROBADO EN POSITIVO (QA de BO, sabotaje de una línea restaurado con
 *  `md5sum -c`): con `buscarRuta` de `bridge/sim-collision.ts` viendo sólido
 *  todo lo que cae fuera del tile (0,0), el tabernero cruza por el portillo,
 *  llega en < 90 s y el guion sale VERDE. El 3 mide la ruta, no el aserto.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, Maqueta 3D.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

/** El mapa se MUTA (lugares nuevos) y la directiva se escribe en el save. */
export const aisla = ["saves", "fake-ai"];

const NPC = "barkeep";
const MPC = 0.5;
const LLEGADA_M = 1.5 + 0.3;
const PRESUPUESTO_S = 90;
/** A cuánto de la banda, por cada lado, y a cuánto del borde oeste. */
const A_LA_BANDA_M = 5;
const DEL_BORDE_M = 3;

async function api(method, path, body) {
  const res = await fetch(`${URLS.state_api}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status };
}

/** La banda que cruza el tile, y los dos puntos a sus lados junto al borde
 *  oeste. Todo de la escena servida, con la consulta de PUNTO. */
function laBanda(a) {
  const n = window.__nefan;
  const r = n.scene.world_rect;
  let banda = null;
  for (let z = r.minZ + 1; z < r.maxZ - 1 && !banda; z += a.mpc) {
    let solidos = 0, total = 0, hueco = null;
    for (let x = r.minX + 0.25; x < r.maxX; x += a.mpc) {
      total++;
      if (n.probePoint(x, z)) solidos++;
      else if (hueco === null) hueco = x;
    }
    if (solidos / total >= 0.8) banda = { z, hueco, fraccion: solidos / total };
  }
  if (!banda) return { banda: null };
  const x = r.minX + a.borde;
  const antes = { x, z: banda.z - a.lado };
  const despues = { x, z: banda.z + a.lado };
  let cruza = 0;
  for (let k = 0; k <= 40; k++) if (n.probePoint(x, antes.z + ((despues.z - antes.z) * k) / 40)) cruza++;
  return { banda, rect: r, antes, despues, cruza, libres: !n.probePoint(antes.x, antes.z) && !n.probePoint(despues.x, despues.z) };
}

/** Manda al NPC a `p` por los canales del motor y espera por ESTADO a que
 *  llegue, acumulando la traza que ve el jugador. */
async function irA(ctx, lugar, p, etiqueta, foto = false) {
  const rect = [Math.round((p.x + 32) / MPC) - 1, Math.round((p.z + 32) / MPC) - 1, 2, 2];
  const alta = await api("POST", "/map/place", { id: lugar, kind: "landmark", parent_id: null, name: etiqueta, anchor: { tx: 0, ty: 0, rect } });
  const orden = await api("POST", `/npc/${NPC}/directive`, { directive: { type: "goto_place", target_place_id: lugar } });
  ctx.expect(`el motor ancla «${etiqueta}» y da la directiva`, alta.status === 200 && orden.status === 200, `${alta.status} · ${orden.status}`);
  await ctx.page.evaluate(() => { window.__qa272 = { traza: [] }; });
  if (foto) {
    // Cortafuegos de la FOTO, no de la medida: se para en cuanto el NPC pisa
    // fuera del tile (o llega), para que la captura lo enseñe donde está. Lo
    // que se afirma lo afirma la espera de abajo sobre la traza entera.
    await ctx.absorbe("cortafuegos de la foto: la medida es la traza de la espera siguiente", () =>
      ctx.waitFor("el tabernero sale del tile o llega", (a) => {
        const n = window.__nefan;
        const v = n.npcs().find((x) => x.id === a.id);
        if (!v) return null;
        const r = n.scene.world_rect;
        window.__qa272.traza.push({ x: v.pos.x, z: v.pos.z });
        const fueraDelTile = v.pos.x < r.minX - 0.3 || v.pos.x > r.maxX + 0.3 || v.pos.z < r.minZ - 0.3 || v.pos.z > r.maxZ + 0.3;
        return fueraDelTile || Math.hypot(v.pos.x - a.p.x, v.pos.z - a.p.z) <= a.llegada ? true : null;
      }, { sim: PRESUPUESTO_S }, { id: NPC, p, llegada: LLEGADA_M }));
    await ctx.shot(`${lugar}-donde-rodea`);
  }
  const espera = await ctx.expectEspera(`el tabernero llega a «${etiqueta}»`, true, (a) => {
    const v = window.__nefan.npcs().find((x) => x.id === a.id);
    if (!v) return null;
    window.__qa272.traza.push({ x: v.pos.x, z: v.pos.z });
    return Math.hypot(v.pos.x - a.p.x, v.pos.z - a.p.z) <= a.llegada ? true : null;
  }, { sim: PRESUPUESTO_S, arg: { id: NPC, p, llegada: LLEGADA_M }, aserto: `«${etiqueta}»: llega en ≤ ${PRESUPUESTO_S} s de juego` });
  const traza = await ctx.page.evaluate(() => window.__qa272.traza);
  return { llego: espera.ocurrio, traza };
}

const fuera = (p, r) => p.x < r.minX || p.x > r.maxX || p.z < r.minZ || p.z > r.maxZ;

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  await ctx.waitFor("el tabernero está en escena", (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null, 60_000, NPC);

  // ── 1 · La banda ─────────────────────────────────────────────────────────
  const b = await ctx.page.evaluate(laBanda, { mpc: MPC, lado: A_LA_BANDA_M, borde: DEL_BORDE_M });
  if (!b.banda) ctx.sinMedir("el tile servido ya no tiene ninguna banda sólida de lado a lado: no hay nada que rodear por fuera");
  ctx.log(`banda en z ≈ ${b.banda.z} (${(b.banda.fraccion * 100).toFixed(0)} % sólida, primer hueco en x ≈ ${b.banda.hueco}); ` +
    `de (${b.antes.x}, ${b.antes.z}) a (${b.despues.x}, ${b.despues.z}), la recta pisa sólido en ${b.cruza} sondas`);
  ctx.expect("CONTROL: los dos puntos están libres y la recta entre ellos pisa la banda", b.libres && b.cruza > 0, JSON.stringify(b));
  ctx.expect("CONTROL: el hueco de la banda queda lejos (≥ 15 m): rodear por dentro es largo",
    Math.abs(b.banda.hueco - b.antes.x) >= 15, `hueco en x ≈ ${b.banda.hueco}`);

  // ── 2 · Al primer punto ─────────────────────────────────────────────────
  const ida = await irA(ctx, "qa272_antes", b.antes, "Junto a la muralla (guion 272)");
  const fueraIda = ida.traza.filter((p) => fuera(p, b.rect));
  ctx.expect("2 · CONTROL: llega junto a la muralla SIN salir del tile", ida.llego && fueraIda.length === 0,
    `${fueraIda.length} de ${ida.traza.length} muestras fuera`);

  // ── 3 · Al otro lado de la banda ────────────────────────────────────────
  // Cámara de bench (no afirma nada): el jugador dentro del tile, mirando al
  // extremo oeste de la banda, que es por donde pasaría el atajo.
  await ctx.page.evaluate(({ antes, rect, z }) => {
    const n = window.__nefan;
    const p = { x: antes.x + 7, z: antes.z + 1 };
    n.setPlayerPos(p.x, p.z);
    n.setYaw(Math.atan2(rect.minX - 1 - p.x, z - p.z));
  }, { antes: b.antes, rect: b.rect, z: b.banda.z });
  const vuelta = await irA(ctx, "qa272_despues", b.despues, "Al otro lado de la muralla (guion 272)", true);
  const fueraVuelta = vuelta.traza.filter((p) => fuera(p, b.rect));
  const peor = fueraVuelta.reduce((m, p) => Math.min(m, p.x - b.rect.minX), 0);
  ctx.expect("3 · el tabernero NO sale del tile a la «Zona sin generar» para rodear la muralla", fueraVuelta.length === 0,
    `${fueraVuelta.length} de ${vuelta.traza.length} muestras fuera del world_rect; hasta ${(-peor).toFixed(2)} m más allá del borde oeste`);
}
