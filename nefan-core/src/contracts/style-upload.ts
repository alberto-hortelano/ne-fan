/** QUÉ SUBIDA DE ESTILO ES VÁLIDA: las reglas de `POST /styles/upload`, sus
 *  números y el motivo exacto de cada rechazo, en un solo sitio.
 *
 *  El jugador sube imágenes de referencia libres (una lámina de materiales,
 *  caras del mundo, model sheets) con su descripción y sus etiquetas, y
 *  remote-gen escribe con ellas `data/styles/user_{slug}/`. Quien de verdad
 *  decide es Python —es quien escribe el pack— pero el título comprueba antes
 *  para no subir 12 MB de base64 que van a volver en un 422.
 *
 *  Hasta la PR 7 de #241 (2026-09-07) esa comprobación estaba escrita DOS veces
 *  y no eran la misma: la pantalla de subir estilo del título —hoy
 *  `nefan-html/src/ui/titulo/subir-estilo.ts`, desde la PR 2 de #346— miraba
 *  cuatro cosas (nombre
 *  ≥ 2, alguna etiqueta, descripción salvo lámina, alguna imagen) con sus
 *  textos, y `ai_server/routers/styles.py:49-159` miraba ocho con los suyos y
 *  con sus números escritos a mano (60, 500, 300, 8, 12, 300, 60) más la lista
 *  de carpetas repetida en `style_packs.py:39`. Resultado: reglas que el
 *  cliente dejaba pasar y el servidor rechazaba con otras palabras, y una
 *  carpeta nueva en el pack habría exigido tocar tres ficheros de dos procesos.
 *
 *  Aquí están una vez. Python NO las copia: lee el snapshot
 *  `data/contract/style-upload.json` que vuelca `scripts/dump-style-upload.ts`,
 *  igual que lee `physics.json` para el tope de `footprint` y por el mismo
 *  motivo medido (#300): dos declaraciones del mismo número divergen en
 *  silencio y ninguna suite se entera. La frescura del snapshot la canda
 *  `test/contract-style-upload.test.ts`.
 *
 *  Módulo PURO (sin `node:*`, sin DOM): el título lo importa desde el bundle.
 *  Lo que NO está aquí y sigue siendo de Python, porque exige los BYTES: que el
 *  base64 decodifique, que pese menos de 12 MB y que PIL sepa abrirlo. */

import { z } from "zod";

import { SAFE_ID, STYLE_REF_FOLDERS, type StyleRefFolder } from "../games/style-refs.js";
import type { StyleUploadRequest } from "./remote-gen.js";

/** La carpeta cuyo contenido es la LÁMINA de materiales: la única que puede ir
 *  sin descripción (lo que muestra no lo elige el motor, lo dicta su rol) y de
 *  la que un pack admite exactamente una. */
export const CARPETA_LAMINA: StyleRefFolder = "surfaces";

/** Los números del contrato, en un objeto porque van al snapshot tal cual. */
export const REGLAS_DE_SUBIDA = {
  nombre: { min: 2, max: 60 },
  descripcion_del_pack_max: 500,
  style_token_max: 300,
  tags: { min: 1, max: 8 },
  imagenes: { min: 1, max: 12 },
  /** Un pack tiene UNA lámina de materiales: es la rejilla que alimenta cada
   *  página del atlas, no una imagen más. */
  laminas_max: 1,
  descripcion_de_imagen_max: 300,
  ref_id_max: 60,
} as const;

const R = REGLAS_DE_SUBIDA;

/** Cómo se nombra en un motivo la imagen que falla: su `id` si el que sube lo
 *  declaró, y si no su POSICIÓN (1-based) en la subida, que es lo único que las
 *  dos puntas pueden decir igual — el título no deriva ids y Python sí. */
export function refDeImagen(indice: number, id?: string): string {
  return id && id.length > 0 ? id : `la imagen ${indice + 1}`;
}

/** El motivo de cada rechazo, con sus números interpolados de `REGLAS_DE_SUBIDA`
 *  (escribirlos otra vez dentro del texto sería la misma enfermedad un piso más
 *  abajo). `{ref}` lo sustituye quien emite por `refDeImagen(...)`.
 *
 *  Son texto de PRODUCTO: el título los enseña tal cual y Python los devuelve
 *  como `detail` del 422, así que el jugador lee lo mismo lo cace quien lo
 *  cace. Por eso hay DOS reglas sobre cómo están escritos, y las dos las canda
 *  `test/style-upload.test.ts`, que RECORRE este objeto entero — un motivo
 *  nuevo entra bajo la regla sin que nadie tenga que acordarse:
 *
 *  1. **UN LÍMITE, UNA FRASE** (#536). Hasta el 2026-09-10 el mínimo y el
 *     máximo de `nombre`, `tags` e `imagenes` compartían motivo, así que quien
 *     subía TRECE imágenes leía «Sube al menos una imagen (máximo 12)» — una
 *     orden que ya había cumplido, con el número que la contradice entre
 *     paréntesis. Un motivo no puede decir «al menos» y «máximo» a la vez: se
 *     parten en dos, y el emisor elige por qué lado se pasó.
 *  2. **FRASE COMPLETA EN ESPAÑOL**: empieza en mayúscula y termina en punto.
 *     `imagen_vacia` y `sin_descripcion` arrancaban con `{ref}`, que se
 *     sustituye por un id (`torre`) o por «la imagen 3»: minúscula, siempre.
 *     Se reescriben para que el hueco caiga DENTRO de la frase.
 *
 *  Y una tercera que NO se canda aquí porque no es de este objeto: que el
 *  jugador lea ESTE texto y no el envoltorio del 422. Eso es de quien pinta
 *  (`ui/titulo/subir-estilo.ts`, que saca el `detail`) y lo mide el guion 124. */
export const MOTIVOS_DE_SUBIDA = {
  nombre_corto: `Ponle un nombre al estilo: al menos ${R.nombre.min} caracteres.`,
  nombre_largo: `El nombre del estilo no puede pasar de ${R.nombre.max} caracteres.`,
  descripcion_del_pack: `La descripción del estilo no puede pasar de ${R.descripcion_del_pack_max} caracteres.`,
  style_token: `El style_token no puede pasar de ${R.style_token_max} caracteres.`,
  sin_etiquetas: `Elige al menos una etiqueta temática: es lo que casa el estilo con los mundos que puede vestir.`,
  demasiadas_etiquetas: `Demasiadas etiquetas temáticas: un estilo admite como mucho ${R.tags.max}.`,
  sin_imagenes: `Sube al menos una imagen de referencia.`,
  demasiadas_imagenes: `Demasiadas imágenes: un pack admite como mucho ${R.imagenes.max}.`,
  mas_de_una_lamina: `Más de una lámina de materiales: ${CARPETA_LAMINA}/ admite exactamente una imagen.`,
  carpeta: `Carpeta desconocida en {ref}: cada imagen del pack va en ${STYLE_REF_FOLDERS.join("/, ")}/.`,
  imagen_vacia: `No llegó ningún fichero de imagen para {ref}.`,
  descripcion_de_imagen: `La descripción de {ref} no puede pasar de ${R.descripcion_de_imagen_max} caracteres.`,
  sin_descripcion: `Falta la descripción de {ref}: solo la lámina de materiales puede ir sin ella.`,
  id_invalido: `Id inválido: {ref}.`,
  id_duplicado: `Id duplicado: {ref}.`,
} as const;

/** Lo que el título tiene en la mano antes de comprobar nada: la carpeta es un
 *  `string` porque sale del `value` de un `<select>`. Salir de aquí con un
 *  `StyleUploadRequest` (carpeta ya estrechada a `StyleRefFolder`) es lo que
 *  hace inexpresable subir un pack sin pasar por esta puerta. */
export interface SubidaCruda {
  name: string;
  description?: string;
  style_token?: string;
  tags: string[];
  images: Array<{ folder: string; description?: string; image_b64: string; id?: string }>;
}

/** `Result<StyleUploadRequest, string>` con el índice de la imagen culpable
 *  cuando el motivo es de una imagen: el título le añade el nombre del fichero,
 *  que es lo único que sabe él y no puede saber Python. */
export type ResultadoDeSubida =
  | { ok: true; subida: StyleUploadRequest }
  | { ok: false; error: string; imagen: number | null };

const conRef = (plantilla: string, indice: number, id?: string): string =>
  plantilla.replace("{ref}", refDeImagen(indice, id));

/** El esquema del cuerpo de `POST /styles/upload`.
 *
 *  Los campos solo declaran FORMA; todas las reglas viven en el `superRefine`,
 *  en el mismo orden en que las aplica Python (límites → etiquetas no vacías →
 *  una sola lámina → imagen a imagen), para que un cuerpo con un solo fallo dé
 *  el mismo motivo en los dos procesos. La salida va NORMALIZADA (nombre y
 *  descripciones recortados, etiquetas vacías fuera), que es lo que Python
 *  guarda en el manifest. */
export const SubidaDeEstiloSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    style_token: z.string().optional(),
    tags: z.array(z.string()),
    images: z.array(
      z.object({
        folder: z.string(),
        description: z.string().optional(),
        image_b64: z.string(),
        id: z.string().optional(),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    const err = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    };
    const nombre = v.name.trim();
    // Cada límite por su lado (#536): el emisor sabe por dónde se pasó, así
    // que no hay motivo para darle al jugador los dos y que elija.
    if (nombre.length < R.nombre.min) err(MOTIVOS_DE_SUBIDA.nombre_corto, ["name"]);
    else if (nombre.length > R.nombre.max) err(MOTIVOS_DE_SUBIDA.nombre_largo, ["name"]);
    if ((v.description ?? "").trim().length > R.descripcion_del_pack_max) {
      err(MOTIVOS_DE_SUBIDA.descripcion_del_pack, ["description"]);
    }
    if ((v.style_token ?? "").trim().length > R.style_token_max) {
      err(MOTIVOS_DE_SUBIDA.style_token, ["style_token"]);
    }
    const tags = v.tags.map((t) => t.trim()).filter((t) => t.length > 0);
    if (tags.length < R.tags.min) err(MOTIVOS_DE_SUBIDA.sin_etiquetas, ["tags"]);
    else if (tags.length > R.tags.max) err(MOTIVOS_DE_SUBIDA.demasiadas_etiquetas, ["tags"]);
    if (v.images.length < R.imagenes.min) err(MOTIVOS_DE_SUBIDA.sin_imagenes, ["images"]);
    else if (v.images.length > R.imagenes.max) err(MOTIVOS_DE_SUBIDA.demasiadas_imagenes, ["images"]);
    const laminas = v.images.filter((img) => img.folder === CARPETA_LAMINA);
    if (laminas.length > R.laminas_max) err(MOTIVOS_DE_SUBIDA.mas_de_una_lamina, ["images"]);

    const vistos = new Set<string>();
    for (const [i, img] of v.images.entries()) {
      const en = (plantilla: string): void => err(conRef(plantilla, i, img.id), ["images", i]);
      if (!(STYLE_REF_FOLDERS as readonly string[]).includes(img.folder)) en(MOTIVOS_DE_SUBIDA.carpeta);
      if (img.image_b64.length === 0) en(MOTIVOS_DE_SUBIDA.imagen_vacia);
      if (img.id !== undefined && img.id.length > 0) {
        if (img.id.length > R.ref_id_max || !SAFE_ID.test(img.id)) en(MOTIVOS_DE_SUBIDA.id_invalido);
        else if (vistos.has(img.id)) en(MOTIVOS_DE_SUBIDA.id_duplicado);
        vistos.add(img.id);
      }
      const desc = (img.description ?? "").trim();
      if (desc.length > R.descripcion_de_imagen_max) en(MOTIVOS_DE_SUBIDA.descripcion_de_imagen);
      if (desc.length === 0 && img.folder !== CARPETA_LAMINA) en(MOTIVOS_DE_SUBIDA.sin_descripcion);
    }
  })
  .transform(
    (v): StyleUploadRequest => ({
      name: v.name.trim(),
      ...(v.description === undefined ? {} : { description: v.description.trim() }),
      ...(v.style_token === undefined ? {} : { style_token: v.style_token.trim() }),
      tags: v.tags.map((t) => t.trim()).filter((t) => t.length > 0),
      images: v.images.map((img) => ({
        folder: img.folder as StyleRefFolder,
        description: (img.description ?? "").trim(),
        image_b64: img.image_b64,
        ...(img.id === undefined ? {} : { id: img.id }),
      })),
    }),
  );

/** La puerta del título: comprueba y devuelve el cuerpo ya normalizado, o el
 *  PRIMER motivo (el orden del `superRefine` es el de Python) con el índice de
 *  la imagen si el motivo es de una. */
export function validarSubidaDeEstilo(cruda: SubidaCruda): ResultadoDeSubida {
  const res = SubidaDeEstiloSchema.safeParse(cruda);
  if (res.success) return { ok: true, subida: res.data };
  const issue = res.error.issues[0];
  const imagen = issue.path[0] === "images" && typeof issue.path[1] === "number" ? issue.path[1] : null;
  return { ok: false, error: issue.message, imagen };
}

/** Lo que se serializa a `data/contract/style-upload.json` para que ai_server
 *  lea los números, las carpetas y los motivos en vez de copiarlos. */
export interface StyleUploadSnapshot {
  $comment: string;
  carpetas: string[];
  lamina: string;
  ref_id_pattern: string;
  limites: typeof REGLAS_DE_SUBIDA;
  motivos: typeof MOTIVOS_DE_SUBIDA;
}

export function styleUploadSnapshot(): StyleUploadSnapshot {
  return {
    $comment:
      "GENERADO por nefan-core/scripts/dump-style-upload.ts desde src/contracts/style-upload.ts. " +
      "NO editar a mano: lo canda test/contract-style-upload.test.ts, que compara este fichero con " +
      "la fuente TS y falla si divergen. Lo leen ai_server/routers/styles.py y ai_server/style_packs.py " +
      "para validar POST /styles/upload con los mismos números, las mismas carpetas y los mismos " +
      "motivos que el zod del cliente, en vez de copiarlos.",
    carpetas: [...STYLE_REF_FOLDERS],
    lamina: CARPETA_LAMINA,
    ref_id_pattern: SAFE_ID.source,
    limites: REGLAS_DE_SUBIDA,
    motivos: MOTIVOS_DE_SUBIDA,
  };
}
