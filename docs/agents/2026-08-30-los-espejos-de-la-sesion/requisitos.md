# Requisitos — Los espejos de la sesión (#313 #314 #316)

## 1 · La petición del usuario, literal

> «Seguimos cerrando issues»

Y, elegida entre cuatro tandas medidas, la opción:

> «Espejos de la sesión (Recomendado) — #313 #314 #316. Tres issues, un módulo: el sello dice
> quién emitía y no quién pidió, el diálogo tiene tres representaciones, y tres de los ocho
> FacetSinks no miran ninguna faceta. Son huecos de candados puestos hace dos días — el material
> más fresco y el que más rápido se pudre. Cierra 3 con el menor riesgo.»

La intención permanente, de turnos anteriores:

> «Vamos a seguir priorizando reducir el numero de issues»

## 2 · Por qué estos tres juntos

Convergencia **medida hoy**, no supuesta:

| Fichero | #313 | #314 | #316 |
|---|---|---|---|
| `nefan-core/src/session/session-facets.ts` | `destinoDeStatus` (`:234-255`) | el sink `dialogo` (`:111`, `:166`) | `FacetSinks` entero (`:88-166`) |
| `nefan-core/bridge/ws-server.ts:130,134` | el sello | — | — |
| `nefan-html/src/input/`, `main.ts` | — | las tres representaciones | — |

Los tres nacen de las tandas **#311 y #312**, cerradas hace dos días. Los tres son **huecos de
candados recién puestos**, descritos por quien los puso. Ese material es exactamente el que se
pudre: dentro de un mes nadie recordará por qué la excepción está ahí.

## 3 · Los tres issues, con sus correcciones ya aplicadas

**Cada issue tiene comentarios que DESMIENTEN parte de su cuerpo. Manda el comentario.**

### #313 — el sello dice quién EMITÍA, no quién PIDIÓ

Estado: `bridge/ws-server.ts:130,134` sella `narrative_event` y `narrative_status` con
`narrative.session_id` — «la sesión que este bridge tiene activa en el instante de emitir», lo
dice su propio comentario. Tras jugar y volver al título, el cliente está en `""` y el bridge
sigue con la partida cargada, así que toda pre-generación (`kind:"game_gen"`) llega con sello ajeno.

Por eso `destinoDeStatus` (`session-facets.ts:254`) abre con una excepción por `kind`:

```ts
if (status.kind === "game_gen") return "titulo";   // SIN mirar el sello
```

**CORRECCIÓN QUE MANDA (comentario del usuario):** el criterio de cierre escrito en el cuerpo del
issue —«sellar con `jobSession` y la excepción desaparece»— **es falso**. Un `game_gen` lo pide el
título, y el título no tiene sesión: bajo la semántica nueva su sello sería `""`, un cliente ya
metido en partida lo descartaría igual y la barra de la tarjeta volvería a girar para siempre.
**El `sessionId` de un `game_gen` es basura bajo las dos semánticas.**

La razón de fondo, escrita por el usuario: **`game_gen` no es de sesión, es de juego.** El mensaje
lleva un solo campo de direccionamiento para dos esquemas distintos. El arreglo que sí cierra el
issue es que `game_gen` viaje con **`gameId`** en vez de `sessionId`, y entonces el reparto se hace
por *qué identificador trae*, sin saber de `kind`.

**Y aquí está el único síntoma de jugador de toda la tanda**, también del comentario:
`NarrativeStatusMessage` (`nefan-core/src/protocol/messages.ts:320-371`) no tiene `gameId`, y
`TitleScreen.gameGenStatus` (`nefan-html/src/ui/title-screen.ts:107`) es **una sola ranura**.
Un `game_gen` de la pre-generación del juego A **se pinta en la tarjeta del juego B** si ese es el
que está en pantalla. El agujero es anterior a #312.

### #314 — el diálogo tiene tres representaciones

Estado: «hay un diálogo abierto» vive en `input.dialogueActive`, `dialoguePanel.isVisible` (14 usos)
y `#dialogue-panel[hidden]`. El campo público `InputProvider.dialogueActive` arrastra `DevToolsDeps`
(`dev-tools-input.ts`) y la copia de `scripted-input-provider.ts`, que existen **solo** para
transportar el predicado.

**CORRECCIONES QUE MANDAN (dos comentarios del issue):**

1. **El dueño único YA EXISTE.** La tabla del cuerpo («4 escrituras») caducó a las horas por la
   limpieza `187bc38` de la propia tanda de #311. Hoy son **2 escrituras**, ambas dentro de
   `abrirDialogo()`/`cerrarDialogo()` (`main.ts:1470,1480`). **Lo que queda de este issue es el
   candado, no el dueño.**
2. **El movimiento está suprimido DOS veces, y sobra.** Medido por QA (probe F2): quitando
   `input.dialogueActive = true` de `abrirDialogo()`, el jugador **sigue sin moverse**, porque el
   bucle lo suprime por su cuenta. Lo único que `dialogueActive` protege **en exclusiva** es lo que
   el provider escribe en su `keydown`/`mousedown`: selección de ataque, `E`, `R`, `Y`/`N` y las
   teclas dev. **No hay que preservar la supresión del movimiento.**

**CORRECCIÓN DEL CRÍTICO — la restricción económica que escribí era falsa.** No es cierto que «para
entrar a coste cero el escritor deba vivir en un fichero eximible». La vía barata es el **criterio 5**:
si `dialogueActive` deja de ser campo público de `InputProvider`, **ningún módulo de fuera puede
escribirlo**, el patrón se queda con **cero ocupantes y cero exenciones**, y el candado entra a cero
sin mover `abrirDialogo` de sitio. Línea base medida hoy: **`npm run deuda` = 66 items · Fronteras 15**.

Y de ahí la consecuencia incómoda: **con el campo privado, quien prohíbe el sexto espejo es el TIPO.**
Un checker que duplica una garantía del tipo cobra poco («La garantía va en el tipo»). El criterio 4
viaja a hombros del 5, no al revés — y **se retira antes que pagar un solo item de deuda**.

**Dos hechos que el crítico añade y que se descubrirían tarde:**

- `dialogueActive` se **LEE** en cuatro sitios de `main.ts` (`:518` `DevToolsDeps`, `:1183`, `:1203-1204`
  los hooks de bench), y los guiones **37, 41 y 42** leen `window.__nefan.state().dialogueActive` y
  `puedeAtacar()`. Quitar la escritura pública **tiene que conservar la LECTURA** o esos tres se ponen
  rojos por el motivo equivocado.
- **Hermano no nombrado:** `tileProposalActive` (`input/input-provider.ts:64`) es el mismo patrón —campo
  público mutable que escribe el bucle—. **Esta tanda no lo toca**, y se dice explícitamente para que no
  reaparezca como issue sorpresa.

**Honestidad sobre la urgencia, del propio issue:** hoy **no diverge**. Esto es higiene con candado, no
un bug de jugador.

**Lo que NO es esto:** bajar el gate a `puerta-de-teclado.ts`. Se midió en #311, mide peor, y la razón
está escrita en ese fichero. No se vuelve a litigar.

### #316 — REENCUADRADO: el agujero que ni el issue ni el statu quo cierran

**La premisa del issue es FALSA, medida con `tsc` por el crítico** (tres experimentos, restaurando el
fichero entre cada uno):

| Experimento | Resultado |
|---|---|
| Quitar el neutro `combatSystem: ""` de `NO_SESSION` | **ROJO** (`TS2741`, core y html) |
| Quitar el aplicador `combat` de `APLICADORES` | **ROJO** (`TS2741`) |
| Añadir `sonda(sessionId): void` solo a `FacetSinks` | **ROJO EN DOS SITIOS** (`TS2741` en `APLICADORES`, `TS2345` en `main.ts:254`) |

O sea: «se puede añadir un sink por `sessionId` sin que nada lo note» **no es cierto**, y «quitar un
neutro solo pone rojo cinco de los ocho» tampoco — hay SEIS facetas, seis neutros, y quitar cualquiera
pone rojo. Además **el censo del issue está mal**: son **cuatro** los sinks con forma
`(s,f) => s.X(f.sessionId)`, no tres — falta `mundo` (`:159`).

**Y partir el record como pide el issue cuesta el ORDEN, que es el diseño**: `mundo` va el PRIMERO
(su comentario `:154-158` explica el bug del atlas, y `test/session-facets.test.ts:189` lo afirma) y
`dialogo` va el ÚLTIMO (`:102-104`). Los dos mecanismos van **INTERCALADOS**; dos listas no expresan
«primero éste, luego las cinco facetas, luego aquél» sin reinventar lo que un solo record ordenado da
gratis.

**DECISIÓN DEL USUARIO — se reencuadra hacia el agujero de verdad**, que es el que el crítico encontró
y que ni el issue ni el statu quo cierran:

> **Un aplicador puede pasar el campo EQUIVOCADO del mismo tipo, y compila.**

**Verificado por el coordinador**, no citado: sustituyendo `style: (s, f) => s.style(f.styleId)` por
`style: (s, f) => s.style(f.combatSystem)`, `npx tsc --noEmit -p tsconfig.json` sale **con cero
errores**. `SessionFacets` tiene **cinco campos `string`** (`sessionId`, `styleId`, `renderMode`,
`characterMode`, `combatSystem`), así que cualquiera es intercambiable por cualquiera a ojos del
compilador.

**Por qué importa, y no es teórico:** el sink `style` alimenta la clave de caché de imagen. Un
`styleId` equivocado es arte **pagado** del estilo que no era — que es literalmente el bug #249, el
que creó este módulo. La garantía que el módulo vende («una faceta sin neutro no compila, sin
aplicador no compila») no cubre «el aplicador pasa lo que le toca».

Objetivo del reencuadre: **hacer inexpresable el cableado equivocado**, no añadir un test que lo
persiga. Si se cierra así, #316 se cierra habiendo comprado algo que `tsc` no compraba ya.

## 4 · Criterios de aceptación

Con las correcciones del crítico aplicadas. Cada uno debe poder **nacer rojo**: si se puede satisfacer
sin que cambie nada, no es criterio. **Se mide el rojo ANTES de tocar nada y se pega la salida en el
informe.**

1. **Un `game_gen` del juego A no se pinta en la tarjeta del juego B.** Es el único síntoma de jugador
   de la tanda y **está reproducido**: con *alta_fantasia* generándose y la tarjeta de *cuentos_oscuros*
   seleccionada, `#ts-gen-progress` dice «Generando el anillo de tiles (3/8)…» y luego «Mundo de
   Miravanda generado». Debe quedar candado **en ejecución**, no solo en tipos.
2. **`destinoDeStatus` no mira `kind`.** El `if (status.kind === "game_gen")` se borra y el reparto se
   hace por qué identificador trae el mensaje. **Y se cierra el juego de manos que avisó el crítico**:
   el `kind` **no reaparece** en `sellarSesion`/`ws-server.ts`. O el tipo hace **inexpresable** un
   `game_gen` con sello de sesión, o el criterio no está cumplido.
3. **REESCRITO — el criterio anterior NACÍA VERDE.** «Hoy no lo cubre ningún guion» es falso:
   `qa/guiones/38-tras-jugar-la-pre-generacion-sigue-hablando.mjs`, bloque 3 (`:134-152`), ya juega →
   vuelve al título → regenera y afirma `ready`, commiteado en `55ad470`. Lo que toca es:
   **el guion 38 se REESCRIBE al direccionamiento nuevo** —su bloque 2 inyecta a mano un `game_gen`
   con sello, una forma que va a DESAPARECER— **y gana el aserto A/B que hoy falla**: con el mundo de
   A generándose y la tarjeta de B seleccionada, `#ts-gen-progress` no habla de A.
4. **El candado del diálogo entra a coste cero**: `npm run deuda` sigue en **66 items · Fronteras 15**.
   Si solo puede entrar subiendo la deuda, **no entra** y se dice por qué. Va a hombros del criterio 5.
5. **`InputProvider.dialogueActive` deja de ser campo público**, y con él se van `DevToolsDeps` y la
   copia de `scripted-input-provider.ts` — **conservando la LECTURA** que usan los hooks de bench y los
   guiones 37, 41 y 42.
6. **REESCRITO — el criterio anterior NACÍA VERDE** («solo funciona para cinco de los ocho» es falso).
   El criterio nuevo, por la decisión del usuario: **un aplicador que pasa el campo equivocado del mismo
   tipo deja de compilar.** Se comprueba cableando `style: (s,f) => s.style(f.combatSystem)` y viendo
   `tsc` **rojo** — hoy sale verde, medido. Y sin perder lo que ya funciona: el record sigue siendo
   **UNO y ordenado**, `NOMBRES_DE_SINK[0] === "mundo"` sigue verde, y quitar un neutro o un aplicador
   sigue sin compilar.
7. **Los tres issues se cierran**, o el que no se cierre lo dice con su medida.

## 5 · Restricciones

- **Pre-producción, cero compatibilidad**: lo que se sustituya se borra el mismo día, entero y en todos
  los procesos. En concreto, y el crítico lo señala como obligatorio **en la misma PR**:
  `test/session-facets.test.ts:252-261` (afirma que un `game_gen` va al título SIN preguntar el sello) y
  el **bloque 2 del guion 38**. Si sobreviven, quedan verdes sobre un cable que ya no lleva eso.
- **La deuda no sube.** Línea base **66 · Fronteras 15**. Es el criterio 4 y es lo que mató este trabajo
  en #311.
- **Los guiones 34 (#320) y 22 (#308) son intermitentes CONOCIDOS y ajenos** — 1 de cada 4 baterías y
  4 de 6 respectivamente. Una roja suya **no es hallazgo de esta tanda** y no se gasta presupuesto de
  verificación persiguiéndola.
  *Apostilla 2026-08-30: #308 y #320 CERRADOS — el 22 no era intermitente sino un guion que medía la fixture anterior, y el control del 34 pasaba en verde con tres de las cuatro teclas muertas. Ya no hay ajenos que declarar.*
- **Cero créditos.** Nada de esta tanda necesita generación de imagen.
- `npm run verify` verde y CI verde antes de dar nada por hecho.
- El candado va **en el tipo o en un test que puede ponerse rojo**, nunca en prosa de CLAUDE.md. Y donde
  el tipo pueda dar la garantía, la da el tipo.

## 6 · Lo que esta tanda NO hace

- No baja el gate del diálogo a `puerta-de-teclado.ts` (medido peor en #311).
- No colapsa `dialoguePanel.isVisible` ni el `[hidden]` del DOM: el dueño único los empareja, no los funde.
- No toca la supresión de movimiento del bucle, que tiene dueño propio.
- No toca `tileProposalActive`, hermano del mismo patrón que #314. Queda nombrado, no arreglado.
- No toca `errors.push("narrative", …)` de `title-screen.ts:158-166`: eso es **#306**.
- **`destinoDeStatus` solo se mueve a `protocol/status-labels.ts` si #313 la reescribe entera** (y
  entonces es gratis, y con ella se va el import de `protocol/messages.js` que ensucia
  `session-facets.ts`). **Sola, no se toca**: no es un tercer trabajo.
- No arregla `status-labels.ts:71`, que le da a `game_gen` el motivo de `consequences`. Es un issue nuevo
  de una línea; se abre, no se hace aquí.
