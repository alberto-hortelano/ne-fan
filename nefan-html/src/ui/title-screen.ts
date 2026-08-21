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
import {
  SUGGESTED_THEME_TAGS,
  styleCompatibleWithGame,
  type WorldView,
} from "@nefan-core/src/games/style-refs.js";
import { serviceUrl } from "../net/service-urls.js";
import { StyleApplyController, type StyleApplyPlan } from "./style-apply.js";
import {
  CHAR_MODE_LABELS,
  MODE_COST_LABELS,
  RENDER_MODE_ICONS,
  RENDER_MODE_LABELS,
} from "./mode-labels.js";

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

/** Vistas de destino de una imagen de estilo en la UI de subida. La vista
 *  de cada ref es LIBRE (el contenido lo describe el usuario); "characters"
 *  agrupa los model sheets compartidos entre vistas. */
const UPLOAD_VIEW_LABELS: Array<{ id: string; label: string }> = [
  { id: "overworld", label: "Mundo (vista cenital)" },
  { id: "fps", label: "Primera persona" },
  { id: "characters", label: "Personaje (model sheet)" },
];

/** Vida del estado "armado" (¿confirmar gasto?) antes de desarmarse solo —
 *  mismo TTL que el chip de gráficos y el menú dev. */
const ARM_TTL_MS = 5000;

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
  /** Notifica show/hide al caller (main.ts oculta el chip de gráficos
   *  mientras el título está abierto). Cubre TODOS los cierres, incluido el
   *  modo fixtures por #ts-close, que no resuelve la promesa de show(). */
  onVisibilityChange: ((visible: boolean) => void) | null = null;
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
    // Distribución MÓVIL del selector de mundo: los estilos van inline (no
    // hay hoja del título), así que los overrides responsive viven en este
    // <style> con !important. Solo distribución: en pantallas estrechas la
    // rejilla colapsa a una columna, las filas de opciones envuelven y los
    // paddings de escritorio se reducen. Idempotente por id.
    if (!document.getElementById("title-screen-responsive")) {
      const css = document.createElement("style");
      css.id = "title-screen-responsive";
      css.textContent = `
        @media (max-width: 900px) {
          /* Solo laterales/inferior: el padding-top lo mide
             reserveDevPanelSpace() del panel de dev real (inline). */
          #title-screen {
            padding-left: 12px !important;
            padding-right: 12px !important;
            padding-bottom: 16px !important;
          }
          #title-screen #ts-columns { grid-template-columns: 1fr !important; gap: 14px !important; }
          #title-screen #ts-worlds { max-height: 38vh !important; }
          #title-screen #ts-view, #title-screen #ts-rendermode, #title-screen #ts-charmode {
            flex-wrap: wrap !important;
          }
          #title-screen #ts-view button, #title-screen #ts-rendermode button,
          #title-screen #ts-charmode button { min-width: 46% !important; }
          #title-screen #ts-actions { flex-wrap: wrap !important; gap: 8px !important; }
          #title-screen #ts-actions #ts-create-world { margin-left: 0 !important; }
          #title-screen h1 { font-size: 22px !important; }
        }
      `;
      document.head.appendChild(css);
    }
    // El padding superior sigue al panel de dev también al rotar/redimensionar
    // (una sola suscripción: el título vive tanto como la app).
    window.addEventListener("resize", () => {
      if (this.root && this.root.style.display !== "none") this.reserveDevPanelSpace();
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

  /** El panel de dev (#dev-status, z-index 10000) queda POR ENCIMA del título
   *  a propósito (caso de referencia 2026-08-09: coste visible al crear
   *  mundo/estilo). Su altura varía con el ancho Y con el contenido (se
   *  rellena async al conectar servicios; en móvil envuelve a varias líneas):
   *  el padding superior se mide del panel real y se re-mide con un
   *  ResizeObserver en vez de fijarse. */
  private devObserver: ResizeObserver | null = null;

  private reserveDevPanelSpace(): void {
    const dev = document.getElementById("dev-status");
    if (dev && !this.devObserver && "ResizeObserver" in window) {
      this.devObserver = new ResizeObserver(() => {
        if (this.root.style.display !== "none") this.reserveDevPanelSpace();
      });
      this.devObserver.observe(dev);
    }
    // bottom, no height: el panel no empieza en y=0 (la barra del HUD queda
    // encima) — lo que hay que despejar es hasta dónde LLEGA.
    const devBottom = dev ? Math.ceil(dev.getBoundingClientRect().bottom) : 0;
    this.root.style.paddingTop = `${Math.max(96, devBottom + 10)}px`;
  }

  async show(): Promise<TitleAction> {
    this.root.style.display = "flex";
    this.onVisibilityChange?.(true);
    this.reserveDevPanelSpace();
    await this.renderHome();
    return new Promise<TitleAction>((res) => {
      this.resolve = res;
    });
  }

  hide(): void {
    this.root.style.display = "none";
    this.onVisibilityChange?.(false);
  }

  /** ¿El overlay tapa el juego? Lo consulta el bench de QA: el título es el
   *  primer estado del sistema y ninguna comprobación vale mientras cubre la
   *  pantalla (regla del workaround — ocultarlo para fotografiar es trampa). */
  get isVisible(): boolean {
    return this.root.style.display !== "none";
  }

  private async renderHome(): Promise<void> {
    this.modeArmed.clear();
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
      statusEl.innerHTML = `<span style="color:#a44">No se puede contactar al bridge (${(err as Error).message}). Arranca <code>./start.sh</code> y elige un preset con bridge (p. ej. "Cliente web (dev)").</span>`;
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
      // Los badges de modo son SELECTORES: cambian el modo del save ANTES de
      // cargar (set_render_mode sobre partida inactiva — el bridge escribe el
      // state.json en disco). Así un save con Imagen IA se puede reanudar en
      // maqueta sin que el atlas de superficies gaste créditos al entrar. En
      // partida, el mismo campo lo cambia el chip de gráficos (🎨/🧱).
      for (const btn of sessionsEl.querySelectorAll<HTMLButtonElement>("button[data-mode-facet]")) {
        btn.addEventListener("click", () => void this.onModeBadge(btn, sessions));
      }
    }

    newBtn.addEventListener("click", () => {
      void this.renderWorldSelect();
    });
  }

  /** Badges de modo armados (primer click de encendido) → timestamp. Se
   *  limpia en cada repintado de home (el re-render invalida los botones). */
  private modeArmed = new Map<string, number>();

  /** Click en un badge de modo de la lista de saves: alterna image⇄vector en
   *  el save (partida inactiva) vía el bridge. Encender = confirmación en dos
   *  clicks (patrón armed del chip); apagar es directo. Tras el cambio se
   *  repinta home re-listando del bridge: el badge refleja lo PERSISTIDO. */
  private async onModeBadge(
    btn: HTMLButtonElement,
    sessions: SessionMetadata[],
  ): Promise<void> {
    const sessionId = btn.dataset.sessionId!;
    const facet = btn.dataset.modeFacet as "scenes" | "characters";
    const s = sessions.find((x) => x.session_id === sessionId);
    if (!s) return;
    const current = facet === "scenes" ? s.render_mode : effectiveCharMode(s);
    const target = current === "image" ? "vector" : "image";
    const key = `${sessionId}:${facet}`;
    if (target === "image" && !this.modeArmed.has(key)) {
      this.modeArmed.set(key, performance.now());
      const orig = btn.textContent ?? "";
      btn.textContent = "¿Confirmar? Gastará créditos";
      btn.style.borderColor = "#a63";
      btn.style.color = "#da6";
      setTimeout(() => {
        if (!this.modeArmed.has(key) || !btn.isConnected) return;
        this.modeArmed.delete(key);
        btn.textContent = orig;
        btn.style.borderColor = "";
        btn.style.color = "";
      }, ARM_TTL_MS);
      return;
    }
    this.modeArmed.delete(key);
    btn.disabled = true;
    try {
      await this.narrative.setRenderMode(sessionId, facet, target as "image" | "vector");
    } catch (err) {
      await this.renderHome();
      const st = this.content.querySelector<HTMLElement>("#ts-status");
      if (st) {
        st.innerHTML = `<span style="color:#a44">No se pudo cambiar el modo de ${escapeHtml(sessionId)}: ${escapeHtml((err as Error).message)}</span>`;
      }
      return;
    }
    await this.renderHome();
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
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;margin-bottom:10px">
        <h1 style="font-size:26px;color:#da6">Elige un mundo</h1>
        <p style="color:#888;font-size:12px">La historia la improvisa el motor narrativo dentro del mundo que elijas.</p>
      </div>
      <div id="ts-columns" style="display:grid;grid-template-columns:minmax(340px,1.15fr) minmax(330px,1fr);gap:20px;align-items:start;margin-bottom:14px">
        <div id="ts-worlds" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:calc(100vh - 220px);min-height:120px;padding-right:4px"></div>
        <div style="min-width:0;display:flex;flex-direction:column;gap:12px">
          <label style="display:block">
            <div style="font-size:12px;color:#999;margin-bottom:4px">Estilo visual</div>
            <select id="ts-style" style="${SELECT_CSS}"></select>
            <div id="ts-style-desc" style="font-size:11px;color:#777;margin-top:4px"></div>
          </label>
          <div>
            <div style="font-size:12px;color:#999;margin-bottom:4px">Escenarios <span style="color:#666">(modo inicial; en partida se cambia desde el indicador ${RENDER_MODE_ICONS.image}/${RENDER_MODE_ICONS.vector} de la esquina inferior derecha)</span></div>
            <div id="ts-rendermode" style="display:flex;gap:6px">
              <button data-rendermode="image" style="${OPT}">
                <div style="font-size:13px">${RENDER_MODE_ICONS.image} ${RENDER_MODE_LABELS.image}</div>
                <div style="font-size:10px;color:#888">El modelo de imagen pinta cada zona del mundo (${MODE_COST_LABELS.image})</div>
              </button>
              <button data-rendermode="vector" style="${OPT}">
                <div style="font-size:13px">${RENDER_MODE_ICONS.vector} ${RENDER_MODE_LABELS.vector}</div>
                <div style="font-size:10px;color:#888">El mundo se ve como maqueta 3D sin texturas (render local, ${MODE_COST_LABELS.vector})</div>
              </button>
            </div>
          </div>
          <div>
            <div style="font-size:12px;color:#999;margin-bottom:4px">Personajes <span style="color:#666">(independiente de los escenarios)</span></div>
            <div id="ts-charmode" style="display:flex;gap:6px">
              <button data-charmode="image" style="${OPT}${CONFIG.graphics.ai_skin ? "" : ";opacity:.45;cursor:default"}">
                <div style="font-size:13px">${RENDER_MODE_ICONS.image} ${CHAR_MODE_LABELS.image}</div>
                <div style="font-size:10px;color:#888">${CONFIG.graphics.ai_skin ? `Cada personaje se viste por su descripción (${MODE_COST_LABELS.image})` : "Deshabilitado — activa <code>graphics.ai_skin</code> en config.ts"}</div>
              </button>
              <button data-charmode="vector" style="${OPT}">
                <div style="font-size:13px">${RENDER_MODE_ICONS.vector} Base y_bot</div>
                <div style="font-size:10px;color:#888">Maniquí neutro para todos (${MODE_COST_LABELS.vector})</div>
              </button>
            </div>
          </div>
          <div id="ts-gen" style="padding:10px 12px;border:1px solid #2a2a30;border-radius:4px;background:#14141a">
            <div style="font-size:12px;color:#999;margin-bottom:6px">Generación <span style="color:#666">(el mundo se genera por vista, sin estilo; el estilo se aplica sobre el mundo generado)</span></div>
            <div id="ts-gen-state" style="font-size:12px;margin-bottom:8px;line-height:1.6"></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px">
              <button id="ts-gen-world" style="${BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px"></button>
              <button id="ts-apply-style" style="${BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px"></button>
            </div>
            <div id="ts-style-plan"></div>
            <div id="ts-gen-progress" style="font-size:12px;margin-top:4px"></div>
          </div>
        </div>
      </div>
      <div id="ts-actions" style="display:flex;gap:12px">
        <button id="ts-back" style="${BTN_SECONDARY_CSS}">← Volver</button>
        <button id="ts-continue" style="${BTN_PRIMARY_CSS}">Continuar →</button>
        <button id="ts-create-world" style="${BTN_SECONDARY_CSS};margin-left:auto">✚ Crear mundo</button>
        <button id="ts-upload-style" style="${BTN_SECONDARY_CSS}">🎨 Subir estilo</button>
      </div>
    `;
    const worldsEl = this.content.querySelector("#ts-worlds") as HTMLElement;
    const styleSel = this.content.querySelector("#ts-style") as HTMLSelectElement;
    const styleDesc = this.content.querySelector("#ts-style-desc") as HTMLElement;
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
    // Ya no se elige: el cliente tiene UNA vista. `game.json` puede seguir
    // declarando la suya (el campo muere con el contrato), pero ofrecer un
    // botón que lleva al mismo sitio es mentir — y peor: el batch de estilo
    // pre-genera los skins al ÁNGULO de la vista elegida, así que elegir una
    // vista muerta pagaba arte que la partida no volvería a encontrar.
    const selectedView: WorldView = "fps";
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
    worldsEl.innerHTML = games.map((g) => worldCardHtml(g, styleById.get(g.style_id))).join("");

    const refreshStyleOptions = (): void => {
      // Solo estilos con referencias para la vista elegida (styles.views,
      // derivado por el bridge de las refs declaradas de cada pack) Y
      // temáticamente compatibles con el mundo (intersección de tags — un
      // pack medieval no se ofrece para un juego futurista).
      const compatible = styles.filter(
        (st) =>
          st.views.includes(selectedView) &&
          styleCompatibleWithGame(st.tags, selectedGame.tags),
      );
      styleSel.innerHTML = compatible
        .map((st) => {
          const def = st.style_id === selectedGame.style_id ? " (del mundo)" : "";
          return `<option value="${escapeAttr(st.style_id)}">${escapeHtml(st.name)}${def}</option>`;
        })
        .join("");
      if (compatible.length === 0) {
        styleSel.innerHTML = `<option value="" disabled selected>— ningún estilo compatible con esta vista y este mundo —</option>`;
        styleDesc.innerHTML = `<span style="color:#a44">Ningún estilo compatible con esta vista y los tags del mundo todavía.</span>`;
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
        refreshSelection();
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
        `Mundo: ${CONTENT_LABEL[cs]}` +
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
    const rowHtml = (): string => `
      <div data-upload-row style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;margin-bottom:8px;padding:8px;border:1px solid #2a2a30;border-radius:6px">
        <input data-file type="file" accept="image/*" style="color:#777;font-size:11px;max-width:170px">
        <input data-desc type="text" placeholder="qué muestra (ej: catedral gótica al atardecer)" style="${INPUT_CSS}">
        <select data-view style="${SELECT_CSS};width:auto">
          ${UPLOAD_VIEW_LABELS.map((v) => `<option value="${v.id}">${v.label}</option>`).join("")}
        </select>
      </div>`;
    this.content.innerHTML = `
      <h1 style="font-size:28px;color:#da6;margin-bottom:6px">Subir estilo</h1>
      <p style="margin-bottom:16px;color:#888;font-size:12px">
        Sube una o más imágenes de referencia LIBRES — cada una con una descripción de lo que muestra
        (el motor narrativo la usa para elegir la referencia de cada escena) y la vista a la que sirve.
        Las refs mínimas que falten se generarán con IA a partir de las tuyas — se te pedirá confirmación con el coste.
      </p>
      <label style="display:block;margin-bottom:12px">
        <div style="font-size:12px;color:#999;margin-bottom:4px">Nombre del estilo</div>
        <input id="ts-style-name" type="text" placeholder="ej: Tinta y pergamino" style="${INPUT_CSS}">
      </label>
      <div style="margin-bottom:12px">
        <div style="font-size:12px;color:#999;margin-bottom:4px">Etiquetas temáticas (para casarlo con mundos compatibles)</div>
        <div id="ts-style-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
          ${SUGGESTED_THEME_TAGS.map((t) => `
            <button data-tag="${t}" style="${BTN_SECONDARY_CSS};font-size:11px;padding:2px 8px">${t}</button>`).join("")}
        </div>
        <input id="ts-style-tags-free" type="text" placeholder="otras etiquetas, separadas por comas" style="${INPUT_CSS}">
      </div>
      <div id="ts-upload-rows">${rowHtml()}</div>
      <button id="ts-add-row" style="${BTN_SECONDARY_CSS};font-size:11px;margin-bottom:14px">+ otra imagen</button>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:12px;color:#999">
        <input id="ts-style-lamina" type="checkbox">
        Una de las imágenes "Primera persona" es la lámina de materiales (rejilla de muestras planas)
      </label>
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
    const rowsEl = this.content.querySelector("#ts-upload-rows") as HTMLElement;
    const tagsEl = this.content.querySelector("#ts-style-tags") as HTMLElement;
    const tagsFreeEl = this.content.querySelector("#ts-style-tags-free") as HTMLInputElement;
    const laminaEl = this.content.querySelector("#ts-style-lamina") as HTMLInputElement;
    const selectedTags = new Set<string>();
    let pendingStyleId = "";

    for (const btn of tagsEl.querySelectorAll<HTMLElement>("[data-tag]")) {
      btn.addEventListener("click", () => {
        const tag = btn.dataset.tag!;
        if (selectedTags.has(tag)) selectedTags.delete(tag);
        else selectedTags.add(tag);
        btn.style.borderColor = selectedTags.has(tag) ? "#da6" : "#2a2a30";
        btn.style.background = selectedTags.has(tag) ? "#201c14" : "#181820";
      });
    }
    (this.content.querySelector("#ts-add-row") as HTMLButtonElement).addEventListener(
      "click",
      () => rowsEl.insertAdjacentHTML("beforeend", rowHtml()),
    );
    backBtn.addEventListener("click", () => void this.renderWorldSelect());

    uploadBtn.addEventListener("click", async () => {
      const name = nameEl.value.trim();
      if (name.length < 2) {
        statusEl.innerHTML = `<span style="color:#a44">Ponle un nombre al estilo.</span>`;
        return;
      }
      const tags = [
        ...selectedTags,
        ...tagsFreeEl.value.split(",").map((t) => t.trim()).filter(Boolean),
      ];
      if (tags.length === 0) {
        statusEl.innerHTML = `<span style="color:#a44">Elige al menos una etiqueta temática.</span>`;
        return;
      }
      const rows = [...rowsEl.querySelectorAll<HTMLElement>("[data-upload-row]")];
      const images: Array<{ view: string; description: string; image_b64: string; role?: string }> = [];
      let laminaPending = laminaEl.checked;
      for (const row of rows) {
        const file = (row.querySelector("[data-file]") as HTMLInputElement).files?.[0];
        if (!file) continue;
        const description = (row.querySelector("[data-desc]") as HTMLInputElement).value.trim();
        const view = (row.querySelector("[data-view]") as HTMLSelectElement).value;
        const isLamina = laminaPending && view === "fps";
        if (!description && !isLamina) {
          statusEl.innerHTML = `<span style="color:#a44">Cada imagen necesita su descripción (${escapeHtml(file.name)}).</span>`;
          return;
        }
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result ?? ""));
          r.onerror = () => rej(new Error(`no se pudo leer ${file.name}`));
          r.readAsDataURL(file);
        });
        // La primera imagen fps con el toggle activo es la lámina.
        images.push({ view, description, image_b64: b64, ...(isLamina ? { role: "fps_surfaces" } : {}) });
        if (isLamina) laminaPending = false;
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
          body: JSON.stringify({ name, tags, images }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data = (await res.json()) as {
          style_id: string;
          uploaded: string[];
          missing: Array<{ id: string; view: string; description: string }>;
          estimated_cost_usd: number;
        };
        pendingStyleId = data.style_id;
        if (data.missing.length === 0) {
          statusEl.innerHTML = `<span style="color:#4a4">Estilo ${escapeHtml(data.style_id)} completo.</span>`;
          await this.renderWorldSelect();
          return;
        }
        statusEl.innerHTML = `<span style="color:#da6">Subidas ${data.uploaded.length}. Faltan ${data.missing.length} refs `
          + `(${data.missing.map((m) => m.id).join(", ")}). Generarlas costará ~$${data.estimated_cost_usd.toFixed(2)} en créditos.</span>`;
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
      statusEl.innerHTML = `<span style="color:#da6">🎨 Generando las refs que faltan (varios minutos)...</span>`;
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
    // La rama `stage` no se pinta: no hay vista que la juegue. El campo sigue
    // en el contrato del bridge y muere con `WORLD_BRANCHES`.
    chip("Mundo abierto/1ª persona", gen.tile),
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
/** Modo EFECTIVO de personajes: sin campo, sigue a los escenarios (legacy). */
function effectiveCharMode(s: SessionMetadata): string | undefined {
  return s.character_mode || s.render_mode;
}
const BADGE_CSS = "display:inline-block;padding:1px 7px;border-radius:8px;font-size:10px;background:#23222c;border:1px solid #3a3846;color:#a99";
/** Badge de modo CLICABLE (selector antes de cargar): misma silueta que el
 *  badge informativo, con cursor y hover del lado de button. */
const MODE_BADGE_CSS = `${BADGE_CSS};cursor:pointer;font-family:inherit`;

/** Badge-selector del modo de una faceta del save. Click = alternar
 *  image⇄vector ANTES de cargar (onModeBadge). Saves legacy sin el campo: sin
 *  badge (no adivinar). */
function modeBadgeHtml(s: SessionMetadata, facet: "scenes" | "characters"): string {
  const mode = facet === "scenes" ? s.render_mode : effectiveCharMode(s);
  if (mode !== "image" && mode !== "vector") return "";
  const labels = facet === "scenes" ? RENDER_MODE_LABELS : CHAR_MODE_LABELS;
  const target = mode === "image" ? "vector" : "image";
  const facetEs = facet === "scenes" ? "Escenarios" : "Personajes";
  // Encender skins con el backend apagado por config: badge muerto con motivo
  // (mismo criterio que el chip de gráficos).
  const blocked = facet === "characters" && target === "image" && !CONFIG.graphics.ai_skin;
  const title = blocked
    ? "Backend de skins apagado por config: activa graphics.ai_skin en nefan-core/src/config.ts"
    : `${facetEs}: click para cambiar a ${labels[target]} antes de cargar (${MODE_COST_LABELS[target]})`;
  return `<button data-mode-facet="${facet}" data-session-id="${escapeAttr(s.session_id)}"${blocked ? " disabled" : ""} title="${escapeAttr(title)}" style="${MODE_BADGE_CSS}${blocked ? ";opacity:.45;cursor:default" : ""}">${RENDER_MODE_ICONS[mode]} ${escapeHtml(labels[mode])}</button>`;
}

function sessionRowHtml(s: SessionMetadata): string {
  const summary = s.summary || "(sin narrativa todavía)";
  const updated = s.updated_at ? formatDate(s.updated_at) : "?";
  const badges = [
    s.view ? `<span style="${BADGE_CSS}">${escapeHtml(VIEW_LABELS[s.view] ?? s.view)}</span>` : "",
    modeBadgeHtml(s, "scenes"),
    modeBadgeHtml(s, "characters"),
  ]
    .filter(Boolean)
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
