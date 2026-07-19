# IMAGE REVIEW — objetos EXTRA de la imagen pintada

Estás viendo la imagen FINAL repintada de un tile, junto a la lista de
elementos DECLARADOS por el plan (con su bbox en píxeles de esta imagen). El
modelo de imagen a veces INVENTA objetos que no están en el plan (casas,
árboles, barreras, puestos): sin tu revisión, el jugador los atraviesa o
camina por encima y se rompe la ilusión.

Tu trabajo: localizar cada objeto SÓLIDO APRECIABLE que aparezca pintado y NO
esté en la lista de declarados, y decidir si se conserva (gana colisión y
oclusión) o se elimina (se borra de la imagen por inpainting).

Responde EXACTAMENTE este JSON:

```json
{
  "extras": [
    {
      "label": "casa inventada al noroeste",
      "action": "keep",
      "box_px": [40, 120, 150, 110],
      "tall": true,
      "solid": true,
      "h": 8,
      "depth_cells": 6
    },
    { "label": "artefacto que no encaja", "action": "remove", "box_px": [10, 20, 40, 30] }
  ]
}
```

Reglas:
- `box_px` = [x, y, ancho, alto] en píxeles de ESTA imagen. Puede ser
  IMPRECISA: un modelo de segmentación recortará la silueta exacta dentro de
  la caja. Procura que la caja contenga el objeto entero con algo de margen y
  que NO abarque objetos vecinos (ni declarados) — si el objeto toca a otro,
  encoge la caja hacia el lado libre.
- `tall`: true si el objeto es más alto que un personaje (casas, árboles) —
  ganará oclusión (se funde cuando tape al jugador). Objetos bajos (barreras,
  cajas) o pegados al BORDE de la imagen (silueta cortada, nadie puede quedar
  detrás): `tall: false` — solo colisión.
- `solid`: false solo para decoración atravesable (alfombras, manchas).
- `h`: altura estimada en celdas (un personaje ≈ 3.6). `depth_cells`:
  profundidad de mundo de su base (lo que ocupa hacia el norte, oculto tras el
  objeto). La base de colisión se deriva de la silueta: su contorno inferior
  extruido `depth_cells` — no des la base, solo la profundidad.
- `action: "remove"` para lo que desentone con la escena o rompa la costura
  del tile (objetos partidos por el borde): se inpainta y desaparece.
- NO listes elementos ya declarados ni detalles del suelo (caminos, charcos,
  sombras). Vacío es válido: `{ "extras": [] }` si la imagen no inventó nada.
- Máximo 12 extras: prioriza los que afectan al juego (grandes, en zona
  transitable).
