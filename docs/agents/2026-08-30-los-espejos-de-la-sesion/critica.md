# Crítica — Los espejos de la sesión (#313 #314 #316)

**#313 VIGENTE · #314 REENCUADRADA · #316 REENCUADRADA (cerrable) · un criterio de la §4 NACE VERDE.**

## El problema real, uno por issue

- **#313** — un `narrative_status` de pre-generación no dice de qué JUEGO es, y el título tiene una sola ranura donde pintarlo. (La solución propuesta —`gameId` en vez de `sessionId`— ataca exactamente eso.)
- **#314** — el gate del diálogo se puede escribir desde cualquier sitio, y nada lo impide. (La solución propuesta ataca el conteo de escrituras; el que cierra es el tipo.)
- **#316** — el nombre `FacetSinks` describe la mitad de sus entradas. (La solución propuesta —partir el record— ataca un candado roto que, medido, no está roto.)

## La premisa, afirmación por afirmación

### #313 — todo lo verificado se sostiene, y el síntoma está REPRODUCIDO

| Afirmación | Verificación |
|---|---|
| El sello es «quién emitía» | `bridge/ws-server.ts:130,134` sella con `narrative.session_id`, y su comentario `:117-124` lo dice literal |
| `destinoDeStatus` abre con excepción por `kind` | `src/session/session-facets.ts:254` — `if (status.kind === "game_gen") return "titulo"` |
| `game_gen` no tiene sesión propia | `bridge/handlers/game-gen.ts:162` abre una sesión EFÍMERA y `:224-226` la descarta en el `finally`. El corrector tiene razón: su `sessionId` es basura bajo las dos semánticas |
| `NarrativeStatusMessage` no tiene `gameId` | `src/protocol/messages.ts:320-371`: `kind` en `:342`, ningún campo de juego |
| `TitleScreen.gameGenStatus` es una sola ranura | `nefan-html/src/ui/title-screen.ts:107`, escrita en `:152`, pintada en `#ts-gen-progress` (`:153`), que vive DENTRO de `#ts-gen` (`:691-699`) — el panel del juego SELECCIONADO |
| Nada impide cambiar de tarjeta durante la generación | `:885` solo hace `genWorldBtn.disabled = true`; los handlers de tarjeta (`:800-806`) siguen vivos |

**Reproducido en el juego real** (preset `e2e-sin-creditos`, `NEFAN_PORT_OFFSET=500`, `NEFAN_GAMES_DIR` aislado en scratchpad, cero créditos; `data/games` intacto — `git status` limpio). Pulsar «Regenerar mundo» en *alta_fantasia* y acto seguido la tarjeta de *cuentos_oscuros*, con `cuentos_oscuros` seleccionado:

```
#ts-gen-state    : "Mundo: ✓ generado · Estilo Sombra de cuento: — sin aplicar"   (de cuentos_oscuros)
#ts-gen-progress : "⚙ Generando el anillo de tiles (3/8)... · 0 min"  [genPhase=progress]
#ts-gen-progress : "Mundo de Miravanda generado: 9 escenas."          [genPhase=ready]
```

La línea intermedia **no nombra ningún juego** (`game-gen.ts:190`), así que quien juega lee «cuentos_oscuros se está generando». Es el síntoma, en dos clicks, sin trampa.

### #314 — la premisa corregida se sostiene; la restricción económica NO es la que dice

- **2 escrituras**, medidas hoy: `main.ts:1470,1480`, ambas dentro de `abrirDialogo`/`cerrarDialogo`. La tabla del cuerpo (4/5) sigue caducada; manda el comentario.
- **Línea base de deuda, medida hoy y no citada de hace dos días**: `npm run deuda` → **66 items · Fronteras 15**. Coincide con el `main: 66/15` de #311, así que la aritmética +2 del comentario sigue siendo válida.
- **Lo que la premisa se equivoca**: dice que para entrar a coste cero «el escritor debe vivir en un fichero eximible». Hay una ruta más barata y es la del criterio 5: si `dialogueActive` deja de ser campo público de `InputProvider`, **ningún módulo de fuera puede escribirlo**, el patrón se queda con **cero ocupantes y cero exenciones**, y el candado entra a cero sin mover `abrirDialogo` de sitio.
- **Y entonces la pregunta incómoda**: con el campo privado, quien prohíbe el sexto espejo es el TIPO. Un checker que duplica una garantía del tipo cobra poco («La garantía va en el tipo», CLAUDE.md). El criterio 4 viaja a hombros del 5, no al revés.
- **Lo que la §4 no dice y se descubrirá tarde**: `dialogueActive` se LEE en cuatro sitios de `main.ts` (`:518` DevToolsDeps, `:1183` y `:1203-1204` los hooks de bench), y los guiones **37, 41 y 42** leen `window.__nefan.state().dialogueActive` y `puedeAtacar()`. Quitar la escritura pública tiene que conservar la LECTURA o esos tres se ponen rojos por el motivo equivocado.
- **Hermano no nombrado**: `tileProposalActive` (`input/input-provider.ts:64`) es el mismo patrón —campo público mutable que escribe el bucle—. Arreglar uno de dos está bien; no decirlo reabre el issue en la tanda siguiente.

### #316 — la premisa está medida y es FALSA en la forma en que está escrita

Tres experimentos con `tsc --noEmit` sobre `nefan-core` y `nefan-html`, restaurando el fichero entre cada uno (árbol limpio al terminar):

| Experimento | Resultado |
|---|---|
| Quitar el neutro `combatSystem: ""` de `NO_SESSION` | **ROJO** — `TS2741` en core **y** en html |
| Quitar el aplicador `combat` de `APLICADORES` | **ROJO** — `TS2741` |
| Añadir `sonda(sessionId: string): void` solo a `FacetSinks` | **ROJO EN DOS SITIOS** — `TS2741` en `APLICADORES` y `TS2345` en `main.ts:254` |

Consecuencias, en orden de importancia:

1. **«Se puede añadir un sink por `sessionId` sin que nada lo note» es falso**: no compila en dos sitios. Lo que no hace falta es un neutro NUEVO — porque su neutro es `sessionId: ""`, que ya existe y ya está candado (experimento 1).
2. **«Quitar un neutro solo pone rojo cinco de los ocho» es falso**: hay SEIS facetas y seis neutros, y quitar cualquiera pone rojo. La frase confunde sinks con facetas; no hay un séptimo ni un octavo neutro que quitar.
3. **El censo del issue está mal**: son **cuatro** los sinks con aplicador `(s,f) => s.X(f.sessionId)`, no tres — falta `mundo` (`session-facets.ts:159`), que tiene exactamente la misma forma.
4. **El agujero de verdad existe y el arreglo propuesto no lo cierra**: un aplicador puede pasar el campo EQUIVOCADO del mismo tipo (`foo: (s,f) => s.foo(f.sessionId)` para una faceta `string` compila), y eso vale igual para `styleId`, `renderMode`, `characterMode` y `combatSystem`. Partir el record en dos mecanismos deja ese agujero donde está.

## El día después

- **#313** — el reparto deja de saber de `kind`, pero **`sessionId` deja de ser obligatorio en todo `narrative_status`**, y eso afloja el invariante de #282 («un evento sin sello no es expresable», `messages.ts:301-311`, `SinSelloDeSesion` en `:535`). Se paga en el tipo (unión discriminada: o sello, o `gameId`, nunca ninguno) o no se paga: con un `gameId?` opcional al lado de un `sessionId` opcional, el reparto «por qué identificador trae» vuelve a ser una convención sin candado. **Y ojo al juego de manos**: el criterio 2 se puede satisfacer moviendo el `if (kind === "game_gen")` de `destinoDeStatus` a `sellarSesion`/`ws-server.ts`. Eso no cierra nada; que QA lo mire.
- **Hay que borrar en la misma PR** (pre-producción, cero compatibilidad): `test/session-facets.test.ts:252-261` (afirma que un `game_gen` va al título SIN preguntar el sello) y el **bloque 2 del guion 38**, que inyecta a mano un `game_gen` con sello ajeno — un mensaje de una forma que dejará de existir. Si sobreviven, quedan verdes sobre un cable que ya no lleva eso.
- **#314** — el día después está bien: menos superficie pública en `InputProvider`, `DevToolsDeps` fuera, y el gate solo escribible por su dueño. Lo que se vuelve más difícil es que un guion futuro fuerce el gate a mano; hoy ninguno lo hace (los tres lo LEEN).
- **#316** — partir el record cuesta el ORDEN, que es el diseño: `mundo` (forma de cambio-de-sesión) tiene que ir **el primero** —su comentario `:154-158` explica el bug del atlas y `test/session-facets.test.ts:189` lo afirma— y `dialogo` (misma forma) **el último** (`:102-104`). Los dos mecanismos van INTERCALADOS. Dos listas no expresan «primero éste, luego las cinco facetas, luego aquél» sin reinventar el intercalado que un solo record ordenado da gratis. Se compra honestidad de nombre y se paga con una garantía que tiene un bug documentado detrás.

## Conflictos

- **#320 y #308 contra la restricción §5** («batería de guiones completa verde»): hoy es inalcanzable por medida ajena — #320 dice que el guion 34 falla 1 de cada 4 baterías completas y #308 que el 22 sale rojo 4 de 6. Declararlos como intermitentes conocidos ANTES de empezar, o la tanda gasta su presupuesto de verificación persiguiendo el flake de otro.
  *Apostilla 2026-08-30: #308 y #320 CERRADOS — el 22 no era intermitente sino un guion que medía la fixture anterior, y el control del 34 pasaba en verde con tres de las cuatro teclas muertas. Ya no hay ajenos que declarar.*
- **#241** (ni una línea de `nefan-html` medida) es la razón por la que el candado de #314 tiene que ser regla de `arch-rules` y no un test. No es contradicción: es una dependencia que sigue sin resolverse, y conviene escribirlo en vez de redescubrirlo.
- **#306** (errores del título sin canal) toca `title-screen.ts` a cuatro líneas de donde toca #313. No se contradicen — pero #313 no debe «mejorar» el `errors.push("narrative", …)` de `:158-166`: eso es #306.
- Ningún candado de `arch-rules.json` prohíbe añadir un campo de direccionamiento a un mensaje de protocolo. Los de reaparición vivos (`stage_request`/`stage_review`, `texture_hash`) no rozan esto.

## El criterio que nace verde

| # | ¿Puede nacer rojo? | Cómo se comprueba |
|---|---|---|
| 1 | **Sí, y hoy es rojo** | Medido arriba: la línea de *Miravanda* bajo la tarjeta de *cuentos_oscuros* |
| 2 | Sí | El `if` de `:254` existe; borrarlo hoy deja la barra girando (lo afirma el guion 38 bloque 2) |
| 3 | **NO — NACE VERDE.** «Hoy no lo cubre ningún guion» es falso | `qa/guiones/38-tras-jugar-la-pre-generacion-sigue-hablando.mjs`, bloque 3 (`:134-152`), juega → vuelve al título → `regenerarMundo` y afirma `ready`. Commiteado en `55ad470`, la tanda de #312 |
| 4 | Sí | 2 ocupantes hoy (`main.ts:1470,1480`); línea base medida 66/15 |
| 5 | Sí | `input-provider.ts:61` es público hoy; `DevToolsDeps` y la copia de `scripted-input-provider.ts:23` existen |
| 6 | **NO en la forma escrita** | «Solo funciona para cinco de los ocho» ya es falso: los tres experimentos de arriba salen rojos. Reescribirlo o retirarlo |
| 7 | Sí | Es el resultado, no un candado |

## Coste contra valor

- **#313**: el único síntoma de jugador, reproducido, alcanzable en dos clicks. Vale — pero es el MÁS caro de los tres: toca el contrato del wire de todo `narrative_status`, más el guion 38 y un test de core. No hacer nada deja al jugador leyendo el progreso del mundo equivocado.
- **#314**: sin síntoma hoy, por confesión propia. Vale **solo si entra el criterio 5**, que es lo que hace gratis el 4. Si el ingeniero solo consigue el 4 pagando deuda, no se hace ninguno de los dos y se dice por qué.
- **#316**: como está escrito no compra nada que `tsc` no compre ya. **No hacer nada es la opción honesta**, y el texto para pegar en el issue son los tres experimentos y el censo de cuatro. Si aun así se quiere: renombrar el record para que diga lo que es, **conservando UN solo record ordenado**, y escribir por qué el orden intercala los dos mecanismos. Eso cuesta un comentario y un rename, no un rediseño.

## Qué le cambiaría a `requisitos.md`

- **§4.3 — reescribir entero.** El guion existe. Sustituir por: «`qa/guiones/38-…mjs` se REESCRIBE al direccionamiento nuevo (su bloque 2 inyecta un `game_gen` con sello, forma que va a desaparecer) y **gana el aserto A/B que hoy falla**: con el mundo de A generándose y la tarjeta de B seleccionada, `#ts-gen-progress` no habla de A. Ese aserto se mide ROJO antes de tocar nada y se pega la salida en el informe.»
- **§4.6 — reescribir.** Quitar «hoy eso solo funciona para cinco de los ocho» (falso, medido). Si #316 sigue vivo, el criterio es: «el record sigue siendo UNO y ordenado, `NOMBRES_DE_SINK[0] === "mundo"` sigue verde, y el tipo dice cuáles de sus entradas son facetas y cuáles cambios de sesión.»
- **§3 #314 — corregir la restricción económica.** Añadir: «la vía a coste cero NO es mover el dueño a un fichero eximible, sino que el criterio 5 deje el campo sin escritores externos: cero ocupantes, cero exenciones. Y si el 5 entra, el 4 es cinturón sobre tirantes: se retira antes que pagar un solo item de deuda.»
- **§3 #314 — añadir dos hechos**: los tres guiones (37/41/42) que LEEN el gate por el hook, y `tileProposalActive` como hermano del mismo patrón que esta tanda no toca.
- **§4.2 — cerrar el juego de manos.** Añadir: «…y el `kind` no reaparece en `ws-server.ts`: o el tipo hace inexpresable un `game_gen` con sello, o el criterio no está cumplido.»
- **§5 — añadir**: «los guiones 34 (#320) y 22 (#308) son intermitentes conocidos; una roja suya no es hallazgo de esta tanda.»
  *Apostilla 2026-08-30: #308 y #320 CERRADOS — el 22 no era intermitente sino un guion que medía la fixture anterior, y el control del 34 pasaba en verde con tres de las cuatro teclas muertas. Ya no hay ajenos que declarar.*
- **Nota de sitio de #316 (`destinoDeStatus` → `protocol/status-labels.ts`)**: es alcance de **#313**, no de #316, y solo como consecuencia. #313 reescribe esa función entera (deja de mirar `kind`, pasa a mirar el identificador); moverla en el mismo diff es gratis, y con ella se va el import de `protocol/messages.js` que ensucia `session-facets.ts`. Lo que NO debe pasar es que se mueva sola, como tercer trabajo. Si #313 no la reescribe, no se toca. (De paso, cuando alguien abra ese fichero: `status-labels.ts:71` le da a `game_gen` el motivo de `consequences` — «El motor narrativo rechazó la reacción» —, que es de otro `kind`. Es un issue nuevo de una línea, no de esta tanda.)
