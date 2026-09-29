# QA — Tanda BM: playtest con el motor narrativo real (#239, #465)

Fecha: 2026-09-29. Checkout `/home/al/code/ne-fan` en `main` @ `d0cc2231`, offset 0.
Motor: `claude -p` headless, modelo `claude-opus-5-5` (línea `init` del stream), con
`narrative-mcp` recién compilado (`npm run build` a las 13:06; `dist/` y `nefan-core/dist`
con el zod de `role` y el `AnchorSchema` de hoy).

Material de sesión (gitignored): `labs/narrative/runs/tanda-bm-20260929/`
- `logs/motor-A.ndjson`, `logs/motor-B.ndjson`: transcripción completa de cada motor (tool_use + tool_result)
- `logs/bridge.log`, `logs/ai_server.log`, `logs/narrative-mcp-{A,B}.log`, `logs/PIDS.txt`
- `emulator-events.ndjson`: los dos sentidos del wire
- `tiles-A.json`, `tiles-B.json`: el Format D ACEPTADO de cada tile, sacado del transcript
- `snapshot-anillo-sano.json` (el mundo antes de romper la entrada), `entrada-B-request.txt` (el contexto que recibió el motor B)
- `analiza.py`, `rects.py`, `overlap.py`: los scripts que producen los números de este informe

## Montaje

| Proceso | Cómo | Nota |
|---|---|---|
| asset-store :8767 | `npx tsx services/asset-store/server.ts` | |
| bridge :9877/:9878 | `NEFAN_GAMES_DIR=<run>/games NEFAN_SAVES_DIR=<run>/saves npx tsx bridge/ws-server.ts` | copia de `data/games`: el bridge escribe el snapshot del mundo en `gamesDir`, y así no se toca `nefan-core/data/games/*/world/` |
| ai_server :8765 | `python -u ai_server/main.py` | canal MCP |
| motor A / motor B | `claude -p … --mcp-config <solo narrative> --strict-mcp-config --allowedTools mcp__narrative --output-format stream-json --verbose` | el stderr de narrative-mcp va a un log propio con un wrapper. Un motor FRESCO por sesión de juego |
| game-emulator :9899 | `node labs/narrative/game-emulator.mjs` | |

Sin remote-gen, sprite-forge ni placeholder de narrative-mcp, y con `NEFAN_ENTORNO` por defecto (desarrollo). Cero créditos de imagen.

- Sesión A: `1790680146-3a36e8`. Mundo `alta_fantasia`, nueva, con su save en `<run>/saves`.
- Sesión B: `1790682130-fe2c11`.
- Al terminar se pararon por grupo de procesos los seis grupos arrancados (asset-store, bridge, ai_server, emulador, motor A y motor B). Después de pararlos, `ss` no mostraba ninguno de los puertos del stack.

Recorrido de la sesión A (el jugador lo hace en el flujo real: título, arranque, diálogo y panel de salidas):
1. `start_session`: bootstrap del tile (0,0) «Postas del Sedal». El motor siembra 13 lugares, 4 enlaces y 4 sitios con `anchor.rect`. Tardó 7 min 10 s.
2. `player_entered_place vado_almar`: tile (0,-1), 288 s.
3. Diálogo con el alguacil. Pido «una aldea con molino y herrería donde la alcaldesa necesite manos, y otro pueblo de tejedoras, alfareros y un carpintero». El motor crea `ondahonda` y `cisterna_clara` con `map_upsert_place` y los enlaza.
4. Viaje a `ondahonda`: tile (0,1), 217 s.
5. Viaje a `cisterna_clara`: tile (1,0), 272 s.
6. Diálogo con la tejedora. Pido la aldea «con curandero, tonelero, panadera y pescador». El motor crea `juncarera`.
7. Viaje a `juncarera`: tile (-1,0), 182 s.
8. Viaje a `torre_del_hilo` (un landmark): tile (2,0), 115 s.

Sesión B (#465.3), con el motor B fresco: la entrada se regenera en un mundo pre-generado con 5 vecinos. Tardó 221 s. El montaje está en «Workarounds».

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **#239**: cuántas veces rechaza el pre-flight un `role` que es un oficio | ✅ **cero** | `grep -c "rol de conducta"` da 0 en `motor-A.ndjson` y 0 en `motor-B.ndjson`. Muestra: 7 tiles aceptados (5 de pueblo, 1 landmark y la entrada regenerada) con 30 NPC, más 2 `spawn_entity`. Roles: merchant 16, villager 7, guard 4, peasant 3; los dos spawn, villager. Todos los oficios pedidos van a `name`/`description` y ninguno a `role`: «Tomasa Yunquera» (herrera) y «Aurora Pajarera» (alcaldesa) son `merchant`, «Anselmo Tolva» (molinero) es `peasant`, «Bartolo Duela» (tonelero), «Remedios Hogaza» (panadera) y «maese Anís» (curandero) son `merchant`, «Rufo Nasas» (pescador) es `peasant`. Los 4 rechazos que hubo en toda la sesión son de otra clase (ver abajo) |
| **#465.1a**: ¿llama a `map_upsert_place` con `anchor.rect` cuando construye un lugar de `generate_tile.place`? | ⚠️ **casi siempre, pero a destiempo en la mitad de los casos** | En 4 de los 5 viajes pone rect; Vado Almar se queda sin él (el lugar es entonces el tile entero, que es lo documentado). **2 de esos 4 llegan DESPUÉS de `narrative_respond`**: Ondahonda (`USE respond … RES 'Scene sent …'` y luego `USE map_upsert_place {"id":"ondahonda",…"anchor":{"tx":0,"ty":1,"rect":[42,58,28,16]}}`) y la Torre del Hilo (`RES 'Scene sent …'` y luego `rect [54,44,18,10]`). Cisterna Clara y Juncarera lo ponen antes. En el bootstrap, el settlement se queda sin rect y los 4 sitios hijos lo llevan todos antes del respond |
| **#465.1b**: ¿el rect cae sobre lo que declaró? | ⚠️ **cae junto a ello, sobre el punto de llegada; no cubre el lugar** | Salida de `overlap.py`, sección «Qué cae bajo cada rect». Los sitios del bootstrap casan exactamente: el rect de `posta_del_farol` contiene el edificio `posada`, a Marela y su mobiliario; el de `lamparería_de_sael`, el edificio `lamparería` y a Sael; el de `torre_caudal_postas`, el prism `torre_caudal`; el de `plaza_de_postas`, fuente, puestos y carreta. En los viajes, el rect es la plaza o el tramo de camino que entra en ella, no el pueblo ni su monumento |
| **#465.2**: ¿produce rects pegados al borde? | ✅ **no** | Distancia mínima al borde de los 8 rects: `torre_caudal_postas`, 18 celdas (9 m). En los lugares de viaje, 34 celdas (17 m) o más. Ninguno se acerca a la zona de riesgo de `sitioParaAparecer`, que queda por debajo de una celda |
| **#465.3a**: al regenerar la entrada sin `bootstrap_world_map` y con vecinos, ¿continúa las costuras del anillo? | ✅ **sí, las 5** | Los vecinos le pidieron un path en el norte a 69, un río en el norte a 115, un río en el sur a 120, un path en el este a 60 y un path en el oeste a 66. La entrada nueva tiene `camino_norte` que termina en (69,0), el `arroyo` de 112–118 en la fila 0 (centro 115) y de 116,5–123,5 en la fila 128 (centro 120), y `camino_real` en el este a 60 y en el oeste a 66. El validador del bridge lo aceptó a la primera y se registró la escena. En el log del bridge: `se regenera SOLO la entrada, dentro de su mapa (16 lugares) y con 5 vecinos` |
| **#465.3b**: ¿se abstiene de sembrar lugares? | ✅ **sí** | Motor B: 0 llamadas `map_upsert_place` y 0 `map_link`; solo `scene_validate` ×2 y `narrative_respond` ×1. El snapshot reescrito tiene 16 lugares y 7 enlaces, igual que antes, con los anchors idénticos (diff vacío). El contexto no llevaba `bootstrap_world_map` |
| **#465.3c** (nuevo): ¿los lugares ya anclados DENTRO de la entrada siguen donde está lo que nombran? | ❌ **no**: ver H1 | |

## Hallazgos

### H1 — importante (#465.3/#578): la entrada regenerada deja con rects viejos los sitios anclados en ella

**Reproducción.** Una partida nueva cuyo bootstrap ancla sitios con `rect` en el tile (0,0); en esta sesión, `posta_del_farol`, `lamparería_de_sael`, `torre_caudal_postas` y `plaza_de_postas`. Su entrada deja de pasar el validador y el mundo acaba en el camino `entrada-en-el-mapa-del-fichero`. El motor rehace la entrada con otra distribución y los rects del mapa siguen siendo los de la entrada anterior:

| Sitio | Rect (el viejo, intacto) | Qué hay debajo en la entrada nueva |
|---|---|---|
| La Posta del Farol | [40,34,22,16] | el `establo` de relevos. La posada nueva está en [40,70,22,16] |
| Lamparería de Sael | [72,40,14,16] | nada. La lamparería nueva está en [76,68,14,11] |
| Torre-caudal de Postas | [94,38,16,16] | `casa_5`, la casa del correo de dirigibles y el mástil de amarre |
| Plaza de las Postas | [40,52,38,20] | la posada, el establo, la lamparería y un abrevadero |

Además, la descripción del sitio sigue diciendo «La lleva Marela Tresgavillas», y la entrada nueva pone de posadera a «Oria Trigal». El mapa y la escena cuentan dos historias distintas.

**Qué espera el jugador.** Al elegir «La Posta del Farol» en el panel de salidas, aparecer en la posada, que es donde está la posadera. Con el mapa actual aparece junto al establo, y los triggers del sitio saltan en el sitio equivocado.

**Causa, medida.** El motor no pudo saberlo. `entrada-B-request.txt` lleva en `generate_tile.place` solo el settlement (`postas_del_sedal`). `nearby_places` enumera solo lugares de OTROS tiles: vado_almar, torre_del_hilo, ondahonda, cisterna_clara y juncarera. Los cuatro sitios anclados en (0,0) no aparecen en ningún campo, y el prompt dice «do not seed it again». Es lo mismo que el `runEntradaEnElMapaDelFichero` declara que no sujeta, pero en otra forma: no es un lugar sembrado de más, es un lugar que ya existía y se queda anclado en una geometría que ya no existe. Ni el guion 214 ni el 144 lo ven, porque el motor falso repite la misma entrada.

**Arreglo concreto** (lo decide el arquitecto). Que `generate_tile` lleve los lugares ya anclados en ESTE tile (`id`, `name`, `kind`, `rect`) y que `tile_instructions.md` diga «construye cada uno dentro de su rect». La otra opción es permitir de forma explícita que el motor RE-ancle esos lugares (sin crear ninguno nuevo) y decirlo en el párrafo BOOTSTRAP sin `bootstrap_world_map`. La primera es más barata y determinista: el rect lo decide el mapa y el motor construye sobre él. Afecta también a cualquier tile que se regenere con lugares ya anclados, no solo a la entrada.

### H2 — importante (#465.1): el rect llega después de la escena, y la primera llegada ignora el rect

**Reproducción.** Nueva partida, viaje a un lugar sin tile. En 2 de los 4 viajes con rect (Ondahonda y la Torre del Hilo), el motor llama `narrative_respond` y después `map_upsert_place` con el rect. El bridge difunde la llegada en cuanto recibe el tile, así que el `sitio` sale del anchor SIN rect, que es el centro del tile:

- Torre del Hilo: `"spawn": {"x": 128, "z": 0}` = celda (64,64) del tile (2,0). El rect llegó después: [54,44,18,10], filas 44–53. **El jugador aparece unos 5 m al sur del lugar, fuera de su rect.**
- Ondahonda: `"spawn": {"x": 0, "z": 64}` = celda (64,64), que por suerte cae dentro de [42,58,28,16].
- Contraste con los dos que lo pusieron antes: Cisterna Clara `spawn x=52` = celda (40,63), dentro de [34,58,12,10]; Juncarera `spawn x=-61.5` = celda (69,62), dentro de [58,58,22,8].

**Qué espera el jugador.** Que el primer viaje a un lugar le deje en el lugar, igual que los viajes siguientes, que ya leerán el rect.

**Arreglo concreto.**
- Mínimo, de prosa, en `tile_instructions.md` («WHERE A PLACE LIVES IN ITS TILE»): «when generate_tile.place is present, call map_upsert_place with its rect BEFORE narrative_respond: the player is placed the moment the tile is sent».
- Preferible, porque la garantía va en el tipo: que el rect del lugar viaje DENTRO de la respuesta del tile (un campo del Format D presente cuando hay `generate_tile.place`) y el bridge lo aplique antes de difundir. Así la carrera deja de poder darse, en vez de depender de que el modelo lea una frase.

### H3 — menor (#465.1): en los lugares de viaje, el rect es el punto de llegada, no el lugar

Cuánto ocupa cada rect sobre las 16.384 celdas del tile: Cisterna Clara, 120 celdas (0,7 %: el tramo del camino oeste que toca la plaza; la cisterna, prism en 56–72, queda fuera); Juncarera, 176 (1,1 %: el camino sobre la mitad sur de la plaza); Ondahonda, 448 (2,7 %: la plaza y la fuente); la Torre del Hilo, 180 (1,1 %: el pie de la torre, con el prism de la torre en 57–71 × 27–41 fuera). El modelo ha leído la frase «they appear inside that rect» y ha optimizado el sitio de aterrizaje. Pero el mismo párrafo dice que el lugar se ACTIVA (sus triggers) al pisar el rect: el trigger de un pueblo solo salta en unos metros cuadrados de su plaza, y el de «Torre del Hilo» no salta dentro de la torre.

**Arreglo de prosa** en el mismo párrafo: «the rect is the place's footprint — the built-up area of a settlement, a landmark and its yard —, not the landing spot: the player lands at a free spot near its centre». Si lo que se quiere es un punto de llegada distinto del área, eso es otro campo y no el rect.

### H4 — menor: los rechazos no quedan en el log de narrative-mcp

El issue #239 da por hecho que el rechazo «está en el log de narrative-mcp». No está: `logs/narrative-mcp-A.log` tiene 4 líneas (arranque, bind, listener, ai_server conectado). `server.ts` devuelve el `isError` al modelo y no escribe nada en stderr. El único registro es la transcripción del motor, y en una terminal interactiva de Claude Code nadie la guarda. Si se quiere contar sin transcripción, basta un `console.error` con el tipo de rechazo junto a cada `return { isError: true }` del pre-flight.

### H5 — menor (banco): `--allowedTools "mcp__narrative"` no deja al motor solo con narrative

El `init` de los dos motores dice `"permissionMode":"auto"`. Aun así usaron `Bash`, `Write` y `Read`: escribieron los tiles en `/tmp/tile00.json`, `/tmp/tile0m1.json` y `/tmp/motor/fix.py`, y corrigieron el JSON con python antes de responder. Es inocuo para la medida, pero la receta de `motor.sh` del protocolo no hace lo que parece. Si se quiere el motor restringido de verdad, hay que añadir `--disallowedTools` o `--tools`.

### Otros rechazos de la sesión (fuera del alcance, anotados para el contador)

Ninguno es de `role` y todos se corrigieron a la primera re-respuesta:
- `scene_validate`: `vegetation_zones[0].seed: Expected string, received number` (A, en el bootstrap).
- `narrative_respond`: `scatter_generators.leño.parts[0]: cylinder requiere 'rTop'` (A, en Cisterna Clara).
- `narrative_respond`: `volumes[0.h]: Number must be less than or equal to 24` (A, en la Torre del Hilo: el motor quería una torre de más de 24 m).
- `scene_validate`: `volumes[5.parts.0]: Unrecognized key(s) in object: 'dims'`, junto con el mismo error de `seed` (B).

El `seed` numérico aparece en 2 de 2 motores. Es candidato a prosa o a coerción declarada si se repite.

## Workarounds usados

1. **`NEFAN_GAMES_DIR` y `NEFAN_SAVES_DIR` apuntando a copias en `runs/`.** No afecta al jugador: es para no escribir el snapshot en `nefan-core/data/games` ni tocar `saves/`. Los caminos de código son los mismos.
2. **Emulador en vez de cliente: el jugador nunca camina.** Todos los viajes salen del tile (0,0), porque el rayo de `resolveTravelAnchor` parte del tile del jugador. Por eso Ondahonda («al oeste de Vado Almar», `approx_position [-2,-3]`) acabó en (0,1) y Cisterna Clara, en (1,0). Es un artefacto del banco, **no un hallazgo del juego**: en partida real el jugador estaría en Vado Almar al viajar. Tiene un efecto útil, y es que dejó la entrada rodeada por los cuatro lados para #465.3.
3. **#465.3: snapshot montado a mano en vez de `generate_game`.** El mundo pre-generado se armó con el `world_map` y las 6 `scene_data` del save de la sesión A, tal como las expandió el bridge, sobre el `tile.json` que escribió el bootstrap. La entrada se rompió con la técnica de `romperLaEntrada` del guion 214 (el NPC `marela_tresgavillas` pasa a nacer dentro de la `lamparería`). `generate_game` habría costado 9 llamadas al motor, unos 40 min. Por qué vale: la puerta de carga juzga el fichero sin mirar quién lo escribió. Pasó el zod (el título lo marcó como `generation: stale, entradaARegenerar: true`) y el bridge tomó el camino correcto: `se regenera SOLO la entrada, dentro de su mapa (16 lugares) y con 5 vecinos … el NPC "marela_tresgavillas" nace en [79, 46], celda no transitable`. Diferencia con un mundo de `generate_game`: allí el anillo no tiene lugares propios, y aquí los 4 vecinos adyacentes son lugares (el quinto tile del «anillo» que cuenta el bridge es (2,0), que no toca la entrada). Para H1 da igual, porque lo que falla son los sitios de la propia entrada, y esos los siembra el bootstrap en los dos casos.

## No probado

- **La vía de API directa** (`llm_client.generate_scene` sin MCP), donde un `role` malo mata el tile: no gasto API.
- **Otro modelo o más mundos.** La muestra de #239 es un modelo (`claude-opus-5-5`), un mundo (`alta_fantasia`) y 32 NPC. Cero rechazos es una medida, no una garantía para Sonnet ni para un mundo con gremios más raros.
- **Hostiles**: no se pidió combate, así que no hay ningún `role: "hostile"` en la muestra.
- **La activación del lugar (triggers) al pisar el rect y el segundo viaje de vuelta a un lugar con rect**: el emulador no mueve al jugador. H2 y H3 se deducen del `spawn` difundido y de las celdas del rect, no de haber visto saltar un trigger.
- **El cliente**: no se abrió navegador, porque el objeto de la tanda es el motor. No hay capturas ni crítica visual.

## Guion ejecutable

No dejo guion en `qa/guiones/`: lo que se mide aquí es el comportamiento de un modelo real, que no es determinista y cuesta minutos de motor por tile, y el banco con motor falso no lo reproduce. Los scripts que sacan los números están en `runs/tanda-bm-20260929/` (`analiza.py`, `rects.py`, `overlap.py`) y se pueden volver a correr sobre cualquier transcripción `stream-json` de un motor.

H1 SÍ es mecánico. Se puede candar con el motor falso haciendo que la entrada regenerada cambie de sitio un edificio de un sitio anclado. Pero su «rojo esperado» depende de qué arreglo elija el arquitecto, así que lo dejo para quien lo implemente.

## Veredicto por issue

- **#239 → cerrar.** Cero rechazos de `role` en 7 tiles y 32 NPC con oficios variados pedidos a propósito (herrera, alcaldesa, molinero, tonelero, panadera, curandero, pescador, tejedoras, alfareros). La prosa de `DRESSING AND BEHAVIOUR OF AN NPC` basta con este modelo. Opcional: H4, si se quiere poder contarlo sin transcripción.
- **#465 → no cerrar; queda reducido a dos arreglos concretos:**
  - **465.2 → cerrado por medida:** ningún rect a menos de 9 m del borde.
  - **465.1 → arreglo:** que el rect llegue ANTES de la escena. Lo preferible es que viaje en la respuesta del tile; lo mínimo, una frase en `tile_instructions.md` (H2). Y prosa sobre qué es el rect: la huella del lugar, no el punto de llegada (H3).
  - **465.3 → las dos preguntas del issue contestadas en verde** (costuras 5/5 y cero siembra), **pero aparece H1**: los sitios anclados en la entrada conservan rects de una geometría que ya no existe. El arreglo es pasar al motor los lugares anclados en su propio tile.

**Veredicto global: apto con reservas.** El playtest contesta las preguntas que tenía. #239 se cierra; #465 no, por H1 y H2, que son defectos que el jugador vería.
