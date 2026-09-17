/** La consulta de PUNTO no depende de dónde esté el jugador, EN EL CLIENTE VIVO
 *  — y los guiones que se migraron a ella no pueden volver atrás en verde
 *  (QA de #644, tanda H, 2026-09-17; ampliado en #651, tanda J).
 *
 *  ## Por qué existe, si #644 ya trae candado
 *
 *  La PR de #644 trae `qa/la-consulta-de-punto-no-tiene-origen.mjs`, que es
 *  headless y bueno, pero mide DOS cosas de la mitad de abajo: el CABLE leído
 *  como TEXTO del árbol (`ocupadoEn` = `suelo.ocupado` ∪ `aabbOcupa`) y la
 *  equivalencia sobre un mundo que monta ÉL con `nefan-core/dist`. Cuando esto
 *  se escribió, nadie ejercía `window.__nefan.probePoint` contra el cliente de
 *  verdad salvo los guiones 91 y 32 (desde #651 también el 118, el 119 y el
 *  128, que es lo que ha ampliado el bloque 1), y esos dos:
 *
 *   · **91** solo se pone rojo si se corre la batería larga, que el CI no corre;
 *   · **32** se puede devolver a `probeCollide` y NO SE PONE ROJO NADA — medido
 *     por QA el 2026-09-17: no hay ancla en `test/las-anclas-de-los-candados.
 *     test.ts` ni en `qa/bateria-candados-en-negativo.mjs` que nombre a ninguno
 *     de los dos, y con el jugador fuera de un sólido las dos consultas
 *     contestan lo mismo. Media PR revertida en verde, que es el fallo que esta
 *     casa se comió el 2026-09-16.
 *
 *  Esto cierra las dos: el bloque 1 ancla la migración (estático, sin página) y
 *  el bloque 2 ejerce el seam REAL con el jugador metido dentro de un sólido.
 *
 *  ## Qué afirma
 *
 *   1. Los CINCO guiones de `MIGRADOS` preguntan por `__nefan.probePoint`, y
 *      cada uno tiene EXACTAMENTE las consultas de movimiento que declara: cero
 *      el 91, el 32, el 118 y el 128, y UNA el 119 —`caminoALaBolsa`, que
 *      pregunta si el jugador puede IR y por eso no se migra (#651)—. Se lee el
 *      fichero, no la corrida: sale rojo aunque nadie los ejecute. (Las
 *      menciones en prosa van con acento grave y no llevan el `__nefan.`
 *      delante, así que no cuentan — es la misma distinción texto/llamada de
 *      #454.) Que el número sea el DECLARADO y no «cero» es lo que hace que
 *      este bloque sujete las dos direcciones: quitar la sonda legítima del 119
 *      también lo pone rojo.
 *   2. Sobre `robledo_tile`, la misma malla contada desde DOS orígenes —el
 *      spawn, libre, y el centro de un sólido— da el MISMO número de celdas
 *      ocupadas con `probePoint`.
 *   3. Y el control, sin el cual lo anterior no dice nada: con `probeCollide`
 *      ese número CAMBIA. Si dejara de cambiar, o la fixture perdió sus
 *      sólidos o `collidesAt` dejó de eximir el origen, y este guion ya no
 *      estaría midiendo #644.
 *
 *  ## Qué DICE y no afirma
 *
 *  Cuántas celdas sólidas pierde la consulta de movimiento al preguntarla desde
 *  dentro. Ese número es el tamaño de la mentira, y era el que pagaba la
 *  **vista B de depuración de colisión**: `setCollisionCellsProvider`
 *  (`nefan-html/src/main.ts`) pintaba el mapa de solidez del tile con
 *  `collidesAt`, o sea con el origen vivo del jugador — #644 dentro del juego y
 *  no dentro del banco. Este guion nació DICIÉNDOLO como hallazgo de la QA de
 *  la PR; el ingeniero lo arregló en la misma vuelta (hoy muestrea con
 *  `ocupadoEn`, y lo sujetan el bloque 1 y el bloque 4 de
 *  `qa/la-consulta-de-punto-no-tiene-origen.mjs`). El número se sigue midiendo
 *  aquí y no se afirma, porque es el tamaño de lo que se arregló.
 *
 *  ## Cero créditos
 *
 *  Fixture del selector «Room», sin partida y sin motor. El teletransporte y
 *  las dos cuentas van en UN SOLO `evaluate` síncrono a propósito: entre el
 *  `setPlayerPos` y la sonda no puede correr ningún frame, así que el sistema
 *  de salida del sólido (#616) no tiene ocasión de sacar al jugador y el
 *  origen «dentro» es de verdad dentro. Después se le devuelve donde estaba.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sinMotor = "cierra el título y carga una fixture del selector; nunca arranca partida";

const DIR = dirname(fileURLToPath(import.meta.url));
/** Los guiones que sondean por PUNTO, con cuántas consultas de MOVIMIENTO le
 *  quedan a cada uno y por qué.
 *
 *  El número es parte del ancla y por eso no es «cero» a secas (#651): el 119
 *  tiene UNA que es correcta —pregunta si el jugador puede IR de donde está
 *  hasta la bolsa, o sea que el origen vivo ES el sujeto— y escribirla aquí
 *  hace dos cosas de golpe: que añadir otra salga rojo, y que QUITAR ésa
 *  también. Lo segundo importa tanto como lo primero: es la sonda que el issue
 *  pide no «arreglar», y un comentario pidiéndolo no lo sujeta. */
const MIGRADOS = [
  { fichero: "91-la-forja-que-el-motor-pone-ya-no-se-atraviesa.mjs", movimiento: 0, porque: null },
  { fichero: "32-nadie-nace-donde-no-cabe-su-cuerpo.mjs", movimiento: 0, porque: null },
  { fichero: "118-el-carro-frena-y-la-bolsa-se-pisa.mjs", movimiento: 0, porque: null },
  {
    fichero: "119-lo-que-el-motor-declaro-al-reanudar-la-partida.mjs",
    movimiento: 1,
    porque:
      "`caminoALaBolsa`: recorre el segmento del jugador al objeto preguntando si HAY PASO, que es " +
      "una consulta de movimiento de verdad — el origen vivo es el sujeto, como el `state().blocked` " +
      "del hook. No se migra, y si desaparece este aserto lo dice",
  },
  { fichero: "128-lo-que-el-motor-pone-de-golpe-no-se-pisa.mjs", movimiento: 0, porque: null },
];
const FIXTURE = "robledo_tile";
/** Paso de la malla, en metros. 1 m sobre un tile de 64×64 son ~4.096 celdas:
 *  bastante para que el número tenga peso y poco para que la página no se
 *  quede pensando. */
const PASO_M = 1;

export default async function (ctx) {
  // ── 1 · El ancla de la migración: se lee del ÁRBOL ────────────────────────
  for (const { fichero, movimiento: esperadas, porque } of MIGRADOS) {
    const nombre = fichero.split("-")[0];
    const texto = readFileSync(join(DIR, fichero), "utf8");
    const punto = (texto.match(/__nefan\.probePoint/g) ?? []).length;
    const movimiento = (texto.match(/__nefan\.probeCollide/g) ?? []).length;
    ctx.expect(
      `${nombre} sondea por PUNTO (${punto} llamada(s) a probePoint)`,
      punto > 0,
      `${punto} probePoint · ${movimiento} probeCollide`,
    );
    ctx.expect(
      esperadas === 0
        ? `${nombre} no ha vuelto a la consulta de MOVIMIENTO para describir el mundo`
        : `${nombre} conserva sus ${esperadas} consulta(s) de MOVIMIENTO declaradas, ni una más ni una menos`,
      movimiento === esperadas,
      esperadas === 0
        ? `${movimiento} llamada(s) a __nefan.probeCollide — es #644 otra vez, y desde un origen libre no se nota`
        : `${movimiento} llamada(s) a __nefan.probeCollide contra las ${esperadas} declaradas. ${porque}`,
    );
  }

  // ── 2 · El seam REAL, con el jugador dentro de un sólido ─────────────────
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  await cargarLaFixture(ctx);

  const medida = await ctx.page.evaluate((paso) => {
    const n = window.__nefan;
    const r = n.scene?.world_rect;
    if (!r) return { error: "la escena no trae world_rect" };
    const celdas = [];
    for (let x = r.minX + paso / 2; x < r.maxX; x += paso) {
      for (let z = r.minZ + paso / 2; z < r.maxZ; z += paso) celdas.push({ x, z });
    }
    const ocupadas = celdas.filter((c) => n.probePoint(c.x, c.z));
    if (ocupadas.length === 0) return { error: "la fixture no tiene ni una celda sólida", total: celdas.length };
    // El origen «dentro»: la celda sólida MÁS CENTRADA, para que la frontera
    // del plano (que `collidesAt` sí mira y `ocupadoEn` no) no sea quien mande
    // en la cuenta.
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const dentro = ocupadas.reduce((a, b) =>
      Math.hypot(a.x - cx, a.z - cz) <= Math.hypot(b.x - cx, b.z - cz) ? a : b);

    const cuenta = (sonda) => celdas.filter((c) => sonda(c.x, c.z)).length;
    const fuera = { x: n.playerPos.x, z: n.playerPos.z };
    const puntoFuera = cuenta(n.probePoint);
    const movFuera = cuenta(n.probeCollide);
    // SIN CEDER EL HILO: no corre ningún frame entre el teletransporte y las
    // sondas, así que el sim no puede sacar al jugador del sólido.
    n.setPlayerPos(dentro.x, dentro.z);
    const puntoDentro = cuenta(n.probePoint);
    const movDentro = cuenta(n.probeCollide);
    n.setPlayerPos(fuera.x, fuera.z);
    return { total: celdas.length, fuera, dentro, puntoFuera, puntoDentro, movFuera, movDentro };
  }, PASO_M);

  if (medida.error) {
    ctx.expect(`la malla de ${FIXTURE} tiene sujeto`, false, `${medida.error} (${medida.total ?? 0} celdas)`);
    return;
  }

  ctx.log(
    `${FIXTURE}: ${medida.total} celdas de ${PASO_M} m · jugador fuera en ` +
      `(${medida.fuera.x.toFixed(1)}, ${medida.fuera.z.toFixed(1)}) · dentro del sólido en ` +
      `(${medida.dentro.x.toFixed(1)}, ${medida.dentro.z.toFixed(1)})`,
  );
  ctx.log(
    `probePoint  fuera ${medida.puntoFuera} · dentro ${medida.puntoDentro}    ` +
      `probeCollide fuera ${medida.movFuera} · dentro ${medida.movDentro}`,
  );

  // El sujeto: sin sólidos y sin huecos, «el mismo número» se cumpliría solo.
  ctx.expect(
    `${FIXTURE} tiene sólidos Y huecos que contar`,
    medida.puntoFuera > 0 && medida.puntoFuera < medida.total,
    `${medida.puntoFuera} ocupadas de ${medida.total}`,
  );
  ctx.expect(
    "la consulta de PUNTO cuenta lo mismo con el jugador fuera y con el jugador DENTRO de un sólido",
    medida.puntoFuera === medida.puntoDentro,
    `${medida.puntoFuera} vs ${medida.puntoDentro} — si difieren, probePoint volvió a tener origen`,
  );
  // EL CONTROL. Sin él, el aserto de arriba lo cumpliría también una consulta
  // que contestara siempre lo mismo, y no estaríamos midiendo #644.
  ctx.expect(
    "y el defecto que se mide EXISTE: la consulta de MOVIMIENTO cambia de cuenta al mover el origen",
    medida.movFuera !== medida.movDentro,
    `${medida.movFuera} vs ${medida.movDentro} — o la fixture perdió sus sólidos, o collidesAt dejó de eximir el origen`,
  );

  const perdidas = medida.movFuera - medida.movDentro;
  ctx.log(
    `MEDIDO y no afirmado: desde dentro del sólido, la consulta de movimiento deja de ver ${perdidas} celdas ` +
      `sólidas de ${medida.movFuera} (${((perdidas / medida.movFuera) * 100).toFixed(0)} %). Es lo que pintaba la ` +
      "vista B de colisión mientras se construyó con `collidesAt` (nefan-html/src/main.ts, " +
      "`setCollisionCellsProvider`): #644 dentro del juego, no dentro del banco. Arreglado en la misma PR " +
      "—hoy muestrea por PUNTO—, así que este número es el tamaño de lo que se quitó. Se mide, no se afirma.",
  );
  await ctx.shot("consulta-de-punto-desde-dentro");
}

/** La carga de la fixture, por el mismo camino que el resto de la batería. */
async function cargarLaFixture(ctx) {
  const { cargarFixture } = await import("../lib/fixtures.mjs");
  await cargarFixture(ctx, FIXTURE);
}
