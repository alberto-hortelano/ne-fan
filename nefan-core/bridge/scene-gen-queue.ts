/** Cola de generación de escenas/tiles — el motor narrativo (vía MCP) solo
 *  atiende UNA petición a la vez, así que la serialización vive aquí.
 *
 *  FIFO con dedupe por key y dos prioridades: los jobs `blocking` (el jugador
 *  está esperando pegado a un borde) van antes que los `prefetch`; un prefetch
 *  ya encolado que vuelve a llegar como blocking se PROMUEVE. El drenado es
 *  resistente a errores: cada `run` captura y difunde su propio
 *  `narrative_status: error` (contrato del caller); si aun así lanza, la cola
 *  lo loguea y sigue drenando. Sustituye al viejo single-flight con drop
 *  (que perdía prefetches). Clase pura, testeable sin sockets. */

export interface SceneGenJob {
  key: string;
  blocking: boolean;
  run: () => Promise<void>;
}

export class SceneGenQueue {
  private queue: (SceneGenJob & { seq: number })[] = [];
  private inFlight: SceneGenJob | null = null;
  private seq = 0;

  /** Encola un job. "duplicate" = ya en vuelo o en cola (posiblemente
   *  "promoted" si el existente era prefetch y este es blocking). */
  enqueue(job: SceneGenJob): "queued" | "duplicate" | "promoted" {
    if (this.inFlight?.key === job.key) return "duplicate";
    const existing = this.queue.find((j) => j.key === job.key);
    if (existing) {
      if (job.blocking && !existing.blocking) {
        existing.blocking = true;
        this.sort();
        return "promoted";
      }
      return "duplicate";
    }
    this.queue.push({ ...job, seq: this.seq++ });
    this.sort();
    this.drain();
    return "queued";
  }

  /** Key del job en vuelo, o null. */
  get current(): string | null {
    return this.inFlight?.key ?? null;
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
      .catch((err) => {
        // El run debe difundir su propio error; esto es el último recurso
        // para que un throw inesperado no pare la cola.
        console.warn(`SceneGenQueue: job "${job.key}" lanzó sin capturar:`, err);
      })
      .finally(() => {
        this.inFlight = null;
        this.drain();
      });
  }
}
