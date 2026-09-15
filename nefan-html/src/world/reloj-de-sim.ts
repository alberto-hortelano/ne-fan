/** EL RELOJ DE SIMULACIÓN DEL CLIENTE: cuánto ha avanzado EL MUNDO, que no es
 *  lo que marca el reloj de pared **ni lo que marca el game loop**.
 *
 *  ── POR QUÉ EXISTE (#545) ─────────────────────────────────────────────────
 *  El `gameLoop` topa su delta en 0,1 s por frame (`main.ts`), así que un frame
 *  que tarda 300 ms mueve el mundo 100: bajo carga el juego avanza MENOS de lo
 *  que pasa en la máquina. El banco presupuestaba el progreso del jugador en
 *  milisegundos de PARED («0,5 m en 8 s») y por eso leía paradas que no
 *  existían — no porque el jugador se parase, sino porque no había habido
 *  frame. Éste es el reloj contra el que hay que presupuestar, y hasta #545 el
 *  cliente lo calculaba y lo TIRABA.
 *
 *  ── LA LECCIÓN QUE ESTE FICHERO LLEVA DENTRO, y por eso hay DOS contadores ──
 *  La primera versión de este reloj se alimentaba arriba del `gameLoop`, con el
 *  delta recién topado, **antes** de saber si el mundo se iba a simular. Medido
 *  por QA sobre el juego real: con el título cubriendo la pantalla el contador
 *  subía **7,65 s en 8 s de pared (450 frames)** mientras `gameClient.tick()` no
 *  se llamaba ni una vez. Y ahí la asimetría de #545 se INVERTÍA: en vez de
 *  declarar ⊘, una espera de sim se agotaba y AFIRMABA «el mundo avanzó los 4 s
 *  pedidos y no ocurrió» sobre un mundo que no había dado un paso. O sea, el
 *  defecto que #545 vino a matar, movido un escalón y firmado como si fuera
 *  bueno.
 *
 *  De ahí el invariante, que es la razón de ser del fichero: **el reloj solo
 *  cuenta lo que el mundo SIMULA**. `avanza` se llama desde el argumento de
 *  `gameClient.tick(…)` —la llamada que hace correr el mundo, y la única— así
 *  que `sim` no puede subir en un frame en el que el mundo no avanzó. No es
 *  convención: para saltárselo hay que sacar la llamada de ahí, y eso se ve en
 *  el diff.
 *
 *  Y `loop` cuenta la otra cosa, el LATIDO DE LA PÁGINA, porque colapsar las
 *  dos es exactamente lo que produjo aquel defecto. Con los dos separados, un ⊘
 *  puede decir «0 frames de mundo y 1.200 de loop» —el título delante, o una
 *  partida sin empezar— en vez de «no sé qué ha pasado»; y quien espera puede
 *  distinguir «el mundo no corre» de «la página está muerta», que piden
 *  respuestas distintas.
 *
 *  ── LO QUE NO CUBRE, dicho aquí y no en un informe ────────────────────────
 *  El PASO del jugador (`pasoDelJugador`, en el `gameLoop`) usa el mismo delta
 *  pero está gateado por el diálogo, no por el título: con el título delante y
 *  un driver programático (`?input=scripted`, que se salta la puerta de
 *  teclado) el jugador podría moverse sin que este reloj lo cuente. Se prefiere
 *  ese error al contrario: una espera de sim declarará **⊘** en vez de afirmar
 *  un negativo, que es el lado seguro. La otra dirección —contar ahí— es la que
 *  produjo el defecto de arriba.
 *
 *  ── POR QUÉ ESTÁ EN SU PROPIO MÓDULO, SIN UN SOLO IMPORT ──────────────────
 *  Para que se pueda EJERCER sin navegador: `nefan-core/test/sonda-de-qa.test.ts`
 *  lo importa y le pide cuentas. Vivió un rato dentro de `dev/nefan-hook.ts` y
 *  allí no había forma de probarlo —el módulo arrastra medio cliente—, así que
 *  su candado era un `grep` sobre el texto de `main.ts`: **con `sim += 0` los
 *  21 tests pasaban igual**. Un candado que se satisface sin mirar es la
 *  familia de defecto que esta casa tiene fichada, y ésta es la razón de que
 *  este fichero no importe nada. El seam del banco (`dev/nefan-hook.ts`) lo LEE
 *  para publicar `__nefan.reloj()`; el juego lo alimenta desde `main.ts`.
 */

/** Lo que el reloj sabe decir. `sim` en segundos de MUNDO; `frames` los frames
 *  en los que el mundo se simuló; `loop` los que dio el game loop, se simulara
 *  o no. */
export interface LecturaDelReloj {
  sim: number;
  frames: number;
  loop: number;
}

export interface RelojDeSim {
  /** Un frame del game loop, se vaya a simular el mundo o no. Devuelve el mismo
   *  delta que recibe para que el latido no se pueda contar «a mano» en otro
   *  sitio: el delta del loop sale de aquí. */
  frameDelLoop(delta: number): number;
  /** EL MUNDO AVANZA `delta` segundos. Devuelve el mismo delta que recibe, a
   *  propósito: así el único camino por el que el delta llega a
   *  `gameClient.tick(…)` pasa por el reloj, y un frame que mueva el mundo sin
   *  contarse no se puede escribir sin borrar esta llamada. */
  avanza(delta: number): number;
  lee(): LecturaDelReloj;
}

export function crearRelojDeSim(): RelojDeSim {
  let sim = 0;
  let frames = 0;
  let loop = 0;
  return {
    frameDelLoop(delta: number): number {
      loop++;
      return delta;
    },
    avanza(delta: number): number {
      sim += delta;
      frames++;
      return delta;
    },
    lee(): LecturaDelReloj {
      return { sim, frames, loop };
    },
  };
}

/** El reloj de ESTA página: uno por cliente, como el game loop. */
export const relojDeSim = crearRelojDeSim();
