/** Shared state + helpers for the bridge message handlers.
 *
 *  `BridgeContext` encapsula todo lo que antes eran globals de ws-server.ts,
 *  de forma que cada handler sea una función (msg, ws, ctx) testeable con
 *  fakes (socket capturador, AiClient falso) sin abrir sockets reales. */

import { createHash } from "node:crypto";

import type { GameSimulation } from "../src/simulation/game-loop.js";
import type { CombatConfig } from "../src/types.js";
import type { GameStore } from "../src/store/game-store.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { SessionStorage } from "../src/narrative/session-storage.js";
import type { AiClient } from "../src/narrative/ai-client.js";
import type { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import type { NpcDirector } from "../src/world-map/npc-director.js";
import { loadWorldDoc } from "../src/games/loader.js";
import {
  WORLD_SNAPSHOT_SCHEMA_VERSION,
  escenasQueSobreviven,
  escenasSinLugarEnElMapa,
  writeWorldSnapshot,
} from "../src/games/world-snapshot.js";
import type { DuenoDelSim } from "../src/protocol/dueno-del-sim.js";
import { loadWorldVocabulary } from "../src/games/vocabulary.js";
import type { PluginManifest } from "../src/plugins/types.js";
import type { SceneRecord } from "../src/narrative/types.js";
import type { NpcBehaviorSystem } from "../src/simulation/npc-behavior.js";
import { npcBehaviorRegistry } from "../src/simulation/npc-behavior-registry.js";
import { isHostileRole } from "../src/simulation/npc-roles.js";
import { seededRng } from "../src/rng.js";
import { resolvePlaceTarget } from "../src/world-map/place-target.js";
import type { SimCollisionProvider } from "./sim-collision.js";
import {
  describePluginTickError,
  dispatchPluginEvents,
  type PluginAppliedEffect,
  type PluginEventInput,
} from "../src/plugins/dispatcher.js";
import { dispatchConsequences } from "../src/narrative/consequence-handler.js";
import { escenaParaElWire } from "./wire-scene.js";
import { SceneGenQueue } from "./scene-gen-queue.js";
import type { PlaceTriggerSpec } from "../src/world-map/types.js";
import type {
  NarrativeStatusDeJuego,
  ServerMessage,
  SinSelloDeSesion,
  SinDuenoDelSim,
  StateUpdateMessage,
} from "../src/protocol/messages.js";
import type { WorldClaim } from "./world-claim.js";

/** Superficie mínima de socket que usan los handlers — un WebSocket de `ws`
 *  la cumple, y los tests pueden pasar un capturador. */
export interface ClientSocket {
  send(data: string): void;
  readyState: number;
  OPEN: number;
}

/** Lo que los handlers necesitan del AiClient — permite fakes en tests. */
export type NarrativeAiClient = Pick<
  AiClient,
  "notifySessionStart" | "generateScene" | "reportPlayerChoice" | "developWorld"
>;

export interface BridgeContext {
  sim: GameSimulation;
  /** Config de combate del bootstrap — los handlers de sesión la usan para
   *  instanciar el CombatSystem que declare el game.json (systems.combat). */
  combatConfig: CombatConfig;
  store: GameStore;
  narrative: NarrativeState;
  sessionStorage: SessionStorage;
  aiClient: NarrativeAiClient;
  mapTriggers: MapTriggerEvaluator;
  /** Estado de mapa de los NPC (place/transit/directive) — la capa de
   *  intención que el NpcBehaviorSystem ejecuta. */
  npcDirector: NpcDirector;
  /** Colisión server-side por tile para el movimiento de NPCs. */
  simCollision: SimCollisionProvider;
  gamesDir: string;
  /** Directorio de style packs (data/styles) — manifests + imágenes de
   *  referencia; el State API los sirve como estáticos. */
  stylesDir: string;
  /** Escribir snapshots de mundo en data/games/{id}/world/ al terminar un
   *  bootstrap/generate_game. true en producción; los tests lo apagan para
   *  no contaminar sus fixtures (inyección, como el resto del ctx). */
  persistWorldSnapshots: boolean;
  /** Manifests de los plugins activos de la sesión en curso (id → manifest).
   *  Se reasigna al entrar a start_session/resume_session para que una sesión
   *  sin plugins no herede los de la anterior. */
  activePlugins: Map<string, PluginManifest>;
  /** Cola de generación de escenas/tiles: el motor narrativo atiende una
   *  petición a la vez; los prefetch de tiles se encolan (FIFO con dedupe y
   *  prioridad blocking) en vez de perderse. */
  sceneGen: SceneGenQueue;
  /** Tracking de la activación por posición (tile/place bajo el jugador),
   *  gateado por cambio de celda para no costar nada en el hot loop.
   *  `tileKey` es el gate del save por cambio de TILE (#395): una escritura
   *  por 64 m, no una por celda. */
  posTracking: { cellKey: string | null; tileKey: string | null; placeId: string | null };
  /** El dueño del mundo del sim: quién puede escribir en él y si la partida
   *  guardada está escuchando (`bridge/world-claim.ts`). Tomar el mundo y
   *  decidir si el save escucha son la MISMA llamada — separarlos es lo que
   *  dejaba el `state.json` de una partida con las coordenadas del muñeco de
   *  una fixture dentro. */
  world: WorldClaim;
  /** Añade el socket a los suscriptores de eventos narrativos. */
  subscribe(ws: ClientSocket): void;
  /** Respuesta a UN socket. NO admite los mensajes que llevan sello: para
   *  esos está `enviarNarrativo`, y así «el sello lo escribe el transporte»
   *  es inexpresablemente falso en vez de cierto por costumbre. */
  send(ws: ClientSocket, msg: SinSello): void;
  /** Difunde a todos los suscriptores SELLANDO la sesión vigente. El mensaje
   *  llega sin `sessionId` y sale con él: ningún emisor puede olvidarse de
   *  ponerlo ni ponerlo mal (#282). Aquí decía «los 23 emisores» y era un censo
   *  en prosa como los otros dos que #659 retiró; el número de hoy —MEDIDO el
   *  2026-09-18, 31 llamadas en 11 ficheros— se queda fuera del comentario a
   *  propósito, porque envejece en la primera PR que añada una.
   *
   *  Solo acepta lo que SE DIRECCIONA POR SESIÓN (`ConSelloDeSesion`). Lo que
   *  se direcciona por juego va por `difundirDeJuego` y no pasa por aquí. */
  broadcastNarrative(msg: SinSelloDeSesion<ConSelloDeSesion>): void;
  /** Lo mismo a UN socket. Existe para que «el sello lo escribe el
   *  transporte» sea cierto también en el unicast: el rechazo de un frame
   *  inválido contesta un `narrative_status`, y con `send` a secas el
   *  `sessionId` se escribía a mano — o sea, un segundo escritor. Que hoy
   *  hubiera solo uno era un accidente, no un mecanismo. */
  enviarNarrativo(ws: ClientSocket, msg: SinSelloDeSesion<ConSelloDeSesion>): void;
  /** Difunde un mensaje que se direcciona POR JUEGO y NO LLEVA SELLO (#313).
   *
   *  Es un verbo propio y no una bandera de `broadcastNarrative` porque lo que
   *  cambia no es una opción del envío: es que este mensaje no tiene sesión que
   *  sellar. La pre-generación de mundo la pide el título —que no tiene
   *  partida— y el bridge la corre en una sesión efímera que descarta después,
   *  así que cualquier `sessionId` que se le estampara sería una mentira: la de
   *  la partida que el bridge tuviera cargada por casualidad al emitir.
   *
   *  El sello de #282 no se afloja con esto, se REPARTE: los mensajes de
   *  partida siguen sin poder salir sin él (el campo es requerido y el emisor
   *  no puede escribirlo), y los de juego no pueden salir sin `gameId`. Lo que
   *  ya no es expresable es un mensaje con el campo de direccionamiento del
   *  otro esquema. */
  difundirDeJuego(msg: NarrativeStatusDeJuego): void;
  /** EL CUARTO VERBO (#659): la respuesta de estado a UN socket, SELLADA con
   *  de quién es el sim que describe.
   *
   *  Es un verbo y no un argumento de `send` por lo mismo que `difundirDeJuego`
   *  es un verbo y no una bandera de `broadcastNarrative` (#313): lo que cambia
   *  no es una opción del envío, es QUÉ IDENTIFICADOR lleva el mensaje. Y es un
   *  verbo y no cuatro `sellarDuenoDelSim` escritos en los emisores porque el
   *  quinto emisor se olvidaría — aquí no hay nada que recordar: el sello no
   *  se puede escribir (`SinDuenoDelSim`) y no se puede omitir (el campo es
   *  requerido en `ServerMessage`). */
  enviarEstado(ws: ClientSocket, msg: SinDuenoDelSim<ConDuenoDelSim>): void;
}

/** Qué hace un write con el mundo que YA estaba en `world/tile.json` (#451).
 *
 *  Es un parámetro SIN DEFECTO a propósito: hasta hoy la política era una sola
 *  —reemplazar— y no estaba escrita en ningún sitio, así que el bootstrap vivo
 *  de una partida con el mundo pre-generado en disco lo reescribía con UNA
 *  escena y se llevaba por delante el anillo entero. Un defecto aquí es el
 *  mecanismo por el que un llamante nuevo hereda en silencio la decisión
 *  equivocada; sin él, tiene que elegir.
 *
 *  YA HAY TRES LLAMANTES, y el tercero es el que la hipótesis anterior temía:
 *  la CURA del mundo pre-generado (#577, `handlers/game-repair.ts`) elige
 *  `conserva-el-mundo-en-disco`, y no es una preferencia. Con `reemplaza`, una
 *  escena cribada que la cura NO consigue arreglar desaparecería del fichero:
 *  el chip del título pasaría de «8 de 9 escenas» a «✓ generado» 8/8 y el
 *  jugador perdería el único aviso que tiene de que su mundo va a costar
 *  llamadas al motor. Con `conserva` vuelve rota y el chip sigue avisando. */
export type PoliticaDeSnapshot = "conserva-el-mundo-en-disco" | "reemplaza-el-mundo";

/** El desenlace de un write de snapshot, DICHO (#577).
 *
 *  Hasta hoy esta función devolvía `void` y un fallo de disco salía por un
 *  `console.warn`: para el bootstrap vivo y para `generate_game` eso es
 *  best-effort defendible —la partida arranca igual, el snapshot es un
 *  acelerador—, pero para la CURA del mundo la escritura ES el entregable, y
 *  sin saberlo el job contestaría `ready` sin fichero. Los dos llamantes
 *  viejos siguen pudiendo ignorarlo; el nuevo no puede. */
export type EscrituraDeSnapshot =
  | { escrito: true; escenas: number }
  | { escrito: false; motivo: string };

/** Escribe el snapshot de mundo de la sesión actual como artefacto del juego
 *  (`data/games/{id}/world/{branch}.json`): TODAS las escenas registradas —
 *  en el bootstrap vivo, solo la de entrada; en generate_game, el anillo 3×3
 *  y los places realizados. Best-effort REPORTADO: un fallo de escritura no
 *  tumba el arranque de la sesión, se loguea como warning Y SE DEVUELVE.
 *
 *  Con `conserva-el-mundo-en-disco` las escenas VIVAS se funden ENCIMA de las
 *  que sobrevivan del fichero (mismo world.md, mismo schema): las vivas ganan
 *  por id, así que el `tile_0_0` recién generado sustituye al injugable que
 *  mandó la sesión al bootstrap vivo y el fichero se cura solo, sin perder el
 *  anillo. Con `reemplaza-el-mundo` se escribe solo lo generado — regenerar es
 *  regenerar, y resucitar una escena vieja ahí sería el bug contrario. */
export function writeSessionSnapshot(
  ctx: BridgeContext,
  gameId: string,
  entrySceneId: string,
  politica: PoliticaDeSnapshot,
): EscrituraDeSnapshot {
  if (!ctx.persistWorldSnapshots)
    return { escrito: false, motivo: "este bridge no persiste snapshots de mundo" };
  try {
    const worldDoc = loadWorldDoc(ctx.gamesDir, gameId);
    const worldDocHash = createHash("sha256").update(worldDoc, "utf-8").digest("hex");
    const vivas: Record<string, Record<string, unknown>> = {};
    for (const [id, rec] of Object.entries(ctx.narrative.scenes_loaded)) {
      vivas[id] = structuredClone(rec.scene_data);
    }
    const conservadas =
      politica === "conserva-el-mundo-en-disco"
        ? escenasQueSobreviven(ctx.gamesDir, gameId, worldDocHash)
        : {};
    const scenes = { ...conservadas, ...vivas };
    const mapaVivo = structuredClone(ctx.narrative.worldMap.serialize());
    writeWorldSnapshot(ctx.gamesDir, {
      schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
      game_id: gameId,
      world_doc_hash: worldDocHash,
      generated_at: new Date().toISOString(),
      world_map: mapaVivo,
      scenes,
      entry_scene_id: entrySceneId,
    });
    const heredadas = Object.keys(scenes).filter((id) => !(id in vivas));
    console.log(
      `Bridge: world snapshot escrito para "${gameId}" ` +
        `(${Object.keys(scenes).length} escenas: ${Object.keys(vivas).length} de la sesión` +
        `${heredadas.length > 0 ? ` + ${heredadas.length} conservadas del mundo en disco` : ""}` +
        `, política ${politica})`,
    );
    // El mapa que se escribe es el de la sesión VIVA; las conservadas traen el
    // `place_id` de la generación ANTERIOR. Si el bootstrap sembró otros ids
    // —con un motor real es lo normal, con el falso coinciden— esas escenas
    // quedan apuntando a lugares que el mapa nuevo no nombra, y su panel
    // «Salidas» saldrá vacío: el defecto de #172, que aquí llegaba SIN UN
    // SOLO AVISO (QA de #451, H-1). Conservarlas sigue siendo mejor que
    // tirarlas —que es el bug que esta PR arregla—, pero callarlo no: quien
    // conoce la causa es este escritor, y es donde se dice.
    const colgando = escenasSinLugarEnElMapa(
      Object.fromEntries(heredadas.map((id) => [id, scenes[id]])),
      mapaVivo,
    );
    if (colgando.length > 0) {
      const lugares = [...new Set(colgando.map((c) => c.placeId))];
      console.warn(
        `Bridge: world snapshot de "${gameId}": ${colgando.length} escena(s) CONSERVADAS ` +
          `apuntan a lugares que el world_map nuevo no nombra ` +
          `(${lugares.map((l) => `"${l}"`).join(", ")}) — su panel «Salidas» saldrá vacío ` +
          `hasta que el motor las regenere: ${colgando.map((c) => c.sceneId).join(", ")}`,
      );
    }
    return { escrito: true, escenas: Object.keys(scenes).length };
  } catch (err) {
    console.warn(`Bridge: world snapshot no se pudo escribir para "${gameId}":`, err);
    return { escrito: false, motivo: (err as Error).message ?? String(err) };
  }
}

/** Adjunta el vocabulario canónico del juego (si existe y está vigente) al
 *  contexto de un turno de tile/realize. Un vocabulario ilegible se REPORTA
 *  y no rompe la generación (el turno va sin él). */
export function attachWorldVocabulary(
  ctx: BridgeContext,
  llmCtx: import("../src/narrative/types.js").LlmContext,
): void {
  try {
    const vocab = loadWorldVocabulary(
      ctx.gamesDir,
      ctx.narrative.game_id,
      ctx.narrative.world.world_doc_hash,
    );
    if (vocab && vocab.entries.length > 0) {
      llmCtx.world_vocabulary = vocab.entries;
    }
  } catch (err) {
    console.warn(
      `Bridge: world vocabulary ilegible para "${ctx.narrative.game_id}":`,
      err,
    );
  }
}

/** Guardia anti-takeover de sesión: key del job de generación en vuelo (o del
 *  primero encolado), o null con la cola vacía. `ctx.narrative` es un
 *  SINGLETON: si un start/resume cambia la sesión activa con un job en vuelo,
 *  el job escribiría su escena (y el motor sus tools de mapa) en la sesión
 *  NUEVA — reproducido el 2026-08-17 contaminando el world_map de otro save.
 *  Mientras esta función devuelva key, cambiar de sesión debe rechazarse. */
export function generationBusyKey(ctx: BridgeContext): string | null {
  return ctx.sceneGen.current ?? ctx.sceneGen.pending[0] ?? null;
}

/** Defensa en profundidad de los jobs con awaits largos: al resolver
 *  `generateScene`/`reportPlayerChoice`, si la sesión activa ya no es la que
 *  originó el job, el resultado se DESCARTA sin escribir (el caller difunde
 *  su narrative_status de error con este mensaje). */
export function sessionChangedError(ctx: BridgeContext, jobSessionId: string): string | null {
  if (ctx.narrative.session_id === jobSessionId) return null;
  return (
    `la sesión activa cambió durante la generación (era ${jobSessionId}, ` +
    `ahora ${ctx.narrative.session_id}) — resultado descartado sin escribir`
  );
}

/** Añade a `sceneIds` los ids de escena del vecindario 3×3 alrededor del tile
 *  de `rec` (no-op sin `rec`). Criterio compartido por la
 *  proyección de enemigos y la vida ambiental de NPCs: el mundo es continuo y
 *  lo "cercano" es el tile más sus 8 adyacentes. */
export function addNeighborhoodSceneIds(
  ctx: BridgeContext,
  rec: SceneRecord | undefined,
  sceneIds: Set<string>,
): void {
  if (!rec) return;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const n = ctx.narrative.getTile(rec.tile.tx + dx, rec.tile.ty + dy);
      const id = n ? (n.scene_data.scene_id as string | undefined) : undefined;
      if (id) sceneIds.add(id);
    }
  }
}

/** Los mensajes que SÍ llevan sello de sesión: lo que el sellador puede
 *  aceptar. Se deriva del propio `ServerMessage` en vez de enumerarse, así que
 *  un mensaje nuevo con `sessionId` requerido entra solo — y uno que se
 *  direcciona de otra forma queda fuera solo, que es lo que hace falta desde
 *  #313: `NarrativeStatusDeJuego` no tiene `sessionId`, así que sellarlo no es
 *  que esté desaconsejado, es que NO COMPILA. Sin este estrechamiento el
 *  sellador seguía aceptándolo (un `Omit<T,"sessionId">` sobre un tipo que no
 *  lo tiene es el tipo entero) y la pre-generación volvía a salir con un sello
 *  inventado, con el criterio de #313 cumplido solo por casualidad. */
export type ConSelloDeSesion = Extract<ServerMessage, { sessionId: string }>;

/** Los mensajes que llevan el sello de #659 —DE QUIÉN ES EL SIM que
 *  describen—, derivados igual que los de arriba y por el mismo motivo: un
 *  mensaje nuevo con `delSim` requerido entra solo y sale solo de `SinSello`.
 *
 *  Hoy es uno (`state_update`) y el tipo no lo nombra, que es la diferencia
 *  entre esto y la lista escrita a mano que `replay-server.mjs` tuvo que
 *  corregir dos veces. El campo se llama `delSim` y no `sessionId`
 *  precisamente para que los dos sellos no se pisen: un `state_update` NO es
 *  `ConSelloDeSesion`, así que `broadcastNarrative` y `enviarNarrativo` no
 *  pueden tocarlo, y lo que sella la SESIÓN VIGENTE no puede estampar una
 *  identidad que solo conoce `world-claim.ts`. */
export type ConDuenoDelSim = Extract<ServerMessage, { delSim: DuenoDelSim }>;

/** Los mensajes de servidor que NO llevan sello de sesión: lo que `send`
 *  puede mandar sin pasar por el sellador. Se deriva del propio tipo, así que
 *  un mensaje nuevo con `sessionId` requerido queda fuera solo.
 *
 *  Excluye ADEMÁS el arma de juego a mano, y esta es la única entrada
 *  enumerada del tipo: `NarrativeStatusDeJuego` no tiene `sessionId`, así que
 *  el `Exclude` de arriba lo dejaría pasar y `send` podría emitir un
 *  `narrative_status` a un socket suelto — o sea, un segundo camino de salida
 *  para el mensaje que acaba de ganar el suyo (`difundirDeJuego`). El
 *  invariante que declara `send` («no admito los mensajes que llevan sello»)
 *  se habría ensanchado en silencio a «no admito los que llevan ESE sello».
 *
 *  Excluye ADEMÁS lo que lleva el sello de #659 (`ConDuenoDelSim`): el día que
 *  `state_update` ganó su campo requerido, los cuatro `ctx.send(ws, …)` de
 *  `handlers/simulation.ts` DEJARON DE COMPILAR, que es el tipo haciendo su
 *  trabajo — el quinto emisor que aparezca tampoco podrá olvidarse del sello,
 *  porque no tiene por dónde salir sin él. */
export type SinSello = Exclude<
  ServerMessage,
  ConSelloDeSesion | ConDuenoDelSim | NarrativeStatusDeJuego
>;

/** Estampa el sello de sesión en un mensaje que sale hacia un cliente (#282).
 *
 *  NO existe por el tipado. Comprobado el 2026-08-28: el spread en línea
 *  —`{ ...msg, sessionId }`, sin cast y sin función— compila, es asignable a
 *  `ServerMessage` y `SinSelloDeSesion` sigue rechazando al emisor que escriba
 *  el sello por su cuenta. Lo que NO valía era el `as ServerMessage`: ese sí
 *  deja pasar un difusor que se olvide del sello, y también está medido.
 *
 *  Existe porque hay TRES sitios que sellan —el broadcast y el unicast de
 *  `ws-server.ts` y el doble de `test/helpers.ts`— y tienen que hacerlo
 *  EXACTAMENTE igual: si el doble sellara distinto, los tests de bridge
 *  medirían un cable que no existe y el sello se podría romper en producción
 *  con todo en verde. Una función es lo que hace que «igual» no dependa de
 *  que alguien copie bien. */
export function sellarSesion<T extends { type: string }>(
  msg: T,
  sessionId: string,
): T & { sessionId: string } {
  return { ...msg, sessionId };
}

/** Lo mismo para el sello de #659, y existe por la MISMA razón que el de
 *  arriba: hay DOS sitios que lo estampan —`ws-server.ts` y el doble de
 *  `test/helpers.ts`— y tienen que hacerlo exactamente igual. Si el doble
 *  sellara distinto, los tests de bridge medirían un cable que no existe y el
 *  sello se podría romper en producción con todo en verde. */
export function sellarDuenoDelSim<T extends { type: string }>(
  msg: T,
  delSim: DuenoDelSim,
): T & { delSim: DuenoDelSim } {
  return { ...msg, delSim };
}

/** UN SITIO YA MIRADO donde pedirle al cliente que aparezca — y el tipo es el
 *  candado, no un adorno.
 *
 *  Difundir un `spawn` es mandar al jugador a una coordenada, así que el punto
 *  crudo NO entra aquí: entra el veredicto de haber preguntado por su solidez
 *  (`handlers/scene.ts`, `dondeAparecer`). El tercer desenlace de esa pregunta
 *  —«hay punto pero no hay dónde ponerse»— NO está en esta unión **a
 *  propósito**: quien lo tenga en la mano no puede pasar por aquí sin haberlo
 *  descartado antes, y el compilador se lo dice. Esa es la mitad que el tipo
 *  garantiza; lo que el tipo NO impide es que alguien escriba `sin ancla`
 *  teniendo un `sin sitio`, o que no pase `spawn` en absoluto —los cuatro
 *  broadcasts que no son un viaje lo omiten, y es correcto—. Se dice aquí
 *  porque la primera versión de #616 prometía «el spawn mudo es inexpresable»
 *  y QA lo desmintió en una corrida de `tsc`: borrar la guarda compilaba.
 *
 *   · `punto`     — aparece ahí, y ese punto se ha consultado.
 *   · `sin ancla` — el lugar no da punto de aparición: nadie se mueve. Es el
 *                   viaje narrative-paced, y NO es un fallo. */
export type SitioDeAparicion =
  | { de: "punto"; spawn: { x: number; z: number } }
  | { de: "sin ancla" };

/** Push a freshly loaded/realized scene to every narrative subscriber as the
 *  `scene_loaded` effect (`eventId: "scene_init"`) the clients render. Only
 *  real scenes pass through here — there is no "fallback minimal scene" any
 *  more. */
export function broadcastScene(
  ctx: BridgeContext,
  sceneId: string,
  scene: Record<string, unknown>,
  elapsedMs?: number,
  meta?: {
    edge?: import("../src/world-map/types.js").Edge;
    /** Punto de aparición que se PIDE al cliente en el `ready` (viaje a un
     *  place anclado): el cliente es dueño de su posición. Omitirlo es «esta
     *  difusión no mueve a nadie»; pasarlo exige un sitio YA MIRADO. */
    spawn?: SitioDeAparicion;
    /** De dónde sale esta escena: generada ahora, ya en sesión, o del mundo
     *  pre-generado. Viaja en el `ready` para que el cliente pueda AFIRMAR la
     *  diferencia en vez de suponerla. */
    source?: "engine" | "cache" | "snapshot";
  },
): void {
  // Contrato de render único: los clientes reciben la world scene normalizada
  // (objects/npcs en metros, __player_start, world_rect, place_id) CON el
  // combate vivo y las salidas del lugar encima. La persistencia
  // (scenes_loaded, saves, serializeForLlm) sigue en Format D crudo — sólo se
  // normaliza el wire, y por una sola puerta (`bridge/wire-scene.ts`).
  const worldScene = escenaParaElWire(ctx, sceneId, scene);
  // Aquí vivía una segunda vía a `GameStore.enemies`: una "proyección
  // canónica" NarrativeState.entities → enemies que REEMPLAZABA la lista
  // entera en cada broadcast. Se retiró con `state-projection.ts` (#323) y no
  // vuelve, por dos razones que se descubrieron midiendo:
  //
  //  1. Nunca tuvo productor. Filtraba por `type === "enemy"`, y ninguna
  //     entity del juego lo es: el enum de `spawn_entity` son npc/building/
  //     object y `EmittedSceneSchema` rechaza `kind:"enemy"`. Su único test
  //     fabricaba la entrada a mano.
  //  2. Y estando muerta hacía daño: como `getEnemyStates` ITERA
  //     `store.state.enemies`, el primer cambio de tile tras un
  //     `add_combatants` borraba del `state_update` a un enemigo que seguía
  //     vivo en el sim. La barra de vida se congelaba y el combate se perdía.
  //
  // La vía viva —la única— es world scene → `npcs[].combat` → cliente →
  // `add_combatants` → `sim.addCombatant`, y ésa sí añade combatiente al sim,
  // que es lo que `getEnemyStates` exige para emitir nada.
  ctx.broadcastNarrative({
    type: "narrative_event",
    eventId: "scene_init",
    consequences: [],
    // Un effect propio (`SceneLoadedEffect`, protocol/messages.ts) y no un
    // `spawn_entity` con la escena escondida en `data`: cargar una escena no
    // es materializar una entity, y el spawn exige un `name` que aquí no hay
    // (#397). El `eventId: "scene_init"` se conserva: es lo que cuentan los
    // guiones que afirman «cero re-difusiones».
    effects: [{ kind: "scene_loaded", sceneId, scene: worldScene }],
  });
  // El ready lleva las coords del tile para el velo/notificación direccional
  // del cliente. Siempre `kind:"tile"` (#405): toda escena servida es un tile.
  // El `kind:"scene"` sigue vivo para el VIAJE (generating/error de
  // handlers/scene.ts), que es otro hecho — «no se pudo preparar el sitio».
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "ready",
    kind: "tile",
    tile: worldScene.tile,
    edge: meta?.edge,
    // El colapso a coordenada-o-nada ocurre AQUÍ y en ningún otro sitio: el
    // wire lleva `{x,z}` opcional desde siempre y no cambia. Lo que cambia es
    // que para llegar hasta aquí hay que traer el veredicto entero.
    spawn: meta?.spawn?.de === "punto" ? meta.spawn.spawn : undefined,
    source: meta?.source,
    elapsedMs,
  });
  // La escena difundida puede traer NPCs nuevos (registrados por
  // recordSceneLoaded) — engancharlos a la vida ambiental.
  npcSync(ctx);
}

/** Nivel 3 del tick (§7.4): pasa los plugin_events recolectados por
 *  dispatchConsequences al dispatcher de plugins. El tick es transaccional:
 *  en error no se commitea nada, se loguea y se propaga narrative_status al
 *  cliente (las consequences core ya aplicadas se conservan). El save lo hace
 *  el caller — un único save por tick. */
export function runPluginTick(
  ctx: BridgeContext,
  eventId: string,
  events: PluginEventInput[],
): PluginAppliedEffect[] {
  if (events.length === 0) return [];
  const result = dispatchPluginEvents(ctx.narrative, ctx.activePlugins, events);
  // Referencia colgante: se dice ENTERA en el log (es donde se depura) y el
  // turno sigue con los demás eventos. Lo que el jugador nota es que ese
  // tenderete no le vende, no un overlay a pantalla completa.
  for (const u of result.undelivered) {
    console.warn(
      `Bridge: evento '${u.type}' no entregado en ${eventId} (${u.reason}, ` +
        `plugin ${u.pluginId.slice(0, 12)}…) — se omite ese evento; el resto del tick sigue`,
    );
  }
  if (!result.ok) {
    console.error(`Bridge: plugin tick aborted for ${eventId}:`, result.error);
    // `plugin` y no `consequences` (#352): un sistema del juego reventó su
    // turno. El cuerpo ya nombraba al plugin; el titular decía «el motor
    // narrativo rechazó la respuesta» y mandaba a mirar el sitio equivocado.
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "plugin",
      // Al jugador, la frase; el volcado del error ya está en el log de arriba.
      message: result.error
        ? describePluginTickError(result.error, (id) => ctx.narrative.resolvePluginRecord(id)?.name)
        : "Un sistema del juego no pudo completar el turno.",
    });
    return [];
  }
  return result.effects;
}

/** Evaluate the map triggers crossed by a place transition and dispatch their
 *  consequences. Fires player_left on the old place, player_entered/first_visit
 *  on the new one. Pre-authored by the narrative engine via map_add_trigger. */
export async function fireMapTriggers(
  ctx: BridgeContext,
  prevPlaceId: string,
  newPlaceId: string,
): Promise<void> {
  const fired: PlaceTriggerSpec[] = [];
  if (prevPlaceId && prevPlaceId !== newPlaceId) {
    fired.push(...ctx.mapTriggers.evaluateLeave(prevPlaceId));
  }
  fired.push(...ctx.mapTriggers.evaluateEnter(newPlaceId));
  if (fired.length === 0) return;
  // evaluateEnter may have stamped first_visit triggers — persist that.
  await ctx.narrative.save();

  const consequences = fired.flatMap((t) => t.consequences);
  if (consequences.length === 0) return;
  const eventId = "map_trigger";
  const playerPos = ctx.store.state.player.pos;
  const dispatched = dispatchConsequences(ctx.narrative, eventId, consequences, {
    playerPosition: { x: playerPos[0], y: playerPos[1], z: playerPos[2] },
    playerForward: { x: 0, y: 0, z: -1 },
  });
  const pluginFx = runPluginTick(ctx, eventId, dispatched.pluginEvents);
  await ctx.narrative.save();
  ctx.broadcastNarrative({
    type: "narrative_event",
    eventId,
    consequences,
    effects: [...dispatched.effects, ...pluginFx],
  });
}

/** Crea el NpcBehaviorSystem de la sesión con el adapter real del bridge
 *  (colisión server-side + world map + entities). id ausente → default
 *  "ambient"; id desconocido → throw (fail-loud, el caller decide abortar). */
export function createSessionNpcBehavior(
  ctx: BridgeContext,
  id: string | undefined,
): NpcBehaviorSystem {
  return npcBehaviorRegistry.create(id, {
    // Sembrado por sesión (no por reloj): el wander es reproducible entre
    // resumes y en tests — la flakiness de bridge-npc venía de Date.now().
    rng: seededRng(`${ctx.narrative.session_id}:npc`),
    world: {
      queImpideElPaso: (fx, fz, tx, tz, r) => ctx.simCollision.queImpideElPaso(fx, fz, tx, tz, r),
      porDondeSalirDeAqui: (x, z, r) => ctx.simCollision.porDondeSalirDeAqui(x, z, r),
      blocksCircle: (x, z, r) => ctx.simCollision.blocksCircle(x, z, r),
      resolvePlaceTarget: (placeId) => resolvePlaceTarget(ctx.narrative, placeId),
      getEntityPosition: (entityId) => {
        const e = ctx.narrative.getEntity(entityId);
        return e ? { x: e.position[0], y: e.position[1], z: e.position[2] } : null;
      },
    },
  });
}

/** Reconcilia el behavior system con NarrativeState.entities: gestiona los
 *  NPC cuyo scene_id cae en el vecindario 3×3 del tile activo (más la escena
 *  activa); los que salen se retiran y quedan congelados en su última
 *  posición (ya persistida en el EntityRecord). Llamar tras cargar/activar
 *  escenas y tras spawns dinámicos — nunca per-tick. */
export function npcSync(ctx: BridgeContext): void {
  const behavior = ctx.sim.npcBehaviorSystem;
  if (!behavior) return;
  const activeId = ctx.narrative.world.active_scene_id;
  const sceneIds = new Set<string>();
  if (activeId) sceneIds.add(activeId);
  addNeighborhoodSceneIds(ctx, activeId ? ctx.narrative.scenes_loaded[activeId] : undefined, sceneIds);
  const want = new Set<string>();
  for (const e of ctx.narrative.entities) {
    if (e.type !== "npc" || !sceneIds.has(e.scene_id)) continue;
    // Un HOSTIL no entra en la vida ambiental. No es higiene: `NpcBehaviorSystem`
    // MUTA `record.position` in situ cada tick, y a un combatiente lo mueve la
    // IA de combate del sim. Los dos a la vez son dos dueños de la misma
    // posición — el enemigo parpadearía entre dos sitios, saldría por los DOS
    // canales del `state_update` (`getNpcStates` y `getEnemyStates`) y, con
    // `flees_from_combat`, huiría de su propia pelea. Hasta hoy nada lo
    // impedía porque nunca hubo enemigos.
    if (isHostileRole(e.data.role)) continue;
    want.add(e.id);
    behavior.addNpc(e);
  }
  for (const id of behavior.ids()) {
    if (!want.has(id)) behavior.removeNpc(id);
  }
}

/** Nombre legible de un NPC para el log ambiental (data.name o el id). */
export function npcLabel(ctx: BridgeContext, npcId: string): string {
  const name = ctx.narrative.getEntity(npcId)?.data.name;
  return typeof name === "string" && name ? name : npcId;
}

export function getNpcStates(ctx: BridgeContext): StateUpdateMessage["npcs"] {
  const behavior = ctx.sim.npcBehaviorSystem;
  if (!behavior) return undefined;
  return behavior.states().map((s) => ({
    id: s.id,
    pos: s.pos,
    forward: s.forward,
    moving: s.moving,
    run: s.run,
    anim: s.anim,
    state: s.mode,
  }));
}

export function getEnemyStates(ctx: BridgeContext): StateUpdateMessage["enemies"] {
  const result: StateUpdateMessage["enemies"] = [];
  // Iterate store enemies since we can't enumerate combatants map directly
  for (const e of ctx.store.state.enemies) {
    const c = ctx.sim.getCombatant(e.id);
    if (c) {
      result.push({
        id: c.id,
        hp: c.health,
        state: c.state,
        alive: c.health > 0,
        pos: { x: c.position.x, y: c.position.y, z: c.position.z },
        forward: { x: c.forward.x, y: c.forward.y, z: c.forward.z },
        attackType: c.currentAttackType || undefined,
      });
    }
  }
  return result;
}
