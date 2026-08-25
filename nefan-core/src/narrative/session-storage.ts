/** Pluggable storage for narrative sessions. */
import { promises as fs } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import type { SessionData, SessionMetadata } from "./types.js";

export interface SessionStorage {
  read(sessionId: string): Promise<SessionData | null>;
  write(sessionId: string, data: SessionData): Promise<void>;
  delete(sessionId: string): Promise<boolean>;
  list(): Promise<SessionMetadata[]>;
  exists(sessionId: string): Promise<boolean>;
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/** Stores sessions on the local filesystem under {root}/{session_id}/state.json. */
export class FsSessionStorage implements SessionStorage {
  private readonly rootAbs: string;
  constructor(private root: string) {
    this.rootAbs = resolve(root);
  }

  /** Directorio del save, garantizado DENTRO de root. `sessionId` llega del
   *  wire (WS sin auth): un id como ".." o "a/../../etc" escaparía de saves/
   *  y `delete` haría rm -rf recursivo fuera. Fail-loud ante cualquier fuga. */
  private dirFor(sessionId: string): string {
    const dir = resolve(this.rootAbs, sessionId);
    if (dir !== this.rootAbs && !dir.startsWith(this.rootAbs + sep)) {
      throw new Error(`unsafe session id '${sessionId}': escapes saves directory`);
    }
    if (dir === this.rootAbs) {
      throw new Error(`unsafe session id '${sessionId}': resolves to saves root`);
    }
    return dir;
  }

  private pathFor(sessionId: string): string {
    return resolve(this.dirFor(sessionId), "state.json");
  }

  async exists(sessionId: string): Promise<boolean> {
    try {
      await fs.access(this.pathFor(sessionId));
      return true;
    } catch (err) {
      if (isEnoent(err)) return false;
      throw err;
    }
  }

  /** Returns null only when the session does not exist; corrupt JSON or IO errors throw. */
  async read(sessionId: string): Promise<SessionData | null> {
    let text: string;
    try {
      text = await fs.readFile(this.pathFor(sessionId), "utf-8");
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
    try {
      return JSON.parse(text) as SessionData;
    } catch (err) {
      throw new Error(
        `Corrupt session file for "${sessionId}" at ${this.pathFor(sessionId)}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  /** Cola de escritura POR SESIÓN (ver `write`). */
  private colas = new Map<string, Promise<void>>();

  /** Guarda la sesión. Las escrituras de la MISMA sesión se serializan: el
   *  bridge guarda desde muchos sitios (cada mutación del State API, los map
   *  triggers, la generación de un tile, un diálogo) y dos writes solapados
   *  compartían el fichero temporal — el rename del primero se lo llevaba y el
   *  segundo moría con ENOENT, tumbando la operación que lo hubiera pedido
   *  (medido: un viaje del jugador que se quedaba a medias, sin escena).
   *  Serializar arregla eso y además fija el orden: gana el ÚLTIMO save
   *  pedido, no el que acabe antes. */
  async write(sessionId: string, data: SessionData): Promise<void> {
    const anterior = this.colas.get(sessionId);
    const turno = (async () => {
      // El fallo del save anterior es de SU caller: aquí solo se espera turno.
      if (anterior) await anterior;
      await this.writeAtomic(sessionId, data);
    })();
    // En la cola queda la versión ASENTADA (nunca rechaza): un save roto no
    // puede bloquear a los siguientes ni dejar un rechazo sin dueño — el error
    // sale entero por el `await turno` de abajo, que es quien lo pidió.
    const asentado = turno.then(
      () => undefined,
      () => undefined,
    );
    this.colas.set(sessionId, asentado);
    try {
      await turno;
    } finally {
      // Último de la cola: fuera de la tabla (no acumular una entrada por save).
      if (this.colas.get(sessionId) === asentado) this.colas.delete(sessionId);
    }
  }

  /** Escritura atómica: un corte a mitad de writeFile dejaba state.json
   *  truncado y el resume posterior lanzaba (partida irrecuperable). Se escribe
   *  a un tmp y se renombra (rename es atómico en el mismo FS). */
  private async writeAtomic(sessionId: string, data: SessionData): Promise<void> {
    const path = this.pathFor(sessionId);
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, "\t"), "utf-8");
    await fs.rename(tmp, path);
  }

  async delete(sessionId: string): Promise<boolean> {
    const dir = this.dirFor(sessionId); // lanza si el id se escapa de saves/
    try {
      await fs.rm(dir, { recursive: true });
      return true;
    } catch (err) {
      if (isEnoent(err)) return false; // borrar lo que no está: no es un error
      throw err; // EACCES/EBUSY/… deben verse (fail-loud)
    }
  }

  async list(): Promise<SessionMetadata[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.root);
    } catch (err) {
      if (isEnoent(err)) return []; // no saves dir yet — legitimate empty state
      throw err;
    }
    const result: SessionMetadata[] = [];
    for (const name of entries) {
      let data: SessionData | null;
      try {
        data = await this.read(name);
      } catch (err) {
        // One corrupt session must not hide every other save from the list.
        console.error(`[session-storage] skipping unreadable session "${name}":`, err);
        continue;
      }
      if (!data) continue;
      let summary = data.story_so_far ?? "";
      if (summary.length > 80) summary = summary.slice(0, 77) + "...";
      result.push({
        session_id: data.session_id || name,
        game_id: data.game_id || "?",
        updated_at: data.updated_at || "",
        summary,
        scene_count: Object.keys(data.scenes_loaded ?? {}).length,
        entity_count: (data.entities ?? []).length,
        ...(data.world?.render_mode ? { render_mode: data.world.render_mode } : {}),
        ...(data.world?.character_mode ? { character_mode: data.world.character_mode } : {}),
      });
    }
    result.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
    return result;
  }
}

/** In-memory storage for tests and ephemeral sessions. */
export class MemorySessionStorage implements SessionStorage {
  private store = new Map<string, SessionData>();

  async exists(sessionId: string): Promise<boolean> {
    return this.store.has(sessionId);
  }

  async read(sessionId: string): Promise<SessionData | null> {
    const data = this.store.get(sessionId);
    return data ? structuredClone(data) : null;
  }

  async write(sessionId: string, data: SessionData): Promise<void> {
    this.store.set(sessionId, structuredClone(data));
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.store.delete(sessionId);
  }

  async list(): Promise<SessionMetadata[]> {
    const result: SessionMetadata[] = [];
    for (const data of this.store.values()) {
      let summary = data.story_so_far ?? "";
      if (summary.length > 80) summary = summary.slice(0, 77) + "...";
      result.push({
        session_id: data.session_id,
        game_id: data.game_id,
        updated_at: data.updated_at,
        summary,
        scene_count: Object.keys(data.scenes_loaded ?? {}).length,
        entity_count: (data.entities ?? []).length,
        ...(data.world?.render_mode ? { render_mode: data.world.render_mode } : {}),
        ...(data.world?.character_mode ? { character_mode: data.world.character_mode } : {}),
      });
    }
    result.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
    return result;
  }
}
