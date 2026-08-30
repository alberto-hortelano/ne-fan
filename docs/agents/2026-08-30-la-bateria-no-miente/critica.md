# Crítica — La batería no miente (#308 #320 #261)

| Issue | Veredicto | En una línea |
|---|---|---|
| **#308** | **REENCUADRADA** | Nadie roba el pitch: el bloque 3 nunca carga la fixture que dice cargar, y esa carga tardía lo pone a 0. Y es MAYOR: tres asertos del bloque 3 miden el puerto creyendo medir campo abierto |
| **#320** | **VIGENTE** | Hipótesis medida y CONFIRMADA. Y el control es más débil de lo que dice: hoy pasa aunque tres de las cuatro teclas estén muertas |
| **#261** | **PREMATURA** | Su invariante no habría cazado #308: allí ningún `waitFor` se agota. Coste medido abajo. **No entra** |

**El problema real de los tres, en una frase:** tres guiones deciden un veredicto sobre un estado que nunca comprobaron que se hubiera alcanzado, y las tres formas de no comprobarlo son distintas. Todo lo que sigue está medido hoy sobre esta rama con el stack `e2e-sin-creditos` en `NEFAN_PORT_OFFSET=50`: cero créditos, cero procesos ajenos tocados.

## La premisa, afirmación por afirmación

**#308 · «hay un camino que devuelve el pitch a 0 entre el bloque 3 y el 4»** — CIERTO, y tiene un solo nombre. `playerPitch = 0` se escribe en **un único sitio del árbol**: `resetWorld()`, `nefan-html/src/main.ts:810`. Sus dos llamadores son el sink `mundo` (`:271`, que en el guion 22 no se ejerce: `#ts-close` no resuelve la promesa de `titleScreen.show()` —`ui/title-screen.ts:96`— así que no hay `session.enter`) y **`loadSceneData` (`:845`)**, el camino de `loadFixture`. Lo que devuelve el pitch a 0 es **la carga de la fixture que pidió el propio bloque 3**, llegando tarde.

**Los cuatro sospechosos del §3 quedan descartados.** `cerrarMuroSiHay` hace `click()` sobre `#narrative-loader-dismiss`, cuyo `onclick` es `() => hideLoader()` (`main.ts:2419`): quita clases y para un `setInterval`. Los otros tres no son sospechosos sino **ventana** por donde entra la carga tardía.

**Por qué llega tarde.** `loadFixture` (`main.ts:1326-1337`) es *fire-and-forget*: pone el `value` del `<select>`, despacha `change` y devuelve `undefined`; el import perezoso (`main.ts:78-80`) resuelve después. Y `cargarTile` (`22-…:99-110`) espera dos cosas **ya ciertas antes de pedir nada**: `status().scene` es `sceneData !== null` (`main.ts:1291`, y solo `resetWorld` lo anula) y `fps().activeTile` es la clave del tile — y `puerto_tile` y `robledo_tile` son **los dos `tile{0,0}`**. Medido: la primera `cargarTile` tarda 164 ms; **la segunda devuelve en 3 ms con el puerto todavía puesto**.

**Reproducido con los números del issue** (sonda que replica el guion, máquina ociosa, sin retraso artificial): **2 rojas de 4 en SOLITARIO**.

| Corrida | «suelo de robledo» que mide el guion | pitch bloque 4 | borde `quick` |
|---|---|---|---|
| verdes | **14 calcos** (robledo) | −30,00° | `y=397` ≤633 ✔ |
| rojas | **57 calcos** (¡el PUERTO!) | **0,00°** | `y=713` >633 ✘ |

Son las dos filas del issue; 14/57 ya las documentó `docs/agents/2026-08-23-telegraph-alcance/qa.md:22`. **El tell ya está en el log del guion** (`:174` y `:229`): si las dos líneas dicen el mismo número de calcos, esa corrida midió el puerto dos veces. Y `mirarA` no re-fija nada en el bloque 3 porque **cortocircuita** —el pitch sigue en −30 del bloque 2— y devuelve en 0-52 ms sin encolar; en las verdes tarda 152 ms, que es la señal de que sí hubo reset antes.

**Lo que el issue no dice y es suyo:** en una corrida rasgada, `sueloRobledo` (`:227`) y los asertos `:231` y `:247` («el suelo de la fixture del golden», «el borde de heavy **en campo abierto**») se miden **sobre el puerto**. Un tercio de las verdes del 22 no ha comprobado campo abierto: décimo «criterio que nace verde» de la semana.

**Alcance de la especie:** `loadFixture` sale en 21 sitios de `qa/`, pero solo muerde al cargar una SEGUNDA fixture sin recargar página: **hoy solo el guion 22**. Los guiones 23 (`:96`), 25 (`:210`) y 32 (`:88`) ya esperan por `scene_id === fixture` — **el patrón correcto ya existe en el árbol**. Otros seis (01, 02, 03, 06, 16, 30) están a salvo solo por cargar una vez.

**#320 · «`w a s d` son dos pares opuestos y el neto tiende a cero»** — CIERTO, medido con teclado real sobre el estado del guion 34, 8 rondas:

| Por tecla | Neto de las nueve entradas |
|---|---|
| `w`/`a`/`s`/`d`: **0,58–1,13 m** cada una (3–5 frames, ~153 ms) | **0,0056 · 0,072 · 0,082 · 0,086 · 0,101 · 0,109 · 0,162 · 0,503 m** |
| `Shift`, flechas y las de un golpe: **Δ = 0,000 m** | Umbral de `toFixed(2)`: **0,005 m** |

El aserto vive de un **residuo del 1-15 % de lo que mueve una sola tecla**, y una ronda de ocho pasó a **0,0006 m** del rojo. El residuo es `4,18 m/s × (frames_w − frames_s) × frame`: un frame vale 0,16 m y cero frames de diferencia vale menos de lo que el guion sabe imprimir. La carga no rompe nada, solo reparte los frames de otra manera. **`r` descartado con medida** (Δ<0,0005 m en las 4 rondas). **Y la corrección incómoda:** el control es **más débil** de lo que dice defender — con `s`, `a` y `d` muertas y solo `w` viva el neto sería 0,7 m y saldría **VERDE**. Hoy no comprueba «las cuatro teclas responden», sino «alguna pata quedó asimétrica».

## El día después

Para quien juega, **nada**, y está bien: es deuda declarada del instrumento, y el valor es que la batería deje de cobrar el impuesto de «una roja suya no cuenta». No se vuelve más difícil nada: ninguno de los dos arreglos toca código de partida. **Hay que borrar** el comentario `22-…:271-274` («este aserto es intermitente… es diagnóstico, no un aserto») con su línea `mirada`, y las dos declaraciones de «intermitente CONOCIDO y ajeno» de los requisitos de otras tandas — si no, en un mes son documentación falsa. Queda vivo sin sujeto `cerrarMuroSiHay` (bajo el runner hay bridge y el 22 nunca arranca partida: conviene ver si el muro llega a aparecer). Y parecerá arbitrario que `cargarTile` del 22 y `cargarFixture` del 23 sean dos copias del mismo helper con distinta fiabilidad.

## Conflictos

**Solapamiento real #308 ↔ #261: la tercera especie.** #261 pide que «un `waitFor` cuyo timeout se agota no decida en verde». En el 22 **ningún `waitFor` se agota**: devuelven a la primera con el estado ANTERIOR. La regla propuesta habría dejado pasar #308 entera. Ya son tres especies —timeout tragado; aserto sin espera (guion 25, #287); espera satisfecha por el estado previo— y el censo de #261 solo cuenta la primera. Sin contradicción con `qa-guiones-sin-espera-por-reloj` (ningún arreglo mete reloj) ni con #302, #241 o #297. #261 depende de los dos arreglos, no al revés.

## Coste contra valor

**#308 y #320 son baratos y valen.** Los dos arreglos son de guion, más —si se quiere— una línea en `main.ts:1326` para que `loadFixture` devuelva su promesa: es el mismo pecado que #308 ya corrigió en `debugState`, una superficie de observación que dice «hecho» sin saberlo. No hacerlos cuesta un impuesto por tanda y un tercio de corridas del 22 que no miden lo que dicen.

**#261: coste medido, y no cabe.** Censo rehecho hoy sobre los 42 guiones: **72 `.catch(` en 27 guiones**; 10 no son sobre esperas y 2 no clasifican. De los 60 restantes, **45 degradan a rojo** (no son el defecto), **2 son afirmación legítima** (02:57, 30:164) y **13 son candidatas** — de ellas **5 pueden acabar en verde sin medir** (15:170, 10:522, 11:73, 41:475, 42:365) y las otras 8 se salvan por una re-medición en vivo posterior. 11 de las 13 caen con dos helpers compartidos y 2 son a medida. Es una tanda propia, y hacerla antes sería escribir el invariante sin conocer la especie que acaba de morder. **Recomendación: no entra.**

## Qué le cambiaría a `requisitos.md`

1. **§3, sustituir entero:** *«Ninguna de las cuatro lo pone a 0. Lo pone `resetWorld()` (`main.ts:810`), llamado por la carga de `robledo_tile` que el propio bloque 3 pidió y no esperó: `cargarTile` (`22-…:99-110`) espera dos condiciones que el puerto ya satisface (`sceneData !== null` y `activeTile`, y las dos fixtures son `tile{0,0}`), así que devuelve en 3 ms. Las cuatro cosas son la VENTANA, no la causa.»*
2. **§4, añadir:** *«es mayor de lo que dice: en una corrida rasgada los asertos `:231` y `:247` miden el puerto creyendo medir campo abierto, y el tell está en el propio log — `suelo de robledo: 57 calcos` es el puerto; 14 es robledo».*
3. **Criterio 4, reescribir — es el que nos hizo cerrar mal la primera vez:** *«La demostración tiene que ser DETERMINISTA: el negativo se fabrica retrasando la respuesta HTTP del módulo de la fixture (`page.route`), que pone el 22 rojo hoy y verde tras el arreglo, y toda corrida publica el tell de qué escena midió. Repetir la batería no demuestra nada: hoy sale verde 6 de 6 en solitario y la sonda lo reproduce 2 de 4 en esa misma máquina ociosa.»* Igual para el criterio 5.
4. **Criterio 6, tachar como hecho** (hipótesis confirmada, `r` descartado) y añadir: *«y el control debe poder ponerse rojo si muere UNA sola de las cuatro teclas de movimiento»*.
5. **§5 y §8:** #261 queda fuera, con su coste escrito (5 defectos reales de 72 `.catch(`).
6. **§7, añadir:** *«las dos rojas se reproducen en solitario; no hace falta cargar la máquina»*.

### Los siete criterios: ¿puede cada uno nacer rojo?

| # | ¿Nace rojo? | Cómo se comprueba |
|---|---|---|
| 1 | **Sí** | Estaba sin respuesta; la respuesta nombra `main.ts:810` y se falsa con el tell de calcos |
| 2 | **Sí** | Rojo si el arreglo es «que el bloque 4 llame a `mirarA`». Hoy la causa no es de partida: `loadFixture` es hook de dev |
| 3 | **Sí, ya ejercido** | Retrasando el módulo de la fixture, hoy falla el aserto del telegraph en vez de la precondición |
| 4 | **NO como está escrito** | «Batería repetida» pasa por suerte en las dos direcciones (6/6 verde en solitario hoy). Ver cambio 3 |
| 5 | **NO como está escrito** | Igual: 8 rondas verdes, una a 0,0006 m del rojo. El negativo honesto es matar tres de las cuatro teclas |
| 6 | **Sí** | Medido: neto 0,0056–0,503 m contra 0,58–1,13 m por tecla |
| 7 | **Sí** | El issue se cierra, o dice con su medida por qué no |
