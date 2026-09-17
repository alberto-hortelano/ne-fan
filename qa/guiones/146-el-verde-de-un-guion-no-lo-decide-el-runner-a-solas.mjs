/** El CABLE de #639: que el veredicto de un guion lo siga decidiendo
 *  `veredictoDeGuion` con el contador VIVO de asertos.
 *
 *  Por qué existe, medido por QA el 2026-09-17 sobre la PR que estrena la regla.
 *  #639 parte la decisión en dos mitades: la REGLA («un verde exige
 *  `fallos === 0 && afirmaciones > 0`») vive en `qa/lib/veredictos.mjs` y la
 *  mide `nefan-core/test/veredictos.test.ts` en cada `npm test`; el CABLE que la
 *  ata al juicio real de un guion vive en tres líneas de `qa/run.mjs` —el
 *  `ctx.afirmaciones++` de `expect`, la llamada a `veredictoDeGuion` y el
 *  `estado:` del `resultados.push`—. La mitad medida no sujeta la otra:
 *  devolviendo el `estado: ctx.fallos.length === 0 ? VERDE : ROJO` de antes y
 *  quitando el import, `npm test` sigue dando **2940/2940 en verde**, la batería
 *  entera sigue igual —el 141 declara su ⊘ antes de llegar aquí y los otros 142
 *  afirman siempre— y un guion MUDO vuelve a salir ✔ con exit 0. O sea, media
 *  PR revertida en verde.
 *
 *  Y no es un molde nuevo: es EXACTAMENTE el de `presupuestoConducido`
 *  (`nefan-core/test/sonda-de-qa.test.ts`), que nació porque «la regla vivía en
 *  una línea de `run.mjs` que ningún test podía ejercer sin abrir un navegador».
 *  Aquí la regla vive en tres.
 *
 *  Se lee el ÁRBOL y no el texto: un `grep` sabe que `veredictoDeGuion` aparece,
 *  no que sea QUIEN decide el estado del `resultados.push` que no es del canal ⊘.
 *
 *  LO QUE NO MIRA, para que nadie lo cite de más:
 *   · si la REGLA es la correcta — eso es `veredictos.test.ts`; aquí solo se
 *     afirma, en una línea, que `afirmaciones: 0` no puede salir VERDE, para que
 *     nadie ablande la función dejando el cable intacto;
 *   · la mudez PARCIAL ni la pertinencia del aserto — las declara el docblock de
 *     `veredictoDeGuion` y siguen sin cubrirse;
 *   · de dónde SALE el contador: que `expect` lo suba una vez por aserto se ve
 *     aquí, pero que no lo suba nadie MÁS —un helper, el propio runner— no lo
 *     mira este guion ni ninguno.
 *
 *  Lo que era el tercer «no mira» de QA —«el contador es una propiedad
 *  escribible: `ctx.afirmaciones = 7` compra un verde»— dejó de serlo en la
 *  vuelta de hallazgos: el contador vive en el cierre de `makeCtx`, asoma como
 *  getter sin setter y la propiedad no es configurable. Como el arreglo es
 *  EXACTAMENTE la clase de cosa que se revierte en verde, el bloque 5 lo
 *  ejerce de verdad, sobre el `ctx` vivo que este guion tiene en la mano.
 *
 *  PROBADO EN NEGATIVO (QA, 2026-09-17), los tres sabotajes por separado y con
 *  restauración entre ellos: quitar el `ctx.afirmaciones++` de `expect` → rojo el
 *  bloque 1; devolver el `estado: ctx.fallos.length === 0 ? VERDE : ROJO` → rojo
 *  el bloque 2; pasarle `afirmaciones: 1` literal en vez de `ctx.afirmaciones` →
 *  rojo el bloque 3.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERDE, veredictoDeGuion } from "../lib/veredictos.mjs";

/** La EXCEPCIÓN del guardarraíl (#295): este guion no abre el juego — solo lee
 *  el árbol de `qa/run.mjs`. */
export const sinMotor = "solo lee el árbol de qa/run.mjs; no arranca partida ni habla con el motor";

const DIR = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(DIR, "..", "..");
const CORE = join(RAIZ, "nefan-core");
const RUNNER = join(DIR, "..", "run.mjs");

export default async function (ctx) {
  // El mismo `typescript` que usan los demás candados que leen árboles. Si no
  // está, se DICE: un candado que no puede leer no es un candado verde.
  if (!existsSync(join(CORE, "node_modules", "typescript"))) {
    ctx.sinMedir(
      "no encuentro `typescript` en nefan-core/node_modules, y este guion lee el ÁRBOL de " +
        "qa/run.mjs para saber quién decide el veredicto. Corre `npm ci` en nefan-core.",
    );
  }
  const require = createRequire(join(CORE, "package.json"));
  const ts = require("typescript");

  const fuente = readFileSync(RUNNER, "utf8");
  const src = ts.createSourceFile("run.mjs", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const texto = (n) => n.getText(src);
  const linea = (n) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
  const recorrer = (n, f) => {
    f(n);
    n.forEachChild((h) => recorrer(h, f));
  };

  // ── 1 · `expect` cuenta, y cuenta ANTES de juzgar ────────────────────────
  // El contador tiene que subir en LAS DOS ramas: si solo contara el ✔, un
  // guion con todos sus asertos en rojo «no habría afirmado nada» y se llevaría
  // encima un segundo diagnóstico falso.
  let expectDecl = null;
  recorrer(src, (n) => {
    if (ts.isMethodDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.name.text === "expect") expectDecl = n;
  });
  ctx.expect(
    "`qa/run.mjs` define el método `expect` del ctx (si no, este guion no está midiendo nada)",
    expectDecl !== null,
  );
  if (!expectDecl) return;

  const cuerpo = expectDecl.body?.statements ?? [];
  // El contador se incrementa en el CIERRE (`afirmaciones++`) desde que dejó
  // de ser una propiedad escribible del ctx; se acepta también la forma vieja
  // (`ctx.afirmaciones++`) porque lo que este bloque pregunta es si `expect`
  // CUENTA — de que el contador siga siendo infalsificable se ocupa el 5.
  const esIncremento = (s) =>
    ts.isExpressionStatement(s) &&
    (ts.isPostfixUnaryExpression(s.expression) || ts.isPrefixUnaryExpression(s.expression)) &&
    s.expression.operator === ts.SyntaxKind.PlusPlusToken &&
    ((ts.isIdentifier(s.expression.operand) && s.expression.operand.text === "afirmaciones") ||
      (ts.isPropertyAccessExpression(s.expression.operand) && s.expression.operand.name.text === "afirmaciones"));
  const iIncremento = cuerpo.findIndex(esIncremento);
  const iPrimerIf = cuerpo.findIndex((s) => ts.isIfStatement(s));
  ctx.expect(
    "`expect` INCREMENTA el contador de afirmaciones del ctx",
    iIncremento >= 0,
    `cuerpo de expect: ${cuerpo.map(texto).map((t) => t.split("\n")[0]).join(" · ").slice(0, 200)}`,
  );
  ctx.expect(
    "…y lo hace ANTES de mirar la condición, o sea en las dos ramas (afirmar y fallar es afirmar)",
    iIncremento >= 0 && (iPrimerIf < 0 || iIncremento < iPrimerIf),
    `incremento en la sentencia ${iIncremento}, primer if en la ${iPrimerIf}`,
  );

  // ── 2 · el estado del guion que MIDIÓ sale de `veredictoDeGuion` ─────────
  // Los `resultados.push` del canal ⊘ (#331) llevan `SIN_MEDIR` a pelo y son
  // varios; el que juzga lo medido tiene que ser UNO y tiene que delegar.
  const pushes = [];
  recorrer(src, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "push" &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "resultados" &&
      n.arguments.length === 1 &&
      ts.isObjectLiteralExpression(n.arguments[0])
    ) {
      const prop = n.arguments[0].properties.find(
        (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "estado",
      );
      if (prop) pushes.push({ nodo: n, estado: texto(prop.initializer), linea: linea(n) });
    }
  });
  const delCanalSinMedir = pushes.filter((p) => p.estado === "SIN_MEDIR");
  const delVeredicto = pushes.filter((p) => p.estado !== "SIN_MEDIR");
  ctx.expect(
    "el runner tiene su canal ⊘ y su canal de veredicto (si no, el árbol cambió de forma)",
    delCanalSinMedir.length >= 2 && pushes.length >= 3,
    `${pushes.length} resultados.push · ${delCanalSinMedir.length} con SIN_MEDIR a pelo`,
  );
  ctx.expect(
    "un solo sitio decide el estado de un guion que SÍ midió",
    delVeredicto.length === 1,
    delVeredicto.map((p) => `run.mjs:${p.linea} → ${p.estado}`).join(" · "),
  );

  /** El identificador al que se asigna la llamada a `veredictoDeGuion`. */
  let ligadura = null;
  let llamadas = 0;
  recorrer(src, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "veredictoDeGuion") {
      llamadas++;
      const decl = n.parent;
      if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) ligadura = { id: decl.name.text, call: n };
    }
  });
  ctx.expect(
    "`veredictoDeGuion` se llama EXACTAMENTE una vez: dos caminos al verde divergen callados",
    llamadas === 1,
    `${llamadas} llamada(s)`,
  );
  ctx.expect(
    "…y el `estado` del guion medido ES el que devuelve esa llamada, no un `fallos.length === 0`",
    ligadura !== null && delVeredicto.length === 1 && delVeredicto[0].estado === `${ligadura.id}.estado`,
    `estado = ${delVeredicto.map((p) => p.estado).join(" · ")} · ligadura = ${ligadura?.id ?? "(ninguna)"}`,
  );

  // ── 3 · se le pasa el CONTADOR VIVO, no un número escrito aquí ───────────
  // La lección de la casa: un candado puede sujetar el ARGUMENTO y no la
  // DECISIÓN, y también al revés — delegar la decisión y alimentarla con un
  // literal deja la regla intacta y sin sujeto.
  const arg = ligadura && ligadura.call.arguments.length === 1 && ts.isObjectLiteralExpression(ligadura.call.arguments[0])
    ? ligadura.call.arguments[0]
    : null;
  const valorDe = (nombre) => {
    const p = arg?.properties.find((x) => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === nombre);
    return p ? texto(p.initializer) : null;
  };
  ctx.expect(
    "el juicio se alimenta del contador VIVO del ctx (`ctx.afirmaciones`), no de un literal",
    valorDe("afirmaciones") === "ctx.afirmaciones",
    `afirmaciones: ${valorDe("afirmaciones")}`,
  );
  ctx.expect(
    "…y de los fallos VIVOS del ctx (`ctx.fallos`)",
    valorDe("fallos") === "ctx.fallos",
    `fallos: ${valorDe("fallos")}`,
  );

  // ── 4 · la regla que hay al otro lado del cable, en una línea ────────────
  // No duplica `veredictos.test.ts`: afirma lo mínimo para que ablandar la
  // función con el cable intacto no pase desapercibido desde aquí.
  ctx.expect(
    "y la función a la que delega NO da verde a quien no afirmó nada",
    veredictoDeGuion({ fallos: [], afirmaciones: 0 }).estado !== VERDE,
    JSON.stringify(veredictoDeGuion({ fallos: [], afirmaciones: 0 })),
  );

  // ── 5 · el contador no lo puede falsificar el guion vigilado (H-3 de QA) ──
  // La asimetría es lo que lo hace grave y por eso se ejerce en vivo: escribir
  // `ctx.fallos` solo puede poner ROJO a quien lo escribe, pero escribir el
  // contador FABRICA UN VERDE. Medido por QA sobre la primera versión: un guion
  // mudo con `ctx.afirmaciones = 7` salía ✔.
  const antes = ctx.afirmaciones;
  let alEscribir = null;
  try {
    ctx.afirmaciones = antes + 99;
  } catch (err) {
    alEscribir = err;
  }
  let alRedefinir = null;
  try {
    Object.defineProperty(ctx, "afirmaciones", { value: antes + 99 });
  } catch (err) {
    alRedefinir = err;
  }
  ctx.expect(
    "escribir `ctx.afirmaciones` desde el guion LANZA: es un getter sin setter y esto es un módulo estricto",
    alEscribir instanceof TypeError,
    alEscribir ? alEscribir.message : "no lanzó: la asignación coló",
  );
  ctx.expect(
    "…y redefinir la propiedad también: no es `configurable`, o el getter sería un adorno",
    alRedefinir instanceof TypeError,
    alRedefinir ? alRedefinir.message : "no lanzó: el defineProperty coló",
  );
  const trasLosIntentos = ctx.afirmaciones;
  ctx.expect(
    "…y el contador no se movió por los dos intentos: lo único que lo sube es AFIRMAR",
    trasLosIntentos === antes + 2,
    `antes ${antes} · tras los dos intentos ${trasLosIntentos} (los +2 son los dos asertos de aquí arriba)`,
  );

  ctx.log(`run.mjs: ${pushes.length} resultados.push · veredicto en run.mjs:${delVeredicto[0]?.linea}`);
}
