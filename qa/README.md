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

## Lo que corre el CI

Hasta T11 (#357) el CI no tocaba `qa/` (cero menciones en `ci.yml`), y el 2026-09-05 un candado
llevaba un día rojo en `main` sin que nadie lo supiera: `mutacion-reparto-en-lotes` exigía «más de
un módulo sin cronometrar» sobre el plan real, #440/#445 cronometraron los 41, y nadie lo corrió.
Un candado en negativo también envejece. Desde entonces el job **`candados-headless`** de
`.github/workflows/ci.yml` corre, un paso por ejecutable, los que no abren navegador. Tiempos
medidos en local el 05-09 (Ryzen 7 5800X), en el orden del job: los que solo leen antes que los que
escriben en el árbol y restauran, y `contrato-` —que se niega sobre ficheros sucios— detrás.

| Dentro | Tiempo | Qué necesita del runner |
|---|---|---|
| `el-npc-cruza-ai-server-con-role-y-description.mjs` | 2 s | python3 con `uvicorn`+`anthropic`, `dist/` del core |
| `mutacion-reparto-en-lotes.mjs --solo-vigentes` | 6,5 s | tsx; escribe y restaura la huella y `reports/` |
| `el-selector-ve-lo-que-la-bateria-abre.mjs` | 2,6 s | `typescript` de nefan-core; solo lee |
| `mutacion-candados-en-negativo.mjs` | 36 s | tsx; escribe y restaura `mutacion-huella.ts` y la huella |
| `mutacion-cableado-en-negativo.mjs` | 26 s | el tag `mutacion-ultima` y su historia (`fetch-depth: 0`); escribe y restaura |
| `contrato-candados-en-negativo.mjs` | 3,5 s | tsx + `python3 -m unittest`; exige SUS ficheros limpios |
| `el-ledger-de-gasto-no-lo-escribe-la-suite.mjs` | 45 s | python3 con las deps de la suite de ai_server |

| Fuera | Por qué |
|---|---|
| `qa/run.mjs` y los 70 guiones de `qa/guiones/` | preset `e2e-sin-creditos` + Chromium: corrida local. Un job de navegador en CI es programa aparte, con su reloj medido antes |
| `bateria-candados-en-negativo.mjs`, `esperas-candados-en-negativo.mjs` | parecen headless y **no lo son**: spawnean `qa/run.mjs` (preset + Playwright) |
| `fake-enruta-por-pathname.mjs` | su observable (`POST /skin_sprite_sheet?x=1 → 200`) depende de que el fake encuentre `nefan-html/public/sprites/paladin/idle/frontal_8/meta.json`, que es arte GENERADO y gitignored: en un clon limpio contesta 500 y el guion sale rojo (medido el 05-09: verde en el checkout del usuario, rojo en un worktree recién clonado). Entra el día que la ruta se pruebe sin leer del disco |
| `el-arte-de-personaje-…`, `el-indice-del-store-…`, `perfil-de-repintado-…`, `sprites-sin-servicio` | levantan asset-store, remote-gen o sprite-forge (Python del `.venv`); nadie los ha cronometrado. Candidatos siguientes, con reloj medido antes |
| `guardarrail-sin-creditos`, `dos-corridas`, `fixtures-sin-bridge`, `captura-de-fixture`, `capturar-portadas`, `presupuesto-de-volumenes`, `presets`, `no-mata-lo-ajeno`, `parar-clasifica-los-nueve-puertos` | conducen el runner, un Chromium o `start.sh` sobre los puertos del catálogo de la máquina |

La otra mitad de #357 no corre en el job sino en `npm test`: todo módulo de `qa/lib` lo importa
algún test de `nefan-core/test/` (dirección **test → banco**; `qa/` nunca entra en producción,
regla `el-banco-no-entra-en-produccion`) o está eximido con motivo en
`nefan-core/data/contract/banco-medido.json` (`test/qa-lib-tiene-quien-lo-mire.test.ts`; los 7
exentos conducen navegador, disco o sockets). `qa/lib` NO entra en mutación ni en el CRAP.

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
| `06-el-rio-solo-se-cruza-por-el-puente` | `solid_chars` los fija el engine (agua y muro): el jugador cruza el río por el puente y rebota contra el agua, y ni el puente ni el camino bloquean |
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
| `51-un-personaje-caido-no-desviste-a-los-demas` | El radio del cortacircuitos de skins (#236), que es lo que el jugador ve: cuántos vecinos se quedan en maniquí cuando el backend se atraganta con UNO. El primer 5xx apagaba la generación de la sesión ENTERA y devolvía el mundo de gente idéntica que #173 vino a arreglar, sin salida salvo recargar. El fallo se inyecta en el BORDE —500 solo para la descripción del primer personaje que pide skin, las demás pasan al motor falso— y se afirma el criterio de cierre del issue literal: el saboteado se queda sin skin y lo DICE, y otro personaje distinto tiene una anim LISTA. Afirma además las dos mitades que el issue no pide y la crítica sí: UNA entrada de registro por fallo (el `else if (!backendDown)` dejaba mudo todo 5xx posterior al primero, y quitar el flag de sesión lo habría convertido en el camino normal) y que el fusible no desaparece — por debajo del umbral la sesión NO se apaga, alcanzado el umbral se anuncia una sola vez. Es su ÚNICO candado: `nefan-html` no tiene tests ni mutación. Probado en negativo bajando `UMBRAL_APAGADO_DE_SESION` a 1 (el comportamiento de antes): el bloque 2 se pone rojo — ningún otro personaje llega siquiera a pedir su hoja **Bloque 4 (tras el QA de la tanda)**: que «rearmar el cortacircuitos» rearme también a los PERSONAJES. `rearmarCortacircuitos()` limpiaba el flag y la cuenta pero no el recuerdo de los que ya habían fallado, y `requestSkin` sale antes para un personaje con estado y sin `force`: con el manager como singleton de módulo, el vecino caído se quedaba en maniquí toda la vida de la pestaña — ni volver al título ni reanudar lo recuperaban, que es justo el gesto que la tanda cableó como rearme. Se ejerce por el chip de gráficos (Personajes OFF y otra vez ON, el mismo `applyRenderModes`) y se mide el DELTA de arte, no el estado final: en el banco toda hoja que no sea `idle` da 500, así que exigir `failed:false` sería exigir hojas que el motor falso no tiene. Probado en negativo quitando el olvido: expira esperando un arte que no llega |
| `52-borrar-una-partida-dice-que-paso` | Los TRES desenlaces de «Borrar» en la pantalla (#365). `deleteSession` devolvía `res.ok` como booleano y el título lo TIRABA: un borrado rechazado era un no-op mudo —la lista se repintaba igual, la tarjeta volvía al instante y no había una línea que dijera por qué—, y ese `ok:false` colapsaba además «no estaba» (ENOENT) con «no se pudo» (EACCES/EBUSY). La mitad de arriba la canda el TIPO —el frame es una unión discriminada y un `failed` sin motivo no compila—; lo que ningún tipo puede ver es la pantalla, y `nefan-html` no tiene suite. Los dos fallos se inyectan en el BORDE: `failed` quitándole el permiso de escritura al directorio del save (EACCES de verdad, sin tocar una línea de código) y `not_found` borrándolo por el cable del bridge mientras el título sigue enseñando su tarjeta. Afirma que la partida que no se pudo borrar SIGUE en la lista con su motivo accionable, que la que ya no estaba se va SIN llamarlo fallo, y que el borrado bueno no anuncia nada ni se lleva de paso el save de al lado. Probado en negativo devolviendo el `deleteSession(id).catch(() => undefined)` y el repintado incondicional: el bloque 1 expira esperando una reacción que no llega **Tras el QA**: los dos desenlaces se leían distinto pero se VEÍAN igual (mismo rojo, mismo hueco), y el aviso del fallo eran tres líneas de ruta absoluta sin señalar su tarjeta. Ahora el guion afirma también que «ya no estaba» NO se pinta con el rojo de un fallo (para quien pulsó Borrar es un éxito), que la frase accionable va DELANTE de la causa técnica, y que la tarjeta que falló se distingue de sus vecinas. Ese último aserto nació siendo un verde vacío —miraba `borderColor !== ""` y `sessionRowHtml` ya pinta un borde inline a todas, así que pasaba con la marca quitada— y se cambió por la comparación con las vecinas, que sí se pone roja |
| `53-el-umbral-de-skins-se-mide-en-el-rango` | El UMBRAL del cortacircuitos de skins (#236) recorrido ENTERO: 1 personaje caído, 2 y 3. Lo escribió QA al validar la tanda porque el 51 solo puede ejercer la mitad de abajo — el tile de entrada del motor falso tiene DOS personajes, así que su aserto de «alcanzado el umbral, se anuncia UNA vez» viaja como condicional sobre una condición que ese escenario nunca cumple, y media rama del cambio (justo la que decide que el fusible de COSTE sigue existiendo) se quedaba sin ocupante. Escenario: la fixture `robledo_tile`, que trae CINCO vecinos, con el número de caídos como variable. Afirma que con 1 y con 2 la sesión NO se apaga y los sanos se visten, que con 3 se apaga y lo dice UNA vez con el número, el umbral y «y_bot» dentro, y que en el banco sin sabotear ni un fallo se queda mudo. Dos condiciones inyectadas en el borde: 500 a las víctimas y 404 a `walk`/`run` de los demás — sin ese 404 el motor falso (que solo tiene hoja `idle`) tumba a los cinco y el umbral se alcanza solo, así que la variable dejaría de ser la que decide; el bloque D corre SIN máscara y deja medido lo que ve un jugador del banco. Gotcha que costó una corrida: el toggle de personajes IA se persiste en localStorage, así que el plan de sabotaje se fija ANTES de recargar. Probado en negativo con `UMBRAL_APAGADO_DE_SESION = 1`: los bloques A y B se ponen rojos |

| `58-un-tile-que-vuelve-cuenta-lo-que-dice-ahora` | Las dos mitades de la T3 (#358) que se ven desde fuera y que la batería no podía poner rojas. **(1) `Y` y `N` con el teclado de VERDAD.** #329 quitó el espejo `tileProposalActive` y puso al proveedor a PREGUNTAR (`InputDeps.propuestaDeTileAbierta()`); ese gate lo lee SOLO `KeyboardInputProvider`, mientras que la batería entera corre con `?input=scripted`, cuyo `queueTileConfirm()` no pregunta nada — los guiones 05 y 42 aceptan la propuesta por ahí. Se podía cablear la derivación a `false` y dejar al jugador sin poder decir que sí con los 56 guiones en verde. Aquí se pulsa la tecla, y se miden las DOS direcciones del predicado: con la propuesta delante la `Y` la acepta, y sin propuesta la `Y` no deja nada armado que acepte la siguiente sola (que en el juego de verdad sería generar mundo, y GASTAR, sin que nadie lo pida). **(2) Un tile que vuelve cuenta lo que dice AHORA.** La política de #379 es CONSERVAR la entity de lo que ya está, y su precio es re-aplicarle lo que el tile declara ahora; esa re-aplicación vive en el cliente (`world/carga-de-tile.ts`), donde no hay ni tests ni mutación (#241) — el módulo de core prueba que el reparto DEVUELVE lo declarado, no que nadie lo aplique. Se mide la asimetría entera, que es la parte delicada de la decisión: ante el MISMO cambio, un OBJETO se mueve y trae su prosa y su categoría nuevas (no tiene ninguna fuente viva) y un PERSONAJE conserva su sitio (su posición la manda el bridge) aunque sí adopte el nombre nuevo. Probado en negativo con cuatro sabotajes, uno a uno: sin el `Object.assign` de los objetos, 3 asertos rojos con `npm run lint`, `tsc` y los 56 guiones anteriores TODOS verdes; re-aplicándole la posición al personaje, el aserto del teletransporte; y con el gate en `false` y en `true`, los dos bloques de la `Y` |
| `59-las-superficies-vienen-de-la-libreria-y-la-maqueta-no-pinta` | La otra mitad del 21 (T4, #257): que las celdas VIVAS lleguen y por dónde. Dos partidas sobre el motor falso con la librería vacía (`aisla: ["saves","fake-ai"]`): **Maqueta 3D** pide el atlas del tile SOLO con `resolve_only: true` (así restaura arte ya pagado sin pintar), vuelve sin celdas, sin coste y el jugador lee por qué está en clay; **Imagen IA** instala el atlas y cada celda descargada es `{assets}/cache/surface/{16 hex}` — ni un `/cache/albedo/`, `/cache/plate/`… ni otra forma de URL (la cascada de `cache_url` por kind murió con la tanda). Se afirma que hubo peticiones (si no, «no pinta» sería un verde vacío). La batería no levanta el asset-store real: mide la FORMA del cable y la conducta de `fps-atlas.ts`, que `npm test` no ve. Escrito por QA al validar T4 y probado en negativo |
| `60-reanudar-pinta-el-tile-del-jugador` | Que REANUDAR deje texturado el tile donde está el jugador, sin salir y volver (#390, el único hallazgo de QA de la serie que ve quien juega). Dos piezas, cada una con su rojo: el resume añadía los tiles del save en el orden de `scenes_loaded` y `addTile` activa el PRIMERO (en un mundo pre-generado son 9 y el de entrada va el último), y `onActiveTile` descartaba en silencio el tile activo que llegaba con OTRO run en vuelo. Dos tiles por «Salidas» (el banco borra el snapshot de mundo al arrancar: sin viaje, una partida trae un tile y no hay carrera) y sin mapping local antes de reanudar (el jugador de H2 no lo tenía: un atlas parcial no se persiste). Afirma sobre el RENDERER (`fps().textured ∋ activeTile`), no sobre el log; que TODO POST tras reanudar lleve el `layout_key` del activo (el POST del tile equivocado es la evidencia determinista del orden malo); que en Imagen IA nada pinte al reanudar y que en Maqueta 3D el gasto sea cero; A4 en su propio bloque (G + teletransporte en el mismo tick = cruzar a un tile con un run en vuelo); y A3 en el suyo: el POST del resume RETENIDO con `page.route` y el tile activo re-difundido por `request_tile` (el cliente lo re-añade y dispara `onActiveTile` dos veces en el mismo `addTile`), contado por `cells[].key` — sin la guarda `pendingTiles` salen 3 POST con las mismas 23 celdas. Nació ROJO sobre `b6b6314` en los dos bloques; los negativos por pieza en la cabecera. Desde #395 afirma además que el save recoge el viaje POR CONSTRUCCIÓN: tras «Salidas» espera por PREDICADO (active = destino ∧ posición en su rect, leído de la world scene) el save que escribe `activateByPosition` al cambiar de tile, sin forzar ninguna escritura por el State API — la muleta que tenía antes. Ese aserto nació rojo sobre `6d3d7ac` en Maqueta 3D (en Imagen IA lo tapaba el `/scene/asset_refs` del atlas, que guardaba de paso) |
| `61-el-objeto-mirado-dice-su-nombre` | Que el rótulo del objeto que miras salga de `name` y que `description` sea OTRA cosa (#238). Hasta la tanda la world scene traía cada objeto con `description: ent.name` —la etiqueta disfrazada de descripción— y la `description` declarada por el motor se tiraba en el wire para todo lo que no fuera NPC; la decisión escrita es «`name` es la etiqueta, `description` es la PROCEDENCIA» (el texto exacto dado al modelo, para regenerar el arte con un modelo mejor), así que `objects[]` pasa a llevar el mismo par que `npcs[]`. Se mide donde ningún test de core llega: el lector (`session/entidades-del-tile.ts`) prueba que DEVUELVE `nombre`, pero quien lo pinta es el cliente (`carga-de-tile.ts` → `label` → `#world-labels`) y `nefan-html` no tiene tests. Tres bloques sobre `robledo_tile` sin motor: el WIRE (el pozo con `name` y ningún objeto de la fixture estrenando `description`, que 0 de sus 24 entities la declaran), el CLIENTE (`__nefan.objects()` lo rotula) y la PANTALLA (a 3 m del pozo, yaw hacia él y la mirada bajada por el ratón porque el brocal queda 20° bajo el cono de puntería, el rótulo dice su nombre y la mirilla se enciende). Probado en negativo devolviendo `description: ent.name` al emisor: 5 asertos rojos que nombran el defecto —los 24 objetos con `description` y sin `name`, `label ""` en el cliente y el rótulo que no llega—; el volcado, en la cabecera |
| `62-un-save-con-terreno-por-chars-no-carga` | Que un save anterior a la retirada del terreno por chars (#335) NO cargue mudo y que el jugador lea una salida. El terreno tiene un solo origen (`biome` + `ground`/`volumes`; el grid es un raster que sintetiza el engine y la solidez la fija `DEFAULT_SOLID_CHARS`), y los dos campos viejos —la leyenda char→nombre/solidez y los parches ASCII— los rebota el zod por NOMBRE en `retired-terrain-fields.ts`; el guion LEE esos nombres de ahí (no los escribe: `campos-retirados-no-vuelven` caza qa/**). Partida real → save de disco con cada campo viejo → `resume_session` por el cable: `save_invalido` nombrando save, escena, campo y «bórralo o regenéralo», fichero intacto (nadie sanea); «Reanudar» sobre la tarjeta vuelve al título con «ya no vale para esta versión… bórrala o empieza una nueva», sin el nombre interno y sin escena montada; restaurado el fichero, el mismo resume carga. Escrito por QA al validar #335; probado en negativo vaciando `refineRetiredTerrainFields` (rojo en «nombrando el campo» y en «el título vuelve con un error visible») |
| `63-una-posicion-viva-fuera-del-mundo-se-dice` | Que una posición VIVA del ledger que no cae en ningún tile del save se DIGA al jugador con nombre y coordenada, sin bloquear la carga (#382). Desde #351 la que sale al cable es la viva y el único candado del cliente medía la DECLARADA (guion 55): un save con el tabernero en `(168,25, 0, 168,25)` lo ponía donde no hay suelo con el panel en «— sin errores —». La vara es la UNIÓN de rects de todos los tiles de `scenes_loaded` (`entidadesFueraDelMundo`, core), calculada por el bridge al servir el resume y dicha por `narrative_status: error, kind: "restore"` — el canal de los combatientes ilegibles. Dos bloques con el save editado a mano (nada del juego escribe esa coordenada): el positivo (`cell` intacta, viva en `tile_3_3`) exige nombre y «168» en el panel y la escena cargada; el negativo pide antes el tile (1,0) por el cable y mueve la viva DENTRO de él —el enemigo que persigue, el aldeano que pasea— y exige que nadie encienda el aviso. No toca `src/combat/` ni depende de #377. Nació rojo sobre `6d3d7ac` (panel `["— sin errores —"]`, 395 sondeos); el negativo era verde vacío en la base |
| `64-un-enlace-nuevo-llega-al-panel-sin-redifundir-la-escena` | Que un `map_link` (y el renombrado por `map_upsert_place`) creado a mitad de sesión llegue al panel «Salidas» SIN re-difundir la escena, y sobreviva a Reanudar (#179). Hasta la tanda las `exits` eran un derivado del mapa HORNEADO en el `scene_data` al difundir —único invalidador: volver a difundir— y el resume servía el sello congelado; el diálogo prometía un destino que la única vía de viaje no ofrecía. Ahora se calculan al servir (`wire-scene.ts`, una puerta para broadcast y resume) y el mapa difunde solo las salidas (`exits_changed`). El guion crea lugar y enlace por el State API (el cable de las tools MCP) y exige el destino en `__nefan.exits` Y en los botones del panel; cuenta los frames del socket del juego (`page.on("websocket")`) y las peticiones: cero `scene_init`, cero `POST` de atlas ni `/scene/` desde el link; reanuda y exige que siga; renombra el molino y exige el rótulo nuevo sin el viejo. Nació rojo sobre `6d3d7ac` (el panel no cambia: `{"exits":["Molino del bench"]}` con `link 200`; tras Reanudar tampoco; el renombrado deja el nombre viejo); el «cero scene_init» era verde vacío ahí |
| `65-el-save-y-las-salidas-en-los-bordes` | Los bordes de T6 (#395 + #382 + #179), escrito por QA al validar la tanda. #395 en sus DOS ramas y a pie: viaje a un lugar sin realizar (`runPlaceTravel`), vuelta a pie al tile de origen (`setPlayerPos`, el mismo cruce de borde que andar 60 m) y segundo viaje al molino ya realizado (`difundirPlaceRealizado`, la rama que guardaba antes del spawn); cada cambio de tile exige en el save `active_scene_id` del destino ∧ posición en su rect, por predicado, y Reanudar deja al jugador en el molino. #179 donde el 64 no mira: un enlace a un lugar cuyo tile está CARGADO pero no activo no cambia el panel del activo ni enciende errores, pero al volver a pie a ese tile su panel tiene que ofrecer el destino nuevo (nació ROJO sobre `e55f98d`: el bridge solo difundía las salidas del tile activo y el cliente pintaba su copia vieja hasta Reanudar; desde la vuelta de QA `difundirSalidasDeLosTilesCargados` manda un `exits_changed` por tile cargado con lugar); tres enlaces en ráfaga acaban los tres en el panel; un enlace entre lugares ajenos no toca nada. #382 en los bordes: dos personajes fuera → un solo aviso que nombra a los dos; una `position` que no es una coordenada (`null`) NO es un caso del checker sino un save que no vale: `loadSession` lo rechaza nombrando `entities["barkeep"].position` y el título da la salida de #334/#336 («ya no vale… bórrala o empieza una nueva»), sin escena montada (nació ROJO sobre `e55f98d`: `npcSync` → `AmbientNpcBehavior.addNpc` leía `position[0]` y el resume entero caía con «El servidor del juego no pudo completarlo; inténtalo de nuevo», un consejo que no puede funcionar). Cero créditos, Maqueta 3D |

| `69-el-arranque-no-se-calla` | Que lo que se rompe SOLO durante el título llegue a quien juega (#306). `#ts-error` guardaba UN mensaje y cada `renderHome` lo borraba, así que three.js que no carga, las hojas base que no llegan y una trama del socket que no se entiende vivían únicamente en el `error-log` que `html[data-titulo="1"]` mantiene apagado (#246): un título normal encima de un cliente roto. Los tres fallos se inyectan en el BORDE (la petición abortada, el WS interceptado), no stubeando el cliente. Se afirma además lo que hace que el arreglo no sea otro agujero: que el texto del aviso **sea** el `message` de la entrada del registro (una verdad, no una segunda redacción), que **sobreviva al repintado** del home —el `innerHTML` era literalmente el bug—, que una familia rota dé **UN** aviso aunque falle una hoja tras otra y el socket reintente cada 5 s, y que `#game-ui` siga apagado: el aviso llega al hueco del TÍTULO, no encendiendo lo que #246 apagó |

| `70-el-aviso-del-arranque-no-mueve-el-suelo` | La otra mitad de #306, escrito por QA al validar T9: que el aviso LLEGUE (guion 69) no puede costarle al jugador el botón que iba a pulsar ni la frase que le dice qué pasó con sus partidas. (1) **#250 por otra puerta**: `renderHome` pone bajo el botón todo lo que puede cambiar después del primer pintado —un panel que crecía movía «Nueva partida» +24 px bajo el cursor— y `#ts-error` está ENCIMA y desde #306 se rellena tarde; la ruta del chunk se RETIENE y se suelta con el título ya pintado, así que el bloque no depende de ninguna carrera (medido: **Δ 33 px**, ROJO). (2) **La familia 4 se lee**: es la única de las cuatro que #306 decidió NO etiquetar —conserva su `statusEl`—, así que se le quita al bridge la respuesta a `list_sessions` (solo esa) y se afirma que el título lo dice, dentro de la ventana y sin código del bridge. El aserto pide el texto del FALLO: con «Bridge OK — N partidas guardadas» habría salido verde sin que fallara nada. (3) **Los avisos apilados** no sacan «Nueva partida» de una ventana de 500×480 ni dejan que otro se la tape (`elementFromPoint`, no geometría sola). (4) **El aviso no caduca**: se corrompe lo que contesta el gateway, se deja de corromper y se repinta el home por el camino del jugador; el título acaba diciendo «Bridge OK — 1 partidas guardadas» con «la partida respondió algo que no se entiende» encima. Son las dos verdades que el issue prohíbe, separadas en el tiempo en vez de en el texto (ROJO). Los dos rojos llevan delante su aserto de NO CONCLUYENTE, para que ninguno pueda ser un rojo vacío. Cero créditos, ni una partida abierta |
| `71-un-fallo-con-partida-detras-se-cierra` | La rama de `SalidaDelOverlay` que nadie medía, escrito por QA-B al validar T10 (#383a). El corte de `status-labels.ts` deja el titular, el destino y la SALIDA en `status-rotulo.ts` y la frase en cristiano en `status-motivo.ts`, y con eso deja **un solo sitio** donde las dos mitades vuelven a encontrarse en ejecución: `nefan-html/src/main.ts`, que le pasa a `setLoaderState` el titular, el detalle y la salida del MISMO rótulo. Si ese trío se desparejara, los dos tests de core seguirían verdes —cada mitad tiene el suyo— y lo vería solo el jugador. El 20 mide la rama `mundoVacio` (sin mundo detrás: «Volver al título» y NO «Cerrar») y el 56 mide el titular y el cuerpo de un fallo a mitad de partida sin mirar un botón; **nadie medía la rama de todos los días**: con la partida pintada detrás la salida es «Cerrar», y cerrar devuelve al juego. Un muro que ofreciera «Volver al título» ahí le costaría al jugador la sesión en un click. Se llega al estado sin trucar nada, con la técnica del 56 (`chmod 0500` sobre el directorio del save y contestar al tabernero, que es el turno que dispara `save()`; el permiso se devuelve siempre). **PROBADO EN NEGATIVO**: con la salida clavada a `"volver-al-titulo"` en `status-rotulo.ts`, este guion se pone ROJO en sus dos asertos de salida y el 20 sigue VERDE — el reparto exacto del defecto, y la prueba de que el hueco era real. Cero créditos |
| `72-el-snapshot-injugable-no-se-sirve` | Lo que se carga pasa por `validateScene` o no se sirve (#302), desde el título: el bootstrap falso deja el snapshot, el guion mueve un NPC a la huella de un volumen y afirma chip «Mundo ⟳», panel «obsoleto (regenera el mundo)», «Aplicar estilo» deshabilitado, y que «Comenzar» degrada al bootstrap vivo (una llamada más a `/generate_scene` del fake) con el bridge diciendo «injugable», la escena y el NPC sin traza de pila. Control positivo dentro: con el snapshot sano el segundo arranque replayea sin llamar al motor. Propuesto por QA al validar PR-1 de T11 |
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
(`cache/sprite_sheets/_base_keys.json`) con lo último que se supo de cada
`{model}/{anim}/{angle}` —su `base_key` y, desde #375, su perfil de repintado, porque los dos
entran en la clave—, y esto es su candado contra el servicio de VERDAD (el adaptador tiene su
propia batería con un sprite-forge de mentira en `ai_server/tests/`).

**El sujeto se lo planta él**, y es la lección más cara que lleva dentro. Antes buscaba un
sheet pagado en `cache/sprite_sheets/`, o sea que dependía del accidente de lo que hubiera en
la máquina de quien lo corriera: cuando #375 movió la clave, los 27 sheets que había quedaron
inalcanzables y el candado se puso **ROJO sin que nada estuviera roto**. Y regenerar uno era
imposible aquí — el worker de repintado exige `rembg` (466 MB) que no está instalado, así que
la única receta escrita no se podía ejecutar en la máquina donde estaba escrita. Un rojo
permanente que todo el mundo aprende a ignorar es peor que no tener candado.

Un «sheet pagado» son ficheros: frames + `meta.json` bajo la clave viva. El guion los escribe
antes de empezar y se los lleva al salir (el índice se restaura tal como estaba). La clave **no
la recalcula**: se la pregunta al propio adaptador, importando `_perfil_efectivo` y
`_skin_sheet_key` — una segunda implementación de la clave en el banco sería el espejo que
deriva, que es justo lo que #375 vino a cerrar.

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
siempre, o que la degradación no mire el índice), las comprobaciones 2 y 3 se ponen rojas.
Necesita el `.venv` y `assets/characters` — en un worktree pelado hay que enlazarlos.

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

## El sexto ejecutable: `qa/el-indice-del-store-se-prueba-sin-el-del-checkout.mjs`

El asset-store tiene UN camino de fallo en el arranque —negarse a servir un índice con kinds
sin productor (`services/asset-store/kinds-con-productor.ts`)— y hasta #391 no se podía ejercer sin la
DB del checkout: `loadAssetStoreConfig` solo admitía override para el PUERTO. El QA de T4 tuvo
que exportar el árbol entero al scratchpad, plantar la fila ajena en la copia y arrancar desde
allí; ese workaround ERA el defecto, y `NEFAN_MANIFEST_DB` lo cierra. Esto es su candado, y lo
mide arrancando el **entry real** (el mismo que lanza `start.sh`) contra índices de usar y tirar.

```bash
node qa/el-indice-del-store-se-prueba-sin-el-del-checkout.mjs   # 17 comprobaciones, ~10 s
```

Las cuatro cosas que afirma: el **negativo** (`exit 1`, el motivo, el script de purga y que el
veredicto habla de SU índice — un kind centinela que ningún checkout puede tener); el
**positivo** (arranca, nombra la DB de la variable con su recuento y `/health` **contesta por
HTTP desde otro proceso** con ese mismo recuento); el **blanco** (`NEFAN_MANIFEST_DB="  "` sale
con 1 y no deja basura en la raíz del repo); y que el índice del **checkout** no se toca en
ninguno de los tres casos.

Vive fuera de `guiones/` por la razón de `sprites-sin-servicio.mjs`: no toca la página, y en
`guiones/` cada corrida de la batería pagaría un Chromium para un check que solo arranca y para
un servicio. Cero créditos y cero vecinos molestados: cada caso con su `mkdtemp`, el puerto lo
elige el kernel (ningún número del catálogo escrito a mano) y el hijo se mata **por su PID**.
Escrito por QA al validar #391; probado en negativo (revirtiendo el override caen 12 de las 17,
con salida 1).

## El séptimo ejecutable: `qa/perfil-de-repintado-en-la-clave.mjs`

`keyframes` y `play_fps` de `nefan-core/data/sprite-set.json` deciden qué fotogramas se pintan
y a qué velocidad se reproducen. Hasta #375 no entraban en ninguna clave de caché —ni en la del
sheet vestido de ne-fan ni en la `base_key` de sprite-forge—, así que retocarlos producía un
repintado distinto con la MISMA clave: se servía el arte viejo, sin error y sin aviso, con la
factura ya pagada. Y desde #369-R10 ese fichero no es una copia: `start.sh` se lo pasa al
servicio con `--set`, o sea que es el set VIVO.

La batería de `ai_server/tests/test_sprite_forge_adapter.py` ya prueba la función de clave
contra un sprite-forge de mentira. Lo que ahí no cabe es la cadena que de verdad cuesta dinero:
**fichero del set → `GET /catalog` del servicio REAL** (que mergea con su `PERFIL_POR_DEFECTO` y
colapsa los keyframes que no caben en el ciclo) **→ clave del sheet vestido**. Espejar esa
aritmética en el lado Python es justo lo que #375 prohíbe, y solo el servicio real dice si el
espejo ha vuelto.

```bash
node qa/perfil-de-repintado-en-la-clave.mjs   # arranca su sprite-forge (--sin-skin) y lo mata al salir (~40 s)
```

Cero créditos por construcción: sprite-forge arranca **sin worker de repintado**, así que no
existe proceso capaz de llamar a un proveedor, y las dos rutas que se ejercen (`GET /catalog` y
`POST /sheets format=none`) son disco y aritmética. El set se toca en una COPIA en `/tmp` cuya
identidad byte a byte con el fichero vivo se afirma primero: una muerte a media prueba no puede
dejar el repositorio con un perfil de mentira commiteable. Puerto desde `PUERTOS_TODOS`
(`NEFAN_PORT_OFFSET` se honra); ocupado ⇒ se niega y lo dice, no mata a nadie. Necesita el venv
(el sujeto es el adaptador de Python) y `assets/characters`.

Probado en negativo (2026-09-03): contra el adaptador y el set anteriores a #375, las tres
primeras comprobaciones en rojo — «EL FALLO DE #375 ESTÁ VIVO: el adaptador no tiene
`_perfil_efectivo`» y las seis ambientales sin perfil declarado.

## El octavo ejecutable: `qa/el-arte-de-personaje-no-se-pina-a-medias.mjs`

El hero-shot y sus sheets vestidos son el arte más caro del juego, y hasta #376 vivían sin fila
y sin prompt: un PNG llamado por un hash que nadie podía volver a pedir. Lo que cierra el issue
no es «indexarlos» —a secas los habría vuelto evictables, y sin keep-list de personaje el prune
podría borrar por LRU la skin de un NPC vivo— sino indexarlos **con su procedencia y PINEADOS,
hero y frames a la vez**. Ese «a la vez» es la pieza cara, y este guion es su candado.

```bash
node qa/el-arte-de-personaje-no-se-pina-a-medias.mjs   # 24 comprobaciones, ~8 s
```

Lo mide donde se decide: arrancando el **entry real** del asset-store (el mismo que lanza
`start.sh`) contra un índice `mkdtemp` y hablándole por HTTP. Lo primero que afirma es que **el
`ref` de pin no es una entrada**: el arte de personaje no entra por `POST /assets` (400 que dice
por dónde va) sino entero por `POST /assets/character`, y el ref lo DERIVA el store de
`hero_key`. Esa forma nació de este guion: su primera versión traía un bloque PENDIENTE con dos
huecos medidos y sin candar —un `sprite_sheet` aceptaba el `character_ref` de otro personaje, así
que soltar A se llevaba los frames de B; y el `hash` no tenía forma, así que una fila llamada
`heroes` hacía que el prune borrase la carpeta entera de hero-shots—. Los dos se cerraron en la
misma PR y el bloque pasó a ser dos comprobaciones más, que es lo que un candado cerrado tiene
que ser.

El resto: el prompt vacío es 400 y `surface` lo sigue admitiendo (la regla es del kind, no un
endurecimiento global); el registro válido deja fila con su prompt, su `extra` entero y el
`character_ref` que **estampa el store**; un `character_ref` ajeno en el `extra` no cuela y el
pin del vecino no se toca; registrar el mismo arte N veces —que es lo que hace el adaptador en
cada servida— no duplica fila; y un solo `DELETE` los suelta juntos. Contra el **prune real**
con sus tres kinds, que tienen layouts distintos: directorio para `surface` y `sprite_sheet`,
fichero suelto para `sprite_hero`, sin llevarse por delante la carpeta `heroes/`, respetando el
pin, y con fail-loud (no un `continue` callado) para un `type` sin productor.

Cero créditos (no llama a `/identity` ni a `/skins`, ni arranca sprite-forge) y cero vecinos
molestados: índice y blobs en `mkdtemp` (`NEFAN_MANIFEST_DB` — el del checkout no se abre ni
para leerlo, y se comprueba al terminar), el puerto lo elige el kernel y el hijo se mata por su
PID. Vive fuera de `guiones/` por la razón de `sprites-sin-servicio.mjs`: no toca la página.
Probado en negativo (2026-09-03) con siete mutantes, cada uno con su rojo distinto — el detalle,
en la cabecera del propio guion.

## Los tres `*-candados-en-negativo.mjs`: ¿se pueden poner ROJOS los candados?

No llevan número porque no son un ejecutable más de la serie: son la pregunta que se le hace a
todo lo demás. Cada uno **rompe el fuente a propósito**, corre SU batería, exige que falle y
restaura; se niega a arrancar sobre un árbol sucio y comprueba byte a byte que devolvió lo que
tocó. **Ninguno entra en `npm run verify`**; `contrato-` y `mutacion-` corren en CI (job
`candados-headless`, #357) y `bateria-` no: spawnea `qa/run.mjs`, o sea preset + Chromium.

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

## `qa/mutacion-cableado-en-negativo.mjs`: lo que la batería NO puede mirar

```bash
node qa/mutacion-cableado-en-negativo.mjs          # ~26 s, sin red y sin medir mutación; corre en CI
node qa/mutacion-cableado-en-negativo.mjs ancla    # filtro por nombre
```

Los tres de arriba conducen una **batería**: rompen el fuente y miran si los tests se enteran.
Éste conduce **la herramienta**: `scripts/mutacion.ts` y `.github/workflows/mutation.yml` no los
importa ningún test —no pueden, llaman a git y a `gh`—, así que ahí «romper y mirar el test» no
es una opción y la única prueba posible es ejercer el verbo de verdad sobre un
`reports/mutation/` de ensayo y exigir que el OBSERVABLE cambie al deshacer el cambio.

Nació al validar PR-A de T10 (#381 + #420), que declaró su propia carencia —«el invariante
"`repartir` ancla en `corrida.desde` y no en el tag" no lo defiende ningún test»— y QA midió que
no era una: eran **siete** reversiones del cableado que no ponían rojo nada, los dos issues de la
PR incluidos. Cubre el ancla del reparto, la contradicción del rango vacío, el sello del informe,
`corrida.json` como no-informe, el fail-loud del formato viejo, el ancla que escribe `manifiesto`,
el `--pedidos ""` del input `TODOS` y las cuatro piezas del paso del workflow. Aparta
`reports/mutation/` mientras corre y lo devuelve; verifica byte a byte los fuentes y la huella
—que `repartir` reescribe por diseño— y sale con 2 si algo no volvió.

## `qa/mutacion-reparto-en-lotes.mjs`: la corrida partida, y lo que aún no tiene quien la cace

```bash
node qa/mutacion-reparto-en-lotes.mjs                 # ~4 min, sin red y sin medir mutación
node qa/mutacion-reparto-en-lotes.mjs --solo-vigentes # ~7 s, solo los candados de regresión; es lo que corre en CI
```

De la validación de PR-E (la corrida partida en lotes). Dos grupos, y la diferencia es el punto:
**VIGENTE** son nueve invariantes que hoy se cumplen —determinismo del reparto, ningún lote de
varios por encima de `tope_lote`, cada pedido en exactamente un lote, lo no cronometrado en lote
propio —con la población SEMBRADA en una copia de la huella: desde #440/#445 todo módulo tiene
reloj, el árbol real ya no da sujeto y la primera versión estuvo roja en `main` del 04 al 05-09 sin
que nadie lo viera—, `tope_lote` por debajo del `timeout-minutes` del job que lo ejecuta, un lote
muerto que deja la corrida INCOMPLETA con el tag quieto, la fusión que se niega sin plan, el sello
de #420 dentro de cada lote y la procedencia escrita de los relojes sembrados—, y **ABIERTO** son los
hallazgos que siguen sin candado: cada uno se rompe a mano y se mira si la batería o los dos
guiones de negativos se enteran. Si nadie se entera, el invariante es prosa y la línea sigue
roja; el día que alguien lo tape, se pone verde sola.

La comprobación es **línea base y luego romper**: primero se corre cada checker con el árbol
limpio y solo cuenta como «se entera» que su resultado CAMBIE. Sin esa línea base, un checker ya
rojo por el entorno (un `dist/` sin compilar) pasaría por candado. Y las roturas del grupo
ABIERTO **no tocan ningún literal que los otros guiones busquen**: la primera versión de la del
lote propio borraba una línea que el guion de candados usa de patrón, el guion se ponía rojo
porque su patrón desaparecía, y eso se lee igual que cazar el fallo sin serlo.

Aparta `nefan-core/reports/` entero mientras corre y lo devuelve; verifica byte a byte los cinco
fuentes y la huella, y sale con 2 si algo no volvió.

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

## `qa/el-npc-cruza-ai-server-con-role-y-description.mjs`: el tramo ai_server, por HTTP y sin créditos

Hasta T11 (#235) ninguna corrida del banco atravesaba `ai_server`: el preset `e2e-sin-creditos`
apunta el bridge al `fake-ai-server`, que devuelve la escena sin pasar por el proceso Python, y la
allow-list donde vivió #173 (`validate_scene_response`, la que copia `role` y `description` de cada
entity) solo la sujetaban tests en memoria. Este guion recorre el tramo de verdad:

```
bridge (ws-server.ts real) --HTTP--> ai_server (main.py REAL, SDK anthropic REAL) --HTTP--> stub
```

Lo único sustituido es el **modelo**: `labs/narrative/fake-anthropic.ts` detrás de
`ANTHROPIC_BASE_URL`, que contesta un `tool_use generate_scene` con el tile de bootstrap del
motor falso y **cuenta las llamadas**. El ai_server arranca con `NEFAN_LLM_MCP_URL=off` (la
palanca que trajo #235): sin ella se engancharía al terminal de Claude Code de otro agente de la
máquina y le mandaría la petición.

```bash
node qa/el-npc-cruza-ai-server-con-role-y-description.mjs   # ~2 s; NEFAN_PYTHON=<intérprete> en un worktree sin .venv
```

Afirma que el ai_server es el real (`fake:false`, «canal MCP desactivado»), que `barkeep` llega al
wire con `role:"merchant"` y su `description` **verbatim** (leída del stub, no copiada al guion) y
`bandido_1` con `role:"hostile"` y su `combat`, que el stub recibió **exactamente una** llamada con
la clave falsa, y que el snapshot del mundo cae en el disco efímero y no en `data/games/` (así
nacieron los 4 tiles basura que se borraron el 05-09), y que el ai_server se **apaga limpio** con
SIGTERM (exit 0: su `lifespan` reventaba al cerrar un `deps.remote_gen` inexistente y nadie lo leía).
Probado en negativo comentando cada copia en `narrative_schemas.py`: 3 rojos sin `role`, 2 sin
`description`. Una escena que NO venga del stub es ROJO con nombre, no «sin medir». No toca el guion
40 ni compara salidas saneadas por igualdad. Corre en CI (job `candados-headless`); puertos del bridge
por `NEFAN_PORT_OFFSET`, los demás los elige el kernel, y con uno ocupado se niega sin matar a nadie.
Un Ctrl+C a mitad corre la misma limpieza que el `finally` (hijos por PID + disco efímero) y sale 130.

## `qa/el-selector-ve-lo-que-la-bateria-abre.mjs`: los datos que un descarte podría perder

Nace con el desanulado del selector (#404). Hasta entonces cualquier fichero de `data/contract/`
forzaba la corrida completa: caro, molesto y **correcto**, porque nadie podía equivocarse. Al pasar el
selector a **descartar**, el fallo cambia de forma: ya no es una corrida de tres horas de más, es una
corrida verde que **no midió lo que tocaba**.

Este guion recorre las **puertas** —los ficheros de test que abren datos— y comprueba que cada dato
que una batería abre selecciona a los módulos de esa batería. Hoy mira 8 puertas y 38 datos.

Cazó lo que la primera vuelta no vio: las fixtures de `data/contract/fixtures/sprite-forge/` y el
golden `test/fixtures/fps-plans/varied.json` salían a **«NO EJECUTA NADA»**, aunque los tests que los
abren SON la batería de `contrato-sprite-forge` y de cuatro módulos de blueprint. El primer arreglo
solo cubría a quien **enumera** un directorio; estos se abren **por nombre compuesto**.

Se pone rojo cuando un dato que una puerta abre deja de seleccionar a su batería, y nombra el fichero
y la puerta. Su hueco conocido, escrito y sin cerrar: una ruta armada con `+` o con un template
(`` `${DIR}/${x}.json` ``) no se ve **ni cuenta como ciega**, que es por donde volvería a colarse este
mismo fallo.
