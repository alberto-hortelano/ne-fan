/** El cierre de PEDIR: los verbos que solo necesitan git y la huella —`pendiente`
 *  (qué falta por medir desde el tag, y cuánto cuesta), `local` (medir UN módulo
 *  barato aquí, dentro del tope) y `ancla` (el sha del tag, para el YAML)—. Nada
 *  de `reports/` ni de `gh` (#605).
 *
 *  Quién lo mira: NADIE ejerce estos tres verbos, ni test ni guion de `qa/`, y
 *  hay que saberlo. Lo que deciden lo deciden fuera: el tope, `permisoLocal`
 *  (puro, con batería); el coste y la selección, `mutacion-repo.ts` y
 *  `afectado.ts`. Lo que queda aquí es imprimir y lanzar `mutate.ts`. Ver
 *  `mutacion.ts`.
 */
import { spawnSync } from "node:child_process";

import { coreRoot, leerPlan, moduloPorId } from "./mutation-plan.js";
import { permisoLocal } from "./mutacion-huella.js";
import { WORKFLOW } from "./mutacion-github.js";
import {
  commitsDelRango,
  costeDe,
  estimaCoste,
  ficherosDesdeElTag,
  git,
  leerHuella,
  seleccionDesdeElTag,
  shaDelTag,
  TAG,
} from "./mutacion-repo.js";

// ── verbo: pendiente ─────────────────────────────────────────────────────────

export function pendiente(argv: readonly string[]): void {
  const plan = leerPlan();
  const tag = shaDelTag();
  const sel = seleccionDesdeElTag(plan, tag);
  const ids = sel.todos ? plan.modulos.map((m) => m.id) : sel.ids;

  if (argv.includes("--ids")) {
    // Un rango vacío NO se degrada a la corrida completa ni a un verde en
    // silencio: si el runner llega aquí es que alguien pulsó "Run workflow", y
    // medir cero módulos gastando un runner de 180 minutos es peor que decirlo.
    if (ids.length === 0) {
      throw new Error(
        `no hay nada que medir desde ${TAG}: el diff no selecciona ningún módulo. ` +
          `Si querías la corrida completa, lánzala con el input TODOS.`,
      );
    }
    console.log(ids.join(" "));
    return;
  }

  const huella = leerHuella();
  const commits = commitsDelRango(plan, tag, "HEAD");
  const fechaTag = git(["log", "-1", "--format=%ad", "--date=short", tag]);
  console.log(`\nPendiente de medir desde ${TAG} (${tag.slice(0, 7)}, ${fechaTag})\n`);

  if (commits.length === 0) console.log("  Sin commits nuevos desde la última corrida.");
  else {
    console.log(`  ${commits.length} commit(s) sin medir:`);
    for (const c of commits) {
      const quien = c.pr === undefined ? `${c.sha.slice(0, 7)} (directo a main)` : `#${c.pr}`;
      console.log(`    ${quien.padEnd(22)} ${c.asunto.slice(0, 72)}`);
    }
  }

  const sucios = ficherosDesdeElTag(tag).length;
  console.log(`\n  ${sucios} fichero(s) cambiados desde el tag (árbol de trabajo incluido).`);
  if (ids.length === 0) {
    console.log("  NO se mediría nada: el diff no selecciona ningún módulo.");
  } else {
    const costes = ids.map((id) => costeDe(plan, huella, id));
    const conocido = costes.filter((c): c is number => c !== undefined).reduce((a, b) => a + b, 0);
    const sinBase = ids.filter((id, i) => costes[i] === undefined);
    console.log(
      `  Se medirían ${ids.length} de ${plan.modulos.length} módulos` +
        `${sel.todos ? " (COMPLETA: el selector no puede descartar nada)" : ""} · ` +
        `${conocido} mutantes medidos antes` +
        (sinBase.length > 0 ? ` + ${sinBase.length} módulo(s) sin base: ${sinBase.join(", ")}` : ""),
    );
    for (const e of sel.efectos.filter((x) => x.todos)) {
      console.log(`    fuerza la completa: ${e.fichero} — ${e.porque}`);
    }
  }

  // QUIÉN CABE EN EL TOPE, con su margen. El conjunto medible en local cambia
  // sin que nadie lo relacione: basta con que alguien añada un test a un módulo
  // que estaba a dos mutantes de la línea para que salga del conjunto en
  // silencio. Enseñarlo convierte ese silencio en un número.
  const medibles = plan.modulos
    .map((m) => ({ id: m.id, coste: costeDe(plan, huella, m.id) }))
    .filter((m): m is { id: string; coste: number } => m.coste !== undefined && m.coste <= plan.tope_local)
    .sort((a, b) => a.coste - b.coste);
  if (medibles.length > 0) {
    const alBorde = medibles[medibles.length - 1];
    console.log(
      `\n  Medibles aquí (tope ${plan.tope_local}): ` +
        medibles.map((m) => `${m.id} ${m.coste}`).join(" · ") +
        `\n  ${alBorde.id} está a ${plan.tope_local - alBorde.coste} mutante(s) del tope: ` +
        `el próximo test que se le añada lo saca del conjunto.`,
    );
  }

  console.log(
    `\n  Autorízalo:  Actions → "Mutation testing" → Run workflow (input vacío = este rango)` +
      `\n  Respaldo:    gh workflow run ${WORKFLOW} -r ${git(["rev-parse", "--abbrev-ref", "HEAD"])}` +
      `\n  Una petición pendiente NO bloquea nada: sigue y cierra la tanda.\n`,
  );
}

// ── verbo: local ─────────────────────────────────────────────────────────────

export function local(argv: readonly string[]): void {
  const id = argv.find((a) => !a.startsWith("-"));
  if (!id) throw new Error("falta el id del módulo: npm run mutacion -- local <id>");
  const plan = leerPlan();
  moduloPorId(plan, id); // fail-loud si el id no existe, con la lista de los que sí
  const huella = leerHuella();
  const coste = costeDe(plan, huella, id);
  // El mismo par de números que aplica `mutate.ts`, para que el verbo no diga
  // «adelante» y la puerta de abajo se niegue medio segundo después: la huella
  // (la corrida anterior) y lo que costaría HOY (#429).
  const permiso = permisoLocal(id, coste, plan.tope_local, false, estimaCoste(plan, huella, id));
  if (!permiso.ok) {
    console.error(`\nNO se mide aquí: ${permiso.porque}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\n${id}: ${permiso.coste} mutantes (tope local ${plan.tope_local}). Concurrencia 2 — ` +
      `dos núcleos, la máquina sigue siendo de quien la usa.\n`,
  );
  const r = spawnSync("npx", ["tsx", "scripts/mutate.ts", id], {
    cwd: coreRoot,
    stdio: "inherit",
    env: { ...process.env, NEFAN_MUTATE_CONCURRENCY: "2", NEFAN_MUTATE_AUTORIZADO: "si" },
  });
  process.exitCode = r.status ?? 1;
}

// ── verbo: ancla (lo lee CI antes de medir) ──────────────────────────────────

/** El sha del tag, a pelo y sin adornos: lo consume un `$(…)` del YAML.
 *
 *  Existe para que la corrida pueda GUARDAR su ancla en el manifiesto. El paso
 *  de selección de CI ya sabía desde dónde estaba midiendo —es el mismo tag que
 *  usa `pendiente --ids`— y lo tiraba; luego el paso final movía el tag, y
 *  `repartir` llegaba a leer un ancla que ya no era la de esta corrida. Este
 *  verbo no es un dato nuevo: es el que ya existía, escrito en vez de olvidado. */
export function ancla(): void {
  console.log(shaDelTag());
}
