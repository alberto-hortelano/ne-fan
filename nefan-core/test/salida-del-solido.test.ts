/** LA CONSULTA DE PUNTO SOBRE EL TERRENO (#616) — y el candado de que NO hay
 *  una segunda geometría.
 *
 *  El aserto central de este fichero no es «la función devuelve lo que espero»
 *  sino «la función devuelve LO MISMO que la que ya existía para las cajas».
 *  Es el único sitio donde eso se puede comprobar: sobre un rectángulo
 *  RASTERIZADO en celdas, `salidaDeCaja` (aritmética de rectángulo, #601) y
 *  `salidaDelSolido` (marcha por fronteras de celda) miden el mismo sólido por
 *  dos caminos completamente distintos. Si discrepan, el jugador vive en una
 *  geometría y el NPC en la otra.
 *
 *  Y es FÁCIL fallarlo: la sonda del plan de la tanda G cometió de verdad los
 *  dos errores que el módulo documenta —marchar por el borde DELANTERO (|Δpen|
 *  0,20 m) y usar el solape CERRADO (la penetración se clava en las fronteras
 *  de celda)— con la batería entera en verde. La orla del radio está en la
 *  malla a propósito: es donde vive la diferencia. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createTerrainCollider,
  NPC_RADIUS_M,
  PLAYER_RADIUS_M,
  type TerrainGridData,
} from "../src/scene/terrain-collision.js";
import { penetracionEnCaja, salidaDeCaja, type CajaXZ } from "../src/simulation/obstaculos-del-jugador.js";
import {
  penetracionEnSolido,
  salidaDelSolido,
  sitioParaAparecer,
  solidoBloquea,
  TOPE_MARCHA_M,
  type SueloSolido,
} from "../src/simulation/salida-del-solido.js";
import { COTA_TILE, TILE_CELLS, TILE_MPC, tileWorldRect } from "../src/scene/tile.js";

/** Tolerancia de comparación entre las dos cuentas. El nanómetro es el mismo
 *  umbral de empate que usa el módulo; el ruido real medido es 5,7e-15 m. */
const EPS_M = 1e-9;

/** Un macizo rectangular rasterizado en celdas, con su caja EQUIVALENTE: los
 *  bordes de la caja son exactamente los de las celdas sólidas. */
function macizo(
  origin: [number, number],
  celdas: { cols: number; rows: number; c0: number; c1: number; r0: number; r1: number },
): { tg: TerrainGridData; suelo: SueloSolido; caja: CajaXZ } {
  const { cols, rows, c0, c1, r0, r1 } = celdas;
  const grid: string[] = [];
  for (let r = 0; r < rows; r++) {
    let fila = "";
    for (let c = 0; c < cols; c++) fila += r >= r0 && r <= r1 && c >= c0 && c <= c1 ? "S" : "g";
    grid.push(fila);
  }
  const tg: TerrainGridData = { grid, cols, rows, meters_per_cell: TILE_MPC, origin, solid_chars: ["S"] };
  const col = createTerrainCollider(tg)!;
  const X0 = origin[0] + c0 * TILE_MPC;
  const X1 = origin[0] + (c1 + 1) * TILE_MPC;
  const Z0 = origin[1] + r0 * TILE_MPC;
  const Z1 = origin[1] + (r1 + 1) * TILE_MPC;
  return {
    tg,
    suelo: { ocupado: (x, z, r) => col.solapaSolido(x, z, r) },
    caja: { pos: { x: (X0 + X1) / 2, z: (Z0 + Z1) / 2 }, sizeXZ: { x: X1 - X0, z: Z1 - Z0 } },
  };
}

/** Los casos del acuerdo: tamaños, radios y orígenes distintos —incluido uno
 *  en coordenadas negativas y otro lejos del origen del mundo, que es donde el
 *  redondeo de la marcha tiene más dígitos que perder. */
const CASOS = [
  { nombre: "5 × 7 m (un edificio de robledo), cuerpo del jugador", origin: [-16, -16] as [number, number], celdas: { cols: 64, rows: 64, c0: 20, c1: 29, r0: 20, r1: 33 }, radio: PLAYER_RADIUS_M },
  { nombre: "5 × 7 m, cuerpo del NPC (el mayor del juego)", origin: [-16, -16] as [number, number], celdas: { cols: 64, rows: 64, c0: 20, c1: 29, r0: 20, r1: 33 }, radio: NPC_RADIUS_M },
  { nombre: "1 × 1 m (un pozo), lejos del origen del mundo", origin: [32, 48] as [number, number], celdas: { cols: 64, rows: 64, c0: 10, c1: 11, r0: 40, r1: 41 }, radio: PLAYER_RADIUS_M },
  { nombre: "12 × 12 m, en coordenadas negativas", origin: [-48, -32] as [number, number], celdas: { cols: 64, rows: 64, c0: 5, c1: 28, r0: 7, r1: 30 }, radio: PLAYER_RADIUS_M },
  { nombre: "banda de 1 m (más estrecha que el cuerpo del NPC)", origin: [-16, -16] as [number, number], celdas: { cols: 64, rows: 64, c0: 33, c1: 34, r0: 10, r1: 40 }, radio: NPC_RADIUS_M },
];

describe("salidaDelSolido — la misma geometría que la caja, medida por celdas", () => {
  it("penetración y rumbo coinciden con `salidaDeCaja` sobre el macizo rasterizado, orla del radio incluida", () => {
    let puntos = 0;
    let maxDpen = 0;
    let empates = 0;
    let piel = 0;
    const paso = TILE_MPC / 8;

    for (const { nombre, origin, celdas, radio } of CASOS) {
      const { suelo, caja } = macizo(origin, celdas);
      const X0 = caja.pos.x - caja.sizeXZ.x / 2;
      const X1 = caja.pos.x + caja.sizeXZ.x / 2;
      const Z0 = caja.pos.z - caja.sizeXZ.z / 2;
      const Z1 = caja.pos.z + caja.sizeXZ.z / 2;

      for (let x = X0 - radio - paso; x <= X1 + radio + paso; x += paso) {
        for (let z = Z0 - radio - paso; z <= Z1 + radio + paso; z += paso) {
          puntos++;
          const deLaCaja = salidaDeCaja({ x, z }, caja, radio);
          const delSolido = salidaDelSolido(x, z, radio, suelo);
          const margenX = caja.sizeXZ.x / 2 + radio - Math.abs(x - caja.pos.x);
          const margenZ = caja.sizeXZ.z / 2 + radio - Math.abs(z - caja.pos.z);
          // A menos de un nanómetro de la superficie las dos cuentas deciden
          // por el último bit, y no es geometría: es ruido. Se cuenta y se
          // imprime en vez de callarlo.
          const enLaPiel = Math.min(margenX, margenZ) <= EPS_M && Math.min(margenX, margenZ) >= -EPS_M;

          // 1 · DENTRO/FUERA: el solape abierto de `ocupado` y el `margen <= 0`
          // de la caja tienen que decir lo mismo en todo punto que no esté en
          // esa piel. Con el solape CERRADO esto se rompe a media celda de
          // distancia, que no es ruido.
          if ((delSolido !== null) !== (deLaCaja !== null)) {
            assert.ok(
              enLaPiel,
              `${nombre}: (${x}, ${z}) — la caja dice dentro=${deLaCaja !== null} y el sólido dentro=${delSolido !== null} ` +
                `con margen ${Math.min(margenX, margenZ)} m: eso no es tangencia, es otra geometría`,
            );
            piel++;
            continue;
          }
          if (!deLaCaja || !delSolido) continue;

          // 2 · LA PENETRACIÓN, que es la geometría propiamente dicha.
          const dpen = Math.abs(deLaCaja.pen - delSolido.pen);
          if (dpen > maxDpen) maxDpen = dpen;
          assert.ok(
            dpen <= EPS_M,
            `${nombre}: (${x}, ${z}) — pen caja ${deLaCaja.pen} vs sólido ${delSolido.pen} (Δ ${dpen})`,
          );

          // 3 · EL RUMBO. Solo se permite discrepar donde las dos caras están a
          // la MISMA distancia: ahí las dos salidas son mínimas y el desempate
          // es convención, no geometría (la caja desempata con `margenX <=
          // margenZ` sin épsilon, así que su último bit decide). Cualquier otra
          // discrepancia es una segunda geometría y pone esto rojo.
          if (deLaCaja.dir.x !== delSolido.dir.x || deLaCaja.dir.z !== delSolido.dir.z) {
            assert.ok(
              Math.abs(margenX - margenZ) <= EPS_M,
              `${nombre}: (${x}, ${z}) — rumbos distintos SIN empate: caja ${JSON.stringify(deLaCaja.dir)} ` +
                `vs sólido ${JSON.stringify(delSolido.dir)} (margenX ${margenX}, margenZ ${margenZ})`,
            );
            empates++;
          }
        }
      }
    }
    // Un acuerdo sobre cuatro puntos no dice nada: que la malla sea grande es
    // parte del aserto.
    assert.ok(puntos > 70000, `la malla tiene que ser grande para que esto mida: ${puntos} puntos`);
    console.log(
      `    · acuerdo con salidaDeCaja: ${puntos} puntos · |Δpen| máx ${maxDpen.toExponential(2)} m · ` +
        `${empates} empates exactos con rumbo distinto (los dos mínimos) · ${piel} puntos en la piel (|margen| ≤ 1 nm)`,
    );
  });

  it("el solape es ABIERTO: el cuerpo que solo TOCA el borde de una celda sólida NO está dentro", () => {
    // Cuadrante sólido a partir de (2, 2) en mundo. El cuerpo con su borde
    // derecho EXACTAMENTE en x = 2 toca la celda y no la solapa.
    const { suelo } = macizo([0, 0], { cols: 8, rows: 8, c0: 4, c1: 7, r0: 4, r1: 7 });
    const tangente = 2 - PLAYER_RADIUS_M;
    assert.equal(suelo.ocupado(tangente, 2.25, PLAYER_RADIUS_M), false, "tangencia exacta: fuera");
    assert.equal(penetracionEnSolido(tangente, 2.25, PLAYER_RADIUS_M, suelo), 0);
    assert.equal(salidaDelSolido(tangente, 2.25, PLAYER_RADIUS_M, suelo), null);
    // Medio milímetro más adentro sí solapa, y la penetración es ese medio
    // milímetro: con el solape CERRADO saltaría a media celda.
    const dentro = tangente + 0.0005;
    assert.ok(suelo.ocupado(dentro, 2.25, PLAYER_RADIUS_M));
    assert.ok(
      Math.abs(penetracionEnSolido(dentro, 2.25, PLAYER_RADIUS_M, suelo) - 0.0005) < 1e-12,
      "la penetración NO se clava en la frontera de celda",
    );
  });

  it("DE DENTRO SE SALE: desde todo punto ocupado el rumbo de salida baja la penetración y nadie lo frena", () => {
    // Es el observable de #616: hoy, en un macizo de 5 × 7 m, 0 de 36 rumbos
    // sacaban a nadie.
    const { suelo, caja } = macizo([-16, -16], { cols: 64, rows: 64, c0: 20, c1: 29, r0: 20, r1: 33 });
    const radio = PLAYER_RADIUS_M;
    const paso = TILE_MPC / 4;
    let dentro = 0;
    let maxPen = 0;
    let maxPasos = 0;

    for (let x = caja.pos.x - caja.sizeXZ.x / 2; x <= caja.pos.x + caja.sizeXZ.x / 2; x += paso) {
      for (let z = caja.pos.z - caja.sizeXZ.z / 2; z <= caja.pos.z + caja.sizeXZ.z / 2; z += paso) {
        if (!suelo.ocupado(x, z, radio)) continue;
        dentro++;
        let p = { x, z };
        let pen = penetracionEnSolido(p.x, p.z, radio, suelo);
        maxPen = Math.max(maxPen, pen);
        let pasos = 0;
        // Se anda a la velocidad del jugador a 60 fps (0,075 m por frame),
        // que es como se sale de verdad — no de un salto.
        while (suelo.ocupado(p.x, p.z, radio)) {
          const salida = salidaDelSolido(p.x, p.z, radio, suelo)!;
          const avance = Math.min(0.075, salida.pen);
          const siguiente = { x: p.x + salida.dir.x * avance, z: p.z + salida.dir.z * avance };
          assert.ok(
            !solidoBloquea(p, siguiente, radio, suelo),
            `(${x}, ${z}): el paso que SACA está frenado — eso es el estado sin salida de #616`,
          );
          const penSiguiente = penetracionEnSolido(siguiente.x, siguiente.z, radio, suelo);
          assert.ok(penSiguiente < pen, `(${x}, ${z}): la penetración no baja (${pen} → ${penSiguiente})`);
          p = siguiente;
          pen = penSiguiente;
          pasos++;
          assert.ok(pasos < 200, `(${x}, ${z}): no sale en 200 frames`);
        }
        maxPasos = Math.max(maxPasos, pasos);
      }
    }
    assert.ok(dentro > 500, `el macizo tiene que tener puntos que medir: ${dentro}`);
    console.log(
      `    · ${dentro} puntos dentro del macizo de 5 × 7 m · penetración máxima ${maxPen.toFixed(3)} m · ` +
        `el peor sale en ${maxPasos} frames (${(maxPasos / 60).toFixed(2)} s)`,
    );
  });

  it("DESDE FUERA no cambia nada: entrar bloquea, moverse en abierto no", () => {
    const { suelo, caja } = macizo([-16, -16], { cols: 64, rows: 64, c0: 20, c1: 29, r0: 20, r1: 33 });
    const fuera = { x: caja.pos.x - caja.sizeXZ.x / 2 - 2, z: caja.pos.z };
    const adentro = { x: caja.pos.x, z: caja.pos.z };
    assert.ok(solidoBloquea(fuera, adentro, PLAYER_RADIUS_M, suelo), "entrar al edificio bloquea");
    assert.ok(
      !solidoBloquea(fuera, { x: fuera.x - 1, z: fuera.z }, PLAYER_RADIUS_M, suelo),
      "alejarse por campo abierto no bloquea",
    );
  });

  it("origen = destino NUNCA bloquea, esté dentro o fuera", () => {
    // Lo que sujeta el bloque 2 de `qa/la-puerta-de-la-reaparicion.mjs` y el
    // `porque` de la reaparición: preguntado por el punto en el que se está, el
    // veredicto es `false` por construcción (`pen(p) > pen(p)` es falso, y con
    // el origen libre es `ocupado(p)`, que también lo es). Ya sin la excepción
    // de la TANGENCIA que tenía la regla de celdas.
    const { suelo, caja } = macizo([-16, -16], { cols: 64, rows: 64, c0: 20, c1: 29, r0: 20, r1: 33 });
    const paso = TILE_MPC / 2;
    let n = 0;
    for (let x = caja.pos.x - 8; x <= caja.pos.x + 8; x += paso) {
      for (let z = caja.pos.z - 8; z <= caja.pos.z + 8; z += paso) {
        const p = { x, z };
        assert.equal(solidoBloquea(p, p, PLAYER_RADIUS_M, suelo), false, `(${x}, ${z}) se ve sólido a sí mismo`);
        n++;
      }
    }
    assert.ok(n > 1000);
    const tangente = { x: -6 - PLAYER_RADIUS_M, z: -1 };
    assert.equal(solidoBloquea(tangente, tangente, PLAYER_RADIUS_M, suelo), false, "tangencia exacta tampoco");
  });

  it("el desempate es el de `salidaDeCaja`: X antes que Z, y `+` antes que `−`", () => {
    // Macizo CUADRADO y cuerpo en su centro exacto: los cuatro ejes empatan.
    const { suelo, caja } = macizo([0, 0], { cols: 16, rows: 16, c0: 4, c1: 11, r0: 4, r1: 11 });
    const salida = salidaDelSolido(caja.pos.x, caja.pos.z, PLAYER_RADIUS_M, suelo)!;
    assert.deepEqual(salida.dir, { x: 1, z: 0 });
    assert.deepEqual(salidaDeCaja(caja.pos, caja, PLAYER_RADIUS_M)!.dir, salida.dir, "y es el mismo que el de la caja");
  });

  it("un sólido más ancho que el tope SATURA en vez de descartarse", () => {
    // 100 × 100 m macizos: ningún eje ve el borde desde el centro.
    const cols = Math.ceil(100 / TILE_MPC);
    const { suelo } = macizo([0, 0], { cols, rows: cols, c0: 0, c1: cols - 1, r0: 0, r1: cols - 1 });
    const centro = { x: 50, z: 50 };
    assert.equal(penetracionEnSolido(centro.x, centro.z, PLAYER_RADIUS_M, suelo), TOPE_MARCHA_M);
    // Y dentro de esa masa nada frena: es lo honesto, no un encierro.
    assert.equal(solidoBloquea(centro, { x: 51, z: 50 }, PLAYER_RADIUS_M, suelo), false);
    // Cerca del borde vuelve a haber gradiente y el rumbo apunta a la salida.
    const junto = { x: 3, z: 50 };
    const salida = salidaDelSolido(junto.x, junto.z, PLAYER_RADIUS_M, suelo)!;
    assert.deepEqual(salida.dir, { x: -1, z: 0 });
    assert.ok(Math.abs(salida.pen - (3 + PLAYER_RADIUS_M)) < EPS_M);
  });

  it("sitioParaAparecer: el candidato libre no se toca, y el ocupado sale a la PUERTA", () => {
    const { suelo, caja } = macizo([-16, -16], { cols: 64, rows: 64, c0: 20, c1: 29, r0: 20, r1: 33 });
    const radio = PLAYER_RADIUS_M;

    const libre = { x: caja.pos.x - 10, z: caja.pos.z };
    assert.deepEqual(sitioParaAparecer(libre, radio, suelo), libre, "un sitio libre se respeta tal cual");

    // El centro del edificio: es EXACTAMENTE el punto que devuelve hoy
    // `resolvePlaceTarget` para un lugar anclado a él (la mitad de ARRIBA de
    // #616), y es estado sin salida.
    assert.ok(suelo.ocupado(caja.pos.x, caja.pos.z, radio), "control: el centro del edificio está ocupado");
    const sitio = sitioParaAparecer(caja.pos, radio, suelo)!;
    assert.notEqual(sitio, null);
    assert.equal(suelo.ocupado(sitio.x, sitio.z, radio), false, "el punto devuelto tiene que estar LIBRE");
    const desplazamiento = Math.hypot(sitio.x - caja.pos.x, sitio.z - caja.pos.z);
    // La menor penetración = el desplazamiento mínimo: se aparece en la puerta
    // del lugar, no a un tile de distancia.
    const semiMenor = Math.min(caja.sizeXZ.x, caja.sizeXZ.z) / 2 + radio;
    assert.ok(
      desplazamiento <= semiMenor + EPS_M,
      `desplazamiento ${desplazamiento} m: tendría que ser el mínimo (${semiMenor} m)`,
    );
  });

  it("sitioParaAparecer devuelve `null` —fail-loud— cuando no hay sitio al que salir", () => {
    // 400 × 400 m macizos: cuatro marchas al tope (160 m) y sigue dentro.
    const cols = Math.ceil(400 / TILE_MPC);
    const { suelo } = macizo([0, 0], { cols, rows: cols, c0: 0, c1: cols - 1, r0: 0, r1: cols - 1 });
    assert.equal(sitioParaAparecer({ x: 200, z: 200 }, PLAYER_RADIUS_M, suelo), null);
  });

  it("el alcance de `sitioParaAparecer` son CUATRO marchas de 40 m: a 155 m se sale, a 180 no", () => {
    // El mismo macizo de 400 × 400 m del caso de arriba, y los dos lados de la
    // regla. Por qué hacen falta los DOS puntos y por qué el (200, 200) de
    // arriba no vale para esto: desde el centro exacto la quinta marcha
    // también satura, así que dar un paso de más no cambia el veredicto. Desde
    // (220, 200) sí lo cambia —la quinta marcha ya ve la cara— y desde
    // (245, 200) la cuarta la alcanza, que es donde se lee el paso de salida.
    const cols = Math.ceil(400 / TILE_MPC);
    const { suelo } = macizo([0, 0], { cols, rows: cols, c0: 0, c1: cols - 1, r0: 0, r1: cols - 1 });
    const radio = PLAYER_RADIUS_M;

    // 180 m hasta la cara +X: 4 × 40 = 160 se quedan cortos y es `null`.
    assert.ok(suelo.ocupado(220, 200, radio), "control: el punto de partida está dentro");
    assert.equal(sitioParaAparecer({ x: 220, z: 200 }, radio, suelo), null, "a 180 m de la cara no se llega en cuatro marchas");

    // 155 m: la cuarta marcha ya ve la cara y devuelve el punto de salida.
    assert.ok(suelo.ocupado(245, 200, radio), "control: el punto de partida está dentro");
    const sitio = sitioParaAparecer({ x: 245, z: 200 }, radio, suelo);
    assert.deepEqual(sitio, { x: 400 + radio, z: 200 }, "se sale por la cara +X, que es la más cercana");
    assert.equal(suelo.ocupado(sitio!.x, sitio!.z, radio), false, "y el punto queda LIBRE");
  });

  it("cuando la salida va por Z, `sitioParaAparecer` no mueve la X ni un ulp", () => {
    // Una banda de 1 m de grosor en Z y 15,5 m de largo en X: la transpuesta
    // de la «banda de 1 m» de CASOS. Aquí el eje corto es Z SIEMPRE, así que
    // el punto devuelto conserva la X del candidato exactamente.
    //
    // No es un detalle cosmético: es el único caso en el que se llega a MIRAR
    // la coordenada Z del corte de progreso (`siguiente.z === p.z`). Con la
    // salida por X ese `&&` se corta antes y la mitad derecha no se ejecuta
    // nunca — que es por lo que estaba sin cubrir.
    for (const radio of [PLAYER_RADIUS_M, NPC_RADIUS_M]) {
      const { suelo, caja } = macizo([-16, -16], { cols: 64, rows: 64, c0: 10, c1: 40, r0: 33, r1: 34 });
      const X0 = caja.pos.x - caja.sizeXZ.x / 2;
      const X1 = caja.pos.x + caja.sizeXZ.x / 2;
      let dentro = 0;
      for (let x = X0 + 0.6; x <= X1 - 0.6; x += 0.25) {
        for (let z = caja.pos.z - 0.4; z <= caja.pos.z + 0.4; z += 0.2) {
          if (!suelo.ocupado(x, z, radio)) continue;
          dentro++;
          const sitio = sitioParaAparecer({ x, z }, radio, suelo);
          assert.notEqual(sitio, null, `(${x}, ${z}) radio ${radio}: de una banda de 1 m se sale`);
          assert.equal(sitio!.x, x, `(${x}, ${z}) radio ${radio}: la salida es por Z, la X no se toca`);
          assert.equal(suelo.ocupado(sitio!.x, sitio!.z, radio), false, `(${x}, ${z}) radio ${radio}: el punto devuelto tiene que quedar libre`);
        }
      }
      // Un punto suelto no distinguiría la regla de su contraria.
      assert.ok(dentro > 200, `la banda tiene que tener puntos que medir: ${dentro}`);
    }
  });

  it("DESDE DENTRO `solidoBloquea` frena lo que mete más adentro — y solo eso", () => {
    // Lo que el resto del fichero NO mira: todos los asertos de `solidoBloquea`
    // de aquí arriba salen `false` o entran desde FUERA (el corte en seco del
    // origen libre). Con el origen DENTRO nadie comprobaba que frenar siga
    // ocurriendo, así que la función podía contestar «desde dentro no frena
    // nada nunca» sin que se enterase nadie.
    //
    // El veredicto esperado NO se calcula con este módulo: se calcula con
    // `salidaDeCaja`, la otra geometría, que es la premisa de todo el fichero.
    // Se saltan los empates —donde las dos cuentas deciden por el último bit,
    // igual que en el aserto de acuerdo de arriba— y los pasos que salen del
    // sólido, para que el que mande sea siempre la rama de dentro.
    for (const radio of [PLAYER_RADIUS_M, NPC_RADIUS_M]) {
      const { suelo, caja } = macizo([-16, -16], { cols: 64, rows: 64, c0: 20, c1: 29, r0: 20, r1: 33 });
      const penCaja = (p: { x: number; z: number }) => salidaDeCaja(p, caja, radio)?.pen ?? 0;
      const X0 = caja.pos.x - caja.sizeXZ.x / 2;
      const X1 = caja.pos.x + caja.sizeXZ.x / 2;
      const Z0 = caja.pos.z - caja.sizeXZ.z / 2;
      const Z1 = caja.pos.z + caja.sizeXZ.z / 2;
      const paso = 0.25;
      let frena = 0;
      let deja = 0;

      for (let x = X0 + 0.1; x <= X1 - 0.1; x += paso) {
        for (let z = Z0 + 0.1; z <= Z1 - 0.1; z += paso) {
          const desde = { x, z };
          if (!suelo.ocupado(x, z, radio)) continue;
          for (const [dx, dz] of [[paso, 0], [-paso, 0], [0, paso], [0, -paso]]) {
            const hasta = { x: x + dx, z: z + dz };
            if (!suelo.ocupado(hasta.x, hasta.z, radio)) continue;
            const penDesde = penCaja(desde);
            const penHasta = penCaja(hasta);
            if (Math.abs(penHasta - penDesde) <= EPS_M) continue;
            const esperado = penHasta > penDesde;
            assert.equal(
              solidoBloquea(desde, hasta, radio, suelo),
              esperado,
              `radio ${radio}: (${x}, ${z}) → (${hasta.x}, ${hasta.z}) — la caja dice pen ${penDesde} → ${penHasta}, ` +
                `así que frenar tendría que ser ${esperado}`,
            );
            if (esperado) frena++;
            else deja++;
          }
        }
      }
      // Los DOS veredictos, y en cantidad: con solo uno de ellos este aserto no
      // distinguiría la regla de la constante que siempre contesta lo mismo.
      assert.ok(frena > 100, `tiene que haber pasos FRENADOS desde dentro: ${frena}`);
      assert.ok(deja > 100, `y pasos que NO se frenan desde dentro: ${deja}`);
    }
  });

  it("un suelo sin sólidos no tiene penetración ni salida, y no frena nada", () => {
    const vacio: SueloSolido = { ocupado: () => false };
    assert.equal(penetracionEnSolido(3, 4, PLAYER_RADIUS_M, vacio), 0);
    assert.equal(salidaDelSolido(3, 4, PLAYER_RADIUS_M, vacio), null);
    assert.equal(solidoBloquea({ x: 0, z: 0 }, { x: 9, z: 9 }, PLAYER_RADIUS_M, vacio), false);
    assert.deepEqual(sitioParaAparecer({ x: 3, z: 4 }, PLAYER_RADIUS_M, vacio), { x: 3, z: 4 });
  });
});

/** EL PASO QUE NO ANDA (#658) — y por qué este candado NO puede escribirse
 *  sobre suelo de grid.
 *
 *  `marchaPorEje` avanza sumando 0,5 m a una coordenada de mundo. Por encima
 *  de |v| ≥ 2^52 − 40 el ulp del flotante se come el sumando, `f` deja de
 *  moverse y el `for(;;)` no vuelve nunca. Eso corre en el TICK DEL BRIDGE.
 *
 *  DOS TRAMPAS, las dos medidas, y las dos son la razón de que este bloque
 *  esté escrito como está:
 *
 *   1. **El suelo de GRID no lo alcanza.** Un grid 128×128 TODO sólido con su
 *      `origin` en el rect del tile 7,1e13 contesta `solapaSolido = false`
 *      (medido abajo, y es un aserto de control, no un comentario): el mismo
 *      ulp que congela el `+ 0,5` deja el cuerpo de ancho CERO y el solape
 *      ABIERTO de un cuerpo sin ancho es vacío. `salidaMedida` devuelve `null`
 *      antes de marchar, así que un candado sobre grid NACE VERDE CON EL
 *      DEFECTO PUESTO. El único suelo que llega hasta la marcha es el de
 *      CAJAS — `penetracionEnCaja` es analítica y no pierde magnitud—, que es
 *      el predicado literal de `cajaQueContiene`, o sea el que pone el
 *      proveedor del bridge.
 *   2. **`assert.throws` a secas no basta.** Con el guardia quitado el bucle
 *      es SÍNCRONO, así que un `{ timeout }` de `node:test` no lo interrumpe:
 *      el sabotaje COLGARÍA el runner en vez de ponerlo rojo. Por eso el suelo
 *      de estos casos lleva presupuesto de consultas propio y lanza un
 *      centinela —un `Error`, nunca un `RangeError`— al agotarlo. */
describe("salida-del-solido — la marcha siempre termina (#658)", () => {
  /** El presupuesto del centinela, MEDIDO sobre el peor caso legítimo de este
   *  fichero y con margen: `sitioParaAparecer` sobre el macizo de 400 × 400 m
   *  (el `it` de «cuatro marchas de 40 m») paga **1.285** consultas — 4 pasos
   *  × (1 + 4 marchas × 80 fronteras) + la final. 20.000 son 15,6 veces eso.
   *
   *  No se deriva de `TOPE_MARCHA_M` ni de nada que calcule la función bajo
   *  prueba (trampa de la tanda G): es un entero del test. Y el margen no se
   *  cree de palabra — el tercer `it` vuelve a medir las 1.285 con este mismo
   *  presupuesto armado, así que si el peor caso legítimo creciera hasta
   *  rozarlo, salta ahí y no en el caso que sí tiene que lanzar. */
  const PRESUPUESTO_DE_CONSULTAS = 20_000;

  /** Un suelo de CAJA con presupuesto: cuenta lo que se le pregunta y se
   *  planta. El centinela es un `Error` pelado A PROPÓSITO: si el guardia
   *  desaparece, `assert.throws(…, RangeError)` no lo acepta y el caso sale
   *  ROJO en vez de colgarse. */
  function sueloDeCaja(caja: CajaXZ): SueloSolido & { consultas: () => number } {
    let n = 0;
    return {
      consultas: () => n,
      ocupado(x, z, radio) {
        if (++n > PRESUPUESTO_DE_CONSULTAS) {
          throw new Error(
            `centinela del test: ${n} consultas sobre el suelo (presupuesto ${PRESUPUESTO_DE_CONSULTAS}). ` +
              "La marcha no termina: el guardia de progreso de `marchaPorEje` no está o no se dispara.",
          );
        }
        return penetracionEnCaja({ x, z }, caja, radio) > 0;
      },
    };
  }

  /** El centro del tile `tx`, en coordenadas de mundo. Se pide por el tile y
   *  no con un número a pelo porque lo que está fuera de rango es un TILE, que
   *  es la puerta que `COTA_TILE` cierra en el contrato. */
  const centroDelTile = (tx: number) => {
    const rect = tileWorldRect(tx, 0);
    return { x: (rect.minX + rect.maxX) / 2, z: 0 };
  };

  it("sobre suelo de CAJAS, una coordenada fuera de rango es RangeError y no un cuelgue", () => {
    // Ocho órdenes por encima de la cota del plano (1e6) y por encima del
    // acantilado medido (tx ≈ 7,0369e13): es lo que produce un `anchor`
    // absurdo o un save editado, nunca el juego.
    const tx = 7.1e13;
    assert.ok(tx > COTA_TILE, "control: el tile de este caso está FUERA del plano que admite el contrato");
    const p = centroDelTile(tx);
    const caja: CajaXZ = { pos: { x: p.x, z: p.z }, sizeXZ: { x: 8, z: 8 } };

    // CONTROL 1 · la caja SÍ contesta a esta magnitud: 4,4 m de penetración.
    // Sin esto, lo de abajo podría estar lanzando sobre un mundo de aire.
    assert.ok(
      penetracionEnCaja(p, caja, PLAYER_RADIUS_M) > 0,
      "la caja tiene que contener al cuerpo: si no, no hay marcha que medir",
    );

    // CONTROL 2 · y el GRID no. Es la trampa 1 de la cabecera, y va como
    // aserto para que nadie reescriba este caso sobre un grid creyendo que
    // mide lo mismo: mediría un `null` y nacería verde con el defecto puesto.
    const grid = Array.from({ length: TILE_CELLS }, () => "S".repeat(TILE_CELLS));
    const rect = tileWorldRect(tx, 0);
    const colGrid = createTerrainCollider({
      grid, cols: TILE_CELLS, rows: TILE_CELLS,
      meters_per_cell: TILE_MPC, origin: [rect.minX, rect.minZ], solid_chars: ["S"],
    })!;
    assert.equal(
      colGrid.solapaSolido(p.x, p.z, PLAYER_RADIUS_M),
      false,
      "el grid se rinde un ulp ANTES que la marcha: este candado va sobre CAJAS o no mide nada",
    );

    const suelo = sueloDeCaja(caja);
    assert.throws(
      () => penetracionEnSolido(p.x, p.z, PLAYER_RADIUS_M, suelo),
      RangeError,
      "el paso que no mueve la frontera tiene que ser fail-loud",
    );
    // Y barato: el guardia corta en la SEGUNDA consulta, no tras agotar nada.
    assert.ok(
      suelo.consultas() <= 4,
      `el guardia corta en las primeras consultas: fueron ${suelo.consultas()}`,
    );

    // El camino que de verdad corre en el bridge (`dondeAparecer` →
    // `sitioParaAparecer` sobre `ctx.simCollision`, que es grid ∪ cajas).
    const suelo2 = sueloDeCaja(caja);
    assert.throws(
      () => sitioParaAparecer(p, PLAYER_RADIUS_M, suelo2),
      RangeError,
      "el llamante alcanzable desde el bridge tampoco se cuelga",
    );

    // Y el mensaje sirve para algo: lleva el eje y la coordenada, que es lo
    // único que permite encontrar el 7e13 en el log del bridge.
    try {
      sitioParaAparecer(p, PLAYER_RADIUS_M, sueloDeCaja(caja));
      assert.fail("tenía que haber lanzado");
    } catch (err) {
      const msg = (err as Error).message;
      assert.match(msg, /marchaPorEje/, msg);
      assert.match(msg, new RegExp(String(p.x)), msg);
    }
  });

  it("y NO se dispara antes de tiempo: en 2^52 − 41 la marcha satura como siempre", () => {
    // Un aserto con N=1 no distingue una regla de su contraria: el caso de
    // arriba solo dice que a veces lanza. Este dice dónde NO.
    //
    // Los DOS límites son distintos y están medidos, y la diferencia son
    // exactamente los 160 m que anda `sitioParaAparecer` (4 × TOPE_MARCHA_M):
    //   · UNA marcha aguanta hasta 2^52 − 41 (en 2^52 − 40 ya lanza);
    //   · CUATRO aguantan hasta 2^52 − 161 (en 2^52 − 160 ya lanza, porque el
    //     cuarto paso arranca desde 2^52 − 1).
    const caja: CajaXZ = { pos: { x: 2 ** 52 - 41, z: 0 }, sizeXZ: { x: 1e6, z: 1e6 } };

    const suelo = sueloDeCaja(caja);
    assert.equal(
      penetracionEnSolido(2 ** 52 - 41, 0, PLAYER_RADIUS_M, suelo),
      TOPE_MARCHA_M,
      "justo por debajo del acantilado la marcha SATURA, que es su conducta normal",
    );
    assert.equal(suelo.consultas(), 321, "y paga las 4 marchas × 80 fronteras + la consulta de origen");

    // Cuatro marchas: 160 m más abajo, y devuelve el `null` de siempre.
    const abajo = 2 ** 52 - 161;
    const caja4: CajaXZ = { pos: { x: abajo, z: 0 }, sizeXZ: { x: 1e6, z: 1e6 } };
    const suelo4 = sueloDeCaja(caja4);
    assert.equal(
      sitioParaAparecer({ x: abajo, z: 0 }, PLAYER_RADIUS_M, suelo4),
      null,
      "cuatro saturaciones seguidas siguen siendo `null` (fail-loud por tope), no un RangeError",
    );
    assert.equal(suelo4.consultas(), 1285, "y es el peor caso legítimo del módulo, en consultas");
  });

  it("el presupuesto del centinela está POR ENCIMA del peor caso legítimo del fichero", () => {
    // El número del presupuesto no vale de palabra: aquí se vuelve a medir el
    // peor caso que este fichero ejerce —el macizo de 400 × 400 m, cuatro
    // marchas al tope y sigue dentro— con el centinela ARMADO. Si alguien
    // sube `TOPE_MARCHA_M` o `maxPasos`, salta este caso (que es de mentira)
    // y no el de arriba (que es de verdad).
    const cols = Math.ceil(400 / TILE_MPC);
    const { suelo: gridMacizo } = macizo([0, 0], { cols, rows: cols, c0: 0, c1: cols - 1, r0: 0, r1: cols - 1 });
    let n = 0;
    const contando: SueloSolido = {
      ocupado(x, z, radio) {
        if (++n > PRESUPUESTO_DE_CONSULTAS) throw new Error(`el peor caso legítimo se pasó del presupuesto: ${n}`);
        return gridMacizo.ocupado(x, z, radio);
      },
    };
    assert.equal(sitioParaAparecer({ x: 200, z: 200 }, PLAYER_RADIUS_M, contando), null);
    assert.equal(n, 1285, "el peor caso legítimo medido hoy");
    assert.ok(
      n * 4 < PRESUPUESTO_DE_CONSULTAS,
      `el presupuesto (${PRESUPUESTO_DE_CONSULTAS}) tiene que guardar margen sobre las ${n} del peor caso`,
    );
  });
});
