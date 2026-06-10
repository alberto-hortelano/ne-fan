import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PluginManifestSchema } from "../src/plugins/types.js";
import { canonicalJson, computePluginId } from "../src/plugins/hash.js";
import { COMMERCE_MANIFEST } from "./fixtures/commerce-manifest.js";

describe("PluginManifestSchema", () => {
  it("accepts the commerce manifest from next.md §7.7", () => {
    const parsed = PluginManifestSchema.parse(COMMERCE_MANIFEST);
    assert.equal(parsed.name, "Sistema de comercio");
    assert.equal(parsed.version, 1);
    assert.equal(parsed.events_consumed.length, 1);
    assert.equal(parsed.events_consumed[0].do.length, 4);
    assert.deepEqual(parsed.writes, ["player.gold", "player.inventory"]);
    assert.equal(parsed.fixtures.length, 1);
  });

  it("applies defaults for omitted optional arrays", () => {
    const minimal = PluginManifestSchema.parse({
      version: 1,
      name: "mini",
      description: "x",
      origin: { author: "developer", rationale: "test" },
      slice: { schema: {}, initial: {} },
    });
    assert.deepEqual(minimal.reads, []);
    assert.deepEqual(minimal.writes, []);
    assert.deepEqual(minimal.events_consumed, []);
    assert.deepEqual(minimal.projections, []);
    assert.deepEqual(minimal.fixtures, []);
  });

  it("rejects invalid manifests", () => {
    const base = {
      version: 1,
      name: "x",
      description: "x",
      origin: { author: "developer", rationale: "r" },
      slice: { schema: {}, initial: {} },
    };
    // origin.author fuera del enum
    assert.throws(() =>
      PluginManifestSchema.parse({ ...base, origin: { author: "hacker", rationale: "r" } }),
    );
    // events_consumed entry sin `do`
    assert.throws(() =>
      PluginManifestSchema.parse({
        ...base,
        events_consumed: [{ type: "x" }],
      }),
    );
    // version no entera
    assert.throws(() => PluginManifestSchema.parse({ ...base, version: 1.5 }));
    // clave desconocida (strict, fail-loud ante typos)
    assert.throws(() => PluginManifestSchema.parse({ ...base, eventos_consumidos: [] }));
    // slice.initial ausente
    assert.throws(() =>
      PluginManifestSchema.parse({ ...base, slice: { schema: {} } }),
    );
    // id con formato no sha256
    assert.throws(() => PluginManifestSchema.parse({ ...base, id: "abc" }));
  });
});

describe("canonicalJson", () => {
  it("is independent of key order and recursive", () => {
    const a = { b: 1, a: { d: [1, 2], c: "x" } };
    const b = { a: { c: "x", d: [1, 2] }, b: 1 };
    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(canonicalJson(a), '{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it("preserves array order", () => {
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });

  it("normalizes numbers and skips undefined values", () => {
    assert.equal(canonicalJson({ x: 1.0 }), canonicalJson({ x: 1 }));
    assert.equal(canonicalJson({ x: 1, y: undefined }), '{"x":1}');
  });

  it("throws on non-finite numbers", () => {
    assert.throws(() => canonicalJson({ x: NaN }));
    assert.throws(() => canonicalJson({ x: Infinity }));
  });
});

describe("computePluginId", () => {
  const manifest = () => PluginManifestSchema.parse(COMMERCE_MANIFEST);

  it("produces a 64-char hex id, stable across key order", () => {
    const id = computePluginId(manifest());
    assert.match(id, /^[0-9a-f]{64}$/);
    // Mismo manifest re-parseado ⇒ mismo id
    assert.equal(computePluginId(manifest()), id);
  });

  it("ignores origin (§7.5: génesis distinta, misma identidad)", () => {
    const m1 = manifest();
    const m2 = {
      ...manifest(),
      origin: { author: "developer" as const, rationale: "adoptado del runtime" },
    };
    assert.equal(computePluginId(m1), computePluginId(m2));
  });

  it("ignores a present id field", () => {
    const m1 = manifest();
    const withId = { ...manifest(), id: computePluginId(m1) };
    assert.equal(computePluginId(withId), computePluginId(m1));
  });

  it("changes when behaviour-relevant fields change", () => {
    const m1 = manifest();
    const m2 = { ...manifest(), description: "otra cosa" };
    assert.notEqual(computePluginId(m1), computePluginId(m2));
  });

  it("treats omitted and empty optional arrays the same (normalized hash)", () => {
    const base = {
      version: 1,
      name: "mini",
      description: "x",
      origin: { author: "developer" as const, rationale: "r" },
      slice: { schema: {}, initial: {} },
    };
    const omitted = PluginManifestSchema.parse(base);
    const explicit = PluginManifestSchema.parse({ ...base, projections: [], reads: [] });
    assert.equal(computePluginId(omitted), computePluginId(explicit));
  });
});
