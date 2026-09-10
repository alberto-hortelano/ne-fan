/** LA CAJA DE AVISOS del título (`#ts-error`): lo que lee el jugador cuando
 *  algo se rompe antes de empezar a jugar.
 *
 *  Sale de `title-screen.ts` en la PR 6 de #346 y encaja en el hueco que la PR
 *  4 dejó preparado: el home la recibía como objeto literal con estos mismos
 *  cinco nombres (`AvisosDelHome`, tres de ellos), así que este corte sustituye
 *  el literal por la fábrica y no vuelve a tocar la hoja del home.
 *
 *  DOS AVISOS QUE NO SON EL MISMO, y esa es toda la pieza:
 *
 *  · Los PEGAJOSOS (`avisar`/`retirar`, #306) llegan del registro de errores:
 *    algo falló SOLO, sin que el jugador pulsara nada. Viven aquí, en memoria,
 *    y no en el DOM, porque el home reescribe su `innerHTML` entero y eso era
 *    literalmente el bug — el motivo se pintaba y el repintado siguiente se lo
 *    llevaba. Se van cuando su fuente se recupera (`retirar`), no cuando se
 *    repinta.
 *  · El de ACCIÓN (`mostrarAccion`/`limpiarAccion`) es el motivo de lo último
 *    que el jugador intentó y no salió. Efímero por naturaleza: el repintado
 *    del home lo descarta, al revés que los de arriba.
 *
 *  UN SOLO SITIO ESCRIBE EL HUECO (`repintar`, desde el estado de los dos), y
 *  por eso no hay dos redacciones que puedan divergir.
 *
 *  QUÉ NO DECIDE: cuál de los avisos del registro merece pantalla. Esa regla
 *  —uno por titular, tope 3, orden por gravedad— es `encajarAviso` en
 *  `ui/error-log.ts`, pura y fuera del título a propósito. Aquí solo se
 *  guardan y se pintan. Y no conoce a ninguna otra hoja (candado
 *  `las-hojas-del-titulo-no-se-atan-entre-si`).
 */
import { type AvisoAlJugador, encajarAviso } from "../error-log.js";
import { escapeHtml } from "./atomos.js";

/** El único colaborador. */
export interface DepsDeAvisos {
  /** La columna del título. La caja (`#ts-error`) solo existe mientras el home
   *  esté pintado, así que se busca en cada pintado en vez de guardarse: la
   *  referencia de una pantalla anterior apuntaría a un nodo ya desechado. */
  content: HTMLDivElement;
}

/** Las cinco puertas de la caja de avisos. Las dos primeras son API pública de
 *  `TitleScreen` (las llama `main.ts` desde el registro de errores); las tres
 *  últimas las empuja el home, y son las que `DepsDeHome.avisos` declara. */
export interface Avisos {
  /** Un aviso del registro se apunta y se pinta. Idempotente por título. */
  avisar(aviso: AvisoAlJugador): void;
  /** El fallo de `source` se resolvió: sus avisos se van de la pantalla. */
  retirar(source: string): void;
  /** Pinta el motivo de la ÚLTIMA acción que falló, con su tono, y repinta. */
  mostrarAccion(motivo: string, tono?: "error" | "aviso"): void;
  /** Descarta ese motivo. NO repinta. */
  limpiarAccion(): void;
  /** Reescribe `#ts-error` entero desde el estado. */
  repintar(): void;
}

export function crearAvisos(deps: DepsDeAvisos): Avisos {
  /** Los avisos que le llegan al título desde el registro de errores (#306):
   *  fallos que saltaron SOLOS, sin que el jugador pulsara nada. La clave es el
   *  TÍTULO —dos fallos de la misma familia son una noticia— y se enseña el
   *  detalle del último, que en la familia de los sprites es el agregado con el
   *  remedio. */
  let avisosDelJugador: AvisoAlJugador[] = [];
  /** El motivo de la ÚLTIMA acción que falló (pulsar «Nueva partida» sin
   *  bridge, borrar una partida que ya no estaba). */
  let avisoDeAccion: { motivo: string; tono: "error" | "aviso" } | null = null;

  /** Reescribe `#ts-error` ENTERO desde el estado: los avisos del registro más,
   *  si lo hay, el motivo de la última acción fallida. Un solo sitio escribe
   *  ese hueco, así que no hay dos redacciones que puedan divergir. No hace
   *  nada si el home no está pintado (el hueco solo existe ahí): el aviso se
   *  queda en `avisosDelJugador` y el siguiente pintado del home lo saca. */
  const repintar = (): void => {
    const el = deps.content.querySelector<HTMLElement>("#ts-error");
    if (!el) return;
    // Por GRAVEDAD, no por orden de llegada, y con el titular separado del
    // detalle: los dos iban en el mismo color y cuerpo, así que el cosmético
    // gritaba igual que «no se puede dibujar el mundo» y encima salía antes
    // por llegar antes (QA de T9, H-7). `data-aviso` es el titular, para que
    // el candado afirme CUÁL se lee y cuántos hay.
    const pegajosos = avisosDelJugador
      .map(
        (a) =>
          `<div data-aviso="${escapeHtml(a.titulo)}" style="margin-bottom:8px;line-height:1.45">` +
          `<strong style="color:#c55">${escapeHtml(a.titulo)}</strong>` +
          `<span style="display:block;color:#8a7f7f;font-size:12px">${escapeHtml(a.mensaje)}</span>` +
          `</div>`,
      )
      .join("");
    const accion = avisoDeAccion
      ? `<span style="color:${avisoDeAccion.tono === "error" ? "#a44" : "#8a8"}">` +
        `${escapeHtml(avisoDeAccion.motivo)}</span>`
      : "";
    el.innerHTML = pegajosos + accion;
    el.style.display = pegajosos || accion ? "" : "none";
  };

  /** El título deja de afirmar que la lista está al día cuando el socket que
   *  la trajo acaba de fallar. Las tarjetas se quedan: siguen sirviendo. */
  const caducarEstadoDeSaves = (): void => {
    const el = deps.content.querySelector<HTMLElement>("#ts-status");
    if (!el || !(el.textContent ?? "").startsWith("Bridge OK")) return;
    el.textContent = "Esta lista es de antes del fallo: puede que ya no esté al día.";
    el.style.color = "#888";
  };

  return {
    /** Un aviso del registro de errores (#306): algo se rompió SOLO y el
     *  jugador tiene que enterarse por el título, no por un panel que el
     *  interruptor de #246 mantiene apagado. Lo llama el ÚNICO suscriptor de
     *  `errors.onAviso` (main.ts), y es idempotente por título: el mismo fallo
     *  refresca su detalle en su sitio en vez de apilar una copia. */
    avisar(aviso: AvisoAlJugador): void {
      avisosDelJugador = encajarAviso(avisosDelJugador, aviso);
      // «Bridge OK — N partidas» describe una lectura anterior a la caída: se
      // retira aquí para que la pantalla no diga dos cosas contrarias A LA VEZ.
      if (aviso.source === "bridge") caducarEstadoDeSaves();
      repintar();
    },
    /** El fallo de `source` se ha resuelto: sus avisos se van de la pantalla.
     *  La otra mitad de `avisar`, y la que impide que un aviso sea eterno. */
    retirar(source: string): void {
      avisosDelJugador = avisosDelJugador.filter((a) => a.source !== source);
      repintar();
    },
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
    mostrarAccion(motivo: string, tono: "error" | "aviso" = "error"): void {
      avisoDeAccion = { motivo, tono };
      repintar();
    },
    /** Descarta el motivo de la última acción. NO repinta, igual que el
     *  `avisoDeAccion = null` que sustituye: el home decide justo después si
     *  escribe un motivo nuevo o si solo repinta lo pegajoso, y adelantar ese
     *  pintado sería un repintado de más metido de contrabando dentro de un
     *  movimiento. */
    limpiarAccion(): void {
      avisoDeAccion = null;
    },
    repintar,
  };
}
