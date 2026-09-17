/** La escala ÚNICA de veredictos de QA (#331).
 *
 *  El sujeto es `qa/lib/veredictos.mjs`: los dos consumidores (`qa/run.mjs` y
 *  `qa/lib/presets-clasifica.mjs`) importan de ahí, así que lo que aquí se
 *  congela es la semántica compartida — sobre todo la del exit, que es la que
 *  hace que el canal `⊘` de un guion NO sea una vía de escape: un ⊘ degrada la
 *  corrida MÁS que un rojo (2 > 1), con lo que reconvertir un rojo en ⊘
 *  empeora el veredicto por construcción.
 *
 *  El import cruzado es la regla, no un precedente (#357): la dirección es
 *  test → banco (`el-banco-no-entra-en-produccion`, arch-rules.json) y todo
 *  módulo de `qa/lib` tiene un test que lo importe o una exención escrita
 *  (`test/qa-lib-tiene-quien-lo-mire.test.ts`). El banco es parte del aparato
 *  de este repositorio, no un tercero.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const mod = (await import(join(repoRoot, "qa", "lib", "veredictos.mjs"))) as {
  VERDE: string;
  ROJO: string;
  SIN_MEDIR: string;
  ICONO: Record<string, string>;
  exitDeCorrida: (rojos: number, noMedidos: number) => number;
  SIN_AFIRMAR: string;
  veredictoDeGuion: (r: { fallos: string[]; afirmaciones: number }) => { estado: string; fallos: string[] };
};
const { VERDE, ROJO, SIN_MEDIR, ICONO, exitDeCorrida, SIN_AFIRMAR, veredictoDeGuion } = mod;

describe("veredictos: la escala única", () => {
  it("los tres estados son distintos y cada uno tiene su icono", () => {
    assert.equal(new Set([VERDE, ROJO, SIN_MEDIR]).size, 3);
    assert.equal(ICONO[VERDE], "✔");
    assert.equal(ICONO[ROJO], "✘");
    assert.equal(ICONO[SIN_MEDIR], "⊘");
  });

  it("el ⊘ es EXCLUSIVO de SIN_MEDIR: no hay otro estado con ese icono", () => {
    const conBarra = Object.entries(ICONO).filter(([, i]) => i === "⊘");
    assert.deepEqual(conBarra, [[SIN_MEDIR, "⊘"]]);
  });
});

describe("veredictos: el exit de la corrida", () => {
  it("todo verde → 0", () => {
    assert.equal(exitDeCorrida(0, 0), 0);
  });

  it("hay rojos y todo midió → 1: es el sujeto", () => {
    assert.equal(exitDeCorrida(1, 0), 1);
    assert.equal(exitDeCorrida(7, 0), 1);
  });

  it("algo sin medir → 2, aunque no haya ni un rojo", () => {
    assert.equal(exitDeCorrida(0, 1), 2);
  });

  it("el 2 gana al 1: con algo sin medir, ni los rojos son de fiar", () => {
    assert.equal(exitDeCorrida(5, 1), 2);
  });
});

describe("veredictos: el verde de un guion exige haber AFIRMADO algo (#639)", () => {
  it("limpio y sin un solo aserto NO es verde: es rojo, y dice por qué", () => {
    const v = veredictoDeGuion({ fallos: [], afirmaciones: 0 });
    assert.equal(v.estado, ROJO);
    assert.deepEqual(v.fallos, [SIN_AFIRMAR]);
  });

  it("es ROJO y no SIN_MEDIR: el ⊘ se declara con su motivo, esto es un defecto del guion", () => {
    assert.notEqual(veredictoDeGuion({ fallos: [], afirmaciones: 0 }).estado, SIN_MEDIR);
  });

  it("la frase dice la salida, no solo el reproche: nombra `ctx.sinMedir`", () => {
    assert.match(SIN_AFIRMAR, /ctx\.sinMedir/);
  });

  it("limpio habiendo afirmado una vez sigue siendo verde (el caso de los 142)", () => {
    assert.deepEqual(veredictoDeGuion({ fallos: [], afirmaciones: 1 }), { estado: VERDE, fallos: [] });
  });

  it("afirmar y fallar es afirmar: con fallos NO se le cuelga encima un segundo diagnóstico falso", () => {
    // Un guion que revienta en la primera línea acumula el `ERROR: …` del
    // runner y cero asertos. Su causa es esa, no «no afirmó nada».
    const v = veredictoDeGuion({ fallos: ["ERROR: la página murió"], afirmaciones: 0 });
    assert.equal(v.estado, ROJO);
    assert.deepEqual(v.fallos, ["ERROR: la página murió"]);
  });

  it("no muta la lista de fallos que recibe: el runner la sigue usando", () => {
    const fallos: string[] = [];
    veredictoDeGuion({ fallos, afirmaciones: 0 });
    assert.deepEqual(fallos, []);
  });

  it("fail-loud: sin la cuenta de asertos no se inventa un veredicto", () => {
    for (const malo of [undefined, null, -1, 1.5, "3", NaN]) {
      assert.throws(
        () => veredictoDeGuion({ fallos: [], afirmaciones: malo as unknown as number }),
        /entero/,
        `afirmaciones = ${String(malo)} tendría que reventar`,
      );
    }
    assert.throws(() => veredictoDeGuion({ fallos: undefined as unknown as string[], afirmaciones: 1 }), /fallos/);
  });
});

/** EL CABLE, leído del ÁRBOL de `qa/run.mjs` (#639, hallazgo H-1 de QA).
 *
 *  Lo de arriba mide la REGLA; esto mide que alguien la use. La distinción no
 *  es teórica: QA devolvió tres líneas de `qa/run.mjs` —el incremento de
 *  `expect`, la llamada a `veredictoDeGuion` y el `estado:` del `push`— y
 *  **`npm test` siguió dando 2940/2940 en verde** mientras un guion mudo volvía
 *  a salir ✔ con exit 0. Media PR revertida sin que se enterase nadie, y la
 *  batería tampoco podía: después del arreglo del 141 no queda un solo guion
 *  que se quede mudo, o sea que el candado se había quedado sin sujeto vivo.
 *
 *  Es el molde de `test/sonda-de-qa.test.ts` —el sitio de llamada de
 *  `presupuestoConducido`—, que nació con esta misma frase: «la regla vivía en
 *  una línea de `run.mjs` que ningún test podía ejercer sin abrir un
 *  navegador». Aquí vive en tres, y `qa/run.mjs` no se puede importar (llama a
 *  `main()` al cargarse), así que se lee su árbol.
 *
 *  El hermano de batería es `qa/guiones/146-…`, que además ejerce el ctx VIVO;
 *  éste existe porque aquel solo corre en la corrida local, y el rojo que nadie
 *  corre ya costó dos días una vez (#633).
 *
 *  Se lee el ÁRBOL y no el texto: un `grep` sabe que `veredictoDeGuion`
 *  aparece, no que sea QUIEN decide el `estado` del push que no es del canal ⊘.
 */
const runner = ts.createSourceFile(
  "run.mjs",
  readFileSync(join(repoRoot, "qa", "run.mjs"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
function recorrer(n: ts.Node, f: (x: ts.Node) => void): void {
  f(n);
  n.forEachChild((h) => recorrer(h, f));
}
const texto = (n: ts.Node): string => n.getText(runner);

/** El método `expect` del ctx del runner. */
function metodoExpect(): ts.MethodDeclaration | null {
  let hallado: ts.MethodDeclaration | null = null;
  recorrer(runner, (n) => {
    if (ts.isMethodDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.name.text === "expect") hallado = n;
  });
  return hallado;
}

/** Los `resultados.push({…})` del runner, con el texto de su `estado`. */
function estadosDeLosPush(): string[] {
  const out: string[] = [];
  recorrer(runner, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "push" &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "resultados" &&
      n.arguments.length === 1 &&
      ts.isObjectLiteralExpression(n.arguments[0])
    ) {
      const prop = (n.arguments[0] as ts.ObjectLiteralExpression).properties.find(
        (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "estado",
      );
      if (prop && ts.isPropertyAssignment(prop)) out.push(texto(prop.initializer));
    }
  });
  return out;
}

/** La (única) llamada a `veredictoDeGuion`, con lo que se le pasa. */
function laLlamada(): { id: string; args: Record<string, string> } | null {
  let out: { id: string; args: Record<string, string> } | null = null;
  let n_ = 0;
  recorrer(runner, (n) => {
    if (!(ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "veredictoDeGuion")) return;
    n_++;
    const decl = n.parent;
    const args: Record<string, string> = {};
    if (n.arguments.length === 1 && ts.isObjectLiteralExpression(n.arguments[0])) {
      for (const p of (n.arguments[0] as ts.ObjectLiteralExpression).properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) args[p.name.text] = texto(p.initializer);
      }
    }
    if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) out = { id: decl.name.text, args };
  });
  return n_ === 1 ? out : null;
}

describe("veredictos: el CABLE del runner, leído de qa/run.mjs (#639)", () => {
  it("`expect` cuenta la afirmación, y ANTES de juzgar (las dos ramas)", () => {
    const m = metodoExpect();
    assert.ok(m, "qa/run.mjs ya no define el método `expect`: este candado se quedó sin sujeto");
    const cuerpo = m.body?.statements ?? ([] as unknown as ts.NodeArray<ts.Statement>);
    const esIncremento = (st: ts.Statement): boolean =>
      ts.isExpressionStatement(st) &&
      (ts.isPostfixUnaryExpression(st.expression) || ts.isPrefixUnaryExpression(st.expression)) &&
      st.expression.operator === ts.SyntaxKind.PlusPlusToken &&
      ((ts.isIdentifier(st.expression.operand) && st.expression.operand.text === "afirmaciones") ||
        (ts.isPropertyAccessExpression(st.expression.operand) && st.expression.operand.name.text === "afirmaciones"));
    const iInc = cuerpo.findIndex(esIncremento);
    const iIf = cuerpo.findIndex((st) => ts.isIfStatement(st));
    assert.ok(iInc >= 0, "`expect` no incrementa el contador de afirmaciones: sin eso el veredicto juzga un 0 fijo");
    assert.ok(
      iIf < 0 || iInc < iIf,
      "el contador se incrementa DESPUÉS de mirar la condición: un guion con todos sus asertos en rojo " +
        "«no habría afirmado nada» y se llevaría encima un segundo diagnóstico falso",
    );
  });

  it("**el estado de un guion que MIDIÓ lo decide `veredictoDeGuion`, no un `fallos.length === 0`**", () => {
    // Aquí es donde se revierte media PR en verde: devolver este ternario deja
    // la función, sus tests y la batería entera intactos.
    const estados = estadosDeLosPush();
    const delCanalSinMedir = estados.filter((e) => e === "SIN_MEDIR");
    const delVeredicto = estados.filter((e) => e !== "SIN_MEDIR");
    assert.ok(
      delCanalSinMedir.length >= 2 && estados.length >= 3,
      `el árbol de qa/run.mjs cambió de forma: ${estados.length} resultados.push, ${delCanalSinMedir.length} con SIN_MEDIR`,
    );
    const llamada = laLlamada();
    assert.ok(llamada, "`veredictoDeGuion` no se llama exactamente una vez en qa/run.mjs: dos caminos al verde divergen callados");
    assert.deepEqual(
      delVeredicto,
      [`${llamada.id}.estado`],
      "un solo sitio decide el estado del guion que midió, y es el que devuelve `veredictoDeGuion`",
    );
  });

  it("…y se la alimenta con los contadores VIVOS del ctx, no con literales", () => {
    // La lección de la casa: un candado puede sujetar la DECISIÓN y no el
    // ARGUMENTO. Delegar y pasarle `afirmaciones: 1` deja la regla intacta y
    // sin sujeto.
    const llamada = laLlamada();
    assert.ok(llamada);
    assert.deepEqual(llamada.args, { fallos: "ctx.fallos", afirmaciones: "ctx.afirmaciones" });
  });

  it("**el contador es de SOLO LECTURA para el guion vigilado** (H-3)", () => {
    // Escribir `ctx.fallos` solo puede poner rojo; escribir el contador FABRICA
    // UN VERDE, así que el estado malo se hace inexpresable en vez de vigilarse.
    // Medido antes del arreglo: un guion mudo con `ctx.afirmaciones = 7` salía ✔.
    let accesor: ts.GetAccessorDeclaration | null = null;
    let comoDato = false;
    let conSetter = false;
    recorrer(runner, (n) => {
      if (ts.isGetAccessorDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "afirmaciones") accesor = n;
      if (ts.isSetAccessorDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "afirmaciones") conSetter = true;
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "afirmaciones" && !ts.isCallExpression(n.parent.parent))
        comoDato = true;
    });
    assert.ok(accesor, "`afirmaciones` tiene que asomar al guion como getter: como propiedad de datos se le puede escribir un 7");
    assert.equal(conSetter, false, "un setter devuelve el agujero entero");
    assert.equal(comoDato, false, "`afirmaciones` vuelve a ser una propiedad de datos escribible");
    const cierra = texto(runner).includes('Object.defineProperty(ctx, "afirmaciones", { configurable: false })');
    assert.ok(cierra, "sin cerrar la propiedad, un `Object.defineProperty` del guion redefine el getter y compra el verde");
  });
});
