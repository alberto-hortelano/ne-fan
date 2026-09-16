/** DE QUIÉN ES CADA ENTRADA DEL REGISTRO DE ERRORES: de la PARTIDA o de la MÁQUINA.
 *
 *  #497 pidió que el registro técnico del cliente no arrastrara los errores de
 *  la partida anterior y se resolvió vaciándolo entero al cambiar de sesión.
 *  Eso se llevó por delante dos diagnósticos que seguían siendo CIERTOS después
 *  del cambio, y los dos tenían guion:
 *
 *   - el remedio del clon sin hojas de personaje —«genera las hojas, mira
 *     `docs/assets-de-personaje.md`»— que escribe `renderer/aspecto-del-jugador.ts`
 *     y que el `leave()` del arranque fallido borraba antes de que nadie lo
 *     leyera (guion 27);
 *   - el aviso de que la partida usa un estilo de otro tema (#537), que se
 *     escribe DENTRO de `startSession` y al que el `enter()` inmediatamente
 *     posterior borraba en la misma transición (guion 92).
 *
 *  La pregunta que #497 dejó sin contestar —«¿qué distingue un error que se va
 *  con la partida de uno que sigue siendo verdad después?»— la contestó el
 *  usuario el 2026-09-16: *marcar cada entrada y filtrar al pintar*. Esto es la
 *  marca, y se DERIVA de la fuente que el emisor ya elige hoy: quien registra
 *  un error no decide en qué lado está, elige una etiqueta y la tabla decide.
 *  La alternativa —un `opts.pertenencia` por llamada— deja la regla en «cada
 *  emisor sabe en qué lado está», que es exactamente lo que falló dos veces el
 *  mismo día.
 *
 *  EL CRITERIO NO ES EL RELOJ, ES EL SUJETO. «Lo que se registró sin sesión
 *  activa sobrevive» es tentador y falso, y lo demuestran dos casos reales: el
 *  remedio de las hojas se escribe CON la partida A en marcha y tiene que
 *  sobrevivir; el error de la partida abandonada que inyecta el guion 82
 *  también se escribe con sesión y tiene que irse.
 *
 *  POR QUÉ ESTÁ EN CORE Y NO EN `nefan-html/src/ui/error-log.ts`, que es quien
 *  pinta: porque clasificar es una DECISIÓN y el cliente solo pinta (#241). Y
 *  por una razón medida además de doctrinal: `nefan-html` no tiene banco de
 *  tests unitarios —cero `*.test.ts` y ningún script `test`—, así que una tabla
 *  que viviera allí no se podría poner en rojo sin abrir un navegador ni
 *  entraría en cobertura, CRAP o mutación. Aquí sí. El panel y el DOM siguen
 *  siendo del cliente. */

/** Las etiquetas con las que el cliente registra un error. UNIÓN CERRADA, y es
 *  la mitad del candado: `PERTENENCIA_POR_FUENTE` es un `Record` total sobre
 *  ella, así que una fuente nueva no compila hasta que alguien decide de qué
 *  lado está. Antes era `string` libre y la clasificación no existía.
 *
 *  `arranque` NACE AQUÍ, y no es cosmética: `session` mezclaba dos sujetos
 *  distintos —«esta partida» y «el intento de arrancar el cliente»— y con los
 *  dos bajo la misma etiqueta el problema no tiene solución, porque uno tiene
 *  que irse al cambiar de partida y el otro no. Se queda `session` para lo de
 *  la partida (el candado de #497 en el guion 82 sigue inyectando esa fuente,
 *  sin mover un carácter) y `arranque` recoge lo que no es de ninguna: el
 *  `bootstrap` que no levanta —por los dos caminos, el `catch` y la vía de
 *  escape—, el arranque de partida que falla y vuelve al título, y el aviso de
 *  estilo que el bridge manda al entrar.
 *
 *  LA MISMA OPERACIÓN SE HIZO DOS VECES MÁS al validar la PR (QA, Hallazgo 2),
 *  y las tres veces el arreglo fue mover el EMISOR y no la fila: `render` se
 *  quedó con el motor y soltó a `scene` lo que nombraba un tile o una entidad;
 *  la fuente `fps-atlas` se quedó sin emisor y se fue entera, porque su único
 *  `push` era el re-disparo del atlas de UN TILE —lo mismo que registran sus
 *  vecinos como `scene`— y la distinción que prometía su nombre no existía.
 *  Una fuente cuyo `porque` se contradice con su único emisor no es una fuente:
 *  es una etiqueta suelta, y la señal la dio la prosa antes que ningún test. */
export type FuenteDeError =
  | "arranque"
  | "bridge"
  | "config"
  | "dev-menu"
  | "graphics-mode"
  | "history"
  | "input"
  | "narrative"
  | "portrait"
  | "render"
  | "scene"
  | "session"
  | "sprite"
  | "title";

/** De quién es una entrada. `partida` se va con ella; `maquina` sigue siendo
 *  cierto en la siguiente y en el título. */
export type Pertenencia = "partida" | "maquina";

/** La tabla, y el único sitio donde esto se decide.
 *
 *  `partida` son las tres fuentes cuyo sujeto ES la partida en curso: lo que
 *  cuenta el motor narrativo, lo que pasa con SU escena y lo que pasa con SU
 *  sesión. Fuera de esa partida esas frases no significan nada — nombran un
 *  tile, un NPC o un id que ya no existen.
 *
 *  `maquina` es todo lo demás, y no por descarte: son fallos del CHECKOUT, del
 *  navegador o de los servicios —faltan las hojas de personaje, el bridge no
 *  responde, el `combat_config.json` es imposible, el pack de estilo no casa,
 *  la GPU no da un contexto WebGL—, y ninguno deja de ser verdad porque
 *  empieces otra partida. Volver al título no los arregla; leerlos, sí. */
export const PERTENENCIA_POR_FUENTE: Record<FuenteDeError, Pertenencia> = {
  // — De la PARTIDA —
  /** Lo que dice el motor narrativo de ESTA partida. */
  narrative: "partida",
  /** El tile, el atlas, el scatter, la colisión y los rótulos de sus entidades:
   *  todo lo que nombra la escena de ESTA partida y en la siguiente es otro
   *  sitio u otro NPC. Recogió en la tanda F los tres emisores que estaban bajo
   *  `render` y `fps-atlas` nombrando un tile o una entidad. */
  scene: "partida",
  /** Arrancar, reanudar y abandonar ESTA partida. Lo del arranque del cliente
   *  que no cuelga de ninguna partida va en `arranque`. */
  session: "partida",
  // — De la MÁQUINA —
  /** El intento de arrancar: el bootstrap, la partida que no llegó a empezar y
   *  el aviso que el bridge manda al entrar (#537). Sigue explicando por qué
   *  estás de vuelta en el título después de estarlo. */
  arranque: "maquina",
  /** El servidor de la partida: que no esté o que conteste ilegible es del
   *  proceso de al lado, no del mundo. */
  bridge: "maquina",
  /** Config del juego en disco (`combat_config.json`, los modos): un rango
   *  imposible lo sigue siendo en la partida siguiente. */
  config: "maquina",
  /** Las herramientas de desarrollo del propio checkout. */
  "dev-menu": "maquina",
  /** El conmutador de modos de render: es preferencia de esta máquina. */
  "graphics-mode": "maquina",
  /** El libro de historia como ventana: se abre y se lee fuera de la partida. */
  history: "maquina",
  /** Teclado, ratón y el proveedor de input elegido por `?input=`. */
  input: "maquina",
  /** El retrato del personaje. MÁQUINA aunque el texto nombre al personaje de
   *  la partida, y la razón está en la cadena de respaldo de su ÚNICO emisor
   *  (`ui/portrait.ts:104-120`): se prueba primero la skin y DESPUÉS el modelo
   *  base, y solo se registra si fallan LOS DOS. El base es local
   *  (`/sprites/y_bot/`) y «no debería fallar», así que llegar aquí significa
   *  que faltan las hojas del checkout — el mismo caso que `sprite`, y el
   *  mismo remedio, que sigue siendo cierto en la partida siguiente. */
  portrait: "maquina",
  /** El MOTOR de dibujo, y solo eso: el chunk de three.js que no carga
   *  (`renderer/fps-renderer.ts:95`) y la excepción del bucle
   *  (`main.ts:743`). Lo que nombra un tile o una entidad —«el tile X no
   *  compone», «el rótulo Y no se puede medir»— se fue a `scene` en la tanda
   *  F: era de la partida y aquí se habría quedado para siempre. */
  render: "maquina",
  /** La pantalla de título, que vive ENTRE partidas por definición. */
  title: "maquina",
  /** Las hojas de personaje y los skins. El clon sin `public/sprites/` es el
   *  caso que motivó todo esto: su remedio es el mismo antes, durante y
   *  después de cualquier partida (guion 27). */
  sprite: "maquina",
};

/** De quién es UNA entrada, y el único sitio donde se consulta la tabla.
 *
 *  Existe porque la pertenencia se usa para DOS cosas —filtrar al cambiar de
 *  sesión y marcar la entrada en el panel— y con dos lecturas sueltas de la
 *  tabla el día que una tratase distinto a un desconocido el panel diría una
 *  cosa y el filtro haría otra. Aquí se decide una vez.
 *
 *  UNA FUENTE QUE NADIE CLASIFICÓ ES DE LA PARTIDA. No puede llegar por el
 *  tipo, así que solo entra desde fuera del programa (un guion de `qa/`, la
 *  consola del navegador), y ahí lo honesto es no prometer supervivencia a algo
 *  que nadie ha clasificado: sobrevive lo que ALGUIEN decidió que sobrevive. */
export function pertenenciaDe(source: FuenteDeError): Pertenencia {
  return PERTENENCIA_POR_FUENTE[source] === "maquina" ? "maquina" : "partida";
}

/** Lo que SOBREVIVE a que la partida se vaya: las entradas de la máquina.
 *
 *  Genérica por `source` y no atada a `ErrorEntry` porque esa forma es del
 *  cliente —lleva el `ts`, el `detail` y lo que el panel pinta— y core no
 *  conoce el DOM. Lo único que hace falta para decidir es la fuente.
 *
 *  Pregunta por `pertenenciaDe` y no por la tabla: lo que el panel MARCA y lo
 *  que el olvido RETIRA tienen que ser la misma decisión, o el jugador lee una
 *  etiqueta que no predice nada. */
export function loQueSobreviveALaPartida<E extends { source: FuenteDeError }>(
  entradas: readonly E[],
): E[] {
  return entradas.filter((e) => pertenenciaDe(e.source) === "maquina");
}
