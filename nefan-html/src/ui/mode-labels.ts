/** Etiquetas e iconos compartidos del modo de gráficos (world.render_mode /
 *  world.character_mode del save). Fuente única para el title-screen (modo
 *  inicial de la partida) y el chip de gráficos del HUD (cambio en partida):
 *  ambos controles escriben el MISMO campo y deben leerse como la misma cosa.
 *  Los ids internos "image"/"vector" están congelados en saves y contratos —
 *  no renombrar ("vector" viene del antiguo compositor SVG). */

export const RENDER_MODE_LABELS: Record<string, string> = {
  image: "Imagen IA",
  vector: "Maqueta 3D",
};

export const CHAR_MODE_LABELS: Record<string, string> = {
  image: "Skins IA",
  vector: "Personajes base",
};

export const RENDER_MODE_ICONS: Record<string, string> = {
  image: "🎨",
  vector: "🧱",
};

/** Coste por modo, para que título y chip avisen con las mismas palabras. */
export const MODE_COST_LABELS: Record<string, string> = {
  image: "gasta créditos",
  vector: "sin coste",
};

/** Por qué «Imagen IA» no pinta nada NUEVO: la corrida es de desarrollo (el
 *  `bridge_hello`, `Entorno` en `session/gates-de-imagen.ts`) y ahí los caminos
 *  automáticos solo restauran lo ya pagado. Una frase para el registro y el
 *  chip, dicha igual en los dos, y con la salida escrita: quien quiera generar
 *  sabe qué poner. */
export const MOTIVO_SIN_GENERACION =
  "entorno de desarrollo: solo se restaura lo ya pagado (NEFAN_ENTORNO=produccion para generar)";
