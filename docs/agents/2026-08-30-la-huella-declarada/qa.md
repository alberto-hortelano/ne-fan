# QA — La huella declarada (#301 → #187 → #300)

Rama `feature/la-huella-declarada` (PR #333), medido sobre `e5a1edc` con base `8150595`.
Árbol limpio antes y después: lo único que dejo es `qa/guiones/45-el-porton-se-cruza-por-su-vano.mjs`.
**Cero créditos**: las cinco corridas de batería declararon `gasto sesión 0,00 € · total 0,00 €`.

Todas las perturbaciones de producción que uso para probar en negativo se revierten en el mismo
comando y se verifican con `git status`; la comprobación final es `npm test` → **1648 · pass 1648 ·
fail 0**, idéntico a la línea base del ingeniero.

---

## 1 · Criterios de aceptación (§5 de `requisitos.md`)

| # | Criterio | Veredicto | Evidencia MEDIDA POR MÍ |
|---|---|---|---|
| C1 | El zod rechaza una entity móvil con `footprint` por encima del tope, y sigue aceptando `[1,1]` | ✅ cumple | Sonda propia sobre `ExpandedSceneSchema`: `[1,1]`/`[2,2]` aceptan, `[3,3]`/`[4,4]`/`[8,8]` rechazan con el mensaje derivado («…el cuerpo que el simulador mueve son 2 celdas (1,0 m)…»). Lo mismo en `EmittedSceneSchema`. `npm test` 1648/1648 |
| C2 | El tope **no es un número mágico**: sale de la misma fuente que el cuerpo que el sim honra, y hay candado que se pone rojo si divergen | ⚠️ **cumple en TS, NO en el espejo Python** | **TS: sí**, con 5 perturbaciones propias sobre la batería ENTERA (tabla §2). **Python: no** — el tope se deriva de tres constantes copiadas a mano en esta misma PR; movido `NPC_RADIUS_M` en TS, el tope TS pasa a `{npc:3}` y el Python se queda en `{npc:2}` con **136 tests Python en OK**. Hallazgo **H2** |
| C3 | `volume-metrics.test.ts` ya no excluye `gate`: el invariante cubre los **once** tipos | ✅ cumple | `node --test test/volume-metrics.test.ts` → `tests 42 · pass 42 · fail 0`. `:85` trae el ejemplar `gate`; `:93` lista los once tipos; el `.filter((t) => t !== "gate")` no existe |
| C4 | `grep -rn "structures"` en `src/` y `bridge/` = **0** | ✅ cumple | `git grep -n "\bstructures\b" -- nefan-core/src nefan-core/bridge` → **0**. En todo el repo fuera de `docs/` quedan dos: `arch-rules.json` (el fichero exceptuado donde vive el patrón) y `labs/style/README.md:76`, que es inglés corriente («plain terrain, NO structures») dentro de un prompt, no la primitiva |
| C5 | Golden revisado a mano: 15 movidos explicados uno a uno; los tres de la pasada de chars **rediseñados** | ✅ cumple, con **dos errores de recuento** en el informe | Auditoría caso por caso (§3). Recuento 15+1+1 **exacto**. El caso borrado es idéntico **en entrada Y en salida** (md5 `b604842d…`). El renombrado conserva su `cubre` y además ejerce un `throw` que antes no cubría nadie. Errores: son **once** los de solo telemetría, no doce; y el paréntesis de `walkable_cells` está mal. Hallazgo **H5** |
| C6 | `expandScenePrimitives` **baja** de CRAP 64 | ✅ cumple | `npm run coverage && npm run deuda`: la cola de CRAP queda en **11** y `expandScenePrimitives` ya no aparece. El peor de la lista pasa a ser `handle` (61) |

### Puertas de no-regresión

| Puerta | Veredicto | Evidencia |
|---|---|---|
| `npm test` | ✅ | 1648 · pass 1648 · fail 0 (corrido por mí, dos veces) |
| Batería de QA | ✅ | `node qa/run.mjs` → **44 en verde · 0 en rojo de 44** (43 + el guion nuevo) |
| Deuda sin crecer | ✅ | Cola de CRAP 12 → 11, nadie nuevo entra |
| El juego arranca y se juega | ✅ | Partida real en `e2e-sin-creditos`: se camina, se cruza un portón, se pelea y se habla (44 guiones) |
| Guiones 15 y 16 (tocados por la PR) | ✅ | Corridos: los dos verdes. El diff es **solo comentario** (una línea cada uno), ninguna expectativa se movió — no hay instrumento desafilado. Y las dos frases nuevas son ciertas: tras #301 nada escribe muros en el grid ASCII |

---

## 2 · C2 al microscopio (el criterio que podía estar verde sin comprobar nada)

No heredé la evidencia en negativo del ingeniero: la repetí sobre la batería **entera** (1648
tests, 10 s por corrida) y añadí las perturbaciones que él no hizo.

| # | Perturbación | Rojos / 1648 | Lectura |
|---|---|---|---|
| P1 | `NPC_RADIUS_M` 0,5 → 0,75 | **54** | Entre ellos los cinco del tope: «el TOPE del footprint móvil que dice el tool…», «los dos kinds móviles…», «el mensaje nombra al bicho…», «los dos cuerpos del juego…», «EmittedSceneSchema — una entity móvil no declara más cuerpo…» |
| P6 | `celdasQueCubreRadio` con un `+1` (off-by-one) | **6** | El gemelo, el gate, el prompt y los valores de hoy |
| P8 | El tope derivado de `celdasLibresParaRadio` (el HUECO) en vez del CUERPO | **3** | Usar el gemelo equivocado se ve |
| **P5** | **`blocksCircle` deja de estampar el AABB y pasa a ser un CÍRCULO de verdad** | **2** | ✅ **El candado vigila el CUERPO, no la constante.** Caen «y ese ancho es el que el COLLIDER REAL recorre» y su gemelo |
| **P4** | **`circleOverlapsCell` prueba la DISTANCIA en vez del AABB** | **0** | ❌ La batería entera sigue en **1648/1648**. Hallazgo **H1** |

**Conclusión de C2**: la pregunta que me diste —«¿se puede satisfacer el candado sin que ocurra lo
que importa?»— tiene respuesta **no** para el cuerpo que de verdad se estampa (P5 lo demuestra), y
la afirmación «en `scene-schema.ts` no hay ningún `2` ni ningún `1` escrito a mano» es cierta: el
único camino al número es `RADIO_SIMULADO_POR_KIND → celdasQueCubreRadio(radio, TILE_MPC)`.
**Pero la justificación escrita nombra la función equivocada** (H1) y **el espejo Python queda
fuera del candado** (H2).

---

## 3 · La revisión del golden, auditada

Muestra aleatoria reproducible (`shuf --random-source` sobre la lista de los de solo telemetría):
`puertas-en-los-cuatro-lados`, `npc-en-celda-solida`, `npc-inalcanzable`. En los tres, el único
cambio es `volumes_declared` (1→2, 0→2, 0→2) y `distinct_building_heights`; `ok`, `errors`,
`warnings`, `walkable_cells`, `doors_total`, `doors_reachable`, `npcs_reachable`, `reachable_cells`
y `volumes_total` **idénticos**. La explicación del ingeniero se sostiene.

**El borrado (`puertas-cutaway-en-volumes`) es correcto, y por una razón más fuerte de la que él
da.** No solo la SALIDA coincide byte a byte con la de `bootstrap-jugable` (mismo md5 sobre
`jq -c`, los 19 stats): reconstruida la escena vieja (`escenaBootstrap` viejo + `delete structures`
+ el volume cutaway) y comparada en JSON canónico con la nueva, **la ENTRADA también es la misma**.
No eran dos entradas que casualmente coinciden —eso sí habría perdido cobertura—: es la misma
escena dos veces. Cobertura perdida: cero, verificado por los dos lados.

**El renombrado gana cobertura**: el `throw` de `terrain_patches` al que se muda el caso no lo
ejercía nadie antes (`git show 8150595:…/scene-expand.test.ts` no menciona `terrain_patches`).

**`cuatro-pasadas-fallando-a-la-vez` sigue fallando en cuatro pasadas distintas**: trazados los
cuatro mensajes a `checkDeclaredChars`, `checkScatter`, `checkPlayerSpawn` y `checkSeams`, en ese
orden.

---

## 4 · Hallazgos

### H1 · La justificación del número de #300 nombra la función equivocada — **importante**

`plan.md` §2 y el docblock nuevo de `terrain-collision.ts` sostienen el tope sobre esto:

> «El cuerpo que el sim honra es un CUADRADO, no un círculo: `circleOverlapsCell`
> (`terrain-collision.ts:127-133`) prueba el AABB `x±r`, no la distancia.»

**Medido: `circleOverlapsCell` no gobierna el cuerpo.** Tiene exactamente **un** llamante
(`blocksMove`, `terrain-collision.ts:185`, la exención de «celda que ya solapabas») y `blocksCircle`
**no la llama**: su AABB lo hace su propio bucle `floor()` de `:164-175`. Convertida en prueba de
distancia, la batería entera sigue verde.

La conclusión es correcta y el candado funciona —el cuadrado real es el de `blocksCircle`, y P5
demuestra que ESE sí está vigilado—, pero la razón escrita no es la que sostiene el número. Es la
clase de defecto de `feedback_justificacion_no_verificada.md`: se congela como documentación falsa
y el próximo que mueva `circleOverlapsCell` creerá que rompe el contrato, o al revés.

**Reproducción** (desde el arranque, sin juego):
```bash
cd nefan-core
# en circleOverlapsCell, sustituir el AABB por la distancia al rectángulo de la celda
npm test    # → tests 1648 · pass 1648 · fail 0
```
**Qué esperaba**: que tocar «la función que prueba el AABB» pusiera rojo el tope que dice derivarse
de ella. **Arreglo sugerido**: citar `blocksCircle` (`:164-175`) en el docblock y en el plan.

*Sub-hallazgo (menor, PRE-EXISTENTE)*: ninguno de los 1648 tests nota que la exención de
`blocksMove` cambie de forma. Es un agujero de cobertura anterior a esta PR, no introducido por ella.

### H2 · El espejo Python del tope introduce TRES constantes de física copiadas a mano, sin candado — **importante**

`ai_server/narrative_schemas.py:135-137` **añade en esta PR**:
```python
TILE_MPC = 0.5
NPC_RADIUS_M = 0.5
PLAYER_RADIUS_M = 0.4
```
Son literales nuevos (`git show 8150595:ai_server/narrative_schemas.py` no los tiene). El tope
Python se deriva de ellos, así que es derivado **de una copia**, no de la fuente.

**Medido**, moviendo solo el TS:

| | tope `npc` | tope `player` |
|---|---|---|
| TS con `NPC_RADIUS_M = 0,75` | **3** | 1 |
| Python (sin tocar) | **2** | 1 |

y `python -m unittest discover -s ai_server/tests -t .` → **Ran 136 tests … OK**. Las dos fixtures
compartidas tampoco lo cogen: `[8,8]` la rechazan los dos y `[2,2]` la aceptan los dos, así que la
divergencia cae justo en el hueco que no cubren.

Es **la misma enfermedad que la tanda vino a curar** —algo declara un número y otro decide otro, y
nada los ata— reintroducida un piso más abajo, en el proceso que sanea lo que emite el modelo. El
día que alguien mueva un radio, el pre-flight de narrative-mcp aceptará un `[3,3]` que `ai_server`
rechazará con un `ValueError`.

**Reproducción**:
```bash
sed -i 's/NPC_RADIUS_M = 0.5;/NPC_RADIUS_M = 0.75;/' nefan-core/src/scene/terrain-collision.ts
python -m unittest discover -s ai_server/tests -t .      # OK, 136 tests
python -c "import sys;sys.path.insert(0,'ai_server');import narrative_schemas as n;print(n.FOOTPRINT_MAX_CELLS_POR_KIND)"   # {'npc': 2, ...}
```
**Qué esperaba**: que el espejo obligatorio no pudiera quedarse atrás en silencio, que es
literalmente lo que pide C2.

### H3 · El gate es del CONTRATO, no del JUEGO — y un comentario nuevo afirma lo contrario — **importante**

**Verificado por mí**: `git grep "EmittedSceneSchema\|ExpandedSceneSchema" nefan-core/bridge/` → **0
usos** (solo un comentario en `context.ts:342`). `loadSession`
(`narrative-state.ts:373-397`) asigna `this.scenes_loaded = data.scenes_loaded` sin pasar por zod.

Lo que #300 SÍ cierra —y hay que decirlo— es el eje que se propuso: el **motor narrativo** no puede
declararlo por ninguna de sus dos vías (pre-flight de `narrative-mcp` + `narrative_schemas.py`), y
el contenido pre-generado tampoco (`world-snapshot.ts:48` → `ExpandedSceneSchema`: comprobado, lanza).

Lo que no se sostiene es la frase «no se puede meter **en el juego**». Tres vías medidas lo esquivan:

| Vía | Estado | Daño observable |
|---|---|---|
| Resume de un `state.json` editado a mano | GATE NO APLICA | El NPC se pinta a 1,75 m de donde el sim lo tiene (`[8,8]`), porque `formatDToWorld` centra en el footprint y el `EntityRecord` no se mueve |
| El motor falso del banco (`labs/narrative/fake-ai-server.ts`) | GATE NO APLICA | El bridge acepta la escena vía `validateScene` (jugabilidad), que no mira el footprint |
| Migración v3→v4 con un `footprint` ya grande en el save v3 | GATE NO APLICA | Se conserva verbatim y se pinta |

Y sobre todo: **`migrations.ts:55-57`, escrito por esta PR, dice**

> «desde el tope de #300 el contrato ni siquiera lo admite: un save v3 migrado nacería rechazado
> por el gate»

**Medido: no hay gate en esa carga.** Un save v3 con la NPC en `[8,8]` carga (`loadSession → true`),
conserva `[8,8]` y llega al cliente. Es un comentario que documenta un candado inexistente —la misma
clase que H1.

**Reproducción**: copiar `nefan-core/test/fixtures/saves-v3/v3_aldea`, poner `footprint:[8,8]` en la
entity `vecina`, cargar con `NarrativeState.loadSession` y mirar `scenes_loaded.tile_0_0`.

**Medida más barata que lo cerraría de verdad** (para issue, no para esta tanda): pasar
`EntitySchema` por `recordSceneLoaded` (`narrative-state.ts:474`) y por `loadSession`.

### H4 · El banco emite HOY una escena que el contrato rechaza, y nadie se entera — **importante (PRE-EXISTENTE)**

`labs/narrative/fake-ai-server.ts:339,470` emite `style_ref` **a nivel de escena**, que
`scene-schema.ts:256,291` declara **retirado** y `EmittedSceneSchema` rechaza. Como el bridge nunca
corre el zod, la escena entra igual. Consecuencia para esta tanda: **la batería de 44 guiones puede
estar verde sin haber ejercido el gate de #300 ni una vez** — el verde de `qa/run.mjs` no es
evidencia de C1.

No lo introduce esta PR (las dos líneas son anteriores), pero sale a la luz por ella y conviene
anotarlo donde se decida H3.

### H5 · Dos errores de recuento en `implementacion.md` §3 — **menor**

1. «**Doce** casos donde SOLO cambia telemetría» → son **once**. Y su propia enumeración da trece
   (11 nombres + «y los dos de abajo»); los «dos de abajo» son (b) y (c), donde `errors` **sí** se
   mueve, así que no pertenecen al grupo.
2. «`walkable_cells` no se mueve en ningún caso salvo uno (**16.338 antes y después**)» → el que se
   mueve va **16313 → 16338**, y 16338 no es un valor universal (aparece en 7 de 37 casos).

Ninguno cambia un veredicto ni deja un caso sin explicar: la revisión del golden es sólida (§3).

### H6 · El issue del mensaje del spawn tiene DOS casos de evidencia, no uno — **menor**

`implementacion.md` §6.4 apoya el issue en «el caso `player-sobre-muro`». La interpolación
`"W"` → `"g"` aparece también en `cuatro-pasadas-fallando-a-la-vez`. Infra-reporta su propia
evidencia, no la infla.

### H7 · No hay ningún `gate` en las fixtures del selector «Room» — **menor**

Medido: `puerto_tile.json`, `robledo_tile.json` y `zorder_test.json` no llevan ninguno; el único
portón vivo del árbol es `puerta_sur` del banco. Consecuencia práctica: **el preset `html-fixtures`
no puede contestar «¿se ve algo distinto alrededor de un portón?»** — hace falta sesión. Y hasta
hoy ningún guion tocaba un `gate`, así que la mitad jugable de #187 no tenía candado ejecutable.
Lo dejo cubierto (§6).

---

## 5 · #187 desde el jugador, y por qué no cambia nada

Verificado **por mí**, no heredado:

- **Único llamante en producción de `volumeFootprintCells`**: `fps-ambience.ts:65` y `:96`
  (`grep` sobre todo el árbol sin `node_modules`/`dist`). `collision.ts:239` solo la nombra en un
  comentario; la colisión ya usaba `volumeFootprint`.
- **Los dos usos consumen el CENTRO** de la huella (`fp[0]+fp[2]/2`, `fp[1]+fp[3]/2`).
- **El centro no se mueve**, sonda propia sobre cuatro puertas incluida la real del banco:

| caso | huella vieja → centro | huella nueva → centro |
|---|---|---|
| `at [60,60] w 8 orient x` | `[56,58.5,8,3]` → `[60,60]` | `[53,57.8,14,4.4]` → `[60,60]` |
| `at [30,44] w 18 orient y` | `[28.5,35,3,18]` → `[30,44]` | `[27.8,32,4.4,24]` → `[30,44]` |
| `at [10,10]` (sin `w` ni `orient`) | `[8.5,6,3,8]` → `[10,10]` | `[7.8,3,4.4,14]` → `[10,10]` |
| `at [64,108] w 9 orient x` (el del banco) | `[59.5,106.5,9,3]` → `[64,108]` | `[56.5,105.8,15,4.4]` → `[64,108]` |

Luego el comportamiento del único consumidor vivo es **idéntico**, el arte no se repaga y **el
jugador no ve nada distinto**. Eso es lo correcto: #187 desactiva una trampa para el próximo que
llame a la función, no arregla un síntoma visible.

**Comprobado en el juego real** (`e2e-sin-creditos`, partida de verdad, cero créditos): el portón se
cruza por su vano y no por la muralla. Capturas en
`qa/capturas/2026-08-30T18-43-46-105Z-176416/`.

**Observación al margen, medida**: en el mundo del banco la masa del `gate` está **contenida entera**
en la de su `wall` anfitrión (huella analítica ±(w/2+3) celdas; el muro cubre la fila). Quitarle al
`gate` su `markRect` **no mueve una sola celda de colisión** — comprobado rompiéndolo. El `gate`
solo aporta, en la práctica, la operación *sustractiva* (`clearGatePassage`). No es un fallo, pero
conviene saberlo antes de escribir un test que crea estar midiendo la jamba de la puerta.

---

## 6 · La migración (desviación §5.1): el arreglo es real, no un parche

Cargada la fixture **de disco** `test/fixtures/saves-v3/v3_aldea` por el camino real
(`FsSessionStorage` → `NarrativeState.loadSession` → migración):

```
cell     : [ 53.5, 57.5 ]          footprint: [ 1, 1 ]
NarrativeState.entities  position : [ -5, 0, -3 ]
formatDToWorld  npc.position      : [ -5, 0, -3 ]
```

y con el footprint que escribía la migración VIEJA (`[4,4]`, celda `[52,56]`), `formatDToWorld` da
**el mismo** `[-5, 0, -3]`. O sea: el ingeniero diagnosticó bien (el footprint inflado estaba
recentrando al actor) y el centrado por celda fraccionaria **conserva la posición física exacta**,
no la maquilla.

**¿Hay más consumidores de ese centro que se muevan?** Recorridos todos:

| Consumidor | Con celda fraccionaria |
|---|---|
| `registerSceneNpcs` (sim/save) | ✅ aritmética pura, posición conservada |
| `formatDToWorld` (lo que pinta el cliente) | ✅ aritmética pura, posición conservada |
| `scene-validate` | ✅ ya hacía `Math.floor(declarada)` desde antes (`:426`), con `declarada` guardada aparte |
| `scene-expand.ts:225` (única reescritura de `cell` del árbol) | ✅ solo toca `decor` con `attach:"wall"`; ningún kind móvil |
| `derive.ts` | ✅ deriva volúmenes de entities estáticas |

No encontré ningún consumidor que se mueva. La desviación está bien resuelta.

---

## 7 · Guion nuevo

`qa/guiones/45-el-porton-se-cruza-por-su-vano.mjs` — la mitad jugable de #187, que no tenía candado
ejecutable (H7). Partida real en `e2e-sin-creditos`, cero créditos, sin coordenadas mágicas (el
portón se descubre en el plan y el vano se mide sondeando el collider).

Afirma: el eje del portón está libre · el vano se cierra a los dos lados · por él cabe el cuerpo ·
**el jugador cruza la muralla andando** · el hueco está **donde y como** el portón lo declara
(`at`/`w`) · y **por la muralla no se cruza**.

**Probado en negativo, las dos mitades** (y las roturas revertidas):

| Rotura | Resultado |
|---|---|
| Sin `clearGatePassage` (el vano no se limpia) | ✘ «el eje del portón está LIBRE» → rojo |
| Sin la banda del `wall` | ✘ «la muralla … es MASA» y ✘ «el jugador NO cruza por la muralla» → rojo |

**Y dos intentos que salieron VERDES y obligaron a rehacer el guion** —los dejo escritos porque es
el hallazgo del guion—: mi primera versión afirmaba «la jamba del portón es MASA» sondeando junto al
vano. Ahí se solapan la masa del `gate` y la de su `wall`, así que quitarle la colisión a
**cualquiera de los dos** dejaba el paso verde. Era verde sin sujeto, exactamente lo que este rol
existe para no dejar pasar. El control se plantó fuera de la huella del portón y se renombró para
decir lo que de verdad mide.

Batería completa con el guion dentro: **44 en verde · 0 en rojo de 44**.

---

## 8 · Workarounds usados

| Workaround | Veredicto |
|---|---|
| Perturbar producción para probar en negativo (5× `terrain-collision.ts`, 1× `scene-schema.ts`, 3× `collision.ts`, 1× la constante de Python) | **Legítimo, no afecta al usuario.** Es la técnica que el rol exige. Todas revertidas en el mismo comando, `git status` limpio y `npm test` 1648/1648 al final |
| `setPlayerPos` para encuadrar la captura del portón | **Legítimo**: es la API declarada del banco para capturas deterministas. Los asertos del cruce se andan con `holdUntil`, no se teletransportan |
| **Ninguno para observar la feature** | No hice falta ocultar un overlay, saltarme el título ni forzar estado: #187 se mira en partida real desde el título y #300 se mide por el camino de datos |

---

## 9 · No probado

- **Crítica visual de director de arte del portón** — imposible a cero créditos: el único `gate` del
  árbol vive en el mundo del banco, cuyas superficies son el damero del atlas falso
  (`fake-surface-model`, visible en las capturas). Juzgar el arte exigiría generar imagen = gasto =
  prohibido. Capturas dejadas en
  `qa/capturas/2026-08-30T18-43-46-105Z-176416/45-…-03-el-porton-visto-desde-el-sur.png` para quien
  corra con arte real. Lo que sí queda demostrado es que #187 **no puede** cambiar el arte (§5).
- **Mutación** (`blueprint-huella`, `contrato-escena`) — ninguno cabe en el tope local; pedida desde
  Actions, como dice el ingeniero. No bloquea.
- **Gasto real de créditos** — ninguna prueba mía generó una imagen; las cinco corridas declararon
  0,00 €. No es una medida de que el juego con motor real no gaste: eso no se probó.

---

## 10 · Veredicto

**Apto con reservas.**

Los tres issues están hechos y sus seis criterios se cumplen (C2 con la salvedad medida). La
revisión del golden es sólida —la decisión más arriesgada, borrar un caso, es la mejor sostenida de
las tres—, la desviación de la migración está bien diagnosticada y bien resuelta, los guiones 15 y
16 no se desafilaron, y nada de lo que ve el jugador regresa: 44/44 en la batería y 1648/1648 en la
unidad.

Las reservas son **tres, y las tres son de la clase que esta tanda vino a cerrar**, así que deberían
volver al ingeniero antes de mergear y no irse a un issue:

1. **H1** — el docblock y el plan justifican el tope con `circleOverlapsCell`, que no gobierna el
   cuerpo (0 rojos al cambiarla). Es una línea de comentario: citar `blocksCircle`.
2. **H2** — tres constantes de física nuevas, copiadas a mano en `narrative_schemas.py`, sin nada
   que las ate a su fuente. Un tope declarado en dos sitios que pueden divergir en silencio es,
   literalmente, el enunciado de la tanda.
3. **H3** — `migrations.ts:55-57` afirma un candado que no existe en esa ruta. Otra línea de
   comentario, y la medida ya está hecha.

**H4** (el banco emite algo que el contrato rechaza, y por eso el verde de la batería no prueba el
gate) es pre-existente y da para issue propio, junto con la medida de H3 sobre dónde debería correr
`EntitySchema`. **H5**, **H6** y **H7** son menores; **H7** ya queda cubierto por el guion nuevo.
