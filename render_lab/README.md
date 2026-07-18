# render_lab — bench de alternativas de generación del mapa 2D

Compara enfoques de generación de la imagen de tile contra el pipeline actual
(blueprint SVG → repintado img2img de tile completo → segmentación SAM2):

- **exp1_repaint** — img2img del tile completo con modelos alternativos (fal).
- **exp2_three** — render three.js: (a) determinista desde el plan declarado
  (`map_ground`+`volumes`) con texturas IA; (b) escena escrita LIBREMENTE por el
  LLM desde la descripción (evalúa su capacidad de gestionar el mapa).
- **exp3_sprites** — assets UNO A UNO: un sprite RGBA por volumen + suelo aparte,
  composición determinista por baseline. Sin SAM2.
- **exp4_vector** — el propio SVG del compositor con texturas IA como patterns.

Fixtures: `fixtures/{medieval,scifi}/` — plan crudo + blueprint compuesto +
occluders por tramo, volcados con `fixtures/dump_occluders.ts` desde
save-wrappers (`fixtures/build_saves.py`; el medieval se reconstruye de los
artefactos del run 002 de style_lab, validado byte-idéntico al recomponer).

```bash
source .venv/bin/activate
python3 render_lab/fixtures/build_saves.py
cd nefan-core && npx tsx ../render_lab/fixtures/dump_occluders.ts $PWD \
  ../render_lab/runs/_cache/save_medieval.json tile_0_0 ../render_lab/fixtures/medieval
# ... experimentos: ver cada exp*/ y report.py
./render_lab/serve.sh   # :8912
```

Todas las llamadas de pago pasan por `common.py:fal_call` (caché en disco en
`runs/_cache/` — replay gratis — y contador de gasto en `runs/_cache/spend.json`).

## Pipeline híbrido (estética IA + occluders por máscara, SIN SAM2)

La conclusión del bench convertida en pipeline (`exp2_three/hybrid_capture.sh`
+ `hybrid_pipeline.py`): el render three.js del plan + una PASADA DE MÁSCARAS
(cada unidad de oclusión en un color de una rejilla RGB separada, `?mode=masks`
del viewer) → repintado img2img (nano-banana-pro, ~$0.15/tile) → sprites
recortados de la imagen repintada con la máscara EXACTA de cada unidad →
placa de fondo con LaMa local sobre los huecos. Sin SAM2, sin clasificador de
visión: sabemos píxel a píxel qué es cada cosa. La demo lo consume con
`?art=hybrid` (placa + sprites como painter por baseline; el fade es capa
única nativa). Limitación esperada: el img2img aún inventa algún edificio en
zonas vacías (queda en la placa, sin colisión) — el review por visión del
juego seguiría aplicando.

## Review por visión de los extras del img2img (hybrid_review)

Cierra el hueco de los objetos que el repintado INVENTA (casas, palmeras,
barreras) o redibuja torcidos: el modelo de visión (Claude mirando
`review_grid.png`, rejilla de celdas sobre el repintado) escribe
`review.json` con cajas IMPRECISAS + su estimación de la BASE real pintada;
`hybrid_review.py --apply` llama a SAM2 por caja (`fal-ai/sam2/image`,
box_prompts — el mismo endpoint del juego, ~$0.01/caja) para el recorte
exacto, convierte cada extra en sprite/occluder, inpainta su hueco de la
placa (LaMa), y emite `collision_patch.json` (`add` = bases de extras y bases
corregidas de adjusts; `clear` = huellas declaradas que el pintado movió).
La demo v6 aplica el parche en `solidAt` y muestra los extras en el painter;
overlay C: rojo=grid del plan, naranja=add, azul=clear.

Lecciones de la pasada: SAM por caja clava edificios y palmeras; falla en
objetos pegados a otros (ajustar la caja para esquivar al vecino) y en los
cortados por el borde de la imagen — para esos, y para lo que queda pegado a
un muro, basta `tall:false` (colisión sin sprite: nadie puede quedar detrás
de un objeto del borde). Los `removes` funcionan (SAM+LaMa) aunque el review
final no eliminó nada: todo lo inventado sumaba. En el juego real este rol lo
haría la llamada de visión del motor narrativo (patrón `blueprint_review`).

**Bases torcidas desde la silueta** (`base_from_mask: true` + `depth_cells`):
en vez de un rect, la colisión se deriva del propio mask de SAM — el contorno
INFERIOR de la silueta (por columna, el y máximo, suavizado con mediana) es la
línea de contacto con el suelo pintada (en la oblicua, h=0 ⇒ imagen==mundo),
y extruida `depth_cells` al norte da la huella real: sigue la inclinación del
objeto, no puede salirse de su silueta en X, y cubre SOLO la parte que toca el
suelo — el resto queda como occluder. Se emite como `add_cells` en
`collision_patch.json` (la demo las consulta como Set) y se visualiza en
magenta en `review_debug.png` y en el overlay C. Los `adjusts` aceptan
`box_px` para pedir su propio mask (los 3 puestos del sci-fi). Verificado:
el personaje se detiene a v distintas según la columna (base diagonal) y las
zonas donde el rect antiguo sobresalía del tenderete son transitables.
Con `occluder: true` un adjust además CONVIERTE el objeto pintado en
sprite/occluder (recorte por su mask + hueco inpaintado en la placa): la lona
del tenderete tapa al personaje detrás y se funde con la rampa estándar.

## Demo interactiva (colisiones + oclusión con fade)

El enfoque E2a hecho jugable: personaje con WASD sobre los tiles del bench,
colisión contra el grid analítico de huellas (`fixtures/<tile>/collision.json`,
volcado con `fixtures/dump_collision.ts` desde `volumeCollisionGrid` de
nefan-core) y la oclusión del juego (el volumen que te tapa baja su opacidad
con la rampa OCCLUDER_FADE; cutaway = solo muros traseros; muros por tramo;
copas de árbol solo por proximidad).

```bash
./render_lab/serve.sh   # :8912
# → http://localhost:8912/exp2_three/demo.html?tile=medieval            (arte vector)
# → http://localhost:8912/exp2_three/demo.html?tile=medieval&art=hybrid (arte IA)
```

Teclas: WASD/flechas mover · **C rota las vistas de debug** (normal → colisión
→ segmentación → oclusión, como la B del juego): colisión = grid + parche del
review (naranja rects, magenta celdas de silueta, azul anulado); segmentación
= la silueta EXACTA de cada sprite tintada con su id (calidad del recorte SAM
a la vista); oclusión = huella + baseline amarilla de cada occluder (naranja =
solo-proximidad). `?pos=u,v` posición inicial. API de test en consola: `__demo.setPos/getPos/tick/occlusionState/matState`.
Verificado: muralla y muros de casas bloquean al radio exacto (0.4 m), el arco
del adarve y la puerta este de la cantina son transitables Y VISIBLES (los
muros tallan los vanos de gates/doors — `carve()`), y el fade se activa solo
DETRÁS del volumen que te cubre (0.45–1.0 según distancia, el mismo
OCCLUDER_FADE_MIN del juego; `setFadeMin` para ajustar en pruebas). El
personaje lleva además una silueta fantasma sin depth-test (siempre legible
cuando algo lo tapa, el patrón RPG clásico).

Gotcha clave de oclusión en three.js: un volumen fundido NO puede renderizarse
con alpha por-material sin más — sus superficies apiladas (tejado + tapa +
fachada) COMPONEN el alpha (0.32² ≈ opaco) y el suelo de detrás no se ve.
Solución en fadeTargets: capa única — orden frontal-primero (renderOrder por
altura de cada malla) con depthWrite, de modo que la superficie más alta se
mezcla UNA vez con el fondo y bloquea a las de debajo (equivalente al recorte
plano del cliente 2D). Verificado con alpha 0.02: el camino tras la casa se ve
íntegro. Nota de proyección: el vano de un muro N-S queda geométricamente
oculto por la tapa del tramo sur — se marca con el gatehouse (dintel de madera
cruzando el muro) y se revela al cruzarlo vía fade.

## Hallazgos del run 001 (2026-07-18, ~$2.75 en créditos fal)

Fidelidad = % de edificios del plan que el segmentado SAM2 encuentra en su
sitio (métrica del juego). Dos tiles: medieval (plazuela Toledo, 23 volumes) y
sci-fi (colonia Umbral, 15 volumes).

| Enfoque | Fidelidad (med/sci) | $/tile | Colisión/oclusión | Veredicto |
|---|---|---|---|---|
| E1 nano-banana-pro (baseline juego) | 100→73 (varianza)/100 | 0.15 | vía SAM2 | El mejor img2img; varianza alta entre corridas |
| E1 gpt-image-2 high | 100/60 | 0.17 | vía SAM2 | 8× más lento (210 s); no gana al baseline |
| E1 seedream4 / qwen / kontext | 45–82 | 0.03–0.08 | vía SAM2 | **CALCAN la ref de estilo** (layout copiado edificio a edificio) |
| E2a three.js del plan + texturas SD1.5 | 100/100 | 0.00 | **nativas** | Fidelidad perfecta, latencia ~s, estética "PS1-clean"; sin IA de pago |
| E2b three.js libre del LLM | n/a (layout propio) | 0.00 | derivables del manifest | Gestión perfecta: manifest→colisión/occluders/consistencia 100 % |
| E3 sprites por asset (seedream+rembg) | 100/80 | 0.48–0.63 | **nativas, SIN SAM2** | Assets sueltos preciosos; muros/estructuras continuas NO (usar vector); cutaway necesita cláusula |
| E3 t2i por tipo (flux/schnell) | 91 | 0.01 | nativas, SIN SAM2 | Barato y reutilizable; recorte de fondo mejorable |
| E4 vector + texturas patterns | 91/100 | 0.00 | nativas | Layout perfecto por construcción; estética limitada |
| E5 híbrido three.js→seedream | 100/60 | 0.03 | vía SAM2 (o recorte por huella) | Seedream pasa de 45→100 en medieval al partir del render con volumen |

Conclusiones operativas:
1. **El "calco" de la ref de estilo es general en los editores baratos**
   (seedream/qwen/kontext) — solo nano-banana-pro y gpt-image-2 separan bien
   los roles de las dos referencias. El fix de prompt del bench 003 no basta
   con esos modelos.
2. **La varianza del baseline es real** (100 % → 73 % repitiendo la misma
   llamada): el blueprint_review por visión sigue siendo imprescindible.
3. **La vía sin SAM2 existe y funciona**: sprites por asset con huella/baseline
   declaradas (E3) o render three.js del plan (E2a). Ambas heredan colisión y
   oclusión nativas del plan; E3 mantiene la estética IA del juego a coste
   similar al actual y elimina segmentación, placa y análisis.
4. **Regla de oro de E3**: assets DISCRETOS (casas, árboles, props) generan
   de maravilla uno a uno; estructuras CONTINUAS (murallas, tapias, carreteras)
   deben quedarse en el vector/compositor o pintarse con el suelo.
5. **E5 (three.js como entrada del img2img)** es la palanca más prometedora
   para abaratar: el render con volumen/luz elimina la interpretación del SVG
   y hasta seedream ($0.03) clava el layout medieval — pero la métrica es
   permisiva con derivas locales (torre movida): mantener review visual.
6. El LLM gestiona el mapa igual de bien en cualquier variante porque TODO
   sigue siendo declarativo (E2b lo confirma incluso escribiendo three.js
   libre con manifest).
