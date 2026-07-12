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
    const maxDrift = NPC_ROLE_PRESETS.villager.wander_radius + 1;
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
});
