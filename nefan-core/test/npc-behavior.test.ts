import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createAmbientNpcBehavior,
  type NpcBehaviorEvent,
  type NpcBehaviorSystem,
  type NpcTickContext,
  type NpcWorldAdapter,
} from "../src/simulation/npc-behavior.js";
import { npcBehaviorRegistry } from "../src/simulation/npc-behavior-registry.js";
import { resolveRoleParams, NPC_ROLE_PRESETS } from "../src/simulation/npc-roles.js";
import { SeededRng } from "../src/rng.js";
import type { EntityRecord } from "../src/narrative/types.js";
import type { Vec3 } from "../src/types.js";

function makeRecord(
  id: string,
  pos: [number, number, number],
  data: Record<string, unknown> = {},
): EntityRecord {
  return {
    id,
    type: "npc",
    scene_id: "tile_0_0",
    spawned_at: "2026-01-01T00:00:00.000Z",
    spawn_reason: "scene_init",
    spawn_event_id: "",
    position: [...pos],
    data,
    asset_refs: [],
  };
}

/** Mundo abierto sin obstáculos; personalizable por test. */
function openWorld(overrides: Partial<NpcWorldAdapter> = {}): NpcWorldAdapter {
  return {
    blocksMove: () => false,
    blocksCircle: () => false,
    resolvePlaceTarget: () => null,
    getEntityPosition: () => null,
    ...overrides,
  };
}

const FAR_PLAYER: Vec3 = { x: 1000, y: 0, z: 1000 };

function ctxWith(overrides: Partial<NpcTickContext> = {}): NpcTickContext {
  return {
    playerPos: FAR_PLAYER,
    combatEvents: [],
    combatantPositions: new Map(),
    ...overrides,
  };
}

function runTicks(
  sys: NpcBehaviorSystem,
  n: number,
  delta: number,
  ctx: NpcTickContext,
): NpcBehaviorEvent[] {
  const events: NpcBehaviorEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...sys.tick(delta, ctx));
  return events;
}

function distXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe("AmbientNpcBehavior", () => {
  it("es determinista: mismo seed → mismas posiciones tras 1000 ticks", () => {
    const build = () => {
      const sys = createAmbientNpcBehavior({ rng: new SeededRng(42), world: openWorld() });
      sys.addNpc(makeRecord("a", [0, 0, 0], { role: "peasant" }));
      sys.addNpc(makeRecord("b", [5, 0, 5], { role: "guard" }));
      return sys;
    };
    const s1 = build();
    const s2 = build();
    for (let i = 0; i < 1000; i++) {
      s1.tick(0.016, ctxWith());
      s2.tick(0.016, ctxWith());
    }
    assert.deepEqual(s1.states(), s2.states());
  });

  it("micro-wander: se mueve pero queda acotado al radio del rol", () => {
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(7), world: openWorld() });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], { role: "peasant" }));
    const home = { x: 0, z: 0 };
    let moved = false;
    let maxDist = 0;
    for (let i = 0; i < 3000; i++) {
      sys.tick(0.016, ctxWith());
      const st = sys.states()[0];
      if (st.moving) moved = true;
      maxDist = Math.max(maxDist, distXZ({ x: st.pos.x, z: st.pos.z }, home));
    }
    assert.ok(moved, "el NPC sin directiva debe pasear");
    const radius = NPC_ROLE_PRESETS.peasant.wander_radius;
    assert.ok(maxDist <= radius + 0.5, `wander fuera de radio: ${maxDist} > ${radius}`);
    assert.ok(maxDist > 0.5, "el NPC no llegó a alejarse de su home");
  });

  it("respeta la colisión del mundo (pared en x=2)", () => {
    const world = openWorld({
      blocksMove: (_fx, _fz, tx) => tx > 2,
      blocksCircle: (x) => x > 2,
    });
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(11), world });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], { role: "villager" }));
    for (let i = 0; i < 3000; i++) {
      sys.tick(0.016, ctxWith());
      assert.ok(sys.states()[0].pos.x <= 2, `atravesó la pared: x=${sys.states()[0].pos.x}`);
    }
  });

  it("react: se para y encara al jugador cercano; vuelve a la rutina al irse", () => {
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(3), world: openWorld() });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], { role: "villager" }));
    const near: Vec3 = { x: 1.5, y: 0, z: 0 };
    runTicks(sys, 60, 0.016, ctxWith({ playerPos: near }));
    let st = sys.states()[0];
    assert.equal(st.mode, "react");
    assert.equal(st.moving, false);
    assert.ok(st.forward.x > 0.9, `debe encarar al jugador: forward=${JSON.stringify(st.forward)}`);
    // El jugador se va lejos → el NPC retoma su rutina.
    runTicks(sys, 600, 0.016, ctxWith());
    st = sys.states()[0];
    assert.notEqual(st.mode, "react");
  });

  it("flee: el campesino huye de una pelea y luego retoma la rutina", () => {
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(5), world: openWorld() });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], { role: "peasant" }));
    const hotspot: Vec3 = { x: 3, y: 0, z: 0 };
    const fightCtx = ctxWith({
      combatEvents: [{ type: "attack_started", combatantId: "bandit" }],
      combatantPositions: new Map([["bandit", hotspot]]),
    });
    const events = runTicks(sys, 100, 0.016, fightCtx);
    assert.equal(events.filter((e) => e.type === "npc_fled_combat").length, 1);
    const st = sys.states()[0];
    assert.equal(st.mode, "flee");
    assert.ok(st.run, "huir debe ser corriendo");
    assert.ok(
      distXZ({ x: st.pos.x, z: st.pos.z }, hotspot) > 3,
      "debe haberse alejado del foco de la pelea",
    );
    // Pelea terminada: 4+ s sin eventos → npc_resumed.
    const after = runTicks(sys, 300, 0.016, ctxWith());
    assert.equal(after.filter((e) => e.type === "npc_resumed").length, 1);
    assert.notEqual(sys.states()[0].mode, "flee");
  });

  it("intervene: el guardia corre a la pelea, se planta y amenaza con quick", () => {
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(9), world: openWorld() });
    sys.addNpc(makeRecord("guard1", [10, 0, 0], { role: "guard" }));
    const hotspot: Vec3 = { x: 0, y: 0, z: 0 };
    const fightCtx = ctxWith({
      combatEvents: [{ type: "attack_landed", attackerId: "bandit" }],
      combatantPositions: new Map([["bandit", hotspot]]),
    });
    const events: NpcBehaviorEvent[] = [];
    let sawThreat = false;
    for (let i = 0; i < 250; i++) {
      events.push(...sys.tick(0.016, fightCtx));
      if (sys.states()[0].anim === "quick") sawThreat = true;
    }
    assert.equal(events.filter((e) => e.type === "npc_intervened").length, 1);
    const st = sys.states()[0];
    assert.equal(st.mode, "intervene");
    const dist = distXZ({ x: st.pos.x, z: st.pos.z }, hotspot);
    assert.ok(dist < 3, `debe plantarse cerca del hostil, dist=${dist}`);
    assert.ok(dist > 1, `no debe pisar al hostil, dist=${dist}`);
    assert.ok(sawThreat, "debe amenazar con anim quick");
    assert.ok(st.forward.x < -0.9, "debe encarar al hostil");
  });

  it("goto_place: camina hasta el place anclado y emite npc_reached_place", () => {
    const world = openWorld({
      resolvePlaceTarget: (id) => (id === "plaza" ? { x: 10, z: 0 } : null),
    });
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(13), world });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], {
      role: "villager",
      directive: { type: "goto_place", target_place_id: "plaza" },
    }));
    const events = runTicks(sys, 400, 0.05, ctxWith());
    const reached = events.filter((e) => e.type === "npc_reached_place");
    assert.equal(reached.length, 1);
    assert.equal(reached[0].placeId, "plaza");
    const st = sys.states()[0];
    assert.ok(distXZ({ x: st.pos.x, z: st.pos.z }, { x: 10, z: 0 }) <= 2);
    // Llegado: se queda (la directiva sigue vigente, no re-camina ni re-emite).
    const after = runTicks(sys, 200, 0.05, ctxWith());
    assert.equal(after.filter((e) => e.type === "npc_reached_place").length, 0);
  });

  it("in_transit (npc_move_to_place) también camina sin directiva explícita", () => {
    const world = openWorld({
      resolvePlaceTarget: (id) => (id === "forja" ? { x: -8, z: 4 } : null),
    });
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(17), world });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], {
      role: "villager",
      in_transit: { to: "forja", from: "", departed_at: "2026-01-01T00:00:00.000Z" },
    }));
    const events = runTicks(sys, 400, 0.05, ctxWith());
    const reached = events.filter((e) => e.type === "npc_reached_place");
    assert.equal(reached.length, 1);
    assert.equal(reached[0].placeId, "forja");
  });

  it("goto_place lejano o sin anchor queda narrative-paced (sigue la rutina)", () => {
    const world = openWorld({
      resolvePlaceTarget: (id) => (id === "capital" ? { x: 500, z: 0 } : null),
    });
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(19), world });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], {
      role: "villager",
      directive: { type: "goto_place", target_place_id: "capital" },
    }));
    const events = runTicks(sys, 1000, 0.016, ctxWith());
    assert.equal(events.filter((e) => e.type === "npc_reached_place").length, 0);
    const st = sys.states()[0];
    assert.ok(Math.abs(st.pos.x) < 20, "no debe emprender un viaje de 500 m");
  });

  it("visit_npc: camina hasta la entidad y emite npc_reached_npc", () => {
    const world = openWorld({
      getEntityPosition: (id) => (id === "herrero" ? { x: 6, y: 0, z: 0 } : null),
    });
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(23), world });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], {
      role: "villager",
      directive: { type: "visit_npc", target_npc_id: "herrero" },
    }));
    const events = runTicks(sys, 300, 0.05, ctxWith());
    const reached = events.filter((e) => e.type === "npc_reached_npc");
    assert.equal(reached.length, 1);
    assert.equal(reached[0].targetId, "herrero");
    const st = sys.states()[0];
    assert.ok(distXZ({ x: st.pos.x, z: st.pos.z }, { x: 6, z: 0 }) <= 2.5);
    assert.equal(st.moving, false);
  });

  it("hold: no se mueve nunca", () => {
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(29), world: openWorld() });
    sys.addNpc(makeRecord("npc1", [1, 0, 1], { role: "villager", directive: { type: "hold" } }));
    runTicks(sys, 2000, 0.016, ctxWith());
    const st = sys.states()[0];
    assert.equal(st.pos.x, 1);
    assert.equal(st.pos.z, 1);
    assert.equal(st.moving, false);
  });

  it("directiva desconocida: warning sin throw y degrada a micro-wander", () => {
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(31), world: openWorld() });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], {
      role: "villager",
      directive: { type: "danza_macabra" },
    }));
    let moved = false;
    for (let i = 0; i < 2000; i++) {
      sys.tick(0.016, ctxWith());
      if (sys.states()[0].moving) moved = true;
    }
    assert.ok(moved, "con verbo desconocido debe seguir paseando");
  });

  it("cambiar la directiva en runtime redirige al NPC", () => {
    const world = openWorld({
      resolvePlaceTarget: (id) => (id === "plaza" ? { x: 10, z: 0 } : null),
    });
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(37), world });
    const record = makeRecord("npc1", [0, 0, 0], { role: "villager", directive: { type: "hold" } });
    sys.addNpc(record);
    runTicks(sys, 100, 0.05, ctxWith());
    assert.equal(sys.states()[0].moving, false);
    record.data.directive = { type: "goto_place", target_place_id: "plaza" };
    const events = runTicks(sys, 400, 0.05, ctxWith());
    assert.equal(events.filter((e) => e.type === "npc_reached_place").length, 1);
  });

  it("addNpc dos veces con el mismo id conserva el runtime y adopta el record nuevo", () => {
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(41), world: openWorld() });
    const rec1 = makeRecord("npc1", [0, 0, 0], { role: "villager" });
    sys.addNpc(rec1);
    runTicks(sys, 500, 0.016, ctxWith());
    const before = sys.states()[0].pos;
    const rec2 = makeRecord("npc1", [before.x, before.y, before.z], { role: "villager" });
    sys.addNpc(rec2);
    const after = sys.states()[0].pos;
    assert.deepEqual(after, before);
    assert.equal(sys.ids().length, 1);
  });
});

describe("npcBehaviorRegistry", () => {
  const deps = { rng: new SeededRng(1), world: openWorld() };

  it("id ausente → default ambient", () => {
    assert.equal(npcBehaviorRegistry.create(undefined, deps).id, "ambient");
    assert.equal(npcBehaviorRegistry.create("", deps).id, "ambient");
  });

  it("id desconocido → fail-loud con la lista", () => {
    assert.throws(
      () => npcBehaviorRegistry.create("nope", deps),
      /unknown npc_behavior system "nope".*ambient/,
    );
  });
});

describe("resolveRoleParams", () => {
  it("aplica el preset del rol y los overrides de behavior", () => {
    const params = resolveRoleParams({
      role: "guard",
      behavior: { wander_radius: 9, flees_from_combat: true },
    });
    assert.equal(params.role, "guard");
    assert.equal(params.wander_radius, 9);
    assert.equal(params.flees_from_combat, true);
    assert.equal(params.intervenes_in_combat, true);
    assert.equal(params.run_speed, NPC_ROLE_PRESETS.guard.run_speed);
  });

  it("rol desconocido degrada a villager conservando el nombre", () => {
    const params = resolveRoleParams({ role: "nigromante" });
    assert.equal(params.role, "nigromante");
    assert.equal(params.wander_radius, NPC_ROLE_PRESETS.villager.wander_radius);
  });

  it("override inválido se ignora con warning", () => {
    const params = resolveRoleParams({ role: "peasant", behavior: { walk_speed: "rápido" } });
    assert.equal(params.walk_speed, NPC_ROLE_PRESETS.peasant.walk_speed);
  });
});
