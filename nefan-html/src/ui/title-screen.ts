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
import type { NarrativeClient } from "../net/narrative-client.js";
import type { NarrativeStatusDeJuego } from "@nefan-core/src/protocol/messages.js";
import { type AvisoAlJugador, encajarAviso, errors } from "./error-log.js";
import { paso } from "./async-ui.js";
import { StyleApplyController } from "./style-apply.js";
import {
  AI_SERVER_HTTP,
  ASSET_STORE_URL,
  type DestinoDelTitulo,
  escapeHtml,
  marcadorHtml,
  type TitleAction,
} from "./titulo/atomos.js";
import { pintarCrearMundo } from "./titulo/crear-mundo.js";
import {
  pintarEditorDePersonaje,
  type EleccionDeMundo,
} from "./titulo/editor-de-personaje.js";
import { pintarHome } from "./titulo/home.js";
import { pintarPlanDeEstilo } from "./titulo/plan-de-estilo.js";
import {
  pintarProgresoDeMundo,
  pintarSelectorDeMundo,
} from "./titulo/selector-de-mundo.js";
import { type DepsDeSubirEstilo, pintarSubirEstilo } from "./titulo/subir-estilo.js";

/** Lo que resuelve `show()`. Vive en `titulo/atomos.ts` desde el primer corte
 *  de #346 —es vocabulario del título y lo van a leer varias de sus pantallas,
 *  no solo esta clase— y se re-exporta aquí para que su único consumidor de
 *  fuera (`main.ts:32`) lo siga importando del título, sin tener que saber cómo
 *  está troceado por dentro. */
export type { TitleAction };

export class TitleScreen {
  private root: HTMLDivElement;
  private content: HTMLDivElement;
  /** La banda de «hay más partidas» (#251). Campo y no `querySelector`: lo
   *  crea el constructor, así que buscarlo y comprobar que existe era la misma
   *  rama inalcanzable que esta tanda borró en `loadSceneFile`. */
  private readonly aviso = document.createElement("div");
  /** Los avisos que le llegan al título desde el registro de errores (#306):
   *  fallos que saltaron SOLOS, sin que el jugador pulsara nada. Viven aquí y
   *  no en el DOM porque el home reescribe `content.innerHTML` entero, y
   *  eso era literalmente el bug: el motivo se pintaba y el repintado
   *  siguiente se lo llevaba. La clave es el TÍTULO —dos fallos de la misma
   *  familia son una noticia— y se enseña el detalle del último, que en la
   *  familia de los sprites es el agregado con el remedio. */
  private avisosDelJugador: AvisoAlJugador[] = [];
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

  /** El progreso del mundo que el jugador está mirando, ya resuelto: es lo que
   *  la hoja del selector necesita para pintarlo sin conocer ni el mapa ni la
   *  tarjeta seleccionada, que son de esta clase. `null` (nada seleccionado
   *  todavía) y «seleccionado pero sin progreso» se colapsan a propósito: los
   *  dos se pintan igual, que es vaciando la línea. */
  private progresoDelMundoMirado(): NarrativeStatusDeJuego | undefined {
    return this.lastSelectedGameId === null
      ? undefined
      : this.gameGenStatus.get(this.lastSelectedGameId);
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
      if (line) pintarProgresoDeMundo(line, this.progresoDelMundoMirado());
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
            this.pintarElSelector(this.lastSelectedGameId ?? undefined),
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
   *  `await pintarElHome()` —o sea, después del `await listSessions()`— y
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
    await this.pintarElHome(opts.aviso);
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
  avisar(aviso: AvisoAlJugador): void {
    this.avisosDelJugador = encajarAviso(this.avisosDelJugador, aviso);
    // «Bridge OK — N partidas» describe una lectura anterior a la caída: se
    // retira aquí para que la pantalla no diga dos cosas contrarias A LA VEZ.
    if (aviso.source === "bridge") this.caducarEstadoDeSaves();
    this.pintarAvisos();
  }

  /** El fallo de `source` se ha resuelto: sus avisos se van de la pantalla.
   *  La otra mitad de `avisar`, y la que impide que un aviso sea eterno. */
  retirarAvisos(source: string): void {
    this.avisosDelJugador = this.avisosDelJugador.filter((a) => a.source !== source);
    this.pintarAvisos();
  }

  /** El título deja de afirmar que la lista está al día cuando el socket que
   *  la trajo acaba de fallar. Las tarjetas se quedan: siguen sirviendo. */
  private caducarEstadoDeSaves(): void {
    const el = this.content.querySelector<HTMLElement>("#ts-status");
    if (!el || !(el.textContent ?? "").startsWith("Bridge OK")) return;
    el.textContent = "Esta lista es de antes del fallo: puede que ya no esté al día.";
    el.style.color = "#888";
  }

  /** Reescribe `#ts-error` ENTERO desde el estado: los avisos del registro más,
   *  si lo hay, el motivo de la última acción fallida. Un solo sitio escribe
   *  ese hueco, así que no hay dos redacciones que puedan divergir. No hace
   *  nada si el home no está pintado (el hueco solo existe ahí): el aviso se
   *  queda en `avisosDelJugador` y el siguiente pintado del home lo saca. */
  private pintarAvisos(): void {
    const el = this.content.querySelector<HTMLElement>("#ts-error");
    if (!el) return;
    // Por GRAVEDAD, no por orden de llegada, y con el titular separado del
    // detalle: los dos iban en el mismo color y cuerpo, así que el cosmético
    // gritaba igual que «no se puede dibujar el mundo» y encima salía antes
    // por llegar antes (QA de T9, H-7). `data-aviso` es el titular, para que
    // el candado afirme CUÁL se lee y cuántos hay.
    const pegajosos = this.avisosDelJugador
      .map(
        (a) =>
          `<div data-aviso="${escapeHtml(a.titulo)}" style="margin-bottom:8px;line-height:1.45">` +
          `<strong style="color:#c55">${escapeHtml(a.titulo)}</strong>` +
          `<span style="display:block;color:#8a7f7f;font-size:12px">${escapeHtml(a.mensaje)}</span>` +
          `</div>`,
      )
      .join("");
    const accion = this.avisoDeAccion
      ? `<span style="color:${this.avisoDeAccion.tono === "error" ? "#a44" : "#8a8"}">` +
        `${escapeHtml(this.avisoDeAccion.motivo)}</span>`
      : "";
    el.innerHTML = pegajosos + accion;
    el.style.display = pegajosos || accion ? "" : "none";
  }

  /** Los colaboradores de la pantalla de subida de estilo, en un solo sitio:
   *  la llaman el botón del selector y el enrutador, y dos listas de campos
   *  que hay que mantener iguales acaban siendo dos listas distintas. */
  private subirEstilo(): DepsDeSubirEstilo {
    return { content: this.content, ir: (d) => this.ir(d) };
  }

  /** A DÓNDE va el título cuando una de sus pantallas termina.
   *
   *  Es el único camino de vuelta que tienen las hojas de `ui/titulo/`: no
   *  pueden importarse entre sí (candado
   *  `las-hojas-del-titulo-no-se-atan-entre-si`), así que enruta quien puede
   *  importarlas todas. La tabla está entera desde el primer corte a propósito
   *  —los cinco destinos son las pantallas de #346, y el tipo los declara en
   *  `atomos.ts`—; hoy la usan las dos hojas de esta PR, que vuelven al
   *  selector, y los demás casos apuntan a los métodos que todavía viven aquí
   *  y los estrenarán las PR 4 y 5 al sacarlos.
   *
   *  DEVUELVE la promesa del repintado en vez de tragársela con un `paso()`
   *  de dentro: «Crear mundo» encadena el selector DENTRO de su `try`, y
   *  hacerla fire-and-forget movería de sitio ese fallo. Lo midió QA-3 sobre el
   *  juego real (guion 96): con la promesa tragada, un fallo del repintado deja
   *  la pantalla en «Mundo creado» con los dos botones apagados y sin salida.
   *  Quien no la espera la pasa por `paso()`, que es lo que ya hacía cada
   *  pantalla del título.
   *
   *  Tres de las cuatro vueltas al selector se `await`ean dentro de un `try`
   *  cuyo `catch` le pinta el motivo al jugador donde está
   *  (`#ts-style-progress`, `#ts-style-status`): tragarse el rechazo con un
   *  `paso()` propio mandaría esos fallos al registro —que el título tapa por
   *  CSS (#246/#306)— y dejaría la pantalla muda, que es el no-op de #181.
   *
   *  Y es `async` por los dos destinos SÍNCRONOS: sin él, un fallo al pintar
   *  «Crear mundo» o «Subir estilo» saldría por un `throw` de aquí —antes de
   *  que haya promesa— y `paso(this.ir(…), …)` no podría encauzarlo, que es
   *  justo lo que el llamante cree estar contratando (QA-3 H6). Hoy no tiene
   *  ocupante; la palabra cuesta lo que cuesta y la deuda no llega a la PR 5. */
  private async ir(destino: DestinoDelTitulo): Promise<void> {
    switch (destino.a) {
      case "home":
        return this.pintarElHome(destino.aviso, destino.tono);
      case "selector":
        return this.pintarElSelector(destino.preselect);
      case "crear-mundo":
        return this.crearMundo();
      case "subir-estilo":
        pintarSubirEstilo(this.subirEstilo());
        return;
      case "editor":
        return this.editorDePersonaje(destino);
    }
    // EL `never` ES EL CANDADO, y hay que ponerlo porque el `async` se llevó el
    // que había (TS2366): caerse por el final de una función `async` devuelve
    // `Promise<undefined>`, que es un `Promise<void>` válido, así que un destino
    // nuevo sin `case` compilaría y no haría nada. Aquí no compila. Va DESPUÉS
    // del switch y no en un `default`, que mataría el estrechamiento.
    const nunca: never = destino;
    throw new Error(`destino del título no contemplado: ${JSON.stringify(nunca)}`);
  }

  /** Cablea el SELECTOR DE MUNDOS y lo pinta. Seis colaboradores, como el home,
   *  y por el mismo motivo: es el otro concentrador del título.
   *
   *  Los dos que solo tiene esta pantalla son las dos mitades del progreso de
   *  pre-generación (#313), que esta clase posee porque el suscriptor del bridge
   *  vive aquí y sobrevive a cualquier repintado: `recordarMundo` apunta qué
   *  tarjeta se está mirando y `progresoDe` contesta por el mapa. La hoja no ve
   *  ninguno de los dos campos, y eso es lo que la deja sin `this`.
   *
   *  `mostrarPlanDeEstilo` no es un destino de `ir` porque el panel de coste no
   *  sustituye la pantalla: se monta DENTRO del hueco que el selector le abre.
   *  Se cablea aquí porque necesita el `StyleApplyController` —uno solo, el de
   *  esta clase, que es el que consulta el bench— y porque una hoja no puede
   *  importar a otra.
   *
   *  Y es `async` por lo mismo que `ir` y que `pintarElHome`, que es la familia
   *  que ha mordido tres veces en este programa (QA-2 H2, QA-3 H6, QA-4 H2): el
   *  oyente del bridge llama a este método dentro de un `paso(...)`, así que un
   *  `throw` SÍNCRONO de este cableado saldría antes de que exista promesa y
   *  `paso()` no podría encauzarlo. Hoy no tiene ocupante. */
  private async pintarElSelector(preselect?: string): Promise<void> {
    return pintarSelectorDeMundo(
      {
        content: this.content,
        narrative: this.narrative,
        recordarMundo: (gameId) => {
          this.lastSelectedGameId = gameId;
        },
        progresoDe: (gameId) => this.gameGenStatus.get(gameId),
        ir: (destino) => this.ir(destino),
        mostrarPlanDeEstilo: (hueco, gameId, styleId) =>
          pintarPlanDeEstilo(
            { hueco, styleApply: this.styleApply, ir: (d) => this.ir(d) },
            gameId,
            styleId,
          ),
      },
      preselect,
    );
  }

  /** Cablea el HOME y lo pinta. Es el `Deps` más grande de las seis hojas —
   *  seis colaboradores— porque es la pantalla que más cosas del título toca:
   *  lista partidas por el bridge, resuelve la promesa de `show()` con un
   *  `resume`, va al selector, escribe en la caja de avisos y mueve la banda de
   *  «hay más partidas».
   *
   *  `avisos` va como fachada INLINE y no como campo: la caja de `#ts-error`
   *  todavía vive en esta clase (`mostrarErrorEnHome`/`pintarAvisos`) y sale a
   *  `ui/titulo/avisos.ts` en la PR 6 de #346. Los tres nombres son los que
   *  `crearAvisos(deps)` va a exportar, así que ese corte sustituye este objeto
   *  literal por la fábrica y no vuelve a tocar `home.ts`.
   *
   *  `limpiarAccion` NO repinta, igual que el `this.avisoDeAccion = null` que
   *  sustituye: el home decide justo después si escribe un motivo nuevo o si
   *  solo repinta lo pegajoso, y adelantar ese pintado sería un repintado de
   *  más metido de contrabando dentro de un movimiento.
   *
   *  Y es `async` por lo mismo que `ir`, que es la tercera vez que esta familia
   *  muerde en este programa (QA-2 H2, QA-3 H6, QA-4 H2): el «Volver» del
   *  selector la llama dentro de un `paso(...)`, así que un `throw` SÍNCRONO de
   *  este cableado saldría antes de que exista promesa y `paso()` no podría
   *  encauzarlo — el jugador se quedaría sin motivo en pantalla y sin entrada en
   *  el registro. Hoy no tiene ocupante (el cuerpo es un literal de objeto), pero
   *  la PR 6 mete aquí `crearAvisos(deps)`, que sí es una llamada que puede
   *  lanzar. `renderHome` era `async` y esta palabra devuelve esa garantía. */
  private async pintarElHome(aviso?: string, tono?: "error" | "aviso"): Promise<void> {
    return pintarHome(
      {
        content: this.content,
        narrative: this.narrative,
        elegir: (accion) => this.resolve?.(accion),
        ir: (destino) => this.ir(destino),
        avisos: {
          mostrarAccion: (motivo, tonoDelAviso) => this.mostrarErrorEnHome(motivo, tonoDelAviso),
          limpiarAccion: () => {
            this.avisoDeAccion = null;
          },
          repintar: () => this.pintarAvisos(),
        },
        avisarDeCorte: () => this.actualizarAvisoDeCorte(),
      },
      aviso,
      tono,
    );
  }

  /** Cablea «Crear mundo» y la pinta. Los colaboradores se construyen aquí, en
   *  el enrutador, porque son lo único que una hoja no puede saber de esta
   *  clase. */
  private crearMundo(): void {
    pintarCrearMundo({
      content: this.content,
      narrative: this.narrative,
      ir: (destino) => this.ir(destino),
    });
  }

  /** Cablea «Crear personaje» y la pinta. `elegir` es `this.resolve` visto
   *  desde la hoja, con su `?.` donde estaba: la promesa la arma y la resuelve
   *  esta clase (ver `show()`), no la pantalla. */
  private editorDePersonaje(eleccion: EleccionDeMundo): Promise<void> {
    return pintarEditorDePersonaje(
      {
        content: this.content,
        elegir: (accion) => this.resolve?.(accion),
        ir: (destino) => this.ir(destino),
      },
      eleccion,
    );
  }
}
