/** LA POLÍTICA DEL ATLAS DE SUPERFICIES: no pagar dos veces y no descartar en
 *  silencio.
 *
 *  Eran dos `Set` y dos campos (`pendingTiles`, `queuedTiles`, `token`,
 *  `inFlight`) dentro del controller del atlas del cliente, sin nada que
 *  pudiera ponerse rojo, y cada pieza tiene un incidente detrás:
 *
 *   · la MISMA clave disparada dos veces antes del primer `await` pagó dos
 *     veces la misma página ($0.15×2, visto en vivo el 2026-08-14). De ahí la
 *     deduplicación SÍNCRONA por clave: el segundo trigger no arranca;
 *   · pero tampoco se DESCARTA: se re-dispara cuando el primero acabe. El
 *     disparo temprano del arranque corre sin el estilo de la sesión y el
 *     retro-trigger correcto tiene que poder reintentar — sin esto, el resume
 *     con remote-gen caído se quedaba en clay pese al mapping local;
 *   · una clave DISTINTA ni se encola ni se descarta: supera al run en vuelo.
 *     Hasta #390 el controller tenía un `if (this.inFlight) return;` que
 *     tiraba en silencio el tile del jugador cuando el resume activaba otro
 *     tile antes. Superar es por TOKEN: el run viejo termina, registra su
 *     keep-list (su arte sigue siendo de la escena) y no aplica nada.
 *
 *  Y un CARRIL DE RESTAURACIÓN aparte (#714), para los tiles instalados que no
 *  son el activo: los vecinos que reinstala el resume y el que entra por
 *  prefetch. Hasta #714 no pedía atlas nadie más que el activo, así que al
 *  reanudar sobre un mundo pre-generado el jugador veía ocho vecinos en clay
 *  con su arte YA PAGADO en la librería. El carril no comparte nada con el
 *  token del activo —llamar a `nuevoRun` por vecino desecharía la corrida del
 *  jugador, que es #390 por otra puerta— y NUNCA pinta (`modoDeCorrida`).
 *
 *  Aquí no hay fetch, canvas ni renderer: eso lo conserva el controller del
 *  cliente, que pregunta a esta clase qué hacer y le cuenta qué pasó. */

/** LA REGLA DE GASTO por rol del tile. Solo el tile ACTIVO puede pintar, y solo
 *  con la generación encendida; un tile instalado que no es el activo
 *  restaura lo ya pagado y nada más, TAMBIÉN con Imagen IA encendida (#714):
 *  pintar un vecino es gasto que la partida no pidió. Pintar un tile concreto
 *  a mano sigue siendo del menú dev / tecla G, que no pasa por aquí. */
export function modoDeCorrida(t: { activo: boolean; generacion: boolean }): { resolveOnly: boolean } {
  return { resolveOnly: !(t.activo && t.generacion) };
}

/** Una restauración que el controller puede ejecutar: la clave y el id con el
 *  que preguntará si sigue mandando. */
export interface Restauracion {
  key: string;
  id: number;
}

export class PoliticaDeAtlas {
  #token = 0;
  #enVuelo = false;
  /** Claves con un ciclo de activación en curso (desde `pedir` = "arranca"
   *  hasta su `terminar`). */
  #pendientes = new Set<string>();
  /** Claves cuyo trigger llegó con el suyo en curso: se re-disparan al
   *  terminar. Un Set y no un contador: tres triggers solapados son UN
   *  re-disparo, que es lo que hace falta para volver a mirar el estado. */
  #encoladas = new Set<string>();

  /** Llega un tile activo. "arranca" = el llamante ejecuta el ciclo, y DEBE
   *  llamar a `terminar` con la misma clave pase lo que pase (en un `finally`);
   *  "encolado" = ya hay un ciclo en curso para esa clave y el llamante no hace
   *  nada: cuando aquel acabe, `terminar` se lo devolverá como "re-disparar". */
  pedir(key: string): "arranca" | "encolado" {
    // El tile que se activa deja de ser asunto del carril de restauración: su
    // ciclo de activo ya restaura lo pagado (y quizá pinta), y la restauración
    // encolada o en vuelo de esa clave no puede aplicar encima.
    this.#olvidarRestauracion(key);
    if (this.#pendientes.has(key)) {
      this.#encoladas.add(key);
      return "encolado";
    }
    this.#pendientes.add(key);
    return "arranca";
  }

  /** El ciclo de `key` acabó, bien o mal. "re-disparar" = hubo un trigger
   *  solapado y hay que volver a pedir ESA clave — es su última oportunidad de
   *  texturarse, así que el llamante no puede dejar que se la coma un catch
   *  mudo. */
  terminar(key: string): "re-disparar" | "nada" {
    this.#pendientes.delete(key);
    return this.#encoladas.delete(key) ? "re-disparar" : "nada";
  }

  /** Un run (POST del atlas + descargas) arranca y supera a cualquiera que
   *  siguiera en vuelo. Devuelve el token con el que ese run preguntará si
   *  sigue mandando. */
  nuevoRun(): number {
    this.#enVuelo = true;
    return ++this.#token;
  }

  /** ¿Sigue mandando el run con este token? Se pregunta antes de APLICAR al
   *  renderer: un run superado no toca nada, pero lo que haga ANTES de
   *  preguntar (registrar la keep-list del prune) sigue valiendo. */
  vigente(token: number): boolean {
    return token === this.#token;
  }

  /** El run con este token acabó. Baja `enVuelo` solo si sigue siendo el
   *  vigente: el `finally` de un run superado no puede apagar el indicador del
   *  que lo superó, que sigue trabajando. */
  finDeRun(token: number): void {
    if (this.vigente(token)) this.#enVuelo = false;
  }

  /** Hay un run vigente sin terminar. Es lo que el cliente pinta como
   *  «pintando…» en el panel dev y publica en el hook de bench. */
  get enVuelo(): boolean {
    return this.#enVuelo;
  }

  // --- Carril de restauración (#714) ---------------------------------------

  /** Claves esperando turno, en orden de llegada (FIFO: el resume las añade
   *  con el activo primero y el resto detrás, y ese orden es el que se ve). */
  #cola: string[] = [];
  /** El id VIGENTE de cada clave encolada o en vuelo. Un id que ya no está
   *  aquí —superado por un re-encolado, por `pedir` o por
   *  `olvidarRestauraciones`— no aplica nada. */
  #idDe = new Map<string, number>();
  #ultimoId = 0;
  /** La restauración que está corriendo, si hay una: van de una en una para
   *  no competir con el activo por las conexiones HTTP del navegador. */
  #enCurso: Restauracion | null = null;

  /** Un tile instalado que no es el activo quiere su arte ya pagado. Con un
   *  ciclo de activo en curso para esa MISMA clave no hace nada: ese ciclo ya
   *  la restaura. Una clave ya encolada o en vuelo se supera con un id nuevo y
   *  va al final: el re-añadido puede traer otra escena y lo que estaba en el
   *  aire es de la anterior. */
  encolarRestauracion(key: string): void {
    if (this.#pendientes.has(key)) return;
    this.#olvidarRestauracion(key);
    this.#idDe.set(key, ++this.#ultimoId);
    this.#cola.push(key);
  }

  /** La siguiente restauración a ejecutar, o `null` si toca esperar: hay un
   *  ciclo de activo en curso (el activo va antes, siempre), ya hay una
   *  restauración en vuelo, o la cola está vacía. El llamante DEBE llamar a
   *  `finDeRestauracion` con lo que recibió, pase lo que pase. */
  siguienteRestauracion(): Restauracion | null {
    if (this.#pendientes.size > 0 || this.#enCurso !== null) return null;
    const key = this.#cola.shift();
    if (key === undefined) return null;
    const id = this.#idDe.get(key);
    // Una clave en la cola SIEMPRE tiene id: los tres caminos que borran el id
    // la sacan también de la cola. Si no lo tuviera, lo seguro es no ejecutar.
    if (id === undefined) return null;
    this.#enCurso = { key, id };
    return this.#enCurso;
  }

  /** ¿Puede APLICAR al renderer la restauración `id` de `key`? Se pregunta
   *  antes de tocar nada, como `vigente` para el activo. */
  restauracionVigente(key: string, id: number): boolean {
    return this.#idDe.get(key) === id;
  }

  /** La restauración acabó, bien o mal. Deja paso a la siguiente, y suelta el
   *  id de la clave solo si seguía siendo el suyo (un re-encolado mientras
   *  corría tiene el suyo propio y sigue en la cola). */
  finDeRestauracion(r: Restauracion): void {
    if (this.#enCurso?.id === r.id) this.#enCurso = null;
    if (this.#idDe.get(r.key) === r.id) this.#idDe.delete(r.key);
  }

  /** Cambio de partida: nada de lo encolado ni de lo que va en el aire es de
   *  la partida nueva (la clave `tile_0_0` es la misma y la escena, otra). La
   *  que está en vuelo sigue ocupando el turno hasta su `finDeRestauracion`,
   *  pero ya no aplica. */
  olvidarRestauraciones(): void {
    this.#cola = [];
    this.#idDe.clear();
  }

  /** Restauraciones sin terminar (encoladas + la que está en vuelo). Es lo que
   *  el hook de bench publica para que un guion pueda esperarlas. */
  get restaurando(): number {
    return this.#cola.length + (this.#enCurso === null ? 0 : 1);
  }

  #olvidarRestauracion(key: string): void {
    if (!this.#idDe.delete(key)) return;
    this.#cola = this.#cola.filter((k) => k !== key);
  }
}
