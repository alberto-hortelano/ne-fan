/** LA ESPERA POR FOTOGRAMAS DEL BANCO, CON DUEÑO Y CON RELOJ DECLARADO (#606).
 *
 *  ## Qué había
 *
 *  «Deja pasar N fotogramas y vuelve a mirar» estaba escrito **dieciséis
 *  veces**, en dieciséis guiones, con cuatro redacciones y TRES nombres: seis
 *  `esperarFrames(ctx, n = 3)` (16, 22, 30, 31, 44, 45), nueve `frames(ctx, n)`
 *  (37, 43, 58, 79, 83, 86, 109, 112, 126-rótulos) y un `esperarUnosFrames(ctx, n)`
 *  (34) que el censo de la tanda no vio porque buscaba por NOMBRE. Cincuenta y
 *  cuatro sitios de llamada, y cortafuegos de 10 s en unas y 20 s en otras.
 *  Nadie eligió ninguna de esas divergencias: se heredaron copiando al vecino.
 *  La decimoséptima estaba dentro del guion 15, escrita en línea, y fue la
 *  única que NO se migró aquí: con la espera sacada el guion salía rojo 4 de 21
 *  (y 0 de 11 sin tocar), siempre en el título. Se aparcó con su issue (#673) y
 *  la vía resultó no pasar por esta espera: era el refresco del selector que
 *  pintaba encima del home tras la pre-generación (#731). Arreglado eso en el
 *  título (tanda BB), la 17ª está aquí como las demás. La DECIMOCTAVA era la del guion 80,
 *  que se quedó fuera por su propia intermitencia; entra aquí con #659 cerrado,
 *  medida con el par 79→80 y con el 80 aislado, tres corridas de cada.
 *
 *  ## Las DOS cosas que esto arregla, y la segunda es la que dolía
 *
 *  **1 · Un solo sitio.** El día que cambie la fuente del contador o su
 *  cortafuegos hay UNA edición, no dieciséis con una que se queda atrás en verde.
 *
 *  **2 · El reloj deja de heredarse.** Las dieciséis copias leían
 *  `window.__nefan.fps().frames`, que es `FpsGl.frames++` dentro de `render()`
 *  (`nefan-html/src/renderer/fps-gl.ts`): cuenta lo que **PINTA** el renderer y
 *  sube también con el título delante. Lo que el mundo **SIMULA** lo cuenta
 *  `relojDeSim.avanza()`, que solo corre si la pantalla de título no está
 *  visible (`main.ts`). Entre `frameDelLoop` y `fpsRenderer.render()` no hay un
 *  solo `return`, así que `fps().frames` es EXACTAMENTE `reloj().loop`: el
 *  latido de la página. O sea que una espera escrita para que el jugador ande
 *  se cumplía con el mundo parado, y nadie lo había decidido — lo heredó.
 *
 *  Por eso `reloj` **no tiene defecto**: se declara en cada guion, en una línea,
 *  y se ve en el diff. Un defecto aquí sería volver a heredar el reloj, solo que
 *  desde otro sitio.
 *
 *   · `"mundo"` → `reloj().frames`: el MUNDO ha avanzado N frames de
 *     simulación. Es lo que quiere una espera que existe para que el jugador o
 *     un NPC se muevan, o para que el sim resuelva algo.
 *   · `"loop"`  → `reloj().loop`: la PÁGINA ha dado N vueltas al game loop, se
 *     simule el mundo o no. Es lo que quiere una espera que existe para que algo
 *     se repinte o para que la UI se asiente — y es lo único que puede correr
 *     con el título puesto o sin partida.
 *
 *  ## La base se lee FAIL-LOUD, y ésa es la mitad del trabajo
 *
 *  Las nueve copias del gemelo leían su punto de partida con
 *  `window.__nefan.fps()?.frames ?? 0`. Si el hook no estaba en ese instante —el
 *  hueco de una recarga—, `desde` valía **0** y la espera se cumplía con la
 *  primera muestra: nueve esperas que podían salir verdes sin haber esperado
 *  nada. Aquí la base LANZA si no se puede leer; el `?? 0` sobrevive solo dentro
 *  del sondeo, donde sí significa «todavía no, vuelve a mirar». Migrar las
 *  dieciséis conservando aquel `?? 0` habría sido mudar el defecto de casa.
 *
 *  ## Qué NO cambia
 *
 *  Ni los sitios de llamada, ni cuántos fotogramas pide cada uno, ni lo que el
 *  guion afirma después. El cortafuegos se unifica HACIA ARRIBA (20 s): los seis
 *  que tenían 10 suben, ninguno baja. Un cortafuegos no es la condición de estas
 *  esperas —lo son los fotogramas—, así que subirlo no afloja ninguna medida;
 *  bajarlo sí podría convertir una espera legítima en una expiración.
 *
 *  Lo ejerce sin navegador `nefan-core/test/fotogramas-de-qa.test.ts`, y que
 *  siga siendo el ÚNICO sitio donde se define esta espera lo canda
 *  `nefan-core/test/espera-de-fotogramas-con-dueno.test.ts`.
 */

/** Los relojes que esta espera entiende, y el campo de `reloj()` que mide cada
 *  uno. Es la fuente de la lista que sale en el fail-loud: dos definiciones de
 *  los nombres válidos es como nacen las divergencias que este módulo retira. */
export const RELOJES = Object.freeze({
  mundo: "frames",
  loop: "loop",
});

/** Cortafuegos de PARED, en milisegundos. No es la condición de la espera —eso
 *  son los fotogramas— sino el tope tras el cual se declara expirada. 20 s es el
 *  mayor de los dos que había (10 y 20) porque unificar hacia abajo puede
 *  convertir una espera buena en una expiración, y hacia arriba no puede aflojar
 *  nada: la condición sigue siendo N fotogramas del reloj declarado. */
export const CORTAFUEGOS_MS = 20_000;

/** El campo de `reloj()` que mide `reloj`, o LANZA con la lista entera.
 *
 *  Mismo fail-loud que `qa/lib/esperas.mjs` y `qa/lib/parada.mjs`, y por la
 *  misma razón: un nombre mal escrito que cayera a un defecto mediría el
 *  contador equivocado y saldría verde. */
export function campoDelReloj(reloj) {
  const campo = Object.prototype.hasOwnProperty.call(RELOJES, reloj) ? RELOJES[reloj] : undefined;
  if (campo === undefined) {
    throw new Error(
      `esperaDeFotogramas: \`reloj\` es OBLIGATORIO y vale ` +
        `${Object.keys(RELOJES).map((k) => `"${k}"`).join(" o ")}; llegó ${JSON.stringify(reloj)}. ` +
        `"mundo" cuenta los frames que el MUNDO simula (\`reloj().frames\`) y "loop" las vueltas que ` +
        `da la PÁGINA (\`reloj().loop\`, que sube también con el título delante). No hay defecto a ` +
        `propósito: heredar el reloj es lo que este módulo vino a retirar (#606).`,
    );
  }
  return campo;
}

/** EL PREDICADO, tal cual viaja a la página. `arg` es `{campo, desde, n}`.
 *
 *  El `?? null` de aquí dentro es el bueno: durante una recarga la página puede
 *  contestar sin hook todavía, y eso significa «todavía no» — no «cero». La
 *  lectura que NO puede ser opcional es la BASE, y se hace fuera, en
 *  `esperaDeFotogramas`, donde lanza. */
export function pasaronLosFotogramas(a) {
  const hook = window.__nefan;
  const lee = hook && hook.reloj;
  const lectura = typeof lee === "function" ? lee() : null;
  const f = lectura ? lectura[a.campo] : null;
  if (typeof f !== "number") return null;
  return f >= a.desde + a.n ? { f } : null;
}

/** Declara CON QUÉ RELOJ espera este guion y devuelve su espera.
 *
 *  Se escribe una vez por guion, arriba, junto a los demás helpers:
 *
 *      const esperarFrames = esperaDeFotogramas("mundo");
 *      …
 *      await esperarFrames(ctx, 4);
 *
 *  La espera devuelve `{f}` —el valor del contador con el que se cumplió—, que
 *  es lo que ya devolvían las nueve copias del gemelo; las otras seis lo
 *  ignoraban y lo siguen ignorando. */
export function esperaDeFotogramas(reloj) {
  const campo = campoDelReloj(reloj);
  const quien = reloj === "mundo" ? "el MUNDO avanza" : "la PÁGINA da";
  return async function esperarFotogramas(ctx, n = 3) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `esperaDeFotogramas("${reloj}"): los fotogramas son un entero ≥ 1 y llegó ${JSON.stringify(n)}.`,
      );
    }
    const desde = await baseDeFotogramas(ctx, campo, reloj);
    return ctx.waitFor(
      `${quien} ${n} fotograma(s) (reloj "${reloj}")`,
      pasaronLosFotogramas,
      CORTAFUEGOS_MS,
      { campo, desde, n },
    );
  };
}

/** El punto de partida, LEÍDO O LANZANDO. Sin él la espera no sabe desde dónde
 *  cuenta, y un cero inventado la cumple con la primera muestra. */
async function baseDeFotogramas(ctx, campo, reloj) {
  const lectura = await ctx.page.evaluate(() => {
    const hook = window.__nefan;
    const lee = hook && hook.reloj;
    return typeof lee === "function" ? lee() : null;
  });
  const desde = lectura === null ? null : lectura[campo];
  if (typeof desde !== "number" || !Number.isFinite(desde)) {
    throw new Error(
      `esperaDeFotogramas("${reloj}"): la página no publica \`window.__nefan.reloj().${campo}\` al ` +
        `arrancar la espera (llegó ${JSON.stringify(lectura)}), así que no hay punto de partida desde ` +
        `el que contar. Esto NO se degrada a 0: con base 0 la espera se cumple con la primera muestra ` +
        `y sale verde sin haber esperado nada, que es el defecto que traían las nueve copias del ` +
        `helper gemelo (#606). Si la página está recargándose, espera al hook antes.`,
    );
  }
  return desde;
}
