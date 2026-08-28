# Crítica — El cliente tras el título (#310 #311 #312 #260 #268)

**TANDA EN CONFLICTO: los cinco no cuestan lo mismo, y dos comparten un bloqueo que no está en el documento.**
#310 y #260 son cierres de minutos. #268 y #312 chocan con lo mismo: **`nefan-html` no tiene harness de test**
(sin script `test`, sin `test/`, sin vitest — verificado), así que «los dos casos con test» y «ejercido» no
tienen aparato, y montarlo zanja de refilón la pregunta abierta de #241. #311 es tres veces lo que declara. Las
citas de `requisitos.md`, re-medidas: **exactas**, salvo `narrative-client.ts:66` (el descarte está en `:63-69`).

| Issue | Veredicto | En una línea |
|---|---|---|
| #310 | **VIGENTE, alcance acotado** | Solape real, derivable de un aserto que ya pasa; hay que prohibir la salida 3 |
| #260 | **REENCUADRADA** | De las seis, **una** muerde. La clase de bug que promete el criterio 3 **no existe** |
| #268 | **REENCUADRADA** | No es bug vivo (proyecto Chrome-only) y medio criterio 4 **nace verde** |
| #311 | **REENCUADRADA (mayor)** | 12 sitios, no 4; `data-dialogo` **mueve** el defecto silencioso, no lo elimina |
| #312 | **VIGENTE, mal medida** | El efecto es peor (teletransporta) y ejercerlo es la mitad cara de la tanda |

## La premisa, afirmación por afirmación

**#260 · «6 violaciones»** — CIERTO y exactas: activé la regla, `npx eslint src` → 6 errores en
`:531 :851 :958 :1050 :1121 :1196` (config restaurada, `git status` limpio). Clasificados, que era el trabajo
que el issue pedía hacer antes de tocar nada:

| Línea | ¿`await` fuera del `try`? | ¿Botón muerto? | Veredicto |
|---|---|---|---|
| 531, 851, 958, 1121, 1196 | no: cuerpo entero en `try/catch` | no: `:531` no deshabilita y las otras cuatro rehabilitan en su `catch` | no pierden nada |
| **1050 subir estilo** | **SÍ** — el `await` del `FileReader` va antes del `try` | no (aún no había deshabilitado) | **BUG: click mudo** |

**Una de seis muerde, y no por donde predice el documento.** El criterio 3 promete `finally` «a las que dejaban
un botón muerto»: **ninguna lo deja**, ese medio criterio **nace verde**. Lo que sí se pierde es `:1050`: si
`FileReader` falla, el rechazo sale del handler y no hay `unhandledrejection` (`async-ui.ts:6`) — se pulsa
«Subir» y no pasa nada: #181 otra vez. Coste de la regla: **2,22 s → 2,57 s** (el bloque ya es type-checked
desde #248; los «2,90 s» del issue son del set entero, no de esta regla).

**#268 · «el caso vivo es `requestPointerLock()`»** — MEDIO CIERTO. Único llamante, `main.ts:1329`; Firefox
devuelve `undefined`, pero CLAUDE.md declara el hardware «Chrome/Chromium» y el issue lo llama latente. Y
**`paso(42, …)` ya lanza hoy** (`(42).catch` no es función): un test que solo afirme «lanza» pasa antes y
después — **criterio 4, segunda mitad, nace verde**; solo `paso(undefined)` puede ponerse rojo.

**#310 · «a 500 px lo tapa al 100 %»** — CIERTO, y derivable sin arrancar nada. `#title-screen` es
`fixed; z-index:9999` (`title-screen.ts:197,215`); `#dev-status` es `z-index:10000`, opaco, desde `y=0`, con
`max-height:var(--dev-status-alto)` = **86 px** (`dev-ui.css:12-30`, `base.css:49`); `#ts-close` es `top:12px`,
~26 px → `y≈12..38`. Y `qa/guiones/33-…:114` **ya afirma** `devScroll + 10 > 96`: a 500×480 el panel supera la
cota y se pinta a 86 px, y `0..86` contiene `12..38` — **100 %**. Matiz omitido: **no es del jugador**, se
anuncia `✕ cerrar (modo fixtures, sin sesión)` (`title-screen.ts:271`) y sigue alcanzable con Tab+Enter.

**#311 · «cuatro sitios y un escritor único»** — **CORTO**: 4 escrituras (`main.ts:1376 2111 2124 2441`) + la
lectura del hook de bench (`:1148`) + el campo de la interfaz (`input-provider.ts:61`) + la segunda
implementación (`scripted-input-provider.ts:23`) + 3 lecturas (`keyboard-input-provider.ts:50,118,159`) + 1
(`dev-tools-input.ts:26`) + `DevToolsDeps` y su cableado = **12 sitios**.
**Y la alternativa no cierra lo que promete.** `titulo-manda.ts` no es seguro por ser un atributo, sino porque
**el CSS lee el mismo atributo** (`html[data-titulo="1"] #game-ui{display:none}`) y olvidarlo tiene síntoma
visible. Para el diálogo **no hay ninguna regla CSS sobre atributo de raíz** — grep a cero: un `data-dialogo`
sin lector CSS reproduce el defecto rechazado en `puerta-de-teclado.ts:31` («no hay diálogo», en silencio),
«escritor único» sería **prosa** (nada en `arch-rules.json` lo canda, tampoco para `marcarTitulo`) y sería una
**tercera** representación junto a `dialoguePanel.isVisible` (14 usos) y `#dialogue-panel[hidden]`. **El
argumento bueno es otro**: `dialogueActive` es un espejo a mano y `session.leave()` **no lo resetea** —
`FacetSinks` (`session-facets.ts:134-149`) tiene siete sinks y ninguno es la entrada: la forma del bug de #249
que ese módulo existe para impedir. Honestidad: **hoy no diverge** ni **hallé camino alcanzable** —
`volverAlTitulo` solo sale de `loaderBack` (`main.ts:2235`), y ese overlay no se abre con un diálogo delante.

**#312 · «un `ready` puede desbloquear la interfaz»** — CIERTO **y corto**. De `narrative-client.ts:72` a
`main.ts:2238`: un `ready` ajeno hace `hideLoader()` (`:2285`, `:2308`), falsea `tileLedger.llegado` (`:2270`) y,
con `spawn`, **escribe `playerPos.x/z`** (`main.ts:2257-2261`) — no «desbloquea»: **teletransporta al jugador de
la partida viva**. `sessionChangedError` (`bridge/handlers/tile.ts:116`) impide que un job relevado difunda, así
que la ventana queda en los frames **ya en vuelo**: la que midió #282 para `narrative_event`, mismo transporte y
misma lista de suscriptores. **No es inalcanzable**, luego «cerrar declarándolo» no vale sin ejercerlo — y
ejercerlo pide un **guion de navegador nuevo** (el espía de `qa/guiones/29-…:71` solo lee).

## El día después, conflictos y coste

- **Para quien juega no cambia nada** salvo el click mudo de `:1050` y, si se confirma, el teletransporte de
  #312. Es higiene y está bien que lo sea; lo insostenible es venderla con «el jugador nota #310».
- **La salida 3 de #310** (que la barra no se pinte con el título delante) deja sin sujeto medio `qa/guiones/33-…`
  (`contenidoY >= devBottom` en `:130`, `--dev-status-alto` en `:203`) y mata la reserva de `base.css:68`:
  **re-litiga #250**. La salida 1 (mover `#ts-close`) no choca con nada.
- **#268 y #312 × #241**: #241 deja abierta la pregunta «harness propio o mover a core» y dice que la segunda
  «encaja con *lógica en core, el cliente solo pinta*»; montar vitest aquí para dos asertos de `paso()` **la
  contesta sin debatirla**, y core no puede importar del cliente (`core-src-no-importa-bridge-ni-cliente`).
- **#311 × «candado, no prosa»**: «un escritor único» sin regla en `arch-rules.json` es la prosa que ese principio
  prohíbe; y a medias nadie borrará `InputProvider.dialogueActive` ni la copia del provider scripted.
- **Agujero del criterio 7**: `npm run verify` de core **no lintea `nefan-html`** — #260 solo se verifica con
  `cd nefan-html && npm run lint` o el job `ci.yml:79`.
- Los cinco **no se pisan** entre sí. **Coste**: #260 vale (+0,35 s, candado permanente) aunque el daño sea un
  sitio; #310 salida 1 vale; #268 es código trivial con criterio caro; **#311 no cabe como cierre barato** y
  **#312 es el más caro de los cinco, no el más barato**.

## Qué cambiarle a `requisitos.md`

- **Criterio 3 (#260)** → «Regla activada y en verde. De las seis, **solo `:1050` pierde el rechazo**; las otras
  cinco se ajustan por la regla, **no porque muerdan**, y **no necesitan `finally`**. Verde = `npm run lint` en
  `nefan-html`.»
- **Criterio 4 (#268)** → «`paso(undefined, …)` no lanza y registra; `paso(42, …)` falla con un mensaje que nombra
  el contrato — **`paso(42)` ya lanza hoy**, así que "lanza" nace verde. **Dónde vive ese test es de #241.**»
- **Criterio 5 (#311)** → «Son **12 sitios**, no 4, y `data-dialogo` **no** elimina el defecto silencioso: sin
  lector CSS, olvidarlo vuelve a ser "no hay diálogo" en silencio. El criterio real: **olvidarse no puede
  compilar o no puede pasar un candado**, y `dialogueActive` deja de ser un espejo sin sink en facetas.»
- **Criterio 6 (#312)** → añadir: «Medir también el `spawn`: un `ready` ajeno con `spawn` **escribe `playerPos`**
  (`main.ts:2257-2261`). `sessionChangedError` estrecha la ventana pero **no la cierra**: cerrar declarando la
  asimetría exige evidencia, no ausencia de evidencia.»
- **A "Lo que NO es de esta tanda"** → «**La salida 3 de #310**: deja sin sujeto medio `qa/guiones/33-…` y mata la reserva de `base.css:68`. #310 se cierra moviendo `#ts-close` fuera de la banda superior.»
