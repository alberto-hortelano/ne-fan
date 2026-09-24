# QA — tanda BG: una fixture no hereda los plugins (#368)

Validado contra `requisitos.md` (decisión del usuario: «Sí, solo #368»: F9 en los dos sitios + renombre F7; F6 ya hecho) y el diff sin commitear de `feature/tanda-bg`, en el flujo real (`qa/run.mjs` → preset `e2e-sin-creditos`, motor falso, **cero créditos**: el censo de gasto de cada corrida da `puertas: —`).

## Criterios

| Criterio (de #368 y del triaje) | Veredicto | Evidencia |
|---|---|---|
| F9a · Tras la pre-generación (`generate_game`) el bridge se queda sin plugins | ✅ cumple | Guion **210** bloque 1: `pre-generación: en vuelo 043a4598 (904 muestras) · al terminar ∅ · sesión «»`; `/health.has_session:false`; `GET /plugins` → `[]`. Negativo: sin el `vaciarPluginsActivos` del `finally` → `en vuelo 043a4598 · al terminar 043a4598`, rojo SOLO ese aserto |
| F9a' · …y sus records también (segunda vuelta): `plugin_inspect` no ve los de la efímera | ✅ cumple | 210 bloque 1: `inspect(043a4598)` → `400 … plugin desconocido`. Negativo: sin `this.plugins = []` en `descartarProvisional` → `400 … no tiene manifest disponible` (la respuesta de antes), rojo |
| F9b · `load_room` (selector «Room») no hereda los plugins de la partida | ✅ cumple | 210 bloque 3: F5 → «✕ Cerrar (modo fixtures)» → `robledo_tile`: `/health` sigue diciendo `1790275933-bb64bb` y `/plugins` → `[]`. Negativo: sin el `vaciarPluginsActivos` de `handleLoadRoom` → `200 043a4598`, rojo SOLO ese aserto |
| F9c · Volver a la partida devuelve sus plugins | ✅ cumple | 210 bloque 4: reanudar → mismos ids que antes de la fixture (`043a4598 → 043a4598`) |
| F9d · Una pestaña ajena no le quita los plugins a la partida viva | ✅ cumple | 210 bloque 5: `load_room` por otro socket (cable) con la página dueña del mundo → `/plugins` sin cambio, `/health` igual, la página sigue en `tile_0_0`. También `test/bridge-session.test.ts` («un load_room ajeno…» + aserto `size === 3`) |
| F9e · Takeover durante la pre-generación: el cierre de la efímera no vacía la partida nueva | ✅ cumple (test) | `test/game-gen.test.ts` «si un takeover sustituyó la sesión…»: registry 3 y records 3 tras el `finally`. El vaciado está DENTRO del `if (session_id === sessionId)` (leído en `sesion-efimera.ts:87-90`). No reproducible por el jugador en el banco (exige que otra partida entre mientras el motor falso genera, ~2 s) |
| F7 · Renombre `getPluginRecord`/`resolvePluginRecord` sin rastros | ✅ cumple | `grep -rnE '\b(getPluginRecord\|resolvePluginRecord)\b'` en todo el repo (sin `node_modules`, `dist`, `.git`, `.venv`, `docs/agents`) → solo `arch-rules.json` (el patrón y su `why`). Nombres nuevos con doc que dice la pregunta que contesta cada uno (`narrative-state.ts:925-950`) |
| F7' · Candado de reaparición de los nombres viejos | ✅ cumple | Negativo propio: `// state.resolvePluginRecord(id)` en `qa/guiones/211-*.mjs` → `test/architecture.test.ts` pass 109 · fail 1 nombrando `211-…mjs:103 — patrón prohibido`. Restaurado (md5) |
| F6 · `slice_size_hint` | ✅ ya hecho (#394) | No forma parte del diff; el campo está en `campos-retirados-no-vuelven` |
| State API `/plugins` dice la verdad en cada estado | ⚠️ con una excepción | Arranque sin partida ✅ · pre-gen en vuelo (lista los de la efímera, que SÍ están activos) ✅ · partida ✅ · fixture encima de la partida ✅ · reanudada ✅ · **partida activa BORRADA ❌** (hallazgo 1) |
| Baterías | ✅ | `npm test` (nefan-core) `tests 3485 · pass 3485 · fail 0` con los dos guiones nuevos en el árbol; `npm run lint` (incluye `lint:qa`) limpio |

Guiones: `qa/guiones/210-los-plugins-del-bridge-son-de-la-partida-y-de-nadie-mas.mjs` (**verde**, 3 negativos probados) y `qa/guiones/211-borrar-la-partida-activa-se-lleva-sus-plugins.mjs` (**nace rojo**, es el hallazgo 1). Filas en `qa/README.md`. Capturas: `qa/capturas/2026-09-24T18-52-08-718Z-1030859/`.

## Hallazgos

### 1 · Importante — borrar la partida ACTIVA deja sus plugins huérfanos (el tercer camino)

`handleDeleteSession` → `NarrativeState.deleteSession` suelta la identidad (#365) y nadie vacía `ctx.activePlugins` ni `narrative.plugins`. Es la única de las tres formas de quedarse sin partida que tiene botón en la UI («Borrar» en la tarjeta del título).

Repro (guion 211, desde el arranque): partida nueva → Comenzar → F5 (título delante, `/health` sigue con la partida) → `delete_session` de esa partida (el botón «Borrar» de su tarjeta; el guion lo manda por el cable porque el `confirm()` bloquea al harness) →
- `/health` → `has_session:false` ✅
- `GET /plugins` → `200 [economy 043a4598…]` ❌ (esperado `[]`: «sin partida no hay sistemas», que es la misma frase que justifica F9a)
- `GET /plugins/043a…/inspect` → `200` con el slice de una partida que ya no existe ❌

Lo que ve el motor narrativo: `plugin_list`/`plugin_inspect` contestan con los sistemas de un save borrado; una fixture cargada después SÍ los vacía (F9b), así que el residuo dura hasta el siguiente `load_room`/`start`/`resume`. Fuera del texto literal de #368 (que nombra `load_room` y la efímera), pero es la pregunta adversarial del coordinador y la respuesta es sí. Arreglo obvio: `vaciarPluginsActivos(ctx)` en `handleDeleteSession` cuando `outcome === "deleted"` y era la activa, y `deleteSession` vaciando `plugins` como hace `descartarProvisional`.

### 2 · Menor — durante la fixture, `plugin_inspect` de un sistema de la partida contesta «no tiene manifest disponible»

Observado en el 210 (bloque 3, línea `inspect(043a4598…) durante la fixture → 400 … plugin 'economy' (…) no tiene manifest disponible para inspeccionar`). La partida existe (records en `narrative.plugins`), el registry está vacío por diseño, y el mensaje sugiere corrupción («no tiene manifest») en vez de decir el estado real («el mundo es una escena de prueba; los sistemas de la partida vuelven con `resume_session`»). Es la consecuencia natural de vaciar solo el registry en `load_room` (correcto: los records son el save y no se tocan). Decisión de diseño, no bug de #368; se deja escrita para que nadie la lea como «se perdió el manifest».

### 3 · Menor — con la partida y la fixture en la MISMA página, los `plugin_event` del motor caen en silencio

Camino: partida viva → selector «Room» encima (el que recorre el guion 149, sin F5) → el cliente conserva su sesión y el motor puede seguir contestando (`narrative_respond`, agenda, `npc_*`). Un `plugin_event` de esa respuesta llega a `runPluginTick` con `activePlugins` vacío: `unknown_plugin` → `console.warn` del bridge y el turno sigue; el jugador no recibe nada. Antes de #368 esos eventos SÍ se aplicaban a la partida desde una escena de prueba (peor: un tenderete de fixture moviendo la economía del save). No probado en vivo: el motor falso no emite `plugin_event`. Coherente con el diseño («una escena de prueba no es la partida de nadie»); apuntado como el precio que se paga.

### Sin hallazgos en

- **Takeover / dos pestañas**: la pestaña que no tiene el mundo no purga (F9d medido); la que sí lo tiene y hace F5 suelta el mundo (`release`) sin tocar plugins, así que otra pestaña puede cargar una fixture y purgarlos, y el resume los re-ata desde el save (F9c medido). No hay forma de que el vaciado alcance a una partida que OTRO socket está conduciendo.
- **Fallo a medias en la efímera**: el `finally` corre también si `cuerpo` lanza (F9a). El único hueco es que `descartarProvisional` lance por `en_disco` antes de llegar a `vaciarPluginsActivos` — inalcanzable: `establecer()` solo lo dispara `session_entered` con el id de la sesión vigente, y el cliente nunca conoce el id de la efímera.
- **`plugin_register` sobre una fixture**: exige `session_id` (`register.ts:71`), y en modo fixtures sin partida no la hay. Con partida + fixture encima (hallazgo 3) sí entraría y escribiría `active.set(...)` — es el mismo régimen del hallazgo 3, mismo veredicto.

## Workarounds usados

- **Ninguno sobre el juego**: todo por el camino del jugador (título → «Generar mundo» / Comenzar / F5 / «✕ Cerrar (modo fixtures)» / selector «Room» / Reanudar) y el State API tal como lo lee el motor.
- **Entorno del worktree** (no es código ni evidencia): faltaban las hojas de sprites (arte gitignorado; el runner se niega a medir sin ellas) → copiadas de `../ne-fan/nefan-html/public/sprites`; y `qa/node_modules` (`npm ci` en `qa/`). Los dos gitignorados; `git status` limpio salvo lo de la tanda y los tres ficheros de QA.
- El guion 211 borra por el cable en vez de por el botón «Borrar» (el `confirm()` nativo bloquea Playwright; patrón del guion 18). Misma ruta del router.

## No probado

- Gasto real de créditos: nada de esta tanda toca imagen; el banco corre con motor falso (censo `puertas: —`).
- Entrega de `plugin_event` a plugins inactivos en el flujo real (hallazgo 3): el motor falso no los emite; lo cubre `test/game-gen.test.ts` con `runPluginTick` → `[]`.
- Takeover real durante la pre-generación (F9e): solo por test de bridge.
- Mutación de `plugins-dispatcher`/`plugins-dsl`: el ingeniero la pidió (`pendiente`), no cabe en el tope local. El renombre no tiene semántica; F9 vive en ficheros que ningún módulo muta, y su prueba son los negativos de los tests y del 210.

## Crítica visual (capturas del 210)

- `01-fixture-sin-plugins`: `robledo_tile` en modo fixtures, «Bridge» en verde, sin chip «P · Sistemas» (coherente: no hay sesión en el cliente), y el registro dice «estado de la partida «1790275933-bb64bb» descartado» — el cliente cuenta que tira los frames de otra partida (#659). Legible.
- `02-de-vuelta-con-sus-plugins`: tras reanudar aparece «P · Sistemas», «Salidas» y la vida del bandido. El jugador reanuda DENTRO de un volumen oscuro (un interior clay del tile del motor falso, mirando a una mesa): no es de esta tanda ni del banco de plugins, y el 166 ya mide lo que se ve al reanudar; se anota solo por si se repite fuera del motor falso.

## Veredicto

**Apto con reservas.** Lo pedido (#368 F9 en los dos sitios, F7 renombrado y candado) está hecho, medido en el flujo real y con los tres negativos en rojo donde toca. La reserva es el hallazgo 1: la pregunta «¿queda algún camino que deje plugins huérfanos?» tiene un sí con botón en la UI (`delete_session` de la partida activa), y el guion 211 queda rojo hasta que se cierre o se decida dejarlo fuera de esta tanda (entonces borrar el 211 y su fila, no dejar un rojo permanente en el banco).
