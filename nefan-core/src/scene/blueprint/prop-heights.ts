/** Alturas SEMÁNTICAS por defecto del mobiliario (metros de mundo) — la red
 *  de seguridad cuando el motor narrativo no declara `h` en una entity.
 *
 *  Sin esto, dos mesas de la misma escena podían salir a 0,5 / 0,75 / 1,5 m
 *  según el `kind` (decor/prop) con que las etiquetara el motor: los defaults
 *  del derive están en CELDAS y no miran el label. Aquí el label en español
 *  (contrato del prompt: labels descriptivos) fija una altura creíble; el `h`
 *  declarado SIEMPRE manda sobre esta tabla. */

interface PropHeightRule {
  re: RegExp;
  hM: number;
}

/** Orden importa: la primera regla que casa gana (p. ej. "mesa de altar" es
 *  mesa antes que cualquier otra cosa). Todo en minúsculas sin acentos NO —
 *  los labels del contrato van en español correcto, las regex los cubren. */
const RULES: PropHeightRule[] = [
  { re: /\b(mesa|escritorio|pupitre)\b/i, hM: 0.75 },
  { re: /\b(banco|taburete|banqueta)\b/i, hM: 0.45 },
  { re: /\b(silla|sillón|sillon|trono)\b/i, hM: 0.9 },
  { re: /\b(barril|tonel|barrica|cuba)\b/i, hM: 0.9 },
  { re: /\b(caja|cajón|cajon|arcón|arcon|cofre|baúl|baul)\b/i, hM: 0.6 },
  { re: /\b(estantería|estanteria|librería|libreria|alacena|armario|aparador|vitrina)\b/i, hM: 2.0 },
  { re: /\b(mostrador|barra)\b/i, hM: 1.1 },
  { re: /\b(cama|catre|jergón|jergon)\b/i, hM: 0.6 },
  { re: /\b(yunque)\b/i, hM: 0.8 },
  { re: /\b(carro|carreta|carromato)\b/i, hM: 1.4 },
  { re: /\b(fuente|pozo)\b/i, hM: 1.4 },
  { re: /\b(farol|farola|candelabro)\b/i, hM: 2.2 },
  { re: /\b(chimenea|hogar)\b/i, hM: 2.0 },
];

/** Altura por defecto en METROS para un label de mobiliario; null si el label
 *  no casa con ninguna regla (el caller aplica su default genérico). */
export function defaultPropHeightM(label: string): number | null {
  for (const rule of RULES) {
    if (rule.re.test(label)) return rule.hM;
  }
  return null;
}

/** Clamp del rango creíble de un prop de plató sin `h` declarado. */
export const PROP_H_MIN_M = 0.3;
export const PROP_H_MAX_M = 2.2;
