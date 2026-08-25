# QA — Los estáticos que mienten (#217 · #218 · #255 p2)

Rama `feature/estaticos-que-mienten`, PR #277 (`de537d2`, más `c1bb76a` que es la huella de
mutación y no es de la tanda). Validado el 2026-08-25 contra la petición ORIGINAL y el criterio
de terminado de `requisitos.md`, no contra el plan.

**El sujeto de la validación no es «¿funciona?» sino «¿falla, se nota, y se nota DONDE el
jugador lo tiene delante?»** — porque de eso iba la tanda.

## Criterios

| # | Criterio (literal del encargo) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Un estático que no está bajo `/sprites/**` devuelve **404** | ✅ cumple | Guion 13, bloque 1-bis, corrida mía de hoy: `metaAusente: HTTP 404 · /sprites/no_existe_qa/idle/frontal_8/meta.json`, `pngAusente: HTTP 404 · …/dir_0_frame_999.png`. Es el 404 REAL de Vite, no uno inyectado |
| 2 | …y `r.ok` recupera la capacidad de ponerse rojo | ✅ cumple | Negativo mío (quitando `appType: "mpa"`): el mismo bloque da `HTTP 200 text/html` en los dos y el aserto se pone rojo, mientras su control («el hermano que SÍ existe») sigue verde |
| 3 | El freno explícito (tocar el build de producción) **no** se dispara | ✅ cumple | Verificado por mi cuenta, no por el informe: `nefan-html/package.json` no tiene script `preview` y nada en `start.sh` sirve `dist/` (`grep -n dist start.sh` → solo narrative-mcp). `appType` solo gobierna dev/preview server. La medida byte a byte del ingeniero (md5 idéntico spa/mpa) es consistente con eso |
| 4 | Una portada que no carga **se dibuja como marcador** | ✅ cumple | Guion 26 bloque 1 (4/4 tarjetas `img=false`, marcador con el nombre del estilo) + captura `26-…-01`. Y también en el camino que el 26 NO recorre: guion **28** (nuevo, mío) tras repintar por click de mundo y por cambio de estilo |
| 5 | …y **deja rastro en el log** | ⚠️ cumple a medias | La entrada se crea (`errors.push("title", …)`) y sale por `console.error` — pero `html[data-titulo="1"] #error-log{display:none}` (dev-ui.css:102) la esconde EXACTAMENTE en la pantalla donde ocurre. Medido: `#error-log display:none` con el título delante. Ver hallazgo H2 |
| 6 | Las 4 portadas se pintan en el bench | ✅ cumple | Guion 26 bloque 2: los cuatro a `1536px` desde `http://127.0.0.1:18765/styles/…/cover.jpg`. Crítica visual abajo |
| 7 | Paridad del fake con el asset-store real (códigos, MIME, cuerpos de error, md5) | ⚠️ cumple con reservas | Reproducida por mí con los DOS servidores levantados en puertos libres (18801 real / 18802 fake): las 6 filas del informe salen idénticas en status, content-type, `Cache-Control`, CORS y md5 (`cover.jpg` → `e121aa0d…` en los dos y en el disco). Dos divergencias que él no midió + falta `Content-Length`: hallazgo H4 |
| 8 | **Un clon sin hojas se entera al arrancar** (#255 p2) | ❌ NO cumple | Guion **27** (nuevo, mío): el jugador que pulsa «Comenzar» recibe *«No se pudo empezar la partida. El servidor del juego no pudo completarlo; inténtalo de nuevo»*. Ni nombra las hojas, ni el remedio, y reintentar no puede funcionar. Captura `27-…-01`. Hallazgo H1 |
| 9 | El remedio que se nombra **funciona** | ⚠️ cumple solo para el dueño | La cadena `main.ts` → `docs/assets-de-personaje.md` → README «Characters, on a fresh clone» es correcta, y el comando corre verbatim en esta máquina (`node bin/sprite-forge.mjs render --models y_bot --anims idle walk --assets ~/code/ne-fan/assets/characters --out … --dry-run` → `2 hoja(s) … en caché`). Pero `github.com/alberto-hortelano/sprite-forge` es **privado** (`gh api … private=true`): para cualquiera que no sea el dueño, el primer comando de la receta falla. Hallazgo H5 |
| 10 | Cada arreglo tiene un candado **visto rojo** | ✅ cumple (mejorado) | Reproduje tres negativos con grano más fino que el informe (tabla abajo). Añado dos caminos que no tenían candado: guion 28 (repintado) y guion 27 (clon que quiere jugar) |
| 11 | Nada más se rompe | ✅ cumple | Batería completa: ver §Batería |

## Los negativos, comprobados por mí

Tres sabotajes **a la vez**, en tres mecanismos distintos, en una sola corrida de `13 26`. Si los
asertos estuvieran enganchados unos a otros, se habría puesto rojo todo; se puso rojo exactamente
lo que toca:

| Sabotaje | Rojo | Verde (el control que demuestra que el aserto distingue) |
|---|---|---|
| `appType: "mpa"` fuera de `vite.config.ts` | SOLO «un estático que no existe … devuelve 404» — detalle: `200 text/html` en los dos | «el hermano que SÍ existe» ✔, y **el bloque 4 entero del guion 13 ✔** — confirma la declaración honesta del ingeniero (§5): ese bloque NO canda el 404 de Vite, usa uno inyectado |
| `coverHtml` pinta el TÍTULO DEL MUNDO en el marcador | SOLO «el marcador lleva el nombre del ESTILO» — `[["Miravanda","Acuarela luminosa"], …]` | todo lo demás ✔. El aserto NO es autorreferente: distingue una regresión realista |
| `vigilarPortadas` deja de registrar pero SIGUE quitando el `<img>` (negativo más fino que el N4 del informe) | «deja rastro en el registro» y «la entrada NOMBRA el estilo» | «ninguna tarjeta se queda con `<img>` roto» ✔ — los asertos del registro cuelgan del registro, no del `remove()` |
| `this.vigilarPortadas()` fuera del constructor (negativo de MI guion 28) | los 3 asertos del 28, con `hayImg:true, ancho:0` (el icono roto de vuelta) | — |
| route de `/sprites/**` desactivada (negativo de MI guion 27) | «vuelve al título con un aviso VISIBLE» y «el cliente tiene escrito el remedio» — desenlace `{"arrancó":"tile_0_0"}` | prueba que esos asertos cuelgan del fallo, no del reloj |

Árbol restaurado tras cada sabotaje (`git diff` vacío; solo quedan mis dos guiones nuevos).

## Hallazgos

### H1 · BLOQUEANTE (para cerrar #255 p2) — al clon limpio se le miente sobre la causa

**Repro desde el arranque** (`node qa/run.mjs 27`, o a mano):
1. `./start.sh --preset e2e-sin-creditos` y abrir la URL con `?ai=` (o clonar el repo, que es lo
   mismo: `nefan-html/public/sprites/` está en `.gitignore`).
2. «Nueva partida» → elegir *Miravanda* → «Continuar» → «Comenzar».

**Lo que pasa**: el título vuelve con

```
No se pudo empezar la partida. El servidor del juego no pudo completarlo; inténtalo de nuevo.
```

**Por qué**: `setPlayerAppearance` espera a `baseSheetsReady`, que rechaza con `faltan 10 de 10
hojas (…) — Error: HTTP 404 on /sprites/y_bot/idle/frontal_8/meta.json`. Ese texto no casa con
ningún patrón de `motivoDeSesionParaElJugador` (`nefan-core/src/protocol/status-labels.ts:167`)
y cae a la rama por defecto, que **culpa al servidor y manda reintentar**. La única línea
accionable —la que esta tanda añadió— va al error-log, que en el título está oculto por CSS.

**Qué esperaba el jugador**: que le dijeran que faltan las hojas del personaje y dónde
conseguirlas, que es justo lo que el cliente YA tiene escrito (medido: `remedio en el DOM: true`,
`#error-log display:none`).

Es la misma familia de mentira que arregla la tanda, un piso más arriba: **un fichero que falta
se disfraza de servidor con hipo**. Y el consejo que da («inténtalo de nuevo») no puede funcionar
nunca. Candado: `qa/guiones/27-el-clon-limpio-quiere-jugar.mjs`, que **nace ROJO** en dos asertos
(precedente del repo: el guion 25 nació rojo en QA y se ascendió al arreglarlo).

**Nota**: la degradación en sí es correcta y fail-loud (no se juega sin cuerpo, y no se queda
colgado). El fallo es el ROTULO.

### H2 · IMPORTANTE — dictamen sobre #218 y el registro escondido

La pregunta del encargo: *si un error de portada no se ve nunca donde ocurre, ¿está #218 cerrado?*

**Mi dictamen: sí, en su mitad de jugador; no, en su mitad de registro — y no es bloqueante.**

- Lo que #218 pedía primero («lo primero que ve quien abre el bench» era un icono roto) está
  resuelto y candado: el marcador se ve, es legible y no hay marco roto en ninguno de los dos
  caminos (nacimiento y repintado).
- El rastro EXISTE (DOM + `console.error`), así que el criterio literal «deja rastro en el log»
  se cumple. Lo que no se cumple es que se LEA donde ocurre: `#error-log` está en `display:none`
  mientras el título está delante.
- Agravante que nadie ha nombrado: **el marcador de «portada caída» es idéntico al de «este
  estilo no declara portada»** (`loader.ts:351` deja `cover_url` undefined y `coverHtml` pinta el
  mismo marcador; `_plantilla` ya es un pack sin `cover.jpg`). O sea que en pantalla no hay NADA
  que distinga un asset-store caído de un pack sin arte — y lo único que los distingue es la
  entrada que el título oculta.

No propongo deshacer #246. La salida que ya apuntó el ingeniero (§6.1) es la correcta y encaja
con H1: **el título necesita canal propio para sus errores** (hoy por `errors.push("title", …)`
salen también los fallos de listar partidas guardadas, que nadie ve nunca).

### H3 · IMPORTANTE — cada intento fallido deja una partida basura

Consecuencia directa de H1 y del consejo «inténtalo de nuevo»: `startSession` crea la sesión
ANTES de que falle la apariencia, así que el save queda en disco. En la captura
`27-…-01-clon-limpio-pulsa-comenzar.png` se ve el resultado del PRIMER intento:

```
Partidas guardadas — Bridge OK — 1 partidas guardadas.
alta_fantasia · 1787688969-6795d8 · (sin narrativa todavía) · 0 escenas · 0 entidades
```

Un clon limpio que obedezca al mensaje acumula una por intento. Es comportamiento
preexistente del arranque fallido, pero esta tanda es la que lo pone en la ruta segura de todo
el mundo que clone el repo.

### H4 · MENOR — la paridad del fake es real, pero no es la que dice ser

Levanté los dos servidores (real en `:18801`, fake en `:18802`) y comparé. **Las seis filas del
informe salen exactas**: mismo status, mismo `Content-Type`, mismo `Cache-Control: max-age=300`,
mismo `Access-Control-Allow-Origin: *`, mismos cuerpos de error al byte y mismo md5 (y el md5 de
`cover.jpg` coincide con el del fichero en disco: `e121aa0d…`). Añado tres casos que él no midió:

| Caso | asset-store real | fake |
|---|---|---|
| `/styles/acuarela_luminosa/cover%2Ejpg` | **400** (`extname` no ve el punto codificado) | **200 + la imagen** (el fake hace `decodeURIComponent` por segmento; el real no) |
| `/styles/acuarela_luminosa/cover.jpg/` | **200** (el real recorta la barra final) | **400** |
| cualquier 200 | `Content-Length` presente | **sin `Content-Length`** (chunked) |
| `/styles/{id}` (2 segmentos) | `{"ok":false,"error":"no route for GET …"}` | `{"detail":"fake-ai-server: ruta desconocida …"}` (404 genérico preexistente, no es de esta tanda) |

Ninguno afecta a un `<img>` (nadie codifica el punto ni pone barra final), y no hay travesía
posible: `SAFE_ID` rechaza `/` decodificado. Pero es exactamente el riesgo que el plan §9
señalaba y el ingeniero declaró sin candar: **el fake se copia a mano y ya se ha desviado en tres
detalles el mismo día que se escribió.** Munición para el issue de paridad que él propone.

### H5 · MENOR — la receta del remedio empieza con un `git clone` de un repo privado

`README.md:76` manda `git clone https://github.com/alberto-hortelano/sprite-forge`, y ese repo es
privado (`gh api repos/alberto-hortelano/sprite-forge --jq .private` → `true`). Para el dueño
funciona (comprobado con `--dry-run` real); para cualquier otro, el remedio que el juego nombra
muere en el primer comando. No es código de esta tanda (viene de `006f4f8`, punto 1 de #255),
pero el criterio «un remedio que de verdad funciona» es de esta.

### H6 · MENOR — dos afirmaciones del informe que no se sostienen

1. **§4.3: «Su cometido (que un repintado no se escape) sí está candado: el bloque 1 del guion 26
   mide el estado tras el repintado.»** No es cierto: el guion 26 abre el selector y mira; no
   pulsa ninguna tarjeta ni toca el desplegable, que son los DOS únicos sitios donde corre
   `refreshCover()` (`title-screen.ts:700` y `:721`). El camino del `outerHTML` no lo ejercía
   nadie. Lo he medido y **funciona** (el listener de captura sí ve a los hijos nuevos), así que
   la decisión de no añadir el barrido `naturalWidth === 0` queda VINDICADA — pero por medida,
   no por deducción. Candado nuevo: `qa/guiones/28-la-portada-repintada-tampoco-miente.mjs`.
2. Sobre el mismo punto 4 del encargo (¿hay ruta por la que una imagen rota no dispare `error`?):
   no la encontré por caché, por imagen ya decodificada ni por `loading=lazy` (no se usa); el
   listener se engancha en el constructor, antes de que exista ninguna tarjeta, y las portadas
   nacen todas dentro de `this.root`. **La única fuga real es distinta de la que el plan quería
   tapar**: una portada que NO responde (asset-store colgado, no 404) nunca dispara `error`, así
   que degrada al marcador —eso se ve bien— pero no deja rastro. El barrido
   `complete && naturalWidth === 0` tampoco la habría cazado (`complete` sería `false`): lo que
   haría falta ahí es un plazo, y no lo pido por una fuga de este tamaño.

### H7 · MENOR — la prosa de `qa/README.md` se quedó mintiendo

`qa/README.md:69` sigue diciendo, en la fila del guion 13: *«Ojo al 200 mentiroso: el dev server
de Vite responde al PNG que no existe con el index.html de la SPA, así que el aserto mira el
content-type, no `r.ok`»*. Eso es justo lo que esta tanda dejó de ser verdad. Y la tabla «Los
guiones sembrados» no incluye el 26 (ni, ahora, el 27 y el 28). La tanda borró la mentira del
comentario del guion y la dejó en el documento que lo describe.

### H8 · Crítica visual (capturas de hoy)

- `26-…-02-portadas-del-bench-pintadas.png`: las cuatro se pintan y **componen como sistema** —
  las cuatro son capturas del propio juego en primera persona, misma óptica y misma altura de
  cámara, así que la rejilla se lee como una colección y no como cuatro assets sueltos. Bien.
  Por calidad: *Valdesombra* es la mejor (callejón nocturno, luz cálida, profundidad);
  *Miravanda* funciona (agua + puente + casas, hay un sujeto); *Colonia Áster* es plana y gris,
  se salva por las bandas de peligro amarillas; **`toledo_1200` es la más débil**: recortada a
  192×128 es un muro de ladrillo frontal sin sujeto ni profundidad — dice «pared», no «Toledo,
  1200». Es material de portada, no de esta tanda, pero si alguien vuelve a las portadas, esa es
  la que repaga.
- `26-…-01-sin-portadas-marcador-y-registro.png`: la degradación es sobria y correcta. El texto
  del marcador va a `#555` sobre `#23202b`: legible pero muy apagado — coherente con «esto es un
  hueco», y por eso mismo no comunica «esto ha fallado» (ver H2).
- `13-…-03-clon-sin-hojas-lo-dice.png`: el remedio está arriba del todo y se lee. Debajo, diez
  trazas con `stack` que son ruido para quien juega; el orden nuevo (`allSettled`) es la
  diferencia entre leerlo y no leerlo, y se nota.
- Preexistente, visible en las tres capturas del título: el botón **«✕ cerrar (modo fixtures)»
  aparece cortado por la barra del panel de dev** (arriba a la derecha). No es de esta tanda
  (#250/#251 andan por ahí), pero es lo único roto que se ve en la pantalla inicial.

## Workarounds usados durante la prueba

| Workaround | Veredicto |
|---|---|
| `ctx.page.route("**/sprites/** → 404")` para producir el clon limpio | **No es hallazgo**: reproduce en el borde el estado real de un clon (`public/sprites/` gitignoreado) y el 404 de Vite REAL se mide aparte, en el bloque 1-bis del mismo guion. El jugador tiene el mismo obstáculo por construcción |
| `route` de las imágenes de estilo → 404 para tirar las portadas | **No es hallazgo**: el asset-store caído es un estado normal del juego (`start.sh` puede arrancar sin él) |
| Levantar asset-store y fake en puertos libres (18801/18802) para la paridad | **No es hallazgo**: solo mide, no toca el camino del jugador |
| Cinco sabotajes temporales de ficheros trackeados para los negativos | **No es hallazgo**: método obligatorio del rol. Árbol restaurado y verificado (`git diff` vacío) |
| `ctx.nefan("closeTitle")` en el guion 13 (del ingeniero) para ver el registro | **SÍ es hallazgo, y es H2**: el jugador no cierra el título para leer errores; el camino que sí recorre es el de H1 |

## No probado

- **El asset-store REAL sirviendo portadas al cliente** (solo por `curl`). Con `?ai=` el cliente
  resuelve el asset-store al fake pase lo que pase, y montar el otro camino es lo que el crítico
  descartó por escrito. Riesgo bajo: los bytes y las cabeceras son idénticos y un `<img>` no
  necesita CORS.
- **Mutación**: `npm run mutate` está tapiado hoy; y la tanda no toca `nefan-core/src`.
- **Un clon de verdad en otra máquina**: `assets/characters/` también está gitignoreado, así que
  no puedo ejercer la receta como la ejerce alguien que no tiene los FBX. Lo que sí verifiqué es
  que el comando documentado corre verbatim aquí y que el repo que pide es privado (H5).
- **HEAD y OPTIONS del fake** más allá de un sondeo: `OPTIONS` responde 204 en los dos; `HEAD` no
  lo usa nadie en este camino.

## Batería

`node qa/run.mjs` completa, corrida por mí sobre la rama, con mis dos guiones nuevos dentro:

```
25/27 guiones en verde
✘ 15-guardia-se-ve-y-se-comporta   ← la moneda al aire conocida (#247/#262)
✘ 27-el-clon-limpio-quiere-jugar   ← MÍO, nace rojo: es el hallazgo H1
```

- **15** falla por lo de siempre y no por esta tanda: `mercader: distancia al punto de la pelea
  9.22 → 9.95 m` — el mercader SÍ se aleja (0,73 m), el umbral pide más. Misma firma que midió el
  ingeniero sobre el árbol limpio (9.22 → 9.94). Nada de la tanda toca el sim ni la vida de NPCs.
- Los otros 25, incluidos los que dependen del dev server para cargar fixtures, escenas y hojas
  (`01`, `21`, `24`, `25`), **en verde con `appType: "mpa"`**: el riesgo que el plan §9 ponía
  primero —«mpa 404ea algo que alguien pedía a ciegas»— no se materializa. Confirmado además por
  lectura: `start.sh` y `qa/run.mjs` abren siempre la raíz (`http://localhost:3000/?ai=…`), no
  hay `server.proxy` en `vite.config.ts` y nada sirve `dist/`.

Los guiones nuevos (`27`, `28`) están probados en negativo, cada uno en su corrida (tabla de
negativos arriba).

## Veredicto

**APTO CON RESERVAS.**

#217 y #218 están hechos, medidos en el flujo real y candados con guiones que he visto ponerse
rojos uno a uno. El freno explícito del encargo no se dispara. La paridad del fake es cierta en
lo que afirma.

Las reservas, en orden: **#255 punto 2 NO puede darse por cerrado** — al clon limpio que quiere
jugar se le dice que el servidor tuvo un problema y que reintente, que es falso y no lleva a
ningún sitio (H1, guion 27 rojo). Y el rastro que #218 empieza a dejar no se lee en la pantalla
donde ocurre (H2), lo que deja al título sin ningún canal visible para sus propios fallos: el de
las portadas, el de las partidas guardadas y el de H1, los tres.

Ninguna de las dos reservas justifica revertir nada: lo que hay está mejor que lo que había. La
condición es que **#255 siga abierto con H1 pegado dentro**, porque hoy su síntoma no es
«no se entera», es «se le dice otra cosa».
