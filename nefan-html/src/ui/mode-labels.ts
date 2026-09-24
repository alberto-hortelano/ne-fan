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

/** Coste por modo, para que título y chip avisen con las mismas palabras.
 *  Imagen IA NO siempre gasta: si los gates no dejan generar (el entorno de
 *  desarrollo), encenderla solo restaura lo ya pagado, y decir «gasta
 *  créditos» sería mentir hacia el lado caro (QA de la tanda AS, H1). `paga`
 *  sale de `loQuePagaImagenIA` (core), el mismo dato que decide el POST. */
export function costeDelModo(mode: "image" | "vector", paga: boolean): string {
  if (mode === "vector") return "sin coste";
  return paga ? "gasta créditos" : "solo lo ya pagado";
}

/** Por qué «Imagen IA» no pinta nada NUEVO, cuando el bridge dijo que la
 *  corrida es de desarrollo: ahí los caminos automáticos solo restauran lo ya
 *  pagado. Una frase para el registro y el chip, dicha igual en los dos, y con
 *  la salida escrita: quien quiera generar sabe qué poner. */
export const MOTIVO_SIN_GENERACION =
  "entorno de desarrollo: solo se restaura lo ya pagado (NEFAN_ENTORNO=produccion para generar)";

/** El mismo techo cuando NO hay bridge que lo diga (`html-fixtures`, o antes
 *  del `bridge_hello`): el cliente cae al defecto que no gasta. Aquí no se
 *  manda a poner ninguna variable, porque no hay proceso que la lea (QA H4). */
export const MOTIVO_SIN_BRIDGE =
  "sin bridge no hay entorno declarado: solo se restaura lo ya pagado";
