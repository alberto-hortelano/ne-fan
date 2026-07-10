/** Plugin economy shipped — movimientos de oro del jugador y deudas, end-to-end
 *  sin WS: carga real desde data/games/{id}/plugins, grant/pago/robo con clamp,
 *  ciclo de deuda completo, ring buffer del ledger, vistas para el LLM,
 *  payloads defectuosos, coexistencia con commerce y save/resume. */
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

interface LedgerLine {
  seq: number;
  kind: string;
  amount: number;
  with: string | null;
  note: string | null;
}
interface EconomySlice {
  debts: Record<string, { debt_id: string; debtor: string; creditor: string | null; amount: number; reason: string | null }>;
  ledger: LedgerLine[];
  ledger_seq: number;
}

function makeSession(gameId = "toledo_1200") {
  const loaded = loadGamePluginManifests(GAMES_DIR, gameId);
  const economy = loaded.find((l) => l.manifest.name === "economy");
  assert.ok(economy, `economy.json debe cargar en ${gameId} (zod + estática + fixtures OK)`);
  const state = new NarrativeState(new MemorySessionStorage());
  state.startNewSession(gameId);
  const active = activatePluginsForNewSession(state, loaded);
  return { state, active, id: economy!.id, loaded };
}

function economySlice(state: NarrativeState, id: string): EconomySlice {
  return state.getPluginRecord(id)?.slice as unknown as EconomySlice;
}

function emittedTypes(tick: ReturnType<typeof dispatchPluginEvents>): string[] {
  return tick.effects.flatMap((e) => e.emitted ?? []).map((ev) => ev.type);
}

describe("economy plugin shipped", () => {
  it("carga y activa en los tres juegos base con slice inicial vacío", () => {
    for (const gameId of ["toledo_1200", "alta_fantasia", "cuentos_oscuros"]) {
      const { state, id } = makeSession(gameId);
      assert.deepEqual(
        economySlice(state, id),
        { debts: {}, ledger: [], ledger_seq: 0 },
        `slice inicial en ${gameId}`,
      );
    }
  });

  it("gold_granted suma oro y apunta en el ledger", () => {
    const { state, active, id } = makeSession();
    const tick = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "gold_granted", payload: { amount: 10, from: "yuannes", reason: "encargo" } },
    ]);
    assert.equal(tick.ok, true, JSON.stringify(tick.error));
    assert.equal(state.player.gold, 10);
    assert.deepEqual(economySlice(state, id).ledger, [
      { seq: 1, kind: "grant", amount: 10, with: "yuannes", note: "encargo" },
    ]);
  });

  it("payment_offered con fondos descuenta oro y emite payment_completed", () => {
    const { state, active, id } = makeSession();
    state.player.gold = 10;
    const tick = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "payment_offered", payload: { amount: 6, to: "yishaq" } },
    ]);
    assert.equal(tick.ok, true, JSON.stringify(tick.error));
    assert.equal(state.player.gold, 4);
    const completed = tick.effects.flatMap((e) => e.emitted ?? []).find((ev) => ev.type === "payment_completed");
    assert.ok(completed, "debe emitir payment_completed");
    assert.equal((completed!.payload as { gold_remaining: number }).gold_remaining, 4);
    assert.equal(economySlice(state, id).ledger[0].kind, "payment");
  });

  it("payment_offered sin fondos es no-op sobre el oro y emite payment_rejected (no completed)", () => {
    const { state, active, id } = makeSession();
    state.player.gold = 3;
    const tick = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "payment_offered", payload: { amount: 6, to: "yishaq" } },
    ]);
    assert.equal(tick.ok, true, JSON.stringify(tick.error));
    assert.equal(state.player.gold, 3);
    const types = emittedTypes(tick);
    assert.ok(types.includes("payment_rejected"));
    // Cubre el orden de entries: la de éxito no debe correr tras el rechazo.
    assert.ok(!types.includes("payment_completed"));
    assert.equal(economySlice(state, id).ledger[0].kind, "payment_rejected");
  });

  it("gold_stolen clampa a 0 y gold_lost informa de lo realmente perdido", () => {
    const { state, active, id } = makeSession();
    state.player.gold = 3;
    const tick = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "gold_stolen", payload: { amount: 5, by: "ladron" } },
    ]);
    assert.equal(tick.ok, true, JSON.stringify(tick.error));
    assert.equal(state.player.gold, 0);
    const lost = tick.effects.flatMap((e) => e.emitted ?? []).find((ev) => ev.type === "gold_lost");
    assert.equal((lost!.payload as { amount: number }).amount, 3);
    assert.equal(economySlice(state, id).ledger[0].amount, 3);
  });

  it("ciclo de deuda: crear → abono parcial → rechazo sin fondos → saldar con sobrepago capeado", () => {
    const { state, active, id } = makeSession();
    state.player.gold = 5;

    const created = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "debt_created", payload: { debt_id: "yishaq_deuda", amount: 6, creditor: "yishaq", reason: "préstamo" } },
    ]);
    assert.equal(created.ok, true, JSON.stringify(created.error));
    assert.equal(economySlice(state, id).debts.yishaq_deuda.amount, 6);
    // Un segundo debt_created con el mismo id NO resetea el importe.
    dispatchPluginEvents(state, active, [
      { pluginId: id, type: "debt_created", payload: { debt_id: "yishaq_deuda", amount: 100, creditor: "yishaq" } },
    ]);
    assert.equal(economySlice(state, id).debts.yishaq_deuda.amount, 6);

    // Abono parcial: 4 de 6 con oro 5.
    const partial = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "debt_payment_offered", payload: { debt_id: "yishaq_deuda", amount: 4 } },
    ]);
    assert.equal(partial.ok, true, JSON.stringify(partial.error));
    assert.equal(state.player.gold, 1);
    assert.equal(economySlice(state, id).debts.yishaq_deuda.amount, 2);
    const partialCompleted = partial.effects.flatMap((e) => e.emitted ?? []).find((ev) => ev.type === "payment_completed");
    assert.equal((partialCompleted!.payload as { debt_remaining: number }).debt_remaining, 2);
    assert.ok(!emittedTypes(partial).includes("debt_settled"));

    // Sin fondos: quedan 2 de deuda y 1 de oro.
    const broke = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "debt_payment_offered", payload: { debt_id: "yishaq_deuda", amount: 2 } },
    ]);
    assert.equal(state.player.gold, 1);
    assert.equal(economySlice(state, id).debts.yishaq_deuda.amount, 2);
    assert.ok(emittedTypes(broke).includes("payment_rejected"));

    // Cobra 5 y salda ofreciendo 10: solo se descuentan los 2 restantes.
    dispatchPluginEvents(state, active, [
      { pluginId: id, type: "gold_granted", payload: { amount: 5, from: "yuannes" } },
    ]);
    const settle = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "debt_payment_offered", payload: { debt_id: "yishaq_deuda", amount: 10 } },
    ]);
    assert.equal(settle.ok, true, JSON.stringify(settle.error));
    assert.equal(state.player.gold, 4);
    assert.deepEqual(economySlice(state, id).debts, {});
    assert.ok(emittedTypes(settle).includes("debt_settled"));
    const kinds = economySlice(state, id).ledger.map((l) => l.kind);
    assert.ok(kinds.includes("debt_payment") && kinds.includes("debt_settled"));
  });

  it("debt_forgiven condona sin tocar el oro", () => {
    const { state, active, id } = makeSession();
    state.player.gold = 7;
    dispatchPluginEvents(state, active, [
      { pluginId: id, type: "debt_created", payload: { debt_id: "d1", amount: 6, creditor: "yishaq" } },
    ]);
    const tick = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "debt_forgiven", payload: { debt_id: "d1", reason: "trato secreto" } },
    ]);
    assert.equal(tick.ok, true, JSON.stringify(tick.error));
    assert.equal(state.player.gold, 7);
    assert.deepEqual(economySlice(state, id).debts, {});
    const last = economySlice(state, id).ledger.at(-1)!;
    assert.equal(last.kind, "debt_forgiven");
    assert.equal(last.amount, 6);
  });

  it("el ledger es un ring buffer de 8: diez grants conservan seq 3..10", () => {
    const { state, active, id } = makeSession();
    for (let i = 1; i <= 10; i++) {
      dispatchPluginEvents(state, active, [
        { pluginId: id, type: "gold_granted", payload: { amount: i } },
      ]);
    }
    const slice = economySlice(state, id);
    assert.equal(slice.ledger_seq, 10);
    assert.equal(slice.ledger.length, 8);
    assert.equal(slice.ledger[0].seq, 3);
    assert.equal(slice.ledger.at(-1)!.seq, 10);
    assert.equal(state.player.gold, 55);
  });

  it("el motor narrativo ve wallet, open_debts y recent_ledger en serializeForLlm", () => {
    const { state, active, id } = makeSession();
    state.player.gold = 20;
    dispatchPluginEvents(state, active, [
      { pluginId: id, type: "debt_created", payload: { debt_id: "d1", amount: 6, creditor: "yishaq", reason: "préstamo" } },
    ]);
    const ctx = state.serializeForLlm(active);
    const views = ctx.plugins?.find((p) => p.id === id)?.views as Record<string, unknown>;
    // wallet lee player.gold (path externo declarado en reads).
    assert.deepEqual(views.wallet, { gold: 20, open_debts: 1 });
    assert.deepEqual(views.open_debts, [
      { id: "d1", debtor: "player", creditor: "yishaq", amount: 6, reason: "préstamo" },
    ]);
    assert.equal((views.recent_ledger as LedgerLine[]).length, 1);
  });

  it("payload sin amount es no-op limpio; amount string es dsl_error transaccional", () => {
    const { state, active, id } = makeSession();
    state.player.gold = 9;

    const empty = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "gold_granted", payload: {} },
    ]);
    assert.equal(empty.ok, true);
    assert.equal(state.player.gold, 9);
    assert.deepEqual(economySlice(state, id).ledger, []);

    const bad = dispatchPluginEvents(state, active, [
      { pluginId: id, type: "gold_granted", payload: { amount: "6" } },
    ]);
    assert.equal(bad.ok, false);
    assert.equal(bad.error?.code, "dsl_error");
    // Transaccional: nada se commiteó.
    assert.equal(state.player.gold, 9);
    assert.deepEqual(economySlice(state, id).ledger, []);
  });

  it("coexiste con commerce en un mismo tick sin cruzar slices", () => {
    const { state, active, loaded } = makeSession();
    const economyId = loaded.find((l) => l.manifest.name === "economy")!.id;
    const commerceId = loaded.find((l) => l.manifest.name === "commerce")!.id;
    state.player.gold = 100;

    dispatchPluginEvents(state, active, [
      { pluginId: commerceId, type: "market_open", payload: { market_id: "m1", name: "Herrería", stock: { iron_sword: 1 } } },
    ]);
    const tick = dispatchPluginEvents(state, active, [
      { pluginId: commerceId, type: "trade_offered", payload: { market_id: "m1", item_id: "iron_sword", price: 50 } },
      { pluginId: economyId, type: "gold_granted", payload: { amount: 10, from: "yuannes" } },
    ]);
    assert.equal(tick.ok, true, JSON.stringify(tick.error));
    assert.equal(state.player.gold, 60);
    assert.deepEqual(state.player.inventory, [{ id: "iron_sword", from: "m1" }]);
    // El slice de commerce no sabe nada del grant, ni el de economy de la compra.
    const commerceSlice = state.getPluginRecord(commerceId)?.slice as { markets: Record<string, unknown> };
    assert.ok(commerceSlice.markets.m1);
    const kinds = economySlice(state, economyId).ledger.map((l) => l.kind);
    assert.deepEqual(kinds, ["grant"]);
  });

  it("deudas y ledger sobreviven save → resume y se puede seguir pagando", async () => {
    const storage = new MemorySessionStorage();
    const loaded = loadGamePluginManifests(GAMES_DIR, "toledo_1200");
    const id = loaded.find((l) => l.manifest.name === "economy")!.id;
    const s1 = new NarrativeState(storage);
    s1.startNewSession("toledo_1200");
    const active1 = activatePluginsForNewSession(s1, loaded);
    dispatchPluginEvents(s1, active1, [
      { pluginId: id, type: "gold_granted", payload: { amount: 10, from: "yuannes" } },
    ]);
    dispatchPluginEvents(s1, active1, [
      { pluginId: id, type: "debt_created", payload: { debt_id: "d1", amount: 6, creditor: "yishaq" } },
    ]);
    await s1.save();

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(s1.session_id), true);
    const active2 = bindPluginsForResume(s2, loadGamePluginManifests(GAMES_DIR, "toledo_1200"));
    assert.ok(active2.has(id), "economy se rebindea por id desde el FS");
    assert.equal(economySlice(s2, id).debts.d1.amount, 6);
    assert.equal(economySlice(s2, id).ledger.length, 2);

    const tick = dispatchPluginEvents(s2, active2, [
      { pluginId: id, type: "debt_payment_offered", payload: { debt_id: "d1", amount: 6 } },
    ]);
    assert.equal(tick.ok, true, JSON.stringify(tick.error));
    assert.equal(s2.player.gold, 4);
    assert.deepEqual(economySlice(s2, id).debts, {});
  });
});
