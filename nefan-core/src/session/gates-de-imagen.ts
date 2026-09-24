/** LOS GATES DE IMAGEN: cuándo se GASTA en imagen IA nueva, por faceta.
 *
 *  Dos facetas —escenarios (el atlas de superficies de la fps) y personajes
 *  (los skins)— y una regla que las une: un modo de personajes vacío SIGUE al
 *  de escenarios. Esa regla decidía gasto real desde cuatro sitios que la
 *  compartían por lectura (#508): el chip del cliente, el badge del save en el
 *  título, la creación de la partida en el bridge y el cambio de modo de core.
 *  Aquí vive una vez, y los cuatro la llaman. Y encima de los modos, el
 *  TECHO del entorno (`Entorno`, 2026-09-24): en desarrollo ningún camino
 *  automático paga arte nuevo, solo restaura lo pagado.
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

/** Los dos modos ELEGIBLES: los que una partida puede tener de verdad. `Modo`
 *  incluye el `""` de «sin elegir», que no es una elección sino su ausencia, y
 *  quien tiene que DECIDIR —el selector del título, el fallback del wire— no
 *  puede contestar con él. El tipo se lo impide. */
export type ModoElegido = Exclude<Modo, "">;

/** CON QUÉ MODO ARRANCA UNA PARTIDA NUEVA: maqueta 3D, o sea sin gastar.
 *
 *  Decisión del usuario (2026-09-14, triaje del backlog): *«Nace en Maqueta 3D,
 *  y encender Imagen IA es explícito, como en el home.»* Hasta ese día las dos
 *  puertas de la MISMA decisión no se trataban igual: en el home, encender
 *  Imagen IA sobre un save exige dos clicks y dice «Gastará créditos»; en el
 *  selector, una partida nueva nacía en `image` **por omisión** — nadie había
 *  elegido gastar y ya se gastaba.
 *
 *  VIVE AQUÍ Y NO EN EL CLIENTE porque el defecto se leía desde TRES sitios: el
 *  literal de escenarios del selector, el de PERSONAJES del mismo selector —que
 *  solo sigue a escenarios en un *click*, así que dejarlo atrás paría partidas
 *  en maqueta pagando skins— y el fallback del wire
 *  (`bridge/handlers/session.ts`), que es el que decide de verdad: un
 *  `new_game` sin modo nace con esto, diga lo que diga el cliente. Tres copias
 *  de una decisión de GASTO es la avería que persigue
 *  `la-logica-de-juego-no-vuelve-al-cliente`.
 *
 *  Es un modo ELEGIDO y no `""`: «sin elegir» no es un defecto, y por el wire
 *  aborta — el bridge rechaza lo que no sabe leer, que es lo correcto.
 *
 *  Lo que NO cambia: el save. Una partida guardada lleva SU modo congelado y
 *  esto no la toca; solo decide con qué nace la que no lo trae. */
export const MODO_AL_EMPEZAR: ModoElegido = "vector";

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

/** EL ENTORNO DE LA CORRIDA: si los caminos AUTOMÁTICOS pueden pagar arte
 *  nuevo, o solo reusar lo ya pagado.
 *
 *  Decisión del usuario (2026-09-24): *«Los assets ya pagados o no es algo que
 *  tenemos que sacar del código, debe ser configuración y no volver a generar
 *  por defecto mientras estemos en desarrollo, no queremos que recargas
 *  automáticas y pruebas gasten créditos, pero cuando estemos en prod sí.»*
 *  Hasta ese día la regla vivía en dos literales de código: el modo con el que
 *  nace una partida y un `activo &&` que dejaba a los vecinos sin pintar nunca
 *  (#714). Ahora es un DATO que entra aquí, y el código solo lo aplica.
 *
 *  Es un TECHO de «Imagen IA», no su sustituto: el modo de la partida lo sigue
 *  eligiendo el jugador (título, chip, save), y el entorno solo puede bajar un
 *  `generar` a `restaurar`. Nunca sube nada: un save en maqueta sigue en
 *  maqueta en producción.
 *
 *  Lo que NO toca: las vías DELIBERADAS (tecla G y menú dev, aplicar un estilo
 *  con su cotización, subir un estilo y confirmar su `/complete`). No pasan por
 *  estos gates; quien las pulsa ya ha elegido pagar.
 *
 *  UNA fuente: la variable `NEFAN_ENTORNO`, que lee SOLO el bridge al arrancar
 *  (`leerEntorno`) y le dice al cliente con `bridge_hello`. Candado
 *  `el-entorno-se-lee-en-un-solo-sitio` en `arch-rules.json`. */
export type Entorno = "desarrollo" | "produccion";

/** Sin tocar nada, desarrollo: lo que sale por defecto es lo que NO gasta. */
export const ENTORNO_POR_DEFECTO: Entorno = "desarrollo";

/** La variable del entorno, a un `Entorno`. Ausente o vacía ⇒ el defecto;
 *  cualquier otra cosa que no sea uno de los dos nombres es un ERROR, no un
 *  «desarrollo» callado: quien escribe `prod` quería producción y se
 *  encontraría sin generar sin saber por qué. `Result` y no un `Entorno` a
 *  secas porque «no me lo dijeron» y «me dijeron algo que no entiendo» no
 *  pueden colapsarse. */
export function leerEntorno(
  raw: string | undefined,
): { ok: true; entorno: Entorno } | { ok: false; error: string } {
  if (raw === undefined || raw === "") return { ok: true, entorno: ENTORNO_POR_DEFECTO };
  if (raw === "desarrollo" || raw === "produccion") return { ok: true, entorno: raw };
  return {
    ok: false,
    error: `NEFAN_ENTORNO=${JSON.stringify(raw)} no es un entorno: vale "desarrollo" o "produccion" (sin poner = "desarrollo")`,
  };
}

/** ¿Deja este entorno que un camino automático PAGUE arte nuevo? Es la mitad
 *  del techo, escrita una vez: la usan los gates de abajo y los rótulos del
 *  cliente que tienen que decir por qué no se genera. */
export function entornoPermiteGenerar(e: Entorno): boolean {
  return e === "produccion";
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
  /** El entorno de la corrida (techo de gasto automático). */
  entorno: Entorno;
}

/** Qué hace un camino automático con el arte de ESCENARIOS: pedir que se
 *  pinte lo que falte, o solo restaurar lo ya pagado (`resolve_only`). El
 *  arte pagado se restaura SIEMPRE, también en maqueta. */
export type PermisoDeEscenarios = "generar" | "restaurar";

/** Y con el de PERSONAJES, que tiene una tercera: `base`, ni pedir ni
 *  restaurar — la base y_bot, como hoy en maqueta (restaurar los skins ya
 *  pagados en maqueta es otra decisión, sin tomar). */
export type PermisoDePersonajes = "generar" | "restaurar" | "base";

export interface GatesDeImagen {
  escenarios: PermisoDeEscenarios;
  personajes: PermisoDePersonajes;
}

/** Los dos gates de gasto. Con la faceta elegida manda la faceta (`image`
 *  quiere generar, `vector` no), y el entorno pone el TECHO: en desarrollo,
 *  todo `generar` baja a `restaurar`.
 *
 *  Sin elegir —fixtures, sin partida— los dos se separan, y a propósito: los
 *  ESCENARIOS no se generan (no hay partida a la que pedirle el tile, así que
 *  el gate del cliente ya era `session.active && …` y el toggle no decidía
 *  nada: #519); los PERSONAJES caen a su toggle local, que nace OFF para que
 *  una fixture con NPCs descritos no gaste créditos sin que nadie lo pida. */
export function gatesDeImagen(f: EntradaDeGates): GatesDeImagen {
  const techo = entornoPermiteGenerar(f.entorno);
  const efectivo = modoEfectivoDePersonajes(f);
  const quierePersonajes = efectivo ? efectivo === "image" : f.toggleLocalPersonajes;
  return { escenarios: permisoDeEscenarios(f.renderMode, techo), personajes: permisoDePersonajes(quierePersonajes, techo) };
}

/** Las dos reglas por faceta, cada una con SOLO lo que la decide: el modo (o
 *  el querer) y el techo del entorno. Son las que usan `gatesDeImagen` y
 *  `loQuePagaImagenIA`, así que el rótulo y el POST no pueden discrepar. */
function permisoDeEscenarios(renderMode: Modo, techo: boolean): PermisoDeEscenarios {
  return renderMode === "image" && techo ? "generar" : "restaurar";
}

function permisoDePersonajes(quiere: boolean, techo: boolean): PermisoDePersonajes {
  return !quiere ? "base" : techo ? "generar" : "restaurar";
}

/** Qué PAGARÍA encender Imagen IA en cada faceta, en este entorno. Es la
 *  pregunta de los rótulos de ANTES de elegir —el selector del título, el
 *  subtexto del panel del chip, el badge de un save— y se contesta con las
 *  MISMAS reglas por faceta que deciden el POST (`permisoDeEscenarios`,
 *  `permisoDePersonajes`), no volviendo a mirar el entorno: si un día el
 *  techo cambia, el rótulo cambia con él (hallazgo H2 de la QA de la tanda
 *  AS). */
export function loQuePagaImagenIA(entorno: Entorno): { escenarios: boolean; personajes: boolean } {
  // Las reglas por faceta, y no `gatesDeImagen` con una entrada de mentira:
  // esa llamada tenía que inventar un modo de personajes y un toggle local que
  // con las dos facetas en `image` no deciden NADA (el toggle solo cuenta sin
  // modo elegido), y la mutación lo enseñaba con dos supervivientes que ningún
  // test podía matar porque no había conducta distinta que ver.
  const techo = entornoPermiteGenerar(entorno);
  return {
    escenarios: permisoDeEscenarios("image", techo) === "generar",
    personajes: permisoDePersonajes(true, techo) === "generar",
  };
}

/** ¿Una anim de skin se pide SOLO POR LO PAGADO (`resolve_only`)? La
 *  excepción deliberada al permiso de personajes, y su límite (#756).
 *
 *  Con `generar` nunca: lo automático ya paga. Con `restaurar` (desarrollo)
 *  sí, salvo UN caso: el personaje ELEGIDO A MANO (el `force` del menú dev)
 *  paga su set AUTOMÁTICO, que es lo que enseña el botón que se pulsó. Sus
 *  anims lazy —un ataque, la muerte— las dispara un fotograma, no un clic,
 *  así que son automáticas y vuelven a restaurar lo pagado, como las de
 *  cualquier otro. Antes el forzado las pagaba también, mientras durase la
 *  pestaña y sin avisar. Con `base` no llega ninguna petición (el gestor sale
 *  antes), y se contesta lo que no gasta. */
export function skinPideSoloLoPagado(
  permiso: PermisoDePersonajes,
  anim: { elegidaAMano: boolean; delSetAutomatico: boolean },
): boolean {
  if (permiso === "generar") return false;
  return !(anim.elegidaAMano && anim.delSetAutomatico);
}
