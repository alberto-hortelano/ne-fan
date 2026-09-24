/** LA POLÍTICA DEL ATLAS DE SUPERFICIES: no pagar dos veces y no descartar en
 *  silencio.
 *
 *  Eran dos `Set` y dos campos (`pendingTiles`, `queuedTiles`, `token`,
 *  `inFlight`) dentro del controller del atlas del cliente, sin nada que
 *  pudiera ponerse rojo, y cada pieza tiene un incidente detrás:
 *
 *   · la MISMA clave disparada dos veces antes del primer `await` pagó dos
 *     veces la misma página ($0.15×2, visto en vivo el 2026-08-14). De ahí la
 *     deduplicación SÍNCRONA por clave: el segundo trigger no arranca, y una
 *     clave con una corrida en vuelo no admite otra;
 *   · pero tampoco se DESCARTA: se re-dispara cuando la clave quede LIBRE —sin
 *     ciclo de activo y sin corrida en vuelo—. El trigger solapado puede traer
 *     un estado que el primero no vio (un permiso que subió, un mapping que
 *     ya existe), y el re-disparo es su única oportunidad de mirarlo;
 *   · una clave DISTINTA ni se encola ni se descarta: arranca. Hasta #390 el
 *     controller tenía un `if (this.inFlight) return;` que tiraba en silencio
 *     el tile del jugador cuando el resume activaba otro tile antes.
 *
 *  LA VIGENCIA ES DE LA CLAVE (#729). Hasta la tanda AX había UN token para
 *  todas las corridas, y cualquier corrida de cualquier tile desechaba la que
 *  estaba en vuelo: generar desde el menú dev el vecino X y activarse Y (o
 *  pulsar G sobre Y) dejaba a X pagado, con su keep-list, y en CLAY. Ahora una
 *  corrida solo la invalida otra de SU clave —que no puede arrancar mientras
 *  ella siga en vuelo— o el cambio de mundo. Cada una aplica a su tile.
 *
 *  Y un CARRIL DE RESTAURACIÓN aparte (#714), para los tiles instalados que no
 *  son el activo: los vecinos que reinstala el resume y el que entra por
 *  prefetch. Hasta #714 no pedía atlas nadie más que el activo, así que al
 *  reanudar sobre un mundo pre-generado el jugador veía ocho vecinos en clay
 *  con su arte YA PAGADO en la librería. El carril va de uno en uno detrás del
 *  activo, y no toca las corridas: restaurar un vecino no puede desechar la
 *  del jugador, que es #390 por otra puerta.
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

/** Lo que toca hacer cuando una clave queda LIBRE (sin ciclo de activo, sin
 *  corrida y sin restauración en vuelo): nada, volver a mirar el tile como
 *  activo, o la petición MANUAL (G, menú) que llegó con la clave ocupada. La
 *  manual gana a la del activo: pintar ya incluye mirar lo que hay. */
export type AlQuedarLibre = "nada" | "activo" | "manual";

/** Tope de una corrida del atlas (POST + descargas), en ms. Una corrida es
 *  dueña de su clave hasta que acaba, así que un POST colgado —remote-gen que
 *  no contesta— dejaba el tile bloqueado hasta recargar (QA de la tanda AX,
 *  H-2). Es el techo que remote-gen da a una llamada suya a sprite-forge
 *  (`_forge`, 900 s): nadie pinta un atlas en más que eso. */
export const TOPE_DE_CORRIDA_MS = 900_000;

export class PoliticaDeAtlas {
  /** Contador de corridas: cada una recibe un token que nadie más tiene. */
  #seq = 0;
  /** La corrida EN VUELO de cada clave, con su token y si puede pintar. Solo
   *  hay una por clave, y solo están las vigentes: al terminar, o al cambiar
   *  de mundo, salen. */
  #corridaDe = new Map<string, { token: number; pinta: boolean }>();
  /** Claves con un ciclo de activación en curso (desde `pedir` = "arranca"
   *  hasta su `terminar`). */
  #pendientes = new Set<string>();
  /** Claves cuyo trigger de ACTIVO llegó con la clave ocupada: se re-disparan
   *  cuando quede libre. Un Set y no un contador: tres triggers solapados son
   *  UN re-disparo, que es lo que hace falta para volver a mirar el estado. */
  #encoladas = new Set<string>();
  /** Claves con una petición MANUAL (G, menú) que llegó ocupada. No se
   *  descarta —el desarrollador tendría que mirar el registro y repetir, y en
   *  `main` la G superaba a la corrida y pintaba (QA de la tanda AX, H-2)—: se
   *  lanza al quedar libre la clave. */
  #manuales = new Set<string>();

  /** ¿Hay algo en vuelo sobre `key` que pueda pedir su atlas: una corrida, o
   *  la restauración que corre ahora (en producción con Imagen IA, la
   *  restauración de un vecino también PINTA, así que es la misma pregunta:
   *  QA de la tanda AX, H-1)? Es lo que el menú dev pinta como «Generando…»
   *  en ESA fila y en ninguna otra. */
  ocupada(key: string): boolean {
    return this.#corridaDe.has(key) || this.#enCurso?.key === key;
  }

  /** Llega un tile activo. "arranca" = el llamante ejecuta el ciclo, y DEBE
   *  llamar a `terminar` con la misma clave pase lo que pase (en un `finally`);
   *  "encolado" = la clave está ocupada —otro ciclo suyo, o una corrida suya
   *  en vuelo (la del menú dev, la G)— y el llamante no hace nada: cuando
   *  quede libre, `terminar` o `finDeRun` se lo devolverán. */
  pedir(key: string): "arranca" | "encolado" {
    // El tile que se activa deja de ser asunto del carril de restauración: su
    // ciclo de activo ya restaura lo pagado (y quizá pinta), y la restauración
    // encolada o en vuelo de esa clave no puede aplicar encima.
    this.#olvidarRestauracion(key);
    if (this.#pendientes.has(key) || this.#corridaDe.has(key)) {
      this.#encoladas.add(key);
      return "encolado";
    }
    this.#pendientes.add(key);
    return "arranca";
  }

  /** El ciclo de `key` acabó, bien o mal. Si la clave queda libre, devuelve lo
   *  que se encoló mientras (ver `AlQuedarLibre`) — es la última oportunidad
   *  de ese tile, así que el llamante no puede dejar que se la coma un catch
   *  mudo. Con una corrida o una restauración de `key` aún en vuelo no
   *  devuelve nada TODAVÍA: lo devolverá el fin de esa. */
  terminar(key: string): AlQuedarLibre {
    this.#pendientes.delete(key);
    return this.#siQuedaLibre(key);
  }

  /** Una corrida (POST del atlas + descargas) de `key` quiere arrancar.
   *  Devuelve el token con el que preguntará si sigue mandando, o "encolada"
   *  si la clave está ocupada (su corrida o su restauración en vuelo): dos a
   *  la vez son pagar dos veces. Ninguna se descarta: la del activo y la
   *  manual se lanzan al quedar libre la clave. Una corrida de OTRA clave
   *  nunca estorba. */
  nuevoRun(key: string, { pinta, origen }: { pinta: boolean; origen: "activo" | "manual" }): number | "encolada" {
    if (this.ocupada(key)) {
      (origen === "activo" ? this.#encoladas : this.#manuales).add(key);
      return "encolada";
    }
    const token = ++this.#seq;
    this.#corridaDe.set(key, { token, pinta });
    // Una restauración encolada de esta clave ya no puede aplicar encima.
    this.#olvidarRestauracion(key);
    return token;
  }

  /** ¿Sigue mandando la corrida de `key` con este token? Se pregunta antes de
   *  APLICAR al renderer: una corrida invalidada (cambio de mundo, tope) no
   *  toca nada, pero lo que haga ANTES de preguntar (registrar la keep-list
   *  del prune) sigue valiendo. */
  vigente(key: string, token: number): boolean {
    return this.#corridaDe.get(key)?.token === token;
  }

  /** La corrida de `key` con este token acabó. Solo suelta la clave si seguía
   *  siendo suya: el `finally` de una corrida del mundo anterior no puede
   *  borrar la de la misma clave en el mundo nuevo. Si la clave queda libre
   *  (sin ciclo en curso: si lo hay, lo devuelve su `terminar`), devuelve lo
   *  encolado mientras corría. */
  finDeRun(key: string, token: number): AlQuedarLibre {
    if (!this.vigente(key, token)) return "nada";
    this.#corridaDe.delete(key);
    return this.#siQuedaLibre(key);
  }

  #siQuedaLibre(key: string): AlQuedarLibre {
    if (this.#pendientes.has(key) || this.ocupada(key)) return "nada";
    const manual = this.#manuales.delete(key);
    const activo = this.#encoladas.delete(key);
    return manual ? "manual" : activo ? "activo" : "nada";
  }

  /** Hay alguna corrida sin terminar. Es lo que el hook de bench publica como
   *  `running`. */
  get enVuelo(): boolean {
    return this.#corridaDe.size > 0;
  }

  /** Las claves con una corrida en vuelo que PUEDE PINTAR (sin
   *  `resolve_only`). El panel dev las NOMBRA en su aviso: con varias
   *  corridas a la vez, «del tile activo» mentía (QA de la tanda AX, H-3), y
   *  anunciarlo de una que solo restaura es decirle a quien eligió no gastar
   *  que gasta (QA de la tanda A, H3). */
  get clavesPintando(): string[] {
    return [...this.#corridaDe].filter(([, c]) => c.pinta).map(([k]) => k);
  }

  get pintando(): boolean {
    return this.clavesPintando.length > 0;
  }

  // --- Carril de restauración (#714) ---------------------------------------

  /** Restauraciones esperando turno, en orden de llegada (FIFO: el resume
   *  añade el activo primero y el resto detrás, y ese orden es el que se ve). */
  #cola: Restauracion[] = [];
  /** La restauración VIGENTE de cada clave encolada o en vuelo. Una que ya no
   *  está aquí —superada por un re-encolado, por `pedir`, por una corrida de
   *  su clave o por `cambioDeMundo`— no aplica nada. */
  #vigenteDe = new Map<string, Restauracion>();
  /** La restauración que está corriendo, si hay una: van de una en una para
   *  no competir con el activo por las conexiones HTTP del navegador. */
  #enCurso: Restauracion | null = null;

  /** Un tile instalado que no es el activo quiere su arte ya pagado. Con un
   *  ciclo de activo o una corrida en curso para esa MISMA clave no hace nada:
   *  ya la restauran ellos. Una clave ya encolada o en vuelo se SUPERA y va al final: el
   *  re-añadido puede traer otra escena y lo que estaba en el aire es de la
   *  anterior. */
  encolarRestauracion(key: string): void {
    if (this.#pendientes.has(key) || this.#corridaDe.has(key)) return;
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
   *  nada, como `vigente` para una corrida. */
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
  finDeRestauracion(
    r: Restauracion,
    desenlace: Desenlace,
  ): { balance: BalanceDeRestauracion | null; alQuedarLibre: AlQuedarLibre } {
    const eraLaDelTurno = this.#enCurso === r;
    if (eraLaDelTurno) this.#enCurso = null;
    if (this.#vigenteDe.get(r.key) === r) this.#vigenteDe.delete(r.key);
    if (desenlace === "aplicado") this.#balance.aplicados++;
    if (desenlace === "pintado") this.#balance.pintados++;
    if (desenlace === "sin-arte") this.#balance.sinArte++;
    // La restauración ocupaba su clave (H-1): lo que llegó mientras, sale ahora.
    const alQuedarLibre = eraLaDelTurno ? this.#siQuedaLibre(r.key) : "nada";
    if (this.restaurando > 0) return { balance: null, alQuedarLibre };
    const b = this.#balance;
    this.#balance = { aplicados: 0, pintados: 0, sinArte: 0 };
    return { balance: b.aplicados + b.pintados + b.sinArte > 0 ? b : null, alQuedarLibre };
  }

  #balance: BalanceDeRestauracion = { aplicados: 0, pintados: 0, sinArte: 0 };

  /** Cambio de mundo: nada de lo encolado ni de lo que va en el aire es del
   *  mundo nuevo (la clave `tile_0_0` es la misma y la escena, otra). Ni las
   *  restauraciones ni las CORRIDAS: sin el corte global de antes de #729, una
   *  corrida del mundo viejo aplicaría sobre el `tile_0_0` nuevo. La
   *  restauración en vuelo sigue ocupando el turno hasta su
   *  `finDeRestauracion`, pero ya no aplica. Los ciclos de activo NO se
   *  olvidan: siguen llamando a `terminar`, y es él quien los suelta. */
  cambioDeMundo(): void {
    this.#cola = [];
    this.#vigenteDe.clear();
    this.#corridaDe.clear();
    // Lo que esperaba a que su clave quedase libre también era del mundo
    // anterior: re-dispararlo sobre el `tile_0_0` nuevo es un ciclo de más
    // (QA de la tanda AX, H-5).
    this.#encoladas.clear();
    this.#manuales.clear();
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
