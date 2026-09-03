/** Lo que el motor pone a mitad de conversación se llama por su NOMBRE, y su
 *  `description` es la procedencia — con ella se pinta, sin ella no se
 *  inventa (#397).
 *
 *  Hasta esta tanda `spawn_entity` decía lo contrario que `generate_scene`:
 *  `description` obligatoria y `name` opcional «para NPCs», y el cliente
 *  rotulaba con `effect.name ?? effect.description ?? effect.entityId`. Un
 *  edificio spawneado sin `name` se rotulaba con su descripción larga, y uno
 *  spawneado sin `description` se pintaba con un texto que nadie escribió:
 *  «an entity» en vivo (`consequence-handler.ts`) y su id tras reanudar
 *  (`spawnsDeRuntime`). La decisión escrita en el issue y ya vigente en la
 *  escena (#238) es «`name` es la etiqueta, `description` es la PROCEDENCIA»,
 *  y desde esta tanda las dos puertas comparten el vocabulario.
 *
 *  Lo que se mide es lo que ve quien juega, sobre el motor falso (cero
 *  créditos), que en el turno 3 pone un NPC, un objeto y un edificio CON
 *  procedencia (Nogala, el cofre, la forja) y en el turno 4 un NPC y un
 *  objeto SIN ella (Mochuelo, el farol):
 *
 *   1 · EN VIVO: el rótulo de los cinco es su `name`; a Nogala se la pinta con
 *       su `description` (el prompt del skin ES la procedencia); a Mochuelo,
 *       que no la trae, se le pinta con su nombre — no con «an entity».
 *   2 · EL LEDGER: `GET /entity/{id}` del State API (el cable de las tools
 *       MCP) conserva las dos en `data` para Nogala y solo `name` para
 *       Mochuelo — el save no inventa una procedencia.
 *   3 · TRAS REANUDAR: los cinco vuelven con el mismo rótulo, Nogala con su
 *       procedencia y Mochuelo con su nombre — no con su id.
 *   4 · Y el ledger dice lo mismo después de volver del disco.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; los spawns los pone
 *  `labs/narrative/fake-ai-server.ts`.
 *
 *  Nació ROJO sobre `4ca0c50` (medido el 2026-09-03, con el turno 4 del motor
 *  falso y `skinPrompt` en `__nefan.npcs()`, que son infraestructura de
 *  medida): «a Mochuelo, sin procedencia, se le pinta con su NOMBRE» —
 *  `skinPrompt "an entity"`— y, tras reanudar, `skinPrompt "narr_npc_…"`. El
 *  resto era verde ya: los rótulos salían de `name` cuando venía, y el ledger
 *  conservaba las dos desde #326.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";
import { URLS } from "../lib/stack.mjs";

/** El motor falso es determinista POR TURNO de diálogo: saves vírgenes y el
 *  contador a cero. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const TABERNERO = "barkeep";
const HOSTIL = "Secuaz";

/** Lo que el motor falso declara, tal cual (`fake-ai-server.ts`, turnos 3 y 4). */
const CON_PROCEDENCIA = {
  npc: { name: "Nogala", description: "posadera de manos grandes y delantal remendado" },
  objeto: { name: "Cofre de la posada", description: "cofre de roble con herrajes de hierro" },
  edificio: { name: "Forja de Robledo", description: "forja de piedra ennegrecida por el humo" },
};
const SIN_PROCEDENCIA = {
  npc: { name: "Mochuelo" },
  objeto: { name: "Farol del zaguán" },
};

/** Lo que el cliente tiene en escena AHORA: rótulo y prompt de skin por nombre. */
const mundo = (ctx) =>
  ctx.page.evaluate(() => ({
    npcs: window.__nefan.npcs().map((n) => ({ id: n.id, label: n.label, skinPrompt: n.skinPrompt })),
    objetos: window.__nefan.objects().map((o) => ({ id: o.id, label: o.label })),
  }));

const porRotulo = (lista, name) => lista.find((x) => x.label === name) ?? null;

/** La ficha del ledger por el cable de las tools (`entity_get`). */
async function fichaDelLedger(id) {
  const res = await fetch(`${URLS.state_api}/entity/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`State API /entity/${id}: HTTP ${res.status}`);
  return res.json();
}

/** Espera a que los cinco estén en escena y devuelve el mundo. */
const esperarLosCinco = (ctx, etiqueta) =>
  ctx.waitFor(
    `los cinco de runtime están en escena (${etiqueta})`,
    (n) => {
      const npcs = window.__nefan.npcs();
      const objetos = window.__nefan.objects();
      const hay = (lista, name) => lista.some((x) => x.label === name);
      return hay(npcs, n.nogala) && hay(npcs, n.mochuelo) && hay(objetos, n.cofre) && hay(objetos, n.forja) && hay(objetos, n.farol)
        ? true
        : null;
    },
    90_000,
    {
      nogala: CON_PROCEDENCIA.npc.name,
      mochuelo: SIN_PROCEDENCIA.npc.name,
      cofre: CON_PROCEDENCIA.objeto.name,
      forja: CON_PROCEDENCIA.edificio.name,
      farol: SIN_PROCEDENCIA.objeto.name,
    },
  );

/** Los asertos de lo que el jugador VE, repetidos tal cual en vivo y tras
 *  reanudar: si divergieran, la divergencia sería el hallazgo. */
function afirmarLoQueSeVe(ctx, m, etiqueta) {
  const nogala = porRotulo(m.npcs, CON_PROCEDENCIA.npc.name);
  const mochuelo = porRotulo(m.npcs, SIN_PROCEDENCIA.npc.name);
  const cofre = porRotulo(m.objetos, CON_PROCEDENCIA.objeto.name);
  const forja = porRotulo(m.objetos, CON_PROCEDENCIA.edificio.name);
  const farol = porRotulo(m.objetos, SIN_PROCEDENCIA.objeto.name);
  ctx.expect(
    `#397 · los cinco se rotulan por su \`name\`, con y sin procedencia (${etiqueta})`,
    Boolean(nogala && mochuelo && cofre && forja && farol),
    JSON.stringify({ npcs: m.npcs.map((n) => n.label), objetos: m.objetos.map((o) => o.label) }),
  );
  ctx.expect(
    `#397 · ningún rótulo es una descripción: la procedencia no se rotula (${etiqueta})`,
    ![...m.npcs, ...m.objetos].some((x) =>
      [CON_PROCEDENCIA.npc, CON_PROCEDENCIA.objeto, CON_PROCEDENCIA.edificio].some((d) => x.label === d.description),
    ),
    JSON.stringify([...m.npcs, ...m.objetos].map((x) => x.label)),
  );
  ctx.expect(
    `#397 · a Nogala se la pinta con su \`description\`: la procedencia es el prompt del skin (${etiqueta})`,
    nogala?.skinPrompt === CON_PROCEDENCIA.npc.description,
    `skinPrompt ${JSON.stringify(nogala?.skinPrompt)}`,
  );
  ctx.expect(
    `#397 · a Mochuelo, sin procedencia, se le pinta con su NOMBRE — nadie inventa «an entity» ni su id (${etiqueta})`,
    mochuelo?.skinPrompt === SIN_PROCEDENCIA.npc.name,
    `skinPrompt ${JSON.stringify(mochuelo?.skinPrompt)} (id ${JSON.stringify(mochuelo?.id)})`,
  );
  return { nogala, mochuelo };
}

/** Los asertos del ledger, repetidos antes y después de volver del disco. */
async function afirmarElLedger(ctx, ids, etiqueta) {
  const nogala = await fichaDelLedger(ids.nogala);
  const mochuelo = await fichaDelLedger(ids.mochuelo);
  ctx.log(`ledger (${etiqueta}): Nogala data=${JSON.stringify(nogala.data)} · Mochuelo data=${JSON.stringify(mochuelo.data)}`);
  ctx.expect(
    `#397 · el ledger conserva \`name\` Y \`description\` de Nogala sin pisarse (${etiqueta})`,
    nogala.data?.name === CON_PROCEDENCIA.npc.name && nogala.data?.description === CON_PROCEDENCIA.npc.description,
    JSON.stringify(nogala.data),
  );
  ctx.expect(
    `#397 · el ledger de Mochuelo lleva su \`name\` y NO le inventa una \`description\` (${etiqueta})`,
    mochuelo.data?.name === SIN_PROCEDENCIA.npc.name && !("description" in (mochuelo.data ?? {})),
    JSON.stringify(mochuelo.data),
  );
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);

  // ── 0 · El motor puebla el mundo a mitad de conversación (turnos 2, 3 y 4) ─
  await ctx.waitFor(
    "el tabernero está en escena para hablar con él",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    TABERNERO,
  );
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);

  await ctx.nefan("chooseDialogue", 0);
  await ctx.waitFor(
    `el motor materializa a "${HOSTIL}" (turno 2)`,
    (n) => window.__nefan.enemies().find((e) => e.label === n) ?? null,
    90_000,
    HOSTIL,
  );
  await ctx.nefan("chooseDialogue", 0);
  await ctx.waitFor(
    "el motor materializa npc + objeto + edificio con procedencia (turno 3)",
    (n) =>
      window.__nefan.npcs().some((x) => x.label === n.npc) &&
      window.__nefan.objects().some((o) => o.label === n.objeto) &&
      window.__nefan.objects().some((o) => o.label === n.edificio)
        ? true
        : null,
    90_000,
    { npc: CON_PROCEDENCIA.npc.name, objeto: CON_PROCEDENCIA.objeto.name, edificio: CON_PROCEDENCIA.edificio.name },
  );
  await ctx.nefan("chooseDialogue", 0);
  await esperarLosCinco(ctx, "turno 4");
  await ctx.nefan("advanceDialogue");
  await ctx.expectEspera(
    "la conversación se cierra",
    true,
    () => (window.__nefan.dialogueVisible ? null : true),
    { ms: 15_000 },
  );

  // ── 1 · EN VIVO: rótulo = name; skin = description o, sin ella, name ─────
  const vivo = await mundo(ctx);
  ctx.log(`en vivo: ${JSON.stringify(vivo)}`);
  const { nogala, mochuelo } = afirmarLoQueSeVe(ctx, vivo, "en vivo");
  await ctx.shot("los-cinco-en-vivo");
  if (!nogala || !mochuelo) return ctx.sinMedirBloque("sin Nogala y Mochuelo en el cliente no hay ledger que leer");
  const ids = { nogala: nogala.id, mochuelo: mochuelo.id };

  // ── 2 · EL LEDGER, con la partida viva ───────────────────────────────────
  await afirmarElLedger(ctx, ids, "partida viva");

  // ── 3 · TRAS REANUDAR: lo mismo que se veía, y con los mismos ids ────────
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) return;
  await esperarLosCinco(ctx, "tras reanudar");
  const reanudado = await mundo(ctx);
  ctx.log(`tras reanudar: ${JSON.stringify(reanudado)}`);
  const trasResume = afirmarLoQueSeVe(ctx, reanudado, "tras reanudar");
  ctx.expect(
    "#397 · los rehidratados son los MISMOS (id a id), no copias con otro nombre",
    trasResume.nogala?.id === ids.nogala && trasResume.mochuelo?.id === ids.mochuelo,
    JSON.stringify({ antes: ids, despues: { nogala: trasResume.nogala?.id, mochuelo: trasResume.mochuelo?.id } }),
  );
  await ctx.shot("los-cinco-tras-reanudar");

  // ── 4 · Y EL LEDGER tras volver del disco ────────────────────────────────
  await afirmarElLedger(ctx, ids, "tras reanudar");
  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
