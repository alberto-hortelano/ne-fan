/** LAS BARRAS DE VIDA DE LOS ENEMIGOS en el HUD: una por cada enemigo del
 *  mundo, con su nombre, su carril y su cifra.
 *
 *  Vivía en `main.ts` (`rebuildEnemyBars` y un bucle en el frame). Sale aquí,
 *  hermano de `etiquetas-del-mundo.ts`, con la tanda BW: la barra aprendió a
 *  OCULTARSE cuando su enemigo no le importa al jugador —lo que salió jugando:
 *  la de Brasco seguía arriba tras despertar en la posada y tras viajar a otro
 *  tile—, y esa regla es de core (`barraDeEnemigoVisible`, el mismo alcance
 *  que el nombre flotante). Aquí solo se pinta.
 *
 *  Se oculta y no se borra: `#hp-text-<id>` sigue en el DOM para quien lo lea
 *  por id (los guiones del banco y `qa/lib/combate.mjs`). */

import { barraDeEnemigoVisible } from "@nefan-core/src/scene/aim.js";
import type { MundoDelCliente } from "../world/mundo-del-cliente.js";

export interface BarrasDeEnemigo {
  /** Rehace una barra por enemigo del mundo (al cargar un tile o un spawn). */
  reconstruir(): void;
  /** Vida, cifra y visibilidad de cada barra, con la posición del jugador de
   *  este frame. */
  actualizar(jugador: { x: number; z: number }): void;
}

export function crearBarrasDeEnemigo(deps: {
  contenedor: HTMLElement;
  mundo: MundoDelCliente;
}): BarrasDeEnemigo {
  const { contenedor, mundo } = deps;
  return {
    reconstruir(): void {
      contenedor.innerHTML = "";
      for (const ee of mundo.enemigos) {
        const bar = document.createElement("div");
        bar.className = "nf-vital";
        // El NOMBRE, no el id. Un enemigo de la escena traía un slug legible por
        // casualidad ("bandido_1") y uno spawneado en runtime llevaba
        // `narr_npc_1788038791_0` flotando en el HUD del jugador (#323).
        const nombre = document.createElement("span");
        nombre.className = "nf-vital-label";
        nombre.style.color = ee.color;
        // textContent y no interpolación en innerHTML: `name` es texto libre del
        // motor narrativo, así que va por el canal que no interpreta marcado.
        nombre.textContent = ee.name ?? ee.label ?? ee.id;
        bar.appendChild(nombre);
        const carril = document.createElement("div");
        carril.className = "nf-bar";
        const relleno = document.createElement("div");
        relleno.className = "nf-bar-fill";
        relleno.id = `hp-${ee.id}`;
        relleno.style.width = "100%";
        relleno.style.background = ee.color;
        carril.appendChild(relleno);
        bar.appendChild(carril);
        const cifra = document.createElement("span");
        cifra.id = `hp-text-${ee.id}`;
        cifra.textContent = String(ee.maxHp);
        bar.appendChild(cifra);
        contenedor.appendChild(bar);
      }
    },

    actualizar(jugador): void {
      for (const ee of mundo.enemigos) {
        const bar = document.getElementById(`hp-${ee.id}`);
        const text = document.getElementById(`hp-text-${ee.id}`);
        if (bar) bar.style.width = Math.max(0, (ee.hp ?? 0) / (ee.maxHp ?? 1) * 100) + "%";
        if (text) text.textContent = Math.ceil(ee.hp ?? 0).toString();
        const vital = text?.parentElement;
        if (vital) {
          vital.hidden = !barraDeEnemigoVisible({
            vivo: ee.alive,
            enganchado: ee.enganchado === true,
            distanciaM: Math.hypot(ee.pos.x - jugador.x, ee.pos.z - jugador.z),
          });
        }
      }
    },
  };
}
