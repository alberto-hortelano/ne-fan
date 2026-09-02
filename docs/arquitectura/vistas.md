# La vista del cliente web

Primera persona sobre el mundo continuo de tiles: plan declarativo, greybox
determinista, atlas de superficies y colisión. Consúltalo al tocar renderer,
cámara, colisión o el pipeline de imagen.

> Este documento se llamaba «Las tres vistas del cliente 2D». Había una oblicua
> (suelo cenital + cizalla) y un plató proscenio, y las dos se retiraron en
> agosto de 2026. No queda código, contrato ni dato suyo: lo que sobrevive de
> ellas es el **candado** que impide que sus campos vuelvan por copy-paste
> (`campos-retirados-no-vuelven` en `nefan-core/data/contract/arch-rules.json`).
> Si algo de aquí es verificable mecánicamente, su sitio es ese fichero y no
> esta prosa.

**Hay UNA vista y no es una opción.** No existe `world.view`, ni un enum de
vistas, ni ramas de contenido por vista, ni un registro de renderers: el
cliente construye su renderer eager porque es el único que hay. Un segundo
importador de `three` en el cliente lo corta `three-solo-en-fps-gl` — no por
tamaño de bundle, sino porque cada importador tiende a abrir su propio
`WebGLRenderer` y un segundo contexto WebGL compite por la GPU con el mundo
que el jugador está mirando.

## El plan del tile: `ground` + `volumes` (declarativo, nunca dibujado)

**El motor narrativo NO dibuja nada.** No emite SVG ni imágenes: declara un
plan semántico por tile y un **builder greybox determinista** lo convierte en
geometría.

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
  clasificador. El plan que se pinta y colisiona lo compone
  `src/scene/tile-plan.ts` (`composeTilePlan`) y viaja RESUELTO en la world
  scene (`__plan`): a los `volumes` declarados les suma los que el esquema
  implica (`vegetation_zones` → árboles/matas con su tronco, entities
  estáticas → su primitiva). Nadie más deriva: cliente,
  bridge, batch de estilo y validador LEEN ese plan.
  FILOSOFÍA DE PROMPT (2026-08-16): los prompts del motor narrativo son
  DOCUMENTACIÓN de herramientas y contrato, nunca recetas de uso — sin
  listas de objetos-ejemplo, sin doctrina de diseño, sin "use it when": el
  motor es tan capaz como nosotros y decide qué construir y cómo.

`buildTileGreyboxSpec(plan, tileKey)` (`blueprint/greybox.ts`,
`TILE_GREYBOX_VERSION`) es la base compartida: primitivas en celdas (suelo de
bioma + detalle sembrado + rasgos ground en cuatro capas + volúmenes por
TRAMOS vía `greybox/volume-prims.ts`) y luces fijas.

Los rasgos de `ground` son **calcos**: dentro de una capa son coplanares
exactos, y su prioridad la resuelve el ORDEN DE PINTADO (`groundOrder`, que
fps-spec numera y el renderer traduce a `renderOrder` sin escribir
profundidad), no la altura. Antes se escalonaban 2 mm por prim y el suelo
crecía sin techo: un tile de puerto legal lo subía a 0,219 m y enterraba lo
que se dibuja encima (#185). Hoy el techo es CONSTANTE
(`GROUND_STACK_TOP_M` = 0,105 m) y de él sale la cota de cualquier calco
(`GROUND_OVERLAY_Y_M`), candada contra el peor tile del schema en
`test/ground-overlay.test.ts`.

Qué prims son suelo lo dice la MARCA que les pone su emisor
(`groundLayer`, en `ground-prims.ts`), no su altura, y su cota sale de la
TABLA de capas del builder (`GROUND_LAYERS_CELLS`), de la que se deriva el
techo. Las dos cosas son el mismo candado: mientras se olfateaba por altura
—`cat` + una banda de y— una capa por encima del deck se caía fuera, dejaba de
ser calco (volvía a escribir profundidad ⇒ enterraba el telegraph) y encima no
la medía el test. Añadir una capa hoy es añadirla a la tabla: el techo y la
cota del calco suben solos. Ya no emite cámara ni
`elements`/`occluders`: esos tres los pedía el repintado de la oblicua y se
fueron con él. Sigue siendo DETERMINISTA, que es lo que permite hashear
`canonicalGreyboxJson(spec)` como clave de caché.

## Primera persona (`nefan-html/src/renderer/fps-gl.ts`)

Sobre los MISMOS tiles del mundo continuo (bench de origen en `labs/fps/`).

**Cámara y control.** Mouse look con yaw CONTINUO y pitch (pointer lock sobre
`#fps-canvas`, que crea e inserta el propio `FpsRenderer`; click lo captura),
más los pasos de teclado ←/→ (45° de yaw) y ↑/↓ (15° de pitch). El ojo va a
1,6 m. La mirada vertical NO es adorno: con 70° de FOV el suelo no entraba en
cuadro hasta los 2,29 m y todo el cuerpo a cuerpo ocurre entre 0,9 y 2,5 m —
sin ella se peleaba a ciegas. WASD es relativo al facing y su `forward` es
SIEMPRE horizontal: el pitch mira, no camina.

**Geometría.** `buildFpsTileSpec` (`src/scene/blueprint/fps-spec.ts`) cierra
cutaways, escala celdas→metros, reparte `surface_desc` por rol/cara y aplica
dos post-procesos que NO tocan el builder compartido: `fps-detail.ts` (copas
esféricas por `species`, rocas facetadas `rock_stone`, ventanas `window_glass`
y chimeneas de building, tejado cónico de torre, arco escalonado de gate) y
`scatter.ts` (scatter declarativo `scatter_generators`+`scatter_zones` del
plan: generadores como JSON puro con rangos/vars/lerp — port del run 003 de
`labs/authoring` —, zonas con densidad elem/m², exclusión automática de
huellas/agua/caminos, prims clay `cat: decor` a coste 0, tope 240 instancias
reportado). Los NPCs son billboards y_bot `frontal_8` (dir =
`yaw_npc − yaw(npc→cám)`, como `pickDirection`).

**Lo que el jugador tiene que ver, y por qué está en el MUNDO y no en el HUD.**
Tres cosas que en una vista cenital daba la propia perspectiva:

- **Telegraph del ataque**: un parche de suelo con la calidad real del golpe.
  La distancia y la precisión DECIDEN el daño
  (`calidad = factor_distancia × factor_precision × …`), así que sin verlo el
  combate es a ciegas. Se fija ANTES de `render()`: en WebGL no queda lienzo
  sobre el que garabatear una vez emitido el frame.
  Dibuja DOS cosas, no una (#184): el relleno degradado dice dónde se pega
  mejor y un **contorno rojo** dice hasta dónde llega — los tres límites del
  área, el anillo radial, la banda lateral y el arco del cono de ±60°. Necesita
  dos variables porque la calidad no sirve para dibujar el borde: vale 0 en la
  frontera Y a diez metros. El margen al borde en metros
  (`attackAreaMargin`, `nefan-core/src/combat/attack-area.ts`) sí los
  distingue. Esa es la ÚNICA fórmula del área: el cliente no tiene copia, y
  `test/attack-area.test.ts` la afirma contra `resolveAttack` punto por punto.
  El **destello de impacto** se tiñe con la misma verdad
  (`attackFlashQuality`, core): también la PROYECCIÓN del enemigo al plano del
  ataque es fórmula, no dibujo — escrita a mano en el cliente se saltaba el
  cono frontal y un enemigo a la espalda salía verde pleno.
- **Nombre del NPC y mirilla** (`ui/world-labels.ts`): etiquetas DOM temadas,
  no texto dentro del lienzo.
- **Frontera del mundo**: un muro de niebla sobre el borde del tile activo, y
  su DISIPACIÓN —no un destello— es el aviso de que el vecino ya existe.

Los tres publican su estado en `debugState()` para que se puedan afirmar sin
leer píxeles. El telegraph publica además un **recuento del episodio**
(`telegraphEpisode`): un modo dura décimas de segundo y el reloj que lo
consume es el `delta` del game loop, topado a 0,1 s, así que un observador
externo que muestree una ventana de reloj de pared se salta el destello de
impacto. Se cuenta donde se pinta; el guion `qa/guiones/10-fps-…` lo lee.

## El arte: atlas de superficies

`surfaces.ts` (`src/scene/greybox/`, `SURFACE_LAYOUT_VERSION`) clasifica las
caras en celdas de material + celdas hero; `FpsAtlasController`
(`nefan-html/src/scene/fps-atlas.ts`) pide `/generate_surface_atlas`
(remote-gen), que resuelve POR CELDA contra la **librería de superficies**
(asset-store kind `surface`, hash por descripción+estilo — reutilizable entre
escenas, pinta solo lo que falta con nano-banana-pro/gpt-image-2) y aplica las
texturas. La clave de caché del cliente es el hash de
`canonicalSurfaceLayoutJson(layout)` + estilo + versión, así que el resume hace
cache-hit. Sin `render_mode` imagen todo queda en clay, gratis.

Los volúmenes `building|wall|prop|prism` admiten `surface_desc` opcional:
string = celda hero para las caras del CUERPO (tejado/puerta conservan su
material), u objeto por cara/rol `{n|s|e|w|side|roof|door|caps|top}` = celda
propia por cara con su descripción (imagen distinta por cara;
`SurfaceAssign.faces` asigna por slot de BoxGeometry y el renderer crea
material por slot). `available_assets` muestra al motor la librería
reutilizable (texture/model/sprite/surface, round-robin) — el reuso es
opcional, nunca forzado.

E2E sin créditos: el fake-ai-server sirve `/generate_surface_atlas` con
dameros (bootstrap con cartel per-face + casa hero + scatter).

## Colisión

Siempre en espacio de MUNDO y **nunca desde píxeles**:

- agua ∖ decks del `ground` (`groundCollisionGrid`, point-in-shape por celda
  — también server-side en `bridge/sim-collision.ts`),
- ∪ huellas analíticas de los volúmenes (`volumeCollisionGrid`).

La altura no participa: la huella colisionable es XZ. Render y colisión no
tienen por qué coincidir (un árbol colisiona por el tronco y se renderiza con
la copa).

**PROHIBIDO recortar una imagen generada con siluetas DECLARADAS.** Se probó y
NO funciona: el modelo de imagen recoloca y reorienta lo declarado, la máscara
declarada recorta SUELO con forma de objeto y el objeto real queda cocido en la
placa. No se reintroduce. Si algún día vuelve a hacer falta recortar, los
recortes salen SIEMPRE de segmentar lo que el modelo PINTÓ. El clay es la
excepción por construcción: es render propio, no pintura IA, y sus siluetas son
exactas.

## El cliente no interpreta Format D crudo

Lo que el renderer NUNCA porta es la conversión celdas→metros: el bridge
normaliza con `formatDToWorld` en el wire y el cliente pinta world scene en
metros. Si el cliente se trajera esa conversión (`size.cols`,
`meters_per_cell`) habría dos caminos hasta la misma escena y la segunda copia
se enteraría tarde de cada cambio del primero. Candados
`cliente-no-convierte-celdas-a-metros` (error) y
`solo-el-bridge-normaliza-la-escena` (warn con tope: la única asimetría
admitida es la que el cliente necesita para las fixtures locales).
