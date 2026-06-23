# Auditoría del repo — pendientes y siguiente objetivo

Auditoría original en `2d4f8ca` (estado, errores, modularidad, dead code). Las secciones ya implementadas se han retirado de este documento y quedan resumidas con su commit. **Se conserva la numeración original** porque hay docstrings en el código que la citan (p. ej. `analyze_weapon` en `ai_server/main.py` cita "next.md §2.1").

---

## 0. Estado a 2026-06-10

**Implementado** (retirado del documento):

- **§1 Gestión de estado — cerrado** (`960e7f8`, `cb8dcf6`, PR #22): `GameState` eliminado; proyección `enemies_projected`; invariantes de store; `validateAssetSnapshot`; `SignalLifecycle`.
- **§2 Gestión de errores — cerrado** (`48dc53f`, `ba2dd3b`, PR #23): catches TS → `errors.push`; `load_game` responde al socket; `Result` en `reportPlayerChoice`; Pydantic en todos los endpoints de generación; `NodeAccess.must_get_node`; doctrina en CLAUDE.md.
- **§2.2 restos + §4 dead code — cerrado** (rama `legacy/retire-generate-room`):
  - Cadena `generate_room`/`populate_room` retirada end-to-end: endpoints de `ai_server/main.py`, `populate_room`/`generate_room` y sus helpers MCP/API de `llm_client.py`, prompts/tools/validators legacy de `narrative_schemas.py` (el archivo pasó de ~1140 a ~700 líneas), `AiClient.generateRoom` de `ai-client.ts`, tabla de endpoints de CLAUDE.md. El tipo WS `room_request` se queda: lo comparte la ruta canónica (`format: "scene"`).
  - Pydantic en `/generate_scene` (acepta las dos formas vivas: LlmContext del bridge y bypass de ScenarioRunner, con `model_validator` que exige una completa) y `/analyze_weapon`.
  - `skin_test_*` movidos a `ai_server/routers/diagnostic.py` bajo prefijo `/diagnostic/*`, montados sólo si `ai_server.expose_diagnostic = true` en `nefan-core/src/config.ts` (default false → 404).
  - Dead code borrado: `combat_resolver.gd`, `nefan-core/src/dev/room-registry.ts`, `nefan-core/src/dev/dev-state.ts` y sus exports del barrel.
  - **Fix fail-loud nuevo**: `_generate_scene_via_mcp` no detectaba la respuesta estructurada `{error: no_mcp_listener}` del bridge MCP — `validate_scene_response` la rellenaba hasta convertirla en escena placeholder ("Un paraje desolado") y el endpoint devolvía 200. Ahora replica el guard de la ruta de visión y el endpoint devuelve 503.
- **§3.1** ruta legacy fuera de `main.gd`; **§3.3** convención de logging en CLAUDE.md.

**Correcciones a la auditoría original**:

- `enemy_combat_ai.gd` **NO está muerto**: `object_spawner.gd:101` lo instancia (`EnemyCombatAIScript.new()`) y `main.gd:684,741` lo consulta por nombre. Se queda.

**Pendiente**:

1. **Fallos preexistentes de `movement_test.py`**: `run_sprint` (1.2 m recorridos, esperado >5 m) y `attack_animation` (pide `quick`, ejecuta `heavy`). Reproducidos también en la rama base sin los cambios de `legacy/retire-generate-room` — defecto real anterior, investigar aparte.
2. **§3.2 / §3.4** — acoplamientos y splits (abajo).
3. **§7 — plugins declarativos**: **F1–F8 completas** (roadmap original cerrado). Único pendiente derivado: evolución en runtime vía `plugin_register` (reemplazar un plugin vigente con una versión mayor + `migrate`; hoy sólo migra en resume).
4. **Unificación de sesiones Godot⇄bridge**: el flujo Godot sigue siendo el bypass de ScenarioRunner (`load_game`) con su sesión GD propia; el mensaje `session_start` de `logic_bridge` no tiene case en el bridge (vestigial, se ignora). Los plugins viven en la sesión del bridge (flujo `start_session`/`resume_session`), así que Godot no los ejercita hasta unificar. El mirror GD ya es compatible v1–v3 (abajo), pero la sesión canónica única sigue pendiente.

(Resueltos: §4.4 con confirmación del usuario; **mirror GD `narrative_state.gd`** — ahora lee schema 1..3 y escribe v3 preservando en `_extra_fields` los campos que no modela (`world_map`, `plugins`, futuros), verificado con round-trip real de un save v3 del bridge y upgrade v1→v3.)

### Siguiente objetivo: evolución de plugins en runtime (post-§7)

El roadmap §7 (F1–F8) está **cerrado**. F8 cerró el ciclo con un plugin `commerce` v1 shipped real (`data/games/tavern_intro/plugins/commerce.json`) probado end-to-end. Lo único que queda del diseño §7.3 "Evolución" es el caso **runtime**: hoy la migración v→v+1 sólo opera en **resume** (`bindPluginsForResume`); un `plugin_register` con `version` mayor que el plugin vigente añadiría un segundo record coexistente en lugar de migrar y reemplazar. Implementarlo significa: en `registerRuntimePlugin`, detectar mismo `name` con `version` mayor que un record activo, ejecutar `migrate` sobre su slice (reutilizando `runMigrationStep`) y sustituir el record (igual que el resume), o rechazar si la cadena no cubre el salto. Opcional; el resto del sistema de plugins es funcional sin esto.

---

## 3. Modularidad — restos

### 3.2 Acoplamiento entre capas

- **`nefan-core` ↔ HTML**: `bridge-client.ts` importa con ruta relativa `../../../nefan-core/src/protocol/messages.js`. Considerar paquete local (`file:../nefan-core`) o alias TS `paths`. No urgente.
- **`ai_server` ↔ `narrative-mcp`**: contrato WebSocket sin schema central. Añadir tipos compartidos (JSON Schema en `nefan-core/data/`, generador para Python + TS) si esto crece.

### 3.4 Tamaños y splits

- `godot/scripts/main.gd` (~1200 líneas): candidato a extraer `consequence_applier.gd` y/o `scene_loader.gd`.
- `ai_server/main.py` (~870 líneas tras esta rama): router-split de FastAPI por dominio; `routers/diagnostic.py` ya marca el patrón.
- `nefan-core/bridge/ws-server.ts` (~850 líneas): split por dominio (`handlers/scene.ts`, `handlers/dialogue.ts`, `handlers/session.ts`). No urgente.

---

## 7. Arquitectura objetivo: estado extensible por plugins declarativos

> **Estado 2026-06-23 (5ª pasada)**: **F1–F8 completas** (roadmap §7 cerrado). F1–F4 en `plugins/f1-f4`; F5 en `plugins/f5-plugin-register` (`registerRuntimePlugin` + endpoints `/plugins`, tools MCP `plugin_register`/`plugin_list`, manifest embebido en el save); F6 (`serializeForLlm()` proyecta `derived_views`, tool `plugin_inspect` + `GET /plugins/{id}/inspect`); F7 (migración de slice en resume vía `migrate[v]`); **F8** (plugin `commerce` v1 shipped real en `data/games/tavern_intro/plugins/commerce.json`, en `plugins/f8-commerce`). 268 tests en verde + smokes reales (registro por HTTP, `inspect` por HTTP, migración v1→v2 vía loader de FS, y commerce end-to-end: génesis → `market_open` → `trade_offered`→`trade_completed` → save/resume). Pendiente sólo la evolución en **runtime** (arriba).
>
> **Amendments de la implementación** (donde la realidad afinó esta spec):
> - El manifest gana `writes: string[]`: §7.5 dice "sólo escribe en su slice" pero el ejemplo commerce de §7.7 hace `dec player.gold`. Los efectos escriben en `slice.*` libremente y en paths externos sólo si están declarados en `writes` (validación estática + runtime), con whitelist dura adicional en el dispatcher (`player.gold|health|level|inventory`, `entities[i].data.*`).
> - Regla path-vs-literal en strings del DSL: raíz ∈ {event, slice, world, player, entities, plugins, _, entity, acc} ⇒ path; si no ⇒ literal. `'comillas simples'` o `{$lit: …}` fuerzan literal.
> - `PluginRecord` persiste también `name` (correlaciona save⇄FS en los errores de integridad de resume).
> - La consequence es `{type: "plugin_event", plugin_id, event_type, payload}` (snake_case; `event_type` para no colisionar con el discriminante `type`).
> - Alcance de eventos en F4: los plugins sólo ven consequences `plugin_event` (LLM o map triggers) y los `emit_event` derivados. El hot loop de input (nivel 1) no se ofrece a plugins — diseño de batching pendiente para una fase posterior.
> - Integridad en resume: manifest del FS casado por id; manifest borrado ⇒ resume abortado; plugin nuevo en FS ⇒ warning sin activar (génesis sólo en sesión nueva). Mismo `name` con hash distinto ⇒ **migración F7** (ver abajo) si el FS sube de versión con cadena `migrate` completa; si no (misma versión sin bump, degradación, o hueco en la cadena) ⇒ resume abortado fail-loud.
> - F7: la migración en resume es **slice-only** (`runMigrationStep` aplica `migrate[v]` con WriteAuth vacía ⇒ escribir fuera de slice o emitir eventos lanza; re-aplicarlo en cada resume doblaría efectos externos). La guarda se duplica estáticamente en `validateManifestStatic` (rechaza migrate con path externo o `emit_event`). El record migrado adopta el id/version/slice nuevos preservando `name`/`origin`/`activated_at`, así el siguiente resume casa por id sin re-migrar (idempotente). Evolución en runtime vía `plugin_register` aún pendiente (ver "Siguiente objetivo").
> - F8: el commerce shipped añade un evento **`market_open`** al ejemplo §7.7 (que sólo sembraba mercados por `projections` en génesis). En open-world los mercaderes spawnean DESPUÉS de la génesis, así que el motor narrativo registra el mercado en runtime con `plugin_event commerce market_open {market_id, name, stock}`; las `projections` quedan como atajo para mercaderes presentes al iniciar. El patrón end-to-end queda en §7.7.
> - F6: el bloque de plugins en `LlmContext` es un **array** `plugins: [{id, name, version, views}]` (la spec §7.6 lo dibujaba como objeto indexado por nombre; array evita colisiones de nombre y casa con `entities`). `views` mapea nombre de `derived_view` → su valor evaluado, o `{_error}` si la vista lanza en runtime (no tumba el turno narrativo). `plugin_inspect(plugin_id, view?)`: con `view` devuelve `result`; sin `view`, el `slice` completo + `available_views`. La evaluación de vistas necesita el manifest: los shipped lo toman del `activePlugins` del bridge, los de IA del manifest embebido en el `PluginRecord` (lógica pura en `src/plugins/views.ts`).

**Contexto y motivación.** Ne-fan es open-world generativo: el motor narrativo crea entidades en runtime y, a medida que la partida deriva en una dirección no anticipada (el jugador se centra en comercio, magia, política…), hace falta materializar **sistemas completos** que el motor genérico no cubre. La opción ambiciosa (código TS real generado por el LLM en un sandbox V8/WASM) introduce infraestructura nueva y problemas de seguridad/persistencia. Esta sección describe el camino **declarativo puro**: cada plugin es un manifest JSON que un intérprete del motor en `nefan-core` ejecuta. El LLM (o un developer) describe *qué pasa cuando*, no *cómo*. El precio es expresividad acotada; el premio es sandbox automático, saves deterministas y migración por construcción.

Tres decisiones tomadas para esta propuesta:
- **Genesis dual**: un plugin puede venir de un developer (commit en `nefan-core/data/games/{gameId}/plugins/*.json`) o de la IA en runtime (vía tool MCP `plugin_register`). Mismo formato, mismo registry; sólo cambia la persistencia (los shipped se releen del FS; los runtime viven en `NarrativeState.plugins[]`).
- **Multi-consumer permitido**: dos o más plugins pueden consumir el mismo evento. Orden alfabético por `plugin_id` (determinístico, documentado). Si B necesita ver el resultado de A, B se suscribe a un evento que A emita, no al evento original.
- **Manifest determinista**: `plugin_id = sha256(canonical_json(manifest \ origin))`. Mismo manifest ⇒ mismo id, independientemente de quién o cuándo lo creó. La `version` semántica la asigna el autor; el hash protege contra divergencia accidental.

### 7.1 Anatomía del `PluginManifest`

JSON con los campos siguientes (zod schema vivirá en `nefan-core/src/plugins/types.ts`):

```
id              sha256 del manifest canónico (sin `origin`). Calculado, no escrito a mano.
version         entero. Sube cuando cambia el comportamiento; cada bump requiere `migrate`.
name            nombre humano ("Sistema de comercio").
description     una frase para el LLM (qué ofrece, cuándo activarlo).
origin          { author: "developer" | "narrative_engine",
                  session_id?: string,
                  triggered_by_event?: string,
                  rationale: string }  // metadatos; no participa del hash
slice           { schema: JSONSchema, initial: unknown }
                // shape del slice de estado del plugin, valor inicial vacío
reads           string[]  // paths que el plugin puede leer fuera de su slice
                          // ej. ["player.gold", "entities[].data.inventory"]
events_consumed Array<{ type, when?: Predicate, do: Effect[] }>
events_produced string[]  // tipos de evento que este plugin emite
projections     Array<{ source, rule }>
                // cómo derivar el slice inicial desde el estado pre-existente
                // ej. recorrer entities[] y marcar mercaderes
derived_views   Array<{ name, rule }>
                // proyecciones que `serializeForLlm()` añade al contexto
                // ej. "active_markets" lista mercados con stock > 0
migrate?        Record<fromVersion, Effect[]>
                // reglas para convertir slice viejo al shape de esta versión
fixtures        Array<{ before: SliceSnapshot, event, after: SliceSnapshot }>
                // 2-3 escenarios test que el validador ejecuta antes de activar
```

`origin` se persiste por trazabilidad pero **no entra en el hash**. Esto garantiza que el mismo `commerce v1` generado en sesiones distintas tenga el mismo `id`, y que un developer pueda "adoptar" un plugin emergido en runtime sin que cambie su identidad.

### 7.2 Mini-DSL (techo de expresividad)

Lo que **sí** ofrece:

- **Paths**: dot-notation contra un contexto `{event, slice, world, player, entities, plugins}`. Interpolación con `{}`: `slice.markets.{event.market_id}.stock.{event.item_id}`. Indexación `[i]`, comodín `[*]`.
- **Predicados**: `{op, path, value}` con `op ∈ {eq, neq, gt, gte, lt, lte, in, has, matches}`. Combinables con `{all: [...]}`, `{any: [...]}`, `{not: ...}`.
- **Efectos**: `set | inc | dec | mul | push | pull | remove | emit_event`. `emit_event` toma `{type, payload}`; el dispatcher lo encola con prioridad "side-effect".
- **Expresiones de valor**: literales, paths del contexto, aritmética binaria (`+ - * /`), `min/max/clamp`, `len`, `concat`, `coalesce`.
- **Iteración acotada**: `map/filter/reduce` sólo sobre arrays accesibles por path. Sin loops generales, sin recursión.
- **Aleatoriedad determinista**: `random(seed_path, low, high)` — el seed se deriva del estado, así dos replays del mismo log dan el mismo resultado.

Lo que **no** ofrece (escape hatch al core):

- Definir funciones, llamarse a sí mismo, mantener estado fuera del slice.
- Llamadas HTTP, lectura de FS, acceso a `crypto`/`Date.now()`/`Math.random()` directos.
- Modificar el slice de otro plugin (sólo lectura, vía `reads`).

Si una mecánica supera este techo (ej. pathfinding, simulación física, búsqueda heurística), pertenece al core en `nefan-core/src/simulation/` y el plugin se limita a leer su resultado.

### 7.3 Ciclo de vida de un plugin

**Génesis (developer)**: archivo `nefan-core/data/games/{gameId}/plugins/{name}.json`. Se carga en `start_session` y `resume_session`. El hash se calcula al cargar; si difiere del esperado, error de integridad.

**Génesis (motor narrativo)**: tool MCP `plugin_register(manifest)`. El bridge:
1. Valida con zod el shape del manifest.
2. Calcula el hash, lo asigna como `id`.
3. Ejecuta `fixtures` (replay determinista): cada fixture aplica el evento al `before` y comprueba que el resultado iguale `after`. Falla ⇒ rechaza el plugin con `narrative_status: error`.
4. Ejecuta `projections` sobre el estado actual para poblar el slice inicial.
5. Persiste en `NarrativeState.plugins[id] = {manifest, slice, activated_at}` y emite `plugin_activated`.

**Evolución**: la IA o el developer publican `commerce v2` (manifest distinto ⇒ hash distinto). El runtime detecta el `id` nuevo, ejecuta `migrate[1]` para convertir el slice v1 → v2, sustituye en el registry. El `id` antiguo queda en saves históricos pero no se carga si ya hay v2 vigente.

**Desactivación**: `plugin_unregister(pluginId)` borra el slice y deja constancia en `dialogue_history` (auditable). Los eventos emitidos posteriormente que apunten a ese plugin caen silenciosamente — registrados, no aplicados.

**Lectura**: cualquier código del core o de otro plugin puede leer vía `store.selectPlugin(pluginId, path)`. La escritura sólo ocurre por el dispatcher al aplicar reducers del propio plugin.

### 7.4 Dispatcher: cola serial con prioridades

Tres niveles de prioridad, FIFO dentro de cada nivel:
1. **Input runtime** (combat, movement): no esperan, se aplican y propagan al `GameStore`.
2. **Narrative consequences** (lo que devuelve `report_player_choice`): se aplican en orden de llegada.
3. **Plugin side-effects** (`emit_event` desde un reducer): se encolan al final del tick actual y se procesan después de los dos anteriores.

Para una acción/evento dado: primero la procesa el core (combat resolver, movement, etc.), luego se ofrece a **todos** los plugins cuyo `events_consumed` la incluye. Orden entre plugins: alfabético por `plugin_id` (hash → orden determinístico independiente de cuándo se registró cada uno). Si un plugin `emit_event`, el evento entra en la cola de nivel 3 y será procesado por **todos** los plugins suscritos a él (incluido el emisor, sin protección contra ciclos — el techo del DSL lo evita en la práctica, pero ver §7.9).

**Aislamiento**: cada reducer recibe un proxy con sólo `{event, slice, reads_resolved}`. Cualquier intento de path no declarado en `reads` falla en validación estática (al `plugin_register`, no en runtime).

### 7.5 Determinismo y conflictos

**Determinismo del manifest**:
- Hash = `sha256(canonical_json(manifest \ origin))`. Canonical = claves ordenadas, sin whitespace, números normalizados, arrays preservados en orden.
- Implicación: dos sesiones que reciban el mismo manifest (mismas reglas exactas) comparten id, slice schema, comportamiento. El `origin` (quién lo generó y por qué) se persiste sólo para auditoría.
- Esto habilita un registry global futuro (`nefan-core/data/plugin_registry/{id}.json`) donde los plugins emergidos por la IA se "promocionan" a shipped sin migración.

**Conflictos multi-consumer** (permitidos):
- Plugin A y B ambos consumen `gold_changed`. Ambos ejecutan sus efectos en el mismo tick. El orden entre A y B es alfabético por hash (determinístico).
- Si A escribe a su slice y B necesita verlo, B no debe consumir `gold_changed`: debe consumir un evento que A emita (`a_processed_gold`). Esto deja el grafo de dependencias explícito y trazable.
- Conflictos *intencionados* sobre el mismo path del estado externo (`reads`) están permitidos por construcción: cada plugin sólo escribe en su propio slice; sobre el resto sólo lee.

### 7.6 Persistencia y serialización

```
SessionData {
  ...
  plugins: Array<{
    id: string,             // sha256 del manifest sin origin
    version: number,
    slice: unknown,         // estado vivo, conforma con manifest.slice.schema
    origin: PluginOrigin    // trazabilidad: quién/cuándo/por qué
  }>
}
```

Los manifests de **plugins shipped** no se persisten en el save (se cargan del FS por `id` esperado). Los manifests de **plugins generados por IA** sí se persisten enteros junto al slice — esto es lo que permite cargar saves antiguos en clientes que nunca vieron ese manifest.

`serializeForLlm()` itera `plugins[]` activos y añade un bloque `plugins: {commerce: {summary: ..., active_markets: [...]}}` derivado de `derived_views`. Esto evita inyectar slices enteros (un mercado con 500 ítems es ruido) y deja al LLM elegir qué pedir en detalle vía tool MCP `plugin_inspect(pluginId, view)`.

`SCHEMA_VERSION` (`narrative-state.ts:5`) sube a 3. Migración v2 → v3: añadir `plugins: []` vacío.

### 7.7 Ejemplo: `commerce` v1 paso a paso

Manifest (simplificado):

```json
{
  "name": "Sistema de comercio",
  "description": "Mercados, precios dinámicos, préstamos. Activar cuando el jugador comercia repetidamente.",
  "version": 1,
  "origin": {
    "author": "narrative_engine",
    "session_id": "1736...-3a2f",
    "triggered_by_event": "evt_0042",
    "rationale": "El jugador ha hecho 5 trueques con el herrero; el motor genérico no modela inventarios de NPCs."
  },
  "slice": {
    "schema": { "type": "object", "properties": {
      "markets": { "type": "object" },
      "loans":   { "type": "array" }
    }},
    "initial": { "markets": {}, "loans": [] }
  },
  "reads": ["entities[*].data", "player.gold", "player.inventory"],
  "events_consumed": [
    {
      "type": "trade_offered",
      "when": { "all": [
        { "op": "has", "path": "event.market_id" },
        { "op": "gt",  "path": "slice.markets.{event.market_id}.stock.{event.item_id}", "value": 0 },
        { "op": "gte", "path": "player.gold", "value": "event.price" }
      ]},
      "do": [
        { "op": "dec", "path": "slice.markets.{event.market_id}.stock.{event.item_id}", "value": 1 },
        { "op": "dec", "path": "player.gold", "value": "event.price" },
        { "op": "push", "path": "player.inventory", "value": { "id": "event.item_id", "from": "event.market_id" } },
        { "op": "emit_event", "value": { "type": "trade_completed", "payload": { "market_id": "event.market_id", "item_id": "event.item_id", "price": "event.price" } } }
      ]
    }
  ],
  "events_produced": ["trade_completed", "loan_defaulted"],
  "projections": [
    {
      "source": "entities",
      "rule": {
        "filter": { "op": "eq", "path": "entity.data.role", "value": "merchant" },
        "for_each": {
          "set": "slice.markets.{entity.id}",
          "value": {
            "owner_id": "entity.id",
            "name": "entity.data.name",
            "stock": "entity.data.inventory",
            "prices": {}
          }
        }
      }
    }
  ],
  "derived_views": [
    {
      "name": "active_markets",
      "rule": { "map": "slice.markets[*]", "to": { "id": "_.owner_id", "name": "_.name", "items": "len(_.stock)" } }
    }
  ],
  "fixtures": [
    {
      "before": { "markets": { "blacksmith_01": { "stock": { "iron_sword": 2 } } } },
      "event":  { "type": "trade_offered", "market_id": "blacksmith_01", "item_id": "iron_sword", "price": 50 },
      "context": { "player": { "gold": 100, "inventory": [] } },
      "after":  { "markets": { "blacksmith_01": { "stock": { "iron_sword": 1 } } } }
    }
  ]
}
```

Materialización:
1. La IA registra el manifest vía MCP. El bridge valida shape + fixtures, calcula `id = sha256(...)`, ejecuta `projections` sobre `entities` actuales — el herrero ya conocido se convierte en `markets.blacksmith_01` con stock derivado de su `data.inventory`.
2. La siguiente vez que el jugador elige "comprar la espada", la consecuencia de la IA incluye `{kind: "plugin_event", pluginId: "commerce", type: "trade_offered", payload: {...}}`.
3. El dispatcher pasa el evento al plugin. Predicate `when` se evalúa OK. Efectos: stock -1, gold del jugador -50, inventario +espada, `trade_completed` emitido.
4. Otros plugins suscritos a `trade_completed` (ej. `reputation` v1) lo procesan en el tick siguiente.
5. `serializeForLlm()` añade `plugins.commerce.active_markets` al contexto; la IA puede pedir detalle con `plugin_inspect`.

**Patrón shipped (F8, implementado).** El commerce real vive en `nefan-core/data/games/tavern_intro/plugins/commerce.json` y el bridge lo carga/activa en `start_session` como cualquier plugin de developer. Cómo lo conduce el motor narrativo, en orden:

1. **Abrir mercado** (cuando aparece un mercader, p.ej. tras un `spawn_entity`): emitir `{type: "plugin_event", plugin_id: "<id de commerce>", event_type: "market_open", payload: {market_id, name, stock: {item: cantidad, …}}}`. El plugin crea `slice.markets[market_id]`. (Si el mercader ya existía al iniciar sesión con `data.role = "merchant"`, las `projections` lo siembran solo en génesis y este paso sobra.)
2. **Descubrir qué hay**: `plugin_list` da el `plugin_id` y los `events_consumed` (`market_open`, `trade_offered`); el bloque `plugins[]` del contexto (F6) muestra `active_markets`; `plugin_inspect(id, "active_markets")` o sin vista el slice completo.
3. **Comprar**: emitir `event_type: "trade_offered", payload: {market_id, item_id, price}`. El `when` exige mercado con stock>0 y `player.gold ≥ price`; si no se cumple es no-op silencioso (registrado, no aplicado). Efectos: stock −1, `player.gold` −price, push a `player.inventory` `{id, from}`, y emit `trade_completed`.
4. **Persistencia**: el slice de mercados vive en el save; al reanudar, el plugin shipped se rebindea por id desde el FS y el estado continúa. Si se publica `commerce v2`, el resume migra el slice con `migrate` (F7).

Verificado end-to-end en `nefan-core/test/plugin-commerce.test.ts` (carga real del FS + génesis + `market_open` + `trade_offered`/`trade_completed` + oro insuficiente/mercado inexistente no-op + save/resume con segunda compra).

### 7.8 Fases de implementación

Cada fase es ejecutable de forma independiente y deja el código en estado coherente.

| Fase | Alcance | Esfuerzo |
|---|---|---|
| **F1 — Tipos + registry vacío** ✅ | `nefan-core/src/plugins/types.ts` (zod schemas). `NarrativeState.plugins: Plugin[] = []`. `SCHEMA_VERSION = 3` + migración trivial. Sin runtime. | S |
| **F2 — Validador del DSL** ✅ | `dsl/evaluate.ts` con predicados, paths, efectos. Tests unitarios sobre fixtures hardcoded. Sin integración aún. | M |
| **F3 — Loader de plugins de developer** ✅ | Lectura de `data/games/{gameId}/plugins/*.json` en `start_session`. Validación de hash. Ejecución de `projections` iniciales. | S |
| **F4 — Dispatcher integrado** ✅ | Cola serial + prioridades en el bridge. Eventos del core ofrecidos a plugins. Efectos aplicados a slices. Tests end-to-end con un plugin "test_counter" trivial. | M |
| **F5 — Tool MCP `plugin_register`** ✅ | Validación, fixtures dry-run, persistencia en `NarrativeState`. Plugin emergido sobrevive `save/load`. | M |
| **F6 — `serializeForLlm` + `plugin_inspect`** ✅ | `derived_views` proyectados al contexto (bloque `plugins[]`). Tool `plugin_inspect(plugin_id, view?)` + endpoint `GET /plugins/{id}/inspect` para detalle (vista o slice completo). | S |
| **F7 — Evolución + `migrate`** ✅ | Detección v→v+1 en resume, fixtures de la nueva versión validadas al cargar, ejecución de `migrate[v]` slice-only para convertir el slice (idempotente). Runtime evolution vía `plugin_register` aún pendiente. | M |
| **F8 — Plugin `commerce` real** ✅ | Manifest commerce v1 shipped (`data/games/tavern_intro/plugins/commerce.json`), probado end-to-end (génesis + `market_open` runtime + `trade_offered`→`trade_completed` + save/resume). Patrón documentado abajo. | M |

F1+F2 son inversión sin retorno visible para el usuario; a partir de F3 ya hay valor de developer; F5 desbloquea la IA.

### 7.9 Riesgos asumidos / pendientes

- **Ciclos de eventos**: A consume `x` y emite `y`; B consume `y` y emite `x`. Defensa: contador de re-emisiones por tick (límite 16, configurable); al excederlo, el dispatcher aborta el tick con `narrative_status: error` y log del ciclo. Detectable estáticamente en `plugin_register` si los emisores se conocen.
- **Slices grandes en saves**: un plugin mal diseñado puede crecer sin cota (ej. `transactions[]` que acumula todo el histórico). Mitigación: cada manifest declara `slice_size_hint`; el bridge avisa cuando se rebasa 10×.
- **Compatibilidad cross-game**: dos juegos pueden tener `commerce v1` con manifests distintos (hash distinto). Bien — son plugins distintos por construcción. El registry global futuro (§7.5) puede ofrecer un "commerce canónico" que ambos juegos adopten si lo desean.
- **Determinismo de `random(seed_path, ...)`**: el seed debe derivarse de paths estables (no `Date.now()`). Validador rechaza manifests que usen seeds volátiles.
- **Schema evolution del slice**: si el `schema` cambia entre v1 y v2 sin `migrate`, el slice viejo no valida. Hay que enforce `version` bump ⇒ `migrate[v-1]` obligatorio.
- **Genesis del developer vs IA con mismo nombre**: dos plugins distintos con `name: "commerce"` pueden coexistir si sus `id` (hash) difieren. La UI tendrá que distinguirlos por `origin.author`.

### 7.10 Encaje con el resto de la auditoría

> **Cerrado**: §1.2 (`GameState` eliminado), §1.3 (proyección `enemies_projected`) y §2 (fail-loud uniforme) ya están implementados. El único saneamiento previo que queda es §4 (este documento, siguiente objetivo): retirar la bifurcación legacy antes de que el plugin system se construya sobre `NarrativeState`.
