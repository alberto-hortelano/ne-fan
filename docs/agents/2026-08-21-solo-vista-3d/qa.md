# QA — quedarse solo con la vista 3D (retirar oblicua y proscenio)

Validación contra la petición **literal** del usuario, desde el punto de vista de quien juega.
Rama `main` en `39cd5e2`, stack del **preset 5** (`fake-ai-server`), **0 créditos gastados**.

> «La vista proscenio y la top down dan demasiados problemas, vamos a quedarnos solo con la
> vista 3d. En principio la de three, eliminando tambien la godot pero la godot tiene algunas
> cosas interesantes en cuanto a la generacion procedural que se podrian integrear en la de
> three. **De momento simplemente elimina completamente las dos vistas.**»

> «las imagenes ya generadas se guardan en una carpeta local organizadas de forma similar a
> como lo estan en el juego. La carpeta se git ignora pero las imagenes persisten en local
> para poder reutilizarlas mas adelante y no perderlas»

**Veredicto: apto con reservas.** Lo que se pidió está hecho y se sostiene jugando: las dos
vistas no existen ni en el código ni en ninguna pantalla, la primera persona se juega de
principio a fin, y el archivo de imágenes está completo al byte. Las reservas son tres: el
selector de mundos quedó **peor de lo que estaba** (§H2), el **contrato que lee el motor
narrativo sigue describiendo la proyección oblicua** (§H3), y el cliente que el usuario pidió
conservar «de momento» —Godot— **no puede entrar en un mundo**, aunque eso no lo ha roto esta
tanda (§H4).

---

## 1. Criterios literales

| # | Criterio (de la petición, no del plan) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Se juega **solo** en la vista 3D de three | ✅ cumple | `qa/guiones/12` recorre las 5 pantallas de una partida nueva: **18/19 asertos verdes**; `__nefan` da `scene=tile_0_0`, se camina, se viaja y se pelea. Guion `11` cuenta **1** contexto WebGL |
| 2 | Ningún estado alcanzable desde el título ofrece elegir vista | ✅ cumple | `guion 12` §1-§6: home, selector de mundos, estilo/gráficos, apariencia y HUD — cero textos y cero controles de vista. `#ts-view` no existe; `[data-view]` a cero en el DOM |
| 3 | Ninguna tecla cambia de vista | ✅ cumple | `guion 12` §7: pulsadas V/O/P/T/C/Tab/F1/F2 → misma escena y **1 solo lienzo** antes y después. En el histórico la vista nunca fue una tecla (era paso del título) |
| 4 | Ninguna opción muerta en menús | ✅ cumple | `guion 12` §3-§4: el selector Room ofrece `robledo_tile` y `zorder_test` (ninguna escena de plató); las carpetas de subida de estilo son roles (`surfaces`/`faces`/`characters`), verificado por **lista blanca** |
| 5 | Copia de interfaz sin restos de vistas | ❌ **NO cumple** | `<title>Never Ending Fantasy — 2D</title>` (`nefan-html/index.html:6`). Es el único resto que el jugador lee, y lo lee en todas las pantallas → **H6** |
| 6 | El bloque `stage` no existe en zod, espejo Python, contrato ni prompts | ⚠️ parcial | El bloque `stage` sí está a cero. Pero el contrato de `generate_scene` sigue diciéndole al motor que el engine proyecta en **oblicua**, y `ui_systems.md` se contradice consigo mismo → **H3** |
| 7 | `grep -rn` a cero de los 11 tokens del eje de vistas | ✅ cumple | Fuera del candado `campos-retirados-no-vuelven`, sus tests y prosa histórica declarada, cero apariciones. El candado lo verifica solo: `npx tsx --test test/architecture.test.ts` → **30/30** |
| 8 | `three` solo en `fps-gl.ts` | ✅ cumple | Único `import * as THREE` en `nefan-html/src/renderer/fps-gl.ts:18`; las otras 13 apariciones son la palabra en comentarios en español |
| 9 | Godot **no** se retira («de momento») | ✅ cumple / ⚠️ inservible | `godot/**` intacto; arranca limpio (0 errores), conecta al bridge, renderiza. Pero no logra entrar en un mundo generado → **H4** (no es regresión de esta tanda) |
| 10 | El arte fps ya pagado sigue alcanzable | ✅ cumple | `npm test` verde incluye el golden de dos digests; el `layout_key` no rotó. Medido aparte: la misma escena normaliza a **52.070 B** hoy vs **52.095 B** antes de la operación |
| 11 | Enmienda: archivo local, gitignorado, organizado como en el juego, sin pérdidas | ✅ cumple | §3 de este informe |
| 12 | Guiones de QA en verde sobre el preset 5 | ✅ cumple | `node qa/run.mjs` → **10/11 en verde en 1 m 23 s**. El único rojo es el guion nuevo, y su único aserto rojo es **H6** |

---

## 2. Estados del sistema

Enumerados **antes** de probar, y probados uno a uno.

| Estado | Veredicto | Evidencia |
|---|---|---|
| Arranque con el título abierto | ✅ | `Bridge OK — N partidas guardadas`; botón «Nueva partida» operativo |
| Partida nueva, los **cuatro** mundos | ✅ | `alta_fantasia`, `colonia_aster`, `cuentos_oscuros`, `toledo_1200` → los cuatro dan `tile_0_0`, 64×64 m, grid 128, jugador en el tile |
| Partida **reanudada** (save v5) | ✅ | Botón `[data-action="resume"]`: vuelve con 9 tiles, NPCs y salidas |
| Save **v4** sin migración (schema 4→5) | ⚠️ carga, pero **en silencio** | Restaurados dos saves reales del archivo (`view: fps` y `view: overworld`): **ambos cargan y son jugables**. No abre sesión vacía. Pero no avisa, y reescribe el fichero como v5 conservando el `world.view` muerto → **H11** |
| Sin `ai_server` | ✅ fail-loud | La partida arranca igual (bootstrap por snapshot). El atlas falla **con aviso**: «el atlas fps de tile_0_0 falló — se queda en clay», y el panel marca `ai_server offline (sin gasto/config)` |
| Sin bridge | ✅ fail-loud | El título no ofrece «Nueva partida» y muestra «No se pudo arrancar la partida — bridge did not connect within 5000ms…». Mensaje correcto pero **en inglés** → **H12** |
| Estilo aplicado / sin aplicar | ✅ | El título marca `Estilo Acuarela luminosa: — sin aplicar` y anuncia el coste antes de gastar (guion `07`) |
| Modo gráficos vector / imagen | ✅ | Ambos ejercidos; `render_mode` sigue vivo y alimenta el atlas de superficies fps — no es una opción muerta |
| Overlays (diálogo, error-log, panel de salidas) | ✅ | Ninguno nombra vistas; el panel «Salidas» ofrece lugares (`Molino del bench`) |
| Godot offline | ✅ | `load_room_path robledo_tile` → `room=robledo_tile`, jugador en `[-1.75, 0, 10.25]`, render correcto |
| Godot con bridge | ❌ | No entra en el mundo → **H4** |

---

## 3. La enmienda del archivo — ✅ cumple, sin pérdidas

| Comprobación | Resultado |
|---|---|
| Existe y está ignorada | `.gitignore:49` → `/archivo/`; `git status` limpio |
| Tamaño / ficheros | **572.393.287 B** exactos · **3.106** ficheros · 330 directorios |
| «Organizada de forma similar a como lo están en el juego» | Es **idéntica**, no similar: `archivo/nefan-core/data/styles/anime/overworld/forest.jpg` era esa misma ruta en el repo. Un `mv` de vuelta restaura |
| Imágenes trackeadas borradas en la tanda | **137 borradas → 137 archivadas → 0 faltan** |
| Contenido byte a byte | 10 muestras `git cat-file` vs fichero archivado: **10/10 idénticas** |
| Lo que ningún checkout devolvería | `labs/stage` (567 f), `labs/render` (395 f), `labs/escenografia` (76 f), `_staging/` (28 f), 180 saves, 1.763 frames `isometric_30/` — **todo presente**, cuadra al byte |
| ¿Utilizable? | Sí: de la ruta sola se lee pack, vista y ref id (`…/medievo_crudo/proscenium/stage_harbor.jpg`), que es la clave con la que el juego la pedía |
| Las 5 `cover.jpg` sustituidas | La vieja de cada pack está archivada (1 copia por pack, verificada) |

Único hueco: **no hay `README` ni índice dentro de `archivo/`** — la explicación vive en el comentario del `.gitignore` y en el cuerpo del commit. El plan ya lo dejó en backlog conscientemente. No bloquea.

Lo no archivado del commit son **dos ficheros de código** (`migrate-style-packs.ts` y un fixture de test), recuperables con `git show`. Ninguna imagen, ningún run.

---

## 4. Hallazgos

### 🔴 Bloqueantes

Ninguno atribuible a esta tanda.

### 🟠 Importantes

#### H2 · El selector de mundos perdió su función: cuatro mundos, la misma foto

**Es la queja abierta, y mi veredicto propio es que se queda corta.** No es que tres de cuatro
sean «un rectángulo gris»: es que **las cuatro portadas son literalmente el mismo plano** —
alzado frontal ortográfico de una fachada, puerta centrada y dos ventanas flanqueándola— con
la paleta cambiada. Y `cover.jpg` es, byte a byte, `faces/fachada.jpg` de cada pack
(sha256 idénticos, comprobado en los 5).

| Mundo | Portada actual | Qué comunica |
|---|---|---|
| Miravanda | acuarela de casita con flores | lo único con encanto propio; aun así, una pared |
| La Comarca de Valdesombra | entramado oscuro | pared |
| Toledo, 1200 | entramado gris | pared — y **entramado del norte de Europa para el Toledo de las tres culturas**: no es solo arte flojo, es históricamente falso (falta ladrillo mudéjar, arco de herradura, cal) |
| Colonia Áster | mamparo de acero con neón | pared, misma composición exacta |

Como director de arte, cuatro objeciones:
1. **No hay luz**: son texturas planas pensadas para pegarse a una cara de un volumen. Una
   portada necesita dirección de luz, profundidad y un punto de interés. Estas no tienen ninguno.
2. **No hay escala ni figura**: nada dice si eso es una choza o una catedral. La portada
   anterior (mapa cenital de aldea) al menos enseñaba **un lugar** con caminos, huertos y
   puestos de mercado — se entendía en 200 ms.
3. **No distinguen**: `medievo_crudo` y `sombra_de_cuento` son indistinguibles a 96 px.
4. **El formato las mata**: se pintan a `96×64 px` con `object-fit: cover`
   (`title-screen.ts:1063`) sobre imágenes **cuadradas**, así que se recorta un tercio arriba y
   abajo y queda la banda central — puerta y ventanas, que es justo lo que todas comparten. Al
   lado de tres líneas de descripción, la portada no pesa nada.

El motivo del cambio («enseñaban un mundo que el juego ya no pinta así») es legítimo, pero se
sustituyó una imagen no representativa por otra que **tampoco** representa el juego: en primera
persona se ve una calle con profundidad, cielo y niebla, no un alzado ortográfico. La opción
honesta era una captura de la fps.

**Repro:** `./start.sh --preset 4` (o 2) → título → «Nueva partida». **Esperado:** cuatro
mundos que se distinguen de un vistazo. **Se obtiene:** cuatro veces la misma pared.
**Incumple:** ningún criterio literal — es la calidad que el usuario pidió juzgar.

#### H3 · El contrato que lee el motor narrativo sigue describiendo la vista oblicua

Dos textos vivos que viajan al modelo en cada generación de escena:

- `nefan-core/data/contract/tools/generate_scene.json:105` — *«…with footprint in cells + height;
  **the engine projects them (single oblique projection)** and derives collision from the footprints.»*
- `nefan-core/data/contract/prompts/ui_systems.md:56` — *«Props/buildings: appear as schematic
  boxes until the scene is next regenerated/**repainted**. **In BOTH views** their footprint blocks
  movement.»* — 46 líneas después de que el mismo fichero abra con *«There is ONE view and it is
  not an option»* (`:9`). El documento se contradice a sí mismo, y `repainted` alude al repintado
  retirado.

No lo ve el jugador directamente, pero sí condiciona lo que el motor le genera, y el criterio 6
de los requisitos pedía el eje de vistas fuera **también de los prompts**.

**Repro:** `grep -n "oblique projection" nefan-core/data/contract/tools/generate_scene.json` ·
`sed -n '9p;56p' nefan-core/data/contract/prompts/ui_systems.md`.

#### H4 · Godot arranca, conecta y no puede entrar en un mundo (**no es regresión de esta tanda**)

El usuario pidió conservarlo «de momento». Comprobado con el preset 3 (`xvfb-run`, nunca
`DISPLAY=:0`). Godot **boota limpio** (0 errores en el log), conecta al bridge y renderiza salas
offline. Pero al empezar partida:

```
godot:   LogicBridge: sent start_session 'alta_fantasia'
godot:   WARNING: LogicBridge: disconnected from bridge — combat disabled
bridge:  Bridge: world snapshot HIT para "alta_fantasia" (9 escenas) — bootstrap sin motor
bridge:  Bridge: client disconnected
status:  room="" · narrative_scene="" · rooms_visited=0   (a los 25 s)
```

**Causa medida:** el frame que lleva la escena pesa **69.490 bytes** y el
`WebSocketPeer.new()` de `godot/scripts/autoloads/logic_bridge.gd:27` se queda con el
`inbound_buffer_size` por defecto de Godot, **65.535 bytes**. El socket se cierra a mitad.

**No lo ha causado esta tanda**, y lo verifiqué en vez de suponerlo: la **misma** escena
normalizada por `formatDToWorld` pesa **52.070 B** en `main` y **52.095 B** en `38c2aa9`
(pre-operación) — la retirada dejó el payload **25 bytes más pequeño**. Con el bridge
pre-operación en `:9877`, Godot tampoco entra (falla antes, por otra vía). El protocolo está
bien: `start_session` solo exige `type`/`requestId`/`gameId`, que es exactamente lo que manda
`logic_bridge.gd:161-175`; el campo `view` que murió era opcional y Godot nunca lo mandó.

**Segundo desajuste, también preexistente:** el espejo GD de saves está clavado en
`const SCHEMA_VERSION := 3` (`godot/scripts/autoloads/narrative_state.gd:14`) mientras los saves
en disco son v5, sobre el **mismo directorio**. `list_saved_sessions()` no valida versión, así
que el título de Godot **ofrece «Continuar» en partidas que su ruta offline no puede cargar** y
degrada a partida nueva.

**Repro:** `./start.sh --preset 3` → `echo '{"cmd":"load_game","game_id":"alta_fantasia","skip_editor":true}' | nc -q 3 localhost 9876`
→ esperar 20 s → `echo '{"cmd":"status"}' | nc -q 2 localhost 9876` devuelve `room:""`.
**Esperado:** el jugador aparece en el tile. **Incumple:** el «de momento» de la petición, en la
práctica aunque no en el diff.

#### H5 · El preset 5 nunca enseña las portadas, y por eso nadie vio venir H2

En el preset 5 las cuatro `cover.jpg` **no cargan**: el cliente las pide al asset-store, pero
`?ai=` reapunta esa URL al `fake-ai-server`, que no tiene la ruta.

```
FAILED http://127.0.0.1:18765/styles/acuarela_luminosa/cover.jpg net::ERR_BLOCKED_BY_ORB
→ 404 {"detail":"fake-ai-server: ruta desconocida GET /styles/…/cover.jpg"}
```

Las cuatro tarjetas salen con el hueco vacío (`naturalWidth: 0`). Es **preexistente** (la ruta
nunca existió en el fake), pero es la razón estructural de que un cambio de portada pueda
llegar a `main` sin que ningún guion ni bench lo mire: el único preset de coste cero es ciego a
las portadas.

**Repro:** preset 5 → «Nueva partida» → las cuatro tarjetas sin imagen (`shots/B-mundos.png`).

### 🟡 Menores

| # | Hallazgo | Ruta exacta | Repro / nota |
|---|---|---|---|
| **H6** | La pestaña del navegador anuncia una vista que el juego no tiene: `Never Ending Fantasy — 2D` | `nefan-html/index.html:6` | Abrir el juego y mirar la pestaña. **Es el único aserto rojo del guion 12**; con quitar `— 2D` se pone verde |
| **H7** | El renderer fps tiene que **olfatear por valor literal** los colores que le inyecta el 2D muerto | `nefan-html/src/renderer/fps-gl.ts:1320` (`e.color !== "#666" && e.color !== "#aa8"`, comentado en `:1316-1319`) ← `main.ts:927`, `main.ts:2198` | Acoplamiento por cadena mágica heredado de la oblicua: `main.ts` sigue rellenando los defaults del 2D cenital y `fps-gl` los descarta a mano. Afecta al color de los props |
| **H8** | Símbolos muertos del eje de ángulos de las dos vistas | `nefan-html/src/renderer/sprite-renderer.ts:21` (`ANGLE_PITCH_DEG` con `isometric_30/45/frontal`) y `:29` (`spritePitchCos`) | Cero lectores en todo el repo; sus consumidores eran `canvas-renderer.ts` y `proscenium-renderer.ts`, ya borrados |
| **H9** | Fixture viva cuyo nombre y descripción mienten | `nefan-core/data/contract/fixtures/ground_plan/valid/plato_calle.json:2` — *«plan de suelo de un PLATÓ proscenio 24×18 — el mismo schema sirve a ambas vistas»* | La cargan por glob `test/contract-fixtures.test.ts:51` y `ai_server/tests/test_contract_fixtures.py:64`, y su `description` se imprime en el mensaje de fallo |
| **H10** | `undefined` a la vista en un panel declarado «siempre visible» | `nefan-html/src/ui/dev-status-panel.ts:1,159` → pinta `superficies undefined` | Visible en toda partida del preset 5 (`st.config.surface_model` ausente). Es panel de dev, pero el literal `undefined` es descuido |
| **H11** | Un save v4 se reescribe como v5 **en silencio**, conservando el campo muerto | `nefan-core/src/narrative/narrative-state.ts:257` (la guardia solo rechaza hacia arriba) y `:293` (`dirty = …`) | Restaurar un save de `archivo/saves/` (lo que el `.gitignore` invita a hacer con «un `mv` de vuelta») → carga bien, y el fichero pasa a `schema_version: 5` **con `world.view: "fps"` dentro**. Hoy es inocuo porque 4→5 solo quitó campos; el día que un bump sea aditivo, esta misma rama producirá un save corrupto sin decir nada |
| **H12** | Mensaje de error al jugador en inglés, con jerga de proceso | «bridge did not connect within 5000ms — is nefan-core running?» | Parar el bridge y abrir el juego. La UI está en español; un jugador no sabe qué es «nefan-core» |
| **H13** | La documentación de proceso sigue mandando probar las dos vistas muertas | `.claude/agents/qa.md:19` y `.claude/skills/final-check/SKILL.md:16`: *«…vista oblicua / proscenio / fps…»* | Lo he sufrido en esta misma sesión: mi encargo enumeraba estados que ya no existen |
| **H14** | La portada del repo describe **el cliente equivocado como canónico** | `README.md:7` — *«The canonical client is Godot 4.6 (3D). A lightweight HTML/Canvas (2D top-down) client…»*; `:70` («2D top-down client (Canvas)»); `:73` lista `labs/{stage,render,escenografia}`, que ya no existen; `nefan-html/package.json:4` | Tras esta tanda el cliente que se juega es justo el que el README llama «lightweight», y ya no es ni Canvas ni top-down. Es la primera línea que lee alguien que llega al repo |
| **H15** | «Continuar partida» ya solo lista basura de bench | 180 saves reales → `archivo/saves/`; `saves/` quedó con **49** sesiones de guiones, casi todas «1 entidades» | Consecuencia aceptada del archivado y de correr los guiones, pero el jugador abre el título y ve 49 partidas idénticas sin nombre |

---

## 5. Lo que está bien (para saber qué está cubierto, no solo qué falla)

- **La retirada del cliente es limpia de verdad.** 19 asertos del guion nuevo sobre 5 pantallas
  reales: ni un texto, ni un botón, ni un desplegable, ni una tecla ofrecen vista. El `<select>`
  de fixtures no tiene escenas de plató. El HUD no tiene chip de vista.
- **Un solo contexto WebGL** y un solo lienzo en la pestaña, contado en vivo.
- **Los diez guiones previos siguen verdes** tras catorce PRs: colisión por huella, terreno
  declarativo, sólidos de la leyenda, clave de caché de skins, viaje de ida y vuelta, telegraph
  y etiquetas de la fps.
- **El candado funciona y me pilló a mí.** Mi primera versión del guion nombraba los dos
  identificadores ingleses de las vistas y `campos-retirados-no-vuelven` puso `npm run verify`
  en rojo con 5 violaciones, señalando línea por línea. Reescrito con lista blanca: 30/30.
- **El manifest de estilo es fail-loud y con motivo útil** (probado con packs mutilados):
  sin lámina → *«el pack declara 0 refs en surfaces/ y debe declarar EXACTAMENTE 1»*; también
  rechaza dos láminas, cero caras y cero personajes.
- **Degradaciones anunciadas**: sin `ai_server` el atlas avisa y se queda en clay; sin bridge el
  título no deja empezar y dice por qué.
- **Adversarial**: tres clicks de viaje encadenados sin esperar acaban en **un** tile coherente
  (`tile_2_0`), con el jugador dentro y las salidas actualizadas. Recargar a media generación
  devuelve el título sano y la sesión interrumpida se reanuda con la escena completa.
- **El arte fps pagado sigue alcanzable**: el `layout_key` no rotó y el golden lo vigila.
- **El archivo cumple la enmienda al byte** (§3).

---

## 6. Workarounds usados

**Ninguno para poder observar la funcionalidad.** No hizo falta ocultar un overlay, forzar un
estado ni saltarse una pantalla: todo se ejerció por el camino del jugador (título → mundo →
estilo → apariencia → Comenzar).

Sí se usaron tres afordancias **del propio proyecto**, documentadas y no correctivas:

| Afordancia | Por qué no afecta al jugador |
|---|---|
| `?input=scripted` | Proveedor de input de bench registrado en el juego; sustituye la mano, no el camino |
| `?raf=timer` | En headless la pestaña no está «visible» y el navegador pausa el `rAF`. Mantiene vivo el game loop; no cambia la lógica |
| `?ai=` al `fake-ai-server` | Es lo que define el preset 5. **Efecto colateral que sí es un hallazgo**: reapunta también la URL del asset-store y por eso las portadas no cargan → **H5** |

Datos de prueba creados y **borrados** al terminar: dos saves v4 restaurados del archivo
(`saves/QA-V4-PRUEBA`, `saves/QA-V4-OVERWORLD`) y una inyección temporal en `index.html` para el
negativo del guion (revertida; `git diff` limpio). No se ha tocado una sola línea de producción.

---

## 7. No probado

| Qué | Por qué |
|---|---|
| **El aspecto real de la primera persona con texturas IA** | El preset 5 pinta el atlas con damero de relleno. Verlo de verdad **gasta créditos**; no se ha gastado. La crítica visual de §H2 se limita a lo que sí es juzgable: portadas (ficheros reales), composición del HUD y legibilidad |
| **Las portadas renderizadas en vivo** | El preset 5 no sirve el asset-store (H5). Se ha juzgado el fichero real y el recorte exacto `96×64 object-fit:cover` reproducido offline |
| **Gasto real de créditos** | Cero llamadas a APIs de pago en toda la sesión |
| **Aplicar estilo a un mundo** | Gasta créditos |
| **Godot dentro de un mundo generado** | Bloqueado por H4 |
| **`npm run mutate`** | ~10 min saturando CPU; el encargo lo excluía explícitamente |

---

## 8. Guion entregado

`qa/guiones/12-una-sola-vista-sin-eleccion.mjs` — 19 asertos sobre las 5 pantallas de una
partida nueva más el panel «Salidas» y el selector de fixtures. Cubre el criterio central de la
petición, que ningún guion previo tocaba: el `11` comprueba la cara técnica (un contexto WebGL),
este comprueba la que el jugador toca (que no se le ofrece ni se le nombra una vista muerta).

- **Probado en negativo**: inyectado un `<button>Cambiar de vista: proscenio</button>` en
  `index.html` → **10 asertos en rojo** en las 5 pantallas. Revertido.
- **Estado hoy: 18/19**. El rojo es **H6** (`<title> … — 2D`) y se pone verde en cuanto se
  quiten esas tres letras. Se entrega rojo a propósito: un guion verde que calla un defecto
  conocido vale menos que uno que lo señala cada vez que alguien corre la suite.
- No nombra los identificadores ingleses de las vistas: `qa/**` es root de
  `campos-retirados-no-vuelven` y hacerlo pone `npm run verify` en rojo. De que no vuelvan al
  código se ocupa ese candado; este guion mira la pantalla, que es lo que el candado no ve.

---

## 9. Tiempos reales

| Comando | Reloj |
|---|---|
| `node qa/run.mjs` (11 guiones, Chrome real) | **1 m 23 s** |
| `node qa/run.mjs 12 --url …` (sobre stack vivo) | **3 s** |
| `npm run verify` | **7 s** |
| `npx tsx --test test/architecture.test.ts` | **0,8 s** |
| Preset 3 + Godot headless hasta `:9876` | **~45 s** |
| Sonda de los 4 mundos + reanudar (4 sesiones nuevas) | **3 m 42 s** |
| Pasada adversarial (viaje triple + recarga) | **8 s** |

**Créditos gastados: 0.**
