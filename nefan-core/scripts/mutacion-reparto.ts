/** El cierre de REPARTO: el delta de una corrida, con su dueño. `repartir` lo
 *  ESCRIBE (la huella, y el comentario en la PR con `--comentar`) y `comparar` lo
 *  imprime EN SECO; los dos leen el mismo contexto y el mismo delta, y por eso
 *  viven juntos: con dos preámbulos gemelos, un guardia añadido a uno deja al
 *  otro leyendo una corrida que el primero ya se niega a leer (#605). El cableado
 *  de `comparar` está aquí y NO en `mutacion-comparar.ts`: aquel fichero no puede
 *  importar `child_process` (`comparar-solo-lee`) y el contexto llama a git.
 *
 *  Quién lo mira: `qa/mutacion-cableado-en-negativo.mjs` —el ancla del reparto,
 *  la contradicción del rango vacío, el guardia de #596 en las dos direcciones, y
 *  que `comparar` no deje rastro ni en la huella ni en `reports/`—. La decisión
 *  (delta, atribución, veredicto de adopción) vive en `mutacion-huella.ts` y en
 *  `mutacion-comparar.ts`, puros y con batería. Ningún test importa esto: ver
 *  `mutacion.ts`.
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { comparaEnSeco, type BaseDeFichero, type PoblacionesAhora } from "./mutacion-comparar.js";
import { coreRoot, esVivo, ficherosMutados, leerPlan, moduloPorId, RUTA_HUELLA, type PlanMutacion } from "./mutation-plan.js";
import {
  atribuir,
  deltaDeCorrida,
  duenosDeLaMedida,
  estadoDeReparto,
  estadoLegible,
  filaDeHuella,
  fusiona,
  huellaDeMutante,
  instrumentoLegible,
  marcaDeCorrida,
  medidaPerdida,
  medidosDeFichero,
  modulosConInforme,
  rangoDe,
  sinEjercerDeFichero,
  timeoutsDeFichero,
  veredictoDeCorrida,
  vivosDeFichero,
  yaComentada,
  type Atribucion,
  type Corrida,
  type DeltaDeFichero,
  type DuenosDeLaMedida,
  type Huella,
  type InstrumentoMedido,
  type MedidaDeFichero,
  type MedidaPorModulo,
  type RangoDeCommits,
} from "./mutacion-huella.js";
import { gh } from "./mutacion-github.js";
import {
  DIR_INFORMES,
  exigeDescargaLimpia,
  leerCorrida,
  leerInforme,
  medidaDelDirectorio,
  type InformeCrudo,
} from "./mutacion-informes.js";
import { blobEnCommit, commitsDelRango, escribeHuella, git, huellaEnRevision, nombrePaquete } from "./mutacion-repo.js";

// ── verbo: repartir ──────────────────────────────────────────────────────────

interface HallazgoNuevo {
  fichero: string;
  linea: number;
  columna: number;
  mutador: string;
  replacement: string;
}

interface Reparto {
  modulo: string;
  ficheros: DeltaDeFichero[];
  // La MISMA estructura que va a la huella, derivada de la atribución una sola
  // vez: aquí se rehacían los nombres a mano (una copia de `nombreDeCommit`) y
  // el veredicto viajaba aparte, así que la consola y el fichero podían acabar
  // diciendo cosas distintas del mismo módulo.
  duenos: DuenosDeLaMedida;
  etiqueta: string;
  // Derivado de `Atribucion` y no copiado: una segunda lista de veredictos
  // podría quedarse sin el cuarto y el compilador no diría nada.
  veredicto: Atribucion["veredicto"];
  nuevos: HallazgoNuevo[];
  bateria: readonly string[];
}

/** Todo lo que hay que leer ANTES de poder comparar nada: el plan, el
 *  manifiesto de la corrida bajada, la huella COMMITEADA y el rango de commits
 *  sin medir.
 *
 *  Compartido por `repartir` y `comparar`: los dos contestan la misma pregunta
 *  y solo se diferencian en lo que hacen con la respuesta. Con dos preámbulos
 *  gemelos, un guardia añadido a uno deja al otro leyendo una corrida que el
 *  primero ya se niega a leer. */
interface ContextoDeCorrida {
  plan: PlanMutacion;
  corrida: Corrida;
  base: Huella;
  /** De qué revisión salió `base`, resuelta a sha. Se imprime SIEMPRE: quien
   *  lee un `incomparable` tiene que poder saber contra qué se comparó. */
  revBase: string;
  rango: RangoDeCommits;
  /** Cuántos mutantes midió cada informe de ESTA descarga. Se lee una vez y
   *  viaja con el contexto porque los dos verbos que lo usan —`repartir` y
   *  `comparar`— tienen que juzgar sobre la misma cuenta: dos lecturas del
   *  mismo directorio es el mismo fallo que los dos ternarios de
   *  `estadoLegible`, con la diferencia de que aquí una de ellas escribe. */
  medida: MedidaPorModulo;
}

function contextoDeLaCorrida(rev = "HEAD"): ContextoDeCorrida {
  const plan = leerPlan();
  const corrida = leerCorrida();
  exigeDescargaLimpia(corrida);
  const medida = medidaDelDirectorio(DIR_INFORMES);
  const base = huellaEnRevision(rev);
  const revBase = `${rev}${rev === "HEAD" ? ` (${git(["rev-parse", "--short", "HEAD"])})` : ""}`;
  // EL ANCLA LA TRAE LA CORRIDA, no el tag (#381). `shaDelTag()` aquí leería un
  // tag que esta misma corrida ya adelantó a `corrida.sha` al terminar
  // (`mutation.yml`), así que el rango salía vacío por construcción y los 33
  // módulos «sin dueño» — justo en la corrida que más tenía que repartir.
  const rango = rangoDe(commitsDelRango(plan, corrida.desde, corrida.sha));
  if (corrida.origen === "rango" && rango.tipo === "vacío") {
    // Contradicción demostrable, no una rareza que tolerar: si el origen es
    // `rango`, CI eligió los módulos a partir del diff desde este mismo ancla,
    // y un diff que seleccionó algo no puede venir de cero commits. O el ancla
    // no es la que usó la selección, o el clon no tiene la historia.
    throw new Error(
      `la corrida ${corrida.run_id} dice haber medido el RANGO desde ${corrida.desde.slice(0, 7)} hasta ` +
        `${corrida.sha.slice(0, 7)}, y ese rango no tiene ni un commit. CI no pudo seleccionar módulos ` +
        `de un diff vacío: o el ancla del manifiesto no es la que usó la selección, o a este clon le ` +
        `falta la historia (git fetch --unshallow).`,
    );
  }
  return { plan, corrida, base, revBase, rango, medida };
}

/** El delta de la corrida, fichero a fichero, con quién pudo traerlo y lo que
 *  hace falta para escribir la huella.
 *
 *  UNA SOLA COPIA, y no es preferencia de estilo. `repartir` (que lo escribe) y
 *  `comparar` (que solo lo imprime) miden lo MISMO; dos cálculos gemelos del
 *  mismo delta es el fallo que `mutacion-huella.ts` ya documenta de los dos
 *  ternarios de `estadoLegible`: un tercer estado añadido a uno se lee como «0
 *  nuevos» en el otro, y aquí ese «0 nuevos» sería la luz verde para cambiar el
 *  instrumento con el que se mide la casa entera.
 *
 *  Devuelve además las tres poblaciones que la huella NO sabe expresar, porque
 *  ahí solo viajan `vivos` y `total`: los `Timeout` (indistinguibles de un
 *  `Killed`), los `NoCoverage` (indistinguibles de un `Survived`, porque
 *  `esVivo` los colapsa) y todo lo que entró en el denominador (sin eso, un
 *  mutante que SALIÓ de la medida se cuenta como detectado). Son los tres
 *  sitios donde el veredicto puede moverse sin que ningún test cambie de
 *  opinión. */
function repartosDeLaCorrida(ctx: ContextoDeCorrida): {
  repartos: Reparto[];
  medidos: Record<string, MedidaDeFichero>;
  ahora: Record<string, PoblacionesAhora>;
  blobs: Record<string, string>;
  /** Con qué INSTRUMENTO midió cada módulo de ESTA corrida: runner y ajuste,
   *  juntos, porque la capacidad de emitir `NoCoverage` depende del par y no
   *  del ajuste solo (QA de #597, H-1). Se recoge aquí porque los informes ya
   *  se están abriendo, y se deja crudo (con su `undefined`) para que quien lo
   *  necesite decida si lanzar: `repartir` no lo usa y no tiene por qué morirse
   *  por un informe que no lo traiga. */
  instrumentos: Record<string, InstrumentoMedido | undefined>;
} {
  const { plan, corrida, base, rango } = ctx;
  const repartos: Reparto[] = [];
  const medidos: Record<string, MedidaDeFichero> = {};
  const poblaciones: Record<string, PoblacionesAhora> = {};
  const blobs: Record<string, string> = {};
  const instrumentos: Record<string, InstrumentoMedido | undefined> = {};

  for (const id of modulosConInforme(corrida)) {
    const modulo = moduloPorId(plan, id);
    const informe = leerInforme(id);
    const cobertura = informe.config?.coverageAnalysis;
    const runner = informe.config?.testRunner;
    instrumentos[id] =
      typeof cobertura === "string" && cobertura !== "" && typeof runner === "string" && runner !== ""
        ? { runner, cobertura }
        : undefined;
    const ahora: Record<string, { vivos: string[]; total: number; blob: string }> = {};
    for (const [fichero, info] of Object.entries(informe.files)) {
      ahora[fichero] = { ...vivosDeFichero(fichero, info.mutants), blob: blobEnCommit(corrida.sha, fichero) };
      blobs[fichero] = ahora[fichero].blob;
      poblaciones[fichero] = {
        timeouts: timeoutsDeFichero(fichero, info.mutants),
        sinEjercer: sinEjercerDeFichero(fichero, info.mutants),
        medidos: medidosDeFichero(fichero, info.mutants),
      };
    }
    const deltas = deltaDeCorrida(ahora, base);
    const atribucion = atribuir(id, rango);
    const duenos = duenosDeLaMedida(atribucion);
    // El reloj del módulo entra en la huella, que es de donde `lotes`
    // presupuesta. Va repetido en cada fila del módulo porque la huella se
    // indexa por fichero; `segundosDe` lo lee con MÁXIMO, no con suma.
    const segundos = corrida.informes.find((i) => i.modulo === id)?.segundos;

    for (const d of deltas) {
      medidos[d.fichero] = filaDeHuella({
        corrida,
        delta: d,
        blob: ahora[d.fichero].blob,
        duenos,
        segundos,
        // Los dos censos de #604. Salen del MISMO recorrido de informes que las
        // poblaciones que ya se recogían para `comparar`: la huella deja de ser
        // el único sitio donde un `NoCoverage` es indistinguible de un
        // `Survived` y un `Timeout` de un `Killed`.
        sinEjercer: poblaciones[d.fichero].sinEjercer.length,
        timeouts: poblaciones[d.fichero].timeouts.length,
      });
    }
    repartos.push({
      modulo: id,
      ficheros: deltas,
      duenos,
      etiqueta: atribucion.etiqueta,
      veredicto: atribucion.veredicto,
      nuevos: hallazgosNuevos(deltas, informe),
      bateria: modulo.tests,
    });
  }
  return { repartos, medidos, ahora: poblaciones, blobs, instrumentos };
}

export function repartir(argv: readonly string[]): void {
  const ctx = contextoDeLaCorrida();
  const { corrida, base } = ctx;

  if (yaRepartida(corrida, base)) return;

  const { repartos, medidos } = repartosDeLaCorrida(ctx);

  // EL FAIL-LOUD DE #596, Y VA ANTES DE ESCRIBIR. Un fichero cuyo fuente no
  // cambió y que trae MENOS mutantes con veredicto es el instrumento midiendo
  // menos: las muertes perdidas salen del numerador y del denominador a la vez,
  // así que `(K−k)/(T−k)` no baja y el `break` del módulo no las caza — 55 de
  // los 61 módulos toleran perder ≥ 1, y los 22 con cero supervivientes toleran
  // perderlas TODAS. Escribir la huella aquí consolidaba la pérdida como base
  // de la comparación siguiente, que es lo que la hacía invisible para siempre.
  //
  // Solo esta dirección. Un denominador que CRECE también es el instrumento,
  // pero midiendo MÁS (es la dirección en la que se arregló #597, devolviendo
  // 26 muertes al denominador): se dice en la tabla y no bloquea.
  const perdida = medidaPerdida(repartos.flatMap((r) => r.ficheros));
  if (perdida.length > 0 && !argv.includes("--instrumento-nuevo")) {
    throw new Error(
      `${perdida.length} fichero(s) traen MENOS mutantes con veredicto que la medida anterior SIN que su ` +
        `fuente haya cambiado:\n` +
        perdida.map((f) => `  · ${f.fichero}: ${f.antes} → ${f.ahora} (${f.antes - f.ahora} menos)`).join("\n") +
        `\n\nEso no lo puede hacer una PR: es el instrumento midiendo menos, y las muertes que se pierden ` +
        `salen del numerador Y del denominador, así que ningún \`break\` se entera (#596). Repartir ` +
        `escribiría esos totales encogidos en la huella y la comparación siguiente ya no podría verlo.\n` +
        `  Míralo primero EN SECO:   npm run mutacion -- comparar\n` +
        `  Si el instrumento cambió A PROPÓSITO y la pérdida está aceptada:\n` +
        `    npm run mutacion -- repartir --instrumento-nuevo`,
    );
  }

  escribeHuella(fusiona(base, medidos));
  console.log(`\nHuella actualizada: ${RUTA_HUELLA} — commítala con la tanda, el delta se ve en el diff.\n`);

  imprimeReparto(repartos, corrida);
  if (!veredictoDeCorrida(corrida, ctx.medida).completa) process.exitCode = 1;

  const comentar = argv.includes("--comentar");
  const porPr = agrupaPorPr(repartos);
  for (const [pr, suyos] of porPr) {
    const cuerpo = comentarioDe(pr, suyos, corrida);
    if (!comentar) {
      console.log(`\n─── comentario que iría a #${pr} (usa --comentar para publicarlo) ───\n${cuerpo}`);
      continue;
    }
    // IDEMPOTENCIA DONDE OCURRE EL EFECTO. El guardia de la huella solo está
    // armado cuando la huella está COMMITEADA, y entre `repartir --comentar` y
    // el `git commit` cabe otro `repartir --comentar`. Por esa ventana salieron
    // los dos comentarios contradictorios de #273: mismo run, veredictos
    // opuestos, y nada en la PR que dijera cuál mandaba. Preguntar a la PR
    // cierra la ventana entera, esté la huella donde esté.
    if (yaComentada(cuerposDeComentarios(pr), corrida.run_id)) {
      console.log(
        `#${pr} ya tiene el comentario de la corrida ${corrida.run_id}: no se publica otro.\n` +
          `  Dos comentarios de la misma corrida no se distinguen entre sí, y el segundo no ` +
          `corrige al primero: los deja contradiciéndose.`,
      );
      continue;
    }
    gh(["api", `repos/{owner}/{repo}/issues/${pr}/comments`, "--input", "-"], JSON.stringify({ body: cuerpo }));
    console.log(`Comentado en #${pr}.`);
  }
  const huerfanos = repartos.filter((r) => r.veredicto === "sin dueño");
  if (huerfanos.length > 0) {
    console.log(
      `\n${huerfanos.length} módulo(s) SIN DUEÑO en el rango: ${huerfanos.map((r) => r.modulo).join(", ")}. ` +
        `Se cuentan y se enseñan; no se descartan.`,
    );
  }
  // «Sin rango» no es «sin dueño», y decirlo así importa: lo primero manda a
  // mirar el superviviente, lo segundo a mirar por qué la corrida no tenía nada
  // que medir. Legítimo con origen `todos` o `explicito` — una corrida completa
  // pedida cuando no había commits nuevos.
  const sinRango = repartos.filter((r) => r.veredicto === "rango vacío");
  if (sinRango.length > 0) {
    console.log(
      `\n${sinRango.length} módulo(s) sin RANGO que mirar: entre ${corrida.desde.slice(0, 7)} y ` +
        `${corrida.sha.slice(0, 7)} no hay ningún commit, así que la atribución no tiene dónde buscar. ` +
        `No son «sin dueño»: nadie los ha buscado.`,
    );
  }
}

/** ¿Está esta corrida ya repartida y commiteada? La REGLA vive en
 *  `mutacion-huella.ts` (`estadoDeReparto`, pura y con candado); aquí solo se
 *  leen los ficheros del informe y se actúa sobre el veredicto. */
function yaRepartida(corrida: Corrida, base: Huella): boolean {
  const ficheros = modulosConInforme(corrida).flatMap((id) => Object.keys(leerInforme(id).files));
  const estado = estadoDeReparto(corrida.run_id, ficheros, base);
  if (estado.tipo === "a medio repartir") {
    throw new Error(
      `la corrida ${corrida.run_id} está a medio repartir en la huella de HEAD: ` +
        `${estado.repartidos} de ${estado.total} ficheros ya la llevan. Arregla la huella ` +
        `(git checkout ${RUTA_HUELLA} y vuelve a repartir) antes de seguir.`,
    );
  }
  if (estado.tipo === "pendiente") return false;
  console.log(
    `\nLa corrida ${corrida.run_id} ya está repartida y commiteada: no se toca la huella.\n` +
      `  Volver a repartirla borraría los NUEVOS y sus dueños, que es justo lo que hay que leer.\n` +
      `  La cola viva sigue en: npm run deuda\n`,
  );
  return true;
}

/** Los supervivientes NUEVOS, con su sitio exacto. La huella sola no vale para
 *  un comentario: «cuatro hashes nuevos» no lo arregla nadie. Fichero, línea,
 *  columna, mutador y con qué se sustituyó, que es lo que un ingeniero que
 *  llegue de cero necesita para escribir el test que faltaba. */
function hallazgosNuevos(deltas: readonly DeltaDeFichero[], informe: InformeCrudo): HallazgoNuevo[] {
  const nuevos = new Set(deltas.flatMap((d) => d.nuevos));
  if (nuevos.size === 0) return [];
  const out: HallazgoNuevo[] = [];
  for (const [fichero, info] of Object.entries(informe.files)) {
    for (const m of info.mutants) {
      if (!esVivo(m.status) || !nuevos.has(huellaDeMutante(fichero, m))) continue;
      out.push({
        fichero,
        linea: m.location.start.line,
        columna: m.location.start.column,
        mutador: m.mutatorName,
        replacement: (m.replacement ?? "").replace(/\s+/g, " ").slice(0, 60),
      });
    }
  }
  return out.sort((a, b) => a.fichero.localeCompare(b.fichero) || a.linea - b.linea);
}

/** `git blame` de una línea, como PISTA y nunca como veredicto. Contesta «quién
 *  escribió esta línea», que no es «qué cambio movió la suerte de este mutante»:
 *  con squash da la PR que se mergeó DESPUÉS (basta un `npm run format`), y en
 *  los 148 supervivientes `BlockStatement` la línea es la de la FIRMA. */
function pistaDeBlame(sha: string, fichero: string, linea: number): string {
  try {
    const salida = git(["blame", "-L", `${linea},${linea}`, "--porcelain", sha, "--", `${nombrePaquete}/${fichero}`]);
    const autor = /^author (.*)$/m.exec(salida)?.[1] ?? "?";
    const resumen = /^summary (.*)$/m.exec(salida)?.[1] ?? "?";
    return `${autor}: ${resumen.slice(0, 60)}`;
  } catch (err) {
    return `sin pista (${String((err as Error).message).split("\n")[0]})`;
  }
}

function agrupaPorPr(repartos: readonly Reparto[]): Map<number, Reparto[]> {
  const out = new Map<number, Reparto[]>();
  for (const r of repartos) {
    // Solo la rama con dueños tiene a quién comentar; las otras dos ni siquiera
    // ofrecen una lista que recorrer, que es la gracia de la unión.
    if (r.duenos.veredicto !== "con dueño") continue;
    for (const d of r.duenos.quienes) {
      if (!d.startsWith("#")) continue;
      const pr = Number(d.slice(1));
      out.set(pr, [...(out.get(pr) ?? []), r]);
    }
  }
  return out;
}

function imprimeReparto(repartos: readonly Reparto[], corrida: Corrida): void {
  console.log(
    `Reparto de la corrida ${corrida.run_id} (${corrida.desde.slice(0, 7)}..${corrida.sha.slice(0, 7)}, ` +
      `${corrida.origen})\n`,
  );
  for (const r of repartos) {
    console.log(`  ${r.modulo}  →  ${r.etiqueta}`);
    for (const d of r.ficheros) {
      const vivos = d.vivos.length;
      const estado = estadoLegible(d);
      console.log(`    ${d.fichero}  ${vivos} vivos de ${d.total} — ${estado}`);
    }
    for (const n of r.nuevos.slice(0, 8)) {
      console.log(
        `      NUEVO ${n.fichero}:${n.linea}:${n.columna} ${n.mutador} → ${n.replacement}` +
          `\n            pista (git blame, NO es el veredicto): ${pistaDeBlame(corrida.sha, n.fichero, n.linea)}`,
      );
    }
    if (r.nuevos.length > 8) console.log(`      …y ${r.nuevos.length - 8} nuevos más`);
  }
  const conInforme = modulosConInforme(corrida);
  const sinMedir = corrida.modulos_pedidos.filter((id) => !conInforme.includes(id));
  if (sinMedir.length > 0) {
    // Se dice AQUÍ, al final y no al principio, porque esta salida es la que se
    // copia al informe de la tanda: un reparto parcial que termina en silencio
    // se lee como completo, y el módulo caído conserva su huella vieja — que en
    // el diff parece «no cambió» y en realidad es «no se miró».
    console.log(
      `  ⚠ ${sinMedir.length} módulo(s) se PIDIERON y no dejaron informe: ${sinMedir.join(", ")}\n` +
        `    conservan la huella de su última medida; no son «0 supervivientes», son «sin mirar».\n` +
        `    El tag NO se ha movido, así que la próxima corrida vuelve a pedirlos.`,
    );
  }
  console.log("");
}

/** Los cuerpos de los comentarios que ya tiene una PR. Fail-loud: si `gh` no
 *  puede contestar NO se degrada a "no hay ninguno", porque eso llevaría a
 *  publicar el duplicado que esto existe para impedir. */
function cuerposDeComentarios(pr: number): string[] {
  const crudo = gh(["api", `repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`]);
  return (JSON.parse(crudo) as { body?: string }[]).map((c) => c.body ?? "");
}

function comentarioDe(pr: number, repartos: readonly Reparto[], corrida: Corrida): string {
  const lineas = [
    // Marca invisible para reconocer los comentarios de esta corrida sin
    // depender de cómo esté redactada la cabecera.
    marcaDeCorrida(corrida.run_id),
    `## Mutación · corrida [${corrida.run_id}](https://github.com/alberto-hortelano/ne-fan/actions/runs/${corrida.run_id}) sobre \`${corrida.sha.slice(0, 7)}\``,
    "",
    `Esta PR es **candidata** de ${repartos.length} módulo(s) medidos: el diff de su commit selecciona ese módulo, ` +
      `así que pudo mover la suerte de sus mutantes. No es \`git blame\`: con dos candidatos se nombran los dos.`,
    "",
  ];
  for (const r of repartos) {
    lineas.push(`### \`${r.modulo}\` — ${r.veredicto === "varios" ? `candidatas: ${r.etiqueta}` : r.etiqueta}`);
    lineas.push("");
    lineas.push("| fichero | vivos / total | estado |");
    lineas.push("|---|---|---|");
    for (const d of r.ficheros) {
      const vivos = d.vivos.length;
      const estado = estadoLegible(d, { markdown: true });
      lineas.push(`| \`${d.fichero}\` | ${vivos} / ${d.total} | ${estado} |`);
    }
    lineas.push("");
    if (r.nuevos.length > 0) {
      lineas.push(`<details><summary>${r.nuevos.length} superviviente(s) NUEVOS</summary>`);
      lineas.push("");
      for (const n of r.nuevos.slice(0, 40)) {
        lineas.push(`- \`${n.fichero}:${n.linea}:${n.columna}\` · ${n.mutador} → \`${n.replacement}\``);
      }
      if (r.nuevos.length > 40) lineas.push(`- …y ${r.nuevos.length - 40} más`);
      lineas.push("");
      lineas.push("</details>");
      lineas.push("");
    }
    lineas.push(`Los mataría un test de: ${r.bateria.map((t) => `\`${t}\``).join(", ")}.`);
    lineas.push("");
  }
  lineas.push(
    `Para reproducirlo aquí: \`npm run mutacion -- local <módulo>\` si es barato; si no, ` +
      `\`npm run mutacion -- pendiente\`. La cola viva está en \`npm run deuda\`.`,
  );
  return lineas.join("\n");
}

// ── verbo: comparar (mira y no toca) ─────────────────────────────────────────

/** Dónde están los informes de la corrida BASE, resuelto y COMPROBADO.
 *
 *  Es lo único que puede contar los movimientos de `Timeout` y de `NoCoverage`:
 *  la huella guarda `vivos` y `total`, y ahí un `Timeout` es un `Killed` y un
 *  `NoCoverage` es un `Survived`.
 *
 *  FAIL-LOUD TAMBIÉN CON LA RUTA MAL ESCRITA, que es la mitad del caso que la
 *  primera versión dejó abierta (QA, H5): con un directorio que no existe —o el
 *  que `traer` acaba de vaciar— el bloque del reloj salía con TODO A CERO, y una
 *  tabla de ceros se lee «no se movió ningún Timeout», que es exactamente lo
 *  contrario de lo que habría pasado. El aviso existía, pero debajo del TOTAL y
 *  detrás de 55 nombres: lo que se pega en el issue es el TOTAL. */
function dirDeTimeouts(argv: readonly string[]): string | undefined {
  const i = argv.indexOf("--timeouts");
  if (i < 0) return undefined;
  const dir = argv[i + 1];
  const comoSeArregla =
    "  Ojo al ritual: `traer` VACÍA reports/mutation/ antes de bajar, así que la base hay que apartarla\n" +
    "  ANTES (mv reports/mutation reports/mutation-base). Si ya se perdió:\n" +
    "    gh run download <run-id> -n informe-mutacion -D nefan-core/reports/mutation-base";
  if (dir === undefined || dir.startsWith("-")) {
    throw new Error(
      `--timeouts necesita el directorio con los informes de la corrida BASE (p.ej. reports/mutation-base).\n${comoSeArregla}`,
    );
  }
  const abs = resolve(coreRoot, dir);
  if (!existsSync(abs)) {
    throw new Error(`--timeouts apunta a ${abs}, que no existe.\n${comoSeArregla}`);
  }
  const informes = readdirSync(abs).filter((f) => f.endsWith(".json") && f !== "corrida.json");
  if (informes.length === 0) {
    throw new Error(
      `--timeouts apunta a ${abs} y ahí no hay ni un informe de módulo.\n` +
        `  Un directorio vacío no es «la base no tenía Timeout»: es que no hay base.\n${comoSeArregla}`,
    );
  }
  return abs;
}

/** Los ficheros que la huella espera ver medidos: el conjunto de LA CASA.
 *
 *  Es la respuesta a H1 —«SE PUEDE ADOPTAR» sobre 1 fichero de 87— y la
 *  intersección es deliberada por los dos lados: una fila de la huella cuyo
 *  fuente ya no muta el plan (hoy `src/protocol/status-labels.ts`, que ni
 *  existe) no se puede exigir, y un fichero que el plan muta y la huella no
 *  tiene no se puede comparar contra nada — si la corrida lo mide, sale
 *  `sin base`, que ya es condición. */
function ficherosEsperados(plan: PlanMutacion, base: Huella): string[] {
  const delPlan = new Set(plan.modulos.flatMap((m) => ficherosMutados(m)));
  return Object.keys(base.ficheros)
    .filter((f) => delPlan.has(f))
    .sort();
}

/** El mismo delta que `repartir` y NINGUNA escritura: ni la huella, ni el tag,
 *  ni un comentario en la PR.
 *
 *  Existe porque sin él la regla dura de #443 es inaplicable por construcción:
 *  el único verbo que comparaba escribía la huella y CI le movía el tag detrás,
 *  así que medir con un instrumento nuevo destruía la base contra la que había
 *  que compararlo. Quien decide vive en `mutacion-huella.ts` (puro, con
 *  batería) y quien imprime en `scripts/mutacion-comparar.ts`, que no puede
 *  escribir: reglas `comparar-solo-lee` y `comparar-no-escribe`.
 *
 *  ESTAS LÍNEAS DE AQUÍ NO LAS CUBRE NINGUNA DE LAS DOS REGLAS, porque viven en
 *  el fichero que escribe la huella por diseño. Lo que las vigila es el
 *  invariante de `qa/mutacion-cableado-en-negativo.mjs`, que corre el verbo y
 *  fotografía la huella, el tag, `git status` y el árbol de `reports/` — ese
 *  último porque está en `.gitignore`, así que una escritura ahí no la ve
 *  `git status`, y es donde vive la base que esto existe para no destruir. */
export function comparar(argv: readonly string[]): void {
  const ctx = contextoDeLaCorrida(valorDe(argv, "--base") ?? "HEAD");
  const { repartos, ahora, blobs, instrumentos } = repartosDeLaCorrida(ctx);
  const veredicto = veredictoDeCorrida(ctx.corrida, ctx.medida);
  const base: Record<string, BaseDeFichero> = {};
  const codigoCambiado: string[] = [];
  for (const fichero of Object.keys(blobs)) {
    const fila = ctx.base.ficheros[fichero];
    if (fila !== undefined && fila.blob !== "" && fila.blob !== blobs[fichero]) codigoCambiado.push(fichero);
    base[fichero] = {
      vivos: fila?.vivos ?? [],
      // Mismo blob = las dos medidas hablan del mismo código, así que las
      // huellas (que llevan línea y columna) son comparables. Es una pregunta
      // DISTINTA de la de `deltaDeFichero`, que además exige el mismo `total`:
      // un fichero cuyo total cambió sigue siendo comparable por POSICIÓN, y es
      // justo el caso en el que hay que saber qué mutante desapareció.
      mismoCodigo: fila !== undefined && fila.blob === blobs[fichero],
    };
  }
  process.exitCode = comparaEnSeco({
    corrida: {
      run_id: ctx.corrida.run_id,
      sha: ctx.corrida.sha,
      desde: ctx.corrida.desde,
      origen: ctx.corrida.origen,
      completa: veredicto.completa,
      mueveTag: veredicto.mueveTag,
      porque: veredicto.porque,
    },
    modulos: repartos,
    ahora,
    base,
    codigoCambiado,
    revBase: ctx.revBase,
    esperados: ficherosEsperados(ctx.plan, ctx.base),
    dirBase: dirDeTimeouts(argv),
    coberturaAhora: instrumentoDeLaCorrida(instrumentos),
  });
}

/** Con qué `coverageAnalysis` midió ESTA corrida, para imprimirlo al lado del
 *  de la base.
 *
 *  FAIL-LOUD igual que con la base, y por el mismo motivo: si un informe no
 *  dice cómo se midió, el bloque de `NoCoverage` no puede decir qué está
 *  mirando, que es literalmente lo que #599 vino a arreglar. Se comprueba aquí
 *  —en el verbo que compara— y no en `leerInforme`, para no matar a `repartir`
 *  ni a `fusionar`, que no necesitan el dato. */
function instrumentoDeLaCorrida(instrumentos: Readonly<Record<string, InstrumentoMedido | undefined>>): string {
  const sinDecir = Object.keys(instrumentos)
    .filter((id) => instrumentos[id] === undefined)
    .sort();
  if (sinDecir.length > 0) {
    throw new Error(
      `${sinDecir.length} informe(s) de esta corrida no dicen con qué se midieron (falta \`testRunner\` o ` +
        `\`coverageAnalysis\` en ${sinDecir.slice(0, 5).join(", ")}): sin eso, el bloque de NoCoverage no ` +
        `puede decir qué está mirando — y de eso va #599. No se les supone nada.`,
    );
  }
  const valores = Object.values(instrumentos)
    .filter((v): v is InstrumentoMedido => v !== undefined)
    .map(instrumentoLegible);
  return [...new Set(valores)].sort().join(" + ");
}

/** El valor de un flag `--x <valor>`, o `undefined` si no está. Fail-loud si
 *  está y llega vacío: un flag sin valor no significa «el defecto». */
function valorDe(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("-")) throw new Error(`${flag} necesita un valor`);
  return v;
}
