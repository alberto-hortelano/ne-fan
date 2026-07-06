/** Title screen: saves → selección de mundo → editor de personaje.
 *
 * One overlay that handles the whole pre-game flow:
 *   1. Lists every saved session with metadata (read from the bridge).
 *   2. Lets the player resume a session, delete it, or start a new game.
 *   3. New game shows the WORLD SELECT: one card per game (cover del estilo
 *      servida por el State API del bridge + descripción) with a style
 *      override selector.
 *   4. Then the character editor (Mixamo model picker + skin prompt), and
 *      resolves with {gameId, styleId, appearance}.
 *
 * The screen is purely a UI; the caller (main.ts) decides what to do with the
 * resolved choice (call narrativeClient.startSession or .resumeSession).
 */
import type { NarrativeClient, GameInfo, StyleInfo } from "../net/narrative-client.js";
import type {
  SessionMetadata,
} from "@nefan-core/src/narrative/types.js";
import { CONFIG } from "@nefan-core/src/config.js";

export type TitleAction =
  | { kind: "resume"; sessionId: string }
  | {
      kind: "new_game";
      gameId: string;
      /** Estilo visual elegido ("" = el por defecto del juego). */
      styleId: string;
      appearance: { model_id: string; skin_path: string };
    };

/** State API del bridge (:9878) — sirve las covers de los estilos como
 *  estáticos, con o sin ai_server. */
const STATE_API_URL = "http://127.0.0.1:9878";

const MIXAMO_MODELS: { id: string; name: string }[] = [
  { id: "y_bot", name: "Y Bot (base)" },
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
      void this.renderWorldSelect();
    });
  }

  /** Paso de selección de mundo: una tarjeta por juego (cover + descripción)
   *  y selector de estilo con el del juego preseleccionado. */
  private async renderWorldSelect(): Promise<void> {
    // listGames must succeed — there's no scripted fallback any more. If it
    // throws, the title-screen surfaces the error and stops here.
    const { games, styles } = await this.narrative.listGames();
    if (games.length === 0) {
      throw new Error("no games available in bridge — check nefan-core/data/games/");
    }
    const styleById = new Map(styles.map((st) => [st.style_id, st]));
    let selectedGame = games[0];

    this.content.innerHTML = `
      <h1 style="font-size:28px;color:#da6;margin-bottom:6px">Elige un mundo</h1>
      <p style="margin-bottom:16px;color:#888;font-size:12px">La historia la improvisa el motor narrativo dentro del mundo que elijas.</p>
      <div id="ts-worlds" style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px"></div>
      <label style="display:block;margin-bottom:18px">
        <div style="font-size:12px;color:#999;margin-bottom:4px">Estilo visual</div>
        <select id="ts-style" style="${SELECT_CSS}"></select>
        <div id="ts-style-desc" style="font-size:11px;color:#777;margin-top:4px"></div>
      </label>
      <div style="display:flex;gap:12px">
        <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
        <button id="ts-continue" style="${BTN_PRIMARY_CSS}">Continuar →</button>
        <button id="ts-create-world" style="${BTN_SECONDARY_CSS};margin-left:auto">✚ Crear mundo</button>
      </div>
    `;
    const worldsEl = this.content.querySelector("#ts-worlds") as HTMLElement;
    const styleSel = this.content.querySelector("#ts-style") as HTMLSelectElement;
    const styleDesc = this.content.querySelector("#ts-style-desc") as HTMLElement;

    worldsEl.innerHTML = games.map((g) => worldCardHtml(g, styleById.get(g.style_id))).join("");

    const refreshStyleOptions = (): void => {
      styleSel.innerHTML = styles
        .map((st) => {
          const def = st.style_id === selectedGame.style_id ? " (del mundo)" : "";
          return `<option value="${escapeAttr(st.style_id)}">${escapeHtml(st.name)}${def}</option>`;
        })
        .join("");
      styleSel.value = selectedGame.style_id;
      styleDesc.textContent = styleById.get(selectedGame.style_id)?.description ?? "";
    };
    const refreshSelection = (): void => {
      for (const card of worldsEl.querySelectorAll<HTMLElement>("[data-game-id]")) {
        const active = card.dataset.gameId === selectedGame.game_id;
        card.style.borderColor = active ? "#da6" : "#2a2a30";
        card.style.background = active ? "#201c14" : "#181820";
      }
    };
    for (const card of worldsEl.querySelectorAll<HTMLElement>("[data-game-id]")) {
      card.addEventListener("click", () => {
        const game = games.find((g) => g.game_id === card.dataset.gameId);
        if (!game) return;
        selectedGame = game;
        refreshSelection();
        refreshStyleOptions();
      });
    }
    styleSel.addEventListener("change", () => {
      styleDesc.textContent = styleById.get(styleSel.value)?.description ?? "";
    });
    refreshSelection();
    refreshStyleOptions();

    (this.content.querySelector("#ts-back") as HTMLButtonElement)
      .addEventListener("click", () => void this.renderHome());
    (this.content.querySelector("#ts-continue") as HTMLButtonElement)
      .addEventListener("click", () => {
        void this.renderCharacterEditor(selectedGame, styleSel.value);
      });
    (this.content.querySelector("#ts-create-world") as HTMLButtonElement)
      .addEventListener("click", () => void this.renderCreateWorld());
  }

  /** Crear un mundo propio: textarea o archivo .md/.txt. El borrador se
   *  desarrolla con el motor narrativo (tarda 1-3 min) y aparece como un
   *  mundo más en el selector. */
  private renderCreateWorld(): void {
    this.content.innerHTML = `
      <h1 style="font-size:28px;color:#da6;margin-bottom:6px">Crear mundo</h1>
      <p style="margin-bottom:16px;color:#888;font-size:12px">
        Describe tu mundo (reinos, pueblos, magia, tono…) o sube un archivo .md/.txt.
        El motor narrativo lo completará y desarrollará — cuanto más des, más tuyo será el resultado.
      </p>
      <label style="display:block;margin-bottom:12px">
        <div style="font-size:12px;color:#999;margin-bottom:4px">Borrador del mundo</div>
        <textarea id="ts-draft" rows="10" placeholder="ej: Un archipiélago de islas voladoras ancladas por cadenas gigantes. Clanes de pastores de nubes..." style="${INPUT_CSS};resize:vertical;min-height:160px"></textarea>
      </label>
      <label style="display:block;margin-bottom:18px">
        <div style="font-size:12px;color:#999;margin-bottom:4px">…o sube un archivo</div>
        <input id="ts-draft-file" type="file" accept=".md,.txt,text/plain,text/markdown" style="color:#999;font-size:12px">
      </label>
      <div id="ts-create-status" style="margin-bottom:14px;font-size:12px;color:#888"></div>
      <div style="display:flex;gap:12px">
        <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
        <button id="ts-create" style="${BTN_PRIMARY_CSS}">Crear mundo</button>
      </div>
    `;
    const draftEl = this.content.querySelector("#ts-draft") as HTMLTextAreaElement;
    const fileEl = this.content.querySelector("#ts-draft-file") as HTMLInputElement;
    const statusEl = this.content.querySelector("#ts-create-status") as HTMLElement;
    const backBtn = this.content.querySelector("#ts-back") as HTMLButtonElement;
    const createBtn = this.content.querySelector("#ts-create") as HTMLButtonElement;

    fileEl.addEventListener("change", () => {
      const file = fileEl.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        draftEl.value = String(reader.result ?? "");
        statusEl.textContent = `Archivo cargado: ${file.name} (${draftEl.value.length} caracteres).`;
      };
      reader.onerror = () => {
        statusEl.innerHTML = `<span style="color:#a44">No se pudo leer ${escapeHtml(file.name)}.</span>`;
      };
      reader.readAsText(file);
    });

    backBtn.addEventListener("click", () => void this.renderWorldSelect());
    createBtn.addEventListener("click", async () => {
      const draft = draftEl.value.trim();
      if (draft.length < 20) {
        statusEl.innerHTML = `<span style="color:#a44">El borrador es demasiado corto — describe el mundo con al menos unas frases.</span>`;
        return;
      }
      createBtn.disabled = true;
      backBtn.disabled = true;
      statusEl.innerHTML = `<span style="color:#da6">🌍 El motor narrativo está desarrollando tu mundo (1-3 min)... no cierres esta pantalla.</span>`;
      try {
        const created = await this.narrative.createGame(draft);
        statusEl.innerHTML = `<span style="color:#4a4">Mundo creado: ${escapeHtml(created.title)}.</span>`;
        await this.renderWorldSelect();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:#a44">No se pudo crear el mundo: ${escapeHtml((err as Error).message)}</span>`;
        createBtn.disabled = false;
        backBtn.disabled = false;
      }
    });
  }

  private renderCharacterEditor(game: GameInfo, styleId: string): void {
    const spritesOn = CONFIG.graphics.character_sprites;
    const skinOn = CONFIG.graphics.ai_skin;

    const modelBlock = spritesOn
      ? `<label style="display:block;margin-bottom:14px">
           <div style="font-size:12px;color:#999;margin-bottom:4px">Modelo base (Mixamo)</div>
           <select id="ts-model" style="${SELECT_CSS}">
             ${MIXAMO_MODELS.map((m) => `<option value="${m.id}">${m.name}</option>`).join("")}
           </select>
         </label>`
      : `<div style="margin-bottom:14px;color:#666;font-size:11px;font-style:italic">
           Modelo Mixamo deshabilitado (activa <code>graphics.character_sprites</code> en config.ts para usarlo).
         </div>`;

    const skinBlock = skinOn
      ? `<label style="display:block;margin-bottom:18px">
           <div style="font-size:12px;color:#999;margin-bottom:4px">Skin AI (prompt opcional)</div>
           <input id="ts-skin" type="text" placeholder="ej: caballero con armadura roja"
                  style="${INPUT_CSS}">
         </label>`
      : `<div style="margin-bottom:18px;color:#666;font-size:11px;font-style:italic">
           Skin AI deshabilitada (activa <code>graphics.ai_skin</code> en config.ts para usarla).
         </div>`;

    this.content.innerHTML = `
      <h1 style="font-size:28px;color:#da6;margin-bottom:6px">Crear personaje</h1>
      <p style="margin-bottom:18px;color:#888;font-size:12px">Mundo: <span style="color:#bdf">${escapeHtml(game.title)}</span></p>
      ${modelBlock}
      ${skinBlock}
      <div style="display:flex;gap:12px">
        <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
        <button id="ts-start" style="${BTN_PRIMARY_CSS}">Comenzar</button>
      </div>
    `;
    const back = this.content.querySelector("#ts-back") as HTMLButtonElement;
    const start = this.content.querySelector("#ts-start") as HTMLButtonElement;
    const modelSel = this.content.querySelector("#ts-model") as HTMLSelectElement | null;
    const skinInput = this.content.querySelector("#ts-skin") as HTMLInputElement | null;

    back.addEventListener("click", () => void this.renderWorldSelect());
    start.addEventListener("click", () => {
      this.resolve?.({
        kind: "new_game",
        gameId: game.game_id,
        styleId,
        appearance: {
          model_id: modelSel ? modelSel.value : "",
          skin_path: skinInput ? skinInput.value.trim() : "",
        },
      });
    });
  }
}

function worldCardHtml(g: GameInfo, style: StyleInfo | undefined): string {
  const cover = style?.cover_url
    ? `<img src="${escapeAttr(STATE_API_URL + style.cover_url)}" alt="" style="width:120px;height:80px;object-fit:cover;flex:none;border:1px solid #333">`
    : `<div style="width:120px;height:80px;flex:none;border:1px solid #333;background:linear-gradient(135deg,#23202b,#161419);display:flex;align-items:center;justify-content:center;color:#555;font-size:10px;text-align:center;padding:4px">${escapeHtml(style?.name ?? g.style_id)}</div>`;
  return `
    <div data-game-id="${escapeAttr(g.game_id)}" style="display:flex;gap:14px;padding:12px;background:#181820;border:2px solid #2a2a30;cursor:pointer;border-radius:4px">
      ${cover}
      <div style="flex:1;min-width:0">
        <div style="color:#dcb;font-size:16px;margin-bottom:4px">${escapeHtml(g.title)}</div>
        <div style="color:#999;font-size:12px;line-height:1.5">${escapeHtml(g.description)}</div>
        <div style="color:#666;font-size:11px;margin-top:5px">Estilo: ${escapeHtml(style?.name ?? g.style_id)}</div>
      </div>
    </div>
  `;
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
