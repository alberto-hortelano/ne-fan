/** LA ESPERA POR FOTOGRAMAS DEL BANCO TIENE UN SOLO DUEÑO (#606).
 *
 *  El invariante NO es «no leas `fps().frames`»: es que **el molde de esperar N
 *  fotogramas no vuelva a copiarse**. Estaba escrito a mano dieciséis veces, con
 *  dos nombres (`esperarFrames`, `frames`, `esperarUnosFrames`), cuatro
 *  redacciones y dos cortafuegos distintos (10 s y 20 s) que nadie eligió, y
 *  nueve de esas copias leían su línea base con `fps()?.frames ?? 0` — así que
 *  con el hook ausente un instante la espera se cumplía con la PRIMERA muestra.
 *  Nueve esperas que podían salir verdes sin haber esperado nada.
 *
 *  Este candado va en DOS niveles, y la razón de que sean dos está medida:
 *
 *  ── NIVEL DURO, sin exenciones ────────────────────────────────────────────
 *  Ningún fichero salvo `qa/lib/fotogramas.mjs` puede DEFINIR un helper de
 *  espera por fotogramas: una función cuyo trabajo entero sea leer el contador y
 *  esperar a que suba. Es el molde que se copiaba, y entra a CERO ocupantes.
 *
 *  Por qué el detector mira la FORMA y no el nombre: el censo con el que se
 *  abrió esta tanda buscaba `esperarFrames` y `frames` y decía **quince**. Eran
 *  **dieciséis**: el guion 34 tenía la misma función llamada
 *  `esperarUnosFrames`, con el mismo `?? 0` en la base. Un candado por nombre
 *  habría nacido verde con una copia delante.
 *
 *  ── NIVEL CENSO, con contrato ─────────────────────────────────────────────
 *  Toda espera cuyo PREDICADO lea un contador de fotogramas sale del helper o
 *  está en `data/contract/esperas-por-fotogramas.json` con su motivo. Existe
 *  porque el nivel duro, solo, deja escribible la copia INLINE — y eso es
 *  exactamente cómo se escribió la copia que el censo no vio. Las exenciones de
 *  hoy no son deuda, y van por CLASES y sin número —aquí decía «las seis» con
 *  siete en el contrato, que es la forma exacta de mentir que este módulo vino
 *  a retirar (#659, 2026-09-18); cuántas hay lo dice el contrato, que es quien
 *  no puede quedarse desfasado—: unas tienen el contador como SUJETO (afirmar
 *  que el renderer sigue pintando), otra necesita un cortafuegos mayor que el
 *  unificado, otra es una espera CONDUCIDA en segundos de mundo con otro dueño,
 *  y otra está fuera de alcance con issue vivo (#673, el guion 15).
 *
 *  Y DESDE #611 LA CLASE SE DERIVA DONDE SE PUEDE, en vez de creerse: el
 *  contrato marca cada clase como `derivada` o `declarada`, y las derivadas se
 *  cruzan con el árbol —«cortafuegos mayor» ⇔ la pared del sitio es mayor que
 *  `CORTAFUEGOS_MS` del dueño; «conducida en sim» ⇔ el sitio lleva `{sim}`—.
 *  «Contador es el sujeto» NO se puede derivar y hay un caso que lo MIDE: el
 *  predicado de `fixtures-las-tres` y el de una copia prohibida del molde son
 *  el mismo árbol. La vía `issue` lleva número y la comprueba contra GitHub el
 *  headless `qa/la-exencion-por-issue-tiene-issue-vivo.mjs`. La clave del censo
 *  pasó a ser `fichero :: desc` (antes solo el fichero, y una exención
 *  bendecía cualquier espera por fotogramas del fichero entero); con ella
 *  salió a la luz que el `desc` apuntado del 142 no era el suyo: este detector
 *  leía `arguments[0]` para los tres verbos, y en `holdUntil` eso es la tecla.
 *
 *  ── LO QUE NO CUBRE, dicho aquí y no en prosa suelta ──────────────────────
 *  Las LECTURAS de `fps().frames` que no son el predicado de una espera
 *  (`qa/fixtures-sin-bridge.mjs`, `qa/presupuesto-de-volumenes.mjs`,
 *  `qa/captura-de-fixture.mjs`, `qa/guiones/34`, `qa/guiones/79`): ahí el
 *  contador se lee y se afirma, no se espera por él. `fixtures-sin-bridge` es el
 *  caso claro — su sujeto ES ese contador—, y migrarlo borraría su medida.
 *
 *  Probado en negativo el 2026-09-17: restaurando a mano cada una de las CUATRO
 *  redacciones que había (las de los guiones 16, 44, 37 y 34) el nivel duro se
 *  pone rojo, y con una espera inline nueva sin apuntar se pone rojo el censo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";
import { descDe, funcionesDelFichero, lecturasDelHook, presupuestoDe, verboDe } from "./lecturas-del-predicado.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRATO = join(repoRoot, "nefan-core", "data", "contract", "esperas-por-fotogramas.json");
/** El ÚNICO fichero al que le está permitido definir esta espera. */
const DUENO = "qa/lib/fotogramas.mjs";
/** El cortafuegos del dueño, leído del dueño (dirección test → banco, como
 *  `parada-de-qa.test.ts`): «cortafuegos mayor» se deriva contra ESTE número. */
const { CORTAFUEGOS_MS } = (await import(join(repoRoot, "qa", "lib", "fotogramas.mjs"))) as { CORTAFUEGOS_MS: number };

const CLASE_ISSUE = "issue";

/** El mismo listón que `esperas-que-conducen.json` (#611): `.strict()`, clase
 *  obligatoria, `issue` con número, `_lo_que_esto_NO_sujeta` obligatorio, y el
 *  `desc` LITERAL como clave. `linea_orientativa` se fue: un número que
 *  caduca sin avisar. */
export const ContratoSchema = z
  .object({
    _comment: z.string().min(1),
    _lo_que_esto_NO_sujeta: z.string().min(1),
    /** clase → si el test la DERIVA del árbol o solo queda declarada. */
    clases: z.record(z.string().min(1), z.enum(["derivada", "declarada"])),
    exentos: z
      .array(
        z
          .object({
            fichero: z.string().regex(/^qa\/[\w./-]+\.mjs$/),
            desc: z.string().min(3),
            clase: z.string().min(1),
            issue: z.number().int().positive().optional(),
            porque: z.string().min(120, "el motivo es una FRASE que dice por qué no es el molde, no una etiqueta"),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (CLASE_ISSUE in c.clases) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clases", CLASE_ISSUE], message: "`issue` no es una clase del mapa: se sujeta con el estado del issue" });
    }
    c.exentos.forEach((e, i) => {
      const ruta = ["exentos", i];
      if (e.clase !== CLASE_ISSUE && !(e.clase in c.clases)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...ruta, "clase"], message: `clase desconocida «${e.clase}»: ${Object.keys(c.clases).join(", ")}, o \`issue\`` });
      }
      if (e.clase === CLASE_ISSUE && e.issue === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...ruta, "issue"], message: "una exención por issue lleva su NÚMERO: sin él no hay nada que pueda caducar" });
      }
      if (e.clase !== CLASE_ISSUE && e.issue !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...ruta, "issue"], message: `\`issue\` solo acompaña a la clase \`issue\`; ésta es «${e.clase}»` });
      }
    });
  });

/** Los verbos de espera del banco. Los tres, no solo `waitFor`: `holdUntil` y
 *  `expectEspera` también llevan predicado, y un candado que mirase uno solo
 *  dejaría los otros dos abiertos. */
const VERBOS = /(^|\.)(waitFor|expectEspera|holdUntil)$/;

/** ¿Lee este subárbol un CONTADOR DE FOTOGRAMAS? Son los tres que existen:
 *  `fps().frames` (el del renderer, que sube en toda vuelta del loop),
 *  `reloj().frames` (el del MUNDO, que solo sube cuando el sim avanza) y
 *  `reloj().loop`. Se mira el AST y no el texto: `window.__nefan.fps()?.frames`
 *  y `window.__nefan.fps().frames` son la misma lectura escrita de dos formas, y
 *  las dos estaban en el árbol. */
function contadorDeFotogramas(n: ts.Node, sf: ts.SourceFile): string | null {
  let hallado: string | null = null;
  const visita = (x: ts.Node): void => {
    if (hallado) return;
    if (ts.isPropertyAccessExpression(x) && (x.name.text === "frames" || x.name.text === "loop")) {
      let base: ts.Node = x.expression;
      if (ts.isNonNullExpression(base)) base = base.expression;
      if (/\b(fps|reloj)\(\)$/.test(base.getText(sf).trim())) hallado = `${base.getText(sf)}.${x.name.text}`;
    }
    ts.forEachChild(x, visita);
  };
  visita(n);
  return hallado;
}

export interface EsperaDeFotogramas {
  fichero: string;
  linea: number;
  verbo: string;
  desc: string;
  contador: string;
  /** El nombre de la función-helper que la envuelve, si la función existe SOLO
   *  para esperar fotogramas. `null` = espera inline dentro de otra cosa. */
  helper: string | null;
  /** Presupuesto de PARED del sitio en ms (literal o `{ms: N}`; `null` si es
   *  una expresión) y si lleva `{sim}`: de aquí se derivan «cortafuegos mayor»
   *  y «conducida en sim» (#611). */
  pared: number | null;
  conSim: boolean;
  /** Las claves del hook que lee el predicado, para medir lo que NO se deriva. */
  lecturas: string[];
}

/** El nombre bajo el que se declara una función, sea `function f(){}`,
 *  `const f = () => {}` o `const f = async function(){}`. */
function nombreDeLaFuncion(fn: ts.Node, sf: ts.SourceFile): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;
  const padre = fn.parent;
  if (padre && ts.isVariableDeclaration(padre) && ts.isIdentifier(padre.name)) return padre.name.text;
  if (padre && ts.isPropertyAssignment(padre) && ts.isIdentifier(padre.name)) return padre.name.text;
  void sf;
  return null;
}

/** ¿Es `fn` un HELPER de espera por fotogramas, o sea una función cuyo trabajo
 *  ENTERO es esperar a que el contador suba?
 *
 *  El criterio es de forma y está medido contra las cuatro redacciones que
 *  había: la función recibe el número de fotogramas por PARÁMETRO y todas las
 *  llamadas de su cuerpo son la espera misma —leer la base (`page.evaluate`,
 *  `ctx.nefan`), el verbo de espera y lo que va dentro de su predicado—. Una
 *  función que además mide, mueve al jugador o afirma algo NO es el molde: es
 *  una espera inline, y de ésas se encarga el nivel censo. */
function esHelperDeEspera(fn: ts.SignatureDeclaration, sf: ts.SourceFile, espera: ts.CallExpression): boolean {
  if (fn.parameters.length === 0) return false;
  // Alguno de sus parámetros tiene que ser el número de fotogramas: sin él, la
  // función no es un molde reutilizable sino una espera concreta.
  const params = fn.parameters.map((p) => p.name.getText(sf));
  if (!params.some((p) => /^(n|frames|nFrames|cuantos)$/.test(p))) return false;
  const cuerpo = (fn as ts.FunctionLikeDeclaration).body;
  if (!cuerpo) return false;
  // Lo que SÍ forma parte de la espera: leer la base (`page.evaluate`,
  // `ctx.nefan`), el verbo, y la lectura del contador mismo (`fps()`, `reloj()`)
  // dondequiera que caiga. Las dos últimas hacen falta y está medido: sin ellas
  // el nivel duro dejaba pasar DOS de las cuatro redacciones —las del gemelo
  // `frames(ctx, n)` y `esperarUnosFrames(ctx, n)`, que leen su base con
  // `page.evaluate(() => window.__nefan.fps()?.frames ?? 0)`— porque el `fps()`
  // de dentro contaba como «trabajo ajeno». Nueve de las dieciséis copias eran
  // de esa forma: el candado habría nacido cazando siete.
  const OTRAS = /(^|\.)(evaluate|nefan|waitFor|expectEspera|holdUntil|fps|reloj)$/;
  let ajena = false;
  const visita = (x: ts.Node): void => {
    if (ajena) return;
    // Lo que va DENTRO del verbo de espera es su predicado: no cuenta.
    if (x === espera) return;
    if (ts.isCallExpression(x) && !OTRAS.test(x.expression.getText(sf))) ajena = true;
    ts.forEachChild(x, visita);
  };
  ts.forEachChild(cuerpo, visita);
  return !ajena;
}

/** Todas las esperas por fotogramas de un fichero del banco. */
export function esperasPorFotogramas(texto: string, fichero: string): EsperaDeFotogramas[] {
  const sf = ts.createSourceFile(fichero, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fuera: EsperaDeFotogramas[] = [];
  const funciones = funcionesDelFichero(sf);
  /** El contador que lee este argumento, siguiéndolo si es una REFERENCIA a una
   *  función del fichero. */
  const contadorDelArgumento = (a: ts.Node): string | null => {
    const directo = contadorDeFotogramas(a, sf);
    if (directo) return directo;
    if (ts.isIdentifier(a)) {
      const fn = funciones.get(a.text);
      if (fn) return contadorDeFotogramas(fn, sf);
    }
    return null;
  };
  /** La función que ENVUELVE a `n`, la más interior. */
  const envoltura = (n: ts.Node): ts.SignatureDeclaration | null => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)) {
        // Una arrow que sea el PREDICADO de la espera no envuelve nada: se sigue
        // subiendo hasta la función de verdad.
        if (ts.isArrowFunction(p) && p.parent && ts.isCallExpression(p.parent) && VERBOS.test(p.parent.expression.getText(sf))) {
          continue;
        }
        return p;
      }
    }
    return null;
  };
  const visita = (n: ts.Node): void => {
    const verbo = ts.isCallExpression(n) && VERBOS.test(n.expression.getText(sf)) ? verboDe(n) : null;
    if (ts.isCallExpression(n) && verbo !== null) {
      for (const a of n.arguments) {
        const contador = contadorDelArgumento(a);
        if (!contador) continue;
        const fn = envoltura(n);
        const helper = fn && esHelperDeEspera(fn, sf, n) ? nombreDeLaFuncion(fn, sf) : null;
        const { pared, conSim } = presupuestoDe(n, verbo);
        fuera.push({
          fichero,
          linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          verbo: n.expression.getText(sf),
          desc: descDe(n, verbo, sf),
          contador,
          helper,
          pared,
          conSim,
          lecturas: lecturasDelHook(ts.isIdentifier(a) ? (funciones.get(a.text) ?? a) : a),
        });
        break;
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return fuera;
}

/** TODO `qa/**.mjs`, la misma travesía que `esperas-que-conducen.test.ts`: un
 *  candado que mira media carpeta cubre media casa. */
const ficherosDelBanco = (dir = join(repoRoot, "qa")): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      return e.name === "node_modules" || e.name.startsWith(".") ? [] : ficherosDelBanco(join(dir, e.name));
    }
    return e.name.endsWith(".mjs") ? [join(dir, e.name).slice(repoRoot.length + 1)] : [];
  });

/** EL PARSE VA FUERA DEL `describe`, Y NO ES ESTILO (#611, medido al probar el
 *  candado en negativo). Con `node --test` v24.11.1, un `describe` cuyo cuerpo
 *  LANZA se anota `✖` en el listado y sale con **`ℹ fail 0` y código de salida
 *  0**: la suite entera desaparece (`tests 0`) y `npm test` queda VERDE. O sea
 *  que el zod de este contrato —que es quien exige el número del issue y
 *  rechaza lo retirado— no podía poner rojo el build desde dentro del
 *  `describe`. Fuera, el throw es de MÓDULO y da `fail 1` con salida 1.
 *  Reproducido en un fichero de tres líneas sin nada del repo. */
const contrato = ContratoSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const encontradas = ficherosDelBanco().flatMap((f) =>
  esperasPorFotogramas(readFileSync(join(repoRoot, f), "utf8"), f),
);

describe("la espera por fotogramas del banco tiene UN dueño (#606)", () => {

  it("NIVEL DURO · solo `qa/lib/fotogramas.mjs` DEFINE un helper de espera por fotogramas", () => {
    const copias = encontradas.filter((e) => e.helper !== null && e.fichero !== DUENO);
    assert.deepEqual(
      copias.map((e) => `${e.fichero}:${e.linea} · ${e.helper}(…) · ${e.contador}`),
      [],
      `Ese molde estaba copiado DIECISÉIS veces y las copias divergieron sin que nadie lo decidiera ` +
        `(dos cortafuegos, cuatro redacciones, y nueve con la línea base degradando a 0). El dueño es ` +
        `\`${DUENO}\`: importa \`esperaDeFotogramas\` y declara su reloj en una línea ` +
        `(\`const esperarFrames = esperaDeFotogramas("mundo" | "loop")\`). Este nivel NO tiene ` +
        `exenciones: si tu espera no cabe en el helper, lo que cambia es el helper.`,
    );
  });

  /** `fichero :: desc`, como en `esperas-que-conducen.json`: una exención
   *  apunta a UNA espera, no al fichero entero. */
  const clave = (e: { fichero: string; desc: string }): string => `${e.fichero} :: ${e.desc}`;
  const exentos = new Set(contrato.exentos.map(clave));

  it("NIVEL CENSO · toda espera por fotogramas sale del dueño o está apuntada con su motivo", () => {
    const sinExcusa = encontradas.filter((e) => e.fichero !== DUENO && !exentos.has(clave(e)));
    assert.deepEqual(
      sinExcusa.map((e) => `${e.fichero}:${e.linea} · ${e.verbo}(${e.desc}) · ${e.contador}`),
      [],
      `Una espera por fotogramas escrita a mano es la forma en que este molde se copió dieciséis ` +
        `veces. Si de verdad no es el molde —porque el CONTADOR es su sujeto, porque necesita un ` +
        `cortafuegos mayor, o porque es una espera conducida en segundos de mundo—, apúntala en ` +
        `data/contract/esperas-por-fotogramas.json con su DESCRIPCIÓN literal, su CLASE y su motivo escrito.`,
    );
  });

  it("y cada exención sigue teniendo sujeto vivo: la que sobra CADUCA y se borra", () => {
    // Una exención cuya espera ya no existe miente, y una exención que miente es
    // peor que no tenerla: nadie vuelve a mirarla.
    const conSujeto = new Set(encontradas.map(clave));
    const caducadas = [...exentos].filter((k) => !conSujeto.has(k));
    assert.deepEqual(caducadas, [], `exención sin espera que eximir (bórrala del contrato): ${caducadas.join(" | ")}`);
  });

  // ── LA DERIVACIÓN (#611): la clase se cruza con el árbol donde se puede ──
  /** Qué demuestra cada clase `derivada`, sobre lo que el detector leyó del
   *  sitio. Las claves de este mapa tienen que ser EXACTAMENTE las clases
   *  marcadas `derivada` en el contrato (hay aserto): una clase nueva marcada
   *  derivada sin código aquí no sería derivada, sería creída. */
  const derivaciones: Record<string, (e: EsperaDeFotogramas) => string | null> = {
    "cortafuegos mayor": (e) =>
      e.pared !== null && e.pared > CORTAFUEGOS_MS ? null : `pared ${e.pared ?? "(no literal)"} no es mayor que CORTAFUEGOS_MS=${CORTAFUEGOS_MS}`,
    "conducida en sim": (e) => (e.conSim ? null : "el sitio no lleva `{sim}`"),
  };

  it("las clases marcadas `derivada` son exactamente las que este test sabe derivar", () => {
    const derivadas = Object.entries(contrato.clases).filter(([, v]) => v === "derivada").map(([k]) => k).sort();
    assert.deepEqual(derivadas, Object.keys(derivaciones).sort());
    assert.ok(derivadas.length > 0, "sin ninguna clase derivada este bloque no sujeta nada");
  });

  it("cada exención de clase derivada la DERIVA el sitio: pared > cortafuegos, o `{sim}` presente", () => {
    const porClave = new Map(encontradas.map((e) => [clave(e), e]));
    const sinPrueba: string[] = [];
    for (const e of contrato.exentos) {
      const deriva = derivaciones[e.clase];
      const espera = porClave.get(clave(e));
      if (!deriva || !espera) continue; // declarada, issue, o ya marcada «caduca»
      const pega = deriva(espera);
      if (pega !== null) sinPrueba.push(`${e.fichero}:${espera.linea} declara «${e.clase}» y ${pega}`);
    }
    assert.deepEqual(sinPrueba, [], "la clase de una exención la demuestra el SITIO, no su prosa");
  });

  it("lo que esto NO sujeta, medido: la clase declarada es INDISTINGUIBLE de una copia del molde", () => {
    // «Contador es el sujeto» no se deriva de nada, y aquí está por qué: el
    // predicado honesto de `fixtures-las-tres` («el renderer emite frames») y
    // una copia prohibida del molde son EL MISMO ÁRBOL para el detector y para
    // `lecturasDelHook`. Si algún día se distinguen, este caso se pone rojo:
    // entonces la clase pasa a `derivada`, se le escribe su derivación arriba
    // y se borra el párrafo (1) de `_lo_que_esto_NO_sujeta`.
    const honesta = `await ctx.waitFor(\`\${fixture} · el renderer emite frames\`, (n) => window.__nefan.fps().frames > n + 5, 10_000, f0);`;
    const copiaDelMolde = `await ctx.waitFor("pasan cinco fotogramas", (n) => window.__nefan.fps().frames > n + 5, 10_000, f0);`;
    const [a] = esperasPorFotogramas(honesta, "qa/de-mentira.mjs");
    const [b] = esperasPorFotogramas(copiaDelMolde, "qa/de-mentira.mjs");
    assert.deepEqual(
      [a.contador, a.pared, a.conSim, a.lecturas, a.helper],
      [b.contador, b.pared, b.conSim, b.lecturas, b.helper],
      "si ya se distinguen, cerraste el agujero (1): pasa la clase a derivada y borra este caso",
    );
    assert.deepEqual(a.lecturas, ["fps"]);
    // Y el (2): una pared escrita como constante no se deriva (sale `null`).
    const constante = `await ctx.waitFor("avanza", (n) => window.__nefan.fps().frames > n + 60, maxMs, f0);`;
    assert.equal(esperasPorFotogramas(constante, "qa/de-mentira.mjs")[0].pared, null);
  });

  it("el detector lee el presupuesto y la descripción DEL VERBO que toca (el `desc` del 142 era la tecla)", () => {
    const material = `
      await ctx.holdUntil("up", "el mundo avanza mientras se consulta", t => window.__nefan.reloj().frames >= t + 30, { sim: 5 }, r);
      await ctx.waitFor("el bucle avanza 60 fotogramas", (d) => ((window.__nefan.fps()?.frames ?? 0) >= d + 60 ? { ok: true } : null), 30_000, desde);
      await ctx.expectEspera("pinta", true, (f) => window.__nefan.reloj().loop > f, { ms: 4_000 });`;
    assert.deepEqual(
      esperasPorFotogramas(material, "qa/de-mentira.mjs").map((e) => [e.desc, e.pared, e.conSim]),
      [
        ['"el mundo avanza mientras se consulta"', null, true],
        ['"el bucle avanza 60 fotogramas"', 30_000, false],
        ['"pinta"', 4_000, false],
      ],
    );
  });

  it("el zod cierra la vía «issue» por su número y no admite lo retirado", () => {
    const base = JSON.parse(readFileSync(CONTRATO, "utf8"));
    const con = (cambio: (c: typeof base) => void): boolean => {
      const c = structuredClone(base);
      cambio(c);
      return ContratoSchema.safeParse(c).success;
    };
    assert.ok(con(() => {}));
    const la15 = base.exentos.findIndex((e: { clase: string }) => e.clase === "issue");
    assert.ok(la15 >= 0, "el contrato real tiene una exención por issue (la del 15, #673)");
    assert.ok(!con((c) => { delete c.exentos[la15].issue; }), "«issue» sin número");
    assert.ok(!con((c) => { c.exentos[0].issue = 673; }), "número con clase declarada");
    assert.ok(!con((c) => { c.exentos[0].clase = "otra"; }), "clase fuera del mapa");
    assert.ok(!con((c) => { c.clases["otra"] = "derivable"; }), "marca que no es derivada|declarada");
    assert.ok(!con((c) => { c.exentos[0].linea_orientativa = 69; }), "`linea_orientativa` no vuelve");
    assert.ok(!con((c) => { delete c._lo_que_esto_NO_sujeta; }), "sin `_lo_que_esto_NO_sujeta`");
  });

  it("el dueño existe, define la espera, y lee la base sin degradarla", () => {
    // Que el candado tenga SUJETO VIVO: si mañana alguien borra el helper, los
    // dos niveles de arriba saldrían VERDES sobre un banco sin dueño ninguno —
    // cero copias porque no queda nada que copiar. Se comprueba sobre la fuente
    // del dueño y NO con el detector, y la razón es la frontera de abajo.
    const fuente = readFileSync(join(repoRoot, DUENO), "utf8");
    assert.match(fuente, /export function esperaDeFotogramas\(reloj\)/);
    // El `?? 0` de la BASE es el defecto que traían nueve copias. Dentro del
    // sondeo, «todavía no hay hook» sí es volver a mirar, y eso se escribe
    // devolviendo `null`, nunca un cero.
    //
    // Se mira el CÓDIGO y no el fichero entero: el docblock del dueño cita el
    // defecto con su texto exacto para explicar por qué existe, y un candado
    // sobre el texto crudo se pone rojo por la explicación. Primera versión de
    // este aserto: roja, y por eso mismo.
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      codigo,
      /(fps|reloj)\(\)\??\.\w+\s*\?\?\s*0/,
      "la línea base no puede degradar a 0: con base 0 la espera se cumple con la primera muestra",
    );
  });

  it("LA FRONTERA DEL DETECTOR, medida: no ve el predicado que lee el contador por un campo DINÁMICO", () => {
    // Esto no es una excusa escrita a posteriori: es el resultado de correrlo
    // contra el árbol. El detector sigue el predicado aunque llegue por
    // referencia (`ctx.waitFor(desc, pasaronLosFotogramas, …)`), pero busca un
    // acceso `.frames`/`.loop` sobre `fps()` o `reloj()`, y el dueño lee
    // `lectura[a.campo]` tras dos alias — precisamente porque el campo es lo que
    // el guion elige. Resultado: el dueño NO sale en su propio censo.
    //
    // Qué significa y qué NO: una copia escrita como se escribieron las
    // dieciséis —campo literal— se caza, y eso está probado en negativo con las
    // CUATRO redacciones que existían. Una copia escrita con campo dinámico se
    // escaparía, y para eso está este aserto: para que el agujero esté MEDIDO y
    // con número, y no descubierto dentro de un año por un guion en verde.
    const suyas = encontradas.filter((e) => e.fichero === DUENO);
    assert.deepEqual(
      suyas.map((e) => `${e.fichero}:${e.linea}`),
      [],
      `Si el dueño EMPIEZA a salir en su propio censo, el detector ha cambiado de alcance: revisa ` +
        `que los dos niveles de arriba sigan excluyéndolo y borra esta frontera, que ya no sería cierta.`,
    );
  });
});
