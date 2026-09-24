# Requisitos — tanda AP: las esperas del banco leen el error y el rechazo del bridge (#693 #694)

## Petición literal del usuario

> «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

Sesión AUTÓNOMA: lo que haya que preguntar al usuario se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## El issue, verbatim

### #693

> Un viaje que el bridge declara roto quema el cortafuegos entero: los guiones 08, 15 y 74 esperan el tile sin mirar viaje.error
> 
> Sale de la crítica de la tanda V (#677 + #687, 2026-09-18, `docs/agents/2026-09-18-tanda-v-el-presupuesto-del-tile/critica.md`), leyendo el árbol sobre `main` = `a25d8c2f`.
> 
> ## El hecho
> 
> Tres esperas de tile a 240 s —`qa/guiones/08…:106`, `15…:393` y `74…:139`— esperan a que el tile llegue al mundo del cliente **sin mirar `viaje.error`**. Si el bridge declara el viaje roto (los tres desenlaces existen: llegado / fallo / rechazado, y `pedirYEsperarTile` de `qa/lib/sesion.mjs` ya los distingue desde #656), esos tres guiones no paran: consumen el cortafuegos entero y salen rojos por expiración, sin el nombre de la causa.
> 
> Es el defecto MUDO que #656 cerró en los guiones 120 y 127, en el camino del **viaje** en vez del de la petición de tile.
> 
> ## Por qué importa para #677
> 
> Es la razón MEDIBLE por la que un cortafuegos de 240 s cuesta más que uno de 90: no la latencia del tile (que con el motor falso está bajo 2 s), sino los minutos que se queman cuando algo se rompe y nadie mira el estado. La tanda V fija el cortafuegos con esa aritmética; este issue es el que la abarata de verdad.
> 
> ## Lo que hay que hacer
> 
> Que las tres esperas paren por ESTADO (los tres desenlaces) y no solo por llegada, con el helper con dueño que ya existe o su equivalente para el viaje, y un negativo (viaje roto a propósito → ✘ inmediato nombrando la causa, no expiración a los 240 s).
> 
> Relacionado: #656, #677, #687.

### #694

> Quince clientes WS del banco esperan UNA respuesta y descartan el rechazo de intake por tipo: un frame rechazado los cuelga mudos hasta el timeout
> 
> Sale de la crítica de la tanda AF (#678, 2026-09-18, `docs/agents/2026-09-18-tanda-af-el-rechazo-llega-a-alguien/critica.md`), censo por el árbol (nodos `new WebSocket(` bajo `qa/`) sobre `main` = `a25d8c2f`.
> 
> ## El hecho
> 
> De los 20 sitios del banco que abren un WebSocket propio al bridge, **15** esperan UNA respuesta concreta con `contestado` + `onclose → reject`: guiones 46, 62, 67, 73, 76, 85, 87, 92, 106, 111, 113, 126, más `qa/lib/saves.mjs:83`, `qa/lib/sesion.mjs:315` y `qa/run.mjs:866`.
> 
> Cuando el frame que mandan no pasa el contrato, el bridge lo rechaza por UNICAST como `narrative_status/error` (`nefan-core/bridge/ws-server.ts:308-330`) y **no cierra el socket**. Esos 15 clientes descartan el mensaje por tipo (no es el que esperan) y el `evaluate` se queda colgado hasta el timeout: **rojo sin causa**, no verde. Es el mismo canal de #678 con otro síntoma: el rechazo llega y nadie lo lee.
> 
> Hoy es latente (los frames que mandan pasan el zod), pero el día que un contrato cambie, quince guiones dirán «timeout» en vez de «el bridge rechazó el frame por X».
> 
> ## Lo que hay que hacer
> 
> Un helper con dueño en `qa/lib/` para «mando un frame y espero SU respuesta» que trate el `narrative_status/error` de intake como desenlace (rechazo con motivo), y pasar los 15 por él; candado por el árbol (molde: `test/la-consulta-de-movimiento-tiene-dueno.test.ts`) para que no nazca un decimosexto con `new WebSocket(` suelto en un guion. Negativo: un frame con `reason: "nope"` → ✘ inmediato nombrando el rechazo.
> 
> Fuera de alcance: los dos que cierran sin esperar (63:89 y 60:524), que son los de la tanda AF (#678).
> 
> Relacionado: #678, #656, #606.

## Criterios de aceptación

1. (#693) Las esperas de tile de los guiones 08, 15 y 74 (y cualquier otra que el censo de HOY encuentre esperando un viaje) paran por ESTADO —llegado / fallo / rechazado— y no solo por llegada: un viaje roto a propósito da ✘ inmediato nombrando la causa, no expiración a los 240 s (negativo medido con tiempos).
2. (#694) Un helper con dueño en `qa/lib/` para «mando un frame y espero SU respuesta» que trata el `narrative_status/error` de intake como desenlace (rechazo con motivo); los clientes WS del banco que hoy descartan el rechazo por tipo pasan por él (re-censar HOY por el árbol: el issue dice 15).
3. Candado por el árbol para que no nazca un cliente WS suelto nuevo que espere una respuesta sin el helper (molde: `test/la-consulta-de-movimiento-tiene-dueno.test.ts`; revisar si ya existe algo equivalente de la tanda AF, #678, `el-cliente-ws-del-banco-declara-como-escucha`), probado en negativo, con `_lo_que_esto_NO_sujeta` medido. Usar `fuentesDelBanco` (#704) para barrer `qa/`.
4. Negativo de #694: un frame con `reason: "nope"` → ✘ inmediato nombrando el rechazo.
5. Los guiones tocados siguen verdes en la batería (corrida real, no solo tsc).

## Contexto del coordinador

- Worktree `/home/al/code/ne-fan-tanda-ap`, rama `feature/tanda-ap`, nacida de `main` = `95a66594`. Todo el trabajo va ahí.
- Hoy se fusionaron #709 (ruff en verify), #716 (detector de saltos), #700 (anclas), #704 (UN barrido del banco: `nefan-core/test/banco-ficheros.ts` + candado `un-solo-barrido-del-banco` que prohíbe recorrer `qa/` por su cuenta desde `test/`). En vuelo: #697 (reporter de suites que lanzan, PR #726) y #714 (atlas de vecinos). La tanda hermana de esta ola es: AO #711 / AP #693+#694.
- Nunca matar procesos ajenos; `qa/run.mjs` elige bloque libre. Cero créditos (motor falso). Worktree sin node_modules: `npm ci` en nefan-core, narrative-mcp (y nefan-html/qa si hace falta).
- Commits intermedios en la rama. Números de guion reservados: AO 167, AP 168; QA: AO 169, AP 170.

## Fuera de alcance

- Lo que el issue declara fuera. Vecinos que aparezcan: se ANOTAN, no se arreglan.

## Reencuadre del crítico, aceptado por el coordinador (2026-09-23)

**SEPARACIÓN**: esta tanda (AP) hace SOLO #693. #694 se va a la tanda AQ (worktree `/home/al/code/ne-fan-tanda-aq`). De lo de abajo, aquí aplica únicamente lo de #693; lo de #694 es de AQ. Guion reservado AP 168 (QA 170).


Sustituir los criterios 1 a 3 por:

> 1. (#693) Censo de HOY de las esperas de VIAJE (clic en «Salidas» + espera de llegada) que no miran `window.__nefan.viaje.error`: 08:88, 15:381, 74:121, 49:145 y 49:162, 60:214, 65:113 (7 esperas en 6 guiones, no 3). Todas paran por ESTADO (llegado / `viaje.error`) mediante UNA función con dueño en `qa/lib/`, que absorbe también las cuatro copias a mano de `09:85`, `75:229`, `144:155` y `154:139`. El cortafuegos es `MS_DEL_TILE` = 90 s, no 240. Hay que corregir la cabecera de `tile-episodio.mjs:101-110`, que sigue citando 240 s, y los «180 s» de los mensajes de 49 y 60. Negativo con `TILE_MODE=error` del motor falso: ✘ o ⊘ en segundos nombrando `viaje.error`, con el tiempo medido.
> 2. (#694) La espera «mando y espero SU respuesta» vive en `qa/lib/cable.mjs` (la vía que ya declara el padrón), no en un fichero nuevo. El rechazo se reconoce por `narrative_status` + `phase:"error"` + `kind:"protocolo"`: nueve de los quince mandan `start_session`/`resume_session`, que suscriben el socket (`session.ts:492,697`), y les llegan errores difundidos de otros `kind`. Hay que corregir la cabecera de `cable.mjs` que dice «solo puede recibir unicast». `run.mjs:866` es un socket de Node con `null` a los 10 s: se migra por su lado o se exime con motivo.
> 3. Candado: NO se crea un test nuevo. Se amplía `data/contract/clientes-ws-del-banco.json` + `test/el-cliente-ws-del-banco-declara-como-escucha.test.ts`, de modo que `una-respuesta` quede con cero ocupantes (o solo los eximidos con motivo), igual que ya se hace con `nada`. El sabotaje entra en el guion 152 y el `_lo_que_esto_NO_sujeta` (2) se reescribe.
> 4. #693 y #694 van en PR separadas (no comparten fichero, helper ni candado).
