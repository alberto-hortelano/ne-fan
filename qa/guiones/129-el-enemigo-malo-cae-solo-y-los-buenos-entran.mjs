/** UN ENEMIGO INVÁLIDO SE CAE SOLO ÉL, Y LOS DEMÁS ENTRAN (#529).
 *
 *  EL PROBLEMA, medido por QA en la PR 6 de #241 y dejado escrito como
 *  `⚠ HALLAZGO A3-bis` en el guion 90: «qué es un enemigo utilizable» lo dice
 *  UNA función de core (`parseHostileCombat`) a la que llaman las dos puertas,
 *  pero el DESENLACE era distinto en cada una. El cliente descartaba al malo y
 *  seguía; el bridge tiraba el FRAME ENTERO —los enemigos buenos del mismo lote
 *  incluidos— y le plantaba al jugador un modal a pantalla completa («Fallo
 *  interno del juego», `kind:"protocolo"`) que velaba la partida hasta que lo
 *  cerrara. Un solo veredicto con dos desenlaces, y mandaba el destructivo.
 *
 *  QUÉ AFIRMA ESTE GUION, y son las tres cosas A LA VEZ, porque por separado no
 *  distinguen una regla de su contraria:
 *
 *   A · **UNO MALO ENTRE DOS BUENOS**. El frame lleva tres; los dos válidos
 *       aparecen en el mundo del jugador y el inválido no. Un lote de un solo
 *       elemento daría el mismo resultado con la conducta VIEJA (el frame
 *       entero era ese enemigo), así que no mide nada: el segundo bueno va
 *       DETRÁS del malo a propósito, que es la posición que el descarte del
 *       lote se llevaba por delante.
 *   B · **EL MOTIVO LLEGA A LOS DOS CANALES**: al log del bridge con el id de
 *       quién y el motivo del parser VERBATIM, y al registro de errores del
 *       jugador. El mismo string en los dos sitios es lo único que hace verdad
 *       «un solo criterio».
 *   C · **SIN MODAL, y la partida sigue**: ni overlay de fallo, ni escena
 *       perdida — el jugador sigue andando con el mundo puesto.
 *
 *  CÓMO SE LLEGA AL ESTADO, sin tocar el cliente: el frame va por el SOCKET DEL
 *  JUEGO (un `addInitScript` guarda la instancia que el cliente abre, molde del
 *  85 y del 90), así que lo juzga el borde REAL con la sesión de esta partida,
 *  y el aviso vuelve a la página del jugador y no a un socket de laboratorio.
 *
 *  LO QUE ESTE GUION NO AFIRMA: el criterio en sí (qué bloque `combat` vale).
 *  Eso es del guion 90 y de `test/hostil-desde-combat.test.ts`; aquí el bloque
 *  roto es un medio, no el sujeto. Y tampoco mide el camino por el que un
 *  bloque roto le llega HOY a un jugador de verdad —no hay ninguno: el motor
 *  no escribe esos números, los deriva `combatForHostileRole`—, que es por lo
 *  que #529 vale por coherencia y defensa en profundidad y no por dolor
 *  medido.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso, todo en maqueta
 *  (`renderMode: "vector"`, `charMode: "vector"`).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nuevaPartida, comenzar, esperarTituloListo } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";

/** El motivo, escrito UNA vez aquí y exigido en las DOS orillas. Es el string
 *  de `parseHostilePersonality` (`hostil-desde-combat.ts`): si alguien lo
 *  cambia en core, este guion cae por los dos lados a la vez. */
const MOTIVO = "combat.personality.preferred_attacks no es una lista de ataques no vacía";

/** El bloque que deriva el core (`combatForHostileRole` + `buildPersonality`),
 *  aplanado como viaja por `add_combatants`. Escrito a mano a propósito: si el
 *  balance cambia, este guion sigue midiendo el DESENLACE y no el número. */
const bueno = (id, x) => ({
  id,
  position: { x, y: 0, z: 3 },
  health: 60,
  maxHealth: 60,
  weaponId: "unarmed",
  personality: {
    reaction_time: 0.5,
    aggression: 0.6,
    move_speed: 2,
    attack_cooldown_mult: 0.6,
    block_chance: 0.1,
    preferred_distance: 1.5,
    preferred_attacks: ["quick", "medium", "heavy"],
    combat_range: 4,
    aggro_radius: 10,
  },
});

/** El malo: tipo correcto, valor imposible — uno de los seis casos que el borde
 *  ACEPTABA antes de la PR 6 de #241 y que hoy el parser rechaza. */
const roto = (id, x) => {
  const e = bueno(id, x);
  return { ...e, personality: { ...e.personality, preferred_attacks: [] } };
};

/** EL LOTE del criterio de aceptación: el malo EN MEDIO, con un bueno delante
 *  y otro detrás. */
const LOTE = [bueno("qa129_bueno_a", 2), roto("qa129_roto", 4), bueno("qa129_bueno_b", 6)];

/** Las líneas de descarte que el bridge escribe en su log. */
function descartesDelBridge(log) {
  if (!existsSync(log)) return null;
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.includes("descartado:"));
}

/** Las líneas de rechazo de FRAME del borde, que son la conducta vieja: si
 *  reaparece una, el criterio ha vuelto al intake y el lote murió entero. */
function framesRechazados(log) {
  if (!existsSync(log)) return null;
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.includes("WS frame rejected"));
}

/** Manda un frame POR EL SOCKET DEL JUEGO. No abre uno propio: el que juzga
 *  tiene que ser el borde real, con la sesión de esta partida. */
async function porElSocketDelJuego(ctx, frame) {
  await ctx.page.evaluate((f) => {
    const ws = window.__qa129?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `el guion no capturó el socket del juego (${ws ? `readyState ${ws.readyState}` : "ninguno"})`,
      );
    }
    ws.send(JSON.stringify(f));
  }, frame);
}

const avisosDeError = (ctx) =>
  ctx.page.evaluate(() =>
    window.__qa129.entrantes
      .filter((m) => m.type === "narrative_status" && m.phase === "error")
      .map((m) => ({ kind: m.kind, message: m.message })),
  );

const registro = (ctx) =>
  ctx.page.evaluate(() => (document.getElementById("error-log")?.textContent ?? "").replace(/\s+/g, " "));

/** QUIÉN ESTÁ DADO DE ALTA, visto desde el cliente: los ids del ÚLTIMO
 *  `state_update` que llegó por el socket.
 *
 *  Y no `window.__nefan.enemies()`, que es lo primero que uno escribe y NO
 *  sirve aquí (medido: salía vacío): esa lista la puebla el cliente con los
 *  hostiles que él mismo sacó de la escena, y `add_combatants` va en la
 *  dirección contraria —es el cliente diciéndole al bridge a quién dar de
 *  alta—, así que un enemigo inyectado por el socket nunca tiene cuerpo que
 *  pintar. Lo que el bridge contesta, en cambio, es exactamente su lista de
 *  combatientes vivos (`getEnemyStates`), y es el observable honesto de «quién
 *  entró». */
const dadosDeAlta = (ctx) =>
  ctx.page.evaluate(() => {
    const ultimo = [...window.__qa129.entrantes].reverse().find((m) => m.type === "state_update");
    return ultimo ? ultimo.enemies.map((e) => e.id) : null;
  });

const npcsEnEscena = (ctx) => ctx.page.evaluate(() => window.__nefan.npcs().map((n) => n.id));

/** El MURO DE FALLO, que no es «el overlay»: el mismo `#narrative-loader` pinta
 *  también las esperas («Generando mundo inicial…»), y confundirlos es un rojo
 *  que no dice nada (medido la primera vez que se corrió este guion). Lo que
 *  separa un fallo de una espera es la clase `error`, que solo pone `fallo()`
 *  (`ui/muro-de-carga.ts`). */
const muroDeFallo = (ctx) =>
  ctx.page.evaluate(() => {
    const el = document.getElementById("narrative-loader");
    const visible = Boolean(el?.classList.contains("visible") && el.classList.contains("error"));
    return {
      visible,
      titulo: visible ? document.getElementById("narrative-loader-title")?.textContent ?? "" : "",
      detalle: visible ? document.getElementById("narrative-loader-detail")?.textContent ?? "" : "",
    };
  });

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  const logBridge = tmp ? join(tmp, "logs", "nefan-bridge.log") : null;

  // El espía del socket, ANTES de la recarga (molde del 85 y del 90).
  await ctx.page.addInitScript(() => {
    const Orig = window.WebSocket;
    window.__qa129 = { ws: null, entrantes: [] };
    window.WebSocket = class extends Orig {
      constructor(...args) {
        super(...args);
        if (String(args[0] ?? "").startsWith("ws")) {
          window.__qa129.ws = this;
          this.addEventListener("message", (ev) => {
            try {
              window.__qa129.entrantes.push(JSON.parse(typeof ev.data === "string" ? ev.data : "{}"));
            } catch {
              window.__qa129.entrantes.push({ type: "(no-json)" });
            }
          });
        }
      }
    };
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente está en pie con el espía del socket puesto", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);

  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  const partida = await comenzar(ctx);
  ctx.log(`partida ${partida.sessionId} · escena ${partida.scene}`);

  if (logBridge === null) {
    ctx.sinMedirBloque(
      "sin QA_RUN_TMP no hay log de bridge de esta corrida que leer: el stack lo arrancó otro, y " +
        "afirmar sobre un log ajeno no es medir esta partida (el bloque B mira ese fichero)",
    );
  }
  const antesDescartes = descartesDelBridge(logBridge)?.length ?? null;
  const antesRechazos = framesRechazados(logBridge)?.length ?? null;
  ctx.log(`antes del frame: dados de alta ${JSON.stringify(await dadosDeAlta(ctx))}`);

  // ── el frame: dos buenos y un malo EN MEDIO ──────────────────────────────
  await porElSocketDelJuego(ctx, { type: "add_combatants", enemies: LOTE });

  // Se espera por ESTADO: el primer bueno tiene que aparecer en el mundo. Si la
  // conducta vieja volviera, aquí se agota el plazo y el bloque A sale rojo con
  // lo que sí llegó, que es exactamente lo que hay que ver.
  const llegada = await ctx.expectEspera(
    "A · el primer enemigo VÁLIDO del lote queda dado de alta y el bridge lo dice en su `state_update`",
    true,
    (id) => {
      const ultimo = [...window.__qa129.entrantes].reverse().find((m) => m.type === "state_update");
      return ultimo?.enemies.some((e) => e.id === id) ? ultimo.enemies.map((e) => e.id) : null;
    },
    { ms: 30_000, arg: "qa129_bueno_a" },
  );

  const ids = (await dadosDeAlta(ctx)) ?? [];
  const npcs = await npcsEnEscena(ctx);
  ctx.log(`A · dados de alta tras el frame: ${JSON.stringify(ids)} · npcs ${JSON.stringify(npcs)}`);
  ctx.expect(
    "A · los DOS válidos entran —el de delante y el de DETRÁS del malo, que es al que se llevaba el descarte del lote—",
    ids.includes("qa129_bueno_a") && ids.includes("qa129_bueno_b"),
    JSON.stringify(ids),
  );
  ctx.expect(
    "A · …y el INVÁLIDO no entra: el criterio sigue siendo el mismo, lo que cambia es a quién se lleva por delante",
    !ids.includes("qa129_roto"),
    JSON.stringify(ids),
  );
  ctx.expect(
    "A · la escena que ya estaba sigue entera: el lote no se lleva lo que había",
    npcs.length > 0,
    JSON.stringify(npcs),
  );

  // ── B · el motivo, en los dos canales ────────────────────────────────────
  const descartes = descartesDelBridge(logBridge);
  const nuevaLinea = descartes && antesDescartes !== null ? (descartes.slice(antesDescartes)[0] ?? "") : "";
  ctx.log(`B · log del bridge: ${nuevaLinea.slice(0, 220)}`);
  ctx.expect(
    "B · el bridge escribe en su log QUIÉN se descartó y POR QUÉ, con el motivo del parser verbatim",
    nuevaLinea.includes('enemigo "qa129_roto" descartado') && nuevaLinea.includes(MOTIVO),
    nuevaLinea || "(ninguna línea «descartado:» nueva)",
  );

  const avisos = await avisosDeError(ctx);
  ctx.log(`B · avisos de error recibidos: ${JSON.stringify(avisos)}`);
  ctx.expect(
    "B · al jugador le llega el aviso con el kind del hecho (`combatientes`), no el genérico de protocolo",
    avisos.some((a) => a.kind === "combatientes"),
    JSON.stringify(avisos),
  );
  ctx.expect(
    "B · …y el aviso dice CUÁNTOS de cuántos y nombra al que no entró con su motivo",
    avisos.some(
      (a) => a.kind === "combatientes" && a.message?.includes("1 de 3") && a.message.includes("qa129_roto") && a.message.includes(MOTIVO),
    ),
    JSON.stringify(avisos),
  );

  const texto = await registro(ctx);
  ctx.log(`B · registro del jugador: ${texto.slice(0, 300)}`);
  ctx.expect(
    "B · el motivo llega al REGISTRO del jugador, que es donde puede leerlo sin dejar de jugar",
    texto.includes(MOTIVO) && texto.includes("qa129_roto"),
    texto.slice(0, 300) || "(registro vacío)",
  );

  // ── C · sin modal, y la partida sigue ────────────────────────────────────
  const muro = await muroDeFallo(ctx);
  ctx.log(`C · muro de fallo tras el frame: ${JSON.stringify(muro)}`);
  ctx.expect(
    "C · NINGÚN muro de fallo tapa la partida: es la conducta que #529 retira, y la que el guion 90 dejó escrita como hallazgo A3-bis",
    !muro.visible,
    JSON.stringify(muro),
  );
  const rechazos = framesRechazados(logBridge);
  ctx.expect(
    "C · el borde NO rechazó el frame: un «WS frame rejected» nuevo sería el criterio de vuelta en el intake",
    rechazos === null || antesRechazos === null || rechazos.length === antesRechazos,
    `${antesRechazos} → ${rechazos?.length}`,
  );

  const antesDeAndar = await ctx.nefan("state");
  await ctx.holdUntil(
    "up",
    "el jugador sigue andando con el mundo puesto",
    (p) => {
      const q = window.__nefan.state().pos;
      return Math.hypot(q.x - p.x, q.z - p.z) > 0.5 ? q : null;
    },
    { sim: 8 },
    antesDeAndar.pos,
  );
  await ctx.shot("129-los-buenos-entran-y-el-malo-no-tapa-la-pantalla");
  if (!llegada.ocurrio) return;
}
