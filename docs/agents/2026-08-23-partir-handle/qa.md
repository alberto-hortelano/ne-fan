# QA — partir `handle` del State API por concepto (#225)

Refactor sin superficie nueva para quien juega: el trabajo NO era buscar lo que se ve, sino lo que
se rompe sin verse. El corazón del riesgo es el flag `mutated` — perderlo en una ruta deja de
escribir el save y **no cambia ni un status ni un body**. La cadena de verificación se montó
alrededor de eso.

Todo lo de abajo está **reproducido por mí**, no leído del informe. Las sondas en negativo se
hicieron editando el árbol y restaurándolo con `git checkout --` acto seguido; el árbol quedó
limpio (`git status`: solo mis dos entregables).

## Criterios

| Criterio (de `requisitos.md` y del encargo) | | Evidencia |
|---|---|---|
| El tope de CRAP baja de 170 a ≤ 130, con el margen MEDIDO en tres pasadas | ✅ | Tope 127. **Cuatro** pasadas mías de `npm run coverage && npx tsx scripts/crap-score.ts`: **126.0 / 126.0 / 126.0 / 126.0**, `expandScenePrimitives · src/scene/scene-expand.ts:220`, cx 126, cob 99 %. **1066 funciones medidas** en las cuatro (ninguna contaminada: el gotcha del `lcov.info` compartido no se dio) y cobertura 90.3–90.4 %. `--check` ⇒ exit 0 |
| …y el margen no es decorativo | ✅ | Negativo: con `max: 125`, `✘ 1 función(es) por encima del tope de CRAP (125): 126.0 expandScenePrimitives`, exit 1. Restaurado a 127 ⇒ `✔ dentro de los umbrales`, exit 0 |
| Ninguna función del corte aparece en el top de CRAP | ✅ | `crap-score.ts --top 40` ⇒ `grep state-http` = **NINGUNA**. El nuevo #2 de la casa es `handle · services/asset-store/http-server.ts` (69.2), como dice la nota |
| Cada pieza se invoca sin levantar un servidor HTTP | ✅ | `test/state-http-dispatch.test.ts`: 40 tests; `grep -E "createServer|fetch\(|\.listen\(|127\.0\.0\.1|localhost"` da **un solo hit y es un comentario** (línea 5) |
| El candado `handlers-sin-servidor` se pone rojo de verdad | ✅ | Probado sobre un fichero REAL (no sintético): `import type { IncomingMessage } from "node:http"` en `entity-routes.ts` ⇒ `✖ [error] handlers-sin-servidor` con tres líneas nombradas (`entity-routes.ts:15 — patrón prohibido: "IncomingMessage"`, `"node:http"`, `:16 "IncomingMessage"`). Restaurado ⇒ `pass 35 · fail 0` |
| La guarda de sesión queda UNA vez, antes del despacho | ✅ | Un solo `sessionMismatch(...)` (`dispatch.ts:46`), **antes** de `matchRoute` (`:48`). `grep -rn "x-nefan-session\|session_mismatch"` en `bridge/ src/ narrative-mcp/ nefan-html/`: 6 hits, todos en `dispatch.ts` salvo la lectura de la cabecera en el transporte |
| …y funciona sobre una ruta inexistente | ✅ | En vivo contra `:9878`: `GET /ruta/que/no/existe` con `x-nefan-session: sesion-de-otro` ⇒ **409** `session_mismatch: … NO sigas leyendo ni mutando estado`. `GET /health` con la misma cabecera ⇒ 200 (exento) |
| La tabla del flag `mutated`: 12 rutas que escriben el save contra 16 que no | ✅ | Tabla **correcta**: comparación ruta a ruta del `handle` de `main` contra los 28 handlers nuevos (incluidas las mutaciones CONDICIONALES: `addInventoryItem` solo si `added`, `removeInventoryItem` solo si `removed`, los tres de `npcDirector` solo si `result.ok`). 12/16 en ambos árboles |
| …y la red se pone roja si se rompe | ⚠️ | **12 de 12** en la dirección cara: flipar `mutated(`→`ok(` en cada uno de los 12 sitios pone rojo `state-http-caracterizacion.test.ts` **nombrando la ruta**. En la dirección contraria, **14 de 16**: ver hallazgo 2 |
| Un endpoint sin handler no compila | ✅ | Borrar `getPlace` de `mapRoutes` ⇒ `routes.ts(30,14): error TS2741: Property 'getPlace' is missing … but required in type 'Record<RouteKey, RouteHandler>'`, exit 2. Y añadir un endpoint 29 a `WorldStateApi` ⇒ el mismo error para él: el contrato no se puede ampliar sin decidir quién lo contesta |
| …**en las dos direcciones** | ❌ | Un handler que NO es endpoint del contrato **compila sin error** (`rutaInventada` añadida a `mapRoutes` ⇒ `tsc --noEmit` exit 0). Ver hallazgo 3 |
| La red de caracterización existía ANTES de partir | ⚠️ | No verificable a posteriori (un solo commit no deja rastro del orden). Lo que sí está verificado: la red **muerde** (26 sondas en negativo) y, ejecutada contra el router de `main`, da **15 pass / 2 fail**, y los dos fallos son exactamente los dos tests marcados «CAMBIO DECLARADO». Es decir: la red no ve NINGUNA otra diferencia entre los dos árboles |
| `npm run verify` verde | ✅ | `build + lint + test` ⇒ `tests 1287 · pass 1287 · fail 0` |
| Mutación del módulo nuevo | ✅ | `npm run mutate -- --modulo state-http-dispatch` ⇒ **103 mutantes · 0 vivos · score 100.0 % (break 100) · 16 s** |
| La deuda que toca no crece | ✅ | `npm run deuda` ⇒ 58 items; `grep "state-http\|contracts/http"` sobre la lista de items = **NINGUNO** |
| CI de la PR #244 | ✅ | `gh pr checks 244`: `ai-server pass · narrative-mcp pass · nefan-core pass · nefan-html pass`. MERGEABLE |
| **Una partida completa por el camino real, guardada y REANUDADA** | ✅ | **Guion nuevo `qa/guiones/17-la-partida-se-guarda-y-se-reanuda.mjs`**, 45 asertos en verde. Ver abajo |
| `node qa/run.mjs` | ✅ | **16/16 en verde** (15 existentes + el nuevo). Antes de añadir el mío: 15/15, reproducido |

## El escenario que importaba: guardar y reanudar

**No había NI UN guion que reanudara una partida** (`grep -rn "resume\|reanud" qa/guiones` = 0 antes de
esta pasada). Ese es justo el sitio donde un `mutated` perdido se ve y en ningún otro. Lo escribí:

`qa/guiones/17-la-partida-se-guarda-y-se-reanuda.mjs` — partida nueva por el título (mundo → modo →
Comenzar), el motor escribe **once mutaciones** por el State API cubriendo **10 de las 12 rutas
mutadoras**, se recarga la página, se pulsa **«Reanudar»** en la tarjeta del save y se comprueba que
todo sigue ahí por el mismo cable del motor: el lugar, su enlace, su trigger, el objeto del
inventario (y el que se quitó, quitado), el NPC en el place al que llegó con su directiva, la
keep-list del prune y el sistema de juego con su slice.

**Una lección del negativo que cambió el diseño del guion.** La primera versión solo comprobaba «el
dato sobrevive al resume». Con `mapRoutes.upsertPlace` devolviendo `ok()` en vez de `mutated()`, ese
aserto **seguía verde**: el lugar sobrevivía porque la siguiente mutación que sí guardaba se lo
llevaba de paso. Perder un flag no borra necesariamente el dato — borra la partida en la que esa
ruta fue lo último que hizo el motor antes de cerrar. Por eso el guion mide el `state.json` de disco
**después de cada escritura**, no una vez al final.

**Probado en negativo cinco veces**, una por ruta, cada una con su rojo en la línea que la nombra:

| Roto | Rojo |
|---|---|
| `POST /map/place` sin marcar | `✘ …y el bridge escribe el save al hacerlo (/map/place) — state.json intacto` (×2) |
| `POST /npc/{id}/arrive` sin marcar | `✘ …y el bridge escribe el save al hacerlo (/npc/barkeep/arrive)` |
| `POST /entity/{id}/inventory` sin marcar | `✘ …(/entity/barkeep/inventory)` (×2) |
| `POST /plugins/register` sin marcar | `✘ …(/plugins/register)` + `✘ el sistema de juego que el motor creó sigue vivo tras reanudar` |
| `GET /map` marcando de más | `✘ 6 LECTURAS seguidas del motor no reescriben el save` |

Ningún otro guion de `qa/` se entera de ninguno de los cinco.

Sin espera por reloj: el borde del State API hace `await onMutation()` **antes** de contestar, así
que cuando la respuesta llega el save ya está escrito o no lo estará nunca. El candado
`qa-guiones-sin-espera-por-reloj` está verde sobre el fichero.

## Los dos cambios de comportamiento declarados: ¿le hacen daño a alguien?

Verificados **en vivo** contra `:9878` (preset `e2e-sin-creditos`).

**1. `GET /map/place/{id}` con segmentos de más ⇒ 404.** No le hace daño a nadie.
`narrative-mcp/server.ts:669` construye `/map/place/${encodeURIComponent(place_id)}` — un segmento
siempre, y con `place_id` vacío ni siquiera llama a esa ruta (`place_id ? … : '/map'`). Los 21 sitios
donde narrative-mcp llama al State API pasan todos por `encodeURIComponent`. Consumidores fuera de
`nefan-core`: el cliente (`fps-atlas.ts` → `/scene/asset_refs`), el `fake-ai-server`
(`/map/place`, `/map/link`, `/health`), `labs/narrative/check-scene.ts` (`/scene/validate`) y los
guiones 14/15 — **ninguno emite segmentos de más**. Los guiones 14, 15 y el nuevo 17 pasan.

**2. JSON roto en los dos POST que no leían el body ⇒ 500.** Tampoco.
`POST /npc/x/arrive` y `POST /scheduled_event/x/resolve` con `{roto` ⇒ `500 {"ok":false,"error":
"invalid JSON body"}`. narrative-mcp manda `{}` serializado por `JSON.stringify`: es inalcanzable
desde el motor. Es más fail-loud y va en la buena dirección.

**Pero el alcance real es más ancho que la declaración, en tres sitios (hallazgos 4, 5 y 6).**

## Hallazgos

### 1 · IMPORTANTE (fuera del alcance de #225) — al reanudar, el jugador aparece en (0,0,0)

Encontrado haciendo el escenario que se me pidió. **Medido**:

```
posición: empezó en {"x":0.25,"y":0,"z":3.25} · reanudó en {"x":0,"y":0,"z":0}
          · la escena declara __player_start {"x":0.25,"z":3.25}
```

En el tile del bench, (0,0) cae **dentro de la taberna**: la captura
`qa/capturas/17-…-03-partida-reanudada.png` sale a oscuras, sin cielo y con la cámara metida en la
geometría, frente a `…-01-partida-recien-empezada.png`, que tiene cielo, suelo verde y el pueblo
delante. Un jugador que reanuda ve eso.

**Causa**: `nefan-html/src/main.ts` coloca al jugador en `res.state.player.position` del save («La
posición viene del save (el bridge la snapshotea en `save_session`)»), y **`save_session` no lo manda
nadie**: `grep -rn "\.save()" nefan-html/src` sobre `narrativeClient` da **cero llamantes**. Así que
la posición nunca se snapshotea, el save guarda `[0,0,0]` y el resume aterriza ahí. Cuando el save no
trae posición usable, tampoco se cae de vuelta al `__player_start` de la escena activa, que está ahí
mismo.

**Reproducción desde el arranque**: `node qa/run.mjs 17` y mirar la línea `posición:` y las capturas
01 vs 03. O a mano: `./start.sh --preset e2e-sin-creditos`, partida nueva, andar un poco, F5,
«Reanudar».

**NO es de esta tanda**: `git diff main...HEAD --name-only` no toca `nefan-html/`, ni
`bridge/handlers/session.ts`, ni `narrative-state.ts`, ni `session-storage.ts`. Es deuda
pre-existente que el guion 17 destapa. **Queda medido en el guion como `ctx.log`, no como aserto**, a
propósito: un guion nacido rojo por deuda ajena hace que el rojo deje de significar nada. Quien lo
arregle solo tiene que cambiar `ctx.log` por `ctx.expect`. **Merece issue.**

### 2 · IMPORTANTE — dos huecos en la red del flag `mutated`

La tabla dice cubrir «las 16 que no mutan» para que «un `mutated: true` de más» no escriba el save en
cada lectura del motor. **Dos de las 16 no ejercen su camino de éxito**, y marcarlas como mutadoras
pasa desapercibido:

| Ruta | Qué pasa | Comprobado |
|---|---|---|
| `GET /entity/player` | La tabla `NO_MUTADORAS` usa `/entity/boris`, nunca `/entity/player`, así que la rama del shape especial (`entity-routes.ts:32`) no se ejerce con el contador | Poner `mutated(` ahí ⇒ **`pass 1287 · fail 0`** en TODO el repo |
| `GET /plugins/{id}/inspect` | La tabla usa `/plugins/deadbeef/inspect`, un plugin inexistente: el handler lanza y sale por `bad(...)` sin llegar al `ok(` | Poner `mutated(` en `plugin-routes.ts:20` ⇒ **`pass 1287 · fail 0`** |

Impacto: no es pérdida de datos, es el bridge reescribiendo el `state.json` entero cada vez que el
motor lee el jugador o inspecciona un plugin — y `GET /entity/player` es de lo que más lee el motor.
**Arreglo**: dos filas más en `NO_MUTADORAS` (`/entity/player` y un `/plugins/{id}/inspect` sobre un
plugin registrado). Las otras 14 sí se ponen rojas, verificado una a una.

### 3 · MENOR — «probado en las dos direcciones» no es cierto

`routes.ts` afirma en su cabecera: «el `satisfies` de cada fichero de handlers hace que un handler sin
endpoint tampoco [compile]», e `implementacion.md` repite «quitar un handler o inventarse uno no
compila, probado en las dos direcciones». **La segunda dirección no compila-falla**: `satisfies
Record<string, RouteHandler>` acepta cualquier clave string, y TypeScript no hace excess-property
check sobre las propiedades de un *spread*. Medido: `rutaInventada` en `mapRoutes` ⇒ `tsc --noEmit`
**exit 0**.

De regalo, la misma sonda descubre que **un handler DUPLICADO en dos ficheros también compila** (`getMap`
declarado a la vez en `mapRoutes` y `npcRoutes` ⇒ exit 0, y el último spread gana en silencio). A eso
sí lo cazan los tests (`fail 1`), no el tipo.

Es un handler muerto, no un bug de runtime — pero la afirmación está escrita en el código, que sí se
commitea, y es falsa.

### 4 · MENOR — el cambio declarado 1 es más ancho de lo que dice: las barras dobles interiores

El router viejo hacía `path.split("/").filter(Boolean)`, que **colapsaba** los segmentos vacíos;
`matchRoute` exige plantilla exacta. Además de los casos declarados, cambian estos, medidos en vivo:

| URL | `main` | rama |
|---|---|---|
| `GET /entity/player//inventory` | 200 con el inventario | **404** `no route for` |
| `GET /plugins//abc/inspect` | 200 (inspect de `abc`) | **404** |
| `GET /map//place/world` | 200 con el place | **404** |
| `POST /entity/boris//inventory` | 200 **+ escritura del save** | **404, sin mutar** |

Ningún emisor real los produce (todos pasan por `encodeURIComponent`), y el 404 es lo correcto: la
ruta pedida no es la contestada. Pero el bloque «CAMBIO DECLARADO» del test solo enumera cuatro URLs,
todas con el hueco en posición de `{param}`, y estas —incluido el POST que deja de escribir— no están
escritas en ninguna parte. Como `implementacion.md` no se commitea, la única memoria dentro de un mes
será ese comentario.

### 5 · MENOR — cambio de comportamiento NO declarado: `POST /vocabulary`

El viejo comprobaba la sesión **antes** de leer el body; el nuevo lee el body en el despacho, antes
de entrar al handler, y la comprobación de sesión vive dentro. Medido en vivo con el bridge sin
sesión activa:

| petición | `main` | rama |
|---|---|---|
| `POST /vocabulary` con `{roto` | `404 no active session — vocabulary belongs to a game session` | **`500 invalid JSON body`** |
| `POST /vocabulary` con `{"entries":[]}` | 404 `no active session…` | 404 `no active session…` (igual) |

Solo cambia cuando el body además es inválido, cosa que narrative-mcp no produce (`JSON.stringify`).
Impacto ≈ 0, pero es un tercer cambio de contrato observable y `requisitos.md` dice «Fuera de alcance:
cambiar el contrato HTTP del State API». Debe quedar escrito.

### 6 · MENOR — el cambio declarado 2 también cambia el modo de fallo por tamaño

`readJson` rechaza y hace `req.destroy()`, así que un body > 256 KiB **corta el socket**. Como ahora
TODO POST lee el body, tres rutas que antes contestaban pasan a no contestar. Medido:

| petición (300 KiB) | `main` | rama |
|---|---|---|
| `POST /npc/x/arrive` | `400 npc "x" not found` | **ECONNRESET** |
| `POST /scheduled_event/x/resolve` | `404 scheduled event "x" not found…` | **ECONNRESET** |
| `POST /vocabulary` (sin sesión) | `404 no active session…` | **ECONNRESET** |
| `POST /map/place` | ECONNRESET | ECONNRESET (pre-existente) |

Vía narrative-mcp esto sale como `bridge unreachable at … Is the nefan-core bridge running?`
(`bridge-http-client.ts`), que apunta al servicio caído cuando el problema es el tamaño del cuerpo.
Inalcanzable en la práctica (el motor manda `{}`), pero es un modo de fallo nuevo y engañoso, y el
plan ya lo tenía anotado como backlog («500 donde el contrato pide 400»).

### 7 · MENOR (higiene) — dos cosas de la instrumentación

- `data/contract/mutation-targets.json` viene **reformateado entero** por prettier (arrays de una
  línea a multilínea): el diff de 108 líneas esconde lo que de verdad cambió (un módulo nuevo, un
  `sin_mutar` menos, un `break` de 80 a 81). Y contribuye a que `npm run afectado` conteste «EJECUTA
  LOS 18 MÓDULOS», que el ingeniero tuvo que refutar a mano.
- `qa/README.md` no tenía fila para el guion `16-scatter-esquiva-el-suelo` (de la tanda anterior). He
  añadido la del `17`; la del `16` sigue faltando.

## Workarounds usados

Ninguno para **observar** la feature: no hubo que ocultar un overlay, forzar estado ni saltarse una
pantalla. El guion 17 entra por el título y reanuda con el botón «Reanudar», que es el camino del
jugador. Lo único a declarar:

- **Ediciones temporales para probar en negativo** (26 sondas: 12 mutadoras, 16 lecturas, 2 de tipo,
  1 de candado, 5 de guion, 1 de umbral). Cada una restaurada con `git checkout --` acto seguido;
  `git status` al final solo muestra mis dos entregables. Es el método de la prueba en negativo, no
  un apaño para que algo pase.
- **Efecto colateral cosmético**: esas restauraciones actualizan el *mtime*, así que `npm run deuda`
  ahora avisa «posiblemente obsoleta — cambiados después: bridge/state-http/…». Es mío, no de la
  rama, y desaparece con el siguiente `npm run coverage` / `npm run mutate`. La lista de items no
  contiene nada de `state-http`.
- El guion 17 lee el `state.json` del disco efímero del runner (`qa/.tmp/<corrida>/saves/…`). No es
  un atajo: declara `aisla: ["saves"]`, y el runner se niega a ejecutarlo contra un stack ajeno
  precisamente porque entonces no sabría dónde está ese disco.

## No probado

- **El motor narrativo real (Claude vía MCP) no se ejerció**: todo va con `fake-ai-server` y HTTP
  directo, cero créditos. Lo que sí se verificó por lectura es que los 21 sitios de
  `narrative-mcp/server.ts` que llaman al State API pasan por `encodeURIComponent`, así que no pueden
  producir ninguna de las URLs que cambiaron.
- **Los 28 handlers no tienen score de mutación**: el módulo `state-http-dispatch` mide `dispatch.ts`
  y `src/contracts/http.ts` (100 %), no los handlers. Lo declaró el ingeniero; queda igual.
- **`POST /vocabulary` y `POST /scheduled_event/{id}/resolve` no entran en el guion 17** (2 de las 12
  mutadoras): el primero escribe en `data/games/`, no en el save, y el segundo necesita un evento en
  la agenda que solo siembra el motor de verdad. Los dos SÍ están en la tabla del flag a nivel de
  test, y los dos se pusieron rojos al romperlos.
- **El orden «red antes del corte»** no es verificable a posteriori sobre un solo commit.
- Gasto real de créditos: no aplica, esta tanda no toca nada que gaste.

## Veredicto

**Apto con reservas.**

El refactor hace lo que dice y lo hace bien: el tope de CRAP baja a 127 con margen medido (cuatro
pasadas idénticas y negativo comprobado), ninguna pieza del corte asoma en el top-40, los handlers se
invocan sin puerto con un candado que muerde sobre ficheros reales, la guarda de sesión queda una vez
y protege hasta las rutas que no existen, el tipo impide ampliar el contrato sin handler, la mutación
del despacho está al 100 %, y **la tabla del flag `mutated` es idéntica a la de `main` ruta por ruta,
incluidas las mutaciones condicionales**. Una partida completa se guarda y se reanuda por el camino
real con las once escrituras del motor intactas, y ahora hay un guion que lo vuelve a comprobar y que
está probado en negativo cinco veces.

Las reservas, ninguna bloqueante:

1. **Los dos huecos del hallazgo 2** son dos filas de test y deberían cerrarse en esta misma PR: la
   red que se vende como «las 16 que no mutan» cubre 14.
2. **La afirmación del hallazgo 3 está escrita en código que sí se commitea y es falsa.** O se
   corrige la frase, o se hace verdad (`Exact<>`-like sobre las claves de cada grupo).
3. **Los hallazgos 4, 5 y 6 son cambios de comportamiento reales que no están declarados donde van a
   sobrevivir.** `implementacion.md` no se commitea; este `qa.md` sí, y por eso están aquí — pero lo
   barato es una línea en el comentario de `state-http-caracterizacion.test.ts`, que hoy además se
   contradice consigo mismo («es el único cambio» en un bloque, «el segundo y último» en otro).

Y una cosa que no es de esta tanda pero que se llevó por delante media captura: **al reanudar, el
jugador aparece en (0,0,0), dentro de la geometría** (hallazgo 1). Es deuda pre-existente del cliente
y del save, la rama no toca ni un fichero de ese camino, y merece issue propio.
