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
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const CONTRATO = join(core, "data", "contract", "esperas-que-conducen.json");

const EsperasQueConducenSchema = z
  .object({
    _comment: z.string().min(1),
    exentos: z
      .array(
        z
          .object({
            fichero: z.string().regex(/^qa\/(guiones|lib)\/[\w.-]+\.mjs$/, "una exención nombra un `.mjs` del banco"),
            /** El texto LITERAL de la descripción de ESA espera, tal y como está
             *  escrito en el fuente (con sus comillas o sus backticks). Apunta a
             *  una y no ciega el fichero entero, que es donde viven las otras. */
            desc: z.string().min(3),
            /** Obligatorio: una exención sin motivo es una puerta abierta. */
            porque: z.string().min(120, "el motivo es una FRASE que dice por qué no cabía, no una etiqueta"),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** Un sitio de llamada que conduce al jugador y NO presupuesta en sim. */
export type EsperaDePared = { fichero: string; linea: number; verbo: string; desc: string; presupuesto: string };

/** Los sitios de `texto` en los que una espera que CONDUCE se presupuesta en
 *  pared. Lee el AST: `ctx.holdUntil(k, desc, fn, PRESUPUESTO, arg)` con
 *  presupuesto que no es un objeto, y `ctx.expectEspera(desc, debe, fn, {…})`
 *  con `tecla` y sin `sim`. */
export function esperasDeParedQueConducen(texto: string, fichero: string): EsperaDePared[] {
  const sf = ts.createSourceFile(fichero, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fuera: EsperaDePared[] = [];
  const linea = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
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
            desc: n.arguments[1]?.getText(sf) ?? "",
            presupuesto: p ? p.getText(sf) : "(sin presupuesto)",
          });
        }
      }
      if (verbo === "expectEspera") {
        const o = n.arguments[3];
        if (o && ts.isObjectLiteralExpression(o)) {
          const k = claves(o);
          if (k.includes("tecla") && !k.includes("sim")) {
            fuera.push({
              fichero,
              linea: linea(n),
              verbo,
              desc: n.arguments[0]?.getText(sf) ?? "",
              presupuesto: `{${k.join(", ")}}`,
            });
          }
        }
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return fuera;
}

const ficherosDelBanco = (): string[] =>
  ["guiones", "lib"].flatMap((d) =>
    readdirSync(join(repoRoot, "qa", d))
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => `qa/${d}/${f}`),
  );

describe("las esperas que conducen al jugador presupuestan en sim (#545)", () => {
  const contrato = EsperasQueConducenSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
  const clave = (e: { fichero: string; desc: string }): string => `${e.fichero} :: ${e.desc}`;
  const exentos = new Set(contrato.exentos.map(clave));
  const encontradas = ficherosDelBanco().flatMap((f) =>
    esperasDeParedQueConducen(readFileSync(join(repoRoot, f), "utf8"), f),
  );

  it("ningún guion conduce al jugador con un presupuesto de PARED", () => {
    const sinExcusa = encontradas.filter((e) => !exentos.has(clave(e)));
    assert.deepEqual(
      sinExcusa.map((e) => `${e.fichero}:${e.linea} · ${e.verbo}(…, ${e.presupuesto})`),
      [],
      `El jugador avanza por el delta del game loop, no por el reloj de la máquina: el presupuesto ` +
        `son SEGUNDOS DE MUNDO (\`{sim: N}\`). Si el SUJETO de la espera es otro proceso (el bridge, el ` +
        `disco), la salida es apuntarla en data/contract/esperas-que-conducen.json con su descripción y ` +
        `su motivo escrito — nunca quitar este test.`,
    );
  });

  it("y cada exención sigue teniendo sujeto: la que sobra CADUCA y se borra", () => {
    // Una exención cuya espera ya no existe (o ya pasó a sim) miente, y una
    // exención que miente es peor que no tenerla: nadie vuelve a mirarla.
    const conSujeto = new Set(encontradas.map(clave));
    const caducadas = [...exentos].filter((k) => !conSujeto.has(k));
    assert.deepEqual(caducadas, [], `exención(es) sin sujeto (bórralas): ${caducadas.join(" | ")}`);
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

  it("lo que va DENTRO DE UN STRING no es una llamada (por eso se lee el árbol)", () => {
    // `qa/lib/invariantes-en-negativo.mjs` lleva guiones de mentira escritos en
    // strings, con sus `holdUntil(…, 6000, …)`: con regex, este candado le
    // exigiría a la batería de negativos que no escribiera el defecto que su
    // trabajo es reproducir.
    const material = 'const guion = `  await ctx.holdUntil("up", "anda", fn, 6000, arg);\n`;';
    assert.deepEqual(esperasDeParedQueConducen(material, "qa/lib/de-mentira.mjs"), []);
  });
});
