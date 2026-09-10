/** El SELECTOR DE MUNDOS del título: elegir mundo, estilo, modos y generación.
 *
 *  Una tarjeta por juego (portada del estilo ELEGIDO + descripción + chips de
 *  «lo generado»), el desplegable de estilo, los dos pares de botones de modo
 *  —escenarios y personajes— y el panel de generación, que es el único sitio
 *  del título desde donde se le encarga un mundo al motor narrativo.
 *
 *  SEIS colaboradores y ni uno más, que es lo que la crítica de #346 midió para
 *  los dos concentradores una vez que la navegación deja de ser un método y pasa
 *  a ser el callback `ir(destino)`. Sin él esta pantalla necesitaría nueve
 *  parámetros —volver al home, ir al editor, crear mundo, subir estilo— y el
 *  corte reintroduciría por la puerta de atrás el objeto de contexto que esta
 *  casa lleva rechazado dos veces por escrito.
 *
 *  Lo que NO está aquí y podría parecer que sí:
 *  - El MAPA de progresos por juego (#313) y la memoria de qué tarjeta se está
 *    mirando. Son de la raíz, que es quien escucha al bridge y sigue viva cuando
 *    esta pantalla ya no está; aquí se tocan por `progresoDe` y `recordarMundo`.
 *    Eso es lo que deja a `pintarProgresoDeMundo` sin un solo `this`.
 *  - El PANEL DE COSTE de «Aplicar estilo» (`ui/titulo/plan-de-estilo.ts`) y la
 *    corrida que gasta (`ui/style-apply.ts`, #513). Una hoja no puede importar a
 *    otra (`las-hojas-del-titulo-no-se-atan-entre-si`), así que el panel se abre
 *    por `mostrarPlanDeEstilo`, que cablea la raíz.
 *
 *  NINGÚN OYENTE DE POR VIDA: los de esta pantalla cuelgan de nodos que ella
 *  misma crea dentro de `content`, y el `innerHTML` del siguiente pintado se los
 *  lleva con ellos. Los cinco que sobreviven a un repintado son de la raíz y
 *  siguen siendo cinco. Enganchar aquí a `document`, `window` o al propio
 *  `content` filtraría un oyente por visita, y eso no lo ve ningún test verde.
 */
import type { NarrativeClient } from "../../net/narrative-client.js";
import type { NarrativeStatusDeJuego } from "@nefan-core/src/protocol/messages.js";
import { CONFIG } from "@nefan-core/src/config.js";
import { eleccionDeEstilo } from "@nefan-core/src/session/eleccion-de-estilo.js";
import { paso } from "../async-ui.js";
import {
  CHAR_MODE_LABELS,
  MODE_COST_LABELS,
  RENDER_MODE_ICONS,
  RENDER_MODE_LABELS,
} from "../mode-labels.js";
import {
  BTN_PRIMARY_CSS,
  BTN_SECONDARY_CSS,
  type DestinoDelTitulo,
  SELECT_CSS,
  coverHtml,
  escapeAttr,
  escapeHtml,
  worldCardHtml,
} from "./atomos.js";

export interface DepsDeSelectorDeMundo {
  /** El hueco del título donde se pinta. Esta pantalla lo reescribe entero y
   *  además le ensancha la columna a 1.100 px para caber a dos; las demás
   *  restauran el ancho de una al pintarse. */
  content: HTMLDivElement;
  /** El socket del juego: trae el catálogo de mundos y estilos (`listGames`) y
   *  encola la pre-generación de un mundo (`generateGame`). Es lo único de esta
   *  hoja que habla por la red. */
  narrative: NarrativeClient;
  /** Apunta qué tarjeta está mirando el jugador. La memoria es de la RAÍZ
   *  porque quien la lee es su oyente del bridge, que sigue vivo cuando esta
   *  pantalla ya no está: sin ella, el progreso de un mundo se pintaría bajo la
   *  tarjeta de otro (#313). */
  recordarMundo(gameId: string): void;
  /** El último progreso conocido de un mundo, o `undefined` si no hay ninguno.
   *  Lo apunta la raíz según se lo cuenta el bridge; aquí solo se pinta. */
  progresoDe(gameId: string): NarrativeStatusDeJuego | undefined;
  /** A dónde va el título cuando esta pantalla termina: al home («Volver»), al
   *  editor de personaje («Continuar»), a «Crear mundo» o a «Subir estilo». Es
   *  el único camino de vuelta que tiene una hoja —no puede importar a otra— y
   *  devuelve la promesa del repintado para que el llamante la encauce con
   *  `paso()` en vez de perderla. */
  ir(destino: DestinoDelTitulo): Promise<void>;
  /** Abre el panel de coste de «Aplicar estilo» DENTRO del hueco que este
   *  selector le deja en su panel de generación (`#ts-style-plan`). No es un
   *  destino de `ir` porque no sustituye la pantalla: se monta dentro. Lo cablea
   *  la raíz porque el panel es otra hoja y necesita además el
   *  `StyleApplyController`, que esta no puede alcanzar. */
  mostrarPlanDeEstilo(hueco: HTMLElement, gameId: string, styleId: string): Promise<void>;
}

/** Pinta el progreso de UN mundo en la línea que se le da, o la vacía si no
 *  hay estado que pintar.
 *
 *  Recibe el ESTADO YA RESUELTO y no el `gameId`: el mapa de progresos por
 *  juego (#313) y la memoria de qué tarjeta se está mirando son de la raíz —
 *  ella es quien escucha al bridge—, así que resolver aquí obligaría a esta
 *  hoja a tener un `this`. Con el estado dentro, la función es pura sobre el
 *  DOM y sus dos llamantes eligen por su cuenta de qué tarjeta hablan: la raíz
 *  del mundo que el jugador está mirando, el panel de generación del suyo. */
export function pintarProgresoDeMundo(
  line: HTMLElement,
  estado: NarrativeStatusDeJuego | undefined,
): void {
  if (!estado) {
    line.textContent = "";
    line.removeAttribute("data-gen-phase");
    return;
  }
  // La FASE, como dato y no como prosa: `ready` y `error` son estados
  // terminales, y quien espera (el jugador mirando, o un guion de QA) no
  // tiene que adivinarlos leyendo el texto. Antes había que casar un regex
  // contra el mensaje, y bastó añadir un mensaje de error nuevo para que la
  // espera dejara de reconocer el final y se comiera su tope entero.
  line.dataset.genPhase = estado.phase;
  const mins = estado.elapsedMs !== undefined ? ` · ${Math.round(estado.elapsedMs / 60000)} min` : "";
  if (estado.phase === "error") {
    line.innerHTML = `<span style="color:#a44">${escapeHtml(estado.message ?? "la generación falló")}</span>`;
  } else if (estado.phase === "ready") {
    line.innerHTML = `<span style="color:#4a4">${escapeHtml(estado.message ?? "Mundo generado.")}</span>`;
  } else {
    line.innerHTML = `<span style="color:#da6">⚙ ${escapeHtml(estado.message ?? "Generando…")}${mins}</span>`;
  }
}

/** Paso de selección de mundo: una tarjeta por juego (cover + descripción)
 *  y selector de estilo con el del juego preseleccionado. */
export async function pintarSelectorDeMundo(
  deps: DepsDeSelectorDeMundo,
  preselectGameId?: string,
): Promise<void> {
  // listGames must succeed — there's no scripted fallback any more. If it
  // throws, the title-screen surfaces the error and stops here.
  const { games, styles } = await deps.narrative.listGames();
  if (games.length === 0) {
    throw new Error("no games available in bridge — check nefan-core/data/games/");
  }
  const styleById = new Map(styles.map((st) => [st.style_id, st]));
  let selectedGame = games.find((g) => g.game_id === preselectGameId) ?? games[0];
  deps.recordarMundo(selectedGame.game_id);

  // Pantalla ancha a dos columnas (mundos | opciones): sin scroll de página
  // — la lista de mundos scrollea DENTRO de su columna si hace falta. Las
  // demás pantallas restauran el ancho de una columna.
  deps.content.style.maxWidth = "1100px";
  // EL TOPE DE LA LISTA DE MUNDOS sale de `base.css` y no de un número aquí
  // (#553): era `calc(100vh - 220px)`, y esos 220 px se quedaban 65 cortos —a
  // 1440×900 la columna pedía 725 de los 708 que hay y «Continuar →» quedaba
  // cortado 17 px de sus 39—. La variable `--ts-fuera-de-la-lista` es la suma
  // de lo que NO es la lista, derivada del mismo sitio donde vive el padding
  // del overlay, así que retocar la barra de dev no vuelve a descuadrarla.
  // Botón de opción compacto (misma estética, menos padding vertical).
  const OPT = `${BTN_SECONDARY_CSS};flex:1;text-align:left;padding:7px 10px`;
  deps.content.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;margin-bottom:10px">
      <h1 style="font-size:26px;color:#da6">Elige un mundo</h1>
      <p style="color:#888;font-size:12px">La historia la improvisa el motor narrativo dentro del mundo que elijas.</p>
    </div>
    <div id="ts-columns" style="display:grid;grid-template-columns:minmax(340px,1.15fr) minmax(330px,1fr);gap:20px;align-items:start;margin-bottom:14px">
      <div id="ts-worlds" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;max-height:calc(100vh - var(--ts-fuera-de-la-lista));min-height:120px;padding-right:4px"></div>
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
          <div style="font-size:12px;color:#999;margin-bottom:6px">Generación <span style="color:#666">(primero el mundo, sin estilo; el estilo se aplica después sobre el mundo generado)</span></div>
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
  const worldsEl = deps.content.querySelector("#ts-worlds") as HTMLElement;
  const styleSel = deps.content.querySelector("#ts-style") as HTMLSelectElement;
  const styleDesc = deps.content.querySelector("#ts-style-desc") as HTMLElement;
  const renderModeEl = deps.content.querySelector("#ts-rendermode") as HTMLElement;
  const charModeEl = deps.content.querySelector("#ts-charmode") as HTMLElement;
  const continueBtn = deps.content.querySelector("#ts-continue") as HTMLButtonElement;
  let selectedRenderMode: "image" | "vector" = "image";
  // Personajes: sigue a Escenarios hasta que el jugador lo toque — elegir
  // "Maqueta 3D (sin coste)" no debe dejar los skins IA activados a
  // escondidas. Con graphics.ai_skin apagado el backend de skins no existe:
  // forzar vector para no vender una opción muerta.
  const skinBackendOn = CONFIG.graphics.ai_skin;
  let charModeTouched = false;
  let selectedCharMode: "image" | "vector" = skinBackendOn ? "image" : "vector";
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
    // QUÉ SE OFRECE Y QUÉ VIENE PUESTO lo decide `eleccionDeEstilo` de core,
    // que es la misma función con la que el bridge le pone estilo a un mundo
    // nuevo. Aquí solo se pinta: el rótulo dice por qué está ahí un pack que
    // el filtro temático no habría traído.
    const { ofrecidos, porDefecto } = eleccionDeEstilo(styles, selectedGame);
    styleSel.innerHTML = ofrecidos
      .map(({ estilo, compatible, delMundo }) => {
        const marca = delMundo
          ? compatible ? " (del mundo)" : " (del mundo · otro tema)"
          : compatible ? "" : " (otro tema)";
        return `<option value="${escapeAttr(estilo.style_id)}">${escapeHtml(estilo.name)}${marca}</option>`;
      })
      .join("");
    if (porDefecto === null) {
      styleSel.innerHTML = `<option value="" disabled selected>— no hay ningún estilo instalado —</option>`;
      styleDesc.innerHTML = `<span style="color:#a44">No hay ni un style pack en data/styles.</span>`;
      continueBtn.disabled = true;
      continueBtn.style.opacity = "0.4";
      return;
    }
    continueBtn.disabled = false;
    continueBtn.style.opacity = "";
    styleSel.value = porDefecto;
    styleDesc.textContent = styleById.get(porDefecto)?.description ?? "";
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
      deps.recordarMundo(game.game_id);
      refreshSelection();
      refreshStyleOptions();
      refreshCover(); // el desplegable acaba de cambiar de preselección
      refreshGenPanel();
    });
  }
  /** La tarjeta del mundo enseña la portada del estilo ELEGIDO, no la del
   *  `style_id` por defecto: sin esto, cambiar de estilo en el desplegable
   *  no cambiaba nada visible y la portada de un pack que no fuera el
   *  defecto de ningún mundo no la veía nunca nadie. */
  const refreshCover = (): void => {
    const card = worldsEl.querySelector<HTMLElement>(
      `[data-cover-for="${CSS.escape(selectedGame.game_id)}"]`,
    );
    const style = styleById.get(styleSel.value);
    if (card) card.outerHTML = coverHtml(selectedGame, style);
    const label = worldsEl.querySelector<HTMLElement>(
      `[data-style-label-for="${CSS.escape(selectedGame.game_id)}"]`,
    );
    if (label) label.textContent = `· Estilo: ${style?.name ?? styleSel.value}`;
  };
  styleSel.addEventListener("change", () => {
    styleDesc.textContent = styleById.get(styleSel.value)?.description ?? "";
    refreshCover();
    refreshGenPanel();
  });

  // ── Panel de generación: mundo por juego + estilo aplicado encima ──
  const genStateEl = deps.content.querySelector("#ts-gen-state") as HTMLElement;
  const genWorldBtn = deps.content.querySelector("#ts-gen-world") as HTMLButtonElement;
  const applyStyleBtn = deps.content.querySelector("#ts-apply-style") as HTMLButtonElement;
  const stylePlanEl = deps.content.querySelector("#ts-style-plan") as HTMLElement;
  const genProgressEl = deps.content.querySelector("#ts-gen-progress") as HTMLElement;
  /** Confirmación en dos clicks para regenerar (patrón armed del dev-menu). */
  let regenArmedUntil = 0;
  const contentStatus = (): "ready" | "stale" | "missing" =>
    selectedGame.generation ?? "missing";
  const appliedStatus = (): "ready" | "stale" | null => {
    const hit = (selectedGame.styles_applied ?? []).find(
      (a) => a.style_id === styleSel.value,
    );
    return hit ? hit.status : null;
  };
  const refreshGenPanel = (): void => {
    const cs = contentStatus();
    const as = appliedStatus();
    const CONTENT_LABEL: Record<string, string> = {
      ready: `<span style="color:#4a4">✓ generado</span>`,
      stale: `<span style="color:#da6">⟳ obsoleto (regenera el mundo)</span>`,
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
      : "Genera primero el mundo de este juego";
    stylePlanEl.innerHTML = "";
    regenArmedUntil = 0;
    // El progreso que se pinta es el de LA TARJETA que se está enseñando, no
    // «el último que llegó» (#313). Cambiar de tarjeta repinta este panel, así
    // que el jugador ve el estado del mundo que está mirando.
    pintarProgresoDeMundo(genProgressEl, deps.progresoDe(selectedGame.game_id));
  };
  const generarElMundo = async (): Promise<void> => {
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
      await deps.narrative.generateGame(selectedGame.game_id);
      genProgressEl.innerHTML = `<span style="color:#da6">⚙ Generando el mundo (el motor narrativo tarda varios minutos)…</span>`;
    } catch (err) {
      genProgressEl.innerHTML = `<span style="color:#a44">${escapeHtml((err as Error).message)}</span>`;
      genWorldBtn.disabled = false;
    }
  };
  genWorldBtn.addEventListener("click", () =>
    paso(generarElMundo(), "title", "encolar la pre-generación del mundo"),
  );
  applyStyleBtn.addEventListener("click", () => {
    paso(
      deps.mostrarPlanDeEstilo(stylePlanEl, selectedGame.game_id, styleSel.value),
      "title",
      "calcular el coste de aplicar el estilo",
    );
  });

  refreshSelection();
  refreshStyleOptions();
  refreshGenPanel();

  (deps.content.querySelector("#ts-back") as HTMLButtonElement)
    .addEventListener("click", () => paso(deps.ir({ a: "home" }), "title", "volver al home del título"));
  continueBtn.addEventListener("click", () => {
    if (!styleSel.value) return;
    // El editor es async (consulta el censo de hojas): el botón se apaga
    // mientras corre, o un doble click pintaría el editor dos veces. Si el
    // editor llega a pintarse, este botón ya no está en el DOM y re-armarlo
    // es inocuo; si el paso falla antes, vuelve a ser pulsable.
    continueBtn.disabled = true;
    paso(
      deps.ir({
        a: "editor",
        game: selectedGame,
        styleId: styleSel.value,
        renderMode: selectedRenderMode,
        characterMode: selectedCharMode,
      }),
      "title",
      "abrir el editor de personaje",
      () => {
        continueBtn.disabled = false;
      },
    );
  });
  (deps.content.querySelector("#ts-create-world") as HTMLButtonElement)
    .addEventListener("click", () =>
      paso(deps.ir({ a: "crear-mundo" }), "title", "abrir «Crear mundo»"),
    );
  (deps.content.querySelector("#ts-upload-style") as HTMLButtonElement)
    .addEventListener("click", () =>
      paso(deps.ir({ a: "subir-estilo" }), "title", "abrir «Subir estilo»"),
    );
}
