# Crítica — Reanudar pinta el tile donde está el jugador (#390)

**Veredicto: VIGENTE** (con cuatro correcciones de premisa que ACHICAN el guion y AGRANDAN el daño).

## El problema real, en una frase

`FpsAtlasController.onActiveTile` descarta en silencio cualquier tile activo que llegue con OTRO run en vuelo
(`nefan-html/src/scene/fps-atlas.ts:106`), y el resume garantiza ese solape porque activa el primer tile
que añade y no el del save (`carga-de-tile.ts:255,361`; `main.ts:2243-2251`). La solución propuesta ataca
las dos piezas: correcta.

## La premisa, afirmación por afirmación

| Afirmación de `requisitos.md` | Verificación |
|---|---|
| `session.enter` aplica `style` SÍNCRONO antes de los tiles | **Cierto.** `session-facets.ts:208-211` recorre los sinks en un `for` síncrono; `main.ts:286,345-346` → `setStyle`. El `enter` de `main.ts:2216` precede al bucle de `addTile`. No es el caso «en espera del estilo». |
| `inFlight` nace en `bd30797` y en la línea 103 | **Falso en lo accesorio.** Está en la **106**; el campo nace en `59a7957` y el `if (this.inFlight) return;` de `onActiveTile` en **`930a777`** («guarda anti doble-pago con un run en vuelo»: retro/addTile/setActiveClientTile solapados). `bd30797`, el mismo día, añadió `pendingTiles`/`queuedTiles`, que es lo que hoy cubre esa razón. No queda ninguna razón viva para el `inFlight` en `onActiveTile` distinta del doble disparo de la MISMA clave. |
| El `token` desecharía limpio un run superado | **A medias.** `fps-atlas.ts:186,212` cortan ANTES de `apply`, `cache.set`, `persistMapping` y `registerRefs`. El arte pagado no se pierde (vive en la librería del server y el siguiente `resolve_only` lo trae a $0), pero sus hashes **no entran en la keep-list del prune** (`registerRefs` → `/scene/asset_refs`, `services/asset-store/prune.ts:1-7`). El `finally` (`:240`) es correcto: el run nuevo pone `inFlight` y lo baja el suyo. |
| Los pasos 2-5 del mecanismo | **Ciertos**, con una corrección de sujeto: el tile que roba el run no es «el vecino visitado», es **la primera escena no activa de `scenes_loaded`** en orden de inserción. |
| «La partida nueva no lo sufre: llega un solo tile»; «el guion necesita ida por Salidas para tener dos tiles» | **Falso, y cambia el guion.** `start_session` con snapshot (`bridge/handlers/session.ts:457-468`, `replayWorldSnapshot`) registra **las 9 escenas** de `data/games/alta_fantasia/world/tile.json` en `scenes_loaded` (8 con `activate:false`). El cliente pinta una, pero el **save ya tiene nueve**. Por eso QA lo vio sin moverse. El bench hace HIT igual: `qa/run.mjs:498` copia `data/games` entero, el `world_doc_hash` casa (sha256 de `world.md` = `916b3059…`) y `limpiarMundos` solo borra el snapshot con `aisla:["mundo"]`. **Nueva partida → recargar → Reanudar basta**; el viaje del 49 no hace falta. |
| «Es previo a T4 por construcción» | **Basta.** `git diff b41b6e9 b6b6314` sobre `fps-atlas.ts`, `carga-de-tile.ts`, `main.ts` y `session.ts` = 3 líneas de `sprite_hash` en `main.ts`, nada del camino. Y A2 exige el guion rojo sobre `b6b6314`, que es la repro que vale. La fecha real: el defecto del controller existe desde `930a777` (14-ago) para quien cruzaba fronteras; **desde `e541dc2` (18-ago, snapshot) lo sufre TODA partida nueva de un juego pre-generado al reanudar.** |
| El defecto solo deja clay | **Menor de lo que es.** Con `render_mode` = Imagen IA, `generationOn()` (`main.ts:337`) es true y el resume hace `runFor(<primer no activo>, {resolveOnly:false})`: **paga las celdas que falten de un tile que el jugador no está mirando** y deja en clay el que sí mira. QA lo midió en Maqueta 3D ($0); en Imagen IA el bug gasta. |

## El día después

- **Para quien juega**: Reanudar enseña el arte que dejó, y en Imagen IA deja de pagar el tile equivocado.
- **Se cierra una puerta que hay que cerrar a propósito**: si el arreglo es SOLO «último gana vía token»,
  el resume sigue disparando el POST del primer no-activo y lo tira (en Imagen IA: paga y descarta sin
  keep-list). El punto 2 del alcance (activar el tile del save) no es cosmético: es lo que evita el
  disparo. **No debería aceptarse un arreglo del controller sin el del orden del resume.**
- **Lo que se puede tirar**: el comentario de `main.ts:2237-2239` («si es legacy») y el `inFlight` de
  `onActiveTile:106` si `pendingTiles` ya cubre su razón. `running` (`:76`) sigue teniendo lector (G / panel).
- **Lo que parecerá arbitrario en un mes**: si el resume añade 9 tiles y solo activa uno, alguien
  preguntará por qué no se pre-resuelven los otros ocho. Respuesta hoy: fuera de alcance, escrito.

## Conflictos

- **`client-file-size.json`** congela `src/main.ts` en **2323 exactas** (`eslint max-lines` + test que impide
  envejecer). El arreglo de `main.ts:2243-2251` **no puede añadir una línea neta**: o resta, o la política
  sale del fichero. Restricción real que `requisitos.md` no nombra.
- **#346/#359**: title-screen y barrel del core; no tocan este camino. **#358** cerrada. Sin solape.
- **T5 (#335/#238/#264)**: motor/terrain/`formatDToWorld`; disjunto de `fps-atlas`/`carga-de-tile`.
- **#241**: si nace módulo puro en core, entra medido (punto 4 ya lo dice). Si el arreglo queda en
  `nefan-html`, el único candado es el guion — es la deuda que #241 describe, no una nueva.
- **`arch-rules.json`** `html-sin-void-sin-catch` (max 7, cuatro son los `void fpsAtlasController…catch`) y
  `html-sin-catch-silencioso` (max 4): un `void` nuevo sin canal o un `catch {}` lo ponen rojo. Cabe.

## Coste contra valor

Barato (dos ficheros del cliente, quizá uno de core) contra el ÚNICO hallazgo visible por el jugador de la
serie y un gasto real en Imagen IA. «No hacer nada» = cada resume de un mundo pre-generado arranca en clay
y, con imagen, paga el vecino. Se hace.

## Qué le cambiaría a `requisitos.md` (para pegar)

1. En «Premisas», sustituir la fila de `fps-atlas.ts:103`/`bd30797` por: «`fps-atlas.ts:106` — `if (this.inFlight) return;`
   nace en `930a777` (14-ago, anti doble-pago con run en vuelo); `bd30797` añadió `pendingTiles`/`queuedTiles`
   ese mismo día, que hoy cubren esa razón para la misma clave».
2. Sustituir «Por qué la partida nueva no lo sufre» por: «El save de una partida nueva de un juego con
   snapshot ya lleva 9 tiles (`replayWorldSnapshot`, `session.ts:493-500`); el cliente pinta uno. Al reanudar,
   el primer no-activo de `scenes_loaded` roba el run. En Imagen IA ese run PAGA celdas del tile equivocado».
3. Punto 3 del alcance: «save con dos tiles» → «nueva partida (snapshot HIT en el bench: 9 tiles) → recargar →
   `button[data-action="resume"]` (patrón del 48) → afirmar `__nefan.fps().textured` contiene `activeTile`
   (`fps-gl.ts:92,1599`, estado del renderer, no del log), que hubo descargas `/cache/surface/` tras reanudar,
   y que el HUD nombra el tile activo. El POST no lleva la clave del tile: correlar por `scene_description`
   si se quiere, pero `textured` es la evidencia. Ida por «Salidas»: no requerida». Precondición: la librería
   del falso con celdas (partida en Imagen IA antes, como el bloque 2 del 59), si no todo es clay legítimo.
4. Alcance punto 2 pasa de «también» a **obligatorio y primero**: sin él, el resume sigue disparando (y en
   Imagen IA pagando) el tile equivocado aunque el controller ya no lo descarte.
5. Restricción nueva: «`main.ts` está congelado en 2323 líneas exactas (`client-file-size.json`): el cambio
   del resume no suma líneas netas o saca la política del fichero».
6. A1: añadir «y en Imagen IA (motor falso) el único `POST` que PINTA es el del tile activo».
