/** Cuándo el jugador ha ENTRADO de verdad en la partida.
 *
 *  La frontera la eligió el usuario y es una CONJUNCIÓN, no un evento: «ya se
 *  ha vestido Y ha pintado el tile inicial». Las dos mitades llegan por
 *  caminos distintos y en cualquier orden, y cuál llega antes depende de si
 *  vestir al jugador tarda más o menos que un round-trip por WebSocket — o
 *  sea, de la máquina y del día. Las dos órdenes son alcanzables y las dos
 *  están medidas (`qa/guiones/29-la-partida-existe-cuando-el-jugador-entra.mjs`).
 *
 *  El caso que obliga a la conjunción NO necesita ningún fallo, y es el que
 *  mide el bloque 3 de ese guion: mientras el jugador se viste, el mundo ya
 *  está pintado y el título sigue delante. Colgar la entrada solo del tile
 *  escribiría la partida ahí —y con ella la de cualquier arranque que todavía
 *  puede volver al título, que es la tarjeta fantasma de #279—; colgarla solo
 *  del vestido deja partidas sin mundo (#189), y eso lo canda el guion 20.
 *
 *  Un aviso para quien lea el guion 27, que también la ejerce: allí la ventana
 *  se CONSTRUYE (el 404 de las hojas espera a que el mundo esté pintado, y el
 *  guion afirma esa precondición). En el clon limpio real el 404 es
 *  instantáneo y el orden se invierte: el vestido falla ANTES de que llegue el
 *  tile, y entonces lo que impide el save no es esta conjunción sino el reset
 *  de la faceta al volver al título. Los dos caminos importan y cada uno tiene
 *  su guion; ninguno sustituye al otro.
 *
 *  Por qué es un módulo y no dos booleanos en `main.ts`: dos flags sueltos que
 *  tienen que moverse juntos, y un reset que hay que acordarse de hacer al
 *  volver al título, son EXACTAMENTE la forma del bug de #249. Aquí el olvido
 *  no se puede escribir: cambiar de sesión (`sesion(id)`) reinicia las dos
 *  mitades, y ese reset lo aplica una faceta de `session-facets.ts`, o sea los
 *  dos caminos de vuelta al título por construcción.
 *
 *  Módulo PURO: no toca el DOM, ni node:*, ni el reloj. Quién es «vestido» y
 *  quién es «mundo pintado» lo decide el cliente; qué se hace al entrar, el
 *  callback. */

/** El hecho compuesto, con sus dos mitades y la identidad a la que pertenecen. */
export interface Entrada {
  /** El jugador ya tiene cuerpo: el arranque llegó al final sin fallar. */
  vestido(): void;
  /** El mundo ya está en pantalla: un tile del plano se ha AÑADIDO. */
  mundoPintado(): void;
  /** De qué partida hablan las dos mitades. Un id distinto —otra partida, o
   *  `""` al volver al título— las olvida: lo que llegó era de la anterior. */
  sesion(sessionId: string): void;
}

/** Crea el hecho. `alEntrar` se invoca UNA sola vez por sesión, cuando han
 *  llegado las dos mitades, en el orden que sea, y solo con una sesión con
 *  identidad (`sessionId !== ""`): anunciar la entrada en una partida que no
 *  existe no significa nada. */
/** Lo que se sabe de UNA sesión: qué mitades han llegado y si queda por
 *  anunciar la entrada. */
interface Mitades {
  vestido: boolean;
  mundo: boolean;
  /** Positivo a propósito, no `anunciada` invertido: una sesión recién nacida
   *  tiene que llevar algún hecho AFIRMATIVO, o es indistinguible del objeto
   *  vacío —donde todo campo ausente es falsy— y entonces nada puede notar que
   *  falta. Con `pendiente`, un `{}` no anuncia jamás y lo dicen seis tests. */
  pendiente: boolean;
}

/** Una sesión de la que todavía no se sabe nada. Existe UNA vez y la usan los
 *  dos sitios que necesitan ese estado —crear el hecho y cambiar de sesión—,
 *  porque escribirlo dos veces es tener dos verdades que pueden divergir: la
 *  copia del reset olvidando una mitad que la del arranque sí limpia es
 *  literalmente #249. Además, así el estado inicial viaja por el camino
 *  observable (el reset) y sus tests pueden ponerlo rojo; suelto en el
 *  constructor era inmatable, porque con `sesionActual === ""` no hay ninguna
 *  secuencia que lo distinga. */
function sinMitades(): Mitades {
  return { vestido: false, mundo: false, pendiente: true };
}

export function createEntrada(alEntrar: (sessionId: string) => void): Entrada {
  let sesionActual = "";
  let mitades = sinMitades();

  /** El único sitio donde se decide. Las dos mitades entran por aquí, así que
   *  no pueden divergir en qué comprueban ni en qué anuncian. */
  function comprobar(): void {
    if (!mitades.pendiente) return;
    if (!sesionActual) return;
    if (!mitades.vestido || !mitades.mundo) return;
    mitades.pendiente = false;
    alEntrar(sesionActual);
  }

  return {
    sesion(sessionId: string): void {
      // El MISMO id no olvida nada: `enter` sobre la partida que ya está en
      // marcha no puede tirar a la basura una mitad que ya llegó.
      if (sessionId === sesionActual) return;
      sesionActual = sessionId;
      mitades = sinMitades();
    },
    vestido(): void {
      mitades.vestido = true;
      comprobar();
    },
    mundoPintado(): void {
      mitades.mundo = true;
      comprobar();
    },
  };
}
