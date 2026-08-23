# QA — El arranque del cliente (#181 + #189 + #180)

Rama `fix/arranque-del-cliente`, cambios sin commitear. Validado desde el arranque real
(`./start.sh --preset e2e-sin-creditos`), no desde los tests. El árbol se restauró byte a byte
tras cada prueba en negativo (`md5sum -c`, verificado 6 veces).

**Veredicto: NO APTO.** Tres de los cinco mecanismos funcionan y están bien hechos. Pero un
criterio de aceptación literal (**#181-c, «el botón no se desplaza bajo el cursor»**) **no se
cumple** —119 px medidos— y el guion que lo certifica lo mide en un sistema de referencia donde
el movimiento es invisible por construcción. Y el aserto que el guion 18 anuncia como el más
valioso («el título de vuelta está VIVO») **sigue verde con el bug puesto**. Dos verdes que no
comprueban nada, que es exactamente lo que el proyecto tiene escrito que no se acepta.

---

## 1. Criterios

Sacados de `requisitos.md` (petición original + las tres correcciones del coordinador), no del plan.

| # | Criterio (literal) | Veredicto | Evidencia |
|---|---|---|---|
| **#181-a** | El botón «Nueva partida» escucha desde su primer pintado (ventana muerta = 0) | ✅ cumple | `qa/guiones/18`: el espía clica `#ts-new` en la microtarea siguiente a su pintado, con `#ts-status` todavía en «Cargando saves desde el bridge...», y el selector abre. En negativo (enganche detrás del `await`) el guion se pone rojo — reproducido por mí, §5.1 |
| **#181-b** | El click deja de tragarse el fallo: `errors.push` + algo que el jugador lea | ✅ cumple | `qa/guiones/19` bloque 4 (nuevo): `#ts-error` = «No se pudo abrir el selector de mundos: Bridge request timeout: list_games», entrada `title` en `#error-log`, botón restaurado. Confirmado además con el bridge muerto (`Bridge not connected`) y con el directorio de juegos vacío (`no games available in bridge`) |
| **#181-c** | **El botón no se desplaza bajo el cursor al llegar la lista de saves** | ❌ **NO cumple** | Medido en coordenadas de viewport (donde vive el cursor): **463 px → 344 px con 3 saves (−119 px)**; **−15 px incluso con 0 saves**. El orden viejo daba **+118 px**: el cambio invierte el signo y conserva la magnitud. `qa/guiones/19` bloque 2. Mecanismo en §3.1 |
| **#181-d** | (corrección nº1) `show()` arma `resolve` ANTES de `renderHome` | ✅ cumple | `qa/guiones/19` bloque 1 (nuevo): con `sessions_listed` retenido 20 s, se recorre mundo → personajes → Continuar → **Comenzar** dentro de la ventana y **la partida arranca**. En negativo (orden viejo) el bloque se pone rojo y «Comenzar» es un no-op mudo. **El ingeniero declaró que esto no se podía candar; sí se puede** |
| **#189-1** | Producir el repro real (fallo de sesión con el bridge ARRIBA) | ✅ cumple | `borrarSaveComoOtroCliente` por WS (`delete_session`) → «Reanudar» → `session_not_found`. Producido también por segunda vía: `game.json` roto → `game_load_failed` en **partida nueva**, que es el único camino donde el loader está abierto (§2, exp. D) |
| **#189-2** | Tras el fallo, el jugador vuelve al título **vivo**, con el motivo en pantalla | ⚠️ parcial | Vivo de verdad: verificado hasta arrancar una partida entera desde el título de vuelta (`qa/guiones/19` bloque 3). Dos y tres fallos seguidos: mundo a 0 tiles, jugador en la posición de reset, la partida siguiente arranca limpia. **Pero solo cubre los fallos que hacen RECHAZAR a `start/resumeSession`**: cuando el motor no contesta generando el mundo inicial —el fallo más probable de los primeros segundos— el jugador se queda sin salida salvo recargar. §3.2 |
| **#189-3** | Tras el fallo, `errors.push` registra el motivo | ✅ cumple | `#error-log` con fuente `session`: `session start/resume failed`. Aserto del guion 18 |
| **#180** | Los rótulos de `main.ts` dejan de ser jerga de motor | ⚠️ parcial | El TÍTULO sí: con el motor muerto al arrancar, el overlay dice **«La partida no pudo empezar»**, no «Error al generar el mundo» (exp. F, captura). Pero el CUERPO que lee el jugador en ese mismo overlay es **«Error: No se pudo generar la escena. fetch failed»**: `motivoParaElJugador` solo se aplica si hay `opts.destino`, o sea solo en viajes. §3.3 |
| **corr. nº2** | `paso()` sustituye los `void` del fichero; `max` congelado en el residuo REAL | ✅ cumple | Medido por mí con el patrón de la propia regla: **21 en HEAD → 8 en el árbol**, y los 8 son exactamente los que enumera el `why`. `title-screen.ts` y `main.ts` a cero. `max: 8` no tiene holgura. Las cuentas del `why` sí tienen errores (§4.1, hallazgo menor) |
| **corr. nº3** | El guion se llama `18-el-titulo-responde-y-vuelve.mjs` | ✅ cumple | `qa/guiones/18-el-titulo-responde-y-vuelve.mjs` |
| **plan §5** | Retirar el workaround del harness (`esperarTituloListo`) | ✅ cumple | Retirado. Los guiones afectados son **12**, no 15 (§4.4). Ninguno quedó esperando por casualidad: §3.4 |
| **alcance** | #224 fuera; no rediseñar el título; no tocar el modelo de saves | ✅ cumple | El diff no toca `session-storage.ts` ni el formato de save. El home se reordena (era necesario para #181-c), no se rediseña |
| **batería** | La batería completa en verde | ✅ cumple (17/17 previos) | Corrida entera dos veces por mí: **17/17** la primera, **17/18** la segunda (el único rojo es el guion 19 nuevo, y solo su aserto de #181-c). Log: `bateria-final.log` |
| **núcleo** | `npm test`, `npm run crap --check`, `npm run deuda` | ✅ cumple | `1303 tests / 0 fail`. `1067 funciones medidas · cobertura 90.2% · CRAP máx 126 ≤ 127` — **no es la corrida envenenada** de «0 funciones medidas». Deuda: `html-sin-promesa-muda ×8`, `title-screen.ts` y `main.ts` ausentes |
| **fallo tardío** | Volver al título tras un fallo POSTERIOR a `applySessionReady` | ⚠️ no probado | No he encontrado forma de provocarlo con el motor falso sin fabricar un save corrupto a mano. §6 |

---

## 2. Las tres afirmaciones que se pedía medir

### 2.1 «El `max` del candado es 8, no 18» — **el número es correcto; la explicación, no**

`max: 8` es **exacto**. Aplicando el patrón literal de `arch-rules.json` sobre el árbol salen
8 aciertos, y son uno a uno los que enumera el `why`. Sobre HEAD el mismo patrón da 21. Sin holgura.

Pero la aritmética de §5 del informe no cuadra (18 − 5 − 2 − 1 = 10, no 8), y las dos mitades
de la explicación no son iguales de ciertas:

| Afirmación | Veredicto | Medida |
|---|---|---|
| «contaba `void p.catch(...)`, que sí tienen canal» | **CIERTA** | **7 de los 18** tienen canal: 5 con `.catch` en la misma línea (`main.ts:363,828,1047,1531`, `fps-atlas.ts:115`) y 2 cadenas multilínea que acaban en `.catch` (`fps-renderer.ts:84`, la carga diferida de three.js; `dev-status-panel.ts:169`, el toggle de dev-cache). Leídas una a una |
| «y tres llamadas que ni siquiera son promesas (`renderCharacterEditor`, `renderCreateWorld`, `renderUploadStyle`)» | **las tres SON síncronas… pero no estaban en los 18** | `title-screen.ts:832 renderUploadStyle(): void`, `:994 renderCreateWorld(): void`, `:1077 renderCharacterEditor(...): void`. Ahora bien: los 18 del coordinador son *29 − los 11 de title-screen*, y esos tres viven dentro de los 11. **No explican ni uno solo de los 18**; explican por qué de los 11 solo 8 necesitaban `paso()` |
| ¿De dónde salen entonces los 10 restantes? | **3 los arregló él** | `main.ts:2303` (`void addTile(scene).then(...)`, cadena multilínea sin `.catch` — la única ocupante del punto ciego), `:2317 void loadSceneData(scene);` y `:2338 void bootstrap();`. En el informe figura como «1 era muda de verdad y la arreglé»: eran **tres**, y son trabajo suyo, no medida inflada del coordinador |

**Conclusión**: los 18 estaban inflados en **7** (39 %), no en 10. Congelar el `max` en 18 habría
dejado sitio para siete promesas mudas nuevas sin que la regla dijera nada; 8 es el número honesto.

**El punto ciego que la regla declara (cadena multilínea) hoy no tiene ocupante: CIERTO.** Barrí
`nefan-html/src` entero: solo quedan dos `void` multilínea y las dos acaban en `.catch`.

**Pero hay tres puntos ciegos MÁS que el `why` no declara**, probados contra el patrón real:

```
pasa   | void this.foo(); // sigue          ← un comentario al final rompe el ancla [;,]\s*$
pasa   | () => void this.foo())             ← una línea que acaba en ')' en vez de ';' o ','
pasa   | this.foo();                        ← sin `void` la regla no la ve…
```

…y esa última es la que importa: **quitar el `void` desactiva el candado**, y
`@typescript-eslint/no-floating-promises` **no está activo** en `nefan-html`
(`eslint.config.js` usa `tseslint.configs.recommended`, sin type-checking). O sea que el idioma
honesto se persigue y el descuidado pasa. No es motivo para rechazar la regla —caza el patrón
real que causó #181 y su test en negativo es bueno—, pero el `why` promete más alcance del que tiene.

### 2.2 «#181-b no se puede probar como pedía el plan» — **la premisa sí, la conclusión no**

**Premisa CIERTA, verificada en vivo** (exp. I): con el bridge abajo, `createGameClient` rechaza a
los 5 s, `bootstrap` sale por su catch y **`runTitleFlow` no llega a llamarse**. Medido:
`#title-screen` existe pero `display:none`, y **`#ts-new` no está en el DOM**. El loader dice «No se
pudo arrancar la partida». No hay botón que pulsar: el escenario del plan es inalcanzable.

**Conclusión FALSA**: «no queda candado ejecutable» no se sostiene. Encontré **tres** caminos al
mismo estado con el bridge arriba, y dos de ellos no matan ningún servicio:

1. **El bridge no contesta a `list_games`** — envolviendo el `WebSocket` de la página para no
   enviar ese frame. `request()` vence a los 30 s (que es el techo real que identificó el crítico)
   y el fallo llega por el camino de verdad. Determinista, sin tocar el stack compartido.
   **Es el bloque 4 de `qa/guiones/19`, y se pone rojo si se devuelve el `void` mudo.**
2. **Directorio de juegos vacío** — el bridge relee `gamesDir` en cada `list_games`
   (`loader.ts:306`), así que basta apartar los mundos: `#ts-error` = «No se pudo abrir el selector
   de mundos: no games available in bridge — check nefan-core/data/games/», entrada `title` en el
   log, botón restaurado, y al devolver los mundos el selector vuelve a abrir.
3. **El bridge muere con el título abierto** — el escenario que él ejecutó a mano. Reproducido:
   `#ts-error` = «No se pudo abrir el selector de mundos: Bridge not connected».

### 2.3 «El guion 18 canda el bucle de #189, no la retirada del `finally`» — **CIERTO, y hay más**

Devolví `finally { titleScreen.hide() }` **con el bucle puesto** y corrí el guion 18:

```
✔ tras el fallo de sesión el jugador está OTRA VEZ en el título
✔ …y el título dice qué ha pasado, con el motivo
✔ el título de vuelta está VIVO: «Nueva partida» sigue abriendo el selector
✔ 18-el-titulo-responde-y-vuelve · 1/1 guiones en verde
```

**Confirmado**: la retirada del `finally` no tiene candado propio. Es inocuo con el bucle (solo
ahorra un parpadeo de ocultar-y-reenseñar) y quitarlo sigue siendo lo correcto, pero el guion 18
promete «se vuelve a un título vivo y con motivo», no «el `finally` no vuelve».

**Y hay un segundo hueco, peor, que él no vio.** El comentario del guion 18 dice, del último aserto:

> *«Lo que separa «el título se ve» de «el título FUNCIONA», que es la trampa que tenía este
> arreglo: bastaba con no ocultarlo para que la pantalla volviera, pero su promesa ya estaba
> consumida y el siguiente «Comenzar» no resolvía a nadie. Se comprueba pulsando.»*

**No lo comprueba.** Pulsa `#ts-new` y espera `[data-game-id]`; ese click va contra un
`addEventListener` del DOM que sobrevive a todo. El que puede quedar muerto es `this.resolve`, y
no se lee hasta «Comenzar», dos pantallas más allá. Lo probé escribiendo la «opción C disfrazada»
—que `show()` no rearme `this.resolve` entre vueltas del bucle— y el guion 18 **pasa entero**:

```
✔ el título de vuelta está VIVO: «Nueva partida» sigue abriendo el selector
✔ 18-el-titulo-responde-y-vuelve · 1/1 guiones en verde
```

…mientras que llegar hasta «Comenzar» en ese mismo estado **no arranca nada**. Es el riesgo
«título vivo-muerto» que el plan enumera en §8 y que el guion dice cubrir. Ahora lo cubre el
bloque 3 de `qa/guiones/19`.

---

## 3. Hallazgos

### 3.1 BLOQUEANTE — #181-c no se cumple, y su candado no puede verlo

**Qué esperaba el usuario** (criterio literal de `requisitos.md`): *«El botón no debe desplazarse
bajo el cursor al llegar la lista de saves»*.

**Qué pasa.** El botón se sigue desplazando exactamente lo mismo que antes; lo único que cambió es
el signo.

| | al pintar | con la lista | Δ |
|---|---|---|---|
| Orden nuevo, 3 saves | 463 px | 344 px | **−119 px** |
| Orden viejo, 3 saves | 554 px | 672 px | **+118 px** |
| Orden nuevo, 0 saves | 463 px | 448 px | −15 px |

**Mecanismo, medido y aislado**: `#title-screen` es `display:flex` con **`justify-content:center`**,
así que el bloque de contenido está centrado verticalmente. Cuando llega la lista, el bloque
**crece 238 px hacia abajo y su top sube 119 px** — exactamente la mitad, verificado
(`contenido: top 366→247 · alto 232→470`). El `padding-top` del panel de dev no cambia: no es él.

**Por qué nadie lo vio**: el guion 18 mide `rect(#ts-new).top − rect(padre).top`, y el padre es el
bloque que se mueve. En esa referencia el número es 97 px → 97 px **con cualquier layout**: sale
verde con el orden nuevo y también saldría verde con el viejo si el botón no cambiara de sitio
dentro del bloque. El cursor del jugador no vive en coordenadas del padre.

**Reproducción desde el arranque**: `./start.sh --preset e2e-sin-creditos`, jugar 2–3 partidas para
sembrar saves, recargar el título, poner el cursor sobre «Nueva partida» en cuanto aparece y
esperar ~150 ms. El botón se va hacia arriba. Automatizado en `qa/guiones/19` bloque 2 (rojo hoy).

**Salidas posibles** (no las decido yo): `justify-content:flex-start` en el título, o reservar la
altura de `#ts-sessions` desde el primer pintado. La segunda la desaconsejaba el plan §8 por
números mágicos; la primera cambia la composición y hay que verla.

### 3.2 IMPORTANTE — #189 sigue abierto para el fallo más probable de los primeros segundos

`start_session` responde `ok:true` **antes** de generar el tile (`session.ts:374`; el plan lo
anota en §2 y luego no actúa). Así que cuando el motor no contesta generando el mundo inicial,
el fallo **no pasa por el catch de `unIntentoDeArrancar`**: el título ya se ocultó y el bucle ya
devolvió `null`.

Medido tras cerrar el overlay de error, que es lo único que la pantalla ofrece:

```
título visible: false · loader: false
mundo: 0 tiles · escena=null
controles clicables en pantalla: ["#room-selector","#ds-menu-btn","1Quick","2Heavy",
                                  "3Medium","4Defensive","5Precise","#gfx-chip"]
```

El jugador se queda con un cielo vacío, una barra de vida al 100 y cinco botones de ataque, sin
mundo y **sin nada que le devuelva al título**. La única salida es recargar — literalmente la frase
de #189. No es una regresión (en HEAD pasaba lo mismo), pero la tanda da #189 por cerrado y el
usuario lo describió como *«la pantalla a la que no se puede volver cuando algo falla»*.

**Reproducción desde el arranque**: arrancar los tres servicios por separado (si se usa `./start.sh`,
su `trap` mata el stack entero al morir uno) — `node labs/narrative/fake-ai-server.mjs`,
`NEFAN_AI_SERVER=http://127.0.0.1:18765 npx tsx bridge/ws-server.ts`, `npm run dev` —, llegar a
«Comenzar», matar `:18765` justo antes de pulsarlo, pulsar, y cerrar el overlay.

No lo dejo en `qa/guiones/`: automatizarlo dentro del runner exige o matar un servicio del que
depende el resto de la batería, o que el fake-ai-server sepa fallar a petición (no tiene endpoint
para eso). Lo segundo es barato y sería el camino.

### 3.3 IMPORTANTE — #180: el rótulo está arreglado, el cuerpo del mismo overlay no

La premisa sobre la que el crítico redujo #180 a «dos rótulos» —*«el cuerpo ya está escrito para
quien juega por `motivoParaElJugador` (cf7b446)»*— **solo vale para los viajes**. En
`tile.ts:250-254` la traducción está dentro de un ternario:

```ts
fail(opts.destino
  ? `No se pudo llegar a ${opts.destino}. ${motivoParaElJugador(err)}`
  : `Error: ${(err as Error).message ?? err}`);
```

Sin `destino` —o sea, en el arranque del mundo y en la frontera— el jugador lee el error crudo.
Medido en el overlay real (captura):

```
TÍTULO : La partida no pudo empezar        ← arreglado por esta tanda
DETALLE: Error: No se pudo generar la escena. fetch failed   ← sigue siendo jerga de motor
```

O sea: en el estado que da nombre a la tanda —los primeros segundos— #180 queda a medias, y la
mitad que queda es la que el usuario nombró («lo que se lee cuando falla»). El fixture del test de
`status-labels` usa como cuerpo «No se pudo llegar a Robledo. El motor narrativo no responde…»
incluso para el caso `mundoVacio`, que es justo el cuerpo que ahí **no** llega: el test hereda la
premisa falsa y por eso el hueco no se vio.

### 3.4 IMPORTANTE — el canal nuevo (`#ts-error`) enseña errores internos al jugador

`#ts-error` es la superficie que esta tanda ABRE, y hoy imprime literalmente lo que venga:

- `No se pudo reanudar la partida: session_not_found`
- `No se pudo empezar la partida: game_load_failed: game.json malformed (/home/…/games/alta_fantasia/game.json): Expected property name or '}' in JSON at position 2 (line 1 column 3)` — **con la ruta absoluta del disco de quien juega**
- `No se pudo abrir el selector de mundos: Bridge not connected`
- `No se pudo abrir el selector de mundos: Bridge request timeout: list_games`
- `No se pudo abrir el selector de mundos: no games available in bridge — check nefan-core/data/games/`

El ingeniero anota el primero en su backlog (§8.2). Los otros cuatro son de la mitad que sí
escribió esta tanda, y la primera mitad de cada frase demuestra que el sitio para traducirlos ya
existe. Con `motivoParaElJugador` a mano en el bridge, esto es un `motivoDeSesionParaElJugador` de
diez líneas, no un rediseño.

### 3.5 MENOR — el `why` del candado, que es fichero de contrato, tiene tres cuentas mal

- «En `main.ts` había cuatro y se fueron los cuatro» → eran **tres** (`grep -c "paso(" main.ts` = 3;
  los cuatro `void ... .catch(...)` de `fpsAtlasController` siguen ahí, con razón).
- El informe: «1 era muda de verdad y la arreglé» → eran tres, y la resta no cuadra (§2.1).
- «los quince guiones que pasan por aquí» (en `sesion.mjs`, en la cabecera del guion 18 y en el
  informe) → son **doce**: `05,07,08,09,10,11,12,13,14,15,17,18`. Los otros cinco entran por
  `closeTitle` (modo fixtures) y nunca tocaron el workaround.

Números pequeños, pero el `why` de `arch-rules.json` es lo que alguien leerá dentro de tres meses
para decidir si baja el `max`.

### 3.6 MENOR — la vuelta al título deja pasar el HUD por debajo

`#title-screen` es `rgba(8,8,12,0.97)` con `z-index:9999`; `#error-log` está a 8900 y el HUD del
juego por debajo. Al volver al título tras un fallo se leen fantasmas del panel de errores y de la
barra de acciones detrás del texto, justo al lado del botón «✕ cerrar». Se ve en
`qa/capturas/18-…-03-de-vuelta-en-el-titulo-con-el-motivo.png`. Es pre-existente (pasa igual en el
arranque), pero antes de esta tanda nadie volvía al título con la partida a medias detrás.

### 3.7 MENOR — el rótulo del viaje repite el principio del cuerpo

`TÍTULO: No se pudo llegar` sobre `DETALLE: No se pudo llegar a Molino del bench. El motor…`.
Se lee dos veces lo mismo. El rótulo podría ser el nombre del destino.

### 3.8 MENOR (pre-existente, CONFIRMADO) — el guion 15 es una moneda al aire, y también en `main`

El ingeniero lo declara pre-existente. **Lo es**, y lo demuestro sin lugar a dudas: corrí el guion
15 **sobre `main`** (con la tanda entera en `git stash` y los ficheros nuevos apartados):

```
main, corrida 1:  mercader: 9.22 → 10.28 m   ✔ verde   (margen: 0,06 m sobre el umbral de 1)
main, corrida 2:  mercader: 9.16 → 10.13 m   ✘ ROJO    (0,97 m: le faltaron 3 cm)
```

Y **el umbral no tiene sujeto**: `atacarYVer` espera a que el NPC se desplace **1,5 m** con un
cortafuegos de 30 s, pero el aserto pide solo **1 m**. Si la espera se cumpliera, el aserto pasaría
con 0,5 m de margen; como nunca se cumple, lo que decide el veredicto es **dónde estaba el NPC
cuando venció el cortafuegos de pared** — que es exactamente lo que la regla 1 de `qa/README.md`
prohíbe. En mis dos corridas verdes del guion 15 sobre la tanda, la distancia recorrida fue 1,06 m:
verde por 6 cm. El arreglo no es bajar el umbral: es que el sim RECUERDE el desplazamiento máximo
alcanzado, como ya se hizo con `telegraphEpisode` en el guion 10.

---

## 4. Lo que dejo ejecutable

**`qa/guiones/19-el-titulo-arranca-de-verdad.mjs`** (nuevo). Cubre los cuatro huecos del 18, y los
cuatro se descubrieron probando el 18 en negativo. Estado actual: **6 asertos verdes, 1 rojo** — el
rojo es el hallazgo 3.1, y se pondrá verde cuando el botón deje de moverse.

| Bloque | Qué canda | Probado en negativo |
|---|---|---|
| 1 | «Comenzar» **dentro** de la ventana de carga de saves arranca la partida (corrección nº1) | `show()` con el orden viejo (`resolve` tras `renderHome`) → **rojo**, y el aserto de NO CONCLUYENTE sigue verde |
| 2 | El botón no se desplaza **en el viewport** al llegar la lista | Rojo hoy: es el hallazgo. Con el orden viejo del home también rojo (+41 px) |
| 3 | El título de vuelta **arranca una partida entera**, no solo abre el selector | `show()` sin rearmar `resolve` entre vueltas → **rojo** (y el guion 18 verde) |
| 4 | El click no es mudo cuando el bridge no contesta (#181-b), con acuse de recibo inmediato | Click devuelto a `void this.renderWorldSelect()` → **rojo**, más una excepción sin capturar en la página |

**Instrumentación, declarada dentro del guion**: los bloques 1 y 4 envuelven el `WebSocket` de la
página para retrasar `sessions_listed` y para no enviar `list_games`. No ocultan ningún obstáculo:
producen uno que el jugador puede tener (un bridge lento — el techo de 30 s que identificó el
crítico) sin tocar el bridge compartido por la batería.

---

## 5. Pruebas en negativo que reproduje yo

Cada una cambiando **solo lo suyo**, y restaurando el árbol con `md5sum -c` verificado.

1. **Enganche detrás del `await`** → guion 18 rojo en «pulsar «Nueva partida» en su primer pintado
   abre el selector» (reproducido; coincide con el informe).
2. **`finally { hide() }` devuelto CON el bucle** → guion 18 **verde 1/1**. Confirma §2.3.
3. **`show()` sin rearmar `resolve`** → guion 18 **verde 1/1**, guion 19 bloque 3 rojo.
4. **`show()` con el orden viejo** → guion 19 bloque 1 rojo, guion 18 verde.
5. **Click devuelto al `void` mudo** → guion 19 bloque 4 rojo.
6. **Orden viejo del home** → el botón se mueve +118 px en viewport y +80 px dentro del bloque.

---

## 6. Workarounds e instrumentación usados

Ninguno ocultó un obstáculo que el jugador vaya a tener. Los declaro todos:

| Qué | Por qué NO es un hallazgo |
|---|---|
| Retrasar `sessions_listed` en el `WebSocket` de la página | Emula un bridge lento, que es el estado que #181 describe y cuyo techo (30 s) identificó el crítico. Sin él, la ventana dura 150 ms y ningún recorrido de UI cabe dentro |
| No enviar `list_games` | Igual: un bridge que no contesta. Alternativa sin instrumentación (directorio de juegos vacío) probada y con el mismo resultado |
| Apartar los mundos de `data/games` del disco efímero | Estado real (instalación rota / `NEFAN_GAMES_DIR` mal). Se devuelven y el selector vuelve a abrir |
| Romper el `game.json` con el selector ya pintado | Única forma que encontré de provocar un fallo de **partida nueva** con el loader abierto — el caso donde el riesgo «dos overlays» podía darse. Resultado: `hideLoader()` funciona, no hay error tapado |
| Matar `:18765` / `:9877` | Estados reales (motor caído, bridge caído). Obligó a arrancar los servicios por separado: `./start.sh` mata el stack entero por su `trap` cuando muere un hijo |
| `git stash` de la tanda para correr el guion 15 sobre `main` | Solo para comprobar pre-existencia. Árbol restaurado y verificado |

---

## 7. No probado

- **Fallo TARDÍO de sesión** (posterior a `applySessionReady`, p. ej. `setPlayerAppearance`
  reventando): el bucle llama a `resetWorld()` y `activeSessionId = null`, pero `sessionModesApplied`,
  el tema de UI y `historyBrowser.setSession` conservan lo del intento anterior. No he encontrado
  forma de provocarlo con el motor falso sin fabricar un save corrupto a mano, que ya no sería el
  flujo del jugador. Riesgo §8 del plan, **sigue vivo y sin medir**.
- **Muchos saves (20, 200)**: probado con 0, 1, 2 y 3. El desplazamiento del hallazgo 3.1 crece con
  N hasta que el bloque llena la pantalla y `max-height:100%` lo clava; a partir de ahí deja de
  moverse. No he medido dónde está ese punto.
- **Gasto de créditos**: cero en todo lo anterior — preset `e2e-sin-creditos` y motor falso. No se
  ha ejercido ningún camino con IA real.
- **Mutación**: no la he vuelto a correr (34 min de reloj y el diff no cambió desde su corrida).
  Reviso su resultado como dato del ingeniero, no como medida mía.

---

## 8. Veredicto

**NO APTO.** Falta poco y casi todo está bien hecho, pero lo que falta es de la clase que este
repositorio tiene escrito que no se acepta.

Funciona y está candado: el botón escucha desde su primer pintado; el click ya no es mudo por
ninguno de los tres caminos que probé; `show()` arma su promesa a tiempo y la partida arranca
incluso dentro de la ventana; el bucle aguanta dos y tres fallos seguidos sin dejar mundo a medias;
el `hideLoader()` del catch evita el error tapado; el rótulo del overlay dejó de ser jerga de motor;
el `max: 8` es el residuo real y su regla está probada en negativo.

Lo que lo para:

1. **#181-c no se cumple** (−119 px bajo el cursor) **y el guion 18 lo declara cumplido** midiendo
   en un sistema de referencia donde el fallo es invisible. Un criterio no cumplido es corregible;
   un candado que da verde sobre él es lo caro.
2. **El aserto que el guion 18 anuncia como su más valioso** —«el título de vuelta está VIVO»—
   **pasa con el bug puesto**. Lo probé.
3. **#189 se cierra para el fallo que rechaza y se queda abierto para el que responde `ok` y falla
   después**, que es el más probable de los primeros segundos: el jugador acaba sin mundo, sin
   título y sin más salida que recargar.

Lo mínimo para volver a mirarlo: arreglar (o decidir explícitamente no arreglar, por escrito) el
centrado vertical del título; adoptar los bloques 2 y 3 de `qa/guiones/19` —o meterlos en el 18— para
que los dos verdes falsos dejen de serlo; y decidir qué se hace con 3.2, aunque sea abrir issue y
declararlo fuera de esta tanda. 3.3, 3.4 y 3.8 pueden ir a issues sin bloquear.
