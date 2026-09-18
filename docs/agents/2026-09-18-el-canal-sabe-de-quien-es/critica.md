# Crítica — Tanda O · #659 REENCUADRADA · #673 REENCUADRADA (y NO depende de #659)

Los dos son reales; ninguno está bien encuadrado, y la unión de la tanda es falsa: **#673 se descarta de
#659 HOY, leyendo tres líneas, sin implementar nada.** El problema real, una frase cada uno. **#659**:
una página puede aplicar el estado vivo de una partida que no es la suya, y el canal por el que eso pasa **no es solo el wire** — la
mitad que el jugador ve va por la memoria del cliente. **#673**: no se sabe si el guion 15 tiene intermitencia propia en `#ts-new`, y
la medida tomada **no lo contesta**.

## La premisa, afirmación por afirmación

| Afirmación del issue / `requisitos.md` | Verificación |
|---|---|
| `StateUpdateMessage` sin `sessionId`, `messages.ts:296-341` | **CIERTA, coordenada movida**: hoy `messages.ts:320-364` |
| `game-client.ts` no menciona `sessionId` ni una vez | **CIERTA**: `grep -c sessionId` = **0** |
| «dos de los TRES canales saben de quién son» | **FALSA, a favor del issue**: sellados son **cuatro** (`ConSelloDeSesion`, `context.ts:324`: NarrativeEvent, NarrativeStatus, RenderModeChanged, ExitsChanged) y el cliente filtra los cuatro (`narrative-client.ts:99`, `:133`; `main.ts:788`, `:791`). Es **4 de 5** |
| «sale por `ctx.send(ws,…)` en `simulation.ts:131`, no en difusión» | **CIERTA en naturaleza, falsa en número**: **cuatro** emisores unicast, `simulation.ts:132, 256, 272, 333`. Censo entero —que es donde la casa ya pagó por olvidar los lectores—: 4 emisores · **1** lector (`game-client.ts:116`, único `bridge.on("state_update")` del repo) · 1 re-emisor (`replay-server.mjs`, que ya resella sin lista de tipos: no se rompe) |
| Es la firma del guion 80 | **CIERTA, con mecanismo cerrado**: `run.mjs:1414` da página nueva por guion sobre bridge compartido; al cerrarse el socket del 79, `release()` deja `owner=null` y `canDrive()` pasa a true **para cualquiera** (`world-claim.ts`); el sim conserva el `player` y el `npcBehaviorSystem` del 79; el 80 cierra el título, manda `input`, y `handleInput` contesta con `getNpcStates()` del 79 → `lo-que-manda-el-bridge.ts:53`. La ventana la cierra el primer `load_room` (#484) |
| NO es la firma del 75 (#634) | **CIERTA**: el rojo del 75 es `escena servida DISTINTA (npcs: barkeep: position)` — huella del tile, no `state_update` |
| El guion 80 está rojo | **FALSA hoy**: 145 ✔ / 0 ✘ / 1 ⊘ sobre `900b5b71`. #659 no pasa un rojo a verde: retira riesgo latente y desbloquea deuda |
| #673: la exención entra «**con este número escrito**» | **FALSA**: `grep -rn "#673"` sobre el repo = **0**; `grep -c 673` sobre el contrato = **0**. El `porque` dice «Tiene issue propio» sin citarlo. Ruta además mala: es `nefan-core/data/contract/…` |

### #673: ni la dependencia ni la medida se sostienen

El rojo cae en `page.click("#ts-new")` (`qa/lib/sesion.mjs:291`), desde `nuevaPartida` en la línea **305** del guion 15; `comenzar()`
—que crea la sesión— es la **306**. Ahí: (1) no hay sesión, el título está delante, y con él visible el cliente **no manda `input`**
(`main.ts:662-664`); los cuatro emisores solo contestan a un mensaje de ese socket → **ningún `state_update` puede llegar** (`grep
state_update` sobre el 15, `qa/lib/sesion.mjs` y `qa/lib/saves.mjs` = 0). (2) La página es **nueva** (`run.mjs:1414`) → `lastState`
vacío. **Las dos vías de #659 están cerradas.** Y la medida: 4 de 21 contra 0 de 11 da **Fisher p = 0,17 (una cola), 0,27 (dos
colas)**, y con esa misma tasa de ≈ 19 % ver 0 de 11 tiene probabilidad **0,098**: la trampa de #543 (N=2 contra N=1) con N mayor —
**falta la tasa base del sujeto sin tocar**. Para no volver a llamarlo «sin vía causal»: `abrirSelectorDeMundos` pulsa `#ts-new` con 30
s **sin esperar la lista de saves** (45 s, `sesion.mjs:183`), tras pre-generar 9 escenas con tope de 240 s. Eso es #224, no
#659.

## El día después

- **Para quien juega, casi nada por el wire**: en una pestaña el título suprime el `input` y `session.enter()` (`main.ts:1259/1273`)
  aterriza antes de que se cierre — no hay carrera. El caso del jugador va por otro sitio y **#659 no lo cubre**: `lastState` solo se
  limpia en `loadRoom()` (`game-client.ts:189-190`), nunca en `session.leave()`; con el título puesto `idle()` (`:184`) repite el
  último frame de la partida muerta, `resetWorld()` ya vació el mundo y `mundo.vaciar()` limpió el dedupe (`mundo-del-cliente.ts:97`) →
  vuelve «el bridge mueve al NPC X y el cliente no lo tiene en escena» y el HUD sigue con el HP anterior. **Filtrar el wire no toca
  nada de esto**: con el criterio actual, #659 cierra con la mitad visible del síntoma viva.

  > **CORRECCIÓN MEDIDA (QA de la tanda O, 2026-09-18)**: este párrafo afirma el síntoma como OBSERVABLE y no lo es por ningún camino del jugador. La única vuelta al título desde una partida viva es el botón del overlay de fallo, que solo aparece con `mundoVacio` (`protocol/status-rotulo.ts`, `salida: "volver-al-titulo"`), y una partida sin mundo pintado tiene el sim recién sembrado (`reseedSimForSession`): el frame repetido es campo a campo el neutro. Construida a mano la única vía que quedaba —save herido a 37 PV con `scenes_loaded` vacío— el HUD SÍ marcó 37 y el registro SÍ ganó la entrada del NPC, pero el muro con «Volver al título» no llegó en 120 s: el reintento del bootstrap se retiró y desde #279 no nacen saves de cero escenas. El sink `estadoDelSim` SE QUEDA —es defensa en profundidad barata y correcta, y la garantía no puede ser que nadie encuentre el camino—, pero no se cuenta como síntoma arreglado.
- **Qué se vuelve más difícil**: `sessionId` requerido saca al mensaje de `SinSello` (`context.ts:337`) y los cuatro `ctx.send` **dejan
  de compilar** — el tipo haciendo su trabajo. Arrastra el doble de tests: `test/helpers.ts:246-248` implementa `send` **sin sellar**
  (`:249-252` dice qué pasa si diverge).
- **La trampa concreta, y es la del propio guion 80**: si el sello sale de `ctx.narrative.session_id`, en fixtures el bridge conserva
  la sesión anterior (`handleLoadRoom:183` ya calcula `inSession` con ese id rancio) y la página **descartaría su propia respuesta** de
  `load_room`, `respawn` y `add_combatants`; funcionaría por accidente solo con el bridge recién arrancado (`narrative-state.ts:214`,
  `""`). `state_update` es el único de los cinco canales que sirve a **dos regímenes de direccionamiento**;
  #313 ya resolvió esa forma dando verbo propio en vez de un sello inventado.
- **Prosa que queda falsa**: `ws-server.ts:75` («los tres que sí lo llevan»), `messages.ts:793-797` («23 literales»/«23 llamadas») y
  `replay-server.mjs:143-144` («los frames sellados del wire son tres»), que **ya miente hoy**: olvida `exits_changed`. **Qué se puede
  tirar**: la exención del guion 80 dice «cuando #659 se cierre, esta espera es la primera candidata a salir del censo» — ésa sí es
  dependencia verificada, y al revés de la que se supuso.

## Conflictos

- **Ninguno de contrato**: no hay espejo Python ni zod de `state_update` (`ai_server/`, `narrative-mcp/`, `src/contract/` = 0;
  `message-schema.ts` solo valida cliente→bridge), y el sello lo canda el tipo.
- **`la-logica-de-juego-no-vuelve-al-cliente` muerde aquí**, y su fixture negativo es literalmente un `state_update`
  (`test/architecture.test.ts:2613`). El precedente: la decisión de «esto no es mío» vive en core (`status-reparto.ts`, break de
  mutación 100; `esMio`, `session-facets.ts:253`) y el cliente entrega. Un `if` suelto en `game-client.ts` nace sin nada que lo mida.
- **Tanda Q en paralelo**: #656 es «la batería por reloj de pared se tumba bajo carga de máquina», así que re-medir #673 mientras la Q
  mide la batería en la misma máquina **introduce esa variable**. #610 reclasificaría la espera del 15; #658 (tanda P) toca el tick que
  emite `state_update`. Los cuatro ficheros están fríos desde el 17-09 (`a8e63da6`, `b839447d`/#626): rebase barato.

## Coste contra valor

**#659 vale y es pequeño**: cuatro emisores, un lector, cero servicios cruzados, y el tipo hace la mitad del trabajo. No hacerlo deja el
único canal de partida sin direccionar de cinco, y el precio se paga en horas de banco, donde ya se pagó dos veces (#543, siete días;
#634, atribución falsa). Lo que **no** vale es cerrarlo con el criterio de hoy: coste entero, mitad del síntoma viva. **#673, tal como
está, no vale lo que pide**: exige implementar #659 para descartar lo que se descarta leyendo `main.ts:662-664`. Lo que sí vale, y
cuesta CPU y cero créditos, es la tasa base del 15 sin tocar.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

1. En lugar de «Va con #659 porque el propio issue nombra a #659 como su instrumento»:
   > **#673 NO depende de #659, y queda descartado sin implementar nada.** En el instante del rojo (`qa/lib/sesion.mjs:291`, desde la
   > línea 305 del guion 15) no hay sesión, el título está delante y el cliente no manda `input` (`main.ts:662-664`) → ningún
   > `state_update` puede llegar; y la página es nueva (`run.mjs:1414`) → `lastState` vacío. Las dos PR son independientes, en
   > cualquier orden.
2. En lugar del punto 2 de «Qué se pide»:
   > **Medir la tasa base del guion 15 SIN TOCAR**, ≥ 21 corridas, mismo protocolo, y **no en paralelo con la tanda Q** (#656). Motivo:
   > 4/21 contra 0/11 da Fisher p = 0,17 y P(0 de 11 | 19 %) = 0,098 — no distingue «la migración lo causa» de «el 15 ya falla ahí». Si
   > la base sale > 0, #673 cierra como intermitencia del título y se reabre contra #224; si sale 0 de 21, se queda con una pregunta
   > más pequeña: qué cambia entre importar `qa/lib/fotogramas.mjs` y no hacerlo, que es todo lo que corre antes del rojo. **No se
   > cierra con tres verdes**: tres no resuelven un 19 % mejor que once.
3. Al criterio de cierre de #659, la mitad que le falta:
   > El wire es una de dos vías. La otra es `BridgeGameClient.lastState`, que solo se limpia en `loadRoom()`
   > (`game-client.ts:189-190`) y que `idle()` (`:184`) reproduce contra un mundo ya vaciado tras `session.leave()`. **Cerrar #659 sin
   > esto deja viva la mitad que el jugador ve.**
   >
   > **CORRECCIÓN MEDIDA (QA de la tanda O, 2026-09-18)**: «la mitad que el jugador ve» no la ve el jugador. Ver
   > la nota de «El día después»: el camino exige `mundoVacio` y con mundo vacío el frame repetido es el neutro.
   > El sink entra igual, como defensa en profundidad.
4. A «Restricciones», dos cosas que **no** se hacen:
   > · **No sellar con `ctx.narrative.session_id` a secas**: en fixtures el bridge conserva la sesión anterior (`handleLoadRoom:183`) y
   > la página descartaría su propia respuesta de `load_room`, `respawn` y `add_combatants`; #313 es el precedente. · **La decisión de
   > «esto no es mío» no se escribe en `game-client.ts`**: va en core, como `status-reparto.ts`.
5. Coordenadas: `messages.ts:320-364`; **cuatro** emisores (`simulation.ts:132, 256, 272, 333`); **cuatro** canales sellados y
   filtrados; el contrato de esperas está en `nefan-core/data/contract/`. Y **#673 no está escrito en su exención** (`grep -rn "#673"`
   = 0): escribirlo es parte del trabajo.
