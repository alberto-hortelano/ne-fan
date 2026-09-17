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
import { salidaDeCaja, type CajaXZ } from "../src/simulation/obstaculos-del-jugador.js";
import {
  penetracionEnSolido,
  salidaDelSolido,
  sitioParaAparecer,
  solidoBloquea,
  TOPE_MARCHA_M,
  type SueloSolido,
} from "../src/simulation/salida-del-solido.js";
import { TILE_MPC } from "../src/scene/tile.js";

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
