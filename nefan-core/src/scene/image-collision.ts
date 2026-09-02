/** Char sólido de los grids de colisión DERIVADOS (no del `terrain_grid` del
 *  esquema, cuyos sólidos son `DEFAULT_SOLID_CHARS`).
 *
 *  Vivía aquí con el rasterizador de máscaras de la imagen IA
 *  (`solidGridFromMasks`), que se retiró con el pipeline de repintado de la
 *  vista oblicua. La constante se queda porque la comparten los dos
 *  derivadores VIVOS del plan declarado —`blueprint/collision.ts` (huellas de
 *  volúmenes) y `blueprint/ground-collision.ts` (agua∖decks)—, que emiten el
 *  mismo shape `TerrainGridData` para que el cliente y el sim del bridge los
 *  unan por el camino de siempre. */

export const IMAGE_SOLID_CHAR = "S";
