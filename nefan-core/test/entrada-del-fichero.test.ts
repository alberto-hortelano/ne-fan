/** Cómo arranca una partida con lo que hay en `world/tile.json` (#578) — la
 *  decisión PURA de `src/world-map/entrada-del-fichero.ts`, sin disco ni
 *  bridge. El camino entero (una llamada al motor, el fichero escrito) lo
 *  mide `test/arranque-con-la-entrada-rota.test.ts`, y el juego el guion 214.
 *
 *  Lo que se sujeta aquí es la tabla: qué CARGA lleva a qué CAMINO, y sobre
 *  todo que una entrada injugable NUNCA lleve a sembrar un mapa — ni cuando
 *  el fichero se contradice, que es error y no bootstrap. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  caminoDeArranque,
  escenasSinLugarEnElMapa,
  planDeEntrada,
  type CargaDelFichero,
} from "../src/world-map/entrada-del-fichero.js";
import { WorldMapManager } from "../src/world-map/world-map.js";
import type { WorldMap } from "../src/world-map/types.js";

function mapaCon(...ids: string[]): WorldMap {
  const wm = new WorldMapManager(WorldMapManager.createEmpty());
  for (const id of ids) {
    wm.upsertPlace({ id, kind: "settlement", name: id, parent_id: wm.serialize().root_id });
  }
  return wm.serialize();
}

/** La carga de una entrada injugable, con el anillo que se le pase. */
function entradaInjugable(
  over: Partial<Extract<CargaDelFichero<never>, { kind: "entrada-injugable" }>> = {},
): Extract<CargaDelFichero<never>, { kind: "entrada-injugable" }> {
  return {
    kind: "entrada-injugable",
    motivo: "la escena \"tile_0_0\" no pasa el validador de hoy",
    worldMap: mapaCon("aldea", "molino"),
    anillo: { tile_1_0: { place_id: "aldea" }, tile_0_1: {} },
    entradaVieja: { place_id: "aldea" },
    entrySceneId: "tile_0_0",
    ...over,
  };
}

describe("caminoDeArranque: qué carga lleva a qué camino", () => {
  it("sin mundo en disco (ausente o stale) ⇒ sembrar, sin aviso", () => {
    assert.deepEqual(caminoDeArranque({ kind: "sin-mundo" }), { camino: "sembrar" });
  });

  it("fichero ilegible ⇒ sembrar, DICIENDO por qué no se sirvió", () => {
    assert.deepEqual(caminoDeArranque({ kind: "ilegible", motivo: "json roto" }), {
      camino: "sembrar",
      aviso: "json roto",
    });
  });

  it("mundo servible ⇒ replay del MISMO snapshot, sin motor", () => {
    const snapshot = { marca: 1 };
    const c = caminoDeArranque({ kind: "servible", snapshot });
    assert.equal(c.camino, "replay");
    assert.equal(c.camino === "replay" ? c.snapshot : null, snapshot);
  });

  it("entrada injugable ⇒ la entrada en el mapa DEL FICHERO, con su lugar, su anillo y su motivo", () => {
    const carga = entradaInjugable();
    const c = caminoDeArranque(carga);
    assert.equal(c.camino, "entrada-en-el-mapa-del-fichero");
    if (c.camino !== "entrada-en-el-mapa-del-fichero") return;
    assert.equal(c.motivo, carga.motivo);
    assert.equal(c.plan.placeId, "aldea");
    assert.equal(c.plan.entrySceneId, "tile_0_0");
    assert.equal(c.plan.worldMap, carga.worldMap, "el mapa del plan es el del fichero, no uno nuevo");
    assert.equal(c.plan.anillo, carga.anillo);
  });

  it("entrada injugable en un fichero que se contradice ⇒ ERROR, nunca sembrar", () => {
    const c = caminoDeArranque(entradaInjugable({ anillo: { tile_1_0: { place_id: "lugar_que_ya_no_existe" } } }));
    assert.equal(c.camino, "error");
    assert.match(c.camino === "error" ? c.motivo : "", /lugar_que_ya_no_existe/);
  });
});

describe("planDeEntrada: lo que el fichero tiene que cumplir", () => {
  it("un mapa SIN lugares no es error: el plan va sin lugar (no hay a dónde viajar)", () => {
    const r = planDeEntrada(entradaInjugable({ worldMap: mapaCon(), anillo: {}, entradaVieja: {} }));
    assert.equal(r.ok, true);
    assert.equal(r.ok ? r.plan.placeId : "?", null);
  });

  it("la entrada vieja declara un lugar que su mapa no tiene ⇒ error que lo nombra", () => {
    const r = planDeEntrada(entradaInjugable({ entradaVieja: { place_id: "posada_perdida" } }));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.motivo, /posada_perdida/);
    assert.match(r.ok ? "" : r.motivo, /no se puede atar a su mapa/);
  });

  it("la entrada vieja no declara lugar y el mapa sí tiene ⇒ error (el panel saldría vacío)", () => {
    const r = planDeEntrada(entradaInjugable({ entradaVieja: {} }));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.motivo, /no declara place_id/);
  });

  it("el anillo cuelga de lugares que su mapa no tiene ⇒ error con escenas, lugares y cuántas", () => {
    const r = planDeEntrada(
      entradaInjugable({
        anillo: {
          tile_1_0: { place_id: "fantasma" },
          tile_0_1: { place_id: "fantasma" },
          tile_1_1: { place_id: "aldea" },
        },
      }),
    );
    assert.equal(r.ok, false);
    const motivo = r.ok ? "" : r.motivo;
    assert.match(motivo, /se contradice: 2 escena\(s\)/);
    assert.match(motivo, /"fantasma"/);
    assert.ok(motivo.includes("tile_1_0") && motivo.includes("tile_0_1"), motivo);
    assert.ok(!motivo.includes("tile_1_1"), `nombra una escena sana: ${motivo}`);
  });

  it("la entrada no es el tile (0,0) ⇒ error: no se sabe dónde regenerarla", () => {
    const r = planDeEntrada(entradaInjugable({ entrySceneId: "tile_2_0" }));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.motivo, /"tile_2_0" y no "tile_0_0"/);
  });

  it("no toca el mapa que recibe (resuelve el lugar sobre una copia)", () => {
    const carga = entradaInjugable();
    const antes = structuredClone(carga.worldMap);
    planDeEntrada(carga);
    assert.deepEqual(carga.worldMap, antes);
  });
});

describe("escenasSinLugarEnElMapa", () => {
  it("nombra escena y lugar, y no se inventa ninguna", () => {
    const mapa = mapaCon("aldea");
    const colgando = escenasSinLugarEnElMapa(
      {
        tile_0_0: { place_id: "aldea" },
        tile_1_0: { place_id: "molino_que_ya_no_existe" },
        tile_0_1: { place_id: "" },
        tile_1_1: {},
        tile_2_0: { place_id: 7 },
      },
      mapa,
    );
    assert.deepEqual(colgando, [{ sceneId: "tile_1_0", placeId: "molino_que_ya_no_existe" }]);
    // Un tile sin `place_id` NO cuelga: campo ausente, vacío o de otro tipo es
    // «esta escena no declara lugar», que es legítimo y es la mayoría.
    assert.deepEqual(escenasSinLugarEnElMapa({ a: {}, b: { place_id: "aldea" } }, mapa), []);
    // Y un mapa sin lugares los cuelga a todos.
    assert.equal(escenasSinLugarEnElMapa({ a: { place_id: "aldea" } }, mapaCon()).length, 1);
  });
});
