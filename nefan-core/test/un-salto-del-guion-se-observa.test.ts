/** Un salto de un guion que nadie observa se pone ROJO (#356, tanda AG,
 *  2026-09-23).
 *
 *  ## Qué sujeta
 *
 *  Un guion de `qa/guiones/` que aserta otras cosas y se salta UN bloque por
 *  una precondición salía VERDE:
 *
 *      if (!precondicion) { ctx.log("⚠ no se pudo medir X"); return; }
 *
 *  #639 cerró el guion MUDO entero (`veredictoDeGuion` exige
 *  `afirmaciones > 0`). Esto cierra la mudez PARCIAL: todo salto —un `return`
 *  temprano, o un `if` cuya otra rama no afirma nada— está OBSERVADO (la rama
 *  declara, afirma o lanza, o la condición se afirmó antes) o está en el
 *  padrón `data/contract/saltos-sin-observar.json` con su motivo. La
 *  definición exacta está en la cabecera de `saltos-del-guion.ts` y en el
 *  `_comment` del padrón.
 *
 *  ## Por qué el árbol y no el runner
 *
 *  149 de los 157 guiones abren navegador y la batería de navegador no corre
 *  en CI. Una regla en tiempo de ejecución solo se pondría roja el día que
 *  alguien corriera la batería en local Y la precondición fallase. El criterio
 *  es que se ponga roja cuando un guion ESCRIBE la forma que escapa, y eso
 *  solo lo da el árbol, en `npm test`, o sea en CADA PR.
 *
 *  ## Por qué no `ctx.bloque(titulo, fn)` (la propuesta del issue)
 *
 *  Un `return` en el nivel superior se salta las llamadas a `ctx.bloque` de
 *  después y el runner nunca se entera de que existían: era la forma literal
 *  del issue (el guion 28). Y «un bloque sin asertos no se midió» es #639 una
 *  talla más fina: un bloque que afirma una vez y luego se salta la mitad
 *  sigue verde. Ver `docs/agents/2026-09-23-tanda-ag-ctx-bloque/critica.md`.
 *
 *  ## Lo que NO sujeta
 *
 *  Está en `_lo_que_esto_NO_sujeta` del padrón, y cada punto tiene aquí un
 *  `it` «LÍMITE MEDIDO» con su cifra de hoy. */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { fuentesDelBanco } from "./banco-ficheros.js";
import { arbolDelBanco, cuerpoPrincipal } from "./helpers-del-banco.js";
import { saltosDelGuion, type Lector, type Salto } from "./saltos-del-guion.js";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const QA = join(repoRoot, "qa");
const CONTRATO = join(core, "data", "contract", "saltos-sin-observar.json");

/** El trinquete: el número EXACTO de entradas del padrón. Solo baja. */
const TECHO = 1;

const PadronSchema = z
  .object({
    _comment: z.string().min(1),
    /** Obligatorio y no decorado: un absoluto en la cabecera de un contrato es
     *  lo que hace que el siguiente no mire (lección del molde, QA de #662). */
    _lo_que_esto_NO_sujeta: z.string().min(1),
    saltos: z.array(
      z
        .object({
          fichero: z.string().regex(/^qa\/guiones\/[^/]+\.mjs$/, "una entrada nombra un `qa/guiones/*.mjs`"),
          /** `condicionNormalizada`: la condición del `if` sin espacios. */
          condicion: z.string().min(1),
          /** Una frase que diga por qué este salto es honesto sin observarse. */
          motivo: z.string().min(40, "el motivo de un salto sin observar es una frase, no una etiqueta (≥ 40 caracteres)"),
        })
        .strict(),
    ),
  })
  .strict();

const leerDisco: Lector = (r) => readFileSync(r, "utf8");
const padron = PadronSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const guiones = fuentesDelBanco(QA).filter((f) => /^guiones\/[^/]+\.mjs$/.test(f));
const relativa = (g: string): string => `qa/${g}`;
const saltos: Salto[] = guiones.flatMap((g) => saltosDelGuion(join(QA, g), leerDisco).map((s) => ({ ...s, fichero: relativa(g) })));
const sinObservar = saltos.filter((s) => !s.observado);
const clave = (s: { fichero: string; condicion: string }): string => `${s.fichero} · ${s.condicion}`;

/** Un guion y sus libs en memoria, para los unitarios. `lib` va a `qa/lib/`. */
function analiza(cuerpo: string, opciones: { antes?: string; lib?: Record<string, string>; helpers?: boolean } = {}): Salto[] {
  const ficheros = new Map<string, string>([["/v/qa/guiones/x.mjs", `${opciones.antes ?? ""}\nexport default async function (ctx) {\n${cuerpo}\n}\n`]]);
  for (const [nombre, fuente] of Object.entries(opciones.lib ?? {})) ficheros.set(`/v/qa/lib/${nombre}`, fuente);
  const leer: Lector = (r) => {
    const f = ficheros.get(r);
    if (f === undefined) throw new Error(`ENOENT: ${r}`);
    return f;
  };
  return saltosDelGuion("/v/qa/guiones/x.mjs", leer, { helpers: opciones.helpers });
}
const rojos = (s: Salto[]): Salto[] => s.filter((x) => !x.observado);
/** Detrás de cada caso hace falta un aserto: sin él, un `return` no es salto. */
const DETRAS = 'ctx.expect("lo de después", true);';

/** El guion real `id`, leído y con `cambio` aplicado en memoria. El ancla
 *  tiene que aparecer exactamente una vez: si el guion cambia de forma, el
 *  negativo lo dice en vez de medir otra cosa. */
function saboteado(id: string, ancla: string, por: string): Salto[] {
  const g = guiones.find((f) => f.startsWith(`guiones/${id}-`));
  assert.ok(g, `el guion ${id} ya no existe: ancla el negativo a otro`);
  const ruta = join(QA, g);
  const original = readFileSync(ruta, "utf8");
  assert.equal(original.split(ancla).length, 2, `el ancla del ${id} tiene que aparecer exactamente una vez:\n${ancla}`);
  assert.deepEqual(rojos(saltosDelGuion(ruta, leerDisco)), [], `el ${id} real no tiene saltos sin observar`);
  const cambiado = original.replace(ancla, por);
  const leer: Lector = (r) => (r === ruta ? cambiado : leerDisco(r));
  return rojos(saltosDelGuion(ruta, leer));
}

describe("un salto de un guion que nadie observa se pone rojo (#356)", () => {
  it("el sujeto existe: ve todos los guiones, cada uno con su cuerpo principal, y cientos de saltos", () => {
    // Sin esto, un detector ciego (un barrido vacío, un `export default` que
    // no reconoce) saldría verde con «0 sin observar».
    assert.ok(guiones.length >= 150, `el barrido ve ${guiones.length} guiones: ¿se ha roto fuentesDelBanco?`);
    for (const g of guiones) assert.doesNotThrow(() => cuerpoPrincipal(arbolDelBanco(readFileSync(join(QA, g), "utf8")), g), g);
    assert.ok(saltos.length >= 150, `el detector ve ${saltos.length} saltos en ${guiones.length} guiones (el 2026-09-23 eran 216)`);
    assert.ok(saltos.some((s) => s.forma === "return") && saltos.some((s) => s.forma === "rama-muda"), "ve las dos formas");
  });

  it("TOTALIDAD: todo salto sin observar está en el padrón, y cada entrada casa con exactamente uno", () => {
    const declaradas = new Set(padron.saltos.map(clave));
    const fuera = sinObservar.filter((s) => !declaradas.has(clave(s)));
    assert.deepEqual(
      fuera.map((s) => `${s.fichero}:${s.linea} [${s.forma}] ${s.condicion} — ${s.porque}`),
      [],
      "salto sin observar: AFIRMA la precondición (`ctx.expect(\"…\", Boolean(x))` delante) si romperse es un bug del juego, " +
        "o DECLÁRALO (`ctx.sinMedirBloque(motivo)` en la rama) si es el entorno — regla 6 de qa/README.md",
    );
    for (const e of padron.saltos) {
      const casan = saltos.filter((s) => clave(s) === clave(e));
      assert.ok(existsSync(join(repoRoot, e.fichero)), `${e.fichero} no existe: retira la entrada`);
      assert.notEqual(casan.length, 0, `${clave(e)}: ya no existe ese salto; retira la entrada y baja TECHO`);
      assert.equal(casan.length, 1, `${clave(e)}: casa con ${casan.length} saltos; la condición no identifica uno solo`);
      assert.equal(casan[0].observado, false, `${clave(e)}: ya está observado (${casan[0].porque}); retira la entrada y baja TECHO`);
    }
  });

  it("TRINQUETE: el padrón tiene exactamente TECHO entradas, con motivos distintos", () => {
    assert.ok(padron.saltos.length <= TECHO, `el padrón solo encoge: tiene ${padron.saltos.length} entradas y TECHO es ${TECHO}`);
    assert.equal(padron.saltos.length, TECHO, `el padrón ha encogido: baja TECHO a ${padron.saltos.length}`);
    const motivos = padron.saltos.map((e) => e.motivo);
    assert.equal(new Set(motivos).size, motivos.length, "dos entradas con el mismo motivo: cada salto dice el suyo");
    assert.equal(new Set(padron.saltos.map(clave)).size, padron.saltos.length, "entrada repetida");
  });

  it("el padrón rechaza el motivo-etiqueta y el fichero fuera de qa/guiones", () => {
    const base = { _comment: "c", _lo_que_esto_NO_sujeta: "n" };
    const e = { fichero: "qa/guiones/x.mjs", condicion: "!x", motivo: "m".repeat(40) };
    assert.equal(PadronSchema.safeParse({ ...base, saltos: [e] }).success, true);
    assert.equal(PadronSchema.safeParse({ ...base, saltos: [{ ...e, motivo: "legítimo" }] }).success, false);
    assert.equal(PadronSchema.safeParse({ ...base, saltos: [{ ...e, fichero: "qa/lib/x.mjs" }] }).success, false);
    assert.equal(PadronSchema.safeParse({ _comment: "c", saltos: [] }).success, false, "sin `_lo_que_esto_NO_sujeta` no hay padrón");
  });

  // ── Negativos PERMANENTES sobre guiones reales ─────────────────────────────

  it("NEGATIVO sobre el 50 REAL: quitar el expect de la tarjeta deja el `return` sin observar", () => {
    const r = saboteado(
      "50",
      '  ctx.expect("el título ofrece REANUDAR la partida saboteada", Boolean(tarjeta), partida.sessionId);\n',
      "",
    );
    assert.deepEqual(r.map((s) => s.condicion), ["!tarjeta"]);
  });

  it("NEGATIVO sobre el 28 REAL: la forma LITERAL del issue (ctx.log + return) sale roja", () => {
    const r = saboteado("28", "    ctx.sinMedirBloque(", "    ctx.log(");
    assert.deepEqual(r.map((s) => `${s.forma} ${s.condicion}`), ["return opciones.length<2"]);
  });

  it("NEGATIVO sobre el 105 REAL: cambiar el sinMedirBloque del save B por un log deja la rama muda", () => {
    const r = saboteado("105", "  if (!saveB) {\n    ctx.sinMedirBloque(", "  if (!saveB) {\n    ctx.log(");
    assert.deepEqual(r.map((s) => `${s.forma} ${s.condicion}`), ["rama-muda !saveB"]);
  });

  it("NEGATIVO sobre qa/lib REAL: si `reanudar` deja de afirmar la tarjeta, sus usuarios se ponen rojos NOMBRÁNDOLA", () => {
    // `reanudar` (qa/lib/sesion.mjs) es el afirmante que más saltos limpia:
    // si mañana pierde su `expect`, cada `if (!v) return` que cuelga de él
    // tiene que ponerse rojo diciendo QUÉ helper arreglar.
    const lib = join(QA, "lib", "sesion.mjs");
    const original = readFileSync(lib, "utf8");
    const ancla = '  ctx.expect("el título ofrece REANUDAR la partida", Boolean(tarjeta), sessionId);\n';
    assert.equal(original.split(ancla).length, 2, "el ancla de `reanudar` tiene que aparecer exactamente una vez");
    const cambiado = original.replace(ancla, "");
    const leer: Lector = (r) => (r === lib ? cambiado : leerDisco(r));
    const yaRojos = new Set(sinObservar.map(clave));
    const r = guiones
      .flatMap((g) => rojos(saltosDelGuion(join(QA, g), leer)).map((x) => ({ ...x, fichero: relativa(g) })))
      .filter((x) => !yaRojos.has(clave(x)));
    assert.ok(r.length >= 5, `solo ${r.length} saltos dependen de reanudar (el 2026-09-23 eran 8): ¿ha dejado de resolver el import?`);
    const ajenos = r.filter((x) => !x.porque.includes("`reanudar (lib/sesion.mjs)` no es afirmante"));
    assert.deepEqual(ajenos.map((x) => `${x.fichero}:${x.linea} ${x.porque}`), [], "todo rojo nuevo nombra a `reanudar`");
  });

  // ── Cada regla, en sintético ───────────────────────────────────────────────

  it("la rama que declara, afirma o lanza observa el return", () => {
    for (const rama of ['ctx.sinMedirBloque("sin x no hay bloque que medir aquí");', 'ctx.sinMedir("sin x");', 'ctx.expect("x", false);', 'throw new Error("sin x");']) {
      const s = analiza(`const x = await algo();\nif (!x) { ${rama} return; }\n${DETRAS}`);
      assert.equal(s.length, 1, rama);
      assert.equal(s[0].observado, true, rama);
    }
    const mudo = analiza(`const x = await algo();\nif (!x) { ctx.log("no se pudo"); return; }\n${DETRAS}`);
    assert.deepEqual(mudo.map((s) => [s.forma, s.observado]), [["return", false]], "la forma del issue");
  });

  it("condición literal: el 2.º argumento de un expect que domina, sin `!`, paréntesis ni Boolean", () => {
    // `globalThis` no es un átomo (no se declara en el fichero): solo la
    // regla literal puede observarlo.
    const s = analiza(`ctx.expect("hay cosa", globalThis.cosa > 0);\nif (!(globalThis.cosa > 0)) return;\n${DETRAS}`);
    assert.equal(s[0].observado, true, s[0].porque);
    assert.match(s[0].porque, /literalmente/);
    const sinExpect = analiza(`if (!(globalThis.cosa > 0)) return;\n${DETRAS}`);
    assert.equal(sinExpect[0].observado, false);
  });

  it("átomos: el identificador afirmado antes observa la condición", () => {
    const s = analiza(`const x = await algo();\nctx.expect("hay x", Boolean(x));\nif (!x) return;\n${DETRAS}`);
    assert.equal(s[0].observado, true, s[0].porque);
    const dos = analiza(`const a = f1(); const b = f2();\nctx.expect("a", Boolean(a));\nif (!a || !b) return;\n${DETRAS}`);
    assert.equal(dos[0].observado, false, "TODOS los átomos: `b` no se afirmó");
  });

  it("el `.catch` que afirma en falso observa lo que inicializa", () => {
    const s = analiza(`const r = await p().catch((e) => { ctx.expect("p", false, e.message); return null; });\nif (!r) return;\n${DETRAS}`);
    assert.equal(s[0].observado, true, s[0].porque);
  });

  it("un afirmante del guion, y uno de qa/lib por import con nombre, observan su resultado", () => {
    const f = 'async function traer(ctx) { const v = await g(); ctx.expect("v", Boolean(v)); if (!v) return null; return { v }; }';
    const local = analiza(`const r = await traer(ctx);\nif (!r) return;\n${DETRAS}`, { antes: f });
    assert.equal(local[0].observado, true, local[0].porque);
    const importado = analiza(`const r = await traer(ctx);\nif (!r) return;\n${DETRAS}`, {
      antes: 'import { traer } from "../lib/y.mjs";',
      lib: { "y.mjs": `export ${f}` },
    });
    assert.equal(importado[0].observado, true, importado[0].porque);
    const renombrado = analiza(`const r = await t(ctx);\nif (!r) return;\n${DETRAS}`, {
      antes: 'import { traer as t } from "../lib/y.mjs";',
      lib: { "y.mjs": `export ${f}` },
    });
    assert.equal(renombrado[0].observado, true, renombrado[0].porque);
  });

  it("NO afirmante: un return que no es construido ni vacío observado, y el veredicto NOMBRA el helper", () => {
    const f = "async function rect(ctx) { return ctx.page.evaluate(() => null); }";
    const s = analiza(`const r = await rect(ctx);\nif (!r) return;\n${DETRAS}`, { antes: f });
    assert.equal(s[0].observado, false);
    assert.match(s[0].porque, /^`r`: `rect .*no es afirmante/, "el veredicto del salto nombra al helper, no solo a la variable");
    const llamada = analiza(`if (!(await rect(ctx))) return;\n${DETRAS}`, { antes: f });
    assert.equal(llamada[0].observado, false);
    assert.match(llamada[0].porque, /rect .*no es afirmante: `return ctx\.page\.evaluate/);
    const vacioMudo = analiza(`const r = await h();\nif (!r) return;\n${DETRAS}`, {
      antes: "async function h() { const v = await g(); if (!v) return null; return { v }; }",
    });
    assert.equal(vacioMudo[0].observado, false, "un `return null` sin observar tampoco es afirmante");
    const ciclo = analiza(`const r = await h();\nif (!r) return;\n${DETRAS}`, {
      antes: "async function h() { const v = await h(); if (!v) return null; return { v }; }",
    });
    assert.equal(ciclo[0].observado, false, "un ciclo no es afirmante (y no cuelga el detector)");
  });

  it("lo que no se resuelve NO es afirmante: import de un fichero que no está, `import *`, un `.js`", () => {
    for (const antes of [
      'import { traer } from "../lib/no-esta.mjs";',
      'import * as lib from "../lib/y.mjs"; const traer = lib.traer;',
      'import { traer } from "../../nefan-core/dist/x.js";',
    ]) {
      const s = analiza(`const r = await traer(ctx);\nif (!r) return;\n${DETRAS}`, { antes, lib: { "y.mjs": "export function traer() { return {}; }" } });
      assert.equal(s[0].observado, false, antes);
    }
    const noEsta = analiza(`const r = await traer(ctx);\nif (!r) return;\n${DETRAS}`, { antes: 'import { traer } from "../lib/no-esta.mjs";' });
    assert.equal(noEsta[0].observado, false);
  });

  it("un expect dentro de un if previo NO domina", () => {
    const s = analiza(`const x = await algo();\nif (c) { ctx.expect("x", Boolean(x)); }\nif (!x) return;\n${DETRAS}`);
    const salto = s.find((r) => r.condicion === "!x");
    assert.equal(salto?.observado, false, salto?.porque);
  });

  it("la FRASE del expect no observa nada aunque nombre el identificador", () => {
    // El falso positivo del crítico: `dos` en la frase del guion 65.
    const s = analiza(`const dos = f2();\nctx.expect("hay dos personajes, dos", true);\nif (!dos) return;\n${DETRAS}`);
    assert.equal(s[0].observado, false);
  });

  it("un return que no se salta ningún aserto no es salto", () => {
    assert.deepEqual(analiza(`${DETRAS}\nconst x = await algo();\nif (!x) { ctx.log("fin"); return; }\nctx.log("nada más");`), []);
  });

  it("rama muda: un if sin else que afirma, un else que solo registra, y el if que REPORTA un fallo no lo es", () => {
    const sinElse = analiza('const x = await algo();\nif (x) { ctx.expect("x vale", x.ok); }');
    assert.deepEqual(sinElse.map((s) => [s.forma, s.observado]), [["rama-muda", false]]);
    const elseLog = analiza('const x = await algo();\nif (x) { ctx.expect("x vale", x.ok); } else { ctx.log("sin x"); }');
    assert.deepEqual(elseLog.map((s) => [s.forma, s.observado]), [["rama-muda", false]]);
    const elseDeclara = analiza('const x = await algo();\nif (x) { ctx.expect("x vale", x.ok); } else { ctx.sinMedirBloque("sin x no hay nada"); }');
    assert.deepEqual(elseDeclara, []);
    const reporta = analiza('const err = await algo();\nif (err) { ctx.expect("sin error", false, err.message); }');
    assert.deepEqual(reporta, []);
    const afirmada = analiza('const x = await algo();\nctx.expect("hay x", Boolean(x));\nif (x) { ctx.expect("x vale", x.ok); }');
    assert.equal(afirmada[0].observado, true);
  });

  it("el guion sin `export default`, o que no se puede leer, es un ERROR y no «0 saltos»", () => {
    const leer: Lector = (r) => {
      if (r === "/v/a.mjs") return "export function no() {}";
      throw new Error(`ENOENT: ${r}`);
    };
    assert.throws(() => saltosDelGuion("/v/a.mjs", leer), /export default/);
    assert.throws(() => saltosDelGuion("/v/b.mjs", leer), /ENOENT/);
  });

  // ── LÍMITES MEDIDOS: cada punto de `_lo_que_esto_NO_sujeta` ────────────────

  it("LÍMITE MEDIDO (1): un helper con ctx que se salta sus asertos no se ve; en el banco real hay 3", () => {
    const helper = 'async function bloque(ctx) { const x = await algo(); if (!x) return; ctx.expect("x", x.ok); }';
    assert.deepEqual(analiza("await bloque(ctx);\nctx.expect(\"otra\", true);", { antes: helper }), [], "el detector mira los helpers: retira el punto (1)");
    const enHelpers = guiones.flatMap((g) =>
      saltosDelGuion(join(QA, g), leerDisco, { helpers: true })
        .filter((s) => s.funcion !== "default" && !s.observado)
        .map((s) => `${g.slice(8, 10)} ${s.funcion}`),
    );
    assert.deepEqual(enHelpers, ["15 atacarYVer", "41 pelearContra", "94 afirmarAtomo"], "los saltos sin observar en helpers han cambiado: reescribe la cifra del punto (1)");
  });

  it("LÍMITE MEDIDO (2): un bucle que no se entra no es un salto", () => {
    assert.deepEqual(analiza('for (const x of []) ctx.expect("x", x.ok);\nwhile (false) { ctx.expect("y", true); }'), [], "retira el punto (2)");
  });

  it("LÍMITE MEDIDO (3): el cortocircuito, el ternario y `?.forEach` no son `if`", () => {
    assert.deepEqual(
      analiza('const x = await algo();\nx && ctx.expect("x", x.ok);\nx ? ctx.expect("y", true) : ctx.log("no");\nx?.lista?.forEach((e) => ctx.expect("e", e.ok));'),
      [],
      "retira el punto (3)",
    );
  });

  it("LÍMITE MEDIDO (4): `continue` y `break` no son salto", () => {
    assert.deepEqual(analiza('for (const x of xs) {\n  if (!x) continue;\n  if (x.fin) break;\n  ctx.expect("x", x.ok);\n}'), [], "retira el punto (4)");
  });

  it("LÍMITE MEDIDO (5): el catch que solo registra no es un `if`", () => {
    assert.deepEqual(analiza('try {\n  ctx.expect("a", await algo());\n} catch (e) {\n  ctx.log(`no se pudo: ${e.message}`);\n}'), [], "retira el punto (5)");
  });

  it("LÍMITE MEDIDO (6): la afirmación rancia pasa por observada", () => {
    const s = analiza(`let x = await algo();\nctx.expect("x", Boolean(x));\nx = await otra();\nif (!x) return;\n${DETRAS}`);
    assert.deepEqual(rojos(s), [], "el detector sigue la reasignación: retira el punto (6)");
  });

  it("LÍMITE MEDIDO (7): el átomo va por su RAÍZ, no por la propiedad", () => {
    const s = analiza(`const alta = await api();\nctx.expect("alta", alta.status === 200);\nif (!alta.body.id) return;\n${DETRAS}`);
    assert.deepEqual(rojos(s), [], "el detector distingue `alta.body.id` de `alta`: retira el punto (7)");
  });

  it("LÍMITE MEDIDO (8): la polaridad no se mira", () => {
    const s = analiza(`const x = await algo();\nctx.expect("x", Boolean(x));\nif (x) return;\n${DETRAS}`);
    assert.deepEqual(rojos(s), [], "el detector mira la polaridad: retira el punto (8)");
  });

  it("LÍMITE MEDIDO (9): basta un observador EN la rama, no en el camino del return", () => {
    const s = analiza(`const x = await algo();\nif (!x) { if (y) ctx.sinMedirBloque("sin x, en un caso"); return; }\n${DETRAS}`);
    assert.deepEqual(rojos(s), [], "el detector mira el camino: retira el punto (9)");
  });

  it("LÍMITE MEDIDO (10): el ámbito es `qa/guiones/*.mjs`; hoy no hay guiones en subdirectorios", () => {
    const todos = fuentesDelBanco(QA);
    assert.deepEqual(todos.filter((f) => f.startsWith("guiones/") && !guiones.includes(f)), [], "hay .mjs en subdirectorios de guiones/: amplía el ámbito o reescribe el punto (10)");
    assert.ok(todos.some((f) => f.startsWith("lib/")) && !guiones.some((f) => f.startsWith("lib/")), "qa/lib no se analiza como guion");
  });
});
