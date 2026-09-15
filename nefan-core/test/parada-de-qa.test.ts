/** EL PATRÓN DE LA PARADA DEL BANCO, EJERCIDO (#545).
 *
 *  El sujeto es `qa/lib/parada.mjs`: el molde con el que un guion declara que el
 *  jugador «empujó contra algo y dejó de avanzar». Estaba escrito a mano en los
 *  guiones, y bajo carga leía paradas que no existen — entre dos sondeos de 150
 *  ms de PARED puede no haber corrido ni un frame, y entonces la posición es la
 *  misma porque el mundo no se ha simulado, no porque el jugador se haya parado.
 *
 *  Aquí se EJERCE el predicado con una página falsa cuyo reloj se mueve a mano,
 *  que es lo que ningún navegador deja hacer: con el mundo parado se sondea
 *  tantas veces como haga falta y **no puede salir una parada**; con el mismo
 *  jugador igual de quieto y el mundo corriendo, sale a la tercera muestra.
 *  Mismo material, dos veredictos, y el que decide es el reloj del mundo.
 *
 *  Lo que esto NO prueba, y lo prueba el guion 132 sobre la página real: que
 *  Playwright serialice el predicado hacia el navegador y que el cliente
 *  publique `reloj()` cuando el mundo corre y no cuando no.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Arg = Record<string, unknown>;
type Vista = { x: number; z: number; arranco: boolean; muestras: number; saltadas: number; sim: number };

const parada = (await import(join(repoRoot, "qa", "lib", "parada.mjs"))) as {
  PASO_DE_SIM_S: number;
  paradaEnSim: (opciones?: Record<string, unknown>) => Arg;
  elJugadorSePara: (a: Arg) => Vista | null;
};
const { PASO_DE_SIM_S, paradaEnSim, elJugadorSePara } = parada;

const sonda = (await import(join(repoRoot, "qa", "lib", "sonda.mjs"))) as { CADENCIA_MS: number };

/** Un `paso` binario exacto para los casos que cuentan sondeos uno a uno: con
 *  0,15 la aritmética de coma flotante decide empates y el caso dejaría de
 *  medir lo que dice. Que el paso REAL sea la cadencia de la sonda se afirma
 *  aparte, en su propio test. */
const PASO = 0.25;

/** Una página falsa con dos diales independientes: dónde está el jugador y qué
 *  marca el reloj del mundo. Que se puedan mover por separado ES el experimento
 *  — en un navegador van atados, y por eso el defecto no se puede reproducir
 *  ahí a voluntad. */
function paginaFalsa({ x = 0, z = 0 }: { x?: number; z?: number } = {}) {
  const estado = { sim: 0, frames: 0, loop: 0, x, z, yaw: 0, conReloj: true };
  (globalThis as unknown as { window?: unknown }).window = {
    __nefan: {
      state: () => ({ pos: { x: estado.x, z: estado.z } }),
      setYaw: (v: number) => {
        estado.yaw = v;
      },
      get reloj() {
        return estado.conReloj
          ? () => ({ sim: estado.sim, frames: estado.frames, loop: estado.loop })
          : undefined;
      },
    },
  };
  return estado;
}

type Estado = ReturnType<typeof paginaFalsa>;

/** Sondea `veces` veces, moviendo el mundo `sim` segundos y al jugador `metros`
 *  metros ENTRE sondeos. Devuelve la parada, si la hubo, y en qué sondeo. */
function sondea(
  arg: Arg,
  estado: Estado,
  { veces, sim, metros = 0 }: { veces: number; sim: number; metros?: number },
) {
  for (let i = 1; i <= veces; i++) {
    const r = elJugadorSePara(arg);
    if (r) return { parada: r, enElSondeo: i };
    estado.sim += sim;
    estado.frames += sim > 0 ? 1 : 0;
    estado.loop += 1;
    estado.x += metros;
  }
  return { parada: null as Vista | null, enElSondeo: null };
}

describe("una muestra solo cuenta si el MUNDO ha corrido (#545)", () => {
  it("**con el mundo PARADO no sale una parada por muchos sondeos que se hagan**", () => {
    // El defecto, exactamente: el jugador no se ha movido porque no ha habido
    // frame. La versión de pared se apuntaba tres muestras en 450 ms y declaraba
    // una parada que nunca ocurrió.
    const estado = paginaFalsa({ x: 10 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO });
    const { parada } = sondea(arg, estado, { veces: 200, sim: 0 });
    assert.equal(parada, null, "declaró una parada sin que el mundo simulara un solo segundo");
  });

  it("**MISMO material, DOS veredictos**: el jugador igual de quieto, y decide el reloj", () => {
    // Si el caso de arriba pasara también con el mundo corriendo, no estaría
    // midiendo el reloj: estaría midiendo que el molde no declara nunca nada.
    const parado = sondea(paradaEnSim({ slot: "__qaParada", paso: PASO }), paginaFalsa({ x: 10 }), {
      veces: 20,
      sim: 0,
    });
    const corriendo = sondea(paradaEnSim({ slot: "__qaParada", paso: PASO }), paginaFalsa({ x: 10 }), {
      veces: 20,
      sim: PASO,
    });
    assert.equal(parado.parada, null);
    assert.ok(corriendo.parada, "con el mundo corriendo la MISMA quietud sí es una parada");
  });

  it("…y los sondeos que no contaron quedan APUNTADOS, que es lo que dice si esto hizo algo", () => {
    const estado = paginaFalsa({ x: 10 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO });
    // 30 sondeos con el mundo parado (el 1º es la base, los otros 29 se saltan)
    // y luego el mundo corre: la parada sale, y trae la cuenta de lo saltado.
    sondea(arg, estado, { veces: 30, sim: 0 });
    const { parada } = sondea(arg, estado, { veces: 10, sim: PASO });
    assert.ok(parada, "con el mundo corriendo la parada tiene que salir");
    // 29 del primer tramo + el primer sondeo del segundo, que todavía lee el
    // reloj donde lo dejó el anterior.
    assert.equal(parada!.saltadas, 30, `saltadas=${parada!.saltadas}`);
    assert.equal(parada!.muestras, 3);
  });

  it("la parada sale en la TERCERA muestra, ni antes ni después", () => {
    const estado = paginaFalsa({ x: 10 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO });
    // Sondeo 1 = la base; 2, 3 y 4 = las tres muestras quietas.
    const { enElSondeo, parada } = sondea(arg, estado, { veces: 10, sim: PASO });
    assert.equal(enElSondeo, 4);
    assert.equal(parada!.muestras, 3);
  });

  it("medio `paso` de mundo NO es una muestra: hacen falta dos sondeos por muestra", () => {
    const estado = paginaFalsa({ x: 10 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO });
    const { enElSondeo } = sondea(arg, estado, { veces: 20, sim: PASO / 2 });
    // base (1) + 2 sondeos por cada una de las 3 muestras = 7
    assert.equal(enElSondeo, 7);
  });

  it("un jugador que avanza NO se para, por mucho mundo que corra", () => {
    const estado = paginaFalsa({ x: 10 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO });
    const { parada } = sondea(arg, estado, { veces: 200, sim: PASO, metros: 0.5 });
    assert.equal(parada, null);
  });
});

describe("lo que el molde NO cambió respecto de lo que había escrito a mano", () => {
  it("el paso en segundos de mundo es la cadencia de `waitFor`, derivada y no elegida", () => {
    // Dos definiciones del mismo ritmo es como nació el defecto: si alguien
    // cambia la cadencia de la sonda, este paso cambia con ella.
    assert.equal(PASO_DE_SIM_S, sonda.CADENCIA_MS / 1000);
  });

  it("«desde que se movió» y «muestra anterior» NO son lo mismo, y las dos están escritas", () => {
    // Una deriva de 1,5 cm por muestra: contra la ÚLTIMA POSICIÓN DONDE SE MOVIÓ
    // acumula y pasa de 2 cm (el jugador avanza, no hay parada); contra la
    // muestra anterior cada paso queda por debajo del umbral y sale parada. Los
    // guiones que tenían esto escrito a mano medían cada uno una de las dos, y
    // colapsarlas aquí habría cambiado lo que afirman.
    const a = sondea(
      paradaEnSim({ slot: "__qaParada", paso: PASO, referencia: "desde-que-se-movio" }),
      paginaFalsa({ x: 10 }),
      { veces: 40, sim: PASO, metros: 0.015 },
    );
    const b = sondea(
      paradaEnSim({ slot: "__qaParada", paso: PASO, referencia: "muestra-anterior" }),
      paginaFalsa({ x: 10 }),
      { veces: 40, sim: PASO, metros: 0.015 },
    );
    assert.equal(a.parada, null, "«desde que se movió» acumula la deriva: eso no es estar parado");
    assert.ok(b.parada, "«muestra anterior» mira solo el último paso, y 1,5 cm no llega al umbral");
  });

  it("la puerta del ARRANQUE: quien no se ha movido de donde estaba no se ha parado contra nada", () => {
    // Sin ella, un jugador ya parado contra otra cosa cumpliría «no avanza» sin
    // haber medido nada — es la precondición que el guion 91 AFIRMA.
    const estado = paginaFalsa({ x: 10 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO, arranque: 0.15 });
    assert.equal(sondea(arg, estado, { veces: 50, sim: PASO }).parada, null);
    // Y en cuanto anda de verdad, sí.
    estado.x += 1;
    const { parada } = sondea(arg, estado, { veces: 10, sim: PASO });
    assert.ok(parada);
    assert.equal(parada!.arranco, true);
  });

  it("la BANDA (`dentroDe`): fuera de ella una parada no dice nada del muro", () => {
    const estado = paginaFalsa({ x: 0 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO, dentroDe: { eje: "x", de: 100, holgura: 2 } });
    assert.equal(sondea(arg, estado, { veces: 50, sim: PASO }).parada, null);
    estado.x = 99;
    assert.ok(sondea(arg, estado, { veces: 10, sim: PASO }).parada);
  });

  it("con `eje` se mide UN eje: el deslizamiento lateral no cuenta como avanzar", () => {
    // Es lo que miden los guiones 86 y 109 contra el muro de la frontera: andar
    // al este y quedarse sin ganar X, aunque el motor deslice al jugador en Z.
    const estado = paginaFalsa({ x: 0, z: 0 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO, eje: "x", umbral: 0.01, muestras: 1 });
    assert.equal(elJugadorSePara(arg), null, "el primer sondeo es la base, no una muestra");
    estado.sim += PASO;
    estado.z += 0.5;
    assert.ok(elJugadorSePara(arg), "con eje x, moverse medio metro en z no es avanzar");
  });

  it("…y con la distancia euclídea ese mismo medio metro SÍ es avanzar (control del eje)", () => {
    const estado = paginaFalsa({ x: 0, z: 0 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO, umbral: 0.01, muestras: 1 });
    elJugadorSePara(arg);
    estado.sim += PASO;
    estado.z += 0.5;
    assert.equal(elJugadorSePara(arg), null);
  });

  it("con `destino` re-encara al jugador en cada sondeo, como hace quien juega", () => {
    const estado = paginaFalsa({ x: 0, z: 0 });
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO, destino: { x: 0, z: 10 } });
    elJugadorSePara(arg);
    assert.equal(estado.yaw, Math.atan2(0, 10));
    estado.x = 10;
    elJugadorSePara(arg);
    assert.equal(estado.yaw, Math.atan2(-10, 10));
  });
});

describe("las opciones del molde son fail-loud (la lección de `combate.mjs`)", () => {
  it("una opción que no existe LANZA, y dice cuáles hay", () => {
    // Sin esto se desestructura en silencio y el molde mide con su defecto:
    // exactamente el H-3 de PR-4a, donde tres sitios pedían 90/120/45 s y
    // esperaban con 60.
    assert.throws(() => paradaEnSim({ slot: "__x", umbralM: 0.5 }), /`umbralM`[\s\S]*`umbral`/);
    assert.throws(() => paradaEnSim({ slot: "__x", maxMs: 12_000 }), /`maxMs`/);
  });

  it("la FIRMA vieja también: un número suelto no se cuela", () => {
    assert.throws(() => paradaEnSim(12_000 as never), /las opciones son un OBJETO/);
    assert.throws(() => paradaEnSim(null as never), /las opciones son un OBJETO/);
    assert.throws(() => paradaEnSim([0.02] as never), /las opciones son un OBJETO/);
  });

  it("un `slot` que no es una ranura de la página LANZA", () => {
    assert.throws(() => paradaEnSim({}), /`slot`/);
    assert.throws(() => paradaEnSim({ slot: "qa91" }), /`slot`/);
  });

  it("un `paso`, un `umbral` o unas `muestras` que no se entienden LANZAN", () => {
    assert.throws(() => paradaEnSim({ slot: "__x", paso: 0 }), /SEGUNDOS DE MUNDO/);
    assert.throws(() => paradaEnSim({ slot: "__x", paso: "0.15" as never }), /SEGUNDOS DE MUNDO/);
    assert.throws(() => paradaEnSim({ slot: "__x", muestras: 2.5 }), /entero/);
    assert.throws(() => paradaEnSim({ slot: "__x", umbral: -1 }), /METROS/);
    assert.throws(() => paradaEnSim({ slot: "__x", eje: "y" }), /`eje`/);
    assert.throws(() => paradaEnSim({ slot: "__x", referencia: "la-de-antes" }), /`referencia`/);
  });

  it("y las que SÍ existen no lanzan (control: si lanzara todo, lo de arriba no mide nada)", () => {
    paradaEnSim({
      slot: "__qa91",
      paso: 0.2,
      muestras: 3,
      umbral: 0.02,
      eje: "x",
      referencia: "muestra-anterior",
      destino: { x: 1, z: 2 },
      arranque: 0.15,
      dentroDe: { eje: "x", de: 10, holgura: 2 },
    });
  });
});

describe("un cliente sin reloj no produce paradas (el ⊘ lo declara la sonda)", () => {
  it("sin `__nefan.reloj()` no se cuenta ni una muestra", () => {
    // La sonda ya se niega a medir en sim contra un cliente sin reloj y lo dice
    // con su ⊘ antes del primer sondeo (`qa/lib/sonda.mjs`); lo que aquí se
    // afirma es que el molde no se inventa una parada por su cuenta si llegara.
    const estado = paginaFalsa({ x: 10 });
    estado.conReloj = false;
    const arg = paradaEnSim({ slot: "__qaParada", paso: PASO });
    assert.equal(sondea(arg, estado, { veces: 100, sim: PASO }).parada, null);
  });
});
