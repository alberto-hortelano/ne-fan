# Estilos — guía de creación

Un **estilo** es el pack de imágenes de referencia que fija la dirección de arte
de TODA la generación de imagen del cliente 2D: el repintado de cada tile del
mundo y el skin de cada personaje. El jugador lo elige en la pantalla de título
(junto al mundo) y queda **congelado en el save**.

Esta carpeta contiene los packs shipped (`acuarela_luminosa`, `medievo_crudo`,
`sombra_de_cuento`), los subidos por jugadores (`user_*`) y la plantilla
documental [`_plantilla/`](_plantilla/) con un SVG esquemático por categoría
que muestra la composición que debe tener cada referencia.

Fuente de verdad del formato y las categorías:
`nefan-core/src/games/style-categories.ts` (re-exportado por `games/loader.ts`).

## La regla de oro: cada referencia es una ZONA, no un sujeto

El mundo es abierto y continuo: el modelo de imagen repinta tiles que casi
siempre contienen VARIOS elementos y bordes entre zonas (el final del pueblo,
el borde del bosque). Los modelos de imagen copian con fuerza la composición
de la referencia, así que:

- **Escena completa, nunca un sujeto aislado.** Una referencia que sea "una
  fortaleza centrada sobre fondo vacío" condiciona a generar objetos sueltos.
  Cada imagen de entorno debe ser un trozo de mundo lleno: varios elementos,
  suelo variado, y una **transición visible a la zona vecina** (pueblo→campos,
  bosque→pradera, desierto→estepa).
- **Los materiales se copian de la referencia.** Si la única muestra de
  "camino" que ve el modelo es una plaza empedrada, empedrará también la senda
  del bosque. Por eso el empedrado aparece SOLO en la plaza de `settlement`,
  y todas las zonas salvajes muestran sendas de tierra.
- **Una referencia por zona.** Cada tile se repinta con la referencia de SU
  zona (ver [selección](#cómo-se-elige-la-referencia-de-cada-tile)), así que
  un mundo nevado no se pinta con la paleta del pueblo verde.

## Anatomía de un pack

```
data/styles/{style_id}/
  style.json                  manifest (ver _plantilla/style.json.example)
  cover.jpg                   portada para la UI del título (no alimenta a la IA)
  settlement.jpg              ┐ 9 ZONAS (proyección oblicua única):
  farmland.jpg                │ settlement, farmland, forest, wetland,
  forest.jpg                  │ desert, snow, fortress, interior,
  …                           ┘ underground
  character_commoner.jpg      ┐ 3 PERSONAJES: model sheet (el MISMO
  character_noble.jpg         ├ personaje en frente, 3/4 y espalda)
  character_warrior.jpg      ┘
```

Campos de `style.json`:

| Campo | Qué es |
|---|---|
| `style_id` | Igual al nombre del directorio (filesystem-safe). |
| `name`, `description` | Lo que ve el jugador en el selector. |
| `style_token` | Frase en inglés que complementa a las imágenes en cada prompt. Ver [style_token](#el-style_token). |
| `cover` | Archivo de portada. Si falta, el builder copia el primer entorno disponible. |
| `refs` | Lista `{category, file, tags}` — una entrada por categoría. `nature` es alias legacy de `forest`. (Campo legacy `perspective`: se acepta en el schema pero las entradas `"isometric"` se IGNORAN — era de dos proyecciones.) |

Formato técnico: JPEG o PNG; el resolver (`ai_server/style_packs.py`) las
normaliza a **long-side 1024, JPEG q90** antes de enviarlas. Cuadradas o casi
cuadradas funcionan mejor (los tiles y los sprites lo son).

## Cómo se consume cada imagen

Todas las generaciones van por Meshy image-to-image (1–5 refs por llamada; el
pipeline usa 2):

| Categoría | Cuándo se usa | Cómo llega a Meshy |
|---|---|---|
| Zonas (`settlement`…`underground`) | Repintado de cada tile (`/generate_scene_image`). | 2ª referencia, detrás del **blueprint proyectado** del tile. El blueprint manda en layout y proyección exacta; la ref aporta composición de zona, paleta, técnica, materiales y cómo se pintan las caras/volúmenes. |
| `character_*` | Skin de personaje (`/skin_sprite_sheet`), una por `style_role` (commoner/noble/warrior). | 2ª referencia del **hero-shot** (detrás del frame base de y_bot). Al ser un model sheet, enseña el diseño desde varios ángulos; los atlas de las 8 direcciones heredan del hero. |
| `cover` | Solo UI de la pantalla de título. | Nunca. |

El trazado del tile lo pone el blueprint; la referencia fija CÓMO se pinta —
materiales, luz, paleta, densidad de detalle — y cómo se tratan alturas y
caras (cara sur iluminada, cara este en sombra, igual que el compositor).

## Cómo se elige la referencia de cada tile

`styleCategoryForTile(style_tag, biome)` en
`nefan-core/src/games/style-categories.ts` (el cliente la aplica al pedir cada
imagen):

1. El motor narrativo etiqueta cada escena/tile con un `style_tag` (una de las
   9 zonas; enum en `data/contract/prompts/world_rules.md`).
2. Las zonas **construidas o interiores** (`settlement`, `farmland`,
   `fortress`, `interior`, `underground`) mandan: sus referencias ya contienen
   la transición al entorno.
3. Las zonas **naturales** (`forest`, `wetland`, `desert`, `snow`) se afinan
   por el **bioma real del tile** (Format D v3): un tile de pantano al borde
   de una escena de bosque usa `wetland`. Mapeo de biomas: grass /
   forest_floor / meadow / stone → forest · dirt → farmland · sand → desert ·
   snow → snow · swamp → wetland.
4. Sin etiqueta ni bioma, el servidor usa `settlement`.

Si al pack le falta una imagen, el resolver cae a la zona **vecina más afín**
(cadenas
`_ENV_FALLBACK` en `ai_server/style_packs.py`: p. ej. `forest → wetland →
farmland → snow → …`); si el pack no tiene NINGUNA imagen, se degrada a la
referencia global del servidor.

## Qué referencias son realmente necesarias

Prioridad si se crean a mano (todas las cadenas de fallback terminan cubriendo
el pack entero, así que un pack parcial funciona desde el primer día):

1. **`settlement`** — default del servidor y primer fallback de las zonas
   construidas.
2. **`forest`** — la zona natural más frecuente y fallback de las demás
   naturales (grass/meadow también caen aquí).
3. **`character_commoner`** — primer fallback de los personajes.
4. **`farmland`** — el anillo alrededor de cualquier pueblo.
5. **`interior`** — los cutaway tienen una lectura muy distinta; su fallback
   se nota.
6. `underground`, `fortress` — completan lo construido.
7. `wetland`, `desert`, `snow` — solo imprescindibles si el mundo pisa esos
   biomas (Miravanda tiene pantanos; un mundo desértico las necesita el día 1).
8. `character_noble`, `character_warrior`, `cover`.

**Set completo recomendado: 9 entornos + 3 personajes + cover** (~$2.16
generarlas todas — la cover se copia gratis; ver
[coste](#las-tres-vías-de-creación)).

## Reglas de composición por imagen

Los SVG de [`_plantilla/`](_plantilla/) muestran cada composición. Reglas
duras comunes:

- **Sin texto, sin UI, sin marcos ni bordes** (las etiquetas de los SVG son
  solo de la plantilla).
- **Zonas**: vista aérea full-bleed, escena completa con varios elementos y
  transición a la zona vecina, **sin personajes**. El material de los caminos
  corresponde a la zona: tierra en el campo y el bosque, tablones en el
  pantano, empedrado SOLO en la plaza urbana.
- **La vista NO es un plano puro** — es la oblicua del compositor: todo
  volumen pinta su **cara sur** entre su línea de suelo y `base − altura`,
  ~25% más oscura que la tapa, y una **cara este más estrecha en sombra**
  (edificio = tejado + muro sur con puerta/ventanas + lateral este; **árbol =
  copa + tronco** asomando por el sur; torre/pilar = tapa circular + cara de
  cilindro), y se pinta de norte a sur (orden del pintor). En `interior` el
  edificio va sin techo y con los muros en corte, pero pinta igualmente sus
  caras y está rodeado de mundo.
  - `settlement`: pueblo Y su entorno — casas, calles de tierra, plaza (único
    empedrado), huertos; bordes fundiéndose en campos y bosque.
  - `farmland`: campiña — campos con surcos, granja y granero, setos, camino
    de tierra; transición a pradera y borde de bosque.
  - `forest`: bosque salvaje SIN edificios — masa densa, claro, senda de
    tierra, arroyo con rocas; transición a pradera abierta.
  - `wetland`: pantano SIN edificios — agua turbia, juncos, árboles
    retorcidos, pasarelas de tablones; transición a pradera húmeda.
  - `desert`: desierto SIN edificios — dunas, roquedal, matorral seco, oasis
    pequeño; transición a estepa.
  - `snow`: paisaje nevado SIN edificios — pinos, rocas, arroyo helado, senda
    de nieve pisada; transición a pradera alpina.
  - `fortress`: la fortaleza EN su paisaje — murallas con torres, puerta,
    patio con barracones, y el campo alrededor con camino de tierra.
  - `interior`: el edificio en **cutaway sin techo**, SIEMPRE integrado en su
    entorno — la calle, un vecino y el camino hasta la puerta alrededor
    (nunca una planta flotando en un vacío). Cutaway estilo Sims: muros
    traseros en pie, frontales a media altura.
  - `underground`: mazmorra — corredores, cámaras de distintos tamaños,
    escaleras, pilares, escombros. La única ref "oscura": define la penumbra.
- **Personajes**: **model sheet de UN solo personaje** — el MISMO personaje
  dibujado tres veces a cuerpo entero (frente, tres cuartos y espalda, misma
  altura), fondo neutro liso. El rol marca el vestuario: `commoner` ropa de
  trabajo sencilla y gastada; `noble` telas ricas y joyas; `warrior` armadura
  de época con arma y escudo visibles.
- **`cover`**: composición libre que venda el estilo; solo la ve la UI.

## El `style_token`

Frase corta en inglés que acompaña a las imágenes en cada prompt ("Overall
art direction: …" en tiles, "Match the EXACT art style … ({style_token})" en
skins). Debe describir **técnica + paleta + luz + mood**:

```
hand-painted watercolor, soft luminous colors, gentle warm light, painterly
```

**No incluir la proyección** ("top-down", "isometric", "overhead"): el mismo
token sirve a tiles y a personajes en 3/4. Tampoco
describir contenido ("village", "forest"): eso lo ponen el blueprint y el
prompt de escena.

## Las tres vías de creación

**1. CLI (packs shipped o locales)** — escribe un `style.json` con los 12 refs
declarados (copia `_plantilla/style.json.example`) y genera las imágenes que
falten (`--only` acepta categorías: `forest`, `settlement`…):

```bash
python ai_server/tools/build_style_pack.py mi_estilo            # solo ausentes
python ai_server/tools/build_style_pack.py mi_estilo --only forest,settlement
python ai_server/tools/build_style_pack.py mi_estilo --dry-run  # coste sin gastar
```

Sin imágenes previas, el estilo sale del `style_token`; el ENCUADRE lo pone un
seed fijo por tipo (battlemap para entornos, frame de y_bot para personajes) y
la COMPOSICIÓN de zona la describe el prompt de cada categoría
(`CATEGORY_SCENES` en `ai_server/style_pack_builder.py`). Si el pack ya tiene
imágenes, se usan como referencias de estilo (hasta 3) y el prompt exige
calcarlas. Requiere `MESHY_API_KEY`.

**2. Subida de jugador (in-game)** — `POST /styles/upload` valida y guarda las
imágenes en `user_{slug}/` sin gastar créditos, y responde con las categorías
que faltan y su coste estimado; `POST /styles/{id}/complete` con `confirm=true`
genera los ausentes usando las subidas como referencia de estilo. Basta subir
1–3 imágenes buenas del estilo deseado: el builder completa el resto
calcándolas.

**3. A mano** — cualquier imagen propia vale si cumple las
[reglas de composición](#reglas-de-composición-por-imagen). Colocarla con el
nombre declarado en `refs` y listo: el resolver recarga por mtime, sin
reiniciar ai_server.

Coste por imagen generada (Meshy image-to-image, plan Pro $0.02/crédito):
`nano-banana` 3 cr ($0.06) · `nano-banana-2` 6 cr ($0.12) ·
**`nano-banana-pro` 9 cr ($0.18, default)** · `gpt-image-2` 12 cr ($0.24).
Un pack completo desde cero: 12 × $0.18 ≈ **$2.16** (la cover se copia del
primer entorno sin coste).

**Nota de migración (estado actual): NO regenerar aún.** Los packs shipped
declaran los 12 refs, pero TODAS sus imágenes presentes son anteriores al set
de zonas: se generaron con los prompts viejos de sujeto aislado (`forest.jpg`
es el antiguo `nature.jpg` renombrado — sin senda, sin transición;
`fortress.jpg` es una fortaleza aislada; los personajes son una sola vista,
no un model sheet). Cuando la plantilla quede CERRADA hay que regenerar el
pack ENTERO de cada estilo (borrar los .jpg y correr el CLI), no solo los
ausentes. Hasta entonces, no lanzar `build_style_pack.py` ni
`/styles/{id}/complete`. Packs viejos con categoría `nature` siguen
funcionando (alias de `forest` en schema y resolver).

## Mejoras pendientes (documentadas, no implementadas)

1. **Aprovechar los 5 slots de Meshy** (hoy se usan 2): en tiles fronterizos
   entre zonas, pasar las DOS referencias implicadas (p. ej. settlement +
   forest en el borde del pueblo).
2. **Sustituir la referencia global de fallback** del servidor
   (`scene_image_generator._style_uri`, el battlemap urbano): es la que
   empedraba los caminos cuando el pack no resolvía. Con los packs completos
   casi nunca se usa, pero sigue siendo un battlemap urbano.
3. **Refs con el look oblicuo**: las refs actuales de zona son cenitales con
   caras; regenerarlas mostrando también la cara este (el encuadre `ENV_FRAME`
   ya lo pide) reforzaría cómo pinta el estilo los laterales.

## La plantilla `_plantilla/`

No es un estilo (los listers ignoran directorios `_*`): es documentación.
Contiene un SVG esquemático por categoría (+ cover) con la composición
requerida y sus reglas duras, y `style.json.example` como manifest de
partida. Para previsualizarlos: `xdg-open _plantilla/settlement.svg` o
cualquier navegador.
