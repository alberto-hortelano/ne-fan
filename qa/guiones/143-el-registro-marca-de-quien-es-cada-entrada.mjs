/** De quién es cada entrada del registro, EN LA TRANSICIÓN DE ENTRAR.
 *
 *  Escrito por QA al validar la PR 2 de la tanda F (`docs/agents/
 *  2026-09-16-el-banco-vuelve-a-medir/qa-2.md`). La PR contesta la pregunta que
 *  #497 dejó abierta —«¿qué distingue un error que se va con la partida de uno
 *  que sigue siendo cierto después?»— con una tabla de QUINCE filas en core
 *  (`nefan-core/src/session/pertenencia-del-registro.ts`) y un filtro en el
 *  cliente (`ErrorLog.olvidarLaPartida`), cableado a la faceta `errores`, que
 *  dispara en CADA cambio de id de sesión.
 *
 *  ── Lo que ya estaba medido, y lo que no ─────────────────────────────────
 *
 *  - El **82** mide la transición de SALIR (partida → título) y DOS filas:
 *    `session` (se va) y `sprite` (se queda). Es la pareja de #497.
 *  - El **27** mide que el remedio del clon (`sprite`) sobrevive al `leave()`
 *    de un arranque que falla; el **92**, que el aviso de estilo (`arranque`)
 *    sobrevive al `enter()`.
 *  - Nadie medía **la transición de ENTRAR con una entrada de la PARTIDA
 *    delante**, y ahí hay conducta: el título empuja entradas antes de que
 *    exista ninguna partida —`paso(bootstrap(), "session", …)` en `main.ts` y
 *    el «la pre-generación del mundo falló» de `ui/title-screen.ts`, que es
 *    `narrative`— y esas se RETIRAN al empezar a jugar. Con el olvido cableado
 *    solo a la salida, el 27, el 82 y el 92 siguen VERDES los tres y esa mitad
 *    no la ve nadie (comprobado en negativo abajo).
 *  - Y **diez de las catorce filas no tenían conducta observable medida**: su
 *    clasificación solo la sujetaba el compilador, que obliga a poner una fila
 *    pero no a que la fila sea la correcta. Una fila equivocada la nota quien
 *    juega —un diagnóstico que se va cuando no debía, o uno que se queda para
 *    siempre—, así que aquí se recorren LAS QUINCE por el camino del jugador.
 *
 *  ── Qué afirma ───────────────────────────────────────────────────────────
 *
 *  QUINCE FILAS EL 16-09 AL ESCRIBIRSE, CATORCE AL CERRARSE LA PR: `fps-atlas`
 *  murió con la corrección del Hallazgo 2 (abajo). Este guion salió ROJO en su
 *  aserto de totalidad cuando la fila desapareció, que es exactamente para lo
 *  que ese aserto existe, y la lista de abajo se actualizó A MANO.
 *
 *  Con el TÍTULO delante y sin ninguna partida, se registra una entrada por
 *  cada fuente (la misma puerta que usa el cliente, `errors.push`), se pulsa
 *  «Comenzar» —el `enter` de verdad— y se lee el panel: las de la MÁQUINA
 *  siguen ahí y las de la PARTIDA no. Fila a fila, con el nombre de la fuente
 *  en el aserto, para que un rojo diga CUÁL se movió.
 *
 *  La lista de lo esperado NO se deduce de la tabla que se está midiendo: las
 *  cuatro filas que ata un guion (`session`, `scene`, `sprite`, `arranque`) van
 *  escritas a mano aquí, y para las once restantes se COMPARA la tabla de core
 *  con esta lista — si alguien añade, quita o mueve una fila sin pasar por
 *  aquí, el guion sale rojo diciendo cuál. Lo que se mide de verdad no es la
 *  tabla (eso lo hace `test/pertenencia-del-registro.test.ts` sin navegador):
 *  es el CABLE — que el cliente la consulte, en la transición correcta, y
 *  repinte el panel con lo que vuelve.
 *
 *  ── PROBADO EN NEGATIVO (2026-09-16), tres sabotajes, restaurado entre uno y
 *  otro ───────────────────────────────────────────────────────────────────
 *
 *   1. `olvidarLaPartida()` → `this.entries = []` (el defecto de #497 que la
 *      tanda F cierra): ROJAS las doce de la máquina, verdes las tres de la
 *      partida.
 *   2. `olvidarLaPartida()` → no-op: ROJAS las tres de la partida, verdes las
 *      doce de la máquina.
 *   3. la faceta `errores` de `main.ts` olvidando SOLO al salir
 *      (`({ sessionId }) => { if (!sessionId) errors.olvidarLaPartida(); }`):
 *      ROJAS las tres de la partida — y el 27, el 82 y el 92 **siguen verdes
 *      los tres**, que es por qué este guion existe.
 *
 *  Y los dos asertos de la MARCA PINTADA, añadidos al cerrar la PR con el
 *  Hallazgo 3, probados aparte en `ui/error-log.ts` (2026-09-16):
 *
 *   4. `pertenenciaDe(e.source)` → `"maquina"` fijo en `renderEntry`: ROJOS LOS
 *      DOS —`["session: maquina/máquina", "scene: maquina/máquina", …]` y
 *      `clases pintadas: ["maquina"]`—, y los bloques 2 y 3 pasan enteros, que
 *      es lo que hace falta ver: el filtrado puede estar bien y la marca
 *      mentir. (Escrito antes de correrlo decía «verde el primero»; se midió y
 *      no lo era, porque ese aserto compara contra la tabla, no solo contra sí
 *      mismo. Queda la corrección, no la predicción.)
 *   5. el `<span class="error-log__pertenencia">` quitado del HTML: rojo el
 *      PRIMERO —`14 de 14 leídas · mal marcadas: ["title: maquina/", …]`, o sea
 *      el atributo puesto y la palabra vacía— y **verde el segundo**, que solo
 *      mira el `data-`. Por eso son dos y no uno.
 *
 *  ── Lo que este guion NO juzga, y lo que pasó con lo que dejó abierto ────
 *
 *  Afirma la tabla TAL COMO ESTÁ, no que esté bien. QA dejó abierto en
 *  `qa-2.md` (Hallazgo 2) que tres filas clasificadas como MÁQUINA tenían algún
 *  emisor cuyo texto nombraba la partida. **Las tres se resolvieron antes de
 *  cerrar la PR**, y no moviendo la fila sino el EMISOR, que es donde estaba el
 *  error:
 *
 *   - `fps-atlas` **ya no existe**. Su único emisor era «re-disparo del atlas
 *     de <tile>», o sea lo mismo que registran sus tres hermanos del fichero
 *     como `scene`; retiquetado ese, la fuente se quedó sin emisor y se fue
 *     entera, como se había ido `player`.
 *   - `render` conserva SOLO el motor (el chunk de three.js, la excepción del
 *     bucle). «El tile X no compone» y «el rótulo Y no se puede medir» pasaron
 *     a `scene`: nombran cosas de la partida y aquí se habrían quedado para
 *     siempre.
 *   - `portrait` **se queda en MÁQUINA**, y esta vez con la razón medida en vez
 *     de supuesta: su único emisor está DESPUÉS de una cadena de respaldo que
 *     prueba la skin y luego el modelo base, así que solo se alcanza cuando
 *     falla también el base —que es local—, o sea en el clon sin hojas. Mismo
 *     caso y mismo remedio que `sprite`.
 *
 *  Lo que sigue valiendo: si alguien mueve una fila sin pasar por aquí, este
 *  guion sale ROJO diciendo cuál. Mover una fila es una decisión y tiene que
 *  verse — y la primera vez que pasó fue con `fps-atlas`, dos horas después de
 *  escribir esto. MEDIDO, devolviendo esa fila a la lista de aquí sin tocar
 *  core: `✘ las fuentes de core son EXACTAMENTE las que este guion recorre —
 *  solo en core: [] · solo aquí: [fps-atlas]`.
 *
 *  Cero créditos: motor falso del runner y `renderMode: "vector"` (no se pide
 *  el atlas de superficies).
 */
import { PERTENENCIA_POR_FUENTE } from "../../nefan-core/dist/src/session/pertenencia-del-registro.js";
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

/** La marca con la que se distinguen LAS MÍAS de las que deja el juego. */
const MARCA = "QA143";

/** Lo que esta batería espera de cada fuente, escrito A MANO y no leído de la
 *  tabla que se mide. Las cuatro con guion detrás llevan el número del guion
 *  que las ata; las once restantes, el sujeto en media línea. */
const ESPERADO = {
  // — De la PARTIDA: se van con ella —
  narrative: "partida", // lo que cuenta el motor de ESTA partida
  scene: "partida", // el tile, el atlas, el scatter, la colisión de ESTA escena
  session: "partida", // el candado de #497, guion 82
  // — De la MÁQUINA: siguen siendo ciertas sin ella —
  arranque: "maquina", // el aviso de estilo de #537, guion 92
  bridge: "maquina", // el proceso de al lado no está o contesta ilegible
  config: "maquina", // el config del juego en disco es imposible
  "dev-menu": "maquina", // las herramientas de desarrollo del checkout
  "graphics-mode": "maquina", // preferencia de render de esta máquina
  history: "maquina", // el libro de historia como ventana
  input: "maquina", // teclado, ratón, el proveedor de `?input=`
  portrait: "maquina", // solo salta si falla TAMBIÉN el modelo base: faltan hojas
  render: "maquina", // el chunk de three.js y el bucle, y ya solo eso
  sprite: "maquina", // el clon sin hojas de personaje, guion 27
  title: "maquina", // la pantalla que vive ENTRE partidas
};

/** El panel tal y como queda en el DOM, con su fuente. Se lee el DOM y no la
 *  lista de dentro del módulo: lo que importa es que el panel REPINTE, que es
 *  lo que ve quien juega. */
const leerPanel = (ctx) =>
  ctx.page.evaluate(() =>
    [...document.querySelectorAll("#error-log .error-log__entry")].map((e) => ({
      fuente: (e.querySelector(".error-log__source")?.textContent ?? "").trim(),
      msg: (e.querySelector(".error-log__msg")?.textContent ?? "").trim(),
      // La marca PINTADA: el atributo con el que el CSS separa las dos clases y
      // la palabra que lee quien mira. Se leen las dos porque un `data-` sin
      // palabra no lo ve nadie y una palabra sin `data-` deja el filete mudo.
      marca: e.getAttribute("data-pertenencia") ?? "",
      palabra: (e.querySelector(".error-log__pertenencia")?.textContent ?? "").trim(),
    })),
  );

const mias = (entradas) =>
  new Set(entradas.filter((e) => e.msg.startsWith(`${MARCA}:`)).map((e) => e.fuente));

export default async function (ctx) {
  const fuentes = Object.keys(ESPERADO).sort();

  // ── 0 · La lista de arriba y la tabla de core dicen lo mismo ──────────────
  // Si no, este guion mide una tabla que ya no existe y hay que actualizarlo
  // A MANO, que es el punto: añadir una fila es decidir de qué lado está.
  const enCore = Object.keys(PERTENENCIA_POR_FUENTE).sort();
  const soloEnCore = enCore.filter((f) => !fuentes.includes(f));
  const soloAqui = fuentes.filter((f) => !enCore.includes(f));
  ctx.expect(
    "las fuentes de core son EXACTAMENTE las que este guion recorre",
    soloEnCore.length === 0 && soloAqui.length === 0,
    `solo en core: [${soloEnCore}] · solo aquí: [${soloAqui}]`,
  );
  const movidas = enCore.filter(
    (f) => ESPERADO[f] !== undefined && PERTENENCIA_POR_FUENTE[f] !== ESPERADO[f],
  );
  ctx.expect(
    "…y ninguna ha cambiado de lado sin pasar por aquí",
    movidas.length === 0,
    movidas.map((f) => `${f}: ${ESPERADO[f]} → ${PERTENENCIA_POR_FUENTE[f]}`).join(", "),
  );

  // ── 1 · Con el TÍTULO delante, una entrada por fuente ─────────────────────
  // El título es el estado en el que NO hay partida, que es donde el cliente
  // registra de verdad cosas de las dos clases (el bootstrap que no levanta, la
  // pre-generación que falla) y donde la siguiente transición es un `enter`.
  const elegido = await nuevaPartida(ctx, {
    gameId: "alta_fantasia",
    renderMode: "vector",
    charMode: "vector",
  });
  ctx.log(`mundo elegido: ${elegido.gameId} · estilo ${elegido.styleId}`);

  await ctx.page.evaluate(
    async ([lista, marca]) => {
      const { errors } = await import("/src/ui/error-log.ts");
      for (const f of lista) errors.push(f, `${marca}:${f} — entrada de prueba de QA`);
    },
    [fuentes, MARCA],
  );

  const antes = await leerPanel(ctx);
  const presentesAntes = mias(antes);
  ctx.log(`registradas con el título delante: ${[...presentesAntes].sort().join(", ")}`);
  ctx.expect(
    "PRECONDICIÓN — todas las entradas están en el panel antes de entrar (si no, no hay nada que filtrar)",
    fuentes.every((f) => presentesAntes.has(f)),
    `faltan: [${fuentes.filter((f) => !presentesAntes.has(f))}]`,
  );
  await ctx.shot("registro-con-todas-antes-de-entrar");

  // ── 1 bis · LA MARCA SE PINTA, y dice lo mismo que la tabla ───────────────
  // La decisión del usuario fue «marcar cada entrada Y FILTRAR al pintar». El
  // filtrado lo miden los bloques 2 y 3; esto es la otra mitad, que hasta el
  // cierre de la PR no existía: el panel mezcla las dos clases y sin marca una
  // partida recién empezada se lee como un mundo que nace roto (Hallazgo 3 de
  // `qa-2.md`). Se afirma sobre las MÍAS, que son las quince fuentes: cada una
  // lleva su atributo y su palabra, y las dos dicen lo que dice la tabla. Un
  // panel que marcara todo igual —o al revés— pasa los bloques 2 y 3 enteros.
  const marcadas = antes.filter((e) => e.msg.startsWith(`${MARCA}:`));
  const PALABRA = { maquina: "máquina", partida: "partida" };
  const malMarcadas = marcadas.filter((e) => {
    const f = e.msg.slice(MARCA.length + 1).split(" ")[0];
    return e.marca !== ESPERADO[f] || e.palabra !== PALABRA[ESPERADO[f]];
  });
  ctx.log(
    `marcas pintadas: ${JSON.stringify(
      Object.fromEntries(marcadas.map((e) => [e.fuente, `${e.marca}/${e.palabra}`])),
    )}`,
  );
  ctx.expect(
    "cada entrada del panel lleva PINTADO de quién es, y coincide con la tabla de core",
    marcadas.length === fuentes.length && malMarcadas.length === 0,
    `${marcadas.length} de ${fuentes.length} leídas · mal marcadas: ` +
      JSON.stringify(malMarcadas.map((e) => `${e.fuente}: ${e.marca}/${e.palabra}`)),
  );
  // Y las DOS clases se ven a la vez: un panel que pintara todo «máquina»
  // cumpliría «cada entrada lleva marca» sin distinguir nada.
  const clases = new Set(marcadas.map((e) => e.marca));
  ctx.expect(
    "…y se distinguen las dos clases en el mismo panel, no una sola etiqueta para todo",
    clases.size === 2,
    `clases pintadas: ${JSON.stringify([...clases])}`,
  );

  // ── 2 · «Comenzar»: la transición de ENTRAR, por el camino del jugador ────
  const partida = await comenzar(ctx);
  ctx.log(`partida en marcha: ${partida.sessionId}`);

  const despues = await leerPanel(ctx);
  const presentesDespues = mias(despues);
  ctx.log(
    `tras entrar quedan: ${[...presentesDespues].sort().join(", ") || "(ninguna)"} · ` +
      `panel con ${despues.length} entrada(s) en total`,
  );
  await ctx.shot("registro-tras-entrar-a-la-partida");

  // ── 3 · Fila a fila, con el nombre en el aserto ───────────────────────────
  for (const f of fuentes) {
    const sobrevive = presentesDespues.has(f);
    if (ESPERADO[f] === "maquina") {
      ctx.expect(
        `«${f}» es de la MÁQUINA: entrar en una partida NO se lleva lo que sigue siendo cierto`,
        sobrevive,
        `la entrada ${MARCA}:${f} desapareció al entrar`,
      );
    } else {
      ctx.expect(
        `«${f}» es de la PARTIDA: entrar en una partida retira lo de la anterior`,
        !sobrevive,
        `la entrada ${MARCA}:${f} sigue en el panel de la partida nueva`,
      );
    }
  }

  // Y el panel no se quedó en blanco ni se duplicó: exactamente una entrada por
  // fuente superviviente. Un filtro que devolviera la lista dos veces dejaría
  // los asertos de arriba verdes y el panel ilegible.
  const repetidas = fuentes.filter(
    (f) => despues.filter((e) => e.msg.startsWith(`${MARCA}:${f} `)).length > 1,
  );
  ctx.expect(
    "…y ninguna superviviente se duplicó por el camino",
    repetidas.length === 0,
    `duplicadas: [${repetidas}]`,
  );

  // ── 4 · LAS DOS CLASES JUNTAS, en el panel que se ve jugando ──────────────
  // Los bloques de arriba miden la marca con el TÍTULO delante, donde el panel
  // está apagado por CSS (#246): se lee del DOM y no se ve. Aquí la partida ya
  // corre, el panel está a la vista, y se añade un error de ESTA partida encima
  // de los supervivientes de la máquina para que las dos clases convivan —que
  // es el estado normal de quien juega y el que la captura tiene que enseñar.
  await ctx.page.evaluate(
    async (marca) => {
      const { errors } = await import("/src/ui/error-log.ts");
      errors.push("scene", `${marca}:en-partida — un fallo de ESTA partida, ya jugando`);
    },
    MARCA,
  );
  const enPartida = await leerPanel(ctx);
  const dePartida = enPartida.filter((e) => e.marca === "partida");
  const deMaquina = enPartida.filter((e) => e.marca === "maquina");
  ctx.log(`panel jugando: ${deMaquina.length} de la máquina · ${dePartida.length} de la partida`);
  await ctx.shot("las-dos-clases-en-el-panel-jugando");
  ctx.expect(
    "jugando, el panel enseña LAS DOS clases marcadas: lo heredado de la máquina y lo de esta partida",
    deMaquina.length > 0 &&
      dePartida.length === 1 &&
      dePartida[0].palabra === "partida" &&
      dePartida[0].msg.endsWith("ya jugando"),
    JSON.stringify({ maquina: deMaquina.length, partida: dePartida.map((e) => `${e.fuente}/${e.palabra}`) }),
  );
}
