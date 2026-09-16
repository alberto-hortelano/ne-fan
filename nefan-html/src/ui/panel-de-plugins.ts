/** Inspección genérica de los valores del servidor; no interpreta reglas del plugin. */
import type { PluginVisible } from "@nefan-core/src/plugins/types.js";
import { alPulsarTecla } from "../input/puerta-de-teclado.js";
import { paso } from "./async-ui.js";

export function crearPanelDePlugins(lienzo: () => HTMLElement) {
  const boton = document.createElement("button");
  boton.id = "plugins-open";
  boton.className = "nf-action";
  boton.textContent = "P · Sistemas";
  boton.hidden = true;
  boton.setAttribute("aria-controls", "plugins-panel");
  boton.setAttribute("aria-expanded", "false");
  document.getElementById("ui-top-left")!.append(boton);
  const panel = document.createElement("section");
  panel.id = "plugins-panel";
  panel.className = "nf-panel";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "plugins-heading");
  panel.innerHTML = '<header><h2 id="plugins-heading">Sistemas del mundo</h2><button class="nf-action" type="button">Esc · Cerrar</button></header><p>Estado actual de los sistemas de esta partida.</p><div class="plugins-content"></div>';
  document.getElementById("game-ui")!.append(panel);
  const contenido = panel.querySelector<HTMLDivElement>(".plugins-content")!;
  const cerrar = panel.querySelector<HTMLButtonElement>("button")!;
  let devolverRaton = false;
  function ocultar(devolver: boolean) {
    panel.hidden = true;
    boton.setAttribute("aria-expanded", "false");
    if (devolver) {
      boton.focus();
      if (devolverRaton) paso(lienzo().requestPointerLock(), "input", "Haz click en el mundo para recuperar el ratón.");
    }
    devolverRaton = false;
  }
  function alternar() {
    if (boton.hidden) return;
    if (!panel.hidden) { ocultar(true); return; }
    devolverRaton = document.pointerLockElement !== null;
    if (devolverRaton) document.exitPointerLock();
    panel.hidden = false;
    boton.setAttribute("aria-expanded", "true");
    cerrar.focus();
  }
  boton.addEventListener("click", alternar);
  cerrar.addEventListener("click", () => ocultar(true));
  alPulsarTecla(e => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof HTMLElement && e.target.matches("input, textarea, [contenteditable]")) return;
    if (e.key.toLowerCase() === "p") { e.preventDefault(); alternar(); }
    if (e.key === "Escape" && !panel.hidden) { e.preventDefault(); ocultar(true); }
  });
  function actualizar(plugin: PluginVisible) {
    const anterior = [...contenido.children].find(e => (e as HTMLElement).dataset.pluginName === plugin.name);
    const ficha = document.createElement("article");
    ficha.dataset.pluginName = plugin.name;
    ficha.dataset.pluginId = plugin.id;
    const nombre = document.createElement("h3");
    nombre.textContent = plugin.name;
    ficha.append(nombre, pintarValor(plugin.slice));
    if (anterior) anterior.replaceWith(ficha);
    else contenido.append(ficha);
    boton.hidden = false;
  }
  return {
    abierto: () => !panel.hidden,
    actualizar,
    aplicar(plugins: readonly PluginVisible[]) {
      ocultar(false);
      contenido.replaceChildren();
      boton.hidden = true;
      for (const plugin of plugins) actualizar(plugin);
    },
  };
}

/** Estructura DOM, sin HTML del motor ni JSON crudo: nombres, listas y valores. */
function pintarValor(valor: unknown): HTMLElement {
  if (valor !== null && typeof valor === "object") {
    const lista = document.createElement("dl");
    const entradas = Object.entries(valor);
    if (entradas.length === 0) lista.textContent = "Sin elementos";
    for (const [clave, dato] of entradas) {
      const etiqueta = document.createElement("dt");
      etiqueta.textContent = Array.isArray(valor) ? `Elemento ${Number(clave) + 1}` : clave.replaceAll("_", " ");
      const contenido = document.createElement("dd");
      contenido.append(pintarValor(dato));
      lista.append(etiqueta, contenido);
    }
    return lista;
  }
  const texto = document.createElement("span");
  texto.textContent = valor === null ? "Sin valor" : typeof valor === "boolean" ? (valor ? "Sí" : "No") : String(valor);
  return texto;
}
