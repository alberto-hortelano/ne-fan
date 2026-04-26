/** Title screen + character editor.
 *
 * One overlay that handles the whole pre-game flow:
 *   1. Lists every saved session with metadata (read from the bridge).
 *   2. Lets the player resume a session, delete it, or start a new game.
 *   3. New game opens the character editor (Mixamo model picker + skin prompt)
 *      then resolves with the chosen game_id and appearance.
 *
 * The screen is purely a UI; the caller (main.ts) decides what to do with the
 * resolved choice (call narrativeClient.startSession or .resumeSession).
 */
import type { NarrativeClient, GameInfo } from "../net/narrative-client.js";
import type {
  SessionMetadata,
} from "../../../nefan-core/src/narrative/types.js";

export type TitleAction =
  | { kind: "resume"; sessionId: string }
  | {
      kind: "new_game";
      gameId: string;
      appearance: { model_id: string; skin_path: string };
    };

const MIXAMO_MODELS: { id: string; name: string }[] = [
  { id: "paladin", name: "Paladín" },
  { id: "eve", name: "Eve" },
  { id: "warrok", name: "Warrok" },
  { id: "skeletonzombie", name: "Esqueleto" },
  { id: "arissa", name: "Arissa" },
  { id: "drake", name: "Drake" },
];

export class TitleScreen {
  private root: HTMLDivElement;
  private content: HTMLDivElement;
  private resolve: ((action: TitleAction) => void) | null = null;

  constructor(private narrative: NarrativeClient) {
    this.root = document.createElement("div");
    this.root.id = "title-screen";
    this.root.style.cssText = [
      "position: fixed",
      "inset: 0",
      "background: rgba(8,8,12,0.97)",
      "color: #ccc",
      "font-family: 'Courier New', monospace",
      "display: none",
      "flex-direction: column",
      "align-items: center",
      "justify-content: center",
      "z-index: 9999",
      "padding: 32px",
    ].join(";");
    this.content = document.createElement("div");
    this.content.style.cssText = [
      "max-width: 720px",
      "width: 100%",
      "max-height: 100%",
      "overflow-y: auto",
    ].join(";");
    this.root.appendChild(this.content);
    document.body.appendChild(this.root);
  }

  async show(): Promise<TitleAction> {
    this.root.style.display = "flex";
    await this.renderHome();
    return new Promise<TitleAction>((res) => {
      this.resolve = res;
    });
  }

  hide(): void {
    this.root.style.display = "none";
  }

  private async renderHome(): Promise<void> {
    this.content.innerHTML = `
      <h1 style="font-size:32px;color:#da6;margin-bottom:24px">Never Ending Fantasy</h1>
      <p style="margin-bottom:18px;color:#999">Cliente 2D — selecciona una partida o empieza una nueva.</p>
      <div id="ts-status" style="margin-bottom:18px;font-size:12px;color:#666"></div>
      <h2 style="margin-bottom:10px;color:#bbb">Partidas guardadas</h2>
      <div id="ts-sessions" style="margin-bottom:24px"></div>
      <button id="ts-new" style="${BTN_PRIMARY_CSS}">Nueva partida</button>
    `;

    const statusEl = this.content.querySelector("#ts-status") as HTMLElement;
    const sessionsEl = this.content.querySelector("#ts-sessions") as HTMLElement;
    const newBtn = this.content.querySelector("#ts-new") as HTMLButtonElement;

    statusEl.textContent = "Cargando saves desde el bridge...";
    let sessions: SessionMetadata[] = [];
    try {
      sessions = await this.narrative.listSessions();
      statusEl.textContent = `Bridge OK — ${sessions.length} partidas guardadas.`;
      statusEl.style.color = "#4a4";
    } catch (err) {
      statusEl.innerHTML = `<span style="color:#a44">No se puede contactar al bridge (${(err as Error).message}). Arranca <code>./start.sh bridge</code>.</span>`;
    }

    if (sessions.length === 0) {
      sessionsEl.innerHTML = `<div style="color:#666;font-style:italic">— Ninguna partida todavía —</div>`;
    } else {
      sessionsEl.innerHTML = sessions
        .map((s) => sessionRowHtml(s))
        .join("");
      for (const btn of sessionsEl.querySelectorAll<HTMLButtonElement>("button[data-action=resume]")) {
        btn.addEventListener("click", () => {
          this.resolve?.({ kind: "resume", sessionId: btn.dataset.sessionId! });
        });
      }
      for (const btn of sessionsEl.querySelectorAll<HTMLButtonElement>("button[data-action=delete]")) {
        btn.addEventListener("click", async () => {
          if (!confirm(`¿Borrar la partida ${btn.dataset.sessionId}?`)) return;
          try {
            await this.narrative.deleteSession(btn.dataset.sessionId!);
            await this.renderHome();
          } catch (err) {
            alert(`Borrado falló: ${(err as Error).message}`);
          }
        });
      }
    }

    newBtn.addEventListener("click", () => {
      void this.renderCharacterEditor();
    });
  }

  private async renderCharacterEditor(): Promise<void> {
    let games: GameInfo[] = [];
    try {
      games = await this.narrative.listGames();
    } catch {
      // best effort — render the editor anyway
    }
    const defaultGame = games[0]?.game_id ?? "tavern_intro";

    this.content.innerHTML = `
      <h1 style="font-size:28px;color:#da6;margin-bottom:18px">Crear personaje</h1>
      <label style="display:block;margin-bottom:14px">
        <div style="font-size:12px;color:#999;margin-bottom:4px">Historia</div>
        <select id="ts-game" style="${SELECT_CSS}">
          ${games.length === 0
            ? `<option value="${defaultGame}">${defaultGame}</option>`
            : games.map((g) => `<option value="${g.game_id}">${g.title}</option>`).join("")}
        </select>
      </label>
      <label style="display:block;margin-bottom:14px">
        <div style="font-size:12px;color:#999;margin-bottom:4px">Modelo base (Mixamo)</div>
        <select id="ts-model" style="${SELECT_CSS}">
          ${MIXAMO_MODELS.map((m) => `<option value="${m.id}">${m.name}</option>`).join("")}
        </select>
      </label>
      <label style="display:block;margin-bottom:18px">
        <div style="font-size:12px;color:#999;margin-bottom:4px">Skin AI (prompt opcional)</div>
        <input id="ts-skin" type="text" placeholder="ej: caballero con armadura roja"
               style="${INPUT_CSS}">
      </label>
      <div style="display:flex;gap:12px">
        <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
        <button id="ts-start" style="${BTN_PRIMARY_CSS}">Comenzar</button>
      </div>
    `;
    const back = this.content.querySelector("#ts-back") as HTMLButtonElement;
    const start = this.content.querySelector("#ts-start") as HTMLButtonElement;
    const gameSel = this.content.querySelector("#ts-game") as HTMLSelectElement;
    const modelSel = this.content.querySelector("#ts-model") as HTMLSelectElement;
    const skinInput = this.content.querySelector("#ts-skin") as HTMLInputElement;

    back.addEventListener("click", () => void this.renderHome());
    start.addEventListener("click", () => {
      this.resolve?.({
        kind: "new_game",
        gameId: gameSel.value,
        appearance: {
          model_id: modelSel.value,
          skin_path: skinInput.value.trim(),
        },
      });
    });
  }
}

function sessionRowHtml(s: SessionMetadata): string {
  const summary = s.summary || "(sin narrativa todavía)";
  const updated = s.updated_at ? formatDate(s.updated_at) : "?";
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:8px;background:#181820;border:1px solid #2a2a30">
      <div style="flex:1;min-width:0">
        <div style="color:#bdf;font-size:13px">${escapeHtml(s.game_id)} <span style="color:#666;font-size:11px">· ${escapeHtml(s.session_id)}</span></div>
        <div style="color:#999;font-size:12px;margin-top:3px">${escapeHtml(summary)}</div>
        <div style="color:#666;font-size:11px;margin-top:3px">${updated} · ${s.scene_count} escenas · ${s.entity_count} entidades</div>
      </div>
      <div style="display:flex;gap:6px;margin-left:14px">
        <button data-action="resume" data-session-id="${escapeAttr(s.session_id)}" style="${BTN_SMALL_PRIMARY_CSS}">Reanudar</button>
        <button data-action="delete" data-session-id="${escapeAttr(s.session_id)}" style="${BTN_SMALL_DANGER_CSS}">Borrar</button>
      </div>
    </div>
  `;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

const BTN_PRIMARY_CSS = [
  "background:#da6","color:#111","border:none","padding:10px 22px",
  "font-family:inherit","font-size:14px","cursor:pointer","border-radius:3px",
].join(";");
const BTN_SECONDARY_CSS = [
  "background:transparent","color:#999","border:1px solid #444","padding:10px 22px",
  "font-family:inherit","font-size:14px","cursor:pointer","border-radius:3px",
].join(";");
const BTN_SMALL_PRIMARY_CSS = [
  "background:#3a6","color:#fff","border:none","padding:5px 12px",
  "font-family:inherit","font-size:12px","cursor:pointer","border-radius:3px",
].join(";");
const BTN_SMALL_DANGER_CSS = [
  "background:transparent","color:#a55","border:1px solid #533","padding:5px 12px",
  "font-family:inherit","font-size:12px","cursor:pointer","border-radius:3px",
].join(";");
const SELECT_CSS = [
  "width:100%","padding:8px 10px","background:#1a1a22","color:#ddd",
  "border:1px solid #444","font-family:inherit","font-size:13px",
].join(";");
const INPUT_CSS = SELECT_CSS;
