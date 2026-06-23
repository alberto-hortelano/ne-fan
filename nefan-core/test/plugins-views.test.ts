/** F6 (next.md §7.6) — proyección de plugins al contexto del motor narrativo:
 *  buildPluginLlmViews (resumen vía derived_views), inspectPlugin (detalle bajo
 *  demanda) y el cableado en NarrativeState.serializeForLlm. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import {
  PluginManifestSchema,
  type PluginManifest,
  type PluginRecord,
} from "../src/plugins/types.js";
import {
  buildPluginLlmViews,
  inspectPlugin,
  type PluginViewSources,
} from "../src/plugins/views.js";
import { COMMERCE_MANIFEST } from "./fixtures/commerce-manifest.js";

const commerce = (): PluginManifest => PluginManifestSchema.parse(COMMERCE_MANIFEST);

/** Slice de comercio con dos mercados poblados (forma que producen las
 *  projections del manifest). */
function commerceSlice() {
  return {
    markets: {
      blacksmith_01: {
        owner_id: "blacksmith_01",
        name: "Herrería de Boris",
        stock: { iron_sword: 2, shield: 1 },
        prices: {},
      },
      alchemist_02: {
        owner_id: "alchemist_02",
        name: "Boticario",
        stock: { potion: 5 },
        prices: {},
      },
    },
    loans: [],
  };
}

function record(manifest: PluginManifest, slice: unknown, embed = false): PluginRecord {
  return {
    id: manifest.id ?? "a".repeat(64),
    name: manifest.name,
    version: manifest.version,
    slice,
    origin: manifest.origin,
    activated_at: "2026-06-23T00:00:00.000Z",
    ...(embed ? { manifest } : {}),
  };
}

function sources(plugins: PluginRecord[]): PluginViewSources {
  return { plugins, world: {}, player: { gold: 100 }, entities: [] };
}

describe("plugin views (F6)", () => {
  it("buildPluginLlmViews evalúa derived_views, no vuelca el slice", () => {
    const m = commerce();
    const rec = record(m, commerceSlice());
    const map = new Map<string, PluginManifest>([[rec.id, m]]);

    const views = buildPluginLlmViews(sources([rec]), map);
    assert.equal(views.length, 1);
    const v = views[0];
    assert.equal(v.id, rec.id);
    assert.equal(v.name, m.name);
    assert.equal(v.version, 1);

    // active_markets: map slice.markets[*] → {id, name, items: len(stock)}
    const markets = v.views.active_markets as Array<Record<string, unknown>>;
    assert.deepEqual(
      [...markets].sort((a, b) => String(a.id).localeCompare(String(b.id))),
      [
        { id: "alchemist_02", name: "Boticario", items: 1 },
        { id: "blacksmith_01", name: "Herrería de Boris", items: 2 },
      ],
    );
    // No se filtra el slice entero en el resumen.
    assert.ok(!("slice" in v));
  });

  it("resuelve el manifest del Map (shipped) o del record embebido (IA)", () => {
    const m = commerce();
    // Shipped: sin manifest en el record, sólo en el Map.
    const shipped = record(m, commerceSlice());
    const viaMap = buildPluginLlmViews(sources([shipped]), new Map([[shipped.id, m]]));
    assert.ok((viaMap[0].views.active_markets as unknown[]).length === 2);

    // Sin Map y sin manifest embebido ⇒ no hay con qué evaluar las vistas.
    const blind = buildPluginLlmViews(sources([shipped]), undefined);
    assert.deepEqual(blind[0].views, {});

    // IA: manifest embebido en el record ⇒ se resuelve aun sin Map.
    const ai = record(m, commerceSlice(), true);
    const viaEmbed = buildPluginLlmViews(sources([ai]), undefined);
    assert.ok((viaEmbed[0].views.active_markets as unknown[]).length === 2);
  });

  it("una derived_view que lanza en runtime no tumba el contexto (_error)", () => {
    const m = commerce();
    // markets es un número ⇒ map sobre no-array lanza DslError.
    const rec = record(m, { markets: 5, loans: [] });
    const views = buildPluginLlmViews(sources([rec]), new Map([[rec.id, m]]));
    const err = views[0].views.active_markets as Record<string, unknown>;
    assert.ok(typeof err._error === "string" && err._error.length > 0);
  });

  it("inspectPlugin: con view devuelve result; sin view, el slice completo", () => {
    const m = commerce();
    const rec = record(m, commerceSlice());
    const map = new Map<string, PluginManifest>([[rec.id, m]]);
    const src = sources([rec]);

    const withView = inspectPlugin(src, map, rec.id, "active_markets");
    assert.equal(withView.view, "active_markets");
    assert.equal((withView.result as unknown[]).length, 2);
    assert.deepEqual(withView.available_views, ["active_markets"]);
    assert.equal(withView.slice, undefined);

    const noView = inspectPlugin(src, map, rec.id);
    assert.equal(noView.view, undefined);
    assert.deepEqual(noView.slice, commerceSlice());
    assert.deepEqual(noView.available_views, ["active_markets"]);
  });

  it("inspectPlugin: plugin o vista inexistentes lanzan con motivo", () => {
    const m = commerce();
    const rec = record(m, commerceSlice());
    const src = sources([rec]);
    const map = new Map<string, PluginManifest>([[rec.id, m]]);

    assert.throws(() => inspectPlugin(src, map, "deadbeef"), /desconocido/);
    assert.throws(
      () => inspectPlugin(src, map, rec.id, "no_existe"),
      /no tiene derived_view 'no_existe'/,
    );
  });

  it("NarrativeState.serializeForLlm inyecta el bloque plugins sólo si los hay", () => {
    const state = new NarrativeState(new MemorySessionStorage());
    state.startNewSession("plugtest");

    // Sin plugins: no aparece la clave.
    assert.equal(state.serializeForLlm().plugins, undefined);

    // Con un plugin activo (manifest embebido, sin Map): aparece el resumen.
    const m = commerce();
    state.addPlugin(record(m, commerceSlice(), true));
    const ctx = state.serializeForLlm();
    assert.ok(Array.isArray(ctx.plugins));
    assert.equal(ctx.plugins!.length, 1);
    assert.equal((ctx.plugins![0].views.active_markets as unknown[]).length, 2);
  });
});
