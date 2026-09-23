/** Salir de un tile con NPCs y volver NO los repone: ni los duplica, ni los
 *  purga, ni los devuelve a su celda de spawn (#431, tanda Z).
 *
 *  El sujeto es `registerSceneNpcs` (`nefan-core/src/narrative/npc-records.ts`)
 *  por la puerta real: `recordSceneLoaded`, que lo llama con
 *  `firstRegistration:false` cuando el bridge re-difunde una escena CACHEADA
 *  (`handlePlayerEnteredPlace`, rama de vuelta del guion 09). La tanda Z le
 *  borró un bloque muerto y lo metió en la medida de mutación sin que nadie
 *  jugara la vuelta; este guion la juega. Lo que se afirma, leído del SAVE
 *  (`saves/<sesión>/state.json`, que es lo que `registerSceneNpcs` escribe) y
 *  del cliente:
 *
 *   1 · PRECONDICIÓN: el tile de partida registra sus dos NPC de escena
 *       (`barkeep`, `bandido_1`) como `scene_init` de `tile_0_0`.
 *   2 · EL BANDIDO SE HA MOVIDO antes de irnos (acercarse lo engancha y
 *       persigue): sin esto «vuelve donde estaba» y «vuelve a su celda» serían
 *       el mismo sitio y el aserto 5 no distinguiría nada.
 *   3 · TRAS IDA Y VUELTA NO HAY IDS DUPLICADOS en el ledger de entidades:
 *       re-registrar la misma escena no debe crear un segundo record.
 *   4 · NADIE FUE PURGADO: los dos `scene_init` de `tile_0_0` siguen, con su
 *       `spawned_at` y su `spawn_event_id` ORIGINALES (no se borraron y
 *       recrearon: es la diferencia entre conservar y reponer).
 *   5 · LA POSICIÓN VIVA SE CONSERVA, medida en el que la tiene SOLO EN EL
 *       RECORD: el tabernero. Lo mueve `NpcBehaviorSystem` escribiendo en el
 *       record (huye de un golpe al lado, como mide el 15) y no tiene cuerpo
 *       en el sim de combate; si al llegar al destino el save lo tenía lejos
 *       de su celda, al volver tiene que seguir lejos de ella. Un record
 *       repuesto nace en la celda y ahí se le pilla.
 *   5b· Y lo que el jugador VE del hostil: el bandido tampoco está en su
 *       celda, ni en el save ni en `enemies()`. OJO: esto NO mide el record
 *       —`save()` vuelca la posición del hostil desde el sim vivo, así que un
 *       record repuesto del bandido sale del save con la posición del sim
 *       (medido en negativo, abajo)—; mide que la vuelta no resetea al
 *       cuerpo que el jugador tiene delante. Se queda porque es lo que se ve.
 *   6 · EL NPC DEL DESTINO se registró con `scene_id` del tile del destino,
 *       y sigue ahí tras volver (salir de un tile no purga a los del otro).
 *
 *  LO QUE ESTE GUION NO MIDE, dicho para que nadie lo cuente de más: el MOVER
 *  por `firstRegistration` (mismo id declarado por OTRA escena en su primer
 *  registro) y la PURGA de un `scene_init` que la escena deja de declarar. El
 *  motor falso es determinista y no redeclara ids ni cambia una escena entre
 *  dos registros, así que producir esos dos estados exigiría forzar la escena
 *  (regla del workaround). Los sujeta `nefan-core/test/narrative-tiles.test.ts`
 *  (Nogala y la purga de «viejo»), con mutación desde #431. Y el bloque 5 se
 *  DECLARA sin medir si el tabernero no había paseado ≥ 0,5 m antes de irnos:
 *  sin distancia entre «donde estaba» y «su celda» el aserto no distinguiría.
 *
 *  PROBADO EN NEGATIVO (QA, 2026-09-20): quitando `&& !ids.has(e.id)` del
 *  filtro de purga de `registerSceneNpcs` (el mutante «purga a los que la
 *  escena SIGUE declarando» que el `porque` del módulo nombra), la vuelta
 *  borra y recrea a los dos NPC: se ponen rojos los dos asertos de identidad
 *  del bloque 4 (`spawned_at` nuevo) y el 5 del tabernero (repuesto en
 *  [7,75 · −0,25], su celda exacta). El 5b del bandido se quedó VERDE con el
 *  sabotaje puesto, por lo dicho arriba: su record repuesto salió del save en
 *  (9,69 · 1,28), la posición del sim, no la celda.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; los NPC los declara
 *  `labs/narrative/fake-scenes.ts`.
 */
import { readFileSync } from "node:fs";
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";
import { rutaDelSave, esperarEnElSave } from "../lib/saves.mjs";
import { acercarse } from "../lib/combate.mjs";
import { viajarPorSalidas } from "../lib/viaje.mjs";

/** Saves vírgenes y el motor falso a cero: el ledger que se lee es el de ESTA
 *  partida y los spawns por turno no se cuelan. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const ORIGEN = "tile_0_0";
const HOSTIL = "bandido_1";
const MERCADER = "barkeep";
/** Celdas del Format D en metros mundo, la misma tabla que el guion 54: es
 *  DONDE NO tienen que reaparecer. `bandido_1` [88,65] → (12,25 · 0,75);
 *  `barkeep` [79,63] → (7,75 · −0,25). */
const CELDA_DE_SPAWN = [12.25, 0, 0.75];
const CELDA_DEL_MERCADER = [7.75, 0, -0.25];
/** Cuánto tiene que haber paseado el tabernero (en el save del destino) para
 *  que «sigue donde estaba» y «repuesto en su celda» sean distinguibles.
 *  Medido: 0,89 m en una corrida y 3,1 m en otra; con 1 m el bloque salía ⊘
 *  una de dos veces, y un repuesto está a 0,00 m, así que medio metro basta. */
const PASEO_MINIMO_M = 0.5;
/** Un record repuesto nace EXACTAMENTE en su celda (0,00 m); 20 cm es lo que
 *  separa eso de cualquier paseo que haya pasado la precondición de arriba. */
const FUERA_DE_LA_CELDA_M = 0.2;
/** Cuánto tiene que haberse despegado para que «sigue donde estaba» y «volvió a
 *  su celda» sean sitios distintos. El mismo umbral que el 54, y por lo mismo. */
const SE_HA_MOVIDO_M = 1.5;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

const leerSave = (sessionId) => {
  const ruta = rutaDelSave(sessionId);
  if (!ruta) throw new Error(`no hay save en disco para ${sessionId}`);
  return JSON.parse(readFileSync(ruta, "utf8"));
};
const npcsDe = (save) => (save.entities ?? []).filter((e) => e.type === "npc");
const resumen = (e) => ({
  id: e.id, scene_id: e.scene_id, spawn_reason: e.spawn_reason,
  spawned_at: e.spawned_at, spawn_event_id: e.spawn_event_id, position: e.position,
});

/** Dónde tiene el CLIENTE a un hostil ahora mismo. */
const dondeEnCliente = (ctx, id) =>
  ctx.page.evaluate((q) => {
    const e = window.__nefan.enemies().find((x) => x.id === q);
    return e ? [e.pos.x, e.pos.y, e.pos.z] : null;
  }, id);

const mirar = () => ({
  tile: window.__nefan.currentTile,
  exits: (window.__nefan.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
});

// El viaje —clic en «Salidas» y espera por ESTADO contra el ledger
// `__nefan.viaje`— vive en `qa/lib/viaje.mjs` (#693), con `MS_DEL_TILE` como
// cortafuegos de deadlock y un `viaje.error` que corta al instante. Este guion
// nació en `main` con #699 calcando la espera del 09 con su `240_000`; ahora
// no hay nada que calcar.

export default async function (ctx) {
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  const partida = await comenzar(ctx);

  // ── 1 · Precondición: los NPC del tile de partida están registrados ──────
  const antes = leerSave(partida.sessionId);
  const npcsAntes = npcsDe(antes);
  const origenAntes = npcsAntes.filter((e) => e.scene_id === ORIGEN && e.spawn_reason === "scene_init");
  ctx.log(`ledger al arrancar: ${JSON.stringify(npcsAntes.map(resumen))}`);
  ctx.expect(
    `el tile de partida registra a ${HOSTIL} y ${MERCADER} como scene_init de ${ORIGEN}`,
    [HOSTIL, MERCADER].every((id) => origenAntes.some((e) => e.id === id)),
    JSON.stringify(origenAntes.map((e) => e.id)),
  );
  const bandidoAntes = npcsAntes.find((e) => e.id === HOSTIL);
  if (!bandidoAntes) return ctx.sinMedir(`sin ${HOSTIL} en el ledger no hay a quién mover ni conservar`);

  // ── 2 · El bandido se mueve (persigue) antes de irnos ────────────────────
  await ctx.waitFor(
    "el bandido de la escena está en el mundo",
    (id) => window.__nefan.enemies().find((e) => e.id === id) ?? null,
    60_000,
    HOSTIL,
  );
  await acercarse(ctx, HOSTIL, { objetivo: 1.6, lista: "enemies" });
  // Y de vuelta hacia el tabernero, que es hacia donde está el panel de
  // salidas útil y lo que despega al bandido de su celda (nos sigue).
  await acercarse(ctx, MERCADER, { objetivo: 2.5, lista: "npcs" });
  // Un golpe al lado del tabernero lo hace HUIR (`flees_from_combat`, lo que
  // mide el guion 15): es lo que despega su RECORD de la celda para que el
  // bloque 5 tenga algo que distinguir. Su micro-wander solo no basta: en una
  // de cuatro corridas seguía a 0,00 m de su celda al irnos. La espera se
  // ABSORBE porque la medida de la preservación vive en el bloque 4
  // (identidad); si aun así no se mueve, el bloque 5 se declara sin medir.
  await ctx.nefan("inputDriver.queueAttack");
  await ctx.absorbe(
    "el paseo del tabernero solo hace DISTINGUIBLE el bloque 5; la medida del record vive en el bloque 4 " +
      "(spawned_at) y el 5 se declara ⊘ si el tabernero no se despegó",
    () =>
      ctx.waitFor(
        `el tabernero huye del golpe (≥ ${PASEO_MINIMO_M} m de su celda)`,
        (a) => {
          const e = window.__nefan.npcs().find((x) => x.id === a.id);
          if (!e) return null;
          const d = Math.hypot(e.pos.x - a.celda[0], e.pos.z - a.celda[2]);
          return d >= a.min ? { d } : null;
        },
        { sim: 10 },
        { id: MERCADER, celda: CELDA_DEL_MERCADER, min: PASEO_MINIMO_M },
      ),
  );
  const bandidoMovido = await dondeEnCliente(ctx, HOSTIL);
  ctx.log(`bandido antes de irnos: ${JSON.stringify(bandidoMovido)} · celda ${JSON.stringify(CELDA_DE_SPAWN)}`);
  ctx.expect(
    `precondición: el bandido se ha despegado ≥ ${SE_HA_MOVIDO_M} m de su celda antes de irnos`,
    bandidoMovido !== null && dist(bandidoMovido, CELDA_DE_SPAWN) >= SE_HA_MOVIDO_M,
    JSON.stringify({ visto: bandidoMovido, d: bandidoMovido ? dist(bandidoMovido, CELDA_DE_SPAWN).toFixed(2) : null }),
  );

  // ── Ida ──────────────────────────────────────────────────────────────────
  const desde = await ctx.page.evaluate(mirar);
  ctx.expect("el panel «Salidas» ofrece un destino", desde.exits.length > 0, JSON.stringify(desde.exits));
  if (!desde.exits.length) return;
  const destino = desde.exits[0];
  const enDestino = await viajarPorSalidas(ctx, destino.name, "el jugador llega al tile del destino");
  ctx.log(`en el destino: ${enDestino.tile} · escena ${enDestino.scene_id}`);
  const vecino = await esperarEnElSave(
    partida.sessionId,
    (s) => npcsDe(s).find((e) => e.scene_id === enDestino.scene_id && e.spawn_reason === "scene_init") ?? null,
    30_000,
  );
  ctx.expect(
    `el destino (${enDestino.scene_id}) registra su propio NPC de escena`,
    vecino !== null,
    JSON.stringify(vecino && resumen(vecino)),
  );
  // Foto del RECORD del tabernero en el save del destino: es la referencia
  // del bloque 5 (dónde lo dejamos, según el único sitio que lo sabe).
  const mercaderAlIrnos = npcsDe(leerSave(partida.sessionId)).find((e) => e.id === MERCADER)?.position ?? null;
  ctx.log(`tabernero en el save al irnos: ${JSON.stringify(mercaderAlIrnos)} · celda ${JSON.stringify(CELDA_DEL_MERCADER)}`);
  await ctx.shot("en-el-destino");

  // ── Vuelta (rama CACHEADA: recordSceneLoaded con firstRegistration=false) ─
  const alli = await ctx.page.evaluate(mirar);
  const vuelta = alli.exits.find((e) => e.place_id !== destino.place_id) ?? alli.exits[0];
  if (!vuelta) return ctx.sinMedir("el destino no ofrece la vuelta: no hay re-entrada que medir");
  const regreso = await viajarPorSalidas(ctx, vuelta.name, "el jugador vuelve al tile de partida");
  ctx.expect("la vuelta acaba en el tile de partida", regreso.scene_id === ORIGEN, JSON.stringify(regreso));
  await ctx.shot("de-vuelta");

  // El save de la vuelta lo escribe el bridge justo tras re-registrar la
  // escena; se espera a que el ledger tenga al vecino Y a los dos del origen.
  const despues = await esperarEnElSave(
    partida.sessionId,
    (s) => {
      const n = npcsDe(s);
      return n.some((e) => e.id === HOSTIL) && n.some((e) => e.id === MERCADER) && (vecino ? n.some((e) => e.id === vecino.id) : true)
        ? s
        : null;
    },
    30_000,
  );
  if (!despues) return ctx.sinMedir("el save de la vuelta no apareció en 30 s: no hay ledger que comparar");
  const npcsDespues = npcsDe(despues);
  ctx.log(`ledger tras volver: ${JSON.stringify(npcsDespues.map(resumen))}`);

  // ── 3 · Sin duplicados ───────────────────────────────────────────────────
  const ids = npcsDespues.map((e) => e.id);
  const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
  ctx.expect("tras ida y vuelta ningún NPC está dos veces en el ledger", repetidos.length === 0, JSON.stringify(repetidos));

  // ── 4 · Nadie purgado ni repuesto ────────────────────────────────────────
  for (const id of [HOSTIL, MERCADER]) {
    const a = npcsAntes.find((e) => e.id === id);
    const d = npcsDespues.find((e) => e.id === id);
    ctx.expect(
      `${id} sigue registrado en ${ORIGEN} como scene_init (no lo purgó la re-entrada)`,
      Boolean(d && d.scene_id === ORIGEN && d.spawn_reason === "scene_init"),
      JSON.stringify(d && resumen(d)),
    );
    ctx.expect(
      `${id} es el MISMO record (spawned_at y spawn_event_id de la primera vez), no uno repuesto`,
      Boolean(a && d && a.spawned_at === d.spawned_at && a.spawn_event_id === d.spawn_event_id),
      JSON.stringify({ antes: a && resumen(a), despues: d && resumen(d) }),
    );
  }

  // ── 5 · La posición del RECORD se conserva: el tabernero ─────────────────
  const mercaderSave = npcsDespues.find((e) => e.id === MERCADER)?.position ?? null;
  const paseo = mercaderAlIrnos ? dist(mercaderAlIrnos, CELDA_DEL_MERCADER) : 0;
  if (paseo < PASEO_MINIMO_M) {
    ctx.sinMedirBloque(
      `el tabernero solo había paseado ${paseo.toFixed(2)} m al irnos (< ${PASEO_MINIMO_M}): «sigue donde estaba» ` +
        `y «repuesto en su celda» no se distinguen en esta partida`,
    );
  } else {
    ctx.expect(
      `en el save, ${MERCADER} sigue lejos de su celda tras volver (≥ ${FUERA_DE_LA_CELDA_M} m; había paseado ${paseo.toFixed(2)} m)`,
      mercaderSave !== null && dist(mercaderSave, CELDA_DEL_MERCADER) >= FUERA_DE_LA_CELDA_M,
      JSON.stringify({ alIrnos: mercaderAlIrnos, alVolver: mercaderSave, celda: CELDA_DEL_MERCADER }),
    );
  }

  // ── 5b · Lo que el jugador ve del hostil (sim y cable, no el record) ─────
  const bandidoSave = npcsDespues.find((e) => e.id === HOSTIL)?.position ?? null;
  ctx.expect(
    `en el save, ${HOSTIL} NO ha vuelto a su celda del Format D (≥ ${SE_HA_MOVIDO_M} m)`,
    bandidoSave !== null && dist(bandidoSave, CELDA_DE_SPAWN) >= SE_HA_MOVIDO_M,
    JSON.stringify({ save: bandidoSave, celda: CELDA_DE_SPAWN }),
  );
  const bandidoCliente = await ctx.waitFor(
    "el cliente vuelve a tener al bandido en el mundo",
    (id) => {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      return e ? [e.pos.x, e.pos.y, e.pos.z] : null;
    },
    30_000,
    HOSTIL,
  );
  ctx.expect(
    `y lo que el jugador VE: ${HOSTIL} tampoco está en su celda en el cliente`,
    dist(bandidoCliente, CELDA_DE_SPAWN) >= SE_HA_MOVIDO_M,
    JSON.stringify({ cliente: bandidoCliente, celda: CELDA_DE_SPAWN }),
  );

  // ── 6 · El del destino sigue registrado en SU tile ───────────────────────
  if (vecino) {
    const v = npcsDespues.find((e) => e.id === vecino.id);
    ctx.expect(
      `el NPC del destino (${vecino.id}) sigue en el ledger con scene_id ${enDestino.scene_id}`,
      Boolean(v && v.scene_id === enDestino.scene_id),
      JSON.stringify(v && resumen(v)),
    );
  }
}
