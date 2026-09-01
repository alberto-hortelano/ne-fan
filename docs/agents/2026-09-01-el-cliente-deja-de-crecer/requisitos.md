# Requisitos — T3 «El cliente deja de crecer» (#358)

> **Medidas tomadas hoy, 2026-09-01, sobre `6c0cf7b`.** Las cifras del cuerpo de
> #358 son de esta misma mañana y **ya están desfasadas**: dice 3.079 líneas y
> hoy son **3.136**. Cada número de aquí abajo lleva el comando que lo produjo.
> Aun así: **re-mídelo antes de usarlo**. En este repo los issues caducan en
> horas, y en las dos tandas anteriores el crítico cazó citas corridas mías.

## La petición del usuario, literal

De la sesión del 2026-09-01. La tanda sale de esta cadena de mensajes:

> «Se ha hecho un analisis de arquitectura y hay nuevos issues, planifica como
> seguir desde aqui»

Sobre esta tanda en concreto, el usuario eligió el alcance entre tres opciones
ofrecidas. Su respuesta:

> **«Candado y primer corte (Recomendada)»**

descrita en la pregunta como: *congelar un candado de tamaño en los valores de
hoy, extraer `nefanHook` a su propio módulo antes de mover nada, y cortar
`gameLoop` + `addTile`* — frente a las otras dos opciones, que eran «solo el
candado» (más barata, no arregla nada hoy) y «el troceo completo de main.ts»
(que arrastraba también `title-screen.ts`, #346).

Y el mensaje que abre la tanda:

> «Ya lo he quitado. Pasa al T3»

**Intención de fondo de toda la serie, vigente desde sesiones anteriores:**

> «Vamos a seguir priorizando reducir el numero de issues»

Con un matiz que el usuario ha confirmado en la práctica esta misma sesión: que
el contador **suba** por escribir un defecto derivado es preferible a que baje
callándolo. Esta tanda cierra 0-1 issues a propósito; se hace porque `main.ts`
está en **uno de cada cinco commits** del último mes y colisiona con todo lo
demás del backlog.

## Decisiones del usuario TRAS leer la crítica (2026-09-01)

La crítica volvió **REENCUADRADA** y abrió tres decisiones que no eran del
arquitecto. El usuario las tomó así:

1. **El candado es un tope GLOBAL, no de tres nombres.** `max-lines` ~400 para
   todo `nefan-html/src`, con excepción declarada y comentada para los **4**
   ficheros que hoy lo superan (`main.ts` 3136, `fps-gl.ts` 1687,
   `title-screen.ts` 1651, `style-apply.ts` 544). Los otros **38 ya están por
   debajo**, así que el coste es de 4 excepciones. Lo que compra: un fichero
   NUEVO nace con tope 400 y el rodeo «me creo `main-2.ts`» queda cerrado — el
   agujero que el crítico señaló en la variante de tres nombres.
2. **Se paga la cobertura de lo que salga a `nefan-core`.** Lo extraído llega a
   **~90 %** con test propio y suelo de mutación declarado. El crítico modeló
   que ~700 líneas al 50 % bajan el global a 88,9 % y ponen **rojo**
   `npm run crap -- --check` contra el suelo de 89: no es una opción dejarlo sin
   medir. Es lo que persigue #241 y el precedente es `session-facets` /
   `mundo-persistido` / `sprite-census`.
3. **#379 y #329 ENTRAN en la tanda** (ver «Alcance», entrega 4).

## El problema

`nefan-html/src/main.ts` concentra game loop, carga de tiles, colisión, diálogo,
viaje, HUD, arranque, título y bootstrap. Y **ningún candado del repo mide
tamaño**: es el único invariante estructural que depende de que alguien se
acuerde. `scripts/deuda.ts` lo declara fuera de alcance por diseño y por escrito
(*«Lo que NINGUNA herramienta mide (trocear un fichero, pluginizar los
controles) no sale aquí»*), así que el troceo tampoco tiene métrica de éxito ni
freno: nada impide que el fichero recupere mañana las líneas que pierda hoy.

## Medido hoy

| Hecho | Medida | Comando |
|---|---|---|
| `main.ts` | **3.136** líneas | `wc -l src/main.ts` |
| `fps-gl.ts` · `title-screen.ts` | 1.687 · **1.651** | idem |
| Los tres sobre el cliente entero | 6.474 / 12.915 = **50,1 %** | `find src -name '*.ts' \| xargs wc -l \| tail -1` |
| `let` a nivel de módulo en `main.ts` | **40** | `grep -c '^let ' src/main.ts` |
| `addTile` | **891-1186 = 296 líneas** | `awk 'NR>=891 && /^}/ {print NR; exit}'` |
| `gameLoop` | **1901-2310 = 410 líneas** | idem desde 1901 |
| Las dos juntas | 706 = **22,5 %** del fichero | — |
| `max-lines` en TODO el repo | **cero ocurrencias** | `grep -rn "max-lines" --include='*.js' --include='*.ts' --include='*.json' . \| grep -v node_modules` |
| Ficheros de `qa/` + `labs/` que leen `__nefan` | **67** | `grep -rln "__nefan" qa/ labs/ \| wc -l` |
| Claves distintas del hook que usan | **37** | `grep -rho "__nefan[?]*\.\([a-zA-Z_]*\)" qa/ labs/ \| sort -u` |
| Guiones de `qa/guiones/` | **56** | `ls qa/guiones/*.mjs \| wc -l` |

### El seam `__nefan`, medido

No es un bloque: son **tres puntos de escritura repartidos por el fichero**.

- `main.ts:565-619` — la definición de `const nefanHook`, y en `:619` el
  `window.__nefan = nefanHook`.
- `main.ts:1259-1420` aprox — un **merge** con `Object.defineProperties` bajo
  `if (import.meta.env.DEV)`, que añade `state`, `npcs`, `objects`, `enemies`,
  `fps`, `setYaw`, `setPlayerPos`, `puedeAtacar`, `ready`, `status`… El
  comentario de `:1258` avisa de por qué es merge y no reemplazo: *«pisar el
  hook dejaba a los benches sin tiles/frontier»*.
- `main.ts:2430` — una tercera asignación suelta: `nefanHook.estilo = …`.

Las claves más leídas por los guiones son `scene` (72 usos), `state` (50), `fps`
(45), `npcs` (35), `status` (30), `enemies` (26), `probeCollide` (22).

**El detalle que decide el orden de las entregas:** casi todas esas claves son
**getters que leen las `let` de módulo por clausura** (`get playerPos() { return
playerPos; }`, `npcs: () => npcEntities.map(...)`). El seam y el estado global
son la misma cosa vista desde dos sitios. Mover una `let` sin re-cablear su
getter deja guiones en rojo o, peor, en `⊘ SIN MEDIR` (exit 2), que no dice nada
del juego.

## Alcance — tres entregas, en este orden

### 1. Candado de tamaño, congelado en los valores de hoy

Que ningún fichero del cliente crezca por encima de donde está hoy.

**Aviso técnico — CORREGIDO por el crítico, que lo ejecutó:** yo escribí aquí
que `arch-rules.json` «no puede contar líneas» y **es falso**. Una regla `text`
con `^(?:[^\n]*\n){3000}` contra el `main.ts` real da **1 violación, no miles**
(con `{4000}`, cero), y `nefan-html/src` ya es root de escaneo con 18 reglas. El
motivo que yo di —que inundaría `npm run deuda`— no ocurre.

El motivo REAL, medido, es otro: el caso **conforme** —el que corre siempre— es
el lento, porque la regex falla por retroceso: **379 ms un fichero, 207 ms los
tres**, en cada `npm test` y cada `npm run deuda`. Y a favor de eslint hay algo
más: reporta *«File has too many lines (3136)»*, **el mismo número que `wc -l`**,
así que el candado y el criterio 2 miden lo mismo. La vía es `max-lines` por fichero en
`nefan-html/eslint.config.js`, cuyo idioma ya está establecido ahí: cada regla
de ese fichero va documentada con su motivo, lo que NO ve y **su coste medido**
(el bloque de `no-floating-promises` llega a citar «2,16 s → 2,68 s el `npm run
lint` entero»). Una regla nueva sin ese comentario desentona.

Decisiones que quedan para el arquitecto: si el tope es global con excepciones
por fichero o solo sobre los tres god-files; si es `error` o `warn`; y si
`deuda.ts` debe aprender a leerlo para que salga en la cola.

### 2. `nefanHook` a su propio módulo — antes de mover nada

Que el seam por el que entran los 67 ficheros de bench deje de moverse cada vez
que se toca el código a su alrededor.

**CORREGIDO por el crítico: el riesgo que yo declaraba no existe, y el orden que
proponía está invertido.** Escribir desde otro módulo una `let` importada es
**`TS2632`** —fallo de compilación que caza `npx tsc --noEmit` en `ci.yml:102`—,
no un guion rojo ni un `⊘`; leerla cruzando módulos funciona (live binding), y
`playerPos`, la clave más leída, es `const` mutado in situ. El riesgo real es
**duplicar** la `let` en vez de moverla: compila limpio y miente en silencio, y
extraer el hook antes no lo cura.

Y hook y funciones **comparten memoria**: 7 `let` las escribe `gameLoop`/`addTile`
y las lee el hook (11 con alcance transitivo), 8 de ellas por **rebind** entero
(`enemyEntities = []`), no por mutación. Además **el hook llama a `addTile`**
(`main.ts:1412`) y ya alcanza ~1.700 líneas hacia delante, que es por qué
`estilo` va suelta en `:2430`. Sacar el hook primero —con `main.ts` sin un solo
`export`— obliga a exportar desde un punto de entrada con efectos de arranque
(ciclo) o a inventar el objeto de contexto que este mismo documento teme.
**Las entregas 2 y 3 no son separables: el orden lo fija el arquitecto.**

Restricción: **las claves VIVAS** del hook siguen respondiendo lo mismo,
incluidas las del bloque DEV. (El hook define 37; el comando de la tabla saca 38
y cuatro no son claves vivas: `noExiste` es una sonda **rota a propósito**
—`qa/esperas-candados-en-negativo.mjs:220`— y `stage` es prosa muerta del
proscenio.) Un guion que hoy lee `__nefan.state().pos` tiene que leerlo igual
después, sin cambios en `qa/`.

### 3. El corte de `gameLoop` (410) + `addTile` (296)

22,5 % del fichero y buena parte de las 40 `let`, que hoy viven a cientos de
líneas de su único consumidor.

**La lógica pura debe irse a `nefan-core/src/`, no quedarse en el cliente.** El
precedente está construido y es reciente: `session-facets`, `entrada`,
`mundo-persistido`, `sprite-census`, cada uno con test propio y suelo de mutación
declarado (`break: 100` en tres; `mundo-persistido` es **80**). Lo que se queda en `nefan-html` nace sin medida (#241: ni una línea del
cliente está medida). Dos avisos verificados: `nefan-core/src/index.ts` **no
sirve** como puerta (re-exporta solo 4 de los 9 módulos de la lista negra
browser-safe), así que se sigue importando por path fino; y cada módulo nuevo
que consuma el cliente debe nacer sin `node:*` **y sin importarlo
transitivamente**, porque la regla mira el import literal, no la clausura.

### 4. Los dos issues que viven dentro del código que se corta

Entran por decisión del usuario. **No son un extra: son la razón de que el corte
sea seguro**, porque mover código con una política duplicada dentro la reparte
en dos módulos en vez de curarla.

- **#379 — `addTile` tiene dos políticas para la misma pregunta.** Al re-emitir
  un tile, NPCs y enemigos con id existente **se conservan** (recrearlos los
  teletransportaría a su spawn stale y perderían el skin en vuelo), mientras que
  objetos y edificios **se empujan siempre** y la purga de arriba los quita
  antes: el efecto neto es que la `Entity` del objeto se recrea entera. Los dos
  razonamientos no pueden ser ambos correctos sobre el mismo bloque. Hoy no
  rompe nada porque la copia nueva sale igual que la vieja — *«no está roto,
  está apoyado en que nadie le ponga estado vivo a un objeto. Eso no es un
  invariante, es una coincidencia»*. #350 (mergeada hoy) esquivó la asimetría y
  hubo que conservar el filtro `!ids.has(o.id)` a propósito. **Elegir UNA
  política y escribirla una vez.**
- **#329 — `tileProposalActive` es el espejo público que #314 dejó en pie.**
  Campo público mutable del `InputProvider` (`input/input-provider.ts:62`) que
  escribe el bucle desde fuera en **tres** sitios (`main.ts:1827`, `:1890`,
  `:1911` — todos dentro de `gameLoop`), con la copia muda de siempre en
  `scripted-input-provider.ts:23` (0 lecturas) y cuatro lecturas reales en
  `keyboard-input-provider.ts` (`:79`, `:83`, `:175`, `:179`). El arreglo ya
  está escrito y probado en #314: **el provider PREGUNTA a su dueño** en vez de
  guardar copia (`InputDeps.dialogoAbierto()` es el precedente). Aviso del
  propio issue, a medir antes de copiar: en #314 el dueño (`dialoguePanel`) ya
  existía; aquí sería la `proposal` del bucle, y hay que comprobar que es
  consultable desde donde se construye el provider sin invertir una dependencia.
  **De propina, en el mismo hook**: la clave `dialogueActive` (`main.ts:1220`)
  se quedó **sin un solo lector** tras #328 — se retira o se declara que es para
  inspección manual.

## Criterios de aceptación

1. Existe un candado ejecutable con **tope global ~400** sobre `nefan-html/src`
   y excepción declarada para los 4 ficheros que hoy lo superan; **un fichero
   nuevo de 500 líneas se pone rojo sin tocar nada más**. Está **probado en
   negativo** (se ha visto ponerse rojo, no solo verde) y cada excepción lleva
   su número de hoy y su motivo, en el idioma que ya usa `eslint.config.js`.
2. `nefan-html/src/main.ts` baja de 3.136 líneas de forma medible, y el número
   nuevo queda congelado en el candado.
3. **Las claves vivas de `__nefan` responden lo mismo que antes.** `node qa/run.mjs`
   completo en verde **antes y después de cada entrega**, con **0 rojos y 0
   `⊘`** — un `⊘ SIN MEDIR` cuenta como fallo, no como aprobado.
4. La lógica extraída que sea pura vive en `nefan-core/src/` con test propio y
   entra en `mutation-targets.json` con un suelo declarado; lo que se quede en
   el cliente va con su motivo escrito.
5. `npm run verify` verde **y `npm run coverage && npm run crap -- --check`
   verde** contra el suelo de 89 %. Ojo: `npm run verify` **no** corre `crap` ni
   `coverage` (lo midió el crítico), así que es la única puerta que este trabajo
   puede tirar y hay que abrirla a mano. Los items nuevos de `npm run deuda` que
   salgan de **código recién medido se declaran, no se evitan**: medir lo que
   nadie medía produce deuda, y esa es la buena noticia.
6. #379 y #329 cerrados: una sola política en la carga de tile, y
   `tileProposalActive` sin espejo (el provider pregunta a su dueño).

**Aviso sobre el criterio 3, y es el que más importa:** el CI del cliente es
`tsc + lint + build` (`ci.yml:102-104`) y **da verde con `main.ts` partido en
trozos que no arrancan**. `nefan-html` no tiene script `test` y no entra en
mutación. La única red real de esta tanda es `qa/run.mjs`, que el runner **no
ejecuta**: la corrida es local y hay que decirlo en la PR.

## Conflictos conocidos — todos verificados hoy, todos `open`

- **#379** (`addTile` recrea los objetos y conserva los NPCs: dos políticas para
  la misma pregunta) vive **dentro** de la función que corta la entrega 3. Lo
  abrí yo esta tarde. Decidir explícitamente: o entra, o el corte lo deja
  intacto y se dice por escrito.
- **#378** (`WorldScene = Record<string, unknown>`) es el tipo que atraviesa
  `addTile` y el getter `scene` del hook, la clave más leída de todas (72 usos).
  Tipar al pasar es tentador; es otra tanda y ensancharía el diff sin freno.
  Dicho con honestidad: **su cuerpo reclama prioridad** («el orden natural es
  tipo primero»). Aparcarlo puede estar bien; callar que lo reclama, no.
- **#346** (trocear `title-screen.ts`) y **#359** (el cliente importa 36 módulos
  internos del core) son la continuación natural. **Fuera de esta tanda**: el
  candado los deja frenados y medibles, que es justo el objetivo.
- **#329 — lo encontró el crítico, no estaba en mi lista.** Sus tres escrituras
  caen **dentro de `gameLoop` (1901-2310)** y su retirada de `dialogueActive`
  **dentro del bloque DEV del hook**: choca con las entregas 2 y 3 a la vez.
- **#241** (ni una línea de `nefan-html` está medida) es la causa de que el
  criterio 3 dependa de `qa/`. No se arregla aquí.

## Fuera de alcance

Trocear `title-screen.ts` o `fps-gl.ts`; tipar `WorldScene`; dar cobertura al
cliente; tocar el resto de las 40 `let` que no arrastren `gameLoop`/`addTile`.
