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
import type { NarrativeStatusDeJuego } from "@nefan-core/src/protocol/messages.js";
import { CONFIG } from "@nefan-core/src/config.js";
import { motivoDeSesionParaElJugador } from "@nefan-core/src/protocol/status-labels.js";
import {
  SUGGESTED_THEME_TAGS,
  styleCompatibleWithGame,
} from "@nefan-core/src/games/style-refs.js";
import type {
  StyleCompleteResponse,
  StyleUploadResponse,
} from "@nefan-core/src/contracts/remote-gen.js";
import {
  modelosCompletos,
  type SpriteCensusResponse,
} from "@nefan-core/src/contracts/sprite-census.js";
import { serviceUrl } from "../net/service-urls.js";
import { errors } from "./error-log.js";
import { paso } from "./async-ui.js";
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
      appearance: { model_id: string; skin_path: string };
    };

/** asset-store — sirve las covers de los estilos como estáticos, con o sin
 *  ai_server (movido desde el State API en F2; preset 4 arranca el store). */
const ASSET_STORE_URL = serviceUrl("asset-store");
/** remote-gen (proceso propio desde F4) — subida de estilos y generación de las
 *  categorías que falten (Meshy). Sin él, "Subir estilo" falla con error
 *  visible. */
const AI_SERVER_HTTP = serviceUrl("remote-gen");

/** Carpetas del pack a las que puede ir una imagen subida. NO son vistas (el
 *  juego tiene una sola): son el ROL del contenido dentro del pack, y por eso
 *  la carpeta basta para saber qué es cada imagen — no hace falta marcar
 *  aparte cuál es la lámina. */
const UPLOAD_FOLDER_LABELS: Array<{ id: string; label: string }> = [
  { id: "faces", label: "Cara del mundo (fachada, portón, muro…)" },
  { id: "surfaces", label: "Lámina de materiales (rejilla de muestras planas)" },
  { id: "characters", label: "Personaje (model sheet)" },
];

/** Vida del estado "armado" (¿confirmar gasto?) antes de desarmarse solo —
 *  mismo TTL que el chip de gráficos y el menú dev. */
const ARM_TTL_MS = 5000;

/** Cuántos avisos del registro caben a la vez en el hueco del home (#306).
 *  Tres, y no «todos»: la pantalla del título no es el registro de errores
 *  —ese sigue entero en `#error-log`— y una lista larga de líneas rojas se
 *  deja de leer, que es el mismo modo de fallo que tenía guardar UNA sola. */
const MAX_AVISOS = 3;

export class TitleScreen {
  private root: HTMLDivElement;
  private content: HTMLDivElement;
  /** La banda de «hay más partidas» (#251). Campo y no `querySelector`: lo
   *  crea el constructor, así que buscarlo y comprobar que existe era la misma
   *  rama inalcanzable que esta tanda borró en `loadSceneFile`. */
  private readonly aviso = document.createElement("div");
  /** Los avisos que le llegan al título desde el registro de errores (#306):
   *  fallos que saltaron SOLOS, sin que el jugador pulsara nada. Viven aquí y
   *  no en el DOM porque `renderHome` reescribe `content.innerHTML` entero, y
   *  eso era literalmente el bug: el motivo se pintaba y el repintado
   *  siguiente se lo llevaba. La clave es el TÍTULO —dos fallos de la misma
   *  familia son una noticia— y se enseña el detalle del último, que en la
   *  familia de los sprites es el agregado con el remedio. */
  private readonly avisosDelJugador: { titulo: string; detalle: string }[] = [];
  /** El motivo de la ÚLTIMA acción que falló (pulsar «Nueva partida» sin
   *  bridge, borrar una partida que ya no estaba). Efímero por naturaleza:
   *  pertenece a lo que se acaba de intentar, así que el repintado del home lo
   *  descarta — al revés que los de arriba. */
  private avisoDeAccion: { motivo: string; tono: "error" | "aviso" } | null = null;
  private resolve: ((action: TitleAction) => void) | null = null;
  /** Notifica show/hide al caller (main.ts oculta el chip de gráficos
   *  mientras el título está abierto). Cubre TODOS los cierres, incluido el
   *  modo fixtures por #ts-close, que no resuelve la promesa de show(). */
  onVisibilityChange: ((visible: boolean) => void) | null = null;
  private styleApply: StyleApplyController;

  /** Corrida de estilo tal y como la recuerda quien la ejecuta (bench/QA). */
  styleRunState(): ReturnType<StyleApplyController["debugState"]> {
    return this.styleApply.debugState();
  }

  /** Última línea de progreso de pre-generación POR JUEGO.
   *
   *  Era UNA ranura, y ahí estaba el único síntoma de jugador de #313: el panel
   *  de generación vive dentro de `#ts-gen`, que es el del juego SELECCIONADO, y
   *  nada impide cambiar de tarjeta mientras se genera (el botón se deshabilita,
   *  los handlers de tarjeta no). Con el mundo de A generándose y la tarjeta de
   *  B delante, el jugador leía «Generando el anillo de tiles (3/8)…» y luego
   *  «Mundo de Miravanda generado» bajo la tarjeta de Valdesombra — reproducido
   *  en dos clicks. Un mapa por `gameId` no es una optimización: es lo que hace
   *  falta para poder NO pintar lo que no es de esta tarjeta, y el `gameId` que
   *  lo indexa es el que trajo el mensaje desde #313. */
  private readonly gameGenStatus = new Map<string, NarrativeStatusDeJuego>();
  /** Mundo seleccionado la última vez que se pintó el selector — el refresh
   *  tras un game_gen ready lo conserva, y es la clave con la que se decide
   *  QUÉ progreso se pinta. */
  private lastSelectedGameId: string | null = null;

  /** Pinta el progreso DEL JUEGO SELECCIONADO, o nada si el que se está
   *  generando es otro. `gameId` se pasa explícito (y no se lee de
   *  `lastSelectedGameId` aquí dentro) porque el llamante del refresco del panel
   *  conoce la tarjeta que está pintando en ese momento. */
  private renderGameGenProgress(line: HTMLElement, gameId: string | null): void {
    const s = gameId === null ? undefined : this.gameGenStatus.get(gameId);
    if (!s) {
      line.textContent = "";
      line.removeAttribute("data-gen-phase");
      return;
    }
    // La FASE, como dato y no como prosa: `ready` y `error` son estados
    // terminales, y quien espera (el jugador mirando, o un guion de QA) no
    // tiene que adivinarlos leyendo el texto. Antes había que casar un regex
    // contra el mensaje, y bastó añadir un mensaje de error nuevo para que la
    // espera dejara de reconocer el final y se comiera su tope entero.
    line.dataset.genPhase = s.phase;
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
    //
    // El canal ya viene filtrado desde el embudo (#312): aquí había un
    // `if (msg.kind !== "game_gen") return;` que era el segundo sitio del
    // cliente que sabía de kinds. Y no se filtra por SELLO, ni aquí ni allí —
    // desde #313 este mensaje no TIENE sello: se direcciona por `gameId`, que
    // es lo que se usa abajo para no pintar el progreso de un mundo en la
    // tarjeta de otro.
    this.narrative.onProgresoDeMundo((msg) => {
      // Se APUNTA siempre, sea de la tarjeta que sea: el jugador puede volver
      // a ella y tiene que encontrar el estado que dejó.
      this.gameGenStatus.set(msg.gameId, msg);
      const line = this.content.querySelector<HTMLElement>("#ts-gen-progress");
      if (line) this.renderGameGenProgress(line, this.lastSelectedGameId);
      if (msg.phase === "error") {
        // AL REGISTRO TAMBIÉN, y no solo a la línea roja de la tarjeta. Antes
        // de #312 este fallo caía además en el handler de `main.ts`, que hacía
        // `errors.push`; el reparto en canales se lo llevó por delante y la
        // pre-generación pasó a fallar sin dejar rastro en ningún sitio
        // consultable. El texto rojo de `#ts-gen-progress` desaparece en cuanto
        // se repinta el selector — dos líneas más abajo, precisamente.
        errors.push("narrative", msg.message ?? "la pre-generación del mundo falló");
      }
      if (msg.phase === "ready" || msg.phase === "error") {
        // Refrescar chips/botones si el selector de mundo sigue en pantalla.
        const panel = this.content.querySelector("#ts-gen");
        if (panel && this.root.style.display !== "none") {
          paso(
            this.renderWorldSelect(this.lastSelectedGameId ?? undefined),
            "title",
            "refrescar el selector de mundos tras la generación",
          );
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
          /* Solo laterales/inferior: el padding-top lo reserva la expresión
             de base.css, derivada de --dev-status-alto (#250). */
          #title-screen {
            padding-left: 12px !important;
            padding-right: 12px !important;
            padding-bottom: 16px !important;
          }
          #title-screen #ts-columns { grid-template-columns: 1fr !important; gap: 14px !important; }
          #title-screen #ts-worlds { max-height: 38vh !important; }
          #title-screen #ts-rendermode, #title-screen #ts-charmode {
            flex-wrap: wrap !important;
          }
          #title-screen #ts-rendermode button,
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
      // ANCLADO ARRIBA, no centrado (#181-c). Con `center`, el bloque de
      // contenido crece hacia ABAJO cuando llega la lista de saves y su borde
      // superior sube la MITAD de lo que crece: 238 px de lista movían
      // «Nueva partida» 119 px hacia arriba, bajo el cursor de quien ya lo
      // estaba pulsando. Reordenar el home no bastaba —el botón no se movía
      // DENTRO del bloque, se movía el bloque entero—, y reservarle altura a
      // `#ts-sessions` serían números mágicos que dependen de N. Anclado
      // arriba, lo que hay por encima del botón no cambia nunca y el botón se
      // queda clavado en el viewport con 0 o con 200 partidas.
      "justify-content: flex-start",
      "z-index: 9999",
      // El PADDING no se escribe aquí: sale de `base.css`, pegado a la
      // variable `--dev-status-alto` de la que se deriva (#250). Aquí vivía
      // `reserveDevPanelSpace()` —medir el panel, un ResizeObserver y un
      // listener de resize— para calcular un número que hoy es constante.
    ].join(";");
    this.content = document.createElement("div");
    this.content.style.cssText = [
      "max-width: 720px",
      "width: 100%",
      "max-height: 100%",
      "overflow-y: auto",
    ].join(";");
    this.root.appendChild(this.content);
    // La señal de «hay más partidas» (#251). ABSOLUTA y colgando de la raíz:
    // dentro del flujo volvería a mover «Nueva partida» al aparecer, que es
    // el bug que #181-c cerró. Sin tematizar, como el resto del título.
    const mas = this.aviso;
    mas.id = "ts-mas";
    mas.hidden = true;
    // BANDA, no una línea de texto suelta. La primera versión era un texto a
    // `bottom:32px` y la captura del guion 33 lo enseñó encima de los badges
    // de una tarjeta a medio cortar: ilegible, dos mensajes pisándose. La
    // banda trae el fondo del propio overlay con un degradado por arriba, así
    // que la tarjeta cortada se desvanece dentro de ella —que es además la
    // señal de «esto sigue»— y la frase se lee sobre color plano.
    //
    // `pointer-events:none` para que un «Reanudar» que quede debajo se siga
    // pudiendo pulsar; y `bottom:0`, no 32, porque una banda que flota deja
    // una franja de lista asomando por debajo y vuelve a leerse mal.
    mas.style.cssText = [
      "position: absolute",
      "bottom: 0",
      "left: 0",
      "right: 0",
      "padding: 34px 16px 14px",
      "background: linear-gradient(to bottom, rgba(8,8,12,0) 0%, rgba(8,8,12,0.97) 60%)",
      "text-align: center",
      "font-size: 12px",
      "letter-spacing: 0.5px",
      "color: #da6",
      "pointer-events: none",
    ].join(";");
    this.root.appendChild(mas);
    // Re-evaluar cuando la columna cambia de tamaño (llega la lista de saves,
    // cargan las portadas del selector de mundos) y cuando se desplaza.
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => this.actualizarAvisoDeCorte()).observe(this.content);
    }
    this.content.addEventListener("scroll", () => this.actualizarAvisoDeCorte());
    // Cierre SIN sesión (modo fixtures/dev): oculta el título y deja el juego
    // en local — el selector "Room" y las teclas dev (G/B…) quedan a mano.
    // No resuelve la promesa de show(): runTitleFlow queda en espera, igual
    // que ocultar el overlay a mano desde la consola.
    const close = document.createElement("button");
    close.id = "ts-close";
    close.textContent = "✕ cerrar (modo fixtures, sin sesión)";
    close.title = "Cierra el título sin arrancar sesión: fixtures del selector Room";
    // SIN `top` AQUÍ, y es el arreglo de #310: lo pone `base.css`, derivado de
    // `--dev-status-alto` como el hueco que el título le reserva a la barra de
    // dev. Este botón es `position:absolute` contra la caja de PADDING de
    // `#title-screen`, así que el `top:12px` que tenía se medía desde el borde
    // del overlay y caía DENTRO de esa banda: a 500 px de ancho el panel de dev
    // —opaco, `z-index:10000`— lo tapaba al 100 % y el título no se podía
    // cerrar con el ratón. Escribirlo inline volvería a sacarlo del mecanismo,
    // que es de lo que venía el bug; y un inline gana siempre a la hoja.
    close.style.cssText = [
      "position: absolute",
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
    this.vigilarPortadas();
  }

  /** Una portada que no llega degrada al marcador y DEJA RASTRO (#218).
   *
   *  En fase de CAPTURA sobre la raíz del título y enganchado UNA sola vez: el
   *  `error` de un `<img>` no burbujea, pero sí baja en captura, así que este
   *  único listener cubre también las tarjetas que se repintan enteras por
   *  `outerHTML` al cambiar de estilo en el desplegable — sin que quien las
   *  repinte tenga que acordarse de nada.
   *
   *  Quitar el `<img>` descubre el marcador, que `coverHtml` ya dejó debajo.
   *  El registro va por el canal de la capa (`errors.push`, CLAUDE.md
   *  §Errores): sin él, el arreglo cambiaría un fallo feo por uno mudo. */
  private vigilarPortadas(): void {
    this.root.addEventListener(
      "error",
      (ev) => {
        const img = ev.target;
        if (!(img instanceof HTMLImageElement)) return;
        const estilo = img.dataset.coverImg;
        if (!estilo) return;
        const src = img.src;
        // El id ("medievo_crudo") es lo que hay en el disco; el `alt` es lo
        // que se lee en la tarjeta ("Medievo crudo"). El mensaje lleva los
        // DOS: uno sirve para ir al fichero, el otro para saber qué caja de la
        // pantalla es la que se quedó sin imagen.
        errors.push(
          "title",
          `la portada del estilo ${img.alt} (${estilo}) no cargó (${src}) — la tarjeta lo dice en su marcador`,
        );
        // La caja pasa al estado «avería», que NO es el del pack sin portada
        // (ver `marcadorHtml`): en pantalla eran idénticos y solo los separaba
        // esta entrada del registro, que en el título no se lee.
        const caja = img.closest<HTMLElement>("[data-cover-for]");
        const marca = caja?.querySelector("[data-cover-marker]");
        if (caja && marca) {
          caja.dataset.coverFailed = estilo;
          marca.outerHTML = marcadorHtml(img.alt, true);
        }
        img.remove();
      },
      true,
    );
  }

  /** «Hay más partidas abajo», cuando la columna no cabe (#251).
   *
   *  El scroller NO es la lista: `#ts-sessions` solo lleva margen, y quien
   *  recorta es `this.content` (`max-height:100%; overflow-y:auto`), que se
   *  lleva la columna ENTERA. Una señal sobre la lista iría al elemento
   *  equivocado.
   *
   *  Lo que AVISA es el texto, y lo que se mide es el texto: un degradado a
   *  secas solo se nota cuando una tarjeta queda partida, y con el corte justo
   *  entre dos la columna parece completa. El degradado de la banda no es la
   *  señal, es lo que hace la señal LEGIBLE — sin él la frase caía encima de
   *  los badges de la tarjeta cortada y se leían las dos a la vez.
   *
   *  Cuelga de `this.root` con `position:absolute`, NO de `this.content`:
   *  cualquier cosa que aparezca dentro del flujo puede volver a mover
   *  «Nueva partida», que es #181-c. */
  private actualizarAvisoDeCorte(): void {
    // Solo en el HOME. En el selector de mundos, el editor de personaje o la
    // subida de estilo no hay partidas que contar, y la banda aparecía ahí
    // diciendo «hay más abajo» sobre una pantalla que no tiene ninguna: un
    // aviso cierto sobre el desbordamiento y falso sobre su sujeto.
    //
    // Se DERIVA de lo pintado (`#ts-sessions` solo existe en el home) y no de
    // un flag que los cinco `render*` tengan que acordarse de poner: el que
    // se olvidara dejaría la banda mintiendo en su pantalla.
    if (!this.content.querySelector("#ts-sessions")) {
      this.aviso.hidden = true;
      return;
    }
    // +1 px de tolerancia: el redondeo subpíxel del layout hace que una
    // columna que cabe justa se declare desbordada.
    // Guarda BARATA antes de leer geometría: si la columna no desborda, no
    // puede haber nada fuera. +1 px por el redondeo subpíxel del layout.
    if (this.content.scrollHeight <= this.content.clientHeight + 1) {
      this.aviso.hidden = true;
      return;
    }
    // LA CONDICIÓN ES QUE HAYA TARJETAS FUERA, no que la columna desborde. No
    // es lo mismo, y la diferencia se vio en pantalla: a 1280×800 con cinco
    // partidas la columna desborda por los 24 px de `margin-bottom` de la
    // lista, con las CINCO tarjetas a la vista, y el aviso decía «hay 0
    // partidas más» — avisar a quien no tiene nada que saber, con un número
    // que es literalmente cero. Es el mismo error que el ternario que se fue
    // en la limpieza («desborda» no implica «falta algo por ver»), así que
    // ahora el conteo DECIDE en vez de adornar.
    //
    // El `getBoundingClientRect` va después de esa guarda: leerlo en cada
    // scroll de una columna que cabe era un reflow para nada.
    const caja = this.content.getBoundingClientRect();
    const fuera = [...this.content.querySelectorAll<HTMLElement>(".ts-save")].filter(
      (fila) => fila.getBoundingClientRect().bottom > caja.bottom + 1,
    ).length;
    if (fuera === 0) {
      this.aviso.hidden = true;
      return;
    }
    // Cuántas quedan fuera es el dato que el jugador necesita («¿me falta una
    // o me faltan diez?») y el que el contador de arriba no da: ese dice
    // cuántas HAY, no cuántas se están escondiendo. Al llegar abajo del todo
    // el conteo cae a 0 solo, así que el aviso se retira sin una segunda
    // condición que mantener.
    this.aviso.textContent = `↓ hay ${fuera} partida${fuera === 1 ? "" : "s"} más — desplaza la lista`;
    this.aviso.hidden = false;
  }

  /** Abre el título y resuelve con lo que el jugador elija.
   *
   *  `aviso` es el motivo por el que se VUELVE aquí (una sesión que no pudo
   *  arrancar): se pinta arriba, encima del botón, y desaparece al siguiente
   *  repintado del home.
   *
   *  La promesa se arma ANTES de pintar. Antes se armaba después del
   *  `await renderHome()` —o sea, después del `await listSessions()`— y
   *  durante esa ventana `this.resolve` seguía en `null`: el «Comenzar» del
   *  final del selector llamaba a `this.resolve?.(…)` y el optional chaining
   *  lo convertía en un no-op mudo. Con el enganche del botón movido al
   *  primer pintado, esa ventana pasaría a ser alcanzable de verdad. */
  async show(opts: { aviso?: string } = {}): Promise<TitleAction> {
    this.root.style.display = "flex";
    this.onVisibilityChange?.(true);
    this.actualizarAvisoDeCorte();
    const eleccion = new Promise<TitleAction>((res) => {
      this.resolve = res;
    });
    // Si el home no se puede pintar, show() RECHAZA (lo espera el catch de
    // main.ts): la promesa de arriba se queda pendiente y no la lee nadie.
    await this.renderHome(opts.aviso);
    return eleccion;
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

  /** Pinta un motivo en el hueco de error del home, si el home está en
   *  pantalla. Es lo que lee el jugador cuando algo del propio título falla
   *  (el bridge no contesta, la sesión no arranca): sin esto el fallo solo
   *  existía en la consola.
   *
   *  `tono` porque no todo lo que se dice aquí es un error. «Tu partida ya no
   *  estaba, no había nada que borrar» es, para quien pulsó Borrar, un ÉXITO —
   *  y se pintaba con el mismo rojo que «no se pudo borrar». El texto los
   *  distinguía y el color los volvía a juntar: quien ojea la pantalla ve el
   *  bloque rojo, no la frase. */
  private mostrarErrorEnHome(motivo: string, tono: "error" | "aviso" = "error"): void {
    this.avisoDeAccion = { motivo, tono };
    this.pintarAvisos();
  }

  /** Un aviso del registro de errores (#306): algo se rompió SOLO y el jugador
   *  tiene que enterarse por el título, no por un panel que el interruptor de
   *  #246 mantiene apagado. Lo llama el ÚNICO suscriptor de `errors.onAviso`
   *  (main.ts), y es idempotente por título: el mismo fallo refresca su detalle
   *  en su sitio en vez de apilar una copia. */
  avisar(titulo: string, detalle: string): void {
    const ya = this.avisosDelJugador.find((a) => a.titulo === titulo);
    if (ya) {
      ya.detalle = detalle;
    } else {
      this.avisosDelJugador.push({ titulo, detalle });
      // El más viejo cae: los tres últimos son los que siguen siendo noticia.
      if (this.avisosDelJugador.length > MAX_AVISOS) {
        this.avisosDelJugador.splice(0, this.avisosDelJugador.length - MAX_AVISOS);
      }
    }
    this.pintarAvisos();
  }

  /** Reescribe `#ts-error` ENTERO desde el estado: los avisos del registro más,
   *  si lo hay, el motivo de la última acción fallida. Un solo sitio escribe
   *  ese hueco, así que no hay dos redacciones que puedan divergir. No hace
   *  nada si el home no está pintado (el hueco solo existe ahí): el aviso se
   *  queda en `avisosDelJugador` y el siguiente `renderHome` lo saca. */
  private pintarAvisos(): void {
    const el = this.content.querySelector<HTMLElement>("#ts-error");
    if (!el) return;
    // `data-aviso` es el titular, y está para que el candado pueda afirmar
    // CUÁL se lee y cuántos hay — no un `includes` sobre el texto entero.
    const pegajosos = this.avisosDelJugador
      .map(
        (a) =>
          `<div data-aviso="${escapeHtml(a.titulo)}" style="color:#a44;margin-bottom:4px">` +
          `${escapeHtml(a.titulo)}: ${escapeHtml(a.detalle)}</div>`,
      )
      .join("");
    const accion = this.avisoDeAccion
      ? `<span style="color:${this.avisoDeAccion.tono === "error" ? "#a44" : "#8a8"}">` +
        `${escapeHtml(this.avisoDeAccion.motivo)}</span>`
      : "";
    el.innerHTML = pegajosos + accion;
    el.style.display = pegajosos || accion ? "" : "none";
  }

  private async renderHome(aviso?: string, tono?: "error" | "aviso"): Promise<void> {
    this.modeArmed.clear();
    this.content.style.maxWidth = "720px";
    // ORDEN A PROPÓSITO: todo lo que puede cambiar DESPUÉS del primer pintado
    // (el estado del bridge, la lista de saves) va POR DEBAJO del botón. Con
    // el orden anterior, `#ts-sessions` se repintaba al volver `listSessions`
    // y empujaba «Nueva partida» hacia abajo tantos píxeles como partidas
    // hubiera: el botón ya escuchaba, pero se movía bajo el cursor.
    this.content.innerHTML = `
      <h1 style="font-size:32px;color:#da6;margin-bottom:24px">Never Ending Fantasy</h1>
      <p style="margin-bottom:18px;color:#999">Selecciona una partida o empieza una nueva.</p>
      <div id="ts-error" style="margin-bottom:18px;font-size:13px;display:none"></div>
      <button id="ts-new" style="${BTN_PRIMARY_CSS}">Nueva partida</button>
      <h2 style="margin:24px 0 10px;color:#bbb">Partidas guardadas</h2>
      <div id="ts-status" style="margin-bottom:12px;font-size:12px;color:#666"></div>
      <div id="ts-sessions" style="margin-bottom:24px"></div>
    `;

    const statusEl = this.content.querySelector("#ts-status") as HTMLElement;
    const sessionsEl = this.content.querySelector("#ts-sessions") as HTMLElement;
    const newBtn = this.content.querySelector("#ts-new") as HTMLButtonElement;

    // El motivo de la acción anterior muere con el repintado; los avisos del
    // registro NO —son fallos que siguen puestos— y `pintarAvisos` los saca
    // del estado. Hasta esta tanda el hueco se quedaba vacío y con él el
    // único sitio donde el jugador podía leer que el cliente estaba roto.
    this.avisoDeAccion = null;
    if (aviso) this.mostrarErrorEnHome(aviso, tono);
    else this.pintarAvisos();

    // EL ENGANCHE VA AQUÍ, en el mismo bloque síncrono que pinta el botón, y
    // no después del `await` de abajo (#181): entre pintar y enganchar había
    // una ventana —151 ms medidos en el caso feliz, hasta los 30 s del
    // timeout de request si el bridge tarda— en la que el botón existía, se
    // dejaba pulsar y el click NO HACÍA NADA. `renderWorldSelect` no lee la
    // lista de saves, así que no hay nada que esperar.
    newBtn.addEventListener("click", () => {
      // El selector awaitea `listGames()` antes de pintar: sin esto, el click
      // no tiene ningún acuse de recibo hasta que vuelve el bridge.
      newBtn.disabled = true;
      newBtn.textContent = "Cargando mundos…";
      paso(this.renderWorldSelect(), "title", "abrir el selector de mundos", (err) => {
        // Y si no vuelve: el botón se devuelve a su sitio y el motivo se lee
        // en pantalla. Antes esto era `void this.renderWorldSelect()` — sin
        // catch, sin registro y sin nada que ver.
        newBtn.disabled = false;
        newBtn.textContent = "Nueva partida";
        // TRADUCIDO: aquí se leían «Bridge not connected», «Bridge request
        // timeout: list_games» y «no games available in bridge — check
        // nefan-core/data/games/». El crudo no se pierde: `paso()` ya lo ha
        // metido en el `detail` de la entrada del error-log.
        this.mostrarErrorEnHome(
          `No se pudo abrir el selector de mundos. ${motivoDeSesionParaElJugador(err)}`,
        );
      });
    });

    statusEl.textContent = "Cargando saves desde el bridge...";
    let sessions: SessionMetadata[] = [];
    try {
      sessions = await this.narrative.listSessions();
      statusEl.textContent = `Bridge OK — ${sessions.length} partidas guardadas.`;
      statusEl.style.color = "#4a4";
    } catch (err) {
      // Hermano de `#ts-error`, y hasta ahora con el mismo defecto: aquí se
      // leía «No se puede contactar al bridge (…). Arranca ./start.sh y elige
      // un preset con bridge» — instrucciones de desarrollo a quien no tiene
      // terminal. El motivo crudo va al error-log, como en todo lo demás.
      errors.push("title", "listar las partidas guardadas", err);
      statusEl.innerHTML = `<span style="color:#a44">${escapeHtml(
        `No se pudieron cargar las partidas guardadas. ${motivoDeSesionParaElJugador(err)}`,
      )}</span>`;
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
        const borrarLaPartida = async (): Promise<void> => {
          const id = btn.dataset.sessionId!;
          if (!confirm(`¿Borrar la partida ${id}?`)) return;
          try {
            // Los tres desenlaces se ven distintos, que es lo que pedía #365.
            // Y se ven distintos también DE UN VISTAZO: «ya no estaba» es un
            // éxito para quien pulsó Borrar, así que va en tono de aviso.
            const resultado = await this.narrative.deleteSession(id);
            await this.renderHome(
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
            this.mostrarErrorEnHome(
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
          paso(this.onModeBadge(btn, sessions), "title", "cambiar el modo del save"),
        );
      }
    }
    // La columna acaba de cambiar de alto: decir si se corta (#251). El
    // ResizeObserver de `this.content` también lo dispara; esta llamada
    // explícita es la que hace que el aviso esté puesto en el MISMO frame en
    // que aparece la lista, sin un parpadeo entre medias.
    this.actualizarAvisoDeCorte();
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
      // Estilos temáticamente compatibles con el mundo (intersección de
      // tags — un pack medieval no se ofrece para un juego futurista).
      const compatible = styles.filter((st) =>
        styleCompatibleWithGame(st.tags, selectedGame.tags),
      );
      styleSel.innerHTML = compatible
        .map((st) => {
          const def = st.style_id === selectedGame.style_id ? " (del mundo)" : "";
          return `<option value="${escapeAttr(st.style_id)}">${escapeHtml(st.name)}${def}</option>`;
        })
        .join("");
      if (compatible.length === 0) {
        styleSel.innerHTML = `<option value="" disabled selected>— ningún estilo compatible con este mundo —</option>`;
        styleDesc.innerHTML = `<span style="color:#a44">Ningún estilo compatible con los tags del mundo todavía.</span>`;
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
    const genStateEl = this.content.querySelector("#ts-gen-state") as HTMLElement;
    const genWorldBtn = this.content.querySelector("#ts-gen-world") as HTMLButtonElement;
    const applyStyleBtn = this.content.querySelector("#ts-apply-style") as HTMLButtonElement;
    const stylePlanEl = this.content.querySelector("#ts-style-plan") as HTMLElement;
    const genProgressEl = this.content.querySelector("#ts-gen-progress") as HTMLElement;
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
        : "Genera primero el mundo de este juego";
      stylePlanEl.innerHTML = "";
      regenArmedUntil = 0;
      // El progreso que se pinta es el de LA TARJETA que se está enseñando, no
      // «el último que llegó» (#313). Cambiar de tarjeta repinta este panel, así
      // que el jugador ve el estado del mundo que está mirando.
      this.renderGameGenProgress(genProgressEl, selectedGame.game_id);
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
        await this.narrative.generateGame(selectedGame.game_id);
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
        this.renderStylePlan(stylePlanEl, selectedGame.game_id, styleSel.value),
        "title",
        "calcular el coste de aplicar el estilo",
      );
    });

    refreshSelection();
    refreshStyleOptions();
    refreshGenPanel();

    (this.content.querySelector("#ts-back") as HTMLButtonElement)
      .addEventListener("click", () => paso(this.renderHome(), "title", "volver al home del título"));
    continueBtn.addEventListener("click", () => {
      if (!styleSel.value) return;
      // El editor es async (consulta el censo de hojas): el botón se apaga
      // mientras corre, o un doble click pintaría el editor dos veces. Si el
      // editor llega a pintarse, este botón ya no está en el DOM y re-armarlo
      // es inocuo; si el paso falla antes, vuelve a ser pulsable.
      continueBtn.disabled = true;
      paso(
        this.renderCharacterEditor(selectedGame, styleSel.value, selectedRenderMode, selectedCharMode),
        "title",
        "abrir el editor de personaje",
        () => {
          continueBtn.disabled = false;
        },
      );
    });
    (this.content.querySelector("#ts-create-world") as HTMLButtonElement)
      .addEventListener("click", () => this.renderCreateWorld());
    (this.content.querySelector("#ts-upload-style") as HTMLButtonElement)
      .addEventListener("click", () => this.renderUploadStyle());
  }

  /** Panel de aplicación de estilo: plan con coste (SIN gastar) → checkboxes
   *  por bloque → confirmación con el importe → batch con progreso. Patrón
   *  upload→coste→complete de los estilos de usuario. */
  private async renderStylePlan(
    el: HTMLElement,
    gameId: string,
    styleId: string,
  ): Promise<void> {
    el.innerHTML = `<div style="font-size:12px;color:#da6;margin-top:6px">Calculando el coste (sin gastar)…</div>`;
    let plan: StyleApplyPlan;
    try {
      plan = await this.styleApply.plan(gameId, styleId);
    } catch (err) {
      el.innerHTML = `<div style="font-size:12px;color:#a44;margin-top:6px">${escapeHtml((err as Error).message)}</div>`;
      return;
    }
    const blocksHtml = plan.blocks
      .map(
        (b, i) => `
          <label style="display:block;font-size:12px;color:#bbb;margin-bottom:3px">
            <input type="checkbox" data-block-idx="${i}" ${b.selected ? "checked" : ""} ${b.missing === 0 ? "disabled" : ""}>
            ${escapeHtml(b.label)} — ${b.missing === 0 ? "en caché ($0)" : b.estCostUsd === null ? "coste no disponible" : `${b.exact ? "" : "~"}$${b.estCostUsd.toFixed(2)}`}
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
      const activos = plan.blocks.filter((b) => b.selected && b.missing > 0);
      const total = activos.reduce((acc, b) => acc + (b.estCostUsd ?? 0), 0);
      // Un bloque sin precio (el catálogo no pudo costearlo) no desaparece del
      // total en silencio: el total lleva un «+ ?» y la causa está en las notas.
      const sinPrecio = activos.some((b) => b.estCostUsd === null);
      const anything = activos.length > 0;
      const cifra = `~$${total.toFixed(2)}${sinPrecio ? " + ?" : ""}`;
      totalEl.textContent = anything
        ? `Coste estimado: ${cifra}${sinPrecio ? " — hay bloques con coste no disponible" : ""} (los skins y páginas ya en caché no se repagan)`
        : "Nada seleccionado que genere coste.";
      runBtn.textContent = anything ? `Aplicar estilo (${cifra})` : "Registrar (sin coste)";
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
    const aplicarElEstilo = async (): Promise<void> => {
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
    };
    runBtn.addEventListener("click", () =>
      paso(aplicarElEstilo(), "title", "aplicar el estilo al mundo pre-generado"),
    );
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
        <select data-folder style="${SELECT_CSS};width:auto">
          ${UPLOAD_FOLDER_LABELS.map((f) => `<option value="${f.id}">${f.label}</option>`).join("")}
        </select>
      </div>`;
    this.content.innerHTML = `
      <h1 style="font-size:28px;color:#da6;margin-bottom:6px">Subir estilo</h1>
      <p style="margin-bottom:16px;color:#888;font-size:12px">
        Sube una o más imágenes de referencia LIBRES — cada una con una descripción de lo que muestra
        (el motor narrativo la usa para elegir la referencia de cada NPC y de cada cara) y a qué sirve.
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
    backBtn.addEventListener("click", () =>
      paso(this.renderWorldSelect(), "title", "volver al selector de mundos"),
    );

    // EL ÚNICO DE LOS SEIS QUE MORDÍA (#260): el `await` del `FileReader` iba
    // fuera del `try` (ver abajo). Arreglado en su sitio, este handler queda
    // como los otros cinco — cuerpo entero en `try/catch`, sin canal especial.
    const subirElEstilo = async (): Promise<void> => {
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
      // EL `try` EMPIEZA AQUÍ Y NO TRES PASOS MÁS ABAJO, y ese era el bug de
      // #260: el `await` de este `FileReader` quedaba FUERA, así que un
      // fichero ilegible rechazaba sin catch — el handler era `async`, el
      // cliente no tiene `unhandledrejection`, y pulsar «Subir» no hacía nada
      // (#181 otra vez). Dentro del `try`, el mismo `catch` que ya traduce los
      // fallos de red escribe también este, sin canal aparte que mantener.
      try {
        const rows = [...rowsEl.querySelectorAll<HTMLElement>("[data-upload-row]")];
        const images: Array<{ folder: string; description: string; image_b64: string }> = [];
        for (const row of rows) {
          const file = (row.querySelector("[data-file]") as HTMLInputElement).files?.[0];
          if (!file) continue;
          const description = (row.querySelector("[data-desc]") as HTMLInputElement).value.trim();
          const folder = (row.querySelector("[data-folder]") as HTMLSelectElement).value;
          // La lámina es la única que puede ir sin descripción: lo que muestra
          // no lo elige el motor, lo dicta su rol (muestras planas de material).
          if (!description && folder !== "surfaces") {
            statusEl.innerHTML = `<span style="color:#a44">Cada imagen necesita su descripción (${escapeHtml(file.name)}).</span>`;
            return;
          }
          const b64 = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result ?? ""));
            r.onerror = () => rej(new Error(`no se pudo leer ${file.name}`));
            r.readAsDataURL(file);
          });
          images.push({ folder, description, image_b64: b64 });
        }
        if (images.length === 0) {
          statusEl.innerHTML = `<span style="color:#a44">Sube al menos una imagen.</span>`;
          return;
        }
        uploadBtn.disabled = true;
        statusEl.textContent = "Subiendo imágenes al ai_server...";
        const res = await fetch(`${AI_SERVER_HTTP}/styles/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, tags, images }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const data = (await res.json()) as StyleUploadResponse;
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
    };
    uploadBtn.addEventListener("click", () =>
      paso(subirElEstilo(), "title", "subir el estilo"),
    );

    const generarLasRefsQueFaltan = async (): Promise<void> => {
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
        const data = (await res.json()) as StyleCompleteResponse;
        statusEl.innerHTML = `<span style="color:#4a4">Generadas ${data.generated.length} imágenes ($${data.cost_usd.toFixed(2)}).</span>`;
        await this.renderWorldSelect();
      } catch (err) {
        statusEl.innerHTML = `<span style="color:#a44">Generación fallida: ${escapeHtml((err as Error).message)}</span>`;
        completeBtn.disabled = false;
        backBtn.disabled = false;
      }
    };
    completeBtn.addEventListener("click", () =>
      paso(generarLasRefsQueFaltan(), "title", "generar las refs que faltan del estilo"),
    );
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

    backBtn.addEventListener("click", () =>
      paso(this.renderWorldSelect(), "title", "volver al selector de mundos"),
    );
    const crearElMundo = async (): Promise<void> => {
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
        // Encadenar la pre-generación del mundo del juego recién creado:
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
    };
    createBtn.addEventListener("click", () =>
      paso(crearElMundo(), "title", "crear el mundo a partir del borrador"),
    );
  }

  private async renderCharacterEditor(
    game: GameInfo,
    styleId: string,
    renderMode: "image" | "vector",
    characterMode: "image" | "vector",
  ): Promise<void> {
    const spritesOn = CONFIG.graphics.character_sprites;
    const skinOn = CONFIG.graphics.ai_skin;

    // El desplegable NO es una lista que alguien recuerda actualizar (#216:
    // prometía 7 modelos de los que 6 no tenían hojas): se deriva del censo
    // vivo del dev server (`/sprites/index.json`) filtrado por
    // `modelosCompletos` — ofrecer un modelo es consecuencia de tener su set
    // completo cargable. Los tres estados hablan; ninguno calla.
    let modelBlock: string;
    if (!spritesOn) {
      modelBlock = `<div style="margin-bottom:14px;color:#666;font-size:11px;font-style:italic">
           Modelo Mixamo deshabilitado (activa <code>graphics.character_sprites</code> en config.ts para usarlo).
         </div>`;
    } else {
      let modelos: string[] = [];
      let fallo = "";
      try {
        const res = await fetch("/sprites/index.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const censo = (await res.json()) as SpriteCensusResponse;
        // Guard de forma (QA H3): un JSON válido que no es un censo caía en
        // el catch con la jerga del TypeError («Cannot read properties of
        // undefined…») pintada en la nota. El motivo que ve el jugador tiene
        // que estar en su idioma; el objeto crudo va al error-log de abajo.
        if (!Array.isArray(censo?.models) || !Array.isArray(censo?.required?.anims)) {
          throw new Error("la respuesta no es un censo de modelos");
        }
        modelos = modelosCompletos(censo);
      } catch (err) {
        // Criterio 6 de #216: la derivación falla CON canal. El error-log
        // está oculto por CSS mientras el título está delante (#246/#306),
        // así que además de registrarlo se dice en la pantalla donde ocurre.
        fallo = err instanceof Error ? err.message : String(err);
        errors.push(
          "title",
          `no se pudo leer el censo de modelos de personaje (${fallo}) — se usará la base y_bot`,
          err,
        );
      }
      const NOTA_CSS = "margin-bottom:14px;color:#a86;font-size:11px";
      if (fallo) {
        modelBlock = `<div id="ts-model-nota" data-motivo="fallo" style="${NOTA_CSS}">
             No se pudo leer el censo de modelos (${escapeHtml(fallo)}) — se usará la base y_bot.
           </div>`;
      } else if (modelos.length === 0) {
        // El clon limpio. Se puede Comenzar igual: el arranque fail-louda con
        // FALLO_HOJAS_BASE y su remedio (camino medido por el guion 27).
        modelBlock = `<div id="ts-model-nota" data-motivo="vacio" style="${NOTA_CSS}">
             Ningún modelo con hojas completas en disco — genéralas con sprite-forge
             (receta en <code>docs/assets-de-personaje.md</code>).
           </div>`;
      } else {
        // En modo personajes "image" el desplegable SE QUEDA (criterio 5):
        // el skin IA se genera siempre sobre y_bot, pero el modelo elegido es
        // la base de RESPALDO que se ve mientras el skin no llega o si falla
        // (modelFor, character-sprites.ts) — una elección viva, y se anota.
        const notaImage =
          characterMode === "image"
            ? `<div id="ts-model-nota" data-motivo="image" style="margin-top:4px;color:#887;font-size:11px">
                 El skin IA se genera sobre y_bot; este modelo es el que ves mientras el skin no llega o si falla.
               </div>`
            : "";
        modelBlock = `<label style="display:block;margin-bottom:14px">
           <div style="font-size:12px;color:#999;margin-bottom:4px">Modelo base (con hojas completas en disco)</div>
           <select id="ts-model" style="${SELECT_CSS}">
             ${modelos.map((id) => `<option value="${escapeAttr(id)}">${escapeHtml(nombreDeModelo(id))}</option>`).join("")}
           </select>
           ${notaImage}
         </label>`;
      }
    }

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

    back.addEventListener("click", () =>
      paso(this.renderWorldSelect(), "title", "volver al selector de mundos"),
    );
    start.addEventListener("click", () => {
      this.resolve?.({
        kind: "new_game",
        gameId: game.game_id,
        styleId,
        renderMode,
        characterMode,
        appearance: {
          model_id: modelSel ? modelSel.value : "",
          skin_path: skinInput ? skinInput.value.trim() : "",
        },
      });
    });
  }
}

/** Chips de estado de generación de la tarjeta: si el mundo está generado y
 *  qué estilos aplicados — "los generados" visibles de un vistazo. */
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
  const chips = [
    chip("Mundo", g.generation ?? "missing"),
    ...(g.styles_applied ?? []).map((a) => chip(`🎨 ${a.style_id}`, a.status)),
  ];
  return `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${chips.join(" ")}</div>`;
}

/** Caja de la portada. 3:2 — la MISMA proporción a la que se capturan
 *  (`qa/capturar-portadas.mjs`, viewport 1536×1024), así que `object-fit:
 *  cover` no recorta nada. A 96×64 una captura de juego era un sello de
 *  correos: la portada existe para enseñar qué se va a ver, y a ese tamaño
 *  no enseñaba nada. */
const COVER_W = 192;
const COVER_H = 128;
const COVER_BOX = `width:${COVER_W}px;height:${COVER_H}px;flex:none;border:1px solid #333`;

/** La portada NO elige entre imagen y marcador (#218): el marcador —el nombre
 *  del ESTILO— está SIEMPRE debajo y la imagen se pinta encima cuando hay
 *  `cover_url`. Antes eran dos ramas excluyentes, así que una portada
 *  declarada que no llegaba (el asset-store caído, un pack a medias, el fake
 *  del bench sin esa ruta) dejaba el icono de imagen rota del navegador: lo
 *  primero que ve quien abre el juego, y sin rastro en ningún sitio. Con el
 *  marcador debajo, quitar el `<img>` basta para degradar a algo legible —lo
 *  hace `vigilarPortadas`, que además deja la entrada en el error-log. */
const COVER_MARK_CSS =
  "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:11px;text-align:center;padding:4px";

/** El marcador que hay debajo de toda portada, en sus DOS estados, y juntos a
 *  propósito: son lo mismo visto por quien mira la tarjeta, y hasta ahora se
 *  veían IGUAL.
 *
 *  - `hueco`: el pack no declara portada (`cover_url` ausente — `loader.ts`
 *    solo la pone si el fichero existe). Nada ha fallado: es un mundo sin arte
 *    de portada todavía, y se pinta apagado y en silencio.
 *  - `fallo`: la portada estaba declarada y NO llegó (asset-store caído, pack
 *    a medias, ruta que el bench no sirve). Eso es una avería y se dice, con
 *    el mismo texto que el registro de errores guarda entero.
 *
 *  Sin la diferencia, un asset-store caído y un pack sin arte eran el mismo
 *  cuadro gris y lo único que los separaba era una entrada del error-log que
 *  el título esconde (#218; hallazgo C2/H2 de QA). */
function marcadorHtml(nombre: string, fallo: boolean): string {
  const fondo = fallo
    ? "background:linear-gradient(135deg,#2c211d,#1a1512);border:1px solid #6b4636"
    : "background:linear-gradient(135deg,#23202b,#161419)";
  const aviso = fallo
    ? `<div data-cover-aviso style="color:#c9825e;font-size:10px;letter-spacing:0.3px">⚠ portada no disponible</div>`
    : "";
  return `<div data-cover-marker style="${COVER_MARK_CSS};${fondo};color:${fallo ? "#9a8880" : "#555"}"><div data-cover-nombre>${escapeHtml(nombre)}</div>${aviso}</div>`;
}

function coverHtml(g: GameInfo, style: StyleInfo | undefined): string {
  const marcador = marcadorHtml(style?.name ?? g.style_id, false);
  const img = style?.cover_url
    ? `<img data-cover-img="${escapeAttr(style.style_id)}" alt="${escapeAttr(style.name)}" src="${escapeAttr(ASSET_STORE_URL + style.cover_url)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block">`
    : "";
  return `<div data-cover-for="${escapeAttr(g.game_id)}" style="${COVER_BOX};overflow:hidden;position:relative">${marcador}${img}</div>`;
}

function worldCardHtml(g: GameInfo, style: StyleInfo | undefined): string {
  return `
    <div data-game-id="${escapeAttr(g.game_id)}" style="display:flex;gap:12px;padding:10px;background:#181820;border:2px solid #2a2a30;cursor:pointer;border-radius:4px">
      ${coverHtml(g, style)}
      <div style="flex:1;min-width:0">
        <div style="color:#dcb;font-size:14px;margin-bottom:3px">${escapeHtml(g.title)} <span data-style-label-for="${escapeAttr(g.game_id)}" style="color:#666;font-size:11px;font-weight:normal">· Estilo: ${escapeHtml(style?.name ?? g.style_id)}</span></div>
        <div style="color:#999;font-size:11px;line-height:1.45">${escapeHtml(g.description)}</div>
        ${generationChipsHtml(g)}
      </div>
    </div>
  `;
}

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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

/** Nombre legible de un modelo del censo, derivado del id (`y_bot` → «Y bot»):
 *  pintar es del cliente, y una tabla id→nombre sería otra lista a mano — la
 *  enfermedad que #216 mató. */
function nombreDeModelo(id: string): string {
  const conEspacios = id.replace(/_/g, " ");
  return conEspacios.charAt(0).toUpperCase() + conEspacios.slice(1);
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
