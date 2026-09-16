/** Etiquetas de nombre sobre el mundo (vista en primera persona).
 *
 *  Van en DOM, no en la escena three, y es una decisión, no una comodidad: el
 *  tema de la partida ya es CSS (ui/theme.ts + los tokens --nf-* de
 *  game-ui.css), así que el nombre de un personaje se lee EXACTAMENTE igual
 *  sobre su cabeza que en el panel de diálogo. En WebGL habría que hornear un
 *  atlas de fuente y re-implementar el tema del pack para cada estilo.
 *
 *  La proyección la inyecta el renderer (FpsRenderer.projectToScreen): este
 *  módulo no sabe de cámaras, solo coloca cajas y las ordena por profundidad.
 *  Tampoco decide cuál de dos que se pisan sobra: eso es lógica de juego y vive
 *  en core (`scene/rotulos-apilados.ts`); aquí se MIDE la caja y se pinta lo
 *  que esa función deja pasar.
 */

import { rotulosTapados, type CajaDeRotulo } from "@nefan-core/src/scene/rotulos-apilados.js";
import { errors } from "./error-log.js";

export interface WorldLabel {
  /** Identidad estable (id de la entidad): reusa el nodo entre frames. */
  id: string;
  text: string;
  /** Punto de anclaje en METROS de mundo — normalmente sobre la cabeza. */
  pos: { x: number; y: number; z: number };
  /** El objetivo que la cámara enfila: se resalta con el acento del tema. */
  focus?: boolean;
  /** Es un HOSTIL: su nombre va en el color de peligro. Quién ES un cuerpo y a
   *  quién APUNTAS son dos preguntas distintas y se pintan con dos propiedades
   *  distintas (color / borde), así que un enemigo enfilado sigue en rojo —
   *  que es justo cuando más falta hace. */
  peligro?: boolean;
}

/** Mundo → píxeles CSS del lienzo, o null si el punto cae detrás del ojo. */
export type ScreenProjector = (
  x: number,
  y: number,
  z: number,
) => { x: number; y: number; depthM: number } | null;

/** EL RÓTULO SE VE A TRAVÉS DE LA PARED, Y ES DECISIÓN (2026-09-14, #484).
 *
 *  No hay raycast ni oclusión por geometría aquí, y no es un olvido: se
 *  preguntó y se contestó. Un nombre que atraviesa la pared te dice dónde está
 *  la gente del pueblo y es gratis; comprobar la línea de visión de cada rótulo
 *  y cada frame no lo es. Se escribe AQUÍ porque este es el fichero que abre
 *  quien vaya a meter ese raycast —y en `docs/arquitectura/vistas.md`, que es
 *  lo que CLAUDE.md manda leer al tocar el renderer—: hay prosa COMMITEADA de
 *  una QA anterior que lo juzgó como defecto visual («rótulos que no respetan
 *  la oclusión… parece pegado al cristal»), así que sin esto alguien lo
 *  «arregla» dentro de tres meses. Sin candado, también a propósito: costaría
 *  un guion de navegador con fixture de muro, más que la decisión entera.
 *
 *  Lo que SÍ se mira es que dos rótulos no se pisen ENTRE ELLOS, que es otra
 *  pregunta y vive en core (`scene/rotulos-apilados.ts`).
 *
 *  Distancia a partir de la cual la etiqueta se atenúa (lejos estorba menos). */
const FADE_FROM_M = 8;
const FADE_TO_M = 20;
const MIN_OPACITY = 0.35;

/** Un rótulo vivo: su nodo y la CAJA que ocupa, medida una sola vez por texto.
 *
 *  La caja no se deduce de la longitud del texto: la tipografía la pone el
 *  style pack y una heurística de `n × px` mentiría con la primera fuente
 *  propia. Se mide de verdad (`offsetWidth`/`offsetHeight`) y se guarda CON EL
 *  NODO — leerla por rótulo y por frame fuerza un reflow por frame, que es lo
 *  que un bucle a 60 fps no puede pagar. Guardarla con el nodo y no en un mapa
 *  aparte es lo que hace que la medida muera con el rótulo: cuando la entidad
 *  se va del mundo no queda una caja vieja esperando a otro con su id. */
interface Rotulo {
  el: HTMLElement;
  /** El texto con el que se midieron `w`/`h`; si cambia, hay que remedir. */
  medidoCon: string;
  w: number;
  h: number;
}

export class WorldLabels {
  private el: HTMLElement;
  private nodes = new Map<string, Rotulo>();
  /** Lo colocado en el último sync — es lo que assertan los guiones de QA. */
  private placed: { id: string; text: string; x: number; y: number; focus: boolean; peligro: boolean; w: number; h: number }[] = [];
  /** Lo que estaba a la vista y se calló por quedar pisado por otro. Va aparte
   *  de «no está»: sin distinguirlos, un rótulo ausente por tapado, uno fuera
   *  de alcance y uno detrás del ojo son el mismo vacío, y un guion verde deja
   *  de decir nada. */
  private tapados: string[] = [];
  /** Ids cuya caja no se pudo medir, reportados UNA vez: el sync corre a 60 fps
   *  y sin dedupe el registro sería una línea por frame. */
  private sinMedida = new Set<string>();

  constructor(host: HTMLElement) {
    this.el = host;
  }

  /** Coloca EXACTAMENTE estas etiquetas; las que ya no vengan se retiran del
   *  DOM (una etiqueta huérfana pegada a la pantalla es peor que ninguna). */
  sync(labels: readonly WorldLabel[], project: ScreenProjector): void {
    const anteriores = new Set(this.tapados);
    this.placed = [];
    this.tapados = [];
    const vivos = new Set<string>();
    const ancho = this.el.clientWidth, alto = this.el.clientHeight;
    // 1 · Proyectar y MEDIR, antes de escribir una sola posición: la medida es
    //     una lectura de layout, y entreverarla con las escrituras del frame es
    //     lo que convierte un reflow en uno por rótulo.
    const puestos: { label: WorldLabel; p: { x: number; y: number; depthM: number }; rotulo: Rotulo }[] = [];
    for (const l of labels) {
      const p = project(l.pos.x, l.pos.y, l.pos.z);
      if (!p || p.x < 0 || p.x > ancho || p.y < 0 || p.y > alto) continue;
      vivos.add(l.id);
      let rotulo = this.nodes.get(l.id);
      if (!rotulo) {
        const node = document.createElement("div");
        node.className = "world-label";
        node.dataset.labelId = l.id;
        rotulo = { el: node, medidoCon: "", w: 0, h: 0 };
        this.nodes.set(l.id, rotulo);
      }
      if (rotulo.el.textContent !== l.text) rotulo.el.textContent = l.text;
      rotulo.el.dataset.focus = l.focus ? "true" : "false";
      rotulo.el.dataset.peligro = l.peligro ? "true" : "false";
      if (rotulo.medidoCon !== l.text || rotulo.w === 0) {
        // Medir exige estar en el documento: un nodo suelto mide 0×0.
        if (!rotulo.el.isConnected) this.el.appendChild(rotulo.el);
        rotulo.w = rotulo.el.offsetWidth;
        rotulo.h = rotulo.el.offsetHeight;
        rotulo.medidoCon = l.text;
      }
      puestos.push({ label: l, p, rotulo });
    }

    // 2 · Preguntar a core cuál sobra. Solo entran las cajas MEDIDAS: «no cabe»
    //     y «no pude medir» son dos cosas distintas y core rechaza la segunda
    //     en voz alta. Un rótulo sin medida se emite —no se puede juzgar— y se
    //     reporta: callarlo dejaría dos nombres pisados sin que nadie lo sepa.
    const cajas: CajaDeRotulo[] = [];
    for (const { label, p, rotulo } of puestos) {
      if (rotulo.w > 0 && rotulo.h > 0) {
        cajas.push({ id: label.id, x: p.x, y: p.y, w: rotulo.w, h: rotulo.h, depthM: p.depthM, focus: label.focus });
      } else if (!this.sinMedida.has(label.id)) {
        this.sinMedida.add(label.id);
        errors.push(
          "render",
          `rótulo "${label.id}": su caja mide ${rotulo.w}×${rotulo.h} px, así que no se puede saber si pisa a otro; se pinta igual`,
        );
      }
    }
    const tapados = rotulosTapados(cajas, anteriores);

    // 3 · Colocar lo que queda. Lo tapado se DESCUELGA del documento (sigue en
    //     el mapa con su medida, así que volver a enseñarlo no cuesta remedir).
    //     No se oculta con `hidden`: los guiones —y quien mira la pantalla— leen
    //     «hay nodo» como «se ve», y un nodo invisible los dejaría verdes
    //     mintiendo.
    for (const { label, p, rotulo } of puestos) {
      if (tapados.has(label.id)) {
        this.tapados.push(label.id);
        if (rotulo.el.isConnected) rotulo.el.remove();
        continue;
      }
      if (!rotulo.el.isConnected) this.el.appendChild(rotulo.el);
      // translate(-50%, -100%): el punto de anclaje es el pie de la etiqueta,
      // así queda centrada JUSTO encima de la cabeza y no la tapa. Es la misma
      // convención con la que core arma el rectángulo.
      rotulo.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      const t = (p.depthM - FADE_FROM_M) / (FADE_TO_M - FADE_FROM_M);
      rotulo.el.style.opacity = String(Math.max(MIN_OPACITY, Math.min(1, 1 - t)));
      // Lo cercano por delante: sin esto dos NPCs alineados intercambian
      // etiquetas según el orden de la lista, que no es el de profundidad.
      rotulo.el.style.zIndex = String(Math.max(0, 1000 - Math.round(p.depthM * 10)));
      this.placed.push({
        id: label.id, text: label.text, x: p.x, y: p.y,
        focus: Boolean(label.focus), peligro: Boolean(label.peligro), w: rotulo.w, h: rotulo.h,
      });
    }
    for (const [id, rotulo] of this.nodes) {
      if (vivos.has(id)) continue;
      rotulo.el.remove();
      this.nodes.delete(id);
      this.sinMedida.delete(id);
    }
    this.publicarTapados();
  }

  /** Quita todas (cambio de vista, reset de mundo, diálogo a pantalla). */
  clear(): void {
    for (const rotulo of this.nodes.values()) rotulo.el.remove();
    this.nodes.clear();
    this.sinMedida.clear();
    this.placed = [];
    this.tapados = [];
    this.publicarTapados();
  }

  /** Los tapados, en el contenedor. Es lo que distingue desde fuera «no cabe»
   *  de «no está» sin leer un píxel, y va donde ya vive todo lo demás que se
   *  afirma de los rótulos: en el DOM, al lado de `data-label-id` y
   *  `data-focus`. */
  private publicarTapados(): void {
    this.el.dataset.tapados = this.tapados.join(" ");
  }

  /** Estado para el hook __nefan / guiones de QA. */
  debugState(): {
    colocados: { id: string; text: string; x: number; y: number; focus: boolean; peligro: boolean; w: number; h: number }[];
    tapados: string[];
  } {
    return {
      colocados: this.placed.map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) })),
      tapados: [...this.tapados],
    };
  }
}
