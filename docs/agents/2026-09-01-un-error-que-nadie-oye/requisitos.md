# Requisitos — «Un error que nadie oye» (#365 + #366 + #367 + #236 + #369-R10)

> **LEE PRIMERO el § «Reencuadre tras la crítica» del final.** La crítica midió dos premisas rotas
> —una de ellas cuesta dinero hoy— y el usuario tomó tres decisiones que cambian el alcance. Donde
> este documento y ese § discrepen, **manda el §**.

## Petición del usuario (literal)

> Se ha hecho un analisis de arquitectura y hay nuevos issues, planifica como seguir desde aqui

Del plan que salió de ahí (aprobado el 2026-09-01), el usuario eligió **con qué tanda se abre la
serie** entre cuatro opciones medidas, y respondió:

> **Errores mudos**

La opción que eligió estaba descrita así en la pregunta:

> #365 + #366 + #367 + #236. Borrar una partida puede fallar sin decirlo, `/skin_sprite_sheet` es
> el único endpoint sin Pydantic, el health check de sprite-forge da verde con el repintado muerto,
> y un solo HTTP 500 apaga los skins de la sesión entera. Cuatro issues XS/S en tres capas
> distintas, cero diseño abierto, cada uno con precedente literal en su propio fichero. Cierra 4 —
> es la opción que más baja el contador.

## Por qué estos cuatro juntos

Son **el mismo defecto en cuatro sitios y tres procesos**: algo falla y el canal se lo traga. Es el
hallazgo de fondo de la revisión de arquitectura del 2026-09-01 — *«lo candado se cumple al 100 %,
la prosa al 70-80 %»* — con los cuatro casos que la revisión dejó escritos y sin arreglar.

#367 y #236 además son **los dos extremos de la misma cadena**: sprite-forge arranca en verde con
el repintado muerto → `/skin_sprite_sheet` devuelve 503 → el cliente apaga los skins de la sesión
entera → el jugador ve un mundo de maniquíes `y_bot`. Arreglar uno solo deja la cadena rota por el
otro lado.

## Los cuatro issues, con la medida de HOY (no la del cuerpo)

Verificado contra `main` = `37e74d8` el 2026-09-01. **Donde el issue y la medida discrepan, manda
la medida** y se dice en la PR.

### #365 — «Borrar una partida puede fallar sin decirlo: deleteSession colapsa {ok,error} a boolean»

De la revisión de arquitectura (hallazgo M). Cuerpo:

> `nefan-html/src/net/narrative-client.ts:282-285` (`deleteSession`) devuelve `res.ok` como
> booleano y tira `res.error`; el llamante (`ui/title-screen.ts:570-574`) ignora el booleano y solo
> captura excepciones. Un borrado rechazado por el bridge no dice nada: el jugador cree que borró y
> el save sigue ahí (se nota al siguiente arranque, sin pista de por qué).
>
> El mismo fichero ya documenta y arregla este malentendido exacto para `listGames`
> (`narrative-client.ts:200-204`); este quedó fuera.
>
> Aceptación: `deleteSession` propaga el error (throw o Result) y el título lo enseña; una partida
> que no se pudo borrar no desaparece de la lista.

**Medido hoy**: vigente, citas exactas. **Dato nuevo**: la PR #370 (`4a9c5e1`) aplicó ese mismo
patrón a `listSessions` y **volvió a dejar `deleteSession` fuera**. Ya hay **tres** precedentes del
idioma correcto en el mismo fichero, y las líneas se han desplazado (~287-290).

### #366 — «/skin_sprite_sheet es el único endpoint sin Pydantic»

De la revisión de arquitectura (hallazgo N). Cuerpo:

> `ai_server/routers/remote_generation.py:313-314`: `async def skin_sprite_sheet_endpoint(request:
> Request)` con `body = await request.json()` y seis `str(body.get(...))`. No hay 422 estructurado:
> un campo ausente o mal escrito se convierte en `""` y las validaciones son `HTTPException(400)` a
> mano (:341-344).
>
> Es una violación directa de la convención de CLAUDE.md («Pydantic BaseModel por endpoint para que
> campos ausentes salgan como 422 estructurado») y el ÚNICO endpoint del ai_server que la incumple
> — el resto del proceso es la capa más limpia del repo (70+ HTTPException, cero 200-con-error).
>
> Aceptación: BaseModel para el request (los campos reales que consume: prompt, style_ref,
> model/anim/angle, ai_model…), y el test del adaptador
> (`ai_server/tests/test_sprite_forge_adapter.py`) cubriendo el 422 con un campo ausente.

**Medido hoy**: vigente, citas exactas (`request.json()` en `:339`, los seis `str(body.get(...))`
en `:340-352`, los 400 a mano en `:355` y `:357`). Es el único endpoint con `Request` crudo del ai_server
aparte de `asset_proxy.py`, que es passthrough de bytes y no cuenta.

### #367 — «El health check de sprite-forge da verde con el repintado muerto»

De la revisión de arquitectura (R8+R16). Cuerpo:

> Cadena de detección degradada, cada tramo honesto por separado y el agregado mudo:
>
> 1. sprite-forge corre con el `.venv` de ne-fan (`start.sh:433,443`). Si a ese venv le faltan
>    `rembg`/`fastapi`, sprite-forge arranca igual y publica `skin.enabled:false` en `/catalog`.
> 2. El health check de `start.sh:450` solo comprueba que `GET /catalog` responda 200 — no mira
>    `skin.enabled`. El comentario del propio script (l.431-436) documenta que este fallo exacto ya
>    ocurrió una vez.
> 3. Si el repo ni siquiera está clonado, `start.sh:423-427` imprime un warning y devuelve 0: el
>    stack arranca en verde.
> 4. El jugador descubre el problema tres saltos después: `/skin_sprite_sheet` 503 →
>    `character-sprites.ts:241-246` desactiva los skins de la sesión → mundo de maniquíes y_bot
>    (radio de explosión ya cubierto en #236).
>
> Aceptación: el preflight/health de `start.sh` para el preset que INCLUYE sprite-forge falla (o
> avisa en rojo, decisión de UX) cuando `/catalog` responde con `skin.enabled:false` o el repo no
> está; la causa (`skin.reason` del catálogo) llega al terminal.

**Medido hoy**: los tres tramos vigentes y verificados. **Abaratado**: la PR #371 (`cd53d39`) ya
fijó la forma de `skin.enabled`/`skin.reason` en
`nefan-core/data/contract/fixtures/sprite-forge/catalog.json` y en el zod
`nefan-core/src/contracts/sprite-forge.ts` (`SpriteCatalogSkinSchema`, unión discriminada por
`enabled`) — el parseo del preflight tiene contrato al que agarrarse en vez de inventarse el shape.

### #236 — «Un solo HTTP 500 apaga los skins de la sesión entera»

Cuerpo (extracto):

> `nefan-html/src/character-sprites.ts:222`: el **primer** fallo 5xx generando un skin pone
> `skinsDisabled = true` para **toda la sesión**. […] Un único HTTP 500 se lo lleva por delante: el
> jugador vuelve a ver exactamente el mundo de personajes idénticos (el `y_bot` base) que #173 vino
> a arreglar, y ya no sale de ahí sin recargar.
>
> **Lo que está bien y no hay que tocar**: el fail-loud. Hay toast, y el jugador se entera. El
> problema no es que avise, es el **radio** del cortacircuitos.
>
> Vía sugerida: cortacircuitos **por personaje** (o por (personaje, anim)) en vez de por sesión,
> y/o un reintento acotado.
>
> Criterio de cierre: con el backend devolviendo 500 para UN personaje, el resto de los personajes
> de la sesión siguen pidiendo y recibiendo su skin. Verificable en el bench, que hoy reproduce el
> fallo siempre.

**Medido hoy — el cuerpo tiene una ruta FALSA**: el fichero es
`nefan-html/src/renderer/character-sprites.ts`, no `src/character-sprites.ts` ni `src/scene/`.
Todo lo demás vive: `:145` el flag de sesión, `:183` y `:225` las puertas, `:241-242` el primer 5xx
que apaga la sesión entera. Y **`resetFailureBreaker()` ya existe a medio cablear** (`:163-165`):
tiene **un solo llamante**, `main.ts:420`, y solo en el OFF→ON del menú dev. Nada lo rearma al
entrar en sesión, al reanudar ni al cambiar de escena. No duplicarlo: cablearlo o sustituirlo.

## Criterios de aceptación (los que se verifican)

1. Un borrado de partida **rechazado por el bridge** no hace desaparecer la partida de la lista del
   título, y el jugador ve por qué. Nace rojo: hoy el booleano se descarta.
2. Una petición a `/skin_sprite_sheet` con un campo ausente o mal escrito devuelve **422
   estructurado**, no un `""` que viaja hasta el modelo. Con test en
   `ai_server/tests/test_sprite_forge_adapter.py`.
3. Arrancar un preset que incluye sprite-forge con el repintado muerto (`skin.enabled:false`) o con
   el repo sin clonar **no da verde**: el terminal dice la causa citando `skin.reason`.
4. Con el backend devolviendo 500 para **un** personaje, el resto de los personajes de la sesión
   siguen pidiendo y recibiendo su skin. Verificable en el bench, que hoy reproduce el fallo
   siempre (el motor falso solo tiene hoja `idle` y devuelve 500 en `walk`).
5. Los cuatro criterios anteriores **quedan candados**, no comprobados a mano: donde el idioma del
   repo ya lo permita, haciendo inexpresable el estado malo (`Result`, `BaseModel`, unión
   discriminada) antes que añadiendo un test más.

## Restricciones

- **Cero créditos**: toda verificación va con el preset `e2e-sin-creditos` / el motor falso.
- **No matar servicios ajenos**: hay otras instancias trabajando en esta máquina. Nunca `pkill`;
  usar bloque de puertos libre (`qa/run.mjs` lo elige solo) y `./start.sh --parar` como mucho.
- **Pre-producción**: cero compatibilidad hacia atrás. Lo que se sustituya se borra el mismo día.
- **Fail-loud por capa** (CLAUDE.md): `errors.push` + `Result` en TS/HTML, `narrative_status: error`
  en el bridge, `HTTPException` en Python. Nunca `return null` silencioso.
- El cuerpo de un issue **no es la medida**. Donde discrepe con el código de hoy, manda el código y
  se dice en la PR.
- Se escribe sobre `main` = `37e74d8` (ya sincronizado), no sobre `7aa6000`.

## Preguntas ya contestadas

- *¿Con qué tanda se abre la serie?* → **Errores mudos** (esta).
- *¿#367 falla o avisa en rojo?* → sin decidir por el usuario; el issue lo deja como decisión de UX.
  Es la única decisión abierta de la tanda y la toma el arquitecto, con el criterio de que arrancar
  para jugar y arrancar para un bench sin imágenes no tienen por qué comportarse igual.

## Fuera de alcance

- El troceo del cliente (#358): es la tanda T3 del plan, con alcance ya elegido.
- Los bugs visibles del jugador (#350/#351/#352): tanda T2.
- Cualquier cambio en el radio del prune, en la caché de sprite-forge (#369) o en el contrato del
  wire con sprite-forge (cerrado por #371 y por el merge de sprite-forge#1 hoy).

---

# Reencuadre tras la crítica (2026-09-01) — MANDA SOBRE LO DE ARRIBA

`critica.md` midió las cuatro premisas y encontró **dos rotas**. Lo que sigue las corrige y recoge
las **tres decisiones del usuario**. Nada de esto es opinión: cada afirmación lleva su medida.

## 1 · #367 — el tramo 1 del issue es FALSO, y hoy cuesta dinero

El issue dice que si al venv le faltan `rembg`/`fastapi`, sprite-forge «publica `skin.enabled:false`».
**No lo hace.** Medido dos veces (crítico y coordinador, por separado):

```
$ .venv/bin/python -c "import rembg"                 → ModuleNotFoundError
$ grep -i rembg ai_server/requirements.txt           → nada: nunca estuvo declarado
$ grep -c '^MESHY_API_KEY=.' .env                    → 1  (start.sh:442 la exporta como SPRITE_FORGE_IMAGE_KEY)
$ SPRITE_FORGE_IMAGE_KEY=xxx python -c "…health()"   → {'ok': True, 'enabled': True, …}
```

`/health` (sprite-forge `python/sprite_forge_skin/app.py:90-98`) devuelve `enabled:True` si
`build_client()` no lanza, y eso depende **solo de la clave** (`image_client.py:68-73`). `rembg` se
importa **perezosamente** en `strip_background` (`repaint.py:248`) y se llama en `app.py:201`
**después** de generar la imagen y comprobar el eco — o sea, **después de pagarla**; el fallo sale
como `HTTPException(502)` en `app.py:210`.

**Consecuencia viva**: `./start.sh --preset play` arranca HOY en verde, cobra a Meshy y devuelve
502. El comentario de `start.sh:431-433` que el issue cita como prueba («necesita ESTE venv
(fastapi, uvicorn, **rembg**)») es él mismo falso.

*Dato que abarata el arreglo*: no hay carrera. `serve()` hace `await skinWorker.arrancar()` antes de
`listen()` (`sprite-forge/src/server.mjs:350` vs `:375`), así que el primer `/catalog` 200 ya trae
`skin.enabled` asentado.

**Decisión del coordinador (ingeniería, no política): se arregla el dial.** `skin.enabled` tiene que
decir la verdad sobre lo que promete: con `rembg` ausente, el repintado NO está habilitado —
`enabled:false` + `reason`— y el servicio se niega **antes** de pagar, no después. Vive en
sprite-forge, que es nuestro y cuyo `main` acabamos de reunificar (`sprite-forge#1`, mergeada hoy).
Declarar la dependencia donde toque es parte del arreglo.

**Decisión del usuario (política): AVISA EN ROJO Y DEJA JUGAR.** Con el repintado muerto o el repo
sin clonar, `play` y `cliente-web` **arrancan**, y el terminal dice la causa citando `skin.reason`.
Razón escrita: con el dial arreglado ya no se puede gastar por error, así que no hay motivo para
convertir una dependencia de otro repositorio —opcional y no declarada— en un bloqueo para jugar; y
`qa/presets.mjs` (que arranca los ocho presets) sigue verde en máquinas sin clave. El riesgo
asumido es que un aviso se ignore; lo que costaba dinero ya no está.

## 2 · #365 — no hay `res.error` que propagar: la tarea cruza al protocolo

Dos afirmaciones del issue son falsas:

- «y tira `res.error`» → `SessionDeletedMessage` es exactamente `{type, requestId, ok}`
  (`nefan-core/src/protocol/messages.ts:533-537`). **No hay campo que tirar.**
- «el save sigue ahí, se nota al siguiente arranque» → `renderHome()` (`title-screen.ts:487`)
  reelee la lista del bridge (`:538`): la tarjeta **no desaparece**, reaparece al instante. El daño
  es un **no-op mudo**, no una pérdida fantasma.

Y hay un choque con una decisión de **hoy**: `4a9c5e1` (#370) escribió en `bridge/router.ts:202-204`
que *«`session_deleted` no tiene campo error: `ok:false` es la respuesta honesta y el motivo queda
en el log»*. Además `ok:false` **colapsa dos causas**: `storage.delete` devuelve `false` solo con
ENOENT (`session-storage.ts:153`, «borrar lo que no está: no es un error»), mientras que EACCES o
EBUSY **lanzan** (`:154`) y aterrizan en el mismo `ok:false` sin motivo.

**Decisión del usuario: ENSANCHAR EL WIRE.** `SessionDeletedMessage` gana su motivo, como ya lo
tienen `games_listed` y `sessions_listed` — dos precedentes en el mismo fichero. Deja de colapsar
ENOENT con EACCES y el jugador lee por qué. **Obligación explícita**: corregir el comentario de
`router.ts:202-204` en el mismo commit y decirlo en la PR — una decisión de hoy que se revisa a las
horas se revisa por escrito, no en silencio.

## 3 · #236 — vigente, con dos cosas que el issue no dice

- **Queda un hueco mudo detrás**: el `else if (!backendDown)` de `:247` deja sin mensaje todo 5xx
  posterior al primero. Hoy está tapado porque `:225` corta la cola antes; **quitado el flag de
  sesión, ese hueco pasa a ser el camino normal**. Y `state.failed` (`:236`) seguirá matando en
  silencio y para siempre las anims lazy de ese personaje (`modelFor:271`): ataques, death.
- **El cortacircuitos es además el único fusible de COSTE**: con `rembg` ausente cada petición paga
  la imagen y falla después; hoy se paga una vez por sesión, por-personaje se pagaría N veces. El
  bench no lo vería (el motor falso no cobra). No invalida el issue —el radio por sesión sigue
  siendo el defecto—, pero el arreglo del §1 (negarse antes de pagar) es **requisito previo** para
  ensanchar el radio sin abrir una fuga de dinero.

## 4 · #369-R10 entra en la tanda (decisión del usuario)

`#369-R10` apunta a `start.sh:446-447` (el `exec node bin/sprite-forge.mjs serve`, sin `--cache` ni
`--set`): **la misma función** `start_sprite_forge()` (`:419-452`) que #367 reescribe, líneas
adyacentes. Entra su mitad R10: `start.sh` fija `--cache` y `--set` dentro del árbol que ne-fan
gestiona, en vez de dejar GB de PNG en `~/code/sprite-forge/cache` fuera de todo prune. La otra
mitad (R7, documentar en sprite-forge que subir `version` repaga el arte de los consumidores) se
queda en #369, que **no se cierra** con esta tanda: se comenta lo hecho.

## 5 · El criterio 5 («queda candado») necesita saber qué NO existe

- `nefan-html` **no tiene script `test`** (`package.json:6-11`), el CI solo le corre tsc/lint/build
  (`ci.yml:100-104`) y no entra en mutación. Para el cliente, «candado» = **el tipo** (`Result`,
  unión discriminada) o **un guion de `qa/`**. No hay tercera vía.
- `python-sin-error-con-200` **no cubre lo que pide #366**: prohíbe el 200-con-error, no la falta de
  `BaseModel`. «Pydantic por endpoint» es prosa sin candado.
- **Los dos candados de fail-loud del cliente están en el tope**: `html-sin-catch-silencioso`
  (`max: 4`) 4/4 y `html-sin-promesa-muda` (`max: 7`) 7/7. #236 y #365 **no pueden** meter un catch
  mudo ni un `void promesa` sin ponerse rojos. Y `las-respuestas-de-red-no-se-redefinen-en-linea`
  (severity `error`) aplica directo al cambio de #365.

## 6 · Alcance final de la tanda

Cierra **#365 + #366 + #367 + #236**; comenta y **no cierra** #369 (entra solo R10). Toca cinco
capas: `nefan-html`, `nefan-core` (protocolo), `ai_server`, `start.sh` y **el repo `sprite-forge`**
(el dial de `skin.enabled` + declarar `rembg`), que necesita su propia PR.

## 7 · Lo que la crítica confirma y no hay que volver a discutir

- Los cuatro **sí** forman una tanda: #367 y #236 son los dos extremos de la misma cadena (el 502
  que #236 amortigua es exactamente el que produce el repintado roto que #367 debía detectar), y
  #365/#366 no compiten por ningún fichero con nadie.
- **T3 no rehace nada de esta tanda**: `main.ts:420` cae en `applyRenderModes` (`:390-425`), fuera
  de los cortes de T3 (`addTile` `:878-1148`, `gameLoop` `:1863-2272`) y de `nefanHook`
  (`:552-606`). No se reordena. Sí importa que T3 congela `max-lines` sobre `main.ts` **después**
  de esta tanda.
- Sin conflicto con T2 (#350/#351 viven dentro de `addTile`) ni con #306, que excluye
  explícitamente los errores que responden a una pulsación — la clase de #365.
