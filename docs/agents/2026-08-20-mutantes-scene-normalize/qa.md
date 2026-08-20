# QA — poda de `terrain_features` + tests de `scene-normalize.ts`

**Fecha**: 2026-08-20 · **Rama**: `tests/mutantes-scene-normalize` (sin commitear) · **Stack**: preset 5
(`./start.sh --preset 5`, fake-ai-server, **cero créditos**).

Lo que se me pidió validar no son las métricas (las verificó el coordinador) sino **que lo que los
tests fijan es lo que el juego hace de verdad** en el flujo real motor → bridge → cliente 2D. Todo
lo mecánico está en tres guiones nuevos, **probados en negativo** (§Guiones). Lo que es juicio va
en prosa.

---

## Tabla de criterios

| Criterio (del encargo) | Veredicto | Evidencia |
|---|---|---|
| **1.** La poda no rompió el suelo: terreno, caminos y agua siguen apareciendo por `ground` → `scene-expand` → grid | ✅ cumple | `qa/guiones/05-terreno-desde-ground.mjs` en verde. Partida real (título → alta_fantasia → Mundo abierto → Comenzar): el tile trae `ground` con 6 rasgos y el grid `{g:14978, _:873, W:73, o:308, w:152}`; cada camino y cada masa de agua declarados tienen su char en la celda que declara el motor. Captura `evidencia-suelo-desde-ground.png` (Maqueta 3D): plaza, fuente, camino, carro, casas y taberna se ven |
| **1b.** …y no solo en el tile pre-generado, sino rasterizando EN VIVO | ✅ cumple | El tile de entrada es un **snapshot** (`Bridge: world snapshot HIT para "alta_fantasia" … bootstrap sin motor`), así que por sí solo no probaba nada. El guion 05 §6 camina hasta la frontera, acepta explorar y entra en `tile_1_0` recién generado: `2 rasgos · chars {"g":15604,"_":780}` y los dos `camino_N` de su `ground` están en su grid |
| **1c.** Costura entre tiles conservada tras la poda | ✅ cumple | `tile_1_0.ground = [{camino_0, points:[[0,88],[64,64],[128,88]], w:4}, …]` — entra por la fila 88 del oeste, exactamente donde el bootstrap saca su `camino_este` por `[128,88]` |
| **2.** Los sólidos de la leyenda bloquean de verdad al jugador (andando, no leyendo JSON) | ✅ cumple | `qa/guiones/06-solidos-de-la-leyenda.mjs` en verde: en `robledo_village` el jugador **cruza el río por el puente** (fila 19, chars `bbbb___`) y **rebota contra el agua** (fila 0), avanzando hasta la orilla. Muestreo del tile de sesión: **18/18 celdas de agua bloquean**, 24/95 de camino (esas 24, bajo volúmenes: fuente, puestos) |
| **2b.** `solid:false` de la leyenda abre un vado | ✅ cumple | Guion 06 §4: la misma escena servida con `w: {name:"vado", solid:false}` saca `w` de `solid_chars`, conserva el nombre y el jugador **sí cruza** por la fila que antes le bloqueaba |
| **3.** `role`/`style_ref`/`description` llegan enteros hasta donde se deriva la clave del skin | ⚠️ **a medias** | Dentro del cliente, sí: guion 07 §5 (escena que los declara → viajan tal cual; basura/vacío → la clave ni aparece). **Pero en el flujo real nunca llegan**: `ai_server` los borra de toda entity antes del bridge → **Hallazgo 1** |
| **3b.** Las dos vías que calculan la clave (partida y batch de estilo) no divergen | ✅ cumple | Guion 07 conduce **las dos** en la misma página. Payloads idénticos byte a byte: `{"angle":"isometric_30","anim":"idle","model":"y_bot","prompt":"Tabernero corpulento","style_id":"acuarela_luminosa","style_role":"commoner"}`. El skin **no** se paga dos veces |
| **4a.** `campos-retirados-no-vuelven` sin falsos positivos en trabajo legítimo | ✅ cumple | Sonda sobre el motor de reglas: `terrainFeatures`, `terrain_features_v2` y `my_terrain_features_map` **pasan**; el campo retirado salta en código y en comentario (por diseño) |
| **4b.** …y cubriendo lo que dice cubrir | ❌ **NO cumple** | Su `desc` dice "en ningún proceso" pero los seis roots escaneados **no incluyen** narrative-mcp, labs, `nefan-core/test/**` ni `data/**` — justo donde el campo vivía → **Hallazgo 3** |
| **4c.** Mensaje de fallo dice qué hacer | ✅ cumple | `[campos-retirados-no-vuelven] … invariante: <por qué> … nefan-core/src/x.ts:1 — patrón prohibido: "terrain_features" … Repara el import/patrón, o añade una excepción CON MOTIVO en data/contract/arch-rules.json` |
| **4d.** `mutation-config.test.ts` sin falsos positivos | ❌ **NO cumple** | Un `test:mutate` con glob (`node --test test/*.test.ts`, que la shell expande) lo pone rojo con un mensaje falso → **Hallazgo 4** |
| **4e.** …y sin falsos negativos en su propio fallo de origen | ❌ **NO cumple** | Un objetivo con glob roto (`src/pluginz/dsl/**/*.ts`) pasa **en verde** → **Hallazgo 5** |
| **5.** Pasada adversarial: sin `ground`, borde de tile, resume de save, leyenda vacía, no-Format-D | ✅ cumple | §Pasada adversarial |
| **Regresión general** | ✅ cumple | `npm run verify`: 1070 tests, 0 fallos. Los 4 guiones sembrados siguen verdes: **7/7 guiones en verde** |
| **Coste** | ✅ cumple | `gasto sesión 0,00 € · total 0,00 €` en el HUD de todas las capturas; todo contra `:18765` |

---

## Hallazgos

### 1 · IMPORTANTE — `ai_server` borra `role`, `style_ref` y `description` de toda entity: los tres campos que los tests nuevos fijan no llegan nunca a `formatDToWorld` en el juego real

`ai_server/narrative_schemas.py::validate_scene_response` reconstruye cada entity con una lista
blanca (`clean_ent`, línea ~767) que solo conserva `id, kind, name, cell, footprint, glyph` +
`shape, h, texture_hash, model_hash, attach`. Comprobado ejecutando el saneador real:

```
$ python -c "... validate_scene_response(escena con npc {role, style_ref, description}) ..."
ENTIDAD TRAS ai_server: {"id":"guardia","kind":"npc","name":"Guardia","cell":[1,1],"footprint":[1,1],"glyph":"n"}
TILE · entidad tras ai_server: {"id":"guardia","kind":"npc","name":"Guardia","cell":[60,60],"footprint":[1,1],"glyph":"n"}
TILE · style_ref de ESCENA: settlement      ← el de ESCENA sí sobrevive; el de la ENTITY no
```

Se aplica en **las dos** rutas del motor (`ai_server/llm_client.py:436` para MCP y `:505` para API
directa), así que ninguna escena del motor puede llevar esos campos.

**Por qué importa** (no es un detalle de contrato):

- `data/contract/tools/generate_scene.json` **le pide explícitamente al motor** el `style_ref` por
  NPC ("NPCs only, optional: id of the character reference … that best matches this NPC's look").
  El motor lo emite y se tira a la basura sin traza.
- Sin `style_ref` y sin `role`, `npcSkinStyleRef` devuelve siempre `"commoner"`. Verificado en la
  partida real: **todas** las peticiones de skin salen con `"style_role":"commoner"`. Es
  exactamente el bug que el comentario de `sprite-renderer.ts:158` da por arreglado el 2026-08-18
  ("Sin él el server cae a commoner — TODOS los skins usaban esa ref"): sigue vivo, una capa más
  arriba.
- Los 5 tests del bloque «el NPC llega entero a la clave de caché del skin» pasan y son correctos
  sobre `formatDToWorld`, pero **defienden un camino que hoy está muerto aguas arriba**. Es el caso
  que el encargo pedía cazar: un test que fija algo que el juego no cumple, aunque el test pase.

**Reproducción desde el arranque**: `./start.sh --preset 5` → `http://localhost:3000/?ai=http://127.0.0.1:18765`
→ Nueva partida → *alta_fantasia* → *Mundo abierto* → Personajes *Imagen IA* → Continuar → Comenzar.
La petición a `/skin_sprite_sheet` del tabernero lleva `style_role: "commoner"` aunque el motor
declare otra cosa. (En el bench el NPC no declara nada; el saneador prueba que aunque lo declarase,
no llegaría.)

**Qué esperaba el usuario**: que la ref de personaje elegida por el motor guiara el skin — es la
razón de ser de `world.style_refs.characters` y del campo en el contrato.

**No es una regresión de esta tanda.** Lo señalo porque el criterio 4 de `requisitos.md` dice que si
un test confirma el bug de skins se arregla en esta misma tanda, y porque los tests nuevos hacen
parecer resuelto algo que no lo está. La corrección es de una línea en `narrative_schemas.py`
(añadir los tres campos a la lista blanca) más su test.

---

### 2 · IMPORTANTE — el río de una escena de grid no se pinta: el jugador rebota contra agua invisible

En `robledo_village` (vista oblicua, sin overlays de depuración) **no hay río**. El molino tiene su
"rueda hidráulica" sobre hierba seca y el jugador choca contra un obstáculo que no ve. El camino y
la plaza empedrada sí se pintan.

Medido, no supuesto (sonda de color sobre el lienzo, con el overlay B en «sin overlay»):

```
celdas que paintTerrainGrid SÍ rellena: {a:14, w:117, d:204, _:80, o:9, s:35, b:5}
píxeles en pantalla:  camino(_) 2253 · piedra(s) 1731 · agua(w) 0 · puente(b) 0 · arena(a) 0 · madera(o) 0 · tierra(d) 0
prueba de control: pintando el agua de magenta → 0 px magenta;  pintando el CAMINO de magenta → 2253 px magenta
prueba de alcance: pintando la HIERBA de amarillo → 21186 px, y solo en la mitad izquierda del mapa
```

La última línea es la pista: **la capa de terreno horneada solo cubre parte del tile**; el resto se
queda con el color plano de fondo, y ahí caen el río, el puente, la arena, la madera y la tierra.
Captura `evidencia-rio-invisible.png` (hierba en amarillo: se ve dónde acaba la capa, justo antes
del río).

**Reproducción desde el arranque**: `./start.sh --preset 5` → título → cerrar → selector `Room` →
`robledo_village` → B hasta «sin overlay» → colocarse en (19, −19), que es agua según el grid.

**No lo causa este diff**, y lo compruebo en vez de suponerlo: lo único que la poda quitó del
renderer es `paintTerrainFeatures`, que pintaba `terrain_features`; `robledo_village.json` **nunca**
tuvo ese campo (`has terrain_features: False`) y las escenas del motor lo recibían vacío (el
saneador de `ai_server` escribía `terrain_features: []`, como recoge el propio `why` de la regla
nueva). `bakeTerrainLayer`, `tileView`, `paintTerrainGrid` y `toScreen` están intactos en el diff.

El matiz que sí toca esta tanda: para un save anterior a la retirada, el pintor vectorial dibujaba
el río **encima** de la capa horneada y tapaba este fallo. El usuario aceptó perder eso; lo que
queda al descubierto es un bug propio del pintado por grid.

---

### 3 · IMPORTANTE — el candado `campos-retirados-no-vuelven` no vigila los sitios donde el campo vivía

Su `desc` promete "no reaparece en **ningún proceso**", pero solo escanea seis roots. Sonda sobre el
motor de reglas real (`checkArchitecture` con la config del repo):

```
🟢 pasa   camelCase legítimo                 nefan-core/src/x.ts
🟢 pasa   campo nuevo con sufijo             nefan-core/src/x.ts      (terrain_features_v2)
🟢 pasa   prefijo                            nefan-core/src/x.ts      (my_terrain_features_map)
🔴 SALTA  el campo retirado, en código       nefan-core/src/x.ts
🔴 SALTA  el campo retirado, en comentario   nefan-core/src/x.ts
🟢 pasa   fichero de test de nefan-core      nefan-core/test/x.test.ts
🟢 pasa   narrative-mcp (proceso vivo)       narrative-mcp/validators.ts
🟢 pasa   bench del preset 5                 labs/narrative/fake-ai-server.mjs
🟢 pasa   prompt del contrato                nefan-core/data/contract/prompts/blueprint_review.md
🟢 pasa   fixture de escena                  nefan-core/data/scenes/robledo_village.json
```

Los cinco últimos son exactamente los sitios de los que esta tanda tuvo que sacar el campo
(`implementacion.md` §1a y §5.3). O sea: el candado no habría detectado la mitad del trabajo que
justifica su existencia, y no detectaría la reincidencia. **Falsos positivos: ninguno** — el límite
de palabra (`\b`) deja pasar `terrainFeatures`, `terrain_features_v2` y `my_terrain_features_map`, y
el mensaje de fallo dice qué hacer (reparar o añadir excepción con motivo).

**Qué esperaría quien lo lea**: que `grep -rn terrain_features` a cero (el listón que fija
`requisitos.md`) esté sujeto por el candado. Hoy el candado sujeta un subconjunto.

---

### 4 · MENOR — `mutation-config.test.ts` se pone rojo con un `test:mutate` legítimo, y con un mensaje falso

```
$ # test:mutate = "node --import tsx --test test/*.test.ts"   (la shell lo expande: node ve TODOS los ficheros)
$ node --import tsx --test test/mutation-config.test.ts
AssertionError: test:mutate nombra "test/*.test.ts", que no existe — node --test lo ignora sin avisar
```

Pasar la suite de mutación a un glob (correr todos los tests) es trabajo legítimo y previsible
—de hecho es lo contrario del fallo que el candado persigue— y lo bloquea. El chequeo hermano de
`mutate` **sí** salta los globs (`if (patron.includes("*")) continue`); este no. El mensaje además
afirma algo que no es cierto para un glob.

### 5 · MENOR — el mismo candado deja pasar en verde un objetivo de mutación con glob roto

```
$ # stryker.config.json mutate = [..., "src/pluginz/dsl/**/*.ts", ...]   ← directorio inexistente
$ node --import tsx --test test/mutation-config.test.ts
(sin fallos)
```

Es el fallo que originó la tarea —un objetivo midiendo el vacío EN VERDE— en su forma con comodín,
que es la que tienen 1 de los 3 objetivos actuales. Cubrirlo es resolver el glob y exigir ≥1
fichero, no saltárselo.

### 6 · MENOR — `implementacion.md` §8 y §11 dicen que `thresholds.low` sigue en 60; el diff lo sube a 72

`stryker.config.json` en la rama tiene `"low": 72, "break": 72`. El informe declara explícitamente
"no toqué `low`" y lo deja como pendiente. Es deriva de documentación (probablemente de la limpieza
§3.5), pero el informe es el handoff: quien lo lea creerá que hay una inconsistencia que ya no
existe. Los requisitos autorizaban solo `break`.

### 7 · MENOR (observación) — varios asserts nuevos defienden puertas que el motor ya no puede tocar

Los `throw` de `formatDToWorld` por `cell`/`footprint`/`kind`/`name` y los casos de `h` infinito
son inalcanzables desde el motor: `validate_scene_response` ya fail-loud sobre esos mismos casos y
descarta `h` fuera de `0 < h ≤ 20` **antes**. Siguen valiendo como red para fixtures y saves, así
que no son tests falsos; pero el consumidor que citan en `implementacion.md` ("pre-flight de
narrative-mcp") no es quien los ejerce — el pre-flight es el zod `FormatDSceneSchema`, no esta
función.

---

## Guiones nuevos (y su prueba en negativo)

Tres guiones en `qa/guiones/` + el arranque de partida compartido en `qa/lib/sesion.mjs` (el runner
solo recorre `guiones/`, así que `lib/` no se ejecuta como guion). `qa/README.md` actualizado.

| Guion | Qué fija | Roto a mano → ROJO |
|---|---|---|
| `05-terreno-desde-ground` | `ground` → grid → colisión, en el tile de entrada **y en un tile generado en vivo al explorar** | `rasterizeGroundToGrid` a no-op → el vecino no llega siquiera (el bridge lo rechaza) y el guion falla en «el tile vecino llega» |
| `06-solidos-de-la-leyenda` | `solid_chars` por defecto y `{solid:false}`, comprobados **andando** | (a) `DEFAULT_SOLID_CHARS = ["W"]` → `✘ el agua es sólida por defecto — ["W"]`; (b) ignorar `entry.solid === false` → `✘ timeout esperando: la escena con el vado declarado carga` |
| `07-npc-clave-del-skin` | Los tres campos del NPC sobreviven a `formatDToWorld`; partida y batch derivan la misma clave | (a) el batch deja de mandar `style_role` → `✘ partida y batch piden EXACTAMENTE los mismos personajes vestidos` + `✘ la clave de caché coincide byte a byte`; (b) `formatDToWorld` deja de propagar `role`/`style_ref` → `✘ los NPCs enriquecidos llegan al cliente` |

Todas las roturas se revirtieron y el árbol quedó **idéntico byte a byte** a la línea base
(`diff` del `git diff HEAD` antes/después, sin diferencias; `grep -rn "ROTURA QA"` a cero).

Detalles que hacen que estos guiones valgan algo y no son obvios:

- **05 entra por una partida, no por una fixture.** Con fixtures el grid viene escrito a mano y el
  guion pasaría con la rasterización muerta. Y aun con partida, el tile de entrada puede venir del
  snapshot de pre-generación (`data/games/*/world/tile.json`, `__expanded: true`): la primera
  versión del guion daba **falso verde** con `rasterizeGroundToGrid` anulado. Por eso §6 explora
  hacia el este y espera a **entrar** en el tile nuevo (hasta que el jugador lo pisa, `__nefan.scene`
  sigue siendo el de partida — gotcha).
- **07 se niega a gastar**: si `?ai=` no apunta a `:18765`, el primer `expect` falla y no se pulsa
  «Aplicar estilo» (contra un stack real ese click cuesta ~$3 por mundo del bench).
- **07 espera por el número de skins que anuncia el plan** (`(N personajes × M anims)`), no por
  tiempo de pared.

---

## Workarounds usados durante la prueba

| Workaround | Por qué | Veredicto |
|---|---|---|
| Interceptar la respuesta HTTP de la fixture para declarar `w: {name:"vado", solid:false}` (guion 06 §4) | Ninguna escena del repo declara solidez explícita, y el contrato (`TerrainLegendEntry`) la admite | **No es obstáculo del jugador**: se sustituye el DATO de la escena, no el código, y es una declaración legal que el motor puede emitir. `ai_server` conserva `{name, solid}` en la leyenda (verificado en su normalizador) |
| Interceptar la fixture para declarar `role`/`style_ref`/`description` en un NPC (guion 07 §5) | Ninguna escena del repo los declara | **Es un síntoma, no un apaño**: he tenido que fabricarlos porque el motor no puede entregarlos (Hallazgo 1). Queda reportado |
| Reiniciar el bridge a mano para la prueba en negativo | El guion 05 §6 necesita el motor falso; el bridge del preset 5 arranca con `NEFAN_AI_SERVER=http://127.0.0.1:18765` | Sin esa variable el vecino nunca llega y el rojo es por otra causa. Lo dejo escrito para que nadie repita el error |
| Ciclar B hasta «sin overlay» para la crítica visual | `canvas-renderer.ts:451` arranca con `debugView = "collision"` — el overlay de colisiones tapa el arte en toda captura cruda | Default de desarrollo preexistente, fuera del alcance de esta tanda. No es hallazgo, pero explica por qué las capturas de los guiones se ven cubiertas de leyendas rojas |
| Sondas de color temporales en `TERRAIN_CHAR_COLOR` (magenta/amarillo) para diagnosticar el Hallazgo 2 | Distinguir «no se pinta» de «se pinta y algo lo tapa» | Diagnóstico, revertido; no toqué nada para hacer pasar una prueba |

---

## Pasada adversarial

| Estado | Resultado |
|---|---|
| **Escena sin `ground`** | `robledo_village` (Format D con grid explícito, sin `ground`) carga y se juega: guion 06 en verde. `formatDToWorld` emite `ground: undefined` y `solid_chars:["W","w"]` |
| **Leyenda ausente / vacía / no-objeto** | `resolveTerrainLegend(undefined | {} | "texto")` → `{legend:{}, solidChars:["W","w"]}`. En la partida real el tile llega con `legend:{g,W}` (sin entrada para `w`) y aun así el agua bloquea: 18/18 celdas |
| **Leyenda con basura** | `{g:42, w:null, x:{name:"vado",solid:false}, W:{solid:false}}` → `{legend:{x:"vado", W:"W"}, solidChars:["w"]}`: los valores no-cadena/no-objeto se descartan, `{solid:false}` quita un default y el nombre por defecto es el propio char |
| **Escena que no es Format D** | Devuelve **la misma referencia**, sin tocar (`formatDToWorld(x) === x`). Idempotencia confirmada: una world scene ya normalizada vuelve a salir por referencia |
| **Tile en el borde / costura** | Explorado en vivo: `tile_1_0` continúa el cruce del bootstrap en la celda 88 con ancho 4, y su camino aparece rasterizado en su grid |
| **Save existente que se resume** | Partida nueva en `cuentos_oscuros` → recarga → «Reanudar». Grid **idéntico** (`{g:14978,_:873,W:73,o:308,w:152}`) y `solid_chars` idénticos antes y después; `ground` pasa de 6 a 7 rasgos (el embarcadero que persistió la revisión). El doble paso por `formatDToWorld` del resume no degrada nada |
| **Escena `image` con el motor falso** | El mundo se ve verde plano: el fake-ai devuelve una placa 1×1 verde (`inpaint_scene_plate: placa 1×1 verde`). **Esperado del bench**, no regresión — en `Maqueta 3D` el greybox se ve completo |

---

## No probado

- **Cliente 3D (Godot).** Fuera de alcance: el campo nunca existió en `godot/` y la poda no lo toca.
- **Gasto real de créditos.** Todo contra el fake-ai-server; no se ha ejercido ni Meshy ni fal.
- **`npm run mutate`.** No lo he vuelto a correr: las métricas son trabajo del coordinador y así se
  me indicó. Lo que sí he comprobado es el candado que las vigila (Hallazgos 4 y 5).
- **Saves anteriores a la poda.** `requisitos.md` retira ese criterio explícitamente.
- **Vistas fps y proscenio con `ground`.** El proscenio va por `stage` y lo cubre el guion 04; fps no
  entra en el alcance de la poda.
- **Causa raíz del Hallazgo 2.** He acotado el síntoma (la capa horneada cubre solo parte del tile)
  con sondas de color; diagnosticar `bakeTerrainLayer`/`tileView` es trabajo de ingeniería.

---

## Veredicto

**Apto con reservas.**

Lo que esta tanda se propuso se sostiene en el juego real: el suelo declarativo sigue llegando por
`ground` → grid → colisión (verificado también sobre un tile generado en vivo, no solo sobre el
snapshot), los sólidos de la leyenda paran al jugador de verdad y las dos vías que derivan la clave
del skin coinciden byte a byte, así que el skin no se paga dos veces. `grep -rn terrain_features`
sigue a cero fuera de `requisitos.md` y de la propia regla. 7/7 guiones en verde, 1070 tests verdes.

Las reservas, por orden de consecuencia:

1. **Hallazgo 1** — los tres campos del NPC que cinco tests nuevos protegen no llegan nunca:
   `ai_server` los borra. El `style_ref` que el contrato le pide al motor se tira, y todos los NPCs
   se visten de plebeyo. Es el bug que el criterio 4 de los requisitos mandaba arreglar si un test
   lo confirmaba.
2. **Hallazgo 2** — el agua de un grid no se pinta: el jugador rebota contra un río invisible.
   Preexistente y demostrado que no lo causa este diff, pero es literalmente lo que el punto 1 del
   encargo mandaba mirar.
3. **Hallazgos 3-5** — los dos candados nuevos son más estrechos de lo que anuncian: el de campos
   retirados no vigila narrative-mcp, labs, tests ni datos (donde el campo estaba), y el de
   configuración de mutación falla con un glob legítimo y pasa con uno roto.

Ninguna de las tres bloquea el mérito del trabajo entregado; las tres piden decisión del usuario
antes de dar la tanda por cerrada.
