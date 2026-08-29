import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createAmbientNpcBehavior,
  FLEE_EXTRA_DIST,
  type NpcBehaviorEvent,
  type NpcBehaviorSystem,
  type NpcTickContext,
  type NpcWorldAdapter,
} from "../src/simulation/npc-behavior.js";
import { npcBehaviorRegistry } from "../src/simulation/npc-behavior-registry.js";
import {
  resolveRoleParams,
  AMBIENT_ROLES,
  NPC_ROLES,
  NPC_ROLE_PRESETS,
  isHostileRole,
} from "../src/simulation/npc-roles.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
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
    let st = sys.states()[0];
    assert.equal(st.mode, "flee");
    assert.ok(st.run, "huir debe ser corriendo");

    // LLEGA a su meta, que es la que declara el sim — no un número a mano.
    // El aserto anterior era `> 3 m` a 1,6 s de huida: habría pasado igual con
    // el tope puesto en 4 m, así que no protegía el comportamiento (#262).
    //
    // Se mide el INSTANTE de llegada, no la distancia a una hora fija: alcanzada
    // la meta el NPC para, reanuda a los 4 s y el micro-wander lo trae de vuelta
    // hacia la pelea (#298), así que una foto tardía lo pilla ya de regreso y
    // lee menos de lo que llegó a alejarse.
    const { run_speed, perception_radius } = NPC_ROLE_PRESETS.peasant;
    const meta = perception_radius + FLEE_EXTRA_DIST;
    // Cota derivada y generosa: el tiempo de recorrer la meta ENTERA a la
    // velocidad de correr, más dos segundos. Arranca a 3 m, así que le sobra.
    const topeS = meta / run_speed + 2;
    let llegadaS: number | null = null;
    for (let i = 100; i * 0.016 <= topeS && llegadaS === null; i++) {
      sys.tick(0.016, fightCtx);
      const p = sys.states()[0].pos;
      if (distXZ({ x: p.x, z: p.z }, hotspot) >= meta) llegadaS = i * 0.016;
    }
    st = sys.states()[0];
    assert.ok(
      llegadaS !== null,
      `debe alcanzar su meta de huida (${meta} m) en menos de ${topeS.toFixed(1)} s; ` +
        `se quedó a ${distXZ({ x: st.pos.x, z: st.pos.z }, hotspot).toFixed(2)} m`,
    );
    // Pelea terminada: 4+ s sin eventos → npc_resumed.
    const after = runTicks(sys, 300, 0.016, ctxWith());
    assert.equal(after.filter((e) => e.type === "npc_resumed").length, 1);
    assert.notEqual(sys.states()[0].mode, "flee");
  });

  /** El caso en negativo del aserto de arriba, y la forma EXACTA de #262: un
   *  NPC que no puede moverse de su celda «huye» sin desplazarse, y durante
   *  semanas eso se leyó como que la huida estaba rota. Reproducido midiendo el
   *  sim con la colisión real: 0,72 m en 60 s, vibrando ±2 cm. Si este test se
   *  pone verde, el de arriba ha dejado de comprobar nada. */
  it("flee: un NPC que no puede moverse NO alcanza su meta — el aserto sabe ponerse rojo", () => {
    const sys = createAmbientNpcBehavior({
      rng: new SeededRng(5),
      world: openWorld({ blocksMove: () => true, blocksCircle: () => true }),
    });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], { role: "peasant" }));
    const hotspot: Vec3 = { x: 3, y: 0, z: 0 };
    const fightCtx = ctxWith({
      combatEvents: [{ type: "attack_started", combatantId: "bandit" }],
      combatantPositions: new Map([["bandit", hotspot]]),
    });
    const meta = NPC_ROLE_PRESETS.peasant.perception_radius + FLEE_EXTRA_DIST;

    // 60 s simulados: casi trece veces lo que necesita en campo abierto (4,7 s).
    let llegadaS: number | null = null;
    for (let i = 1; i <= 3750 && llegadaS === null; i++) {
      sys.tick(0.016, fightCtx);
      const p = sys.states()[0].pos;
      if (distXZ({ x: p.x, z: p.z }, hotspot) >= meta) llegadaS = i * 0.016;
    }
    const st = sys.states()[0];
    assert.equal(llegadaS, null, "encerrado NO puede alcanzar la meta: el test positivo miente");
    assert.equal(st.mode, "flee", "sigue queriendo huir: lo que falla es el desplazamiento");
    const recorrido = distXZ({ x: st.pos.x, z: st.pos.z }, { x: 0, z: 0 });
    assert.ok(recorrido < 1, `encerrado, no debe avanzar; avanzó ${recorrido.toFixed(2)} m`);
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

  it("retirar in_transit cancela el goto: NO sigue al destino stale, vuelve a micro-wander", () => {
    // Regresión: el waypoint del goto (in_transit) se reutilizaba al retirar
    // in_transit porque el goal key solo miraba data.directive → el NPC seguía
    // caminando hasta 128 m al destino ya cancelado. Ahora el goal key cubre
    // in_transit y el waypoint se resetea.
    const world = openWorld({
      resolvePlaceTarget: (id) => (id === "forja" ? { x: 40, z: 0 } : null),
    });
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(23), world });
    const rec = makeRecord("npc1", [0, 0, 0], {
      role: "villager",
      in_transit: { to: "forja", from: "", departed_at: "2026-01-01T00:00:00.000Z" },
    });
    sys.addNpc(rec);
    // Arranca el goto hacia forja (waypoint = [40,0,0]).
    runTicks(sys, 40, 0.05, ctxWith());
    const midX = sys.states()[0].pos.x;
    assert.ok(midX > 0.5, `debería haberse movido hacia forja (x=${midX})`);
    // El bridge retira in_transit (viaje cancelado) sin tocar la directiva.
    delete (rec.data as Record<string, unknown>).in_transit;
    const events = runTicks(sys, 600, 0.05, ctxWith());
    assert.equal(
      events.filter((e) => e.type === "npc_reached_place").length,
      0,
      "no debe llegar a un place tras cancelar el tránsito",
    );
    const st = sys.states()[0];
    const homeDist = distXZ({ x: st.pos.x, z: st.pos.z }, { x: 0, z: 0 });
    const forjaDist = distXZ({ x: st.pos.x, z: st.pos.z }, { x: 40, z: 0 });
    assert.ok(homeDist <= NPC_ROLE_PRESETS.villager.wander_radius + 2, `debe micro-wander cerca de casa, no seguir al destino stale (homeDist=${homeDist.toFixed(1)})`);
    assert.ok(forjaDist > 25, `no debe acercarse a la forja cancelada (forjaDist=${forjaDist.toFixed(1)})`);
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

  it("watchdog de atasco: encajonado sin avance neto → se rinde a idle", () => {
    // Bolsillo de radio 0.1 m: dentro se puede mover (nunca bloqueo total),
    // pero el waypoint de wander queda siempre fuera → sin watchdog el NPC
    // vibraría en wander para siempre.
    const world = openWorld({
      blocksMove: (_fx, _fz, tx, tz) => Math.hypot(tx, tz) > 0.1,
    });
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(19), world });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], { role: "peasant" }));
    let sawIdleAfterMoving = false;
    let moved = false;
    for (let i = 0; i < 700; i++) {
      sys.tick(0.016, ctxWith());
      const st = sys.states()[0];
      if (st.moving) moved = true;
      if (moved && st.mode === "idle") sawIdleAfterMoving = true;
    }
    assert.ok(moved, "debe intentar moverse dentro del bolsillo");
    assert.ok(sawIdleAfterMoving, "el watchdog debe rendirse a idle (antes: wander eterno)");
    const st = sys.states()[0];
    assert.ok(Math.hypot(st.pos.x, st.pos.z) <= 0.11, "sigue dentro del bolsillo");
  });

  it("forward con slew: girar 180° hacia el jugador es gradual, no un salto", () => {
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(23), world: openWorld() });
    sys.addNpc(makeRecord("npc1", [0, 0, 0], { role: "villager" }));
    // Encara al jugador al este.
    runTicks(sys, 120, 0.016, ctxWith({ playerPos: { x: 1.5, y: 0, z: 0 } }));
    assert.ok(sys.states()[0].forward.x > 0.9, "encarado al este");
    // El jugador salta al oeste: un solo tick NO puede voltear el facing…
    sys.tick(0.016, ctxWith({ playerPos: { x: -1.5, y: 0, z: 0 } }));
    assert.ok(sys.states()[0].forward.x > 0.8, "sin salto instantáneo de 180°");
    // …pero en ~1 s de ticks el giro completa.
    runTicks(sys, 60, 0.016, ctxWith({ playerPos: { x: -1.5, y: 0, z: 0 } }));
    assert.ok(sys.states()[0].forward.x < -0.9, "giro completado gradualmente");
  });

  it("esquina de muro: sin vibración de facing tick a tick y el paseo se rinde", () => {
    // Pared al este (x>2) + techo al norte (z>0.3): la deflexión ±90° de un
    // rumbo que rota se bloquea en ambos extremos. Antes: facing alternando
    // 180° cada tick (vibración) o paseo eterno junto al muro. Ahora: el
    // slew acota el giro por tick y el watchdog rinde el paseo a idle.
    const world = openWorld({
      blocksMove: (_fx, _fz, tx, tz) => tx > 2 || tz > 0.3,
      blocksCircle: (x, z) => x > 2 || z > 0.3,
      resolvePlaceTarget: (id) => (id === "plaza" ? { x: 10, z: 0 } : null),
    });
    const sys = createAmbientNpcBehavior({ rng: new SeededRng(29), world });
    sys.addNpc(makeRecord("npc1", [1.9, 0, 0.25], {
      role: "villager",
      directive: { type: "goto_place", target_place_id: "plaza" },
    }));
    let rapidFlips = 0;
    let sawIdle = false;
    let prevZ: number | null = null;
    for (let i = 0; i < 500; i++) {
      sys.tick(0.016, ctxWith());
      const st = sys.states()[0];
      if (st.mode === "idle") sawIdle = true;
      if (!st.moving) {
        prevZ = null;
        continue;
      }
      const z = st.forward.z;
      if (prevZ !== null && Math.abs(z) > 0.5 && Math.abs(prevZ) > 0.5 && Math.sign(z) !== Math.sign(prevZ)) {
        rapidFlips += 1;
      }
      prevZ = z;
    }
    assert.equal(rapidFlips, 0, `facing volteado 180° entre ticks consecutivos (${rapidFlips} veces)`);
    assert.ok(sawIdle, "el watchdog debe rendir el paseo junto al muro a idle");
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

/** El criterio de #173, extremo a extremo dentro del core: un guardia
 *  DECLARADO en la escena se comporta como guardia. Antes el `role` no cruzaba
 *  el contrato, así que este camino existía entero y no lo recorría nadie:
 *  todo NPC de escena resolvía el preset `villager` (deambula 6 m, huye de las
 *  peleas) y un guardia declarado ni se quedaba en su puesto ni percibía el
 *  combate. Lo que se ejercita es la cadena real —Format D → EntityRecord.data
 *  → preset—, no `resolveRoleParams` a solas. */
describe("el rol declarado en la escena llega hasta el preset de conducta", () => {
  function tileCon(npc: Record<string, unknown>): Record<string, unknown> {
    return {
      scene_id: "tile_0_0",
      scene_description: "una escena",
      tile: { tx: 0, ty: 0 },
      biome: "grass",
      entities: [
        { id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1], glyph: "@" },
        { kind: "npc", cell: [60, 60], footprint: [1, 1], glyph: "n", ...npc },
      ],
    };
  }

  function recordDe(npc: Record<string, unknown>): EntityRecord {
    const state = new NarrativeState(new MemorySessionStorage());
    state.startNewSession("plugtest");
    // Expandido como lo entrega el bridge (biome + primitivas → grid 128×128).
    state.recordSceneLoaded("tile_0_0", expandScenePrimitives(tileCon(npc)));
    const rec = state.entities.find((e) => e.id === npc.id);
    assert.ok(rec, `el NPC ${String(npc.id)} no quedó registrado`);
    return rec;
  }

  it("un guardia declarado se planta y entra a la pelea", () => {
    const rec = recordDe({ id: "roric", name: "Guardia Roric", role: "guard",
      description: "guardia con lanza y capa parda" });
    assert.equal(rec.data.role, "guard", "el rol tiene que llegar a EntityRecord.data");
    assert.equal(rec.data.description, "guardia con lanza y capa parda",
      "y con él la descripción, que es el prompt del skin");

    const params = resolveRoleParams(rec.data);
    assert.equal(params.role, "guard");
    assert.equal(params.intervenes_in_combat, true, "un guardia interviene");
    assert.equal(params.flees_from_combat, false, "y no huye");
    assert.equal(params.perception_radius, NPC_ROLE_PRESETS.guard.perception_radius);
  });

  it("sin rol declarado, el mismo NPC es el aldeano de siempre", () => {
    const rec = recordDe({ id: "anon", name: "Aldeano" });
    assert.ok(!("role" in rec.data), "sin rol no se inventa uno");

    const params = resolveRoleParams(rec.data);
    assert.equal(params.role, "villager");
    assert.equal(params.flees_from_combat, true);
    assert.equal(params.intervenes_in_combat, false);
  });

  it("cada rol AMBIENTAL resuelve SU preset, no el de al lado", () => {
    for (const role of AMBIENT_ROLES) {
      const params = resolveRoleParams(recordDe({ id: `npc_${role}`, name: "X", role }).data);
      assert.deepEqual(params, NPC_ROLE_PRESETS[role], `el rol ${role} no resolvió su preset`);
    }
  });

  // La partición del vocabulario es la que hace inexpresable el doble dueño
  // de la posición: un hostil lo mueve la IA de combate del sim, y el sistema
  // ambiental mutaría `record.position` en paralelo. `NPC_ROLE_PRESETS` es
  // `Record<AmbientRole, …>` justo para que escribir aquí una entrada
  // `hostile` no COMPILE; esto comprueba la otra mitad, la que sí es de
  // ejecución: que la partición cubre el vocabulario entero y que ningún rol
  // cae en los dos lados.
  it("el vocabulario se parte en ambientales y hostiles, sin solapes ni huecos", () => {
    assert.deepEqual(
      [...NPC_ROLES].sort(),
      [...AMBIENT_ROLES, "hostile"].sort(),
      "NPC_ROLES ya no es la unión de las dos particiones",
    );
    for (const role of AMBIENT_ROLES) {
      assert.equal(isHostileRole(role), false, `el rol ambiental ${role} se declara hostil`);
      assert.ok(NPC_ROLE_PRESETS[role], `el rol ambiental ${role} no tiene preset`);
    }
    assert.equal(isHostileRole("hostile"), true);
    assert.equal(
      (NPC_ROLE_PRESETS as Record<string, unknown>).hostile,
      undefined,
      "un hostil NO puede tener preset ambiental: sería el segundo dueño de su posición",
    );
  });

  it("isHostileRole no se cree un rol inventado ni un no-string", () => {
    for (const x of ["Hostile", "hostil", "enemy", "bandido", "", undefined, null, 1, {}]) {
      assert.equal(isHostileRole(x), false, `isHostileRole(${JSON.stringify(x)})`);
    }
  });
});
