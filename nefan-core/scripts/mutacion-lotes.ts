/** El cierre de LOTES: lo que corre CI para partir la corrida y volver a juntarla
 *  —`lotes` (planificar por el reloj MEDIDO de cada módulo, y escribir el plan si
 *  se lo piden), `manifiesto` (sellar lo que midió cada job) y `fusionar` (reunir
 *  los lotes en un `reports/mutation/` con un solo `corrida.json`)—. Comparten
 *  `origenValido` y la lectura de informes; una copia por verbo discreparía (#605).
 *
 *  Quién lo mira: `qa/mutacion-reparto-en-lotes.mjs` (el reparto, y el sello de
 *  cada lote ANTES de mezclar) y `qa/mutacion-cableado-en-negativo.mjs` (el plan
 *  con TODOS los pedidos, la fusión sin plan, el ancla que guarda el manifiesto y
 *  la admisión de `--pedidos ""`). El empaquetado y el veredicto son de
 *  `mutacion-huella.ts`. Ningún test importa esto: ver `mutacion.ts`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { coreRoot, leerPlan, moduloPorId } from "./mutation-plan.js";
import {
  ARRANQUE_DEL_JOB_S,
  conCronometro,
  empaqueta,
  fusionaCorrida,
  HOLGURA_DEL_TECHO,
  idsDeLotes,
  lotesQueNoCaben,
  lotesSinNoticias,
  matrizDeLotes,
  presupuestoDelLote,
  veredictoDeCorrida,
  verificaDescarga,
  type Corrida,
  type OrigenCorrida,
  type PlanDeCorrida,
} from "./mutacion-huella.js";
import {
  DIR_INFORMES,
  informesDelDirectorio,
  informesEnDisco,
  medidaDelDirectorio,
  RUTA_CORRIDA,
  RUTA_PLAN_CORRIDA,
  RUTA_TIEMPOS,
} from "./mutacion-informes.js";
import { leerHuella, segundosDe, seleccionDesdeElTag, shaDelTag, TAG } from "./mutacion-repo.js";

// ── verbo: lotes (parte la corrida por el reloj) ─────────────────────────────

/** Un origen válido, o un error que dice cuáles hay. Compartido por `manifiesto`
 *  y `lotes`: dos validaciones del mismo enum acabarían discrepando. */
function origenValido(v: string): OrigenCorrida {
  if (v !== "rango" && v !== "todos" && v !== "explicito") {
    throw new Error(`--origen inválido: "${v}" (rango | todos | explicito)`);
  }
  return v;
}

/** Cómo se reparte la corrida en jobs, y —si CI lo pide— el plan que la fusión
 *  necesitará después.
 *
 *  Sin los flags de CI solo IMPRIME: es lo que deja mirar el reparto sin medir
 *  nada ni gastar un runner, y es la comprobación que se hace a ojo en la PR.
 *
 *    npm run mutacion -- lotes                        # lo que se mediría hoy
 *    npm run mutacion -- lotes --ids "a b c"          # esos módulos
 *    npm run mutacion -- lotes --ids … --origen … --sha … --desde … --run …
 *                                                     # además escribe el plan
 */
export function lotes(argv: readonly string[]): void {
  const plan = leerPlan();
  const huella = leerHuella();
  const opcional = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i < 0 ? undefined : argv[i + 1];
  };

  // Qué se ha pedido lo decide `idsDeLotes`, que es puro y tiene batería: aquí
  // solo se traducen sus tres respuestas legítimas a una lista de módulos. Las
  // dos ilegítimas —`--todos` con `--ids`, y un id repetido— mueren antes de
  // tocar el plan (#437).
  const pedido = idsDeLotes(argv.includes("--todos"), opcional("--ids"));
  if (!pedido.ok) throw new Error(`lotes: ${pedido.porque}`);
  const ids =
    pedido.ids === "todos"
      ? // El input TODOS del workflow. Explícito y no una lista vacía que
        // alguien tenga que interpretar: `--pedidos ""` ya costó una corrida.
        plan.modulos.map((m) => m.id)
      : pedido.ids === "del-tag"
        ? (() => {
            const sel = seleccionDesdeElTag(plan, shaDelTag());
            return sel.todos ? plan.modulos.map((m) => m.id) : sel.ids;
          })()
        : [...pedido.ids];
  // Fail-loud: un id inventado en el input del workflow tiene que morir AQUÍ,
  // no en el job que intente medirlo media hora después.
  for (const id of ids) moduloPorId(plan, id);
  if (ids.length === 0) {
    throw new Error(
      `no hay nada que repartir: el diff desde ${TAG} no selecciona ningún módulo. ` +
        `Si querías la corrida completa, lánzala con el input TODOS.`,
    );
  }

  const paquetes = empaqueta(
    ids.map((id) => {
      const s = segundosDe(plan, huella, id);
      return s === undefined ? { id } : { id, segundos: s };
    }),
    plan.tope_lote,
  );

  const tope = plan.tope_lote;
  console.log(`\n${paquetes.length} lote(s) para ${ids.length} módulo(s) · tope ${tope}s (${(tope / 60).toFixed(0)} min)\n`);
  for (const l of paquetes) {
    if (!l.medido) {
      console.log(`  lote ${String(l.lote).padStart(2)}  SIN MEDIDA DE RELOJ  ${l.modulos.join(" ")}`);
      continue;
    }
    // EL MARGEN SE IMPRIME, y no es adorno: `blueprint-derive` está a dos
    // minutos y medio del tope, igual que `npc-director` está a dos mutantes de
    // `tope_local`. El primer test que se le añada lo saca del empaquetado, y
    // eso hay que verlo venir en vez de descubrirlo con una corrida cortada.
    const margen = l.margen ?? 0;
    const aviso = margen < 0 ? "  ⚠ SE PASA DEL TOPE: irá solo y hay que partir su batería" : "";
    console.log(
      `  lote ${String(l.lote).padStart(2)}  ${String(l.segundos).padStart(5)}s ` +
        `(margen ${margen >= 0 ? "+" : ""}${margen}s = ${(margen / 60).toFixed(1)} min)  ` +
        `${l.modulos.join(" ")}${aviso}`,
    );
  }
  // EL MÓDULO QUE MARCA EL SUELO DEL RELOJ, con su margen propio. Es la otra
  // lectura del margen y la que avisa antes: mientras el más caro quepa en un
  // lote, el reparto tiene arreglo; el día que él solo pase del tope, ninguna
  // partición baja de ahí y hay que partir su batería. Es el mismo aviso que
  // `pendiente` da con `npc-director`, a dos mutantes de `tope_local`.
  const conReloj = ids
    .map((id) => ({ id, s: segundosDe(plan, huella, id) }))
    .filter((m): m is { id: string; s: number } => m.s !== undefined)
    .sort((a, b) => b.s - a.s);
  const peor = conReloj[0];
  if (peor) {
    const margen = tope - peor.s;
    console.log(
      margen >= 0
        ? `\n  El más caro es ${peor.id} con ${peor.s}s: está a ${margen}s (${(margen / 60).toFixed(1)} min) de ` +
            `no caber él solo. El primer test que se le añada lo saca del empaquetado, y entonces la ` +
            `respuesta es partir su batería, nunca subir tope_lote.`
        : // EN PRESENTE CUANDO YA PASÓ. La frase de arriba avisaba de un futuro
          // que el 2026-09-10 ya era pasado: `scene-validate` llevaba días
          // fuera del empaquetado y la salida seguía diciendo que le faltaba
          // «el primer test que se le añada» para salirse. Un número escrito
          // para justificar una decisión que nadie vuelve a leer en voz alta.
          `\n  El más caro es ${peor.id} con ${peor.s}s y YA NO CABE ÉL SOLO: se pasa del tope en ` +
            `${-margen}s (${(-margen / 60).toFixed(1)} min). La respuesta es partir su batería, ` +
            `nunca subir tope_lote.`,
    );
  }

  // EL TECHO DEL JOB, que es otra pregunta. Un lote que se pasa del tope llega
  // tarde; uno que se pasa del techo no llega: el job muere, no sube informe y
  // la corrida entera sale INCOMPLETA con el tag quieto. Esto se dice ANTES de
  // gastar los 45 minutos, no después (corrida 34493904935).
  const noCaben = lotesQueNoCaben(paquetes, plan.techo_job);
  for (const l of noCaben) {
    const presupuesto = presupuestoDelLote(l.segundos);
    const falta = presupuesto - plan.techo_job;
    console.log(
      `\n  ⛔ El lote ${l.lote} (${l.modulos.join(" ")}) NO CABE EN EL JOB: ${l.segundos}s medidos ` +
        `× ${HOLGURA_DEL_TECHO} de holgura más ${ARRANQUE_DEL_JOB_S}s de arranque son ${presupuesto}s, ` +
        `contra un techo de ${plan.techo_job}s (${(plan.techo_job / 60).toFixed(0)} min). Se pasa por ` +
        `${falta}s (${(falta / 60).toFixed(1)} min).\n` +
        `     No es que llegue tarde: MUERE Y NO DEJA INFORME, así que la corrida sale INCOMPLETA, el ` +
        `tag no se mueve y la siguiente vuelve a pedirlo todo — incluidos los módulos que sí midieron.`,
    );
  }
  if (noCaben.length === 0 && conReloj.length > 0) {
    // El margen del lote MÁS APRETADO contra el techo, siempre. Es el número
    // que hay que ver crecer o encogerse en la PR, no uno que solo aparece
    // cuando ya es tarde.
    const apretado = paquetes
      .filter((l) => l.medido)
      .sort((a, b) => b.segundos - a.segundos)[0];
    if (apretado) {
      const holgura = plan.techo_job - presupuestoDelLote(apretado.segundos);
      console.log(
        `\n  Contra el techo del job (${plan.techo_job}s), el lote más apretado es el ${apretado.lote} ` +
          `(${apretado.segundos}s): le sobran ${holgura}s (${(holgura / 60).toFixed(1)} min) con la ` +
          `holgura puesta.`,
      );
    }
  }

  const sinMedida = paquetes.filter((l) => !l.medido).length;
  if (sinMedida > 0) {
    console.log(
      `\n  ${sinMedida} módulo(s) sin medida de reloj van SOLOS, por la misma razón por la que ` +
        `permisoLocal rechaza el coste desconocido: un coste que nadie sabe no se supone barato. ` +
        `Se cura solo en cuanto los mida una corrida.`,
    );
  }

  const sha = opcional("--sha");
  if (sha === undefined) {
    console.log(`\n  (solo lectura: sin --sha/--desde/--run/--origen no se escribe el plan de la corrida)\n`);
    return;
  }
  const exige = (flag: string): string => {
    const v = opcional(flag);
    if (v === undefined || v === "") throw new Error(`lotes necesita ${flag} para escribir el plan`);
    return v;
  };
  const planCorrida: PlanDeCorrida = {
    sha,
    desde: exige("--desde"),
    run_id: exige("--run"),
    origen: origenValido(exige("--origen")),
    // LA LISTA COMPLETA, y aquí es donde se decide todo lo demás: la fusión la
    // leerá de aquí y no de los lotes que sobrevivan, así que un lote que muera
    // entero deja sus módulos pedidos y sin informe → INCOMPLETA y el tag
    // quieto. Ver `fusionaCorrida`.
    modulos_pedidos: [...ids].sort(),
    lotes: paquetes,
  };
  mkdirSync(dirname(RUTA_PLAN_CORRIDA), { recursive: true });
  writeFileSync(RUTA_PLAN_CORRIDA, `${JSON.stringify(planCorrida, null, 2)}\n`);
  console.log(`\n  Plan de la corrida en ${relative(coreRoot, RUTA_PLAN_CORRIDA)}\n`);

  const salida = process.env.GITHUB_OUTPUT;
  if (salida) {
    // La matriz que consume `fromJSON`. Un objeto por lote con sus ids ya
    // formateados: el job de medir no necesita leer el plan para saber qué le
    // toca, y así un fallo al bajar el artefacto no puede convertirse en un
    // lote que mide otra cosa.
    writeFileSync(
      salida,
      `matriz=${JSON.stringify(matrizDeLotes(paquetes))}\nlotes=${paquetes.length}\n`,
      { flag: "a" },
    );
  }
}

// ── verbo: fusionar (lo corre el job `reunir`) ───────────────────────────────

/** Junta el plan con los manifiestos parciales de cada lote y deja EXACTAMENTE
 *  lo que `traer` y `repartir` esperan: un `reports/mutation/` con un informe
 *  por módulo y un solo `corrida.json`. Los dos verbos de quien reparte no se
 *  enteran de que la corrida vino partida, que es el objetivo.
 *
 *    npm run mutacion -- fusionar --entrada <dir con los artefactos bajados>
 */
export function fusionar(argv: readonly string[]): void {
  const i = argv.indexOf("--entrada");
  const entrada = i < 0 ? undefined : argv[i + 1];
  if (!entrada) throw new Error("fusionar necesita --entrada <dir con los artefactos bajados>");

  const rutaPlan = join(entrada, "plan-corrida", "plan-corrida.json");
  if (!existsSync(rutaPlan)) {
    // Sin plan NO se fabrica una corrida con lo que haya llegado: eso es
    // justamente lo que haría que un lote muerto saliera COMPLETA.
    throw new Error(
      `no está el plan de la corrida en ${rutaPlan}. Sin él no se sabe qué se PIDIÓ medir, y ` +
        `reconstruirlo desde los lotes que llegaron haría que un lote caído se llevara consigo ` +
        `tanto lo pedido como lo medido: el veredicto diría COMPLETA y el tag se movería mintiendo.`,
    );
  }
  const plan = JSON.parse(readFileSync(rutaPlan, "utf8")) as PlanDeCorrida;

  // Cada lote subió su artefacto `informe-mutacion-<n>`; `download-artifact`
  // los deja como subdirectorios con ese nombre.
  const dirsDeLote = readdirSync(entrada)
    .filter((d) => d.startsWith("informe-mutacion-"))
    .sort();
  const parciales: Corrida[] = [];
  const ficheros: { modulo: string; origen: string }[] = [];
  for (const d of dirsDeLote) {
    const dir = join(entrada, d);
    const rutaParcial = join(dir, "corrida.json");
    if (!existsSync(rutaParcial)) {
      // Un artefacto sin manifiesto no es un lote medido: es un lote que subió
      // basura. Se dice y no se mezcla.
      console.log(`  ⚠ ${d} no trae corrida.json: se ignora y sus módulos cuentan como sin informe`);
      continue;
    }
    const parcial = JSON.parse(readFileSync(rutaParcial, "utf8")) as Corrida;
    // EL SELLO DE #420, ANTES DE MEZCLAR. Es lo que hace segura la fusión de N
    // artefactos: sin esto, juntar informes de varios sitios reabriría el
    // agujero que la PR anterior cerró.
    const presentes = informesDelDirectorio(dir);
    const errores = verificaDescarga(parcial, presentes);
    if (errores.length > 0) {
      throw new Error(
        `el lote ${d} no casa con su propio manifiesto:\n` + errores.map((e) => `  · ${e}`).join("\n"),
      );
    }
    parciales.push(parcial);
    for (const p of presentes) ficheros.push({ modulo: p.modulo, origen: join(dir, `${p.modulo}.json`) });
  }

  const corrida = fusionaCorrida(plan, parciales, new Date().toISOString());

  mkdirSync(DIR_INFORMES, { recursive: true });
  for (const f of readdirSync(DIR_INFORMES)) rmSync(join(DIR_INFORMES, f), { force: true });
  for (const f of ficheros) copyFileSync(f.origen, join(DIR_INFORMES, `${f.modulo}.json`));
  writeFileSync(RUTA_CORRIDA, `${JSON.stringify(corrida, null, 2)}\n`);

  const veredicto = veredictoDeCorrida(corrida, medidaDelDirectorio(DIR_INFORMES));
  const caidos = lotesSinNoticias(plan, parciales);
  console.log(
    `\nCorrida ${corrida.run_id} sobre ${corrida.sha.slice(0, 7)} (${corrida.origen}), ` +
      `${plan.lotes.length} lote(s)\n` +
      `  ${corrida.informes.length} informe(s) de ${corrida.modulos_pedidos.length} pedido(s)\n` +
      `  ${veredicto.completa ? "COMPLETA" : "INCOMPLETA"} — ${veredicto.porque}`,
  );
  if (caidos.length > 0) {
    // La línea NO repite el veredicto: lo cita. Antes afirmaba «la corrida es
    // INCOMPLETA» por su cuenta, y con un plan incoherente el mismo párrafo
    // decía COMPLETA dos líneas más arriba — dos frases contradictorias en la
    // misma salida, que se lee igual que un veredicto sin comprobar. Hoy la
    // convivencia es imposible (`fusionaCorrida` exige que los lotes y
    // `modulos_pedidos` sean el mismo conjunto), y aun así se deriva de
    // `veredicto` en vez de afirmarse aparte: dos fuentes para el mismo hecho
    // vuelven a divergir en cuanto una de las dos cambie.
    console.log(
      `  ⚠ ${caidos.length} lote(s) SIN NOTICIAS: ${caidos.map((l) => `${l.lote} (${l.modulos.join(", ")})`).join(" · ")}\n` +
        `    No subieron nada, y sus módulos siguen PEDIDOS y sin informe: por eso la corrida sale ` +
        `${veredicto.completa ? "COMPLETA (¡y no debería!)" : "INCOMPLETA"} y el tag ` +
        `${veredicto.mueveTag ? "SE MUEVE (¡y no debería!)" : "no se mueve"}.`,
    );
  }
  const salida = process.env.GITHUB_OUTPUT;
  if (salida) {
    writeFileSync(salida, `completa=${veredicto.completa}\nmueve_tag=${veredicto.mueveTag}\n`, { flag: "a" });
  }
  if (!veredicto.completa) process.exitCode = 1;
}

// ── verbo: manifiesto (lo escribe CI) ────────────────────────────────────────

export function manifiesto(argv: readonly string[]): void {
  const valor = (flag: string): string => {
    const i = argv.indexOf(flag);
    if (i < 0 || !argv[i + 1]) throw new Error(`manifiesto necesita ${flag}`);
    return argv[i + 1];
  };
  /** `--pedidos` es el ÚNICO flag que admite el vacío, y significa «todos los
   *  módulos del plan».
   *
   *  Lo manda así el propio workflow con el input TODOS (`echo "ids="`), y el
   *  `valor()` de arriba lo rechazaba —`!""` es `true`—, así que el paso del
   *  manifiesto moría con «manifiesto necesita --pedidos» DESPUÉS de haber
   *  medido: la corrida completa gastaba sus ~131 minutos de runner y subía sus
   *  33 informes sin `corrida.json`, o sea imposibles de repartir y sin mover el
   *  tag. La rama `pedidos.length > 0 ? … : leerPlan()` de abajo estaba escrita
   *  para este caso y no se podía alcanzar. No lo vio nadie porque el camino de
   *  diario es el del rango, que sí manda ids. */
  const listaPedida = (): string[] => {
    const i = argv.indexOf("--pedidos");
    if (i < 0 || argv[i + 1] === undefined) throw new Error("manifiesto necesita --pedidos");
    return argv[i + 1].split(/\s+/).filter(Boolean).sort();
  };
  const origen = origenValido(valor("--origen"));
  const pedidos = listaPedida();
  // El cronómetro que dejó `mutate.ts` en este mismo job. Si no está —una
  // corrida que ni llegó a medir— los informes viajan sin `segundos`, y esa
  // ausencia acaba mandando el módulo a un lote propio, que es la dirección
  // segura.
  const tiempos = existsSync(RUTA_TIEMPOS)
    ? (JSON.parse(readFileSync(RUTA_TIEMPOS, "utf8")) as Record<string, number>)
    : {};
  const corrida: Corrida = {
    sha: valor("--sha"),
    // Obligatorio: sin ancla el manifiesto no sirve para repartir, y un
    // manifiesto que se escribe igual sin ella deja el fallo para el día del
    // reparto, cuando el runner ya no está.
    desde: valor("--desde"),
    run_id: valor("--run"),
    origen,
    modulos_pedidos: pedidos.length > 0 ? pedidos : leerPlan().modulos.map((m) => m.id),
    informes: conCronometro(informesEnDisco(), tiempos),
    fecha: new Date().toISOString(),
  };
  mkdirSync(DIR_INFORMES, { recursive: true });
  writeFileSync(RUTA_CORRIDA, `${JSON.stringify(corrida, null, 2)}\n`);
  const veredicto = veredictoDeCorrida(corrida, medidaDelDirectorio(DIR_INFORMES));
  console.log(`${veredicto.completa ? "COMPLETA" : "INCOMPLETA"} — ${veredicto.porque}`);
  console.log(`  ancla:    ${corrida.desde}`);
  console.log(`  pedidos:  ${corrida.modulos_pedidos.join(" ")}`);
  console.log(
    `  informes: ${corrida.informes
      .map((i) => `${i.modulo}:${i.sha256.slice(0, 8)}${i.segundos === undefined ? "" : `:${i.segundos}s`}`)
      .join(" ")}`,
  );
  const salida = process.env.GITHUB_OUTPUT;
  if (salida) {
    writeFileSync(salida, `completa=${veredicto.completa}\nmueve_tag=${veredicto.mueveTag}\n`, { flag: "a" });
  }
}
