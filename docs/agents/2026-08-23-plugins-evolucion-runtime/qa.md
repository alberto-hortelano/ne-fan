# QA — plugins: evolución en runtime (#164)

Rama `fix/plugins-evolucion-runtime` @ `eebe7ea`, PR #227. Validado contra la petición
original (vaciar la cola de issues; issue #164 con sus 10 criterios) **desde el punto de
vista de quien juega**.

Guion ejecutable sembrado: **`qa/guiones/14-plugin-evoluciona-sin-perder-la-partida.mjs`**
(24 asertos; 22 en verde, 2 en rojo por el hallazgo H1). Corrida de referencia:
`node qa/run.mjs 14-plugin`. Capturas en `qa/capturas/14-plugin-*`.

---

## 1. La pregunta del jugador, primero

> «El oro y el inventario tienen que sobrevivir a la migración.»

**Sobreviven.** Partida real de `toledo_1200` (preset `e2e-sin-creditos`, cero créditos),
jugador andando con `W`, mercado abierto por un map trigger del motor:

| Momento | oro | inventario | stock del mercado |
|---|---|---|---|
| tras comprar la 1.ª espada (commerce **v1**) | 80 | 1 espada | 3 → **2** |
| tras `plugin_register` de commerce **v2** | **80** | **1 espada** | **2** (+ `fiado: 0` nuevo) |
| tras comprar la 2.ª espada (ya en v2) | **60** | **2 espadas** | 2 → **1** |
| tras save→resume de esa misma sesión | 60 | 2 espadas | 1, y `events_consumed` incluye `fiar` (solo existe en v2) |

Save leído del disco después (`qa/.tmp/…/saves/…/state.json`):

```
player.gold = 60 | inventory = [espada_ropera, espada_ropera]
- commerce v2 origin=narrative_engine manifest_embebido=True manifest_v=2
  slice={"markets":{"qa_herreria":{…"stock":{"espada_ropera":1,"daga":2}}},"fiado":5}
total records: 2        ← uno por sistema, no dos por sistema
```

**Y en `main` eso no pasa** (prueba en negativo, los 6 ficheros de producción de la PR
revertidos a `main` y el mismo guion): quedan **cinco** records de plugin (`commerce v1`,
`commerce v2`, `commerce v4`, `commerce v1`, `qa_arcas`), la segunda compra **no ocurre**
—el tick entero aborta y el jugador se queda sin espada y sin que le cobren—, y los tres
saltos ilegales (v2→v4 sin cadena, degradación, reintento) devuelven **200 OK**.

---

## 2. Criterios de aceptación

| # | Criterio | | Evidencia |
|---|---|---|---|
| 1 | Mismo `name` + versión mayor **migra y sustituye**; id/version/slice nuevos; `name`/`origin` preservados; nunca dos records del mismo name | ✅ (con desviación declarada en `origin`) | Guion 14: `action:"migrated"`, `from_version:1`, `GET /plugins` con **una** entrada `commerce v2`; save en disco con 1 record y `activated_at` intacto. `origin` pasa a `narrative_engine` **a propósito** (ver §4) y `docs/arquitectura/plugins.md` ya dice «preservando `name` y `activated_at`», no `origin` |
| 2 | Cadena incompleta → fail-loud, mismo texto que el resume | ✅ | Guion 14: `400 {"error":"falta 'migrate[2]' en 'commerce' para evolucionar v2→v4 (…)"}`. Los 3 tests de resume (`/falta 'migrate\[1\]'/`, `/mantiene version 1/`, `/ANTERIOR al del save/`) **no se editaron**: bloque `describe("plugin migration on resume (F7)")` byte-idéntico entre `main` y `HEAD` (`diff` sobre el bloque extraído: sin diferencias) |
| 3 | Versión menor o igual se rechaza | ✅ | Guion 14: re-registrar el manifest v1 tras migrar → 4xx, partida intacta. Tests de paridad `no_bump` y `downgrade` comparan el mensaje con `assert.equal` contra el del resume |
| 4 | `name` distinto sigue siendo un plugin nuevo | ✅ | Guion 14: `qa_arcas` se registra `action:"created"` al lado de `commerce`; test «un `name` distinto se registra al lado» |
| 5 | Slice-only reutilizando `runMigrationStep`, sin evaluador paralelo | ✅ | `grep -rn runMigrationStep src/ bridge/ services/` = **2** sitios de producción (`dsl/evaluate.ts` que lo define, `plugins/migrate.ts` que lo usa). Regla `cadena-de-migracion-unica` **probada en negativo sobre el árbol real** (ver §3.1) |
| 6 | Tras migrar, el resume sigue siendo idempotente | ✅ | `resume_session` real sobre el save vivo → `commerce v2 (narrative_engine) consume=["market_open","trade_offered","fiar"]` y slice idéntico. Test C6 **probado en negativo** (ver §3.3) |
| 7 | Tests por el camino EMBEBIDO en `plugin-migrate.test.ts` | ✅ | +19 casos (de 6 a 25). Juicio sobre su calidad en §5 |
| 8 | `npm run verify` verde, deuda sin crecer, mutantes del módulo tocado muertos | ✅ / ⚠️ | Reproducido: `npm test` **1126/1126**; `npm run crap -- --check` **✔ dentro de los umbrales** (90,4 % cobertura, 0 sobre el tope, 11 sobre el objetivo — la línea base); `npm run deuda` **31 items** (7+15+9), clavado. **⚠️ No probado**: el 100 % de mutación de `migrate.ts` — la config era de un solo uso y se borró (§7) |
| 9 | `plugins.md` deja de decir «pendiente» | ✅ | `git diff main...HEAD -- docs/arquitectura/plugins.md`: la frase final y el bullet entero fuera; `next.md` en sus 4 sitios también |
| 10 | CI de la PR en verde | ✅ | `gh pr checks 227`: ai-server, narrative-mcp, nefan-core, nefan-html — **4/4 pass** |

---

## 3. Las tres cosas que había que poner a prueba

### 3.1 «Un solo juez» — ¿muerde la regla? ¿hay una segunda vía?

**La regla muerde.** Añadí a mano `import { runMigrationStep } from "./dsl/evaluate.js";` en
`src/plugins/register.ts` (el árbol real, no una fixture) y `npm test` se puso rojo:

```
✖ [error] cadena-de-migracion-unica
  nefan-core/src/plugins/register.ts:34 — patrón prohibido: "runMigrationStep"
ℹ pass 32 · fail 1
```

Revertido; verde otra vez (33/33). La regla salta con el **import solo**, sin necesidad de
llamada, que es lo que se quiere.

**No hay una segunda vía de decidir el salto.** `grep` de comparaciones de versión sobre
`src/plugins/**`, `bridge/state-http-server.ts`, `bridge/ws-server.ts` y
`narrative-state.ts`: las únicas comparaciones `to < from` / `to === from` viven en
`migrate.ts`. `loader.ts` y `register.ts` solo envuelven el error. El State API no mira
versiones (`pluginRegisterBody` solo traduce campos).

**Con un matiz que hay que decir** (hallazgo H7): la regla corta la **cadena**
(`runMigrationStep`), no la **política**. Un `if (manifest.version <= prior.version) throw …`
copiado dentro de `register.ts` no la dispararía; solo lo cazarían los tests de paridad, y
únicamente si el texto difiere. El candado es bueno pero no es exactamente el que dice su
nombre.

### 3.2 El trampantojo del manifest — ¿se puede construir a mano?

**Por la puerta que el arreglo canda, no.** Rompí a mano el candado en
`narrative-state.ts` (assert de hash anulado + el manifest viejo conservado bajo el id
nuevo, que es exactamente el «arreglo verde que no entrega» del riesgo R1) y **4 tests se
pusieron rojos**, incluido el de comportamiento:

```
✖ migra el slice y SUSTITUYE el record
✖ tras migrar, el resume sirve las reglas NUEVAS y es idempotente
✖ el motor puede tomar un plugin SHIPPED…
✖ migratePluginRecord rechaza un manifest embebido que no es el del id
```

**Pero el candado es de una sola puerta** (hallazgo H4). Sonda ejecutada contra los módulos
reales:

```
PUERTA A (addPlugin): ACEPTADO sin quejarse. record.version=2 | manifest.version=1
  | hash(manifest)=50857ead2a3a ≠ id 54d8a9687a66
  → dispatch level_up = {"code":"not_consumed"}   (sirve reglas VIEJAS bajo el id nuevo)
PUERTA B (save manipulado): loadSession → true | record v2 manifest v1
  → dispatch level_up = {"code":"not_consumed"}
PUERTA C (manifest.id mentiroso): ACEPTADO — computePluginId ignora el campo `id`
```

Ninguna es alcanzable desde el código de producción de hoy (`registerRuntimePlugin` siempre
construye `normalized` con el id calculado), así que **no es el hallazgo de la tanda**; pero
`addPlugin` no tiene el assert que sí tiene su hermano, y `bindPluginsForResume` —el único
que LEE el manifest embebido— se lo cree sin comprobar el hash. El candado está puesto donde
el ingeniero escribió, no donde el dato se consume.

### 3.3 La idempotencia, ¿prueba algo?

**Sí.** `level_up` existe **solo** en el manifest v2 del test (`R1.events_consumed` = `add`;
`R2` = `add` + `level_up`), y el test falla de verdad sin migración: con el trampantojo de
§3.2 puesto, el aserto revienta con el motivo exacto, no por un campo:

```
AssertionError: el resume debe servir reglas v2:
  {"code":"not_consumed","pluginId":"54d8a968…","type":"level_up"}
```

Y lo mismo comprobado **fuera de los tests**, sobre el stack vivo: el `resume_session` de la
sesión real devuelve `consume=["market_open","trade_offered","fiar"]` — `fiar` es un evento
que el `commerce.json` del disco no tiene.

---

## 4. La desviación de `origin`, juzgada

El criterio 1 dice «preserva `name` y `origin`». La implementación **no** preserva `origin`
en el camino runtime: pasa a `narrative_engine`. Lo doy por **bueno**, y la razón es la del
jugador vista desde el motor: el único lector de ese campo es `origin_author` en
`GET /plugins`, o sea *quién pone las reglas de este sistema*. Tras la migración las reglas
las pone el manifest embebido en el save, y el JSON del disco no manda nada; decir
`developer` sería mentir en el único sitio donde el motor mira. El resume por FS sí lo
preserva, y la asimetría está escrita en cada call site (`migratePluginRecord` exige
`origin`, no lo deduce) y en `docs/arquitectura/plugins.md`. Es una desviación **declarada**,
no un descuido.

---

## 5. Los tests, ¿comportamiento o líneas?

Leídos los 19 casos nuevos. **No hay maquillaje**, pero sí una mezcla:

- **Comportamiento de verdad (los que valen)**: la migración con el slice YA movido (migrar
  sobre `{}` no distinguiría migración de génesis); el resume que despacha un evento que solo
  existe en v2; el secuestro de un shipped comprobado hasta el resume; la idempotencia con el
  slice movido (R4 del plan: si `unchanged` re-proyectara, un reintento del motor reseteaba
  el oro); el rechazo que no deja el estado a medias; `migrate: {"1": []}` cuenta como hueco;
  qué puede LEER una migración (`world`/`player`/`entities` y los slices vecinos).
- **Escritos para el mutante, y se nota**: tres asertos fijan el mensaje de rechazo
  **entero, palabra por palabra**, incluida la prosa final («…o inicia sesión nueva.»,
  «…o vuelve al manifest original.»). La mitad útil (nombre del plugin, las dos versiones,
  `migrate[N]`, el `kind`) es contrato; la otra mitad es una redacción, y hoy una corrección
  de estilo rompe tres tests. Coste asumible, pero es exactamente el patrón «matar un
  StringLiteral» — y de ahí salieron. Igual `assert.equal(err.name, "PluginMigrationError")`.
- **El punto ciego que el 100 % de mutación no enseña** (hallazgo H6): **ninguna prueba
  ejerce una cadena de más de un paso con ÉXITO**. Los cuatro `version: 3` del fichero están
  ahí para provocar el rechazo por hueco. El bucle `for (v = from; v < to; v++)` nunca se
  recorre dos veces con los dos `migrate` presentes, que es justo lo que la descripción de la
  tool le vende al motor (`migrate["1"]+migrate["2"] to go 1→3`). Lo probé yo a mano y
  **funciona** (`{points:7}` → `{points:7, rango:"novato", sello:7}`, un record, `from:1 → v3`),
  así que es hueco de cobertura, no defecto. Que el score de mutación sea 100 % y esto no
  aparezca es el mejor argumento de que el score mide otra cosa.

---

## 6. Hallazgos

### H1 · **Importante** — Migrar deja muertos los `plugin_id` que el motor ya dejó escritos en el mapa

El `plugin_id` es el hash del manifest, así que **migrar le cambia el id al sistema**. Todo
lo que el motor haya dejado persistido apuntando al id viejo —los map triggers, que viven en
`world_map.places[].triggers[].consequences[]` del save— queda apuntando a un plugin que ya no
existe. Y el tick de plugins es transaccional: **aborta entero**, así que se pierden también
las consequences de los demás plugins del mismo trigger.

Pasos desde el arranque (es el paso 6 del guion 14, y por eso nace en rojo):

1. `./start.sh --preset e2e-sin-creditos`; partida nueva de `toledo_1200`.
2. El motor crea una zona con un trigger `player_entered` que vende una daga
   (`plugin_event` con el `plugin_id` de `commerce` v1). Es lo normal: se siembra el mapa y
   se sigue narrando.
3. Más tarde el motor evoluciona `commerce` a v2 con `plugin_register` (200 `migrated`).
4. El jugador **llega andando** a esa zona.

Lo que espera el jugador: comprar la daga por 10 monedas. Lo que pasa:

```
oro=60 (antes 60) · inventario sin daga
overlay a pantalla completa: «El motor narrativo rechazó la respuesta»
  plugin unknown_plugin: {"code":"unknown_plugin","pluginId":"c021b490c15cef543b9c34c123f74ae6e7b2d0382cadc9e0b994bd110c14029b"}
```

Captura: `qa/capturas/14-plugin-evoluciona-sin-perder-la-partida-03-tercera-zona-trigger-viejo.png`.
Bridge: `Bridge: plugin tick aborted for map_trigger: { code: 'unknown_plugin', pluginId: 'c021b490…' }`.
Y el save guarda el id muerto para siempre: `qa_zona_mercado.qa_compra_1 → ["710e5392…","c021b490…","c021b490…"]`.

Matices, para dimensionarlo bien:
- El camino FS del resume ya tenía la misma propiedad (migrar también cambia el id), así que
  el fallo es **anterior** a esta PR. Lo que hace #164 es volverlo **rutinario y a mitad de
  partida**: antes un `plugin_register` con versión mayor dejaba vivo el record viejo, y el
  id de los triggers seguía resolviendo (mal, pero resolviendo).
- No lo cubre ningún test: los tests despachan eventos con ids leídos justo después de migrar.
- Dos arreglos posibles y baratos, ninguno en esta PR: reescribir el `plugin_id` viejo → nuevo
  en los triggers al migrar (el mapa lo tiene el bridge delante), o resolver `plugin_id` por
  `name` en el dispatcher.
- El segundo aserto rojo del guion es el mismo hallazgo por su otra cara: **si algo falla, al
  jugador no se le puede enseñar un `unknown_plugin` y un hash de 64 caracteres**. Es primo
  hermano del issue #180 («El error de viaje enseña al jugador un HTTP 500 y un JSON crudo»).

### H2 · **Importante** — El «tercer canal» del secuestro no llega al jugador

`implementacion.md` afirma que el secuestro de un shipped se ve «por tres canales: la
respuesta HTTP (`from_origin_author`), un `console.warn` del bridge, y el `narrative_status`
que ve el jugador». **Los dos primeros los verifiqué; el tercero no existe en la pantalla.**
`ws-server.ts` emite `{phase:"ready", kind:"consequences", message:"Plugin evolucionado:
commerce v1→v2 (sustituye al de disco)"}`, pero `nefan-html/src/main.ts:2076-2176` solo
renderiza `kind:"tile"`, `kind:"scene"`, `phase:"progress"`, `status.spawn` y el bloque final
`if (status.phase === "error")`. Un `ready/consequences` no casa con ninguno y **se descarta
en silencio** — el propio comentario del código lo dice: *«El bridge sólo los emite en
error»*, que dejó de ser cierto cuando F5 añadió «Plugin activado: X». Es decir: el jugador no
se entera nunca de que un sistema del juego cambió de dueño. Canales reales: **2, y los dos
son para máquinas** (la respuesta HTTP al motor y una línea de log).

### H3 · **Menor** — El aviso del resume miente sobre lo que pasó con el plugin secuestrado

Después de que el motor tome `commerce`, cada resume de esa partida imprime:

```
PluginLoader: 'commerce' (c021b490c15c…) está en disco pero no en el save —
  los plugins nuevos sólo se activan en sesión nueva (génesis); ignorado en resume
```

`commerce` no es un plugin nuevo: es el que el motor sustituyó. Quien lea ese log concluirá
que su plugin nunca llegó a activarse, no que fue reemplazado. Es la única señal que queda del
secuestro en los arranques siguientes, y dice lo contrario de lo que pasó. Y **es
irreversible**: el record lleva manifest embebido, así que el `continue` de `loader.ts:189` lo
saca del camino FS para siempre — arreglar el `commerce.json` del disco no devuelve el control
a ese save. El plan lo asumió (ambigüedad A / R3) y mandó abrirlo como issue aparte; **ese
issue no está abierto** (`gh issue list`).

### H4 · **Menor** — El candado manifest↔id está en la puerta que se escribe, no en la que se lee

Detalle y sonda en §3.2. `NarrativeState.addPlugin` acepta un record con un manifest que no
corresponde a su id, y `bindPluginsForResume` —el único consumidor del manifest embebido— lo
usa sin comprobar el hash. Ninguna es alcanzable hoy desde producción, pero el assert cuesta
una línea en cada sitio y el que ya existe demuestra que el equipo lo considera importante.

### H5 · **Menor** — El texto compartido perdió el único puntero a DÓNDE está el manifest ofensivo

Para que el mismo texto valiera en los dos caminos se quitó «en disco», «restaura el archivo»
e «instala una versión». El resultado sigue siendo accionable —nombra el plugin, las dos
versiones y el paso que falta— pero para un developer que hace un resume y se encuentra un
plugin roto ya no dice ni que el manifest está en un fichero ni en cuál de los dos directorios
(`data/plugins/` o `data/games/{id}/plugins/`). El dato existe justo al lado y no se usa:
`LoadedPlugin.file` tiene la ruta y `PluginIntegrityError` ya arrastra `pluginName`/`savedId`/
`fsId`. Lo que llega al usuario es `plugin_integrity: <texto>` y nada más. **Barato de
recuperar sin romper la paridad**: el texto compartido se queda como está y el envoltorio del
resume le añade la ruta.

### H6 · **Menor** — Una cadena `migrate` de más de un paso nunca se prueba con éxito

Detalle en §5. Es la funcionalidad que la descripción de `plugin_register` le vende al motor
y no hay ni un test que la recorra. Funciona (lo comprobé), pero nadie se enteraría si dejara
de hacerlo.

### H7 · **Menor** — `cadena-de-migracion-unica` corta la cadena, no la política

Detalle en §3.1.

### H8 · **Menor** — El bug de #164 sigue siendo alcanzable con OTRO nombre

`addPlugin` canda el `name` duplicado, pero dos manifests con nombres distintos y las mismas
reglas (`commerce` y `comercio`) se registran los dos y **ambos se suscriben al mismo
`event_type`** (`dispatcher.ts: subscribersOf`) — o sea, doble cobro al jugador, que es el
síntoma original de #164. Lo único que lo frena es una frase en la descripción de la tool
(«Never register a variant under a new name to work around a rejection»), que es una
instrucción al LLM, no un candado. No es una regresión de esta PR; es lo que queda del agujero
después de taparlo por el lado del `name`.

### H9 · **Menor** — Re-registrar el mismo manifest devuelve `fixturesPassed` de fixtures que no corrió

El camino `unchanged` responde `fixturesPassed: manifest.fixtures.length` sin haber ejecutado
ninguna. El motor lee ese número como «tu sistema pasó N pruebas ahora mismo». El comentario
del código lo reconoce; el contrato no. Con `action:"unchanged"` delante es interpretable,
pero un `0` o la ausencia del campo dirían la verdad.

### H10 · **Menor** — La migración no re-ejecuta `projections`, y eso no está dicho en ningún sitio que el motor lea

Es la decisión correcta (re-proyectar borraría el estado vivo — riesgo R4 del plan), pero la
consecuencia es que **una v2 que añada una `projection` no la aplicará nunca** en las partidas
que migren: solo lo que esté en `migrate[v]`. La descripción de la tool explica la cadena y
los rechazos, pero no dice que las projections de la versión nueva son letra muerta para quien
migra. El motor no puede adivinarlo.

### H11 · **Menor, ajeno a la PR** — El disco efímero de `qa/run.mjs` se deja fuera `data/plugins/`

`prepararDisco()` copia `data/games` a `qa/.tmp/<run>/games` y apunta ahí `NEFAN_GAMES_DIR`,
pero `loadGamePluginManifests` busca los plugins COMUNES en `{gamesDir}/../plugins`, que en el
tmp no existe. Resultado: en **toda** corrida de QA falta `economy` (el plugin que mueve
`player.gold`), y una partida de bench no es la partida del jugador. Se ve en el guion 14:
`plugins de la partida: commerce v1 (developer)` — sin `economy`. Sospecho que afecta a
cualquier guion futuro que toque oro o deudas. Arreglo: copiar también `data/plugins`.

---

## 7. Workarounds usados durante la prueba, y su veredicto

| Workaround | Por qué | Veredicto |
|---|---|---|
| Registrar un plugin `qa_arcas` en runtime para darle oro al jugador | El oro de partida es 0 y `economy` no está en el disco efímero del runner | **Es un hallazgo** (H11), no un paso de la receta. El workaround en sí es legítimo: registrar un sistema por `POST /plugins/register` es el cable real del motor, y de paso ejerce `action:"created"` en una sesión de verdad |
| `setYaw` para fijar el rumbo antes de andar | Elegir hacia dónde mirar es lo que hace el jugador con el ratón; el rumbo se elige además consultando la colisión del propio juego (`probeCollide`), no una constante | **No afecta al jugador.** Nadie se teletransporta: las tres zonas se cruzan **andando** con `W` |
| Romper a mano la regla `cadena-de-migracion-unica` y el candado del manifest | Prueba en negativo pedida (§3.1, §3.2) | **No afecta al jugador**; árbol restaurado y limpio (`git status` sin modificaciones) |
| Revertir los 6 ficheros de producción a `main` para probar el guion en negativo | Un guion que no detecta nada se ve igual que uno que funciona | **No afecta al jugador**; restaurados desde copia, `git status` limpio |
| Manipular un save a mano y llamar a `addPlugin` con un manifest incoherente | Intento explícito de construir el trampantojo (§3.2) | Sondas fuera del repo (scratchpad). Lo que encontraron va en H4 |

---

## 8. No probado

- **El motor narrativo de verdad (LLM) evolucionando un plugin.** Toda la secuencia la
  conduje yo por `POST :9878/plugins/register`, que es el cable exacto de la tool MCP, pero
  que el modelo entienda la regla nueva («evoluciona, no registres una variante con otro
  nombre») solo lo dirá un playtest con `play` o `story-web-sin-imagenes`. La descripción de
  la tool lo dice; H8 muestra que sigue siendo una sugerencia, no un candado.
- **El 100 % de mutación de `src/plugins/migrate.ts`** (45/45). La config era de un solo uso y
  se borró: no es reproducible. Lo sustituyo por la lectura de los tests (§5), que sí encontró
  un hueco que el score no enseña (H6).
- **`plugin_register` con la sesión pisada por otro `start_session`** (guardia
  `x-nefan-session`): no lo ejercí; no lo toca esta PR.
- **Migración con más de un plugin del mismo evento en juego** más allá de lo que hace el
  guion (dos sistemas, `qa_arcas` y `commerce`).
- **Crítica visual**: no aplica más allá de la captura del overlay de H1, que es de UI de
  error, no de arte. Las capturas del mercado (`01`, `02`) muestran el greybox del tile con
  el HUD de siempre; la única fealdad que se ve es el feed de efectos de plugins abajo a la
  izquierda, que le enseña al jugador `plugin c021b490… trade_offered → player.gold,
  player.inventory` y `plugins.c021b490…slice`. Es anterior a esta PR y no la empeora.

---

## 9. Veredicto

**Apto con reservas.**

Lo que se pidió está hecho y se sostiene en el flujo real, no solo en verde: el oro, el
inventario y el stock del mercado sobreviven a la migración; queda un solo sistema donde
antes quedaban dos; los tres rechazos dejan la partida exactamente como estaba; la política de
versiones tiene de verdad un solo juez (regla probada en negativo sobre el árbol real, y sin
segunda comprobación de versión en ningún otro sitio); y el candado del manifest hace que el
«arreglo verde que no entrega» no compile ni pase. Los 10 criterios se cumplen —el 1 con una
desviación declarada y bien argumentada en `origin`, el 8 con la mutación no reproducible—, y
el CI está verde.

La reserva es **H1**, y no es de estilo: la funcionalidad que esta PR entrega —evolucionar un
sistema a mitad de partida— deja muertos los `plugin_id` que el propio motor dejó escritos en
el mapa, y el jugador que llega a esa zona no puede comprar y se come un overlay con un hash
de 64 caracteres. Es un fallo anterior a la PR que la PR convierte en algo que va a pasar de
verdad. Con **H2** (el aviso del secuestro no llega a la pantalla) y **H3** (el aviso del
resume dice lo contrario de lo que pasó) forman la lista corta de lo que yo devolvería al
ingeniero antes de dar la tanda por cerrada. El resto (H4–H11) son de libreta: baratos, y
varios no son de esta tarea.

El guion `qa/guiones/14-plugin-evoluciona-sin-perder-la-partida.mjs` queda sembrado y
**probado en negativo contra `main`**. Nace en rojo por H1; cuando eso se arregle, se pone
entero en verde sin tocarlo.

Los otros 12 guiones de la batería siguen en verde (`node qa/run.mjs` → 12/13, el único rojo
es el 14 por H1): esta PR no ha roto nada de lo que ya estaba protegido.
