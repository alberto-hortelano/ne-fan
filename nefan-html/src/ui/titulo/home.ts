/** El HOME del título: la primera pantalla que ve quien abre el juego.
 *
 *  Pinta el titular, «Nueva partida» y la lista de partidas guardadas que trae
 *  el bridge, con sus tres acciones por fila (reanudar, borrar y los badges que
 *  cambian el modo del save ANTES de cargarlo).
 *
 *  QUÉ NO DECIDE: nada de juego. El modo efectivo de una faceta lo dice core
 *  (`modoEfectivoDePersonajes`), el motivo legible de un fallo de sesión lo dice
 *  core (`motivoDeSesionParaElJugador`) y a dónde se va al terminar lo dice el
 *  enrutador del título por `ir(destino)` — esta hoja no conoce a ninguna otra
 *  (candado `las-hojas-del-titulo-no-se-atan-entre-si`).
 *
 *  Sale de `title-screen.ts` en la PR 4 de #346 (movimiento puro); lo que ha
 *  cambiado desde entonces son los DOS defectos de #427 y la espera de #425,
 *  cada uno anotado donde vive.
 */
import type { SessionMetadata } from "@nefan-core/src/narrative/types.js";
import { CONFIG } from "@nefan-core/src/config.js";
import { motivoDeSesionParaElJugador } from "@nefan-core/src/protocol/status-motivo.js";
import {
  modoEfectivoDePersonajes,
  normalizarModo,
  type Modo,
} from "@nefan-core/src/session/gates-de-imagen.js";
import type { NarrativeClient } from "../../net/narrative-client.js";
import { contarLaEspera, paso } from "../async-ui.js";
import { errors } from "../error-log.js";
import {
  CHAR_MODE_LABELS,
  MODE_COST_LABELS,
  RENDER_MODE_ICONS,
  RENDER_MODE_LABELS,
} from "../mode-labels.js";
import {
  BADGE_CSS,
  BTN_PRIMARY_CSS,
  type DestinoDelTitulo,
  escapeAttr,
  escapeHtml,
  type TitleAction,
} from "./atomos.js";

/** Los dos botones de la fila de una partida guardada. Vivían en `atomos.ts`
 *  hasta el cierre de #346: el censo por importador dio UN dueño —esta
 *  pantalla— en cuanto la PR 4 la sacó, y lo que tiene un dueño viaja con él.
 *  Es el criterio del programa aplicado a sí mismo, para que el módulo común no
 *  se convierta en el cajón que toca cualquier retoque de UI.
 *
 *  `BADGE_CSS` sí se queda allí, y no por inercia: `generationChipsHtml` lo usa
 *  DENTRO de `atomos.ts`, así que traerlo aquí obligaría a aquel fichero a
 *  importar de éste — lo que prohíbe `las-hojas-del-titulo-no-se-atan-entre-si`. */
const BTN_SMALL_PRIMARY_CSS = [
  "background:#3a6","color:#fff","border:none","padding:5px 12px",
  "font-family:inherit","font-size:12px","cursor:pointer","border-radius:3px",
].join(";");
const BTN_SMALL_DANGER_CSS = [
  "background:transparent","color:#a55","border:1px solid #533","padding:5px 12px",
  "font-family:inherit","font-size:12px","cursor:pointer","border-radius:3px",
].join(";");

/** La caja de avisos del título (`ui/titulo/avisos.ts`), vista DESDE EL HOME:
 *  las tres puertas que el home empuja, de las cinco que tiene. Las otras dos
 *  (`avisar`, `retirar`) son API de la clase y el home no las llama nunca.
 *
 *  Es una INTERFAZ y no un import de aquella hoja: el candado
 *  `las-hojas-del-titulo-no-se-atan-entre-si` no deja que dos se toquen, y
 *  `crearAvisos(deps)` encaja aquí por FORMA porque TypeScript es
 *  estructural. */
export interface AvisosDelHome {
  /** Pinta el motivo de la ÚLTIMA acción que falló, con su tono, y repinta. */
  mostrarAccion(motivo: string, tono?: "error" | "aviso"): void;
  /** Descarta ese motivo. NO repinta: el home lo llama justo antes de decidir
   *  si escribe uno nuevo o si solo repinta lo pegajoso, y un repintado de más
   *  aquí sería un cambio de conducta metido de contrabando en un movimiento. */
  limpiarAccion(): void;
  /** Reescribe `#ts-error` entero desde el estado. */
  repintar(): void;
}

/** Los colaboradores del home: seis, todos con nombre. NO es un objeto de
 *  contexto con el estado de la clase — el patrón es el de
 *  `nefan-html/src/world/carga-de-tile.ts:69`. */
export interface DepsDeHome {
  /** La columna del título, que esta pantalla reescribe entera. */
  content: HTMLDivElement;
  /** El bridge: listar partidas, borrar una, cambiar el modo de un save. */
  narrative: NarrativeClient;
  /** Resolver la promesa de `show()` — aquí, siempre con un `resume`. Es
   *  `this.resolve?.(…)` visto desde la hoja: la promesa la arma y la resuelve
   *  la clase, no la pantalla. */
  elegir(accion: TitleAction): void;
  /** La única salida: el enrutador del título. El home solo va al selector. */
  ir(destino: DestinoDelTitulo): Promise<void>;
  /** La caja de avisos (`#ts-error`), que el home rellena pero no posee. */
  avisos: AvisosDelHome;
  /** «↓ hay N partidas más» (#251): lo decide y lo pinta el chasis, que es
   *  quien tiene la banda; el home solo avisa de que la columna acaba de
   *  cambiar de alto. */
  avisarDeCorte(): void;
}

/** Vida del estado "armado" (¿confirmar gasto?) antes de desarmarse solo —
 *  mismo TTL que el chip de gráficos y el menú dev. */
const ARM_TTL_MS = 5000;

export async function pintarHome(
  deps: DepsDeHome,
  aviso?: string,
  tono?: "error" | "aviso",
): Promise<void> {
  modeArmed.clear();
  deps.content.style.maxWidth = "720px";
  // ORDEN A PROPÓSITO: todo lo que puede cambiar DESPUÉS del primer pintado
  // (el estado del bridge, la lista de saves) va POR DEBAJO del botón. Con
  // el orden anterior, `#ts-sessions` se repintaba al volver `listSessions`
  // y empujaba «Nueva partida» hacia abajo tantos píxeles como partidas
  // hubiera: el botón ya escuchaba, pero se movía bajo el cursor.
  // …y `#ts-error` va POR DEBAJO del botón por esa misma regla, que es la
  // que esta tanda se saltó: desde #306 ese hueco se rellena TARDE (un
  // chunk lento, un socket que se cae con el título ya delante) y encima
  // del botón lo movía 33 px bajo el cursor — más que los +24 px que
  // abrieron #250 (QA de T9, H-2).
  deps.content.innerHTML = `
    <h1 style="font-size:32px;color:#da6;margin-bottom:24px">Never Ending Fantasy</h1>
    <p style="margin-bottom:18px;color:#999">Selecciona una partida o empieza una nueva.</p>
    <button id="ts-new" style="${BTN_PRIMARY_CSS}">Nueva partida</button>
    <div id="ts-error" style="margin-top:18px;font-size:13px;display:none"></div>
    <h2 style="margin:24px 0 10px;color:#bbb">Partidas guardadas</h2>
    <div id="ts-status" style="margin-bottom:12px;font-size:12px;color:#666"></div>
    <div id="ts-sessions" style="margin-bottom:24px"></div>
  `;

  const statusEl = deps.content.querySelector("#ts-status") as HTMLElement;
  const sessionsEl = deps.content.querySelector("#ts-sessions") as HTMLElement;
  const newBtn = deps.content.querySelector("#ts-new") as HTMLButtonElement;

  // El motivo de la acción anterior muere con el repintado; los avisos del
  // registro NO —son fallos que siguen puestos— y la caja de avisos los
  // saca del estado. Hasta esta tanda el hueco se quedaba vacío y con él el
  // único sitio donde el jugador podía leer que el cliente estaba roto.
  deps.avisos.limpiarAccion();
  if (aviso) deps.avisos.mostrarAccion(aviso, tono);
  else deps.avisos.repintar();

  // EL ENGANCHE VA AQUÍ, en el mismo bloque síncrono que pinta el botón, y
  // no después del `await` de abajo (#181): entre pintar y enganchar había
  // una ventana —151 ms medidos en el caso feliz, hasta los 30 s del
  // timeout de request si el bridge tarda— en la que el botón existía, se
  // dejaba pulsar y el click NO HACÍA NADA. El selector no lee la lista de
  // saves, así que no hay nada que esperar.
  newBtn.addEventListener("click", () => {
    // El selector awaitea `listGames()` antes de pintar: sin esto, el click
    // no tiene ningún acuse de recibo hasta que vuelve el bridge.
    newBtn.disabled = true;
    newBtn.textContent = "Cargando mundos…";
    paso(deps.ir({ a: "selector" }), "title", "abrir el selector de mundos", (err) => {
      // Y si no vuelve: el botón se devuelve a su sitio y el motivo se lee
      // en pantalla. Antes esto era un `void` sobre la navegación al selector
      // — sin catch, sin registro y sin nada que ver.
      newBtn.disabled = false;
      newBtn.textContent = "Nueva partida";
      // TRADUCIDO: aquí se leían «Bridge not connected», «Bridge request
      // timeout: list_games» y «no games available in bridge — check
      // nefan-core/data/games/». El crudo no se pierde: `paso()` ya lo ha
      // metido en el `detail` de la entrada del error-log.
      deps.avisos.mostrarAccion(
        `No se pudo abrir el selector de mundos. ${motivoDeSesionParaElJugador(err)}`,
      );
    });
  });

  // `data-lista` es el ESTADO de la petición, aparte de la frase que se lee:
  // «pidiendo» → «ok» | «error». Existe porque el banco necesitaba saber que
  // la lista ya llegó y solo tenía la prosa para averiguarlo: `qa/lib/sesion.mjs`
  // casaba dos frases y una de ellas —«No se puede contactar al bridge»— llevaba
  // muerta desde #306, así que esa mitad de la espera no podía cumplirse NUNCA
  // (#550). Un rótulo se reescribe cada vez que alguien mejora una frase; el
  // estado de una petición son tres valores y no cambia con la redacción.
  //
  // Dice qué pasó con la PETICIÓN, no si la lista sigue al día: cuando el
  // socket se cae después, `avisos.caducarEstadoDeSaves` reescribe la frase y
  // este sello se queda en «ok», que es la verdad de lo que se pregunta aquí.
  statusEl.dataset.lista = "pidiendo";
  statusEl.textContent = "Cargando saves desde el bridge...";
  // La espera no se calla (#425): pasados unos segundos el hueco cuenta cuánto
  // lleva, así que la pantalla se ve VIVA. El mecanismo es de `async-ui.ts`, las
  // palabras de aquí, y el sello `data-lista` se queda en «pidiendo».
  const dejarDeContar = contarLaEspera((s) => {
    statusEl.textContent =
      `El servidor de la partida todavía no ha contestado (${s} s). ` +
      `Sigue esperando; mientras tanto, «Nueva partida» funciona.`;
    statusEl.style.color = "#a86";
  });
  // `null` NO es lo mismo que `[]`, y ese era el defecto (#427): el `catch`
  // dejaba el array vacío que ya estaba, así que «no se pudieron cargar» y
  // «— Ninguna partida todavía —» compartían pantalla con TRES partidas en
  // disco, y la segunda era falsa.
  let sessions: SessionMetadata[] | null = null;
  try {
    const lista = await deps.narrative.listSessions();
    dejarDeContar(); // ANTES del desenlace: un latido tardío lo pisaría
    sessions = lista;
    statusEl.dataset.lista = "ok";
    statusEl.textContent = `Bridge OK — ${lista.length} partidas guardadas.`;
    statusEl.style.color = "#4a4";
  } catch (err) {
    dejarDeContar();
    // Hermano de `#ts-error`, y hasta ahora con el mismo defecto: aquí se
    // leía «No se puede contactar al bridge (…). Arranca ./start.sh y elige
    // un preset con bridge» — instrucciones de desarrollo a quien no tiene
    // terminal. El motivo crudo va al error-log, como en todo lo demás.
    errors.push("title", "listar las partidas guardadas", err);
    statusEl.dataset.lista = "error";
    statusEl.innerHTML = `<span style="color:#a44">${escapeHtml(
      `No se pudieron cargar las partidas guardadas. ${motivoDeSesionParaElJugador(err)}`,
    )}</span>`;
  }

  if (sessions === null) {
    // Lo que falta es la LISTA, no las partidas: no se afirma ningún número.
    sessionsEl.innerHTML = `<div style="color:#a87;font-style:italic">— No sabemos qué partidas tienes: la lista no se pudo leer —</div>`;
  } else if (sessions.length === 0) {
    sessionsEl.innerHTML = `<div style="color:#666;font-style:italic">— Ninguna partida todavía —</div>`;
  } else {
    const lista = sessions;
    sessionsEl.innerHTML = lista
      .map((s) => sessionRowHtml(s))
      .join("");
    for (const btn of sessionsEl.querySelectorAll<HTMLButtonElement>("button[data-action=resume]")) {
      btn.addEventListener("click", () => {
        deps.elegir({ kind: "resume", sessionId: btn.dataset.sessionId! });
      });
    }
    for (const btn of sessionsEl.querySelectorAll<HTMLButtonElement>("button[data-action=delete]")) {
      const borrarLaPartida = async (): Promise<void> => {
        const id = btn.dataset.sessionId!;
        if (!confirm(`¿Borrar la partida ${id}?`)) return;
        try {
          // Los tres desenlaces se ven distintos, que es lo que pedía #365.
          // Y se ven distintos también DE UN VISTAZO: «ya no estaba» es un
          // éxito para quien pulsó Borrar, así que va en tono de aviso.
          const resultado = await deps.narrative.deleteSession(id);
          await pintarHome(
            deps,
            resultado === "not_found"
              ? `La partida ${id} ya no estaba en disco: no había nada que borrar.`
              : undefined,
            resultado === "not_found" ? "aviso" : undefined,
          );
        } catch (err) {
          // NO se repinta la lista: la partida NO se borró y su tarjeta tiene
          // que seguir donde estaba. Repintar aquí borraría el motivo y
          // dejaría la pantalla idéntica a la de un borrado que sí ocurrió —
          // el no-op mudo de antes, con un paso más.
          //
          // Y como la tarjeta se queda, se MARCA: el aviso vive ~350 px por
          // encima de ella y el único vínculo era un id opaco de veinte
          // caracteres. La primera frase dice qué hacer; la causa técnica va
          // detrás, que es donde sirve (y el guion 52 la exige).
          marcarTarjetaFallida(btn);
          deps.avisos.mostrarAccion(
            `La partida ${id} SIGUE ahí: el juego no pudo borrarla y no se ha perdido nada. ` +
              `Comprueba los permisos de su carpeta en saves/ y vuelve a intentarlo. ` +
              `Causa: ${(err as Error).message}`,
          );
        }
      };
      btn.addEventListener("click", () =>
        paso(borrarLaPartida(), "title", "borrar la partida guardada"),
      );
    }
    // Los badges de modo son SELECTORES: cambian el modo del save ANTES de
    // cargar (set_render_mode sobre partida inactiva — el bridge escribe el
    // state.json en disco). Así un save con Imagen IA se puede reanudar en
    // maqueta sin que el atlas de superficies gaste créditos al entrar. En
    // partida, el mismo campo lo cambia el chip de gráficos (🎨/🧱).
    for (const btn of sessionsEl.querySelectorAll<HTMLButtonElement>("button[data-mode-facet]")) {
      btn.addEventListener("click", () =>
        paso(onModeBadge(deps, btn, lista), "title", "cambiar el modo del save"),
      );
    }
  }
  // La columna acaba de cambiar de alto: decir si se corta (#251). El
  // ResizeObserver de `deps.content` también lo dispara; esta llamada
  // explícita es la que hace que el aviso esté puesto en el MISMO frame en
  // que aparece la lista, sin un parpadeo entre medias.
  deps.avisarDeCorte();
}

/** Badges de modo armados (primer click de encendido) → timestamp. Se
 *  limpia en cada repintado de home (el re-render invalida los botones).
 *
 *  ERA UN CAMPO DE `TitleScreen` y ahora es una const de módulo: es el ÚNICO
 *  cambio estructural del corte y se declara aquí en vez de esconderlo. Lo que
 *  lo hace equivalente es la línea de arriba —`modeArmed.clear()` abre cada
 *  `pintarHome`—, o sea que su vida efectiva ya era el pintado y no la
 *  instancia; y que `TitleScreen` se construye UNA vez (`main.ts`). Con dos
 *  instancias vivas a la vez sí compartirían armado, y por eso está escrito.
 *  La alternativa —bajarlo a local de `pintarHome` y pasárselo a `onModeBadge`—
 *  es igual de correcta y cambia una firma dentro de un movimiento; se deja
 *  para quien toque esta pantalla por su contenido. */
const modeArmed = new Map<string, number>();

/** Click en un badge de modo de la lista de saves: alterna image⇄vector en
 *  el save (partida inactiva) vía el bridge. Encender = confirmación en dos
 *  clicks (patrón armed del chip); apagar es directo. Tras el cambio se
 *  repinta home re-listando del bridge: el badge refleja lo PERSISTIDO. */
async function onModeBadge(
  deps: DepsDeHome,
  btn: HTMLButtonElement,
  sessions: SessionMetadata[],
): Promise<void> {
  const sessionId = btn.dataset.sessionId!;
  const facet = btn.dataset.modeFacet as "scenes" | "characters";
  const s = sessions.find((x) => x.session_id === sessionId);
  if (!s) return;
  const current = modoDelSave(s, facet);
  const target = current === "image" ? "vector" : "image";
  const key = `${sessionId}:${facet}`;
  if (target === "image" && !modeArmed.has(key)) {
    modeArmed.set(key, performance.now());
    const orig = btn.textContent ?? "";
    // Los colores base se GUARDAN, igual que el rótulo, porque desarmarse es
    // volver a ellos y no quedarse sin ninguno (#549). Venían del atributo
    // `style` del propio botón (`MODE_BADGE_CSS` → `BADGE_CSS`), así que el
    // `btn.style.borderColor = ""` que había aquí no restauraba: BORRABA los
    // longhands, y el badge se quedaba con el `color` heredado de su fila
    // —medido: `rgb(0,0,0)` sobre `#23222c`— hasta el siguiente repintado.
    // Guardarlos en vez de reescribir las literales evita además la copia de
    // `BADGE_CSS` que ningún checker vería.
    const origBorde = btn.style.borderColor;
    const origColor = btn.style.color;
    btn.textContent = "¿Confirmar? Gastará créditos";
    btn.style.borderColor = "#a63";
    btn.style.color = "#da6";
    setTimeout(() => {
      if (!modeArmed.has(key) || !btn.isConnected) return;
      modeArmed.delete(key);
      btn.textContent = orig;
      btn.style.borderColor = origBorde;
      btn.style.color = origColor;
    }, ARM_TTL_MS);
    return;
  }
  modeArmed.delete(key);
  btn.disabled = true;
  try {
    await deps.narrative.setRenderMode(sessionId, facet, target as "image" | "vector");
  } catch (err) {
    // EL MISMO CANAL QUE «BORRAR», Y POR EL MISMO MOTIVO (#427, #365). Era el
    // ÚNICO fallo de acción del home que escribía en `#ts-status` —la línea de
    // ESTADO DEL BRIDGE—, y eso costaba tres cosas: se llevaba por delante
    // «Bridge OK — 3 partidas guardadas», no era pegajoso (cualquier repintado
    // lo borraba) y contradecía la cabecera de `avisos.ts`, que promete UN SOLO
    // escritor de ese hueco. El aviso va DESPUÉS del repintado: `pintarHome`
    // abre con `limpiarAccion()` y borraría el que se escribiera antes.
    errors.push("title", `cambiar el modo de ${facet} de ${sessionId}`, err);
    await pintarHome(deps);
    // La tarjeta se MARCA, igual que en el borrado fallido: el aviso vive a
    // media pantalla de la fila. Se busca el botón NUEVO — el repintado se
    // llevó el que se pulsó.
    const reciente = deps.content.querySelector<HTMLElement>(
      `button[data-mode-facet="${facet}"][data-session-id="${CSS.escape(sessionId)}"]`,
    );
    if (reciente) marcarTarjetaFallida(reciente);
    // Frase accionable primero y causa detrás: lo que el guion 52 le exige a
    // «Borrar» (#469/#479).
    deps.avisos.mostrarAccion(
      `El modo de ${sessionId} SIGUE como estaba: el juego no pudo guardar el cambio y la ` +
        `partida no se ha tocado. Comprueba los permisos de su carpeta en saves/ y vuelve a ` +
        `intentarlo. Causa: ${(err as Error).message}`,
    );
    return;
  }
  await pintarHome(deps);
}

/** Modo de una faceta del save; la regla (personajes sin campo sigue a escenarios) es de core. */
function modoDelSave(s: SessionMetadata, facet: "scenes" | "characters"): Modo {
  const renderMode = normalizarModo(s.render_mode);
  return facet === "scenes" ? renderMode : modoEfectivoDePersonajes({ renderMode, characterMode: normalizarModo(s.character_mode) });
}
/** Badge de modo CLICABLE (selector antes de cargar): misma silueta que el
 *  badge informativo, con cursor y hover del lado de button. */
const MODE_BADGE_CSS = `${BADGE_CSS};cursor:pointer;font-family:inherit`;

/** Badge-selector del modo de una faceta del save. Click = alternar
 *  image⇄vector ANTES de cargar (onModeBadge). Saves legacy sin el campo: sin
 *  badge (no adivinar). */
function modeBadgeHtml(s: SessionMetadata, facet: "scenes" | "characters"): string {
  const mode = modoDelSave(s, facet);
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

/** Resalta la tarjeta de una partida que no se pudo borrar.
 *
 *  El aviso y la tarjeta viven a media pantalla de distancia y su único
 *  vínculo era el id: en una lista de doce saves, saber CUÁL falló obligaba a
 *  comparar veinte caracteres. Se marca el contenedor, no el botón, porque lo
 *  que hay que encontrar es la partida. Desaparece solo: cualquier repintado
 *  del home (el siguiente borrado, volver de una partida) rehace la lista. */
function marcarTarjetaFallida(btn: HTMLElement): void {
  const fila = btn.closest<HTMLElement>(".ts-save");
  if (!fila) return;
  fila.style.borderColor = "#a44";
  fila.style.background = "#241a1a";
}

function sessionRowHtml(s: SessionMetadata): string {
  const summary = s.summary || "(sin narrativa todavía)";
  const updated = s.updated_at ? formatDate(s.updated_at) : "?";
  const badges = [
    modeBadgeHtml(s, "scenes"),
    modeBadgeHtml(s, "characters"),
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="ts-save" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:8px;background:#181820;border:1px solid #2a2a30">
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
