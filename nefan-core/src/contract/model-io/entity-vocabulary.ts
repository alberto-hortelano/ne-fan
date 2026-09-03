/** El vocabulario de UNA entity, compartido por las dos puertas por las que el
 *  motor pone algo en el mundo: `generate_scene` (`EntitySchema`, la escena) y
 *  `spawn_entity` (`SpawnEntityConsequence`, a mitad de conversación).
 *
 *  Es UN objeto, no dos copias: los dos zod cogen ESTOS mismos schemas por
 *  referencia y `test/entity-vocabulary.test.ts` compara la identidad. Hasta
 *  #397 cada puerta decía lo suyo —la escena «`name` obligatorio, `description`
 *  opcional»; el spawn «`description` obligatoria, `name` opcional (NPCs)»— y
 *  el mismo modelo escribía `description` con dos semánticas según el tool.
 *
 *  Lo que cada campo ES, y por qué así (#238, #397):
 *
 *  · `name` — la ETIQUETA: lo que el jugador lee al mirarla (el rótulo del
 *    cliente sale de aquí y de ningún otro sitio). Obligatoria y no vacía.
 *  · `description` — la PROCEDENCIA: el texto exacto del que se genera su
 *    arte (aspecto, no biografía), que viaja verbatim hasta la world scene y
 *    el save para poder regenerar el asset con un modelo mejor. En un NPC es
 *    además el prompt del skin. Opcional: sin ella se pinta con `name` y
 *    nadie inventa una («an entity», el id). Rechaza también la description
 *    EN BLANCO, que sin esto pasaba el gate aquí y la tiraba el `.strip()` de
 *    ai_server — el mismo NPC aceptado aquí y desvestido allí (#237).
 *
 *  `.refine()` y NO `.trim().min(1)`: `trim` no valida, REESCRIBE. Estos
 *  schemas se usan como PREDICADO —`validateContract` tira el resultado del
 *  `safeParse`— y `ExpandedSceneSchema` está en la ruta de CARGA de los
 *  snapshots. Un schema que transforma en esa posición reescribe datos de
 *  disco en silencio, y lo hizo: un `"  tabernero  "` guardado volvía sin
 *  espacios. La regla queda escrita en el tipo —estos schemas no transforman
 *  NUNCA— y la canda `scene-schema.test.ts`.
 *
 *  Lo que NO se comparte, a propósito: `role` y `style_ref`. Coinciden en
 *  vocabulario (NPC_ROLES, el catálogo del pack) pero cada puerta los explica
 *  con su mensaje —el de la escena nombra a la entity por su id porque el tile
 *  trae ochenta— y ese mensaje es la pieza que trabaja. */
import { z } from "zod";

/** Por qué se rechaza un `name` que falta, está vacío o es solo espacios. Es
 *  la MISMA frase en el zod y en el espejo Python (`narrative_schemas.py`):
 *  `test/entity-vocabulary.test.ts` lee el fichero Python y la busca, porque
 *  el modelo entra por las dos vías y tiene que leer el mismo motivo por las
 *  dos. QA de PR-C (H1): `"   "` pasaba el zod y lo rechazaba Python. */
export const MOTIVO_NAME_INVALIDO =
  "`name` no puede faltar, estar vacío ni ser solo espacios: es el rótulo que lee el jugador (la procedencia va en `description`)";

export const VocabularioDeEntity = {
  name: z
    .string()
    .min(1)
    .refine((n) => n.trim().length > 0, { message: MOTIVO_NAME_INVALIDO })
    .describe("Etiqueta: lo que el jugador lee al mirarla (el rótulo). Nombre propio si lo tiene"),
  description: z
    .string()
    .min(1)
    .refine((d) => d.trim().length > 0, {
      message:
        "`description` no puede ser solo espacios: es el texto del que se genera su arte (en un NPC, el prompt del skin)",
    })
    .optional()
    .describe(
      "Procedencia: el texto exacto (en español) del que se genera su arte — aspecto, no biografía; " +
        "en un NPC, el prompt del skin. Sin ella se pinta con `name`",
    ),
} as const;
