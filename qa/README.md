# qa/ — guiones de QA ejecutables

El rol `qa` (`.claude/agents/qa.md`) valida contra la petición ORIGINAL desde el punto de vista de
quien juega. Buena parte de ese trabajo es juicio —crítica visual, fricción, estados sin salida,
la regla del workaround— y no se automatiza. Pero la otra parte sí: *"el jugador camina hasta ahí
y no atraviesa el muro"* es una afirmación que o se vuelve a comprobar a mano cada vez, o queda
como prosa que alguien tiene que creerse.

Esto es lo segundo: **guiones que conducen el juego real y devuelven verde o rojo**.

```bash
node qa/run.mjs                  # todos
node qa/run.mjs colision hud     # los que casen con esos nombres
node qa/run.mjs --headed         # con ventana, para mirar qué hace
node qa/run.mjs --keep           # deja el stack arriba al terminar
node qa/run.mjs --url http://…   # contra un stack ya arrancado, en esa URL
node qa/run.mjs --adoptar        # contra el stack que ya esté en los puertos del catálogo
```

El runner levanta él mismo el preset **`e2e-sin-creditos`** (`./start.sh --preset e2e-sin-creditos`:
fake-ai-server + bridge + cliente) — cero créditos — y **elige un bloque de puertos libre**
(`NEFAN_PORT_OFFSET` 0, +100 … +900, con reserva atómica en `qa/.tmp/.bloques/`), así que dos
corridas a la vez conviven sin pisarse. Todo lo que la corrida posee cuelga de su `RUN_ID`: el
disco efímero (`qa/.tmp/<run>/{saves,games,logs}`), las capturas (`qa/capturas/<run>/`, con
`qa/capturas/ultima` apuntando a la última) y los logs del stack (`NEFAN_LOG_DIR`).

**Engancharse a un stack ajeno es opt-in.** Encontrarse los puertos ocupados ya no es una
comodidad: puede ser el stack de otro agente de la máquina, y medirlo sale VERDE midiendo otro
código. Sin `--adoptar` (o `--url`), el runner busca otro bloque; si no queda ninguno, lo dice.

Dos guiones sueltos, fuera de la batería, que van con esto:

```bash
node qa/guardarrail-sin-creditos.mjs   # ¿se NIEGA el guardarraíl de gasto en los 7 casos malos?
node qa/dos-corridas.mjs               # ¿terminan DOS baterías a la vez, midiendo cada una lo suyo?
```

Y la pregunta que se le hace a la batería entera —¿se puede poner ROJA?— vive en
`qa/bateria-candados-en-negativo.mjs`, con sus dos hermanos, más abajo.

## Cómo se escribe un guion

Un fichero en `guiones/` que exporta `async (ctx) => {}`. El contexto ofrece:

| | |
|---|---|
| `ctx.nefan(path, ...args)` | llama o lee `window.__nefan.<path>` |
| `ctx.waitFor(desc, fn, ms, arg)` | espera a que `fn` (en la página) devuelva algo truthy |
| `ctx.holdUntil(key, desc, fn, ms, arg)` | mantiene una tecla hasta que se cumple `fn`, y la suelta siempre |
| `ctx.expect(desc, cond, detalle)` | apunta un criterio; los fallos deciden el veredicto |
| `ctx.expectEspera(desc, debeOcurrir, fn, {ms, arg, tecla, aserto})` | espera y AFIRMA si ocurrió o no: un umbral, escrito una vez. `debeOcurrir:false` es «el timeout ES el éxito» |
| `ctx.absorbe(motivo, fn)` | consume la expiración de una espera DICIENDO dónde vive la medida de verdad (cortafuegos de un bucle que remide, esperas que solo sirven para una foto) |
| `ctx.sinMedir(motivo)` | declara «no pude medir» y ABORTA el guion: sale `⊘` con su motivo, aparte de verdes y rojos (y degrada la corrida a exit 2) |
| `ctx.sinMedirBloque(motivo)` | lo mismo para UN bloque, sin abortar: el guion sigue midiendo los demás |
| `ctx.shot(label)` | captura a `qa/capturas/<RUN_ID>/` |
| `ctx.page` | la página de Playwright, para lo que no cubra lo anterior |

Reglas que hacen que un guion valga algo:

1. **Nunca esperes por tiempo de pared, y no dejes expirar una espera sin mirarla.** El
   movimiento va por delta de rAF y el typewriter por `setInterval`: ningún `sleep` es
   determinista. Espera por ESTADO (`waitFor`). Los `maxMs` son cortafuegos, no la condición de
   parada — pero un `waitFor` cuya condición no se cumple nunca es un sleep con mejores modales,
   así que **toda expiración se anota y alguien tiene que observarla** (#261): o propaga, o la
   afirma `ctx.expectEspera`, o la absorbe `ctx.absorbe` diciendo dónde vive la medida. Lo que
   expire sin observador es un fallo con nombre y el guion sale ROJO; el `.catch(() => null)`
   sobre una espera dejó de ser gratis. Y cuidado con el hueco entre el umbral de la ESPERA y el
   del ASERTO: si la espera pide más que el `expect`, queda una banda garantizada de «expiró y
   verde igual» — `expectEspera` existe para escribir el umbral una sola vez. Corolario que costó un guion intermitente: si el
   estado que quieres afirmar es TRANSITORIO (el destello de impacto del telegraph dura 0,3 s
   de tiempo de sim, y el sim corre con el `delta` del game loop topado a 0,1 s), ningún
   observador externo puede garantizar verlo por mucho que muestree más fino — el problema no
   es la resolución, es que la ventana la mide un reloj distinto del que consume el estado. Eso
   se arregla haciendo que el juego lo RECUERDE (un recuento en `debugState()`), no bajándole
   el listón al guion.
2. **Nunca leas píxeles.** Los asserts van contra `window.__nefan`; las capturas son para que un
   humano las mire, no para decidir el verde.
3. **Entra por el camino del jugador.** Cerrar el título es pulsar `#ts-close`, no `display:none`;
   viajar es pisar la zona *y confirmar*, no teletransportarse. Si para ver algo hay que forzar el
   estado, eso es un hallazgo, no un paso de la receta.
4. **Prueba el guion en negativo.** Rompe a mano lo que dice verificar y comprueba que se pone
   rojo. Un guion que no detecta nada se ve exactamente igual que uno que funciona.
5. **Declara lo que necesitas, y solo declara el gasto si NO lo hay.** Dos `export` que el runner
   ejecuta. `export const aisla = ["saves"|"mundo"|"fake-ai"]` es la PRECONDICIÓN del guion: se
   ejecuta solo eso, y solo antes de él. Y el guardarraíl de cero créditos se ejerce para
   **todos** los guiones —antes de abrir el tuyo, desde su página, con sus dos `/health`—, así
   que si el backend no declara ser falso tu guion sale `⊘ SIN MEDIR` y **cero peticiones desde
   el guion**: su cuerpo no llega a ejecutarse. Cero *desde el guion*, no cero a secas — la
   página ya ha cargado y el gate manda sus dos `/health`, y ninguna de esas es de pago, que es
   justo lo que se garantiza.
   No hay nada que declarar para eso: es el defecto, y el defecto es el caro a
   propósito, porque el desenlace de un descuido tiene que ser un ⊘ y no una factura.
   Lo que se declara es la EXCEPCIÓN: `export const sinMotor = "<motivo>"` para el guion que no
   le pide nada al motor (fixtures del selector, el título, su propio bridge). El motivo va en el
   valor y es obligatorio: un booleano se pone a `true` sin pensar y se lee dos veces, y una
   frase hay que escribirla y se ve en el diff. Si te equivocas al declararlo —dices `sinMotor` y
   el guion gasta— lo caza el contador de rutas de pago del motor falso y sale ⊘ igual (#295).
6. **Una precondición perdida se DECLARA, no se `return`.** Si a mitad de guion falta lo que hace
   posible medir (la fixture no está en el selector, el estado que ibas a ejercer no existe),
   `ctx.sinMedir(motivo)` — nunca un `expect` fallido más `return`: ese rojo dice «lo que
   defiendo está roto» cuando lo que pasó es «no pude medir», y ese verde-a-medias mide otra
   cosa (#331). Declarar ABORTA el guion y sale `⊘`. No es una vía de escape: el ⊘ degrada la
   corrida MÁS que el rojo (exit 2 contra 1), y un guion que ya empujó fallos no puede
   reconvertirse — un ⊘ es una declaración, no una amnistía. Si lo que se pierde es UN bloque y
   el guion puede seguir midiendo los demás, `ctx.sinMedirBloque(motivo)`, que no aborta: es la
   versión honesta del `if (…) { ctx.log("⚠ … no se midió"); return; }`, que salía VERDE.

## Los guiones sembrados

| Guion | Qué protege |
|---|---|
| `01-arranque-y-fixture` | El flujo real desde el título (el estado donde más regresiones se cuelan) y que el game loop corre de verdad en headless |
| `02-colision-desde-huella` | La colisión sale de la huella declarada, nunca de los píxeles |
| `03-hud-de-ataques` | El HUD se genera desde el catálogo del sistema de combate de la sesión |
| `05-terreno-desde-ground` | El suelo declarativo (`ground`) se rasteriza al grid y de ahí sale la colisión — incluido un tile generado EN VIVO al explorar, no el snapshot de pre-generación |
| `06-solidos-de-la-leyenda` | `solid_chars` y `{name, solid:false}`: el jugador cruza el río por el puente y rebota contra el agua; declarar el agua vadeable le abre el paso |
| `07-npc-clave-del-skin` | `role`/`style_ref`/`description` sobreviven a `formatDToWorld`, y partida y batch de estilo derivan la MISMA clave de caché (si divergen, el skin se paga dos veces) |
| `08-viaje-a-place-sin-realizar` | Viajar a un destino del panel "Salidas" que el motor aún no ha realizado: se realiza al pisarlo, no antes |
| `09-viaje-de-vuelta` | La vuelta desde un place ya visitado reusa lo generado en vez de volver a pagarlo |
| `10-fps-telegraph-etiquetas-y-niebla` | Los cuatro huecos de la primera persona: mirada vertical, telegraph del ataque, nombre del NPC bajo la mirilla y muro de niebla en la frontera. El telegraph se afirma sobre el RECUENTO que lleva el renderer (`fps().telegraphEpisode`), no muestreando una ventana de reloj: el episodio lo consume el `delta` topado del game loop y una ventana de pared convierte el guion en una moneda al aire |
| `11-un-solo-contexto-webgl` | La pestaña abre UN contexto WebGL y solo uno (criterio central de "solo la vista 3D"): se cuenta envolviendo `getContext` antes de cargar la app, no leyendo imports |
| `12-una-sola-vista-sin-eleccion` | La otra cara de ese criterio, la que el jugador toca: que en NINGUNA de las cinco pantallas de una partida nueva —ni en el panel «Salidas», ni en el selector de fixtures, ni en el HUD, ni en una tecla— se le ofrezca o se le nombre una vista que ya no existe. Nació en rojo por el `<title>` de la pestaña ("— 2D"); **verde desde #206**, que lo corrigió |
| `13-personajes-animados` | Que el juego sigue teniendo gente después de tirar el motor que la renderizaba (retirada de Godot, 2026-08-22): las 10 hojas del set base de `y_bot` servidas y COMPLETAS —el último frame que promete cada `meta.json`, que es el que falta cuando un render se corta—, y en una partida real un NPC que se mueve solo y un jugador que anda. Desde #217 afirma además que un estático que NO existe devuelve **404**: hasta entonces el dev server contestaba con el `index.html` de la SPA (200 `text/html`) y ningún `r.ok` sobre `/sprites/**` podía ponerse rojo — el guion tenía que apuntalarse con el `content-type`, que se conserva porque el mismo camino se sirve desde el build y desde el asset-store, donde no hay Vite. Y cierra el estado del CLON LIMPIO (#255): sin hojas, el registro nombra el set que falta y el documento que explica cómo generarlas, con el remedio como primera entrada del panel |
| `14-plugin-evoluciona-sin-perder-la-partida` | Que el motor pueda hacer EVOLUCIONAR un sistema de juego a mitad de partida sin que el jugador pierda lo que tenía (#164): antes, un `plugin_register` con la versión siguiente no migraba — añadía un SEGUNDO sistema con el mismo nombre y el slice de cero, así que el mercado en el que acababas de comprar quedaba huérfano y los dos ejemplares se suscribían al mismo evento. Se juega el caso entero por el camino real, sin fixtures |
| `15-guardia-se-ve-y-se-comporta` | Que un NPC declarado GUARDIA se distinga del resto en las dos cosas que el jugador nota (#173): pide OTRA ref de personaje para su skin (`warrior` frente al `commoner` de sus vecinos, sin que ninguno declare `style_ref`) y, ante el MISMO ataque a su lado, se ACERCA al punto de la pelea mientras el mercader se ALEJA. El `07` no lo cubre: allí basta con que `style_role` no venga vacío, así que pasaría en verde con todo el pueblo vestido y comportándose igual. Gotcha del bench: el motor falso solo tiene hoja `idle` y su 500 en `walk` apaga los skins de la sesión entera, así que la mitad del «se ve» se mide en pestaña nueva sobre `robledo_tile` leyendo el LIBRO de skins (lo que el juego PIDIÓ), no el cable |

| `16-scatter-esquiva-el-suelo` | Que la vegetación derivada no plante troncos en la calzada ni sobre el agua (#174), medido por donde duele: el jugador RECORRE el camino real en vez de quedarse clavado. El daño no es visual — cada árbol derivado estampa un disco de tronco, así que uno en la calzada deja ~1 m bloqueado. Aparta y no vacía: los volúmenes siguen ahí, solo que ninguno en la banda. El paso 5 canda que la exclusión NO toque los volúmenes que el motor coloca a mano (un `pozo` a caballo de dos caminos): fugarla a `entities` deja el objeto en la lista y le quita la colisión — pérdida silenciosa |
| `17-la-partida-se-guarda-y-se-reanuda` | Que lo que el motor escribe por el State API (`map_*`, `inventory_*`, `npc_*`, `plugin_register`) llegue AL DISCO y siga ahí después de reanudar desde el título. El save no se escribe solo: cada handler devuelve `mutated: true` y el borde llama a `onMutation` → `narrative.save()`. Perder ese flag no cambia ninguna respuesta —200, mismo body, y en caliente se lee bien porque la NarrativeState viva ya lo tiene—, así que ningún test de status lo caza. Se miden las once escrituras UNA A UNA contra el `state.json` de disco, y no solo el «sobrevive al resume»: probado en negativo, con `upsertPlace` sin marcar el lugar SEGUÍA estando tras reanudar, porque la siguiente mutación que sí guardó se lo llevó de paso |
| `22-telegraph-ensena-el-borde` | Que con el ataque preparado el jugador vea HASTA DÓNDE llega, y que lo vea también en un puerto (#184 + #185). Dos fallos del mismo parche: la alfa del shader ERA la calidad del golpe, así que la rampa roja del borde tenía alfa cero y solo se veía el punto dulce; y el parche se dibujaba a 0,2 m mientras el suelo crecía 2 mm por prim sin tope, de modo que `puerto_tile` —quince rasgos, ninguna rareza— lo dejaba en 0,219 m y el telegraph desaparecía ENTERRADO bajo el embarcadero. Se mide sin leer píxeles: `fps().suelo` da la cara alta REAL de los calcos instalados frente a la cota del parche, y `fps().telegraph.borde` proyecta a píxeles del lienzo los dos extremos del alcance. El borde CERCANO no se exige en cuadro: con la espada corta —el arma que el cliente equipa siempre— cae a 0,2 m del jugador, y exigirlo sería exigir que se mire las botas |
| `23-telegraph-los-cinco-ataques-y-todo-suelo` | Los dos estados que el 22 deja fuera, seguidos por QA. **Los cinco ataques del catálogo, no dos**: cada tipo publica SU alcance, ninguno pinta el área del anterior y el borde lejano cae en cuatro alturas de pantalla distintas — si el parche dejara de seguir la selección, o dibujara siempre lo mismo, el jugador vería el límite de otro golpe. **Todas las fixtures del selector, no dos**: el techo del suelo es constante POR CONSTRUCCIÓN, así que la afirmación fuerte no es «en el puerto hay holgura» sino que la cara alta es la MISMA con 0, 14 o 57 calcos; y revisitar un tile no la mueve. Una captura por tipo de ataque para la crítica visual |
| `24-el-selector-de-fixtures-no-se-calla` | Que si el módulo de una fixture del selector «Room» no carga, el cliente lo DIGA (#248). Antes el `change` soltaba la promesa de `loadSceneFile` y el selector era un no-op MUDO: el `<select>` mostraba la fixture nueva, el mundo se quedaba en la anterior y no había ni entrada en el registro de errores ni línea en el juego. Los dos candados de #248 —`no-floating-promises` y `html-sin-promesa-muda`— impiden que el idioma vuelva a escribirse así, pero **ninguno de los dos puede ver la PANTALLA**: quitarle el `alFallar` a `paso()` los deja a los dos en verde. El fallo se inyecta en el BORDE (la petición del JSON se aborta), no dentro del cliente. Probado en negativo devolviendo `loadSceneFile(value);` a su sitio: ninguna entrada, ninguna línea y el juego siguiendo en la escena anterior. Afirma además la OTRA mitad del bug, que sobrevivió al primer arreglo: que el `<select>` **vuelva** a la fixture que se está viendo. Decir «no cargó» y dejar la etiqueta en la que falló cambia el fallo mudo por uno que MIENTE — los dos mensajes se van del log en ocho líneas y el desplegable se queda. Ese aserto nació como `ctx.log` (hallazgo abierto del QA) y se ascendió en el commit que lo arregló |

| `25-mirar-fixtures-no-se-lleva-la-partida` | Que asomarse al selector «Room» NO toque el `state.json` de la partida que se estaba jugando, y que el modo fixtures siga siendo jugable después de una partida en el mismo bridge. Es el caso con el que se justificó la desviación del plan de #245 (`simDriver` en vez de `isSubscribed`): «F5 → título → cerrar el título → fixtures». Nació ROJO (QA, 2026-08-25): `handleLoadRoom` —el único sitio que soltaba la atadura del save al sim— era inalcanzable desde el cliente, que solo mandaba `load_room` para escenas que NO son tile y las tres fixtures del selector son tiles; así que el muñeco de la fixture entraba en el save de la partida viva y «Reanudar» te dejaba ahí. Verde desde `bridge/world-claim.ts`, que junta en un solo hecho quién tiene el mundo y a qué escucha el save, y desde que el selector vuelve a anunciar que lo toma |

| `26-las-portadas-del-selector-no-mienten` | Los dos estados de la portada de un mundo en el selector (#218). Sin ella, ninguna tarjeta se queda con el icono de imagen rota del navegador —lo PRIMERO que veía quien abría el bench, en las cuatro tarjetas y desde #207—: cae al marcador con el nombre del estilo, ese marcador **dice que la portada falló** (que es distinto de un pack que todavía no tiene arte: se veían idénticos) y el fallo deja entrada en el registro nombrando estilo y ruta. Con el bench sirviéndolas —el fake copia `GET /styles/{id}/{file}` del asset-store— las cuatro se pintan de verdad (`naturalWidth > 0`), sin ninguna queja. El sabotaje va en el BORDE y se pone ANTES de pedir ninguna portada, para que el bloque de control las pida por la red y no de la caché |
| `27-el-clon-limpio-quiere-jugar` | Qué se le dice a quien clona el repo y pulsa «Comenzar» sin las hojas de personaje (#255 p2), que es el camino que el `13` no recorre porque cierra el título por el botón de fixtures. **Nació ROJO** (QA, 2026-08-25): el aviso del título decía «El servidor del juego no pudo completarlo; inténtalo de nuevo» —un fichero que falta disfrazado de servidor con hipo, y con un consejo que no puede funcionar nunca— porque `motivoDeSesionParaElJugador` no reconocía el rechazo de `preloadBase`. Verde desde que ese rechazo lleva CÓDIGO (`character_sheets_missing`, constante compartida) y la traducción tiene su rama: nombra las hojas y el documento que explica cómo generarlas. Afirma además que el juego no deja al jugador colgado y que el registro lo sabe aunque el título lo esconda |
| `28-la-portada-repintada-tampoco-miente` | El segundo estado de #218, el que el `26` no toca: la tarjeta se repinta ENTERA (`card.outerHTML`) al pulsar un mundo o cambiar el estilo del desplegable, y son las dos únicas vías por las que se ve la portada de un pack que no es el defecto de ningún mundo. Que ahí no vuelva el icono roto era lo que el plan quería asegurar con un barrido de `naturalWidth === 0`; no hizo falta porque el listener de CAPTURA sobre la raíz del título ve también a los hijos que nacen después — pero eso era una deducción sobre el DOM, y esto lo mide |
| `29-la-partida-existe-cuando-el-jugador-entra` | Los tres estados del ACK que hace existir la partida (#279), y el que el `27` dejó de recorrer al arreglarse. **El clon limpio DE VERDAD**: con el 404 de las hojas contestado al INSTANTE —lo que hace un dev server con un fichero que no está— el orden real es `sesión → abandonar → addTile(active=false)`, o sea el vestido falla ANTES de que llegue el tile; el `27` mide el orden contrario porque es el único con el que su aserto puede ponerse rojo, así que este recorre el del issue. **El ack en sí**, que ningún guion medía: un arranque que falla no manda ninguno y uno que sale bien manda EXACTAMENTE uno, con su id — sin eso, un cliente que dejara de mandarlo se vería igual que uno que lo manda. Y **la ventana provisional en vivo** (criterio 5): reteniendo las hojas por ESTADO, el mundo se pinta con el título todavía delante, la partida aún no existe en disco y la tecla `H` —que pide `resume_session` de una partida que no está— ya no deja la sesión viva sin sistemas de juego (`GET /plugins` antes y después). Probado en negativo: sin la guarda de existencia de `save()` el bloque 1 se pone rojo; con la conjunción rota, el bloque 3 |

| `46-un-save-que-no-vale-no-revive-a-ciegas` | Las puertas del save de #334/#336, por el camino real (partida jugada → `state.json` corrompido en disco → resume). En PROTOCOLO: un save con una entity que viola el contrato (`footprint:[8,8]` en npc, el caso #300) contesta `save_invalido` nombrando save, escena, entity y campo; un `schema_version: 4` contesta `save_invalido` nombrando la versión; y un id inexistente sigue siendo `session_not_found` — los dos canales que antes colapsaban en `false`. Para el JUGADOR: «Reanudar» sobre el save corrupto no cuelga ni monta el mundo corrupto (vuelve al título con error visible), y restaurado el fichero el mismo resume carga — el rechazo era del contenido, no de la ruta. Probado en negativo neutralizando el gate de `loadSession` a mano: el resume del save corrupto salía `ok:true` y el guion se ponía rojo en la línea exacta. Lo que NO asserta, a propósito: el TEXTO que lee el jugador (hoy cae al genérico «inténtalo de nuevo» — hallazgo abierto del QA de la tanda) |

| `48-el-mundo-vuelve-como-lo-dejaste` | Que lo que el motor pone a mitad de conversación siga ahí al REANUDAR (#326): un hostil, un NPC pacífico, un objeto y un edificio, que no están en el Format D de ninguna escena y hasta esa tanda desaparecían enteros. Afirma las cuatro clases pintadas, que el herido vuelva con su vida y sobre su denominador (60), que se le pueda PEGAR —volver pintado no basta: sin el alta en el sim el jugador le atraviesa la espada— y que el pacífico no ande invisible (el bridge lo mueve y el cliente tiene su cuerpo). Y sin duplicados: un id repetido es la señal de que alguien abrió una segunda puerta. Fuerza el guardado de la herida por el cable del motor (State API), como el 17: pegarle a alguien no guarda la partida. Probado en negativo quitando la rehidratación del resume |
| `49-el-mundo-de-runtime-aguanta-dos-resumes` | Lo que el motor puso a mitad de conversación aguanta REANUDAR DOS VECES (#326). El guion 48 mide UN resume; la segunda puerta no se ve ahí, se ve cuando el mundo rehidratado se vuelve a guardar y a rehidratar encima — si el resume dejara al spawn en el ledger por partida doble, el segundo traería dos Nogalas o dos barras con el mismo nombre. Y la otra mitad del criterio que ningún guion recorría andando: **el muerto no vuelve para la procedencia de RUNTIME** (el 42 lo mide con el enemigo de la ESCENA y el unitario con un `EntityRecord` a mano; aquí el motor pone el enemigo, el jugador lo mata, reanuda y no está — mientras el resto de lo que puso el motor sí). Probado en negativo por dos piezas: sin el `materializeSpawn` del resume cae el bloque 1, sin el guardado al morir de `handleInput` cae el bloque 3. Mide además, con la marca `⚠ HALLAZGO` y sin poner nada en rojo, que un OBJETO o EDIFICIO de runtime desaparece al re-emitir su tile (viajar por «Salidas» y volver): `addTile` purga `objectEntities` por rect, el resume lo repara y por eso no incumple el criterio, pero es la misma promesa rota antes |
| `50-el-npc-que-el-cliente-no-tiene-se-dice` | Que un NPC que el bridge MUEVE y el cliente no tiene deje de caerse callado (criterio 6 de #326). El defecto que tapaba el `continue` mudo de `main.ts`: `npcSync` rehidrataba al pacífico de un spawn de runtime, el `state_update` lo nombraba frame a frame y el cliente lo tiraba sin decir nada — **andaba invisible**. Es su ÚNICO candado: `nefan-html` no tiene tests y el guion 48 mide el caso bueno, que no pasa por esa rama. Al estado se llega sin trucar el cliente: se rompe en el SAVE el `combat` de la entity pacífica (un `data.combat` sin `max_health`, lo que trae un save anterior a la tanda), y entonces `spawnsDeRuntime` la rechaza mientras `npcSync` la sigue moviendo. Afirma las dos mitades —que quede registro y que quede EXACTAMENTE una entrada, porque el `state_update` llega a 60 fps—. Probado en negativo devolviendo el `continue` mudo |
| `51-un-personaje-caido-no-desviste-a-los-demas` | El radio del cortacircuitos de skins (#236), que es lo que el jugador ve: cuántos vecinos se quedan en maniquí cuando el backend se atraganta con UNO. El primer 5xx apagaba la generación de la sesión ENTERA y devolvía el mundo de gente idéntica que #173 vino a arreglar, sin salida salvo recargar. El fallo se inyecta en el BORDE —500 solo para la descripción del primer personaje que pide skin, las demás pasan al motor falso— y se afirma el criterio de cierre del issue literal: el saboteado se queda sin skin y lo DICE, y otro personaje distinto tiene una anim LISTA. Afirma además las dos mitades que el issue no pide y la crítica sí: UNA entrada de registro por fallo (el `else if (!backendDown)` dejaba mudo todo 5xx posterior al primero, y quitar el flag de sesión lo habría convertido en el camino normal) y que el fusible no desaparece — por debajo del umbral la sesión NO se apaga, alcanzado el umbral se anuncia una sola vez. Es su ÚNICO candado: `nefan-html` no tiene tests ni mutación. Probado en negativo bajando `UMBRAL_APAGADO_DE_SESION` a 1 (el comportamiento de antes): el bloque 2 se pone rojo — ningún otro personaje llega siquiera a pedir su hoja |

**Nota**: los guiones `18`–`21` no tienen fila en esta tabla; se sembraron sin ella.

## El tercer ejecutable: `qa/fixtures-sin-bridge.mjs`

`presets.mjs` daba VERDE a `html-fixtures` mientras el juego renderizaba **negro**: levantar el
puerto no es cumplir la promesa (issue #215). El preset existe para *«iterar renderer y UI con
las fixtures del selector Room, cero backend»*, y eso solo se comprueba mirando si pinta.

```bash
node qa/fixtures-sin-bridge.mjs            # arranca html-fixtures, mide y para (~40 s)
node qa/fixtures-sin-bridge.mjs --headed   # con ventana
node qa/fixtures-sin-bridge.mjs --keep     # deja el stack arriba
```

Vive fuera de `guiones/` por la razón contraria a `presets.mjs`: el runner levanta
`e2e-sin-creditos`, que lleva bridge, y aquí el sujeto es justo **no tenerlo**.

Dos cosas que aprendió el arreglo y que conviene no volver a descubrir:

- **El veredicto no son píxeles.** `getImageData` sobre un canvas WebGL sin
  `preserveDrawingBuffer` devuelve NEGRO aunque el juego esté pintando: durante el arreglo dio un
  falso negativo perfecto, con el pueblo en la captura y el muestreo diciendo 0. Lo que se afirma
  es `fps().frames` —los frames EMITIDOS por `render()`—, y la captura queda para el ojo.
- **Esperar por el estado exacto.** La primera versión esperaba «un botón que ponga Cerrar»; el
  título tiene el suyo y aparece al instante, así que medía el juego 4 s antes de que el bootstrap
  terminara y lo declaraba roto. Se espera por `#narrative-loader` en estado `error`, que es el
  muro del bridge y de nadie más.

Probado en negativo: quitando el visor de `bootstrap()`, `frames 0 → 0` y el guion se pone rojo.

## El otro ejecutable: `qa/presets.mjs`

No todo lo mecánico cabe en un guion de navegador. **¿Arranca cada preset de `./start.sh` lo
que dice?** no se comprueba con una pestaña: se comprueba arrancándolo y mirando los puertos,
que es lo que enseña la tecla `s`. Vive fuera de `guiones/` a propósito —el runner arranca UN
stack y se lo pasa a todos, y esto arranca y para siete—, y no copia ni un dato del launcher:
`SERVICES`, los puertos de `SERVICE_LABELS`, `PRESET_SLUGS` y `PRESET_PROFILES` se leen de
`start.sh`, así que una máscara con una columna de más falla antes de arrancar nada.

```bash
node qa/presets.mjs            # los 7 presets con servicios (~2-3 min)
node qa/presets.mjs e2e html   # solo los que casen
node qa/presets.mjs --lista    # qué comprobaría, sin arrancar nada
```

Lo que caza es el fallo que dejó la retirada del cliente Godot: las máscaras son POSICIONALES
y quitar un servicio las desplaza todas, con lo que un preset levanta el de al lado **sin
decir nada**. Probado en negativo: cambiando `on html` por `on asset-store` en `start.sh`, el
preset `html-fixtures` se pone rojo.

## El cuarto ejecutable: `qa/sprites-sin-servicio.mjs`

Desde que las hojas de personaje las produce **sprite-forge** (repo aparte, :8770),
`/skin_sprite_sheet` es un adaptador y la clave del sheet vestido cuelga de una identidad que
da ese servicio. La primera versión la pedía ANTES de mirar su propia caché, así que con el
servicio caído un sheet **ya pagado** que estaba en disco devolvía 503: todos los NPC en
maniquí y el retrato del diálogo en blanco, teniendo los ficheros ahí. Lo arregla un índice
(`cache/sprite_sheets/_base_keys.json`) y esto es su candado — el adaptador no tiene ni un test.

```bash
node qa/sprites-sin-servicio.mjs           # arranca forge (--sin-skin) + remote-gen, mata forge a media prueba (~40 s)
node qa/sprites-sin-servicio.mjs --reusar  # aprovecha un remote-gen que ya esté arriba (ver abajo)
```

**Se niega a reutilizar un remote-gen ajeno**, y eso es lo que más le costó aprender: Python
carga el adaptador al arrancar, así que un proceso levantado antes de tu último cambio ejecuta
el código VIEJO. Durante la validación de esta tanda, un remote-gen de dos minutos antes hizo
que el guion diera **VERDE con el bug reintroducido a propósito**. Ahora eso es ROJO con su
motivo, y `--reusar` lo dice en voz alta cuando de verdad quieres reutilizarlo.

Cero créditos por construcción, no por confianza: `sprite-forge` arranca **sin worker de
repintado**, así que no hay nada que pueda llamar a un proveedor; las cuatro rutas que ejerce
son caché o error. La cuarta comprobación quita el índice a propósito: si el pagado siguiera
sirviéndose sin él, la segunda estaría pasando por otro camino y no probaría lo que dice.
Probado en negativo: devolviendo el adaptador a su forma pre-arreglo (que la excepción suba
siempre), las comprobaciones 2 y 3 se ponen rojas.

## El quinto ejecutable: `qa/fake-enruta-por-pathname.mjs`

El fake del bench enrutaba comparando `req.url ===`: `POST /skin_sprite_sheet?x=1` daba 404
aquí y 200 en el server real (FastAPI ignora la query al enrutar), y el ref del unpin salía
corrupto con query. La tanda #319 lo arregló con `parseRequestPath(req.url).path`, y esto es
su candado: el typecheck de labs no ve comportamiento runtime y ningún guion del runner llama
al fake con query string — sin esto, la regresión al `===` volvería a pasar en verde. De paso
afirma que `cached` (el campo que #318 metió al contrato) viaja en el wire del fake.

```bash
node qa/fake-enruta-por-pathname.mjs   # arranca su propio fake y lo mata al salir (~5 s)
```

Cero créditos por construcción: el sujeto ES el fake — no existe proveedor que llamar. Los
puertos salen de `PUERTOS_TODOS` (runtime_config vía `lib/stack.mjs`, `NEFAN_PORT_OFFSET` se
honra); con el puerto ocupado se niega y lo dice, no mata a nadie. Probado en negativo:
contra el fake de main (pre-tanda), las 3 comprobaciones en rojo; con el de la rama, verde.

## Los tres `*-candados-en-negativo.mjs`: ¿se pueden poner ROJOS los candados?

No llevan número porque no son un ejecutable más de la serie: son la pregunta que se le hace a
todo lo demás. Cada uno **rompe el fuente a propósito**, corre SU batería, exige que falle y
restaura; se niega a arrancar sobre un árbol sucio y comprueba byte a byte que devolvió lo que
tocó. Van bajo demanda —cuestan lo que cuesta la batería que conducen— y **ninguno entra en
`npm run verify`**.

```bash
node qa/contrato-candados-en-negativo.mjs   # schemas, saneadores y prompts (TS + Python, ~1,5 s cada uno)
node qa/mutacion-candados-en-negativo.mjs   # el ciclo de mutación y su huella
node qa/bateria-candados-en-negativo.mjs    # los guiones que esta batería usa de instrumento (01, 22, 34, 44)
node qa/contrato-candados-en-negativo.mjs python   # los tres aceptan filtro por nombre
```

Existen por una frase del usuario —**«nacen rojos»**— y por lo que la contradecía: en dos tandas
seguidas se colaron seis criterios que ya estaban satisfechos antes de empezar. Un informe que
dice «lo vi rojo» es una afirmación; esto es una prueba, y se vuelve a hacer cada vez que alguien
lo ejecute.

El de la batería (`bateria-candados-en-negativo.mjs`, #308/#320/#331) añade una exigencia que
los otros dos no tienen: **el veredicto tiene que NOMBRAR la causa**. Un rojo genérico no vale,
porque el defecto de #308 se manifestaba como un aserto del telegraph fallando tres pasos más
abajo — un veredicto correcto que no se puede diagnosticar. Y distingue el `⊘` del rojo: si la
corrida no llegó a medir (salida 2 del runner), no dice nada del guion y no cuenta como éxito —
salvo que el candado ESPERE un ⊘ (`codigoEsperado: 2`), que es como se prueban las dos caras
del canal de #331: precondición rota → ⊘ declarado con su motivo, y con fallos ya empujados →
la reconversión se veta y el guion queda en rojo.

Los guiones que necesitan una PARTIDA real (no una fixture) comparten el arranque del
título en `qa/lib/sesion.mjs`; `qa/lib/sonda.mjs` (`nefan`/`waitFor`, vía `ctxDeSonda(page)`) es
la MISMA sonda para el runner y para los scripts sueltos (`fixtures-sin-bridge`,
`captura-de-fixture`), y `qa/lib/fixtures.mjs` (`cargarFixture`) es cómo un guion AFIRMA qué
fixture midió — `qa/lib/` no lo recorre el runner, solo `qa/guiones/`.
`07` dispara generación de skins: se niega a correr si `?ai=` no apunta al fake-ai-server.

Un guion **no puede nombrar** los identificadores ingleses de las dos vistas retiradas ni
ningún otro campo de contrato muerto: `qa/**/*.mjs` es root de la regla
`campos-retirados-no-vuelven` (`nefan-core/data/contract/arch-rules.json`) y escribirlos pone
`npm run verify` en rojo — pasó al sembrar el `12`. De que no vuelvan al CÓDIGO se ocupa ese
candado; un guion cubre lo que el candado no puede ver, que es la PANTALLA. Cuando haga falta
mirar nombres internos, se afirma con **lista blanca** (lo que debe haber), no con lista negra.
