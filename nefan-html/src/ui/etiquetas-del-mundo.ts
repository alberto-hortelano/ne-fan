/** Etiquetas de mundo y mirilla (primera persona).
 *
 *  En 1ª persona no hay ctx 2D sobre el que escribir el nombre del NPC: las
 *  etiquetas viven en DOM (`world-labels.ts`) y se proyectan con la cámara del
 *  frame recién pintado. La decisión de QUÉ se mira es lógica pura del core
 *  (`pickAimTarget`): en 1ª persona "lo que tienes delante" no es lo más
 *  cercano. Este módulo decide qué se rotula y cuándo se enciende la mirilla;
 *  `WorldLabels` solo coloca las cajas. */

import type { Vec3 } from "@nefan-core/src/types.js";
import { pickAimTarget } from "@nefan-core/src/scene/aim.js";
import type { FpsRenderer } from "../renderer/fps-renderer.js";
import type { MundoDelCliente } from "../world/mundo-del-cliente.js";
import { WorldLabels, type WorldLabel } from "./world-labels.js";

export interface DepsDeEtiquetasDelMundo {
  /** La cámara del frame recién pintado: rayo de puntería, suelo y proyección. */
  fpsRenderer: Pick<FpsRenderer, "cameraRay" | "groundYAt" | "projectToScreen">;
  /** Los cuerpos con nombre: personajes (NPCs y enemigos) y objetos. */
  mundo: Pick<MundoDelCliente, "personajes" | "objetos">;
  /** La posición del jugador: un `const` mutado in situ en `main.ts`, así que
   *  cruza por referencia. */
  playerPos: Vec3;
  /** Con el diálogo abierto (dueño de la pantalla) las etiquetas se retiran. */
  dialogoAbierto(): boolean;
}

export interface EtiquetasDelMundo {
  /** Sincroniza etiquetas y mirilla con el frame recién pintado. Se llama
   *  DESPUÉS de `render()`, con las matrices de cámara de este mismo frame. */
  actualizar(): void;
}

/** Alcance al que se muestra el nombre de un personaje. */
const LABEL_RANGE_M = 18;
/** Alcance de la puntería: cerca, para que encender la mirilla signifique
 *  algo ("puedo tratar con esto"), no "hay algo por ahí". */
const AIM_RANGE_M = 12;
/** Semiángulo del cono de puntería (≈9°: el ancho de un NPC a 6 m). Cerca
 *  manda el cuerpo (radiusM), no el cono. */
const AIM_CONE_RAD = (9 * Math.PI) / 180;
/** Media anchura de un personaje en metros PARA APUNTAR: se apunta a su
 *  cuerpo, y la silueta a la que se apunta es más ancha que el cilindro con el
 *  que camina. NO es el radio de colisión (`NPC_RADIUS_M`/`BODY_RADIUS_M` de
 *  `scene/terrain-collision`, 0,5): compartían nombre y no número, que es
 *  cómo dos constantes que describen el mismo cuerpo acaban divergiendo. */
const AIM_BODY_HALF_WIDTH_M = 0.6;
/** Media ALTURA de un personaje: el cuerpo al que se apunta es un elipsoide
 *  de pie, no una bola. Con pitch la mirada le entra por las rodillas o por
 *  la cabeza tanto como por el pecho. */
const BODY_HALF_HEIGHT_M = 0.9;
/** Centro del cuerpo sobre sus pies — el punto al que se mira. */
const BODY_CENTER_Y_M = 0.95;
/** La descripción de un objeto es prosa del motor, no un nombre: se recorta. */
const LABEL_MAX_CHARS = 42;
/** Altura del nombre sobre los pies de un personaje (el frame y_bot mide
 *  2.4 m y los pies caen al 15 % desde abajo). */
const NPC_LABEL_Y_M = 2.15;

function recorta(text: string): string {
  const t = text.trim();
  return t.length > LABEL_MAX_CHARS ? `${t.slice(0, LABEL_MAX_CHARS - 1)}…` : t;
}

export function crearEtiquetasDelMundo(deps: DepsDeEtiquetasDelMundo): EtiquetasDelMundo {
  const { fpsRenderer: fps, mundo, playerPos, dialogoAbierto } = deps;

  /** Nombres sobre la cabeza (primera persona): DOM temado, no texto en WebGL. */
  const worldLabels = new WorldLabels(document.getElementById("world-labels") as HTMLElement);
  /** Mirilla: se enciende cuando la cámara enfila algo con nombre. */
  const reticleEl = document.getElementById("reticle") as HTMLElement;

  /** Con el diálogo abierto (dueño de la pantalla) se retiran: una etiqueta
   *  huérfana pegada al lienzo es peor que ninguna. */
  function actualizar(): void {
    if (dialogoAbierto()) {
      worldLabels.clear();
      reticleEl.dataset.target = "false";
      return;
    }
    // NPCs Y ENEMIGOS. Los hostiles entraban aquí por primera vez el
    // 2026-08-29 (#323) y este filtro solo miraba a los NPCs, así que lo
    // único que el juego acababa de aprender a poner delante del jugador era
    // justo lo único sin rótulo y sin mirilla: un bulto anónimo que pega. Un
    // enemigo es la entidad que MÁS necesita nombre — es a lo que apuntas.
    const personajes = mundo.personajes.filter((n) => n.alive !== false);
    // Solo objetos CON nombre: sin descripción no hay nada que enseñar, y la
    // mirilla debe encenderse únicamente sobre lo que sí se puede nombrar.
    // Los EDIFICIOS quedan fuera: su centro no es un punto al que se pueda
    // apuntar (estás dentro o pegado a la fachada). El resto de lo que el
    // greybox pinta —un árbol, un barril— sí se puede mirar y nombrar: que el
    // plan lo pinte como volumen decide cómo se DIBUJA, no si tiene nombre.
    const objetos = mundo.objetos.filter(
      (o) => Boolean(o.label?.trim()) && o.volumeType !== "building",
    );

    // El rayo de la CÁMARA, no la proyección horizontal del forward: desde que
    // se puede mirar arriba y abajo, apuntar es apuntar de verdad — con la
    // mirada en el suelo no se enciende la mirilla de quien tienes delante.
    const ojo = fps.cameraRay();
    if (!ojo) {
      // three aún cargando: sin cámara no hay puntería ni proyección.
      worldLabels.clear();
      reticleEl.dataset.target = "false";
      return;
    }
    const aim = pickAimTarget(
      ojo.origin,
      ojo.dir,
      [
        ...personajes.map((e) => ({
          id: e.id,
          pos: { x: e.pos.x, y: fps.groundYAt(e.pos.x, e.pos.z) + BODY_CENTER_Y_M, z: e.pos.z },
          radiusM: AIM_BODY_HALF_WIDTH_M,
          halfHeightM: BODY_HALF_HEIGHT_M,
        })),
        // El bulto real del objeto, no su `radius` de dibujo (que en el 2D vale
        // 8 m para un edificio y convertiría media escena en objetivo).
        ...objetos.map((e) => {
          const alto = e.sizeY ?? 1;
          return {
            id: e.id,
            pos: { x: e.pos.x, y: fps.groundYAt(e.pos.x, e.pos.z) + alto / 2, z: e.pos.z },
            radiusM: Math.min(2, Math.max(e.sizeXZ?.x ?? 0, e.sizeXZ?.z ?? 0) / 2 || AIM_BODY_HALF_WIDTH_M),
            halfHeightM: alto / 2,
          };
        }),
      ],
      { maxDistanceM: AIM_RANGE_M, coneRad: AIM_CONE_RAD },
    );
    reticleEl.dataset.target = aim ? "true" : "false";

    const labels: WorldLabel[] = [];
    for (const n of personajes) {
      if (Math.hypot(n.pos.x - playerPos.x, n.pos.z - playerPos.z) > LABEL_RANGE_M) continue;
      const text = recorta(n.name ?? n.label ?? n.id);
      if (!text) continue;
      labels.push({
        id: n.id,
        text,
        pos: { x: n.pos.x, y: fps.groundYAt(n.pos.x, n.pos.z) + NPC_LABEL_Y_M, z: n.pos.z },
        focus: aim?.id === n.id,
      });
    }
    // Los objetos se nombran solo cuando los MIRAS: una aldea entera etiquetada
    // es ruido, no información.
    const mirado = aim ? objetos.find((o) => o.id === aim.id) : undefined;
    if (mirado) {
      labels.push({
        id: mirado.id,
        text: recorta(mirado.label),
        pos: {
          x: mirado.pos.x,
          y: fps.groundYAt(mirado.pos.x, mirado.pos.z) + (mirado.sizeY ?? 1) + 0.3,
          z: mirado.pos.z,
        },
        focus: true,
      });
    }
    worldLabels.sync(labels, (x, y, z) => fps.projectToScreen(x, y, z));
  }

  return { actualizar };
}
