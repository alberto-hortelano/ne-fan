# QA — el contrato de entity declara oficio y aspecto; los alias de sala se van (#175 → #173)

Rama `feat/contrato-entity-npc`, commit `4219544`. Verificado **desde el arranque del juego**
(`./start.sh --preset e2e-sin-creditos` vía `node qa/run.mjs`, cero créditos) y con herramientas,
no leyendo el informe del ingeniero. Guion nuevo:
`/home/al/code/ne-fan/qa/guiones/15-guardia-se-ve-y-se-comporta.mjs`.

La petición original del usuario era «resuelve los issues en orden con el flujo de agentes»; el
criterio que importa a quien juega, y el que se valida aquí, es el de `requisitos.md`:

> Un NPC declarado como guardia en `generate_scene` **se VE** como guardia y **se COMPORTA** como
> guardia. Hoy todos eran el mismo aldeano de aspecto y de conducta.

---

## Criterios

| Criterio (de `requisitos.md`, no del plan) | Veredicto | Evidencia concreta |
|---|---|---|
| Un guardia declarado **se comporta** como guardia: interviene en vez de huir | ✅ cumple | `qa/guiones/15`, partida real contra el bridge: ante el MISMO ataque, el guardia `molino_bench_place_vecino` **acorta** su distancia al punto de la pelea `6,84 → 5,16 m` y el mercader `barkeep` **se aleja** `9,22 → 10,52 m`. Capturas `15-…-04-guardia-a-la-vista.png` (a 8 m, andando) y `15-…-05-el-guardia-interviene.png` (encarando al jugador) |
| …y el `role` llega hasta el preset por la cadena real | ✅ cumple | El mismo guion lee la ficha del bridge por el State API :9878 (`GET /entity/{id}`, el cable de `entity_get`): `{"name":"Vecino de Molino del bench","role":"guard","description":"guardia de Molino del bench con lanza y capa parda"}`. Y en core, `resolveRoleParams({role:"guard"})` → `interviene=true huye=false wander=4 percep=16` frente a `merchant → interviene=false huye=true` |
| Un guardia declarado **se ve** como guardia (el juego pide OTRA ref de personaje) | ✅ cumple | `qa/guiones/15` §7 sobre la fixture `robledo_tile`, ninguno de sus 5 NPCs con `style_ref`: libro de skins del propio juego → `guardia con lanza y capa parda → warrior`; alcaldesa, herrero, posadera y molinero → `commoner`. En sesión, el mercader pide `commoner` con prompt = su DESCRIPCIÓN |
| …y los PÍXELES del guardia son distintos | ⚠️ no probado | Generar el skin cuesta créditos. En el bench el motor falso solo tiene hoja `idle` y devuelve 500 en `walk`, así que el cliente apaga los skins de la sesión y **todos los personajes son el y_bot base** (visible en las capturas). Lo verificado es *qué ref pide el juego*, no *qué pinta el generador* |
| `description` llega al prompt del skin y no se cae por el camino | ✅ cumple | Sesión real: la petición de skin del tabernero va con `prompt:"tabernero corpulento de mandil manchado"` (su descripción), no `"Tabernero corpulento"` (su nombre). Cable capturado: `{"model":"y_bot","anim":"idle","angle":"frontal_8","prompt":"tabernero corpulento de mandil manchado","style_id":"acuarela_luminosa","style_role":"commoner"}` |
| …y sobrevive a las allow-lists del saneador Python | ✅ cumple | Ejercido a mano contra `ai_server/narrative_schemas.py`: `clean_ent` conserva `{"role":"guard","description":"guardia con lanza y capa parda"}`; `validate_narrative_reaction` conserva `role` y `style_ref` en `spawn_entity`. Un `role:"herrero"` **lanza** en los dos, con el vocabulario en el mensaje |
| Un solo vocabulario de `role` (generate_scene ↔ spawn_entity ↔ `NPC_ROLES` ↔ `styleRoleForNpc`) | ✅ cumple | Los tres leídos del disco: `generate_scene.json entities[].role = ['peasant','guard','villager','merchant']`, `narrative_react.json` (spawn_entity) idéntico, `NPC_ROLES` idéntico. `styleRoleForNpc` es `Record<NpcRole, NpcStyleRole>`: las ramas inalcanzables ya no compilan. `styleRoleForNpc` sobre todo el vocabulario: `peasant→commoner guard→warrior villager→commoner merchant→commoner`, y `"herrero"`/`undefined → commoner` |
| Rol inventado: rechazo con error preciso al motor (no degradación silenciosa) | ✅ cumple | Pre-flight del MCP (`FormatDSceneSchema`): `entities[0].role: Invalid enum value. Expected 'peasant' \| 'guard' \| 'villager' \| 'merchant', received 'herrero'` |
| `room_id`, `room_description` y `style_tag` a **grep-a-cero** | ✅ cumple | `git grep -nE '\b(room_id\|room_description\|style_tag)\b' -- .` sobre TODO lo versionado: los únicos hits fuera de `docs/` son `arch-rules.json` (334, 352 — la regla) y `test/architecture.test.ts` (183-208 — su arnés), o sea **exactamente los dos ficheros que la regla se exime a sí misma**. Y la world scene ya no los emite: claves de `formatDToWorld` = `scene_id, scene_description, dimensions, world_rect, tile, terrain, terrain_grid, ground, volumes, scatter_generators, scatter_zones, biome, objects, npcs, ambient_event, exits, __player_start, __format_d` |
| …anotados en `campos-retirados-no-vuelven` y el candado **se pone rojo** | ✅ cumple | Probado EN NEGATIVO por mí, en los tres procesos, uno por uno y restaurando el árbol: `room_id` en `src/scene/scene-normalize.ts` → rojo (`:281 patrón prohibido`); `room_description` en `ai_server/narrative_schemas.py` → rojo (`:1006`); `style_tag` en `data/games/alta_fantasia/world.md` → rojo (`:89`). Los tres: `pass 32 · fail 1`. `git status` limpio después |
| Las dos excepciones nuevas del candado están escritas con motivo y no tapan nada que sí debería cazarse | ✅ cumple (con una reserva menor) | Medido: sin ellas la regla nace con **19 violaciones exactas** — `room_id`×12, `room_description`×3 (los 4 `data/games/*/world/tile.json`) y `style_tag`×4 (`labs/style/runs/…`). Los dos árboles están **gitignorados** (`.gitignore:81`, `labs/style/.gitignore:2`, confirmado con `git check-ignore -v`) y **ningún fichero trackeado** casa con los globs. Motivo escrito en el `why`. Reserva → hallazgo menor 3 |
| Los tests que fijaban los shims se van con ellos, declarando la cobertura perdida | ✅ cumple | Diff revisado: se borran los 2 casos de alias de `scene-normalize.test.ts`, los 2 de `store-immutability.test.ts`, `contract-prompts`«style_tag», `style-refs`«noble», el `subTest(style_tag)` de Python y un aserto de `bridge-routing`; los invariantes que seguían vivos se reanclan (la lista de enemigos a `enemies_projected`, la ref `noble` a `style_ref` explícito). `implementacion.md §2` lo declara pieza a pieza y coincide con el diff |
| No empeora nada: `verify`, CRAP, cobertura | ✅ cumple | `npm run verify` (nefan-core) **exit 0 · 1218/1218**. `npm run crap -- --check`: *0 por encima del tope*, cobertura de líneas **90,4 %** (mínimo 89). `ai_server`: **128 tests OK**. `nefan-html`: tsc/lint/build OK. `narrative-mcp`: tsc/lint OK |
| Mutación de los módulos tocados | ✅ cumple | Leído de `reports/mutation/`: `store` 223 mutantes · **56 vivos (74,9 %**, break 41) con `src/store/reducers.ts` a **0 vivos de 91**; `scene-normalize` 275 · **3 vivos (98,9 %**, break 98), y los 3 están en las líneas 117/165/209, **fuera** de los hunks del commit (12, 38-46, 181-184, 228-229). Ningún umbral tocado |
| `applyReducer` sale de la cola de deuda | ✅ cumple | `npm run deuda`: `reducers.ts` ya no aparece ni en «Complejidad × cobertura» ni en «Mutación — supervivientes» |
| El resto del juego no se rompe | ✅ cumple | **`node qa/run.mjs`: 14/14 guiones en verde**, con el 15 nuevo incluido |
| Playtest con el motor narrativo REAL | ⚠️ no probado | Necesita una segunda terminal con Claude Code poseyendo `:3737`; no la tengo. Ver hallazgo importante 1 |
| El camino que iba roto —motor → **ai_server** → bridge— ejercido de punta a punta | ⚠️ no probado | El preset `e2e-sin-creditos` apunta el bridge al **fake-ai**, que devuelve Format D directamente: `validate_scene_response`/`clean_ent` **no corren** en el bench. Ver hallazgo importante 2 |
| CI verde | ⚠️ no probado | La rama no está pusheada y no hay PR (`gh pr list --head feat/contrato-entity-npc` vacío). Verde en local no es verde |

---

## Hallazgos

### Importante 1 — el motor de verdad todavía no ha contestado a este contrato, y ahora puede ser rechazado

El ingeniero lo declara y es correcto, pero conviene medir el radio de daño, porque **esta tanda
introduce un modo de fallo nuevo para quien juega**: el vocabulario de `role` es un enum CERRADO y
un oficio inventado ya no degrada, se rechaza.

Lo que sí pude comprobar del camino de rechazo:

- El pre-flight del MCP devuelve al motor un error preciso y accionable, con los cuatro valores:
  `entities[0].role: Invalid enum value. Expected 'peasant' | 'guard' | 'villager' | 'merchant', received 'herrero'`.
  Ahí el modelo puede re-responder, que es el diseño elegido.
- La prosa del prompt es explícita (`DRESSING AND BEHAVIOUR OF AN NPC`: «Inventing a role
  ("herrero", "alcaldesa") is rejected and you will be asked to re-answer»).
- Si el modelo insiste, el saneador de ai_server lanza `ValueError`, `llm_client` devuelve `None`
  y el tile no llega: el jugador se come un `narrative_status: error`. Es decir, **la degradación
  tolerante que sigue viva en runtime (`resolveRoleParams` → villager, `styleRoleForNpc` →
  commoner) NO existe en la puerta**: ahí es fatal.

Reproducción desde el arranque (pendiente): `./start.sh --preset playtest-motor` + segunda terminal
con `narrative_listen` + `labs/narrative/game-emulator.mjs`, pedir un tile de pueblo y mirar si el
motor escribe oficios en `role`. **Señal a vigilar**: `narrative_status: error` nombrando los
cuatro valores. Si aparece más de una vez, el arreglo es la PROSA (o ampliar el vocabulario), no
relajar el enum.

Qué esperaba el jugador: entrar en el pueblo. Qué puede pasar: que el tile no llegue porque el
motor llamó `herrero` a un herrero.

### Importante 2 — la evidencia «en vivo» no cubre el trozo que estaba roto

`implementacion.md §3` presenta la corrida del bench (`e2e-sin-creditos`) como demostración del
criterio de aceptación, y para la CONDUCTA lo es. Pero el preset apunta el bridge al
`fake-ai-server`, que responde Format D **sin pasar por `validate_scene_response`**: las dos
allow-lists de `ai_server` —que son literalmente donde `role` y `description` se caían— **no se
ejecutan ni una vez en toda la batería**. Están cubiertas por tests unitarios (`test_scene_validate.py`,
9 casos nuevos) y por las fixtures compartidas, y yo las ejercí a mano; pero nadie ha recorrido
motor → MCP → ai_server → bridge → cliente con los campos dentro.

No pido cambio de código: pido que el informe no se lea como si el bench probara eso, y que el
primer playtest real mire justamente ahí.

### Importante 3 — el motor falso se vistió para la prueba

`labs/narrative/fake-ai-server.mjs` ahora emite `role` + `description` (desviación 5 del ingeniero).
Es lo correcto —el doble del motor debe emular a un motor conforme, y sin ello el bench medía el
mundo anónimo que #173 llama bug—, pero tiene una consecuencia: **el bench ya no puede notar que el
contrato deje de pedir esos campos**, porque los lleva escritos a mano. Si mañana alguien retira
`role` del prompt, `qa/run.mjs` sigue verde. Lo que sujeta eso es el candado de deriva de
`contract-prompts.test.ts`, que sí existe; conviene saber que el guion no es una segunda red ahí.

### Menor 1 — `description` declarada en algo que no es un NPC se pierde en silencio

`EntitySchema` declara `description` a nivel de entity (todas las `kind`), y `clean_ent` la copia
para todas; pero `formatDToWorld` pone en un objeto `description: ent.name` e **ignora la
declarada**. Comprobado:

```
entity  {"id":"torre","kind":"building","name":"Torre","description":"torre de piedra con almenas"}
world   {"id":"torre", …, "category":"building","description":"Torre"}
```

El tool documenta el campo como «NPCs:», así que está fuera de contrato — pero el nombre es
genérico y el motor acabará escribiéndolo en un edificio, y nadie dice nada (justo el fail-silent
que esta tanda vino a cerrar en su versión de NPC). Nota simétrica: un `role` en un edificio sí
salta, porque el saneador aplica el vocabulario de NPC a **cualquier** kind
(`entity 'torre': role 'torre' no está en el vocabulario`).

### Menor 2 — divergencia TS↔Python conocida y sin issue

`implementacion.md §5` la declara y la deja fuera a propósito (`description: ""` y `size` en un
tile: el zod rechaza, el saneador Python normaliza en silencio), y las seis fixtures compartidas se
eligieron **entre los casos donde los dos procesos ya coincidían**. Es honesto, pero el set así
elegido solo prueba el acuerdo donde ya lo había. Como el objeto de la tanda era que la divergencia
tuviera señal, esa divergencia necesita issue, no un párrafo en un documento efímero (`plan.md` e
`implementacion.md` no se commitean).

### Menor 3 — la exención del candado es por FICHERO, no por término, y su glob es más estrecho que el `.gitignore`

Dos cosas, ninguna grave:

1. El motor de reglas filtra el fichero entero (`checkArchitecture`: `!matchesAny(f.path, exceptions)`),
   así que los dos árboles exentos quedan ciegos a los **30** términos retirados, no solo a los tres
   nuevos. Lo probé: metiendo `terrain_features`, `proscenium` y `WORLD_VIEWS` en
   `data/games/alta_fantasia/world/tile.json`, `architecture.test.ts` sigue en `pass 33 · fail 0`.
   Como son artefactos gitignorados que CI nunca descarga, no tapa nada real, y el `why` lo dice
   («ahí la regla no canda nada»). Queda anotado para que nadie lo descubra creyendo que es un bug.
2. El glob exime `nefan-core/data/games/*/world/*.json` (un nivel), pero lo gitignorado es
   `…/world/` **entero**, y el código escribe también
   `…/world/styles/{style_id}.json` (`src/games/style-application.ts:35`). Un registro de estilo con
   uno de los términos dentro volvería a poner rojo un árbol local por un artefacto gitignorado, que
   es exactamente lo que la excepción existe para evitar. Un `**` lo cierra.
3. Detalle: las dos excepciones llevan metacaracteres, así que `deadExceptions` nunca podrá
   denunciarlas como podridas. Es el comportamiento documentado de la herramienta, no un fallo.

### Menor 4 — un solo 500 deja la sesión entera con el aspecto del bug (pre-existente)

`character-sprites.ts:222`: el primer fallo 5xx de un skin pone `skinsDisabled = true` para **toda
la sesión**, y a partir de ahí ningún personaje —ni los que aún no han aparecido— pide su skin. En
el bench pasa siempre (el modelo falso solo tiene `idle`), y por eso el guardia del tile de destino
nunca llega a pedir el suyo. Es pre-existente y está avisado con un toast fail-loud, pero conviene
verlo con el criterio de esta tanda delante: **el aspecto por oficio se lo lleva por delante un
único HTTP 500**, y el jugador se queda con el mundo de personajes idénticos que #173 vino a
arreglar. Candidato a issue (reintento acotado o cortacircuitos por personaje, no por sesión).

### Observación de dirección de arte

Miradas las capturas de `qa/capturas/` como jugador y como director de arte:

- **No hay regresión visual atribuible a esta tanda**: escena, etiquetas de NPC, HUD, panel
  «Salidas» y barra de ataques se pintan como en las corridas previas. Los dameros son los
  placeholders del motor falso, no arte a juzgar.
- El personaje (`15-…-04-guardia-a-la-vista.png`, `-05-el-guardia-interviene.png`) lee bien de
  escala y la locomoción se ve; **no tiene sombra de contacto**, así que flota ligeramente sobre el
  suelo mientras los edificios sí proyectan (`…-06-el-pueblo-vestido-por-oficio.png`). Es previo a
  esta tanda y no lo toca, pero es lo primero que rompe la integración de un personaje en su
  escena.
- Las etiquetas de NPC se pintan **a través de las paredes** (en el tile de entrada, «Tabernero
  corpulento» flota sobre la puerta con el tabernero dentro de la taberna). También previo.
- El aviso de skins desactivados ocupa la esquina superior derecha durante toda la partida. Como
  fail-loud es correcto; como experiencia, es el único texto rojo permanente de la pantalla.

---

## Workarounds usados durante la prueba, y su veredicto

| Workaround | Por qué | ¿Afecta al jugador? |
|---|---|---|
| **Ninguno para observar la feature.** No oculté overlays, no forcé estado, no teletransporté al jugador ni salté el título | El guion entra por `./start.sh --preset e2e-sin-creditos`, título → mundo → partida, camina con `up` y ataca con el ataque de la sesión | — |
| El jugador se **sitúa a ~8 m** del NPC antes de atacar (`situarse`, andando) | A 2,2 m el guardia ya está en su sitio (`INTERVENE_STOP_DIST = 2`) y no tiene a dónde acercarse: la reacción existe pero es invisible. No es un apaño: es elegir un punto de observación | No. Es la distancia normal a la que un jugador se cruza con alguien |
| La mitad de «se ve como guardia» se mide sobre la fixture `robledo_tile` en una pestaña recién cargada, encendiendo los skins IA desde el chip de gráficos (dos clicks, con su confirmación de coste) | En sesión, el cortacircuitos del bench (menor 4) deja de pedir skins tras el primer 500 | **Sí, y está reportado** como menor 4. El obstáculo es real y lo tendrá el jugador el día que su backend devuelva un 500 |
| Sondas temporales para el negativo del candado y del guion (ficheros de producción modificados y **restaurados**) | Un candado que solo se ha visto verde no es un candado | No: `git status` limpio después de cada prueba; no queda ni una línea mía en código de producción |

---

## Probado en negativo

**El candado.** Tres sondas, una por proceso, cada una restaurada: `room_id` en TS de core,
`room_description` en el saneador Python y `style_tag` en el `world.md` de un juego. Las tres ponen
`campos-retirados-no-vuelven` en rojo con fichero y línea.

**El guion nuevo.** Rompí a mano las dos cosas que dice verificar y corrí `node qa/run.mjs 15`:

- `src/narrative/npc-records.ts`: dejar de copiar `extra.role` →
  `✘ el bridge registra el role declarado`, `✘ el bridge lo registra como guard` y —lo importante—
  **el guardia HUYE**: `6,61 → 8,61 m`. Es el bug #173 reproducido en pantalla.
- `src/games/style-categories.ts`: `guard: "commoner"` → `✘ el guardia se pide con la ref del
  GUERRERO` (`roric_guardia → commoner`) y el pueblo entero vuelve a vestirse igual.
- Los asertos ajenos a lo roto siguieron en verde: el guion discrimina, no se cae entero.

De paso, `npm run verify` cazó mi primera versión del guion: usaba
`new Promise(r => setTimeout(...))` y saltó `qa-guiones-sin-espera-por-reloj`. Reescrito para leer
el libro de skins del propio juego.

---

## No probado (y por qué)

1. **Playtest con el motor narrativo real** — necesita una segunda terminal con Claude Code
   poseyendo `:3737`. Es la única pregunta abierta de verdad: si la prosa basta para que el motor
   no invente oficios en `role` (hallazgo importante 1).
2. **El tramo ai_server del camino** — el bench no lo recorre (hallazgo importante 2). Ejercido a
   mano y por unit tests, no de punta a punta.
3. **Los píxeles del skin** — generarlos cuesta créditos. Verificado *qué ref pide el juego*, no
   *qué pinta el generador*.
4. **La corrida completa de mutación (17 módulos)** — no la lancé, por la misma razón que el
   ingeniero (#230: tocar `arch-rules.json` manda a la completa). Los dos módulos cuyo código
   mutado cambia están medidos y verdes; los otros 15 informes son del 23-ago 13:39-14:09, previos
   a la rama, y `npm run deuda` lo avisa solo.
5. **CI** — la rama no está pusheada y no hay PR. El hook `Stop` sigue pendiente para quien cierre
   la tarea.

---

## Guion entregado

`qa/guiones/15-guardia-se-ve-y-se-comporta.mjs` — «el guardia se ve y se comporta como guardia»,
por el camino del jugador y con cero créditos. Cubre el hueco que `07` deja: a `07` le basta con que
`style_role` no venga vacío, así que pasaría en verde aunque `role` volviera a caerse y todo el
mundo se vistiera de plebeyo. Este afirma las dos DIFERENCIAS —qué ref se pide y cómo reacciona cada
oficio al mismo ataque— y contrasta el `role` guardado con el State API :9878. Probado en negativo
(arriba). Corrida completa con él dentro: **14/14 en verde**.

Lo que queda en el informe y no en el guion, porque es juicio: la crítica visual, el riesgo del
enum cerrado frente al motor real y el coste de un 500 sobre el aspecto de toda la sesión.

---

## Veredicto

**Apto con reservas.**

Los dos criterios del usuario se cumplen y están demostrados con el juego corriendo, no con prosa:
un guardia declarado por el motor entra a la pelea mientras el tendero huye, y pide la ref de
guerrero mientras el resto del pueblo pide la de plebeyo. El borrado de los tres alias llega a
grep-a-cero con candado probado en rojo, y ninguna medida empeora.

Las reservas no piden cambio de código antes de cerrar, pero sí que se escriban donde sobrevivan al
borrado de `plan.md` e `implementacion.md`: (1) el motor real no ha contestado todavía a un enum que
ahora RECHAZA, y ese es el primer sitio donde mirar en el próximo playtest; (2) el trozo que estaba
roto —las allow-lists de ai_server— no se ha recorrido de punta a punta ni una vez; (3) la
divergencia TS↔Python conocida, el `description` que se pierde en objetos, el `**` del glob de la
excepción y el cortacircuitos de skins por sesión son issues, cada uno con su nombre.
