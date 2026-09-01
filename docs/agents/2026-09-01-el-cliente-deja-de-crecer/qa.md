# QA — T3 «El cliente deja de crecer» (#358 + #379 + #329)

Validado sobre `t3/el-cliente-deja-de-crecer` (`30edcd1`), contra `main` en
`6c0cf7b`. Todo con el preset `e2e-sin-creditos`: **cero créditos** — el
guardarraíl del runner declaró `fake:true` en cliente y bridge en las 58
aperturas de guion, y el contador de rutas de pago del motor falso quedó a 0 €.

**La afirmación que había que demostrar no es «funciona lo nuevo», es «el jugador
no nota nada»** en un refactor de +3.476/−1.150 en 31 ficheros. Lo que la
sostiene, en orden de fuerza: la batería entera verde (56/56 antes de tocar nada
mío, 57/57 con el guion que dejo), un guion NUEVO que cubre las dos mitades de
esta tanda que ningún candado podía poner rojas, y la lectura línea a línea del
`addTile`/`gameLoop` viejos contra sus siete módulos nuevos buscando deltas de
comportamiento.

**Los candados los he probado en negativo YO**, sin fiarme de la tabla de trece
de §3 del informe. Los cuatro sabotajes del cliente son míos y **dos de ellos
salían con todo en verde**.

---

## Criterios de aceptación

| # | Criterio | | Evidencia |
|---|---|---|---|
| 1 | Candado ejecutable con tope global ~400 sobre `nefan-html/src`, excepción declarada para los 4 que hoy lo superan, **un fichero nuevo de 500 líneas rojo sin tocar nada más**, probado en negativo | ✅ | Probado por QA: fichero de **450 líneas → verde, 451 → rojo** (`File has too many lines (451). Maximum allowed is 450`); fichero NUEVO de 500 líneas en `src/world/` → `npm run lint` rojo con **1 solo problema** (los otros 39 verdes); `main.ts` + 1 línea → `too many lines (2327). Maximum allowed is 2326`. El número que reporta eslint es el de `wc -l`, comprobado en los cuatro casos. **Con dos rodeos abiertos, ver H-1 y H-2** |
| 2 | `main.ts` baja de 3.136 de forma medible y el número nuevo queda congelado | ✅ | `wc -l src/main.ts` = **2.326** (−810, −25,8 %), y la excepción del candado dice exactamente 2326 — la línea 2327 es roja (medido arriba). `grep -c '^let '` = **22** (eran 40); `gameLoop` = **194** líneas (eran 410); `addTile` fuera del fichero |
| 3 | Las claves VIVAS de `__nefan` responden lo mismo · `node qa/run.mjs` con **0 rojos y 0 ⊘** | ✅ | `56 en verde · 0 en rojo de 56` (exit 0, 0 ⊘, corrida limpia de la rama antes de tocar nada) y `57 en verde · 0 en rojo de 57` con mi guion dentro. Y el cruce completo: de las 35 claves que leen `qa/` + `labs/`, **las 35 existen**; las dos que solo lee `labs/` son `debug` (definida) y `stage`, que no es código sino una línea de `labs/narrative/stage-cutouts-e2e.md` sobre el proscenio retirado |
| 4 | Lo puro extraído vive en `nefan-core/src/` con test propio y entra en `mutation-targets.json` con suelo declarado | ✅ con matiz | 4 módulos (`entidades-del-tile`, `paso-del-jugador`, `mirada`, `apuntado`) con 4 baterías y 63 tests nuevos (`npm test`: 1.892 pass, 0 fail). Los suelos son `break: 0` y están **declarados y pedidos, no medidos**. Verifiqué el motivo, no me lo creí: `npm run mutacion -- local entidades-del-tile` → *«NO se mide aquí: no hay medida previa… Pídelo»*. **De acuerdo con la desviación §4.1** |
| 5 | `npm run verify` verde **y** `npm run coverage && npm run crap -- --check` verde contra el suelo de 89 % | ✅ | Corridos por QA sobre el árbol final: core `build`+`typecheck:scripts`+`typecheck:labs`+`lint`+`test` (1.892/1.892) · cliente `tsc --noEmit` + `lint` + `build` (✓ 1,77 s) · `crap --check` → **cobertura 89,2 %, CRAP ≤ 73 con 0 por encima, exit 0**. `npm run deuda` = **71 items · Fronteras 15**, idéntico a la línea base declarada. Sobre el margen de 0,2 puntos, ver el apartado «Las cuatro cosas abiertas», punto 3 |
| 6a | #379: **una sola política** en la carga de tile | ✅ | `grep -rn "ids.has" nefan-html/src` = 0. Y medido en el juego, que es lo que faltaba: re-emitir un tile con la descripción, la categoría y la celda de un objeto cambiadas **se ve** (guion 58, bloque 2); con el `Object.assign` de la re-aplicación borrado, 3 asertos rojos — y `lint`, `tsc` y los 56 guiones anteriores TODOS verdes sin él |
| 6b | #329: `tileProposalActive` sin espejo, el provider pregunta a su dueño | ✅ | `grep -rn tileProposalActive nefan-html/src` = 2, las dos en prosa que cuenta la retirada; `dialogueActive` idem. Y ejercido con el TECLADO de verdad por primera vez: caminar al este propone, **`Y` acepta y llega `tile_1_0`**; con la derivación cableada a `false` el jugador no puede aceptar (rojo), y con `true` la propuesta se auto-acepta en el fotograma en que nace (rojo) |
| — | Respawn (`R`) | ⚠️ no probado | Ningún guion lo ejercía antes de la tanda ni lo ejerce ahora. Verificado solo por equivalencia de código: `EcoDelCombate.procesar` traduce `died`/`player_respawned` con la misma cadena de `else if` que el bucle viejo, y `promptBar` ofrece «R · reaparecer» con `!eco.jugadorVivo` donde antes ponía `!playerAlive`. **No he visto al jugador morir y reaparecer.** Detalle que viaja igual que en `main` y que por tanto NO es regresión: ni el `playerAlive` viejo ni el `#vivo` nuevo se reinician en `resetWorld` |

### Lo que ejercí jugando, y con qué

| Camino del jugador | Cubierto por | Estado |
|---|---|---|
| Título → «Nueva partida» → «Comenzar» → mundo pintado | 01, 18, 19, 27, 29, 52 + mi guion 58 | ✅ |
| Cargar tile, colisión desde huella, caminar y deslizar | 01, 02, 05, 06, 16, 30, 31, 32, 45 | ✅ |
| Viajar entre tiles y volver | 08, 09, 42, 49 | ✅ |
| **Propuesta de explorar el vecino, teclas Y/N** | **58 (nuevo — antes nadie pulsaba la tecla)** | ✅ |
| Diálogo (abrir, elegir, el teclado de juego mudo mientras) | 37, 43, 14 | ✅ |
| Combate (pegar, herir, matar, la herida sobrevive al viaje y al resume) | 41, 42, 48, 49, 54, 57 | ✅ |
| Spawn dinámico y que **un objeto spawneado sobreviva a la ida y vuelta** (#350) | 48, 49 (bloques 0b y 2) | ✅ |
| Reanudar (una y dos veces), save corrupto, borrar partida | 17, 46, 48, 49, 52, 56 | ✅ |
| Re-emitir un tile que dice algo distinto (#379) | **58 (nuevo)** | ✅ |
| Respawn | — | ⚠️ |

---

## El guion que dejo

`qa/guiones/58-un-tile-que-vuelve-cuenta-lo-que-dice-ahora.mjs` (con su fila en
`qa/README.md`). Doce asertos en dos bloques, y existe porque **las dos mitades
de esta tanda que el jugador toca no tenían ocupante**:

1. **`Y`/`N` con el teclado de verdad.** El gate de #329
   (`InputDeps.propuestaDeTileAbierta()`) lo lee **solo**
   `KeyboardInputProvider`. La batería entera corre con `?input=scripted`, y
   `ScriptedInputProvider.queueTileConfirm()` **no pregunta nada**: los guiones
   05 y 42 aceptan la propuesta por ahí. O sea que se podía dejar la derivación
   entera en `false` —el jugador incapaz de decir que sí a explorar— con los 56
   guiones en verde. El guion navega sin `?input=scripted`, camina al este con
   `w`, espera la propuesta y pulsa `y`.
2. **La re-aplicación de lo declarado (#379).** La política CONSERVAR obliga a
   re-aplicar lo que el tile declara ahora; esa re-aplicación vive en
   `nefan-html/src/world/carga-de-tile.ts`, donde no hay tests ni mutación
   (#241). El módulo de core prueba que el reparto **devuelve** lo declarado, no
   que nadie lo **aplique**. Se mide la asimetría entera, que es la parte
   delicada de la decisión: ante el mismo cambio, un objeto se mueve y trae su
   prosa y su categoría nuevas, y un personaje adopta el nombre nuevo pero
   **conserva su sitio**.

**Probado en negativo por QA, cuatro sabotajes uno a uno**, con la salida real
pegada en la cabecera del guion:

| Sabotaje | Resultado |
|---|---|
| Quitar `Object.assign(entity, declaradoDeObjeto(…))` de `poblar` | **3 rojos**: `"pozo de la plaza" → "pozo de la plaza"`, `prop → prop`, `x -0.75 → -0.75`. Con la línea fuera, `npm run lint`, `tsc --noEmit` y **los 56 guiones anteriores siguen verdes** |
| Re-aplicar la posición a un personaje conservado | **1 rojo**: `x -17.75 → -7.75` — el teletransporte a la celda de spawn |
| `propuestaDeTileAbierta = () => false` | **1 rojo**: la `Y` no acepta, expira esperando el tile vecino (794 sondeos). El resto de la batería, verde |
| `propuestaDeTileAbierta = () => true` | **3 rojos**: la `Y` pulsada antes queda armada y acepta la propuesta en el fotograma en que nace (`proposal:null, confirmar:[]`) — en el juego de verdad, generar mundo y **gastar** sin que nadie lo pida |

Los sabotajes se revirtieron; el árbol quedó limpio (`git status` sin
modificaciones fuera de `qa/`).

---

## Hallazgos

### H-1 · IMPORTANTE — un comentario de una línea apaga el candado de tamaño, en silencio

```
$ printf '/* eslint-disable max-lines */\n' > src/__qa-disable.ts   # + 599 líneas
$ npx eslint src/__qa-disable.ts ; echo $?
0
```

`nefan-html/eslint.config.js` no declara `linterOptions.noInlineConfig` ni
`reportUnusedDisableDirectives`, así que `/* eslint-disable max-lines */` (o un
`// eslint-disable-next-line max-lines`) devuelve el fichero al régimen anterior
sin dejar rastro en ninguna salida.

**Por qué importa más de lo que parece aquí y no en otra regla**: el problema que
abre `requisitos.md` es literalmente *«el único invariante estructural que
depende de que alguien se acuerde»*. Un tope que se apaga con una línea de
comentario, escrita por quien está a punto de pasarse, no cambia esa naturaleza —
solo mueve el sitio donde hay que acordarse. Y es un rodeo más barato que el
`main-2.ts` que el crítico cerró.

**Repro**: crear cualquier fichero de más de 450 líneas en `nefan-html/src/` con
esa primera línea; `npm run lint` verde.
**Esperado por quien lea el bloque de la regla**: que entrar por encima del tope
cueste una excepción declarada, con su cifra y su motivo, visible en el diff.
**Nota**: no lo arreglo. La forma es de una línea (`linterOptions: {
noInlineConfig: true }` en el bloque global, o prohibir el disable de esa regla)
pero cambia el régimen de TODAS las reglas del paquete, y esa es una decisión de
quien lo escribió.

### H-2 · IMPORTANTE — las cuatro excepciones no tienen quien las vigile envejecer

`arch-rules.json` tiene `deadExceptions()` + `formatDeadExceptions()`: una
exención que se quedó sin sujeto se denuncia sola. El candado nuevo de eslint no
tiene nada equivalente. Consecuencia concreta: el día que `title-screen.ts` baje
de 1.651 a 900 por #346, la excepción seguirá diciendo 1651 y le regalará **751
líneas de recrecimiento**, sin que nada se ponga rojo ni salga en `npm run
deuda`.

Lo que hoy impide eso está escrito en el propio bloque: *«cada entrega que corte
uno de estos ficheros BAJA su número en el mismo commit»*. Es prosa, y es la
misma clase de prosa que la tanda vino a sustituir por un candado. El ingeniero
la cumplió tres veces en esta rama (3.136 → 2.817 → 2.500 → 2.326), lo cual
demuestra la disciplina, no el mecanismo.

**Esperado**: que el candado se comporte como los del repo — que una excepción
por encima del tamaño real sea un fallo con nombre.

### H-3 · MENOR — el `why` del candado nuevo llega ilegible al que lo rompa

El `why` de `el-mundo-del-cliente-tiene-un-solo-dueño` está guardado con
**10 secuencias `\n` literales y 0 saltos de línea reales** (todas las demás
reglas del fichero usan saltos reales). `check.ts:270` lo imprime como
`invariante: ${report.rule.why}`, así que quien lo rompa recibe un párrafo de
2.000 caracteres con `\n\n` visibles dentro:

```
  invariante: LO QUE CAZA: que `npcEntities`, … de `nefan-html/src`.\n\nPOR QUÉ NO
  BASTA EL TIPO, que es la pregunta honesta antes de añadir un checker. …
```

El mismo `\\n\\n` se coló en los dos párrafos añadidos a
`el-gate-del-dialogo-no-vuelve-a-ser-un-campo`, que hasta esta tanda tenía sus 8
saltos reales y ahora tiene 8 reales + 2 literales. Es el mensaje que la regla
existe para entregar, y llega roto justo en el único momento en que alguien lo
lee.

**Repro**: `node -e "const r=require('./nefan-core/data/contract/arch-rules.json');
const f=r.rules.find(x=>x.id==='el-mundo-del-cliente-tiene-un-solo-dueño');
console.log((f.why.match(/\\\\n/g)||[]).length, (f.why.match(/\n/g)||[]).length)"`
→ `10 0`.

### H-4 · MENOR — el patrón de la regla nueva no ve tres formas obvias de la copia

Medido con `checkArchitecture` sobre un fichero sembrado en
`nefan-html/src/world/`:

```ts
export let npcEntities: Entity[] = [];   // 0 violaciones
 let playerYaw = 0;                      // 0 violaciones (indentado)
var enemyEntities: Entity[] = [];        // 0 violaciones
```

(control: `let npcEntities…` + `let playerYaw…` a columna 0 → **2 violaciones**,
y 0 al borrarlos.)

El `why` declara un solo hueco («una `let` con otro nombre»). El patrón es
`^let (…)`, así que también se le escapa el prefijo `export` — que es
precisamente la forma que tomaría una copia pensada para leerse desde otro
módulo, o sea el escenario que el propio `why` describe como el riesgo real del
troceo. No es grave (la forma más probable sí se caza), pero el texto promete
«en cualquier fichero de `nefan-html/src`» y entrega menos.

### H-5 · MENOR — los siete módulos nuevos del CLIENTE entraron sin un solo negativo

La tabla de §3 del informe tiene trece filas y ninguna toca `nefan-html/src/`:
nueve son sobre tests de core, dos sobre el `max-lines` y una sobre la regla de
`arch-rules`. Los siete módulos nuevos del cliente —incluida la re-aplicación de
lo declarado, que es la mitad delicada de la decisión de #379— entraron
apoyándose en que la batería siguiera verde. Y la batería seguía verde con la
línea borrada: es exactamente el «verde que no comprueba nada» que la casa
persigue, esta vez por ausencia de aserto y no por aserto vacío. Queda cerrado
con el guion 58; lo anoto porque la lección es de método, no de código.

### H-6 · MENOR — `sizeXZ`, `sizeY`, `shape` y `volumeType` se re-aplican sin que nadie mire

`declaradoDeObjeto` escribe nueve campos; `__nefan.objects()` publica cuatro
(`id`, `label`, `pos`, `category`). Mi guion cubre `label`, `category` y `pos`;
**la re-aplicación del tamaño, la forma y el tipo de volumen no tiene observador
posible desde fuera**. Un tile que re-declara su taberna el doble de grande
cambiaría el `scale.y` de la entity y ningún candado lo vería. Hoy no es un fallo
—el volumen lo pinta el greybox del plan, no la entity— pero es un hueco
declarado, no cubierto.

### Observación (fuera de alcance, pre-existente)

Al cargar una fixture del selector «Room» a mitad de partida, el bridge sigue
nombrando al NPC de la partida anterior y el panel de errores dice *«el bridge
mueve al NPC "barkeep" y el cliente no lo tiene en escena: anda invisible (¿un
spawn que no se rehidrató al reanudar?)»*. La frase atribuye a un fallo de
rehidratación lo que fue un gesto deliberado del jugador. Es de #326/#50, existe
igual en `main`, y lo apunto solo porque aparece en la captura del guion 58.

---

## Lo que cambia para el jugador (declarado por el ingeniero, verificado aquí)

El refactor es invisible **salvo en cuatro bordes**, los cuatro mejoras y los
cuatro declarados en §4.4 del informe. Los confirmo leyendo el `addTile` viejo
contra el nuevo:

| Antes (`6c0cf7b`) | Ahora | Veredicto |
|---|---|---|
| Un objeto sin `position` reventaba el tile ENTERO (`TypeError` dentro de `addTile`) | Error con su id en el panel; el resto del tile entra | mejora |
| Un NPC sin `position` aparecía callado en el (0,0) (`?? 0`) | No entra y se dice por qué | mejora |
| `name: ""` sobrevivía al `??` y pintaba un rótulo en blanco | Cae al id | mejora |
| Un id declarado dos veces en el mismo tile creaba DOS entities de objeto | Entra el primero, el segundo se reporta | mejora |
| `resetWorld` no vaciaba `currentExits` | `vaciar()` sí | mejora |
| Un objeto ya presente se destruía y se recreaba | Se conserva y se le re-aplica lo declarado | #379, medido en el guion 58 |
| Un personaje conservado solo actualizaba su `dueno` | Además adopta el NOMBRE que el tile declara ahora | cambio nuevo, no pedido; correcto y con aserto |

No encontré ningún delta **no declarado** entre las dos versiones en los caminos
que leí (`addTile`/`poblar`, `gameLoop`, mirada, paso, frontera, eco de combate,
saludo, volcado del bridge, animación). La derivación de #329 reproduce
exactamente la expresión del bucle viejo (`session.active &&
tileStore.hasGridTiles` + `proposal !== null` + `!dialoguePanel.isVisible`).

---

## Las cuatro cosas que el ingeniero dejó abiertas

**1 · «Un módulo nuevo no puede nacer con suelo de mutación medido» (§4.1) —
DE ACUERDO, y verificado.** Corrí `npm run mutacion -- local entidades-del-tile`
y `permisoLocal` lo niega con el motivo que él cita. El precedente
(`mundo-persistido` en 0 hasta la corrida 33506776818) es real y está en el
propio `mutation-targets.json`. El plan pedía algo que la herramienta prohíbe;
la desviación es correcta y está declarada. Lo que sí pediría al coordinador:
que la corrida quede **pedida de verdad** (está como trailer `Mutación:` del
último commit) y que no se pierda, porque cuatro módulos a `break: 0` son cuatro
suelos que hoy no pueden ponerse rojos.

**2 · `src/game-loop.ts` no se crea (§4.2) — DE ACUERDO.** Su medida se sostiene:
`gameLoop` es hoy **194 líneas** (lo verifiqué: 1276→1469) y es la mayor función
de `main.ts` con diferencia (la siguiente son 149). Mover 194 líneas que escriben
cuatro `let` de módulo a otro fichero exige el objeto de contexto que el propio
plan rechaza en su §3C. La ganancia real del plan —sacar concerns con nombre— sí
está: cinco módulos nuevos, con 2, 10, 6, 3 y 1 dependencias. Prefiero esto a un
`game-loop.ts` con treinta campos de contexto.

**3 · «Declarar tipos cuesta cobertura» — DE ACUERDO EN EL EFECTO, NO EN EL
MECANISMO, y el contraejemplo está en su propia tanda.** Medido sobre el lcov
limpio:

| Módulo | Cobertura de líneas | Primera sentencia ejecutable de nivel superior | Líneas sin cubrir |
|---|---|---|---|
| `src/simulation/mirada.ts` | **100,0 %** | línea 21 | 0 |
| `src/simulation/paso-del-jugador.ts` | 75,9 % | línea 23 | 1–22 |
| `src/scene/aim.ts` | 69,1 % | línea 57 | 1–56 |
| `src/session/entidades-del-tile.ts` | 73,7 % | línea 81 | 1–80 |

No es «los tipos y sus comentarios cuentan como no cubiertos… en proporción a
cuántos tipos declare el módulo»: es que **V8 marca como no cubierto todo lo que
hay ANTES de la primera sentencia de nivel superior que se ejecuta**. `mirada.ts`
declara dos interfaces, cuatro constantes y una clase, tiene 20 líneas de
cabecera y mide **100 %**, porque su primer `export const` está arriba.
`entidades-del-tile.ts` mide 73,7 % porque sus 51 líneas de cabecera y sus 29 de
tipos están *antes* de la primera función. Lo comprobé metiéndole un
`export const __QA_SONDA = 1;` en la línea 73: subió a 76,3 % sin tocar un solo
test — o sea que el dial es la posición del prólogo, no su contenido.

Consecuencias, y las digo entera porque la conclusión cambia:

- **La regla práctica que él deriva («mover lógica pura y tipada a core empuja el
  global hacia abajo en proporción a los tipos») desaconsejaría el movimiento
  correcto por un motivo que no es el real.** Lo que empuja hacia abajo es
  escribir un prólogo largo, que es justo lo que esta casa premia.
- **Y hay un remedio que sería trampa**: subir un `const` por encima del prólogo
  recupera puntos sin probar nada más. Hizo bien en no tocarlo. Lo que hay que
  arreglar es el **instrumento** (contar solo líneas ejecutables), no el código
  ni el suelo.
- **Sobre los 0,2 puntos de margen: son reales, y el aparato de medida tiene su
  propio ruido.** Cinco corridas de `npm run coverage && npm run crap` sobre el
  mismo árbol limpio: **89,3 · 89,2 · 89,2 · 89,2 · 89,2**. El valor estable es
  89,2 (el suyo es correcto) pero una de cada cinco dio una décima más. Con un
  suelo de 89 y un margen de 0,2, el ruido del propio medidor es la mitad del
  margen: la siguiente tanda que saque un módulo tipado a core puede ponerlo rojo
  sin haber empeorado nada. **Recomiendo abrir issue para lo del prólogo**; es
  una décima de trabajo y descongela el criterio 5 para toda la serie.

**4 · Lo de §5 (cliente sin cobertura, candado que no mide concentración, CSS
fuera, `worldNpcs` escapa) — DE ACUERDO, todo declarado honestamente.** Añado dos
huecos que su lista no recoge y que son de la misma familia: el `eslint-disable`
inline (H-1) y las excepciones sin vigilancia de obsolescencia (H-2).

---

## Workarounds usados durante la prueba

| Qué | Veredicto |
|---|---|
| Cerrar el título con `__nefan.closeTitle()` | **No es workaround**: pulsa `#ts-close`, el botón real. Es la convención de `qa/README.md` §3 |
| Re-emitir el tile con `__nefan.addTileRaw(formatD)` | **No es workaround**: es el mismo `addTile` por el que entra un tile del bridge (`broadcastScene` → mensaje `scene` → `addTile`), y es el seam que ya usan los guiones 22 y 32. Lo que se inyecta es un Format D distinto, que es exactamente lo que hace el motor cuando la historia cambia algo de un sitio ya visitado |
| `setPlayerPos`/`setYaw` para plantar al jugador junto al borde este | **No es workaround para lo que se mide**: la propuesta se provoca **caminando** con la tecla `w` real, y la aceptación es la tecla `y` real. El teletransporte solo ahorra los 25 m de paseo, igual que en los guiones 05 y 42 |
| Navegar sin `?input=scripted` | **Es la condición de la prueba, no un atajo**: el gate de #329 solo existe en el proveedor de teclado |
| Sabotear ficheros de producción para los negativos | Reverted; `git status` limpio. Los sabotajes son la prueba, no la receta |

Ningún overlay ocultado, ningún estado sintético, ninguna pantalla saltada.

---

## No probado

- **Respawn del jugador (`R`).** Ver la última fila de la tabla de criterios: no
  hay guion que lo ejerza, ni antes ni ahora, y no he visto morir al muñeco. La
  traducción de eventos es línea a línea, pero eso es lectura, no medida.
- **Los suelos de mutación de los cuatro módulos nuevos.** Están a 0 y la corrida
  está pedida, no hecha. No puedo afirmar que sus tests maten nada.
- **La re-aplicación de `sizeXZ`/`sizeY`/`shape`/`volumeType`** (H-6): el hook no
  las publica.
- **Gasto real de créditos.** Todo con `fake-ai-server`; el guardarraíl declaró
  `fake:true` en las 58 aperturas y el contador de rutas de pago quedó a 0. **No
  he ejercido el camino que gasta de verdad** — que en esta tanda es justo la
  tecla `Y` (`frontera-del-jugador.ts` es *«el único sitio del juego donde una
  tecla GASTA CRÉDITOS»*). Lo que sí queda medido, y es lo que protege la
  factura, es que la `Y` **no se dispara sola**: con el gate en `true` constante
  la propuesta se auto-aceptaba, y ese es hoy un aserto rojo del guion 58.
- **Comparación pixel a pixel de las capturas contra `main`.** No la hice: el
  ruido entre corridas (posiciones de NPC con vida ambiental, temporización de
  skins, panel de errores) domina cualquier diff y daría una respuesta que no se
  puede leer. La afirmación «no se nota nada» se apoya en los 57 guiones y en la
  lectura de deltas, no en un diff de imágenes.

## Crítica visual

Dos capturas propias, más el barrido de la corrida completa
(`qa/capturas/2026-09-01T20-43-45-253Z-412257/`).

- **`58-…-01-propuesta-en-pantalla.png`**: la pregunta llega bien compuesta —
  *«¿Explorar hacia el este? Se generará una zona nueva»* con `Y sí, explorar` /
  `N no`, centrada abajo, sin tapar la barra de ataques ni las salidas. Se lee
  que **cuesta algo** («se generará»), que es lo que uno quiere antes de gastar.
  El resto del cuadro es el muro de niebla del borde: correcto, aunque a esa
  distancia la frontera es una banda parda plana sin más lectura que «aquí se
  acaba». No es de esta tanda.
- **`58-…-02-tile-re-emitido.png`**: el pueblo se compone bien — casas con tejado
  a dos aguas, camino claro, estanque, arbolado y un vecino de pie con su acción
  contextual ofrecida (`E hablar con Alcaldesa Mirla`). Las texturas de tablero
  de ajedrez son el atlas del motor falso, no un defecto.
- **La queja de siempre, y no es de la tanda**: el panel de errores ocupa el
  tercio derecho de la pantalla con siete entradas de `skin IA cancelada en
  "walk"` que en el banco son inevitables (el motor falso solo tiene hoja
  `idle`). Para juzgar composición hay que mirar por debajo de él. Nada que
  reprochar a T3.

---

## Veredicto

**APTO CON RESERVAS.**

Las seis condiciones se cumplen y lo he comprobado yo, con la batería entera
verde, los candados rotos a mano y un guion nuevo que cierra los dos agujeros que
el jugador toca. El refactor es invisible: los únicos cambios de comportamiento
que encontré son los cuatro que el informe declara, y los cuatro son mejoras.

Las reservas, ninguna bloqueante:

1. **H-1** — el candado de tamaño, que es la entrega que más valía de la tanda,
   se apaga con `/* eslint-disable max-lines */` sin dejar rastro. Un rodeo más
   barato que el que el crítico cerró.
2. **H-2** — sus cuatro excepciones no tienen quien las vigile envejecer, así que
   la congelación se sostiene en la prosa que la tanda vino a sustituir.
3. **El margen de cobertura** (89,2 % contra 89) es real, pero su causa no es la
   que dice el informe y el medidor tiene una décima de ruido. Merece un issue
   —contar solo líneas ejecutables— antes de que tumbe la tanda siguiente por el
   motivo equivocado.

H-1 y H-2 son del mismo cuerpo y se arreglan en el mismo sitio; H-3 y H-4 son
retoques de una línea sobre la regla nueva. Todo eso cabe en una vuelta corta al
mismo ingeniero. Nada de ello impide mergear.
