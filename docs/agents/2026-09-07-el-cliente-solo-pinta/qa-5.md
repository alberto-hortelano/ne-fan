# QA — PR 5 de #241: la huella del spawn y la colisión del jugador salen del cliente a core (#489)

**Veredicto: APTO CON RESERVAS.** El cambio de conducta DECLARADO está pagado y medido: la forja de 4×4 m que el
motor pone a mitad de partida pasa de atravesable entera a frenar al jugador a **2,44 m de su centro** (pared teórica
2,40 = media huella 2 + radio 0,4), el cofre a **1,16 m** (teórica 1,15), y siguen sólidos **tras reanudar** — con la
huella derivada al leer el ledger, porque el save no la guarda (`grep sizeXZ state.json` = 0). Y lo que la PR prometió
no cambiar, **no cambia por el camino real**: sobre las tres fixtures, 1.080 sondas de caja comparando la
implementación de la base (copiada literal de `3cd77d82:nefan-html/src/world/collision.ts`) con `aabbBloquea` de hoy
dan **0 diferencias**, los 105 movimientos de frontera dan **0**, y la huella de las **40** entidades de `data/scenes/`
es idéntica a `[w·mpc, h·mpc]`. La regla `text` nace roja con los tres tokens, el módulo entra en
`mutation-targets.json` como `sin medir` (sin él, `npm test` cae con «sin dueño»), y los mutantes que probé a mano
caen o son los equivalentes que el ingeniero ya había declarado. Guion nuevo **91** verde en cuatro corridas y probado en
negativo (9 asertos rojos, con la pared de la forja medida en 0,00 m). La batería completa, en su corrida final:
**`88 en verde · 0 en rojo de 88`** (§4; en las otras dos, un rojo fue mío y el otro el guion 80 intermitente de
#496, verde suelto acto seguido).

Las reservas son **tres cosas que ocurren y no están dichas en `implementacion-5.md`** (ninguna bloqueante, todas con
reproducción): el criterio nuevo (`volume_id`) **quita la red de seguridad** que tenía el criterio viejo cuando el plan
de un tile no deriva colisión — ahí los edificios pasan de sólidos-por-caja a atravesables (H1); **todo** lo que el
motor spawnee como `object` es desde hoy un bloque sólido de 1,5 × 1,5 m, y el contrato no le deja declarar otra cosa
—una llave, un farol o una manzana son hoy un muro (H2)—; y el trío de un turno forma **un muro de 5,6 m con una
rendija de 0,85 m** (el cuerpo mide 0,80): medido en vivo, el jugador no pasa entre el cofre y la forja, y el cofre
puede quedar **encajonado y fuera de su alcance** (H3, que es §9.1 del informe con números). Nada de esto invalida la
PR: son consecuencias del arreglo que hay que decidir, no defectos de la implementación.

Worktree `/home/al/code/ne-fan-241-5-qa`, HEAD desprendido `6ec7078b` sobre `main` `3cd77d82`. Stack propio:
`ss -ltn` antes → solo 22/53/80/631/3500/3636; `NEFAN_PORT_OFFSET=700 ./start.sh --preset e2e-sin-creditos` → fake-ai
`:19465`, bridge `:10577` (State API `:10578`), cliente `:3700`; parado con `NEFAN_PORT_OFFSET=700 ./start.sh --parar`
→ `✅ stack cleaned` listando solo los tres puertos de este árbol. Ningún `pkill`, ningún `kill` por puerto, ningún uso
del Playwright MCP compartido: ojos con sondas propias (`playwright-core` de `qa/node_modules`,
`qa/lib/navegador.mjs`, `qa/lib/sonda.mjs`). Guiones y batería con `qa/run.mjs`, que eligió su propio bloque. Cero
créditos en todo (`⛨ guardarraíl: cliente y bridge declaran fake:true`; `gasto sesión 0,00 € · total 0,00 €` en las
capturas). Capturas de la pasada de ojos en `qa/capturas/qa5-489/`; las de los guiones, en el directorio que
imprime cada corrida.

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **#489 pagado**: el edificio que el motor spawnea es sólido | ✅ cumple | Ojos, bloque +700, partida `alta_fantasia` andando (yaw + tecla, nunca `setPlayerPos`): `forja: parada a 2.44 m del centro (pared teórica 2.40 m) en (9.93, -2.50)`. Guion **91**: `✔ en vivo, la forja es sólida en su centro y en sus cuatro bordes`, `✔ en vivo: el jugador ANDA hacia «Forja de Robledo»`, `✔ empujando contra ella, el jugador NO entra en su caja (4×4 m + radio 0.4)` (parada a 2,50 m del centro, le sobran 0,10 al borde) y `✔ en vivo, la pared de la forja está a 2.4 m de su centro (media huella + radio), medida y no supuesta` |
| …y el objeto también, con su huella nueva | ✅ cumple | Ojos: `cofre: parada a 1.16 m del centro (pared teórica 1.15 m) en (6.40, -3.79)`. El cofre mide **1,5 × 1,5** (3 celdas × 0,5), no los 1,4 escritos a mano: `✔ el cofre que pone el motor mide lo que deriva core para un \`object\` (1.5×1.5 m)` (guion 91, contra `huellaEnMetros` importado de `nefan-core/dist`) |
| **La huella la deriva core**, no el cliente | ✅ cumple | `grep -rncE 'sizeXZ:[^\n]*\{\s*x\s*:\|\b(frontierBlocksMove\|alreadyInside)\b' nefan-html/src nefan-core/bridge` → **0**. En el cliente `sizeXZ` solo aparece copiando lo que ya viene derivado (`materializar-spawn.ts:147 sizeXZ: effect.sizeXZ`, `carga-de-tile.ts:107 sizeXZ: d.sizeXZ`), en un tipo (`renderer/types.ts:67`), en el hook de bench y en el radio de apuntado (`etiquetas-del-mundo.ts:124`, presentación declarada en el plan §6) |
| **Equivalencia**: la huella de las entities del tile no cambia | ✅ cumple | Script propio sobre `nefan-core/dist` y las 3 fixtures: `puerto_tile 16 objetos, huella idéntica en 16 · robledo_tile 24/24 · zorder_test 0/0` contra la fórmula literal de la base (`scale: [w*mpc, entH, h*mpc]`, `3cd77d82:src/scene/scene-normalize.ts:293`). Y por lectura: `w`,`h` están validados como finitos antes (`:283`), así que `huellaEnMetros(kind,[w,h],mpc)` nunca cae al defecto ni lanza en ese camino |
| **Equivalencia**: las cajas de los objetos del tile | ✅ cumple (en el camino real) | Mismo script, `aabbBase` copiado literal de la base vs `aabbBloquea` del dist, sobre los objetos de las 3 fixtures, 10 sondas por objeto × 3 orígenes: **`svgApplied=true` (lo que hay en runtime: todo tile con plan lo tiene desde que llega) → 1.080 sondas, 0 diferencias**. Con `svgApplied=false` sí difieren 350 → **H1** |
| **Equivalencia**: agua, vanos, bordes | ✅ cumple | Agua: ojos, `parada a 0.66 m del centro de la celda de agua` (celda 0,5 m ⇒ pared a 0,25 + 0,4 = 0,65) y `probeCollide` en su centro `true`; candado `las-fixtures-solo-chocan-con-el-agua` verde (§4). Vanos: guion **45** verde en la batería (el portón se cruza por su vano: si la caja del edificio se aplicara además del grid, se pondría rojo). Bordes del tile: 105 movimientos base↔hoy, 0 diferencias; en vivo, pegado al borde este con un solo tile `+x=true`, `−x=false`, y con el vecino generado `+x=false` |
| **Equivalencia**: `__player_start` y NPCs | ✅ cumple | `las-fixtures-solo-chocan-con-el-agua` (aserto del arranque libre en las 3 fixtures) y `fixtures-las-tres-se-caminan` verdes (§4). NPCs: no pueden llevar huella (el tipo lo impide) y el sim del bridge no llama a ninguna de las dos funciones — `test/sim-collision` verde en `npm test`; guion 91: `✔ donde está un NPC no hay caja: su sitio se puede pisar`, `✔ el NPC que pone el motor («Nogala») entra como personaje y no como objeto` |
| **(b) `HuellaDelSpawn` es una unión**: olvidar la huella no compila | ✅ cumple, reproducido | Quitado `sizeXZ: huellaEnMetros(kind)` del productor (`consequence-handler.ts:149`) → `npx tsc --noEmit`: `error TS2345 … Property 'sizeXZ' is missing in type … but required in type '{ entityKind: "object" \| "building"; sizeXZ: { x: number; z: number; }; }'`. Restaurado; `git status` limpio |
| **(c) El save NO cambia** | ✅ cumple | `saves/1788789378-8c076d/state.json` (partida real de la sesión de ojos): `grep -c sizeXZ` → **0**; claves de un record del ledger: `asset_refs, data, id, position, scene_id, spawn_event_id, spawn_reason, spawned_at, type` (las de siempre; el diff de la PR no toca ningún escritor del save). Pasado por `spawnsDeRuntime` del dist: `narr_object_… · object · {"x":1.5,"z":1.5}` y `narr_building_… · building · {"x":4,"z":4}`, `npc` **sin** huella, `errores: []` |
| …y reanudar deja los spawns sólidos | ✅ cumple | Ojos: `tras reanudar: forja {"sizeXZ":{"x":4,"z":4},"centro":true,"borde":[true,true,true,true]}` · `cofre {"sizeXZ":{"x":1.5,"z":1.5},"centro":true,"borde":[true,true,true,true]}`, y **andando** `parada a 2.44 m del centro de la forja`. Guion 91 bloque 5, seis asertos verdes (huella derivada ×2, sólida ×2, pared medida ×2) |
| **Regla `la-logica-de-juego-no-vuelve-al-cliente` se pone ROJA** | ✅ cumple, reproducido | Reinsertados los tres tokens de entonces (`sizeXZ: isBuilding ? { x: 4, z: 4 } : { x: 1.4, z: 1.4 }` en `materializar-spawn.ts`, `frontierBlocksMove`/`alreadyInside` en `collision.ts`) → `✖ [error] la-logica-de-juego-no-vuelve-al-cliente` con `collision.ts:67 frontierBlocksMove`, `:68 alreadyInside`, `:69 alreadyInside`, `materializar-spawn.ts:147 "sizeXZ: isBuilding ? { x: 4, z: 4 } : { x:"` (`ℹ fail 1` de 89). Restaurado; `git status` limpio |
| …con su párrafo en el `why` | ✅ cumple | El `why` gana el párrafo «PR 5 (#489, 2026-09-07)»: qué era (los dos literales en metros y las 45 líneas sin test), dónde vive hoy, por qué volvería («una huella es un número, y el sitio donde se ve que un objeto es pequeño es el cliente») y **qué NO canda**: `svgApplied`, con el motivo (sigue vivo y legítimo en `tile-store.ts`) |
| **Mutación**: entrada `obstaculos-del-jugador` con `break: "sin medir"` | ✅ cumple | `mutation-targets.json` (48 módulos): `mutate: src/simulation/obstaculos-del-jugador.ts`, `tests: test/obstaculos-del-jugador.test.ts`, `break: "sin medir"`, y un `porque` que nombra los mutantes por su efecto en el juego (el `+ radio`, el `yaDentro`, el `volumeId`, el conjunto del origen, el `hayGrid`) y declara equivalentes los cuatro `<` |
| …y `scene-normalize` crecida, con el suelo 98 justificado | ✅ cumple | Su `porque` gana el párrafo de `huellaEnMetros`/`FOOTPRINT_POR_DEFECTO` con la estimación (10-15 mutantes), «EL SUELO SE QUEDA EN 98 A PROPÓSITO» (la última medida ya estaba en 97,4 %) y por qué la batería no cambia (la función vive DENTRO del módulo medido y sus llamantes no son tests) |
| `npm run deuda` lo lista | ✅ cumple | `⚠️ sin medir 5 de 48 módulos` (4 de 47 en la base) — los cinco: `politica-de-atlas`, `fusible-de-skins`, `gates-de-imagen`, **`obstaculos-del-jugador`**, `frontera`. `Fronteras — deuda congelada · 13` y `Mutación — supervivientes · 58`, iguales a la base |
| Sin la entrada, `npm test` cae «sin dueño» | ✅ cumple, reproducido | Quitado el módulo (48→47) → `✖ cada fichero del perímetro puro tiene dueño: un módulo o una exención escrita` · `AssertionError: sin dueño en data/contract/mutation-targets.json: src/simulation/obstaculos-del-jugador.ts` (`ℹ fail 1`). Devuelta; `git status` limpio |
| Mutantes a mano | ✅ cumple | `FOOTPRINT_POR_DEFECTO.object [3,3]→[2,2]` → **4 rojos** en los tres procesos (escena, effect y resume): «un objeto y un edificio salen CON su huella colisionable», «el objeto y el edificio vuelven CON su huella», «sin footprint aplica el defecto POR KIND», «un `object` spawneado mide lo mismo que un prop de 3×3». `obj.volumeId !== undefined → === undefined` → **6 rojos** en `test/obstaculos-del-jugador.test.ts`. Los cuatro `<` del AABB → `<=`: **16/16 en verde**, o sea sobreviven — es exactamente lo que §8 del informe declara como equivalente ANTES de medirlo, y lo confirmo. Ficheros restaurados; `git status` limpio |
| **(d) ¿Se sacrificó la doc para cuadrar la cobertura?** | ✅ no | El módulo nuevo es el **más documentado** de su carpeta: 96 líneas, **48 de comentario (50 %)** frente a `paso-del-jugador.ts` (45 %) y `mirada.ts` (41 %). La cabecera dice qué frena al jugador y por qué está aquí; `aabbBloquea` lleva los tres párrafos que importan (qué era el salto por tile, por qué el jugador atravesaba la forja, y por qué la pregunta correcta es `volume_id`). Lo que se recortó —un alias `PuntoXZ` que su vecino tampoco tiene— no es documentación. **La cobertura no se cuadró: se pagó** (§5, medida) |
| **(e) ¿Queda alguna rama de colisión por tile en el cliente?** | ✅ no | `grep -rn svgApplied nefan-html/src` → `tile-store.ts:49` (el campo), `:113` (lo pone), `carga-de-tile.ts:317` (lo inicializa) y `:335` (restaurar vs derivar) — y dos menciones en comentarios de `collision.ts` que son historia fechada. `collidesAt` no lo consulta: su cuerpo es `fronteraBloquea` → colliders del tile → `aabbBloquea`. El único criterio que decide qué caja se aplica es `obj.volumeId`, y vive en core |
| **(f) El guion 81 se PROMUEVE, no se retoca** | ✅ cumple (con matiz) | El bloque 1 pasa de `⚠ HALLAZGO` (log sin rojo) a 8 `ctx.expect`, y añade `sizeXZ`/`volumeId` a la medida; el resto del guion no cambia. La cabecera y la fila del README cuentan qué era y qué se afirma ahora. Matiz: el aserto «un palmo más allá se pasa **por algún lado**» (`libre.some(b => b === false)`) es más flojo que el `dentroX/dentroZ` de antes — está justificado en el código (los tres spawns caen a 1,8 m y la caja de la forja casi toca el cofre), pero significa que el 81 ya no puede ver una caja que crezca hasta 3 de sus 4 lados. Lo cubre el 91, que mide la pared por su geometría |
| Guiones verdes sin retocar ninguno | ✅ cumple | §4, tres corridas completas. Los dos guiones que el commit toca, contados sin comentarios: el **02** tiene 44 líneas de código en la base y 44 hoy (solo cabecera), y el **81** pasa de 219 a 244 — que es la promoción declarada. Yo no retoqué ninguno del banco |
| Guion nuevo con negativo | ✅ cumple | `qa/guiones/91-la-forja-que-el-motor-pone-ya-no-se-atraviesa.mjs`, verde; saboteando `volumeId !== undefined → === undefined` → **9 asertos rojos**, con la pared de la forja medida en **0,00 m** (deja de existir para la colisión) y el jugador llegando a **0,28 m de su centro** (§3) |
| `npm run verify` / `crap` / cliente | ✅ cumple | `cd nefan-core && npm run verify` (build + los tres typecheck + lint + test): `ℹ tests 2280 · suites 414 · pass 2280 · fail 0`. `npm run coverage && npm run crap -- --check`: `1288 funciones medidas · cobertura de líneas 89.1% · complejidad máxima 46 · Tope (no empeorar): CRAP ≤ 73 — 0 por encima · Cobertura de líneas mínima: 89% — ahora 89.1% · ✔ dentro de los umbrales`. Cliente: `TSC_OK`, `eslint .` sin salida, `✓ built in 1.50s` |
| El guion nuevo cumple las reglas del banco | ✅ cumple (tras corregirlo) | `qa-guiones-sin-espera-por-reloj` puso ROJA mi primera versión (2 violaciones, `new Promise((r) => setTimeout(`): el candado del repo funcionando sobre un guion recién escrito por QA. Reescrito con espera por ESTADO (el predicado corre en la página, recuerda la última posición y re-encara al jugador); `npm run verify` verde con el guion dentro, `test/architecture.test.ts` 89/89 y `grep -c setTimeout` → 0 |
| Rastros | ✅ cumple | §7 |

## 2 · El cambio de conducta, medido por mí

Todo con el stack propio (+700), partida `alta_fantasia`, motor falso, cero créditos. El jugador **anda**: yaw + tecla
del driver `scripted`; ningún `setPlayerPos`.

| Qué | Antes (base) | Hoy | Cómo lo medí |
|---|---|---|---|
| Forja spawneada (4×4 m) | atravesable entera | para a **2,44 m** del centro (pared 2,40) | ojos + guion 91 |
| Cofre spawneado | 1,4×1,4 m e igualmente atravesable | **1,5×1,5** y para a **1,16 m** (pared 1,15) | ojos + guion 91 |
| Los dos, **tras reanudar** | — | sólidos en centro y 4 bordes; andando, para a **2,44 m** | ojos + guion 91 bloque 5 |
| Edificio del tile (`casa_lenador`, 10×7) | para a 5,4 m en x | **igual**: parada a 5,46 m del centro (dz 0,04) | ojos |
| Agua del grid | bloquea | **igual**: para a 0,66 m del centro de la celda | ojos |
| Objetos del tile que cambian de conducta | — | **cero**: los 22+14 bloqueables de las fixtures y el único de la escena del banco llevan `volume_id` | script de equivalencia + `✔ TODO objeto bloqueable del tile lo representa un volumen del plan` (guion 91) |
| NPCs (del tile y de runtime) | no bloquean | **igual** | guion 91 |

## 3 · El guion 91 y su negativo

`qa/guiones/91-la-forja-que-el-motor-pone-ya-no-se-atraviesa.mjs` (+ fila en `qa/README.md`), **sin commitear**, como
se pidió. Mide las dos cosas que el 81 no mide, y son distintas:

- **Dónde ACABA la caja, con sondas**: desde el centro hacia los cuatro ejes, a qué distancia `probeCollide` deja de
  bloquear. La más corta tiene que caer en `media huella + radio` con la tolerancia del barrido (5 cm), y la huella es
  la que deriva `huellaEnMetros` de `nefan-core/dist` — la misma función que llenó el `sizeXZ` del effect (`⊘` con su
  motivo si no hay `dist`). El 81 pregunta «¿bloquea el borde?», y una caja de 8×8 m también diría que sí.
- **Que el motor de movimiento la respete, andando**: el jugador empuja contra la forja y no acaba dentro de su caja.
  Que ANDE es un aserto propio, no una precondición escondida: sin él, «no entra» sale verde con el jugador parado.

Bloques: (0) todo bloqueable del tile lleva `volume_id`; (1) el edificio del tile frena andando; (2) los spawns miden
lo que dice core y no los representa ningún volumen; (3) sólidos + pared medida + choque andando + el hueco entre las
dos cajas; (4) un NPC no es una caja; (5) el save trae los records sin huella, y tras reanudar todo se vuelve a medir.

```
▶ 91-la-forja-que-el-motor-pone-ya-no-se-atraviesa
    ⛨ guardarraíl: cliente y bridge declaran fake:true
    ✔ TODO objeto bloqueable del tile lo representa un volumen del plan (por eso su caja no se aplica y su solidez no cambió)
    ✔ el plan del tile: el jugador ANDA hacia «casa_lenador» (edificio del tile) (si no, nada de lo de abajo mide)
    ✔ el plan del tile: empujando contra «casa_lenador» (edificio del tile), el jugador NO entra en su caja (10×7 m + radio 0.4) — #489
    el hostil del turno 2 (Secuaz): {"hud":0,"muerto":true}
    ✔ la forja que pone el motor mide lo que deriva core para un `building` (4×4 m), no lo que se inventara el cliente
    ✔ la forja NO la representa ningún volumen del plan (su caja es lo único que puede frenar al jugador)
    ✔ el cofre que pone el motor mide lo que deriva core para un `object` (1.5×1.5 m), no lo que se inventara el cliente
    ✔ en vivo, la forja es sólida en su centro y en sus cuatro bordes (antes de #489 se atravesaba entera)
    ✔ en vivo, la pared de la forja está a 2.4 m de su centro (media huella + radio), medida y no supuesta
    ✔ en vivo, el cofre es sólida en su centro y en sus cuatro bordes (antes de #489 se atravesaba entera)
    ✔ en vivo, la pared de el cofre está a 1.15 m de su centro (media huella + radio), medida y no supuesta
    ✔ en vivo: el jugador ANDA hacia «Forja de Robledo» (si no, nada de lo de abajo mide)
    ✔ en vivo: empujando contra «Forja de Robledo», el jugador NO entra en su caja (4×4 m + radio 0.4) — #489
    en vivo: «Forja de Robledo» — parada (9.04, -8.51) · a 2.50 m del centro · le sobra 0.10 m al borde · vida 58 → 58
    hueco entre «Cofre de la posada» y «Forja de Robledo»: centros a 3.60 m, caras a 0.85 m (el cuerpo del jugador mide 0.80); de 121 sondas en la línea que los une, 2 libres
    ✔ donde está un NPC no hay caja: su sitio se puede pisar
    ✔ el NPC que pone el motor («Nogala») entra como personaje y no como objeto: no hay huella que aplicarle
    ✔ el save tiene los records de runtime… y NINGUNA huella escrita (se deriva al leer)
    ✔ la forja vuelve del save con la huella DERIVADA al leer (4×4 m) — no está en disco
    ✔ el cofre vuelve del save con la huella DERIVADA al leer (1.5×1.5 m) — no está en disco
    ✔ tras reanudar, la forja es sólida en su centro y en sus cuatro bordes (antes de #489 se atravesaba entera)
    ✔ tras reanudar, la pared de la forja está a 2.4 m de su centro (media huella + radio), medida y no supuesta
    ✔ tras reanudar, la pared de el cofre está a 1.15 m de su centro (media huella + radio), medida y no supuesta
✔ 91-la-forja-que-el-motor-pone-ya-no-se-atraviesa
1 en verde · 0 en rojo de 1
```

Tres corridas sueltas seguidas en verde, más la de la batería completa (§4).

**Probado en negativo** (`obstaculos-del-jugador.ts`, `obj.volumeId !== undefined` → `=== undefined`: las cajas
vuelven a saltarse lo que el motor spawnea, que es #489 tal cual) → **9 asertos rojos**:

```
✘ en vivo, la forja es sólida en su centro y en sus cuatro bordes — {"centro":false,"borde":[true,false,false,false]}
✘ en vivo, la pared de la forja está a 2.4 m de su centro — pared por eje [+x,−x,+z,−z] = [0,0,0,0] · la más corta 0.00 vs core 2.4
✘ en vivo, la pared de el cofre está a 1.15 m — [1.05,8.05,7.35,1.5] · la más corta 1.05 vs core 1.15
✘ en vivo: empujando contra «Forja de Robledo», el jugador NO entra en su caja — parada (9.14, -7.16) · a 0.28 m del centro · le sobra -2.17 m
✘ tras reanudar: los mismos cuatro, otra vez
```

Fichero restaurado; `git status` limpio.

**Lo que me cazó a mí y merece estar escrito**: la primera versión del guion esperaba con `new Promise(r =>
setTimeout(r, 250))` y `npm run verify` la puso ROJA — `qa-guiones-sin-espera-por-reloj`, 2 violaciones con su línea y
su `why`. El candado del repo funcionó sobre un guion recién escrito por QA, que es justo para lo que está. La
reescritura pasa el muestreo a la página (el predicado del `waitFor` recuerda la última posición en `window.__qa91` y
re-encara al jugador en cada muestra, el mismo patrón que `herirHasta`), así que hoy no queda un solo sleep. Y de
paso apareció el defecto que la prisa habría dejado pasar: sin re-encarar, el deslizamiento por ejes llevaba al
jugador hasta el borde del tile en vez de contra lo que se mide, y el aserto «no entra en la caja» habría salido
verde sin haber medido nada — por eso «el jugador ANDA» es hoy un aserto y no una suposición.

**Tres decisiones del guion, declaradas** para que nadie las lea como aflojar un aserto: (a) antes de medir andando se
acaba con el hostil que el motor suelta en el turno 2 —lo que hace quien juega cuando le atacan—, porque si no lo que
se mide es una carrera contra su daño: el jugador muere a mitad del paseo y reaparece lejos; (b) si aun así muere,
reaparece por la puerta del jugador (la R, repetida hasta que el sim la aplica) y sigue; (c) al cofre no se le exige
que el jugador llegue a tocarlo: a veces queda encajonado (H3) y eso sería afirmar la suerte del spawn — su pared la
afirma el barrido, que no depende de poder llegar.

## 4 · Batería y candados

**Tres corridas completas** (`node qa/run.mjs`, sin retocar ningún guion del banco; el runner eligió su bloque y
levantó su propio `e2e-sin-creditos`). La línea literal de cada una:

```
87 en verde · 1 en rojo de 88 · capturas en /home/al/code/ne-fan-241-5-qa/qa/capturas/2026-09-07T14-14-02-104Z-345038
87 en verde · 1 en rojo de 88 · capturas en /home/al/code/ne-fan-241-5-qa/qa/capturas/2026-09-07T14-27-28-372Z-369737
88 en verde · 0 en rojo de 88 · capturas en /home/al/code/ne-fan-241-5-qa/qa/capturas/2026-09-07T15-03-28-203Z-407486
```

- **Corrida 1**: el único rojo fue **mi guion 91**, en una versión intermedia que dependía del respawn — defecto MÍO,
  no del juego (§3). Los 87 del banco, verdes.
- **Corrida 2**: el único rojo fue el **guion 80**, con la firma de intermitencia ya documentada en `qa-3.md`
  (**#496/#467**): `· …ni deja una entrada de error — 4 → 5`. Repetido suelto acto seguido, **verde**
  (`✔ 80-el-desplegable-room-dice-lo-que-se-ve · 1 en verde · 0 en rojo de 1`), y verde también en las corridas 1 y 3
  con el mismo código. No es de esta PR: el 80 no toca colisión ni spawns.
- **Corrida 3** (con el guion 91 en su forma definitiva): **88 en verde · 0 en rojo de 88**, `EXIT=0`.

**Candados headless** (los dos que el plan pide para esta PR, corridos aparte):

```
✔ las tres fixtures pintan sin bridge y solo chocan con el agua y el plan · capturas en qa/capturas/solo-agua-*.png
✔ las tres fixtures pintan, se caminan y colisionan sin backend · capturas en qa/capturas/las-tres-*.png
```

El primero incluye los asertos que caerían si una caja se aplicara de más: `✔ el arranque del jugador NO bloquea` en
las tres fixtures y `✔ el centro de un edificio del plan BLOQUEA`.

## 5 · La cobertura

Medido por mí (`npm run coverage`, y el `lcov.info` leído fichero a fichero):

| Fichero | Líneas del lcov | Ramas | Funciones |
|---|---|---|---|
| `src/simulation/obstaculos-del-jugador.ts` | **52/96 = 54,2 %** | **23/23** | **5/5** |
| `src/simulation/paso-del-jugador.ts` (su vecino, ya medido) | 63/83 = 75,9 % | 21/22 | 2/2 |

Las 44 líneas «sin cubrir» del módulo nuevo son EXACTAMENTE su cabecera, sus dos interfaces y el `import type`: todo
lo que desaparece al compilar y que el lcov de V8 mete en el denominador igual. Lo ejecutable está al **100 %**
(23/23 ramas, 5/5 funciones), y el mismo artefacto es lo que deja a su vecino en 75,9 %. Así que la afirmación del
informe se sostiene: **la cobertura no se cuadró apretando la prosa, la prosa se apretó porque el gate cuenta
comentarios**. Y el módulo sigue siendo el más documentado de su carpeta (§1, criterio (d)).

Dicho eso, el aviso del ingeniero (§8 de su informe) es real y lo confirmo con la medida: `crap -- --check` da
`cobertura de líneas 89.1% · Cobertura de líneas mínima: 89% · ✔ dentro de los umbrales`, o sea que el margen es de
décimas y **el siguiente módulo pequeño y bien documentado vuelve a tumbar el gate**. Un umbral que se paga
documentando empuja a lo contrario de lo que la casa pide. Merece issue (medir sobre líneas EJECUTABLES), y no es
decisión de QA.

## 6 · Pasada adversarial — «¿en qué situación NO se cumple?»

| Situación | Resultado |
|---|---|
| El plan de un tile no deriva colisión (`svgApplied` se queda a `false`) | **Falla la equivalencia** → H1: 350 sondas cambian de veredicto; los edificios se atraviesan |
| El motor spawnea algo pequeño como `object` | **Conducta nueva no deseada** → H2: 1,5 × 1,5 m sólidos para cualquier cosa; el contrato no le deja declarar otra |
| Un `prop`/`tree` del tile tapado por un volumen declarado | **Conducta nueva** → H4: sólido por su footprint entero donde el plan no pinta nada |
| El spawn cae ENCIMA del jugador | Se cumple: «salir sí, entrar no» le deja salir (`test/obstaculos-del-jugador.test.ts`, caso «quien apareció dentro»; y en vivo, `¿dentro de un sólido? false` tras los tres spawns) |
| Dos spawns pegados (1,8 m) | Se cumple lo pedido, pero el hueco no se pasa → H3 |
| Un save con un `type` que el juego no sabe pintar (`dragon`) | Se cumple: `spawnsDeRuntime` lo filtra antes de pedir huella, así que el fail-loud de `huellaEnMetros` no puede dispararse por ahí — guion **81** verde (cuenta 3 y no 4, y lo dice UNA vez) |
| Un `npc` al que se le pidiera huella | Imposible: el tipo lo prohíbe (probado: no compila) y `huellaEnMetros("npc")` es fail-loud con el mensaje que nombra los kinds que sí tienen |
| Una escena con otro `meters_per_cell` | Se cumple: `huellaEnMetros` toma `mpc` por parámetro y `formatDToWorld` le pasa el de la escena; el spawn usa el del plano (`TILE_MPC`) |
| Viajar a otro tile y volver | Se cumple: los spawns de runtime no los purga `addTile` (#350) y siguen sólidos; guiones **48**, **49**, **66**, **67** verdes |
| El jugador muerto | La colisión no cambia; el guion 91 lo declara y reaparece antes de medir |

## 7 · Rastros

`grep -rnE 'svgApplied|1\.4|SEPARACION|collidesAt' nefan-html/src qa docs/arquitectura`, revisado uno a uno:

- **`svgApplied`**: vivo solo en `tile-store.ts` (campo + asignación) y `carga-de-tile.ts` (inicialización y el
  «restaurar vs derivar»). En `collision.ts`, `obstaculos-del-jugador.ts`, `vistas.md`, el guion 81 y el README son
  menciones **fechadas** de qué gobernaba hasta la PR 5. Ninguna promete ya que apague cajas.
- **`1.4`**: `fps-gl.ts:154` (`TELEGRAPH_PAD_M`), `fps-gl.ts:1428` (una flecha de debug), cuatro `line-height` de CSS y
  `title-screen.ts` — todo pintar. La única mención al 1,4 de la huella vieja está en prosa fechada (guion 81, README).
- **`SEPARACION`**: `consequence-handler.ts:195` (`SEPARACION_M = 1.8`, core, y es H3) y `SEPARACION_MINIMA` de los
  guiones 17 y 25, que es otra cosa (cuánto anda el jugador antes de guardar).
- **`collidesAt`**: el método de cableado (`collision.ts:67`), sus llamantes de `main.ts` y las sondas del hook de
  bench. Ninguno decide nada: el cuerpo son las dos funciones de core y los colliders del tile.
- La nota de `bridge/sim-collision.ts:18` **ya no dice «divergencia intencional del cliente»**: hoy dice que la
  frontera y las cajas son del JUGADOR, que viven en core desde esta PR, y que este proveedor no las llama a propósito
  («un NPC no se frena en el borde del mundo conocido: su tile existe, es donde vive»). Correcta y verificada contra el
  código.

## 8 · Hallazgos

### H1 · Cuando el plan de un tile no deriva colisión, sus edificios pasan a ser ATRAVESABLES (antes frenaban por su caja) — **menor**, de esta PR

El criterio viejo tenía una red de seguridad que el nuevo no tiene, y no está dicha en `implementacion-5.md` (§5 dice
«Volumen del plan (edificio, muro): igual»). En la base, la caja de un objeto se saltaba **solo si su tile tenía el
plan aplicado**; si `applyPlanCollision` fallaba (`catch` → `errors.push`, `svgApplied` se queda a `false`), las cajas
seguían frenando —toscamente, tapando vanos, pero frenando—. Hoy el criterio es `volume_id` y no mira el tile: un
edificio del plan **nunca** aplica su caja, así que si el grid del plan no llega, ese tile se queda **sin ninguna
fuente de solidez** para sus edificios y el jugador los atraviesa. El propio código lo dice (`collision.ts:97-99`:
«las cajas de sus objetos no la sustituyen»), o sea es una decisión consciente; lo que falta es declararla donde se
lee el balance del cambio.

Medido: script de equivalencia, mismas sondas, `svgApplied=false` → `puerto_tile 420 sondas, 128 difieren
(lonja/taberna_ancla/cordeleria/almacen_sal/astillero/faro_viejo… base=true, hoy=false)`; `robledo_tile 660 sondas,
222 difieren (casa_concejo/capilla/herreria/posada/molino/establo…)`. Reproducción para el jugador: cualquier tile
cuyo plan reviente al derivar colisión (`plan de <tile> no deriva colisión; ese tile se queda sin la solidez del plan`
en el registro) queda con los edificios atravesables. **Qué esperaba el usuario**: que un fallo de derivación
degradara, no que abriera los edificios. **Destino**: decidirlo — o se declara en el informe y en el `why` como
conducta aceptada, o el `catch` deja de saltar las cajas de ese tile.

### H2 · Todo lo que el motor spawnee como `object` es desde hoy un muro de 1,5 × 1,5 m, y no puede declarar otra cosa — **importante**, consecuencia de esta PR (raíz en el contrato)

`SpawnEntityConsequence` (`src/contract/model-io/schemas.ts:41`) solo admite `entity_kind: npc | building | object`:
no hay tamaño, no hay clase «item». `materializar-spawn.ts:143` mapea `object` → `category: "prop"`, y `prop`
bloquea. Antes daba igual —nada de lo spawneado frenaba—; desde esta PR, **una llave, una antorcha, una manzana o un
pergamino que el motor ponga en la escena son un bloque sólido de 1,5 m de lado** que el jugador no puede pisar ni
rodear si está en un vano. En las escenas del tile esto no pasa: ahí un `item` tiene `category: "item"` y no bloquea
(`aabbBloquea` solo frena `building` y `prop`).

Reproducción: partida `alta_fantasia` → hablar con el tabernero → turno 3 del motor falso pone «Cofre de la posada»
(`object`) → medido, 1,5 × 1,5 m sólidos. Con un motor real, el mismo camino con cualquier objeto pequeño.
**Qué esperaba el usuario**: chocar con una forja, sí; no chocar con una llave. **Destino**: issue propio — el
contrato del spawn debería poder declarar tamaño (o una clase no colisionable), que es la mitad que #489 no cubrió.

### H3 · El trío de un turno forma un muro de 5,6 m con una rendija de 0,85 m, y el objeto puede quedar fuera del alcance del jugador — **importante**, preexistente (`SEPARACION_M`), visible desde esta PR

Los tres spawns de un turno caen a 1,8 m unos de otros (`consequence-handler.ts:195`), una cifra fija que no mira el
tamaño de lo que separa. Con las cajas ya activas, la forja (4×4) y el cofre (1,5×1,5) dejan entre sus caras
**0,85 m** para un cuerpo de **0,80 m** de diámetro. Medido en la partida real (bloque +700): de 120 sondas a lo
largo de la línea que une los dos centros, **un solo punto libre** (x = 7,52); caras: cofre este 7,07 · forja oeste
7,92. Andando por ahí, el jugador **no cruza**: acaba deslizándose contra el cofre. El guion 91 lo mide en cada
corrida y ha dado **0 y 2 sondas libres de 121** en la línea que une los centros. Y en dos corridas el cofre quedó
**encajonado** —sin una sola cara libre desde la que encararlo— con 0,45 y 1,29 m de sobra.
El jugador **no queda atrapado** (el muro es una línea, no un recinto, y la regla «salir sí, entrar no» le deja salir
de cualquier solape: medido, `¿dentro de un sólido? false`), pero ve un pasillo entre dos objetos y no pasa.
**Destino**: issue propio, como ya propone el informe (§9.1). Aquí van los números.

### H4 · Un `prop`/`tree` del tile TAPADO por un volumen declarado bloquea hoy por su footprint entero, donde el plan no pinta nada — **menor**, de esta PR (declarado en §5, pero minimizado)

`derive.ts:141-149` solo apunta `representedBy` de los `building`, así que un `prop` o un `tree` cuyo rect solape un
volumen declarado por el motor se queda **sin `volume_id`** y hoy es sólido por su caja completa. El informe lo
declara («es un barril dentro de una posada, así que ser sólido es lo correcto»), pero medido no siempre es un barril
ni coincide con lo que se ve: escena sintética con una posada declarada de 6×6 celdas y un **roble** de 8×8 celdas
que la solapa por una esquina → el roble sale sin `volume_id`, con `scale 4×4 m`, y su caja bloquea **4×4 m enteros**
en una zona donde `planCollisionGrid` deja libre (medido punto a punto: centro, +1,0, +1,9, +2,3 m y la esquina NE →
`grid: libre · caja: SÓLIDO`). Es decir: se puede chocar donde no hay nada pintado, y un árbol pasa a colisionar por
su copa y no por su tronco, contra la regla de la casa («render ≠ colisión»). Cero casos en las tres fixtures y cero
en la escena del banco (todo bloqueable lleva `volume_id`), así que ningún test lo ejerce. **Destino**: issue o una
línea en `derive.ts` que apunte también los `prop`/`tree` tapados.

### H5 · El guion 81 promovido pierde un aserto de fuerza — **menor**, de esta PR

El `⚠ HALLAZGO` medía `dentroX`/`dentroZ` (dos puntos concretos dentro de la huella). La promoción cambia el segundo
por «un palmo más allá se pasa **por algún lado**» (`libre.some(b => b === false)`), con el motivo escrito (los tres
spawns a 1,8 m). Es honesto, pero significa que el 81 ya no vería una caja que creciera hasta tapar tres de sus
cuatro lados. Lo cubre el guion **91**, que mide la pared por su geometría (`sobra` contra el rectángulo inflado).
**Destino**: nada que arreglar; queda dicho para que nadie cuente el 81 como candado del TAMAÑO.

### H6 · El token de la huella también prohibiría una copia legítima campo a campo — **menor**, informativo

`sizeXZ:[^\n]*\{\s*x\s*:` casa cualquier `sizeXZ: { x: …` en la misma línea, incluida una copia legítima de la huella
que YA viene derivada (`sizeXZ: { x: h.x, z: h.z }`). Hoy no hay ninguna y la regla tiene puerta (`exceptions[].funcion`),
así que no es un problema: queda anotado porque el `why` no lo dice y el siguiente que lo encuentre creerá que ha
roto una regla.

### H7 · Crítica visual: la pared de la forja está donde se ve, pero la forja no tiene arte — **menor**, preexistente (del banco)

La captura del jugador plantado ante la forja (`qa/capturas/qa5-489/C-forja-desde-lejos.png`, a 6,4 m; y
`05-forja.png`, pegado) muestra que **la pared visual y la de colisión coinciden**: el jugador se para a 0,4 m de la
cara de un prisma que ocupa el ancho que declara (4 m), y no hay «pared invisible» ni hueco entre el volumen pintado y
el punto de parada. Lo que no acompaña es el arte: la forja y el cofre spawneados son prismas de color plano (marrón
`#5a4a38`, y el cofre un bulto cian) contra un tile pintado con el atlas del motor falso en damero, así que el objeto
con el que ahora se choca es también el que peor se integra. Es del banco (el atlas falso solo pinta el tile) y
pre-existente al cambio, pero **ahora se nota más**: antes se atravesaba y era decorado; hoy es un muro. No he
comprobado cómo se ve con Imagen IA real porque eso gasta créditos.

## 9 · Workarounds usados

1. **Sabotajes deliberados** (regla `text` con los tres tokens, `volumeId` invertido, `FOOTPRINT_POR_DEFECTO` a
   `[2,2]`, los cuatro `<` a `<=`, `sizeXZ` fuera del productor, la entrada de mutación quitada). Todos revertidos;
   `git status` limpio tras cada uno. No afectan al jugador: son la prueba en negativo, no la receta.
2. **Matar al hostil del turno 2 y reaparecer tras morir, dentro del guion 91** (`herirHasta`, `queueRespawn`). No es
   un apaño para que el juego pase: el bench tiene un hostil pegando y un cadáver no anda, así que sin eso lo que se
   mide es una carrera contra su daño. Las dos cosas son teclas del jugador (atacar y R), quedan declaradas en la
   cabecera del guion y en su fila del README, y ninguna toca el sujeto que se mide (la caja).
3. **Cerrar la sesión de ojos con el jugador muerto** en dos de las sondas manuales: las medidas de esa sonda que se
   tomaron con el jugador muerto (el intento de cruzar el hueco, `B1`/`B2`) **no** las doy por válidas y las repetí
   vivo en una tercera pasada; las que sí valen (paradas contra forja, cofre, edificio y agua) se tomaron con vida
   (78-100 en el HUD, visible en las capturas).
4. **Sondas propias en vez del runner** para la pasada de ojos (`qa/lib/navegador.mjs` + `ctxDeSonda`). Es el camino
   que el encargo pide (nada de Playwright MCP compartido) y usa el mismo cliente y el mismo stack que juega el
   jugador.
5. **Ningún** `display:none`, ningún estado sintético, ninguna pantalla saltada.

## 10 · No probado

- **Mutación real** de `obstaculos-del-jugador` y de los mutantes nuevos de `scene-normalize`: `npm run mutacion --
  local` rechaza los dos (coste desconocido / 285 mutantes sobre el tope 120), que es la política. Lo que sí hice es
  matar a mano tres mutantes concretos (§1) y confirmar que los cuatro `<` sobreviven, como el informe declaraba.
- **El `prop` tapado por un volumen declarado** en una escena del motor de verdad: no hay fixture con ese caso y el
  motor falso no lo produce. Lo reproduje sintéticamente (H4) pero **no** lo he visto en una partida real.
- **Gasto de créditos**: cero por construcción (motor falso). No he ejercido ninguna ruta de pago.
- **El camino de H1 en vivo** (que `planCollisionGrid` lance de verdad en una partida): lo demuestro con el script de
  equivalencia sobre las tres fixtures, no forzando la excepción en el cliente.

## Vuelta (2026-09-07)

Segunda pasada del ingeniero sobre los hallazgos de arriba, en el mismo worktree `/home/al/code/ne-fan-241-5`,
bloque de puertos propio (**+200**, `ss -ltn` antes: solo 22/53/80/631/3500/3636; el runner de `qa/run.mjs` eligió
el suyo). Cero créditos. Ningún `pkill`, ningún `kill` por puerto, ningún uso del Playwright MCP.

**Rebase sobre `main` = `1de5627b`** (trae las PR 4 y 6). Dos conflictos, los dos en lo que el programa hace crecer
PR a PR, fusionados a mano conservando TODO: el `why` de `la-logica-de-juego-no-vuelve-al-cliente` queda con los seis
párrafos en orden (PR 1, 2, 3, 4, **5**, 6) y su `pattern` con los cinco grupos; `test/architecture.test.ts` conserva
los dos casos negativos (el de la PR 4 y el de la PR 5) como dos `it` seguidos. Tras resolver: `npm test`
**2350/2350**, y la regla probada en negativo con un token de CADA grupo — los cinco salen ROJOS.

### H1 y H4 — el mismo arreglo, y es la regla del programa

El criterio deja de ser `volume_id` y pasa a ser **el ORIGEN del objeto**, que ya existía como unión discriminada y
OBLIGATORIA (`DuenoDeEntity`, `session/entidades-del-tile.ts`, #350: «lo puso el motor» y «se me olvidó decirlo» no
pueden colapsar). `ObstaculoAabb` lleva `dueno` y `aabbBloquea` recibe además el plan de los tiles
(`PlanDeLosTiles.planAplicadoEn(x, z)`, que el cliente implementa con el mismo `TileStore`):

```ts
if (obj.dueno.de === "tile" && plan.planAplicadoEn(obj.pos.x, obj.pos.z)) continue;
```

- **lo que DECLARA un tile conserva EXACTAMENTE la semántica de la base** (`owner?.svgApplied` sobre el tile que
  contiene al objeto, la misma pregunta y en el mismo punto): con el plan instalado su caja no se aplica, y sin él
  vuelve a aplicarse — **H1 cerrado**, la red de seguridad está de vuelta;
- y como un `prop`/`tree` tapado por un volumen declarado sigue siendo del tile, su plan responde por él y no pasa a
  ser sólido por su footprint entero — **H4 cerrado**, sin tocar `derive.ts` y sin romper «render ≠ colisión»;
- **solo los spawns de RUNTIME** (los del `spawn_entity`, `dueno: {de:"runtime"}`) ganan la caja sólida, que es el
  único cambio que la PR declara.

La garantía no depende de un flag que se pueda olvidar: `dueno` es obligatorio en el tipo. Probado —
`aabbBloquea(..., [{ pos, sizeXZ, category: "building" }], plan)` sin `dueno`:
`error TS2741: Property 'dueno' is missing in type … but required in type 'ObstaculoAabb'`.

`Entity.volumeId` (campo que la PR había añadido al cliente solo para este criterio) se retira: nadie lo lee. El hook
expone en su lugar `dueno`, que es de lo que depende ser sólido.

**Tabla de equivalencia rehecha** — `qa/equivalencia-de-cajas.mjs` (nuevo, commiteado, sin navegador ni stack):
lleva dentro el criterio de la base copiado literal de `3cd77d82:nefan-html/src/world/collision.ts` y lo compara con
el `aabbBloquea` de hoy sobre las tres fixtures, **30 sondas por objeto bloqueable** (su centro, los 4 puntos justo
dentro de la pared, los 4 justo fuera y uno lejos × 3 orígenes: lejos, pegado y DENTRO) y en los **dos** estados del
plan:

```
  puerto_tile.json   plan instalado   14 bloqueables ·  420 sondas · 0 diferencias
  puerto_tile.json   plan SIN derivar  14 bloqueables ·  420 sondas · 0 diferencias
  robledo_tile.json  plan instalado   22 bloqueables ·  660 sondas · 0 diferencias
  robledo_tile.json  plan SIN derivar  22 bloqueables ·  660 sondas · 0 diferencias
  zorder_test.json   plan instalado    0 bloqueables ·    0 sondas · 0 diferencias
  zorder_test.json   plan SIN derivar   0 bloqueables ·    0 sondas · 0 diferencias
  TOTAL: 2160 sondas · 0 diferencias

── Spawn de RUNTIME (el cambio declarado de #489) ────────────────
  la forja de 4×4 m del motor, tile con su plan instalado: 30 sondas · 10 cambian de veredicto

✔ ninguna caja que no sea un spawn de runtime cambió de conducta
```

Las **350 sondas de H1** (las 1.080 con `svgApplied: false`) son hoy **0**. Y el script puede ponerse rojo: con el
criterio de `volume_id` que tenía la PR, las mismas sondas dan **370 diferencias** (`lonja`, `casa_concejo`,
`taberna_ancla`… `base=true hoy=false`), que es H1 medido otra vez.

Tests del módulo: 16 → **19**. Los tres nuevos son los tres casos de esta vuelta: «lo que DECLARA el tile no bloquea
por su caja mientras el plan esté instalado», «un prop tapado por un volumen sigue siendo del tile» (H4) y «LA RED DE
SEGURIDAD: si el plan del tile no llegó a derivarse, sus cajas vuelven a frenar» (H1), más «la pregunta por el plan es
POR PUNTO».

### H5 — el aserto flojo del 81: se INTENTÓ hacer exacto, y la medida dijo que no

Escrito y corrido: para cada una de las cuatro direcciones a un palmo del borde, mirar si el punto cae dentro de la
caja inflada de OTRO objeto, y exigir que toda dirección aún bloqueada tenga ese dueño (una caja que creciera no lo
tendría). **Salió rojo, y no por un defecto**: `cofre — libre=[true,false,true,false] tapan=["Forja de Robledo",null,null,null]`,
o sea el +z del cofre lo bloquea el GRID del plan, no una caja, y `probeCollide` es la unión de las tres fuentes sin
desglose: desde el guion no se pueden separar sin abrir un canal de observación nuevo. Así que el aserto se queda
como estaba y la medida se convierte en **log que nombra al que tapa cada dirección** (`forja: … lo tapa=[null,"Cofre
de la posada",null,null]`), con el motivo escrito en el guion y en su fila. El TAMAÑO de la caja lo sujeta el 91, que
barre la pared eje a eje contra lo que declara core.

### H6 — el token, afilado y medido

`sizeXZ:[^\n]*\{\s*x\s*:` → **`sizeXZ:[^\n]*\{\s*x\s*:\s*[0-9.]`**: lo que separa inventar una huella de copiarla es
el NÚMERO. Medido contra los dos textos: la línea de la base
(`sizeXZ: isBuilding ? { x: 4, z: 4 } : { x: 1.4, z: 1.4 }`) sigue casando (1), y la copia legítima campo a campo
(`sizeXZ: { x: h.x, z: h.z }`) ya no (0). `test/architecture.test.ts` gana esa línea en el caso POSITIVO de la PR 5, y
el `why` lo explica.

### El guion 91, dentro

`qa/guiones/91-…` commiteado con su fila insertada tras la 90 en `qa/README.md` (`fila-91.txt` borrado). Ajustado al
criterio nuevo: el bloque 0 afirma ahora las **dos mitades** de la condición de la que depende que nada del tile
cambie —al arrancar todo objeto bloqueable es de SU TILE, y el plan de ese tile está instalado (`colision()`
derivaciones ≥ 1)— y los spawns se afirman `dueno.de === "runtime"` en vez de «sin `volume_id`».

**Probado en negativo, dos sabotajes, uno por vez, restaurados byte a byte:**

| Sabotaje | Qué se pone rojo |
|---|---|
| quitar la mitad del ORIGEN (`obj.dueno.de === "tile" &&`) → el salto vuelve a ser solo por tile: **#489 tal cual** | guion **91**: NUEVE asertos rojos. `pared por eje [+x,−x,+z,−z] = [0,0,0,0] · la más corta 0.00 vs core 2.4`; andando, `parada (9.23, −5.33) · a 0.19 m del centro · le sobra −2.25 m`; y lo mismo tras reanudar |
| quitar la otra mitad (`plan.planAplicadoEn`) → la caja del tile se aplica ADEMÁS de su plan | **ningún guion de navegador**: 91, 45, 02, 32, 06 y `las-fixtures-solo-chocan-con-el-agua` siguen VERDES (medido, no supuesto: la primera redacción de esta vuelta afirmaba que caería el 45 y era falso). Lo cazan `test/obstaculos-del-jugador.test.ts` (**3 rojos**) y `qa/equivalencia-de-cajas.mjs` (**370 de 2.160** sondas cambian) |

Esa asimetría queda escrita en el guion y en el README para que nadie cuente el 91 como candado de las dos mitades.

### Verificación de la vuelta

```
cd nefan-core && npm run verify   → ℹ tests 2353 · suites 422 · pass 2353 · fail 0
npm run deuda                     → Fronteras — deuda congelada · 13   (igual que main)
                                    Mutación — supervivientes · 58     (igual que main)
                                    ⚠️ sin medir 7 de 50 módulos       (main: 6 de 49; el de más es obstaculos-del-jugador)
npm run mutacion -- local obstaculos-del-jugador
                                  → NO se mide aquí: no hay medida previa … Pídelo: npm run mutacion -- pendiente
cd nefan-html && npx tsc --noEmit → TSC_OK · eslint . sin salida · ✓ built in 1.57s
node qa/run.mjs 02 06 32 45 48 49 66 67 81 91   → 10 en verde · 0 en rojo de 10
node qa/las-fixtures-solo-chocan-con-el-agua.mjs → ✔
node qa/fixtures-las-tres-se-caminan.mjs         → ✔
node qa/equivalencia-de-cajas.mjs                → 2160 sondas · 0 diferencias
```

**`npm run coverage && npm run crap -- --check` sale ROJO, y no es de esta PR.** Medido en esta máquina, con el mismo
comando, cambiando SOLO el árbol de `nefan-core`:

| Árbol | Cobertura de líneas |
|---|---|
| `main` = `1de5627b` a solas | **88,92 %** — ya por debajo del suelo 89 % |
| main + el commit 1 de esta PR | 88,916 % |
| main + commit 1 + esta vuelta | **88,913 %** |

O sea: el suelo lo rompe `main`, los dos commits de la PR mueven el número **7 milésimas de punto** y la vuelta deja
la rama por ENCIMA de main. El CI de `main` (corrida 34131631802) está en verde con el mismo `crap -- --check`, así
que la medida de este árbol y la del runner no coinciden — y el runner es la autoridad (CLAUDE.md). Lo que sí es
cierto en las dos es el diagnóstico que el ingeniero ya dejó escrito en §8 de su informe: **el gate cuenta líneas NO
ejecutables** (el lcov de V8 mete en el denominador la cabecera y las interfaces de un módulo: aquí, las 71 primeras
líneas del fichero) y por eso lo tumba documentar. Merece issue —medir sobre líneas EJECUTABLES—, y no lo decide el
ingeniero. Lo que sí hizo la vuelta es no empeorarlo: la prosa que añadió a la cabecera del módulo se apretó a la
densidad de sus vecinas, sin quitar ni una decisión explicada.

### Qué NO cubre esta vuelta

- **H2 y H3 siguen abiertos**, y no son de esta PR: que el contrato de `spawn_entity` no deje declarar tamaño (una
  llave es hoy un muro de 1,5 m) y que `SEPARACION_M` no mire el tamaño de lo que separa. Issues propios, como ya
  decían el informe (§9.1) y este documento.
- **H7** (la forja spawneada no tiene arte en el banco) sigue igual: es del motor falso.
- **Mutación real** de `obstaculos-del-jugador` y de `scene-normalize`: `local` sigue rechazando los dos (sin medida
  previa / 285 mutantes sobre el tope 120). Queda para la corrida autorizada; una medida pendiente no bloquea nada.
- **El camino de H1 en vivo** (que `planCollisionGrid` lance de verdad en una partida) se sigue demostrando con el
  script de equivalencia sobre las fixtures y con el test de unidad, no forzando la excepción en el navegador.
