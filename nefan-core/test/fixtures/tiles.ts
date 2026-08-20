/** Fixture compartido de tile: el caso canónico de un camino que entra por el
 *  oeste (fila 41) y sale por el este (fila 52). El suelo se declara en
 *  `ground` —la única vía—; scene-expand lo rasteriza al grid y de ahí salen
 *  las costuras. Vive suelto (sin importar el harness de bridge de
 *  helpers.ts) porque lo consumen tests que corren bajo mutación. */

/** Camino oeste(41) → este(52), endpoints EN los bordes: es lo que fija la
 *  continuidad de la costura entre tiles vecinos. */
export const CAMINO_OESTE_ESTE = {
  id: "camino",
  kind: "path",
  points: [[0, 41], [64, 46], [128, 52]],
  w: 2,
};

/** Tile de bosque con ese camino. `over` sobrescribe cualquier campo. */
export function forestTile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tile: { tx: 1, ty: 0 },
    scene_id: "tile_1_0",
    biome: "forest_floor",
    ground: [CAMINO_OESTE_ESTE],
    entities: [],
    ...over,
  };
}
