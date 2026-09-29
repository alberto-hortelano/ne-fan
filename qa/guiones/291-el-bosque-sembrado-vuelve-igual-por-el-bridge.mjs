/** El bosque SEMBRADO llega al cliente por el bridge, y vuelve igual (tanda BP).
 *
 *  Hermano con navegador del 290. El 290 prueba las puertas y la
 *  normalización en subprocesos; este prueba que un tile con
 *  `vegetation_zones[].seed` ENTERO cruza el camino real —disco del save →
 *  bridge (`ExpandedSceneSchema` + `formatDToWorld` en el wire) → cliente que
 *  lo instala y lo pinta— y que lo que pinta es determinista.
 *
 *  POR QUÉ POR EL SAVE Y NO POR EL MOTOR. El motor falso del banco
 *  (`labs/narrative/fake-scenes.ts`) no escribe `seed` en ninguna zona, y no
 *  hay puerta para pedirle un tile concreto: el único tile con seed que puede
 *  llegar al bridge sin gastar es uno que YA esté en `scenes_loaded`. Así que
 *  se juega una partida de verdad, se siembra la zona en el save (lo mismo que
 *  habría persistido el bridge si el motor la hubiera escrito así, porque el
 *  save guarda el Format D tal cual) y se REANUDA por la tarjeta del título,
 *  que es el camino del jugador. Lo que no cubre: la generación del tile con
 *  seed por `handlers/tile.ts` (esa puerta la mira el 290 con `validateScene`).
 *
 *  Qué se afirma:
 *   1. seed 3 → el pinar llega al cliente PLANTADO (ejemplares > 0) y sin
 *      aviso de plan en el registro de errores;
 *   2. reanudar OTRA VEZ el mismo save da los MISMOS ejemplares (id y
 *      posición): determinista a través del bridge;
 *   3. seed 4 da otro pinar: el seed manda también por este camino;
 *   4. un save de ANTES del cambio (seed de cadena, "3") no carga: el cable
 *      contesta save_invalido nombrando `vegetation_zones[0].seed`, el
 *      jugador lee el aviso genérico de save de otra versión, y no se monta
 *      ningún mundo;
 *   5. restaurado el save original (sin seed), el pinar es el mismo que el de
 *      la partida recién empezada.
 *
 *  EN NEGATIVO (2026-09-29): con `vegetation.ts` otra vez en
 *  `seed: z.string()…`, el paso 1 se pone rojo: el save con seed 3 es
 *  save_invalido y la espera de `reanudar` agota sus 180 s («timeout
 *  esperando: la escena vuelve tras reanudar»). Rojo lento y con un motivo
 *  que hay que ir a buscar al log del bridge — se sabe y se acepta: el paso
 *  es del helper compartido de `qa/lib/sesion.mjs`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { nuevaPartida, comenzar, recargarAlTitulo, reanudar, esperarTituloListo, esperarListaDeSaves } from "../lib/sesion.mjs";
import { rutaDelSave, esperarPartidaEnDisco } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";
import { reanudarPorElCable } from "../lib/cable.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

const esperarFrames = esperaDeFotogramas("mundo");

/** Encuadre para la FOTO del pinar (no para ningún aserto): el jugador arranca
 *  mirando la taberna y el pinar queda a su espalda. Se le planta en un punto
 *  libre al sureste del pinar mirando hacia él. Teletransporte de DEV: solo
 *  sirve al ojo de quien revisa, la medida son los ejemplares del plan. */
async function fotoDelPinar(ctx, etiqueta) {
  const [x, z] = [-6, -11];
  const [ox, oz] = [-20, -24];
  const libre = (await ctx.nefan("probePoint", x, z)) === false;
  ctx.expect(`el punto de la foto del pinar está libre («${etiqueta}»)`, libre, `(${x}, ${z})`);
  await ctx.nefan("setPlayerPos", x, z);
  await ctx.nefan("setYaw", Math.atan2(ox - x, oz - z));
  await esperarFrames(ctx);
  await ctx.shot(etiqueta);
}

export const aisla = ["mundo", "saves"];

const h = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

/** Los ejemplares del pinar tal como los tiene el CLIENTE (id + posición). */
async function pinarDelCliente(ctx) {
  const veg = await ctx.page.evaluate(() =>
    (window.__nefan.scene?.__plan?.volumes ?? [])
      .filter((v) => String(v.id).startsWith("derived_veg"))
      .map((v) => [v.id, v.at, v.s]),
  );
  const log = await ctx.page.evaluate(() => document.getElementById("error-log")?.textContent ?? "");
  return { n: veg.length, hash: h(veg), avisoDeSeed: /seed/.test(log) ? log.slice(0, 400) : null };
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "image" });
  await comenzar(ctx);
  const salud = await (await fetch(`${URLS.state_api}/health`)).json();
  const sessionId = salud?.session_id;
  ctx.expect("la partida tiene sesión viva", Boolean(sessionId), JSON.stringify(salud));
  if (!sessionId) return;
  await esperarPartidaEnDisco(ctx, sessionId);
  const ruta = rutaDelSave(sessionId);
  ctx.expect("el save está en el disco efímero de la corrida", Boolean(ruta), String(sessionId));
  if (!ruta) return;

  const inicial = await pinarDelCliente(ctx);
  ctx.log(`pinar recién empezada (sin seed): ${inicial.n} ejemplares · ${inicial.hash}`);
  ctx.expect("la partida trae un pinar que sembrar", inicial.n > 0, JSON.stringify(inicial));
  await fotoDelPinar(ctx, "pinar-sin-seed");

  await recargarAlTitulo(ctx);
  const original = readFileSync(ruta, "utf8");
  const datos = JSON.parse(original);
  const escena = Object.keys(datos.scenes_loaded ?? {}).find(
    (k) => (datos.scenes_loaded[k].scene_data?.vegetation_zones ?? []).length > 0,
  );
  ctx.expect("el save tiene una escena con vegetation_zones", Boolean(escena), Object.keys(datos.scenes_loaded ?? {}).join(","));
  if (!escena) return;
  const conSeed = (seed) => {
    const d = JSON.parse(original);
    for (const z of d.scenes_loaded[escena].scene_data.vegetation_zones) {
      if (seed === undefined) delete z.seed;
      else z.seed = seed;
    }
    return JSON.stringify(d);
  };
  const restaurar = () => writeFileSync(ruta, original);
  for (const s of ["SIGINT", "SIGTERM"]) process.once(s, restaurar);
  try {
    // ── 1. seed 3 ─────────────────────────────────────────────────────────
    const r3 = await reanudar(ctx, sessionId, { alRecargar: () => writeFileSync(ruta, conSeed(3)) });
    ctx.expect("el save con seed 3 se reanuda", Boolean(r3?.scene), JSON.stringify(r3));
    if (!r3?.scene) return;
    const p3 = await pinarDelCliente(ctx);
    ctx.log(`seed 3: ${p3.n} ejemplares · ${p3.hash}`);
    ctx.expect("con seed 3 el pinar llega PLANTADO al cliente y sin aviso de seed", p3.n > 0 && !p3.avisoDeSeed, JSON.stringify(p3));
    ctx.expect("y es otro pinar que el de sin seed (el seed llegó hasta el cliente)", p3.hash !== inicial.hash, `${p3.hash} vs ${inicial.hash}`);
    await fotoDelPinar(ctx, "pinar-seed-3");

    // ── 2. otra vez seed 3 ───────────────────────────────────────────────
    await recargarAlTitulo(ctx);
    const r3b = await reanudar(ctx, sessionId, { alRecargar: () => writeFileSync(ruta, conSeed(3)) });
    const p3b = r3b?.scene ? await pinarDelCliente(ctx) : null;
    ctx.expect("reanudar otra vez el mismo seed da los MISMOS ejemplares", p3b?.hash === p3.hash && p3b?.n === p3.n, JSON.stringify(p3b));
    await fotoDelPinar(ctx, "pinar-seed-3-otra-vez");

    // ── 3. seed 4 ─────────────────────────────────────────────────────────
    await recargarAlTitulo(ctx);
    const r4 = await reanudar(ctx, sessionId, { alRecargar: () => writeFileSync(ruta, conSeed(4)) });
    const p4 = r4?.scene ? await pinarDelCliente(ctx) : null;
    ctx.log(`seed 4: ${p4?.n} ejemplares · ${p4?.hash}`);
    ctx.expect("seed 4 planta otro pinar", Boolean(p4) && p4.n > 0 && p4.hash !== p3.hash, JSON.stringify(p4));
    if (p4) await fotoDelPinar(ctx, "pinar-seed-4");

    // ── 4. el save de antes del cambio ───────────────────────────────────
    await recargarAlTitulo(ctx);
    await ctx.page.reload({ waitUntil: "domcontentloaded" });
    await ctx.waitFor("window.__nefan tras el reload", () => Boolean(window.__nefan));
    writeFileSync(ruta, conSeed("3"));
    await esperarTituloListo(ctx);
    await esperarListaDeSaves(ctx);
    const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
    ctx.expect("el título sigue ofreciendo el save viejo (el jugador no sabe que está viejo)", Boolean(tarjeta), sessionId);
    if (tarjeta) {
      await tarjeta.click();
      const aviso = await ctx.waitFor(
        "el título vuelve con un error visible",
        () => {
          const el = document.getElementById("ts-error");
          const t = el && el.style.display !== "none" ? (el.textContent ?? "").trim() : "";
          return t || null;
        },
        30_000,
      );
      ctx.log(`lo que lee el jugador con el save viejo: «${aviso}»`);
      ctx.expect("el jugador lee que el save es de otra versión (no un cuelgue, no un mundo sin bosque)", /ya no vale para esta versión/.test(aviso), aviso);
      ctx.expect("y no se monta ningún mundo", !(await ctx.nefan("status")).scene, JSON.stringify(await ctx.nefan("status")));
      await ctx.shot("save-viejo-con-seed-de-cadena");
    }
    const porCable = await reanudarPorElCable(ctx, sessionId, "qa-291");
    ctx.log(`motivo técnico: ${JSON.stringify(porCable)}`);
    ctx.expect(
      "por el cable el motivo es save_invalido, nombra el seed de la zona y dice «entero»",
      porCable.ok === false && /^save_invalido:/.test(porCable.error) && /vegetation_zones(\[0\]|\.0)\.seed/.test(porCable.error) && /entero/.test(porCable.error),
      JSON.stringify(porCable),
    );

    // ── 5. sin seed, el de siempre ───────────────────────────────────────
    const r0 = await reanudar(ctx, sessionId, { alRecargar: () => writeFileSync(ruta, conSeed(undefined)) });
    const p0 = r0?.scene ? await pinarDelCliente(ctx) : null;
    ctx.expect("sin seed, el pinar reanudado es el de la partida recién empezada", p0?.hash === inicial.hash, `${p0?.hash} vs ${inicial.hash}`);
  } finally {
    restaurar();
    for (const s of ["SIGINT", "SIGTERM"]) process.removeListener(s, restaurar);
  }
}
