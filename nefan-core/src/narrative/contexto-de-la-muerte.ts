/** EL CONTEXTO DE UNA MUERTE: lo que el motor ve para decidir dónde despierta
 *  el jugador (#613, «que decida el motor»). Va en `context.muerte`, junto al
 *  resto de `serializeForLlm`, y el prompt `player_death.md` documenta cada
 *  campo.
 *
 *  PURO: los datos los reúne el bridge (sim, mapa, escenas) y aquí solo se
 *  les da la forma que lee el motor. Todo en METROS de mundo. */

export interface HostilVivoDeLaMuerte {
  id: string;
  name: string;
  pos: { x: number; z: number };
  casa: { x: number; z: number };
  /** Radio de enganche; `null` si no declara (engancha desde cualquier sitio). */
  radio_m: number | null;
}

export interface LugarDeLaMuerte {
  place_id: string;
  name: string;
  centro: { x: number; z: number };
  distancia_m: number;
}

export interface ContextoDeLaMuerte {
  cayo_en: { x: number; z: number };
  tile: { tx: number; ty: number } | null;
  place_id: string | null;
  asesino: { id: string; name: string } | null;
  hostiles_vivos: HostilVivoDeLaMuerte[];
  /** Por distancia al cadáver, el más cercano primero. */
  lugares: LugarDeLaMuerte[];
  /** SUGERENCIA: el último punto donde el jugador estaba vivo y nadie le
   *  tenía enganchado. Puede caer dentro del radio de un hostil que llegó
   *  después; el juego lo comprueba igual que cualquier otro punto. */
  punto_seguro: { x: number; z: number } | null;
  margen_m: number;
}

export interface DatosDeLaMuerte {
  cayoEn: { x: number; z: number };
  tile: { tx: number; ty: number } | null;
  placeId: string | null;
  asesino: { id: string; name: string } | null;
  hostiles: Array<{ id: string; name: string; pos: { x: number; z: number }; casa: { x: number; z: number }; radio: number }>;
  /** Lugares que resuelven a un punto con su tile realizado. */
  lugares: Array<{ place_id: string; name: string; centro: { x: number; z: number } }>;
  puntoSeguro: { x: number; z: number } | null;
  margen: number;
}

const redondo = (n: number): number => Math.round(n * 100) / 100;
const punto = (p: { x: number; z: number }) => ({ x: redondo(p.x), z: redondo(p.z) });

export function contextoDeLaMuerte(d: DatosDeLaMuerte): ContextoDeLaMuerte {
  const lugares = d.lugares
    .map((l) => ({
      place_id: l.place_id,
      name: l.name,
      centro: punto(l.centro),
      distancia_m: redondo(Math.hypot(l.centro.x - d.cayoEn.x, l.centro.z - d.cayoEn.z)),
    }))
    .sort((a, b) => a.distancia_m - b.distancia_m);
  return {
    cayo_en: punto(d.cayoEn),
    tile: d.tile,
    place_id: d.placeId,
    asesino: d.asesino,
    hostiles_vivos: d.hostiles.map((h) => ({
      id: h.id,
      name: h.name,
      pos: punto(h.pos),
      casa: punto(h.casa),
      radio_m: Number.isFinite(h.radio) ? h.radio : null,
    })),
    lugares,
    punto_seguro: d.puntoSeguro ? punto(d.puntoSeguro) : null,
    margen_m: d.margen,
  };
}
