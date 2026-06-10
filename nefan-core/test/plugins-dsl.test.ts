import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PluginManifestSchema, type Effect, type Predicate } from "../src/plugins/types.js";
import { DslError } from "../src/plugins/dsl/errors.js";
import { deepEqual } from "../src/plugins/dsl/deep-equal.js";
import {
  concretizeWritePath,
  parsePath,
  resolveRead,
  type DslScope,
} from "../src/plugins/dsl/paths.js";
import { evalValue } from "../src/plugins/dsl/values.js";
import { evalPredicate } from "../src/plugins/dsl/predicates.js";
import { applyEffect, newEffectSink, type WriteAuth } from "../src/plugins/dsl/effects.js";
import {
  manifestAuth,
  replayFixture,
  runDerivedView,
  runEventEntry,
  runProjections,
  type DslContext,
} from "../src/plugins/dsl/evaluate.js";
import { validateManifestStatic } from "../src/plugins/validate.js";
import { COMMERCE_MANIFEST } from "./fixtures/commerce-manifest.js";

const commerce = () => PluginManifestSchema.parse(COMMERCE_MANIFEST);

function makeScope(): DslScope {
  return {
    event: { type: "trade_offered", market_id: "blacksmith_01", item_id: "iron_sword", price: 50 },
    slice: { markets: { blacksmith_01: { stock: { iron_sword: 2 } } }, count: 1 },
    player: { gold: 100, inventory: [{ id: "torch" }] },
    entities: [
      { id: "blacksmith_01", data: { role: "merchant", name: "Boris", inventory: { iron_sword: 2 } } },
      { id: "guard_01", data: { role: "guard" } },
    ],
  };
}

describe("DSL paths", () => {
  it("resolves nested keys and indices", () => {
    const s = makeScope();
    assert.equal(resolveRead(s, parsePath("player.gold")), 100);
    assert.equal(resolveRead(s, parsePath("entities[1].data.role")), "guard");
    assert.equal(resolveRead(s, parsePath("player.inventory[0].id")), "torch");
  });

  it("resolves [*] over arrays and objects", () => {
    const s = makeScope();
    assert.deepEqual(resolveRead(s, parsePath("entities[*].data.role")), ["merchant", "guard"]);
    // [*] sobre objeto = Object.values (slice.markets[*] de §7.7)
    assert.deepEqual(resolveRead(s, parsePath("slice.markets[*]")), [
      { stock: { iron_sword: 2 } },
    ]);
  });

  it("resolves interpolation against the scope", () => {
    const s = makeScope();
    assert.equal(
      resolveRead(s, parsePath("slice.markets.{event.market_id}.stock.{event.item_id}")),
      2,
    );
  });

  it("missing paths read as undefined (lax)", () => {
    const s = makeScope();
    assert.equal(resolveRead(s, parsePath("player.mana")), undefined);
    assert.equal(resolveRead(s, parsePath("world.name")), undefined);
  });

  it("rejects unknown roots at parse time", () => {
    assert.throws(() => parsePath("playr.gold"), DslError);
  });

  it("rejects [*] in write paths and unresolvable interpolation", () => {
    const s = makeScope();
    assert.throws(() => concretizeWritePath(s, parsePath("entities[*].data")), DslError);
    assert.throws(
      () => concretizeWritePath(s, parsePath("slice.markets.{event.missing}")),
      DslError,
    );
  });
});

describe("DSL predicates", () => {
  const s = makeScope();

  it("evaluates every comparison op", () => {
    const cases: Array<[Predicate, boolean]> = [
      [{ op: "eq", path: "event.item_id", value: "'iron_sword'" }, true],
      [{ op: "neq", path: "event.item_id", value: "'torch'" }, true],
      [{ op: "gt", path: "player.gold", value: 50 }, true],
      [{ op: "gte", path: "player.gold", value: 100 }, true],
      [{ op: "lt", path: "player.gold", value: 100 }, false],
      [{ op: "lte", path: "player.gold", value: 100 }, true],
      [{ op: "has", path: "event.market_id" }, true],
      [{ op: "has", path: "event.nope" }, false],
      [{ op: "in", path: "event.item_id", value: { $lit: ["iron_sword", "axe"] } }, true],
      [{ op: "matches", path: "event.item_id", value: "'^iron'" }, true],
    ];
    for (const [p, expected] of cases) {
      assert.equal(evalPredicate(s, p), expected, JSON.stringify(p));
    }
  });

  it("compares against a path value (gte player.gold vs event.price)", () => {
    assert.equal(evalPredicate(s, { op: "gte", path: "player.gold", value: "event.price" }), true);
  });

  it("combines all/any/not with short-circuit", () => {
    const p: Predicate = {
      all: [
        { op: "has", path: "event.market_id" },
        { any: [{ op: "eq", path: "player.gold", value: 0 }, { not: { op: "lt", path: "player.gold", value: 50 } }] },
      ],
    };
    assert.equal(evalPredicate(s, p), true);
  });

  it("throws on numeric comparison of non-numbers", () => {
    assert.throws(() => evalPredicate(s, { op: "gt", path: "event.item_id", value: 3 }), DslError);
  });

  it("numeric comparison of a missing path is false, not an error", () => {
    assert.equal(evalPredicate(s, { op: "gt", path: "player.mana", value: 3 }), false);
  });
});

describe("DSL values", () => {
  const s = makeScope();

  it("path-vs-literal rule", () => {
    assert.equal(evalValue(s, "merchant"), "merchant"); // raíz inválida ⇒ literal
    assert.equal(evalValue(s, "event.price"), 50); // path
    assert.equal(evalValue(s, "'event.price'"), "event.price"); // quoted ⇒ literal
    assert.equal(evalValue(s, "hello world"), "hello world"); // no parsea ⇒ literal
  });

  it("$lit escapes arbitrary JSON and clones it", () => {
    const v = evalValue(s, { $lit: { map: "not-an-op" } }) as Record<string, unknown>;
    assert.deepEqual(v, { map: "not-an-op" });
  });

  it("arithmetic with precedence and parens", () => {
    assert.equal(evalValue(s, "2+3*4"), 14);
    assert.equal(evalValue(s, "(2+3)*4"), 20);
    assert.equal(evalValue(s, "player.gold / 4 - 5"), 20);
    assert.equal(evalValue(s, "-event.price + 1"), -49);
  });

  it("division by zero and non-numeric arithmetic fail loud", () => {
    assert.throws(() => evalValue(s, "1/0"), DslError);
    assert.throws(() => evalValue(s, "event.item_id + 1"), DslError);
  });

  it("builtin calls", () => {
    assert.equal(evalValue(s, "min(3, 1, 2)"), 1);
    assert.equal(evalValue(s, "max(3, 1, 2)"), 3);
    assert.equal(evalValue(s, "clamp(15, 0, 10)"), 10);
    assert.equal(evalValue(s, "len(player.inventory)"), 1);
    assert.equal(evalValue(s, "len(slice.markets.blacksmith_01.stock)"), 1);
    assert.equal(evalValue(s, "len('abc')"), 3);
    assert.equal(evalValue(s, "concat('a', 'b')"), "ab");
    assert.equal(evalValue(s, "coalesce(player.mana, 7)"), 7);
  });

  it("object and array templates evaluate recursively", () => {
    assert.deepEqual(evalValue(s, { id: "event.item_id", from: "event.market_id" }), {
      id: "iron_sword",
      from: "blacksmith_01",
    });
    assert.deepEqual(evalValue(s, ["event.price", 2]), [50, 2]);
  });

  it("map/filter/reduce over path sources", () => {
    assert.deepEqual(evalValue(s, { map: "entities", to: "_.data.role" }), ["merchant", "guard"]);
    const merchants = evalValue(s, {
      filter: "entities",
      where: { op: "eq", path: "_.data.role", value: "'merchant'" },
    }) as unknown[];
    assert.equal(merchants.length, 1);
    assert.equal(evalValue(s, { reduce: "player.inventory", init: 0, with: "acc + 1" }), 1);
  });

  it("iteration source must be an array", () => {
    assert.throws(() => evalValue(s, { map: "player.gold", to: "_" }), DslError);
  });

  it("nesting cap throws", () => {
    const nested = {
      map: "entities",
      to: { map: "entities", to: { map: "entities", to: { map: "entities", to: 1 } } },
    };
    assert.throws(() => evalValue(s, nested), DslError);
  });

  it("random is deterministic per seed value and respects bounds", () => {
    const a = evalValue(s, "random(player.gold, 1, 6)") as number;
    const b = evalValue(s, "random(player.gold, 1, 6)") as number;
    assert.equal(a, b);
    assert.ok(Number.isInteger(a) && a >= 1 && a <= 6);
    const c = evalValue({ ...s, player: { gold: 999 } }, "random(player.gold, 1, 6)") as number;
    // Otro seed puede coincidir por azar en un rango de 6; comprobamos con un rango amplio.
    const wide1 = evalValue(s, "random(player.gold, 0, 1000000)") as number;
    const wide2 = evalValue({ ...s, player: { gold: 999 } }, "random(player.gold, 0, 1000000)") as number;
    assert.notEqual(wide1, wide2);
    assert.ok(c >= 1 && c <= 6);
  });

  it("random requires a path seed", () => {
    assert.throws(() => evalValue(s, "random('static', 1, 6)"), DslError);
  });
});

describe("DSL effects", () => {
  const auth: WriteAuth = {
    writes: [parsePath("player.gold"), parsePath("player.inventory")],
    eventsProduced: new Set(["ping"]),
  };

  function apply(scope: DslScope, effects: Effect[], a: WriteAuth = auth) {
    const sink = newEffectSink();
    for (const e of effects) applyEffect(scope, e, a, sink);
    return sink;
  }

  it("set creates intermediate objects", () => {
    const s = makeScope();
    apply(s, [{ op: "set", path: "slice.deep.nested.value", value: 7 }]);
    assert.equal(resolveRead(s, parsePath("slice.deep.nested.value")), 7);
  });

  it("inc/dec/mul over numbers; inc over undefined fails loud", () => {
    const s = makeScope();
    apply(s, [
      { op: "inc", path: "slice.count", value: 2 },
      { op: "mul", path: "slice.count", value: 10 },
      { op: "dec", path: "slice.count", value: "event.price" },
    ]);
    assert.equal(resolveRead(s, parsePath("slice.count")), (1 + 2) * 10 - 50);
    assert.throws(() => apply(s, [{ op: "inc", path: "slice.missing", value: 1 }]), DslError);
  });

  it("push/pull/remove", () => {
    const s = makeScope();
    apply(s, [{ op: "push", path: "player.inventory", value: { $lit: { id: "axe" } } }]);
    assert.equal((resolveRead(s, parsePath("player.inventory")) as unknown[]).length, 2);
    apply(s, [{ op: "pull", path: "player.inventory", value: { $lit: { id: "torch" } } }]);
    assert.deepEqual(resolveRead(s, parsePath("player.inventory")), [{ id: "axe" }]);
    apply(s, [{ op: "remove", path: "slice.markets.blacksmith_01" }]);
    assert.deepEqual(resolveRead(s, parsePath("slice.markets")), {});
  });

  it("sequential semantics: effect N+1 sees effect N's writes", () => {
    const s = makeScope();
    const sink = apply(s, [
      { op: "inc", path: "slice.count", value: 1 },
      { op: "emit_event", value: { type: "ping", payload: { n: "slice.count" } } },
    ]);
    assert.deepEqual(sink.emittedEvents, [{ type: "ping", payload: { n: 2 } }]);
  });

  it("emit_event outside events_produced fails loud", () => {
    const s = makeScope();
    assert.throws(
      () => apply(s, [{ op: "emit_event", value: { type: "intruso", payload: null } }]),
      DslError,
    );
  });

  it("external writes require declaration in writes", () => {
    const s = makeScope();
    assert.throws(() => apply(s, [{ op: "set", path: "world.name", value: "'x'" }]), DslError);
    const sink = apply(s, [{ op: "dec", path: "player.gold", value: 30 }]);
    assert.deepEqual([...sink.externalPaths.keys()], ["player.gold"]);
  });
});

describe("runEventEntry", () => {
  const manifest = commerce;

  function ctx(): DslContext {
    const s = makeScope();
    return {
      event: s.event as Record<string, unknown>,
      slice: s.slice,
      player: s.player,
      entities: s.entities as unknown[],
    };
  }

  it("when=false returns matched:false with the slice untouched", () => {
    const m = manifest();
    const c = ctx();
    (c.player as { gold: number }).gold = 10; // < price
    const out = runEventEntry(m.events_consumed[0], c, manifestAuth(m));
    assert.equal(out.matched, false);
    assert.deepEqual(out.slice, c.slice);
    assert.deepEqual(out.externalWrites, []);
    assert.deepEqual(out.emittedEvents, []);
  });

  it("is pure: the input context is not mutated", () => {
    const m = manifest();
    const c = ctx();
    const snapshot = structuredClone(c);
    runEventEntry(m.events_consumed[0], c, manifestAuth(m));
    assert.deepEqual(c, snapshot);
  });

  it("commerce entry: stock-1, gold-50, inventory+1, trade_completed", () => {
    const m = manifest();
    const out = runEventEntry(m.events_consumed[0], ctx(), manifestAuth(m));
    assert.equal(out.matched, true);
    assert.equal(
      resolveRead({ slice: out.slice }, parsePath("slice.markets.blacksmith_01.stock.iron_sword")),
      1,
    );
    const gold = out.externalWrites.find((w) => w.path === "player.gold");
    assert.equal(gold?.value, 50);
    const inv = out.externalWrites.find((w) => w.path === "player.inventory");
    assert.ok(
      Array.isArray(inv?.value) &&
        (inv?.value as unknown[]).some((x) => deepEqual(x, { id: "iron_sword", from: "blacksmith_01" })),
    );
    assert.deepEqual(out.emittedEvents, [
      {
        type: "trade_completed",
        payload: { market_id: "blacksmith_01", item_id: "iron_sword", price: 50 },
      },
    ]);
  });
});

describe("runProjections / runDerivedView", () => {
  it("commerce projection builds markets from merchant entities only", () => {
    const m = commerce();
    const s = makeScope();
    const slice = runProjections(m, {
      player: s.player,
      entities: s.entities as unknown[],
    }) as Record<string, unknown>;
    const markets = slice.markets as Record<string, unknown>;
    assert.deepEqual(Object.keys(markets), ["blacksmith_01"]);
    assert.deepEqual(markets.blacksmith_01, {
      owner_id: "blacksmith_01",
      name: "Boris",
      stock: { iron_sword: 2 },
      prices: {},
    });
    assert.deepEqual(slice.loans, []);
  });

  it("active_markets derived view from §7.7", () => {
    const m = commerce();
    const view = m.derived_views[0];
    const result = runDerivedView(view, {
      slice: { markets: { blacksmith_01: { owner_id: "blacksmith_01", name: "Boris", stock: { iron_sword: 1, axe: 1 } } } },
    });
    assert.deepEqual(result, [{ id: "blacksmith_01", name: "Boris", items: 2 }]);
  });
});

describe("replayFixture", () => {
  it("the commerce fixture from §7.7 replays ok", () => {
    const m = commerce();
    const r = replayFixture(m, m.fixtures[0]);
    assert.equal(r.error, undefined);
    assert.equal(r.ok, true);
  });

  it("a mutated `after` fails with expected/actual", () => {
    const m = commerce();
    const broken = structuredClone(m.fixtures[0]);
    (broken.after as { markets: { blacksmith_01: { stock: { iron_sword: number } } } }).markets
      .blacksmith_01.stock.iron_sword = 2;
    const r = replayFixture(m, broken);
    assert.equal(r.ok, false);
    assert.ok(r.error);
  });

  it("insufficient gold: when=false, slice unchanged, fixture passes with after===before", () => {
    const m = commerce();
    const f = structuredClone(m.fixtures[0]);
    f.context = { player: { gold: 10, inventory: [] } };
    f.after = structuredClone(f.before);
    const r = replayFixture(m, f);
    assert.equal(r.ok, true);
  });
});

describe("validateManifestStatic", () => {
  it("accepts the commerce manifest", () => {
    assert.deepEqual(validateManifestStatic(commerce()), []);
  });

  it("flags external writes not covered by `writes`", () => {
    const m = commerce();
    m.writes = ["player.inventory"]; // quita player.gold
    const errors = validateManifestStatic(m);
    assert.ok(errors.some((e) => e.includes("player.gold")));
  });

  it("flags reads of undeclared roots and unknown emit types", () => {
    const m = commerce();
    m.reads = []; // pierde player/entities
    m.events_produced = ["loan_defaulted"]; // pierde trade_completed
    const errors = validateManifestStatic(m);
    assert.ok(errors.some((e) => e.includes("'player' no está cubierto")));
    assert.ok(errors.some((e) => e.includes("trade_completed")));
  });
});
