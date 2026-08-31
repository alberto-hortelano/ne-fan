# Crítica — El guion sabe qué mide y puede decir ⊘ (#331 + #332)

**Veredicto: VIGENTE (los dos issues), con tres precisiones al requisitos** — y la pregunta
abierta 1 se responde sola: el precedente del runner NO es ambiguo (ver §premisa, punto 3).

## El problema real, en una frase

Un guion no tiene forma de decir «no pude medir» (solo rojo, que miente sobre QUÉ está roto),
y 12 guiones + 3 scripts eligen su sujeto sin afirmar que es el que quedó puesto — la raíz
exacta de #308, que costó tres cierres.

## La premisa, verificada a HEAD (`8673042`)

1. **Los 4 sitios del ⊘** — CIERTO y sin mover: `qa/run.mjs:811` (precondición), `:854`
   (guardarraíl), `:888` (stack caído), `:908` (sinMotor falso); más la cascada `:796`
   (guiones posteriores al stack caído). La tanda 1 solo añadió el guion 46 y dos líneas de
   `qa/README.md`: `run.mjs` intacto, todas las líneas citadas valen.
2. **El ctx no expone `sinMedir`** — CIERTO: `page, name, fallos, log, nefan, waitFor,
   holdUntil, expect, shot` (`run.mjs:645-708`), exactamente lo que dice el requisitos.
3. **El precedente del veredicto global es CLARO, no ambiguo**: `run.mjs:957` —
   `salir(sinMedir > 0 ? 2 : rojos > 0 ? 1 : 0)` — y `:954` imprime «esta corrida NO es un
   veredicto del juego». Un ⊘ degrada la corrida MÁS que un rojo (exit 2 vs 1). Corolario
   doble: (a) no hace falta consultar al usuario — «verde con N ⊘» no existe en el precedente;
   (b) el canal NO puede ser vía de escape a nivel de corrida: reconvertir un rojo en ⊘
   empeora el exit, no lo salva. El riesgo residual es solo visual (`:938` imprime los fallos
   únicamente de los ROJOS), y el criterio 2 lo cierra («fallos empujados → no se
   reconvierte»). Ojo: eso es MÁS estricto que el propio runner, que en `:891` y `:914` guarda
   `SIN_MEDIR` con `ctx.fallos` no vacíos — divergencia correcta (allí los fallos pueden ser
   del cadáver del stack), pero el arquitecto debe saber que existe y escribirla.
4. **Censo de `loadFixture`** — CIERTO al dedillo: 12 guiones (01, 02, 03, 06, 07, 10, 15, 16,
   24, 25, 30, 32) + 3 scripts (`presupuesto-de-volumenes.mjs:127`,
   `fixtures-sin-bridge.mjs:116`, `captura-de-fixture.mjs:48`). El guion 46 (tanda 1) no llama
   a `loadFixture`: el censo no se movió. Los negativos: 44 (`:75`, razón YA escrita en
   `:68-74`) y 24 (`:80`; su razón habrá que escribirla). Una inexactitud menor del requisitos:
   «no cargan dos fixtures sin recargar» es falso para 24 (CONTROL→ROTA→CONTROL) y 32 (bucle
   sobre `FIXTURES`) — no muerden porque sus esperas NOMBRAN el sujeto, no por no recargar. No
   cambia el veredicto; la compra de la migración (regresión del hook → rojo que nombra la
   escena) sigue en pie.
5. **¿La migración cambia lo que miden? (los 12)** — No: todos nombran su fixture (literal o
   const) salvo el 25, que arregla el criterio 6. Dos casos con ojos abiertos: el 06 sirve una
   escena ALTERADA por `route.fulfill` bajo el mismo `scene_id` (la lib afirma id, no
   contenido — vale); el 32 espera con `includes()` y la lib afirma igualdad estricta. Los
   **3 scripts NO tienen ctx** (page cruda de Playwright) y `cargarFixture(ctx, …)` lo exige:
   la migración ahí no es un cambio de import, es un shim o retocar la lib — factible, pero
   que el plan no lo venda como mecánico.
6. **Criterio 5 ejecutable** — SÍ: `qa/bateria-candados-en-negativo.mjs` ya rompe
   `loadFixture` a fire-and-forget y exige rojo que nombre la causa (dos entradas, 22 y 44).
   Añadir un guion migrado a esa batería es el patrón establecido, no maquinaria nueva.
7. **`cerrarMuroSiHay`** — CUATRO ocupantes confirmados (16:55, 22:115, 23:87, 30:49; 8
   llamadas). Su propio comentario dice que el muro aparece «sin bridge (preset
   html-fixtures)»: bajo `run.mjs` siempre hay bridge, ninguno arranca partida y cada guion
   abre página NUEVA (`:821`), así que no hereda estado. El borrado mide algo real: quita
   una llamada que se lee como protección y no protege nada en su único entorno de ejecución.
   El «medirlo una vez» del criterio 7 es la forma honesta de cerrar la duda residual.
8. **Fixture por posición** — UNO: guion 25, `~:199` (`map(o=>o.value).filter(Boolean)[0]`,
   no `find` — misma semántica). El orden lo fija `main.ts:794` (`localeCompare` de la
   etiqueta). CIERTO.
9. **Escala paralela** — CIERTO: `presets-clasifica.mjs:31` (`AJENO` con icono `⊘`); su doc
   (`:19-24`) ya declara en PROSA que es «el mismo que ⊘ SIN MEDIR» — la equivalencia existe,
   solo que no en código. Unificar o distinguir es barato; el criterio 3 está bien.
10. **Nota de presupuesto-de-volumenes** — pertenece a la pasada, no estorba: su `:127` ya se
    migra por el criterio 4, y el mecanismo es verificable (la primera fixture entra por el
    selector, que puebla `import.meta.glob` — `main.ts:785` — y los `perf_*` se escriben en
    runtime: un cliente ya arrancado no los tiene en el glob). El criterio 8 (barato o issue
    propio, decisión declarada) es la forma correcta.

## El día después

Toda la tanda vive en `qa/` (más `presets-clasifica`/`presets` si se unifica): cero código de
producción, cero contratos, y el CI no corre la batería — la demostración es local (batería +
candados en negativo). El informe NO gana una clase de veredicto: las tres ya existen
(`ICONO`, `run.mjs:240`); el canal solo añade un productor. La migración toca ~19 ficheros,
mecánica en los guiones, no en los scripts (punto 5). Lo que se vuelve más delicado: cada
autor de guion tiene un verbo nuevo, y la presión del exit 2 empuja a usarlo poco — que es la
dirección correcta.

## Conflictos

- **#261 (abierto, tanda siguiente)**: necesita el canal desde DENTRO de `waitFor`, o sea a
  profundidad de pila. Un `sinMedir` que solo «marca y confía en que el guion haga return»
  repite el apaño del 34; la forma que compone con #261 es que declarar ABORTE el guion
  (sentinela que el runner clasifica). El requisitos ya lo protege en fuera-de-alcance; los
  criterios no lo exigen — añadirlo (ver abajo).
- **#287 está CERRADO** (lo cerró #290): el requisitos (línea 109) lo cita como «otra tanda»
  viva. Corregir la referencia; el vecino vivo es #261. #247 también cerrado.
- **Tanda 1 / guion 46**: sin `loadFixture`, fuera del censo, `run.mjs` intacto. Sin roce.
- #302 (revalidar fixtures commiteadas) es vecino pero ortogonal: contenido, no carga.

## Coste contra valor

Barato y comprado dos veces: el canal es ~30 líneas de runner con informe ya existente, y la
migración borra 12 esperas copiadas cuya redundancia es hoy la única defensa. No hacerlo deja
la mentira estructural (#331) que #261 convertirá en rojos ilegibles la tanda que viene.

## Qué cambiaría del requisitos (pegar tal cual)

1. Criterio 4, frase del grep: «Criterio mecánico de cierre: las INVOCACIONES
   (`grep -rn 'nefan("loadFixture"\|__nefan.loadFixture(' qa/`) solo existen en
   `qa/lib/fixtures.mjs` y en los negativos exceptuados con su comentario (44 y 24:80).» —
   tal como está, el grep encuentra ~8 menciones en comentarios y en las huellas de
   `bateria-candados-en-negativo.mjs` que ningún commit puede quitar: el mismo defecto que la
   auditoría cazó en el cuerpo del issue.
2. Criterio 1, añadir: «Declarar `sinMedir` ABORTA el guion (no se sigue ejecutando ni
   acumulando fallos después): es la forma que #261 podrá invocar desde `waitFor`.»
3. Pregunta abierta 1: resuelta por precedente — `run.mjs:957` sale con 2 y «NO es un
   veredicto» ante cualquier ⊘; el ⊘ declarado hereda eso. Quitar la consulta al usuario y
   dejar escrita la semántica. Y en línea 109, #287 está cerrado: citar #261 como el vecino.
