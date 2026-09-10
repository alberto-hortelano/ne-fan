/** Los campos RETIRADOS del contrato de escena, con el motivo con el que se
 *  rebotan. Nació con los DOS del terreno por chars (2026-09-02, #335: una
 *  leyenda char→nombre/solidez y parches ASCII sobre el bioma) y desde #399/#400
 *  lleva también los tres que retiró esa tanda: el decor pegado al muro, el
 *  char ASCII de la entity y la frase de ambiente de la escena; desde #408,
 *  las anclas de lugar declaradas en la escena (`place_anchors`).
 *
 *  Desde que los dos schemas de escena son `.strict()` (#400), una clave que
 *  no esté en el shape se rebota sola en las dos poblaciones: lo que queda
 *  aquí es el MENSAJE. Para un campo retirado no vale el genérico («no existe
 *  en el contrato»), porque los dos sitios por los que vuelve son un motor que
 *  copia un ejemplo viejo (`EmittedSceneSchema`) y un save o snapshot anterior
 *  a la retirada (`ExpandedSceneSchema`), y a los dos hay que decirles con qué
 *  se sustituye. Lo leen los errorMap de la escena y de la entity
 *  (scene-schema.ts).
 *
 *  ÚNICA FUENTE, y desde #466 también para Python. `ai_server/campos_retirados.py`
 *  era una COPIA a mano que prometía ser «los mismos motivos, palabra por
 *  palabra» y no lo era: le faltaban `glyph` y `attach` en la raíz (los rebotaba
 *  con el genérico) y rotulaba la entity de otra forma — cinco divergencias
 *  medidas por `qa/los-dos-gates-rebotan-igual.mjs`. Hoy Python LEE el snapshot
 *  `data/contract/campos-retirados.json` que vuelca `scripts/dump-campos-retirados.ts`
 *  desde aquí, con el mismo trato que la física (`physics.json`): el fichero va
 *  commiteado, no se regenera en ningún hook `pre*`, y `test/contract-campos-retirados.test.ts`
 *  se pone rojo si se queda atrás.
 *
 *  Los tres de SOLO RAÍZ viven aquí desde #466 por lo mismo: estaban en
 *  `scene-schema.ts` y el volcado no podía verlos, así que Python los habría
 *  seguido copiando.
 *
 *  Vive en su propio fichero porque para nombrar el campo hay que ESCRIBIRLO,
 *  y `campos-retirados-no-vuelven` (arch-rules.json) los caza en todo `src/`.
 *  El checker exime por FICHERO entero, así que la ceguera que compra la
 *  exención se limita a estas líneas y a nada más. El nombre del fichero es el
 *  de su primer inquilino: `qa/guiones/62` lee `RETIRED_TERRAIN_FIELDS` de
 *  aquí por su ruta. */

export const RETIRED_TERRAIN_FIELDS = ["terrain_legend", "terrain_patches"] as const;

const SUFIJO = "Si viene de un save o snapshot, bórralo o regenéralo";

const MOTIVO_DEL_TERRENO =
  "el terreno se declara con `biome` + `ground`/`volumes` y la solidez la fija el engine (el agua bloquea; los muros son `volumes`)";

/** Clave retirada → con qué se sustituye. Raíz de la escena y entity juntas:
 *  ninguna clave está en las dos, y así quien pregunte por una clave recibe
 *  UNA respuesta. */
const MOTIVOS: Readonly<Record<string, string>> = {
  terrain_legend: MOTIVO_DEL_TERRENO,
  terrain_patches: MOTIVO_DEL_TERRENO,
  // #400: la frase de ambiente no la leía nadie; lo que se quiera contar del
  // lugar va en `scene_description`, que sí llega al jugador y al motor.
  ambient_event: "la frase de ambiente no la leía nadie; lo que quieras contar del lugar va en `scene_description`",
  // #400: el char ASCII de la entity solo lo leía el propio contrato.
  glyph: "el char ASCII de una entity no lo lee nadie; la entity se identifica por `id` y se rotula por `name`",
  // #399: el snap al muro buscaba un char que ningún productor escribe.
  attach: "el decor ya no se pega a un muro (los muros son `volumes`): declara la `cell` exacta donde va",
  // #408: cuatro lectores y ningún productor real (solo el motor del banco lo
  // escribía). El mismo dato viaja por la tool que ya existía, con más
  // información (el tile además del rect); un segundo canal era un camino falso.
  place_anchors:
    "la escena no ancla lugares: el motor los ancla con `map_upsert_place.anchor {tx, ty, rect}`, que ya existe",
};

/** Las tres de SOLO RAÍZ: su motivo no tiene la forma «X está retirado: …»
 *  porque no se sustituyen por otro campo, sino que nombran la variante viva
 *  (`stage`), el catálogo que ya no existe (`style_ref` de escena) o la marca
 *  interna del expander (`__expanded`). Una entity con cualquiera de las tres
 *  recibe el genérico, que es lo correcto: ahí nunca existieron. */
const MOTIVOS_SOLO_DE_RAIZ: Readonly<Record<string, string>> = {
  stage:
    "`stage` era el plató proscenio y se retiró con la vista que lo pintaba: una escena necesita " +
    "`tile` {tx,ty}, la única variante de Format D (mundo continuo, pídela con generate_tile)",
  style_ref:
    "`style_ref` de escena está retirado (no existe catálogo world.style_refs.scene): " +
    "quítalo. Para guiar el arte usa `surface_ref` por cara de volumen y `style_ref` en los NPCs",
  __expanded:
    "`__expanded` es la marca interna del expander: una escena emitida no la lleva — " +
    "quítala y declara `biome` + primitivas; el engine expande y marca él",
};

/** Las claves retiradas, por nivel. Existen para que quien las RECORRA —el
 *  guion de paridad de los dos gates, un test— no tenga que escribirlas: cada
 *  sitio que las copia es un sitio del que separarse, y una retirada nueva
 *  entra sola en lo que ya las mide. */
export const CLAVES_RETIRADAS: readonly string[] = Object.keys(MOTIVOS);
export const CLAVES_RETIRADAS_SOLO_DE_RAIZ: readonly string[] = Object.keys(MOTIVOS_SOLO_DE_RAIZ);

/** Cómo se NOMBRA a la entity que trae la clave, con y sin `id`. Es plantilla
 *  y no función porque también viaja al snapshot que lee Python: el rótulo era
 *  una de las cinco divergencias de #466 (`la entity "p"` aquí, `entity 'p'`
 *  allí) justamente por estar escrito dos veces. */
export const ROTULO_DE_ENTITY = 'la entity "{id}"';
export const ROTULO_DE_ENTITY_SIN_ID = "una entity";

/** El rótulo de una entity para los mensajes de los dos gates: con su `id` si
 *  lo trae (que es lo accionable con ochenta entidades en el tile). */
export function rotuloDeEntity(id: unknown): string {
  return typeof id === "string" && id ? ROTULO_DE_ENTITY.replace("{id}", id) : ROTULO_DE_ENTITY_SIN_ID;
}

/** El motivo con el que se rebota `campo` si es uno de los retirados; `null`
 *  si no lo es (entonces es una clave desconocida cualquiera). El de una
 *  ENTITY: solo la tabla compartida. */
export function mensajeDeClaveRetirada(campo: string): string | null {
  const motivo = MOTIVOS[campo];
  return motivo === undefined ? null : `\`${campo}\` está retirado: ${motivo}. ${SUFIJO}`;
}

/** Ídem para una clave de la RAÍZ de la escena: las tres de solo raíz traen su
 *  motivo entero; el resto sale de la tabla compartida. */
export function mensajeDeClaveRetiradaDeRaiz(campo: string): string | null {
  return MOTIVOS_SOLO_DE_RAIZ[campo] ?? mensajeDeClaveRetirada(campo);
}

/** El snapshot que lee el espejo Python (`ai_server/campos_retirados.py`) a
 *  través de `data/contract/campos-retirados.json`. Los motivos van YA
 *  COMPUESTOS —con su sufijo y sus comillas—: repetir la composición al otro
 *  lado serían dos formatos capaces de divergir, que es media enfermedad de
 *  vuelta (misma lección que el tope de footprint en `physics.json`). */
export function camposRetiradosSnapshot(): {
  $comment: string;
  motivos: Record<string, string>;
  motivos_solo_de_raiz: Record<string, string>;
  rotulo_de_entity: string;
  rotulo_de_entity_sin_id: string;
} {
  const motivos: Record<string, string> = {};
  for (const campo of Object.keys(MOTIVOS)) motivos[campo] = mensajeDeClaveRetirada(campo) as string;
  return {
    $comment:
      "GENERADO por nefan-core/scripts/dump-campos-retirados.ts desde " +
      "src/contract/model-io/retired-terrain-fields.ts. NO editar a mano: lo canda " +
      "test/contract-campos-retirados.test.ts, que compara este fichero con la fuente TS y falla si " +
      "divergen. Lo lee ai_server (campos_retirados.py) para rebotar una clave retirada con el MISMO " +
      "texto que el zod, en vez de copiarlo — que es lo que hacía hasta #466, con cinco divergencias.",
    motivos,
    motivos_solo_de_raiz: { ...MOTIVOS_SOLO_DE_RAIZ },
    rotulo_de_entity: ROTULO_DE_ENTITY,
    rotulo_de_entity_sin_id: ROTULO_DE_ENTITY_SIN_ID,
  };
}
