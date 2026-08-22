# render-sprite-sheets

Pre-renderiza las hojas de sprites Mixamo que consume el cliente
(`nefan-html/src/renderer/sprite-renderer.ts`). Sustituye al renderizador que
vivía en Godot (`scenes/dev/sprite_sheet_renderer.tscn` + `tools/render_sprite_sheets.py`):
la escena la monta **three.js** dentro de Chrome headless, así que un clon del
repo puede generar personajes **sin Godot instalado**.

## Uso

```bash
# una hoja
node tools/render-sprite-sheets/render.mjs --models y_bot --anims idle

# todas las de combate para varios modelos
node tools/render-sprite-sheets/render.mjs --all --angle frontal_8

node tools/render-sprite-sheets/render.mjs --help   # todos los flags
```

Salida (idéntica a la que escribía Godot — **el consumidor no cambia**):

```
{out}/{model}/{anim}/{angle}/dir_{D}_frame_{F:03}.png
{out}/{model}/{anim}/{angle}/meta.json
```

Por defecto `{out}` es `nefan-html/public/sprites/`, que Vite sirve estático.
Rinde ~350 PNG en unos 3 s.

## Qué necesita

- **Chrome** en `/usr/bin/google-chrome` (o `NEFAN_CHROME=/ruta/al/binario`).
  Se lanza con los mismos flags de rasterizado por software que `qa/run.mjs`
  (`--use-angle=swiftshader`), así que no hace falta ni GPU ni servidor X.
- **Los FBX de Mixamo** en `assets/characters/` (gitignorados: la licencia de
  Adobe prohíbe redistribuirlos — ver `assets/characters/mixamo/README.md`):
  - modelos en `mixamo/{modelo}/character.fbx`
  - animaciones de combate en `anims/sword_and_shield/`
  - animaciones de ambiente en `mixamo/ambient_anims/`
- `npm install` en este directorio (`three` + `playwright-core`).

## Paridad con el renderizador de Godot

La escena es un port 1:1, y está **medida**, no supuesta. `comparar.py` compara
una hoja nueva contra otra de referencia y da verde o rojo:

```bash
node tools/render-sprite-sheets/render.mjs --models y_bot --anims idle --out /tmp/nuevo
python3 tools/render-sprite-sheets/comparar.py \
    /tmp/nuevo/y_bot/idle/frontal_8 \
    nefan-html/public/sprites/y_bot/idle/frontal_8
```

Tolerancias: bbox del alfa ±3 px por lado, cobertura ±5 %, luminancia media
±8 %, y `meta.json` campo a campo salvo `generated_at`.

Tres cosas que no se deducen de mirar el código y conviene no re-descubrir:

1. **No hay luz ambiente, y no debe añadirse.** El `SubViewport` de Godot usaba
   `own_world_3d` + `transparent_bg` y el proyecto no declara entorno por
   defecto: la única luz era la direccional. Meter un `AmbientLight` aclararía
   las sombras y rompería la paridad.
2. **`FBXLoader` interpreta como sRGB los colores planos de material, que el FBX
   guarda lineales.** Sin corregirlo el albedo sale ~3,5× oscuro y hay que
   compensarlo con luz, lo que sube el contraste además del brillo. Se corrige
   en `page.mjs` (`fbxColorToLinear`), y por eso `DEFAULT_LIGHT_INTENSITY` sale
   3,5 y no el `light_energy = 1.5` de Godot: three tampoco comparte BRDF.
3. **`FBXLoader` ignora el intervalo declarado del `AnimationStack`** y usa el
   último keyframe. Godot usaba el declarado, y en Mixamo no coinciden ("sword
   and shield idle" declara 3,6667 s pero su última clave está en 3,600 s): con
   la duración de three la hoja sale con 43 frames en vez de 44. Lo resuelve
   `fbx-anim-span.mjs`, que lee el intervalo del FBX binario.

`npm test` (aquí dentro) prueba ese lector con un FBX sintético, sin necesidad
de los assets con licencia.

## Ficheros

| Fichero | Qué es |
|---|---|
| `render.mjs` | CLI: resuelve trabajos, sirve assets y three por HTTP efímero, conduce Chrome y escribe PNG + `meta.json` |
| `page.mjs` | La escena three.js: cámara, luz, carga de FBX, remap de huesos, lock de Hips y muestreo |
| `page.html` | Envoltorio con el importmap de three |
| `fbx-anim-span.mjs` | Lector mínimo del árbol binario FBX para el intervalo del `AnimationStack` |
| `fbx-anim-span.test.mjs` | Sus pruebas (`node --test`), con FBX sintético |
| `comparar.py` | Comprobador de paridad entre dos hojas: encuadre, silueta y tono |
