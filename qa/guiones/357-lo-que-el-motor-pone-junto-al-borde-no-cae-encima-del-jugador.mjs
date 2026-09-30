/** LO QUE EL MOTOR PONE JUNTO AL BORDE NO CAE ENCIMA DEL JUGADOR (QA de la
 *  tanda CB).
 *
 *  La tanda CB acota el ANCLA de cada hint al tile para que nada caiga fuera
 *  (el 355 lo canda). Lo que ese acotado hace con el jugador no lo mide nadie:
 *  el ancla de `near_player` es «jugador + 5 m al norte», y si el jugador está
 *  a menos de `margen` del borde norte, el ancla se ACOTA DE VUELTA hacia él.
 *  El primer cuerpo del turno va a lateral 0 —cae en la misma x que el
 *  jugador—, así que con la Forja (4 m de caja, margen 3 m) el ancla queda en
 *  z = −29 y el jugador, a 2,5 m del borde (z = −29,5), está DENTRO de su caja.
 *
 *  Se reproduce igual que el 355 (mismo turno de la marca TURNO, mismo sitio,
 *  hablando con el tabernero) y se afirma lo que un jugador espera:
 *   · que la caja de ningún objeto del turno contenga el cuerpo del jugador
 *     (geometría con los `sizeXZ` que llegan al cliente, radio escrito a mano:
 *     es el oráculo);
 *   · que el punto donde está el jugador no sea sólido (`probePoint`, la
 *     consulta SIN origen);
 *   · que Nogala no aparezca solapando su cuerpo;
 *   · tras reanudar, lo mismo (el save guarda la forja donde cayó);
 *   · y tras reanudar, que un spawn nuevo sigue funcionando (el `tileIndex`
 *     del que depende el fail-loud nuevo se reconstruye en el load).
 *
 *  POR QUÉ `setPlayerPos` Y NO ANDAR: el diálogo congela al jugador, así que
 *  «hablar a 2,5 m del borde» exige que el tabernero esté allí; su paseo es
 *  aleatorio. El estado (jugador junto al borde con la conversación abierta)
 *  es alcanzable jugando: el 351 de BX lo alcanzó sin teletransporte cuando el
 *  tabernero había paseado al norte.
 *
 *  Cero créditos: preset `e2e-sin-creditos`.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["saves", "fake-ai"];

const esperarMundo = esperaDeFotogramas("mundo");
const GAME_ID = "alta_fantasia";
const TABERNERO = "barkeep";
const MARCA_TURNO = "LO QUE DECLARA EL MOTOR: TURNO";
const MARCA_BOLSA = "LO QUE DECLARA EL MOTOR: BOLSA";
const OBJETOS_DEL_TURNO = ["Forja del camino", "Carro de heno", "Bolsa de monedas"];
const PACIFICO = "Nogala";
/** Oráculos escritos a mano (no leídos del código bajo prueba). */
const RADIO_JUGADOR = 0.4;
const RADIO_NPC = 0.5;
/** A cuánto del borde norte habla el jugador: lo mismo que el 355. */
const DEL_BORDE_M = 2.5;

const panelPintado = (ctx) =>
  ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      const texto = document.getElementById("dialogue-text")?.textContent ?? "";
      return d.visible && botones > 0 && texto === d.text ? true : null;
    },
    60_000,
  );

async function escribirMarca(ctx, marca) {
  await panelPintado(ctx);
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    "T abre la caja de texto libre",
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  await ctx.page.keyboard.type(marca);
  await ctx.page.keyboard.press("Enter");
}

/** Metros entre el cuerpo del jugador y la caja de `o` (negativo = dentro). */
function holguraAlaCaja(p, o) {
  const hx = o.sizeXZ.x / 2;
  const hz = o.sizeXZ.z / 2;
  const dx = Math.max(Math.abs(p.x - o.pos.x) - hx, 0);
  const dz = Math.max(Math.abs(p.z - o.pos.z) - hz, 0);
  const fuera = Math.hypot(dx, dz);
  if (fuera > 0) return fuera - RADIO_JUGADOR;
  // Centro del jugador dentro de la caja: cuánto le falta para salir.
  return -(Math.min(hx - Math.abs(p.x - o.pos.x), hz - Math.abs(p.z - o.pos.z)) + RADIO_JUGADOR);
}

async function medirCuerpoDelJugador(ctx, etiqueta) {
  const m = await ctx.page.evaluate((nombres) => {
    const p = { ...window.__nefan.state().pos };
    return {
      p,
      solido: window.__nefan.probePoint(p.x, p.z),
      objetos: window.__nefan
        .objects()
        .filter((o) => nombres.includes(o.label))
        .map((o) => ({ label: o.label, pos: o.pos, sizeXZ: o.sizeXZ })),
      npcs: window.__nefan.npcs().map((n) => ({ label: n.label, pos: n.pos })),
    };
  }, OBJETOS_DEL_TURNO);
  ctx.log(`${etiqueta}: jugador ${JSON.stringify(m.p)} · ${JSON.stringify(m.objetos)}`);
  ctx.expect(
    `${etiqueta}: el cliente tiene los tres objetos del turno (si no, «nada encima» sería un verde vacío)`,
    m.objetos.length === OBJETOS_DEL_TURNO.length && m.objetos.every((o) => o.sizeXZ),
    JSON.stringify(m.objetos.map((o) => o.label)),
  );
  for (const o of m.objetos) {
    if (!o.sizeXZ) continue;
    const h = holguraAlaCaja(m.p, o);
    ctx.expect(
      `${etiqueta}: la caja de «${o.label}» no contiene el cuerpo del jugador`,
      h >= 0,
      `holgura ${h.toFixed(2)} m · jugador ${JSON.stringify(m.p)} · ${JSON.stringify(o)}`,
    );
  }
  ctx.expect(
    `${etiqueta}: el suelo bajo el jugador no es sólido`,
    m.solido === false,
    `probePoint(${m.p.x.toFixed(2)}, ${m.p.z.toFixed(2)}) = ${m.solido}`,
  );
  const nog = m.npcs.find((n) => n.label === PACIFICO);
  const d = nog ? Math.hypot(nog.pos.x - m.p.x, nog.pos.z - m.p.z) : NaN;
  ctx.expect(
    `${etiqueta}: ${PACIFICO} está y no aparece solapando al jugador`,
    d >= RADIO_JUGADOR + RADIO_NPC,
    nog ? `a ${d.toFixed(2)} m · ${JSON.stringify(nog.pos)}` : `${PACIFICO} no está en el cliente`,
  );
  return m;
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  const partida = await comenzar(ctx);

  await ctx.waitFor(
    "el tabernero está en escena",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    TABERNERO,
  );
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta", () => window.__nefan.dialogueVisible || null, 60_000);

  const rect = (await ctx.nefan("scene")).world_rect;
  const pos0 = await ctx.nefan("playerPos");
  await ctx.nefan("setPlayerPos", pos0.x, rect.minZ + DEL_BORDE_M);
  await esperarMundo(ctx, 10);
  const junto = await ctx.nefan("playerPos");
  ctx.expect(
    `precondición: el jugador habla a ${DEL_BORDE_M} m del borde norte`,
    Math.abs(junto.z - (rect.minZ + DEL_BORDE_M)) <= 0.3,
    JSON.stringify(junto),
  );

  await escribirMarca(ctx, MARCA_TURNO);
  await ctx.waitFor(
    `el motor materializa a "${PACIFICO}" y el resto del turno`,
    (n) => window.__nefan.npcs().find((x) => x.label === n) ?? null,
    90_000,
    PACIFICO,
  );
  await ctx.shot("turno-junto-al-borde");
  await medirCuerpoDelJugador(ctx, "recién puesto");

  // ── Reanudar: el save guarda lo que cayó donde cayó ─────────────────────
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) return;
  await ctx.waitFor(
    `${PACIFICO} vuelve con la partida`,
    (n) => window.__nefan.npcs().find((x) => x.label === n) ?? null,
    60_000,
    PACIFICO,
  );
  await ctx.shot("reanudada");
  await medirCuerpoDelJugador(ctx, "tras reanudar");

  // ── ¿Encerrado? Andar hacia el sur, lejos de la caja ─────────────────────
  // No es un aserto del requisito (128 ya dice «salir sí, entrar no»); es la
  // medida de la gravedad: si el jugador aparece dentro y NO puede salir, el
  // hallazgo es bloqueante.
  const desde = await ctx.page.evaluate(() => ({ ...window.__nefan.state().pos }));
  await ctx.nefan("setYaw", 0);
  await ctx.expectEspera(
    "el jugador puede salir andando de donde quedó (se aleja 2 m al sur)",
    true,
    (d) => {
      const p = window.__nefan.state().pos;
      return Math.hypot(p.x - d.x, p.z - d.z) >= 2 ? true : null;
    },
    { sim: 6, ms: 60_000, arg: desde, tecla: "up" },
  );

  // ── Rodear la fila del turno, andando ───────────────────────────────────
  // Desde la vuelta de H-1 lo que no cabe delante del jugador va DETRÁS: la
  // forja queda en su misma x, 5 m al sur, entre él y el tabernero. Quien
  // juega la rodea; `acercarse` camina en LÍNEA RECTA y se clavaba en su cara
  // (medido: 1 de 2 corridas, según dónde estuviera el tabernero). Así que se
  // rodea por el oeste, por donde el reparto deja solo a Nogala, hasta pasar
  // su media anchura con holgura. Andando: sin teletransporte.
  const forja = await ctx.page.evaluate(() => window.__nefan.objects().find((o) => o.label === "Forja del camino") ?? null);
  ctx.expect("la forja del turno sigue ahí para rodearla", Boolean(forja), "sin forja");
  if (forja) {
    await ctx.nefan("setYaw", -Math.PI / 2); // −x, oeste
    await ctx.expectEspera(
      "el jugador rodea la fila del turno por el oeste, andando",
      true,
      (a) => (window.__nefan.state().pos.x <= a.x ? true : null),
      { sim: 8, ms: 60_000, arg: { x: forja.pos.x - 7 }, tecla: "up" },
    );
  }

  // ── Tras reanudar, el motor puede seguir poniendo cosas ─────────────────
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta tras reanudar", () => window.__nefan.dialogueVisible || null, 60_000);
  const antes = await ctx.page.evaluate(() => window.__nefan.objects().filter((o) => o.label === "Bolsa de monedas").length);
  await escribirMarca(ctx, MARCA_BOLSA);
  await ctx.expectEspera(
    "tras reanudar, un spawn nuevo del motor se materializa (el despacho no lanza)",
    true,
    (n) => (window.__nefan.objects().filter((o) => o.label === "Bolsa de monedas").length > n ? true : null),
    { ms: 60_000, arg: antes },
  );
}
