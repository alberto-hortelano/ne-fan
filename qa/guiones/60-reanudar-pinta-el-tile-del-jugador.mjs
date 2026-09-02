/** REANUDAR PINTA EL TILE DONDE ESTÁ EL JUGADOR (#390).
 *
 *  El único hallazgo de QA de la serie que ve quien juega: nueva partida →
 *  el mundo se pinta → recargar → Reanudar → el HUD anuncia el atlas de OTRO
 *  tile (`tile_-1_-1`) y la taberna donde está el jugador se queda en clay
 *  hasta que sale del tile y vuelve. Dos piezas, las dos anteriores a T4:
 *
 *   · `FpsAtlasController.onActiveTile` DESCARTABA en silencio el tile activo
 *     que llegaba con OTRO run en vuelo (`if (this.inFlight) return;`), y
 *   · el resume añadía los tiles del save en el orden de `scenes_loaded` y
 *     `addTile` activa el PRIMERO que se añade: con más de un tile en el save,
 *     el primero rara vez es el del jugador (en un mundo pre-generado son 9 y
 *     el de entrada va el último), así que el run del tile equivocado arrancaba
 *     y el del jugador se descartaba. En Imagen IA ese run además PAGA celdas
 *     que nadie mira.
 *
 *  CÓMO SE LLEGA AL ESTADO DE H2 EN EL BANCO, y por qué así:
 *
 *   · Dos tiles en el save por «Salidas» (un click, el camino del jugador,
 *     patrón del 49). El banco NO tiene snapshot de mundo: `qa/run.mjs`
 *     (`prepararDisco` → `limpiarMundos`) borra `world/*.json` de todos los
 *     juegos al arrancar el stack, así que una partida nueva trae UN tile y no
 *     hay carrera que perder. Medido el 2026-09-02: sin el viaje, `⊘ el save
 *     volvió con 1 tile(s)`.
 *   · Sin mapping local antes de reanudar (`fps_atlas:*` de `localStorage`).
 *     El mapping es un atajo POR NAVEGADOR que solo se escribe con el atlas
 *     COMPLETO; el jugador de H2 no lo tenía (16 de 23 celdas en la librería,
 *     7 por pintar) y el tile fue por `runFor`, que es la rama con el defecto.
 *     El motor falso pinta todo lo que se le pide, así que aquí el atlas
 *     siempre sale completo y el atajo taparía la carrera: se retira para
 *     colocar al cliente donde estaba el de QA. Lo que se mide después es el
 *     controller, no el atajo.
 *
 *  Lo que se afirma, y por dónde:
 *
 *   1 · **La evidencia es el RENDERER, no el log.** `__nefan.fps().textured`
 *       (los tiles con `applyAtlas` aplicado) debe contener `activeTile`. QA
 *       vio `activeTile === currentTile` con el tile en clay: eso NO basta.
 *   2 · El HUD nombra el tile activo («Atlas fps de <activo> instalado» o
 *       «restaurado (mapping local, $0)», que es el desenlace legítimo cuando
 *       el mapping sobrevive). Se recogen las líneas con un observer porque
 *       el HUD guarda 8 y el resume escribe más.
 *   3 · Hubo descargas `/cache/surface/` tras reanudar (sin ellas, «textured»
 *       no puede ser verdad).
 *   4 · En Imagen IA, **nada pintó al reanudar** (el contador de pago del
 *       motor falso no se mueve) y TODO POST posterior al resume lleva el
 *       `layout_key` del tile activo. El POST no lleva la clave del tile;
 *       `layout_key` = hash del layout + estilo, y lo identifica. En el falso
 *       el tile equivocado sale $0 porque sus celdas ya se pintaron en la
 *       partida; el `layout_key` es lo que delata su POST.
 *   5 · **A3, la guarda que no puede regresar**: durante el arranque de la
 *       partida ninguna celda se pidió dos veces (`pendingTiles` dedup de la
 *       MISMA clave, $0.15×2 el 2026-08-14). Se cuenta por `cells[].key` sobre
 *       los POST del primer tile, no por gasto: el falso anota pago solo si
 *       PINTÓ, y una segunda petición idéntica sería cache-hit.
 *
 *  Bloque 2 repite el flujo literal de H2 en **Maqueta 3D** con la librería
 *  que dejó el bloque 1, y exige gasto cero en todo el bloque.
 *
 *  A4 (cruzar a pie a un tile con un run en vuelo) va por la MISMA rama del
 *  controller que el resume: reanudar ES «cambio de tile activo con un run en
 *  vuelo». No tiene guion propio.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el bloque 1 pinta en el motor
 *  FALSO (dameros), que lo anota como ruta de pago, y por eso no se declara
 *  `sinMotor`. `aisla: ["saves","fake-ai"]`: librería vacía al empezar.
 *
 *  PROBADO EN NEGATIVO (2026-09-02). Tres medidas, porque el arreglo son dos
 *  piezas y cada una tiene su rojo:
 *
 *  · Sobre `b6b6314` (main sin nada): rojo en los DOS bloques por el POST del
 *    tile equivocado. `Imagen IA · tras reanudar: {"activeTile":"tile_1_0",
 *    "textured":["tile_1_0"],"tiles":["tile_0_0","tile_1_0"]}` y
 *    `✘ todo POST del atlas tras reanudar es del tile ACTIVO — posts:
 *    [{"layout_key":"d9ef94cd…" (= tile_0_0), "cells":23},
 *     {"layout_key":"39d73253…" (= tile_1_0), "cells":10}]`; en Maqueta 3D los
 *    mismos dos POST con `resolve_only: true`. El primero es el run del tile
 *    que el resume activaba por ser el primero añadido; en Imagen IA sale sin
 *    `resolve_only`, o sea PINTA (en el falso $0 porque sus celdas ya estaban).
 *    Nótese `textured` sin `tile_0_0`: ese run acabó SUPERADO por token en vez
 *    de descartar al activo — el banco contesta en milisegundos y el
 *    `return` mudo que vio QA en el stack real depende de que el run siga en
 *    vuelo; por eso la pieza del controller tiene su propio bloque (A4).
 *  · Solo el orden del resume revertido (`main.ts` de `b6b6314`, controller
 *    arreglado): los mismos dos rojos de `layout_key`; A4 verde.
 *  · Solo el `if (this.inFlight) return;` repuesto (resume arreglado): rojo
 *    ÚNICAMENTE en A4 — `{"antes":{"activeTile":"tile_1_0","textured":
 *    ["tile_1_0"]},"despues":{"activeTile":"tile_0_0","textured":["tile_1_0"]}}`:
 *    el tile pisado con un run en vuelo se queda en clay.
 *
 *  Y una medida que NO es de #390 pero salió al escribir esto: sin forzar el
 *  guardado tras «Salidas», en Maqueta 3D reanudar devolvía al jugador a
 *  `tile_0_0` (`antes tile_1_0 · ahora tile_0_0`): el save del viaje lleva la
 *  posición del origen. Ver `guardarConLaPosicionDelDestino`.
 */
import {
  comenzar,
  nuevaPartida,
  recargarAlTitulo,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";
import { esperarEnElSave } from "../lib/saves.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";

/** Lo que el motor falso lleva anotado como rutas DE PAGO. */
async function gastoDelFake() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const { gasto } = await res.json();
  return gasto; // { total, rutas }
}

const pagosDeAtlas = (gasto) => gasto.rutas["/generate_surface_atlas"] ?? 0;

/** Nueva partida con el modo de ESCENARIOS elegido en el título (Maqueta 3D =
 *  `vector`, Imagen IA = `image`) y personajes base. */
async function partidaEnModo(ctx, renderMode) {
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await ctx.page.click(`#ts-rendermode [data-rendermode="${renderMode}"]`);
  return comenzar(ctx);
}

/** El HUD conserva 8 líneas y el resume escribe más: se recogen TODAS las que
 *  entren en `#combat-log` desde ahora. */
const espiarHud = (ctx) =>
  ctx.page.evaluate(() => {
    window.__qaHud60 = [];
    const log = document.getElementById("combat-log");
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) window.__qaHud60.push(n.textContent ?? "");
    }).observe(log, { childList: true });
  });

const lineasDelHud = (ctx) => ctx.page.evaluate(() => window.__qaHud60 ?? []);

const estadoFps = (ctx) =>
  ctx.page.evaluate(() => {
    const f = window.__nefan.fps();
    return { activeTile: f.activeTile, textured: f.textured, tiles: f.tiles };
  });

/** Espera al desenlace del atlas de `key` en las líneas recogidas del HUD. */
const esperarAtlasDe = (ctx, key) =>
  ctx.waitFor(
    `el atlas de ${key} llega a un desenlace (instalado, restaurado o fallido)`,
    (k) =>
      (window.__qaHud60 ?? []).find((l) =>
        new RegExp(`Atlas fps de ${k} (instalado|restaurado)|atlas fps de ${k} falló`).test(l),
      ) ?? null,
    90_000,
    key,
  );

/** Pulsa el botón del panel «Salidas» que nombra `nombre` (patrón del 49). */
async function pulsarSalida(ctx, nombre) {
  const botones = await ctx.page.$$eval("#travel-panel button.travel-exit", (bs) =>
    bs.map((b) => b.textContent ?? ""),
  );
  const idx = botones.findIndex((t) => t.includes(nombre));
  if (idx < 0) return false;
  await ctx.page.$$eval("#travel-panel button.travel-exit", (bs, i) => bs[i].click(), idx);
  return true;
}

/** Va al primer destino de «Salidas» y vuelve con el tile de llegada (o
 *  `null` si no se pudo: el llamante declara `sinMedir`). */
async function irAlVecino(ctx) {
  const desde = await ctx.page.evaluate(() => ({
    tile: window.__nefan.currentTile,
    exits: (window.__nefan.exits ?? []).map((e) => e.name),
  }));
  if (desde.exits.length === 0 || !(await pulsarSalida(ctx, desde.exits[0]))) return null;
  return ctx.absorbe(
    "si el viaje no llega, el llamante declara sinMedir: ningún verde depende de esta espera",
    () =>
      ctx.waitFor(
        "el jugador llega al destino (otro tile)",
        (t) => (window.__nefan.currentTile && window.__nefan.currentTile !== t ? window.__nefan.currentTile : null),
        180_000,
        desde.tile,
      ),
  );
}

/** Retira el mapping local del atlas (`fps_atlas:*`): el estado del jugador
 *  de H2, cuyo atlas parcial nunca se persistió. Devuelve cuántas claves. */
const olvidarMappingLocal = (ctx) =>
  ctx.page.evaluate(() => {
    const claves = Object.keys(localStorage).filter((k) => k.startsWith("fps_atlas:"));
    for (const k of claves) localStorage.removeItem(k);
    return claves.length;
  });

/** Fuerza un guardado por el cable del MOTOR (State API → `onMutation` →
 *  save, patrón del 48) y espera a que el save EN DISCO lleve la posición del
 *  destino. Hace falta porque el save que dispara el viaje se escribe ANTES
 *  del primer tick de `input` tras el spawn: lleva `active_scene_id` del
 *  destino y la posición del tile de ORIGEN (medido el 2026-09-02 en Maqueta
 *  3D: reanudar devolvía al jugador a `tile_0_0` con la partida en `tile_1_0`).
 *  En Imagen IA lo tapa el `/scene/asset_refs` del atlas, que vuelve a
 *  guardar. Es OTRO defecto (se reporta aparte): aquí solo se evita medirlo. */
async function guardarConLaPosicionDelDestino(ctx, sessionId, destino) {
  const eco = await fetch(`${URLS.state_api}/map/place`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: `qa60_testigo_${Date.now()}`,
      kind: "site",
      parent_id: null,
      name: "Piedra testigo",
      description: "Fuerza un guardado tras llegar al tile vecino (guion 60).",
    }),
  });
  if (eco.status !== 200) ctx.sinMedir(`el State API no aceptó la escritura que fuerza el guardado (HTTP ${eco.status})`);
  const pos = await ctx.page.evaluate(() => window.__nefan.state().pos);
  let ultimo = null;
  const guardado = await esperarEnElSave(sessionId, (s) => {
    const p = s.player?.position;
    ultimo = { active: s.world?.active_scene_id, position: p };
    return s.world?.active_scene_id === destino && Array.isArray(p) && Math.hypot(p[0] - pos.x, p[2] - pos.z) < 1
      ? ultimo
      : null;
  });
  if (!guardado) {
    ctx.sinMedir(
      `el save no recogió la posición del destino ${destino} (cliente en ${JSON.stringify(pos)}, save ${JSON.stringify(ultimo)}): ` +
        "es el defecto del save tras viajar, no #390",
    );
  }
  return guardado;
}

/** Recarga, pulsa la tarjeta REANUDAR de la partida y espera a que el
 *  renderer tenga el tile activo texturado (o a que expire, volcando el
 *  estado del renderer, que es lo que dice qué tile ganó). */
async function reanudar(ctx, sessionId) {
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await espiarHud(ctx);
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  ctx.expect("el título ofrece REANUDAR la partida", Boolean(tarjeta), sessionId);
  if (!tarjeta) return null;
  await tarjeta.click();
  await ctx.waitFor(
    "la escena vuelve tras reanudar",
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );
  // Precondición ANTES de medir: sin dos tiles no hay carrera que perder.
  const dosTiles = await ctx.absorbe(
    "si el save vuelve con un solo tile, el llamante declara sinMedir: ningún verde depende de esta espera",
    () => ctx.waitFor("el resume trae al menos dos tiles", () => window.__nefan.fps().tiles.length >= 2 || null, 30_000),
  );
  if (!dosTiles) return { estado: await estadoFps(ctx), sinTiles: true };
  const estado = await ctx.absorbe(
    "el aserto «textured ∋ activeTile» del llamante afirma lo mismo con el estado real del renderer",
    () =>
      ctx.waitFor(
        "el renderer tiene TEXTURADO el tile activo tras reanudar",
        () => {
          const f = window.__nefan.fps();
          return f.activeTile && f.textured.includes(f.activeTile)
            ? { activeTile: f.activeTile, textured: f.textured, tiles: f.tiles }
            : null;
        },
        90_000,
      ),
  );
  return { estado: estado ?? (await estadoFps(ctx)), sinTiles: false };
}

function afirmarResume(ctx, { estado, hud, celdasTras, activoAntes, etiqueta }) {
  ctx.log(`${etiqueta} · tras reanudar: ${JSON.stringify(estado)}`);
  ctx.expect(
    `${etiqueta} · el tile activo tras reanudar es el que tenía la partida`,
    estado.activeTile === activoAntes,
    `antes ${activoAntes} · ahora ${estado.activeTile}`,
  );
  ctx.expect(
    `${etiqueta} · el RENDERER tiene texturado el tile donde está el jugador (textured ∋ activeTile)`,
    Boolean(estado.activeTile) && estado.textured.includes(estado.activeTile),
    JSON.stringify(estado),
  );
  // Tres desenlaces con arte: instalado, restaurado (mapping local) o PARCIAL
  // («N superficies de la librería; faltan M»), que es el del stack real de H2.
  const reAtlas = new RegExp(`Atlas fps de ${estado.activeTile}( instalado| restaurado|: \\d+ superficies de la librería)`);
  ctx.expect(
    `${etiqueta} · el HUD nombra el atlas del tile ACTIVO (instalado, restaurado o parcial con celdas)`,
    hud.some((l) => reAtlas.test(l)),
    JSON.stringify(hud.filter((l) => /tlas fps/.test(l))),
  );
  ctx.expect(
    `${etiqueta} · tras reanudar se descargó al menos una celda del asset-store`,
    celdasTras > 0,
    `celdas /cache/surface/ tras el resume: ${celdasTras}`,
  );
}

export default async function (ctx) {
  const peticiones = [];
  const atlasPosts = [];
  ctx.page.on("request", (r) => {
    peticiones.push(r.url());
    if (r.method() === "POST" && r.url().includes("/generate_surface_atlas")) {
      let body = null;
      try {
        body = JSON.parse(r.postData() ?? "null");
      } catch {
        body = { __sin_json: r.postData() };
      }
      atlasPosts.push(body);
    }
  });
  const celdasDesde = (i) => peticiones.slice(i).filter((u) => /\/cache\/surface\//.test(u)).length;
  /** `layout_key` de cada tile, aprendido de los POST hechos mientras ese tile
   *  era el único que corría (el POST no lleva la clave del tile). */
  const layoutKeyDe = {};
  const aprenderLayoutKey = (tile, desdePost) => {
    const k = atlasPosts.slice(desdePost).at(-1)?.layout_key;
    if (k) layoutKeyDe[tile] = k;
  };
  await recargarAlTitulo(ctx);

  /** Partida nueva en `modo` + viaje a «Salidas» + guardado con la posición
   *  del destino. Devuelve lo que hace falta para reanudar y afirmar. */
  async function partidaConDosTiles(modo, etiqueta) {
    const gastoAntes = await gastoDelFake();
    const posts0 = atlasPosts.length;
    const partida = await partidaEnModo(ctx, modo);
    await espiarHud(ctx);
    const tile0 = await ctx.page.evaluate(() => window.__nefan.currentTile);
    const posTile0 = await ctx.page.evaluate(() => window.__nefan.state().pos);
    const aviso = await esperarAtlasDe(ctx, tile0);
    ctx.log(`${etiqueta} · atlas del arranque: ${JSON.stringify(aviso)}`);
    aprenderLayoutKey(tile0, posts0);
    const postsArranque = atlasPosts.slice(posts0);
    const gastoArranque = await gastoDelFake();
    const posts1 = atlasPosts.length;
    const vecino = await irAlVecino(ctx);
    if (!vecino) ctx.sinMedir("el panel «Salidas» no llevó a otro tile: con un solo tile en el save no hay carrera que medir");
    const avisoVecino = await esperarAtlasDe(ctx, vecino);
    ctx.log(`${etiqueta} · en ${vecino}: ${JSON.stringify(avisoVecino)}`);
    aprenderLayoutKey(vecino, posts1);
    await guardarConLaPosicionDelDestino(ctx, partida.sessionId, vecino);
    const fps = await estadoFps(ctx);
    ctx.log(`${etiqueta} · renderer antes de reanudar: ${JSON.stringify(fps)}`);
    return { partida, tile0, posTile0, vecino, aviso, postsArranque, gastoAntes, gastoArranque, fps };
  }

  /** Recarga sin mapping local, reanuda y afirma lo que #390 promete. */
  async function reanudarYAfirmar(p, etiqueta) {
    const olvidadas = await olvidarMappingLocal(ctx);
    ctx.log(`${etiqueta} · mapping local retirado: ${olvidadas} clave(s) fps_atlas:*`);
    const desde = peticiones.length;
    const postsAntes = atlasPosts.length;
    const gastoAntes = await gastoDelFake();
    const r = await reanudar(ctx, p.partida.sessionId);
    if (!r) return;
    if (r.sinTiles) {
      ctx.sinMedir(`el save volvió con ${r.estado.tiles.length} tile(s): sin dos tiles no hay carrera que medir`);
    }
    afirmarResume(ctx, {
      estado: r.estado,
      hud: await lineasDelHud(ctx),
      celdasTras: celdasDesde(desde),
      activoAntes: p.fps.activeTile,
      etiqueta,
    });
    const postsResume = atlasPosts.slice(postsAntes);
    const claveActivo = layoutKeyDe[r.estado.activeTile] ?? null;
    ctx.expect(
      `${etiqueta} · todo POST del atlas tras reanudar es del tile ACTIVO (su layout_key; ninguno del otro tile)`,
      claveActivo !== null && postsResume.every((b) => b?.layout_key === claveActivo),
      JSON.stringify({
        activo: r.estado.activeTile,
        claves: layoutKeyDe,
        posts: postsResume.map((b) => ({ layout_key: b?.layout_key, resolve_only: b?.resolve_only, cells: b?.cells?.length })),
      }),
    );
    const gastoDespues = await gastoDelFake();
    ctx.expect(
      `${etiqueta} · reanudar NO pintó nada (el contador de pago del atlas no se movió)`,
      pagosDeAtlas(gastoDespues) === pagosDeAtlas(gastoAntes),
      JSON.stringify({ antes: gastoAntes.rutas, despues: gastoDespues.rutas }),
    );
  }

  // ── 1 · Imagen IA: la partida pinta; reanudar no pinta y textura el ACTIVO ──
  const p1 = await partidaConDosTiles("image", "Imagen IA");
  ctx.expect(
    "Imagen IA · la partida nueva instaló el atlas de su tile (precondición: hay arte que reanudar)",
    /instalado/.test(p1.aviso),
    p1.aviso,
  );
  // A3: la MISMA clave no se pide dos veces (guarda de `pendingTiles`).
  const claves = p1.postsArranque.flatMap((b) => (b?.cells ?? []).map((c) => c.key));
  const repetidas = claves.filter((k, i) => claves.indexOf(k) !== i);
  ctx.expect(
    "A3 · en el arranque ninguna celda se pidió dos veces (el doble disparo de la misma clave no regresa)",
    p1.postsArranque.length > 0 && repetidas.length === 0,
    JSON.stringify({ posts: p1.postsArranque.length, celdas: claves.length, repetidas: [...new Set(repetidas)].slice(0, 5) }),
  );
  ctx.expect(
    "Imagen IA · el motor falso anotó UN pago de atlas en el arranque (pintó el tile del jugador)",
    pagosDeAtlas(p1.gastoArranque) - pagosDeAtlas(p1.gastoAntes) === 1,
    JSON.stringify({ antes: p1.gastoAntes.rutas, despues: p1.gastoArranque.rutas }),
  );
  ctx.expect(
    "Imagen IA · el tile de llegada quedó texturado (precondición: el save deja dos tiles con arte)",
    p1.fps.activeTile === p1.vecino && p1.fps.textured.includes(p1.vecino) && p1.fps.tiles.length >= 2,
    JSON.stringify(p1.fps),
  );
  await reanudarYAfirmar(p1, "Imagen IA");
  await ctx.shot("imagen-ia-reanudada");

  // ── 2 · Maqueta 3D: el flujo literal de H2, con la librería ya poblada ──
  await recargarAlTitulo(ctx);
  const gasto3 = await gastoDelFake();
  const p2 = await partidaConDosTiles("vector", "Maqueta 3D");
  ctx.expect(
    "Maqueta 3D · la partida nueva restaura el arte de la librería sin pintar (precondición del bloque)",
    /instalado|restaurado/.test(p2.aviso),
    p2.aviso,
  );
  ctx.expect(
    "Maqueta 3D · el tile de llegada quedó texturado desde la librería (precondición del bloque)",
    p2.fps.activeTile === p2.vecino && p2.fps.textured.includes(p2.vecino),
    JSON.stringify(p2.fps),
  );
  await reanudarYAfirmar(p2, "Maqueta 3D");
  const gasto4 = await gastoDelFake();
  ctx.expect(
    "Maqueta 3D · en todo el bloque el motor falso no anotó ningún pago de atlas",
    pagosDeAtlas(gasto4) === pagosDeAtlas(gasto3),
    JSON.stringify({ antes: gasto3.rutas, despues: gasto4.rutas }),
  );
  await ctx.shot("maqueta-3d-reanudada");

  // ── 3 · A4: cruzar a un tile con OTRO run en vuelo (el controller a secas) ──
  // G lanza `runFor` del tile activo y, en el MISMO tick, el jugador aparece
  // en el tile de arranque: el game loop consume la G y activa ese tile en el
  // mismo fotograma, o sea `onActiveTile(tile0)` con un run en vuelo. Es el
  // cruce a pie durante una instalación, sin depender del reloj del banco. Con
  // el `return` mudo de antes, el tile pisado se quedaba en clay hasta salir y
  // volver; ahora su run supera al que estaba en vuelo.
  const antesA4 = await estadoFps(ctx);
  if (antesA4.activeTile !== p2.vecino || antesA4.textured.includes(p2.tile0)) {
    ctx.sinMedirBloque(
      `A4 exige estar en ${p2.vecino} con ${p2.tile0} SIN texturar; el renderer dice ${JSON.stringify(antesA4)}`,
    );
  } else {
    await ctx.page.evaluate((pos) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
      window.__nefan.setPlayerPos(pos.x, pos.z);
    }, p2.posTile0);
    const a4 = await ctx.absorbe(
      "el aserto de abajo afirma lo mismo con el estado real del renderer",
      () =>
        ctx.waitFor(
          "A4 · el tile pisado con un run en vuelo queda texturado",
          (t) => {
            const f = window.__nefan.fps();
            return f.activeTile === t && f.textured.includes(t)
              ? { activeTile: f.activeTile, textured: f.textured, tiles: f.tiles }
              : null;
          },
          60_000,
          p2.tile0,
        ),
    );
    const estadoA4 = a4 ?? (await estadoFps(ctx));
    ctx.log(`A4 · tras cruzar con un run en vuelo: ${JSON.stringify(estadoA4)}`);
    ctx.expect(
      "A4 · cruzar a un tile mientras otro run está en vuelo no lo deja en clay (textured ∋ tile pisado)",
      estadoA4.activeTile === p2.tile0 && estadoA4.textured.includes(p2.tile0),
      JSON.stringify({ antes: antesA4, despues: estadoA4 }),
    );
    await ctx.shot("a4-cruce-con-run-en-vuelo");
  }
}
