/** Side panel that piles up every error the client sees, with timestamp and
 *  source tag. Non-blocking: the canvas keeps rendering. Lives in the
 *  right-hand column declared in index.html as <div id="error-log">.
 *
 *  Use the exported `errors` singleton from anywhere:
 *
 *      try { ... }
 *      catch (err) { errors.push("sprite", `${key}: ${err}`, err); throw err; }
 *
 *  Filosofía: nunca se hace un fallback silencioso. Si algo falla aquí queda
 *  registro y el flujo se interrumpe. */

export interface ErrorEntry {
  source: string;
  message: string;
  ts: number;
  detail?: string;
}

/** Un error que además merece la PANTALLA de quien juega (#306).
 *
 *  NO es una segunda redacción del error: es el `message` de la MISMA entrada
 *  del registro, con un titular que el emisor eligió en la misma llamada. Por
 *  eso no pueden divergir — que es lo que pedía el issue al decir «que lo
 *  alimente el mismo `errors.push` para no tener dos verdades». Quien pinta es
 *  otro y decide DÓNDE según el estado de la pantalla; lo QUE se dice se
 *  decidió aquí, una vez.
 *
 *  El `titulo` es además la unidad de agregación: dos fallos de la misma
 *  familia (diez hojas de personaje que no llegan, un socket que reintenta
 *  cada cinco segundos) son UNA noticia para quien juega, y se cuentan por su
 *  título. El registro sigue guardándolos todos. */
export interface AvisoAlJugador {
  /** La fuente del registro que lo emitió: `bridge`, `sprite`, `render`… Es
   *  también la unidad de RETIRADA: cuando esa fuente demuestra que vuelve a
   *  funcionar, sus avisos se van (`resuelto`). */
  source: string;
  /** El titular, en español y para quien juega. */
  titulo: string;
  /** El detalle: el `message` de la entrada del registro, salvo que el emisor
   *  haya declarado `detalleAlJugador` porque ese `message` no era para el
   *  jugador. */
  mensaje: string;
}

/** Lo que le pasa al pintor de avisos. Dos hechos, no uno: un aviso puede
 *  APARECER y puede DEJAR DE SER CIERTO, y sin el segundo un aviso vive para
 *  siempre y acaba contradiciendo a la propia pantalla que lo enseña. */
export type EventoDeAviso =
  | { tipo: "aviso"; aviso: AvisoAlJugador }
  | { tipo: "resuelto"; source: string };

/** Los titulares con los que un fallo llega a la pantalla de quien juega.
 *
 *  Viven aquí, con el tipo, y no en cada emisor, porque el título es la unidad
 *  de agregación: dos emisores de la MISMA familia tienen que escribir el
 *  mismo texto o dejan de colapsar en un aviso. `main.ts` y `sprite-renderer`
 *  comparten `AVISO_PERSONAJES` por eso, no por comodidad — una hoja que no
 *  llega y el recuento de las que faltan son la misma noticia.
 *
 *  Son texto de producto: dicen qué está roto PARA EL JUGADOR, no dónde se
 *  rompió. El «dónde» va en el `message`, que es el detalle que se lee debajo. */
export const AVISO_MUNDO = "No se puede dibujar el mundo";
export const AVISO_PERSONAJES = "Los personajes van sin vestir";
export const AVISO_PARTIDA = "Sin conexión con la partida";
export const AVISO_TRAMA_ILEGIBLE = "La partida respondió algo que no se entiende";

/** Los titulares de MÁS a MENOS grave, y la lista ES el criterio: sin mundo no
 *  hay juego; sin socket no hay partida; una trama ilegible rompe lo que se
 *  pidió pero el resto sigue; ir sin vestir es cosmético — se juega igual, con
 *  maniquíes.
 *
 *  Existe porque el orden de LLEGADA no es el de gravedad y se notaba: el
 *  cosmético llega el primero (las hojas fallan a los 130 ms) y empujaba «no se
 *  puede dibujar el mundo» al medio, con el mismo color y el mismo cuerpo. Y
 *  porque el tope de la pantalla tenía que descartar por algo: descartaba el
 *  más viejo, que es justo el más grave. */
export const AVISOS_POR_GRAVEDAD: readonly string[] = [
  AVISO_MUNDO,
  AVISO_PARTIDA,
  AVISO_TRAMA_ILEGIBLE,
  AVISO_PERSONAJES,
];

/** Cuanto MENOR, más grave. Un titular que no esté en la lista va al final:
 *  es lo honesto —no sabemos cuánto pesa— y no rompe el orden de los que sí. */
export function gravedadDelAviso(titulo: string): number {
  const i = AVISOS_POR_GRAVEDAD.indexOf(titulo);
  return i === -1 ? AVISOS_POR_GRAVEDAD.length : i;
}

/** Cuántos avisos caben a la vez en el hueco del título. Tres, y no «todos»:
 *  esa pantalla no es el registro de errores —ese sigue entero en
 *  `#error-log`— y una lista larga de líneas rojas se deja de leer, que es el
 *  mismo modo de fallo que tenía guardar UNA sola. */
export const MAX_AVISOS = 3;

/** Mete `aviso` en la lista que el título tiene en pantalla, con las dos
 *  reglas que la hacen legible: **uno por titular** —el que vuelve refresca su
 *  detalle en su sitio en vez de apilar una copia, que es lo que impide que
 *  diez hojas caídas sean diez avisos— y **como mucho `MAX_AVISOS`**,
 *  descartando el menos grave. Sale ORDENADA por gravedad.
 *
 *  Pura y aquí, con el tipo y la gravedad, en vez de dentro del título: es
 *  decisión de qué se enseña, no de cómo se pinta, y `title-screen.ts` es uno
 *  de los ficheros que #346 quiere trocear. */
export function encajarAviso(
  lista: readonly AvisoAlJugador[],
  aviso: AvisoAlJugador,
): AvisoAlJugador[] {
  const conocido = lista.some((a) => a.titulo === aviso.titulo);
  const con = conocido
    ? lista.map((a) => (a.titulo === aviso.titulo ? { ...a, mensaje: aviso.mensaje } : a))
    : [...lista, aviso];
  const ordenados = [...con].sort(
    (a, b) => gravedadDelAviso(a.titulo) - gravedadDelAviso(b.titulo),
  );
  // El que sobra es el ÚLTIMO de ese orden: el menos grave. Descartar el más
  // viejo se llevaba justo el peor, porque el cosmético llega antes.
  return ordenados.slice(0, MAX_AVISOS);
}

/** Lo que un `push` puede declarar además del error. */
export interface OpcionesDePush {
  /** El titular con el que este error llega a la pantalla del jugador. Sin
   *  él, el error solo entra en el registro — que es el caso de las 50 y pico
   *  llamadas restantes, y está bien: la mayoría cuelga de algo que el jugador
   *  acaba de pulsar y ya tiene respuesta en pantalla. */
  alJugador?: string;
  /** El detalle que lee el JUGADOR, para cuando el `message` del registro está
   *  escrito para quien programa y no se puede cambiar: el del set base
   *  nombra `docs/assets-de-personaje.md` porque el guion 13 lo exige (#255).
   *
   *  No es una segunda redacción a mano: sale de `motivoDeSesionParaElJugador`
   *  —el traductor de core, probado y medido por mutación—, o sea de una
   *  FUNCIÓN del mismo error que se está registrando. Sin él, el detalle es el
   *  `message`, que es el caso normal y el que conserva la una-sola-verdad
   *  literal. */
  detalleAlJugador?: string;
}

const SOURCE_COLORS: Record<string, string> = {
  bridge: "#d9a14a",
  narrative: "#c46a8a",
  sprite: "#7ac08a",
  player: "#a08aff",
  session: "#e36b6b",
  scene: "#69b6d9",
  config: "#bdbd5e",
  title: "#5fc9c0",
};

const MAX_ENTRIES = 200;

export class ErrorLog {
  private entries: ErrorEntry[] = [];
  private container: HTMLElement | null = null;
  /** El ÚNICO suscriptor de avisos, registrado por `main.ts`. Uno, y el tipo
   *  lo defiende: con dos, el mismo fallo se pintaría dos veces y la «una sola
   *  verdad» de #306 quedaría en una promesa que nadie puede romper en verde. */
  private suscriptor: ((e: EventoDeAviso) => void) | null = null;
  /** Los eventos emitidos ANTES de que `main.ts` se suscriba: los fallos que
   *  #306 persigue pueden saltar antes de que exista el pintor. */
  private pendientes: EventoDeAviso[] = [];
  /** Los avisos ya notificados, por (fuente, titulo, mensaje). `bridge-client`
   *  reintenta cada 5 s con el MISMO texto: sin esto, el aviso se repite para
   *  siempre y el muro que el jugador cerró vuelve solo cada cinco segundos.
   *  `resuelto` lo olvida por fuente, para que un fallo que VUELVE vuelva a
   *  avisar. */
  private yaAvisados = new Set<string>();
  /** Fuentes con algún aviso vivo. Solo existe para que `resuelto` —que se
   *  llama en el camino caliente, una vez por trama del socket— salga sin
   *  hacer nada cuando no hay nada que retirar. */
  private fuentesConAviso = new Set<string>();

  attach(el: HTMLElement): void {
    this.container = el;
    this.render();
  }

  /** Registra el único suscriptor de avisos y le entrega la cola pendiente.
   *
   *  LANZA si ya había uno: dos pintores del mismo aviso son dos verdades, y
   *  eso tiene que ser inexpresable, no una convención. */
  onAviso(cb: (e: EventoDeAviso) => void): void {
    if (this.suscriptor) {
      throw new Error(
        "ErrorLog.onAviso: ya hay un suscriptor de avisos. El aviso al jugador tiene UN " +
          "pintor (main.ts), que decide dónde según el estado de la pantalla.",
      );
    }
    this.suscriptor = cb;
    const cola = this.pendientes;
    this.pendientes = [];
    for (const e of cola) this.entrega(e);
  }

  push(source: string, message: string, err?: unknown, opts?: OpcionesDePush): void {
    const ts = Date.now();
    let detail: string | undefined;
    if (err instanceof Error) detail = err.stack ?? err.message;
    else if (err !== undefined) {
      try { detail = JSON.stringify(err); } catch { detail = String(err); }
    }
    this.entries.push({ source, message, ts, detail });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    console.error(`[${source}] ${message}`, err ?? "");
    this.render();
    if (opts?.alJugador !== undefined) {
      this.avisa({
        source,
        titulo: opts.alJugador,
        mensaje: opts.detalleAlJugador ?? message,
      });
    }
  }

  /** La causa de los avisos de `source` se ha DEMOSTRADO resuelta: se retiran
   *  de la pantalla y se olvida que ya se avisó, para que un fallo que vuelva
   *  vuelva a avisar.
   *
   *  Lo llama quien puede demostrarlo, y demostrar es la palabra: no vale un
   *  temporizador ni «ya han pasado cosas». `bridge-client` lo llama cuando el
   *  socket abre y cuando entiende una trama, que es exactamente lo contrario
   *  de lo que hizo saltar sus dos avisos.
   *
   *  Sin esto un aviso es ETERNO, y un aviso eterno acaba contradiciendo a la
   *  propia pantalla que lo enseña: «Bridge OK — 1 partidas guardadas» debajo
   *  de «la partida respondió algo que no se entiende» (QA de T9, H-3). Las dos
   *  verdades que el issue prohíbe, separadas en el tiempo en vez de en el
   *  texto. Las fuentes que NO tienen forma de recuperarse (el chunk de
   *  three.js, las hojas base) no lo llaman nunca, y hacen bien: su aviso sigue
   *  siendo cierto hasta que se recargue la página. */
  resuelto(source: string): void {
    if (!this.fuentesConAviso.has(source)) return;
    this.fuentesConAviso.delete(source);
    for (const clave of this.yaAvisados) {
      if ((JSON.parse(clave) as string[])[0] === source) this.yaAvisados.delete(clave);
    }
    this.entrega({ tipo: "resuelto", source });
  }

  /** Al suscriptor si lo hay, a la cola si todavía no. Idempotente por el
   *  trío exacto: el mismo fallo repitiéndose no es una noticia nueva. */
  private avisa(aviso: AvisoAlJugador): void {
    // La clave va por JSON y no por un separador mágico: un titular que
    // contuviera el separador colapsaría dos avisos distintos en uno.
    const clave = JSON.stringify([aviso.source, aviso.titulo, aviso.mensaje]);
    if (this.yaAvisados.has(clave)) return;
    this.yaAvisados.add(clave);
    this.fuentesConAviso.add(aviso.source);
    this.entrega({ tipo: "aviso", aviso });
  }

  /** SIEMPRE en una microtarea, y esa es toda la gracia.
   *
   *  El pintor vive en `main.ts` y toca cosas que ese módulo declara MÁS ABAJO
   *  que el punto donde se suscribe (`loaderEl`). Entregar en el mismo turno
   *  síncrono significaba que el día que alguien etiquetara un `push` que
   *  ocurre durante la evaluación del módulo —que es justo lo que la cola de
   *  pendientes invita a hacer— el cliente moría con un `ReferenceError` de
   *  zona muerta temporal: sin hook, sin título, página en blanco. Medido por
   *  QA con una sonda (T9, H-5).
   *
   *  Aplazar un tick lo hace IMPOSIBLE en vez de improbable: cuando la
   *  microtarea corre, el módulo ha terminado de evaluarse entero. El orden
   *  entre eventos se conserva (las microtareas son FIFO), y va por el mismo
   *  camino haya suscriptor o no: dos caminos serían dos comportamientos. */
  private entrega(e: EventoDeAviso): void {
    if (!this.suscriptor) {
      this.pendientes.push(e);
      return;
    }
    const cb = this.suscriptor;
    queueMicrotask(() => cb(e));
  }

  /** Vacía el PANEL. No toca `yaAvisados` a propósito: limpiar la lista no
   *  arregla lo que se rompió, así que un fallo que sigue ocurriendo no vuelve
   *  a saltar a la pantalla del jugador por haber barrido el registro. */
  clear(): void {
    this.entries = [];
    this.render();
  }

  count(): number {
    return this.entries.length;
  }

  private render(): void {
    const el = this.container;
    if (!el) return;
    if (this.entries.length === 0) {
      el.innerHTML = `<div class="error-log__empty">— sin errores —</div>`;
      return;
    }
    const items = this.entries
      .slice()
      .reverse()
      .map((e) => this.renderEntry(e))
      .join("");
    el.innerHTML = `<div class="error-log__header">Errores (${this.entries.length})</div>${items}`;
    el.scrollTop = 0;
  }

  private renderEntry(e: ErrorEntry): string {
    const time = new Date(e.ts).toLocaleTimeString();
    const color = SOURCE_COLORS[e.source] ?? "#bbb";
    const detail = e.detail
      ? `<pre class="error-log__detail">${escapeHtml(e.detail)}</pre>`
      : "";
    return `
      <div class="error-log__entry">
        <div class="error-log__meta">
          <span class="error-log__source" style="color:${color}">${escapeHtml(e.source)}</span>
          <span class="error-log__time">${time}</span>
        </div>
        <div class="error-log__msg">${escapeHtml(e.message)}</div>
        ${detail}
      </div>
    `;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const errors = new ErrorLog();
