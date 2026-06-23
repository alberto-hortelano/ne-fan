/** F7 (next.md §7.3 "Evolución") — migración de plugins en resume: cuando el
 *  manifest del FS sube de versión, el slice del save se convierte con la
 *  cadena `migrate` en vez de abortar el resume. */
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
import { runMigrationStep } from "../src/plugins/dsl/evaluate.js";
import { DslError } from "../src/plugins/dsl/errors.js";
import { validateManifestStatic } from "../src/plugins/validate.js";
import { computePluginId } from "../src/plugins/hash.js";
import { PluginManifestSchema } from "../src/plugins/types.js";

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

