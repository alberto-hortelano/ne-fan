/** Tanda BY («que pueda saltar»), pasada ADVERSARIAL de la QA: el salto tal
 *  como lo intenta quien juega, no desde el punto que lo hace pasar.
 *
 *  El 352 sale siempre a 20 cm de la cara de la valla. Un jugador no mide:
 *  corre hacia la cerca, pulsa Espacio «más o menos ahí» y SIGUE con W
 *  apretada. Este guion mide qué le pasa según desde DÓNDE despega, y los
 *  casos que el 352 no toca: esprintando, una tarima baja ancha, una roca que
 *  se ve de rodilla, la esquina valla+muro, la valla junto al agua, apretarse
 *  contra un muro alto y machacar Espacio.
 *
 *  POR QUÉ ESTA PUERTA. Igual que el 350 y el 352: la escena entra por
 *  `loadSceneRaw` (la puerta del selector «Room»), porque el motor falso no
 *  pone estas piezas en fila. WORKAROUND declarado en el qa.md de la tanda.
 *  Todo se ANDA con el driver; solo se coloca la salida de cada carrera.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, modo maqueta (clay).
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";
import { acercarse } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const frames = esperaDeFotogramas("mundo");
/** `PLAYER_RADIUS_M` de core; solo para colocar salidas y umbrales. */
const RADIO = 0.4;

const ESCENA = {
  scene_id: "qa356",
  scene_description: "Banco de QA adversarial del salto: vallas, tarima, roca, esquina, agua y muro.",
  tile: { tx: 0, ty: 0 },
  biome: "grass",
  ground: [{ id: "estanque", kind: "water", rect: [100, 10, 20, 10] }],
  volumes: [
    // Banda v ∈ [38,5; 41,5]: la valla de la tolerancia (1 m, 1,5 m de fondo).
    { id: "valla", label: "cerca de madera", type: "wall", points: [[4, 40], [40, 40]], h: 2 },
    // Tarima baja y ANCHA (1 m, 5×5 m): saltable según `esSaltable`.
    { id: "tarima", label: "estrado de madera", type: "prism", points: [[50, 30], [60, 30], [60, 40], [50, 40]], h: 2 },
    // Roca s 1,5: se pinta a la altura de la rodilla y publica 1,65 m.
    { id: "roca", label: "roca", type: "rock", at: [80, 40], s: 1.5 },
    // Esquina: valla baja que muere contra un muro alto.
    { id: "valla_esq", label: "cerca de estacas", type: "wall", points: [[4, 70], [30, 70]], h: 2 },
    { id: "muro_esq", label: "muro de piedra", type: "wall", points: [[30, 60], [30, 80]] },
    // Valla pegada al agua por el norte: saltarla te echaría al estanque.
    { id: "valla_agua", label: "cerca de madera", type: "wall", points: [[100, 22], [120, 22]], h: 2 },
    // Muro alto suelto para apretarse contra él saltando.
    { id: "muro", label: "muro", type: "wall", points: [[60, 90], [100, 90]] },
  ],
  entities: [{ id: "player", kind: "player", name: "Tú", cell: [64, 114], footprint: [1, 1] }],
};

export default async function (ctx) {
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  // ── 0 · Pelea: saltar mientras se ataca no rompe el golpe ni el salto ────
  const BANDIDO = "bandido_1";
  await ctx.waitFor(`el bandido está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 14 });
  await ctx.nefan("inputDriver.selectAttack", "heavy");
  const pelea = await ctx.page.evaluate(async (id) => {
    const drv = window.__nefan.inputDriver;
    const hp0 = window.__nefan.enemies().find((x) => x.id === id).hp;
    const muestras = [];
    const t0 = window.__nefan.reloj().sim;
    let saltos = 0;
    // Seis segundos de MUNDO, no de pared (padrón de relojes, #711).
    while (window.__nefan.reloj().sim - t0 < 6) {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      const p = window.__nefan.state().pos;
      if (!e || !e.alive) break;
      window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
      drv.queueAttack();
      // Salta justo tras pedir el golpe: el despegue cae dentro del wind-up.
      if (window.__nefan.state().salto.fase === "suelo") { drv.queueJump(); saltos++; }
      muestras.push(window.__nefan.state().salto.elevacion);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const e = window.__nefan.enemies().find((x) => x.id === id);
    return { hp0, hp1: e?.hp ?? null, vivo: e?.alive ?? null, saltos, elevMax: Math.max(...muestras), jugador: Number(document.getElementById("player-hp-text")?.textContent ?? "NaN") };
  }, BANDIDO);
  ctx.log(`pelea saltando: ${JSON.stringify(pelea)}`);
  await ctx.shot("pelea-saltando");
  ctx.expect("saltando mientras se ataca, los golpes siguen entrando (la vida del bandido baja)", pelea.hp1 === null || pelea.hp1 < pelea.hp0 || pelea.vivo === false, JSON.stringify(pelea));
  ctx.expect("saltando en la pelea la elevación no pasa del apogeo", pelea.elevMax <= 0.8 + 1e-9, JSON.stringify(pelea));
  await ctx.waitFor("vuelve al suelo tras la pelea", () => (window.__nefan.state().salto.fase === "suelo" ? true : null), { sim: 2 });

  await ctx.nefan("loadSceneRaw", ESCENA);
  await ctx.waitFor("el tile del guion está pintado", () => (window.__nefan.scene?.scene_id === "qa356" ? true : null), 30_000);
  const geo = await ctx.page.evaluate(() => {
    const g = window.__nefan.scene.terrain_grid;
    return { ox: g.origin[0], oz: g.origin[1], mpc: g.meters_per_cell };
  });
  ctx.expect("precondición: celdas de 0,5 m", geo.mpc === 0.5, JSON.stringify(geo));
  if (geo.mpc !== 0.5) return;
  const X = (u) => geo.ox + u * geo.mpc;
  const Z = (v) => geo.oz + v * geo.mpc;

  /** Carrera hacia el norte con W (y Shift si `sprint`) apretada `sim`
   *  segundos; salta a `saltoA` metros de la cara sur (distancia del BORDE
   *  del cuerpo), o nunca si es null. Devuelve dónde acabó y cuántas veces
   *  despegó. */
  async function carrera({ x, zSalida, caraSur, saltoA, sprint = false, sim = 2.5, spam = false }) {
    await ctx.nefan("inputDriver.releaseAll");
    await ctx.nefan("setPlayerPos", x, zSalida);
    await ctx.nefan("setYaw", Math.PI);
    await ctx.waitFor("en el suelo antes de salir", () => (window.__nefan.state().salto.fase === "suelo" ? true : null), { sim: 2 });
    await frames(ctx);
    await ctx.page.evaluate(
      ({ caraSur, saltoA, sprint, spam, radio }) => {
        const d = window.__nefan.inputDriver;
        window.__c = { despegues: 0, elevMax: 0, fase: "suelo", zDespegue: null, zAterriza: null, saltado: false };
        d.press("up");
        if (sprint) d.press("sprint");
        const mira = () => {
          const st = window.__nefan.state();
          const c = window.__c;
          if (!c.vivo) return;
          if (spam) d.queueJump();
          else if (saltoA !== null && !c.saltado && st.pos.z - radio - caraSur <= saltoA) {
            d.queueJump();
            c.saltado = true;
          }
          if (st.salto.fase === "aire" && c.fase === "suelo") { c.despegues++; c.zDespegue = st.pos.z; }
          if (st.salto.fase === "suelo" && c.fase === "aire") c.zAterriza = st.pos.z;
          c.fase = st.salto.fase;
          c.elevMax = Math.max(c.elevMax, st.salto.elevacion);
          requestAnimationFrame(mira);
        };
        window.__c.vivo = true;
        requestAnimationFrame(mira);
      },
      { caraSur, saltoA, sprint, spam, radio: RADIO },
    );
    // Deja correr `sim` segundos de MUNDO (no de pared).
    await frames(ctx, Math.round(sim * 60));
    const fin = await ctx.page.evaluate(() => {
      window.__c.vivo = false;
      window.__nefan.inputDriver.releaseAll();
      const p = window.__nefan.state().pos;
      return { ...window.__c, z: p.z, x: p.x, dentro: window.__nefan.probePoint(p.x, p.z) };
    });
    return fin;
  }

  // ── 1 · Tolerancia: desde dónde se puede despegar hacia la valla ─────────
  const caraSurValla = Z(41.5);
  const norteValla = Z(38.5);
  const tabla = [];
  for (const d of [0.6, 1.0, 1.4, 1.8, 2.2, 2.6, 3.0]) {
    const r = await carrera({ x: X(22), zSalida: caraSurValla + RADIO + 3.5, caraSur: caraSurValla, saltoA: d });
    const estado = r.z < norteValla - RADIO ? "CRUZA" : r.z <= caraSurValla + RADIO ? "DENTRO/ATASCADO" : "ANTES";
    tabla.push({ d, estado, z: +r.z.toFixed(2), zDespegue: r.zDespegue && +r.zDespegue.toFixed(2), zAterriza: r.zAterriza && +r.zAterriza.toFixed(2), dentro: r.dentro });
  }
  ctx.log(`tolerancia (andando, W apretada 2,5 s tras despegar a d m de la cara): ${JSON.stringify(tabla)}`);
  ctx.expect(
    "CONTROL: quien despega a 0,6–1,8 m de la valla con W apretada acaba al otro lado",
    tabla.filter((t) => t.d <= 1.8).every((t) => t.estado === "CRUZA"),
    JSON.stringify(tabla.filter((t) => t.d <= 1.8)),
  );
  ctx.expect(
    "ningún salto hacia la valla deja al jugador ATASCADO dentro con W apretada (o cruza, o aterriza antes)",
    tabla.every((t) => t.estado !== "DENTRO/ATASCADO"),
    JSON.stringify(tabla),
  );

  // Foto del atasco: despegar a 2,2 m y quedarse dentro de la valla.
  await carrera({ x: X(30), zSalida: caraSurValla + RADIO + 3.5, caraSur: caraSurValla, saltoA: 2.2 });
  await ctx.nefan("setYaw", Math.PI);
  await frames(ctx, 5);
  await ctx.shot("atascado-dentro-de-la-valla-mirando-al-frente");
  // ¿Y un segundo Espacio desde dentro? En el aire la valla no existe.
  const z0 = (await ctx.nefan("state")).pos.z;
  await ctx.page.evaluate(() => { const d = window.__nefan.inputDriver; d.press("up"); d.queueJump(); });
  await frames(ctx, 60);
  const rescate = await ctx.page.evaluate(() => { window.__nefan.inputDriver.releaseAll(); const p = window.__nefan.state().pos; return { z: p.z, dentro: window.__nefan.probePoint(p.x, p.z) }; });
  ctx.log(`atascado en la valla: segundo salto con W → z ${z0.toFixed(2)} → ${rescate.z.toFixed(2)} · dentro=${rescate.dentro}`);
  ctx.expect("atascado dentro de la valla, un segundo salto con W te saca por delante", rescate.z < norteValla - RADIO && !rescate.dentro, JSON.stringify({ z0, rescate }));

  // Secuencia: correr y saltar la valla mirando al frente (−15°), fotos cada ~0,1 s.
  await ctx.nefan("setPlayerPos", X(8), caraSurValla + RADIO + 1.6);
  await ctx.nefan("setYaw", Math.PI);
  await ctx.nefan("inputDriver.press", "turnDown");
  await frames(ctx, 4);
  await ctx.nefan("inputDriver.release", "turnDown");
  await frames(ctx);
  await ctx.page.evaluate(() => { const d = window.__nefan.inputDriver; d.press("up"); });
  await frames(ctx, 6);
  await ctx.page.evaluate(() => window.__nefan.inputDriver.queueJump());
  for (let i = 0; i < 8; i++) {
    const s = await ctx.nefan("state");
    await ctx.shot(`secuencia-${i}-elev-${s.salto.elevacion.toFixed(2)}`);
    await frames(ctx, 5);
  }
  await ctx.nefan("inputDriver.releaseAll");

  // ── 2 · Esprintando ──────────────────────────────────────────────────────
  const spr = [];
  for (const d of [0.2, 1.0, 1.8]) {
    const r = await carrera({ x: X(12), zSalida: caraSurValla + RADIO + 5, caraSur: caraSurValla, saltoA: d, sprint: true });
    spr.push({ d, estado: r.z < norteValla - RADIO ? "CRUZA" : r.z <= caraSurValla + RADIO ? "DENTRO/ATASCADO" : "ANTES", z: +r.z.toFixed(2) });
  }
  ctx.log(`tolerancia esprintando: ${JSON.stringify(spr)}`);

  // ── 3 · Tarima baja y ancha: ¿se sube o se anda por DENTRO? ──────────────
  const caraSurTarima = Z(40);
  await ctx.nefan("setPlayerPos", X(55), caraSurTarima + 4);
  await ctx.nefan("setYaw", Math.PI);
  await frames(ctx, 5);
  await ctx.shot("tarima-vista-desde-fuera-a-4-m");
  const t = await carrera({ x: X(55), zSalida: caraSurTarima + RADIO + 2, caraSur: caraSurTarima, saltoA: 0.3, sim: 0.75 });
  ctx.log(`tarima: tras aterrizar z=${t.z.toFixed(2)} (cara sur ${caraSurTarima.toFixed(2)}, norte ${Z(30).toFixed(2)}) · cuerpo dentro del sólido=${t.dentro}`);
  await ctx.nefan("setYaw", Math.PI);
  await ctx.shot("tarima-tras-aterrizar-encima");
  // Dentro de la tarima, andar en paralelo a su cara (hacia el oeste).
  const p0 = await ctx.nefan("state");
  await ctx.nefan("setYaw", -Math.PI / 2);
  await frames(ctx, 3);
  await ctx.nefan("inputDriver.press", "up");
  await frames(ctx, 12);
  await ctx.nefan("inputDriver.releaseAll");
  const p1 = await ctx.page.evaluate(() => { const p = window.__nefan.state().pos; return { x: p.x, z: p.z, dentro: window.__nefan.probePoint(p.x, p.z) }; });
  ctx.log(`tarima: andando al oeste desde dentro: x ${p0.pos.x.toFixed(2)} → ${p1.x.toFixed(2)} · dentro=${p1.dentro}`);
  await ctx.shot("tarima-andando-por-dentro");
  await ctx.nefan("inputDriver.press", "turnDown");
  await frames(ctx, 3);
  await ctx.nefan("inputDriver.release", "turnDown");
  await ctx.nefan("inputDriver.press", "turnDown");
  await frames(ctx, 3);
  await ctx.nefan("inputDriver.release", "turnDown");
  await frames(ctx, 5);
  await ctx.shot("tarima-dentro-mirando-abajo");
  ctx.expect(
    "tras saltar sobre una tarima de 1 m, el jugador NO camina por DENTRO de ella a ras de suelo",
    !(t.dentro && p1.dentro && Math.abs(p1.x - p0.pos.x) > 1),
    JSON.stringify({ tras: t.dentro, p0: p0.pos, p1 }),
  );

  // ── 4 · La roca de rodilla (s 1,5) ───────────────────────────────────────
  const caraSurRoca = Z(40) + 1.0; // aproximada: la huella de la roca es ~1 m
  await ctx.nefan("setPlayerPos", X(80), Z(40) + 3.2);
  await ctx.nefan("setYaw", Math.PI);
  await frames(ctx, 10);
  await ctx.shot("roca-s1_5-vista-desde-3-m");
  const roca = await carrera({ x: X(80), zSalida: Z(40) + 4, caraSur: caraSurRoca, saltoA: 0.6 });
  ctx.log(`roca s1,5: tras saltar con W → z=${roca.z.toFixed(2)} (centro ${Z(40).toFixed(2)}) · despegues ${roca.despegues}`);

  // ── 5 · Esquina valla + muro alto, en diagonal ───────────────────────────
  await ctx.nefan("inputDriver.releaseAll");
  await ctx.nefan("setPlayerPos", X(26), Z(74));
  await ctx.nefan("setYaw", Math.PI * 0.75); // hacia el noreste (yaw 0 = +z, π/2 = +x), a la esquina
  await frames(ctx);
  await ctx.page.evaluate(() => {
    const d = window.__nefan.inputDriver;
    d.press("up");
    d.queueJump();
  });
  await frames(ctx, 90); // 1,5 s de mundo
  const esq = await ctx.page.evaluate(() => {
    window.__nefan.inputDriver.releaseAll();
    const p = window.__nefan.state().pos;
    return { x: p.x, z: p.z, dentro: window.__nefan.probePoint(p.x, p.z) };
  });
  ctx.log(`esquina: acaba en x=${esq.x.toFixed(2)} z=${esq.z.toFixed(2)} (muro en x=${X(30).toFixed(2)}) · dentro=${esq.dentro}`);
  // Al este del muro solo se llega RODEÁNDOLO por su extremo norte (la banda
  // acaba en v 58,5): saltada la valla, W en diagonal lleva allí andando, y
  // eso es legítimo. Lo que no puede pasar es acabar al este del muro a la
  // altura del muro (v ≥ 58,5), que sería haberlo cruzado. La primera versión
  // de este aserto solo miraba x y confundía rodear con cruzar (vuelta del
  // ingeniero, tanda BY: x −15,46 con z −5,47, al norte del extremo).
  const alEste = esq.x >= X(31.5) + RADIO;
  const rodeado = esq.z < Z(58.5) - RADIO;
  ctx.expect("en la esquina, saltar no CRUZA el muro alto (al este solo se llega rodeándolo por su extremo)", !alEste || rodeado, JSON.stringify({ ...esq, alEste, rodeado }));
  ctx.expect("en la esquina, el jugador no acaba metido en nada", esq.dentro === false, JSON.stringify(esq));

  // ── 6 · Valla con el agua detrás ─────────────────────────────────────────
  const agua = await carrera({ x: X(110), zSalida: Z(23.5) + RADIO + 1.5, caraSur: Z(23.5), saltoA: 0.6 });
  const enAgua = agua.z < Z(20) + RADIO;
  ctx.expect("CONTROL: ante la valla del agua sí se despegó", agua.despegues === 1, JSON.stringify(agua));
  ctx.log(`valla con agua detrás: z=${agua.z.toFixed(2)} (agua hasta ${Z(20).toFixed(2)}) · dentro=${agua.dentro} · en el agua=${enAgua}`);
  ctx.expect("saltar una valla con agua detrás no mete al jugador en el agua", !enAgua, JSON.stringify(agua));

  // ── 7 · Apretado contra un muro alto, saltando ───────────────────────────
  const muro = await carrera({ x: X(80), zSalida: Z(91.5) + RADIO + 1.5, caraSur: Z(91.5), saltoA: 0.6, sim: 1.5 });
  ctx.log(`contra el muro: z=${muro.z.toFixed(2)} (cara sur ${Z(91.5).toFixed(2)}) · dentro=${muro.dentro}`);
  ctx.expect("saltando contra un muro alto ni se cruza ni se mete el cuerpo en él", muro.dentro === false && muro.despegues === 1 && muro.z > Z(91.5), JSON.stringify(muro));

  // ── 8 · Machacar Espacio: ni doble salto ni más altura ──────────────────
  const spam = await carrera({ x: X(64), zSalida: Z(110), caraSur: -1e9, saltoA: null, spam: true, sim: 2.0 });
  ctx.log(`spam de Espacio 2 s: despegues=${spam.despegues} · elevación máx ${spam.elevMax.toFixed(3)}`);
  ctx.expect("machacando Espacio la elevación nunca pasa del apogeo (sin doble salto)", spam.elevMax <= 0.8 + 1e-9, `${spam.elevMax}`);

}
