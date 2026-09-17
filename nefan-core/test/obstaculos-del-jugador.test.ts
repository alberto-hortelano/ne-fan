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
  aabbOcupa,
  cajaBloquea,
  fronteraBloquea,
  penetracionEnCaja,
  salidaDeCaja,
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

  it("SALIR SÍ, ENTRAR NO (#601): desde dentro se sale y se va de lado, pero NO más adentro", () => {
    // La forja está en (10, 0) y su pared queda a 2,4 m del centro (media
    // huella + radio). El jugador apareció dentro, a 0,5 m del centro hacia el
    // este: le sobran 1,9 m de penetración.
    //
    // Los tres asertos son los tres movimientos que puede hacer, y cada uno
    // sujeta una mitad distinta de la regla:
    //  · ALEJARSE es el invariante que `reparto-de-spawns.ts:19-25` da por
    //    supuesto para no encerrar a quien spawnea solapado. Si se rompe, un
    //    spawn encima del jugador lo clava para siempre.
    //  · PARALELO a una cara no cambia la penetración, y «igual» no es «más»:
    //    sin esto, moverse dentro sería un tobogán hacia la única salida.
    //  · MÁS ADENTRO es lo que se cierra hoy. Antes de #601 la exención era la
    //    CAJA ENTERA y desde dentro se permitía todo, así que bastaba rozar una
    //    esquina en diagonal para cruzar el edificio de lado a lado.
    //
    // El paso hacia dentro es de UN CENTÍMETRO, el mismo grano con el que sondea
    // el resto de esta batería y el que usa `qa/equivalencia-de-cajas.mjs`.
    // Estaba escrito «un centímetro» y movía DIEZ (QA H-4), y el número importa:
    // metiendo en `cajaBloquea` una tolerancia de 2 cm —«se puede entrar un poco
    // por frame», que es lo que escribiría quien creyera que el jugador vibra—
    // con los 10 cm este aserto salía VERDE y el rojo lo daba el vecino
    // («EL ARREGLO DE #489», que sondea ±1 cm desde FUERA); con 1 cm se pone
    // rojo él, que es lo que su texto promete. Medido las dos veces.
    //
    // Lo que sigue sin cerrar, dicho para que nadie lo cuente de más: por debajo
    // del centímetro no lo caza NADIE de este fichero (QA lo midió con 5 mm:
    // 25/25 verdes). El defecto que eso deja pasar mide milímetros y no es
    // observable; lo que sí se nota, un frame entero de 7 cm, lo tumba `verify`.
    const dentro = { x: 10.5, z: 0 };
    assert.equal(aabbBloquea(dentro, { x: 10.6, z: 0 }, R, [forja], conPlan), false, "alejarse del centro nunca bloquea");
    assert.equal(aabbBloquea(dentro, { x: 20, z: 0 }, R, [forja], conPlan), false, "y salir del todo, tampoco");
    assert.equal(aabbBloquea(dentro, { x: 10.5, z: 0.5 }, R, [forja], conPlan), false, "ir paralelo a la cara más cercana deja la penetración IGUAL, y eso no es más adentro");
    assert.equal(aabbBloquea(dentro, { x: 10.49, z: 0 }, R, [forja], conPlan), true, "pero un centímetro MÁS ADENTRO se bloquea");
    // Y desde fuera todo sigue igual que siempre: entrar bloquea.
    assert.equal(aabbBloquea({ x: 20, z: 0 }, dentro, R, [forja], conPlan), true, "entrar desde fuera bloquea");
  });

  it("la PENETRACIÓN se mide por la cara más cercana, no por la distancia al centro", () => {
    // Pegado a la cara norte de la forja y muy escorado al este: la salida más
    // corta es hacia el norte (0,2 m), no hacia el este (0,4 m). Ir al este se
    // acerca al centro en línea recta y aun así NO bloquea, porque la cara que
    // manda es la otra y el margen hacia ella no empeora. Sin el `min` —con una
    // suma, o midiendo al centro— este aserto se cae.
    const esquina = { x: 10 + 2.0, z: 0 + 2.2 };
    assert.equal(aabbBloquea(esquina, { x: 10 + 1.9, z: 2.2 }, R, [forja], conPlan), false, "acercarse al centro por el eje que NO manda no es meterse más");
    assert.equal(aabbBloquea(esquina, { x: 10 + 2.0, z: 2.1 }, R, [forja], conPlan), true, "por el eje que manda, sí");
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

/** LA MISMA POLÍTICA, SIN ORIGEN (#644). `aabbOcupa` contesta «¿está ocupado
 *  este punto?» en vez de «¿me frena este paso?», y es la mitad que le faltaba
 *  al banco: las tres fuentes de solidez son «salir sí, entrar no», así que
 *  contestan que NO por donde uno ya está, y un guion que pregunte con el
 *  jugador dentro de un sólido lee «libre». Medido en el guion 91: 46, 38 y 0
 *  muestras libres de las mismas 121, con el mismo código y dos corridas
 *  verdes. Lo que estos casos afirman es que la respuesta NO cambia la política
 *  —que sería estrenar la segunda copia de #489— y que desde un origen libre
 *  las dos funciones coinciden punto por punto. */
describe("aabbOcupa — la misma caja preguntada sin origen", () => {
  const forja: ObstaculoAabb = { pos: { x: 10, z: 0 }, sizeXZ: { x: 4, z: 4 }, category: "building", dueno: DE_RUNTIME };
  const casa: ObstaculoAabb = { ...forja, dueno: DEL_TILE };

  it("la política es la de aabbBloquea, entera: el mismo bulto ocupa si es del motor y no si el plan del tile responde por él", () => {
    assert.equal(aabbOcupa({ x: 10, z: 0 }, R, [forja], conPlan), true, "la forja del motor ocupa su centro");
    assert.equal(aabbOcupa({ x: 10, z: 0 }, R, [casa], conPlan), false, "la casa del tile con su plan instalado, no");
    assert.equal(aabbOcupa({ x: 10, z: 0 }, R, [casa], sinPlan), true, "y sin plan derivado vuelve a ser su red de seguridad");
    assert.equal(aabbOcupa({ x: 10, z: 0 }, R, [{ ...forja, category: "decor" }], conPlan), false, "lo que no frena, no ocupa");
    assert.equal(aabbOcupa({ x: 10, z: 0 }, R, [{ ...forja, sizeXZ: null }], conPlan), false, "sin huella no hay caja");
    assert.equal(aabbOcupa({ x: 10, z: 0 }, R, [], conPlan), false);
  });

  it("EL DEFECTO DE #644: desde dentro, `aabbBloquea` dice «no te frena» y esto dice «está ocupado»", () => {
    // Las dos respuestas son correctas y contestan a preguntas distintas. La
    // de movimiento es la que el guion 91 estaba leyendo como si fuera la del
    // mundo, y por eso su veredicto dependía de dónde hubiera quedado el
    // jugador: dentro de la forja, «¿me frena ir a 10 cm de aquí?» es que no.
    const dentro = { x: 10.5, z: 0 };
    const unPocoMasAfuera = { x: 10.6, z: 0 };
    assert.equal(aabbBloquea(dentro, unPocoMasAfuera, R, [forja], conPlan), false, "alejarse no se frena (regla de salida)");
    assert.equal(aabbOcupa(unPocoMasAfuera, R, [forja], conPlan), true, "pero ese punto SIGUE ocupado");
    assert.equal(aabbOcupa(dentro, R, [forja], conPlan), true);
  });

  it("y no depende de dónde se pregunte: la respuesta es la misma desde cuatro orígenes, uno de ellos dentro", () => {
    // El aserto que hace inexpresable el defecto. Con `aabbBloquea` este mismo
    // bucle da cuatro veredictos distintos para el mismo punto.
    const p = { x: 11.5, z: 0 };
    for (const origen of [{ x: 0, z: 0 }, { x: 30, z: 30 }, { x: 10, z: 0 }, p]) {
      assert.equal(aabbOcupa(p, R, [forja], conPlan), true, `desde (${origen.x}, ${origen.z})`);
    }
    assert.equal(aabbBloquea(p, p, R, [forja], conPlan), false, "la de movimiento, preguntada sobre sí misma, dice que no");
  });

  it("desde un origen LIBRE las dos coinciden punto por punto: no hay segunda geometría", () => {
    // 1.681 puntos de una rejilla de 4 m alrededor de la forja, comparados uno
    // a uno. Es la equivalencia conocida (`penetracionEnCaja(desde) === 0`), y
    // el sitio donde se vería si `aabbOcupa` naciera midiendo otra cosa —que es
    // el fallo de la tanda G, un candado que montaba el mundo equivocado.
    const libre = { x: -50, z: -50 };
    let comparados = 0;
    let ocupados = 0;
    for (let i = -20; i <= 20; i++) {
      for (let j = -20; j <= 20; j++) {
        const p = { x: 10 + i * 0.2, z: j * 0.2 };
        const ocupa = aabbOcupa(p, R, [forja], conPlan);
        assert.equal(ocupa, aabbBloquea(libre, p, R, [forja], conPlan), `(${p.x}, ${p.z})`);
        comparados++;
        if (ocupa) ocupados++;
      }
    }
    assert.equal(comparados, 41 * 41);
    // Sin esto la comparación se cumpliría con las dos diciendo siempre que no.
    assert.ok(ocupados > 100 && ocupados < comparados, `${ocupados} ocupados de ${comparados}`);
  });

  it("el radio del cuerpo cuenta, igual que en la de movimiento", () => {
    const rozando = { x: 10 - 2.2, z: 0 };
    assert.equal(aabbOcupa(rozando, 0.4, [forja], conPlan), true);
    assert.equal(aabbOcupa(rozando, 0, [forja], conPlan), false);
  });
});

/** LA GEOMETRÍA SOLA, sin la política de quién es cada caja. Se exporta aparte
 *  (#601) porque el bucle de arriba es el del JUGADOR —`category`, `dueno`,
 *  `planAplicadoEn`— y la pregunta «¿este paso mete más adentro?» no es suya:
 *  la misma caja tendrá que frenar a otros cuerpos, y dos geometrías paralelas
 *  es exactamente cómo nació la asimetría que arregla esta tanda. */
describe("penetracionEnCaja / cajaBloquea — cuánto se está metido y si se empuja hacia dentro", () => {
  /** Una caja RECTANGULAR (4×2) y FUERA DEL ORIGEN a propósito. Lo primero
   *  porque con una cuadrada confundir el eje x con el z sale verde; lo segundo
   *  porque con el centro en (0,0) da lo mismo restar que sumar la posición de
   *  la caja, y el mutante del signo sobrevivía por eso en las dos mitades (es
   *  el que la medida de la corrida 35012863832 dejó vivo dos veces). Con radio
   *  0,4 la pared queda a 2,4 m del centro en x y a 1,4 en z. */
  const caja = { pos: { x: 7, z: -3 }, sizeXZ: { x: 4, z: 2 } };
  const en = (dx: number, dz: number) => ({ x: caja.pos.x + dx, z: caja.pos.z + dz });
  /** Sacar la caja del origen mete error de coma flotante en los desplazamientos
   *  (7 + 1,2 − 7 no es 1,2 exacto), así que los metros se comparan con
   *  tolerancia. Lo que se afirma son centímetros, no bits. */
  const cerca = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

  it("fuera es CERO, y el borde exacto cuenta como fuera", () => {
    assert.equal(penetracionEnCaja(en(5, 0), caja, R), 0, "lejos");
    assert.equal(penetracionEnCaja(en(2.4, 0), caja, R), 0, "justo en la pared inflada");
    assert.equal(penetracionEnCaja(en(0, 1.4), caja, R), 0, "y en la del otro eje");
  });

  it("dentro es la salida MÁS CORTA, que en un rectángulo es el eje estrecho", () => {
    // En el centro se sale antes por z (1,4 m) que por x (2,4): el `min` es el
    // que lo dice, y una suma o un producto darían otro número.
    cerca(penetracionEnCaja(caja.pos, caja, R), 1.4, "en el centro se sale por el eje estrecho");
    cerca(penetracionEnCaja(en(2.3, 0), caja, R), 0.1, "pegado a la pared de x, la corta es esa");
  });

  it("el RADIO infla la caja: el mismo punto está más metido con cuerpo que sin él", () => {
    cerca(penetracionEnCaja(caja.pos, caja, 0), 1, "sin cuerpo, media huella y no media huella + radio");
    cerca(penetracionEnCaja(en(1.2, 0), caja, 0), 0.8, "y el eje ancho manda cuando el estrecho no");
  });

  it("bloquea el paso que deja MÁS metido, y solo ese", () => {
    const fuera = en(5, 0);
    const medio = en(0, 0.5);
    assert.equal(cajaBloquea(fuera, caja.pos, R, caja), true, "entrar desde fuera");
    assert.equal(cajaBloquea(caja.pos, fuera, R, caja), false, "salir del todo");
    assert.equal(cajaBloquea(medio, caja.pos, R, caja), true, "de dentro a más dentro");
    assert.equal(cajaBloquea(medio, en(0, 0.6), R, caja), false, "de dentro hacia la cara");
    assert.equal(cajaBloquea(fuera, en(6, 0), R, caja), false, "de fuera a fuera");
    assert.equal(cajaBloquea(medio, medio, R, caja), false, "quedarse quieto NUNCA bloquea: la igualdad no es «más»");
  });

  it("ACERCARSE desde fuera no frena hasta llegar: lo de fuera es CERO, no un número negativo", () => {
    // El jugador que camina hacia el edificio por el eje z, alineado con su
    // centro en x: los dos puntos están FUERA y ninguno puede bloquear. Si el
    // «fuera» se colase como penetración negativa —dejando de comprobar uno de
    // los dos ejes— acercarse sería siempre «más metido que antes» y el jugador
    // chocaría con un muro invisible a cinco metros del edificio.
    assert.equal(penetracionEnCaja(en(0, -5), caja, R), 0, "a 5 m del centro, cero y no −3,6");
    assert.equal(penetracionEnCaja(en(0, -3), caja, R), 0, "a 3 m, cero y no −1,6");
    assert.equal(cajaBloquea(en(0, -5), en(0, -3), R, caja), false, "acercarse por z no frena");
    assert.equal(cajaBloquea(en(-5, 0), en(-3, 0), R, caja), false, "ni por x");
  });
});

/** POR DÓNDE SE SALE (#583, QA H-2). La regla «salir sí, entrar no» dice qué
 *  pasos NO se frenan, y con eso sale solo quien empuja: el jugador con su
 *  teclado. A un NPC hay que decirle hacia dónde, o se queda dentro andando
 *  hacia una meta que está al otro lado. */
describe("salidaDeCaja — la misma medida, mirada del otro lado", () => {
  /** Rectangular (4×2) y fuera del origen, por los mismos dos motivos que la
   *  suite de arriba. Con radio 0,4: 2,4 m en x y 1,4 en z desde el centro. */
  const caja = { pos: { x: 7, z: -3 }, sizeXZ: { x: 4, z: 2 } };
  const en = (dx: number, dz: number) => ({ x: caja.pos.x + dx, z: caja.pos.z + dz });
  const R = 0.4;

  it("fuera no hay salida que dar, y el borde exacto ya es fuera", () => {
    assert.equal(salidaDeCaja(en(3, 0), caja, R), null);
    assert.equal(salidaDeCaja(en(0, 2), caja, R), null);
    assert.equal(salidaDeCaja(en(2.4, 0), caja, R), null, "el borde inflado cuenta como fuera");
  });

  it("dentro, apunta a la cara MÁS CERCANA, que en un rectángulo es el eje estrecho", () => {
    // Desde el centro de una caja 4×2, la salida corta es por z (1,4 contra 2,4).
    assert.deepEqual(salidaDeCaja(en(0, 0), caja, R)?.dir, { x: 0, z: 1 });
    // Pegado a la cara este por dentro: ahora la corta es por x.
    assert.deepEqual(salidaDeCaja(en(2.3, 0), caja, R)?.dir, { x: 1, z: 0 });
    // Y por el lado contrario, al contrario: el signo es el del lado en el que
    // se está. Si no lo fuera, la «salida» metería al NPC más adentro.
    assert.deepEqual(salidaDeCaja(en(-2.3, 0), caja, R)?.dir, { x: -1, z: 0 });
    assert.deepEqual(salidaDeCaja(en(0, -1.3), caja, R)?.dir, { x: 0, z: -1 });
  });

  it("el rumbo es UNITARIO y paralelo a un eje: un paso entero hacia la cara", () => {
    for (const p of [en(0, 0), en(2.3, 0), en(-1, 0.5), en(0, -1.2)]) {
      const dir = salidaDeCaja(p, caja, R)!.dir;
      assert.equal(Math.hypot(dir.x, dir.z), 1, `no unitario en ${JSON.stringify(p)}`);
      assert.ok(dir.x === 0 || dir.z === 0, "la salida más corta de un rectángulo va por un eje");
    }
  });

  it("dice la MISMA penetración que `penetracionEnCaja`, porque es la misma cuenta", () => {
    for (const p of [en(0, 0), en(2.3, 0), en(-1, 0.5), en(0, -1.2), en(3, 0), en(0, 9)]) {
      assert.equal(
        salidaDeCaja(p, caja, R)?.pen ?? 0,
        penetracionEnCaja(p, caja, R),
        `discrepan en ${JSON.stringify(p)}: habría un punto en el que la caja te tiene dentro y la salida no sale`,
      );
    }
  });

  it("el RADIO infla la caja también aquí: con cuerpo se está dentro antes", () => {
    assert.deepEqual(salidaDeCaja(en(2.2, 0), caja, 0.4)?.dir, { x: 1, z: 0 }, "con radio 0,4 está dentro");
    assert.equal(salidaDeCaja(en(2.2, 0), caja, 0.1), null, "sin apenas cuerpo, ya está fuera");
  });
});
