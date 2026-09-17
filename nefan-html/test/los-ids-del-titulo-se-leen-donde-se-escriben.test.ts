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
 *  seis parejas del censo de #555: `#ts-sessions` (que lee `chasis.ts` y pinta
 *  `home.ts`) se queda fuera porque `home.ts` está clavado en el tope de 450 y
 *  extraerle el esqueleto obliga a cortarlo antes. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { CSS_ESTRECHO_DEL_TITULO } from "../src/ui/titulo/chasis.js";
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
