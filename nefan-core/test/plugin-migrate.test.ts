/** F7 (next.md §7.3 "Evolución") — migración de plugins por los DOS caminos:
 *  el del FS en resume (el manifest del disco sube de versión) y el de runtime
 *  (`plugin_register` del motor narrativo con el mismo `name` y versión mayor,
 *  issue #164). La política del salto es una sola función compartida
 *  (`src/plugins/migrate.ts`), y aquí se comprueba que de verdad lo es:
 *  los mensajes de rechazo de los dos caminos se comparan carácter a carácter. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import {
  activatePluginsForNewSession,
  bindPluginsForResume,
  PluginIntegrityError,
  type LoadedPlugin,
} from "../src/plugins/loader.js";
import { PluginRegisterError, registerRuntimePlugin } from "../src/plugins/register.js";
import { dispatchPluginEvents } from "../src/plugins/dispatcher.js";
import { inspectPlugin } from "../src/plugins/views.js";
import { runMigrationStep } from "../src/plugins/dsl/evaluate.js";
import { DslError } from "../src/plugins/dsl/errors.js";
import { validateManifestStatic } from "../src/plugins/validate.js";
import { computePluginId } from "../src/plugins/hash.js";
import { PluginManifestSchema, type PluginManifest, type PluginRecord } from "../src/plugins/types.js";
import {
  migratePluginSlice,
  PluginMigrationError,
  type PluginMigrationEnv,
} from "../src/plugins/migrate.js";

function lp(raw: unknown): LoadedPlugin {
  const manifest = PluginManifestSchema.parse(raw);
  const id = computePluginId(manifest);
  return { id, manifest: { ...manifest, id }, file: `${manifest.name}-v${manifest.version}.json` };
}

const V1 = {
  version: 1,
  name: "score",
  description: "puntos",
  origin: { author: "developer" as const, rationale: "test F7 v1" },
  slice: { schema: { type: "object" }, initial: { points: 0 } },
  events_consumed: [{ type: "add", do: [{ op: "inc" as const, path: "slice.points", value: "event.n" }] }],
};

// v2: renombra points→score y añade level. migrate[1] convierte el slice v1.
const V2 = {
  version: 2,
  name: "score",
  description: "puntos + nivel",
  origin: { author: "developer" as const, rationale: "test F7 v2" },
  slice: { schema: { type: "object" }, initial: { score: 0, level: 1 } },
  events_consumed: [{ type: "add", do: [{ op: "inc" as const, path: "slice.score", value: "event.n" }] }],
  migrate: {
    "1": [
      { op: "set" as const, path: "slice.score", value: "slice.points" },
      { op: "set" as const, path: "slice.level", value: 1 },
      { op: "remove" as const, path: "slice.points" },
    ],
  },
};

async function newSessionWithV1Slice(points: number) {
  const storage = new MemorySessionStorage();
  const s1 = new NarrativeState(storage);
  s1.startNewSession("game");
  const v1 = lp(V1);
  activatePluginsForNewSession(s1, [v1]);
  s1.setPluginSlice(v1.id, { points });
  await s1.save();
  return { storage, v1Id: v1.id, sessionId: s1.session_id };
}

describe("plugin migration on resume (F7)", () => {
  it("migra el slice v1→v2 con la cadena migrate y es idempotente", async () => {
    const { storage, v1Id, sessionId } = await newSessionWithV1Slice(42);
    const v2 = lp(V2);
    assert.notEqual(v1Id, v2.id); // el bump de version cambia el hash

    // resume con el manifest v2 en disco
    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(sessionId), true);
    const active = bindPluginsForResume(s2, [v2]);

    const rec = s2.getPluginRecord(v2.id);
    assert.ok(rec, "el record debe quedar bajo el id v2");
    assert.equal(rec!.version, 2);
    assert.deepEqual(rec!.slice, { score: 42, level: 1 });
    assert.equal(s2.getPluginRecord(v1Id), undefined); // el id viejo ya no está
    assert.ok(active.has(v2.id));
    await s2.save();

    // segundo resume: ahora casa por id, sin re-migrar
    const s3 = new NarrativeState(storage);
    await s3.loadSession(s2.session_id);
    bindPluginsForResume(s3, [v2]);
    assert.deepEqual(s3.getPluginRecord(v2.id)?.slice, { score: 42, level: 1 });
  });

  it("aborta si falta un paso de la cadena migrate", async () => {
    const { storage, sessionId } = await newSessionWithV1Slice(7);
    const v3 = lp({ ...V2, version: 3, description: "v3", migrate: { "2": V2.migrate["1"] } });
    const s2 = new NarrativeState(storage);
    await s2.loadSession(sessionId);
    assert.throws(() => bindPluginsForResume(s2, [v3]), (e) => e instanceof PluginIntegrityError && /falta 'migrate\[1\]'/.test(e.message));
  });

  it("aborta ante mismo name y misma version con hash distinto (sin bump)", async () => {
    const { storage, sessionId } = await newSessionWithV1Slice(1);
    const v1b = lp({ ...V1, description: "otro texto, misma version" });
    const s2 = new NarrativeState(storage);
    await s2.loadSession(sessionId);
    assert.throws(() => bindPluginsForResume(s2, [v1b]), (e) => e instanceof PluginIntegrityError && /mantiene version 1/.test(e.message));
  });

  it("aborta ante degradación (manifest en disco anterior al del save)", async () => {
    // save migrado a v2, luego en disco sólo hay v1 → downgrade
    const { storage, sessionId } = await newSessionWithV1Slice(5);
    const v2 = lp(V2);
    const s2 = new NarrativeState(storage);
    await s2.loadSession(sessionId);
    bindPluginsForResume(s2, [v2]);
    await s2.save();

    const s3 = new NarrativeState(storage);
    await s3.loadSession(s2.session_id);
    assert.throws(() => bindPluginsForResume(s3, [lp(V1)]), (e) => e instanceof PluginIntegrityError && /ANTERIOR al del save/.test(e.message));
  });

  it("validateManifestStatic rechaza migrate que no sea slice-only", () => {
    const external = PluginManifestSchema.parse({
      ...V2,
      writes: ["player.gold"],
      migrate: { "1": [{ op: "set", path: "player.gold", value: 5 }] },
    });
    const errs = validateManifestStatic(external);
    assert.ok(errs.some((e) => /migrate\[1\].*sólo puede escribir en slice/.test(e)), errs.join(" | "));

    const emits = PluginManifestSchema.parse({
      ...V2,
      events_produced: ["boom"],
      migrate: { "1": [{ op: "emit_event", value: { type: "boom", payload: {} } }] },
    });
    assert.ok(validateManifestStatic(emits).some((e) => /migrate\[1\].*emit_event no está permitido/.test(e)));
  });

  it("runMigrationStep es slice-only y puro", () => {
    const ctx = { slice: { a: 1 }, player: { gold: 100 } };
    const out = runMigrationStep([{ op: "set", path: "slice.b", value: "slice.a" }], ctx);
    assert.deepEqual(out, { a: 1, b: 1 });
    assert.deepEqual(ctx.slice, { a: 1 }); // entrada intacta (puro)

    assert.throws(
      () => runMigrationStep([{ op: "set", path: "player.gold", value: 0 }], ctx),
      DslError,
    );
  });
});


// ── Camino RUNTIME (#164): plugin_register con versión mayor ────────────────
//
// Los manifests de arriba sirven al camino FS, que no exige fixtures. Un
// registro en runtime SÍ las exige (son su única red de seguridad), así que
// estos son sus equivalentes con fixtures y con origin del motor. R2 añade
// además un evento que NO existe en v1 (`level_up`): es lo que distingue "el
// record dice v2" de "el record SIRVE reglas v2".

const R1 = {
  version: 1,
  name: "score",
  description: "puntos",
  origin: { author: "narrative_engine" as const, rationale: "el jugador compite en la taberna" },
  slice: { schema: { type: "object" }, initial: { points: 0 } },
  events_consumed: [
    { type: "add", do: [{ op: "inc" as const, path: "slice.points", value: "event.n" }] },
  ],
  fixtures: [{ before: { points: 0 }, event: { type: "add", n: 3 }, after: { points: 3 } }],
};

const R2 = {
  version: 2,
  name: "score",
  description: "puntos + nivel",
  origin: { author: "narrative_engine" as const, rationale: "la competición ahora tiene rangos" },
  slice: { schema: { type: "object" }, initial: { score: 0, level: 1 } },
  events_consumed: [
    { type: "add", do: [{ op: "inc" as const, path: "slice.score", value: "event.n" }] },
    { type: "level_up", do: [{ op: "inc" as const, path: "slice.level", value: 1 }] },
  ],
  migrate: {
    "1": [
      { op: "set" as const, path: "slice.score", value: "slice.points" },
      { op: "set" as const, path: "slice.level", value: 1 },
      { op: "remove" as const, path: "slice.points" },
    ],
  },
  fixtures: [
    { before: { score: 0, level: 1 }, event: { type: "add", n: 2 }, after: { score: 2, level: 1 } },
    {
      before: { score: 0, level: 1 },
      event: { type: "level_up" },
      after: { score: 0, level: 2 },
    },
  ],
};

function freshSession(storage = new MemorySessionStorage()) {
  const state = new NarrativeState(storage);
  state.startNewSession("game");
  return { state, storage, active: new Map<string, PluginManifest>() };
}

/** v1 registrado por el motor y su slice ya movido: migrar sobre un slice
 *  vacío no distinguiría una migración de una génesis. */
function runtimeV1WithPoints(points: number) {
  const { state, storage, active } = freshSession();
  const reg = registerRuntimePlugin(state, active, R1);
  const tick = dispatchPluginEvents(state, active, [
    { pluginId: reg.id, type: "add", payload: { n: points } },
  ]);
  assert.equal(tick.ok, true, "el slice de partida debe quedar movido");
  return { state, storage, active, v1Id: reg.id };
}

describe("plugin migration on plugin_register (#164)", () => {
  it("migra el slice y SUSTITUYE el record: un solo plugin, id/version/slice nuevos", () => {
    const { state, active, v1Id } = runtimeV1WithPoints(41);
    const before = state.getPluginRecord(v1Id);
    assert.deepEqual(before?.slice, { points: 41 });
    const activatedAt = before!.activated_at;

    const result = registerRuntimePlugin(state, active, R2);

    assert.equal(result.action, "migrated");
    assert.equal(result.fromVersion, 1);
    assert.equal(result.fromOriginAuthor, "narrative_engine");
    assert.notEqual(result.id, v1Id, "el bump de version cambia el hash");

    assert.equal(state.plugins.length, 1, "NUNCA dos records del mismo name");
    const rec = state.getPluginRecord(result.id);
    assert.ok(rec);
    assert.equal(rec.name, "score");
    assert.equal(rec.version, 2);
    assert.deepEqual(rec.slice, { score: 41, level: 1 }, "el slice se convirtió, no se re-proyectó");
    assert.equal(rec.activated_at, activatedAt, "cuándo entró el sistema no cambia");
    // El manifest embebido es el NUEVO: si fuera el v1 bajo el id v2, todos
    // los asserts de arriba pasarían igual y el resume serviría reglas viejas.
    assert.equal(rec.manifest?.version, 2);
    assert.equal(computePluginId(rec.manifest!), rec.id);

    assert.equal(active.has(v1Id), false, "el id viejo sale del registry activo");
    assert.equal(active.get(result.id)?.version, 2);
  });

  it("el origin del record pasa a decir quién pone las reglas ahora", () => {
    const { state, active } = runtimeV1WithPoints(1);
    const result = registerRuntimePlugin(state, active, R2);
    const rec = state.getPluginRecord(result.id);
    assert.equal(rec?.origin.author, "narrative_engine");
    assert.equal(rec?.origin.rationale, R2.origin.rationale, "la razón es la del manifest vigente");
  });

  it("un `name` distinto se registra al lado: esto no convierte dos plugins en una migración", () => {
    const { state, active } = runtimeV1WithPoints(5);
    const otro = { ...R2, name: "score_torneo", migrate: undefined };
    const result = registerRuntimePlugin(state, active, otro);
    assert.equal(result.action, "created");
    assert.equal(state.plugins.length, 2);
    assert.deepEqual(
      state.plugins.map((p) => `${p.name} v${p.version}`).sort(),
      ["score v1", "score_torneo v2"],
    );
  });

  it("el mismo manifest exacto es idempotente: no-op, sin tocar el slice vivo", () => {
    const { state, active, v1Id } = runtimeV1WithPoints(7);
    const result = registerRuntimePlugin(state, active, R1);
    assert.equal(result.action, "unchanged");
    assert.equal(result.id, v1Id);
    assert.equal(
      result.fixturesPassed,
      0,
      "no se replayó ninguna: decir el número del manifest le vendería al motor una validación que no ocurrió",
    );
    assert.equal(state.plugins.length, 1);
    assert.deepEqual(
      state.getPluginRecord(v1Id)?.slice,
      { points: 7 },
      "re-registrar NO re-proyecta: eso resetearía el sistema en un reintento",
    );
    assert.equal(active.get(v1Id)?.name, "score");
  });

  it("tras migrar, el resume sirve las reglas NUEVAS y es idempotente", async () => {
    const { state, storage, active } = runtimeV1WithPoints(10);
    const { id } = registerRuntimePlugin(state, active, R2);
    assert.equal(await state.save(), true);

    // Resume sin manifests en disco: todo sale del manifest embebido.
    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(state.session_id), true);
    const active2 = bindPluginsForResume(s2, []);

    // `level_up` SOLO existe en v2: con el manifest v1 embebido bajo el id v2
    // el dispatcher respondería not_consumed y el slice no se movería.
    const tick = dispatchPluginEvents(s2, active2, [
      { pluginId: id, type: "level_up", payload: {} },
    ]);
    assert.equal(tick.ok, true, `el resume debe servir reglas v2: ${JSON.stringify(tick.error)}`);
    assert.deepEqual(s2.getPluginRecord(id)?.slice, { score: 10, level: 2 });

    // Y el segundo ciclo save→resume devuelve el mismo record.
    const antes = structuredClone(s2.getPluginRecord(id));
    await s2.save();
    const s3 = new NarrativeState(storage);
    await s3.loadSession(s2.session_id);
    bindPluginsForResume(s3, []);
    assert.deepEqual(s3.getPluginRecord(id), antes);
  });

  it("el motor puede tomar un plugin SHIPPED, y el record deja de decir que es del disco", async () => {
    const { state, storage, active } = freshSession();
    const shipped = lp(V1); // origin.author "developer", sin manifest embebido
    for (const [k, v] of activatePluginsForNewSession(state, [shipped])) active.set(k, v);
    state.setPluginSlice(shipped.id, { points: 3 });

    const result = registerRuntimePlugin(state, active, R2);
    assert.equal(result.action, "migrated");
    assert.equal(result.fromOriginAuthor, "developer", "el caller puede avisar del secuestro");

    const rec = state.getPluginRecord(result.id);
    assert.equal(rec?.origin.author, "narrative_engine");
    assert.equal(rec?.manifest?.version, 2, "el manifest pasa a vivir en el save");
    assert.deepEqual(rec?.slice, { score: 3, level: 1 });
    assert.equal(state.plugins.length, 1);

    // Y en el resume manda el embebido aunque el v1 del disco siga ahí.
    await state.save();
    const s2 = new NarrativeState(storage);
    await s2.loadSession(state.session_id);
    const avisos: string[] = [];
    const warn = console.warn;
    console.warn = (msg: unknown) => void avisos.push(String(msg));
    let active2: Map<string, PluginManifest>;
    try {
      active2 = bindPluginsForResume(s2, [shipped]);
    } finally {
      console.warn = warn;
    }
    assert.equal(active2.get(result.id)?.version, 2);
    assert.equal(active2.has(shipped.id), false);
    // El aviso del resume es la ÚNICA señal que queda del secuestro en los
    // arranques siguientes: tiene que decir que lo sustituyeron, no que el
    // plugin es nuevo y nunca se activó, que es lo contrario de lo que pasó.
    const aviso = avisos.find((a) => a.includes("score")) ?? "";
    assert.match(aviso, /sustituyó por v2/, aviso);
    assert.doesNotMatch(aviso, /plugins nuevos sólo se activan/, aviso);
    assert.match(aviso, /partida nueva/, "y qué haría falta para deshacerlo");
  });
});

describe("un id viejo sigue encontrando su sistema (referencias colgantes)", () => {
  // El `plugin_id` es el hash del manifest, así que evolucionar le cambia el
  // id al sistema. Lo que quedó escrito con el id viejo NO se puede reescribir
  // entero: están los map triggers del save, el historial de consequences (que
  // es un acta de lo que pasó y falsearlo sería peor), y sobre todo lo que el
  // motor narrativo recuerde de un `plugin_list` de hace diez turnos, que no
  // vive en el save de nadie. Por eso el record guarda su dirección anterior.

  it("el record apunta de dónde viene, y solo cuando de verdad cambió de id", () => {
    const { state, active, v1Id } = runtimeV1WithPoints(3);
    const { id } = registerRuntimePlugin(state, active, R2);
    assert.deepEqual(state.getPluginRecord(id)?.superseded_ids, [v1Id]);
    // Un no-op no inventa una dirección nueva.
    registerRuntimePlugin(state, active, R2);
    assert.deepEqual(state.getPluginRecord(id)?.superseded_ids, [v1Id]);
  });

  it("un evento dirigido al id de ANTES de migrar se entrega igual", () => {
    const { state, active, v1Id } = runtimeV1WithPoints(5);
    const { id } = registerRuntimePlugin(state, active, R2);

    // Exactamente lo que hace un map trigger escrito antes de la migración:
    // la consequence lleva el plugin_id que existía cuando se escribió.
    const tick = dispatchPluginEvents(state, active, [
      { pluginId: v1Id, type: "add", payload: { n: 4 } },
    ]);
    assert.equal(tick.ok, true, JSON.stringify(tick.error));
    assert.deepEqual(tick.undelivered, [], "no es una referencia colgante: es la anterior");
    assert.deepEqual(state.getPluginRecord(id)?.slice, { score: 9, level: 1 });
  });

  it("y sobrevive al save→resume, que es cuando el trigger se pisa de verdad", async () => {
    const { state, storage, active } = runtimeV1WithPoints(1);
    const v1Id = state.plugins[0].id;
    const { id } = registerRuntimePlugin(state, active, R2);
    await state.save();

    const s2 = new NarrativeState(storage);
    await s2.loadSession(state.session_id);
    const active2 = bindPluginsForResume(s2, []);
    const tick = dispatchPluginEvents(s2, active2, [
      { pluginId: v1Id, type: "level_up", payload: {} },
    ]);
    assert.equal(tick.ok, true, JSON.stringify(tick.error));
    assert.deepEqual(s2.getPluginRecord(id)?.slice, { score: 1, level: 2 });
  });

  it("plugin_inspect por el id viejo responde con el VIGENTE, no con un 'desconocido'", () => {
    const { state, active, v1Id } = runtimeV1WithPoints(2);
    const { id } = registerRuntimePlugin(state, active, R2);
    const info = inspectPlugin(
      { plugins: state.plugins, world: state.world, player: state.player, entities: state.entities },
      active,
      v1Id,
    );
    assert.equal(info.id, id, "le devuelve al motor el id que debe usar a partir de ahora");
    assert.equal(info.version, 2);
    assert.deepEqual(info.slice, { score: 2, level: 1 });
  });

  it("un id que nunca fue de nadie sigue siendo desconocido (la dirección no es un comodín)", () => {
    const { state, active } = runtimeV1WithPoints(1);
    registerRuntimePlugin(state, active, R2);
    const tick = dispatchPluginEvents(state, active, [
      { pluginId: "f".repeat(64), type: "add", payload: { n: 1 } },
    ]);
    assert.equal(tick.ok, true, "no tumba el turno…");
    assert.deepEqual(tick.undelivered, [
      { pluginId: "f".repeat(64), type: "add", reason: "unknown_plugin" },
    ]);
    assert.deepEqual(state.plugins[0].slice, { score: 1, level: 1 }, "…pero tampoco lo aplica");
  });

  it("re-registrar el manifest VIEJO sigue siendo una degradación, no un no-op", () => {
    // La dirección anterior resuelve la identidad del SISTEMA; `getPluginRecord`
    // sigue resolviendo la del MANIFEST. Si se hubiera puesto la caída dentro
    // de getPluginRecord, esto respondería `unchanged` y el motor creería que
    // ha vuelto a la v1.
    const { state, active } = runtimeV1WithPoints(1);
    registerRuntimePlugin(state, active, R2);
    assert.throws(
      () => registerRuntimePlugin(state, active, R1),
      (e: unknown) => e instanceof PluginRegisterError && /ANTERIOR al del save/.test(e.message),
    );
  });
});

describe("una sola cadena de migración: los dos caminos rechazan con el MISMO texto", () => {
  // «El mismo texto» se comprueba carácter a carácter, que es lo único que lo
  // distingue de «uno parecido». Con un matiz que hay que dejar escrito: el
  // veredicto es idéntico y el camino del FS le AÑADE un localizador —qué
  // fichero del disco trae el manifest ofensivo—, porque quien lee ese error
  // es alguien que acaba de romper un JSON y si no, tiene que buscarlo entre
  // data/plugins/ y data/games/{id}/plugins/. Ese dato no puede vivir en el
  // texto compartido: en el registro en runtime no hay fichero ninguno. Así
  // que la relación que se pin, y también exacta, es «el del resume es el del
  // registro más el localizador, y nada más».
  /** El mensaje del rechazo, no solo su clase: es lo único que distingue "el
   *  mismo texto" de "uno parecido". */
  function mensajeDe(fn: () => unknown, tipo: new (...a: never[]) => Error): string {
    try {
      fn();
    } catch (err) {
      assert.ok(err instanceof tipo, `esperado ${tipo.name}, llegó ${String(err)}`);
      return (err as Error).message;
    }
    throw new assert.AssertionError({ message: "se esperaba un rechazo y no lo hubo" });
  }

  /** Mensaje del rechazo por el camino FS (resume) para un salto dado. */
  async function mensajeResume(v1: unknown, target: unknown): Promise<string> {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    s1.startNewSession("game");
    activatePluginsForNewSession(s1, [lp(v1)]);
    await s1.save();
    const s2 = new NarrativeState(storage);
    await s2.loadSession(s1.session_id);
    return mensajeDe(() => bindPluginsForResume(s2, [lp(target)]), PluginIntegrityError);
  }

  /** Mensaje del rechazo por el camino runtime (plugin_register). */
  function mensajeRegistro(v1: unknown, target: unknown): string {
    const { state, active } = freshSession();
    registerRuntimePlugin(state, active, v1);
    return mensajeDe(() => registerRuntimePlugin(state, active, target), PluginRegisterError);
  }

  /** El veredicto del resume, sin el localizador que le añade su envoltorio. */
  const conRuta = (registro: string, target: unknown) =>
    `${registro} (el manifest nuevo es ${lp(target).file})`;

  it("hueco en la cadena: 'falta migrate[1]' idéntico en resume y en registro", async () => {
    const v3 = { ...R2, version: 3, description: "v3", migrate: { "2": R2.migrate["1"] } };
    const resume = await mensajeResume(R1, v3);
    const registro = mensajeRegistro(R1, v3);
    assert.match(resume, /falta 'migrate\[1\]'/);
    assert.equal(resume, conRuta(registro, v3));
  });

  it("cambio sin bump de versión: mismo texto (ids incluidos, que salen del hash)", async () => {
    const v1b = { ...R1, description: "otro texto, misma version" };
    const resume = await mensajeResume(R1, v1b);
    const registro = mensajeRegistro(R1, v1b);
    assert.match(resume, /mantiene version 1/);
    assert.equal(resume, conRuta(registro, v1b));
  });

  it("y el localizador es lo ÚNICO que el resume añade: el veredicto no cambia", async () => {
    const v3 = { ...R2, version: 3, description: "v3", migrate: { "2": R2.migrate["1"] } };
    const resume = await mensajeResume(R1, v3);
    const registro = mensajeRegistro(R1, v3);
    assert.ok(resume.startsWith(registro), `${resume}\n≠ ${registro}…`);
    // Y al revés: al motor narrativo no se le manda a tocar un fichero que él
    // nunca ha tenido delante.
    assert.doesNotMatch(registro, /archivo|disco|\.json/i, registro);
  });

  it("degradación: mismo texto", async () => {
    // Resume: save ya migrado a v2, y en disco sólo queda v1.
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    s1.startNewSession("game");
    activatePluginsForNewSession(s1, [lp(R1)]);
    await s1.save();
    const s2 = new NarrativeState(storage);
    await s2.loadSession(s1.session_id);
    bindPluginsForResume(s2, [lp(R2)]);
    await s2.save();
    const s3 = new NarrativeState(storage);
    await s3.loadSession(s2.session_id);
    const resume = mensajeDe(() => bindPluginsForResume(s3, [lp(R1)]), PluginIntegrityError);

    // Registro: v1 → v2 (ok) → v1 otra vez.
    const { state, active } = freshSession();
    registerRuntimePlugin(state, active, R1);
    registerRuntimePlugin(state, active, R2);
    const registro = mensajeDe(() => registerRuntimePlugin(state, active, R1), PluginRegisterError);

    assert.match(resume, /ANTERIOR al del save/);
    assert.equal(resume, `${registro} (el manifest nuevo es ${lp(R1).file})`);
  });

  it("un salto rechazado no deja el estado a medias", () => {
    const { state, active, v1Id } = runtimeV1WithPoints(9);
    const v3 = { ...R2, version: 3, description: "v3", migrate: { "2": R2.migrate["1"] } };
    assert.throws(() => registerRuntimePlugin(state, active, v3), PluginRegisterError);
    assert.equal(state.plugins.length, 1);
    assert.equal(state.getPluginRecord(v1Id)?.version, 1);
    assert.deepEqual(state.getPluginRecord(v1Id)?.slice, { points: 9 });
    assert.equal(active.get(v1Id)?.version, 1);
  });
});

describe("candados del record migrado (NarrativeState)", () => {
  it("migratePluginRecord rechaza un manifest embebido que no es el del id", () => {
    const { state, active } = runtimeV1WithPoints(2);
    const rec = state.plugins[0];
    const v1Manifest = rec.manifest!;
    assert.throws(
      () =>
        state.migratePluginRecord(rec.id, {
          id: computePluginId(PluginManifestSchema.parse(R2)),
          version: 2,
          slice: { score: 2, level: 1 },
          // El manifest de la versión ANTERIOR bajo el id de la nueva: el
          // trampantojo que dejaría al resume sirviendo reglas viejas.
          manifest: v1Manifest,
          origin: rec.origin,
        }),
      /no es el del id/,
    );
    assert.equal(state.plugins[0].version, 1, "nada se tocó");
    assert.equal(active.size, 1);
  });

  it("addPlugin exige la misma correspondencia manifest↔id que su hermano", () => {
    // El candado tiene que estar en las DOS puertas de escritura: si solo lo
    // lleva la migración, un alta puede meter el mismo trampantojo por el lado
    // fácil y el resume siguiente sirve reglas de otra versión.
    const { state } = runtimeV1WithPoints(1);
    const v1Manifest = state.plugins[0].manifest!;
    assert.throws(
      () =>
        state.addPlugin({
          id: computePluginId(PluginManifestSchema.parse(R2)),
          name: "otro_sistema",
          version: 2,
          slice: {},
          origin: R2.origin,
          activated_at: new Date().toISOString(),
          manifest: v1Manifest,
        }),
      /no es el del id/,
    );
    assert.equal(state.plugins.length, 1);
  });

  it("y el resume no se cree un manifest embebido que no es el de su id", async () => {
    // La puerta de LECTURA: un save es un fichero y puede llegar corrupto (una
    // edición a mano, un bridge con un bug). Servirlo significa jugar con
    // reglas que no son las que el id promete, y eso no chilla solo.
    const { state, storage, active } = runtimeV1WithPoints(1);
    const { id } = registerRuntimePlugin(state, active, R2);
    await state.save();

    const s2 = new NarrativeState(storage);
    await s2.loadSession(state.session_id);
    // El manifest v1 bajo el id v2, escrito directamente en el estado cargado.
    s2.plugins[0].manifest = PluginManifestSchema.parse({ ...R1, id: undefined });
    assert.throws(
      () => bindPluginsForResume(s2, []),
      (e: unknown) =>
        e instanceof PluginIntegrityError &&
        /no es el suyo/.test(e.message) &&
        /save está corrupto/.test(e.message),
    );
    assert.equal(id.length, 64);
  });

  it("addPlugin rechaza un segundo record con el mismo name (el bug de #164, irrepresentable)", () => {
    const { state } = runtimeV1WithPoints(1);
    assert.throws(
      () =>
        state.addPlugin({
          id: computePluginId(PluginManifestSchema.parse(R2)),
          name: "score",
          version: 2,
          slice: {},
          origin: R2.origin,
          activated_at: new Date().toISOString(),
        }),
      /se MIGRA con migratePluginRecord/,
    );
    assert.equal(state.plugins.length, 1);
  });
});

// ── La cadena compartida, en directo ───────────────────────────────────────
//
// Los tests de arriba la ejercen por sus dos caminos. Estos van al módulo
// puro: el TEXTO de cada rechazo (que es el contrato con quien lo lee: un
// developer en el resume, el motor narrativo en el registro), su `kind`, y lo
// que el DSL puede leer mientras migra.

function recordDe(raw: unknown, slice: unknown): PluginRecord {
  const { id, manifest } = lp(raw);
  return {
    id,
    name: manifest.name,
    version: manifest.version,
    slice,
    origin: manifest.origin,
    activated_at: "2026-08-23T00:00:00.000Z",
  };
}

const SIN_MAS: PluginMigrationEnv = { records: [] };

function rechazo(record: PluginRecord, target: unknown, env = SIN_MAS): PluginMigrationError {
  try {
    migratePluginSlice(record, lp(target), env);
  } catch (err) {
    assert.ok(err instanceof PluginMigrationError, `esperado PluginMigrationError: ${String(err)}`);
    return err;
  }
  throw new assert.AssertionError({ message: "se esperaba un rechazo y no lo hubo" });
}

describe("migratePluginSlice: el texto y el motivo de cada rechazo", () => {
  it("cambio sin bump: dice qué versión mantiene, qué dos manifests son y qué hacer", () => {
    const v1b = { ...V1, description: "otro texto, misma version" };
    const err = rechazo(recordDe(V1, { points: 1 }), v1b);
    assert.equal(err.name, "PluginMigrationError");
    assert.equal(err.kind, "no_bump");
    assert.equal(
      err.message,
      `el manifest de 'score' cambió pero mantiene version 1 ` +
        `(activo ${lp(V1).id.slice(0, 12)}… ≠ nuevo ${lp(v1b).id.slice(0, 12)}…). ` +
        `Un cambio de comportamiento exige subir 'version' y añadir 'migrate[1]', ` +
        `o vuelve al manifest original.`,
    );
  });

  it("degradación: dice las dos versiones y el suelo aceptable", () => {
    const err = rechazo(recordDe(V2, { score: 3, level: 1 }), V1);
    assert.equal(err.kind, "downgrade");
    assert.equal(
      err.message,
      `el manifest de 'score' es v1, ANTERIOR al del save v2 — ` +
        `no se degrada un slice; usa una versión ≥ 2 o inicia sesión nueva.`,
    );
  });

  it("hueco en la cadena: nombra el paso que falta y el salto entero", () => {
    const v3 = { ...V2, version: 3, description: "v3", migrate: { "2": V2.migrate["1"] } };
    const err = rechazo(recordDe(V1, { points: 1 }), v3);
    assert.equal(err.kind, "missing_step");
    assert.equal(
      err.message,
      `falta 'migrate[1]' en 'score' para evolucionar v1→v3 ` +
        `(se requiere una entrada por cada versión intermedia). ` +
        `Añádela al manifest de la versión nueva.`,
    );
  });

  it("una entrada migrate VACÍA es un hueco, no un paso que no hace nada", () => {
    // Sin esto, `migrate: {"1": []}` pasaría por buena y el slice llegaría a
    // las reglas nuevas con el shape viejo.
    const err = rechazo(recordDe(V1, { points: 1 }), { ...V2, migrate: { "1": [] } });
    assert.equal(err.kind, "missing_step");
    assert.match(err.message, /falta 'migrate\[1\]'/);
  });

  it("un paso que revienta se reporta con su versión y el motivo del DSL", () => {
    // Un fallo que la validación estática NO puede cazar y que sí llega a
    // producción: el path de escritura interpola algo que durante una
    // migración no existe. `event` solo existe cuando el plugin consume un
    // evento; en un migrate no hay ninguno, así que la clave no resuelve.
    // (Escribir FUERA del slice también lanza, pero eso ya lo corta
    // validateManifestStatic antes de llegar aquí por los dos caminos.)
    const interp = {
      ...V2,
      migrate: { "1": [{ op: "set" as const, path: "slice.{event.key}", value: 1 }] },
    };
    assert.deepEqual(
      validateManifestStatic(PluginManifestSchema.parse(interp)),
      [],
      "el manifest es estáticamente válido: este fallo solo se ve al migrar",
    );
    const err = rechazo(recordDe(V1, { points: 1 }), interp);
    assert.equal(err.kind, "step_failed");
    assert.match(err.message, /^migrate\[1\] de 'score' falló: /);
    assert.match(err.message, /interpolación/, "el motivo del DSL viaja entero");
  });
});

describe("una cadena de más de un paso, con éxito", () => {
  // Lo que la descripción de `plugin_register` le promete al motor:
  // «migrate["1"]+migrate["2"] to go 1→3». Todos los demás casos de v3 del
  // fichero están para provocar el rechazo por hueco; este recorre el bucle
  // de verdad, que es lo que va a hacer un mundo que lleve meses vivo.
  //
  // migrate[2] lee `slice.score`, que SOLO existe si migrate[1] corrió antes:
  // así el test distingue «se aplicaron los dos, en orden» de «se aplicó el
  // último», que es el fallo que un bucle mal escrito produce.
  const V3 = {
    ...V2,
    version: 3,
    description: "puntos + nivel + rango",
    slice: { schema: { type: "object" }, initial: { score: 0, level: 1, rango: 0 } },
    migrate: {
      "1": V2.migrate["1"],
      "2": [{ op: "set" as const, path: "slice.rango", value: "slice.score" }],
    },
    fixtures: [
      {
        before: { score: 1, level: 1, rango: 1 },
        event: { type: "add", n: 1 },
        after: { score: 2, level: 1, rango: 1 },
      },
    ],
  };

  it("migratePluginSlice recorre v1→v3 aplicando los dos pasos en orden", () => {
    const slice = migratePluginSlice(recordDe(V1, { points: 7 }), lp(V3), SIN_MAS);
    assert.deepEqual(slice, { score: 7, level: 1, rango: 7 });
  });

  it("y por el camino del motor: un solo registro salta dos versiones de golpe", () => {
    const { state, active, v1Id } = runtimeV1WithPoints(7);
    const result = registerRuntimePlugin(state, active, { ...V3, origin: R2.origin });
    assert.equal(result.action, "migrated");
    assert.equal(result.fromVersion, 1);
    assert.equal(state.plugins.length, 1);
    const rec = state.getPluginRecord(result.id);
    assert.equal(rec?.version, 3);
    assert.deepEqual(rec?.slice, { score: 7, level: 1, rango: 7 });
    assert.deepEqual(rec?.superseded_ids, [v1Id], "la dirección anterior es la del salto entero");
  });
});

describe("migratePluginSlice: qué puede leer una migración", () => {
  it("migrate ve el mundo, al jugador y las entidades del momento de migrar", () => {
    const target = {
      ...V2,
      migrate: {
        "1": [
          { op: "set" as const, path: "slice.score", value: "slice.points" },
          { op: "set" as const, path: "slice.level", value: 1 },
          { op: "set" as const, path: "slice.oro_al_migrar", value: "player.gold" },
          { op: "set" as const, path: "slice.donde", value: "world.tile" },
          { op: "set" as const, path: "slice.testigos", value: "entities[0].name" },
          { op: "remove" as const, path: "slice.points" },
        ],
      },
    };
    const slice = migratePluginSlice(recordDe(V1, { points: 4 }), lp(target), {
      world: { tile: "tile0_0" },
      player: { gold: 120 },
      entities: [{ name: "Boris" }],
      records: [],
    });
    assert.deepEqual(slice, {
      score: 4,
      level: 1,
      oro_al_migrar: 120,
      donde: "tile0_0",
      testigos: "Boris",
    });
  });

  it("y el slice de los demás plugins de la sesión (solo lectura, §7.3)", () => {
    const vecino = recordDe({ ...V1, name: "otro_sistema" }, { points: 9 });
    const target = {
      ...V2,
      migrate: {
        "1": [
          { op: "set" as const, path: "slice.score", value: `plugins.${vecino.id}.points` },
          { op: "set" as const, path: "slice.level", value: 1 },
          { op: "remove" as const, path: "slice.points" },
        ],
      },
    };
    const slice = migratePluginSlice(recordDe(V1, { points: 0 }), lp(target), {
      records: [vecino],
    });
    assert.deepEqual(slice, { score: 9, level: 1 });
  });
});
