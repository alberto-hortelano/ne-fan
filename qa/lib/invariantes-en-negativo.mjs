/** LAS ANCLAS DE LOS CANDADOS EN NEGATIVO: qué se rompe, dónde y qué guion
 *  tiene que enterarse.
 *
 *  Vive aquí y no dentro de `qa/bateria-candados-en-negativo.mjs` —donde
 *  nació— por #486. La batería que la consume cuesta una corrida de guion por
 *  invariante (minutos de Chromium) y por eso va bajo demanda, así que la
 *  comprobación más barata que lleva dentro —«cada `buscar` aparece
 *  EXACTAMENTE una vez en su fichero»— solo se hacía cuando alguien pagaba lo
 *  caro. Y esa es justo la que caduca sola: el código se mueve (dos programas
 *  de troceo en un mes), el ancla deja de apuntar a donde cree, y el candado
 *  que la usa deja de candar sin que nada chille. Separada, la mide
 *  `nefan-core/test/las-anclas-de-los-candados.test.ts` en cada `npm test` —o
 *  sea en cada PR y en cada bucle local— sin abrir un navegador.
 *
 *  El alcance es SOLO esta tabla, y conviene decir por qué: la otra mitad de
 *  #486 hablaba de `qa/esperas-candados-en-negativo.mjs`, que no parchea código
 *  de producción — se escribe sus propios guiones temporales en `qa/guiones/` y
 *  los borra. Ahí no hay ancla que se pueda pudrir.
 *
 *  Los ficheros van RELATIVOS A LA RAÍZ del repo: es como los nombra `git`, es
 *  lo que se puede leer desde un test de `nefan-core/` y es lo que se puede
 *  imprimir sin la ruta personal de nadie.
 */

/** Los dos ficheros de PRODUCCIÓN que se rompen a propósito. */
const FIXTURES = "nefan-html/src/world/fixtures-del-selector.ts";
const TECLADO = "nefan-html/src/input/keyboard-input-provider.ts";

/** [nombre, fichero, guion, [ [buscar, poner], … ], huella, codigoEsperado? ]
 *
 *  `buscar` tiene que aparecer EXACTAMENTE una vez: si el código se mueve, el
 *  candado deja de apuntar a donde cree y esto lo dice en vez de dar un falso
 *  verde. `huella` es lo que el veredicto tiene que NOMBRAR — un rojo genérico
 *  no vale: el defecto de #308 ya se manifestaba como un aserto de telegraph
 *  fallando tres pasos más abajo, que es justo lo que no se puede diagnosticar.
 *
 *  `codigoEsperado` (defecto 1, rojo) existe por el canal `⊘` de #331: hay
 *  candados cuyo desenlace correcto NO es un rojo sino un ⊘ declarado, y el
 *  runner sale con 2 ante cualquier ⊘. Un 2 que NO se esperaba sigue contando
 *  como «la corrida no midió», nunca como éxito.
 */
export const INVARIANTES = [
  [
    "#308 · `loadFixture` vuelve a ser fire-and-forget (dice «hecho» sin esperar la fixture)",
    FIXTURES,
    "22-telegraph",
    [
      [
        "    const carga = ultimaCargaDeFixture;\n",
        "    const carga = Promise.resolve();\n    void ultimaCargaDeFixture;\n",
      ],
    ],
    /se pidió la fixture|no había llegado|se quedó en/i,
  ],
  // El MISMO destrozo, contra el guion que sí ejerce el camino original de #308.
  // Lo pidió QA el 2026-08-30 y tiene razón: con `loadFixture` roto para TODAS
  // las cargas, el 22 muere en su bloque 1 —la PRIMERA fixture— y la segunda,
  // que es donde vivía el bug, no se llega a pedir. O sea que este script
  // demostraba que el 22 caza *una* regresión del hook, no que cace LA de #308;
  // y el día que alguien deje el 22 con una sola fixture seguiría verde sin
  // avisar. El guion 44 sí lo ejerce: su precondición espera (no afirma) a
  // propósito, así que la primera carga sobrevive al destrozo y lo que se pone
  // rojo es el INSTANTE de la segunda.
  [
    "#308 · el mismo destrozo contra el guion que ejerce la SEGUNDA carga (el camino original)",
    FIXTURES,
    "44-la-carga",
    [
      [
        "    const carga = ultimaCargaDeFixture;\n",
        "    const carga = Promise.resolve();\n    void ultimaCargaDeFixture;\n",
      ],
    ],
    // Anclada al ✘: «sigue PENDIENTE» es parte de la descripción del aserto y
    // se imprime también en verde. Una huella que casa en las dos direcciones
    // no distingue nada, que es el defecto que este script persigue.
    /✘[^\n]*sigue PENDIENTE/,
  ],
  // ¿La migración de #332 COMPRÓ algo? El mismo destrozo del hook, contra un
  // guion migrado en esta pasada (el 01, que antes esperaba por su cuenta con
  // `status().scene` — una espera que este destrozo NO pone roja, porque
  // acaba cumpliéndose sola). Con `cargarFixture` la afirmación corre detrás
  // de la promesa rota y el rojo NOMBRA la escena que había.
  [
    "#308 · el mismo destrozo contra un guion MIGRADO en esta pasada (#332: la migración compra algo)",
    FIXTURES,
    "01-arranque",
    [
      [
        "    const carga = ultimaCargaDeFixture;\n",
        "    const carga = Promise.resolve();\n    void ultimaCargaDeFixture;\n",
      ],
    ],
    /se pidió la fixture|se quedó en/i,
  ],
  // El canal ⊘ de #331, probado por sus DOS caras contra el guion 34 — el
  // usuario natural del verbo (su precondición es que el selector ofrezca la
  // fixture donde están medidos sus márgenes).
  //
  // Cara 1: precondición rota → el guion DECLARA y sale ⊘ con su motivo (el
  // runner degrada la corrida a exit 2, que es el precedente de `:954-957`:
  // «esta corrida NO es un veredicto del juego»). Hasta #331 esto solo podía
  // salir rojo (mintiendo sobre QUÉ está roto) o verde.
  [
    "#331 · precondición rota → el guion declara ⊘ con su motivo, no un rojo que miente",
    "qa/guiones/34-con-el-titulo-delante-el-teclado-no-juega.mjs",
    "34-con-el-titulo",
    [['const FIXTURE = "puerto_tile";\n', 'const FIXTURE = "puerto_tile_inexistente";\n']],
    /declarado por el guion.*puerto_tile_inexistente/,
    2,
  ],
  // Cara 2: un guion que YA empujó fallos NO puede reconvertirse a ⊘ — un ⊘
  // es una declaración, no una amnistía. El cebo se inyecta ANTES de la
  // precondición rota: el runner tiene que vetar la reconversión y dejar el
  // guion en ROJO (exit 1, el defecto de `codigoEsperado`).
  [
    "#331 · con fallos ya empujados, sinMedir NO reconvierte: el rojo se queda",
    "qa/guiones/34-con-el-titulo-delante-el-teclado-no-juega.mjs",
    "34-con-el-titulo",
    [
      ['const FIXTURE = "puerto_tile";\n', 'const FIXTURE = "puerto_tile_inexistente";\n'],
      [
        "  const opcion = await ctx.page.evaluate((f) => {\n",
        '  ctx.expect("cebo inyectado por la batería de candados (debe vetar la reconversión)", false);\n' +
          "  const opcion = await ctx.page.evaluate((f) => {\n",
      ],
    ],
    /no puede reconvertirse|amnistía/,
  ],
  // Cara 3: el motivo vacío se RECHAZA como error del guion (rojo), no como un
  // ⊘ mudo. Entrada de QA (2026-08-31): la única cara del canal que la batería
  // no cubría. El `"" ??` evalúa a `""` y fuerza el motivo vacío sin tocar el
  // template del guion.
  [
    "#331 · el motivo vacío se RECHAZA: rojo que exige el motivo, no un ⊘ mudo",
    "qa/guiones/34-con-el-titulo-delante-el-teclado-no-juega.mjs",
    "34-con-el-titulo",
    [
      ['const FIXTURE = "puerto_tile";\n', 'const FIXTURE = "puerto_tile_inexistente";\n'],
      ["    ctx.sinMedir(\n", '    ctx.sinMedir(\n      "" ??\n'],
    ],
    /sinMedir exige el MOTIVO/,
  ],
  // Cara 4: el guion se TRAGA la sentinela (hallazgo de QA: un try/catch del
  // propio guion la capturaba y el guion salía VERDE). La declaración deja
  // marca en el ctx ANTES de lanzar, y el runner la honra al volver: un trago
  // no puede fabricar un verde. Sin el arreglo, esta entrada sale VERDE — es
  // exactamente la mentira que caza.
  [
    "#331 · tragarse la sentinela no deshace la declaración: sale ⊘, no verde",
    "qa/guiones/34-con-el-titulo-delante-el-teclado-no-juega.mjs",
    "34-con-el-titulo",
    [
      ['const FIXTURE = "puerto_tile";\n', 'const FIXTURE = "puerto_tile_inexistente";\n'],
      [
        "  if (!opcion) {\n    ctx.sinMedir(\n",
        '  if (!opcion) {\n    try {\n      ctx.sinMedir("me quedé sin fixture (sentinela tragada a propósito por la batería de candados)");\n    } catch {\n      return; // el trago: la sentinela muere aquí y el guion «acaba bien»\n    }\n  }\n  if (!opcion) {\n    ctx.sinMedir(\n',
      ],
    ],
    /la declaración se honra igual/,
    2,
  ],
  // #261 · el libro de esperas: una espera que expira y NADIE observa no puede
  // acabar en verde. El sujeto es el guion 02, cuya espera expira SIEMPRE por
  // diseño (se espera a que el jugador atraviese un muro, que es el fallo que
  // el guion viene a descartar): es el único sitio del árbol donde el destrozo
  // no depende de que algo salga mal, así que la corrida es determinista.
  //
  // El destrozo devuelve el `.catch(() => null)` sobre la espera —el gesto
  // reflejo que había 89 veces en `qa/guiones/`— dejando intacto el aserto: si
  // el candado no existiera, el guion saldría VERDE con la espera tragada, que
  // es exactamente la mentira de #261. Con él, el ÚNICO ✘ es la línea del
  // libro, y nombra el sitio.
  [
    "#261 · una espera que expira sin que nadie la observe NO puede acabar en verde",
    "qa/guiones/02-colision-desde-huella.mjs",
    "02-colision",
    [
      [
        `  const { ocurrio: atraveso } = await ctx.expectEspera(
    "el jugador atraviesa la huella del edificio",
    false,
    (limite) => (window.__nefan.state().pos.z <= limite ? true : null),
    {
      ms: 6000,
      arg: zBorde - 0.5,
      tecla: "up",
      aserto: "el jugador NO atraviesa la huella del edificio",
    },
  );
`,
        `  let atraveso = true;
  await ctx
    .holdUntil(
      "up",
      "el jugador ATRAVIESA el muro (esto sería el fallo)",
      (limite) => (window.__nefan.state().pos.z <= limite ? true : null),
      6000,
      zBorde - 0.5,
    )
    .catch(() => {
      atraveso = false;
    });
  ctx.expect("el jugador NO atraviesa la huella del edificio", !atraveso);
`,
      ],
    ],
    /expiró.*nadie la observó/,
  ],
  // #550 · el SELLO con el que el banco sabe que el título acabó de pedir la
  // lista. Antes de esta tanda, `esperarListaDeSaves` casaba dos FRASES y una
  // de ellas llevaba muerta desde #306: la rama del fallo no podía cumplirse
  // nunca, o sea un guardián incapaz de ponerse rojo por lo que decía cubrir.
  // Hoy mira `#ts-status[data-lista]`, y este es el candado de que ese sello
  // existe: el guion 98 es el ÚNICO que ejerce la rama `error` (deja la carpeta
  // de partidas ilegible), así que si alguien se lleva la línea del `catch` es
  // ahí donde tiene que salir el rojo.
  [
    "#550 · el home deja de sellar el FALLO al listar partidas (el banco se queda esperando una frase)",
    "nefan-html/src/ui/titulo/home.ts",
    "98-el-home-en-los-estados",
    [['    statusEl.dataset.lista = "error";\n', ""]],
    /✘[^\n]*sello data-lista=error/,
  ],
  [
    "#320 · muere UNA sola tecla de movimiento (`a`) en el proveedor de teclado",
    TECLADO,
    "34-con-el-titulo",
    [
      ['        case "a": this.state.left = true; break;\n', ""],
      ['        case "a": this.state.left = false; break;\n', ""],
    ],
    /NO RESPONDEN: «a»/,
  ],
];

/** Las anclas que ya NO apuntan a donde creen. Vacío = la tabla está viva.
 *
 *  Pura a propósito: `leer(ficheroRelativo)` devuelve el texto o `null` si el
 *  fichero no está, así que esto se puede medir con ficheros de mentira —que es
 *  como se prueba que sabe ponerse ROJO— sin tocar el árbol.
 *
 *  El recuento va sobre el fichero ORIGINAL, no sobre el que la batería lleva
 *  ya medio parcheado: los pares de un invariante apuntan a sitios distintos, y
 *  contar «cuántas veces está esta ancla en el fuente de hoy» es la pregunta
 *  que se quiere contestar. `veces: null` es «el fichero no existe», que no es
 *  lo mismo que «no aparece» y no se colapsa con ello. */
export function anclasSueltas(invariantes, leer) {
  const sueltas = [];
  for (const [nombre, fichero, , pares] of invariantes) {
    const texto = leer(fichero);
    for (const [buscar] of pares) {
      const veces = texto === null ? null : texto.split(buscar).length - 1;
      if (veces !== 1) sueltas.push({ nombre, fichero, buscar, veces });
    }
  }
  return sueltas;
}

/** Una línea legible por ancla suelta, para el rojo del test y el de la batería. */
export function explicarAnclaSuelta({ nombre, fichero, buscar, veces }) {
  const primeraLinea = buscar.split("\n")[0].trim();
  const cuantas = veces === null ? "el fichero no existe" : `aparece ${veces} veces`;
  return `${nombre}\n     ${fichero}: ${cuantas} → «${primeraLinea}»`;
}
