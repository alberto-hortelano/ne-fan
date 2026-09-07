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
 *  Aquí no hay fetch, canvas ni renderer: eso lo conserva el controller del
 *  cliente, que pregunta a esta clase qué hacer y le cuenta qué pasó. */

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
}
