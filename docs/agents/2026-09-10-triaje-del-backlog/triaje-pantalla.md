# Triaje — familia «el juego en pantalla» (13 issues)

Verificado contra `main` = `5d67c8ca`, en solo lectura. Ni un veredicto sale del enunciado: cada uno
cita el fichero y la línea de hoy. Nada de lo que tocan estos 13 ha cambiado desde que se abrieron
(`git log --since=2026-09-06 -- nefan-html/src/ui/game-ui.css …` → vacío; lo único posterior al 09-07
es la serie de #346, que es el título y no toca esta familia).

## Resumen

| # | Qué | Veredicto | Quién lo cierra |
|---|-----|-----------|-----------------|
| 483 | La mirilla no se ve (canvas sin `z-index`) | **VIGENTE** · técnico | ingeniero · 2 líneas CSS + guion |
| 484 | Etiquetas: paredes, solape, enemigo=vecino | **DECISIÓN DEL USUARIO** (1-3) · reencuadrado (4 y 5) | el usuario contesta; luego ingeniero |
| 487 | Fixture no-Format-D deja el mundo vacío | **VIGENTE** · técnico, solo dev | ingeniero · guion 80 ya espera |
| 490 | `loadSession` acepta ids de runtime duplicados | **VIGENTE** · técnico, core, latente | ingeniero · test en core |
| 492 | El menú dev no puede salir de `main.ts` (8 deps) | **VIGENTE** (reencuadrado) · estructural, invisible al jugador | arquitecto + ingeniero · el de menos valor de los 13 |
| 497 | El `#error-log` tapa el chip de gráficos | **YA CUBIERTO POR #509** · se queda con su segunda mitad | ingeniero (tras recortar el cuerpo) |
| 502 | La conversación pierde «tenía el ratón» | **VIGENTE** · técnico, trivial | ingeniero · 1 línea + guion 83 |
| 503 | Muro con botón y ratón capturado | **VIGENTE** · técnico | ingeniero · hermano de #502, misma tanda |
| 506 | HUD de combate: activo atenuado + línea cortada | **VIGENTE**, causa del punto 2 reencuadrada | ingeniero · 2 líneas CSS/TS |
| 509 | El registro tapa el panel del chip y come el click | **VIGENTE** · técnico (es «el click que no llega») | arquitecto (capa) + ingeniero |
| 510 | El chip miente con el fusible saltado + doble línea | **VIGENTE** · los dos puntos, verificados | ingeniero · con #520, mismo módulo |
| 524 | Spawns a 1,8 m fijos sin mirar la huella | **VIGENTE**, atada a #532 (decisión de contrato) | va CON #532, nunca antes |
| 527 | HUD ambiguo con máximo de vida ≠ 100 | **VIGENTE** · técnico, trivial, latente | ingeniero · 1 línea + guion 89 |

**Una sola pregunta para el usuario en toda la familia: #484.** Los demás son «un elemento
inalcanzable, un click que no llega, un número que miente» — que por el marco del triaje no son suyos.
#524 depende de una decisión suya que vive en **#532**, de otra familia.

---

## #483 · La mirilla no se ve

**VIGENTE.** Premisa verificada entera.
- `game-ui.css:447-457`: el bloque `#reticle` no declara `z-index` (sí lo declaran sus vecinos en
  `459-462`: `--z-hud` 20, `--z-panel` 30, `--z-prompt` 40, `--z-dialogue` 50).
- `game-ui.css:57`: `#game-ui { position:absolute; inset:0 }` sin `z-index`; `base.css:128`:
  `#app-shell > canvas { position:absolute; inset:0 }` sin `z-index`.
- `fps-renderer.ts:61-66`: el canvas se crea con `id="fps-canvas"` y se hace `host.appendChild` sobre
  `#app-shell`, es decir DESPUÉS de `#game-ui` (`index.html:86,89,131`). Dos `absolute` con `z-index:auto`
  → gana el último del DOM. La etiqueta del mundo se salva porque `ui/world-labels.ts:71` pone `zIndex`
  inline; `#reticle` no tiene nada.

**Qué hacer.** Decidir la capa del lienzo de una vez (`#app-shell > canvas { z-index:0 }` +
`#game-ui { z-index:1 }` es lo que menos rompe: el `z-index` en `#game-ui` crea contexto de apilado y
sus bandas internas siguen siendo relativas; `#error-log` 8900 y `#dev-status` 10000 viven fuera y no
se ven afectados). Candado: `elementFromPoint` en el centro del lienzo, o un aserto de píxel en el 10 o
el 79. Sin contrato, sin core. Es el más visible para el jugador de los 13: hoy la única señal de «esto
se puede tratar» en primera persona no existe en pantalla.

## #484 · Backlog visual de las etiquetas del mundo

**DECISIÓN DEL USUARIO** en sus puntos 1-3; los otros dos se van del issue.

Premisa verificada punto por punto en `ui/world-labels.ts:47-77`:
1. `sync()` proyecta y atenúa por profundidad (`:66-69`) y no consulta oclusión: **cierto**, las etiquetas
   atraviesan paredes.
2. `node.style.zIndex = 1000 - depthM*10` (`:71`) ordena, no separa: **cierto**, dos alineados se pisan.
3. El tipo `WorldLabel` solo lleva `focus?: boolean` (`:20`) y el CSS solo tiene
   `.world-label[data-focus="true"]` (`game-ui.css:440`): **cierto**, no hay forma de distinguir a un
   hostil de un vecino. El propio issue lo llama «decisión de diseño pendiente».
4. No hay recorte por bordes de pantalla en `sync()`: **cierto**, y el propio issue lo llama inocuo
   (`pointer-events:none`). Es una trivialidad, no un issue.
5. El ruido del selector «Room» con partida viva **ya es #496** («el guion 80 y a veces el 75 salen rojos
   porque el bridge compartido difunde la vida ambiental del guion anterior a una página sin sesión»),
   con causa medida y dueño. Sobra aquí.

**Qué hacer.** Recortar el cuerpo a los puntos 1-3 (borrar el 5, que es #496; el 4 se cuela gratis en la
PR que toque `world-labels.ts`) y **esperar la respuesta del usuario** — ver la pregunta al final.

## #487 · Fixture que no es Format D deja el mundo vacío

**VIGENTE.** `world/fixtures-del-selector.ts:104-107`: `loadSceneData` llama `resetWorld()` (línea 105)
y solo DESPUÉS `addTileRaw` → `formatDToWorld(raw)` (línea 101), que es quien lanza. El `alFallar` que
revierte el `<select>` sigue asumiendo que el mundo anterior está puesto. El guion
`qa/guiones/80-el-desplegable-room-dice-lo-que-se-ve.mjs:187-195` declara la deuda con este número y
tiene el `ctx.expect` listo para volver.

**Qué hacer.** Ingeniero: validar/normalizar antes de `resetWorld()` y devolver la línea 194 del guion 80
a `ctx.expect`. Camino solo de desarrollo (las fixtures commiteadas son todas Format D, lo canda
`test/scene-fixtures.test.ts`), así que el valor es la disciplina fail-loud, no un fallo de partida.
Barato y con candado esperando: hacerlo.

## #490 · El gate de `loadSession` acepta ids de runtime duplicados

**VIGENTE.** `narrative-state.ts:500-575`: el gate comprueba `schema_version`, el contrato zod de cada
escena, el `tile` del registro (#405), `position` (#382) y `data.name` (#397) de cada record, y el
inventario (#452). **No hay ni una comprobación de unicidad de id** (`grep duplic` en el cuerpo de
`loadSession` → vacío). El handler que lo traduce a `save_invalido` está en
`bridge/handlers/session.ts:571-582` y sigue igual.

**Qué hacer.** Ingeniero, en core: rechazar ids repetidos entre records y contra las entidades del tile,
con el mismo molde de mensaje que los otros cuatro, y test con el save editado. Latente (por el camino
del motor el core deduplica), pero es exactamente la forma de los cuatro gates ya pagados y cuesta poco.

## #492 · El menú de desarrollo y sus 8 dependencias

**VIGENTE**, con el enunciado reencuadrado. Medida de hoy, en `main.ts`: `listFakeItems` (`:832-875`)
consulta `fpsRenderer`, `tileStore`, `fpsAtlasController`, `aspecto`, `mundo`, `spriteRenderer`
(`BASE_MODEL`/`getCached`), `characterSprites` y `CONFIG` — **ocho**, la cifra del issue; `generateFakeItem`
(`:879-885`) no añade ninguna. `DevMenuDeps` (`ui/dev-menu.ts:22-26`) solo pide tres funciones: el
inventario lo hace la raíz desde fuera. `const devMenu` en `main.ts:890`, como dijo el corte 8.

`data/contract/client-file-size.json` congela `main.ts` en 1410 líneas y dice literalmente que no se
trocea más «salvo un issue con la frontera MEDIDA (≤ 6 colaboradores)»: #492 **es** ese issue, así que no
choca con el candado.

**Reencuadre.** El título dice lo que no se puede hacer; el problema es que dos dueños
(`fpsAtlasController`, `characterSprites`) no saben decir qué arte suyo está pendiente, y por eso hay que
inventariar el cliente entero desde fuera. Escrito así, el criterio de cierre es «`pendientes()` en cada
dueño y `DevMenu` bajo el patrón de fábrica», y el descenso de `main.ts` es la consecuencia, no el objetivo.

**Aviso honesto**: es el de menos valor de los 13 — cero efecto para el jugador, ~60 líneas de `main.ts`,
y `main.ts` no tiene hoy presión de tope. Si el coordinador tiene que dejar uno fuera de la tanda, es este.

## #497 · El `#error-log` lleno tapa el chip de gráficos

**YA CUBIERTO POR #509** en su mitad principal, y **reencuadrado** en la otra.

- El solape y el click que no llega son literalmente el sujeto de **#509**, que además trae criterio
  medible (`elementFromPoint` en el centro de cada toggle). Dos issues para un defecto.
- La mitad que **solo** vive aquí y sigue siendo cierta: **el registro no se vacía entre partidas**.
  Verificado: `ui/error-log.ts` no expone ningún `clear`/`vaciar` (`grep -n "clear\|vaciar"` → nada;
  solo `MAX_ENTRIES = 200` en `:173` y un `splice` de rebose en `:227`), y nadie lo llama desde ninguna
  parte del cliente. La entrada del `walk` de la partida A sigue en pantalla en la B.
- La geometría es la que dice: `dev-ui.css:111-123`, `#error-log { position:fixed; top:34px; right:12px;
  width:320px; max-height:calc(100vh - 54px); z-index:8900 }` contra el chip y su panel, que viven en
  `#ui-bottom-right` (`index.html:121-126`) con `z-index: var(--z-panel)` = 30 (`game-ui.css:460`).
  8900 ≫ 30, y con el registro crecido la banda derecha llega hasta abajo. (El cuerpo dice «esquina
  superior derecha»: el chip está en la **inferior** derecha desde `e748724f`. El defecto no cambia.)

**Qué hacer.** Recortar #497 a «el registro de errores no se vacía al cambiar de partida» (con el sink
`porValor` que el propio issue nombra) y dejarle el solape a #509.

## #502 · La conversación pierde «tenía el ratón»

**VIGENTE.** `ui/conversacion.ts:68` apunta el flag **en cada** `abrir()`, sin guardia de transición:

    ratonCapturadoAntesDelDialogo = document.pointerLockElement !== null;

y acto seguido `panel.show()` (`:71`) llega a `ui/dialogue-panel.ts:170`, que hace
`if (document.pointerLockElement !== null) document.exitPointerLock()`. La segunda línea con el panel ya
abierto encuentra el lock ya soltado → `false` → `devolverElRatonTrasElDialogo` (`:108`) sale por la
primera guarda y el ratón no vuelve. No hay ningún `if (!abierta())` en el módulo.

**Qué hacer.** Ingeniero: una línea (`if (!abierta())` alrededor del apunte, o apuntar en la transición)
y ampliar el guion 83 con dos `dialogue` seguidos del motor falso. Trivial, sin riesgo.

## #503 · Muro con botón, ratón capturado y sin cursor

**VIGENTE.** `ui/muro-de-carga.ts` **no menciona el pointer lock en ninguna línea**
(`grep -n "ointerLock" ui/muro-de-carga.ts` → vacío; los cinco tocadores del lock en el cliente son
`keyboard-input-provider.ts`, `main.ts:520`, `conversacion.ts`, `dialogue-panel.ts:170` y el hook del
banco). `fallo()` (`:119`) ya distingue `salida` («cerrar» / «volver-al-titulo»), o sea que sabe cuándo
pinta botones: le falta soltar el lock cuando los pinta.

**Qué hacer.** Hermano de #502 y misma disciplina («soltar y devolver son las dos mitades de un acto»,
#311/#323): **hacerlos en la misma tanda, con el mismo guion**. Sin ellos el jugador se queda delante de
un muro a pantalla completa con un botón que no puede pulsar y sin nada que le diga que Esc lo salva.

## #506 · HUD de combate

**VIGENTE** los dos puntos; la causa del segundo estaba mal atribuida.

1. `game-ui.css:140`: `#game-ui[data-locked="true"] .nf-action { pointer-events:none; opacity:.75 }`
   atenúa TODOS, y lo único que marca al elegido es `.nf-action[data-active="true"]` (`:115-118`:
   borde y color de acento) — que se atenúa igual. `docs/arquitectura/ui.md:37-38` documenta el
   atenuado como «recordatorio de teclas», y el recordatorio que se pierde es cuál está elegido.
   **Vigente y técnico**: el activo no se atenúa. Una regla CSS y una captura de referencia en el 84.
2. **Reencuadre de la causa.** No es el borde inferior del viewport: `#ui-bottom-left` vive en
   `bottom:12px` y no puede salirse. Es que dos números no se hablan — `main.ts:495` corta a **8 líneas**
   y `game-ui.css:256-262` le da `max-height:110px; overflow:hidden` con `font-size:11px` y
   `line-height:1.5` (16,5 px/línea → **6,67 líneas caben**). La séptima sale partida por la mitad,
   siempre, en cualquier resolución. El arreglo que propone el issue («el contenedor con overflow»)
   sobra: ya lo tiene. Lo que hay es que el tope y la altura salgan del mismo número.

## #509 · El registro tapa el panel del chip y sus toggles no reciben el click

**VIGENTE**, y es el que se queda con el solape (ver #497). Premisa y geometría verificadas ahí mismo:
`#error-log` z-index 8900 `position:fixed` bajando desde `top:34px` con `max-height:calc(100vh - 54px)`,
contra `#gfx-panel` en `#ui-bottom-right` con z-index 30.

**No es decisión del usuario**: es el ejemplo literal de «un click que no llega». El chip es la puerta
del gasto y el registro crece justo cuando el jugador quiere tocarla. El criterio del cuerpo ya es
ejecutable (`elementFromPoint` en el centro de cada toggle con N ≥ 5 entradas).

**Qué hacer.** Arquitecto: decidir la capa del HUD de desarrollo respecto a la interfaz de juego de una
vez —es la misma pregunta sin respuesta de #483— y escribir la línea en `ui.md`. Ingeniero: aplicarla y
el guion. Ojo al precedente que ya existe: el título **reserva** hueco para `#dev-status` en vez de
pelearse con él (`base.css:49,75,106`), y esa es la forma de la casa.

## #510 · El chip miente con el fusible saltado, y cada gesto escribe dos veces

**VIGENTE**, los dos puntos, línea a línea.

- **H2.** `ui/modos-de-graficos.ts:206`: `charsOn: deps.characterSprites.skinsAllowed && CONFIG.graphics.ai_skin`.
  Y `renderer/character-sprites.ts:147-155`: `allowed` es un booleano propio que solo mueve
  `setSkinsAllowed`; el fusible es otro objeto (`private fusible = new FusibleDeSkins()`, `:142`) que se
  consulta aparte en `:209` y `:253`. **El fusible no toca `skinsAllowed`**, así que el chip sigue
  diciendo «Skins IA» mientras el registro dice que están apagados. Dos verdades en pantalla.
- **H3.** `aplicar()` (`:126-158`) hace `deps.log("Gráficos: …")` incondicionalmente (`:147`/`:149`), y
  `main.ts:825-827` vuelve a llamar a `graficos.aplicarFaceta` con el eco `render_mode_changed` que el
  bridge difunde también al que lo pidió (`bridge/handlers/session.ts:795-799`). Un gesto → dos líneas.
  Idempotente en estado, no en el registro.

**Qué hacer.** Ingeniero, con **#520** en la misma tanda: comparten raíz (que `skinsAllowed` no sea el
estado efectivo es también por lo que la transición OFF→ON de `:153` no dispara el re-pedido). Cuidado
con la semántica que canda el guion 51 («el fusible se rearma por el chip»): eso lo mira el arquitecto
antes de tocar `skinsAllowed`. Y el aviso del fusible no debe hablar de «sesión» en modo fixtures.

## #524 · Los spawns de un turno se reparten a 1,8 m fijos

**VIGENTE**, y **atada a #532**. Verificado en `src/narrative/consequence-handler.ts:195` (el módulo se
mudó del bridge a core con la PR 5 de #241): `const SEPARACION_M = 1.8`, y `resolvePositionHint`
(`:199-226`) reparte `paso * SEPARACION_M` sin mirar la huella. El propio comentario (`:191-194`) lo
admite: «menos que el de un edificio (4 m)» — dos edificios de 4 m separados 1,8 m se solapan 2,2 m. Y
`huellaEnMetros` ya está a mano en ese fichero (se importa en `:9` y se usa en `:149`).

**Por qué no va sola.** #532 («todo `object` que spawnea el motor es un muro sólido de 1,5 m») es una
**decisión de contrato del usuario** todavía sin contestar, y decide QUÉ hay que separar: si un ítem deja
de ser sólido, la mitad de los casos de #524 desaparece; si `spawn_entity` gana `footprint`, la
separación tiene que leerlo. Hacer #524 antes es escribir un test que #532 reescribe. **Misma tanda, o
después.** El coordinador debería llevarle #532 al usuario junto con esto.

## #527 · HUD ambiguo con un máximo de vida distinto de 100

**VIGENTE**, latente y trivial. `main.ts:717-719`: la barra sale de
`result.playerHp / result.playerMaxHp * 100` y el texto es `Math.ceil(result.playerHp).toString()` — sin
denominador. El máximo ya viaja en el wire desde #504 (`net/game-client.ts:25,66,129,213`). Y sigue
siendo cierto que hoy nadie produce otro valor: el único productor es `src/store/game-store.ts:24`
(`max_hp: 100`), con `src/store/reducers.ts:38` derivando la vida de él.

**No es decisión del usuario**: es «un número que miente», y el dominio tiene respuesta canónica
(`vida / máximo`). Ingeniero: una línea en `main.ts`, la línea en `ui.md` y el guion 89 con un save de
`max_hp: 150`.

---

## Hallazgo suelto (NO es uno de los 13)

Misma familia que #483/#509 —capas del HUD que nadie decidió— y verificado de paso:
`renderer/fps-renderer.ts:71-73` le pone a `#fps-debug-label` un `style.cssText` completo con
`top:8px; z-index:30`, que **pisa entero** el bloque `#fps-debug-label` de `dev-ui.css:145-160`
(`top:42px; z-index:8800`, mismo aspecto duplicado). Con `#dev-status` en `z-index:10000` y ocupando la
banda superior (`dev-ui.css:12-31`, alto hasta `--dev-status-alto: 86px` en `base.css:49`), la píldora
de la tecla **B** nace debajo de la barra de dev y con la mitad del `z-index` que su propio CSS le
reserva. Es dev, es trivial, y el CSS que lo arreglaba lleva tiempo siendo prosa muerta. Issue nuevo de
una línea, o se cuela en la PR de #483.
