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
node qa/run.mjs --url http://…   # contra un stack ya arrancado
```

Si no hay nada en `:3000`, el runner levanta el preset **`e2e-sin-creditos`** (`./start.sh --preset e2e-sin-creditos`:
fake-ai-server + bridge + cliente) — cero créditos. Las capturas quedan en `qa/capturas/`.

## Cómo se escribe un guion

Un fichero en `guiones/` que exporta `async (ctx) => {}`. El contexto ofrece:

| | |
|---|---|
| `ctx.nefan(path, ...args)` | llama o lee `window.__nefan.<path>` |
| `ctx.waitFor(desc, fn, ms, arg)` | espera a que `fn` (en la página) devuelva algo truthy |
| `ctx.holdUntil(key, desc, fn, ms, arg)` | mantiene una tecla hasta que se cumple `fn`, y la suelta siempre |
| `ctx.expect(desc, cond, detalle)` | apunta un criterio; los fallos deciden el veredicto |
| `ctx.shot(label)` | captura a `qa/capturas/` |
| `ctx.page` | la página de Playwright, para lo que no cubra lo anterior |

Reglas que hacen que un guion valga algo:

1. **Nunca esperes por tiempo de pared.** El movimiento va por delta de rAF y el typewriter por
   `setInterval`: ningún `sleep` es determinista. Espera por ESTADO (`waitFor`). Los `maxMs` son
   cortafuegos, no la condición de parada. Corolario que costó un guion intermitente: si el
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
| `13-personajes-animados` | Que el juego sigue teniendo gente después de tirar el motor que la renderizaba (retirada de Godot, 2026-08-22): las 10 hojas del set base de `y_bot` servidas y COMPLETAS —el último frame que promete cada `meta.json`, que es el que falta cuando un render se corta—, y en una partida real un NPC que se mueve solo y un jugador que anda. Ojo al 200 mentiroso: el dev server de Vite responde al PNG que no existe con el `index.html` de la SPA, así que el aserto mira el `content-type`, no `r.ok` |
| `14-plugin-evoluciona-sin-perder-la-partida` | Que el motor pueda hacer EVOLUCIONAR un sistema de juego a mitad de partida sin que el jugador pierda lo que tenía (#164): antes, un `plugin_register` con la versión siguiente no migraba — añadía un SEGUNDO sistema con el mismo nombre y el slice de cero, así que el mercado en el que acababas de comprar quedaba huérfano y los dos ejemplares se suscribían al mismo evento. Se juega el caso entero por el camino real, sin fixtures |
| `15-guardia-se-ve-y-se-comporta` | Que un NPC declarado GUARDIA se distinga del resto en las dos cosas que el jugador nota (#173): pide OTRA ref de personaje para su skin (`warrior` frente al `commoner` de sus vecinos, sin que ninguno declare `style_ref`) y, ante el MISMO ataque a su lado, se ACERCA al punto de la pelea mientras el mercader se ALEJA. El `07` no lo cubre: allí basta con que `style_role` no venga vacío, así que pasaría en verde con todo el pueblo vestido y comportándose igual. Gotcha del bench: el motor falso solo tiene hoja `idle` y su 500 en `walk` apaga los skins de la sesión entera, así que la mitad del «se ve» se mide en pestaña nueva sobre `robledo_tile` leyendo el LIBRO de skins (lo que el juego PIDIÓ), no el cable |

| `16-scatter-esquiva-el-suelo` | Que la vegetación derivada no plante troncos en la calzada ni sobre el agua (#174), medido por donde duele: el jugador RECORRE el camino real en vez de quedarse clavado. El daño no es visual — cada árbol derivado estampa un disco de tronco, así que uno en la calzada deja ~1 m bloqueado. Aparta y no vacía: los volúmenes siguen ahí, solo que ninguno en la banda. El paso 5 canda que la exclusión NO toque los volúmenes que el motor coloca a mano (un `pozo` a caballo de dos caminos): fugarla a `entities` deja el objeto en la lista y le quita la colisión — pérdida silenciosa |
| `17-la-partida-se-guarda-y-se-reanuda` | Que lo que el motor escribe por el State API (`map_*`, `inventory_*`, `npc_*`, `plugin_register`) llegue AL DISCO y siga ahí después de reanudar desde el título. El save no se escribe solo: cada handler devuelve `mutated: true` y el borde llama a `onMutation` → `narrative.save()`. Perder ese flag no cambia ninguna respuesta —200, mismo body, y en caliente se lee bien porque la NarrativeState viva ya lo tiene—, así que ningún test de status lo caza. Se miden las once escrituras UNA A UNA contra el `state.json` de disco, y no solo el «sobrevive al resume»: probado en negativo, con `upsertPlace` sin marcar el lugar SEGUÍA estando tras reanudar, porque la siguiente mutación que sí guardó se lo llevó de paso |
| `22-telegraph-ensena-el-borde` | Que con el ataque preparado el jugador vea HASTA DÓNDE llega, y que lo vea también en un puerto (#184 + #185). Dos fallos del mismo parche: la alfa del shader ERA la calidad del golpe, así que la rampa roja del borde tenía alfa cero y solo se veía el punto dulce; y el parche se dibujaba a 0,2 m mientras el suelo crecía 2 mm por prim sin tope, de modo que `puerto_tile` —quince rasgos, ninguna rareza— lo dejaba en 0,219 m y el telegraph desaparecía ENTERRADO bajo el embarcadero. Se mide sin leer píxeles: `fps().suelo` da la cara alta REAL de los calcos instalados frente a la cota del parche, y `fps().telegraph.borde` proyecta a píxeles del lienzo los dos extremos del alcance. El borde CERCANO no se exige en cuadro: con la espada corta —el arma que el cliente equipa siempre— cae a 0,2 m del jugador, y exigirlo sería exigir que se mire las botas |
| `23-telegraph-los-cinco-ataques-y-todo-suelo` | Los dos estados que el 22 deja fuera, seguidos por QA. **Los cinco ataques del catálogo, no dos**: cada tipo publica SU alcance, ninguno pinta el área del anterior y el borde lejano cae en cuatro alturas de pantalla distintas — si el parche dejara de seguir la selección, o dibujara siempre lo mismo, el jugador vería el límite de otro golpe. **Todas las fixtures del selector, no dos**: el techo del suelo es constante POR CONSTRUCCIÓN, así que la afirmación fuerte no es «en el puerto hay holgura» sino que la cara alta es la MISMA con 0, 14 o 57 calcos; y revisitar un tile no la mueve. Una captura por tipo de ataque para la crítica visual |
| `24-el-selector-de-fixtures-no-se-calla` | Que si el módulo de una fixture del selector «Room» no carga, el cliente lo DIGA (#248). Antes el `change` soltaba la promesa de `loadSceneFile` y el selector era un no-op MUDO: el `<select>` mostraba la fixture nueva, el mundo se quedaba en la anterior y no había ni entrada en el registro de errores ni línea en el juego. Los dos candados de #248 —`no-floating-promises` y `html-sin-promesa-muda`— impiden que el idioma vuelva a escribirse así, pero **ninguno de los dos puede ver la PANTALLA**: quitarle el `alFallar` a `paso()` los deja a los dos en verde. El fallo se inyecta en el BORDE (la petición del JSON se aborta), no dentro del cliente. Probado en negativo devolviendo `loadSceneFile(value);` a su sitio: ninguna entrada, ninguna línea y el juego siguiendo en la escena anterior |

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

Los guiones que necesitan una PARTIDA real (no una fixture) comparten el arranque del
título en `qa/lib/sesion.mjs` — `qa/lib/` no lo recorre el runner, solo `qa/guiones/`.
`07` dispara generación de skins: se niega a correr si `?ai=` no apunta al fake-ai-server.

Un guion **no puede nombrar** los identificadores ingleses de las dos vistas retiradas ni
ningún otro campo de contrato muerto: `qa/**/*.mjs` es root de la regla
`campos-retirados-no-vuelven` (`nefan-core/data/contract/arch-rules.json`) y escribirlos pone
`npm run verify` en rojo — pasó al sembrar el `12`. De que no vuelvan al CÓDIGO se ocupa ese
candado; un guion cubre lo que el candado no puede ver, que es la PANTALLA. Cuando haga falta
mirar nombres internos, se afirma con **lista blanca** (lo que debe haber), no con lista negra.
