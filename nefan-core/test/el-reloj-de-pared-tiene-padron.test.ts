/** El reloj de pared tiene padrón (#711, tanda AO, 2026-09-23): todo reloj de
 *  PARED que lea un guion de `qa/guiones/` está declarado con su motivo, o el
 *  test se pone rojo.
 *
 *  ## Qué sujeta
 *
 *  La cura del guion 93 (#679): `medirVelocidad` mide Δpos/Δsim —el reloj de
 *  SIMULACIÓN— y su ventana va en segundos de sim. Antes dividía por el
 *  timestamp que `requestAnimationFrame` pasa a su callback, que es PARED, y
 *  bajo carga la pared corre sin que el mundo lo haga: la medida se rompía sin
 *  que el juego hubiera cambiado. Estaba demostrado con el reproductor
 *  (`bajo-carga.mjs 93 --factor 40`: antes `se-rompio`, después `igual-verde`),
 *  pero ese reproductor es una corrida manual de ~20 min. Si alguien devolvía
 *  el denominador a la pared, `npm test` seguía verde.
 *
 *  La vía que la tanda W RETIRÓ —leer el cuerpo de `run.mjs` con
 *  `new Function`— no es la que se repone. Es la de la casa para guiones: un
 *  padrón por el ÁRBOL (como `sondas-de-movimiento.json`), sobre el barrido
 *  único de `test/banco-ficheros.ts`, con la cuenta EXACTA por fichero. Las
 *  formas que el detector ve, y por qué la regresión del 93 obliga a resolver el
 *  callback NOMBRADO hasta su declaración, están en `test/relojes-de-pared.ts`.
 *
 *  ## El negativo, dentro de `npm test`
 *
 *  El `describe` del 93 aplica la regresión al fuente REAL del guion, en
 *  memoria, con `qa/lib/anclas.mjs` (#700): cada ancla tiene que aparecer
 *  exactamente una vez, así que si el 93 cambia, ese `it` lo dice en vez de
 *  pasar mudo sin haber mutado nada.
 *
 *  ## QUÉ NO SUJETA
 *
 *  En `_lo_que_esto_NO_sujeta` del padrón, cada punto con su `it` «LÍMITE
 *  MEDIDO» abajo: si la cifra cambia, el punto se retira o se reescribe. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { SALTOS_DEL_BANCO, fuentesDelBanco } from "./banco-ficheros.js";
import { relojesDe, type Reloj } from "./relojes-de-pared.js";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const QA = join(repoRoot, "qa");
const CONTRATO = join(core, "data", "contract", "relojes-de-pared.json");
const GUION_93 = "qa/guiones/93-la-velocidad-y-el-alcance-los-dice-el-config.mjs";

type Parche = { ok: true; texto: string } | { ok: false; indice: number; buscar: string; veces: number };
const { aplicarPares } = (await import(join(repoRoot, "qa", "lib", "anclas.mjs"))) as {
  aplicarPares: (texto: string, pares: [string, string][]) => Parche;
};

const PadronSchema = z
  .object({
    _comment: z.string().min(1),
    /** Obligatorio: los agujeros conocidos se escriben AL LADO de lo que sí se
     *  sujeta (costumbre desde la QA de #662). */
    _lo_que_esto_NO_sujeta: z.string().min(1),
    declarados: z
      .array(
        z
          .object({
            /** Relativa a la raíz del repo; solo `qa/guiones/**`, que es lo que se censa. */
            fichero: z.string().regex(/^qa\/guiones\/[\w./-]+\.mjs$/, "una declaración nombra un `qa/guiones/**/*.mjs`"),
            /** EXACTA, no un tope: también es rojo que sobren. */
            relojes: z.number().int().min(1),
            /** Qué mide ese reloj y por qué la pared es la medida correcta. */
            porque: z.string().min(40),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type Padron = z.infer<typeof PadronSchema>;

const padron: Padron = PadronSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const fuentes = fuentesDelBanco(QA).map((f) => `qa/${f}`);
const leer = (f: string): string => readFileSync(join(repoRoot, f), "utf8");
const guiones = fuentes.filter((f) => f.startsWith("qa/guiones/"));
const censo = new Map(guiones.map((f) => [f, relojesDe(leer(f))] as const));

const donde = (rs: Reloj[]): string => rs.map((r) => `${r.linea}:${r.forma}`).join(", ");

/** Los desajustes entre un censo y el padrón, en las dos direcciones. Vacío = verde. */
function desajustes(c: ReadonlyMap<string, Reloj[]>, p: Padron): string[] {
  const out: string[] = [];
  const declarados = new Map(p.declarados.map((d) => [d.fichero, d.relojes]));
  for (const [f, rs] of c) {
    const esperado = declarados.get(f) ?? 0;
    if (rs.length !== esperado) {
      out.push(
        `${f}: ${rs.length} relojes de pared contra ${esperado} declarados (${donde(rs) || "ninguno"}). ` +
          "Si mide el JUEGO, que mida contra `window.__nefan.reloj().sim`; si la pared es la medida correcta, " +
          "declara la cifra exacta con su motivo en data/contract/relojes-de-pared.json.",
      );
    }
  }
  for (const d of p.declarados) {
    if (!c.has(d.fichero)) out.push(`${d.fichero}: declarado en el padrón y no es un fuente de qa/guiones/ — entrada muerta.`);
  }
  return out;
}

const cuenta = (fuente: string): number => relojesDe(fuente).length;
const formas = (fuente: string): string[] => relojesDe(fuente).map((r) => r.forma);

const arbol = (fuente: string): ts.SourceFile => ts.createSourceFile("x.mjs", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const cuentaNodos = (fuente: string, pred: (n: ts.Node) => boolean): number => {
  let n = 0;
  const v = (x: ts.Node): void => {
    if (pred(x)) n++;
    ts.forEachChild(x, v);
  };
  v(arbol(fuente));
  return n;
};
/** Solo para MEDIR el límite (8): llamadas a `setTimeout`/`setInterval` y a `….waitForTimeout`. */
const temporizadores = (fuente: string): number =>
  cuentaNodos(fuente, (x) => {
    if (!ts.isCallExpression(x)) return false;
    const e = x.expression;
    if (ts.isIdentifier(e)) return e.text === "setTimeout" || e.text === "setInterval";
    return ts.isPropertyAccessExpression(e) && ["setTimeout", "setInterval", "waitForTimeout"].includes(e.name.text);
  });
/** Solo para MEDIR el límite (9): strings y plantillas cuyo TEXTO lee la pared. */
const stringsConReloj = (fuente: string): number =>
  cuentaNodos(
    fuente,
    (x) => (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || ts.isTemplateHead(x) || ts.isTemplateMiddle(x) || ts.isTemplateTail(x)) && /\b(performance\.now|Date\.now)\s*\(/.test(x.text),
  );

describe("el reloj de pared tiene padrón (#711): qa/guiones/**", () => {
  it("el árbol tiene sujeto: hay guiones y el detector encuentra relojes", () => {
    // Sin esto, un detector que mirase el directorio equivocado aprobaría la
    // totalidad sobre cero ficheros.
    assert.ok(guiones.length > 50, `solo ${guiones.length} guiones bajo ${QA}/guiones — ¿se movió el banco?`);
    const total = [...censo.values()].reduce((a, rs) => a + rs.length, 0);
    assert.ok(total > 0, "cero relojes en todo qa/guiones: el detector no ve nada");
  });

  it("todo reloj de pared de un guion está declarado con su cuenta EXACTA, y ninguna entrada está muerta", () => {
    const d = desajustes(censo, padron);
    assert.deepEqual(d, [], `\n${d.join("\n")}`);
  });

  it("ninguna entrada se declara dos veces", () => {
    const vistos = padron.declarados.map((d) => d.fichero);
    assert.deepEqual(vistos.filter((f, i) => vistos.indexOf(f) !== i), []);
  });

  it("el censo de hoy: 31 relojes en 11 guiones, y ningún callback de rAF con parámetro", () => {
    // Medido el 2026-09-23 al nacer el padrón (15 en 6). El issue decía 5
    // guiones (07, 10, 109, 131, 133): 109 solo lo nombra en un COMENTARIO y
    // cuenta 0, y 157 y 164 nacieron después. El 166 entró el 2026-09-24 con
    // #714 (rebase de la tanda AO), y el padrón lo cazó el mismo día. El 171 y
    // el 172 (tanda AQ, #694) entraron en su rebase: cronometran el cable del
    // banco, no el juego. El 168 y el 170 (#693, tanda AP) entraron al rebasar
    // sobre #711: sus cuatro t0/Δ de Node cada uno. Si esta cifra cambia con
    // el padrón al día, se
    // actualiza aquí.
    const ocupados = [...censo].filter(([, rs]) => rs.length > 0);
    assert.deepEqual(
      ocupados.map(([f]) => f.replace(/^qa\/guiones\/(\d+)-.*$/, "$1")),
      ["07", "10", "131", "133", "157", "164", "166", "168", "170", "171", "172"],
    );
    assert.equal(ocupados.reduce((a, [, rs]) => a + rs.length, 0), 31);
    assert.equal([...censo.values()].flat().filter((r) => r.forma === "raf-param").length, 0);
    assert.equal(cuenta(leer("qa/guiones/109-el-tile-que-tarda-y-el-que-falla-lo-dicen.mjs")), 0);
  });
});

describe("el negativo del 93: devolver el denominador a la pared es ROJO", () => {
  const fuente93 = leer(GUION_93);
  const regresion = (pares: [string, string][]): string => {
    const r = aplicarPares(fuente93, pares);
    assert.ok(r.ok, r.ok ? "" : `el ancla ${JSON.stringify(r.buscar)} aparece ${r.veces} veces en el 93 (tiene que ser 1): el negativo ya no muta lo que cree`);
    return r.ok ? r.texto : "";
  };
  const conCenso = (texto: string): Map<string, Reloj[]> => new Map([...censo, [GUION_93, relojesDe(texto)]]);

  it("el 93 real no lee la pared: 0 relojes", () => {
    assert.equal(cuenta(fuente93), 0);
  });

  it("el timestamp del rAF por el callback NOMBRADO (`const tick = (t) => …`) se ve y pone rojo el padrón", () => {
    const roto = regresion([
      ["const tick = () => {", "const tick = (t) => {"],
      ["out.push([reloj.sim, p.x, p.z]);", "out.push([t / 1000, p.x, p.z]);"],
    ]);
    // Las dos llamadas —la que arranca el bucle y la que lo reprograma— pasan `tick`.
    assert.deepEqual(formas(roto), ["raf-param", "raf-param"]);
    const d = desajustes(conCenso(roto), padron);
    assert.equal(d.length, 1, d.join("\n"));
    assert.match(d[0], /93-la-velocidad.*2 relojes de pared contra 0 declarados \(\d+:raf-param, \d+:raf-param\)/);
  });

  it("`performance.now()` en lugar de `reloj.sim` también es rojo", () => {
    const roto = regresion([["out.push([reloj.sim, p.x, p.z]);", "out.push([performance.now() / 1000, p.x, p.z]);"]]);
    assert.deepEqual(formas(roto), ["performance.now"]);
    assert.equal(desajustes(conCenso(roto), padron).length, 1);
  });

  it("el idioma de la casa `const t = await new Promise((r) => requestAnimationFrame(r))` también es rojo (QA de #711, H-1)", () => {
    // La reescritura del `tick` sin parámetro: el timestamp llega por el
    // RESOLVER de la promesa, que es parámetro del ejecutor y no del callback.
    const roto = regresion([
      ["const tick = () => {", "const tick = async () => {"],
      ["const reloj = window.__nefan.reloj();", "const t = await new Promise((r) => requestAnimationFrame(r));"],
      ["out.push([reloj.sim, p.x, p.z]);", "out.push([t / 1000, p.x, p.z]);"],
    ]);
    assert.deepEqual(formas(roto), ["raf-param"]);
    assert.match(desajustes(conCenso(roto), padron).join("\n"), /93-la-velocidad.*1 relojes de pared contra 0 declarados \(\d+:raf-param\)/);
  });

  it("una entrada del padrón que ya no tiene reloj es rojo (cuenta de MENOS)", () => {
    const sin157 = new Map([...censo, ["qa/guiones/157-el-tile-del-falso-llega-en-segundos.mjs", []]]);
    assert.match(desajustes(sin157, padron).join("\n"), /157-.*0 relojes de pared contra 2 declarados/);
    const sinFichero = new Map([...censo].filter(([f]) => !f.includes("/164-")));
    assert.match(desajustes(sinFichero, padron).join("\n"), /164-.*entrada muerta/);
  });
});

describe("el detector: lo que VE", () => {
  it("un callback de rAF con parámetro, en línea, con arrow o `function`", () => {
    assert.deepEqual(formas("requestAnimationFrame((t) => t);"), ["raf-param"]);
    assert.deepEqual(formas("requestAnimationFrame(function (t) { return t; });"), ["raf-param"]);
    assert.deepEqual(formas("requestAnimationFrame(((t) => t));"), ["raf-param"]);
  });

  it("el callback NOMBRADO se resuelve a su declaración: `const`, `let` y `function`", () => {
    assert.equal(cuenta("const tick = (t) => {}; requestAnimationFrame(tick);"), 1);
    assert.equal(cuenta("let tick = function (t) {}; requestAnimationFrame(tick);"), 1);
    assert.equal(cuenta("function tick(t) { requestAnimationFrame(tick); }\nrequestAnimationFrame(tick);"), 2);
    // Dentro de un `page.evaluate`, como en el 93.
    assert.equal(cuenta("await page.evaluate(() => new Promise((res) => { const tick = (t) => { res(t); }; requestAnimationFrame(tick); }));"), 1);
  });

  it("el RESOLVER de un `new Promise` cuenta cuando su valor se usa, y no cuando se tira", () => {
    assert.equal(cuenta("const t = await new Promise((r) => requestAnimationFrame(r));"), 1);
    assert.equal(cuenta("const t = await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));"), 1);
    assert.equal(cuenta("new Promise((resolve) => requestAnimationFrame(resolve)).then((t) => t);"), 1);
    assert.equal(cuenta("function f() { return new Promise((r) => requestAnimationFrame(r)); }"), 1);
    assert.equal(cuenta("const t = await new Promise(requestAnimationFrame);"), 1);
    // «Esperar dos fotogramas»: el valor se tira, también a través de `page.evaluate`.
    assert.equal(cuenta("await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));"), 0);
    assert.equal(cuenta("await ctx.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));"), 0);
    assert.equal(cuenta("await new Promise(requestAnimationFrame);"), 0);
    // El SEGUNDO parámetro del ejecutor (reject) TAMBIÉN recibe el timestamp —rAF llama `ko(t)`—, pero el
    // detector solo sigue el PRIMERO (el resolve): es límite, medido en el (9).
    assert.equal(cuenta("const t = await new Promise((ok, ko) => requestAnimationFrame(ko));"), 0);
    // Resolver con OTRO valor (`r(true)`) no entrega la pared: el callback no tiene parámetro.
    assert.equal(cuenta("const t = await new Promise((r) => requestAnimationFrame(() => r(true)));"), 0);
  });

  it("`window.` / `globalThis.` / `self.` delante de la función", () => {
    assert.equal(cuenta("window.requestAnimationFrame((t) => t);"), 1);
    assert.equal(cuenta("globalThis.requestAnimationFrame((t) => t);"), 1);
    assert.equal(cuenta("self.requestAnimationFrame((t) => t);"), 1);
  });

  it("el ámbito manda: un `tick` sin parámetro más cercano tapa a uno con parámetro de fuera", () => {
    assert.equal(cuenta("const tick = (t) => {};\nfunction f() { const tick = () => {}; requestAnimationFrame(tick); }"), 0);
    assert.equal(cuenta("const tick = () => {};\nfunction f() { const tick = (t) => {}; requestAnimationFrame(tick); }"), 1);
  });

  it("`performance.now`, `Date.now` y sus grafías: llamada, referencia, corchetes y prefijo global", () => {
    assert.deepEqual(formas("performance.now(); Date.now();"), ["performance.now", "Date.now"]);
    assert.deepEqual(formas("const f = performance.now.bind(performance);"), ["performance.now"]);
    assert.deepEqual(formas('performance["now"](); Date["now"]();'), ["performance.now", "Date.now"]);
    assert.deepEqual(formas("window.performance.now(); globalThis.Date.now();"), ["performance.now", "Date.now"]);
  });

  it("`new Date()` sin argumentos, `document.timeline.currentTime` y `process.hrtime`", () => {
    assert.deepEqual(formas("new Date(); new Date;"), ["new Date()", "new Date()"]);
    assert.deepEqual(formas("const t = document.timeline.currentTime;"), ["document.timeline"]);
    assert.deepEqual(formas("process.hrtime(); process.hrtime.bigint();"), ["process.hrtime", "process.hrtime"]);
  });

  it("lo que NO es un reloj cuenta 0: reemplazos de rAF, rAF sin parámetro, prosa, strings y otros `now`", () => {
    // Los reemplazos de 131/132/133: asignar A la función no es llamarla.
    assert.equal(cuenta("window.requestAnimationFrame = () => 0;"), 0);
    assert.equal(cuenta("window.requestAnimationFrame = (cb) => { cola.push(cb); return 1; };"), 0);
    assert.equal(cuenta("const orig = window.requestAnimationFrame.bind(window);"), 0);
    assert.equal(cuenta("requestAnimationFrame(() => requestAnimationFrame(resolve));"), 0);
    assert.equal(cuenta("const tick = () => {}; requestAnimationFrame(tick);"), 0);
    assert.equal(cuenta("// performance.now() y Date.now()\n/* requestAnimationFrame((t) => t) */ const s = 'Date.now()';"), 0);
    assert.equal(cuenta("reloj.now(); x.performance.now(); new Date(0); new Date(ms);"), 0);
  });
});

describe("LÍMITE MEDIDO: lo que el padrón NO sujeta (cada punto de `_lo_que_esto_NO_sujeta`)", () => {
  const fuera = (pred: (f: string) => boolean): { relojes: number; ficheros: number } => {
    const fs = fuentes.filter(pred).map((f) => relojesDe(leer(f)).length).filter((n) => n > 0);
    return { relojes: fs.reduce((a, b) => a + b, 0), ficheros: fs.length };
  };

  it("(1) qa/lib/** queda fuera: hoy 28 relojes en 6 ficheros; y todo raf-param fuera de guiones vive en lib/", () => {
    assert.deepEqual(fuera((f) => f.startsWith("qa/lib/")), { relojes: 28, ficheros: 6 });
    // Lo que vigila la forma del 93 fuera de los guiones: los tres raf-param de
    // hoy, en la carga sintética (arranca y reprograma su `tic`) y en
    // `asentarElLayout`, cuya promesa se DEVUELVE (su valor sale de la función).
    const raf = fuentes
      .filter((f) => !f.startsWith("qa/guiones/"))
      .flatMap((f) => relojesDe(leer(f)).filter((r) => r.forma === "raf-param").map((r) => `${f}:${r.linea}`));
    assert.deepEqual(
      raf.map((x) => x.replace(/:\d+$/, "")),
      ["qa/lib/carga.mjs", "qa/lib/carga.mjs", "qa/lib/sesion.mjs"],
    );
    // El resto de qa/ (raíz: run.mjs, bajo-carga, baterías) no se cifra exacto
    // —59 en 18 el 2026-09-24, 57 de ellos `Date.now` de plazo; ver el padrón—:
    // cada script nuevo lo movería sin decisión que tomar (H-4 de la QA).
    assert.ok(fuera((f) => !f.startsWith("qa/lib/") && !f.startsWith("qa/guiones/")).relojes > 0);
    // Y por eso la regresión del 93 MUDADA a un helper de qa/lib no la ve nadie:
    assert.ok(!censo.has("qa/lib/carga.mjs"));
  });

  it("(2) el alias de la función cuenta 0", () => {
    assert.equal(cuenta("const raf = requestAnimationFrame; raf((t) => t);"), 0);
    assert.equal(cuenta("const raf = window.requestAnimationFrame.bind(window); raf((t) => t);"), 0);
  });

  it("(3) el callback por parámetro, por import o asignado después cuenta 0", () => {
    assert.equal(cuenta("function medir(cb) { requestAnimationFrame(cb); }\nmedir((t) => t);"), 0);
    assert.equal(cuenta('import { tick } from "../lib/x.mjs";\nrequestAnimationFrame(tick);'), 0);
    assert.equal(cuenta("let tick;\ntick = (t) => {};\nrequestAnimationFrame(tick);"), 0);
  });

  it("(4) el alias del reloj cuenta 0", () => {
    assert.equal(cuenta("const { now } = performance; now();"), 0);
    assert.equal(cuenta("const p = performance; p.now();"), 0);
  });

  it("(5) los relojes de pared con otro nombre cuentan 0", () => {
    assert.equal(cuenta("addEventListener('keydown', (e) => e.timeStamp);"), 0);
    assert.equal(cuenta("const o = performance.timeOrigin; const s = Date();"), 0);
    assert.equal(cuenta("requestAnimationFrame(function () { return arguments[0]; });"), 0);
  });

  it("(6) el TRUEQUE en un guion declarado sale verde: la cuenta no juzga el uso", () => {
    const f = "qa/guiones/157-el-tile-del-falso-llega-en-segundos.mjs";
    const r = aplicarPares(leer(f), [["const dt = performance.now() - t0;", "const dt = 0 - t0;"]]);
    assert.ok(r.ok, "el ancla del 157 ya no está una vez: reescribe este límite");
    const trocado = `${r.ok ? r.texto : ""}\nrequestAnimationFrame((t) => t);\n`;
    assert.deepEqual(formas(trocado), ["performance.now", "raf-param"]);
    assert.deepEqual(desajustes(new Map([...censo, [f, relojesDe(trocado)]]), padron), []);
  });

  it("(8) el TEMPORIZADOR como reloj cuenta 0: hoy 3 guiones llaman a uno", () => {
    // `p0 = pos(); await dormir(2000); v = (pos() - p0) / 2` mide contra la
    // pared sin leer ningún reloj (QA de #711, H-2).
    assert.equal(cuenta("const p0 = pos(); await new Promise((r) => setTimeout(r, 2000)); const v = (pos() - p0) / 2;"), 0);
    assert.equal(cuenta("await page.waitForTimeout(2000); setInterval(() => n++, 16);"), 0);
    assert.equal(cuenta("let n = 0; const tick = () => { if (++n < 120) requestAnimationFrame(tick); }; requestAnimationFrame(tick);"), 0);
    const conTemporizador = guiones
      .filter((f) => temporizadores(leer(f)) > 0)
      .map((f) => f.replace(/^qa\/guiones\/(\d+)-.*$/, "$1"));
    assert.deepEqual(conTemporizador, ["10", "19", "90"]);
  });

  it("(9) otras grafías de la pared cuentan 0, y hoy no tienen ocupante", () => {
    for (const f of [
      'await page.evaluate("performance.now()");',
      "await page.evaluate(`Date.now()`);",
      'const t = new Function("return Date.now()")();',
      'globalThis["Date"].now(); window.window.performance.now();',
      'performance.mark("a"); performance.measure("m", "a"); performance.getEntries();',
      'process.uptime(); console.time("x"); console.timeEnd("x"); Temporal.Now.instant();',
      "const o = { tick(t) {} }; requestAnimationFrame(o.tick);",
      "const tick = (t) => {}; requestAnimationFrame(tick.bind(null)); requestAnimationFrame(c ? tick : tick);",
      "const [tick] = [(t) => {}]; requestAnimationFrame(tick);",
      "const { promise, resolve } = Promise.withResolvers(); requestAnimationFrame(resolve); const t = await promise;",
      "const t = await new Promise((r) => (0, requestAnimationFrame)(r));",
      "const t = await new Promise((r) => { const f = r; requestAnimationFrame(f); });",
      "new Promise((_, rej) => requestAnimationFrame(rej)).catch((t) => t);",
    ]) {
      assert.equal(cuenta(f), 0, f);
    }
    // Ocupantes de hoy de la grafía que habría que ver por otra vía: código de
    // reloj DENTRO de un string (lo que llegaría a `evaluate` como texto).
    const enString = guiones.filter((f) => stringsConReloj(leer(f)) > 0);
    assert.deepEqual(enString, []);
  });

  it("(7) el barrido salta node_modules/, .tmp/ y capturas/ por nombre", () => {
    assert.deepEqual([...SALTOS_DEL_BANCO].sort(), [".tmp", "capturas", "node_modules"]);
    assert.ok(existsSync(join(QA, "guiones")));
  });
});
