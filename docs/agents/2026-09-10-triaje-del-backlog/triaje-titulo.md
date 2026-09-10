# Triaje: el título y sus avisos (17 issues)

`main` = `5d67c8ca` · verificado el 2026-09-10 contra el código de hoy, con #346 ya cerrado
(`ba6b534e`, seis PR, `title-screen.ts` 1.738 → 368, nueve módulos en `nefan-html/src/ui/titulo/`).
Todo lo que sigue está abierto y leído; ninguna afirmación viene de memoria ni del enunciado.

**Criterio que uso para «decisión del usuario»**: quitar un defecto que el jugador sufre NO es una
decisión de producto aunque cambie lo que ve — si lo fuera, los 17 serían suyos y el triaje no
serviría de nada. Reservo su turno para lo que **elige entre dos diseños defendibles**, **compromete
su dinero** o **su tiempo**.

## Tabla resumen

| # | Qué dice | Veredicto | Quién / qué cuesta |
|---|---|---|---|
| 425 | 30 s mudos al listar partidas | **REENCUADRADO** | Síntoma vivo, **repro falso**: en `html-fixtures` el título NO se pinta nunca. Ingeniero, 1 fichero |
| 427 | tres huecos de mensaje sin dueño | **REENCUADRADO** | Premisa muerta por #346; **dos defectos medidos sobreviven** (en el comentario, no en el cuerpo). Ingeniero |
| 478 | el bridge tardío no rearranca nada | **DECISIÓN DEL USUARIO** (mitad) | La mitad del chip que miente es canónica; «rearrancar solo o botón Reintentar» es suya |
| 479 | JSON crudo al muro por trama ilegible | **VIGENTE** | Trivial: un campo en un `errors.push`. Ingeniero |
| 480 | lienzo negro 5 s en `html-fixtures` | **VIGENTE** | Mecanismo clavado. Mismo sitio que #478: hacer los dos de una pasada |
| 481 | «rechazó la respuesta» / «no responde» | **VIGENTE** | Core (`status-rotulo`/`status-motivo`, ambos al 100 % de mutación). Arquitecto: ¿causa tipada en el wire? |
| 536 | motivos de rechazo del pack | **VIGENTE** | Tres defectos verificados. Core + snapshot + 2 líneas del cliente. Ingeniero |
| 537 | estilo «de otro tema» solo en `console.warn` | **VIGENTE** | El propio código nombra a #537 en un comentario. Ingeniero |
| 543 | `atomos.ts` lee `location.search` al cargar | **PREMATURA** | Bloqueada por **#496** (abierto), que el propio issue manda descartar antes |
| 544 | el guion 01 afirma antes de tiempo | **VIGENTE** | Trivial (una línea del guion). Medido: el aserto solo está en el 01; la carrera, en ~13 más |
| 548 | tras pagar, la pantalla invita a pagar otra vez | **REENCUADRADO** | La idempotencia es de **#513**; sobrevive un bug de cliente de 3 líneas + 3 cosméticos |
| 549 | el badge se vuelve ilegible al desarmarse | **VIGENTE** | Trivial, riesgo cero, aserto ya escrito en el guion 98. **Lo puedes hacer tú** |
| 552 | «Volver» pierde mundo, estilo y modos | **VIGENTE** | Verbatim. + **una pregunta para el usuario** que sale de verificarlo (ver abajo) |
| 553 | «Continuar →» recortado a 1440×900 | **VIGENTE** | El mecanismo del aviso de corte NO cubre el selector: verificado |
| 555 | 12 parejas de ids del DOM entre módulos | **VIGENTE** | Medido exacto: 12/12. Arquitecto, y **antes** de #536/#427/#425/#537/#513 |
| 557 | el candado no vigila la dirección inversa | **REENCUADRADO → cerrar hoy** | Su propio argumento («no hay sujeto») lo contradice la regla hermana |
| 558 | `atomos.ts` no tiene tope propio | **REENCUADRADO → cerrar hoy** | Lo que preserva ya vive en `atomos.ts:1-36`; faltan dos frases |

**Ninguno de los 17 se cierra por caducidad.** Es un resultado, no una omisión: catorce de los
diecisiete nacieron el 06, el 07 o el 09 de septiembre, y los tres anteriores describen mecanismos
que #346 movió de fichero sin tocar una línea. Lo que sí caducó son **punteros y premisas dentro**
de tres cuerpos (#425, #427, #557), y eso va en su sección.

---

## #425 · «Cargando saves desde el bridge» durante 30 s mudos → **REENCUADRADO**

**Vivo**: el texto está en `nefan-html/src/ui/titulo/home.ts:176` (el issue decía
`title-screen.ts:544`) y el timeout en `nefan-html/src/net/bridge-client.ts:243`
(`timeoutMs = 30_000`, el issue decía `:197`). Deriva de línea, no de sujeto.

**Falso**: la reproducción. `./start.sh --preset html-fixtures` **no** enseña ese texto ni un
segundo, porque en ese preset **el título no se pinta nunca**:

```
main.ts:1174  client = await createGameClient(sharedBridge)   ← lanza a los 5 s
main.ts:1187-1190  errors.push(...); gameClient = createViewerClient(); return;
main.ts:1197  await runTitleFlow();   ← INALCANZABLE por ese camino
$ grep -n "runTitleFlow" nefan-html/src/main.ts   → 1197, 1220 (def), 1257 (recursiva)
```

Sin bridge no hay `show()`, y `#title-screen` nace con `display:none`
(`titulo/chasis.ts:136`). Lo confirma desde fuera el comentario de #478 («sin título — nunca se
pintó»). Además, `request()` **rechaza al instante** si `_connected` es false
(`bridge-client.ts:245-247`): sin socket no hay 30 s de nada.

**El síntoma real** es el que mide el guion 70: `e2e-sin-creditos` con la respuesta a
`list_sessions` retenida — socket abierto, bridge mudo. Y el comentario del 06-09 amplía la familia:
bridge muerto a mitad de partida → el chip cambia al instante y el muro llega a t+5,0 s.

**Qué hacer**: corregir el cuerpo (líneas nuevas + repro nuevo) y hacerlo. No necesita al usuario:
que una espera de arranque hable antes de medio minuto no es una elección de producto. Alcance:
`home.ts` (+ opcionalmente un `timeoutMs` propio en la llamada de `listSessions`); el guion 70 ya
tiene el escenario montado.

---

## #427 · Tres huecos de mensaje solapados y sin dueño → **REENCUADRADO**

**La premisa del cuerpo está muerta, y la mató #346.** Los tres huecos tienen hoy dueño declarado
por escrito:

| Hueco | Dueño hoy | Contrato escrito en |
|---|---|---|
| `#ts-error` | `titulo/avisos.ts` | su cabecera: pegajosos vs. de acción, **un solo escritor** (`repintar`) |
| `#ts-status` | `titulo/home.ts:133,137` | el estado del bridge |
| la banda `#ts-mas` | `titulo/chasis.ts:171` | `actualizarAvisoDeCorte`, derivada de `#ts-sessions` |

Y la contradicción concreta que el issue nombraba («Bridge OK» + «respondió algo que no se
entiende») está resuelta **y candada**: `avisos.ts:117` → `caducarEstadoDeSaves()`
(`avisos.ts:100-105`), con el guion 101 vigilando la costura.

**Lo que sigue vivo no está en el cuerpo, está en el comentario del 09-09**, y lo he verificado
línea a línea:

1. **«No se pudieron cargar» y «— Ninguna partida todavía —» a la vez, y la segunda es falsa.**
   `home.ts:177` `let sessions: SessionMetadata[] = []`; el `catch` de `:182-190` no lo distingue de
   «no hay», y `:193-194` pinta «— Ninguna partida todavía —» debajo del aviso de fallo.
2. **El fallo de cambio de modo es el único del home que escribe en `#ts-status` y no en la caja de
   avisos.** `home.ts:309-316`: `catch` → `st.innerHTML = ...${(err as Error).message}` — crudo,
   encima de «Bridge OK», y no pegajoso. Contradice literalmente la cabecera de `avisos.ts:21-22`
   («UN SOLO SITIO ESCRIBE EL HUECO … no hay dos redacciones que puedan divergir»).

**Qué hacer**: reescribir #427 como esos dos defectos (el título actual ya no describe nada), y
apuntar la parte de acoplamiento por cadenas a **#555**, que es donde vive ahora. No necesita al
usuario: «no digas que no hay partidas cuando lo que pasó es que no pudiste leerlas» es canónico, y
el canal de fallos de acción ya está decidido por #306 y #365 (guion 52).

---

## #478 · El bridge que llega tarde no rearranca nada → **DECISIÓN DEL USUARIO** (una mitad)

Verbatim, y el mecanismo está a la vista en `nefan-html/src/main.ts:1187-1195`:

```ts
} catch (err) {
  errors.push("session", "bootstrap failed", err);
  gameClient = createViewerClient();
  updateConnectionStatus(false, true);
  return;                                   // ← sale ANTES de suscribirse
}
gameClient = client;
client.on("connected",    () => updateConnectionStatus(true,  true));   // solo en la vía buena
client.on("disconnected", () => updateConnectionStatus(false, true));
```

Por esa rama nadie se suscribe a `connected`, así que el chip se queda en «Disconnected» aunque el
socket abra, y `runTitleFlow()` (`:1197`) no llega a llamarse nunca. El guion 78 lo **loguea sin
afirmarlo** (`78-…:26,186`), a propósito.

**Mitad canónica, sin preguntar**: que `#connection-status` diga la verdad. Un chip de conexión que
miente con el socket abierto no tiene dos diseños defendibles.

**Mitad suya**: qué pasa DESPUÉS. Está en el propio issue y sigue sin contestar.

---

## #479 · La trama ilegible manda JSON crudo al muro → **VIGENTE**, trivial

`nefan-html/src/net/bridge-client.ts:162-169`:

```ts
const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
errors.push("bridge", `el servidor de la partida mandó algo ilegible: ${preview}`, err, {
  alJugador: AVISO_TRAMA_ILEGIBLE,        // ← sin detalleAlJugador
});
```

Y `ui/error-log.ts:236` decide `mensaje: opts.detalleAlJugador ?? message`: sin el campo, al muro
va el `message`, o sea los 200 caracteres de JSON. El mecanismo de #469 existe y está a un campo de
distancia. Coste: una línea + un aserto (el «sin jerga» ya existe en `qa/fixtures-sin-bridge.mjs`).
No toca contrato. **Si quieres, esto lo haces tú en dos minutos.**

---

## #480 · `html-fixtures`: lienzo negro hasta que el bootstrap agota su timeout → **VIGENTE**

Los dos extremos del mecanismo, verbatim:

```
net/game-client.ts:281-283   createGameClient(bridge, timeoutMs = 5000)
net/game-client.ts:301-322   new Promise(...) → solo escucha bridge.on("connected");
                             si el socket ya falló, se espera igual los 5.000 ms
main.ts:596-599              if (!gameClient) { scheduleNextFrame(); return; }   ← 0 frames
```

O sea: el temporizador de 5 s no escucha el fallo que está cronometrando, y hasta que vence
`gameClient` es `null` y el bucle sale antes de `render()`. **#215 está cerrado** y lo que dejó fue
`createViewerClient()` (el comentario de `main.ts:1182-1186` lo dice): el negro dejó de ser eterno y
pasó a durar 5 s. #480 es ese residuo.

**Cuidado al arreglarlo**: colapsar el timer en el primer `error` del socket es tentador y rompe
#478 — el `bridge-client` reconecta, y ese caso es justamente «el bridge que llega tarde». Los dos
issues viven en las mismas veinte líneas: **hacerlos de una pasada**, no en dos tandas.

---

## #481 · Titular «rechazó la respuesta», detalle «no responde» → **VIGENTE**

Las dos mitades siguen sin hablarse, y son de core:

```
src/protocol/status-rotulo.ts:154-164   case "consequences": titulo: "El motor narrativo rechazó la respuesta"  (SIEMPRE)
src/protocol/status-motivo.ts:69-75     motivoDeReaccionParaElJugador: /fetch failed|ECONNREFUSED|…/ → "no responde…"
bridge/handlers/dialogue.ts:69-74       kind: "consequences", message: motivoDeReaccionParaElJugador(result.error)
```

El rótulo mira `kind`; el motivo mira el TEXTO de la excepción. Con el motor caído los dos son
ciertos por separado y contradictorios juntos. El comentario del 06-09 añade un segundo caso de la
misma clasificación (`systems.combat: "noexiste"` → «Los datos de ese mundo están dañados»).

**Para el arquitecto, no para el usuario**: la pregunta del issue —«¿el `narrative_status` lleva
causa tipada o solo texto?»— es de contrato (`src/protocol/messages.ts` + su zod + el espejo
Python), y la respuesta canónica de esta casa está escrita: la clasificación por regex sobre el
`message` es adivinar lo que el emisor ya sabía. Ojo al coste: los dos módulos están al 100 % de
mutación, así que un caso nuevo entra con sus tests o baja el suelo.

---

## #536 · Los motivos de rechazo de la subida de un pack → **VIGENTE**, los tres

```
src/contracts/style-upload.ts:76  tags:     `Elige al menos una etiqueta temática (máximo ${R.tags.max}).`
src/contracts/style-upload.ts:77  imagenes: `Sube al menos una imagen (máximo ${R.imagenes.max}).`   ← con 13, «al menos una»
src/contracts/style-upload.ts:81  imagen_vacia:    `{ref} no trae ninguna imagen.`                   ← minúscula
src/contracts/style-upload.ts:83  sin_descripcion: `{ref} necesita una descripción: …`               ← minúscula
```

(`refDeImagen`, `:61`, devuelve el id o «la imagen N» — minúscula en los dos casos.)

Y el JSON crudo, dos veces en el mismo fichero del título:

```
ui/titulo/subir-estilo.ts:179  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
ui/titulo/subir-estilo.ts:211  (idéntica, en /complete)
ui/titulo/subir-estilo.ts:193  statusEl.innerHTML = `Subida fallida: ${escapeHtml((err as Error).message)}`
```

**Qué hacer**: hacerlo. El criterio ya está escrito en el issue y el test que pide es de core
(recorrer `MOTIVOS_DE_SUBIDA`). Toca el snapshot `data/contract/style-upload.json` (lo lee Python),
así que hay que regenerarlo — el candado de frescura es `test/contract-style-upload.test.ts`. No
necesita al usuario: son textos con regla, no elecciones.

---

## #537 · El estilo «de otro tema» solo avisa en el `console.warn` del bridge → **VIGENTE**

Verbatim, y **el propio código lo nombra**:

```
bridge/handlers/session.ts:388-394
  // … Hoy es un `console.warn` del servidor que el jugador no ve;
  // que llegue a su registro lo pide #537.
  if (!styleCompatibleWithGame(style.tags, meta.tags)) { console.warn(`Bridge: estilo …`); }
```

La política —el estilo del mundo manda aunque no case, marcado «(del mundo · otro tema)»— ya la
decidió el usuario en #241 (opción a). Esto no la revisa: solo hace visible su consecuencia. Canal:
`errors.push` con `alJugador`, que es el mismo mecanismo de #469/#306. **No necesita al usuario.**

---

## #543 · `atomos.ts` lee `location.search` al cargar → **PREMATURA**

Verbatim (`ui/titulo/atomos.ts:93,97` → `serviceUrl` en el cuerpo del módulo), y la cabecera del
propio fichero (`:18-28`) declara el estado con su medida: la versión perezosa está probada, y se
dejó fuera porque puso rojo el guion 80 dos corridas de dos sin mecanismo conocido.

**Lo que lo bloquea sigue abierto**: `#496` («el guion 80 —y a veces el 75— sale rojo porque el
bridge compartido difunde la vida ambiental del guion anterior a una página sin sesión»). El propio
#543 dice «conviene descartarla antes que nada». Perseguir el mecanismo del 80 con #496 vivo es
medir ruido: dos causas para el mismo rojo y ninguna forma de separarlas.

**Qué hacer**: dejarlo abierto etiquetado «bloqueado por #496» y no tocarlo hasta que #496 cierre.
No necesita al usuario.

---

## #544 · El guion 01 espera `#ts-close` y afirma `status().title` → **VIGENTE**, trivial

La carrera es real y la he seguido entera:

```
qa/guiones/01-arranque-y-fixture.mjs:19-25   waitFor(#ts-close) → expect(status().title === true)
ui/titulo/chasis.ts:136                      root.style.cssText incluye "display: none"
ui/titulo/chasis.ts:209                      close.id = "ts-close"   (lo crea armarChasis, desde el constructor)
ui/title-screen.ts:170-171                   async show() { this.chasis.mostrar(); … }   ← display:flex
ui/titulo/chasis.ts:248-250                  get visible() { return root.style.display !== "none" }
dev/nefan-hook.ts:283                        title: deps.titleScreen.isVisible
main.ts:799 / main.ts:1266                   new TitleScreen(...)  …  await titleScreen.show({aviso})
```

**Lo que el issue pedía mirar, medido**: `#ts-close` aparece en 19 ficheros de `qa/`. El **aserto**
prematuro está solo en el 01. Pero el patrón hermano —`waitFor(#ts-close)` y acto seguido
`closeTitle()`— está en ~13 guiones más (02, 03, 06, 16, 22, 23, 24, 30, 32, 44, 61, 80…), y cuatro
de ellos (**02, 03, 06, 32**) siguen sin esperar `title === false`: si el cierre llegara antes de
`show()`, el título volvería a taparse y el guion cargaría la fixture debajo de él.

**Qué hacer**: hacerlo (una línea en el 01, y decidir si los cuatro sin espera se igualan). Riesgo
cero para producción: solo toca `qa/`. Verificarlo sí quiere una corrida de batería.

---

## #548 · Tras pagar, la pantalla invita a pagar dos veces → **REENCUADRADO**

El cuerpo mezcla dos cosas de coste muy distinto, y hay que separarlas:

**(a) La idempotencia del cobro es de #513, y el propio issue lo dice.** No la dupliques aquí.

**(b) Pero hay un bug de cliente que NO depende de #513 y son tres líneas.** El `try` de
`ui/titulo/plan-de-estilo.ts:113-129` abarca **el gasto y la navegación**:

```ts
const result = await styleApply.run(plan, …);      // ← ya se pagó
progressEl.innerHTML = "Estilo aplicado: … ($X)";
await new Promise(r => setTimeout(r, 1200));
await ir({ a: "selector", preselect: gameId });    // ← si falla ESTO…
} catch (err) {
  progressEl.innerHTML = `${(err as Error).message}`;   // …borra el «Estilo aplicado»
  runBtn.disabled = false;                              // …y rearma el botón que cobra
  cancelBtn.disabled = false;
}
```

Un fallo de navegación entra por el catch de un gasto que ya ocurrió. Eso se arregla en el cliente
hoy, sin esperar a dónde acabe viviendo `style-apply.ts`.

**(c) Los tres cosméticos, verificados**:
- `~$0.00 + ?`: `plan-de-estilo.ts:94-99` — `total` suma `estCostUsd ?? 0`, y un bloque sin precio
  solo deja el `+ ?`.
- Mismo primario para el que gasta y el que no: `plan-de-estilo.ts:78` — un único `runBtn` con
  `BTN_PRIMARY_CSS`, cuyo texto alterna entre «Aplicar estilo (~$X)» y «Registrar (sin coste)».
- La descripción, el campo más estrecho de su fila: `subir-estilo.ts:63-70` — la fila es
  `grid-template-columns: auto 1fr auto`, el `<select>` va a `width:auto` y su opción más larga es
  «Lámina de materiales (rejilla de muestras planas)» (48 caracteres a 13 px), así que se come el
  ancho y el `1fr` de la descripción queda con lo que sobra de 720 px.

**Qué hacer**: cerrar #548 y abrir dos: uno de (b), del ingeniero, y otro de (c), de la misma
pantalla. Nada de esto necesita al usuario: «el botón que cuesta dinero no se ve igual que el que no
cuesta» es la respuesta canónica, no una preferencia.

---

## #549 · El badge de modo se vuelve ilegible al desarmarse → **VIGENTE**, y es tuyo

Verbatim, `ui/titulo/home.ts:296-302`:

```ts
setTimeout(() => {
  …
  btn.style.borderColor = "";     // ← borra, no restaura
  btn.style.color = "";
}, ARM_TTL_MS);                   // ARM_TTL_MS = 5000  (home.ts:108)
```

El color base viene del mismo atributo `style` del botón: `MODE_BADGE_CSS` (`home.ts:327`) =
`BADGE_CSS` (`ui/titulo/atomos.ts:134`, `…border:1px solid #3a3846;color:#a99`). Quitar los
longhands deja el badge sin color propio.

**Trivial y sin riesgo**: dos asignaciones a sus valores base, y el aserto ya está escrito y
declarado (no afirmado) en `qa/guiones/98-…:256-274`. **Este lo haces tú directamente.**

---

## #552 · «Volver» pierde el mundo, el estilo y los dos modos → **VIGENTE**

Las dos puntas, verbatim:

```
ui/titulo/editor-de-personaje.ts:159-161   paso(deps.ir({ a: "selector" }), …)      ← sin preselect
ui/titulo/selector-de-mundo.ts:131         selectedGame = games.find(…preselect) ?? games[0]
ui/titulo/selector-de-mundo.ts:204         let selectedRenderMode = "image"
ui/titulo/selector-de-mundo.ts:211         let selectedCharMode  = skinBackendOn ? "image" : "vector"
```

Y la pieza que el issue dice que ya existe, existe: `ui/title-screen.ts:290` guarda
`lastSelectedGameId`, y `:246` sabe pasar `preselect`. Los otros dos caminos de vuelta ya lo usan
(`crear-mundo.ts:119`, `plan-de-estilo.ts:124`); el del editor de personaje es el único que no.

**Qué hacer**: hacerlo. Que un «← Volver» devuelva al jugador a lo que acababa de elegir no tiene
dos diseños defendibles, y menos cuando el olvido lo deja en el modo que gasta.

---

## #553 · «Continuar →» recortado a 1440×900, y nada avisa → **VIGENTE**

La medida de la QA del 09-09 (17 px de 39) es de ayer y el bloque no ha cambiado; lo que sí he
verificado hoy es **la segunda mitad, que es la que importa** — el mecanismo que existe justo para
esto no cubre esa pantalla:

```
ui/titulo/chasis.ts:314-326
  function actualizarAvisoDeCorte(content, aviso) {
    if (!content.querySelector("#ts-sessions")) { aviso.hidden = true; return; }   // ← solo el HOME
    …
    const fuera = [...content.querySelectorAll(".ts-save")].filter(…)              // ← solo tarjetas de save
```

`#ts-sessions` y `.ts-save` solo los pinta el home (`titulo/home.ts`), así que en el selector la
banda se retira por diseño. Y la columna que scrollea es `content`, con
`max-height:100%; overflow-y:auto` (`chasis.ts:156-161`).

Familia de #250/#251, los dos cerrados. No necesita al usuario. Necesita **un guion a 1440×900**: el
33 mide a 500×480 y por eso este corte nunca salió.

---

## #555 · Los ids del DOM entre módulos: 12 parejas → **VIGENTE**, y con prisa

Medido hoy, id a id, cruzando quién los escribe contra quién los lee. **12 de 12 confirmadas**:

```
#ts-gen, #ts-gen-progress            selector-de-mundo.ts  →  title-screen.ts
#ts-error, #ts-status                home.ts               →  avisos.ts
#ts-sessions, .ts-save               home.ts               →  chasis.ts
#ts-columns, #ts-worlds,             selector-de-mundo.ts  →  chasis.ts (el <style> responsive)
#ts-rendermode, #ts-charmode,
#ts-actions, #ts-create-world
```

La cobertura que declara el issue también se sostiene: la costura «Bridge OK» tiene guion propio
(101) porque `avisos.ts:100-105` la lee **por prefijo de texto**, y las seis del `<style>`
responsive no las cubre nadie — renombrar `#ts-columns` deja la distribución móvil sin aplicar y
todo verde.

**Lo urgente es el orden, y lo he comprobado**: #536 aterriza en `subir-estilo.ts`, #427 y #425 en
`home.ts`, #537 toca el registro que lee `avisos.ts`, #553 toca `chasis.ts` + `selector-de-mundo.ts`
y #513 se lleva `style-apply.ts`. Cinco tareas de esta misma tabla van a mover estos ficheros. Los
ids deberían estar declarados **antes**, no después de la primera regla CSS que deje de aplicarse en
silencio. Es del arquitecto (el issue lista tres formas y no prejuzga ninguna), no del usuario.

---

## #557 · El candado no vigila la dirección inversa → **REENCUADRADO → cerrar hoy**

La medida del issue se sostiene exactamente:

```
$ grep -rn 'from "./titulo/\|from "../titulo/' nefan-html/src --include=*.ts | wc -l
9
$ … | cut -d: -f1 | sort | uniq -c
      9 nefan-html/src/ui/title-screen.ts
```

Nueve, todas del enrutador. Cero ocupantes fuera.

**Pero su argumento para no hacerlo no se sostiene.** Dice «esta casa no añade candados contra lo
que nadie ha hecho», y la regla hermana —`las-hojas-del-titulo-no-se-atan-entre-si`,
`arch-rules.json:256-269`— nació **la misma semana y con cero ocupantes**: prohíbe que una hoja
importe a otra, y ninguna lo hacía. Lo que esta casa prohíbe es un candado que **no puede ponerse
rojo por una causa real**; un `import { pintarHome } from "./titulo/home.js"` escrito en `main.ts`
es una causa real y probable.

**Qué hacer**, y ninguna de las dos necesita al usuario: (a) añadir el patrón a esa misma entrada
—una línea, verde hoy— y cerrar el issue; o (b) cerrarlo declarando la medida en el `why` de la
regla, que es donde alguien la leerá. Un issue cuya condición de acción es «que un `grep` dé más de
9» es un `grep` que nadie va a correr: mientras siga abierto no vigila nada y ocupa cola.

---

## #558 · `atomos.ts` no tiene tope propio → **REENCUADRADO → cerrar hoy**

Verificado: `wc -l` da **218** líneas y el régimen general es `tope: 450`
(`data/contract/client-file-size.json`), o sea 232 de margen; y el censo de exports da **17**
(`grep -c "^export "`), como dice el issue.

Y su contenido de valor **ya vive donde se va a leer**: la cabecera de `ui/titulo/atomos.ts:1-36`
declara el criterio de los dos dueños y las dos excepciones **con su motivo medido** (la tarjeta de
mundo llevaría el selector a ~471, por encima del tope; `BADGE_CSS` obligaría a `atomos.ts` a
importar de `home.ts`). El `$comment` de `client-file-size.json` ya dice que contra la concentración
no hay checker.

**Lo único que el issue añade y el fichero no tiene** son dos frases: la trayectoria (196 → 218 en
seis cortes) y la señal de actuar («un export nuevo entra con un solo dueño sin excepción declarada,
o el censo de ≥ 2 dueños baja de la mitad»). Pegarlas en la cabecera y cerrar el issue es un cambio
de riesgo cero que convierte una nota de backlog en algo que el siguiente editor lee **justo cuando
va a añadir un export**. Un issue de vigilancia sin condición ejecutable no vigila: espera.

---

# Lo que necesita decisión del usuario

Dos preguntas. Nada más de los diecisiete.

### 1 · (#478) El bridge llega tarde: ¿qué hace el cliente?

> Arrancas sin bridge, ves el muro «Sin conexión con la partida», y **después** el bridge se levanta.
> Hoy el muro se retira solo y ahí se acaba: te quedas en el visor de fixtures, sin título, y la
> única salida es recargar la página. ¿Qué prefieres que pase?
>
> - **(a) Que se arranque solo**: el cliente relanza el arranque al conectar y te planta el título,
>   como si acabaras de abrir la página. Sin clicks. *Cuesta*: ~1 día de ingeniero; hay que decidir
>   además qué pasa si estabas mirando una fixture (¿se pierde?), y es el camino con más formas de
>   dejar dos arranques en vuelo.
> - **(b) Que te lo ofrezca**: el chip pasa a «Connected» y el muro te da un botón **«Reintentar»**.
>   Tú decides cuándo. *Cuesta*: ~medio día, y el estado nunca cambia sin que lo pidas.
> - **(c) Solo la verdad**: el chip deja de mentir y nada más. *Cuesta*: un par de horas.
>
> (La mitad de «el chip deja de mentir» la hago en cualquiera de los tres casos: eso no es una
> elección.)

### 2 · (#552, pero es más grande que #552) ¿Con qué modo arranca una partida nueva?

> Al verificar #552 sale que las dos puertas de la misma decisión no se tratan igual:
>
> - En el **selector de mundos**, «Escenarios» y «Personajes» vienen puestos en **Imagen IA** (o
>   sea, gastando) y se cambian con un click, sin confirmar (`selector-de-mundo.ts:204,211`).
> - En el **home**, encender Imagen IA en un save guardado **exige dos clicks** y el botón te avisa
>   con «¿Confirmar? Gastará créditos» (`home.ts:290-295`).
>
> ¿Cuál de las dos es la que quieres en las dos puertas?
>
> - **(a) Se queda como está**: una partida nueva nace gastando, y el aviso es la etiqueta de coste
>   que ya lleva cada botón.
> - **(b) Una partida nueva nace en Maqueta 3D** (sin coste) y encender Imagen IA es una elección
>   explícita, como en el home.
> - **(c) Se recuerda lo último que elegiste** entre pantallas del título.
>
> *Cuesta lo mismo en los tres casos* (una tarde). Lo que cambia es cuánto gasta quien pulsa
> «Nueva partida» sin mirar. Sea cual sea la respuesta, #552 se arregla igual: «← Volver» tiene que
> devolverte a lo que habías elegido.
