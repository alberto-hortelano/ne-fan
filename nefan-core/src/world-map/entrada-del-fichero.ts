/** Cómo arranca una partida nueva con lo que hay en `world/tile.json` — la
 *  DECISIÓN, pura; la lectura del disco es de `games/world-snapshot.ts` y la
 *  ejecución del bridge (`handlers/session.ts`, `handlers/bootstrap-tile.ts`).
 *
 *  Hay cuatro caminos, y el que nace con #578 es el tercero:
 *
 *   · `replay`: el mundo del fichero se sirve entero, sin motor.
 *   · `sembrar`: no hay mundo que servir (sin fichero, stale o ilegible) y el
 *     motor siembra el mapa y genera la entrada — el bootstrap de siempre.
 *   · `entrada-en-el-mapa-del-fichero`: el fichero es de hoy, pero su ENTRADA
 *     no pasa el validador de hoy. El motor genera SOLO la entrada, DENTRO del
 *     mapa del fichero y con el anillo como vecinos.
 *   · `error`: el fichero se contradice a sí mismo y no hay nada honrado que
 *     generar — se dice, sin llamar al motor.
 *
 *  POR QUÉ el tercero no es `sembrar` (#578). Hasta aquí, una entrada
 *  injugable degradaba al bootstrap vivo, que SIEMBRA un mapa nuevo y genera
 *  la entrada sin vecinos; el write conservaba el anillo del fichero junto a
 *  ese mapa, y el fichero acababa mezclando dos generaciones: ocho escenas
 *  cuyo `place_id` y cuyas costuras eran del mapa viejo alrededor de una
 *  entrada y un mapa que no las conocían. Con un motor real los ids sembrados
 *  son otros, y el panel «Salidas» de esos ocho tiles salía vacío — el
 *  defecto que `bootstrap-place.ts` describe como #172. Generar la entrada
 *  en el mapa que ya existe cuesta lo mismo (una llamada) y deja el fichero
 *  de una sola generación.
 *
 *  Lo que NO hace, a propósito: re-etiquetar el anillo contra un mapa nuevo.
 *  El `place_id` de un tile lo decide el bridge por los anchors del mapa
 *  (`generateTileScene`), nunca el motor, y un mapa nuevo dejaría además las
 *  costuras sin casar. */
import { tileKey } from "../scene/tile.js";
import { resolveBootstrapPlaceId } from "./bootstrap-place.js";
import type { WorldMap } from "./types.js";
import { WorldMapManager } from "./world-map.js";

type Escena = Record<string, unknown>;

/** Lo que la puerta de carga encontró en disco, sin decidir nada todavía.
 *  Genérico en el snapshot servible para que este módulo no importe el de
 *  disco (que trae `node:fs`). */
export type CargaDelFichero<S> =
  | { kind: "sin-mundo" }
  | { kind: "ilegible"; motivo: string }
  | { kind: "servible"; snapshot: S }
  | {
      kind: "entrada-injugable";
      /** Por qué la entrada no se sirve (fichero, escena y errores). */
      motivo: string;
      worldMap: WorldMap;
      /** Las escenas del ANILLO que SÍ pasan el validador (ya cribadas),
       *  sin la entrada. */
      anillo: Record<string, Escena>;
      entradaVieja: Escena;
      entrySceneId: string;
    };

/** Lo que hace falta para generar la entrada nueva dentro del mapa viejo. */
export interface PlanDeEntrada {
  worldMap: WorldMap;
  anillo: Record<string, Escena>;
  entrySceneId: string;
  /** El lugar de partida, del mapa del fichero; `null` si el mapa no tiene
   *  ningún lugar (entonces no hay a dónde viajar y un panel vacío no miente). */
  placeId: string | null;
}

export type CaminoDeArranque<S> =
  | { camino: "replay"; snapshot: S }
  /** `aviso`: por qué no se sirve el fichero que SÍ había (ilegible). */
  | { camino: "sembrar"; aviso?: string }
  | { camino: "entrada-en-el-mapa-del-fichero"; motivo: string; plan: PlanDeEntrada }
  | { camino: "error"; motivo: string };

export function caminoDeArranque<S>(carga: CargaDelFichero<S>): CaminoDeArranque<S> {
  switch (carga.kind) {
    case "sin-mundo":
      return { camino: "sembrar" };
    case "ilegible":
      return { camino: "sembrar", aviso: carga.motivo };
    case "servible":
      return { camino: "replay", snapshot: carga.snapshot };
    case "entrada-injugable": {
      const plan = planDeEntrada(carga);
      if (!plan.ok) return { camino: "error", motivo: plan.motivo };
      return { camino: "entrada-en-el-mapa-del-fichero", motivo: carga.motivo, plan: plan.plan };
    }
  }
}

/** Las tres cosas que el fichero tiene que cumplir para que la entrada nueva
 *  se pueda generar en SU mapa. Si no, error con motivo y sin llamar al motor:
 *  sembrar un mapa nuevo en silencio es justo el bug de #578. */
export function planDeEntrada(
  carga: Extract<CargaDelFichero<unknown>, { kind: "entrada-injugable" }>,
): { ok: true; plan: PlanDeEntrada } | { ok: false; motivo: string } {
  // 1 · La entrada es el tile (0,0): es el único que lleva al `player`, y el
  //     bootstrap y el replay la ponen ahí. Otra cosa es un fichero que no
  //     escribió este juego.
  const origen = tileKey(0, 0);
  if (carga.entrySceneId !== origen) {
    return {
      ok: false,
      motivo: `la escena de entrada del fichero es "${carga.entrySceneId}" y no "${origen}": no se sabe dónde regenerarla`,
    };
  }
  // 2 · El anillo no apunta a lugares que su propio mapa no tiene. Un fichero
  //     así se contradice: regenerar la entrada lo dejaría igual de roto, con
  //     el panel «Salidas» de esos tiles vacío (#172). Regenerar el MUNDO es
  //     el botón del título.
  const colgando = escenasSinLugarEnElMapa(carga.anillo, carga.worldMap);
  if (colgando.length > 0) {
    const lugares = [...new Set(colgando.map((c) => `"${c.placeId}"`))].join(", ");
    return {
      ok: false,
      motivo:
        `el mundo guardado se contradice: ${colgando.length} escena(s) apuntan a lugares que su ` +
        `propio mapa no tiene (${lugares}: ${colgando.map((c) => c.sceneId).join(", ")})`,
    };
  }
  // 3 · El lugar de partida sale del MAPA DEL FICHERO, cruzado con lo que
  //     declaraba la entrada vieja — la misma regla de tres estados que el
  //     bootstrap aplica al mapa que siembra el motor. Sobre una copia: esta
  //     función no toca lo que le pasan.
  const mapa = WorldMapManager.fromSerialized(structuredClone(carga.worldMap));
  const lugar = resolveBootstrapPlaceId(mapa, carga.entradaVieja);
  if (lugar.kind === "error") {
    return { ok: false, motivo: `la entrada del fichero no se puede atar a su mapa: ${lugar.error}` };
  }
  return {
    ok: true,
    plan: {
      worldMap: carga.worldMap,
      anillo: carga.anillo,
      entrySceneId: carga.entrySceneId,
      placeId: lugar.kind === "place" ? lugar.placeId : null,
    },
  };
}

/** Las escenas que declaran un `place_id` que ese world_map NO nombra (#451,
 *  hallazgo H-1 de QA).
 *
 *  Nació para AVISAR, desde el escritor del snapshot, de que el bootstrap vivo
 *  había conservado un anillo con los lugares del mapa anterior. Desde #578 ya
 *  no hay escritor que mezcle mapas, y la regla es una PRECONDICIÓN: un
 *  fichero cuyo anillo cuelga no se arranca (`planDeEntrada`).
 *
 *  Lo que le pasa al jugador si una escena cuelga: `placeDeLaEscena` devuelve
 *  ese id porque la escena lo declara (`world-map/exits.ts`),
 *  `getOutgoingLinks` de un lugar que no existe devuelve `[]`, y el panel
 *  «Salidas» de ese tile sale VACÍO.
 *
 *  Lo que esto NO sujeta (QA de BE, H4): es precondición SOLO del camino
 *  `entrada-injugable`. Un fichero SERVIBLE cuyo anillo ya cuelga —por ejemplo,
 *  uno que dejó mezclado el bootstrap de antes de #578— se replayea sin aviso
 *  y con «Salidas» vacío en esos tiles. */
export function escenasSinLugarEnElMapa(
  scenes: Record<string, Escena>,
  worldMap: WorldMap,
): Array<{ sceneId: string; placeId: string }> {
  const lugares = new Set(Object.keys(worldMap?.places ?? {}));
  const colgando: Array<{ sceneId: string; placeId: string }> = [];
  for (const [sceneId, scene] of Object.entries(scenes)) {
    const placeId = scene?.place_id;
    if (typeof placeId !== "string" || placeId === "") continue;
    if (lugares.has(placeId)) continue;
    colgando.push({ sceneId, placeId });
  }
  return colgando;
}
