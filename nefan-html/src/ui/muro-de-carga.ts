/** El muro de carga: el overlay `#narrative-loader` que tapa el lienzo
 *  mientras el motor construye el mundo, y que se queda puesto —en rojo— cuando
 *  algo falla. Es el único sitio del cliente que escribe en ese DOM, y también
 *  EL ÚNICO PINTOR DE AVISOS (#306): la suscripción a `errors.onAviso` vive
 *  aquí porque aquí están los dos destinos —el título y el muro— y es el único
 *  sitio que puede decidir entre ellos. */

import type { SalidaDelOverlay } from "@nefan-core/src/protocol/status-rotulo.js";
import { errors } from "./error-log.js";
import type { TitleScreen } from "./title-screen.js";
import { elTituloManda } from "./titulo-manda.js";
import { paso } from "./async-ui.js";

export interface DepsDelMuroDeCarga {
  /** El otro destino de los avisos: los apunta siempre, mande o no. */
  titleScreen: Pick<TitleScreen, "avisar" | "retirarAvisos">;
  /** El lienzo del mundo: a él se le pide de vuelta el pointer lock al cerrar
   *  un muro que lo soltó para que sus botones fueran pulsables (#503). */
  lienzo(): HTMLElement;
  /** Lo que hace el botón «Volver al título» de un muro sin partida detrás
   *  (#189). Es una función de la raíz: soltar la partida y volver a pintar
   *  el título es cosa de quien cablea. */
  volverAlTitulo(): Promise<void>;
}

export interface MuroDeCarga {
  /** Muro de espera: título, detalle y el cronómetro en marcha. */
  mostrar(titulo: string, detalle: string): void;
  /** Actualiza SOLO el detalle con un latido de progreso del motor (sin
   *  resetear el cronómetro ni pisar un estado de error). No-op si el muro no
   *  está visible — el progreso también llega en momentos sin overlay (p. ej.
   *  tiles de frontera en segundo plano). */
  progreso(mensaje: string): void;
  ocultar(): void;
  /** Muro de fallo. `salida` dice qué puede HACER el jugador con él: por
   *  defecto, cerrarlo y seguir con su partida; `volver-al-titulo` cuando
   *  detrás no hay partida ninguna y cerrar le dejaría sin nada que pulsar
   *  (#189). */
  fallo(titulo: string, detalle: string, salida?: SalidaDelOverlay): void;
  visible(): boolean;
  /** El motivo del último muro que ofrecía volver al título, o `null`. Se lo
   *  lleva el título en la vuelta: quien pulsa «Volver al título» acaba de
   *  leerlo, pero llegar a una pantalla que no dice nada de lo que acaba de
   *  pasar es la mitad muda de #189 («vuelve al título VIVO, con el motivo en
   *  pantalla»). Se lee ANTES de `ocultar()`, que lo borra. */
  motivoDelUltimoMuro(): string | null;
  /** El título acaba de abrirse o cerrarse (`titleScreen.onVisibilityChange`). */
  alCambiarElTitulo(visible: boolean): void;
}

export function crearMuroDeCarga(deps: DepsDelMuroDeCarga): MuroDeCarga {
  const { titleScreen } = deps;

  const loaderEl = document.getElementById("narrative-loader") as HTMLDivElement | null;
  const loaderTitle = document.getElementById("narrative-loader-title");
  const loaderDetail = document.getElementById("narrative-loader-detail");
  const loaderElapsed = document.getElementById("narrative-loader-elapsed");
  const loaderDismiss = document.getElementById("narrative-loader-dismiss");
  const loaderBack = document.getElementById("narrative-loader-back");

  let loaderStartedAt = 0;
  let loaderTicker: ReturnType<typeof setInterval> | null = null;
  let motivoDelUltimoMuro: string | null = null;
  /** QUIÉN puso el muro que hay en pantalla: la fuente del aviso que lo pintó,
   *  o `null` si lo puso una llamada directa (`mostrar`, `fallo`). Es la
   *  POLÍTICA de retirada del muro (#469): quien pinta es el dueño, y solo un
   *  muro puesto por un aviso se retira cuando su fuente demuestra que la causa
   *  ya no es cierta.
   *
   *  | Quién puso el muro            | `resuelto(source)` de esa causa | `resuelto` de otra | `alCambiarElTitulo(true)`     | `fallo()` legítimo después          |
   *  |-------------------------------|---------------------------------|--------------------|-------------------------------|-------------------------------------|
   *  | aviso (`= source`)            | se retira solo                  | nada               | se retira (el título lo tiene) | lo sustituye y toma la propiedad    |
   *  | `fallo()` del motor/título (`null`) | nada                      | nada               | nada                          | lo sustituye                        |
   *  | `mostrar()` (espera, `null`)  | nada                            | nada               | nada                          | lo sustituye                        |
   *
   *  Corolario: el bridge que LLEGA tras un bootstrap fallido por su ausencia
   *  retira el muro —«sin conexión con la partida» dejó de ser cierto, y el
   *  muro lo puso ese aviso—. Que el cliente siga siendo un visor hasta
   *  recargar es otra decisión, y no vive aquí. Lo demuestra el guion 78. */
  let muroPuestoPorAviso: string | null = null;

  /** UN MURO CON BOTÓN NECESITA CURSOR, Y SOLTARLO Y DEVOLVERLO SON LAS DOS
   *  MITADES DE UN ACTO (#503, misma disciplina que #311/#323).
   *
   *  Medido: con una conversación abierta y el motor muerto, elegir una opción
   *  cierra el panel y DEVUELVE el lock al lienzo (#323, correcto), y acto
   *  seguido el fallo del motor pinta el muro a pantalla completa con
   *  «Cerrar». Resultado: un botón, el ratón capturado y ningún cursor con el
   *  que pulsarlo —y encima `#game-ui[data-locked="true"] .nf-action` le quita
   *  los `pointer-events`, así que ni a ciegas—. Esc lo salvaba, y nada en
   *  pantalla lo decía.
   *
   *  Solo lo hace `fallo()`: el muro de ESPERA no pinta botones (la regla
   *  `#narrative-loader .dismiss { display: none }` de game-ui.css solo los
   *  saca con `.error`), así que soltar ahí le quitaría el ratón al jugador
   *  cada vez que el motor tarda en contestar.
   *
   *  `true` solo si lo soltamos NOSOTROS: quien ya estaba en modo cursor
   *  (mirando fixtures, con el título recién cerrado) no quiere que un muro le
   *  capture el ratón al cerrarse. */
  let ratonSoltadoPorElMuro = false;

  function soltarElRatonParaLosBotones(): void {
    if (document.pointerLockElement === null) return;
    ratonSoltadoPorElMuro = true;
    document.exitPointerLock();
  }

  /** La otra mitad, y CUELGA DEL BOTÓN «Cerrar», no de `ocultar()`.
   *
   *  No es un detalle de cableado: `ocultar()` tiene varios llamantes más y en
   *  ninguno de ellos el jugador vuelve al mundo con el muro por delante — el
   *  título abriéndose
   *  (`alCambiarElTitulo`), «Volver al título», un aviso que se declara
   *  `resuelto` y el `ocultar()` normal cuando la escena por fin llega.
   *  Colgarlo de `ocultar()` le robaba el cursor a quien acababa de pedir el
   *  título: `onVisibilityChange` llama a `alCambiarElTitulo` ANTES que a
   *  `marcarTitulo`, así que ni siquiera el guardia de `elTituloManda()` lo
   *  habría parado. «Cerrar» es el único gesto que significa «sigo jugando», y
   *  además es un gesto DEL USUARIO, que es lo que el navegador exige para
   *  conceder el lock.
   *
   *  Aun así puede NEGARSE (rechaza un lock pedido demasiado pronto tras
   *  soltarlo), por eso va por `paso()`: queda escrito en el registro en vez de
   *  tragarse. El click sobre el mundo sigue siendo la vía de recuperación —y
   *  la única para los otros cuatro caminos, que dejan el cursor puesto. */
  function devolverElRatonTrasElMuro(): void {
    if (!ratonSoltadoPorElMuro) return;
    ratonSoltadoPorElMuro = false;
    if (elTituloManda()) return;
    if (document.pointerLockElement !== null) return;
    paso(
      deps.lienzo().requestPointerLock(),
      "input",
      "no se pudo devolver el ratón al cerrar el aviso: haz click en el mundo para volver a jugar",
    );
  }

  function mostrar(titulo: string, detalle: string): void {
    if (!loaderEl) return;
    // Un muro de espera no es de ninguna fuente de aviso: la fila `mostrar()`
    // de la tabla de arriba, cumplida aquí y no solo escrita.
    muroPuestoPorAviso = null;
    loaderEl.classList.remove("error");
    loaderEl.classList.add("visible");
    if (loaderTitle) loaderTitle.textContent = titulo;
    if (loaderDetail) loaderDetail.textContent = detalle;
    loaderStartedAt = Date.now();
    if (loaderElapsed) loaderElapsed.textContent = "0s";
    if (loaderTicker) clearInterval(loaderTicker);
    loaderTicker = setInterval(() => {
      if (!loaderElapsed) return;
      const s = Math.floor((Date.now() - loaderStartedAt) / 1000);
      loaderElapsed.textContent = `${s}s`;
    }, 500);
  }

  function progreso(mensaje: string): void {
    if (!loaderEl || !loaderEl.classList.contains("visible")) return;
    if (loaderEl.classList.contains("error")) return;
    if (loaderDetail) loaderDetail.textContent = mensaje;
  }

  function ocultar(): void {
    if (!loaderEl) return;
    loaderEl.classList.remove("visible", "error");
    if (loaderBack) loaderBack.hidden = true;
    if (loaderDismiss) loaderDismiss.hidden = false;
    // El muro se va y su motivo con él: quien lo lea después
    // (`volverAlTitulo`) tiene que leerlo ANTES de cerrarlo, no heredarlo de un
    // fallo viejo.
    motivoDelUltimoMuro = null;
    if (loaderTicker) {
      clearInterval(loaderTicker);
      loaderTicker = null;
    }
    // El muro que soltó el ratón ya no está, así que la deuda se cancela: si el
    // jugador no volvió al mundo por «Cerrar» (ver `devolverElRatonTrasElMuro`),
    // no se le devuelve, y un muro POSTERIOR no puede heredar esta deuda.
    ratonSoltadoPorElMuro = false;
  }

  function fallo(titulo: string, detalle: string, salida: SalidaDelOverlay = "cerrar"): void {
    if (!loaderEl) return;
    // Quien pinta un muro es su dueño: si venía de un aviso, el suscriptor de
    // abajo vuelve a escribir la fuente justo después de llamar aquí. Este
    // reset es lo que impide que un `resuelto` de una causa ajena cierre un
    // muro que no es suyo.
    muroPuestoPorAviso = null;
    loaderEl.classList.remove("error");
    loaderEl.classList.add("visible", "error");
    if (loaderTitle) loaderTitle.textContent = titulo;
    if (loaderDetail) loaderDetail.textContent = detalle;
    const sinMundo = salida === "volver-al-titulo";
    if (loaderBack) loaderBack.hidden = !sinMundo;
    // Y sin mundo NO HAY ADÓNDE CERRAR: «Cerrar» dejaba al jugador en el mismo
    // callejón de #189 que la salida de al lado venía a abrir —cielo vacío,
    // cinco botones de ataque y recargar— y con el mismo peso visual, así que
    // media pantalla pulsaba la que no era. Donde sí sigue estando es en los
    // muros que tienen partida detrás (`salida: "cerrar"`), que son todos los
    // demás — incluido el de «sin conexión con la partida», que es el que
    // cierra `qa/fixtures-sin-bridge.mjs` para entrar al modo fixtures.
    if (loaderDismiss) loaderDismiss.hidden = sinMundo;
    motivoDelUltimoMuro = sinMundo ? `${titulo}. ${detalle}` : null;
    if (loaderTicker) {
      clearInterval(loaderTicker);
      loaderTicker = null;
    }
    // Y el ratón, para que el botón que acabamos de pintar se pueda pulsar
    // (#503). Va DESPUÉS de pintarlo: el muro ya está en pantalla cuando el
    // cursor reaparece.
    soltarElRatonParaLosBotones();
    // …y se BORRA el contador, no solo se para (QA 2026-09-01, H-5). Paraba el
    // intervalo y dejaba el último texto puesto, así que bajo un muro de error
    // quedaba un «0s» huérfano entre el motivo y «Cerrar»: el reloj de una
    // espera que ya no existe. Un fallo no tarda segundos en fallar.
    if (loaderElapsed) loaderElapsed.textContent = "";
  }

  // «Cerrar» es volver al mundo: el muro se va Y el ratón vuelve si lo soltamos
  // nosotros (#503). El orden importa poco, pero `devolver` lee el flag que
  // `ocultar` limpia, así que va ANTES.
  if (loaderDismiss) {
    loaderDismiss.onclick = () => {
      devolverElRatonTrasElMuro();
      ocultar();
    };
  }
  if (loaderBack) {
    loaderBack.onclick = () => paso(deps.volverAlTitulo(), "session", "volver a la pantalla de título");
  }

  // EL ÚNICO PINTOR DE AVISOS (#306). Los fallos que saltan SOLOS durante el
  // arranque —three.js que no carga, las hojas base que no llegan, el socket de
  // la partida— solo existían en `#error-log`, que el interruptor de #246 apaga
  // mientras el título manda: un título normal encima de un cliente roto.
  //
  // El aviso es una PROYECCIÓN del mismo `errors.push` que lo registró (el texto
  // es su `message`), así que log y pantalla no pueden divergir. Aquí solo se
  // decide DÓNDE se lee:
  //
  //  - El título lo APUNTA siempre. No es doble verdad: es el mismo aviso, y los
  //    dos huecos no pueden verse a la vez porque `html[data-titulo="1"] #game-ui`
  //    esconde el muro mientras el título manda. Apuntarlo siempre es lo que
  //    salva el caso que da nombre al issue: los tres fallos saltan ANTES del
  //    primer `show()` del título, así que enrutar solo por el estado de ahora
  //    los pintaría en un muro que el título tapa medio segundo después.
  //  - Y si el título NO manda, además se pinta el muro, que es lo que el
  //    jugador tiene delante en ese momento.
  //
  // La entrega llega SIEMPRE en microtarea (`ErrorLog.entrega`), así que cuando
  // corre, quien construyó este muro ha terminado de evaluarse.
  errors.onAviso((e) => {
    // «Resuelto» es la mitad que faltaba: un aviso que no caduca acaba
    // contradiciendo a la pantalla que lo enseña (QA de T9, H-3).
    if (e.tipo === "resuelto") {
      titleScreen.retirarAvisos(e.source);
      if (muroPuestoPorAviso === e.source) ocultar();
      return;
    }
    titleScreen.avisar(e.aviso);
    if (!elTituloManda()) {
      // DESPUÉS de `fallo()`, que pone la propiedad a `null`: aquí el dueño es
      // el aviso, y es lo que permite que `resuelto` lo retire.
      fallo(e.aviso.titulo, e.aviso.mensaje);
      muroPuestoPorAviso = e.aviso.source;
    }
  });

  return {
    mostrar,
    progreso,
    ocultar,
    fallo,
    visible: () => loaderEl?.classList.contains("visible") ?? false,
    motivoDelUltimoMuro: () => motivoDelUltimoMuro,
    alCambiarElTitulo(visible) {
      // El título solo TAPA el muro (`#narrative-loader` vive dentro de
      // `#game-ui`), así que uno puesto por un aviso seguía armado y salía a
      // pantalla completa al cerrar el título por su propio botón, con un fallo
      // que el jugador acababa de leer arriba (QA de T9, H-1). No se pierde
      // nada: el aviso lo tiene el título, que es quien manda ahora.
      if (visible && muroPuestoPorAviso !== null) {
        ocultar();
        muroPuestoPorAviso = null;
      }
    },
  };
}
