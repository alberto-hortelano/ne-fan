import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import {
  activatePluginsForNewSession,
  loadGamePluginManifests,
} from "../src/plugins/loader.js";
import {
  MAX_EMITS_PER_TICK,
  describePluginTickError,
  dispatchPluginEvents,
} from "../src/plugins/dispatcher.js";
import type { PluginManifest } from "../src/plugins/types.js";

const FIXTURE_GAMES = fileURLToPath(new URL("fixtures/games", import.meta.url));

function activeSession(gameId: string): {
  state: NarrativeState;
  manifests: Map<string, PluginManifest>;
  idOf: (name: string) => string;
} {
  const state = new NarrativeState(new MemorySessionStorage());
  state.startNewSession(gameId);
  const loaded = loadGamePluginManifests(FIXTURE_GAMES, gameId);
  const manifests = activatePluginsForNewSession(state, loaded);
  const idOf = (name: string) => {
    const lp = loaded.find((l) => l.manifest.name === name);
    assert.ok(lp, `plugin ${name} no encontrado`);
    return lp.id;
  };
  return { state, manifests, idOf };
}

describe("dispatchPluginEvents", () => {
  it("counter chain: counter_inc updates the counter and the listener hears counter_changed", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("test_counter"), type: "counter_inc", payload: {} },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(state.getPluginRecord(idOf("test_counter"))?.slice, { count: 1 });
    // El listener procesó el counter_changed emitido (nivel 3, mismo tick).
    assert.deepEqual(state.getPluginRecord(idOf("test_listener"))?.slice, {
      last_seen: 1,
      times: 1,
    });
    // Un plugin_applied por aplicación: counter + listener.
    assert.deepEqual(
      result.effects.map((e) => [e.pluginId, e.eventType]),
      [
        [idOf("test_counter"), "counter_inc"],
        [idOf("test_listener"), "counter_changed"],
      ],
    );
    assert.deepEqual(result.effects[0].emitted, [
      { type: "counter_changed", payload: { count: 1 } },
    ]);
    assert.ok(result.effects[0].changedPaths.includes(`plugins.${idOf("test_counter")}.slice`));
  });

  it("an event without `when` match leaves state untouched", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    // counter_changed sin emisor: sólo lo consume el listener; el counter no.
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("test_listener"), type: "counter_changed", payload: { count: 9 } },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(state.getPluginRecord(idOf("test_counter"))?.slice, { count: 0 });
    assert.deepEqual(state.getPluginRecord(idOf("test_listener"))?.slice, {
      last_seen: 9,
      times: 1,
    });
  });

  it("un id desconocido se salta ese evento y NO se lleva por delante el turno", () => {
    // Antes abortaba el tick entero. Un evento sin destino no ha aplicado
    // nada, así que saltárselo no deja estado a medias — y los demás eventos
    // del mismo trigger (que no tienen culpa) siguen su curso. Es el caso que
    // dejó de ser teórico cuando #164 hizo rutinario evolucionar un plugin:
    // migrar le cambia el id al sistema y los map triggers ya escritos quedan
    // apuntando al viejo.
    const { state, manifests, idOf } = activeSession("plugtest");
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: "f".repeat(64), type: "counter_inc", payload: {} },
      { pluginId: idOf("test_counter"), type: "counter_inc", payload: {} },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.undelivered, [
      { pluginId: "f".repeat(64), type: "counter_inc", reason: "unknown_plugin" },
    ]);
    assert.deepEqual(
      state.getPluginRecord(idOf("test_counter"))?.slice,
      { count: 1 },
      "el evento bueno del mismo tick se aplica igual",
    );
  });

  it("un evento dirigido a quien no lo consume tampoco aborta: se descarta y se reporta", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("test_counter"), type: "give_gold", payload: { amount: 5 } },
    ]);
    // El type existe (gold_giver lo consume) pero el plugin direccionado no.
    assert.equal(result.ok, true);
    assert.deepEqual(result.undelivered, [
      { pluginId: idOf("test_counter"), type: "give_gold", reason: "not_consumed" },
    ]);
    assert.equal(state.player.gold ?? 0, 0, "y no se entrega a nadie más por la puerta de atrás");
  });

  it("lo que SÍ aborta el tick es un fallo de evaluación, y nada se commitea", () => {
    // La frontera: entregar vs evaluar. Un DslError a mitad de los efectos sí
    // puede dejar estado a medias, y por eso sigue siendo transaccional.
    const { state, manifests, idOf } = activeSession("plugtest");
    state.player.gold = 10;
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("gold_giver"), type: "give_gold", payload: { amount: "no soy un número" } },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "dsl_error");
    assert.equal(state.player.gold, 10, "el oro no se movió");
  });

  it("external writes land on NarrativeState.player when authorized", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    state.player.gold = 10;
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("gold_giver"), type: "give_gold", payload: { amount: 25 } },
    ]);
    assert.equal(result.ok, true);
    assert.equal(state.player.gold, 35);
    assert.deepEqual(state.getPluginRecord(idOf("gold_giver"))?.slice, { total_given: 25 });
    const fx = result.effects[0];
    assert.ok(fx.changedPaths.includes("player.gold"));
  });

  it("a DSL error (inc over missing payload) aborts transactionally", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    state.player.gold = 10;
    // amount ausente ⇒ inc con operando undefined ⇒ DslError ⇒ abort.
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("gold_giver"), type: "give_gold", payload: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "dsl_error");
    assert.equal(state.player.gold, 10);
    assert.deepEqual(state.getPluginRecord(idOf("gold_giver"))?.slice, { total_given: 0 });
  });

  it("ping/pong cycle hits the emit limit and aborts with a trace, state intact", () => {
    const { state, manifests, idOf } = activeSession("plugcycle");
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("cycle_a"), type: "ping", payload: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "emit_limit_exceeded");
    if (result.error?.code === "emit_limit_exceeded") {
      assert.equal(result.error.limit, MAX_EMITS_PER_TICK);
      assert.ok(result.error.trace.length > MAX_EMITS_PER_TICK);
    }
    assert.deepEqual(state.getPluginRecord(idOf("cycle_a"))?.slice, { n: 0 });
    assert.deepEqual(state.getPluginRecord(idOf("cycle_b"))?.slice, { n: 0 });
  });

  it("no events ⇒ ok with no effects", () => {
    const { state, manifests } = activeSession("plugtest");
    assert.deepEqual(dispatchPluginEvents(state, manifests, []), {
      ok: true,
      effects: [],
      undelivered: [],
    });
  });
});

describe("describePluginTickError: lo que puede acabar delante de quien juega", () => {
  // El detalle técnico (código, id, path del DSL) va al log del bridge, que es
  // donde se depura. Esto es lo otro: la frase que el cliente puede pintar en
  // un overlay a pantalla completa mientras alguien intentaba comprar una
  // daga. Un `{"code":"unknown_plugin","pluginId":"c021b490…"}` ahí no le dice
  // nada a nadie, y es lo que había.
  const nombres = (id: string) => (id === "abc" ? "commerce" : undefined);

  it("nombra el sistema cuando se sabe cuál es, y no enseña ni códigos ni ids", () => {
    const frases = [
      describePluginTickError({ code: "dsl_error", pluginId: "abc", type: "trade_offered", detail: "x" }, nombres),
      describePluginTickError({ code: "write_rejected", pluginId: "abc", path: "player.gold" }, nombres),
      describePluginTickError({ code: "not_consumed", pluginId: "abc", type: "fiar" }, nombres),
    ];
    for (const f of frases) {
      assert.match(f, /commerce/, f);
      assert.doesNotMatch(f, /abc|dsl_error|write_rejected|not_consumed|pluginId|\{/, f);
    }
    assert.match(frases[0], /trade_offered/, "y sí dice qué se estaba resolviendo");
  });

  it("sin nombre resoluble, habla de «un sistema del juego» en vez de soltar el hash", () => {
    const f = describePluginTickError(
      { code: "dsl_error", pluginId: "f".repeat(64), type: "fiar", detail: "boom" },
      () => undefined,
    );
    assert.match(f, /un sistema del juego/);
    assert.doesNotMatch(f, /f{8}/);
  });

  it("cubre los cinco motivos, también sin resolutor de nombres", () => {
    const casos = [
      describePluginTickError({ code: "dsl_error", pluginId: "x", type: "t", detail: "d" }),
      describePluginTickError({ code: "write_rejected", pluginId: "x", path: "player.gold" }),
      describePluginTickError({ code: "emit_limit_exceeded", limit: 16, trace: ["a → b"] }),
      describePluginTickError({ code: "not_consumed", pluginId: "x", type: "t" }),
      describePluginTickError({ code: "unknown_plugin", pluginId: "x" }),
    ];
    for (const f of casos) {
      assert.ok(f.length > 20, f);
      assert.match(f, /\.$/, `una frase, con su punto: ${f}`);
      assert.doesNotMatch(f, /_|\{|\[/, f);
    }
    assert.match(casos[2], /bucle/, "el ciclo de eventos se explica, no se codifica");
  });
});
