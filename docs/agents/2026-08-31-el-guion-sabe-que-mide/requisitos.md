# Requisitos — El guion sabe qué mide y puede decir ⊘ (#331 + #332)

## Petición del usuario (literal)

La petición de fondo de la serie es:

> «Vamos a seguir priorizando reducir el numero de issues»

Sobre la hoja de ruta aprobada tras el triaje del 2026-08-30, el usuario arrancó esta tanda con:

> «abrelos y pasa a la tanda 2»

(«abrelos» se refiere a los issues #339/#340 de mutación, ya abiertos — NO son de esta tanda.)
La tanda 2 de la hoja de ruta es: **«El guion sabe qué mide y puede decir ⊘» — #331 + #332**,
con los cuerpos ya corregidos por los comentarios de auditoría del 2026-08-30. Desbloquea #261
(que NO entra aquí).

## El problema real (una frase)

Un guion de la batería no puede decir «no pude medir» (solo verde o rojo, y rojo miente sobre
qué está roto), y varios guiones eligen su sujeto —la fixture, la escena, el muro de error— sin
comprobar que es eso lo que quedó puesto: la misma raíz que costó tres cierres en #308.

## Fuentes de verdad

Los DOS issues llevan comentarios de auditoría del 2026-08-30 (sobre `3f6feab`; hoy HEAD es
`8673042`, con la tanda 1 mergeada — verificar si algo se movió) que **corrigen sus cuerpos**.
Leer cuerpo + comentarios:

```bash
gh api repos/alberto-hortelano/ne-fan/issues/331 --jq '.body'
gh api repos/alberto-hortelano/ne-fan/issues/331/comments --jq '.[].body'
# ídem 332
```

Resumen auditado:

### #331 — el canal ⊘ no existe para los guiones

- El veredicto `⊘ SIN MEDIR` solo lo fija el runner, en **cuatro** sitios (`qa/run.mjs:811`
  precondición, `:854` guardarraíl de gasto, `:888` stack caído, `:908` sinMotor — líneas de
  `3f6feab`). El ctx que ve un guion expone `page, name, fallos, log, nefan, waitFor,
  holdUntil, expect, shot` (`run.mjs:645-711`) — no hay `ctx.sinMedir`.
- **El ejemplo motivador del cuerpo es falso** (corregido en el comentario): el `return` del
  guion 34 deja el guion ROJO, no verde-por-omisión (hay un `ctx.expect` justo antes). El
  argumento honesto: un rojo dice «lo que defiendo está roto» cuando lo que pasó es «no pude
  medir» — y esa mentira es la que el canal elimina.
- Pieza extra: `qa/lib/presets-clasifica.mjs:20,31` mantiene una **escala paralela** de
  veredictos con el mismo icono `⊘` (`AJENO`) sin compartir código con `run.mjs`. Quien
  implemente el canal debe unificarlas o distinguir los iconos.

### #332 — los guiones eligen sobre qué miden sin comprobarlo

Cuentas REALES (las del comentario, no las del cuerpo):

1. **12 guiones** con `loadFixture` crudo + espera propia (01, 02, 03, 06, 07, 10, 15, 16, 24,
   25, 30, 32) más **3 scripts** (`presupuesto-de-volumenes.mjs:127`,
   `fixtures-sin-bridge.mjs:116`, `captura-de-fixture.mjs:48`). Los guiones 22, 23 y 44 ya usan
   `qa/lib/fixtures.mjs`, que AFIRMA qué escena quedó puesta. Ninguno muerde hoy por un motivo
   frágil (no cargan dos fixtures sin recargar); el día que uno lo haga hereda #308 entero.
2. **EXCEPCIONES que no se migran**: el guion **44** llama a `loadFixture` crudo A PROPÓSITO
   (`:69`, es el negativo que mide el contrato de la espera) y **24:80** comprueba que RECHAZA.
   Son los negativos de #308: migrarlos borraría la cobertura. El criterio de cierre del cuerpo
   («grep sin llamantes fuera de lib») es imposible tal como está escrito — hay que exceptuar
   los negativos declarados.
3. **`cerrarMuroSiHay` vive en CUATRO guiones** (16:55, 22, 23, 30:49), no dos. Bajo el runner
   hay bridge y ninguno arranca partida, así que el muro no puede estar: medirlo una vez y
   borrarlo o justificarlo con su caso.
4. **UN guion elige fixture por posición**: `25-…:199` (`find(o => o.value)`). El sujeto lo
   decide el orden alfabético del selector (`nefan-html/src/main.ts:794`): añadir una fixture
   cambia lo que mide sin que nadie lo note. Los demás señalados en el cuerpo no lo hacen.
5. Nota aparte del mismo repaso: `qa/presupuesto-de-volumenes.mjs` falla la primera vez contra
   un cliente ya arrancado (vite no reevalúa el glob) — anterior a #330, misma familia («mide
   contra un estado que no comprobó»). Está en el vecindario de esta pasada.

## Criterios de aceptación (deben poder nacer rojos)

1. **`ctx.sinMedir(motivo)` existe**: un guion puede declarar `⊘` a mitad con su motivo; el
   runner lo pinta y lo cuenta APARTE de verdes y rojos (el mismo `⊘` que ya sabe pintar).
   Declarar `sinMedir` **ABORTA el guion** (no se sigue ejecutando ni acumulando fallos
   después): es la forma que #261 podrá invocar desde `waitFor`, a profundidad de pila —
   «marcar y confiar en el return» repetiría el apaño del guion 34. Negativo honesto que hoy
   nace rojo/imposible: un guion con la precondición rota que declara `sinMedir` sale `⊘` con
   su motivo — hoy solo puede salir rojo o verde.
2. **El canal no es una vía de escape**: el motivo es obligatorio, el `⊘` es visible en el
   informe final (no se colapsa con el verde), y la semántica global es la del precedente, que
   NO es ambiguo: `run.mjs:957` sale con **exit 2** ante cualquier `⊘` (más degradante que el
   rojo, exit 1) y `:954` imprime «esta corrida NO es un veredicto del juego» — el `⊘`
   declarado hereda eso, con lo que reconvertir un rojo en `⊘` empeora el exit por
   construcción. Un guion que ya empujó fallos NO puede reconvertirse a `⊘` — nota: esto es
   MÁS estricto que el runner actual, que en `:891`/`:914` guarda `SIN_MEDIR` con `ctx.fallos`
   no vacíos (divergencia deliberada: el ⊘ de un guion es una declaración, no un accidente del
   stack; dejarla escrita en el código).
3. **Una sola escala de veredictos**: la escala paralela de `presets-clasifica.mjs` se unifica
   con la del runner o sus iconos se distinguen — decidido y hecho, no documentado como deuda.
4. **Los 12 guiones y 3 scripts migran a `qa/lib/fixtures.mjs`**; los negativos declarados (44
   y 24:80) se quedan crudos CON su razón escrita en el propio guion. Criterio mecánico de
   cierre: `grep -rn "loadFixture" qa/` solo encuentra `qa/lib/fixtures.mjs` y los sitios
   exceptuados con comentario de negativo. OJO (crítica): el grep de MENCIONES es imposible de
   satisfacer (~8 en comentarios y en las huellas load-bearing de
   `bateria-candados-en-negativo.mjs`); el criterio mide INVOCACIONES:
   `grep -rn 'nefan("loadFixture"\|__nefan.loadFixture(' qa/` solo existe en
   `qa/lib/fixtures.mjs` y en los negativos exceptuados (44 y 24:80).
5. **La migración compra algo, demostrado**: romper el sujeto de al menos un guion migrado
   (fixture equivocada puesta) lo pone ROJO/⊘ — si queda verde pase lo que pase, la migración
   no ha comprado nada (probar en negativo, como pide el cuerpo).
6. **Ningún guion elige su fixture por posición**: el 25 nombra la suya.
7. **`cerrarMuroSiHay` medido una vez**: ¿aparece el muro alguna vez por ese camino bajo el
   runner? Borrado de los cuatro guiones o justificado con el caso escrito.
8. La nota de `presupuesto-de-volumenes.mjs` (primera corrida contra cliente ya arrancado):
   diagnosticada en esta pasada — arreglada si es barata, o issue propio con la medida si no
   (decisión del arquitecto, declarada).
9. `npm run verify` verde; batería completa verde por los mismos motivos (`node qa/run.mjs`);
   deuda sin crecer; PR con `Closes #331` y `Closes #332` (en inglés, uno por línea).

## Fuera de alcance

- **#261** (los 72 catches, 44 de ellos `.catch(() => null)`) — es la tanda siguiente y
  NECESITA este canal; el diseño de `sinMedir` no debe impedir su uso futuro (p. ej. desde
  `waitFor`), pero no se implementa aquí.
- Las otras especies censadas de espera floja (#287 está CERRADO — lo cerró #290; el vecino
  vivo es #261).
- Cambiar la semántica de los `⊘` que el runner ya fija por su cuenta.

## Preguntas abiertas

Ninguna: la semántica del `⊘` la resuelve el precedente (ver criterio 2 — exit 2, «NO es un
veredicto»), sin consulta al usuario. Avisos para el plan, de la crítica: los 3 scripts no
tienen `ctx` (page cruda) — su migración no es un cambio de import; y la frase «no cargan dos
fixtures sin recargar» es falsa para 24 y 32, que no muerden porque sus esperas nombran el
sujeto. El criterio 5 es ejecutable con maquinaria existente (`bateria-candados-en-negativo.mjs`).

## Restricciones operativas

- Rama + PR; el hook `Stop` exige CI verde de la PR (recordar: el CI NO corre la batería de
  `qa/` — la batería se corre y se reporta en local, sin presentarla como si el CI la avalara).
- Cero créditos: la batería usa el preset `e2e-sin-creditos` (fake), como siempre.
- No matar procesos ajenos; `qa/run.mjs` elige bloque de puertos libre solo.
- `gh` 2.4: sin `--json` en `pr checks`; espera de CI con
  `until ! gh pr checks <N> 2>&1 | grep -q "pending"; do sleep 30; done`.
- Tests/guiones obsoletos se borran con el cambio que los deja sin sentido, declarando la
  cobertura perdida.
