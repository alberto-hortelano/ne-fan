# REENCUADRADA — son TRES tandas, no una, y la más barata no está en el título

| Issue | Veredicto | En una línea |
|---|---|---|
| #272 | **VIGENTE** | `qa/run.mjs` sin tocar desde `1f4e99d`; no hay chequeo de vida entre guiones ni distinción falló/no-pudo-correr |
| #283 | **REENCUADRADO** | El mecanismo del issue es falso: el tmp no lo borra «el sistema», lo borra `limpiarTmpViejos()` de la corrida siguiente |
| #271 | **REENCUADRADO** | La causa principal no es la lectura de puertos: es que `start.sh` **mata** por puerto al arrancar (9 sitios) |
| #274 | **REENCUADRADO** | Mayor y menor a la vez: el mecanismo ya existe (guion 20 lo usa), pero los puertos son 4 copias y el disco compartido no lo arregla ningún puerto |
| #287 | **VIGENTE, y es de una línea** | Diagnosticado: el guion 25 es el ÚNICO que busca la tarjeta de save sin esperar la lista |
| #247 | **OBSOLETO como está escrito** | Su premisa («el umbral no tiene sujeto») murió: la causa es dato del bench — el tabernero nace dentro del prop `mostrador` |

## El problema real, en una frase

No es «el banco miente»: son **tres averías con tres sujetos distintos** —qué significa el veredicto del runner (#272, #283), quién puede correrlo a la vez (#271, #274) y dos guiones concretos mal escritos (#287, #247)—, agrupadas por síntoma y no por sujeto.

## La premisa, afirmación por afirmación

| Afirmación del requisito | Verificación |
|---|---|
| «#272 puede estar medio arreglado ya» | **Falso.** `git log -- qa/run.mjs` termina en `1f4e99d`, anterior a las tres tandas de hoy. `main()` (`run.mjs:410-461`) no sondea el stack entre guiones, y el resumen (`:465-468`) imprime `✔/✘` desde `r.ok` tirando el campo `fatal` que sí guarda (`:460`) |
| «#283: el tmp lo borra el sistema» | **Falso, y el mecanismo real es peor.** El tmp vive en `qa/.tmp/<runid>` (`run.mjs:63`), dentro del repo. Lo borra `limpiarTmpViejos()` (`run.mjs:181-187`), que corre en `prepararDisco()` **antes** de `ensureStack()` (`:393-394`): la corrida nueva le arranca el disco al stack heredado y acto seguido decide usarlo (`:112-114`). Se lo hace a sí misma |
| «#283: `salir()` no corre» | **Cierto.** `run.mjs:175-177` registra solo `SIGINT`/`SIGTERM`. No hay `unhandledRejection` ni `uncaughtException` — y el precedente existe en el repo (`nefan-core/bridge/ws-server.ts:123`) |
| «#271 y #274 pueden ser el mismo issue» | **Son el mismo sujeto** (dos corridas en una máquina) con dos síntomas. Se funden |
| «#274: los puertos son constantes en dos sitios» | **Menor de lo que dice** en el mecanismo: `NEFAN_BRIDGE_PORT`/`NEFAN_STATE_HTTP_PORT` ya los respeta el bridge (`ws-server.ts:41,43`), el guion 20 ya levanta el suyo aparte (`20:87-88`) y el cliente ya resuelve TODA URL por query param (`nefan-html/src/net/service-urls.ts:16-29`: `?ai=` reapunta narrative-llm + remote-gen + asset-store; `?bridge=`, el gateway). **Mayor** en el alcance: hay **cuatro** copias de la tabla, no dos — el dueño declarado (`src/contracts/service-registry.ts` → `CONFIG.ports` → `data/runtime_config.json`), `start.sh:16-24`, `qa/run.mjs:60,61,103-107,275`, y `:9878` a mano en 5 guiones (14,15,17,25,29) + `qa/lib/saves.mjs:58` |
| «#274: lo que ya está bien y no hay que romper — `start.sh` no mata lo ajeno» | **Falso en la mitad que cuesta la corrida.** Eso vale para el apagado. Al ARRANCAR, `start.sh` hace `port_busy X && kill_port X` (`fuser -k`) en **nueve** sitios: `:162,184,196,205,214,243,277,297,311`. Arrancar el bridge mata el bridge de quien esté; arrancar el cliente mata el `:3000` de quien tenga el navegador abierto. Ese es el «el otro worktree soltó los puertos a mitad» de #271 |
| «#287: intermitente por la carga de la máquina» | **Falso, y es determinista.** El aserto que cayó es «el título sigue ofreciendo la partida» (`docs/agents/2026-08-25-el-bosque-es-uno/qa.md:280`), o sea `25:269-272`. Ahí el guion hace `esperarTituloListo` y a continuación un `page.$` **instantáneo**. Pero `#ts-new` se pinta en el `innerHTML` síncrono (`title-screen.ts:395-400`) y las tarjetas solo después de `await listSessions()` (`:441`). La espera correcta existe y está documentada para esto (`qa/lib/sesion.mjs:56`): **la usan 12, 17, 18, 19, 27 y 29 — el 25 es el único que no**. En batería hay más saves, `list()` tarda más (#224) y la carrera se pierde |
| «#247: su umbral no tiene sujeto» | **Superado.** El propio repo lo cerró ayer: el tabernero arranca en la celda (60,52) y el prop `mostrador` ocupa `rect [55,51,6,2]` — `labs/narrative/fake-ai-server.mjs:119` y `:266`, verificado. Con «salir sí, entrar no» se despega 0,73 m y el aserto pide 1. No es un umbral sin sujeto ni un NPC que huye tímido: es **el bench colocando al NPC dentro de un sólido** |
| «cada rojo dice de quién es» | Vale para #272/#283. Para #287 y #247 no hay nada que atribuir: los dos están diagnosticados hasta el fichero y la línea |

**No he corrido `qa/run.mjs` ni una vez.** Los seis están decididos leyendo código, y correrlo habría sido arriesgar justo lo que critico: mi `limpiarTmpViejos()` borra el disco de cualquier corrida ajena en vuelo, y mi `start.sh` mataría su `:3000`. Que el crítico no pueda usar el banco sin peligro es la prueba de #274 mejor escrita que ninguna medida.

## El día después

- **Si los puertos dejan de ser constantes.** Para el cliente no cambia nada: ya resuelve por `?ai=`/`?bridge=`. Lo que se rompe es el conocimiento tácito — «abre localhost:3000», `curl :9878/health`, la tabla de presets de `CLAUDE.md`, `qa/README.md`, `labs/narrative/README.md`— y la capacidad de asomarse a un stack ajeno para depurarlo. **Consecuencia para el alcance: el desplazamiento tiene que ser opt-in y los números de hoy seguir siendo el default**, o la persona con el navegador abierto paga la comodidad de los agentes. Hoy paga algo peor: cualquier agente que arranque le mata el `:3000` (`start.sh:311`).
- **Lo que toca dinero, y es lo más peligroso de #274**: el guardarraíl de «cero créditos» reconoce al motor falso **por su número de puerto** — `qa/lib/sesion.mjs:20`, `/:18765(\/|$)/`. Un puerto por instancia lo deja ciego, y lo que hoy protege es el click que cuesta dólares. Cualquier diseño de B tiene que mover ese reconocimiento a algo que no sea un número antes de tocar el puerto del fake.
- **Qué se rompe además, medido**: `qa/presets.mjs:59,66` **parsea `start.sh` con regex** (`^PORT_STATE=(\d+)` y las etiquetas `":\d+"` de `SERVICE_LABELS`, `start.sh:390-400`), así que cambiar la sintaxis de las nueve asignaciones tumba la validación de presets; y `nefan-core/test/service-registry.test.ts:29-31,41` afirma las URL literales.
- **Hay un fallo latente hoy mismo**: `start.sh` no exporta ni un puerto a sus hijos (solo `NEFAN_AI_SERVER`, `:174`, y el `--port` de sprite-forge, `:262`). Como el bridge y el asset-store **sí** honran sus env, exportar `NEFAN_BRIDGE_PORT` antes de `./start.sh` arranca el bridge en otro sitio mientras el launcher mata y espera el puerto viejo. La media puerta ya está abierta y no lleva a ningún sitio.
- **Qué habría que borrar y nadie borrará**: las copias de la tabla —`start.sh:16-24`, `qa/run.mjs`, `vite.config.ts:26`, los `:9878` de los guiones— y el literal `ws://127.0.0.1:3737` de `ai_server/llm_client.py:50`, que ni siquiera lee el snapshot que ya tiene el dato. Si sobrevive una, es #280 otra vez («una copia a mano se desvía el mismo día»).
- **Qué se vuelve más difícil**: adjuntarse a un stack que no arrancaste. El `--url` de `run.mjs` promete eso hoy y no lo cumple — solo cambia `BASE` (`:60`); `FAKE_AI` (`:61`), `medirListSessions` (`:275`) y los cinco `:9878` siguen clavados. Esa media puerta hay que cerrarla o abrirla del todo.
- **La trampa de quitar el `kill_port`**, que le debo a mi propia recomendación: `nefan-html/vite.config.ts:26` es una quinta copia (`port: 3000`) y **no lleva `strictPort`**. Hoy no se nota porque `start.sh:311` mata el `:3000` antes; en cuanto deje de matarlo, vite se irá solo a `:3001` en silencio y `waitPort(3000)` (`run.mjs:142`) esperará 90 s a un puerto de otro. Quitar el `kill_port` y poner `strictPort` van en el mismo cambio o el arreglo abre un fallo peor.
- **Lo que ningún puerto arregla**: `qa/.tmp` y `qa/capturas` son estado compartido. `limpiarTmpViejos()` (`:181-187`) borra el disco de la otra corrida, `rmSync(SHOTS)` (`:390`) le borra las capturas y `saves.mjs:35-40` lee `qa/.tmp/*/saves` de **todas** las corridas. Dos corridas con puertos propios seguirían destrozándose.
- **Qué parecerá arbitrario en un mes**: un offset derivado del nombre del worktree, si no queda escrito quién es el dueño de `:9977`.

## Conflictos

- **#275 (CPU) es co-requisito, no vecino.** #274 se vende como «caben dos agentes»; con `npm test` a 919% y la batería a 47% durante 182 s, lo que #274 entrega de verdad es «dos agentes no se corrompen», no «dos agentes caben». Decirlo así o la tanda promete lo que no da.
- **#261 tiene un agujero recién abierto.** Afirma «el 15 es el único» guion cuya espera degrada en verde. El fallo del 25 es de otra especie —**ni siquiera hay espera**, hay un `page.$` seco—, así que el invariante que #261 propone no lo habría cazado. Rehacer su censo antes de diseñarlo.
- **#247 está bloqueado por su propio racimo**: #284 (mismo guion), #262 (¿el sim o el diseño?) y #289 (NPC que nacen dentro de sólidos — los cuatro del corpus, `barkeep` incluido). Tocar el guion 15 sin decidir #289 es cementar el síntoma.
- **#282** (el tile de una sesión muerta sobrevive al siguiente intento) es otra vía de contaminación entre guiones de la batería: mismo apellido que #287, no el mismo issue.
- **#280** es el precedente de la copia a mano que se desvía; el `fake-ai-server` es la quinta copia de la tabla de puertos.
- Nada choca con `arch-rules.json`: **no hay ninguna regla que prohíba copiar un puerto a mano**, y esa ausencia es el hueco por el que entraron las cuatro copias.

## Coste contra valor, y el orden seguro

«No hacer nada» cuesta una investigación por rojo espurio (dos esta semana, medidas) y la máquina serializada. Pero el runner es el instrumento que sujeta todo lo demás: **romperlo cuesta más que los seis issues juntos**. Y hay una asimetría que decide el orden: #272/#283/#287 son ~40 líneas dentro de `qa/`, con precedente en el repo y verificables sin arrancar nada; #271/#274 tocan `start.sh`, cuatro tablas y el disco compartido.

**Orden seguro: A → C → B.**

- **A (ahora, misma tanda): #272 + #283.** Que el runner diga la verdad sobre sí mismo. Es el instrumento con el que se mide todo lo demás, incluido B.
- **C (ahora, misma tanda, y es casi gratis): #287** —una línea, `esperarListaDeSaves` en `25:268`— y **la mitad de dato de #247**: sacar al `barkeep` del rect del `mostrador`, o declarar por escrito que el guion 15 mide un NPC acorralado a propósito.
- **B (tanda propia, después): #271 + #274 fundidos**, y su primer paso no son los puertos: es **dejar de matar por puerto lo que no arrancaste** (`start.sh`, 9 sitios). Eso solo ya devuelve la mitad de #271 y es lo único de B que no puede esperar. El camino barato para el resto existe y no es inventar `NEFAN_PORT_BASE`: `data/runtime_config.json` ya es el canal que llega a Python, narrative-mcp y `qa/sprites-sin-servicio.mjs:55`; que `start.sh` lo **lea** en vez de declarar sus nueve constantes cierra casi todos los acoplamientos de golpe.

Lo que **no** debería hacerse en esta tanda: rediseñar el esquema de puertos, tocar el sim de huida (#262), ni escribir el candado de #261 —su censo está mal—, ni subir un solo timeout.

## Qué le cambiaría a `requisitos.md`

Sustituir el título y el criterio de terminado por:

> **Título:** «El runner dice la verdad sobre sí mismo (#272 #283) — y dos guiones dejan de mentir (#287 #247)». #271 y #274 se funden en un issue y salen de esta tanda a la siguiente.
>
> **Criterio de terminado:**
> 1. Una corrida cuyo stack se cae **para** y lo dice; el resumen distingue «falló» de «no se pudo ejecutar» (el campo `fatal` ya existe en `run.mjs:460` y hoy se tira).
> 2. Un runner que muere por una promesa rechazada apaga su stack (`unhandledRejection` + `uncaughtException` → `salir()`, patrón de `ws-server.ts:123`); y `limpiarTmpViejos()` deja de borrar el disco de un stack que la propia corrida va a heredar.
> 3. El guion 25 espera la LISTA de saves, no el título (`qa/lib/sesion.mjs:56`), como ya hacen 12, 17, 18, 19, 27 y 29.
> 4. El guion 15 deja de medir un NPC que nace dentro del prop `mostrador` (`labs/narrative/fake-ai-server.mjs:119,266`) — o se declara por escrito que eso es lo que mide.
> 5. Nada de esto se cumple subiendo un timeout.
>
> **Fuera de alcance, con motivo:** los puertos (#271+#274) — su primer paso es que `start.sh` deje de matar lo ajeno al arrancar, y eso merece su propia tanda con el runner ya honesto delante.
