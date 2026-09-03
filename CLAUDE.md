# Never Ending Fantasy — Guia de desarrollo

RPG de **mundo abierto generativo** en PRIMERA PERSONA: el cliente web (three.js/WebGL) es la vista del juego, y la única. El motor narrativo (Claude vía MCP) crea escenas open-world con `generate_scene` y va añadiendo entidades (NPCs, edificios, objetos) dinámicamente a medida que la historia avanza. Si en una conversación el jugador dice "quiero ir a la forja a comprar un arma", el motor narrativo genera una forja, instancia un herrero, etc. Superficies pintadas por IA (atlas de la vista fps), personajes Mixamo 3D vestidos por sprite-forge, combate cuerpo a cuerpo real-time. La escena viaja en UN formato: el motor produce Format D y el bridge lo normaliza a world scene (`formatDToWorld`), que es lo que el cliente pinta. Los JSON de `data/scenes/` son fixtures de test que ofrece el selector «Room» del cliente.

**Juegos = mundos.** Un juego es `nefan-core/data/games/{id}/`: `game.json` (título, descripción, `style_id` por defecto, `world_brief` ~1.2k chars) + `world.md` (documento completo del mundo en 10 secciones: identidad, geografía, historia, pueblos, facciones, magia, vida cotidiana, semillas de conflicto, el jugador, registro) + `plugins/`. NO hay historia predefinida ni beats scripted: la historia la improvisa el motor narrativo dentro del mundo. Juegos base: `alta_fantasia` (Miravanda), `cuentos_oscuros` (Valdesombra), `toledo_1200` (histórico). Un **estilo** es `data/styles/{id}/`: `style.json` (`style_token`, cover, `tags` temáticos, refs, **`ui`** = tema de la interfaz de juego) + imágenes de referencia LIBRES en tres carpetas de ROL (`surfaces/` = la lámina de materiales, EXACTAMENTE una; `faces/` = las caras del mundo; `characters/` = model sheets; las tres obligatorias — un pack al que le falte una no carga; ver `data/styles/README.md`). Cada ref declara `{id, file, description}` — sin categorías: el contenido depende del mundo (una catedral, una estación espacial…). El MOTOR NARRATIVO elige la ref de cada escena (`style_ref`, catálogo `world.style_refs` en su contexto; pre-flight fail-loud en narrative-mcp) y la de cada NPC (`style_ref` en la entity, `npcSkinStyleRef`); sin elección, el server usa la primera ref de la carpeta (orden del manifest). `game.json` declara `tags` que casan con los del estilo por intersección (`styleCompatibleWithGame`): el selector del título filtra por tema (un pack medieval no se ofrece para un mundo futurista); `start_session` avisa sin abortar. El `id` de una ref entra en la clave de caché de imagen (renombrarlo repaga; renombrar `file`/`description` no). El estilo se elige en el título y queda CONGELADO en el save. El jugador puede crear su mundo (borrador → kind MCP `develop_world` → `data/games/user_*`, con `tags` obligatorios) y subir su estilo (imágenes con vista+descripción+tags → `/styles/upload` → confirmación de coste → `/styles/{id}/complete` genera las refs declaradas que falten; CLI: `python ai_server/tools/build_style_pack.py`). Schemas en `nefan-core/src/games/loader.ts` + `src/games/style-refs.ts` (fuente de verdad).

## Dónde está lo demás

Este fichero entra ENTERO en cada sesión, así que solo contiene lo que se aplica
siempre: cómo arrancar, los contratos que nadie puede romper y las convenciones.
Lo demás vive en `docs/arquitectura/` y se lee **cuando toca**:

| Documento | Léelo cuando… |
|-----------|---------------|
| [`mapa.md`](docs/arquitectura/mapa.md) | no sepas en qué carpeta o proceso encaja un cambio |
| [`vistas.md`](docs/arquitectura/vistas.md) | toques renderer, cámara, colisión o pipeline de imagen del cliente |
| [`narrativa.md`](docs/arquitectura/narrativa.md) | toques la generación de escenas, el diálogo o las consequences del motor |
| [`ia-servicios.md`](docs/arquitectura/ia-servicios.md) | vayas a tocar algo que GASTA CRÉDITOS, o los tres procesos Python |
| [`plugins.md`](docs/arquitectura/plugins.md) | añadas un sistema de juego (manifest declarativo) o una implementación intercambiable de hot loop |
| [`ui.md`](docs/arquitectura/ui.md) | toques la interfaz in-game o el tema de un style pack |
| [`arranque.md`](docs/arquitectura/arranque.md) | necesites arrancar el juego sin manos para un bench o una prueba |
| [`qa/README.md`](qa/README.md) | tengas que verificar algo del cliente: guiones ejecutables, no prosa |

## Lo que ya NO se comprueba leyendo

Estos invariantes tienen **candado ejecutable**; no hace falta recordarlos, porque
fallan solos. Antes ocupaban media página de prosa y se ignoraban igual:

| Herramienta | Qué sujeta |
|-------------|-----------|
| `nefan-core/data/contract/arch-rules.json` (+ `test/architecture.test.ts`) | fronteras: lógica en core y un cliente que solo pinta, dirección de dependencias, módulos puros sin `node:*`, three.js solo en `fps-gl.ts`, el cliente sin conversión celdas→metros, fail-loud por capa. `npm test` los verifica |
| `nefan-core/data/contract/quality-thresholds.json` (`npm run crap`) | complejidad × cobertura: tope de no-empeorar y suelo de cobertura |
| `nefan-core/data/contract/mutation-targets.json` (`npm run mutacion`) | si los tests se enterarían de un cambio, no solo si pasan por la línea — y que **todo** fichero del núcleo puro esté medido o eximido con motivo escrito: sin esa totalidad, un diff sobre un fichero sin dueño sale verde sin medir nada |
| `nefan-core/data/contract/mutacion-huella.json` | de quién es cada superviviente y cuál es NUEVO. Va commiteado: el delta se ve en el diff, y un clon limpio ve la deuda de mutación en vez de una fuente vacía |
| `qa/run.mjs` | que el juego real hace lo que se dice, desde el arranque |
| `test/contract-model-io.test.ts` | que los prompts y tools del modelo no divergen del zod |
| `.claude/hooks/ci-verde.sh` (hook `Stop`) | que nadie da una tarea por terminada con el CI de su PR pendiente o en rojo. Verde en local NO es verde: el runner tiene otro sistema de ficheros y ninguna caché |

Si vas a añadir una regla a este fichero, pregúntate antes si puede ser una de
esas. La prosa se olvida a mitad de contexto; un test que falla, no.

**El backlog sale de ahí, no de un documento**: `npm run deuda` (en `nefan-core`)
deriva la cola de trabajo de esas mismas herramientas — violaciones congeladas,
funciones sobre el objetivo de CRAP, mutantes supervivientes — y avisa cuando una
medida está obsoleta. Un item desaparece de la cola cuando se arregla, no cuando
alguien se acuerda de tacharlo. Y cada superviviente sale con **su estado y su
dueño**: NUEVO (y de qué PR), ya estaba, o *sin base de comparación* — que no es
ninguna de las dos y no se colapsa con ellas.

**La mutación se PIDE, la autoriza una persona y vuelve con dueño.** No hay
cron: una nocturna que mide cuatro PR juntas no sabe de cuál salió cada
superviviente, y averiguarlo después, a mano, es el trabajo que no se hace nunca.
El ciclo entero es `npm run mutacion` (en `nefan-core`):

| Verbo | Quién | Qué hace |
|---|---|---|
| `pendiente` | el usuario y el coordinador | qué falta por medir desde el tag `mutacion-ultima`, con su coste en mutantes |
| `local <id>` | el ingeniero | mide UN módulo con dos núcleos; **rechaza** el que pase de `tope_local` diciendo su coste |
| `traer [run-id]` | el coordinador | vacía `reports/mutation/` y baja el artefacto; rechaza una descarga en la que falte o sobre un informe |
| `repartir [--comentar]` | el coordinador | delta contra la huella de HEAD, atribución honesta y comentario en la PR de origen |

Autorizar es entrar en Actions → *Mutation testing* → **Run workflow** (funciona
desde el navegador del móvil). Input vacío = lo que falta desde el tag; `TODOS` =
la corrida completa. Una petición pendiente **no bloquea nada**: se cierra la
tanda y el resultado llega después, al sitio donde se causó.

La atribución es «las PR del rango cuyo diff selecciona ese módulo», no
`git blame`: blame contesta quién escribió la línea, y la pregunta es qué cambio
movió la suerte del mutante. Con dos candidatas se nombran las dos — un dueño
equivocado es peor que dos candidatos.

`npm run afectado` sigue sirviendo para SABER qué módulos puede haber roto un
diff sin medir nada. Lo que ninguna herramienta mide (trocear un fichero, una
funcionalidad nueva) va a **issues de GitHub**, que se cierran desde la PR.

## Arrancar el juego

```bash
# Launcher interactivo (recomendado):
./start.sh
```

Sin argumentos, presenta un menú con presets que respetan dependencias entre servicios y, cuando se necesita el motor narrativo, pausan para que abras Claude Code en otra terminal:

| Preset | Slug | Servicios | Cuándo |
|--------|------|-----------|--------|
| 1 · Play | `play` | asset-store + remote-gen + sprite-forge + bridge + narrative-mcp + ai_server + pausa Claude Code + cliente | Sesión narrativa completa — GASTA créditos con Imagen IA |
| 2 · Cliente web (dev) | `cliente-web` | bridge + asset-store + remote-gen + sprite-forge + cliente | Iterar UI y renderer sin motor narrativo — solo gasta si activas Imagen IA en el juego |
| 3 · E2E sin créditos | `e2e-sin-creditos` | fake-ai-server (:18765) + bridge (`NEFAN_AI_SERVER`) + cliente | Bench E2E todo mockeado, 0 créditos; imprime la URL con `?ai=`. Es el que levanta `qa/run.mjs` |
| 4 · Story web sin imágenes | `story-web-sin-imagenes` | como Play sin remote-gen ni sprite-forge | Jugar la narrativa con los servicios de imagen APAGADOS — imposible gastar en imágenes |
| 5 · Playtest motor (bench) | `playtest-motor` | bridge + ai_server + asset-store, SIN placeholder de narrative-mcp; pausa ANTES de ai_server | Flujo de `labs/narrative/`: el terminal del motor posee :3737; conducir con `game-emulator.mjs` (:9899) |
| 6 · Replay web (película) | `replay-web` | replay-server (suplanta al bridge :9877; `LOG=runs/…/events.ndjson`) + cliente | Reproducir una sesión grabada: renderer determinista sin motor ni ai_server |
| 7 · HTML fixtures | `html-fixtures` | solo el cliente | Iterar renderer/UI con las fixtures del selector Room, cero backend |
| 8 · Custom | `custom` | toggle por servicio | Combinaciones puntuales (ai_server solo, replay solo…) |
| s · Status | — | — | Listar puertos arriba/abajo (incluye State API :9878) |
| k · Stop | — | — | Parar el stack de ESTE worktree (lo ajeno se enumera y NO se toca) |
| K · Stop TODO | — | — | Barrido del catálogo entero, sea de quien sea. Bajo bandera explícita |

Cosas a tener en cuenta:
- El preflight es condicional: solo comprueba las dependencias de los servicios seleccionados (elegir "HTML fixtures" no exige el `.venv` ni las deps del bridge).
- Cada servicio espera al puerto del anterior (`wait_for_port` real, no `sleep` ciego).
- **Arrancar no mata a nadie.** Si un puerto del catálogo está ocupado, el servicio NO
  arranca: se dice quién lo tiene (`port_owner`) y se sale con 1. Antes las nueve
  funciones `start_*` mataban al ocupante sin preguntar, así que el preset más tonto se
  llevaba por delante el stack de otro agente de la máquina.
- Ctrl+C para **solo lo que arrancó este launcher** (`trap EXIT` → el proceso y su
  descendencia). La tecla `k` (= `./start.sh --parar`) para lo de **este worktree**:
  `STARTED_PORTS` ∪ los puertos cuyo proceso vive bajo `$PROJECT_DIR` (`/proc/<pid>/cwd`;
  ilegible = ajeno, nunca al revés). Lo ajeno lo enumera y lo deja. El barrido del
  catálogo entero sigue existiendo pero hay que pedirlo: tecla `K` o `--parar-todo`.
- **`NEFAN_PORT_OFFSET`** desplaza el bloque de puertos entero para que quepan varios
  stacks en la máquina (varios agentes, dos corridas del banco). 0 —el defecto— son
  EXACTAMENTE los puertos de siempre. Es explícito, nunca derivado del nombre del
  worktree. No lo honran ai_server, remote-gen, narrative-mcp ni sprite-forge (leen el
  snapshot, que es uno por checkout, o viven en otro repo): con offset ≠ 0 el launcher se
  NIEGA a arrancarlos en vez de ponerlos donde nadie los busca. `qa/run.mjs` sí elige
  bloque libre solo (con lock atómico en `qa/.tmp/.bloques/`), y el cliente lo recibe por
  `?offset=N`.
- **`start.sh` ya no declara ningún puerto**: los lee de `nefan-core/data/runtime_config.json`,
  el snapshot de la fuente única (`src/config.ts` → registro de servicios). Lo canda
  `nadie-inventa-un-puerto` en `arch-rules.json`, que cubre `start.sh`, `qa/**`, `labs/**`
  y `vite.config.ts`.
- `NEFAN_EAGER_BIND=0 ./start.sh` no arranca el placeholder de narrative-mcp: el terminal de Claude Code del motor posee `:3737` (flujo de `labs/narrative/README.md`). `NEFAN_GAMES_DIR` se respeta y llega al bridge (juegos de bench aislados).
- Antes de arrancar el bridge se refresca `data/runtime_config.json` (`scripts/dump-config.ts`), como hacen los hooks `predev` de nefan-core.
- `./start.sh --preset <slug>` arranca sin TUI. **Cítalo por slug, no por número**: los números se desplazan cuando muere un preset, y un runner que cite el número acaba levantando otro stack y fallando por timeout sin decir por qué. `./start.sh --list` los enumera.

```bash
# Manual (si prefieres arrancar servicios por separado):
cd ~/code/ne-fan
source .venv/bin/activate
cd nefan-core && npx tsx services/asset-store/server.ts  # asset-store :8767 (blobs+manifest SQLite)
python ai_server/remote_gen_main.py         # Remote-gen :8768 (Meshy/fal, SAM2, styles; opcional)
python ai_server/main.py                    # AI server :8765 (narrativa; opcional)
cd nefan-core && npx tsx bridge/ws-server.ts  # Bridge TS :9877 (opcional)
cd narrative-mcp && node dist/server.js     # MCP bridge :3737 (opcional)
cd nefan-html && npm run dev                # Cliente web :3000
```

El juego arranca sin ai_server ni bridge — texturas no se generan y el combate queda deshabilitado ENTERO: la simulación vive en nefan-core detrás del bridge, así que sin él un ataque ni daña ni se anima. Sin bridge el cliente es un VISOR: dice el error de arranque, y con eso dicho pinta las fixtures del selector «Room» con movimiento y locomoción, que es para lo que existe el preset `html-fixtures`. Lo canda `qa/fixtures-sin-bridge.mjs` (mirando si PINTA, no si el puerto está arriba). Para combate y narrativa usar `play` (o `story-web-sin-imagenes` sin servicios de imagen); para el bench sin coste, `e2e-sin-creditos`.

## Controles in-game

Teclado y ratón en `nefan-html/src/input/keyboard-input-provider.ts`:

| Tecla | Accion |
|-------|--------|
| WASD | Movimiento relativo al facing |
| Shift | Sprint |
| Raton (pointer lock) | Mirada: yaw continuo + pitch |
| ←/→ · ↑/↓ | Orientar por pasos: 45° de yaw · 15° de pitch |
| E | Interactuar con objeto/NPC |
| 1..N | Seleccionar ataque del catálogo de la SESIÓN (con `basic` hay uno solo) |
| LMB | Ejecutar ataque |
| Y/N | Responder a la propuesta de explorar el tile vecino |
| R | Respawn |
| Esc | Soltar/capturar raton |

Las teclas de DESARROLLO (G = pedir el atlas de superficies, B = ciclar la vista de
debug del renderer) viven aparte, en `input/dev-tools-input.ts`.

## Sistema de combate

**Formula:** `calidad = factor_distancia * factor_precision * factor_tactico * base_damage * weapon_mod`

- **factor_distancia:** 1.0 en distancia optima, lineal a 0 en borde de tolerancia
- **factor_precision:** 1.0 en centro del area, lineal a 0 en borde del radio
- **factor_tactico:** Matriz 5x7 (tipo ataque vs accion defensor, valores 0.7-1.3)

**Flujo:** Seleccionar tipo (1-5) → Click (LMB) → Wind-up (no cancelable) → Impacto → Resolucion

**Tipos:** quick (0.15s, 15 dmg), heavy (0.7s, 45 dmg), medium (0.4s, 25 dmg), defensive (0.3s, 18 dmg + 50% reduccion), precise (0.45s, 40 dmg, area minima)

**Armas:** unarmed, short_sword (rapida, +dmg quick), war_hammer (lenta, +dmg heavy). Modifican wind-up, distancia, area, dano.

**IA enemigos:** Personalidad JSON (aggression, preferred_attacks[], reaction_time). Enemigos estaticos en v1.

**Datos:** Todo en `nefan-core/data/combat_config.json` — editable sin recompilar.

## Formatos de escena (canónicos)

Hay exactamente DOS formatos, y la conversión entre ellos vive en nefan-core:

**1. Format D** — lo que produce el motor narrativo (`generate_scene`), con **una sola variante**: el **tile** del mundo continuo (`tile{tx,ty}` + `biome` + `ground`/`volumes` declarativos; el motor NO escribe el grid, lo sintetiza el engine 128×128 @0,5 m), más sus `entities[]` (`kind`, `cell:[col,row]`, `footprint:[w,h]`, `shape?`, `h?`). Las otras dos se retiraron y no vuelven: la "suelta" (tamaño a elección del motor, sin sitio en el plano) y el **plató proscenio** (`size`+`terrain` propios + bloque `stage` con sus salidas), que murió con la vista que lo pintaba. Una escena sin `tile` la rechazan el zod (`src/contract/model-io/scene-schema.ts`), su espejo Python y `validateScene`; `stage_request`/`stage_review` tienen candado de reaparición en `arch-rules.json`. Contrato en `nefan-core/data/contract/tools/generate_scene.json`; validador de jugabilidad en `src/scene/scene-validate.ts`. Es lo que se PERSISTE (saves, `scenes_loaded`, `serializeForLlm`).

**2. World scene** — el contrato de render que consume el cliente: la salida de `formatDToWorld` (`nefan-core/src/scene/scene-normalize.ts`). El bridge normaliza en el wire (`broadcastScene` y el resume vía `sessionDataForClient`); el cliente HTML también la genera en local para fixtures. Forma:

```json
{
  "scene_id": "robledo_tile",
  "scene_description": "El pueblo de Robledo...",
  "dimensions": { "width": 64, "depth": 64, "height": 3 },
  "world_rect": { "minX": -32, "minZ": -32, "maxX": 32, "maxZ": 32 },
  "terrain": { "color": [0.18, 0.22, 0.14] },
  "terrain_grid": { "grid": ["..."], "solid_chars": ["W", "w"] },
  "objects": [
    { "id": "tavern", "shape": "box", "position": [-2, 0, -2], "scale": [8, 1, 4],
      "category": "building", "name": "Taberna" }
  ],
  "npcs": [ { "id": "barkeep", "name": "Tabernero", "position": [0, 0, -2] } ],
  "__player_start": { "x": -1.75, "z": 10.25 }
}
```

Posiciones y escalas en METROS (anclaje por BASE: `position.y` es la base del objeto). La monta `FpsRenderer` en el cliente. El cliente NUNCA porta la conversión celdas→metros: normalizar es trabajo del bridge, y hay candado (`cliente-no-convierte-celdas-a-metros`).

**Fixtures de test** (`nefan-core/data/scenes/*.json`): escenas **Format D** commiteadas que ofrece el selector «Room» del cliente, para iterar renderer y UI sin backend (preset `html-fixtures`). Van por el mismo camino que una escena del motor —`formatDToWorld` y a pintar—, así que una fixture que no valdría en partida tampoco vale aquí: `test/scene-fixtures.test.ts` canda que solo haya Format D vivo.

**Reuse de assets**: la librería que ve el motor (`available_assets`) son las SUPERFICIES pintadas, y se reusan por DESCRIPCIÓN, no por hash: repetir verbatim una `surface_desc` ya pintada es un cache-hit. La cadena por hash (`texture_hash`/`model_hash`) murió con el gpu-worker (#199) y tiene candado de reaparición en `arch-rules.json`.

**Spawn dinámico**: vía consequences `spawn_entity` que devuelve `react_to_player` (`materializeSpawn` en el cliente). Las entidades se materializan en el mundo en runtime sin recargar la escena.

Categorias: item (amarillo), prop (gris), building (marron), creature (rojo), terrain (verde), decor (gris apagado).

**Altura**: cada entity admite `h` opcional en METROS (el footprint sigue en celdas); sin él, `formatDToWorld` aplica `KIND_DEFAULT_HEIGHT` (building 2.5, tree 4, prop 1, item/decor 0.5) y emite `scale.y` real. Ambos clientes la construyen tal cual, como volumen. La colisión NUNCA usa la altura (solo huella XZ).

## Convenciones de codigo

- TypeScript estricto; `Result<T,E>` cuando "vacío" y "error" se confundirían al colapsarse
- Descripciones de objetos y NPC en espanol
- Unidades en metros

### Errores y logging (fail-loud uniforme)

Nunca `catch { /* ignore */ }`, nunca `return null` silencioso, nunca `return []` cuando hubo un error. El checker de fronteras sujeta solo UNA PARTE: el `catch` vacío en `nefan-core` y el literal `return {"error"...}` con 200 en Python. El `catch { warn; return null }` y el `return []` tras un error NO los ve ninguna herramienta — son convención, y es donde más se cuela. Lo que sigue es el canal de cada capa, que ninguna herramienta puede elegir por ti:

- **TS/HTML**: `errors.push("source", msg, err)` (`nefan-html/src/ui/error-log.ts`) en cualquier `catch` recuperable. Lanzar de nuevo si el caller necesita decidir. Devolver `Result<T,E>` (discriminated union `{ok:true,...} | {ok:false,error}`) cuando "vacío" y "error" son indistinguibles si se colapsan.
- **TS/bridge**: cualquier `.catch()` sobre una promise que el cliente está esperando debe broadcastear `narrative_status: error` además de loguear — patrón en `nefan-core/bridge/handlers/dialogue.ts` (`dialogue_choice`).
- **Python/FastAPI**: `raise HTTPException(status_code=..., detail=...)`, **nunca** `return {"error": ...}` con 200 OK. Pydantic `BaseModel` por endpoint para que campos ausentes salgan como 422 estructurado. Modelo de referencia: `/report_player_choice` en `ai_server/routers/narrative.py`.

## Equipo de agentes (roles y coordinación)

El trabajo sustancial se hace en equipo: la **sesión principal coordina** (habla con el
usuario, fija los requisitos, decide y delega) y cuatro roles especializados viven en
`.claude/agents/`:

| Rol | Qué hace | Qué NO hace |
|-----|----------|-------------|
| `critico` | Decide si la tarea DEBE hacerse tal como está escrita: separa el problema real de la solución que propone, verifica su premisa contra el código, imagina el repo el día después y busca conflictos con otras tareas. Veredicto: vigente / reencuadrada / obsoleta / en conflicto / prematura. Produce `critica.md` | No diseña ni implementa; no opina de estilo ni de diseño interno |
| `arquitecto` | Dónde encaja el cambio (nefan-core / bridge / cliente / ai_server), contratos y formatos afectados, qué hay que borrar (claves de caché incluidas), mejoras estructurales. Produce `plan.md` | No escribe código de producción |
| `ingeniero` | Implementa y **demuestra** que funciona: `npm run verify` verde, la deuda que toca sin crecer y, si su módulo cabe en el tope local, sus supervivientes muertos (`npm run mutacion -- local <id>`); si no cabe, la pide y **sigue sin esperarla**. Produce `implementacion.md` | No improvisa desviaciones en silencio; no commitea sin que se le pida |
| `qa` | Valida contra la petición ORIGINAL desde el punto de vista del jugador: estados del sistema, flujo real desde el arranque, regla del workaround, pasada adversarial, crítica visual. Produce `qa.md` **y un guion ejecutable** en `qa/guiones/` de lo que sea mecánico | **No arregla nada** — reporta |

Los subagentes arrancan con **contexto limpio y no se ven entre sí**: todo el handoff viaja
por ficheros (ver `docs/agents/README.md`). Lo que no esté escrito ahí, para ellos no existe —
empezando por la cita literal de la petición del usuario en `requisitos.md`. Los cinco
documentos viven en `docs/agents/<tarea>/`, pero solo se commitean `requisitos.md`, `critica.md`
y `qa.md` (qué se pidió, por qué se hizo así o no se hizo, y qué se verificó): `.gitignore` deja
fuera el plan y el informe de implementación, que envejecen mal y a los tres meses son
documentación falsa.

**Cuándo se dispara** (regla del coordinador, sin esperar a que lo pidan): cualquier tarea que
toque más de un fichero de lógica, cambie un contrato o un formato, o sea observable por el
jugador → ciclo completo `requisitos → crítico → [visto bueno del usuario] → arquitecto →
ingeniero → qa`. **El crítico va primero y no se salta cuando la tarea viene de un issue, del
backlog o de una tanda anterior**: el fallo más caro del ciclo no es un plan malo, es un plan
bueno sobre una tarea que no había que hacer, y ese material es justo el que se pudre. Solo se
salta cuando la tarea la acaba de describir el usuario y no toca nada más. Un typo, un color o una pregunta se hacen directamente: el ciclo cuesta cuatro contextos
y no debe salir más caro que el trabajo. `/feature <descripción>` fuerza el ciclo entero;
`/final-check` es la verificación de objetivo en solitario, sin equipo.

Los hallazgos de QA vuelven al **mismo** ingeniero con `SendMessage` (conserva su contexto).
Dos vueltas sin converger = el requisito está mal escrito; parar y consultar al usuario.

## Decisiones de diseno importantes

- **Modo de juego canónico: open-world generativo.** El motor narrativo crea una escena base con `generate_scene` y va añadiendo entidades en runtime sin recargar (NPCs, edificios, objetos) según las elecciones del jugador.
- **Un solo formato de escena.** El motor produce Format D; el bridge lo normaliza a world scene con `formatDToWorld` (nefan-core) antes de emitir, y el cliente pinta esa forma. El cliente no proyecta celdas ni vuelve a normalizar: si lo hiciera habría dos caminos hasta la world scene y divergirían.
- **NarrativeState como save canónico, con el bridge como único escritor** — todo el playthrough vive en `saves/{session_id}/state.json` (multi-slot, schema versionado). Pos/HP viajan VIVOS en cada save: el sim se ata al NarrativeState con `bindPlayerRuntime` al sembrarlo (solo `bridge/world-claim.ts` pone y quita esa atadura; hay candado), `save()` tira de él antes de serializar, y el resume restaura posición, HP y entities. El cliente no escribe el save nunca: recibe el estado por el wire (`sessionDataForClient`). El runtime volátil (player.pos, hp vivo, enemies) vive en `GameStore` y se escribe solo vía `dispatch()`.
- **Asset library indexada** — el asset-store (:8767, `cache/manifest.sqlite3`) traquea con su prompt TODO el arte pagado: las superficies pintadas (`surface`) y, desde #376, el arte de personaje (`sprite_sheet` + `sprite_hero`, que entran PINEADOS bajo `character:{hero_key}` porque no hay keep-list de personaje). El invariante NO es «un solo kind» sino **ningún kind SIN productor**: los siete que se quedaron sin él se archivaron en `archivo/cache/` con sus filas en `manifest-retirado.json`, y el store se niega a arrancar si reaparece uno (`scripts/manifest-kinds-con-productor.ts`). Claude recibe la librería en cada request narrativa y reusa por DESCRIPCIÓN verbatim, no por hash.
- **StreamDiffusion descartado** — abandonado, incompatible con CUDA 12.4. Usar diffusers nativo + TAESD + LCM-LoRA.
- **Rendering IA frame-by-frame archivado** — 1.3 FPS en RTX 3060, flickering. Enfoque actual: escenas estáticas con texturas IA y entidades dinámicas.
- **MCP bridge sobre API directa** — usuario tiene Claude Max, no necesita API key.
- **En desarrollo, subir iluminacion ambient** para ver bien objetos y geometria.
- **Pre-producción: cero compatibilidad hacia atrás.** El juego no está en producción, así que NADA se conserva por ser antiguo: ni saves, ni campos de contrato, ni ramas de código que solo sirven a un formato ya retirado, ni los tests que los defienden. Un formato que se sustituye **se borra el mismo día**, entero y en todos los procesos (`grep` del campo a cero, no "documentado como legacy"). Cuando el juego esté en producción y haga falta, la respuesta será **versionar los contratos**, no acumular ramas de compatibilidad. Corolario práctico: si al retirar algo aparece la pregunta "¿y los saves viejos?", la respuesta hoy es que no importan.
- **Tests obsoletos se borran** junto al cambio que los deja sin sentido (mencionándolo en el resumen). Un test cuyo sujeto es un formato retirado se va con él. Lo único que no se hace es dejar un test de comportamiento VIVO alimentado con datos de un formato muerto: o se pasa la fixture al formato vivo, o se borra el test declarando qué cobertura se pierde. El material de sesión (runs de labs, capturas) sí requiere confirmación antes de borrarse.
- **Logica en nefan-core, el cliente solo pinta** — prepararse para cambio de renderer. Datos compartidos (escenas, config) en nefan-core.
- **Sin root motion en las hojas de sprites** — las locomociones de Mixamo llevan el desplazamiento horneado y el personaje se sale de la celda, así que **sprite-forge** (las hojas de personaje viven en un repo aparte, servicio en :8770) congela Hips en XZ en los clips marcados como locomoción (walk/run/strafe, preservando Y para que sobreviva el balanceo). Corolario: para los ataques hay que elegir animaciones SIN pasos (attack(4), slash, slash(5), slash(3)) — las que los tienen deslizan los pies al congelar Hips.
- **Tests automatizados tras cada cambio visual** — `node qa/run.mjs`. Verificar las capturas de `qa/capturas/`.
- **Una sola vista, y es la primera persona de three.js** (agosto 2026). La oblicua y el plató proscenio daban demasiados problemas y se retiraron enteros: código, contrato, protocolo, save, datos y packs. Colisión desde huellas, nunca desde píxeles pintados.
- **El motor narrativo NUNCA emite SVG ni dibuja: solo planes declarativos** (`ground`+`volumes`) que los builders greybox de nefan-core convierten en escenas 3D deterministas renderizadas con three.js en el cliente (el clay es el arte del modo sin imagen, y es gratis). Los compositores SVG se eliminaron en agosto de 2026 con las dos vistas que los usaban.

## Hardware

RTX 3060 12GB, Linux (Ubuntu, kernel 6.8), Ryzen 7 5800X. Chrome/Chromium con WebGL2.
