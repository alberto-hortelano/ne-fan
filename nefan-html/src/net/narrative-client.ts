/** High-level narrative client for the HTML 2D renderer.
 *
 * Wraps BridgeClient with typed methods around session lifecycle and dialogue
 * events, and surfaces narrative_event broadcasts as a typed callback.
 */
import type { UiTheme } from "@nefan-core/src/games/ui-theme.js";
import { BridgeClient } from "./bridge-client.js";
import type {
  SessionMetadata,
  SessionData,
  ConsequenceEffect,
} from "@nefan-core/src/narrative/types.js";
import type {
  GamesListedMessage,
  NarrativeEventMessage,
  NarrativeStatusMessage,
} from "@nefan-core/src/protocol/messages.js";

export type GameInfo = GamesListedMessage["games"][number];
export type StyleInfo = GamesListedMessage["styles"][number];

export type NarrativeEventListener = (event: NarrativeEventMessage) => void;
export type NarrativeStatusListener = (status: NarrativeStatusMessage) => void;

/** De quién es lo que llega, y a quién decírselo (#282).
 *
 *  Es un argumento del constructor y no una opción con defecto a propósito: un
 *  defecto «acepta todo» sería el bug de vuelta, y en silencio. */
export interface DeQuienEs {
  /** ¿El sello de este mensaje es el de la partida aplicada en el cliente?
   *  Lo contesta `session-facets.ts` (core), que es el dueño de «cuál es la
   *  mía». */
  esMia(sessionId: string): boolean;
  /** La línea del juego. Un evento descartado no se calla: es el síntoma de
   *  que un tile llegó tarde, y saberlo es la diferencia entre depurar y
   *  adivinar. */
  log(msg: string): void;
}

export class NarrativeClient {
  private listeners = new Set<NarrativeEventListener>();
  private statusListeners = new Set<NarrativeStatusListener>();
  /** Eventos de OTRA partida tirados aquí. Lo lee el bench/QA por
   *  `__nefan.descartados()`: sin contador, «no llegó todavía» y «llegó y se
   *  descartó» son el mismo verde. */
  private tirados = 0;

  constructor(
    private bridge: BridgeClient,
    private deQuienEs: DeQuienEs,
  ) {
    this.bridge.on("narrative_event", (msg) => {
      if (!msg) return;
      // EL EMBUDO ÚNICO: todo `narrative_event` pasa por aquí, así que la
      // guarda está en un solo sitio. El bridge difunde a TODOS los
      // suscriptores; hasta #282 el mensaje no decía de quién era y el
      // cliente instalaba el tile de la partida que acababa de abandonar —y
      // el intento siguiente heredaba ese mundo.
      //
      // `addTile` no tiene un solo `await`, así que instala en el mismo
      // microtask: filtrar aquí llega a tiempo y no hay carrera con el
      // vaciado del mundo.
      if (!this.deQuienEs.esMia(msg.sessionId)) {
        this.tirados++;
        this.deQuienEs.log(
          `↩ evento de otra partida descartado (${msg.eventId}, sesión «${msg.sessionId}»)`,
        );
        return;
      }
      for (const fn of this.listeners) fn(msg);
    });
    this.bridge.on("narrative_status", (msg) => {
      if (!msg) return;
      // El status LLEVA sello pero NO se filtra, y es deliberado: descartar un
      // `phase:"error"` de una sesión recién muerta es el silencio que
      // prohíbe el fail-loud de esta casa. Qué hacer con un `ready` rancio sin
      // callar los `error` es una pregunta abierta, y va a issue.
      //
      // QUIEN AÑADA AQUÍ UN SEGUNDO FILTRO tiene que tocar también
      // `labs/narrative/replay-server.mjs`, que reestampa el sello justo de lo
      // que este embudo descarta: si no, `replay-web` reproduce una película
      // que el cliente tira entera y se queda en negro.
      for (const fn of this.statusListeners) fn(msg);
    });
  }

  /** Cuántos eventos ajenos se ha tirado el embudo. De quién eran lo dice la
   *  línea del juego, que es donde se depura; aquí solo el CONTADOR, porque
   *  sin él «no se instaló» y «no ha llegado» son el mismo verde. */
  descartados(): { n: number } {
    return { n: this.tirados };
  }

  onNarrativeEvent(fn: NarrativeEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onNarrativeStatus(fn: NarrativeStatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  async listGames(): Promise<{ games: GameInfo[]; styles: StyleInfo[] }> {
    const res = await this.bridge.listGames();
    // Mismo patrón que `createGame`/`generateGame`: si el bridge dice que no
    // pudo, se rechaza con SU motivo. Sin esto, una instalación rota llegaba
    // aquí como una lista vacía y el título decía «no hay ningún mundo
    // instalado», que es una causa distinta y falsa.
    if (res.error) throw new Error(res.error);
    return { games: res.games, styles: res.styles };
  }

  /** Crea un mundo de usuario a partir de un borrador. El bridge lo
   *  desarrolla con el motor narrativo y lo escribe en data/games. */
  async createGame(draftText: string): Promise<{ gameId: string; title: string }> {
    const res = await this.bridge.createGame(draftText);
    if (!res.ok || !res.gameId) {
      throw new Error(res.error ?? "create_game failed");
    }
    return { gameId: res.gameId, title: res.title ?? res.gameId };
  }

  /** Encola la pre-generación del mundo de un juego. Resuelve
   *  al encolar; el progreso llega por onNarrativeStatus (kind "game_gen"). */
  async generateGame(gameId: string): Promise<{ queued: string }> {
    const res = await this.bridge.generateGame(gameId);
    if (!res.ok) {
      throw new Error(res.error ?? "generate_game failed");
    }
    return { queued: res.queued ?? "queued" };
  }

  /** Snapshot de mundo pre-generado + vocabulario (batch de aplicar estilo). */
  getWorldSnapshot(gameId: string) {
    return this.bridge.getWorldSnapshot(gameId);
  }

  /** Persiste el registro de una aplicación de estilo (escritor: el bridge). */
  recordStyleApplication(record: Record<string, unknown>) {
    return this.bridge.recordStyleApplication(record);
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const res = await this.bridge.listSessions();
    return res.sessions;
  }

  async startSession(
    gameId: string,
    appearance?: { model_id: string; skin_path: string },
    styleId?: string,
    renderMode?: string,
    characterMode?: string,
  ): Promise<{
    sessionId: string;
    gameId: string;
    state: SessionData;
    /** Tema de UI del estilo, recalculado del pack por el bridge (no viene
     *  del save: retocar una paleta se ve al reanudar). */
    uiTheme?: UiTheme;
  }> {
    const res = await this.bridge.startSession(gameId, appearance, styleId, renderMode, characterMode);
    if (!res.ok || !res.sessionId || !res.state) {
      throw new Error(res.error ?? "start_session failed");
    }
    return { sessionId: res.sessionId, gameId: res.gameId ?? gameId, state: res.state, uiTheme: res.uiTheme };
  }

  async resumeSession(sessionId: string): Promise<{ state: SessionData; uiTheme?: UiTheme }> {
    const res = await this.bridge.resumeSession(sessionId);
    if (!res.ok || !res.state) throw new Error(res.error ?? "resume_session failed");
    return { state: res.state, uiTheme: res.uiTheme };
  }

  /** Cambia el modo de render de una partida (image⇄vector) por faceta.
   *  Lanza si el bridge rechaza (ya en ese modo, save inexistente…) —
   *  fail-loud al caller (menú dev). */
  async setRenderMode(
    sessionId: string,
    facet: "scenes" | "characters",
    mode: "image" | "vector",
  ): Promise<void> {
    const res = await this.bridge.setRenderMode(sessionId, mode, facet);
    if (!res.ok) throw new Error(res.error ?? "el bridge rechazó el cambio de modo");
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const res = await this.bridge.deleteSession(sessionId);
    return res.ok;
  }

  sendDialogueChoice(payload: {
    eventId: string;
    choiceIndex: number;
    speaker: string;
    /** Entidad que dijo la línea (tal cual llegó en el efecto). */
    speakerId?: string;
    chosenText: string;
    freeText?: string;
  }): void {
    this.bridge.sendDialogueChoice(payload);
  }

  /** Trigger lazy realize of a world-map place. The realized scene arrives via
   *  the onNarrativeEvent callback as a scene_init spawn_entity effect. */
  enterPlace(placeId: string): void {
    this.bridge.sendPlayerEnteredPlace(placeId);
  }

  /** El jugador ha entrado en la partida (vestido ∧ mundo pintado): el bridge
   *  la establece en disco. Lo dispara `session/entrada.ts`, nunca a mano. */
  sessionEntered(sessionId: string): void {
    this.bridge.sendSessionEntered(sessionId);
  }

  /** Pide el tile (tx,ty) del plano continuo. Si ya existe, el bridge lo
   *  re-difunde al instante sin LLM; si no, lo genera (encolado). */
  requestTile(tx: number, ty: number, reason: "prefetch" | "blocking", edge?: "north" | "south" | "east" | "west"): void {
    this.bridge.sendRequestTile(tx, ty, reason, edge);
  }

  /** Tell the narrative engine the player approached an NPC. The reply arrives
   *  via onNarrativeEvent, usually as a show_dialogue effect. */
  interactEntity(entityId: string, entityName: string): void {
    this.bridge.sendInteractEntity(entityId, entityName);
  }
}

export type { ConsequenceEffect };
