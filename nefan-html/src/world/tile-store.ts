/** Modelo de mundo del cliente: colección ACUMULATIVA de tiles.
 *
 *  La geometría (64 m, tile (0,0) centrado, worldToTile con round) se importa
 *  de nefan-core — única fuente de verdad. Todo lo que entra es un tile del
 *  plano, indexado por (tx,ty): desde #405 no hay escena sin coords de grid
 *  —las fixtures del selector «Room» también son tiles—, así que la clave del
 *  registro es SIEMPRE `tileKey(tx, ty)` y no hace falta un segundo índice.
 *
 *  Sin dependencias de DOM: testeable y reutilizable. */

import {
  TILE_SIZE_M,
  tileKey,
  tileWorldRect,
  worldToTile,
  type WorldRect,
} from "@nefan-core/src/scene/tile.js";
import type { TerrainCollider } from "@nefan-core/src/scene/terrain-collision.js";
import type { SceneExit } from "@nefan-core/src/protocol/messages.js";
import { huellaDeEscena, type EscenaSinSalidas } from "@nefan-core/src/protocol/escena-servida.js";

export { TILE_SIZE_M, tileKey, tileWorldRect, worldToTile };
export type { WorldRect };

export interface TileClientState {
  /** Clave del registro: `tileKey(tx, ty)`, y `add` lo comprueba. */
  key: string;
  tx: number;
  ty: number;
  rect: WorldRect;
  /** La world scene del tile, en posiciones GLOBALES y SIN las salidas: se
   *  separan en la frontera (`separarSalidas`, #410) porque tienen otra vida
   *  —cambian con el mapa, no con la escena— y no pueden entrar en la huella.
   *  Tipada (#378): el cliente la lee, no la abre con `as`. */
  escena: EscenaSinSalidas;
  /** Las salidas del lugar: la otra mitad del wire. Las reescribe
   *  `actualizarSalidas` cuando el mapa cambia (`exits_changed`). */
  salidas: SceneExit[];
  collider: TerrainCollider | null;
  /** Colisión base derivada del PLAN declarado (agua∖decks del `ground` +
   *  huellas de los `volumes`). Disponible en cuanto llega el tile. Se UNE al
   *  collider de terreno. Con `svgApplied`, los AABBs del esquema dejan de
   *  bloquear (el plan ya dibuja esos edificios con sus muros y puertas); si
   *  la derivación falla, el flag queda a false y los AABBs siguen. */
  svgCollider: TerrainCollider | null;
  svgApplied: boolean;
}

export class TileStore {
  readonly entries = new Map<string, TileClientState>();
  /** Huella de la ESCENA con la que se registró cada clave (`huellaDeEscena`:
   *  sin las salidas, que cambian por su cuenta). Es lo único que distingue
   *  "el tile vuelve a llegar igual" (resume, re-broadcast) de "el tile
   *  CAMBIÓ" — y de eso depende si la colisión derivada se restaura o se
   *  recalcula. Vivía en el renderer oblicuo, que era quien re-pintaba; con
   *  una sola vista, el dueño del dato es el modelo de mundo. */
  private fingerprints = new Map<string, string>();
  /** Cuántas veces se DERIVÓ y cuántas se RESTAURÓ la colisión del plan de cada
   *  tile. Solo lectura, para `__nefan.colision()` (QA-G H3 de #410): «restaurar
   *  vs derivar» solo era observable por una traza de dev, y un guion sobre una
   *  cadena de `console.log` deja de medir sin ponerse rojo el día que alguien
   *  la reescribe. */
  private episodios = new Map<string, { derivaciones: number; restauraciones: number }>();

  /** ¿Hay mundo? (las reglas de frontera solo aplican entonces). */
  get hasGridTiles(): boolean {
    return this.entries.size > 0;
  }

  has(tx: number, ty: number): boolean {
    return this.entries.has(tileKey(tx, ty));
  }

  get(tx: number, ty: number): TileClientState | undefined {
    return this.entries.get(tileKey(tx, ty));
  }

  /** El tile bajo el punto (x, z), por la geometría de core. */
  getAt(x: number, z: number): TileClientState | undefined {
    const t = worldToTile(x, z);
    return this.get(t.tx, t.ty);
  }

  /** ADITIVO: re-añadir la misma clave sustituye (re-render tras resume).
   *  Devuelve `sceneChanged`: la clave ya estaba Y su escena es distinta. Un
   *  tile nuevo NO cuenta como cambio (no hay nada que restaurar). */
  add(tile: TileClientState): { sceneChanged: boolean } {
    // La clave ES las coords: `get(tx, ty)` la deriva, así que una entrada con
    // otra clave sería un tile que nadie encuentra.
    if (tile.key !== tileKey(tile.tx, tile.ty)) {
      throw new Error(`TileStore.add: clave ${tile.key} ≠ tileKey(${tile.tx}, ${tile.ty})`);
    }
    const fingerprint = huellaDeEscena(tile.escena);
    const sceneChanged =
      this.entries.has(tile.key) && this.fingerprints.get(tile.key) !== fingerprint;
    this.entries.set(tile.key, tile);
    this.fingerprints.set(tile.key, fingerprint);
    return { sceneChanged };
  }

  /** Instala la colisión base derivada del plan del tile (null = plan sin
   *  celdas sólidas, aplicado igualmente: los AABBs del esquema se apagan).
   *  `como` dice si se acaba de DERIVAR o se RESTAURA la de antes (la huella no
   *  cambió): es el dato que #410 hace observable. Fail-loud si la clave no
   *  existe: se deriva justo tras registrar el tile. */
  setSvgCollider(key: string, collider: TerrainCollider | null, como: "derivada" | "restaurada"): void {
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`TileStore.setSvgCollider: tile ${key} no registrado`);
    entry.svgCollider = collider;
    entry.svgApplied = true;
    const e = this.episodios.get(key) ?? { derivaciones: 0, restauraciones: 0 };
    if (como === "derivada") e.derivaciones += 1;
    else e.restauraciones += 1;
    this.episodios.set(key, e);
  }

  /** Por tile: su huella y cuántas veces la colisión del plan se derivó o se
   *  restauró. Copias, no las entradas: es un observable de bench. */
  colision(): { key: string; huella: string; derivaciones: number; restauraciones: number }[] {
    return [...this.entries.keys()].map((key) => ({
      key,
      huella: this.fingerprints.get(key) ?? "",
      ...(this.episodios.get(key) ?? { derivaciones: 0, restauraciones: 0 }),
    }));
  }

  /** Solo para resetWorld (arranque/resume/fixtures). */
  clear(): void {
    this.entries.clear();
    this.fingerprints.clear();
    this.episodios.clear();
  }

  /** Coords de los tiles que toca el AABB (x±r, z±r) — ≤4. */
  keysTouching(x: number, z: number, r: number): { tx: number; ty: number }[] {
    const out: { tx: number; ty: number }[] = [];
    const t0 = worldToTile(x - r, z - r);
    const t1 = worldToTile(x + r, z + r);
    for (let ty = t0.ty; ty <= t1.ty; ty++) {
      for (let tx = t0.tx; tx <= t1.tx; tx++) out.push({ tx, ty });
    }
    return out;
  }
}
