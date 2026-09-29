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
import { makeCtx, makeSocket, porElBorde } from "./helpers.js";

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
  return { pisar, activo };
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
});
