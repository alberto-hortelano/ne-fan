---
name: final-check
description: Comprobación final crítica de la tarea en curso contra la petición ORIGINAL del usuario — criterios de aceptación literales, verificación en el flujo real desde el arranque, regla del workaround y pasada adversarial. Lanzar manualmente antes de dar una tarea por terminada.
---

# /final-check — Comprobación final crítica

Verificar que se cumple **lo que se pidió**, no que funciona lo que se construyó. Complementa (no sustituye) los tests: los tests prueban el mecanismo; esto prueba el objetivo.

**Ámbito**: la tarea en curso de esta conversación. Si se invoca en frío (sin tarea en el contexto), reconstruir el objetivo desde el diff pendiente (`git status`/`git diff`) y los últimos commits, y decir explícitamente qué petición se está usando como referencia.

## Pasos (todos, en orden)

1. **Recuperar la petición ORIGINAL literal** del usuario (el mensaje que definió la tarea, no el plan propio ni el resumen). Citarla. Convertirla en una lista de criterios de aceptación literales. Los requisitos absolutos ("siempre", "en todo momento", "cualquier", "cada vez que") NO se dan por cubiertos con un caso: se expanden a estados concretos.

2. **Enumerar los estados del sistema** donde aplica cada criterio antes de probar nada. Para el cliente 2D, como mínimo: arranque con título abierto, partida en curso, diálogo abierto, overlays (`scene-fade`, `narrative-loader`, `history-browser` [H], `error-log`), modo fixture vs sesión de bridge, vista oblicua vs proscenio, `render_mode` vector vs image, servicios caídos (preset 4 arranca sin ai_server a propósito). Para Godot: arranque offline, con bridge, headless.

3. **Verificar en el flujo REAL del usuario, empezando donde empieza él**: `./start.sh` (o el preset relevante), el título, el camino normal. Nunca un escenario preparado para que la prueba pase. Herramientas reales: navegador para el cliente 2D (pestaña visible o `?raf=timer`; driver `?input=scripted` + `window.__nefan`), remote control :9876 para Godot, `movement_test.py` para lo visual 3D.

4. **Regla del workaround**: si durante la prueba hay que ocultar, forzar o stubear algo para poder observar la feature (un `display:none` a un overlay, estado sintético, saltarse una pantalla), el usuario tendrá ese mismo obstáculo delante. Es un HALLAZGO que arreglar o reportar — jamás un paso de la receta de captura. Anotar cada workaround usado y justificar por qué no afecta al usuario, o tratarlo como fallo.

5. **Pasada adversarial**: para cada criterio, preguntar "¿en qué situación NO se cumple?" y probar las 2–3 situaciones más probables. Buscar falsificar, no confirmar.

6. **Evaluar las capturas como director de arte y como usuario** (integración, legibilidad, qué tapa a qué), no como checklist técnico de "renderiza".

## Reporte final

Tabla criterio → veredicto (✅ cumple / ❌ NO cumple / ⚠️ no probado) con evidencia concreta (captura, valor leído, comando). Los hallazgos encontrados y si se arreglaron en el momento. Lo que no se pudo probar (p. ej. gasto real de créditos) se declara explícitamente en vez de darse por bueno. Si todo pasa a la primera, sospechar del método antes que celebrarlo.

Referencias: sección "Comprobación final crítica (definición de hecho)" de CLAUDE.md; caso de origen: panel de dev "siempre visible" tapado por el title-screen justo en el flujo de crear mundo/estilo (2026-08-09).
