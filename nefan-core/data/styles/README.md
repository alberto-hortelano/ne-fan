# Estilos — guía de creación

Un **estilo** es el pack de imágenes de referencia que fija la dirección de
arte de TODA la generación de imagen del juego: el atlas de superficies con
el que se pinta el mundo en primera persona y el skin de cada personaje. El
jugador lo elige en la pantalla de título (junto al mundo) y queda
**congelado en el save**.

Esta carpeta contiene los packs shipped (`acero_neon`, `acuarela_luminosa`,
`anime`, `medievo_crudo`, `sombra_de_cuento`), los subidos por jugadores
(`user_*`) y [`_plantilla/`](_plantilla/): los renders clay three.js que
sirven de SEED de encuadre por carpeta.

## Formato: refs LIBRES en tres carpetas de ROL

Las categorías fijas murieron y las vistas también. Un pack declara
**imágenes libres**: cada una vive en la carpeta de su ROL, lleva un `id`
estable y una `description` en español. El contenido depende del mundo —
puede haber una estación espacial, una catedral, un cementerio; no hay lista
cerrada.

```
data/styles/{style_id}/
  style.json               manifest (ver _plantilla/style.json.example)
  cover.jpg                portada para la UI del título (no alimenta a la IA)
  surfaces/surfaces.jpg    la LÁMINA de materiales — EXACTAMENTE UNA
  faces/*.jpg              caras completas del mundo (fachada, portón, tienda…)
  characters/*.jpg         model sheets de personaje
```

Las tres carpetas son **obligatorias**: un pack al que le falte una no carga
y desaparece del selector con el motivo. No es celo burocrático — es el
único sitio donde la ausencia se notaba tarde y mal: sin lámina el atlas se
generaba igual, solo con el `style_token`, y las superficies salían grises
genéricas sin un solo aviso.

Campos de `style.json`:

| Campo | Qué es |
|---|---|
| `style_id` | Igual al nombre del directorio (filesystem-safe). |
| `name`, `description` | Lo que ve el jugador en el selector. |
| `style_token` | Frase en inglés que complementa a las imágenes en cada prompt. Ver [style_token](#el-style_token). |
| `cover` | Archivo de portada (raíz del pack). Si falta, el builder copia la primera cara disponible. |
| `tags` | **Etiquetas temáticas** (min 1): casan el estilo con juegos compatibles por intersección (`styleCompatibleWithGame`). Vocabulario libre; guía en `SUGGESTED_THEME_TAGS` (style-refs.ts). Un pack medieval no se ofrece para un mundo futurista. |
| `ui` | OPCIONAL: tema de la **interfaz de juego** (paleta, tipografía, forma). Ver [El tema de UI](#el-tema-de-ui). |
| `refs[]` | Lista de `{id, file, description, gen_scene?, seed?}`. **El orden importa**: la primera ref de `characters/` es el fallback cuando el motor no elige. |
| `refs[].id` | Id estable de la ref: es lo que emite el motor narrativo al elegirla. Renombrarlo no repinta nada por sí solo (la clave de caché lleva el hash del CONTENIDO del archivo), pero sí rompe las elecciones que el motor ya tiene en su historial. |
| `refs[].file` | Ruta relativa, SIEMPRE dentro de `surfaces/`, `faces/` o `characters/` — **la carpeta ES el rol** (fail-loud si no). |
| `refs[].description` | Qué muestra la imagen, en español y en una frase. **Es lo que lee el motor narrativo** para elegirla — escribirla pensando en ese lector. |
| `refs[].gen_scene` | OPCIONAL: prompt EN de CONTENIDO para (re)generar la imagen con el builder. Sin él se usa `description` tal cual. |
| `refs[].seed` | OPCIONAL: seed de encuadre de `_plantilla/` (ruta relativa). Sin él, el `default.png` de su carpeta. |

Formato técnico: JPEG o PNG; el resolver (`ai_server/style_packs.py`) las
normaliza a **long-side 1024, JPEG q90** antes de enviarlas.

Fuente de verdad del formato: `StyleManifestSchema` en
`nefan-core/src/games/loader.ts` (+ `src/games/style-refs.ts`, módulo puro).

## Cómo se elige la referencia

**El motor narrativo elige.** El catálogo del pack (`{id, description}` de
las caras y de los personajes) viaja en su contexto (`world.style_refs`) y
cada elección es explícita: `surface_ref` por cara de volumen,
`entities[].style_ref` por NPC. El server resuelve por id DENTRO de la
carpeta que toca — una cara nunca pinta un personaje ni viceversa:

- **`faces/` no tiene fallback**: un id desconocido deja la celda SIN ref y
  con warning, nunca con otra imagen. Pintar una fachada con el arte de un
  portón porque el id no existía es exactamente la clase de silencio que el
  juego no admite; el fail-loud contra el catálogo vive en el pre-flight de
  narrative-mcp.
- **`characters/` sí**: sin elección, o con un id desconocido, la primera del
  manifest (determinista y editable a mano); si su imagen aún no existe
  (pack en construcción), la siguiente de la misma carpeta.
- **`surfaces/` no admite sustituto**: existe o el atlas va solo con el
  token. Una escena contaminaría los swatches planos.

## La lámina de materiales (`surfaces/`)

El juego pinta su arte como **atlas de superficies**: cada celda del atlas es
un material de una cara del mundo. La lámina viaja como 2ª referencia de cada
página y manda en paleta, materiales y factura; sin ella solo entra el
`style_token`, y por eso es obligatoria.

- **Qué es**: una rejilla 3×4 de **muestras de material planas a 90°**, NUNCA
  escenas ni objetos. Seed: `_plantilla/surfaces/default.png`
  (`ai_server/tools/gen_sheet_seed.py`); modelo nano-banana-pro (fal).
- **Exactamente una por pack**: dos láminas serían una que nunca se usa y
  nadie sabría cuál manda.
- **Caché**: su hash entra en la clave de cada celda de la librería de
  superficies, así que regenerarla repinta la librería de ese estilo.

## Las caras del mundo (`faces/`)

Ilustraciones de una cara completa a 90° (una fachada con su puerta y
ventanas, un portón claveteado, un cartel) que enseñan cómo compone el estilo
ese tipo de cara. Entran en el catálogo `world.style_refs.fps_faces` y el
**motor narrativo las elige por cara de volumen** (`surface_ref` junto a
`surface_desc`); la imagen viaja como 2ª referencia de la página del atlas
que pinta esas celdas hero.

- Declararlas a mano: `{ "id": "fachada_casa", "file":
  "faces/fachada_casa.jpg", "description": "fachada de casa con puerta y dos
  ventanas", "gen_scene?": … }`. Sin `seed`, el builder usa
  `_plantilla/faces/default.png` (plano clay a 90°) como encuadre.
- **Composición**: la superficie paralela al plano de imagen, a sangre, sin
  cielo, sin línea de suelo, sin horizonte, sin perspectiva. Luz plana, solo
  albedo. Sin texto, sin marcos, sin personajes.
- Coste: cada ref distinta agrupa sus celdas en páginas PROPIAS del atlas
  (~$0.17/página gpt-image-2 extra). Su hash entra en la clave de las celdas
  que la usan: añadirla o regenerarla repinta solo esas.
- Referencia shipped: los cinco packs declaran tres (`fachada`, `porton`,
  `tienda`). Cada ref declarada suma su generación al coste de "aplicar
  estilo" si falta la imagen; añade al pack solo las que pida el mundo.

## Los personajes (`characters/`)

Model sheets: el MISMO personaje dibujado tres veces de cuerpo entero
(frente, tres cuartos y espalda), fondo neutro, sin texto. Guían el skin IA
de cada NPC. Cara humana VISIBLE cuando el mundo lo admita — un casco cerrado
deja al NPC sin rostro en el retrato del diálogo.

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

**No incluir la proyección** ni contenido ("village", "forest"): eso lo
ponen el blueprint y el prompt de la celda.

## Las tres vías de creación

**1. CLI (packs shipped o locales)** — escribe un `style.json` con las refs
declaradas (copia `_plantilla/style.json.example`) y genera las imágenes que
falten (`--only` acepta ids de ref):

```bash
python ai_server/tools/build_style_pack.py mi_estilo            # solo ausentes
python ai_server/tools/build_style_pack.py mi_estilo --only fachada,porton
python ai_server/tools/build_style_pack.py mi_estilo --folder faces
python ai_server/tools/build_style_pack.py mi_estilo --dry-run  # coste sin gastar
# Flujo de APROBACIÓN (re-tirada incondicional a staging, sin tocar el pack):
python ai_server/tools/build_style_pack.py mi_estilo \
    --only fachada --out /tmp/staging/mi_estilo
# aprobar = cp del staging al pack (las refs ya están declaradas)
```

Sin imágenes previas, el estilo sale del `style_token`; el ENCUADRE lo pone
el seed (`refs[].seed` o el `default.png` de su carpeta; y_bot para
personajes) y el CONTENIDO lo describe `gen_scene ?? description`. Si el
pack ya tiene imágenes, se usan como referencias de estilo y el prompt exige
calcarlas. Requiere `MESHY_API_KEY` (personajes) y `FAL_KEY` (lámina y
caras).

**2. Subida de jugador (in-game)** — `POST /styles/upload`: cada imagen con
su carpeta + descripción libre (+ tags del pack); guarda en `user_{slug}/`
sin gastar. El manifest declara además un **starter mínimo** en las carpetas
donde no se subió nada (la lámina, una cara y un personaje); esas refs
"declaradas sin archivo" son lo que `GET /styles/{id}/missing` presupuesta y
`POST /styles/{id}/complete` (confirm=true) genera calcando las subidas.

**3. A mano** — cualquier imagen propia vale si cumple las reglas de
composición de su rol. Colocarla en la carpeta correcta, declararla en
`refs` con su descripción y listo: el resolver recarga por mtime, sin
reiniciar ai_server. Para añadir contenido nuevo (una catedral, un puerto)
basta añadir la ref — no hay lista que respetar.

Coste por imagen generada: personajes por Meshy (plan Pro $0.02/crédito):
`nano-banana` 3 cr ($0.06) · `nano-banana-2` 6 cr ($0.12) ·
**`nano-banana-pro` 9 cr ($0.18, default)** · `gpt-image-2` 12 cr ($0.24).
Lámina y caras por fal directo: **gpt-image-2 $0.17** / nano-banana-pro
$0.18.

## La plantilla `_plantilla/`

No es un estilo (los listers ignoran directorios `_*`): son los SEEDS de
encuadre del builder, organizados por carpeta de rol:

```
_plantilla/
  surfaces/default.png     rejilla 3×4 de la lámina de materiales
  faces/default.png        plano clay a 90° para una cara
  style.json.example       manifest de partida en el formato de refs libres
```

Los PNG se commitean y JAMÁS se hashean (un render WebGL no es
byte-determinista). La rejilla de `surfaces/` sí es reproducible:
`python ai_server/tools/gen_sheet_seed.py` la regenera byte a byte.
