/** Registro de proveedores de input del cliente 2D — la familia "input".
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
    scripted: () => new ScriptedInputProvider(),
  },
);
