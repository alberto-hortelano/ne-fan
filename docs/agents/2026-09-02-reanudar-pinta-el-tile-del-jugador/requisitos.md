# Requisitos — Reanudar pinta el tile donde está el jugador (#390)

**Fecha**: 2026-09-02 · **Coordinador**: sesión principal · **Issue**: #390 ·
**Base**: `main` = `b6b6314` (T4 mergeada).

## Petición del usuario (literal)

> «Mira #390 antes de T5, la mutacion tarda demasiado, la lanzare en un par de horas»

Contexto de la frase: al cerrar T4 el coordinador escribió «#390 es visible en partida y barato de
acotar: yo lo miraría antes [de T5]». El usuario lo confirma. «Mirar» aquí es **acotar y arreglar**
(#390 es el único hallazgo de QA de la serie que ve el jugador); T5 («El motor recupera el suelo»)
queda **detrás**, no dentro. La mutación NO se va a autorizar en este ciclo: si el diff fuerza corrida,
se pide y se sigue.

## El issue (#390, abierto por QA de T4, hallazgo H2)

Repro medida el 2026-09-02 con `cliente-web` y cero créditos: nueva partida Miravanda / Acuarela
luminosa en Maqueta 3D → el mundo se pinta con 16 celdas de la librería → recargar → **Reanudar** →
HUD: solo `Atlas fps de tile_-1_-1 instalado (0 páginas nuevas, todo de la librería)`.
`__nefan.fps().activeTile === "tile_0_0"` y `currentTile === "tile_0_0"`, pero hubo **un solo**
`POST /generate_surface_atlas` (el de `tile_-1_-1`) y la taberna donde está el jugador queda en **clay**.
QA esperó 18 s. Captura `qa/capturas/2026-09-02-T4-qa/02-tras-reanudar-tile-0-0-en-clay.jpg`.

Criterio de cierre del issue: tras Reanudar, el tile activo tiene su atlas instalado (HUD +
`POST /generate_surface_atlas` para él, o cache-hit) y ninguna celda del tile del jugador queda en
clay. **Con guion que se ponga rojo si vuelve.**

> Crítica (`critica.md`): **VIGENTE**. Correcciones incorporadas abajo el 2026-09-02.

## Premisas verificadas por el coordinador (contra `b6b6314`, 2026-09-02)

**Es previo a T4 — por construcción, no por repro en vivo.** Las dos piezas del mecanismo son
anteriores a #394 y a #387:

- `nefan-html/src/scene/fps-atlas.ts:106` — `if (this.inFlight) return;` dentro de `onActiveTile()`.
  Nace en `930a777` (14-ago, «guarda anti doble-pago con un run en vuelo»); `bd30797` añadió ese mismo
  día `pendingTiles`/`queuedTiles`, que hoy cubren esa razón para la MISMA clave. No queda razón viva
  para el `inFlight` en `onActiveTile` (verificado por el crítico).
- `nefan-html/src/world/carga-de-tile.ts:361` — `if (firstTile || !isGridTile || key === mundo.tileActivo) activarTile(key)`:
  **el primer tile que se añade queda activo**, sea cual sea. Nace en `5c41bbb` (T3-L1..L5, multi-tile).
- `nefan-html/src/main.ts:2241-2251` — el resume añade **primero los tiles no activos** y el activo
  el último («para quedar como activa si es legacy» — comentario falso: lo que activa es `firstTile`,
  y «legacy» ya no existe). También de `5c41bbb`.

**El mecanismo, paso a paso** (lectura del código; no medido en vivo por el coordinador):

1. `session.enter` aplica la faceta `style` → `applySessionStyle` → `fpsAtlasController.setStyle()`.
   El estilo está puesto ANTES de añadir tiles (así que no es el caso «en espera del estilo»).
2. Bucle del resume: `addTile(tile_-1_-1)` es el primero → `firstTile` → `activarTile("tile_-1_-1")`
   → `fpsAtlas.onActiveTile("tile_-1_-1")` → `runFor` arranca: `inFlight = true`, `POST
   /generate_surface_atlas` (resolve_only) y descarga de imágenes en vuelo.
3. `addTile(tile_0_0)` (el activo del save) → `key === mundo.tileActivo` es falso (el activo del
   cliente es `-1_-1`) → no dispara nada.
4. Tras el bucle, `setActiveClientTile(underResume.key)` → `activarTile("tile_0_0")` →
   `onActiveTile("tile_0_0")`: no está en `pendingTiles`, `reinstallIfCached` falla (nunca se instaló),
   hay estilo, **`this.inFlight` es true → `return` mudo**. El tile del jugador no se pide nunca.
   `queuedTiles` solo re-encola la MISMA clave, así que no lo rescata.
5. `-1_-1` termina, se instala (es lo que dice el HUD). `tile_0_0` queda en clay hasta que el jugador
   salga y vuelva a entrar en él (`setActiveClientTile` solo se llama al CAMBIAR de tile).

**Por qué la partida nueva no lo sufre y el resume sí** (corrección del crítico): el save de una partida
nueva de un juego con snapshot **ya lleva 9 tiles** (`replayWorldSnapshot`, `bridge/handlers/session.ts:457-500`,
8 con `activate:false`); el cliente pinta uno. Al reanudar, **la primera escena no activa de
`scenes_loaded`** roba el run — no hace falta haber visitado ningún vecino. Con `render_mode` Imagen IA,
`generationOn()` es true y ese run va con `resolveOnly:false`: **paga celdas del tile equivocado** y deja
en clay el que el jugador mira. QA lo midió en Maqueta 3D ($0); en Imagen IA el bug gasta.
El `token` de `runFor` desecha un run superado ANTES de `apply`/`cache`/`persistMapping`/`registerRefs`:
el arte pagado queda en la librería del server, pero sus hashes no entran en la keep-list del prune.

**No es solo el resume.** El mismo `return` descarta cualquier cambio de tile activo mientras hay un
run en vuelo: cruzar una frontera a pie durante la instalación del atlas del tile anterior deja el
nuevo en clay hasta salir y volver. El resume es la forma reproducible; el defecto es del controller.

**Lo que ya existe y contradice el descarte**: `runFor` lleva un `token` («el tile activo cambió en
vuelo») pensado para que el ÚLTIMO tile pedido gane y el run anterior se deseche. Para los disparos
automáticos ese token es letra muerta, porque el `inFlight` los corta antes. Solo la tecla G (que
llama `runFor` directo) lo ejerce. El comentario de `onActiveTile` («con un run en vuelo no relanza —
los disparadores del arranque se solapan») describe el doble disparo de la MISMA clave, que hoy ya
resuelve `pendingTiles` (guarda síncrona de `2026-08-14`, $0.15×2).

**Lo que hay para candar**: `nefan-html` **no tiene tests unitarios**; la batería `qa/` sí ve esto.
El motor falso sirve `/generate_surface_atlas` (resolve_only $0, no cuenta como pago) y
`/cache/surface/{hash}`; el guion 59 afirma que una partida nueva pinta desde la librería; el guion 49
ya produce un save con **dos tiles** (ida por «Salidas» al vecino) y reanuda dos veces; el guion 48
reanuda y comprueba lo que vuelve. El hook `__nefan.fps()` expone `activeTile`.

## Alcance

**Dentro**:

1. Que `onActiveTile(key)` con OTRO run en vuelo **no descarte** el tile activo. Quién gana (el último
   pedido supera al anterior vía `token`, o se encola y se sirve al terminar) lo decide el arquitecto;
   el requisito es que el tile donde está el jugador acabe con su atlas instalado sin que tenga que
   salir y volver, y que la MISMA clave siga sin pagarse dos veces (guarda de `pendingTiles`).
2. **Obligatorio y primero**: que el resume active el tile del save, no el primero que se añade. Sin esto,
   aunque el controller deje de descartar, el resume sigue disparando (y en Imagen IA pagando) el POST del
   tile equivocado. El comentario de `main.ts:2237-2239` («la escena activa se añade la última para quedar
   como activa si es legacy») es falso hoy y se reescribe o se borra con lo que se decida.
3. **Guion nuevo (o bloque en el 48/59) que nazca ROJO** sobre `b6b6314`: nueva partida (snapshot HIT en el
   bench: 9 tiles en el save) → recargar → Reanudar (`button[data-action="resume"]`, patrón del 48) → afirmar
   que `__nefan.fps().textured` (`fps-gl.ts:92,1599`, estado del renderer) contiene `activeTile`, que hubo
   descargas `/cache/surface/` tras reanudar y que el HUD nombra el tile activo. `activeTile === currentTile`
   **no basta** (QA los vio coincidir con el tile en clay). El POST no lleva la clave del tile: `textured` es
   la evidencia. Precondición: librería del falso con celdas (partida en Imagen IA antes, como el bloque 2
   del 59); si no, todo es clay legítimo. Ida por «Salidas»: no requerida. Negativo documentado en cabecera.
4. Si el arquitecto decide sacar la política de «qué tile se sirve» a un módulo puro, va a
   `nefan-core/src/` con test y entrada en `mutation-targets.json` medida (precedente: `entrada`,
   `mundo-persistido`). No es obligatorio: un arreglo local en `fps-atlas.ts` candado por el guion es
   aceptable si el arquitecto lo justifica.

**Fuera**: T5 (#335/#238/#264); repintar vecinos visibles desde la frontera (hoy solo se sirve el
activo, y eso no cambia); el 18 s de espera de QA (no es timeout, es abandono); #391-#393.

## Criterios de aceptación

- **A1** Con el stack `e2e-sin-creditos`: partida nueva, recargar, Reanudar → el tile bajo el jugador recibe
  su atlas sin moverse (`textured` lo contiene, HUD «Atlas fps de <tile activo>…»). En Maqueta 3D: 0 rutas
  de pago nuevas en el falso. En Imagen IA (motor falso): **el único `POST` que PINTA es el del tile activo**.
- **A2** El guion del punto 3 está **rojo sobre `b6b6314`** y verde con el arreglo; la cabecera cita
  el negativo con fecha y el volcado.
- **A3** El doble disparo de la MISMA clave sigue pagando una vez (no regresa `2026-08-14`): si el
  arquitecto quita o mueve el `inFlight`, el guion 59 o uno nuevo lo afirma contando `POST` por tile.
- **A4** Cruzar a pie a un tile durante un run en vuelo no deja el nuevo en clay (mismo mecanismo;
  basta que el arreglo sea del controller, no del resume, y que un test o guion lo diga).
- **A5** `npm run verify` verde, `deuda` sin subir, `node qa/run.mjs` completo verde (58 + el nuevo).
- **A6** Comprobación sobre `cliente-web` (asset-store real, cero créditos, Maqueta 3D) con el flujo
  literal de H2: tras Reanudar, el HUD nombra `tile_0_0` y no hay clay en la taberna. Captura en
  `qa/capturas/`.

## Restricciones (vigentes de la serie)

- **No cerrar servidores ajenos**: solo `./start.sh --preset <slug>` / `--parar` para lo propio; hay
  otros agentes en la máquina. Cero créditos en toda verificación.
- Español (España) con tildes. Commits con los trailers de la sesión. Rama + PR (es código).
- La PR lleva la **nota de honestidad**: el CI no corre `qa/`; las cifras de la batería son locales.
- **`main.ts` está congelado en 2323 líneas exactas** (`client-file-size.json` + `max-lines`): el cambio del
  resume no suma líneas netas o saca la política del fichero.
- Presupuestos de `arch-rules.json`: `html-sin-void-sin-catch` (max 7) y `html-sin-catch-silencioso` (max 4).
- `mutation-targets.json` solo se toca si nace módulo en core (y entonces se mide en local si cabe en
  `tope_local`, o se pide y se sigue). La mutación la lanza el usuario en un par de horas: no esperar.
- Al cerrar: `Closes #390` en la PR; comentar en el issue el veredicto «previo a T4» con la arqueología.
