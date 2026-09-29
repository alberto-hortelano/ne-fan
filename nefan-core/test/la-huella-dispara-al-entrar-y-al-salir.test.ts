/** Los triggers de un lugar saltan al entrar en su HUELLA y al salir de ella,
 *  y una huella anidada no saca al jugador de la que la contiene (#465, F1).
 *
 *  Por el camino del bridge (`input` → `activateByPosition`): el jugador está
 *  en la CADENA de huellas que contienen su celda, y `player_entered` /
 *  `player_left` salen del cruce de la cadena vieja con la nueva. Antes el
 *  bridge seguía un solo lugar: al salir a campo abierto no disparaba nada y
 *  el lugar seguía activo, y al entrar en la taberna disparaba el
 *  `player_left` del barrio. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import type { NarrativeEventMessage } from "../src/protocol/messages.js";
import type { SessionStartedMessage } from "../src/protocol/messages.js";
import { entrarEnLaPartida, makeCtx, makeSocket, porElBorde, waitFor } from "./helpers.js";

/** Tile (0,0): barrio [10,10,60,60] con la taberna [20,20,10,10] dentro, y
 *  ningún lugar sin rect (fuera del barrio es campo abierto). Tile (1,0): la
 *  torre [40,40,20,20]. Cada lugar dice «E:<id>» al entrar y «L:<id>» al
 *  salir. */
function montar() {
  const h = makeCtx();
  const { ctx, narrative, broadcasts } = h;
  narrative.startNewSession("plugtest");
  for (const [tx, id] of [[0, "tile_0_0"], [1, "tile_1_0"]] as const) {
    narrative.recordSceneLoaded(
      id,
      expandScenePrimitives({ tile: { tx, ty: 0 }, scene_id: id, scene_description: "campo", biome: "grass", entities: [] }),
      [],
      { activate: tx === 0 },
    );
  }
  const wm = narrative.worldMap;
  const lugar = (id: string, tx: number, rect: [number, number, number, number]) => {
    wm.upsertPlace({ id, kind: "site", parent_id: "world", name: id, anchor: { tx, ty: 0, rect } });
    wm.addTrigger(id, { id: `e_${id}`, when: { type: "player_entered" }, consequences: [{ type: "story_update", delta: `E:${id}` }] });
    wm.addTrigger(id, { id: `l_${id}`, when: { type: "player_left" }, consequences: [{ type: "story_update", delta: `L:${id}` }] });
  };
  lugar("barrio", 0, [10, 10, 60, 60]);
  lugar("taberna", 0, [20, 20, 10, 10]);
  lugar("torre", 1, [40, 40, 20, 20]);

  const { socket } = makeSocket();
  ctx.world.claimForSession(socket, narrative.session_id);
  let visto = 0;
  /** Pisa la celda (col,row) del tile (tx,0) y devuelve los triggers que
   *  saltaron por ese paso, en orden. */
  const pisar = async (tx: number, col: number, row: number): Promise<string[]> => {
    const x = -32 + tx * 64 + col * 0.5 + 0.25;
    const z = -32 + row * 0.5 + 0.25;
    await porElBorde(
      { type: "input", delta: 0.016, inputs: { playerPosition: { x, y: 0, z }, playerForward: { x: 0, y: 0, z: -1 }, playerMoving: true } },
      socket,
      ctx,
    );
    const eventos = broadcasts.filter(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "map_trigger",
    );
    const nuevos = eventos.slice(visto).flatMap((m) => m.consequences.map((c) => String((c as { delta?: string }).delta)));
    visto = eventos.length;
    return nuevos;
  };
  const activo = () => narrative.worldMap.serialize().active_place_id;
  /** Los triggers que saltaron desde la última lectura SIN mover al jugador. */
  const nuevos = (): string[] => {
    const eventos = broadcasts.filter(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "map_trigger",
    );
    const n = eventos.slice(visto).flatMap((m) => m.consequences.map((c) => String((c as { delta?: string }).delta)));
    visto = eventos.length;
    return n;
  };
  return { pisar, activo, nuevos, ctx, narrative };
}

describe("la huella dispara al entrar y al salir (#465, F1)", () => {
  it("anidados: entrar en la taberna NO es salir del barrio, y volver al barrio no es volver a entrar", async () => {
    const { pisar, activo } = montar();
    assert.deepEqual(await pisar(0, 50, 50), ["E:barrio"]);
    assert.deepEqual(await pisar(0, 25, 25), ["E:taberna"], "entrar en la taberna disparó algo más que su entrada");
    assert.equal(activo(), "taberna");
    assert.deepEqual(await pisar(0, 26, 25), [], "moverse dentro de la taberna no dispara nada");
    assert.deepEqual(await pisar(0, 50, 50), ["L:taberna"], "salir de la taberna al barrio dispara solo la salida de la taberna");
    assert.equal(activo(), "barrio");
  });

  it("salir de la huella a campo abierto dispara player_left, y volver a entrar dispara UNA entrada", async () => {
    const { pisar } = montar();
    assert.deepEqual(await pisar(0, 50, 50), ["E:barrio"]);
    assert.deepEqual(await pisar(0, 100, 100), ["L:barrio"], "salir a campo abierto no disparó la salida");
    assert.deepEqual(await pisar(0, 110, 110), [], "andar por campo abierto no dispara nada");
    assert.deepEqual(await pisar(0, 50, 50), ["E:barrio"]);
    assert.deepEqual(await pisar(0, 51, 50), []);
  });

  it("de la taberna a campo abierto se sale de las dos, de dentro afuera", async () => {
    const { pisar } = montar();
    await pisar(0, 50, 50);
    await pisar(0, 25, 25);
    assert.deepEqual(await pisar(0, 100, 100), ["L:taberna", "L:barrio"]);
  });

  it("la torre en su tile: entra al pisarla, sale al dejarla (el caso de la Torre del Hilo)", async () => {
    const { pisar } = montar();
    assert.deepEqual(await pisar(1, 50, 50), ["E:torre"]);
    assert.deepEqual(await pisar(1, 10, 110), ["L:torre"]);
    assert.deepEqual(await pisar(1, 50, 50), ["E:torre"]);
    // Del pie de la torre al barrio del tile vecino: sale de una y entra en el otro.
    assert.deepEqual(await pisar(0, 50, 50), ["L:torre", "E:barrio"]);
  });

  it("el viaje a un lugar realizado dispara EN la llegada, no en el frame siguiente (G2)", async () => {
    const { pisar, nuevos, ctx, narrative } = montar();
    narrative.worldMap.attachRealizedScene("torre", "tile_1_0");
    assert.deepEqual(await pisar(0, 50, 50), ["E:barrio"]);
    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "torre" }, socket, ctx);
    // Ningún `input` todavía: el cliente ni ha aplicado el spawn.
    assert.deepEqual(nuevos(), ["L:barrio", "E:torre"], "la llegada no disparó sus triggers");
    // …y el primer frame en el sitio de llegada (el centro de la huella) no los repite.
    assert.deepEqual(await pisar(1, 50, 50), []);
  });
});

describe("reanudar dentro de una huella no es entrar en ella (#465, G1)", () => {
  it("tras reiniciar el bridge, el primer frame en la posición del save no dispara player_entered", async () => {
    const { ctx, narrative, broadcasts } = makeCtx();
    const { socket, sent } = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await waitFor(() => narrative.hasTile(0, 0));
    await entrarEnLaPartida(ctx, socket, sessionId);
    narrative.worldMap.upsertPlace({
      id: "barrio", kind: "site", parent_id: "world", name: "Barrio", anchor: { tx: 0, ty: 0, rect: [10, 10, 60, 60] },
    });
    narrative.worldMap.addTrigger("barrio", {
      id: "e_barrio", when: { type: "player_entered" }, consequences: [{ type: "story_update", delta: "E:barrio" }],
    });
    const disparos = () =>
      broadcasts
        .filter((m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "map_trigger")
        .flatMap((m) => m.consequences.map((c) => String((c as { delta?: string }).delta)));
    const input = (ws: typeof socket) =>
      porElBorde(
        { type: "input", delta: 0.016, inputs: { playerPosition: { x: -7, y: 0, z: -7 }, playerForward: { x: 0, y: 0, z: -1 }, playerMoving: false } },
        ws,
        ctx,
      );
    // Celda (50,50) del tile (0,0): dentro del barrio.
    await input(socket);
    assert.deepEqual(disparos(), ["E:barrio"], "premisa: entrar en el barrio dispara");
    await ctx.narrative.save();

    // Proceso nuevo: el tracking de posición nace vacío (el de ws-server.ts).
    ctx.posTracking = { cellKey: null, tileKey: null, placeId: null };
    const { socket: s2, sent: sent2 } = makeSocket();
    await porElBorde({ type: "resume_session", requestId: "r2", sessionId }, s2, ctx);
    assert.equal((sent2[0] as SessionStartedMessage).ok, true);
    assert.deepEqual(narrative.player.position.slice(0, 1), [-7], "premisa: la posición del save es la de dentro del barrio");
    await input(s2);
    assert.deepEqual(disparos(), ["E:barrio"], "reanudar disparó otra vez la entrada del lugar donde ya estaba");
  });
});
