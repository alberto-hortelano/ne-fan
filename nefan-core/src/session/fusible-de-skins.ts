/** EL FUSIBLE DE LOS SKINS IA: cuántos PERSONAJES distintos tienen que fallar
 *  con error de backend antes de apagar los skins de la sesión entera.
 *
 *  Eran una constante, un flag y un `Set` dentro del manager de sprites del
 *  cliente, sin nada que pudiera ponerse rojo salvo dos guiones de navegador.
 *  Es regla de GASTO: contra una tormenta de peticiones que fallan todas —y,
 *  contra un sprite-forge sin actualizar, que se PAGAN todas antes de fallar—
 *  este fusible es lo único que hay. Apagaba a la PRIMERA (#236): un 500 de un
 *  solo personaje devolvía al jugador el mundo de maniquíes idénticos que #173
 *  vino a arreglar, sin salida salvo recargar. Tres personajes distintos
 *  fallando ya no es mala suerte: es el backend. Uno, sí puede serlo.
 *
 *  Se cuentan PERSONAJES y no fallos: un mismo personaje puede fallar en
 *  varias anims (las de combate se piden perezosamente) y eso sigue siendo una
 *  sola evidencia sobre el estado del backend. Y solo cuentan los fallos de
 *  BACKEND —red caída (sin status) o 5xx—: un 4xx habla de la petición, no del
 *  servicio, y no gasta evidencia.
 *
 *  Aquí no hay fetch ni pintado: el manager del cliente conserva eso, le cuenta
 *  cada fallo y hace lo que el fusible le diga. */

/** Cuántos personajes distintos con fallo de backend apagan la sesión. */
export const UMBRAL_APAGADO_DE_SESION = 3;

export class FusibleDeSkins {
  #apagado = false;
  /** Los personajes (por su clave de skin) que ya fallaron con error de
   *  backend. Es lo que cuenta contra el umbral. */
  #caidos = new Set<string>();

  /** Un skin de `personaje` falló. `status` es el HTTP de la respuesta;
   *  `undefined` = no hubo respuesta (red caída, servicio sin arrancar).
   *
   *  "ignorar" = error de la petición (4xx): no dice nada del backend y no se
   *  anota. "cuenta" = evidencia anotada; la sesión sigue pidiendo (o ya estaba
   *  apagada y este es un fallo en vuelo que llega tarde). "apagar" = con ESTE
   *  personaje se alcanza el umbral: el llamante deja de pedir skins y lo
   *  anuncia UNA vez — solo un fallo devuelve "apagar" por sesión hasta
   *  `rearmar`. */
  fallo(personaje: string, status?: number): "ignorar" | "cuenta" | "apagar" {
    const backendDown = status === undefined || status >= 500;
    if (!backendDown) return "ignorar";
    this.#caidos.add(personaje);
    if (this.#apagado || this.#caidos.size < UMBRAL_APAGADO_DE_SESION) return "cuenta";
    this.#apagado = true;
    return "apagar";
  }

  /** Los skins de la sesión están apagados: no se pide ninguno más hasta
   *  `rearmar`. */
  get apagado(): boolean {
    return this.#apagado;
  }

  /** Cuántos personajes distintos han fallado con error de backend — el número
   *  que se le dice al jugador al apagar. */
  get caidos(): number {
    return this.#caidos.size;
  }

  /** El umbral, para que quien anuncie el apagón pueda decirlo sin copiarse la
   *  constante. */
  get umbral(): number {
    return UMBRAL_APAGADO_DE_SESION;
  }

  /** Vuelve a armar el fusible: olvida el flag Y la cuenta. Se llama al entrar
   *  o reanudar una sesión y cuando el jugador reactiva los personajes IA. El
   *  olvido de los personajes que fallaron (su estado en el manager) es del
   *  llamante: aquí solo vive la evidencia contra el umbral. */
  rearmar(): void {
    this.#apagado = false;
    this.#caidos.clear();
  }
}
