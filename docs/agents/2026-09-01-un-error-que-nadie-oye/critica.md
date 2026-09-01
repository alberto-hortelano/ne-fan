# Crítica — «Un error que nadie oye» (#365 · #366 · #367 · #236)

**Veredicto de la tanda: REENCUADRADA.** El defecto común existe y los cuatro forman una tanda de verdad. Pero dos premisas están rotas, y la peor es que **#367, arreglado tal como está escrito, seguiría dando VERDE en esta máquina hoy con el repintado muerto** — y cobrando por ello.

| Issue | Veredicto | En una línea |
|---|---|---|
| #365 | **REENCUADRADA (mayor)** | No hay `res.error` que propagar: cruza a nefan-core y choca con #370, de hoy |
| #366 | **VIGENTE** | Citas corridas ~12 líneas, sustancia intacta. Adelante sin cambios |
| #367 | **REENCUADRADA** | `skin.enabled` no mira `rembg`: mide el dial equivocado |
| #236 | **VIGENTE, con advertencia** | Radio correcto; el cortacircuitos es además el único fusible de coste |

## El problema real, en una frase

No es que falten avisos: es que **en cada capa se mira una señal que no es la que se rompe** — un booleano que colapsa dos causas, un `skin.enabled` que no cubre la dependencia que de verdad falta.

## La premisa, afirmación por afirmación

**#365.** Correcto y verificado: `deleteSession` en `:287-290`, el llamante lo ignora (`title-screen.ts:570-574`), y `listGames` `:198-204` / `listSessions` `:281-284` son el precedente. **Dos afirmaciones son falsas**:

- «y **tira `res.error`**» → `SessionDeletedMessage` es exactamente `{type, requestId, ok}` (`nefan-core/src/protocol/messages.ts:533-537`). **No hay `error` que tirar.**
- «el jugador cree que borró y **el save sigue ahí, se nota al siguiente arranque**» → `renderHome()` (`title-screen.ts:487`) reelee la lista del bridge (`:538 listSessions()`): la tarjeta **no desaparece**, reaparece al instante. El daño es un **no-op mudo**, no pérdida fantasma.

Y lo que cambia el encuadre: `4a9c5e1` (**#370, mergeada hoy**) escribió en `bridge/router.ts:202-204` *«`session_deleted` no tiene campo error: `ok:false` es la respuesta honesta y el motivo queda en el log»*. Además `ok:false` **colapsa dos causas**: `storage.delete` devuelve `false` **solo con ENOENT** (`session-storage.ts:153`, *«borrar lo que no está: no es un error»*), mientras que un EACCES/EBUSY **lanza** (`:154`) y aterriza en el **mismo** `ok:false` sin motivo. La tarea es **mayor** de lo que dice y **no vive donde dice**: es el protocolo en nefan-core, no una línea de cliente.

**#366 — vigente, sin cambios.** Hoy `await request.json()` en `:339` (no :327), los seis `str(body.get(...))` en `:340-352`, los 400 a mano en `:355` y `:357` (no :341-344). **La «medida de hoy» de `requisitos.md` tampoco se remidió aquí**: repite los números del cuerpo corridos. La sustancia aguanta entera; `test_sprite_forge_adapter.py` existe y CI lo corre (`ci.yml:133`).

**#367 — el tramo 1 es falso, y está medido.** Tramos 2 y 3 vigentes (`start.sh:450` solo comprueba el 200; `:423-427` avisa y `return 0`). El tramo 1, no:

```
$ .venv/bin/python -c "from sprite_forge_skin.app import health; print(health())"
{'ok': True, 'enabled': True, 'api': 'meshy', ...}      ← y rembg disponible? False
```

`rembg` **no está** en el venv y **nunca estuvo declarado** (`ai_server/requirements.txt`, 270 B). `skin.enabled` no lo mira: `/health` (sprite-forge `python/sprite_forge_skin/app.py:90-98`) devuelve `enabled:True` si `build_client()` no lanza, y eso depende **solo** de `SPRITE_FORGE_IMAGE_KEY` (`image_client.py:68-73`), presente en `.env`. `rembg` se importa **perezosamente** en `strip_background` (`repaint.py:248`), llamada en `app.py:201` **después de que la imagen ya se haya pagado**. Con el preflight de #367 puesto tal cual, `./start.sh --preset play` **da verde hoy**, cobra la llamada a Meshy y devuelve 500. El comentario de `start.sh:431-433` que el issue cita como prueba («necesita ESTE venv (fastapi, uvicorn, **rembg**)») es él mismo falso. Lo que el issue **sí** cubre: el repo sin clonar y la clave ausente. *Dato que abarata el arreglo*: **no hay carrera** — `serve()` hace `await skinWorker.arrancar()` antes de `listen()` (`src/server.mjs:350` vs `:375`), así que el primer `/catalog` 200 ya trae `skin.enabled` asentado.

**#236 — vigente.** Ruta falsa ya corregida por requisitos.md. Confirmados `:145`, `:183`, `:225`, `:241-242` y `resetFailureBreaker` en `:163-165` con un solo llamante (`main.ts:420`). Añadido: `requestSkin` ya rearma el flag por otras dos vías (`:191`, `:199`, ambas `force` del menú dev).

## El día después

1. **Sí queda algo apagando skins en silencio.** El `else if (!backendDown)` de `:247`: un 5xx con `skinsDisabled` ya en `true` **no entra en ninguna rama — cero mensaje**. Hoy queda tapado porque `:225` corta la cola antes; **quitado el flag de sesión, ese hueco pasa a ser el camino normal**. Y `state.failed` (`:236`) seguirá matando en silencio y para siempre las anims lazy de ese personaje (`modelFor:271`): ataques, death.
2. **El cortacircuitos es también un fusible de COSTE.** Con rembg ausente cada petición paga la imagen y falla después: hoy se paga **una vez por sesión**, por-personaje se pagaría **N**. El bench no lo vería — el motor falso no cobra. No invalida #236; sí dice que su radio no es solo ruido de log.
3. **#367 si FALLA, qué rompe**: solo `play` y `cliente-web` llevan forge (`start.sh:688-697`). **No** toca CI (no corre `start.sh` ni `qa/`), ni `qa/run.mjs` (`e2e-sin-creditos`, forge=0), ni `fixtures-sin-bridge`, ni `sprites-sin-servicio` (arranca forge él mismo con `--sin-skin`, `qa/sprites-sin-servicio.mjs:158`). El **único** candado afectado es `qa/presets.mjs`, que arranca los ocho presets y pondría en rojo esos dos en cualquier máquina sin clave de imagen o sin el repo clonado.
4. **Los dos candados de fail-loud del cliente están HOY EN EL TOPE**: `html-sin-catch-silencioso` (`max: 4`) 4/4 y `html-sin-promesa-muda` (`max: 7`) 7/7. #236 y #365 **no pueden** meter un catch mudo ni un `void promesa` sin ponerse rojos. Y `las-respuestas-de-red-no-se-redefinen-en-linea` (`error`) aplica directo al cambio de #365.
5. **Lo que no hay, y afecta al criterio 5**: `nefan-html` **no tiene script `test`** (`package.json:6-11`), CI solo le corre tsc/lint/build (`ci.yml:100-104`) y no entra en mutación. Y `python-sin-error-con-200` **no cubre lo que pide #366**: prohíbe el 200-con-error, no la falta de `BaseModel` — «Pydantic por endpoint» es prosa sin candado. Para los tres, «queda candado» solo se cumple **con el tipo** o **con un guion de `qa/`**.

## Conflictos

- **#369 × #367 — solapamiento DURO, y `requisitos.md` lo declara fuera de alcance.** #369-R10 apunta a `start.sh:446-447` (el `exec node bin/sprite-forge.mjs serve`, sin `--cache` ni `--set`): **la misma función** `start_sprite_forge()` (`:419-452`) que #367 reescribe, líneas adyacentes. Por separado se paga dos veces y se arriesga un merge sucio en 30 líneas. #369-R7 cuelga además de `remote_generation.py:280` y `:291-310`, el mismo adaptador de #366. O entra el R10 en esta tanda, o se acepta el doble pago por escrito.
- **#365 × #370 — contradicción, de hoy.** #370 decidió que `session_deleted` no lleva `error`; #365 pide que el motivo llegue al jugador. Hay que decidir si se ensancha `SessionDeletedMessage` en nefan-core o si el jugador solo ve «no se pudo». Lo que **no** cabe es el arreglo de una línea que el issue insinúa.
- **T3 no rehace nada de esta tanda.** `main.ts:420` cae en `applyRenderModes` (`:390-425`), fuera de los cortes de T3 (`addTile` `:878-1148`, `gameLoop` `:1863-2272`) y de `nefanHook` (`:552-606`); el troceo de `title-screen.ts` es **#346, aparcado**. **No conviene reordenar** — pero sí importa que la entrega 1 de T3 congela `max-lines` sobre `main.ts`: ese número se fija **después** de T1.
- Sin conflicto con T2 (#350/#351 viven dentro de `addTile`) ni con #306, que excluye explícitamente los errores que responden a una pulsación — la clase de #365.
- **¿Dos tandas metidas a la fuerza? No.** #367 y #236 son de verdad la misma cadena, y la medida de hoy lo refuerza: el 500 que #236 amortigua es *exactamente* el que produce el repintado roto que #367 debía detectar. #365 y #366 no son de esa cadena, pero son XS, están en capas que nadie más toca esta semana y no compiten por ningún fichero. Se sostiene.

## Coste contra valor

Barata y bien elegida. #366 es puro beneficio y el más barato. #236 es el que más ve el jugador. #367 es el de mayor valor **si se le arregla la premisa**: tal como está escrito paga trabajo por un verde que sigue mintiendo, y un gate que nace verde enseña a ignorarlo — peor que no hacerlo. #365 es el más caro por línea (cruza al protocolo) y el menos urgente ahora que sabemos que la tarjeta no desaparece. **No hacer nada** solo es defendible en #365.

## La decisión abierta (#367): ¿falla o avisa?

**La frontera está mal puesta: no es del arquitecto.** «Falla» convierte una dependencia de otro repositorio, opcional y no declarada en ningún `requirements`, en un bloqueo del arranque de los dos presets con los que se juega, y pone en rojo `qa/presets.mjs` en cualquier máquina sin clave. Eso es una política sobre el dinero y sobre cuándo se puede jugar, no una elección de UX interna. **Que la decida el usuario**, con los datos del §día después 3 delante.

## Qué le cambiaría a `requisitos.md` — redactado para pegarse

1. **#365**: *«El wire no tiene campo `error` (`messages.ts:533-537`) y `router.ts:202-204` (#370, hoy) decidió que no lo tenga. `renderHome()` reelee la lista, así que la tarjeta NO desaparece: el daño es un no-op mudo. El arreglo toca el protocolo en nefan-core y hay que resolver el choque con #370 antes de diseñar.»*
2. **#367**: *«Tramo 1 FALSO: falta `rembg` y `skin.enabled` sigue siendo `true` (medido: `/health` → `enabled:True` con rembg ausente; perezoso en `repaint.py:248`, usado en `app.py:201` DESPUÉS de pagar). `skin.enabled` cubre el repo sin clonar y la clave ausente, no una dependencia Python que falte. Si la aceptación se queda en `skin.enabled`, decir que no cubre el fallo vivo aquí.»*
3. **#366**: corregir a `:339`, `:340-352`, `:355/:357`.
4. **Criterio 5**: *«`nefan-html` no tiene tests ni mutación, y `python-sin-error-con-200` no cubre la falta de `BaseModel`: el candado es el tipo o un guion de `qa/`. Los topes de `html-sin-catch-silencioso` (4/4) y `html-sin-promesa-muda` (7/7) están llenos.»*
5. **#236**: añadir *«el `else if (!backendDown)` de `:247` deja mudo todo 5xx posterior al primero, y el cortacircuitos es hoy el único fusible de coste.»*
6. **Fuera de alcance**: sacar #369 o justificar el doble pago — su R10 edita la misma función que #367.
7. Mover *«¿#367 falla o avisa?»* de «lo decide el arquitecto» a **pregunta abierta para el usuario**.
