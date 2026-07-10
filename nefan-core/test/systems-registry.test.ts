import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createSystemRegistry } from "../src/systems/registry.js";

interface FakeSystem {
  name: string;
  deps: number;
}

const registry = createSystemRegistry<FakeSystem, number>("fake", "alpha", {
  alpha: (deps) => ({ name: "alpha", deps }),
  beta: (deps) => ({ name: "beta", deps }),
});

describe("createSystemRegistry", () => {
  it("resolves the default when the id is absent or empty", () => {
    assert.equal(registry.create(undefined, 1).name, "alpha");
    assert.equal(registry.create("", 1).name, "alpha");
  });

  it("resolves an explicit id and passes deps through", () => {
    const impl = registry.create("beta", 7);
    assert.equal(impl.name, "beta");
    assert.equal(impl.deps, 7);
  });

  it("throws on an unknown id, listing the available ones", () => {
    assert.throws(
      () => registry.create("gamma", 1),
      /unknown fake system "gamma".*alpha, beta/,
    );
  });

  it("exposes ids() and has()", () => {
    assert.deepEqual(registry.ids(), ["alpha", "beta"]);
    assert.ok(registry.has("alpha"));
    assert.ok(!registry.has("gamma"));
  });

  it("rejects a defaultId that is not a registered factory", () => {
    assert.throws(
      () => createSystemRegistry<FakeSystem, number>("fake", "missing", {
        alpha: (deps) => ({ name: "alpha", deps }),
      }),
      /default "missing"/,
    );
  });
});
