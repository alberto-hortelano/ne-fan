/** `mutacion-reparto-en-lotes.mjs` se NIEGA a medir con una línea base roja
 *  (#722, tanda BC).
 *
 *  POR QUÉ EXISTE. En la corrida completa (sin `--solo-vigentes`), `reparto`
 *  corre cada checker sobre el árbol limpio y luego rompe cada ABIERTO mirando
 *  si la firma del checker CAMBIA. Un checker que ya sale rojo en limpio no
 *  puede cambiar con ningún probe, y hasta #722 el guion comparaba igual: cada
 *  probe que solo ese checker vigilaba salía como «SIN CANDADO Y SIN ISSUE»
 *  inventado. Medido el 2026-09-24 con `cableado` saboteado a `exit 1` y el
 *  guion de antes: «✖ SIN CANDADO Y SIN ISSUE  fusión · `fusionar` deja de
 *  verificar el SELLO de cada lote (#420 reabierto)», que es exactamente la
 *  acusación falsa de la forma 1 de #700. Los tres hermanos
 *  (`mutacion-candados`, `contrato`, `bateria`) ya se negaban; ahora `reparto`
 *  también, antes del primer probe.
 *
 *  CÓMO. Sabotea los DOS checkers caros con una línea tras sus imports, así
 *  que la línea base cuesta lo que la batería (segundos) y no los ~60 s de los
 *  dos guiones en negativo:
 *   · `mutacion-cableado-en-negativo.mjs` → `process.exit(1)`: base `cableado:1`.
 *   · `mutacion-candados-en-negativo.mjs` → se mata con SIGKILL: status `null`,
 *     que es la forma que toma un checker que se come su `timeout` y la que el
 *     issue no nombraba. `null` es base rota igual que `1`.
 *  Y exige: exit 1, «LÍNEA BASE ROJA» nombrando las dos firmas, ningún probe
 *  corrido («lo caza:» ni «SIN CANDADO»), la cuenta en el resumen y el motivo
 *  en el veredicto. Restaura byte a byte.
 *
 *  LO QUE NO MIDE: la corrida completa sobre la base VERDE (~11-16 min, no la
 *  corre CI); el modo `--solo-vigentes`, que no llega a la base, lo sujeta el
 *  guion 164.
 *
 *      node qa/run.mjs --sin-navegador 202
 *
 *  AVISO: escribe en el árbol de trabajo. Se niega a arrancar si los dos
 *  ficheros que va a tocar vienen sucios, porque entonces no puede devolverlos.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { turnoDeCandados } from "../lib/turno-exclusivo.mjs";

export const sinMotor = "sabotea dos guiones de qa/ y corre `mutacion-reparto-en-lotes.mjs` completo en un subproceso; no abre partida ni habla con el motor";
export const sinNavegador = "corre un guion headless de qa/ en un subproceso y afirma sobre su exit y su salida; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUION = join(RAIZ, "qa", "mutacion-reparto-en-lotes.mjs");

/** El sabotaje va tras la ÚLTIMA línea de import, que es la misma en los dos:
 *  antes de pedir el turno y antes de tocar nada. */
const ANCLA = 'import { turnoDeCandados } from "./lib/turno-exclusivo.mjs";';
const SABOTAJES = [
  { fichero: join(RAIZ, "qa", "mutacion-cableado-en-negativo.mjs"), linea: "process.exit(1);", firma: "cableado:1" },
  {
    fichero: join(RAIZ, "qa", "mutacion-candados-en-negativo.mjs"),
    linea: 'process.kill(process.pid, "SIGKILL");',
    firma: "candados:null",
  },
];
const FICHEROS = SABOTAJES.map((s) => s.fichero);

export default async function (ctx) {
  const sucio = spawnSync("git", ["status", "--porcelain", "--", ...FICHEROS.map((f) => relative(RAIZ, f))], {
    cwd: RAIZ,
    encoding: "utf8",
  });
  if ((sucio.stdout ?? "").trim()) {
    ctx.expect(
      "los ficheros que este guion reescribe vienen limpios",
      false,
      `hay cambios sin commitear:\n${sucio.stdout.trim()}\n  commitéalos o guárdalos: este guion restaura al contenido del disco de ANTES de arrancar`,
    );
    return;
  }

  turnoDeCandados("rompe-fuentes");
  const original = new Map(FICHEROS.map((f) => [f, readFileSync(f, "utf8")]));
  const restaura = () => {
    for (const [f, txt] of original) writeFileSync(f, txt);
  };
  for (const [señal, codigo] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.on(señal, () => {
      restaura();
      process.exit(codigo);
    });
  }

  try {
    for (const s of SABOTAJES) {
      const texto = original.get(s.fichero);
      const veces = texto.split(ANCLA).length - 1;
      ctx.expect(`${relative(RAIZ, s.fichero)}: el ancla del sabotaje está una vez`, veces === 1, `aparece ${veces} veces`);
      if (veces !== 1) return;
      writeFileSync(s.fichero, texto.split(ANCLA).join(`${ANCLA}\n${s.linea} // guion 202 (#722)`));
    }

    const r = spawnSync("node", [GUION], { cwd: RAIZ, encoding: "utf8" });
    const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    ctx.log(`  · reparto completo con la base saboteada: exit ${r.status}`);

    ctx.expect("sale con 1", r.status === 1, `exit ${r.status}:\n${salida.slice(-1500)}`);
    const cabecera = /^✖ LÍNEA BASE ROJA {2}(.+)$/mu.exec(salida);
    ctx.expect(
      "dice «LÍNEA BASE ROJA» nombrando las dos firmas rotas (`1` y `null`)",
      cabecera !== null && SABOTAJES.every((s) => cabecera[1].split(" · ").includes(s.firma)),
      cabecera === null ? `no aparece «✖ LÍNEA BASE ROJA»\n${salida.slice(-1500)}` : `nombra «${cabecera[1]}»`,
    );
    ctx.expect(
      "no corre ningún probe: ni «lo caza:» ni «SIN CANDADO»",
      !salida.includes("lo caza:") && !salida.includes("SIN CANDADO"),
      "ha medido probes contra una base rota: los veredictos de esos probes son inventados",
    );
    ctx.expect(
      "el resumen cuenta los checkers rojos y el veredicto da el motivo",
      /^Checkers rojos en la línea base\s*: 2$/mu.test(salida) && salida.includes("la línea base ya está roja ("),
      "falta «Checkers rojos en la línea base : 2» o el motivo en el veredicto",
    );
  } finally {
    restaura();
  }

  const noRestaurados = FICHEROS.filter((f) => readFileSync(f, "utf8") !== original.get(f)).map((f) => relative(RAIZ, f));
  ctx.expect(
    "los dos ficheros vuelven a estar byte a byte como estaban",
    noRestaurados.length === 0,
    `NO SE RESTAURÓ: ${noRestaurados.join(", ")} — revísalo con git diff antes de seguir`,
  );
}
