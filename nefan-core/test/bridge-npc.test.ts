/** Vida ambiental de NPCs conducida por el sim del bridge.
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCombatant } from "../src/combat/combatant.js";
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
  porElBorde,
  waitFor,
} from "./helpers.js";

describe("bridge vida ambiental de NPCs", () => {
  async function startAmbientSession() {
    const setup = makeCtx();
    const { socket, sent } = makeSocket();
    await porElBorde(
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
      await porElBorde(
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
      { aggression: 1.0, preferred_attacks: ["quick"], reaction_time: 0.1, combat_range: 4 },
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

  /** #298, QA de BL H2 — decisión del usuario: «que el estado le llegue al
   *  motor de narrativa y él decide». El que iba a un sitio y huye ABANDONA
   *  esa meta (no vuelve solo a la pelea) y el motor se entera por los canales
   *  que ya tiene: la línea de `ambient_events` del LlmContext y el record. */
  it("el que huye con un goto_place lo ABANDONA, y el motor lo ve en su contexto", async () => {
    const { ctx, narrative, socket } = await startAmbientSession();
    const sceneId = narrative.world.active_scene_id;
    narrative.worldMap.upsertPlace({
      id: "plaza", kind: "site", parent_id: "world", name: "La Plaza",
      anchor: { tx: 0, ty: 0, rect: [64, 64, 4, 4] },
    });
    const directiva = { type: "goto_place", target_place_id: "plaza" };
    narrative.recordEntitySpawned(
      "campesino_1", "npc", sceneId, [4, 0, 0],
      { name: "Campesino", role: "peasant", directive: directiva }, "scene_init",
    );
    npcSync(ctx);
    ctx.sim.addCombatant(
      createCombatant("bandido_1", 60, "unarmed", { x: 0, y: 0, z: -1.5 }, { x: 0, y: 0, z: 1 }),
      { aggression: 1.0, preferred_attacks: ["quick"], reaction_time: 0.1, combat_range: 4 },
    );
    await tickInput(ctx, socket, 100);

    const npc = narrative.getEntity("campesino_1")!;
    assert.equal(npc.data.directive, null, "la directiva que le llevaba a la pelea se retira");
    const sg = npc.data.suspended_goal as { field: string; value: unknown; reason: string; fight_at: number[] };
    assert.equal(sg?.field, "directive");
    assert.deepEqual(sg.value, directiva, "con su valor, para poder re-emitirla");
    assert.equal(sg.reason, "fled_combat");
    assert.equal(sg.fight_at.length, 2);
    const linea = narrative.serializeForLlm().ambient_events?.find((e) => e.includes("Campesino") && e.includes("huyó"));
    assert.ok(linea, "la huida está en el contexto del motor");
    assert.ok(linea.includes("ABANDONÓ") && linea.includes("goto_place") && linea.includes("La Plaza"),
      `y dice qué abandonó y adónde iba: ${linea}`);

    // El motor decide: re-emitirla limpia la marca.
    ctx.npcDirector.setDirective("campesino_1", directiva);
    assert.equal(narrative.getEntity("campesino_1")!.data.suspended_goal, undefined);
  });

  /** Guion 119, rojo en `main` tras #775: la huida llega hasta
   *  `distanciaDeHuida` y el que huye se queda donde paró, así que el
   *  tabernero que huía hacia el borde del tile acababa DENTRO de la «Zona sin
   *  generar» —x ≈ 46 con el tile acabando en 32— y el jugador no podía llegar
   *  a hablarle. El que huye hacia el borde se queda en el mundo generado. */
  it("el que huye hacia el borde del tile no se sale a la zona sin generar", async () => {
    const { ctx, narrative, socket } = await startAmbientSession();
    const sceneId = narrative.world.active_scene_id;
    // La pelea a 10 m del borde este (x = 32) y el campesino entre ella y el
    // borde: su huida (percepción 14 + margen + paseo 5) le lleva más allá.
    narrative.recordEntitySpawned(
      "campesino_1", "npc", sceneId, [26, 0, 0],
      { name: "Campesino", role: "peasant" }, "scene_init",
    );
    npcSync(ctx);
    ctx.sim.addCombatant(
      createCombatant("bandido_1", 60, "unarmed", { x: 22, y: 0, z: -1.5 }, { x: 0, y: 0, z: 1 }),
      { aggression: 1.0, preferred_attacks: ["quick"], reaction_time: 0.1, combat_range: 4 },
    );
    let maxX = -Infinity;
    for (let i = 0; i < 20 / 0.05; i++) {
      await porElBorde(
        {
          type: "input",
          delta: 0.05,
          inputs: {
            playerPosition: { x: 22, y: 0, z: 0 },
            playerForward: { x: 0, y: 0, z: -1 },
            playerMoving: false,
          },
        },
        socket,
        ctx,
      );
      maxX = Math.max(maxX, narrative.getEntity("campesino_1")!.position[0]);
    }
    assert.ok(
      narrative.serializeForLlm().ambient_events?.some((e) => e.includes("Campesino") && e.includes("huyó")),
      "CONTROL: huyó de verdad",
    );
    assert.ok(maxX <= 32, `no cruza x = 32 en ningún tick: llegó a ${maxX.toFixed(2)}`);
  });

  /** QA de BO, H3 — la misma decisión del usuario aplicada al que NO TIENE
   *  CAMINO: se para, su meta pasa a `suspended_goal` con `reason: "no_path"`
   *  y viaja al motor como estado; no la reintenta en bucle, solo si cambia el
   *  mundo de su zona. Un patio cerrado por cuatro murallas que pone el motor. */
  it("el que no tiene camino se PARA, deja la meta al motor y solo la reintenta si cambia el mundo", async () => {
    const { ctx, narrative, socket } = await startAmbientSession();
    const sceneId = narrative.world.active_scene_id;
    // El patio: centro (20, 20), murallas de 1 m de grueso a 4 m.
    narrative.worldMap.upsertPlace({
      id: "patio", kind: "site", parent_id: "world", name: "El Patio",
      anchor: { tx: 0, ty: 0, rect: [(20 + 32) / 0.5, (20 + 32) / 0.5, 0, 0] },
    });
    const muro = (id: string, x: number, z: number, w: number, h: number) =>
      narrative.recordEntitySpawned(id, "building", sceneId, [x, 0, z], { name: id, footprint: [w, h] }, "narrative_request");
    muro("muro_n", 20, 24, 18, 2); muro("muro_s", 20, 16, 18, 2);
    muro("muro_e", 24, 20, 2, 18); muro("muro_o", 16, 20, 2, 18);
    const directiva = { type: "goto_place", target_place_id: "patio" };
    narrative.recordEntitySpawned("aldeano_1", "npc", sceneId, [4, 0, 20],
      { name: "Aldeano", role: "villager", directive: directiva }, "scene_init");
    npcSync(ctx);
    let planes = 0;
    const buscar = ctx.simCollision.buscarRuta.bind(ctx.simCollision);
    ctx.simCollision.buscarRuta = (...a) => { planes++; return buscar(...a); };
    await tickInput(ctx, socket, 3 / 0.05);

    const npc = narrative.getEntity("aldeano_1")!;
    assert.equal(npc.data.directive, null, "la directiva sale del record");
    const sg = npc.data.suspended_goal as { field: string; value: unknown; reason: string; stuck_at: number[]; why: string };
    assert.equal(sg?.reason, "no_path", JSON.stringify(sg));
    assert.deepEqual(sg.value, directiva);
    assert.equal(sg.stuck_at.length, 2);
    const llm = narrative.serializeForLlm();
    assert.equal(llm.entities.find((e) => e.id === "aldeano_1")?.suspended_goal?.reason, "no_path",
      "viaja en el contexto del motor como ESTADO");
    const linea = llm.ambient_events?.find((e) => e.includes("Aldeano") && e.includes("no encuentra camino"));
    assert.ok(linea?.includes("ABANDONÓ") && linea.includes("El Patio"), `la línea dice qué dejó: ${linea}`);

    // Quieto y sin reintentar en bucle: 30 s más, ni un plan.
    const planesAlRendirse = planes;
    const donde = [...npc.position];
    await tickInput(ctx, socket, 30 / 0.05);
    assert.equal(planes, planesAlRendirse, "sin cambios en el mundo, no vuelve a planificar");
    assert.deepEqual(narrative.getEntity("aldeano_1")!.position, donde, "y no se mueve");
    assert.equal(ctx.sim.npcBehaviorSystem!.states().find((n) => n.id === "aldeano_1")?.moving, false);

    // El mundo de su zona cambia (el motor pone algo): lo reintenta, una vez.
    narrative.recordEntitySpawned("barril", "object", sceneId, [0, 0, 10], { name: "barril" }, "narrative_request");
    await tickInput(ctx, socket, 3 / 0.05);
    assert.ok(planes > planesAlRendirse, "con el mundo cambiado, vuelve a intentarlo");
    assert.ok(narrative.serializeForLlm().ambient_events?.some((e) => e.includes("Aldeano") && e.includes("vuelve a por")),
      "y lo dice");
    assert.equal((narrative.getEntity("aldeano_1")!.data.suspended_goal as { reason?: string })?.reason, "no_path",
      "el patio sigue cerrado: vuelve a dejarla");
  });

  /** H2b de la QA de BL: la meta abandonada es ESTADO, no una línea de log.
   *  El escenario de la QA: un bandido y seis NPC (el campesino con su
   *  `goto_place`, dos aldeanos, un mercader y dos guardias). A los 30 s las
   *  huidas, intervenciones y reanudaciones de los demás han echado la línea
   *  «ABANDONÓ…» de la ventana de 10 de `ambient_events`; lo que tiene que
   *  seguir en el contexto del motor es la ENTIDAD con su `suspended_goal`. */
  it("con seis NPC y 30 s de pelea, la meta abandonada sigue en el contexto del motor", async () => {
    const { ctx, narrative, socket } = await startAmbientSession();
    const sceneId = narrative.world.active_scene_id;
    narrative.worldMap.upsertPlace({
      id: "plaza", kind: "site", parent_id: "world", name: "La Plaza",
      anchor: { tx: 0, ty: 0, rect: [64, 64, 4, 4] },
    });
    const directiva = { type: "goto_place", target_place_id: "plaza" };
    const npcs: Array<[string, [number, number, number], Record<string, unknown>]> = [
      ["campesino_1", [4, 0, 0], { name: "Campesino", role: "peasant", directive: directiva }],
      ["aldeano_1", [-4, 0, 2], { name: "Aldeano", role: "villager" }],
      ["aldeano_2", [2, 0, 5], { name: "Aldeana", role: "villager" }],
      ["mercader_1", [-3, 0, -4], { name: "Mercader", role: "merchant" }],
      ["guardia_1", [8, 0, 3], { name: "Guardia", role: "guard" }],
      ["guardia_2", [-8, 0, -3], { name: "Guardia Mayor", role: "guard" }],
    ];
    for (const [id, pos, data] of npcs) narrative.recordEntitySpawned(id, "npc", sceneId, pos, data, "scene_init");
    npcSync(ctx);
    ctx.sim.addCombatant(
      createCombatant("bandido_1", 60, "unarmed", { x: 0, y: 0, z: -1.5 }, { x: 0, y: 0, z: 1 }),
      { aggression: 1.0, preferred_attacks: ["quick"], reaction_time: 0.1, combat_range: 4 },
    );
    await tickInput(ctx, socket, 30 / 0.05);

    const llm = narrative.serializeForLlm();
    assert.ok(
      !llm.ambient_events?.some((e) => e.includes("ABANDONÓ")),
      "CONTROL: a los 30 s la línea de ambiente ya se cayó de la ventana — si sigue, esto no mide el canal de estado",
    );
    const campesino = llm.entities.find((e) => e.id === "campesino_1");
    assert.ok(campesino, "el campesino está en las entidades del contexto");
    assert.equal(campesino.suspended_goal?.field, "directive");
    assert.deepEqual(campesino.suspended_goal?.value, directiva,
      `el motor ve qué abandonó: ${JSON.stringify(campesino.suspended_goal)}`);
    assert.equal(campesino.suspended_goal?.reason, "fled_combat");
    for (const e of llm.entities.filter((x) => x.id !== "campesino_1")) {
      assert.equal(e.suspended_goal, undefined, `${e.id} no abandonó nada`);
    }

    // El motor decide (re-emitir): en el contexto siguiente ya no está.
    ctx.npcDirector.setDirective("campesino_1", directiva);
    const despues = narrative.serializeForLlm().entities.find((e) => e.id === "campesino_1");
    assert.equal(despues?.suspended_goal, undefined);
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
