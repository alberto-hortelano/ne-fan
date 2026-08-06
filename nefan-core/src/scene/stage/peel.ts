/** Plan de PELADO del plató (entrega 2 del proscenio) — lógica pura.
 *
 *  El pipeline de imagen repinta el plató entero (máxima integración) y
 *  después lo pela capa a capa de CERCA a LEJOS: quita la capa más cercana e
 *  inpainta su hueco guiado por lo que hay declarado detrás. El recorte de
 *  cada capa se toma de la imagen ANTERIOR a su pelado; la imagen final, con
 *  todos los volúmenes pelados, es la PLACA (telón + suelo) que el fade y el
 *  parallax revelan detrás.
 *
 *  PROHIBIDO derivar las máscaras de las siluetas DECLARADAS de las capas: se
 *  probó y NO funciona — el modelo de imagen recoloca y reorienta lo
 *  declarado, así que la silueta declarada recorta SUELO con forma de objeto.
 *  Jamás va a funcionar. La máscara de cada paso debe salir de SEGMENTAR lo
 *  que el modelo PINTÓ (visión localiza el elemento → SAM2 segment_boxes);
 *  este plan solo aporta el ORDEN (cerca→lejos), las etiquetas esperadas y
 *  los prompts de relleno. */

import type { ComposedStage } from "./compose.js";
import { STAGE_PEEL_VERSION, buildPeelPrompt, paintableVolumeLayers } from "./segments.js";

export { STAGE_PEEL_VERSION, buildPeelPrompt, paintableVolumeLayers };

export interface PeelStep {
  /** Capa a pelar: su recorte sale de la imagen previa; su hueco se inpainta.
   *  La MÁSCARA no viaja aquí: sale de segmentar la imagen pintada (visión +
   *  SAM2), nunca de la silueta declarada de la capa. */
  layerId: string;
  /** Etiqueta humana (debug/log y búsqueda del elemento por visión). */
  label: string;
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
      behindLabels: behind,
      prompt: buildPeelPrompt(behind, opts.backdrop),
    };
  });
  return { version: STAGE_PEEL_VERSION, steps };
}
