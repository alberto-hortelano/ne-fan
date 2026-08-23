# QA — la verificación deja de mentir (#210 + #192)

Validado contra la petición ORIGINAL de `requisitos.md`, sobre `fix/verificacion-que-no-miente`
(HEAD `8ff4a13`), máquina en exclusiva, árbol limpio al empezar y al terminar. Todo lo que sigue
lo he medido yo: ningún número está copiado de `implementacion.md`.

**Verdicto en una línea:** los tres pilares de la tanda son ciertos y los he reproducido —el bug
del viaje, la mentira del guion 05 y el rechazo del merge de lcov—, pero la batería **sigue
teniendo el mismo vicio en otros cuatro guiones**, la garantía de entrega **no cubre el caso
gemelo** que la produjo, y una corrida interrumpida deja la siguiente sin aislamiento en silencio.

---

## 1. Criterios de aceptación

| # | Criterio (literal de `requisitos.md`) | Veredicto | Evidencia mía |
|---|---|---|---|
| 1 | La causa de #210 está IDENTIFICADA con una medida, no con una hipótesis | ✅ cumple | Restauré los 6 ficheros de producción del bridge a `095fc6c` dejando los tests nuevos y corrí `npx tsx --test test/{bridge-map,bridge-tile,game-gen,scene-gen-queue,world-snapshot}.test.ts`: **15 fallos**, entre ellos `✖ abandonar la cola con el viaje esperando difunde error a TODOS los que esperan (1003 ms)` con el mensaje «nadie difundió error al abandonar el viaje: los dos clientes que lo pidieron esperan para siempre». Con el código de HEAD: 46/46. La costura está demostrada, no supuesta |
| 2 | `node qa/run.mjs` en verde en CINCO corridas completas consecutivas, stack desde cero, sin `--keep` | ✅ cumple | **5 corridas completas observadas por mí** (4 alfabéticas + 1 inversa), 12/12 las cinco. Y lo que vale más que los verdes: `md5(nefan-core/data/games/alta_fantasia/world/tile.json)` = `c1ab9cc50f8c…` **idéntico antes y después de las cinco**, `ls saves \| wc -l` = **0** y `qa/.tmp` **vacío** al terminar cada una. Nota: los requisitos dicen «13/13»; la batería tenía **12** guiones (no existe el 04) |
| 3 | La batería es independiente del orden | ✅ cumple | `node qa/run.mjs --orden inverso` → 12/12, con 09 y 08 por delante del 07 y del 05 (el orden adversarial que temía el plan). Y comprobé que el mecanismo es **portante**, no decorativo: quitando `export const aisla = ["mundo"]` del 05 y corriendo `--orden inverso 09 05`, el 05 recibe `source=cache` y **da rojo** |
| 4 | Ningún guion pierde poder de detección | ⚠️ con reserva | Los tres guiones tocados ganan detección (probado en negativo, §3). Pero el 07 conserva un hueco: la comparación byte a byte —su sujeto— vive en un `for` con `continue` que puede iterar **cero** veces sin que nadie lo afirme, y `huerfanos` compara con `claveDePersonaje`, que **excluye `anim`** a propósito. Es pre-existente y no se ha empeorado, pero la afirmación «los asertos nuevos son MÁS fuertes» tiene esa excepción (hallazgo 9) |
| 5 | #192: se separan las dos causas posibles y se dice cuál es, con números | ✅ cumple | Reproducido en 5 pasadas limpias de `npm run coverage`: **58 líneas** voltean HIT↔MISS de **30.650** medidas (0,19 %) en 51 ficheros. Y el dato que decide: `src/store/reducers.ts:18,19` marcan `[1392,1392,0,1392,1392]` y `:27` marca `[1392,0,0,0,0]` — cuerpos de `case "camera_rotated"` y `case "player_healed"`, que **no tienen un solo despachador en el repo** (`grep -rn` sobre todo el árbol devuelve solo las dos líneas `case`). El lcov **inventa** counts. Es ruido de instrumentación, y bidireccional |
| 6 | `npm run crap -- --check` da el mismo veredicto en tres pasadas consecutivas | ✅ cumple | **5 de 5** pasadas: `cobertura 90.3%` · `✔ dentro de los umbrales` · `handle · bridge/state-http-server.ts:151 → 158.4` en las cinco, movimiento **0,0 puntos**. Y `bridge/state-http-server.ts` líneas 444/445/462/463 marcan `1` en las cinco: los dos tests nuevos de `vocabulary.test.ts` mataron el flip que movía el CRAP |
| 7 | No se toca ningún umbral | ✅ cumple | `git diff --stat 095fc6c..HEAD -- quality-thresholds.json crap-score.ts ci.yml package.json stryker.config.json` → **vacío** |
| 8 | `npm run verify` verde y el CI de la PR entero en verde | ✅ cumple | `npm run verify` local: `ℹ tests 1101 · pass 1101 · fail 0`. CI de la PR #226 sobre el sha exacto de HEAD (`8ff4a131…`): `ai-server pass · narrative-mcp pass · nefan-core pass · nefan-html pass` |

### Las tres correcciones al plan, comprobadas una por una

El coordinador pidió escrutinio extra porque una corrección cómoda evita trabajo. Las tres son ciertas:

| Corrección del ingeniero | Veredicto | Cómo lo comprobé |
|---|---|---|
| «La contaminación del snapshot es real pero INERTE (solo cambia `generated_at`)» | ✅ cierta | `grep -rn writeSessionSnapshot` sobre `bridge/` y `src/`: **dos** llamadas, `game-gen.ts:201` (regenera el anillo entero) y `bootstrap-tile.ts:114`. Ninguna después de realizar un place ⇒ un place realizado no puede entrar en el snapshot. Corroborado por el md5 estable de las 5 corridas |
| «El "foco A" del plan era FALSO para los skins» | ✅ cierta | `labs/narrative/fake-ai-server.mjs:626`: `/skin_sprite_sheet` devuelve **`cached: false` siempre**. La única caché de proceso que muerde es `surfaceImages` (`:650`), la del atlas |
| «`list_sessions` NO bloquea el event loop» | ✅ cierta | La rehíce con 202 saves sintéticos (149 KB cada uno, el real es ~290 KB) y un ticker de 5 ms: `list()` ×5 = 85/73/76/73/84 ms · **peor hueco del event loop = 5 ms**, es decir ni un tick perdido. `list()` usa `await fs.readdir` + `await this.read()` en serie: es latencia, no bloqueo. El titular correcto sigue siendo «tarda ~200 ms y crece con cada save», que merece issue |

### El rechazo del merge de lcov: repetí la medida y el ingeniero tiene razón

La justificación del plan («el artefacto solo PIERDE counts; un count >0 nunca es inventado») es
**falsa**, y lo he reproducido sin usar sus números:

```
DA:18 (cuerpo de case "camera_rotated")  →  1392, 1392,    0, 1392, 1392
DA:19 (cuerpo de case "camera_rotated")  →  1392, 1392,    0, 1392, 1392
DA:27 (cuerpo de case "player_healed")   →  1392,    0,    0,    0,    0
```

`camera_rotated` y `player_healed` **no los despacha nadie**: `grep -rn "camera_rotated\|player_healed"`
sobre todo el repo (excluyendo `dist/`) devuelve exactamente las dos líneas `case` de
`src/store/reducers.ts:17` y `:26`. Su cuerpo se ejecuta **cero** veces y el lcov lo marca 1392.
Un merge por **máximo** congelaría esas cuatro líneas como cubiertas para siempre: fabricaría
cobertura sobre ramas muertas, que es justo lo que el candado existe para impedir. **Se rechazó
bien.**

---

## 2. La afirmación más fuerte de la tanda, verificada: el guion 05 aprobaba en falso

Es cierta, y es peor de lo que suena. Rompí la rasterización de terreno **entera**
(`src/scene/scene-expand.ts:107`, el `grid[r][c] = "_"` de `rasterizePath`, neutralizado) y corrí
el mismo guion con los dos arneses, contra el mismo bridge:

**Con el arnés de `main`** (`git checkout 095fc6c -- qa/run.mjs qa/guiones/05-*.mjs qa/lib/sesion.mjs`):

```
▶ 05-terreno-desde-ground
    escena tile_0_0 · chars del grid: {"g":15102,"_":749,...}
    ✔ el camino "camino_ns" está rasterizado en el grid (celda 64,79)
    ✔ el camino "camino_este" está rasterizado en el grid (celda 80,83)
    ✔ la mayoría de las celdas de camino son transitables
    tile nuevo tile_1_0 · 1 rasgos · chars {"g":15840,"_":544}
    ✔ rasterización EN VIVO: el camino "camino_0" del tile nuevo está en su grid (celda 32,76)
    ✔ el grid del tile nuevo tiene celdas de camino
✔ 05-terreno-desde-ground        ← 12 asertos VERDES con la rasterización MUERTA
```

**Con el arnés de la rama** (mismo sabotaje, mismo bridge):

```
    ✘ el camino "camino_ns" está rasterizado en el grid (celda 64,79) — char "g", esperado "_"
    ✘ la mayoría de las celdas de camino son transitables — 1/1 bloquean
    episodio de tile: {"key":"tile_1_0","source":"engine",...}
    ✔ el tile del que habla este bloque lo acaba de GENERAR el motor
    ✘ rasterización EN VIVO: el camino "camino_oe" ... — char "g", esperado "_"
    ✘ el grid del tile nuevo tiene celdas de camino — chars del grid: {"g":16384}
✘ 05-terreno-desde-ground
```

Todo lo que el guion viejo miraba venía horneado en
`nefan-core/data/games/alta_fantasia/world/tile.json` — el anillo 3×3, `tile_1_0` incluido — y el
bridge se lo servía de caché. El aserto que dice «rasterización EN VIVO» **nunca vio rasterizar
nada**. El arreglo (exigir `source === "engine"`) es el correcto y el aserto de `source` queda en
verde en el sabotaje, que es lo que hay que exigirle: atribuye el fallo a la rasterización y no lo
confunde con un HIT.

Y la cadena está cerrada por los dos extremos: el guion afirma sobre lo que **declara** el bridge,
y `test/bridge-tile.test.ts:189` fija esa declaración a la realidad usando el **contador de
llamadas al motor** como testigo (`aiCalls.scene.length` 1 → sigue 1 en la re-difusión). Un bridge
que mintiera sobre el origen daría rojo en unitario.

---

## 3. La regla del workaround: ¿puede algún registro ponerse verde sin que ocurra el comportamiento?

Este era el riesgo declarado del plan y es donde más he apretado. **Está cerrado.**

| Registro | Quién lo escribe (único escritor, `grep`) | ¿Se puede poner verde sin el comportamiento? |
|---|---|---|
| `viaje.pedido` | `travelPanel.onTravel` (`main.ts:2013`) — el handler del click | No |
| `viaje.encolado` | `onNarrativeStatus` (`:2088`), con `status.enqueued` que fija el bridge en `handlePlayerEnteredPlace` | No |
| `viaje.escenaRecibida` | `onNarrativeEvent` (`:2285`), atado por `__format_d.place_id` que fija el **bridge** (`tile.ts:133`), no el motor | No — un prefetch que aterrice a la vez no puede colarse |
| `viaje.spawnAplicado` | `:2098`, **las mismas dos líneas que mueven al jugador** (`playerPos.x = status.spawn.x`) | No: si está escrito, el jugador se movió |
| `tileEpisodios[].source` | `:2108`, desde `status.source` que emite `broadcastScene` en la llamada de producción | No, y su veracidad la canda un unitario con el contador de LLM |
| `estilo().issued.skins` | `StyleApplyController.run()` (`style-apply.ts:333`), incrementado **antes** del `fetch` | No |
| `skins` | `CharacterSpriteManager.debugState()` sobre `this.skins`, que llena `requestSkin` | No |

No hay ningún camino paralelo ni setter expuesto (`grep` de escritores: solo los de la tabla). Lo
comprobé además **en negativo**, con dos sabotajes propios sobre `qa/guiones/14-*` (§5): matando la
rama cacheada del viaje y desalineando el `source` del bridge, los asertos correspondientes caen.

---

## 4. El bug de jugador: qué ve ahora alguien a quien le falla un viaje

### Antes: velo eterno. Ahora: error con salida. Eso está bien.

Ejercido en el flujo real (`./start.sh --preset e2e-sin-creditos`, título → nueva partida →
Comenzar → panel «Salidas»), con el motor de IA **caído** — un estado del sistema que el jugador
puede vivir:

```
+1983ms  vis   | Viajando...          | El motor narrativo está preparando el lugar.
+2164ms  vis   | Generando escena...  | Viajando a Molino del bench...
+2165ms  ERROR | Error al generar el mundo | Error: No se pudo generar el tile (2, 0). fetch failed
ledger: {"placeId":"molino_bench_place","encolado":"queued","escenaRecibida":null,
         "spawnAplicado":null,"error":"Error: No se pudo generar el tile (2, 0). fetch failed"}
botón «Cerrar»: display=flex, visible=true   →  el jugador NO se queda sin salida
salidas ofrecidas tras cerrar: ["→ Molino del bench (road)"]  →  puede reintentar
```

Captura: `/tmp/.../scratchpad/shots/viaje-caida.png` (adjunta en el hilo). El overlay es tinta roja
clara sobre crema, con la escena lavada detrás: **legible a duras penas**, y el panel de errores de
la derecha le enseña al jugador un stack trace de JavaScript
(`at FpsAtlasController.runFor (http://localhost:3000/src/scene/fps-atlas.ts:99:27)`).

### El texto, juzgado como jugador, no como quien depura

- **La mitad buena:** «No se pudo viajar a **Molino del bench**». Nombra la acción y el destino. Bien.
- **La mitad mala:** el motivo. El mensaje nuevo de esta tanda es
  `No se pudo viajar a Molino del bench: generación "place_molino_bench_place" abandonada antes de correr`
  — la segunda mitad es el volcado de la cola, con la clave interna en snake_case. El jugador lee
  el nombre de una variable. Y el que sí capturé en vivo es peor todavía:
  `Error: No se pudo generar el tile (2, 0). fetch failed` — coordenadas de tile y una expresión
  en inglés, sin nombrar siquiera el molino al que quería ir.
- **El título del overlay no es de esta acción:** «Error al generar el mundo» / «Error al generar
  la escena». El jugador pulsó un lugar para ir a él. Ni «viaje» ni «Molino» aparecen en el rótulo
  grande.

Es un salto enorme respecto al velo eterno, y no lo estoy discutiendo. Lo que digo es que la
mitad de máquina debería vivir en el error-log (donde ya está: se hace `errors.push` con el mismo
texto) y no en la cara.

### El acuse siempre difundido: no hay parpadeo ni mensaje doble, pero el rótulo empeora

Medido con un `MutationObserver` puesto **antes** del click, sobre el overlay real:

```
+2343ms  vis | Viajando...         | El motor narrativo está preparando el lugar.
+2344ms  vis | Generando escena... | Viajando a Molino del bench...     ← 1 ms después
+2644ms  oculto
```

El primer texto no llega a ser legible (1 ms, ni un fotograma), así que **no es un parpadeo** y
**no hay mensaje doble**. Pero el rótulo que el jugador lee durante toda la espera pasa de
«Viajando…» a «Generando escena…», que es jerga de motor y ya no casa con su propio detalle
(«Viajando a Molino del bench…»). En el bench la espera son 300 ms; en el preset `play` son
30-60 s de leer eso. Antes de esta tanda, la rama `queued` —la normal— no difundía acuse y el
overlay se quedaba en «Viajando…». Es una regresión pequeña y real de redacción.

---

## 5. Guion nuevo — `qa/guiones/14-viaje-por-su-origen.mjs`

Lo mecánico que encontré y no estaba candado: **el guion 08 y el guion 09 tienen el mismo vicio que
tenía el 05**, y el instrumento para cerrarlo (`tileEpisodios[].source`, `viaje.encolado`) lo acaba
de crear esta misma tanda y no se usó.

- `08:37-40` — la cabecera de sección dice «Hay una salida, **y su destino NO está realizado**» y el
  único aserto es `salidas.length > 0`. Por la rama cacheada de `handlePlayerEnteredPlace` pasan en
  verde **todos** los asertos del guion (llega un tile, es distinto, el jugador cae dentro y en
  suelo libre, la descripción nombra el lugar). Lo único que hoy lo impide es que el motor falso
  responde 422 a `realize_place`: una propiedad del banco de pruebas, no una afirmación.
- `09:1-9, 103-114` — la cabecera declara el sujeto: «Ese camino NO genera nada — entra por la rama
  de escena CACHEADA». `comprobarLedger` solo mira `escenaRecibida && spawnAplicado && !error`, que
  se rellenan **igual** por las dos ramas. Una vuelta que se regenerase de cero (espera larga y
  créditos en un stack real) pasaría en verde.

El guion 14 afirma la **rama**, no el destino:

```
▶ 14-viaje-por-su-origen
    ida → tile_2_0 · viaje={...,"encolado":"queued",...}
    ✔ la ida pasa por la COLA del bridge (el lugar no estaba realizado)
    episodio de la ida: {"key":"tile_2_0","source":"engine",...}
    ✔ el tile del destino lo acaba de GENERAR el motor
    episodio del origen ANTES de volver: {"key":"tile_0_0","source":"snapshot",...}
    vuelta → tile_0_0 · viaje={...,"encolado":null,...}
    ✔ la vuelta NO pasa por la cola: el bridge re-difunde la escena que ya tenía
    episodio del origen DESPUÉS de volver: {"key":"tile_0_0","source":"cache",...}
    ✔ y el bridge declara esa escena como CACHÉ, no como generación nueva
✔ 14-viaje-por-su-origen
```

**Probado en negativo, dos veces** (sabotajes revertidos, `grep SABOTAJE` a cero):

| Sabotaje | Resultado |
|---|---|
| Matar la rama cacheada de `handlePlayerEnteredPlace` (`if (false && cachedSceneId && …)`) | ✘ `volver a «Taberna del bench»: ledger={...,"encolado":"queued","escenaRecibida":null,...}` — rojo nombrando el paso muerto |
| El bridge miente sobre el origen (`source: "engine"` → `"cache"` en `tile.ts`) | ✘ `el tile del destino lo acaba de GENERAR el motor — source=cache` |

Integración: `node qa/run.mjs --orden inverso` con el 14 dentro → **13/13**, `md5` del snapshot
intacto, `saves` a 0, `qa/.tmp` vacío. Y pasa la regla nueva `qa-guiones-sin-espera-por-reloj`
(`architecture.test.ts`: 31 pass, 0 fail): cero sleeps.

**Lo ideal es que estos dos asertos vivan dentro del 08 y del 09 y que el 14 desaparezca.** Está
escrito así en su cabecera.

---

## 6. Hallazgos

### Bloqueantes

Ninguno.

### Importantes

**H1 · Una corrida interrumpida deja el stack arriba, y la siguiente pierde TODO el aislamiento en silencio.**
`qa/run.mjs` no registra handler de `SIGINT`: `rmSync(TMP)` y `process.kill(-stack.pid)` solo corren
al final feliz. Y `ensureStack` devuelve `null` si los tres puertos ya están vivos, con lo que el
bucle salta el `if (stack)` que ejecuta **todos** los `aisla`.

*Reproducción desde el arranque:* `node qa/run.mjs` → Ctrl+C a los 45 s → `ls qa/.tmp` deja
`2026-08-23T00-56-17-827Z` (**1,8 MB**) y los puertos 3000/9877/18765 siguen arriba →
`node qa/run.mjs 05` →

```
· OJO: stack ajeno — corre contra SU disco, no contra qa/.tmp
    episodio de tile: {"key":"tile_1_0","source":"cache",...}
    ✘ el tile del que habla este bloque lo acaba de GENERAR el motor — source=cache
0/1 guiones en verde
```

*Qué esperaba quien la corre:* un veredicto sobre el juego. *Qué recibe:* una roja causada por una
precondición perdida, con un aviso que además dice «stack **ajeno**» cuando el stack es el huérfano
del propio runner. Nada limpia los `qa/.tmp/<runid>` viejos: `prepararDisco()` solo borra el suyo.
Es la misma clase de problema que #210 —una batería cuyo rojo no significa lo que dice— en una
forma nueva que introduce esta tanda.

**H2 · La «garantía de entrega» garantiza que el job CORRIÓ, no que entregó: el velo eterno sigue vivo en la rama gemela.**
`runPlaceTravel` (`bridge/handlers/scene.ts`) tiene dos `return` tempranos **dentro del `try`** que
resuelven `{ok:true}` sin difundir escena, ni spawn, ni error:

```ts
const place = ctx.narrative.worldMap.get(placeId);
if (!place) return;                                                       // ← mudo
try {
  // Pudo realizarse mientras esperaba en la cola.
  if (place.realized_scene_id && ctx.narrative.scenes_loaded[place.realized_scene_id]) return;   // ← mudo
```

El caller que se colgó de la `delivery` recibe `ok:true`, nadie difunde nada y el jugador se queda
con el velo puesto **para siempre**: la firma exacta de #210, en la misma función que se acaba de
arreglar. Lo mismo en `runTileGeneration`: la rama `already` solo difunde `if (opts.spawnAt)`, así
que un `request_tile` cuyo tile se generó mientras esperaba en cola vuelve mudo y la key se queda
en `frontier.requested`.

*Reproducción del síntoma:* sabotaje N1 del §5 — el guion 14 se colgó los 240 s con
`escenaRecibida:null, error:null`, es decir sin una sola pista, exactamente como la roja original.
**No he demostrado un disparador natural** (el disparador sería que el place se realice mientras el
viaje espera en cola: plausible con el motor narrativo real escribiendo en paralelo, imposible de
provocar con el motor falso). El hueco es estructural y está a tres líneas del arreglo.

**H3 · Los guiones 08 y 09 conservan el vicio del 05, con el instrumento ya disponible.**
Detallado en §5. Gravedad importante porque el 08 y el 09 son los guiones del **viaje**, que es
justo el sujeto del bug de jugador de esta tanda: hoy no pueden distinguir el camino caro del
barato, que es lo que el jugador paga.

**H4 · Guion 12: el aserto central pulsa teclas contra un cliente sordo.**
`qa/guiones/12-una-sola-vista-sin-eleccion.mjs:187-198` pulsa `V O P T C Tab F1 F2` y afirma
«ninguna tecla suelta cambia de vista». La batería entra siempre con `?input=scripted`
(`qa/run.mjs:48`) y `ScriptedInputProvider` **no instala un solo listener DOM** —lo dice su propia
cabecera, `input/scripted-input-provider.ts:1-5`—; `KeyboardInputProvider` ni se instancia
(`main.ts:435`). Los únicos `keydown` globales vivos son los de `dev-tools-input.ts` (solo `g` y
`b`), `history-browser.ts` y `dialogue-panel.ts`. **El aserto no puede ser falso ni con la tecla de
cambio de vista resucitada.** Es el vicio del 05 en su forma más pura: verde sin comprobar nada.

### Menores

**H5 · El motivo del error es un tecnicismo, y el título del overlay no es el de la acción.**
Ver §4. `generación "place_molino_bench_place" abandonada antes de correr` y
`Error: No se pudo generar el tile (2, 0). fetch failed` van a la cara del jugador; el rótulo
grande dice «Error al generar el mundo» cuando el jugador pulsó «Molino del bench». La mitad de
máquina ya se duplica en el error-log, que es su sitio.

**H6 · El acuse siempre difundido degrada el rótulo de la espera** de «Viajando…» a «Generando
escena…» a 1 ms del click. Sin parpadeo y sin mensaje doble (medido), pero es el texto que el
jugador lee durante los 30-60 s de una espera real.

**H7 · Un error por caller, difundido a todos ⇒ el mismo jugador lo ve N veces.**
`test/bridge-map.test.ts` exige `errores.length === 2` («uno por caller»), pero `broadcastNarrative`
va a **todos** los suscriptores y `ErrorLog.push` (`nefan-html/src/ui/error-log.ts:41`) **no
deduplica**. Un jugador que pulse dos veces la salida verá el mismo error dos veces en el panel.

**H8 · `regenerarMundo` no reconoce el estado terminal que esta tanda añadió.**
`qa/lib/sesion.mjs:118-129` para cuando la línea casa `/generado:/` o `/falló|error/i`, y luego
afirma `!/Fallos parciales|falló/i`. El mensaje nuevo de `game-gen.ts:93`,
`La pre-generación de "X" no llegó a correr: generación "gamegen:X" abandonada antes de correr`,
**no casa ninguno de los dos** (comprobado ejecutando los regex): la espera agota sus 240 s y 07,
08, 09 y 14 reportan un timeout genérico — justo la clase de mensaje que esta tanda venía a
eliminar. Un `res.error` que sí contenga «error» sería peor: la espera pararía y el aserto «sin
fallos parciales» daría **verde con el mundo sin generar**.

**H9 · Guion 07: la comparación byte a byte —su sujeto— puede no ejecutarse nunca.**
`07:174-182` recorre `partida` y hace `continue` si no encuentra gemela por `(anim, prompt)`; nadie
afirma que hubo al menos una. Y el aserto que sí corre usa `claveDePersonaje`, que **excluye `anim`
a propósito** (`07:49`). Una desalineación de `anim` entre las dos vías deja `huerfanos` vacío y el
bucle a cero iteraciones: verde con el doble pago vivo. La prueba en negativo del ingeniero
desalineó `style_role`, que **sí** entra en la clave. Pre-existente, no empeorado.

**H10 · Guion 07: «lo que pide por el cable son los personajes que apuntó en su libro»
(`07:138-142`) compara TAMAÑOS de conjunto**, no contenido: dos conjuntos de prompts distintos con
el mismo cardinal pasan.

**H11 · Guion 13: `fps().billboards >= npcs.length` no prueba lo que dice.**
`13:96-101` afirma «los personajes son billboards de sprite». El mapa `this.billboards` de
`fps-gl.ts:435` lo comparten `updateEntity` (personajes, `:1210`) y **`updateObject`** (cajas del
decorado, `:1292`), y `fps().billboards` (`:1408`) cuenta las dos cosas. Cualquier escena con
decorado satisface la desigualdad con **cero** billboards de personaje montados — el fallo exacto
que el guion existe para cazar.

**H12 · Guion 12: `every()` sobre un array que está siempre vacío.**
`12:132-139` filtra los `<select>` de la pantalla de estilo excluyendo `#ts-style` y
`#room-selector`. El único `<select>` de esa pantalla es `#ts-style` (`title-screen.ts:418`); el
`<select data-folder>` que el aserto quiere inspeccionar vive en `renderUploadStyle`
(`title-screen.ts:767`), pantalla a la que el guion nunca navega. `[].every(...)` es `true`: la
lista blanca —presentada en la cabecera como la defensa fuerte— no ha mirado jamás una opción.

**H13 · `requisitos.md` pide «13/13» y la batería tenía 12 guiones** (no existe el 04). Con el 14
son trece de verdad, por casualidad. Vale la pena corregir el criterio para que nadie lo lea como
un guion que falta.

---

## 7. Workarounds usados durante la prueba

Todos revertidos; `git status` limpio salvo el guion nuevo, `grep -rn SABOTAJE` a **cero** en
`nefan-core/src`, `nefan-core/bridge`, `nefan-html/src`, `qa` y `labs`.

| Workaround | ¿Afecta al jugador? |
|---|---|
| Neutralizar `rasterizePath` (`scene-expand.ts:107`) | No — sabotaje deliberado para probar el 05 en negativo, revertido desde copia de seguridad |
| Restaurar el arnés de QA de `main` (`git checkout 095fc6c -- qa/…`) para la comparación | No — es la comparación misma; restaurado con `git checkout HEAD -- qa/` |
| Restaurar los 6 ficheros de producción del bridge a `095fc6c` para C1 en negativo | No — revertido con `git checkout HEAD -- nefan-core/bridge/` |
| Quitar `aisla` del 05 para comprobar que es portante | No — revertido desde copia |
| Matar la rama cacheada del viaje y desalinear `source` (negativos del guion 14) | No — revertidos desde copia |
| Matar el `fake-ai-server` para provocar un viaje roto real | No — es un estado del sistema que el jugador vive (servicio caído), no un stub |
| Vaciar el save que dejó la corrida con el arnés viejo, matar el stack huérfano, borrar `qa/.tmp` | No — pero **H1** es exactamente eso convertido en hallazgo: tuve que limpiar a mano lo que el runner no limpia |

**Ninguna afirmación de este informe se apoya en un escenario preparado para pasar.** Las medidas
de #192, las cinco corridas y el flujo del viaje se hicieron por el camino del jugador, desde
`./start.sh`.

---

## 8. No probado

- **Que el fantasma del 12,5 % esté muerto.** Cinco corridas verdes son condición necesaria y no
  suficiente; el propio informe lo dice. Lo demostrado es que dos agujeros con esa firma están
  cerrados y candados, y que el acoplamiento corrida→corrida está cortado de forma verificable
  (md5). **H2** dice por qué eso todavía no basta.
- **Reproducir el `abandonAll` sobre un viaje encolado en el navegador.** Tres intentos con dos y
  tres pestañas reales (una en partida, las otras lanzando «Generar mundo»): la cola drenó el viaje
  antes en los tres. El mecanismo está probado en unitario determinista; el **texto** del error
  nuevo lo juzgo por la cadena de código y por la ruta de pintado, que sí verifiqué en vivo con
  otro error real.
- **Gasto real de créditos.** Todo con el preset `e2e-sin-creditos`; nada de esta tanda toca claves
  de caché, `data/scenes/` ni packs (`git diff --stat` lo confirma).
- **Crítica visual de dirección de arte sobre las capturas de la batería.** No es posible: el preset
  E2E sirve texturas de damero desde el motor falso (`14-viaje-por-su-origen-01-ida-generada.png`
  es un tablero de ajedrez marrón y verde). La única imagen de jugador real que he podido juzgar es
  el overlay de error (§4), y ahí el hallazgo es de contraste y redacción, no de composición.
- **La medida de `list_sessions` con los 202 saves reales**: se vaciaron antes de que yo llegara
  (con autorización). La rehíce con 202 saves sintéticos de 149 KB; el veredicto sobre el event
  loop es el mismo y la latencia escala.
- **Mutación de `bridge/` y del cliente.** `stryker.config.json` no los cubre y no lo he tocado; la
  pasada ad-hoc del ingeniero es un dato de su informe, no un candado. Lo declaro tal cual él lo
  declaró.

---

## 9. Veredicto

**Apto con reservas.**

Los tres pilares se sostienen y los he reproducido de forma independiente: el cuelgue del viaje
tiene causa demostrada en la costura, el guion 05 aprobaba con la rasterización muerta y ahora no,
y el merge de lcov se rechazó con razón. Los ocho criterios de aceptación se cumplen (el 4 con la
reserva de H9). No hay bloqueantes.

Las reservas son cuatro y ninguna obliga a rehacer la tanda:

1. **H1** convierte una interrupción en una batería sin aislamiento y con rojas falsas. Es barato
   (`process.on("SIGINT")` que borre el tmp y mate el stack, y un aviso que no diga «ajeno» cuando
   es propio) y ataca justo el problema que la tanda vino a resolver.
2. **H2** deja vivo el velo eterno en la rama gemela de la que se acaba de arreglar, a tres líneas
   de distancia.
3. **H3/H4** son el vicio del 05 en otros tres guiones. El 14 canda el del 08 y el 09; el del 12
   queda abierto.
4. **H5/H6** son redacción de cara al jugador: baratas y visibles en cada viaje fallido.

Recomiendo cerrar **H1** y **H2** antes de dar por vaciada la cola de issues (las trece tandas que
vienen detrás se van a apoyar en esta batería), plegar los asertos del 14 dentro del 08 y del 09, y
mandar H4 y H9-H12 al backlog como «guiones que aprueban sin comprobar», que es un issue con nombre
propio y ya tiene cuatro casos con línea y fichero.
