/** Colisión de terreno por celdas (Format D) — lógica pura compartida.
 *
 *  `formatDToWorld` emite `terrain_grid` con `solid_chars` (qué chars del grid
 *  bloquean: muros "W", agua "w", chars custom declarados sólidos en la
 *  leyenda). Este módulo lo convierte en un lookup O(1) que el cliente consulta
 *  desde su chequeo de colisión, junto a los AABB de objetos. La conversión
 *  mundo↔celda usa el mismo origen que `formatDToWorld`: el centro del
 *  rectángulo de escena es (0,0).
 *
 *  Fail-loud: un grid inconsistente (filas ≠ rows, fila no-string, mpc ≤ 0)
 *  lanza — el caller decide si degradar (errors.push + sin colisión de
 *  terreno). Sin grid o sin ninguna celda sólida devuelve null: no hay nada
 *  que bloquear y el caller se ahorra el lookup por frame. */

export interface TerrainGridData {
  grid: string[];
  cols: number;
  rows: number;
  meters_per_cell: number;
  /** Chars del grid que bloquean movimiento. Lo resuelve `formatDToWorld`
   *  (defaults W/w + leyenda `{name, solid}`). */
  solid_chars?: string[];
}

export interface TerrainCollider {
  /** Nº de celdas sólidas del grid (para trazas/tests). */
  readonly solidCellCount: number;
  /** Celda fuera del grid → false (el borde lo gobierna el soft-clamp). */
  isSolidCell(col: number, row: number): boolean;
  /** ¿El AABB del círculo (x,z,±radius) solapa alguna celda sólida? Itera
   *  todas las celdas cubiertas (≤3×3 con radios de jugador), no solo las 4
   *  esquinas: con mpc 0.5 y diámetro 0.8 una celda podría colarse entre ellas. */
  blocksCircle(x: number, z: number, radius: number): boolean;
}

export function createTerrainCollider(
  tg: TerrainGridData | undefined | null,
): TerrainCollider | null {
  if (!tg) return null;
  const { grid, cols, rows, meters_per_cell: mpc } = tg;
  const solidChars = new Set(tg.solid_chars ?? []);
  if (solidChars.size === 0) return null;
  if (!Array.isArray(grid) || grid.length !== rows || !(cols > 0) || !(rows > 0) || !(mpc > 0)) {
    throw new Error(
      `terrain_grid inconsistente (filas=${Array.isArray(grid) ? grid.length : typeof grid} rows=${rows} cols=${cols} mpc=${mpc})`,
    );
  }

  const solid = new Uint8Array(cols * rows);
  let solidCellCount = 0;
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (typeof row !== "string") {
      throw new Error(`terrain_grid fila ${r} no es string`);
    }
    const cmax = Math.min(cols, row.length);
    for (let c = 0; c < cmax; c++) {
      if (solidChars.has(row[c])) {
        solid[r * cols + c] = 1;
        solidCellCount++;
      }
    }
  }
  if (solidCellCount === 0) return null;

  const halfW = (cols * mpc) / 2;
  const halfD = (rows * mpc) / 2;

  const isSolidCell = (col: number, row: number): boolean =>
    col >= 0 && row >= 0 && col < cols && row < rows && solid[row * cols + col] === 1;

  return {
    solidCellCount,
    isSolidCell,
    blocksCircle(x: number, z: number, radius: number): boolean {
      const c0 = Math.floor((x - radius + halfW) / mpc);
      const c1 = Math.floor((x + radius + halfW) / mpc);
      const r0 = Math.floor((z - radius + halfD) / mpc);
      const r1 = Math.floor((z + radius + halfD) / mpc);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (isSolidCell(c, r)) return true;
        }
      }
      return false;
    },
  };
}
