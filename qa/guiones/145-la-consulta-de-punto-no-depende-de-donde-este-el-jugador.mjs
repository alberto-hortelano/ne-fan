/** La consulta de PUNTO no depende de dónde esté el jugador, EN EL CLIENTE VIVO
 *  (QA de #644, tanda H, 2026-09-17; ampliado en #651, tanda J; podado en #662,
 *  tanda P).
 *
 *  ## Por qué existe, si #644 ya trae candado
 *
 *  La PR de #644 trae `qa/la-consulta-de-punto-no-tiene-origen.mjs`, que es
 *  headless y bueno, pero mide DOS cosas de la mitad de abajo: el CABLE leído
 *  como TEXTO del árbol (`ocupadoEn` = `suelo.ocupado` ∪ `aabbOcupa`) y la
 *  equivalencia sobre un mundo que monta ÉL con `nefan-core/dist`. Lo que nadie
 *  ejercía cuando esto se escribió era `window.__nefan.probePoint` contra el
 *  CLIENTE de verdad, con el jugador metido dentro de un sólido. Eso es lo que
 *  hace este guion, y es lo único que hace.
 *
 *  ## AQUÍ VIVÍA EL BLOQUE 1, Y SE FUE A `nefan-core/test/` (#662)
 *
 *  Este guion tenía un primer bloque estático que leía CINCO ficheros de una
 *  lista `MIGRADOS` escrita a mano y contaba `/__nefan\.probeCollide/g` sobre
 *  su texto. Anclaba la migración de #644/#651 y estaba bien pensado, pero
 *  cubría menos de lo que su nombre prometía por las dos puntas: contaba UNA de
 *  las TRES grafías que llegan a la misma función —le eran invisibles el alias
 *  (`const pc = …probeCollide`, seis llamadas escondidas en el guion 81) y el
 *  `ctx.nefan("probeCollide", …)` que despacha `qa/lib/sonda.mjs`—, y solo
 *  miraba los cinco ficheros de la lista, así que no había TOTALIDAD: una sonda
 *  nueva en cualquier otro guion nacía verde. Y corría en la batería de
 *  navegador, que el CI no ejecuta.
 *
 *  Hoy lo sujeta `test/la-consulta-de-movimiento-tiene-dueno.test.ts` con
 *  `data/contract/sondas-de-movimiento.json`: parsea TODO `qa/**` con el árbol
 *  de sintaxis, cuenta NODOS (no texto), exige que cada aparición esté declarada
 *  con su cuenta EXACTA —o sea, las dos direcciones que estrenó el bloque 1— y
 *  corre en cada PR. Lo que el bloque 1 hacía queda cubierto con creces; lo que
 *  hacía y nadie más hacía era el bloque 2, y por eso el guion sigue existiendo.
 *
 *  ## Qué afirma
 *
 *   1. Sobre `robledo_tile`, la misma malla contada desde DOS orígenes —el
 *      spawn, libre, y el centro de un sólido— da el MISMO número de celdas
 *      ocupadas con `probePoint`.
 *   2. Y el control, sin el cual lo anterior no dice nada: con `probeCollide`
 *      ese número CAMBIA. Si dejara de cambiar, o la fixture perdió sus
 *      sólidos o `collidesAt` dejó de eximir el origen, y este guion ya no
 *      estaría midiendo #644. Son las DOS consultas de movimiento que este
 *      fichero declara en el padrón: aquí la de movimiento es el INSTRUMENTO,
 *      no el error.
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

export const sinMotor = "cierra el título y carga una fixture del selector; nunca arranca partida";

const FIXTURE = "robledo_tile";
/** Paso de la malla, en metros. 1 m sobre un tile de 64×64 son ~4.096 celdas:
 *  bastante para que el número tenga peso y poco para que la página no se
 *  quede pensando. */
const PASO_M = 1;

export default async function (ctx) {
  // ── El seam REAL, con el jugador dentro de un sólido ─────────────────────
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
