/** Timeline browser for the active narrative session.
 *
 * Bound to the H key. Pulls a fresh snapshot from the bridge every time it is
 * opened, so the timeline reflects the last state written.
 */
import type { NarrativeClient } from "../net/narrative-client.js";
import type {
  SessionData,
  DialogueEvent,
  EntityRecord,
} from "@nefan-core/src/narrative/types.js";

export class HistoryBrowser {
  private root: HTMLDivElement;
  private content: HTMLDivElement;
  private detail: HTMLDivElement;
  private _visible = false;
  private _resumeSessionId: string | null = null;

  constructor(private narrative: NarrativeClient) {
    // El diario es UI de JUEGO: vive dentro de #game-ui para heredar el tema
    // del estilo (fuera de ese árbol no ve los tokens).
    this.root = document.createElement("div");
    this.root.id = "history-browser";
    this.root.className = "nf-panel";
    this.root.hidden = true;

    const left = document.createElement("div");
    left.className = "hb-col";
    const header = document.createElement("div");
    header.className = "hb-head";
    header.innerHTML =
      `<h2>Historia</h2>` +
      `<button id="hb-close" class="nf-action" type="button">` +
      `<kbd class="nf-key">H</kbd><span class="nf-label">cerrar</span></button>`;
    this.content = document.createElement("div");
    this.content.id = "hb-list";
    left.appendChild(header);
    left.appendChild(this.content);

    this.detail = document.createElement("div");
    this.detail.id = "hb-detail";
    this.detail.textContent = "Selecciona un evento para ver detalles…";

    this.root.appendChild(left);
    this.root.appendChild(this.detail);
    (document.getElementById("game-ui") ?? document.body).appendChild(this.root);

    (header.querySelector("#hb-close") as HTMLButtonElement).addEventListener("click", () => this.hide());

    window.addEventListener("keydown", (e) => {
      if (e.key === "h" || e.key === "H") {
        // Don't toggle while typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        if (this._visible) this.hide();
        else void this.show();
        e.preventDefault();
      } else if (e.key === "Escape" && this._visible) {
        this.hide();
        e.preventDefault();
      }
    });
  }

  /** Tell the browser which session to look up next time it opens. */
  setSession(sessionId: string): void {
    this._resumeSessionId = sessionId;
  }

  async show(): Promise<void> {
    this._visible = true;
    this.root.hidden = false;
    this.content.innerHTML = `<div class="hb-note">Cargando…</div>`;
    this.detail.textContent = "Selecciona un evento para ver detalles…";

    let state: SessionData | null;
    if (this._resumeSessionId) {
      try {
        const r = await this.narrative.resumeSession(this._resumeSessionId);
        state = r.state;
      } catch (err) {
        // `session_not_found` en el libro casi nunca es «no está»: es «aún no
        // está», porque la partida no existe en disco hasta que el jugador
        // entra en ella (#279) y el libro se puede abrir con la tecla H
        // durante el arranque. Se traduce; cualquier otro motivo va tal cual.
        const msg = (err as Error).message;
        const texto =
          msg === "session_not_found"
            ? "La partida aún no ha empezado: el libro se llena cuando el mundo está en pantalla."
            : `No se pudo cargar la sesión: ${msg}`;
        this.content.innerHTML = `<div class="hb-note hb-note--error">${escapeHtml(texto)}</div>`;
        return;
      }
    } else {
      this.content.innerHTML = `<div class="hb-note">Sin sesión activa.</div>`;
      return;
    }
    this.renderTimeline(state);
  }

  hide(): void {
    this._visible = false;
    this.root.hidden = true;
  }

  private renderTimeline(state: SessionData): void {
    const entries: { id: string; label: string; at: string; payload: unknown; group: string }[] = [];
    for (const sceneId of Object.keys(state.scenes_loaded)) {
      const s = state.scenes_loaded[sceneId];
      entries.push({
        id: `scene_${sceneId}`,
        label: `🗺  Escena: ${sceneId}`,
        at: s.loaded_at,
        payload: s,
        group: "scene",
      });
    }
    for (const e of state.entities) {
      entries.push({
        id: `entity_${e.id}`,
        label: `✨ ${entityIcon(e)} ${e.id}`,
        at: e.spawned_at,
        payload: e,
        group: "entity",
      });
    }
    for (const d of state.dialogue_history) {
      entries.push({
        id: `dlg_${d.id}`,
        label: `💬 ${d.speaker}: ${truncate(d.text, 40)}`,
        at: d.timestamp,
        payload: d,
        group: "dialogue",
      });
    }
    entries.sort((a, b) => (a.at > b.at ? 1 : -1));

    if (entries.length === 0) {
      this.content.innerHTML = `<div class="hb-note hb-note--empty">— Aún no hay eventos en esta sesión —</div>`;
      return;
    }

    this.content.innerHTML = `
      <div class="hb-summary">
        <div class="hb-game">${escapeHtml(state.game_id)}</div>
        <div class="hb-when">${escapeHtml(state.session_id)}</div>
        <div class="hb-when">${entries.length} eventos · ${formatDate(state.updated_at)}</div>
      </div>
      <div id="hb-entries"></div>
    `;
    const list = this.content.querySelector("#hb-entries") as HTMLElement;
    for (const e of entries) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "hb-row";
      row.innerHTML = `<div>${escapeHtml(e.label)}</div>
        <div class="hb-when">${formatDate(e.at)}</div>`;
      row.addEventListener("click", () => this.showDetail(e.payload));
      list.appendChild(row);
    }

    if (state.story_so_far) {
      this.detail.textContent = state.story_so_far;
    }
  }

  private showDetail(payload: unknown): void {
    this.detail.textContent = JSON.stringify(payload, null, 2);
  }
}

function entityIcon(e: EntityRecord): string {
  switch (e.type) {
    case "npc": return "👤";
    case "building": return "🏠";
    case "object": return "📦";
    default: return "•";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

// DialogueEvent kept in the import to ensure the type is reachable at use sites
// even though we serialize via JSON.stringify above.
export type { DialogueEvent };
