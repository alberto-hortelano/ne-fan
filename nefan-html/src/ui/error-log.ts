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
  /** La fuente del registro que lo emitió: `bridge`, `sprite`, `render`… */
  source: string;
  /** El titular, en español y para quien juega. */
  titulo: string;
  /** El detalle, que es EXACTAMENTE el `message` de la entrada del registro. */
  mensaje: string;
}

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

/** Lo que un `push` puede declarar además del error. */
export interface OpcionesDePush {
  /** El titular con el que este error llega a la pantalla del jugador. Sin
   *  él, el error solo entra en el registro — que es el caso de las 50 y pico
   *  llamadas restantes, y está bien: la mayoría cuelga de algo que el jugador
   *  acaba de pulsar y ya tiene respuesta en pantalla. */
  alJugador?: string;
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
  private suscriptor: ((aviso: AvisoAlJugador) => void) | null = null;
  /** Los avisos emitidos ANTES de que `main.ts` se suscriba. No es una
   *  optimización: los tres fallos que #306 persigue —el chunk de three.js,
   *  las hojas base, el socket— saltan durante la evaluación del módulo, o sea
   *  antes de que exista el título al que avisar. Sin esta cola, el aviso que
   *  llega primero es justo el que se pierde. */
  private pendientes: AvisoAlJugador[] = [];
  /** Los avisos ya notificados, por (fuente, titulo, mensaje). `bridge-client`
   *  reintenta cada 5 s con el MISMO texto: sin esto, el aviso se repite para
   *  siempre y el muro que el jugador cerró vuelve solo cada cinco segundos. */
  private yaAvisados = new Set<string>();

  attach(el: HTMLElement): void {
    this.container = el;
    this.render();
  }

  /** Registra el único suscriptor de avisos y le entrega la cola pendiente.
   *
   *  LANZA si ya había uno: dos pintores del mismo aviso son dos verdades, y
   *  eso tiene que ser inexpresable, no una convención. */
  onAviso(cb: (aviso: AvisoAlJugador) => void): void {
    if (this.suscriptor) {
      throw new Error(
        "ErrorLog.onAviso: ya hay un suscriptor de avisos. El aviso al jugador tiene UN " +
          "pintor (main.ts), que decide dónde según el estado de la pantalla.",
      );
    }
    this.suscriptor = cb;
    const cola = this.pendientes;
    this.pendientes = [];
    for (const aviso of cola) cb(aviso);
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
      this.avisa({ source, titulo: opts.alJugador, mensaje: message });
    }
  }

  /** Al suscriptor si lo hay, a la cola si todavía no. Idempotente por el
   *  trío exacto: el mismo fallo repitiéndose no es una noticia nueva. */
  private avisa(aviso: AvisoAlJugador): void {
    // La clave va por JSON y no por un separador mágico: un titular que
    // contuviera el separador colapsaría dos avisos distintos en uno.
    const clave = JSON.stringify([aviso.source, aviso.titulo, aviso.mensaje]);
    if (this.yaAvisados.has(clave)) return;
    this.yaAvisados.add(clave);
    if (this.suscriptor) this.suscriptor(aviso);
    else this.pendientes.push(aviso);
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
