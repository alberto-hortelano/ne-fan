# labs/fps — modo 3D primera persona (estilo Doom) con atlas de superficies

Bench del tercer modo de juego candidato (además del oblicuo 2D y el
proscenio): **FPS con giro discreto de 8 ángulos** (teclado, sin ratón),
personajes como **sprites y_bot de 8 direcciones** (se muestra la dirección
más cercana al ángulo real relativo a cámara) y arte por **atlas de
superficies**: la geometría greybox se descompone en clases de material +
celdas "hero", el atlas clay se repinta UNA vez con un modelo i2i de fal y
las celdas recortadas se aplican como texturas — el 3D se renderiza en tiempo
real, sin repintar por frame.

## Uso

```bash
# Fase GRATIS (sin créditos):
cd nefan-core && npx tsx ../labs/fps/dump_spec.ts   # regenerar escenas/exterior/spec.json
./labs/serve.sh                                     # :8912
#   → http://localhost:8912/fps/viewer.html?scene=interior           (clay)
#   → ...viewer.html?scene=exterior&run=runs/003_x                   (texturizado)
#   W/S/A/D mover · Q/E o ←/→ girar 45° · Shift correr · P copiar pose
python3 labs/fps/fake_textures.py --scene interior  # texturas damero → runs/fake_interior
./labs/fps/capture.sh interior out/ [run] [poses…]  # capturas de las poses fijas

# Fase de PAGO (fal.ai, caché en runs/_cache, tope duro $12):
source .venv/bin/activate
python3 labs/fps/gen.py 001_x --scene interior --model seedream [--style retro]
    [--variant A|C] [--dry-run] [--label-mode gutter] [--suffix _r2] [--feather 16]
```

Runs de referencia (locales, gitignored): `016_mix` (interior nano+heroes
gpt2 — el mejor), `015_ext_nano` (exterior nano), `01n_nano`/`01g_gpt2`
(comparativa), `runs/contact_final.png` (hoja de contactos del veredicto).
Jugar: `viewer.html?scene=interior&run=runs/016_mix` y
`?scene=exterior&run=runs/015_ext_nano`.

## Estructura por run

```
runs/<run>/
  layout.json            celdas + rects + asignación prim→celda (congelado)
  atlas_pN_base.png      base clay determinista (PIL)
  atlas_pN_gen.png       atlas repintado por el modelo
  textures/<key>.png     celdas recortadas (inset 6 px; tile cells con feather)
  index.html             base|generado|recortes + prompt + coste por página
  manifest.json
```

## Piezas

- `surfaces.mjs` — núcleo puro compartido node/navegador: clasificación de
  superficies por prim y grupo de caras (`SHAPE_GROUPS`), catálogo
  `MAT_INFO`, celdas por variante (A = solo materiales tileables;
  C = + celdas hero de prims marcadas `hero`) y shelf packing (≤12
  celdas/página — hallazgo skinning V4: más celdas colapsan el modelo).
- `lib.mjs` — three.js: prim → mesh multi-material con UVs en metros
  (`DENSITY_M` = 2.5 m/repetición), colisión AABB + deslizamiento, cielo,
  banco de sprites y_bot y billboards 8-dir.
- `escenas/interior` — taberna + cripta autorada en metros (heroes: barra,
  estante, chimenea, sarcófago). `escenas/exterior` — el tile medieval del
  juego volcado con `buildTileGreyboxSpec` (dump_spec.ts, celdas ×0.5 → m).
- Los sprites (`sprites/` → symlink a nefan-html/public/sprites/y_bot,
  gitignored por licencia) usan el set `frontal_8`; la dirección es
  `yaw_entidad − yaw(cámara→entidad)` cuantizado a 8.

## Checklist de crítica (director de arte)

1. Costuras del tileo (horizontal y vertical) en muros largos y suelos.
2. Densidad de texel homogénea entre suelo/muro/props.
3. Paleta coherente entre celdas y entre páginas del atlas.
4. Luz PINTADA que contradiga la luz 3D (sombras/AO/brillos en el albedo = fallo).
5. Bleed o bordes redibujados entre celdas (el inset debe tragárselos).
6. Legibilidad del material a 5–10 m (distancia de juego).
7. Perspectiva parásita dentro de una celda.
8. Identidad: puertas/huecos donde el spec los declara (heroes reconocibles).
9. Moiré/repetición evidente en superficies grandes.
10. Los sprites y_bot asientan sobre el suelo (contacto, valor, contraste).

## Veredicto (2026-08-14)

- **La vía atlas-de-superficies FUNCIONA**: con dos llamadas i2i por escena
  (~$0.06–0.34 según modelo) el mundo greybox queda texturizado y navegable
  en primera persona a 60 fps, y el resultado lee como juego retro-FPS real.
- **Modelos** (interior, 2 páginas): `nano-banana-pro` ($0.15/página) es el
  ganador — pintado a mano estilizado, paleta cohesiva, el único que resolvió
  el barril como patrón envolvente; además es el modelo que el juego ya usa
  vía Meshy. `gpt-image-2` ($0.17) es el techo en celdas hero (estante y
  sarcófago exquisitos) pero más "ilustración" que "textura" en conjunto;
  mezcla candidata: nano para tiles + gpt2 para heroes. `seedream` ($0.03) =
  caballo de batalla de iteración (calidad media, obediente). `qwen` apenas
  retexturiza los rects (inútil aquí); `kontext` colapsa materiales a
  tablones.
- **Variantes**: C (materiales tileables + celdas hero) gana sin discusión —
  la captura A de la barra (todo tablones genéricos, sin estante ni chimenea)
  pierde toda la identidad. C-local (SD1.5, $0) vale como fallback sin
  créditos para tiles, pero confunde materiales (yeso→ladrillo) y no tiene
  heroes.
- **Sprites y_bot 8-dir**: correctos tras calibrar el desfase de signo
  (bench cardinal); el frontal_8 (pitch −8°) funciona a nivel de ojos.
- Gasto total del bench: ~$1.7 de $12 (todo cacheado — re-cortar y
  re-capturar es gratis).

## Hallazgos

- **Describir la SUPERFICIE, no el lugar.** "ceiling boards between heavy
  beams" hizo que seedream pintara la habitación entera con fuga dentro de la
  celda (run 001). La fórmula que funciona: "flat material swatch seen
  straight-on at 90°, like a texture library sample" + descripciones
  material-first (run 002). Palabras trampa: "axe-hewn" pintó un hacha;
  "floor/ground" sin "seen flat from directly above" mete fuga.
- **Celdas anchas se fragmentan.** El modelo partió la barra 2:1 en dos
  paneles e inventó una celda en el gutter (run 003). Mitigación que funcionó
  (run 004): pistas estructurales dentro de la celda base (`hints` — banda de
  latón, arco de chimenea, baldas) + regla "EXACTLY N rectangles… never split".
- **El feather de tileado con `Image.transform` AFFINE NO envuelve** — metía
  NEGRO en 3 cuadrantes de la copia desplazada y pintaba la rejilla oscura
  que se veía en el suelo (runs 007/008 pre-fix). `np.roll` + rampa por eje.
  Además `flatten_illumination` (dividir el blur gaussiano) mata el viñeteado
  del modelo, que era la otra mitad de la rejilla.
- **Un motivo único por celda tileable se repite cada DENSITY_M y canta**
  (la grieta del yeso). Materiales tileables: pedir "plain/uniform, no marks".
- **Estilos (seedream):** "hand-painted 90s retro FPS" → semi pixel-art
  coherente con los sprites y_bot y la geometría chunky (ELEGIDO); "painterly
  not photorealistic" y "gritty dark-fantasy" → derivan a FOTO con
  perspectivas parásitas. La adherencia de estilo entre llamadas es floja —
  anclar la página 2 con la página 1 como referencia funciona.
- **Sprites 8-dir:** el set frontal_8 real tiene dir0=frente/dir4=espalda
  (el idle "sword and shield" engaña por el twist de la pose) y gira en
  sentido CONTRARIO a `yaw_npc − yaw(cámara→entidad)` — calibrado con el
  bench cardinal S/E/N/W (ver lib.mjs).
- **Hastiales del gable = muro, no teja** (classify caps → wall_plaster).
- El detalle procedural clay del suelo (elipses/piedritas del builder) sobre
  textura pintada lee como parches planos — se oculta en modo texturizado.
