import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { createSimCollisionProvider } from "../bridge/sim-collision.js";
import { composeTilePlan } from "../src/scene/tile-plan.js";

/** Tile 0,0: rect mundo [-32,32). Celda (c,r) → mundo (-32 + (c+0.5)·0.5). */
function cellCenter(c: number, r: number): { x: number; z: number } {
  return { x: -32 + (c + 0.5) * 0.5, z: -32 + (r + 0.5) * 0.5 };
}

function makeState(extra: Record<string, unknown> = {}): NarrativeState {
  const s = new NarrativeState(new MemorySessionStorage());
  s.startNewSession("plugtest");
  const scene = expandScenePrimitives({
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    scene_description: "campo",
    biome: "grass",
    entities: [],
    ambient_event: "",
    ...extra,
  }) as Record<string, unknown>;
  // Muro en la fila 10, columnas 10..20 (terrain_grid del esquema).
  const terrain = scene.terrain as string[];
  terrain[10] = terrain[10].slice(0, 10) + "W".repeat(11) + terrain[10].slice(21);
  s.recordSceneLoaded("tile_0_0", scene);
  return s;
}

describe("createSimCollisionProvider", () => {
  it("bloquea sobre los muros del terrain_grid y no en campo abierto", () => {
    const provider = createSimCollisionProvider(makeState());
    const wall = cellCenter(15, 10);
    assert.ok(provider.blocksCircle(wall.x, wall.z, 0.5), "celda W debe bloquear");
    const open = cellCenter(64, 64);
    assert.ok(!provider.blocksCircle(open.x, open.z, 0.5), "campo abierto no bloquea");
    // blocksMove: entrar al muro desde fuera bloquea; moverse en abierto no.
    const before = cellCenter(15, 6);
    assert.ok(provider.blocksMove(before.x, before.z, wall.x, wall.z, 0.5));
    assert.ok(!provider.blocksMove(open.x, open.z, open.x + 1, open.z, 0.5));
  });

  it("bloquea sobre las huellas de los volumes del plan", () => {
    const provider = createSimCollisionProvider(makeState({
      volumes: [{ id: "arbol_1", label: "roble viejo", type: "tree", at: [100, 100] }],
    }));
    const tree = cellCenter(100, 100);
    assert.ok(provider.blocksCircle(tree.x, tree.z, 0.5), "el árbol debe bloquear");
    const open = cellCenter(64, 64);
    assert.ok(!provider.blocksCircle(open.x, open.z, 0.5));
  });

  it("tile inexistente o escena legacy → sin colisión (degradación, no throw)", () => {
    const provider = createSimCollisionProvider(makeState());
    // Punto en el tile (5,5), que no existe.
    assert.ok(!provider.blocksCircle(320, 320, 0.5));
    // Escena legacy (no Format D) no rompe.
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded("vieja_cripta", { scene_id: "vieja_cripta", npcs: [] });
    const legacy = createSimCollisionProvider(s);
    assert.ok(!legacy.blocksCircle(0, 0, 0.5));
  });
});

/** #232: el bridge NO veía los volúmenes DERIVADOS del esquema, solo los
 *  `volumes` declarados. En un tile cuyo pueblo viene de `structures` —o cuyo
 *  bosque viene de `vegetation_zones`, que es la mayoría— los NPCs se metían
 *  dentro de las casas y atravesaban los troncos que al jugador sí le frenan.
 *  Hoy el bridge lee el plan COMPUESTO de la world scene: la misma huella con
 *  la que juega el jugador. */
describe("createSimCollisionProvider · el bridge colisiona con el plan COMPUESTO", () => {
  it("los troncos de la vegetación de masa frenan a los NPCs (antes: ninguno)", () => {
    const provider = createSimCollisionProvider(makeState({
      vegetation_zones: [{ type: "pino", area: "rest", density: 0.05 }],
    }));
    // Los mismos árboles que compone el juego: se preguntan al compositor y se
    // comprueban uno a uno. Muestrear a ciegas dependería de que hubiera
    // muchos; así, si el bosque cambia, el test sigue mirando SUS árboles.
    const plan = composeTilePlan(
      expandScenePrimitives({
        tile: { tx: 0, ty: 0 },
        scene_id: "tile_0_0",
        scene_description: "campo",
        biome: "grass",
        entities: [],
        vegetation_zones: [{ type: "pino", area: "rest", density: 0.05 }],
      }) as Record<string, unknown>,
    ).plan;
    const pinos = (plan?.volumes ?? []).filter((v) => v.id.startsWith("derived_veg_"));
    assert.ok(pinos.length > 100, `el pinar tiene que existir: ${pinos.length}`);
    const blandos = pinos.filter((v) => {
      const at = (v as Extract<typeof v, { type: "tree" }>).at;
      const p = cellCenter(at[0] - 0.5, at[1] - 0.5);
      return !provider.blocksCircle(p.x, p.z, 0.3);
    });
    assert.deepEqual(blandos.map((v) => v.id), [], "cada tronco derivado frena también en el bridge");
  });

  it("los edificios que salen de `structures` dejan de ser transparentes", () => {
    const provider = createSimCollisionProvider(makeState({
      structures: [{ type: "room", rect: [40, 40, 12, 10], doors: [{ side: "south", at: 4, width: 3 }] }],
    }));
    // La celda 41 es INTERIOR a la sala: en el grid es suelo ("o") y solo la
    // tapa el anillo de 1,5 celdas del volumen derivado. Radio pequeño a
    // propósito: con uno de jugador el AABB tocaría la fila 40, que ya era
    // muro en el grid, y el test pasaría sin comprobar nada nuevo.
    const anillo = cellCenter(45, 41);
    assert.ok(provider.blocksCircle(anillo.x, anillo.z, 0.1), "el anillo del edificio derivado bloquea");
    const dentro = cellCenter(45, 45);
    assert.ok(!provider.blocksCircle(dentro.x, dentro.z, 0.1), "…y el interior de la sala se puede pisar");
    const vano = cellCenter(45, 49);
    assert.ok(!provider.blocksCircle(vano.x, vano.z, 0.1), "…y su vano sigue abierto");
  });
});
