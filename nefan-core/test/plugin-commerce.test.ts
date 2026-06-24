/** F8 (next.md §7.7) — el plugin commerce v1 SHIPPED de tavern_intro, end-to-end
 *  sin WS: carga real desde data/games/tavern_intro/plugins, génesis, market_open
 *  en runtime, trade_offered → trade_completed, persistencia en save/resume. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import {
  loadGamePluginManifests,
  activatePluginsForNewSession,
  bindPluginsForResume,
} from "../src/plugins/loader.js";
import { dispatchPluginEvents } from "../src/plugins/dispatcher.js";

const GAMES_DIR = fileURLToPath(new URL("../data/games", import.meta.url));

function loadCommerce() {
  const loaded = loadGamePluginManifests(GAMES_DIR, "tavern_intro");
  const commerce = loaded.find((l) => l.manifest.name === "commerce");
  assert.ok(commerce, "commerce.json debe cargar (zod + estática + fixtures OK)");
  return { loaded, id: commerce!.id };
}

describe("commerce plugin shipped (F8)", () => {
  it("carga del FS, valida shape/estática/fixtures y siembra mercados vacíos en génesis", () => {
    const { loaded, id } = loadCommerce();
    const state = new NarrativeState(new MemorySessionStorage());
    state.startNewSession("tavern_intro");
    const active = activatePluginsForNewSession(state, loaded);
    assert.ok(active.has(id));
    // tavern_intro no tiene mercaderes al inicio ⇒ mercados vacíos (no error).
    assert.deepEqual(state.getPluginRecord(id)?.slice, { markets: {} });
  });

  it("market_open registra un mercado en runtime y aparece en serializeForLlm", () => {
    const { loaded, id } = loadCommerce();
    const state = new NarrativeState(new MemorySessionStorage());
    state.startNewSession("tavern_intro");
    const active = activatePluginsForNewSession(state, loaded);

    const tick = dispatchPluginEvents(state, active, [
      {
        pluginId: id,
        type: "market_open",
        payload: { market_id: "blacksmith_01", name: "Herrería de Boris", stock: { iron_sword: 2, shield: 1 } },
      },
    ]);
    assert.equal(tick.ok, true, tick.error);

    const slice = state.getPluginRecord(id)?.slice as { markets: Record<string, { stock: Record<string, number> }> };
    assert.deepEqual(slice.markets.blacksmith_01.stock, { iron_sword: 2, shield: 1 });

    // El motor narrativo lo ve vía la derived_view active_markets (F6).
    const ctx = state.serializeForLlm(active);
    const view = ctx.plugins?.find((p) => p.id === id)?.views.active_markets as Array<Record<string, unknown>>;
    assert.deepEqual(view, [{ id: "blacksmith_01", name: "Herrería de Boris", items: 2 }]);
  });

  it("trade_offered descuenta stock+oro, añade al inventario y emite trade_completed", () => {
    const { loaded, id } = loadCommerce();
    const state = new NarrativeState(new MemorySessionStorage());
    state.startNewSession("tavern_intro");
    const active = activatePluginsForNewSession(state, loaded);
    state.player.gold = 100;

    dispatchPluginEvents(state, active, [
      { pluginId: id, type: "market_open", payload: { market_id: "blacksmith_01", name: "Herrería", stock: { iron_sword: 2 } } },
    ]);

    const tick = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "trade_offered", payload: { market_id: "blacksmith_01", item_id: "iron_sword", price: 50 } },
    ]);
    assert.equal(tick.ok, true, tick.error);

    assert.equal(state.player.gold, 50);
    assert.deepEqual(state.player.inventory, [{ id: "iron_sword", from: "blacksmith_01" }]);
    const slice = state.getPluginRecord(id)?.slice as { markets: Record<string, { stock: Record<string, number> }> };
    assert.equal(slice.markets.blacksmith_01.stock.iron_sword, 1);

    const emitted = tick.effects.flatMap((e) => e.emitted ?? []);
    assert.ok(emitted.some((ev) => ev.type === "trade_completed"), "debe emitir trade_completed");
  });

  it("trade_offered con oro insuficiente o mercado inexistente es no-op (when falso)", () => {
    const { loaded, id } = loadCommerce();
    const state = new NarrativeState(new MemorySessionStorage());
    state.startNewSession("tavern_intro");
    const active = activatePluginsForNewSession(state, loaded);
    state.player.gold = 10;
    dispatchPluginEvents(state, active, [
      { pluginId: id, type: "market_open", payload: { market_id: "blacksmith_01", name: "Herrería", stock: { iron_sword: 1 } } },
    ]);

    // oro insuficiente
    const poor = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "trade_offered", payload: { market_id: "blacksmith_01", item_id: "iron_sword", price: 50 } },
    ]);
    assert.equal(poor.ok, true);
    assert.equal(state.player.gold, 10);
    assert.deepEqual(state.player.inventory, []);

    // mercado inexistente
    const ghost = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "trade_offered", payload: { market_id: "nope", item_id: "x", price: 1 } },
    ]);
    assert.equal(ghost.ok, true);
    assert.equal(state.player.gold, 10);
  });

  it("el mercado y la compra sobreviven save → resume (rebind por id desde el FS)", async () => {
    const storage = new MemorySessionStorage();
    const { loaded, id } = loadCommerce();
    const s1 = new NarrativeState(storage);
    s1.startNewSession("tavern_intro");
    const active1 = activatePluginsForNewSession(s1, loaded);
    s1.player.gold = 100;
    dispatchPluginEvents(s1, active1, [
      { pluginId: id, type: "market_open", payload: { market_id: "blacksmith_01", name: "Herrería", stock: { iron_sword: 3 } } },
    ]);
    dispatchPluginEvents(s1, active1, [
      { pluginId: id, type: "trade_offered", payload: { market_id: "blacksmith_01", item_id: "iron_sword", price: 30 } },
    ]);
    await s1.save();

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(s1.session_id), true);
    const active2 = bindPluginsForResume(s2, loadGamePluginManifests(GAMES_DIR, "tavern_intro"));
    assert.ok(active2.has(id), "el plugin shipped se rebindea por id desde el FS");
    const slice = s2.getPluginRecord(id)?.slice as { markets: Record<string, { stock: Record<string, number> }> };
    assert.equal(slice.markets.blacksmith_01.stock.iron_sword, 2);

    // segunda compra tras el resume: continúa desde el estado guardado
    const tick = dispatchPluginEvents(s2, active2, [
      { pluginId: id, type: "trade_offered", payload: { market_id: "blacksmith_01", item_id: "iron_sword", price: 30 } },
    ]);
    assert.equal(tick.ok, true, tick.error);
    assert.equal(s2.player.gold, 40);
    const slice2 = s2.getPluginRecord(id)?.slice as { markets: Record<string, { stock: Record<string, number> }> };
    assert.equal(slice2.markets.blacksmith_01.stock.iron_sword, 1);
  });
});
