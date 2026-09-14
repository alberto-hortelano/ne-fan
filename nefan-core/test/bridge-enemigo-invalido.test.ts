/** UN ENEMIGO INVÁLIDO YA NO TUMBA EL FRAME (#529), y por las DOS puertas.
 *
 *  El criterio no cambia —`parseHostileCombat`, el mismo que aplica el
 *  cliente— y su tabla vive en `test/hostil-desde-combat.test.ts`. Lo que aquí
 *  se mide es el desenlace completo sobre el bridge REAL: el frame entra por
 *  `intakeClientMessage` (serializado, como llega del socket), lo enruta
 *  `routeMessage`, y se afirman a la vez las tres cosas del criterio de
 *  aceptación — **los dos buenos ALTA, el malo NO, y el motivo en el canal**.
 *
 *  Hasta el 2026-09-14 el criterio vivía dentro del intake, así que el frame
 *  no llegaba al handler: se descartaba ENTERO —los dos buenos con él— y el
 *  jugador recibía un `kind:"protocolo"`, que `rotuloDeStatus` convierte en un
 *  modal a pantalla completa («Fallo interno del juego») encima de la partida.
 *  El cliente, con el MISMO criterio, descartaba un enemigo y seguía.
 *
 *  Los DOS handlers, no uno: `add_combatants` (el tile que el cliente acaba de
 *  cargar) y `load_room` (el selector «Room»). Olvidarse de uno es justo el
 *  fallo que un test de una sola puerta no ve. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { combatForHostileRole } from "../src/combat/hostiles.js";
import { rotuloDeStatus } from "../src/protocol/status-rotulo.js";
import type { EnemyPersonality } from "../src/types.js";
import type { NarrativeStatusMessage, ServerMessage } from "../src/protocol/messages.js";
import { capturarLogDelBridge, makeCtx, makeSocket, porElBorde } from "./helpers.js";

const DERIVADO = combatForHostileRole("hostile")!;

const bueno = (id: string) => ({
  id,
  position: { x: 3, y: 0, z: 4 },
  health: DERIVADO.health,
  maxHealth: DERIVADO.max_health,
  weaponId: DERIVADO.weapon_id,
  personality: DERIVADO.personality as unknown as EnemyPersonality,
});

/** El malo: tipo correcto, valor imposible — uno de los seis que el borde
 *  ACEPTABA antes de la PR 6 de #241, y que hoy el parser rechaza. */
const roto = (id: string) => ({
  ...bueno(id),
  personality: { ...DERIVADO.personality, preferred_attacks: [] } as unknown as EnemyPersonality,
});

const MOTIVO = "combat.personality.preferred_attacks no es una lista de ataques no vacía";

const statusDeError = (sent: ServerMessage[]): NarrativeStatusMessage[] =>
  sent.filter(
    (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
  );

/** El lote del criterio de aceptación: **uno malo entre dos buenos**. Con un
 *  solo elemento, «se cae él» y «se cae el lote» son indistinguibles. */
const LOTE = [bueno("lobo_1"), roto("roto_2"), bueno("lobo_3")];

describe("un enemigo inválido se cae SOLO ÉL: add_combatants", () => {
  it("los dos buenos entran al sim y al store, el malo no, y el motivo llega al log y al jugador", async () => {
    const { ctx, sim, store } = makeCtx();
    const { socket, sent } = makeSocket();
    const log = capturarLogDelBridge();
    try {
      await porElBorde({ type: "add_combatants", enemies: LOTE }, socket, ctx);
    } finally {
      log.soltar();
    }

    // 1 · los DOS buenos, dados de alta y con sus números.
    assert.ok(sim.getCombatant("lobo_1"), "el primer enemigo bueno entra");
    assert.ok(sim.getCombatant("lobo_3"), "…y el que venía DETRÁS del malo también");
    assert.equal(sim.getCombatant("lobo_1")!.health, DERIVADO.health);
    assert.equal(sim.getCombatant("lobo_1")!.maxHealth, DERIVADO.max_health);
    // 2 · el malo, no.
    assert.equal(sim.getCombatant("roto_2"), undefined, "el enemigo inválido NO entra al sim");
    assert.deepEqual(
      store.state.enemies.map((e) => e.id),
      ["lobo_1", "lobo_3"],
      "y tampoco se proyecta al store: el cliente no puede pintar una barra de alguien que no existe",
    );

    // 3 · el motivo, en los dos canales: el diagnóstico técnico al log del
    // bridge (con el id de QUIÉN, que es lo que el guion 90 compara contra el
    // registro del cliente) y el aviso para quien juega al socket que lo mandó.
    assert.ok(
      log.lineas.some((l) => l.includes('enemigo "roto_2" descartado') && l.includes(MOTIVO)),
      `el log del bridge no nombra al descartado con su motivo: ${log.lineas.join(" | ")}`,
    );
    const errores = statusDeError(sent);
    assert.equal(errores.length, 1, `un aviso y solo uno: ${JSON.stringify(errores)}`);
    assert.equal(errores[0].kind, "combatientes");
    assert.equal(
      errores[0].message,
      `Enemigos que no entraron al mundo (1 de 3): «roto_2» (${MOTIVO})`,
    );

    // 4 · SIN MODAL. Es la mitad del criterio que no se ve en el `kind`: lo
    // que decide si tapa la pantalla es `rotuloDeStatus`, y se le pregunta con
    // el peor contexto posible (mundo vacío) para que el verde no dependa de
    // que el test tenga mundo pintado.
    assert.equal(
      errores.some((m) => m.kind === "protocolo"),
      false,
      "el frame ya no se rechaza entero: nada de `protocolo`",
    );
    const rotulo = rotuloDeStatus(errores[0], { mundoVacio: true, overlayAbierto: true });
    assert.equal(rotulo.destino, "log", `el aviso tapa la pantalla: ${JSON.stringify(rotulo)}`);
    assert.equal(rotulo.detalle, errores[0].message);

    // 5 · y la partida sigue contestando lo de siempre.
    assert.ok(
      sent.some((m) => m.type === "state_update"),
      "el handler sigue contestando su state_update",
    );
  });

  it("un lote entero bueno no manda ningún aviso (sin esto, el candado no distingue «avisa» de «avisa siempre»)", async () => {
    const { ctx, sim } = makeCtx();
    const { socket, sent } = makeSocket();
    await porElBorde({ type: "add_combatants", enemies: [bueno("lobo_1"), bueno("lobo_3")] }, socket, ctx);
    assert.ok(sim.getCombatant("lobo_1") && sim.getCombatant("lobo_3"));
    assert.deepEqual(statusDeError(sent), []);
  });
});

describe("un enemigo inválido se cae SOLO ÉL: load_room", () => {
  it("la OTRA puerta hace exactamente lo mismo con el mismo lote", async () => {
    const { ctx, sim, store } = makeCtx();
    const { socket, sent } = makeSocket();
    const log = capturarLogDelBridge();
    try {
      await porElBorde({ type: "load_room", roomId: "robledo_tile", enemies: LOTE }, socket, ctx);
    } finally {
      log.soltar();
    }

    assert.ok(sim.getCombatant("lobo_1") && sim.getCombatant("lobo_3"), "los dos buenos entran");
    assert.equal(sim.getCombatant("roto_2"), undefined, "el inválido no");
    assert.deepEqual(store.state.enemies.map((e) => e.id), ["lobo_1", "lobo_3"]);
    assert.ok(
      log.lineas.some((l) => l.includes('enemigo "roto_2" descartado') && l.includes(MOTIVO)),
      `el log del bridge no nombra al descartado con su motivo: ${log.lineas.join(" | ")}`,
    );
    const errores = statusDeError(sent);
    assert.equal(errores.length, 1, `un aviso y solo uno: ${JSON.stringify(errores)}`);
    assert.equal(errores[0].kind, "combatientes");
    assert.equal(
      errores[0].message,
      `Enemigos que no entraron al mundo (1 de 3): «roto_2» (${MOTIVO})`,
    );
    assert.equal(
      rotuloDeStatus(errores[0], { mundoVacio: true, overlayAbierto: true }).destino,
      "log",
    );
    // La sala se carga igual: el player se siembra y el cliente recibe su
    // estado. Un `load_room` que se cayera con el enemigo malo dejaría al
    // jugador sin sala, que es el desenlace que esta PR retira.
    assert.ok(sim.getCombatant("player"), "el jugador se siembra igual");
    assert.ok(sent.some((m) => m.type === "state_update"));
  });

  it("una sala sin enemigos malos no manda ningún aviso", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await porElBorde({ type: "load_room", roomId: "robledo_tile", enemies: [bueno("lobo_1")] }, socket, ctx);
    assert.deepEqual(statusDeError(sent), []);
  });
});
