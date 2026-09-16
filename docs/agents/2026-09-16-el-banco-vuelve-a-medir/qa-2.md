# QA — Tanda F, PR 2 (#638) · «el registro sabe de quién es cada entrada»

Árbol `/home/al/code/ne-fan-qa-f2`, desprendido en `2b07674e` sobre `main` = `6953b7c5`.
**`main` YA TRAE LA PR 1** (`dc51be67`, #635), así que el 82 corre entero y esta validación no
ha necesitado el overlay que `implementacion-2.md` §4 describe: lo que allí se dice de «el 82 no
sale verde partiendo de `main`» **ya no es cierto** y se ha medido en vivo.

Cero créditos en todo lo de abajo (motor falso, `e2e-sin-creditos`, `renderMode: "vector"` donde
tocaba). Ningún proceso ajeno tocado: todo por `node qa/run.mjs`, que elige su propio bloque.

---

## Criterios de aceptación, sacados de la petición LITERAL

La petición del usuario, verbatim: **«Marcar cada entrada y filtrar al pintar»** — cada entrada
marcada como de la PARTIDA o de la MÁQUINA, y al cambiar de sesión solo se retiran las primeras.
Descartó explícitamente mover los `push` de sitio y vaciar solo al entrar.

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **Cada entrada queda marcada** como de la partida o de la máquina | ✅ | `ErrorEntry.source: FuenteDeError` + `PERTENENCIA_POR_FUENTE` (`Record` total de 15 filas) en `nefan-core/src/session/pertenencia-del-registro.ts`. La marca se DERIVA de la fuente, no se declara por llamada |
| 2 | **Al cambiar de sesión solo se retiran las de la partida** | ✅ | Guion nuevo `143`, corrido en el juego real: tras «Comenzar» quedan las **12 de la máquina** y se van las **3 de la partida**, fila a fila con el nombre en el aserto (19 asertos verdes) |
| 3 | Los dos diagnósticos que #497 se llevaba **sobreviven** | ✅ | **27** verde: `registro: 12 entradas, remedio en el DOM: true` (en `main` era `{"entradas":0,"remedioEnElDom":false}`). **92** verde: el aviso de #537 llega al registro y sus tres asertos pasan |
| 4 | **Diff cero** en los guiones 27 y 92 | ✅ | `git diff main..HEAD -- qa/guiones/27-*.mjs qa/guiones/92-*.mjs \| wc -l` → **0** |
| 5 | **No se movió ningún `push` de sitio** (alternativa descartada por el usuario) | ✅ | El diff de `main.ts` y `narrative-client.ts` cambia SOLO el literal de la fuente y comentarios; ningún `errors.push` cambia de función ni de orden |
| 6 | **No se vacía «solo al entrar»** (la otra alternativa descartada): el olvido ocurre en las DOS transiciones | ✅ | `porValor` en `main.ts:171`. Medido en las dos: salida → guion **82**; entrada → guion **143**. Con el olvido cableado solo a la salida, el 143 sale rojo (§ Hallazgo 1) |
| 7 | El **candado de #497** sigue vigente y ahora **distingue el defecto** que vino a cerrar | ✅ | Guion 82, 6 asertos verdes. Sabotajes reproducidos uno a uno (tabla abajo): la tabla de la PR es **exacta** |
| 8 | La **totalidad de la tabla** la sujeta el compilador, en las dos direcciones | ✅ | Fuente sin fila → `TS2741` en `pertenencia-del-registro.ts(86,14)` (rojo en el tsc de core **y** en el del cliente). Fila en core sin color → core **verde** y `TS2741` en `src/ui/error-log.ts(187,7)`. `errors.push("inventada", …)` → `TS2345` en `src/main.ts(1346,17)` |
| 9 | **Todos** los lectores de la etiqueta `session` retiquetados (`grep` a cero) | ✅ | Seis en la PR (18, 77, 78 + los tres candados de fixtures). Barrido propio en `qa/`, `labs/` y `nefan-html/src`: **no queda ninguno más** (§ Método, punto 4) |
| 10 | Ningún umbral bajado | ✅ | `git diff main..HEAD` no toca `arch-rules.json`, `quality-thresholds.json` ni `client-file-size.json`. `main.ts` sigue en **1378** líneas exactas, la cifra congelada |
| 11 | `npm run verify` (core) verde y el cliente limpio | ✅ | `npm run verify` → **EXIT=0**, `tests 2917 · pass 2917 · fail 0`. `cd nefan-html && npx tsc --noEmit` → 0 · `npm run lint` → 0 · `npm run build` → 0 |
| 12 | La batería no empeora | ✅ | Corrida ENTERA sobre este commit, árbol quieto: **140 en verde · 1 en rojo · 1 SIN MEDIR de 142**. El único rojo es el **39**, que ya estaba antes de la tanda y no tiene issue. Log: `scratchpad/bateria-qaf2.log` |
| 13 | **La marca es visible para quien lee el panel** | ❌ | La marca existe en el modelo y NO se pinta: el panel no distingue una entrada heredada de otra de la partida en curso (§ Hallazgo 3, con captura) |
| 14 | La clasificación de las 15 filas es **correcta** fila a fila | ⚠️ *tres filas discutibles* | `fps-atlas`, `render` y `portrait` clasificadas como MÁQUINA tienen emisores cuyo texto nombra la partida (§ Hallazgo 2) |
| 15 | La mutación del módulo nuevo | ⚠️ no probado | `break: "sin medir"` por diseño del instrumento: la primera medida exige corrida autorizada |

---

## Hallazgos

### 1 · IMPORTANTE — el tercer defecto que la pareja del 82 NO ve: olvidar solo al SALIR

La PR pide comprobar su tabla de dos sabotajes. **La reproduje entera y es exacta**, con la salida
literal de cada corrida:

| `olvidarLaPartida()` | «retira el error de la partida (#497)» | «…y NO se lleva lo que la máquina sabe» |
|---|---|---|
| como queda en la PR | ✔ | ✔ |
| `this.entries = []` | ✔ | ✘ `registro tras «Volver al título»: — sin errores —` |
| no-op | ✘ `character-sprites.ts:196:23` | ✔ |

Pero hay un **tercer defecto de la misma familia que se escapa de los dos asertos, y de los otros
dos guiones también**. Cableando la faceta a olvidar solo cuando la partida se va:

```ts
// nefan-html/src/main.ts:171
errores: ({ sessionId }) => { if (!sessionId) errors.olvidarLaPartida(); },
```

el resultado medido (una sola corrida, los cuatro guiones):

```
✔ 27-el-clon-limpio-quiere-jugar
✔ 82-volver-al-titulo-desviste-al-jugador
✔ 92-el-estilo-que-ofrece-el-titulo-es-el-que-pone-el-bridge
✘ 143-el-registro-marca-de-quien-es-cada-entrada   (las tres filas de PARTIDA en rojo)
```

O sea: **los tres guiones que la PR cita como su demostración salen verdes con la mitad del
cableado rota**, y esa mitad tiene conducta real — el título registra entradas de la partida antes
de que exista ninguna (`paso(bootstrap(), "session", "arrancar el cliente")` en `main.ts:1130`, y
el «la pre-generación del mundo falló» de `ui/title-screen.ts:140`, que es `narrative`), y son las
que el `enter` tiene que retirar. Es exactamente la lección repetida de la casa: *el candado nuevo
cubre menos de lo que su nombre promete*.

**No es un defecto del código entregado** (el cableado es correcto): es un **agujero de medida**, y
lo cierra el guion que dejo, `qa/guiones/143-el-registro-marca-de-quien-es-cada-entrada.mjs`, con
su fila en `qa/README.md` y probado en negativo tres veces.

Pasos de reproducción desde el arranque: `node qa/run.mjs 143` sobre el árbol tal cual (verde);
aplicar el cableado de arriba y repetir (rojo en `narrative`, `scene` y `session`).

### 2 · IMPORTANTE — tres filas de MÁQUINA tienen emisores que nombran la PARTIDA

La tabla clasifica por FUENTE, y el ingeniero partió `session` → `session` + `arranque` justamente
porque una fuente cargaba dos sujetos. **Ese mismo defecto sigue vivo en tres filas más**, y esta
PR lo empeora: antes `clear()` se las llevaba todas, ahora se quedan **para siempre**, nombrando un
mundo que ya no existe — que es la definición de «#497 deshecho» que el propio informe usa para
justificar `main.ts:1329`.

| Fila | Emisor | Texto que registra | Sujeto real |
|---|---|---|---|
| `fps-atlas` = máquina | `scene/fps-atlas.ts:129` (**su ÚNICO emisor**) | `re-disparo del atlas de ${key}` | el atlas de **un tile concreto** |
| `render` = máquina | `ui/world-labels.ts:145` | `rótulo "${label.id}": su caja mide W×H px…` | una **entidad** de la partida (NPC, enemigo, spawn de runtime) |
| `render` = máquina | `renderer/fps-renderer.ts:175` | `el tile ${key} no compone en la vista fps` | un **tile** de la partida |
| `portrait` = máquina | `ui/portrait.ts:120` (**su único emisor**) | `sin retrato para "${skinModel ?? baseModel}"` | el **aspecto del jugador de esa partida** |

Lo de `fps-atlas` es lo más claro, porque **la fila se contradice con su propio `porque`**:

> `/** El disparo del atlas de superficies como SERVICIO (re-disparos, cuotas); lo que le pasa al
> atlas de un tile concreto va por `scene`. */`

…y su único emisor es precisamente el re-disparo **de un tile concreto**. Es la señal temprana que
el plan §8 escribió para sí mismo: *«una fila cuyo `porque` no se puede escribir en media línea»*.

Qué ve quien juega: termina una partida en la que falló el atlas de `tile_1_0`, empieza otra, y el
panel de la partida nueva sigue diciendo «re-disparo del atlas de tile_1_0» — un tile que en este
mundo es otro sitio. Igual con el rótulo de un NPC que ya no existe.

**No reproducido en vivo**: los cuatro emisores cuelgan de fallos que no sé forzar sin trucar el
borde, y trucarlo sería el workaround que la regla prohíbe. Es un hallazgo de código, con línea y
texto, no una medida de pantalla — lo digo con su nombre.

Mi guion 143 **afirma la tabla tal como está hoy**, no que esté bien: si estas filas se parten
(como se partió `session`), el 143 sale rojo en la fila que se mueva. Está escrito en su cabecera y
es a propósito: mover una fila es una decisión y tiene que verse.

### 3 · MENOR-IMPORTANTE — la marca no se PINTA: el panel no dice qué es herencia

La petición dice «marcar cada entrada **y filtrar al pintar**». El filtrado está; **la marca no
llega nunca a la pantalla**. Captura del estado real, con 12 entradas heredadas nada más entrar a
una partida recién creada:

`qa/capturas/2026-09-16T19-11-36-547Z-579613/143-…-02-registro-tras-entrar-a-la-partida.png`

Lo que se ve: el panel ocupa la columna derecha entera (320 px × casi toda la altura), la cabecera
dice **«Errores (12)»** a secas, y las doce entradas de la máquina son indistinguibles de un error
que acabara de ocurrir en este mundo. No hay separador, ni etiqueta «de la máquina», ni un «12 de
antes de esta partida». La única pista es la hora, y en una partida encadenada las horas están a
segundos de distancia.

Consecuencia para quien juega: un mundo nuevo **parece nacer roto**. Antes de esta PR el panel
arrancaba limpio y eso era el defecto (#497); ahora arranca con la herencia y sin decir que lo es.
El coste de arreglarlo es una clase CSS y una palabra por entrada.

**Lo que NO es un hallazgo, medido**: el panel acumulado **no tapa nada**. `z-index: 1` (debajo del
HUD, que va a 2), `display:none` con el título delante (#246) y `visibility: hidden` cuando se abren
gráficos, plugins o el muro — y eso tiene candado vivo, el guion **135** (#509), que lo mide con 20
entradas y a 500 px de ancho. El tope sigue en `MAX_ENTRIES = 200`, así que tampoco crece sin
límite; lo que sí puede pasar, y el plan §8 ya lo declara, es que una sesión larga con muchos fallos
de máquina empuje fuera lo de la partida en curso. Hoy no hay emisor de máquina repetitivo.

### 4 · MENOR — `main.ts:1130` se queda en `session` y es el único de los tres con consecuencia real

De los tres `push` con fuente `session` que el informe declara y no retiqueta, **solo uno tiene
consecuencia**, y el informe la mide bien:

| Sitio | Veredicto de QA |
|---|---|
| `main.ts:1130` · `paso(bootstrap(), "session", "arrancar el cliente")` | **Debe entrar en esta PR.** Es el fallo del arranque del cliente ENTERO —el sujeto es la máquina, sin discusión— y es la última instancia viva del defecto que la PR nombra: se registra en el título y se borra al entrar a jugar. Cuesta una palabra (`"arranque"`), y el comentario de al lado ya dice que es «la vía de escape» del arranque. Que sea difícil de alcanzar no lo hace de otra clase: `arranque` existe para eso y dejarlo fuera deja el conjunto incompleto |
| `net/game-client.ts:293` · `require_bridge is false but no offline mode exists` | **Defendible dejarlo.** Con esa config no arranca ninguna partida, así que no hay transición que lo borre. Consecuencia medida: ninguna |
| `ui/muro-de-carga.ts:306` · «Reintentar» pulsado sin oferta armada | **Defendible dejarlo.** Inalcanzable por construcción y el propio comentario lo dice |

### 5 · MENOR — `narrative` carga dos sujetos y el segundo se pierde al empezar a jugar

`ui/title-screen.ts:140` registra «la pre-generación del mundo falló» **en el título**, con fuente
`narrative` = partida. Al empezar a jugar se retira. Y el comentario de ese mismo `push` dice por
qué existe:

> *«AL REGISTRO TAMBIÉN, y no solo a la línea roja de la tarjeta … El texto rojo de
> `#ts-gen-progress` desaparece en cuanto se repinta el selector»*

…o sea, el registro se puso ahí **porque el otro canal es efímero**. Es la misma forma que el 92.

**Atenuante medido, y por eso es menor y no importante**: no es el único canal duradero. El estado
vive además en `this.gameGenStatus` de la `TitleScreen`, que sobrevive en la misma página, así que
volver al selector repinta el error del mundo en su tarjeta. Lo que se pierde es la copia
consultable **desde dentro de la partida**.

Recomendación: `title` (que ya existe y ya es máquina) para ese `push`, o una fila `mundo` nueva. No
bloquea la PR; si no entra, merece issue, porque es la misma operación que `session` → `arranque` y
la razón de dejarla fuera es «el plan no la pidió», que envejece mal.

### 6 · MENOR — «filtrar al pintar» se implementó como «filtrar y tirar»

`olvidarLaPartida()` **destruye** las entradas de la partida (`this.entries = loQueSobrevive…`), no
las esconde al pintar. Leída al pie de la letra, la petición admitía conservarlas y filtrar en
`render()`. **Consecuencia para quien juega: ninguna** —en las dos formas desaparecen del panel— y
la forma elegida es la que hace inexpresable el estado malo, que es la doctrina de la casa. Lo anoto
para que conste que se leyó la petición literal y se midió la diferencia, no para pedir un cambio.

---

## Lo que verifiqué de cada punto del encargo

**1 · Diff cero.** `git diff main..HEAD -- qa/guiones/27-*.mjs qa/guiones/92-*.mjs | wc -l` → **0**.
Los dos corridos juntos: `2 en verde · 0 en rojo de 2`.

**Y están verdes por la razón que la PR dice**, no por otra — y no me fío de la lectura del código,
lo medí: con `sprite` y `arranque` movidos a `"partida"` en la tabla de core (un solo sabotaje, todo
lo demás igual), los dos vuelven **al rojo exacto que tenían en `main`**:

```
✘ el cliente SÍ tiene escrito el remedio — {"display":"none","remedioEnElDom":false,"entradas":0}
✘ ERROR: timeout esperando: el registro del jugador recoge el aviso del estilo de otro tema
0 en verde · 2 en rojo de 2
```

Las dos frases son, carácter a carácter, las que `requisitos.md` cita como el síntoma de partida. O
sea: lo que los cura es la clasificación, no un efecto lateral.

**2 · Tabla de sabotajes.** Reproducida entera, ver Hallazgo 1. Tercer defecto encontrado y
declarado.

**3 · Totalidad de la tabla.** Las dos direcciones comprobadas (criterio 8). Matiz que conviene
saber: **`npm run verify` de core SÍ caza la fila que falta** (el tsc de core sale con 2), pero
**NO caza el color que falta** — ese solo lo ve `cd nefan-html && npx tsc --noEmit`, que corre en el
job del cliente. El informe lo dice y es cierto.
Sobre las **once filas sin aserto propio**: el argumento del ingeniero («no hay conducta observable
colgando de ellas») era **falso**, y por eso escribí el 143: la conducta existe y es la que ve quien
juega — una fila mal puesta borra un diagnóstico que debía quedarse o conserva uno que debía irse.
Ahora las quince tienen aserto de conducta en el cliente, además del de totalidad del compilador. Y
al recorrerlas fila a fila aparecieron las tres discutibles del Hallazgo 2.

**4 · Los seis lectores de la etiqueta.** Están **todos**, y el barrido lo repetí por mi cuenta:
- `grep -rn '"session"' qa/ labs/ --include=*.mjs --include=*.js --include=*.ts` → quedan **dos**
  aciertos y los dos son correctos: el docblock del **81** (que cita el `errors.push("session", err)`
  del resume, que sigue siendo `session` a propósito) y la inyección del propio **82**.
- `grep -rn '\.error-log__source'` en `qa/` → los seis retiquetados a `arranque`, más el **28**
  (filtra `title` **y** `/portada/i`, no le afecta), el **19** (afirma que hay fuente `title`, no le
  afecta) y el **13** (lee la fuente pero no la afirma).
- En `nefan-html/src`: la única comparación de fuente viva es `titulo/avisos.ts:117`
  (`aviso.source === "bridge"`), intacta. No hay ningún `push` con fuente calculada fuera de
  `async-ui.ts:96`, que la recibe ya tipada.
- Los tres retiquetados de `qa/*.mjs` **no corren en `candados-headless`** (abren navegador), así que
  su rojo no lo vería el CI: los corrí a mano (abajo).

**5 · Lo declarado y no hecho.** Medido uno a uno: Hallazgos 4 y 5.

**6 · Adversarial y crítica visual.** Hallazgo 3, con captura y con lo que NO es hallazgo (el panel
no tapa nada y tiene candado).

**7 · El 104 y la corrida contaminada.** Verificado en la batería de esta validación, sobre un árbol
quieto: **`✔ 104-el-registro-de-la-partida-cabe-entero`**, con
`geometría del registro: {"lineas":8,…,"overflow":"hidden","contenido":132,"caja":132}`. La
autocrítica del ingeniero era correcta y su corrida de referencia estaba contaminada por él; la de
este informe no lo está — no toqué un fichero del árbol mientras corría, y todos los sabotajes se
hicieron antes o después.

**Los tres rojos conocidos que no son de esta PR**, medidos aquí: el **39** sigue rojo (mismo
aserto, «el exento que pulsa Comenzar se trae SU propio motor — 116-lo-elegido-vuelve-del-editor»);
el **75** salió **verde** (su intermitencia, sin issue abierto según el crítico); el **141** salió
**verde** y recorrió las ocho grabaciones — o sea el ENOENT de `implementacion-2.md` §8 era el
worktree y no el código, y con `labs/narrative/runs/` copiado el guion mide. #639 sigue valiendo
como issue: el guion muere con un ENOENT de Node en un clon limpio en vez de decir qué le falta.

---

## Guiones que dejo

- **`qa/guiones/143-el-registro-marca-de-quien-es-cada-entrada.mjs`** (nuevo) — la transición de
  ENTRAR y las quince filas, por el camino del jugador (título → «Comenzar»). 19 asertos.
  **Probado en negativo tres veces**, restaurando entre una y otra (`md5sum` comprobado):
  `this.entries = []` → rojas las doce de la máquina; no-op → rojas las tres de la partida; la
  faceta olvidando solo al salir → rojas las tres de la partida **con el 27, el 82 y el 92 verdes**.
- Fila correspondiente añadida a `qa/README.md`.

---

## Workarounds usados

**Ninguno que afecte a quien juega.**

1. **Inyectar entradas con `errors.push` desde `page.evaluate`** (lo hace el 82 y lo hace mi 143).
   Es la única forma de recorrer las quince fuentes: doce de ellas solo las emite un fallo que no se
   puede provocar sin trucar un borde. Lo que se inyecta es la MISMA puerta de producción
   (`ui/error-log.ts`), no un estado sintético del panel, y la transición que se mide es la real
   (`#ts-start` de verdad, `session.enter` de verdad). **Veredicto: no es un hallazgo.**
2. **Sabotear `ui/error-log.ts` y `main.ts` para las pruebas en negativo**, restaurados uno a uno con
   `md5sum` comprobado y `git status --porcelain` limpio al final. Es el método, no un apaño.
3. **Lo que NO hizo falta**: el overlay de la rama `f1` sobre el guion 82 que describe
   `implementacion-2.md` §4. PR 1 está en `main`, el 82 corre entero y sale verde con sus seis
   asertos. Esa sección del informe de implementación está **caducada** y conviene decirlo al
   coordinador para que no la repita.

---

## No probado

- **Mutación del módulo nuevo.** Nace con `break: "sin medir"` y `permisoLocal` rechaza el coste
  desconocido: la primera medida exige corrida autorizada. Correcto por diseño, pero **hoy la tabla
  no tiene ni un mutante medido**: lo que la sujeta son el compilador, los seis tests de core y —
  desde esta validación — el guion 143.
- **Los cuatro emisores del Hallazgo 2 en vivo.** Cuelgan de fallos que no sé provocar sin trucar el
  borde; el hallazgo es de código, con línea y texto.
- **Gasto real de créditos.** Toda la validación es motor falso: nada de lo de aquí dice qué pasa con
  Imagen IA encendida.

---

## Veredicto

**APTO CON HALLAZGOS.**

Lo que se pidió está hecho y demostrado con la demostración que se pedía: **los guiones 27 y 92
pasan de rojo a verde con diff cero**, y lo hacen por la clasificación y no por casualidad (lo
prueba el sabotaje que los devuelve a su rojo literal de `main`). El candado de #497 conserva su
dirección y gana la que le faltaba, con la tabla de sabotajes reproducida exacta. La totalidad la
sujeta el compilador en las dos direcciones. Los seis lectores de la etiqueta están todos y el
`grep` sale a cero. `verify` verde (2917 tests), cliente limpio, ningún umbral tocado, y la batería
entera queda en **140 · 1 · 1 de 142** con el único rojo siendo el que ya estaba.

Ninguno de los cinco hallazgos bloquea. Lo que devuelvo al ingeniero, por orden:

1. **Hallazgo 1 ya está cerrado por QA**: el agujero de medida lo tapa el guion 143 que dejo. No hay
   nada que arreglar en el código; sí conviene que el coordinador sepa que los tres guiones que la
   PR cita como su demostración salen verdes con media faceta rota.
2. **Hallazgo 4 debería entrar en esta PR**: `main.ts:1130` a `"arranque"`. Una palabra, y es la
   última instancia viva del defecto que la PR nombra.
3. **Hallazgos 2 y 5 son decisión, no arreglo**: partir `fps-atlas`, `render` y `portrait` como se
   partió `session`, y decidir dónde va «la pre-generación del mundo falló». Si no entran aquí,
   **issue**, porque la razón de dejarlos fuera («el plan no lo pidió») es la que envejece mal —y la
   fila de `fps-atlas` se contradice con su propio `porque`, que es deuda escrita, no olvidada.
4. **Hallazgo 3 es de interfaz** y se decide con el usuario: la marca existe y no se pinta.

Y una corrección de método para el coordinador: la §4 de `implementacion-2.md` («el 82 no sale verde
partiendo de `main`, hace falta el overlay de la PR 1») **está caducada** desde que #635 entró en
`main`. El 82 corre entero, solo, y sale verde con sus seis asertos.
