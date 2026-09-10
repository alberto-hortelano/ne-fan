# QA — PR 6 de #346 «El título troceado» · EL CHASIS Y LOS AVISOS, y el CIERRE DEL PROGRAMA

Árbol `/home/al/code/ne-fan-346-6qa`, HEAD desprendido en `0541a13f`. Todo lo de abajo está medido
ahí, con rutas absolutas y cero créditos (`e2e-sin-creditos`, motor falso). Esta validación tiene dos
capas: **la PR** (§1–§5) y **el cierre de #346** (§8), que es la que nadie más iba a hacer.

## Veredicto

**APTO.** El corte está hecho, es equivalente y el criterio de cierre del usuario está **cumplido en
sus seis puntos** (§8.1), con el trinquete que lo sostiene **probado en negativo por mí**: volver a meter la
excepción de `title-screen.ts` con su cifra exacta de hoy (368) pone ROJO
`client-file-size.test.ts` («ya cabe bajo el tope está MUERTA»), o sea que la exención no puede
volver en silencio.

La equivalencia la he medido con **mi propio comparador** y con **mi propio A/B en el navegador**, no
leyendo el informe: 23 líneas de código de `HEAD~1` sin ocupante y las 23 son transformaciones
declaradas (ni una del cuerpo movido), los 67 ids idénticos, **cero literales de texto de usuario
tocados** (extraídos del AST, no por `grep`), y el overlay **byte a byte el mismo** en las dos puntas
con mi método y en un preset distinto del suyo.

La desviación que el ingeniero declara —`crearAvisos` en el constructor y **no** dentro de
`pintarElHome`, contra lo que la PR 4 predijo por escrito— **es la correcta, y lo he demostrado
ejerciendo el contrafactual**: con la caja construida en cada pintado, el guion 69 se pone rojo justo
en «el aviso SOBREVIVE al repintado del home (era literalmente el bug del innerHTML)». No es una
opinión de diseño: es #306 reabierto.

Los hallazgos son **dos, los dos menores**: una cifra de la prosa del chasis que no reproduce, y una
frase de la cabecera del guion 99 que dice al revés lo que su sonda hace. Ninguno bloquea. El
**hueco que el 99 declara sigue sin ocupante** y ahora tiene guion propio, el **102**, verde y con
dos sabotajes que lo ponen rojo **con el 99 en verde como control**.

---

## 1. Tabla de criterios — la PR

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Salen `chasis.ts` (353) y `avisos.ts` (150); la raíz baja de 682 a 368 | ✅ | `wc -l`: `title-screen.ts` **368**, `titulo/chasis.ts` **353**, `titulo/avisos.ts` **150** |
| 2 | **Riesgo 2 · el primer hijo, en el DOM REAL** | ✅ | Navegador, preset `e2e-sin-creditos` en `NEFAN_PORT_OFFSET=500` desde mi árbol: `{"hijos":3,"ids":"(content),ts-mas,ts-close","primeroEsLaColumna":true,"primeroTagYEstilo":"DIV#(sin id) overflow=auto maxW=720px"}`. Y los cuatro guiones que leen `getElementById("title-screen").firstElementChild` —**33, 34, 95, 99**— verdes en la batería completa. El 80 y el 100 lo leen sobre OTROS elementos (`#combat-log`, la línea de progreso): la corrección del ingeniero al plan es exacta, `grep -rn firstElementChild qa/guiones/` |
| 3 | **Riesgo 3 · los ids del chasis** | ✅ | `#ts-close` y `#ts-mas` presentes en el DOM real (arriba). Los **67 ids** `ts-*`/`data-*` son el MISMO conjunto sobre la unión raíz + `ui/titulo/` en las dos puntas: `diff` de los dos `sort -u` → **vacío**, 67 = 67. El plan hablaba de «una docena» de guiones que usan `#ts-close` como «el título apareció»; medidos hoy son **18** (01 02 03 06 16 22 23 24 30 32 33 34 44 61 80 95 96 99, `grep -l ts-close qa/guiones/*.mjs`), y los 18 verdes salvo el 80, que es el intermitente de #545 y falla por otro aserto |
| 4 | **Riesgo 4 · los cinco oyentes de por vida se mudan sin fugarse** | ✅ | Guion **99** verde en la batería (`28 → 28, ninguno nuevo`). Estático: `grep -c 'this\.'` en los dos módulos → **0** y **0**. Y medido por mí con una sonda nueva (guion **102**): de los **84** registros que el título hace en todo el recorrido (seis pintados del home y cinco del selector), **4 viven dentro de `#title-screen` y 80 están muertos** — cero fuera |
| 5 | **Riesgo 4 · ¿ha estrenado esta PR el hueco que el 99 declara?** | ✅ **NO lo ha estrenado** | El hueco es «un oyente sobre un nodo DESCONECTADO que se conecte después FUERA del título». Guion **102**, escrito para eso: los dos oyentes del chasis que nacen huérfanos (`scroll` de la columna y click de `#ts-close`) acaban **dentro**, y ningún oyente atribuido a la raíz o a `ui/titulo/` vive fuera del overlay, ni al entrar ni tras cinco idas y vueltas |
| 6 | **Riesgo 6 · los tres huecos de mensaje viajan verbatim (#427 no se cuela)** | ✅ | No por `grep`: extraje **todos** los literales de cadena del **AST de TypeScript** (`ts.isStringLiteral` + plantillas) de la unión raíz + `ui/titulo/` en las dos puntas y los diffeé. Diferencias: **4 especificadores de import**, el par `"error"`/`"aviso"` que el `interface Avisos` declara además de la implementación, y **un `"none"` que desaparece** porque `panel && this.root.style.display !== "none"` pasó a `panel && this.chasis.visible` (el mismo predicado). **Cero texto de usuario tocado** |
| 7 | **La desviación declarada: `crearAvisos` en el constructor, no en `pintarElHome`** | ✅ **y es la correcta** | Ejercí el contrafactual: con `this.avisos = crearAvisos(...)` metido dentro de `pintarElHome` (lo que la PR 4 predijo), **guion 69 ROJO** en «el aviso SOBREVIVE al repintado del home» y «sigue habiendo UNO, no dos», y **guion 70 ROJO** por timeout esperando el aviso. Restaurado, md5 `bd381de2…` comprobado. Con el árbol bueno los dos verdes en la batería |
| 8 | **Equivalencia: 0 líneas de código de `HEAD~1` perdidas** | ✅ | **Comparador propio** (mi tabla de normalización, no la suya): código 336 → 387 (**+51**, que es la cifra que él declara). **23** líneas de `HEAD~1` sin ocupante y las 23 son transformaciones declaradas —campos → `let`/`const`, `private X(): void {` → `const X = …` / `function X(…)`, la fachada inline de avisos → el campo, el import que se parte en dos, `const mas = this.aviso;` que se queda sin sujeto—; **ni una del cuerpo movido**. Las 74 nuevas son andamiaje: 4 `interface`, 2 firmas, 2 objetos devueltos, sus cierres, los imports y el cableado |
| 9 | Residuo de `this.` en los módulos nuevos | ✅ | `grep -c 'this\.'` → **0** (chasis) y **0** (avisos) |
| 10 | **El DOM del overlay es el mismo** | ✅ | **A/B propio**, con mi método y en un preset distinto del suyo (`e2e-sin-creditos`, no `html-fixtures`): con la columna vaciada, md5 del `#title-screen` **`f80221862f3e748330c8422c8e8547ad`** (1320 chars) y del `<style>` **`3325175811e7932eda8db1a9eabcda20`** (1055) — **idénticos** en `HEAD~1` (raíz de 682, sin los dos módulos) y en `HEAD`. Sus hashes absolutos no son los míos porque el método de extracción difiere, y se puede decir en qué: su `largo_css` 1011 son exactamente **44** caracteres menos que mi 1055, que es lo que ocupan `<style id="title-screen-responsive">` (36) más `</style>` (8) — o sea `textContent` frente a `outerHTML`. **La conclusión reproduce**, que es lo que importa: cada A/B es coherente consigo mismo |
| 11 | **La excepción retirada, y el test verde** | ✅ | `npx tsx --test test/client-file-size.test.ts` → **7/7**. Excepciones: `['src/main.ts','src/renderer/fps-gl.ts','src/ui/style-apply.ts']` — **tres** |
| 12 | **El trinquete, probado en negativo POR MÍ** | ✅ | Reinserté la excepción de `title-screen.ts` con la cifra EXACTA de hoy (368): `✖ una excepción cuyo fichero ya cabe bajo el tope está MUERTA y hay que quitarla`. Restaurado. La exención **no puede volver en silencio** |
| 13 | **eslint genera bien su `max-lines` con una excepción menos** | ✅ **reproducido** | 83 líneas de relleno → `451:1 error File has too many lines (451). Maximum allowed is 450 max-lines`, **450 y no 682**. Y el borde: a 450 exactas, `eslint` exit **0**. Restaurado, md5 `bd381de26fcf91e9fd5029423dc297b2` (el mismo que él publica) |
| 14 | No queda rastro de la entrada borrada | ✅ | `grep -rn "title-screen\.ts:[0-9]"` fuera de `docs/agents/` → sólo las salidas SINTÉTICAS del checker en `architecture.test.ts` (`:1`…`:8`) y una cita en pasado; `renderHome`/`renderWorldSelect`/… fuera de `docs/agents/` → sólo textos sintéticos del checker y crónica fechada. El `$comment` re-medido es EXACTO: el rango que exime a estas tres es **[433, 530]** —no hay ningún fichero entre 432 y 531— y el peor no eximido es `ui/titulo/selector-de-mundo.ts` con **432** (`character-sprites.ts` mide 362) |
| 15 | Ningún módulo nuevo por encima de 450 | ✅ | 368 · 211 · 150 · 353 · 129 · 183 · 376 · 134 · **432** · 224. `npx eslint src` exit **0** |
| 16 | Candados y deuda sin crecer | ✅ | `npm test` (core) medido por mí: **tests 2448 · pass 2448 · fail 0**. Dentro: `las-hojas-del-titulo-no-se-atan-entre-si` ✔, `la-logica-de-juego-no-vuelve-al-cliente` (8 grupos) ✔, `[deuda] html-sin-promesa-muda (max 7)` ✔ y `html-sin-catch-silencioso (max 4)` ✔ |
| 17 | Cliente limpio | ✅ | `npx tsc --noEmit` exit **0** · `npx eslint src` exit **0** |
| 18 | **Batería completa** | ✅ con aviso | **Dos corridas, mismo rojo.** #1 (100 guiones): `99 en verde · 1 en rojo`. #2 (101, con mi guion dentro): `100 en verde · 1 en rojo`. El rojo, las dos veces, el **80** con la firma exacta de #545 (`…ni deja una entrada de error — 4 → 5`), reproducido como manda ese issue → §6 |
| 19 | Los guiones que conducen el TÍTULO, verdes **sin retocar ninguno** | ✅ | Medido, no afirmado: para los **8 guiones de `qa/` que las seis PR modificaron** (18, 19, 28, 52, 69, 70, 92 y `qa/lib/sesion.mjs`), el diff `f77b9504..HEAD` filtrando comentarios da **0 líneas de código cambiadas en cada uno**. Ver §8 |
| 20 | **Flujo real desde el arranque** | ✅ | `NEFAN_PORT_OFFSET=500 ./start.sh --preset e2e-sin-creditos` desde mi árbol, parado con `--parar` del mismo árbol: home → «Nueva partida» → selector → «Continuar» → editor → «Volver» → «Crear mundo» → «Volver» → «Subir estilo» → «Volver» → «Continuar» → «Comenzar» → **partida jugable** con el título oculto (`display:none`, `data-titulo="0"`, `#ts-mas` escondido, el chasis con sus tres hijos intactos). Capturas abajo |
| 21 | Gasto real de créditos | ⚠️ no probado | Por diseño: motor falso en todo. `gasto sesión 0,00 € · total 0,00 €` en la captura de partida; **74** declaraciones `⛨ guardarraíl: cliente y bridge declaran fake:true` en la corrida completa; mi guion declara `sinMotor` y nunca pulsa `#ts-gen-world` ni `#ts-apply-style` |

---

## 2. Lo que más miré: el hueco del 99, ocupado

El encargo pide comprobar si **esta PR** le ha puesto ocupante al hueco que la cabecera del guion 99
declara: *«un oyente puesto sobre un nodo TODAVÍA DESCONECTADO (`isConnected` en false) que se
conecte después fuera del título»*. Es el escenario que el chasis podría estrenar, porque
`montarChasis` engancha **dos de sus oyentes con el árbol aún huérfano** —el `scroll` de la columna y
el click de `#ts-close`— y sólo después hace `document.body.appendChild(root)`.

**No lo ha estrenado**, y no lo digo por lectura. Escribí el guion **102**, que es el 99 dado la
vuelta: en vez de clasificar en el instante del registro, **guarda el objetivo y pregunta dónde vive
cuando el DOM ya está montado**, y **atribuye cada registro al módulo que lo escribió** leyendo el
`stack` (el servidor de desarrollo sirve los módulos sin empaquetar). Con el árbol bueno:

```
registros al entrar: 36 · del TÍTULO: 4 · de ésos, huérfanos: 2
  chasis.ts → div · scroll (dentro) | chasis.ts → button#ts-close · click (dentro)
  chasis.ts → div#title-screen · error (dentro) | home.ts → button#ts-new · click (dentro)
tras 5 idas y vueltas: del título 84 · reparto {"dentro":4,"muerto":80}
```

Los cuatro de por vida vivos dentro del overlay y los ochenta de las pantallas **muertos con su
repintado**: eso es la higiene de oyentes del título medida, y es lo que el riesgo 4 quería.

**La atribución no es un adorno.** La primera versión del guion preguntaba «¿hay oyentes huérfanos
vivos fuera del título?» y salía **roja con 14**: botones del HUD, del chip de gráficos y del menú de
dev, ninguno una fuga. La pregunta correcta no es «¿hay oyentes fuera?» sino «**¿los pone el
título?**».

---

## 3. Hallazgos

### H1 · MENOR · **de esta PR (exactitud)** — la cifra que sostiene el criterio del `<style>` no reproduce

`chasis.ts:40-41` y el mensaje del commit dicen, para justificar que el `<style id="title-screen-responsive">`
es del chasis y no del selector: «*que **cuatro de sus seis reglas** apunten a ids del selector no lo
hace del selector*».

Medido sobre `chasis.ts:95-115`, el `<style>` tiene **ocho bloques de regla**, y **seis** nombran ids
que sólo escribe `selector-de-mundo.ts`:

| Regla | Ids | ¿De quién? |
|---|---|---|
| `#title-screen { padding-* }` | — | del overlay |
| `#ts-columns` | 1 | selector |
| `#ts-worlds` | 1 | selector |
| `#ts-rendermode, #ts-charmode { flex-wrap }` | 2 | selector |
| `#ts-rendermode button, #ts-charmode button` | 2 | selector |
| `#ts-actions` | 1 | selector |
| `#ts-actions #ts-create-world` | 2 | selector |
| `#title-screen h1` | — | de cinco pantallas (`grep -n '<h1' ui/titulo/*.ts` → home, selector, crear-mundo, editor, subir-estilo) |

O sea **6 de 8**, no 4 de 6 — y no encuentro un conteo que dé «cuatro de seis»: si sólo se cuentan
los bloques que nombran ids, son **seis y los seis son del selector**. La decisión es la correcta —el `<style>` es un efecto de vida completa
sobre `document.head` y **ninguna hoja puede tocar `document`** (riesgo 4), así que el chasis es el
único dueño posible— pero el número que la argumenta está mal, y el número mal **debilita** el
argumento: 6 de 8 dice más claro que 4 de 6 que este `<style>` está escrito casi entero contra UNA
pantalla, que es justo lo que QA-5 vio venir (H5).

Es la misma familia que QA-2 H4 («dice tres `case`; son cuatro») y QA-4 H1 («dice 366 y son 376»):
**tres cifras de prosa en seis PR que no reproducen**. Ninguna cambia una decisión; las tres se
escribieron después de decidir, que es el patrón de `feedback_justificacion_no_verificada`.

**Reproducción**: `sed -n '95,115p' nefan-html/src/ui/titulo/chasis.ts` y contar; y
`grep -n 'id="ts-\(columns\|worlds\|rendermode\|charmode\|actions\|create-world\)"' nefan-html/src/ui/titulo/*.ts`
→ los seis salen sólo en `selector-de-mundo.ts`.

### H2 · MENOR · **del banco (cabecera del 99), y esta PR se apoya en ella** — la foto del 99 NO incluye los cinco oyentes de por vida

La cabecera del guion 99 dice, al declarar su punto ciego: *«No tiene ocupante hoy —los cinco de por
vida se registran así a propósito, dentro del constructor del chasis, y **por eso la foto de
referencia los incluye**—»*. La segunda mitad es falsa, y se demuestra con la propia sonda del 99:

- `content.addEventListener("scroll")` → `content.parentElement.id === "title-screen"` → **sí se apunta**.
- `root.addEventListener("error")` (`vigilarPortadas`) → `this.id === "title-screen"` → **sí se apunta**.
- `close.addEventListener("click")` → se engancha **antes** de `root.appendChild(close)`: `parentElement`
  es `null`, `isConnected` es `false` y en ese instante `document.getElementById("title-screen")` aún
  devuelve `null` porque `root` no está en el `<body>`. **Las tres ramas fallan: no se apunta.**
- El `ResizeObserver` no pasa por `addEventListener`, así que tampoco.
- `onProgresoDeMundo` no es un oyente del DOM.

O sea que la foto de 28 incluye **dos** de los cinco, no los cinco. Medido con el 102, que sí los ve
todos: `button#ts-close · click` sale marcado `huérfano` y con dueño `src/ui/titulo/chasis.ts`.

No cambia el veredicto del 99 —lo que afirma (0 oyentes nuevos sobre lo que sobrevive) sigue siendo
cierto y sigue siendo útil— y el orden de registro es **idéntico** al de `HEAD~1`
(`grep -nE 'addEventListener|appendChild|document\.body' HEAD~1:title-screen.ts` da la misma
secuencia), así que **no es una regresión de esta PR**. Lo reporto porque el §6 del informe cita esa
foto como la red del riesgo 4 y porque una cabecera que dice cubrir lo que no cubre es exactamente el
«verde que no comprueba nada». Con el 102 en el banco, el hueco queda medido y la frase del 99 se
puede corregir en una línea.

**Reproducción**: `node qa/run.mjs 102` y comparar su lista del título con la del 99 en la misma
corrida.

### Aviso · **no es hallazgo nuevo: es #545** — la batería sigue sin ser estable, y traigo un par de reproducción

Dos corridas completas, el mismo rojo las dos veces (el **80**, `errores 4 → 5`). No lo numero porque
ya tiene dueño; lo que sí es nuevo va en **§6**: el par `node qa/run.mjs 79 80` lo reproduce **1 de 3**,
que es un intento de 20 s en vez de una batería de trece minutos.

### Sin hallazgo · lo que miré y está bien

- **La costura por cadena que abre este corte** (`home.ts` escribe «Bridge OK — N partidas» y
  `avisos.ts` lo lee por su prefijo) la cubre el guion **101** del ingeniero, verde, y sus dos
  sabotajes ponen rojo **cada uno su bloque**. Es la elección correcta: era la única de las cinco
  puertas de `avisos.ts` sin nadie que la pisara.
- **`avisos.ts` no pierde estado**: `crearAvisos` se llama UNA vez y `pintarHome` llama a
  `limpiarAccion()` + `mostrarAccion(...)`/`repintar()` en cada pintado (`home.ts:129-131`), que es el
  mecanismo de #306 intacto. Guion 69 verde en las dos corridas.
- **La API pública no cambia**: `show`, `hide`, `isVisible`, `onVisibilityChange`, `avisar`,
  `retirarAvisos`, `styleRunState` y el re-export de `TitleAction` siguen ahí, y sus tres consumidores
  (`main.ts:32`, `ui/muro-de-carga.ts:181/185`, `dev/nefan-hook.ts:166/281/305`) no se tocan.
- **El seam nuevo `alCerrar`** (el chasis no se esconde solo: sale por el callback y vuelve por
  `ocultar()`) **sí tiene red**: el guion **34** cierra con un click de ratón real sobre `#ts-close` y
  espera `document.documentElement.dataset.titulo === "0"`, o sea el `onVisibilityChange(false)` que
  el chasis no puede emitir. Si alguien hiciera que el chasis se escondiera a solas, el chip de
  gráficos y `#error-log` se quedarían apagados y el 34 lo vería.
- **Crítica visual**: las cinco pantallas se pintan como antes del corte (el A/B del criterio 10 lo
  dice byte a byte para el chasis, y las capturas de la batería para el resto). Los dos defectos que
  se ven en mis capturas son los que **ya reportaron QA-4 (H3, H4, H5) y QA-5 (H3, H4)** y son
  verbatim de antes del programa; no los duplico. Uno merece una línea porque a 1280×800 es **peor**
  que a los 1440×900 que midió QA-5: en `qa6-02-selector.png` la fila de acciones —«Continuar →»
  incluido— **no se ve en absoluto**, y no hay señal de que haya más abajo porque la banda `#ts-mas`
  sólo cuenta `.ts-save`, que son filas del home. Es material de #427 y de la familia #250/#251.

---

## 4. Guion dejado: `qa/guiones/102-el-titulo-no-cuelga-oyentes-de-nodos-que-nacen-desconectados.mjs`

El 101 lo dejó el ingeniero; el siguiente libre era el **102** y lo reservé antes de escribir. Fila
propia en `qa/README.md`, justo detrás de la del 101. El siguiente libre es el **103**.

**Por qué éste.** De los cuatro riesgos del plan, tres tenían red ejecutable al llegar aquí (el 33/34
para el primer hijo, la docena de `#ts-close` para los ids, el 99 para las fugas). El cuarto la tenía
**a medias**: el propio 99 declara por escrito el hueco que no ve, y ese hueco es exactamente el que
el chasis podría estrenar. Un hueco declarado y no medido se cuenta como cubierto a los tres meses.

**Verde, con su «no concluyente antes que verde»** (tres guardas: hay registros, hay registros
atribuidos al título, y al menos uno de ésos nació huérfano — sin la tercera, la rama nueva sería
verde por vacía).

**PROBADO EN NEGATIVO**, un sabotaje por vez, restaurado con `md5sum` comprobado, y **las dos veces
con el 99 en verde como control** — que es lo que demuestra que el 102 no es un espejo del 99:

| Sabotaje | 102 | 99 (control) |
|---|---|---|
| El chasis cuelga de `document.body` un nodo enganchado ANTES de conectarlo | **ROJO**, nombrando al fugado: `src/ui/titulo/chasis.ts → div#qa102-portal · click (fuera)` | **VERDE entero** (`28 → 28, ninguno nuevo`; chasis con sus tres hijos) |
| El home monta ese mismo portal en CADA pintado | **ROJO** con el crecimiento a la vista: `1 → 6`, `src/ui/titulo/home.ts → div · click (fuera)` | **VERDE entero** |

Y un tercer sabotaje, que no es del 102 sino de la **desviación** (§1 criterio 7): `crearAvisos`
dentro de `pintarElHome` → **69 y 70 rojos**, el 69 justo en «el aviso SOBREVIVE al repintado del
home». Los tres restaurados: `md5sum` de `chasis.ts` `a5d9d484…`, `home.ts` `37aebd58…`,
`title-screen.ts` `bd381de2…`, y `git status --short` sólo lista el guion nuevo.

---

## 5. Workarounds usados, y su veredicto

| Workaround | Por qué | ¿Afecta al jugador? |
|---|---|---|
| Revertir el árbol a `HEAD~1` (raíz de 682, `chasis.ts`/`avisos.ts` fuera) para la foto A/B del overlay | Un A/B necesita las dos puntas | **No**: técnica de medida. Restaurado con los tres `md5sum` comprobados |
| Tres sabotajes de un fichero cada uno (§4) y una reinserción de la excepción en `client-file-size.json` (§1 criterio 12) | Un guion sin negativo no demuestra nada, y un trinquete que nadie ha visto rojo tampoco | **No**. Los cuatro restaurados y verificados (`git status --short` sólo lista el guion nuevo) |
| Envolver `EventTarget.prototype.addEventListener` con `addInitScript` y leer el `stack` de cada registro | Es la única forma de ver una fuga de oyente: no cambia el DOM ni el HTML pintado | **No**: la sonda es del guion, no del juego |
| 83 líneas de relleno en `title-screen.ts` para el negativo de `max-lines` | Reproducir la prueba que el informe publica | **No**. Restaurado, md5 `bd381de2…` |

**Ningún workaround hizo falta para OBSERVAR la feature.** El título se alcanza por el camino del
jugador (`./start.sh --preset e2e-sin-creditos`, `#ts-new`, `#ts-continue`, `#ts-back`,
`#ts-create-world`, `#ts-upload-style`, `#ts-start`); no oculté ningún overlay ni forcé ningún estado.
Regla del workaround: **sin hallazgo por esta vía**.

---

## 6. Las dos baterías, y el intermitente

| Corrida (misma punta `0541a13f`) | Resultado | Rojo |
|---|---|---|
| #1 · 100 guiones | `99 en verde · 1 en rojo` | **80**-el-desplegable-room · `…ni deja una entrada de error — 4 → 5` |
| #2 · 101 guiones (con el 102 dentro) | `100 en verde · 1 en rojo` | **80**-el-desplegable-room · **el mismo aserto y la misma cifra** (`4 → 5`) |

**El 75, el 91, el 93 y el 81 salieron VERDES en las dos**: la corrida del ingeniero (tres a la vez)
fue peor que las mías, y la diferencia es la carga de la máquina, como #545 dice. **El 102 salió
verde también dentro de la batería completa**, con el reparto que corresponde a un home con partidas
guardadas (`{"dentro":16,"muerto":140}` frente al `{"dentro":4,"muerto":80}` de la corrida aislada,
donde no hay ninguna): la afirmación es «cero fuera», y no depende del número de tarjetas.

**Reproducción del 80 como manda #545**, y aquí traigo **un dato nuevo para ese issue**:

```
$ node qa/run.mjs 80        → 1 en verde · 0 en rojo      (aislado: VERDE)
$ node qa/run.mjs 79 80     → 1 en verde · 1 en ROJO      ← se reprodujo con el vecino
$ node qa/run.mjs 79 80     → 2 en verde · 0 en rojo
$ node qa/run.mjs 79 80     → 2 en verde · 0 en rojo
```

O sea: **el par `79 80` lo reproduce, 1 de 3**, con la misma firma (`errores 4 → 5`). Hasta hoy #545
sólo tenía «rojo en la completa, verde aislado y con su vecino»; esto le da un **par barato con el que
intentarlo** (dos guiones, ~20 s por intento) en vez de una batería de trece minutos. Lo dejo dicho en
el issue, no aquí.

**Sin camino causal desde esta PR**: el aserto rojo cuenta entradas del registro de errores al elegir
la opción vacía del desplegable «Room», con el título ya cerrado; este diff no toca ni el sim, ni la
colisión, ni nada del cliente fuera del título. Y la firma es literalmente la que QA-2, QA-4 y QA-5
documentaron sobre árboles **anteriores** a este corte.

---

## 7. No probado

- **El gasto real de créditos**: por diseño (motor falso en todo). Lo que sí está medido es que nada
  de lo que conduje encola trabajo de pago.
- **`#ts-gen-world` y su confirmación armada de dos clicks**: cualquier click ahí encola una
  generación real. Es el único handler no idempotente del título y sigue siendo el hueco declarado del
  99 y del 102.
- **Cerrar el título con `#ts-close` teniendo una partida YA en marcha**: no lo ejerce nadie, y es el
  mismo hueco que había antes del corte. El 34 lo pulsa con el título recién abierto.
- **CRAP / cobertura / mutación**: el cliente está fuera del perímetro medido; `npm run afectado` da
  cero módulos. No hay medida pendiente ni petición que hacer.

---

## 8. CIERRE DEL PROGRAMA #346

### 8.1 El criterio del usuario, punto por punto

Literal de `requisitos.md` («Decisiones tras la crítica», punto 2):

| # | Criterio, literal | Veredicto | La cifra |
|---|---|---|---|
| 1 | «`title-screen.ts` baja de 450» | ✅ **cumplido** | **368** (`wc -l`). Era **1.738** al abrirse el programa. Margen bajo el tope: **82** |
| 2 | «y **desaparece de `client-file-size.json`** (de cuatro excepciones a tres)» | ✅ **cumplido y CANDADO** | Excepciones hoy: `src/main.ts`, `src/renderer/fps-gl.ts`, `src/ui/style-apply.ts` — **tres**. Y probado en negativo por mí: reinsertarla con su cifra exacta (368) pone rojo `client-file-size.test.ts`. Es la **primera exención del régimen que muere por troceo** y no porque su fichero desapareciera |
| 3 | «**0 `let`** en la raíz (hoy 11)» | ✅ **cumplido** | `grep -c '\blet '` → **0**, y no sólo el `^\s*let ` del plan: cero en cualquier posición. Sobre `f77b9504` el mismo comando da **11**, que es la cifra del requisito |
| 4 | «0 métodos `render*` privados» | ✅ **cumplido** | `grep -c 'private.*render[A-Z]'` → **0**, y `grep -cE 'render[A-Z][a-zA-Z]*\s*\('` → **0**: no queda ni una llamada. Eran **7** |
| 5 | «ningún módulo nuevo por encima de 450» | ✅ **cumplido** | 211 · 150 · 353 · 129 · 183 · 376 · **432** · 134 · 224. El mayor, `selector-de-mundo.ts` con **432**, con 18 de holgura. `npx eslint src` exit 0 |
| 6 | «las **30 baterías** que conducen el título por `#ts-*` verdes **sin retocar un guion**» | ✅ **cumplido**, y con la cuenta al día | Ver 8.2 |

### 8.2 «Sin retocar un guion» — medido, no afirmado

**Cuántos guiones conducen el título hoy.** El criterio se escribió con «30» (crítica) y «~40»
(encargo); hoy la cifra depende de dónde se ponga el corte, así que doy las dos lecturas y lo que el
programa aportó:

| Definición | Hoy |
|---|---|
| Guiones con `#ts-*` o `title-screen` **propios** en su código | **38** de 101 |
| Guiones que pasan por el título (los de arriba más los que usan `nuevaPartida`/`comenzar`/`reanudar`/`abrirSelectorDeMundos`/`esperarTituloListo`/…) | **87** de 101 |
| Guiones que el programa AÑADIÓ al título | **9** (94, 95, 96, 97, 98, 99, 100, 101 y el 102) |

Sea cual sea el corte, la red se corrió entera: **batería completa dos veces**, con un solo rojo y con
dueño ajeno (§6).

**Y ningún guion se retocó, en ninguno de los seis cortes.** `git log -p` / `git diff` sobre `qa/` en
el rango del programa (`f77b9504..HEAD`) toca **17 ficheros**: **8 guiones nuevos** (94-101) y **9
preexistentes** (`qa/README.md`, siete guiones y `qa/lib/sesion.mjs`). Para los ocho preexistentes que
son código, filtrando líneas de comentario:

```
18-el-titulo-responde-y-vuelve.mjs            : 0 líneas de código cambiadas
19-el-titulo-arranca-de-verdad.mjs            : 0
28-la-portada-repintada-tampoco-miente.mjs    : 0
52-borrar-una-partida-dice-que-paso.mjs       : 0
69-el-arranque-no-se-calla.mjs                : 0
70-el-aviso-del-arranque-no-mueve-el-suelo.mjs: 0
92-el-estilo-que-ofrece-el-titulo…mjs         : 0
qa/lib/sesion.mjs                             : 0
TOTAL = 0
```

**El diff de `qa/` sobre guiones existentes es comentario puro**, que es literalmente lo que el
programa prometió. Los ocho cambios son barridos de rastro (`renderHome` → «el home»,
`title-screen.ts:905-909` → el módulo).

### 8.3 La pregunta que ningún candado contesta: ¿repartió el god-file o lo reconstruyó?

**Mi juicio: lo REPARTIÓ.** No es una impresión; hay cuatro medidas y una reserva.

**(a) El grafo de dependencias es una ESTRELLA, no un anillo.** Medido contando los `from "…"` de cada
módulo:

| Módulo | imports de `ui/titulo/` |
|---|---|
| `atomos.ts` | 0 |
| las **ocho** hojas (avisos, chasis, crear-mundo, editor-de-personaje, home, plan-de-estilo, selector-de-mundo, subir-estilo) | **1 cada una** — y siempre `./atomos.js` |
| `title-screen.ts` (el enrutador) | 9 |

Ninguna hoja conoce a otra. El «god-file repartido en nueve ficheros atados en anillo» que el plan
temía **no existe**, y ahora tiene candado (`las-hojas-del-titulo-no-se-atan-entre-si`, que además
—más fuerte que el plan— prohíbe también que una hoja importe de vuelta al enrutador).

**(b) Cada pantalla se entiende sola.** Cada hoja exporta **una** función de entrada (dos el selector)
y recibe **≤ 6 colaboradores nombrados**, sin objeto de contexto:

```
crear-mundo 3 · editor 3 · plan-de-estilo 3 · subir-estilo 2 · avisos 1 · chasis 1 · home 6 · selector 6
```

Los dos concentradores tienen 6, que es la cifra que la crítica puso como frontera. Ningún módulo
tiene `this.` (0 en los nueve).

**(c) Ningún módulo es un god-file pequeño.** El mayor es `selector-de-mundo.ts`: 432 líneas de las
que **327 son código**, con 11 funciones internas y 2 exportadas. Es grande porque la pantalla es
grande (17 ids propios), no porque acumule lo de nadie más. El resto va de 129 a 376.

**(d) `atomos.ts` sigue siendo vocabulario, con una fisura medida.** 19 exports, censados **por
import** (no por `grep`, que cuenta la prosa):

| Dueños | Exports |
|---|---|
| **≥ 2** (vocabulario de verdad) | 9: `DestinoDelTitulo` (7), `escapeHtml` (7), `BTN_PRIMARY_CSS` (6), `BTN_SECONDARY_CSS` (5), `TitleAction` (3), `escapeAttr` (3), `SELECT_CSS` (3), `INPUT_CSS` (3), `AI_SERVER_HTTP` (2) |
| **1** | 7: `ASSET_STORE_URL` (raíz), `BADGE_CSS` · `BTN_SMALL_PRIMARY_CSS` · `BTN_SMALL_DANGER_CSS` (home), `marcadorHtml` (chasis), `coverHtml` · `worldCardHtml` (selector) |
| **0 fuera de `atomos.ts`** | 3: `generationChipsHtml`, `COVER_BOX`, `COVER_MARK_CSS` |

Los tres de cero son los que **QA-1 dejó anotados en su H5** («si la PR 5 no los estrena, bajan a
privados»); la PR 5 estrenó `DestinoDelTitulo` —que entonces también estaba a cero y hoy tiene siete—
y **no estrenó los otros tres**. Siguen siendo API pública sin lector: no hacen daño, y son la grieta
por la que entra la concentración. Bajarlos a privados es un `export` menos, tres veces.

**La reserva, y es la única que pongo: hay un SEGUNDO grafo que el candado no ve — el acoplamiento por
id de DOM.** Medido cruzando qué ids escribe cada módulo contra cuáles lee (sin contar comentarios):

| Lector | Ids que lee de OTRO módulo | Dueño |
|---|---|---|
| `title-screen.ts` | `#ts-gen`, `#ts-gen-progress` | selector |
| `avisos.ts` | `#ts-error`, `#ts-status` | home |
| `chasis.ts` | `#ts-sessions`, `.ts-save` | home |
| `chasis.ts` (el `<style>`) | `#ts-columns`, `#ts-worlds`, `#ts-rendermode`, `#ts-charmode`, `#ts-actions`, `#ts-create-world` | selector |

**Doce parejas** que TypeScript no ve, que `las-hojas-del-titulo-no-se-atan-entre-si` no cubre (prohíbe
imports, no cadenas) y que sólo se rompen en tiempo de ejecución. El troceo no las creó —vivían dentro
del god-file, donde eran una lectura del mismo `this.content`— pero **al repartirlas las convirtió en
frontera entre ficheros**, y eso es exactamente lo que el ingeniero vio en una de ellas y por lo que
escribió el guion 101. De las doce, **una tiene red propia** (el prefijo «Bridge OK», guion 101); las
otras once están cubiertas de refilón por guiones que se pondrían rojos (33 para `#ts-sessions`/`.ts-save`,
38/100 para `#ts-gen-progress`, 69/70 para `#ts-error`) y las **seis del `<style>` no las cubre nadie**:
si el selector renombra `#ts-columns`, la distribución móvil deja de aplicarse y **todo sigue verde**.

**Conclusión.** El troceo repartió: estrella limpia, hojas con ≤ 6 colaboradores, ningún módulo que
acumule lo ajeno y un vocabulario compartido que sigue siendo vocabulario. Lo que queda no es un
god-file disfrazado: es **una frontera nueva escrita en cadenas** que conviene nombrar en un issue
—«los ids que un módulo del título lee de otro, declarados en un sitio»— antes de que #513, #536,
#425 y #537 empiecen a moverlos.

### 8.4 Lo que costó, en líneas

| | Al abrirse #346 | Hoy |
|---|---|---|
| Ficheros | 1 | 10 |
| Líneas totales | 1.738 | **2.560** (+822, **+47 %**) |
| Líneas de **código** | 1.237 | **1.548** (+311, **+25 %**) |

Las +311 de código son el andamiaje de nueve módulos (imports, los `Deps…`, las firmas y los objetos
devueltos): ~35 por módulo, que es lo que el ingeniero declaró PR a PR. Las otras +511 son
documentación. Es el precio del corte y está dicho con su número: nadie prometió que trocear saliera
gratis en líneas; lo que compra es que #427, #425, #536, #513 y #537 dejen de tocar el mismo fichero.

### 8.5 Las tres constantes que la PR 1 dejó para el cierre — **con el dato medido hoy**

`requisitos.md` cierra pidiendo esto explícitamente. Medido **por import**, hoy:

| Constante | Dueños hoy | Líneas en `atomos.ts` |
|---|---|---|
| `BADGE_CSS` | **1** — `home.ts` | 4 |
| `BTN_SMALL_PRIMARY_CSS` | **1** — `home.ts` | 4 |
| `BTN_SMALL_DANGER_CSS` | **1** — `home.ts` | 4 |

**Mi recomendación: MOVERLAS a `home.ts`.** Tres razones, la primera es la que decide:

1. **El criterio del propio programa dice que se muevan.** Enunciado entero en `requisitos.md`: *«a
   `atomos.ts` va lo que tiene ≥ 2 dueños y hoy vive dentro de `title-screen.ts`»*. Con un dueño, la
   primera mitad falla. Una excepción declarada «para el cierre» que en el cierre no se re-litiga es
   cómo un módulo de vocabulario se convierte en cajón — y `atomos.ts` **no tiene tope propio** (plan
   §6b), o sea que nada lo va a avisar.
2. **El motivo por el que se eligió la opción B era literalmente éste.** El plan §3: *«cada retoque de
   una fila de save toca `home.ts`, no el módulo compartido»*. Hoy toca el módulo compartido, que
   importan las ocho hojas.
3. **Cabe y no hay red que perder.** 12 líneas: `home.ts` pasa de 376 a ~388, con 62 de holgura. Y el
   guion **94** («el vocabulario visual del título es uno solo») las mide por `getComputedStyle` sobre
   el elemento vivo, no por dónde vive la constante: sigue verde tras el movimiento y se pondría rojo
   si al mover se retocara un color.

**Y la contraria, que también es del cierre: el trío de la portada se QUEDA, y ahora con un motivo
medido.** `coverHtml`, `worldCardHtml` y `generationChipsHtml` tienen también un solo dueño
(`selector-de-mundo.ts`), pero devolverlos **no cabe**: `worldCardHtml` (13 líneas) +
`generationChipsHtml` (26) llevarían el selector de **432 a ~471**, o sea por encima del tope, y
habría que abrirle una excepción el mismo día. La excepción que la PR 1 declaró para ellos es
**portante**; la de `BADGE_CSS`/`BTN_SMALL_*` no lo es. Eso es lo que las separa, y conviene que quede
escrito en `atomos.ts` con la cifra, no como preferencia.

### 8.6 Qué queda abierto al cerrar (para el coordinador, no para esta PR)

1. **Las tres constantes** de 8.5 → mover a `home.ts` (12 líneas, red = guion 94).
2. **Tres exports sin lector** en `atomos.ts` (`generationChipsHtml`, `COVER_BOX`, `COVER_MARK_CSS`) →
   privados. Es QA-1 H5, que la PR 5 resolvió sólo para `DestinoDelTitulo`.
3. **El acoplamiento por id de DOM** (8.3): doce parejas, seis sin red. Issue.
4. **La cabecera del guion 99** (H2): una frase que dice cubrir lo que no cubre. Una línea.
5. **La cifra del `<style>`** en `chasis.ts` (H1): 6 de 8, no 4 de 6.
6. **#545 tiene un par barato de reproducción**: `node qa/run.mjs 79 80`, 1 de 3 (§6).
7. Lo que ya estaba y sigue: **#427** (QA-4 H3/H4/H5, QA-5 H3/H4), **#513** (que ya puede arrancar),
   #536, #425, #537, y la dirección inversa del candado (hoy 0 ocupantes).
