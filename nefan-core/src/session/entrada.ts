/** Cuándo el jugador ha ENTRADO de verdad en la partida.
 *
 *  La frontera la eligió el usuario y es una CONJUNCIÓN, no un evento: «ya se
 *  ha vestido Y ha pintado el tile inicial». Las dos mitades llegan por
 *  caminos distintos y en cualquier orden, y la que llega antes cambia según
 *  el día: con snapshot de mundo pre-generado el tile aterriza mientras el
 *  cliente todavía espera a las hojas del personaje — está medido y escrito en
 *  `qa/guiones/27-el-clon-limpio-quiere-jugar.mjs`, donde el tile llega ANTES
 *  de que el vestido falle. Colgar la entrada solo del tile deja pasar
 *  exactamente ese caso (nacería la partida de un arranque que vuelve al
 *  título); colgarla solo del vestido deja partidas sin mundo (#189).
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
export function createEntrada(alEntrar: (sessionId: string) => void): Entrada {
  let sesionActual = "";
  let hayVestido = false;
  let hayMundo = false;
  let anunciada = false;

  /** El único sitio donde se decide. Las dos mitades entran por aquí, así que
   *  no pueden divergir en qué comprueban ni en qué anuncian. */
  function comprobar(): void {
    if (anunciada) return;
    if (!sesionActual) return;
    if (!hayVestido || !hayMundo) return;
    anunciada = true;
    alEntrar(sesionActual);
  }

  return {
    sesion(sessionId: string): void {
      // El MISMO id no olvida nada: `enter` sobre la partida que ya está en
      // marcha no puede tirar a la basura una mitad que ya llegó.
      if (sessionId === sesionActual) return;
      sesionActual = sessionId;
      hayVestido = false;
      hayMundo = false;
      anunciada = false;
    },
    vestido(): void {
      hayVestido = true;
      comprobar();
    },
    mundoPintado(): void {
      hayMundo = true;
      comprobar();
    },
  };
}
