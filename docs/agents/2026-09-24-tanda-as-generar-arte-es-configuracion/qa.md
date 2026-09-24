# QA — tanda AS: generar arte nuevo es configuración (vía A · Techo)

Worktree `/home/al/code/ne-fan-tanda-as`, rama `feature/tanda-as`, commit `55e8db9f` sobre `main 2766b686`. Node v26.10.0. **Cero créditos**: todo contra el motor falso (`e2e-sin-creditos`) o leyendo código; ningún stack real con Imagen IA. Probado el 2026-09-24.

Petición literal que se valida: *«Los assets ya pagados o no es algo que tenemos que sacar del codigo, debe ser configuracion y no volver a generar por defecto mientras estemos en desarrollo, no queremos que recargas automaticas y pruebas gasten creditos pero cuando estemos en prod si.»*

## Criterios (los seis reescritos tras la crítica)

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Una sola fuente para «los caminos automáticos pueden pagar arte nuevo». Sin tocar nada vale «no». Se cambia por stack sin editar código | ✅ cumple | Bridge arrancado a mano (`npx tsx bridge/ws-server.ts`, puertos 10577/10578): **sin variable** → `Bridge: entorno desarrollo — los caminos automáticos solo restauran lo ya pagado (NEFAN_ENTORNO=produccion para generar)`; **`NEFAN_ENTORNO=`** (vacía) → lo mismo; **`NEFAN_ENTORNO=prod`** → `Error: Bridge: NEFAN_ENTORNO="prod" no es un entorno: vale "desarrollo" o "produccion" (sin poner = "desarrollo")`, exit 1. Censo del árbol: `NEFAN_ENTORNO` solo se LEE en `nefan-core/bridge/ws-server.ts:73`; `start.sh:506-512` y `qa/run.mjs:507` solo la escriben en el entorno del hijo. Sin `import.meta.env.PROD/MODE` ni `NODE_ENV` en el cliente. `./start.sh --preset e2e-sin-creditos` sin variable imprime `entorno: produccion — los caminos automáticos PUEDEN pagar arte nuevo` (el falso es gratis) y `./start.sh --parar` lo deja limpio. **Candado en negativo** (QA): `process.env.NEFAN_ENTORNO` sembrado en `nefan-html/src/ui/mode-labels.ts` → `el-entorno-se-lee-en-un-solo-sitio` rojo nombrando `mode-labels.ts:37`; fichero restaurado (md5 igual) |
| 2 | Con «no», ningún camino automático llama a una ruta de pago (activo, vecinos, prefetch, skins); lo pagado se restaura, skins incluidos; candado en negativo contra `dePago` del falso | ✅ cumple | `node qa/run.mjs 179 180 160` → 3/3 ✔. **179** (desarrollo): partida nueva en Imagen IA con el jugador vestido: POST del atlas y de los skins todos con `resolve_only`, Δ`gasto`={} y Δ`puertas`={}; vecino por el cable igual; tras G + menú dev, recargar y reanudar devuelve el tile texturado y el skin `idle/walk/run` listo con permiso `restaurar`, Δ pagos 0. **160** (desarrollo): al reanudar, los NUEVE tiles preguntan con `resolve_only` y ninguno paga. **181** (nuevo, QA, desarrollo): fixture sin sesión, toggle local de skins → `restaurar`, 15 POST de skin todos con `resolve_only`, Δ pagos 0, ningún NPC en `failed`. **Negativo (QA)**: `const techo = true \|\| …` en `gatesDeImagen` → **179 rojo** (`{"gasto":{"/skin_sprite_sheet":6,"/generate_surface_atlas":1},"puertas":{"pedir-skins":6,"pintar-superficies":1}}`, permiso `generar`, POST sin `resolve_only`) y **181 rojo** en los cuatro asertos del bloque 1 (`/skin_sprite_sheet: 15`); restaurado, md5 igual |
| 3 | Con «no», las vías deliberadas siguen pagando: G, menú dev, aplicar estilo, subir estilo `/complete` | ✅ cumple (con un ⚠️) | **179 bloque 3**: tecla G textura el activo y el menú dev viste al jugador; el falso anota `/generate_surface_atlas: 1` y `/skin_sprite_sheet: 3`. **160 E1**: el batch «Aplicar estilo» paga en desarrollo (23 celdas, 6 skins anotados). **Subir estilo `/complete`: ⚠️ no probado** — leído (`titulo/subir-estilo.ts` no pasa por `gatesDeImagen`), ningún guion lo ejerce |
| 4 | Con «sí», el activo y los vecinos generan con Imagen IA; 59, 88, 114, 160 siguen midiendo pintar | ✅ cumple | **180** (produccion): tile de entrada pide pintar (`pintar-superficies` sube); el vecino por el cable manda POST **sin** `resolve_only`, el falso anota su pago (`/generate_surface_atlas: 1 → 2`) y el HUD dice `Atlas fps: 1 vecino(s) PINTADO(S) (gasto), 0 vecino(s) restaurado(s) de la librería ($0), 0 sin arte (clay)` (captura `180-…-vecino-pintado-en-produccion.png`). Regresión `node qa/run.mjs 59 88 114 60 156 166 07 53 51` (casó además 107, 151, 153, 159, 160): **14/14 ✔**, con el runner reiniciando el stack entre `produccion` y `desarrollo`. El negativo del 180 (`resolveOnly = true` en el vecino) lo hizo el ingeniero; QA no lo repitió |
| 5 | Un save en Imagen IA ARRANCA con «no»; el chip y el registro dicen que la generación está apagada por configuración | ✅ cumple | **179**: chip `🎨 Imagen IA · solo lo pagado`, `title` = `… Sin generación nueva: entorno de desarrollo: solo se restaura lo ya pagado (NEFAN_ENTORNO=produccion para generar). Click para cambiar.`; registro `Gráficos: imagen IA (skins IA) — entorno de desarrollo: …` al arrancar y al reanudar. Capturas `179-…-01-…sin-pagar.png` y `…-03-…reanudada-con-lo-pagado.png`. **181**: en el título, el badge armado del save dice `¿Confirmar? Solo lo ya pagado` (captura `181-…-02-titulo-badge-solo-lo-pagado.png`) |
| 6 | `modoDeCorrida` no cablea la política: la recibe como dato | ✅ cumple | `grep modoDeCorrida` en código = 0 (quedan dos menciones históricas en prosa: `qa/README.md:679`, `180-…mjs:4`). Los dos llamantes (`fps-atlas.ts:173` activo, `:238` vecino) usan `this.deps.modoDeEscenarios() !== "generar"`; el permiso sale de `gatesDeImagen` (`gates-de-imagen.ts:183-190`) con `entorno` como argumento |

Las preguntas del coordinador, en corto: **arranque por defecto** = desarrollo y no paga (fila 1); **reanudar un save en Imagen IA** devuelve atlas y skin pagados sin pagar (179-4); **producción** genera también en los vecinos (180); **una sola fuente** sí, con la reserva del hallazgo H2; **G y menú dev** pagan (179-3); **chip y HUD** dicen la verdad, **el resto del título y del panel no** (H1).

Verificación adicional: `cd nefan-core && npm test` → `tests 3477 · pass 3477 · fail 0` (incluye los candados del banco sobre el guion 181: numeración, declaración de entorno, saltos sin observar). `npm run lint:qa` limpio con el 181.

## Hallazgos

### H1 · importante — El título y el panel del chip prometen gasto que en desarrollo no ocurre

Lo que ve quien juega con `./start.sh` sin variable (desarrollo):

- **Panel del chip** (captura `181-…-01-fixture-sin-sesion-solo-lo-pagado.png`): la nota dice «Imagen IA entorno de desarrollo: solo se restaura lo ya pagado», y dos líneas más abajo la opción «Skins IA» dice **«gasta créditos · re-pide los skins de todo lo ya en escena»**; al armarla, el botón dice «¿Confirmar? Solo lo ya pagado» encima de ese mismo subtexto. `graphics-mode.ts:236`, `MODE_COST_LABELS[mode]`.
- **Selector de mundos** (Nueva partida): «🎨 Imagen IA — El modelo de imagen pinta cada zona del mundo (gasta créditos)» y «Cada personaje se viste por su descripción (gasta créditos)». `titulo/selector-de-mundo.ts:128,141`. En desarrollo ni pinta ni gasta: la frase entera es falsa, no solo el paréntesis.
- **Tooltip del badge** de la tarjeta de partida: «Escenarios: click para cambiar a Imagen IA antes de cargar (gasta créditos)». `tarjeta-de-partida.ts:82`.

Reproducción: `./start.sh --preset e2e-sin-creditos` con `NEFAN_ENTORNO=desarrollo` (o `cliente-web` sin variable) → título → «Nueva partida» → leer el selector; o en partida, click en el chip → leer la fila «Personajes». Lo que esperaba el usuario: que lo que se le dice al jugador antes de elegir sea lo mismo que le dice el chip después. Los tres textos salen de `MODE_COST_LABELS.image = "gasta créditos"` (`mode-labels.ts:25`), que no sabe del entorno.

### H2 · menor (estructural) — «Solo lo pagado» se calcula dos veces, y la segunda no mira el permiso real

El chip (`modos-de-graficos.ts:296`, `sinGeneracion: entornoPermiteGenerar(entornoVigente()) ? null : MOTIVO`), la nota del panel, el botón armado del chip y el badge del título (`home.ts:322`) derivan su texto del ENTORNO, no del permiso que devuelven los gates. Medido en los dos negativos de QA: con el techo saboteado en `gatesDeImagen`, el juego pagó 6 skins + 1 atlas (179) y 15 skins (181) **mientras el chip, la nota y el botón seguían diciendo «solo lo pagado»** (asertos de texto ✔, asertos de pago ✘). Hoy las dos derivaciones coinciden; el día que diverjan, la UI miente hacia el lado barato, que es el peor. Lo que esperaría el usuario: que el rótulo salga del mismo dato que decide el POST (`gates().escenarios/personajes !== "generar"` cuando el modo pide `image`).

### H3 · menor (UX) — La línea de balance de skins cuenta anims, el jugador cuenta personajes

`Skins: 0 anim(s) restaurada(s) de la librería ($0), 15 sin arte pagado (base y_bot)` (181-1) o «9 sin arte pagado» (179-1) para 5 y 3 personajes. «anim(s)» es jerga del gestor. Además el registro se pinta en gris claro sobre el suelo verde y cuesta leerlo (preexistente, no de esta tanda; captura 179-1).

### H4 · menor — En `html-fixtures` (sin bridge) el motivo apunta a una variable que nadie lee

Sin bridge no hay `bridge_hello`, el cliente cae a `ENTORNO_POR_DEFECTO` y el chip/panel dicen «… (NEFAN_ENTORNO=produccion para generar)». En ese preset no hay bridge al que ponérsela: es un callejón sin salida para quien quiera generar skins de una fixture ahí (antes de la tanda el toggle local sí generaba). El defecto seguro es el correcto; el mensaje no. Leído en `modos-de-graficos.ts:149-150` y `nefan-hook.ts:154`; no ejercido en navegador (el guion 181 declara que no lo mide).

### H5 · menor — Python: `resolve_only` con sprite-forge caído y sin apunte contesta 503, no `sin_arte`

`ai_server/routers/remote_generation.py:717-727`: si `/sheets` da 503 y no hay apunte de la base, se hace `raise` **antes** de llegar a la rama `elif body.resolve_only`. Un skin que nunca se pagó no tiene apunte, así que en desarrollo con sprite-forge caído la pregunta «¿está pagado?» sale como fallo de backend y el cliente lo cuenta en el fusible (`character-sprites.ts`, `state.failed = true`). La respuesta correcta con `resolve_only` es `sin_arte`. No probado (exige remote-gen real); leído.

### H6 · menor (coste no anunciado) — `forzado` extiende el pago a las anims lazy del personaje

Tras «Generar y aplicar» sobre un personaje en el menú dev, `state.forzado = true` (`character-sprites.ts`) y sus anims lazy (`modelFor`: ataque, muerte…) se generan después sin nueva confirmación mientras dure la pestaña. Es coherente con «elegí pagar ESTE personaje» y no se anuncia en el botón («¿Confirmar? Gastará créditos» habla de un skin). No probado en navegador.

### H7 · menor (documentación) — `NEFAN_ENTORNO` no aparece en CLAUDE.md ni en `docs/arquitectura/`

`grep -rl NEFAN_ENTORNO CLAUDE.md docs/arquitectura` = 0. La tabla de presets de CLAUDE.md dice que `play` «GASTA créditos con Imagen IA», que ya no es verdad sin la variable; `ia-servicios.md` (lo que gasta créditos) y `arranque.md` tampoco la nombran. Quien arranque `play` solo se entera por el banner del launcher.

## Workarounds usados

- **Ninguno en el flujo del jugador.** Los guiones cierran el título por su botón (`__nefan.closeTitle`, como el 01), pulsan el chip por `element.click()` desde la página (la expiración conocida del click de Playwright sobre `#gfx-chip`, guion 53) y leen el DOM real. No se ocultó ningún overlay ni se forzó estado.
- **Sabotajes para los negativos** (no son workarounds): `const techo = true || …` en `gates-de-imagen.ts` (dos veces) y una lectura de `process.env.NEFAN_ENTORNO` en `mode-labels.ts`; cada uno restaurado desde copia y comprobado por md5; `git status` limpio salvo el guion nuevo y la fila del README.

## No probado

- **Servicios reales** (remote-gen, sprite-forge, asset-store): gastaría. El lado Python solo lo cubren los tests del ingeniero con el sprite-forge de mentira; H5 es lectura.
- **Subir un estilo y confirmar `/complete`** en desarrollo (criterio 3): sin guion; lectura del código.
- **Negativo del 180** (`resolveOnly = true` en el vecino): lo hizo el ingeniero, QA no lo repitió.
- **`html-fixtures` sin bridge** en navegador (H4): lectura.
- **Carrera hello↔fixture** (una fixture que carga antes del `bridge_hello`): la cubre la lógica de «el permiso que sube»; ningún guion la ejerce.
- **La barra «gasto sesión … € · total … €»** del panel de dev sigue en 0,00 € con el falso aunque el registro diga «$0.15»: el falso no alimenta el ledger de gasto (preexistente). Con servicios reales no se ha mirado.
- **Guion 106**: intermitente también en `main`, fuera de alcance (carrera con `localStorage`, issue propio).
- **Cotización real** de un anillo virgen en Miravanda: solo la estimación del ingeniero sobre el mundo del falso.

## Guiones dejados

- `qa/guiones/181-en-desarrollo-sin-sesion-y-en-el-titulo-solo-lo-pagado.mjs` (+ fila en `qa/README.md`), `entorno = "desarrollo"`: fixture sin sesión con el toggle local de skins (permiso `restaurar`, `resolve_only`, Δ pagos 0, sin `failed`, nota/botón/chip), y el título (el hello llega antes que la lista de saves; badge armado «Solo lo ya pagado»). Registra sin afirmar los textos de H1. Corrida: `node qa/run.mjs 181` → ✔; **negativo**: techo quitado → rojos exactamente los cuatro asertos de gasto del bloque 1.
- Corridas de QA: `node qa/run.mjs 179 180 160` → 3/3 ✔; regresión de 14 guiones → 14/14 ✔; capturas en `qa/capturas/2026-09-24T15-32-49-241Z-613613/`, `…T15-37-46-363Z-617250/`, `…T15-39-57-827Z-619720/`.

## Veredicto

**Apto con reservas.** Lo que pidió el usuario se cumple y está candado: sin tocar nada es desarrollo y ningún camino automático paga (atlas del activo, vecinos, skins, reanudar, fixtures), lo pagado vuelve, G y el menú dev siguen pagando, y con `NEFAN_ENTORNO=produccion` el activo y los vecinos generan; cada candado se pone rojo al quitar el techo. La reserva es lo que lee el jugador ANTES de elegir: el selector del título, el tooltip de la tarjeta y el subtexto del panel del chip siguen diciendo «gasta créditos» (H1) al lado de un botón que dice «Solo lo ya pagado», y esos rótulos no salen del dato que decide el gasto (H2). Corregir H1 (y de paso H2) antes de fusionar; H3–H7 pueden ir a issues.

## Vuelta 2 — sobre `16bfbd6c` (corrige H1, H2, H4, H5, H7; H3 y H6 a issues)

Segunda pasada corta, mismo worktree, cero créditos. Árbol limpio al terminar; cada sabotaje restaurado por md5.

| Hallazgo | Veredicto | Evidencia |
|---|---|---|
| H1 · textos que prometían gasto en desarrollo | ✅ corregido | `node qa/run.mjs 181 179` → 2/2 ✔ (capturas en `qa/capturas/2026-09-24T15-55-14-102Z-640341/`). Panel del chip (captura `181-…-01`): «Imagen IA — solo lo ya pagado», «Skins IA — solo lo ya pagado · re-pide los skins…», nota con el motivo, chip «Mixto · solo lo pagado»; botón armado «¿Confirmar? Solo lo ya pagado». Selector de mundos: «Restaura el arte ya pagado de cada zona; lo que falte se ve en maqueta (solo lo ya pagado)». Tooltip del badge: «… antes de cargar (solo lo ya pagado)». Badge armado en el título (captura `181-…-02`): «¿Confirmar? Solo lo ya pagado». El ingeniero convirtió en asertos del 181 los tres textos que yo solo registraba; `MODE_COST_LABELS` ya no existe (`grep` = 0) |
| H2 · los rótulos salían del entorno, no de los gates | ✅ corregido | Negativo repetido (`const techo = true \|\| …` en `gatesDeImagen`, `node qa/run.mjs 181 179`): ahora se ponen ROJOS también los textos, no solo el gasto — 179: chip `🎨 Imagen IA` sin «solo lo pagado», `title` sin motivo, registro `Gráficos: imagen IA (skins IA)` sin motivo; 181: nota sin motivo, botón «¿Confirmar? Gastará créditos», subtexto «gasta créditos», selector «pinta cada zona del mundo (gasta créditos)», tooltip «(gasta créditos)», badge armado «Gastará créditos». 0 en verde · 2 en rojo; corrida `…T15-55-46-414Z-641363`. Los rótulos vienen de `loQuePagaImagenIA` (core, `gates-de-imagen.ts`), que llama a los mismos `gatesDeImagen`, y de `motivoDelTecho()` (`modos-de-graficos.ts`), que lee `gates()`. Fichero restaurado, md5 OK |
| H4 · motivo sin bridge | ✅ corregido (leído) | `MOTIVO_SIN_BRIDGE = "sin bridge no hay entorno declarado: solo se restaura lo ya pagado"` (`mode-labels.ts`), elegido por `fraseDelTecho()` cuando `entornoDelBridge === null`. No ejercido en navegador: exige un stack sin bridge |
| H5 · `resolve_only` con sprite-forge caído y sin apunte | ✅ corregido | `NEFAN_SPEND_DIR=$(mktemp -d) python -m unittest ai_server.tests.test_sprite_forge_adapter -k resolve_only` → `Ran 6 tests · OK`. **Negativo**: quitada la rama nueva de `remote_generation.py` → `test_resolve_only_con_el_servicio_caido_y_SIN_apunte_es_sin_arte_no_503` FAIL (`503 != 200`); su gemelo sin `resolve_only` sigue exigiendo 503. Restaurado, md5 OK. Sin `NEFAN_SPEND_DIR` la suite se niega a correr (correcto: no inventa gasto) |
| H7 · prosa | ✅ corregido | CLAUDE.md, tabla de presets: `play` «con Imagen IA solo restaura lo pagado; genera (y GASTA) con `NEFAN_ENTORNO=produccion`», `cliente-web` «solo gasta con Imagen IA y `NEFAN_ENTORNO=produccion`». `docs/arquitectura/ia-servicios.md` estrena la sección «Qué paga arte sin que nadie lo pida: `NEFAN_ENTORNO`» (línea 9, antes de los endpoints): un lector, `bridge_hello`, valor desconocido no arranca, vías deliberadas, defecto `produccion` con el falso y la declaración de los guiones. Coincide con lo medido en la vuelta 1 |

Cosmético, sin abrir hallazgo: la nota del panel concatena «Imagen IA entorno de desarrollo: …» sin separador (se lee raro; captura `181-…-01`).

Pendiente en issues, como acordado: H3 (balance en «anim(s)») y H6 (`forzado` extiende el pago a las anims lazy).

### Veredicto final

**Apto.** Los seis criterios cumplen y los cinco hallazgos corregidos están verificados en el flujo real, con sus negativos en rojo; lo que el jugador lee antes de elegir ya dice lo mismo que el chip y sale del mismo dato que decide el POST.
