/** Registro de renderers de vista del cliente 2D (patrón createSystemRegistry,
 *  como combate e input): id ausente → oblicua (la vista por defecto);
 *  id desconocido → error con la lista (fail-loud).
 *
 *  La oblicua reutiliza la instancia ya construida en main.ts (su cableado —
 *  pipeline de imagen, tiles, occluders — vive fuera del contrato Renderer2D);
 *  la fps se construye bajo demanda y NO la usa: por eso `oblique` es
 *  opcional. Pedirla para crear cualquier vista obligaba a tener viva una
 *  instancia del renderer oblicuo aunque la partida no lo pinte jamás. Su
 *  ausencia solo es un error al pedir la vista que la reutiliza, y ahí se
 *  dice fuerte. */

import { createSystemRegistry } from "@nefan-core/src/systems/registry.js";
import type { Renderer2D } from "./renderer2d.js";
import type { CanvasRenderer } from "./canvas-renderer.js";
import { FpsRenderer } from "./fps-renderer.js";
import type { SpriteRenderer } from "./sprite-renderer.js";

export interface RendererDeps {
  canvas: HTMLCanvasElement;
  spriteRenderer?: SpriteRenderer;
  /** Instancia oblicua ya cableada de main.ts. Obligatoria SOLO para crear
   *  la vista oblicua; la fps no la toca. */
  oblique?: CanvasRenderer;
}

export const rendererRegistry = createSystemRegistry<Renderer2D, RendererDeps>(
  "renderer",
  "oblique",
  {
    oblique: (deps) => {
      if (!deps.oblique) {
        throw new Error('renderer "oblique": falta la instancia CanvasRenderer de main.ts');
      }
      return deps.oblique;
    },
    // Primera persona: canvas WebGL propio (hermano del 2D); three.js se
    // carga dinámico dentro de la fachada.
    fps: (deps) => new FpsRenderer(deps.canvas, { spriteRenderer: deps.spriteRenderer }),
  },
);
