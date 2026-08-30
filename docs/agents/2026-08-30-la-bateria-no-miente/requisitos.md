# Requisitos — La batería no miente (#308 #320, y quizá #261)

## 1 · La petición del usuario, literal

> «pasamos a la siguiente»

Y, elegida entre cuatro tandas medidas, la opción:

> «Los dos intermitentes (Recomendado) — #308 #320. Cada tanda paga un impuesto por ellos: hoy
> los he declarado «ajenos» en los requisitos, y eso significa que cuando la batería saca un rojo
> nadie sabe si es suyo. #308 ya tiene la causa medida […]; #320 falla 1 de cada 4 baterías
> completas y 0 en solitario, o sea contención de recursos. Cerrarlos hace fiable el instrumento
> del que dependen las demás tandas.»

La intención permanente, de turnos anteriores:

> «Vamos a seguir priorizando reducir el numero de issues»

## 2 · Por qué esta tanda, y por qué ahora

**Los dos son un impuesto que pagan todas las demás tandas.** Hoy mismo, en los requisitos de
«Los espejos de la sesión», tuve que escribir: *«los guiones 34 (#320) y 22 (#308) son
intermitentes CONOCIDOS y ajenos; una roja suya no es hallazgo de esta tanda»*. Eso es exactamente
la enfermedad que el propio #308 describe:

> «un guion intermitente es peor que uno rojo: cada vez que sale rojo, quien lo mira aprende a
> re-ejecutarlo en vez de a leerlo»

Y los dos guiones defienden cosas que importan: el 22, que el telegraph avisa por dónde entra un
ataque; el 34, que **con el título delante el teclado no juega**. El día que se rompan de verdad
van a parecer otra intermitencia más.

## 3 · La causa de #308, CONTESTADA por el crítico

Dos correcciones se acumulan aquí, y las dos importan.

**Primera (mía, ya corregida en el issue):** el comentario con el que reabrí #308 esta mañana
—«`mirarA(-30)` se agota y el guion SIGUE»— era **falso**. `waitFor` **lanza** al agotarse
(`qa/run.mjs:680`), y el bloque 4 **ni siquiera llama a `mirarA`**: las dos llamadas están en
`:192` y `:245`.

**Segunda (del crítico): ninguno de los cuatro sospechosos que escribí pone el pitch a 0.**

`playerPitch = 0` se escribe en **un único sitio del árbol**: `resetWorld()`
(`nefan-html/src/main.ts:810`). En el guion 22 su llamador alcanzable es `loadSceneData`
(`:845`), o sea **la carga de la fixture que pidió el propio bloque 3, llegando tarde**.

- `loadFixture` (`main.ts:1326-1337`) es **fire-and-forget**: pone el `value` del `<select>`,
  despacha `change` y devuelve `undefined`; el import perezoso resuelve después.
- `cargarTile` (`22-…:99-110`) espera dos condiciones **ya ciertas antes de pedir nada**:
  `status().scene` es `sceneData !== null` (y solo `resetWorld` lo anula) y `fps().activeTile` es
  la clave del tile — pero **`puerto_tile` y `robledo_tile` son los dos `tile{0,0}`**.
- Medido: la primera `cargarTile` tarda **164 ms**; la segunda devuelve en **3 ms con el puerto
  todavía puesto**.

`cerrarMuroSiHay` queda descartado (su `onclick` es `() => hideLoader()`, `main.ts:2419`). Los
otros tres no eran sospechosos: eran **la ventana** por la que entra la carga tardía.

**Reproducido en SOLITARIO, máquina ociosa: 2 rojas de 4**, con los números exactos del issue. No
hace falta cargar la máquina.

## 4 · Y es MAYOR de lo que el issue dice

En una corrida rasgada, el guion 22 **mide el puerto creyendo medir campo abierto**: `sueloRobledo`
(`:227`) y los asertos `:231` y `:247` («el suelo de la fixture del golden», «el borde de `heavy`
**en campo abierto**») caen sobre la fixture anterior.

**El tell ya está en el log del guion** (`:174` y `:229`): `suelo de robledo: 57 calcos` es el
puerto; **14** es robledo. Si las dos líneas dicen el mismo número, esa corrida midió el puerto dos
veces.

O sea que **un tercio de las corridas VERDES del guion 22 no ha comprobado campo abierto**. Es el
décimo «verde que no comprueba nada» de la semana, y no es intermitencia: es el guion afirmando
algo que no midió.

**Alcance de la especie**: `loadFixture` sale en 21 sitios de `qa/`, pero solo muerde al cargar una
SEGUNDA fixture sin recargar página — **hoy solo el guion 22**. Y el patrón correcto **ya existe en
el árbol**: los guiones 23 (`:96`), 25 (`:210`) y 32 (`:88`) esperan por `scene_id === fixture`.

## 5 · #320 — hipótesis CONFIRMADA, y el control es más débil de lo que dice

Medido por el crítico con teclado real, 8 rondas:

| Por tecla | Neto de las nueve entradas |
|---|---|
| `w`/`a`/`s`/`d`: **0,58–1,13 m** cada una | **0,0056 · 0,072 · 0,082 · 0,086 · 0,101 · 0,109 · 0,162 · 0,503 m** |
| `Shift`, flechas y las de un golpe: **Δ = 0,000 m** | Umbral de `toFixed(2)`: **0,005 m** |

El aserto vive de un **residuo del 1-15 %** de lo que mueve una sola tecla, y una ronda pasó a
**0,0006 m** del rojo. La carga no rompe nada: solo reparte los frames de otra manera. `r` queda
descartado con medida (Δ<0,0005 m).

**La corrección incómoda**: el paso de control es **más débil de lo que dice defender** — con `s`,
`a` y `d` muertas y solo `w` viva, el neto sería 0,7 m y saldría **VERDE**. Hoy no comprueba «las
cuatro teclas responden», sino «alguna pata quedó asimétrica».

## 6 · #261 NO entra — coste medido

Su invariante **no habría cazado #308**: allí ningún `waitFor` se agota, devuelven a la primera con
el estado anterior. Hay **tres especies** —timeout tragado; aserto sin espera (guion 25, #287);
espera satisfecha por el estado previo— y el censo de #261 solo cuenta la primera.

Censo rehecho por el crítico: **72 `.catch(` en 27 guiones**; 45 degradan a rojo (no son el
defecto), 2 son afirmación legítima, **13 son candidatas** y de ellas **solo 5 pueden acabar en
verde sin medir**. Es una tanda propia, y hacerla antes sería escribir el invariante sin conocer la
especie que acaba de morder.

## 7 · Criterios de aceptación

Cada uno debe poder **nacer rojo**, y el rojo se mide **antes** de tocar nada.

1. **Se sabe QUIÉN devuelve el pitch a 0**, con nombre y medida. Ya contestado por el crítico
   (`main.ts:810` vía la carga tardía); el criterio es que el arreglo ataque **eso**.
2. **Si el culpable es de producción, se arregla en producción**, no en el guion. Nace rojo si el
   arreglo es «que el bloque 4 llame a `mirarA`», que tapa sin curar. Aviso de #250.
3. **Una precondición que no se cumple NO puede salir como un aserto fallando por otro motivo**, ni
   en el 22 ni en el 34: o `⊘` con su mensaje, o rojo diciendo lo que de verdad pasó.
4. **REESCRITO — el criterio anterior NO podía nacer rojo.** «Batería completa repetida» pasa por
   suerte en las dos direcciones: hoy el 22 sale **6 de 6 verde en solitario** mientras la sonda del
   crítico lo pone rojo **2 de 4** en esa misma máquina ociosa. La demostración tiene que ser
   **DETERMINISTA**: fabricar el negativo **retrasando la respuesta HTTP del módulo de la fixture**
   (`page.route`), que pone el 22 rojo hoy y verde tras el arreglo.
5. **REESCRITO por lo mismo.** El negativo honesto del guion 34 no es repetir la batería (8 rondas
   verdes, una a 0,0006 m del rojo): es **matar tres de las cuatro teclas** y exigir rojo.
6. **Toda corrida del 22 publica el tell de QUÉ escena midió.** Un aserto sobre «campo abierto» que
   se puede satisfacer midiendo el puerto no es un aserto.
7. **El control del 34 se pone rojo si muere UNA sola de las cuatro teclas** de movimiento.
8. **#308 y #320 se cierran**, o el que no se cierre lo dice con su medida.

## 8 · Restricciones

- **Cero créditos.** Ninguno de los dos guiones los gasta.
- **No matar procesos ajenos.** Esta máquina corre varios agentes; nada de `pkill vite|node|python`.
  Usar `NEFAN_PORT_OFFSET`.
- **Las dos rojas se reproducen en solitario**: no hace falta cargar la máquina, y cargarla no
  demuestra nada.
- **La deuda no sube.** Línea base a medir al empezar.
- `npm run verify` verde, batería completa verde y CI verde antes de dar nada por hecho.
- **Ya no hay intermitentes que declarar como ajenos**: si algo sale rojo, es de esta tanda hasta
  que se demuestre lo contrario.

## 9 · Lo que esta tanda NO hace, y lo que SÍ hay que borrar

**No hace**: #261, con su coste medido arriba. Ni el barrido de las 72 apariciones de `.catch(`.

**Hay que borrar en la misma PR** (o queda documentación falsa en un mes):

- el comentario `22-…:271-274` («este aserto es intermitente… es diagnóstico, no un aserto») y su
  línea `mirada`;
- las declaraciones de «intermitente CONOCIDO y ajeno» que dejé en los requisitos de otras tandas.

**A mirar de paso, sin obligación**: `cerrarMuroSiHay` queda vivo sin sujeto (bajo el runner hay
bridge y el 22 nunca arranca partida), y `cargarTile` del 22 y `cargarFixture` del 23 son dos copias
del mismo helper con distinta fiabilidad.
