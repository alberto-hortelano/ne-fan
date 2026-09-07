/** Lo que frena al jugador y no es terreno: la frontera del plano y las cajas
 *  de los objetos que el plan del tile no pinta (#241 PR 5, #489).
 *
 *  Los casos se escriben desde lo que NOTA quien juega —«no puedo salir del
 *  mundo pero sí volver», «la forja que el motor acaba de poner es sólida», «el
 *  edificio del plano se cruza por su puerta»— y no desde las ramas del código.
 *  El mundo entra como argumento, así que aquí no hay ni tiles ni escenas: hay
 *  un `TilesDelMundo` de mentira que dice qué existe.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aabbBloquea,
  fronteraBloquea,
  type ObstaculoAabb,
  type TilesDelMundo,
} from "../src/simulation/obstaculos-del-jugador.js";
import { TILE_SIZE_M, worldToTile } from "../src/scene/tile.js";

/** Un mundo con exactamente los tiles que se le nombran. `tocados` usa la
 *  MISMA geometría que el `TileStore` del cliente (worldToTile sobre las cuatro
 *  esquinas del círculo), que es la de core. */
function mundoCon(claves: readonly [number, number][]): TilesDelMundo {
  const hay = new Set(claves.map(([tx, ty]) => `${tx},${ty}`));
  return {
    hayGrid: claves.length > 0,
    tocados(x, z, r) {
      const t0 = worldToTile(x - r, z - r);
      const t1 = worldToTile(x + r, z + r);
      const out = [];
      for (let ty = t0.ty; ty <= t1.ty; ty++) for (let tx = t0.tx; tx <= t1.tx; tx++) out.push({ tx, ty });
      return out;
    },
    tiene: (tx, ty) => hay.has(`${tx},${ty}`),
  };
}

const R = 0.4;
/** El borde este del tile (0,0): x = +32. */
const BORDE_ESTE = TILE_SIZE_M / 2;

describe("fronteraBloquea — el mundo conocido se sale por donde se entró", () => {
  const soloElCentro = mundoCon([[0, 0]]);
  const centro = { x: 0, z: 0 };

  it("sin un solo tile no hay frontera: el mundo vacío no encierra a nadie", () => {
    const vacio = mundoCon([]);
    assert.equal(fronteraBloquea(centro, { x: 1000, z: 1000 }, R, vacio), false);
  });

  it("moverse DENTRO del tile que existe no bloquea", () => {
    assert.equal(fronteraBloquea(centro, { x: 10, z: -10 }, R, soloElCentro), false);
  });

  it("pisar el tile de al lado, que no existe, bloquea", () => {
    // El cuerpo (radio 0,4) cruza x = 32 → toca el tile (1,0), que no está.
    const fuera = { x: BORDE_ESTE - 0.2, z: 0 };
    assert.equal(fronteraBloquea(centro, fuera, R, soloElCentro), true);
  });

  it("es DIRECCIONAL: pegado al borde este, ±z y −x siguen libres", () => {
    const pegado = { x: BORDE_ESTE - 0.5, z: 0 };
    assert.equal(fronteraBloquea(pegado, { x: BORDE_ESTE - 0.1, z: 0 }, R, soloElCentro), true, "+x bloquea");
    assert.equal(fronteraBloquea(pegado, { x: pegado.x, z: 5 }, R, soloElCentro), false, "+z libre");
    assert.equal(fronteraBloquea(pegado, { x: pegado.x, z: -5 }, R, soloElCentro), false, "−z libre");
    assert.equal(fronteraBloquea(pegado, { x: 0, z: 0 }, R, soloElCentro), false, "−x libre");
  });

  it("SALIR SÍ: quien ya roza el tile ausente puede volver, y quedarse quieto no le atrapa", () => {
    // El bench (o un save antiguo) deja al jugador con el cuerpo a caballo del
    // borde. Los tiles que faltan y que ya se tocaban desde el origen no cuentan.
    const aCaballo = { x: BORDE_ESTE - 0.1, z: 0 };
    assert.equal(fronteraBloquea(aCaballo, { x: BORDE_ESTE - 0.05, z: 0 }, R, soloElCentro), false, "seguir hacia fuera no se bloquea si ya estaba fuera");
    assert.equal(fronteraBloquea(aCaballo, { x: 20, z: 0 }, R, soloElCentro), false, "volver hacia dentro nunca bloquea");
  });

  it("con el vecino ya generado se cruza la costura", () => {
    const dos = mundoCon([[0, 0], [1, 0]]);
    assert.equal(fronteraBloquea(centro, { x: BORDE_ESTE + 5, z: 0 }, R, dos), false);
    // Y el de más allá sigue frenando.
    assert.equal(fronteraBloquea({ x: BORDE_ESTE + 5, z: 0 }, { x: TILE_SIZE_M + BORDE_ESTE - 0.2, z: 0 }, R, dos), true);
  });

  it("en la esquina, el DIAGONAL que falta frena aunque los dos vecinos de al lado existan", () => {
    const enL = mundoCon([[0, 0], [1, 0], [0, 1]]);
    const esquina = { x: BORDE_ESTE - 5, z: BORDE_ESTE - 5 };
    assert.equal(fronteraBloquea(esquina, { x: BORDE_ESTE + 0.2, z: BORDE_ESTE + 0.2 }, R, enL), true);
  });
});

describe("aabbBloquea — solo lo que el plan del tile NO pinta", () => {
  const origen = { x: 0, z: 0 };
  /** La forja que spawnea el motor: 4×4 m en (10, 0), sin volumen del plan. */
  const forja: ObstaculoAabb = { pos: { x: 10, z: 0 }, sizeXZ: { x: 4, z: 4 }, category: "building" };

  it("sin obstáculos no bloquea nada", () => {
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, []), false);
  });

  it("EL ARREGLO DE #489: un spawn de runtime (sin volume_id) es SÓLIDO", () => {
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [forja]), true, "su centro bloquea");
    // Media huella (2) + radio (0,4) = 2,4 m desde el centro.
    assert.equal(aabbBloquea(origen, { x: 10 - 2.39, z: 0 }, R, [forja]), true, "el borde de la caja + el radio bloquea");
    assert.equal(aabbBloquea(origen, { x: 10 - 2.41, z: 0 }, R, [forja]), false, "un dedo más allá, no");
    assert.equal(aabbBloquea(origen, { x: 10, z: -2.39 }, R, [forja]), true, "y por el eje z igual");
  });

  it("lo que YA representa un volumen del plan no bloquea por su caja: el grid tiene la puerta", () => {
    const taberna: ObstaculoAabb = { ...forja, volumeId: "v_taberna" };
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [taberna]), false);
    // Y basta con que el id ESTÉ: no se mira si el plan lo conoce (eso lo
    // resuelve el grid, que es quien tiene la última palabra sobre esa huella).
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [{ ...forja, volumeId: "" }]), false);
  });

  it("solo frenan building y prop: un item se coge y un decor es estético", () => {
    for (const category of ["item", "decor", "creature", undefined]) {
      assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [{ ...forja, category }]), false, `category=${category}`);
    }
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [{ ...forja, category: "prop" }]), true);
  });

  it("sin huella no hay caja que probar (ni con null ni ausente)", () => {
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [{ ...forja, sizeXZ: null }]), false);
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [{ pos: forja.pos, category: "building" }]), false);
  });

  it("SALIR SÍ, ENTRAR NO: quien apareció dentro de la caja puede moverse dentro de ella", () => {
    const dentro = { x: 10.5, z: 0 };
    assert.equal(aabbBloquea(dentro, { x: 10, z: 0 }, R, [forja]), false, "moverse dentro no bloquea");
    assert.equal(aabbBloquea(dentro, { x: 20, z: 0 }, R, [forja]), false, "salir tampoco");
    // Pero volver a entrar desde fuera sí.
    assert.equal(aabbBloquea({ x: 20, z: 0 }, dentro, R, [forja]), true);
  });

  it("el radio del cuerpo cuenta: el mismo destino bloquea con radio grande y no con radio cero", () => {
    const rozando = { x: 10 - 2.2, z: 0 };
    assert.equal(aabbBloquea(origen, rozando, 0.4, [forja]), true);
    assert.equal(aabbBloquea(origen, rozando, 0, [forja]), false);
  });

  it("basta UNO de la lista, y los demás no lo tapan", () => {
    const decorados: ObstaculoAabb[] = [
      { pos: { x: 10, z: 0 }, sizeXZ: { x: 4, z: 4 }, category: "decor" },
      { pos: { x: 10, z: 0 }, sizeXZ: { x: 4, z: 4 }, category: "building", volumeId: "v1" },
      forja,
    ];
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, decorados), true);
  });

  it("la ALTURA no participa: no hay campo que leer, y una caja bajísima frena igual", () => {
    const alfombra: ObstaculoAabb = { ...forja, sizeXZ: { x: 4, z: 4 } };
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [alfombra]), true);
    assert.equal("sizeY" in alfombra, false);
  });
});
