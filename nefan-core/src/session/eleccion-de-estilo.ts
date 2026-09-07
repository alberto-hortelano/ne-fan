/** QUÉ ESTILOS SE LE OFRECEN A UN MUNDO Y CUÁL VIENE PUESTO.
 *
 *  Un estilo y un mundo se casan por TEMA: la intersección de sus `tags`
 *  (`styleCompatibleWithGame`) — un pack medieval no se ofrece para un mundo
 *  futurista. Sobre esa regla hay dos preguntas distintas que el título y el
 *  bridge tienen que contestar IGUAL:
 *    1. qué estilos entran en el desplegable del selector de mundos;
 *    2. cuál queda preseleccionado (y, en el bridge, cuál se le pone al mundo
 *       que el jugador acaba de crear si el que sugirió el motor no existe).
 *
 *  Hasta la PR 7 de #241 (2026-09-07) las contestaban dos criterios distintos y
 *  se sabía: `title-screen.ts:905-909` EXIGÍA compatibilidad al estilo del
 *  mundo (si el suyo no casaba, preseleccionaba otro y ni siquiera lo ofrecía,
 *  y con cero compatibles bloqueaba el botón de continuar), mientras
 *  `bridge/handlers/session.ts:194-196` respetaba el `style_id` del mundo
 *  existiera o no en la lista de compatibles. Divergencia viva, anotada por la
 *  crítica de #241: el mundo arrancaba con un estilo distinto del que su
 *  `game.json` declara sin que nadie lo dijera.
 *
 *  MANDA EL BRIDGE (decisión del usuario, 2026-09-07): el `style_id` del mundo
 *  si existe; si no, el primero COMPATIBLE; si no, el primero de la lista. Y el
 *  desplegable ofrece los compatibles MÁS el preseleccionado cuando no está
 *  entre ellos (recomendación (a) de `plan.md` §9), marcado como de otro tema:
 *  esconder el estilo que el mundo declara no lo desactiva, solo lo hace
 *  invisible.
 *
 *  Módulo PURO: sin DOM y sin `node:*`. Genérico en el tipo del estilo para
 *  devolver los MISMOS objetos que le entran (el título necesita `name` y
 *  `description` para pintar la opción; el bridge, solo el id).
 *  `ofrecidos`/`porDefecto` cumplen un invariante que el llamante no tiene que
 *  volver a comprobar: `porDefecto` es `null` exactamente cuando `ofrecidos`
 *  está vacío, y si no, está SIEMPRE dentro de `ofrecidos`. */

import { styleCompatibleWithGame } from "../games/style-refs.js";

/** Lo mínimo que hace elegible a un estilo: su id y sus etiquetas. El listado
 *  del bridge (`StyleListing`) y el del wire (`games_listed.styles`) lo
 *  cumplen. */
export interface EstiloElegible {
  style_id: string;
  tags?: readonly string[];
}

/** Lo que el mundo aporta a la elección: el estilo que declara su `game.json`
 *  (o el que sugirió el motor al desarrollarlo) y sus etiquetas temáticas.
 *  `style_id` opcional porque el mundo recién salido de `develop_world` puede
 *  no traerlo. */
export interface MundoQueElige {
  style_id?: string;
  tags?: readonly string[];
}

/** Un estilo del desplegable con los dos hechos que deciden su rótulo. Van
 *  como datos y no como texto porque el rótulo es del cliente que pinta; la
 *  DECISIÓN (qué se ofrece, qué es «otro tema») es de aquí. */
export interface EstiloOfrecido<S extends EstiloElegible> {
  estilo: S;
  /** Sus tags casan con los del mundo. */
  compatible: boolean;
  /** Es el `style_id` que declara el mundo. */
  delMundo: boolean;
}

export interface EleccionDeEstilo<S extends EstiloElegible> {
  /** En el orden en que llegaron los estilos. Vacío solo si no hay ninguno. */
  ofrecidos: EstiloOfrecido<S>[];
  /** El id preseleccionado, o `null` si no hay un solo estilo instalado. */
  porDefecto: string | null;
}

export function eleccionDeEstilo<S extends EstiloElegible>(
  styles: readonly S[],
  game: MundoQueElige,
): EleccionDeEstilo<S> {
  const todos: EstiloOfrecido<S>[] = styles.map((estilo) => ({
    estilo,
    compatible: styleCompatibleWithGame(estilo.tags, game.tags),
    // `game.style_id` ausente ⇒ ningún estilo es «del mundo», y la regla cae
    // sola al primero compatible.
    delMundo: estilo.style_id === game.style_id,
  }));

  // La regla del bridge, en este orden y sin excepciones: el del mundo, el
  // primero compatible, el primero. Compatible o no, el del mundo manda: el
  // aviso de que no casa lo da `start_session`, que es quien puede decirlo sin
  // quitarle al jugador el estilo que su mundo declara.
  const elegido =
    todos.find((o) => o.delMundo) ?? todos.find((o) => o.compatible) ?? todos[0] ?? null;

  return {
    ofrecidos: todos.filter((o) => o.compatible || o === elegido),
    porDefecto: elegido?.estilo.style_id ?? null,
  };
}
