# Requisitos — T5 «El motor recupera el suelo» (#335 + #238 + #264)

**Fecha**: 2026-09-02 · **Coordinador**: sesión principal · **Base**: `main` = `937c16d` (#390 mergeado).

## Petición del usuario (literal)

> «continua con T5»

T5 es la tanda siguiente del plan aprobado (`~/.claude/plans/federated-spinning-flamingo.md`, «Cola
siguiente»): **«El motor recupera el suelo» — con la decisión ya tomada: `terrain_patches` entra al
contrato que ve el motor, y `terrain_legend` recupera su sujeto — #335 + #238 (+#264). Cierra 2-3.**
El plan dice de la cola: «nombrada, no detallada — se re-verifica al abrirla». Eso es lo que hace este
documento y lo que el crítico vuelve a hacer después.

Vigente de la serie: **«Vamos a seguir priorizando reducir el numero de issues»**. Subir el número
abriendo un defecto derivado medido sigue siendo preferible a bajarlo callándolo.

> **Crítica (`critica.md`, 2026-09-02)**: #335 **REENCUADRADA** · #238 **VIGENTE** · #264 **PREMATURA**.
> Las correcciones están incorporadas abajo. **#335 decidida por el usuario** (abajo) y va en su propia PR; **#238 sigue adelante ahora**; #264 queda
> fuera con la medida comentada en el issue.

## Los tres issues y su premisa, verificada hoy contra `937c16d`

### #335 — `terrain_legend` queda huérfano

| Afirma el issue | Medido hoy |
|---|---|
| `generate_scene.json` ofrece `terrain_legend` y ninguna primitiva del motor escribe chars | **Cierto.** `data/contract/tools/generate_scene.json:39-41` sigue describiendo `terrain_legend` como «Only for CUSTOM chars your primitives introduce (a structure's wall_char/floor_char of your own)»; `structures` murió en #333. `grep terrain_patches generate_scene.json` → **0** |
| `terrain_patches` sigue viva en el expander | **Cierto.** `src/scene/scene-expand.ts:145-163` la lee de `raw`, valida forma (`{at:[col,row], rows:[…]}`) y límites del tile con `throw` preciso, y escribe los chars en el grid. `scene-validate.ts:379-391` (`checkDeclaredChars`) rechaza chars sin entrada en la leyenda |
| El zod no la declara | **Cierto y peor**: `scene-schema.ts:23` la nombra como uno de los campos vivos que **sostiene el `.passthrough()`** de escena («declararlos y cerrarlo es otro issue»). Hoy el motor podría emitirla y pasaría sin tipo |
| El espejo Python | `ai_server/narrative_schemas.py:587-603`: valida `terrain_patches` y **descarta en silencio** las malformadas (`print(... "malformado, descartado")`) — contra la regla de la casa «fail-loud al modelo» (pre-flight con error preciso, nunca saneado en silencio) |
| El candado no ve la prosa muerta | **Cierto** (comentario del issue 2026-08-30): `campos-retirados-no-vuelven` cubre `data/**/*.json` pero el `\b` no casa `structure's` |
| Prompts | `data/contract/prompts/scene_instructions.md` y `tile_instructions.md` mencionan `terrain_legend`/`terrain_patches`: hay que leerlos y alinearlos con el contrato |

**El plan decía salida 1 y el crítico la tumba con el mundo delante**: `terrain_patches` no falta del
tool por omisión, se **retiró a propósito** en `dbf9fc7` (2026-08-12, «nunca emitidos; lector
conservado»); un parche **no pinta nada** en la vista única (el grid viaja solo para colisión,
`scene-normalize.ts:250-254`; cero lectores de `terrain_grid` en el renderer; el atlas sale de
`surface_desc` de volúmenes) — lo que sí hace es colisión invisible, obligación de costura para el
vecino y vegetación que no lo esquiva. El prompt ya admite la orfandad (`scene_instructions.md:40-41`).
**Lo que ni el issue ni el plan nombran**: `terrain_legend` tiene un segundo uso vivo y con tests, la
solidez de chars reservados (`w:{solid:false}` = vado, `plan-collision.ts:41-47`), que el prompt no
enseña. **Decisión del usuario (2026-09-02, literal)**: «**Fuera entera, sin vado, hasta que haga falta**». Contexto
de la conversación: el usuario recordó que el motor ya no escribe ningún grid («Tenia entendido que ya no
se usa un grid para definir el terreno»); el suelo se define con `biome` + `ground` + `volumes` y el grid
es un raster DERIVADO que viaja solo para colisión y costuras. Corolario acordado: si algún día hace falta
el vado, irá como propiedad del rasgo `water` de `ground` (un solo origen del suelo), no como leyenda
sobre un char. Así que `terrain_legend` **sale entera** de zod, tool, prompts y espejo Python; la solidez
queda fija en `DEFAULT_SOLID_CHARS` (`W`, `w`); la `SOLID_LEGEND_NAME` (nombre que suena a muro) y
`resolveTerrainLegend` pierden su sujeto y se van con ella; los tests del vado (`plan-collision.test.ts:144,208`)
se borran declarando la pérdida. La leyenda derivada que el engine escribe para sí (nombre del bioma en
`terrain_grid.legend`) no la lee nadie fuera del normalizador: el arquitecto decide si sobrevive como
dato interno o se va también. En ambos casos: retirar `terrain_patches` entera (lector, saneador Python, tests y
corpus), `checkDeclaredChars` (sin productor posible), la prosa de custom chars, la leyenda inflada
de `narrative_schemas.py:672-675`, y `wall_char|floor_char|terrain_patches` al candado. **Qué no
hacer**: re-ofrecer `terrain_patches`.

### #238 — una `description` en algo que no es NPC se pierde en silencio

| Afirma | Medido hoy |
|---|---|
| `formatDToWorld` escribe `description: ent.name` y tira la declarada | **Cierto.** `scene-normalize.ts:229` (objetos) frente a `:189,207` (NPC, que sí la conserva) |
| El tool la documenta como «NPCs:» | **Cierto.** `generate_scene.json:170`: «NPCs: what this character LOOKS LIKE… It is the prompt that paints their AI skin» |

**Decisión del usuario (2026-08-27, en el issue, literal)**: «las descripciones son para el motor de
narrativa, todos los elementos generados deberían tener la descripción con la que se generaron, la que
se le dio al modelo. Eso permite regenerar assets con un modelo nuevo para mejorar la calidad».
Corolario escrito allí: **`name` es la etiqueta** (lo que se pinta), **`description` es la
PROCEDENCIA** (el texto exacto dado al modelo). Descarta propagarla a la etiqueta. Criterio de cierre
del issue (sustituido en el comentario): una `description` declarada en **cualquier** entity sobrevive
hasta lo que se genere a partir de ella y se puede recuperar después. El principio general es #293
(aparcado); este issue es la instancia concreta. Ver [[feedback_descripcion_es_procedencia]].

**Respuesta del crítico a la pregunta abierta**: hoy **no se genera nada** de una entity no NPC — se
vuelve volumen derivado con `label = ent.name` (`derive.ts:150-164`), sin `surface_desc`; el label
solo alimenta la heurística de valla (`fps-detail.ts:340`). La descripción muere **solo en el wire**;
el save (Format D) ya la conserva. `obj.description` en el cliente es el rótulo del objeto mirado
(`carga-de-tile.ts:105` → `main.ts:1244-1251`). El propio contrato ya se contradice: el tool dice
«NPCs:» y el zod (`scene-schema.ts:63-64`) y Python (`:775, :872-879`) la invitan en cualquier entity.
Medido: 0 de 59 entities no NPC en fixtures+snapshots y 0 de 579 en saves la llevan. Restricciones
que salen de ahí: `formatDToWorld` es ya el 2.º item de CRAP (54) — la rama nueva no puede añadir
decisión o salta el gate; `scene-normalize` son 278 mutantes > `tope_local`: se pide, no se mide en
local; el campo nuevo nace sin tipo en `WorldScene` (#378, dependencia no bloqueante).

### #264 — `MAX_GROUND_FEATURES` acota rasgos y no prims

| Afirma | Medido hoy |
|---|---|
| `MAX_GROUND_FEATURES = 64`, `path` hasta 16 puntos → 2n−1 prims → 1984 legales | **Cierto.** `blueprint/ground.ts:46,129,131`; `ground-prims.ts:115-142` (`pathPrims`: caja por segmento + cilindro por junta); no existe `MAX_GROUND_PRIMS` (grep → 0); `scene-validate.ts:245` solo expone `ground_cap` |
| Es coste, no bug visual | Cierto desde #185 (`groundOrder`) |
| Deuda de `ground-prims.ts` | La cifra del cuerpo caducó (comentario 2026-08-28: 116 vivos de 224); la vigente la da `npm run deuda` |

**PREMATURA (crítico, medido)**: sobre las 25 escenas con `ground` del árbol el máximo son **57 prims**
(`puerto_tile`), el motor real 25 y 15, los saves ≤12, frente a 1984 legales: la realidad está 35× por
debajo y cualquier tope se pondría a ojo, justo lo que el issue prohíbe. Los «1594 prims / ~80 ms» no
los asserta nadie. Desbloquea: coste de render medido por prim o un tile real que duela. **Fuera de la
tanda**; la medida se comenta en el issue.

## Alcance

**Dentro**
1. **#335 (PR aparte, tras la decisión del usuario)**: retirar `terrain_patches` entera (lector
   `scene-expand.ts:145-163`, saneador `narrative_schemas.py:587-603`, tests y corpus), `checkDeclaredChars`
   y la prosa de custom chars en `generate_scene.json:41`, `scene_instructions.md:36-50`,
   `tile_instructions.md:13`; `wall_char|floor_char|terrain_patches` al candado (`structure` no entra:
   uso legítimo en `greybox/surfaces.ts:109`); la leyenda inflada de Python fuera. Si la leyenda se
   queda (vado), el prompt lo enseña; si no, `terrain_legend` sale de zod, tool, prompts y Python.
2. `description` de cualquier entity sobrevive a `formatDToWorld` **sin pisar la etiqueta**; el
   contrato deja de acotarla a NPC y dice para qué es (procedencia). Lo que ya la consume (skin del
   NPC) no cambia de clave de caché.
3. ~~Tope de prims~~ — #264 fuera (prematura); se comenta la medida y sigue abierto.
4. Cada retirada de prosa o campo, en el candado `campos-retirados-no-vuelven` si aplica.
5. Tests: los de contrato (`contract-model-io.test.ts`, `scene-schema`), `scene-normalize`,
   `scene-validate`; mutación local de los módulos tocados que quepan en `tope_local` (`npm run mutacion
   -- local <id>`); los que no, se piden y se sigue.

**Fuera**: #293 (principio general de trazabilidad), #185 (cerrado), el troceo de `main.ts`, T6/T7.

## Criterios de aceptación

- **A1** (#335) Ninguna primitiva ofrecida al motor escribe chars y el contrato ya no dice lo
  contrario: `grep -rn "custom char\|terrain_patches\|wall_char\|floor_char" data/contract/ ai_server/`
  → 0; un tile con `terrain_patches` lo **rechaza** el zod nombrando el campo.
- **A2** `grep "structure's\|wall_char\|floor_char" data/contract/` → 0, y el candado lo sostiene (caso
  negativo en `architecture.test.ts`).
- **A3** `contract-prompts.test.ts` (§#203) verde: la raíz de `generate_scene.json` ⊆ `SCENE_FIELDS`; `contract-model-io.test.ts` **no mira este tool** (corrección del crítico).
- **A4** Entity no-NPC con `description` → en la world scene la etiqueta sigue siendo `name` y la
  descripción declarada viaja en su propio campo; sin `description` → nada inventado. Test en
  `scene-normalize` (positivo y negativo). El guion o test que lo mire desde el jugador: la etiqueta
  que se pinta no cambia (fixture `robledo_tile` antes/después).
- **A5** Comentada en #264 la medida (máx. 57 prims reales vs 1984 legales; sin coste de render
  medido) y el issue sigue abierto.
- **A6** `npm run verify` verde · `crap --check` dentro · `deuda` sin subir (75) · `node qa/run.mjs`
  completo verde (59) · `npm --prefix narrative-mcp run build` · `python3 -m unittest discover -s
  ai_server/tests` · `ruff check ai_server` · **`formatDToWorld` no sube de CRAP 54**.

## Restricción añadida por el usuario para #335 (2026-09-02, literal)

> «Asegurate de que no quede ningun rastro de la version anterior. Esos rastros confunden a los agentes
> y hacen que reaparezcan referencias al grid»

Es decir: la retirada no es solo del código que ejecuta. **Todo texto que describa el modelo anterior**
—el motor escribiendo un grid de terreno, chars propios, leyenda, parches, `structures`— se va también:
comentarios de código, docstrings, prosa de `data/contract/` (tool y prompts), `docs/arquitectura/`,
`docs/microservices/`, `CLAUDE.md`, `next.md`, cabeceras de tests y guiones, instrucciones del
narrative-mcp, `ai_server`. Lo que quede debe describir el modelo vigente: el motor declara `biome` +
`ground` + `volumes`; el grid es un raster DERIVADO que el engine sintetiza para colisión y costuras.
Criterio: un agente que lea cualquier fichero del repo no puede deducir que el motor escribe o
declara terreno por chars. **Candado**: los términos retirados en `campos-retirados-no-vuelven`; y, si
el arquitecto encuentra una forma de candar la PROSA (p. ej. `terrain_legend|custom char|wall_char`
sobre `docs/**/*.md` y `data/contract/**`), mejor que confiar en la memoria. Los saves y snapshots
locales (gitignored) no cuentan como rastro del repo, pero el ingeniero dice cuáles llevan
`terrain_legend` y qué pasa al cargarlos (fail-loud o ignorado; nunca saneado en silencio).

## Restricciones (vigentes de la serie)

- **No cerrar servidores ajenos** (hay otros agentes en la máquina): `./start.sh s` antes; solo
  `./start.sh --preset <slug>` / `--parar` para lo propio; nunca `pkill`/`kill` por puerto.
- **Cero créditos** en toda verificación (`e2e-sin-creditos`; `cliente-web` solo en Maqueta 3D).
- Español (España) con tildes. Rama + PR con `Closes #335`, `Closes #238` (y `#264` si entra) y la
  nota de honestidad (el CI no corre `qa/`). Commits con los trailers de la sesión. Sin push ni PR por
  parte del ingeniero: lo hace el coordinador.
- La mutación la autoriza el usuario más tarde («la lanzaré en un par de horas»): pedir y seguir.
- Los cuerpos de los tres issues tienen partes caducadas: **se comenta en cada uno lo que se midió**
  al cerrar, no se cita el cuerpo.
