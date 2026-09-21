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
  sobreTope?: number;
  navegaciones?: number;
  almacen?: boolean;
};
type Juicio = { medido: boolean; real: boolean; razon: number | null; por?: string | null; motivo: string };
type Control = { vale: boolean; aviso: string | null; motivo: string | null };
type Fila = {
  nombre: string;
  estado: string;
  fallos?: string[];
  carga?: Medida | null;
};
type Comparada = {
  nombre: string;
  quieto: string | null;
  cargado: string | null;
  cargados: (string | null)[];
  rojas: number;
  corridas: number;
  cambio: string;
  firma: string | null;
  fallosQuieto: string[];
  fallosCargado: string[];
};

const mod = (await import(join(repoRoot, "qa", "lib", "carga.mjs"))) as {
  CLAMP_DEL_LOOP: number;
  UMBRAL_DE_CARGA_REAL: number;
  PARED_MINIMA_MS: number;
  COLA_MS: number;
  FACTOR_MAXIMO: number;
  lineaDeMedida: (m: Medida | null, factor: number) => string;
  opcionNumerica: (
    nombre: string,
    raw: string | undefined,
    o: { min: number; max: number; entero?: boolean; porDefecto?: number },
  ) => number;
  firmaDePresupuesto: (fallos: string[]) => boolean;
  juzgaElControl: (o: { medida: Medida | null; umbral?: number }) => Control;
  factorDelEntorno: (env: Record<string, string | undefined>) => number | null;
  razonDeLaMedida: (m: Medida | null) => number | null;
  juzgaLaCarga: (o: { factor: number; medida: Medida | null; umbral?: number }) => Juicio;
  comparaCorridas: (a: Fila[] | undefined, b: (Fila[] | undefined)[]) => Comparada[];
  veredictoDelReproductor: (o: { juicios: Juicio[]; comparacion: Comparada[]; control?: Control }) => {
    exit: number;
    titulo: string;
    detalle: string[];
  };
};
const {
  CLAMP_DEL_LOOP,
  UMBRAL_DE_CARGA_REAL,
  PARED_MINIMA_MS,
  COLA_MS,
  FACTOR_MAXIMO,
  lineaDeMedida,
  opcionNumerica,
  firmaDePresupuesto,
  juzgaElControl,
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
  sobreTope: 0,
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
        /No es un factor de frenado/,
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


describe("las cuatro opciones numéricas son fail-loud (H-2 de QA)", () => {
  it("un valor ilegible LANZA en vez de colarse como NaN", () => {
    // El defecto real: `--umbral abc` daba NaN, `razon > NaN` es siempre false,
    // y TODA corrida pasaba por «carga real» — incluida la de `--factor 1`, que
    // existe justo para negarse.
    for (const raw of ["abc", "", "NaN", "Infinity"]) {
      assert.throws(
        () => opcionNumerica("--umbral", raw || undefined, { min: 0.01, max: 0.999 }),
        /necesita un valor|no vale/,
        `--umbral «${raw}» debería parar la corrida`,
      );
    }
  });

  it("fuera de rango también LANZA, por los dos lados", () => {
    assert.throws(() => opcionNumerica("--umbral", "1.5", { min: 0.01, max: 0.999 }), /no vale/);
    assert.throws(() => opcionNumerica("--umbral", "0", { min: 0.01, max: 0.999 }), /no vale/);
    assert.throws(() => opcionNumerica("--factor", "200", { min: 1, max: FACTOR_MAXIMO }), /no vale/);
  });

  it("lo entero es entero: `--repeticiones 2.5` no es media corrida", () => {
    assert.throws(() => opcionNumerica("--repeticiones", "2.5", { min: 1, max: 20, entero: true }), /ENTERO/);
    assert.equal(opcionNumerica("--repeticiones", "3", { min: 1, max: 20, entero: true }), 3);
  });

  it("sin valor usa el defecto, y sin defecto LANZA", () => {
    assert.equal(opcionNumerica("--factor", undefined, { min: 1, max: 100, porDefecto: 40 }), 40);
    assert.throws(() => opcionNumerica("--factor", undefined, { min: 1, max: 100 }), /necesita un valor/);
  });

  it("el factor del ENTORNO pasa por el mismo techo", () => {
    assert.throws(() => factorDelEntorno({ NEFAN_QA_CPU_FACTOR: "500" }), /no vale/);
    assert.equal(factorDelEntorno({ NEFAN_QA_CPU_FACTOR: "40" }), 40);
  });
});

describe("la COLA vota: el defecto vive en el frame largo, no en la media (H-5 de QA)", () => {
  it("un frame de 1.150 ms cuenta como carga real aunque la media no se mueva", () => {
    // La corrida a ×4 que QA midió: razón 0,951 (rechazada por la media) con un
    // frame de 1.150 ms dentro, que se come el 26 % de un presupuesto de 4 s.
    const j = juzgaLaCarga({ factor: 4, medida: medida({ sim: 62.8, frames: 1828, paredMs: 66_000, deltaMaxMs: 1150, sobreTope: 40 }) });
    assert.equal(j.real, true);
    assert.equal(j.por, "cola");
    assert.match(j.motivo, /COLA/);
  });

  it("y dice cuál de los dos disparó cuando disparan los dos", () => {
    const j = juzgaLaCarga({ factor: 40, medida: medida({ sim: 20, frames: 120, paredMs: 100_000, deltaMaxMs: 9000 }) });
    assert.equal(j.por, "media+cola");
  });

  it("el peor frame de una corrida de CONTROL medida (342 ms) NO dispara la cola", () => {
    const j = juzgaLaCarga({ factor: 1, medida: medida({ sim: 25.1, frames: 700, paredMs: 25_600, deltaMaxMs: 342 }) });
    assert.equal(j.real, false);
    assert.equal(j.por, null);
    assert.match(j.motivo, /ni la media ni la cola/);
  });

  it("el umbral de la cola está acotado POR LOS DOS LADOS por lo medido", () => {
    // Por abajo: el peor frame de una corrida de CONTROL en este árbol son
    // 342 ms (seis corridas, mías y de QA), así que el control no se cuela.
    assert.ok(COLA_MS >= 2.5 * 342, "COLA_MS tiene que dejar margen sobre el peor frame de un control");
    // Por arriba: el frame de 1.150 ms que QA midió a ×4 TIENE que disparar —
    // es el caso que motivó todo esto.
    assert.ok(COLA_MS <= 1150, "COLA_MS no puede dejar fuera el frame de 1.150 ms medido a ×4");
  });
});

describe("la FIRMA de un presupuesto de reloj: lo único que se puede mirar sin inventar", () => {
  it("caza las tres bocas por las que una espera de reloj se vuelve fallo", () => {
    assert.ok(firmaDePresupuesto(["ocurre: el jugador LLEGA andando a 2.2 m de barkeep — no ocurrió en 4000 ms"]));
    assert.ok(firmaDePresupuesto(["ERROR: timeout esperando: el tabernero contesta (turno 1)"]));
    assert.ok(firmaDePresupuesto(["la espera «x» expiró a los 8000 ms en guiones/90.mjs:331 y nadie la observó"]));
  });

  it("NO la tiene el contador del guion 75, que es el caso que tumbó la atribución", () => {
    // El fallo literal medido por QA a ×20 sobre el 75: un CONTADOR sobre un
    // canal compartido contaminado por la vida ambiental, o sea #496/#497.
    assert.equal(
      firmaDePresupuesto([
        "3 · #410 · el tile que vuelve con otras salidas NO re-deriva su colisión (misma huella) — 2 derivaciones (había 1) — la escena servida cambió en: npcs (barkeep: position)",
      ]),
      false,
    );
  });

  it("tampoco la tiene el rojo de la colisión de la forja, que es del JUEGO", () => {
    assert.equal(
      firmaDePresupuesto([
        "en vivo: empujando contra «Forja de Robledo», el jugador NO entra en su caja — parada (9.43, -9.01) · le sobra -1.70 m al borde",
      ]),
      false,
    );
  });

  it("sin fallos no hay firma (y no se colapsa con «no atribuible»: no hay rojo)", () => {
    assert.equal(firmaDePresupuesto([]), false);
    assert.equal(firmaDePresupuesto(undefined as unknown as string[]), false);
  });
});

describe("el color antes y después: CINCO desenlaces y una frecuencia", () => {
  const q: Fila[] = [
    { nombre: "a", estado: "verde" },
    { nombre: "b", estado: "verde" },
    { nombre: "c", estado: "rojo", fallos: ["ya estaba roto"] },
    { nombre: "d", estado: "verde" },
    { nombre: "e", estado: "rojo", fallos: ["2 derivaciones (había 1)"] },
  ];
  const c1: Fila[] = [
    { nombre: "a", estado: "verde" },
    { nombre: "b", estado: "rojo", fallos: ["no ocurrió en 4000 ms"] },
    { nombre: "c", estado: "verde" },
    { nombre: "d", estado: "sin-medir" },
    { nombre: "e", estado: "rojo", fallos: ["2 derivaciones (había 1)"] },
  ];
  const c2: Fila[] = [
    { nombre: "a", estado: "verde" },
    { nombre: "b", estado: "verde" },
    { nombre: "c", estado: "verde" },
    { nombre: "d", estado: "verde" },
    { nombre: "e", estado: "rojo", fallos: ["2 derivaciones (había 1)"] },
  ];
  const por = (rs: Comparada[], n: string) => rs.find((r) => r.nombre === n)!;

  it("verde → rojo es un rojo BAJO CARGA, y trae su frecuencia", () => {
    const r = por(comparaCorridas(q, [c1, c2]), "b");
    assert.equal(r.cambio, "se-rompio");
    assert.equal(r.rojas, 1);
    assert.equal(r.corridas, 2);
    assert.deepEqual(r.cargados, ["rojo", "verde"]);
  });

  it("un rojo en 1 de 2 no se colapsa con un rojo en 2 de 2: la frecuencia es el dato", () => {
    const r = por(comparaCorridas(q, [c1, c1]), "b");
    assert.equal(r.rojas, 2);
    assert.equal(r.corridas, 2);
  });

  it("ROJO en las dos es `igual-rojo` y NUNCA `igual`: no ha aguantado nada (H-3)", () => {
    const r = por(comparaCorridas(q, [c1, c2]), "e");
    assert.equal(r.cambio, "igual-rojo");
  });

  it("verde en las dos es `igual-verde`", () => {
    assert.equal(por(comparaCorridas(q, [c1, c2]), "a").cambio, "igual-verde");
  });

  it("rojo → verde tiene nombre propio: NO es un éxito", () => {
    assert.equal(por(comparaCorridas(q, [c1, c2]), "c").cambio, "se-arreglo");
  });

  it("si NO midió en alguna de las frenadas, no vota: `no-comparable`", () => {
    assert.equal(por(comparaCorridas(q, [c1, c2]), "d").cambio, "no-comparable");
  });

  it("ausente en una de las dos tampoco es «igual»", () => {
    const r = comparaCorridas([{ nombre: "solo-quieto", estado: "verde" }], [[]]);
    assert.equal(r[0].cambio, "no-comparable");
    assert.equal(r[0].cargado, null);
  });

  it("la FIRMA viaja con el rojo, y solo con el rojo", () => {
    const rs = comparaCorridas(q, [c1, c2]);
    assert.equal(por(rs, "b").firma, "presupuesto");
    assert.equal(por(rs, "a").firma, null, "un guion que no se rompió no lleva firma");
    // El 75: rojo en las dos, así que ni siquiera llega a clasificarse — y si
    // hubiera sido verde quieto, su firma sería `sin-firma`.
    //
    // Y se le pone delante el rojo REAL del 75 bajo carga, con la razón
    // sim/pared hundida en su fila (medido, a ×20 la razón se hunde también para
    // el 75): sigue saliendo `sin-firma`, porque el clasificador solo mira el
    // TEXTO del fallo y un contador que sube no lleva firma de presupuesto. Es
    // la no-regresión de #496/#497: la defensa no se afloja por mucho que el
    // mundo fuese lento en esa corrida. (Hasta la tanda W había una tercera
    // firma, la de una TASA que el guion declaraba con su denominador de pared y
    // que caía; se retiró con su único sujeto, el 93, el día que ese guion pasó
    // a medir contra el reloj de sim y dejó de poder caer por la carga.)
    const rs75 = comparaCorridas(
      [{ nombre: "e", estado: "verde" }],
      [
        [
          {
            nombre: "e",
            estado: "rojo",
            fallos: ["2 derivaciones (había 1) — la escena servida cambió en: npcs (barkeep: position)"],
            carga: medida({ sim: 2.62, paredMs: 10_000 }),
          },
        ],
      ],
    );
    assert.equal(rs75[0].cambio, "se-rompio");
    assert.equal(rs75[0].firma, "sin-firma", "y aun así NO es atribuible: un contador que sube no lleva firma");
  });
});

describe("la corrida de CONTROL también se juzga (H-8 de QA)", () => {
  it("un control que ya venía frenado invalida la base entera", () => {
    const ctl = juzgaElControl({ medida: medida({ sim: 5, frames: 60, paredMs: 10_000 }) });
    assert.equal(ctl.vale, false);
    assert.match(ctl.motivo!, /ya venía frenada/);
  });

  it("y entonces el veredicto es exit 2: no se compara contra una base mala", () => {
    const v = veredictoDelReproductor({
      juicios: [{ medido: true, real: true, razon: 0.4, motivo: "bajó" }],
      comparacion: [],
      control: { vale: false, aviso: null, motivo: "la base no vale" },
    });
    assert.equal(v.exit, 2);
    assert.match(v.titulo, /LA BASE NO VALE/);
  });

  it("un hipo suelto en el control NO mata la corrida: sale como aviso", () => {
    const ctl = juzgaElControl({ medida: medida({ deltaMaxMs: 1500 }) });
    assert.equal(ctl.vale, true);
    assert.match(ctl.aviso!, /1500 ms/);
  });

  it("el control medido de verdad (0,981 con peor frame 313 ms) vale y no avisa", () => {
    const ctl = juzgaElControl({ medida: medida({ sim: 22.9, frames: 669, paredMs: 23_300, deltaMaxMs: 313 }) });
    assert.deepEqual(ctl, { vale: true, aviso: null, motivo: null });
  });
});

describe("el veredicto del REPRODUCTOR no es el veredicto de los guiones", () => {
  const real: Juicio = { medido: true, real: true, razon: 0.4, por: "media", motivo: "bajó" };
  const flojo: Juicio = { medido: true, real: false, razon: 0.99, por: null, motivo: "no bajó" };
  const ciego: Juicio = { medido: false, real: false, razon: null, motivo: "sin sonda" };
  const comp = (cambio: string, extra: Partial<Comparada> = {}): Comparada => ({
    nombre: "91",
    quieto: "verde",
    cargado: "rojo",
    cargados: ["rojo"],
    rojas: cambio === "se-rompio" ? 1 : 0,
    corridas: 1,
    cambio,
    firma: cambio === "se-rompio" ? "presupuesto" : null,
    fallosQuieto: [],
    fallosCargado: [],
    ...extra,
  });

  it("un rojo bajo carga se anuncia con su FRECUENCIA, no como un desenlace", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("se-rompio", { rojas: 1, corridas: 5 })] });
    assert.equal(v.exit, 0);
    assert.ok(v.detalle.some((d) => d.includes("ROJO BAJO CARGA") && d.includes("1 de 5")));
  });

  it("NUNCA lo llama «el rojo de #545»: eso es una atribución que no puede hacer (H-4)", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("se-rompio")] });
    assert.ok(!v.detalle.some((d) => /rojo de #545|entregable de #545/.test(d)));
  });

  it("con firma dice COMPATIBLE con #545 y que no lo prueba", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("se-rompio", { firma: "presupuesto" })] });
    assert.ok(v.detalle.some((d) => d.includes("COMPATIBLE con #545") && d.includes("no lo prueba")));
  });

  it("SIN firma dice que NO es atribuible a #545 y nombra a #496/#497", () => {
    // El caso del 75, que es el que tumbó la atribución.
    const v = veredictoDelReproductor({
      juicios: [real],
      comparacion: [comp("se-rompio", { nombre: "75", firma: "sin-firma" })],
    });
    assert.ok(v.detalle.some((d) => d.includes("no es atribuible a #545") && d.includes("#496/#497")));
  });

  it("sin comparación NO dice «nadie cambió de color»: dice que nadie miró", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [] });
    assert.equal(v.exit, 0);
    assert.ok(v.detalle.some((d) => d.includes("NINGÚN color se ha comparado")));
    assert.ok(!v.detalle.some((d) => /aguanta la carga/.test(d)));
  });

  it("un guion ROJO en las dos NO «aguantó»: se dice que ya estaba roto (H-3)", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("igual-rojo", { quieto: "rojo" })] });
    assert.equal(v.exit, 0);
    assert.ok(v.detalle.some((d) => d.includes("ya estaban ROJOS sin carga")));
    // La frase tranquilizadora, la de verdad, no puede aparecer.
    assert.ok(!v.detalle.some((d) => /aguanta la carga/.test(d)));
  });

  it("verde en las dos con UNA muestra no es «aguanta»: es una muestra", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("igual-verde", { corridas: 1 })] });
    assert.equal(v.exit, 0);
    assert.ok(v.detalle.some((d) => d.includes("NO es «aguanta»") && d.includes("probabilístico")));
  });

  it("…y con cinco muestras sí se puede decir, diciendo cuántas", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("igual-verde", { corridas: 5 })] });
    assert.ok(v.detalle.some((d) => d.includes("0 rojos en 5 corridas") && d.includes("aguanta")));
  });

  it("la carga que no baja ni la media ni la cola sale con ERROR aunque todo esté verde", () => {
    const v = veredictoDelReproductor({ juicios: [flojo], comparacion: [comp("igual-verde")] });
    assert.equal(v.exit, 1);
    assert.match(v.titulo, /NO FUE REAL/);
  });

  it("no haber podido mirar gana al «no bajó»: exit 2", () => {
    const v = veredictoDelReproductor({ juicios: [ciego, flojo], comparacion: [] });
    assert.equal(v.exit, 2);
  });

  it("cero rotos sobre cero comparables NO es «aguantó la carga»", () => {
    const v = veredictoDelReproductor({ juicios: [real], comparacion: [comp("no-comparable")] });
    assert.equal(v.exit, 2);
    assert.match(v.titulo, /NO SE COMPARÓ NADA/);
  });

  it("un cambio al revés se reporta como aviso, no como éxito", () => {
    const v = veredictoDelReproductor({
      juicios: [real],
      comparacion: [comp("se-rompio"), comp("se-arreglo", { nombre: "80", quieto: "rojo" })],
    });
    assert.equal(v.exit, 0);
    assert.ok(v.detalle.some((d) => d.includes("80") && d.includes("NO es un éxito")));
  });
});
