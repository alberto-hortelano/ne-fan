/** Game client over the WebSocket bridge. There is no local-simulation
 *  fallback any more: per CONFIG.session.require_bridge, the bridge MUST be
 *  reachable or the game refuses to start (see `createGameClient` below).
 *
 *  Lo que SÍ existe sin bridge es `ViewerGameClient`: un cliente inerte que no
 *  simula nada y solo deja que el game loop pinte. No es un modo de juego —es
 *  el visor de fixtures del preset `html-fixtures`— y quien lo instala
 *  (main.ts, bootstrap) lo hace DESPUÉS de decir el error, nunca en su lugar. */

import { GameStore } from "@nefan-core/src/store/game-store.js";
import type { CombatEvent, Vec3, EnemyPersonality } from "@nefan-core/src/types.js";
import type { StateUpdateMessage } from "@nefan-core/src/protocol/messages.js";
import {
  identidadDelCliente,
  repartirEstado,
} from "@nefan-core/src/protocol/dueno-del-sim.js";
import type { WorldScene } from "@nefan-core/src/scene/scene-normalize.js";
import { CONFIG } from "@nefan-core/src/config.js";
import { AVISO_PARTIDA, DETALLE_SIN_PARTIDA, errors } from "../ui/error-log.js";
import { BridgeClient } from "./bridge-client.js";

export interface FrameResult {
  events: CombatEvent[];
  playerHp: number;
  /** Sobre cuánta vida, y con qué pega. Los dos los dice el bridge en cada
   *  `state_update` (#504): antes eran dos constantes de `main.ts` y el
   *  cliente decidía por su cuenta el máximo de la barra y el arma con la que
   *  se calcula el aro del telegraph. */
  playerMaxHp: number;
  playerWeaponId: string;
  enemies: {
    id: string;
    hp: number;
    state: string;
    alive: boolean;
    pos?: { x: number; y: number; z: number };
    forward?: { x: number; y: number; z: number };
    attackType?: string;
  }[];
  /** Vida ambiental de NPCs del bridge (state_update.npcs). */
  npcs?: StateUpdateMessage["npcs"];
}

export interface TickInputs {
  playerPosition: Vec3;
  playerForward: Vec3;
  playerMoving: boolean;
  attackRequested?: boolean;
  attackType?: string;
}

export interface RoomEnemy {
  id: string;
  position: Vec3;
  /** La vida que le queda AHORA: la del contrato en un enemigo nuevo, la del
   *  save en uno que vuelve herido. */
  health: number;
  /** Y sobre cuánta. Sin este campo el bridge ponía `maxHealth = health` y un
   *  herido reanudado volvía con la barra llena (#326). */
  maxHealth: number;
  weaponId: string;
  personality: EnemyPersonality;
}

/** El arma y el máximo con los que se pinta ANTES del primer `state_update`:
 *  los del store, que son los MISMOS con los que arranca el bridge (el mismo
 *  `createInitialState`). Aquí no se escribe ningún literal: el día que el
 *  jugador nazca con otra arma, nace en un sitio. */
const jugadorDeArranque = (store: GameStore) => ({
  playerMaxHp: store.state.player.max_hp,
  playerWeaponId: store.state.player.weapon_id,
});

/** DE QUIÉN ES EL SIM que este cliente espera ver, y a quién decírselo (#659).
 *
 *  Argumento del constructor y no opción con defecto, como el `DeQuienEs` del
 *  embudo narrativo: un defecto «acepta todo» sería el bug de vuelta y en
 *  silencio. Da el ID y no un predicado porque aquí no se COMPARA nada — la
 *  identidad la construye `identidadDelCliente` y la decisión la toma
 *  `repartirEstado`, las dos en core (`protocol/dueno-del-sim.ts`). */
export interface DeQuienEsElSim {
  /** El id de la partida aplicada en esta página; "" en el título. Lo contesta
   *  `session-facets.ts` (core), dueño de «cuál es la mía». */
  idDeLaPartida(): string;
  /** La línea del juego. Un frame descartado NO se calla: es el síntoma de que
   *  una partida muerta sigue viva en el sim del bridge. */
  log(msg: string): void;
}

export type GameClientEvent = "connected" | "disconnected";
type EventHandler = (...args: unknown[]) => void;

export interface GameClient {
  tick(delta: number, inputs: TickInputs): FrameResult;
  /** Un frame SIN conducir la simulación: se pinta, pero no se manda input.
   *  Es lo que corre mientras el título cubre la pantalla — ahí no hay
   *  jugador que simular, y el frame que se mandaba llevaba la posición por
   *  defecto del cliente. Con el save arrastrando la posición viva del sim
   *  (#245), ese frame se llevaba por delante la partida guardada. */
  idle(): FrameResult;
  loadRoom(roomData: Pick<WorldScene, "dimensions">, roomId: string, enemies: RoomEnemy[]): void;
  /** Alta aditiva de combatientes (enemigos de un tile nuevo): no resetea el
   *  sim ni al player — el mundo es un plano continuo. */
  addEnemies(enemies: RoomEnemy[]): void;
  respawn(pos: Vec3): void;
  /** Los tres números del JUGADOR del último frame del bridge. Sin `id` a
   *  propósito (#526): la rama de ENEMIGO existía, no la llamaba nadie, y
   *  devolvía `maxHealth: e.hp` —el máximo derivado de la vida ACTUAL, la
   *  mentira que #326 arregló en el otro canal— con el arma escrita a mano.
   *  Borrarla con su tipo es lo que impide que el siguiente consumidor la
   *  encuentre y se la crea. El máximo y el arma de un enemigo los tiene el
   *  sim; el día que el cliente los necesite, viajan en el `state_update`. */
  jugadorEnCombate(): { health: number; maxHealth: number; weaponId: string };
  /** Olvida lo que el cliente creía saber del sim: el frame pendiente, el
   *  último bueno y el modo fixtures. Lo llama el sink `estadoDelSim` de
   *  `session-facets.ts` al cambiar de partida — volver al título incluido
   *  (#659); sin esto `idle()` repite el frame de la partida muerta. */
  olvidarElUltimoFrame(): void;
  /** Cuántos `state_update` de OTRO sim se han tirado aquí. Lo lee el banco por
   *  `__nefan.estadosTirados()`, y existe por lo mismo que `descartados()` del
   *  embudo narrativo: sin contador, «no llegó» y «llegó y se descartó» son el
   *  mismo verde. En un flujo normal vale CERO; si sube, la página está
   *  tirando lo suyo. */
  estadosTirados(): number;
  isConnected: boolean;
  isBridge: boolean;
  on(event: GameClientEvent, handler: EventHandler): void;
  store: GameStore;
}

// --- Bridge mode: WebSocket to nefan-core ---

export class BridgeGameClient implements GameClient {
  private bridge: BridgeClient;
  store: GameStore;
  private lastState: FrameResult;
  private pendingFrame: FrameResult | null = null;
  /** ¿Esta página mira una fixture del selector «Room»? Lo pone `loadRoom()`,
   *  su único llamante (`world/carga-de-tile.ts`, con `tomaElMundo`), y es la
   *  mitad que distingue los dos regímenes de direccionamiento de este canal.
   *  Se olvida con el resto (`olvidarElUltimoFrame`). */
  private enPrueba = false;
  /** Frames de OTRO sim tirados aquí; lo lee el banco por `__nefan`. */
  private tirados = 0;
  isConnected = false;
  isBridge = true;
  private handlers: Map<GameClientEvent, EventHandler[]> = new Map();

  constructor(
    bridge: BridgeClient,
    store: GameStore,
    private deQuienEs: DeQuienEsElSim,
  ) {
    this.bridge = bridge;
    this.store = store;
    this.lastState = { events: [], playerHp: 100, enemies: [], ...jugadorDeArranque(store) };

    bridge.on("state_update", (msg) => {
      if (!msg) return;
      // EL EMBUDO ÚNICO DEL ESTADO (#659). El sim del bridge es UNO y
      // `release()` no lo vacía: al cerrarse el socket de una partida, el
      // siguiente que mande un `input` recibe de vuelta su jugador y sus NPCs
      // (`world-claim.ts`, `canDrive` sin dueño). Ese frame no es de esta
      // página. La decisión vive en core (`protocol/dueno-del-sim.ts`) y aquí
      // solo se entrega, por el precedente de `repartirStatus`: un `if` a mano
      // aquí nace sin nada que lo mida y lo muerde la regla
      // `la-logica-de-juego-no-vuelve-al-cliente`.
      //
      // El sello se comprueba ANTES de usarlo, por lo mismo que la guarda de
      // abajo: el canal solo está TIPADO y por el socket entra lo que entre (el
      // guion 69 le mete basura a propósito), así que un frame sin `delSim`
      // reventaría el manejador con un `TypeError` en vez de dejar una línea.
      if (typeof msg.delSim !== "object" || msg.delSim === null || !("de" in msg.delSim)) {
        errors.push(
          "bridge",
          `state_update sin delSim (${JSON.stringify(msg.delSim)}): el bridge no es de esta versión ` +
            `y este frame no dice de qué partida es`,
        );
        return;
      }
      const reparto = repartirEstado(
        msg.delSim,
        identidadDelCliente(this.deQuienEs.idDeLaPartida(), this.enPrueba),
      );
      if (reparto.destino === "descartado") {
        this.tirados++;
        this.deQuienEs.log(`↩ estado de ${reparto.deQuien} descartado`);
        return;
      }
      // Fail-loud (QA de la PR 4 de #241, H1): el canal servidor→cliente solo
      // está TIPADO, ningún zod lo valida, y el HUD depende de estos dos campos.
      // Sin la guarda, un `state_update` que no los traiga deja la barra de vida
      // en `width: NaN%` (congelada) y el aro a manos desnudas, con el registro
      // diciendo «sin errores». Se conserva el último frame bueno y se avisa.
      if (typeof msg.playerMaxHp !== "number" || typeof msg.playerWeaponId !== "string") {
        errors.push(
          "bridge",
          `state_update sin playerMaxHp/playerWeaponId (${JSON.stringify({
            playerMaxHp: msg.playerMaxHp,
            playerWeaponId: msg.playerWeaponId,
          })}): el bridge no es de esta versión`,
        );
        return;
      }
      const frame: FrameResult = {
        events: msg.events ?? [],
        playerHp: msg.playerHp,
        playerMaxHp: msg.playerMaxHp,
        playerWeaponId: msg.playerWeaponId,
        enemies: msg.enemies ?? [],
        npcs: msg.npcs,
      };
      this.pendingFrame = frame;
      this.lastState = frame;
    });

    bridge.on("connected", () => {
      this.isConnected = true;
      this.emit("connected");
    });

    bridge.on("disconnected", () => {
      this.isConnected = false;
      this.emit("disconnected");
    });

    this.isConnected = bridge.isConnected;
  }

  on(event: GameClientEvent, handler: EventHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  private emit(event: GameClientEvent, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  tick(delta: number, inputs: TickInputs): FrameResult {
    this.bridge.sendInput(delta, inputs);
    return this.idle();
  }

  /** Lo mismo SIN mandar input: consume el frame pendiente si lo hay (un
   *  state_update en vuelo sigue siendo estado real) y si no repite el último
   *  conocido sin eventos.
   *
   *  QUÉ REPITE, que es donde estaba la otra mitad de #659: el último frame que
   *  este cliente ACEPTÓ. Con el título delante es lo único que corre, así que
   *  mientras el recuerdo no se olvidara, volver al título seguía pintando el
   *  HP y los NPCs de la partida soltada contra un mundo ya vaciado. */
  idle(): FrameResult {
    if (this.pendingFrame) {
      const frame = this.pendingFrame;
      this.pendingFrame = null;
      return frame;
    }
    return { ...this.lastState, events: [] };
  }

  loadRoom(roomData: Pick<WorldScene, "dimensions">, roomId: string, enemies: RoomEnemy[]): void {
    // Cargar una fixture es pasar al OTRO régimen: el sim del bridge es una
    // escena de prueba (`claimForFixture`) y esta página tiene que reconocer
    // como suyo lo que describa —incluida la respuesta a este `load_room`—. Se
    // pone ANTES de mandarlo: la respuesta llega en el microtask siguiente.
    this.enPrueba = true;
    // El mundo anterior ya se retiró: su último frame no describe esta fixture.
    this.pendingFrame = null;
    this.lastState = { ...this.lastState, events: [], enemies: [], npcs: [] };
    const { width, depth } = roomData.dimensions;
    this.bridge.sendLoadRoom(
      roomId,
      enemies.map(e => ({
        id: e.id, position: e.position, health: e.health, maxHealth: e.maxHealth,
        weaponId: e.weaponId, personality: e.personality,
      })),
      { width, depth },
    );
  }

  estadosTirados(): number {
    return this.tirados;
  }

  /** Ver `GameClient.olvidarElUltimoFrame`. Vuelve al neutro EXACTO del
   *  constructor —el jugador de arranque del store, sin enemigos ni NPCs— y
   *  sale del modo fixtures: quien vuelve al título no está mirando ninguna. */
  olvidarElUltimoFrame(): void {
    this.pendingFrame = null;
    this.lastState = {
      events: [],
      playerHp: 100,
      enemies: [],
      npcs: [],
      ...jugadorDeArranque(this.store),
    };
    this.enPrueba = false;
  }

  addEnemies(enemies: RoomEnemy[]): void {
    if (enemies.length === 0) return;
    this.bridge.sendAddCombatants(
      enemies.map(e => ({
        id: e.id, position: e.position, health: e.health, maxHealth: e.maxHealth,
        weaponId: e.weaponId, personality: e.personality,
      })),
    );
  }

  respawn(pos: Vec3): void {
    this.bridge.sendRespawn(pos);
  }

  jugadorEnCombate() {
    // Los tres del último frame del bridge. Hasta #504 el máximo y el arma
    // eran literales de aquí que nadie leía —solo se consultaba `health`, para
    // el respawn—, así que llevaban mintiendo desde que se escribieron; hoy el
    // arma la lee el HUD para el aro del telegraph.
    const s = this.lastState;
    return { health: s.playerHp, maxHealth: s.playerMaxHp, weaponId: s.playerWeaponId };
  }
}

/** Cliente INERTE: no simula, no habla con nadie, no guarda. Existe para que
 *  el game loop pueda pintar cuando no hay bridge — sin esto `gameClient` se
 *  queda a null, el loop sale por su guarda antes de `render()` y el lienzo se
 *  queda NEGRO con la escena cargada (issue #215): el preset `html-fixtures`
 *  prometía iterar renderer y UI sin backend y no pintaba nada.
 *
 *  Lo que NO hace es tan importante como lo que hace: sin combate (los ataques
 *  animan y no aplican daño), sin enemigos, sin narrativa y sin partida. La
 *  vida se queda quieta al máximo porque nadie la baja, no porque el jugador
 *  sea invulnerable: aquí no hay quien pegue. */
export class ViewerGameClient implements GameClient {
  store: GameStore;
  /** Frame neutro y CONSTANTE: se reusa en cada tick porque no cambia nunca —
   *  un objeto nuevo por frame sería basura para el GC a 60 fps. Sin bridge no
   *  hay quien diga el arma, pero el aro del telegraph se pinta igual sobre las
   *  fixtures y tiene que ser el mismo que en partida: el del jugador de
   *  arranque. */
  private readonly frame: FrameResult;
  isConnected = false;
  isBridge = false;

  constructor(store: GameStore) {
    this.store = store;
    this.frame = { events: [], playerHp: 100, enemies: [], ...jugadorDeArranque(store) };
  }

  tick(): FrameResult {
    return this.frame;
  }

  /** Sin simulación, conducir y no conducir son lo mismo. */
  idle(): FrameResult {
    return this.frame;
  }

  /** Los enemigos de una fixture se ignoran a propósito: sin simulación,
   *  pintarlos sería enseñar muñecos que no reaccionan a nada. */
  loadRoom(): void {}
  addEnemies(): void {}
  respawn(): void {}

  /** No hay nada que olvidar: su frame es constante y no viene de ningún sim. */
  olvidarElUltimoFrame(): void {}

  /** Sin socket no llega nada que tirar. */
  estadosTirados(): number {
    return 0;
  }

  jugadorEnCombate() {
    const f = this.frame;
    return { health: f.playerHp, maxHealth: f.playerMaxHp, weaponId: f.playerWeaponId };
  }

  /** Nunca emite: no hay conexión que se caiga ni que vuelva. */
  on(): void {}
}

/** Visor de fixtures para cuando el bridge no está. Ver `ViewerGameClient`. */
export function createViewerClient(): GameClient {
  return new ViewerGameClient(new GameStore());
}

/** Wait for the BridgeClient to connect and then build a BridgeGameClient.
 *  If the bridge fails to connect within `timeoutMs`, the returned promise
 *  rejects — there is no local-simulation fallback. */
export function createGameClient(
  bridge: BridgeClient,
  deQuienEs: DeQuienEsElSim,
  timeoutMs = 5000,
): Promise<GameClient> {
  if (!CONFIG.session.require_bridge) {
    const msg = "session.require_bridge is false but no offline mode exists — refusing to start";
    // Quien lo pinta es el canal de avisos, no el `catch` de `bootstrap`: la
    // causa se dice desde quien la conoce (#469). Solo se llega aquí con la
    // configuración rota, y es el único fallo de arranque con titular propio.
    errors.push("session", msg, undefined, {
      alJugador: "No se pudo arrancar la partida",
      detalleAlJugador:
        "La configuración pide jugar sin servidor de partida y ese modo no existe. Revisa `session.require_bridge`.",
    });
    return Promise.reject(new Error(msg));
  }
  const store = new GameStore();
  if (bridge.isConnected) {
    return Promise.resolve(new BridgeGameClient(bridge, store, deQuienEs));
  }
  return new Promise<GameClient>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Este timeout es «el bridge no está», la MISMA causa que el `onerror`
      // del socket (`bridge-client.ts`), así que entra al canal con la misma
      // fuente, el mismo titular y el mismo detalle: la dedupe por trío de
      // `ErrorLog` hace que para el jugador sea UN muro y no dos (#469). La URL
      // que se cita es la EFECTIVA (`bridge.url`), no el puerto del snapshot
      // (#341), y va al REGISTRO —el `message`—, no al muro: el jugador no
      // tiene que leer `ws://` ni ms. El `Error` que se rechaza sigue siendo el
      // técnico: `bootstrap` lo registra y monta el visor, no lo pinta.
      const msg = `bridge did not connect within ${timeoutMs}ms — is nefan-core bridge running on ${bridge.url}?`;
      errors.push("bridge", msg, undefined, {
        alJugador: AVISO_PARTIDA,
        detalleAlJugador: DETALLE_SIN_PARTIDA,
      });
      // El oyente se SUELTA al rendirse, y no es higiene: tras el timeout esta
      // promesa ya está rechazada, así que el socket que abriera DESPUÉS
      // construía un `BridgeGameClient` que no iba a recibir nadie —suscrito a
      // `state_update` para siempre, escribiendo en un store que no lee ni
      // pinta nadie— y encima llamaba a un `resolve` sin efecto. Con la oferta
      // del bridge que llega tarde (#478) ese momento dejó de ser hipotético:
      // es el caso normal, y el cliente bueno lo construye la segunda vuelta.
      bridge.off("connected", alConectar);
      reject(new Error(msg));
    }, timeoutMs);
    function alConectar(): void {
      clearTimeout(timer);
      resolve(new BridgeGameClient(bridge, store, deQuienEs));
    }
    bridge.on("connected", alConectar);
  });
}
