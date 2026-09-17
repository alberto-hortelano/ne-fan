# QA — PR G2 · «el juego no mete a nadie dentro» (#616, mitad de ARRIBA)

Worktree desprendido `/home/al/code/ne-fan-qa-g2`, HEAD `8c0c2fff` (sobre `82f0285b`, el primer
commit de G1). Todo lo que sigue está medido HOY (2026-09-17) en ese árbol. Cero créditos: todas las
corridas de navegador van por `qa/run.mjs` sobre el preset `e2e-sin-creditos`, con el guardarraíl
declarando `fake:true` en cliente y bridge en cada una.

**Sujeto**: G2 sola. La mitad de ABAJO («de dentro se sale»), la retirada de `blocksMove` y el
barrido de prosa son de G1 y las valida otra QA; lo suyo que me he cruzado va al final, marcado.

---

## 1 · Criterios, uno a uno

El criterio literal es el del usuario en `requisitos.md`: **«Las dos mitades»**, y de ellas la de
arriba es *«que el juego deje de meter al jugador dentro (el viaje consulta solidez antes de
teletransportar)»*.

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | El viaje por «Salidas» no vuelve a difundir un punto de aparición que nadie ha mirado | ✅ | `node qa/el-viaje-no-mete-a-nadie-dentro.mjs` → **13/13 centros ocupados (control) · 13/13 spawns libres · 13/13 en UNA marcha · máx 3,90 m**, exit 0, 0,15 s |
| 2 | …en el camino **CACHEADO** (`difundirPlaceRealizado`, `scene.ts:111`) | ✅ | Revertido ese sitio solo y `dist` recompilado: el guion headless **22 líneas en rojo (21 asertos + resumen), exit 1**; `bridge-map` 2 rojos (tests 1 y 3); mi guion de navegador **4 rojos** |
| 3 | …en el camino que **GENERA** (`spawnAt`, `scene.ts:181`) | ✅ la conducta · ❌ el candado ejecutable | Revertido ese sitio solo: `bridge-map` 2 rojos (tests 2 y 4) — y **todo lo ejecutable, VERDE**: headless exit 0 y `qa/run.mjs viaje 144` **4 de 4 en verde**. Hallazgo **H2** |
| 4 | El candado nuevo conduce el handler REAL con el proveedor de PRODUCCIÓN, no una cuenta | ✅ con un matiz MEDIDO | `qa/el-viaje-no-mete-a-nadie-dentro.mjs` importa `handlePlayerEnteredPlace` de `dist/bridge/handlers/scene.js` y arma `ctx.simCollision` con `createSimCollisionProvider(narrative)` — **la misma llamada, con la misma firma, que producción** (`bridge/ws-server.ts:69` → `:105`). Lo que NO cubre es el **cable** que los une, porque se lo construye él: cortándolo en `ws-server.ts` (`{...createSimCollisionProvider(narrative), ocupado: () => false}`) el guion headless sale **exit 0, VERDE**, y el jugador acaba emparedado en (19,00, 12,50). Lo caza el guion de navegador (§4): **exit 1, 4 rojos**. Es la lección de #583 una capa más arriba |
| 5 | Fail-loud con el NOMBRE del lugar, y nunca un spawn mudo | ✅ | Bloque 3 del guion: error con «No se pudo viajar a Casa del Concejo. No hay un sitio libre donde aparecer allí.», `kind: scene`, `placeId`, **sin `scene_init`, sin `ready`**, place no activo, motivo técnico al log. Quitando la guarda entera y recompilando: **6 rojos** de ese bloque |
| 6 | El spawn mudo es **INEXPRESABLE** (unión de tres casos) | ❌ | Borrar las 4 líneas de guarda de `difundirPlaceRealizado` compila **`npx tsc --noEmit` exit 0**, sin `as`, sin `??` y sin campo opcional, y produce el spawn mudo. Hallazgo **H1** |
| 7 | La frase nueva del jugador está candada | ✅ | Retirada la rama de `motivoParaElJugador`: **2 rojos en `status-motivo.test.ts`** (+ 2 más en `bridge-map`, que el informe no contaba) |
| 8 | `npm run verify` verde | ✅ | **2933 tests · pass 2933 · fail 0**, exit 0 (log completo en el scratchpad). El informe decía 2928 → 2933: el diff añade exactamente **5 `it(`** (4 en `bridge-map`, 1 en `status-motivo`) y borra 0 |
| 9 | La deuda no crece y ningún umbral baja | ✅ | `npm run deuda` → **86 items** (11 fronteras · 11 CRAP · 64 mutación). `npm run crap -- --check` → **✔ dentro de los umbrales, 0 por encima de 73**, objetivo 30: 7. `mutation-targets.json` toca **solo el `porque`**; `break` sigue en 100 |
| 10 | «la cobertura sube (95,85 → 95,99 %)» | ⚠️ no es una medida | Dos corridas consecutivas de `npm run coverage` sobre **el mismo árbol**: **95.85 %** y **95.96 %**. El delta que el informe presenta como mejora cabe entero en el ruido de la suite. Lo que sí vale: **≥ 95 %**, el mínimo, con margen. Hallazgo **H6** |
| 11 | `mutacion local status-motivo` 91 mutantes · 0 vivos · score 100 | ⚠️ no re-medido | No lo he vuelto a correr (el muro de mutación para agentes). Lo sustituyo por el negativo del criterio 7, que es la afirmación de fondo. `reports/mutation/` **no queda sembrado** en el árbol: comprobado, el directorio no existe |
| 12 | El guion nuevo entra en `candados-headless` el día que nace | ✅ | `.github/workflows/ci.yml`, último paso del job; el job ya hace `npm run build`, que es lo único que el guion necesita. Tiempo medido en árbol limpio: **0,15 s** (el README dice 0,2) |
| 13 | El banco de navegador **no puede ver #616** | ✅ confirmado, y es **peor** de lo que dice el informe | Ver §4. Son **dos** cegueras, no una |
| 14 | El observable de JUGADOR («llego y no puedo moverme») está cubierto | ❌ antes → ✅ ahora | No lo cubría nadie. Lo cubre `qa/guiones/144-el-viaje-de-vuelta-no-empareda-al-jugador.mjs`, que escribí para esto (§4) |
| 15 | Nada se rompe en el juego real | ✅ | `qa/run.mjs viaje 144` → **4 de 4 en verde** (08, 09, 137 y el nuevo). Los cuatro headless de la familia de geometría sólida, verdes: `el-viaje-no-mete-a-nadie-dentro` 0,15 s · `equivalencia-de-cajas` 0,07 s · `la-puerta-de-la-reaparicion` 0,27 s · `el-mundo-solido-tambien-para-el-npc` 0,20 s. Batería completa: ver §6 |

---

## 2 · Los negativos, corridos por mí y por separado

Todos con el sabotaje puesto **en el árbol** y `dist` recompilado, no simulado.

| Sabotaje | `bridge-map.test.ts` | `el-viaje-no-mete-a-nadie-dentro.mjs` | guion 144 (navegador) |
|---|---|---|---|
| Ninguno (HEAD) | 27/27 verde | exit 0 | verde |
| Los **dos** sitios revertidos | **4 rojos** (1, 2, 3 y 4) | exit 1, 21 asertos rojos | (no corrido) |
| Solo `:111` (lugar ya realizado) | **2 rojos: 1 y 3** | **exit 1, 21 rojos** | **exit 1, 4 rojos** |
| Solo `:181` (`spawnAt`, viaje que genera) | **2 rojos: 2 y 4** | **exit 0 — VERDE** | **verde** · y 08, 09, 137 también |
| Guarda `sin sitio` de `:111` borrada entera | (no medido) | exit 1, **6 rojos** del bloque 3 | (no corrido) |
| Guarda de `:111` **movida después** de `recordSceneLoaded`+`save()` | **1 rojo** (test 3) | **exit 0 — VERDE, 7/7** | (no corrido) |
| Rama de `motivoParaElJugador` retirada | **2 rojos** | (no aplica) | (no corrido) |
| `QA_SIN_SITIO=1` (el centro crudo, la regla de ayer) | — | exit 1, **15 rojos** (13 + 2 agregados) | — |

Dos lecturas, y las dos son hallazgos:

- **«su pareja y solo su pareja» es CIERTO para los tests unitarios.** Lo he verificado revirtiendo
  cada sitio: `:111` → 1 y 3; `:181` → 2 y 4. No hay punto ciego compartido entre los cuatro.
- **El «medio arreglo» pasa la batería entera.** Con `:181` roto y `:111` bien, **ningún guion
  ejecutable se entera** (H2).
- **Un aserto del guion nuevo no puede ponerse rojo por lo que dice sujetar** (H3).

---

## 3 · El tipo, medido en el tipo (criterio 6)

El informe (§1) y el mensaje de commit dicen: *«un helper local `dondeAparecer` que devuelve una
unión de tres casos … **para que el mudo sea inexpresable**»*. Lo comprobé escribiendo el estado
malo:

```
$ python3 …  # borra el bloque `if (donde.de === "sin sitio") { … return true; }` de difundirPlaceRealizado
bloque retirado, bytes: 883
$ npx tsc --noEmit
TSC_EXIT=0
```

Compila **limpio**. No hace falta un `as`, ni un `??`, ni un campo opcional: basta borrar cuatro
líneas, y la línea de abajo —`const spawn = donde.de === "punto" ? donde.spawn : undefined;`— vuelve
a colapsar `sin sitio` y `sin ancla` en el mismo `undefined` sin que el compilador diga nada. Lo
mismo en `spawnAt`: quitar el `throw` deja `return donde.de === "punto" ? donde.spawn : undefined`,
que compila y devuelve el mudo. Y el otro extremo tampoco lo impide: `broadcastScene` declara
`spawn?: { x: number; z: number }` (`bridge/context.ts:350`), opcional.

Que el estado malo se detecte lo hacen **el `if` y los candados**, no el tipo. La unión de tres
casos está bien —**distingue** tres desenlaces que antes se colapsaban, y eso es una mejora real y
lo que hace legible el handler—, pero «inexpresable» es la palabra de
`feedback_garantia_en_el_tipo` y significa otra cosa: que el estado malo no se pueda escribir. Con
la medida puesta (compila, exit 0, y el guion lo caza con 6 rojos) el reparto de méritos es
distinto y hay que decirlo así, porque el mensaje de commit es permanente.

---

## 4 · El hallazgo 3 del ingeniero: verificado, ampliado, y tapado

El informe declara que el banco no puede ver #616 porque la taberna del bench es un volumen
**cutaway** cuyo centro sale libre, y que por eso no lo tapó: *«es trabajo de QA y toca el banco»*.

**Es cierto, y se queda corto por dos sitios.** Sonda propia con el cableado de producción
(`createSimCollisionProvider` sobre `bootstrapTile()` / `makeTile()` expandidos):

| ancla del banco | centro | `ocupado` | `sitioParaAparecer` |
|---|---|---|---|
| `BOOTSTRAP_PLACE_RECT` (taberna cutaway) | (0,00, −4,00) | **false** | lo devuelve **sin mover** |
| `ANCHORED_PLACE_RECT` (lugar anclado del viaje) | (64,00, 7,00) | **false** | lo devuelve **sin mover** |
| `casa_lenador` del bootstrap (entity `building`, maciza) | (19,00, 12,50) | **true** | (19,00, 16,40), 3,90 m |
| casa principal del lugar anclado, `[50,50,28,18]` | (64,00, −2,50) | **true** | (64,00, 2,40), **4,90 m** |

O sea: **los DOS rects que usa el motor falso caen en hueco**, no solo el de la taberna. El informe
midió uno. Y el `spawnAplicado` que el guion 09 imprime hoy lo confirma desde el otro lado:
`{"x":0,"z":-4}` — el centro crudo, intacto.

**Y hay una segunda ceguera que el informe no nombra, y es la peor**: el guion 09 afirma *«el punto
de aparición de la vuelta no es sólido (no aparece incrustado)»* con
`probeCollide(regreso.pos.x, regreso.pos.z)`, y eso es `collidesAt(playerPos → playerPos)`, un
movimiento de un punto **a sí mismo**. La regla de celdas exime las que ya se solapaban, así que ese
aserto vale `false` también en el centro macizo de un edificio. Medido sobre `casa_lenador`:

```
centro (19.00, 12.50)  ocupado=true   blocksMove(p,p)=false   blocked={"n":true,"s":true,"w":true,"e":true}
spawn  (19.00, 16.40)  ocupado=false  blocksMove(p,p)=false   blocked={"n":false,"s":false,"w":false,"e":false}
```

**Ese aserto del 09 no puede ponerse rojo por #616 ni con el rect sobre un macizo.** Aunque se
arreglara la geometría del bench, seguiría midiendo aire.

### Lo que hice: `qa/guiones/144-el-viaje-de-vuelta-no-empareda-al-jugador.mjs`

Sí se puede poner un `anchor.rect` sobre un edificio macizo por el State API, y es el canal REAL
(`POST /map/place` → `WorldMap.upsertPlace`, el mismo `map_upsert_place` que usa el motor del banco;
`upsertPlace` conserva `realized_scene_id`, así que la vuelta sigue entrando por la rama cacheada).
El guion:

1. Partida nueva en el bench, viaje de ida al molino.
2. **`POST /map/place`** re-ancla `taberna_bench_place` sobre `casa_lenador` — `rect [92,82,20,14]`,
   el `cell`+`footprint` que declara el propio motor falso. Es exactamente lo que #465 quiere que
   escriba el motor de verdad.
3. Vuelta por el panel «Salidas», y se juzga con el **observable del jugador**, no con
   `probeCollide`: si está emparedado (`state().blocked` en los cuatro rumbos) y si **anda** de
   verdad (tecla mantenida, ≥ 1,5 m, los cuatro rumbos porque el movimiento es relativo al facing).

Corrida verde:

```
  ✔ el tile de arranque trae el edificio macizo «casa_lenador»
  casa_lenador: centro (19.00, 12.50) · huella 10 × 7 m
  ✔ el motor puede anclar el lugar sobre el edificio (map_upsert_place)
  centro crudo del ancla: (19.00, 12.50)
  de vuelta: tile_0_0 · pos {"x":19,"y":0,"z":16.4} · blocked {"n":false,"s":false,"w":false,"e":false}
  probeCollide(pos) = false — vale false también emparedado: no es una medida de #616
  ✔ CONTROL · el centro crudo del ancla estaba OCUPADO: el bridge movió el punto de aparición
  ✔ el viaje deja al jugador FUERA de la planta de «casa_lenador»
  de la cámara a la fachada pintada: 0.40 m (near plane de la fps: 0,3 m)
  ✔ y a la PUERTA del lugar, no en otro barrio
  ✔ el jugador puede dar un paso: no está emparedado en los cuatro rumbos
  ✔ y el jugador ANDA desde donde el viaje lo dejó
```

**Probado en negativo, tres veces:**

| Negativo | Resultado |
|---|---|
| `QA_616_CRUDO=1` (teletransporte al centro crudo, donde dejaba el bridge hasta esta PR) | **4 rojos**: control 0,00 m · dentro de la planta · `blocked {n,s,w,e} todos true` · **0 m andados en los cuatro rumbos** |
| `QA_616_ANCLA_LIBRE=1` (el ancla del motor falso, la taberna hueca) | **2 rojos**: el control da desplazamiento **0,00 m** — es la medida de por qué 08 y 09 no ven #616, escrita como negativo re-corrible |
| El bridge revertido de verdad (`:111`) y `dist` recompilado | **4 rojos**, jugador en (19,00, 12,50), `blocked` todos true, 0 m andados |
| El **cable de producción** cortado en `bridge/ws-server.ts:69` (`{...createSimCollisionProvider(narrative), ocupado: () => false}`) | **4 rojos**, mismo cuadro — y el candado **headless sale exit 0, VERDE**, porque se construye su propio proveedor. Es la lección de #583 una capa más arriba: el guion de navegador cubre el cable que el headless no puede ver |

Es decir: **el guion reproduce #616 tal y como lo sufre el jugador y lo ve morir con el arreglo
puesto.** Abre navegador, así que NO entra en `candados-headless`: vive en la batería local, que es
donde vive el resto de `qa/guiones/`.

---

## 5 · Hallazgos

### H1 · importante — «el spawn mudo es inexpresable» es falso, y está en un mensaje de commit

Medido en §3: borrar la guarda compila `tsc --noEmit` exit 0 y produce el estado malo. La unión de
tres casos distingue, no hace inexpresable; `broadcastScene` sigue aceptando `spawn?:`.

*Reproducción*: quitar el bloque `if (donde.de === "sin sitio") { … return true; }` de
`nefan-core/bridge/handlers/scene.ts` y correr `npx tsc --noEmit` en `nefan-core`.
*Qué esperaba*: un error de compilación, que es lo que la frase promete.
*Qué cambiar*: la frase, no el código. `implementacion-2.md` §1 y el **mensaje de commit** (que es
permanente y no se borra como el informe). La verdad medida es: «tres desenlaces explícitos en vez
de dos colapsados, y el mudo lo cazan el guion (6 rojos) y `bridge-map` (test 3)». Si se quiere la
garantía en el tipo de verdad, el sitio es `broadcastScene`: un `spawn` que sea
`{ punto } | { sinAncla: true }` en vez de opcional.

### H2 · importante — el segundo sitio del arreglo no tiene ningún candado EJECUTABLE

Con `:181` (`spawnAt`, el viaje que GENERA el tile) revertido y `dist` recompilado:

```
node qa/el-viaje-no-mete-a-nadie-dentro.mjs   → exit 0
node qa/run.mjs viaje 144                     → 4 en verde · 0 en rojo de 4
```

Solo lo cazan `bridge-map` tests 2 y 4. El informe midió «cada sitio por separado → su pareja y solo
su pareja» **mirando únicamente los tests**, y por eso no vio que la mitad del arreglo se puede
revertir sin que el candado que la PR estrena diga nada.

*Reproducción*: sustituir el `spawnAt: () => {…}` de `runPlaceTravel` por
`spawnAt: () => resolvePlaceTarget(ctx.narrative, placeId) ?? undefined`, recompilar `dist`, correr
los guiones.
*Qué esperaba el usuario*: que «el juego no meta a nadie dentro» valiera **por los dos caminos** del
viaje, y que el candado que se estrena lo sujetara.
*Por qué no está cubierto, medido*: los dos rects del motor falso caen en hueco (§4), así que ningún
viaje-que-genera del banco puede aterrizar sobre un macizo; y el guion headless solo monta lugares
**ya realizados**. La vía barata: darle al guion headless un cuarto bloque que conduzca
`runPlaceTravel` con una `sceneGen` que entregue un tile con el edificio dentro — el informe ya tiene
esa fixture (`tileConLaNave()`) en `bridge-map.test.ts`. La cara: cambiar `ANCHORED_PLACE_RECT` del
banco, que mueve lo que miden 08 y otros; **no lo hice por eso**, y lo dejo dicho.

### H3 · importante — un aserto del candado nuevo no puede ponerse rojo por lo que dice sujetar

`qa/el-viaje-no-mete-a-nadie-dentro.mjs`, bloque 3:
`✔ y el lugar no queda ACTIVO en un sitio al que el jugador nunca llegó`. Es la desviación 4 del
informe («el chequeo se mueve ANTES de `recordSceneLoaded`»).

Medido: moviendo la guarda **después** de `recordSceneLoaded(sceneId, scene)` + `await save()`, el
guion sale **7/7 VERDE** mientras `bridge-map` test 3 se pone rojo con
`Expected "actual" to be strictly unequal to: 'forja'`.

*Causa*: el guion registra la fixture bajo `tile_0_0`, y `robledo_tile.json` no trae `place_id`, así
que `recordSceneLoaded` resuelve `placeId = sceneId = "tile_0_0"`, que no es un place del mapa
(`src/narrative/narrative-state.ts:793-798`) y **nunca llama a `setActivePlace`**. El aserto es
verde por construcción, con el defecto puesto o sin él.
*Alcance*: la propiedad SÍ está candada, por el test unitario. Lo que hay que arreglar es el guion —
o darle a su escena un `place_id`, o cambiar el aserto por algo que su fixture pueda medir. Un verde
que no puede ponerse rojo es peor que uno intermitente, y este está en el candado que la PR estrena.

### H4 · menor — el viaje puede dejar al jugador hasta 0,40 m FUERA del tile

Barrido de todos los puntos ocupados de las fixtures (paso 0,5 m) pasándolos por
`sitioParaAparecer`:

| fixture | puntos ocupados | spawns **fuera** del `world_rect` | `sin sitio` | desplazamiento máx |
|---|---|---|---|---|
| `robledo_tile` | 2.466 | **24** | 0 | 2,65 m |
| `puerto_tile` | 4.002 | **248** | 0 | 5,65 m |

Ejemplo: (−31,75, −0,25) → (−32,40, −0,25), con el tile en [−32, 32]. La causa es la declarada en el
informe: `ocupado` solo consulta tiles CARGADOS, así que fuera del tile todo es «libre» y la marcha
sale por ahí.

No es cárcel — `fronteraBloquea` deja volver: desde (10,75, −32,40) con solo `tile_0_0` cargado, los
cuatro rumbos dan `false`, porque el tile ausente ya se tocaba en el origen («salir sí, entrar no»
también en la frontera). Pero **sí deja al jugador de pie sobre lo no pintado**, y el rumbo «más
afuera» también está permitido. Ninguno de los 13 anchors de `building` lo produce hoy; lo produciría
un rect sobre terreno sólido pegado al borde del tile — que es exactamente lo que **#465** hace
rutinario. Vale la pena anotarlo en #465 antes de desbloquearlo.

### H5 · menor (dirección de arte) — se aparece **tangente** al muro: el primer fotograma del viaje es una pared negra

`sitioParaAparecer` devuelve el punto donde la penetración llega a 0, o sea el cuerpo **tocando** el
sólido. Medido sobre `casa_lenador`: fachada pintada en z = 16,00, borde sólido en z = 16,00, spawn
en z = 16,40 → la cámara queda a **0,40 m** de la fachada, que es clavado `PLAYER_RADIUS_M`. Y el
near plane de la cámara fps es **0,30 m** (`nefan-html/src/renderer/fps-gl.ts:671`): quedan **0,10 m**
antes de que llegar de viaje recorte el muro.

La captura del momento de la llegada
(`qa/capturas/<run>/144-…-01-donde-deja-el-viaje.png`, cuatro corridas, siempre igual) es una
superficie **negra** que ocupa los primeros ~1.010 px de los 1.280 de ancho, con una franja de
fachada iluminada a la derecha: sin suelo, sin horizonte y sin nada que diga dónde estás. La de
después de andar 1,5 m (`…-02-tras-andar.png`) ya tiene mundo legible, con las texturas de relleno
del motor falso — y con el atlas **todavía en vuelo** en las dos, según la misma línea del HUD
(`Atlas fps del tile tile_0_0: 23 superficies…`), así que lo negro no es «aún no hay pintura»: es
dónde y hacia dónde queda la cámara. Y la causa SÍ está aislada, porque el guion la imprime desde la última corrida: al llegar, el jugador **mira `{x:0, y:0, z:−1}`**, o sea al NORTE — derecho a la fachada de `casa_lenador`, que está justo al norte y a 0,40 m. Lo negro es el muro sin luz llenando el encuadre. La distancia (0,40 m) y el facing son medidas; la llegada es tangente **por construcción**, o sea igual en los 13 edificios. No es un fallo de corrección y no lo
pongo en rojo; como llegada de viaje es mala.

Dos arreglos baratos, para quien decida: (a) un margen de holgura sobre la penetración (0,3-0,5 m
más allá de la tangente) para no dejar la nariz en la pared; (b) orientar al jugador **hacia** el
lugar al que acaba de viajar — hoy el yaw no se toca, así que puede aterrizar mirando al muro, que
es justo lo que pasa aquí.

### H6 · menor — «la cobertura sube» no está medido: es ruido de la suite

Dos `npm run coverage` consecutivos sobre **el mismo árbol, sin tocar un byte**: `95.85 %` y
`95.96 %` (`npm run crap`). El informe reporta `95,85 → 95,99` como mejora; el delta (+0,14) es más
pequeño que la varianza que acabo de medir (0,11). Lo cierto y suficiente es: **sigue por encima del
mínimo del 95 %, y `crap --check` pasa con 0 funciones por encima de 73**. Es el patrón de
`feedback_justificacion_no_verificada`: una decisión correcta con un número que no dice lo que
parece.

### H7 · contexto (es de G1, no de G2)

- `bridge/sim-collision.ts:94-96` sigue diciendo *«de la geometría del tile no saca a nadie, y eso
  tiene número propio (#616)»*. El informe lo declara y dice que es de G1; lo confirmo, sigue ahí en
  este árbol.
- El aserto del guion 09 descrito en §4 (`probeCollide(pos, pos)`) es del banco, no de G2, pero es la
  razón por la que #616 llevaba meses invisible en la batería aunque la geometría hubiera sido otra.
  Conviene que G1 —o quien toque la reaparición— lo sepa: `la-puerta-de-la-reaparicion.mjs` usa la
  misma forma de pregunta.
- **Asimetría que el jugador VE, y que esta PR estrena sin pedirlo**: `resolvePlaceTarget` sigue
  intacta y sus dos llamantes de NPC (`npc-behavior.ts:481` por `world.resolvePlaceTarget`,
  `npc-director.ts:109`) siguen apuntando al **centro crudo** del rect. Verificado con `grep`. Desde
  hoy, el jugador que viaja a un edificio aparece en la puerta y el NPC al que se le manda al MISMO
  lugar sigue caminando contra la pared hasta quemar el watchdog. Está declarado como backlog en la
  §6.5 del plan y en la §6 del informe; lo anoto porque es lo que se ve en pantalla, no solo una
  entrada de backlog.
- Un save hecho **antes** de esta PR con el jugador dentro de un edificio sigue siendo cárcel al
  reanudar: eso lo cura la mitad de ABAJO (G1), no G2. En este árbol (solo el primer commit de G1)
  todavía lo es.
### H8 · importante (del BANCO, no de la PR) — el guion 91 se pone rojo en la batería larga y verde solo, y la raíz es la misma que H7

En la batería completa `91-la-forja-que-el-motor-pone-ya-no-se-atraviesa` sale rojo con 4 asertos
(«la pared de la forja está a 2.4 m de su centro… la más corta 2.75 vs core 2.4», y el gemelo del
cofre, en vivo y tras reanudar). **No lo causa esta PR, y lo tengo medido por tres vías:**

1. **Verde en solitario**: `node qa/run.mjs 91-la-forja` → exit 0, los 27 asertos en verde.
2. **Verde corriendo justo detrás de mi guion nuevo** (`node qa/run.mjs 144 91-la-forja` → 2 de 2 en
   verde), que es la sospecha obvia porque `144` va antes en el orden alfabético y muta el mapa.
3. **Ninguno de los dos commits de la rama puede tocar ese camino**: el commit de G1 (`82f0285b`)
   **borra CERO líneas** de `terrain-collision.ts` y de `sim-collision.ts` —es puramente aditivo
   (`solapaSolido`, `ocupado`)— y G2 solo toca `bridge/handlers/scene.ts` (el spawn del viaje) y una
   rama nueva de `status-motivo.ts`. `aabbBloquea` y `probeCollide` están intactos.

**Y la raíz es la de H7**, que es lo que lo hace un hallazgo y no un «vuelve a correrlo»: la sonda
del 91 (`paredMedida`) barre con `probeCollide`, y `probeCollide` es `collidesAt(playerPos → p)` —
lleva dentro **dónde está el jugador**. La forja y el cofre están en el MISMO sitio en las tres
corridas (centros a 5,75 m, caras a 3,00 m), y lo que cambia es lo que la sonda contesta: de las 121
muestras de la línea que los une salieron **46 libres** (solo, verde), **38 libres** (144+91, verde)
y **0 libres** (batería, rojo). Dos corridas VERDES difieren en 8 muestras: la medida ya no era
determinista antes de que nadie la pusiera en rojo. En las corridas donde el hostil del bench mata
al jugador, la R lo devuelve *donde cayó*, y ese punto es justo el `desde` de todas las sondas
siguientes.

*Recomendación*: issue propio, y que herede el de #639/#633 como tercer rojo con dueño. El arreglo
de fondo es el mismo que el de H7: una consulta de PUNTO de verdad para el cliente (la que G1 acaba
de crear en core, `solapaSolido`/`ocupado`) en vez de un `collidesAt` que arrastra la posición del
jugador. Hoy hay al menos **dos** guiones apoyados en esa confusión —el 09 y el 91— y el 91 ya se
cae.

---

## 6 · Batería de navegador completa

`node qa/run.mjs` en este árbol, log en el scratchpad de la sesión (`bateria-qa-g2-completa.log`),
bloque de puertos elegido por el runner:

```
138 en verde · 3 en rojo · 2 SIN MEDIR de 143
```

Los **143** son los 142 del árbol más el mío. La referencia es la de `requisitos.md` al cerrar la
tanda F: **138 verde · 2 rojo · 2 sin medir de 142**, con los dos rojos con dueño.

- Los **dos rojos con dueño siguen siendo los suyos y solo los suyos**: `39-la-lista-de-exenciones-del-guardarrail-no-envejece`
  (**#633**, el guion 116 declara `sinMotor` y pulsa «Comenzar») y
  `141-el-replay-explica-las-grabaciones-incompatibles` (**#639**, `ENOENT` de `labs/narrative/runs`,
  que es material de sesión y la receta de worktree no copia). Verificado leyendo los dos issues.
- Los **dos ⊘ sin medir** son bloques declarados con motivo (128 y 97), no fallos.
- **El guion nuevo, 144, sale VERDE en la batería completa.**
- Y hay un **tercer rojo, y es NUEVO respecto a la referencia**: `91-la-forja-que-el-motor-pone-ya-no-se-atraviesa`,
  4 asertos. **No es de esta PR** — hallazgo **H8**.

---

## 7 · Workarounds usados durante la prueba, y su veredicto

| Workaround | ¿Lo tendrá delante el jugador? | Veredicto |
|---|---|---|
| `POST /map/place` para poner el `anchor.rect` sobre un edificio macizo | **No**, y no es un apaño: es el canal REAL del motor (`map_upsert_place`), el mismo que el motor falso usa para anclar la taberna. Lo único que cambia es DÓNDE apunta el rect — y apuntar a un edificio es lo que #465 pide | No es hallazgo |
| `setPlayerPos` en el guion 144 | **No**: solo se ejecuta con `QA_616_CRUDO=1`, que es el negativo. El camino normal del guion no toca la posición del jugador | No es hallazgo |
| Reversiones del árbol (los dos sitios del spawn, la guarda, la rama de `motivoParaElJugador`, el cable de `ws-server.ts`) y recompilaciones de `dist` | No | Restaurado tras cada una; al cerrar, `git diff` del árbol es **solo** la fila que añadí a `qa/README.md`, y no hay un byte de producción tocado |
| Mi primera versión del guion 144 pulsaba `KeyW/KeyS/KeyA/KeyD` | — | **Era un verde imposible al revés**: `ScriptedInputProvider` solo conoce `up/down/left/right`, así que las teclas no hacían nada y el jugador «no andaba» aunque no estuviera preso. Lo cacé porque la primera corrida salió roja con `blocked` todo `false`. Corregido antes de dar el guion por bueno |

---

## 8 · No probado, y por qué

- **`npm run mutacion -- local status-motivo`** (91 mutantes, 0 vivos, score 100): no re-medido. La
  casa tiene la mutación tapiada para agentes y el coordinador no me la pidió. Lo que sí medí es la
  afirmación de fondo: retirar la rama nueva pone **4 tests en rojo** (2 en `status-motivo`, 2 en
  `bridge-map`). Lo que **sí** comprobé del informe: `break` sigue en 100 y el árbol **no** queda con
  `reports/mutation/` sembrado.
- **El caso `sin sitio` con geometría real**: el informe declara que hace falta ≥ 160 m de sólido
  continuo y que por eso lo monta sustituyendo `ocupado`. No lo falsifiqué construyendo 25 tiles de
  agua; lo que sí tengo es corroboración: de los **6.468** puntos ocupados de las dos fixtures,
  `sitioParaAparecer` devolvió `null` **0 veces**.
- **Gasto real de créditos**: cero en todo, y declarado por el guardarraíl en cada corrida
  (`cliente y bridge declaran fake:true`). No he ejercido el motor real ni un solo servicio de
  imagen.
- **El camino `:181` con un motor REAL** (que es donde #465 lo vuelve rutinario): no probado, por lo
  mismo — exige créditos. Es parte de H2.

---

## 9 · Veredicto

**Apto con reservas.**

Lo que el usuario pidió de esta mitad —que el juego deje de meter al jugador dentro— **está hecho y
ahora está demostrado donde importa**: por el camino real del bridge (13 de 13 edificios de las
fixtures, headless) y, desde hoy, en el juego de verdad, con el jugador andando y con el defecto
reproducido y muerto en el mismo guion. El fail-loud es correcto, dice el nombre del lugar, no
difunde escena ni `ready`, no deja el place activo, y la frase que lee el jugador es nueva porque
ninguna de las que había era cierta. `verify` verde, deuda igual, ningún umbral tocado.

La batería completa de navegador queda en **138 verde · 3 rojo · 2 sin medir de 143**, con el guion
nuevo en verde y con los dos rojos con dueño intactos; el tercero (**H8**, guion 91) es del banco y
está medido como ajeno a esta rama por tres vías.

Las reservas, por orden:

1. **H1** — hay que corregir la frase «inexpresable» **antes de fusionar**, porque vive en el mensaje
   de commit. Es una afirmación sobre el tipo que el compilador desmiente en una corrida.
2. **H2** — la mitad `:181` del arreglo se puede revertir entera sin que ningún guion ejecutable se
   entere. Es la lección de la tanda F otra vez, con otro traje.
3. **H3** — un aserto del candado que la PR estrena es verde por construcción.
4. **H8** — no es de esta PR, pero sale de aquí y hay que abrirle issue: el 91 se cae, y la raíz
   —`probeCollide` no es una consulta de PUNTO— es la misma que dejó #616 invisible en el banco
   durante meses.

Ninguna de las cuatro es un defecto de conducta del juego, y por eso no es «no apto». Las cuatro son
de la clase que esta casa paga cara cuando se deja pasar.
