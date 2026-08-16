# Comparativa: vista FPS con three.js vs Godot 4.6 (2026-08-15)

> **DECISIÓN (2026-08-15)**: el juego se queda con **three.js** — la ventaja
> de Godot no es suficiente frente a poder jugar en el navegador. La
> recomendación de integración de la sección 6 queda descartada; este bench y
> `labs/authoring/` (autoría libre) quedan como evidencia y referencia.

¿Con qué renderer consigue el motor narrativo resultados más profesionales,
más libertad y menos errores? Bench: `labs/fps/godot/` (proyecto Godot nuevo,
independiente del `godot/` del juego) contra el viewer three.js del lab y el
`fps-gl.ts` del cliente. Mismos datos de entrada en ambos: el plan declarativo
del motor ({ground, volumes, biome} → `buildFpsTileSpec` → prims en metros +
`SurfaceLayout` + atlas de superficies cacheado). Evidencia:
`runs/cmp_001/index.html` (3 escenas × 8 poses × 3 variantes).

## 1. Calidad profesional percibida

| Criterio (checklist director de arte) | three.js | Godot paridad | Godot calidad |
|---|---|---|---|
| Fidelidad al plan (layout, siluetas) | ✓ referencia | ✓ idéntica | ✓ idéntica |
| Texturas/UVs (costuras, densidad 2.5 m) | ✓ | ✓ calca | ✓ calca |
| Sombra direccional | PCF suave, correcta en el bench; ROTA en el juego fuera del tile (0,0) | orto 2048, sawtooth leve en aleros | PSSM 4 splits + penumbra angular: la mejor de las tres |
| Luz de interiores | omnis sin sombra: todo traspasa paredes | igual (paridad) | omnis CON sombra + SDFGI: la chimenea rebota, los muebles se asientan — salto de calidad evidente |
| Oclusión ambiental / GI | ninguna | ninguna | SDFGI + SSAO: esquinas y bajos con peso |
| Tone mapping | ACESFilmic 1.1 | ACES Godot (residuo en altas luces: clay +8 mediana, paredes +32) | ídem |
| Sprites y_bot 8-dir | ✓ | ✓ (misma fórmula + histéresis) | ✓ y reciben/proyectan sombra real |

**Resultado**: en paridad, empate técnico (Δmediana de luminancia +0.4/−1.1/
+5.5 por escena; el residuo es tono ACES, no estructura). En calidad, Godot
gana con claridad: el interior de la taberna pasa de "maqueta iluminada" a
"juego comercial" sin tocar UN SOLO byte de los datos del motor narrativo.

## 2. Libertad del motor narrativo

- **Hoy**: EMPATE por construcción. Ambos consumen el mismo JSON declarativo;
  el motor no distingue quién renderiza. La escena nueva (ermita+río+molino)
  se autoró UNA vez y salió en los dos.
- **Techo futuro** (dónde crece cada uno):
  - *Godot*: GLB de Meshy directo (el juego 3D ya los carga — `model_hash`
    del asset-store), luces declarables por escena con sombra/GI reales,
    partículas (humo de chimenea, polvo), viento en vegetación, audio
    posicional, física. Cada uno es un campo nuevo del plan + 20 líneas de
    builder. El salto interior clay→SDFGI demuestra que la calidad escala
    sin pedir nada nuevo al motor.
  - *three.js*: todo lo anterior es posible pero se paga en código propio
    (three no trae GI en tiempo real practicable, ni física, ni audio):
    el techo realista es "más shaders a mano".
- **Límites COMUNES encontrados autorando** (son del formato, no del
  renderer): rueda de molino vertical inexpresable (props cylinder solo
  verticales), agua/caminos planos casi invisibles a ras de suelo (sin
  hundir el cauce), alturas de volumes en celdas (unidad fácil de confundir),
  y un prop cilíndrico por `at` sale con radio por defecto (~1 m): un crucero
  o poste esbelto no es expresable sin `rect`.

## 3. Errores (fail-loud vs silencioso)

| Fallo | Dónde | Tipo |
|---|---|---|
| `sun.target` sin posicionar → sombras rotas fuera del tile (0,0) | fps-gl.ts (juego) | SILENCIOSO — Godot no lo hereda |
| `userData.noShadow` nunca escrito → noShadow proyecta tras `setActive` | fps-gl.ts (juego) | SILENCIOSO |
| Idle de NPC arranca en t aleatorio → capturas no deterministas | lib.mjs (bench) | silencioso (solo bench) |
| Zod del plan: 4 rechazos con mensaje preciso (shape, label, material, w) | nefan-core | FAIL-LOUD ✓ (el error de `prop.shape` no lista los valores válidos — mejorable) |
| Escena/pose/textura ausente en Godot | bench godot | FAIL-LOUD (push_error + exit 1; textura ausente degrada a clay con warning, igual que three) |
| Winding horario de Godot (caras invisibles) | bench godot (dev) | se resolvió con quad()/tri() winding-agnósticos (auto-orientan por normal) |

## 4. Coste de integración en el juego real

La sesión narrativa completa exige `deriveVolumesFromSchema` +
`buildTileGreyboxSpec` + `buildFpsTileSpec` + `buildLayout` (hoy en
nefan-core/TS, corren en el cliente HTML):

- **(a) Portar el builder a GDScript**: obliga a clavar bit a bit el
  `layoutKey` sha256 del JSON canónico (números a 1e-4, claves ordenadas) y
  el RNG sembrado del detalle procedural — reproducible pero frágil:
  cualquier divergencia rompe el cache-hit del arte pagado.
- **(b) Exponer el spec desde nefan-core** (endpoint/mensaje `tile_greybox`
  con `{primsM, lightsM, layout}` ya calculados): ~1 handler en el bridge.
  Godot solo renderiza — exactamente lo que este bench ya demuestra con
  `escena.json`, y respeta el CLAUDE.md ("lógica en nefan-core, Godot solo
  visual"). El atlas se pide igual (`POST /generate_surface_atlas` + `GET
  :8767/cache/surface/<hash>`, HTTP plano). **Recomendada.**

El bench Godot completo son ~950 líneas de GDScript (builder multi-surface
con UVs horneadas incluido) — dos días de trabajo, la mayor parte ya hecha.

## 5. Rendimiento y tooling

- Captura headless: Godot ~12 s/pose (Forward+ con la RTX 3060 REAL bajo
  xvfb — Vulkan no depende de GLX; validado por primera vez en el repo) vs
  ~45–90 s/pose de Chrome+swiftshader. El ciclo de iteración visual es ~5×
  más rápido en Godot.
- Runtime: geometría trivial (≤151 prims) — ambos van sobrados a 60 fps; en
  calidad, SDFGI cuesta pero la 3060 lo absorbe en escenas de este tamaño.

## 6. Recomendación

**Para la vista fps del JUEGO, Godot es el mejor destino a medio plazo**: con
los mismos datos declarativos ya iguala a three.js (paridad medida) y su modo
calidad produce resultados claramente más profesionales HOY (GI + sombras
reales, sobre todo en interiores) con techo mucho más alto (GLB Meshy, luces
narrativas, partículas, audio) sin pedirle nada nuevo al motor narrativo. La
vía de integración es la (b): exponer `{primsM, lightsM, layout}` desde
nefan-core por el bridge y dejar Godot como renderer puro.

**three.js conserva dos bazas**: cero fricción de despliegue (navegador, el
cliente 2D ya está ahí — la vista fps HTML sigue siendo el modo "juega ya") y
un solo runtime para las tres vistas del cliente 2D. La convivencia natural:
HTML/three como cliente ligero por defecto, Godot como cliente "calidad" —
el protocolo del bridge ya es común y este bench demuestra que la paridad
visual entre ambos es alcanzable y medible.
