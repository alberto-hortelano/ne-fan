/** El wire de **sprite-forge** (repo aparte, servicio :8770) tal como lo
 *  consume TS: el meta.json de las hojas de personaje y el catálogo que
 *  reexpone remote-gen en `GET /sprite_catalog`.
 *
 *  Son zod y no interfaces porque este contrato tuvo CUATRO copias (espejo TS,
 *  fake del bench, doble de tests Python, servicio real) y cero puntos de
 *  comparación — el espejo llegó a declarar obligatorio un `generated_at` que
 *  el sheet vestido nunca llevó. Ahora sprite-forge emite fixtures canónicas
 *  de sus respuestas reales (`npm run fixtures-contrato` en su repo), van
 *  commiteadas en `data/contract/fixtures/sprite-forge/` y
 *  `test/contract-sprite-forge.test.ts` valida estos schemas contra ellas:
 *  si el espejo miente, el test se pone rojo sin clonar el repo hermano.
 */
import { z } from "zod";

/** Bloque `skin` del meta de un sheet VESTIDO: lo escribe sprite-forge al
 *  repintar (`src/server.mjs`, `POST /skins`) con el plan exacto que pagó.
 *  `base_key` es la excepción: la inyecta remote-gen al guardar el sheet
 *  (`routers/remote_generation.py`), así que en la respuesta directa de
 *  sprite-forge no está y en el wire de `/skin_sprite_sheet` sí. */
export const SpriteSheetSkinSchema = z
  .object({
    /** La descripción exacta con la que se pintó (procedencia del arte). */
    prompt: z.string().min(1),
    ai_model: z.string().min(1),
    api: z.string().min(1),
    /** Qué fotogramas de la hoja base se pintaron. */
    keyframe_indices: z.array(z.number().int().nonnegative()).min(1),
    /** Direcciones agrupadas por llamada de imagen (una fila por dirección). */
    batches: z.array(z.array(z.number().int().nonnegative()).min(1)).min(1),
    /** Segmentador con el que se recortó el fondo. */
    background: z.string().min(1),
    cost_usd: z.number().nonnegative(),
    /** Identidad de la hoja base de la que salió — la añade remote-gen. */
    base_key: z.string().min(1).optional(),
  })
  .strict();

/** El meta.json de un sprite sheet, tal como lo escribe **sprite-forge**. El
 *  mismo shape sirve para las hojas base (`public/sprites/{model}/{anim}/
 *  {angle}/meta.json` y `POST /sheets`) y para el sheet vestido que devuelve
 *  `/skin_sprite_sheet`; se distinguen por sus campos opcionales:
 *
 *  - `generated_at` va SOLO en el meta de una hoja BASE (lo estampa el render,
 *    `src/render.mjs` · `metaDeHoja`). El sheet vestido no lo lleva — el
 *    espejo viejo lo declaraba obligatorio «en el wire del sheet vestido» y
 *    era mentira.
 *  - `skin` va SOLO en el sheet vestido (ver `SpriteSheetSkinSchema`).
 */
export const SpriteSheetMetaSchema = z
  .object({
    model: z.string().min(1),
    anim: z.string().min(1),
    angle: z.string().min(1),
    directions: z.number().int().positive(),
    frame_count: z.number().int().positive(),
    /** Fps de REPRODUCCIÓN: en la hoja base, el fps de muestreo; en el sheet
     *  vestido, el `play_fps` del perfil (menos fotogramas, otro ritmo). */
    fps: z.number().positive(),
    duration: z.number().positive(),
    frame_width: z.number().int().positive(),
    frame_height: z.number().int().positive(),
    /** Timestamp ISO que estampa el render de la hoja BASE. */
    generated_at: z.string().min(1).optional(),
    skin: SpriteSheetSkinSchema.optional(),
  })
  .strict();

export type SpriteSheetMeta = z.infer<typeof SpriteSheetMetaSchema>;

/** Una animación del catálogo, en lo que ne-fan LEE de ella (el resto del
 *  catálogo es del servicio y pasa de largo). `calls_per_anim` es el precio
 *  que se le enseña al usuario antes de gastar; cuando el servicio no puede
 *  calcularlo viaja `null` CON su causa en `skin_plan_error` — el propio
 *  schema rechaza el null mudo, para que ningún despliegue pueda volver a
 *  dejarnos inventando el precio. */
export const SpriteCatalogAnimationSchema = z
  .object({
    id: z.string().min(1),
    keyframes: z.number().int().positive().nullable(),
    play_fps: z.number().positive().nullable(),
    calls_per_anim: z.number().int().positive().nullable(),
    skin_plan_error: z.string().min(1).optional(),
  })
  .passthrough()
  .superRefine((a, ctx) => {
    if (a.calls_per_anim === null && a.skin_plan_error === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${a.id}": calls_per_anim null sin skin_plan_error — un coste desconocido no puede viajar mudo`,
      });
    }
  });

/** La mitad de repintado del catálogo: o puede (y dice coste por llamada), o
 *  no puede y dice POR QUÉ. */
export const SpriteCatalogSkinSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      api: z.string().min(1),
      ai_model: z.string().min(1),
      cost_usd_per_call: z.number().nonnegative().nullable(),
    })
    .passthrough(),
  z.object({ enabled: z.literal(false), reason: z.string().min(1) }).passthrough(),
]);

/** `GET /sprite_catalog` (remote-gen reexpone el `/catalog` de sprite-forge
 *  tal cual). Solo se modela lo que ne-fan consume; el resto pasa de largo. */
export const SpriteCatalogSchema = z
  .object({
    service: z.literal("sprite-forge"),
    animations: z.array(SpriteCatalogAnimationSchema),
    skin: SpriteCatalogSkinSchema,
  })
  .passthrough();

export type SpriteCatalog = z.infer<typeof SpriteCatalogSchema>;

/** Las anims que el batch de estilo pre-genera por personaje (y las que la
 *  partida pide al materializar un NPC con skin). */
export const AUTO_SKIN_ANIMS = ["idle", "walk", "run"] as const;

/** Llamadas de imagen por personaje si el catálogo es INALCANZABLE: 1 hero +
 *  una por anim. Es un SUELO deliberadamente bajo y solo vale etiquetado como
 *  estimación (nota + `~` en la UI); el número bueno sale del catálogo.
 *
 *  Aquí vivía `1 + 8 + 4 + 4`, copiado a mano del planificador del servicio.
 *  Es el número que se le enseña al usuario ANTES de gastar, así que en cuanto
 *  alguien retocara un perfil de keyframes se quedaba mintiendo — y el
 *  planificador vive en otro repo. */
export const SKIN_CALLS_FALLBACK = 1 + AUTO_SKIN_ANIMS.length;

/** Coste en llamadas de imagen de vestir un personaje, o el motivo por el que
 *  no se puede saber. Result y no `number | null`: «no sé el precio» y «el
 *  precio es el suelo» se confundían al colapsarse, y el suelo (4) frente a
 *  las ~17 llamadas reales se le enseñaba al usuario como si fuera el precio
 *  justo antes de gastar. Quien llama decide qué hacer con `ok: false` —
 *  enseñar «coste no disponible», nunca una cifra optimista presentada como
 *  real. */
export type SkinCallsInfo = { ok: true; calls: number } | { ok: false; reason: string };

/** Llamadas de imagen por personaje, derivadas del catálogo del servicio:
 *  1 hero-shot + `calls_per_anim` de cada anim que se genera en automático. */
export function skinImageCalls(catalog: SpriteCatalog): SkinCallsInfo {
  let total = 1; // el hero-shot de identidad, una vez por personaje
  for (const anim of AUTO_SKIN_ANIMS) {
    const entry = catalog.animations.find((a) => a.id === anim);
    if (!entry) {
      return { ok: false, reason: `la anim "${anim}" no está en el catálogo del servicio` };
    }
    if (entry.calls_per_anim === null) {
      return {
        ok: false,
        reason: entry.skin_plan_error ?? `el servicio no publica el coste de "${anim}"`,
      };
    }
    total += entry.calls_per_anim;
  }
  return { ok: true, calls: total };
}
