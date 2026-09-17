/** EL PANEL DE GENERACIÓN del selector de mundos: en qué estado está el mundo
 *  de la tarjeta que se mira, en qué estado su estilo encima, y los botones
 *  que encargan lo que falte.
 *
 *  SALE DEL SELECTOR y no se lleva nada suyo: no sabe qué tarjeta está
 *  seleccionada ni qué dice el desplegable de estilo — se lo dan montado
 *  (`mundo`, `estilo`) y se vuelve a montar entero cuando cambian, que es
 *  exactamente lo que hacía el `refreshGenPanel` de antes. Por eso no hay
 *  `refrescar()` ni estado que sobreviva entre montajes: el único que había
 *  —la confirmación armada de «Regenerar mundo»— ya se reseteaba en cada
 *  refresco, así que un montaje nuevo dice lo mismo que decía aquella línea.
 *
 *  ES UNA HOJA (`las-hojas-del-titulo-no-se-atan-entre-si` y
 *  `el-titulo-solo-entra-por-su-enrutador`): la monta la RAÍZ dentro del hueco
 *  que el selector le deja (`#ts-gen`), igual que monta el panel de coste
 *  dentro del suyo (`#ts-style-plan`, `plan-de-estilo.ts`). El selector no la
 *  importa —no podría— y la alcanza por el callback `montarPanelDeGeneracion`
 *  de sus `Deps`.
 *
 *  POR QUÉ SALIÓ, y es una medida y no un gusto: `selector-de-mundo.ts` llegó a
 *  450/450 líneas —el tope exacto de `client-file-size.json`— y la primera
 *  línea del arreglo de #552 lo ponía rojo. De lo que había dentro, éste es el
 *  trozo con frontera propia: habla con el bridge por su cuenta
 *  (`generateGame`), pinta su propio estado y no toca ni la lista de mundos ni
 *  los cuatro modos. Se va con él `pintarProgresoDeMundo`, que era lo único que
 *  el enrutador le importaba al selector sin ser una pantalla.
 *
 *  Los IDs del DOM son los MISMOS que tenía dentro del selector (`#ts-gen-state`,
 *  `#ts-gen-world`, `#ts-apply-style`, `#ts-style-plan`, `#ts-gen-progress`):
 *  los conduce el banco desde hace diez guiones y mudarlos habría sido un
 *  cambio de contrato disfrazado de refactor. `#ts-gen-repair` es el tercer
 *  botón y nace con #577 — el remedio BARATO al lado del caro: «Regenerar»
 *  cuesta nueve llamadas al motor y deja obsoleto el estilo aplicado,
 *  «Completar» cuesta una por escena que falte y no toca el arte.
 */
import type { GameInfo, NarrativeClient, StyleInfo } from "../../net/narrative-client.js";
import type { NarrativeStatusDeJuego } from "@nefan-core/src/protocol/messages.js";
import { paso } from "../async-ui.js";
import { BTN_SECONDARY_CSS, escapeHtml } from "./atomos.js";

export interface DepsDePanelDeGeneracion {
  /** El socket del juego: encola la pre-generación de un mundo
   *  (`generateGame`). Es lo único de esta hoja que habla por la red. */
  narrative: NarrativeClient;
  /** El último progreso conocido de un mundo, o `undefined` si no hay ninguno.
   *  Lo apunta la raíz según se lo cuenta el bridge; aquí solo se pinta. */
  progresoDe(gameId: string): NarrativeStatusDeJuego | undefined;
  /** Abre el panel de coste de «Aplicar estilo» DENTRO del hueco que este panel
   *  le deja (`#ts-style-plan`). Lo cablea la raíz porque el panel de coste es
   *  otra hoja y necesita además el `StyleApplyController`. */
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
 *  del mundo que el jugador está mirando, este panel del suyo. */
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

/** Monta el panel dentro de `hueco` para el par (mundo, estilo) que se está
 *  mirando. Llamarlo otra vez lo reemplaza entero: es el refresco. */
export function montarPanelDeGeneracion(
  deps: DepsDePanelDeGeneracion,
  hueco: HTMLElement,
  mundo: GameInfo,
  estilo: StyleInfo | undefined,
): void {
  hueco.innerHTML = `
    <div style="font-size:12px;color:#999;margin-bottom:6px">Generación <span style="color:#666">(primero el mundo, sin estilo; el estilo se aplica después sobre el mundo generado)</span></div>
    <div id="ts-gen-state" style="font-size:12px;margin-bottom:8px;line-height:1.6"></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px">
      <button id="ts-gen-world" style="${BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px"></button>
      <button id="ts-gen-repair" style="${BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px;display:none"></button>
      <button id="ts-apply-style" style="${BTN_SECONDARY_CSS};font-size:12px;padding:6px 14px"></button>
    </div>
    <div id="ts-style-plan"></div>
    <div id="ts-gen-progress" style="font-size:12px;margin-top:4px"></div>
  `;
  const genStateEl = hueco.querySelector("#ts-gen-state") as HTMLElement;
  const genWorldBtn = hueco.querySelector("#ts-gen-world") as HTMLButtonElement;
  const repairBtn = hueco.querySelector("#ts-gen-repair") as HTMLButtonElement;
  const applyStyleBtn = hueco.querySelector("#ts-apply-style") as HTMLButtonElement;
  const stylePlanEl = hueco.querySelector("#ts-style-plan") as HTMLElement;
  const genProgressEl = hueco.querySelector("#ts-gen-progress") as HTMLElement;
  /** Confirmación en dos clicks para regenerar (patrón armed del dev-menu). */
  let regenArmedUntil = 0;
  const cs: "ready" | "stale" | "missing" = mundo.generation ?? "missing";
  const as =
    (mundo.styles_applied ?? []).find((a) => a.style_id === estilo?.style_id)?.status ?? null;
  // Un mundo «generado» puede tener escenas que la puerta de carga ya no
  // sirve: se le pedirán al motor cuando el jugador llegue a ellas, y NADA
  // en pantalla lo delata (un mundo cribado se ve igual que uno sano, lo
  // midió QA). Así que se CUENTA — no se explica el motivo, que es la
  // opción que el usuario descartó en #451: es un número (H-2).
  const cuenta = mundo.escenas;
  const recorte =
    cuenta && cuenta.servibles < cuenta.total
      ? ` <span style="color:#da6">(${cuenta.servibles} de ${cuenta.total} escenas;` +
        ` el resto se generará al llegar)</span>`
      : "";
  const CONTENT_LABEL: Record<string, string> = {
    ready: `<span style="color:#4a4">✓ generado</span>${recorte}`,
    stale: `<span style="color:#da6">⟳ obsoleto (regenera el mundo)</span>`,
    missing: `<span style="color:#a66">— sin generar</span>`,
  };
  const styleLabel = !estilo
    ? `<span style="color:#666">—</span>`
    : as === "ready"
      ? `<span style="color:#4a4">✓ aplicado</span>`
      : as === "stale"
        ? `<span style="color:#da6">⟳ obsoleto (regenera el mundo/estilo)</span>`
        : `<span style="color:#a66">— sin aplicar</span>`;
  genStateEl.innerHTML =
    `Mundo: ${CONTENT_LABEL[cs]}` +
    ` &nbsp;·&nbsp; Estilo <span style="color:#bdf">${escapeHtml(estilo?.name ?? "(ninguno)")}</span>: ${styleLabel}`;
  genWorldBtn.textContent = cs === "ready" ? "↻ Regenerar mundo" : "⚙ Generar mundo";
  // «Curar» solo existe cuando hay algo que curar, y eso es EXACTAMENTE la
  // condición del recorte de arriba: un mundo servible al que la puerta de
  // carga le descarta escenas. Sin recorte no hay nada que pedirle al motor y
  // el botón no aparece; sin mundo (o con uno obsoleto) tampoco, porque lo que
  // toca entonces es generarlo. Es el remedio BARATO al lado del caro:
  // regenerar cuesta nueve llamadas y deja obsoleto el estilo aplicado; esto
  // cuesta una por escena y no toca el arte.
  const faltan = cs === "ready" && cuenta ? cuenta.total - cuenta.servibles : 0;
  repairBtn.style.display = faltan > 0 ? "" : "none";
  repairBtn.textContent = `✚ Completar el mundo (${faltan} escena${faltan === 1 ? "" : "s"})`;
  repairBtn.title =
    "Le pide al motor SOLO las escenas que faltan y las guarda en el mundo. " +
    "No regenera lo que ya está ni afecta al estilo aplicado.";
  applyStyleBtn.textContent =
    as === "ready" ? "↻ Regenerar estilo (ver coste)" : "🎨 Aplicar estilo (ver coste)";
  const canApply = cs === "ready" && !!estilo;
  applyStyleBtn.disabled = !canApply;
  applyStyleBtn.style.opacity = canApply ? "" : "0.45";
  applyStyleBtn.title = canApply
    ? "Pre-genera los assets estilizados del mundo (coste estimado antes de gastar)"
    : "Genera primero el mundo de este juego";
  // El progreso que se pinta es el de LA TARJETA que se está enseñando, no
  // «el último que llegó» (#313). Cambiar de tarjeta vuelve a montar este
  // panel, así que el jugador ve el estado del mundo que está mirando.
  pintarProgresoDeMundo(genProgressEl, deps.progresoDe(mundo.game_id));

  const generarElMundo = async (): Promise<void> => {
    if (cs === "ready") {
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
      await deps.narrative.generateGame(mundo.game_id);
      genProgressEl.innerHTML = `<span style="color:#da6">⚙ Generando el mundo (el motor narrativo tarda varios minutos)…</span>`;
    } catch (err) {
      genProgressEl.innerHTML = `<span style="color:#a44">${escapeHtml((err as Error).message)}</span>`;
      genWorldBtn.disabled = false;
    }
  };
  genWorldBtn.addEventListener("click", () =>
    paso(generarElMundo(), "title", "encolar la pre-generación del mundo"),
  );

  const curarElMundo = async (): Promise<void> => {
    // SIN confirmación armada, al revés que «Regenerar»: esto no pisa nada ni
    // deja obsoleto el estilo aplicado — solo rellena huecos. Pedir dos clicks
    // para una acción que no destruye nada enseñaría al jugador a hacer doble
    // click en la que sí.
    repairBtn.disabled = true;
    genProgressEl.innerHTML = `<span style="color:#da6">⚙ Encolando la cura del mundo…</span>`;
    try {
      await deps.narrative.repairGameWorld(mundo.game_id);
      genProgressEl.innerHTML = `<span style="color:#da6">⚙ Completando el mundo (una llamada al motor por escena)…</span>`;
    } catch (err) {
      genProgressEl.innerHTML = `<span style="color:#a44">${escapeHtml((err as Error).message)}</span>`;
      repairBtn.disabled = false;
    }
  };
  repairBtn.addEventListener("click", () =>
    paso(curarElMundo(), "title", "encolar la cura del mundo pre-generado"),
  );
  applyStyleBtn.addEventListener("click", () => {
    if (!estilo) return; // el botón está apagado sin estilo; esto es el tipo
    paso(
      deps.mostrarPlanDeEstilo(stylePlanEl, mundo.game_id, estilo.style_id),
      "title",
      "calcular el coste de aplicar el estilo",
    );
  });
}
