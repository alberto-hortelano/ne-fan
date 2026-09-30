/** El salto del jugador (tanda BY, «que pueda saltar»): la regla en sí y lo
 *  que el salto le deja HACER — cruzar una cerca, y no un muro ni el agua.
 *
 *  La segunda mitad no mira el salto a solas: monta el mismo `solido` que el
 *  cliente (`world/collision.ts`: el suelo del plan por `solidoBloquea`,
 *  eligiendo el grid del aire mientras se salta) y anda con `pasoDelJugador`
 *  frame a frame, a la velocidad y con la duración del `combat_config.json`
 *  REAL. Un salto que sube la cámara y no cruza nada no pasaría de aquí. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EN_EL_SUELO,
  avanzarSalto,
  elevacionDelSalto,
  enElAire,
  saltar,
  saltoDelFrame,
  dentroDeLoBajo,
  empujeFueraDeLoBajo,
  sueloDelPaso,
  EMPUJE_FUERA_DE_LO_BAJO_M_S,
  type Salto,
} from "../src/simulation/salto-del-jugador.js";
import { pasoDelJugador, velocidadDelJugador } from "../src/simulation/paso-del-jugador.js";
import { penetracionEnSolido, solidoBloquea } from "../src/simulation/salida-del-solido.js";
import { loadConfig } from "../src/combat/combat-data.js";
import {
  createTerrainCollider,
  PLAYER_RADIUS_M,
  SALTO_APOGEO_M,
  type TerrainCollider,
} from "../src/scene/terrain-collision.js";
import {
  planCollisionGrid,
  planCollisionGridDeLoBajo,
  planCollisionGridEnElAire,
} from "../src/scene/blueprint/plan-collision.js";
import { tileWorldRect, TILE_MPC } from "../src/scene/tile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const jugador = loadConfig(
  JSON.parse(readFileSync(resolve(__dirname, "../data/combat_config.json"), "utf-8")),
).player;
const DURACION = jugador.salto_duracion_s;

describe("salto del jugador · la regla", () => {
  it("despega solo desde el suelo, y en el aire pedirlo otra vez no reinicia nada", () => {
    const aire = saltar(EN_EL_SUELO);
    assert.deepEqual(aire, { fase: "aire", t: 0 });
    const aMedias: Salto = { fase: "aire", t: 0.3 };
    assert.equal(saltar(aMedias), aMedias, "sin doble salto: el mismo salto, no uno nuevo");
  });

  it("aterriza EXACTAMENTE al cumplir la duración, ni un frame antes ni después", () => {
    const casi = avanzarSalto({ fase: "aire", t: 0 }, 0.69, 0.7);
    assert.equal(casi.fase, "aire");
    assert.ok(casi.fase === "aire" && Math.abs(casi.t - 0.69) < 1e-12, "el reloj suma el delta");
    assert.deepEqual(avanzarSalto({ fase: "aire", t: 0 }, 0.7, 0.7), EN_EL_SUELO);
    assert.deepEqual(avanzarSalto({ fase: "aire", t: 0.6 }, 0.1, 0.7), EN_EL_SUELO);
    assert.deepEqual(avanzarSalto(EN_EL_SUELO, 5, 0.7), EN_EL_SUELO, "en el suelo el reloj no despega a nadie");
  });

  it("un frame enorme aterriza, no deja al jugador en el aire ni bajo el suelo", () => {
    const s = avanzarSalto({ fase: "aire", t: 0.1 }, 10, 0.7);
    assert.deepEqual(s, EN_EL_SUELO);
    assert.equal(elevacionDelSalto(s, 0.7), 0);
    // Un estado fabricado con el reloj pasado de la duración tampoco se hunde.
    assert.equal(elevacionDelSalto({ fase: "aire", t: 3 }, 0.7), 0);
  });

  it("la elevación es la parábola: 0 al despegar, el apogeo en la mitad, simétrica", () => {
    assert.equal(elevacionDelSalto(EN_EL_SUELO, 0.7), 0);
    assert.equal(elevacionDelSalto({ fase: "aire", t: 0 }, 0.7), 0);
    assert.ok(Math.abs(elevacionDelSalto({ fase: "aire", t: 0.35 }, 0.7) - SALTO_APOGEO_M) < 1e-12);
    const a = elevacionDelSalto({ fase: "aire", t: 0.1 }, 0.7);
    const b = elevacionDelSalto({ fase: "aire", t: 0.6 }, 0.7);
    assert.ok(Math.abs(a - b) < 1e-12 && a > 0 && a < SALTO_APOGEO_M, `${a} vs ${b}`);
    // 4·A·u(1−u) con u = 1/7: el número exacto, no solo la forma.
    assert.ok(Math.abs(a - 4 * SALTO_APOGEO_M * (1 / 7) * (6 / 7)) < 1e-12);
  });

  it("enElAire es la fase, y es lo que elige el grid", () => {
    assert.equal(enElAire(EN_EL_SUELO), false);
    assert.equal(enElAire({ fase: "aire", t: 0 }), true);
  });

  it("una duración que no es positiva es un config roto: lanza", () => {
    for (const d of [0, -1, Number.NaN]) {
      assert.throws(() => avanzarSalto({ fase: "aire", t: 0 }, 0.016, d), /duración/);
    }
  });

  it("el frame: se consume el Espacio, pero con el panel abierto (o caído) no despega", () => {
    const p = { delta: 0.016, duracion: 0.7 };
    assert.deepEqual(saltoDelFrame(EN_EL_SUELO, { ...p, pide: true, puedeMoverse: false }), EN_EL_SUELO);
    assert.deepEqual(saltoDelFrame(EN_EL_SUELO, { ...p, pide: false, puedeMoverse: true }), EN_EL_SUELO);
    assert.deepEqual(saltoDelFrame(EN_EL_SUELO, { ...p, pide: true, puedeMoverse: true }), { fase: "aire", t: 0 });
  });

  it("el reloj corre con el panel abierto: nadie se queda colgado a media altura", () => {
    const s = saltoDelFrame({ fase: "aire", t: 0.2 }, { delta: 0.1, duracion: 0.7, pide: false, puedeMoverse: false });
    assert.ok(s.fase === "aire" && Math.abs(s.t - 0.3) < 1e-12);
  });

  it("pedirlo el frame en que aterriza vuelve a despegar (se avanza ANTES de saltar)", () => {
    const s = saltoDelFrame({ fase: "aire", t: 0.69 }, { delta: 0.02, duracion: 0.7, pide: true, puedeMoverse: true });
    assert.deepEqual(s, { fase: "aire", t: 0 });
  });
});

// ── Lo que el salto deja hacer ─────────────────────────────────────────────

/** Los tipos del plan, tomados de la firma y no de `volumes.ts`/`ground.ts`:
 *  este test no mide el zod de esos ficheros, y nombrarlos lo metería en las
 *  baterías de mutación de dos módulos a los que no puede matarles nada. */
type Volume = NonNullable<Parameters<typeof planCollisionGrid>[1]>[number];
type GroundFeature = NonNullable<Parameters<typeof planCollisionGrid>[0]>[number];

const RECT = tileWorldRect(0, 0);
/** Z de mundo del borde norte de la fila `r` del tile (0,0). */
const zDeFila = (r: number): number => RECT.minZ + r * TILE_MPC;

/** El mundo del jugador como lo cablea el cliente: un collider del plan a pie
 *  y otro en el aire, y la consulta de movimiento contra el que toque. */
function mundo(plan: { ground?: GroundFeature[]; volumes?: Volume[] }) {
  // Literales tipados, sin pasar por el zod: lo que se mide aquí es el salto,
  // y la forma de los volúmenes ya la sujetan sus propias baterías.
  const g = plan.ground;
  const v = plan.volumes;
  const aPie = planCollisionGrid(g, v, RECT);
  const aire = planCollisionGridEnElAire(g, v, RECT);
  const bajo = planCollisionGridDeLoBajo(v, RECT);
  const c = (grid: typeof aPie): TerrainCollider | null => (grid ? createTerrainCollider(grid) : null);
  return { aPie: c(aPie), enElAire: c(aire), bajo: c(bajo) };
}

/** Los tres suelos como los monta el cliente (`world/collision.ts`). */
function suelosDe(m: ReturnType<typeof mundo>) {
  const de = (c: TerrainCollider | null) => ({
    ocupado: (x: number, z: number, r: number) => c?.solapaSolido(x, z, r) ?? false,
  });
  return { aPie: de(m.aPie), enElAire: de(m.enElAire), bajo: de(m.bajo) };
}

/** Anda hacia el NORTE (−z) a 60 fps durante `segundos`, saltando en el frame
 *  `saltaEn` (o nunca). Devuelve la z final. Es el bucle de `main.ts` en
 *  pequeño: el salto del frame, el suelo que toca (`sueloDelPaso`), el paso y
 *  el resbalón fuera de lo bajo. `sinLoBajo` quita las dos reglas de «dentro
 *  de lo bajo» (el suelo solo depende del salto y no hay resbalón): es el
 *  CONTROL que demuestra que los asertos de esas reglas pueden ponerse rojos.
 *  `andaHasta` suelta W al cabo de esos segundos. */
function correr(
  m: ReturnType<typeof mundo>,
  desdeZ: number,
  opts: { saltaEn?: number; segundos?: number; sinLoBajo?: boolean; andaHasta?: number } = {},
): { z: number; salto: Salto } {
  const pos = { x: 0, z: desdeZ };
  let salto: Salto = EN_EL_SUELO;
  const delta = 1 / 60;
  const frames = Math.round((opts.segundos ?? 1.5) / delta);
  const suelos = suelosDe(m);
  for (let f = 0; f < frames; f++) {
    salto = saltoDelFrame(salto, { delta, duracion: DURACION, pide: f === opts.saltaEn, puedeMoverse: true });
    const dentro = !opts.sinLoBajo && dentroDeLoBajo(pos, PLAYER_RADIUS_M, suelos);
    const suelo = sueloDelPaso(enElAire(salto), dentro) === "aire" ? suelos.enElAire : suelos.aPie;
    const anda = opts.andaHasta === undefined || f * delta < opts.andaHasta;
    const { dx, dz } = pasoDelJugador({
      desde: pos,
      forward: { x: 0, z: -1 },
      intencion: { adelante: anda ? 1 : 0, derecha: 0 },
      velocidad: velocidadDelJugador(jugador, false),
      delta,
      solido: (x, z) => solidoBloquea(pos, { x, z }, PLAYER_RADIUS_M, suelo),
    });
    const fuera = opts.sinLoBajo
      ? { dx: 0, dz: 0 }
      : empujeFueraDeLoBajo(pos, PLAYER_RADIUS_M, suelos, enElAire(salto), delta);
    pos.x += dx + fuera.dx;
    pos.z += dz + fuera.dz;
  }
  return { z: pos.z, salto };
}

/** Una valla por defecto (3 celdas de grosor) cruzando el tile de este a
 *  oeste en la fila 60: la banda sólida va de la fila 58,5 a la 61,5. */
const VALLA: Volume = { id: "cerca", label: "cerca de madera", type: "wall", points: [[0, 60], [128, 60]], h: 2 };
/** Donde el cuerpo toca la cara SUR de la banda. */
const TOPE_SUR = zDeFila(61.5) + PLAYER_RADIUS_M;
/** Pasada la cara NORTE con el cuerpo entero. */
const CRUZADO = zDeFila(58.5) - PLAYER_RADIUS_M;

describe("salto del jugador · lo que cruza y lo que no", () => {
  it("control: andando, la valla frena (y el tope es donde el cuerpo toca su cara sur)", () => {
    const { z } = correr(mundo({ volumes: [VALLA] }), zDeFila(70));
    assert.ok(z > TOPE_SUR - 1e-9 && z < TOPE_SUR + TILE_MPC, `se paró en z=${z}, cara+radio en ${TOPE_SUR}`);
  });

  it("saltando pegado a la valla, se cruza entera", () => {
    const m = mundo({ volumes: [VALLA] });
    const desde = TOPE_SUR + 0.2;
    const { z, salto } = correr(m, desde, { saltaEn: 0 });
    assert.ok(z < CRUZADO, `aterrizó en z=${z}; cruzar es pasar de ${CRUZADO}`);
    assert.equal(salto.fase, "suelo", "y ya ha aterrizado");
  });

  it("con el config real el salto ALCANZA: velocidad × duración cubre valla + cuerpo con holgura", () => {
    // 1,5 m de valla por defecto + el diámetro del cuerpo + 30 cm de margen
    // para no tener que despegar pegado a la cara. Si alguien acorta el salto
    // en el JSON, las cercas dejan de cruzarse andando, y esto lo dice.
    const alcance = velocidadDelJugador(jugador, false) * DURACION;
    assert.ok(alcance >= 3 * TILE_MPC + 2 * PLAYER_RADIUS_M + 0.3, `alcance ${alcance.toFixed(2)} m`);
  });

  /** Dentro de la banda de la valla a pie (sea cual sea el lado). */
  const dentroDeLaValla = (m: ReturnType<typeof mundo>, z: number) => m.aPie!.solapaSolido(0, z, PLAYER_RADIUS_M);

  it("CONTROL: sin las reglas de lo bajo, despegar a 2,4 m con W deja ATASCADO dentro de la valla (QA H2)", () => {
    const m = mundo({ volumes: [VALLA] });
    const { z } = correr(m, TOPE_SUR + 2.4, { saltaEn: 0, segundos: 2.5, sinLoBajo: true });
    assert.ok(dentroDeLaValla(m, z) && z > CRUZADO, `z=${z}: el defecto que las reglas cierran`);
  });

  it("con W apretada, despegue donde despegue hacia la valla, se CRUZA: nadie se queda dentro", () => {
    const m = mundo({ volumes: [VALLA] });
    for (const lejos of [0.2, 0.6, 1.0, 1.4, 1.8, 2.2, 2.6, 3.0]) {
      const { z } = correr(m, TOPE_SUR + lejos, { saltaEn: 0, segundos: 2.5 });
      assert.ok(z < CRUZADO, `despegando a ${lejos} m acaba en z=${z} (cruzar es < ${CRUZADO})`);
    }
  });

  it("aterrizado dentro y soltando W, lo bajo te saca por el lado más cercano: atrás antes de la mitad, delante después", () => {
    const m = mundo({ volumes: [VALLA] });
    // Suelta W al aterrizar: lo único que mueve después es el resbalón.
    const antes = correr(m, TOPE_SUR + 2.4, { saltaEn: 0, segundos: 2, andaHasta: DURACION });
    assert.ok(!dentroDeLaValla(m, antes.z) && antes.z > TOPE_SUR - 1e-6, `antes de la mitad sale al SUR: z=${antes.z}`);
    const despues = correr(m, TOPE_SUR + 1.5, { saltaEn: 0, segundos: 2, andaHasta: DURACION });
    assert.ok(!dentroDeLaValla(m, despues.z) && despues.z <= CRUZADO + 1e-6, `pasada la mitad sale al NORTE: z=${despues.z}`);
  });

  it("CONTROL: sin el resbalón, soltar W dentro deja al jugador dentro", () => {
    const m = mundo({ volumes: [VALLA] });
    const r = correr(m, TOPE_SUR + 2.4, { saltaEn: 0, segundos: 2, andaHasta: DURACION, sinLoBajo: true });
    assert.ok(dentroDeLaValla(m, r.z), `z=${r.z}`);
  });

  it("un muro por defecto (2,5 m) no se cruza saltando", () => {
    const muro: Volume = { ...VALLA, id: "muralla", label: "muralla", h: undefined } as Volume;
    const m = mundo({ volumes: [muro] });
    const { z } = correr(m, TOPE_SUR + 0.2, { saltaEn: 0 });
    assert.ok(z > TOPE_SUR - 1e-9, `z=${z}: el muro no se salta`);
  });

  it("el agua no se cruza saltando, ni con una valla dentro", () => {
    const rio = { id: "rio", kind: "water", rect: [0, 58, 128, 4] } as GroundFeature;
    const m = mundo({ ground: [rio], volumes: [VALLA] });
    const { z } = correr(m, zDeFila(62) + PLAYER_RADIUS_M + 0.2, { saltaEn: 0 });
    assert.ok(z > zDeFila(62), `z=${z}: el agua bloquea también en el aire`);
  });
});

describe("dentro de lo bajo · la esquina valla + muro (QA de BY)", () => {
  // Valla norte-sur en la columna 60 que muere contra un muro este-oeste alto
  // en la fila 60: quien está dentro de la valla, pegado al muro, NO puede
  // atravesar el muro andando por dentro de la valla.
  const m = mundo({
    volumes: [
      { id: "valla", label: "cerca", type: "wall", points: [[60, 60], [60, 100]], h: 2 },
      { id: "muro", label: "muro", type: "wall", points: [[0, 60], [128, 60]] },
    ] as Volume[],
  });
  const suelos = suelosDe(m);

  it("metido en la valla junto al muro, andando hacia el muro no se entra en él ni se cruza", () => {
    // Centro de la valla (columna 60), rozando el muro 5 cm: el cuerpo solapa
    // la valla Y el muro, que es donde la regla vieja («a pie y no en el
    // aire») decía «no estás en lo bajo», resolvía con el grid a pie y la
    // salida más corta de la unión valla+muro era CRUZAR el muro.
    const pos = { x: RECT.minX + 60 * TILE_MPC, z: zDeFila(62) + PLAYER_RADIUS_M - 0.05 };
    assert.equal(dentroDeLoBajo(pos, PLAYER_RADIUS_M, suelos), true, "precondición: dentro de la valla");
    assert.equal(suelos.enElAire.ocupado(pos.x, pos.z, PLAYER_RADIUS_M), true, "precondición: rozando el muro");
    const pen0 = penetracionEnSolido(pos.x, pos.z, PLAYER_RADIUS_M, suelos.enElAire);
    for (let f = 0; f < 120; f++) {
      const dentro = dentroDeLoBajo(pos, PLAYER_RADIUS_M, suelos);
      const suelo = sueloDelPaso(false, dentro) === "aire" ? suelos.enElAire : suelos.aPie;
      const { dx, dz } = pasoDelJugador({
        desde: pos,
        forward: { x: 0, z: -1 },
        intencion: { adelante: 1, derecha: 0 },
        velocidad: velocidadDelJugador(jugador, false),
        delta: 1 / 60,
        solido: (x, z) => solidoBloquea(pos, { x, z }, PLAYER_RADIUS_M, suelo),
      });
      const e = empujeFueraDeLoBajo(pos, PLAYER_RADIUS_M, suelos, false, 1 / 60);
      pos.x += dx + e.dx;
      pos.z += dz + e.dz;
      const pen = penetracionEnSolido(pos.x, pos.z, PLAYER_RADIUS_M, suelos.enElAire);
      assert.ok(pen <= pen0 + 1e-9, `frame ${f}: se mete en el muro (pen ${pen} > ${pen0}) en z=${pos.z}`);
    }
    assert.ok(pos.z > zDeFila(58), `no lo cruza: z=${pos.z}`);
  });
});

describe("dentro de lo bajo · las reglas sueltas", () => {
  const m = mundo({ volumes: [VALLA, { id: "muro", label: "muro", type: "wall", points: [[0, 80], [128, 80]] }] });
  const suelos = suelosDe(m);
  const enValla = { x: 0, z: zDeFila(60.5) };
  const enMuro = { x: 0, z: zDeFila(80) };
  const fuera = { x: 0, z: zDeFila(70) };

  it("dentroDeLoBajo: sí en la valla; no en el muro (el aire también lo tiene) ni fuera", () => {
    assert.equal(dentroDeLoBajo(enValla, PLAYER_RADIUS_M, suelos), true);
    assert.equal(dentroDeLoBajo(enMuro, PLAYER_RADIUS_M, suelos), false);
    assert.equal(dentroDeLoBajo(fuera, PLAYER_RADIUS_M, suelos), false);
  });

  it("sueloDelPaso: el aire saltando o dentro de lo bajo; a pie solo en el suelo y fuera", () => {
    assert.equal(sueloDelPaso(false, false), "pie");
    assert.equal(sueloDelPaso(true, false), "aire");
    assert.equal(sueloDelPaso(false, true), "aire");
    assert.equal(sueloDelPaso(true, true), "aire");
  });

  it("el resbalón: hacia la cara más cercana, a su velocidad, solo en el suelo y solo dentro de lo bajo", () => {
    const e = empujeFueraDeLoBajo(enValla, PLAYER_RADIUS_M, suelos, false, 0.1);
    // En la fila 60,5 la cara sur (61,5) está a 0,5 m + radio; la norte, a 1 m + radio.
    assert.ok(Math.abs(e.dx) < 1e-12 && Math.abs(e.dz - EMPUJE_FUERA_DE_LO_BAJO_M_S * 0.1) < 1e-9, JSON.stringify(e));
    assert.deepEqual(empujeFueraDeLoBajo(enValla, PLAYER_RADIUS_M, suelos, true, 0.1), { dx: 0, dz: 0 }, "en el aire no");
    assert.deepEqual(empujeFueraDeLoBajo(enMuro, PLAYER_RADIUS_M, suelos, false, 0.1), { dx: 0, dz: 0 }, "en lo alto no");
    assert.deepEqual(empujeFueraDeLoBajo(fuera, PLAYER_RADIUS_M, suelos, false, 0.1), { dx: 0, dz: 0 }, "fuera no");
  });

  it("el resbalón no pasa del borde: con un delta enorme deja el cuerpo justo fuera", () => {
    const e = empujeFueraDeLoBajo(enValla, PLAYER_RADIUS_M, suelos, false, 10);
    const z = enValla.z + e.dz;
    assert.ok(e.dz > 0 && e.dz < 10 * EMPUJE_FUERA_DE_LO_BAJO_M_S, `dz=${e.dz}`);
    assert.equal(suelos.aPie.ocupado(0, z, PLAYER_RADIUS_M), false, `z=${z}: fuera`);
    assert.equal(suelos.aPie.ocupado(0, z - 0.01, PLAYER_RADIUS_M), true, `z=${z}: y justo en el borde`);
  });

  it("el resbalón no mete en el agua: con el río pegado a la cara más cercana, no empuja", () => {
    const conRio = mundo({ volumes: [VALLA], ground: [{ id: "rio", kind: "water", rect: [0, 62, 128, 4] } as GroundFeature] });
    const s2 = suelosDe(conRio);
    // Dentro de la valla, a 5 cm de su cara sur, con el río justo detrás.
    const p = { x: 0, z: zDeFila(62) - PLAYER_RADIUS_M - 0.05 };
    assert.equal(dentroDeLoBajo(p, PLAYER_RADIUS_M, s2), true);
    const e = empujeFueraDeLoBajo(p, PLAYER_RADIUS_M, s2, false, 0.5);
    assert.ok(Number.isFinite(e.dx) && Number.isFinite(e.dz), JSON.stringify(e));
    assert.equal(s2.enElAire.ocupado(p.x + e.dx, p.z + e.dz, PLAYER_RADIUS_M), false, JSON.stringify(e));
  });

  it("en el eje X igual: sale por la cara más cercana, y si es agua no empuja", () => {
    // Valla norte-sur en la columna 60 (banda 58,5–61,5 → celdas 58–61).
    const vallaNS = { id: "v", label: "cerca", type: "wall", points: [[60, 0], [60, 128]], h: 2 } as Volume;
    const xDeCol = (c: number) => RECT.minX + c * TILE_MPC;
    const seca = suelosDe(mundo({ volumes: [vallaNS] }));
    const cerca = { x: xDeCol(62) - PLAYER_RADIUS_M - 0.05, z: 0 }; // pegado a la cara ESTE
    const e = empujeFueraDeLoBajo(cerca, PLAYER_RADIUS_M, seca, false, 0.01);
    assert.ok(Math.abs(e.dx - EMPUJE_FUERA_DE_LO_BAJO_M_S * 0.01) < 1e-9 && e.dz === 0, JSON.stringify(e));
    // Un río que se come la mitad este de la valla: la salida corta (este)
    // mete más en el agua, así que no se empuja por ahí.
    const mojada = suelosDe(
      mundo({ volumes: [vallaNS], ground: [{ id: "rio", kind: "water", rect: [61, 0, 5, 128] } as GroundFeature] }),
    );
    const enLaOrilla = { x: xDeCol(61.2), z: 0 };
    assert.equal(dentroDeLoBajo(enLaOrilla, PLAYER_RADIUS_M, mojada), true);
    assert.equal(mojada.enElAire.ocupado(enLaOrilla.x, enLaOrilla.z, PLAYER_RADIUS_M), true, "precondición: pisa el río");
    assert.deepEqual(empujeFueraDeLoBajo(enLaOrilla, PLAYER_RADIUS_M, mojada, false, 0.01), { dx: 0, dz: 0 }, "hacia el río no");
    // Y lo mismo en Z, con la valla este-oeste y el río comiéndose su lado sur.
    const mojadaZ = suelosDe(
      mundo({ volumes: [VALLA], ground: [{ id: "rio", kind: "water", rect: [0, 61, 128, 5] } as GroundFeature] }),
    );
    const orillaZ = { x: 0, z: zDeFila(61.2) };
    assert.equal(mojadaZ.enElAire.ocupado(orillaZ.x, orillaZ.z, PLAYER_RADIUS_M), true, "precondición: pisa el río");
    assert.deepEqual(empujeFueraDeLoBajo(orillaZ, PLAYER_RADIUS_M, mojadaZ, false, 0.01), { dx: 0, dz: 0 }, "hacia el río no (Z)");
  });
});
