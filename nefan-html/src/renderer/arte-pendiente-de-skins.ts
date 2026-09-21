/** EL INVENTARIO DE SKINS DEL MENÚ DEV: qué personajes siguen dibujándose con la
 *  base y_bot, y cómo se pide el arte de cada uno.
 *
 *  Vive FUERA de `character-sprites.ts` porque no necesita nada privado del
 *  gestor: recibe por su puerto lo único que solo él sabe —en qué punto está
 *  cada prompt y qué hoja base tiene en caché— y el resto es derivación pura
 *  (quitar vacíos, quitar repetidos conservando el orden de entrada, redactar el
 *  rótulo, colgar de cada item el `generar()` que lo pide).
 *
 *  POR QUÉ SALIÓ, y es la parte que importa (H-1 de la QA de #492): el gestor
 *  estaba EN su tope de tamaño, y la primera versión de esto cupo dentro
 *  COMPRIMIENDO el formato —dos líneas fuera del canon de prettier—, no cortando.
 *  Eso deja el fichero 449/450 con `eslint` verde y 467 en cuanto alguien corra
 *  `npm run format`: la deuda no se paga, se esconde, y el trinquete de #358 se
 *  vuelve una cifra que solo es cierta mientras nadie formatee. Aquí no hay tope
 *  que comprar: el módulo es del tamaño que le toque.
 *
 *  Función pura, sin DOM ni red ni reloj: es del banco de `nefan-html/test/`. */
import { CONFIG } from "@nefan-core/src/config.js";
import type { ArtePendiente } from "./types.js";

/** En qué punto está el skin de un prompt. `listo` es el único que NO sale en la
 *  lista: su `idle` ya sustituye a la base, así que no hay nada que ofrecer. */
export type EstadoDeSkin = "listo" | "sin pedir" | "generándose" | "falló";

/** Lo que este módulo no puede saber por su cuenta y le contesta su dueño
 *  (`CharacterSpriteManager`). Es el puerto ENTERO: tres cosas, y ninguna de
 *  ellas es el mapa de skins ni la caché de hojas. */
export interface DuenoDeLosSkins {
  /** Primer frame del `idle` de la base, o `null` si aún no está en caché. La
   *  misma para todas las filas, así que se pide UNA vez y llega ya resuelta. */
  miniatura: CanvasImageSource | null;
  estado(prompt: string): EstadoDeSkin;
  /** Pide ESTE skin aunque el modo global sea maqueta: el gasto controlado del
   *  menú dev, que es un `requestSkin` con `force`. */
  pedir(prompt: string): void;
}

/** Más de esto no cabe en la fila: una descripción narrativa entera desborda el
 *  panel y el rótulo deja de leerse. */
const MAX_ROTULO = 70;

/** El motivo que lleva el botón deshabilitado cuando NO hay backend de skins al
 *  que llamar. No es un fallo: es la configuración del cliente. */
const SIN_BACKEND =
  "Backend de skins apagado por config: activa graphics.ai_skin en nefan-core/src/config.ts";

export function artePendienteDeSkins(prompts: Iterable<string>, dueno: DuenoDeLosSkins): ArtePendiente[] {
  const disabledReason = CONFIG.graphics.ai_skin ? undefined : SIN_BACKEND;
  const items: ArtePendiente[] = [];
  // `Set` y no un `filter`: quita los repetidos CONSERVANDO el orden de entrada,
  // que es el que tenía la lista cuando la hacía `main.ts` — dos NPCs con la
  // misma descripción comparten skin y son UNA fila.
  for (const prompt of new Set(prompts)) {
    if (!prompt) continue;
    const estado = dueno.estado(prompt);
    if (estado === "listo") continue;
    // El rótulo es el estado tal cual, salvo el de quien nadie ha pedido: ahí lo
    // que le importa a quien mira no es que no se haya pedido, sino QUÉ está
    // viendo mientras tanto.
    const seVe = estado === "sin pedir" ? "base y_bot" : estado;
    const corto = prompt.length > MAX_ROTULO ? `${prompt.slice(0, MAX_ROTULO)}…` : prompt;
    items.push({
      kind: "skin",
      id: prompt,
      label: `Skin: ${corto} (${seVe})`,
      thumb: dueno.miniatura,
      inFlight: estado === "generándose",
      disabledReason,
      generar: () => {
        dueno.pedir(prompt);
        return Promise.resolve();
      },
    });
  }
  return items;
}
