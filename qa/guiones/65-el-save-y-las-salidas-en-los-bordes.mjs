/** EL SAVE Y LAS SALIDAS EN LOS BORDES (QA de T6: #395 + #382 + #179).
 *
 *  Los guiones 60, 63 y 64 miden el camino feliz de cada issue. Este mide las
 *  situaciones en las que era más probable que NO se cumplieran, escrito por
 *  QA el 2026-09-02 al validar la tanda:
 *
 *   A · #395, LAS DOS RAMAS Y EL CRUCE A PIE. El guion 60 viaja UNA vez a un
 *       lugar sin realizar (la rama `runPlaceTravel`). Aquí además se vuelve a
 *       pie al tile de origen (cruce de borde sin «Salidas»: el jugador aparece
 *       en la posición de arranque con el verbo `setPlayerPos` del hook, que es
 *       el mismo cruce que andar 60 m sin esperar al reloj) y se viaja OTRA vez
 *       al molino, que ya está realizado (la rama `difundirPlaceRealizado`, la
 *       que guardaba ANTES del spawn con la posición del origen). Cada cambio de
 *       tile tiene que dejar en el save `active_scene_id` del destino Y la
 *       posición dentro de su rect, sin que nadie lo fuerce; y Reanudar tiene
 *       que poner al jugador en el molino.
 *
 *   B · #179, UN ENLACE A UN LUGAR CUYO TILE ESTÁ CARGADO PERO NO ACTIVO. Con
 *       el jugador en el molino, el motor enlaza la TABERNA con una ermita. El
 *       panel del molino no tiene por qué cambiar (y no debe salir ningún
 *       error), pero cuando el jugador vuelve a pie a la taberna —tile que el
 *       cliente ya tiene en memoria— el panel de la taberna tiene que ofrecer
 *       la ermita: el diálogo se la prometió. Reanudar la cura seguro (las
 *       salidas se recalculan al servir); la pregunta es si hace falta.
 *
 *   C · #179, RÁFAGA Y ENLACE AJENO. Tres enlaces seguidos desde el lugar
 *       activo (tres `POST` sin esperar entre ellos) acaban los tres en el
 *       panel; un enlace entre dos lugares que no son el activo no cambia el
 *       panel del activo ni enciende el panel de errores.
 *
 *   D · #382, LO QUE EL CHECKER NO VIO EN EL 63: DOS personajes fuera del mundo
 *       (el aviso tiene que nombrar a los dos, en plural; la escena carga y el
 *       aviso sale UNA sola vez) y una `position` que no es una coordenada
 *       (`null`). Eso segundo NO es un caso del checker: es un save que no
 *       vale, y la garantía va en el tipo —`loadSession` lo rechaza nombrando
 *       la entidad y el campo— por la misma vía que un save de otra era
 *       (#334/#336): el título dice «ya no vale… bórrala o empieza una nueva»
 *       y el panel de errores nombra a `barkeep`, sin escena montada.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, Maqueta 3D. `aisla: ["saves",
 *  "fake-ai"]`.
 *
 *  Nació ROJO sobre `e55f98d` (QA, 2026-09-02) en dos asertos: el de B (al
 *  volver a pie el panel de la taberna decía `{"exits":["Molino del bench"]}`:
 *  el bridge solo difundía las salidas del tile ACTIVO) y el de D con `position
 *  null` (Reanudar reventaba en `npcSync` con «inténtalo de nuevo»). Los otros
 *  24 en verde. Corregidos en la vuelta de QA: `difundirSalidasDeLosTilesCargados`
 *  y la validación de `entities[].position` en `loadSession`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida, recargarAlTitulo, reanudar } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";
import { esperarEnElSave, rutaDelSave } from "../lib/saves.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const TABERNA = "taberna_bench_place";
const MOLINO_NOMBRE = "Molino del bench";
const TABERNA_NOMBRE = "Taberna del bench";
const ERMITA = "qa65_ermita";
const ERMITA_NOMBRE = "Ermita del guion 65";
const FRASE = "donde no hay mundo";

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

const lugar = (id, name) =>
  api("POST", "/map/place", { id, kind: "site", parent_id: null, name, description: `${name}, a un paseo.` });
const enlace = (from, to) =>
  api("POST", "/map/link", { from, to, kind: "path", travel_hours: 1, description: `De ${from} a ${to}.` });

const salidas = (ctx) =>
  ctx.page.evaluate(() => ({
    tile: window.__nefan.currentTile,
    exits: (window.__nefan.exits ?? []).map((e) => e.name),
    botones: Array.from(document.querySelectorAll("#travel-panel button.travel-exit")).map((b) =>
      (b.textContent ?? "").trim(),
    ),
  }));

const panelDeErrores = (ctx) =>
  ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("#error-log > div")).map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim()),
  );

async function pulsarSalida(ctx, nombre) {
  const botones = await ctx.page.$$eval("#travel-panel button.travel-exit", (bs) => bs.map((b) => b.textContent ?? ""));
  const idx = botones.findIndex((t) => t.includes(nombre));
  if (idx < 0) return false;
  await ctx.page.$$eval("#travel-panel button.travel-exit", (bs, i) => bs[i].click(), idx);
  return true;
}

/** Viaja por «Salidas» a `nombre` y espera a estar en OTRO tile. */
async function viajar(ctx, nombre) {
  const desde = await ctx.page.evaluate(() => window.__nefan.currentTile);
  if (!(await pulsarSalida(ctx, nombre))) ctx.sinMedir(`el panel no ofrece «${nombre}» para viajar`);
  return ctx.waitFor(
    `el jugador llega a «${nombre}» (otro tile que ${desde})`,
    (t) => (window.__nefan.currentTile && window.__nefan.currentTile !== t ? window.__nefan.currentTile : null),
    180_000,
    desde,
  );
}

/** #395: el save recoge el cambio de tile por PREDICADO (active = `destino` ∧
 *  posición dentro del rect de la escena activa), sin que nadie lo fuerce. */
async function afirmarSaveDelDestino(ctx, sessionId, destino, etiqueta) {
  const { pos, rect } = await ctx.page.evaluate(() => ({
    pos: window.__nefan.state().pos,
    rect: window.__nefan.scene?.world_rect ?? null,
  }));
  if (!rect) ctx.sinMedir(`la escena activa (${destino}) no publica world_rect`);
  const dentro = (p) => p[0] >= rect.minX && p[0] < rect.maxX && p[2] >= rect.minZ && p[2] < rect.maxZ;
  let ultimo = null;
  const guardado = await esperarEnElSave(sessionId, (s) => {
    const p = s.player?.position;
    ultimo = { active: s.world?.active_scene_id, position: p };
    return s.world?.active_scene_id === destino && Array.isArray(p) && dentro(p) ? ultimo : null;
  });
  ctx.expect(
    `#395 · ${etiqueta}: el save lleva active_scene_id = ${destino} y la posición dentro de su rect, sin forzarlo`,
    guardado !== null,
    JSON.stringify({ destino, rect, cliente: pos, ultimo }),
  );
}

function editarLedger(ruta, editar) {
  const save = JSON.parse(readFileSync(ruta, "utf-8"));
  const r = editar(save.entities ?? []);
  writeFileSync(ruta, JSON.stringify(save, null, 2));
  return r;
}

const nombreDe = (ent) => (typeof ent?.data?.name === "string" && ent.data.name ? ent.data.name : ent?.id);

export default async function (ctx) {
  const frames = [];
  /** Quien espere el PRÓXIMO `exits_changed` del cable se apunta aquí: la
   *  espera la resuelve el evento del socket, no un reloj. */
  const esperandoExits = [];
  ctx.page.on("websocket", (ws) => {
    ws.on("framereceived", (f) => {
      const p = typeof f.payload === "string" ? f.payload : "";
      frames.push(p);
      if (p.includes('"type":"exits_changed"')) for (const res of esperandoExits.splice(0)) res(p);
    });
  });
  const exitsChangedDesde = (i) => frames.slice(i).filter((p) => p.includes('"type":"exits_changed"'));
  /** El siguiente `exits_changed`, o `null` si el cortafuegos expira (el aserto
   *  del llamante es quien observa esa expiración). */
  const proximoExitsChanged = (desde) => {
    const ya = exitsChangedDesde(desde);
    if (ya.length > 0) return Promise.resolve(ya[0]);
    return Promise.race([
      new Promise((res) => esperandoExits.push(res)),
      ctx.absorbe(
        "el aserto «el bridge difundió las salidas» del llamante afirma lo mismo contando frames",
        () => ctx.waitFor("cortafuegos de 10 s del próximo exits_changed", () => null, 10_000),
      ),
    ]);
  };
  await recargarAlTitulo(ctx);

  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await ctx.page.click('#ts-rendermode [data-rendermode="vector"]');
  const partida = await comenzar(ctx);
  const tile0 = await ctx.page.evaluate(() => window.__nefan.currentTile);
  const posTile0 = await ctx.page.evaluate(() => window.__nefan.state().pos);
  await ctx.waitFor("el panel arranca con el molino", () => (window.__nefan.exits ?? []).some((e) => e.name.includes("Molino")) || null, 30_000);
  ctx.log(`arranque: ${JSON.stringify(await salidas(ctx))} · pos ${JSON.stringify(posTile0)}`);

  // ── A1 · Viaje a un lugar SIN realizar (rama runPlaceTravel) ─────────────
  const molinoTile = await viajar(ctx, MOLINO_NOMBRE);
  ctx.log(`en el molino: ${molinoTile}`);
  await afirmarSaveDelDestino(ctx, partida.sessionId, molinoTile, "viaje a un lugar sin realizar");
  const enElMolino = await salidas(ctx);
  ctx.log(`salidas en el molino: ${JSON.stringify(enElMolino)}`);
  ctx.expect("el panel del molino ofrece volver a la taberna (precondición)", enElMolino.exits.includes(TABERNA_NOMBRE), JSON.stringify(enElMolino));

  // ── B · Un enlace a un lugar cuyo tile está CARGADO pero no activo ───────
  const erroresAntes = await panelDeErrores(ctx);
  const desdeB = frames.length;
  const l1 = await lugar(ERMITA, ERMITA_NOMBRE);
  const l2 = await enlace(TABERNA, ERMITA);
  ctx.expect("el State API acepta lugar y enlace taberna→ermita", l1.status === 200 && l2.status === 200, JSON.stringify({ l1, l2 }));
  // El bridge difunde las salidas del tile ACTIVO (el molino): se espera ese frame
  // para no medir antes de que el cliente lo haya procesado.
  await proximoExitsChanged(desdeB);
  const ecB = exitsChangedDesde(desdeB);
  ctx.log(`exits_changed tras enlazar taberna→ermita (jugador en el molino): ${ecB.length} · ${ecB.map((p) => JSON.parse(p).sceneId).join(",")}`);
  ctx.expect("#179 · el bridge difundió las salidas (exits_changed) aunque el enlace no sea del lugar activo", ecB.length >= 1, `${ecB.length} frame(s)`);
  const molinoTras = await salidas(ctx);
  ctx.expect(
    "#179 · el panel del molino (activo) no cambia por un enlace ajeno",
    JSON.stringify(molinoTras.exits) === JSON.stringify(enElMolino.exits),
    JSON.stringify({ antes: enElMolino.exits, despues: molinoTras.exits }),
  );
  const erroresB = await panelDeErrores(ctx);
  ctx.expect("#179 · …y no aparece ningún error nuevo en el panel", erroresB.length === erroresAntes.length, JSON.stringify(erroresB));

  // Vuelta A PIE a la taberna: el tile ya está en memoria del cliente. El verbo
  // `setPlayerPos` sustituye a andar 60 m (mismo cruce de borde: el game loop
  // activa el tile bajo el jugador y el bridge recibe la posición por `input`).
  await ctx.page.evaluate((p) => window.__nefan.setPlayerPos(p.x, p.z), posTile0);
  await ctx.waitFor("el cliente activa el tile de la taberna al pisarlo", (t) => (window.__nefan.currentTile === t ? t : null), 30_000, tile0);
  await afirmarSaveDelDestino(ctx, partida.sessionId, tile0, "cruce a pie de vuelta a la taberna");
  const tabernaTras = await salidas(ctx);
  ctx.log(`salidas de la taberna al volver a pie (tras el enlace): ${JSON.stringify(tabernaTras)}`);
  ctx.expect(
    "#179 · al volver a pie a la taberna, su panel ofrece la ermita enlazada mientras el jugador estaba fuera",
    tabernaTras.exits.includes(ERMITA_NOMBRE) && tabernaTras.botones.some((b) => b.includes(ERMITA_NOMBRE)),
    JSON.stringify(tabernaTras),
  );
  await ctx.shot("b-taberna-al-volver-a-pie");

  // ── A2 · Viaje a un lugar YA realizado (rama difundirPlaceRealizado) ─────
  const molinoOtraVez = await viajar(ctx, MOLINO_NOMBRE);
  ctx.expect("el segundo viaje llega al mismo tile del molino", molinoOtraVez === molinoTile, `${molinoTile} → ${molinoOtraVez}`);
  await afirmarSaveDelDestino(ctx, partida.sessionId, molinoTile, "viaje a un lugar YA realizado");

  // ── C · Ráfaga desde el activo + enlace entre lugares ajenos ─────────────
  const molinoPlace = await ctx.page.evaluate(() => window.__nefan.scene?.place_id ?? null);
  ctx.log(`place del molino según la escena: ${molinoPlace}`);
  const rafaga = ["qa65_r1", "qa65_r2", "qa65_r3"];
  for (const id of rafaga) await lugar(id, `Ráfaga ${id}`);
  const desdeC = frames.length;
  const res = await Promise.all(rafaga.map((id) => enlace("molino_bench_place", id)));
  ctx.expect("el State API acepta los tres enlaces de la ráfaga", res.every((r) => r.status === 200), JSON.stringify(res.map((r) => r.status)));
  await ctx.expectEspera(
    "el panel del molino ofrece los tres destinos de la ráfaga",
    true,
    (ids) => {
      const ex = (window.__nefan.exits ?? []).map((e) => e.name);
      return ids.every((id) => ex.includes(`Ráfaga ${id}`)) ? ex : null;
    },
    { ms: 15_000, arg: rafaga, aserto: "#179 · tres enlaces seguidos sin esperar entre ellos acaban los tres en el panel" },
  );
  ctx.log(`exits_changed de la ráfaga: ${exitsChangedDesde(desdeC).length} · panel ${JSON.stringify((await salidas(ctx)).exits)}`);
  const antesAjeno = await salidas(ctx);
  const erroresC = await panelDeErrores(ctx);
  const ajeno = await enlace(ERMITA, "qa65_r1");
  ctx.expect("el State API acepta el enlace entre dos lugares ajenos al activo", ajeno.status === 200, JSON.stringify(ajeno));
  await ctx.expectEspera(
    "ningún cambio en el panel del activo por un enlace ajeno",
    false,
    (antes) => {
      const ex = (window.__nefan.exits ?? []).map((e) => e.name);
      return JSON.stringify(ex) !== antes ? ex : null;
    },
    { ms: 3_000, arg: JSON.stringify(antesAjeno.exits), aserto: "#179 · un enlace entre lugares ajenos no toca el panel del activo" },
  );
  const erroresC2 = await panelDeErrores(ctx);
  ctx.expect("#179 · …ni enciende el panel de errores", erroresC2.length === erroresC.length, JSON.stringify(erroresC2));

  // ── A3 · Reanudar: el jugador aparece en el molino, y la taberna ya ofrece la ermita ──
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) return;
  const trasResume = await ctx.waitFor(
    "el cliente tiene tile activo tras reanudar",
    () => (window.__nefan.currentTile ? { tile: window.__nefan.currentTile, pos: window.__nefan.state().pos, rect: window.__nefan.scene?.world_rect } : null),
    60_000,
  );
  ctx.log(`tras reanudar: ${JSON.stringify(trasResume)}`);
  ctx.expect("#395 · tras Reanudar el jugador está en el molino (el último tile del viaje)", trasResume.tile === molinoTile, JSON.stringify(trasResume));
  const r = trasResume.rect;
  ctx.expect(
    "#395 · …y su posición cae dentro del rect del molino",
    Boolean(r) && trasResume.pos.x >= r.minX && trasResume.pos.x < r.maxX && trasResume.pos.z >= r.minZ && trasResume.pos.z < r.maxZ,
    JSON.stringify(trasResume),
  );
  await ctx.waitFor("el panel del molino tras reanudar ofrece la ráfaga", () => (window.__nefan.exits ?? []).some((e) => e.name.startsWith("Ráfaga")) || null, 30_000);
  await ctx.page.evaluate((p) => window.__nefan.setPlayerPos(p.x, p.z), posTile0);
  await ctx.waitFor("de vuelta a pie a la taberna tras reanudar", (t) => (window.__nefan.currentTile === t ? t : null), 30_000, tile0);
  const tabernaResume = await salidas(ctx);
  ctx.log(`taberna tras reanudar y volver a pie: ${JSON.stringify(tabernaResume)}`);
  ctx.expect("#179 · tras Reanudar, la taberna sí ofrece la ermita (las salidas se recalculan al servir)", tabernaResume.exits.includes(ERMITA_NOMBRE), JSON.stringify(tabernaResume));
  await ctx.shot("a3-taberna-tras-reanudar");

  // ── D · #382 en los bordes: dos fuera, y una position que no es array ────
  const ruta = rutaDelSave(partida.sessionId);
  if (!ruta) ctx.sinMedir("esta corrida no tiene disco propio: sin el save no se puede romper nada");
  const dos = editarLedger(ruta, (ents) => {
    const a = ents.find((e) => e.id === "barkeep");
    const b = ents.find((e) => e.id === "bandido_1");
    if (!a || !b) return null;
    a.position = [168.25, 0, 168.25];
    b.position = [-300.5, 0, 12];
    return { a: nombreDe(a), b: nombreDe(b) };
  });
  ctx.expect("precondición: el ledger tiene al tabernero y al bandido", Boolean(dos), ruta);
  if (!dos) return;
  const v2 = await reanudar(ctx, partida.sessionId);
  if (!v2) return;
  await ctx.expectEspera(
    "el panel nombra a los DOS personajes fuera del mundo",
    true,
    ([a, b, frase]) => {
      const txt = Array.from(document.querySelectorAll("#error-log > div")).map((n) => n.textContent ?? "");
      return txt.some((t) => t.includes(frase) && t.includes(a) && t.includes(b)) ? txt : null;
    },
    { ms: 30_000, arg: [dos.a, dos.b, FRASE], aserto: "#382 · con dos personajes fuera, el aviso nombra a los dos" },
  );
  const panelDos = await panelDeErrores(ctx);
  ctx.log(`panel con dos fuera: ${JSON.stringify(panelDos)}`);
  ctx.expect("#382 · el aviso sale UNA vez (una sola línea con la frase)", panelDos.filter((t) => t.includes(FRASE)).length === 1, JSON.stringify(panelDos));
  ctx.expect("#382 · la escena carga igual con dos fuera", Boolean(v2.scene), v2.scene);
  await ctx.shot("d-dos-fuera-del-mundo");

  const nulo = editarLedger(ruta, (ents) => {
    const a = ents.find((e) => e.id === "barkeep");
    const b = ents.find((e) => e.id === "bandido_1");
    if (!a || !b) return null;
    b.position = [7, 0, -3]; // el bandido vuelve a la taberna
    a.position = null; // JSON no sabe escribir NaN; esto es lo más parecido que un save corrupto puede traer
    return { a: nombreDe(a) };
  });
  if (!nulo) return;
  // Aquí no vale `reanudar()` de la librería: un save que no vale no monta
  // escena nunca y el jugador se queda en el título con la salida real. Se
  // espera lo primero que ocurra —escena o `#ts-error` visible— y se afirma.
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await ctx.page.click(`button[data-action="resume"][data-session-id="${partida.sessionId}"]`);
  const desenlace = await ctx.waitFor(
    "Reanudar con una position nula llega a un desenlace (escena o error en el título)",
    () => {
      const el = document.querySelector("#ts-error");
      if (el && el.textContent && el.style.display !== "none") return { titulo: el.textContent };
      return window.__nefan.status().scene ? { scene: window.__nefan.scene.scene_id } : null;
    },
    120_000,
  );
  ctx.log(`Reanudar con position nula: ${JSON.stringify(desenlace)}`);
  // La garantía va en el tipo: una position que no es una coordenada es un
  // save que NO VALE, no una entidad «fuera del mundo». La salida es la de
  // #334/#336, y NUNCA «inténtalo de nuevo» (reintentar un disco roto falla
  // siempre) ni una escena a medias.
  ctx.expect(
    "#382 · con una position nula Reanudar no monta escena ni revienta: el título dice que la partida ya no vale y qué hacer",
    Boolean(desenlace.titulo) && /ya no vale para esta versión del juego.*bórrala o empieza una nueva/.test(desenlace.titulo),
    JSON.stringify(desenlace),
  );
  ctx.expect(
    "#382 · …y no le aconseja reintentar",
    !/inténtalo de nuevo/.test(desenlace.titulo ?? ""),
    JSON.stringify(desenlace),
  );
  await ctx.shot("d-position-nula");
  // El QUIÉN y el QUÉ van al panel de errores, no al título (mismo reparto que
  // el guion 62): la entidad y el campo, para que el save se pueda arreglar.
  await ctx.expectEspera(
    "el panel de errores nombra a la entidad y el campo que no vale",
    true,
    (id) => {
      const txt = Array.from(document.querySelectorAll("#error-log > div")).map((n) => n.textContent ?? "");
      return txt.some((t) => t.includes(`entities["${id}"].position`)) ? txt : null;
    },
    { ms: 30_000, arg: "barkeep", aserto: "#382 · el panel dice QUÉ entidad y QUÉ campo hacen que el save no valga" },
  );
  const panelNulo = await panelDeErrores(ctx);
  ctx.log(`panel con position nula: ${JSON.stringify(panelNulo)}`);
  ctx.expect(
    "#382 · sin escena montada: el mundo a medias no llegó al cliente",
    !(await ctx.nefan("status")).scene,
    JSON.stringify(await ctx.nefan("status")),
  );
  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
