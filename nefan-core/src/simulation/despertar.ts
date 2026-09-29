/** DÓNDE PUEDE DESPERTAR EL JUGADOR: la regla que convierte la elección del
 *  motor (`wake`, #613, «que decida el motor») en un punto del mundo, o dice
 *  por qué no.
 *
 *  Una sola regla y dos puertas: el pre-flight del motor (State API
 *  `POST /despertar/validar`, para que el motor corrija y re-responda) y el
 *  bridge al aplicar la respuesta —que es la que manda: el mundo pudo cambiar
 *  mientras el motor pensaba—. Ninguna de las dos la reescribe.
 *
 *  El orden importa y es el del jugador:
 *   1. un LUGAR se resuelve a su punto (`resolverLugar`); si no da punto, o su
 *      tile no existe todavía, se dice con la lista de lugares que sí valen;
 *   2. el punto tiene que caer en un tile REALIZADO — despertar en el vacío es
 *      despertar en ningún sitio;
 *   3. se aparta de lo sólido con `sitioParaAparecer`: nunca se despierta
 *      dentro de un edificio;
 *   4. y el sitio final queda a más de `radio + margen` de la CASA de todo
 *      hostil vivo, porque al morir todos vuelven a su casa (pieza B). Es lo
 *      que rompe el bucle: el guion 264 medía reaparecer a 4,8 m del Secuaz
 *      que el motor había puesto al lado, y volver a morir.
 *
 *  PURO: sin DOM ni `node:*`. El mundo entra por `MundoDelDespertar`. */

import type { Vec3 } from "../types.js";
import type { Wake } from "../contract/model-io/schemas.js";
import { sitioParaAparecer, type SueloSolido } from "./salida-del-solido.js";
import { PLAYER_RADIUS_M } from "../scene/terrain-collision.js";

/** Metros de más que el juego exige más allá del radio de enganche de cada
 *  hostil. Uno: el paso del jugador en el primer frame no puede engancharle. */
export const MARGEN_DEL_DESPERTAR_M = 1;

export interface HostilParaElDespertar {
  id: string;
  /** Donde estará cuando el jugador despierte (su sitio de alta). */
  casa: { x: number; z: number };
  /** Radio de enganche; `Infinity` si no lo declara. */
  radio: number;
}

/** Lo que la regla necesita saber del mundo, y nada más. */
export interface MundoDelDespertar {
  /** El punto de un lugar del mapa, o `null` si no da punto. */
  resolverLugar(placeId: string): { x: number; z: number } | null;
  /** Los `place_id` en los que se puede despertar ahora (para el motivo). */
  lugaresValidos(): string[];
  /** ¿Hay un tile realizado bajo este punto? */
  tileRealizado(x: number, z: number): boolean;
  suelo: SueloSolido;
  hostiles: HostilParaElDespertar[];
  margen: number;
}

export type Despertar = { ok: true; punto: Vec3 } | { ok: false; motivo: string };

const enMetros = (n: number): string => n.toFixed(2);

export function validarDespertar(wake: Wake, mundo: MundoDelDespertar): Despertar {
  let candidato: { x: number; z: number };
  if (wake.type === "place") {
    const punto = mundo.resolverLugar(wake.place_id);
    if (!punto || !mundo.tileRealizado(punto.x, punto.z)) {
      const validos = mundo.lugaresValidos();
      return {
        ok: false,
        motivo:
          `el lugar "${wake.place_id}" no da un sitio donde despertar (no está en el mapa, no tiene ` +
          `anclaje o su tile no existe todavía). Lugares válidos: ` +
          (validos.length > 0 ? validos.join(", ") : "ninguno — usa un punto"),
      };
    }
    candidato = punto;
  } else {
    if (!Number.isFinite(wake.x) || !Number.isFinite(wake.z)) {
      return { ok: false, motivo: `el punto (${wake.x}, ${wake.z}) no es un número finito` };
    }
    if (!mundo.tileRealizado(wake.x, wake.z)) {
      return {
        ok: false,
        motivo: `el punto (${enMetros(wake.x)}, ${enMetros(wake.z)}) cae fuera de todo tile que exista`,
      };
    }
    candidato = { x: wake.x, z: wake.z };
  }

  let sitio: { x: number; z: number } | null;
  try {
    sitio = sitioParaAparecer(candidato, PLAYER_RADIUS_M, mundo.suelo);
  } catch (err) {
    return { ok: false, motivo: `el punto (${enMetros(candidato.x)}, ${enMetros(candidato.z)}) no se puede mirar: ${(err as Error).message}` };
  }
  if (!sitio) {
    return {
      ok: false,
      motivo: `no hay sitio libre cerca de (${enMetros(candidato.x)}, ${enMetros(candidato.z)}): es sólido en muchos metros a la redonda`,
    };
  }

  for (const h of mundo.hostiles) {
    const minimo = h.radio + mundo.margen;
    const d = Math.hypot(sitio.x - h.casa.x, sitio.z - h.casa.z);
    if (!(d > minimo)) {
      return {
        ok: false,
        motivo:
          `el sitio (${enMetros(sitio.x)}, ${enMetros(sitio.z)}) queda a ${enMetros(d)} m de la casa de ` +
          `"${h.id}", y hace falta más de ${Number.isFinite(minimo) ? enMetros(minimo) : "∞"} m ` +
          `(radio ${Number.isFinite(h.radio) ? enMetros(h.radio) : "∞"} + margen ${enMetros(mundo.margen)})`,
      };
    }
  }
  return { ok: true, punto: { x: sitio.x, y: 0, z: sitio.z } };
}
