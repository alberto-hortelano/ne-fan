/** Los tres huecos de la primera persona, jugados.
 *
 *  La vista fps es la única que va a sobrevivir, y hasta esta tanda le
 *  faltaban tres cosas que la oblicua sí daba y que no son adorno:
 *
 *   1. **Telegraph del ataque**: la distancia y la precisión DECIDEN el daño
 *      (`calidad = factor_distancia × factor_precision × …`), así que sin
 *      verlo el combate es a ciegas. Va en el mundo, no en el HUD.
 *   2. **Nombre del NPC**: sin él no sabes con quién vas a hablar antes de
 *      pulsar E; y la mirilla no decía nunca que hubiera algo delante.
 *   3. **Frontera del mundo**: el velo direccional de la oblicua era una
 *      banda de HUD. En 1ª persona el mundo se acaba AHÍ, así que es un muro
 *      de niebla, y su disipación —no un destello— es el aviso de que el
 *      vecino ya existe.
 *
 *  El guion assertea ESTADO (`__nefan.fps()`, nodos del DOM), nunca píxeles:
 *  el muro de niebla no se puede comprobar leyendo el canvas WebGL, y la
 *  crítica visual (que lea como niebla y no como una carta) es del usuario.
 *  Las capturas quedan en qa/capturas/ para eso.
 *
 *  Cero créditos: preset 5, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", view: "fps", charMode: "vector" });
  await comenzar(ctx);

  // three entra por import dinámico: hasta que llega no hay nada que mirar.
  const inicial = await ctx.waitFor(
    "la vista fps termina de cargar three y pinta el tile",
    () => {
      const f = window.__nefan.fps();
      return f && f.ready && f.visible && f.tiles.length > 0 ? f : null;
    },
    60_000,
  );
  ctx.log(`fps lista · tiles ${JSON.stringify(inicial.tiles)} · activo ${inicial.activeTile}`);
  ctx.expect("la partida arranca en primera persona", (await ctx.nefan("status")).view === "fps");
  ctx.expect(
    "y arranca limpia: sin telegraph y sin velo",
    inicial.telegraph === null && inicial.veil === null,
    JSON.stringify({ telegraph: inicial.telegraph, veil: inicial.veil }),
  );

  // ── 1. Telegraph del ataque ─────────────────────────────────────────────
  // Ataque lento a propósito (wind-up 0.7 s): el rápido dura 0.15 s y lo que
  // se mide es que EXISTE durante el wind-up, no lo corto que es.
  const catalogo = (await ctx.nefan("state")).attackCatalog;
  const lento = catalogo.includes("heavy") ? "heavy" : catalogo[catalogo.length - 1];
  await ctx.nefan("inputDriver.selectAttack", lento);
  await ctx.nefan("inputDriver.queueAttack");
  const traza = await ctx.page.evaluate(
    () =>
      new Promise((res) => {
        const muestras = [];
        const t0 = performance.now();
        // setTimeout y no rAF: en headless la pestaña no está "visible" y el
        // rAF de la página está pausado (el juego corre con ?raf=timer).
        const tick = () => {
          const t = window.__nefan.fps()?.telegraph ?? null;
          muestras.push(t && { mode: t.mode, opacity: t.opacity, optimalDistance: t.optimalDistance });
          if (performance.now() - t0 > 2500) return res(muestras);
          setTimeout(tick, 16);
        };
        tick();
      }),
  );
  const conTelegraph = traza.filter(Boolean);
  const windup = conTelegraph.filter((m) => m.mode === "windup");
  ctx.log(`telegraph: ${conTelegraph.length}/${traza.length} muestras · modos ${[...new Set(conTelegraph.map((m) => m.mode))].join("+")}`);
  ctx.expect(`el telegraph aparece durante el wind-up de "${lento}"`, windup.length > 0, `${windup.length} muestras`);
  ctx.expect(
    "y lleva la distancia óptima real del ataque (no una constante decorativa)",
    windup.length > 0 && windup[0].optimalDistance > 0,
    JSON.stringify(windup[0] ?? null),
  );
  ctx.expect(
    "el impacto lo tiñe y luego se apaga solo",
    conTelegraph.some((m) => m.mode === "impact") && traza[traza.length - 1] === null,
    `último: ${JSON.stringify(traza[traza.length - 1])}`,
  );
  ctx.expect(
    "y no queda encendido para siempre",
    (await ctx.nefan("fps")).telegraph === null,
    JSON.stringify((await ctx.nefan("fps")).telegraph),
  );

  // ── 2. Nombre del NPC y mirilla ─────────────────────────────────────────
  const npcs = await ctx.nefan("npcs");
  ctx.expect("el tile trae algún NPC con el que hablar", npcs.length > 0, `${npcs.length}`);
  if (npcs.length > 0) {
    const npc = npcs[0];
    // Frente al NPC a 4 m, mirándolo: es la situación en la que el jugador
    // pulsa E, y en la que el nombre tiene que estar. El NPC tiene vida
    // ambiental y camina, así que la mirada se recalcula en cada intento —
    // que es exactamente lo que hace una persona jugando.
    await ctx.nefan("setPlayerPos", npc.pos.x, npc.pos.z + 4);
    const etiqueta = await ctx.waitFor(
      "el nombre del NPC aparece sobre su cabeza y la mirilla se enciende",
      (id) => {
        const n = window.__nefan.npcs().find((x) => x.id === id);
        if (!n) return null;
        const p = window.__nefan.state().pos;
        window.__nefan.setYaw(Math.atan2(n.pos.x - p.x, n.pos.z - p.z));
        const el = document.querySelector(`#world-labels [data-label-id="${id}"]`);
        const mirilla = document.getElementById("reticle")?.dataset.target;
        if (!el) return null;
        return { texto: el.textContent, focus: el.dataset.focus, mirilla };
      },
      15_000,
      npc.id,
    );
    ctx.log(`etiqueta: "${etiqueta.texto}" (focus=${etiqueta.focus}, mirilla=${etiqueta.mirilla})`);
    ctx.expect(
      `la etiqueta nombra al NPC (${npc.label})`,
      etiqueta.texto.length > 0 && npc.label.startsWith(etiqueta.texto.replace(/…$/, "")),
      `"${etiqueta.texto}" vs "${npc.label}"`,
    );
    const apuntando = await ctx.waitFor(
      "mirándole de frente queda resaltado y la mirilla encendida",
      (id) => {
        const n = window.__nefan.npcs().find((x) => x.id === id);
        if (!n) return null;
        const p = window.__nefan.state().pos;
        window.__nefan.setYaw(Math.atan2(n.pos.x - p.x, n.pos.z - p.z));
        const el = document.querySelector(`#world-labels [data-label-id="${id}"]`);
        const mirilla = document.getElementById("reticle")?.dataset.target;
        return el?.dataset.focus === "true" && mirilla === "true" ? { mirilla } : null;
      },
      15_000,
      npc.id,
    );
    ctx.expect("la mirilla se enciende sobre el NPC al que apuntas", Boolean(apuntando));
    await ctx.shot("nombre-y-mirilla");

    // Darle la espalda: ni etiqueta (queda detrás del ojo) ni mirilla.
    const apagado = await ctx.waitFor(
      "al girarse, la etiqueta y la mirilla se apagan",
      (id) => {
        const n = window.__nefan.npcs().find((x) => x.id === id);
        if (!n) return null;
        const p = window.__nefan.state().pos;
        window.__nefan.setYaw(Math.atan2(p.x - n.pos.x, p.z - n.pos.z));
        const el = document.querySelector(`#world-labels [data-label-id="${id}"]`);
        const mirilla = document.getElementById("reticle")?.dataset.target;
        return el === null && mirilla === "false" ? { mirilla } : null;
      },
      15_000,
      npc.id,
    );
    ctx.expect("de espaldas no queda ninguna etiqueta pegada a la pantalla", Boolean(apagado));
  }

  // ── 3. El muro de niebla de la frontera ─────────────────────────────────
  // Sin coordenadas mágicas: se busca un borde SIN vecino y un carril libre
  // por el que caminar hasta él (probeCollide, igual que el guion 02).
  const ruta = await ctx.page.evaluate(() => {
    const s = window.__nefan.scene;
    const m = /^tile_(-?\d+)_(-?\d+)$/.exec(s.scene_id ?? "");
    if (!m) return null;
    const tx = Number(m[1]);
    const ty = Number(m[2]);
    const conocidos = new Set(window.__nefan.tiles);
    const r = s.world_rect;
    const vecino = { north: [tx, ty - 1], south: [tx, ty + 1], west: [tx - 1, ty], east: [tx + 1, ty] };
    for (const edge of ["north", "west", "south", "east"]) {
      const [nx, ny] = vecino[edge];
      if (conocidos.has(`tile_${nx}_${ny}`)) continue;
      const horizontal = edge === "east" || edge === "west";
      // Coordenada perpendicular al borde: dónde está el límite y hacia dónde
      // se camina para alcanzarlo.
      const limite = edge === "north" ? r.minZ : edge === "south" ? r.maxZ : edge === "west" ? r.minX : r.maxX;
      const signo = edge === "north" || edge === "west" ? -1 : 1;
      // Carril libre: se prueba el centro y se abre en abanico hacia los
      // lados hasta encontrar 10 m despejados en perpendicular al borde.
      const centro = horizontal ? (r.minZ + r.maxZ) / 2 : (r.minX + r.maxX) / 2;
      for (let off = 0; off <= 24; off += 2) {
        for (const lado of off === 0 ? [0] : [-off, off]) {
          const lateral = centro + lado;
          let libre = true;
          for (let d = 11; d >= 4; d -= 0.5) {
            const p = limite - signo * d;
            const x = horizontal ? p : lateral;
            const z = horizontal ? lateral : p;
            if (window.__nefan.probeCollide(x, z)) { libre = false; break; }
          }
          if (!libre) continue;
          const p0 = limite - signo * 11;
          return {
            edge,
            desde: horizontal ? { x: p0, z: lateral } : { x: lateral, z: p0 },
            yaw: Math.atan2(horizontal ? signo : 0, horizontal ? 0 : signo),
          };
        }
      }
    }
    return null;
  });
  ctx.expect("hay una frontera sin vecino a la que asomarse", ruta !== null, JSON.stringify(ruta));
  if (!ruta) return;
  ctx.log(`frontera elegida: ${ruta.edge} · entrada por ${JSON.stringify(ruta.desde)}`);

  await ctx.nefan("setPlayerPos", ruta.desde.x, ruta.desde.z);
  await ctx.nefan("setYaw", ruta.yaw);
  const velo = await ctx.holdUntil(
    "up",
    "al acercarse al borde aparece el muro de niebla",
    (e) => {
      const v = window.__nefan.fps()?.veil ?? null;
      return v && v.edge === e && v.opacity > 0.5 ? v : null;
    },
    20_000,
    ruta.edge,
  );
  ctx.log(`velo: ${JSON.stringify(velo)} · jugador en ${JSON.stringify((await ctx.nefan("state")).pos)}`);
  ctx.expect(`el muro tapa la frontera correcta (${ruta.edge})`, velo.edge === ruta.edge, velo.edge);
  ctx.expect("y está denso, no insinuado", velo.opacity > 0.5, String(velo.opacity));
  ctx.expect(
    "el juego propone generar la zona (el muro no es un muro de verdad)",
    (await ctx.nefan("frontier")).proposal !== null,
    JSON.stringify((await ctx.nefan("frontier")).proposal),
  );
  // La captura es para la crítica visual del usuario: se toma con el muro
  // ASENTADO, no a mitad de la aparición (si no, se juzga una niebla que el
  // jugador solo ve durante dos décimas).
  const asentado = await ctx.waitFor(
    "el muro termina de aparecer",
    () => {
      const v = window.__nefan.fps()?.veil ?? null;
      return v && v.opacity >= 0.99 ? v : null;
    },
    5_000,
  );
  ctx.log(`muro asentado en opacidad ${asentado.opacity}`);
  await ctx.shot("muro-de-niebla");

  // Aceptar la exploración: cuando el vecino llega, el muro se DISIPA — no
  // hay destello, la disipación es el aviso.
  const tilesAntes = (await ctx.nefan("tiles")).length;
  await ctx.nefan("inputDriver.queueTileConfirm");
  const disipacion = await ctx.page.evaluate(
    (previos) =>
      new Promise((res) => {
        const t0 = performance.now();
        let llegada = 0;
        let maxOpacidad = 0;
        const tick = () => {
          const v = window.__nefan.fps()?.veil ?? null;
          const tiles = window.__nefan.tiles.length;
          if (v) maxOpacidad = Math.max(maxOpacidad, v.opacity);
          if (!llegada && tiles > previos) llegada = performance.now();
          if (llegada && v === null) {
            return res({ ok: true, maxOpacidad, ms: performance.now() - llegada, tiles });
          }
          if (performance.now() - t0 > 60_000) return res({ ok: false, maxOpacidad, tiles, veil: v });
          setTimeout(tick, 16);
        };
        tick();
      }),
    tilesAntes,
  );
  ctx.log(`disipación: ${JSON.stringify(disipacion)}`);
  ctx.expect("el vecino llega y el mundo crece", disipacion.tiles > tilesAntes, `${tilesAntes} → ${disipacion.tiles}`);
  ctx.expect("el muro de niebla desaparece al llegar el vecino", disipacion.ok === true, JSON.stringify(disipacion));
  ctx.expect(
    "y se DISIPA (no se corta de golpe): tarda entre 0,4 s y 2,5 s",
    disipacion.ok && disipacion.ms > 400 && disipacion.ms < 2500,
    `${Math.round(disipacion.ms)} ms`,
  );
  ctx.expect(
    "no queda velo tras la disipación",
    (await ctx.nefan("fps")).veil === null,
    JSON.stringify((await ctx.nefan("fps")).veil),
  );
  await ctx.shot("frontera-descubierta");

  // ── Captura del telegraph ───────────────────────────────────────────────
  // Aquí y no arriba: el jugador está en campo abierto y el parche de suelo
  // se ve entero. La comprobación del telegraph ya se hizo con la traza; esto
  // es material para la crítica visual.
  await ctx.nefan("inputDriver.queueAttack");
  await ctx
    .waitFor(
      "el wind-up está en pantalla para la foto",
      () => (window.__nefan.fps()?.telegraph?.mode === "windup" ? true : null),
      3_000,
    )
    .then(() => ctx.shot("telegraph-del-ataque"))
    .catch((err) => ctx.log(`sin captura del telegraph: ${err.message}`));

  // ── El mundo se vacía de verdad ─────────────────────────────────────────
  // Nadie llamaba nunca a removeTile: los grupos three de la partida anterior
  // seguían en la escena y reaparecían de fantasmas al reanudar. Cargar una
  // fixture pasa por el mismo resetWorld() que el arranque de sesión.
  const antesDelReset = (await ctx.nefan("fps")).tiles;
  ctx.log(`tiles antes del reset: ${JSON.stringify(antesDelReset)}`);
  await ctx.nefan("loadFixture", "robledo_tile");
  const vaciado = await ctx.waitFor(
    "al resetear el mundo solo sobrevive el tile recién cargado",
    () => {
      const f = window.__nefan.fps();
      return f && f.tiles.length === 1 ? f : null;
    },
    10_000,
  ).catch((err) => {
    ctx.expect("resetWorld vacía la escena three (sin tiles fantasma)", false, err.message);
    return null;
  });
  if (vaciado) {
    ctx.log(`tiles tras el reset: ${JSON.stringify(vaciado.tiles)}`);
    ctx.expect(
      "resetWorld vacía la escena three (sin tiles fantasma)",
      antesDelReset.filter((k) => vaciado.tiles.includes(k)).length <= 1,
      JSON.stringify({ antes: antesDelReset, despues: vaciado.tiles }),
    );
    ctx.expect("y sin velo colgando del mundo anterior", vaciado.veil === null, JSON.stringify(vaciado.veil));
  }
}
