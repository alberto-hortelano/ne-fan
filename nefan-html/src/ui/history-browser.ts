/** Timeline browser for the active narrative session.
 *
 * Bound to the H key. Pulls a fresh snapshot from the bridge every time it is
 * opened, so the timeline reflects whatever state Godot or HTML wrote last.
 */
import type { NarrativeClient } from "../net/narrative-client.js";
import type {
  SessionData,
  DialogueEvent,
  EntityRecord,
} from "../../../nefan-core/src/narrative/types.js";

export class HistoryBrowser {
  private root: HTMLDivElement;
  private content: HTMLDivElement;
  private detail: HTMLDivElement;
  private _visible = false;
  private _resumeSessionId: string | null = null;

  constructor(private narrative: NarrativeClient) {
    this.root = document.createElement("div");
    this.root.id = "history-browser";
    this.root.style.cssText = [
      "position:fixed","inset:60px","background:rgba(8,8,12,0.96)",
      "border:1px solid #2a2a30","color:#ccc","font-family:'Courier New',monospace",
      "display:none","z-index:9000","padding:18px","overflow:hidden",
      "flex-direction:row","gap:14px",
    ].join(";");

    const left = document.createElement("div");
    left.style.cssText = "flex:0 0 320px;display:flex;flex-direction:column;min-height:0";
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px";
    header.innerHTML = `<h2 style="font-size:18px;color:#da6;margin:0">Historia</h2>
      <button id="hb-close" style="background:transparent;border:1px solid #555;color:#999;padding:4px 10px;cursor:pointer;font-family:inherit">[H] cerrar</button>`;
    this.content = document.createElement("div");
    this.content.id = "hb-list";
    this.content.style.cssText = "flex:1;overflow-y:auto;border:1px solid #2a2a30;background:#101015";
    left.appendChild(header);
    left.appendChild(this.content);

    this.detail = document.createElement("div");
    this.detail.id = "hb-detail";
    this.detail.style.cssText = [
      "flex:1","overflow-y:auto","background:#0c0c10","border:1px solid #2a2a30",
      "padding:12px","font-size:12px","color:#bbb","white-space:pre-wrap",
    ].join(";");
    this.detail.textContent = "Selecciona un evento para ver detalles…";

    this.root.appendChild(left);
    this.root.appendChild(this.detail);
    document.body.appendChild(this.root);

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
    this.root.style.display = "flex";
    this.content.innerHTML = `<div style="padding:14px;color:#666">Cargando…</div>`;
    this.detail.textContent = "Selecciona un evento para ver detalles…";

    let state: SessionData | null = null;
    if (this._resumeSessionId) {
      try {
        const r = await this.narrative.resumeSession(this._resumeSessionId);
        state = r.state;
      } catch (err) {
        this.content.innerHTML = `<div style="padding:14px;color:#a44">No se pudo cargar la sesión: ${(err as Error).message}</div>`;
        return;
      }
    } else {
      this.content.innerHTML = `<div style="padding:14px;color:#666">Sin sesión activa.</div>`;
      return;
    }
    this.renderTimeline(state);
  }

  hide(): void {
    this._visible = false;
    this.root.style.display = "none";
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
      this.content.innerHTML = `<div style="padding:14px;color:#666;font-style:italic">— Aún no hay eventos en esta sesión —</div>`;
      return;
    }

    this.content.innerHTML = `
      <div style="padding:10px 12px;border-bottom:1px solid #2a2a30;background:#181820">
        <div style="font-size:13px;color:#bdf">${escapeHtml(state.game_id)}</div>
        <div style="font-size:11px;color:#666;margin-top:3px">${escapeHtml(state.session_id)}</div>
        <div style="font-size:11px;color:#666;margin-top:3px">${entries.length} eventos · ${formatDate(state.updated_at)}</div>
      </div>
      <div id="hb-entries"></div>
    `;
    const list = this.content.querySelector("#hb-entries") as HTMLElement;
    for (const e of entries) {
      const row = document.createElement("button");
      row.style.cssText = [
        "display:block","width:100%","text-align:left","padding:8px 12px",
        "background:transparent","border:none","border-bottom:1px solid #1a1a22",
        "color:#ccc","font-family:inherit","font-size:12px","cursor:pointer",
      ].join(";");
      row.innerHTML = `<div>${escapeHtml(e.label)}</div>
        <div style="color:#555;font-size:10px;margin-top:2px">${formatDate(e.at)}</div>`;
      row.addEventListener("mouseenter", () => row.style.background = "#181820");
      row.addEventListener("mouseleave", () => row.style.background = "transparent");
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
