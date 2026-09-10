/** Cómo se compone la URL con la que el banco abre la página.
 *
 *  Vive aparte de `qa/run.mjs` —y no dentro, donde nació— porque es pura y
 *  porque el defecto que cierra (#476) es exactamente de los que se ven leyendo
 *  una cadena y no corriendo la batería entera: el runner pegaba sus
 *  parámetros DETRÁS de la URL con una concatenación literal
 *  (`${BASE}/${URL_QS}`), así que un `--url http://host/?offset=500` salía como
 *  `http://host/?offset=500/?input=scripted&…`. Esa URL no la sirve nadie: la
 *  corrida entera se ponía roja y el motivo que enseñaba era el del primer
 *  aserto de cada guion, o sea el juego. Un banco que miente sobre la causa
 *  manda a leer el fichero equivocado durante horas.
 *
 *  Las tres funciones son la misma decisión mirada por sus dos lados: qué le
 *  pone el banco a la URL, y qué le lee de la que ya venía escrita.
 */

/** La URL de `--url`, parseada. Fail-loud: una URL que no se puede parsear no
 *  es «sin query», es un error de quien la escribió, y degradarla a la de
 *  siempre sería medir en silencio contra otro stack. */
export function urlDeArranque(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`--url ${JSON.stringify(raw)} no es una URL: escríbela entera (http://host:puerto/…)`);
  }
  // Un `new URL("host:puerto")` sin esquema NO lanza: se lee como esquema
  // `host:` con el puerto de path, y de ahí sale una URL que el navegador no
  // sabe abrir y un `searchParams` vacío del que no se puede leer el bloque.
  // El olvido más fácil de escribir tiene que doler aquí, no tres capas abajo.
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(
      `--url ${JSON.stringify(raw)} no es una URL http(s): se lee como esquema ` +
        `"${u.protocol}". ¿Te falta el "http://" delante?`,
    );
  }
  return u;
}

/** El bloque de puertos que declara la URL de un stack ajeno (`?offset=N`).
 *
 *  El bloque de un stack lo dice SU URL: `?offset=` es cómo el cliente se
 *  entera (el navegador no tiene entorno), así que es también la única pista
 *  que tiene el runner sobre a qué bloque apunta un `--url`. Sin leerlo, el
 *  runner apuntaba el `ai=` de la página al motor falso del bloque BASE —el del
 *  vecino, o ninguno— y sondeaba los puertos equivocados para decidir si el
 *  stack seguía en pie. */
export function offsetDeLaUrl(raw) {
  const q = urlDeArranque(raw).searchParams.get("offset");
  if (q === null || q === "") return 0;
  if (!/^\d+$/.test(q)) throw new Error(`--url trae un offset que no es un número: ${JSON.stringify(q)}`);
  return Number(q);
}

/** La URL con la que se abre la página: los parámetros del bench MEZCLADOS en
 *  la que venga por `--url`, nunca pegados detrás.
 *
 *  `URLSearchParams` es lo único que sabe si hace falta `?` o `&`, y de paso
 *  conserva lo que el que escribió la URL puso ahí. Los parámetros del banco
 *  PISAN a los de la URL cuando coinciden: `input=scripted`, el motor falso y
 *  el pump del rAF no son preferencias, son las condiciones sin las cuales lo
 *  que se mide no es una corrida de banco. */
export function urlDeLaPagina(base, params) {
  const u = urlDeArranque(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
