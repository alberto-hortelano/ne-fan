# Las tres vistas del cliente 2D

Oblicua (default), proscenio y fps: proyección, plan de tile, composición del plató y atlas de superficies. Consúltalo al tocar renderer, colisión, cámara o el pipeline de imagen.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## Proyección oblicua 2D y plan de tile (ground + volumes → greybox 3D)

El cliente 2D renderiza el mundo por tiles en UNA única proyección
**oblicua**: el suelo queda sin proyectar (vista == mundo, rejilla cuadrada) y
la altura se dibuja con cizalla — `pt(u,v,h) = [u + h·KX, v − h·KY]` con
`OBLIQUE_KX = −0.35`, `OBLIQUE_KY = 1` (`blueprint/projection.ts`). Los
volúmenes muestran su **cara sur iluminada y su cara este en sombra** (sol
FIJO desde el suroeste, look "3/4"/oblicua militar); colisión y baselines
salen de la huella declarada, nunca de los píxeles. (Sustituye a las dos
perspectivas topdown/isometric de antes; los saves viejos con
`world.perspective` lo conservan en el JSON pero nadie lo lee.)

**El motor narrativo NO dibuja nada — todo es DECLARATIVO** (el SVG murió:
ni `map_ground` ni `terrain_svg`; los saves viejos con esos campos los
conservan pero nadie los lee). Cada tile declara un plan semántico y el
**builder greybox determinista** (`nefan-core/src/scene/blueprint/greybox.ts`)
lo convierte en una escena 3D que el cliente renderiza con **three.js**
(bench labs/render E2a: fidelidad 100/100 a coste 0):

- `ground`: rasgos PLANOS del suelo, tipados (`path` polilínea+ancho, `area`
  rect|polygon|ellipse+material, `water` (bloquea), `deck` transitable SOBRE
  el agua). Schema zod en `blueprint/ground.ts`; espejo Python
  `validate_ground` (fixtures `data/contract/fixtures/ground_plan/`).
- `volumes`: todo lo que tiene altura, tipado — `building` (con `roof`,
  `walls`, `doors`, `cutaway:true` para edificios enterables), `wall`,
  `tower`, `gate` (vano transitable, tallado en su muro anfitrión), `tree`,
  `bush`, `rock`, `fountain`, `prop`, `prism` (contorno libre + altura) y
  `custom` (composición 3D LIBRE: piezas box/cylinder/cone/sphere/gable con
  pos/rotX/rotY/rotZ/scale locales, color y `desc` opcional por pieza — la
  vía del motor para cualquier objeto sin catálogo ni preset; el caso
  fundacional es la carreta del playtest 2026-08-16, antes un prop box con
  "skin" de carro). Huella en celdas + altura; `label` en español guía al
  clasificador. Sin volumes explícitos se derivan del esquema
  (`vegetation_zones` → árboles, `structures` → cutaway).
  FILOSOFÍA DE PROMPT (2026-08-16): los prompts del motor narrativo son
  DOCUMENTACIÓN de herramientas y contrato, nunca recetas de uso — sin
  listas de objetos-ejemplo, sin doctrina de diseño, sin "use it when": el
  motor es tan capaz como nosotros y decide qué construir y cómo
  (tile_instructions.md ya podado; stage/scene_instructions pendientes).
- `buildTileGreyboxSpec(plan, tileKey)` → `TileGreyboxSpec`
  (`TILE_GREYBOX_VERSION`): primitivas en celdas (suelo de bioma + detalle
  sembrado + rasgos ground escalonados en y + volúmenes por TRAMOS vía
  `greybox/volume-prims.ts`), luces fijas, cámara `ortho_shear` (view_box
  `-12 -32 140 160`, voladizo norte+oeste) y `elements`/`occluders`
  analíticos (bbox proyectado + baseline + huella por tramo). DETERMINISTA:
  `canonicalGreyboxJson(spec)` hasheado es el `layout_key` de la caché de
  imagen (el PNG WebGL no es byte-determinista) — el resume hace cache-hit.
- Cliente: `tile-greybox-render.ts` (three.js, comparte renderer con el
  stage) — cámara ortográfica cenital + cizalla en la matriz del grupo raíz
  (equivalencia con `pt()` verificada por tests). La base clay es el arte del
  modo "vector" y el plano base del repintado (`blueprint_kind: "tile"`,
  pipeline `tile_greybox1`); cada occluder se renderiza aparte re-encuadrando
  la misma cámara a su bbox (depth-sort + fade de proximidad; copas con
  `CANOPY_OPACITY` horneada).

**Consecuencias en el pipeline** (cliente 2D):
- Colisión = agua∖decks del `ground` (`groundCollisionGrid`, point-in-shape
  por celda — también server-side en `bridge/sim-collision.ts`) ∪ huellas
  analíticas (`volumeCollisionGrid`) — espacio de MUNDO; NUNCA de píxeles.
- La imagen repintada se **enmascara con el alpha del clay** antes de
  instalarse (los voladizos norte/oeste recortan lo del vecino); los tiles se
  pintan por profundidad (`ty·4096 + tx`), así los voladizos pisan a vecinos
  ya pintados.
- El renderer trabaja en **espacio de vista** (`renderer/projection.ts`,
  `VIEW_PROJECTION` único): vista == mundo en el suelo; los prismas
  vectoriales (`view-prism.ts`) desplazan la tapa `(+h·shearX, −h)` — espejo
  exacto de la cizalla. Simulación e input no cambian.
- **PROHIBIDO recortar la imagen pintada con siluetas DECLARADAS** (SVG en su
  día, spec 3D hoy). Se probó y NO funciona — el modelo de imagen recoloca y
  reorienta lo declarado, la máscara declarada recorta SUELO con forma de
  objeto y el objeto real queda cocido en la placa. Jamás va a funcionar; no
  reintroducirlo. Los recortes salen SIEMPRE de segmentar lo que el modelo
  PINTÓ: `/analyze_scene_image` (SAM2 auto-segment + visión + refinado
  `segment_boxes` por caja). Lo declarado solo sirve de PISTA (el clay del
  modo vector es la excepción: es render PROPIO, no pintura IA, y sus
  siluetas son exactas por construcción).
- `expected_elements` del análisis salen de `spec.elements`; los segmentos
  casados toman baseline/colisión de su huella declarada; los no casados
  (añadidos del modelo de imagen) aportan una franja en su línea de suelo.
- El retoque de visión (`blueprint_review`) corrige `{ground, volumes}`
  (arrays COMPLETOS, nunca SVG) y se persiste con `map_plan_update`.

Godot (cliente 3D) no participa: la proyección solo afecta al mundo 2D.

## Vista proscenio (`view: "proscenium"` — plató de cine clásico)

Segunda vista del cliente 2D (la oblicua sigue siendo el default): el mundo es
una cadena de **platós discretos** (escenas por place del world map), no un
plano continuo de tiles. Convención de cámara FIJA: la cámara está al **sur**
mirando al norte — `north` = telón de fondo pintado, `south` = embocadura
(salida hacia cámara; opcional `fourth_wall` que se desvanece por proximidad),
`east`/`west` = laterales. El jugador se mueve libre en XZ dentro de los
`bounds` del plató (clamp vía `CollisionDeps.viewConstraint`); la ÚNICA forma
de viajar es pisar una **zona de salida** → corte a negro (`#scene-fade`) +
`player_entered_place` → lazy realize o re-broadcast cacheado → spawn junto a
la puerta de vuelta (patrón puertas de Resident Evil).

- **Selección**: la vista se elige en el TÍTULO (selector propio; `game.json
  → view` solo aporta el default del mundo), viaja en `start_session.view` y
  queda congelada en `world.view` como el estilo; el selector de estilos
  filtra los compatibles con la vista (`styleViews` de las refs declaradas);
  resume con view desconocida aborta. Ambos `render_mode` valen: "vector"
  (clay three.js local, sin créditos) e "image" (repintado + pelado por
  capas, ver abajo).
- **Formato**: escena Format D clásica por place + bloque `stage` OBLIGATORIO
  (`exits[]` con `edge`/`to_place_id`/`zone` en celdas, `backdrop`,
  `fourth_wall`; zod estricto en `src/scene/stage/schema.ts`). Validación:
  exits⇔links del place en AMBOS sentidos, zonas transitables y alcanzables;
  sin regla de "borde alcanzable". Prompt: `stage_instructions.md` (se antepone
  cuando `world_state.stage_request` está presente, patrón generate_tile).
- **Composición** (`nefan-core/src/scene/stage/`): `composeStageScene(plan,
  key)` (`stage/scene.ts`) — geometría jugable PURA derivada del
  `GreyboxSpec`: `proj`/`view_box` DEL GREYBOX (proyección única en ambos
  modos), `bounds`, `exits` en metros de mundo e `items` (espejo del
  manifest: id/z/huella/altura por volumen). El spec 3D viaja dentro; NO hay
  capas SVG. Colisión de huellas vía `applyPlanCollision`, nunca de píxeles.
  Cero pistas teatrales (exterior: el mundo continúa hasta el borde;
  interior: paredes reales con sus vanos) — el modelo de imagen pintaba
  cortinas/marcos con las pistas de la versión SVG antigua.
- **Cliente**: `rendererRegistry` (`renderer/registry.ts`, patrón
  createSystemRegistry) con `ProsceniumRenderer` — el arte son SIEMPRE
  bitmaps (`StageImages`): en modo vector el clay local por capas
  (`renderGreyboxLayers`: placa sin volúmenes + un recorte RGBA por volumen,
  instalado vía `installClay`), en modo imagen el repintado segmentado (el
  clay queda de placeholder instantáneo mientras corre). Cámara de **raíl**
  en X (zona muerta + lerp), placa warpeada por bandas, sprites y recortes
  intercalados por zStage con escala de profundidad (clamp 0.55).
  Transiciones en `world/stage-transitions.ts`. Los subsistemas oblicua-only
  (tiles, Auto-img, captureSchematic) quedan apagados en proscenio.
- **E2E sin LLM**: fixtures enlazadas `data/scenes/proscenio/posada_*.json`
  (funcionan desde el room-selector SIN sesión — fallback local de
  transiciones) y `labs/narrative/fake-ai-server.mjs` con `stage_request`
  (siembra el world map de la posada vía State API). Bench:
  `window.__nefan.view()/stage()/probeCollide()`.
- **Plano base GREYBOX 3D + segmentación del plató pintado (entrega 2,
  `render_mode: "image"`)**: el plano base del repintado es un **render
  three.js clay** del plan (bench `labs/escenografia/greybox`: la vía
  clay→gpt-image-2 da la máxima fidelidad de layout). `buildGreyboxSpec`
  (`nefan-core/src/scene/stage/greybox.ts`, puro y determinista,
  `STAGE_GREYBOX_VERSION`) emite primitivas + luces sembradas + suelo por
  bandas de TERRENO (`terrain`/`terrain_legend` del plan) + **cámara baja por
  modo** (exterior `GREYBOX_EYE_M`=3.2 m — los platós son anchos y someros y a
  1,7-2,2 el suelo colapsa en un hilo; interior 1,8 m — a 3,2 quedaría A LA
  altura del techo; hfov 75°, `focal_m` = retroceso derivado del ancho,
  view_box de aspect FIJO 2.0 — un recorte ceñido deformaba ×5 con el
  prestretch) expresada en el pinhole de `projection.ts` (`stageToViewAt`): la
  cámara three.js del cliente (`stage-greybox-render.ts`, único módulo GL,
  import dinámico) se DERIVA del spec y equivale EXACTO a `spec.proj` ⇒
  `paintedProj = spec.proj` y `paintedViewBox = spec.view_box` SIEMPRE
  (incluida la degradación sin visión); `calibratedProjection` del trapecio
  queda como telemetría de deriva. El renderer usa `effVb()`/`effProj()` —
  mezclar el view_box del compositor SVG con la placa greybox desalinea.
  **Caché por hash del spec canónico** (floats redondeados 1e-4): el PNG
  WebGL NO es byte-determinista — el cliente manda `layout_key` y el server
  clava `layout: "gb:<hash>"` (pipeline `stage_greybox2`, modelo
  `stage_scene_model: "gpt-image-2"` vía fal DIRECTO, ~210 s/plató,
  cacheado). El `StageImageController` (`nefan-html/src/scene/stage-image.ts`)
  repinta el plató ENTERO y deriva el mundo jugable de LO PINTADO.
  **PROHIBIDO recortar con siluetas declaradas** (SVG o spec — el modelo
  puede recolocar). Pipeline: `/review_stage_image` (kind MCP `stage_review`;
  `expected_elements` salen del MANIFEST del greybox, cajas proyectadas
  exactas) → SAM2 `segment_boxes` → máscara/sprite/contact_px. **Doble
  perspectiva de talla**: `fitSpriteScale` sigue activo (los tamaños pintados
  llevan su propia convergencia). Recortes = imagen ⊙ máscara SAM, con
  z/huella del contacto pintado (mediana + filtro anti-saltos); pelado
  cerca→lejos con `/peel_scene_layer` **backend LaMa**. Colisión =
  `collisionGridFromCutouts` que SUSTITUYE a la declarada
  (`applyStageDerivedCollision`, terrain retirado); sin visión → placa sola
  (alineada por construcción) + colisión declarada. Recortes como drawables a
  su z pintada + fade 0.45. Tecla B: overlay de debug. Chequeo de
  reconstrucción como smoke-test. Benches: `labs/escenografia/greybox`
  (formatos de plano), `labs/stage/` (score de coincidencia); E2E sin
  créditos: `labs/narrative/stage-cutouts-e2e.md` (OJO: la tecla G solo se
  consume con el bridge arriba). Auto al instalar el plató; G = manual; todo
  cacheado (resume gratis).

## Vista fps (`view: "fps"` — primera persona estilo retro-FPS)

Tercera vista del cliente 2D sobre los MISMOS tiles del overworld (bootstrap y escenas = rama tile; bench de origen en `labs/fps/`). Mouse look con yaw CONTINUO (pointer lock sobre `#fps-canvas`, click lo captura; sin pitch) más ←/→ (±45° por pulsación), WASD relativo al facing, colisión y sim idénticos a la oblicua (`CollisionSystem` intacto). `FpsRenderer` (canvas WebGL propio `#fps-canvas`, three con import dinámico — NUNCA el singleton offscreen del greybox) monta cada tile desde `buildFpsTileSpec` (`src/scene/blueprint/fps-spec.ts`: cierra cutaways, escala celdas→metros, reparte `surface_desc` por rol/cara, y aplica dos post-procesos fps-only que NO tocan el builder compartido: `fps-detail.ts` — copas esféricas por `species`, rocas facetadas `rock_stone`, ventanas `window_glass` y chimeneas de building, tejado cónico de torre, arco escalonado de gate — y `scatter.ts` — scatter declarativo `scatter_generators`+`scatter_zones` del plan: generadores como JSON puro con rangos/vars/lerp (port del run 003 de labs/authoring), zonas con densidad elem/m², exclusión automática de huellas/agua/caminos, prims clay `cat: decor` a coste 0, tope 240 instancias reportado); NPCs = billboards y_bot `frontal_8` (dir = `yaw_npc − yaw(npc→cám)`, como pickDirection). El arte es un **atlas de superficies**: `surfaces.ts` (`src/scene/greybox/`) clasifica las caras en celdas de material + celdas hero; `FpsAtlasController` pide `/generate_surface_atlas` (remote-gen) que resuelve POR CELDA contra la **librería de superficies** (asset-store kind `surface`, hash por descripción+estilo — reutilizable entre escenas, pinta solo lo que falta con nano-banana-pro/gpt-image-2) y aplica las texturas; sin render_mode imagen todo queda en clay gratis. Los volúmenes `building|wall|prop|prism` admiten `surface_desc` opcional: string = celda hero para las caras del CUERPO (tejado/puerta conservan su material), u objeto por cara/rol `{n|s|e|w|side|roof|door|caps|top}` = celda propia por cara con su descripción (imagen distinta por cara; `SurfaceAssign.faces` asigna por slot de BoxGeometry y el renderer crea material por slot). `available_assets` muestra al motor la librería reutilizable (texture/model/sprite/surface, round-robin, sin ruido de inpaint) — el reuso es opcional, nunca forzado. E2E sin créditos: fake-ai-server sirve `/generate_surface_atlas` con dameros (bootstrap con cartel per-face + casa hero + scatter).
- **Candidatos futuros** (mismo patrón): PlayerController (prerequisito para touch/gamepad), EnemyAI (`systems.enemy_ai`), transporte narrativo. CollisionSystem y el pipeline de imagen ya son inyectables vía `*Deps`; formalizar registro sólo si aparece una 2ª implementación.
