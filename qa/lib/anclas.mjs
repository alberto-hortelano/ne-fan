/** LAS ANCLAS DE LOS CANDADOS EN NEGATIVO: una sola forma de contarlas y de
 *  aplicarlas (#700).
 *
 *  Todo candado en negativo de `qa/` rompe código de producción por su TEXTO:
 *  un `buscar` que se sustituye por un `poner`. Si el `buscar` ya no está, el
 *  sabotaje no rompe nada; si está DOS veces, rompe la primera copia —que puede
 *  no ser la que el candado cree—. En los dos casos el guion da un veredicto
 *  sobre algo que no ha probado: verde por la razón equivocada, o un hallazgo
 *  inventado (la forma 1 de #700, medida: `reparto` acusó a `fusionar` de
 *  haberse quedado sin candado porque el patrón duplicado ponía rojo a
 *  `cableado` sobre el árbol limpio).
 *
 *  El recuento `split(buscar).length - 1` estaba copiado en cinco guiones y en
 *  `qa/lib/invariantes-en-negativo.mjs`, y el sexto guion
 *  —`mutacion-reparto-en-lotes.mjs`— no lo tenía: `includes` + `replace`. Aquí
 *  vive UNA vez y la usan todos, y la mide
 *  `nefan-core/test/las-anclas-de-los-candados.test.ts`.
 *
 *  Pura a propósito (sin `node:*`): quien la llama lee los ficheros.
 */

/** Aplica los pares EN ORDEN. Cada `buscar` tiene que aparecer EXACTAMENTE una
 *  vez en el texto tal como está en ese momento —con los pares anteriores ya
 *  aplicados—, o no se aplica nada.
 *
 *  POR QUÉ SOBRE EL TEXTO PARCHEADO y no sobre el original: la pregunta que el
 *  candado necesita contestada es «¿la sustitución que voy a hacer cae en UN
 *  solo sitio?», y eso solo lo sabe el texto sobre el que se hace. Contar sobre
 *  el original no ve dos averías reales: un `poner` anterior que CREA una
 *  segunda copia del `buscar` siguiente (la sustitución caería en la copia
 *  equivocada, que es la forma de #700) y uno que se lo COME (cero, y el par no
 *  rompe nada). El único caso en que el original sería más estricto —un ancla
 *  doble en el fuente que un par anterior deja única— es uno en que la
 *  sustitución ya es inequívoca.
 *
 *  Sustituye con `split`/`join` y no con `String.replace`: con un string como
 *  patrón, `replace` interpreta `$&`, `` $` ``, `$'` y `$n` en el `poner`, y un
 *  sabotaje que los llevara escribiría otra cosa de la que dice. `split` es
 *  además la misma operación que cuenta.
 *
 *  → `{ ok: true, texto }` o `{ ok: false, indice, buscar, veces }`. Lanza con una
 *  lista de pares vacía y con un `buscar` vacío: los dos son errores de la tabla. */
export function aplicarPares(texto, pares) {
  // Sin pares no hay sabotaje: devolver `ok` con el texto intacto sería dar
  // por roto algo que nadie ha tocado. Es un error de la tabla, igual que el
  // `buscar` vacío de abajo, y no se colapsa con «todas las anclas en su sitio».
  if (!Array.isArray(pares) || pares.length === 0) {
    throw new TypeError(`sin pares que aplicar (${JSON.stringify(pares)}): una entrada tiene que romper algo`);
  }
  let actual = texto;
  for (let indice = 0; indice < pares.length; indice++) {
    const [buscar, poner] = pares[indice];
    // Un `buscar` vacío casa en todas partes y en ninguna: es un error de la
    // tabla, no un ancla suelta, y no se colapsa con «aparece N veces».
    if (typeof buscar !== "string" || buscar === "") {
      throw new TypeError(`ancla ${indice}: el buscar tiene que ser un texto no vacío (${JSON.stringify(buscar)})`);
    }
    const trozos = actual.split(buscar);
    const veces = trozos.length - 1;
    if (veces !== 1) return { ok: false, indice, buscar, veces };
    actual = trozos.join(poner);
  }
  return { ok: true, texto: actual };
}

/** Las anclas que ya NO apuntan a donde creen. Vacío = la tabla está viva.
 *
 *  `entradas` = `[{ nombre, fichero, pares }]`; `leer(fichero)` devuelve el
 *  texto o `null` si el fichero no está, así que se puede medir con ficheros de
 *  mentira —que es como se prueba que sabe ponerse ROJO— sin tocar el árbol.
 *
 *  Cuenta con `aplicarPares`, o sea con la MISMA semántica secuencial con la
 *  que el guion va a sustituir: lo que dice el test estático es lo que hará el
 *  guion. Por entrada se para en el primer par suelto, porque sobre un texto a
 *  medio parchear no se puede seguir contando. `veces: null` es «el fichero no
 *  existe», que no es lo mismo que «no aparece» y no se colapsa con ello. */
export function anclasSueltas(entradas, leer) {
  const sueltas = [];
  for (const { nombre, fichero, pares } of entradas) {
    const texto = leer(fichero);
    if (texto === null) {
      sueltas.push({ nombre, fichero, buscar: pares[0]?.[0] ?? "", veces: null });
      continue;
    }
    const r = aplicarPares(texto, pares);
    if (!r.ok) sueltas.push({ nombre, fichero, buscar: r.buscar, veces: r.veces });
  }
  return sueltas;
}

/** Una línea legible por ancla suelta, para el rojo del test y el de los guiones. */
export function explicarAnclaSuelta({ nombre, fichero, buscar, veces }) {
  const primeraLinea = buscar.split("\n")[0].trim();
  const cuantas = veces === null ? "el fichero no existe" : `aparece ${veces} veces`;
  return `${nombre}\n     ${fichero}: ${cuantas} → «${primeraLinea}»`;
}
