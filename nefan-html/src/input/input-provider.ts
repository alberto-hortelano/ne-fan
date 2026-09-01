/** Contrato del proveedor de input del cliente (sistema intercambiable).
 *
 *  Implementaciones registradas en ./registry.ts (default: teclado+ratón;
 *  "scripted" para bench/E2E). Solo cubre GAMEPLAY: las teclas de desarrollo
 *  (G/B) viven en DevToolsInput, fijo e independiente del esquema de control
 *  — un gamepad no las necesita. */

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Flechas de dirección: orientan al personaje (no lo mueven). */
  turnUp: boolean;
  turnDown: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  sprint: boolean;
  attackRequested: boolean;
  selectedAttack: string;
  interact: boolean;
}

/** Movimiento de ratón acumulado bajo pointer lock, en píxeles. `dy` es el
 *  del navegador: positivo = ratón hacia ABAJO. */
export interface LookDelta {
  dx: number;
  dy: number;
}

/** Catálogo por defecto (sistema de combate estándar) hasta que la sesión
 *  instale el suyo vía setAttackBindings. */
export const DEFAULT_ATTACK_IDS = ["quick", "heavy", "medium", "defensive", "precise"];

export function createInputState(): InputState {
  return {
    up: false, down: false, left: false, right: false,
    turnUp: false, turnDown: false, turnLeft: false, turnRight: false,
    sprint: false, attackRequested: false,
    selectedAttack: DEFAULT_ATTACK_IDS[0],
    interact: false,
  };
}

/** Intención de juego NO ligada a un dispositivo: la empujan los botones de
 *  la UI clicable y el driver de bench. Escribe en el MISMO estado que las
 *  teclas, así que el game loop la consume por el mismo `consumeX` y no hay
 *  dos caminos que mantener. */
export interface IntentSink {
  queueAttack(): void;
  queueInteract(): void;
  queueRespawn(): void;
  queueTileConfirm(): void;
  queueTileDecline(): void;
}

export interface InputProvider extends IntentSink {
  /** Estado continuo, leído por el game loop cada frame. */
  readonly state: InputState;
  /** Reconstruye el mapeo de selección (1..N en teclado) desde el catálogo
   *  del sistema de combate de la sesión y resetea la selección al primero. */
  setAttackBindings(attackIds: readonly string[]): void;
  /** Selección de ataque (teclas, clicks del HUD…) — un único dueño del
   *  estado; la UI se refresca vía onAttackTypeChanged. */
  selectAttack(typeId: string): void;
  onAttackTypeChanged?: (typeId: string) => void;
  /** Delta de ratón acumulado en píxeles bajo pointer lock — se resetea al
   *  leer. Es la MIRADA: `dx` en yaw y `dy` en pitch (arriba y abajo). */
  consumeLookDelta(): LookDelta;
  consumeAttack(): boolean;
  consumeInteract(): boolean;
  /** Aceptar/rechazar la propuesta de generar el tile vecino. */
  consumeTileConfirm(): boolean;
  consumeTileDecline(): boolean;
  /** Intención de respawn — el game loop decide si aplica (player muerto). */
  consumeRespawn(): boolean;
  /** Quita listeners (swap de provider en dev). */
  dispose(): void;
}

/** Lo que el proveedor le PREGUNTA a su dueño. Sus listeners siguen viviendo
 *  en `window` (teclas, ratón bajo pointer lock); lo que recibe aquí no es un
 *  lienzo —el de la rueda del zoom se fue con la vista oblicua— sino la única
 *  pregunta que no puede contestar solo.
 *
 *  «HAY UN DIÁLOGO ABIERTO» SE PREGUNTA, NO SE COPIA (#314). Hasta hoy era un
 *  campo público mutable del proveedor —una TERCERA representación del mismo
 *  estado junto a `dialoguePanel.isVisible` y al `[hidden]` del DOM—: el bucle
 *  lo escribía a mano al abrir y al cerrar, y cualquier módulo del cliente
 *  podía escribirlo también. #311 le puso un dueño único
 *  (`abrirDialogo`/`cerrarDialogo`) y dejó dicho que colapsar las
 *  representaciones era este issue. Quedan las DOS que #314 no funde a
 *  propósito: el panel y su reflejo en el DOM.
 *
 *  Es un MÉTODO y no un booleano a propósito, y ahí está el candado: un campo
 *  se asigna, y una función que se evalúa cada vez no se puede desincronizar
 *  del panel porque no guarda nada. Quien prohíbe el cuarto espejo es el TIPO:
 *  el campo ya no existe en `InputProvider`, así que ningún módulo de fuera
 *  puede escribirlo. El checker `el-gate-del-dialogo-no-vuelve-a-ser-un-campo`
 *  (arch-rules.json) cubre lo que el tipo no puede: que nadie lo re-declare. */
export interface InputDeps {
  /** ¿Hay una conversación en pantalla ahora mismo? La contesta el dueño del
   *  panel (`main.ts`), que es quien lo abre y lo cierra. */
  dialogoAbierto(): boolean;
  /** ¿Hay una propuesta de explorar el tile vecino en pantalla? De ella
   *  dependen Y/N: sin propuesta, `N` es de las teclas dev y `Y` no es nada.
   *
   *  EL ESPEJO QUE #314 DEJÓ EN PIE (#329). Hasta hoy esto era
   *  `tileProposalActive`, campo público mutable del proveedor que el bucle
   *  escribía desde fuera en TRES sitios —uno por cada rama en la que la
   *  propuesta puede no existir— con la copia muda de siempre en el proveedor
   *  scripted (cero lecturas). Tres escrituras que hay que acertar a la vez
   *  para que el gate diga la verdad, y ninguna herramienta que se entere si
   *  falta una.
   *
   *  Ahora se DERIVA de su dueño, que ya existía y ya era consultable: la
   *  `propuesta` del `FrontierManager`, más las mismas guardas que decidían si
   *  el bucle llegaba a mirarla (no hay conversación abierta, hay partida, y el
   *  mundo tiene tiles de grid). Es la misma expresión que escribía el bucle,
   *  escrita UNA vez y en el sitio donde se pregunta. */
  propuestaDeTileAbierta(): boolean;
}
