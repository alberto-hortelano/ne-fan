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
  type Salto,
} from "../src/simulation/salto-del-jugador.js";
import { pasoDelJugador, velocidadDelJugador } from "../src/simulation/paso-del-jugador.js";
import { solidoBloquea } from "../src/simulation/salida-del-solido.js";
import { loadConfig } from "../src/combat/combat-data.js";
import {
  createTerrainCollider,
  PLAYER_RADIUS_M,
  SALTO_APOGEO_M,
  type TerrainCollider,
} from "../src/scene/terrain-collision.js";
import { planCollisionGrid, planCollisionGridEnElAire } from "../src/scene/blueprint/plan-collision.js";
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
  const c = (grid: typeof aPie): TerrainCollider | null => (grid ? createTerrainCollider(grid) : null);
  return { aPie: c(aPie), enElAire: c(aire) };
}

/** Anda hacia el NORTE (−z) a 60 fps durante `segundos`, saltando en el frame
 *  `saltaEn` (o nunca). Devuelve la z final. Es el bucle de `main.ts` en
 *  pequeño: el salto del frame, el suelo que toca y el paso. */
function correr(
  m: ReturnType<typeof mundo>,
  desdeZ: number,
  opts: { saltaEn?: number; segundos?: number } = {},
): { z: number; salto: Salto } {
  const pos = { x: 0, z: desdeZ };
  let salto: Salto = EN_EL_SUELO;
  const delta = 1 / 60;
  const frames = Math.round((opts.segundos ?? 1.5) / delta);
  for (let f = 0; f < frames; f++) {
    salto = saltoDelFrame(salto, { delta, duracion: DURACION, pide: f === opts.saltaEn, puedeMoverse: true });
    const col = enElAire(salto) ? m.enElAire : m.aPie;
    const suelo = { ocupado: (x: number, z: number, r: number) => col?.solapaSolido(x, z, r) ?? false };
    const { dx, dz } = pasoDelJugador({
      desde: pos,
      forward: { x: 0, z: -1 },
      intencion: { adelante: 1, derecha: 0 },
      velocidad: velocidadDelJugador(jugador, false),
      delta,
      solido: (x, z) => solidoBloquea(pos, { x, z }, PLAYER_RADIUS_M, suelo),
    });
    pos.x += dx;
    pos.z += dz;
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

  /** Despega a `lejos` m de la cara y deja de avanzar justo al aterrizar:
   *  devuelve dónde, y si desde ahí se puede seguir hacia delante o atrás. */
  function aterrizaDentro(lejos: number) {
    const m = mundo({ volumes: [VALLA] });
    const { z } = correr(m, TOPE_SUR + lejos, { saltaEn: 0, segundos: DURACION + 1 / 60 });
    assert.ok(m.aPie!.solapaSolido(0, z, PLAYER_RADIUS_M), `aterrizó en z=${z}, que tendría que estar dentro`);
    const pos = { x: 0, z };
    const suelo = { ocupado: (x: number, zz: number, r: number) => m.aPie!.solapaSolido(x, zz, r) };
    return {
      z,
      adelante: !solidoBloquea(pos, { x: 0, z: z - 0.05 }, PLAYER_RADIUS_M, suelo),
      atras: !solidoBloquea(pos, { x: 0, z: z + 0.05 }, PLAYER_RADIUS_M, suelo),
    };
  }

  it("saltando lejos, se aterriza DENTRO de la valla sin pasar la mitad: se sale hacia atrás", () => {
    // Nadie se queda encerrado encima de una cerca: lo saca «salir sí, entrar
    // no» (`salida-del-solido.ts`) por la cara más cercana, que aquí es la sur.
    const r = aterrizaDentro(2.4);
    assert.deepEqual({ adelante: r.adelante, atras: r.atras }, { adelante: false, atras: true }, `z=${r.z}`);
  });

  it("y pasada la mitad, la salida es hacia DELANTE: el salto casi completo se completa andando", () => {
    const r = aterrizaDentro(1.5);
    assert.deepEqual({ adelante: r.adelante, atras: r.atras }, { adelante: true, atras: false }, `z=${r.z}`);
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
