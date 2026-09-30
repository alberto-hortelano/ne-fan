/** El NACIMIENTO del `BridgeContext` (#769): una sola fábrica para el bridge
 *  de verdad (`arranque.ts`) y para el harness de test (`makeCtx`).
 *
 *  Hasta #769 este literal vivía en `ws-server.ts`, que ningún test puede
 *  importar sin levantar el bridge, y `test/helpers.ts` lo ESPEJABA a mano —
 *  el escritor crudo y los cuatro verbos de sellado, «por la MISMA función que
 *  ws-server.ts»—. Un espejo así solo sujeta mientras nadie toque el original:
 *  si el de producción dejaba de sellar, los tests de bridge seguían midiendo
 *  el doble y el sello se rompía con todo en verde. Ahora los dos nacen aquí,
 *  y lo que los tests ejercen ES el cable. */

import { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import type { GameSimulation } from "../src/simulation/game-loop.js";
import type { GameStore } from "../src/store/game-store.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { SessionStorage } from "../src/narrative/session-storage.js";
import type { CombatConfig } from "../src/types.js";
import type { ServerMessage } from "../src/protocol/messages.js";
import { createSimCollisionProvider } from "./sim-collision.js";
import { createWorldClaim } from "./world-claim.js";
import { SceneGenQueue } from "./scene-gen-queue.js";
import {
  sellarSesion,
  sellarDuenoDelSim,
  type BridgeContext,
  type ClientSocket,
  type NarrativeAiClient,
} from "./context.js";

/** Lo que el contexto NO construye: el sim, el estado narrativo y los
 *  colaboradores con E/S, que el bridge real y el test montan distinto. */
export interface DependenciasDelContexto {
  sim: GameSimulation;
  combatConfig: CombatConfig;
  store: GameStore;
  narrative: NarrativeState;
  sessionStorage: SessionStorage;
  aiClient: NarrativeAiClient;
  gamesDir: string;
  stylesDir: string;
  persistWorldSnapshots: boolean;
}

/** El ÚNICO sitio que escribe en el socket. `send` no admite mensajes con
 *  sello (el tipo `SinSello` los deja fuera): los que llevan el de SESIÓN
 *  pasan por `sellarSesion` (#282) y el que lleva el de DUEÑO DEL SIM pasa por
 *  `sellarDuenoDelSim` (#659). Por eso el sellado no puede saltarse
 *  escribiendo a mano, y por eso este escritor es crudo.
 *
 *  Quién lleva sello lo dicen los tipos derivados de `context.ts`
 *  (`ConSelloDeSesion`, `ConDuenoDelSim`), que no se pueden quedar desfasados;
 *  un censo en este comentario sí se quedaría. */
function escribir(ws: ClientSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** El contexto y el conjunto de sockets suscritos a lo narrativo, que el
 *  transporte necesita para des-suscribir al cerrar (`conexion.ts`). */
export function crearContextoDelBridge(deps: DependenciasDelContexto): {
  ctx: BridgeContext;
  suscriptores: Set<ClientSocket>;
} {
  const { narrative, sim } = deps;
  // Players currently subscribed to narrative events (broadcast targets).
  const suscriptores = new Set<ClientSocket>();
  // Antes que el director y no después: `npc_arrive` pregunta al suelo dónde
  // soltar al NPC (#618), con la MISMA colisión que el sim.
  const simCollision = createSimCollisionProvider(narrative);
  const ctx: BridgeContext = {
    ...deps,
    mapTriggers: new MapTriggerEvaluator(narrative),
    npcDirector: new NpcDirector(narrative, simCollision),
    simCollision,
    activePlugins: new Map(),
    sceneGen: new SceneGenQueue(),
    despertar: { enVuelo: null },
    conversacion: { terminadas: 0 },
    posTracking: { cellKey: null, tileKey: null },
    world: createWorldClaim(narrative, sim),
    subscribe(ws) {
      suscriptores.add(ws);
    },
    send(ws, msg) {
      escribir(ws, msg);
    },
    // EL TRANSPORTE ESCRIBE EL SELLO, y estas dos funciones son los únicos
    // sitios del bridge que lo hacen (#282). El mensaje tiene que decir DE
    // QUIÉN es o el cliente no puede distinguir el tile de su partida del de la
    // que acaba de abandonar. Se estampa aquí y no en cada emisor porque son 23
    // llamadas y basta olvidar una para tirar un tile bueno; el tipo
    // `SinSelloDeSesion` impide que un emisor lo escriba por su cuenta.
    //
    // Qué significa EXACTAMENTE, para que nadie lo lea de más: «la sesión que
    // este bridge tiene activa en el instante de emitir». No es «la sesión que
    // pidió el trabajo» — eso lo sujeta aparte `sessionChangedError`, que hace
    // que un job de una sesión relevada ni siquiera llegue a difundirse.
    broadcastNarrative(msg) {
      const sellado = sellarSesion(msg, narrative.session_id);
      for (const ws of suscriptores) escribir(ws, sellado);
    },
    enviarNarrativo(ws, msg) {
      escribir(ws, sellarSesion(msg, narrative.session_id));
    },
    // EL TERCER VERBO NO SELLA, y por eso es un verbo y no una bandera (#313).
    // Lo que viaja por aquí se direcciona por JUEGO: no hay sesión que estampar,
    // y la que este bridge tuviera cargada al emitir no tiene nada que ver con
    // quien pidió el trabajo. Aquí no se nombra ningún `kind`: el reparto lo hace
    // el cliente mirando QUÉ IDENTIFICADOR trae el mensaje, y si esta función
    // tuviera que preguntar por el kind, la excepción que #313 quitó de
    // `repartirStatus` solo se habría mudado de sitio.
    difundirDeJuego(msg) {
      for (const ws of suscriptores) escribir(ws, msg);
    },
    // EL CUARTO VERBO, y tampoco es una bandera (#659). Lo que viaja por aquí se
    // direcciona por DE QUIÉN ES EL SIM: no es la sesión vigente del bridge —que
    // en el selector «Room» es la de la partida anterior, rancia— sino quién
    // reclamó el contenido del sim, que es lo único que describe este mensaje.
    // El sello sale de `ctx.world`, única fuente, y se estampa aquí y no en los
    // cuatro emisores por lo mismo de siempre: basta olvidarse en uno.
    enviarEstado(ws, msg) {
      escribir(ws, sellarDuenoDelSim(msg, ctx.world.delSim));
    },
  };
  return { ctx, suscriptores };
}
