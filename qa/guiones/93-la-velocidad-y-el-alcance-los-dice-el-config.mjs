/** LA FRONTERA QUE MOVIÓ LA PR 8 de #241: a qué velocidad anda el jugador y
 *  hasta dónde llega su `E` ya no son dos `const` del `main.ts` del cliente —
 *  son dos campos del `player` de `nefan-core/data/combat_config.json`, y el
 *  cliente los ejecuta. Escrito por QA al validar esa PR.
 *
 *  POR QUÉ NO BASTA MEDIR LOS NÚMEROS DE HOY. Que el jugador ande a 4,18 m/s y
 *  hable hasta a 2,5 m sale igual de verde con el multiplicador escrito a mano
 *  en el cliente (`ARCADE_SPEED_SCALE = 2.2`, `INTERACT_RANGE_M = 2.5`, que es
 *  como estaba) que con los dos leídos del config: los valores coinciden. Lo
 *  que separa una cosa de la otra es CAMBIAR EL CONFIG y ver si el juego se
 *  entera. Así que el config se SIRVE distinto —`page.route` sobre el módulo
 *  que Vite entrega al cliente (`/@fs/…/combat_config.json?import`), sin tocar
 *  el fichero del árbol— y se mide el juego con él:
 *
 *   · **bloque 1**, sin tocar nada: andando son `walk_speed × speed_scale` y
 *     esprintando `sprint_speed × speed_scale`, los del fichero de verdad. Es
 *     la línea base con la que se compara todo lo demás; sin ella, «cambia en
 *     proporción» podría estar cambiando desde cualquier sitio.
 *   · **bloque 2**, con `speed_scale × 1,5` servido: las DOS velocidades se
 *     multiplican por 1,5. Si el multiplicador volviera al cliente, el juego
 *     seguiría andando a 4,18 y este bloque sería el que lo dijera.
 *   · **bloque 3**, con `interact_range_m` servido a 1,2 m: el borde de la `E`
 *     se MUEVE — a 1,15 m se ofrece hablar y a 1,25 m ya no, y a 2,4 m (que con
 *     el config de verdad ofrece) deja de ofrecerse. El alcance no está escrito
 *     en el cliente: viene del config.
 *
 *  Y **bloque 5** (#539): servido un `speed_scale` IMPOSIBLE (−1: el jugador
 *  andaría hacia atrás), el cliente no arranca —no puede: sin esos números no
 *  hay partida— pero DICE POR QUÉ. Hasta esa tanda `loadConfig` solo miraba el
 *  TIPO, así que el −1 cargaba sin una queja; y con el config mutilado de
 *  verdad la página se quedaba NEGRA con el motivo únicamente en la consola del
 *  navegador. Se afirma lo que ve quien juega: el muro con el campo, el valor,
 *  el fichero y qué pasaría, la entrada en el registro de errores, y que el
 *  cliente de verdad NO arrancó (`window.__nefan` ausente) — sin eso, «lo dice»
 *  podría estar diciéndolo encima de un juego que funciona. Y el control:
 *  quitada la intercepción, el título vuelve.
 *
 *  Y **bloque 4**: al morir y pulsar `R`, el jugador vuelve EXACTAMENTE donde
 *  cayó y ese punto se puede pisar (`puntoDeReaparicion`, escalón 1). Se afirma
 *  «exactamente donde cayó» y no solo «en un sitio libre» porque es lo único
 *  que distingue el escalón 1 de los otros dos: mandarle al centro del tile
 *  también le dejaría en un sitio transitable, y el jugador aparecería a treinta
 *  metros de donde le mataron sin que nada se pusiera rojo.
 *
 *  LO QUE ESTE GUION NO PUEDE MEDIR, y se dice para que nadie lo cuente de más:
 *  los escalones 2 y 3 de `puntoDeReaparicion` (centro del tile · origen del
 *  mundo) son INALCANZABLES desde el cliente, hoy y antes de esta PR.
 *  `CollisionSystem.collidesAt(x, z)` no es una consulta de punto sino «¿puedo
 *  MOVERME de donde estoy a (x,z)?» (`world/collision.ts:74-84`, `desde =
 *  getPlayerPos()`), y `handleRespawnRequest` le pregunta por la posición del
 *  propio jugador: un movimiento de longitud cero, que la regla «salir sí,
 *  entrar no» permite siempre. El bloque 4 lo MIDE y lo registra (con el
 *  jugador metido a la fuerza dentro de una huella sólida, su propia posición
 *  le sigue pareciendo libre) sin ponerlo rojo: es la conducta de hoy, la PR
 *  la conserva a propósito y cambiarla es una decisión, no un arreglo.
 *
 *  PROBADO EN NEGATIVO (2026-09-07) por QA, un sabotaje por vez y restaurado
 *  byte a byte después (`diff -q` en los tres):
 *   · **la frontera del config, en `nefan-html/src/main.ts`**: el multiplicador
 *     y el alcance escritos otra vez a mano (`(sprint ? 3.8 : 1.9) * 2.2` y
 *     `maxDistanceM: 2.5`), que es exactamente como estaba antes de la PR →
 *     **CUATRO rojos**: andando midió 4,1800 donde el config servido pedía
 *     6,27, esprintando 8,3600 donde pedía 12,54, y el borde de la `E` se quedó
 *     en el 2,5 del cliente (ofrece a 1,25 m y a 2,4 m con el config servido a
 *     1,2). Es el rojo que hace de este guion un candado y no una foto.
 *   · **`nefan-core/src/simulation/reaparicion.ts`, `if (!solido(...))` →
 *     `if (solido(...))`**: el escalón 1 deja de ganar y el jugador reaparece en
 *     el CENTRO del tile → rojo «vuelve EXACTAMENTE donde cayó» (medido: cayó
 *     en (11,05, 0,14) y volvió a (0, 0), a 11,05 m de allí).
 *   · **el mismo fichero, `return { x: pos.x, y: 0, z: pos.z }` como primera
 *     línea** (el sabotaje «devuelve `pos` sin comprobar sólidos»): este guion
 *     SIGUE VERDE, medido, y es información y no un fallo suyo — por lo de
 *     arriba, `solido(pos)` del punto propio ya vale `false` en el juego, así
 *     que quitar la pregunta no cambia NADA de lo que el jugador vive. Esa
 *     mitad no la puede candar ningún guion de navegador: la candan los 8 casos
 *     de `nefan-core/test/reaparicion.test.ts` (5 rojos con ese mismo
 *     sabotaje). Queda dicho para que nadie cuente este guion de más.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso, `aisla` con saves y
 *  falso vírgenes. No pinta nada: `charMode: "vector"`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comenzar, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** El NPC que el tile de bootstrap del motor falso pone siempre. */
const TABERNERO = "barkeep";
/** Cuánto se multiplica `speed_scale` en el bloque 2. Ni 1 (no distinguiría
 *  «no cambia») ni 2 (que se confunde con sumar consigo mismo). */
const FACTOR = 1.5;
/** Alcance servido en el bloque 3: lejos del 2,5 real y dentro de lo que un
 *  jugador podría querer, para que el borde se vea moverse de verdad. */
const ALCANCE_CORTO_M = 1.2;
/** Tolerancia RELATIVA de la velocidad medida. El muestreo es por `rAF` y el
 *  primer frame arrastra el delta de uno que empezó antes, así que el error
 *  escala con la velocidad: medido, se queda por debajo del 2 % en las cuatro
 *  medidas. El 3 % deja margen y sigue separando de sobra lo que se mide — la
 *  señal del bloque 2 es un 50 %. */
const TOL_REL = 0.03;
/** Margen del borde de la `E`: se prueba medio decímetro a cada lado. */
const MARGEN_M = 0.05;

/** Los cuatro números del jugador, leídos del fichero de verdad. Si el config
 *  no los trae, `loadConfig` ya no deja arrancar el juego — aquí se leen crudos
 *  a propósito: el guion tiene que poder decir CON QUÉ comparaba. */
function configDelArbol() {
  const j = JSON.parse(readFileSync(path.join(RAIZ, "nefan-core", "data", "combat_config.json"), "utf8"));
  return j.player;
}

/** Sirve el `combat_config.json` del CLIENTE con otros números, sin tocar el
 *  fichero del árbol (el bridge sigue leyendo el de disco: la velocidad y el
 *  alcance son del cliente). Devuelve un contador de sustituciones para que el
 *  guion pueda AFIRMAR que la intercepción hizo algo — sin eso, un cambio de
 *  formato del módulo de Vite dejaría el bloque midiendo el config de siempre
 *  y saldría verde por el motivo equivocado. */
async function servirConfigCon(ctx, cambios) {
  const cuenta = { sustituciones: 0, respuestas: 0 };
  await ctx.page.route("**/combat_config.json*", async (route) => {
    const r = await route.fetch();
    let cuerpo = await r.text();
    for (const [campo, valor] of Object.entries(cambios)) {
      const re = new RegExp(`"${campo}"\\s*:\\s*-?[0-9.]+`, "g");
      const antes = cuerpo;
      cuerpo = cuerpo.replace(re, () => {
        cuenta.sustituciones++;
        return `"${campo}":${valor}`;
      });
      if (cuerpo === antes) cuenta[`falta_${campo}`] = true;
    }
    cuenta.respuestas++;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/javascript; charset=utf-8" },
      body: cuerpo,
    });
  });
  return cuenta;
}

/** Rumbo con al menos `metros` de campo libre por delante (`probeCollide` cada
 *  25 cm). Sin esto la medida es una carrera contra un muro: esprintando, seis
 *  segundos de tecla llegan al borde del tile y la velocidad media sale un 50 %
 *  baja — pasó midiendo esta misma PR. */
async function rumboLibre(ctx, metros = 30) {
  return ctx.page.evaluate((m) => {
    const p = window.__nefan.state().pos;
    const pc = window.__nefan.probeCollide;
    let mejor = { yaw: 0, libre: -1 };
    for (let i = 0; i < 72; i++) {
      const yaw = (i * Math.PI * 2) / 72;
      const dx = Math.sin(yaw);
      const dz = Math.cos(yaw);
      let libre = 0;
      for (let d = 0.25; d <= m; d += 0.25) {
        if (pc(p.x + dx * d, p.z + dz * d)) break;
        libre = d;
      }
      if (libre > mejor.libre) mejor = { yaw, libre };
    }
    return mejor;
  }, metros);
}

/** METROS POR SEGUNDO medidos en el juego: se encara un rumbo libre, se
 *  mantiene la tecla 50 fotogramas (≈ 0,8 s: 6,6 m esprintando, sobra sitio),
 *  se recortan cinco muestras por extremo y la velocidad es el camino interior
 *  partido por su tiempo. Nada de relojes de pared: el muestreador vive en el
 *  `rAF` de la página. */
async function medirVelocidad(ctx, { sprint, frames = 40 }) {
  const r = await rumboLibre(ctx);
  await ctx.nefan("setYaw", r.yaw);
  if (sprint) await ctx.nefan("inputDriver.press", "sprint");
  await ctx.nefan("inputDriver.press", "up");
  const muestras = await ctx.page.evaluate(
    (n) =>
      new Promise((res) => {
        const out = [];
        const tick = (t) => {
          const p = window.__nefan.state().pos;
          out.push([t, p.x, p.z]);
          if (out.length >= n) res(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
  await ctx.nefan("inputDriver.releaseAll");
  const m = muestras.slice(5, -5);
  let camino = 0;
  for (let i = 1; i < m.length; i++) camino += Math.hypot(m[i][1] - m[i - 1][1], m[i][2] - m[i - 1][2]);
  const seg = (m[m.length - 1][0] - m[0][0]) / 1000;
  return { vel: camino / seg, camino, seg, libre: r.libre };
}

/** ¿Ofrece el HUD hablar con el tabernero desde EXACTAMENTE `d` metros? El NPC
 *  pasea (vida ambiental, `state_update` a 60 Hz), así que el plantado se
 *  repite hasta que la distancia LEÍDA es la pedida; si no se consigue, se dice
 *  en vez de ensuciar el borde con una muestra de otra distancia. */
async function ofreceHablarA(ctx, d) {
  for (let intento = 0; intento < 120; intento++) {
    const puesto = await ctx.page.evaluate(
      (a) => {
        const n = window.__nefan.npcs().find((x) => x.id === a.id);
        if (!n) return false;
        window.__nefan.setPlayerPos(n.pos.x + a.d, n.pos.z);
        return true;
      },
      { id: TABERNERO, d },
    );
    if (!puesto) return { error: "el tabernero no está en el mundo" };
    const est = await ctx.page.evaluate(
      (a) =>
        new Promise((res) =>
          requestAnimationFrame(() => {
            const n = window.__nefan.npcs().find((x) => x.id === a.id);
            const p = window.__nefan.state().pos;
            res({
              dist: n ? Math.hypot(p.x - n.pos.x, p.z - n.pos.z) : NaN,
              acciones: window.__nefan.ui.actions().prompt.map((b) => b.label ?? b.id ?? String(b)),
            });
          }),
        ),
      { id: TABERNERO },
    );
    if (Math.abs(est.dist - d) < 0.005) {
      return { dist: est.dist, ofrece: est.acciones.some((l) => /hablar/i.test(l)), acciones: est.acciones };
    }
  }
  return { error: `el tabernero se movía: no se pudo fijar la distancia ${d} m` };
}

/** Mide la escalera del borde de la `E` a los dos lados de `alcance`. */
async function bordeDeLaE(ctx, alcance) {
  const dentro = await ofreceHablarA(ctx, Number((alcance - MARGEN_M).toFixed(3)));
  const fuera = await ofreceHablarA(ctx, Number((alcance + MARGEN_M).toFixed(3)));
  return { dentro, fuera };
}

const posicion = (ctx) => ctx.page.evaluate(() => ({ ...window.__nefan.state().pos }));
const vida = (ctx) =>
  ctx.page.evaluate(() => Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"));

/** MATA AL JUGADOR COMO MUERE DE VERDAD —el hostil que el motor suelta en el
 *  turno 2 le pega hasta tumbarle— y le devuelve a la vida con la R, que es la
 *  puerta del jugador. Nada de forzar la vida por el sim: lo que se mide es el
 *  camino que recorre quien juega.
 *
 *  La R es one-shot y el bucle solo la aplica con el jugador ya muerto PARA EL
 *  SIM (el HUD puede ir un tick por delante), así que se vuelve a pulsar en
 *  cada muestra. Todo por ESTADO: la vida del HUD, nunca un reloj. */
async function morirYVolver(ctx) {
  const hostil = await ctx.waitFor(
    "el motor suelta un hostil con el que morir",
    () => window.__nefan.enemies().find((e) => e.alive !== false) ?? null,
    90_000,
  );
  ctx.log(`hostil: ${hostil.label ?? hostil.id} (${hostil.hp}/${hostil.maxHp})`);
  await acercarse(ctx, hostil.id, { objetivo: 1.2 });
  // Y se le deja pegar: el jugador se queda encarado y quieto, que es como se
  // muere en este bench. Sin atacar de vuelta, para no matarle antes a él.
  const muerto = await ctx.waitFor(
    "el hostil mata al jugador",
    (id) => {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      const p = window.__nefan.state().pos;
      if (e && p) window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      return hp === 0 ? { hp, pos: { ...p } } : null;
    },
    120_000,
    hostil.id,
  );
  const cayoEn = muerto.pos;
  const vuelto = await ctx.waitFor(
    "el jugador vuelve a la vida tras pulsar R",
    () => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "0");
      if (hp > 0) return { hp, pos: { ...window.__nefan.state().pos } };
      window.__nefan.inputDriver.queueRespawn();
      return null;
    },
    20_000,
  );
  return { cayoEn, muerto: muerto.hp, ...vuelto };
}

export default async function (ctx) {
  const delArbol = configDelArbol();
  ctx.log(`config del árbol: ${JSON.stringify(delArbol)}`);

  // ── 1 · La velocidad del juego ES la del config ──────────────────────────
  await nuevaPartida(ctx, { charMode: "vector" });
  await comenzar(ctx);
  const base = {
    andar: await medirVelocidad(ctx, { sprint: false }),
    sprint: await medirVelocidad(ctx, { sprint: true }),
  };
  const teoricoAndar = delArbol.walk_speed * delArbol.speed_scale;
  const teoricoSprint = delArbol.sprint_speed * delArbol.speed_scale;
  ctx.expect(
    `andando, el jugador va a walk_speed × speed_scale = ${teoricoAndar.toFixed(2)} m/s`,
    Math.abs(base.andar.vel - teoricoAndar) < teoricoAndar * TOL_REL,
    `medido ${base.andar.vel.toFixed(4)} m/s (${base.andar.camino.toFixed(2)} m / ${base.andar.seg.toFixed(2)} s, ${base.andar.libre} m libres)`,
  );
  ctx.expect(
    `esprintando, sprint_speed × speed_scale = ${teoricoSprint.toFixed(2)} m/s`,
    Math.abs(base.sprint.vel - teoricoSprint) < teoricoSprint * TOL_REL,
    `medido ${base.sprint.vel.toFixed(4)} m/s (${base.sprint.camino.toFixed(2)} m / ${base.sprint.seg.toFixed(2)} s, ${base.sprint.libre} m libres)`,
  );

  // ── 2 · Con OTRO speed_scale servido, el juego cambia en proporción ──────
  const escala = Number((delArbol.speed_scale * FACTOR).toFixed(4));
  const cuenta = await servirConfigCon(ctx, { speed_scale: escala });
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { charMode: "vector" });
  await comenzar(ctx);
  ctx.expect(
    `el config que recibe el cliente se sirvió con speed_scale = ${escala} (si no, lo de abajo no mide nada)`,
    cuenta.sustituciones > 0 && !cuenta.falta_speed_scale,
    JSON.stringify(cuenta),
  );
  const conEscala = {
    andar: await medirVelocidad(ctx, { sprint: false }),
    sprint: await medirVelocidad(ctx, { sprint: true }),
  };
  for (const [que, m, teorico] of [
    ["andando", conEscala.andar, teoricoAndar * FACTOR],
    ["esprintando", conEscala.sprint, teoricoSprint * FACTOR],
  ]) {
    ctx.expect(
      `${que}, el trayecto medido cupo en el campo libre (si no, lo que se mide es un muro)`,
      m.camino < m.libre,
      `recorrió ${m.camino.toFixed(2)} m con ${m.libre} m libres por delante`,
    );
    ctx.expect(
      `con speed_scale × ${FACTOR} en el config, ${que} son ${teorico.toFixed(2)} m/s — la velocidad NO está escrita en el cliente`,
      Math.abs(m.vel - teorico) < teorico * TOL_REL,
      `medido ${m.vel.toFixed(4)} m/s (${m.camino.toFixed(2)} m / ${m.seg.toFixed(2)} s, ${m.libre} m libres)`,
    );
  }

  // ── 3 · El alcance de la E también sale del config ───────────────────────
  const cuenta3 = await servirConfigCon(ctx, { interact_range_m: ALCANCE_CORTO_M });
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { charMode: "vector" });
  await comenzar(ctx);
  ctx.expect(
    `el config que recibe el cliente se sirvió con interact_range_m = ${ALCANCE_CORTO_M}`,
    cuenta3.sustituciones > 0 && !cuenta3.falta_interact_range_m,
    JSON.stringify(cuenta3),
  );
  const borde = await bordeDeLaE(ctx, ALCANCE_CORTO_M);
  ctx.expect(
    `con interact_range_m = ${ALCANCE_CORTO_M} m se ofrece hablar a ${(ALCANCE_CORTO_M - MARGEN_M).toFixed(2)} m`,
    borde.dentro.ofrece === true,
    JSON.stringify(borde.dentro),
  );
  ctx.expect(
    `…y a ${(ALCANCE_CORTO_M + MARGEN_M).toFixed(2)} m ya no`,
    borde.fuera.ofrece === false && !borde.fuera.error,
    JSON.stringify(borde.fuera),
  );
  const aDosCuarenta = await ofreceHablarA(ctx, 2.4);
  ctx.expect(
    "a 2,4 m —que con el config de verdad SÍ ofrece— ya no se ofrece: el 2,5 no vive en el cliente",
    aDosCuarenta.ofrece === false && !aDosCuarenta.error,
    JSON.stringify(aDosCuarenta),
  );
  await ctx.page.unroute("**/combat_config.json*");

  // ── 4 · Reaparecer devuelve a un punto que se puede pisar ────────────────
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { charMode: "vector" });
  await comenzar(ctx);
  const alcanceReal = configDelArbol().interact_range_m;
  const bordeReal = await bordeDeLaE(ctx, alcanceReal);
  ctx.expect(
    `sin interceptar, el borde vuelve a ser el del fichero (${alcanceReal} m): ofrece a ${(alcanceReal - MARGEN_M).toFixed(2)} y no a ${(alcanceReal + MARGEN_M).toFixed(2)}`,
    bordeReal.dentro.ofrece === true && bordeReal.fuera.ofrece === false,
    JSON.stringify(bordeReal),
  );

  const r = await morirYVolver(ctx);
  ctx.expect("el jugador estaba MUERTO antes de la R (si no, no hay reaparición que medir)", r.muerto === 0, `vida ${r.muerto}`);
  ctx.expect(
    "reaparece con la vida llena",
    r.hp > 0,
    `hp ${r.hp}`,
  );
  const dist = Math.hypot(r.pos.x - r.cayoEn.x, r.pos.z - r.cayoEn.z);
  ctx.expect(
    "vuelve EXACTAMENTE donde cayó (escalón 1: el sitio libre gana)",
    dist < 0.01,
    `cayó en (${r.cayoEn.x.toFixed(3)}, ${r.cayoEn.z.toFixed(3)}) · volvió a (${r.pos.x.toFixed(3)}, ${r.pos.z.toFixed(3)}) · ${dist.toFixed(3)} m`,
  );
  // La solidez del punto se pregunta con el jugador EN OTRO SITIO: `collidesAt`
  // es una consulta de MOVIMIENTO desde donde está el jugador, así que
  // preguntarla con él encima siempre diría «libre» y el aserto no valdría nada.
  const solidoDesdeFuera = await ctx.page.evaluate((p) => {
    const antes = { ...window.__nefan.state().pos };
    window.__nefan.setPlayerPos(p.x + 6, p.z + 6);
    const s = window.__nefan.probeCollide(p.x, p.z);
    window.__nefan.setPlayerPos(antes.x, antes.z);
    return s;
  }, r.pos);
  ctx.expect(
    "el punto en el que reaparece se puede PISAR (visto desde fuera, no desde encima)",
    solidoDesdeFuera === false,
    `probeCollide(${r.pos.x.toFixed(2)}, ${r.pos.z.toFixed(2)}) desde 8,5 m = ${solidoDesdeFuera}`,
  );
  await ctx.shot("reaparecido");

  // Lo que este guion NO puede afirmar, MEDIDO: con el jugador metido a la
  // fuerza dentro de una huella sólida, su propia posición le sigue pareciendo
  // libre, así que el escalón 2 (centro del tile) no se alcanza jugando.
  const dentroDeUnSolido = await ctx.page.evaluate(() => {
    const objs = window.__nefan.objects().filter((o) => o.sizeXZ);
    const antes = { ...window.__nefan.state().pos };
    for (const o of objs) {
      window.__nefan.setPlayerPos(antes.x, antes.z);
      const desdeLejos = window.__nefan.probeCollide(o.pos.x, o.pos.z);
      if (!desdeLejos) continue;
      window.__nefan.setPlayerPos(o.pos.x, o.pos.z);
      const desdeSiMismo = window.__nefan.probeCollide(o.pos.x, o.pos.z);
      window.__nefan.setPlayerPos(antes.x, antes.z);
      return { objeto: o.label, desdeLejos, desdeSiMismo };
    }
    return null;
  });
  ctx.log(
    dentroDeUnSolido
      ? `⚠ escalón 2 inalcanzable desde el cliente: «${dentroDeUnSolido.objeto}» es sólido visto desde fuera ` +
          `(${dentroDeUnSolido.desdeLejos}) y NO lo es con el jugador encima (${dentroDeUnSolido.desdeSiMismo}) — ` +
          `collidesAt es una consulta de movimiento, no de punto (world/collision.ts:74-84)`
      : "no había ningún objeto sólido con el que medir el escalón 2 en esta partida",
  );

  // ── 5 · Un config IMPOSIBLE no deja al jugador delante de una negra ──────
  // `speed_scale: -1` pasa el tipo y no pasa el rango: el jugador andaría hacia
  // atrás. Antes de #539 cargaba sin una queja; y un config mutilado tiraba la
  // evaluación de la raíz antes de que existiera un solo pintor de avisos.
  // Y el cliente MUERE al hacerlo, que es media medida: sin esos números no
  // hay partida, y seguir con un default escondido sería la mentira que #241
  // cerró. La excepción no capturada es LA MEDIDA, no un defecto — se declara
  // con su motivo, y si no ocurriera este guion saldría rojo por no haberla
  // provocado.
  ctx.excepcionEsperada(
    /CombatData: combat_config\.json: player\.speed_scale/,
    "el bloque 5 sirve un `speed_scale` imposible a propósito: el cliente aborta su arranque —eso es " +
      "lo que se está midiendo— y el motivo llega al muro y al registro antes de morir",
  );
  const cuenta5 = await servirConfigCon(ctx, { speed_scale: -1 });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  const muro = await ctx.waitFor(
    "5 · con un `speed_scale` imposible, el jugador tiene un muro delante y no una pantalla negra",
    () => {
      const el = document.getElementById("narrative-loader");
      if (!el || !el.classList.contains("visible")) return null;
      return {
        error: el.classList.contains("error"),
        titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
        detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
        registro: document.getElementById("error-log")?.textContent ?? "",
        arrancado: Boolean(window.__nefan),
      };
    },
    30_000,
  );
  ctx.expect(
    `5 · el config que recibe el cliente se sirvió con speed_scale = -1 (si no, esto no mide nada)`,
    cuenta5.sustituciones > 0 && !cuenta5.falta_speed_scale,
    JSON.stringify(cuenta5),
  );
  ctx.log(`5 · muro: ${JSON.stringify({ ...muro, registro: muro.registro.slice(0, 160) })}`);
  ctx.expect("5 · el muro es de ERROR, no el de espera del motor", muro.error === true, JSON.stringify(muro));
  ctx.expect(
    "5 · el detalle dice el CAMPO, el VALOR, el FICHERO y qué pasaría — todo lo que hace falta para arreglarlo",
    muro.detalle.includes("player.speed_scale") &&
      muro.detalle.includes("vale -1") &&
      muro.detalle.includes("combat_config.json") &&
      muro.detalle.includes("mayor que 0"),
    muro.detalle,
  );
  ctx.expect(
    "5 · …y el mismo motivo queda en el registro de errores (los dos canales de la casa, una sola verdad)",
    muro.registro.includes("player.speed_scale"),
    muro.registro.slice(0, 300),
  );
  ctx.expect(
    "5 · el cliente NO arrancó: sin esos números no hay partida, y eso es lo que el muro está contando",
    muro.arrancado === false,
    `window.__nefan ${muro.arrancado ? "existe" : "ausente"}`,
  );
  await ctx.shot("93-el-config-imposible-dice-por-que");

  // Control: quitada la intercepción, el juego vuelve a arrancar. Sin esto, el
  // bloque 5 sería igual de verde con el cliente roto por cualquier otra cosa.
  await ctx.page.unroute("**/combat_config.json*");
  await recargarAlTitulo(ctx);
  ctx.expect(
    "5 · control: con el config de verdad el título vuelve y no hay muro puesto",
    await ctx.page.evaluate(
      () => Boolean(window.__nefan) && !document.getElementById("narrative-loader")?.classList.contains("visible"),
    ),
    "el control es lo que separa «el muro lo puso el config» de «el cliente está roto»",
  );
}
