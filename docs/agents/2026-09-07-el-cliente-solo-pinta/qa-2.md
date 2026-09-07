# QA — PR 2 de #241: la frontera del jugador sale del cliente a `scene/frontera.ts` (#512)

Worktree `/home/al/code/ne-fan-241-2-qa`, HEAD desprendido `20fb3dfa` sobre `main` = `76beb948`.
Bloque de puertos propio (`NEFAN_PORT_OFFSET=500`, `ss -ltn` a cero antes de arrancar). Cero créditos:
todo por `e2e-sin-creditos` con el motor falso, y el guardarraíl del banco confirmándolo en cada guion
(`⛨ guardarraíl: cliente y bridge declaran fake:true`).

## Veredicto

**APTO CON HALLAZGOS.** El movimiento es fiel —diff normalizado sin una línea de lógica nueva, los cinco
umbrales intactos, el reloj por parámetro en todas las entradas, `debugState()` con la misma forma— y en el
juego real la única regla de gasto del jugador se comporta igual que antes por los ocho caminos que he
sabido recorrer, incluidos los tres que ningún guion tocaba (la `N`, el timeout de 5 min y el cooldown de
15 s tras un error). Batería entera **85 en verde · 0 en rojo de 85**, sin retocar un guion. **Ninguno de
los cinco hallazgos lo introduce esta PR y ninguno es bloqueante**: dos son prosa que ya envejeció mal (el
issue #512 describe una regla que no existe, y el plan da por medida la `Y`) y hay que corregirlos al
cerrar; dos son conducta preexistente que el movimiento hereda y que, con el autómata ya en core, pasan a
ser baratos de arreglar; y el importante es del BANCO: tres de las cinco ramas de la regla de gasto no las
puede ejercer ningún guion porque el motor falso no se deja conducir desde la página — las verifiqué a mano,
que es exactamente el workaround que la regla manda reportar.

## Criterios

| # | Criterio | | Evidencia |
|---|---|---|---|
| 1 | **Es un MOVIMIENTO: cero lógica nueva** | ✅ | Diff normalizado (renombres deshechos, comentarios fuera) entre `git show 76beb948:nefan-html/src/world/frontier.ts` y `nefan-core/src/scene/frontera.ts`: los únicos deltas son `export` en las constantes, cuatro tipos extraídos (`PedirTile`, `TilesDelPlano`, `FrameDeFrontera`, `BORDES`), dos helpers que factorizan repetición **sin cambiarla** (`#olvidar` = los tres `delete` del timeout/llegada/error; `#enCooldown` = `errorEn !== undefined && now - errorEn < COOLDOWN`, cuyo `!` es literalmente el `=== undefined \|\| >= ` de la base), el aplanamiento del `if (d < BLOCKING_M) { if (…) }` en un `&&`, y el reloj de `alError` a parámetro |
| 2 | **Mismos umbrales (16/8/2 m, 5 min, 15 s)** | ✅ | `PROPONER_A_M 16`, `VELO_A_M 8`, `BLOQUEO_A_M 2`, `TIMEOUT_DE_TILE_MS 5*60_000`, `COOLDOWN_TRAS_ERROR_MS 15_000` — idénticos a `PREFETCH_M/VEIL_M/BLOCKING_M/TILE_TIMEOUT_MS/ERROR_COOLDOWN_MS`. Y escritos otra vez en `test/frontera.test.ts:52` («si alguien los cambia, esto se pone rojo»). **Medidos en el juego**: propuesta a 15,86 m y a 15,54 m; velo a 7,64 m; `blocking` a 1,61 m; timeout a los 300 s; propuesta de vuelta al segundo 15 tras el error |
| 3 | **Reloj por parámetro en TODAS las entradas** | ✅ | `grep -nE 'performance\.now\|Date\.now\|node:\|require\(' nefan-core/src/scene/frontera.ts` → una sola línea, y es el **comentario** `:14` que cuenta de dónde salió. `tick(now,…)`, `confirmar(now,…)`, `alError(tx,ty,now)`; `rechazar/alTexto/alTileListo` no necesitan reloj. El cliente le pasa su `performance.now()` (`frontera-del-jugador.ts:90`, `main.ts:1015`) |
| 4 | **El mutante del reloj muere** | ✅ | Sabotaje mío `this.#errorEn.set(key, Date.now())`: `npx tsx --test test/frontera.test.ts` → `ℹ tests 30 · pass 26 · fail 4`. Revertido |
| 5 | **`debugState()` con la MISMA forma** | ✅ | En el navegador, partida real: `Object.keys(window.__nefan.frontier).sort()` → `["declined","proposal","requested"]`, tipos `requested:array · declined:array · proposal:object`. Los cuatro guiones que la leen (05, 10, 42, 58) corren sin retocar |
| 6 | **Módulo puro, sin `node:*`, dentro del perímetro** | ✅ | Importa solo `../world-map/types.js` (tipo) y `./tile.js`. `src/scene/**` está en `core-puro-sin-node` (`arch-rules.json`) y el cliente lo alcanza bajo la regla `cierre`: `npm run verify` → `exit=0`, `ℹ tests 2215 · pass 2215 · fail 0` |
| 7 | **Regla `la-logica-de-juego-no-vuelve-al-cliente` ROJA con un token** | ✅ | Añadí `// QA negativo: FrontierManager con PREFETCH_M vuelve al cliente` al final de `fps-renderer.ts` → `✖ [error] la-logica-de-juego-no-vuelve-al-cliente`, `nefan-html/src/renderer/fps-renderer.ts:291 — patrón prohibido: "FrontierManager"` + `"PREFETCH_M"`, `2 !== 0`. Árbol restaurado (`git status` limpio) |
| 8 | **…y su `why` cuenta qué era y dónde vive** | ✅ | El mensaje del fallo imprime el `why` entero: «la FRONTERA DEL JUGADOR — proponer el tile vecino a 16 m del borde, velo a 8, promoción a blocking a 2, timeout de 5 min y cooldown de 15 s tras un error — era `world/frontier.ts` (`FrontierManager`, 248 líneas) y es la única regla de GASTO del jugador… Vive en `nefan-core/src/scene/frontera.ts`». Incluye el motivo del `\b` de cierre (`VEIL_MAX_ALPHA` es pintar) |
| 9 | **Entrada `frontera` en `mutation-targets.json` con `break: "sin medir"`** | ✅ | `id: frontera`, `mutate: src/scene/frontera.ts`, `tests: test/frontera.test.ts`, `break: "sin medir"`, y un `porque` que nombra los mutantes que importan: «`<` → `<=` en los 16 m propone un metro antes; quitar el dedupe de `#pedidos` pide el tile en cada frame; quitar `#rechazados` vuelve a preguntar lo que el jugador acaba de negar; `<` → `<=` en el cooldown re-pide con el motor caído» |
| 10 | **Sin la entrada, `npm test` cae «sin dueño»** | ✅ | Quitada del JSON: `npx tsx --test test/mutation-config.test.ts` → `fail 1` · `sin dueño en data/contract/mutation-targets.json: src/scene/frontera.ts. Un diff que toque solo esos ficheros no seleccionaría ningún módulo y saldría verde sin medir nada`. Restaurada |
| 11 | **`npm run deuda` lo lista** | ✅ | `Mutación — supervivientes · 58 · ⚠️ sin medir 1 de 44 módulos (1 ficheros sin dato): npm run mutacion -- pendiente (sin medida previa)`. Y `npm run mutacion -- local frontera` → `NO se mide aquí: no hay medida previa de frontera… exit=1`, que es lo esperado (`permisoLocal` rechaza el coste desconocido); `pendiente` lo cuenta: `Se medirían 15 de 44 módulos · 1992 mutantes medidos antes + 1 módulo(s) sin base: frontera` |
| 12 | **Rastros a cero** | ✅ | El `grep` del encargo sobre `nefan-html/src qa docs/arquitectura` deja SOLO: el hook `__nefan.frontier` (05/10/42/58 y `nefan-hook.ts:117`), la variable/clave `frontier` de las deps, las cuatro llamadas a core, y `frontierBlocksMove` (`collision.ts`, que es de la PR 5). Ni un `FrontierManager`, `PREFETCH_M`, `VEIL_M`, `BLOCKING_M`, `TILE_TIMEOUT_MS` ni `ERROR_COOLDOWN_MS` |
| 13 | **La nota de `frontera-del-jugador.ts` ya no miente** | ✅ | `:13-15` pasa de «su decisión ya está en core, en el manager» a «La decisión no está aquí: a core le llegan el reloj (`performance.now()`), la posición y los tiles como argumentos». `mapa.md` corregido en sus DOS entradas (`scene/` gana «la frontera del jugador (frontera.ts)»; `world/` dice «vive en core… y aquí solo se pinta»). `grep -rniE 'frontera' docs/arquitectura CLAUDE.md nefan-core/{src,bridge}` no deja una sola frase que la sitúe en el cliente |
| 14 | **Flujo real: la propuesta a 16 m con su pregunta** | ✅ | Partida nueva `alta_fantasia` desde el título, andando con `W` (teclado real): a 19 m `proposal: null`; a 15,86 m `{"key":"tile_1_0","tx":1,"ty":0,"edge":"east"}` y en pantalla «¿Explorar hacia el este? Se generará una zona nueva.» con `Y sí, explorar` / `N no` — captura `01-propuesta-a-16m.png` |
| 15 | **Flujo real: el velo desde 8 m** | ✅ | A 7,64 m `fps().veil = {"edge":"east","opacity":0.25}` y subiendo — captura `02-velo-a-8m.png`: muro de niebla cálido sobre el horizonte del este, con el suelo llegando hasta él |
| 16 | **Flujo real: `N` no gasta y no se re-propone hasta alejarse** | ✅ | Tras la tecla `N` real: `declined: ["tile_1_0"]`, `proposal: null`, la pregunta se retira (captura `03-tras-la-N.png`) y **cero peticiones en el socket**. Acercándose a 5,06 m y luego pegándose al muro a **0,45 m**: sigue `proposal: null` y cero peticiones. A 20 m `declined: []` (el rechazo caduca) y **volviendo andando se re-propone a 15,54 m** |
| 17 | **Flujo real: `Y` trae el tile y el velo se disipa** | ✅ | Tecla `Y` real → **una sola** petición en el socket, `{"tx":1,"ty":0,"reason":"prefetch","edge":"east"}`; `tiles` pasa a `["tile_0_0","tile_1_0"]`; `fps().veil = null`; `requested: []`. Registro del juego: «Generando la zona al este (tile_1_0)…», «🌍 el mundo continúa hacia el este». Captura `05-tras-la-Y-tile-llegado.png`: el mundo sigue con árboles y camino donde estaba el muro |
| 18 | **Flujo real: bloqueo direccional** | ✅ | El jugador se para a 0,45 m del borde sin tile y, con `S`, retrocede (x 31,55 → 29,59): la retención es solo hacia el vecino que falta |
| 19 | **Flujo real: promoción a `blocking` a 2 m** | ✅ | Con el tile EN VUELO (motor falso con `TILE_DELAY_MS=400000`): tras confirmar a 15 m, al llegar a **x=30,39 (1,61 m del borde)** sale `{"reason":"blocking","edge":"east"}`, y 40 fotogramas más contra el muro no añaden ninguna: `[prefetch@1412ms, blocking@4552ms]` |
| 20 | **Flujo real: error del bridge → cooldown de 15 s y reintento** | ✅ | Motor falso con `TILE_MODE=error`: tras la `Y`, error en 152 ms, el ledger lo apunta y el registro dice «El motor narrativo no pudo construirlo; inténtalo de nuevo.». Muestreando cada segundo junto al borde: `1s:-/1 … 14s:-/1 15s:PROP/1 16s:PROP/1` — la propuesta **no** vuelve en 14 s, vuelve al 15, y el contador de peticiones se queda en 1 (cero spam) |
| 21 | **Flujo real: timeout de 5 min** | ✅ | Motor falso con `TILE_DELAY_MS=400000`: la petición **VENCIÓ a los 300 s** exactos, el registro de errores dice «El tile tile_1_0 no llegó a tiempo (timeout); se reintentará al acercarse.» y el tile vuelve a proponerse (`proposal.key = tile_1_0`), con una sola petición en todo el episodio |
| 22 | **Guion nuevo `qa/guiones/86-…` con su fila en `qa/README.md`** | ✅ | `86-la-frontera-que-se-rechaza-no-gasta.mjs`, 15 asertos verdes, probado en negativo tres veces (abajo). Fila añadida tras la del 85 |
| 23 | **Los guiones que ejercen la frontera, verdes sin retocar** | ✅ | Batería completa abajo; 05, 10, 42 y 58 incluidos, sin tocar un carácter |
| 24 | **`npm run verify` / cliente** | ✅ | `verify exit=0`; `tests 2215 · pass 2215 · fail 0` |

## Las dos afirmaciones del ingeniero

**(a) «El plan §2/§7(b) dice que NINGÚN guion confirma con Y: es falso; 05, 42 y 58 confirman y cruzan».**
**Cierta, con un matiz que conviene escribir.** El **58** pulsa la tecla `Y` de verdad
(`:213 mantener(ctx, "y", 2)`) con la propuesta delante y afirma que se pide la zona; el **05** (`:229`) y el
**42** (`:200`) confirman con `inputDriver.queueTileConfirm()`, que es el driver de bench y **se salta el
gate `propuestaDeTileAbierta()`** — ejercen la confirmación, no la tecla. Así que el plan se equivoca al
decir «ninguno», y el 58 ya cubre la `Y` real; lo que 05 y 42 aportan es el cruce al tile nuevo.

Y lo que NO tenía guion es exactamente lo que él dice: `grep` sobre `qa/guiones` y `qa/lib` da **cero**
`queueTileDecline`, cero `declined`, cero `blocking` y cero referencias al timeout; la única `"n"` es la
del 58 `:166`, que se pulsa **sin propuesta** a propósito (mide que no queda armada).

**→ El issue (b) del plan §7 hay que reencuadrarlo.** Está escrito como «guion nuevo: *la frontera propone
a 16 m y pide UNA vez*», y eso ya lo cubren 05/42/58. Lo que falta —y es lo que este QA deja escrito— es
**la mitad barata**: la `N` (rechazo, memoria, caducidad, esquina), que es la que protege la cartera. El
guion 86 lo cierra. Las tres ramas de reloj (`blocking`, timeout, cooldown) **no las puede medir el banco**
tal como está (ver Hallazgo 4) y se quedan en `test/frontera.test.ts` más esta verificación manual.

**(b) «El cooldown de 15 s tras rechazar no existía; tras N el tile no se re-propone hasta alejarse a
≥ 16 m; los 15 s son tras error del bridge».**
**Cierta, y el error está en el ISSUE, no en el plan.** En la base, `declineProposal()` (`:162-166`) solo
hace `this.declined.add(key)`; `ERROR_COOLDOWN_MS` lo escribe únicamente `onTileError` (`:221`). El plan §4
lo dice bien («rechazo → no re-propone hasta alejarse … cooldown 15 s tras `alError(now)`»); quien lo dice
mal es **#512**, en su título («timeout 5 min, cooldown 15 s») y en su cuerpo: «timeout de la propuesta
5 min, **cooldown 15 s tras rechazar**». Verificado además en el juego (criterios 16, 20 y 21): tras la `N`
la propuesta vuelve por DISTANCIA (alejarse ≥ 16 m), nunca por tiempo; el reloj solo manda tras un error.
→ **Hallazgo 1**: corregir esa frase al cerrar #512, o el próximo que lo lea implementará un cooldown que
nadie pidió.

## Hallazgos

**1 · (menor · prosa · PR — se cierra con el issue) El issue #512 describe mal la regla que esta PR
mueve, y su criterio de cierre no se puede cumplir literalmente.**
Dos frases:
 - «cooldown 15 s **tras rechazar**» (título y cuerpo): no existe ni existió (arriba).
 - «Criterio. `grep -rn 'frontier' nefan-html/src` a 0 salvo el import de core»: hoy ese grep da **9
   líneas legítimas** — la variable `frontier` de las deps y del hook (`__nefan.frontier`, que es contrato
   con cuatro guiones), las llamadas a core, y `frontierBlocksMove` de `collision.ts`, que es de la PR 5.
   El plan ya lo reencuadró a «tokens de la regla `text`», y ahí sí está a cero.
Reproducción: `gh api repos/:owner/:repo/issues/512`. Qué esperaba: que el issue describa la regla que se
movió. **Destino**: el comentario de cierre de #512 desde esta PR, diciendo las dos correcciones.

**2 · (menor · prosa · preexistente en el plan) El plan §2 y §7(b) dan por descubierta la `Y` y por
desnuda la frontera entera.** Detallado arriba. **Destino**: la nota de reencuadre ya escrita aquí; el
guion 86 la ejecuta.

**3 · (menor · conducta · PREEXISTENTE, no de esta PR) El texto del velo que core calcula, el cliente lo
tira.** `Frontera.tick` devuelve `velo = {edge, text}` con tres estados distintos («Zona sin generar» /
«Explorando lo desconocido» / el `narrative_status` del tile), y `frontera-del-jugador.ts:95` hace
`deps.velo(velo?.edge ?? null)`: **nadie lee `text`**. `grep '\.text' nefan-html/src/world/frontera-del-jugador.ts`
→ vacío; `setFrontierVeil(edge)` / `setVeil(edge)` solo reciben el borde. Consecuencia: `alTexto()` y
`#textoDeEstado` existen para alimentar un campo muerto — y el módulo de core llega con **tres tests y una
línea del `porque` de mutación** que cubren texto que el jugador no ve nunca. Idéntico en la base
(`git show 76beb948:…/frontera-del-jugador.ts` hace lo mismo), así que **no es regresión**: es deuda que el
movimiento hereda y hace visible. Para quien juega, el efecto es que **pegado al muro solo se lee «zona sin
generar» en ningún sitio**: la pantalla es niebla y punto (capturas `02` y `03`).
Reproducción: arrancar `e2e-sin-creditos`, nueva partida, andar al este hasta 7 m del borde. Qué esperaba:
que el motivo del muro se lea, o que core no calcule un texto que nadie pinta. **Destino**: issue propio
(dos salidas: pintarlo bajo el velo, o borrar `text`/`alTexto` del contrato de core y con ellos sus tests).

**4 · (importante · banco · preexistente, agravado por esta PR) Tres de las cinco ramas de la única regla
de gasto no las puede ejercer ningún guion, porque el motor falso no se deja conducir desde la página.**
La promoción a `blocking`, el timeout de 5 min y el cooldown de 15 s necesitan un tile que **tarde** o que
**falle**, y eso solo se pide con `TILE_DELAY_MS` / `TILE_MODE=error` en el **entorno del proceso
`fake-ai-server`**, que arranca `qa/run.mjs` y no el guion (`grep TILE_MODE qa/` → cero). Con el motor
falso instantáneo el tile está instalado antes de que el jugador llegue al muro, y un tile que existe ni se
mira: la promoción deja de tener sentido. Lo medí a mano levantando el stack con esas variables (criterios
19, 20 y 21) — lo cual, según la regla del workaround, es un **hallazgo y no un paso de receta**: nadie va a
repetirlo, y `test/frontera.test.ts` no ve el juego. Por qué «agravado»: hasta hoy esas ramas no se medían
en ningún sitio; ahora se miden en core, y el hueco que queda es justo el de extremo a extremo.
**Destino**: issue de banco — un `POST /dev/tiles` en `labs/narrative/fake-ai-server.ts` (junto a
`/dev/reset` y `/dev/api_cache`, que ya existen) que ponga retardo o fallo **en caliente**; con él, los tres
bloques que el guion 86 declara fuera de alcance entran solos.

**5 · (menor · conducta · PREEXISTENTE, no de esta PR) La `Frontera` es de módulo y sobrevive al título:
lo pedido en una partida sigue «pedido» en la siguiente.** `main.ts:301` construye **una** `Frontera` para
la vida de la pestaña; `#pedidos`, `#rechazados` y `#errorEn` no se vacían al volver al título ni al
arrancar otra partida (`grep 'frontier\.' main.ts frontera-del-jugador.ts` menos las seis entradas del autómata → **vacío**:
nadie la resetea, y `session.leave()`, que es como vuelven al título los dos caminos, deshace las facetas de
sesión y no la toca; `git show 76beb948:…/main.ts` hacía igual). Efecto
para quien juega: si en la partida A confirma el vecino del este y sale al título antes de que llegue, en la
partida B **ese borde no se le vuelve a ofrecer hasta que venza el timeout de 5 min**, sin que nada lo diga
— el mundo deja de continuar por ahí y el velo se queda con «Explorando lo desconocido» de una partida que
ya no existe. No lo he ejercido de extremo a extremo (ver «No probado»); es lectura del código más el
comportamiento observado del autómata. **Destino**: issue propio; ahora que el autómata está en core la
cura es trivial y medible (un `olvidarTodo()` con su test, llamado donde muere la sesión), que es
justamente lo que #241 persigue.

**6 · (incidencia de la corrida, no del código) Dos agentes comparten el mismo directorio de scratchpad.**
La batería del agente de `/home/al/code/ne-fan-241-1-qa` escribió en el mismo
`…/273328d5-…/scratchpad/bateria.log` que la mía y lo truncó a mitad; su log dice «disco efímero:
/home/al/code/ne-fan-241-1-qa/…», que es como lo detecté. Interrumpí **mi** runner (PID verificado por
`/proc/<pid>/cwd` = mi árbol; `SIGINT`, que dispara su `trap` y limpia su stack) y repetí la batería con el
log dentro de mi worktree. No toqué nada ajeno; el otro stack (`:3600`, `:10477`, `:19365`) siguió arriba
todo el rato. Sin relación con la PR — se anota porque cualquier medida escrita en ese scratchpad durante
esta ventana es sospechosa.

## Guion nuevo y su negativo

`qa/guiones/86-la-frontera-que-se-rechaza-no-gasta.mjs` (sin commit, en el árbol) + su fila en
`qa/README.md`. Corre **sin `?input=scripted`** (la `N` de la propuesta solo la lee
`KeyboardInputProvider`, tras el mismo gate que la `Y`) y cuenta las peticiones **en el socket** con un
`addInitScript` que envuelve `WebSocket` (molde del 85), porque `__nefan.tileEpisodios` apunta el pedido
pero no su `reason`. `aisla: ["saves","fake-ai"]`, `charMode: "vector"`, cero créditos.

Los 15 asertos verdes, en su orden:

```
✔ el guion corre con el proveedor de TECLADO (la N de la propuesta se lee ahí)
✔ a 19 m del borde no hay propuesta (si la hubiera, el resto del guion no mediría nada)
✔ ocurre: andando hacia el borde, el juego PROPONE generar la zona vecina
✔ la propuesta nace dentro de los 16 m del borde              (15,84 m)
✔ la pregunta ofrece las dos salidas (sí / no)
✔ y hasta aquí NO se le ha pedido nada al motor (la generación no se auto-dispara)
✔ tras la `N` NO sale ninguna petición al bridge: decir que no no gasta
✔ tras la `N` el tile queda apuntado como RECHAZADO
✔ tras la `N` la propuesta se retira
✔ y la pregunta desaparece de la pantalla
✔ acercarse MÁS al borde rechazado no vuelve a preguntar      (a 0,47 m del muro)
✔ y sigue sin salir una sola petición al motor
✔ el jugador NO ha cruzado la frontera sin tile (la retención es real)
✔ a más de 16 m el rechazo se OLVIDA (rechazar no es vetar para siempre)
✔ al volver, el MISMO borde se vuelve a ofrecer                (15,53 m)
✔ rechazar el borde de al lado NO lo veta: el otro vecino se sigue ofreciendo
✔ y el rechazado es exactamente el tile que se rechazó, no los dos
✔ en toda la partida no ha salido UNA sola petición al motor: cuatro `N` y cero gasto
1 en verde · 0 en rojo de 1
```

**Probado en negativo, un sabotaje cada vez y revertido después:**

| Sabotaje | Resultado |
|---|---|
| `frontera.ts` · `rechazar()` sin `this.#rechazados.add(this.#propuesta.key)` | **6 rojos**: «tras la `N` el tile queda apuntado como RECHAZADO — `[]`», «la propuesta se retira», «la pregunta desaparece — `["sí, explorar","no"]`», «acercarse MÁS al borde rechazado no vuelve a preguntar — d=0.52 m», y los dos de la esquina |
| `frontera.ts` · `rechazar()` apuntando también el tile del borde vecino | **2 rojos**: «rechazar el borde de al lado NO lo veta — `null`» y «el rechazado es exactamente el que se rechazó — `["tile_1_0","tile_0_1"]`». Los otros trece siguen verdes: miden otra cosa |
| `frontera-del-jugador.ts` · `deps.frontier.rechazar()` → `deps.frontier.confirmar(ahora, pedir)` (la `N` del cliente confirmando) | **6 rojos**, el primero el que sujeta la cartera: «tras la `N` NO sale ninguna petición al bridge: decir que no no gasta — `[{"tx":1,"ty":0,"reason":"prefetch","edge":"east"}]`» |

La primera versión del guion tenía un cuarto bloque que medía la promoción a `blocking`; salió rojo y la
causa **no** era el código sino el banco (Hallazgo 4), así que ese bloque se sustituyó por el de la esquina
—determinista— y la limitación quedó escrita en la cabecera del guion, en su fila del README y aquí.

## Crítica visual

- **La pregunta** (captura `01`): «¿Explorar hacia el este? Se generará una zona nueva.» con `Y sí, explorar`
  / `N no`. Dice el rumbo, dice que se genera algo nuevo y enseña las dos teclas; se posa justo encima de la
  barra de ataques sin taparla. Es la advertencia de gasto y está bien puesta.
- **El velo** (capturas `02` y `03`): muro cálido, del mismo aire de acuarela que el suelo, con el degradado
  cayendo hasta el horizonte — se lee como niebla del mundo, no como un panel de HUD, y verlo **disiparse**
  (captura `05`, con árboles y camino donde estaba) cuenta «el mundo continúa» sin escribirlo. Es la mejor
  pieza de esta frontera.
- **Fricción, y viene de serie**: a 7,6 m el muro ya ocupa toda la mitad superior del cuadro, y en la esquina
  (captura del 86) cubre casi la pantalla entera. Tras decir que **no**, el jugador se queda mirando eso sin
  una línea que le diga qué hacer — el texto que lo explicaría existe y se descarta (Hallazgo 3). No es de
  esta PR, pero es lo primero que vería un jugador nuevo.

## Workarounds usados

| Qué | Por qué no afecta al jugador | Veredicto |
|---|---|---|
| `__nefan.setPlayerPos` / `setYaw` para colocar al jugador antes de cada tramo | Es la conducción de bench que ya usan 05, 42 y 58; **todo lo medido después se hace andando con `W` y respondiendo con las teclas `Y`/`N` reales**, y la retención contra el muro se afirma con la distancia leída, no forzada | Aceptable |
| Motor falso con `TILE_DELAY_MS=400000` y con `TILE_MODE=error` para ver `blocking`, timeout y cooldown | **NO es aceptable como receta**: es exactamente el Hallazgo 4. El jugador con el motor real tiene esas esperas y esos fallos de serie; el banco no sabe pedirlos | **Hallazgo 4** |
| Espía de `WebSocket` (`addInitScript`) para leer el `reason` de cada `request_tile` | Observa, no altera: `super.send(datos)` siempre. Es la única forma de distinguir `prefetch` de `blocking`, que ni el ledger ni `debugState()` guardan | Aceptable (queda en el guion 86, declarado) |
| Interrumpir mi propio runner con `SIGINT` tras el choque de logs | PID verificado por `/proc/<pid>/cwd`; es el mismo camino que `--parar` y limpió su propio stack | Aceptable (Hallazgo 6) |

## No probado

- **La medida de mutación de `frontera`**: `break: "sin medir"` por diseño; `local` se niega (coste
  desconocido) y la primera medida exige la corrida autorizada 1, que está prevista tras las PR 1-3. Lo que
  sí está comprobado es que el candado obliga a copiarla (criterio 10).
- **Gasto real de créditos**: toda la verificación fue con el motor falso, con el guardarraíl del banco
  confirmando `fake:true` en cliente y bridge. Que un «sí» cueste dinero de verdad no lo he visto, y no
  debía verlo.
- **Hallazgo 5 de extremo a extremo** (la `Frontera` que sobrevive al título): lo deduzco del código y del
  autómata observado, pero no llegué a jugar la secuencia partida A → título → partida B con una petición en
  vuelo. Se declara como lectura, no como medida.
- **El resto de estados del sistema** con la propuesta en pantalla —diálogo abierto, `scene-fade`,
  `narrative-loader`, historial `H`— no los recorrí uno a uno: el gate `propuestaDeTileAbierta()`
  (`main.ts:349`) excluye el diálogo y la falta de sesión, y es idéntico a la base (esta PR no lo toca), así
  que ninguna de esas ramas cambia de conducta con el movimiento. Queda dicho que **no está medido**.

## Batería

`node qa/run.mjs` (batería entera, sin retocar ni un guion; bloque de puertos +200 elegido por el runner,
preset `e2e-sin-creditos`, cero créditos):

```
85 en verde · 0 en rojo de 85 · capturas en /home/al/code/ne-fan-241-2-qa/qa/capturas/2026-09-07T11-34-38-582Z-136578
```

Los 85 son los 84 de `main` **más el 86 nuevo** (el 85 anterior sigue siendo el último de la serie previa;
la numeración no tiene hueco). Cero rojos, cero `⊘`, ninguna repetición suelta necesaria: no hizo falta
volver a correr nada. Los cuatro que ejercen la frontera —05, 10, 42 y 58— entre ellos, verdes y sin tocar.
El runner avisa de que `qa/capturas/ultima` puede apuntar a la corrida del otro agente (Hallazgo 6): las
mías son las del directorio de la línea de arriba.

Y lo demás del ciclo, medido por mí en este árbol:

```
npm run verify         → verify exit=0 · ℹ tests 2215 · pass 2215 · fail 0
npm run coverage && npm run crap -- --check
                       → 1268 funciones medidas · cobertura de líneas 89.1% · complejidad máxima 46
                         Tope (no empeorar): CRAP ≤ 73 — 0 por encima.
                         Cobertura de líneas mínima: 89% — ahora 89.1%.
                         ✔ dentro de los umbrales
npm run deuda          → Mutación — supervivientes · 58 · ⚠️ sin medir 1 de 44 módulos (1 ficheros sin dato)
npm run mutacion -- local frontera
                       → NO se mide aquí: no hay medida previa de frontera… exit=1   (lo esperado)
```

## Dónde están las capturas

- Los ojos de esta validación (propuesta, velo, `N`, muro, `Y`, error del bridge, timeout):
  `/home/al/code/ne-fan-241-2-qa/qa/capturas/qa-2-frontera-ojos/` (`01`…`08`; `qa/capturas/` está
  gitignored, así que viven en el árbol sin ensuciarlo).
- Las del guion 86 en la batería:
  `/home/al/code/ne-fan-241-2-qa/qa/capturas/2026-09-07T11-34-38-582Z-136578/86-la-frontera-que-se-rechaza-no-gasta-*.png`.

## Estado del árbol

`git status --porcelain` tras revertir los cinco sabotajes:

```
 M qa/README.md                                        (la fila del 86)
?? docs/agents/2026-09-07-el-cliente-solo-pinta/qa-2.md  (este informe)
?? qa/guiones/86-la-frontera-que-se-rechaza-no-gasta.mjs
```

Ni el código de producción ni los contratos quedaron tocados: cada sabotaje se revirtió desde su copia y se
comprobó con `git status` antes de seguir. Nada commiteado, como pedía el encargo.
