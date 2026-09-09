# QA — PR 4 de #346 «El título troceado» · el HOME

Árbol: `/home/al/code/ne-fan-346-4qa`, HEAD desprendido en `03f50ba5` (la punta de la PR).
Todo lo de abajo se midió ahí, con rutas absolutas, sin tocar `/home/al/code/ne-fan` ni
`/home/al/code/ne-fan-346-4`. Cero créditos: `e2e-sin-creditos` (motor falso), levantado por
`qa/run.mjs` en su propio bloque de puertos. No arranqué nada a mano.

## Veredicto

**APTO CON HALLAZGOS.** El movimiento es equivalente y está DEMOSTRADO con mi propio comparador —no
con el del ingeniero—: cero líneas de código difieren de `HEAD~1` tras las reescrituras declaradas, y
el residuo de `this.` en `home.ts` es `[]`. El cambio estructural que declara (C1, `modeArmed` a const
de módulo) es **cierto y hoy no tiene ocupante**, y lo digo con la evidencia que se me pidió: no existe
camino a dos vidas del título. Los tres estados que el informe declaraba cubiertos «por el verbatim y
no por ejecución» los he ejecutado, y **el home entero se comporta igual sobre el árbol de antes del
corte** (mi guion 98 sale verde en `1daea547` con `renderHome` todavía dentro de la clase). La primera
pantalla del juego es **idéntica píxel a píxel** (mismo md5) antes y después.

Los hallazgos son **dos de esta PR, los dos menores** (una cifra del contrato que no casa y un
`async` perdido, latente), **cuatro preexistentes** que este corte no causa pero que salen a la luz al
mirar el home entero —dos de ellos son defectos que el jugador ve—, **uno del banco** y **un aviso** de
intermitencia ya con dueño. Ninguno bloquea el código de esta PR.

---

## Tabla de criterios

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Sale el home a `ui/titulo/home.ts` con `pintarHome(deps, aviso?, tono?)` y SEIS colaboradores, sin objeto de contexto | ✅ | `wc -l` = 376. `DepsDeHome` = `{content, narrative, elegir, ir, avisos, avisarDeCorte}`, seis campos con nombre y doc propio (`home.ts:71-88`). Ningún `ctx` |
| 2 | **Sin cambio de comportamiento — el código movido es el de `HEAD~1`** | ✅ | **Comparador PROPIO** (`scratchpad/qa4/verbatim.py`), independiente del del ingeniero: reconstruyo los cuatro rangos de `HEAD~1` (65-67, 548-691, 693-695, 697-740, 1140-1212), desindento 2 y aplico mi lista cerrada de sustituciones → **0 líneas de código de diferencia**. Lo único que sale son las **3 reescrituras de prosa declaradas**, el **bloque de 10 líneas de doc de C1** (declarado) y un salto de línea final. `[l for l in home.ts if "this." in l]` → **`[]`** |
| 3 | **C1 · `modeArmed` de campo de instancia a const de módulo: ¿hay dos vidas que compartan el mapa?** | ✅ **no existe ese camino** | Cuatro medidas, abajo en §«El único cambio estructural». Resumen: **un solo `new TitleScreen` en TODO el repo**, en el top level de `main.ts:799`; `show()` se llama en bucle sobre ESA instancia (`main.ts:1266`), o sea que la vida del campo **ya era el realm y no el `show()`**; ningún import dinámico; **ningún módulo acepta HMR** (`import.meta.hot` solo aparece en `vite-hmr.d.ts`, y sin aceptante Vite recarga la página entera) |
| 4 | …y la propiedad que lo hace equivalente (`modeArmed.clear()` abre cada pintado) se comprueba EN EL JUEGO | ✅ | Guion 98 bloque C, por el camino del jugador (armar → «Nueva partida» → «Volver» → click): el badge vuelve a PEDIR confirmación. **Probado en negativo**: quitando el `clear()`, un solo click enciende Imagen IA y la escribe en disco — *gasto sin confirmar* |
| 5 | **Estado no visitado: 0 partidas** | ✅ | Guion 98 bloque A: `#ts-status` = «Bridge OK — 0 partidas guardadas.», `#ts-sessions` = «— Ninguna partida todavía —», 0 `.ts-save`, `#ts-new` presente y encendido, `#ts-error` oculto. Captura `…-01-home-sin-ninguna-partida.png` |
| 6 | **Estado no visitado: el desarmado del badge a los 5 s (`ARM_TTL_MS`)** | ✅ (con hallazgo visual) | Guion 98 bloque B: el badge se desarma solo y **el desarme OLVIDA**: el click siguiente vuelve a preguntar y el `state.json` sigue en `vector`. **En negativo**: si el `setTimeout` restaura el rótulo sin borrar la llave, ese click GASTA. El aspecto tras el desarme **no vuelve al de sus vecinos** → H3 |
| 7 | **Estado no visitado: `setRenderMode` que falla** | ✅ | Guion 98 bloque D, fallo inyectado en el BORDE (`chmod 0o500` sobre el directorio del save, el repro del 52): `#ts-status` = «No se pudo cambiar el modo de …_clon1: no se pudo escribir la partida: EACCES…», el badge no miente (sigue en Maqueta), el disco no cambió y la lista sigue con sus 3 tarjetas. Captura `…-modo-que-no-se-pudo-cambiar.png` |
| 8 | **Estado no visitado (que el encargo no pedía): `listSessions` que revienta** | ✅ (con hallazgo) | Guion 98 bloque E, `chmod 0o000` sobre la raíz de saves: «No se pudieron cargar las partidas guardadas. El servidor del juego no pudo completarlo; inténtalo de nuevo.» — traducido, sin `./start.sh`, y «Nueva partida» sigue siendo salida. Debajo dice «— Ninguna partida todavía —», que es falso → H4 |
| 9 | **Equivalencia frente al árbol de ANTES del corte, midiendo el juego** | ✅ | El guion 98 entero (22 asertos) sale **VERDE sobre `1daea547`**, con `renderHome` todavía dentro de la clase. Mide conducta, no implementación — es lo que el diff verbatim no puede dar |
| 10 | **Crítica visual: la primera pantalla es la misma** | ✅ | El home vacío capturado en `03f50ba5` y en `1daea547`: **md5 idéntico** (`9df7171d…`) y 0 de 1.024.000 píxeles distintos, diferencia máxima 0/255, bbox vacía |
| 11 | Los 67 ids `ts-*`/`data-*` idénticos a `HEAD~1` | ✅ | `diff` de los dos `sort -u` → vacío. 67 y 67 |
| 12 | El candado `las-hojas-del-titulo-no-se-atan-entre-si`, **por dos puertas que nadie había probado** | ✅ | Sondas REALES en disco: **`home.ts` como DESTINO** (`crear-mundo.ts` → `./home.js`) y **`atomos.ts` → hoja** (el anillo por el módulo compartido). Las dos saltan: `atomos.ts:1 — import prohibido: "./home.js" → …/home.ts` y `crear-mundo.ts:1 — …`. Retiradas, `md5sum` comprobado |
| 13 | Trinquete de tamaño con `wc -l` real | ✅ | `wc -l title-screen.ts` = **970** = `"lineas": 970` de `client-file-size.json`. `npx tsx --test test/client-file-size.test.ts` → 7/7 |
| 14 | Cifras del encargo | ✅ | `let` en la raíz **5** (era 6) · `private.*render[A-Z]` **2** (era 3) · módulos de `ui/titulo/`: 211, 129, 183, **376**, 134, 224 — todos ≤ 450 |
| 15 | `npm run verify` / `npm test` (core) | ✅ | `tests 2448 · pass 2448 · fail 0`, medido por mí |
| 16 | Cliente limpio | ✅ | `npx tsc --noEmit` exit=0 · `npx eslint src` exit=0 |
| 17 | La deuda no crece | ✅ | `[deuda] html-sin-promesa-muda (max 7)` y `[deuda] html-sin-catch-silencioso (max 4)` verdes dentro de `architecture.test.ts` |
| 18 | Los ocho rastros de prosa de `renderHome` barridos | ✅ | `grep -rn "renderHome"` fuera de `docs/agents/` y de la crónica fechada del JSON → **0**. Y ningún símbolo que esta PR huerfana (`ARM_TTL_MS`, `modeArmed`, `modoDelSave`, `modeBadgeHtml`, `marcarTarjetaFallida`, `MODE_BADGE_CSS`) queda citado en prosa viva fuera de `home.ts` |
| 19 | El diff de `qa/` es **comentario puro** | ✅ | Mi propio grep: `git diff -U0 HEAD~1 HEAD -- qa/ \| grep -E '^[+-][^+-]' \| grep -vE '^[+-]\s*(\*\|//\|\|)'` → **vacío**. 7 ficheros, 20+/17− |
| 20 | Ninguna hoja engancha a `document`, `window`, `root` ni `content` (riesgo 4 del plan) | ✅ | `home.ts` tiene 4 `addEventListener`, los 4 sobre nodos que ella misma creó dentro de `content` (`newBtn` y los tres bucles sobre `sessionsEl`). Cero `document.`/`window.`. Los cinco de por vida siguen en la raíz (`:278` ResizeObserver, `:280` scroll, `:309` `#ts-close`, `:330` error en captura, más `onProgresoDeMundo`) |
| 21 | **La batería entera, desde un árbol quieto y con la máquina libre** | ✅ con aviso | **Dos corridas completas.** #1: `96 en verde · 1 en rojo de 97` (rojo **91**). #2, con el guion definitivo: `96 en verde · 1 en rojo de 97` (rojo **80**). **Dos corridas, dos rojos DISTINTOS**, los dos de la lista de intermitentes que QA-2 abrió (75/80/91) y los dos verdes al aislarlos → H7 |
| 22 | Los guiones que conducen el TÍTULO | ✅ | **Los 24 verdes en LAS DOS corridas** (07 12 18 19 20 27 28 30 32 33 34 38 44 47 52 69 70 72 92 94 95 96 97 98), sin retocar un guion |
| 23 | Cifras de la crónica del contrato | ❌ | `client-file-size.json` dice `home.ts` **(366 líneas)** y son **376** → H1 |
| 24 | `pintarElHome` conserva el canal de `paso()` en sus cuatro sitios de llamada | ⚠️ latente | Dejó de ser `async`; en `:821` se llama dentro de un `paso(...)`. Hoy sin ocupante → H2 |
| 25 | Gasto real de créditos | ⚠️ no probado | Por diseño. **74** declaraciones `⛨ guardarraíl: cliente y bridge declaran fake:true` en la corrida final; mi guion nunca reanuda un save en Imagen IA y lo devuelve a maqueta |

---

## El único cambio estructural (C1), con la evidencia que se pidió

El informe dice que `modeArmed` puede ser una const de módulo porque `modeArmed.clear()` abre cada
pintado y `TitleScreen` se construye una vez. **Lo verifiqué yo, y busqué el camino contrario.**

| Pregunta | Medida | Resultado |
|---|---|---|
| ¿Cuántas instancias puede haber? | `grep -rn "new TitleScreen" .` en TODO el repo (sin `node_modules`/`dist`) | **1**: `main.ts:799`, en el top level del módulo, sin condición ni función que lo envuelva |
| ¿La vida del campo cambió de verdad? | `main.ts:1266`: `action = await titleScreen.show({ aviso })` dentro de `unIntentoDeArrancar`, que `runTitleFlow` reintenta | `show()` se llama VARIAS veces sobre la MISMA instancia, así que `this.modeArmed` **ya sobrevivía a cada visita al título**. La vida efectiva era el realm antes y después: C1 no cambia nada |
| ¿Una recarga en caliente crearía una segunda? | `grep -rn "import.meta.hot" nefan-html/src` | Solo `vite-hmr.d.ts` (la declaración de tipos). **Ningún módulo acepta HMR**, y sin aceptante Vite recarga la página entera → realm nuevo, mapa nuevo. Camino cerrado |
| ¿Un import dinámico? | `grep -rn "import(.*title-screen\|titulo/home"` | Solo el `import` estático de `title-screen.ts:47`. Camino cerrado |
| Dos pestañas | — | Dos realms, dos mapas. Igual que antes |

**Y no me quedé en el análisis**: la propiedad observable —que el armado no sobreviva a la pantalla
que lo creó— es ahora el bloque C del guion 98, medido por el camino del jugador. Con el `clear()`
quitado, ese bloque se pone rojo con la frase exacta del riesgo: `🎨 Imagen IA` donde debía leerse
`¿Confirmar? Gastará créditos`, y `render_mode en disco: image`. **Un click, gasto encendido, sin
preguntar.** Esa es la red que faltaba y que ahora existe.

---

## Hallazgos

### H1 · MENOR · **de esta PR** — la crónica del contrato dice 366 y son 376

`nefan-core/data/contract/client-file-size.json:20` (el `porque` de `title-screen.ts`) escribe:

> «sale el HOME … a `src/ui/titulo/home.ts` (**366 líneas**) … Entran **22**»

```
$ wc -l nefan-html/src/ui/titulo/home.ts                      → 376
$ git diff HEAD~1 HEAD -- …/title-screen.ts | grep -c '^+[^+]' → 43  (19 de ellas comentario → 24 de código)
```

Las 10 de diferencia son exactamente las que el propio informe declara en §8.5 («después de la
batería añadí 10 líneas de comentario a `home.ts`»): la crónica se escribió antes y no se volvió a
medir. Y «Entran 22» no casa con ninguna de las otras dos cifras que el mismo trabajo publica: el
mensaje del commit dice «Entran 30» y `implementacion-4.md` §3 dice «entraron 45». **Cuatro números
para la misma cosa en cuatro sitios.**

Lo que CANDA (`"lineas": 970`) es correcto y está medido —el trinquete pasa 7/7—, así que esto no
rompe nada: es un fichero de contrato **commiteado** cuya prosa es la fuente que lee el siguiente
agente. Es el patrón «la medida de hoy hay que medirla hoy».

**Reproducción**: `grep -o 'home\.ts` ([0-9]* líneas)' nefan-core/data/contract/client-file-size.json`
**Qué esperaba**: la cifra del fichero que la PR crea, medida sobre el árbol que se commitea.
**Arreglo**: 366 → 376 y una cifra de «entran» sola, la que se decida.

### H2 · MENOR (latente) · **de esta PR** — `pintarElHome` dejó de ser `async` y uno de sus llamantes lo mete en un `paso()`

`renderHome` era `private async`. Su sustituto no lo es:

```ts
// title-screen.ts:925
private pintarElHome(aviso?: string, tono?: "error" | "aviso"): Promise<void> {
  return pintarHome({ content: …, narrative: …, elegir: …, ir: …, avisos: {…}, avisarDeCorte: … }, aviso, tono);
}
```

De sus cuatro sitios de llamada, tres están dentro de una `async` (`show()` :447, `ir()` :889) o de un
`await`. El cuarto **no**:

```ts
// title-screen.ts:821  — el «Volver» del selector de mundos
.addEventListener("click", () => paso(this.pintarElHome(), "title", "volver al home del título"));
```

Con `renderHome` `async`, un throw SÍNCRONO dentro del cableado se convertía en promesa rechazada y
`paso()` lo encauzaba. Ahora escaparía de `paso()` antes de que exista promesa, y el jugador se
quedaría sin motivo en pantalla y sin entrada en el registro.

**Hoy no tiene ocupante** y lo he comprobado: el cuerpo de `pintarElHome` es un literal de objeto con
seis arrow functions más `this.content` y `this.narrative`, y **`this.content` se asigna una sola vez**
(`:237`, en el constructor; `grep "this.content ="` → un resultado), así que no hay nada ahí que pueda
lanzar. Lo reporto porque es **exactamente la familia que QA-2 cazó en la PR 2 (su H2)** y que se
arregló haciendo `ir` `async` —al precio declarado de dos líneas—, y que QA-3 dejó como aviso (su H6);
y porque **la PR 6 mete `crearAvisos(deps)` dentro de este mismo cableado**, que sí es una llamada que
puede lanzar.

**Reproducción**: `sed -n '925p' nefan-html/src/ui/title-screen.ts` (sin `async`) frente a
`git show HEAD~1:nefan-html/src/ui/title-screen.ts | sed -n '548p'` (`private async renderHome`).
**Arreglo**: una palabra (`private async pintarElHome`), o dejarlo dicho para la PR 6.

### H3 · MENOR · **preexistente, verbatim — pero es un defecto que el jugador VE, en esta pantalla**

Cuando el badge de modo se desarma solo a los 5 s, el código escribe:

```ts
btn.style.borderColor = "";
btn.style.color = "";
```

Eso no restaura el color base: **lo borra**. El base venía del mismo atributo `style` del botón
(`BADGE_CSS` = `…;border:1px solid #3a3846;color:#a99`), así que al quitar los longhands el badge se
queda sin color propio. Medido en el navegador, con `getComputedStyle`:

```
desarmado {"borde":"rgb(0, 0, 0)","color":"rgb(0, 0, 0)"}   vs   intacto {"borde":"rgb(58, 56, 70)","color":"rgb(170, 153, 153)"}
```

**Negro sobre `#23222c`**: el badge se vuelve ilegible hasta el siguiente repintado. Se ve en la
captura `…-03-badge-tras-el-desarme-automatico.png`: la tarjeta del medio tiene su «Maqueta 3D»
apagado a negro mientras sus dos vecinas están en el gris de siempre.

**No lo causa esta PR** (líneas idénticas byte a byte a `HEAD~1`, criterio 2) y **no debe bloquearla**;
lo anoto porque es lo que sale al mirar el home como director de arte, porque el guion 98 lo **mide**
(y lo declara sin ponerlo rojo, con la frase que dice qué hacer si se arregla), y porque ahora que el
home es un módulo de 376 líneas el arreglo son dos asignaciones a sus valores base.

**Reproducción**: home con un save en Maqueta → click en el badge de Escenarios → esperar 5 s sin tocar nada.

### H4 · MENOR · **preexistente** — «no se pudieron cargar» y «no hay ninguna» comparten pantalla, y la segunda es falsa

`sessions` nace en `[]` y el `catch` de `listSessions()` no lo distingue de «no hay partidas», así que
el mismo hueco que en el home vacío dice «— Ninguna partida todavía —» aparece **debajo** del aviso de
fallo. Medido con **tres partidas en disco**:

```
sin lista → status: "No se pudieron cargar las partidas guardadas. El servidor del juego no pudo completarlo; inténtalo de nuevo."
            sesiones: "— Ninguna partida todavía —"  (tarjetas=0)
```

A quien se le queda `saves/` sin permisos o en un disco desmontado se le está diciendo, en la misma
pantalla, que sus partidas no se pudieron leer y que no tiene ninguna. Verbatim de antes del corte; el
guion 98 lo mide y lo declara sin afirmarlo rojo.

### H5 · MENOR · **preexistente** — el fallo de cambio de modo es el único del home que no recibió el tratamiento de #365

El `catch` de `onModeBadge` no escribe en la caja de avisos (`#ts-error`) sino en `#ts-status`, la línea
de estado del bridge. Cuatro consecuencias, todas visibles en `…-04-modo-que-no-se-pudo-cambiar.png`:

1. **Contradice el doc de la caja de avisos**, que dice (`title-screen.ts:507`) «Un solo sitio escribe
   ese hueco, así que no hay dos redacciones que puedan divergir». Hay dos canales para fallos de
   acción del home: `#ts-error` (Borrar, Nueva partida) y `#ts-status` (cambiar el modo).
2. **Se lleva por delante** «Bridge OK — 3 partidas guardadas»: el jugador pierde la línea de estado.
3. **No es pegajoso**: cualquier repintado lo borra, mientras que el de Borrar sobrevive (#306).
4. **Suelta la causa cruda delante**: tres líneas con una ruta absoluta
   (`/home/al/code/…/saves/…/state.json.tmp`), sin la frase accionable primero, sin «no se ha perdido
   nada» y **sin marcar la tarjeta afectada** — que es exactamente lo que el guion 52 exige para el
   hermano de al lado, «Borrar».

Verbatim de antes del corte. Candidato natural a #427.

### H6 · MENOR · **del BANCO, preexistente** — `esperarListaDeSaves` espera un texto que el home ya no escribe

`qa/lib/sesion.mjs:183` acepta `/^Bridge OK/` **o** `/No se puede contactar al bridge/`, y su doc
promete: «vale el bridge caído a propósito: el guion debe seguir y fallar por su propia afirmación, no
por un timeout opaco aquí». El home hoy escribe **«No se pudieron cargar las partidas guardadas.»**
(el texto viejo está citado como pasado en el propio comentario del `catch`), así que **esa rama no
puede casar**: en el estado que existe para cubrir, la espera solo puede expirar. Es la razón por la
que mi bloque E no la usa. Anterior a esta tanda.

**Reproducción**: `grep -n "No se puede contactar al bridge" qa/lib/sesion.mjs nefan-html/src` → solo
aparece en el banco.

### H7 · AVISO · **preexistente, ya con dueño (#545)** — dos baterías completas, dos rojos distintos

| Corrida (mismo commit `03f50ba5`) | Resultado | Rojo |
|---|---|---|
| #1 | `96 en verde · 1 en rojo de 97` | **91**-la-forja · `pared 3.15 vs core 2.4` |
| #2 (guion definitivo) | `96 en verde · 1 en rojo de 97` | **80**-el-desplegable-room · `errores 4 → 5` |

Los dos aislados, **verdes**:

```
$ node qa/run.mjs 91        → ✘ pero por OTRO aserto (el jugador murió peleando: «vida 48 → 0»);
                              «la pared … 2.4 m» salió VERDE aquí
$ node qa/run.mjs 90 91     → 2 en verde · 0 en rojo
$ node qa/run.mjs 80        → 1 en verde · 0 en rojo
$ node qa/run.mjs 79 80     → 2 en verde · 0 en rojo
```

Cinco medidas de `91` en total y **el mismo aserto sale 2.4 (correcto) en tres de ellas y 3.15 en una**.
Los dos guiones están en la lista que QA-2 abrió (75/80/91), el `80` con el reproductor que ella misma
midió (hereda el `#error-log` de sus vecinos). Y **no hay camino causal**: `git show --stat HEAD` es
`nefan-html/src/ui/{title-screen.ts, titulo/home.ts}` + `client-file-size.json` + comentarios de `qa/`
— ni una línea de `nefan-core/src`, del sim ni del cliente fuera del título. **No es de esta PR.**

### H8 · MENOR · **del programa, no de esta PR** — `arch-rules.json` sigue situando el badge del save en el título

`nefan-core/data/contract/arch-rules.json:286` dice, nombrando el fichero:

> «`ui/title-screen.ts:1624` (`effectiveCharMode`: `s.character_mode || s.render_mode`, **el badge del
> save**)»

Ese código es hoy `modoDelSave` en `nefan-html/src/ui/titulo/home.ts:305`. El párrafo narra una PR
pasada en pasado («vivían en cuatro sitios»), así que es discutible que sea rastro y no registro —es la
misma familia que QA-3 marcó en su H2 y que el propio programa ya resolvió para
`renderCreateWorld`/`renderUploadStyle`—. Lo anoto porque el `why` de una regla viva es lo que lee
quien la vaya a tocar, y porque `renderCreateWorld` y `renderUploadStyle` ya **no** aparecen en prosa
viva (comprobado): el barrido llegó a esos dos y no a este.

---

## Observaciones (ninguna es hallazgo)

- **`ARM_TTL_MS = 5000` sigue escrito TRES veces** (`ui/dev-menu.ts:30`, `ui/graphics-mode.ts:35`,
  `ui/titulo/home.ts:92`), y el doc del propio símbolo dice «mismo TTL que el chip de gráficos y el
  menú dev». Eran tres antes del corte y son tres después: la PR no empeora nada. El criterio
  «≥ 2 dueños → `atomos.ts`» no lo ve porque dos de los tres dueños viven **fuera** del título.
- **La decisión de dejar `BADGE_CSS`, `BTN_SMALL_PRIMARY_CSS` y `BTN_SMALL_DANGER_CSS` en
  `atomos.ts`** con un solo dueño está declarada en el informe §2 y no escondida. Comprobado: tras
  este corte sus únicos usos son de `home.ts`. Coincido en no re-litigarla dentro de un movimiento.
- **Los cuatro rótulos de modo NO van a `atomos.ts`**: comprobado que su tercer dueño
  (`ui/graphics-mode.ts:16`, el chip EN PARTIDA) está fuera del título y que el candado permite el
  import de `../mode-labels.js` (verde con él puesto). El argumento del informe se sostiene.
- **Crítica visual del home como primera pantalla** (todo preexistente, verbatim): la columna de
  720 px se ancla arriba a la izquierda y deja los dos tercios inferiores de la pantalla en negro; no
  hay arte ni jerarquía vertical. Y «**Bridge** OK — 0 partidas guardadas» pone un nombre de
  componente interno delante de quien acaba de instalar el juego. Ninguna de las dos cambia con este
  corte; las dos son material de #427.
- **La fachada `avisos` inline encaja por FORMA**: los tres nombres (`mostrarAccion`, `limpiarAccion`,
  `repintar`) son los que el plan §4 ya tiene escritos para `crearAvisos(deps)`, y `limpiarAccion` NO
  repinta, igual que el `this.avisoDeAccion = null` que sustituye. Verificado línea a línea contra
  `HEAD~1`; ningún repintado de más.

---

## Guion dejado

`qa/guiones/98-el-home-en-los-estados-que-la-bateria-no-visita.mjs` (+ su fila en `qa/README.md`).
**El 98 estaba libre y lo reservé antes de escribir** (`ls qa/guiones/` → hasta el 97, con el hueco
del 04); no renombré nada con una corrida en vuelo. **El siguiente libre es el 99.**

Cinco bloques, **22 asertos**, todo por el camino del jugador y con los fallos inyectados en el BORDE
(permisos de disco), nunca con estado sintético ni tocando código del cliente:

- **A** el home VACÍO (la rama `sessions.length === 0`, que no pisaba nadie).
- **B** el badge de modo se ARMA antes de gastar y **el TTL olvida de verdad**.
- **C** el armado **no sobrevive a un repintado** — la medida de C1 — más el camino bueno (confirmar
  PERSISTE `image` en disco; apagar es directo y no pide permiso).
- **D** `set_render_mode` que FALLA: el título lo dice, el badge no miente, el disco no cambia y la
  lista sigue entera.
- **E** `listSessions` que revienta: el título no se queda en «Cargando saves…» (por `expectEspera`,
  no por un timeout opaco), el motivo va traducido y queda una salida.

**PROBADO EN NEGATIVO**, un sabotaje por vez y restaurado con `md5sum` comprobado
(`37aebd58cbcbefffb1a7e436714f71e2` las cinco veces):

| Sabotaje en `home.ts` | Resultado |
|---|---|
| `pintarHome` sin `modeArmed.clear()` | **rojo C**: tras volver del selector, UN click enciende Imagen IA (`🎨 Imagen IA`) y la escribe (`render_mode en disco: image`). Gasto sin confirmar |
| el `setTimeout` restaura el rótulo pero no borra la llave | **rojo B**: el click de después del TTL gasta (`🎨 Imagen IA`, `disco: image`) |
| el `catch` de `onModeBadge` se traga el fallo | **rojo D**: el título se queda en «Bridge OK — 3 partidas guardadas» y el cambio se pierde en silencio |
| el hueco de la lista vacío en vez de «— Ninguna partida todavía —» | **rojo A** |
| el `catch` de `listSessions` se calla | **rojo E**, y con mensaje útil: «no ocurrió en 60000 ms · 397 sondeo(s) · último valor null» + «(#ts-status vacío: el fallo se perdió)» |

Cada sabotaje pone rojo **su** bloque y deja verdes los demás, que es lo que separa un guion que mide
de uno que se cae entero. Y, lo que importa para una PR de movimiento: **el mismo guion sale verde
sobre `1daea547`**, el árbol de antes del corte.

Dos hallazgos van **medidos y declarados, no afirmados** (H3 y H4), con la frase que dice qué hacer si
se arreglan: son preexistentes y un aserto los congelaría.

---

## Workarounds usados, y su veredicto

| Workaround | Para qué | ¿Le pasa al jugador? |
|---|---|---|
| `chmod 0o500` al directorio del save **de la corrida** (`QA_RUN_TMP`) | Que `set_render_mode` falle de verdad (criterio 7) | **No es estado sintético**: el directorio se lee pero no se escribe, así que `writeAtomic` no puede crear su `.tmp` y da EACCES real. Le pasa a cualquiera con `saves/` en un volumen de solo lectura. Restaurado en un `finally`. **No es hallazgo** |
| `chmod 0o000` a la RAÍZ de saves de la corrida | Que `list_sessions` reviente (criterio 8) | Mismo criterio: `fs.readdir` da EACCES y el almacén lanza, que es lo que hace un disco desmontado. Restaurado en un `finally`. **No es hallazgo** |
| Cinco sabotajes en `home.ts`, uno por vez | Probar el guion en negativo | Restaurados desde copia, `md5sum` comprobado las cinco veces. **No es hallazgo** |
| Dos ficheros sonda con imports prohibidos | Probar el candado en disco | Retirados, `md5sum` comprobado. **No es hallazgo** |
| `git checkout 1daea547` en MI árbol y vuelta a `03f50ba5` | Correr el guion 98 y capturar el home sobre el árbol de antes del corte | Mi worktree, reversible, verificado con `git log --oneline -1` y `wc -l`. **No es hallazgo** |
| `?bridge=` a un puerto muerto | Intento de ejercer el `catch` de `listSessions` | **Salió mal y por eso es un DATO, no un apaño**: con el bridge caído el título no se pinta y el cliente cae al visor de fixtures, así que ese camino no llega. Está escrito en el guion para que nadie lo repita, y coincide con lo que QA-3 midió en su H3 |
| Ninguno para ver el home | — | **Se llega por el camino del jugador**: `qa/run.mjs` levanta `e2e-sin-creditos` y la primera pantalla ES el home. Sin ocultar overlays ni forzar estado |

---

## No probado

- **Gasto real de créditos**: por diseño (`e2e-sin-creditos`, motor falso). 74 declaraciones
  `fake:true` en la corrida final. Mi guion enciende Imagen IA en el `state.json` de un **clon** que
  nunca se reanuda —eso no dispara ninguna generación— y lo apaga antes de terminar.
- **El `if (!s) return` de `onModeBadge`** (badge de un save que ya no está en la lista que trajo el
  pintado): no lo conduje. Es una carrera entre el pintado y el click, cubierta por la equivalencia
  verbatim (0 líneas de diff).
- **El badge de PERSONAJES** con `CONFIG.graphics.ai_skin` apagado (badge muerto con `title`
  explicativo): no lo conduje; exige tocar el config del core. Mido la faceta `scenes`, que comparte
  todo el camino salvo esa guarda.
- **La rama de partida ACTIVA de `set_render_mode`**: a propósito. El badge del título existe para la
  partida INACTIVA y por eso mido sobre clones; la rama activa es del chip de gráficos en partida.
- **CRAP / cobertura / mutación**: el cliente está fuera del perímetro medido
  (`afectado.test.ts:252-259`, `client-file-size.json` selecciona `ids: []`), así que `npm run
  afectado` no selecciona nada con este diff.

---

## Para el coordinador

1. **Los dos hallazgos de esta PR son de una línea cada uno**: la cifra `366 → 376` en
   `client-file-size.json` (H1) y, si se quiere cerrar el latente, `private async pintarElHome` (H2).
   Ninguno bloquea; los dos son más baratos ahora que en la PR 6.
2. **C1 está verificado, no aceptado**: no hay camino a dos vidas del título, y además la propiedad
   que lo sostiene tiene ahora un guion que la pone roja cuando se pierde. Es la deuda que el corte
   creaba y que queda cerrada.
3. **H3, H4 y H5 son preexistentes y del HOME**, no del corte, pero los tres son cosas que el jugador
   ve o lee y los tres aterrizan sobre un módulo que ahora tiene 376 líneas y un dueño claro.
   Recomiendo agruparlos en el issue de #427 en vez de meterlos en esta PR.
4. **H6 es del banco** y explica por qué el estado del bridge caído no lo medía nadie: la espera
   compartida no puede casar con el texto que el home escribe hoy.
5. **La batería NO es estable, y ya son cinco QA que lo dicen**: dos corridas mías, dos rojos
   distintos, los dos de la lista de QA-2 (75/80/91) y los dos verdes aislados. El criterio de cierre
   del programa se sostiene en el dato limpio: **los 24 guiones del título verdes en las dos
   corridas, sin retocar un guion.** Sigue mereciendo issue propio (#545).
6. **El siguiente número libre de guion es el 99.**
