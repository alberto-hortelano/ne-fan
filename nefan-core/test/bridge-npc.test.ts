/** Vida ambiental de NPCs conducida por el sim del bridge.
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCombatant } from "../src/combat/combatant.js";
import { routeMessage } from "../bridge/router.js";
import { npcSync } from "../bridge/context.js";
import type { BridgeContext, ClientSocket } from "../bridge/context.js";
import type {
  StateUpdateMessage,
} from "../src/protocol/messages.js";
import { NPC_ROLE_PRESETS } from "../src/simulation/npc-roles.js";
import { combatForHostileRole } from "../src/combat/hostiles.js";
import {
  makeCtx,
  makeSocket,
  waitFor,
  } from "./helpers.js";

describe("bridge vida ambiental de NPCs", () => {
  async function startAmbientSession() {
    const setup = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      setup.ctx,
    );
    await waitFor(() =>
      setup.broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    return { ...setup, socket, sent };
  }

  async function tickInput(
    ctx: BridgeContext,
    socket: ClientSocket,
    n: number,
    delta = 0.05,
  ): Promise<void> {
    for (let i = 0; i < n; i++) {
      await routeMessage(
        {
          type: "input",
          delta,
          inputs: {
            playerPosition: { x: 0, y: 0, z: 0 },
            playerForward: { x: 0, y: 0, z: -1 },
            playerMoving: false,
          },
        },
        socket,
        ctx,
      );
    }
  }

  it("start_session activa el behavior default y state_update lleva npcs", async () => {
    const { ctx, narrative, socket, sent } = await startAmbientSession();
    assert.ok(ctx.sim.npcBehaviorSystem, "behavior system activo tras start_session");
    const sceneId = narrative.world.active_scene_id;
    narrative.recordEntitySpawned(
      "aldeano_1", "npc", sceneId, [5, 0, 5], { name: "Aldeano", role: "peasant" }, "scene_init",
    );
    npcSync(ctx);
    sent.length = 0;
    await tickInput(ctx, socket, 1);
    const update = sent[0] as StateUpdateMessage;
    assert.equal(update.type, "state_update");
    assert.ok(update.npcs, "state_update.npcs presente con behavior activo");
    assert.equal(update.npcs!.length, 1);
    assert.equal(update.npcs![0].id, "aldeano_1");
    assert.ok(Number.isFinite(update.npcs![0].pos.x));
  });

  it("npc_move_to_place: el NPC camina, llega, cierra el transit y queda en el log", async () => {
    const { ctx, narrative, socket } = await startAmbientSession();
    const sceneId = narrative.world.active_scene_id;
    // El place ancla en el tile (0,0), celdas 64..68 → centro mundo ~(1, 1).
    narrative.worldMap.upsertPlace({
      id: "plaza", kind: "site", parent_id: "world", name: "La Plaza",
      anchor: { tx: 0, ty: 0, rect: [64, 64, 4, 4] },
    });
    narrative.recordEntitySpawned(
      "aldeano_1", "npc", sceneId, [8, 0, 8], { name: "Aldeana", role: "villager" }, "scene_init",
    );
    npcSync(ctx);
    const moved = ctx.npcDirector.moveNpcToPlace("aldeano_1", "plaza");
    assert.equal(moved.ok, true);
    assert.equal(moved.info?.in_transit?.to, "plaza");

    await tickInput(ctx, socket, 500);

    const info = ctx.npcDirector.getNpcPlace("aldeano_1");
    assert.equal(info?.in_transit, null, "el sim declara la llegada (arriveNpc)");
    assert.equal(info?.current_place_id, "plaza");
    const entity = narrative.getEntity("aldeano_1")!;
    const dist = Math.hypot(entity.position[0] - 1, entity.position[2] - 1);
    // Tras llegar, la plaza pasa a ser su nueva "casa" y el micro-wander lo
    // aleja hasta wander_radius del centro — el límite se deriva del rol para
    // que el test no compita con el RNG del wander (era flaky con dist < 3).
    // +2 y no +1: el wander puede pillarse a MITAD de paso hacia un target en
    // el borde del radio (CI 2026-08-11: dist=7.2 con radio 6).
    const maxDrift = NPC_ROLE_PRESETS.villager.wander_radius + 2;
    assert.ok(dist < maxDrift, `el NPC debe estar cerca de la plaza (dist=${dist.toFixed(1)}, max=${maxDrift})`);
    const llm = narrative.serializeForLlm();
    assert.ok(
      llm.ambient_events?.some((e) => e.includes("Aldeana") && e.includes("La Plaza")),
      `ambient_events debe registrar la llegada: ${JSON.stringify(llm.ambient_events)}`,
    );
  });

  it("una pelea cerca alimenta ambient_events (huida) sin tocar dialogue_history", async () => {
    const { ctx, narrative, socket } = await startAmbientSession();
    const sceneId = narrative.world.active_scene_id;
    narrative.recordEntitySpawned(
      "campesino_1", "npc", sceneId, [4, 0, 0], { name: "Campesino", role: "peasant" }, "scene_init",
    );
    npcSync(ctx);
    // Enemigo agresivo pegado al jugador → pelea inmediata.
    ctx.sim.addCombatant(
      createCombatant("bandido_1", 60, "unarmed", { x: 0, y: 0, z: -1.5 }, { x: 0, y: 0, z: 1 }),
      { aggression: 1.0, preferred_attacks: ["quick"], reaction_time: 0.1 },
    );
    const dialoguesBefore = narrative.dialogue_history.length;
    await tickInput(ctx, socket, 100);
    const llm = narrative.serializeForLlm();
    assert.ok(
      llm.ambient_events?.some((e) => e.includes("Campesino") && e.includes("huyó")),
      `ambient_events debe registrar la huida: ${JSON.stringify(llm.ambient_events)}`,
    );
    assert.equal(narrative.dialogue_history.length, dialoguesBefore, "el log ambiental no contamina el diálogo");
  });

  /** EL GUARDIA DE EXCLUSIÓN. Hasta #323 nada impedía que un mismo id
   *  estuviera a la vez en `NpcBehaviorSystem` y en `combatants`, y no dolía
   *  porque nunca hubo enemigos. Con hostiles serían DOS dueños de la misma
   *  posición: el behavior muta `record.position` in situ cada tick y el
   *  combatiente lo mueve la IA de combate, así que el enemigo parpadearía
   *  entre dos sitios, saldría por los dos canales del `state_update` y —con
   *  `flees_from_combat` del preset villager al que degradaría— huiría de su
   *  propia pelea.
   *
   *  PROBADO EN NEGATIVO: quitando la línea `if (isHostileRole(e.data.role))
   *  continue` de `npcSync` (bridge/context.ts), este bloque se pone rojo por
   *  las tres afirmaciones a la vez. */
  it("un NPC hostil NO entra en la vida ambiental (un solo dueño de su posición)", async () => {
    const { ctx, narrative, socket, sent } = await startAmbientSession();
    const sceneId = narrative.world.active_scene_id;
    narrative.recordEntitySpawned(
      "aldeano_1", "npc", sceneId, [5, 0, 5], { name: "Aldeano", role: "peasant" }, "scene_init",
    );
    narrative.recordEntitySpawned(
      "bandido_1", "npc", sceneId, [6, 0, 6],
      { name: "Bandido", role: "hostile", combat: combatForHostileRole("hostile") },
      "narrative_request",
    );
    npcSync(ctx);

    const gestionados = [...ctx.sim.npcBehaviorSystem!.ids()];
    assert.deepEqual(gestionados, ["aldeano_1"], "el hostil se coló en el behavior system");

    // Y no sale por el canal de NPCs del state_update: si saliera, el cliente
    // le movería la Entity desde `npcs` mientras el sim se la mueve desde
    // `enemies`.
    sent.length = 0;
    await tickInput(ctx, socket, 1);
    const update = sent[0] as StateUpdateMessage;
    assert.deepEqual((update.npcs ?? []).map((n) => n.id), ["aldeano_1"]);

    // Tercera afirmación, la que cierra el "un solo dueño": el sim NO ha
    // tocado su posición por la vía ambiental (sigue donde lo puso el motor).
    assert.deepEqual(narrative.getEntity("bandido_1")!.position, [6, 0, 6]);
  });

  it("un hostil que ya estaba gestionado se RETIRA del behavior en el siguiente sync", async () => {
    // Reconciliación, no solo alta: un save viejo o un cambio de rol podría
    // dejar dentro a alguien que ya no debe estar.
    //
    // Entra por `startAmbientSession` y no por `makeCtx()` a secas porque sin
    // `start_session` no hay behavior system: la primera versión de este test
    // salía por un `if (!behavior) return` y era un VERDE VACÍO — pasaba
    // igual con el guardia quitado, comprobado.
    const { ctx, narrative } = await startAmbientSession();
    const behavior = ctx.sim.npcBehaviorSystem;
    assert.ok(behavior, "sin behavior activo este test no puede ponerse rojo");
    const sceneId = narrative.world.active_scene_id;
    narrative.recordEntitySpawned(
      "maton_1", "npc", sceneId, [2, 0, 2], { name: "Matón", role: "villager" }, "scene_init",
    );
    npcSync(ctx);
    assert.ok(behavior.ids().includes("maton_1"), "precondición: entra como ambiental");

    narrative.getEntity("maton_1")!.data.role = "hostile";
    npcSync(ctx);
    assert.ok(!behavior.ids().includes("maton_1"), "al volverse hostil sale del behavior");
  });
});
