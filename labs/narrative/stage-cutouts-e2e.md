# E2E: recortes por segmentación del plató (proscenio) — sin créditos

Verifica el pipeline v3 completo (visión+SAM mockeados) con los 3 casos
críticos: un elemento RECOLOCADO por el modelo de imagen, un elemento
`missing` (declarado pero no pintado) y un `extra` inventado. Todo con el
fake-ai-server — cero créditos.

## Arranque

```bash
node labs/narrative/fake-ai-server.mjs &                                  # :18765
cd nefan-core && NEFAN_AI_SERVER=http://127.0.0.1:18765 npx tsx bridge/ws-server.ts &  # :9877 (el sim del movimiento)
cd nefan-html && npm run dev &                                           # :3000
```

Navegar (Playwright o Chrome) a:
`http://localhost:3000/?input=scripted&ai=http://127.0.0.1:18765`

## Guion (consola del navegador / browser_evaluate)

1. Cerrar el título (`#ts-close`), elegir la fixture en `#room-selector`
   (valor que contiene `posada_salon`) y disparar `change`. Esperar
   `__nefan.stage()`.
2. Disparar la G (`window.dispatchEvent(new KeyboardEvent("keydown", {key:
   "g", bubbles: true}))`) y esperar `stageImages() && !stagePainting()`.
   El mock del fake (`/review_stage_image`) devuelve: primer expected
   RECOLOCADO +200 px, último expected missing, un `extra_0` inventado, y un
   `floor` con `wall_base_px` + el TRAPECIO lateral (left/right_wall_px,
   left/right_front_px, descentrado) que ejercita la calibración COMPLETA
   (ppm/focal/centro — log `[stage-img] …: calibración COMPLETA`); las
   máscaras son rects SVG de `/fake/stage_mask`.

## Asserts (todos verificados en verde el 2026-08-02)

- `stageCutouts()` = 2 casados (mesa, barril recolocado con `footprintWorld`
  en su posición PINTADA x≈5.4-6.8, no la declarada x 3-4) + `extra_0`; el
  banco missing NO aparece.
- `probeCollide`: **true** dentro de las bandas pintadas de mesa/barril/extra;
  **false** en la posición DECLARADA del barril y en la del banco missing — la
  colisión derivada SUSTITUYE a la declarada; **false** dentro de ambas zonas
  de salida. Y CERO muros invisibles: **false** pegado a los 4 bordes de
  bounds (pared del fondo, frente, laterales — los muros W del terrain se
  retiran en modo imagen: no están pintados; el clamp de bounds = borde del
  suelo pintado detiene al jugador) y **true** fuera de bounds. Teletransportar
  al jugador a la pared del fondo (`setPlayerPos(0, minZ+0.3)`) debe alcanzar
  la zona de la puerta norte (propuesta de cruce visible).
- Fade: conducir al jugador (driver scripted, rodeando por el ESTE — el
  camino directo lo bloquea el extra pintado, que es en sí una verificación)
  hasta (−2.2, 0.6), detrás de la mesa pintada → `stageCutouts()` da
  `fade → 0.45` en la mesa (mínimo) con el resto a 1; alejarse → `fade → 1`.
- Oclusión: `zStage(jugador) > z(recorte)` ⇒ el recorte se pinta después en
  el orden de drawables (screenshot `e2e-fade-detras-mesa.png`).

## Gotchas

- Sin bridge NO hay movimiento (el sim vive en el bridge) — arrancarlo
  siempre, aunque la fixture se cargue en local.
- El hook `__nefan` expone en DEV la unión de las claves base
  (`currentTile`/`tiles`/`frontier`…) y las de bench
  (`stageCutouts()/probeCollide()/state()` etc.) — el bloque DEV hace merge
  sobre el mismo objeto, no lo reemplaza.
- `keyboard.press` de Playwright puede no llegar a DevToolsInput; despachar
  el `KeyboardEvent` a `window` es fiable.
