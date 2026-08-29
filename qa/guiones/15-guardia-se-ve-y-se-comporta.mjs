/** Un NPC declarado GUARDIA se VE como guardia y se COMPORTA como guardia.
 *
 *  Es el criterio de aceptación de #173 escrito como lo escribió quien juega:
 *  «hoy todos son el mismo aldeano de aspecto y de conducta». Antes de la
 *  tanda, `role` y `description` no cruzaban del motor al juego —dos
 *  allow-lists del saneador los tiraban por el camino—, así que TODO NPC de
 *  escena se pintaba desde su nombre propio y corría el preset `villager`:
 *  deambulaba 6 m y huía de cualquier pelea.
 *
 *  El guion `07` cubre la mitad contable de eso (los tres campos sobreviven a
 *  `formatDToWorld` y las dos vías derivan la misma clave de caché). Lo que
 *  NO cubre —y es justo lo que el jugador ve— son las dos DIFERENCIAS entre
 *  un guardia y un tendero, que allí pasarían en verde aunque `role` volviera
 *  a caerse (a `07` le basta con que `style_role` no venga vacío):
 *
 *   1. **Se ven distintos.** El juego pide el skin del guardia con la ref de
 *      personaje `warrior` y el del resto con `commoner`, aunque ninguno
 *      declare `style_ref`. Si `role` se perdiera, los cinco pedirían
 *      `commoner` y el pueblo entero volvería a vestirse igual.
 *   2. **Se comportan distinto.** Ante el MISMO estímulo —el jugador ataca a
 *      su lado— el mercader HUYE (se aleja del punto de la pelea) y el
 *      guardia INTERVIENE (se acerca y se planta). Misma acción, dos
 *      reacciones: eso es el bug arreglado, visto desde el juego.
 *
 *  Se juega por el camino real y con el motor falso del preset
 *  `e2e-sin-creditos` (cero créditos): título → mundo → partida → tile de
 *  entrada (un mercader) → salida del panel «Salidas» (un guardia). El `role`
 *  que guardó el bridge se contrasta además contra el State API, que es
 *  el mismo cable por el que el motor lee sus entidades (`entity_get`).
 *
 *  GOTCHA del bench, y por eso la parte 1 se mide al final y con la fixture:
 *  el motor falso solo tiene hoja `idle` del modelo de skin y responde 500 a
 *  `walk`, lo que dispara el cortacircuitos del cliente (`skinsDisabled`) y
 *  deja la sesión SIN pedir un skin más. Con la sesión quemada no se puede
 *  observar qué ref pediría el guardia, así que esa mitad se mide en una
 *  pestaña recién cargada sobre `robledo_tile` —la fixture commiteada que
 *  trae un guardia y cuatro paisanos— leyendo el LIBRO DE SKINS del propio
 *  juego (`__nefan.skins`), que es lo que la partida pidió, se le conteste o
 *  no. Misma función y mismo camino de datos que en sesión
 *  (Format D → `formatDToWorld` → cliente).
 */
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

/** Precondición DECLARADA (la ejecuta qa/run.mjs antes de lanzar el guion):
 *   · `mundo`   — el viaje del panel «Salidas» necesita un destino SIN
 *                 realizar; heredar el mundo de otro guion es heredar sus
 *                 destinos ya generados.
 *   · `saves`   — la partida arranca en el tile de entrada, no donde la dejó
 *                 otro guion.
 *   · `fake-ai` — el motor falso lleva estado de proceso (tiles servidos); en
 *                 caliente el destino podría llegar ya realizado. */
export const aisla = ["mundo", "saves", "fake-ai"];

/** Dispara generación (tile del motor + skins del guardia): el runner ejerce
 *  el guardarraíl de cero créditos antes de lanzarlo (#295). */
export const gasta = true;

const GAME_ID = "alta_fantasia";
const FIXTURE = "robledo_tile";
/** El State API del bridge. Sale de la fuente única de puertos, no de un
 *  literal: dos corridas a la vez no comparten stack. */
const API = URLS.state_api;
/** Distancia a la que se sitúa el jugador para atacar: dentro del radio de
 *  percepción de los dos oficios (mercader 12 m, guardia 16 m) y bien fuera
 *  de los 2 m a los que el guardia SE PLANTA — si se ataca desde más cerca,
 *  el guardia ya está en su sitio y no tiene a dónde acercarse. */
const DISTANCIA_DE_ATAQUE = 8;

/** Ficha de la entidad tal y como la ve el MOTOR (tool MCP `entity_get`). */
async function fichaDelBridge(id) {
  const r = await fetch(`${API}/entity/${encodeURIComponent(id)}`);
  if (!r.ok) return { __http: r.status };
  return r.json();
}

/** Posición del NPC y del jugador, y su distancia — del estado del juego,
 *  nunca de píxeles. */
const medir = (ctx, id) =>
  ctx.page.evaluate((npcId) => {
    const n = window.__nefan.npcs().find((x) => x.id === npcId);
    if (!n) return null;
    const p = window.__nefan.state().pos;
    return {
      npc: { x: n.pos.x, z: n.pos.z },
      jugador: { x: p.x, z: p.z },
      d: Math.hypot(n.pos.x - p.x, n.pos.z - p.z),
    };
  }, id);

/** Sitúa al jugador a ~`objetivo` metros del NPC caminando: encara y anda
 *  hacia él si está lejos, y se retira si está encima. Por el camino del
 *  jugador (mismo yaw→forward que las flechas); nunca teletransporta, que
 *  sería fabricar el escenario que el guion viene a medir. En tramos porque
 *  el NPC también se mueve. */
async function situarse(ctx, id, objetivo, tolerancia = 1.5, tramos = 12) {
  let m = await medir(ctx, id);
  for (let i = 0; i < tramos && m && Math.abs(m.d - objetivo) > tolerancia; i++) {
    const acercarse = m.d > objetivo;
    const dx = acercarse ? m.npc.x - m.jugador.x : m.jugador.x - m.npc.x;
    const dz = acercarse ? m.npc.z - m.jugador.z : m.jugador.z - m.npc.z;
    await ctx.nefan("setYaw", Math.atan2(dx, dz));
    await ctx
      .holdUntil(
        "up",
        `el jugador se sitúa a ${objetivo} m de ${id} (tramo ${i + 1}, ahora ${m.d.toFixed(1)} m)`,
        (a) => {
          const n = window.__nefan.npcs().find((x) => x.id === a.id);
          if (!n) return null;
          const p = window.__nefan.state().pos;
          const d = Math.hypot(n.pos.x - p.x, n.pos.z - p.z);
          return Math.abs(d - a.objetivo) <= a.tolerancia ? { d } : null;
        },
        4_000,
        { id, objetivo, tolerancia },
      )
      .catch(() => null);
    m = await medir(ctx, id);
  }
  return m;
}

/** ¿NACE el NPC en una celda que bloquea el plano del tile?
 *
 *  Precondición de las partes 4 y 6, y la única que no se ve venir: un NPC
 *  empotrado en un sólido puede SALIR pero no ENTRAR (`terrain-collision.ts`:
 *  «celda que ya solapábamos en el origen → no bloquea la salida»), así que se
 *  despega unos centímetros hasta el borde del prop y ahí se queda. Lo que
 *  medirían entonces los dos asertos de conducta no es «este oficio huye y
 *  este interviene», sino «un NPC acorralado no se mueve» — y lo dirían con un
 *  rojo mudo de 0,73 m que ya costó dos investigaciones (#247, #284, #289).
 *
 *  Dos detalles que costaron dos corridas y que valen para el siguiente:
 *
 *   · Se mira la posición DE LA ESCENA (dónde lo puso el motor), no la viva de
 *     `npcs()`: para cuando el guion llega aquí el NPC ya se ha despegado del
 *     prop por su cuenta y su celda de AHORA está libre. Con el tabernero de
 *     vuelta dentro del `mostrador`, la versión que preguntaba por la posición
 *     viva pasaba en VERDE mientras el aserto de la huida caía.
 *   · Y se pregunta por `probeCollide`, que es la colisión REAL del juego
 *     (terreno + plan + esquema), no por `terrain_grid`: el grid de terreno
 *     lleva los muros de las `structures`, pero NO los `volumes` — y el
 *     `mostrador` es un volume. Preguntándole a él, el empotrado también salía
 *     verde. Un candado que no puede ponerse rojo en el caso que existe no es
 *     un candado. */
const naceEnUnSolido = (ctx, posicion) =>
  ctx.page.evaluate(([x, z]) => {
    const bloquea = window.__nefan.probeCollide(x, z);
    return { en: [Math.round(x * 100) / 100, Math.round(z * 100) / 100], solido: bloquea };
  }, [posicion[0], posicion[2]]);

/** Encara al NPC antes de la captura: las capturas son para que un humano MIRE
 *  qué pasó, y una en la que el personaje ha quedado fuera de cuadro no enseña
 *  nada. No decide nada (los asertos van contra el estado), solo apunta.
 *
 *  Y espera a que el mundo se haya DIBUJADO ya girado, contando los frames que
 *  publica el renderer (`fps().frames`). `setYaw` es síncrono sobre el estado,
 *  pero la imagen sale por rAF —aquí pumpeado por Web Worker (`?raf=timer`)— y
 *  la captura se llevaba el fotograma anterior: con el tabernero fuera de la
 *  línea de la puerta, `el-mercader-huye.png` enseñaba la fachada de la taberna
 *  y ningún mercader. No es un sleep: la condición de parada es el contador. */
async function encarar(ctx, id) {
  const m = await medir(ctx, id);
  if (!m) return m;
  const antes = (await ctx.nefan("fps"))?.frames ?? 0;
  await ctx.nefan("setYaw", Math.atan2(m.npc.x - m.jugador.x, m.npc.z - m.jugador.z));
  await ctx
    .waitFor(
      `el mundo se redibuja ya encarando a ${id}`,
      (f) => ((window.__nefan.fps()?.frames ?? 0) > f + 1 ? true : null),
      5_000,
      antes,
    )
    .catch(() => ctx.log(`⚠ el renderer no emitió frame tras encarar a ${id}: la captura puede ir atrasada`));
  return m;
}

/** El jugador ataca donde está y se mira qué hace el NPC: ¿se ACERCA al punto
 *  de la pelea (intervenir) o se ALEJA (huir)?
 *
 *  El ataque se re-encola en cada sondeo a propósito: el sim OLVIDA el peligro
 *  unos segundos después del último evento de combate, así que un solo golpe
 *  deja de ser estímulo antes de que dé tiempo a ver nada. No es una espera
 *  por reloj: la condición de parada es el DESPLAZAMIENTO del NPC respecto al
 *  punto de la pelea, y `maxMs` es cortafuegos. */
async function atacarYVer(ctx, id, umbral = 1.5, maxMs = 30_000) {
  const antes = await medir(ctx, id);
  if (!antes) return null;
  const peligro = antes.jugador;
  await ctx
    .waitFor(
      `${id} reacciona al combate (se acerca o se aleja ${umbral} m del punto de la pelea)`,
      (a) => {
        window.__nefan.inputDriver.queueAttack();
        const n = window.__nefan.npcs().find((x) => x.id === a.id);
        if (!n) return null;
        const d = Math.hypot(n.pos.x - a.px, n.pos.z - a.pz);
        return Math.abs(d - a.d0) >= a.umbral ? { d } : null;
      },
      maxMs,
      { id, px: peligro.x, pz: peligro.z, d0: antes.d, umbral },
    )
    .catch(() => null);
  const despues = await medir(ctx, id);
  return {
    d0: antes.d,
    d1: despues ? Math.hypot(despues.npc.x - peligro.x, despues.npc.z - peligro.z) : null,
  };
}

/** Enciende los skins IA de personajes desde el chip de gráficos, que es como
 *  lo hace el jugador cuando NO hay partida (modo fixtures): el toggle nace
 *  APAGADO a propósito —cargar una fixture con NPCs descritos no debe gastar
 *  créditos sin que nadie lo pida— y encenderlo pide confirmación en dos
 *  clicks, como toda acción de pago. Al encenderlo, el juego re-pide los skins
 *  de todo lo que ya hay en escena, que es lo que llena el libro. */
async function encenderSkinsDePersonaje(ctx) {
  await ctx.page.click("#gfx-chip");
  const boton = ctx.page
    .locator("#gfx-panel .gfx-row", { hasText: /personaje/i })
    .locator(".gfx-seg button")
    .first();
  await boton.waitFor({ state: "visible", timeout: 10_000 });
  if (await boton.isDisabled()) return false;
  await boton.click(); // arma: «¿Confirmar? Gastará créditos»
  await boton.click(); // confirma
  return true;
}

/** Entrada del LIBRO DE SKINS del juego (`__nefan.skins`) para un NPC: qué
 *  prompt y qué ref de personaje pidió la partida para él. Se lee del registro
 *  del propio juego —lo que PIDIÓ, se le conteste o no— y no del cable: contra
 *  el bench, el motor falso solo tiene hoja `idle` y el cortacircuitos del
 *  cliente corta la cola en cuanto una anim falla. El cable ya lo cubre `07`. */
const enElLibro = (ctx, npc) =>
  ctx.waitFor(
    `la partida apunta en su libro el skin de ${npc.id}`,
    (p) => window.__nefan.skins.find((s) => s.prompt === p) ?? null,
    60_000,
    npc.description ?? npc.name ?? npc.id,
  ).catch(() => null);

export default async function (ctx) {
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "image" });
  await comenzar(ctx);

  // ── 1. El NPC del tile de entrada llega VESTIDO y con oficio ────────────
  const mercader = await ctx.waitFor(
    "el NPC del tile de entrada llega al cliente con su oficio declarado",
    () => (window.__nefan.scene?.npcs ?? []).find((n) => n.role === "merchant") ?? null,
    30_000,
  );
  ctx.log(`NPC de entrada: ${JSON.stringify(mercader)}`);
  ctx.expect(
    "el NPC de escena trae DESCRIPCIÓN (sin ella su skin se pinta desde su nombre propio)",
    typeof mercader.description === "string" && mercader.description.length > 0,
    JSON.stringify(mercader.description),
  );
  ctx.expect(
    "…y describe su ASPECTO, no repite su nombre",
    mercader.description !== mercader.name,
    `${mercader.description} vs ${mercader.name}`,
  );

  // ── 2. El bridge lo guarda con su oficio: de ahí sale el preset ─────────
  const fichaMercader = await fichaDelBridge(mercader.id);
  ctx.log(`ficha del bridge (${mercader.id}): ${JSON.stringify(fichaMercader.data ?? fichaMercader)}`);
  ctx.expect(
    "el bridge registra el `role` declarado (es lo que resuelve el preset de conducta)",
    fichaMercader?.data?.role === "merchant",
    JSON.stringify(fichaMercader?.data),
  );
  ctx.expect(
    "…y su descripción",
    typeof fichaMercader?.data?.description === "string" && fichaMercader.data.description.length > 0,
    JSON.stringify(fichaMercader?.data?.description),
  );

  // ── 3. Su skin se pide con la DESCRIPCIÓN, no con el nombre ─────────────
  const skinMercader = await enElLibro(ctx, mercader);
  ctx.log(`skin del mercader: ${JSON.stringify(skinMercader)}`);
  ctx.expect(
    "el prompt del skin es la DESCRIPCIÓN del NPC, no su nombre propio",
    Boolean(skinMercader),
    `el libro de skins no tiene "${mercader.description}"`,
  );
  ctx.expect(
    "y un mercader se viste de plebeyo",
    skinMercader?.role === "commoner",
    JSON.stringify(skinMercader?.role),
  );
  await ctx.shot("tile-de-entrada");

  // ── 4. Ante una pelea al lado, el mercader HUYE ─────────────────────────
  const cunaMercader = await naceEnUnSolido(ctx, mercader.position);
  ctx.expect(
    "el mercader NACE en suelo libre, no dentro de un prop (empotrado no puede huir y lo de abajo no prueba nada)",
    cunaMercader && !cunaMercader.solido,
    JSON.stringify(cunaMercader),
  );
  const sitioMercader = await situarse(ctx, mercader.id, DISTANCIA_DE_ATAQUE);
  ctx.log(`mercader a ${sitioMercader?.d?.toFixed(2)} m del jugador antes del ataque`);
  const reaccionMercader = await atacarYVer(ctx, mercader.id);
  ctx.log(`mercader: distancia al punto de la pelea ${reaccionMercader?.d0?.toFixed(2)} → ${reaccionMercader?.d1?.toFixed(2)} m`);
  ctx.expect(
    "el mercader HUYE de la pelea: se aleja del punto donde el jugador ataca",
    reaccionMercader?.d1 > reaccionMercader?.d0 + 1,
    JSON.stringify({ antes: reaccionMercader?.d0, despues: reaccionMercader?.d1 }),
  );
  await encarar(ctx, mercader.id);
  await ctx.shot("el-mercader-huye");

  // ── 5. Viajar a un lugar del panel «Salidas», donde hay un GUARDIA ──────
  const salidas = await ctx.nefan("exits");
  ctx.expect("el panel «Salidas» ofrece un destino", salidas.length > 0, JSON.stringify(salidas));
  if (!salidas.length) return;
  const antesDelViaje = await ctx.page.evaluate(() => window.__nefan.scene.scene_id);
  await ctx.page.click("#travel-panel button.travel-exit");
  const guardia = await ctx
    .waitFor(
      "el destino llega y trae un NPC declarado GUARDIA",
      (previo) => {
        const s = window.__nefan.scene;
        if (!s || s.scene_id === previo) return null;
        const g = (s.npcs ?? []).find((n) => n.role === "guard");
        if (!g) return null;
        const p = window.__nefan.state().pos;
        const r = s.world_rect;
        if (!r || p.x < r.minX || p.x >= r.maxX || p.z < r.minZ || p.z >= r.maxZ) return null;
        return { ...g, scene_id: s.scene_id };
      },
      240_000,
      antesDelViaje,
    )
    .catch((e) => {
      ctx.expect("el destino del panel «Salidas» trae un guardia", false, e.message);
      return null;
    });
  if (!guardia) return;
  ctx.log(`guardia: ${JSON.stringify(guardia)}`);
  ctx.expect(
    "el guardia también llega vestido (descripción propia de su aspecto)",
    typeof guardia.description === "string" && guardia.description.length > 0 && guardia.description !== guardia.name,
    JSON.stringify(guardia.description),
  );

  const fichaGuardia = await fichaDelBridge(guardia.id);
  ctx.log(`ficha del bridge (${guardia.id}): ${JSON.stringify(fichaGuardia.data ?? fichaGuardia)}`);
  ctx.expect(
    "el bridge lo registra como `guard`",
    fichaGuardia?.data?.role === "guard",
    JSON.stringify(fichaGuardia?.data),
  );
  await encarar(ctx, guardia.id);
  await ctx.shot("lugar-con-guardia");

  // ── 6. SE COMPORTA distinto: ante la MISMA pelea, INTERVIENE ────────────
  const cunaGuardia = await naceEnUnSolido(ctx, guardia.position);
  ctx.expect(
    "el guardia NACE en suelo libre, no dentro de un prop (empotrado no puede intervenir y lo de abajo no prueba nada)",
    cunaGuardia && !cunaGuardia.solido,
    JSON.stringify(cunaGuardia),
  );
  const sitioGuardia = await situarse(ctx, guardia.id, DISTANCIA_DE_ATAQUE);
  ctx.log(`guardia a ${sitioGuardia?.d?.toFixed(2)} m del jugador antes del ataque`);
  ctx.expect(
    "el jugador consigue atacar desde donde la reacción es visible (ni encima ni fuera del radio de percepción)",
    sitioGuardia && sitioGuardia.d > 3 && sitioGuardia.d < 16,
    `distancia=${sitioGuardia?.d?.toFixed(2)} m`,
  );
  const aLaVista = await encarar(ctx, guardia.id);
  ctx.log(`guardia en cuadro: jugador ${JSON.stringify(aLaVista?.jugador)} · guardia ${JSON.stringify(aLaVista?.npc)}`);
  await ctx.shot("guardia-a-la-vista");
  const reaccionGuardia = await atacarYVer(ctx, guardia.id);
  ctx.log(`guardia: distancia al punto de la pelea ${reaccionGuardia?.d0?.toFixed(2)} → ${reaccionGuardia?.d1?.toFixed(2)} m`);
  ctx.expect(
    "el guardia INTERVIENE: se acerca al punto donde el jugador ataca en vez de huir",
    reaccionGuardia?.d1 < reaccionGuardia?.d0 - 1,
    JSON.stringify({ antes: reaccionGuardia?.d0, despues: reaccionGuardia?.d1 }),
  );
  ctx.expect(
    "y ante el mismo estímulo los dos oficios reaccionan al REVÉS (que es justo lo que no pasaba)",
    reaccionGuardia?.d1 < reaccionGuardia?.d0 && reaccionMercader?.d1 > reaccionMercader?.d0,
    JSON.stringify({
      guardia: [reaccionGuardia?.d0, reaccionGuardia?.d1],
      mercader: [reaccionMercader?.d0, reaccionMercader?.d1],
    }),
  );
  await encarar(ctx, guardia.id);
  await ctx.shot("el-guardia-interviene");

  // ── 7. SE VE distinto: el guardia pide OTRA ref de personaje ────────────
  // Pestaña recién cargada (el cortacircuitos de skins de la sesión anterior
  // no viaja) y la fixture commiteada que trae un guardia y cuatro paisanos,
  // ninguno con `style_ref`: la ref sale ENTERA del `role`. Se lee el libro de
  // skins del juego, que apunta lo que PIDIÓ aunque el bench no lo sirva.
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await ctx.nefan("closeTitle");
  await ctx.nefan("loadFixture", FIXTURE);
  const npcsFixture = await ctx.waitFor(
    "la fixture del pueblo carga con sus vecinos",
    () => {
      const ns = window.__nefan.scene?.npcs ?? [];
      return ns.length >= 5 ? ns : null;
    },
    30_000,
  );
  const encendido = await encenderSkinsDePersonaje(ctx);
  ctx.expect("el chip de gráficos deja encender los skins IA de personajes", encendido, "el botón está deshabilitado (graphics.ai_skin=false)");
  if (!encendido) return;
  const libro = await ctx.waitFor(
    "el juego apunta en su libro de skins a todos los vecinos",
    (n) => (window.__nefan.skins.length >= n ? window.__nefan.skins : null),
    30_000,
    npcsFixture.length,
  );
  const porPrompt = new Map(libro.map((s) => [s.prompt, s.role]));
  ctx.log(`libro de skins de la fixture: ${JSON.stringify([...porPrompt])}`);
  const refDe = (npc) => porPrompt.get(npc.description ?? npc.name ?? npc.id);
  const guardiaFixture = npcsFixture.find((n) => n.role === "guard");
  const paisanos = npcsFixture.filter((n) => n.role && n.role !== "guard");
  ctx.expect("la fixture del pueblo trae un guardia y vecinos de otros oficios", Boolean(guardiaFixture) && paisanos.length >= 3, JSON.stringify(npcsFixture.map((n) => [n.id, n.role])));
  if (!guardiaFixture) return;
  ctx.expect(
    "ninguno declara `style_ref`: la ref de personaje sale ENTERA del oficio declarado",
    npcsFixture.every((n) => !n.style_ref),
    JSON.stringify(npcsFixture.map((n) => n.style_ref)),
  );
  ctx.expect(
    "el guardia se pide con la ref del GUERRERO",
    refDe(guardiaFixture) === "warrior",
    `${guardiaFixture.id} → ${refDe(guardiaFixture)}`,
  );
  ctx.expect(
    "y los vecinos de otros oficios, con la del plebeyo",
    paisanos.every((n) => refDe(n) === "commoner"),
    JSON.stringify(paisanos.map((n) => [n.id, n.role, refDe(n)])),
  );
  ctx.expect(
    "o sea: el guardia NO se viste como el resto del pueblo (que es lo que pasaba con todos)",
    paisanos.every((n) => refDe(n) !== refDe(guardiaFixture)),
    JSON.stringify([...porPrompt]),
  );
  await ctx.shot("el-pueblo-vestido-por-oficio");
}
