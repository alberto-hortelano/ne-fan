/** EN DIAGONAL CONTRA LA ESQUINA DE UN EDIFICIO NO SE ENTRA — medido ANDANDO,
 *  en el juego, contra el pueblo de una fixture (#601).
 *
 *  ## Por qué hace falta este guion y no basta con los que hay
 *
 *  El arreglo de #601 vive entero en `pasoDelJugador` (`nefan-core`), y su
 *  candado también: `test/paso-del-jugador.test.ts`. En el BANCO no había
 *  ninguno. Los que tocan solidez la miden de otra manera y por eso NO ven esto:
 *
 *   · el **81** y el **91** sondean el centro y los cuatro bordes de un spawn,
 *     y el 91 además ANDA — pero **de frente contra una cara**, que es justo el
 *     rumbo que nunca falló;
 *   · el **02**, el **45** y el **06** empujan contra el muro del plan, también
 *     de frente (`setYaw(Math.PI)`, o sea un eje puro);
 *   · el **128** y el **118** miden qué frena y qué se pisa, no por dónde se
 *     entra.
 *
 *  La diagonal exacta contra una ESQUINA era la única puerta, y no la caminaba
 *  nadie. Medido sobre esta misma fixture por el camino real del cliente
 *  (`formatDToWorld` → `planCollisionGrid` → `TerrainCollider`), con el código
 *  de `243d5b3b` y a 60 fps: de las **nueve** esquinas exteriores alcanzables de
 *  `casa_concejo`, `capilla` y `posada`, **ocho dejaban entrar**, y el jugador
 *  no «cruzaba el edificio»: se quedaba DENTRO y **dejaba de andar** (6,1 m
 *  recorridos y parado en (−11,91, −11,91), dentro de la Casa del Concejo).
 *  Con el arreglo, las nueve rodean el edificio y siguen andando 50-60 m.
 *  Andando en el NAVEGADOR, que es lo que mide este guion, el mismo sabotaje
 *  pone en rojo **10 de las 11 esquinas** que llega a medir.
 *
 *  ## Lo que se afirma, y por qué cada mitad
 *
 *  1. **No se entra**: se espera POR EL FALLO (`expectEspera(..., false, ...)`,
 *     el molde del guion 02) y la expiración ES el aserto. El rectángulo contra
 *     el que se mide no es una constante: se DESCUBRE sondeando, como el 02.
 *  2. **Pero se anda**: sin esto, «no entró» sale verde con el jugador parado
 *     en la salida, que es la forma más barata de mentir de un guion de
 *     colisión (la misma nota que lleva el 91 en su cabecera).
 *  3. **El CONTROL de frente**: contra una CARA el jugador tiene que pararse
 *     pegado a la pared. Sin él, un día en que nada frenase, los dos asertos de
 *     arriba saldrían igual de verdes midiendo campo abierto.
 *
 *  ## El rectángulo se sondea por PUNTO, y por eso ya no hay mirador (#662)
 *
 *  Hasta la tanda P este guion aparcaba al jugador a 28 m (`const MIRADOR`)
 *  antes de sondear, porque preguntaba con `probeCollide` = `collidesAt`, una
 *  consulta de MOVIMIENTO que contesta SIEMPRE que no por el punto en el que
 *  uno ya está (la exención «salir sí, entrar no», el H2 de #538). El protocolo
 *  funcionaba y tenía un agujero que lo decía todo: su propia comprobación de
 *  cordura —«el mirador está en campo abierto»— se preguntaba CON el jugador
 *  encima del mirador, así que era la única pregunta que el mirador no podía
 *  contestar; medido en la corrida del 2026-09-18, distancia jugador↔punto =
 *  0,0000 m. Hoy se pregunta por `probePoint` = `ocupadoEn`, que no tiene
 *  origen que aparcar: el rectángulo sale igual de inflado por el radio del
 *  jugador (`ocupadoEn` usa `PLAYER_RADIUS` por defecto) y no hay protocolo que
 *  recordar en cada sitio. Lo que sigue en pie es la segunda mitad: «¿estoy
 *  dentro?» se decide comparando POSICIONES contra ese rectángulo, no
 *  preguntándoselo a la colisión.
 *
 *  ## Probado en negativo (2026-09-16)
 *
 *  Devolviendo `pasoDelJugador` a la resolución de la base —los dos ejes
 *  sondeados desde el origen— este guion se pone ROJO: la salida de esa corrida
 *  está en `qa-1.md` de la tanda. El control de frente sigue verde con el
 *  sabotaje puesto, que es lo que dice que el rojo es de la esquina y no de
 *  «dejó de frenar todo».
 *
 *  Cero créditos y sin motor: cierra el título y carga una fixture del selector.
 */

/** La EXCEPCIÓN del guardarraíl de gasto (#295), mismo molde que el guion 02:
 *  este guion no le pide nada al motor. */
export const sinMotor = "cierra el título y carga una fixture del selector; nunca arranca partida";

import { cargarFixture } from "../lib/fixtures.mjs";

/** Cuánto se retira el jugador por la diagonal antes de empujar. Con el paso de
 *  0,07 m de un frame a 60 fps son ~60 frames de carrerilla. */
const CARRERILLA_M = 4;
/** Cuánto hay que estar DENTRO del rectángulo para llamarlo entrar: la lectura
 *  de la posición cae entre frames, así que 2 cm de margen (el mismo número que
 *  usa el guion 91). */
const DENTRO_M = 0.02;
/** Paso del barrido que descubre el rectángulo. */
const SONDA_M = 0.05;

/** El rectángulo SÓLIDO que rodea a (cx, cz), sondeado por PUNTO hacia los
 *  cuatro ejes. Viene ya inflado por el radio del jugador, porque `ocupadoEn`
 *  sondea con `PLAYER_RADIUS` igual que `collidesAt`; lo que NO arrastra es el
 *  origen, así que da lo mismo dónde esté el jugador cuando se llama. */
async function rectangulo(ctx, centro) {
  return ctx.page.evaluate(
    ({ c, paso }) => {
      const solido = (x, z) => window.__nefan.probePoint(x, z);
      if (!solido(c.x, c.z)) return null;
      const buscar = (dx, dz) => {
        let d = 0;
        while (d < 40 && solido(c.x + dx * (d + paso), c.z + dz * (d + paso))) d += paso;
        return d;
      };
      return {
        oeste: c.x - buscar(-1, 0),
        este: c.x + buscar(1, 0),
        norte: c.z - buscar(0, -1),
        sur: c.z + buscar(0, 1),
      };
    },
    { c: centro, paso: SONDA_M },
  );
}

/** ¿Está el punto DENTRO del rectángulo, con el margen de lectura? */
function dentro(p, r) {
  return (
    p.x > r.oeste + DENTRO_M && p.x < r.este - DENTRO_M &&
    p.z > r.norte + DENTRO_M && p.z < r.sur - DENTRO_M
  );
}

/** Empuja desde `salida` mirando a `objetivo` y devuelve dónde acabó. */
async function empujar(ctx, salida, objetivo, r, desc) {
  await ctx.nefan("setPlayerPos", salida.x, salida.z);
  await ctx.nefan("setYaw", Math.atan2(objetivo.x - salida.x, objetivo.z - salida.z));
  const { ocurrio: entro } = await ctx.expectEspera(
    `el jugador se mete DENTRO del edificio ${desc}`,
    false,
    (rect) => {
      const p = window.__nefan.state().pos;
      return p.x > rect.oeste + rect.margen && p.x < rect.este - rect.margen &&
        p.z > rect.norte + rect.margen && p.z < rect.sur - rect.margen
        ? { x: p.x, z: p.z }
        : null;
    },
    {
      sim: 10,
      arg: { ...r, margen: DENTRO_M },
      tecla: "up",
      aserto: `el jugador NO se mete dentro del edificio ${desc}`,
    },
  );
  const fin = (await ctx.nefan("state")).pos;
  return { fin: { x: fin.x, z: fin.z }, entro, anduvo: Math.hypot(fin.x - salida.x, fin.z - salida.z) };
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  await cargarFixture(ctx, "robledo_tile");

  // Aquí se aparcaba al jugador antes de sondear; se fue con #662 (cabecera).
  const edificios = await ctx.page.evaluate(() =>
    (window.__nefan.scene?.objects ?? [])
      .filter((o) => o.category === "building")
      .map((o) => ({ id: o.id, x: o.position[0], z: o.position[2] })),
  );
  ctx.expect("la fixture trae edificios", edificios.length > 0, `${edificios.length} edificios`);
  if (!edificios.length) return;

  // ── 1 · LAS ESQUINAS ─────────────────────────────────────────────────────
  let medidas = 0;
  let saltadas = 0;
  for (const e of edificios.slice(0, 3)) {
    const r = await rectangulo(ctx, e);
    ctx.expect(`${e.id} es sólido y se le encuentra el rectángulo sondeando`, Boolean(r), JSON.stringify(r));
    if (!r) continue;
    ctx.log(
      `${e.id}: rectángulo sólido (ya inflado por el radio) ` +
        `x[${r.oeste.toFixed(2)}, ${r.este.toFixed(2)}] z[${r.norte.toFixed(2)}, ${r.sur.toFixed(2)}]`,
    );

    for (const [sx, sz, nombre] of [[-1, -1, "NO"], [1, -1, "NE"], [-1, 1, "SO"], [1, 1, "SE"]]) {
      const esquina = { x: sx < 0 ? r.oeste : r.este, z: sz < 0 ? r.norte : r.sur };
      const d = CARRERILLA_M / Math.SQRT2;
      const salida = { x: esquina.x + sx * d, z: esquina.z + sz * d };
      // La salida tiene que estar libre y FUERA: si no, no se estaría midiendo
      // la entrada por la esquina sino otra cosa. Se dice y se sigue.
      const libre = (await ctx.nefan("probePoint", salida.x, salida.z)) === false;
      if (!libre || dentro(salida, r)) {
        saltadas++;
        ctx.log(`${e.id} · esquina ${nombre}: la salida (${salida.x.toFixed(1)}, ${salida.z.toFixed(1)}) no está libre; no se mide`);
        continue;
      }
      const res = await empujar(ctx, salida, esquina, r, `${e.id} por su esquina ${nombre}`);
      medidas++;
      // La captura se toma en la PRIMERA esquina y no al final del bloque: con
      // 10 s de mundo el jugador rodea el edificio y se va al campo, así que la
      // foto de después enseña horizonte y no enseña la esquina de la que habla.
      if (medidas === 1) {
        await ctx.nefan("setYaw", Math.atan2(e.x - res.fin.x, e.z - res.fin.z));
        await ctx.shot(`la-primera-esquina-${e.id}`);
      }
      ctx.expect(
        `…y ANDA: contra la esquina ${nombre} de ${e.id} se mueve de donde salió (si no, «no entró» no diría nada)`,
        res.anduvo > 0.5,
        `recorrió ${res.anduvo.toFixed(2)} m hasta (${res.fin.x.toFixed(2)}, ${res.fin.z.toFixed(2)})`,
      );
    }
  }
  ctx.expect(
    "se midieron al menos CUATRO esquinas (con menos, el verde no dice nada del pueblo)",
    medidas >= 4,
    `${medidas} medidas · ${saltadas} saltadas por no tener salida libre`,
  );
  await ctx.shot("tras-las-esquinas-lejos-del-pueblo");

  // ── 2 · EL CONTROL: de frente contra una CARA hay que pararse ────────────
  // Sin esto, los asertos de arriba saldrían igual de verdes el día que nada
  // frenase: «no entró» sería cierto porque no hay edificio contra el que
  // entrar.
  const e0 = edificios[0];
  const r0 = await rectangulo(ctx, e0);
  ctx.expect(`CONTROL: el centro de ${e0.id} es sólido y se le puede medir el rectángulo`, Boolean(r0), JSON.stringify(e0));
  if (!r0) return;
  const salidaSur = { x: (r0.oeste + r0.este) / 2, z: r0.sur + CARRERILLA_M };
  const res = await empujar(ctx, salidaSur, { x: (r0.oeste + r0.este) / 2, z: e0.z }, r0, `${e0.id} de FRENTE (control)`);
  ctx.expect(
    `CONTROL: de frente contra la cara sur de ${e0.id} el jugador se para PEGADO a ella`,
    !res.entro && res.fin.z < salidaSur.z - 0.5 && res.fin.z > r0.sur - DENTRO_M,
    `salió de z=${salidaSur.z.toFixed(2)}, la pared está en z=${r0.sur.toFixed(2)} y acabó en z=${res.fin.z.toFixed(2)}`,
  );
  await ctx.shot("el-control-de-frente");
}
