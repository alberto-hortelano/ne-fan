/** Plan de PELADO del plató (entrega 2 del proscenio) — lógica pura.
 *
 *  El pipeline de imagen repinta el plató entero (máxima integración) y
 *  después lo pela capa a capa de CERCA a LEJOS: quita la capa más cercana e
 *  inpainta su hueco guiado por lo que hay declarado detrás. El recorte de
 *  cada capa se toma de la imagen ANTERIOR a su pelado; la imagen final, con
 *  todos los volúmenes pelados, es la PLACA (telón + suelo) que el fade y el
 *  parallax revelan detrás.
 *
 *  Las máscaras son las capas DECLARADAS del compositor (alpha de su SVG) —
 *  sin SAM ni visión para el mundo declarado, la lección del experimento
 *  lateral de julio con la precisión de las máscaras de la oblicua. Los
 *  bastidores y la cuarta pared son ENCUADRE teatral, no mundo: quedan
 *  vectoriales y fuera del plan. */

import type { ComposedStage, StageLayer } from "./compose.js";

/** Versión del pipeline de pelado — va en las claves de caché de imagen del
 *  cliente/ai_server: cambiar el plan o el prompt regenera, nunca sirve
 *  rellenos del algoritmo anterior. */
export const STAGE_PEEL_VERSION = 1;

/** Capas de volumen repintables (props/muros). El orden del array respeta el
 *  orden del pintor del compositor (fondo → frente). */
export function paintableVolumeLayers(stage: ComposedStage): StageLayer[] {
  return stage.layers.filter((l) => l.kind === "prop" || l.kind === "wall");
}

export interface PeelStep {
  /** Capa a pelar: su recorte sale de la imagen previa; su hueco se inpainta. */
  layerId: string;
  /** Etiqueta humana (debug/log). */
  label: string;
  /** SVG standalone de la máscara — la propia capa del compositor. */
  maskSvg: string;
  /** Lo declarado DETRÁS de esta capa (z mayor), de cerca a lejos. */
  behindLabels: string[];
  /** Instrucción del relleno (inglés, con negativas duras — julio: donde no
   *  hay nada declarado detrás, el modelo inventa tablones/cercas). */
  prompt: string;
}

export interface PeelPlan {
  version: number;
  /** Pasos en orden de EJECUCIÓN: de cerca (embocadura) a lejos (telón). */
  steps: PeelStep[];
}

/** Instrucción de inpaint para un hueco con `behindLabels` declarado detrás. */
export function buildPeelPrompt(behindLabels: string[], backdrop?: string): string {
  const behind =
    behindLabels.length > 0
      ? `these elements that are partially hidden behind it: ${behindLabels.join(", ")}`
      : "ONLY the empty stage floor";
  const far = backdrop ? ` and, at the far end, the painted backdrop (${backdrop})` : "";
  return (
    `Fill the masked region by continuing EXACTLY what lies behind the removed object: ${behind}${far}. ` +
    "Extend the floor and the already-visible surfaces seamlessly. " +
    "Do NOT invent any new object: no planks, fences, signs, crates, furniture, windows, doors, plants or creatures " +
    "that are not listed above. Match the surrounding painting style, lighting, colours and perspective exactly."
  );
}

/** Plan de pelado del plató: un paso por capa de volumen, de cerca a lejos. */
export function peelPlanFor(stage: ComposedStage, opts: { backdrop?: string } = {}): PeelPlan {
  // El array de capas viene fondo→frente; el pelado va frente→fondo.
  const volumes = paintableVolumeLayers(stage);
  const nearToFar = [...volumes].reverse();
  const steps: PeelStep[] = nearToFar.map((layer, i) => {
    const behind = nearToFar
      .slice(i + 1)
      .map((l) => l.label ?? l.id);
    return {
      layerId: layer.id,
      label: layer.label ?? layer.id,
      maskSvg: layer.svg,
      behindLabels: behind,
      prompt: buildPeelPrompt(behind, opts.backdrop),
    };
  });
  return { version: STAGE_PEEL_VERSION, steps };
}
