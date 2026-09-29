/** Los hooks de plugins que el bridge cablea en su State API
 *  (`bridge/hooks-de-plugins.ts`, #769). Hasta #769 vivían dentro de
 *  `ws-server.ts` y no los ejercía nadie: el doble de `test/helpers.ts`
 *  registraba sin avisar al jugador y sin la guarda de fixture de
 *  `inspeccionarPlugin`. Aquí se miden los CUATRO desenlaces por lo que llega
 *  al socket suscrito, que es lo que ve el cliente. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { hooksDePluginsDelBridge } from "../bridge/hooks-de-plugins.js";
import { makeCtx, makeSocket } from "./helpers.js";
import type { ServerMessage } from "../src/protocol/messages.js";

const CONTADOR = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("fixtures/games/plugtest/plugins/test_counter.json", import.meta.url)),
    "utf-8",
  ),
) as Record<string, unknown>;

/** v2 del contador con la cadena `migrate[1]`, del autor que se pida. */
function contadorV2(author: "developer" | "narrative_engine"): Record<string, unknown> {
  return {
    ...CONTADOR,
    version: 2,
    description: "Contador v2: el valor se llama hits.",
    origin: { author, rationale: "evolución de prueba" },
    slice: { schema: { type: "object" }, initial: { hits: 0 } },
    events_consumed: [{ type: "counter_inc", do: [{ op: "inc", path: "slice.hits", value: 1 }] }],
    events_produced: [],
    migrate: {
      "1": [
        { op: "set", path: "slice.hits", value: "slice.count" },
        { op: "remove", path: "slice.count" },
      ],
    },
    fixtures: [{ before: { hits: 4 }, event: { type: "counter_inc" }, after: { hits: 5 } }],
  };
}

function conSesion() {
  const h = makeCtx();
  h.narrative.startNewSession("plugtest");
  return { ...h, hooks: hooksDePluginsDelBridge(h.ctx) };
}

const status = (m: ServerMessage[]) => m.filter((x) => x.type === "narrative_status");
const eventos = (m: ServerMessage[]) => m.filter((x) => x.type === "narrative_event");

describe("hooks de plugins del bridge (#769)", () => {
  it("un plugin NUEVO: status ready de kind `plugin`, sellado con la sesión, y ningún evento", () => {
    const { hooks, broadcasts, narrative } = conSesion();
    const body = hooks.register(CONTADOR);
    assert.equal(body.action, "created");
    const [s, ...resto] = status(broadcasts);
    assert.deepEqual(resto, []);
    assert.equal(s.type === "narrative_status" && s.phase, "ready");
    assert.equal(s.type === "narrative_status" && s.kind, "plugin");
    assert.match(String(s.type === "narrative_status" && s.message), /^Plugin activado: test_counter \([0-9a-f]{12}…\)$/);
    assert.equal((s as { sessionId?: string }).sessionId, narrative.session_id, "difundido por el verbo que sella");
    assert.deepEqual(eventos(broadcasts), [], "activar no cambia nada con lo que el jugador ya tratase");
  });

  it("el MISMO manifest otra vez: `unchanged`, lo dice el status y tampoco hay evento", () => {
    const { hooks, broadcasts } = conSesion();
    hooks.register(CONTADOR);
    broadcasts.length = 0;
    assert.equal(hooks.register(CONTADOR).action, "unchanged");
    assert.deepEqual(
      status(broadcasts).map((s) => s.type === "narrative_status" && s.message),
      ["Plugin ya activo: test_counter v1"],
    );
    assert.deepEqual(eventos(broadcasts), []);
  });

  it("el motor TOMA un plugin del juego: el status lo dice y el feed de eventos avisa de que manda el motor", () => {
    const { hooks, broadcasts } = conSesion();
    hooks.register(CONTADOR); // origin.author = developer: el shipped
    broadcasts.length = 0;
    const body = hooks.register(contadorV2("narrative_engine"));
    assert.equal(body.action, "migrated");
    assert.deepEqual(
      status(broadcasts).map((s) => s.type === "narrative_status" && [s.kind, s.message]),
      [["plugin", "Plugin evolucionado: test_counter v1→v2 (sustituye al de disco)"]],
    );
    const ev = eventos(broadcasts);
    assert.equal(ev.length, 1, "la migración llega A LA PANTALLA por el feed de eventos");
    const e = ev[0];
    assert.ok(e.type === "narrative_event");
    assert.equal(e.eventId, "plugin_register");
    assert.deepEqual(e.consequences, []);
    assert.deepEqual(e.effects, [
      {
        kind: "ambient_message",
        message:
          "⚙️ el sistema «test_counter» ha cambiado de versión (v1 → v2)" +
          " — a partir de ahora manda la del motor narrativo, no la del juego",
      },
    ]);
  });

  it("evolucionar un plugin del PROPIO motor: aviso sin la coletilla del de disco", () => {
    const { hooks, broadcasts } = conSesion();
    hooks.register({ ...CONTADOR, origin: { author: "narrative_engine", rationale: "del motor" } });
    broadcasts.length = 0;
    assert.equal(hooks.register(contadorV2("narrative_engine")).action, "migrated");
    assert.deepEqual(
      status(broadcasts).map((s) => s.type === "narrative_status" && s.message),
      ["Plugin evolucionado: test_counter v1→v2"],
    );
    const [e] = eventos(broadcasts);
    assert.ok(e?.type === "narrative_event");
    assert.deepEqual(e.effects, [
      { kind: "ambient_message", message: "⚙️ el sistema «test_counter» ha cambiado de versión (v1 → v2)" },
    ]);
  });

  it("list e inspect leen el registry del ctx, e inspect respeta la guarda de fixture", () => {
    const { hooks, ctx } = conSesion();
    const { id } = hooks.register(CONTADOR);
    assert.deepEqual(
      hooks.list().map((p) => [p.name, p.version, p.origin_author]),
      [["test_counter", 1, "developer"]],
    );
    assert.ok(hooks.inspect(id));
    // Con una escena de prueba delante, los sistemas de la partida no corren:
    // el doble viejo se saltaba esto y contestaba como si nada.
    const { socket } = makeSocket();
    assert.equal(ctx.world.claimForFixture(socket), true);
    assert.throws(() => hooks.inspect(id), /escena de prueba/);
  });

  it("un registro que falla no difunde nada: el error vuelve al motor por el State API", () => {
    const { hooks, broadcasts } = conSesion();
    assert.throws(() => hooks.register({}), /manifest inválido/);
    assert.deepEqual(broadcasts, []);
  });
});
