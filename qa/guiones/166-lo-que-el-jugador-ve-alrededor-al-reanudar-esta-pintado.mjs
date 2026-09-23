/** LO QUE EL JUGADOR VE ALREDEDOR AL REANUDAR ESTÁ PINTADO, Y CRUZAR NO LO
 *  ROMPE (#714, escrito por QA de la tanda AI).
 *
 *  El 160 mide el carril de restauración desde la red y el renderer (E0/E1/E2)
 *  con la cámara donde el save la dejó —dentro de un edificio, en las capturas
 *  del ingeniero—, así que nadie MIRA a un vecino. Este guion se pone en la
 *  piel de quien juega y mide lo que el 160 no mide:
 *
 *   1 · Reanudar sobre el anillo 3×3 pre-generado en IMAGEN IA, sin batch de
 *       estilo: la partida viva pintó su tile y la librería del motor falso
 *       resuelve por celda, así que los nueve comparten arte. Se espera a que
 *       los NUEVE queden texturados y el carril vacío, y se cronometra desde
 *       el click en «Reanudar» (medida, no aserto: el falso contesta en ms y
 *       el número que importa es el del stack real, que aquí no se mide).
 *   2 · Se lleva al jugador al borde este de su tile y se mira al vecino: las
 *       capturas `mirando-al-vecino-este` y `mirando-atras-al-propio` son la
 *       evidencia visual que juzga la QA (clay = colores planos con detalle
 *       procedural; textura del falso = damero).
 *   3 · CRUZAR a pie a ese vecino ya restaurado (adversarial de C4/#390): el
 *       activo nuevo queda texturado, el de atrás sigue texturado, los nueve
 *       siguen texturados y, con Imagen IA ENCENDIDA, ningún POST del atlas
 *       desde el resume va sin `resolve_only` — ni el de la activación del
 *       vecino (su arte ya está en la caché del controller o en el mapping
 *       local; en el falso no llega a pedir nada). Si un muro no deja cruzar
 *       andando, se entra por teletransporte (mismo disparador:
 *       `activateByPosition`), y el guion lo dice.
 *   4 · El mismo resume en MAQUETA 3D: el activo restaura en maqueta desde
 *       #390 (guion 60, bloque 2), y los vecinos van por el mismo carril: los
 *       nueve texturados, todo `resolve_only`, cero pagos.
 *
 *  Además REGISTRA (sin afirmar, es juicio de QA) cuántas líneas de atlas
 *  escribe el resume en el HUD del jugador: una por vecino.
 *
 *  PROBADO EN NEGATIVO (2026-09-23, QA): con `carga-de-tile.ts` sin la rama
 *  `else if (planInfo) fpsAtlas.restaurar(key)`, salen rojos «los NUEVE
 *  tiles texturados» de Imagen IA y de Maqueta y «tras cruzar siguen los
 *  nueve texturados» (los ocho vecinos nombrados en clay). Salida en
 *  `docs/agents/2026-09-23-tanda-ai-el-resume-pinta-lo-que-instala/qa.md`.
 *
 *  CERO CRÉDITOS: motor falso (`e2e-sin-creditos`). Pide pintar (la partida
 *  viva en Imagen IA) y por eso no es `sinMotor`. `aisla`: el mundo lo
 *  pre-genera este guion y la librería del falso empieza fría.
 */
import { comenzar, nuevaPartida, reanudar, regenerarMundo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["mundo", "saves", "fake-ai"];

/** Con dueño único desde #606 (`qa/lib/fotogramas.mjs`): "mundo" porque lo
 *  que se espera antes de una captura es que el bucle haya corrido (y pintado)
 *  fotogramas con la mirada nueva, con la partida en marcha y sin título. */
const esperarPintado = esperaDeFotogramas("mundo");

const GAME_ID = "alta_fantasia";
/** Medio tile: el rect de `tile_0_0` es [-32, 32) en X y Z. */
const MEDIO_TILE_M = 32;

async function pagosDeAtlas() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const { gasto } = await res.json();
  return gasto.rutas["/generate_surface_atlas"] ?? 0;
}

const estadoFps = (ctx) =>
  ctx.page.evaluate(() => {
    const f = window.__nefan.fps();
    const textured = f.ready ? f.textured : [];
    return {
      activeTile: f.ready ? f.activeTile : null,
      textured,
      tiles: window.__nefan.tiles,
      enClay: window.__nefan.tiles.filter((k) => !textured.includes(k)),
      restaurando: window.__nefan.status().restaurando,
    };
  });

/** Espera a que TODOS los tiles instalados estén texturados y el carril de
 *  restauración vacío. Al expirar, el ✘ nombra los que siguen en clay. */
const esperarLosNueve = (ctx, desc) =>
  ctx.expectEspera(
    desc,
    true,
    () => {
      const f = window.__nefan.fps();
      if (!f.ready || !f.activeTile) return null;
      const enClay = window.__nefan.tiles.filter((k) => !f.textured.includes(k));
      const quieto = enClay.length === 0 && window.__nefan.status().restaurando === 0 && !window.__nefan.status().painting;
      return quieto ? { activeTile: f.activeTile, textured: f.textured, tiles: window.__nefan.tiles } : null;
    },
    { ms: 90_000 },
  );

/** El HUD conserva pocas líneas: se recogen TODAS las que entren desde ahora. */
const espiarHud = (ctx) =>
  ctx.page.evaluate(() => {
    window.__qaHud166 = [];
    const log = document.getElementById("combat-log");
    if (!log) return;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) window.__qaHud166.push(n.textContent ?? "");
    }).observe(log, { childList: true });
  });

const lineasDeAtlasDelHud = (ctx) =>
  ctx.page.evaluate(() => (window.__qaHud166 ?? []).filter((l) => /tlas fps/.test(l)));

export default async function (ctx) {
  /** Cuerpo de cada POST del atlas, en orden, desde el borde del navegador. */
  const posts = [];
  ctx.page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("/generate_surface_atlas")) return;
    let body = null;
    try {
      body = JSON.parse(r.postData() ?? "null");
    } catch {
      body = { __sin_json: r.postData() };
    }
    posts.push({ layout_key: body?.layout_key ?? null, resolve_only: body?.resolve_only === true });
  });
  const quePintan = (desde) => posts.slice(desde).filter((p) => !p.resolve_only);

  await regenerarMundo(ctx, GAME_ID);

  // ── Partida viva en Imagen IA: pinta su tile (la librería queda con arte) ──
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "image" });
  const partida = await comenzar(ctx);
  await ctx.waitFor(
    "la partida viva texturó su tile de entrada",
    () => {
      const f = window.__nefan.fps();
      return f.ready && f.activeTile && f.textured.includes(f.activeTile) && !window.__nefan.status().painting
        ? f.activeTile
        : null;
    },
    90_000,
  );
  const tileDeEntrada = await ctx.page.evaluate(() => window.__nefan.currentTile);
  const posEntrada = await ctx.page.evaluate(() => window.__nefan.state().pos);
  ctx.log(`partida viva en ${tileDeEntrada}, jugador en (${posEntrada.x.toFixed(1)}, ${posEntrada.z.toFixed(1)})`);

  // ══ 1 · Reanudar en Imagen IA: los nueve pintados ═════════════════════════
  const pagos1 = await pagosDeAtlas();
  const posts1 = posts.length;
  const t0 = Date.now();
  const vuelta = await reanudar(ctx, partida.sessionId, { alRecargar: () => espiarHud(ctx) });
  if (!vuelta) ctx.sinMedir("no se pudo reanudar la partida (Imagen IA)");
  const { ultimo: nueve } = await esperarLosNueve(
    ctx,
    "Imagen IA · al reanudar, los NUEVE tiles del anillo quedan texturados y el carril de restauración vacío",
  );
  const tardo = Date.now() - t0;
  const estado1 = nueve ?? (await estadoFps(ctx));
  ctx.log(`Imagen IA · tras reanudar (${tardo} ms desde el reload): ${JSON.stringify(estado1)}`);
  if ((estado1.tiles ?? []).length < 9) {
    ctx.sinMedir(`el save volvió con ${estado1.tiles?.length} tile(s): este guion mide el anillo 3×3`);
  }
  ctx.expect(
    "Imagen IA · el tile del jugador es el de la partida y está texturado",
    estado1.activeTile === tileDeEntrada && estado1.textured.includes(tileDeEntrada),
    JSON.stringify({ tileDeEntrada, estado1 }),
  );
  ctx.expect(
    "Imagen IA · reanudar no pidió pintar nada (ningún POST del atlas sin resolve_only) ni anotó pagos",
    quePintan(posts1).length === 0 && (await pagosDeAtlas()) === pagos1,
    JSON.stringify({ posts: posts.slice(posts1), pagosAntes: pagos1, pagosAhora: await pagosDeAtlas() }),
  );
  const hud = await lineasDeAtlasDelHud(ctx);
  ctx.log(`Imagen IA · el resume escribió ${hud.length} línea(s) de atlas en el HUD: ${JSON.stringify(hud)}`);

  // ══ 2 · Mirar al vecino ════════════════════════════════════════════════════
  // Al borde este del tile de entrada (a 4 m de la costura), mirando al este:
  // desde ahí el vecino tile_(tx+1) ocupa el encuadre entero, y la niebla del
  // renderer acaba a 90 m, o sea que se ve.
  const [, txS, tyS] = /^tile_(-?\d+)_(-?\d+)$/.exec(tileDeEntrada) ?? [];
  if (txS === undefined) ctx.sinMedir(`el tile activo «${tileDeEntrada}» no tiene forma tile_<x>_<y>`);
  const tx = Number(txS);
  const ty = Number(tyS);
  const vecinoEste = `tile_${tx + 1}_${ty}`;
  const bordeX = tx * 2 * MEDIO_TILE_M + MEDIO_TILE_M - 4;
  const zCentro = ty * 2 * MEDIO_TILE_M;
  await ctx.nefan("setPlayerPos", bordeX, zCentro);
  await ctx.nefan("setYaw", Math.PI / 2); // forward = +X = este
  await ctx.waitFor(
    "el jugador está en el borde este de su tile, mirando al este",
    ([x, t]) => {
      const p = window.__nefan.state().pos;
      return Math.abs(p.x - x) < 1.5 && window.__nefan.currentTile === t ? p : null;
    },
    10_000,
    [bordeX, tileDeEntrada],
  );
  await ctx.shot("mirando-al-vecino-este");
  await ctx.nefan("setYaw", -Math.PI / 2); // oeste: el propio tile, de espaldas a la costura
  await esperarPintado(ctx, 2);
  await ctx.shot("mirando-atras-al-propio");
  await ctx.nefan("setYaw", Math.PI / 2);

  // ══ 3 · Cruzar a pie al vecino restaurado ═════════════════════════════════
  const posts3 = posts.length;
  const cruzado = await ctx.absorbe(
    "andar es solo la forma de entrar: la medida (activo nuevo texturado, los nueve texturados, sin pintar) vive en el expectEspera de abajo, y si un muro no deja cruzar se entra por teletransporte con el mismo disparador",
    () =>
      ctx.holdUntil(
        "up",
        `el jugador cruza andando a ${vecinoEste}`,
        (v) => (window.__nefan.currentTile === v ? window.__nefan.state().pos : null),
        { sim: 30 },
        vecinoEste,
      ),
  );
  if (!cruzado) {
    ctx.log(`andando no se cruzó; se entra por teletransporte, mismo disparador (activateByPosition)`);
    await ctx.nefan("setPlayerPos", bordeX + 8, zCentro);
    await ctx.waitFor(
      `el jugador está en ${vecinoEste} tras el teletransporte`,
      (v) => (window.__nefan.currentTile === v ? window.__nefan.state().pos : null),
      10_000,
      vecinoEste,
    );
  }
  const { ultimo: trasCruzar } = await ctx.expectEspera(
    `tras cruzar a ${vecinoEste}, el activo nuevo está texturado y siguen los NUEVE texturados`,
    true,
    (v) => {
      const f = window.__nefan.fps();
      if (!f.ready || f.activeTile !== v || !f.textured.includes(v)) return null;
      const enClay = window.__nefan.tiles.filter((k) => !f.textured.includes(k));
      return enClay.length === 0 && !window.__nefan.status().painting && window.__nefan.status().restaurando === 0
        ? { activeTile: f.activeTile, textured: f.textured }
        : null;
    },
    { ms: 60_000, arg: vecinoEste },
  );
  ctx.log(`tras cruzar: ${JSON.stringify(trasCruzar ?? (await estadoFps(ctx)))} · POST desde el cruce: ${JSON.stringify(posts.slice(posts3))}`);
  ctx.expect(
    "el tile que se deja atrás sigue texturado",
    Boolean(trasCruzar) && trasCruzar.textured.includes(tileDeEntrada),
    JSON.stringify(trasCruzar),
  );
  ctx.expect(
    "cruzar a un vecino ya restaurado, con Imagen IA encendida, no pide pintar (ningún POST sin resolve_only) ni paga",
    quePintan(posts3).length === 0 && (await pagosDeAtlas()) === pagos1,
    JSON.stringify({ posts: posts.slice(posts3), pagosAntes: pagos1, pagosAhora: await pagosDeAtlas() }),
  );
  await ctx.shot("en-el-vecino-tras-cruzar");
  // Desde el vecino, la costura con el tile de origen (oeste) y con el vecino
  // del norte: dos tiles restaurados en el mismo encuadre, para juzgar la
  // integración a ojo.
  for (const [nombre, yaw] of [
    ["desde-el-vecino-mirando-al-origen-oeste", -Math.PI / 2],
    ["desde-el-vecino-mirando-al-norte", Math.PI],
  ]) {
    await ctx.nefan("setYaw", yaw);
    await esperarPintado(ctx, 2);
    await ctx.shot(nombre);
  }

  // ══ 4 · El mismo resume en Maqueta 3D ═════════════════════════════════════
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  const maqueta = await comenzar(ctx);
  await ctx.waitFor(
    "la partida en maqueta tiene su tile en pie",
    () => (window.__nefan.fps().ready && window.__nefan.currentTile ? window.__nefan.currentTile : null),
    60_000,
  );
  // Sin el mapping local que dejó escrito el bloque 1 (los nueve layoutKey
  // son los mismos: mismo mundo, mismo estilo), para que la restauración de
  // los vecinos vaya por la RED y se pueda afirmar su `resolve_only` en
  // maqueta; con el mapping puesto no habría ni un POST que mirar.
  const olvidadas = await ctx.page.evaluate(() => {
    const claves = Object.keys(localStorage).filter((k) => k.startsWith("fps_atlas:"));
    for (const k of claves) localStorage.removeItem(k);
    return claves.length;
  });
  ctx.log(`Maqueta 3D · mapping local retirado: ${olvidadas} clave(s) fps_atlas:*`);
  const pagos4 = await pagosDeAtlas();
  const posts4 = posts.length;
  const vuelta4 = await reanudar(ctx, maqueta.sessionId);
  if (!vuelta4) ctx.sinMedir("no se pudo reanudar la partida (Maqueta 3D)");
  const { ultimo: nueve4 } = await esperarLosNueve(
    ctx,
    "Maqueta 3D · al reanudar, los NUEVE tiles quedan texturados con lo que la librería ya tenía",
  );
  ctx.log(`Maqueta 3D · tras reanudar: ${JSON.stringify(nueve4 ?? (await estadoFps(ctx)))}`);
  ctx.expect(
    "Maqueta 3D · todo POST del atlas tras reanudar lleva resolve_only y el motor falso no anota pagos",
    posts.slice(posts4).length > 0 && quePintan(posts4).length === 0 && (await pagosDeAtlas()) === pagos4,
    JSON.stringify({ posts: posts.slice(posts4), pagosAntes: pagos4, pagosAhora: await pagosDeAtlas() }),
  );
  await ctx.shot("maqueta-reanudada-los-nueve");
}
