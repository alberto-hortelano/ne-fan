/** Episodios de TILE: lo que el juego recuerda de cada tile del plano continuo
 *  que ha pedido, desde que lo pidió hasta que llegó.
 *
 *  Existe por el mismo motivo que el ledger de viaje: esperar a que aparezca un
 *  tile es esperar a algo que puede no llegar nunca, y un tope de reloj no sabe
 *  distinguir «va lento» de «murió». Aquí queda escrito qué se pidió, qué llegó
 *  y —lo que ninguna espera podía saber— **de dónde salió**: `engine` (el motor
 *  lo generó y el bridge lo rasterizó ahora), `cache` (ya estaba en la sesión) o
 *  `snapshot` (venía horneado en el mundo pre-generado).
 *
 *  Ese `source` tapa un agujero de detección real: el guion que dice comprobar
 *  que la rasterización sigue viva no podía distinguir un tile recién
 *  rasterizado de uno servido de caché, así que pasaba igual con la
 *  rasterización muerta. */

export interface TileEpisodio {
  key: string;
  /** Reloj de la página (ms) cuando el cliente lo pidió, o null si nunca lo
   *  pidió (el bootstrap y los tiles del snapshot llegan sin petición). */
  requested: number | null;
  /** Reloj de la página (ms) cuando llegó su escena. */
  arrived: number | null;
  /** Lo que declara el bridge. null hasta que llega. */
  source: "engine" | "cache" | "snapshot" | null;
  /** Motivo del último error difundido para este tile, o null. */
  error: string | null;
}

export class TileLedger {
  private eps = new Map<string, TileEpisodio>();

  private of(key: string): TileEpisodio {
    let e = this.eps.get(key);
    if (!e) {
      e = { key, requested: null, arrived: null, source: null, error: null };
      this.eps.set(key, e);
    }
    return e;
  }

  /** El cliente pidió el tile al bridge (frontier: prefetch o blocking). */
  pedido(key: string): void {
    const e = this.of(key);
    // Re-petición tras un error: episodio nuevo, no un eco del anterior.
    if (e.arrived !== null || e.error !== null) {
      this.eps.set(key, { key, requested: null, arrived: null, source: null, error: null });
    }
    this.of(key).requested = Math.round(performance.now());
  }

  /** Llegó su escena, y el bridge dice de dónde. */
  llegado(key: string, source: TileEpisodio["source"]): void {
    const e = this.of(key);
    e.arrived = Math.round(performance.now());
    e.source = source;
    e.error = null;
  }

  fallo(key: string, message: string): void {
    this.of(key).error = message;
  }

  /** Estado para el hook __nefan / guiones de QA. */
  debugState(): TileEpisodio[] {
    return [...this.eps.values()].map((e) => ({ ...e }));
  }

  episodio(key: string): TileEpisodio | null {
    const e = this.eps.get(key);
    return e ? { ...e } : null;
  }
}
