/** Ledger de VIAJE: lo que el juego RECUERDA del último viaje pedido desde el
 *  panel «Salidas», paso a paso.
 *
 *  Existe porque un viaje que no llega es hoy indistinguible de uno lento: el
 *  cliente se queda mirando un `currentTile` que puede no cambiar nunca y lo
 *  único que sabe decir —en la consola o en el guion 09 de QA— es «timeout».
 *  Con esto se sabe QUÉ paso está muerto: si el viaje llegó a pedirse, si el
 *  bridge lo acusó y cómo lo encoló (`duplicate` = está esperando a un job
 *  gemelo, que es donde vivía el cuelgue del issue #210), si la escena del
 *  destino se difundió y si el spawn llegó a aplicarse.
 *
 *  Mismo patrón que `fps().telegraphEpisode`: sobrevive al episodio, así que
 *  se puede afirmar sobre él DESPUÉS. Y lo escribe el mismo camino que hace el
 *  viaje —el handler de status y el de escena, no un observador paralelo—:
 *  un ledger alimentado por otra vía se pondría verde solo. */

export interface ViajeRegistro {
  /** Lugar del world map al que se pidió viajar. */
  placeId: string;
  /** Reloj de la página (ms) en que el cliente mandó `player_entered_place`. */
  pedido: number;
  /** Cómo lo encoló el bridge, tal como lo declaró. null = no acusó recibo. */
  encolado: "queued" | "duplicate" | "promoted" | null;
  /** scene_id de la escena del destino, difundida por el bridge. */
  escenaRecibida: string | null;
  /** Punto de aparición que el cliente APLICÓ (metros mundo). */
  spawnAplicado: { x: number; z: number } | null;
  /** Mensaje del `narrative_status: error` que abortó el viaje. */
  error: string | null;
}

export class TravelLedger {
  private cur: ViajeRegistro | null = null;

  /** El jugador pulsó una salida y el cliente se lo pidió al bridge. Abre un
   *  registro nuevo: el anterior ya sirvió para lo que servía. */
  pedido(placeId: string): void {
    this.cur = {
      placeId,
      pedido: Math.round(performance.now()),
      encolado: null,
      escenaRecibida: null,
      spawnAplicado: null,
      error: null,
    };
  }

  /** El bridge acusó el viaje y dijo cómo entró en su cola de generación. */
  encolado(placeId: string, enqueued: "queued" | "duplicate" | "promoted"): void {
    if (!this.abierto(placeId)) return;
    this.cur!.encolado = enqueued;
  }

  /** Llegó una escena mientras el viaje estaba en curso. Solo cuenta la del
   *  DESTINO: el tile realizado de un place lleva su `place_id` (lo fija el
   *  bridge, no el motor), así que un prefetch que aterrice a la vez no puede
   *  hacer pasar por buena una escena que no es. */
  escena(sceneId: string, placeId: string | undefined): void {
    if (!placeId || !this.abierto(placeId)) return;
    this.cur!.escenaRecibida = sceneId;
  }

  /** El cliente movió al jugador al punto que pidió el bridge: el viaje llegó. */
  spawn(pos: { x: number; z: number }): void {
    if (!this.cur || this.cerrado(this.cur)) return;
    this.cur.spawnAplicado = { x: pos.x, z: pos.z };
  }

  /** Un error del motor mientras el viaje estaba en curso. Sin `placeId` en el
   *  status (los errores de tile no lo llevan: el viaje se genera COMO tile)
   *  se atribuye al viaje abierto — es la causa candidata y decirlo vale más
   *  que callarlo. */
  fallo(placeId: string | undefined, message: string): void {
    if (!this.cur || this.cerrado(this.cur)) return;
    if (placeId && placeId !== this.cur.placeId) return;
    this.cur.error = message;
  }

  /** Estado para el hook __nefan / guiones de QA. */
  debugState(): ViajeRegistro | null {
    return this.cur ? { ...this.cur } : null;
  }

  /** Un viaje entregado (o roto) ya no acepta escritura: lo que venga después
   *  es de otra cosa. */
  private cerrado(reg: ViajeRegistro): boolean {
    return reg.spawnAplicado !== null || reg.error !== null;
  }

  private abierto(placeId: string): boolean {
    return this.cur !== null && this.cur.placeId === placeId && !this.cerrado(this.cur);
  }
}
