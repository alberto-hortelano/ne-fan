/** Dos rótulos que se pisan: cuál sobra — criba pura en píxeles de pantalla.
 *
 *  En primera persona los nombres van sobre la cabeza de cada cuerpo, y dos
 *  cuerpos alineados en la misma dirección proyectan sus cajas casi en el mismo
 *  sitio: a 8 y a 10 m, dos rótulos quedan a una decena de píxeles uno de otro,
 *  menos que el alto de la caja. El resultado no es «dos nombres», es un
 *  amasijo en el que no se lee ninguno de los dos.
 *
 *  La decisión de cuál se calla es de JUEGO, no de pintura, así que vive aquí
 *  —al lado de `aim.ts` y por su misma razón— y no en el cliente: entra
 *  geometría en píxeles y sale la lista de los que no se emiten. Sin DOM, sin
 *  three, con test propio.
 *
 *  LA REGLA, en una sola frase: se ordenan por PRIORIDAD y se van colocando; el
 *  que interseque a uno ya colocado no se emite. La prioridad es
 *
 *    1. el que la mirilla ENFILA — y esta excepción no es un adorno: la
 *       puntería gana por desviación angular, no por distancia
 *       (`pickAimTarget`), así que el enfilado puede ser perfectamente el más
 *       LEJANO de los dos. Una criba que se quedara con «el cercano» a secas
 *       apagaría el nombre de aquello a lo que estás apuntando y dejaría la
 *       mirilla encendida sobre un bulto anónimo, que es el defecto exacto que
 *       el rótulo vino a cerrar;
 *    2. luego, por PROFUNDIDAD ascendente: de dos que se pisan se lee el del
 *       cercano, que es el que el jugador tiene delante.
 *
 *  Una sola frase da las tres cosas —el cercano gana, la excepción de la
 *  mirilla, y las cadenas de tres— sin dos reglas que puedan divergir. Y solo
 *  TAPA lo colocado: si A tapa a B, B no tapa a C. B no está en pantalla; que
 *  su hueco callara a un tercero sería esconder dos nombres por uno.
 *
 *  NO decide oclusión por geometría del mundo: un rótulo se sigue viendo a
 *  través de la pared, y eso es decisión escrita (ver `ui/world-labels.ts`).
 *  Aquí solo se mira quién pisa a quién en la pantalla.
 */

/** Una caja de rótulo ya proyectada, en PÍXELES CSS del lienzo. */
export interface CajaDeRotulo {
  /** Identidad estable de la entidad rotulada. */
  id: string;
  /** Punto de anclaje: el PIE de la caja, centrado — es el `translate(-50%,
   *  -100%)` del CSS, y se escribe aquí para que la conversión ancla → rect
   *  exista UNA vez y con test, en vez de repetida en quien pinte. */
  x: number;
  y: number;
  /** Tamaño MEDIDO de la caja (nunca estimado por longitud del texto: la
   *  tipografía la pone el style pack). */
  w: number;
  h: number;
  /** Profundidad en metros del cuerpo rotulado: quién está más cerca. */
  depthM: number;
  /** El que la cámara enfila. Como mucho hay uno, pero la función no lo
   *  presupone: con varios, entre ellos manda la profundidad. */
  focus?: boolean;
}

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Ancla (pie centrado) → rectángulo, igual que el `translate(-50%,-100%)`. */
function rectDe(c: CajaDeRotulo): Rect {
  return { x0: c.x - c.w / 2, x1: c.x + c.w / 2, y0: c.y - c.h, y1: c.y };
}

/** ¿Se pisan? Tocarse por el borde NO es pisarse: dos cajas pegadas se leen
 *  las dos, y con `>=` un rótulo apagaría a su vecino sin taparle un píxel. */
function seCruzan(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** Ids de los rótulos que NO se emiten por quedar pisados por otro.
 *
 *  Fail-loud: una caja sin tamaño o con coordenadas que no son números es una
 *  MEDIDA que no se hizo, no un rótulo diminuto. Quien mide (el cliente) sabe
 *  distinguir «no cabe» de «no pude medir» y no debe preguntar por lo segundo;
 *  colapsarlas aquí devolvería un `Set` vacío que se lee como «no se pisa
 *  ninguno». */
export function rotulosTapados(cajas: readonly CajaDeRotulo[]): Set<string> {
  const orden = cajas.map((c, i) => {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.depthM)) {
      throw new Error(`rotulosTapados: caja "${c.id}" sin posición finita (x=${c.x}, y=${c.y}, depthM=${c.depthM})`);
    }
    if (!(c.w > 0) || !(c.h > 0)) {
      throw new Error(`rotulosTapados: caja "${c.id}" sin tamaño (w=${c.w}, h=${c.h}): la medida en píxeles no se hizo`);
    }
    return { c, i };
  });
  // El enfilado primero; luego el más cercano. `i` desempata para que dos
  // cajas idénticas no cambien de suerte según cómo caiga la ordenación.
  orden.sort((a, b) => {
    const fa = a.c.focus ? 0 : 1;
    const fb = b.c.focus ? 0 : 1;
    if (fa !== fb) return fa - fb;
    if (a.c.depthM !== b.c.depthM) return a.c.depthM - b.c.depthM;
    return a.i - b.i;
  });

  const tapados = new Set<string>();
  const colocados: Rect[] = [];
  for (const { c } of orden) {
    const r = rectDe(c);
    if (colocados.some((p) => seCruzan(r, p))) {
      tapados.add(c.id);
      continue;
    }
    colocados.push(r);
  }
  return tapados;
}
