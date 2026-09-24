# QA: tanda BE (#578 y la mitad de #465 que no gasta)

Rama `feature/tanda-be`, sin commitear, en el worktree `/home/al/code/ne-fan-tanda-be`. Todo con el preset `e2e-sin-creditos` y el motor falso: **0 créditos**.

Lo he validado como lo vive un jugador que reanuda un mundo pre-generado cuya ENTRADA dejó de pasar el validador. El criterio es la decisión del usuario: «Anclar la entrada en el mapa viejo».

## Criterios

| # | Criterio (requisitos.md) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Entrada injugable ⇒ UNA `generate_tile{0,0,bootstrap}` sin `bootstrap_world_map` y con vecinos. El mapa escrito conserva los mismos ids y no queda nada colgando | ✅ | **214 A** (navegador): `{"tile":[0,0],"bootstrap":true,"bootstrap_world_map":false,"vecinos":["north","south","east","west"]}`, `/generate_scene` +1, los mismos lugares y 0 colgando. **215 §2**: igual. Test de core `arranque-con-la-entrada-rota.test.ts` C1 en verde |
| 2 | La lógica que elige camino, mapa y `place_id` es pura y está en core; el handler solo encola | ✅ | `src/world-map/entrada-del-fichero.ts` (`caminoDeArranque` y `planDeEntrada`, sin I/O). `arrancarElMundo` es un `switch` de despacho |
| 3 | Si el motor falla o el mapa no nombra el lugar: error con motivo, fichero intacto y nunca se siembra en silencio | ✅ (motor caído: ⚠️ no probado en navegador) | **214 B**: muro «No se puede empezar: el mundo guardado se contradice… ("lugar_que_ya_no_existe": tile_-1_-1, …). Regenera el mundo desde el título.», CERO peticiones y fichero byte a byte igual. Motor caído: core C3 y mi ADV1 (abajo). Con el falso no se puede provocar en navegador, porque `/dev/tiles mode:error` excluye `bootstrap` (`fake-ai-server.ts:344`) |
| 4 | Guion 214-217: el jugador camina de la entrada al anillo, «Salidas» NO vacío y 1 petición; el E5b del 127 retirado | ✅ | **214** en verde. El **214 teletransporta** dentro del vecino. Por eso escribí el **215**, que cruza el BORDE andando con la tecla W real (proveedor de teclado, sin `?input=scripted`): `{"cruzo":true,"tile":"tile_1_0","x":32.43}`, botones `["→ Molino del bench (road)"]`, 0 llamadas. El 127 sigue en verde y ya sin E5 |
| 5 | Comentarios falsos de `world-snapshot.ts:35,242` | ✅ | Se hizo verdad lo que decían: `world_map: WorldMapSchema` en el snapshot, y también en `loadSession` del save |
| 6 | El rect se rechaza (no entero, negativo, `w/h ≤ 0`, fuera de 128) igual en la tool MCP y en `POST /map/place`, desde una fuente única | ✅ con reservas (H3) | `AnchorSchema` es la única fuente. `world-map-schema.test.ts` pasa 8 rects malos y 4 buenos por las tres puertas: zod, `validateAnchor` y HTTP real |
| 7 | `tile_instructions.md` documenta `anchor.rect` y sus unidades; `contract-model-io` en verde | ✅ (la reescritura del issue está pendiente del coordinador) | Existe la sección «WHERE A PLACE LIVES IN ITS TILE». `npm test` da 3591/3591 |
| 8 | Cero créditos | ✅ | Todo con `e2e-sin-creditos`; el guardarraíl dice `fake:true` en cada corrida. El censo solo registra rutas del motor falso |

Guiones corridos, todos en verde: 214, 215 (nuevo), 127, 120, 72, 172, 09, 144, 119, 63 y 37.

## Pasada adversarial

- **¿Queda algún arranque que siembre un mapa nuevo sobre un fichero SERVIBLE?** No. `runBootstrapTile` solo tiene un llamante: `session.ts`, camino `sembrar`. Ese camino solo se da con `sin-mundo` (sin fichero o stale) o con `ilegible`. `generate_game` siembra, pero sobre una génesis que reemplaza a propósito. La cura no siembra. `bootstrap_world_map = true` solo se escribe en `bootstrap-tile.ts:43`.
  - Matiz: `ilegible` → `reemplaza-el-mundo` borra el mundo entero. Es la conducta de antes (con `conserva`, un malformado conservaba `{}`). El `WorldMapSchema` nuevo amplía el conjunto de «ilegibles», así que lo medí (siguiente punto).
- **¿El `WorldMapSchema` rechaza saves o snapshots reales?** No. He pasado los 185 ficheros que hay en la máquina:
  - los 4 snapshots de `archivo/snapshots-bench-2026-08-22/*`;
  - el snapshot de `/tmp/claude-1000/tile.json`;
  - los 180 `state.json` de `archivo/saves/`.

  Resultado `{ ok: 185 }`, y el parse no altera ningún mapa (0 cambian al re-serializar). En los `data/games/*` del repo no hay `world/`. Los 4 snapshots archivados ya los rechaza el `WorldSnapshotSchema` por `glyph` retirado en las escenas; eso es previo y ajeno. Además, los guiones que reanudan (119, 63 y el §5 del 215) cargan saves del bench sin problema.
- **¿Abre algún hueco el pre-flight nuevo de `tileContextFor`?** No he encontrado ningún camino que llegue a él. El `bootstrap` solo gobierna el `player` (`checkPlayerSpawn`). El hueco teórico es una sesión viva sin `tile_0_0` que pida el (0,0) como tile normal: el pre-flight exigiría `player` y el bridge lo rechazaría, y el motor quedaría en bucle. Para llegar ahí haría falta un save sin entrada. Lo busqué:
  - Tras un fallo del motor, la sesión provisional NO se guarda (ADV1: `listSessions()` = 0, aunque tiene el anillo en memoria).
  - Un segundo Comenzar arranca limpio: 1 llamada y `ready`.
- **¿La paridad prompt↔zod es real?** Solo en parte (H3). Las reglas del rect son UNA fuente para bridge, tool y fichero. Pero el prompt solo está atado al zod por `TILE_CELLS` y por el borde ESTE.
- **Otras pruebas adversariales en core** (scratch, no commiteado):
  - ADV2: mapa sin lugares y anillo sin `place_id` ⇒ arranca con `place` ausente, 1 llamada. Correcto.
  - ADV3: el motor devuelve la entrada con un `place_id` inventado ⇒ el bridge lo pisa con el del fichero. Correcto.
  - ADV4: el motor siembra un lugar con las map tools durante la entrada, sin que se lo pidan ⇒ se escribe (H5).

## Hallazgos

**Bloqueantes: ninguno. Importantes: ninguno.**

**Menores**

- **H1 · El título manda regenerar un mundo que Comenzar repara con una llamada.**
  - Pasos: `node qa/run.mjs 215` (o fabricar la entrada rota como en el 214) → título → mundo.
  - Qué se ve: «Mundo: ⟳ obsoleto (regenera el mundo)» (salida del 215 §1).
  - Qué esperaba el jugador: que se le dijera que empezar arregla la entrada. «Regenerar» cuesta 9 llamadas; Comenzar, 1, y tras Comenzar el chip pasa a «✓ generado» (215 §4). Además esa llamada no se anuncia como gasto.
  - La etiqueta es previa (`gameGenerationStatus` → `cargarConDetalle` lanza ⇒ `stale`), pero ahora que existe la reparación da una indicación equivocada.
- **H2 · El muro del caso «el fichero se contradice» enseña ids internos** (`tile_-1_-1`, `"lugar_que_ya_no_existe"`) a quien juega.
  - Pasos: 214 B.
  - Es un estado que hoy solo se da fabricado, y la salida («Regenera el mundo desde el título» + «Volver al título») es correcta. El detalle técnico sobra en el muro y basta con el log.
- **H3 · La paridad prompt↔zod es parcial.**
  - `contract-prompts.test.ts` ata el prompt al zod en `TILE_CELLS` y comprueba el borde ESTE. «whole numbers», «w,h ≥ 1», «col,row ≥ 0» y el borde sur del prompt son texto libre: cambiar el zod a `w ≥ 0` no pone rojo el prompt. Los negativos del zod sí lo pillan, pero con números escritos a mano.
  - La descripción de la tool `map_upsert_place` escribe «128» a mano.
  - La llamada a `validateAnchor` dentro de `server.ts` no tiene test: si alguien la quita, todo sigue en verde. El coste es bajo, porque el bridge rechaza igual con 400, pero el motor pierde el mensaje temprano.
- **H4 · El replay no mira si algo cuelga.** Un fichero SERVIBLE cuyo anillo apunta a lugares que el mapa no tiene (por ejemplo, uno que el bug de antes ya dejó mezclado) se sirve sin aviso y con «Salidas» vacío. `escenasSinLugarEnElMapa` solo es precondición del camino `entrada-injugable`. En preproducción no importa para los saves viejos. Lo apunto porque el aviso del escritor se borró y ahora ese estado no lo dice nadie.
- **H5 · Nada impide que el motor siembre durante la entrada.**
  - El criterio 1 («exactamente los mismos ids») se cumple con el motor falso. Con uno real solo lo sostiene el prompt («do not seed it again»).
  - ADV4: si el motor llama a `map_upsert_place` durante la entrada, el lugar nuevo se escribe en el fichero.
  - Es aditivo y no deja nada colgando, así que no rompe «Salidas». Pero el mapa deja de ser «el del fichero» sin que nadie lo diga. Encaja con la verificación de #239.

## Workarounds usados

- **`setPlayerPos` a 6 m del borde este** (215 §3), antes de andar con W. El cruce del borde, que es lo que se mide, se anda con la tecla real. El teletransporte solo evita depender de la ruta libre desde el spawn que deja el motor falso. **Veredicto: no afecta al jugador**, porque el jugador anda esos 26 m igual.
- **`pedirYEsperarTile` + `setPlayerPos` dentro del vecino** (214 A, 215 §4 y §5): leen el panel sin andar. Para el §3 está cubierto andando. **Veredicto: no afecta.**
- **Divergencia fabricada en disco** (renombrar el lugar de partida en el fichero). Es la única forma de que exista con el motor falso: el real la produce sola. **Veredicto: no afecta**, porque es la condición del bug y no un atajo.
- **Primera versión del 215 con `?input=scripted`**: W no movía al jugador. No era un defecto del juego: el driver de bench no escucha el teclado. Lo resolví quitando `?input`, como hace el 37, y el guion final anda con el proveedor real.

## Guion ejecutable

`qa/guiones/215-la-entrada-regenerada-se-anda-se-sirve-y-se-reanuda.mjs` (`node qa/run.mjs 215-la`, ~2 min). Hace cinco comprobaciones:

1. El título no da por bueno un mundo con la entrada rota.
2. Una petición, sin sembrar.
3. Cruce del borde ANDANDO con W ⇒ «Salidas» no vacío y 0 llamadas.
4. Fichero curado ⇒ «✓ generado», segundo Comenzar con 0 llamadas y el anillo con salidas.
5. Reanudar la partida ⇒ el anillo sigue teniendo salidas y 0 llamadas.

**Probado en negativo**: con `session.ts` encolando `runBootstrapTile` en el camino nuevo (el sabotaje del ingeniero, restaurado y verificado con `cmp`), sale rojo:

```
✘ 2 · la entrada rota cuesta UNA petición, sin sembrar — 9→10 {"tile":[0,0],"bootstrap":true,"bootstrap_world_map":true,"vecinos":[]}
✘ ERROR: timeout esperando: el tile del anillo, pisado andando, trae sus salidas (último valor: null)
```

Pasa `un-salto-del-guion-se-observa` (42/42) y `lint:qa`. **Falta su fila en `qa/README.md`**: no la he añadido.

## No probado

- **Fallo del motor en el navegador**: el motor falso no puede fallar un tile de bootstrap (`/dev/tiles` lo excluye). Lo cubren el test de core C3 y ADV1: error, fichero intacto, 0 saves, y el reintento repara con 1 llamada.
- **Motor real**: si continúa las costuras del anillo en la entrada, si da `anchor.rect` y si siembra sin que se lo pidan (H5). Va con #239.
- **La reescritura de #465 hacia #239**: le toca al coordinador; el texto está en `implementacion.md`.
- **Mutación** de `world-map-schema` y `world-map`: pendiente de una corrida autorizada, como declara el ingeniero.

## Intermitencia en Node 26 (`describe-que-lanza`)

**No se reproduce.** Lo intenté así, con Node v26.10.0:

- `ejercicio-de-bateria` + `una-suite-que-falla-pone-rojo`, 15 veces seguidas: 15/15 en verde.
- `npm test` completo, 4 veces (una de ellas con la batería de navegador corriendo a la vez, como carga): 3591/3591 las cuatro, entre 41 y 43 s.

Las dos baterías lanzan procesos hijo (`spawnSync`) contra la fixture. Si falla, lo más probable es la contención de CPU o de reloj bajo `verify`. No le he dedicado más de los 15 minutos del límite.

## Veredicto

**Apto con reservas.** Los ocho criterios se cumplen en el flujo real del jugador. El camino nuevo no siembra, no mezcla mapas y deja el panel «Salidas» vivo también cruzando el borde andando, en replay y al reanudar. El esquema nuevo no rechaza ninguno de los 185 mapas reales. Las reservas son los hallazgos menores H1-H5, y ninguno bloquea.
