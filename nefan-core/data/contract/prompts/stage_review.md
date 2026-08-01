# STAGE REVIEW — inventario COMPLETO del plató pintado

Estás viendo la imagen FINAL repintada de un PLATÓ de la vista proscenio: una
escena en PERSPECTIVA lateral (cámara al sur mirando al norte — el telón de
fondo arriba, la embocadura abajo, el suelo en perspectiva entre ambos). NO es
una vista cenital. La imagen está ESTIRADA a un cuadrado — los objetos pueden
verse algo achatados o alargados; es normal.

Junto a la imagen recibes `expected_elements`: los elementos que el plan
DECLARÓ, cada uno con su etiqueta y una caja APROXIMADA de dónde debería
estar. El modelo de imagen a veces los RECOLOCA, los gira, los pinta con otro
tamaño, los omite… o INVENTA objetos nuevos. Tu inventario es la única
garantía de que cada cosa pintada existe en el juego: lo que no inventaríes,
el jugador lo atraviesa o lo pisa y se rompe la ilusión.

Tu trabajo: un inventario COMPLETO de lo pintado.
1. Para CADA elemento de `expected_elements`: ¿está pintado? Si sí, da su caja
   REAL (donde de verdad está pintado, no donde debería estar). Si no lo
   encuentras, márcalo `missing`.
2. Además, TODO objeto con volumen pintado sobre el suelo que NO corresponda a
   ningún expected es un `extra`: caja + decidir si se conserva (gana recorte,
   oclusión y colisión) o se elimina (se borra por inpainting).

Responde EXACTAMENTE este JSON:

```json
{
  "expected": [
    { "id": "vol_mesa", "status": "found", "box_px": [210, 540, 260, 170] },
    { "id": "vol_taburete", "status": "missing" }
  ],
  "extras": [
    {
      "label": "barril junto a la chimenea",
      "action": "keep",
      "box_px": [700, 420, 90, 130],
      "tall": true,
      "solid": true,
      "h": 2,
      "depth_cells": 2
    },
    { "label": "mancha que rompe la escena", "action": "remove", "box_px": [10, 20, 40, 30] }
  ]
}
```

Reglas:
- `expected` debe listar TODOS los ids de `expected_elements`, cada uno una
  sola vez, con `status: "found"` (y `box_px` obligatoria) o `"missing"`.
- `box_px` = [x, y, ancho, alto] en píxeles de ESTA imagen. Puede ser
  IMPRECISA: un modelo de segmentación recortará la silueta exacta dentro de
  la caja. La caja debe contener el objeto ENTERO (incluida su base apoyada en
  el suelo) con algo de margen, y NO abarcar objetos vecinos — si el objeto
  toca a otro, encoge la caja hacia el lado libre.
- La caja describe lo PINTADO: si la mesa declarada a la izquierda aparece
  pintada a la derecha y de costado, la caja va a la derecha. No "corrijas"
  la imagen hacia el plan.
- `extras`: `tall` true si es más alto que un personaje de pie a su misma
  profundidad (podría taparlo). `solid` false solo para decoración
  atravesable (alfombras, sombras). `h` = altura estimada en metros;
  `depth_cells` = profundidad de su base en celdas de 0.5 m (lo que ocupa
  hacia el fondo). No des la base: la colisión se deriva del contorno
  inferior de la silueta.
- `action: "remove"` para lo que desentone o duplique un expected (el modelo a
  veces pinta el mismo mueble dos veces): se inpainta y desaparece.
- NO listes como extra: detalles del suelo (tablones, alfombras planas,
  sombras, charcos), el telón de fondo, la chimenea u hornacinas EMPOTRADAS en
  la pared del fondo (forman parte del telón), ni nada ya cubierto por un
  expected.
- Máximo 12 extras: prioriza los que afectan al juego (grandes, en zona
  transitable). `"extras": []` es válido.
