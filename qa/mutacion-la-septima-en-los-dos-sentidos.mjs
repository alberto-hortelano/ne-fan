#!/usr/bin/env node
/** La séptima condición, ¿sabe si pudo mirar EN LOS DOS SENTIDOS?
 *
 *  Vive fuera de `qa/guiones/` por el mismo motivo que sus dos hermanos
 *  (`mutacion-candados-en-negativo.mjs`, `mutacion-cableado-en-negativo.mjs`):
 *  `qa/run.mjs` carga TODO `.mjs` de esa carpeta y lo conduce contra un
 *  navegador con el preset `e2e-sin-creditos` levantado, y aquí no hay nada que
 *  un jugador pueda mirar. Levantar el stack entero para no pulsar una tecla no
 *  es un guion, es una espera.
 *
 *  POR QUÉ EXISTE (QA de #599, 2026-09-15). La PR de #599 arregla que la
 *  séptima condición se disparara POR CONSTRUCCIÓN cuando la corrida BASE medía
 *  con `coverageAnalysis: "off"` y no podía emitir `NoCoverage` jamás. El
 *  arreglo es correcto y se puede ver rojo. Pero la pregunta que da nombre al
 *  candado —«la condición sabe si pudo mirar»— tiene DOS sentidos, y la PR solo
 *  contesta uno:
 *
 *    · la BASE no podía expresar `NoCoverage`  → CUBIERTO (censo, no vota)
 *    · la corrida NUEVA no puede expresarlos   → NO CUBIERTO (bloque A)
 *
 *  Y el bloque que IMPRIME todo esto (`imprimeSinEjercer`) no lo mira ningún
 *  test ni ninguno de los dos arneses: se puede borrar entero y los tres siguen
 *  verdes (medido; bloques B y C).
 *
 *  Cómo funciona: llama a las funciones REALES —`veredictoDeAdopcion`,
 *  `titularDeSinEjercer`, `comparaEnSeco`— con material sintético, captura lo
 *  que imprimen y exige lo que un lector necesita poder creerse. No lanza
 *  Stryker, no llama a `npm run mutate` ni a `local`, y NO TOCA `reports/`: su
 *  directorio base de ensayo vive en el temporal del sistema. Cero créditos.
 *
 *    node qa/mutacion-la-septima-en-los-dos-sentidos.mjs
 *
 *  Verde = la séptima condición sabe si pudo mirar en los dos sentidos, y lo
 *  que el bloque promete imprimir se imprime.
 *  Rojo = hay una dirección en la que afirma algo que no puede saber.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");
const TMP = mkdtempSync(join(tmpdir(), "nefan-septima-"));
const HUELLA = join(CORE, "scripts", "mutacion-huella.js");
const COMPARAR = join(CORE, "scripts", "mutacion-comparar.js");

/** El informe base de ensayo: un solo mutante, y su INSTRUMENTO —el par runner
 *  + ajuste— es lo único que se mueve entre un bloque y otro. Los dos campos,
 *  porque la capacidad de emitir `NoCoverage` no la decide ninguno por su
 *  cuenta: `command`+`off` no podía, `tap`+`off` sí (QA de #597, H-1), y
 *  `comparar` se niega a leer un informe al que le falte cualquiera de los dos. */
const informe = (estado, cobertura, runner = "command") =>
  JSON.stringify({
    files: {
      "src/x.ts": {
        mutants: [
          {
            id: "1",
            mutatorName: "BooleanLiteral",
            replacement: "x",
            status: estado,
            location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
          },
        ],
      },
    },
    config: { coverageAnalysis: cobertura, testRunner: runner },
  });

const DIR_BASE = join(TMP, "base");
spawnSync("mkdir", ["-p", DIR_BASE]);
// La base del bloque B/C es la REAL de #443: runner `command` con el análisis
// apagado, el único par que de verdad no podía emitir `NoCoverage`.
writeFileSync(join(DIR_BASE, "m.json"), informe("Survived", "off", "command"));

const PROBE = join(TMP, "probe.ts");
writeFileSync(
  PROBE,
  `
import { movimientosSinEjercer, totalSinEjercer, titularDeSinEjercer, veredictoDeAdopcion } from ${JSON.stringify(HUELLA)};
import { comparaEnSeco } from ${JSON.stringify(COMPARAR)};

const F = "src/x.ts";
const out: string[] = [];

// ── A · EL SENTIDO REVERSO ───────────────────────────────────────────────────
// La base midió con \`perTest\` (CAPAZ) y tenía N \`NoCoverage\`. La corrida NUEVA
// no trae ni uno porque mide con \`off\`, que no puede emitirlos JAMÁS. O sea: el
// instrumento nuevo perdió la capacidad de separar \`NoCoverage\` de \`Survived\`
// y mide ESTRICTAMENTE MENOS. Y \`esVivo\` colapsa los dos estados, así que las
// condiciones 1 y 2 (nuevos / resueltos) no pueden verlo: esos N mutantes
// siguen "vivos" antes y después.
const h = Array.from({ length: 1122 }, (_, i) => \`h\${i}\`);
const filaReversa = movimientosSinEjercer(F, { sabe: true, huellas: h }, []);
const tReversa = totalSinEjercer([filaReversa]);
const vReversa = veredictoDeAdopcion(
  [{ fichero: F, base: "con base", vivos: h, nuevos: [], yaEstaban: h, resueltos: [], total: 2000 }] as never,
  { esperados: [F], completa: true, mueveTag: true, sinEjercer: [filaReversa], codigoCambiado: [] } as never,
);
out.push(JSON.stringify({
  bloque: "A",
  titular: titularDeSinEjercer(tReversa),
  adopta: vReversa.adopta,
  porque: vReversa.porque,
}));

// ── B y C · lo que el bloque PROMETE imprimir ────────────────────────────────
// Base \`off\` (incapaz) con un \`NoCoverage\` en la corrida de ahora: es el caso
// real de #443, y lo que tiene que salir es el CENSO rotulado con su puntero a
// #598 y el titular \`⊘ NO SE PUDO MIRAR\` — nunca un \`✔\`.
const lineas: string[] = [];
const real = console.log;
console.log = (...a: unknown[]) => { lineas.push(a.map(String).join(" ")); };
try {
  comparaEnSeco({
    corrida: { run_id: "ensayo", sha: "0".repeat(40), desde: "0".repeat(40), origen: "explicito", completa: true, mueveTag: true, porque: "ensayo" },
    modulos: [{ modulo: "m", ficheros: [{ fichero: F, base: "con base", vivos: [], nuevos: [], yaEstaban: [], resueltos: [], total: 1 }] }],
    ahora: { [F]: { timeouts: [], sinEjercer: ["hA"], medidos: ["hA"] } },
    base: { [F]: { vivos: [], mismoCodigo: true } },
    codigoCambiado: [],
    revBase: "HEAD",
    esperados: [F],
    dirBase: ${JSON.stringify(DIR_BASE)},
    coberturaAhora: "tap+perTest",
  } as never);
} finally {
  console.log = real;
}
const texto = lineas.join("\\n");
out.push(JSON.stringify({ bloque: "BC", texto }));
real(out.join("\\n"));
`,
);

const r = spawnSync("npx", ["tsx", PROBE], { cwd: CORE, encoding: "utf8", timeout: 300000 });
const salida = `${r.stdout ?? ""}`;
if (r.status !== 0 || salida.trim() === "") {
  console.error("✖ el probe no llegó a correr:\n", r.stderr ?? "");
  rmSync(TMP, { recursive: true, force: true });
  process.exit(2);
}
const filas = salida
  .trim()
  .split("\n")
  .filter((l) => l.startsWith("{"))
  .map((l) => JSON.parse(l));
const A = filas.find((f) => f.bloque === "A");
const BC = filas.find((f) => f.bloque === "BC");
rmSync(TMP, { recursive: true, force: true });

const fallos = [];
const comprueba = (nombre, ok, detalle) => {
  console.log(`${ok ? "🟢 verde" : "🔴 ROJO "}  ${nombre}`);
  if (!ok) {
    console.log(`     ${detalle}`);
    fallos.push(nombre);
  }
};

console.log("\nLa séptima condición, en los DOS sentidos\n" + "─".repeat(70));

// ── A ────────────────────────────────────────────────────────────────────────
comprueba(
  "A1 · con la corrida NUEVA incapaz de emitir `NoCoverage`, no se afirma «no mide menos»",
  !/no mide menos/.test(A.titular),
  `el titular afirma lo que no puede saber: «${A.titular}»\n` +
    `     la base tenía 1122 \`NoCoverage\` y la corrida nueva trae 0 porque mide con \`off\`:\n` +
    `     el instrumento nuevo mide ESTRICTAMENTE MENOS y la frase dice lo contrario.`,
);
comprueba(
  "A2 · y esa adopción NO sale autorizada",
  A.adopta === false,
  `veredicto: SE PUEDE ADOPTAR sobre un instrumento que perdió la cobertura.\n` +
    `     \`esVivo\` colapsa \`Survived\` y \`NoCoverage\`, así que las condiciones 1 y 2 NO lo cruzan:\n` +
    `     los 1122 siguen "vivos" antes y después. porque: ${A.porque}`,
);

// ── B ────────────────────────────────────────────────────────────────────────
comprueba(
  "B1 · el CENSO se imprime rotulado como censo",
  /CENSO \(no es condición\)/.test(BC.texto),
  "con la base incapaz el bloque tiene que imprimir el censo ENTERO y rotulado, no solo su número",
);
// El puntero se busca DENTRO del párrafo del censo, no en toda la salida: el
// `porque` de un veredicto que adopta también cita #598 (`mutacion-huella.ts`),
// así que un `/#598/` sobre el texto entero pasaría en verde con el puntero del
// censo borrado. Medido: esa primera versión de esta comprobación no se
// enteraba de la rotura, que es justo el defecto que este fichero reporta.
const parrafoCenso = /CENSO \(no es condición\)[\s\S]*?(?=\n\n|$)/.exec(BC.texto)?.[0] ?? "";
comprueba(
  "B2 · y el censo lleva su puntero a #598 EN SU PROPIO PÁRRAFO",
  /#598/.test(parrafoCenso),
  "sin el puntero, el censo es un número sin sitio al que ir: es la evidencia de la que sale #598",
);

// ── C ────────────────────────────────────────────────────────────────────────
comprueba(
  "C1 · con la base incapaz el titular dice ⊘ NO SE PUDO MIRAR",
  /NO SE PUDO MIRAR/.test(BC.texto),
  "el titular es la frase que #599 encontró SIN SUJETO: si no se imprime, vuelve a no decirse nada",
);
comprueba(
  "C2 · y NUNCA sale un ✔ «ningún mutante ha dejado de ser ejercido»",
  !/✔ ningún mutante ha dejado de ser ejercido/.test(BC.texto),
  "un ✔ con la base incapaz es exactamente el verde que no comprueba nada",
);

console.log("─".repeat(70));
console.log(`Comprobaciones : 6\nEn rojo        : ${fallos.length}`);
for (const f of fallos) console.log(`   🔴 ${f}`);
console.log(
  fallos.length === 0
    ? "\n✔ la séptima condición sabe si pudo mirar en los dos sentidos"
    : "\n✖ hay un sentido en el que la séptima condición afirma lo que no puede saber",
);
process.exit(fallos.length === 0 ? 0 : 1);
