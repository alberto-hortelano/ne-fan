# El cliente tras el título — #310 #311 #312 #260 #268

## La petición, literal

> «Vamos a seguir priorizando reducir el numero de issues»

Y, elegida entre cuatro tandas ofrecidas con su coste medido:

> «El cliente tras el título (5)»

Descripción que el usuario leyó al elegir, y que por tanto es parte de la petición:

> «#310 #311 #312 #260 #268. Cinco cierres, todo en nefan-html, mismo par de ficheros que
> tocamos ayer y con el contexto fresco. La más barata por cierre. Contra: es higiene — el
> jugador nota #310 (no puede cerrar el título en ventana estrecha) y poco más.»

**El objetivo declarado es el NÚMERO de issues cerrados**, con la calidad de siempre. Cerrar
cuatro de cinco y dejar el quinto «anotado para más adelante» es fallar la petición. Si uno
resulta ser más caro de lo medido, se dice y se decide — no se abandona en silencio.

## Contexto que el equipo no puede adivinar

Los cinco salen de la tanda de AYER (#307, `cc3cd54`, mergeada esta mañana): cuatro los abrió
QA o el ingeniero al validarla, y uno (#260) lo midió el crítico el 25-ago. **Ninguno lo
introdujo aquella rama** — los cuerpos lo dicen y lo verifiqué.

Hoy se censaron los 36 issues abiertos contra el código. Resultado: **ninguno está caducado
entero**. Pero **nueve tienen el cuerpo mintiendo en datos concretos** (líneas desplazadas,
cifras viejas, rutas que nunca existieron). Dos de esos nueve tocan esta tanda de refilón y
están corregidos abajo. La lección de ayer, que costó una tanda mal encuadrada:
**una referencia `fichero:línea` caduca, y la contigüidad no es un mecanismo.**

## Lo medido hoy, sobre `cc3cd54`

Todo lo que sigue lo verifiqué yo ejecutando, no leyendo. Lo que NO medí va marcado.

### #260 — seis promesas entregadas a quien las ignora

Activé `@typescript-eslint/no-misused-promises` en `nefan-html/eslint.config.js` y corrí
`npx eslint src`; restauré la config después (árbol limpio, verificado con `git status`).

**6 violaciones exactas, las seis en `src/ui/title-screen.ts`**: `:531`, `:851`, `:958`,
`:1050`, `:1121`, `:1196`. Las seis son la misma forma:
`addEventListener("click", async () => { … })`.

El issue avisa, y es la parte que hay que medir antes de tocar nada: **seis sitios no son seis
bugs**. Un handler `async` con el cuerpo entero en `try/catch` no pierde nada. Lo que hay que
mirar en cada uno, y no está medido todavía:

1. ¿hay algún `await` FUERA del `try`? Ahí el rechazo se pierde de verdad.
2. ¿el `catch` rehabilita el botón? Varios hacen `btn.disabled = true` antes del `try`
   (`:851`, `:1121`, `:1196` al menos) y **sin `finally` un fallo deja el título muerto** —
   eso sí lo nota quien juega.

**Gotcha heredado de #248, escrito en el cuerpo del issue**: el bloque type-checked hay que
acotarlo con `files: ["src/**/*.ts"]` — `vite.config.ts` y `eslint.config.js` están fuera del
`include` del tsconfig y un `projectService` global los pone rojos.

### #268 — `paso()` asume que le dan una promesa

`nefan-html/src/ui/async-ui.ts:23-33`. La firma pide `Promise<unknown>` y el cuerpo hace
`promesa.catch(…)` directo. El caso vivo es `requestPointerLock()`, que **no devuelve promesa
en todos los navegadores**: donde devuelva `undefined`, esto lanza `TypeError` en cada click
sobre el lienzo.

El arreglo va **en `paso()`, no en los llamantes**. Y ojo al fail-loud, que es la parte fácil de
hacer mal: `undefined` es el caso tolerado; **cualquier otra cosa que no sea promesa es un error
de programación y tiene que gritar**, no tragarse. Los dos casos no son el mismo.

### #310 — la barra de dev tapa el botón de cerrar

`#dev-status` (`z-index: 10000`) se pinta sobre `#ts-close` (`title-screen.ts:270`). **A 500 px
de ancho lo tapa al 100 %**: no hay forma de cerrar el título con el ratón.

El dato que cierra la discusión, medido por QA ayer: la cota `--dev-status-alto` (86 px, la que
pusimos ayer) **no influye** — el daño va con el alto real del panel, ≥ 54 px siempre, mayor que
los 38 px de `#ts-close`. Bajar la cota no lo arregla.

**Una salida está descartada con medida, no con opinión**: meter el overlay en `#app-shell` da
**Δ 55 px** de salto del botón «Nueva partida», más del doble del bug de 24 px que #250
resolvía. Se midió ayer en #307. No se vuelve a proponer.

### #311 — el gate del diálogo, duplicado

Tras #285 hay una puerta única de teclado (`src/input/puerta-de-teclado.ts`), pero el gate del
diálogo sigue en dos sitios:

- `src/input/keyboard-input-provider.ts:50` — `if (this.dialogueActive) return;`
  (y `:118`, `:159` lo consultan otra vez)
- `src/input/dev-tools-input.ts:26` — `if (deps.isDialogueActive()) return;`

`DevToolsDeps` (`dev-tools-input.ts:12-14`) y su cableado en `main.ts:492` existen **solo** para
transportar ese predicado.

**Por qué NO se bajó a la puerta en #307, y el argumento se aceptó** (está escrito en
`puerta-de-teclado.ts:31`): el gate del título la puerta lo lee sola de `data-titulo`, la misma
fuente que el CSS; el del diálogo vive en `input.dialogueActive`, que escribe `main.ts`. Bajarlo
exigiría un canal de configuración **cuyo defecto, si alguien olvida cablearlo, es "no hay
diálogo"** — o sea movimiento y ataque activos durante una conversación, en silencio.

La alternativa que sí lo cierra, y que es la misma jugada que `titulo-manda.ts`: que el estado
de diálogo sea **legible del DOM** (`data-dialogo` en el raíz, un escritor único) y la puerta lo
lea sola. Medido: hoy `main.ts` escribe `input.dialogueActive` en **`:1376`, `:2111`, `:2124`,
`:2441`** — cuatro sitios, y un escritor único tiene que absorberlos.

### #312 — el sello que no se filtra

`narrative_status` **lleva** el sello de sesión desde #282, pero el cliente solo filtra los
eventos: `src/net/narrative-client.ts:66` descarta `narrative_event` ajeno; `:72` registra
`narrative_status` sin mirar el sello.

Se dejó así **a propósito y por una buena razón**: descartar un `narrative_status` ajeno es
descartar también un `phase: "error"`, y un error de una sesión recién muerta tirado en silencio
es justo el fail-loud que CLAUDE.md prohíbe.

Su criterio de cierre tiene dos mitades y **la primera es lo primero que hay que hacer**:

> Un `ready` de una sesión muerta no puede desbloquear la interfaz de la sesión viva, **y** un
> `error` de una sesión muerta sigue llegando a quien juega. Hoy no se sabe si lo primero puede
> pasar: **nadie lo ha ejercido**, y ese es el primer trabajo del issue, antes de decidir nada.

O sea: **ejercerlo primero**. Si resulta que no puede pasar, el issue se cierra declarándolo
—su propio cuerpo lo admite como salida legítima— y esa es una entrega, no una rendija.

## Reencuadre tras la crítica — leer ESTO, no la sección de medidas de arriba

La crítica midió los cinco y la tanda **no es la que se vendió**. El usuario ha visto el
reencuadre y ha elegido **«Los cinco, reencuadrados»**: se hacen los cinco, con estos alcances y
no los que decía la primera versión de este documento. Lo de arriba se conserva porque las
medidas siguen siendo ciertas; los CRITERIOS válidos son los de abajo.

Cuatro correcciones que hay que tener presentes todo el rato:

1. **#312 es el más caro de los cinco, no el más barato — y es el único bug de jugador.** Un
   `ready` ajeno no «desbloquea la interfaz»: con `spawn` **escribe `playerPos.x/z`**
   (`main.ts:2257-2261`), o sea **teletransporta al jugador de la partida viva**. Además hace
   `hideLoader()` y falsea `tileLedger.llegado` (`:2270`). `sessionChangedError`
   (`bridge/handlers/tile.ts:116`) estrecha la ventana a los frames YA EN VUELO —la misma que
   #282 midió para `narrative_event`— pero **no la cierra**.
2. **De las seis de #260, solo `:1050` muerde**: el `await` del `FileReader` va **antes** del
   `try`, así que subir un estilo con un fichero ilegible es un click mudo (#181 otra vez). Las
   otras cinco tienen el cuerpo entero en `try/catch` y las cuatro que deshabilitan un botón
   **ya lo rehabilitan en su `catch`**.
3. **#311 son 12 sitios, no 4**, y la alternativa del `data-dialogo` **no elimina el fallo
   silencioso: lo mueve**. `titulo-manda.ts` es seguro porque **el CSS lee el mismo atributo**
   (`html[data-titulo="1"] #game-ui{display:none}`) y olvidarlo tiene síntoma visible; para el
   diálogo **no hay ninguna regla CSS sobre atributo de raíz** (grep a cero), sería una **tercera**
   representación junto a `dialoguePanel.isVisible` (14 usos) y `#dialogue-panel[hidden]`, y
   «escritor único» sin regla en `arch-rules.json` es justo la prosa que este repo prohíbe.
4. **`nefan-html` no tiene harness de test** — sin script `test`, sin `test/`, sin vitest. El
   usuario ha decidido **no montarlo en esta tanda**: montar vitest aquí contestaría de refilón la
   pregunta abierta de #241 sin debatirla. Así que lo que se verifica, se verifica con **tipos,
   lint, candados de `arch-rules.json` y guiones de `qa/`** — y donde eso no alcance, se dice.

## Criterios de aceptación (los válidos)

1. Los cinco issues cerrados, cada uno con la evidencia de lo que se hizo (commit y línea).

2. **#310** — `#ts-close` deja de estar bajo la banda superior. Verificado a **500 px de ancho**
   con la barra de dev visible, no a 1280. Derivación que ya existe y no hay que repetir a mano:
   `qa/guiones/33-…:114` afirma `devScroll + 10 > 96`, o sea que a 500×480 el panel se pinta a su
   cota de 86 px, y `0..86` contiene el `12..38` de `#ts-close` — solape del 100 %.
   **La salida 3 está PROHIBIDA** (ver abajo). Matiz que no cambia el arreglo pero sí el texto de
   cierre: ese botón **no es del jugador**, se anuncia `✕ cerrar (modo fixtures, sin sesión)`
   (`title-screen.ts:271`) y sigue alcanzable con Tab+Enter.

3. **#260** — `no-misused-promises` activada en `nefan-html/eslint.config.js` y en verde, sin
   silenciar ni exceptuar. **Solo `:1050` cambia de comportamiento**; las otras cinco se ajustan
   a la regla porque la regla lo pide, **no porque muerdan**, y **no llevan `finally`** — la clase
   de bug que la primera versión de este documento prometía arreglar **no existe**, lo midió el
   crítico. Verde = `cd nefan-html && npm run lint`. Coste medido y aceptado: **2,22 s → 2,57 s**.

4. **#268** — `paso(undefined, …)` no lanza y deja rastro; cualquier otra cosa que no sea promesa
   grita con un mensaje que nombre el contrato. **`paso(42, …)` ya lanza hoy** (`(42).catch` no es
   función), así que «lanza» nace verde y no sirve como criterio. Lo que sí puede ponerse rojo es
   `paso(undefined)`. Sin harness donde escribir ese test, **la garantía tiene que estar en el
   tipo**: si la firma admite `Promise<unknown> | undefined` y nada más, `paso(42)` deja de
   compilar y el candado es `tsc`, no un test que no existe. Si el arquitecto ve una vía mejor,
   que la argumente; lo que no vale es «queda verificado» sin nada que pueda ponerse rojo.

5. **#311** — el criterio NO es «borrar `DevToolsDeps`». Es: **olvidarse no puede compilar, o no
   puede pasar un candado**. El hallazgo bueno de la crítica es otro y ese sí se arregla:
   `dialogueActive` es un espejo a mano y **`session.leave()` no lo resetea** — `FacetSinks`
   (`nefan-core/src/narrative/session-facets.ts:134-149`) tiene siete sinks y la entrada del
   diálogo no es ninguno, que es la forma exacta del bug de #249 que ese módulo existe para
   impedir. Honestidad que hay que preservar en el cierre: **hoy no diverge** y el crítico **no
   halló camino alcanzable** (`volverAlTitulo` solo sale de `loaderBack`, `main.ts:2235`, y ese
   overlay no se abre con un diálogo delante). El issue se cierra con el sink puesto **y** con la
   razón escrita de por qué NO se baja el gate a la puerta.

6. **#312** — ejercido de verdad, con el `spawn` incluido: hay que **medir** si un `ready` ajeno
   con `spawn` mueve al jugador, no deducirlo. Con el resultado delante, se filtra de forma que
   **un `ready` ajeno no toque `playerPos` ni el loader, y un `error` ajeno siga llegando a quien
   juega**. Cerrar declarando la asimetría exige **evidencia, no ausencia de evidencia**.
   **Coste que está escrito en el código y hay que respetar** (`narrative-client.ts:78-82`): quien
   añada aquí un segundo filtro tiene que tocar también `labs/narrative/replay-server.mjs`, que
   reestampa el sello justo de lo que ese embudo descarta — si no, `replay-web` reproduce una
   película que el cliente tira entera y se queda en negro.

7. `npm run verify` verde y `node qa/run.mjs` sin rojos. **Dos agujeros que tapar**: `npm run
   verify` de core **no lintea `nefan-html`** (para #260 hace falta `cd nefan-html && npm run
   lint`, o el job `ci.yml:79`), y **el CI no corre la batería** — la corre el coordinador.

8. La deuda no sube: `npm run deuda` contra la de `main` (hoy 66 items / 15 fronteras congeladas).

## Lo que NO es de esta tanda

- **#306** (errores que saltan solos durante el título). Su propio cuerpo explica por qué no
  cabe: no tiene candado barato y es la forma exacta de #241.
- **#308** (el guion 22 intermitente). Hoy encontré material nuevo que NO está en el issue y que
  hay que anotar allí, no arreglar aquí: `src/renderer/fps-renderer.ts:255-264` devuelve
  `pitchDeg: 0` como valor por defecto y luego hace `...(this.gl?.debugState() ?? {})`, así que
  **con el GL sin cargar el 0 es inventado**, indistinguible de una mirada horizontal real — y
  `qa/guiones/22-…:70` consume justo ese campo. Además hay dos fuentes de pitch que pueden
  divergir: `fps()` da la de la cámara redondeada (`fps-gl.ts:1552`), `state()` da `playerPitch`
  sin redondear (`main.ts:1146`).
- Reabrir el sitio del overlay del título. Medido y descartado (Δ 55 px).
- **La salida 3 de #310** — que la barra de dev no se pinte con el título delante. Deja sin
  sujeto medio `qa/guiones/33-…` (`contenidoY >= devBottom` en `:130`, `--dev-status-alto` en
  `:203`) y mata la reserva de `base.css:68`: es **re-litigar #250** dentro de una tanda que se
  eligió por ser barata. #310 se cierra moviendo `#ts-close` fuera de la banda superior.
- **Montar el harness de test de `nefan-html`.** Decisión explícita del usuario en esta tanda. La
  pregunta «harness propio o mover a core» es de #241 y se debate allí, no de refilón aquí.
- **Bajar el gate del diálogo a la puerta de teclado.** Ver criterio 5: la alternativa mide peor
  que el problema. Lo que se hace es el sink.
