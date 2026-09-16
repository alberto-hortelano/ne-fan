/** De quién es cada entrada del registro de errores del cliente.
 *
 *  Lo que se mide aquí NO es que la tabla sea la tabla —eso sería copiarla y
 *  salir verde sin comprobar nada—: son las CUATRO filas que un guion de `qa/`
 *  ata a una conducta observable, y la función que decide qué se queda. Si
 *  alguna de las cuatro se mueve, el guion que la ata se pone rojo a los treinta
 *  segundos de navegador; este fichero la caza en milisegundos y dice cuál.
 *
 *  Las otras filas no tienen aserto propio AQUÍ, y el motivo cambió al validar
 *  la PR: se escribió «no hay conducta observable colgando de ellas», y QA
 *  demostró que era falso —una fila mal puesta borra un diagnóstico que debía
 *  quedarse, o conserva uno que debía irse, y eso lo ve quien juega—. Quien las
 *  recorre una a una por el camino del jugador es
 *  `qa/guiones/143-el-registro-marca-de-quien-es-cada-entrada.mjs`, que no
 *  necesita este fichero para nada: lee la tabla del `dist` y la contrasta con
 *  una lista escrita a mano. Aquí se quedan las cuatro que atan un guion,
 *  porque son las que un rojo de 30 segundos de navegador tarda en explicar.
 *  Y la TOTALIDAD la sujeta el compilador: `Record` sobre la unión cerrada, así
 *  que una fuente nueva no compila sin fila. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PERTENENCIA_POR_FUENTE,
  loQueSobreviveALaPartida,
  pertenenciaDe,
  type FuenteDeError,
} from "../src/session/pertenencia-del-registro.js";

describe("PERTENENCIA_POR_FUENTE", () => {
  it("las cuatro fuentes que un guion ata, cada una con su guion", () => {
    // Guion 27 «el clon limpio quiere jugar»: el remedio de las hojas que falta
    // («…docs/assets-de-personaje.md») lo escribe `aspecto-del-jugador.ts` con
    // fuente `sprite`, y tiene que seguir en el panel DESPUÉS de que el
    // arranque falle y `session.leave()` aplique las facetas neutras.
    assert.equal(PERTENENCIA_POR_FUENTE.sprite, "maquina");
    // Guion 92 «el estilo que ofrece el título lo pone el bridge»: el aviso de
    // #537 se registra DENTRO de `startSession`, o sea antes del `enter()` que
    // dispara el olvido. Con `partida` no llega vivo a ningún aserto.
    assert.equal(PERTENENCIA_POR_FUENTE.arranque, "maquina");
    // Guion 82, candado de #497: el error de la partida que se abandona SÍ se
    // retira al volver al título. Es la fuente que el guion inyecta.
    assert.equal(PERTENENCIA_POR_FUENTE.session, "partida");
    // Y su vecina: lo que le pasa a la escena de ESA partida nombra tiles y
    // entidades que en la siguiente no existen.
    assert.equal(PERTENENCIA_POR_FUENTE.scene, "partida");
  });

  it("los dos lados están poblados: ni todo se va ni todo se queda", () => {
    // Un mutante que colapse la tabla entera a un solo valor pasa por encima de
    // los cuatro asertos de arriba solo si los rompe; este aserto lo caza
    // aunque alguien añada filas. Las dos conductas del registro tienen que
    // seguir siendo posibles.
    const lados = new Set(Object.values(PERTENENCIA_POR_FUENTE));
    assert.deepEqual([...lados].sort(), ["maquina", "partida"]);
  });
});

describe("pertenenciaDe", () => {
  it("es la MISMA respuesta que usa el filtro, porque el panel la PINTA", () => {
    // Existe aparte de `loQueSobreviveALaPartida` porque el cliente la llama
    // para marcar cada entrada en el panel (decisión del usuario: «marcar cada
    // entrada y filtrar al pintar»). Si las dos lecturas divergieran, el
    // jugador leería una etiqueta que no predice lo que hace el olvido.
    assert.equal(pertenenciaDe("sprite"), "maquina");
    assert.equal(pertenenciaDe("session"), "partida");
    // Y la fuente que nadie clasificó cae del mismo lado en las dos: se va.
    const inventada = "lo-que-sea" as FuenteDeError;
    assert.equal(pertenenciaDe(inventada), "partida");
    assert.deepEqual(loQueSobreviveALaPartida([{ source: inventada }]), []);
  });
});

/** La entrada del registro, vista por core: solo la fuente. Lo demás (el
 *  `message`, el `ts`, el `detail` que pinta el panel) es del cliente y la
 *  función es genérica justamente para no conocerlo. */
const entrada = (source: FuenteDeError, message: string) => ({ source, message });

describe("loQueSobreviveALaPartida", () => {
  it("se queda lo de la máquina, se va lo de la partida, y en el mismo orden", () => {
    const registro = [
      entrada("sprite", "faltan 10 de 10 hojas — mira docs/assets-de-personaje.md"),
      entrada("scene", "el atlas fps de tile_0_0 falló — se queda en clay"),
      entrada("arranque", "Esta partida usa un estilo de otro tema"),
      entrada("session", "session start/resume failed"),
      entrada("bridge", "el socket de la partida no abre"),
    ];
    assert.deepEqual(
      loQueSobreviveALaPartida(registro).map((e) => e.source),
      ["sprite", "arranque", "bridge"],
    );
  });

  it("no toca la lista que recibe: el panel repinta desde la que se devuelve", () => {
    const registro = [entrada("session", "se va"), entrada("sprite", "se queda")];
    const quedan = loQueSobreviveALaPartida(registro);
    assert.equal(registro.length, 2, "la lista de entrada sigue entera");
    assert.notEqual(quedan, registro, "devuelve una lista nueva");
  });

  it("un registro entero de la partida se queda vacío, y uno entero de la máquina entero", () => {
    assert.deepEqual(loQueSobreviveALaPartida([entrada("session", "a"), entrada("narrative", "b")]), []);
    const deLaMaquina = [entrada("config", "a"), entrada("title", "b")];
    assert.deepEqual(loQueSobreviveALaPartida(deLaMaquina), deLaMaquina);
    assert.deepEqual(loQueSobreviveALaPartida([]), []);
  });

  it("una fuente que nadie clasificó se va con la partida", () => {
    // Por el tipo no puede llegar: solo entra desde fuera del programa (un
    // guion de `qa/` que hace `errors.push` desde `page.evaluate`, la consola
    // del navegador). Sobrevive lo que ALGUIEN decidió que sobrevive, y aquí
    // queda escrito para que no se lea como un descuido.
    const inventada = [{ source: "lo-que-sea" as FuenteDeError, message: "x" }];
    assert.deepEqual(loQueSobreviveALaPartida(inventada), []);
  });
});
