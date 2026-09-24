**REENCUADRADA** — los dos problemas son reales, pero #693 es MAYOR de lo que dice (6 guiones, no 3) y más barato por cuelgue (90 s, no 240); #694 es exacto en su censo pero su candado ya existe y hay que ampliarlo, no duplicarlo. Y juntarlos no ahorra nada: no son el mismo canal.

## El problema real

Cuando el bridge ya ha dicho «no» (viaje abortado / frame rechazado), el banco sigue esperando y sale rojo o ⊘ por expiración, sin nombrar la causa.

## La premisa, afirmación por afirmación

**#693**
- «08, 15 y 74 esperan sin mirar `viaje.error`» — cierto: `08-viaje-a-place-sin-realizar.mjs:88-107`, `15-guardia-se-ve-y-se-comporta.mjs:381-395`, `74-el-jugador-aparece-dentro-del-lugar.mjs:121-141`. Ninguna lee `window.__nefan.viaje.error`.
- «…y solo esos» — FALSO. Con el mismo patrón (clic en `travel-exit` + `waitFor(…, MS_DEL_TILE)` sin mirar el error) están también `49-…:145` y `:162`, `60-…:214` y `65-…:113`. Son **6 guiones y 7 esperas**. El 49 y el 60 envuelven la espera en `absorbe`, así que un viaje roto sale ⊘ «no llegó en 180 s» (y ese número ya no es verdad).
- «cortafuegos de 240 s» — caducado. `qa/lib/tile-episodio.mjs:130` → `MS_DEL_TILE = 90_000` (#677 ya se cerró). El cuelgue cuesta 90 s por espera, no 4 min. La propia cabecera, `tile-episodio.mjs:101-110`, cita este issue con sus números viejos.
- «el helper con dueño que ya existe» — `pedirYEsperarTile` (`sesion.mjs:641`) es para el tile que se PIDE, no para el viaje. Para el viaje no hay helper: hay **cuatro copias a mano** del mismo `if (v && v.error) return { __roto }`, en `09:85`, `75:229`, `144:155` y `154:139`, cada una con su propia forma de lanzar.
- `viaje.error` existe y lo escribe el cliente (`nefan-html/src/ui/travel-ledger.ts:29,76`). El negativo se puede hacer: el motor falso trae `TILE_MODE=error` (`labs/narrative/fake-ai-server.ts:289,322`).

**#694**
- «15 clientes `una-respuesta`» — cierto, y ya declarados uno por uno en `nefan-core/data/contract/clientes-ws-del-banco.json` (12 guiones + `saves.mjs:83` + `sesion.mjs:323` + `run.mjs:866`).
- «el bridge rechaza por unicast y no cierra» — cierto: `nefan-core/bridge/ws-server.ts:308-330`, `kind:"protocolo"`, `return` sin `close`.
- «hace falta un helper nuevo en `qa/lib/`» — a medias. `qa/lib/cable.mjs` ya abre el socket, recoge los rechazos y no deja cerrar antes de tiempo (`porElCable`, :122). Lo que le falta es una salida del tipo «espera ESTE tipo de respuesta, o el rechazo». El padrón ya señala esa vía: `_lo_que_esto_NO_sujeta` (2) dice «la vía es `cable.mjs`».
- «candado nuevo, con molde en `la-consulta-de-movimiento-tiene-dueno`» — ya existe uno para este mismo sujeto: `test/el-cliente-ws-del-banco-declara-como-escucha.test.ts` cuenta EXACTO todo `new WebSocket` de `qa/**` y lo sabotea en negativo el guion 152. Un decimosexto cliente ya sale rojo si no se declara. El agujero real es otro: se le puede declarar `una-respuesta` y queda permitido.
- Hay algo que el issue no ve. `start_session` y `resume_session` SUSCRIBEN el socket (`bridge/handlers/session.ts:492,697`), y 9 de los 15 mandan uno de los dos. A esos sockets les llegan difusiones, entre ellas `narrative_status/error` de otros `kind` (`tile`, `scene`…). Un rechazo de intake se reconoce por `kind:"protocolo"`, no solo por `phase:"error"`. La cabecera de `cable.mjs` («este socket no manda `subscribe`… solo puede recibir unicast») es falsa para esos frames.
- `run.mjs:866` (`medirListSessions`) es un socket de NODE, no de la página, y su contrato es devolver `null` a los 10 s. No encaja en un helper que vive en la página: hay que migrarlo aparte o eximirlo con motivo en el padrón.

## El día después

- Para quien juega no cambia nada; es deuda del banco declarada. Lo que cambia es el rojo: nombra la causa y llega en menos de 2 s, no a los 90.
- Si el helper del viaje no absorbe las cuatro copias, quedan 11 esperas de viaje con tres formas distintas de mirar el error. Absorberlas es lo que hace que la próxima espera nazca bien.
- Si #694 añade un test aparte, en `test/` quedan dos padrones del mismo `new WebSocket`, con dos detectores que pueden discrepar. Eso es lo que no debe hacerse.

## Conflictos

- **Juntar #693 y #694:** no comparten canal (uno es el ledger del cliente en `page.evaluate`, el otro un socket propio), ni helper, ni candado, ni un solo fichero: los guiones de uno y otro no se cruzan. Juntos dan una PR con dos mitades independientes y una QA que valida dos cosas. **Mejor en dos PR**, que pueden ir en paralelo. Si se quedan en una tanda, al menos con criterios y commits separados.
- **#673** (el guion 15 falla 4 de 21 en su espera por fotogramas) toca el mismo guion. No es la misma espera, pero un rojo nuevo del 15 durante esta tanda no se debe atribuir a este cambio sin mirar #673.
- **#678 (tanda AF):** hay que mantener el padrón y el guion 152. Si `una-respuesta` pasa a cero ocupantes, el 152 y el test cambian con él.
- Nada en `CLAUDE.md` ni en `arch-rules.json` se opone.

## Coste contra valor

Las dos son baratas. #693: siete esperas y cuatro copias a un helper. #694: una función en `cable.mjs`, quince migraciones mecánicas y ampliar un zod existente. El valor es el que dicen los issues. Si no se hicieran nunca, el banco seguiría sano mientras nada falle, y el día que falle pagaría 90 s mudos por espera más el diagnóstico. Merece la pena, pero no hace falta un candado nuevo para cada mitad.

## Qué le cambiaría a `requisitos.md` (para pegar)

Sustituir los criterios 1 a 3 por:

> 1. (#693) Censo de HOY de las esperas de VIAJE (clic en «Salidas» + espera de llegada) que no miran `window.__nefan.viaje.error`: 08:88, 15:381, 74:121, 49:145 y 49:162, 60:214, 65:113 (7 esperas en 6 guiones, no 3). Todas paran por ESTADO (llegado / `viaje.error`) mediante UNA función con dueño en `qa/lib/`, que absorbe también las cuatro copias a mano de `09:85`, `75:229`, `144:155` y `154:139`. El cortafuegos es `MS_DEL_TILE` = 90 s, no 240. Hay que corregir la cabecera de `tile-episodio.mjs:101-110`, que sigue citando 240 s, y los «180 s» de los mensajes de 49 y 60. Negativo con `TILE_MODE=error` del motor falso: ✘ o ⊘ en segundos nombrando `viaje.error`, con el tiempo medido.
> 2. (#694) La espera «mando y espero SU respuesta» vive en `qa/lib/cable.mjs` (la vía que ya declara el padrón), no en un fichero nuevo. El rechazo se reconoce por `narrative_status` + `phase:"error"` + `kind:"protocolo"`: nueve de los quince mandan `start_session`/`resume_session`, que suscriben el socket (`session.ts:492,697`), y les llegan errores difundidos de otros `kind`. Hay que corregir la cabecera de `cable.mjs` que dice «solo puede recibir unicast». `run.mjs:866` es un socket de Node con `null` a los 10 s: se migra por su lado o se exime con motivo.
> 3. Candado: NO se crea un test nuevo. Se amplía `data/contract/clientes-ws-del-banco.json` + `test/el-cliente-ws-del-banco-declara-como-escucha.test.ts`, de modo que `una-respuesta` quede con cero ocupantes (o solo los eximidos con motivo), igual que ya se hace con `nada`. El sabotaje entra en el guion 152 y el `_lo_que_esto_NO_sujeta` (2) se reescribe.
> 4. #693 y #694 van en PR separadas (no comparten fichero, helper ni candado).
