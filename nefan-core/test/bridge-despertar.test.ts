/** EL DESPERTAR POR EL BORDE (#613, decisión del usuario: «Que decida el
 *  motor»). Al morir en partida, el bridge pregunta al motor dónde despierta;
 *  el motor aquí es el falso de `makeCtx`, con la respuesta que cada test le
 *  pone. Todo entra por `porElBorde`, como el cliente: la muerte por `input`,
 *  la R por `respawn`, el reanudar por `resume_session` + `session_entered`.
 *
 *  Lo que se afirma es lo que el jugador nota: que despierta DONDE el motor
 *  eligió y el juego aceptó, que no despierta al lado de quien le mató (QA H1,
 *  guion 264), que un fallo se dice y se reintenta, y que una respuesta tardía
 *  de otra partida no mueve a nadie. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { NarrativeAiClient } from "../bridge/context.js";
import type {
  NarrativeStatusMessage,
  SessionStartedMessage,
  ServerMessage,
  StateUpdateMessage,
} from "../src/protocol/messages.js";
import { entrarEnLaPartida, makeCtx, makeSocket, porElBorde, waitFor } from "./helpers.js";
import { dispatchStateRequest } from "../bridge/state-http/dispatch.js";
import type { StateHttpContext } from "../bridge/state-http/context.js";
import { validarDespertarEnElBridge } from "../bridge/handlers/despertar.js";

type Muerte = { muerte: Record<string, unknown> };
type ReportPlayerDeathResult = Awaited<ReturnType<NarrativeAiClient["reportPlayerDeath"]>>;
type Contestar = (payload: { eventId: string; context: unknown }) => Promise<ReportPlayerDeathResult>;

/** Partida con el tile (0,0) servido, un bandido de radio 6 pegado al jugador
 *  y el jugador a un golpe de morir. `contestar` es el motor. */
async function partidaConBandido(contestar?: Contestar) {
  const bundle = makeCtx(contestar ? { ai: { reportPlayerDeath: contestar as NarrativeAiClient["reportPlayerDeath"] } } : {});
  const { ctx, sim, narrative } = bundle;
  const { socket, sent } = makeSocket();
  await porElBorde({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
  const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
  await entrarEnLaPartida(ctx, socket, sessionId);
  await waitFor(() => narrative.hasTile(0, 0));
  await porElBorde(
    {
      type: "add_combatants",
      enemies: [
        {
          id: "bandido_1",
          position: { x: 0, y: 0, z: -1.5 },
          health: 60,
          maxHealth: 60,
          weaponId: "short_sword",
          personality: {
            aggression: 1,
            preferred_attacks: ["quick"],
            reaction_time: 0.1,
            combat_range: 4,
            preferred_distance: 1.5,
            aggro_radius: 6,
          },
        },
      ],
    },
    socket,
    ctx,
  );
  assert.ok(sim.getCombatant("bandido_1"), "premisa: el bandido está en el sim");
  return { ...bundle, socket, sent, sessionId };
}

const quieto = (x = 0, z = 0) => ({
  type: "input" as const,
  delta: 0.05,
  inputs: { playerPosition: { x, y: 0, z }, playerForward: { x: 0, y: 0, z: -1 }, playerMoving: false },
});

/** El bandido mata al jugador por ticks reales. Se para en el frame con el
 *  `died` del jugador, y no mirando su vida: con un motor que contesta al
 *  momento, el despertar ya le ha levantado cuando el bucle vuelve a mirar. */
async function morir(b: Awaited<ReturnType<typeof partidaConBandido>>) {
  b.sim.getCombatant("player")!.health = 1;
  const murio = () =>
    b.sent.some(
      (m) => m.type === "state_update" && m.events.some((e) => e.type === "died" && e.combatantId === "player"),
    );
  for (let i = 0; i < 400 && !murio(); i++) await porElBorde(quieto(), b.socket, b.ctx);
  assert.ok(murio(), "premisa: el bandido mata al jugador (evento died)");
}

const despertares = (sent: ServerMessage[]) =>
  sent.filter((m): m is StateUpdateMessage => m.type === "state_update" && m.reaparicion !== undefined);
const statusDespertar = (msgs: ServerMessage[], phase: string) =>
  msgs.filter(
    (m): m is NarrativeStatusMessage =>
      m.type === "narrative_status" && (m as { kind?: string }).kind === "despertar" && m.phase === phase,
  );

describe("bridge: el despertar lo decide el motor (#613)", () => {
  it("al morir se pregunta al motor, con la muerte en el contexto, y se despierta donde eligió", async () => {
    const b = await partidaConBandido(async () => ({
      ok: true,
      resolucion: {
        wake: { type: "point", x: -20, z: 20 },
        consequences: [{ type: "dialogue", speaker: "Curandera", text: "Despierta, forastero." }],
      },
    }));
    await morir(b);
    await waitFor(() => despertares(b.sent).length > 0);

    assert.equal(statusDespertar(b.broadcasts, "generating").length, 1, "se anuncia que el mundo decide");
    assert.equal(b.aiCalls.death.length, 1);
    const muerte = (b.aiCalls.death[0] as { context: Muerte }).context.muerte;
    const hostiles = muerte.hostiles_vivos as Array<{ id: string; radio_m: number | null; casa: unknown }>;
    assert.deepEqual(hostiles.map((h) => [h.id, h.radio_m, h.casa]), [["bandido_1", 6, { x: 0, z: -1.5 }]]);
    assert.deepEqual(muerte.asesino, { id: "bandido_1", name: "bandido_1" });
    assert.ok(muerte.punto_seguro, "el punto seguro viaja como sugerencia");

    const frame = despertares(b.sent)[0];
    assert.deepEqual(frame.reaparicion, { x: -20, y: 0, z: 20 });
    assert.equal(typeof frame.miradaAlDespertar, "number", "y hacia dónde mira (QA S3)");
    assert.equal(frame.playerHp, 100);
    assert.equal(frame.events[0]?.type, "player_respawned");
    const bandido = b.sim.getCombatant("bandido_1")!;
    assert.deepEqual(bandido.position, { x: 0, y: 0, z: -1.5 }, "te suelta y vuelve a su sitio");
    const evento = b.broadcasts.find((m) => m.type === "narrative_event" && m.eventId.startsWith("despertar_"));
    assert.ok(evento, "las consequences del despertar se difunden");
    const guardado = (await b.storage.read(b.sessionId))!;
    assert.equal(guardado.player.health, 100, "y el despertar llega al disco");
  });

  it("QA H1: despertar al lado del que te mató NO vale — el punto seguro de antes de que llegara, tampoco", async () => {
    // El motor falso por defecto contesta el `punto_seguro`: aquí es el sitio
    // del alta, a 1,5 m del bandido. Es exactamente el guion 264.
    const b = await partidaConBandido();
    await morir(b);
    await waitFor(() => statusDespertar(b.broadcasts, "error").length > 0);
    const [err] = statusDespertar(b.broadcasts, "error");
    assert.match(err.detalleTecnico ?? "", /bandido_1/);
    assert.match(err.message ?? "", /pulsa R/);
    assert.equal(despertares(b.sent).length, 0, "nadie despierta");
    assert.equal(b.sim.getCombatant("player")!.health, 0, "sigue caído");
    assert.equal(b.ctx.despertar.enVuelo, null, "y se puede reintentar");
  });

  it("CB QA H-2: si lo que el motor pone al despertar no cabe, el jugador SIGUE caído y R vale (no en pie sin frame)", async () => {
    const b = await partidaConBandido(async () => ({
      ok: true,
      resolucion: {
        wake: { type: "point", x: -20, z: 20 },
        // 54 m de lado: no cabe alrededor de nadie en un tile de 64.
        consequences: [
          { type: "spawn_entity", entity_kind: "building", name: "Muralla", footprint: [108, 108] },
        ],
      },
    }));
    await morir(b);
    await waitFor(() => statusDespertar(b.broadcasts, "error").length > 0);
    const [err] = statusDespertar(b.broadcasts, "error");
    assert.match(err.message ?? "", /pulsa R/);
    assert.match(err.detalleTecnico ?? "", /no hay sitio en el tile/);
    assert.equal(despertares(b.sent).length, 0, "nadie despierta");
    assert.equal(b.sim.getCombatant("player")!.health, 0, "sigue caído: el sim no lo ha levantado");
    assert.equal(b.ctx.despertar.enVuelo, null, "y R puede reintentar");
    assert.ok(!b.narrative.entities.some((e) => e.data?.name === "Muralla"), "ni el ledger se ha tocado");
  });

  it("un fallo del motor se dice; R reintenta, y con una petición en vuelo no lanza otra", async () => {
    let turno = 0;
    let soltar: (r: ReportPlayerDeathResult) => void = () => {};
    const b = await partidaConBandido(() => {
      turno++;
      if (turno === 1) return Promise.resolve({ ok: false, error: "HTTP 503: sin listener" });
      return new Promise((r) => (soltar = r));
    });
    await morir(b);
    await waitFor(() => statusDespertar(b.broadcasts, "error").length > 0);
    assert.match(statusDespertar(b.broadcasts, "error")[0].detalleTecnico ?? "", /503/);

    await porElBorde({ type: "respawn" }, b.socket, b.ctx);
    assert.equal(b.aiCalls.death.length, 2, "R reintenta");
    const antes = b.sent.length;
    await porElBorde({ type: "respawn" }, b.socket, b.ctx);
    assert.equal(b.aiCalls.death.length, 2, "con una en vuelo no se lanza otra");
    assert.deepEqual(
      statusDespertar(b.sent.slice(antes), "generating").length,
      1,
      "pero se le contesta al que pulsó: el mundo sigue decidiendo",
    );
    soltar({ ok: true, resolucion: { wake: { type: "point", x: -20, z: 20 }, consequences: [] } });
    await waitFor(() => despertares(b.sent).length > 0);
  });

  it("una respuesta de OTRA partida llega tarde y no mueve a nadie", async () => {
    let soltar: (r: ReportPlayerDeathResult) => void = () => {};
    const b = await partidaConBandido(() => new Promise((r) => (soltar = r)));
    await morir(b);
    await waitFor(() => b.aiCalls.death.length === 1);
    // El jugador empieza otra partida mientras el motor piensa.
    const { socket: s2, sent: sent2 } = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r2", gameId: "plugtest" }, s2, b.ctx);
    const nuevo = b.sim.getCombatant("player")!;
    const donde = { ...nuevo.position };
    soltar({ ok: true, resolucion: { wake: { type: "point", x: -20, z: 20 }, consequences: [] } });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(nuevo.position, donde, "el jugador de la partida nueva no se mueve");
    assert.equal(despertares([...b.sent, ...sent2]).length, 0);
  });

  it("reanudar una partida guardada con el jugador caído vuelve a preguntar al entrar", async () => {
    const b = await partidaConBandido(() => new Promise(() => {}));
    await morir(b);
    await waitFor(() => b.aiCalls.death.length === 1);
    const guardado = (await b.storage.read(b.sessionId))!;
    assert.equal(guardado.player.health, 0, "la muerte del jugador se guarda: es lo que vuelve al reanudar");

    // El juego se cerró esperando: el motor sigue pensando la petición vieja.
    const { socket: s2, sent: sent2 } = makeSocket();
    await porElBorde({ type: "resume_session", requestId: "r3", sessionId: b.sessionId }, s2, b.ctx);
    assert.equal((sent2[0] as SessionStartedMessage).ok, true);
    assert.equal(b.aiCalls.death.length, 1, "al reanudar todavía no: el cliente aún no ha entrado");
    await entrarEnLaPartida(b.ctx, s2, b.sessionId);
    assert.equal(b.aiCalls.death.length, 2, "al entrar, sí");
  });

  it("la respuesta VIEJA de la misma partida, tras reanudar, se tira: no es la petición en vuelo", async () => {
    const soltar: Array<(r: ReportPlayerDeathResult) => void> = [];
    const b = await partidaConBandido(() => new Promise((r) => soltar.push(r)));
    await morir(b);
    await waitFor(() => b.aiCalls.death.length === 1);
    const { socket: s2, sent: sent2 } = makeSocket();
    await porElBorde({ type: "resume_session", requestId: "r4", sessionId: b.sessionId }, s2, b.ctx);
    await entrarEnLaPartida(b.ctx, s2, b.sessionId);
    assert.equal(b.aiCalls.death.length, 2, "premisa: al entrar se pregunta otra vez");
    soltar[0]({ ok: true, resolucion: { wake: { type: "point", x: -20, z: 20 }, consequences: [] } });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(b.sim.getCombatant("player")!.health, 0, "la vieja no levanta a nadie");
    assert.equal(despertares([...b.sent, ...sent2]).length, 0);
    soltar[1]({ ok: true, resolucion: { wake: { type: "point", x: -20, z: 20 }, consequences: [] } });
    await waitFor(() => despertares(sent2).length > 0);
    assert.deepEqual(despertares(sent2)[0].reaparicion, { x: -20, y: 0, z: 20 }, "la nueva, sí");
  });

  it("QA S2: un caído no explora — `request_tile` se rechaza y el motor no genera nada (GASTA)", async () => {
    const b = await partidaConBandido(() => new Promise(() => {}));
    await morir(b);
    const escenasAntes = b.aiCalls.scene.length;
    const antes = b.sent.length;
    await porElBorde({ type: "request_tile", tx: 7, ty: 7, reason: "blocking", edge: "east" }, b.socket, b.ctx);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(b.aiCalls.scene.length, escenasAntes, "no se pide escena al motor");
    const [aviso] = statusDespertar(b.sent.slice(antes), "error");
    assert.match(aviso?.message ?? "", /Estás caído: no puedes explorar/);
  });

  it("QA H3: un caído no viaja; el rechazo lleva el lugar del viaje para cerrar su espera", async () => {
    const b = await partidaConBandido(() => new Promise(() => {}));
    await morir(b);
    const antes = b.sent.length;
    await porElBorde({ type: "player_entered_place", placeId: "molino" }, b.socket, b.ctx);
    const [aviso] = statusDespertar(b.sent.slice(antes), "error");
    assert.ok(aviso, "se contesta al que lo pidió");
    assert.match(aviso.message ?? "", /Estás caído: no puedes viajar/);
    assert.equal((aviso as { rechazo?: true }).rechazo, true, "es un rechazo, no el estado del despertar");
    assert.equal((aviso as { placeId?: string }).placeId, "molino");
  });
});

/** La ruta del pre-flight del motor, `POST /despertar/validar`, por el
 *  despachador del State API (el mismo que atiende al servidor HTTP), atada al
 *  mundo del bridge como en `bridge/arranque.ts`. Es la PRIMERA puerta: la
 *  que deja al motor corregir antes de responder. */
describe("State API: POST /despertar/validar", () => {
  async function ruta(body: unknown) {
    const b = await partidaConBandido();
    const state = {
      narrative: b.ctx.narrative,
      validarDespertar: (wake: Parameters<StateHttpContext["validarDespertar"]>[0]) =>
        validarDespertarEnElBridge(b.ctx, wake),
    } as unknown as StateHttpContext;
    return dispatchStateRequest(state, { method: "POST", url: "/despertar/validar", readBody: async () => body });
  }

  it("acepta un punto válido: libre, en un tile que existe y lejos de todo hostil", async () => {
    const r = await ruta({ wake: { type: "point", x: -20, z: 20 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, punto: { x: -20, y: 0, z: 20 } });
    assert.ok(!r.mutated, "validar no escribe el save");
  });

  it("rechaza un punto dentro del radio de un hostil, con el motivo para el motor", async () => {
    const r = await ruta({ wake: { type: "point", x: 2, z: 2 } });
    assert.equal(r.status, 200);
    const cuerpo = r.body as { ok: boolean; motivo?: string };
    assert.equal(cuerpo.ok, false);
    assert.match(cuerpo.motivo ?? "", /bandido_1/);
  });

  it("un cuerpo mal formado falla ALTO (400 con el campo), no con un ok:false que parezca una respuesta", async () => {
    for (const body of [{}, { wake: { type: "tile", tx: 0 } }, { wake: { type: "point", x: 1 } }]) {
      const r = await ruta(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(JSON.stringify(r.body), /wake/, "el error nombra el campo");
    }
    const basura = await ruta("basura");
    assert.equal(basura.status, 400);
    assert.match(JSON.stringify(basura.body), /Expected object/);
  });
});
