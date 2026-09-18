# Crítica — Tanda R «El cliente entra en Node y en el banco»

**#665 → REENCUADRADA (recomiendo cerrarla sin código)** · **#663 → VIGENTE, pero INDEPENDIENTE de #665 y con el patrón corregido** · **#664 → VIGENTE como decisión aplazada; la señal NO ha llegado (2 de 72 hoy, 3 de 72 después)**

Todo lo de abajo está medido hoy sobre `900b5b71`, árbol limpio antes y después (`git diff --stat` vacío).

## El problema real, en una frase

**#665**: no es «dos ficheros no entran en Node»; es que **ninguno de los dos tiene un sujeto que el banco pueda sostener**, así que 72/72 es un número de vanidad.
**#663**: la séptima pareja de ids del título no tiene candado propio, y meterla cuesta un corte de `home.ts`.
**#664**: el cliente no tiene suelo medible, y ponerle uno hoy sería inventárselo.

## La premisa, afirmación por afirmación

| Afirmación del issue | Verificación | Veredicto |
|---|---|---|
| #665: «`import.meta.glob`… **lo usan** `src/main.ts` y `src/world/fixtures-del-selector.ts`» | `grep -rn "import\.meta\.glob" nefan-html/src` → **UNA** ocurrencia, `fixtures-del-selector.ts:24`. `main.ts` no la tiene (`grep "import\.meta" src/main.ts` sale vacío); falla **transitivamente** por su import de la línea 23 | **FALSA** |
| #665: 72 `.ts` no-`.d.ts`, entran 70, y los 2 son ésos | Reproducido importando los 72 con `node --import tsx`: **70 entran, 2 no**, y los dos con el **mismo** mensaje `(intermediate value).glob is not a function` | **CIERTA** (una sola causa, no dos) |
| #665 pto 2: «el día que se resuelva el `glob`, esto vuelve a dar `location is not defined`» | **Medido**: neutralicé el glob (parche temporal, revertido) → `fixtures-del-selector.ts` entra OK; `main.ts` da **`document is not defined`**. Es `main.ts:90` (`document.getElementById("app-shell")`), **once líneas ANTES** del `serviceUrl` de :101 | **FALSA como predicción** |
| #665: el `serviceUrl` del cuerpo es «de dos líneas» y lo que bloquea es el glob | El cuerpo de `main.ts` es la raíz de composición: **11 `document.getElementById` a nivel de módulo**, más `document.addEventListener` (:234), `new FpsRenderer(appShell…)` (:132), `new TitleScreen(…)` (:764). `serviceUrl` es el obstáculo nº 12, no el siguiente | **Alcance MAYOR de lo escrito** |
| #665 implícita: que entren sirve para algo | `nefan-html/test/README.md`: «**Ni vitest ni jsdom: el día que hiciera falta un DOM, el sujeto no es de aquí**». `main.ts` es DOM entero; `crearFixturesDelSelector` hace `document.getElementById("room-selector")` en su cuerpo, y su única pieza pura (`normalizarFixture`) delega en `formatDToWorld`, que core ya prueba. **Ninguno puede ser sujeto del banco.** Y ningún candado exige importabilidad: `el-cliente-no-alcanza-node-ni-a-traves-del-core` prohíbe `node:*`, no exige lo contrario | **El VALOR no existe** |
| #663: `chasis.ts` lee `#ts-sessions` y lo pinta `home.ts` | `chasis.ts:370` `content.querySelector("#ts-sessions") !== null`; `home.ts:130` `<div id="ts-sessions" …>` | **CIERTA** |
| #663: «el test lo cubriría con **el mismo patrón** (comparar la salida de una costura contra la de la otra)» | **Medido**: `CSS_ESTRECHO_DEL_TITULO.includes("ts-sessions")` → **`false`**. El lado del chasis no es un string exportado sino un literal dentro de una función, así que **no hay salida que regexear** y el aserto 1 (anti-tautología) del test de #555 **no tiene análogo**. Y el docblock de ese test prohíbe la salida fácil: «SE COMPARA LA SALIDA, NO EL FUENTE» | **FALSA**; la forma del test es otra (decisión del arquitecto) |
| #663: `home.ts` = 450, tope = 450 | `wc -l` → **450**; `client-file-size.json` `tope: 450`, y `home.ts` **no** está en `excepciones` | **CIERTA** |
| #663/requisitos: «el banco no puede crecer (#663) mientras dos ficheros no entren en Node (#665)» | **Medido**: `node --import tsx` importa `home.ts` (exporta `pintarHome`) y `chasis.ts` **hoy**, sin tocar nada. El test de la 7ª pareja importa esos dos, no `main.ts` | **FALSA — NO hay dependencia** |
| #664: el cliente no tiene cobertura ni entrada en `quality-thresholds.json` | `grep -c nefan-html quality-thresholds.json` → **0** | **CIERTA** |

## Respuestas a las cuatro preguntas del coordinador

**1 · ¿#663 depende de #665?** **No, en absoluto.** Los dos sujetos del test (`chasis.ts`, `home.ts`) entran en Node hoy. El único vínculo es haber salido del mismo §6. **Van en PR separadas, y #663 puede ir primero y sola.**

**2 · ¿Sustituto honesto del `glob`?** La pregunta tiene una premisa que no se sostiene, pero contesto las dos partes. **(a) El tope de `main.ts` NO es la restricción**: el glob vive solo en `fixtures-del-selector.ts`, que mide 209 sobre un tope de 450 — **241 líneas de holgura**. Cualquier sustituto cabe entero ahí sin tocar `main.ts`, y no hay que subir ningún umbral. **(b) Pero el sustituto paga por empeorar**: hoy el glob se deriva del directorio y por construcción **no puede desviarse**; las 3 fixtures de `data/scenes/` y las 35 guiones de `qa/` que llaman `cargarFixture` viven de eso. Cambiarlo por una lista o un censo estático **introduce una deriva que hoy no existe** y obliga a un candado nuevo para sujetarla — y la lección de ocho tandas es que ese candado cubrirá menos de lo que promete. Se paga trabajo, más deuda de candado, para ganar un número que nadie mide.

**3 · ¿Ha llegado la señal de #664?** **No.** Módulos distintos con SUJETO en el banco hoy: **2** de los 72 `.ts` del cliente (`chasis.ts`, `selector-de-mundo.ts`), en 1 fichero de test y 2 asertos. Con #663: **3 de 72**. Y hay un dato nuevo que el issue no tiene: corrí la cobertura (`node --import tsx --test --experimental-test-coverage`) y da **88,89 % líneas / 25,40 % funciones**, sobre una tabla en la que **6 de los ~12 ficheros listados son de `nefan-core`** (`config.ts`, `contracts/service-registry.ts`, `games/style-refs.ts`, `session/{eleccion-de-estilo,gates-de-imagen,pertenencia-del-registro}.ts`), que el lcov de core ya mide. Un suelo sacado de ahí mediría core dos veces y el cliente una: exactamente el umbral inventado que el issue rechaza. **No se implementa. Se pega el número en un comentario y se deja abierto** — es una decisión viva con señal escrita, y cuesta un comentario, no una tanda.

**4 · ¿Qué gana el jugador?** **Nada, directamente, en ninguno de los tres.** #663 es la única que deja algo que se pueda poner rojo. Eso ordena la prioridad: esta tanda va **detrás** de las otras tres de hoy.

## El día después

- Con **#665** hecho: `main.ts` sigue sin poder ser sujeto de nada (el banco no quiere DOM), `fixtures-del-selector.ts` tampoco, y queda un censo estático que alguien tiene que mantener sincronizado con `data/scenes/`. Se borra un `import.meta.glob` que funcionaba. **Nadie borrará** el candado nuevo que haga falta para el censo. Lo que se vuelve más difícil: añadir una fixture pasa de «copiar un JSON» a «copiar un JSON y acordarse del censo».
- Con **#663** hecho: el banco pasa de 1 a 2 tests y de 2 a 3 módulos por sujeto; `home.ts` queda troceado, que es lo que el propio `client-file-size.json` ya prescribe por escrito («al home le toca el corte que a `selector-de-mundo.ts` le tocó… cuando alguien tenga que añadirle una línea»). Dentro de un mes nada de esto parecerá arbitrario.
- Con **#664** cerrado en comentario: se conserva la pregunta con su número; sin él, dentro de dos tandas se decide por acumulación, que es lo que el issue existe para impedir.

## Conflictos

- **Ninguno de fichero con las otras tres tandas de hoy**: la O toca `nefan-html/src/net/game-client.ts`; la P y la Q no tocan `nefan-html` (0 menciones en sus `requisitos.md`). Solo esta tanda nombra `main.ts`/`home.ts`.
- **Corrida de mutación en vuelo**: #663 no toca `nefan-core/src` ni `data/contract` (`home.ts` se queda ≤ 450, así que no hay entrada de excepción que editar). Compatible.
- **Contra una decisión viva**: #665 choca con dos escritas. (1) El `$comment` de `client-file-size.json` para `main.ts`: «**No se trocea más**: hacerlo exige el objeto de contexto de treinta campos que se rechazó dos veces (T3 §4.2; crítica de #358)». Meter el cuerpo de `main.ts` en una función es ese corte. (2) `test/README.md` del banco renuncia al DOM. Entre las dos, **72/72 es inalcanzable por decisión, no por falta de trabajo**.
- **Dato que le falta a #664**: el programa **#241 ya contestó** cómo se mide la lógica del cliente — **moviéndola a core**. `mutation-targets.json` lleva una docena de módulos cuyo texto dice literalmente «vivía en `nefan-html/…` sin una sola medida»; `ui/hablar-con-un-npc.ts` y `world/frontier.ts` **ya no existen en el cliente**. Lo que queda en `nefan-html` y podría necesitar suelo propio es **presentación**, que no puede irse a core. Eso pertenece al cuerpo de #664.

## Coste contra valor

- **#665**: coste medio (sustituto del glob + candado nuevo + riesgo sobre 35 guiones de `qa/`), valor **cero medible**, y su objetivo declarado es inalcanzable. **No hacer nada es la opción correcta.** Si no se hiciera nunca, no pasa nada: el cliente sigue entrando 70/72 y los dos que faltan lo están por lo que son.
- **#663**: coste bajo-medio (un corte de `home.ts` que el contrato ya prescribe + un test), valor real pero **de segundo orden**: #555 clasifica `#ts-sessions` entre las **5 «cubiertas de refilón»** (guion 33), no entre las 6 sin cubrir. Se sube de «lo pilla un guion de navegador por el síntoma» a «lo pilla un unitario por la causa». Vale su precio. Si no se hiciera nunca, el riesgo es que `home.ts` renombre el id y el aviso de corte del chasis mienta con el guion 33 en verde por otra vía.
- **#664**: coste de un comentario. Valor: que la próxima decisión se tome contra un número.

## Qué le cambiaría a `requisitos.md` (redactado para pegarse)

> **#665 — retirado de esta tanda.** Medido el 2026-09-18: `import.meta.glob` está en UN solo fichero (`world/fixtures-del-selector.ts:24`, 209/450 líneas, 241 de holgura); `main.ts` no lo usa y falla por su import. Con el glob neutralizado, `main.ts` da **`document is not defined`** en su línea 90, no `location is not defined`: tiene 11 `getElementById` a nivel de módulo porque es la raíz de composición. Hacerlo importable exige o un DOM (que `test/README.md` descarta) o meter su cuerpo en una función (que el `$comment` de `client-file-size.json` prohíbe por escrito: «No se trocea más»). Y ninguno de los dos ficheros tiene un sujeto que el banco pueda sostener, así que 72/72 no compra nada. **Se cierra #665** pegando esta medida, conservando como nota suelta que `main.ts:101` resuelve `serviceUrl` en el cuerpo del módulo.
>
> **#663 — es la tanda, y va sola.** Medido: `home.ts` y `chasis.ts` **ya entran en Node hoy**, así que **no depende de #665**: una sola PR. Corrección de premisa: **no es «el mismo patrón» que #555** — `CSS_ESTRECHO_DEL_TITULO` **no contiene** `ts-sessions` (el chasis lo lee con `querySelector` dentro de una función, `chasis.ts:370`), así que no hay salida exportada contra la que comparar y el aserto anti-tautología de #555 no tiene análogo. La forma del test la decide el arquitecto, con una sola prohibición heredada del docblock de #555: **no se regexea el fuente**. El umbral **no se sube**: `home.ts` está bajo el tope general (450), no es excepción, así que cortarlo no toca ningún JSON — y el `$comment` del contrato ya dice que a `home.ts` le toca ese corte. El esqueleto a extraer son las 9 líneas de `home.ts:123-131`.
>
> **#664 — no se implementa; se comenta con el número de hoy.** Medido el 2026-09-18: el banco tiene **2 módulos distintos por sujeto de los 72 `.ts` del cliente**; con #663 serán **3 de 72**. La señal («sujetos de varios módulos distintos») **no ha llegado**. Cobertura real medida hoy: 88,89 % líneas / 25,40 % funciones, sobre una tabla en la que 6 de ~12 ficheros son de `nefan-core` y ya los mide el lcov de core — un suelo sacado de ahí mide core dos veces. Añadir al cuerpo: **#241 ya contestó** la pregunta para la lógica (se mueve a core; `ui/hablar-con-un-npc.ts` y `world/frontier.ts` ya no están en el cliente), así que lo que queda por decidir es solo la **presentación**.
