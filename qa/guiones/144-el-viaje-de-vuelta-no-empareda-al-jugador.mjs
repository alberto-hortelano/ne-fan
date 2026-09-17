/** EL VIAJE DE VUELTA NO EMPAREDA AL JUGADOR — #616 en el NAVEGADOR.
 *
 *  ## Por qué nace, y qué agujero tapa
 *
 *  La PR G2 de la tanda G arregla la mitad de ARRIBA de #616: el bridge ya no
 *  difunde como `ready.spawn` el centro del `anchor.rect` de un lugar sin
 *  mirar si ahí cabe alguien. Su candado (`qa/el-viaje-no-mete-a-nadie-dentro.mjs`)
 *  conduce el handler del bridge y es bueno, pero se queda en el bridge: nadie
 *  comprobaba el observable de QUIEN JUEGA —«llego a mi destino y no puedo dar
 *  un paso»— en el juego de verdad.
 *
 *  Y el banco no podía verlo, por DOS razones y no una:
 *
 *   1. **Geometría.** El motor falso sí fija `anchor.rect` (`map_upsert_place`,
 *      el canal real), pero los dos rects que usa caen en hueco: el de la
 *      taberna (`BOOTSTRAP_PLACE_RECT`) es el de un volumen **cutaway**
 *      —medido: su centro (0, −4) sale `ocupado = false`— y el del lugar
 *      anclado (`ANCHORED_PLACE_RECT`) cae en campo abierto al sur de su casa
 *      —centro (64, 7), `ocupado = false`—. Los guiones 08 y 09 recorren el
 *      viaje entero sin poder verlo.
 *   2. **La sonda.** El 09 afirma *«el punto de aparición de la vuelta no es
 *      sólido»* con `probeCollide(pos.x, pos.z)`, y eso es
 *      `collidesAt(playerPos → playerPos)`: un movimiento de un punto a SÍ
 *      MISMO. La regla de celdas exime las que ya se solapaban, así que ese
 *      aserto vale **false también en el centro macizo de un edificio**
 *      (medido: `blocksMove(p, p) = false` a la vez que los cuatro pasos de
 *      0,5 m están bloqueados). Ese aserto no puede ponerse rojo por #616.
 *
 *  Este guion arregla las dos: **pone el ancla sobre un edificio MACIZO** por
 *  el State API —el mismo `map_upsert_place` que usa el motor, que es lo que
 *  #465 quiere que el motor real haga— y juzga con el observable del jugador,
 *  no con `probeCollide`.
 *
 *  ## El edificio elegido, y por qué ese
 *
 *  `casa_lenador` del tile de bootstrap: `kind: "building"` declarado como
 *  ENTITY (sin volume), `cell [92, 82]`, `footprint [20, 14]` — 10 × 7 m de
 *  huella rasterizada entera por `planCollisionGrid`, o sea macizo y más ancho
 *  que el cuerpo del jugador por los dos ejes. Es el gemelo exacto de los 13
 *  `building` de `robledo_tile` y `puerto_tile` que mide el candado headless.
 *
 *  ## Lo que afirma, andando
 *
 *   1. CONTROL · el mundo tiene ese edificio, y el bridge MOVIÓ el punto de
 *      aparición — `sitioParaAparecer` devuelve el candidato intacto cuando ya
 *      está libre, así que un desplazamiento de 0 delata un ancla sobre aire.
 *   2. El jugador aterriza FUERA de su planta (la puerta, no la cocina) y
 *      cerca (≤ 8 m): el bridge no lo mandó a otro barrio.
 *   3. No está emparedado: de los cuatro pasos de 0,5 m, al menos uno pasa.
 *   4. Y ANDA: mantiene una tecla y recorre ≥ 1,5 m de verdad.
 *
 *  ## Probado en negativo (dos, y miden cosas distintas)
 *
 *    QA_616_CRUDO=1 node qa/run.mjs 144
 *      tras llegar, teletransporta al jugador al centro CRUDO del rect —que
 *      es donde lo dejaba el bridge hasta esta PR— y juzga ahí. Los asertos
 *      1, 2, 3 y 4 tienen que ponerse ROJOS: si no, este guion no sabe
 *      distinguir la puerta de la cárcel y no candaría nada.
 *
 *    QA_616_ANCLA_LIBRE=1 node qa/run.mjs 144
 *      deja el ancla donde la pone el motor falso (la taberna cutaway, hueca).
 *      El CONTROL tiene que ponerse ROJO —desplazamiento 0— y con él el aserto
 *      2: es la prueba de que este guion no pasa verde sobre un mundo de aire,
 *      y la medida de por qué los guiones 08 y 09 no ven #616.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

/** El mapa se MUTA (el ancla del lugar de origen), así que la partida nace
 *  virgen y el motor falso vuelve a su turno 0. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** El lugar del tile de arranque (`labs/narrative/fake-scenes.ts`), que es el
 *  que el jugador tiene como «vuelta» desde su primer destino. */
const ORIGEN = "taberna_bench_place";
/** La casa del leñador del tile de bootstrap: `cell` + `footprint` tal cual
 *  los declara el motor falso. Es el rect que #465 quiere que el motor real
 *  escriba, puesto sobre un macizo en vez de sobre un hueco. */
const EDIFICIO = "casa_lenador";
const RECT_MACIZO = [92, 82, 20, 14];
/** El de siempre, el de la taberna CUTAWAY: el negativo del control. */
const RECT_HUECO = [52, 48, 24, 16];

const CRUDO = process.env.QA_616_CRUDO === "1";
const ANCLA_LIBRE = process.env.QA_616_ANCLA_LIBRE === "1";

/** Cuánto puede alejarse el spawn del centro del rect y seguir siendo «la
 *  puerta»: la marcha de `sitioParaAparecer` sale por la cara más cercana, y
 *  sobre los 13 edificios de las fixtures la mayor medida es 3,90 m. Esta casa
 *  es de 10 × 7 m, así que 8 m cubre el peor eje con holgura. */
const TOPE_PUERTA_M = 8;
/** Lo que tiene que andar para que «se mueve» no sea ruido de un frame. */
const ANDADO_MINIMO_M = 1.5;

/** Llamada al State API tal cual la hace narrative-mcp. */
async function api(method, path, body) {
  const res = await fetch(`${URLS.state_api}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { __raw: text };
  }
  return { status: res.status, body: json };
}

/** Lo que el jugador puede ver de sí mismo. */
const mirar = () => ({
  tile: window.__nefan.currentTile,
  scene_id: window.__nefan.scene?.scene_id ?? null,
  pos: window.__nefan.state().pos,
  blocked: window.__nefan.state().blocked,
  // HACIA DÓNDE mira al llegar: el viaje NO toca el yaw, así que se puede
  // aterrizar de cara al muro del lugar al que se acaba de viajar. No es
  // aserto —no hay contrato que lo pida— pero sin este dato la captura de la
  // llegada no se puede leer.
  forward: window.__nefan.state().forward,
  exits: (window.__nefan.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
});

/** Pulsa el botón del panel que nombra `nombre` (el camino del jugador). */
async function pulsarSalida(ctx, nombre) {
  const botones = await ctx.page.$$eval("#travel-panel button.travel-exit", (bs) =>
    bs.map((b) => b.textContent ?? ""),
  );
  const idx = botones.findIndex((t) => t.includes(nombre));
  if (idx < 0) throw new Error(`el panel no ofrece "${nombre}"; ofrece: ${JSON.stringify(botones)}`);
  await ctx.page.$$eval("#travel-panel button.travel-exit", (bs, i) => bs[i].click(), idx);
}

/** Espera a que el jugador esté en otro tile. Igual que el 09: el viaje
 *  termina cuando el JUGADOR se ha movido, no cuando llega la escena. */
async function esperarLlegada(ctx, tileAnterior, desc) {
  return ctx.waitFor(
    desc,
    (anterior) => {
      const t = window.__nefan.currentTile;
      const v = window.__nefan.viaje;
      if (v && v.error) return { __roto: v };
      if (!t || t === anterior) return null;
      return {
        tile: t,
        scene_id: window.__nefan.scene?.scene_id ?? null,
        pos: window.__nefan.state().pos,
        blocked: window.__nefan.state().blocked,
        exits: (window.__nefan.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
      };
    },
    240_000,
    tileAnterior,
  );
}

export default async function (ctx) {
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "image" });
  await comenzar(ctx);

  const partida = await ctx.page.evaluate(mirar);
  ctx.log(`partida: ${partida.tile} · salidas ${JSON.stringify(partida.exits.map((e) => e.place_id))}`);

  // ── 1 · CONTROL: el mundo tiene el edificio, y el ancla va a su centro ───
  const caja = await ctx.page.evaluate((id) => {
    const o = (window.__nefan.scene?.objects ?? []).find((x) => x.id === id);
    return o ? { id: o.id, x: o.position[0], z: o.position[2], sx: o.scale[0], sz: o.scale[2] } : null;
  }, EDIFICIO);
  if (!caja) {
    ctx.sinMedir(
      `sin «${EDIFICIO}» en el tile de bootstrap no hay macizo sobre el que anclar el lugar, ` +
        `así que este guion no puede medir #616 en el navegador`,
    );
  }
  ctx.expect(
    `el tile de arranque trae el edificio macizo «${EDIFICIO}»`,
    caja.sx >= 2 && caja.sz >= 2,
    `${JSON.stringify(caja)} — por debajo de 2 m por eje, de un macizo así se sale andando ` +
      `y este guion dejaría de medir #616`,
  );
  ctx.log(`${EDIFICIO}: centro (${caja.x.toFixed(2)}, ${caja.z.toFixed(2)}) · huella ${caja.sx} × ${caja.sz} m`);

  const origen = await api("GET", `/map/place/${ORIGEN}`);
  ctx.expect(`el State API conoce el lugar de origen (${ORIGEN})`, origen.status === 200, JSON.stringify(origen.status));
  if (origen.status !== 200) return;
  const p = origen.body.place;

  // ── 2 · Ida: al primer destino que ofrece el panel ───────────────────────
  if (!partida.exits.length) {
    ctx.expect("el panel «Salidas» ofrece un destino desde el punto de partida", false, "[]");
    return;
  }
  const destino = partida.exits[0];
  await pulsarSalida(ctx, destino.name);
  const enDestino = await esperarLlegada(ctx, partida.tile, "el jugador llega al tile del destino").catch(
    (err) => {
      ctx.expect(`clicar «${destino.name}» lleva al jugador al destino`, false, err.message);
      return null;
    },
  );
  if (!enDestino || enDestino.__roto) {
    await ctx.shot("ida-fallida");
    ctx.expect("la ida llega", false, JSON.stringify(enDestino));
    return;
  }
  ctx.log(`en el destino: ${enDestino.tile}`);

  // ── 3 · El motor ancla el lugar de origen SOBRE el edificio macizo ───────
  // Es el canal REAL (`map_upsert_place`), el mismo que usa el motor del banco
  // para fijar el rect de la taberna. Lo único que cambia es DÓNDE.
  const rect = ANCLA_LIBRE ? RECT_HUECO : RECT_MACIZO;
  const upsert = await api("POST", "/map/place", {
    id: p.id,
    kind: p.kind,
    parent_id: p.parent_id,
    name: p.name,
    anchor: { tx: 0, ty: 0, rect },
  });
  ctx.log(`ancla de ${p.id} → rect ${JSON.stringify(rect)} · POST ${upsert.status}`);
  ctx.expect("el motor puede anclar el lugar sobre el edificio (map_upsert_place)", upsert.status === 200,
    JSON.stringify(upsert.body).slice(0, 200));
  if (upsert.status !== 200) return;

  // ── 4 · Vuelta: el viaje que hasta esta PR dejaba al jugador dentro ──────
  const vuelta = enDestino.exits.find((e) => e.place_id === ORIGEN) ?? enDestino.exits[0];
  ctx.expect("el panel ofrece la vuelta al lugar de origen", Boolean(vuelta), JSON.stringify(enDestino.exits));
  if (!vuelta) return;
  await pulsarSalida(ctx, vuelta.name);
  const regreso = await esperarLlegada(ctx, enDestino.tile, "el jugador vuelve al tile de origen").catch(
    (err) => {
      ctx.expect(`clicar «${vuelta.name}» devuelve al jugador al origen`, false, err.message);
      return null;
    },
  );
  if (!regreso || regreso.__roto) {
    await ctx.shot("vuelta-fallida");
    ctx.expect("la vuelta llega", false, JSON.stringify(regreso));
    return;
  }

  // El punto que el bridge difundía hasta esta PR: el centro crudo del rect.
  const crudo = await ctx.page.evaluate((r) => {
    const g = window.__nefan.scene.terrain_grid;
    const [ox, oz] = g.origin;
    const [col, row, w, h] = r;
    return { x: ox + (col + w / 2) * g.meters_per_cell, z: oz + (row + h / 2) * g.meters_per_cell };
  }, rect);
  ctx.log(`centro crudo del ancla: (${crudo.x.toFixed(2)}, ${crudo.z.toFixed(2)})`);

  // EL SABOTAJE: donde el bridge dejaba al jugador hasta esta PR. Solo en
  // negativo — el camino normal no toca la posición del jugador.
  if (CRUDO) {
    await ctx.nefan("setPlayerPos", crudo.x, crudo.z);
    ctx.log(`QA_616_CRUDO: jugador puesto en el centro CRUDO (${crudo.x.toFixed(2)}, ${crudo.z.toFixed(2)})`);
  }
  const llegada = await ctx.page.evaluate(mirar);
  ctx.log(
    `de vuelta: ${llegada.tile} · pos ${JSON.stringify(llegada.pos)} · blocked ${JSON.stringify(llegada.blocked)}` +
      ` · mirando ${JSON.stringify(llegada.forward)}`,
  );
  await ctx.shot("donde-deja-el-viaje");

  // Diagnóstico, NO aserto: la sonda con la que el 09 dice medir esto vale
  // `false` también dentro del macizo, porque es un movimiento de un punto a
  // sí mismo. Se imprime para que nadie vuelva a confiarle este invariante.
  const probe = await ctx.nefan("probeCollide", llegada.pos.x, llegada.pos.z);
  ctx.log(`probeCollide(pos) = ${probe} — vale false también emparedado: no es una medida de #616`);

  // ── 5 · Fuera de la huella, y cerca: la puerta, no la cocina ─────────────
  const dx = Math.abs(llegada.pos.x - caja.x);
  const dz = Math.abs(llegada.pos.z - caja.z);
  // Los PIES fuera de la planta del edificio. Sin sumar el radio: la huella
  // pintada y la rasterizada no tienen por qué casar al centímetro (render ≠
  // colisión es política de la casa), y lo que #616 dice es «está DENTRO».
  const fuera = dx > caja.sx / 2 || dz > caja.sz / 2;
  const aLaFachada = Math.max(dx - caja.sx / 2, dz - caja.sz / 2);
  // CONTROL · el bridge MOVIÓ el punto. `sitioParaAparecer` devuelve el
  // candidato sin tocar cuando está libre, así que un desplazamiento de 0
  // significa que el ancla NO estaba sobre nada sólido: este guion estaría
  // midiendo aire y no podría ponerse rojo por #616.
  const desplazado = Math.hypot(llegada.pos.x - crudo.x, llegada.pos.z - crudo.z);
  ctx.expect(
    "CONTROL · el centro crudo del ancla estaba OCUPADO: el bridge movió el punto de aparición",
    desplazado >= 0.5,
    `${desplazado.toFixed(2)} m entre el centro crudo (${crudo.x.toFixed(2)}, ${crudo.z.toFixed(2)}) ` +
      `y donde dejó al jugador (${llegada.pos.x.toFixed(2)}, ${llegada.pos.z.toFixed(2)})`,
  );
  const d = Math.hypot(llegada.pos.x - caja.x, llegada.pos.z - caja.z);
  ctx.expect(
    `el viaje deja al jugador FUERA de la planta de «${EDIFICIO}»`,
    fuera,
    `pos (${llegada.pos.x.toFixed(2)}, ${llegada.pos.z.toFixed(2)}) · centro (${caja.x.toFixed(2)}, ${caja.z.toFixed(2)})` +
      ` · huella ${caja.sx} × ${caja.sz} m · |Δ| (${dx.toFixed(2)}, ${dz.toFixed(2)})`,
  );
  // Diagnóstico de DIRECCIÓN DE ARTE, no aserto: a cuántos metros de la
  // fachada PINTADA queda la cámara. `sitioParaAparecer` deja el cuerpo
  // TANGENTE al sólido, así que esto vale el radio del jugador clavado — y el
  // near plane de la cámara fps es 0,3 m (`renderer/fps-gl.ts`): 0,1 m de
  // margen antes de que llegar de viaje recorte el muro.
  ctx.log(`de la cámara a la fachada pintada: ${aLaFachada.toFixed(2)} m (near plane de la fps: 0,3 m)`);
  ctx.expect(
    "y a la PUERTA del lugar, no en otro barrio",
    d <= TOPE_PUERTA_M,
    `${d.toFixed(2)} m del centro del rect (tope ${TOPE_PUERTA_M})`,
  );

  // ── 6 · No está emparedado: algún paso de 0,5 m pasa ─────────────────────
  const libres = Object.entries(llegada.blocked).filter(([, b]) => !b).map(([k]) => k);
  ctx.expect(
    "el jugador puede dar un paso: no está emparedado en los cuatro rumbos",
    libres.length > 0,
    `rumbos libres: ${JSON.stringify(libres)} · blocked ${JSON.stringify(llegada.blocked)}`,
  );

  // ── 7 · Y ANDA de verdad ────────────────────────────────────────────────
  // Se prueban los cuatro rumbos porque el movimiento es relativo al facing y
  // el viaje no lo cambia: quedarse quieto con UNA tecla no demuestra cárcel.
  // El veredicto es el MÁXIMO medido, no el resultado de las esperas, para que
  // no haya hueco entre el umbral de la espera y el del aserto.
  const partidaPos = { ...llegada.pos };
  const andados = {};
  for (const tecla of ["up", "down", "left", "right"]) {
    await ctx.absorbe(
      `cortafuegos del paseo con «${tecla}»: lo andado se MIDE al soltar y se afirma abajo, ` +
        `con el máximo de los cuatro rumbos`,
      () =>
        ctx.holdUntil(
          tecla,
          `andar con «${tecla}»`,
          (o) => {
            const q = window.__nefan.state().pos;
            const m = Math.hypot(q.x - o.x, q.z - o.z);
            return m >= o.min ? m : null;
          },
          { sim: 3 },
          { x: partidaPos.x, z: partidaPos.z, min: ANDADO_MINIMO_M },
        ),
    );
    const q = await ctx.page.evaluate(() => window.__nefan.state().pos);
    andados[tecla] = Math.hypot(q.x - partidaPos.x, q.z - partidaPos.z);
    if (andados[tecla] >= ANDADO_MINIMO_M) break;
  }
  const mejor = Math.max(...Object.values(andados));
  ctx.expect(
    "y el jugador ANDA desde donde el viaje lo dejó",
    mejor >= ANDADO_MINIMO_M,
    `metros por rumbo ${JSON.stringify(Object.fromEntries(Object.entries(andados).map(([k, v]) => [k, +v.toFixed(2)])))}` +
      ` · mínimo exigido ${ANDADO_MINIMO_M} m`,
  );
  await ctx.shot("tras-andar");
}
