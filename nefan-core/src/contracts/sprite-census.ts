/** El censo de hojas de personaje: qué modelos base puede OFRECER el título.
 *
 * La verdad de «ofrecer un modelo» es tener su set COMPLETO de hojas cargable
 * por el cliente desde los estáticos `/sprites/**` — no una lista que alguien
 * recuerda actualizar (#216: el título prometía 7 modelos de los que 6 no
 * tenían hojas), ni el catálogo de sprite-forge, que publica lo que puede
 * renderizar EL SERVICIO y no lo que este disco tiene.
 *
 * Quién hace cada mitad:
 * - El dev server del cliente (middleware en `nefan-html/vite.config.ts`)
 *   responde `GET /sprites/index.json` escaneando `public/sprites/` EN CADA
 *   request y devuelve un `SpriteCensusResponse` crudo: lo que hay, medido en
 *   el mismo origen que sirve las hojas.
 * - Qué es «completo» lo decide aquí `modelosCompletos`, pura: la lista de
 *   anims exigida viaja EN la respuesta (`required`), así que censo y criterio
 *   no pueden divergir en silencio.
 *
 * Las dos constantes son el CONTRATO DE DISCO de las hojas
 * (`/sprites/{model}/{anim}/{angle}/…`) y entran en la clave de caché de los
 * skins IA: cambiarlas repaga todo el arte de personaje ya generado. Antes
 * vivían copiadas en tres sitios del cliente (BASE_ANIMS de
 * character-sprites.ts, `worldAngle` de main.ts y SKIN_ANGLE de
 * style-apply.ts, atados por un comentario «DEBE coincidir»). */

/** Ángulo de cámara del set de sprites: casi frontal −8°, el de la cámara a
 *  la altura de los ojos. Único para todo el juego. */
export const HOJAS_ANGLE = "frontal_8";

/** Las 10 animaciones del set base (idle/locomoción/combate). Un modelo sin
 *  cualquiera de ellas NO se ofrece: el juego la pediría y fallaría. */
export const HOJAS_BASE_ANIMS = [
  "idle",
  "walk",
  "run",
  "quick",
  "heavy",
  "medium",
  "defensive",
  "precise",
  "hit_react",
  "death",
] as const;

/** Respuesta de `GET /sprites/index.json` (dev server del cliente). Cruda:
 *  cada modelo con las anims que TIENE en disco para `required.angle` —
 *  incompletos incluidos, que filtrar es trabajo de `modelosCompletos`. */
export interface SpriteCensusResponse {
  required: { anims: string[]; angle: string };
  models: { id: string; anims: string[] }[];
}

/** Ids de los modelos del censo con el set completo: los ÚNICOS que el
 *  título puede ofrecer. Conserva el orden del censo. */
export function modelosCompletos(census: SpriteCensusResponse): string[] {
  return census.models
    .filter((m) => census.required.anims.every((anim) => m.anims.includes(anim)))
    .map((m) => m.id);
}
