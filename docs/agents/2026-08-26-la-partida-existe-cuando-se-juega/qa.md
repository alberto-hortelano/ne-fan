# QA — Una partida existe en disco cuando se ha llegado a jugar (#279 + #270)

Rama `fix/la-partida-existe-cuando-se-juega`, commit `7cb0683`. Validado contra la petición
LITERAL de `requisitos.md` y los cinco criterios, desde el arranque y por el camino del jugador.

**Veredicto: apto con reservas.** Los cinco criterios se cumplen y están medidos en el flujo real;
lo que reservo no es el producto sino el candado: el guion 27 —que el commit presenta como «la
mitad del valor» de la tanda— puede salir ENTERO EN VERDE sin medir la conjunción, porque depende
de una precondición que ni afirma ni registra. Está demostrado abajo (H1), es barato de cerrar, y
mientras tanto lo cubre el guion nuevo.

Entrego además `qa/guiones/29-la-partida-existe-cuando-el-jugador-entra.mjs` (con su fila en
`qa/README.md`). **No he tocado producción**: todas las roturas de las pruebas en negativo se
revirtieron y `git status` solo enseña esos dos ficheros.

---

## Lo que se corrió

| Comando | Resultado |
|---|---|
| `node qa/run.mjs` (antes de añadir nada) | **26/27** — solo `15-guardia-se-ve-y-se-comporta` en rojo |
| `node qa/run.mjs` (con el guion 29) | **27/28** — mismo único rojo |
| `node qa/run.mjs 29` (×3, una por cada versión del guion) | verde |
| `npm run verify` (nefan-core) | `tests 1472 · pass 1472 · fail 0` |
| `node --import tsx --test test/architecture.test.ts` (con el guion 29 ya en `qa/guiones/`) | `pass 39 · fail 0` |
| `git switch --detach 361e72a` + `node qa/run.mjs 15` | **rojo idéntico** (ver H0) |
| Cinco roturas a mano + su corrida (N1…N5) | detalladas abajo |

Todo con el preset `e2e-sin-creditos` que levanta `qa/run.mjs`: **cero créditos**, el motor es el
fake-ai-server (`gasto sesión 0,00 € · total 0,00 €` en la barra de dev de las capturas).

---

## Criterios de aceptación

| # | Criterio (de `requisitos.md`) | | Evidencia |
|---|---|---|---|
| **C1** | Clon limpio sin hojas: el arranque falla, **cero directorios nuevos** en `saves/` y «Continuar» no ofrece nada | ✅ | **Dos órdenes distintos, los dos verdes.** `27`, con el 404 retardado: `saves después: 1 · nuevos: []` · `«Continuar» ofrece: ["1787742324-e03968"]` (solo la de antes). `29` bloque 1, con el 404 **al instante** (el clon limpio real): `saves después: 0 · nuevos: []`, `acks «session_entered» mandados: []`, y la captura `29-…-01-clon-limpio-404-instantaneo.png` enseña el título con «Bridge OK — 0 partidas guardadas» y «— Ninguna partida todavía —». **En negativo (N1)**: sin la guarda de existencia de `save()`, los dos guiones se ponen rojos nombrando el save huérfano |
| **C2** | Una partida que arranca bien se guarda como siempre: al reanudarla vuelven posición, vida, mundo y entidades | ✅ | Guion `17` entero, verde: `el state.json de disco lleva la posición VIVA del jugador` · `…y su vida` · `reanudar deja al jugador DONDE ESTABA, no en el origen` · `…ni en el __player_start de la escena: se PERSISTIÓ` · el lugar, el enlace, el trigger, el inventario, el NPC con su directiva, las refs de escena y el slice del plugin sobreviven al resume; la tarjeta del save dice `9 escenas · 1 entidades`. Guion `29` bloque 2: `un arranque que sale bien manda el ack EXACTAMENTE una vez` con el id de esa partida, y con eso existe en disco. **En negativo (N4)**: si el cliente deja de mandar el ack, el `17` se pone rojo con el diagnóstico exacto (abajo) |
| **C3** | Motor caído (#189): tampoco queda una partida en la lista | ✅ | Guion `20` (bridge propio, sin motor, disco propio): `saves del bridge sin motor: []`. **En negativo (N3)**: colgando el ack solo del vestido, ese aserto se pone rojo — `saves del bridge sin motor: ["1787742934-80465f"]` |
| **C4** | Reanudar sigue guardando sin depender de nada nuevo | ✅ | Guion `17`, después del resume: `6 LECTURAS seguidas del motor no reescriben el save` · `…pero UNA escritura sí lo reescribe (el aserto de arriba no es un verde vacío)`. En el núcleo, `loadSession()` deja la partida en `en_disco` sin ack, y su unitario lo afirma (`reanudar NO necesita ack: la partida ya existe y sigue guardando`) |
| **C5** | Con la partida aún provisional, la tecla `H` no puede dejar la sesión viva sin plugins | ✅ | Guion `29` bloque 3, **en vivo y en la ventana provisional de verdad** (`ventana provisional: {"tiles":["tile_0_0"],"sessionId":"…","titulo":true}` y la partida todavía sin disco): `sistemas de juego activos antes de la tecla H: ["economy"]` → se pulsa `H` → `después de la tecla H: ["economy"]`, leído del catálogo que el bridge le ofrece al motor (`GET /plugins`, o sea `ctx.activePlugins`), no del save. Y la partida termina de arrancar y se escribe igual, con los plugins intactos. **Reserva cosmética**: ver H3 — en esa variante el libro se abre con **0 píxeles** |

---

## A · ¿Se ha perdido cobertura al arreglar el guion 27?

**Sí, y estaba perdida del todo hasta este informe: la repongo con el guion 29 (bloque 1).** El
orden ORIGINAL —el 404 instantáneo, que es el del clon limpio de verdad y el que da nombre al
issue— **no lo recorría ningún guion** después del cambio.

Lo primero, lo que importa para quien juega: **el caso real funciona**. Medido, no deducido:

```
▶ 29-la-partida-existe-cuando-el-jugador-entra
    desenlace del clon limpio: {"aviso":"No se pudo empezar la partida. Faltan las hojas…"}
    tras volver al título: tiles en el mundo = ["tile_0_0"] · sesión aplicada = ""
    acks «session_entered» mandados: []
    saves después: 0 · nuevos: []
```

El volcado confirma además la medida del ingeniero: con el 404 instantáneo el tile llega **después**
de abandonar la partida (`tiles=["tile_0_0"]` con `sesión aplicada=""`).

Lo segundo, la sensibilidad. Rompí la conjunción a mano (**N2**: `entrada.ts`, `comprobar()` deja de
mirar `hayVestido`) y corrí los dos guiones:

```
▶ 27-el-clon-limpio-quiere-jugar          (404 retardado, el orden construido)
    ✘ un arranque que falla no deja NINGÚN directorio nuevo en saves/ — aparecieron ["1787742853-c6d8b2"]
    ✘ …y «Continuar» no ofrece ninguna partida que no se llegó a jugar

▶ 29-… bloque 1                            (404 instantáneo, el orden real)
    ✔ …y no deja NINGÚN directorio nuevo en saves/     ← VERDE: el orden real es insensible
▶ 29-… bloque 3                            (la ventana provisional, sin ningún fallo)
    ✘ con el mundo pintado y el jugador sin vestir, la partida TODAVÍA no existe en disco
```

O sea: **el ingeniero tiene razón en el diagnóstico y en el arreglo** — el orden real no puede
detectar una conjunción rota, porque allí lo que impide el save es el reset de la faceta. Pero de
ahí no se sigue que el orden real deje de importar: es el estado del jugador que abre el issue, y
un guion que solo recorre el construido no vuelve a visitarlo nunca. Ahora lo visita el 29, que
además **no necesita un fallo** para medir la conjunción: el bloque 3 la caza con un arranque que
sale bien, solo con las hojas tardando.

Queda un residuo de esa sustitución, y es H2: tres textos siguen citando el orden construido como
si fuera el natural.

---

## B · Los cinco criterios en el flujo real

En la tabla de arriba, con su evidencia. Dos notas sobre los dos que pediste con lupa:

**C2.** El riesgo que señalabas es real y ahora tiene canario. Rompí el cliente para que **dejara de
mandar el ack** (`main.ts`, se comenta `narrativeClient.sessionEntered(sessionId)`) y corrí el 17:

```
▶ 17-la-partida-se-guarda-y-se-reanuda
    ✘ ERROR: la partida 1787742958-252b3e no llegó a existir en 180s (hay: [] · disco (…/saves)).
      El cliente no mandó el ack «session_entered», o el bridge no lo aceptó.
```

Es la tercera condición que #270 le puso a `comenzar()`, y la comparten los 14 guiones que arrancan
una partida: un cliente que se olvide del ack no puede pasar desapercibido, y el mensaje dice dónde
mirar. Con el ack puesto, el 17 valida las cuatro cosas del criterio una a una (posición, vida,
mundo y entidades) y las once escrituras del motor llegan al disco como antes.

**C5.** Verificado en vivo, no solo en unitario: abrí la ventana provisional reteniendo las hojas del
personaje (el mundo se pinta, el jugador no se viste, el título sigue delante), comprobé que la
partida **no** está en disco en ese instante, pulsé `H` por el camino del jugador y leí
`GET /plugins` antes y después: `["economy"]` → `["economy"]`. Después solté las hojas y la partida
terminó de arrancar y se escribió, con los plugins intactos. La mitad que NO se ve está en H3.

---

## C · La regla del workaround, y si los asertos nuevos pueden ponerse rojos

### Los asertos nuevos, uno a uno (no me fío, los rompí)

| Rotura (a mano, revertida) | 17 | 20 | 27 | 29 |
|---|---|---|---|---|
| **N1** · `save()` sin la guarda `existencia !== "en_disco"` | — | **verde** (¹) | **✘ ✘** `nuevos: ["1787742641-3dd584"]` | **✘** bloques 1 y 3 |
| **N2** · el ack solo con `mundoPintado()` | — | — | **✘ ✘** | **✘** bloque 3 (bloque 1 verde) |
| **N3** · el ack solo con `vestido()` | — | **✘** `["1787742934-80465f"]` | — | — |
| **N4** · el cliente deja de mandar el ack | **✘** (mensaje de arriba) | — | — | **✘** bloque 2 |
| **N5** · N2 **+** el cortafuegos del 27 a 1 ms | — | — | **verde entero** ← H1 | — |

(¹) El aserto nuevo del guion 20 **no** es sensible a N1, y está bien que no lo sea: sin motor no se
llama a `save()` en ningún sitio, así que la guarda no tiene nada que guardar ahí. Su mitad de la
conjunción es la otra, y N3 lo demuestra. Lo anoto porque el informe de implementación deja
entender que los cuatro asertos nuevos cuelgan del mismo candado, y no es así: **cada mitad tiene
su guion y solo el suyo**.

### Workarounds usados durante la prueba, con su veredicto

| Qué hice | Veredicto |
|---|---|
| Contestar 404 a `**/sprites/**` (bloque 1 del 29, igual que el 27) | **No es workaround.** `public/sprites/` está gitignorado: es literalmente el estado de quien clona el repo, producido en el BORDE y sin tocar nada del juego |
| **RETENER** las peticiones de hojas hasta que el guion termina su bloque (bloque 3 del 29) | **Es un estado construido, y lo declaro.** No oculta nada ni fuerza estado interno: abre —sin fallo ninguno— la misma ventana que abre cualquier máquina donde las diez hojas tarden más que un round-trip. La ventana existe para el jugador (con motor lento dura minutos), y el guion falla LOUD si no llega a producirse (el `waitFor` de la ventana revienta), que es justo lo que el 27 no hace (H1) |
| Envolver `WebSocket.prototype.send` para contar frames `session_entered` | **No es workaround**: observa, no altera. El frame se reenvía tal cual |
| Matar dos stacks huérfanos de mis propias corridas | **Herramienta, no producto** — pero cuesta una corrida a quien venga detrás: H6 |
| `git switch --detach 361e72a` para re-medir el guion 15 | Declarado; el árbol volvió a `7cb0683` y `git status` está limpio |

**Ningún workaround hizo falta para observar la feature.** Los cinco criterios se ven por el camino
del jugador: título → mundo → Comenzar, y `saves/` mirado desde fuera.

---

## Hallazgos

### H0 · El rojo del guion 15 es PREVIO — verificado por mi cuenta (no es hallazgo, es descargo)

No me fié de la medida con `git stash`: hice `git switch --detach 361e72a` y corrí el guion sobre la
base de la rama.

```
base 361e72a : mercader: distancia al punto de la pelea 9.22 → 9.95 m   ✘
tanda 7cb0683: mercader: distancia al punto de la pelea 9.22 → 9.93 m   ✘
```

Idéntico, y el aserto pide `> 10.22`. Importaba comprobarlo porque #270 cambió `comenzar()` y podría
haber movido los tiempos del guion 15; no los mueve. **Merece issue propio** con el diagnóstico del
ingeniero (la banda de `situarse(…, 8, 1.5)` sale por el extremo alto y el mercader huye contra la
pared de la taberna).

### H1 · IMPORTANTE — el guion 27 puede salir ENTERO EN VERDE sin medir la conjunción

**Qué pasa.** El arreglo del 27 hace que el 404 espere a que el mundo esté pintado:

```js
await ctx
  .waitFor("el mundo llega antes que el fallo de las hojas", () => window.__nefan?.tiles.length > 0, 60_000)
  .catch(() => null);
await route.fulfill({ status: 404, … });
```

Si esa espera se agota, el `.catch(() => null)` se la traga, el 404 sale igual y el guion sigue —
midiendo el orden débil, **sin un aserto ni un `ctx.log` que diga que su precondición no se
cumplió**. Toda su sensibilidad nueva cuelga de una condición que no afirma.

**Reproducción (medida, no razonada).** Con la conjunción rota (N2) y el cortafuegos puesto a 1 ms
para simular «el mundo no llegó a tiempo»:

```
▶ 27-el-clon-limpio-quiere-jugar
    ✔ sin hojas, «Comenzar» no deja al jugador colgado…
    saves después: 0 · nuevos: []
    ✔ un arranque que falla no deja NINGÚN directorio nuevo en saves/
    «Continuar» ofrece: []
    ✔ …y «Continuar» no ofrece ninguna partida que no se llegó a jugar
1/1 guiones en verde
```

Verde entero, con el candado roto. Basta un bridge lento, un motor caído o un tile que tarde más de
60 s para que el guion deje de comprobar lo que su cabecera dice que comprueba, y nadie se entere.

**Qué esperaba quien lo lee**: que un guion verde signifique lo que dice. Es la enfermedad que este
repo lleva una semana pagando, en el fichero que la tanda presenta como su arreglo.

**Coste de cerrarlo**: dos líneas — registrar si la espera se cumplió y afirmarlo (`ctx.expect("el
mundo estaba pintado cuando falló el vestido", …)`), de modo que el guion se ponga rojo por su
precondición en vez de mentir por omisión. No lo hago yo: reporto.

### H2 · IMPORTANTE — tres textos load-bearing citan como natural un orden que hoy se CONSTRUYE

`src/session/entrada.ts` (cabecera), `test/entrada.test.ts` (cabecera) y
`data/contract/mutation-targets.json` → `entrada-en-la-partida.porque` dicen, los tres, alguna
variante de:

> «el tile del bridge llega ANTES de que se resuelva la apariencia — está medido y escrito en
> `qa/guiones/27-el-clon-limpio-quiere-jugar.mjs`»

Después de esta tanda eso solo es cierto **porque el guion 27 lo arregla a propósito**: en el clon
limpio real, medido arriba, el tile llega DESPUÉS. El `porque` de un objetivo de mutación con
`break: 100` y la justificación de la conjunción no deberían apoyarse en una cita que el propio
commit desmiente en su cuerpo. La conjunción sigue siendo load-bearing (el bloque 3 del guion 29 la
caza sin ningún fallo de por medio) — lo que hay que corregir es **a qué estado apunta la cita**.

### H3 · MENOR — la tecla `H` durante la ventana provisional es un no-op para quien juega

Medido en el bloque 3 del guion 29:

```
libro con la partida aún provisional: {"texto":"La partida aún no ha empezado: el libro se llena cuando el mundo está en pantalla.","error":true}
…y lo que el JUGADOR ve de él: {"libroPx":0,"gameUiPx":0,"tituloDelante":true}
```

El libro se abre y el mensaje amable está en el DOM, pero `#game-ui` mide **cero** mientras el título
está delante (#246), así que no se ve nada — la captura
`29-…-02-libro-durante-la-ventana-provisional.png` enseña la pantalla «Crear personaje», no el libro.
El mensaje solo lo lee quien llega a la OTRA variante de la ventana (vestido y sin mundo, #189),
donde el título ya se fue. **No es una regresión de la tanda** y la mitad que importaba —que el
resume fallido no desarme la sesión— está arreglada y medida. Queda como `ctx.log` en el guion,
hallazgo abierto, igual que nació el del guion 24.

Reproducción: arrancar una partida con las hojas del personaje lentas, pulsar `H` mientras el mundo
ya se ve detrás del título. El jugador espera algún acuse de recibo de la tecla; no hay ninguno.

### H4 · MENOR — «entra en ella» se le dice a alguien que ya está dentro (LEÍDO, no ejercido)

`handleSetRenderMode` sobre la partida activa contesta ahora
`la partida {id} aún no ha empezado: entra en ella y vuelve a cambiar el modo` cuando `save()`
devuelve `escrito: false`. Ese estado es alcanzable: con un motor lento, `unIntentoDeArrancar` no
espera al tile, así que el título ya se fue y el jugador está dentro mirando el loader cuando toca
el chip de gráficos — el chip revierte y solo deja una entrada en el registro de errores
(`graphics-mode.ts:210`). Decirle «entra en ella» a quien ya entró es la misma familia de mensaje
que #277 vino a quitar («inténtalo de nuevo»).

**Declarado como lectura de código: no lo ejercí en vivo.** Cerrarlo pide una frase que hable de lo
que el jugador ve («el mundo todavía no ha llegado»), no del estado interno.

### H5 · MENOR y PREVIO — el tile fantasma del arranque que falló

Medido en el bloque 1 del guion 29: `tiles en el mundo = ["tile_0_0"] · sesión aplicada = ""`. Con el
404 instantáneo, `abandonarLaPartida()` (que hace `resetWorld()`) corre ANTES de que llegue el tile,
así que el tile de una sesión muerta se pinta detrás del título — se ve en la captura, esas cajas
tenues bajo «Partidas guardadas». Para `new_game`, `unIntentoDeArrancar` no vuelve a llamar a
`resetWorld()`, así que el siguiente intento arranca sobre él. **Es previo a la tanda** (el orden que
lo produce no lo cambió nadie), pero lo anoto porque es justo el estado que el guion 27 dejó de
visitar al arreglarse.

### H6 · MENOR — herramienta: `qa/run.mjs` deja el stack arriba si muere por excepción, y el siguiente lo hereda roto

Me pasó dos veces durante esta validación. Cuando el runner muere por una promesa sin recoger (me lo
provocó mi propio guion con un `route.continue()` sobre una ruta ya resuelta), `salir()` no corre:
**el tmp efímero sí se borra pero el stack queda vivo**. La corrida siguiente lo detecta como «stack
ya arriba — no lo toco», arranca contra él… y su `NEFAN_GAMES_DIR` apunta a un directorio que ya no
existe, así que TODOS los guiones fallan con `page.waitForSelector: Timeout 30000ms exceeded` sin
decir por qué. Repro exacto: hacer que un guion suelte una promesa rechazada, y lanzar otra corrida.

Endurecí mi guion para que no lo cause (`route.continue().catch(() => null)`, con el motivo escrito),
pero el peligro es del runner: le vendría bien comprobar que el stack heredado sigue sirviendo su
disco antes de dárselo a los guiones. **Merece issue propio; no es de esta tanda.**

### H7 · MENOR y DECLARADO — los saves vacíos que ya están en disco no se podan nunca más

Se retiró la poda de `handleListSessions` y no hay migración (pre-producción). Quien tenga hoy saves
huérfanos de los arranques fallidos de ayer los verá en «Continuar» para siempre hasta que los borre
a mano. Está decidido a propósito, está en el commit y no lo discuto: lo dejo escrito porque es lo
único de la tanda que **empeora** para un usuario existente, y conviene que salga en las notas de la
PR y no solo en el cuerpo del commit.

---

## Crítica visual

Poco que juzgar: la tanda no pinta nada nuevo. Lo que sí se ve, en las dos capturas:

- **El título después del arranque fallido** (`29-…-01`): la promesa del issue, cumplida y legible —
  «Bridge OK — 0 partidas guardadas.» y «— Ninguna partida todavía —» en cursiva atenuada. El aviso
  en salmón sobre casi negro se lee bien y ocupa dos líneas sin empujar el botón. Ninguna tarjeta
  fantasma, que era todo el punto.
- **Dos cosas que no son de esta tanda pero se ven en la misma foto**: el tile fantasma detrás (H5),
  y el botón «✕ Cerrar (modo fixtures, sin sesión)» de la esquina superior derecha, **cortado por la
  barra de dev** y prácticamente ilegible. Lo segundo es cosmético y previo; lo anoto porque es lo
  primero que se le ve a la pantalla en cuanto se mira como jugador y no como checklist.

---

## No probado

- **Takeover durante la ventana provisional** (una segunda pestaña, o `generate_game`, entre el
  arranque y el ack). Hay unitario y `console.warn`, pero no lo ejercí: pide dos pestañas contra el
  mismo bridge. Es el hueco donde una partida podría no escribirse NUNCA con el jugador dentro.
- **El motor narrativo real (MCP) y el gasto de créditos**: todo se midió con el fake-ai-server. El
  repago del bootstrap interrumpido —el coste que el usuario aceptó— no se puede medir aquí y no lo
  declaro cumplido ni incumplido: es una funcionalidad retirada a propósito, no un fallo.
- **`labs/narrative/game-emulator.mjs`**, que no manda el ack: queda escrito en su README, no
  ejercido.
- **H4 en vivo** (el chip de gráficos durante la ventana provisional): leído en el código, no
  reproducido.
- **La mitad visible de C5** (pulsar `H` con el título ya fuera, variante #189): el mensaje amable
  se leyó en el DOM, no en pantalla.
- **La mutación de `entrada-en-la-partida`**: pendiente de autorización, como declara el ingeniero.
  No es mío medirla y no la sustituyo por parecido — lo que sí sustituye a una medida es que las
  cuatro roturas de arriba salieron rojas donde tenían que salir.

---

## Veredicto

**Apto con reservas.**

Los cinco criterios se cumplen y están medidos en el flujo real, desde el título y sin un solo
workaround para poder verlos; el producto hace lo que el usuario pidió, en los dos órdenes en que el
clon limpio puede fallar, con el motor caído, al reanudar y con la tecla `H` de por medio.

La reserva es **H1**: el guion que la tanda presenta como su arreglo puede salir entero en verde sin
comprobar nada, y está demostrado. Con H1 cerrado (dos líneas) y H2 corregido (tres cabeceras
apuntando al estado que de verdad mide la conjunción), esto es apto a secas.

---

### Ficheros que dejo (sin commitear)

- `docs/agents/2026-08-26-la-partida-existe-cuando-se-juega/qa.md` — este informe.
- `qa/guiones/29-la-partida-existe-cuando-el-jugador-entra.mjs` — el guion nuevo (verde; probado en
  negativo con N1, N2 y N4).
- `qa/README.md` — su fila en la tabla de guiones sembrados.
