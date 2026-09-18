/** #555 — La costura de ids entre el CHASIS y el SELECTOR DE MUNDO.
 *
 *  El chasis instala una vez por sesión un `<style>` con la distribución móvil
 *  del título, y SEIS de sus ocho bloques apuntan a ids que pinta otra hoja: el
 *  selector de mundo. Nada ataba las dos puntas. Si el selector renombraba
 *  `#ts-columns`, la rejilla dejaba de colapsar a una columna por debajo de 900
 *  px, el «✚ Crear mundo» se salía de la fila… y toda la batería seguía verde,
 *  porque ningún guion mira a la vez lo que escribe uno y lo que pinta el otro.
 *
 *  SE COMPARA LA SALIDA, NO EL FUENTE, y ésa es la decisión que evita el modo de
 *  fallo de la tanda F: `chasis.ts` escribe además ids con `el.id = …`
 *  (`#ts-mas`, `#ts-close`), invisibles a cualquier regex sobre el fichero. Aquí
 *  se lee el string que las dos funciones DEVUELVEN.
 *
 *  SON DOS ASERTOS Y HACEN FALTA LOS DOS:
 *
 *  1. el chasis estiliza EXACTAMENTE estos seis. Es el anti-tautología: sin él,
 *     borrar el bloque `@media` dejaría un censo vacío comparándose contra otro
 *     censo vacío, o sea verde sin comprobar nada.
 *  2. y los seis los PINTA el selector. Es lo que impide arreglar un rojo
 *     editando la foto: la lista de seis solo se puede tocar para casar con el
 *     CSS, porque el segundo aserto exige que alguien pinte cada id.
 *
 *  Renombrar los DOS lados a la vez pone rojo el aserto 1 hasta que la foto se
 *  actualice — el trinquete.
 *
 *  LO QUE NO MIDE, dicho para que nadie lo cuente de más: que el CSS haga lo que
 *  dice (que a 899 px la rejilla caiga a una columna). Eso es geometría de
 *  navegador y es de `qa/`. Esto mide que los dos ficheros hablan del MISMO
 *  elemento, que es justo lo que se rompía en silencio. Tampoco cubre las otras
 *  CINCO parejas del censo de #555 que siguen sin candado: la séptima
 *  —`#ts-sessions`, que lee `chasis.ts` y pinta `home.ts`— la cubre el bloque
 *  de abajo desde #663, cuando el corte de `home.ts` dejó de estar pendiente. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionMetadata } from "@nefan-core/src/narrative/types.js";
import { tarjetaDePartidaHtml } from "../src/ui/tarjeta-de-partida.js";
import {
  CSS_ESTRECHO_DEL_TITULO,
  loQueCuentaLaBanda,
  MARCA_DEL_HOME,
} from "../src/ui/titulo/chasis.js";
import { esqueletoDelHome } from "../src/ui/titulo/home.js";
import { esqueletoDelSelector } from "../src/ui/titulo/selector-de-mundo.js";

/** LA FOTO: los ids del selector que la distribución móvil del chasis retoca.
 *
 *  No se deriva de ninguno de los dos lados a propósito — derivarla de uno
 *  convertiría a este test en una tautología sobre ese lado. Se edita a mano, y
 *  solo se puede editar hacia algo que el selector pinte (aserto 2). */
const LOS_SEIS = [
  "ts-actions",
  "ts-charmode",
  "ts-columns",
  "ts-create-world",
  "ts-rendermode",
  "ts-worlds",
];

/** Los `#ts-…` que SALEN del CSS, sin duplicados y ordenados. `#title-screen`
 *  —el prefijo de todas las reglas— y `h1` quedan fuera: son del overlay, no de
 *  ninguna hoja, y son los otros dos de los ocho bloques. */
function idsQueEstilizaElChasis(): string[] {
  return [...new Set([...CSS_ESTRECHO_DEL_TITULO.matchAll(/#(ts-[a-z-]+)/g)].map((m) => m[1]))].sort();
}

/** Los ids que SALEN del esqueleto del selector, tal cual los pinta. */
function idsQuePintaElSelector(): string[] {
  return [...new Set([...esqueletoDelSelector().matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))].sort();
}

test("el chasis estiliza EXACTAMENTE estos seis ids del selector", () => {
  assert.deepEqual(idsQueEstilizaElChasis(), [...LOS_SEIS].sort());
});

test("y los seis los pinta el selector de mundo", () => {
  const pintados = idsQuePintaElSelector();
  const huerfanos = LOS_SEIS.filter((id) => !pintados.includes(id));
  assert.deepEqual(
    huerfanos,
    [],
    `el chasis estiliza ids que nadie pinta: ${huerfanos.join(", ")} — el selector pinta ${pintados.join(", ")}`,
  );
});

/* ──────────────────────────────────────────────────────────────────────────
 *  #663 — La SÉPTIMA pareja: la costura entre el CHASIS y el HOME.
 *
 *  La banda de «↓ hay N partidas más» mira DOS tokens del home y nada ataba
 *  ninguno de los dos: `#ts-sessions` para saber que la columna tiene el home
 *  dentro, y `.ts-save` para contar cuántas partidas quedan fuera. Si el home
 *  renombraba el id, `enElHome` pasaba a `false` y la banda contaba CONTROLES
 *  en la pantalla de partidas; si renombraba la clase, `fuera` valía 0 y la
 *  banda no salía NUNCA. Las dos averías son mudas y la batería entera sigue
 *  verde: los guiones miran si la banda SALE, con el número que sale, no si las
 *  dos puntas hablan del mismo elemento.
 *
 *  SE COMPARA LA SALIDA, NO EL FUENTE, igual que arriba. Aquí es además la
 *  única forma honesta: `CSS_ESTRECHO_DEL_TITULO.includes("ts-sessions")` vale
 *  `false` —el chasis nunca estilizó estos dos—, así que el lado del chasis no
 *  tenía ninguna salida contra la que comparar. Por eso los dos literales salen
 *  del cuerpo de `actualizarAvisoDeCorte` a `MARCA_DEL_HOME` y a
 *  `loQueCuentaLaBanda(enElHome)`, exactamente como `CSS_ESTRECHO_DEL_TITULO`
 *  salió del cuerpo de `montarChasis` y por el mismo motivo escrito.
 *
 *  SON TRES ASERTOS Y HACEN FALTA LOS TRES. El tercero es el ANTI-COLAPSO y
 *  tiene un defecto real detrás, #553: hasta entonces la banda contaba SIEMPRE
 *  la fila del home, así que en el selector de mundos se retiraba siempre y
 *  «Continuar →» quedaba cortado 17 px de sus 39 a 1440×900 sin que nada lo
 *  dijera. Colapsar el ternario a `return FILA_DE_PARTIDA` repone ese defecto
 *  exacto, y los asertos 1 y 2 se quedarían verdes.
 *
 *  NO HAY FOTO que mantener como en los seis de arriba, y es deliberado: cada
 *  aserto se pone rojo tocando UN solo lado, así que un censo a mano solo
 *  añadiría una tautología sobre el lado del que se derivara.
 *
 *  LO QUE NO MIDE, dicho antes de que lo cace nadie:
 *
 *  - Que la privada del chasis SIGA llamando a `loQueCuentaLaBanda`, o que
 *    `pintarHome` siga usando `esqueletoDelHome()`. Quien reteclee el literal
 *    donde se usa deja estos tres asertos verdes con el juego roto. Eso lo
 *    pillan los guiones 33 y 122, que conducen el juego real.
 *  - Que la banda salga cuando tiene que salir, ni con qué número, ni dónde.
 *    Eso es geometría de navegador y sigue siendo de `qa/`: por eso no muere
 *    ningún guion con este test (regla 2 del README del banco).
 * ────────────────────────────────────────────────────────────────────────── */

/** Un save de muestra. Los campos son los del tipo y ninguno de sus valores
 *  importa: lo que se mira es la CLASE del contenedor, que no depende del
 *  contenido. Sin `render_mode` a propósito — así la fila se pinta sin badges y
 *  el aserto no depende de `CONFIG.graphics.ai_skin`. */
const UN_SAVE: SessionMetadata = {
  session_id: "sesion_de_muestra",
  game_id: "alta_fantasia",
  updated_at: "2026-09-18T10:00:00Z",
  summary: "Robledo, al caer la tarde",
  scene_count: 3,
  entity_count: 7,
};

test("el chasis busca el home por un id que el home PINTA", () => {
  const id = MARCA_DEL_HOME.replace(/^#/, "");
  const pintados = [...esqueletoDelHome().matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(
    pintados.includes(id),
    `el chasis mira «${MARCA_DEL_HOME}» para saber que está en el home, y el home pinta ${pintados.join(", ")}`,
  );
});

test("y cuenta las partidas por una clase que la tarjeta PINTA", () => {
  const clase = loQueCuentaLaBanda(true).replace(/^\./, "");
  const clases = [...tarjetaDePartidaHtml(UN_SAVE).matchAll(/\bclass="([^"]+)"/g)].flatMap((m) =>
    m[1].split(/\s+/),
  );
  assert.ok(
    clases.includes(clase),
    `la banda cuenta «${loQueCuentaLaBanda(true)}» y la tarjeta de una partida pinta ${clases.join(", ")}`,
  );
});

test("y fuera del home NO cuenta lo mismo (#553)", () => {
  assert.notEqual(
    loQueCuentaLaBanda(false),
    loQueCuentaLaBanda(true),
    "colapsado: la banda contaría filas de partida en el selector de mundos, donde no hay ninguna, " +
      "y se retiraría siempre — que es exactamente el defecto que arregló #553",
  );
});
