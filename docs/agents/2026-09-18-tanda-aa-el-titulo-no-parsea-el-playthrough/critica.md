# REENCUADRADA

El mecanismo que describe #224 está vivo tal cual, pero la tarea compra un número de banco: el único
corpus donde los 150 ms existen es uno sembrado a mano, y el «problema de fondo» que la ha mantenido
abierta tres reencuadres (`saves/` sin techo) murió cuando el banco pasó a disco efímero. Lo que hay que
hacer con #224 es **cerrarla con el número**, o —si se quiere quitar el mecanismo por higiene— hacerla
con tres condiciones que `requisitos.md` no trae y que son las que la harían fallar en QA.

## El problema real, en una frase

`list()` paga el TAMAÑO del playthrough de cada save (parse entero para ocho campos), y hoy nadie que
juegue tiene un corpus donde ese coste se note.

## La premisa, afirmación por afirmación

- **«`list()` parsea el `state.json` entero, en serie, por save»** — CIERTO: `src/narrative/session-storage.ts:175-178`
  llama a `this.read(name)` en un `for`, y `read` hace `JSON.parse(text)` del fichero completo (`:81,:87`).
- **«Para ocho campos»** — CIERTO (`:188-195`), y **los ocho tienen consumidor**: `nefan-html/src/ui/tarjeta-de-partida.ts:102`
  (`game_id`, `session_id`), `:103` (`summary`), `:104` (`updated_at`, `scene_count`, `entity_count`), `:59-61`
  (`render_mode`, `character_mode`). No hay campo que recortar; el parseo del prefijo sigue muerto porque
  los dos contadores salen del cuerpo (`:192-193`) y `toSessionData` los serializa al final (`narrative-state.ts:1067-1084`).
- **«`GET /sessions/asset_refs` parsea dos veces»** — CIERTO: `bridge/state-http/session-routes.ts:32-35`. Pero de
  `list()` solo usa `meta.session_id`: el criterio 3 no es un requisito aparte, cae solo con cualquier
  arreglo del 1 (o con un `readdir`), y conviene que el arquitecto no lo construya como pieza propia.
- **«Es la keep-list de la poda, riesgo sobre el arte»** (hilo del 08-27) — la keep-list sí (`services/asset-store/prune.ts:36`),
  el riesgo NO: la poda solo la dispara `ai_server` al arrancar (`ai_server/main.py:84-87`, best-effort), con 3 s de
  presupuesto (`prune.ts:21`) y **si la keep-list falla la poda se ABORTA** (`http-server.ts:134-137`). El doble
  parseo no puede borrar arte; a ~1,2 ms/save (list+read, del desglose del 09-17) haría falta un corpus del
  orden de 2.000 saves para que la poda deje de correr, y aun entonces en el sentido seguro.
- **«149,7 ms con 202 saves; paralelizar no arregla»** — es la medida del issue, sembrada en scratchpad; no la
  repito. **`saves/` tiene hoy 0 directorios** tras un día de 14 tandas en paralelo, porque el banco escribe en
  disco efímero (`qa/run.mjs:325,496` → `NEFAN_SAVES_DIR`, que `bridge/ws-server.ts:59` honra, y `qa/run.mjs:794`
  lo borra por corrida). Los «58 MB tras una tarde» eran el banco ANTES de eso. Un jugador con 20 partidas
  paga ~15 ms a 0,74 ms/save.
- **«Índice aparte = segunda fuente de verdad frente a "el bridge es el único escritor"»** (crítica del 08-23) —
  NO se sostiene como objeción si la cabecera la deriva el **almacén** del mismo `SessionData` que está
  escribiendo. Pero ojo, el requisito dice «escrita por el escritor único en la misma transacción de `save()`» y
  eso es **falso como enunciado**: hay DOS caminos de escritura, `NarrativeState.save()` → `write()`
  (`narrative-state.ts:729`) y `handleSetRenderMode` → `writeExisting()` (`bridge/handlers/session.ts:849`), y el
  segundo cambia tres de los ocho campos (`render_mode`/`character_mode`/`updated_at`). Una cabecera puesta en
  `save()` se queda vieja justo en los badges del título. Lo que sí queda de la objeción: dos ficheros son dos
  `rename`, y un corte entre ambos deja cabecera ≠ save; de ahí que «se reconstruye y el lector lo tolera» sea
  la condición real, no un adorno.
- **#430**: cierto que `session-storage.ts` está fuera de la mutación (`mutation-targets.json:982`, 16 baterías) y
  que es el fichero que saca `src/narrative` de `core-puro-sin-node` (`mutation-targets.json:17`). Todo lo que se
  escriba ahí nace sin medida de mutación. La derivación de los ocho campos está DUPLICADA verbatim en Fs y
  Memory (`:185-195` ≡ `:233-243`): si se toca, esa copia doble no debería sobrevivir.

## El día después

- **Para quien juega: nada medible.** Con ≤ 20 saves el título pasa de ~15 ms a ~0. La única vía por la que
  esto se volvería visible es un playthrough LARGO (un `state.json` de varios MB por `scenes_loaded`/
  `dialogue_history`); nadie ha medido uno, y no hay evidencia de que exista.
- **Se vuelve más difícil**: cada sitio que fabrica o edita un save en disco tiene que mantener la cabecera.
  Hoy son `qa/lib/saves.mjs:167-190` (`clonarSaves`, que copia `state.json` y REESCRIBE el `session_id`
  interior; lo usan seis guiones: 33, 34, 52, 98, 101, 122) y los guiones que sabotean el `state.json` a mano
  (25, 90, 113, 126). Sin esto, doce tarjetas con el mismo id —exactamente lo que el docblock de `clonarSaves`
  dice que rompe los botones—.
- **Lo que nadie borrará**: la copia de la derivación en `MemorySessionStorage`, y el diag `medirListSessions`
  de `qa/run.mjs:864`, que seguirá midiendo un número que ya no depende de nada.
- **Lo que mantiene viva la tarea**: el título «200 ms». Tres lecturas distintas (08-23, 08-27, 09-17) han dicho
  que el corpus es de banco, y las tres volvieron a `list()` porque el mecanismo es feo. Feo no es lento.

## Conflictos

- **#430**: no bloquea, pero el ingeniero no podrá medir lo que escriba en `session-storage.ts`; si el arquitecto
  saca la derivación de metadatos a un módulo puro, esa parte entra en el perímetro hoy. Decisión (a)/(b) sigue
  siendo del usuario, como dice `requisitos.md`.
- **Tanda AE (#611)** toca `esperas-que-conducen.json`, no `mutation-targets.json`: sin roce. Ninguna otra
  tanda de hoy toca `session-storage.ts`, `session.ts` ni `qa/lib/saves.mjs`.
- **#417** (pin permanente del arte de personaje, `futuro`) comparte la keep-list; ni depende ni choca.

## Coste contra valor

Coste: un fichero con 18 tests importándolo y sin mutación, dos caminos de escritura, `qa/lib/saves.mjs`, diez
guiones que tocan el disco del save, y un test de coherencia cabecera↔save. Valor: ~130 ms en un banco de 202
saves; ~0 para el jugador; ~150 ms una vez por arranque de `ai_server` en la keep-list, con 3 s de margen.
**No hacer nada** no le quita nada a nadie hoy: el coste crece a 0,74 ms por partida guardada y la única
consecuencia dura (la poda deja de correr) queda a miles de saves y falla hacia el lado seguro.

## «`saves/` no tiene techo», ¿sigue siendo el fondo?

**No.** Su evidencia (58 MB en una tarde) era el banco escribiendo en el `saves/` del repo, y el banco ya no
lo hace. Un techo sobre las partidas del JUGADOR es una decisión de producto sin dolor medido detrás:
apuntarla como nota, no elevarla a pregunta hoy.

## Qué le cambiaría a `requisitos.md`

> **Reencuadre (crítico, 2026-09-18).** El título de #224 describe un corpus de banco; `saves/` tiene 0
> directorios y el banco escribe en disco efímero (`qa/run.mjs:325`). Salida por defecto: **cerrar #224 con el
> número** (0,74 ms/save; ≤ 20 partidas = ~15 ms; keep-list con 3 s de margen y poda que aborta, no borra).
> Si se decide quitar el mecanismo igualmente, los criterios pasan a ser: (1) la cabecera la produce el
> ALMACÉN (`FsSessionStorage`) para los dos caminos de escritura —`write()` y `writeExisting()` (`session.ts:849`)—,
> no `NarrativeState.save()`; (2) el lector tolera cabecera ausente o vieja reconstruyéndola del save, con test
> que lo demuestre en NEGATIVO (cabecera borrada, cabecera con `updated_at` anterior al save); (3) `clonarSaves`
> (`qa/lib/saves.mjs`) y los guiones que editan `state.json` a mano siguen verdes —33, 34, 52, 98, 101, 122 y
> 25, 90, 113, 126 se corren aislados antes de la completa—; (4) la derivación de los ocho campos vive UNA vez;
> (5) la medida se hace con el mismo sembrado del 09-17 y se dice que es de banco. Queda fuera el techo de
> `saves/`: premisa muerta, se apunta como nota de producto.
