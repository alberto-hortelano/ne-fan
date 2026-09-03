/** Los campos RETIRADOS del contrato de escena, con el motivo con el que se
 *  rebotan. Nació con los DOS del terreno por chars (2026-09-02, #335: una
 *  leyenda char→nombre/solidez y parches ASCII sobre el bioma) y desde #399/#400
 *  lleva también los tres que retiró esa tanda: el decor pegado al muro, el
 *  char ASCII de la entity y la frase de ambiente de la escena.
 *
 *  Desde que los dos schemas de escena son `.strict()` (#400), una clave que
 *  no esté en el shape se rebota sola en las dos poblaciones: lo que queda
 *  aquí es el MENSAJE. Para un campo retirado no vale el genérico («no existe
 *  en el contrato»), porque los dos sitios por los que vuelve son un motor que
 *  copia un ejemplo viejo (`EmittedSceneSchema`) y un save o snapshot anterior
 *  a la retirada (`ExpandedSceneSchema`), y a los dos hay que decirles con qué
 *  se sustituye. Lo leen los errorMap de la escena y de la entity
 *  (scene-schema.ts); el espejo Python es `ai_server/campos_retirados.py`.
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
  "el terreno se declara con `biome` + `ground`/`volumes` y la solidez la fija el engine (agua y muro bloquean)";

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
};

/** El motivo con el que se rebota `campo` si es uno de los retirados; `null`
 *  si no lo es (entonces es una clave desconocida cualquiera). */
export function mensajeDeClaveRetirada(campo: string): string | null {
  const motivo = MOTIVOS[campo];
  return motivo === undefined ? null : `\`${campo}\` está retirado: ${motivo}. ${SUFIJO}`;
}
