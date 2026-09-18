/** DE QUIÉN ES EL SIM que describe un `state_update`, y si eso es de quien lo
 *  recibe. Solo eso.
 *
 *  EL PROBLEMA (#659). El bridge tiene UN sim y su combatiente `player`
 *  también es uno. Los cuatro emisores de `state_update` contestan al socket
 *  que les habló —unicast— y hasta hoy el mensaje no decía NADA de a qué
 *  partida pertenecía lo que llevaba dentro. Con `canDrive` dejando conducir a
 *  cualquiera cuando el mundo no tiene dueño (`bridge/world-claim.ts`), esto
 *  pasa de verdad y es la firma del guion 80: se cierra el socket de la página
 *  que jugaba, `release()` deja el sim EN PIE con su jugador y sus NPCs, la
 *  página siguiente manda un `input` y recibe de vuelta la vida ambiental de
 *  una partida que ya no existe — «el bridge mueve al NPC X y el cliente no lo
 *  tiene en escena», entradas heredadas en un mundo que nunca las pidió.
 *
 *  POR QUÉ NO ES UN `sessionId: string`, que es lo que pedía el issue: el
 *  `state_update` es el ÚNICO de los cinco canales que sirve a DOS regímenes
 *  de direccionamiento. La partida del jugador lo recibe por su sesión, y el
 *  selector «Room» lo recibe sin sesión ninguna. Con un `string`, el `""` de
 *  «no hay partida» y el `""` de «esto es una escena de prueba» son el mismo
 *  valor, y al colapsarlos vuelven los dos fallos en vez de uno: la página que
 *  carga una fixture con una sesión rancia en el bridge descartaría **su
 *  propia respuesta** de `load_room`, y una página recién abierta heredaría la
 *  fixture de la anterior. Tres identidades, y el tipo no deja escribir la
 *  cuarta.
 *
 *  POR QUÉ NO SE LLAMA `sessionId` EL CAMPO: porque `ConSelloDeSesion`
 *  (`bridge/context.ts`) se DERIVA de `ServerMessage` buscando ese nombre, así
 *  que un `sessionId` de primer nivel en `state_update` lo sellarían los dos
 *  selladores de sesión con «la sesión que el bridge tenga cargada al emitir»
 *  — que es justo la mentira que #313 quitó de la pre-generación. Este sello
 *  lo escribe un verbo propio del transporte (`enviarEstado`) desde la única
 *  fuente que sabe la respuesta (`world-claim.ts`).
 *
 *  Módulo PURO: no toca el DOM ni `node:*`. Su batería es
 *  `test/dueno-del-sim.test.ts` y su medida de mutación va aparte
 *  (`mutation-targets.json`). Vive en core y no en el cliente por el
 *  precedente de `status-reparto.ts`: la decisión de «esto no es mío» se puede
 *  poner roja aquí, y un `if` suelto en `net/game-client.ts` nace sin nada que
 *  lo mida (`arch-rules.json` → `la-logica-de-juego-no-vuelve-al-cliente`).
 */

/** A quién pertenece lo que hay DENTRO del sim del bridge.
 *
 *  · `partida` — lo tomó `claimForSession`: es el jugador de esa sesión.
 *  · `prueba`  — lo tomó `claimForFixture`: el selector «Room», un muñeco.
 *  · `nadie`   — sim recién arrancado, jamás reclamado por nadie.
 *
 *  Lo que NO es: «quién conduce AHORA». Soltar el mundo (`release`) no cambia
 *  lo que hay dentro del sim, así que no cambia esto — y ése es exactamente el
 *  arreglo de #659: el socket que llega después recibe `{de:"partida"}` con el
 *  id de la partida muerta y lo tira. */
export type DuenoDelSim =
  | { de: "partida"; sessionId: string }
  | { de: "prueba" }
  | { de: "nadie" };

/** Qué sim espera ver una página, a partir de lo que ella misma sabe: el id de
 *  la partida que tiene aplicada ("" si está en el título) y si ha cargado una
 *  fixture del selector «Room».
 *
 *  EL ORDEN DE LAS DOS REGLAS ES EL DISEÑO. La prueba manda sobre la sesión, y
 *  no al revés, porque el bridge hace lo mismo: `handleLoadRoom` llama a
 *  `claimForFixture` HAYA O NO sesión cargada, así que una página que abre el
 *  selector con una partida a medias tiene que reconocer como suyo el
 *  `{de:"prueba"}` que va a recibir. Con las reglas al revés descartaría su
 *  propia respuesta de `load_room`, que es la trampa que esta pieza vino a no
 *  caer. */
export function identidadDelCliente(sessionId: string, enPrueba: boolean): DuenoDelSim {
  if (enPrueba) return { de: "prueba" };
  if (sessionId !== "") return { de: "partida", sessionId };
  return { de: "nadie" };
}

/** Qué hacer con un `state_update` que acaba de llegar. */
export type EstadoRepartido =
  /** Es de esta página: se aplica al mundo. */
  | { destino: "aplicar" }
  /** Es de otra: a la basura, y se dice DE QUIÉN era. Sin esa línea, «no ha
   *  llegado» y «llegó y se tiró» son el mismo verde, que es lo que costó las
   *  horas de banco del guion 80. */
  | { destino: "descartado"; deQuien: string };

/** Se aplica si y solo si las dos identidades son LA MISMA. No hay regla de
 *  cortesía como la del `phase:"error"` ajeno de `repartirStatus`: un frame de
 *  simulación de otra partida no tiene nada que decirle a ésta — no es un
 *  aviso, son coordenadas. */
export function repartirEstado(delSim: DuenoDelSim, delCliente: DuenoDelSim): EstadoRepartido {
  if (delSim.de === "partida" && delCliente.de === "partida") {
    return delSim.sessionId === delCliente.sessionId
      ? { destino: "aplicar" }
      : { destino: "descartado", deQuien: describirDueno(delSim) };
  }
  if (delSim.de === delCliente.de) return { destino: "aplicar" };
  return { destino: "descartado", deQuien: describirDueno(delSim) };
}

/** De quién era, para la línea del registro del jugador. En español, como todo
 *  lo que el jugador lee. */
export function describirDueno(dueno: DuenoDelSim): string {
  switch (dueno.de) {
    case "partida":
      return `la partida «${dueno.sessionId}»`;
    case "prueba":
      return "una escena de prueba";
    case "nadie":
      return "nadie";
  }
}
