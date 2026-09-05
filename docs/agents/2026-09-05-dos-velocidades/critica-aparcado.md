# PR-2 de #439 («lo aparcado se declara») — crítica sobre `main` = `a93ff9c`

**REENCUADRADA: la PR-2 no se hace. `aparcado` compra 0 s de reloj de pared y ~5 % de minutos de runner a cambio de un campo de contrato, un descuento en la selección y un contador; lo que de verdad sigue forzando corridas completas es otro forzador del mismo tipo que los tres de #404 —el fichero borrado—, y #439 se cierra con lo fusionado más un criterio reescrito en cifras.**

## 1 · El problema real, en una frase

Una PR que no toca el instrumento ni la escena tiene que medirse en minutos sin que nadie autorice nada más que un clic. Hoy eso ya ocurre **cuando el tag está fresco**; lo que sigue disparando la completa no es la falta de un alcance declarado, sino dos forzadores derivables y una tanda que tocó el instrumento.

## 2 · La premisa de la PR-2, afirmación por afirmación (medido hoy, huella de `4747917`, `segundosDe` = máximo por módulo)

| Afirmación del plan §4 | Medido | Veredicto |
|---|---|---|
| aparcar `plugins-dsl` y `enemy-ai` ahorra reloj | 640 s + 28 s = **668 s de 12.353 (5,4 %)** | cierto, y es de **runner**, no de pared (ver §3) |
| `combat-resolver` y `hostiles` no se aparcan: 28 s, un superviviente | 27 s + 3 s = 30 s; vivos 0 y 1 (`mutacion-huella.json`) | cierto |
| `plugins-dsl` 820 s / 406 vivos; `enemy-ai` 38 s / 145 vivos | **640 s** / 406 vivos; **28 s** / 145 vivos, break 32 | cifras de la huella anterior; la conclusión no cambia |
| una PR de núcleo típica: «RÁPIDO — 6 módulos · 340 s · 1 lote» | #456 (State API): **14 módulos · 4.333 s · 3 lotes**; #457: 14; #459: 14 · 6.826 s | **falso por 4×**: `src/contracts/http.ts`, `request-schemas.ts` y `narrative-state.ts` están en el cierre de runtime de 13-14 módulos, `plugins-dsl` incluido |
| `aparcado` sería una clave nueva que el selector no vería | #445 cerró justo eso: partición total de claves, `.strict()` en `ModuloSchema` (`mutation-plan.ts:80`) | la premisa de «heredar el candado de totalidad» ya no aporta nada |

## 3 · El día después de la PR-2

- **Reloj de pared: cero.** La corrida va en matriz y su pared es el lote más caro (`tope_lote` 1.800 s, o `scene-validate` 2.510 s cuando entra). `plugins-dsl` (640 s) nunca es el camino crítico: quitarlo de #456 baja 4.333 → 3.693 s de runner y sigue dando **3 lotes** (`lotes --ids` sin él: 637+440+429+212+… > 1.800). El usuario espera lo mismo.
- **Lo que se congela es deuda visible hoy**: `enemy-ai` con break 32 y 145 vivos, `plugins-dsl` con 406. `npm run deuda` los lista; con `aparcado` seguirían listados pero sin remedir, y `plugins-dsl` seguiría en el cierre de `http.ts`: un cambio de núcleo que altere la suerte de un mutante suyo no se vería.
- **Coste que sí se paga**: campo en el contrato + su rama en `comparaObjetivos` (hoy compara la definición entera: añadir o quitar `aparcado` seleccionaría el módulo, que es lo contrario de lo que se quiere) + descuento en `seleccionDesdeElTag` + contador de commits en `pendiente` y `deuda` + candado «solo se aparca lo medido». Cinco piezas para 668 s de runner al día.
- Dentro de un mes parecerá arbitrario que `enemy-ai` (28 s) esté aparcado «por reloj» y `combat-resolver` (27 s) no.

## 4 · Criterio de cierre de #439, contra el código

1. **«`pendiente` y `lotes` distinguen los dos alcances».** `pendiente` imprime «Se medirían N de 42» y añade «(COMPLETA…)» solo con `todos` (`mutacion.ts:420-428`); `lotes` imprime N lotes y segundos (`:912-930`). Distinguen por número; no imprimen la palabra RÁPIDO ni `pendiente` da segundos ni lotes. Si se quiere el rótulo es una línea derivada de lo que ya calculan, no una lista ni un campo.
2. **«Una PR de solo núcleo selecciona lo suyo y se mide en minutos».** Once PR reales posteriores a #445: #455, #454, #447 → NADA; #470 → 1; #456, #457, #459 → 14; #458 → 23 (97,9 % del reloj: tocó `terrain-collision.ts`); #460 → 26; **#448 → los 42 solo por `scripts/gate-snapshots.ts` borrado**; #449 → los 42 por `package.json`. «Minutos» = 30 de pared (3 lotes en paralelo) y 72 de runner. Se cumple en la medida en que el diff lo permite; el techo es el fan-out de `http.ts`, que es un hecho del grafo y no del selector.
3. **«Ninguna tanda vuelve a esperar una corrida».** T13 cerró siete issues el 05-09 entre las 15:38 y las 16:26 (`gh api issues/405…453`) con el tag en `7b817b9` (02-09) y la última huella del 04-09. Cumplido de hecho.

## 5 · La tanda actual (42/42, once motivos) — cuál es defecto y cuál no

- **Instrumento (7)**: `afectado.ts`, `mutacion.ts`, `mutate.ts`, `mutation-plan.ts`, `mutacion-huella.ts`, `package.json`, `stryker.config.json`. Legítimos: #445/#446/#449 tocaron la medida. Es la R3 del plan.
- **«desaparece del plan `status-labels`» (1)**: `comparaObjetivos` (`afectado.ts:645-655`) fuerza la completa porque «lo que mutaban puede haberse quedado sin dueño». Pero eso ya lo reclama el candado de totalidad de `test/mutation-config.test.ts:137` en el plan de después: si el fichero siguiera existiendo sin dueño, `npm test` estaría rojo. Derivable; se ha disparado una vez.
- **«ya no está en el árbol» (3)**: `status-labels.ts` (#433), `solo-surface.ts` (#416), `gate-snapshots.ts` (#448). `efectoDeFuente` (`afectado.ts:251-260`) devuelve `todos` sin mirar nada. **Es un forzador del tipo de #404**: la respuesta se deriva. Medido: los importadores de los tres en la revisión anterior (`git grep` en `451d8bb^`, `81a7ce0^`, `78e3d92^`) están **todos en el mismo diff** —tienen que estarlo, o el árbol no compila— y ya seleccionan sus módulos. Contrafactual de #448 sin el borrado (`afectado --ficheros`): **9 módulos** en vez de 42, y `test/scene-fixtures.test.ts`, único importador, ya selecciona `contrato-escena` y `scene-validate`. El propio candado lo confiesa: «Borrar un fichero cambia a quien lo importaba» (`test/afectado.test.ts:188`). Frecuencia: 6 de 87 commits desde el 25-08 borran o renombran un `.ts` de nefan-core; con la regla «lo que se sustituye se borra el mismo día», seguirá pasando. #448 pagó una completa entera (12.353 s) solo por esto: **18× lo que compra aparcar**.

## 6 · Conflictos

- **#441** (`scene-validate` 2.510 s, único módulo sobre el tope): es el camino crítico de toda corrida que lo incluya (#458, #459, #460, la T13 entera → **8 lotes, pared 42 min en vez de 30**). Compra 710 s de **pared** por corrida; la PR-2 compra 0. Prioridad invertida respecto al plan.
- **#443** (tap-runner): la única palanca sobre el 80 % de escena/blueprint. Si se adopta, el reparto del reloj cambia entero y cualquier rótulo o aparcado de hoy queda medido sobre cifras muertas.
- **#442 / #444** (huecos del selector: directorio por parámetro, ruta concatenada): el forzador «borrado» es de su familia —un descarte o un forzado que la derivación podría contestar— y debería figurar junto a ellos, no en #439.
- **#436 / #437**: el rótulo RÁPIDO/PROFUNDO saldría de `segundosDe`, que tiene candado en 1 de 4 eslabones. Si el rótulo se pone, se apoya en una cifra sin candado; otro motivo para no vestirlo de contrato.
- **#445 pisa la PR-2**: la partición total de claves que QA exigió hace que `aparcado` **seleccione** al añadirse y quitarse (`comparaObjetivos`), así que la PR-2 tendría que abrir una excepción en el propio comparador que #445 acaba de cerrar.

## 7 · Coste contra valor

No hacer la PR-2 cuesta 668 s de runner por corrida que incluya `plugins-dsl` (cinco de las once PR de T13) y 0 s de espera humana. Hacerla cuesta cinco piezas de instrumento y una excepción en el comparador. Tratar el forzador «borrado» como derivado cuesta una rama en `efectoDeFuente` y su test, y habría ahorrado una completa esta misma semana.

## 8 · Qué cambiaría — para pegar tal cual

**En `requisitos.md`, sustituir el párrafo «Del plan queda solo su PR-2» por:**

> La PR-2 (`aparcado`) **se retira**: medido sobre `4747917`, aparcar `plugins-dsl` y `enemy-ai` compra 668 s de runner (5,4 %) y **0 s de pared** —ninguno de los dos es nunca el lote crítico— y obliga a una excepción en `comparaObjetivos`, que #445 acaba de hacer total. El forzador que sí sigue costando completas es «ya no está en el árbol» (`afectado.ts:251`): #448 pagó los 42 módulos solo por `scripts/gate-snapshots.ts`, cuando sus importadores ya seleccionaban 9. Va a issue propio, de la familia de #442/#444, con el contrafactual como evidencia.

**En #439, criterio de cierre reescrito (y cerrarlo con #445 + #446):**

> `pendiente` y `lotes` dicen cuántos módulos, cuántos segundos y cuántos lotes selecciona el diff desde el tag, y nombran cada fichero que fuerza la completa. Comprobado sobre PR reales: #455 → nada, #456 → 14 módulos · 3 lotes, #470 → 1, #448 → completa (motivo: fichero borrado; issue aparte). Las tandas se cierran sin esperar corrida (T13, 05-09).

**Issue nuevo (no diseño, solo criterio):** «Un fuente borrado fuerza la corrida completa aunque sus importadores estén en el diff y ya seleccionen». Criterio falsable: `afectado --rango 78e3d92^..78e3d92` deja de decir los 42 y dice los 9 del contrafactual; un borrado cuyo importador NO esté en el diff (imposible si compila; posible con un `import()` por cadena) sigue forzando, y hay candado en negativo de las dos cosas.

**Lo que NO debe hacerse**: ni el campo `aparcado`, ni el contador de commits, ni una lista `rapido:/profundo:`. Si se quiere la palabra RÁPIDO en `pendiente`, es una línea derivada y no toca contrato.
