# QA — PR 5 de #346 «El título troceado» · el SELECTOR DE MUNDOS

Árbol: `/home/al/code/ne-fan-346-5qa`, HEAD desprendido en `360a3abc` (la punta de la PR).
Todo lo de abajo se midió ahí, con rutas absolutas, sin tocar `/home/al/code/ne-fan` ni
`/home/al/code/ne-fan-346-5`. Cero créditos: `e2e-sin-creditos` (motor falso), levantado por
`qa/run.mjs` en su propio bloque de puertos, y un stack a mano en `NEFAN_PORT_OFFSET=500` desde
ESTE árbol —parado con `--parar` del mismo árbol— para el flujo real y la crítica visual.

## Veredicto

**APTO CON HALLAZGOS.** El corte mayor del programa es equivalente y lo he demostrado con **mi
propio comparador, en las dos direcciones**: el cuerpo de la hoja es el de `HEAD~1` línea a línea
salvo las reescrituras declaradas (ni una de más), y de la raíz salen exactamente **17** líneas
fuera de las dos franjas —catorce imports sin sujeto y tres sitios de llamada—. Los **67 ids del
DOM son el mismo conjunto**, medido sobre la UNIÓN raíz + `ui/titulo/` en las dos puntas. Los dos
criterios de cierre que faltaban están cumplidos y verificados por mí: **0 `let`** y **0 `render*`
privados** en la raíz.

**El cambio de forma del progreso (C1) es la parte que más miré, y aguanta**: las dos mitades que
antes resolvían dentro de la función resuelven ahora en sus dos llamantes, y las dos dicen lo mismo.
No me quedé en la lectura: los tres estados que la costura cruza y que **no pisaba ningún guion** —el
progreso que llega mientras la línea no existe, la tarjeta sin estado, y la rama de **error**— son
ahora el guion **100**, verde, con cinco sabotajes que lo ponen rojo **cada uno en su bloque**, uno
de ellos reproduciendo el síntoma histórico de #313.

El riesgo 1 (el tope) lo he medido yo: **432, 18 de margen**, `max-lines` rojo a 451 y ningún otro
módulo del directorio por encima. El riesgo 4 (fuga de oyentes) está cubierto para lo que el plan
enumera, y he encontrado —y **medido**, con su arreglo de tres líneas— el punto ciego que le queda
al guion 99 (H2).

Los hallazgos son **dos de esta PR y los dos menores** (una medida publicada que no reproduce y el
punto ciego del guion nuevo), **dos preexistentes que el jugador VE** en esta misma pantalla, **una
observación de programa para la PR 6** y **un aviso** de intermitencia con dueño. Ninguno bloquea.

---

## Tabla de criterios

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Sale el selector a `ui/titulo/selector-de-mundo.ts` con `pintarSelectorDeMundo(deps, preselect?)`, SEIS colaboradores y sin objeto de contexto | ✅ | `wc -l` = **432**. `DepsDeSelectorDeMundo` = `{content, narrative, recordarMundo, progresoDe, ir, mostrarPlanDeEstilo}`, seis campos con doc propio (`:52-82`). `grep -c 'this\.'` en la hoja → **0** |
| 2 | **Sin cambio de comportamiento — el cuerpo movido es el de `HEAD~1`** | ✅ | **Comparador PROPIO** (difflib sobre las franjas `107-132` y `537-847` de `HEAD~1`, desindentadas 2), independiente del extractor del ingeniero: **todas** las diferencias son las declaradas — las dos firmas, el doc de `pintarProgresoDeMundo`, `s`→`estado` (9 sitios), `this.`→`deps.` (18), los dos `paso(deps.ir(…))` y el `a:"editor"`. **Cero diferencias no declaradas** |
| 3 | **La dirección contraria: qué salió de la raíz que NO estaba en las franjas** | ✅ | Reconstruyo `HEAD~1` menos las dos franjas y lo diffeo contra la raíz: salen **17** líneas (14 de import + 3 sitios de llamada) y entran las declaradas (`pintarElSelector`, `progresoDelMundoMirado`, el import). Ni una línea de código movido tocada en la raíz |
| 4 | **C1 · el progreso cambia de forma: las dos mitades siguen diciendo lo mismo** | ✅ | Raíz: `progresoDelMundoMirado()` es literalmente el `gameId === null ? undefined : map.get(gameId)` de `HEAD~1` con el `gameId` puesto; panel: `deps.progresoDe(selectedGame.game_id)` = `map.get(gameId)` con `gameId` no nulo. Y **medido en el juego**, no leído: guion **100**, cinco bloques, 13 asertos |
| 5 | **C1 · estado que llega ANTES de que la línea exista** | ✅ | Guion 100 bloque A: el `game_gen` se entrega con el jugador en el HOME (no hay `#ts-gen-progress`), no rompe nada ni deja error, y al abrir el selector la tarjeta **ya lo enseña** con sus minutos. Captura `…-progreso-que-esperaba-al-abrir-el-selector.png`. En negativo (`progresoDe → undefined`): rojo |
| 6 | **C1 · mundo SIN estado** | ✅ | Guion 100 bloque B: la otra tarjeta deja la línea vacía **y borra `data-gen-phase`** — que no es cosmética: es por donde espera `regenerarMundo` (`qa/lib/sesion.mjs:425`). En negativo (sin `removeAttribute`): rojo |
| 7 | **C1 · cambio de tarjeta con una generación EN VUELO** | ✅ | Guion 100 bloque C: con la otra tarjeta delante llega un segundo mensaje del primero; la línea sigue vacía y, al volver, se lee el **ÚLTIMO** mensaje y no el que había al irse. En negativo (ranura única de antes de #313): rojo, con el síntoma histórico |
| 8 | **La rama de ERROR, que no ejercía nadie** | ✅ | Guion 100 bloque D: rojo (`rgb(170,68,68)`) con su motivo, `data-gen-phase="error"`, entrada en el registro de errores, y el motivo **sobrevive al repintado** que dispara la propia fase terminal. En negativo (sin `errors.push`; y sin repintar): rojos distintos |
| 9 | **Riesgo 1 · el módulo cabe bajo 450** | ✅ | `wc -l` = **432**, margen **18**. Probado en negativo por mí: con 19 líneas de relleno, `451:1 error File has too many lines (451). Maximum allowed is 450 max-lines`. Restaurado, md5 `04eb5c58…` |
| 10 | Ningún otro módulo de `ui/titulo/` pasa de 450 · `eslint src/ui/titulo` limpio | ✅ | 211 · 129 · 183 · 376 · 134 · **432** · 224. `npx eslint src/ui/titulo` exit=0 y `npx eslint src` exit=0 |
| 11 | **Riesgo 4 · ninguna hoja engancha a lo que sobrevive** (estático) | ✅ | `grep -c 'document\.\|window\.\|\bthis\.'` en la hoja → **0**; sus 10 `addEventListener` cuelgan de nodos que ella crea dentro de `content`. Los cinco de por vida siguen en la raíz |
| 12 | **Riesgo 4 · el guion 99 mide lo que dice** | ✅ con hallazgo | Mide: corrí yo el control positivo (`document.addEventListener` por pintado → **rojo**, `22 → 30`, los ocho fugados nombrados). **Pero tiene un punto ciego demostrado**: el MISMO oyente un nodo más arriba (`document.documentElement`) lo deja **verde entero** → H2, con su arreglo de tres líneas medido en las dos direcciones |
| 13 | Los 67 ids `ts-*`/`data-*` son el mismo conjunto | ✅ | `diff` de los dos `sort -u` sobre la **UNIÓN** raíz + `ui/titulo/` en `HEAD~1` y en `HEAD` → vacío. **67 = 67** |
| 14 | Criterios de cierre del programa que esta PR remata | ✅ | `grep -c '^\s*let '` → **0** (era 5) · `grep -c 'private.*render[A-Z]'` → **0** (era 2) · `wc -l` raíz **682** |
| 15 | Trinquete de tamaño con `wc -l` real, y ROJO por el lado flojo | ✅ | `client-file-size.json` dice 682 y el fichero mide 682; `npx tsx --test test/client-file-size.test.ts` → **7/7**. Con 700 puesto a mano: «ADELGAZÓ a 682 y su excepción sigue en 700: le está regalando 18 línea(s)». Restaurado |
| 16 | **Las cifras de la crónica del contrato casan** (el H1 de QA-4 no se repite) | ✅ | 432 = 83 cabecera + 349 cuerpo; 349 = 337 franjas + 12 reescrituras; salen 354 (348 con contenido), entran 57 (56); 354 − 57 = 297 = 979 − 682. **Las seis medidas reproducidas una a una** |
| 17 | El candado de las hojas, por **dos puertas que nadie había probado** | ✅ | Sondas reales en disco: **`await import("./home.js")` DINÁMICO** y **`export … from "./crear-mundo.js"`**. Las dos saltan (`selector-de-mundo.ts:126 — import prohibido: "./home.js" → …/home.ts`). Retiradas, md5 comprobado |
| 18 | `npm test` (core) | ✅ | `tests 2448 · pass 2448 · fail 0`, medido por mí. Dentro: `[deuda] html-sin-promesa-muda (max 7)` y `[deuda] html-sin-catch-silencioso (max 4)` verdes, `la-logica-de-juego-no-vuelve-al-cliente` verde |
| 19 | Cliente limpio | ✅ | `npx tsc --noEmit` exit=0 · `npx eslint src` exit=0 |
| 20 | El diff de `nefan-core/src` y de `arch-rules.json` no cambia conducta | ✅ | `nefan-core/src`: **comentario puro** (mi propio grep → 0 líneas de código). `arch-rules.json`: comparación **semántica** (parseo el JSON en las dos puntas y borro `why`/`desc`/`$comment`) → **idéntico**; lo único que cambia son dos `why` |
| 21 | El diff de `qa/` no toca el código de ningún guion existente | ✅ (con matiz) | Cierto: con el fichero nuevo excluido, **0** líneas de código. El comando publicado en el informe da 188 → **H1** |
| 22 | Rastros barridos (los tres punteros de esta PR) | ✅ | `grep -rn "title-screen\.ts:[0-9]"` fuera de `docs/agents/` → solo `architecture.test.ts` (las salidas sintéticas `:1`…`:8` y la cita en pasado de `:1194`), que es lo ya clasificado como registro. `renderWorldSelect`/`renderGameGenProgress` fuera de `docs/agents/` → solo los dos textos sintéticos del checker y la crónica fechada del JSON |
| 23 | **Batería completa** | ✅ con aviso | **Dos corridas.** #1 (98 guiones): `97 en verde · 1 en rojo`, el rojo el **80**, intermitente con dueño (#545) → H6; reproducido **verde** aislado y con su vecino. #2 (99, con mi guion dentro): ver §«Las dos baterías» |
| 24 | Los guiones que conducen el TÍTULO | ✅ | Los 25 verdes en las dos corridas, **sin retocar un guion** (07 12 18 19 20 27 28 30 32 33 34 38 44 47 52 69 70 72 92 94 95 96 97 98 99) |
| 25 | **Flujo real desde el arranque** | ✅ | `NEFAN_PORT_OFFSET=500 ./start.sh --preset e2e-sin-creditos` desde mi árbol: home → «Nueva partida» → selector → cambiar de mundo (el estilo, la portada, la descripción y el panel de generación siguen a la tarjeta) → los dos pares de modo (personajes SIGUE a escenarios hasta que se toca) → «Continuar» → editor con el mundo correcto → «Volver» → «Crear mundo» → «Volver» → «Subir estilo» → «Volver» → «Continuar» → «Comenzar» → **partida jugable** (`sesión 1788982120-22d813`, título oculto, HUD y barra de ataque). Capturas abajo |
| 26 | **Borde real: el bridge sin mundos** | ✅ | Stack levantado con `NEFAN_GAMES_DIR` a un directorio VACÍO (borde de verdad, no estado sintético): «Nueva partida» vuelve a su rótulo y sigue pulsable, y el título dice **«No se pudo abrir el selector de mundos. No hay ningún mundo instalado.»** con la causa técnica en el registro. Es el canal `paso(…, alFallar)` que esta PR extiende a dos botones más |
| 27 | Gasto real de créditos | ⚠️ no probado | Por diseño. 75 declaraciones `⛨ guardarraíl: cliente y bridge declaran fake:true` en la corrida completa; mi guion declara `sinMotor` y nunca pulsa `#ts-gen-world` ni `#ts-apply-style` |
| 28 | `generarElMundo` y su confirmación armada de dos clicks | ⚠️ no probado | Igual que el informe: cualquier click ahí encola trabajo real. Es el único handler NO idempotente de la pantalla y sigue siendo el hueco declarado del 99 |

---

## Lo que más miré: el cambio de forma del progreso (C1)

El encargo lo señala como «lo menos movimiento puro de esta PR», y lo es: la resolución del estado
sale de dentro de la función y se reparte entre sus dos llamantes.

| Mitad | `HEAD~1` | Ahora | ¿Dice lo mismo? |
|---|---|---|---|
| El oyente del bridge | `renderGameGenProgress(line, this.lastSelectedGameId)`, que dentro hacía `gameId === null ? undefined : map.get(gameId)` | `pintarProgresoDeMundo(line, this.progresoDelMundoMirado())`, y ese método **es** esa expresión | Sí — mismo texto, movido de sitio |
| El panel de generación | `this.renderGameGenProgress(genProgressEl, selectedGame.game_id)` → `map.get(gameId)` (nunca nulo) | `pintarProgresoDeMundo(genProgressEl, deps.progresoDe(selectedGame.game_id))`, y `progresoDe` **es** `map.get(gameId)` | Sí |

Resolver en el sitio de llamada en vez de dentro solo cambiaría algo si la función viajara como
callback y se invocara más tarde con un estado ya rancio. **No viaja**: sus dos únicos llamantes en
todo el repo son esos dos, y los dos la llaman inmediatamente (`grep -rn pintarProgresoDeMundo` → 3
hits: la definición y esos dos).

Y donde de verdad se decide esto es en el juego, así que lo llevé al guion **100** por los tres
estados que ningún guion pisaba (bloques A, B y D) más los dos que el 38 solo mide a medias (C y E).
La medida que más me importa es la de los **sabotajes**: con `progresoDe` devolviendo siempre
`undefined`, los bloques A, C, D-supervivencia y E se ponen rojos **y el pintado que hace el oyente
de la raíz sigue verde**. Las dos mitades se miden por separado, que es exactamente lo que hacía
falta para una PR que las separó.

---

## Crítica visual — la pantalla donde se elige qué se va a jugar

Capturas del flujo real a 1440×900, en `qa/capturas/qa5-manual/` (gitignored, como todas):
`qa5-01-home.png`, `qa5-02-selector.png`, `qa5-03-editor.png`, `qa5-04-partida.png`,
`qa5-05-sin-mundos.png`.

**Lo que está bien, y no es poco.** Las cuatro tarjetas leen como un catálogo: portada del estilo
ELEGIDO (no la del `style_id` por defecto), título del mundo, estilo en su línea, descripción de tres
o cuatro renglones y el chip de «lo generado». Las cuatro portadas son capturas del propio juego con
la misma cámara y la misma altura de horizonte, así que la columna tiene una luz coherente en vez de
cuatro ilustraciones peleándose. La columna derecha ordena la decisión de arriba abajo en el orden en
que se toma —estilo, escenarios, personajes, generación— y cada opción de coste lo dice en su propia
línea («gasta créditos» / «sin coste») en vez de esconderlo. El estado activo se marca por borde
ámbar y fondo cálido: se ve de un vistazo qué está elegido, incluida la tarjeta.

**Lo que no.** Tres cosas, las tres preexistentes y verbatim, pero las tres en esta pantalla:

1. **La fila de acciones se corta** — H3. El botón primario, «Continuar →», aparece partido por la
   mitad en una ventana de portátil normal, y nada dice que haya que scrollear. Es lo primero que se
   ve mal en `qa5-02-selector.png`.
2. **El tercio inferior derecho es hueco.** En la captura, el panel de generación acaba hacia los
   590 px y debajo no hay nada hasta el borde; la columna izquierda, en cambio, llega hasta los
   830 px y es la que empuja la fila de acciones fuera del recorte. La pantalla tiene el sitio libre
   justo en el lado contrario al que le falta.
3. **El encabezado no separa rótulo de explicación.** «Elige un mundo» va a 26 px en el mismo ámbar
   `#da6` que el «Never Ending Fantasy» del home (32 px), y el subtítulo explicativo —«La historia la
   improvisa el motor narrativo…»— va pegado **a su derecha, en la misma línea**, en gris de 12 px.
   Es una jerarquía de dos niveles metida en una línea: el ojo no sabe si está leyendo un rótulo de
   pantalla o una frase, y a ancho de portátil los dos se tocan.

Ninguna de las tres cambia con este corte —el HTML es byte a byte el de `HEAD~1`— y ninguna debe
arreglarse dentro de un movimiento. Las tres son material de #427, y ahora tienen dueño: un módulo
de 432 líneas.

---

## Hallazgos

### H1 · MENOR · **de esta PR (exactitud de la medida)** — el comando publicado no reproduce su resultado

`implementacion-5.md §7` publica, bajo «comprobado y no afirmado»:

```
$ git diff -U0 -- qa/ | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*(\*|//|\|)'   → vacío
```

Sobre el commit ese comando da **188**, no vacío: son el guion 99 entero, que es un fichero NUEVO y
código legítimo declarado aparte. Lo que la frase quiere decir —ningún guion existente cambió de
código— es cierto, y lo he verificado con el comando que sí lo mide:

```
$ git diff -U0 HEAD~1 HEAD -- qa/                              | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*(\*|//|\|)' | wc -l  → 188
$ git diff -U0 HEAD~1 HEAD -- qa/ ':(exclude)qa/guiones/99-*'  | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*(\*|//|\|)' | wc -l  → 0
```

**Qué esperaba**: que un comando publicado como prueba se pueda pegar y dé lo que dice. Es la misma
familia que el H1 de QA-4 (una cifra publicada que no se volvió a medir) y la de «la medida de hoy
hay que medirla hoy». **Arreglo**: una frase, en el informe — el diff del commit ya está bien.

### H2 · MENOR · **del banco, del guion que estrena esta PR** — la sonda de oyentes del 99 tiene un punto ciego, y lo he medido con su arreglo

El guion 99 apunta los `addEventListener` cuyo destino es `window`, `document`, `document.body`,
`#title-screen` o un **hijo directo** de `#title-screen`. Eso es exactamente lo que enumera el riesgo
4 del plan, así que el guion cumple la letra. Pero «lo que sobrevive a un repintado» es más que esos
cinco objetos: `<html>`, `document.head` y el `<style id="title-screen-responsive">` que cuelga de
él, `#error-log`, `#dev-status` y el lienzo también sobreviven, y una fuga ahí es invisible.

**Probado**, sonda real en disco (una línea en `pintarSelectorDeMundo`, restaurada con `md5sum`
comprobado, `04eb5c58…`):

| Sonda en la hoja (una por pintado), corridas las dos por mí | Guion 99 |
|---|---|
| `document.addEventListener("keydown", …)` — el control positivo (la sonda del ingeniero) | **ROJO** ✔ — `22 → 30`, y los ocho fugados nombrados: `document · keydown` ×8 |
| **`document.documentElement.addEventListener("keydown", …)`** — el mismo oyente, un nodo más arriba | **VERDE ENTERO** ❌ — «oyentes al salir: 21 (ninguno nuevo)», con los mismos **ocho** oyentes fugados |

**Y el arreglo, medido y no propuesto a ojo** — tres líneas en `espiarOyentes`:

```js
} else if (raiz && this.isConnected && !raiz.contains(this)) {
  donde = `fuera del titulo · ${this.id || this.tagName.toLowerCase()}`;
}
```

| Con la sonda ensanchada | Resultado |
|---|---|
| árbol **limpio** (control de falsos positivos) | **VERDE**, «oyentes al salir: 28 (ninguno nuevo)» |
| el mismo sabotaje sobre `<html>` | **ROJO**, nombrando `fuera del titulo · html · keydown` ×8 |

**Reproducción**: meter la línea del sabotaje al principio de `pintarSelectorDeMundo` y correr
`node qa/run.mjs 99`. **No lo arreglo yo**: el 99 es entrega del ingeniero y tocarlo desde aquí
contamina la evidencia. Decide el coordinador si entra en la vuelta de esta PR o en la 6, que es la
que mueve el chasis y por tanto los cinco oyentes de por vida.

### H3 · MENOR · **preexistente (verbatim), pero el jugador lo VE en esta pantalla**

A 1440×900 —resolución de portátil corriente— la fila de acciones del selector queda **cortada**: el
botón primario «Continuar →» se recorta 17 px de sus 39 (44 %) contra el borde inferior de
`content`, que es el que scrollea (`overflow-y:auto`).

```
contentBox { top: 160, bottom: 868 }      botón «Continuar →» { top: 846, bottom: 885, alto: 39 }
recortado por: 17 px                      scroll pendiente dentro de content: 17 px
```

Se ve en `qa5-02-selector.png`: los cuatro botones de la fila aparecen partidos por la mitad. Y **no
hay ninguna señal de que haya más abajo**: el aviso de corte del título (`actualizarAvisoDeCorte`)
solo mira `.ts-save`, que son las filas del HOME — el selector no tiene ninguno.

**No lo causa esta PR** (el bloque es byte a byte el de `HEAD~1`, criterio 2, y el CSS de `content`
vive en el constructor, que este diff no toca). Lo reporto porque es lo que sale al mirar como
director de arte la pantalla donde se elige qué se va a jugar, y porque ahora esa pantalla es un
módulo de 432 líneas con dueño. Familia de #250/#251 y material de #427.

**Reproducción**: `./start.sh --preset e2e-sin-creditos`, ventana de 1440×900, «Nueva partida».

### H4 · MENOR · **preexistente (predata el programa entero), y el jugador lo VE**

«← Volver» desde «Crear personaje» devuelve al selector **olvidando todo lo que el jugador había
elegido**. Medido en el flujo real:

| | antes de «Continuar» | tras «← Volver» |
|---|---|---|
| mundo | `cuentos_oscuros` | **`alta_fantasia`** |
| estilo | `sombra_de_cuento` | **`acuarela_luminosa`** |
| escenarios / personajes | `vector` / `vector` | **`image` / `image`** |

El destino es `ir({ a: "selector" })` **sin `preselect`** (`editor-de-personaje.ts:160`), y el
selector sin preselección se planta en `games[0]`. Es idéntico a `HEAD~1` (el fichero no está en
este diff: `diff` contra `HEAD~1` → idéntico), idéntico a la PR 3 que lo movió, e idéntico a antes
de #346 (`5bfa8a84~1:title-screen.ts:1525` → `paso(this.renderWorldSelect(), …)`, sin argumento).

Lo que lo hace reportable y no una curiosidad: **la raíz SÍ recuerda la tarjeta** —
`lastSelectedGameId`, que el oyente del bridge usa para repintar (`:144`)— y este camino no la mira.
El arreglo es un argumento (`ir({ a: "selector", preselect: … })`), pero **no en esta PR**: sería
conducta nueva dentro de un movimiento. Va a issue.

**Reproducción**: título → «Nueva partida» → elegir el segundo mundo y «Maqueta 3D» → «Continuar»
→ «← Volver».

### H5 · OBSERVACIÓN (para la PR 6, no para ésta) — dos piezas de la raíz cuyo único dueño acaba de mudarse

El encargo pregunta si queda en la raíz volumen que debía haber salido con el selector. **Volumen
grande, no.** Dos piezas pequeñas, sí, y las dos van a aterrizar en `chasis.ts`:

1. El `<style id="title-screen-responsive">` del constructor (`:151-180`). Su propio comentario dice
   «Distribución MÓVIL **del selector de mundo**», y seis de sus reglas (`#ts-columns`, `#ts-worlds`,
   `#ts-rendermode`, `#ts-charmode`, `#ts-actions`, `#ts-create-world`) tienen un solo dueño, que es
   la hoja que se acaba de ir. **No podía viajar con ella**: el módulo cabe con 18 líneas de margen.
2. `vigilarPortadas` (`:303-350`, 48 líneas), que solo mira `data-cover-img` / `data-cover-for` /
   `data-cover-marker` — o sea las tarjetas del selector. Tampoco puede salir: es uno de los **cinco
   oyentes de por vida**, en captura sobre `root`, y el riesgo 4 prohíbe expresamente que una hoja
   enganche ahí.

No pido nada en esta PR. Lo digo porque es la última antes de la que cierra y porque la aritmética
que queda es de **~50 líneas de margen**, no de ~130: si la PR 6 se queda corta, éstos son los dos
sitios donde hay que mirar antes de tocar el enrutador.

### H6 · AVISO · **preexistente con dueño (#545)** — la batería sigue sin ser estable

| Corrida (misma punta `360a3abc`) | Resultado | Rojo |
|---|---|---|
| #1 · 98 guiones | `97 en verde · 1 en rojo` | **80**-el-desplegable-room · `errores 4 → 5` |
| #2 · 99 guiones (con el 100 dentro) | `98 en verde · 1 en rojo` | **81**-el-spawn-vuelve-con-su-rol · `[true,true,true,true]` |

**Dos corridas, dos rojos distintos, los dos verdes al aislarlos** (detalle y comandos en §«Las dos
baterías»). El del #1 es la firma exacta que QA-2 documentó y QA-4 volvió a ver; el del #81 es
**nuevo en la lista** de intermitentes (75/80/91/93 → **+81**) y su aserto es de colocación de
spawns, del par #489, no del título.

**Sin camino causal desde esta PR en ninguno de los dos**: el diff son `title-screen.ts` + la hoja
nueva + comentarios; el 80 conduce el desplegable «Room» y el 81 la colisión de los spawns, y este
corte no toca ni el sim ni el cliente fuera del título. Sexta y séptima medida del mismo disparador.

---

## Las dos baterías

| Corrida | Guiones | Resultado | Rojo | Máquina |
|---|---|---|---|---|
| **#1** | 98 (los del commit) | `97 en verde · 1 en rojo` | **80**-el-desplegable-room · «…ni deja una entrada de error — 4 → 5» | libre (`load 0.12` al arrancar, 1.5-1.7 durante) |
| **#2** | 99 (con mi guion 100 dentro) | `98 en verde · 1 en rojo` | **81**-el-spawn-vuelve-con-su-rol · «un palmo más allá del cofre se pasa por algún lado — `[true,true,true,true]`» | CARGADA (`load 8.3` en el tramo medio: mi propio navegador del flujo real solapaba) |

**Dos corridas, dos rojos DISTINTOS, los dos verdes al reproducirlos como manda #545:**

```
$ node qa/run.mjs 80      → 1 en verde · 0 en rojo      $ node qa/run.mjs 81      → 1 en verde · 0 en rojo
$ node qa/run.mjs 79 80   → 2 en verde · 0 en rojo      $ node qa/run.mjs 80 81   → 2 en verde · 0 en rojo
```

El **80** es de la lista que QA-2 abrió y con la firma exacta que QA-4 volvió a ver. El **81** es
**nuevo en la lista** (75/80/91/93 → +81) y su aserto es de colocación: «a un palmo del borde del
cofre, alguna de las cuatro direcciones está libre» sale `[true,true,true,true]` con la **forja
vecina** tapando una de ellas. Es del par spawn/colisión (#489), no del título.

**Sin camino causal desde esta PR en ninguno de los dos**: `git show --stat HEAD` es
`title-screen.ts` + la hoja nueva + `client-file-size.json` + dos `why` de `arch-rules.json` +
comentarios de `nefan-core/src` y de `qa/`. Ni una línea del sim, de la colisión ni del cliente
fuera del título.

**Lo que sí es dato limpio y sostiene el criterio de cierre**: los **25 guiones que conducen el
título salieron verdes en las DOS corridas**, sin retocar un guion (07 12 18 19 20 27 28 30 32 33 34
38 44 47 52 69 70 72 92 94 95 96 97 98 99, más el 100 en la segunda). **Cero créditos**: 75
declaraciones `⛨ guardarraíl: cliente y bridge declaran fake:true` en cada corrida, y **un solo id
de corrida por log** (`grep -o` sobre cada uno → uno), así que ningún número viene del árbol de al
lado.

---

## Guion dejado

`qa/guiones/100-el-progreso-del-mundo-espera-en-la-tarjeta-que-lo-genera.mjs` (+ su fila en
`qa/README.md`). **El 100 estaba libre y lo reservé antes de escribir** (`ls qa/guiones/` → 98
ficheros hasta el 99, con el hueco del 04). El siguiente libre es el **101**.

Cinco bloques, **13 asertos**, todo por el camino del jugador salvo la entrega de los
`narrative_status`, que va a mano por el socket ya abierto con la forma que el 38 registró de los
frames reales — misma técnica y mismo motivo que el 38: lo que se mide es el REPARTO y el PINTADO,
no el motor.

- **A** · el progreso que llega **cuando la línea no existe** (jugador en el home) espera en la
  tarjeta y se lee al abrir el selector, con sus minutos.
- **B** · la tarjeta **sin estado** deja la línea vacía y **borra `data-gen-phase`**.
- **C** · lo que llega mientras se mira otra tarjeta **se apunta igual**: al volver se lee el ÚLTIMO
  mensaje, no el que había al irse.
- **D** · la rama de **error**: rojo con su motivo, entrada en el registro, y el motivo **sobrevive
  al repintado** que dispara la propia fase terminal.
- **E** · y sobrevive a irse al home y volver: lo guarda el título, no la pantalla.

**PROBADO EN NEGATIVO**, un sabotaje por vez, restaurado desde copia con `md5sum` comprobado las
cinco veces (`aa74d353…` para la raíz, `04eb5c58…` para la hoja):

| Sabotaje | Resultado |
|---|---|
| `progresoDe: () => undefined` (la hoja deja de ver el mapa) | **rojo A, C, D-supervivencia y E** — y **verde** lo que pinta el oyente de la raíz: las dos mitades se miden por separado |
| quitar `line.removeAttribute("data-gen-phase")` | **rojo B** (y la primera afirmación de C) — `{"texto":"","fase":"progress"}` |
| `progresoDelMundoMirado()` devolviendo `[...map.values()].at(-1)` (la ranura única de antes de #313) | **rojo C** con el síntoma histórico: el mensaje de un mundo bajo la tarjeta de otro |
| quitar el `errors.push("narrative", …)` de la raíz | **rojo D** — «no ocurrió en 10000 ms · 67 sondeo(s), 0 con la sonda rota» |
| que la fase `error` deje de repintar el selector | **rojo** en la espera del repintado — «no ocurrió en 30000 ms · 199 sondeo(s)» |

Cada sabotaje pone rojo **su** bloque y deja verdes los demás. Cero créditos: `sinMotor` declarado,
no arranca partida y nunca pulsa `#ts-gen-world` ni `#ts-apply-style`.

---

## Workarounds usados, y su veredicto

| Workaround | Para qué | ¿Le pasa al jugador? |
|---|---|---|
| Entregar los `narrative_status` a mano por el socket abierto (guion 100) | Los tres estados de la costura C1 que no pisaba nadie, incluida la fase `error` | **No es estado sintético**: es el MISMO frame que manda el bridge, con la forma que el 38 registró de los reales, entregado por el mismo camino (`sock.onmessage`). La alternativa —dos generaciones de verdad— no da nunca `error` a voluntad y deja el guion a merced del reloj del job. Técnica ya establecida por el 38. **No es hallazgo** |
| `NEFAN_GAMES_DIR` a un directorio vacío | Ver qué hace el título cuando el bridge no tiene mundos (criterio 26) | **No es estado sintético**: es un juego recién instalado sin mundos, o un `NEFAN_GAMES_DIR` mal puesto. El título lo dice bien. **No es hallazgo** |
| Cinco sabotajes en `title-screen.ts`/`selector-de-mundo.ts`, uno por vez | Probar el guion 100 en negativo | Restaurados, `md5sum` comprobado las cinco veces. **No es hallazgo** |
| Dos sondas de oyente (una sobre `document`, otra sobre `<html>`) + la sonda ensanchada del 99 | Medir el punto ciego de H2 y su arreglo | Restaurados los dos ficheros y el guion, `md5sum` comprobado (`ede7caa9…` para el 99). **No es hallazgo** |
| Dos imports prohibidos (dinámico y re-export) | Probar el candado por dos puertas nuevas | Retirados, md5 comprobado. **No es hallazgo** |
| 19 líneas de relleno en la hoja (451) y `"lineas": 700` en el contrato | Probar `max-lines` y el trinquete en negativo | Restaurados, md5 comprobado. **No es hallazgo** |
| Ninguno para VER el selector | — | **Se llega por el camino del jugador**: `./start.sh --preset e2e-sin-creditos`, «Nueva partida». Sin ocultar overlays ni forzar estado |

Tras las **once** sondas, `git status` no ve un solo fichero modificado —solo mis tres entregas— y
los md5 de los cuatro que se tocaron son los de partida: `aa74d353…` (`title-screen.ts`),
`04eb5c58…` (`selector-de-mundo.ts`), `b01239cd…` (`client-file-size.json`), `ede7caa9…` (guion 99).
Ningún servidor ajeno tocado: el stack manual se levantó con `NEFAN_PORT_OFFSET=500` desde ESTE
árbol y se paró con `--parar` del mismo árbol (el launcher enumeró y mató los tres procesos suyos).

---

## No probado

- **Gasto real de créditos**: por diseño (`e2e-sin-creditos`, motor falso). 75 declaraciones
  `fake:true` en la corrida completa.
- **`generarElMundo` y su confirmación armada de dos clicks** (`regenArmedUntil`): cualquier click
  encola trabajo real en el bridge. Es el único handler NO idempotente de la pantalla, o sea el sitio
  donde un oyente duplicado gastaría sin preguntar, y sigue siendo el hueco que el 99 declara. Lo que
  sí está medido es que el 38 lo conduce de verdad —con el motor falso— y sale verde.
- **La llegada de un `game_gen` con el título en OTRA pantalla** (editor, «Crear mundo») o **oculto
  en partida**: verificado por lectura y por equivalencia verbatim (las dos guardas —`#ts-gen` en el
  DOM y `root.style.display !== "none"`— son byte a byte las de `HEAD~1`), **no ejecutado**.
- **`CONFIG.graphics.ai_skin` apagado** (el par de personajes con la opción muerta): exige tocar el
  config del core; no lo conduje.
- **CRAP / cobertura / mutación**: el cliente está fuera del perímetro medido. Los doce módulos que
  `npm run afectado` selecciona por el barrido de rastro en `nefan-core/src` los midió el ingeniero
  (siete, 0 supervivientes nuevos) y pidió los cinco que no caben; **no los volví a medir**: el diff
  de esos dos ficheros es comentario puro y lo comprobé (criterio 20).

---

## Para el coordinador

1. **Nada bloquea.** Los dos hallazgos de esta PR son de una línea cada uno: la frase del informe que
   publica un comando que no reproduce (H1) y las **tres líneas** de la sonda del guion 99 (H2), que
   dejo **medidas** en las dos direcciones (roja con el sabotaje, verde en limpio). H2 puede ir en la
   vuelta de esta PR o en la 6, que es la que mueve el chasis y con él los cinco oyentes de por vida
   — pero conviene que vaya ANTES de la 6, porque la 6 es la que más puede filtrar.
2. **C1 está verificado, no aceptado.** Las dos mitades del progreso dicen lo mismo, y ahora hay un
   guion que se pone rojo cuando dejan de decirlo — incluido el síntoma histórico de #313. Los tres
   estados que el informe declaraba cubiertos «por el verbatim y no por ejecución» están ejecutados.
3. **El margen de la PR 6, confirmado y peor de lo que dice el plan**: la raíz queda en 682 y lo que
   la 6 se lleva (chasis ~300 + avisos ~65, menos su cableado) la deja en **~390-410**, con ~50 de
   margen. Si hiciera falta más, H5 nombra los dos sitios donde mirar antes de tocar el enrutador —y
   el aviso es que **ninguno de los dos puede irse a la hoja del selector**, que cabe con 18 líneas.
4. **`selector-de-mundo.ts` está a 18 líneas del tope y es la pantalla con más churn del título**
   (23 de los 39 commits de los últimos 30 días). Quien la toque por contenido se topará con
   `max-lines` antes que con nada; la salida sigue escrita en el plan §8 y no se ha gastado.
5. **Dos hallazgos preexistentes que el jugador VE** (H3 el botón «Continuar →» cortado, H4 el
   «Volver» del editor que olvida mundo, estilo y modos) más los tres apuntes de la crítica visual.
   Recomiendo agruparlos en **#427** en vez de meterlos en esta PR: los dos son conducta, no formato.
6. **La batería sigue sin ser estable y la lista de intermitentes CRECE**: dos corridas mías, dos
   rojos distintos, los dos verdes al aislarlos, y el **81** es nuevo (75/80/91/93 → +81). Merece
   entrar en #545, con el dato de que el 81 falla por COLOCACIÓN de spawns (la forja vecina tapa la
   dirección que el guion espera libre), que es un disparador distinto del `#error-log` heredado.
7. **El siguiente número libre de guion es el 101.**
