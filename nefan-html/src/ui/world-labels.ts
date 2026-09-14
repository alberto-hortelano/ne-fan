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
 */

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
 *  Distancia a partir de la cual la etiqueta se atenúa (lejos estorba menos). */
const FADE_FROM_M = 8;
const FADE_TO_M = 20;
const MIN_OPACITY = 0.35;

export class WorldLabels {
  private el: HTMLElement;
  private nodes = new Map<string, HTMLElement>();
  /** Lo colocado en el último sync — es lo que assertan los guiones de QA. */
  private placed: { id: string; text: string; x: number; y: number; focus: boolean; peligro: boolean }[] = [];

  constructor(host: HTMLElement) {
    this.el = host;
  }

  /** Coloca EXACTAMENTE estas etiquetas; las que ya no vengan se retiran del
   *  DOM (una etiqueta huérfana pegada a la pantalla es peor que ninguna). */
  sync(labels: readonly WorldLabel[], project: ScreenProjector): void {
    this.placed = [];
    const vivos = new Set<string>();
    for (const l of labels) {
      const p = project(l.pos.x, l.pos.y, l.pos.z);
      if (!p) continue;
      vivos.add(l.id);
      let node = this.nodes.get(l.id);
      if (!node) {
        node = document.createElement("div");
        node.className = "world-label";
        node.dataset.labelId = l.id;
        this.nodes.set(l.id, node);
        this.el.appendChild(node);
      }
      if (node.textContent !== l.text) node.textContent = l.text;
      node.dataset.focus = l.focus ? "true" : "false";
      node.dataset.peligro = l.peligro ? "true" : "false";
      // translate(-50%, -100%): el punto de anclaje es el pie de la etiqueta,
      // así queda centrada JUSTO encima de la cabeza y no la tapa.
      node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      const t = (p.depthM - FADE_FROM_M) / (FADE_TO_M - FADE_FROM_M);
      node.style.opacity = String(Math.max(MIN_OPACITY, Math.min(1, 1 - t)));
      // Lo cercano por delante: sin esto dos NPCs alineados intercambian
      // etiquetas según el orden de la lista, que no es el de profundidad.
      node.style.zIndex = String(Math.max(0, 1000 - Math.round(p.depthM * 10)));
      this.placed.push({
        id: l.id, text: l.text, x: p.x, y: p.y,
        focus: Boolean(l.focus), peligro: Boolean(l.peligro),
      });
    }
    for (const [id, node] of this.nodes) {
      if (vivos.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
    }
  }

  /** Quita todas (cambio de vista, reset de mundo, diálogo a pantalla). */
  clear(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
    this.placed = [];
  }

  /** Estado para el hook __nefan / guiones de QA. */
  debugState(): { id: string; text: string; x: number; y: number; focus: boolean; peligro: boolean }[] {
    return this.placed.map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) }));
  }
}
