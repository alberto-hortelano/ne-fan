# QA — PR-C · #397 «un solo vocabulario de entity» (rama `fix/un-vocabulario-de-entity`, HEAD `3b014f0`, base `4ca0c50`)

Medido el 2026-09-03 en el worktree `.claude/worktrees/t7c-un-vocabulario`, contra la petición ORIGINAL
(`requisitos.md` Alcance 2 con su bloque «Crítica:», criterios A3 y A6) y el criterio de cierre del issue
#397 («`name` obligatorio y es lo que se rotula; `description` opcional y es la procedencia, y sobrevive al
`materializeSpawn` y al save sin pisar la etiqueta; el prompt de consecuencias lo dice igual que el tool de
escena; test de contrato que compare los dos zod — comparten el vocabulario, no dos copias»). Flujo real:
`./start.sh --preset e2e-sin-creditos` (lo levanta `qa/run.mjs`), cero créditos. **Nada arreglado, nada
commiteado**: el árbol queda con `git diff` vacío y dos untracked (esta carpeta y el guion 67).

## Veredicto: **APTO con reservas**

Lo pedido se cumple y está demostrado en el flujo del jugador (guiones 66 y 67, verdes; ROJOS con el
código saboteado). Las reservas son dos hallazgos importantes que NO bloquean el merge pero que deben
salir a issue o corregirse en la misma PR: **H1** (el vocabulario acepta `name` en blanco en el zod y lo
rechaza en Python — la divergencia de espejo que #397 vino a cerrar, en el campo nuevo) y **H2** (el record
sin `name` no vuelve al cliente pero el bridge sí lo resiembra: «anda invisible»).

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **A3.1** `spawn_entity` con `name`≠`description` → el rótulo del cliente es `name` | ✅ | Guion 66 en vivo: `{"label":"Nogala","skinPrompt":"posadera de manos grandes y delantal remendado"}`, objetos `Cofre de la posada`, `Forja de Robledo`; ninguno rotula la descripción. Captura `qa/capturas/2026-09-03T11-49-48-998Z-86296/66-…-01-los-cinco-en-vivo.png`: el log de juego dice «✨ Nogala aparece», «✨ edificio: Forja de Robledo» |
| **A3.2** tras guardar y reanudar `state.entities[id]` conserva las dos y el rótulo sigue siendo `name` | ✅ | Guion 66: `GET /entity/{id}` antes y después del resume → Nogala `data.{name,description}` las dos; tras reanudar `label "Nogala"`, `skinPrompt` = la description, **mismo id** (`narr_npc_1788436215_0_2`) |
| **A3.3** caso SIN `description`: rótulo `name`, procedencia/skin = `name`, nunca el id ni «an entity» | ✅ | Guion 66: Mochuelo `{"label":"Mochuelo","skinPrompt":"Mochuelo"}` en vivo y tras reanudar; ledger `data` sin clave `description`. **En negativo** (handler con `?? "an entity"` de vuelta): `✘ … skinPrompt "an entity"` |
| **A3.4** los dos zod comparten el OBJETO, test de identidad | ✅ | `entity-vocabulary.ts` exporta `VocabularioDeEntity`; `scene-schema.ts:80` y `schemas.ts:45-46` lo cogen por referencia; `test/entity-vocabulary.test.ts` compara `===`. **En negativo**: `schemas.ts` con `name: z.string().min(1)` → `✖ 'name' es el mismo schema… spawn_entity tiene su propia copia` (pass 5 · fail 1); `scene-schema.ts` con `description: z.string().min(1).optional()` → 2 rojos (identidad + «dicen lo mismo») |
| **Espejo Python** rechaza sin `name`, acepta sin `description`, `ValueError` nombra el campo | ✅ | Sonda: sin name → `spawn_entity[0] missing required field 'name' (non-empty string): es el rótulo…`; sin description → ACEPTA sin inventarla; description «   » → `…description no puede ir vacía ni ser solo espacios`. `python -m unittest discover -s ai_server/tests -t .` → `Ran 148 tests OK`. **En negativo** (check de name a `if False`): 3 FAIL, incluida la fixture compartida `invalid/spawn_sin_name.json` |
| **Prompts renderizados = zod** | ✅ | `narrative_event.md:113-114`: `name: string /* no vacío */` antes de `description?: string`; `narrative_react.json` `required: ["type","entity_kind","name"]`. `npm run gen:contract` → «sin cambios (sincronizado)». **En negativo** (`name?` a mano en el .md) → `✖ cada prompt .md tiene la región SCHEMA:AUTO sincronizada con el zod`. Pero ver **H5**: el tool JSON pierde el texto de `description` |
| **`scene_loaded`**: el `scene_init` sigue llegando y pintando; ningún `spawn_entity` sin `name` sale del bridge | ✅ | Guiones 01, 60, 64 verdes (64: «desde el link: 7 frame(s) · scene_init 0»). `grep -rn spawn_entity nefan-core/bridge/` → solo 3 comentarios, ningún emisor. `context.ts:338` emite `{kind:"scene_loaded", sceneId, scene}` |
| **`main.ts` no suma líneas** | ✅ | `wc -l` = **2316**; `client-file-size.json` `"lineas": 2316` (bajado de 2321 en el mismo commit) |
| **A6** `npm run verify` | ✅ | `exit=0` · `tests 1939 · pass 1939 · fail 0` |
| **A6** coverage / crap / deuda | ✅ | `1212 funciones medidas · cobertura de líneas 89,1 % · complejidad máxima 48` (informe: 89,2 %; diferencia de redondeo entre corridas); `Deuda medida — 75 items` (base 76) |
| **A6** nefan-html | ✅ | `npx tsc --noEmit` exit 0. `npm test` **no existe** en `nefan-html/package.json` (A6 lo cita por plantilla) |
| **Pasada adversarial** `description` «   » / `name` vacío / `name`=`description` / sin `entity_kind` / save sin `data.name` | ⚠️ parcial | Zod: description «   » RECHAZA, name «» RECHAZA, name=description ACEPTA (correcto: label=name, skin=description), sin `entity_kind` → `Required` (el default mudo murió: nada llega al handler sin kind), sin name → `Required`. Save sin `data.name`: guion 67 (nuevo) verde. **`name` «   »: el zod ACEPTA y Python RECHAZA → H1** |
| **Guion 66 tiene dientes** | ✅ | Leído: sobre `main` el handler ponía `description: c.description ?? "an entity"` y `spawnsDeRuntime` caía a `rec.id` → los asertos «skinPrompt === "Mochuelo"» (en vivo y tras reanudar) serían rojos; los de rótulo eran verdes ya (declarado en su cabecera). Confirmado re-ejecutando con esos dos fallbacks repuestos a mano: `✘ 66` (`skinPrompt "an entity"`) |

## Hallazgos

### H1 · importante — `name` en blanco: el zod lo acepta, Python lo rechaza (divergencia de espejo en el campo que #397 unifica)
`VocabularioDeEntity.name = z.string().min(1)` sin el `.refine(noSoloEspacios)` que sí lleva `description`;
`narrative_schemas.py:1054` exige `name_raw.strip()`.
- **Repro**: `validateContract(NarrativeReactionSchema, {consequences:[{type:"spawn_entity",entity_kind:"npc",name:"   "}]})` → `ACEPTA`; `validate_narrative_reaction(...)` con el mismo payload → `RECHAZA: …missing required field 'name'`. Mismo caso en la escena: `EntitySchema` con `name:"  "` → `ACEPTA`.
- **Qué vería el jugador**: por la vía MCP (narrative-mcp valida con el zod) un spawn con `name:"   "` pasa el pre-flight y el cliente rotula `"   "`: un NPC sin rótulo visible. Por la vía API directa el mismo payload se rechaza. Es exactamente «el mismo modelo, dos criterios según la puerta», ahora entre procesos en vez de entre tools.
- **Esperado**: el vocabulario refina `name` como refina `description` (mismo objeto, un solo sitio), y el test «dicen lo mismo» añade el caso `"   "` para `name`. Sin arreglo, al menos issue.

### H2 · importante (derivado) — el record sin `name` no vuelve al CLIENTE, pero el BRIDGE lo resiembra: «anda invisible»
`spawnsDeRuntime` (core, llamado desde `main.ts:2266`) deja fuera el record y lo dice; el bridge resiembra el sim al reanudar por otro lector (`reseedSimForSession` + `createSessionNpcBehavior`) que no aplica el filtro, y mueve al NPC.
- **Repro** (guion 67, bloque 1): partida hasta el turno 3, borrar `data.name` del record de Nogala en `state.json`, Reanudar. Panel del jugador:
  `scene · el bridge mueve al NPC "narr_npc_1788436407_0_2" y el cliente no lo tiene en escena: anda invisible (¿un spawn que no se rehidrató al reanudar?)`
  `session · «narr_npc_1788436407_0_2» no vuelve al mundo: la partida guardada no dice cómo se llama`
  Captura `qa/capturas/2026-09-03T11-53-21-260Z-90289/67-…-01-nogala-sin-nombre-no-vuelve-y-el-panel-lo-dice.png`.
- **Por qué importa**: dos lectores del mismo ledger con dos criterios. Con `role:"hostile"` el atacante sería invisible. Pre-producción dice que los saves viejos no importan, pero la PR eligió «se dice» y no «se ignora»: entonces la decisión tiene que vivir en UN sitio que lean los dos (core), no en el camino del cliente.
- **Esperado**: o el bridge aplica el mismo filtro al resembrar (y el sim no conoce al record), o el resume del bridge rechaza/limpia el record y el cliente no tiene que decidir nada. Issue derivado como mínimo.

### H3 · menor — el aviso al jugador habla en idioma de máquina
`«narr_npc_1788436407_0_2» no vuelve al mundo: la partida guardada no dice cómo se llama`. Sin `name` no hay
otra referencia, pero el id interno no le dice nada a quien juega; podría decir qué era (`entity_kind`: «un
personaje que puso el motor») y, si la hay, su descripción entre comillas. Es la única línea que el jugador
lee sobre lo que perdió.

### H4 · menor (declarado por el ingeniero, pendiente de PR-A) — el espejo Python de la ESCENA rellena `name` con el id
`narrative_schemas.py:776`: `"name": ent.get("name") or eid`, mientras `EntityBase.name` pasó a `.min(1)`
obligatorio. Es el mismo tipo de divergencia que H1, en la otra puerta, y son las líneas que PR-A reescribe.
Debe quedar escrito en PR-A o en issue; no se mide aquí.

### H5 · menor (declarado, preexistente) — el tool `narrative_react.json` no dice qué es `description`
`toJsonSchema` desenvuelve `ZodOptional` sin arrastrar `.describe()`: `"description": {"type":"string","minLength":1}` sin texto, mientras `name` sí lo lleva. El modelo que entra por la API directa (`NARRATIVE_REACT_TOOL`, `llm_client.py:812`) ve la semántica solo en el system prompt (`narrative_event.md`), no en el tool. El criterio «el prompt lo dice igual que el tool de escena» se cumple en el prompt y a medias en el tool (`generate_scene.json` sí explica `description` en 6 líneas). Issue pequeño en `json-schema.ts`.

### Observaciones no atribuibles a PR-C (para el coordinador, sin severidad aquí)
- Captura 66-02 (tras reanudar): los rótulos «Secuaz» y «Mochuelo» se superponen en el centro de la
  pantalla (dos spawns `near_player` de turnos distintos caen en el mismo sitio) y el jugador reanuda
  con la cara pegada a una pared (la forja 4×4 spawneada junto a él). Preexistente: resolución de
  `position_hint`, no vocabulario.
- El panel de errores del banco se llena con 4 trazas de `skin_sprite_sheet HTTP 500` del motor falso
  («paladin no tiene sheet walk/frontal_8 (esperado en bench…)»): ruido conocido del preset sin
  créditos, tapa un tercio de la vista en las capturas.

## Guion nuevo: `qa/guiones/67-un-spawn-guardado-sin-nombre-no-vuelve-y-se-dice.mjs`
Mide la mitad de A3 que el 66 no toca —qué pasa con un save cuyo spawn no trae `data.name`— por el camino
del jugador: control con la partida sana, sabotaje del save en disco, Reanudar, panel + escena (Nogala fuera,
cofre y forja dentro), restaurar y volver a reanudar (Nogala vuelve con el mismo id y su procedencia, el panel
calla). Verde sobre HEAD (`1 en verde · 0 en rojo`). **Probado en negativo**: con `spawnsDeRuntime` cayendo a
`rec.id` como rótulo → 3 rojos (`✘ el panel… no ocurrió en 30000 ms`, `✘ Nogala NO vuelve… {"label":"narr_npc_…"}`).
Sin espera por reloj (`grep setTimeout` = 0; `architecture.test.ts` 69/69 verde con el fichero en el árbol).
Además dejó a la vista H2, que ningún test unitario podía ver.

## Workarounds usados
- **Editar `state.json` en disco** (guion 67): es el SUJETO de la medida —un save de antes o corrupto—, no un
  atajo para observar otra cosa; el contrato ya no deja al motor emitir ese record. Declarado en la cabecera
  del guion, mismo patrón que los guiones 62 y 63.
- **Sabotajes de código para las pruebas en negativo** (`schemas.ts`, `scene-schema.ts`, `narrative_event.md`,
  `narrative_schemas.py`, `consequence-handler.ts`, `mundo-persistido.ts`): edit → rojo → `git checkout`.
  `git status` final: solo los dos untracked.
- Ningún overlay ocultado, ningún estado forzado en el cliente.

## No probado y por qué
- **Un motor que emita `spawn_entity` sin `name` en E2E**: el fake se tipa `satisfies ReportPlayerChoiceResponse`
  y no puede emitirlo sin saltarse el tipo; el bridge no valida lo que vuelve de ai_server (lo hacen Python y
  el pre-flight MCP). Cubierto por tests de contrato TS + Python + fixture compartida, no por guion. Si algún
  día un proceso se saltara los dos gates, `effect.name.slice` en `main.ts:1897` lanzaría: no hay red en el
  cliente, por diseño («el cliente solo pinta»).
- **`name` «   » en el flujo real**: solo a nivel de zod/Python (H1); producirlo E2E exigía tocar el fake.
- **Mutación**: ningún módulo cabe en `tope_local` (mundo-persistido 308, contrato-escena > 120); pedida por el
  ingeniero, no esperada. `npm run mutacion -- pendiente` dice corrida COMPLETA (32/32) por los datos del paquete.
- **Vía MCP real y gasto**: no hay narrative-mcp ni ai_server reales en el banco; cero créditos por construcción.
- **CI de la PR**: no existe PR todavía al medir.

## Crítica de los tests nuevos y del guion 66
- `entity-vocabulary.test.ts` mide lo que dice el issue (identidad `===`, no forma) y añade «dicen lo mismo» +
  «no transforma» + el bloque renderizado en orden. Le falta el caso `name: "   "` (H1): hoy pasaría en verde
  porque el zod lo acepta — un test que fijara el criterio habría cazado la divergencia con Python.
- Tests de `consequence-handler`, `mundo-persistido` y `contract-model-io`: apuntan al sujeto (sin `description`
  → sin `description`; sin `name` → error con el id y «cómo se llama»; `/name/` y `/description/` en los rechazos).
- Guion 66: mide lo que ve el jugador (rótulo, skinPrompt, ledger, resume, id a id) sobre el motor falso, con y
  sin procedencia, y declara honestamente qué asertos ya eran verdes en la base. `skinPrompt` en `__nefan.npcs()`
  es sonda de solo lectura, correcta. Lo que NO mide: el rechazo del contrato (imposible E2E, arriba) y el save
  sin `name` (lo mide el 67 ahora).

## Re-validación — vuelta del ingeniero (`d534526`, 2026-09-03)

Re-medido SOLO lo que cambió (`git diff --stat 3b014f0..d534526`: 17 ficheros, +483/−40), contra los
hallazgos H1, H2+H3 y H5. H4 queda en PR-A por decisión del coordinador. Árbol final: `git diff` vacío,
solo esta carpeta untracked; ningún stack propio en marcha.

### Veredicto final: **APTO**

| Hallazgo | Veredicto | Evidencia |
|---|---|---|
| **H1** `name` en blanco: mismo criterio y misma frase en zod y Python | ✅ cerrado | `entity-vocabulary.ts`: `name` lleva `.refine(noSoloEspacios, MOTIVO_NAME_INVALIDO)` en el objeto compartido (cae en los dos zod solos). Sonda: spawn `name:"   "` → `RECHAZA: consequences[0].name: \`name\` no puede faltar, estar vacío ni ser solo espacios: es el rótulo que lee el jugador (la procedencia va en \`description\`)`; escena `name:"  "` → misma frase; Python sin/vacío/en blanco → `spawn_entity[0].name: \`name\` no puede faltar…` (frase idéntica). **En negativo** (quitar el `.refine`): `entity-vocabulary.test` `✖ …dicen lo mismo` + el test de la frase (pass 5 · fail 2) |
| **H2** dos lectores del ledger, «anda invisible» | ✅ cerrado | `loadSession` (`narrative-state.ts:541-547`) rechaza el save entero si un record no trae `data.name` (falta / no texto / en blanco), por la vía #334/#336; la rama de `spawnsDeRuntime` es ahora un `throw` de invariante. Guion 67 reescrito: `resume por el cable: {"ok":false,"error":"save_invalido: save \"1788437737-76e941\": entities[\"narr_npc_1788437740_0_2\"].data.name falta — «posadera de manos grandes y delantal remendado» no tiene nombre — …bórralo o empieza partida nueva"}`; **cero «anda invisible»** (`expectEspera(false)`, 4 s de sondeos, verde); panel del jugador con UNA sola entrada (`session start/resume failed`). Mi repro original ya no reproduce: el sim no se resiembra porque el save no carga. **En negativo** (puerta a `if (… && false)`): `narrative-state.test` `✖ loadSession RECHAZA un save cuyo record no tiene data.name` (pass 83 · fail 1) |
| **H3** aviso en idioma de máquina | ✅ cerrado | Captura `qa/capturas/2026-09-03T12-15-22-187Z-125012/67-…-01-save-sin-nombre-no-vale-y-el-titulo-dice-quien.png`: el título dice en rojo «No se pudo reanudar la partida. Esa partida guardada ya no vale para esta versión del juego («posadera de manos grandes y delantal remendado» no tiene nombre): bórrala o empieza una nueva.» — sin id, con la descripción; la tarjeta sigue ofreciendo Reanudar/Borrar y «Nueva partida» está a mano. Sin descripción cae a «un personaje/objeto/edificio que puso el motor» (`quienEs`, testado en `narrative-state.test`; no ejercido E2E) |
| **H5** el tool pierde el `.describe()` de los opcionales | ✅ cerrado | `json-schema.ts`: `ZodOptional/ZodDefault/ZodNullable/ZodEffects` pasan por `withDescription`. Diff de los tres tools regenerados: **solo líneas `"description": …` añadidas** (`narrative_react.json` 7 campos: description, position_hint, role, style_ref, choices, trigger, payload; `weapon_orient.json` 2; `weapon_verify.json` 2); ninguna clave de forma (`type`, `enum`, `required`, `min/max`) cambia. `npm run gen:contract` → «sin cambios (sincronizado)» |

**Guion 67 (reescrito por el ingeniero): dientes confirmados leyendo.** Sobre `3b014f0` el resume del save
saboteado contestaba `ok:true` → rojo en «contesta save_invalido» y en «nombra el save, el record y su
descripción»; el `waitFor` de `#ts-error` expiraría (rojo por excepción); y «la partida NO carga» sería rojo
porque la escena volvía. Ejecutado sobre `d534526`: verde (junto a 66 y 60: `3 en verde · 0 en rojo de 3`).
Sin espera por reloj. Bloque 2 (nombre repuesto → la MISMA Nogala id a id con su procedencia, título sin
aviso) verde.

**Cifras de la vuelta (salida real)**: `npm run verify` exit 0 · `tests 1941 · pass 1941 · fail 0`;
`python -m unittest discover -s ai_server/tests -t .` → `Ran 148 tests OK`; `nefan-html` `tsc --noEmit` exit 0;
`main.ts` sin cambio (2316).

**Sin medir en esta vuelta**: coverage/crap/deuda no re-corridos (el ingeniero reporta 89,1 % / 75 items, igual
que mi primera medida; los ficheros nuevos son ramas de validación con test propio); mutación pendiente de
autorización como antes; CI de la PR (aún sin PR).

**Comentario de calidad**: la solución de H2 es la correcta por la regla de la casa («la garantía va en el
tipo»): el filtro murió y la puerta es una sola, en `loadSession`, la misma que ya tenía `position`. Riesgo
residual que conviene saber: cualquier productor futuro de records sin `data.name` invalida el save entero
al reanudar (hoy los dos productores —`registerSceneNpcs` y `recordEntitySpawned` desde el handler— lo
escriben siempre; guiones 60/65/66 lo demuestran cargando).
