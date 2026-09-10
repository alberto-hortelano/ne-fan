# Triaje: la escena, los contratos y el arte pagado (24 issues)

Verificado contra `main` = `5d67c8ca` el 2026-09-10, en solo lectura. Cada veredicto lleva su
comando o su `fichero:línea`. **#524 no se dictamina aquí** (asignado al crítico de «el juego en
pantalla»); se nombra como relación de #532. **#426 entra** por familia (arte pagado).

## Resumen

| # | Título corto | Veredicto | Quién / qué cuesta |
|---|---|---|---|
| #293 | Trazabilidad de lo generado (programa) | **REENCUADRADO** | 3 de 4 puntos cerrados por nombre; lo que queda ES #413 |
| #369 | Caché de sprite-forge sin dueño (R7+R10) | **REENCUADRADO** | R10 **hecho** en `start.sh`; R7 vive en **otro repo** |
| #413 | Páginas de debug del atlas en la raíz indexada | **VIGENTE** | ingeniero · 1 PR (Python + candado TS) |
| #417 | Pin permanente del arte de personaje | **VIGENTE (no urge)** | arquitecto+ingeniero · toca el save · candidato a `futuro` |
| #426 | El ledger no distingue pago real de simulado | **VIGENTE** | ingeniero · 1 PR Python pequeña |
| #451 | Snapshot de 9 con una injugable se tira entero | **DECISIÓN DEL USUARIO** | gasta créditos regenerar |
| #464 | Char fuera del alfabeto del `terrain_grid` es suelo | **VIGENTE** | ingeniero · pequeña, respuesta canónica |
| #465 | Nadie instruye al motor a dar `anchor.rect` | **PARTIDO** | mitad VIGENTE (prompt+cotas) · mitad **DECISIÓN** (playtest real) |
| #466 | 5 divergencias zod↔Python en `glyph`/`attach` | **VIGENTE** | ingeniero · 1 PR + alta del guion en `candados-headless` |
| #467 | La posición viva del NPC entra en la huella | **REENCUADRADO** | #410 lo metió a propósito y hay test que lo defiende |
| #468 | Bloque `npcs[]` inalcanzable en `npc-records.ts` | **YA CUBIERTO POR OTRO** (#431) | cerrar y anotarlo en #431 |
| #514 | `src/games/` fuera del perímetro puro | **VIGENTE y MAYOR** | son **cuatro** ficheros, no tres |
| #515 | El velo calcula un texto que el cliente tira | **VIGENTE** | ingeniero · pequeña (pintar el texto) |
| #516 | Falta `POST /dev/tiles` en el motor falso | **VIGENTE** | ingeniero · desbloquea los candados de #515/#517 |
| #517 | La Frontera no se olvida al cambiar de partida | **VIGENTE** | ingeniero · pequeña (faceta `porValor`) |
| #519 | `nefan.autoimg` sin consumidor alcanzable | **VIGENTE** | ingeniero · borrar (pre-producción) |
| #520 | Skins descartadas no vuelven al rearmar el fusible | **VIGENTE** | ingeniero · media (manager de sprites) |
| #522 | `render_mode` desconocido pasa el gate del save | **VIGENTE** | ingeniero · el propio código ya dice dónde va |
| #526 | `getCombatant` del enemigo deriva el máximo | **VIGENTE** | ingeniero · pequeña (borrar la rama) |
| #529 | Un enemigo inválido tumba el frame entero | **DECISIÓN DEL USUARIO** | dos diseños de juego defendibles |
| #530 | Contrato del wire del enemigo (5 puntos) | **VIGENTE, con el punto 2 REENCUADRADO** | ingeniero · 1 PR |
| #532 | Todo `object` del motor es un muro de 1,5 m | **DECISIÓN DEL USUARIO** | cambia el contrato con el motor |
| #538 | Reaparición: escalón inobservable + bucle de muerte | **PARTIDO** | H2 VIGENTE · H10 **DECISIÓN** |
| #539 | `combat_config.player`: rangos, pantalla muerta, `jump_velocity` | **VIGENTE (los tres)** | ingeniero · 1 PR |

**Cuentas.** Vigentes que se hacen sin preguntar: **13** (+2 mitades). Decisiones del usuario:
**4** enteras (#451, #529, #532, y la mitad de #465) + **2** mitades (#538-H10, #465-playtest).
Reencuadrados: **3** (#293, #369, #467). Ya cubierto: **1** (#468).

---

## Arte pagado y procedencia

### #293 · Trazabilidad de lo generado — **REENCUADRADO**

El censo de cuatro puntos del cuerpo está **hecho en tres**, y el cuarto no tiene sujeto:

1. **Entities que no son NPC** → cerrado por #238 (2026-09-02).
   `scene-normalize.ts:344-349`: «Hasta #238 aquí se escribía `description: ent.name`»; hoy
   `...textoDeclarado("description", ent.description)`.
2. **Portadas por captura** → sin sujeto. Las `cover.jpg` las produce `qa/capturar-portadas.mjs`
   capturando el juego: no son arte de un modelo, así que no hay «texto con el que se pidió» que
   guardar, y regenerarlas es volver a correr el guion. La procedencia de lo que sale EN la foto
   (superficies) ya la tiene el manifest.
3. **Skins de personaje** → cerrado por #376. `remote_generation.py:569` y `:581` registran el
   `prompt` del hero y de cada sheet, y la columna es `prompt TEXT NOT NULL`
   (`manifest-db.ts:191`).
4. **`available_assets` vs lo guardado** → **verificado sin divergencia**. `llm_client.py:294-305`
   manda el `prompt` de la fila **verbatim** (solo dedupe por `.lower()` y filtro de <4 chars para
   etiquetas internas); el reuse es por esa misma descripción. Un solo texto, no dos
   normalizaciones.

Lo único que queda en disco sin procedencia posible son los **19 directorios `atlas_*`**, y ese es
exactamente el sujeto de **#413** (cuyo criterio de cierre incluye el candado «nada escribe en
`surfaceDir` fuera de `AssetCache.put()`», que es la garantía de #293 expresada como candado).

**Qué hacer:** cerrar #293 con la evidencia de los cuatro puntos, dejando escrito que el candado
del principio es el de #413. No abrir trabajo nuevo.

### #369 · La caché de sprite-forge — **REENCUADRADO (queda solo R7, y en otro repo)**

**R10 está HECHO** y el issue no se enteró. `start.sh:545-548`:

```
exec node bin/sprite-forge.mjs serve \
    --assets "$PROJECT_DIR/assets/characters" --port "$PORT_FORGE" \
    --set "$PROJECT_DIR/nefan-core/data/sprite-set.json" \
    --cache "$PROJECT_DIR/nefan-core/cache/sprite_base_sheets"
```

Lo puso `e4279dd6` (PR #373, «#367 #236»), citando literalmente «#369-R10» en el comentario. Y la
otra mitad de R10 —«los sheets vestidos + heroes tampoco entran en el manifest ni en el prune»—
la cerró #376: hoy entran pineados (`manifest-db.ts:180 registrarArteDePersonaje`). Que el prune
no los pueda **reclamar** es #417, no esto.

**R7 sigue vivo y es de sprite-forge.** `~/code/sprite-forge/README.md:242-244` dice todavía:
«subir la versión del paquete invalida la caché de hojas. Es deliberado […] y barato: una hoja se
rehace en ~9 s sin gastar nada». Es cierto para ese repo y falso para ne-fan (invalida `base_key` →
invalida los `/skins` de cada NPC). **No es trabajo de aquí**: es un párrafo en el README del repo
hermano.

**Qué hacer:** cerrar #369 en ne-fan citando `start.sh:545-548` + #376, y abrir (o anotar) el
párrafo de R7 como issue de `alberto-hortelano/sprite-forge`.

### #413 · Las páginas de debug del atlas — **VIGENTE**

Medido hoy, sin cambios desde el 03-09:

```
$ ls cache/surfaces | wc -l          → 198
$ ls cache/surfaces | grep -c ^atlas_ → 19
$ du -c -s cache/surfaces/atlas_*      → 80004 KB (78 MB)
```

El código es idéntico: `remote_generation.py:177-183` sigue haciendo
`deps.surface_cache.get_path(f"atlas_{...}", f"page{i}")` + `write_bytes`, saltándose `put()`.

**Quién:** ingeniero, 1 PR — mover a un directorio propio fuera de `surfaceDir`, archivar los
78 MB en `archivo/cache/`, y el candado en `arch-rules.json` (regla nueva sobre `ai_server/**`:
nadie escribe en la raíz indexada fuera de `AssetCache.put()`).

### #417 · El pin permanente del arte de personaje — **VIGENTE, no urge**

`entity.asset_refs` sigue siendo un `string[]` en `narrative/types.ts:119` que **nadie rellena**:
el único productor de refs es el cliente para superficies (`nefan-html/src/scene/fps-atlas.ts:331`
→ `POST /scene/asset_refs`, que escribe en `scenes_loaded[id].asset_refs`, no en la entity). El
comentario de `manifest-db.ts:171` lo declara como invariante asumido.

Presión de espacio real: `cache_max_bytes` = 2 GiB (`src/config.ts:193`) contra **130 MB** de
`cache/` medidos hoy. Con #413 hecho bajan otros 78 MB.

**Recomendación:** VIGENTE pero **etiquetar `futuro`**. Toca el save (`EntityRecord`), la keep-list
y el prune; no hay presión y el marco del 02-09 dice dejar para más adelante lo que no es núcleo
apremiante. Si se hace, va con arquitecto delante.

### #426 · El ledger no distingue pago real de simulado — **VIGENTE**

`spend_tracker.py:112-121` sigue escribiendo exactamente `{t, usd, what, service}`; `grep` de
`fake|origen|source|procedencia` en ese fichero → **0 resultados**. El ledger real sigue en
**187 eventos / $37,54** (recontado hoy sobre `cache/spend/events.jsonl`), con los 4 de prompt `x`
dentro: el techo no se ha movido.

Sobre la pista que me diste: **el `fake: true` del banco no llega ni puede llegar al ledger**. Lo
declara `labs/narrative/fake-ai-server.ts:332` en su `/health`, y ese proceso **sustituye a
ai_server entero** — no llama a `SPEND.add` jamás. Los tres llamantes vivos son
`style_pack_builder.py:262,270`, `surface_atlas_generator.py:401` y
`remote_generation.py:742,760`, y ninguno recibe una señal de si el forge / el proveedor de imagen
al otro lado era real o una fixture. La procedencia existe en el sitio que llama y no viaja: es
justo lo que dice el issue.

**Quién:** ingeniero, PR pequeña de Python — `add(usd, what, service, origen)` con el candado del
molde de #392 (escribir sin declarar procedencia falla).

---

## El contrato de escena y sus gates

### #464 · Un char fuera del alfabeto es suelo en silencio — **VIGENTE**

`openTile` (`scene-validate.ts:265-355`) valida **tres** cosas y ninguna es el alfabeto: número de
filas (`terrain.length !== TILE_CELLS`), longitud de cada fila (`row.length !== TILE_CELLS`) y el
bioma (`resolveBiome`). Un `W` en una celda cruza entero, y `DEFAULT_SOLID_CHARS = ["w"]`
(`scene-normalize.ts:210`) no lo incluye → transitable y sin pintar.

**No es decisión del usuario**: es el fail-loud que falta, con respuesta canónica en `CLAUDE.md`.
**Quién:** ingeniero, pequeña, con su negativo.

### #466 · Los dos gates no rebotan igual — **VIGENTE (verificado clave a clave)**

Las dos divergencias son ciertas y se ven leyendo las dos tablas:

- **(a)** El zod tiene UNA tabla (`retired-terrain-fields.ts:34-49`, `MOTIVOS`) con
  `terrain_legend, terrain_patches, ambient_event, glyph, attach, place_anchors` — raíz y entity
  **juntas**, y el comentario de `:31` lo declara a propósito. Python tiene **dos**:
  `MOTIVO_DE_CLAVE_RETIRADA` (`campos_retirados.py:31-55`, **sin** `glyph` ni `attach`) y
  `MOTIVO_DE_CLAVE_DE_ENTITY_RETIRADA` (`:57-64`). Un `glyph` en la RAÍZ recibe el motivo de
  retirada del zod y el genérico de Python.
- **(b)** El rótulo difiere: `scene-schema.ts:61` → `` `la entity "${id}"` ``;
  `narrative_schemas.py:143` → `f"entity '{eid}'"`.

Y la promesa que ningún test mide sigue escrita en `campos_retirados.py:13-15` («palabra por
palabra»).

**Quién:** ingeniero. Una sola fuente de motivos (o el test de paridad), y dar de alta el guion que
QA ya escribió en `candados-headless` una vez verde. **No es decisión del usuario**: una divergencia
entre el espejo Python y el TS tiene respuesta canónica.

### #465 · `anchor.rect` — **PARTIDO: mitad VIGENTE, mitad DECISIÓN**

Verificado: `grep -n anchor nefan-core/data/contract/prompts/*.md` → tres aciertos y **ninguno**
menciona `anchor.rect`; solo la tool lo describe (`narrative-mcp/server.ts:699-707`). Y el
`AnchorSchema` sigue sin cotas: `request-schemas.ts:80-84`,
`rect: z.tuple([z.number()×4]).optional()`, sin `.int()`.

- **Mitad VIGENTE (se hace sin preguntar):** escribir en `tile_instructions.md` cuándo y cómo dar
  `anchor.rect`, y ponerle `.int()` + cotas al `AnchorSchema`.
- **Mitad DECISIÓN:** confirmar con el motor REAL que lo hace. Gasta créditos y su tiempo.

### #467 · La posición viva del NPC en la huella — **REENCUADRADO**

El issue lo presenta como «la misma clase de defecto que #410 arregló». **No lo es**: #410 metió
ese estado dentro a propósito y lo dejó candado. `escena-servida.ts:18-20`:

> «Lo que sí entra en la huella, porque lo emite core y es geometría o **estado de la escena**:
> `position_declared`, `combat`, `__plan`, `terrain_grid`… todo lo que no sea `exits`.»

Y hay dos tests que lo **defienden** hoy: `test/escena-servida.test.ts:76-83` («el `combat` de un
npc distinto → huella distinta») y `:85-90` («la posición de un npc distinta → huella distinta»).
`huellaDeEscena` es literalmente `JSON.stringify(escena)` (`:57-59`).

O sea: hacer #467 es **revertir una decisión de hace cinco días y borrar dos tests**, no tapar un
descuido. Además el propio issue admite que el síntoma no está reproducido (los NPC del motor falso
no se mueven).

**El issue que sí habría que tener:** «¿re-derivar la colisión cuando solo se movió un NPC cuesta
algo medible?» — con la medida delante. Sin ese número, el trabajo es cambiar código que funciona
por una intuición. **Qué NO debería hacerse:** partir `escena-servida.ts` en geometría/estado vivo
antes de medir el coste de la re-derivación.

### #468 · El bloque `npcs[]` inalcanzable — **YA CUBIERTO POR OTRO (#431)**

Vivo y confirmado: `npc-records.ts:76-101` («Legacy scenes: npcs[] with {id, name, position}»)
sigue ahí, y ningún schema admite `npcs` en la raíz. Pero el propio cuerpo dice que «quitarla es
parte del arreglo de #431, no un issue aparte de trabajo», y **#431 está OPEN**.

**Qué hacer:** cerrar #468 como duplicado y pegar su criterio (`grep -n "npcs" npc-records.ts` → 0
fuera de las entities) en el cuerpo de #431.

### #451 · Un snapshot con una escena injugable se tira entero — **DECISIÓN DEL USUARIO**

Confirmado en `src/games/world-snapshot.ts:137-148`: el bucle recorre **todas** las escenas y el
primer `!check.ok` hace `throw` con el mundo entero.

Es decisión suya por dos de los cuatro criterios: **gasta créditos** (regenerar el mundo con el
motor real cuesta minutos y llamadas) y **elige entre dos diseños defendibles**.

> **Pregunta:** cuando un mundo pre-generado tiene 9 escenas y una del anillo no pasa el validador
> de hoy, ¿qué prefieres? **(a)** lo de ahora: se tira entero y «Continuar» regenera desde cero
> (coherente, caro, pierde 8 escenas buenas); **(b)** se sirve la entrada y las buenas, y solo se
> vuelve a pedir el tile malo (más barato para ti, más código: `loadWorldSnapshot` devuelve qué
> pasa, `replayWorldSnapshot` siembra las buenas y la cola pide las malas); **(c)** (a) por ahora,
> pero el título dice **el motivo** en vez de «regenera el mundo».

---

## El wire del enemigo hostil

### #526 · `getCombatant` del enemigo — **VIGENTE**

`nefan-html/src/net/game-client.ts:221`:

```ts
return { health: e.hp, maxHealth: e.hp, weaponId: "unarmed" };
```

Confirmado también el detalle menor del cuerpo: el comentario de `:207-210` habla solo del player,
no avisa de esta rama.

**Quién:** ingeniero, pequeña. Nadie lee esos campos del enemigo hoy → la opción barata y honesta
es borrar la rama con su tipo, no derivar el máximo.

### #529 · Un enemigo inválido tumba el frame entero — **DECISIÓN DEL USUARIO**

Cadena verificada de punta a punta: `ws-server.ts:286-308` → un `intakeClientMessage` fallido
rechaza el frame ENTERO y manda `narrative_status {kind: "protocolo"}`; `status-rotulo.ts:205`
convierte ese kind en `{destino: "overlay", titulo: "Fallo interno del juego"}`. Y desde PR 6,
`EnemySpawnSchema.superRefine` (`message-schema.ts:63-71`) llama a `parseHostileCombat`, así que un
enemigo con `health: 0` o `preferred_attacks: []` hace fallar el intake. El cliente, en cambio,
descarta ese enemigo y sigue (`scene/enemigo.ts:64`).

> **Pregunta:** el motor narrativo es un LLM y a veces manda un enemigo mal formado. Cuando eso
> pasa dentro de un frame con varios enemigos, ¿qué ve quien está jugando?
> **(a)** el enemigo malo se cae, los demás entran, la partida sigue y el motivo va al registro del
> jugador y **de vuelta al motor** (que es lo que el cliente ya hace, y lo que dice la regla de
> fail-loud al modelo); **(b)** se sigue tirando el frame entero, pero el modal dice **qué** enemigo
> y **por qué**, en vez de «Fallo interno del juego». La recomendación del equipo es (a).

Nota: (a) tiene un coste que conviene que sepas — deja de ser cierto que «cliente y bridge aplican
el mismo criterio con el mismo desenlace», que es media PR 6; pasa a ser «mismo criterio, mismo
desenlace», que es más fuerte.

### #530 · El contrato del wire del enemigo — **VIGENTE, con el punto 2 REENCUADRADO**

- **Punto 1 · el tipo miente: CIERTO.** `src/types.ts:81` → `combat_range?: number`; el parser lo
  hace obligatorio: `hostil-desde-combat.ts:35` →
  `PersonalidadValidada = EnemyPersonality & { combat_range: number }` y `:98` lo rechaza.
- **Punto 2 · REENCUADRADO.** El issue dice «`aggro_radius` no está en el espejo zod». Lo que hay
  es más grande y es deliberado: **no existe espejo zod de la personalidad**.
  `message-schema.ts:35` → `const EnemyPersonalitySchema = z.custom<EnemyPersonality>();` con el
  comentario de `:33-34` («Quién decide si sirve es `parseHostileCombat` […] UNA vez y en el orden
  del parser»). Así que no falta un campo: falta —a propósito— la forma entera. El punto 2 tal
  como está escrito **no tiene sujeto**; lo que queda vivo de él es el punto 3.
- **Puntos 3, 4, 5:** vigentes tal cual (el motivo de zod gana en errores de tipo; las fixtures de
  `test/bridge-*.test.ts` llaman a `routeMessage` directamente, saltándose el intake — verificado:
  `bridge-dialogue.test.ts`, `bridge-npc.test.ts`, `bridge-session-guards.test.ts` lo importan).

**Quién:** ingeniero, 1 PR. Reescribir el punto 2 del cuerpo antes de asignarlo.

---

## La frontera del jugador

### #515 · El velo calcula un texto que el cliente tira — **VIGENTE**

`frontera.ts:65-68` define `Velo {edge, text}`; `:156-160` calcula los tres estados
(`"Zona sin generar"` / el texto de estado / `"Explorando lo desconocido"`). El cliente:
`frontera-del-jugador.ts:95` → `deps.velo(velo?.edge ?? null)`. El texto muere ahí.

Entre las dos salidas que ofrece el issue, la respuesta está en la casa: pegado al muro sin saber
por qué, el jugador no recibe el motivo — y eso es lo que el fail-loud uniforme prohíbe. **Pintar
el texto**, no borrarlo. **Quién:** ingeniero, pequeña + guion 86.

### #516 · Falta `POST /dev/tiles` — **VIGENTE**

Los `/dev/*` del motor falso son exactamente cuatro y ninguno es este:
`/dev/counters` (:370), `/dev/api_cache` (:383, :608), `/dev/status` (:388), `/dev/reset` (:592).
Y las palancas se leen del entorno **a la carga del módulo**: `fake-ai-server.ts:171-172`
(`TILE_DELAY_MS`, `TILE_MODE`), usadas en `:176-178`.

**Va primero del grupo**: sin él, los candados de #515 y #517 no se pueden escribir sin workaround.

### #517 · La Frontera no se olvida al cambiar de partida — **VIGENTE**

`main.ts:299` → `const frontier = new Frontera();` (instancia de módulo). Las facetas de sesión
(`main.ts:150-176`) son `mundo, style, theme, renderModes, combat, history, entrada, dialogo` —
**no está `frontera`**, así que `session.leave()` (`main.ts:1256`) no la toca. La forma correcta ya
existe al lado: `porValor(() => …)`, como `mundo` y `dialogo`.

---

## La puerta del gasto de imagen

### #519 · `nefan.autoimg` sin consumidor alcanzable — **VIGENTE**

Verificado el camino completo: `modos-de-graficos.ts:40,117` lee `localStorage` →
`gates-de-imagen.ts:67` (`f.renderMode ? … : f.toggleLocalEscenarios`) → y el único consumidor,
`main.ts:199`, lo tapa: `generationOn: () => session.active && graficos.escenariosGeneran()`. Sin
sesión no hay `renderMode` **ni** paso: el toggle no decide nada observable.

Aquí sí hay respuesta canónica y no hay que preguntar: pre-producción, nada se conserva por
antiguo, y medir en mutación un módulo que no decide nada es pagar por un candado sobre nada.
**Borrar** el toggle, su clave y el parámetro de los tests. (Si se quisiera la otra rama —imagen IA
sin partida— eso sí sería gasto y decisión suya; pero es una feature nueva, no este issue.)

### #522 · `render_mode` desconocido pasa el gate — **VIGENTE**

El propio código ya escribió el veredicto. `src/narrative/render-mode.ts:48-52`:

> «Que un valor así llegue vivo hasta aquí es el defecto de verdad, y su sitio es **la puerta del
> save (`loadSession`)**, no este silencio.»

Y el campo sigue sin tipo: `narrative-state.ts:471-472` → `render_mode: string; character_mode:
string`. **No es decisión del usuario**: un fail-loud que falta en el gate tiene respuesta canónica.
**Quién:** ingeniero, con el molde de #490.

### #520 · Skins descartadas no vuelven al rearmar — **VIGENTE**

`renderer/aspecto-del-jugador.ts:128-130` documenta la conducta como intencional
(«…`rearmarCortacircuitos`), no los re-pide: los que aparezcan en ESTA…»), y
`character-sprites.ts:181-182` solo hace `this.fusible.rearmar()`. El jugador que apaga y enciende
«Personajes IA» para recuperar los skins se queda con vecinos en maniquí hasta recargar.

**Quién:** ingeniero, media. Relación viva: **#510** (OPEN) toca el mismo chip.

---

## La reaparición y el config del jugador

### #538 · Reaparición — **PARTIDO**

- **H2 · VIGENTE, canónico.** `main.ts:549` pasa `collidesAt` a `puntoDeReaparicion`, y
  `world/collision.ts:74-84` es inequívocamente una consulta de **movimiento**: usa
  `this.deps.getPlayerPos()` como origen y llama `blocksMove(from.x, from.z, x, z, …)`. Con
  `desde === pos`, nunca dice «sólido». El escalón «centro del tile» de `reaparicion.ts:36-42` es
  inalcanzable desde el juego. Arreglo sin preguntar: pasar una consulta de PUNTO.
- **H10 · DECISIÓN DEL USUARIO.** Elige entre diseños de juego defendibles.

> **Pregunta:** te matan y pulsas R. ¿Dónde vuelves? **(a)** donde te mataron, con el enemigo a
> 60/60 a un paso (lo de ahora: bucle de muerte); **(b)** en el `__player_start` del tile;
> **(c)** en el último punto seguro por el que pasaste; **(d)** donde te mataron pero el enemigo te
> suelta (`engaged` a cero, que es #377 y está en `futuro`) o no ataca unos segundos.

### #539 · `combat_config.player` — **VIGENTE, los tres puntos**

1. `combat-data.ts:60` → `typeof player[k] !== "number" || !Number.isFinite(player[k])`. Tipo sí,
   **rango no**: `speed_scale: -1` e `interact_range_m: 0` cargan sin queja.
2. Fail-loud al jugador que falta (el motivo se queda en la consola).
3. **`jump_velocity` verificado:** `grep -rn jump_velocity` en todo el repo →
   **un solo acierto**, `nefan-core/data/combat_config.json:209`. Cero lectores. Se borra.

---

## Perímetro y deuda medida

### #514 · `src/games/` fuera del perímetro puro — **VIGENTE y MAYOR de lo que dice**

El issue habla de **tres** ficheros; el cliente importa **cuatro**:

```
nefan-html/src/scene/enemigo.ts:22              → games/style-categories.js
nefan-html/src/world/materializar-spawn.ts:21   → games/style-categories.js
nefan-html/src/world/carga-de-tile.ts:37        → games/style-categories.js
nefan-html/src/net/narrative-client.ts:6        → games/ui-theme.js
nefan-html/src/ui/theme.ts:12                   → games/ui-theme.js
nefan-html/src/ui/style-apply.ts:19,31          → games/style-categories.js, games/style-application-schema.js
nefan-html/src/ui/titulo/subir-estilo.ts:22     → games/style-refs.js
```

`style-application-schema.ts` es el cuarto, y el propio `why` de la regla `cierre`
(`arch-rules.json:120`) ya los enumera a los cuatro. `core-puro-sin-node` (`:183-194`) no lista
`src/games/**`, y `grep games mutation-targets.json` no devuelve ningún módulo.

**Quién:** arquitecto (decidir puro/impuro dentro de `src/games/`) + ingeniero. Corregir el cuerpo
a cuatro ficheros antes de asignarlo.

---

## Lo que necesita decisión tuya (5 preguntas)

1. **#451** — snapshot de 9 con una injugable: ¿se tira entero (hoy), se sirve lo bueno y se pide
   solo el tile malo, o se queda como está pero el título dice el motivo?
2. **#529** — enemigo inválido del motor: ¿se cae solo él y la partida sigue (recomendado), o se
   sigue tirando el frame pero con el motivo a la vista?
3. **#532** — un `spawn_entity` de «una bolsa de monedas»: ¿el motor gana `footprint` opcional,
   gana `kind: "item"`, o las dos (recomendado)? Toca el zod, el espejo Python y el tool JSON.
4. **#538-H10** — dónde reaparece el jugador tras morir (cuatro opciones arriba).
5. **#465** — ¿autorizas un playtest con el motor real para confirmar que ancla los lugares con
   `anchor.rect`? Gasta créditos y tiempo tuyo. Lo demás de #465 se hace sin preguntar.

Y una recomendación de aparcamiento, no de decisión: **#417** es real pero no urge (2 GiB de techo
contra 130 MB en disco) — propongo etiquetarlo `futuro`.

---

## Grupos: cómo armaría las tandas

**G1 · El arte pagado que nadie ve** — #413 · #426 · (#293 y #369 cierran con ellos)
Ficheros: `ai_server/routers/remote_generation.py`, `ai_server/asset_cache.py`,
`ai_server/spend_tracker.py`, `services/asset-store/prune.ts`, `arch-rules.json`.
Una PR toca los dos escritores del mismo fichero Python. Cierra #293 y #369 de paso.

**G2 · Los dos gates del contrato de escena** — #464 · #466 · #465(mitad vigente)
Ficheros: `src/scene/scene-validate.ts`, `src/contract/model-io/{scene-schema,retired-terrain-fields}.ts`,
`ai_server/{narrative_schemas,campos_retirados}.py`, `src/contracts/request-schemas.ts`,
`data/contract/prompts/tile_instructions.md`.
Los tres son «el borde rechaza y el espejo tiene que decir lo mismo». Un guion nuevo en
`candados-headless`.

**G3 · La frontera del jugador** — #516 → #515 · #517
Ficheros: `labs/narrative/fake-ai-server.ts`, `src/scene/frontera.ts`,
`nefan-html/src/world/frontera-del-jugador.ts`, `main.ts` (facetas), guion 86.
**#516 va primero**: sin la palanca, los otros dos no tienen candado de extremo a extremo.

**G4 · El wire del enemigo hostil** — #526 · #530 · (#529 tras tu respuesta)
Ficheros: `nefan-html/src/net/game-client.ts`, `src/types.ts`,
`src/protocol/message-schema.ts`, `src/combat/hostil-desde-combat.ts`,
`test/bridge-*.test.ts`, guion 90.
#529 cambia el desenlace que #530-p3 mide; hacerlos por separado paga el guion 90 dos veces.

**G5 · Lo que quedó de la PR 8 de #241** — #538-H2 · #539
Ficheros: `nefan-html/src/main.ts`, `src/simulation/reaparicion.ts`,
`src/combat/combat-data.ts`, `data/combat_config.json`, guion 93.
Misma PR de origen, mismo guion, mismo fichero de config. #538-H10 espera tu respuesta y entra
después por el mismo sitio.

**G6 · La puerta del save y el gasto de imagen** — #522 · #519
Ficheros: `loadSession` (`bridge/handlers/session.ts`), `src/narrative/narrative-state.ts`,
`src/session/gates-de-imagen.ts`, `nefan-html/src/ui/modos-de-graficos.ts`.
Los dos son «el modo de render es la puerta del gasto»; #519 borra el parámetro que #522 deja de
necesitar tolerar. Vecino: **#490** (OPEN, el mismo gate) — si va otra familia, coordinar.

**Sueltos:** #520 (con #510, del chip de gráficos) · #514 (arquitecto, perímetro) ·
#468 (se cierra dentro de #431) · #417 (a `futuro`).
