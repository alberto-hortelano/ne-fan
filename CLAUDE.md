# Never Ending Fantasy — Guia de desarrollo

RPG de **mundo abierto generativo** con motor Godot 4.6+ y cliente 2D HTML. El motor narrativo (Claude vía MCP) crea escenas open-world con `generate_scene` y va añadiendo entidades (NPCs, edificios, objetos) dinámicamente a medida que la historia avanza. Si en una conversación el jugador dice "quiero ir a la forja a comprar un arma", el motor narrativo genera una forja, instancia un herrero, etc. Assets IA (texturas PBR, modelos GLB), personajes Mixamo 3D, combate cuerpo a cuerpo real-time. La escena viaja en UN formato compartido: el motor produce Format D, el bridge lo normaliza a world scene (`formatDToWorld`) y ambos clientes (2D y 3D) pintan esa misma forma. Los JSON de `data/rooms/` son fixtures de test en formato world scene (menú F12).

**Juegos = mundos.** Un juego es `nefan-core/data/games/{id}/`: `game.json` (título, descripción, `style_id` por defecto, `world_brief` ~1.2k chars) + `world.md` (documento completo del mundo en 10 secciones: identidad, geografía, historia, pueblos, facciones, magia, vida cotidiana, semillas de conflicto, el jugador, registro) + `plugins/`. NO hay historia predefinida ni beats scripted: la historia la improvisa el motor narrativo dentro del mundo. Juegos base: `alta_fantasia` (Miravanda), `cuentos_oscuros` (Valdesombra), `toledo_1200` (histórico). Un **estilo** es `data/styles/{id}/`: `style.json` (`style_token`, cover, `tags` temáticos, refs, **`ui`** = tema de la interfaz de juego) + imágenes de referencia LIBRES en carpetas por vista (`overworld/`, `proscenium/`, `fps/` con la lámina `role: fps_surfaces`, `characters/`; ver `data/styles/README.md`). Cada ref declara `{id, file, description}` — sin categorías: el contenido depende del mundo (una catedral, una estación espacial…). El MOTOR NARRATIVO elige la ref de cada escena (`style_ref`, catálogo `world.style_refs` en su contexto; pre-flight fail-loud en narrative-mcp) y la de cada NPC (`style_ref` en la entity, `npcSkinStyleRef`); sin elección, el server usa la primera ref de la vista (orden del manifest). `game.json` declara `tags` que casan con los del estilo por intersección (`styleCompatibleWithGame`): el selector del título filtra por vista Y por tema (un pack medieval no se ofrece para un mundo futurista); `start_session` avisa sin abortar. El `id` de una ref entra en la clave de caché de imagen (renombrarlo repaga; renombrar `file`/`description` no). El estilo se elige en el título y queda CONGELADO en el save. El jugador puede crear su mundo (borrador → kind MCP `develop_world` → `data/games/user_*`, con `tags` obligatorios) y subir su estilo (imágenes con vista+descripción+tags → `/styles/upload` → confirmación de coste → `/styles/{id}/complete` genera las refs declaradas que falten; CLI: `python ai_server/tools/build_style_pack.py`; migración de packs de la era de categorías: `nefan-core/scripts/migrate-style-packs.ts`). Schemas en `nefan-core/src/games/loader.ts` + `src/games/style-refs.ts` (fuente de verdad).

## Dónde está lo demás

Este fichero entra ENTERO en cada sesión, así que solo contiene lo que se aplica
siempre: cómo arrancar, los contratos que nadie puede romper y las convenciones.
Lo demás vive en `docs/arquitectura/` y se lee **cuando toca**:

| Documento | Léelo cuando… |
|-----------|---------------|
| [`mapa.md`](docs/arquitectura/mapa.md) | no sepas en qué carpeta o proceso encaja un cambio |
| [`vistas.md`](docs/arquitectura/vistas.md) | toques renderer, cámara, colisión o pipeline de imagen del cliente 2D (oblicua, proscenio, fps) |
| [`narrativa.md`](docs/arquitectura/narrativa.md) | toques la generación de escenas, el diálogo o las consequences del motor |
| [`ia-servicios.md`](docs/arquitectura/ia-servicios.md) | vayas a tocar algo que GASTA CRÉDITOS, o los tres procesos Python |
| [`plugins.md`](docs/arquitectura/plugins.md) | añadas un sistema de juego (manifest declarativo) o una implementación intercambiable de hot loop |
| [`ui.md`](docs/arquitectura/ui.md) | toques la interfaz in-game o el tema de un style pack |
| [`arranque.md`](docs/arquitectura/arranque.md) | conduzcas el juego sin manos (remote control :9876) o hagas testing visual de Godot |
| [`qa/README.md`](qa/README.md) | tengas que verificar algo del cliente 2D: guiones ejecutables, no prosa |

## Lo que ya NO se comprueba leyendo

Estos invariantes tienen **candado ejecutable**; no hace falta recordarlos, porque
fallan solos. Antes ocupaban media página de prosa y se ignoraban igual:

| Herramienta | Qué sujeta |
|-------------|-----------|
| `nefan-core/data/contract/arch-rules.json` (+ `test/architecture.test.ts`) | fronteras: lógica en core y clientes que solo pintan, dirección de dependencias, módulos puros sin `node:*`, three.js solo en sus tres renderers, Godot sin conversión celdas→metros, fail-loud por capa. `npm test` los verifica |
| `nefan-core/data/contract/quality-thresholds.json` (`npm run crap`) | complejidad × cobertura: tope de no-empeorar y suelo de cobertura |
| `stryker.config.json` (`npm run mutate`) | si los tests se enterarían de un cambio, no solo si pasan por la línea |
| `qa/run.mjs` | que el juego real hace lo que se dice, desde el arranque |
| `test/contract-model-io.test.ts` | que los prompts y tools del modelo no divergen del zod |
| `.claude/hooks/ci-verde.sh` (hook `Stop`) | que nadie da una tarea por terminada con el CI de su PR pendiente o en rojo. Verde en local NO es verde: el runner tiene otro sistema de ficheros y ninguna caché |

Si vas a añadir una regla a este fichero, pregúntate antes si puede ser una de
esas. La prosa se olvida a mitad de contexto; un test que falla, no.

**El backlog sale de ahí, no de un documento**: `npm run deuda` (en `nefan-core`)
deriva la cola de trabajo de esas mismas herramientas — violaciones congeladas,
funciones sobre el objetivo de CRAP, mutantes supervivientes — y avisa cuando una
medida está obsoleta. Un item desaparece de la cola cuando se arregla, no cuando
alguien se acuerda de tacharlo. Lo que ninguna herramienta mide (trocear un
fichero, una funcionalidad nueva) va a **issues de GitHub**, que se cierran desde
la PR.

## Arrancar el juego

```bash
# Launcher interactivo (recomendado):
./start.sh
```

Sin argumentos, presenta un menú con presets que respetan dependencias entre servicios y, cuando se necesita el motor narrativo, pausan para que abras Claude Code en otra terminal:

| Preset | Servicios | Cuándo |
|--------|-----------|--------|
| 1 · Play | asset-store + gpu-worker + remote-gen + bridge + narrative-mcp + ai_server + pausa Claude Code + Godot + HTML | Sesión narrativa completa — GASTA créditos con Imagen IA |
| 2 · Story web | como Play sin Godot | Historia/NPCs/mapas/diálogo con el cliente 2D; pre-generación de mundo/estilo desde el título — GASTA créditos con Imagen IA |
| 3 · Automated tests | bridge + asset-store + Godot headless (xvfb) | `python3 godot/tools/movement_test.py` y similares — sin coste |
| 4 · Cliente web (dev) | bridge + asset-store + remote-gen + HTML | Iterar UI/renderer 2D (las 3 vistas; fps y estilos operativos) — solo gasta si activas Imagen IA en el juego |
| 5 · E2E sin créditos | fake-ai-server (:18765) + bridge (`NEFAN_AI_SERVER`) + HTML | Bench E2E todo mockeado, 0 créditos; imprime la URL con `?ai=` |
| 6 · Story web sin imágenes | como Story web sin gpu-worker ni remote-gen | Jugar la narrativa en Maqueta 3D / y_bot con los servicios de imagen APAGADOS — imposible gastar en imágenes |
| 7 · Playtest motor (bench) | bridge + ai_server + asset-store, SIN placeholder de narrative-mcp; pausa ANTES de ai_server | Flujo de `labs/narrative/`: el terminal del motor posee :3737; conducir con `game-emulator.mjs` (:9899) |
| 8 · Replay web (película) | replay-server (suplanta al bridge :9877; `LOG=runs/…/events.ndjson`) + HTML | Reproducir una sesión grabada: renderer 2D determinista sin motor ni ai_server |
| 9 · HTML fixtures | solo HTML | Iterar renderer/UI con las fixtures del selector Room, cero backend |
| 10 · Custom | toggle por servicio | Combinaciones puntuales (Godot solo, ai_server solo…) |
| s · Status | — | Listar puertos arriba/abajo (incluye State API :9878) |
| k · Stop | — | Matar todo el stack |

Cosas a tener en cuenta:
- El preflight es condicional: solo comprueba las dependencias de los servicios seleccionados (elegir "E2E sin créditos" no exige Godot ni `.venv`).
- Cada servicio espera al puerto del anterior (`wait_for_port` real, no `sleep` ciego).
- Ctrl+C mata limpiamente todo lo que el launcher arrancó (`trap EXIT`).
- Si detecta saves antiguos en `~/.local/share/godot/.../Never Ending Fantasy/saves/`, ofrece migrarlos a `$PROJECT_DIR/saves/`.
- `NEFAN_EAGER_BIND=0 ./start.sh` no arranca el placeholder de narrative-mcp: el terminal de Claude Code del motor posee `:3737` (flujo de `labs/narrative/README.md`). `NEFAN_GAMES_DIR` se respeta y llega al bridge (juegos de bench aislados).
- Antes de arrancar el bridge se refresca `data/runtime_config.json` (`scripts/dump-config.ts`), como hacen los hooks `predev` de nefan-core.

```bash
# Manual (si prefieres arrancar servicios por separado):
cd ~/code/ne-fan
source .venv/bin/activate
cd nefan-core && npx tsx services/asset-store/server.ts  # asset-store :8767 (blobs+manifest SQLite)
python ai_server/gpu_worker_main.py         # GPU worker :8766 (texturas/modelos/LaMa; opcional)
python ai_server/remote_gen_main.py         # Remote-gen :8768 (Meshy/fal, SAM2, styles; opcional)
python ai_server/main.py                    # AI server :8765 (narrativa; opcional)
cd nefan-core && npx tsx bridge/ws-server.ts  # Bridge TS :9877 (opcional)
cd narrative-mcp && node dist/server.js     # MCP bridge :3737 (opcional)
~/Downloads/Godot_v4.6.1-stable_linux.x86_64 --path godot --rendering-method gl_compatibility
cd nefan-html && npm run dev                # HTML 2D :3000 (opcional)
```

El juego arranca sin ai_server ni bridge — texturas no se generan y el combate queda deshabilitado (los ataques animan pero no aplican daño; la lógica vive en nefan-core). Sin bridge es un modo visual/dev: movimiento, animaciones y las fixtures del menú F12 (el arranque offline carga `robledo_tile`). Para combate y narrativa usar los presets 1–2 (o 6 sin servicios de imagen); para tests headless, el 3.

## Controles in-game

| Tecla | Accion |
|-------|--------|
| WASD | Movimiento |
| Shift | Sprint |
| Espacio | Salto |
| Raton | Camara (3a persona) |
| E | Interactuar con objeto/NPC |
| 1-5 | Seleccionar tipo ataque (quick/heavy/medium/defensive/precise) |
| LMB | Ejecutar ataque |
| H | Toggle History Browser (timeline navegable de la sesión narrativa) |
| F5 | Guardar partida |
| F9 | Cargar partida |
| Esc | Soltar/capturar raton |

## Sistema de combate

**Formula:** `calidad = factor_distancia * factor_precision * factor_tactico * base_damage * weapon_mod`

- **factor_distancia:** 1.0 en distancia optima, lineal a 0 en borde de tolerancia
- **factor_precision:** 1.0 en centro del area, lineal a 0 en borde del radio
- **factor_tactico:** Matriz 5x7 (tipo ataque vs accion defensor, valores 0.7-1.3)

**Flujo:** Seleccionar tipo (1-5) → Click (LMB) → Wind-up (no cancelable) → Impacto → Resolucion

**Tipos:** quick (0.15s, 15 dmg), heavy (0.7s, 45 dmg), medium (0.4s, 25 dmg), defensive (0.3s, 18 dmg + 50% reduccion), precise (0.45s, 40 dmg, area minima)

**Armas:** unarmed, short_sword (rapida, +dmg quick), war_hammer (lenta, +dmg heavy). Modifican wind-up, distancia, area, dano.

**IA enemigos:** Personalidad JSON (aggression, preferred_attacks[], reaction_time). Enemigos estaticos en v1.

**Datos:** Todo en `godot/data/combat_config.json` — editable sin recompilar.

## Formatos de escena (canónicos, compartidos por 2D y 3D)

Hay exactamente DOS formatos, y la conversión entre ellos vive en nefan-core:

**1. Format D** — lo que produce el motor narrativo (`generate_scene`): rejilla 2D (`size{cols,rows,meters_per_cell}` + `terrain[]` strings + `terrain_legend`) con `entities[]` (`kind`, `cell:[col,row]`, `footprint:[w,h]`, `glyph`, `shape?`, `texture_hash?`), y en tiles v3 `tile{tx,ty}` + `biome` + `ground`/`volumes` (declarativos — nada de SVG). Contrato en `nefan-core/data/contract/tools/generate_scene.json`; validador en `src/scene/scene-validate.ts`. Es lo que se PERSISTE (saves, `scenes_loaded`, `serializeForLlm`).

**2. World scene** — el contrato de render que consumen AMBOS clientes: la salida de `formatDToWorld` (`nefan-core/src/scene/scene-normalize.ts`). El bridge normaliza en el wire (`broadcastScene` y el resume vía `sessionDataForClient`); el cliente HTML también la genera en local para fixtures. Forma:

```json
{
  "scene_id": "robledo_village",
  "scene_description": "El pueblo de Robledo...",
  "dimensions": { "width": 120, "depth": 80, "height": 3 },
  "world_rect": { "minX": -60, "minZ": -40, "maxX": 60, "maxZ": 40 },
  "terrain": { "color": [0.18, 0.22, 0.14] },
  "terrain_grid": { "grid": ["..."], "legend": {}, "solid_chars": ["W", "w"] },
  "objects": [
    { "id": "tavern", "shape": "box", "position": [-2, 0, -2], "scale": [8, 1, 4],
      "category": "building", "texture_hash": "b8c2...opcional", "description": "Taberna" }
  ],
  "npcs": [ { "id": "barkeep", "name": "Tabernero", "position": [0, 0, -2] } ],
  "__player_start": { "x": -57, "z": -1 },
  "ambient_event": "..."
}
```

Posiciones y escalas en METROS (anclaje por BASE: `position.y` es la base del objeto). En Godot la construye `scene_builder.gd` (suelo centrado en `world_rect`, default de sol direccional); en HTML el renderer 2D. Godot NUNCA porta la conversión celdas→metros — si le llega un Format D sin normalizar hace push_error (fail-loud).

**Fixtures de test** (`nefan-core/data/rooms/{dev,stress}/*.json`): world scenes escritas a mano — admiten además `lighting{ambient,lights[]}` (si falta, default), `mesh` (alias de `shape`, catálogo box/sphere/capsule/cylinder/cone/plane/torus), `color:[r,g,b]` por objeto (placeholder pre-textura), `terrain.texture_prompt`/`tiling`, y `combat{health,weapon_id,personality}` en objects para spawnear combatientes. `data/rooms/robledo_tile.json` se genera con `npm run dump-scene` desde la escena Format D compartida con el 2D (se commitea; es el arranque offline del 3D).

**Reuse de assets**: cualquier `texture_prompt`/`model_prompt` admite un hermano `texture_hash`/`model_hash`. Si Claude lo proporciona (copiándolo de `available_assets`), Godot carga del cache local sin regenerar.

**Spawn dinámico**: vía consequences `spawn_entity` que devuelve `react_to_player` (señal `narrative_spawn` en Godot, `materializeSpawn` en HTML). Las entidades se materializan en el mundo en runtime sin recargar la escena.

Categorias: item (amarillo), prop (gris), building (marron), creature (rojo), terrain (verde), decor (gris apagado).

**Altura**: cada entity admite `h` opcional en METROS (el footprint sigue en celdas); sin él, `formatDToWorld` aplica `KIND_DEFAULT_HEIGHT` (building 2.5, tree 4, prop 1, item/decor 0.5) y emite `scale.y` real. El 3D la construye tal cual; el 2D la extruye como prisma (`view-prism.ts` + `drawSceneBox`: caras orientadas a cámara, tapa a `−h·verticalScale`) y las cajas altas (>1.2 m) ocluyen al player vía depth-sort con fade. La colisión NUNCA usa la altura (solo huella XZ).

## Convenciones de codigo

- GDScript 4.6+ con tipado estricto (Variant inference = error)
- Variables que acceden propiedades de Node generico: usar tipo explicito (`var x: float = node.health`, NO `:=`)
- class_name en scripts de combat, pero usar preload() en vez de class_name para referencias cruzadas
- Autoloads: GameStore, NarrativeState, AIClient, TextureCache, RemoteControl, LogicBridge, SessionRecorder, SessionPlayer
- Scripts nuevos que referencian otros: `const FooRef = preload("res://scripts/path/foo.gd")`
- Descripciones de objetos y NPC en espanol
- Unidades en metros

### Errores y logging (fail-loud uniforme)

Nunca `catch { /* ignore */ }`, nunca `return null` silencioso, nunca `return []` cuando hubo un error. En `nefan-core` y en los endpoints Python **esto ya lo sujeta el checker de fronteras**; lo que sigue es el canal de cada capa, que ninguna herramienta puede elegir por ti:

- **GDScript**: `push_error(...)` para invariantes rotos (frame mal formado, autoload ausente). `push_warning(...)` para degradación esperable (servicio opcional caído). `print(...)` sólo para trazas informativas que no son errores. Para preconditions duras de un lookup, usar `NodeAccess.must_get_node(root, path, "ctx")` (push_error + retorna null) en vez de `get_node_or_null` desnudo.
- **TS/HTML**: `errors.push("source", msg, err)` (`nefan-html/src/ui/error-log.ts`) en cualquier `catch` recuperable. Lanzar de nuevo si el caller necesita decidir. Devolver `Result<T,E>` (discriminated union `{ok:true,...} | {ok:false,error}`) cuando "vacío" y "error" son indistinguibles si se colapsan.
- **TS/bridge**: cualquier `.catch()` sobre una promise que el cliente está esperando debe broadcastear `narrative_status: error` además de loguear — patrón en `nefan-core/bridge/handlers/dialogue.ts` (`dialogue_choice`).
- **Python/FastAPI**: `raise HTTPException(status_code=..., detail=...)`, **nunca** `return {"error": ...}` con 200 OK. Pydantic `BaseModel` por endpoint para que campos ausentes salgan como 422 estructurado. Modelo de referencia: `/report_player_choice` en `ai_server/main.py`.

Listeners en autoloads compartidos: nodos transitorios usan `SignalLifecycle.auto_disconnect(self, autoload.signal, callback)` para que la subscripción muera con el nodo. Autoload→autoload se documenta en línea (`# OK: autoload, vida == app`).

## Equipo de agentes (roles y coordinación)

El trabajo sustancial se hace en equipo: la **sesión principal coordina** (habla con el
usuario, fija los requisitos, decide y delega) y tres roles especializados viven en
`.claude/agents/`:

| Rol | Qué hace | Qué NO hace |
|-----|----------|-------------|
| `arquitecto` | Dónde encaja el cambio (nefan-core / bridge / clientes / ai_server), contratos y formatos afectados, qué hay que borrar (claves de caché incluidas), mejoras estructurales. Produce `plan.md` | No escribe código de producción |
| `ingeniero` | Implementa y **demuestra** que funciona: `npm run verify` verde, la deuda que toca sin crecer y los supervivientes de mutación del módulo que tocó, muertos. Produce `implementacion.md` | No improvisa desviaciones en silencio; no commitea sin que se le pida |
| `qa` | Valida contra la petición ORIGINAL desde el punto de vista del jugador: estados del sistema, flujo real desde el arranque, regla del workaround, pasada adversarial, crítica visual. Produce `qa.md` **y un guion ejecutable** en `qa/guiones/` de lo que sea mecánico | **No arregla nada** — reporta |

Los subagentes arrancan con **contexto limpio y no se ven entre sí**: todo el handoff viaja
por ficheros (ver `docs/agents/README.md`). Lo que no esté escrito ahí, para ellos no existe —
empezando por la cita literal de la petición del usuario en `requisitos.md`. Los cuatro
documentos viven en `docs/agents/<tarea>/`, pero solo se commitean `requisitos.md` y `qa.md`
(qué se pidió y qué se verificó): `.gitignore` deja fuera el plan y el informe de
implementación, que envejecen mal y a los tres meses son documentación falsa.

**Cuándo se dispara** (regla del coordinador, sin esperar a que lo pidan): cualquier tarea que
toque más de un fichero de lógica, cambie un contrato o un formato, o sea observable por el
jugador → ciclo completo `requisitos → arquitecto → [visto bueno del usuario] → ingeniero →
qa`. Un typo, un color o una pregunta se hacen directamente: el ciclo cuesta cuatro contextos
y no debe salir más caro que el trabajo. `/feature <descripción>` fuerza el ciclo entero;
`/final-check` es la verificación de objetivo en solitario, sin equipo.

Los hallazgos de QA vuelven al **mismo** ingeniero con `SendMessage` (conserva su contexto).
Dos vueltas sin converger = el requisito está mal escrito; parar y consultar al usuario.

## Decisiones de diseno importantes

- **Modo de juego canónico: open-world generativo.** El motor narrativo crea una escena base con `generate_scene` y va añadiendo entidades en runtime sin recargar (NPCs, edificios, objetos) según las elecciones del jugador.
- **Un solo formato de escena para ambos clientes.** El motor produce Format D; el bridge lo normaliza a world scene con `formatDToWorld` (nefan-core) antes de emitir, y 2D y 3D pintan esa misma forma. Nada exclusivo de un cliente en el schema de escena; Godot no proyecta celdas (fail-loud ante Format D crudo).
- **NarrativeState como save canónico, con el bridge como único escritor** — todo el playthrough vive en `saves/{session_id}/state.json` (multi-slot, schema versionado). Con bridge conectado, la sesión es la del bridge (plugins incluidos): el mirror GD se hidrata en memoria (`bridge_authoritative`) y su `save()` está bloqueado; pos/HP se snapshotean en `save_session` y el resume restaura posición, HP y entities. Offline, el mirror GD guarda en local. El runtime volátil (player.pos, hp vivo, enemies) vive en `GameStore` y se escribe solo vía `dispatch()`.
- **Asset library indexada** — el asset-store (:8767, `cache/manifest.sqlite3` desde F2; `manifest.json` queda congelado como rollback) traquea todo lo generado con su prompt. Claude lo recibe en cada request narrativa y puede reusar por hash.
- **StreamDiffusion descartado** — abandonado, incompatible con CUDA 12.4. Usar diffusers nativo + TAESD + LCM-LoRA.
- **Rendering IA frame-by-frame archivado** — 1.3 FPS en RTX 3060, flickering. Enfoque actual: escenas estáticas con texturas IA y entidades dinámicas.
- **MCP bridge sobre API directa** — usuario tiene Claude Max, no necesita API key.
- **En desarrollo, subir iluminacion ambient** para ver bien objetos y geometria.
- **Pre-producción: cero compatibilidad hacia atrás.** El juego no está en producción, así que NADA se conserva por ser antiguo: ni saves, ni campos de contrato, ni ramas de código que solo sirven a un formato ya retirado, ni los tests que los defienden. Un formato que se sustituye **se borra el mismo día**, entero y en todos los procesos (`grep` del campo a cero, no "documentado como legacy"). Cuando el juego esté en producción y haga falta, la respuesta será **versionar los contratos**, no acumular ramas de compatibilidad. Corolario práctico: si al retirar algo aparece la pregunta "¿y los saves viejos?", la respuesta hoy es que no importan.
- **Tests obsoletos se borran** junto al cambio que los deja sin sentido (mencionándolo en el resumen). Un test cuyo sujeto es un formato retirado se va con él. Lo único que no se hace es dejar un test de comportamiento VIVO alimentado con datos de un formato muerto: o se pasa la fixture al formato vivo, o se borra el test declarando qué cobertura se pierde. El material de sesión (runs de labs, capturas) sí requiere confirmación antes de borrarse.
- **Logica en nefan-core, Godot solo visual** — prepararse para cambio de motor. Datos compartidos (escenas, config) en nefan-core, no en godot/.
- **AnimationTree con StateMachine (Souls-Like pattern)** — no usar AnimationPlayer directo. `travel()` para transiciones, `start()` para interrupciones.
- **Sin root motion** — todo el movimiento via velocity del CharacterBody3D. Animaciones puramente visuales. Lockear Hips XZ solo en walk/run.
- **Camara independiente** — no es hija del player. Sigue al body con lerp + SpringArm3D. Player excluido del SpringArm collision.
- **No usar animaciones con pasos para ataques** — causan sliding de pies al lockear Hips. Usar animaciones estáticas (attack(4), slash, slash(5), slash(3)).
- **Tests automatizados tras cada cambio visual** — `python3 godot/tools/movement_test.py`. Verificar screenshots.
- **Proyección oblicua 2D única** (suelo cenital sin proyectar + cizalla en la altura: cara sur iluminada, cara este en sombra) — sustituyó a la doble perspectiva topdown/isometric. Colisión desde huellas, nunca desde píxeles pintados.
- **El motor narrativo NUNCA emite SVG ni dibuja: solo planes declarativos** (`ground`+`volumes`, bloque `stage`) que los builders greybox de nefan-core convierten en escenas 3D deterministas renderizadas con three.js en el cliente (clay = arte del modo vector Y plano base del repintado). Los compositores SVG (oblicua y proscenio) se eliminaron en agosto de 2026; los benches labs/render (E2a) y labs/escenografia/greybox son la evidencia.

## Hardware

RTX 3060 12GB, Linux (Ubuntu, kernel 6.8), Ryzen 7 5800X. Godot 4.6.1 con `gl_compatibility`.
