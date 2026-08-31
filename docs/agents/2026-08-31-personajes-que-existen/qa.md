# QA — Personajes que existen (#216 + #255)

Validado sobre `feature/personajes-que-existen` (`afc9595`, árbol limpio). Todas las medidas de
este documento las ejecuté yo, sin fiarme del informe del ingeniero; donde repito una medida suya
lo digo. Cero créditos en toda la validación (stack manual `e2e-sin-creditos` en
`NEFAN_PORT_OFFSET=100`, parado al acabar con `--parar`; batería con su propio bloque).

## Veredicto por criterio

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Ofrecer = tener el set completo; aquí solo `y_bot` | ✅ cumple | `curl :3100/sprites/index.json` → `paladin(1: idle)`, `y_bot(10)`, calca el disco (`ls public/sprites/*`). Flujo real desde `./start.sh`: título → Nueva partida → mundo → Continuar → el desplegable ofrece **exactamente «Y bot»**; paladin no aparece (capturas `qa/capturas/qa-manual-editor-modo-image-solo-ybot.png` y `-modo-vector.png`). Guion 47 verde en mi corrida de batería |
| 2 | `MIXAMO_MODELS` muere | ✅ cumple | `grep -rn 'MIXAMO_MODELS' nefan-html/` → 0 hits (exit 1), repetido por mí |
| 3 | `"pete"` muere | ✅ cumple | `grep -rn '"pete"' nefan-core/ nefan-html/ labs/` → 0 hits (exit 1), sin filtro de extensión (README de labs incluido). Defecto `""` con el porqué escrito (`narrative-state.ts:105-110`); la aserción del test se actualizó, no se borró (`narrative-state.test.ts:179`) |
| 4 | Candado ejecutable, probado en negativo | ✅ cumple | Unit test 8/8 (corrido por mí); en negativo `every`→`some` → 2 rojos, revertido. Guion 47: verde en batería; **en negativo por MI vía** (mutación de `modelosCompletos` en core + corrida real `node qa/run.mjs 47-`): `✘ cada opción … COMPLETA según el censo — ofrece ["__qa_incompleto","paladin","y_bot"]` y `✘ …NO lo ofrece — ofrecido: true` → `1 en rojo de 1`. Revertido (árbol limpio verificado). El negativo del ingeniero fue por la otra dirección (completar el sembrado); entre los dos, el candado detecta la lista a mano resucitada Y el walk mentiroso |
| 5 | Modo image decidido, no callado | ✅ cumple (sin candado — H2) | Decisión escrita en el plan; verificada en vivo: en `character_mode: image` el desplegable se queda con la nota `data-motivo="image"` («El skin IA se genera sobre y_bot; este modelo es el que ves mientras el skin no llega o si falla»); en vector, sin nota. Capturas citadas arriba |
| 6 | La derivación falla con canal | ✅ cumple | Tres estados probados en vivo: **500** → nota «No se pudo leer el censo de modelos (HTTP 500) — se usará la base y_bot» + entrada `title` en el registro + Comenzar sigue; **JSON válido sin `models`** (adversarial d) → NO revienta: el TypeError cae en el mismo catch, nota + registro (`qa-manual-editor-censo-corrupto.png`, ver H3); **clon limpio real** (`public/sprites/` apartado y restaurado) → censo `{models:[]}`, nota `data-motivo="vacio"` con el remedio y la ruta del doc, Comenzar sigue (`qa-manual-editor-clon-limpio-0-modelos.png`, ver H1). El registro retiene las entradas: en partida vi mis dos errores fabricados en el error-log. Fase 2 del guion 47 canda el caso 500 |
| 7 | #255 verificado y cerrado honesto | ✅ cumple lo verificable / ⚠️ cierre pendiente | Guion 27 verde a HEAD en MI corrida de batería. Los tres commits verificados por mí: `006f4f8` (docs/assets-de-personaje.md + README), `376dbaa` (FALLO_HOJAS_BASE + status-labels + title-screen, PR #277), `fb17840` (PR #281). Cero código nuevo para #255. Ambos issues siguen `open` — el comentario de cierre y la PR con `Closes` son del coordinador, no de esta rama |
| 8 | verify + batería + deuda + PR | ✅ cumple lo local / ⚠️ PR pendiente | `npm run verify` → **1685/1685** (corrido por mí). Batería **`node qa/run.mjs` → 46 en verde · 0 en rojo de 46**, exit 0 (mi corrida; capturas `qa/capturas/2026-08-31T16-35-11-120Z-284496`). Deuda: no repetí `npm run deuda` (medida cara); revisé el alta en `mutation-targets.json` — `break: 0` con el motivo escrito y la promesa de subir al score medido. No hay PR todavía: `Closes #216`/`Closes #255` y el CI quedan para el coordinador |

## Juicio de las tres desviaciones

1. **Mutación de `sprite-census` pedida, no medida (`break: 0`)** — CORRECTA. `mutate.ts` rechaza
   módulos sin corrida previa; inventarse un suelo sería peor. El «porque» del JSON deja escrita la
   obligación de subirlo al score cuando llegue el informe. La prueba en negativo del unit test
   (que yo repetí) cubre hoy lo que la medida cubrirá mañana. `reports/mutation/` intacto en el diff.
2. **`portrait.ts` unificado a `HOJAS_ANGLE`** — CORRECTA y verificada en el flujo real: partida
   arrancada, diálogo con el Tabernero, el busto y_bot se pinta en el panel (canvas 192×192,
   encuadre correcto), cero entradas de error de portrait/sheet
   (`qa-manual-dialogo-retrato.png`). Dejar el literal habría conservado justo la copia divergente
   que la tanda mata. Ver H4: el retrato sigue sin candado (ya era así antes).
3. **Guiones 27 y 29 dejan pasar `/sprites/index.json`** — CORRECTA Y MÍNIMA, y lo comprobé
   adversarialmente: (a) la excepción va ANTES de `corte.peticiones++`, así que el censo NO puede
   satisfacer la precondición «se pidió una hoja» — el guion no puede quedar verde sin clon que
   medir; (b) el matcher es pathname EXACTO (ninguna hoja vive en esa ruta — son
   `/sprites/{model}/{anim}/{angle}/…`); (c) los asertos del 27 sobre el aviso y el remedio no
   cambiaron y son independientes del censo: **el 27 NO puede quedar verde con el mensaje roto**
   (si `motivoDeSesionParaElJugador` regresara a «servidor con hipo», sus dos asertos de texto se
   ponen rojos igual que el 25-08); (d) en el clon real el censo también contesta (lo sirve vite),
   así que el guion sigue representando al clon. Lo que la desviación SÍ deja atrás es el hueco H1.

## Hallazgos

1. **H1 (importante-bajo) — el estado «censo OK, 0 modelos» del editor no tiene candado.** En el
   clon limpio real el editor pasa por la nota `data-motivo="vacio"`, pero en esta máquina ningún
   guion lo recorre: el 27 ahora ve el censo real (y_bot completo → select) y el 47 solo mide
   censo-completo y censo-500. Verificado únicamente a mano (captura
   `qa-manual-editor-clon-limpio-0-modelos.png`). Receta: fase extra del guion 47 con
   `route('**/sprites/index.json')` → `{required, models: []}` y aserto de la nota `vacio` + que
   `#ts-start` sigue. Es mecánico y hoy solo lo sujeta mi ojo.
2. **H2 (menor) — la nota del modo image (criterio 5) sin aserto**, declarado por el ingeniero.
   Verificada a mano. El propio ingeniero ofrece el `expect` de dos líneas en fase 1 con
   `charMode: "image"`; que lo añada él (los hallazgos vuelven al mismo ingeniero).
3. **H3 (menor) — la forma corrupta degrada bien pero habla en JS al jugador.** Con JSON válido
   sin `models`, la nota dice «No se pudo leer el censo de modelos (Cannot read properties of
   undefined (reading 'filter')) — se usará la base y_bot». Cumple el criterio 6 (canal + degrada
   diciéndolo), pero el motivo es jerga. Un guard de forma (`Array.isArray(censo.models)`) daría un
   motivo legible («respuesta sin modelos»). No bloquea.
4. **H4 (informativo) — el retrato no tiene candado en ningún guion** (`grep portrait qa/guiones/`
   → 0). Ya era así antes de la tanda; lo anoto porque la desviación 2 lo tocó y hoy solo lo cubre
   verificación manual.
5. **H5 (informativo) — la protección de doble click de «Continuar» no la pude observar** (el
   censo local responde en ms y la carrera me ganó); por lectura, el handler deshabilita síncrono
   antes del `paso`. Sin evidencia en contra, no probado en vivo.

Observación de dirección de arte (no hallazgo): las tres notas usan el ámbar apagado y la mono del
tema — se leen como ayuda contextual, no como error pegado; la del clon limpio es accionable (nombra
sprite-forge y la ruta del doc). El label «Modelo base (con hojas completas en disco)» es honesto
aunque «en disco» sea algo técnico; consistente con el tono dev del editor actual.

## Workarounds usados durante la prueba (y su veredicto)

- `page.route()` para el 500 y el JSON corrupto: simulación de red estándar (la misma técnica del
  guion 47). No oculta nada que el jugador fuera a tener delante.
- `mv public/sprites{,.__qa_apartado}` + restauración inmediata para el clon limpio: es EL estado
  real de fábrica de un clon; restaurado y verificado (`ls` + censo de nuevo con 2 modelos).
- `setPlayerPos` + `KeyboardEvent` sintético para llegar al NPC: el input scriptado documentado del
  proyecto. Ninguno de los tres es un obstáculo que el jugador tendría y yo esquivara.

## No probado (declarado, no aprobado)

- **Resume de un save con `model_id` de un modelo muerto**: los 8 saves del disco llevan `y_bot`
  (medido) — no fabriqué uno. Cobertura: `setPlayerAppearance` no cambió, el guion 21 canda el
  fallback a base, y pre-producción declara los saves viejos irrelevantes. Sí probé resume normal:
  partida reanudada a `tile_0_0` sin errores (`qa-manual-resume-save.png`).
- **`npm run deuda` y `npm run crap`**: no repetidos (caros); acepto la medida del ingeniero tras
  revisar el diff de `mutation-targets.json`.
- **La medida de mutación de `sprite-census`**: pedida, llegará con dueño; el `break` debe subir
  entonces (obligación ya escrita en el JSON).
- **CI de la PR**: no existe PR aún.

## Veredicto

**APTO.** Los 8 criterios se cumplen en lo que esta rama puede cumplir; lo pendiente (comentario de
cierre en #255, PR con `Closes`, CI) es del coordinador y está declarado, no escondido. Los
hallazgos son de cobertura y de textura de mensaje, ninguno de comportamiento: H1 y H2 son un
`route` y un `expect` en el guion 47 para el mismo ingeniero; H3 una línea de guard si se quiere.

## Resumen para el coordinador (10 líneas)

1. APTO. Criterios 1–6 verificados por mí en el flujo real; 7 y 8 cumplen lo local, cierre/PR/CI pendientes de ti.
2. Batería re-corrida por QA: 46/46 verde, exit 0; verify 1685/1685; los dos greps a 0; unit test 8/8.
3. Desplegable visto con mis ojos: solo «Y bot» (capturas en qa/capturas/qa-manual-*); censo por curl calca el disco.
4. Candado del criterio 4 probado en negativo por una vía nueva (mutar `modelosCompletos` + corrida real del 47): 2 asertos rojos exactos, revertido.
5. Criterio 6 probado en TRES fallos: 500, JSON sin `models` (no revienta — mismo catch) y clon limpio real; los tres degradan diciéndolo.
6. Desviación 3 (guiones 27/29): correcta — el censo no puede satisfacer la precondición del 27 y sus asertos de mensaje siguen pudiendo ponerse rojos.
7. Desviaciones 1 (mutación pedida, break 0 con motivo) y 2 (portrait unificado, retrato verificado en partida): aceptadas.
8. H1 (importante-bajo): el estado «0 modelos» del editor quedó sin candado — solo mi ojo lo vio; receta concreta en el hallazgo, para el ingeniero.
9. H2/H3 menores (aserto de la nota image; motivo en jerga JS con censo corrupto); H4/H5 informativos.
10. #255: guion 27 verde a HEAD y los 3 commits verificados — el comentario de cierre puede citar `006f4f8`/`376dbaa`/`fb17840` tal cual.
