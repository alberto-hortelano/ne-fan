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
import type { NarrativeStatusMessage } from "@nefan-core/src/protocol/messages.js";
import { CONFIG } from "@nefan-core/src/config.js";
import { WORLD_VIEWS, type WorldView } from "@nefan-core/src/games/style-categories.js";
import { serviceUrl } from "../net/service-urls.js";
import { StyleApplyController, type StyleApplyPlan } from "./style-apply.js";

/** Normaliza una vista de fuente externa (game.json, botón) al enum. */
function normalizeView(v: string | undefined, fallback: WorldView = "overworld"): WorldView {
  return (WORLD_VIEWS as readonly string[]).includes(v ?? "") ? (v as WorldView) : fallback;
}

export type TitleAction =
  | { kind: "resume"; sessionId: string }
  | {
      kind: "new_game";
      gameId: string;
      /** Estilo visual elegido ("" = el por defecto del juego). */
      styleId: string;
      /** Modo de render, congelado en la sesión: imagen IA o maqueta 3D clay
       *  (id interno "vector", heredado del compositor SVG — congelado en
       *  saves y contratos, NO renombrar). */
      renderMode: "image" | "vector";
      /** Modo de imagen de los PERSONAJES (skins IA vs base y_bot),
       *  independiente de los escenarios. */
      characterMode: "image" | "vector";
      /** Vista del mundo elegida (game.json solo aporta el default).
       *  Congelada en la sesión como el estilo. */
      view: WorldView;
      appearance: { model_id: string; skin_path: string };
    };

/** asset-store — sirve las covers de los estilos como estáticos, con o sin
 *  ai_server (movido desde el State API en F2; preset 4 arranca el store). */
const ASSET_STORE_URL = serviceUrl("asset-store");
/** remote-gen (proceso propio desde F4) — subida de estilos y generación de las
 *  categorías que falten (Meshy). Sin él, "Subir estilo" falla con error
 *  visible. */
const AI_SERVER_HTTP = serviceUrl("remote-gen");

const STYLE_CATEGORY_LABELS: Array<{ id: string; label: string }> = [
  { id: "settlement", label: "Pueblo" },
  { id: "farmland", label: "Campos" },
  { id: "forest", label: "Bosque" },
  { id: "wetland", label: "Pantano" },
  { id: "desert", label: "Desierto" },
  { id: "snow", label: "Nieve" },
  { id: "fortress", label: "Fortaleza" },
  { id: "interior", label: "Interior" },
  { id: "underground", label: "Subterráneo" },
  { id: "character_commoner", label: "Personaje plebeyo" },
  { id: "character_noble", label: "Personaje noble" },
  { id: "character_warrior", label: "Personaje guerrero" },
  { id: "stage_interior", label: "Plató: interior" },
  { id: "stage_street", label: "Plató: calle" },
  { id: "stage_plaza", label: "Plató: plaza" },
  { id: "stage_nature", label: "Plató: naturaleza" },
  { id: "stage_harbor", label: "Plató: puerto" },
  { id: "stage_gate", label: "Plató: puerta" },
];

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
  private styleApply: StyleApplyController;
  /** Última línea de progreso de generate_game (kind "game_gen"): la pinta
   *  el panel de generación del selector de mundo si está en pantalla. */
  private gameGenStatus: NarrativeStatusMessage | null = null;
  /** Mundo seleccionado la última vez que se pintó el selector — el refresh
   *  tras un game_gen ready lo conserva. */
  private lastSelectedGameId: string | null = null;

  private renderGameGenProgress(line: HTMLElement): void {
    const s = this.gameGenStatus;
    if (!s) {
      line.textContent = "";
      return;
    }
    const mins = s.elapsedMs !== undefined ? ` · ${Math.round(s.elapsedMs / 60000)} min` : "";
    if (s.phase === "error") {
      line.innerHTML = `<span style="color:#a44">${escapeHtml(s.message ?? "la generación falló")}</span>`;
    } else if (s.phase === "ready") {
      line.innerHTML = `<span style="color:#4a4">${escapeHtml(s.message ?? "Mundo generado.")}</span>`;
    } else {
      line.innerHTML = `<span style="color:#da6">⚙ ${escapeHtml(s.message ?? "Generando…")}${mins}</span>`;
    }
  }

  constructor(private narrative: NarrativeClient) {
    this.styleApply = new StyleApplyController(narrative, {
      remote: AI_SERVER_HTTP,
      assets: ASSET_STORE_URL,
    });
    // Progreso de la pre-generación de mundo: el job corre en el bridge y
    // difunde narrative_status kind "game_gen" — el título lo refleja en la
    // tarjeta/panel sin loaders de partida. Suscripción de vida completa
    // (el título vive tanto como la app).
    this.narrative.onNarrativeStatus((msg) => {
      if (msg.kind !== "game_gen") return;
      this.gameGenStatus = msg;
      const line = this.content.querySelector<HTMLElement>("#ts-gen-progress");
      if (line) this.renderGameGenProgress(line);
      if (msg.phase === "ready" || msg.phase === "error") {
        // Refrescar chips/botones si el selector de mundo sigue en pantalla.
        const panel = this.content.querySelector("#ts-gen");
        if (panel && this.root.style.display !== "none") {
          void this.renderWorldSelect(this.lastSelectedGameId ?? undefined);
        }
      }
    });
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
      // Padding superior mayor que el panel de dev fijo (#dev-status, ~88px):
      // en viewports bajos el centrado vertical metía el título debajo.
      "padding: 96px 32px 32px",
    ].join(";");
    this.content = document.createElement("div");
    this.content.style.cssText = [
      "max-width: 720px",
      "width: 100%",
      "max-height: 100%",
      "overflow-y: auto",
    ].join(";");
    this.root.appendChild(this.content);
    // Cierre SIN sesión (modo fixtures/dev): oculta el título y deja el juego
    // en local — el selector "Room" y las teclas dev (G/B…) quedan a mano.
    // No resuelve la promesa de show(): runTitleFlow queda en espera, igual
    // que ocultar el overlay a mano desde la consola.
    const close = document.createElement("button");
    close.id = "ts-close";
    close.textContent = "✕ cerrar (modo fixtures, sin sesión)";
    close.title = "Cierra el título sin arrancar sesión: fixtures del selector Room";
    close.style.cssText = [
      "position: absolute",
      "top: 12px",
      "right: 16px",
      "background: none",
      "border: 1px solid #444",
      "border-radius: 4px",
      "color: #888",
      "font: inherit",
      "font-size: 12px",
      "padding: 4px 10px",
      "cursor: pointer",
    ].join(";");
    close.addEventListener("click", () => {
      this.hide();
      console.log("[title] cerrado sin sesión — modo fixtures (selector Room + tecla G)");
    });
    this.root.appendChild(close);
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
    this.content.style.maxWidth = "720px";
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
      // El cambio de modo de render (imagen IA ⇄ maqueta) ya no vive aquí:
      // se hace EN PARTIDA desde el menú dev ("Imágenes…"), en runtime y en
      // ambos sentidos. Los badges de la tarjeta siguen siendo informativos.
    }

    newBtn.addEventListener("click", () => {
      void this.renderWorldSelect();
    });
  }

  /** Paso de selección de mundo: una tarjeta por juego (cover + descripción)
   *  y selector de estilo con el del juego preseleccionado. */
  private async renderWorldSelect(preselectGameId?: string): Promise<void> {
    // listGames must succeed — there's no scripted fallback any more. If it
    // throws, the title-screen surfaces the error and stops here.
    const { games, styles } = await this.narrative.listGames();
    if (games.length === 0) {
      throw new Error("no games available in bridge — check nefan-core/data/games/");
    }
    const styleById = new Map(styles.map((st) => [st.style_id, st]));
    let selectedGame = games.find((g) => g.game_id === preselectGameId) ?? games[0];
    this.lastSelectedGameId = selectedGame.game_id;

    // Pantalla ancha a dos columnas (mundos | opciones): sin scroll de página
    // — la lista de mundos scrollea DENTRO de su columna si hace falta. Las
    // demás pantallas restauran el ancho de una columna.
    this.content.style.maxWidth = "1100px";
    // Botón de opción compacto (misma estética, menos padding vertical).
    const OPT = `${BTN_SECONDARY_CSS};flex:1;text-align:left;padding:7px 10px`;
    this.content.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:10px">
        <h1 style="font-size:26px;color:#da6">Elige un mundo</h1>
        <p style="color:#888;font-size:12px">La historia la improvisa el motor narrativo dentro del mundo que elijas.</p>
      </div>
      <div style="display:grid;grid-template-columns:minmax(340px,1.15fr) minmax(330px,1fr);gap:20px;align-items:start;margin-bottom:14px">
        <div id="ts-worlds" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:calc(100vh - 220px);min-height:120px;padding-right:4px"></div>
        <div style="min-width:0;display:flex;flex-direction:column;gap:12px">
          <div>
            <div style="font-size:12px;color:#999;margin-bottom:4px">Vista <span style="color:#666">(fija para toda la partida)</span></div>
            <div id="ts-view" style="display:flex;gap:6px">
              <button data-view="overworld" style="${OPT}">
                <div style="font-size:13px">Mundo abierto</div>
                <div style="font-size:10px;color:#888">Plano continuo de tiles visto desde arriba</div>
              </button>
              <button data-view="proscenium" style="${OPT}">
                <div style="font-size:13px">Proscenio</div>
                <div style="font-size:10px;color:#888">Escenas discretas tipo plató de cine, a pie de calle</div>
              </button>
              <button data-view="fps" style="${OPT}">
                <div style="font-size:13px">Primera persona</div>
                <div style="font-size:10px;color:#888">El mundo a pie, estilo retro-FPS: el ratón mira, WASD mueve</div>
              </button>
            </div>
          </div>
          <label style="display:block">
            <div style="font-size:12px;color:#999;margin-bottom:4px">Estilo visual</div>
            <select id="ts-style" style="${SELECT_CSS}"></select>
            <div id="ts-style-desc" style="font-size:11px;color:#777;margin-top:4px"></div>
          </label>
          <div>
            <div style="font-size:12px;color:#999;margin-bottom:4px">Escenarios <span style="color:#666">(modo inicial; cambiable en partida desde el menú dev)</span></div>
            <div id="ts-rendermode" style="display:flex;gap:6px">
              <button data-rendermode="image" style="${OPT}">
                <div style="font-size:13px">Imagen IA</div>
                <div style="font-size:10px;color:#888">El modelo de imagen pinta cada zona del mundo (gasta créditos)</div>
              </button>
              <button data-rendermode="vector" style="${OPT}">
                <div style="font-size:13px">Maqueta 3D</div>
                <div style="font-size:10px;color:#888">El mundo se ve como maqueta 3D sin texturas (render local, sin coste)</div>
              </button>
            </div>
          </div>
          <div>
            <div style="font-size:12px;color:#999;margin-bottom:4px">Personajes <span style="color:#666">(independiente de los escenarios)</span></div>
            <div id="ts-charmode" style="display:flex;gap:6px">
              <button data-charmode="image" style="${OPT}${CONFIG.graphics.ai_skin ? "" : ";opacity:.45;cursor:default"}">
                <div style="font-size:13px">Skins IA</div>
                <div style="font-size:10px;color:#888">${CONFIG.graphics.ai_skin ? "Cada personaje se viste por su descripción (gasta créditos)" : "Deshabilitado — activa <code>graphics.ai_skin</code> en config.ts"}</div>
              </button>
              <button data-charmode="vector" style="${OPT}">
                <div style="font-size:13px">Base y_bot</div>
                <div style="font-size:10px;color:#888">Maniquí neutro para todos (sin coste)</div>
              </button>
            </div>
          </div>
          <div id="ts-gen" style="padding:10px 12px;border:1px solid #2a2a30;border-radius:4px;background:#14141a">
            <div style="font-size:12px;color:#999;margin-bottom:6px">Generación <span style="color:#666">(el mundo se genera por vista, sin estilo; el estilo se aplica sobre el mundo generado)</span></div>
            <div id="ts-gen-state" style="font-size:12px;margin-bottom:8px;line-height:1.6"></div>
            <div style="display:flex;gap:8px;margin-bottom:4px">
              <button id="ts-gen-world" style="${BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px"></button>
              <button id="ts-apply-style" style="${BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px"></button>
            </div>
            <div id="ts-style-plan"></div>
            <div id="ts-gen-progress" style="font-size:12px;margin-top:4px"></div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:12px">
        <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
        <button id="ts-continue" style="${BTN_PRIMARY_CSS}">Continuar →</button>
        <button id="ts-create-world" style="${BTN_SECONDARY_CSS};margin-left:auto">✚ Crear mundo</button>
        <button id="ts-upload-style" style="${BTN_SECONDARY_CSS}">🎨 Subir estilo</button>
      </div>
    `;
    const worldsEl = this.content.querySelector("#ts-worlds") as HTMLElement;
    const styleSel = this.content.querySelector("#ts-style") as HTMLSelectElement;
    const styleDesc = this.content.querySelector("#ts-style-desc") as HTMLElement;
    const viewEl = this.content.querySelector("#ts-view") as HTMLElement;
    const renderModeEl = this.content.querySelector("#ts-rendermode") as HTMLElement;
    const charModeEl = this.content.querySelector("#ts-charmode") as HTMLElement;
    const continueBtn = this.content.querySelector("#ts-continue") as HTMLButtonElement;
    let selectedRenderMode: "image" | "vector" = "image";
    // Personajes: sigue a Escenarios hasta que el jugador lo toque — elegir
    // "Maqueta 3D (sin coste)" no debe dejar los skins IA activados a
    // escondidas. Con graphics.ai_skin apagado el backend de skins no existe:
    // forzar vector para no vender una opción muerta.
    const skinBackendOn = CONFIG.graphics.ai_skin;
    let charModeTouched = false;
    let selectedCharMode: "image" | "vector" = skinBackendOn ? "image" : "vector";
    // La vista es del jugador, no del mundo: game.json solo la preselecciona.
    let selectedView: WorldView = normalizeView(selectedGame.view);
    const refreshRenderMode = (): void => {
      for (const btn of renderModeEl.querySelectorAll<HTMLElement>("[data-rendermode]")) {
        const active = btn.dataset.rendermode === selectedRenderMode;
        btn.style.borderColor = active ? "#da6" : "#2a2a30";
        btn.style.background = active ? "#201c14" : "#181820";
      }
    };
    for (const btn of renderModeEl.querySelectorAll<HTMLElement>("[data-rendermode]")) {
      btn.addEventListener("click", () => {
        selectedRenderMode = btn.dataset.rendermode === "vector" ? "vector" : "image";
        if (!charModeTouched && skinBackendOn) {
          selectedCharMode = selectedRenderMode;
          refreshCharMode();
        }
        refreshRenderMode();
      });
    }
    refreshRenderMode();
    const refreshCharMode = (): void => {
      for (const btn of charModeEl.querySelectorAll<HTMLElement>("[data-charmode]")) {
        const active = btn.dataset.charmode === selectedCharMode;
        btn.style.borderColor = active ? "#da6" : "#2a2a30";
        btn.style.background = active ? "#201c14" : "#181820";
      }
    };
    for (const btn of charModeEl.querySelectorAll<HTMLElement>("[data-charmode]")) {
      btn.addEventListener("click", () => {
        if (btn.dataset.charmode === "image" && !skinBackendOn) return; // opción muerta sin backend
        charModeTouched = true;
        selectedCharMode = btn.dataset.charmode === "vector" ? "vector" : "image";
        refreshCharMode();
      });
    }
    refreshCharMode();
    const refreshView = (): void => {
      for (const btn of viewEl.querySelectorAll<HTMLElement>("[data-view]")) {
        const active = btn.dataset.view === selectedView;
        btn.style.borderColor = active ? "#da6" : "#2a2a30";
        btn.style.background = active ? "#201c14" : "#181820";
      }
    };
    for (const btn of viewEl.querySelectorAll<HTMLElement>("[data-view]")) {
      btn.addEventListener("click", () => {
        selectedView = normalizeView(btn.dataset.view);
        refreshView();
        refreshStyleOptions();
        refreshGenPanel();
      });
    }

    worldsEl.innerHTML = games.map((g) => worldCardHtml(g, styleById.get(g.style_id))).join("");

    const refreshStyleOptions = (): void => {
      // Solo estilos con referencias para la vista elegida (styles.views,
      // derivado por el bridge de las refs declaradas de cada pack).
      const compatible = styles.filter((st) => st.views.includes(selectedView));
      styleSel.innerHTML = compatible
        .map((st) => {
          const def = st.style_id === selectedGame.style_id ? " (del mundo)" : "";
          return `<option value="${escapeAttr(st.style_id)}">${escapeHtml(st.name)}${def}</option>`;
        })
        .join("");
      if (compatible.length === 0) {
        styleSel.innerHTML = `<option value="" disabled selected>— ningún estilo compatible con esta vista —</option>`;
        styleDesc.innerHTML = `<span style="color:#a44">Ningún estilo tiene referencias para esta vista todavía.</span>`;
        continueBtn.disabled = true;
        continueBtn.style.opacity = "0.4";
        return;
      }
      continueBtn.disabled = false;
      continueBtn.style.opacity = "";
      // Preselección: el estilo del mundo si es compatible; si no, el primero.
      const preferred = compatible.some((st) => st.style_id === selectedGame.style_id)
        ? selectedGame.style_id
        : compatible[0].style_id;
      styleSel.value = preferred;
      styleDesc.textContent = styleById.get(preferred)?.description ?? "";
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
        this.lastSelectedGameId = game.game_id;
        // Cambiar de mundo resetea la vista a la default del juego (mismo
        // criterio que el estilo, que vuelve al del mundo).
        selectedView = normalizeView(game.view);
        refreshSelection();
        refreshView();
        refreshStyleOptions();
        refreshGenPanel();
      });
    }
    styleSel.addEventListener("change", () => {
      styleDesc.textContent = styleById.get(styleSel.value)?.description ?? "";
      refreshGenPanel();
    });

    // ── Panel de generación: mundo por (juego, vista) + estilo aplicado ──
    const genStateEl = this.content.querySelector("#ts-gen-state") as HTMLElement;
    const genWorldBtn = this.content.querySelector("#ts-gen-world") as HTMLButtonElement;
    const applyStyleBtn = this.content.querySelector("#ts-apply-style") as HTMLButtonElement;
    const stylePlanEl = this.content.querySelector("#ts-style-plan") as HTMLElement;
    const genProgressEl = this.content.querySelector("#ts-gen-progress") as HTMLElement;
    /** Confirmación en dos clicks para regenerar (patrón armed del dev-menu). */
    let regenArmedUntil = 0;
    const branchFor = (view: WorldView): "tile" | "stage" =>
      view === "proscenium" ? "stage" : "tile";
    const contentStatus = (): "ready" | "stale" | "missing" =>
      selectedGame.generation?.[branchFor(selectedView)] ?? "missing";
    const appliedStatus = (): "ready" | "stale" | null => {
      const hit = (selectedGame.styles_applied ?? []).find(
        (a) => a.view === selectedView && a.style_id === styleSel.value,
      );
      return hit ? hit.status : null;
    };
    const refreshGenPanel = (): void => {
      const cs = contentStatus();
      const as = appliedStatus();
      const CONTENT_LABEL: Record<string, string> = {
        ready: `<span style="color:#4a4">✓ generado</span>`,
        stale: `<span style="color:#da6">⟳ obsoleto (world.md cambió)</span>`,
        missing: `<span style="color:#a66">— sin generar</span>`,
      };
      const styleLabel = !styleSel.value
        ? `<span style="color:#666">—</span>`
        : as === "ready"
          ? `<span style="color:#4a4">✓ aplicado</span>`
          : as === "stale"
            ? `<span style="color:#da6">⟳ obsoleto (regenera el mundo/estilo)</span>`
            : `<span style="color:#a66">— sin aplicar</span>`;
      genStateEl.innerHTML =
        `Mundo (vista <span style="color:#bdf">${escapeHtml(VIEW_LABELS[selectedView] ?? selectedView)}</span>): ${CONTENT_LABEL[cs]}` +
        ` &nbsp;·&nbsp; Estilo <span style="color:#bdf">${escapeHtml(styleById.get(styleSel.value)?.name ?? "(ninguno)")}</span>: ${styleLabel}`;
      genWorldBtn.textContent = cs === "ready" ? "↻ Regenerar mundo" : "⚙ Generar mundo";
      genWorldBtn.disabled = false;
      applyStyleBtn.textContent =
        as === "ready" ? "↻ Regenerar estilo (ver coste)" : "🎨 Aplicar estilo (ver coste)";
      const canApply = cs === "ready" && !!styleSel.value;
      applyStyleBtn.disabled = !canApply;
      applyStyleBtn.style.opacity = canApply ? "" : "0.45";
      applyStyleBtn.title = canApply
        ? "Pre-genera los assets estilizados del mundo (coste estimado antes de gastar)"
        : "Genera primero el mundo para esta vista";
      stylePlanEl.innerHTML = "";
      regenArmedUntil = 0;
      this.renderGameGenProgress(genProgressEl);
    };
    genWorldBtn.addEventListener("click", async () => {
      if (contentStatus() === "ready") {
        // Regenerar pisa el mundo actual y deja obsoletos sus estilos
        // aplicados: dos clicks (armed, TTL 5 s), como las acciones de pago.
        if (Date.now() > regenArmedUntil) {
          regenArmedUntil = Date.now() + 5000;
          genWorldBtn.textContent = "¿Regenerar? El mundo actual y sus estilos aplicados quedarán obsoletos";
          return;
        }
      }
      genWorldBtn.disabled = true;
      genProgressEl.innerHTML = `<span style="color:#da6">⚙ Encolando la generación…</span>`;
      try {
        await this.narrative.generateGame(selectedGame.game_id, selectedView);
        genProgressEl.innerHTML = `<span style="color:#da6">⚙ Generando el mundo (el motor narrativo tarda varios minutos)…</span>`;
      } catch (err) {
        genProgressEl.innerHTML = `<span style="color:#a44">${escapeHtml((err as Error).message)}</span>`;
        genWorldBtn.disabled = false;
      }
    });
    applyStyleBtn.addEventListener("click", () => {
      void this.renderStylePlan(
        stylePlanEl,
        selectedGame.game_id,
        selectedView,
        styleSel.value,
      );
    });

    refreshSelection();
    refreshView();
    refreshStyleOptions();
    refreshGenPanel();

    (this.content.querySelector("#ts-back") as HTMLButtonElement)
      .addEventListener("click", () => void this.renderHome());
    continueBtn.addEventListener("click", () => {
      if (!styleSel.value) return;
      void this.renderCharacterEditor(selectedGame, styleSel.value, selectedRenderMode, selectedCharMode, selectedView);
    });
    (this.content.querySelector("#ts-create-world") as HTMLButtonElement)
      .addEventListener("click", () => void this.renderCreateWorld());
    (this.content.querySelector("#ts-upload-style") as HTMLButtonElement)
      .addEventListener("click", () => void this.renderUploadStyle());
  }

  /** Panel de aplicación de estilo: plan con coste (SIN gastar) → checkboxes
   *  por bloque → confirmación con el importe → batch con progreso. Patrón
   *  upload→coste→complete de los estilos de usuario. */
  private async renderStylePlan(
    el: HTMLElement,
    gameId: string,
    view: WorldView,
    styleId: string,
  ): Promise<void> {
    el.innerHTML = `<div style="font-size:12px;color:#da6;margin-top:6px">Calculando el coste (sin gastar)…</div>`;
    let plan: StyleApplyPlan;
    try {
      plan = await this.styleApply.plan(gameId, view, styleId);
    } catch (err) {
      el.innerHTML = `<div style="font-size:12px;color:#a44;margin-top:6px">${escapeHtml((err as Error).message)}</div>`;
      return;
    }
    const blocksHtml = plan.blocks
      .map(
        (b, i) => `
          <label style="display:block;font-size:12px;color:#bbb;margin-bottom:3px">
            <input type="checkbox" data-block-idx="${i}" ${b.selected ? "checked" : ""} ${b.missing === 0 ? "disabled" : ""}>
            ${escapeHtml(b.label)} — ${b.missing === 0 ? "en caché ($0)" : `${b.exact ? "" : "~"}$${b.estCostUsd.toFixed(2)}`}
          </label>`,
      )
      .join("");
    const notesHtml = plan.notes
      .map((n) => `<div style="color:#886;font-size:11px;margin-top:2px">· ${escapeHtml(n)}</div>`)
      .join("");
    el.innerHTML = `
      <div style="margin-top:8px;padding:8px 10px;border:1px solid #333;border-radius:4px;background:#101016">
        ${blocksHtml}
        ${notesHtml}
        <div id="ts-style-total" style="font-size:12px;color:#dcb;margin:8px 0 6px"></div>
        <div style="display:flex;gap:8px">
          <button id="ts-style-run" style="${BTN_PRIMARY_CSS};font-size:12px;padding:6px 14px"></button>
          <button id="ts-style-cancel" style="${BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px">Cancelar</button>
        </div>
        <div id="ts-style-progress" style="font-size:12px;margin-top:6px;color:#da6"></div>
      </div>`;
    const totalEl = el.querySelector("#ts-style-total") as HTMLElement;
    const runBtn = el.querySelector("#ts-style-run") as HTMLButtonElement;
    const cancelBtn = el.querySelector("#ts-style-cancel") as HTMLButtonElement;
    const progressEl = el.querySelector("#ts-style-progress") as HTMLElement;
    const refreshTotal = (): void => {
      const total = plan.blocks
        .filter((b) => b.selected && b.missing > 0)
        .reduce((acc, b) => acc + b.estCostUsd, 0);
      const anything = plan.blocks.some((b) => b.selected && b.missing > 0);
      totalEl.textContent = anything
        ? `Coste estimado: ~$${total.toFixed(2)} (los skins y páginas ya en caché no se repagan)`
        : "Nada seleccionado que genere coste.";
      runBtn.textContent = anything ? `Aplicar estilo (~$${total.toFixed(2)})` : "Registrar (sin coste)";
    };
    for (const cb of el.querySelectorAll<HTMLInputElement>("input[data-block-idx]")) {
      cb.addEventListener("change", () => {
        plan.blocks[Number(cb.dataset.blockIdx)].selected = cb.checked;
        refreshTotal();
      });
    }
    refreshTotal();
    cancelBtn.addEventListener("click", () => {
      el.innerHTML = "";
    });
    runBtn.addEventListener("click", async () => {
      runBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        const result = await this.styleApply.run(plan, (msg) => {
          progressEl.textContent = msg;
        });
        const failNote = result.failures.length
          ? ` · <span style="color:#a44">${result.failures.length} fallos (ver registro)</span>`
          : "";
        progressEl.innerHTML =
          `<span style="color:#4a4">Estilo aplicado: ${result.cellsPainted} celdas y ` +
          `${result.skinsPainted} skins nuevos ($${result.costUsd.toFixed(2)})${failNote}</span>`;
        await new Promise((r) => setTimeout(r, 1200));
        await this.renderWorldSelect(gameId);
      } catch (err) {
        progressEl.innerHTML = `<span style="color:#a44">${escapeHtml((err as Error).message)}</span>`;
        runBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });
  }

  /** Subir un estilo propio: nombre + al menos una imagen por categoría; las
   *  categorías que falten se generan con IA usando las subidas como
   *  referencia — PREVIA confirmación explícita del coste. */
  private renderUploadStyle(): void {
    this.content.style.maxWidth = "720px";
    this.content.innerHTML = `
      <h1 style="font-size:28px;color:#da6;margin-bottom:6px">Subir estilo</h1>
      <p style="margin-bottom:16px;color:#888;font-size:12px">
        Sube una o más imágenes de referencia (cuantas más categorías cubras, más fiel será el estilo).
        Las que falten se generarán con IA a partir de las tuyas — se te pedirá confirmación con el coste.
      </p>
      <label style="display:block;margin-bottom:12px">
        <div style="font-size:12px;color:#999;margin-bottom:4px">Nombre del estilo</div>
        <input id="ts-style-name" type="text" placeholder="ej: Tinta y pergamino" style="${INPUT_CSS}">
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
        ${STYLE_CATEGORY_LABELS.map((c) => `
          <label style="font-size:11px;color:#999">
            ${c.label}
            <input data-category="${c.id}" type="file" accept="image/*" style="display:block;color:#777;font-size:11px;margin-top:2px">
          </label>`).join("")}
      </div>
      <div id="ts-style-status" style="margin-bottom:14px;font-size:12px;color:#888"></div>
      <div style="display:flex;gap:12px">
        <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
        <button id="ts-upload" style="${BTN_PRIMARY_CSS}">Subir</button>
        <button id="ts-complete" style="${BTN_PRIMARY_CSS};display:none">Generar imágenes</button>
      </div>
    `;
    const nameEl = this.content.querySelector("#ts-style-name") as HTMLInputElement;
    const statusEl = this.content.querySelector("#ts-style-status") as HTMLElement;
    const backBtn = this.content.querySelector("#ts-back") as HTMLButtonElement;
    const uploadBtn = this.content.querySelector("#ts-upload") as HTMLButtonElement;
    const completeBtn = this.content.querySelector("#ts-complete") as HTMLButtonElement;
    let pendingStyleId = "";

    backBtn.addEventListener("click", () => void this.renderWorldSelect());

    uploadBtn.addEventListener("click", async () => {
      const name = nameEl.value.trim();
      if (name.length < 2) {
        statusEl.innerHTML = `<span style="color:#a44">Ponle un nombre al estilo.</span>`;
        return;
      }
      const inputs = [...this.content.querySelectorAll<HTMLInputElement>("input[data-category]")];
      const images: Array<{ category: string; image_b64: string }> = [];
      for (const input of inputs) {
        const file = input.files?.[0];
        if (!file) continue;
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result ?? ""));
          r.onerror = () => rej(new Error(`no se pudo leer ${file.name}`));
          r.readAsDataURL(file);
        });
        images.push({ category: input.dataset.category!, image_b64: b64 });
      }
      if (images.length === 0) {
        statusEl.innerHTML = `<span style="color:#a44">Sube al menos una imagen.</span>`;
        return;
      }
      uploadBtn.disabled = true;
      statusEl.textContent = "Subiendo imágenes al ai_server...";
      try {
        const res = await fetch(`${AI_SERVER_HTTP}/styles/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, images }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data = (await res.json()) as {
          style_id: string; uploaded: string[]; missing: string[]; estimated_cost_usd: number;
        };
        pendingStyleId = data.style_id;
        if (data.missing.length === 0) {
          statusEl.innerHTML = `<span style="color:#4a4">Estilo ${escapeHtml(data.style_id)} completo.</span>`;
          await this.renderWorldSelect();
          return;
        }
        statusEl.innerHTML = `<span style="color:#da6">Subidas ${data.uploaded.length}. Faltan ${data.missing.length} categorías `
          + `(${data.missing.join(", ")}). Generarlas costará ~$${data.estimated_cost_usd.toFixed(2)} en créditos Meshy.</span>`;
        uploadBtn.style.display = "none";
        completeBtn.style.display = "";
        completeBtn.textContent = `Generar ${data.missing.length} imágenes (~$${data.estimated_cost_usd.toFixed(2)})`;
      } catch (err) {
        statusEl.innerHTML = `<span style="color:#a44">Subida fallida: ${escapeHtml((err as Error).message)}</span>`;
        uploadBtn.disabled = false;
      }
    });

    completeBtn.addEventListener("click", async () => {
      completeBtn.disabled = true;
      backBtn.disabled = true;
      statusEl.innerHTML = `<span style="color:#da6">🎨 Generando las categorías que faltan (varios minutos)...</span>`;
      try {
        const res = await fetch(`${AI_SERVER_HTTP}/styles/${encodeURIComponent(pendingStyleId)}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data = (await res.json()) as { generated: string[]; cost_usd: number };
        statusEl.innerHTML = `<span style="color:#4a4">Generadas ${data.generated.length} imágenes ($${data.cost_usd.toFixed(2)}).</span>`;
        await this.renderWorldSelect();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:#a44">Generación fallida: ${escapeHtml((err as Error).message)}</span>`;
        completeBtn.disabled = false;
        backBtn.disabled = false;
      }
    });
  }

  /** Crear un mundo propio: textarea o archivo .md/.txt. El borrador se
   *  desarrolla con el motor narrativo (tarda 1-3 min) y aparece como un
   *  mundo más en el selector. */
  private renderCreateWorld(): void {
    this.content.style.maxWidth = "720px";
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
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:12px;color:#999">
        <input id="ts-pregen" type="checkbox" checked>
        Generar el mundo al crearlo (mapa, escenas iniciales y personajes — el motor tarda varios
        minutos en segundo plano; el estilo se aplica después con su coste a la vista)
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
        // Encadenar la pre-generación del mundo (vista default del juego):
        // corre en el bridge en segundo plano; el selector muestra el
        // progreso (kind "game_gen") y los chips al terminar. El estilo se
        // aplica después desde el panel (necesita confirmar su coste).
        const pregen = (this.content.querySelector("#ts-pregen") as HTMLInputElement | null)?.checked;
        if (pregen) {
          try {
            await this.narrative.generateGame(created.gameId);
          } catch (err) {
            statusEl.innerHTML += ` <span style="color:#a44">(pre-generación no encolada: ${escapeHtml((err as Error).message)})</span>`;
          }
        }
        await this.renderWorldSelect(created.gameId);
      } catch (err) {
        statusEl.innerHTML = `<span style="color:#a44">No se pudo crear el mundo: ${escapeHtml((err as Error).message)}</span>`;
        createBtn.disabled = false;
        backBtn.disabled = false;
      }
    });
  }

  private renderCharacterEditor(
    game: GameInfo,
    styleId: string,
    renderMode: "image" | "vector",
    characterMode: "image" | "vector",
    view: WorldView,
  ): void {
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

    this.content.style.maxWidth = "720px";
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
        renderMode,
        characterMode,
        view,
        appearance: {
          model_id: modelSel ? modelSel.value : "",
          skin_path: skinInput ? skinInput.value.trim() : "",
        },
      });
    });
  }
}

/** Chips de estado de generación de la tarjeta: qué ramas de contenido están
 *  generadas y qué estilos aplicados — "los generados" visibles de un vistazo. */
function generationChipsHtml(g: GameInfo): string {
  const STATUS_CHIP: Record<string, { icon: string; color: string }> = {
    ready: { icon: "✓", color: "#4a4" },
    stale: { icon: "⟳", color: "#da6" },
    missing: { icon: "—", color: "#555" },
  };
  const chip = (label: string, status: string): string => {
    const s = STATUS_CHIP[status] ?? STATUS_CHIP.missing;
    return `<span style="${BADGE_CSS};color:${s.color}">${escapeHtml(label)} ${s.icon}</span>`;
  };
  const gen = g.generation ?? { tile: "missing", stage: "missing" };
  const chips = [
    chip("Mundo abierto/1ª persona", gen.tile),
    chip("Proscenio", gen.stage),
    ...(g.styles_applied ?? []).map((a) =>
      chip(`🎨 ${a.style_id} (${VIEW_LABELS[a.view] ?? a.view})`, a.status),
    ),
  ];
  return `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${chips.join(" ")}</div>`;
}

function worldCardHtml(g: GameInfo, style: StyleInfo | undefined): string {
  const cover = style?.cover_url
    ? `<img src="${escapeAttr(ASSET_STORE_URL + style.cover_url)}" alt="" style="width:96px;height:64px;object-fit:cover;flex:none;border:1px solid #333">`
    : `<div style="width:96px;height:64px;flex:none;border:1px solid #333;background:linear-gradient(135deg,#23202b,#161419);display:flex;align-items:center;justify-content:center;color:#555;font-size:10px;text-align:center;padding:4px">${escapeHtml(style?.name ?? g.style_id)}</div>`;
  return `
    <div data-game-id="${escapeAttr(g.game_id)}" style="display:flex;gap:12px;padding:10px;background:#181820;border:2px solid #2a2a30;cursor:pointer;border-radius:4px">
      ${cover}
      <div style="flex:1;min-width:0">
        <div style="color:#dcb;font-size:14px;margin-bottom:3px">${escapeHtml(g.title)} <span style="color:#666;font-size:11px;font-weight:normal">· Estilo: ${escapeHtml(style?.name ?? g.style_id)}</span></div>
        <div style="color:#999;font-size:11px;line-height:1.45">${escapeHtml(g.description)}</div>
        ${generationChipsHtml(g)}
      </div>
    </div>
  `;
}

/** Etiquetas de vista/gráficos congelados en el save — los MISMOS nombres que
 *  los selectores de partida nueva, para que el jugador reconozca qué eligió.
 *  Saves antiguos sin los campos: sin badge (no adivinar). */
const VIEW_LABELS: Record<string, string> = {
  overworld: "Mundo abierto",
  proscenium: "Proscenio",
  fps: "Primera persona",
};
const RENDER_MODE_LABELS: Record<string, string> = { image: "Imagen IA", vector: "Maqueta 3D" };
const CHAR_MODE_LABELS: Record<string, string> = { image: "Skins IA", vector: "Personajes base" };
/** Modo EFECTIVO de personajes: sin campo, sigue a los escenarios (legacy). */
function effectiveCharMode(s: SessionMetadata): string | undefined {
  return s.character_mode || s.render_mode;
}
const BADGE_CSS = "display:inline-block;padding:1px 7px;border-radius:8px;font-size:10px;background:#23222c;border:1px solid #3a3846;color:#a99";

function sessionRowHtml(s: SessionMetadata): string {
  const summary = s.summary || "(sin narrativa todavía)";
  const updated = s.updated_at ? formatDate(s.updated_at) : "?";
  const charMode = effectiveCharMode(s);
  const badges = [
    s.view ? VIEW_LABELS[s.view] ?? s.view : null,
    s.render_mode ? RENDER_MODE_LABELS[s.render_mode] ?? s.render_mode : null,
    charMode ? CHAR_MODE_LABELS[charMode] ?? charMode : null,
  ]
    .filter((b): b is string => b !== null)
    .map((b) => `<span style="${BADGE_CSS}">${escapeHtml(b)}</span>`)
    .join(" ");
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:8px;background:#181820;border:1px solid #2a2a30">
      <div style="flex:1;min-width:0">
        <div style="color:#bdf;font-size:13px">${escapeHtml(s.game_id)} <span style="color:#666;font-size:11px">· ${escapeHtml(s.session_id)}</span>${badges ? " " + badges : ""}</div>
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
