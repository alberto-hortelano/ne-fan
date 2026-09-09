# QA — PR 2 de #346 «El título troceado» · las dos pantallas del estilo

Árbol: `/home/al/code/ne-fan-346-2qa` (worktree desprendido en `fca2f341`, punta de la PR #547).
Base de comparación: `5bfa8a84` (PR 1 dentro). Contra `main` (`1c7bf189`) para lo que no toca la PR 1.

**VEREDICTO: APTO CON HALLAZGOS.**
Ningún hallazgo bloqueante. **La zona de dinero es byte a byte la de antes** —lo comprobé por mi
cuenta y con una medida más fuerte que la del ingeniero— y **el enrutador hace lo que su comentario
promete también cuando falla**, que es justo lo que su banco A/B no llegaba a probar. Lo que devuelvo
son cinco hallazgos (uno importante, cuatro menores), todos de proceso, de exactitud o latentes, y un guion nuevo (el
**97**) que canda la aritmética del dinero en el flujo real.

---

## 1. Criterios → veredicto

| # | Criterio (de la petición y del encargo) | Veredicto | Evidencia |
|---|---|---|---|
| C1 | **Sin cambiar comportamiento**: los cuerpos movidos son los de HEAD | ✅ | `qa-byte.py`: **0 diferencias BYTE A BYTE** en las 83 líneas de `plan-de-estilo` y las 164 de `subir-estilo` tras aplicar SOLO las 4 sustituciones declaradas y un dedent de 2. `ROTULO_DE_CARPETA`: idéntico sin dedent |
| C2 | Las 38 diferencias de HTML crudo son **solo sangría** | ✅ (y más fuerte) | Delta de sangría medido línea a línea: **−2 en las 83 y en las 161** líneas con contenido, sin una sola excepción. O sea: `linea_de_HEAD == "  " + linea_de_hoy`, siempre |
| C3 | …y esa sangría no mueve un píxel | ✅ | Sonda C en navegador real: se pinta el HTML que emite el módulo y, al lado, **el mismo con +2 espacios por línea** (lo que emitía HEAD). **35 cajas, 0 distintas** en geometría, `color`, `background`, `font`, `border`, `display`; `innerText` idéntico |
| C4 | `plan-de-estilo` — el **coste que se enseña** es el de antes | ✅ | C1 lo garantiza por construcción; medido además en vivo (sonda B1 y guion 97): total `~$1.65 + ?`, botón `Aplicar estilo (~$1.65 + ?)`, caché deshabilitada, `Registrar (sin coste)` con nada encendido |
| C5 | …los **checkboxes** que lo modifican | ✅ | Sonda B1: cada casilla encendida/apagada, total recalculado; guion 97 en el flujo real: apagar «Librería de superficies» baja el total exactamente `$0.30` y encenderlo lo devuelve |
| C6 | …y el **desenlace del batch** | ✅ | Sonda B2 (batch OK), B3 (batch que revienta), B4 (el plan que rechaza), B5 (cancelar). En los tres desenlaces el mensaje y el estado de los botones son los del código de HEAD |
| C7 | `StyleApplyController` usado como colaborador, **no reescrito** | ✅ | `git diff 5bfa8a84 HEAD -- nefan-html/src/ui/style-apply.ts` → **vacío**; `git diff main HEAD -- …` → **vacío**. 531 líneas, y su entrada de `client-file-size.json` ya dice `"issue": "#513"` |
| C8 | `ir(destino)` devuelve `Promise<void>` | ✅ | `title-screen.ts:1072  private ir(destino: DestinoDelTitulo): Promise<void>` |
| C9 | El `await ir(...)` sigue **dentro del `try`** en los tres sitios (`:1144`, `:1283`, `:1313` de HEAD) | ✅ | `plan-de-estilo.ts:124`, `subir-estilo.ts:184` y `:214`, los tres dentro de su `try` |
| C10 | **Provocado el fallo**, el `catch` sigue pintando el motivo y rehabilitando los botones | ✅ | Sonda con `ir` que RECHAZA, en la página real: `A1` → «Subida fallida: BOOM del enrutador» + `#ts-upload` habilitado · `A2` → «Generación fallida: …» + `#ts-complete` y `#ts-back` habilitados · `B2` → `#ts-style-progress` con el motivo + `#ts-style-run` y `#ts-style-cancel` habilitados |
| C11 | El `switch` sin `default` **no puede quedarse sin caso en silencio** | ✅ | Añadido `\| { a: "sonda-qa2" }` a `DestinoDelTitulo`: `tsc` → `src/ui/title-screen.ts(1072,42): error TS2366: Function lacks ending return statement…`. Restaurado (md5 idéntico) |
| C12 | D4 — las dos vías de «Subir estilo» hacen lo mismo | ✅ (trivialmente) | Las dos son literalmente `pintarSubirEstilo(this.subirEstilo())`. Ver **H2**: hoy la vía del enrutador no la emite nadie |
| C13 | El candado, sobre el import **RESUELTO**, por las puertas que el ingeniero no probó | ✅ | Sonda con `importsOf` + `checkArchitecture` reales: **rojo** en import dinámico, `export * from`, `export {X} from`, `export type {X} from`, subdirectorio hijo→padre, alias que da la vuelta, `require()` y `import type` de la raíz. **Verde** en los dos controles (`./atomos.js`, `../style-apply.js`) |
| C14 | Batería `node qa/run.mjs` — 94/94 | ⚠️ **no reproducido** | **Tres corridas completas mías dieron tres resultados distintos** (93/94, 92/95, 94/95) con **tres guiones rojos distintos** —80, 91 y 75—, ninguno alcanzable por el diff. Ver **H1** |
| C15 | El guion 95 es honesto (puede ponerse rojo) | ⚠️ **3 de 4** | Sondas N2/N3/N4 → rojo, cada una en su afirmación. **N1 (fuga de listener sobre `document`) → VERDE**, y su cabecera dice perseguirla. Ver **H3** |
| C16 | Ninguna hoja engancha a `document`, `window`, `root` ni `content` | ✅ | `grep addEventListener` en `titulo/*.ts`: 8 listeners, **todos** sobre nodos que la propia hoja crea dentro de `content`/`hueco`. Cero `document.`/`window.` ejecutables |
| C17 | Los **cinco de por vida** siguen siendo cinco | ✅ | `onProgresoDeMundo` `:162`, `ResizeObserver` sobre `content` `:290`, `scroll` de `content` `:292`, `#ts-close`, `error` en captura sobre `root` `:342`. Y la cuenta cuadra: `addEventListener` en la raíz **30 → 22**, exactamente los **8** que se llevaron las dos hojas (5 + 3) |
| C18 | Cifras del contrato con `wc -l` real | ✅ | `wc -l`: 1397 / 224 / 134 / 208, idénticas a `client-file-size.json` y a la tabla del informe. `test/client-file-size.test.ts` verde |
| C19 | `tsc`, `eslint`, candados de fronteras y deuda congelada | ✅ | `nefan-html`: `tsc --noEmit` exit 0, `eslint .` exit 0. `test/architecture.test.ts` + `client-file-size` + `qa-lib-tiene-quien-lo-mire` + `afectado`: **218/218**. Deuda congelada intacta: `html-sin-catch-silencioso` 4, `html-sin-promesa-muda` **7**, css 1, puerto 1 |
| C20 | Crítica visual de las dos pantallas | ✅ con observaciones | Capturas reales del banco (07, 94-03, 95-01/04) y la del guion 97. Ver **§5** |
| C21 | Cero créditos | ✅ | Todo contra `e2e-sin-creditos` (⛨ guardarraíl `fake:true` en cada corrida) y `html-fixtures` en el bloque `+700`. **`#ts-style-run` no se pulsó ni una vez** en el guion 97; el batch solo se corrió contra el motor falso (guion 07, como siempre) |
| C22 | Gasto real de créditos idéntico al de antes | ⚠️ **no probado** | No se ha ejecutado un batch de pago real. Lo que sí está probado es que el CÓDIGO que lo dispara es byte a byte el de HEAD (C1) y que la cifra prometida es la suma de lo encendido (guion 97) |

---

## 2. Lo que el banco A/B del ingeniero NO cubre (y sí cubrí yo)

Sus 44 pasos ejercitan las dos pantallas con `ir` **resolviendo**. Faltaba justo lo que sostiene la
desviación **D2**:

1. **El enrutador RECHAZANDO.** Es el único escenario en el que `Promise<void>` se distingue de
   `void`, y su A/B no lo ejercita: comparaba «la lista de navegaciones», no qué pasa cuando una
   falla. Cubierto ahora (C10), y el mecanismo **funciona**: el fallo aterriza en el `catch` que
   habla, no en el registro que el título tapa.
2. **Que el `ir` real PUEDA rechazar.** `renderWorldSelect` lanza por dos caminos —
   `await this.narrative.listGames()` rechaza con el motivo del bridge, y `games.length === 0` lanza
   («no games available in bridge»)—, así que el argumento de D2 tiene sujeto real y no es teórico.
3. **La aritmética del dinero en el flujo real** (no en un arnés): guion **97**, nuevo.
4. **Las cinco puertas del candado que no probó** (C13).
5. **La exhaustividad del `switch` como candado de compilación** (C11).
6. Sigue sin cubrir, y lo declaro igual que él: el camino de error del `FileReader` (#260).

---

## 3. Hallazgos

### H1 · La batería NO es estable hoy: tres corridas, tres rojos distintos — **importante · PREEXISTENTE**

El informe (§3.6) dice «94/94 a la primera, ninguna varianza esta vez». **No lo he reproducido, y
tampoco he reproducido un rojo estable**: corrí la batería entera cinco veces en este árbol y las
tres que valen (las otras dos las invalidé yo, ver abajo) dan tres números y tres culpables:

| Corrida | Resultado | Rojo(s) |
|---|---|---|
| 1 | `93 en verde · 1 en rojo de 94` | **80**-el-desplegable-room · `errores 4 → 5` |
| 2 | **log perdido** — lo pisó la corrida de la QA de la PR 3 (mismo `scratchpad`, mismo nombre de fichero). **No la cuento** | — |
| 3 | **abortada por mí**: renombré el guion 96→97 con la corrida en marcha (`ERR_MODULE_NOT_FOUND`). Sirve para una cosa: el **80 salió VERDE** (`errores 5 → 5`) | — |
| 4 | `92 en verde · 2 en rojo · 1 SIN MEDIR de 95` | **80** (`4 → 5`) y **91**-la-forja (`pared 1.60 vs core 1.15` — el rayo choca antes con un vecino) |
| 5 | `94 en verde · 1 en rojo de 95` | **75**-la-huella-del-tile (`barkeep: position` cambió: carrera de la vida ambiental) |

Los tres rojos son **rotatorios y ajenos al diff**: 80 va del selector «Room» de fixtures, 91 de la
huella de colisión de un cofre, 75 de la posición de un NPC al re-difundir un tile. Ninguno toca —ni
por el grafo de imports— `title-screen.ts`, las dos hojas nuevas ni `atomos.ts`. Y el guion nuevo
corre el ÚLTIMO por orden alfabético, así que no puede alcanzar a ninguno.

**Del 80 sí tengo reproductor**, y es de dos guiones:

```
$ node qa/run.mjs 80             → verde  (errores 1 → 1)
$ node qa/run.mjs 07 12 72 94 95 80 → verde  (errores 5 → 5)
$ node qa/run.mjs 79 80          → ✘ 80   (errores 4 → 5)
$ node qa/run.mjs 77 78 79 80    → ✘ 80   (errores 4 → 5)
```

El `#error-log` no se limpia entre guiones, y el 80 exige que elegir «-- Room --» no añada ninguna
entrada; cuando hereda el registro en 4 entradas, una quinta aterriza tarde durante ese paso y lo
tumba. Es fragilidad del 80 frente al estado que le dejan sus vecinos.

**De esta PR: NO.** Y **el 94/94 del ingeniero es un resultado posible**, no una afirmación falsa: mi
corrida 3 tenía el 80 en verde y la 5 dio 94/95. Lo que no se sostiene es la frase «ninguna varianza
esta vez» como característica del commit: la varianza está, la vio también la QA de la PR 3 (guion 93,
1 de 3) y ya tiene precedente escrito en #545. **Recomendación**: que el criterio de cierre del
programa («las 30 baterías del título verdes sin retocar un guion») se mida sobre los guiones del
TÍTULO, y ahí el dato es limpio: **los catorce salieron VERDES en las tres corridas válidas**
(`grep -E "^[✔✘⊘] (07|12|18|19|20|33|34|38|69|70|72|92|94|95)-"` → 14 ✔ en cada log). El 97 nuevo
salió ⊘ en la corrida 4 por mi propio fallo de `aisla` (§6) y verde en la 5. Que 75/80/91 se traten
como deuda del banco, con issue propio.

### H2 · `ir()` LANZA en vez de rechazar en sus dos destinos síncronos — **menor · de esta PR (latente)**

```ts
case "crear-mundo":
  this.renderCreateWorld();
  return Promise.resolve();
case "subir-estilo":
  pintarSubirEstilo(this.subirEstilo());
  return Promise.resolve();
```

`ir` no es `async`. Si `renderCreateWorld()` o `pintarSubirEstilo()` lanzan, `ir()` lanza
**síncronamente** en vez de devolver una promesa rechazada. Un llamante que escriba
`paso(ir(d), "title", "…")` —el idioma que la propia PR estrena para el «Volver»— recibe la excepción
**antes** de que `paso` llegue a correr, así que el fallo se sale del canal que `paso` existe para
poner. Los otros tres `case` no tienen el problema: delegan en métodos `async`, que convierten un
throw en rechazo.

Hoy es **inalcanzable** (nadie emite esos dos destinos, ver H4), pero `ir` es la forma que copian las
PR 3, 4 y 5, y el ejemplo del `case` está escrito. La forma que no puede fallar es `private async ir(...)`.
No lo verifiqué en ejecución —no hay emisor que provocarlo— y lo declaro como hallazgo **por lectura**.

### H3 · El guion 95 no ve la fuga que su cabecera dice perseguir — **menor · de esta PR**

Su docblock dice que lo que mide es «un listener sobre `document`, `window`, `#title-screen` o
`content`». Probado en negativo (fichero restaurado byte a byte, md5 idéntico tras cada sonda):

| Sonda metida en `pintarSubirEstilo` | Guion 95 |
|---|---|
| **N1** · `document.addEventListener("click", …)` en cada visita | **VERDE** ❌ |
| N2 · el listener de `#ts-add-row` enganchado dos veces | ROJO ✔ (`[{antes:1,despues:3}×4]`) |
| N3 · contador de módulo pintado en el `<h1>` | ROJO ✔ (`2: DISTINTA · 3: DISTINTA · 4: DISTINTA`) |
| N4 · un nodo colgado de `#title-screen` en cada visita | ROJO ✔ (`hijos 3 → 7`) |

Sus **tres afirmaciones** se ponen rojas, o sea que el guion vale; lo que sobra es la promesa de la
cabecera. `document` y `window` no aparecen en ninguna de las cinco medidas (chasis, `#title-screen-responsive`,
`#ts-mas`, `#ts-close`, digest de `content`), y una fuga ahí es exactamente la que sobrevive a todo
repintado. **Arreglo barato**: contar listeners con un `document.addEventListener` envuelto desde
`addInitScript`, o recortar la cabecera para que diga solo lo que mide.

### H4 · El informe dice «tres `case` sin emisor»; son **cuatro** — **menor · de esta PR (exactitud)**

§6 y el mensaje de commit dicen que los destinos que hoy no emite nadie son `crear-mundo`,
`subir-estilo` y `editor`. **`home` tampoco tiene emisor**:

```
$ grep -rn '"subir-estilo"\|"crear-mundo"\|a: "editor"\|a: "home"\|a: "selector"' nefan-html/src/
  … solo 4 emisiones, las cuatro { a: "selector" }
```

O sea: **1 de los 5 `case` está ejercitado**, no 2. No cambia ninguna decisión —C11 demuestra que un
`case` que falte no compila— pero la frase de la PR se queda corta y la va a heredar la rebase.

### H5 · Rastro: `arch-rules.json` nombra un método que ya no existe — **menor · de esta PR**

`nefan-core/data/contract/arch-rules.json`, `why` de `html-sin-promesa-muda`:

> «tres ni siquiera eran promesas — `renderCharacterEditor`, `renderCreateWorld` y **`renderUploadStyle`**
> son síncronos…»

`renderUploadStyle` dejó de existir en esta PR (es `pintarSubirEstilo`, en otro fichero). Es prosa
histórica, como la de `client-file-size.json`, pero quien la grepee no encuentra nada. Regla de la
casa: una retirada incluye el barrido de prosa.

---

## 4. Observaciones (ninguna es regresión: el código es byte a byte el de HEAD)

- **O1 · Un fallo de navegación DESPUÉS de haber gastado invita a pagar dos veces.** En
  `aplicarElEstilo`, si `ir` falla tras un batch correcto, el `catch` **sustituye** «Estilo aplicado:
  7 celdas y 3 skins nuevos ($2.50)» por el motivo del fallo y vuelve a habilitar
  «Aplicar estilo (~$X)». Medido (sonda B2: `progreso` acaba siendo solo «BOOM del enrutador»).
  **Preexistente y sin cambio** —el `await this.renderWorldSelect(gameId)` de HEAD estaba en el mismo
  `try`—, pero es el único sitio donde el `void` del plan original habría sido mejor que la promesa
  devuelta. Vale la pena un issue: el mensaje de «ya pagaste» no debería perderse.
- **O2 · «Aplicar estilo (~$0.00 + ?)».** Con solo un bloque sin precio encendido, el botón promete
  cero dólares por algo cuyo coste se desconoce. El `+ ?` está, pero la cifra de cabecera es `$0.00`.
  Preexistente.
- **O3 · El botón que gasta y el que no son visualmente idénticos.** «Aplicar estilo (~$0.30 + ?)» y
  «Registrar (sin coste)» comparten el mismo primario ámbar (captura del guion 97). En una pantalla
  de gasto, el estado «esto cuesta dinero» debería leerse sin leer.
- **O4 · La casilla del bloque en caché se ve igual que las demás.** `disabled` no la distingue a
  simple vista (capturas 07 y 97): el jugador se entera al no poder pulsarla.
- **O5 · El campo más importante de la subida es el más estrecho.** En la fila de imagen
  (`grid-template-columns: auto 1fr auto`), el desplegable de carpeta se come el ancho y el
  `data-desc` queda en ~90 px: el placeholder se corta en «qué muest» (capturas 94-03 y 95-01).
  Y la descripción es *la procedencia* del arte. Preexistente.
- **O6 · Cobertura de core 88,7 % < 89 %.** Confirmado que **no es de esta PR**: el diff no toca ni
  una línea de `nefan-core/src` (su único fichero de core es un JSON de contrato).

---

## 5. Crítica visual

Arranqué `NEFAN_PORT_OFFSET=700 ./start.sh --preset html-fixtures` desde mi árbol (bloque `+700`,
`ss -ltn` antes, `--parar` después; los stacks ajenos de `:3000/:9877/:9878/:18765` no se tocaron) y
juzgué las capturas del flujo real que produce el banco.

**Las dos pantallas están intactas y bien montadas.** «Subir estilo» tiene una jerarquía clara
—titular ámbar, explicación en gris, tres bloques (nombre / etiquetas / imágenes) y una barra de
acción con un solo primario— y respira: el eje vertical no tiene saltos raros y la columna de 720 px
es la correcta para un formulario. El panel de coste se monta dentro del panel de generación del
selector sin romperlo, con el desglose encima del total y el total encima del botón, que es el orden
en que se lee una factura.

Lo que sí anoto como director de arte, todo **preexistente**: el panel de coste vive al fondo de la
columna derecha y a 1280×800 su botón queda a ~50 px del borde inferior (en una ventana más baja cae
bajo el pliegue justo cuando pide una decisión de dinero); el primario no distingue gastar de no
gastar (**O3**); la casilla en caché no se lee como deshabilitada (**O4**); y la descripción de cada
imagen —el campo del que sale la clave de caché del arte— es el más estrecho de su fila (**O5**).

**Contra `main`, la comparación es por equivalencia demostrada, no por dos capturas superpuestas**:
la fuente es byte a byte la misma con un dedent uniforme de 2 (C1/C2), y el dedent está medido como
invisible en el navegador real (C3: 35 cajas, 0 distintas). No monté un segundo árbol en `main`
porque no habría añadido información sobre esas dos medidas.

---

## 6. Guion nuevo: `qa/guiones/97-el-coste-que-promete-el-boton-es-el-de-las-casillas.mjs`

Lo mecánico de la zona de dinero que **no miraba nadie**: el 07 entra al panel, lee el texto y pulsa
—nunca toca una casilla—, y el 72 solo mira si `#ts-apply-style` está deshabilitado. O sea que lo
primero que hace un jugador en esa pantalla (quitar bloques para pagar menos) no tenía candado.

Afirma, derivándolo de las **etiquetas que pinta el propio panel** (no de números fijos del bench):
el total es la suma exacta de lo encendido con precio y el botón repite esa cifra; el bloque en caché
va con la casilla deshabilitada; apagar un bloque baja el total exactamente su precio y encenderlo lo
devuelve; sin nada encendido el botón dice «Registrar (sin coste)»; un bloque sin precio se dice con
`+ ?` en vez de tragarse como 0. **Nunca pulsa `#ts-style-run`**: cero gasto.

**Probado en negativo, cuatro sondas, cada una revertida y con `md5sum` comprobado:**

| Sonda en `plan-de-estilo.ts` | Qué se puso rojo |
|---|---|
| `sinPrecio = false` (tragarse el bloque sin precio) | «un bloque encendido SIN precio no desaparece del total» + «…y el botón tampoco se lo traga» |
| El botón deja de llevar la cifra | «el botón promete la MISMA cifra que el total» + la del `+ ?` |
| El filtro de la suma ignora `selected` | «apagar … baja el total exactamente sus $0.30» + «sin ninguna casilla encendida el botón NO promete gasto» |
| Quitar el `disabled` del bloque en caché | «un bloque ya en caché lleva la casilla DESHABILITADA» |

**Y una quinta que salió VERDE, por eso el guion lo declara**: meter los bloques en caché en el
filtro de la suma no mueve la cifra, porque en el bench su precio interno es 0. El guion dice en su
cabecera que **eso no lo mide** en vez de dejar creer que sí — la afirmación se reescribió para que
diga exactamente lo que comprueba (la casilla deshabilitada).

**Y una lección que me dio la propia batería**: en la corrida 4 el guion salió con un `⊘ bloque no
medido` («ningún bloque encendido tiene precio») y degradó la corrida a exit 2. Causa: declaraba
`aisla = ["mundo"]` pero no `"fake-ai"`, y con la caché del motor falso caliente el plan llega con
TODOS sus bloques en «en caché ($0)» —`«Librería de superficies (23 celdas, 0 por pintar)»`—, o sea
sin nada que apagar. Es exactamente el motivo por el que el 07 declara las dos. Corregido a
`aisla = ["mundo", "fake-ai"]` y vuelto a medir: **12 afirmaciones verdes, cero `⊘`**, tanto aislado
como dentro de la batería entera (corrida 5).

Verde sobre el árbol de la PR: 12 afirmaciones. `test/qa-lib-tiene-quien-lo-mire.test.ts` y
`afectado.test.ts` siguen verdes con él dentro (218/218).

---

## 7. Workarounds usados, y por qué ninguno es un obstáculo del jugador

- **W1 · La sonda del enrutador importa los módulos con `import("/src/ui/titulo/…")` desde la página
  real y les pasa un `ir` que rechaza.** No oculté ningún overlay, no forcé ningún estado de la UI y
  no salté ninguna pantalla: la página es la del preset `html-fixtures`, el CSS es el de producción y
  los módulos son los publicados. Hizo falta porque el `ir` REAL solo rechaza si el bridge se cae o
  se queda sin mundos **a mitad de sesión**, y el banco no sabe provocar eso sin matar un proceso —
  que es justo lo que las reglas de la casa prohíben. **No es un hallazgo**: lo que se prueba es el
  contrato exacto de las dos hojas (`deps.ir` devuelve una promesa que puede rechazar), y la otra
  mitad —que el `ir` de verdad puede rechazar— está verificada leyendo `renderWorldSelect`.
- **W2 · Sabotajes temporales de `subir-estilo.ts` y `plan-de-estilo.ts`** para probar en negativo los
  guiones 95 y 97. Cada uno revertido inmediatamente y con `md5sum` comprobado (`ca7c08c9…` y
  `623879382…` idénticos antes y después). `git status` al terminar: solo el guion 97 nuevo.
- **W3 · Un destino de mentira en `DestinoDelTitulo`** para medir C11. Revertido, md5 idéntico.
- **W4 · DOS ERRORES DE MÉTODO MÍOS, declarados porque afectan a lo que puedo afirmar.** (a) Escribí
  la salida de la batería en `scratchpad/bateria2.log`, un nombre que la QA de la PR 3 usaba a la vez
  en el MISMO scratchpad de sesión: su corrida pisó la mía y perdí ese número (el fichero acabó
  citando su árbol, `ne-fan-346-3qa`, y su veredicto). Verifiqué los cuatro logs restantes por el
  árbol que citan antes de usarlos, y ese no lo cuento. (b) Renombré el guion 96→97 **con la corrida
  3 en marcha**, que murió con `ERR_MODULE_NOT_FOUND` — la regla del «árbol quieto» es de la PR 1 y
  me la salté yo. Las corridas 4 y 5 se hicieron con el árbol parado y con log de nombre propio.
- No hubo ningún workaround para **observar** las dos pantallas: se llega a las dos por el camino del
  jugador (`#ts-upload-style` y `#ts-apply-style`), y así las conducen los guiones 07, 12, 94, 95 y 97.

---

## 8. No probado

- **Gasto real de créditos** (C22): no se ha corrido un batch de pago de verdad, ni aquí ni en la PR.
  Lo probado es que el código que lo dispara es byte a byte el de HEAD y que la cifra prometida es la
  suma de lo encendido.
- **El camino de error del `FileReader`** (fichero ilegible, #260): igual que el ingeniero, no supe
  provocarlo de forma determinista. Su `try` está donde estaba, byte a byte (C1).
- **Los cuatro `case` sin emisor** (`home`, `crear-mundo`, `subir-estilo`, `editor`): no los ejercita
  nada porque nadie los emite. Compilan, y C11 garantiza que ninguno puede faltar en silencio.
- **La CONCENTRACIÓN** (siete hojas de 430 líneas): sin checker posible, como dice el `why` del
  candado. Hoy 224 y 134, con 2 y 3 colaboradores — el corte es el que prometía el plan.

---

## 9. Comandos (todos desde `/home/al/code/ne-fan-346-2qa`)

```bash
# equivalencia byte a byte (script propio, no el del ingeniero)
python3 …/qa-byte.py      → plan 83 vs 83 · 0 diferencias · subir 164 vs 164 · 0 · ROTULO idéntico
python3 …/qa-indent.py    → delta de sangría: −2 en 83 y en 161 líneas, sin excepción

# el candado por las puertas no probadas (importsOf + checkArchitecture reales)
npx tsx sonda-candado-qa.ts  → 8 formas prohibidas ROJAS, 2 controles verdes

# tipos, lint y candados
cd nefan-html && npx tsc --noEmit          → 0
cd nefan-html && npx eslint .              → 0
cd nefan-core && npx tsx --test test/architecture.test.ts test/client-file-size.test.ts \
       test/qa-lib-tiene-quien-lo-mire.test.ts test/afectado.test.ts   → 218/218

# la batería, cinco veces (logs con nombre propio a partir de la 3ª)
node qa/run.mjs   #1 → 93 en verde · 1 en rojo de 94   (rojo: 80)
node qa/run.mjs   #2 → LOG PISADO por la otra QA — no se cuenta (W4a)
node qa/run.mjs   #3 → abortada por mí a mitad (W4b); el 80 iba VERDE
node qa/run.mjs   #4 → 92 en verde · 2 en rojo · 1 ⊘ de 95  (rojos: 80 y 91)
node qa/run.mjs   #5 → 94 en verde · 1 en rojo de 95        (rojo: 75)
node qa/run.mjs 80             → 1/1 verde
node qa/run.mjs 79 80          → ✘ 80  ← reproductor mínimo del rojo del 80
node qa/run.mjs 77 78 79 80    → ✘ 80
node qa/run.mjs 07 12 72 94 95 80 → 6/6 verde

# el enrutador bajo fallo, en la página real (bloque +700, parado al terminar)
NEFAN_PORT_OFFSET=700 ./start.sh --preset html-fixtures
node …/sonda-enrutador.mjs http://127.0.0.1:3700/?offset=700   → 20/20 verde
NEFAN_PORT_OFFSET=700 ./start.sh --parar

# el guion nuevo y sus negativos
node qa/run.mjs 97             → 12 afirmaciones verdes
bash …/negativo-97.sh (+b)   → 4 sondas rojas, 1 verde declarada
bash …/negativo-95.sh          → 3 rojas (N2/N3/N4), 1 VERDE (N1 → H3)
```

---

## 10. Resumen para el coordinador

La PR hace lo que dice y lo hace bien: **el movimiento es verbatim demostrado byte a byte**, el
enrutador está justificado con una medida que ahora sí existe (el `catch` habla cuando la navegación
falla), `StyleApplyController` no se ha tocado ni una línea, el candado aguanta por las ocho puertas
que probé, y los listeners cuadran exactamente (30 → 22, los 8 que se fueron).

Antes de fusionar, dos cosas que no bloquean pero conviene decidir: que el informe deje de vender el
**94/94** como propiedad del commit (cinco corridas mías dan tres números y tres guiones rojos
rotatorios, todos ajenos al diff — **H1**), y si `ir` debe ser `async` para que sus dos `case`
síncronos no lancen fuera del canal (**H2**), porque esa forma la van a copiar tres PR más.

Y un aviso de proceso para la tanda: las dos QA compartimos `scratchpad` y nombres de fichero, y eso
ya se ha comido un número de batería (**W4a**). Con dos QA en paralelo, el nombre del log tiene que
llevar la PR dentro, y el veredicto hay que leerlo comprobando el ÁRBOL que cita.
