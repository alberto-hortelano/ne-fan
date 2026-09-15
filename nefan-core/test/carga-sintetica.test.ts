/** LA CARGA SINTÉTICA DEL BANCO, Y EL JUICIO QUE IMPIDE QUE UN REPRODUCTOR QUE
 *  NO REPRODUCE SALGA VERDE (#545).
 *
 *  El sujeto es `qa/lib/carga.mjs`, el módulo que `qa/bajo-carga.mjs` y
 *  `qa/run.mjs` usan para frenar una página por CDP y decir si el frenazo fue
 *  REAL. Está aquí, en `npm test`, por la misma razón que `esperas-de-qa`: el
 *  CI **no corre la batería de navegador**, así que la parte que decide si una
 *  corrida bajo carga significa algo solo se ejecutaría a mano y cuando alguien
 *  se acordara. El import cruzado es la regla, no un precedente (#357): la
 *  dirección es test → banco (`el-banco-no-entra-en-produccion`).
 *
 *  Tres cosas se miden aquí y las tres pueden ponerse rojas:
 *
 *  1. **El ancla del tope.** `CLAMP_DEL_LOOP` es una copia del `0.1` con que el
 *     `gameLoop` del cliente topa su delta (`nefan-html/src/main.ts`), y toda la
 *     medida de #545 cuelga de que sean el mismo número: la razón sim/pared es
 *     «cuánto tiempo pierde el mundo por culpa de ESE tope». Si alguien lo
 *     cambia en el juego y no en el banco, la sonda seguiría midiendo, en verde,
 *     contra un tope que ya no existe. Aquí se lee el fuente del cliente.
 *  2. **El juicio de si la carga fue real**, con sus cuatro desenlaces sin
 *     colapsar: no se pudo mirar · se miró y no bajó · se miró y bajó · la
 *     página no pintó nada (que no es «frenada», es «muerta»).
 *  3. **La comparación de las dos corridas**, donde «se arregló» y «no
 *     comparable» tienen nombre propio en vez de contarse como «igual» — un
 *     guion que no midió no puede votar, y colapsarlo fabricaría un verde.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Medida = {
  sim: number;
  frames: number;
  deltaMaxMs: number;
  oculta: boolean;
  paredMs: number;
  navegaciones?: number;
  almacen?: boolean;
};
type Juicio = { medido: boolean; real: boolean; razon: number | null; motivo: string };
type Fila = { nombre: string; estado: string; fallos?: string[] };
type Comparada = {
  nombre: string;
  quieto: string | null;
  cargado: string | null;
  cambio: string;
  fallosQuieto: string[];
  fallosCargado: string[];
};

const mod = (await import(join(repoRoot, "qa", "lib", "carga.mjs"))) as {
  CLAMP_DEL_LOOP: number;
  UMBRAL_DE_CARGA_REAL: number;
  PARED_MINIMA_MS: number;
  lineaDeMedida: (m: Medida | null, factor: number) => string;
  factorDelEntorno: (env: Record<string, string | undefined>) => number | null;
  razonDeLaMedida: (m: Medida | null) => number | null;
  juzgaLaCarga: (o: { factor: number; medida: Medida | null; umbral?: number }) => Juicio;
  comparaCorridas: (a: Fila[] | undefined, b: Fila[] | undefined) => Comparada[];
  veredictoDelReproductor: (o: { juicios: Juicio[]; comparacion: Comparada[] }) => {
    exit: number;
    titulo: string;
    detalle: string[];
  };
};
const {
  CLAMP_DEL_LOOP,
  UMBRAL_DE_CARGA_REAL,
  PARED_MINIMA_MS,
  lineaDeMedida,
  factorDelEntorno,
  razonDeLaMedida,
  juzgaLaCarga,
  comparaCorridas,
  veredictoDelReproductor,
} = mod;

/** Una medida de sonda con los valores por defecto de una corrida sana. */
const medida = (p: Partial<Medida> = {}): Medida => ({
  sim: 10,
  frames: 600,
  deltaMaxMs: 20,
  oculta: false,
  paredMs: 10_000,
  ...p,
});

describe("el tope del game loop está anclado, no copiado (#545)", () => {
  it("CLAMP_DEL_LOOP es el número que el cliente usa de verdad", () => {
    const main = readFileSync(join(repoRoot, "nefan-html", "src", "main.ts"), "utf8");
    const m = /Math\.min\(\(now - lastTime\) \/ 1000, ([\d.]+)\)/.exec(main);
    assert.ok(
      m,
      "no se encontró el tope del delta en nefan-html/src/main.ts. El ancla es la razón de ser de este " +
        "test: si el game loop cambia de forma, la sonda de carga mide contra un tope que ya no existe.",
    );
    assert.equal(
      Number(m![1]),
      CLAMP_DEL_LOOP,
      `el juego topa el delta en ${m![1]} s y qa/lib/carga.mjs mide con ${CLAMP_DEL_LOOP} s`,
    );
  });
});

describe("el factor de frenado se lee del entorno, y lo ilegible LANZA", () => {
  it("sin variable no hay carga, y eso es `null`, no cero", () => {
    assert.equal(factorDelEntorno({}), null);
    assert.equal(factorDelEntorno({ NEFAN_QA_CPU_FACTOR: "" }), null);
  });

  it("×1 es legítimo: es el control, no una corrida sin carga", () => {
    assert.equal(factorDelEntorno({ NEFAN_QA_CPU_FACTOR: "1" }), 1);
    assert.equal(factorDelEntorno({ NEFAN_QA_CPU_FACTOR: "20" }), 20);
  });

  it("un valor ilegible NO se interpreta como «sin carga»", () => {
    // Es el fallo silencioso que importa: una variable mal escrita daría una
    // corrida tranquila presentada como corrida bajo carga.
    for (const raw of ["abc", "0.5", "0", "-3", "NaN"]) {
      assert.throws(
        () => factorDelEntorno({ NEFAN_QA_CPU_FACTOR: raw }),
        /no es un factor de frenado/,
        `NEFAN_QA_CPU_FACTOR=«${raw}» debería parar la corrida`,
      );
    }
  });
});

describe("la razón sim/pared", () => {
  it("es 1 cuando ningún frame llega al tope", () => {
    assert.equal(razonDeLaMedida(medida({ sim: 10, paredMs: 10_000 })), 1);
  });

  it("baja exactamente lo que el tope se come", () => {
    // 50 frames de 200 ms = 10 s de pared; el tope deja 0,1 s por frame = 5 s.
    assert.equal(razonDeLaMedida(medida({ sim: 5, frames: 50, paredMs: 10_000 })), 0.5);
  });

  it("no se calcula sin pared ni sin frames, y esos dos no son lo mismo que «razón baja»", () => {
    assert.equal(razonDeLaMedida(null), null);
    assert.equal(razonDeLaMedida(medida({ paredMs: 0 })), null);
    assert.equal(razonDeLaMedida(medida({ frames: 0 })), null);
  });
});

describe("¿fue REAL la carga? — el juicio que no deja pasar un no-op", () => {
  it("sin sonda no se ha medido, y eso no es «no hubo carga»", () => {
    const j = juzgaLaCarga({ factor: 20, medida: null });
    assert.equal(j.medido, false);
    assert.equal(j.real, false);
    assert.match(j.motivo, /sonda/);
  });

  it("con la pestaña OCULTA no se ha medido: las dos escalas dejan de ser la misma", () => {
    const j = juzgaLaCarga({ factor: 20, medida: medida({ oculta: true }) });
    assert.equal(j.medido, false);
    assert.match(j.motivo, /OCULTA/);
  });

  it("una página que no pintó ni un frame está muerta, no frenada", () => {
    const j = juzgaLaCarga({ factor: 20, medida: medida({ frames: 0, sim: 0 }) });
    assert.equal(j.medido, false);
    assert.match(j.motivo, /muerta/);
  });

  it("una ventana demasiado corta NO es una razón, y se dice como «no medido»", () => {
    // El fallo real del 2026-09-15: la corrida de control del guion 91 vio 0,8 s
    // —porque `addInitScript` se reinicia en el reload del resume— y un frame de
    // 125 ms bastó para dar 0,935, o sea «carga real» sin haber frenado nada.
    const j = juzgaLaCarga({ factor: 1, medida: medida({ sim: 0.7, frames: 13, paredMs: 800 }) });
    assert.equal(j.medido, false);
    assert.equal(j.real, false);
    assert.match(j.motivo, /ms de pared/);
  });

  it("sin `sessionStorage` la ventana corta lo DICE, en vez de callarlo", () => {
    const j = juzgaLaCarga({ factor: 1, medida: medida({ paredMs: 800, almacen: false }) });
    assert.match(j.motivo, /sessionStorage/);
  });

  it("justo por encima del mínimo ya se juzga", () => {
    const j = juzgaLaCarga({ factor: 20, medida: medida({ sim: 3.2, frames: 40, paredMs: PARED_MINIMA_MS + 1 }) });
    assert.equal(j.medido, true);
  });

  it("razón ≈ 1 con factor alto: se miró y NO se reprodujo nada", () => {
    const j = juzgaLaCarga({ factor: 20, medida: medida({ sim: 9.99, paredMs: 10_000 }) });
    assert.equal(j.medido, true);
    assert.equal(j.real, false);
    assert.match(j.motivo, /NO se ha reproducido/);
  });

  it("×1 tampoco reproduce nada, que es lo que `--factor 1` tiene que decir", () => {
    const j = juzgaLaCarga({ factor: 1, medida: medida() });
    assert.equal(j.real, false);
  });

  it("razón por debajo del umbral: la carga fue real y dice cuánto", () => {
    const j = juzgaLaCarga({ factor: 20, medida: medida({ sim: 4, frames: 50, paredMs: 10_000 }) });
    assert.equal(j.medido, true);
    assert.equal(j.real, true);
    assert.equal(j.razon, 0.4);
    assert.match(j.motivo, /60 % menos/);
  });

  it("el umbral por defecto deja fuera la corrida de control medida (0,981)", () => {
    // La corrida de CONTROL del guion 91, medida el 2026-09-15: 22,9 s de sim en
    // 23,3 s de pared. Si el umbral dejara pasar esto, el reproductor firmaría
    // como «carga reproducida» una corrida que no frenó nada — y el rojo que
    // saliera se atribuiría a #545.
    assert.ok(UMBRAL_DE_CARGA_REAL < 1 && UMBRAL_DE_CARGA_REAL >= 0.5);
    assert.equal(juzgaLaCarga({ factor: 20, medida: medida({ sim: 22.9, frames: 669, paredMs: 23_300 }) }).real, false);
    // Y la corrida ×20 del mismo guion, también medida: 2,7 s de sim en 16,5 s.
    assert.equal(juzgaLaCarga({ factor: 20, medida: medida({ sim: 2.7, frames: 31, paredMs: 16_500 }) }).real, true);
  });
});

describe("la línea de una medida dice lo que la medida no cubre", () => {
  it("con varias navegaciones lo cuenta: la ventana no es una sola carga de página", () => {
    assert.match(lineaDeMedida(medida({ navegaciones: 3 }), 20), /3 navegaciones/);
  });

  it("sin almacén avisa de que solo midió el último tramo", () => {
    assert.match(lineaDeMedida(medida({ almacen: false }), 20), /SIN sessionStorage/);
  });

  it("la pestaña oculta sale en la línea, no solo en el veredicto", () => {
    assert.match(lineaDeMedida(medida({ oculta: true }), 20), /OCULTA/);
  });

  it("una ventana corta lo dice EN LA LÍNEA, que es lo que se pega en un informe", () => {
    // El control del guion 80, medido: 1,5 s de sim en 1,9 s de pared = 0,798.
    // El juicio ya la rechaza, pero la línea se imprime igual para las corridas
    // de control, que no se juzgan.
    assert.match(lineaDeMedida(medida({ sim: 1.5, frames: 34, paredMs: 1_900 }), 1), /VENTANA CORTA/);
    assert.ok(!lineaDeMedida(medida(), 1).includes("VENTANA CORTA"));
  });
});

describe("el color antes y después: cuatro desenlaces, ninguno colapsado", () => {
  const q: Fila[] = [
    { nombre: "a", estado: "verde" },
    { nombre: "b", estado: "verde" },
    { nombre: "c", estado: "rojo", fallos: ["ya estaba roto"] },
    { nombre: "d", estado: "verde" },
  ];
  const c: Fila[] = [
    { nombre: "a", estado: "verde" },
    { nombre: "b", estado: "rojo", fallos: ["el jugador ANDA: false"] },
    { nombre: "c", estado: "verde" },
    { nombre: "d", estado: "sin-medir" },
  ];
  const por = (rs: Comparada[], n: string) => rs.find((r) => r.nombre === n)!;

  it("verde → rojo es el ROJO REPRODUCIDO, y se lleva sus fallos", () => {
    const r = por(comparaCorridas(q, c), "b");
    assert.equal(r.cambio, "se-rompio");
    assert.deepEqual(r.fallosCargado, ["el jugador ANDA: false"]);
  });

  it("rojo → verde tiene nombre propio: NO es un éxito", () => {
    assert.equal(por(comparaCorridas(q, c), "c").cambio, "se-arreglo");
  });

  it("un guion que no midió no vota: es «no comparable», no «igual»", () => {
    assert.equal(por(comparaCorridas(q, c), "d").cambio, "no-comparable");
  });

  it("ausente en una de las dos tampoco es «igual»", () => {
    const r = comparaCorridas([{ nombre: "solo-quieto", estado: "verde" }], []);
    assert.equal(r[0].cambio, "no-comparable");
    assert.equal(r[0].cargado, null);
  });

  it("mismo color en las dos es «igual»", () => {
    assert.equal(por(comparaCorridas(q, c), "a").cambio, "igual");
  });
});

describe("el veredicto del REPRODUCTOR no es el veredicto de los guiones", () => {
  const real: Juicio = { medido: true, real: true, razon: 0.4, motivo: "bajó" };
  const flojo: Juicio = { medido: true, real: false, razon: 0.99, motivo: "no bajó" };
  const ciego: Juicio = { medido: false, real: false, razon: null, motivo: "sin sonda" };
  const comp = (cambio: string): Comparada => ({
    nombre: "91",
    quieto: "verde",
    cargado: "rojo",
    cambio,
    fallosQuieto: [],
    fallosCargado: [],
  });

  it("carga real + rojo reproducido: exit 0, y lo dice con el nombre del guion", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("se-rompio")] });
    assert.equal(v.exit, 0);
    assert.ok(v.detalle.some((d) => d.includes("ROJO REPRODUCIDO") && d.includes("91")));
  });

  it("sin comparación NO dice «nadie cambió de color»: dice que nadie miró", () => {
    // `--sin-quieto`. La diferencia importa: «nadie cambió» es un resultado,
    // «nadie miró» es la ausencia de uno, y se leen igual de tranquilizadores.
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [] });
    assert.equal(v.exit, 0);
    assert.ok(v.detalle.some((d) => d.includes("NINGÚN color se ha comparado")));
    assert.ok(!v.detalle.some((d) => d.includes("aguantó")));
  });

  it("carga real y nadie cambió de color: exit 0, pero se DICE que aguantó", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("igual")] });
    assert.equal(v.exit, 0);
    assert.ok(v.detalle.some((d) => d.includes("aguantó")));
  });

  it("la carga que no baja la razón sale con ERROR aunque todo esté verde", () => {
    const v = veredictoDelReproductor({ juicios: [flojo], comparacion: [comp("igual")] });
    assert.equal(v.exit, 1);
    assert.match(v.titulo, /NO FUE REAL/);
  });

  it("no haber podido mirar gana al «no bajó»: exit 2", () => {
    const v = veredictoDelReproductor({ juicios: [ciego, flojo], comparacion: [] });
    assert.equal(v.exit, 2);
  });

  it("cero rotos sobre cero comparables NO es «aguantó la carga»", () => {
    // El agujero que la sexta condición de `comparar` existe para tapar: un
    // veredicto tranquilizador que se cumple sin haber comparado nada.
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("no-comparable")] });
    assert.equal(v.exit, 2);
    assert.match(v.titulo, /NO SE COMPARÓ NADA/);
  });

  it("un cambio al revés se reporta como aviso, no como éxito", () => {
    const v = veredictoDelReproductor({
      juicios: [real],
      comparacion: [comp("se-rompio"), { ...comp("se-arreglo"), nombre: "80" }],
    });
    assert.equal(v.exit, 0);
    assert.ok(v.detalle.some((d) => d.includes("80") && d.includes("NO es un éxito")));
  });
});
