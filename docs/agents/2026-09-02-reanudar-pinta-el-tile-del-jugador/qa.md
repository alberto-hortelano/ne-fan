# QA — Reanudar pinta el tile donde está el jugador (#390)

**Fecha**: 2026-09-02 · **Rama**: `fix/reanudar-pinta-el-tile-del-jugador` (`8844182` guion 60 ·
`5d67beb` controller · `096679d` orden del resume) sobre `main` = `b6b6314`. Árbol limpio antes y
después de cada medida (`git status` vacío; los negativos se revirtieron con `git checkout`).

**Contra qué se valida**: la petición literal de #390 —«tras Reanudar, el tile activo tiene su atlas
instalado y ninguna celda del tile del jugador queda en clay. Con guion que se ponga rojo si vuelve»—
y los criterios A1-A6 de `requisitos.md`. Cero créditos en toda la sesión (Maqueta 3D en el stack
real; motor falso en el banco). Ningún servidor ajeno tocado: todos los puertos del catálogo estaban
libres al empezar; solo `./start.sh --preset cliente-web`, `node qa/run.mjs` y `./start.sh --parar`
sobre lo propio.

## Criterio → veredicto

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **#390 (cierre)**: tras Reanudar el tile activo tiene su atlas y el tile del jugador no queda en clay | ✅ cumple | Stack real `cliente-web`, Miravanda / Acuarela luminosa / Maqueta 3D, partida `1788348903-679fc5`, recargar → `button[data-action="resume"]`: escena a los **641 ms**, `fps().textured ∋ "tile_0_0"` a los **826 ms** del clic; `fps().tiles[0] === "tile_0_0"` (el activo se añade primero, luego los 8 vecinos); **un solo** `POST /generate_surface_atlas` tras reanudar, `layout_key d9ef94cd…` (= el de `tile_0_0` en la partida nueva), `resolve_only: true`, 23 celdas → 16 descargas `/cache/surface/`; HUD `Atlas fps de tile_0_0: 16 superficies de la librería; faltan 7 por pintar (G o Imágenes…)`. Captura `qa/capturas/2026-09-02-390-qa/02-tras-reanudar.jpg` |
| **#390: guion que se ponga rojo si vuelve** | ✅ cumple | Guion 60 medido en negativo por QA (abajo): las DOS piezas tienen su rojo, y las dos juntas (`b6b6314` entero) también |
| **A1** partida nueva → recargar → Reanudar: el tile bajo el jugador recibe su atlas sin moverse; Maqueta 3D 0 pagos; Imagen IA el único POST que PINTA es el del activo | ✅ cumple | `node qa/run.mjs reanudar-pinta` → `1 en verde · 0 en rojo` (9,7 s). Imagen IA: `todo POST del atlas tras reanudar es del tile ACTIVO` ✔, `reanudar NO pintó nada (el contador de pago del atlas no se movió)` ✔; Maqueta 3D: `en todo el bloque el motor falso no anotó ningún pago de atlas` ✔. Stack real: ver fila 1 |
| **A2** guion rojo sobre `b6b6314`, verde con el arreglo, negativo en la cabecera con fecha y volcado | ✅ cumple | Re-medido por QA con `main.ts` y `fps-atlas.ts` de `b6b6314` en el árbol: `✘ Imagen IA · todo POST … posts:[{d9ef94cd…,cells:23},{39d73253…,cells:10}]`, `✘ Maqueta 3D · todo POST … resolve_only:true`, `✘ A4 … despues:{activeTile:"tile_0_0",textured:["tile_1_0"]}` → `0 en verde · 1 en rojo`. La cabecera del guion cita los tres negativos con fecha y volcado |
| **A3** la misma clave sigue pagándose una vez, y un guion lo afirma contando POST por tile | ⚠️ **no probado por el guion** (el código sí está intacto) | La guarda `pendingTiles`/`queuedTiles` no la toca el diff (`git diff b6b6314..HEAD -- fps-atlas.ts`: solo se borra `if (this.inFlight) return;`, se mueve `registerRefs` y cambian comentarios). Stack real: **1** POST en el arranque de la partida nueva. PERO el aserto `A3 · en el arranque ninguna celda se pidió dos veces` sigue **VERDE con la guarda anulada** (`if (false && this.pendingTiles.has(key))` → `1 en verde · 0 en rojo`): no puede ponerse rojo. Ver hallazgo 1 |
| **A4** cruzar a pie a un tile durante un run en vuelo no lo deja en clay | ✅ cumple (banco) · ⚠️ en vuelo no probado en el stack real | Banco: bloque A4 del guion 60 verde; con `if (this.inFlight) return;` repuesto a mano → `✘ A4 … despues:{activeTile:"tile_0_0",textured:["tile_1_0"]}` (rojo ÚNICAMENTE en A4, como declara el ingeniero). Stack real: cruce a pie de la frontera sur (`W` mantenida) → `currentTile` pasa a `tile_0_1` a los 634 ms y `textured ∋ tile_0_1` **4 ms** después, con su POST `resolve_only` (`ec973375…`, 4 celdas) y HUD `Atlas fps de tile_0_1 instalado (0 página(s) nuevas, todo de la librería)`; captura `04-cruce-a-pie-al-vecino.jpg`. Pero el run del resume dura ~200 ms en este stack: **no se puede** cruzar con él en vuelo andando (ver No probado) |
| **A5** `verify` verde, `deuda` sin subir, batería completa verde (58 + el nuevo) | ✅ cumple | `npm run verify` → `tests 1908 · pass 1908 · fail 0 · exit 0`. `nefan-html`: `tsc --noEmit` OK, `eslint .` sin hallazgos, `wc -l src/main.ts` = **2321** (= `client-file-size.json`). Batería completa y `deuda`: ver abajo (§ Batería) |
| **A6** sobre `cliente-web` (asset-store real, cero créditos, Maqueta 3D) con el flujo literal de H2: HUD nombra `tile_0_0`, no hay clay en la taberna, captura | ✅ cumple | Fila 1. Antes de Comenzar se leyó el panel: `render: vector:rgb(221,170,102)` (marcado), `chars: vector` marcado, `#ts-style = acuarela_luminosa`; `sesion().renderMode === "vector"`; el HUD dev marca `gasto sesión 0,00 €` antes y después. Capturas `01-partida-nueva-maqueta-3d.jpg` / `02-tras-reanudar.jpg` / `03-reanudar-segunda-vez.jpg` |

**Crítica visual (director de arte)**: `01` y `02` son la **misma imagen**: mismo encuadre (`forward
{0,0,-1}` antes y después; posición `(0.25, 3.25)`), mismas tablas de la fachada, mismo tejado de
teja, mismo empedrado del camino, misma hierba, mismo tabernero en el vano. Luz única y coherente
(cielo azul, sin sombras contradictorias); escalas creíbles (puerta ~2 m, barril, tejado). Lo que
sigue gris son los dos rectángulos sobre las ventanas laterales (a los dos lados de la fachada) —
y están **igual de grises en la partida nueva**: son parte de las 7 celdas que la librería no tiene
para este estilo («faltan 7 por pintar»), no algo que el resume deje en clay. El criterio de #390
(«ninguna celda que la librería pueda vestir queda en clay») se cumple; el criterio literal de A6
(«no hay clay en la taberna») se cumple para paredes, tejado, suelo y camino, con esa salvedad.
Reanudar dos y tres veces seguidas en un navegador nuevo (sin ningún mapping local) da lo mismo:
951 ms y 685 ms, 1 POST cada vez, `tile_0_0` texturado, captura `03`.

## Negativos del guion 60 medidos por QA (2026-09-02)

| Sabotaje | Resultado | ¿Dice el defecto? |
|---|---|---|
| Solo `main.ts` de `b6b6314` (orden del resume revertido) | `✘ Imagen IA · todo POST … posts:[{d9ef94cd…(tile_0_0), cells:23},{39d73253…(tile_1_0), cells:10}]` y el mismo rojo en Maqueta 3D con `resolve_only:true` | Sí: el volcado enseña el POST del tile que NO es el activo |
| Solo `if (this.inFlight) return;` repuesto | Rojo únicamente en `A4 · cruzar a un tile mientras otro run está en vuelo no lo deja en clay — despues:{activeTile:"tile_0_0",textured:["tile_1_0"]}` | Sí: tile pisado, no texturado |
| Los dos ficheros de `b6b6314` | Los tres rojos anteriores a la vez | Sí |
| **`pendingTiles` anulado** (`if (false && …)`) — sabotaje que el ingeniero NO midió | **`1 en verde · 0 en rojo`**: `A3` ✔, «UN pago de atlas» ✔ | **No.** Ver hallazgo 1 |

Observación honesta sobre lo que el guion mide: sobre `b6b6314` el aserto `textured ∋ activeTile`
**no** se pone rojo en el banco (el falso contesta en milisegundos y el run equivocado acaba superado
por token; el `return` mudo que vio QA en T4 necesita que el run siga en vuelo cuando llega el
activo). El rojo del ORDEN es el `layout_key` del POST equivocado; el rojo del CONTROLLER es A4
(G + teletransporte en el mismo tick). El síntoma literal de H2 (clay tras Reanudar) solo lo mide a
mano la A6 en el stack real. El ingeniero lo declara en la cabecera; lo confirmo y lo dejo escrito
aquí porque es el límite de este candado.

## Hallazgos

### 1 · Importante — A3 no tiene candado: el aserto del guion 60 no puede ponerse rojo

- **Repro**: en `nefan-html/src/scene/fps-atlas.ts` cambiar `if (this.pendingTiles.has(key))` por
  `if (false && this.pendingTiles.has(key))` → `node qa/run.mjs reanudar-pinta` → **verde**
  (`A3 · en el arranque ninguna celda se pidió dos veces` ✔; `el motor falso anotó UN pago` ✔).
- **Por qué**: en el flujo del guion no hay segundo disparo de la misma clave que deduplicar. Hoy
  `onActiveTile` se dispara dos veces para la misma clave solo cuando se re-añade el tile YA activo
  (`carga-de-tile.ts:307` + `:145` vía `:361`, el re-broadcast/spawn), y eso no ocurre ni en la
  partida nueva ni en el resume del guion. El aserto cuenta celdas repetidas en un flujo donde no
  pueden repetirse: es un verde que no comprueba nada.
- **Qué esperaba el requisito**: «si el arquitecto quita o mueve el `inFlight`, el guion 59 o uno
  nuevo lo afirma contando POST por tile». El `inFlight` se quitó y la guarda que queda no tiene
  candado ejecutable. **No bloquea #390** (la guarda está intacta en el diff y el stack real hace
  1 POST en el arranque), pero A3 debe quedar como «sin candado» en la PR, o el aserto debe medir
  un flujo donde el doble disparo exista de verdad (re-broadcast del tile activo, o el retro-trigger
  de `applySessionReady` cuando la escena llega antes que el estilo), probado en negativo.

### 2 · Importante (colateral, fuera de #390) — el save no recoge el viaje por «Salidas» si el tile de destino se restaura del mapping local

Confirmo el hallazgo del ingeniero, con una corrección: no es «`active_scene_id` del destino y
posición del origen»; en lo que medí **los dos** se quedan en el origen.

- **Repro (banco, motor falso, Maqueta 3D)**: segunda partida en el MISMO navegador (mapping local
  `fps_atlas:*` ya persistido por una partida anterior) → «→ Molino del bench (road)» → el cliente
  llega a `tile_1_0` `(64, 7)` a los ~200 ms; el save en disco sigue **15 s después** en
  `{active: "tile_0_0", pos: [0.25, 0, 3.25]}` → recargar → Reanudar → el jugador aparece en
  **`tile_0_0` `(0.25, 3.25)`**, `fps().activeTile = tile_0_0`. Captura `07-banco-reanudar-tras-salidas-con-mapping-local.jpg`.
- **Control**: primera partida del mismo navegador (sin mapping local): el save pasa a
  `{active: "tile_1_0", pos: [64, 0, 7]}` a los 270 ms y Reanudar deja al jugador en `tile_1_0`.
  La diferencia es que sin mapping el atlas del destino va por `runFor` → `registerRefs` →
  `/scene/asset_refs` → mutación → save fresco; con «restaurado (mapping local)» no hay ninguna
  mutación después de llegar y **nada guarda**. Un jugador que viaja y cierra pierde el viaje.
- **Stack real**: no reproducible en `cliente-web` (viajar al Molino exige el motor; el cliente lo
  dice bien: «No se pudo llegar a Molino del bench. El motor narrativo no responde»). Con `play` y
  atlas completos en la librería se daría igual: la condición es «sin mutación tras el spawn».
- El guion 60 lo esquiva a propósito con `guardarConLaPosicionDelDestino` y lo declara. **Merece
  issue propio**; no lo abro yo.

### 3 · Menor — la librería real tiene 16 de 23 celdas de `tile_0_0` para Acuarela luminosa

Los dos bloques grises sobre las ventanas (capturas `01` y `02`) son celdas que la librería no tiene.
El HUD lo dice («faltan 7 por pintar (G o Imágenes…)») y es idéntico antes y después de reanudar,
así que no es de #390; se anota porque es lo que el jugador ve en Maqueta 3D en esta máquina.

### 4 · Menor — el mundo pre-generado de Miravanda en esta máquina es del banco

`nefan-core/data/games/alta_fantasia/world/tile.json` (gitignored, `generated_at 2026-08-22`) describe
«Claro de la taberna de bench en el plano continuo», «Campo de bench (0, 1)», salida «Molino del
bench». El flujo «real» de H2 juega ese mundo. No es del repo ni de #390; el usuario debe saber que
su Miravanda local la generó el motor falso.

### 5 · Menor — `./start.sh --parar` etiqueta `:9878` como AJENO

Al parar mi `cliente-web`: `96111 ⏭ :9878 (desconocido) — AJENO, no se toca`. Era la State API de
**mi** bridge (mismo proceso que `:9877`, que sí paró). El bridge murió igual y el banco arrancó
después en `:9878` sin problema, pero el rótulo es falso. No es de #390.

### 6 · Menor — un `404 (Not Found)` en consola por cada carga del cliente (stack real)

`Failed to load resource: 404` una vez por `goto`/`reload`; mi listener de respuestas no lo vio
como `/cache/surface/` ni como ruta del bridge (probablemente el favicon). Sin efecto medible.

## Workarounds usados durante la prueba (y veredicto)

| Workaround | Dónde | ¿Afecta al jugador? |
|---|---|---|
| `?raf=timer` en la URL | todas las medidas headless | No: sustituye el rAF que Chrome pausa en una pestaña invisible; la pestaña del jugador está visible. Necesidad del banco |
| Clics de Playwright en el título (`#ts-new`, `[data-game-id]`, `#ts-rendermode`, `#ts-continue`, `#ts-start`, `button[data-action="resume"]`) | stack real y banco | No: es el mismo DOM que pulsa el jugador. Se leyó el borde `#da6` de Maqueta 3D ANTES de Comenzar para no gastar |
| `setPlayerPos(0.25, 29.5)` + `setYaw(0)` antes del cruce a pie | fase A4 del stack real | Parcial: el claro de la taberna encajona al jugador en los cuatro rumbos sin ratón (probado: bloqueado a 6,8 m N, 4,1 m E, 5,6 m O, 1,9 m S). El cruce en sí fue a pie (`W`) y la activación es por posición (mismo código). El jugador con ratón sale del claro; **no afecta a la medida** del cruce, y no se usó para nada del resume |
| `setPlayerPos(0.25, 3.25)` para volver a `tile_0_0` | fase «viaje» del stack real | Solo para recuperar el estado tras la fase anterior; el viaje falló por falta de motor, así que no midió nada |
| Del propio guion 60: retirar `fps_atlas:*` antes de reanudar | banco | Justificado: es la precondición de la rama con el defecto (el jugador de H2 no tenía mapping porque un atlas parcial no se persiste); el guion lo explica en cabecera |
| Del guion 60: guardado forzado por State API tras «Salidas» | banco | Justificado y declarado: esquiva el hallazgo 2, que está reportado aparte |
| Del guion 60: `G` + `setPlayerPos` en el mismo tick (A4) | banco | Justificado: es la única forma determinista de tener un run en vuelo con un falso que contesta en ms; se puso rojo con el `inFlight` repuesto. El equivalente del jugador es cruzar a pie durante una instalación lenta, que en el stack real no pude provocar (No probado) |

## No probado

- **Gasto real en Imagen IA**: cero créditos por regla; el «único POST que PINTA es el del activo»
  solo se midió contra el motor falso (guion 60, bloque 1).
- **A4 con run en vuelo en el stack real**: el run del resume tardó ~200 ms (641 → 826 ms); a pie es
  inalcanzable. El ingeniero midió 11,7 s en su A6 (cachés frías); no reproduje esa lentitud.
- **A3 como regresión**: el guion no puede detectarla (hallazgo 1). Solo lectura del diff y 1 POST
  en el arranque del stack real.
- **Salidas en el stack real** (`cliente-web` no lleva motor): el hallazgo 2 se midió en el banco.
- **Mutación**: el diff no toca `nefan-core/src`; nada que medir.

## Batería completa y deuda (A5)

```
$ node qa/run.mjs
59 en verde · 0 en rojo de 59 · capturas en qa/capturas/2026-09-02T11-44-58-172Z-105036   (exit 0; ningún ⊘)
$ cd nefan-core && npm run deuda
Deuda medida — 75 items.   (75 antes del diff según implementacion.md; el diff no toca nefan-core/src)
```

Nota de honestidad que la PR debe llevar: el CI no corre `qa/`; estas cifras son de esta máquina.

## Veredicto

**Apto con reservas.** El arreglo de #390 es real y está medido donde el jugador lo ve: tras
Reanudar, `tile_0_0` recibe su atlas en menos de un segundo con un único POST (el suyo), el HUD lo
nombra y la taberna es la misma que antes de recargar; el guion 60 se pone rojo con cada pieza del
arreglo revertida y con las dos juntas. Las reservas: (1) el aserto A3 del guion es un verde sin
dientes —la PR no debe presentarlo como candado del doble disparo—; (2) el hallazgo colateral del
save tras «Salidas» es real, reproducible y peor de lo descrito (no se guarda nada del viaje), y
necesita issue propio antes de que alguien lo pise en una partida con arte completo.
