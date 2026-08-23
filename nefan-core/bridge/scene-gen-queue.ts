/** Cola de generación de escenas/tiles — el motor narrativo (vía MCP) solo
 *  atiende UNA petición a la vez, así que la serialización vive aquí.
 *
 *  FIFO con dedupe por key y dos prioridades: los jobs `blocking` (el jugador
 *  está esperando pegado a un borde) van antes que los `prefetch`; un prefetch
 *  ya encolado que vuelve a llegar como blocking se PROMUEVE. El drenado es
 *  resistente a errores: cada `run` captura y difunde su propio
 *  `narrative_status: error` (contrato del caller); si aun así lanza, la cola
 *  lo loguea y sigue drenando. Sustituye al viejo single-flight con drop
 *  (que perdía prefetches). Clase pura, testeable sin sockets.
 *
 *  Todo `enqueue` devuelve además una promesa de ENTREGA por key: es la
 *  garantía de que alguien se entera de cómo acabó el job, incluido el caller
 *  que recibió "duplicate" (que no corre nada y confía en el gemelo) y el que
 *  encoló un job que `abandonAll` borró antes de que corriera. Sin ella, un
 *  takeover dejaba viajes muertos sin escena y sin error. */

/** Lo que un job DEBE declarar al terminar: si le dijo algo al cliente o no.
 *
 *  Que el job termine y que el cliente se entere son cosas distintas, y
 *  confundirlas costó el cuelgue del issue #210 dos veces: la primera con
 *  `abandonAll` borrando jobs en silencio, la segunda con `return` mudos
 *  DENTRO del job («el lugar se realizó mientras esperaba en la cola»), que
 *  resolvían la entrega en verde sin difundir escena, spawn ni error — misma
 *  firma, velo eterno.
 *
 *  Por eso el tipo de retorno NO es `void`: un `return;` suelto en un `run`
 *  no compila, así que el tercer camino mudo de mañana falla en `tsc` y no
 *  en la cara del jugador tres meses después. */
export type SceneGenOutcome =
  /** Difundí lo que el cliente esperaba (escena, spawn o error). */
  | { delivered: true }
  /** Terminé sin decirle NADA al cliente: alguien tiene que hacerlo por mí. */
  | { delivered: false; motivo: string };

export interface SceneGenJob {
  key: string;
  blocking: boolean;
  run: () => Promise<SceneGenOutcome>;
}

/** Resultado de ENTREGA de un job: `ok:false` = NO llegó a correr (la cola lo
 *  abandonó), lanzó, o terminó declarando que no difundió nada. RESUELVE
 *  siempre, nunca rechaza: un caller que no espere la entrega no puede tumbar
 *  el bridge con un unhandledRejection, y el que sí la espera decide qué
 *  difundir. `ok:true` significa «el cliente ya lo sabe», no «la función
 *  volvió». */
export type SceneGenDelivery = { ok: true } | { ok: false; error: string };

/** Lo que devuelve `enqueue`: cómo se encoló y la promesa de ENTREGA de esa
 *  key. Los tres estados comparten promesa — el caller que recibe "duplicate"
 *  se cuelga de la del gemelo, que es lo que convierte "ya lo hará otro" en
 *  un contrato verificable en vez de una esperanza. */
export interface SceneGenEnqueued {
  status: "queued" | "duplicate" | "promoted";
  delivery: Promise<SceneGenDelivery>;
}

/** Promesa de entrega con su resolutor a mano (se cierra desde `drain` o
 *  desde `abandonAll`, no desde el job). */
function makeDelivery(): { promise: Promise<SceneGenDelivery>; settle: (r: SceneGenDelivery) => void } {
  let settle!: (r: SceneGenDelivery) => void;
  const promise = new Promise<SceneGenDelivery>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

type QueuedJob = SceneGenJob & { seq: number; delivery: ReturnType<typeof makeDelivery> };

export class SceneGenQueue {
  private queue: QueuedJob[] = [];
  private inFlight: QueuedJob | null = null;
  private seq = 0;

  /** Encola un job. "duplicate" = ya en vuelo o en cola (posiblemente
   *  "promoted" si el existente era prefetch y este es blocking); en los dos
   *  casos la `delivery` devuelta es la del job que SÍ va a correr. */
  enqueue(job: SceneGenJob): SceneGenEnqueued {
    if (this.inFlight?.key === job.key) {
      return { status: "duplicate", delivery: this.inFlight.delivery.promise };
    }
    const existing = this.queue.find((j) => j.key === job.key);
    if (existing) {
      const delivery = existing.delivery.promise;
      if (job.blocking && !existing.blocking) {
        existing.blocking = true;
        this.sort();
        return { status: "promoted", delivery };
      }
      return { status: "duplicate", delivery };
    }
    const entry: QueuedJob = { ...job, seq: this.seq++, delivery: makeDelivery() };
    this.queue.push(entry);
    this.sort();
    this.drain();
    return { status: "queued", delivery: entry.delivery.promise };
  }

  /** Key del job en vuelo, o null. */
  get current(): string | null {
    return this.inFlight?.key ?? null;
  }

  /** Abandona la generación de la sesión saliente (takeover de sesión):
   *  vacía la cola y desancla la key del job en vuelo — su await no se puede
   *  cancelar, pero deja de contar para el dedupe, así el job equivalente de
   *  la sesión entrante encola DETRÁS (serialización intacta: el motor solo
   *  atiende una petición a la vez). El resultado tardío del job abandonado
   *  lo descarta su propia guardia de sesión (sessionChangedError).
   *
   *  Los jobs que BORRA no van a correr nunca, así que su entrega se cierra
   *  en `ok:false`: sin esto, quien los esperaba (incluido el caller que
   *  recibió "duplicate") se quedaba esperando para siempre, sin escena y sin
   *  error — el cuelgue del viaje del issue #210. El job en vuelo no se borra:
   *  sigue corriendo y entregará por su cuenta. */
  abandonAll(): void {
    const abandonados = this.queue.splice(0);
    if (this.inFlight) this.inFlight.key = `__abandonado__${this.seq++}`;
    for (const j of abandonados) {
      j.delivery.settle({ ok: false, error: `generación "${j.key}" abandonada antes de correr` });
    }
  }

  /** Keys pendientes (sin contar el job en vuelo), en orden de despacho. */
  get pending(): string[] {
    return this.queue.map((j) => j.key);
  }

  private sort(): void {
    this.queue.sort((a, b) => (Number(b.blocking) - Number(a.blocking)) || a.seq - b.seq);
  }

  private drain(): void {
    if (this.inFlight || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.inFlight = job;
    job
      .run()
      .then((outcome) =>
        job.delivery.settle(
          outcome.delivered ? { ok: true } : { ok: false, error: outcome.motivo },
        ),
      )
      .catch((err) => {
        // El run debe difundir su propio error; esto es el último recurso
        // para que un throw inesperado no pare la cola.
        console.warn(`SceneGenQueue: job "${job.key}" lanzó sin capturar:`, err);
        job.delivery.settle({ ok: false, error: (err as Error)?.message ?? String(err) });
      })
      .finally(() => {
        this.inFlight = null;
        this.drain();
      });
  }
}
