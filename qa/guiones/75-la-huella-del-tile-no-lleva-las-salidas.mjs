/** LA HUELLA DEL TILE NO LLEVA LAS SALIDAS (#410): un tile que VUELVE con otras
 *  salidas no re-deriva su colisión.
 *
 *  El TileStore guarda una huella por tile para distinguir «el tile vuelve
 *  igual» (resume, re-difusión desde caché) de «el tile CAMBIÓ», y de eso
 *  depende si la colisión derivada del plan se RESTAURA o se RECALCULA. Hasta
 *  #410 la huella se hacía sobre la escena servida entera, con las `exits`
 *  dentro: un `map_link` a mitad de sesión (`exits_changed`) dejaba la huella
 *  desfasada, y la siguiente re-difusión del MISMO tile —volver a él por el
 *  panel, que lo sirve desde caché— salía como «cambió» y recalculaba la
 *  colisión sin que la geometría hubiera cambiado.
 *
 *  Lo que se afirma, desde donde lo hace el jugador:
 *
 *   1 · Arranca la partida; el tile de entrada deriva su colisión UNA vez.
 *   2 · El motor crea un lugar y un enlace nuevos (State API, el cable de las
 *       tools) → el panel «Salidas» ofrece el destino nuevo y la colisión del
 *       tile no se toca (cero derivaciones nuevas, cero `scene_init`).
 *   3 · El jugador viaja al molino y VUELVE por el panel. La vuelta re-difunde
 *       el tile de entrada desde caché, ahora con las salidas nuevas encima.
 *       La colisión NO se re-deriva: la huella de la escena es la misma
 *       porque las salidas no están en ella.
 *   4 · Y el tile vuelto trae sus salidas al día (las nuevas, no las de la
 *       primera difusión): separar no es perder.
 *
 *  Cómo se observa restaurar vs derivar: `__nefan.colision()` publica, por
 *  tile, su HUELLA y cuántas veces la colisión del plan se DERIVÓ y cuántas se
 *  RESTAURÓ (`TileStore.setSvgCollider(key, collider, como)`, QA-G H3). Nació
 *  midiendo la traza de dev `[collision] <tile>: plan aplicado` encendida con
 *  la tecla de dev del hook; una cadena de consola deja de medir sin ponerse
 *  roja el día que alguien la reescribe, así que el observable pasó al hook.
 *  El tile del molino sigue de testigo de que el canal cuenta (deriva ≥ 1).
 *
 *  Si el tile de entrada vuelve a derivar, el guion dice QUÉ cambió en la
 *  escena servida entre la primera difusión y la vuelta (claves de primer
 *  nivel y, en `npcs`, qué campos): distingue «las salidas siguen en la
 *  huella» (#410 no cerrado) de «otra cosa de la escena se movió» (otro
 *  issue, por ejemplo la posición VIVA de un NPC, que el bridge sobrepone al
 *  servir).
 *
 *  Y esa «otra cosa» era la que hacía que el guion tirara una moneda (#634):
 *  la huella lleva la posición VIVA de cada NPC, y el tabernero del bench es
 *  AMBIENTAL —deambula alrededor de su celda de spawn—, así que con la batería
 *  entera detrás le sobraba tiempo para dar un paso entre la primera difusión y
 *  la vuelta. El paso 3 salía rojo por el tabernero y no por las salidas, que
 *  es lo que mide. Desde el 2026-09-17 el guion CONGELA a los habitantes del
 *  tile antes de leer la huella de referencia (`hold`, la misma directiva que
 *  fija el motor por el State API) y, si aun así alguno se movió, lo DICE y no
 *  ejerce el aserto: ver `congelarHabitantes` y `npcsQueSeMovieron`. Lo que
 *  esto NO arregla, y hay que decirlo: la posición viva sigue dentro de la
 *  huella (#467, cerrado `not_planned` a conciencia). El guion lo rodea; no lo
 *  cura.
 *
 *  Probado en negativo el 2026-09-05: con la huella hecha sobre
 *  `{...escena, exits: salidas}` en `tile-store.ts`, el paso 3 sale rojo
 *  (2 derivaciones del tile de entrada) y el diagnóstico nombra `exits`.
 *  Re-probado el 2026-09-17 CON el `hold` puesto: el sabotaje sigue rojo, o
 *  sea que congelar no ha convertido el paso 3 en un verde tonto.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, Maqueta 3D.
 */
import { nuevaPartida, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

/** El motor falso es determinista POR TURNO: saves y mapa vírgenes. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Lugares que siembra el motor falso en el bootstrap (`labs/narrative/fake-ai-server.ts`). */
const ORIGEN = "taberna_bench_place";
const MOLINO_NOMBRE = "Molino del bench";
const ERMITA = "qa75_ermita";
const ERMITA_NOMBRE = "Ermita del guion 75";

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

/** Episodios de colisión del tile `key` según el hook: derivaciones,
 *  restauraciones y la huella con la que está registrado. */
const colisionDe = (ctx, key) =>
  ctx.page.evaluate(
    (k) => window.__nefan.colision().find((t) => t.key === k) ?? { key: k, huella: "", derivaciones: 0, restauraciones: 0 },
    key,
  );
const derivaciones = async (ctx, key) => (await colisionDe(ctx, key)).derivaciones;

/** Lo que el jugador tiene delante en el panel «Salidas». */
const salidas = (ctx) =>
  ctx.page.evaluate(() => ({
    exits: (window.__nefan.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
    botones: Array.from(document.querySelectorAll("#travel-panel button.travel-exit")).map((b) =>
      (b.textContent ?? "").trim(),
    ),
  }));

async function esperarSalida(ctx, nombre, aserto) {
  await ctx.expectEspera(
    `el panel «Salidas» ofrece «${nombre}»`,
    true,
    (n) => {
      const exits = (window.__nefan.exits ?? []).map((e) => e.name);
      const botones = Array.from(document.querySelectorAll("#travel-panel button.travel-exit")).map((b) =>
        (b.textContent ?? "").trim(),
      );
      return exits.includes(n) && botones.some((t) => t.includes(n)) ? { exits, botones } : null;
    },
    { ms: 30_000, arg: nombre, aserto },
  );
  return salidas(ctx);
}

/** La escena servida del tile activo SIN las salidas, en JSON: la forma de la
 *  huella, leída por el mismo seam que los guiones 08 y 68 (`__nefan.scene`). */
const escenaSinSalidas = (ctx) =>
  ctx.page.evaluate(() => {
    const { exits: _e, ...escena } = window.__nefan.scene;
    return JSON.stringify(escena);
  });

/** Congela a TODOS los habitantes del tile activo con la directiva `hold`, por
 *  el mismo canal que la fija el motor narrativo (`npc_set_directive` →
 *  `POST /npc/{id}/directive`, precedente en el guion 17). `hold` pone
 *  `pauseTimer = Infinity` y el sistema ambiental deja de mover al NPC
 *  (`nefan-core/src/.../npc-behavior.ts`).
 *
 *  La lista sale de `window.__nefan.scene.npcs`, que es EXACTAMENTE la
 *  población que entra en la huella (la escena servida, con el overlay de
 *  posiciones vivas del bridge encima). No se escribe a mano: el tile 0 del
 *  bench tiene DOS —`barkeep` (`role:"merchant"`, ambiental) y `bandido_1`
 *  (`role:"hostile"`, que el sistema ambiental NO mueve: lo mueve la IA de
 *  combate)—, y una lista literal envejecería con `labs/narrative/fake-scenes.ts`
 *  sin ponerse roja el día que el bench traiga un tercero.
 *
 *  Que `hold` no alcance al hostil no se supone: si alguno se mueve igual, lo
 *  caza `npcsQueSeMovieron` y el guion lo declara con su nombre.
 */
async function congelarHabitantes(ctx) {
  const ids = await ctx.page.evaluate(() => (window.__nefan.scene?.npcs ?? []).map((n) => n.id));
  const puestas = [];
  for (const id of ids) {
    const r = await api("POST", `/npc/${id}/directive`, { directive: { type: "hold" } });
    puestas.push({ id, status: r.status });
  }
  ctx.expect(
    `los ${ids.length} habitantes del tile de entrada aceptan \`hold\` (el canal del motor)`,
    ids.length >= 2 && puestas.every((p) => p.status === 200),
    JSON.stringify(puestas),
  );
  return puestas;
}

/** Qué NPC cambió de POSICIÓN entre la huella de referencia y la escena servida
 *  de ahora. Mira `position` y nada más: cualquier otra diferencia es sujeto
 *  del aserto de #410, no de la guardia, y una guardia que mirase la escena
 *  entera se comería el rojo que el guion existe para dar.
 *
 *  La ventana que esto cubre es la que `hold` no puede cerrar: la huella de
 *  referencia se graba en el `scene_init` de arranque, ANTES de que el guion
 *  pueda POSTear nada. */
function npcsQueSeMovieron(huella, escenaAhora) {
  const posiciones = (s) =>
    new Map((JSON.parse(s).npcs ?? []).map((n) => [n.id, JSON.stringify(n.position)]));
  const antes = posiciones(huella);
  const ahora = posiciones(escenaAhora);
  const movidos = [];
  for (const id of new Set([...antes.keys(), ...ahora.keys()])) {
    if (antes.get(id) !== ahora.get(id)) {
      movidos.push(`${id}: ${antes.get(id) ?? "(no estaba)"} → ${ahora.get(id) ?? "(ya no está)"}`);
    }
  }
  return movidos;
}

/** Qué difiere entre dos escenas serializadas: claves de primer nivel y, dentro
 *  de `npcs`, qué campos de qué npc. Es diagnóstico, no aserto. */
function diferencias(a, b) {
  const A = JSON.parse(a);
  const B = JSON.parse(b);
  const claves = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter(
    (k) => JSON.stringify(A[k]) !== JSON.stringify(B[k]),
  );
  const npcs = [];
  if (claves.includes("npcs")) {
    const porId = (xs) => new Map((xs ?? []).map((n) => [n.id, n]));
    const ma = porId(A.npcs);
    const mb = porId(B.npcs);
    for (const id of new Set([...ma.keys(), ...mb.keys()])) {
      const na = ma.get(id) ?? {};
      const nb = mb.get(id) ?? {};
      const campos = [...new Set([...Object.keys(na), ...Object.keys(nb)])].filter(
        (c) => JSON.stringify(na[c]) !== JSON.stringify(nb[c]),
      );
      if (campos.length) npcs.push(`${id}: ${campos.join(",")}`);
    }
  }
  return { claves, npcs };
}

async function pulsarSalida(ctx, nombre) {
  const botones = await ctx.page.$$eval("#travel-panel button.travel-exit", (bs) => bs.map((b) => b.textContent ?? ""));
  const idx = botones.findIndex((t) => t.includes(nombre));
  if (idx < 0) throw new Error(`el panel no ofrece "${nombre}"; ofrece: ${JSON.stringify(botones)}`);
  await ctx.page.$$eval("#travel-panel button.travel-exit", (bs, i) => bs[i].click(), idx);
}

/** El viaje ha terminado cuando el JUGADOR está en otro tile (el scene_init
 *  se adelanta al `ready` que trae el spawn). */
async function esperarLlegada(ctx, tileAnterior, desc) {
  return ctx.waitFor(
    desc,
    (anterior) => {
      const t = window.__nefan.currentTile;
      const v = window.__nefan.viaje;
      if (v && v.error) return { __roto: v.error };
      if (!t || t === anterior) return null;
      const p = window.__nefan.state().pos;
      const r = window.__nefan.scene?.world_rect ?? null;
      if (!r || p.x < r.minX || p.x >= r.maxX || p.z < r.minZ || p.z >= r.maxZ) return null;
      return { tile: t };
    },
    240_000,
    tileAnterior,
  );
}

export default async function (ctx) {
  const frames = [];
  ctx.page.on("websocket", (ws) => {
    ws.on("framereceived", (f) => frames.push(typeof f.payload === "string" ? f.payload : ""));
  });
  await recargarAlTitulo(ctx);

  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  const tile0 = await ctx.page.evaluate(() => window.__nefan.currentTile);
  // ANTES de leer la huella de referencia: cuanto más tarde llegue el `hold`,
  // más ancha es la ventana en la que un ambiental puede dar un paso (#634).
  await congelarHabitantes(ctx);
  // Por ESTADO: la derivación es síncrona al añadir el tile, pero el hook se
  // consulta desde fuera, así que se espera a que la cuente.
  await ctx
    .waitFor(
      "el tile de entrada tiene su colisión derivada",
      (k) => ((window.__nefan.colision().find((t) => t.key === k)?.derivaciones ?? 0) >= 1 ? true : null),
      30_000,
      tile0,
    )
    .catch(() => null);
  const c0 = await colisionDe(ctx, tile0);
  const d0 = c0.derivaciones;
  ctx.log(`${tile0}: ${d0} derivación(es) de colisión al arrancar · huella de ${c0.huella.length} bytes`);
  ctx.expect("1 · el tile de entrada deriva su colisión UNA vez al llegar", d0 === 1, `${d0} derivaciones de ${tile0}`);
  if (d0 < 1) {
    ctx.sinMedir("`__nefan.colision()` no cuenta ninguna derivación del tile de entrada: sin ella no se distingue restaurar de derivar");
    return;
  }
  const antes = await esperarSalida(ctx, MOLINO_NOMBRE, "precondición: el panel arranca con la salida que sembró el motor");
  const escenaInicial = await escenaSinSalidas(ctx);
  ctx.log(`salidas al arrancar: ${JSON.stringify(antes.exits.map((e) => e.place_id))}`);

  // ── 2 · Un enlace nuevo a mitad de sesión ────────────────────────────────
  const desdeFrame = frames.length;
  const lugar = await api("POST", "/map/place", {
    id: ERMITA,
    kind: "site",
    parent_id: null,
    name: ERMITA_NOMBRE,
    description: "Cuatro paredes de piedra y un tejado hundido.",
  });
  const enlace = await api("POST", "/map/link", {
    from: ORIGEN,
    to: ERMITA,
    kind: "path",
    travel_hours: 1,
    description: "Una senda entre encinas.",
  });
  ctx.expect("el State API acepta el lugar y el enlace", lugar.status === 200 && enlace.status === 200, JSON.stringify({ lugar, enlace }));
  const tras = await esperarSalida(ctx, ERMITA_NOMBRE, "2 · el destino nuevo llega al panel (exits_changed)");
  const escenas = frames.slice(desdeFrame).filter((p) => p.includes('"eventId":"scene_init"'));
  ctx.expect("2 · …sin re-difundir la escena (cero scene_init desde el link)", escenas.length === 0, `${escenas.length} scene_init`);
  const c2 = await colisionDe(ctx, tile0);
  ctx.expect("2 · …y sin tocar la colisión del tile (cero derivaciones nuevas)", c2.derivaciones === d0, `${c2.derivaciones} derivaciones`);
  ctx.expect("2 · …ni la huella del tile (las salidas viven aparte)", c2.huella === c0.huella, `huella ${c2.huella === c0.huella ? "igual" : "DISTINTA"}`);
  ctx.log(`salidas tras el link: ${JSON.stringify(tras.exits.map((e) => e.place_id))}`);

  // ── 3 · Ida al molino y vuelta: el tile de entrada vuelve desde caché ────
  await pulsarSalida(ctx, MOLINO_NOMBRE);
  const ida = await esperarLlegada(ctx, tile0, "el jugador llega al tile del molino");
  if (ida.__roto) {
    ctx.expect("la ida al molino se completa", false, ida.__roto);
    return;
  }
  const tileM = ida.tile;
  const dM = await derivaciones(ctx, tileM);
  ctx.log(`ida: ${tileM} · ${dM} derivación(es) del molino`);
  ctx.expect("testigo: el tile del molino deriva su colisión al llegar (el canal cuenta)", dM >= 1, `${dM}`);
  const enMolino = await salidas(ctx);
  const vuelta = enMolino.exits.find((e) => e.place_id === ORIGEN);
  ctx.expect("desde el molino el panel ofrece la vuelta al origen", Boolean(vuelta), JSON.stringify(enMolino));
  if (!vuelta) return;
  const frameIda = frames.length;
  await pulsarSalida(ctx, vuelta.name);
  const regreso = await esperarLlegada(ctx, tileM, "el jugador vuelve al tile de entrada");
  if (regreso.__roto) {
    ctx.expect("la vuelta se completa", false, regreso.__roto);
    return;
  }
  ctx.expect("la vuelta deja al jugador en el tile de entrada", regreso.tile === tile0, regreso.tile);
  const reservido = frames.slice(frameIda).filter((p) => p.includes('"eventId":"scene_init"') && p.includes(`"${tile0}"`));
  ctx.expect("la vuelta RE-DIFUNDE el tile de entrada (scene_init desde caché): el caso del issue", reservido.length >= 1, `${reservido.length} scene_init de ${tile0}`);
  const escenaVuelta = await escenaSinSalidas(ctx);
  const c3 = await colisionDe(ctx, tile0);
  const d3 = c3.derivaciones;
  const diff = escenaInicial === escenaVuelta ? null : diferencias(escenaInicial, escenaVuelta);
  ctx.log(
    `${tile0} tras la vuelta: ${d3} derivación(es) · ${c3.restauraciones} restauración(es) · huella ${c3.huella === c0.huella ? "igual" : "DISTINTA"} · escena servida ${diff ? `DISTINTA (claves: ${diff.claves.join(",")}${diff.npcs.length ? ` · npcs: ${diff.npcs.join(" | ")}` : ""})` : "idéntica sin las salidas"}`,
  );
  // La guardia DECLARA antes de fallar: si un NPC se movió pese al `hold`, el
  // paso 3 mediría la posición viva dentro de la huella (#467) y no #410. Un ⊘
  // aquí no es el desenlace normal —exit 2 degrada MÁS que el rojo—: significa
  // que el `hold` llegó tarde, y la respuesta es POSTEAR ANTES, nunca ensanchar
  // esta guardia.
  const movidos = npcsQueSeMovieron(c0.huella, escenaVuelta);
  if (movidos.length) {
    ctx.sinMedirBloque(
      `un NPC cambió de posición entre el \`scene_init\` que grabó la huella de referencia y el \`hold\` del guion — ${movidos.join(" | ")} —, y la posición viva está DENTRO de la huella (#467): el paso 3 mediría eso y no las salidas`,
    );
  } else {
    ctx.expect(
      "3 · #410 · el tile que vuelve con otras salidas NO re-deriva su colisión (misma huella)",
      d3 === d0,
      `${d3} derivaciones (había ${d0})${diff ? ` — la escena servida cambió en: ${diff.claves.join(",")}${diff.npcs.length ? ` (${diff.npcs.join(" | ")})` : ""}` : " — la escena servida es idéntica sin las salidas: la huella lleva las salidas"}`,
    );
    ctx.expect(
      "3 · …porque la colisión se RESTAURÓ (el store lo cuenta) y la huella es la misma",
      c3.restauraciones >= 1 && c3.huella === c0.huella,
      `${c3.restauraciones} restauraciones · huella ${c3.huella === c0.huella ? "igual" : "DISTINTA"}`,
    );
  }
  const alVolver = await salidas(ctx);
  ctx.expect(
    "4 · el tile vuelto trae las salidas AL DÍA (molino y ermita): separar no es perder",
    alVolver.exits.some((e) => e.name === ERMITA_NOMBRE) && alVolver.exits.some((e) => e.name === MOLINO_NOMBRE),
    JSON.stringify(alVolver),
  );
  await ctx.shot("de-vuelta-con-las-salidas-al-dia");
}
