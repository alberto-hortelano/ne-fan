/** Registro de renderers de vista del cliente 2D (patrón createSystemRegistry,
 *  como combate e input): id ausente → oblicua (la vista por defecto);
 *  id desconocido → error con la lista (fail-loud).
 *
 *  La oblicua reutiliza la instancia ya construida en main.ts (su cableado —
 *  pipeline de imagen, tiles, occluders — vive fuera del contrato Renderer2D);
 *  el proscenio se construye bajo demanda. */

import { createSystemRegistry } from "@nefan-core/src/systems/registry.js";
import type { Renderer2D } from "./renderer2d.js";
import type { CanvasRenderer } from "./canvas-renderer.js";
import { ProsceniumRenderer } from "./proscenium-renderer.js";
import type { SpriteRenderer } from "./sprite-renderer.js";

export interface RendererDeps {
  canvas: HTMLCanvasElement;
  spriteRenderer?: SpriteRenderer;
  /** Instancia oblicua ya cableada de main.ts. */
  oblique: CanvasRenderer;
}

export const rendererRegistry = createSystemRegistry<Renderer2D, RendererDeps>(
  "renderer",
  "oblique",
  {
    oblique: (deps) => deps.oblique,
    proscenium: (deps) =>
      new ProsceniumRenderer(deps.canvas, { spriteRenderer: deps.spriteRenderer }),
  },
);
