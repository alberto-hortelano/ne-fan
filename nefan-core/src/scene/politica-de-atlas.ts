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
 *  jugador, que es #390 por otra puerta— y va de uno en uno detrás del activo.
 *
 *  QUÉ PUEDE PAGAR CADA CORRIDA YA NO SE DECIDE AQUÍ. Aquí vivía una regla por
 *  ROL —«solo el activo pinta; un vecino restaura, también con Imagen IA»—, y
 *  el usuario la sacó del código (2026-09-24): pagar o no es CONFIGURACIÓN
 *  (el entorno) sobre el modo de la partida, y la decide `gatesDeImagen`
 *  (`session/gates-de-imagen.ts`). El activo y el vecino reciben el MISMO
 *  trato: en desarrollo los dos restauran; en producción con Imagen IA los
 *  dos pintan lo que falte. Lo que este módulo sigue decidiendo es el ORDEN y
 *  la vigencia —no pagar dos veces, no descartar en silencio, el activo
 *  antes—, que no dependen del entorno.
 *
 *  Aquí no hay fetch, canvas ni renderer: eso lo conserva el controller del
 *  cliente, que pregunta a esta clase qué hacer y le cuenta qué pasó. */

/** Una restauración que el controller puede ejecutar. Su IDENTIDAD es la
 *  vigencia: se crea al encolar, y solo el objeto que sigue registrado para su
 *  clave puede aplicar (sin contador que pueda repetirse ni desbordar). */
export interface Restauracion {
  readonly key: string;
}

/** Qué dejó una corrida del carril en el renderer: arte ya pagado aplicado
 *  (entero o parcial), arte PINTADO nuevo (solo si los gates dejaban generar:
 *  producción con Imagen IA), la librería sin nada para el tile, o nada
 *  (superada, sin estilo, tile sin superficies). `pintado` va aparte de
 *  `aplicado` porque es GASTO, y el balance no puede callarlo dentro de «$0». */
export type Desenlace = "aplicado" | "pintado" | "sin-arte" | "nada";

/** El balance de una tanda del carril, de vaciado a vaciado. */
export interface BalanceDeRestauracion {
  aplicados: number;
  pintados: number;
  sinArte: number;
}

/** La UNA línea de HUD con el balance de una tanda del carril. Los PINTADOS
 *  van delante y aparte: son gasto, y el «$0» de los restaurados no puede
 *  tragárselos. Vive aquí y no en el cliente porque qué se cuenta como gasto
 *  es la decisión, y el cliente solo la pinta. */
export function lineaDeBalance(b: BalanceDeRestauracion): string {
  const pintados = b.pintados > 0 ? `${b.pintados} vecino(s) PINTADO(S) (gasto), ` : "";
  return `Atlas fps: ${pintados}${b.aplicados} vecino(s) restaurado(s) de la librería ($0), ${b.sinArte} sin arte (clay)`;
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

  /** Restauraciones esperando turno, en orden de llegada (FIFO: el resume
   *  añade el activo primero y el resto detrás, y ese orden es el que se ve). */
  #cola: Restauracion[] = [];
  /** La restauración VIGENTE de cada clave encolada o en vuelo. Una que ya no
   *  está aquí —superada por un re-encolado, por `pedir` o por
   *  `olvidarRestauraciones`— no aplica nada. */
  #vigenteDe = new Map<string, Restauracion>();
  /** La restauración que está corriendo, si hay una: van de una en una para
   *  no competir con el activo por las conexiones HTTP del navegador. */
  #enCurso: Restauracion | null = null;

  /** Un tile instalado que no es el activo quiere su arte ya pagado. Con un
   *  ciclo de activo en curso para esa MISMA clave no hace nada: ese ciclo ya
   *  la restaura. Una clave ya encolada o en vuelo se SUPERA y va al final: el
   *  re-añadido puede traer otra escena y lo que estaba en el aire es de la
   *  anterior. */
  encolarRestauracion(key: string): void {
    if (this.#pendientes.has(key)) return;
    this.#olvidarRestauracion(key);
    const r: Restauracion = { key };
    this.#vigenteDe.set(key, r);
    this.#cola.push(r);
  }

  /** La siguiente restauración a ejecutar, o `null` si toca esperar: hay un
   *  ciclo de activo en curso (el activo va antes, siempre), ya hay una
   *  restauración en vuelo, o la cola está vacía. El llamante DEBE llamar a
   *  `finDeRestauracion` con lo que recibió, pase lo que pase. */
  siguienteRestauracion(): Restauracion | null {
    if (this.#pendientes.size > 0 || this.#enCurso !== null) return null;
    const r = this.#cola.shift();
    if (r === undefined) return null;
    this.#enCurso = r;
    return r;
  }

  /** ¿Puede APLICAR al renderer esta restauración? Se pregunta antes de tocar
   *  nada, como `vigente` para el activo. */
  restauracionVigente(r: Restauracion): boolean {
    return this.#vigenteDe.get(r.key) === r;
  }

  /** La restauración acabó, bien o mal, con `desenlace`. Deja paso a la
   *  siguiente, y suelta la clave solo si seguía siendo suya (un re-encolado
   *  mientras corría es otra restauración y sigue en la cola).
   *
   *  Devuelve el BALANCE de la tanda cuando el carril se vacía y algo pasó, y
   *  `null` en otro caso: es lo que el HUD dice en UNA línea. Hasta QA de
   *  #714 (H1) cada restauración escribía la suya, y al reanudar eran ocho
   *  seguidas tapando el registro de la partida. */
  finDeRestauracion(r: Restauracion, desenlace: Desenlace): BalanceDeRestauracion | null {
    if (this.#enCurso === r) this.#enCurso = null;
    if (this.#vigenteDe.get(r.key) === r) this.#vigenteDe.delete(r.key);
    if (desenlace === "aplicado") this.#balance.aplicados++;
    if (desenlace === "pintado") this.#balance.pintados++;
    if (desenlace === "sin-arte") this.#balance.sinArte++;
    if (this.restaurando > 0) return null;
    const b = this.#balance;
    this.#balance = { aplicados: 0, pintados: 0, sinArte: 0 };
    return b.aplicados + b.pintados + b.sinArte > 0 ? b : null;
  }

  #balance: BalanceDeRestauracion = { aplicados: 0, pintados: 0, sinArte: 0 };

  /** Cambio de mundo: nada de lo encolado ni de lo que va en el aire es del
   *  mundo nuevo (la clave `tile_0_0` es la misma y la escena, otra). La que
   *  está en vuelo sigue ocupando el turno hasta su `finDeRestauracion`, pero
   *  ya no aplica. */
  olvidarRestauraciones(): void {
    this.#cola = [];
    this.#vigenteDe.clear();
  }

  /** Restauraciones sin terminar (encoladas + la que está en vuelo). Es lo que
   *  el hook de bench publica para que un guion pueda esperarlas. */
  get restaurando(): number {
    return this.#cola.length + (this.#enCurso === null ? 0 : 1);
  }

  #olvidarRestauracion(key: string): void {
    this.#vigenteDe.delete(key);
    this.#cola = this.#cola.filter((r) => r.key !== key);
  }
}
