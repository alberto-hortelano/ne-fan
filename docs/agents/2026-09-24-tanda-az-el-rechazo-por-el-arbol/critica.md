**#739: VIGENTE, con el alcance corregido (es mayor de lo que dice) · #738: REENCUADRADA. Se funde en #739 y su criterio literal no se construye.**

## El problema real, en una frase

«El bridge rechazó este frame» se lee en cinco sitios con tres reglas distintas. Un cliente nuevo del banco puede tirar el rechazo por tipo y el padrón lo da por bueno, porque lo que mide es que el socket **tenga** oyente, no **qué hace** con el error.
- #739 lo ataca por donde toca: una lectura con dueño y el padrón cerrado a `qa/lib/`.
- #738 lo ataca midiendo con el dial equivocado (ver premisa 5).

## La premisa, afirmación por afirmación

1. **«Tres lecturas distintas del rechazo»: CIERTO, y son cinco sitios.**
   - `el-npc-cruza…mjs:244` y `el-state-api…mjs:214` cortan ante **cualquier** `narrative_status/error`, sin mirar `kind`. Lo ilegible lo rechazan (`:236`, `:209`). El npc además corta con `session_started ok:false` (`:241`).
   - `run.mjs:935` solo corta con `kind === "protocolo"`. Su `JSON.parse` (`:934`) va **fuera** de try: un frame ilegible lanza dentro del manejador en vez de nombrarse.
   - `cable.mjs:109-129` apunta **todo** error con su `kind` y lo ilegible como `ilegible`. Qué para la espera lo decide fuera del oyente (`RECHAZOS_QUE_PARAN`, `:145`).
   - **El que el issue no nombra:** `qa/lib/sesion.mjs:640-650` (`pedirYEsperarTile`) es una copia de la lectura de `cable.mjs`, también dentro de la página. Si se unifica, entra; si no, se deja fuera con su motivo escrito.
2. **«`el-state-api` tiene su propia versión»: CIERTO, y además con el MISMO nombre.** Su función se llama `porElCable` (`el-state-api…mjs:174`), igual que la de `cable.mjs:208` pero con otra semántica. Es la prueba más barata de que la lectura se copia.
3. **«Compartir el predicado con `cable.mjs`»: se puede, pero no con un `import` en los cinco sitios.** Los oyentes de `cable.mjs` y `sesion.mjs` viven dentro de `page.evaluate` (`cable.mjs:98`, `sesion.mjs:634`), se serializan y no ven un `import`. Hoy `cable.mjs` ya pasa los `kind` como dato (`:208`). Cómo se comparte lo decide el arquitecto. Lo que el crítico pone como criterio es que el predicado sea **uno** y tenga **un** test, no que se importe igual en todas partes.
4. **«Las ocho copias de `resumePorElCable` (46, 62, 67, 73, 76, 111, 113, 126)»: CIERTO, verificadas una a una.**
   - Siete son idénticas salvo el `requestId`: `preguntarPorElCable` + `resume_session` → `{ok, error}`.
   - El 111 recibe la marca como argumento (`111…mjs:53`).
   - Ya pasan todas por `cable.mjs`. Es deuda de copia, no de rechazo, y la tarea la etiqueta bien como «menor».
5. **#738, «que el oyente compare `kind` con "protocolo"»: si se construye tal cual, pone en ROJO cuatro de los cinco `todo` correctos.**
   - Solo `run.mjs:935` hace esa comparación literal.
   - `cable.mjs` y `sesion.mjs` apuntan todos los `kind` y deciden fuera del oyente.
   - Los dos clientes Node rechazan cualquier error, que es **más** estricto que lo que se pide.
   - La propiedad que el agujero (2) describe (`clientes-ws-del-banco.json`, fixture en `el-cliente-ws…test.ts:581`) es «el oyente **no descarta** el `phase:"error"`», no «lo compara con `protocolo`».
   - La salida del issue, «o que llame a una función con dueño», no la puede ver el árbol en el código que corre en la página (ver 3).
6. **«Hoy es una declaración»: CIERTO.** Los cinco `todo` están en el padrón y el test solo mide que haya oyente (`el-cliente-ws…test.ts:310-338`).
7. **Los dos clientes Node corren en CI**, en `candados-headless` (`ci.yml:260`, `:266`). Tocarlos se verifica en cada PR y sin navegador.

## El día después

- **Para quien juega:** nada. Es deuda del banco, declarada.
- **Para el banco:**
  - Una sola regla de «rechazado», con test.
  - `new WebSocket` solo bajo `qa/lib/`. Hoy el veto cubre `qa/guiones/**` (`test…:285`); la raíz de `qa/` y `run.mjs` quedarían dentro.
  - El padrón baja de cinco entradas a las de `qa/lib/`.
- **Qué se vuelve más difícil:** escribir un cliente WS de Node ad hoc en la raíz de `qa/`. Es a propósito.
- **Qué hay que borrar y nadie borrará si no se pide:**
  - Las tres entradas de la raíz de `qa/` en el padrón.
  - Las ocho copias de `resumePorElCable`.
  - El `porElCable` local de `el-state-api`.
  - El texto de los agujeros (2) y (4) en `_lo_que_esto_NO_sujeta`, que hay que **reescribir** para que diga lo que queda abierto de verdad. Si no, se queda como documentación falsa.
  - El guion 152 (sabotajes del padrón), que cita los clientes de la raíz.
- **Lo que parecerá arbitrario dentro de un mes:** que un cliente Node, que no tiene página, lleve «cable» en el nombre. Que el nombre diga para qué sirve.

## Conflictos

- **Tanda AY (eslint en `qa/` y `labs/`).** Toca los mismos ficheros: los dos clientes de la raíz y `run.mjs`, con sus `catch { // … }`. No hay contradicción, pero sí choque de diff. Quien fusione en segundo lugar rebasa. Ninguna de las dos tiene que esperar a la otra.
- **#744** (eslint en `labs/**`): no se solapa, esta tanda no toca `labs/`.
- **Con #694 y #678, cerrados:** no los deshace, los continúa. El veto de guiones y la retirada de `una-respuesta` se quedan como están.
- **Dependencia interna:** #738 va **después** de #739, o dentro de ella. Medir el oyente antes de cerrar el padrón mediría cinco sitios de los que tres van a desaparecer.

## Coste contra valor

- **#739:** coste moderado. Son unos seis ficheros del banco y un test, verificables en CI sin créditos. Si no se hace nunca, el siguiente cliente Node copia la lectura que tenga más a mano, y es el patrón que ya produjo los quince colgados mudos de #694. Merece la pena.
- **#738 tal como está escrita:** coste medio y valor negativo, porque da rojos falsos sobre clientes correctos.
- **#738 después de #739:** el agujero se reduce a «un cliente nuevo **en** `qa/lib/`», que el recuento exacto obliga a declarar y que tiene al lado una puerta ya probada. Lo que falte se escribe en `_lo_que_esto_NO_sujeta`. No hace falta otra medida por el árbol.
- «No hacer nada» con #738 vale **solo si** #739 cierra el padrón. Sin eso, el agujero (2) sigue igual de abierto.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

> **Alcance, corregido por la crítica.** #738 se funde en #739 y **no** se construye su criterio literal («el oyente compara `kind` con `"protocolo"`»): pondría en rojo `cable.mjs`, `sesion.mjs` y los dos clientes Node, que leen bien el rechazo. La propiedad que protege el agujero (2) es «el oyente no descarta `phase:"error"`», y la cierra el cierre del padrón a `qa/lib/`.
>
> **Criterios de aceptación.**
> 1. Una sola definición de «el bridge rechazó» (`narrative_status` + `phase:"error"`, con su `kind`; lo ilegible es un rechazo `ilegible`), con dueño en `qa/lib/` y test unitario en `nefan-core/test/`. `cable.mjs` y el cliente Node la **comparten**: una única fuente, aunque el oyente de la página la reciba como dato. `sesion.mjs:pedirYEsperarTile` entra también, o queda fuera con el motivo escrito en el padrón.
> 2. `el-npc-cruza…`, `el-state-api…` y `run.mjs:medirListSessions` hablan con el bridge a través de una función de `qa/lib/` y dejan de tener `new WebSocket`. Ninguno pierde lo que hoy detecta: el `session_started ok:false` del npc, cualquier error de la sesión en los dos candados y el `{rechazo}` inmediato del `--diag`. El `JSON.parse` de `run.mjs` deja de lanzar dentro del manejador.
> 3. El veto pasa de `qa/guiones/**` a «todo `qa/**` salvo `qa/lib/`». Su negativo se prueba en rojo con un socket en la raíz de `qa/`. El padrón queda solo con entradas de `qa/lib/`.
> 4. `reanudarPorElCable(ctx, sessionId, requestId)` en `qa/lib/` sustituye las ocho copias. Cero `function resumePorElCable` en `qa/guiones/`.
> 5. `_lo_que_esto_NO_sujeta` y el guion 152 reescritos para decir lo que queda abierto **después**. En particular, el agujero (2) se reduce a «un `todo` nuevo en `qa/lib/`», y el `it` de `test…:581` se conserva o se ajusta a esa frase.
> 6. Los dos candados de la raíz, verdes en `candados-headless`. `npm test` y `npm run verify` en verde. Cero créditos.
> 7. #738 se cierra desde la PR con este texto: «Absorbida por #739: con el padrón cerrado a `qa/lib/` y la lectura del rechazo con dueño, el criterio literal daría rojos falsos (solo `run.mjs` comparaba `kind` con `protocolo`). Lo que queda abierto está escrito en `_lo_que_esto_NO_sujeta`».
>
> Sin guion nuevo de QA: no hay nada que observe el jugador. Los números 190-193 no se usan salvo que el arquitecto necesite un negativo de navegador.
