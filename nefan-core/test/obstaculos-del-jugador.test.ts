/** Lo que frena al jugador y no es terreno: la frontera del plano y las cajas
 *  de los objetos que el plan del tile no pinta (#241 PR 5, #489).
 *
 *  Los casos se escriben desde lo que NOTA quien juega —«no puedo salir del
 *  mundo pero sí volver», «la forja que el motor acaba de poner es sólida», «el
 *  edificio del plano se cruza por su puerta»— y no desde las ramas del código.
 *  El mundo entra como argumento, así que aquí no hay ni tiles ni escenas: hay
 *  un `TilesDelMundo` de mentira que dice qué existe y un `PlanDeLosTiles` que
 *  dice si el plan de un tile llegó a instalarse.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aabbBloquea,
  fronteraBloquea,
  type DuenoDeEntity,
  type ObstaculoAabb,
  type PlanDeLosTiles,
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

/** Los dos orígenes posibles de un objeto, que son los del `dueno` del mundo
 *  del cliente: lo declara un tile, o lo puso el motor a mitad de partida. */
const DEL_TILE: DuenoDeEntity = { de: "tile", key: "0,0" };
const DE_RUNTIME: DuenoDeEntity = { de: "runtime" };

/** Los dos estados del plan de un tile: instalado (el caso normal, y el que
 *  tiene todo tile del motor desde que llega) y sin derivar (`applyPlanCollision`
 *  falló y `svgApplied` se quedó a false). */
const conPlan: PlanDeLosTiles = { planAplicadoEn: () => true };
const sinPlan: PlanDeLosTiles = { planAplicadoEn: () => false };

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

describe("aabbBloquea — la caja que se aplica la decide el ORIGEN del objeto", () => {
  const origen = { x: 0, z: 0 };
  /** La forja que spawnea el motor: 4×4 m en (10, 0), de nadie más que suya. */
  const forja: ObstaculoAabb = { pos: { x: 10, z: 0 }, sizeXZ: { x: 4, z: 4 }, category: "building", dueno: DE_RUNTIME };
  /** El mismo bulto, pero declarado por el tile (0,0) — la casa del pueblo. */
  const casa: ObstaculoAabb = { ...forja, dueno: DEL_TILE };

  it("sin obstáculos no bloquea nada", () => {
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [], conPlan), false);
  });

  it("EL ARREGLO DE #489: la forja que pone el motor es SÓLIDA, y lo es en el tile que ya tiene su plan", () => {
    // `conPlan` es el caso REAL: todo tile del motor trae su plan aplicado
    // desde que llega, y por eso antes de #489 esta caja no se aplicaba nunca.
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [forja], conPlan), true, "su centro bloquea");
    // Media huella (2) + radio (0,4) = 2,4 m desde el centro.
    assert.equal(aabbBloquea(origen, { x: 10 - 2.39, z: 0 }, R, [forja], conPlan), true, "el borde de la caja + el radio bloquea");
    assert.equal(aabbBloquea(origen, { x: 10 - 2.41, z: 0 }, R, [forja], conPlan), false, "un dedo más allá, no");
    assert.equal(aabbBloquea(origen, { x: 10, z: -2.39 }, R, [forja], conPlan), true, "y por el eje z igual");
    // Y en un tile sin plan derivado, igual: el origen manda, no el tile.
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [forja], sinPlan), true, "sin plan también");
  });

  it("lo que DECLARA el tile no bloquea por su caja mientras el plan esté instalado: el grid tiene la puerta", () => {
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [casa], conPlan), false);
  });

  it("y no cambia de conducta por no estar representada: un prop tapado por un volumen sigue siendo del tile", () => {
    // El caso que NO está en ninguna fixture (`derive.ts` solo apunta
    // `representedBy` en los `building`): un roble cuyo rect solapa la posada
    // declarada se queda sin `volume_id`. Es del tile, así que responde por él
    // su plan — y no pasa a ser un cilindro sólido de 4 m donde el grid está
    // libre, que es colisionar por la COPA y no por el tronco.
    const roble: ObstaculoAabb = { pos: { x: 10, z: 0 }, sizeXZ: { x: 4, z: 4 }, category: "prop", dueno: DEL_TILE };
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [roble], conPlan), false);
  });

  it("LA RED DE SEGURIDAD: si el plan del tile no llegó a derivarse, sus cajas vuelven a frenar", () => {
    // `applyPlanCollision` puede fallar (`errors.push`, `svgApplied` a false).
    // Ese tile se quedaría sin NINGUNA fuente de solidez para sus edificios y
    // el pueblo entero sería atravesable. La caja es tosca —tapa los vanos—
    // pero es lo que había antes de #489 y no lo cambia esta PR.
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [casa], sinPlan), true);
  });

  it("la pregunta por el plan es POR PUNTO: cada objeto la contesta con el tile que lo contiene", () => {
    // Dos casas idénticas en tiles distintos; solo uno derivó su plan.
    const aplicadoSoloAlOeste: PlanDeLosTiles = { planAplicadoEn: (x) => x < 0 };
    const oeste: ObstaculoAabb = { ...casa, pos: { x: -10, z: 0 } };
    assert.equal(aabbBloquea(origen, { x: -10, z: 0 }, R, [oeste, casa], aplicadoSoloAlOeste), false, "la del tile con plan, no");
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [oeste, casa], aplicadoSoloAlOeste), true, "la del tile sin plan, sí");
  });

  it("solo frenan building y prop: un item se coge y un decor es estético", () => {
    for (const category of ["item", "decor", "creature", undefined]) {
      assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [{ ...forja, category }], conPlan), false, `category=${category}`);
    }
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [{ ...forja, category: "prop" }], conPlan), true);
  });

  it("sin huella no hay caja que probar (ni con null ni ausente)", () => {
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [{ ...forja, sizeXZ: null }], conPlan), false);
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [{ pos: forja.pos, category: "building", dueno: DE_RUNTIME }], conPlan), false);
  });

  it("SALIR SÍ, ENTRAR NO: quien apareció dentro de la caja puede moverse dentro de ella", () => {
    const dentro = { x: 10.5, z: 0 };
    assert.equal(aabbBloquea(dentro, { x: 10, z: 0 }, R, [forja], conPlan), false, "moverse dentro no bloquea");
    assert.equal(aabbBloquea(dentro, { x: 20, z: 0 }, R, [forja], conPlan), false, "salir tampoco");
    // Pero volver a entrar desde fuera sí.
    assert.equal(aabbBloquea({ x: 20, z: 0 }, dentro, R, [forja], conPlan), true);
  });

  it("el radio del cuerpo cuenta: el mismo destino bloquea con radio grande y no con radio cero", () => {
    const rozando = { x: 10 - 2.2, z: 0 };
    assert.equal(aabbBloquea(origen, rozando, 0.4, [forja], conPlan), true);
    assert.equal(aabbBloquea(origen, rozando, 0, [forja], conPlan), false);
  });

  it("basta UNO de la lista, y los demás no lo tapan", () => {
    const decorados: ObstaculoAabb[] = [
      { pos: { x: 10, z: 0 }, sizeXZ: { x: 4, z: 4 }, category: "decor", dueno: DE_RUNTIME },
      casa,
      forja,
    ];
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, decorados, conPlan), true);
  });

  it("la ALTURA no participa: no hay campo que leer, y una caja bajísima frena igual", () => {
    const alfombra: ObstaculoAabb = { ...forja, sizeXZ: { x: 4, z: 4 } };
    assert.equal(aabbBloquea(origen, { x: 10, z: 0 }, R, [alfombra], conPlan), true);
    assert.equal("sizeY" in alfombra, false);
  });
});
