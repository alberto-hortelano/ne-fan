/** `tile_analysis`: el cliente clasifica por visión lo que está PINTADO en un
 *  tile y lo manda para que el bridge lo persista. No es solo persistencia
 *  pasiva — los rects sólidos entran en la colisión server-side de los NPCs
 *  (`sim-collision.ts`, fuente 3), así que un análisis que no se guarda o que
 *  no invalida el collider cacheado deja a los NPCs atravesando lo que el
 *  jugador ve macizo.
 *
 *  Estaba con CERO cobertura: el handler es el único punto donde coincidían el
 *  backlog escrito ("sin tests") y el medido (CRAP con 0%). Su fallo no se ve
 *  como un error sino como "los NPCs se comportan raro", que es la peor forma
 *  de fallar. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../bridge/router.js";
import { intakeClientMessage } from "../bridge/message-intake.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { TileAnalysisMessage } from "../src/protocol/messages.js";
import { makeCtx, makeSocket } from "./helpers.js";

/** Tile (0,0) registrado en el bridge. Su rect de mundo es [-32,32]² (64 m
 *  centrados en el origen), que es el marco de todas las coordenadas de abajo. */
function seedTile00(narrative: NarrativeState): void {
  narrative.startNewSession("plugtest");
  narrative.recordSceneLoaded(
    "tile_0_0",
    expandScenePrimitives({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      biome: "grass",
      scene_description: "campo de bench",
      terrain_features: [],
      entities: [],
      ambient_event: "",
    }),
  );
}

/** Un muro macizo de 4×4 m alrededor de (6, 6). */
function muroEn(minX = 4, minZ = 4): TileAnalysisMessage {
  return {
    type: "tile_analysis",
    tx: 0,
    ty: 0,
    elements: [
      {
        label: "muro de piedra",
        solid: true,
        tall: true,
        rect: { minX, maxX: minX + 4, minZ, maxZ: minZ + 4 },
      },
    ],
  };
}

describe("bridge tile_analysis", () => {
  it("persiste el análisis EN DISCO, no solo en memoria", async () => {
    const { ctx, narrative, storage } = makeCtx();
    seedTile00(narrative);
    const { socket } = makeSocket();

    await routeMessage(muroEn(), socket, ctx);

    const rec = narrative.scenes_loaded["tile_0_0"];
    assert.equal(rec.analysis?.elements.length, 1, "en memoria");
    assert.equal(rec.analysis?.elements[0].label, "muro de piedra");
    assert.match(rec.analysis?.analyzed_at ?? "", /^\d{4}-\d{2}-\d{2}T/, "sella la fecha de análisis en ISO");

    // Que esté en el save es lo que separa "lo aplicó" de "lo guardó": el
    // bridge es el único escritor, y sin el save el resume pierde el análisis
    // y con él la colisión de ese tile.
    const guardado = await storage.read(narrative.session_id);
    const recGuardado = guardado?.scenes_loaded?.["tile_0_0"] as { analysis?: unknown } | undefined;
    assert.ok(recGuardado?.analysis, "el análisis viaja al save");
  });

  it("invalida la colisión cacheada: lo pintado macizo pasa a bloquear a los NPCs", async () => {
    const { ctx, narrative } = makeCtx();
    seedTile00(narrative);
    const { socket } = makeSocket();

    // Consultar ANTES cachea el collider del tile sin análisis. Este orden es
    // el que da valor al test: sin `invalidate` el bridge seguiría sirviendo
    // este collider viejo y el muro no existiría para los NPCs.
    assert.equal(ctx.simCollision.blocksCircle(6, 6, 0.3), false, "campo abierto antes");

    await routeMessage(muroEn(), socket, ctx);

    assert.equal(ctx.simCollision.blocksCircle(6, 6, 0.3), true, "el muro bloquea después");
    assert.equal(ctx.simCollision.blocksCircle(-6, -6, 0.3), false, "y solo donde está");
  });

  it("un elemento NO sólido se persiste pero no bloquea", async () => {
    const { ctx, narrative } = makeCtx();
    seedTile00(narrative);
    const { socket } = makeSocket();
    const charco = muroEn();
    charco.elements[0] = { ...charco.elements[0], label: "charco", solid: false, tall: false };

    await routeMessage(charco, socket, ctx);

    assert.equal(narrative.scenes_loaded["tile_0_0"].analysis?.elements.length, 1, "se guarda");
    assert.equal(ctx.simCollision.blocksCircle(6, 6, 0.3), false, "pero no es obstáculo");
  });

  it("análisis de un tile que el bridge no registró: se ignora sin tocar el save", async () => {
    const { ctx, narrative, storage } = makeCtx();
    seedTile00(narrative);
    const { socket } = makeSocket();

    // Caso real: el cliente analiza una fixture local que el bridge nunca vio.
    await routeMessage({ ...muroEn(), tx: 9, ty: 9 }, socket, ctx);

    assert.equal(narrative.scenes_loaded["tile_9_9"], undefined, "no inventa el tile");
    const guardado = await storage.read(narrative.session_id);
    assert.equal(guardado, null, "no se guarda nada: no había qué persistir");
  });

  it("coordenadas no enteras: rechazadas sin tocar el estado", async () => {
    const { ctx, narrative } = makeCtx();
    seedTile00(narrative);
    const { socket } = makeSocket();

    // El zod del borde acepta `z.number()`, así que un 0.5 LLEGA hasta aquí.
    // Lo que se fija es el RESULTADO, no qué capa lo para: la guarda
    // `Number.isInteger` del handler resultó redundante (mutarla a `false` no
    // rompe este test) porque `tileKey` no redondea — "tile_0.5_0" no existe y
    // el lookup rechaza igual. Se queda por el log, que sí distingue "inválido"
    // de "no registrado"; si algún día `tileKey` normalizara coordenadas, la
    // guarda pasaría a ser la única defensa y este test la cubriría.
    await routeMessage({ ...muroEn(), tx: 0.5 }, socket, ctx);

    assert.equal(narrative.scenes_loaded["tile_0_0"].analysis, undefined, "sin análisis");
    assert.equal(ctx.simCollision.blocksCircle(6, 6, 0.3), false, "sin colisión nueva");
  });

  it("elements que no es lista: lo para el BORDE, no el handler", () => {
    // El handler comprueba `Array.isArray(msg.elements)`, pero por el camino
    // real (WS) esa rama es inalcanzable: el zod del borde ya rechaza el frame.
    // Se ata aquí para que quede dicho dónde está la defensa de verdad — si
    // alguien afloja el esquema, este test cae y no la guarda del handler.
    const res = intakeClientMessage(JSON.stringify({ ...muroEn(), elements: "no soy una lista" }));
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "schema");
  });
});
