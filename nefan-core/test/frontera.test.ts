/** La frontera del jugador: la única regla de GASTO que decide el jugador.
 *
 *  Cada aserto de aquí es una propuesta de gasto de más o de menos: proponer a
 *  16 m y no a 17, pedir UNA vez y no en cada frame, no volver a proponer lo
 *  que se rechazó hasta alejarse, esperar 15 s tras un error en vez de
 *  re-pedir en bucle con el motor caído. El reloj es un número que entra por
 *  parámetro, así que los 5 minutos del timeout y los 15 s del cooldown se
 *  cruzan sin esperar ni un milisegundo real.
 *
 *  Geometría: tile (0,0) centrado en el origen, 64 m de lado, así que sus
 *  bordes están en ±32. Un jugador en (16,5, 0) está a 15,5 m del borde este. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BLOQUEO_A_M,
  COOLDOWN_TRAS_ERROR_MS,
  Frontera,
  PROPONER_A_M,
  TIMEOUT_DE_TILE_MS,
  VELO_A_M,
  type MotivoDePeticion,
  type PropuestaDeTile,
  type TilesDelPlano,
} from "../src/scene/frontera.js";

// Por el tipo exportado y no desde `world-map/types.js`: ese directorio se mide
// por glob y un import directo desde aquí metería este test en su batería.
type Edge = PropuestaDeTile["edge"];

/** Un plano con los tiles nombrados; `hayGrid` es que exista alguno. */
function plano(...tiles: Array<[number, number]>): TilesDelPlano {
  const claves = new Set(tiles.map(([tx, ty]) => `${tx},${ty}`));
  return {
    get hayGrid() {
      return claves.size > 0;
    },
    tiene: (tx, ty) => claves.has(`${tx},${ty}`),
  };
}

/** Espía de `pedir`: cada llamada tal cual salió hacia el motor. */
function espia(): {
  pedir: (tx: number, ty: number, edge: Edge, motivo: MotivoDePeticion) => void;
  llamadas: Array<[number, number, Edge, MotivoDePeticion]>;
} {
  const llamadas: Array<[number, number, Edge, MotivoDePeticion]> = [];
  return { pedir: (tx, ty, edge, motivo) => void llamadas.push([tx, ty, edge, motivo]), llamadas };
}

describe("Frontera · los umbrales son los que dice el contrato", () => {
  it("16 m para proponer, 8 para el velo, 2 para el bloqueo, 5 min y 15 s", () => {
    // Los números viven en el módulo, pero el test los escribe: si alguien los
    // cambia, esto se pone rojo y hay que decidirlo a la vista.
    assert.equal(PROPONER_A_M, 16);
    assert.equal(VELO_A_M, 8);
    assert.equal(BLOQUEO_A_M, 2);
    assert.equal(TIMEOUT_DE_TILE_MS, 300_000);
    assert.equal(COOLDOWN_TRAS_ERROR_MS, 15_000);
  });
});

describe("Frontera · proponer", () => {
  it("nace sin nada sobre la mesa y con el debugState vacío", () => {
    const f = new Frontera();
    assert.equal(f.propuesta, null);
    assert.deepEqual(f.debugState(), { requested: [], declined: [], proposal: null });
  });

  it("propone el vecino a menos de 16 m del borde, y a 16 m justos no", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    const casi = f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    assert.deepEqual(casi.propuesta, { key: "tile_1_0", tx: 1, ty: 0, edge: "east" });
    assert.equal(f.propuesta, casi.propuesta, "el getter es la misma propuesta que devolvió el tick");
    assert.equal(f.tick(0, 16, 0, plano([0, 0]), pedir).propuesta, null, "a 16,0 m no se propone");
    assert.deepEqual(llamadas, [], "proponer no gasta: nada sale hacia el motor sin confirmar");
  });

  it("propone por los cuatro bordes, cada uno hacia su vecino", () => {
    const casos: Array<[number, number, Edge, number, number]> = [
      [16.5, 0, "east", 1, 0],
      [-16.5, 0, "west", -1, 0],
      [0, 16.5, "south", 0, 1],
      [0, -16.5, "north", 0, -1],
    ];
    for (const [px, pz, edge, tx, ty] of casos) {
      const p = new Frontera().tick(0, px, pz, plano([0, 0]), espia().pedir).propuesta;
      assert.deepEqual(p, { key: `tile_${tx}_${ty}`, tx, ty, edge }, `jugador en (${px}, ${pz})`);
    }
  });

  it("no propone un tile que ya existe", () => {
    const f = new Frontera();
    const r = f.tick(0, 16.5, 0, plano([0, 0], [1, 0]), espia().pedir);
    assert.equal(r.propuesta, null);
    assert.equal(r.velo, null);
  });

  it("con dos bordes cerca gana el más cercano", () => {
    // (20, 24): al este quedan 12 m, al sur 8. Y (24, 20) al revés.
    assert.equal(new Frontera().tick(0, 20, 24, plano([0, 0]), espia().pedir).propuesta?.edge, "south");
    assert.equal(new Frontera().tick(0, 24, 20, plano([0, 0]), espia().pedir).propuesta?.edge, "east");
  });

  it("sin plano continuo no hay frontera: ni propuesta ni velo", () => {
    const f = new Frontera();
    const r = f.tick(0, 31, 0, plano(), espia().pedir);
    assert.deepEqual(r, { velo: null, vencidos: [], propuesta: null });
    assert.equal(f.propuesta, null);
  });

  it("la propuesta de un frame no sobrevive al siguiente si el jugador se aleja", () => {
    const f = new Frontera();
    f.tick(0, 16.5, 0, plano([0, 0]), espia().pedir);
    assert.equal(f.tick(16, 0, 0, plano([0, 0]), espia().pedir).propuesta, null);
    assert.equal(f.propuesta, null);
  });
});

describe("Frontera · confirmar y rechazar", () => {
  it("confirmar pide UNA vez como prefetch y la propuesta desaparece", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    assert.deepEqual(llamadas, [[1, 0, "east", "prefetch"]]);
    assert.equal(f.propuesta, null);
    // Los frames siguientes, en el mismo sitio, no vuelven a pedir ni a proponer.
    for (let t = 16; t <= 160; t += 16) {
      const r = f.tick(t, 16.5, 0, plano([0, 0]), pedir);
      assert.equal(r.propuesta, null, `frame en t=${t}`);
    }
    assert.equal(llamadas.length, 1, "un tile pedido no se re-pide en cada frame");
    assert.deepEqual(f.debugState(), { requested: ["tile_1_0"], declined: [], proposal: null });
  });

  it("confirmar sin propuesta no pide nada", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.confirmar(0, pedir);
    assert.deepEqual(llamadas, []);
  });

  it("rechazar retira la propuesta y no la re-propone mientras siga cerca", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.rechazar();
    assert.equal(f.propuesta, null);
    assert.deepEqual(f.debugState().declined, ["tile_1_0"]);
    for (let t = 16; t <= 160; t += 16) {
      assert.equal(f.tick(t, 20, 0, plano([0, 0]), pedir).propuesta, null, `frame en t=${t}`);
    }
    assert.deepEqual(llamadas, [], "rechazar no gasta");
  });

  it("el rechazo se olvida al alejarse del borde: al volver se re-propone", () => {
    const f = new Frontera();
    f.tick(0, 16.5, 0, plano([0, 0]), espia().pedir);
    f.rechazar();
    // A 16 m justos el tile ya no está «cerca»: el rechazo caduca.
    f.tick(16, 16, 0, plano([0, 0]), espia().pedir);
    assert.deepEqual(f.debugState().declined, []);
    assert.equal(f.tick(32, 16.5, 0, plano([0, 0]), espia().pedir).propuesta?.key, "tile_1_0");
  });

  it("rechazar un borde no veta los otros", () => {
    const f = new Frontera();
    f.tick(0, 20, 24, plano([0, 0]), espia().pedir); // propone el sur
    f.rechazar();
    // Sigue cerca del sur (rechazado) y del este: se propone el este.
    assert.equal(f.tick(16, 20, 24, plano([0, 0]), espia().pedir).propuesta?.edge, "east");
  });

  it("rechazar sin propuesta no deja rastro", () => {
    const f = new Frontera();
    f.rechazar();
    assert.deepEqual(f.debugState().declined, []);
  });
});

describe("Frontera · pegado al borde", () => {
  it("a menos de 2 m de un tile PEDIDO lo promueve a blocking, una sola vez", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    f.tick(16, 30, 0, plano([0, 0]), pedir); // a 2,0 m: todavía no
    assert.equal(llamadas.length, 1, "a 2 m justos no se promueve");
    f.tick(32, 30.5, 0, plano([0, 0]), pedir);
    assert.deepEqual(llamadas.at(-1), [1, 0, "east", "blocking"]);
    f.tick(48, 31, 0, plano([0, 0]), pedir);
    f.tick(64, 31.5, 0, plano([0, 0]), pedir);
    assert.equal(llamadas.length, 2, "blocking se envía una vez, no en cada frame");
  });

  it("pegado a un tile que NO se pidió no se promueve nada: se propone", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    const r = f.tick(0, 31, 0, plano([0, 0]), pedir);
    assert.deepEqual(llamadas, []);
    assert.equal(r.propuesta?.edge, "east");
  });

  it("el velo aparece a menos de 8 m, sobre el borde más cercano, y dice el estado del tile", () => {
    const f = new Frontera();
    const { pedir } = espia();
    assert.equal(f.tick(0, 24, 0, plano([0, 0]), pedir).velo, null, "a 8,0 m no hay velo");
    assert.deepEqual(f.tick(16, 24.5, 0, plano([0, 0]), pedir).velo, { edge: "east", text: "Zona sin generar" });
    // Dos bordes a menos de 8 m: (26, 27) → este 6, sur 5.
    assert.equal(f.tick(32, 26, 27, plano([0, 0]), pedir).velo?.edge, "south");
    // Pedido y sin texto del motor todavía.
    f.tick(48, 24.5, 0, plano([0, 0]), pedir);
    f.confirmar(48, pedir);
    assert.deepEqual(f.tick(64, 24.5, 0, plano([0, 0]), pedir).velo, {
      edge: "east",
      text: "Explorando lo desconocido",
    });
    // El texto que manda el motor por narrative_status sustituye al genérico.
    assert.equal(f.alTexto(1, 0, "Dibujando el robledal"), true);
    assert.equal(f.tick(80, 24.5, 0, plano([0, 0]), pedir).velo?.text, "Dibujando el robledal");
  });

  it("el texto de un tile que nadie pidió no se guarda", () => {
    const f = new Frontera();
    assert.equal(f.alTexto(0, 1, "algo"), false);
    // Y si luego se pide, el velo no lo usa.
    f.tick(0, 0, 24.5, plano([0, 0]), espia().pedir);
    f.confirmar(0, espia().pedir);
    assert.equal(f.tick(16, 0, 24.5, plano([0, 0]), espia().pedir).velo?.text, "Explorando lo desconocido");
  });
});

describe("Frontera · esquina", () => {
  it("con los dos bordes de una esquina pedidos, pide el diagonal una sola vez", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    // (20, 20): sur y este a 12 m; empate → gana el primero en recorrerse (sur).
    f.tick(0, 20, 20, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    assert.deepEqual(llamadas, [[0, 1, "south", "prefetch"]]);
    f.tick(16, 20, 20, plano([0, 0]), pedir);
    assert.equal(llamadas.length, 1, "con un solo borde pedido no hay diagonal");
    f.confirmar(16, pedir);
    assert.deepEqual(llamadas.at(-1), [1, 0, "east", "prefetch"]);
    f.tick(32, 20, 20, plano([0, 0]), pedir);
    assert.deepEqual(llamadas.at(-1), [1, 1, "east", "prefetch"], "el diagonal se pide sin preguntar");
    f.tick(48, 20, 20, plano([0, 0]), pedir);
    f.tick(64, 21, 21, plano([0, 0]), pedir);
    assert.equal(llamadas.length, 3, "el diagonal se pide una vez");
    assert.deepEqual(f.debugState().requested, ["tile_0_1", "tile_1_0", "tile_1_1"]);
  });

  it("el diagonal que ya existe no se pide", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    const mundo = plano([0, 0], [1, 1]);
    f.tick(0, 20, 20, mundo, pedir);
    f.confirmar(0, pedir);
    f.tick(16, 20, 20, mundo, pedir);
    f.confirmar(16, pedir);
    f.tick(32, 20, 20, mundo, pedir);
    assert.equal(llamadas.length, 2);
  });

  it("la esquina sur-oeste pide el diagonal (−1, +1) y lo anuncia por el oeste", () => {
    // El signo del diagonal sale de QUÉ dos bordes están cerca: un dx o un dy
    // equivocado pediría un tile que no toca la esquina.
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.tick(0, -20, 20, plano([0, 0]), pedir); // sur y OESTE
    f.confirmar(0, pedir);
    f.tick(16, -20, 20, plano([0, 0]), pedir);
    f.confirmar(16, pedir);
    f.tick(32, -20, 20, plano([0, 0]), pedir);
    assert.deepEqual(llamadas.at(-1), [-1, 1, "west", "prefetch"]);
  });
});

describe("Frontera · el tiempo", () => {
  it("una petición sin respuesta vence a los 5 minutos y el tile vuelve a ser proponible", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    const justo = f.tick(TIMEOUT_DE_TILE_MS, 16.5, 0, plano([0, 0]), pedir);
    assert.deepEqual(justo.vencidos, [], "a los 5 min justos todavía no ha vencido");
    assert.equal(justo.propuesta, null);
    const vencido = f.tick(TIMEOUT_DE_TILE_MS + 1, 16.5, 0, plano([0, 0]), pedir);
    assert.deepEqual(vencido.vencidos, ["tile_1_0"]);
    assert.deepEqual(f.debugState().requested, []);
    assert.equal(vencido.propuesta?.key, "tile_1_0", "vencida la petición, el mismo frame lo re-propone");
    f.confirmar(TIMEOUT_DE_TILE_MS + 1, pedir);
    assert.equal(llamadas.length, 2, "confirmar de nuevo vuelve a pedir");
  });

  it("los timeouts vencen aunque el plano se haya quedado sin grid", () => {
    const f = new Frontera();
    const { pedir } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    const r = f.tick(TIMEOUT_DE_TILE_MS + 1, 16.5, 0, plano(), pedir);
    assert.deepEqual(r, { velo: null, vencidos: ["tile_1_0"], propuesta: null });
  });

  it("tras un error del bridge el tile no se re-propone hasta pasados 15 s", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    assert.equal(f.alError(1, 0, 1_000), true, "estaba pedido");
    assert.deepEqual(f.debugState().requested, []);
    assert.equal(f.tick(1_000, 16.5, 0, plano([0, 0]), pedir).propuesta, null, "recién fallado");
    assert.equal(f.tick(15_999, 16.5, 0, plano([0, 0]), pedir).propuesta, null, "a 14,999 s aún en cooldown");
    assert.equal(f.tick(16_000, 16.5, 0, plano([0, 0]), pedir).propuesta?.key, "tile_1_0", "a 15 s se re-propone");
    assert.equal(llamadas.length, 1, "en el cooldown no salió nada hacia el motor");
    // Y confirmar tras el cooldown vuelve a pedir: el error se olvidó.
    f.confirmar(16_000, pedir);
    assert.equal(llamadas.length, 2);
  });

  it("el cooldown se mide con el reloj que entra, no con ningún otro", () => {
    // Si `alError` leyera su propio reloj (lo que hacía en el cliente con
    // performance.now()), un `now` de tick muy anterior al de pared —como el de
    // este test, que empieza en 0— vería el cooldown eterno o inexistente.
    const f = new Frontera();
    const { pedir } = espia();
    f.tick(1_000_000, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(1_000_000, pedir);
    f.alError(1, 0, 1_000_000);
    assert.equal(f.tick(1_000_000 + 14_999, 16.5, 0, plano([0, 0]), pedir).propuesta, null);
    assert.equal(f.tick(1_000_000 + 15_000, 16.5, 0, plano([0, 0]), pedir).propuesta?.key, "tile_1_0");
  });

  it("el error de un tile que no estaba pedido lo dice, y aun así lo enfría", () => {
    const f = new Frontera();
    assert.equal(f.alError(1, 0, 0), false);
    assert.equal(f.tick(0, 16.5, 0, plano([0, 0]), espia().pedir).propuesta, null);
    assert.equal(f.tick(15_000, 16.5, 0, plano([0, 0]), espia().pedir).propuesta?.key, "tile_1_0");
  });

  it("el error borra el texto y el blocking del tile: al re-pedirlo empieza limpio", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.tick(0, 30.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    f.alTexto(1, 0, "a medias");
    f.tick(16, 30.5, 0, plano([0, 0]), pedir); // blocking
    assert.equal(llamadas.length, 2);
    f.alError(1, 0, 16);
    f.tick(15_016, 30.5, 0, plano([0, 0]), pedir);
    f.confirmar(15_016, pedir);
    assert.equal(f.tick(15_032, 30.5, 0, plano([0, 0]), pedir).velo?.text, "Explorando lo desconocido");
    assert.deepEqual(llamadas.at(-1), [1, 0, "east", "blocking"], "el blocking se vuelve a enviar para la petición nueva");
    assert.equal(llamadas.length, 4);
  });
});

describe("Frontera · el tile llega", () => {
  it("devuelve el borde del jugador hacia el tile nuevo y lo desmarca", () => {
    const f = new Frontera();
    const { pedir } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    f.alTexto(1, 0, "casi");
    assert.equal(f.alTileListo(1, 0, 16.5, 0), "east");
    assert.deepEqual(f.debugState().requested, []);
    assert.equal(f.alTexto(1, 0, "tarde"), false, "ya no está pedido");
    // Con el tile puesto en el plano no vuelve a proponerse.
    assert.equal(f.tick(16, 16.5, 0, plano([0, 0], [1, 0]), pedir).propuesta, null);
  });

  it("un tile que no es vecino inmediato devuelve null (sin aviso direccional)", () => {
    const f = new Frontera();
    assert.equal(f.alTileListo(1, 0, 16.5, 100), null, "el jugador está en otro tile");
    assert.equal(f.alTileListo(3, 3, 0, 0), null);
  });

  it("el borde es el del tile que PISA el jugador, no el del origen", () => {
    const f = new Frontera();
    // El jugador ya cruzó al tile (1,0): el (2,0) le queda al este y el (0,0) al oeste.
    assert.equal(f.alTileListo(2, 0, 64, 0), "east");
    assert.equal(f.alTileListo(0, 0, 64, 0), "west");
    assert.equal(f.alTileListo(1, -1, 64, 0), "north");
    assert.equal(f.alTileListo(1, 1, 64, 0), "south");
  });
});

/** #517 · La `Frontera` del cliente es una instancia de MÓDULO: vive lo que
 *  vive la pestaña, y lo que guarda son claves de tile (`tile_1_0`) que
 *  significan un sitio distinto en cada mundo. Sin este olvido, cambiar de
 *  partida heredaba las cinco cosas de aquí abajo, y cada una calla o desvía
 *  la única regla de gasto que decide el jugador. */
describe("Frontera · cambiar de partida", () => {
  it("lo PEDIDO en la partida anterior no sigue en vuelo: el vecino se vuelve a ofrecer", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    assert.deepEqual(f.debugState().requested, ["tile_1_0"], "el tile quedó pedido");

    f.olvidarLaPartida();

    assert.deepEqual(f.debugState().requested, []);
    // Y es proponible otra vez: sin el olvido, `#puedeProponer` sale por
    // `#pedidos` y ese borde no se ofrece nunca más en toda la pestaña.
    const frame = f.tick(1, 16.5, 0, plano([0, 0]), pedir);
    assert.deepEqual(frame.propuesta, { key: "tile_1_0", tx: 1, ty: 0, edge: "east" });
    assert.equal(llamadas.length, 1, "olvidar no pide nada por su cuenta: no gasta");
  });

  it("el RECHAZO de la partida anterior no calla la propuesta de la nueva", () => {
    const f = new Frontera();
    const { pedir } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.rechazar();
    assert.deepEqual(f.debugState().declined, ["tile_1_0"]);
    // Sin olvidar, el rechazo solo caduca alejándose 16 m del borde — que en
    // el mundo nuevo puede ser justo donde arranca el jugador.
    assert.equal(f.tick(1, 16.5, 0, plano([0, 0]), pedir).propuesta, null);

    f.olvidarLaPartida();

    assert.deepEqual(f.debugState().declined, []);
    assert.equal(f.tick(2, 16.5, 0, plano([0, 0]), pedir).propuesta?.key, "tile_1_0");
  });

  it("el COOLDOWN de un error de la partida anterior no enfría la nueva", () => {
    const f = new Frontera();
    const { pedir } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    f.alError(1, 0, 1_000);
    assert.equal(f.tick(2_000, 16.5, 0, plano([0, 0]), pedir).propuesta, null, "enfriado");

    f.olvidarLaPartida();

    assert.equal(
      f.tick(2_001, 16.5, 0, plano([0, 0]), pedir).propuesta?.key,
      "tile_1_0",
      "en la partida nueva el error de la anterior no cuenta",
    );
  });

  it("el TEXTO de estado heredado no pinta «explorando» sobre un tile que nadie pidió", () => {
    const f = new Frontera();
    const { pedir } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    assert.equal(f.alTexto(1, 0, "Levantando el molino"), true);
    assert.equal(f.tick(1, 25, 0, plano([0, 0]), pedir).velo?.text, "Levantando el molino");

    f.olvidarLaPartida();

    assert.equal(
      f.tick(2, 25, 0, plano([0, 0]), pedir).velo?.text,
      "Zona sin generar",
      "el velo del mundo nuevo dice la verdad de ESTE mundo",
    );
  });

  it("la PROPUESTA sobre la mesa se retira, y el blocking vuelve a poder enviarse", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.tick(0, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(0, pedir);
    f.tick(1, 31, 0, plano([0, 0]), pedir); // a 1 m: promueve a blocking
    assert.deepEqual(llamadas.at(-1), [1, 0, "east", "blocking"]);
    f.tick(2, 16.5, 0, plano([0, 0]), pedir);

    f.olvidarLaPartida();
    assert.equal(f.propuesta, null);

    // Mundo nuevo, mismo borde: se propone, se confirma y el blocking sale
    // otra vez. Sin olvidar `#bloqueoEnviado`, el jugador pegado al muro de la
    // partida nueva esperaba detrás de la cola de prefetch para siempre.
    f.tick(3, 16.5, 0, plano([0, 0]), pedir);
    f.confirmar(3, pedir);
    f.tick(4, 31, 0, plano([0, 0]), pedir);
    assert.deepEqual(llamadas.slice(-2), [
      [1, 0, "east", "prefetch"],
      [1, 0, "east", "blocking"],
    ]);
  });

  it("olvidar sin nada que olvidar no rompe el frame siguiente", () => {
    const f = new Frontera();
    const { pedir, llamadas } = espia();
    f.olvidarLaPartida();
    assert.deepEqual(f.debugState(), { requested: [], declined: [], proposal: null });
    assert.deepEqual(f.tick(0, 0, 0, plano(), pedir), { velo: null, vencidos: [], propuesta: null });
    assert.equal(llamadas.length, 0);
  });
});
