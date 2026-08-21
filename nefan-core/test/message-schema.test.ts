/** Validación runtime del input WS del cliente (bridge edge).
 *
 *  La guardia de DERIVA (zod ⇄ union TS `ClientMessage`) es a nivel de tipos y
 *  vive en src/protocol/message-schema.ts, no aquí: el tsconfig sólo typechequea
 *  src/bridge/services, y test/ corre con tsx sin typecheck. Estos tests cubren
 *  el RUNTIME: un frame válido pasa y uno malformado se rechaza con un error
 *  accionable — lo que el borde WS devuelve al cliente como narrative_status. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ClientMessageSchema } from "../src/protocol/message-schema.js";
import type { ClientMessage } from "../src/protocol/messages.js";
import { validateContract } from "../src/contract/model-io/validate.js";
import { intakeClientMessage } from "../bridge/message-intake.js";

test("un frame válido de cada tipo pasa la validación", () => {
  const valid: ClientMessage[] = [
    {
      type: "input",
      delta: 0.016,
      inputs: {
        playerPosition: { x: 1, y: 0, z: -2 },
        playerForward: { x: 0, y: 0, z: -1 },
        playerMoving: true,
      },
    },
    { type: "ping" },
    { type: "respawn" },
    { type: "respawn", pos: { x: 0, y: 1, z: 4 } },
    { type: "start_session", requestId: "r1", gameId: "toledo_1200" },
    { type: "resume_session", requestId: "r2", sessionId: "s1" },
    { type: "delete_session", requestId: "r3", sessionId: "s1" },
    { type: "set_render_mode", requestId: "r4", sessionId: "s1", renderMode: "image" },
    { type: "set_render_mode", requestId: "r5", sessionId: "s1", renderMode: "vector", facet: "characters" },
    {
      type: "dialogue_choice",
      eventId: "e1",
      choiceIndex: 0,
      speaker: "Domingo",
      chosenText: "Hola",
    },
    { type: "player_entered_place", placeId: "plaza" },
    { type: "request_tile", tx: 0, ty: 1, reason: "blocking", edge: "east" },
    {
      type: "add_combatants",
      enemies: [
        {
          id: "guard",
          position: { x: 0, y: 0, z: 0 },
          health: 100,
          weaponId: "short_sword",
          personality: { aggression: 0.5, preferred_attacks: ["quick"], reaction_time: 0.3 },
        },
      ],
    },
    { type: "interact_entity", entityId: "npc1", entityName: "Tabernero" },
  ];
  for (const msg of valid) {
    const res = validateContract(ClientMessageSchema, msg);
    assert.equal(res.ok, true, `debería aceptar ${msg.type}: ${res.ok ? "" : res.error}`);
  }
});

test("set_render_mode con renderMode fuera del enum se rechaza", () => {
  const res = validateContract(ClientMessageSchema, {
    type: "set_render_mode", requestId: "r1", sessionId: "s1", renderMode: "clay",
  });
  assert.equal(res.ok, false);
});

test("un type desconocido se rechaza con error del discriminador", () => {
  const res = validateContract(ClientMessageSchema, { type: "hack_the_bridge" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /discriminator|type/i);
});

test("un input con playerPosition mal tipado se rechaza (no llega al sim)", () => {
  const res = validateContract(ClientMessageSchema, {
    type: "input",
    delta: 0.016,
    inputs: {
      playerPosition: { x: "NaN", y: 0, z: 0 }, // x no es número
      playerForward: { x: 0, y: 0, z: -1 },
      playerMoving: true,
    },
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /playerPosition|x/);
});

test("start_session sin gameId se rechaza (campo requerido)", () => {
  const res = validateContract(ClientMessageSchema, { type: "start_session", requestId: "r1" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /gameId/);
});

test("add_combatants con enemigo sin personality se rechaza", () => {
  const res = validateContract(ClientMessageSchema, {
    type: "add_combatants",
    enemies: [{ id: "g", position: { x: 0, y: 0, z: 0 }, health: 10, weaponId: "unarmed" }],
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /personality/);
});

test("campos extra no modelados se toleran (strip, no rechazo)", () => {
  const res = validateContract(ClientMessageSchema, {
    type: "ping",
    futureField: "de un cliente más nuevo",
  });
  assert.equal(res.ok, true);
});

test("edge inválido en request_tile se rechaza", () => {
  const res = validateContract(ClientMessageSchema, {
    type: "request_tile",
    tx: 0,
    ty: 0,
    reason: "blocking",
    edge: "up",
  });
  assert.equal(res.ok, false);
});

// ── Borde de entrada (intakeClientMessage): el flujo real cliente→bridge ──

test("intake: JSON malformado se rechaza con reason 'json'", () => {
  const res = intakeClientMessage("{ no es json ]");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "json");
});

test("intake: JSON válido pero no conforme se rechaza con reason 'schema'", () => {
  const res = intakeClientMessage(JSON.stringify({ type: "input", delta: 0.016 }));
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, "schema");
    assert.match(res.error, /inputs/);
  }
});

test("intake: un frame válido devuelve el mensaje tipado listo para enrutar", () => {
  const res = intakeClientMessage(JSON.stringify({ type: "ping" }));
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.msg.type, "ping");
});
