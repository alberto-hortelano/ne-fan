import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { huellaDeEscena, separarSalidas } from "../src/protocol/escena-servida.js";
import type { EscenaServida, SceneExit } from "../src/protocol/messages.js";

/** Una escena servida como la compone `alWire`: una world scene del tile (0,0)
 *  con un hostil (su `combat` lo deriva core) más las salidas del lugar encima.
 *  Literal y sin importar NADA de `scene-normalize` (ni un tipo): este módulo
 *  tiene su propia batería y no debe pagar la de la conversión (candado de
 *  baterías de mutación, que cuenta también los `import type`). */
function servida(exits: SceneExit[], over: Partial<EscenaServida> = {}): EscenaServida {
  return {
    scene_id: "tile_0_0",
    scene_description: "Un claro con un bandido.",
    dimensions: { width: 64, depth: 64, height: 3 },
    world_rect: { minX: -32, minZ: -32, maxX: 32, maxZ: 32 },
    tile: { tx: 0, ty: 0 },
    terrain: { color: [0.18, 0.22, 0.14] },
    terrain_grid: { grid: ["gg", "gg"], cols: 2, rows: 2, meters_per_cell: 0.5, origin: [-32, -32], solid_chars: ["W", "w"] },
    objects: [],
    npcs: [
      {
        id: "bandido_1",
        name: "Bandido",
        position: [-26.75, 0, -26.75],
        role: "hostile",
        combat: { health: 40, max_health: 40, weapon_id: "short_sword", personality: { aggression: 0.7 } },
      },
    ],
    __player_start: null,
    ...over,
    exits,
  };
}

const FORJA: SceneExit = { place_id: "forja", name: "La Forja", link_kind: "road", edge: "east" };
const MOLINO: SceneExit = { place_id: "molino", name: "El Molino", link_kind: "path", edge: "west" };

describe("separarSalidas — el overlay del wire se separa en la frontera (#410)", () => {
  it("la escena sale SIN `exits` y las salidas salen aparte, tal cual llegaron", () => {
    const s = servida([FORJA, MOLINO]);
    const { escena, exits } = separarSalidas(s);
    assert.equal("exits" in escena, false, "la clave no puede quedar ni con undefined: entraría en la huella");
    assert.deepEqual(exits, [FORJA, MOLINO]);
    // El resto de la escena viaja entero: mismos miembros que la servida menos uno.
    assert.deepEqual(Object.keys(escena).sort(), Object.keys(s).filter((k) => k !== "exits").sort());
  });

  it("no muta la servida: lo que llegó del wire sigue llevando sus salidas", () => {
    const s = servida([FORJA]);
    separarSalidas(s);
    assert.deepEqual(s.exits, [FORJA]);
  });
});

describe("huellaDeEscena — las salidas no caben en la huella; la geometría y el estado sí", () => {
  it("dos servidas iguales con salidas DISTINTAS tienen la misma huella (el caso de `exits_changed`)", () => {
    const a = huellaDeEscena(separarSalidas(servida([FORJA])).escena);
    const b = huellaDeEscena(separarSalidas(servida([FORJA, MOLINO])).escena);
    const c = huellaDeEscena(separarSalidas(servida([])).escena);
    assert.equal(a, b);
    assert.equal(a, c);
  });

  // Los negativos: sin ellos «misma huella» no distingue la regla de una
  // huella constante que lo iguala todo.
  it("un terrain_grid distinto → huella distinta", () => {
    const base = separarSalidas(servida([FORJA])).escena;
    const conAgua = separarSalidas(
      servida([FORJA], { terrain_grid: { grid: ["gg", "gw"], cols: 2, rows: 2, meters_per_cell: 0.5, origin: [-32, -32], solid_chars: ["W", "w"] } }),
    ).escena;
    assert.notEqual(huellaDeEscena(base), huellaDeEscena(conAgua));
  });

  it("el `combat` de un npc distinto → huella distinta (el estado que emite core SÍ entra)", () => {
    const base = separarSalidas(servida([FORJA])).escena;
    const herido = separarSalidas(servida([FORJA])).escena;
    const combat = herido.npcs[0].combat;
    assert.ok(combat, "el hostil trae su bloque derivado");
    herido.npcs[0].combat = { ...combat, health: combat.health - 1 };
    assert.notEqual(huellaDeEscena(base), huellaDeEscena(herido));
  });

  it("la posición de un npc distinta → huella distinta", () => {
    const base = separarSalidas(servida([FORJA])).escena;
    const movido = separarSalidas(servida([FORJA])).escena;
    movido.npcs[0].position = [-26.25, 0, -26.75];
    assert.notEqual(huellaDeEscena(base), huellaDeEscena(movido));
  });

  it("la garantía va en el tipo: una servida (con `exits`) no compila como argumento de la huella", () => {
    const s = servida([FORJA]);
    // @ts-expect-error — `exits: SceneExit[]` no es asignable a `exits?: never`:
    // quien quiera la huella tiene que pasar antes por `separarSalidas`.
    const conOverlay = (): string => huellaDeEscena(s);
    // Y en runtime el overlay se notaría: la huella con salidas dentro es
    // OTRA, que es exactamente el desfase que #410 vino a quitar.
    assert.notEqual(conOverlay(), huellaDeEscena(separarSalidas(s).escena));
  });
});
