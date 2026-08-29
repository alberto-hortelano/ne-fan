# QA — el contrato y sus espejos (#203 #237 #259)

**Rama** `feature/el-contrato-y-sus-espejos` · commit `14818a8` · árbol limpio al empezar y al terminar.
**Validado contra** la petición literal del usuario: *«Continúa lo que acabamos de construir: cerrar el
lado Python del candado. #203 ya viene reencuadrado y medido, y sus dos candados **NACEN ROJOS**.
#259 es el arriesgado y puede quedarse fuera si al medir sale caro.»*

**Lo primero, porque es el listón que puso el usuario**: los candados de la tanda se ponen rojos al
romperlos. **8 de 9**. Los tres que el usuario nombró (campos, guardia débil, fail-loud de entity)
nacen rojos y el rojo es del candado nuevo, no de otra cosa. El noveno — el cableado de
`WorldSnapshotSchema.scenes`, que es la mitad del criterio 4 que toca el arranque — **no lo ve nadie**:
se revierte entero y `lint`, `build` y **1629/1629 tests** siguen verdes.

Nada de esto se leyó del informe: cada rojo lo reproduje yo revirtiendo el arreglo.

---

## 1 · Los ocho criterios del §4

| # | Criterio | Veredicto | Evidencia (comando y salida real) |
|---|---|---|---|
| 1 | Un campo de `generate_scene.json` ausente del zod pone rojo un test, **acotado a raíz y `entities[]`** | ✅ cumple | Revertido `scatter_*` fuera de `sceneBaseShape` → `contract-prompts` **17 pass / 1 fail**, `actual: [ 'scatter_generators', 'scatter_zones' ]`. Revertido `attach` fuera de `EntityBase` → **17/1**, `actual: [ 'attach' ]`. En los dos casos falla **solo** el `it` nuevo: el rojo es del candado, no de arrastre. Y ninguna de las 87 rutas de prosa de `ground`/`volumes`/`vegetation_zones` produce rojo — el guardia está acotado como pedía el criterio |
| 2 | Los dos huecos se cierran **llevando el zod al JSON**, sin borrar campo vivo | ✅ cumple · ver **H1** | No es un `z.unknown()` mudo: con el bloque `scatter` REAL de `alta_fantasia/tile_0_0` → `ACEPTA`; `scatter_zones:"hola"` → `RECHAZA scatter_generators: debe ser un objeto…`; zona con `kind` inexistente → `RECHAZA scatter_zones[0]: kind 'no_existe' sin generador…`; `density:-1` → `RECHAZA scatter_zones[0].density: número 0..1.5 requerido`; zona sin `shape` → `RECHAZA … shape es rect\|ellipse\|poly`. Consumidores vivos: suite 1629/1629, guion `16-scatter-esquiva-el-suelo` verde, golden de atlas 6/6. **Reserva**: abre 3 divergencias TS↔Python nuevas (H1) |
| 3 | Un término prometido al modelo y ausente pone rojo el guardia débil | ✅ cumple | Restaurado `player_choice` en `ui_systems.md:39` → **17 pass / 1 fail**, `actual: [ 'player_choice (ui_systems.md:39)' ]` — rojo por exactamente 1. Censo propio, independiente: **107 tokens, 6 sin respaldo y los 6 son los exentos, 0 reales**. Corpus: **315 ficheros, 0 ignorados por git y 0 sin trackear** (reproduje el paseo y lo pasé por `git check-ignore` y `git ls-files`). El arreglo es correcto: `dialogue_choice` es el kind real (`bridge/router.ts:85`, `protocol/message-schema.ts:123`, `ai_server/llm_client.py:720`) |
| 4 | Las dos entradas de la tabla de #237 dan el **mismo veredicto**, con las poblaciones separadas y **sin dejar los 20 tiles rechazados** | ✅ cumple · ver **H2**, **H3** | Diferencial ejecutado sobre los dos procesos: `tile con size` → `zod=RECHAZA · ai_server=RECHAZA`; `entity description vacía` → `RECHAZA/RECHAZA`; también `"   "` y el grid `terrain`. Arranque: `gameGenerationStatus`+`loadWorldSnapshot` sobre los **4 juegos reales** → `status=ready` y **HIT** en los cuatro (9+9+1+1 = 20 escenas), o sea que `start_session` replayea en vez de llamar al motor. `npx tsx scripts/gate-snapshots.ts` → **20/20 aceptadas**. Batería completa **38/38 verde**. **Reserva**: el cableado no tiene candado (H2) y queda una divergencia del mismo eje sin cerrar (H3) |
| 5 | Las fixtures compartidas dejan de probar solo el acuerdo previo (al menos una **falla** si se revierte el arreglo) | ✅ cumple · ver **H4** | Revertidos los tres arreglos de Python uno a uno con `qa/contrato-candados-en-negativo.mjs`: `invalid/tile_con_size.json` + `invalid/tile_con_grid_terrain.json` rojas; `invalid/npc_con_description_vacia.json` roja; `invalid/entity_con_campo_desconocido.json` roja. Las **cuatro** fixtures nuevas se ponen rojas, cada una por su arreglo. Y el candado no es verde vacío: con los 20 tiles gitignorados **movidos fuera del árbol**, `npm test` sigue **1629/1629** — ningún test los lee. **Reserva**: el lado TS del mismo set mide el `dist/` (H4) |
| 6 | Un campo desconocido en una entity produce **error preciso al modelo** | ✅ cumple | Revertido `.strict()` → `.passthrough()`: `test/scene-schema.test.ts` rojo por **dos** `it`, los dos del MENSAJE («nombra la entity, la clave que sobra y las 12 que valen» y «con varias claves las enumera todas; sin `id` no se inventa uno»). Mensaje verificado en los dos procesos, nombrando entity, clave y las 12 válidas. La cadena no tiene copia a mano: `ENTITY_FIELDS` del zod (del shape) y el de Python (`_entity_fields_del_contrato`, del tool JSON) salen **idénticos y en el mismo orden** — comparados en vivo — y el guardia del criterio 1 canda tool↔zod en las dos direcciones |
| 7 | Nada de esto gasta créditos | ✅ cumple | Todo con `e2e-sin-creditos` (fake-ai-server); el HUD de las capturas dice `gasto sesión 0,00 € · total 0,00 €` y el runner imprime `⛨ guardarraíl: cliente y bridge declaran fake:true`. Mis propias pruebas son parseo local (tsx/python3). No arranqué ningún servicio de imagen. **No ejecuté un solo `pkill` ni maté por puerto**; el guion nuevo se apoya en `qa/run.mjs`, que reserva su propio bloque |
| 8 | Riesgo de arte **cero y medido** | ✅ cumple la medida · ❌ el razonamiento (**H5**) | `npx tsx --test test/fps-atlas-golden.test.ts` → **6/6**, ningún digest `cells` rotado. Medida propia añadida: deep-diff crudo↔`ExpandedSceneSchema.parse` sobre las 20 escenas reales → **0 diferencias**. Pero la RAZÓN escrita («ningún schema de esta tanda devuelve datos parseados») es falsa y la demuestro falsa en H5 |

### Medidas de acompañamiento (todas reproducidas, no citadas)

| Medida | Base declarada | Mi medida |
|---|---|---|
| `node qa/run.mjs` | 38 verde / 38 | **38 verde · 0 rojo de 38** (guion 34 VERDE: #320 no se activó) |
| `npm run verify` (nefan-core) | 1616 → 1629 | **1629 tests · 294 suites · 0 fail · EXIT 0** |
| `python3 -m unittest discover -s ai_server/tests` | 135 → 136 | **Ran 136 — OK** |
| `nefan-html npx tsc --noEmit` · `narrative-mcp npm run build` | verdes | **EXIT 0 · EXIT 0** |
| `npm run coverage && npm run crap -- --check` | dentro de umbrales | **1138 funciones · líneas 89,8 % · CRAP ≤ 73: 0 por encima — ✔ dentro de los umbrales** |
| `npm run deuda` | 66 | **66 items — 15 fronteras · 12 CRAP · 39 mutación** (cabecera «Deuda **PARCIAL** … sin medir: mutación», declarado por el ingeniero) |
| `npx tsx scripts/gate-snapshots.ts` | 20/20 | **20/20 aceptadas (4 juegos)** |

---

## 2 · Hallazgos

### 🟠 Importante

#### H1 · La tanda cierra tres divergencias TS↔Python y **abre tres nuevas**, del mismo eje

`scatter_generators`/`scatter_zones` entran en el zod delegando en `parseScatter` (criterio 2). El
saneador de ai_server **no mira el scatter**. Resultado: el mismo tile recibe dos veredictos según por
dónde entre — que es la frase con la que el propio ingeniero justificó alinear también el grid
`terrain`.

Medido con el guion nuevo `qa/guiones/40-el-mismo-tile-no-puede-tener-dos-veredictos.mjs`:

```
⚠ scatter_zones basura:        zod=RECHAZA · ai_server=ACEPTA
⚠ scatter zona sin generador:  zod=RECHAZA · ai_server=ACEPTA
⚠ scatter density negativa:    zod=RECHAZA · ai_server=ACEPTA
```

Y son **nuevas**, no heredadas. Con el `scene-schema.ts` de `cebf9f8` (el commit anterior) los dos
procesos **coincidían** en los tres casos:

```
ANTES DE LA TANDA · scatter_zones basura        zod=ACEPTA  (python=ACEPTA)
ANTES DE LA TANDA · scatter zona sin generador  zod=ACEPTA  (python=ACEPTA)
ANTES DE LA TANDA · scatter density negativa    zod=ACEPTA  (python=ACEPTA)
```

**Reproducción desde el arranque**: `node qa/run.mjs 40-el-mismo` (no abre partida, `sinMotor`).
**Qué esperaba el usuario**: que la tanda que se llama «el contrato deja de tener espejos sin comparar»
no dejara el contador de espejos donde estaba. Hoy cierra 3 y abre 3.
**Impacto real acotado, y lo digo**: no es silencioso hasta el jugador — el `validateScene` del bridge
(`bootstrap-tile.ts:80`, `tile.ts`) llama a `parseScatter` río abajo, así que un scatter malo acaba
rechazado por los dos caminos. Lo que cambia es **dónde** falla y con qué mensaje, y que el set de
fixtures compartidas —el mecanismo que esta tanda vino a reforzar— no lo vigila.
**Salidas posibles**: (a) alinear el saneador Python (`validate_scene_response` llamando a su espejo de
`parseScatter`, si existe) o (b) declarar por escrito que el scatter se valida solo en nefan-core y
sacarlo del eje, con fixture que lo fije. Cualquiera de las dos, pero decidida.

#### H2 · El cableado del criterio 4 —el que toca el arranque— **no tiene candado ninguno**

`WorldSnapshotSchema.scenes` pasa de `z.unknown()` a `ExpandedSceneSchema` (`world-snapshot.ts:41`).
Es el punto donde la separación de poblaciones deja de ser una declaración y empieza a valer algo: es
lo único que hace que la escena que el juego CARGA tenga tipo.

Lo revertí entero (la línea **y** el import, para que el linter no lo tape):

```
LINT VERDE
BUILD VERDE
ℹ tests 1629 · pass 1629 · fail 0
```

Con solo la línea revertida, el único que protesta es
`@typescript-eslint/no-unused-vars` por el import huérfano — un candado accidental que desaparece en
cuanto alguien borra la línea de más, y que además no dice nada del comportamiento.

**Reproducción**: `node qa/contrato-candados-en-negativo.mjs cableado` → `🟢 VERDE … ROMPERLO NO CAMBIA NADA`.
**Qué esperaba el usuario**: «nacen rojos». Éste ni nace ni puede nacer.
**Coste de arreglarlo**: bajo. Un `it` en `world-snapshot.test.ts` que escriba un snapshot con una
escena **a medio expandir** (sin `__expanded`, o sin `terrain`) y exija que `loadWorldSnapshot` lance.
Es dato sintético, no toca los 20 gitignorados y se pone rojo con la reversión.

#### H3 · Queda una divergencia del **mismo eje** sin cerrar ni declarar: `style_ref` de escena

`EmittedSceneSchema` la RECHAZA con error al modelo (`scene-schema.ts`, superRefine); `ai_server` la
**poda con un warning** y sigue (`narrative_schemas.py:592-595`, `data.pop("style_ref", None)`).

```
⚠ style_ref de escena: zod=RECHAZA · ai_server=ACEPTA
```

No es de esta tanda —ya estaba— y la tabla del §3 de los requisitos solo listaba dos entradas, así
que **no incumple el criterio 4**. Lo reporto por dos razones: (a) el ingeniero declaró haber buscado
las divergencias residuales y haber cerrado la que encontró (`.trim()`), lo que se lee como «no quedan
más», y (b) es justo el eje que más tráfico tiene — **18 de los 20 tiles locales llevan `style_ref`
heredada**, o sea que el modelo la sigue emitiendo y hoy solo la rebota uno de los dos caminos.

#### H5 · La justificación del criterio 8 es falsa: **sí hay un schema de la tanda que devuelve datos parseados**

El informe (§criterio 8) dice: *«ningún schema de esta tanda devuelve datos parseados
(`validateContract` sigue haciendo `safeParse` y tirando el resultado), así que ninguno puede
reescribir una escena»*. `loadWorldSnapshot` termina en **`return parsed.data as unknown as WorldSnapshot;`**
(`world-snapshot.ts:113`), y desde esta tanda `parsed.data.scenes` pasa por `ExpandedSceneSchema`.

Demostrado con una escena real de `colonia_aster/tile_0_0`:

```
disco decía               : "  tabernero corpulento de mandil manchado  "
loadWorldSnapshot devuelve: "tabernero corpulento de mandil manchado"
→ REESCRITO por el zod (el .trim() transforma)
```

**La medida sigue siendo buena**: sobre los 20 tiles de hoy el deep-diff crudo↔parseado da **0
diferencias** y el golden del atlas está intacto, así que el riesgo materializado es cero y el
criterio 8 se cumple. Lo que falla es el argumento, y en esta casa un argumento escrito después se
congela como documentación falsa (memoria «Una decisión correcta con una razón inventada»). Hay que
cambiar la frase por la medida.

Va con una consecuencia que tampoco está dicha: **la ruta de carga es ahora mucho más estricta**. Los
schemas anidados son `.strict()`, así que una clave desconocida dentro de un `volume` o de una
`entity` de un snapshot ya no pasa:

```
volumes[0].campo_futuro → RECHAZA: volumes.0: Unrecognized key(s) in object: 'campo_futuro'
entities[0].campo_futuro → RECHAZA: la entity "barkeep" trae la clave `campo_futuro`…
escena.campo_futuro      → ACEPTA y lo CONSERVA
```

Antes (`z.record(z.string(), z.unknown())`) pasaba cualquier cosa. Y el desenlace de un rechazo es
caro y **mudo para el jugador**: `session.ts:415-419` hace `console.error` y cae al
`runBootstrapTile`, que llama al motor y **gasta** — el jugador solo ve «Generando mundo inicial…».
Ese `catch` es anterior a la tanda, pero la tanda amplía mucho el conjunto de snapshots que lo
disparan, y la única señal que lo cubre es un script manual que no puede correr en CI.

### 🟡 Menor

#### H4 · El lado **TS** del set de fixtures compartidas mide el `dist/`, no la fuente

`test/contract-fixtures.test.ts` llega al schema por `narrative-mcp/validators.ts` → `@nefan/core` →
`dist/src/index.js`. Con el `.strict()` **revertido en la fuente y sin rebuild**:

```
✔ invalid/entity_con_campo_desconocido.json: … (#259)
ℹ tests 61 · pass 61 · fail 0
```

O sea que la fixture de #259 no se entera. En CI no muerde (`.github/workflows/ci.yml:47` hace
`npm run build` antes de la suite) y `npm run verify` también compila primero; muerde en el bucle
local de quien corre `npm test` a secas. El ingeniero lo descubrió y lo dejó escrito, pero en el
`porque` de `mutation-targets.json` y como razón para excluirlo de la mutación — no como lo que
también es: el criterio 5 solo es ejercitable por el lado Python sin recompilar.

#### H6 · `grep FormatDSceneSchema = 0` no es cierto: quedan 7 referencias al nombre retirado

El informe (§4.5) afirma `grep FormatDSceneSchema` = **0**. Es cierto en TS/JS; en Python quedan siete,
y no en sitios inocuos — son justo los comentarios que declaran la relación de espejo que esta tanda
viene a arreglar:

```
ai_server/narrative_schemas.py:484,537,575
ai_server/llm_client.py:437
ai_server/tests/test_scene_validate.py:2,85
ai_server/tests/test_contract_fixtures.py:72
```

`narrative_schemas.py:484` dice «espejo de FormatDSceneSchema, el gate del pre-flight MCP» y
`test_contract_fixtures.py:72` lo repite. Con dos schemas donde había uno, un lector de Python no
puede saber de cuál de los dos es espejo — que es exactamente la ambigüedad que #237 pagaba.

#### H7 · `gate-snapshots.ts` **dice** que un 0/0 no comprueba nada, pero **sale con 0**

Aparté los 4 `world/tile.json` (los 20 tiles) y lo corrí:

```
ExpandedSceneSchema sobre snapshots LOCALES: 0/0 aceptadas (0 juego(s) con snapshot en el árbol)
  (sin snapshots locales: este gate no ha comprobado NADA — genera un mundo desde el título)
GATE EXIT=0
```

La prosa es impecable y responde a lo que se le pidió. El código de salida, no: cualquiera que lo
encadene (`npx tsx scripts/gate-snapshots.ts && …`, un hook, un CI futuro) recibe un verde de un gate
que no miró nada — en un clon limpio, siempre. `process.exit(total === 0 ? 2 : ok === total ? 0 : 1)`
lo cerraría sin quitarle la utilidad manual. Los tiles se devolvieron con `md5sum -c` **OK** en los cuatro.

#### H8 · El candidato a issue, medido: el bloque `combat` **es una promesa muerta**, y peor que `player_choice`

`ui_systems.md:54` y `:67-70` le prometen al modelo: *«give hostile entities a `combat` block —
`{health, weapon_id, personality: {aggression, preferred_attacks[], reaction_time, combat_range}}`»*.

Lo que medí:

1. `combat` **no aparece en ningún tool JSON** (0 ficheros en `data/contract/tools/`), ni en
   `generate_scene` ni en `narrative_react`. Confirmado.
2. El guardia débil no lo ve, y **no solo por no ser snake_case**: todos sus campos hijos
   (`weapon_id`, `preferred_attacks`, `reaction_time`, `combat_range`, `aggression`) SÍ existen como
   identificadores (`src/types.ts:52-55`, `protocol/message-schema.ts:30-33`), así que el guardia
   estaría verde aunque mirase dentro. Su límite real no es el `snake_case`: es que comprueba que el
   token EXISTA, no que el bloque llegue a alguien.
3. **Sí tiene un consumidor aparente**: `src/store/state-projection.ts:43-47` lee
   `data.combat.health` / `.max_health` / `.weapon_id`, y el comentario de `:28` dice literalmente
   «nested: `{combat: {health, weapon_id}}` (spawn_entity consequences)».
4. **Y ese consumidor es inalcanzable.** Proyecta solo entidades con `e.type === "enemy"`
   (`state-projection.ts:40`), y **nada en el repo escribe nunca ese tipo**: los dos llamadores de
   `recordEntitySpawned` pasan `"npc"` (`npc-records.ts:150`) o el `entity_kind` de la consequence
   (`consequence-handler.ts:84-93`), cuyo enum es `["npc","building","object"]`
   (`schemas.ts:40`). `ENTITY_KINDS` de escena tampoco tiene «enemy» ni «creature».
   Los únicos enemigos que llegan al sim vienen del **cliente** por `load_room`
   (`bridge/handlers/simulation.ts:132`), que es la vía de las fixtures.
5. `personality` ni siquiera se lee de `data.combat`: el sim la recibe por
   `msg.enemies[].personality`, de la misma vía muerta.

**Veredicto**: es de la misma clase que `player_choice` —el prompt promete algo que no existe— pero
más caro de diagnosticar, porque hay código que *parece* consumirlo. Si el motor sigue la instrucción,
el bloque viaja por el `.passthrough()` de `SpawnEntity` hasta `entity.data` y ahí se queda. **No es
de esta tanda** (el ingeniero hizo bien en no tocarlo) y **sí merece issue**, con el sujeto correcto:
no es «declarar `combat` en el tool», es «no hay forma de que el motor narrativo cree un enemigo».

---

## 3 · Workarounds usados durante la prueba

| Workaround | Por qué | Veredicto |
|---|---|---|
| Escribir en el árbol para revertir cada arreglo (los 9 candados en negativo) | Es la única forma de comprobar «nace rojo» sin creerse el informe | **No afecta al jugador.** El guion `qa/contrato-candados-en-negativo.mjs` se niega a arrancar sobre un árbol sucio, restaura en `finally` y verifica byte a byte. Comprobado con `git status --porcelain` vacío después de cada tanda de reversiones |
| Apartar los 4 `world/tile.json` para ejercer el 0/0 del gate | Están gitignorados: `git checkout` no puede devolverlos | **No afecta al jugador**, pero produjo **H7**. Restaurados con `md5sum -c` OK en los cuatro |
| Reconstruir `dist/` después de las reversiones de fuente | `contract-fixtures` lee el compilado y lo dejé consistente | **Es un hallazgo, no un apaño**: es **H4** |
| Ejecutar `loadWorldSnapshot` en un script en vez de arrancar una partida sobre los juegos reales | Arrancar con `NEFAN_GAMES_DIR` apuntando a `data/games` reescribiría los 20 tiles del usuario y destruiría la evidencia del gate | **No afecta al jugador**: llamo a la MISMA función que `session.ts:416`, con el mismo `world_doc_hash`, sobre los mismos ficheros. La otra mitad (el replay) la ejerce la batería con mundos generados |

Ningún workaround fue necesario para *observar la feature*: los tres candados se ven desde su propio
test y el arranque se ve desde la batería. No hubo que ocultar un overlay ni forzar estado.

---

## 4 · Lo que NO probé, y por qué

- **Que el motor real se corrija con los mensajes nuevos.** Los mensajes están verificados palabra por
  palabra en los dos procesos, pero que un LLM los entienda solo lo dice una sesión con motor, y eso
  **gasta**. ⚠️ no probado, y lo digo en vez de aprobarlo por parecido. Lo mismo declaró el ingeniero.
- **La corrida de mutación del módulo `contrato-escena`.** Nace sin base (`break: 0`), el diff fuerza
  la corrida COMPLETA por dos vías y está pedida. ⚠️ no probado aquí — y es la medida que más falta
  hace, porque los tres candados nuevos comparan **conjuntos de nombres**, que es el arquetipo del
  verde que no comprueba nada. Mi `qa/contrato-candados-en-negativo.mjs` es un sustituto pobre pero
  inmediato: dice si se pueden poner rojos, no cuántos mutantes matan.
- **Sesión narrativa real con `play`.** Gastaría. Cubierto por el diferencial y por `e2e-sin-creditos`.
- **Snapshots de otros checkouts / de otras versiones del engine.** Solo puedo medir los 20 de esta
  máquina; el gate no puede correr en CI (H7 y §8 del informe).

---

## 5 · Los guiones que dejo

| Fichero | Qué hace | Estado hoy |
|---|---|---|
| `qa/contrato-candados-en-negativo.mjs` | Rompe los **9** arreglos de la tanda uno a uno (zod, prompt, cableado, y los tres del saneador Python) y exige que su batería se ponga ROJA. Sigue el patrón ya establecido por `qa/mutacion-candados-en-negativo.mjs`: fuera de `guiones/` porque no hay nada que mirar en pantalla, se niega sobre árbol sucio, restaura en `finally` y verifica byte a byte | **8 rojos · 1 verde** → sale con 1. El verde es **H2** |
| `qa/guiones/40-el-mismo-tile-no-puede-tener-dos-veredictos.mjs` | Pasa 14 payloads por los DOS gates (zod por la fuente con `tsx`, `validate_scene_response` con `python3`) y compara veredictos. Generaliza el set de fixtures, que solo compara lo que alguien se acordó de escribir. `sinMotor`: ni navegador ni motor | **ROJO por 4** → **H1** (3) + **H3** (1) |

**Probados en negativo, como manda `qa/README.md`:**

- Guion 40, negativo (a): con el `scene-schema.ts` de `cebf9f8` las divergencias bajan de **4 a 1** —
  lo que prueba que las 3 de scatter las abre esta tanda.
- Guion 40, negativo (b): devolviendo `EntitySchema` a `.passthrough()` aparece una divergencia
  **nueva** (`entity con clave desconocida: zod=ACEPTA · ai_server=RECHAZA`) y el recuento sube a 5.
  O sea que el arnés se mueve con el código en las dos direcciones.
- Guion 40, guardarraíles internos: exige que la rejilla tenga aceptaciones **y** rechazos por los dos
  lados y ≥8 casos coincidentes, para que no pueda salir verde por vacío.
- `contrato-candados-en-negativo.mjs`: mide primero que **las 5 baterías estén verdes de base** (si no,
  aborta: un rojo sobre un rojo no dice nada) y aborta si un patrón de búsqueda no aparece exactamente
  una vez, en vez de dar un falso verde cuando el código se mueva.

**Efecto en la batería, medido** (`node qa/run.mjs` con el guion 40 ya dentro):

```
38 en verde · 1 en rojo de 39
```

Los 38 de la línea base siguen verdes uno a uno —incluido el 34, que #320 declara intermitente y que
salió verde en las **dos** baterías completas que corrí—; el único rojo es el 40, y es H1+H3.

---

## 6 · Veredicto

**APTO CON RESERVAS.**

Los ocho criterios del §4 se cumplen y los tres candados que el usuario nombró **nacen rojos de
verdad** — lo reproduje uno a uno y el rojo es suyo, no de arrastre. El riesgo caro (los 20 tiles) está
medido por la vía real: los cuatro juegos cargan con HIT y el arranque no llama al motor. Nada de la
tanda mueve un digest de arte, ni gasta, ni rompe la batería.

Las reservas, por orden de lo que costaría dejarlas pasar:

1. **H2** — el cableado del criterio 4 no lo canda nadie: `lint`, `build` y 1629 tests verdes con la
   frontera desconectada. Es el criterio con más consecuencia (el arranque y la factura) y el único
   sin candado. Barato de cerrar.
2. **H1** — la tanda cierra tres divergencias y abre tres. No rompe el juego, pero contradice su
   propio título y su propio criterio de desviación. Hay que decidir: alinear o declarar fuera del eje.
3. **H5** — hay que sustituir la justificación falsa del criterio 8 por la medida, y decir en voz alta
   que la ruta de carga se ha endurecido mucho y que su fallo es mudo y facturable.
4. **H3, H4, H6, H7** — menores, de una línea o de un comentario cada una.
5. **H8** — no es de esta tanda; sale como issue con el sujeto corregido.

No es «no apto»: nada de lo encontrado deja al jugador peor que antes del commit, y el trabajo hecho
es sólido y honesto en casi todo. Es «con reservas» porque la tanda se compró por una frase —«nacen
rojos»— y hay un candado central que no puede nacer rojo de ninguna manera.
