# Crítica — tanda BB (#731 #673)

**Veredicto: #731 REENCUADRADA · #673 REENCUADRADA (va detrás de #731 y en la misma tanda)**

Es un solo fallo, pero el triaje se equivoca al decir de qué: **el home no se repinta**.
Lo que pasa es que **el SELECTOR se vuelve a pintar ENCIMA del home**. Es un defecto
del producto y se arregla en el producto. No hay que tocar el banco.

## El problema real, en una frase

Cuando termina la pre-generación, el título vuelve a pintar el selector de mundos
aunque el jugador ya se haya ido de él. Se pisa la pantalla a la que el jugador acaba
de ir, y el clic que venía detrás se pierde.

## La premisa, afirmación por afirmación

- *«`home.ts:103` vuelve a crear el botón en cada repintado»*: la línea existe
  (`home.ts:118` escribe `innerHTML` con el esqueleto de `:99-109`). Pero entre «Volver»
  y el clic **no hay un segundo `pintarHome`**. Medido: un solo `pinta-home` por vuelta.
- *«el home se repinta dentro de un `paso()` async debajo del click»* (#731): la
  mecánica es cierta, pero el pintado es el de otro. En `title-screen.ts:148-156`, el
  oyente de `game_gen` mira `#ts-gen` y `chasis.visible` cuando **llega** `ready` y
  lanza `pintarElSelector`. Ese pintado espera a `listGames()`
  (`selector-de-mundo.ts:174`) y luego escribe `content.innerHTML`
  (`selector-de-mundo.ts:193`) **sin volver a mirar** qué pantalla hay delante.
- *«`esperarTituloListo` solo espera a que haya texto»* (`sesion.mjs:177-183`): es
  cierto, pero no es la causa. Si esperara «quieto», lo que haría es tapar el defecto.
- **Medido hoy** (stack `e2e-sin-creditos` propio, sonda Playwright con
  MutationObserver sobre `#ts-new`/`#ts-gen`/`data-gen-phase`, 0 créditos, sobre f25da654):
  - *Flujo del banco, 4 vueltas.* El repintado del selector cae entre 12 y 20 ms
    después de `ready`. El banco ve `ready` entre 4 y 31 ms y su clic en `#ts-back`
    cae entre 43 y 89 ms. Casi siempre el repintado gana la carrera y no pasa nada.
    Cuando «Volver» llega antes de esos ~15 ms, el selector aplasta al home. Si eso
    ocurre mientras `page.click("#ts-new")` ya tiene el nodo, sale el *detached* de
    #731. Si ocurre antes, `#ts-new` ya no está y el clic expira, que es el rojo de
    #673. Son las dos caras de la misma carrera.
  - *Forzado, 3 de 3.* Pulso «Volver» en la misma tarea que publica `ready`: se pinta
    el home (+0 ms) y el selector lo aplasta entre +13 y +19 ms. La pantalla final es
    el SELECTOR, con el jugador habiendo pulsado Volver. Es determinista.
- *«Puede que también le pase al jugador»*: **sí, y es algo más que un clic perdido.**
  «Volver» se deshace solo. La ventana dura lo que tarde `listGames()`: unos 15 ms en
  local, y hasta el timeout de la petición con el bridge cargado. Por el código, la
  misma carrera alcanza a cualquier salida del selector dentro de esa ventana
  («Continuar», «Subir estilo»), no solo a «Volver». Esto último no lo he medido.
- **#673.** El rojo cae en el mismo sitio (`#ts-new`, tras la pre-generación) y con el
  mismo `regenerarMundo` → `nuevaPartida` (`15-…mjs:305-306`). El «4 de 21 contra
  0 de 11» no separa las dos versiones: con Fisher unilateral da p ≈ 0,17. Además, #731
  ve la misma frecuencia (≈1/9) sin tocar nada. La exención
  (`esperas-por-fotogramas.json:29-33`) ya descartó #659 midiendo. Lo que le faltaba
  era esta vía, y la vía no pasa por `encarar()`. Lo que sigue vivo de #673 es devolver
  la 17ª espera al helper y borrar la exención.

## El día después

- Para el jugador: «Volver», «Continuar» y los demás botones hacen lo que dicen
  aunque la pre-generación termine en ese mismo instante.
- El banco se queda como está y deja de ver el rojo de 07, 15, 123 y 160 en ese punto.
  Sale de la batería una intermitencia (#634).
- Una espera de «título quieto» en `sesion.mjs` sería lo que nadie borra después: una
  regla sin sujeto, que taparía también la próxima vez que otra pantalla pinte encima.
  **No debe hacerse.**
- Tampoco sirve «no recrear `#ts-new`». No arregla nada, porque al home no se le
  recrea nada: se le sustituye.

## Conflictos

- **Tanda AZ.** Toca `sesion.mjs`: la cabecera de imports (`@@ -12`) y
  `pedirYEsperarTile` (`@@ -624/-637`). También toca `run.mjs` y `cable.mjs`. Con el
  arreglo en el producto, BB no necesita tocar `sesion.mjs`, y no hay solape. Si BB
  llegara a tocar `abrirSelectorDeMundos` o `regenerarMundo` (`:300`, `:468`), el
  conflicto sería textual y en funciones distintas.
- **#754** (guion 106 intermitente, localStorage del atlas): es otra familia. No hay
  solape.
- **Orden dentro de la tanda.** #673 depende de #731. Si la espera se migra antes del
  arreglo, se repite el experimento de la tanda N con el mismo ruido.

## Coste contra valor

Pequeño. Es un defecto de producto con repro determinista, arreglarlo cierra dos issues
y quita una intermitencia de cuatro guiones. Si no se hace, el banco sigue rojo ~1 de
cada 9 veces en esos guiones, la exención de #673 se queda para siempre y el jugador
puede perder un «Volver».

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

> **Encuadre (crítico, medido 2026-09-24).** #731 y #673 son UN defecto del producto,
> no del banco. Cuando la pre-generación termina (`game_gen` `ready`/`error`), el título
> pinta otra vez el selector (`title-screen.ts:148-156` → `selector-de-mundo.ts:174,193`)
> tras un `await listGames()`, sin comprobar que el jugador siga en él. Si en esa
> ventana el jugador ha salido («Volver», «Continuar»…), el selector pinta encima de la
> pantalla nueva. Repro forzado: 3/3 en f25da654.
>
> **Criterios de aceptación**
> 1. El refresco que sigue a una pre-generación no pinta nunca encima de una pantalla
>    que el jugador ya ha dejado. Vale para cualquier salida del selector, no solo
>    para «Volver».
> 2. Guion nuevo (número 198) que pulse «Volver» **en la misma tarea en que se publica
>    `ready`** y afirme que la pantalla final es el home con `#ts-new` operativo. Ese
>    aserto **no puede salir verde por ir rápido**: antes de afirmar, el guion tiene que
>    observar que el refresco se resolvió, no esperar un tiempo. Negativo probado: rojo
>    en f25da654 sin el arreglo.
> 3. En el banco no se añade ninguna espera de «título quieto» y
>    `abrirSelectorDeMundos` y `regenerarMundo` no cambian.
> 4. #673: la 17ª espera del guion 15 vuelve a `esperaDeFotogramas(...)`, se borra su
>    exención de `esperas-por-fotogramas.json` y el guion 15 corre aislado **21 veces
>    con 0 rojos**, que son las mismas corridas del número que la aparcó. Se hace
>    después del criterio 1, nunca antes.
> 5. Cero créditos (`e2e-sin-creditos`). Se cierran #731 y #673 desde la PR.
