/** LA RUTA DEL NPC EN METROS (#618): del mundo a la rejilla y de vuelta.
 *
 *  Lo que sujeta este fichero es lo que el jugador vería si fallara:
 *  - la meta es un sitio LIBRE junto al lugar, la misma cuenta que pone al
 *    jugador en la puerta (#646), y no el centro ocupado de un edificio;
 *  - la ventana cubre los dos extremos hasta el `MAX_GOTO_DIST` del NPC;
 *  - el trazado ALISADO no toca sólido: se muestrea cada 5 cm alrededor de
 *    una caja desalineada con la rejilla (sobre las tres fixtures, con el
 *    suelo de PRODUCCIÓN, lo mide `sim-collision.test.ts`);
 *  - una puerta de 3 celdas se pasa y una de 2 no. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { HOLGURA_ENTRE_METAS_M, MAX_EXPANSIONES, rutaPorElSuelo, type Punto, type SueloDePlan as SueloSolido } from "../src/simulation/ruta-por-el-suelo.js";
import { cajaQueContiene, type CajaDeRuntime } from "../src/simulation/cajas-de-runtime.js";
import { createTerrainCollider, NPC_RADIUS_M } from "../src/scene/terrain-collision.js";
import { TILE_CELLS, TILE_MPC, tileWorldRect } from "../src/scene/tile.js";

const R = NPC_RADIUS_M;

function deCajas(...cajas: CajaDeRuntime[]): SueloSolido {
  return { ocupado: (x, z, r) => cajaQueContiene(x, z, r, cajas) !== null };
}

const ABIERTO: SueloSolido = { ocupado: () => false };

/** Un tile (0,0) desde filas de texto sobre la rejilla real (`#` sólido), con
 *  el solape ABIERTO del collider del terreno. */
function tileDeTexto(pintar: (c: number, r: number) => boolean): SueloSolido {
  const grid: string[] = [];
  for (let r = 0; r < TILE_CELLS; r++) {
    let f = "";
    for (let c = 0; c < TILE_CELLS; c++) f += pintar(c, r) ? "#" : ".";
    grid.push(f);
  }
  const rect = tileWorldRect(0, 0);
  const col = createTerrainCollider({
    grid, cols: TILE_CELLS, rows: TILE_CELLS, meters_per_cell: TILE_MPC,
    origin: [rect.minX, rect.minZ], solid_chars: ["#"],
  })!;
  return { ocupado: (x, z, r) => col.solapaSolido(x, z, r) };
}

/** Puntos del trazado `desde → puntos…` cada `paso` metros. */
function muestrear(desde: Punto, puntos: ReadonlyArray<Punto>, paso = 0.05): Punto[] {
  const out: Punto[] = [];
  let a = desde;
  for (const b of puntos) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / paso));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    a = b;
  }
  return out;
}

describe("rutaPorElSuelo", () => {
  it("la META es el sitio libre del LADO DE QUIEN LLEGA: la cara de la casa que tiene delante (#646, QA de BO H1)", () => {
    const casa: CajaDeRuntime = { id: "casa", pos: { x: 10, z: 0 }, sizeXZ: { x: 7, z: 5 } };
    const suelo = deCajas(casa);
    assert.ok(suelo.ocupado(10, 0, R), "CONTROL: el centro de la casa está ocupado");
    const caras = [
      { desde: { x: -10, z: 0 }, cara: (m: Punto) => m.x <= 10 - 3.5 - R + 1e-9 && m.x > 10 - 3.5 - R - 0.2 && Math.abs(m.z) < 1e-9 },
      { desde: { x: 30, z: 0 }, cara: (m: Punto) => m.x >= 10 + 3.5 + R - 1e-9 && m.x < 10 + 3.5 + R + 0.2 },
      { desde: { x: 10, z: -20 }, cara: (m: Punto) => m.z <= -2.5 - R + 1e-9 && m.z > -2.5 - R - 0.2 },
      { desde: { x: 10, z: 20 }, cara: (m: Punto) => m.z >= 2.5 + R - 1e-9 && m.z < 2.5 + R + 0.2 },
    ];
    for (const { desde, cara } of caras) {
      const r = rutaPorElSuelo(desde, { x: 10, z: 0 }, R, suelo);
      assert.ok(r.ok, JSON.stringify(r));
      assert.ok(!suelo.ocupado(r.meta.x, r.meta.z, R), "la meta está libre");
      assert.ok(cara(r.meta), `desde ${JSON.stringify(desde)} la meta cae en SU cara: ${JSON.stringify(r.meta)}`);
      assert.deepEqual(r.puntos.at(-1), r.meta, "la ruta acaba en la meta");
    }
  });

  it("los VECINOS se reparten la fachada: la meta no pisa la de otro (QA de BO H1)", () => {
    const casa: CajaDeRuntime = { id: "casa", pos: { x: 10, z: 0 }, sizeXZ: { x: 7, z: 5 } };
    const suelo = deCajas(casa);
    const metas: Punto[] = [];
    for (let k = 0; k < 5; k++) {
      const r = rutaPorElSuelo({ x: -10, z: 0 }, { x: 10, z: 0 }, R, suelo, undefined, metas);
      assert.ok(r.ok, JSON.stringify(r));
      assert.ok(!suelo.ocupado(r.meta.x, r.meta.z, R));
      metas.push(r.meta);
    }
    for (let i = 0; i < metas.length; i++) {
      for (let j = i + 1; j < metas.length; j++) {
        const d = Math.hypot(metas[i].x - metas[j].x, metas[i].z - metas[j].z);
        assert.ok(d >= 2 * R + HOLGURA_ENTRE_METAS_M - 1e-9, `metas ${i} y ${j} a ${d.toFixed(2)} m: ${JSON.stringify(metas)}`);
      }
    }
    assert.ok(metas.every((m) => m.x < 10), `todas en la cara oeste, la de quien llega: ${JSON.stringify(metas)}`);
    // CONTROL: sin vecinos que evitar, los cinco caerían en el MISMO punto.
    const solo = rutaPorElSuelo({ x: -10, z: 0 }, { x: 10, z: 0 }, R, suelo);
    assert.ok(solo.ok);
    assert.deepEqual(solo.meta, metas[0]);
  });

  it("la meta sin sitio es `meta-sin-sitio`, no el centro crudo", () => {
    const enorme: CajaDeRuntime = { id: "macizo", pos: { x: 0, z: 0 }, sizeXZ: { x: 400, z: 400 } };
    const r = rutaPorElSuelo({ x: 0, z: 100 }, { x: 0, z: 0 }, R, deCajas(enorme));
    assert.deepEqual(r, { ok: false, motivo: "meta-sin-sitio", expansiones: 0 });
  });

  it("la VENTANA cubre los extremos a 127,9 m en los ejes y en diagonal, desde cualquier sitio del tile", () => {
    const d = 127.9;
    const diag = d / Math.SQRT2;
    for (const desde of [{ x: 0, z: 0 }, { x: 31.9, z: -31.9 }, { x: -31.99, z: 31.99 }]) {
      for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d], [diag, diag], [-diag, diag], [diag, -diag], [-diag, -diag]]) {
        const hasta = { x: desde.x + dx, z: desde.z + dz };
        const r = rutaPorElSuelo(desde, hasta, R, ABIERTO);
        assert.ok(r.ok, `${JSON.stringify(desde)} → ${JSON.stringify(hasta)}: ${JSON.stringify(r)}`);
        assert.deepEqual(r.puntos.at(-1), hasta, "acaba en el destino");
        // En abierto, la recta; o, si un extremo cae a menos de media celda del
        // borde de la ventana (la línea de vista no se puede afirmar fuera de
        // ella), un vértice por su celda y la recta.
        assert.ok(r.puntos.length <= 3, `en abierto no da rodeos: ${JSON.stringify(r.puntos)}`);
      }
    }
  });

  it("más lejos de lo que cabe en la ventana es `lejos`, no una ruta inventada", () => {
    assert.deepEqual(rutaPorElSuelo({ x: 0, z: 0 }, { x: 200, z: 0 }, R, ABIERTO), { ok: false, motivo: "lejos", expansiones: 0 });
  });

  it("RODEA el carro de 6 m que el steering no sabía rodear, y el trazado no lo toca", () => {
    const carro: CajaDeRuntime = { id: "carro", pos: { x: 0, z: 0 }, sizeXZ: { x: 6, z: 6 } };
    const suelo = deCajas(carro);
    const r = rutaPorElSuelo({ x: -12, z: 0 }, { x: 12, z: 0 }, R, suelo);
    assert.ok(r.ok);
    assert.ok(r.puntos.length >= 2, "hay al menos un vértice de rodeo");
    const tocados = muestrear({ x: -12, z: 0 }, r.puntos).filter((p) => suelo.ocupado(p.x, p.z, R));
    assert.deepEqual(tocados, [], "ningún punto del trazado dentro del carro");
    assert.ok(r.expansiones < 1000, `barato: ${r.expansiones} expansiones`);
  });

  it("una puerta de 3 celdas (1,5 m) se pasa y una de 2 no", () => {
    // Muro en la columna 70 del tile, con un hueco de `ancho` celdas en las
    // filas 64…; la meta está al otro lado y el muro cierra el resto del tile
    // (de lado a lado de la ventana no, pero el tope corta antes de rodearlo).
    const conPuerta = (ancho: number) => tileDeTexto((c, r) => c === 70 && !(r >= 64 && r < 64 + ancho));
    const desde = { x: -32 + 60 * TILE_MPC, z: -32 + 65 * TILE_MPC };
    const hasta = { x: -32 + 80 * TILE_MPC, z: -32 + 65 * TILE_MPC };
    const tres = rutaPorElSuelo(desde, hasta, R, conPuerta(3), 2000);
    assert.ok(tres.ok, JSON.stringify(tres));
    const dos = rutaPorElSuelo(desde, hasta, R, conPuerta(2), 2000);
    assert.equal(dos.ok, false, "por 1 m de hueco no cabe un cuerpo de 1 m con celdas de 0,5");
  });

  it("`inicio-encerrado` y `tope` son estados, no excepciones; el radio menor que media celda es precondición rota", () => {
    const celda: CajaDeRuntime[] = [
      { id: "n", pos: { x: 0, z: 3 }, sizeXZ: { x: 8, z: 1 } },
      { id: "s", pos: { x: 0, z: -3 }, sizeXZ: { x: 8, z: 1 } },
      { id: "e", pos: { x: 3.5, z: 0 }, sizeXZ: { x: 1, z: 8 } },
      { id: "o", pos: { x: -3.5, z: 0 }, sizeXZ: { x: 1, z: 8 } },
    ];
    // Encerrado en un patio: fuera no se llega; con el tope por defecto el
    // patio se vacía enseguida y es `sin-camino`.
    const patio = rutaPorElSuelo({ x: 0, z: 0 }, { x: 20, z: 0 }, R, deCajas(...celda));
    assert.equal(!patio.ok && patio.motivo, "sin-camino");
    // Y con la META en el patio y el NPC fuera, el A* vacía la ventana hasta
    // el tope.
    const alPatio = rutaPorElSuelo({ x: 20, z: 0 }, { x: 0, z: 0 }, R, deCajas(...celda));
    assert.deepEqual(alPatio, { ok: false, motivo: "tope", expansiones: MAX_EXPANSIONES });
    // Inicio sin celda libre alrededor: dentro de un macizo.
    const macizo: CajaDeRuntime = { id: "m", pos: { x: 0, z: 0 }, sizeXZ: { x: 10, z: 10 } };
    assert.deepEqual(rutaPorElSuelo({ x: 0, z: 0 }, { x: 20, z: 0 }, R, deCajas(macizo)),
      { ok: false, motivo: "inicio-encerrado", expansiones: 0 });
    assert.throws(() => rutaPorElSuelo({ x: 0, z: 0 }, { x: 5, z: 0 }, 0.2, ABIERTO), RangeError);
  });

  it("SOLIDEZ contra un sólido que NO cae en las fronteras de celda: 216 rodeos a una caja desalineada, trazado entero", () => {
    // Las fixtures son sólidos alineados con la rejilla, y ahí un alisado que
    // solo mirase la celda de cada muestra también sale limpio (medido: quitar
    // la dilatación de `visible` dejaba el caso de las fixtures en verde). Una
    // caja de runtime cae donde el motor la pone: desalineada 0,3 × 0,1 m, el
    // mismo recorte deja 212 muestras dentro. Aquí se mide TODO el trazado,
    // desde el punto real y hasta la meta real.
    const carro: CajaDeRuntime = { id: "carro", pos: { x: 0.3, z: 0.1 }, sizeXZ: { x: 6, z: 6 } };
    const suelo = deCajas(carro);
    let rutas = 0;
    const dentro: string[] = [];
    for (let a = 0; a < 72; a++) {
      for (const d of [5, 8, 12]) {
        const ang = (a * Math.PI) / 36;
        const desde = { x: Math.cos(ang) * d, z: Math.sin(ang) * d };
        if (suelo.ocupado(desde.x, desde.z, R)) continue;
        const r = rutaPorElSuelo(desde, { x: -desde.x, z: -desde.z }, R, suelo);
        assert.ok(r.ok, `rodeo ${a}/${d}: ${JSON.stringify(r)}`);
        rutas++;
        for (const p of muestrear(desde, r.puntos)) {
          if (suelo.ocupado(p.x, p.z, R)) dentro.push(`${a}/${d} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
        }
      }
    }
    assert.ok(rutas > 200, `${rutas} rodeos`);
    assert.deepEqual(dentro, []);
  });
});
