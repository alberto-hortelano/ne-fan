/** Los DOS campos con los que el terreno se declaraba por chars, retirados
 *  enteros el 2026-09-02 (#335): una leyenda char→nombre/solidez y parches
 *  ASCII estampados sobre el bioma. Hoy el suelo tiene un solo origen —
 *  `biome` + `ground`/`volumes`— y la solidez la fija el engine
 *  (`DEFAULT_SOLID_CHARS`: agua y muro bloquean).
 *
 *  Desde que los dos schemas de escena son `.strict()` (#400), una clave que
 *  no esté en el shape se rebota sola en las dos poblaciones: lo que queda
 *  aquí es el MENSAJE. Para un campo retirado no vale el genérico («no existe
 *  en el contrato»), porque los dos sitios por los que vuelve son un motor que
 *  copia un ejemplo viejo (`EmittedSceneSchema`) y un save o snapshot anterior
 *  a la retirada (`ExpandedSceneSchema`), y a los dos hay que decirles con qué
 *  se sustituye. Lo lee el `errorMap` de la escena (scene-schema.ts).
 *
 *  Vive en su propio fichero porque para nombrar el campo hay que ESCRIBIRLO,
 *  y `campos-retirados-no-vuelven` (arch-rules.json) los caza en todo `src/`.
 *  El checker exime por FICHERO entero, así que la ceguera que compra la
 *  exención se limita a estas líneas y a nada más. */

export const RETIRED_TERRAIN_FIELDS = ["terrain_legend", "terrain_patches"] as const;

/** El motivo con el que se rebota `campo` si es uno de los dos retirados;
 *  `null` si no lo es (entonces es una clave desconocida cualquiera). */
export function mensajeDeCampoRetirado(campo: string): string | null {
  if (!(RETIRED_TERRAIN_FIELDS as readonly string[]).includes(campo)) return null;
  return (
    `\`${campo}\` está retirado: el terreno se declara con \`biome\` + \`ground\`/\`volumes\` y la ` +
    "solidez la fija el engine (agua y muro bloquean). Si viene de un save o snapshot, bórralo o regenéralo"
  );
}
