# Requisitos — tanda AS: generar arte nuevo es CONFIGURACIÓN (desarrollo: no; producción: sí)

## Petición literal del usuario

> «Sube node a latest, mientras estemos en desarrollo no fijamos version. Mutacion lanzada, sigue con la siguiente tanda. Los assets ya pagados o no es algo que tenemos que sacar del codigo, debe ser configuracion y no volver a generar por defecto mientras estemos en desarrollo, no queremos que recargas automaticas y pruebas gasten creditos pero cuando estemos en prod si.» (2026-09-24)

Esta tanda cubre la última frase. Responde a la duda de #714 (PR #732): allí se tomó sin él la vía «los tiles vecinos solo restauran el atlas ya pagado, nunca generan», cableada en `nefan-core/src/scene/politica-de-atlas.ts` como carril de restauración con `modoDeCorrida`. El usuario dice que **esa decisión no va en el código**: es configuración.

## Lo que se pide (interpretación del coordinador; el crítico debe validarla)

- Una configuración, con UNA fuente de verdad, que decida si los caminos AUTOMÁTICOS pueden **pagar arte nuevo** o solo reusar lo ya pagado.
- Defecto en **desarrollo**: no se genera. Las recargas automáticas, reanudar un mundo, los tiles vecinos, los guiones y las pruebas **no gastan créditos**: se restaura lo pagado y lo que falte se queda en clay.
- En **producción**: sí se genera.
- `politica-de-atlas` deja de decidir «vecino = solo restaurar» por sí misma y consulta la configuración. Con la configuración en «generar», los vecinos también pueden generar si esa es la política de producción; el crítico y el arquitecto lo concretan.

## Preguntas que el crítico debe contestar con el código delante

1. **Qué caminos pagan arte hoy, y cuáles son automáticos y cuáles una acción deliberada.** Automáticos: atlas del tile activo al cargar o reanudar, vecinos, skins o sprites de NPC vía sprite-forge… Deliberados: la tecla G, subir un estilo con confirmación de coste, `build_style_pack`. Censo por el código, no de memoria.
2. **Cómo encaja con lo que ya hay.** Existe el modo gráfico «Imagen IA» (`nefan-html/src/ui/graphics-mode.ts`, `mode-labels.ts`), que se congela en el título y en el save, y existe el preset `e2e-sin-creditos` con motor falso. ¿La configuración nueva sustituye a alguno, se compone con ellos o sobra alguno? Recuerda: cero compatibilidad hacia atrás y un solo camino. Si «Imagen IA» ya es el interruptor de gasto, ¿la configuración es su defecto o su techo?
3. **Dónde vive la configuración.** `nefan-core/src/config.ts` y `runtime_config.json`, variable de entorno, etc. Cómo sabe cada proceso (cliente, bridge, ai_server, remote-gen, sprite-forge) si está en desarrollo o en producción, y cuál es el que debe **cortar** el gasto: el que paga, o el que pide. Que no haya dos fuentes.
4. **Relación con #729 y #730** (abiertos, del mismo carril de atlas). ¿Entran, se simplifican o desaparecen?

## Criterios de aceptación (provisionales; el crítico los reescribe si hace falta)

1. Una sola configuración decide «generar arte nuevo: sí/no». En desarrollo vale «no» por defecto, y el defecto de desarrollo es el que sale sin tocar nada.
2. En desarrollo, ningún camino automático llama a un endpoint que gasta. Hay candado ejecutable y probado en negativo, no prosa.
3. Con la configuración en «sí», se genera como en producción. Se demuestra con el motor falso, **nunca gastando**.
4. `politica-de-atlas` no cablea la política: la lee.

## Restricciones

Cero créditos: motor falso y `e2e-sin-creditos`. Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Sesión autónoma: si una duda no cambia QUÉ se construye, se sigue con la suposición por defecto y se apunta.

## Criterios reescritos tras la crítica

Vía elegida por el coordinador: **A · Techo** (la configuración limita a «Imagen IA», no la sustituye). La vía B se le ofrece al usuario aparte. Estos seis criterios sustituyen a los provisionales de arriba.

> **Problema**: con un save en Imagen IA, reanudar, viajar o materializar NPCs paga el arte que falte sin que nadie lo pida, y la regla «el vecino nunca pinta» está en código. Las partidas nuevas (`MODO_AL_EMPEZAR`) y el banco (#295) ya no gastan y quedan fuera.

1. Una sola fuente de verdad para «los caminos automáticos pueden pagar arte nuevo: sí/no». Sin tocar nada vale «no». Se puede poner a «sí» por stack sin editar código.
2. Con «no», ningún camino automático llama a una ruta de pago: ni el atlas del activo, ni vecinos, ni prefetch, ni skins. Lo pagado se restaura, también los skins (hoy no existe carril de restauración de skins, y hay que construirlo). Candado probado en negativo contra los contadores `dePago` del motor falso.
3. Con «no», las vías deliberadas siguen pagando: G y menú dev, aplicar estilo, subir estilo con `/complete`.
4. Con «sí», el activo y los vecinos generan con Imagen IA encendida. Se demuestra en `e2e-sin-creditos`. Los guiones que miden pintar (59, 88, 114, 160) siguen poniéndose rojos si no se pinta.
5. Un save en Imagen IA ARRANCA con «no»: nada lanza, y el chip y el registro dicen que la generación está apagada por configuración.
6. `modoDeCorrida` no cablea la política: la recibe como dato.
