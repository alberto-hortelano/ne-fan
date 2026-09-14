/** EL TURNO: un guion que rompe fuentes compartidas no puede correr dos veces a
 *  la vez (#572).
 *
 *  Los candados en negativo de `qa/` **mutan ficheros de producción a mano** y
 *  los restauran al salir, y para restaurarlos guardan una FOTO al arrancar.
 *  Con dos instancias eso se envenena solo: la segunda fotografía el árbol
 *  MIENTRAS la primera lo tiene roto, y al terminar «restaura» la mutación de
 *  la otra como si fuera el original.
 *
 *  Pasó el 2026-09-10 y dejó en el árbol dos líneas que ningún tipo rechaza:
 *  `matrizDeLotes` devolviendo las claves que el YAML NO lee, y `fusionar` sin
 *  verificar el sello de cada lote — el agujero que cerró #420. Ninguna rompía
 *  `npm run verify`.
 *
 *  Por qué el guardia que ya había no bastaba: `reports.qa-lotes` de una
 *  instancia VIVA y de una MUERTA se ven igual, y la receta que daba —«míralo y
 *  bórralo a mano»— es exactamente lo peor que se puede hacer en el primer
 *  caso. Con el pid dentro del turno, las dos situaciones se distinguen y cada
 *  una tiene su consejo.
 *
 *  UN SOLO TURNO PARA TODOS, y no uno por guion: los cinco mutan `nefan-core`
 *  y dos comparten además `reports/`. En CI no cuesta nada —el job
 *  `candados-headless` los corre en pasos separados, o sea en serie— y en local
 *  es justo lo que se quiere. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Fuera del árbol, como el lock de bloques de `qa/run.mjs` (#501): dos
 *  worktrees del mismo repo son dos árboles y UNA máquina, y lo que se está
 *  arbitrando —los fuentes de `nefan-core`— puede ser el mismo fichero visto
 *  desde dos sitios. Por uid, porque los procesos de otro usuario ni se pueden
 *  mirar ni se les puede reclamar el turno. */
export const DIR_TURNOS = join(tmpdir(), `nefan-qa-turnos-${process.getuid?.() ?? "sin-uid"}`);

/** ¿Sigue vivo el que tiene el turno? `kill(pid, 0)` no manda señal: pregunta.
 *  `EPERM` es un SÍ —existe, pero es de otro— y cualquier otro error es un no. */
export function estaVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/** Pide el turno `nombre`. Devuelve `{ok:true, soltar}` o `{ok:false, ...}` con
 *  el motivo y el consejo YA REDACTADO, que es la mitad del arreglo: quien lee
 *  esto está a punto de «arreglarlo a mano».
 *
 *  `dir` y `vivo` se inyectan para que la batería pueda ejercer las tres ramas
 *  —libre, ocupado por alguien vivo, huérfano— sin matar procesos de verdad. */
export function tomarTurno(nombre, { dir = DIR_TURNOS, vivo = estaVivo, pid = process.pid } = {}) {
  mkdirSync(dir, { recursive: true });
  const fichero = join(dir, `${nombre}.lock`);
  const intenta = () => {
    try {
      // `wx`: crear o fallar. Es la operación atómica; mirar-y-luego-crear
      // sería la misma carrera que este módulo viene a cerrar.
      writeFileSync(fichero, `${pid}\n`, { flag: "wx" });
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      return false;
    }
  };
  const suelta = () => rmSync(fichero, { force: true });

  if (intenta()) return { ok: true, fichero, soltar: suelta, reclamado: null };

  const crudo = (() => {
    try {
      return readFileSync(fichero, "utf8").trim();
    } catch {
      // Se soltó entre el EEXIST y la lectura: la carrera se resuelve
      // reintentando, no adivinando.
      return "";
    }
  })();
  const dueno = Number.parseInt(crudo, 10);

  if (dueno === pid) {
    // El turno es NUESTRO y alguien lo ha pedido dos veces. Reclamarlo en
    // silencio dejaría dos `soltar()` sobre el mismo fichero, y el segundo
    // abriría la puerta justo cuando el primero cree tenerla cerrada.
    return {
      ok: false,
      fichero,
      pid,
      porque: `este mismo proceso (pid ${pid}) ya tiene el turno «${nombre}»: se ha pedido dos veces`,
    };
  }

  if (Number.isInteger(dueno) && vivo(dueno)) {
    return {
      ok: false,
      fichero,
      pid: dueno,
      porque:
        `hay otra corrida de los candados EN MARCHA (pid ${dueno}).\n` +
        `  NO toques el árbol ni borres nada: está rompiendo fuentes a propósito y las restaura al salir.\n` +
        `  Espera a que acabe (o párala con Ctrl+C, que sí restaura) y vuelve a lanzar esto.`,
    };
  }

  // Huérfano: el dueño ya no existe, o el fichero no dice un pid legible.
  suelta();
  if (intenta()) {
    return {
      ok: true,
      fichero,
      soltar: suelta,
      reclamado: Number.isInteger(dueno) ? dueno : null,
    };
  }
  return {
    ok: false,
    fichero,
    pid: null,
    porque: `no se pudo tomar el turno en ${fichero} y tampoco identificar a su dueño: míralo a mano`,
  };
}

/** Lo que llama un candado: toma el turno o se planta, y lo suelta al salir.
 *
 *  Solo se engancha a `exit`, **no a SIGINT/SIGTERM**: registrar un manejador
 *  de señal desactiva el comportamiento por defecto de Node, y tres de los
 *  cinco candados no tienen manejador propio — dejarían de morir con Ctrl+C, un
 *  arreglo peor que el problema. Si una señal se lleva el proceso, el turno
 *  queda huérfano y lo reclama el siguiente, que es exactamente para lo que
 *  existe esa rama.
 *
 *  Se llama ANTES de fotografiar los fuentes. Ese es todo el asunto: la foto es
 *  lo que se envenena. */
export const VAR_TURNO = "NEFAN_QA_TURNO";

export function turnoDeCandados(nombre = "rompe-fuentes", opciones = {}) {
  // RE-ENTRANTE POR DESCENDENCIA, y no es un adorno: estos candados se corren
  // unos a otros como CHECKERS —`mutacion-reparto-en-lotes` lanza
  // `mutacion-cableado-en-negativo` para preguntarle si se entera de un
  // sabotaje—, así que el hijo pide el turno que su padre ya tiene. Sin esto,
  // el hijo salía con código 3 y el padre leía esa salida como «este checker no
  // se entera de nada»: un invariante real pasando por hallazgo sin candado.
  // (Lo vi al ponerlo, antes de commitearlo.)
  //
  // El hijo corre DENTRO del turno del padre, que es donde tiene que correr, y
  // no suelta nada al salir: la puerta la cierra quien la abrió.
  const heredado = Number.parseInt(process.env[VAR_TURNO] ?? "", 10);
  const vivo = opciones.vivo ?? estaVivo;
  if (Number.isInteger(heredado) && vivo(heredado)) {
    return { ok: true, heredadoDe: heredado, soltar: () => {}, reclamado: null };
  }

  const t = tomarTurno(nombre, opciones);
  if (!t.ok) {
    console.error(`\n⊘ NO SE TOMA EL TURNO: ${t.porque}\n`);
    process.exit(3);
  }
  if (t.reclamado !== null) {
    console.error(
      `· turno huérfano reclamado (era del pid ${t.reclamado}): aquella corrida murió sin restaurar.\n` +
        `  Mira \`git status\` antes de fiarte de lo que salga de aquí — puede haber quedado una mutación puesta.`,
    );
  }
  // Lo heredan los hijos por `spawnSync` sin `env` propio, que es como los
  // lanzan los cinco.
  process.env[VAR_TURNO] = String(opciones.pid ?? process.pid);
  process.on("exit", () => t.soltar());
  return t;
}
