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
} from "../../../nefan-core/src/narrative/types.js";
import type { NarrativeEventMessage } from "../../../nefan-core/src/protocol/messages.js";

export type GameInfo = { game_id: string; title: string; description?: string };

export type NarrativeEventListener = (event: NarrativeEventMessage) => void;

export class NarrativeClient {
  private listeners = new Set<NarrativeEventListener>();

  constructor(private bridge: BridgeClient) {
    this.bridge.on("narrative_event", (msg) => {
      if (!msg) return;
      for (const fn of this.listeners) fn(msg);
    });
  }

  onNarrativeEvent(fn: NarrativeEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
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
}

export type { ConsequenceEffect };
