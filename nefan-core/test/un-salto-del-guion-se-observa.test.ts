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

  it("NEGATIVO sobre el 105 REAL: quitar el expect del save B deja la rama muda", () => {
    const r = saboteado("105", '  ctx.expect("el save de B está en el disco efímero de la corrida", Boolean(saveB), partidaB.sessionId);\n', "");
    assert.deepEqual(r.map((s) => `${s.forma} ${s.condicion}`), ["rama-muda saveB"]);
  });

  it("NEGATIVO sobre el 68 REAL: lo que se salta es un HELPER que afirma (QA de la tanda, I1)", () => {
    // El 68 se salta un bloque cuyos asertos viven en helpers, no en
    // `ctx.expect` directos: antes de I1 eso eran 0 saltos. Hoy está
    // observado porque `vuelta` sale de `reanudar`, que afirma; si el
    // inicializador pasa a ser un `page.evaluate` mudo, sale rojo.
    const r = saboteado("68", "const vuelta = await reanudar(", "const vuelta = await ctx.page.evaluate(() => 0) || (");
    assert.deepEqual(r.map((s) => `${s.forma} ${s.condicion}`), ["return !vuelta"]);
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

  // ── Reglas añadidas tras la QA de la tanda ────────────────────────────────

  it("I1: un salto seguido SOLO de asertos en helpers (de qa/lib o del guion) es salto", () => {
    const lib = { "afirma.mjs": 'export async function afirmarPose(ctx, x) { ctx.expect("pose", x > 0); return true; }' };
    const antes = 'import { afirmarPose } from "../lib/afirma.mjs";\nasync function mide(ctx, p) { ctx.expect("m", p.a === 1); }';
    const pre = 'ctx.expect("a", true);\nconst pre = await ctx.page.evaluate(() => 1);\n';
    const casos: [string, string][] = [
      [`${pre}if (!pre) { ctx.log("no"); return; }\nawait afirmarPose(ctx, pre);`, "return !pre"],
      [`${pre}if (pre) { await afirmarPose(ctx, pre); }`, "rama-muda pre"],
      [`${pre}if (pre) { await mide(ctx, pre); }`, "rama-muda pre"],
      // Un helper que no se puede resolver y recibe el ctx también cuenta: la
      // dirección que da más saltos.
      [`${pre}if (!pre) { ctx.log("no"); return; }\nawait lib.afirmar(ctx, pre);`, "return !pre"],
    ];
    for (const [cuerpo, esperado] of casos) {
      assert.deepEqual(rojos(analiza(cuerpo, { antes, lib })).map((x) => `${x.forma} ${x.condicion}`), [esperado], cuerpo);
    }
    // Un helper de qa/lib con el ctx RENOMBRADO sigue siendo asertador (#716, N3).
    const renombrado = { "c.mjs": 'export async function afirma(c, x) { c.expect("pose", x > 0); }' };
    const conC = analiza(`${pre}if (!pre) { ctx.log("no"); return; }\nawait afirma(ctx, pre);`, { antes: 'import { afirma } from "../lib/c.mjs";', lib: renombrado });
    assert.deepEqual(rojos(conC).map((x) => `${x.forma} ${x.condicion}`), ["return !pre"], "el ctx renombrado en qa/lib");
    // Y el helper que afirma, EN la rama, la observa.
    assert.deepEqual(rojos(analiza(`${pre}if (!pre) { await afirmarPose(ctx, 0); return; }\n${DETRAS}`, { antes, lib })), []);
    // Un helper resuelto que NO afirma (`comenzar`) no convierte en salto un return.
    assert.deepEqual(analiza(`${pre}if (!pre) return;\nawait nada(ctx);`, { antes: "async function nada(ctx) { ctx.log(1); }" }), []);
  });

  it("I2: los alias de ctx (`const c = ctx`, `const {expect} = ctx`, `ctx.expect.bind`, `ctx[\"expect\"]`) se siguen", () => {
    const casos = [
      'const c = ctx;\nconst pre = await c.page.evaluate(() => 1);\nif (!pre) { c.log("no"); return; }\nc.expect("d", true);',
      'const { expect, log } = ctx;\nconst pre = await algo();\nif (!pre) { log("no"); return; }\nexpect("d", true);',
      'const { expect: e } = ctx;\nconst pre = await algo();\nif (!pre) return;\ne("d", true);',
      'const e = ctx.expect.bind(ctx);\nconst pre = await algo();\nif (!pre) return;\ne("d", true);',
      'const pre = await algo();\nif (!pre) return;\nctx["expect"]("d", true);',
    ];
    for (const c of casos) assert.deepEqual(rojos(analiza(c)).map((x) => x.condicion), ["!pre"], c);
    // …y también para OBSERVAR: `expect` suelto afirmando la precondición.
    assert.deepEqual(rojos(analiza('const { expect } = ctx;\nconst pre = await algo();\nexpect("pre", Boolean(pre));\nif (!pre) return;\nexpect("d", true);')), []);
  });

  it("I2: el `return` en un `case`, en un `catch` y el incondicional son saltos", () => {
    const sw = analiza(`const pre = await algo();\nswitch (pre) { case 0: ctx.log("no"); return; default: }\n${DETRAS}`);
    assert.deepEqual(rojos(sw).map((x) => x.condicion), ["case:pre=0"]);
    const ca = analiza(`try { await algo(); } catch (e) { ctx.log("no"); return; }\n${DETRAS}`);
    assert.deepEqual(rojos(ca).map((x) => x.condicion), ["catch"]);
    const inc = analiza(`ctx.expect("a", true);\nreturn;\n${DETRAS}`);
    assert.deepEqual(rojos(inc).map((x) => x.condicion), ["incondicional"]);
    // Observados: el case y el catch que declaran.
    assert.deepEqual(rojos(analiza(`try { await algo(); } catch (e) { ctx.sinMedirBloque("sin algo no hay bloque"); return; }\n${DETRAS}`)), []);
    assert.deepEqual(rojos(analiza(`switch (await algo()) { case 0: ctx.expect("no 0", false); return; }\n${DETRAS}`)), []);
    // Un return en un catch DENTRO de un if cuenta una vez, en el catch.
    const anidado = analiza(`if (c) { try { await algo(); } catch { return; } }\n${DETRAS}`);
    assert.deepEqual(anidado.map((x) => x.condicion), ["catch"]);
  });

  it("I2: un expect TAUTOLÓGICO no observa: ni en la rama, ni como precondición afirmada", () => {
    const pre = "const pre = await algo();\n";
    for (const c of [
      `${pre}if (!pre) { ctx.expect("no se pudo medir, pero ok", true); return; }\n${DETRAS}`,
      `${pre}ctx.expect("pre", Boolean(pre) || true);\nif (!pre) return;\n${DETRAS}`,
      `${pre}ctx.expect("pre", pre === pre);\nif (!pre) return;\n${DETRAS}`,
      `${pre}ctx.expect("pre", !false);\nif (!pre) return;\n${DETRAS}`,
      `${pre}if (pre) { ctx.expect("medido", pre.a === 1); } else { ctx.expect("no se pudo medir", true); }`,
    ])
      assert.equal(rojos(analiza(c)).length, 1, c);
    assert.equal(rojos(analiza(`${pre}ctx.expect("pre", Boolean(pre) && true);\nif (!pre) return;\n${DETRAS}`)).length, 0, "`x && true` sí depende de x");
  });

  it("I2: `return 0` y `return \"\"` son VACÍOS, no construidos: no hacen afirmante a un helper", () => {
    for (const vacio of ["0", '""', "0.0"]) {
      const f = `async function contar(ctx) { const v = await algo(); if (v) return 3; return ${vacio}; }`;
      const s = analiza(`const n = await contar(ctx);\nif (!n) { ctx.log("no"); return; }\n${DETRAS}`, { antes: f });
      assert.equal(rojos(s).length, 1, vacio);
    }
  });

  it("llamar a un asertador en el INICIALIZADOR no observa el valor que devuelve", () => {
    const f = 'async function chequea(ctx) { const v = await algo(); if (!v) { ctx.expect("z", true); return null; } return { v }; }';
    const s = analiza(`const ok = await chequea(ctx);\nif (!ok) { ctx.log("no"); return; }\n${DETRAS}`, { antes: f });
    assert.equal(rojos(s).length, 1, s[0]?.porque);
  });

  // ── Las formas que escapaban (#716, QA de AG vuelta 2) ─────────────────────

  it("N1a: un helper que solo afirma una TAUTOLOGÍA no observa la rama que lo llama", () => {
    const av = 'async function av(ctx) { ctx.expect("z", true); }';
    const s = analiza(`const x = await algo();\nif (!x) { await av(ctx); return; }\n${DETRAS}`, { antes: av });
    assert.deepEqual(rojos(s).map((r) => r.condicion), ["!x"], "el guion");
    const lib = { "av.mjs": `export ${av}` };
    const importado = analiza(`const x = await algo();\nif (!x) { await av(ctx); return; }\n${DETRAS}`, { antes: 'import { av } from "../lib/av.mjs";', lib });
    assert.deepEqual(rojos(importado).map((r) => r.condicion), ["!x"], "qa/lib");
    // …y sigue contando como ASERTO para detectar: el lado laxo no pierde saltos.
    const detras = analiza('const x = await algo();\nif (!x) { ctx.log("no"); return; }\nawait av(ctx);', { antes: av });
    assert.deepEqual(rojos(detras).map((r) => r.condicion), ["!x"]);
  });

  it("N1b: un helper que afirma solo EN UNA RAMA, o tras un return, no observa; el if/else que afirma en las dos sí", () => {
    const rama = (helper: string): Salto[] => analiza(`const x = await algo();\nif (!x) { await av(ctx, x); return; }\n${DETRAS}`, { antes: helper });
    for (const h of [
      'async function av(ctx, y) { if (y) ctx.expect("z", y.ok); }',
      'async function av(ctx, y) { if (!y) return; ctx.expect("z", y.ok); }',
      'async function av(ctx, y) { y && ctx.expect("z", y.ok); }',
      'async function av(ctx, y) { for (const e of y) ctx.expect("z", e.ok); }',
      'async function av(ctx, y) { try { await algo(); ctx.expect("z", y.ok); } catch { ctx.log("no"); } }',
    ])
      assert.equal(rojos(rama(h)).length, 1, h);
    for (const h of [
      'async function av(ctx, y) { if (y) ctx.expect("a", y.ok); else ctx.expect("b", false); }',
      'async function av(ctx, y) { ctx.log("antes"); ctx.expect("z", Boolean(y)); if (!y) return; }',
      'async function av(ctx, y) { try { await algo(); } finally { ctx.expect("z", Boolean(y)); } }',
      'const av = (ctx, y) => ctx.expect("z", Boolean(y));',
      'async function av(ctx, y) { await otra(ctx, y); }\nasync function otra(ctx, y) { ctx.sinMedirBloque("sin y"); }',
    ])
      assert.deepEqual(rojos(rama(h)), [], h);
    // Falso rojo DECLARADO (QA de AH, H4; dirección segura): la guarda honesta
    // que el padrón recomienda, dentro de un helper, no «afirma siempre»
    // porque la regla del `if` pide que afirmen las dos ramas.
    const guarda = 'async function av(ctx, y) { if (!y) { ctx.sinMedirBloque("sin y"); return; } ctx.expect("z", y.ok); }';
    assert.equal(rojos(rama(guarda)).length, 1, "el detector ve que la rama que retorna ya declaró: quita el falso rojo de la cabecera y del OBSERVADOR del padrón");
  });

  it("N2: `!!true` y el `expectEspera` cuya sonda devuelve lo esperado por su forma no observan", () => {
    const pre = "const x = await algo();\n";
    for (const rama of [
      'ctx.expect("z", !!true);',
      'await ctx.expectEspera("z", true, () => true);',
      'await ctx.expectEspera("z", false, () => false);',
      'await ctx.expectEspera("z", true, async () => { return true; });',
      'await ctx.expectEspera("z", false, function () { return !1; }, { timeout: 5 });',
      // QA de AH, H2: el espejo de `!!true`.
      'ctx.expect("z", !(x && false));',
      'ctx.expect("z", !(x !== x));',
      'await ctx.expectEspera("z", false, () => x !== x || false);',
      // QA de AH, H3: la sonda con más de una sentencia.
      'await ctx.expectEspera("z", true, () => { ctx.log("p"); return true; });',
      'await ctx.expectEspera("z", true, () => { if (x) return 1; return true; });',
    ])
      assert.equal(rojos(analiza(`${pre}if (!x) { ${rama} return; }\n${DETRAS}`)).length, 1, rama);
    // Observan: la sonda que mira algo, la que falla siempre (rojo seguro) y `!!x`.
    for (const rama of [
      'await ctx.expectEspera("z", true, () => x.ok);',
      'await ctx.expectEspera("z", true, () => false);',
      'await ctx.expectEspera("z", false, () => true);',
      'await ctx.expectEspera("z", NO, () => true);',
      'await ctx.expectEspera("z", true, () => { if (x) return true; return x.ok; });',
      'await ctx.expectEspera("z", true, () => { if (x) return true; });',
      'ctx.expect("z", !(x && y));',
      'ctx.expect("z", !!x);',
    ])
      assert.deepEqual(rojos(analiza(`${pre}if (!x) { ${rama} return; }\n${DETRAS}`)), [], rama);
    // Y `!!true` tampoco afirma la precondición.
    for (const t of ["!!true", "!(x && false)"]) assert.equal(rojos(analiza(`${pre}ctx.expect("pre", ${t});\nif (!x) return;\n${DETRAS}`)).length, 1, t);
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

  it("LÍMITE MEDIDO (1): un salto DENTRO de una función anidada no se ve; en el banco real hay 4", () => {
    // Con parámetro `ctx`, como cierre que lo captura y como callback anónimo:
    // las tres formas dan 0 saltos en el candado…
    const conParametro = 'async function bloque(ctx) { const x = await algo(); if (!x) return; ctx.expect("x", x.ok); }';
    assert.deepEqual(analiza("await bloque(ctx);\nctx.expect(\"otra\", true);", { antes: conParametro }), [], "el detector mira los helpers: retira el punto (1)");
    const cierre = 'const medir = async () => { const x = await algo(); if (!x) { ctx.log("no"); return; } ctx.expect("x", x.ok); };\nawait medir();\nctx.expect("otra", true);';
    assert.deepEqual(analiza(cierre), [], "el detector mira los cierres: retira el punto (1)");
    const anonima = 'await algo().then((x) => { if (!x) { ctx.log("no"); return; } ctx.expect("x", x.ok); });\nctx.expect("otra", true);';
    assert.deepEqual(analiza(anonima), [], "el detector mira los callbacks: retira el punto (1)");
    // …y las tres las cuenta la MEDIDA (QA de la tanda, M1: antes el cierre no contaba).
    // El IIFE que recibe el ctx con OTRO nombre (#716, N3): tampoco lo ve el candado…
    const iife = 'await (async (c) => { const x = await algo(); if (!x) { c.log("no"); return; } c.expect("x", x.ok); })(ctx);\nctx.expect("otra", true);';
    assert.deepEqual(analiza(iife), [], "el detector mira los IIFE: retira el punto (1)");
    // …ni con el ctx desestructurado en la firma (QA de AH, H1)…
    const iifePatron = 'await (async ({ expect, log }) => { const x = await algo(); if (!x) { log("no"); return; } expect("x", x.ok); })(ctx);\nctx.expect("otra", true);';
    assert.deepEqual(analiza(iifePatron), [], "el detector mira los IIFE: retira el punto (1)");
    // …ni el que no nombra ningún verbo: solo lo delata la llamada que le pasa el ctx.
    const iifeMudo = 'await (async (c) => { const x = await algo(); if (!x) { c.log("no"); return; } await lib.medir(c, x); })(ctx);\nctx.expect("otra", true);';
    assert.deepEqual(analiza(iifeMudo), [], "el detector mira los IIFE: retira el punto (1)");
    // …y todas las cuenta la MEDIDA (QA de la tanda, M1: antes el cierre no contaba; #716: ni el IIFE).
    for (const c of [cierre, anonima, iife, iifePatron, iifeMudo]) assert.equal(rojos(analiza(c, { helpers: true })).length, 1, c);
    assert.equal(rojos(analiza("await bloque(ctx);\nctx.expect(\"otra\", true);", { antes: conParametro, helpers: true })).length, 1);
    const enHelpers = guiones.flatMap((g) =>
      saltosDelGuion(join(QA, g), leerDisco, { helpers: true })
        .filter((s) => s.funcion !== "default" && !s.observado)
        .map((s) => `${g.slice(8, g.indexOf("-"))} ${s.funcion} ${s.condicion}`),
    );
    assert.deepEqual(
      enHelpers,
      ["15 atacarYVer !antes", "41 pelearContra cunaEsPrecondicion", "41 pelearContra acercarseAndando", "94 afirmarAtomo visto===null"],
      "ha cambiado la lista de saltos sin observar DENTRO de funciones anidadas. Si hay uno nuevo, lo primero es " +
        "ARREGLARLO como en el cuerpo principal (afirma la precondición o `ctx.sinMedirBloque`); solo si es honesto " +
        "sin observar, se añade aquí y se cuenta en el punto (1) del padrón. Si ha desaparecido uno, quítalo de los dos",
    );
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

  it("LÍMITE MEDIDO (4): `continue`, `break` y `break <etiqueta>` no son salto", () => {
    assert.deepEqual(analiza('for (const x of xs) {\n  if (!x) continue;\n  if (x.fin) break;\n  ctx.expect("x", x.ok);\n}'), [], "retira el punto (4)");
    assert.deepEqual(analiza('const pre = await algo();\nbloque: { if (!pre) { ctx.log("no"); break bloque; } ctx.expect("dentro", true); }'), [], "retira el `break` etiquetado del punto (4)");
  });

  it("LÍMITE MEDIDO (5): el catch que solo registra, SIN return, no es salto", () => {
    // Con `return` sí lo es (regla de la guarda `catch`); sin él, el guion
    // sigue y los asertos de detrás corren.
    assert.deepEqual(analiza('try {\n  ctx.expect("a", await algo());\n} catch (e) {\n  ctx.log(`no se pudo: ${e.message}`);\n}'), [], "retira el punto (5)");
  });

  it("LÍMITE MEDIDO (6): la afirmación rancia pasa por observada", () => {
    const s = analiza(`let x = await algo();\nctx.expect("x", Boolean(x));\nx = await otra();\nif (!x) return;\n${DETRAS}`);
    assert.deepEqual(rojos(s), [], "el detector sigue la reasignación: retira el punto (6)");
  });

  it("un `x` interior que SOMBREA al afirmado no está observado, ni por el texto ni por sus átomos (#720, era el punto (6))", () => {
    const literal = `const x = 1;\nctx.expect("x", Boolean(x));\n{ const x = await algo();\n if (!x) { ctx.log("no"); return; } }\n${DETRAS}`;
    const atomo = `const x = 1;\nctx.expect("x", x > 0);\n{ const x = await algo();\n if (!x) { ctx.log("no"); return; } }\n${DETRAS}`;
    assert.deepEqual([literal, atomo].map((c) => rojos(analiza(c)).map((x) => x.condicion)), [["!x"], ["!x"]]);
    // Y el mismo `x`, sin sombra, sigue observado por las dos reglas.
    const mismo = (c: string): string => c.replace("{ const x = await algo();\n", "{\n");
    assert.deepEqual([literal, atomo].map((c) => rojos(analiza(mismo(c)))), [[], []]);
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
    const tragado = analiza(`const x = await algo();\nif (!x) { try { throw new Error("x"); } catch {} return; }\n${DETRAS}`);
    assert.deepEqual(rojos(tragado), [], "el detector ve el `throw` que se traga su propio `catch`: retira esa frase del punto (9)");
  });

  it("LÍMITE MEDIDO (10): el ámbito es `qa/guiones/*.mjs`; hoy no hay guiones en subdirectorios", () => {
    const todos = fuentesDelBanco(QA);
    assert.deepEqual(todos.filter((f) => f.startsWith("guiones/") && !guiones.includes(f)), [], "hay .mjs en subdirectorios de guiones/: amplía el ámbito o reescribe el punto (10)");
    assert.ok(todos.some((f) => f.startsWith("lib/")) && !guiones.some((f) => f.startsWith("lib/")), "qa/lib no se analiza como guion");
  });

  it("LÍMITE MEDIDO (11): la tautología por VALOR (una constante con nombre, `typeof`) no se ve", () => {
    const pre = "const pre = await algo();\n";
    const casos = [
      `${pre}const NO = false;\nif (!pre) { ctx.expect("x", NO === false); return; }\n${DETRAS}`,
      `${pre}ctx.expect("pre", typeof pre === "object" || pre == null);\nif (!pre) return;\n${DETRAS}`,
      // QA de AH, H6: el ternario con dos ramas verdaderas y la plantilla con texto.
      `${pre}if (!pre) { ctx.expect("x", pre ? true : true); return; }\n${DETRAS}`,
      `${pre}if (!pre) { ctx.expect("x", \`ok\${pre}\`); return; }\n${DETRAS}`,
    ];
    for (const c of casos) assert.deepEqual(rojos(analiza(c)), [], `el detector evalúa valores: retira el punto (11)\n${c}`);
  });

  /** #720 · El ctx se identificaba por NOMBRE y por fichero, así que un objeto
   *  AJENO con `.expect`, o un `c` que sombrea al `c` de un helper, pasaba por
   *  ctx y EXCUSABA el salto (era la segunda mitad del punto (12), QA de AH, H5).
   *  Ahora es por SÍMBOLO: el checker de TypeScript dice a qué declaración
   *  apunta cada identificador. */
  it("un objeto AJENO con `.expect` no es un ctx y no excusa un salto (#720)", () => {
    const ajeno = 'const t = { expect() {} };\nconst e = t.expect;\nconst x = await algo();\nif (!x) { e("z", x.ok); return; }\n' + DETRAS;
    assert.deepEqual(rojos(analiza(ajeno)).map((x) => x.condicion), ["!x"]);
    const directo = 'const t = { expect() {} };\nconst x = await algo();\nif (!x) { t.expect("z", x.ok); return; }\n' + DETRAS;
    assert.deepEqual(rojos(analiza(directo)).map((x) => x.condicion), ["!x"]);
  });

  it("un `c` que SOMBREA al ctx de un helper no es el ctx, y no excusa un salto (#720)", () => {
    const sombra =
      'async function m(c) { c.expect("d", true); }\nconst c = { expect() {} };\nconst x = await algo();\nif (!x) { c.expect("z", x.ok); return; }\nawait m(ctx);';
    assert.deepEqual(rojos(analiza(sombra)).map((x) => x.condicion), ["!x"]);
    // Y el de verdad sigue excusando: el mismo guion con el `c` del helper en la rama.
    const propio = 'async function m(c) { const x = await algo(); if (!x) { c.expect("z", x.ok); return; } c.expect("d", true); }\nawait m(ctx);';
    assert.deepEqual(rojos(analiza(propio, { helpers: true })), []);
  });

  it("LÍMITE MEDIDO (13): un átomo que no es una variable del fichero (un import, un global) se descarta sin decirlo", () => {
    const global = `const x = await algo();\nctx.expect("x", Boolean(x));\nif (!x || !process.env.Q) return;\n${DETRAS}`;
    assert.deepEqual(rojos(analiza(global)), [], "el detector cuenta el global como átomo sin observar: retira el punto (13)");
    const lib = { "l.mjs": "export const listo = true;" };
    const importado = `const x = await algo();\nctx.expect("x", Boolean(x));\nif (!x || !listo) return;\n${DETRAS}\nfunction otra() { const listo = 1; return listo; }`;
    assert.deepEqual(rojos(analiza(importado, { antes: 'import { listo } from "../lib/l.mjs";', lib })), [], "el detector cuenta el import como átomo: retira el punto (13)");
  });

  it("LÍMITE MEDIDO (12): el ctx en un objeto o tras una clave calculada no se sigue", () => {
    const objeto = 'const o = { ctx };\nconst pre = await algo();\nif (!pre) return;\no.ctx.expect("d", true);';
    assert.deepEqual(analiza(objeto), [], `el detector sigue ese alias: retira esa frase del punto (12)\n${objeto}`);
    // El residuo: un parámetro de OTRO módulo que no nombra ningún verbo (clave
    // calculada), así que nada lo delata como ctx y el helper no cuenta como aserto.
    const lib = { "d.mjs": 'export async function afirma(c, x) { const v = "expect"; c[v]("pose", x > 0); }' };
    const residuo = analiza('const pre = await algo();\nif (!pre) { ctx.log("no"); return; }\nawait afirma(ctx, pre);', { antes: 'import { afirma } from "../lib/d.mjs";', lib });
    assert.deepEqual(residuo, [], "el detector sigue el ctx por clave calculada: retira el residuo del punto (12)");
    // Lo que queda del «ajeno» tras #720: un verbo delata lo que el fichero NO
    // dice qué es —un `let` sin inicializador, un parámetro—, lo reciba de un
    // ctx o de un objeto ajeno. Ahí el ajeno sigue EXCUSANDO.
    const sinValor = 'let t;\nt = { expect() {} };\nconst x = await algo();\nif (!x) { t.expect("z", x.ok); return; }\n' + DETRAS;
    assert.deepEqual(rojos(analiza(sinValor)), [], "el detector sigue el valor de un `let`: retira esa frase del punto (12)");
    const parametro = 'async function m(c, x) { if (!x) { c.expect("z", x.ok); return; } c.expect("d", true); }\nawait m({ expect() {} }, await algo());';
    assert.deepEqual(rojos(analiza(parametro, { helpers: true })), [], "el detector mira qué recibe un parámetro: retira esa frase del punto (12)");
    // Lo que #716 y su QA cerraron: por el VERBO (llamado, leído o desestructurado,
    // en la firma o en el cuerpo, en el guion o en qa/lib) y por la llamada que pasa el ctx.
    const cerrados: [string, Record<string, string>?][] = [
      ['let c;\nc = ctx;\nconst pre = await algo();\nif (!pre) return;\nc.expect("d", true);'],
      ['async function m(c) { c.expect("d", true); }\nconst pre = await algo();\nif (!pre) return;\nawait m(ctx);'],
      ['async function m(c) { const e = c.expect; e("d", true); }\nconst pre = await algo();\nif (!pre) return;\nawait m(ctx);'],
      ['async function m({ expect }) { expect("d", true); }\nconst pre = await algo();\nif (!pre) return;\nawait m(ctx);'],
      ['async function m(c) { const { expect: e } = c; e("d", true); }\nconst pre = await algo();\nif (!pre) return;\nawait m(ctx);'],
      ['async function m({ expect: e, log }) { log("m"); e("d", true); }\nconst pre = await algo();\nif (!pre) return;\nawait m(ctx);'],
      ['const pre = await algo();\nif (!pre) return;\nawait af(ctx);', { "e.mjs": 'export async function af({ expect }) { expect("d", true); }' }],
      ['const pre = await algo();\nif (!pre) return;\nawait af(ctx);', { "e.mjs": 'export async function af(c) { const { expect } = c; expect("d", true); }' }],
    ];
    for (const [c, l] of cerrados) {
      const r = analiza(c, l ? { antes: 'import { af } from "../lib/e.mjs";', lib: l } : {});
      assert.deepEqual(rojos(r).map((x) => x.condicion), ["!pre"], c);
    }
  });
});
