# Crítica — tanda AE (#611) · 2026-09-18 · `main` = `a25d8c2f`

**REENCUADRADA.** El problema es real y la elección es **DERIVAR**, pero no como «derivar o caducar»: se deriva **por CLASE de sujeto** con evidencia positiva en el predicado, y la única exención que ninguna clase cubre —la que se exime **por issue**— se sujeta con el **estado del issue**, no con una fecha. Y esa vía ya tiene un cadáver delante: la exención del guion 80 está agotada por sus propios términos desde el 2026-09-16 y sigue viva. La tarea es un poco MAYOR de lo que dice (una exención honesta se va hoy) y más pequeña en el hermano (dos clases de cuatro son derivables; una no lo es y se dice).

## El problema real, en una frase

Una exención afirma «el sujeto de esta espera no es el mundo» y hoy nada comprueba esa afirmación contra el código; la forma del texto está agotada (medido: 7 pass · 0 fail con la mentira elaborada, `implementacion-6.md` §13.5, N17b).

## La premisa, afirmación por afirmación

| Afirmación del issue / requisitos | Verificación |
|---|---|
| Las exenciones piden `sujeto`, `porque` ≥ 120, proceso o issue nombrado, ≥ 20 palabras distintas, sin tiradas | Cierto: `test/esperas-que-conducen.test.ts:54-90`. El test sigue en **7 pass · 0 fail** hoy |
| No cierra la mentira elaborada | Cierto y reproducible: la mentira de N17b era el 58 (`{sim:120}` → `{ms:120_000}`, `58:181-186`) con `sujeto` «el bridge». Su predicado lee **`window.__nefan.frontier.proposal`**, que escribe el cliente en `Frontera.tick` (`nefan-core/src/scene/frontera.ts:106,184`), no el bridge. Un test que mire QUÉ LEE el predicado la caza |
| «El predicado tiene que tocar algo de ese proceso» es decidible con el AST | **Sí, y la maquinaria ya existe en el contrato hermano**: `contadorDeFotogramas` recorre el subárbol del predicado buscando `PropertyAccessExpression` (`espera-de-fotogramas-con-dueno.test.ts:107-121`) y `funcionesDelFichero` + `contadorDelArgumento` siguen el predicado pasado POR REFERENCIA (`:88-103`, `:169-177`). Es exactamente lo que hace falta para la 6ª exención del 133, cuyo predicado es la constante `TRAZA` (`133:99-105`) |
| Las seis exenciones honestas de hoy pasarían una derivación por clase | Cinco sí: 05 y 42 leen `window.__nefan.scene` (`05:237`, `42:207`; la escena la instala `carga-de-tile.ts:145,169` desde el wire del bridge, `:159-160`) → clase **bridge**. 43 devuelve `dialogue().visible` (`43:205`) → clase **motor**. 133a lee `reloj()` (`133:310`) y 133b lee `reloj()` vía `TRAZA` (`133:101`) → clase **game loop**. La regla tiene que ser «toca algo del proceso nombrado», NO «no toca el mundo»: `TRAZA` también lee `state().pos` (`133:100`) y es honesta |
| La sexta (guion 80) | Lee `playerPos` (`80:119`): sujeto = el mundo, como ella misma declara. Se exime «hasta que #496/#497 se cierren» y «porque el fichero tiene que quedar byte a byte igual». **#496 cerrado el 09-16 14:47, #497 el 09-16 13:22, #545 el 09-16**; y el 80 se ha tocado dos veces desde entonces (`59a3d765`, `b7b20650`). Su `{ ms: 15_000, tecla: "up" }` (`80:122`) sigue ahí. Exención agotada por sus propios términos, dos días viva: ninguna forma del texto lo vio, y una caducidad a 30 días tampoco lo habría visto todavía |
| «La misma enfermedad en el contrato hermano» (#673 sin citar) | Cierto y ya parcheado en el texto (`esperas-por-fotogramas.json`, exención del 15). Su zod solo pide `porque.min(80)` (`:71`): está DOS vueltas por detrás del de conducen |
| #610 midió que «el eje del predicado» da 28 sitios legítimos | Cierto, pero era la regla NEGATIVA sobre el DETECTOR (marcar más esperas). Lo de aquí es la regla POSITIVA sobre las EXENCIONES (juzgar las que ya existen): no amplía el censo ni un sitio, así que no reabre #610 |

## Por qué derivar y no caducar

- Caducar no pone la mentira en rojo (criterio 3 lo admite: «queda con fecha»). Con el usuario ausente y agentes cerrando issues, renovar una fecha es un `sed`: convierte una mentira permanente en una mentira con calendario, y el coste lo pagan las doce exenciones honestas.
- Una fecha pone `npm test` rojo **sin diff**, en un día que no es de nadie: es el rojo de `main` que nadie mira (el de `candados-headless`, un día entero). La casa ya dijo que un candado que nace rojo se aprende a ignorar.
- La derivación tiene ya su vocabulario en el propio `_comment` del contrato («un `fetch`, un `status()`, estado que solo escribe el bridge») y su técnica en el fichero de al lado. Tres clases bastan hoy: bridge (`scene`), motor (`dialogue()`), game loop (`reloj()`/`fps()`); cada nombre tiene que EXISTIR en `nefan-html/src/dev/nefan-hook.ts` (`:130,316,317,348`) o el mapa miente.
- Donde caducar tendría sitio —la vía por issue— hay algo mejor y más barato que una fecha: **que el issue citado esté abierto**. Eso no se puede preguntar desde `npm test` sin red, sí desde `candados-headless` (corre en CI con `gh`). Cómo se reparte es del arquitecto; lo que no debe hacerse es sustituir el estado del issue por una fecha cuando el estado se puede leer.

## El día después

- Para quien juega: nada. Es deuda declarada del banco (#545), y se dice.
- Se vuelve más difícil: eximir una espera cuyo sujeto es un proceso que el mapa no conoce (habrá que añadir la clase con su lectura del hook). Es la fricción buscada.
- Habría que borrar y quizá nadie borre: la regex de proceso y el listón de veinte palabras distintas sobre `porque` (`:67-90`) quedan como cinturón sobre tirantes; el requisito dice «más forma no», pero no dice si la que hay se retira. Que el arquitecto decida y lo escriba, no que se acumule.
- Lo que se puede tirar hoy: la exención del 80 (agotada) — o se reescribe con el issue que hoy la sostiene, si existe, o el 80 pasa a `{sim}` y la exención muere. Criterio 4 ya lo preveía.
- Parecerá arbitrario en un mes: el mapa clase → lecturas del hook, si vive dentro del test. Va en el contrato, junto a `_lo_que_esto_NO_sujeta`, que hoy **no existe** en ninguno de los dos JSON (está diluido en `_comment`); el patrón con zod obligatorio ya está en `sondas-de-movimiento.json`.

## Conflictos

- **#686** (sondas: nombres vs llamadas): la derivación por lecturas del predicado hereda el mismo agujero por alias — `const s = window.__nefan.scene` fuera del predicado y `s.scene_id` dentro sale sin clase. Hoy no hay ninguna así en las seis; se declara y se mide, no se cierra.
- **#677** (once presupuestos de tile): 05 y 42 no están en su lista, pero son esperas del mismo sujeto. Sin conflicto: unificar el número no toca la clase.
- **#673** abierto: es la única exención por issue del hermano; la vía por estado del issue la sujeta también.
- **#610** cerrado como obsoleto con la advertencia «no abrir una segunda cola de exenciones antes de #611»: esto no abre cola nueva. Sin conflicto.
- Ninguna de las otras 13 tandas de hoy nombra estos contratos ni el 133/80 (grep en `docs/agents/2026-09-18-*/requisitos.md`).

## Coste contra valor

Coste: un helper de lectura de predicado que ya está escrito al lado, un mapa de tres clases, un campo `clase` en doce entradas, y la retirada o reescritura de la exención del 80. Sin producción tocada, sin mutación. Valor: la mentira medida (N17b) se pone roja, y una exención agotada que lleva dos días viva sale hoy. «No hacer nada» deja doce exenciones que solo mira la revisión del diff, con una ya falsa como prueba de que esa revisión no llega.

Lo que la derivación **no** cierra, para `_lo_que_esto_NO_sujeta`: un predicado que lee `reloj()` sin usarlo (lectura muerta) pasa; el alias de #686 pasa; y la clase (1) del hermano («el contador ES el sujeto») no es derivable porque su forma es idéntica al molde que se prohíbe — ahí solo queda el motivo escrito, y se dice.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

> **Decisión (crítica):** DERIVAR, por clase de sujeto. Cada exención declara `clase` ∈ {bridge, motor, game loop, issue} y el test comprueba que el PREDICADO de esa espera (inline o por referencia a una función del fichero, como ya hace `espera-de-fotogramas-con-dueno.test.ts`) lee algo de esa clase: bridge → `scene`; motor → `dialogue()`; game loop → `reloj()`/`fps()`. Cada nombre del mapa debe existir en `nefan-html/src/dev/nefan-hook.ts`. La regla es POSITIVA («toca algo del proceso nombrado»), nunca «no toca el mundo»: `TRAZA` del 133 lee `state().pos` y es honesta. La clase `issue` exige número, y su comprobación es que el issue esté ABIERTO, no una fecha; dónde corre (unitario vs `candados-headless`) lo decide el arquitecto. **No se añade caducidad.**
>
> **Criterio 4, concretado:** la exención del guion 80 está agotada (#496, #497 y #545 cerrados el 2026-09-16; el fichero tocado en `59a3d765` y `b7b20650`): o el 80 pasa a `{sim}` y la exención se borra, o se reescribe con el issue vivo que hoy la sostenga.
>
> **Criterio 2, acotado para `esperas-por-fotogramas.json`:** clases derivables: «cortafuegos mayor» (el presupuesto del sitio > `CORTAFUEGOS_MS` de `qa/lib/fotogramas.mjs:83`; el 69 lleva `30_000`, `69:305`) y «conducida en sim» (`{sim}` presente; `142:19`); vía issue (#673, guion 15); la clase «el contador es el sujeto» NO es derivable y queda declarada. Su zod sube al mismo listón que el de conducen.
>
> **Criterio 5:** `_lo_que_esto_NO_sujeta` como clave zod obligatoria en los DOS contratos (patrón de `sondas-de-movimiento.json`), con al menos: lectura muerta, alias fuera del predicado (#686), clase no derivable del hermano; cada uno con su caso medido.
>
> **Fuera de alcance, añadido:** retirar o no la regex de proceso y las veinte palabras de `porque` es decisión del arquitecto y se escribe; no se deja acumulada.
