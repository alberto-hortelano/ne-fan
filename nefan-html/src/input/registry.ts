/** Registro de proveedores de input del cliente — la familia "input".
 *
 *  A diferencia del combate (propiedad del mundo, game.json.systems), los
 *  controles son capacidad del CLIENTE: se eligen por query param
 *  (?input=scripted), default teclado+ratón. Id desconocido → error visible
 *  (fail-loud), no degrada en silencio. */

import { createSystemRegistry } from "@nefan-core/src/systems/registry.js";
import type { InputDeps, InputProvider } from "./input-provider.js";
import { KeyboardInputProvider } from "./keyboard-input-provider.js";
import { ScriptedInputProvider } from "./scripted-input-provider.js";

export const inputRegistry = createSystemRegistry<InputProvider, InputDeps>(
  "input",
  "keyboard",
  {
    keyboard: (deps) => new KeyboardInputProvider(deps),
    // El driver de bench NO pregunta por el diálogo: conduce el juego por su
    // API programática sin pasar por la puerta del teclado, y es justo esa
    // diferencia la que hace falta medir (`puedeAtacar()` del hook, #323).
    scripted: () => new ScriptedInputProvider(),
  },
);
