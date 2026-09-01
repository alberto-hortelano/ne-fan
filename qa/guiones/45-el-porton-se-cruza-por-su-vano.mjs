/** El portón de la muralla se cruza POR SU VANO, y sus JAMBAS paran.
 *
 *  Es #187 visto por quien juega. El issue decía que `volumeFootprintCells`
 *  publicaba, para un `gate`, el VANO —el hueco— mientras la colisión estampa
 *  las JAMBAS: dos conjuntos DISJUNTOS (36 celdas sólidas, 0 dentro de la
 *  huella publicada). La unidad que lo canda vive en
 *  `nefan-core/test/volume-metrics.test.ts`, y mide la relación entre la
 *  huella y el collider. Lo que ninguna unidad mide —y es la razón por la que
 *  el invariante existe— es lo que le pasa al jugador delante del portón:
 *
 *   1. por el vano SE PASA (si no, la muralla no tiene puerta y la ciudad es
 *      un muro liso);
 *   2. el hueco está DONDE y COMO el portón lo declara (`at` y `w` del plan),
 *      no es un boquete cualquiera que casualmente cae cerca;
 *   3. por la muralla de al lado NO se pasa (si se pasara, el paso 1 saldría
 *      verde con una muralla que no colisiona, que es verde sin sujeto).
 *
 *  El paso 3 es el que da valor al 1, y hay que leer con cuidado QUÉ mide:
 *  la MURALLA, no la jamba del portón. Junto al vano las dos masas se solapan
 *  (la huella analítica del `gate` llega a ±(w/2+3) celdas del eje y el `wall`
 *  anfitrión cubre toda la fila), así que un sondeo ahí sale verde aunque se
 *  le quite la colisión a cualquiera de los dos — comprobado rompiendo los dos
 *  por separado, y los dos seguían verdes. Por eso el control se planta FUERA
 *  de la huella del portón, donde la única masa posible es el muro.
 *
 *  Probado en negativo, las dos mitades: sin `clearGatePassage` el paso 1 se
 *  pone rojo; sin la banda del `wall`, el paso 3.
 *
 *  Se juega una PARTIDA de verdad con el preset `e2e-sin-creditos` (cero
 *  créditos): el tile de bootstrap del motor falso declara `puerta_sur`
 *  (`labs/narrative/fake-ai-server.ts`), un `gate` de 9 celdas en la muralla
 *  sur, que es el único portón vivo del árbol — las tres fixtures del selector
 *  «Room» no llevan ninguno, así que el preset `html-fixtures` no puede
 *  contestar esta pregunta.
 *
 *  Nada aquí se sondea con coordenadas mágicas: el portón se descubre en el
 *  plan, su geometría sale del `terrain_grid` de la escena y el ancho real del
 *  vano se mide SONDEANDO el collider del propio juego, no leyendo `w`. Así el
 *  guion sigue valiendo si el bench mueve la muralla.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

/** El viaje no interviene, pero la partida tiene que arrancar en el tile de
 *  bootstrap (el que trae la muralla) y no donde la dejó otro guion. */
export const aisla = ["mundo", "saves"];

/** Espera a que el renderer EMITA frames nuevos: una captura pedida justo
 *  después de mover al jugador fotografía el frame ANTERIOR. */
async function esperarFrames(ctx, n = 3) {
  const antes = (await ctx.nefan("fps")).frames;
  await ctx.waitFor(
    `${n} frames nuevos`,
    ({ f0, n }) => (window.__nefan.fps().frames >= f0 + n ? true : null),
    10_000,
    { f0: antes, n },
  );
}

/** Anda hacia el sur desde `(x, zSalida)` e informa de hasta dónde llegó.
 *  Devuelve `{ cruzo, zFinal }` — nunca lanza: el fallo del cruce es un dato,
 *  no una excepción, porque el paso 2 espera justamente que NO cruce. */
async function intentarCruzar(ctx, x, zSalida, zMeta, debeCruzar, aserto) {
  await ctx.nefan("setPlayerPos", x, zSalida);
  await ctx.nefan("setYaw", 0); // forward = +Z = hacia el sur, contra la muralla
  await esperarFrames(ctx);
  // El signo es DATO: por el vano tiene que cruzar y contra la muralla NO, y
  // eso lo decide quien llama. Se AFIRMA con `expectEspera` (#261) en vez de
  // pasarlo por un `let cruzo = true`: en el caso negativo el timeout ES el
  // éxito, y una expiración que nadie observa no puede decidir un verde.
  const { ocurrio: cruzo } = await ctx.expectEspera(
    `el jugador avanza hacia el sur desde x=${x.toFixed(2)} hasta z=${zMeta.toFixed(2)}`,
    debeCruzar,
    (meta) => (window.__nefan.state().pos.z >= meta ? { z: window.__nefan.state().pos.z } : null),
    { ms: 12_000, arg: zMeta, tecla: "up", aserto },
  );
  return { cruzo, zFinal: (await ctx.nefan("state")).pos.z };
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  // ── 1. La partida trae un portón declarado ───────────────────────────────
  const porton = await ctx.page.evaluate(() => {
    const v = (window.__nefan.scene.__plan?.volumes ?? []).find((v) => v.type === "gate");
    return v ? { id: v.id, label: v.label, at: v.at, w: v.w ?? 8, orient: v.orient ?? null } : null;
  });
  ctx.expect(
    "el tile de la partida declara un portón (si no, este guion no mide nada)",
    Boolean(porton),
    JSON.stringify(porton),
  );
  if (!porton) return;
  ctx.log(`portón: ${porton.id} "${porton.label}" at ${JSON.stringify(porton.at)} w=${porton.w} orient=${porton.orient}`);
  ctx.expect(
    "el portón está orientado en X (la muralla corre este-oeste y se cruza andando al sur)",
    porton.orient === "x",
    String(porton.orient),
  );
  if (porton.orient !== "x") return;

  // ── 2. Su geometría en METROS, sacada del grid de la escena ──────────────
  const geo = await ctx.page.evaluate((at) => {
    const g = window.__nefan.scene.terrain_grid;
    const [ox, oz] = g.origin;
    const mpc = g.meters_per_cell;
    return { x: ox + (at[0] + 0.5) * mpc, z: oz + (at[1] + 0.5) * mpc, mpc };
  }, porton.at);
  ctx.log(`portón en mundo: (${geo.x.toFixed(2)}, ${geo.z.toFixed(2)}) · mpc ${geo.mpc}`);

  // El jugador se aparta ANTES de sondear: `probeCollide` pregunta por un
  // MOVIMIENTO desde donde está (`blocksMove`, «salir sí, entrar no»), así que
  // las celdas que ya solapa saldrían libres y una jamba con el jugador dentro
  // se mediría como hueco.
  const zLejos = geo.z - 12;
  await ctx.nefan("setPlayerPos", geo.x, zLejos);
  await esperarFrames(ctx);

  // ── 3. El ancho REAL del vano, medido en el collider ─────────────────────
  const vano = await ctx.page.evaluate((g) => {
    const paso = 0.1;
    const borde = (signo) => {
      for (let d = 0; d <= 20; d += paso) {
        if (window.__nefan.probeCollide(g.x + signo * d, g.z)) return d;
      }
      return null;
    };
    return { oeste: borde(-1), este: borde(+1), centroLibre: !window.__nefan.probeCollide(g.x, g.z) };
  }, geo);
  ctx.log(`vano sondeado: libre hasta ${vano.oeste} m al oeste y ${vano.este} m al este del eje`);

  ctx.expect(
    "el eje del portón está LIBRE: la muralla tiene un hueco donde declara su puerta",
    vano.centroLibre === true,
    `probeCollide(${geo.x.toFixed(2)}, ${geo.z.toFixed(2)}) = ${!vano.centroLibre}`,
  );
  ctx.expect(
    "el vano se cierra a los dos lados: hay JAMBA, no un boquete de lado a lado",
    vano.oeste !== null && vano.este !== null,
    `oeste ${vano.oeste} · este ${vano.este}`,
  );
  if (vano.oeste === null || vano.este === null || !vano.centroLibre) return;

  // El cuerpo del jugador ya va puesto en el sondeo (`probeCollide` infla el
  // punto con PLAYER_RADIUS), así que cualquier hueco > 0 admite el cuerpo.
  ctx.expect(
    "por el vano cabe el cuerpo del jugador",
    vano.oeste > 0 && vano.este > 0,
    `hueco ${(vano.oeste + vano.este).toFixed(2)} m de ancho libre`,
  );

  // ── 4. Se cruza ANDANDO por el vano ──────────────────────────────────────
  const zSalida = geo.z - 5;
  const zMeta = geo.z + 3;
  await ctx.nefan("setPlayerPos", geo.x, zSalida);
  await ctx.nefan("setYaw", 0);
  await esperarFrames(ctx);
  await ctx.shot("delante-del-porton");

  const porVano = await intentarCruzar(
    ctx, geo.x, zSalida, zMeta, true,
    "el jugador CRUZA la muralla por el vano del portón",
  );
  ctx.log(`por el vano: z ${zSalida.toFixed(2)} → ${porVano.zFinal.toFixed(2)} (meta ${zMeta.toFixed(2)})`);
  await esperarFrames(ctx);
  await ctx.shot("despues-de-cruzar-el-porton");

  // Y una mirada atrás, al portón desde el sur: no decide ningún verde —los
  // asertos van contra `__nefan`, nunca contra píxeles— pero es la única
  // captura del árbol donde se ve un `gate` de frente, y quien quiera juzgar
  // el arte de la puerta la necesita. Ojo al mirarla: en `e2e-sin-creditos`
  // las superficies son el damero del atlas falso, no arte.
  await ctx.nefan("setPlayerPos", geo.x, geo.z + 6);
  await ctx.nefan("setYaw", Math.PI); // forward = −Z = de vuelta al norte
  await esperarFrames(ctx);
  await ctx.shot("el-porton-visto-desde-el-sur");

  // ── 5. El hueco está DONDE Y COMO el portón lo declara ───────────────────
  // Es la mitad de #187 que se puede ver desde el juego: el paso transitable
  // no es un hueco cualquiera de la muralla, es el que declara el volumen. Se
  // mide contra `at` y `w` del propio plan, con una celda de holgura por la
  // cuantización del grid (`clearGatePassage` limpia de floor(at−w/2) a
  // ceil(at+w/2), así que el hueco puede salir hasta una celda más ancho).
  const anchoDeclarado = porton.w * geo.mpc;
  const centroLibre = geo.x + (vano.este - vano.oeste) / 2;
  const anchoLibre = vano.oeste + vano.este;
  ctx.log(
    `hueco medido: ${anchoLibre.toFixed(2)} m centrado en x=${centroLibre.toFixed(2)} · ` +
      `declarado: ${anchoDeclarado.toFixed(2)} m centrado en x=${geo.x.toFixed(2)}`,
  );
  ctx.expect(
    "el hueco transitable está centrado donde el portón declara su `at`",
    Math.abs(centroLibre - geo.x) <= geo.mpc,
    `centro medido ${centroLibre.toFixed(2)} vs declarado ${geo.x.toFixed(2)} (holgura ${geo.mpc} m)`,
  );
  ctx.expect(
    "y no es más ancho de lo que el portón declara: la muralla no tiene un boquete extra",
    anchoLibre <= anchoDeclarado + 2 * geo.mpc,
    `${anchoLibre.toFixed(2)} m libres para ${anchoDeclarado.toFixed(2)} m declarados`,
  );

  // ── 6. Control negativo: por la muralla de al lado NO se pasa ────────────
  // Sin este paso, «se cruza» lo cumpliría igual una muralla que no colisiona.
  //
  // OJO AL PUNTO QUE SE SONDEA, que costó DOS roturas en negativo afinarlo.
  // Sondear justo al lado del vano no distingue nada: ahí se solapan la masa
  // del `gate` (huella analítica ±(w/2+3) celdas) y la de su `wall` anfitrión
  // (±width/2), así que quitarle la colisión a CUALQUIERA de los dos deja el
  // paso verde por el otro. Verificado rompiendo los dos por separado: los
  // dos salían verdes.
  //
  // Así que el control se planta FUERA de la huella del portón —(w/2+5)
  // celdas del eje— donde la única masa posible es la muralla. Ahí sí: sin
  // muralla, este paso se pone rojo. Y esa es la pregunta que da valor al
  // paso 1, porque «se cruza por el vano» no significa nada si resulta que no
  // hay muralla que cruzar.
  const xMuralla = geo.x + (porton.w / 2 + 5) * geo.mpc;
  const enMuro = await ctx.page.evaluate(
    (p) => window.__nefan.probeCollide(p.x, p.z),
    { x: xMuralla, z: geo.z },
  );
  ctx.expect(
    "la muralla, FUERA de la huella del portón, es MASA: el collider la ve sólida",
    enMuro === true,
    `probeCollide(${xMuralla.toFixed(2)}, ${geo.z.toFixed(2)}) = ${enMuro}`,
  );

  const porElMuro = await intentarCruzar(
    ctx, xMuralla, zSalida, zMeta, false,
    "el jugador NO cruza por la muralla: el portón es una puerta, no un agujero de lado a lado",
  );
  ctx.log(`por la muralla: z ${zSalida.toFixed(2)} → ${porElMuro.zFinal.toFixed(2)} (meta ${zMeta.toFixed(2)})`);
  ctx.expect(
    "…y se queda al NORTE de la muralla, sin traspasarla a medias",
    porElMuro.zFinal < geo.z,
    `llegó a z=${porElMuro.zFinal.toFixed(2)}, y la muralla está en z=${geo.z.toFixed(2)}`,
  );
  await esperarFrames(ctx);
  await ctx.shot("parado-contra-la-muralla");
}
