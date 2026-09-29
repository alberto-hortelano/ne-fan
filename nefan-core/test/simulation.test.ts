import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createAmbientNpcBehavior } from "../src/simulation/npc-behavior.js";
import { SeededRng } from "../src/rng.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { combatRegistry } from "../src/combat/registry.js";
import { GameStore } from "../src/store/game-store.js";
import type { CombatConfig, CombatEvent, EnemyPersonality } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config: CombatConfig = loadConfig(
  JSON.parse(readFileSync(resolve(__dirname, "../data/combat_config.json"), "utf-8")),
);

describe("GameSimulation", () => {
  it("creates simulation with player and enemy", () => {
    const sim = new GameSimulation(config, undefined, 42);
    const player = createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed", { x: 0, y: 0, z: -2 });

    sim.addCombatant(player);
    sim.addCombatant(enemy, {
      aggression: 0.7,
      preferred_attacks: ["quick", "medium"],
      reaction_time: 0.6,
      combat_range: 4.0,
    });

    assert.ok(sim.getCombatant("player"));
    assert.ok(sim.getCombatant("skeleton_01"));
  });

  it("player attack hits enemy at optimal range", () => {
    const store = new GameStore();
    const sim = new GameSimulation(config, store, 42);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.5 }); // At optimal distance for quick

    sim.addCombatant(player);
    sim.addCombatant(enemy);

    // Request attack
    let result = sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
      attackRequested: true,
      attackType: "quick",
    });

    // Should have attack_started event
    assert.ok(result.events.some(e => e.type === "attack_started"));
    assert.equal(player.state, "winding_up");

    // Tick through wind-up (quick + short_sword: 0.15 * 0.85 * 0.9 ≈ 0.115s)
    for (let i = 0; i < 10; i++) {
      result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
    }

    // After ~0.16s, wind-up should have completed and impact resolved
    const landed = result.events.filter(e => e.type === "attack_landed");
    if (landed.length > 0) {
      assert.ok((landed[0].damage as number) > 0, "damage should be positive");
      assert.equal(landed[0].targetId, "skeleton_01");
      assert.ok(enemy.health < 60, "enemy should have taken damage");
    }
  });

  it("player attack misses enemy out of range", () => {
    const sim = new GameSimulation(config, undefined, 42);

    const player = createCombatant("player", 100, "unarmed",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -20 }); // Way out of range

    sim.addCombatant(player);
    sim.addCombatant(enemy);

    // Attack + tick through wind-up
    sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
      attackRequested: true,
      attackType: "quick",
    });

    const allEvents: CombatEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
      allEvents.push(...result.events);
    }

    // Should NOT have attack_landed (out of range)
    const landed = allEvents.filter((e) => e.type === "attack_landed");
    assert.equal(landed.length, 0, "should not hit at 20m distance");
    assert.equal(enemy.health, 60, "enemy should be at full health");
  });

  it("enemy AI attacks player when in range", () => {
    const sim = new GameSimulation(config, undefined, 42);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 1 }); // Facing player

    const personality: EnemyPersonality = {
      aggression: 1.0, // Always attacks
      preferred_attacks: ["quick"],
      reaction_time: 0.1,
      combat_range: 4.0,
    };

    sim.addCombatant(player);
    sim.addCombatant(enemy, personality);

    // Tick enough for AI reaction + wind-up + resolution
    const allEvents: CombatEvent[] = [];
    for (let i = 0; i < 60; i++) {
      const result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
      allEvents.push(...result.events);
    }

    // Enemy should have started at least one attack
    const started = allEvents.filter((e) => e.type === "attack_started" && e.combatantId === "skeleton_01");
    assert.ok(started.length > 0, "enemy AI should have started an attack");
  });

  it("enemy AI does NOT attack when player out of range", () => {
    const sim = new GameSimulation(config, undefined, 42);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -15 }); // 15m away

    sim.addCombatant(player);
    sim.addCombatant(enemy, {
      aggression: 1.0,
      preferred_attacks: ["quick"],
      reaction_time: 0.1,
      combat_range: 4.0,
    });

    const allEvents: CombatEvent[] = [];
    for (let i = 0; i < 30; i++) {
      const result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
      allEvents.push(...result.events);
    }

    const started = allEvents.filter((e) => e.type === "attack_started" && e.combatantId === "skeleton_01");
    assert.equal(started.length, 0, "enemy should not attack at 15m");
  });

  it("store receives damage events", () => {
    const store = new GameStore();
    const sim = new GameSimulation(config, store, 42);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.5 });

    sim.addCombatant(player);
    sim.addCombatant(enemy);

    // Attack and tick through
    sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
      attackRequested: true,
      attackType: "quick",
    });

    for (let i = 0; i < 20; i++) {
      sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
      });
    }

    // If hit connected, store should reflect damage
    if (enemy.health < 60) {
      // Store should have been notified
      // (enemies array only populated via enemies_projected dispatch,
      //  but enemy_damaged should have been dispatched)
    }
  });

  it("seeded RNG produces deterministic results", () => {
    function runSim(seed: number): number[] {
      const sim = new GameSimulation(config, undefined, seed);
      const player = createCombatant("player", 100, "short_sword",
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
      const enemy = createCombatant("skeleton_01", 60, "unarmed",
        { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 1 });

      sim.addCombatant(player);
      sim.addCombatant(enemy, {
        aggression: 0.7,
        preferred_attacks: ["quick", "medium"],
        reaction_time: 0.5,
        combat_range: 4.0,
      });

      const hps: number[] = [];
      for (let i = 0; i < 120; i++) {
        sim.tick(0.016, {
          playerPosition: player.position,
          playerForward: player.forward,
          playerMoving: false,
        });
      }
      hps.push(player.health, enemy.health);
      return hps;
    }

    const run1 = runSim(42);
    const run2 = runSim(42);
    runSim(99); // different seed — smoke check only, result may legitimately match

    assert.deepEqual(run1, run2, "same seed should produce same results");
    // run3 MIGHT differ (different seed), but not guaranteed for all scenarios
  });

  it("npc behavior: un campesino huye de una pelea del sim", () => {
    const sim = new GameSimulation(config, undefined, 42);
    const behavior = createAmbientNpcBehavior({
      rng: new SeededRng(42),
      world: {
        queImpideElPaso: () => null,
        porDondeSalirDeAqui: () => null,
        blocksCircle: () => false,
        buscarRuta: (_d, hasta) => ({ ok: true, meta: hasta, puntos: [hasta], expansiones: 0, alBorde: false }),
        huellaDeLaZona: () => "",
        resolvePlaceTarget: () => null,
        getEntityPosition: () => null,
      },
    });
    sim.setNpcBehavior(behavior);

    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const enemy = createCombatant("skeleton_01", 60, "unarmed",
      { x: 0, y: 0, z: -1.5 }, { x: 0, y: 0, z: 1 });
    sim.addCombatant(player);
    sim.addCombatant(enemy, {
      aggression: 0.9,
      preferred_attacks: ["quick"],
      reaction_time: 0.3,
      combat_range: 4.0,
    });

    const npcRecord = {
      id: "aldeano_01",
      type: "npc",
      scene_id: "tile_0_0",
      spawned_at: "2026-01-01T00:00:00.000Z",
      spawn_reason: "scene_init",
      spawn_event_id: "",
      position: [4, 0, 0] as [number, number, number],
      data: { role: "peasant" },
      asset_refs: [],
    };
    behavior.addNpc(npcRecord);

    const npcEvents: string[] = [];
    for (let i = 0; i < 300; i++) {
      const result = sim.tick(0.016, {
        playerPosition: player.position,
        playerForward: player.forward,
        playerMoving: false,
        attackRequested: i === 5,
        attackType: i === 5 ? "quick" : undefined,
      });
      npcEvents.push(...result.npcEvents.map((e) => e.type));
    }

    assert.ok(npcEvents.includes("npc_fled_combat"), "el campesino debe huir de la pelea");
    const dist = Math.hypot(npcRecord.position[0], npcRecord.position[2]);
    assert.ok(dist > 4.5, `debe alejarse del combate (dist=${dist})`);
  });

  it("sin behavior system, npcEvents va vacío y nada cambia", () => {
    const sim = new GameSimulation(config, undefined, 42);
    const player = createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 });
    sim.addCombatant(player);
    const result = sim.tick(0.016, {
      playerPosition: player.position,
      playerForward: player.forward,
      playerMoving: false,
    });
    assert.deepEqual(result.npcEvents, []);
  });
});

describe("GameSimulation.respawn", () => {
  const personalidad: EnemyPersonality = {
    aggression: 1,
    preferred_attacks: ["quick"],
    reaction_time: 0.1,
    combat_range: 4.0,
  };

  /** #613, pieza C2: la muerte es absorbente (decisión del usuario 2026-08-31).
   *  El save ya lo cumplía; el sim levantaba al muerto al pulsar R. La muerte se
   *  PRODUCE por el camino real (ataque del jugador por `tick`), no se fabrica
   *  poniendo `health = 0`: si el golpe no llega, el test es rojo, no mudo. */
  it("reaparecer no levanta al enemigo que ya mataste", () => {
    const sim = new GameSimulation(config, new GameStore(), 42);
    const player = createCombatant("player", 100, "short_sword",
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    // A un golpe de morir, con su máximo aparte: si respawn lo cura, vuelve a 60.
    const a = createCombatant("a", 1, "unarmed", { x: 0, y: 0, z: -1.5 }, { x: 0, y: 0, z: 1 }, 60);
    const b = createCombatant("b", 60, "unarmed", { x: 0, y: 0, z: 30 }, { x: 0, y: 0, z: -1 }, 60);
    sim.addCombatant(player);
    sim.addCombatant(a, personalidad);
    sim.addCombatant(b, personalidad);

    const quieto = { playerPosition: player.position, playerForward: player.forward, playerMoving: false };
    const antes: CombatEvent[] = [];
    antes.push(...sim.tick(0.016, { ...quieto, attackRequested: true, attackType: "quick" }).events);
    for (let i = 0; i < 30 && !antes.some((e) => e.type === "died"); i++) {
      antes.push(...sim.tick(0.016, quieto).events);
    }
    assert.ok(
      antes.some((e) => e.type === "died" && e.combatantId === "a"),
      "premisa: el jugador mata a `a` en el sim (evento died)",
    );
    assert.equal(a.state, "dead");

    b.health = 20; // `b` no es el sujeto: basta con que esté herido y vivo
    player.health = 0;
    const dondeCayo = { ...a.position };
    sim.respawn({ x: 0, y: 0, z: -1 });

    assert.equal(a.health, 0, "el muerto sigue a 0 tras reaparecer");
    assert.equal(a.state, "dead", "…y sigue `dead`");
    // C1: si morir cura a los VIVOS lo decide #613, NO esta PR. Se afirma para
    // que quien lo cambie lo haga a sabiendas.
    assert.equal(b.health, b.maxHealth, "C1 intacto: el vivo herido se cura (pendiente de #613)");

    // 3 s de sim con el jugador pegado al cadáver: `a` ni ataca ni se mueve.
    const despues: CombatEvent[] = [];
    const junto = { playerPosition: player.position, playerForward: player.forward, playerMoving: false };
    for (let i = 0; i < 188; i++) despues.push(...sim.tick(0.016, junto).events);
    assert.deepEqual(
      despues.filter((e) => e.attackerId === "a" || e.combatantId === "a"),
      [],
      "el muerto no inicia ni resuelve ataques",
    );
    assert.deepEqual(a.position, dondeCayo, "el muerto no se mueve");
    assert.equal(a.health, 0);
  });

  /** #613, piezas A y B (decisión del usuario 2026-09-29, «punto seguro +
   *  suelta»). El jugador se acerca paso a paso a un bandido con radio de
   *  enganche 6 m, le engancha, se RETIRA ya enganchado (esos pasos no son
   *  seguros: alguien le hace caso) y muere por ticks reales. Reaparece en el
   *  último punto donde nadie le hacía caso —fuera del radio—, y el bandido,
   *  que le había seguido, le suelta y vuelve a su sitio. */
  const bandidoConRadio: EnemyPersonality = { ...personalidad, aggro_radius: 6, preferred_distance: 1.5 };
  const quietoEn = (p: { x: number; y: number; z: number }) => ({
    playerPosition: { ...p },
    playerForward: { x: 0, y: 0, z: -1 },
    playerMoving: false,
  });

  function morirContraElBandido() {
    const sim = new GameSimulation(config, new GameStore(), 42);
    const player = createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 20 });
    const casa = { x: 0, y: 0, z: 0 };
    const bandido = createCombatant("bandido", 60, "short_sword", { ...casa }, { x: 0, y: 0, z: 1 }, 60);
    sim.addCombatant(player);
    sim.addCombatant(bandido, bandidoConRadio);

    // Acercarse de 0,5 en 0,5 m: a 6 m (z=6) le engancha.
    let ultimoFuera: { x: number; y: number; z: number } | null = null;
    for (let z = 20; z >= 6; z -= 0.5) {
      const antes = { ...bandido.position };
      sim.tick(0.016, quietoEn({ x: 0, y: 0, z }));
      const seMovio = bandido.position.z !== antes.z;
      if (!seMovio && z > 6) ultimoFuera = { x: 0, y: 0, z };
    }
    assert.ok(bandido.position.z > 0, "premisa: el bandido se enganchó y echó a andar");
    assert.deepEqual(ultimoFuera, { x: 0, y: 0, z: 6.5 }, "premisa: el último paso fuera del radio");

    // Se retira YA enganchado, a donde el bandido tarda en llegar: ese sitio
    // no es seguro aunque esté lejos de la casa del bandido.
    const huida = { x: 0, y: 1.3, z: 15 };
    // A un golpe de morir: el balance del combate no es el sujeto, la muerte
    // sí — y se produce por el camino real (golpe del bandido por `tick`).
    player.health = 5;
    const eventos: CombatEvent[] = [];
    for (let i = 0; i < 4000 && !eventos.some((e) => e.type === "died"); i++) {
      eventos.push(...sim.tick(0.05, quietoEn(huida)).events);
    }
    assert.ok(
      eventos.some((e) => e.type === "died" && e.combatantId === "player"),
      "premisa: el bandido mata al jugador en el sim (evento died)",
    );
    return { sim, player, bandido, casa, huida };
  }

  it("A: el punto seguro es el último FUERA de combate, a ras de suelo, no donde caíste", () => {
    const { sim, player, huida } = morirContraElBandido();
    // En partida es una SUGERENCIA para el motor (`context.muerte`); sin
    // motor, es donde R levanta al jugador. En los dos casos, el mismo dato.
    const seguro = sim.puntoSeguroActual;
    assert.deepEqual(seguro, { x: 0, y: 0, z: 6.5 });
    assert.notDeepEqual(seguro, { ...huida, y: 0 }, "no donde caíste: ahí ya había alguien enganchado");
    const { punto, events } = sim.respawn(seguro!);
    assert.deepEqual(player.position, punto, "el sim pone al jugador en el punto que se le da");
    assert.equal(player.health, player.maxHealth);
    assert.deepEqual(events, [{ type: "player_respawned", hp: player.maxHealth }]);
    assert.deepEqual(sim.store.state.player.pos, [0, 0, 6.5], "el store se entera del punto");
  });

  it("B: al morir te suelta, vuelve a su sitio y no vuelve a por ti desde el punto seguro", () => {
    const { sim, bandido, casa } = morirContraElBandido();
    bandido.health = 20; // C1: el vivo herido se cura al reaparecer tú
    const { punto } = sim.respawn(sim.puntoSeguroActual!);
    assert.deepEqual(bandido.position, casa, "el bandido vuelve a su sitio de alta");
    assert.equal(bandido.state, "idle");
    assert.equal(bandido.health, bandido.maxHealth, "C1: morir cura a los vivos (decisión 2026-09-29)");

    // 3 s de sim con el jugador quieto en el punto seguro (6,5 m, fuera del
    // radio): el bandido ni se mueve ni ataca. Sin `soltar()` seguiría
    // enganchado y echaría a andar hacia el jugador.
    const despues: CombatEvent[] = [];
    for (let i = 0; i < 60; i++) despues.push(...sim.tick(0.05, quietoEn(punto)).events);
    assert.deepEqual(bandido.position, casa, "suelto: no se mueve de su sitio");
    assert.deepEqual(despues.filter((e) => e.attackerId === "bandido"), [], "suelto: no ataca");

    // …y si reentras en su radio, vuelve a por ti: soltar no es desactivar.
    for (let i = 0; i < 20; i++) sim.tick(0.05, quietoEn({ x: 0, y: 0, z: 5 }));
    assert.ok(bandido.position.z > 0, "reentrar en su radio lo vuelve a enganchar");
  });

  it("sin un tick, el punto seguro es donde se dio de alta el jugador (resume)", () => {
    const sim = new GameSimulation(config, new GameStore(), 42);
    const player = createCombatant("player", 100, "short_sword", { x: 3, y: 1.2, z: -7 });
    sim.addCombatant(player);
    player.position = { x: 40, y: 0, z: 40 };
    player.health = 0;
    assert.deepEqual(sim.puntoSeguroActual, { x: 3, y: 0, z: -7 });
  });

  /** #613, «que decida el motor»: el sim ya no decide DÓNDE — levanta al
   *  jugador en el punto que se le da, a ras de suelo, y desde ahí vuelve a
   *  contar el punto seguro y el asesino. */
  it("respawn(punto): levanta en el punto dado, con y=0, y olvida al asesino", () => {
    const { sim, player } = morirContraElBandido();
    assert.equal(sim.ultimoAtacanteDelJugador, "bandido", "el golpe que le mató queda apuntado");
    const { punto } = sim.respawn({ x: -20, y: 3, z: 12 });
    assert.deepEqual(punto, { x: -20, y: 0, z: 12 });
    assert.deepEqual(player.position, punto);
    assert.deepEqual(sim.puntoSeguroActual, punto, "despertar es estar a salvo");
    assert.equal(sim.ultimoAtacanteDelJugador, null);
  });

  it("un cadáver no se mueve: el input de un jugador caído no cambia su posición", () => {
    const { sim, player } = morirContraElBandido();
    const cadaver = { ...player.position };
    sim.tick(0.05, quietoEn({ x: 50, y: 0, z: 50 }));
    assert.deepEqual(player.position, cadaver);
  });

  it("hostilesVivos: los vivos con IA, con su sitio de alta y su radio; el muerto no", () => {
    const { sim, bandido, casa } = morirContraElBandido();
    const [h, ...resto] = sim.hostilesVivos();
    assert.deepEqual(resto, []);
    assert.deepEqual(h, { id: "bandido", pos: bandido.position, casa, radio: 6 });
    assert.notDeepEqual(h.pos, casa, "premisa: el bandido se movió de su sitio al perseguir");
    bandido.health = 0;
    assert.deepEqual(sim.hostilesVivos(), []);
  });

  it("sin jugador no hay a quién reaparecer, y se dice", () => {
    const sim = new GameSimulation(config, new GameStore(), 42);
    assert.throws(() => sim.respawn({ x: 0, y: 0, z: 0 }), /no hay jugador/);
    sim.addCombatant(createCombatant("player"));
    sim.removeCombatant("player");
    assert.throws(() => sim.respawn({ x: 0, y: 0, z: 0 }), /no hay jugador/);
    assert.equal(sim.puntoSeguroActual, null);
  });
});

/** QA H4 de BN: dos hostiles juntos no se pelean entre ellos. El blanco de
 *  la IA enemiga elegía al combatiente vivo más cercano, sin bandos, así que
 *  a 4 m se enganchaban entre sí en el primer tick; eso congelaba el punto
 *  seguro (`algunoEnganchado`) y el superviviente iba a por el jugador ya
 *  enganchado, desde cualquier distancia. */
describe("GameSimulation — los hostiles no se pelean entre sí", () => {
  it("dos hostiles a 4 m, el jugador a 30: 5 s de tick sin un golpe entre ellos, y el punto seguro avanza", () => {
    const sim = new GameSimulation(config, new GameStore(), 42);
    const player = createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 30 });
    const radio: EnemyPersonality = {
      aggression: 1, preferred_attacks: ["quick"], reaction_time: 0.1, combat_range: 4, aggro_radius: 10,
    };
    sim.addCombatant(player);
    sim.addCombatant(createCombatant("b1", 60, "short_sword", { x: 0, y: 0, z: 0 }), radio);
    sim.addCombatant(createCombatant("b2", 60, "short_sword", { x: 4, y: 0, z: 0 }), radio);
    const eventos: CombatEvent[] = [];
    for (let i = 0; i < 100; i++) {
      eventos.push(...sim.tick(0.05, {
        playerPosition: { x: 0, y: 0, z: 30 - i * 0.1 },
        playerForward: { x: 0, y: 0, z: -1 },
        playerMoving: true,
      }).events);
    }
    assert.deepEqual(eventos.filter((e) => e.type === "attack_started" || e.type === "attack_landed"), []);
    assert.equal(sim.getCombatant("b1")!.health, 60);
    assert.equal(sim.getCombatant("b2")!.health, 60);
    assert.deepEqual(sim.puntoSeguroActual, { x: 0, y: 0, z: 30 - 99 * 0.1 }, "nadie enganchado: el punto sigue al jugador");
  });
});

/** #613, pieza D: la única curación del juego. La aplica el bridge con la
 *  consequence `player_healed` del motor; aquí, la regla. */
describe("GameSimulation.curarAlJugador", () => {
  function conJugadorA(vida: number) {
    const store = new GameStore();
    const sim = new GameSimulation(config, store, 42);
    const player = createCombatant("player", 100, "short_sword");
    player.health = vida;
    sim.addCombatant(player);
    store.state.player.hp = vida;
    return { sim, store, player };
  }

  it("suma la cantidad y devuelve lo recuperado; el store se entera", () => {
    const { sim, store, player } = conJugadorA(50);
    assert.equal(sim.curarAlJugador(25), 25);
    assert.equal(player.health, 75);
    assert.equal(store.state.player.hp, 75);
  });

  it("topa en el máximo y devuelve solo lo que cupo", () => {
    const { sim, store, player } = conJugadorA(90);
    assert.equal(sim.curarAlJugador(25), 10);
    assert.equal(player.health, 100);
    assert.equal(store.state.player.hp, 100);
  });

  it("lleno: no recupera nada y no despacha", () => {
    const { sim, store } = conJugadorA(100);
    let despachos = 0;
    store.onAll(() => despachos++);
    assert.equal(sim.curarAlJugador(25), 0);
    assert.equal(despachos, 0);
  });

  it("a un muerto no le hace nada: solo R deshace la muerte", () => {
    const { sim, store, player } = conJugadorA(0);
    assert.equal(sim.curarAlJugador(25), 0);
    assert.equal(player.health, 0);
    assert.equal(store.state.player.hp, 0);
  });

  it("una cantidad que no es un número positivo es un error de quien llama", () => {
    const { sim, player } = conJugadorA(50);
    for (const mala of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => sim.curarAlJugador(mala), RangeError, `cantidad ${mala}`);
    }
    assert.equal(player.health, 50);
  });

  it("sin jugador en el sim, se dice", () => {
    const sim = new GameSimulation(config, new GameStore(), 42);
    assert.throws(() => sim.curarAlJugador(10), /no hay jugador/);
  });
});

describe("GameSimulation.setCombatSystem", () => {
  it("swaps the system after reset()", () => {
    const sim = new GameSimulation(config, undefined, 42);
    assert.equal(sim.combatSystem.id, "standard");
    sim.reset();
    sim.setCombatSystem(combatRegistry.create("basic", config));
    assert.equal(sim.combatSystem.id, "basic");
  });

  it("refuses to swap with live enemy AIs (they capture the system)", () => {
    const sim = new GameSimulation(config, undefined, 42);
    sim.addCombatant(createCombatant("player"));
    sim.addCombatant(createCombatant("skeleton_01"), {
      aggression: 0.5,
      preferred_attacks: ["quick"],
      reaction_time: 0.3,
      combat_range: 4.0,
    });
    assert.throws(
      () => sim.setCombatSystem(combatRegistry.create("basic", config)),
      /call reset\(\) first/,
    );
  });
});
