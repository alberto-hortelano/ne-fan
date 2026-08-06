# labs/stage — bench de segmentación del plató pintado (proscenio)

Reproduce el pipeline de recortes del cliente paso a paso sobre una imagen
pintada cacheada, con la visión EN EL BUCLE, y emite una hoja de contactos
HTML para evaluar A OJO cada paso sin quemar repintados.

**Regla inquebrantable**: JAMÁS se recorta con las siluetas declaradas del
compositor (SVG) — el modelo de imagen recoloca/reorienta lo declarado. Los
recortes salen de segmentar lo PINTADO (cajas de visión → SAM2 segment_boxes);
lo declarado solo aporta pistas y la profundidad de las huellas.

## Uso

```bash
# 1. Dump de la geometría del compositor (una vez por escena):
npx tsx labs/stage/dump_stage.ts nefan-core/data/scenes/proscenio/posada_salon.json \
    labs/stage/dumps/posada_salon.json

# 2. Runner (visión = fichero --boxes con el contrato stage_review):
source .venv/bin/activate
python labs/stage/run.py \
  --image cache/scenes/5769e7fb0d2b3fcc/scene.png \
  --stage labs/stage/dumps/posada_salon.json \
  --boxes labs/stage/boxes/posada_salon_v2.json \
  --name 005_salon_v2 --peel --backend lama

# 3. Abrir runs/005_salon_v2/index.html
```

SAM y pelados se cachean en `runs/.sam_cache` por (imagen, caja/máscara):
iterar código u overlays es gratis; cambiar una caja re-segmenta solo esa.

## Hallazgos (serie 001-005, salón de la posada, imagen 5769e7fb)

1. **El repintado NUNCA respeta la franja de suelo del blueprint.** Con
   teleobjetivo f=30 el suelo de 8 m es una franja de ~20 px y el modelo pinta
   un suelo profundo a su gusto: recoloca muebles, invierte el orden de
   profundidad declarado y desproyectar contactos con la proyección del
   compositor colapsa TODO a z=depth (run 001). **Solución: la perspectiva
   pintada MANDA** — la visión da `floor.wall_base_px` (donde el suelo toca la
   pared) y `calibratedProjection` reajusta ground_y/horizon_y: z=0 en el
   frente pintado, z=depth en la base de la pared. Con ella las z pintadas se
   ordenan bien (run 002: barril 4.5, mesa 5.5, banco 7.0).
2. **SAM2 segment_boxes clava las siluetas pintadas** con cajas de visión
   correctas. Las cajas deben incluir los accesorios pegados al objeto (velas
   sobre las mesas — si no, llamas flotantes en la placa) y las patas en
   sombra (runs 004→005).
3. **FLUX Fill REINVENTA el mueble dentro de su propio hueco** (run 003: mesas
   casi idénticas + estufa inventada en el arco). Causas: hueco con forma de
   mesa + behind_labels que enumeraba TODO lo lejano. **LaMa local gana** para
   el pelado del plató (run 004-005: cero invención, 0.4 s/paso, gratis); el
   borrón que deja queda TAPADO por el propio recorte (solo asoma al 45% en el
   fade y se lee como sombra). behind_labels: SOLO elementos que solapen el
   hueco en pantalla.
4. **Dilatación del hueco ±16 px** (4×MaxFilter(9)) antes del inpaint: traga
   patas finas y halos que SAM deja fuera. El recorte usa la máscara EXACTA.
5. Colisión: banda [contacto−profundidad, contacto] siguiendo el contorno
   inferior desproyectado — cae bajo las bases pintadas (run 002/005,
   overlay 04). Los objetos pegados a la pared del fondo colapsan a z≈depth y
   su banda queda contra el muro (sin impacto: el clamp de bounds ya bloquea).
   Las celdas que invaden una salida se limpian y se reporta.
6. Diff de reconstrucción (placa+recortes vs original): 0.4-0.8/255 — el
   composite es fiel por construcción; NO detecta elementos sin identificar
   (esa garantía es el inventario COMPLETO de la visión).

## Calibración total (runs 006–021, 2026-08-02)

Serie del bucle "coincidencia máxima imagen↔recortes↔colisión" — score
compuesto en `score.py` (`scores.csv` acumula; `runs/index.html` es la hoja de
progreso con la demostración in-game en `runs/shots_finales/`).

1. **Trapecio del suelo** (`floor.left/right_wall_px + left/right_front_px`
   del contrato stage_review): calibra px_per_m, focal y centro/cámara
   laterales (`calibratedProjection` con solve exacto — las 4 esquinas del
   trapecio se reproducen a 1e-9). Baseline sin él: 41.4/100 con edge_gap
   0.005 y escala rota; con él el rect jugable calca el suelo pintado.
2. **edge_gap** (métrica anti-muros-invisibles): solo puntúan lados LIBRES —
   interiores al encuadre Y no ocluidos por items inventariados (el suelo que
   muere contra una mesa no es un borde jugable). La máscara de suelo son DOS
   cajas SAM (empedrado del fondo + tarima delantera) unidas.
3. **Doble perspectiva de la pintura**: el modelo pinta el suelo con una
   convergencia (trapecio) y los TAMAÑOS con otra (una plaza frontal casi
   ortográfica encoge puertas 2× al fondo). Posiciones/colisión usan la del
   suelo; la TALLA de sprites usa `fitSpriteScale` → {k, focal_size} ajustado
   al mobiliario pintado (outliers a >×1.65 de la mediana no votan). La
   métrica de talla puntúa CONSISTENCIA (residuos del fit), no error absoluto
   — k lo absorbe el cliente.
4. **unexplained** se evalúa dentro del TRAPECIO (fuera hay paredes/bastidores
   legítimos). Restante real ~6-28%: huecos de la máscara de suelo y sombras.
5. Repintar con anclas de escala en el prompt: DESCARTADO tras medir — la
   varianza entre repintados supera la ganancia y el modelo de talla ya
   reconcilia en cliente. Encuadres cerrados sin bordes de suelo visibles: la
   visión ahora puede omitir el trapecio (mejor vertical-only que rectas
   inventadas).

Scores finales (visión real): salón v2 58.5 · cocina 62.7 · calle 65.7.
