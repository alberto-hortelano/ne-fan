/** TODA ESPERA QUE CONDUCE AL JUGADOR PRESUPUESTA EN SEGUNDOS DE MUNDO (#545).
 *
 *  `ctx.holdUntil(key, …)` mantiene una tecla pulsada y `ctx.expectEspera(…,
 *  {tecla})` hace lo mismo: las dos CONDUCEN al jugador y esperan a que el juego
 *  progrese. El jugador avanza por el `delta` del game loop, topado en 0,1 s por
 *  frame (`nefan-html/src/main.ts`), así que bajo carga avanza menos metros por
 *  segundo de RELOJ aunque su velocidad no haya cambiado: un presupuesto de
 *  pared —«0,5 m en 8 s»— deja de ser un cortafuegos y pasa a ser la condición
 *  de parada, que es exactamente lo que #545 vino a arreglar.
 *
 *  PR-4a dio el mecanismo (`{sim: N}` en `qa/lib/sonda.mjs`) pero lo dejó
 *  OPCIONAL, y su propio informe lo dijo: «quien escriba `4_000` mañana sigue
 *  midiendo en pared y nada se lo impide». Esto es lo que se lo impide, y lo
 *  hace **en CI**: la batería de navegador no corre en ningún job, así que un
 *  candado que solo salte al ejecutar el guion no para nada hasta que alguien se
 *  acuerda de correrlo. `qa/run.mjs` lanza además, en tiempo de ejecución, el
 *  fail-loud de `holdUntil`; los dos hacen falta y ninguno sustituye al otro.
 *
 *  **SE LEE EL ÁRBOL, NO EL TEXTO**, por el mismo motivo por el que lo hace
 *  `qa-lib-tiene-quien-lo-mire.test.ts` (#454, H1 de QA): con regex, el fuente
 *  que `qa/lib/invariantes-en-negativo.mjs` lleva DENTRO DE UN STRING —guiones
 *  de mentira escritos para salir rojos, con sus `holdUntil(…, 6000, …)`—
 *  contaría como violación, y la salida habría sido eximir el fichero: cegar a
 *  la regla justo el sitio donde se escriben esperas. Un string es un string.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { descDe, funcionesDelFichero, lecturasDelHook, nombresDelHook, predicadoDe, verboDe } from "./lecturas-del-predicado.js";
import { fuentesDelBanco } from "./banco-ficheros.js";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const CONTRATO = join(core, "data", "contract", "esperas-que-conducen.json");
/** De donde salen los nombres que el mapa `clases` puede citar. Se LEE; no se
 *  toca: el cliente no cambia una línea por este candado. */
const HOOK = join(repoRoot, "nefan-html", "src", "dev", "nefan-hook.ts");

/** La clase que no deriva ninguna lectura: la espera queda fuera por un issue
 *  ABIERTO, y quien lo comprueba es `qa/la-exencion-por-issue-tiene-issue-vivo.mjs`
 *  (job `candados-headless`), porque `npm test` no tiene red. */
const CLASE_ISSUE = "issue";

/** UNA EXENCIÓN NO SE CREE: SE DERIVA (#611). El campo que decide es `clase`, y
 *  `clases` dice qué lectura del hook demuestra cada una. Sobre el `porque`
 *  queda solo el mínimo de longitud: las tres capas de forma que había encima
 *  —la regex del proceso, las veinte palabras distintas, la tirada de ocho—
 *  cerraban la exención perezosa y NO la mentira elaborada (medido: 7 pass ·
 *  0 fail con el 58 pasado a `{ms}` y una excusa «bridge» en prosa plausible).
 *  Se retiran en vez de acumularse: la derivación sujeta el sujeto, y una capa
 *  que ya no decide nada es otro sitio donde mentir. */
export const EsperasQueConducenSchema = z
  .object({
    _comment: z.string().min(1),
    /** Obligatoria (patrón de `sondas-de-movimiento.json`): lo que sigue
     *  abierto, dicho aquí y medido abajo, no en prosa suelta. */
    _lo_que_esto_NO_sujeta: z.string().min(1),
    /** clase → claves del hook que la DEMUESTRAN. Cada nombre tiene que existir
     *  en `nefan-hook.ts` (hay test); `issue` no puede ser una clase del mapa. */
    clases: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)),
    exentos: z
      .array(
        z
          .object({
            fichero: z.string().regex(/^qa\/(guiones|lib)\/[\w.-]+\.mjs$/, "una exención nombra un `.mjs` del banco"),
            /** El texto LITERAL de la descripción de ESA espera, tal y como está
             *  escrito en el fuente (con sus comillas o sus backticks). Apunta a
             *  una y no ciega el fichero entero, que es donde viven las otras. */
            desc: z.string().min(3),
            /** A QUIÉN se espera, como CLASE derivable: una clave de `clases`, o
             *  `issue`. */
            clase: z.string().min(1),
            /** Solo con `clase: "issue"`, y entonces obligatorio: el número del
             *  issue ABIERTO que sostiene la exención. */
            issue: z.number().int().positive().optional(),
            /** Una FRASE que diga por qué no cabía en sim. No verifica verdad:
             *  eso lo hace la derivación de `clase`. */
            porque: z.string().min(120, "el motivo es una FRASE que dice por qué no cabía, no una etiqueta"),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (CLASE_ISSUE in c.clases) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clases", CLASE_ISSUE], message: "`issue` no es una clase derivable: se sujeta con el estado del issue, no con una lectura" });
    }
    c.exentos.forEach((e, i) => {
      const ruta = ["exentos", i];
      if (e.clase !== CLASE_ISSUE && !(e.clase in c.clases)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...ruta, "clase"], message: `clase desconocida «${e.clase}»: las derivables son ${Object.keys(c.clases).join(", ")}, o \`issue\`` });
      }
      if (e.clase === CLASE_ISSUE && e.issue === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...ruta, "issue"], message: "una exención por issue lleva su NÚMERO: sin él no hay nada que pueda caducar" });
      }
      if (e.clase !== CLASE_ISSUE && e.issue !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...ruta, "issue"], message: `\`issue\` solo acompaña a la clase \`issue\`; ésta es «${e.clase}» y la deriva el predicado` });
      }
    });
  });

/** Un sitio de llamada que conduce al jugador y NO presupuesta en sim. */
export type EsperaDePared = {
  fichero: string;
  linea: number;
  verbo: string;
  desc: string;
  presupuesto: string;
  /** Las claves del hook que lee su PREDICADO (`window.__nefan.X`), inline o
   *  por referencia a una función del fichero. Es lo que deriva la `clase` de
   *  una exención (#611). */
  lecturas: string[];
  /** El nombre de la referencia cuando el predicado llega por un identificador
   *  que NO decide una sola función (declarado dos veces, o reasignado). Con
   *  esto puesto, `lecturas` va VACÍA a propósito: derivar por el candidato que
   *  el mapa dejó arriba es adivinar, y adivinando salía verde una mentira
   *  (H-2 de la QA). */
  refAmbigua: string | null;
  /** El nombre de la referencia cuando NO se declara en este fichero: viene
   *  importada (de `qa/lib`, por ejemplo). No es ambigua, es que no está — y el
   *  rojo tiene que decir esa salida y no las otras tres (H-8 de la re-QA). */
  refSinResolver: string | null;
};

/** Los sitios de `texto` en los que una espera que CONDUCE se presupuesta en
 *  pared. Lee el AST, en las **tres** formas que tiene el defecto:
 *
 *  1. `ctx.holdUntil(k, desc, fn, PRESUPUESTO, arg)` sin `{sim}`;
 *  2. `ctx.expectEspera(desc, debe, fn, {…})` con `tecla` y sin `sim`;
 *  3. **`ctx.waitFor(desc, fn, PARED)` CON UNA TECLA MANTENIDA**, que es la
 *     forma en la que #545 se encontró y la que la primera versión de este
 *     candado no veía (QA, H-2): corrido contra los guiones 91, 86 y 109 de
 *     `main` —los tres que tenían el defecto— decía **0 sitios**. O sea que
 *     prohibía escribirlo con el verbo que el propio arreglo estrenó y lo
 *     dejaba escribible con el verbo con el que estaba escrito. La pregunta de
 *     cabecera —¿puede ponerse verde sin que ocurra lo que promete?— tenía un
 *     «sí» con los tres defectuosos delante.
 *
 *  Para la tercera se mira si, EN ORDEN DE FUENTE dentro de la misma función,
 *  hay una tecla pulsada sin soltar todavía cuando llega la espera: `press` /
 *  `keyboard.down` la levantan y `release` / `releaseAll` / `keyboard.up` la
 *  bajan. Es exactamente el patrón del 91 de ayer (press → waitFor → `finally`
 *  releaseAll), y no marca la espera de un guion que pulsó una tecla en su
 *  bloque 1 y la soltó antes del 5.
 *
 *  ── LA FRONTERA REAL, Y VA POR LA TERCERA VEZ QUE SE DECLARA MAL ──────────
 *  El estado del teclado se sigue por el ANIDAMIENTO LÉXICO —la función que
 *  envuelve a la espera y las de fuera—, **no por el grafo de llamadas**. Así
 *  que lo que este detector no ve es: **tecla pulsada en el LLAMANTE y espera
 *  dentro de un helper**, porque el helper no está léxicamente dentro de quien
 *  pulsó. Lo tiene el `veredictoDe` del guion 133, que espera en pared con la
 *  tecla puesta y no se marca. (Las dos fronteras que se declararon antes eran
 *  falsas: ni es «`page.keyboard.down`» —eso lo ve desde H-2— ni es «conducir
 *  desde dentro de `page.evaluate`», que no existe en el árbol.)
 *
 *  **POR QUÉ NO SE EXTIENDE AQUÍ, y está medido**: seguir el grafo de llamadas
 *  dentro del fichero marca **9 sitios en 8 ficheros**, y **8 de los 9 son el
 *  mismo helper** —`frames(ctx, n)` en los guiones 37, 43, 58, 83, 86, 109 y
 *  112—, que espera a que el bucle avance N FOTOGRAMAS. Ésa es una espera por
 *  el reloj del juego contada en frames, o sea lo contrario del defecto: su
 *  presupuesto de pared es el cortafuegos y no la condición. Extender el
 *  detector por «hay una tecla puesta» compraría ocho exenciones de esperas
 *  correctas y ni un defecto, que es como un candado deja de mirarse. El eje
 *  que separa de verdad no es quién pulsó la tecla, es **si el PREDICADO de la
 *  espera lee el progreso del jugador** (`state().pos`) o cuenta un tic del
 *  juego. Eso es otro detector y va a issue; el agujero de hoy queda declarado
 *  y MEDIDO abajo, en su propio caso, para que no vuelva a ser prosa. */
export function esperasDeParedQueConducen(texto: string, fichero: string): EsperaDePared[] {
  const sf = ts.createSourceFile(fichero, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fuera: EsperaDePared[] = [];
  const linea = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const funciones = funcionesDelFichero(sf);
  /** Lo que lee el predicado de esta espera y si su referencia era ambigua.
   *  `[]` si no hay predicado, si la referencia no se resuelve en el fichero, o
   *  si el nombre no decide una función sola. */
  const delPredicado = (n: ts.CallExpression): { lecturas: string[]; refAmbigua: string | null; refSinResolver: string | null } => {
    const v = verboDe(n);
    if (v === null) return { lecturas: [], refAmbigua: null, refSinResolver: null };
    const pred = predicadoDe(n, v, funciones);
    if (pred.ambigua) return { lecturas: [], refAmbigua: pred.referencia, refSinResolver: null };
    const vistas: string[] = [];
    for (const nodo of pred.nodos) for (const l of lecturasDelHook(nodo)) if (!vistas.includes(l)) vistas.push(l);
    const sinResolver = pred.referencia !== null && pred.nodos.length === 0 ? pred.referencia : null;
    return { lecturas: vistas, refAmbigua: null, refSinResolver: sinResolver };
  };
  /** Texto de la llamada, para reconocer los verbos del teclado escritos de las
   *  dos maneras: `ctx.nefan("inputDriver.press", "up")` y
   *  `ctx.page.keyboard.down("w")`. */
  const gestoDeTecla = (n: ts.CallExpression): "pulsa" | "suelta" | null => {
    const t = n.expression.getText(sf);
    const a0 = n.arguments[0];
    const arg0 = a0 !== undefined && ts.isStringLiteralLike(a0) ? a0.text : "";
    if (/\.keyboard\.down$/.test(t) || /inputDriver\.press$/.test(arg0 || t)) return "pulsa";
    if (/\.keyboard\.up$/.test(t) || /inputDriver\.release(All)?$/.test(arg0 || t)) return "suelta";
    return null;
  };
  /** La función que ENVUELVE a `n`, o el fichero entero si no hay ninguna. Es la
   *  unidad dentro de la que se mira «¿había una tecla pulsada?»: fuera de ella
   *  el estado del teclado ya no se puede seguir leyendo el orden del fuente. */
  const funcionDe = (n: ts.Node): ts.Node => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isMethodDeclaration(p)) {
        // Una arrow de una línea (`() => ctx.waitFor(…)`, el molde de
        // `ctx.absorbe`) NO es la unidad: la tecla la pulsa quien la envuelve.
        if (ts.isArrowFunction(p) && !ts.isBlock(p.body)) continue;
        return p;
      }
    }
    return sf;
  };
  /** Posiciones de los gestos de teclado, por función. */
  const gestos = new Map<ts.Node, { pos: number; gesto: "pulsa" | "suelta" }[]>();
  const apunta = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const g = gestoDeTecla(n);
      if (g) {
        const f = funcionDe(n);
        if (!gestos.has(f)) gestos.set(f, []);
        gestos.get(f)!.push({ pos: n.getStart(sf), gesto: g });
      }
    }
    ts.forEachChild(n, apunta);
  };
  apunta(sf);
  /** ¿Hay una tecla mantenida cuando se llega a `n`? Se mira en la función que
   *  lo envuelve y en las de fuera: el `waitFor` del 91 vive dentro de una arrow
   *  de bloque que le pasa `ctx.absorbe`, y la tecla la pulsó su envolvente. */
  const conTeclaMantenida = (n: ts.Node): boolean => {
    for (let f: ts.Node | undefined = funcionDe(n); f; f = f === sf ? undefined : funcionDe(f)) {
      const g = (gestos.get(f) ?? []).filter((x) => x.pos < n.getStart(sf)).sort((a, b) => a.pos - b.pos);
      if (g.length && g[g.length - 1].gesto === "pulsa") return true;
    }
    return false;
  };
  /** Los nombres de las propiedades de un objeto literal, incluida la forma
   *  abreviada (`{ sim, arg }`), que es como la escribe el guion 06. */
  const claves = (o: ts.ObjectLiteralExpression): string[] =>
    o.properties
      .map((pr) => (pr.name && ts.isIdentifier(pr.name) ? pr.name.text : null))
      .filter((k): k is string => k !== null);
  const visita = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const verbo = n.expression.name.text;
      if (verbo === "holdUntil") {
        // El presupuesto es el 4º argumento, y lo único que vale es un objeto
        // con `sim`. Un número, una constante, su AUSENCIA o un `{ms: N}` de
        // pared declarada son, cada uno a su manera, un presupuesto de reloj de
        // máquina sobre el progreso del jugador: el `{ms}` no es un descuido y
        // por eso puede eximirse con motivo, pero pasa por aquí igual.
        const p = n.arguments[3];
        const conSim = p !== undefined && ts.isObjectLiteralExpression(p) && claves(p).includes("sim");
        if (!conSim) {
          fuera.push({
            fichero,
            linea: linea(n),
            verbo,
            desc: descDe(n, "holdUntil", sf),
            presupuesto: p ? p.getText(sf) : "(sin presupuesto)",
            ...delPredicado(n),
          });
        }
      }
      if (verbo === "expectEspera") {
        const o = n.arguments[3];
        const k = o && ts.isObjectLiteralExpression(o) ? claves(o) : [];
        const conSim = k.includes("sim");
        // Con `tecla` conduce por sí misma; sin ella, conduce igual si hay una
        // tecla mantenida desde fuera (el patrón de los guiones 86 y 109).
        if (!conSim && (k.includes("tecla") || conTeclaMantenida(n))) {
          fuera.push({
            fichero,
            linea: linea(n),
            verbo,
            desc: descDe(n, "expectEspera", sf),
            presupuesto: o ? `{${k.join(", ")}}` : "(sin opciones)",
            ...delPredicado(n),
          });
        }
      }
      if (verbo === "waitFor" && conTeclaMantenida(n)) {
        // LA TERCERA FORMA, y la que #545 tenía escrita: la tecla se mantiene
        // aparte y se espera con `waitFor`. El presupuesto es el 3er argumento.
        const p = n.arguments[2];
        const conSim = p !== undefined && ts.isObjectLiteralExpression(p) && claves(p).includes("sim");
        if (!conSim) {
          fuera.push({
            fichero,
            linea: linea(n),
            verbo,
            desc: descDe(n, "waitFor", sf),
            presupuesto: p ? p.getText(sf) : "(sin presupuesto)",
            ...delPredicado(n),
          });
        }
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return fuera;
}

/** TODO `qa/**.mjs`, no solo `guiones` y `lib`. La primera versión miraba esas
 *  dos carpetas y dejaba fuera 14 sitios en 5 ficheros (QA, H-2) — uno de ellos
 *  `qa/fixtures-las-tres-se-caminan.mjs`, con el presupuesto más apretado de la
 *  batería («0,5 m en 8.000 ms de pared»). Un candado que mira media carpeta
 *  cubre media casa. El barrido es EL del banco (`banco-ficheros.ts`, #704):
 *  aquí solo se filtra. */
const mjsDelBanco = (): string[] =>
  fuentesDelBanco(join(repoRoot, "qa"))
    .map((f) => `qa/${f}`)
    // `qa/run.mjs` DEFINE `waitFor` y `holdUntil`: sus cuerpos no son sitios de
    // llamada, son el verbo. Es el único fichero excluido y se dice cuál.
    .filter((f) => f !== "qa/run.mjs");

/** EL PARSE VA FUERA DEL `describe`, Y NO ES ESTILO (#611, medido al probar el
 *  candado en negativo). Con `node --test` v24.11.1, un `describe` cuyo cuerpo
 *  LANZA se anota `✖` en el listado y sale con **`ℹ fail 0` y código de salida
 *  0**: la suite entera desaparece (`tests 0`) y `npm test` queda VERDE. O sea
 *  que el zod de este contrato no podía poner rojo el build desde dentro del
 *  `describe`. Fuera, el throw es de MÓDULO y da `fail 1` con salida 1.
 *  Reproducido en un fichero de tres líneas sin nada del repo. */
const contrato = EsperasQueConducenSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const clave = (e: { fichero: string; desc: string }): string => `${e.fichero} :: ${e.desc}`;
const exentos = new Set(contrato.exentos.map(clave));
const encontradas = mjsDelBanco().flatMap((f) =>
  esperasDeParedQueConducen(readFileSync(join(repoRoot, f), "utf8"), f),
);

/** POR QUÉ no deriva esta espera, dicho con LA SALIDA DE ESTE CASO y no con una
 *  lista de las que existen. Vive fuera del `it` porque el mensaje es parte de
 *  lo que el candado promete y por tanto hay que poder MEDIRLO: la re-QA (H-8)
 *  midió el rojo de la fricción K —predicado importado de `qa/lib`— y era
 *  exacto («lee NADA del hook») y a la vez inútil, porque ninguna de las tres
 *  salidas que enumeraba el aserto era la suya. */
export function porQueNoDeriva(espera: EsperaDePared): string {
  if (espera.refAmbigua !== null) {
    return (
      `llega por la referencia AMBIGUA \`${espera.refAmbigua}\` —ese nombre tiene más de un vínculo en el fichero ` +
      `(otra declaración, un parámetro, un destructuring) o se reasigna—, y por ahí no se deriva por adivinanza: ` +
      `dale un nombre que solo sea suyo`
    );
  }
  if (espera.refSinResolver !== null) {
    return (
      `llega por la referencia \`${espera.refSinResolver}\`, que NO se declara en este fichero: ¿viene importada de ` +
      `\`qa/lib\`? Tráela al guion, o lee el hook dentro del predicado — es la fricción del párrafo (2) de ` +
      `\`_lo_que_esto_NO_sujeta\``
    );
  }
  if (espera.lecturas.length) return `lee ${espera.lecturas.join(", ")}`;
  return (
    `lee NADA del hook: si lo alcanza por un ALIAS, por destructuring o por corchetes, léelo dentro del predicado ` +
    `(\`window.__nefan.X\`) — son las fricciones del párrafo (2) de \`_lo_que_esto_NO_sujeta\``
  );
}

/** Material escrito a mano → lo que la derivación leería de cada espera suya.
 *  Es el instrumento con el que se MIDEN los agujeros y las fricciones de
 *  `_lo_que_esto_NO_sujeta`, y con el que se comprobó el banco adversarial que
 *  QA escribió aparte al validar esta tanda. */
const lecturasDe = (texto: string): string[][] =>
  esperasDeParedQueConducen(texto, "qa/guiones/de-mentira.mjs").map((v) => v.lecturas);
/** ¿Derivaría esa clase con esas lecturas? La misma cuenta que hace el test de
 *  la derivación, para poder preguntarla sobre material de mentira. */
const derivaria = (lecturas: string[], clase: string): boolean =>
  lecturas.some((l) => contrato.clases[clase].includes(l));

describe("las esperas que conducen al jugador presupuestan en sim (#545)", () => {

  it("ningún guion conduce al jugador con un presupuesto de PARED", () => {
    const sinExcusa = encontradas.filter((e) => !exentos.has(clave(e)));
    assert.deepEqual(
      sinExcusa.map((e) => `${e.fichero}:${e.linea} · ${e.verbo}(…, ${e.presupuesto})`),
      [],
      `El jugador avanza por el delta del game loop, no por el reloj de la máquina: el presupuesto ` +
        `son SEGUNDOS DE MUNDO (\`{sim: N}\`). Si el SUJETO de la espera es otro proceso (el bridge, el ` +
        `disco), la salida es apuntarla en data/contract/esperas-que-conducen.json con su descripción, su ` +
        `CLASE (que el predicado tiene que derivar) y su motivo escrito — nunca quitar este test.`,
    );
  });

  it("y cada exención sigue teniendo sujeto: la que sobra CADUCA y se borra", () => {
    // Una exención cuya espera ya no existe (o ya pasó a sim) miente, y una
    // exención que miente es peor que no tenerla: nadie vuelve a mirarla.
    const conSujeto = new Set(encontradas.map(clave));
    const caducadas = [...exentos].filter((k) => !conSujeto.has(k));
    assert.deepEqual(caducadas, [], `exención(es) sin sujeto (bórralas): ${caducadas.join(" | ")}`);
  });

  // ── LA DERIVACIÓN (#611): una exención no se cree, se deriva ─────────────
  /** TODAS las esperas que caen bajo cada clave, no la última. La versión
   *  anterior era `new Map(encontradas.map(e => [clave(e), e]))`, y un `Map`
   *  construido así se queda con **la última**: con dos esperas del mismo
   *  fichero bajo el mismo `desc`, la derivación miraba una y eximía las dos.
   *  QA lo midió metiendo en el 05 una espera de PARED con el `desc` de la
   *  exención honesta y el predicado de la mentira N17b: **12 ✔ · 0 ✖**, o sea
   *  la mentira entera en verde sin tocar el contrato (H-1). */
  const porClave = new Map<string, EsperaDePared[]>();
  for (const e of encontradas) {
    const k = clave(e);
    const ya = porClave.get(k);
    if (ya) ya.push(e);
    else porClave.set(k, [e]);
  }

  it("una exención apunta a UNA espera: dos con la misma clave la dejan sin decidir (H-1)", () => {
    // El `_comment` del contrato promete «apunta a UNA y no ciega el fichero
    // entero», y hasta esta corrección era falso: `exentos.has(clave)` eximía a
    // CUALQUIERA que compartiese texto. Ésta es la mitad que lo hace cierto; la
    // otra es derivar todas (abajo). Las dos, porque cada una tapa un flanco:
    // ésta dice el defecto con las dos líneas delante, y la otra no deja que
    // una mentira se cuele si algún día esta se relaja.
    const dobles = contrato.exentos
      .map((e) => ({ e, sitios: porClave.get(clave(e)) ?? [] }))
      .filter(({ sitios }) => sitios.length > 1)
      .map(({ e, sitios }) => `${clave(e)} → ${sitios.length} esperas, líneas ${sitios.map((s) => s.linea).join(", ")}`);
    assert.deepEqual(
      dobles,
      [],
      `Una exención tiene UN motivo, así que tiene que apuntar a UNA espera. Con dos esperas bajo la ` +
        `misma clave, el motivo escrito vale para una y bendice a la otra sin haberla mirado. La salida ` +
        `es que las descripciones sean distintas —que además es lo que el jugador del banco lee en la ` +
        `salida del guion—, nunca ampliar la exención.`,
    );
  });

  it("cada exención de clase derivable la DERIVA el predicado: lee algo del proceso que nombra", () => {
    // Éste es el candado que faltaba. Las tres capas de forma sobre el `porque`
    // cerraban la exención perezosa; la mentira ELABORADA —el 58 pasado a
    // `{ms}` con una excusa «bridge» en prosa plausible— pasaba 7 · 0. Aquí se
    // cruza lo que la exención AFIRMA (la clase) con lo que el predicado LEE
    // del hook, y una exención cuyo predicado no toca nada del proceso que
    // nombra sale roja con las lecturas que sí tiene delante.
    const sinPrueba: string[] = [];
    for (const e of contrato.exentos) {
      if (e.clase === CLASE_ISSUE) continue;
      const exige = contrato.clases[e.clase];
      // TODAS las esperas de esa clave, no la última: si la exención cubre dos
      // —cosa que el test de arriba ya prohíbe— las dos tienen que derivar.
      for (const espera of porClave.get(clave(e)) ?? []) {
        if (espera.lecturas.some((l) => exige.includes(l))) continue;
        sinPrueba.push(
          `${e.fichero}:${espera.linea} declara «${e.clase}» (exige leer ${exige.join(" o ")}) y su predicado ${porQueNoDeriva(espera)}`,
        );
      }
    }
    assert.deepEqual(
      sinPrueba,
      [],
      `La clase de una exención la demuestra su PREDICADO, no su prosa. Cuatro salidas, y cada rojo de ` +
        `arriba dice CUÁL es la suya: que el predicado lea algo del proceso al que dice esperar; que lo lea ` +
        `AQUÍ (si el predicado viene importado o alcanza el hook por un alias, la lectura no se ve y hay que ` +
        `traerla dentro); que la espera pase a \`{sim}\`; o que la clase sea \`issue\` con su número.`,
    );
  });

  it("cada lectura del mapa `clases` EXISTE en el hook (si no, el mapa no puede derivar nada)", () => {
    const hook = nombresDelHook(readFileSync(HOOK, "utf8"));
    // Control del control: si el lector del hook devolviera vacío, el aserto de
    // abajo saldría rojo en vez de verde-vacío.
    assert.ok(hook.has("scene") && hook.has("state") && hook.has("reloj"), `leo ${hook.size} clave(s) del hook: ¿cambió la forma de nefan-hook.ts?`);
    const fantasma = Object.entries(contrato.clases).flatMap(([c, ls]) => ls.filter((l) => !hook.has(l)).map((l) => `${c} → ${l}`));
    assert.deepEqual(fantasma, [], `clave(s) del mapa que nefan-hook.ts no tiene: ${fantasma.join(", ")}`);
  });

  it("LA MENTIRA ELABORADA (N17b) sale roja: el 58 en `{ms}` con excusa «bridge» lee `frontier`, no `scene`", () => {
    // El material literal del 58 (`58:181-186`) tal y como QA lo saboteó: la
    // tecla mantenida con `keyboard.down`, el presupuesto pasado a pared y una
    // exención «bridge» en prosa. `frontier` la escribe el CLIENTE en
    // `Frontera.tick` (`nefan-core/src/scene/frontera.ts`), no el bridge, así
    // que la derivación no encuentra `scene` y la exención no se sostiene.
    const el58 = `
      await ctx.page.keyboard.down("w");
      try {
        propuesta = await ctx.expectEspera(
          "caminar al este PROPONE explorar la zona vecina",
          true,
          () => window.__nefan.frontier.proposal ?? null,
          { ms: 120_000 },
        );
      } finally {
        await ctx.page.keyboard.up("w");
      }`;
    const [vista, ...mas] = esperasDeParedQueConducen(el58, "qa/guiones/de-mentira.mjs");
    assert.deepEqual(mas, []);
    assert.deepEqual(vista.lecturas, ["frontier"]);
    assert.ok(!vista.lecturas.some((l) => contrato.clases.bridge.includes(l)), "si `frontier` derivara «bridge», el mapa estaría mintiendo");
    // Y el control positivo del control: la honesta del 05, con la misma
    // forma, SÍ deriva «bridge» — y la TRAZA del 133, POR REFERENCIA, deriva
    // «game loop» aunque además lea `state().pos` (regla positiva).
    const el05 = `
      await ctx.holdUntil("up", "el jugador entra en el tile recién generado", (previos) => {
        const s = window.__nefan.scene;
        return s && !previos.includes(s.scene_id) ? s.scene_id : null;
      }, { ms: 180_000 }, []);`;
    assert.deepEqual(esperasDeParedQueConducen(el05, "qa/guiones/de-mentira.mjs").map((v) => v.lecturas), [["scene"]]);
    const el133 = `
      const TRAZA = (n) => {
        const p = window.__nefan.state().pos;
        const c = window.__nefan.reloj();
        return p && c ? [p, c] : null;
      };
      export default async function (ctx) {
        await ctx.nefan("inputDriver.press", "up");
        await ctx.waitFor("6 sondeos de traza con el loop pausado", TRAZA, 6_000, 6);
      }`;
    assert.deepEqual(esperasDeParedQueConducen(el133, "qa/guiones/de-mentira.mjs").map((v) => v.lecturas), [["state", "reloj"]]);
  });

  it("lo que esto NO sujeta, medido: (1) la lectura que NO DECIDE deriva; (2)(3) el alias sale sin lecturas", () => {
    // Cada caso es un agujero de `_lo_que_esto_NO_sujeta`, escrito como aserto
    // para que se ponga ROJO el día que alguien lo cierre — y entonces se borra
    // el caso y su párrafo del contrato, que es como caduca un agujero.
    // (1) NO es «la lectura muerta» y por eso este caso cambió con la QA (H-3):
    // decir «muerta» describía menos de lo que el agujero es y daba a entender
    // que bastaba con usar el resultado. El caso que un autor escribiría de
    // verdad es éste: `reloj()` VIVO en la primera mitad de un `&&`, y la
    // segunda —`frontier`, o sea el cliente— es la que manda. Deriva «game
    // loop» igual, porque la derivación mira QUÉ se lee, no qué decide.
    const noDecide = `
      await ctx.holdUntil("up", "anda",
        () => (window.__nefan.reloj().frames > 0 && window.__nefan.frontier.proposal) ? true : null,
        8_000, null);`;
    assert.ok(
      lecturasDe(noDecide)[0].some((l) => contrato.clases["game loop"].includes(l)),
      "si la lectura que no decide ya NO deriva «game loop», cerraste el agujero (1): borra este caso y su párrafo",
    );
    // …y su variante de lectura MUERTA del todo, que es el mismo agujero por
    // abajo: `scene` en una `const` sin usar, decidiendo por `playerPos`.
    const muerta = `
      await ctx.holdUntil("up", "anda", (a) => {
        const s = window.__nefan.scene;
        const p = window.__nefan.playerPos;
        return Math.hypot(p.x - a.x, p.z - a.z) > 0.4 ? p : null;
      }, 8_000, a);`;
    assert.ok(lecturasDe(muerta)[0].includes("scene"), "si la lectura muerta ya no deriva, borra también esta mitad");
    // (2) el alias FUERA del predicado (#686): cero lecturas → una exención
    // honesta escrita así sale roja (fricción, no agujero).
    const aliasFuera = `
      export default async function (ctx) {
        const s = window.__nefan.scene;
        await ctx.holdUntil("up", "anda", () => (s.scene_id !== "x" ? true : null), 8_000, null);
      }`;
    assert.deepEqual(lecturasDe(aliasFuera), [[]], "si el alias de fuera ya se sigue, cerraste (2): borra este caso y su párrafo");
    // (3) el alias DENTRO: `n.scene` no es `window.__nefan.scene` para el árbol.
    const aliasDentro = `
      await ctx.holdUntil("up", "anda", () => {
        const n = window.__nefan;
        return n.scene ? true : null;
      }, 8_000, null);`;
    assert.deepEqual(lecturasDe(aliasDentro), [[]], "si el alias de dentro ya se sigue, cerraste (3): borra este caso y su párrafo");
    // (4) la clave computada tampoco; la literal entre corchetes sí.
    const computada = `await ctx.holdUntil("up", "anda", (k) => (window.__nefan[k] ? true : null), 8_000, "scene");`;
    assert.deepEqual(lecturasDe(computada), [[]]);
    const literal = `await ctx.holdUntil("up", "anda", () => (window.__nefan["scene"] ? true : null), 8_000, null);`;
    assert.deepEqual(lecturasDe(literal), [["scene"]]);
  });

  // ── EL BANCO ADVERSARIAL DE QA (#611, tanda AE) ──────────────────────────
  // QA escribió dieciséis formas de espera —A…P— y preguntó a la derivación por
  // cada una: ¿cuál mentira NUEVA se cuela, y cuál honesta sale roja? Vivía en
  // un `.ts` suelto bajo `docs/agents/`, que es exactamente lo que #683 acaba
  // de prohibir: material ejecutable que nadie corre y que muere con el
  // worktree. Aquí están sus casos, con el veredicto de cada uno convertido en
  // aserto — los agujeros MIDIÉNDOSE (rojo el día que alguien los cierre), las
  // fricciones declarando la dirección, y las cazadas con la cuenta hecha.
  it("banco adversarial · lo que la derivación CAZA: la referencia ambigua, el comentario y el string", () => {
    // C · SOMBRA (H-2): el predicado llega por `pred` y el fichero declara DOS
    // `pred`; el que corre lee `frontier` y el de abajo lee `scene`. Antes de
    // la corrección de esta QA, el mapa se quedaba con el ÚLTIMO y la mentira
    // derivaba «bridge». Ahora la referencia es AMBIGUA y no deriva nada.
    const sombra = `
      export default async function (ctx) {
        const pred = () => window.__nefan.frontier.proposal ?? null;
        await ctx.holdUntil("up", "anda", pred, 8_000, null);
      }
      const pred = () => window.__nefan.scene ? true : null;`;
    const [cSombra] = esperasDeParedQueConducen(sombra, "qa/guiones/de-mentira.mjs");
    assert.deepEqual(cSombra.lecturas, [], "una referencia ambigua no deriva por adivinanza");
    assert.equal(cSombra.refAmbigua, "pred");
    assert.ok(!derivaria(cSombra.lecturas, "bridge"), "si «bridge» volviera a derivar aquí, H-2 está reabierto");
    // D · REASIGNACIÓN: `let pred = leeScene; pred = leeFrontier`. La
    // reasignación no es una declaración y no entraba en el mapa, así que la
    // derivación leía la PRIMERA — la que ya no corre.
    const reasignada = `
      let pred = () => window.__nefan.scene ? true : null;
      pred = () => window.__nefan.frontier.proposal ?? null;
      await ctx.holdUntil("up", "anda", pred, 8_000, null);`;
    const [cReasig] = esperasDeParedQueConducen(reasignada, "qa/guiones/de-mentira.mjs");
    assert.deepEqual(cReasig.lecturas, []);
    assert.equal(cReasig.refAmbigua, "pred");
    // M · la lectura de `scene` dentro de un COMENTARIO no cuenta, y N · dentro
    // de un STRING tampoco: es el motivo por el que esto lee el árbol (#454).
    const enComentario = `await ctx.holdUntil("up", "anda", () => /* window.__nefan.scene */ window.__nefan.frontier.proposal ?? null, 8_000, null);`;
    const enString = `await ctx.holdUntil("up", "anda", () => (console.log("window.__nefan.scene"), window.__nefan.frontier.proposal ?? null), 8_000, null);`;
    assert.deepEqual(lecturasDe(enComentario), [["frontier"]]);
    assert.deepEqual(lecturasDe(enString), [["frontier"]]);
    // J · y el control positivo del bloque: `globalThis.__nefan.scene` —la otra
    // manera legítima de alcanzar el hook— SÍ deriva. Sin esto, un lector roto
    // que devolviera siempre `[]` dejaría verdes los cuatro asertos de arriba.
    const conGlobalThis = `await ctx.holdUntil("up", "anda", () => globalThis.__nefan.scene ? true : null, 8_000, null);`;
    assert.deepEqual(lecturasDe(conGlobalThis), [["scene"]]);
    assert.ok(derivaria(lecturasDe(conGlobalThis)[0], "bridge"));
  });

  it("banco adversarial · Q y R: la sombra por PARÁMETRO y por DESTRUCTURING también son ambiguas", () => {
    // La re-QA (H-7) midió que la primera versión de la ambigüedad contaba
    // DECLARACIONES CON VALOR FUNCIÓN, no vínculos: un parámetro con el mismo
    // nombre, o un `const { pred } = …`, no aportaban candidato, así que el
    // único `const pred` de arriba —lector de `scene`— decidía la derivación
    // mientras el que CORRE llegaba por el parámetro. Los dos salían
    // `{ambigua: false, lecturas: ["scene"]}` y derivaban «bridge».
    // Q · el predicado que corre llega por el PARÁMETRO del helper.
    const porParametro = `
      const pred = () => window.__nefan.scene ? true : null;
      async function espera(ctx, pred) {
        await ctx.holdUntil("up", "anda", pred, 8_000, null);
      }
      export default async function (ctx) {
        await espera(ctx, () => window.__nefan.frontier.proposal ?? null);
      }`;
    const [q] = esperasDeParedQueConducen(porParametro, "qa/guiones/de-mentira.mjs");
    assert.deepEqual(q.lecturas, [], "Q: si vuelve a leer `scene`, H-7 está reabierto");
    assert.equal(q.refAmbigua, "pred");
    assert.ok(!derivaria(q.lecturas, "bridge"));
    // R · el predicado que corre llega por DESTRUCTURING.
    const porDestructuring = `
      const pred = () => window.__nefan.scene ? true : null;
      export default async function (ctx) {
        const { pred } = ctx.sondas;
        await ctx.holdUntil("up", "anda", pred, 8_000, null);
      }`;
    const [r] = esperasDeParedQueConducen(porDestructuring, "qa/guiones/de-mentira.mjs");
    assert.deepEqual(r.lecturas, [], "R: si vuelve a leer `scene`, H-7 está reabierto");
    assert.equal(r.refAmbigua, "pred");
    // …Y EL CONTROL, que es lo que impide que esto se haya arreglado marcando
    // ambigua a TODA referencia: la `TRAZA` del 133 tiene UN vínculo y sigue
    // derivando «game loop». Sin este aserto, `ambigua = true` a secas dejaría
    // los tres de arriba verdes y rompería la exención honesta del contrato.
    const traza = `
      const TRAZA = (n) => {
        const p = window.__nefan.state().pos;
        const c = window.__nefan.reloj();
        return p && c ? [p, c] : null;
      };
      export default async function (ctx) {
        await ctx.nefan("inputDriver.press", "up");
        await ctx.waitFor("6 sondeos de traza con el loop pausado", TRAZA, 6_000, 6);
      }`;
    const [honesta] = esperasDeParedQueConducen(traza, "qa/guiones/de-mentira.mjs");
    assert.equal(honesta.refAmbigua, null);
    assert.ok(derivaria(honesta.lecturas, "game loop"));
  });

  it("el rojo dice LA SALIDA DE ESE CASO, no la lista de las que existen (H-8)", () => {
    // El mensaje es parte de lo que el candado promete, así que se mide. La
    // re-QA lo cazó con la fricción K: el rojo era exacto y a la vez inútil.
    const importado = `
      import { tileLlego } from "../lib/tiles.mjs";
      await ctx.holdUntil("up", "anda", tileLlego, 8_000, null);`;
    const [k] = esperasDeParedQueConducen(importado, "qa/guiones/de-mentira.mjs");
    assert.equal(k.refSinResolver, "tileLlego", "la referencia no se declara aquí: no es ambigua, es que no está");
    assert.equal(k.refAmbigua, null);
    assert.match(porQueNoDeriva(k), /NO se declara en este fichero/);
    assert.match(porQueNoDeriva(k), /Tráela al guion, o lee el hook dentro del predicado/);
    assert.match(porQueNoDeriva(k), /párrafo \(2\)/);
    // Y las otras tres ramas, cada una con SU salida y ninguna con la ajena.
    const [amb] = esperasDeParedQueConducen(
      `const pred = () => window.__nefan.scene ? true : null;\nasync function f(ctx, pred) { await ctx.holdUntil("up", "anda", pred, 8_000, null); }`,
      "qa/guiones/de-mentira.mjs",
    );
    assert.match(porQueNoDeriva(amb), /referencia AMBIGUA `pred`/);
    assert.match(porQueNoDeriva(amb), /dale un nombre que solo sea suyo/);
    const [alias] = esperasDeParedQueConducen(
      `export default async function (ctx) {\n const s = window.__nefan.scene;\n await ctx.holdUntil("up", "anda", () => (s.scene_id ? true : null), 8_000, null);\n}`,
      "qa/guiones/de-mentira.mjs",
    );
    assert.match(porQueNoDeriva(alias), /lee NADA del hook: si lo alcanza por un ALIAS/);
    const [lee] = esperasDeParedQueConducen(
      `await ctx.holdUntil("up", "anda", () => window.__nefan.frontier.proposal ?? null, 8_000, null);`,
      "qa/guiones/de-mentira.mjs",
    );
    assert.equal(porQueNoDeriva(lee), "lee frontier");
  });

  it("banco adversarial · los AGUJEROS que sigue dejando pasar, medidos (bórralos al cerrarlos)", () => {
    // Los cuatro son la misma frase —«mira QUÉ se lee, no qué decide»— escrita
    // en cuatro sitios donde un autor podría ponerla sin querer o queriendo.
    // Cada `assert.ok` se pone ROJO el día que se cierre el agujero, y entonces
    // se borra el caso y su párrafo de `_lo_que_esto_NO_sujeta`.
    const agujeros: [string, string, string][] = [
      ["E · expresión coma: `(window.__nefan.scene, () => frontier)`", "bridge",
       `await ctx.holdUntil("up", "anda", (window.__nefan.scene, () => window.__nefan.frontier.proposal ?? null), 8_000, null);`],
      ["F · envoltorio: `elige(() => scene, () => frontier)` (se escanean TODOS sus argumentos)", "bridge",
       `await ctx.holdUntil("up", "anda", elige(() => window.__nefan.scene, () => window.__nefan.frontier.proposal ?? null), 8_000, null);`],
      ["O · parámetro por defecto: `(s = window.__nefan.scene) => frontier`", "bridge",
       `await ctx.holdUntil("up", "anda", (s = window.__nefan.scene) => window.__nefan.frontier.proposal ?? null, 8_000, null);`],
      ["P · código muerto tras el `return`", "bridge",
       `await ctx.holdUntil("up", "anda", () => { return window.__nefan.frontier.proposal ?? null; window.__nefan.scene; }, 8_000, null);`],
    ];
    const siguenAbiertos = agujeros.filter(([, clase, texto]) => derivaria(lecturasDe(texto)[0] ?? [], clase)).map(([n]) => n);
    assert.deepEqual(
      siguenAbiertos,
      agujeros.map(([n]) => n),
      `Si alguno ha dejado de derivar, ENHORABUENA: cerraste ese agujero. Bórralo de esta lista y del ` +
        `párrafo que le toca en \`_lo_que_esto_NO_sujeta\` — que es como caduca un agujero declarado.`,
    );
  });

  it("banco adversarial · las FRICCIONES: la honesta escrita así sale SIN lecturas, o sea roja", () => {
    // Dirección segura: ninguna deja pasar una mentira, todas ponen roja una
    // exención honesta. Por eso no son agujeros — pero se declaran, porque
    // quien las sufra tiene que poder saber por qué su exención cierta no
    // deriva. La salida siempre es la misma: leer el hook dentro del predicado.
    const fricciones: [string, string][] = [
      ["G · clave computada por concatenación: `window.__nefan[\"sc\"+\"ene\"]`",
       `await ctx.holdUntil("up", "anda", () => window.__nefan["sc"+"ene"] ? true : null, 8_000, null);`],
      ["H · el hook por corchetes: `window[\"__nefan\"].scene`",
       `await ctx.holdUntil("up", "anda", () => window["__nefan"].scene ? true : null, 8_000, null);`],
      ["I · destructuring dentro del predicado: `const { scene } = window.__nefan`",
       `await ctx.holdUntil("up", "anda", () => { const { scene } = window.__nefan; return scene ? true : null; }, 8_000, null);`],
      ["K · predicado importado de `qa/lib` (no se declara en este fichero)",
       `import { tileLlego } from "../lib/tiles.mjs";\n await ctx.holdUntil("up", "anda", tileLlego, 8_000, null);`],
      ["L · método de objeto por referencia: `sondas.tile`",
       `const sondas = { tile: () => window.__nefan.scene ? true : null };\n await ctx.holdUntil("up", "anda", sondas.tile, 8_000, null);`],
    ];
    const siguenSiendoFriccion = fricciones.filter(([, texto]) => (lecturasDe(texto)[0] ?? []).length === 0).map(([n]) => n);
    assert.deepEqual(
      siguenSiendoFriccion,
      fricciones.map(([n]) => n),
      `Si alguna ya deriva, el lector del hook ha crecido: bórrala de aquí y del párrafo de fricciones ` +
        `de \`_lo_que_esto_NO_sujeta\`.`,
    );
  });

  it("lo que el mapa `clases` NO sujeta: solo prohíbe nombres FANTASMA, no claves REALES de más", () => {
    // H-5 de la QA. El sabotaje que prueba el mapa cambia `scene` por `escena`,
    // o sea una clave que el hook no tiene. Pero añadir a `bridge` una clave
    // que el hook SÍ tiene —`playerPos`, `state`— haría derivar «bridge» a
    // cualquier espera del mundo, y ningún test lo ve: `clases` es el fichero
    // de POLÍTICA, y su guardia es el diff, igual que el de un umbral.
    const hook = nombresDelHook(readFileSync(HOOK, "utf8"));
    assert.ok(hook.has("playerPos"), "el caso se apoya en que `playerPos` es una clave real del hook");
    const mapaAflojado = { ...contrato.clases, bridge: [...contrato.clases.bridge, "playerPos"] };
    const cualquieraDelMundo = `await ctx.holdUntil("up", "anda", (a) => { const p = window.__nefan.playerPos; return p.x > a ? p : null; }, 8_000, 3);`;
    assert.ok(
      lecturasDe(cualquieraDelMundo)[0].some((l) => mapaAflojado.bridge.includes(l)),
      "si esto ya no derivara, el mapa habría dejado de ser pura política: cierra el agujero y borra el caso",
    );
    // …y el control: con el mapa REAL, esa misma espera no deriva «bridge».
    assert.ok(!derivaria(lecturasDe(cualquieraDelMundo)[0], "bridge"));
  });

  it("el zod cierra la vía «issue» por su número, y no deja `issue` en una clase derivable", () => {
    const base = JSON.parse(readFileSync(CONTRATO, "utf8"));
    const con = (cambio: (c: typeof base) => void): z.SafeParseReturnType<unknown, unknown> => {
      const c = structuredClone(base);
      cambio(c);
      return EsperasQueConducenSchema.safeParse(c);
    };
    assert.ok(con(() => {}).success, "el contrato real parsea");
    assert.ok(!con((c) => { c.exentos[0].clase = "issue"; }).success, "«issue» sin número");
    assert.ok(con((c) => { c.exentos[0].clase = "issue"; c.exentos[0].issue = 673; }).success, "«issue» con número");
    assert.ok(!con((c) => { c.exentos[0].issue = 673; }).success, "número con clase derivable");
    assert.ok(!con((c) => { c.exentos[0].clase = "asset-store"; }).success, "clase fuera del mapa");
    assert.ok(!con((c) => { c.clases.issue = ["scene"]; }).success, "`issue` como clase del mapa");
    assert.ok(!con((c) => { delete c._lo_que_esto_NO_sujeta; }).success, "sin `_lo_que_esto_NO_sujeta`");
    assert.ok(!con((c) => { c.exentos[0].sujeto = "el bridge"; }).success, "el campo de prosa retirado no vuelve");
  });

  it("el detector encuentra lo que dice encontrar (control positivo, en las dos formas)", () => {
    // Sin este caso, un detector roto —uno que no encontrara NADA— dejaría el
    // primer test en verde eternamente. Es el «verde que no comprueba nada» que
    // esta casa lleva trece apariciones cazando, y aquí se cierra midiendo el
    // detector contra material escrito a mano.
    const material = `
      await ctx.holdUntil("up", "anda", fn, 8_000, arg);
      await ctx.holdUntil("up", "anda", fn, { sim: 8 }, arg);
      await ctx.holdUntil("up", "anda", fn);
      await ctx.holdUntil("up", "el tile llega", fn, { ms: 180_000 }, arg);
      await ctx.expectEspera("anda", true, fn, { ms: 4_000, tecla: "up" });
      await ctx.expectEspera("anda", true, fn, { sim: 4, tecla: "up" });
      await ctx.expectEspera("anda", true, fn, { sim, arg, tecla: "up" });
      await ctx.expectEspera("no pasa", false, fn, { ms: 4_000 });
    `;
    const vistas = esperasDeParedQueConducen(material, "qa/guiones/de-mentira.mjs");
    assert.deepEqual(
      vistas.map((v) => `${v.verbo}:${v.presupuesto}:${v.desc}`),
      [
        'holdUntil:8_000:"anda"',
        'holdUntil:(sin presupuesto):"anda"',
        'holdUntil:{ ms: 180_000 }:"el tile llega"',
        'expectEspera:{ms, tecla}:"anda"',
      ],
      JSON.stringify(vistas),
    );
  });

  it("**y en la forma en la que #545 SE ENCONTRÓ**: tecla mantenida aparte + `waitFor` de pared", () => {
    // El agujero que QA midió (H-2): la primera versión de este detector veía
    // CERO sitios en los guiones 91, 86 y 109 de `main` —los tres que tenían el
    // defecto—, porque los tres mantenían la tecla aparte. O sea que prohibía
    // escribirlo con el verbo que el arreglo estrenó y lo dejaba escribible con
    // el verbo con el que estaba escrito. Éste es el material de los tres, con
    // sus dos maneras de pulsar y el `finally` que suelta.
    const comoEstabaEl91 = `
      async function empujarContra(ctx, centro, maxMs = 12_000) {
        await ctx.nefan("inputDriver.press", "up");
        try {
          return await ctx.absorbe("cortafuegos", () =>
            ctx.waitFor("el jugador anda y se para contra lo que tiene delante", pred, maxMs, centro));
        } finally {
          await ctx.nefan("inputDriver.releaseAll");
        }
      }
      async function andarHastaElMuro(ctx, borde, maxMs = 60_000) {
        await ctx.page.keyboard.down("w");
        try {
          await ctx.waitFor("el jugador se pega al muro", pred, maxMs, borde);
        } finally {
          await ctx.page.keyboard.up("w");
        }
      }`;
    assert.deepEqual(
      esperasDeParedQueConducen(comoEstabaEl91, "qa/guiones/de-mentira.mjs").map((v) => `${v.verbo}:${v.desc}`),
      [
        'waitFor:"el jugador anda y se para contra lo que tiene delante"',
        'waitFor:"el jugador se pega al muro"',
      ],
    );
  });

  it("…pero una espera DESPUÉS de soltar la tecla no conduce nada (si no, marcaría medio banco)", () => {
    // La otra dirección, y es la que hace que el detector sirva: un guion que
    // pulsa en su bloque 1, suelta, y espera al bridge en el 5 NO está
    // conduciendo al jugador. Sin este caso, el candado marcaría cualquier
    // espera de pared de cualquier guion que alguna vez haya andado.
    const sueltaYLuegoEspera = `
      export default async function (ctx) {
        await ctx.nefan("inputDriver.press", "up");
        await ctx.nefan("inputDriver.releaseAll");
        await ctx.waitFor("el bridge contesta", pred, 60_000);
        await ctx.page.keyboard.down("w");
        await ctx.page.keyboard.up("w");
        await ctx.waitFor("el save aparece en disco", pred, 30_000);
      }`;
    assert.deepEqual(esperasDeParedQueConducen(sueltaYLuegoEspera, "qa/guiones/de-mentira.mjs"), []);
    // Y con `{sim}` tampoco, con la tecla puesta: el control del control.
    const conSim = `
      export default async function (ctx) {
        await ctx.nefan("inputDriver.press", "up");
        await ctx.waitFor("el jugador anda", pred, { sim: 8 });
      }`;
    assert.deepEqual(esperasDeParedQueConducen(conSim, "qa/guiones/de-mentira.mjs"), []);
  });

  it("**el agujero DECLARADO, y medido: tecla en el llamante, espera en un helper → 0 sitios**", () => {
    // La frontera se ha declarado mal tres veces en esta PR («no ve
    // `keyboard.down`», «no ve conducir desde `page.evaluate`»), y las tres eran
    // agujeros que no existían. Ésta es la que sí: el estado del teclado se
    // sigue por anidamiento LÉXICO, y un helper no está dentro de quien lo
    // llama. Escrita como caso ejecutable en vez de como prosa, que es lo que
    // permite que se ponga ROJA el día que alguien la cierre — y entonces se
    // borra este caso, que es como caduca un agujero declarado.
    const teclaFuera = `
      async function esperaEnPared(ctx) {
        return ctx.waitFor("el jugador anda", pred, 8_000);
      }
      export default async function (ctx) {
        await ctx.nefan("inputDriver.press", "up");
        try {
          await esperaEnPared(ctx);
        } finally {
          await ctx.nefan("inputDriver.releaseAll");
        }
      }`;
    assert.deepEqual(
      esperasDeParedQueConducen(teclaFuera, "qa/guiones/de-mentira.mjs"),
      [],
      "si esto ya no está vacío, el detector cruzó la frontera léxica: borra este caso y su párrafo",
    );
    // Y el control del control: el MISMO material con la espera metida dentro
    // de la función que pulsa SÍ se marca. Sin esto, un detector roto dejaría
    // el caso de arriba verde diciendo lo que no es.
    const teclaDentro = `
      export default async function (ctx) {
        await ctx.nefan("inputDriver.press", "up");
        try {
          await ctx.waitFor("el jugador anda", pred, 8_000);
        } finally {
          await ctx.nefan("inputDriver.releaseAll");
        }
      }`;
    assert.deepEqual(
      esperasDeParedQueConducen(teclaDentro, "qa/guiones/de-mentira.mjs").map((v) => `${v.verbo}:${v.desc}`),
      ['waitFor:"el jugador anda"'],
    );
  });

  it("lo que va DENTRO DE UN STRING no es una llamada (por eso se lee el árbol)", () => {
    // `qa/lib/invariantes-en-negativo.mjs` lleva guiones de mentira escritos en
    // strings, con sus `holdUntil(…, 6000, …)`: con regex, este candado le
    // exigiría a la batería de negativos que no escribiera el defecto que su
    // trabajo es reproducir.
    const material = 'const guion = `  await ctx.holdUntil("up", "anda", fn, 6000, arg);\n`;';
    assert.deepEqual(esperasDeParedQueConducen(material, "qa/lib/de-mentira.mjs"), []);
  });
});
