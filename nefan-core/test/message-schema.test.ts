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
          maxHealth: 100,
          weaponId: "short_sword",
          // `combat_range` va porque desde la PR 6 de #241 el borde aplica el
          // criterio ÚNICO (`parseHostileCombat`), que es el del cliente y lo
          // exige. Antes este zod lo tenía por opcional y esta fixture pasaba:
          // era el segundo criterio, y ningún productor real emite una
          // personalidad sin él (`combatForHostileRole` siempre lo pone).
          personality: {
            aggression: 0.5,
            preferred_attacks: ["quick"],
            reaction_time: 0.3,
            combat_range: 4,
          },
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

/** EL INTAKE MIRA LA FORMA DEL FRAME, NO LA VALIDEZ DE CADA ENEMIGO (#529).
 *
 *  Estos dos tests sustituyen a «add_combatants con enemigo sin personality se
 *  rechaza», que afirmaba lo contrario y era CIERTO del 2026-09-07 al 09-14:
 *  el criterio vivía en el `superRefine` de `EnemySpawnSchema`, así que un
 *  enemigo malo tumbaba el frame entero y el jugador se comía un modal de
 *  «Fallo interno del juego» — mientras su propio cliente, con el MISMO
 *  criterio, descartaba ese enemigo y seguía con los demás.
 *
 *  El aserto no desaparece, se muda: el veredicto y el motivo de ese mismo
 *  bloque los sigue afirmando `test/hostil-desde-combat.test.ts` (tabla de las
 *  dos puertas, hoy sobre `cribarHostiles`), y el DESENLACE —dos entran, uno
 *  no, el motivo al log y al jugador— lo afirma
 *  `test/bridge-enemigo-invalido.test.ts` sobre los dos handlers reales. Lo
 *  que se mide AQUÍ es que aflojar el intake no lo dejó sin puerta. */
test("add_combatants con un enemigo INVÁLIDO pasa el intake: el desenlace es del handler (#529)", () => {
  const res = validateContract(ClientMessageSchema, {
    type: "add_combatants",
    enemies: [
      { id: "g", position: { x: 0, y: 0, z: 0 }, health: 10, maxHealth: 60, weaponId: "unarmed" },
    ],
  });
  assert.equal(res.ok, true, res.ok ? "" : res.error);
});

test("…pero un enemigo sin id o sin position SÍ lo rechaza: eso es un frame ilegible", () => {
  // La otra mitad del gate, y la que justifica que `id` y `position` sigan
  // llevando zod de verdad mientras los cuatro del bloque `combat` solo
  // declaran su tipo: sin ellos no hay a quién dar de alta ni dónde, así que
  // no hay criba posible — no es un enemigo malo, es un frame que no se puede
  // leer, y ése sí se contesta con `kind:"protocolo"`.
  const personality = { aggression: 0.5, preferred_attacks: ["quick"], reaction_time: 0.3, combat_range: 4 };
  const sinId = validateContract(ClientMessageSchema, {
    type: "add_combatants",
    enemies: [{ position: { x: 0, y: 0, z: 0 }, health: 10, maxHealth: 60, weaponId: "unarmed", personality }],
  });
  assert.equal(sinId.ok, false);
  if (!sinId.ok) assert.match(sinId.error, /enemies\[0\]\.id/);

  const sinPosition = validateContract(ClientMessageSchema, {
    type: "add_combatants",
    enemies: [{ id: "g", health: 10, maxHealth: 60, weaponId: "unarmed", personality }],
  });
  assert.equal(sinPosition.ok, false);
  if (!sinPosition.ok) assert.match(sinPosition.error, /enemies\[0\]\.position/);

  // Y en `load_room`, que es la otra puerta con enemigos: el gate de forma es
  // el mismo schema, y comprobarlo en una sola de las dos no distinguiría
  // «las dos puertas lo miran» de «una lo mira».
  const room = validateContract(ClientMessageSchema, {
    type: "load_room",
    roomId: "robledo_tile",
    enemies: [{ id: "g", position: { x: 0, y: 0, z: "lejos" }, health: 10, maxHealth: 60, weaponId: "unarmed", personality }],
  });
  assert.equal(room.ok, false);
  if (!room.ok) assert.match(room.error, /enemies\[0\]\.position\.z/);
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
