# Tanda A · PR 1 «con qué modo arranca una partida nueva» · QA

Validado contra la petición ORIGINAL (`requisitos.md` §3 y la decisión de **un click** razonada al
final), desde el punto de vista de quien paga sin querer. Árbol `/home/al/code/ne-fan-qa-a1`
(desprendido sobre `7014a5e9`), bloque de puertos **+600**, preset `e2e-sin-creditos`, motor falso:
**cero créditos**.

**Veredicto: APTO CON HALLAZGOS.** El criterio del jugador se cumple —medido en las cuatro
combinaciones, en el cable y con un estado que la batería no visitaba— y el censo del banco, que era
lo más caro de esta PR, **es correcto: lo verifiqué de forma independiente y no encontré ni un guion
que declare una cosa y mida otra**. Los hallazgos no bloquean: el mayor es que el candado nuevo
tiene un agujero justo en la forma que el código tenía la víspera, y que quien lo tapa es la batería,
que no corre en CI.

---

## 1 · Criterios

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| C1 | **«Pulsar "Nueva partida" y jugar no gasta un céntimo sin un click explícito»** | ✅ | Guion nuevo `qa/guiones/106-…`, caso «sin tocar nada»: `save={"render":"vector","personajes":"vector"}`, puerta del atlas **0** (sondeada 10 s, 64 muestras, sonda sana) y puerta de skins **0**. Más el aserto sobre la tabla entera: *«NINGUNA partida sin un solo click abre una puerta de gasto»* ✔ |
| C2 | **«Nace en Maqueta 3D»** — las DOS facetas, no solo escenarios | ✅ | El save escrito por el bridge, no la pantalla: `render_mode="vector" character_mode="vector"` (105 y 106). El sabotaje que deja personajes en `"image"` pone rojos los dos guiones (§4) |
| C3 | **Las cuatro combinaciones (escenarios × personajes) y ninguna gasta sin su click** | ✅ | Guion 106, tabla completa medida: `(vector,vector)`→atlas 0/skins 0 · `(image,image)` con **1 click**→atlas>0/skins>0 · `(image,vector)` 2 clicks→atlas>0/skins 0 · `(vector,image)` 1 click→atlas 0/skins>0. Cada celda afirma además el save |
| C4 | **El cable**: `start_session` sin `renderMode` y con `renderMode: ""` | ✅ | Guion 106 bloque 3, como OTRO cliente por el gateway del juego: sin campo → `{"render":"vector","personajes":"vector"}`; `""` → idem; control `"image"` → `"image"`. (El mensaje del protocolo se llama `start_session`; `new_game` es el *kind* interno del título) |
| C5 | **«Encender Imagen IA es explícito»** | ✅ | Un click sobre un botón que ya lleva escrito «(gasta créditos)»; el gasto ocurre dos pantallas después al pulsar «Comenzar». Es la decisión escrita del usuario. Sobre el **«como en el home»** ver H4: la paridad literal no existe y no solo respecto del home |
| C6 | **El defecto vive una vez** (core) y lo llaman los tres sitios | ✅ | `MODO_AL_EMPEZAR` en `src/session/gates-de-imagen.ts`; `bridge/handlers/session.ts:382`; `selector-de-mundo.ts:216,228`. Sabotajes §4: tocar cualquiera de los tres pone algo rojo. Cuarta copia viva y sin candado: H5 |
| C7 | **El banco declara con qué modo mide, y ningún guion que use `nuevaPartida` cambió de puerta** | ✅ | Auditoría propia, §3. **Cero discrepancias** entre declarado y medido sobre los 114 guiones |
| C8 | Los saves existentes no se tocan | ✅ | `world: this.world` con el modo materializado (`narrative-state.ts:1024`), `MODO_AL_EMPEZAR` solo decide el que no lo trae; los guiones de resume (17, 48, 49, 54, 58) siguen verdes en la corrida completa |
| C9 | Verificación del ingeniero reproducible | ✅ | `npm test` → **2596 pass / 0 fail** · `npm run mutacion -- local gates-de-imagen` → **32 mutantes, 0 vivos, score 100 (break 100)** · `npm run crap -- --check` → *dentro de los umbrales* (cobertura 95,85 %) · batería completa **112✔ / 1✘ / 1⊘ de 114** (el ✘ es el 80 y el ⊘ el 53, los dos preexistentes y ajenos, tal como declara) |
| C10 | Gasto real de créditos | ⚠️ no probado | Todo con motor falso por mandato. Lo que se afirma es la PUERTA (la petición que manda pintar) y el SAVE, no el cargo en la cuenta |

---

## 2 · Lo que comprobé con el juego delante

Arrancado siempre desde `./start.sh --preset e2e-sin-creditos` con `NEFAN_PORT_OFFSET=600` (y el
runner con el mismo offset, que lo respeta del entorno), empezando donde empieza el jugador: título
→ «Nueva partida» → mundo → Continuar → Comenzar.

- **Las cuatro combinaciones**, cada una una partida nueva de verdad, leyendo el save del disco y los
  contadores del motor falso. Guion `qa/guiones/106-las-cuatro-puertas-y-el-cable-de-una-partida-nueva.mjs`.
- **El estado que la batería no visitaba**: `nefan.aichar = "1"` en `localStorage` —el booleano que
  el chip del HUD deja escrito la primera vez que alguien enciende personajes IA, y que sobrevive a
  la partida, a la pestaña y a la máquina—. Es el toggle al que caen los gates cuando la faceta está
  vacía (`gatesDeImagen`). Resultado: la partida nueva sigue naciendo `vector/vector` y **no pide un
  solo skin**. Era la vía más plausible de «pagar sin querer» que quedaba viva, y está cerrada.
- **El cable**, con dos mensajes que el cliente no manda nunca (comprobado: `main.ts:1268` siempre
  pasa `action.renderMode`, que el tipo `ModoElegido` obliga a traer).
- **«Volver» desde «Crear personaje»** (sonda suelta, no commiteada): elegir Imagen IA + estilo
  `anime` → Continuar → Volver deja `escenarios [vector] · personajes [vector] · estilo
  acuarela_luminosa`. Es #552 (PR 2) y sigue vivo, pero **ahora pierde la elección hacia el modo que
  NO gasta**: para el criterio de esta tanda es la dirección buena (ver H7).
- **Las capturas**, como director de arte: §6.

---

## 3 · Auditoría del censo del banco (lo que más se pidió)

**Veredicto: el censo es correcto y la desviación del plan está justificada. La afirmación
«ningún guion que use `nuevaPartida` cambió de puerta» es VERDADERA.**

Lo verifiqué por dos caminos independientes.

**(a) Estático — declarado contra el modo que tenía cada guion la víspera.** Script propio sobre los
78 ficheros que llaman a `nuevaPartida` (77 guiones + `capturar-portadas.mjs`; el 39 solo la nombra
en prosa), comparando con `git show 5e8acae1:<fichero>`:

| | |
|---|---|
| Declaran `image` | **69** guiones (67 con literal + 59 y 60 por parámetro) + `capturar-portadas` |
| Declaran `vector` | **8** (47, 64, 65, 68, 75, 97, 98, 122) |
| De esos 8, ya pulsaban `vector` a mano | **6** (64, 65, 68, 75, 98, 122) |
| De esos 8, corrían en `image` por omisión | **2: el 47 y el 97** |

La contabilidad del informe cuadra al guion. Lo que **no** cuadra es una frase suya: §5 dice que los
ocho «son exactamente los ocho que ya pulsaban el botón a mano (47, 64, 65, 68, 75, 97, 98 y 122)»
—falso para el 47 y el 97, que no lo pulsaban—, mientras su §4 lo cuenta bien. El hecho material es
inocuo y lo verifiqué leyéndolos: **ninguno de los dos arranca partida** (el 47 nunca pulsa
`#ts-start` y lo dice en su cabecera; el 97 no llama a `comenzar`), así que su puerta del atlas es 0
en cualquier modo. Y el plan de estilo que mide el 97 no recibe el modo (`mostrarPlanDeEstilo(el,
game_id, styleId)`), así que su medida tampoco depende de él.

**(b) Medido — corrida completa con `--censo`** (114 guiones, mi 106 incluido):

| | Ingeniero (113) | Mi corrida (114) |
|---|---|---|
| ejercen la puerta del atlas | 70 | **71** (= 70 + el 106) |
| pagan el atlas | 43 | **44** (= 43 + el 106) |

Y el cruce que de verdad contesta la pregunta:

- **Guiones que declaran `vector` y ejercen la puerta: NINGUNO.**
- **Guiones que declaran `image` y NO ejercen la puerta: NINGUNO.**
- Guiones que ejercen la puerta sin pasar por `nuevaPartida`: solo el 105 y el 106 (los nuevos). El
  12 y el 92 salen a 0, como declara.

Esa doble ausencia es la comprobación fuerte: **lo declarado es exactamente lo que se mide**. Como
los 69 de `image` corrían ya en `image` por omisión, su puerta era la misma antes; los 6 de `vector`
la pulsaban a mano; y los 2 restantes (47, 97) no la ejercen en ningún modo. No hay ningún guion que
cambiara de puerta por `nuevaPartida`.

**La desviación (declarar por PUERTA y no por DINERO) está justificada, y lo comprobé yo mismo.** En
mi corrida, `18-el-titulo-responde-y-vuelve` sale con `puerta=1 · atlas$=0` y
`85-el-eco-del-bridge-no-vuelve-a-pedir-el-modo` con `puerta=1 · atlas$=0`: los dos ejercen la puerta
y no pagan, porque el tile ya lo pintó otro guion antes. Con la fórmula literal del plan (`Δ
/generate_surface_atlas > 0`) los dos se habrían declarado `vector`, el «no ha pagado ni una imagen»
del 18 se habría quedado vacío y el bloque 3 del 85 se habría caído. El contador hermano `ejercicio`
no es adorno: es lo que hace responder a la pregunta.

**Los dos que declara fuera del censo (12 y 92): ninguno afirma nada sobre superficies pintadas.**
Leídos enteros. El 12 recorre pantallas buscando nombres de vistas retiradas y mira el HUD, el panel
«Salidas», el selector de fixtures y el `<title>`; su único aserto cercano al modo es una NEGACIÓN
(«el HUD no lleva indicador de vista»), que no se debilita porque haya menos chips. El 92 mide qué
estilo ofrece el desplegable y qué borrador se rechaza, y lee `sesion().styleId` del cliente, no una
petición de imagen. Los dos siguen verdes.

**Pero el censo de «quién conduce el selector a mano» se quedó corto, y ése sí es un hallazgo (H2):
no son dos guiones, son cinco.**

---

## 4 · Sabotajes (probado en negativo, uno por vez, restaurado por copia con `md5sum`)

| # | Sabotaje | `npm test` | Guion 105 | Guion 106 (mío) |
|---|---|---|---|---|
| S1 | **El séptimo, el que pedías**: devolver el bridge a `msg.renderMode \|\| "image"` dejando `MODO_AL_EMPEZAR` en `vector` | ✖ **rojo** (`bridge-session.test.ts`, 2 casos) | ✔ **verde ENTERO** | ✖ rojo (los dos asertos del cable) |
| S2 | `selectedCharMode: ModoElegido = skinBackendOn ? "image" : "vector"` — **la forma exacta que el código tenía la víspera** | ✔ **verde** en `la-logica-de-juego-no-vuelve-al-cliente` | ✖ rojo (3 asertos) | ✖ rojo (5 asertos) |

**S1** es el séptimo sabotaje que el informe no probó: la pata del defecto que el propio commit llama
«la que decide de verdad» **no la ve el guion 105**, porque el cliente siempre rellena el campo. No es
un agujero —el unit test del bridge la caza y lo verifiqué— pero sí la demostración de que el 105
solo mide dos de las tres patas, y de por qué el bloque del cable del 106 hacía falta en la batería.

**S2** es el hallazgo H1: el candado de arquitectura **no caza** la forma histórica.

Restauración comprobada: `selector-de-mundo.ts` → `885e30065d2ba0b03dc44f097577857d` (el mismo
`md5sum` que reporta el ingeniero), `session.ts` → `0e7ab71d342dd734b69651d4042ffc25`; `git status`
limpio salvo lo que entrego.

---

## 5 · Hallazgos

### H1 · IMPORTANTE — el candado nuevo no caza la forma que el código tenía la víspera, y quien la caza no corre en CI

La regla `la-logica-de-juego-no-vuelve-al-cliente` gana dos tokens:
`(selectedRenderMode|selectedCharMode)\s*:\s*"` y `(selectedRenderMode|selectedCharMode)…=\s*"(image|vector)"`.
El `why` afirma que son «la forma EXACTA que tenían las dos copias del cliente». Para
`selectedCharMode` **no lo son**: su copia era
`let selectedCharMode: "image" | "vector" = skinBackendOn ? "image" : "vector";`, y basta conservar
el tipo nuevo para que el ternario pase:

```ts
let selectedCharMode: ModoElegido = skinBackendOn ? "image" : "vector";   // ← npm test VERDE
```

Medido (S2): `npx tsx --test test/architecture.test.ts` da **98 pass / 1 fail**, y el fail es otra
regla (`qa-guiones-sin-espera-por-reloj`, por un `setTimeout` de un borrador mío que luego quité);
`la-logica-de-juego-no-vuelve-al-cliente` sale ✔. Con ese sabotaje la partida nueva nace en Maqueta 3D
**pagando skins** — exactamente «la mitad que nadie miró» que esta PR presume de haber arreglado.

Quien la caza es la batería (105 y 106, rojos), y `qa/run.mjs` está **fuera** del job
`candados-headless` por decisión escrita en `qa/README.md`. O sea: esa regresión concreta pasaría el
CI entero en verde. Reproducción: aplicar la línea de arriba, `npm run verify` → verde;
`node qa/run.mjs 105` → rojo.

*Lo que esperaba el usuario*: que «el defecto no pueda volver» esté sujeto por algo que falle solo.
Hoy lo está a medias: la mitad de escenarios, sí; la de personajes, solo si alguien corre la batería.

### H2 · IMPORTANTE — cinco guiones conducen el selector a mano, no dos; los cinco cambiaron de modo y nadie lo escribió

El informe (§5) dice: *«Los únicos dos cambios en toda la batería son los dos que ejercían la puerta
sin pasar por `nuevaPartida`»*. Sobre la PUERTA es cierto. Sobre el MODO no: hay **cinco** guiones que
pulsan `#ts-charmode`/`#ts-continue`/`#ts-start` sin pasar por `nuevaPartida`, y ninguno pulsa
`#ts-rendermode`, así que los cinco heredan el defecto y los cinco pasan de `image` a `vector`:

| Guion | Cambia de puerta | Verificado |
|---|---|---|
| `12-una-sola-vista-sin-eleccion` | sí (declarado) | puerta 0 hoy, verde |
| `92-el-estilo-que-ofrece-el-titulo…` | sí (declarado) | puerta 0 hoy, verde |
| `20-el-mundo-vacio-tiene-salida` | **no** — y no está nombrado | puerta 0 (levanta un bridge SIN motor: nunca hay tile) |
| `82-volver-al-titulo-desviste-al-jugador` | **no** — y no está nombrado | puerta 0, pero **sí sigue pidiendo 2 skins**: su sujeto sobrevive porque pulsa `charmode=image` a mano |
| `96-el-fallo-del-repintado-vuelve-a-crear-mundo` | **no** — y no está nombrado | puerta 0 (no llega a jugar) |

Ninguno pierde medida —lo comprobé leyéndolos y en el censo— así que el daño de HOY es cero. Lo que
queda abierto es lo que la propia PR se propone: *«un defecto que cambia no puede cambiar lo que mide
la batería sin que nadie lo escriba»*. El candado nuevo vive en `nuevaPartida`, y estos cinco no
pasan por ahí: **el próximo cambio de `MODO_AL_EMPEZAR` los volverá a mover en silencio**, y esta vez
sin nadie midiendo el antes. Dos de ellos (47, 97) tienen el mismo problema por el otro lado: cambian
de modo y su declaración no lo dice porque el censo mira puertas, no modos.

*Sugerencia (no la aplico)*: el guardarraíl (c) que el propio plan §6 apunta para issues —«un guion
que declara `image` y no dispara `/generate_surface_atlas`»— resuelto al revés serviría aquí: un
aserto del runner de que **todo guion que pulse `#ts-continue` haya declarado su modo**.

### H3 · MENOR — en el modo por defecto nuevo, el HUD anuncia «GENERANDO atlas de superficies» sin generar nada

`dev-status-panel.ts:82` enciende el rótulo destacado
**«GENERANDO atlas de superficies del tile activo…»** con `fpsAtlasController.running`, que es
`PoliticaDeAtlas.enVuelo` — y en maqueta el cliente **sí** hace la petición, con `resolve_only: true`
(`fps-atlas.ts:100`), que no pinta ni cobra. Resultado: las capturas A (maqueta) y B (imagen) del
guion 105 llevan **el mismo rótulo en amarillo**; lo único que las distingue es el registro de abajo
(«sin celdas en la librería (clay…)» contra «23 superficies…») y el chip.

Antes de esta PR una partida nueva nacía en `image` y el rótulo era cierto. Ahora el camino por
defecto de todo jugador nuevo es uno en el que se le dice que está generando superficies cuando
acaba de elegir —o de aceptar— «sin coste». Es el panel de dev y hoy lo ve todo el mundo (está
incondicional en `index.html`), así que lo gradúo menor, pero es un mensaje que asusta justo en la
pantalla donde la tanda se llama «el dinero no miente».

Evidencia: `qa/capturas/2026-09-14T09-27-00-943Z-304128/105-…-01-A-partida-en-maqueta.png`.

### H4 · MENOR (diseño, y es tuyo: reversible) — la asimetría no es con el home, es con las otras DOS puertas

Encender Imagen IA tiene hoy tres puertas y la del selector es la única de un click:

| Puerta | Clicks | Qué dice |
|---|---|---|
| Selector (partida nueva) | **1** | el botón ya lleva «(gasta créditos)» |
| Home, badge del save | 2 | «¿Confirmar? Gastará créditos» (`home.ts:333`) |
| Chip del HUD, en partida | 2 | «¿Confirmar? Gastará créditos» (`graphics-mode.ts:236`) |

El razonamiento escrito («en el selector sí hay un segundo paso que lo confirma») es correcto en que
hacen falta dos actos deliberados, pero **el segundo acto no confirma el gasto**: entre el click y
«Comenzar» hay una pantalla entera («Crear personaje») que no menciona ni el modo ni el coste, y el
botón dice «Comenzar» a secas (`editor-de-personaje.ts:150`). Con H7 encima —volver de esa pantalla
resetea los modos en silencio— el jugador puede llegar a «Comenzar» sin saber en qué modo está.

Mi opinión, con franqueza: **la decisión de un click me parece bien**; lo que no está bien es que el
acto que la cierra sea mudo. Antes de subir el patrón armado al selector (más fricción), sale más
barato y arregla más una línea de resumen en «Crear personaje» al lado de «Comenzar» —«Escenarios:
🎨 Imagen IA (gasta créditos) · Personajes: 🎨 Skins IA»—: convierte el segundo acto en la
confirmación que el razonamiento ya le atribuye, y de paso hace visible la pérdida de H7. No lo
implemento; es tu decisión.

### H5 · MENOR — `doc-routes.ts:57` es la cuarta copia del defecto, hoy inalcanzable pero ya incoherente

`render_mode: narrative.world.render_mode || "image"`. **¿Puede llegar hoy un save con `""`?** No, y
lo verifiqué por el productor, no por la puerta: los dos únicos creadores de sesión materializan el
campo (`handleStartSession` con fail-loud `image|vector`, `game-gen.ts:178` con `"vector"`), y el save
serializa `world: this.world` entero (`narrative-state.ts:1024`), así que ningún save nacido en esta
versión trae `""` ni ausencia. Sólo lo produciría un save anterior al campo — pre-producción, no
cuentan.

Por eso **no es un fallo de esta PR**, pero sí queda un rastro que antes no mentía y ahora sí: hasta
hoy los tres fallbacks decían `image` y coincidían; desde hoy éste es el único que contesta «imagen»
donde el resto del juego ha decidido que la ausencia significa maqueta. Vive dentro de
`nefan-core/bridge/**`, que es exactamente el `files` de la regla que esta PR amplió, y ningún token
lo caza (el grupo de #508 caza `character_mode ||`, no `render_mode ||`). El informe lo reporta y no
lo toca; comparto que no entre aquí, pero que entre en algún sitio.

### H6 · MENOR — la prosa del guion 12 mentía igual que la del 111, y no se barrió

Cabecera del 12: *«Cero créditos: preset 5, y la partida se abre en "Maqueta 3D" (vector), que no
pide una sola imagen»*. Era **falsa** hasta ayer por el mismo motivo que la del 111 y la fila del 101
—que sí se corrigieron—: el guion solo pulsa `#ts-charmode`, nunca `#ts-rendermode`, y el propio
censo del ingeniero lo pilla ejerciendo la puerta del atlas. Con esta PR pasa a ser cierta **por
accidente**, y su verdad depende ahora de un defecto que el guion no declara (H2). Un rastro que
acierta por casualidad envejece igual de mal que uno que miente.

### H7 · INFORMATIVO — #552 sigue vivo y ahora pierde la elección hacia el modo barato

Medido en vivo (sonda propia, no commiteada): elegir «Imagen IA» + estilo `anime` → Continuar →
«← Volver» deja `escenarios [vector] · personajes [vector] · estilo acuarela_luminosa`. Es la PR 2 y
el orden estaba decidido, así que no es un fallo de ésta. Lo anoto porque **cambia de signo**: antes
«Volver» te devolvía al modo que GASTA (era el argumento de §4 de los requisitos para meter #552 en
la tanda) y ahora te devuelve al que no gasta. El criterio 3 ya no depende de #552; lo que queda de
#552 es pérdida silenciosa de una elección, no dinero.

### H8 · MENOR — el instrumento nuevo cubre una puerta de dos

`ejercicio` solo se apunta en `pintar-superficies`. La otra puerta de gasto de una partida —los
skins— se sigue midiendo por DINERO, y hoy eso vale **sólo porque el motor falso no cachea skins**
(`fake-ai-server.ts:803`, `dePago` incondicional). El día que alguien le ponga caché al
`/skin_sprite_sheet` del falso, el censo de skins empezará a mentir exactamente como mentía el del
atlas, y esta vez sin hermano que lo tape. Una línea en el `why` del contador, o su `ejercida(…)`,
lo dejaría cerrado.

---

## 6 · Crítica visual (selector y home)

Material: `qa/capturas/2026-09-14T09-27-00-943Z-304128/122-…-01-selector-en-portatil-1440x900.png`,
`…-03-home-con-la-banda-de-partidas.png`, y las dos del 105.

**Lo que está bien.** El vocabulario es uno solo en las tres pantallas —🎨 Imagen IA / 🧱 Maqueta 3D,
🎨 Skins IA / 🧱 Base y_bot, «(gasta créditos)» / «(sin coste)»—, y eso hace que el badge del home y
el botón del selector se lean como la misma decisión, que es justo lo que son. La columna derecha del
selector ordena bien la jerarquía: estilo → escenarios → personajes → generación, de lo que se ve a
lo que se paga. Y el coste va **en el botón**, no en una nota al pie: el jugador no tiene que ir a
buscarlo.

**Lo que chirría, y ahora chirría más que antes.** El estado activo se comunica **sólo con el color
del borde** (`#da6` contra el gris base). No hay ✓, ni fondo, ni peso tipográfico distinto —y las
tarjetas de mundo, dos columnas a la izquierda, sí llevan su «Mundo ✓»—. Mientras el defecto era
«Imagen IA», eso daba igual: el que no miraba se llevaba lo que el juego quería enseñarle. Con el
defecto nuevo, el que quiere Imagen IA **tiene que darse cuenta de que hay que pulsar**, y lo primero
que su ojo encuentra en la fila es precisamente la opción no elegida (🎨 Imagen IA está a la
izquierda, seleccionado el de la derecha). Un ✓ en el activo, o invertir el fondo, cuesta una línea y
quita toda la ambigüedad.

**Sobre el «un click aquí, dos allí»:** en pantalla no se lee como incoherencia, porque las dos
pantallas no se ven a la vez y el botón del selector lleva su aviso de coste escrito. Lo que sí se
lee raro es el **camino**: eliges «gasta créditos» de un click, pasas por una pantalla que no lo
menciona y pulsas «Comenzar» —un botón neutro— y ahí empieza el gasto. Si algún día alguien reclama
un cobro que no esperaba, será por ese hueco, no por el click. Ver H4.

**Y un detalle que no es de esta PR pero se ve en la misma foto:** los badges de modo del home
parecen etiquetas, no botones (mismo borde fino, sin cursor visible en la captura); que sean el
control de «encender Imagen IA en un save» se aprende sólo por el `title`.

---

## 7 · Workarounds usados

| Qué | Veredicto |
|---|---|
| **Sembrar `localStorage.nefan.aichar = "1"`** para el bloque 2 del guion 106, en vez de encender el chip del HUD a mano | **Declarado, no encubre nada.** Es el mismo valor que escribe `cambiarFaceta` (`modos-de-graficos.ts:236`) por el camino del jugador; lo que me salto es llegar hasta el chip, que hoy está tapado por el registro de errores (#509, el mismo motivo por el que el guion 53 sale ⊘). Si #509 no existiera, el camino entero sería conducible; con él, sembrar la clave es reproducir el estado, no fabricarlo |
| **`start_session` por un WebSocket propio** para el bloque del cable | No es estado sintético: es el mismo gateway, el mismo mensaje del contrato y el mismo bridge; sólo el emisor es otro cliente, que es un caso real (el guion 85 usa la misma técnica). El cliente del juego no puede producir ese mensaje, y ése es justamente el punto |
| Ninguno más | **No hubo que ocultar, forzar ni stubear nada** para ver la feature: el camino del jugador llega entero desde `./start.sh` |

## 8 · No probado

- **Gasto real de créditos** (motor falso por mandato): se afirma la PUERTA y el SAVE, no el cargo.
- **`CONFIG.graphics.ai_skin = false`**: no lo ejercí. Por lectura, `skinBackendOn ? MODO_AL_EMPEZAR
  : "vector"` cae a `vector` en los dos casos y el botón de skins IA nace deshabilitado, así que el
  criterio no puede romperse por ahí; pero no lo he visto correr.
- **El `|| "image"` de `doc-routes.ts` en vivo**: no hay productor de `render_mode: ""` (§H5), y
  fabricarlo exigía editar un save a mano — un estado que hoy no existe, o sea, medir otra cosa.
- **PR 2 (#552) y PR 3 (el importe)**: fuera de alcance de esta validación.
- **Reproducir la corrida «antes» del censo**: no revertí el producto para medirla. La verifiqué por
  los dos caminos de §3, que no la necesitan.

## 9 · Qué entrego

- `qa/guiones/106-las-cuatro-puertas-y-el-cable-de-una-partida-nueva.mjs` — las cuatro
  combinaciones, el toggle heredado y el cable. Probado en negativo con S1 y S2 (§4).
- La fila del 106 en `qa/README.md` y el recuento de guiones (113 → 114).
- Este documento.

**Veredicto: APTO CON HALLAZGOS.** Ninguno bloquea la PR. H1 y H2 deberían volver al ingeniero antes
de cerrar la tanda —los dos son «el candado no llega hasta donde dice el texto»—; H3 a H8 son
material de issue.
