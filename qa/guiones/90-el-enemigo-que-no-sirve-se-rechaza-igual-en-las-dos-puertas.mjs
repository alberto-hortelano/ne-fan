/** LA FRONTERA que movió la PR 6 de #241: «qué es un enemigo utilizable» dejó
 *  de estar escrito dos veces —el parser de `nefan-html/src/scene/enemigo.ts` y
 *  el `EnemyPersonalitySchema` del borde WS— y hoy lo dice UNA función de core
 *  (`nefan-core/src/combat/hostil-desde-combat.ts`, `parseHostileCombat`) a la
 *  que llaman las DOS puertas por las que un enemigo entra al juego.
 *
 *  QUÉ NO ESTABA CANDADO. Los ocho guiones del enemigo (29 35 38 41 42 49 54
 *  57) miden al hostil que SÍ sirve: que llega, que pega, que vuelve herido.
 *  El 41 es el único que mira dentro de `personality` (`aggression > 0` y
 *  `preferred_attacks` no vacía, sobre la escena) y el 50 el único que fabrica
 *  un bloque roto —`{health: 5}` en el ledger— pero para medir otra cosa (que
 *  el NPC que el cliente no tiene se dice). Ninguno afirma:
 *
 *   A · Que el BORDE WS del bridge rechace un enemigo cuyo bloque es del tipo
 *       correcto y del VALOR equivocado. Hasta esta PR no lo rechazaba: el zod
 *       miraba el tipo, así que `maxHealth: 0` y `preferred_attacks: []`
 *       entraban al sim (un muerto dado de alta, un hostil sin ataque que el
 *       resolver pueda resolver) mientras el cliente los tiraba en su puerta.
 *   B · Que el motivo que el jugador lee en su registro cuando su cliente
 *       descarta un enemigo sea EL MISMO STRING que el bridge escribe en su
 *       log al rechazar ese mismo bloque. Es lo único que hace verdad la frase
 *       «un solo criterio»: dos textos distintos son dos criterios que hoy
 *       coinciden por casualidad.
 *   C · Que rechazar no sea caerse: la partida sigue, y lo que sí sirve entra.
 *
 *  CÓMO SE LLEGA AL ESTADO, sin tocar el cliente. El bloque A manda los frames
 *  por el SOCKET DEL JUEGO (un `addInitScript` guarda la instancia que el
 *  cliente abre, como hace el 85 para contarlos): así el frame lo juzga el
 *  borde real, con la sesión y el mundo de la partida, y el aviso vuelve a la
 *  página del jugador y no a un socket de laboratorio. El bloque B fabrica el
 *  enemigo roto donde el juego lo guarda —el `data.combat` del spawn de
 *  runtime en el `state.json` del disco efímero— y REANUDA por la tarjeta del
 *  título, que es el único camino por el que hoy le llega a un jugador un
 *  bloque `combat` roto (el motor no escribe los números: los deriva
 *  `combatForHostileRole`).
 *
 *  EL DESENLACE, que era la mitad que faltaba (#529, 2026-09-14). Hasta esa
 *  fecha el bloque A3-bis medía —y dejaba escrito como `⚠ HALLAZGO`, sin
 *  ponerlo rojo— que el veredicto y el motivo eran UNO pero el desenlace NO:
 *  el bridge descartaba el FRAME ENTERO y plantaba un modal a pantalla completa
 *  («Fallo interno del juego», `kind:"protocolo"`) mientras el cliente, con el
 *  MISMO criterio, descartaba UN enemigo y seguía. Hoy las dos puertas hacen lo
 *  del cliente, el hallazgo es ASERTO (A3-bis) y el rechazo se lee en el log
 *  del bridge como `enemigo "<id>" descartado: <motivo>` — con el id de quién,
 *  que la ruta `enemies[0]` de zod no decía. Que los enemigos BUENOS del mismo
 *  lote entren mientras el malo no es el sujeto del guion 129; aquí se sigue
 *  midiendo la igualdad del MOTIVO entre el registro del cliente y el log del
 *  bridge, que es donde cada uno lo escribe.
 *
 *  LO QUE EL BLOQUE A3-ter NO AFIRMA: el texto del CLIENTE para un error de
 *  TIPO. La igualdad de la frase se mide en el bloque B, que fabrica el bloque
 *  roto donde el juego lo guarda y compara las dos orillas — y ahí el caso es
 *  de VALOR, porque es el que un save puede traer. Para el de tipo, lo que se
 *  afirma aquí es que el bridge deja de contestar con el mensaje de zod, que es
 *  lo que lo separaba del cliente; el cliente llama a la MISMA función y no
 *  tiene otra rama por la que salir.
 *
 *  PROBADO EN NEGATIVO (2026-09-07), sabotaje en `hostil-desde-combat.ts` y
 *  restaurado byte a byte: aceptar la lista de ataques vacía
 *  (`attacks.length === 0` fuera del criterio) → A2 rojo (el bridge deja pasar
 *  al hostil sin ataques y no escribe línea de rechazo) y B rojo por partida
 *  doble (el registro del cliente no dice el motivo y el enemigo roto ENTRA al
 *  mundo). El bloque A3-bis, que hoy es aserto, se probó en negativo con #529
 *  desde el otro lado: devolver el criterio al `superRefine` de
 *  `EnemySpawnSchema` pone rojos sus dos `expect` (el modal vuelve y aparece la
 *  línea de «WS frame rejected»).
 *
 *  Cero créditos: `e2e-sin-creditos`, motor falso, personajes en vector.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nuevaPartida, comenzar, esperarListaDeSaves, esperarTituloListo } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";
import { rutaDelSave, esperarEnElSave } from "../lib/saves.mjs";

/** El motor falso es determinista POR TURNO de diálogo: saves vírgenes y
 *  contador a 0, o el Secuaz del turno 2 no llega. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const MERCADER = "barkeep";
const HOSTIL = "Secuaz";

/** El motivo, escrito UNA vez aquí y exigido en las DOS orillas. Es el string
 *  de `parseHostilePersonality` (`hostil-desde-combat.ts`); si alguien lo
 *  cambia en core, este guion cae por los dos lados a la vez, que es
 *  exactamente lo que significa «un solo criterio». */
const MOTIVO_ATAQUES = "combat.personality.preferred_attacks no es una lista de ataques no vacía";
/** Uno de los seis casos que el bridge ACEPTABA antes de la PR 6 (tabla base↔hoy
 *  de `implementacion-6.md`): tipo correcto, valor imposible. */
const MOTIVO_MAXHP = "combat.max_health inválido (0)";
/** …y un error de TIPO, que es la otra mitad y la que faltaba (#530-p3). Hasta
 *  esta tanda los cuatro campos del bloque llevaban zod de verdad
 *  (`z.number()`, `z.string()`), y zod NO llega al `superRefine` si el objeto
 *  ya falló: un `health: "mucha"` moría con el mensaje de zod («Expected
 *  number, received string») mientras el cliente, con el MISMO bloque, decía el
 *  del parser. QA lo midió en la PR 6: 11 de 49 casos con dos motivos, todos de
 *  tipo o de ausencia; en los 38 de VALOR eran idénticos. Hoy los cuatro solo
 *  DECLARAN su tipo en el zod y los juzga `parseHostileCombat`. */
const MOTIVO_TIPO = 'combat.health inválido ("mucha")';
/** La ausencia es el otro caso de esa mitad: el cliente nunca vio un
 *  `Required` de zod, veía el motivo del parser. */
const MOTIVO_RANGO_AUSENTE =
  "combat.personality necesita aggression, reaction_time y combat_range numéricos";

/** El bloque que deriva el core (`combatForHostileRole` + `buildPersonality`
 *  medium/aggressive), aplanado como viaja por `add_combatants`. Escrito a
 *  mano a propósito: si el balance cambia, este guion sigue midiendo el
 *  CRITERIO (que es lo suyo) y no el número. */
const enemigoValido = (over = {}) => ({
  id: "qa90_sonda",
  position: { x: 2, y: 0, z: 2 },
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
  ...over,
});

const conPersonalidad = (over) => enemigoValido({ personality: { ...enemigoValido().personality, ...over } });

/** Las líneas de DESCARTE que el bridge lleva escritas.
 *
 *  Eran las de «WS frame rejected» del intake hasta #529: el criterio vivía en
 *  el zod del borde, así que un enemigo malo hacía fallar el frame entero. Hoy
 *  el intake solo mira la FORMA y el descarte lo escribe el handler, con el id
 *  de QUIÉN al lado del motivo. */
function rechazosDelBridge(log) {
  if (!existsSync(log)) return null;
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.includes("descartado:"));
}

/** Y las del intake, que para un enemigo malo tienen que seguir siendo CERO:
 *  si vuelve una, el criterio volvió al zod y con él el descarte del lote. */
function framesRechazados(log) {
  if (!existsSync(log)) return null;
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.includes("WS frame rejected"));
}

/** Manda un frame POR EL SOCKET DEL JUEGO y devuelve los avisos que la página
 *  recibió después. No abre un socket propio: el que juzga tiene que ser el
 *  borde real, con la sesión de esta partida. */
async function porElSocketDelJuego(ctx, frame) {
  return ctx.page.evaluate(
    (f) =>
      new Promise((res, rej) => {
        const ws = window.__qa90?.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          rej(new Error(`el guion no capturó el socket del juego (${ws ? `readyState ${ws.readyState}` : "ninguno"})`));
          return;
        }
        const desde = window.__qa90.entrantes.length;
        ws.send(JSON.stringify(f));
        // El bridge contesta al mismo socket; 1,5 s de margen y se mira lo que
        // llegó. Un rechazo llega en el primer turno de evento.
        setTimeout(() => res(window.__qa90.entrantes.slice(desde)), 1500);
      }),
    frame,
  );
}

const registro = (ctx) =>
  ctx.page.evaluate(() => document.getElementById("error-log")?.textContent ?? "");

const mundo = (ctx) =>
  ctx.page.evaluate(() => ({
    enemigos: window.__nefan.enemies().map((e) => ({ id: e.id, label: e.label, hp: e.hp })),
    npcs: window.__nefan.npcs().map((n) => ({ id: n.id, label: n.label })),
  }));

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  const logBridge = tmp ? join(tmp, "logs", "nefan-bridge.log") : null;

  // El espía del socket: guarda la instancia que el cliente abre contra el
  // bridge y todo lo que le entra. Va ANTES de la recarga, como en el 85.
  await ctx.page.addInitScript(() => {
    const Orig = window.WebSocket;
    window.__qa90 = { ws: null, entrantes: [] };
    window.WebSocket = class extends Orig {
      constructor(...args) {
        super(...args);
        if (String(args[0] ?? "").startsWith("ws")) {
          window.__qa90.ws = this;
          this.addEventListener("message", (ev) => {
            try {
              window.__qa90.entrantes.push(JSON.parse(typeof ev.data === "string" ? ev.data : "{}"));
            } catch {
              window.__qa90.entrantes.push({ type: "(no-json)" });
            }
          });
        }
      }
    };
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente está en pie con el espía del socket puesto", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);

  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "image" });
  const partida = await comenzar(ctx);
  ctx.log(`partida ${partida.sessionId} · escena ${partida.scene}`);

  // ── A · el borde WS: el criterio de core juzga lo que entra por el cable ──
  const antesValido = rechazosDelBridge(logBridge)?.length ?? null;
  const avisosValido = await porElSocketDelJuego(ctx, { type: "add_combatants", enemies: [enemigoValido()] });
  const trasValido = rechazosDelBridge(logBridge)?.length ?? null;
  const erroresValido = avisosValido.filter((m) => m.type === "narrative_status" && m.phase === "error");
  ctx.log(`A1 · válido: ${avisosValido.length} avisos, ${erroresValido.length} de error · rechazos en el log ${antesValido} → ${trasValido}`);
  if (antesValido === null) {
    ctx.sinMedirBloque(
      "sin QA_RUN_TMP no hay log de bridge de esta corrida que leer: el stack lo arrancó otro, y " +
        "afirmar sobre un log ajeno no es medir esta partida (A1/A2/A3 miran ese fichero)",
    );
  }
  ctx.expect(
    "A1 · el enemigo que el core DERIVA entra por el cable: el borde no lo rechaza (sin esto, «rechaza» sería un verde vacío)",
    erroresValido.length === 0 && (antesValido === null || trasValido === antesValido),
    `errores=${JSON.stringify(erroresValido)} · rechazos ${antesValido} → ${trasValido}`,
  );

  // A2 · el bloque roto: mismo enemigo, la lista de ataques vacía.
  const antesRoto = rechazosDelBridge(logBridge)?.length ?? null;
  const avisosRoto = await porElSocketDelJuego(ctx, {
    type: "add_combatants",
    enemies: [conPersonalidad({ preferred_attacks: [] })],
  });
  const rechazos = rechazosDelBridge(logBridge);
  const nuevaLinea = rechazos && antesRoto !== null ? (rechazos.slice(antesRoto)[0] ?? "") : "";
  const erroresRoto = avisosRoto.filter((m) => m.type === "narrative_status" && m.phase === "error");
  ctx.log(`A2 · roto: ${JSON.stringify(erroresRoto.map((m) => ({ kind: m.kind, message: m.message })))}`);
  ctx.log(`A2 · log del bridge: ${nuevaLinea.slice(0, 200)}`);
  ctx.expect(
    "A2 · el bridge RECHAZA al hostil sin ataques y lo dice con el motivo del criterio de core, nombrando a QUIÉN",
    nuevaLinea.includes('enemigo "qa90_sonda" descartado') && nuevaLinea.includes(MOTIVO_ATAQUES),
    nuevaLinea || "(ninguna línea «descartado:» nueva)",
  );
  ctx.expect(
    "A2 · …y al jugador le llega el aviso del hecho (`combatientes`, #529), fail-loud y no silencio",
    erroresRoto.some((m) => m.kind === "combatientes"),
    JSON.stringify(erroresRoto),
  );

  // A3 · uno de los seis que el bridge ACEPTABA antes de la PR 6.
  const antesMax = rechazosDelBridge(logBridge)?.length ?? null;
  await porElSocketDelJuego(ctx, { type: "add_combatants", enemies: [enemigoValido({ maxHealth: 0 })] });
  const trasMax = rechazosDelBridge(logBridge);
  const lineaMax = trasMax && antesMax !== null ? (trasMax.slice(antesMax)[0] ?? "") : "";
  ctx.log(`A3 · maxHealth 0 → ${lineaMax.slice(0, 200)}`);
  ctx.expect(
    "A3 · `maxHealth: 0` (que el borde ACEPTABA antes de la PR 6: un muerto dado de alta) se rechaza con el motivo del parser",
    lineaMax.includes(MOTIVO_MAXHP),
    lineaMax || "(ninguna línea «descartado:» nueva)",
  );

  // A3-ter · EL ERROR DE TIPO da el motivo del PARSER, no el de zod (#530-p3).
  // Es la mitad que faltaba de «un solo criterio»: el veredicto ya coincidía,
  // el MOTIVO no — y un motivo distinto en cada puerta son dos criterios que
  // hoy coinciden por casualidad. Se miden los dos casos de esa mitad: el tipo
  // equivocado y la ausencia.
  for (const [que, frame, motivo] of [
    ["`health: \"mucha\"` (tipo equivocado)", enemigoValido({ health: "mucha" }), MOTIVO_TIPO],
    ["una personalidad SIN `combat_range`", conPersonalidad({ combat_range: undefined }), MOTIVO_RANGO_AUSENTE],
  ]) {
    const antes = rechazosDelBridge(logBridge)?.length ?? null;
    await porElSocketDelJuego(ctx, { type: "add_combatants", enemies: [frame] });
    const tras = rechazosDelBridge(logBridge);
    const linea = tras && antes !== null ? (tras.slice(antes)[0] ?? "") : "";
    ctx.log(`A3-ter · ${que} → ${linea.slice(0, 200)}`);
    ctx.expect(
      `A3-ter · ${que} se rechaza con el motivo del PARSER (el mismo string que escribe el cliente), no con el de zod`,
      linea.includes(motivo) && !/Expected .* received/.test(linea),
      linea || "(ninguna línea «descartado:» nueva)",
    );
  }

  // A3-bis · QUÉ TIENE DELANTE EL JUGADOR cuando el rechazo pasa en el bridge.
  // ERA UN `⚠ HALLAZGO` sin rojo: el overlay venía de #352 (`kind:"protocolo"`
  // → `destino:"overlay"`) y lo que la PR 6 cambió fue cuántos frames llegaban
  // hasta él. #529 cerró la brecha y por eso HOY ES ASERTO: el desenlace es el
  // del cliente en las dos puertas, así que un rechazo de enemigo no puede
  // volver a velar la partida ni a llevarse el frame entero. Las dos mitades,
  // porque el modal y el descarte del lote eran la misma causa: ni overlay, ni
  // una línea de «WS frame rejected» nueva.
  //
  // Y lo que se mira es el MURO DE FALLO, no «el overlay»: el mismo
  // `#narrative-loader` pinta las esperas del arranque («Iniciando partida…»),
  // así que preguntarle solo si está visible daba un rojo que no era el del
  // sujeto — medido al estrenar el aserto. Lo que separa un fallo de una
  // espera es la clase `error`, que solo pone `fallo()` (`ui/muro-de-carga.ts`).
  const overlay = await ctx.page.evaluate(() => {
    const el = document.getElementById("narrative-loader");
    const visible = Boolean(el?.classList.contains("visible") && el.classList.contains("error"));
    return {
      visible,
      titulo: visible ? document.getElementById("narrative-loader-title")?.textContent ?? "" : "",
      detalle: visible ? document.getElementById("narrative-loader-detail")?.textContent ?? "" : "",
      salida: visible ? document.getElementById("narrative-loader-dismiss")?.textContent ?? "" : "",
    };
  });
  ctx.log(`A3-bis · muro de fallo tras los rechazos: ${JSON.stringify(overlay)}`);
  ctx.expect(
    "A3-bis · NINGÚN muro de fallo vela la partida por un enemigo que no sirve (#529: el desenlace también es uno)",
    !overlay.visible,
    JSON.stringify(overlay),
  );
  const framesTirados = framesRechazados(logBridge);
  ctx.expect(
    "A3-bis · …y el borde no tiró un solo frame: el criterio está en el handler, no en el intake",
    framesTirados === null || framesTirados.length === 0,
    JSON.stringify(framesTirados?.slice(-2) ?? null),
  );
  if (overlay.visible) await ctx.page.click("#narrative-loader-dismiss").catch(() => {});

  // A4 · rechazar no es caerse: la partida sigue y el jugador se mueve.
  const antesDeAndar = await ctx.nefan("state");
  await ctx.holdUntil(
    "up",
    "el jugador sigue andando tras los rechazos",
    (p) => {
      const q = window.__nefan.state().pos;
      return Math.hypot(q.x - p.x, q.z - p.z) > 0.5 ? q : null;
    },
    { sim: 8 },
    antesDeAndar.pos,
  );
  const tras = await mundo(ctx);
  ctx.log(`A4 · mundo tras los rechazos: ${JSON.stringify(tras)}`);
  ctx.expect(
    "A4 · la escena sigue en pie tras tres frames rechazados: sus NPC y su hostil siguen ahí",
    tras.npcs.some((n) => n.id === MERCADER) && tras.enemigos.length >= 1,
    JSON.stringify(tras),
  );
  await ctx.shot("90-A-el-borde-rechaza-y-la-partida-sigue");

  // ── B · la puerta del CLIENTE dice EL MISMO motivo ───────────────────────
  // El enemigo roto se fabrica donde el juego lo guarda: el `data.combat` del
  // spawn de runtime en el save. Hace falta un hostil de RUNTIME (el de la
  // escena se re-deriva del core en cada resume), y ese lo trae el turno 2 del
  // motor falso.
  await ctx.waitFor(
    "el tabernero está en escena para hablar con él",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    MERCADER,
  );
  await acercarse(ctx, MERCADER, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);
  const secuaz = await ctx.expectEspera(
    `el motor materializa a "${HOSTIL}" (turno 2): el hostil de RUNTIME que este bloque necesita`,
    true,
    (n) => window.__nefan.enemies().find((e) => e.label === n) ?? null,
    { ms: 90_000, arg: HOSTIL },
  );
  if (!secuaz.ocurrio) {
    ctx.sinMedirBloque(
      `sin el hostil de runtime "${HOSTIL}" no hay ledger que sabotear: el enemigo de la escena se ` +
        "re-deriva del core en cada resume y no llega roto a la puerta del cliente",
    );
    return;
  }
  const idSecuaz = secuaz.ultimo.id;

  const fichero = rutaDelSave(partida.sessionId);
  if (!fichero) {
    ctx.sinMedirBloque(
      "sin disco efímero (QA_RUN_TMP) no hay `state.json` de esta corrida que editar, y tocar el " +
        "save de otro stack sería fabricar el estado de una partida ajena",
    );
    return;
  }
  // El bridge es el único escritor del save: se espera a que el spawn esté EN
  // DISCO con su bloque antes de editarlo, o se sabotea un fichero que él va a
  // reescribir un instante después.
  const enDisco = await esperarEnElSave(
    partida.sessionId,
    (s) => (s.entities ?? []).find((e) => e.id === idSecuaz)?.data?.combat?.personality ?? null,
    30_000,
  );
  const save = JSON.parse(readFileSync(fichero, "utf8"));
  const rec = (save.entities ?? []).find((e) => e.id === idSecuaz);
  if (!enDisco || !rec?.data?.combat?.personality) {
    ctx.sinMedirBloque(
      `el save no trae el bloque combat del spawn ${idSecuaz} (entities: ` +
        `${JSON.stringify((save.entities ?? []).map((e) => e.id))}): sin él no hay bloque roto que fabricar`,
    );
    return;
  }
  rec.data.combat.personality.preferred_attacks = [];
  writeFileSync(fichero, JSON.stringify(save, null, 2), "utf8");
  ctx.log(`B · saboteado ${idSecuaz} en el save: personality.preferred_attacks = []`);

  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${partida.sessionId}"]`);
  ctx.expect("B · el título ofrece REANUDAR la partida saboteada", Boolean(tarjeta), partida.sessionId);
  if (!tarjeta) return;
  await tarjeta.click();
  await ctx.waitFor(
    "la escena vuelve tras reanudar",
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );
  const descarte = await ctx.expectEspera(
    "B · el cliente descarta al enemigo roto y escribe el motivo en el registro del jugador",
    true,
    (id) => {
      const t = document.getElementById("error-log")?.textContent ?? "";
      return t.includes(`enemigo "${id}" descartado`) ? t : null;
    },
    { ms: 60_000, arg: idSecuaz },
  );
  const texto = (await registro(ctx)).replace(/\s+/g, " ");
  ctx.log(`B · registro: ${texto.slice(0, 300)}`);
  ctx.expect(
    "B · …y el motivo es EL MISMO STRING que el bridge escribió en su log para ese bloque (un solo criterio, no dos que coinciden)",
    texto.includes(`enemigo "${idSecuaz}" descartado: ${MOTIVO_ATAQUES}`) && nuevaLinea.includes(MOTIVO_ATAQUES),
    `cliente: ${texto.slice(0, 200)} || bridge: ${nuevaLinea.slice(0, 160)}`,
  );
  const trasResume = await mundo(ctx);
  ctx.log(`B · mundo tras reanudar: ${JSON.stringify(trasResume)}`);
  ctx.expect(
    "B · el enemigo con el bloque roto NO entra al mundo…",
    !trasResume.enemigos.some((e) => e.id === idSecuaz),
    JSON.stringify(trasResume.enemigos),
  );
  ctx.expect(
    "B · …y el resto de la escena sí: el rechazo es de UN enemigo, no de la partida",
    trasResume.npcs.some((n) => n.id === MERCADER) && trasResume.enemigos.length >= 1,
    JSON.stringify(trasResume),
  );
  await ctx.shot("90-B-el-registro-dice-por-que-se-descarto");
  if (!descarte.ocurrio) return;
}
