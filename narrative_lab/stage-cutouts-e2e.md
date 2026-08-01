# E2E: recortes por segmentación del plató (proscenio) — sin créditos

Verifica el pipeline v3 completo (visión+SAM mockeados) con los 3 casos
críticos: un elemento RECOLOCADO por el modelo de imagen, un elemento
`missing` (declarado pero no pintado) y un `extra` inventado. Todo con el
fake-ai-server — cero créditos.

## Arranque

```bash
node narrative_lab/fake-ai-server.mjs &                                  # :18765
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
   RECOLOCADO +200 px, último expected missing, un `extra_0` inventado, y
   `floor.wall_base_px` para la calibración; las máscaras son rects SVG de
   `/fake/stage_mask`.

## Asserts (todos verificados en verde el 2026-08-02)

- `stageCutouts()` = 2 casados (mesa, barril recolocado con `footprintWorld`
  en su posición PINTADA x≈5.4-6.8, no la declarada x 3-4) + `extra_0`; el
  banco missing NO aparece.
- `probeCollide`: **true** en las posiciones pintadas (mesa (−2,1.8), barril
  (6.1,1.3), extra (0,0.4)); **false** en la posición DECLARADA del barril
  (3.5,−1) y en la del banco missing (−4.25,2.25) — la colisión derivada
  SUSTITUYE a la declarada; **false** dentro de ambas zonas de salida.
- Fade: conducir al jugador (driver scripted, rodeando por el ESTE — el
  camino directo lo bloquea el extra pintado, que es en sí una verificación)
  hasta (−2.2, 0.6), detrás de la mesa pintada → `stageCutouts()` da
  `fade → 0.45` en la mesa (mínimo) con el resto a 1; alejarse → `fade → 1`.
- Oclusión: `zStage(jugador) > z(recorte)` ⇒ el recorte se pinta después en
  el orden de drawables (screenshot `e2e-fade-detras-mesa.png`).

## Gotchas

- Sin bridge NO hay movimiento (el sim vive en el bridge) — arrancarlo
  siempre, aunque la fixture se cargue en local.
- El hook `__nefan` del modo DEV no expone `currentTile`/`tiles`; usar
  `stageCutouts()/probeCollide()/state()`.
- `keyboard.press` de Playwright puede no llegar a DevToolsInput; despachar
  el `KeyboardEvent` a `window` es fiable.
