/** Colisión de terreno por celdas (Format D) — lógica pura compartida.
 *
 *  `formatDToWorld` emite `terrain_grid` con `solid_chars` (qué chars del grid
 *  bloquean: muro "W" y agua "w", fijados por el engine en
 *  `DEFAULT_SOLID_CHARS`). Este módulo lo convierte en un lookup O(1) que el cliente consulta
 *  desde su chequeo de colisión, junto a los AABB de objetos. La conversión
 *  mundo↔celda usa el mismo origen que `formatDToWorld`: el centro del
 *  rectángulo de escena es (0,0).
 *
 *  Fail-loud: un grid inconsistente (filas ≠ rows, fila no-string, mpc ≤ 0)
 *  lanza — el caller decide si degradar (errors.push + sin colisión de
 *  terreno). Sin grid o sin ninguna celda sólida devuelve null: no hay nada
 *  que bloquear y el caller se ahorra el lookup por frame. */

/** Radio físico del jugador en METROS — FUENTE ÚNICA de esta regla de juego.
 *  La usa la colisión del cliente (`world/collision.ts`) — antes era una copia
 *  a mano del literal 0.4 (con comentario "espejo de PLAYER_RADIUS"). Sus otros
 *  dos consumidores se fueron con sus vistas: el inflado de las zonas de salida
 *  del plató y el tamaño de dibujo del cuerpo en el renderer oblicuo.
 *  Cambiarlo aquí los mueve a todos a la vez. Los NPCs usan su propio radio
 *  (`NPC_RADIUS_M`, aquí al lado); el servidor NO colisiona al jugador (el
 *  cliente es autoritativo de su movimiento). */
export const PLAYER_RADIUS_M = 0.4;

/** Radio físico del NPC en METROS — FUENTE ÚNICA. Mayor que el del jugador a
 *  propósito: margen de seguridad contra las fuentes que el server aproxima
 *  por celdas.
 *
 *  Vive AQUÍ, junto a `blocksCircle` y al radio del jugador, y no en
 *  `npc-behavior.ts`, porque la pregunta que contesta —«¿cabe este cuerpo por
 *  este hueco?»— se responde con los dos radios a la vez. Mientras fue
 *  privada de su módulo, el cuerpo MAYOR del juego era inconsultable desde el
 *  resto del core: cada sitio que necesitaba «cuánto hueco hace falta» lo
 *  razonaba desde el jugador y dejaba fuera justo al cuerpo que no cabe. */
export const NPC_RADIUS_M = 0.5;

/** El cuerpo MAYOR que el simulador mueve por el mundo. Quien decida cuánto
 *  hueco hay que dejar deriva de aquí, no del jugador.
 *
 *  El sim mueve a TODAS las criaturas con el radio de su kind y no lee el
 *  `footprint` de la entity ni una vez (`grep footprint src/simulation/` = 0).
 *  Hasta #300 eso era un agujero: el contrato le ponía `minimum: 1` sin
 *  máximo, así que una criatura podía declarar `footprint:[8,8]` —4 metros— y
 *  seguir moviéndose con el cuerpo de 0,5 m de radio, con el motor prometiendo un
 *  cuerpo que el juego no honra. Hoy el CONTRATO no lo deja expresar: el zod
 *  de la escena topa el footprint de los kinds móviles con
 *  `celdasQueCubreRadio` sobre estos mismos radios, así que nada de lo que el
 *  motor emite ni de lo que se pre-genera puede pasarse de lo simulable.
 *  Cuidado con leerlo de más: ese zod corre en el pre-flight de narrative-mcp,
 *  en el saneador de ai_server y en `world-snapshot.ts` — NO en la carga de un
 *  save, que no pasa por zod. El día que el sim derive el radio del
 *  `footprint`, quien llame a `celdasLibresParaRadio` pasa el `max` sobre las
 *  entities de la escena y nada más cambia. */
export const BODY_RADIUS_M = Math.max(PLAYER_RADIUS_M, NPC_RADIUS_M);

/** Celdas LIBRES consecutivas que necesita un cuerpo de radio `radioM` para
 *  cruzar un hueco, sobre un grid de `mpc` metros por celda.
 *
 *  Es el INVERSO EXACTO de `blocksCircle`: su AABB se recorre con `floor()`
 *  INCLUSIVE (`c0 = floor((x−r−o)/mpc) … c1 = floor((x+r−o)/mpc)`), así que un
 *  hueco de n celdas admite radio R solo si `n·mpc > 2R` — estrictamente
 *  mayor, no «mayor o igual». De ahí el `+1`: `floor` y no `ceil`, porque con
 *  `ceil` un hueco de exactamente `2R` saldría transitable y no lo es. A mpc
 *  0,5: jugador (0,4) → 2 celdas; NPC (0,5) → 3. Esa celda de diferencia es
 *  toda la puerta de 1 m del issue #289. */
export function celdasLibresParaRadio(radioM: number, mpc: number): number {
  return Math.floor((2 * radioM) / mpc) + 1;
}

/** Celdas de ANCHO que cubre un cuerpo de radio `radioM` sobre un grid de
 *  `mpc` metros por celda: el mayor `n` con `n·mpc ≤ 2·radioM`.
 *
 *  Es el gemelo exacto de `celdasLibresParaRadio` —uno dice cuánto HUECO pide
 *  un cuerpo, este cuánto CUERPO cabe— y por eso son la misma cuenta con una
 *  celda de diferencia: el hueco por el que ese cuerpo pasa es, justamente, el
 *  primero más ancho que él. A mpc 0,5: NPC (0,5) → 2 celdas (1,0 m, su
 *  diámetro exacto); jugador (0,4) → 1 celda (0,5 m, porque 2 celdas serían
 *  1,0 m y su cuerpo mide 0,8).
 *
 *  De aquí sale el TOPE del `footprint` de una entity móvil
 *  (`RADIO_SIMULADO_POR_KIND` en `contract/model-io/scene-schema.ts`): lo que
 *  el motor declara ocupar no puede ser más ancho que el cuerpo que el
 *  simulador mueve de verdad. Que no sea un literal es lo que hace el candado:
 *  mover un radio mueve el contrato con él, en vez de dejarlo prometiendo un
 *  cuerpo que ya nadie honra.
 *
 *  Y ese cuerpo es un CUADRADO, no un círculo: quien lo estampa es
 *  `blocksCircle` (`:164-175`), cuyo propio bucle recorre el AABB `x±r` con
 *  `floor()` INCLUSIVE. No lo estampa `circleOverlapsCell` —que sí parece la
 *  candidata por el nombre y es lo que decía este comentario hasta que QA lo
 *  midió—: esa tiene UN llamante, la exención de «celda que ya solapabas» de
 *  `blocksMove` (`:185`), y convertirla en una prueba de distancia deja la
 *  batería entera verde. La diferencia importa porque el tope se justifica
 *  sobre la forma del cuerpo: si `blocksCircle` pasara a ser un círculo de
 *  verdad, esta cuenta dejaría de describirlo, y por eso hay una sonda que se
 *  pone roja cuando eso ocurre (`test/terrain-collision.test.ts`). */
export function celdasQueCubreRadio(radioM: number, mpc: number): number {
  return Math.floor((2 * radioM) / mpc);
}

export interface TerrainGridData {
  grid: string[];
  cols: number;
  rows: number;
  meters_per_cell: number;
  /** Esquina NW del grid en coordenadas mundo (plano continuo de tiles). Lo
   *  emite `formatDToWorld`; ausente = escena legacy centrada en el origen. */
  origin?: [number, number];
  /** Chars del grid que bloquean movimiento. Los emite `formatDToWorld`
   *  (`DEFAULT_SOLID_CHARS`: W/w); los grids derivados del plan usan `S`. */
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
  /** ¿El movimiento from→to queda bloqueado? Bloquea solo las celdas sólidas
   *  que solapa el destino Y NO solapa el origen: si el spawn (o un empujón)
   *  te deja penetrando un muro puedes SALIR de él, pero nunca entrar más.
   *  Evita el deadlock de bloquear ambos ejes estando ya en colisión. */
  blocksMove(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean;
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

  // Esquina NW del grid en mundo: global (tiles) o centrada (legacy).
  const originX = tg.origin?.[0] ?? -(cols * mpc) / 2;
  const originZ = tg.origin?.[1] ?? -(rows * mpc) / 2;

  const isSolidCell = (col: number, row: number): boolean =>
    col >= 0 && row >= 0 && col < cols && row < rows && solid[row * cols + col] === 1;

  /** ¿El AABB (x±radius, z±radius) solapa la celda (c, r)? */
  const circleOverlapsCell = (x: number, z: number, radius: number, c: number, r: number): boolean => {
    const cellX0 = originX + c * mpc;
    const cellZ0 = originZ + r * mpc;
    return x + radius > cellX0 && x - radius < cellX0 + mpc &&
      z + radius > cellZ0 && z - radius < cellZ0 + mpc;
  };

  return {
    solidCellCount,
    isSolidCell,
    blocksCircle(x: number, z: number, radius: number): boolean {
      const c0 = Math.floor((x - radius - originX) / mpc);
      const c1 = Math.floor((x + radius - originX) / mpc);
      const r0 = Math.floor((z - radius - originZ) / mpc);
      const r1 = Math.floor((z + radius - originZ) / mpc);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (isSolidCell(c, r)) return true;
        }
      }
      return false;
    },
    blocksMove(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean {
      const c0 = Math.floor((toX - radius - originX) / mpc);
      const c1 = Math.floor((toX + radius - originX) / mpc);
      const r0 = Math.floor((toZ - radius - originZ) / mpc);
      const r1 = Math.floor((toZ + radius - originZ) / mpc);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (!isSolidCell(c, r)) continue;
          // Celda que ya solapábamos en el origen → no bloquea la salida.
          if (circleOverlapsCell(fromX, fromZ, radius, c, r)) continue;
          return true;
        }
      }
      return false;
    },
  };
}
