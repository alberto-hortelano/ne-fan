# Tanda BP — QA: el `seed` de las zonas del tile

Worktree `/home/al/code/ne-fan-tanda-bp`, rama `feature/tanda-bp`, HEAD `9c06b9c6`. Todo con el motor falso y cero créditos. El «antes» es el código de `8b726a58`: lo leí sin tocarlo desde el checkout principal, cuyo `nefan-core/src` solo difiere de esa base en `session-storage.ts` y `messages.ts`, que no intervienen aquí.

## Criterios (de la petición y de `requisitos.md`)

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Un `seed` numérico en `vegetation_zones` deja de costar un rechazo al motor | ✅ | `narrative-mcp/dist/validators.js` real (`validateFormatDScene`) con el tile del bootstrap del motor falso y seeds 3 / 0 / 1e9 → `ok`. Antes del cambio, el mismo tile daba `vegetation_zones[0].seed: Expected string, received number`. Guion 290, aserto «pre-flight y bridge aceptan un seed ENTERO». |
| 2 | Lo mismo para `scatter_zones` (una sola definición) | ✅ | Guion 290: `s0`, `s34`, `s56` y `s1e9` pasan el pre-flight y el bridge, y el seed manda (`527cb35a…` ≠ `8fbd5d20…`). |
| 3 | No se sanea en silencio | ✅ | `"3"`, `"claro_sur"`, 1.5, -1 y 1e10 se rechazan en el pre-flight y en `validateScene`. El mensaje trae la ruta del campo y la palabra «entero». Nadie los convierte. Guion 290. |
| 4 | El tile con seed recorre bridge → cliente y se pinta | ✅ | Guion 291: el save con `seed: 3` se reanuda desde la tarjeta del título. El cliente recibe 24 ejemplares y el registro de errores no dice nada de seed. Captura `…-02-pinar-seed-3.png`. |
| 5 | Determinista | ✅ | Headless: dos `formatDToWorld` y dos `buildFpsTileSpec` dan los mismos bytes en los 18 casos (290). Por el bridge: reanudar dos veces con seed 3 da el mismo hash (`4a4e072e2b21e512`) y el mismo número de ejemplares (291). Las capturas 02 y 03 son idénticas a ojo. El hash del cliente coincide con el del subproceso headless: seed 3 → `4a4e072e…` y seed 4 → `e5856814…` por los dos caminos. |
| 6 | El seed manda, y 0 no es «sin seed» | ✅ | seed 3 ≠ 4 (24 frente a 22 ejemplares; capturas 02 y 04). En vegetación, seed 0 → `2647f52a…` y sin seed → `be301a2d…`. |
| 7 | Un bosque sin seed no cambia | ✅ | Tile del bootstrap sin seed: la world scene entera (`3f2175bcabae22d5`), las prims fps (`77ba9c37a867e7ef`) y los ejemplares (`be301a2dd7ae2978`) dan el MISMO hash con el código de antes y con el de después. El 290 lleva el golden de los ejemplares. En partida real (291, paso 5), quitar el seed devuelve el pinar de la partida recién empezada. |
| 8 | El cambio no repaga arte | ✅ | En el 291, al reanudar con seed 3 y 4 el HUD dice «Atlas fps … instalado (0 página(s) nuevas, todo de la librería)». Solo la partida nueva pintó 3 páginas, en el fake y a $0. |
| 9 | La batería del bosque no regresiona | ✅ | `node qa/run.mjs 16-scatter 30-el-bosque 31-el-pinar`: 3 en verde. `npm test` (nefan-core): 3718/3718 con los dos guiones nuevos dentro. |

## Pasada adversarial

- **seed 0**: se acepta en las dos zonas. En vegetación planta un pinar distinto del de sin seed, que es lo correcto. En scatter, en cambio, **seed 0 = sin seed** (`s0` da exactamente las prims de `base`), porque `scatter.ts` usa `zone.seed ?? 0`. Es una asimetría preexistente (menor 3).
- **1e9**: se acepta y se planta (22 ejemplares); 1e9 + 1 y 1e10 se rechazan. La prosa dice `integer ≥ 0` pero no da el tope. Un motor que use un hash de 32 bits (4294967295) se come un rechazo que la prosa no le había avisado (menor 2).
- **Tile guardado antes del cambio con seed de cadena**:
  - *En un save*: `ExpandedSceneSchema` lo rechaza al reanudar. Por el cable llega `save_invalido: save "…": la escena "tile_0_0", campo \`vegetation_zones.0.seed\` viola el contrato de escena cargable: seed es un entero de 0 a 1000000000, …`. El jugador lee «No se pudo reanudar la partida. Esa partida guardada ya no vale para esta versión del juego: bórrala o empieza una nueva.» No se monta ningún mundo. En pre-producción es la conducta que toca.
  - *En un snapshot de mundo pre-generado*: pasa por el mismo `ExpandedSceneSchema` en `world-snapshot.ts`, así que se descarta como snapshot inválido. Lo he leído en el código, sin ejercerlo.
  - *En disco hoy*: 0 zonas con `seed` en `saves/*/state.json` y en `data/games/*/world/tile.json` del checkout principal. Nadie tiene nada que perder.
- **Mensaje que ve el motor**: `Invalid scene shape — fix it and call narrative_respond again (do NOT drop the rest of the scene): vegetation_zones[0].seed: seed es un entero de 0 a 1000000000, el mismo tipo en vegetation_zones y scatter_zones`. Dice el campo exacto, el tipo, el rango y la razón de que sean iguales, así que se corrige a la primera. Tiene dos pegas:
  - no repite el valor recibido, cuando el de scatter sí lo hace (`(tiene "3")`) (menor 1);
  - «1000000000» se lee peor que «10⁹», pero es cosmético.
- **Una zona mala tumba las demás**: con dos zonas en las que solo la segunda trae `seed: "claro"`, se plantan 0 ejemplares y el aviso dice «vegetation_zones[1].seed: …; **la zona** no se planta». En realidad no se planta ninguna. Es preexistente (`parseVegetationZones` es todo o nada) y el aviso miente en el número (menor 4).

## Hallazgos

**Bloqueantes**: ninguno.

**Importantes**: ninguno propio de la tanda.

**Menores**
1. **El mensaje de vegetación no dice qué recibió.** Para reproducirlo, pasar un tile con `vegetation_zones[0].seed: "3"` a `validateFormatDScene` (o correr el guion 290). Sale `…seed: seed es un entero de 0 a 1000000000, …`, cuando el de scatter añade `(tiene "3")`. Lo esperable es que los dos `seed?` hermanos respondan igual, porque es justo lo que la tanda unifica.
2. **La prosa no da el tope.** `tile_instructions.md:254` y `:309` dicen `integer ≥ 0`, pero el zod corta en 1e9. Si el motor escribe `seed: 4294967295`, le llega un rechazo que la prosa no anunciaba. Lo esperable es que la prosa diga «0..1e9» o que el error lo cuente, y el error ya lo cuenta, así que el coste es una vuelta rara.
3. **En scatter, seed 0 = sin seed; en vegetación, no.** Con `scatter_zones[i].seed: 0` salen las mismas prims que sin seed (guion 290, `s0` frente a `base`). La prosa promete que el seed «baraja», y un motor que ponga 0 para barajar no ve ningún cambio. Es preexistente (`zone.seed ?? 0`).
4. **El aviso de plan dice «la zona» cuando se caen todas.** Se ve en un tile con dos zonas y un seed malo en una, pasado por `formatDToWorld`: `__plan_warnings` dice «la zona no se planta» y quedan 0 ejemplares de las dos zonas. Es preexistente.
5. **Agujero preexistente en la vía de API directa (ai_server).** `validate_scene_response` no mira `seed`, así que `seed: "3"` pasa el saneador laxo tal cual (`{"veg":["3"]}`). Después `validateScene` en `handlers/tile.ts` lo rechaza («El tile (tx, ty) no es jugable»), y **se pierde el tile entero**. Eso incumple la regla escrita en `narrative_schemas.py`: descartar el bloque malo y salvar el tile. Antes de la tanda le pasaba al seed NUMÉRICO, que es el que escriben los motores, así que la tanda reduce el agujero en lugar de agrandarlo. Sigue abierto para lo que no es entero. El guion 290 lo deja como AGUJERO CONOCIDO, que se pone rojo el día que se cierre. El crítico decidió no tocar Python porque «no lee seed», y eso es precisamente el agujero.

**Fuera de alcance (visto en las capturas)**: la zona se declara como `"pino"`, pero `vegetation_zones` planta sobre todo copas redondas de frondosa. Los conos de pino que se ven son del `scatter_generators.pino`, que no colisiona. Como director de arte, el «pinar» del bench es un robledal con pinos decorativos detrás. Viene de antes de esta tanda y no tiene que ver con el seed.

## Guiones

- `qa/guiones/290-el-seed-de-la-zona-es-un-entero-en-todo-el-camino.mjs`. No abre navegador ni habla con el motor (`sinNavegador` + `sinMotor`), así que entra en CI por `--sin-navegador`. Mira el pre-flight (zod), el bridge (`validateScene`), la normalización y la spec fps (determinismo, que el seed mande, seed 0), el golden sin seed y el passthrough de ai_server, además del agujero conocido. Salida real: 11 ✔, `1 en verde · 0 en rojo`.
  Lo rompí a mano cuatro veces, cada una revertida con `git checkout --` (cada fila dice qué rompí y qué aserto se puso rojo):

  | Rotura a mano | Rojos |
  |---|---|
  | zod otra vez en `z.string()` | 5 asertos |
  | derive con truthy (`zone.seed ?`) | «seed 0 no es sin seed» |
  | derive con `String(zone.seed)` a pelo | el golden (`f853c23f…`, 23 ejemplares) |
  | scatter sin la comprobación del seed | «rechaza lo demás» y «scatterError con la ruta» |
- `qa/guiones/291-el-bosque-sembrado-vuelve-igual-por-el-bridge.mjs` (navegador). Hace esto:
  1. juega una partida;
  2. siembra `seed` en el save y la reanuda desde la tarjeta del título;
  3. comprueba seed 3, seed 3 otra vez, seed 4, el save viejo con `"3"` y la vuelta sin seed.

  Salida real: `1 en verde · 0 en rojo`, con las capturas en `qa/capturas/2026-09-29T14-40-06-671Z-1083678/`. En negativo, con el zod en `z.string()`, sale rojo: el save con seed 3 es `save_invalido` y la espera de `reanudar` se agota a los 180 s. Es un rojo lento, y así lo dice la cabecera.
- `npm test` (nefan-core): 3718/3718 con los dos guiones dentro, incluido `un-salto-del-guion-se-observa`. La primera versión del 291 lo ponía rojo con un `if` mudo dentro de una función anidada, y lo corregí en el guion.

## Workarounds usados

- **Sembrar el seed en el save en vez de que lo escriba el motor.** El motor falso no emite `seed` en ninguna zona y no tiene una puerta para pedirle un tile concreto. El tramo que se ejerce es el de verdad (disco → `ExpandedSceneSchema` → `formatDToWorld` en el wire → cliente), y el save guarda el Format D tal como lo habría persistido el bridge. **Sin impacto para el jugador**, porque el jugador no escribe saves. Lo que queda fuera es la generación por `handlers/tile.ts`, y esa puerta (`validateScene`) la cubre el 290 en un subproceso.
- **`setPlayerPos` + `setYaw` para la foto del pinar.** El jugador arranca mirando la taberna. El teletransporte solo encuadra la captura, porque la medida son los ejemplares del plan. **Sin impacto.**
- **El pre-flight de narrative-mcp, fuera de su servidor.** Llamé a `validateFormatDScene` de su `dist` en un proceso suelto, porque el preset `e2e-sin-creditos` no levanta narrative-mcp. La función es la misma que llama `server.ts:415`. **Sin impacto.**

## No probado

- **Un motor REAL escribiendo el tile.** Necesita una sesión de Claude Code como motor, y el encargo era sin créditos. Tampoco he comprobado que el motor lea la prosa nueva: el narrative-mcp de los terminales abiertos en el checkout principal sigue con la prosa vieja hasta el merge y el reinicio. Queda por confirmar en el próximo playtest que no hay ni un `rechazo forma_escena` por seed.
- **La vía de API directa de punta a punta** (ai_server con `ANTHROPIC_API_KEY`). Solo probé el saneador Python en un subproceso.
- **El snapshot de mundo pre-generado con seed de cadena.** Lo deduje leyendo `world-snapshot.ts` y no lo ejercí.
- **La mutación de `blueprint-derive` y `blueprint-scatter`.** Sigue pendiente de autorización, como dice `implementacion.md`.

## Veredicto

**Apto.** El seed entero ya no le cuesta un rechazo al motor en ninguna de las dos zonas. Lo malo se rechaza con la ruta y el tipo, sin coerción. Por el bridge y hasta el cliente se pinta de forma determinista, y un bosque sin seed sale idéntico byte a byte al de antes. Los menores 1 y 2 son del mensaje y de la prosa de esta misma tanda y se pueden arreglar en diez minutos. El 3, el 4 y el 5 son de antes.
