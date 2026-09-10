/** El CHASIS del título: el overlay que sostiene a las siete pantallas.
 *
 *  Monta `#title-screen` —la caja fija que tapa el juego—, la columna que cada
 *  pantalla reescribe entera, la banda de «hay más partidas» (`#ts-mas`) y el
 *  botón de cierre sin sesión (`#ts-close`), y los cuelga del `<body>`. Sale de
 *  `title-screen.ts` en la PR 6 de #346, la última del programa.
 *
 *  EL ORDEN DE LOS TRES HIJOS ES CONTRATO, no gusto. Los guiones 33, 34, 95 y
 *  99 llegan a la columna por
 *  `document.getElementById("title-screen").firstElementChild`, y el 99 afirma
 *  la lista entera (`(content),ts-mas,ts-close`, tres hijos). Y los ids no son
 *  decoración: `#ts-close` es «el título ha aparecido» para una docena de
 *  guiones y `#ts-mas` es el sujeto del 33 entero, así que perder uno aquí no
 *  rompe una batería, rompe doce.
 *
 *  QUÉ VIVE AQUÍ Y POR QUÉ. El criterio no es «lo que sobró al mudarse las
 *  pantallas» (la pregunta que dejó abierta QA-5, H5): es la VIDA. Aquí va lo
 *  que dura lo que dura `#title-screen`, sea cual sea la pantalla pintada — el
 *  chasis es lo único del título que no se repinta nunca. Por eso son suyos los
 *  CUATRO oyentes de por vida que no son del bridge: el `ResizeObserver` y el
 *  `scroll` de la columna, el click de `#ts-close` y el `error` en captura
 *  sobre la raíz. Ninguna hoja puede engancharse ahí —una hoja solo escucha a
 *  los nodos que ella misma crea dentro de `content`, riesgo 4 del plan—, así
 *  que el dueño no se elige: es el único que puede serlo.
 *
 *  Eso mete aquí las dos piezas que se quedaron sin dueño al mudarse el
 *  selector, y las mete POR LA VIDA y no por descarte:
 *
 *  · `vigilarPortadas` es UN oyente en captura sobre la raíz que cubre todas
 *    las pantallas, las de hoy y las de mañana, incluidas las tarjetas que se
 *    repintan enteras por `outerHTML`. Mira `data-cover-img`, `data-cover-for`
 *    y `data-cover-marker`, que hoy solo pinta
 *    el selector, pero lo que declara es política del OVERLAY —una imagen que
 *    no llega degrada al marcador y deja rastro—, no de una pantalla: el día
 *    que otra pinte una portada ya está cubierta, sin que nadie se acuerde.
 *  · El `<style id="title-screen-responsive">` es un efecto de vida completa
 *    sobre `document.head`, idempotente por id, con TODAS sus reglas
 *    prefijadas por `#title-screen`. Es la misma caja que el `cssText` de la
 *    raíz, en su rama estrecha: el padding del overlay se decide entre los dos
 *    y separarlos deja una geometría escrita en dos ficheros. Que SEIS de sus
 *    OCHO bloques apunten a ids del selector (`#ts-columns`, `#ts-worlds`,
 *    `#ts-rendermode`, `#ts-charmode`, `#ts-actions`, `#ts-create-world`; los
 *    otros dos son del overlay y del `h1`) no lo hace del selector — la hoja
 *    se va y vuelve cada vez que se navega, y la hoja de estilo se instala una
 *    vez para toda la sesión. La cifra iba mal —«cuatro de seis»— y la corrigió
 *    QA-6 (H1): un número escrito para justificar una decisión que nadie vuelve
 *    a medir es la tercera vez que este programa lo caza.
 *
 *    Esas seis parejas son ADEMÁS la frontera que ningún candado ve: si el
 *    selector renombra `#ts-columns`, la distribución móvil deja de aplicarse y
 *    todo sigue verde. Tiene issue (#555), y no se tapa aquí con prosa.
 *
 *  QUÉ NO DECIDE: nada de juego, y nada de qué se pinta. El chasis no sabe qué
 *  pantalla hay dentro de la columna —lo DERIVA de lo pintado, que es por lo
 *  que la banda se esconde sola donde no hay `#ts-sessions`— y no conoce a
 *  ninguna hoja (candado `las-hojas-del-titulo-no-se-atan-entre-si`).
 */
import { errors } from "../error-log.js";
import { marcadorHtml } from "./atomos.js";

/** El único colaborador del chasis. */
export interface DepsDeChasis {
  /** Qué hace el TÍTULO cuando se pulsa «✕ cerrar» (modo fixtures).
   *
   *  El chasis sabe esconder su propia raíz (`ocultar`), pero esconderla no es
   *  todo lo que pasa al cerrar: hay quien lo está mirando desde fuera
   *  (`onVisibilityChange`, que es de la clase y lo lee `main.ts` para tapar el
   *  chip de gráficos). Así que el click SALE por aquí y vuelve como
   *  `ocultar()`, en vez de que el chasis se esconda a solas y deje al de fuera
   *  creyendo que el título sigue abierto. */
  alCerrar(): void;
}

/** El chasis montado, visto por la clase que lo posee. */
export interface Chasis {
  /** `#title-screen`: el overlay entero. Lo necesita el bench para saber si
   *  tapa el juego, y es la raíz de la que cuelga todo lo demás. */
  root: HTMLDivElement;
  /** La columna que cada pantalla del título reescribe entera. */
  content: HTMLDivElement;
  /** Enseña el overlay. NO notifica a nadie: eso es de la clase. */
  mostrar(): void;
  /** Lo esconde, con la misma condición. */
  ocultar(): void;
  /** ¿Tapa el juego? */
  readonly visible: boolean;
  /** Re-evalúa la banda de «hay más partidas». Lo llama el home cuando la
   *  columna acaba de cambiar de alto, y `show()` al abrir. */
  avisarDeCorte(): void;
}

/** Monta el overlay del título y lo cuelga del `<body>`. Una sola vez por
 *  partida: lo llama el constructor de `TitleScreen`. */
export function montarChasis(deps: DepsDeChasis): Chasis {
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
  const root = document.createElement("div");
  root.id = "title-screen";
  root.style.cssText = [
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
  const content = document.createElement("div");
  content.style.cssText = [
    "max-width: 720px",
    "width: 100%",
    "max-height: 100%",
    "overflow-y: auto",
  ].join(";");
  root.appendChild(content);
  // La señal de «hay más partidas» (#251). ABSOLUTA y colgando de la raíz:
  // dentro del flujo volvería a mover «Nueva partida» al aparecer, que es
  // el bug que #181-c cerró. Sin tematizar, como el resto del título.
  //
  // Se crea aquí y viaja por CIERRE, no se busca con `querySelector`: buscarlo
  // y comprobar que existe era la misma rama inalcanzable que la tanda de
  // `loadSceneFile` borró. (Era un campo de la clase por lo mismo.)
  const mas = document.createElement("div");
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
  root.appendChild(mas);
  const avisarDeCorte = (): void => actualizarAvisoDeCorte(content, mas);
  // Re-evaluar cuando la columna cambia de tamaño (llega la lista de saves,
  // cargan las portadas del selector de mundos) y cuando se desplaza.
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => avisarDeCorte()).observe(content);
  }
  content.addEventListener("scroll", () => avisarDeCorte());
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
    deps.alCerrar();
    console.log("[title] cerrado sin sesión — modo fixtures (selector Room + tecla G)");
  });
  root.appendChild(close);
  document.body.appendChild(root);
  vigilarPortadas(root);
  return {
    root,
    content,
    mostrar: () => {
      root.style.display = "flex";
    },
    ocultar: () => {
      root.style.display = "none";
    },
    get visible(): boolean {
      return root.style.display !== "none";
    },
    avisarDeCorte,
  };
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
function vigilarPortadas(root: HTMLDivElement): void {
  root.addEventListener(
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
 *  recorta es `content` (`max-height:100%; overflow-y:auto`), que se
 *  lleva la columna ENTERA. Una señal sobre la lista iría al elemento
 *  equivocado.
 *
 *  Lo que AVISA es el texto, y lo que se mide es el texto: un degradado a
 *  secas solo se nota cuando una tarjeta queda partida, y con el corte justo
 *  entre dos la columna parece completa. El degradado de la banda no es la
 *  señal, es lo que hace la señal LEGIBLE — sin él la frase caía encima de
 *  los badges de la tarjeta cortada y se leían las dos a la vez.
 *
 *  La banda cuelga de la RAÍZ con `position:absolute`, NO de la columna:
 *  cualquier cosa que aparezca dentro del flujo puede volver a mover
 *  «Nueva partida», que es #181-c. */
function actualizarAvisoDeCorte(content: HTMLDivElement, aviso: HTMLDivElement): void {
  // Solo en el HOME. En el selector de mundos, el editor de personaje o la
  // subida de estilo no hay partidas que contar, y la banda aparecía ahí
  // diciendo «hay más abajo» sobre una pantalla que no tiene ninguna: un
  // aviso cierto sobre el desbordamiento y falso sobre su sujeto.
  //
  // Se DERIVA de lo pintado (`#ts-sessions` solo existe en el home) y no de
  // un flag que las pantallas tengan que acordarse de poner: la que se
  // olvidara dejaría la banda mintiendo en su pantalla.
  if (!content.querySelector("#ts-sessions")) {
    aviso.hidden = true;
    return;
  }
  // +1 px de tolerancia: el redondeo subpíxel del layout hace que una
  // columna que cabe justa se declare desbordada.
  // Guarda BARATA antes de leer geometría: si la columna no desborda, no
  // puede haber nada fuera. +1 px por el redondeo subpíxel del layout.
  if (content.scrollHeight <= content.clientHeight + 1) {
    aviso.hidden = true;
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
  const caja = content.getBoundingClientRect();
  const fuera = [...content.querySelectorAll<HTMLElement>(".ts-save")].filter(
    (fila) => fila.getBoundingClientRect().bottom > caja.bottom + 1,
  ).length;
  if (fuera === 0) {
    aviso.hidden = true;
    return;
  }
  // Cuántas quedan fuera es el dato que el jugador necesita («¿me falta una
  // o me faltan diez?») y el que el contador de arriba no da: ese dice
  // cuántas HAY, no cuántas se están escondiendo. Al llegar abajo del todo
  // el conteo cae a 0 solo, así que el aviso se retira sin una segunda
  // condición que mantener.
  aviso.textContent = `↓ hay ${fuera} partida${fuera === 1 ? "" : "s"} más — desplaza la lista`;
  aviso.hidden = false;
}
