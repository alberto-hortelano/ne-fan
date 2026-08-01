/** Plan de PELADO del plató (entrega 2 del proscenio) — lógica pura.
 *
 *  El pipeline de imagen repinta el plató entero (máxima integración) y
 *  después lo pela capa a capa de CERCA a LEJOS: quita la capa más cercana e
 *  inpainta su hueco guiado por lo que hay declarado detrás. El recorte de
 *  cada capa se toma de la imagen ANTERIOR a su pelado; la imagen final, con
 *  todos los volúmenes pelados, es la PLACA (telón + suelo) que el fade y el
 *  parallax revelan detrás.
 *
 *  PROHIBIDO derivar las máscaras del SVG declarado de las capas: se probó y
 *  NO funciona — el modelo de imagen recoloca y reorienta lo declarado, así
 *  que la silueta declarada recorta SUELO con forma de objeto. Jamás va a
 *  funcionar. La máscara de cada paso debe salir de SEGMENTAR lo que el
 *  modelo PINTÓ (visión localiza el elemento → SAM2 segment_boxes); este
 *  plan solo aporta el ORDEN (cerca→lejos), las etiquetas esperadas y los
 *  prompts de relleno. Los bastidores y la cuarta pared son ENCUADRE
 *  teatral, no mundo: quedan vectoriales y fuera del plan. */

import type { ComposedStage, StageLayer } from "./compose.js";

/** Versión del pipeline de pelado — va en las claves de caché de imagen del
 *  cliente/ai_server: cambiar el plan o el prompt regenera, nunca sirve
 *  rellenos del algoritmo anterior. */
export const STAGE_PEEL_VERSION = 2;

/** Capas de volumen repintables (props/muros). El orden del array respeta el
 *  orden del pintor del compositor (fondo → frente). */
export function paintableVolumeLayers(stage: ComposedStage): StageLayer[] {
  return stage.layers.filter((l) => l.kind === "prop" || l.kind === "wall");
}

export interface PeelStep {
  /** Capa a pelar: su recorte sale de la imagen previa; su hueco se inpainta.
   *  La MÁSCARA no viaja aquí: sale de segmentar la imagen pintada (visión +
   *  SAM2), nunca del SVG declarado de la capa. */
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

/** Instrucción de inpaint para un hueco con `behindLabels` pintado detrás.
 *  `removed` nombra el objeto retirado — sin la prohibición explícita, un
 *  modelo de fill rellena un hueco con forma de mesa con OTRA mesa (bench
 *  stage_lab 003). */
export function buildPeelPrompt(behindLabels: string[], backdrop?: string, removed?: string): string {
  const behind =
    behindLabels.length > 0
      ? `these elements that are partially hidden behind it: ${behindLabels.join(", ")}`
      : "ONLY the empty stage floor";
  const far = backdrop ? ` and, at the far end, the painted backdrop (${backdrop})` : "";
  const removedClause = removed
    ? `The object being removed is: ${removed}. Do NOT paint the ${removed} back, nor any similar object. `
    : "";
  return (
    `${removedClause}Fill the masked region by continuing EXACTLY what lies behind the removed object: ${behind}${far}. ` +
    "Extend the floor and the already-visible surfaces seamlessly. " +
    "Do NOT invent any new object: no planks, fences, signs, crates, furniture, stoves, windows, doors, plants or creatures " +
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
      behindLabels: behind,
      prompt: buildPeelPrompt(behind, opts.backdrop),
    };
  });
  return { version: STAGE_PEEL_VERSION, steps };
}
