/** UN LOTE EN EL QUE **NO ENTRA NADIE** TAMBIÉN SE DICE, Y NO SE LLEVA LO QUE
 *  YA HABÍA (#529, escrito por QA al validar la PR 4 de la tanda B).
 *
 *  EL HUECO QUE CIERRA. El desenlace de #529 —«se cae solo él, los demás
 *  entran»— lo mide el guion 129 con el lote que manda el criterio de
 *  aceptación: uno malo entre dos buenos. Pero el handler de `add_combatants`
 *  decide DOS cosas y el lote de 2+1 solo ejercita una: quién entra, y si se
 *  avisa. El aviso vive FUERA del `if (added > 0)` que proyecta al store
 *  (`bridge/handlers/simulation.ts`), y con al menos un enemigo bueno en el
 *  lote ese `if` siempre se cumple — así que meter el aviso dentro no rompe ni
 *  un test de `npm run verify` ni el guion 129 (MEDIDO por QA: 26 tests de los
 *  tres ficheros del sujeto en verde con el aviso dentro del `if`). El único
 *  lote que los separa es aquel en el que NO entra nadie, y hasta hoy ninguna
 *  medida lo mandaba por `add_combatants`: el jugador se quedaría sin la mitad
 *  de la noticia —«no ha entrado ninguno»— justo cuando más falta le hace.
 *
 *  Y la otra mitad, que es de regresión: un lote que se cae ENTERO no puede
 *  llevarse por delante a los combatientes que ya estaban dados de alta. Esa
 *  era exactamente la conducta vieja (el frame entero al suelo), y con
 *  `criba.altas` vacío el handler pasa por sitios (`enemies_projected`) que el
 *  lote mixto no pisa.
 *
 *  QUÉ AFIRMA, y las cuatro cosas a la vez:
 *
 *   A · **CONTROL, el camino feliz**: un lote SANO de dos entra entero y NO
 *       genera ni un aviso de error. Sin esto, «avisa cuando no entra nadie»
 *       no se distingue de «avisa siempre».
 *   B · **NINGUNO ENTRA**: los tres inválidos se quedan fuera…
 *   C · **…y el jugador se entera IGUAL**: aviso `combatientes` que dice «3 de
 *       3», con los TRES ids y sus TRES motivos DISTINTOS —tres familias de
 *       rechazo del parser (lista de ataques, `max_health`, `weapon_id`), que
 *       es lo que impide que un motivo valga por todos—, más una línea por
 *       enemigo en el log del bridge. Y SIN muro de fallo.
 *   D · **LO QUE HABÍA SIGUE**: los dos buenos del bloque A continúan dados de
 *       alta después del lote fallido.
 *
 *  CÓMO SE LLEGA AL ESTADO, sin tocar el cliente: los frames van por el SOCKET
 *  DEL JUEGO (molde del 85, del 90 y del 129), así que los juzga el borde REAL
 *  con la sesión de esta partida. Ningún camino de JUGADOR llega hoy a un
 *  enemigo inválido —el motor no escribe esos números, los deriva
 *  `combatForHostileRole`, y el gate del cliente va por delante—: #529 vale por
 *  coherencia y defensa en profundidad, y así está declarado en su crítica.
 *
 *  PROBADO EN NEGATIVO (QA, 2026-09-14): metiendo `avisarDeLosDescartados`
 *  dentro del `if (added > 0)` de `handleAddCombatants`, este guion se pone
 *  ROJO en los tres asertos del bloque C mientras `npm run verify` y el guion
 *  129 siguen verdes.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso, todo en maqueta
 *  (`renderMode: "vector"`, `charMode: "vector"`).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nuevaPartida, comenzar, esperarTituloListo } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";

/** Los tres motivos, escritos UNA vez aquí y exigidos en el aviso del jugador
 *  y en el log del bridge. Son los strings de `parseHostileCombat`
 *  (`hostil-desde-combat.ts`): si alguien los cambia en core, este guion cae
 *  por los dos lados a la vez, que es lo que hace verdad «un solo criterio». */
const MOTIVO_ATAQUES = "combat.personality.preferred_attacks no es una lista de ataques no vacía";
const MOTIVO_MAXHP = "combat.max_health inválido (0)";
const MOTIVO_ARMA = 'combat.weapon_id inválido ("")';

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

/** TRES MALOS DE TRES FAMILIAS DISTINTAS del parser. No es adorno: con tres
 *  copias del mismo defecto, un aviso que colapsara los motivos en el primero
 *  saldría verde. */
const sinAtaques = (id, x) => {
  const e = bueno(id, x);
  return { ...e, personality: { ...e.personality, preferred_attacks: [] } };
};
const sinMaximo = (id, x) => ({ ...bueno(id, x), maxHealth: 0 });
const sinArma = (id, x) => ({ ...bueno(id, x), weaponId: "" });

const LOTE_SANO = [bueno("qa130_previo_a", 2), bueno("qa130_previo_b", 4)];
const LOTE_TODO_MALO = [
  sinAtaques("qa130_sin_ataques", 6),
  sinMaximo("qa130_sin_maximo", 8),
  sinArma("qa130_sin_arma", 10),
];

/** Las líneas de descarte que el bridge escribe en su log. */
function descartesDelBridge(log) {
  if (!existsSync(log)) return null;
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.includes("descartado:"));
}

/** Las líneas de rechazo de FRAME del borde: la conducta vieja. Si reaparece
 *  una, el criterio ha vuelto al intake y el lote murió entero. */
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
    const ws = window.__qa130?.ws;
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
    window.__qa130.entrantes
      .filter((m) => m.type === "narrative_status" && m.phase === "error")
      .map((m) => ({ kind: m.kind, message: m.message })),
  );

const registro = (ctx) =>
  ctx.page.evaluate(() => (document.getElementById("error-log")?.textContent ?? "").replace(/\s+/g, " "));

/** QUIÉN ESTÁ DADO DE ALTA: los ids del ÚLTIMO `state_update` que contestó el
 *  bridge, que es su lista de combatientes vivos (`getEnemyStates`). No
 *  `window.__nefan.enemies()`, que es la lista que el CLIENTE saca de su escena
 *  y va en la dirección contraria a `add_combatants` (medido en el 129). */
const dadosDeAlta = (ctx) =>
  ctx.page.evaluate(() => {
    const ultimo = [...window.__qa130.entrantes].reverse().find((m) => m.type === "state_update");
    return ultimo ? ultimo.enemies.map((e) => e.id) : null;
  });

/** El MURO DE FALLO, que no es «el overlay»: el mismo `#narrative-loader` pinta
 *  las esperas del arranque, y confundirlos da un rojo que no es del sujeto
 *  (medido en el 129). Lo que separa un fallo de una espera es la clase
 *  `error`, que solo pone `fallo()`. */
const muroDeFallo = (ctx) =>
  ctx.page.evaluate(() => {
    const el = document.getElementById("narrative-loader");
    const visible = Boolean(el?.classList.contains("visible") && el.classList.contains("error"));
    return {
      visible,
      titulo: visible ? (document.getElementById("narrative-loader-title")?.textContent ?? "") : "",
      detalle: visible ? (document.getElementById("narrative-loader-detail")?.textContent ?? "") : "",
    };
  });

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  const logBridge = tmp ? join(tmp, "logs", "nefan-bridge.log") : null;

  // El espía del socket, ANTES de la recarga (molde del 85, del 90 y del 129).
  await ctx.page.addInitScript(() => {
    const Orig = window.WebSocket;
    window.__qa130 = { ws: null, entrantes: [] };
    window.WebSocket = class extends Orig {
      constructor(...args) {
        super(...args);
        if (String(args[0] ?? "").startsWith("ws")) {
          window.__qa130.ws = this;
          this.addEventListener("message", (ev) => {
            try {
              window.__qa130.entrantes.push(JSON.parse(typeof ev.data === "string" ? ev.data : "{}"));
            } catch {
              window.__qa130.entrantes.push({ type: "(no-json)" });
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
        "afirmar sobre un log ajeno no es medir esta partida (el bloque C mira ese fichero)",
    );
  }

  // ── A · control: un lote SANO entra entero y no molesta a nadie ──────────
  await porElSocketDelJuego(ctx, { type: "add_combatants", enemies: LOTE_SANO });
  await ctx.expectEspera(
    "A · el lote SANO entra: el camino feliz sigue igual que antes de #529",
    true,
    (id) => {
      const ultimo = [...window.__qa130.entrantes].reverse().find((m) => m.type === "state_update");
      return ultimo?.enemies.some((e) => e.id === id) ? ultimo.enemies.map((e) => e.id) : null;
    },
    { ms: 30_000, arg: "qa130_previo_b" },
  );
  const trasSano = (await dadosDeAlta(ctx)) ?? [];
  ctx.log(`A · dados de alta tras el lote sano: ${JSON.stringify(trasSano)}`);
  ctx.expect(
    "A · los DOS del lote sano quedan dados de alta",
    trasSano.includes("qa130_previo_a") && trasSano.includes("qa130_previo_b"),
    JSON.stringify(trasSano),
  );
  const avisosTrasSano = await avisosDeError(ctx);
  ctx.expect(
    "A · …y un lote sin ningún malo NO manda ningún aviso de error (sin esto, «avisa» y «avisa siempre» serían el mismo verde)",
    avisosTrasSano.length === 0,
    JSON.stringify(avisosTrasSano),
  );

  // ── B+C · el lote en el que NO ENTRA NADIE ──────────────────────────────
  const antesDescartes = descartesDelBridge(logBridge)?.length ?? null;
  const antesRechazos = framesRechazados(logBridge)?.length ?? null;
  await porElSocketDelJuego(ctx, { type: "add_combatants", enemies: LOTE_TODO_MALO });

  // Se espera por ESTADO —el aviso del hecho— y no por reloj. Si alguien mete
  // el aviso dentro del `if (added > 0)`, aquí se agota el plazo y el bloque C
  // sale rojo con lo que sí llegó, que es exactamente lo que hay que ver.
  const llegoElAviso = await ctx.expectEspera(
    "C · el jugador se entera AUNQUE NO ENTRE NADIE: llega el `narrative_status kind:\"combatientes\"`",
    true,
    () => {
      const avisos = window.__qa130.entrantes.filter(
        (m) => m.type === "narrative_status" && m.phase === "error" && m.kind === "combatientes",
      );
      return avisos.length > 0 ? avisos.map((a) => a.message) : null;
    },
    { ms: 30_000 },
  );

  const ids = (await dadosDeAlta(ctx)) ?? [];
  ctx.log(`B · dados de alta tras el lote todo-malo: ${JSON.stringify(ids)}`);
  ctx.expect(
    "B · NINGUNO de los tres inválidos entra al mundo",
    !ids.some((id) => id.startsWith("qa130_sin_")),
    JSON.stringify(ids),
  );
  ctx.expect(
    "D · y el lote que se cae ENTERO no se lleva por delante a los que ya estaban dados de alta",
    ids.includes("qa130_previo_a") && ids.includes("qa130_previo_b"),
    JSON.stringify(ids),
  );

  const avisos = await avisosDeError(ctx);
  ctx.log(`C · avisos de error recibidos: ${JSON.stringify(avisos)}`);
  const elAviso = avisos.find((a) => a.kind === "combatientes")?.message ?? "";
  ctx.expect(
    "C · el aviso dice CUÁNTOS de cuántos con la cuenta del lote entero («3 de 3»), no de los que entraron",
    elAviso.includes("3 de 3"),
    elAviso || "(sin aviso)",
  );
  ctx.expect(
    "C · …y nombra a los TRES con sus TRES motivos distintos: un motivo no vale por todos",
    ["qa130_sin_ataques", "qa130_sin_maximo", "qa130_sin_arma"].every((id) => elAviso.includes(id)) &&
      [MOTIVO_ATAQUES, MOTIVO_MAXHP, MOTIVO_ARMA].every((m) => elAviso.includes(m)),
    elAviso || "(sin aviso)",
  );

  const descartes = descartesDelBridge(logBridge);
  const nuevas = descartes && antesDescartes !== null ? descartes.slice(antesDescartes) : [];
  ctx.log(`C · líneas nuevas en el log del bridge: ${JSON.stringify(nuevas.map((l) => l.slice(-120)))}`);
  ctx.expect(
    "C · el log del bridge escribe UNA línea por enemigo descartado, con su id y su motivo verbatim",
    descartes === null ||
      (nuevas.length === 3 &&
        nuevas.some((l) => l.includes('"qa130_sin_ataques"') && l.includes(MOTIVO_ATAQUES)) &&
        nuevas.some((l) => l.includes('"qa130_sin_maximo"') && l.includes(MOTIVO_MAXHP)) &&
        nuevas.some((l) => l.includes('"qa130_sin_arma"') && l.includes(MOTIVO_ARMA))),
    JSON.stringify(nuevas),
  );

  const texto = await registro(ctx);
  ctx.log(`C · registro del jugador: ${texto.slice(0, 400)}`);
  ctx.expect(
    "C · el motivo llega al REGISTRO del jugador, que es donde puede leerlo sin dejar de jugar",
    texto.includes(MOTIVO_ATAQUES) && texto.includes("qa130_sin_arma"),
    texto.slice(0, 300) || "(registro vacío)",
  );

  const muro = await muroDeFallo(ctx);
  ctx.log(`C · muro de fallo tras el lote todo-malo: ${JSON.stringify(muro)}`);
  ctx.expect(
    "C · un lote entero descartado tampoco tapa la pantalla: la partida sigue",
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
  await ctx.shot("130-nadie-entra-y-aun-asi-se-dice");
  if (!llegoElAviso.ocurrio) return;
}
