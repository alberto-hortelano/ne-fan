/** High-level narrative client for the HTML 2D renderer.
 *
 * Wraps BridgeClient with typed methods around session lifecycle and dialogue
 * events, and surfaces narrative_event broadcasts as a typed callback.
 */
import { BridgeClient } from "./bridge-client.js";
import type {
  SessionMetadata,
  SessionData,
  ConsequenceEffect,
} from "@nefan-core/src/narrative/types.js";
import type {
  NarrativeEventMessage,
  NarrativeStatusMessage,
} from "@nefan-core/src/protocol/messages.js";

export type GameInfo = { game_id: string; title: string; description?: string };

export type NarrativeEventListener = (event: NarrativeEventMessage) => void;
export type NarrativeStatusListener = (status: NarrativeStatusMessage) => void;

export class NarrativeClient {
  private listeners = new Set<NarrativeEventListener>();
  private statusListeners = new Set<NarrativeStatusListener>();

  constructor(private bridge: BridgeClient) {
    this.bridge.on("narrative_event", (msg) => {
      if (!msg) return;
      for (const fn of this.listeners) fn(msg);
    });
    this.bridge.on("narrative_status", (msg) => {
      if (!msg) return;
      for (const fn of this.statusListeners) fn(msg);
    });
  }

  onNarrativeEvent(fn: NarrativeEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onNarrativeStatus(fn: NarrativeStatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  async listGames(): Promise<GameInfo[]> {
    const res = await this.bridge.listGames();
    return res.games;
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const res = await this.bridge.listSessions();
    return res.sessions;
  }

  async startSession(gameId: string, appearance?: { model_id: string; skin_path: string }): Promise<{
    sessionId: string;
    gameId: string;
    state: SessionData;
  }> {
    const res = await this.bridge.startSession(gameId, appearance);
    if (!res.ok || !res.sessionId || !res.state) {
      throw new Error(res.error ?? "start_session failed");
    }
    return { sessionId: res.sessionId, gameId: res.gameId ?? gameId, state: res.state };
  }

  async resumeSession(sessionId: string): Promise<{ state: SessionData }> {
    const res = await this.bridge.resumeSession(sessionId);
    if (!res.ok || !res.state) throw new Error(res.error ?? "resume_session failed");
    return { state: res.state };
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const res = await this.bridge.deleteSession(sessionId);
    return res.ok;
  }

  async save(): Promise<boolean> {
    const res = await this.bridge.saveSession();
    return res.ok;
  }

  sendDialogueChoice(payload: {
    eventId: string;
    choiceIndex: number;
    speaker: string;
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

  /** El jugador cruzó un borde sin destino conocido: el motor narrativo crea
   *  mundo en esa dirección. La escena nueva llega igual que en enterPlace. */
  crossFrontier(edge: "north" | "south" | "east" | "west"): void {
    this.bridge.sendPlayerCrossedFrontier(edge);
  }

  /** Pide el tile (tx,ty) del plano continuo. Si ya existe, el bridge lo
   *  re-difunde al instante sin LLM; si no, lo genera (encolado). */
  requestTile(tx: number, ty: number, reason: "prefetch" | "blocking", edge?: "north" | "south" | "east" | "west"): void {
    this.bridge.sendRequestTile(tx, ty, reason, edge);
  }

  /** Reporta el análisis de imagen de un tile (el mapa real derivado) para
   *  que el motor narrativo se ajuste a lo pintado. */
  reportTileAnalysis(
    tx: number,
    ty: number,
    elements: Array<{
      label: string;
      solid: boolean;
      tall: boolean;
      rect: { minX: number; maxX: number; minZ: number; maxZ: number };
    }>,
  ): void {
    this.bridge.sendTileAnalysis(tx, ty, elements);
  }

  /** Tell the narrative engine the player approached an NPC. The reply arrives
   *  via onNarrativeEvent, usually as a show_dialogue effect. */
  interactEntity(entityId: string, entityName: string): void {
    this.bridge.sendInteractEntity(entityId, entityName);
  }
}

export type { ConsequenceEffect };
