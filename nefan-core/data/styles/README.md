# Estilos — guía de creación

Un **estilo** es el pack de imágenes de referencia que fija la dirección de
arte de TODA la generación de imagen del cliente 2D: el repintado de cada
tile/plató del mundo y el skin de cada personaje. El jugador lo elige en la
pantalla de título (junto al mundo) y queda **congelado en el save**.

Esta carpeta contiene los packs shipped (`acero_neon`, `acuarela_luminosa`,
`medievo_crudo`, `sombra_de_cuento`), los subidos por jugadores (`user_*`) y
[`_plantilla/`](_plantilla/): los renders clay three.js que sirven de SEED de
encuadre por vista.

## Formato (2026-08: refs LIBRES por vista)

Las categorías fijas murieron. Un pack declara **imágenes libres**: cada una
vive en la carpeta de su vista, lleva un `id` estable y una `description` en
español. El contenido depende del mundo — puede haber una estación espacial,
una catedral, un cementerio; no hay lista cerrada.

```
data/styles/{style_id}/
  style.json               manifest (ver _plantilla/style.json.example)
  cover.jpg                portada para la UI del título (no alimenta a la IA)
  overworld/*.jpg          refs cenitales (proyección oblicua) — vista overworld (y fps)
  proscenium/*.jpg         refs a pie de suelo (platós) — vista proscenium
  fps/surfaces.jpg         la LÁMINA de materiales (role fps_surfaces) — mejora del atlas fps
  characters/*.jpg         model sheets de personaje (compartidos entre vistas)
```

Campos de `style.json`:

| Campo | Qué es |
|---|---|
| `style_id` | Igual al nombre del directorio (filesystem-safe). |
| `name`, `description` | Lo que ve el jugador en el selector. |
| `style_token` | Frase en inglés que complementa a las imágenes en cada prompt. Ver [style_token](#el-style_token). |
| `cover` | Archivo de portada (raíz del pack). Si falta, el builder copia la primera cenital disponible. |
| `tags` | **Etiquetas temáticas** (min 1): casan el estilo con juegos compatibles por intersección (`styleCompatibleWithGame`). Vocabulario libre; guía en `SUGGESTED_THEME_TAGS` (style-refs.ts). Un pack medieval no se ofrece para un mundo futurista. |
| `ui` | OPCIONAL: tema de la **interfaz de juego** (paleta, tipografía, forma). Ver [El tema de UI](#el-tema-de-ui). |
| `refs[]` | Lista de `{id, file, description, gen_scene?, seed?, role?}`. **El orden importa**: la primera ref de cada vista es el fallback cuando el motor no elige. |
| `refs[].id` | Id estable de la ref: es lo que emite el motor narrativo al elegirla y **entra en la clave de caché de imagen** — renombrarlo repaga todas las escenas generadas con esta ref; renombrar `file` o `description` no (el hash es del contenido del archivo). |
| `refs[].file` | Ruta relativa, SIEMPRE dentro de `overworld/`, `proscenium/`, `fps/` o `characters/` — **la carpeta ES la vista** (fail-loud si no). |
| `refs[].description` | Qué muestra la imagen, en español y en una frase. **Es lo que lee el motor narrativo** para elegir la referencia de cada escena — escribirla pensando en ese lector. |
| `refs[].gen_scene` | OPCIONAL: prompt EN de CONTENIDO para (re)generar la imagen con el builder. Sin él se usa `description` tal cual. |
| `refs[].seed` | OPCIONAL: seed de encuadre de `_plantilla/` (ruta relativa). Sin él, el `default.png` de su vista. |
| `refs[].role` | `"fps_surfaces"` = lámina de materiales del atlas fps (máx 1, solo en `fps/`). Queda FUERA del catálogo del motor. |

Formato técnico: JPEG o PNG; el resolver (`ai_server/style_packs.py`) las
normaliza a **long-side 1024, JPEG q90** antes de enviarlas.

Fuente de verdad del formato: `StyleManifestSchema` en
`nefan-core/src/games/loader.ts` (+ `src/games/style-refs.ts`, módulo puro).

## Cómo se elige la referencia de cada escena

**El motor narrativo elige.** El catálogo del pack (`{id, description}` de la
vista activa + personajes) viaja en su contexto (`world.style_refs`) y cada
escena lleva la elección explícita (`style_tag`/`style_ref` = un id del
catálogo). El server resuelve por id DENTRO de la vista del blueprint (una
ref cenital nunca pinta un plató ni viceversa):

- Sin elección, o con un id desconocido: **la primera ref de la vista** en el
  orden del manifest (determinista y editable a mano); si su imagen aún no
  existe (pack en construcción), la siguiente de la misma vista.
- Pack sin ninguna imagen utilizable: referencia global del servidor (tiles)
  o solo blueprint (platós) o solo token (atlas fps).
- Personajes: el motor elige la ref de `characters/` por NPC; sin elección,
  la primera (en los packs migrados, `commoner`).

## Vistas: qué habilita un pack

`styleViews` deriva de las **carpetas de las refs declaradas** (no de los
archivos en disco — un pack en construcción ya aparece en el selector y el
runtime degrada mientras faltan imágenes):

- ≥1 ref en `overworld/` → sirve a `overworld` **y** `fps` (la lámina
  `fps_surfaces` mejora el atlas, no habilita la vista).
- ≥1 ref en `proscenium/` → sirve a `proscenium`.
- `characters/` y la lámina no habilitan vistas.

## La regla de oro: cada referencia cenital es una ZONA, no un sujeto

El mundo es abierto y continuo: el modelo de imagen repinta tiles que casi
siempre contienen VARIOS elementos y bordes entre zonas. Los modelos de
imagen copian con fuerza la composición de la referencia:

- **Escena completa, nunca un sujeto aislado.** Una ref que sea "una
  fortaleza centrada sobre fondo vacío" condiciona a generar objetos sueltos.
  Cada ref de `overworld/` debe ser un trozo de mundo lleno, con transición
  visible a lo vecino.
- **Los materiales se copian de la referencia.** Si la única muestra de
  "camino" es una plaza empedrada, empedrará también la senda del bosque.
- **La vista NO es un plano puro** — es la oblicua del compositor: todo
  volumen pinta su **cara sur** (~25% más oscura que la tapa) y una **cara
  este más estrecha en sombra**; interiores en cutaway sin techo, integrados
  en su entorno.
- **Sin texto, sin UI, sin marcos, sin personajes**, full bleed.

## Refs de PLATÓ (`proscenium/`)

Escenas a NIVEL DE SUELO (cámara al sur mirando al norte, la convención del
proscenio) que alimentan el repintado del plató (`blueprint_kind: "stage"`,
gpt-image-2 vía fal). Se generan desde las plantillas clay de
`_plantilla/proscenium/` (1600×1000 → 1280×800); la plantilla fija cámara y
composición, el CONTENIDO lo pone `gen_scene`. Iluminación CONVENCIONAL (luz
desde cámara, nunca contraluz); mismos vetos (sin marcos, sin personajes).

## La lámina fps (`fps/surfaces.jpg`, role `fps_surfaces`)

La vista fps pinta su arte como **atlas de superficies**. Sin lámina, la
dirección de arte del atlas entra solo por el `style_token`; con ella, viaja
como 2ª referencia de cada página y manda en paleta/materiales/factura.

- **Qué es**: una rejilla 3×4 de **muestras de material planas a 90°**, NUNCA
  escenas ni objetos. Seed: `_plantilla/fps/fps_surfaces.png`
  (`ai_server/tools/gen_fps_seed.py`); modelo nano-banana-pro (fal).
- **Sin fallback**: existe o el atlas va solo con token.
- **Caché**: su hash entra en la clave de cada celda de la librería de
  superficies SOLO cuando existe — añadirla o regenerarla repinta la librería
  de ese estilo; los estilos sin lámina conservan la suya.

## Refs temáticas `fps/` (caras completas)

Además de la lámina, la carpeta `fps/` admite refs **temáticas de CARA**:
ilustraciones de una cara completa a 90° (una fachada con su puerta y
ventanas, un portón claveteado, un cartel) que enseñan cómo compone el
estilo ese tipo de cara. Entran en el catálogo `world.style_refs.fps_faces`
(mundos de rama tile) y el **motor narrativo las elige por cara de volumen**
(`surface_ref` junto a `surface_desc`); la imagen viaja como 2ª referencia
de la página del atlas que pinta esas celdas hero.

- Declararlas a mano: `{ "id": "fachada_casa", "file": "fps/fachada_casa.jpg",
  "description": "fachada de casa con puerta y dos ventanas", "gen_scene?":
  … }`. Sin `seed` declarado, el builder usa `_plantilla/fps/face_default.png`
  (plano clay a 90°) como encuadre — NUNCA el `default.png` de `fps/`, que es
  la rejilla de la lámina.
- No habilitan la vista fps (eso sigue derivando de `overworld/`) ni tienen
  fallback: una ref desconocida deja la celda SIN ref (warning), nunca otra
  imagen.
- Coste: cada ref distinta agrupa sus celdas en páginas PROPIAS del atlas
  (~$0.17/página gpt-image-2 extra). Su hash entra en la clave de las celdas
  que la usan (condicional): añadirla o regenerarla repinta solo esas.
- Referencia shipped: `medievo_crudo` declara tres (`fachada`, `porton`,
  `tienda`). Cada ref declarada suma su generación al coste de "aplicar
  estilo" si falta la imagen; añade al pack solo las que pida el mundo.

## El tema de UI

El pack no viste solo el mundo: también la **interfaz de juego** (diálogo,
vida, acciones, salidas, avisos). El bloque `ui` de `style.json` lleva la
dirección de arte del estilo a esos paneles.

```json
"ui": {
  "surface": "rgba(28, 20, 13, 0.88)",
  "border": "#5e4526",
  "ink": "#e8dcc4",
  "accent": "#e0a44a",
  "font": "Georgia, 'Times New Roman', serif",
  "radius_px": 2
}
```

| Campo | Qué viste |
|---|---|
| `surface` | Fondo del panel. **Con alfa**: el mundo debe verse detrás. |
| `raised` | Fondo de los botones dentro de un panel. |
| `border` | Filete de paneles y botones. |
| `ink` / `ink_dim` | Texto principal / secundario (teclas, notas). |
| `accent` / `accent_ink` | Énfasis (nombre del hablante, foco, salidas) y su texto encima. |
| `danger` | Daño, muerte, avisos. |
| `fade` | Color del corte entre escenas. No siempre negro: en un mundo de acuarela, papel. |
| `font` / `font_display` | Pila CSS de familias (cuerpo / titulares). Solo nombres del sistema — sin fuentes remotas. |
| `radius_px`, `hairline_px`, `tracking_em` | Forma: esquina, grosor del filete, espaciado de titulares. |
| `glow` | `true` añade un halo del acento (sci-fi). |

Reglas:

- **Todo es opcional**, y el bloque entero también: lo que falte lo pone el
  tema BASE (`BASE_UI_THEME`). Un pack puede declarar solo `accent`.
- Estética **diegética sobria**: el tema cambia paleta, tipografía y forma;
  nunca el layout. El arte generado ya es denso — la interfaz no compite.
- **Legibilidad obligatoria**: `nefan-core/test/ui-theme.test.ts` mide el
  contraste WCAG del texto sobre su panel (≥4.5:1) y del acento (≥3:1) en
  los cinco packs shipped. Un tema bonito que no se lee rompe el test.
- Un valor inválido (un hex mal escrito, un `url()` en `font`) tumba el
  manifest entero, igual que una ref rota: el estilo desaparece del selector
  con un warning.
- El tema **no se congela en el save**: el bridge lo relee del pack en cada
  `start_session` y `resume_session`, así que retocar una paleta y reanudar
  la partida basta para verla.

Fuente de verdad: `nefan-core/src/games/ui-theme.ts`.

## El `style_token`

Frase corta en inglés que acompaña a las imágenes en cada prompt. Debe
describir **técnica + paleta + luz + mood**:

```
hand-painted watercolor, soft luminous colors, gentle warm light, painterly
```

**No incluir la proyección** ("top-down", "overhead") ni contenido
("village", "forest"): eso lo ponen el blueprint y el prompt de escena.

## Las tres vías de creación

**1. CLI (packs shipped o locales)** — escribe un `style.json` con las refs
declaradas (copia `_plantilla/style.json.example`) y genera las imágenes que
falten (`--only` acepta ids de ref):

```bash
python ai_server/tools/build_style_pack.py mi_estilo            # solo ausentes
python ai_server/tools/build_style_pack.py mi_estilo --only forest,settlement
python ai_server/tools/build_style_pack.py mi_estilo --view proscenium
python ai_server/tools/build_style_pack.py mi_estilo --dry-run  # coste sin gastar
# Flujo de APROBACIÓN (re-tirada incondicional a staging, sin tocar el pack):
python ai_server/tools/build_style_pack.py mi_estilo \
    --only stage_street --out nefan-core/data/styles/_staging/mi_estilo
# aprobar = cp del staging al pack (las refs ya están declaradas)
```

Sin imágenes previas, el estilo sale del `style_token`; el ENCUADRE lo pone
el seed (`refs[].seed` o el `default.png` de su vista; y_bot para
personajes) y el CONTENIDO lo describe `gen_scene ?? description`. Si el
pack ya tiene imágenes, se usan como referencias de estilo y el prompt exige
calcarlas. Requiere `MESHY_API_KEY` (cenitales/personajes) y `FAL_KEY`
(platós y lámina).

**2. Subida de jugador (in-game)** — `POST /styles/upload`: cada imagen con
su vista + descripción libre (+ tags del pack); guarda en `user_{slug}/` sin
gastar. El manifest declara además un **starter mínimo** en las vistas donde
no se subió nada (3 cenitales genéricas + 1 personaje + la lámina); esas
refs "declaradas sin archivo" son lo que `GET /styles/{id}/missing`
presupuesta y `POST /styles/{id}/complete` (confirm=true) genera calcando
las subidas. Los platós NO se auto-declaran: solo entran los subidos (sin
ref de plató, la vista proscenio no se ofrece).

**3. A mano** — cualquier imagen propia vale si cumple las reglas de
composición de su vista. Colocarla en la carpeta correcta, declararla en
`refs` con su descripción y listo: el resolver recarga por mtime, sin
reiniciar ai_server. Para añadir contenido nuevo (una catedral, un puerto)
basta añadir la ref — no hay lista que respetar.

Coste por imagen generada: cenitales/personajes por Meshy (plan Pro
$0.02/crédito): `nano-banana` 3 cr ($0.06) · `nano-banana-2` 6 cr ($0.12) ·
**`nano-banana-pro` 9 cr ($0.18, default)** · `gpt-image-2` 12 cr ($0.24).
Platós y lámina por fal directo: **gpt-image-2 $0.17** / nano-banana-pro.

## La plantilla `_plantilla/`

No es un estilo (los listers ignoran directorios `_*`): son los SEEDS de
encuadre del builder, renders clay three.js de los pipelines de PRODUCCIÓN,
organizados por vista:

```
_plantilla/
  overworld/{zona}.png     9 tiles del builder tile-greybox real (1024²)
  overworld/default.png    seed por defecto de refs cenitales libres
  proscenium/stage_*.png   6 platós del bench labs/escenografia/greybox
  proscenium/default.png   seed por defecto de refs de plató libres
  fps/fps_surfaces.png     rejilla de la lámina de materiales
  fps/default.png          alias del anterior
  planes/{zona}.json       los planes declarativos de los tiles oblicuos
  style.json.example       manifest de partida en el formato de refs libres
```

Los PNG se commitean y JAMÁS se hashean (el render WebGL no es
byte-determinista). El capturador que regeneraba las semillas de
`overworld/` y `proscenium/` (`labs/plantillas/capture.sh`) se retiró con el
pipeline de imagen de esas dos vistas; las de `fps/` no salían de él.

## Migración desde el formato de categorías

`nefan-core/scripts/migrate-style-packs.ts` convierte un pack plano de la
era de categorías (settlement.jpg + `category` en refs) al formato nuevo:
mueve cada imagen a la carpeta de su vista **conservando su nombre como
`id`** (la clave de caché `{style_id}/{id}:{content_hash}` queda
byte-idéntica — el histórico generado se conserva) y pasa `scene` a
`gen_scene`. Se conserva una release para packs `user_*` de terceros.
