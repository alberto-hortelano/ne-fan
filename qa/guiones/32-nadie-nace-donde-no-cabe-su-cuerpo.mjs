/** Nadie nace donde su CUERPO no cabe (#289).
 *
 *  La tanda «todo hueco admite el cuerpo mayor» cambió el validador para que
 *  juzgue el plan con un cuerpo (radio 0,5 m ⇒ 3 celdas libres) en vez de con
 *  un punto sin dimensión. Eso tiene candado en `nefan-core` (unidad). Lo que
 *  NO tenía candado es lo que ve quien juega: **que la gente que el juego
 *  planta delante del jugador tenga sitio para su cuerpo donde está de pie**.
 *  Es la mitad que ya ocurrió y se leyó durante semanas como ambiente — el
 *  tabernero de `alta_fantasia` nació dentro del prop `mostrador` y avanzó
 *  0,72 m en 60 s, contaminando #247, #262 y #284.
 *
 *  Se mide con el COLLIDER REAL del cliente, no con la máscara del validador:
 *  son dos cosas distintas y la diferencia es justo el residuo que dejó la
 *  tanda («celda pisable» no es «aquí cabe un cuerpo»). `probeCollide` sondea
 *  con el radio del JUGADOR (0,4 m) y el cuerpo que hay que medir es el del
 *  NPC (0,5), así que se compone: la colisión bloquea por SOLAPE del AABB, y
 *  el AABB de radio 0,5 centrado en p es EXACTAMENTE la unión de los cuatro
 *  AABB de radio 0,4 centrados en p ± 0,1 en cada eje
 *  ([x−0,1−0,4, x−0,1+0,4] ∪ [x+0,1−0,4, x+0,1+0,4] = [x−0,5, x+0,5]). Cuatro
 *  sondeos, ni una fórmula nueva.
 *
 *  Dos estados, porque son dos orígenes de datos distintos y solo uno tiene
 *  test: las **fixtures commiteadas** del selector «Room» (`data/scenes/`,
 *  auditadas por `scene-fixtures.test.ts`) y una **partida real** con el tile
 *  que fabrica el motor en vivo (cero créditos: `e2e-sin-creditos`), que no
 *  audita nadie hasta que el jugador se lo encuentra delante.
 *
 *  NACE ROJO (QA, 2026-08-27), y por un caso REAL: `halmar_molinero` de
 *  `robledo_tile` está plantado en `[104, 52]`, la celda pegada al muro sur
 *  del molino (`derived_ent_molino`, rect `[98, 44, 10, 8]`). Su celda es
 *  pisable y `validateScene` da el tile por bueno, pero el collider COMPARTIDO
 *  —`planCollisionGrid`, el mismo que usan el cliente y el sim del bridge—
 *  bloquea esa posición para r=0,4 y para r=0,5: media celda son 0,25 m y
 *  cualquier cuerpo invade el sólido de al lado. Es el residuo que la tanda de
 *  #289 declaró y dejó fuera de alcance («celda pisable» ≠ «aquí cabe un
 *  cuerpo»), aquí en datos commiteados. Se arregla moviendo la entity, como se
 *  hizo con las otras cinco de esa tanda; el aserto sube a verde solo.
 *
 *  EN NEGATIVO (probado el 2026-08-27, QA, en un worktree aparte):
 *   · con el molinero movido a `[104, 55]` el paso 1 sale ENTERO en verde —
 *     o sea que el rojo de hoy es ese dato y no el guion;
 *   · devolver `dentro_sur` de `zorder_test.json` a su celda anterior
 *     `[87, 91]` —dentro del muro sur de la cabaña, de donde lo sacó #289—
 *     lo pone rojo nombrando a ese NPC;
 *   · el aserto de movimiento va PAREADO con el de cuerpo libre a propósito:
 *     con el umbral en 0 pasaría siempre.
 */

import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { cargarFixture } from "../lib/fixtures.mjs";

/** Precondición DECLARADA (la ejecuta qa/run.mjs antes de lanzar el guion):
 *   · `saves` — la partida arranca en el tile de entrada, no donde la dejó
 *               otro guion (aquí se mide QUIÉN hay en el tile de entrada). */
export const aisla = ["saves"];

/** Las tres fixtures del selector, por su nombre. Se comprueba que están las
 *  tres: si el selector adelgaza, el guion tiene que enterarse, no medir dos. */
const FIXTURES = ["robledo_tile", "puerto_tile", "zorder_test"];

/** El cuerpo del NPC (0,5 m de radio) compuesto de cuatro sondeos del cuerpo
 *  del jugador (0,4). Vive en la página porque `probeCollide` es del cliente. */
const CUERPOS_EN_LA_PAGINA = () => {
  const libre = (x, z) => {
    for (const dx of [-0.1, 0.1]) {
      for (const dz of [-0.1, 0.1]) if (window.__nefan.probeCollide(x + dx, z + dz)) return false;
    }
    return true;
  };
  return window.__nefan.npcs().map((n) => ({
    id: n.id,
    label: n.label,
    pos: [Number(n.pos.x.toFixed(2)), Number(n.pos.z.toFixed(2))],
    /** Lo que miraba el validador ANTES de la tanda: el punto sin dimensión. */
    puntoLibre: !window.__nefan.probeCollide(n.pos.x, n.pos.z),
    /** Lo que hay que mirar: ¿cabe el cuerpo de 1 m de ancho? */
    cuerpoLibre: libre(n.pos.x, n.pos.z),
  }));
};

export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));

  // ── 1 · Las fixtures COMMITEADAS del selector «Room» ────────────────────
  // Entra por el camino del jugador (el botón del título, no un display:none).
  await ctx.nefan("closeTitle");
  for (const fixture of FIXTURES) {
    // AFIRMA qué escena quedó puesta (#332). La espera propia que había aquí
    // comparaba con `includes()`, que taparía la regresión de #308 al pasar de
    // una fixture a la siguiente; la lib exige igualdad estricta de scene_id.
    await cargarFixture(ctx, fixture);

    const cuerpos = await ctx.page.evaluate(CUERPOS_EN_LA_PAGINA);
    ctx.log(`${fixture}: ${cuerpos.map((c) => `${c.id}@[${c.pos}] punto=${c.puntoLibre} cuerpo=${c.cuerpoLibre}`).join(" · ")}`);

    // Aserto PAREADO: sin él, una fixture que se quedara sin NPCs pasaría
    // este guion entero sin medir nada.
    ctx.expect(`${fixture} trae gente que medir`, cuerpos.length > 0, `${cuerpos.length} NPC(s)`);
    const sinSitio = cuerpos.filter((c) => !c.cuerpoLibre);
    ctx.expect(
      `en ${fixture} todo NPC tiene sitio para su CUERPO donde nace`,
      sinSitio.length === 0,
      sinSitio.map((c) => `${c.id} en [${c.pos}] (punto libre=${c.puntoLibre})`).join(" · ") || "todos",
    );
  }
  await ctx.shot("fixtures-medidas");

  // ── 2 · Una PARTIDA real: el tile que fabrica el motor en vivo ──────────
  await ctx.page.reload();
  await ctx.waitFor("el título vuelve", () => Boolean(document.getElementById("ts-close")));
  await nuevaPartida(ctx, { gameId: "alta_fantasia" });
  const partida = await comenzar(ctx);

  const enPartida = await ctx.page.evaluate(CUERPOS_EN_LA_PAGINA);
  ctx.log(`${partida.scene}: ${enPartida.map((c) => `${c.id}@[${c.pos}] cuerpo=${c.cuerpoLibre}`).join(" · ") || "(sin NPCs)"}`);
  ctx.expect("el tile de entrada trae gente que medir", enPartida.length > 0, `${enPartida.length} NPC(s)`);
  const atrapados = enPartida.filter((c) => !c.cuerpoLibre);
  ctx.expect(
    "en la partida todo NPC tiene sitio para su CUERPO donde nace",
    atrapados.length === 0,
    atrapados.map((c) => `${c.id} en [${c.pos}] (punto libre=${c.puntoLibre})`).join(" · ") || "todos",
  );

  // El spawn del jugador, con su propio cuerpo (0,4): es la otra mitad de
  // «jugador o NPC» del issue.
  const jugador = await ctx.page.evaluate(() => {
    const p = window.__nefan.state().pos;
    return { pos: [Number(p.x.toFixed(2)), Number(p.z.toFixed(2))], libre: !window.__nefan.probeCollide(p.x, p.z) };
  });
  ctx.expect(`el jugador no nace dentro de un sólido (${jugador.pos})`, jugador.libre);

  // ── 3 · Y no está clavado: el cuerpo que cabe, se mueve ────────────────
  // Se espera por ESTADO (metros acumulados), nunca por reloj: el `maxMs` es
  // el cortafuegos. Es la lectura que durante semanas se leyó como ambiente.
  const partida0 = await ctx.page.evaluate(() => window.__nefan.npcs().map((n) => ({ id: n.id, x: n.pos.x, z: n.pos.z })));
  let recorrido = { id: "(ninguno)", m: 0 };
  try {
    recorrido = await ctx.waitFor(
      "algún NPC recorre 1 m",
      (base) => {
        const ahora = window.__nefan.npcs();
        for (const b of base) {
          const n = ahora.find((x) => x.id === b.id);
          if (!n) continue;
          const d = Math.hypot(n.pos.x - b.x, n.pos.z - b.z);
          if (d >= 1) return { id: b.id, m: Number(d.toFixed(2)) };
        }
        return null;
      },
      45_000,
      partida0,
    );
  } catch {
    /* el aserto de abajo lo cuenta; el timeout es el fallo, no una excepción */
  }
  ctx.expect(
    "un NPC con sitio para su cuerpo se mueve de donde nació",
    recorrido.m >= 1,
    `${recorrido.id} se alejó ${recorrido.m} m del spawn`,
  );
  await ctx.shot("partida-con-gente");
}
