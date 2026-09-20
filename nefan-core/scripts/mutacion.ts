/** `npm run mutacion` — la mutación se PIDE, la autoriza una persona, y vuelve
 *  con dueño.
 *
 *  POR QUÉ NO HAY COLA DE PETICIONES. La primera versión de esto guardaba las
 *  peticiones como ficheros JSON en el paquete, y era un autogol de los que no
 *  dan error: `clasifica()` manda cualquier fichero que no acabe en `.ts` a
 *  "dato", y `efectoDe` traduce "dato" a `todos: true` — escribir una petición
 *  habría hecho que el selector pidiera la corrida COMPLETA, 9.040 mutantes en
 *  vez de los 300 que tocaban. Además la cola tenía garantizado el olvido:
 *  `.claude/agents/ingeniero.md` dice «no commitees ni hagas push salvo que se
 *  te pida», así que la petición nacía huérfana en el árbol de trabajo de quien
 *  la escribía.
 *
 *  LO QUE HAY EN SU LUGAR ES UN TAG MOVIBLE: `mutacion-ultima`, que el workflow
 *  reposiciona cuando una corrida cubre el rango entero. Sustituye a la cola, al
 *  fichero de estado, al commit de borrado y a la carrera entre autorizar y
 *  repartir:
 *
 *    · qué falta por medir   = `git log mutacion-ultima..main` — nadie puede
 *      olvidarse de declararlo, porque no hay nada que declarar.
 *    · qué se mide           = `seleccionar()` sobre el diff desde el tag. Es
 *      MÁS correcto que la unión de las peticiones: coge también las PR que
 *      nadie pidió y los commits directos a main (11 de los últimos 40).
 *    · el porqué del ingeniero, cuando lo tenga, viaja como trailer del commit
 *      (`Mutación: <motivo>`). Se lee en el móvil y no crea ficheros.
 *
 *  Uso:
 *    npm run mutacion -- pendiente          # qué hay sin medir, y cuánto cuesta
 *    npm run mutacion -- pendiente --ids    # los ids, para el runner
 *    npm run mutacion -- traer [run-id]     # vacía reports/ y baja el artefacto
 *    npm run mutacion -- repartir           # delta + atribución (--comentar publica)
 *    npm run mutacion -- comparar           # el MISMO delta EN SECO: mira y no toca
 *    npm run mutacion -- local <id>         # medir UN módulo barato, aquí
 *    npm run mutacion -- lotes              # cómo se partiría la corrida en jobs
 *    npm run mutacion -- fusionar …         # lo corre CI, junta los lotes
 *    npm run mutacion -- cola <run-id>      # cuánto estorba la matriz a una PR
 *    npm run mutacion -- ancla              # el sha del tag, para el YAML
 *    npm run mutacion -- manifiesto …       # lo escribe CI, no una persona
 *
 *  Lo que decide algo —la huella, el delta, la atribución, el tope— vive en
 *  `scripts/mutacion-huella.ts`, sin git ni disco dentro, para que el candado
 *  pueda ejercerlo con datos sintéticos. Un test que llamara a git de verdad
 *  correría en CI sobre un clon superficial y pasaría en verde sin comprobar
 *  nada, que es lo que `deuda.ts:159` ya documenta de `enColaDeCrap`.
 *
 *  AQUÍ SOLO QUEDA EL ENRUTADO —la tabla `VERBOS` y `main`—, y nadie importa
 *  este fichero. Cada verbo vive con su CIERRE DE LLAMADAS, no en un fichero por
 *  verbo (#605: `comparar` son 39 líneas propias sobre un cierre de 356 que
 *  comparte con `repartir`, y partir por verbo lo duplicaría):
 *
 *    mutacion-repo.ts       git, el tag, la huella en disco y el coste — lo único
 *                           que importan `mutate.ts`, `deuda.ts` y un test
 *    mutacion-informes.ts   `reports/mutation/`: el sello, el manifiesto, la medida
 *    mutacion-github.ts     `gh` → traer, cola
 *    mutacion-pedir.ts      pendiente, local, ancla
 *    mutacion-lotes.ts      lo que corre CI → lotes, fusionar, manifiesto
 *    mutacion-reparto.ts    el delta con dueño → repartir, comparar
 *
 *  LO QUE HAY EN ESA FAMILIA NO LO MIRA NINGÚN TEST, y hay que saberlo: los
 *  trozos llaman a git y a `gh` (solo `mutacion-repo.ts` se deja importar, y
 *  porque importado no hace nada), `mutate.ts` lanza una corrida al cargarse, y
 *  `scripts/` está fuera del perímetro de mutación y de CRAP por definición, no
 *  por exención. Medido el 2026-09-04 sobre el diff de #381+#420: OCHO
 *  reversiones del cableado —el ancla del reparto, la contradicción del rango
 *  vacío, el fail-loud de `leerCorrida`, el cálculo del sello, el ancla que
 *  escribe `manifiesto`, la admisión de `--pedidos ""` y el paso del workflow—
 *  dejaban `npm run verify` en verde. Quien las mira es
 *  `qa/mutacion-cableado-en-negativo.mjs`, que ejerce cada una contra el VERBO
 *  de verdad y exige ver el observable cambiar al romperla; sus `rompe` apuntan
 *  al TROZO donde vive cada línea. Si tocas algo de la familia, córrelo; y si
 *  añades una decisión nueva, añádele su invariante ahí, porque la batería no va
 *  a enterarse.
 */
import { cola, traer } from "./mutacion-github.js";
import { fusionar, lotes, manifiesto } from "./mutacion-lotes.js";
import { ancla, local, pendiente } from "./mutacion-pedir.js";
import { comparar, repartir } from "./mutacion-reparto.js";
import { TAG } from "./mutacion-repo.js";

// ── entrada ──────────────────────────────────────────────────────────────────

const VERBOS: Record<string, (argv: string[]) => void> = {
  pendiente,
  traer,
  repartir,
  comparar,
  local,
  lotes,
  fusionar,
  cola,
  ancla,
  manifiesto,
};

function main(): void {
  const [verbo, ...resto] = process.argv.slice(2);
  const fn = verbo ? VERBOS[verbo] : undefined;
  if (!fn) {
    console.error(
      `uso: npm run mutacion -- <${Object.keys(VERBOS).join(" | ")}>\n` +
        `  pendiente [--ids]   qué hay sin medir desde ${TAG}, y cuánto cuesta\n` +
        `  traer [run-id]      vacía reports/mutation/ y baja el artefacto de CI\n` +
        `  repartir [--comentar] [--instrumento-nuevo]  delta contra la corrida anterior y atribución.\n` +
        `                      Se PARA si un fichero trae menos mutantes medidos con el mismo código (#596);\n` +
        `                      --instrumento-nuevo declara que esa pérdida está aceptada\n` +
        `  comparar [--timeouts <dir>] [--base <rev>]  el MISMO delta sin escribir nada, con el veredicto\n` +
        `                      de adopción (las SIETE condiciones). --base elige contra qué huella\n` +
        `  local <id>          mide UN módulo barato en esta máquina\n` +
        `  lotes [--ids …]     parte la corrida en jobs por los SEGUNDOS medidos\n` +
        `  fusionar --entrada  junta los lotes en un solo corrida.json (lo corre CI)\n` +
        `  cola <run-id>       cuánto espera una PR mientras la matriz ocupa el pool\n` +
        `  ancla               el sha de ${TAG}, para que CI lo guarde en el manifiesto\n` +
        `  manifiesto …        lo escribe CI dentro del artefacto\n`,
    );
    process.exitCode = 2;
    return;
  }
  fn(resto);
}

main();
