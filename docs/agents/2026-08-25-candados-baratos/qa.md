# QA — Los dos candados baratos (#248 · #231a)

Validado sobre el worktree `scratchpad/wt-candados`, rama `tooling/candados-baratos`
(HEAD `142b544`, que es el head de la **PR #265**). Contra `requisitos.md` y su
criterio de terminado, no contra el informe del ingeniero.

**Todo lo que sigue lo ejecuté yo.** Donde reproduzco una afirmación del ingeniero,
la reproduje desde cero (sabotaje puesto por mí, revertido por mí, árbol limpio
comprobado con `git status` después de cada vuelta). El árbol quedó **sin un solo
cambio de código**: lo único que añado es el guion nuevo y su fila en `qa/README.md`.


> **Nota de rebase (ingeniero)**: el guion nació como `22-…` y se renumeró a **`24-…`** al
> rebasar sobre `main`, que ya traía sus propios `22-telegraph-ensena-el-borde` y
> `23-telegraph-los-cinco-ataques-y-todo-suelo` (#263). Solo cambia el número; el contenido es el
> que QA escribió, más el aserto de la etiqueta que este informe dejaba pedido.

---

## Criterios

| Criterio (de `requisitos.md`) | | Evidencia |
|---|---|---|
| **C1** · `no-floating-promises` activa en `nefan-html`, **de golpe** (2 violaciones, sin `max` ni baseline) | ✅ | `nefan-html/eslint.config.js`: bloque con `files: ["src/**/*.ts"]`, `projectService`, **una** regla en `error`. `npx eslint .` sobre el árbol limpio → `LINT OK`, cero violaciones toleradas. Los 39 ficheros de `nefan-html/src` son `.ts`: el bloque los cubre todos |
| **C2** · Se ve **ROJO** ante una promesa suelta nueva | ✅ | Fichero temporal `src/__qa-candado.ts` con `trabajo();` → `eslint` `✖ 1 problem … no-floating-promises`, `LINT_EXIT=1` |
| **C3** · La complementariedad, probada **en las dos direcciones** | ✅ | A esa misma promesa se le pone `void trabajo();` → `npx eslint .` **`LINT_EXIT=0`** y `npx tsx --test test/architecture.test.ts` **`✖ [deuda] html-sin-promesa-muda (max 8)`, `pass 36 / fail 1`**. Borrado el temporal: `LINT OK` y `pass 37 / fail 0` |
| **C4** · El `why` de `html-sin-promesa-muda` deja de mentir: dice que NFP es complementaria y **cuáles son los dos puntos ciegos que sobreviven a las dos** | ✅ | El `why` lo dice, y **los dos puntos ciegos son reales, medidos**: fichero temporal con `void trabajo(); // comentario` y `const c = (): void => void trabajo()` → `eslint` `LINT_EXIT=0` **y** `architecture.test.ts` `✔ html-sin-promesa-muda (max 8)`, `pass 37 / fail 0`. Escapan a las dos, tal como está escrito. El regex del candado (`\bvoid\s+…[;,]\s*$`) explica por qué |
| **C5** · Tipos de `scripts/` en un tsconfig **aparte** con `noEmit`, sin ampliar el `include` del de build | ✅ | `nefan-core/tsconfig.scripts.json`: `noEmit: true`, sin `composite`/`declaration`/`rootDir`, resto de opciones **idénticas** al `tsconfig.json` de build (`target`, `module`, `moduleResolution`, `strict`, `esModuleInterop`, `skipLibCheck`, `resolveJsonModule`) — mismo rasero, verificado clave a clave. `include: ["scripts/**/*.ts"]` cubre los **8** ficheros de `scripts/`, que son todos `.ts` |
| **C6** · El candado de tipos se ve **ROJO** con el error de #229 | ✅ | Devuelto `unaLinea(v.detail ?? r.rule.message)` a `scripts/deuda.ts:135` → `npm run typecheck:scripts` → `error TS2339: Property 'message' does not exist on type '{ id: string; files: string[]; … }'`, `EXIT=2`. Revertido → `EXIT=0` |
| **C7** · …y el contraste: **los otros cinco gates siguen verdes con ese error dentro** | ✅ | Con el sabotaje puesto: `tsc --noEmit EXIT=0` · `build EXIT=0` · `lint EXIT=0` · `test EXIT=0` (`pass 1337 / fail 0`) · `deuda EXIT=0`. **Los cinco.** Es toda la justificación del gate nuevo y se sostiene |
| **C8** · El gate nuevo corre en CI y en `verify`, sin apagarse | ✅ | `package.json`: `verify` = `build && typecheck:scripts && lint && test`. En el runner, job `nefan-core` del SHA `142b544`: paso **7 `npm run typecheck:scripts` → success** (pasos leídos de la API, no del informe). Cuatro jobs `success` en ese mismo SHA. Ni `continue-on-error`, ni `\|\| true`, ni `if: false` en el workflow |
| **C9** · Ampliar el `include` de build habría roto `narrative-mcp`; con el tsconfig aparte, no | ✅ | `cd narrative-mcp && npm run build` (`tsc -b` con project reference) → `EXIT=0`, y **`nefan-core/dist/scripts/` no existe**: `noEmit` cumple lo que promete |
| **C10** · `test/` NO entra y **#231 no se cierra** | ✅ | El tsconfig nuevo no incluye `test/`. `gh api`: issue **#231 `open`**. El cuerpo de la PR #265 dice literalmente `Closes #248. Partially addresses #231.` — al mergear se cerrará #248 y **no** #231. #260 sigue `open` |
| **C11** · Se va el testigo: el bucle muerto de `service-registry.test.ts` | ✅ | Borrado, con el motivo escrito en su sitio. Verificado que era muerto de verdad: `extractionPhase` aparece **una sola vez** como valor en `src/contracts/service-registry.ts` (línea 42, `world-state: "F6"`); ni `asset-store` ni `remote-gen` lo declaran, así que la guarda era siempre falsa. `npm test` sigue en `1337 pass` |
| **C12** · Freno explícito: sin `as any`, sin baseline de errores tolerados, sin umbrales tocados | ✅ | El diff `main...HEAD` no añade ni un `as any`, ni un `@ts-ignore`/`@ts-expect-error`/`eslint-disable`. `quality-thresholds.json` y `mutation-targets.json` **intactos** (no aparecen en el diff). En `arch-rules.json` **ningún `max` cambia** — solo el texto del `why` |
| **C13** · El bug vivo arreglado: si el módulo de una fixture del selector «Room» falla, **se entera quien lo está usando** | ✅ | Guion nuevo `qa/guiones/24-el-selector-de-fixtures-no-se-calla.mjs`, corrido contra el stack real de `qa/run.mjs`: `registro: [scene] no se pudo cargar la fixture ../nefan-core/data/scenes/zorder_test.json` · `línea del juego: ⚠ no se pudo cargar la escena …/zorder_test.json`. Cinco asertos en verde, captura en `qa/capturas/` |
| **C14** · …y que **antes no dejaba nada** | ✅ | **Contraprueba mía**, con el mismo guion y el mismo stack, devolviendo `loadSceneFile(value);` a su sitio: `✘ entradas 11 → 11` (ninguna nueva) · `✘ líneas: ["Atlas fps de tile_0_0: …","Scene loaded: tile_0_0"]` — el mundo **sigue en la escena anterior** mientras el `<select>` muestra la nueva. Restaurado, verde otra vez |
| **C15** · La entrada nueva de pointer lock no rompe los guiones `18`, `19` y `21` | ✅ | `node qa/run.mjs` completo: **los tres en verde y sus tres asertos del registro también** (`fuente === "session"`, `includes("title")`, `/y_bot/`). Los tres buscan una entrada CONCRETA, nunca la ausencia — verificado leyendo el código Y ejecutándolo |
| **C16** · Ningún otro guion se rompe por la tanda | ⚠️ | La corrida dio **13/21**, pero **ningún rojo es atribuible**: ningún guion clica el lienzo (la línea de pointer lock es código muerto para la batería), **ocho de los diez guiones que usan el selector están en verde**, y los ocho rojos se reparten entre esperas largas con la máquina a load 20–27, una firma común de `title-screen` que es del arnés, y un `public/sprites` que no existe en el worktree. Detalle en «La corrida». **No pude repetir la corrida**: otro agente tomó los puertos estándar |
| **C17** · El rechazo real de `requestPointerLock()` | ⚠️ | No probado: ver «No probado» |

---

## La corrida de `qa/run.mjs`

El ingeniero no la corrió (se le prohibió) y dejó una revisión a mano: los guiones `18`, `19` y
`21` buscan una entrada CONCRETA del registro de errores, nunca la ausencia de entradas, así que
la entrada nueva de pointer lock no debería romperlos. **La corrí. Su revisión es correcta y
está confirmada en ejecución**, no por lectura:

```
✔ 18-el-titulo-responde-y-vuelve      ✔ …queda registrado en el log de errores con la fuente `session`
✔ 19-el-titulo-arranca-de-verdad      ✔ …queda registrado en el log de errores con la fuente `title`
✔ 21-sin-generar-sprites…             ✔ el juego DICE por qué los personajes van en maniquí, y nombra a y_bot
```

Los tres verdes, y sus tres asertos del registro también. **Confirmado, no tumbado.**

La corrida completa dio **13/21**. Los ocho rojos **no son de esta tanda**, y esto no es una
conjetura: el mecanismo está cerrado por medida.

| Guion | Rojo por | ¿Puede ser de la tanda? |
|---|---|---|
| `05`, `10`, `17` | Timeouts de esperas LARGAS: caminar hasta la frontera (120 s), el muro de niebla, y la escena tras reanudar (180 s) | No: ninguno pasa por los dos handlers que toca el diff |
| `08`, `09`, `15`, `20` | La misma firma exacta: `page.click … <div id="title-screen"> intercepts pointer events` | No: es el desfase entre `comenzar()` y `titleScreen.hide()` (hallazgo 6) |
| `13` | Las 10 hojas de `y_bot` responden `<!DOCTYPE` — `nefan-html/public/sprites/` no existe en el worktree (hallazgo 5) | No: es el disco, no el código |

**El mecanismo, medido y no razonado.** El diff toca DOS handlers del cliente y nada más:

- **El `click` del lienzo** (pointer lock): `grep` sobre los 21 guiones y `qa/lib/` → **ningún
  guion clica el lienzo** (el único acierto es una frase en un comentario del `10`). Esa línea
  es código muerto para la batería: no puede tumbar nada.
- **El `change` del selector «Room»**: lo usan **diez** guiones (`01 02 03 06 07 10 12 15 16 22`).
  **Ocho de ellos están en VERDE**, incluidos los cuatro que solo hacen eso. Los dos que caen
  (`10`, `15`) cargan su fixture sin problema —sus primeros quince asertos son verdes— y mueren
  mucho después, en un paseo y en un click de viaje. Además, en el camino feliz `paso(p, …)` es
  idéntico a `p;`: adjunta un `.catch` y vuelve, sin `await` ni cambio de tiempos.

**Y el contexto en el que hay que leerlos**: durante la corrida la máquina estuvo a **load
average 20 → 27** (medido tres veces), con un Chrome headless AJENO llevando 2 h 47 min al 377 %
de CPU. Con el `delta` del game loop topado a 0,1 s, el tiempo de juego avanza más despacio que
el de pared cuando el proceso pasa hambre: por eso caen justo las esperas largas. Es el fantasma
que #210 cerró declarando que **no estaba demostrado que estuviera muerto** («la próxima roja
llegará con el paso muerto escrito en el mensaje»); esta vez lo trae escrito, y está en el
hallazgo 6.

**Lo que no pude hacer y digo en voz alta**: repetir la corrida para separar intermitencia de
regresión. Al terminar, los puertos 3000/9877/18765 los tomó **otro stack, arrancado desde
`/home/al/code/ne-fan`** (PIDs 990677/990778/990829, de otro agente). `qa/run.mjs` no admite
otro puerto y se habría enganchado a ese stack en silencio, midiendo código que no es este. No
lo maté y no volví a correr. La atribución de arriba se sostiene en el mecanismo y en los ocho
verdes del selector, no en una segunda corrida.

---

## Hallazgos

**Ninguno bloqueante.** Ninguno de los de abajo impide mergear la PR #265.

### Importante — 0. El arreglo pone el mensaje, pero el `<select>` sigue mintiendo

El modo de fallo de #248 tenía **dos mitades**: el selector no decía nada, *y* el desplegable
mostraba una fixture que no era la que se estaba viendo. El arreglo cierra la primera y deja la
segunda entera. Medido en el juego real:

```
snippet → {"select":"../nefan-core/data/scenes/zorder_test.json","mundo":"robledo_tile"}
```

Se ve en la captura `qa/capturas/24-…-01-selector-fixture-rota.png`: arriba a la izquierda el
desplegable pone `zorder_test`, y el pueblo que hay debajo es `robledo_tile`. Quien conduce el
preset `html-fixtures` —que es para lo que existe ese selector— se queda con la etiqueta
apuntando a una escena que no está mirando, y la única pista de que no cargó es un mensaje que
se irá en cuanto pasen ocho líneas más por el log (`combatLog` conserva 8).

**El sitio del arreglo ya está escrito**: el `alFallar` del `paso()`, que existe justamente para
«devolver un botón a su sitio» (su propio docstring). Devolver `sceneSelector.value` a la
fixture que sí está cargada son dos líneas.

**Reproducción desde el arranque**: `./start.sh --preset html-fixtures` → elegir una fixture →
hacer que su JSON no cargue (renombrarlo, o quedarse sin disco) → el mensaje aparece y el
desplegable se queda en la fixture que falló. **Lo que espera quien lo usa**: que el desplegable
diga qué está viendo.

Mi guion **lo mide y lo escribe en la salida, pero no lo afirma** (`ctx.log`, no `ctx.expect`):
un guion rojo por un hallazgo abierto envenena la batería. Cuando se arregle, esa línea se
asciende a `ctx.expect` en el mismo commit.

### Importante — 1. `paso()` puede reventar en el propio handler del click

`paso(promesa, …)` hace `promesa.catch(…)` sin comprobar que le hayan dado una promesa
(`nefan-html/src/ui/async-ui.ts`). El nuevo llamante le pasa
`fpsRenderer.element.requestPointerLock()`, que **devuelve `Promise<void>` en Chrome** pero
`undefined` en navegadores donde esa API aún no es prometida. En uno de esos, **cada click en el
lienzo lanzaría un `TypeError` no capturado** — la herramienta de fail-loud convertida en el
fallo. El ingeniero lo dejó escrito, y el proyecto declara Chrome/Chromium como objetivo, así
que **no es bloqueante**; lo levanto porque el sitio donde se arregla no es este llamante sino
`paso()`, y ahí vale para todos los futuros.

**Reproducción**: abrir el juego en un navegador cuyo `requestPointerLock()` no devuelva
promesa y hacer click en el lienzo. **Lo que espera el jugador**: capturar el ratón, o que le
digan por qué no.

### Menor — 2. La otra rama del selector «Room» no usa el mismo canal

`loadSceneFile` tiene un segundo modo de fallo, y no va por donde va el arreglado:

```ts
const loader = sceneModules[globKey];
if (!loader) {
  log("Scene not found: " + globKey);
  return;
}
```

El mismo fallo del jugador —elijo una fixture y no aparece— sale por **la línea del juego pero
no por el registro de errores**, y en inglés, mientras la rama arreglada sale por los dos y en
español. No es mudo (por eso es menor), pero es el mismo suceso contado de dos maneras.
**Reproducción**: no es alcanzable desde el `<select>` (sus opciones se generan del mismo glob),
solo desde `__nefan.loadFixture` con una clave que no exista — o el día que alguien llame a
`loadSceneFile` desde otro sitio.

### Menor — 3. Crítica visual: el canal que se eligió es el menos legible de la pantalla

Mirando las capturas como quien juega, no como quien programa. El registro de errores (columna
derecha) está bien: la entrada `scene` encabeza la lista, con su fuente en color, su hora y el
`TypeError` completo en el `detail` — se lee de un vistazo y no tapa el juego.

La **línea del juego** es otra cosa. `⚠ no se pudo cargar la escena …` cae en `#combat-log`,
abajo a la izquierda, en un texto tenue sobre el suelo oscuro del pueblo: en la captura es
**menos legible que cualquier otro elemento de la pantalla**, incluido el HUD de ataques, que
está a diez centímetros y va en cajas con contraste. No es culpa de esta tanda —las líneas
vecinas («Atlas fps de tile_0_0…», «Scene loaded: tile_0_0») se leen igual de mal en la captura
sana del `01`— pero sí es su problema: el arreglo eligió esa superficie como el canal *«donde el
jugador está mirando»*, y ahí el fail-loud sale susurrando. Además el texto es la **ruta del
glob** (`../nefan-core/data/scenes/zorder_test.json`), no la etiqueta que el jugador eligió en
el desplegable.

No es bloqueante y no pido cambiar el color en esta PR. Lo dejo escrito porque «se entera quien
lo está usando» es el criterio de terminado literal, y de los dos canales que se pusieron, uno
se entera de verdad y el otro depende de que le dé la luz.

### Menor — 4. `qa/README.md` había perdido cuatro guiones

La tabla «Los guiones sembrados» salta del `17` al final: los guiones `18`, `19`, `20` y `21`
nunca tuvieron fila. Es anterior a esta tanda. Añado la del `22` y **dejo escrita la ausencia**
en el propio README para que no parezca que la tabla está completa.

### Ambiental (no es de la tanda) — 5. El worktree no tiene las hojas de personaje

`nefan-html/public/sprites/` está en `.gitignore` (línea 53) y **no existe en el worktree**: solo
está en el repo principal, donde lo generó sprite-forge. Vite responde a cada `meta.json` que
falta con el `index.html` de la SPA — el «200 mentiroso» que el propio `qa/README.md` documenta—
y `13-personajes-animados` sale rojo con diez `SyntaxError: Unexpected token '<'`. **Cualquier
worktree o clon recién hecho tiene este rojo**, y ninguna prosa lo avisa. Lo apunto porque la
próxima persona que corra la batería fuera del repo principal va a perder la misma media hora.

### Ambiental (no es de la tanda) — 6. `comenzar()` espera la señal equivocada

Tres guiones (`08`, `09`, `15`) murieron con la misma firma:

```
page.click: Timeout 30000ms exceeded.
  - <div id="title-screen">…</div> intercepts pointer events
```

No es un bug del juego: es que `qa/lib/sesion.mjs:comenzar()` da la partida por arrancada cuando
llega la escena (`status().scene`), y el título **no se oculta ahí**. `main.ts` lo esconde al
final de `unIntentoDeArrancar()` («Solo aquí: la partida está en marcha y el título deja de
hacer falta»), varios `await` más tarde. Con la máquina holgada ese hueco no se nota; con la
máquina a load 25 se hace mayor que los 30 s del click y el guion clica contra el overlay.
**El arreglo natural es esperar por `status().title === false`**, que es lo que el `01` sí hace.
Es el mismo fantasma que #210 dejó abierto («la próxima roja llegará con el paso muerto escrito
en el mensaje»); esta vez lo trae escrito.

---

## Workarounds usados

| Workaround | Por qué | Veredicto |
|---|---|---|
| `ln -s /home/al/code/ne-fan/qa/node_modules qa/node_modules` | El worktree no traía `playwright-core`; sin él `qa/run.mjs` ni arranca (`ERR_MODULE_NOT_FOUND`) | **No afecta al usuario.** `qa/node_modules` está gitignorado y se instala con `npm i` en `qa/`; es una carencia del worktree, no del repo |
| El guion nuevo **aborta la petición** del JSON de `zorder_test` | Es la única forma de que una fixture falle sin tocar el disco compartido | **No es un workaround del cliente**: la inyección es en el BORDE (la red), no dentro del juego. El `<select>` se conduce por su evento `change` real. Nada se oculta, nada se fuerza, no hay `display:none` |
| Sabotajes temporales (`src/__qa-candado.ts`, `src/__qa-ciegos.ts`, `r.rule.message` en `deuda.ts`, `loadSceneFile(value);` de vuelta en `main.ts`) | Ver los candados rojos es el criterio de terminado | Todos revertidos; `git status` limpio después de cada vuelta. **No quedó ni una línea de código mía en el árbol** |
| Arranqué mi propio stack en los puertos estándar (3000/9877/18765) y lo paré por PGID | `qa/run.mjs` no admite otro puerto: el cliente, el bridge y el fake-ai los lleva fijos | Comprobado antes de arrancar que **ninguno estaba ocupado**, y al parar maté **solo el grupo de procesos que arranqué yo** (PGID 962596), verificado por `cwd` dentro del worktree. Ningún proceso ajeno tocado |

---

## No probado

- **El rechazo real de `requestPointerLock()`.** Es la segunda violación que arregló #248 y
  sigue sin ejercerse: haría falta que Chrome rechace de verdad (documento sin foco, o Esc y
  volver a pedirlo dentro de su ventana de enfriamiento). Lo que sí está comprobado es que el
  cliente **no tiene handler de `unhandledrejection`** (`grep` a cero en `nefan-html/src`: solo
  aparece en comentarios), así que la premisa del arreglo es cierta; y que `"input"` **ya era**
  una fuente del error-log antes de esta tanda (`main.ts:449`), así que no estrena etiqueta.
- **Mutación.** Fuera por decisión del usuario: corre sola en el runner a las 3:00. **No la echo
  de menos aquí** y no la pido como hallazgo: este diff no toca ni un fichero de los que se
  mutan (los módulos mutan `src/**` del núcleo puro; aquí solo cambian un config de eslint, dos
  líneas del cliente, prosa de un `why`, un tsconfig nuevo, dos scripts de `package.json` y un
  test que no está en ninguna batería).
- **El coste del lint (1,50 s → 2,51 s).** No lo re-medí: la máquina estaba a load 25 y
  cualquier número mío habría sido peor que el suyo.
- **Gasto de créditos: cero.** Todo lo que arranqué fue el preset `e2e-sin-creditos`
  (fake-ai-server). No toqué remote-gen, sprite-forge ni ai_server.

---

## Lo que dejo ejecutable

| Fichero | Qué fija | Probado en negativo |
|---|---|---|
| `qa/guiones/24-el-selector-de-fixtures-no-se-calla.mjs` | Que un fallo de fixture del selector «Room» llegue a la PANTALLA por sus dos canales, nombrando la fixture, y que no deje el cliente sin salida. Es lo que los dos candados de #248 **no pueden ver**: ellos miran el idioma, no el síntoma | **Sí**: con `loadSceneFile(value);` de vuelta en `main.ts`, `✘ entradas 11 → 11`, `✘ ninguna línea` y el juego anclado en `Scene loaded: tile_0_0`. Restaurado el arreglo, cinco asertos verdes. También en verde dentro de la corrida completa |

Pasa los dos candados que gobiernan `qa/**/*.mjs` (`campos-retirados-no-vuelven` y
`qa-guiones-sin-espera-por-reloj`): `architecture.test.ts` `pass 37 / fail 0` con el guion
dentro. Documentado en `qa/README.md`.

---

## Las dos preguntas que el encargo me dejó

### ¿El guion del selector debe commitearse en `qa/guiones/`? **Sí, y ya está hecho.**

`qa/guiones/24-el-selector-de-fixtures-no-se-calla.mjs`.

La razón no es completitud: es que **los dos candados de esta tanda no pueden ver lo que este
guion afirma**. `no-floating-promises` y `html-sin-promesa-muda` miran el IDIOMA — que la
promesa no se suelte. Ninguno de los dos sabe si el fallo llega a la pantalla. Quítale el
`alFallar` al `paso()` del selector, o haz que `errors.push` deje de pintar, y **los dos siguen
verdes** mientras el jugador vuelve a quedarse sin enterarse. Un bug vivo arreglado sin candado
que mire el síntoma vuelve; lo que hay que candar es el síntoma, no solo la sintaxis que lo
produjo.

Diferencias con el guion ad-hoc del ingeniero, que no debía commitearse tal cual y él acertó
al no hacerlo:

- **Sin puerto raro ni bridge falso**: monta sobre el stack estándar de `qa/run.mjs`, así que
  no hay nada que explicar sobre por qué usa `:3111` ni `ws://127.0.0.1:19877`. Esos eran
  apaños para no chocar con otro QA — condiciones de una tarde, no de un candado.
- **Control explícito**: `robledo_tile` carga primero. Si ninguna fixture cargara, un guion que
  solo mirase la fixture rota daría verde por el motivo equivocado.
- **Un aserto más que el informe no cubría**: que el fallo **no deja el cliente sin salida** —
  tras el fallo, el selector vuelve a cargar una fixture y el tile queda montado.
- **Probado en negativo**, que es lo que lo hace valer: con `loadSceneFile(value);` de vuelta,
  `entradas 11 → 11`, cero líneas nuevas y el juego anclado en `Scene loaded: tile_0_0`.

Documentado en `qa/README.md` con su fila y su prueba en negativo.

### ¿Había que tocar `CLAUDE.md`? **No. De acuerdo con el ingeniero.**

Y no por deferencia: por lo que dice el propio fichero. Su tabla «Lo que ya NO se comprueba
leyendo» existe para lo que **falla solo**, y añade literalmente: *«Si vas a añadir una regla a
este fichero, pregúntate antes si puede ser una de esas»*. Los dos candados nuevos ya son de
esas: `npm run verify` los corre a los dos y el CI también. Una fila que diga «existe un lint
con tipos» es prosa que hay que recordar sobre algo que no hace falta recordar, en un fichero
que entra ENTERO en cada sesión y cuyo coste es el contexto de todo el mundo.

Una observación que **no** es de esta tanda pero conviene que quede escrita: la sección
«Errores y logging» dice que el checker de fronteras sujeta esto *«en `nefan-core` y en los
endpoints Python»*, y eso ya era impreciso antes de #248 — `html-sin-catch-silencioso` y
`html-sin-promesa-muda` llevan tiempo cubriendo `nefan-html/src/**`. Si algún día se toca esa
frase, ahí hay una palabra que corregir. No lo pido como hallazgo de esta PR.

---

## Veredicto

**APTO CON RESERVAS.** La PR #265 puede mergearse.

Lo que se pedía está hecho y **lo he visto yo**, no leído: los dos candados rojos ante el fallo
que existen para cazar —incluida la complementariedad en las dos direcciones, que es la
afirmación que sostiene el gate nuevo— y verdes al revertir; el contraste de los cinco gates que
siguen verdes con el error de tipos dentro, reproducido entero; el bug vivo arreglado y ejercido
en el cliente real, con su contraprueba mostrando que antes no dejaba **nada**; y `#231` sin
cerrar, sin `as any`, sin baseline, sin un umbral tocado y sin un `continue-on-error` en el
workflow. Las dos cosas que el ingeniero dejó razonadas y no ejecutadas eran ciertas: los
guiones `18`, `19` y `21` pasan con su aserto del registro, y `CLAUDE.md` no había que tocarlo.

**La reserva es una y tiene nombre**: el arreglo cierra la mitad muda del bug y deja abierta la
mitad que miente. Tras el fallo, el `<select>` sigue mostrando la fixture que no cargó mientras
el mundo es la anterior (hallazgo 0), medido en el juego real y visible en la captura. No lo
considero bloqueante porque el criterio literal —*«se entera quien lo está usando»*— **se
cumple**: hay entrada en el registro y hay línea en el juego. Pero son dos líneas en el
`alFallar` que ya está escrito, y mientras no se hagan, la pantalla dice dos cosas distintas
sobre qué escena se está viendo.

Lo demás que dejo apuntado no es de esta tanda: el `paso()` que confía en recibir una promesa,
la otra rama de `loadSceneFile`, el worktree sin `public/sprites` y el `comenzar()` de
`qa/lib/sesion.mjs` que espera la señal equivocada — este último es el que convierte una máquina
cargada en cuatro rojos y merece issue propio, porque es el que hace que la batería no distinga
un fallo de un fantasma.

**No arreglé nada.** El árbol solo lleva `qa/guiones/24-el-selector-de-fixtures-no-se-calla.mjs`,
su fila en `qa/README.md` y este documento.
