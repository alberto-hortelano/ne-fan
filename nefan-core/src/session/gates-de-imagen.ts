/** LOS GATES DE IMAGEN: cuándo se GASTA en imagen IA nueva, por faceta.
 *
 *  Dos facetas —escenarios (el atlas de superficies de la fps) y personajes
 *  (los skins)— y una regla que las une: un modo de personajes vacío SIGUE al
 *  de escenarios. Esa regla decidía gasto real desde cuatro sitios que la
 *  compartían por lectura (#508): el chip del cliente, el badge del save en el
 *  título, la creación de la partida en el bridge y el cambio de modo de core.
 *  Aquí vive una vez, y los cuatro la llaman.
 *
 *  Módulo PURO: no lee `localStorage`, ni la config, ni el DOM. El cliente
 *  lee sus toggles y los pasa como booleanos; el bridge y core pasan lo que
 *  traen el wire y el save. Así los predicados se miden en test y en
 *  mutación, que es lo que un gate de gasto no tenía.
 *
 *  Lo que NO decide aquí, a propósito: `CONFIG.graphics.ai_skin`. Es el
 *  interruptor del BACKEND de skins, no el modo de la partida, y meterlo
 *  dentro del gate dejaba inalcanzable el fail-loud del cliente que aborta el
 *  arranque cuando un save pide skins con el backend apagado
 *  (`renderer/aspecto-del-jugador.ts`) — la conducta de la base, que esta PR
 *  conserva (hallazgo H1 de QA). El cliente lo sigue aplicando donde estaba:
 *  el rótulo del registro y el chip. */

/** Modo de render de una faceta. `""` = sin elegir: sin sesión (fixtures) o
 *  save previo al campo. En personajes, `""` sigue a escenarios. */
export type Modo = "image" | "vector" | "";

/** ¿Es esto un modo, tal cual? Los tres valores que el juego sabe leer —los
 *  dos elegibles y el «sin elegir»— y ninguno más.
 *
 *  Existe aparte de `normalizarModo` porque las dos preguntas son distintas y
 *  se confundían al colapsarse: normalizar CONTESTA con un modo siempre, y por
 *  eso no sirve para las puertas que tienen que RECHAZAR (la del save en
 *  `loadSession`, #522). Quien normaliza acepta lo que venga; quien pregunta
 *  esto se entera de que no venía nada bueno. */
export function esModo(v: unknown): v is Modo {
  return v === "image" || v === "vector" || v === "";
}

/** Lo que llega del wire o del save, a un `Modo`: cualquier otra cosa es
 *  «sin elegir». Quien necesite fail-loud ante un valor desconocido —el bridge
 *  al crear la partida, la puerta del save— lo comprueba ANTES de normalizar,
 *  con `esModo`. */
export function normalizarModo(v: unknown): Modo {
  return esModo(v) ? v : "";
}

export interface FacetasDeModo {
  /** Modo de escenarios (`world.render_mode`). */
  renderMode: Modo;
  /** Modo de personajes (`world.character_mode`); `""` sigue a escenarios. */
  characterMode: Modo;
}

/** El modo EFECTIVO de personajes: el propio si lo tiene, si no el de
 *  escenarios. Es la regla «`""` sigue a escenarios», y este es su único
 *  sitio. */
export function modoEfectivoDePersonajes(f: FacetasDeModo): Modo {
  return f.characterMode || f.renderMode;
}

export interface EntradaDeGates extends FacetasDeModo {
  /** Toggle local de personajes SIN sesión (fixtures). Lo lee el cliente de
   *  `localStorage`; aquí solo entra su valor.
   *
   *  De escenarios NO hay toggle, y no es un olvido: sin sesión no hay a quién
   *  pedirle un tile, así que el atlas no se genera pase lo que pase
   *  (`generationOn: () => session.active && …` en el cliente). El que había
   *  no tenía consumidor alcanzable y se retiró entero, con candado de
   *  reaparición en `arch-rules.json` (#519). Los skins sí: una fixture con
   *  NPCs descritos los pediría nada más cargar, y por eso su toggle nace
   *  OFF. */
  toggleLocalPersonajes: boolean;
}

export interface GatesDeImagen {
  /** ¿Se genera imagen NUEVA de escenario? */
  escenarios: boolean;
  /** ¿Se generan skins IA? */
  personajes: boolean;
}

/** Los dos gates de gasto. Con la faceta elegida manda la faceta (`image`
 *  gasta, `vector` no).
 *
 *  Sin elegir —fixtures, sin partida— los dos se separan, y a propósito: los
 *  ESCENARIOS no se generan (no hay partida a la que pedirle el tile, así que
 *  el gate del cliente ya era `session.active && …` y el toggle no decidía
 *  nada: #519); los PERSONAJES caen a su toggle local, que nace OFF para que
 *  una fixture con NPCs descritos no gaste créditos sin que nadie lo pida. */
export function gatesDeImagen(f: EntradaDeGates): GatesDeImagen {
  const escenarios = f.renderMode === "image";
  const efectivo = modoEfectivoDePersonajes(f);
  const personajes = efectivo ? efectivo === "image" : f.toggleLocalPersonajes;
  return { escenarios, personajes };
}
