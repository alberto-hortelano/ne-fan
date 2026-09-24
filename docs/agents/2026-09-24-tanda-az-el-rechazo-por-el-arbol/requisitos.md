# Requisitos — tanda AZ: El rechazo del bridge se lee igual en todos los clientes WS (#738 #739)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye. Si un issue resulta obsoleto o ya resuelto, se dice con evidencia y se cierra: también cuenta.

## Los issues, verbatim

### #738

> El todo del padrón de clientes WS se mide por el árbol: que el oyente compare kind con «protocolo»
> 
> **«El `todo` del padrón de clientes WS se mide por el árbol»**: que el detector exija que el oyente de un `todo` compare `kind` con `"protocolo"` (o que llame a una función con dueño que lo haga). Hoy es una declaración: agujero (2) de `clientes-ws-del-banco.json`, medido en el `it` «un oyente que TIRA el rechazo por tipo cuenta como oyente». Relacionado: #694, #678.
> 
> Sale de la tanda AQ (#694).

### #739

> Un gemelo de cable.mjs para los clientes WS de Node: tres lecturas distintas del rechazo
> 
> **«Un gemelo de `cable.mjs` para los clientes WS de Node»**: `el-npc-cruza-ai-server-con-role-y-description.mjs`, `el-state-api-no-muta-sin-partida.mjs` y `run.mjs:medirListSessions` tienen tres lecturas distintas del rechazo. Hay que llevarlas a una función con dueño en `qa/lib/` que comparta con `cable.mjs` el predicado del rechazo, y cerrar el padrón a `qa/lib/`.
> 
> Añadido (deuda menor): **`reanudarPorElCable` en `qa/lib/`** para las ocho copias de `resumePorElCable` (46, 62, 67, 73, 76, 111, 113 y 126).
> 
> Sale de la tanda AQ (#694).

## Criterios de aceptación

Los fija el crítico en critica.md a partir de los issues. Mínimos: lógica en nefan-core (el cliente solo pinta); negativos probados en rojo; guion de QA ejecutable si hay algo observable; cero créditos (motor falso, `e2e-sin-creditos`).

## Restricciones

- **Números de guion RESERVADOS para esta tanda: 190-193.** Hay otras tandas en paralelo; no uses otro número.
- Contexto de hoy: `NEFAN_ENTORNO` (#757) decide si lo automático paga arte (desarrollo: solo restaura; el banco mide en producción contra el motor falso).
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node` (v26).

## Criterios reescritos tras la crítica

El coordinador acepta la crítica (`critica.md`): #738 se funde en #739. Estos criterios SUSTITUYEN a los mínimos de arriba donde choquen.

**Alcance, corregido por la crítica.** #738 se funde en #739 y **no** se construye su criterio literal («el oyente compara `kind` con `"protocolo"`»): pondría en rojo `cable.mjs`, `sesion.mjs` y los dos clientes Node, que leen bien el rechazo. La propiedad que protege el agujero (2) es «el oyente no descarta `phase:"error"`», y la cierra el cierre del padrón a `qa/lib/`.

**Criterios de aceptación.**
1. Una sola definición de «el bridge rechazó» (`narrative_status` + `phase:"error"`, con su `kind`; lo ilegible es un rechazo `ilegible`), con dueño en `qa/lib/` y test unitario en `nefan-core/test/`. `cable.mjs` y el cliente Node la **comparten**: una única fuente, aunque el oyente de la página la reciba como dato. `sesion.mjs:pedirYEsperarTile` entra también, o queda fuera con el motivo escrito en el padrón.
2. `el-npc-cruza…`, `el-state-api…` y `run.mjs:medirListSessions` hablan con el bridge a través de una función de `qa/lib/` y dejan de tener `new WebSocket`. Ninguno pierde lo que hoy detecta: el `session_started ok:false` del npc, cualquier error de la sesión en los dos candados y el `{rechazo}` inmediato del `--diag`. El `JSON.parse` de `run.mjs` deja de lanzar dentro del manejador.
3. El veto pasa de `qa/guiones/**` a «todo `qa/**` salvo `qa/lib/`». Su negativo se prueba en rojo con un socket en la raíz de `qa/`. El padrón queda solo con entradas de `qa/lib/`.
4. `reanudarPorElCable(ctx, sessionId, requestId)` en `qa/lib/` sustituye las ocho copias. Cero `function resumePorElCable` en `qa/guiones/`.
5. `_lo_que_esto_NO_sujeta` y el guion 152 reescritos para decir lo que queda abierto **después**. En particular, el agujero (2) se reduce a «un `todo` nuevo en `qa/lib/`», y el `it` de `test…:581` se conserva o se ajusta a esa frase.
6. Los dos candados de la raíz, verdes en `candados-headless`. `npm test` y `npm run verify` en verde. Cero créditos.
7. #738 se cierra desde la PR con este texto: «Absorbida por #739: con el padrón cerrado a `qa/lib/` y la lectura del rechazo con dueño, el criterio literal daría rojos falsos (solo `run.mjs` comparaba `kind` con `protocolo`). Lo que queda abierto está escrito en `_lo_que_esto_NO_sujeta`».

Sin guion nuevo de QA: no hay nada que observe el jugador. Los números 190-193 no se usan salvo que el arquitecto necesite un negativo de navegador.
