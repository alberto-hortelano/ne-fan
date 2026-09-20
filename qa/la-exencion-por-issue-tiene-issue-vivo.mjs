#!/usr/bin/env node
/** LA EXENCIÓN «POR ISSUE» CADUCA CON EL ISSUE, NO CON UNA FECHA (#611).
 *
 *  Los dos contratos de esperas del banco —`esperas-que-conducen.json` y
 *  `esperas-por-fotogramas.json`— derivan la clase de cada exención del árbol
 *  de sintaxis (`nefan-core/test/lecturas-del-predicado.ts`). La única clase que
 *  ninguna lectura demuestra es `issue`: la espera queda fuera porque hay un
 *  issue ABIERTO que lo explica, con su número. Eso `npm test` no lo puede
 *  preguntar sin red, así que se pregunta aquí, en el job `candados-headless`,
 *  con `gh api`: **cerrado = rojo con la entrada nombrada**. Y `gh` ausente, sin
 *  token o sin red = ROJO también, nunca verde ni ⊘: una exención que no se
 *  puede comprobar no está comprobada, y un candado que se calla cuando no
 *  puede medir es el que se aprende a ignorar.
 *
 *  Por qué el estado del issue y no una fecha: una fecha pone `npm test` rojo
 *  SIN DIFF en un día que no es de nadie, y renovarla es un `sed` (la crítica
 *  de la tanda AE). El cadáver que lo motivó: la exención del guion 80 en
 *  conducen se sostenía «hasta que #496/#497 se cierren», los dos se cerraron
 *  el 2026-09-16 y la exención siguió viva dos días. Ninguna forma del texto lo
 *  vio; esto lo habría visto en la primera corrida.
 *
 *  Vive en la raíz de `qa/` y no en `guiones/` por la razón de siempre: no hay
 *  navegador que conducir. No gasta un crédito.
 *
 *      node qa/la-exencion-por-issue-tiene-issue-vivo.mjs
 *      GH_TOKEN=$(gh auth token) node qa/la-exencion-por-issue-tiene-issue-vivo.mjs
 *
 *  CONTROL POSITIVO INTERNO: además de las exenciones vivas, pregunta por un
 *  issue que se SABE cerrado (#545, cerrado el 2026-09-16) y exige leer
 *  `closed`. Así el guion tiene sujeto vivo aunque un día no quede ninguna
 *  exención por issue, y un `gh` que contestara «open» a todo no saldría verde.
 *
 *  Lo que NO cubre: que el issue citado sea EL QUE TOCA (un número de otro
 *  issue abierto pasa); eso lo mira la revisión del diff, y es el mismo límite
 *  que tiene cualquier cita. Y que el issue siga DESCRIBIENDO la espera: un
 *  issue abierto que cambió de tema pasa igual. */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRATOS = [
  "nefan-core/data/contract/esperas-que-conducen.json",
  "nefan-core/data/contract/esperas-por-fotogramas.json",
];
/** Un issue que se sabe cerrado: el control positivo del control. */
const CERRADO_CONOCIDO = 545;

/** El estado de un issue según GitHub, o LANZA con el motivo: sin `gh`, sin
 *  token, sin red o con un número que no existe, aquí no hay «desconocido». */
function estadoDelIssue(n) {
  const r = spawnSync("gh", ["api", `repos/{owner}/{repo}/issues/${n}`, "--jq", ".state"], {
    cwd: raiz,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (r.error) throw new Error(`no puedo consultar #${n}: ${r.error.message} (¿está \`gh\` en el PATH?)`);
  if (r.status !== 0) {
    throw new Error(`\`gh api\` salió ${r.status} consultando #${n}: ${(r.stderr || r.stdout || "").trim() || "(sin salida)"}`);
  }
  const estado = (r.stdout || "").trim();
  if (estado !== "open" && estado !== "closed") throw new Error(`#${n}: estado ilegible «${estado}»`);
  return estado;
}

const porIssue = CONTRATOS.flatMap((f) => {
  const c = JSON.parse(readFileSync(join(raiz, f), "utf8"));
  if (!Array.isArray(c.exentos)) throw new Error(`${f}: sin \`exentos\``);
  return c.exentos
    .filter((e) => e.clase === "issue")
    .map((e) => {
      if (!Number.isInteger(e.issue) || e.issue <= 0) throw new Error(`${f} :: ${e.desc}: clase issue sin número`);
      return { contrato: f, fichero: e.fichero, desc: e.desc, issue: e.issue };
    });
});

const fallos = [];
console.log(`Exenciones por issue en los dos contratos: ${porIssue.length}`);
try {
  const control = estadoDelIssue(CERRADO_CONOCIDO);
  console.log(`  control · #${CERRADO_CONOCIDO} → ${control} ${control === "closed" ? "✔" : "✖"}`);
  if (control !== "closed") fallos.push(`el control positivo falla: #${CERRADO_CONOCIDO} debería leerse \`closed\` y se lee «${control}»`);
  for (const e of porIssue) {
    const estado = estadoDelIssue(e.issue);
    const vivo = estado === "open";
    console.log(`  ${vivo ? "✔" : "✖"} #${e.issue} ${estado} · ${e.fichero} :: ${e.desc}`);
    if (!vivo) {
      fallos.push(
        `${e.contrato} exime «${e.fichero} :: ${e.desc}» por #${e.issue}, que está CERRADO: la exención caducó. ` +
          `O la espera vuelve a su molde y la entrada se borra, o se reescribe con el issue vivo que hoy la sostenga.`,
      );
    }
  }
} catch (err) {
  fallos.push(`no se pudo medir, y eso es ROJO: ${err instanceof Error ? err.message : String(err)}`);
}

console.log(`\n${"─".repeat(70)}`);
if (fallos.length === 0) {
  console.log(`✔ ${porIssue.length} exención(es) por issue con su issue ABIERTO, y el control cerrado se lee cerrado`);
  process.exit(0);
}
for (const f of fallos) console.error(`✖ ${f}`);
process.exit(1);
