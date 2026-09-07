# QA — PR 4 de #241: el arma y el HP máximo del jugador viajan en el wire y el aro se calcula en core (#504)

**Veredicto: APTO.** Es un movimiento y no un cambio: reproduje la equivalencia del aro por una vía distinta a la
del ingeniero (la BASE reconstruida desde `getEffectiveParams` de `dist` contra `paramsDeTelegraph` de `dist`,
sobre los cuatro catálogos reales × cinco armas × todos los ataques, incluidos los que LANZAN) y salió
**`casos comparados: 110 · diferencias base↔hoy: 0`**, con los sintéticos comprobados contra números escritos a
mano en metros (`strike 1±1 r2`, `shoot 6±6 r12`). Espada y manos difieren en los cinco ataques y martillo y
espada también, así que ignorar el arma no puede salir verde. La regla `la-logica-de-juego-no-vuelve-al-cliente`
se pone roja con los cuatro tokens del grupo nuevo —en el cliente **y en el bridge**— y su `why` lleva el párrafo
de la PR; el árbol queda limpio tras cada sabotaje. La entrada `params-de-telegraph` está en
`mutation-targets.json` con `break: "sin medir"`, `npm run deuda` y `mutacion -- pendiente` la listan, quitarla
pone `npm test` en rojo por «sin dueño», y los dos mutantes que maté a mano (el divisor del sintético y el arma
ignorada) matan 2 y 4 tests. El test de los cuatro emisores cae de verdad: saboteé el que el ingeniero **no**
probó (`handleAddCombatants`) con los valores de arranque escritos a mano y salió `fail 1`; y el olvido total ni
compila (`TS2739`). En el juego real y con cero créditos, el `state_update` trae el arma y el máximo vivos, y
**cambiando el arma en el sim** (la única fuente del literal, `store/game-store.ts`) el wire llega con
`war_hammer`/150 y los cinco aros y la barra cambian **sin tocar una línea del cliente** — que es lo que #504
pedía y lo que lo hace cerrable. Guion nuevo **89** (verde, probado en negativo tres veces) y batería
**`88 en verde · 0 en rojo de 88`** a la primera, sin retocar ningún guion.
**Lo que no está cerrado no es de la pieza movida sino del canal**: el cliente depende ahora de dos campos que
ningún zod valida, y si faltan la barra de vida se **congela** y el aro encoge a manos desnudas sin una línea en
el registro de errores (H1, medido). Los otros cuatro hallazgos son menores y tres de ellos preexistentes.

Worktree `/home/al/code/ne-fan-241-4-qa`, HEAD desprendido `5ff5581c` sobre `main` `3cd77d82`. Bloque de puertos
propio: `ss -ltn` antes → solo 22/53/80/631/3636 y los ajenos de otros agentes (`:10177`, `:19065`, y luego
`:10077/:10078/:3200/:18965`); `NEFAN_PORT_OFFSET=500 ./start.sh --preset e2e-sin-creditos` → fake-ai `:19265`,
bridge `:10377` (State API `:10378`), cliente `:3500`; parado con `NEFAN_PORT_OFFSET=500 ./start.sh --parar` →
`✅ stack cleaned`, enumerando y **respetando** lo ajeno (`⏭ :10077 :10078 … — AJENO, no se toca`). Ningún `pkill`,
ningún `kill` por puerto, ningún uso del Playwright MCP compartido. Los guiones y la batería con `qa/run.mjs`, que
elige su propio bloque libre.

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento**: el aro es IDÉNTICO antes y después, por ataque y por arma | ✅ cumple | Sonda propia distinta de la del ingeniero (`getEffectiveParams` de `dist` reconstruyendo la BASE, contra `paramsDeTelegraph` de `dist`), sobre los catálogos reales `standard`/`""`/`basic`/`shooting` × 5 armas (`unarmed`, `short_sword`, `war_hammer`, una desconocida y `""`) × todos los ids de cada catálogo: **`casos comparados: 110 · diferencias base↔hoy: 0`**, incluidos los dos casos que LANZAN |
| …y los sintéticos (ataques fuera de `combat_config.json`) | ✅ cumple | Misma sonda, contra números escritos a mano en metros (no contra la fórmula): `basic/strike: 1±1 r2 dmg0 wu0 → = a mano`; `shooting/shoot: 6±6 r12 dmg0 wu0 → = a mano`; y `arma NO influye: true` en los dos |
| El arma importa de verdad (si no, ignorarla saldría verde) | ✅ cumple | `ataques donde espada ≠ manos: 5/5 (quick, heavy, medium, defensive, precise)`; `ataques donde martillo ≠ espada: 5/5`. Tabla medida: `quick 1.2/1.3/1.8 · heavy 1.6/1.7/2.5 · medium 1.6/1.7/2 · defensive 0.9/1/1.4 · precise 1.4/1.5/1.9` (manos/espada/martillo) |
| El HP máximo del HUD como antes (barra al 100 %, herido) | ✅ cumple | Guion **89** en partida real: `✔ el jugador entero: la barra está llena y el número es su vida` (`{"ancho":"100%","texto":"100"}`). Herido: guiones 34/41/73 de la batería, verdes sin retocar (§5) |
| **Regla `la-logica-de-juego-no-vuelve-al-cliente` ROJA con un token del grupo nuevo** | ✅ cumple, reproducido | Sabotaje 1 (cliente + bridge): `const playerWeaponId = "short_sword"` en `ui/eco-del-combate.ts` y `{ maxHealth: 100, weaponId: "short_sword" }` en `bridge/handlers/session.ts` → `✖ … 3 !== 0` con `nefan-core/bridge/handlers/session.ts:830 — patrón prohibido: "maxHealth: 100"` / `"short_sword"` y `nefan-html/src/ui/eco-del-combate.ts:153 — "short_sword"`. Sabotaje 2 (los otros dos tokens): `spec.displayRange / 2` y `let playerMaxHp = 100;` → `eco-del-combate.ts:153 — "displayRange / 2"` y `hud-de-combate.ts:113 — "playerMaxHp = 1"`. Los cuatro tokens del grupo saltan, y saltan **también en el bridge** |
| …con el `why` de la PR delante | ✅ cumple | El error imprime el `invariante` entero, con el párrafo `· PR 4 (#504, 2026-09-07): EL ARMA Y EL MÁXIMO DE VIDA DEL JUGADOR…`, qué era cada literal, dónde vive hoy, por qué volvería y qué sigue siendo del cliente |
| …y verde sobre el árbol de hoy, sin falsos positivos | ✅ cumple | `node --import tsx --test test/architecture.test.ts` → `ℹ tests 89 · pass 89 · fail 0`. El probe nuevo afirma además el negativo: leer del wire, el store de core y `params-de-telegraph.ts` NO infringen |
| Árbol limpio tras los sabotajes | ✅ cumple | `git status --porcelain` → 0 líneas tras restaurar cada uno (comprobado tres veces) |
| **Mutación**: entrada `params-de-telegraph` con `break: "sin medir"` | ✅ cumple | `mutation-targets.json`: `mutate: ["src/combat/params-de-telegraph.ts"]`, `tests: ["test/params-de-telegraph.test.ts"]`, `break: "sin medir"`, con `porque` que nombra los mutantes que importan (invertir el orden de las fuentes, quitar la caída a `unarmed`, tocar el `/2` o el radio, devolver un aro en vez de lanzar) |
| `npm run deuda` lo lista | ✅ cumple | `⚠️ sin medir 5 de 48 módulos (5 ficheros sin dato)`; `npm run mutacion -- pendiente` → `Se medirían 19 de 48 módulos · 1992 mutantes medidos antes + 5 módulo(s) sin base: politica-de-atlas, fusible-de-skins, gates-de-imagen, **params-de-telegraph**, frontera` |
| Sin la entrada, `npm test` cae «sin dueño» | ✅ cumple | Quitado el módulo (48→47) → `✖ cada fichero del perímetro puro tiene dueño: un módulo o una exención escrita` · `AssertionError: sin dueño en data/contract/mutation-targets.json: src/combat/params-de-telegraph.ts`. Devuelta; árbol limpio |
| Dos mutantes a mano y los tests caen | ✅ cumple | **(1) divisor del sintético** `spec.displayRange / 2` → `/ 3`: `ℹ tests 13 · pass 11 · fail 2` (`✖ el aro cubre [0, displayRange]…`, `✖ el catálogo de OTRO sistema…`). **(2) el arma ignorada** `config.weapons[armaId] ?? config.weapons["unarmed"]` → `config.weapons["unarmed"]`: `pass 9 · fail 4` (`✖ da EXACTAMENTE lo que el sim resuelve con esa arma`, `✖ el arma CAMBIA el aro…`, `✖ un arma que el config no conoce…`, `✖ el config MANDA sobre el catálogo`). Fichero restaurado byte a byte |
| **Rastros**: el cliente sin literales de arma | ✅ cumple | `grep -rnE 'short_sword\|getSelectedParams\|playerWeaponId\|playerMaxHp' nefan-html/src` → 10 líneas, **todas** lecturas del wire o del store: los dos campos del `FrameResult` (`:25-26`), `jugadorDeArranque` leyendo `store.state.player` (`:66-67`), la copia del `state_update` (`:114-115`), los dos `getCombatant` (`:198`, `:250`) y los dos usos de `result.playerMaxHp` en `main.ts` (`:724`, `:774`). Ni un literal de arma |
| …en `qa/` y `docs/arquitectura` | ✅ cumple | Solo el guion 84 (`ARMA_DEL_JUGADOR = "short_sword"`, que es su REFERENCIA declarada) y la fila 214 del README, reescrita para decir que desde #504 el arma viaja por el wire. `docs/arquitectura`: 0 |
| La cabecera del guion 22 ya no miente | ✅ cumple | Antes: «el arma que el cliente equipa SIEMPRE (`main.ts`: `playerWeaponId` es una constante…)». Hoy: «con la que nace el jugador (`store/game-store.ts`) y la que el bridge le dice al cliente en cada `state_update` desde #504». Diff de los guiones 22 y 84 = **solo comentarios**, ni un aserto tocado |
| **Flujo real**: partida, barra 1..5, LMB, aro = core, HP máximo en el HUD | ✅ cumple | Guion **89** sobre `e2e-sin-creditos`: `wire: playerHp=100 playerMaxHp=100 playerWeaponId="short_sword"`; `✔ los cinco aros son los que core calcula para short_sword`; `✔ el jugador entero: la barra está llena…`. Capturas en `qa/capturas/2026-09-07T13-30-35-538Z-295110/` |
| **El arma cambiada en el SIM llega al cliente y el aro cambia** | ✅ cumple | Cambiada la ÚNICA fuente del literal (`nefan-core/src/store/game-store.ts` → `weapon_id: "war_hammer"`, `max_hp: 150`; workaround W1, restaurado) y corrido el 89 sin tocar una línea del cliente: `wire: playerHp=100 playerMaxHp=150 playerWeaponId="war_hammer"` y los cinco aros salieron los del martillo (`quick 1.8 · heavy 2.5 · medium 2 · defensive 1.4 · precise 1.9`), con la barra en `66.6667%` y el número `100`. Es exactamente lo que #504 pedía y lo que hace cerrable el issue |
| …y sin tocar el sim, por el wire (el camino que usará el plugin) | ✅ cumple | Guion 89 bloques 3 y 4: `✔ el aro SIGUE al arma del wire: los cinco son los de war_hammer`; `✔ y ninguno de los cinco coincide con el de la espada`; `✔ el ALCANCE dibujado también cambia con el arma` (borde lejano 3,2 m → 4 m); `✔ la barra divide por el máximo que viaja (150)`; y el control `✔ al volver el arma del bridge, los cinco aros vuelven con ella` |
| Guiones verdes sin retocar ninguno; batería completa | ✅ cumple | **`88 en verde · 0 en rojo de 88`** a la primera, con el 89 dentro y sin repetir ninguno (§5). Los cinco del arma/aro (03, 22, 23, 41, 84) verdes |
| Deuda sin crecer, `verify` verde | ✅ cumple | `npm test`: `ℹ tests 2276 · suites 415 · pass 2276 · fail 0`. `npm run crap -- --check`: `1285 funciones medidas · cobertura de líneas 89.2% · … Tope (no empeorar): CRAP ≤ 73 — 0 por encima · ✔ dentro de los umbrales`. `npm run deuda`: `Deuda PARCIAL — 82 items de 2 de 3 fuentes`, los mismos 82 que declaran las PR 1-3 sobre esta base. Cliente: `TSC_OK`, `eslint .` sin salida, `✓ built in 1.46s` |
| `client-file-size.json` intacto | ✅ cumple | `main.ts` sigue en **1417** líneas exactas, que es su cifra congelada; el JSON no cambia y `npm test` (que lo vigila) está verde |
| Lo que pedía el issue #504 | ✅ cumple | Sus tres peticiones literales: que el arma viaje en el wire ✅; `grep` de `short_sword` en `nefan-html/src` a cero + regla `text` ✅; «un guion que cambie el arma **por el hook del banco** y mida el aro» → guion **89**, que la cambia por el `onmessage` del socket porque el hook no tiene esa palanca (`grep -n "weapon\|arma" nefan-html/src/dev/nefan-hook.ts` → 0) y `weapon_changed` no tiene productor. El espíritu se cumple; el matiz queda escrito en la cabecera del guion |

## 2 · Las cuatro comprobaciones que pedía el encargo

**(a) Los +16 del cliente: ¿queda decisión?** No queda regla de juego, y lo que queda es defendible, pero **no es
todo transporte**: hay tres decisiones pequeñas, ninguna nueva ni ninguna que cambie lo que pasa.

- `main.ts:364` `const armaDelJugador = () => gameClient?.getCombatant("player")?.weaponId ?? "";` — el `?? ""` es
  una decisión del cliente («todavía no sé»), pero está bien colocada: el SIGNIFICADO de `""` lo decide core
  (`paramsDeTelegraph` cae a `unarmed`), y el cliente no nombra ningún arma. Correcto.
- `game-client.ts:66-67` `jugadorDeArranque(store)` — lee del store en vez de escribir literales, que es lo que
  pedía el plan; sigue siendo la decisión «antes del primer frame se pinta el jugador de arranque», idéntica a la
  de la base (que era la constante). Sin literal y con el doc puesto.
- `game-client.ts:104,220` `playerHp: 100` — el HP inicial del frame neutro **sigue siendo un literal del cliente**
  y no lo cubre ningún token de la regla (H4). Preexistente, no lo toca esta PR, pero convive raro con un helper
  que sí saca del store el máximo y el arma.

El resto de las líneas son forma del `FrameResult`, dos copias del `state_update` y comentarios. **Las líneas de
DECISIÓN se fueron**: `grep` de los cuatro tokens en `nefan-html/src` + `nefan-core/bridge` = 0, y el aro entero
(dos fuentes, caída a `unarmed`, sintéticos y el lanzar) está en core.

**(b) La desviación del `ViewerGameClient` (`unarmed` → `short_sword`): ¿invisible?** Sí, invisible para quien
juega, comprobado por los dos lados:

- **Quién lee ese campo**: `grep -rn "getCombatant" nefan-html/src` → dos lectores, `main.ts:364` (el HUD, para el
  aro) y `main.ts:544` (el respawn, que solo mira `health`). Nadie más.
- **Qué valor sale**: el mismo que en la base. En la base el HUD recibía la constante `playerWeaponId =
  "short_sword"`, y hoy pregunta al `ViewerGameClient`, que devuelve `store.state.player.weapon_id` de un
  `GameStore` recién construido (`createViewerClient()` = `new ViewerGameClient(new GameStore())`), o sea
  `short_sword`. El `unarmed` que devolvía antes no lo leía nadie: si se hubiera CONSERVADO, el aro habría pasado
  de 1,3 a 1,2 m — la desviación **evita** un cambio de conducta, no lo introduce.
- **Y medido en el preset**: `NEFAN_PORT_OFFSET=500 ./start.sh --preset html-fixtures`, sonda propia sobre
  `puerto_tile` (cerrando el muro de «sin conexión» por su botón, que es el camino del jugador): las cinco teclas
  + LMB **no abren ningún episodio de telegraph** (`aro null` en los cinco), porque el aro nace del evento
  `attack_started` del SIM (`ui/eco-del-combate.ts:72`) y sin bridge no llega ninguno. O sea: en `html-fixtures`
  **no se pinta aro**, así que ese campo no lo mira nadie ni siquiera de rebote. Matiz al informe del ingeniero
  (§6): «el aro de las fixtures es el de siempre» es cierto pero vacío — no hay aro. Conclusión igual: invisible.
- Candado headless `NEFAN_PORT_OFFSET=500 node qa/fixtures-sin-bridge.mjs` → `✔ html-fixtures pinta sin backend`
  (frames 8 → 98, `tile_0_0`, 6 billboards, muro «Sin conexión con la partida» como debe). Cero errores de página.

**(c) ¿Queda gate para un `state_update` sin `playerWeaponId`?** **No, y el modo de fallo es silencioso** (H1). El
plan se equivocaba y el ingeniero lo corrigió bien: `src/protocol/message-schema.ts` es el espejo zod del canal
cliente→bridge; servidor→cliente solo está tipado. Lo que hay:

- **En el bridge, el tipo sí sujeta**: quitado `...estadoDelJugador(ctx)` del cuarto emisor, `npx tsc --noEmit` →
  `bridge/handlers/simulation.ts(276,9): error TS2739: … is missing the following properties from type
  'StateUpdateMessage': playerMaxHp, playerWeaponId`. Ningún emisor del bridge puede olvidarlos.
- **En el cliente no hay nada**. Medido con una sonda que BORRA los dos campos de cada `state_update` entrante
  (mismo `onmessage` que usa el bridge): la barra de vida se **congela** —`style.width = "NaN%"` es CSS inválido,
  así que el navegador conserva el último ancho: puesta a mano en `12%`, tras 1,5 s de frames sigue en `12%`—, el
  aro pasa de 1,3 a **1,2 m** (manos desnudas, por el `?? ""`), y el registro de errores del cliente dice
  `["— sin errores —"]`. Cero `errors.push`, cero aviso.
- Emisores posibles que no pasan por el tipo: `labs/narrative/replay-server.mjs` reenvía `state_update` **grabados**
  (`BROADCAST_TYPES`), así que un log anterior a hoy reproduce sin los campos. No hay `runs/` en el árbol para
  ejercerlo → §4 «no probado».

**(d) El test de los cuatro emisores, ¿cae si uno deja de llamar a `estadoDelJugador`?** Sí. Saboteado el emisor
que el ingeniero NO probó en su informe (`handleAddCombatants`, el cuarto), sustituyendo el helper por los valores
de arranque escritos a mano (`playerMaxHp: 100, playerWeaponId: "short_sword"`):
`✖ add_combatants los emite tal como están en el store` · `ℹ tests 18 · pass 17 · fail 1`. El test funciona porque
mueve el store ANTES de rutear (`war_hammer`, 77) — el defecto que el propio ingeniero documenta en su §4 está
cerrado, y lo comprobé sobre el emisor que él no tocó.

## 3 · Hallazgos

Ninguno bloqueante.

1. **(importante · de la PR, con raíz preexistente)** — **El cliente depende de dos campos del wire que nadie
   valida, y su ausencia degrada en silencio.** Reproducción desde el arranque: `./start.sh --preset
   e2e-sin-creditos`, partida nueva, y un `state_update` sin `playerMaxHp`/`playerWeaponId` (hoy solo alcanzable
   por el replay-server con un log viejo o un bridge de otra versión; la sonda lo simula por el `onmessage` del
   bridge). Lo que el jugador ve: la barra de vida **deja de moverse** (queda en el último ancho válido) y el aro
   del telegraph encoge a manos desnudas (1,3 → 1,2 m), sin una línea en el registro de errores. Lo que esperaría:
   o el fail-loud de la casa (`errors.push("net", …)`), o un default explícito. Antes de esta PR el fallo no
   existía porque los dos valores eran constantes del cliente. **Destino**: `net/game-client.ts` (una guarda al
   copiar el frame) o el zod que hoy no cubre el canal servidor→cliente; el ingeniero ya lo anota en su §10 como
   «agujero del canal», pero sin medir que la barra se congela.
2. **(menor · preexistente, ahora más visible)** — **`getCombatant` del ENEMIGO sigue mintiendo**:
   `return { health: e.hp, maxHealth: e.hp, weaponId: "unarmed" }` (`game-client.ts:201`), es decir el máximo del
   enemigo derivado de su vida actual — el defecto exacto que #326 arregló en el otro canal. Hoy no lo lee nadie
   (el HUD de enemigos usa `mundo.enemigos`, que trae `maxHp` del wire), pero la mitad del player acaba de pasar a
   ser leída por el HUD, así que la próxima barra que alguien monte sobre este método hereda el bug. Además, el
   informe de implementación (§10) dice que queda dicho «en el comentario del fichero» y **no hay tal comentario
   en la línea del enemigo**: el que hay habla del player. **Destino**: nota en #504 al cerrarlo, o issue propio.
3. **(menor · experiencia, habilitada por la PR)** — **Con un máximo distinto de 100 el HUD queda ambiguo**: la
   barra se pinta a 66,7 % y al lado el número dice `100` (captura
   `…-04-aro-y-barra-con-el-arma-que-dice-el-bridge.png`). Mientras el máximo fue una constante de 100, «barra
   llena ⇔ 100» era cierto; esta PR hace posible el estado en el que el número ya no dice sobre cuánto. Un
   `100/150` (o el máximo en el rótulo) lo cerraría. No es regresión: hoy ningún reducer escribe `max_hp`.
4. **(menor · preexistente)** — **El HP inicial del frame neutro sigue siendo un literal del cliente**
   (`playerHp: 100` en `BridgeGameClient.lastState` y en `ViewerGameClient.frame`), justo al lado del helper que
   saca del store el máximo y el arma, y la regla `text` no lo ve (sus tokens son `playerMaxHp = \d` y
   `maxHealth: 100`). Si el jugador naciera con `hp` distinto de 100 en el store, el cliente pintaría 100 hasta el
   primer frame. **Destino**: `jugadorDeArranque` podría devolver también `playerHp: store.state.player.hp`.
5. **(menor · observación sobre el candado, sin acción)** — Los tokens del grupo son los literales EXACTOS del día
   del movimiento (`\bshort_sword\b`, `playerMaxHp\s*=\s*\d`, `maxHealth:\s*100`, `displayRange\s*/\s*2`): quien
   reescriba la copia con `maxHealth: 90` o con una constante intermedia no la dispara. Es el molde declarado de
   `campos-retirados-no-vuelven` y el `why` lo dice; queda anotado para que no se lea como cobertura total.

## 4 · Workarounds usados y no probado

**W1 · Cambiar el arma «en el sim» editando `nefan-core/src/store/game-store.ts`** (`weapon_id: "war_hammer"`,
`max_hp: 150`), corriendo el 89 y restaurando (`git status --porcelain` → limpio). **Veredicto: no afecta al
usuario, y es un hallazgo del estado del juego, no de la PR** — no existe hoy NINGÚN camino por el que el jugador
cambie de arma: `weapon_changed` no tiene productor, ninguna consequence lo emite, el State API solo deja escribir
`gold/health/level/inventory` del NarrativeState (`plugins/dispatcher.ts`, `PLAYER_WRITABLE`) y el save ni siquiera
persiste el arma ni el máximo (viven en el `GameStore` del bridge, volátil). El plan ya lo declara como backlog (d)
y el ingeniero como hallazgo no arreglado. Tocar la fuente del literal fue la única forma de ejercer la cadena
entera bridge→wire→cliente.

**W2 · Entregar/reescribir `state_update` por el `onmessage` del socket** (guion 89 y sonda de H1). No es un
escenario preparado: es el mismo seam por el que entra el mensaje del bridge y con la forma exacta del contrato;
sin productor de `weapon_changed` es la única entrega posible. La cabecera del guion lo dice y anuncia que cuando
exista el productor se cambia la entrega sin tocar los asertos.

**No probado**

- **La mutación de `params-de-telegraph`**: `break: "sin medir"` hasta la corrida autorizada. `npm run mutacion --
  local params-de-telegraph` se niega (coste desconocido), que es lo esperado. Maté dos mutantes a mano; no es lo
  mismo que medir.
- **El replay-server con un log anterior a #504**: no hay `runs/` en el árbol, así que el modo de fallo de H1 por
  ese camino queda razonado (el reenvío de `state_update` grabados está en `replay-server.mjs:88`) pero no
  ejercido.
- **Un `max_hp` distinto de 100 producido por el JUEGO**: ningún reducer lo escribe; solo un parche de plugin. Lo
  medí por el wire (89) y con W1, no con un plugin real.
- **Créditos**: cero en toda la verificación (`e2e-sin-creditos`, `charMode: "vector"`, guardarraíl del runner
  `cliente y bridge declaran fake:true` en cada guion). Gasto de sesión en pantalla: `0,00 €`.

## 5 · Guion nuevo, batería y verificación

### El guion 89 (sin commit, en el árbol)

`qa/guiones/89-el-arma-y-el-maximo-los-dice-el-bridge.mjs` + su fila en `qa/README.md`. Mide la frontera que movió
la PR, que es justo lo que el 84 no puede medir (afirma los aros con el arma FIJA de arranque: si el cliente
volviera a inventársela, el 84 seguiría verde). Cuatro bloques:

1. **El dato viaja**: el `state_update` REAL del bridge trae `playerMaxHp` y `playerWeaponId` (`wire: playerHp=100
   playerMaxHp=100 playerWeaponId="short_sword"`). Sin este bloque, los demás medirían un cliente que sigue a
   cualquier cosa inyectada aunque el bridge no mandara nada.
2. **Con el arma de arranque**: los cinco aros = `getEffectiveParams` de core con `short_sword`; barra llena.
3. **El bridge dice `war_hammer` y 150**: los cinco aros pasan a los del martillo y **ninguno** coincide con el de
   la espada; el alcance dibujado se alarga (borde lejano 3,2 → 4 m, con foto del aro vivo de las dos armas); la
   barra de un jugador entero deja de estar llena (66,67 %) y el número sigue siendo la vida.
4. **Control**: al volver el arma del bridge, aros y barra vuelven con ella — sin esto, «sigue al wire» y «se quedó
   con el último aro» serían el mismo verde.

Salida (corrida suelta, `node qa/run.mjs 89`): `1 en verde · 0 en rojo de 1 · capturas en
qa/capturas/2026-09-07T13-30-35-538Z-295110`, con `✔ el aro SIGUE al arma del wire: los cinco son los de
war_hammer`, `✔ el ALCANCE dibujado también cambia con el arma (espada {"cerca":0.2,"lejos":3.2} · martillo
{"cerca":1,"lejos":4})` y `✔ la barra divide por el máximo que viaja (150)`.

**PROBADO EN NEGATIVO, un sabotaje por vez y restaurado byte a byte:**

| Sabotaje | Qué pasa |
|---|---|
| `getCombatant("player")` de `net/game-client.ts` vuelve a inventar el arma (`weaponId: "short_" + "sword"`) | `✘ el aro SIGUE al arma del wire — quick 1.3/1.8 · heavy 1.7/2.5 · medium 1.7/2 · defensive 1/1.4 · precise 1.5/1.9` y `✘ y ninguno de los cinco coincide con el de la espada — quick 1.3→1.3 · …`; el control y la barra siguen verdes (el sabotaje es solo del arma) |
| La barra vuelve a dividir por 100 (`result.playerHp / (50 + 50)`) | `✘ la barra divide por el máximo que viaja (150) — ancho 100% · esperado ≈ 66.66666666666666% (hp 100)`; los aros siguen verdes |
| El arma cambiada en el SIM (`game-store.ts` → `war_hammer`/150, W1) | El bloque 1 cae DICIENDO la evidencia: `wire: playerHp=100 playerMaxHp=150 playerWeaponId="war_hammer"`, `✘ los cinco aros son los que core calcula para short_sword — quick 1.8/1.3 · heavy 2.5/1.7 · …`, `✘ el jugador entero: la barra está llena — {"ancho":"66.6667%","texto":"100"}`. Es el guion contando que la cadena sim→wire→cliente funciona entera |

Un error propio que el negativo cazó y está corregido en el guion: la foto del aro vivo dejaba el ataque en curso
y el siguiente LMB no abría episodio nuevo (`quick null`), porque el episodio nace en el flanco null→aro. El guion
espera ahora a que el aro se apague antes de seguir; sin esa espera, un aserto medía un reloj y no el aro.

### Batería completa, sin retocar ningún guion

```
88 en verde · 0 en rojo de 88 · capturas en /home/al/code/ne-fan-241-4-qa/qa/capturas/2026-09-07T13-33-17-976Z-299512
```

A la primera y sin repetir ninguno: esta vez ni siquiera apareció la intermitencia del guion 80 (#496/#467) que
QA anotó en las PR 1-3. Los cinco guiones de la pieza (03, 22, 23, 41, 84) verdes, y el 89 dentro de la batería.

### Verificación de core y del cliente

| Comando | Salida |
|---|---|
| `npm test` (nefan-core) | `ℹ tests 2276 · suites 415 · pass 2276 · fail 0` |
| `npm run coverage && npm run crap -- --check` | `1285 funciones medidas · cobertura de líneas 89.2% · complejidad máxima 46` · `Tope (no empeorar): CRAP ≤ 73 — 0 por encima` · `✔ dentro de los umbrales`. El módulo nuevo: `FNF:2 FNH:2 · BRF:8 BRH:8` en `lcov.info` (funciones y ramas al 100 %; el `64.81 %` de líneas del resumen son las 19 líneas de comentario de cabecera e imports de tipo, que V8 no ejecuta) |
| `npm run deuda` | `Deuda PARCIAL — 82 items de 2 de 3 fuentes` (13 fronteras + 11 CRAP + 58 supervivientes): los mismos 82 de la base |
| `npm run mutacion -- pendiente` | `… + 5 módulo(s) sin base: politica-de-atlas, fusible-de-skins, gates-de-imagen, params-de-telegraph, frontera` |
| `npx tsc --noEmit` · `npm run lint` · `npm run build` (nefan-html) | `TSC_OK` · `eslint .` sin salida · `✓ built in 1.46s` (el aviso de chunk > 500 kB es el de siempre) |
| `node qa/fixtures-sin-bridge.mjs` (offset 500) | `✔ html-fixtures pinta sin backend` |

### Crítica visual (capturas del 89, `qa/capturas/2026-09-07T13-30-35-538Z-295110/`)

- **`01-aro-vivo-espada`**: el arco del telegraph se lee bien sobre el suelo del tile — rojo saturado en el borde,
  interior tenue, y el borde lejano cae a media pantalla (3,2 m). Coherente con el HUD: barra llena, `100`.
- **`03-aro-vivo-martillo`**: el mismo ataque con el arma que dice el bridge — el aro es visiblemente **mayor y
  más lejano** (llega al umbral del edificio, 4 m) y aparece el hueco delante de los pies (borde cercano 1 m, el
  martillo no llega de cerca). Se distingue de un vistazo del anterior, que es lo que el jugador necesita: el aro
  no adorna, informa de dónde ponerse.
- **El punto flojo, y es de HUD, no de esta PR**: en la captura con máximo 150 la barra está a dos tercios y el
  número al lado dice `100` (H3). Mientras el máximo fue una constante, «barra llena ⇔ 100» era cierto; ahora que
  el máximo puede viajar, el número solo tiene sentido con su denominador.
- Preexistente y sin relación: el registro de combate (esquina inferior izquierda, texto verde) se lee mal sobre
  el suelo verde del tile, y la barra de ataques queda parcialmente bajo él.

## Nota del coordinador al incorporar el informe (2026-09-07)

H1 resuelto en la rama por el coordinador con una guarda fail-loud en el `state_update` de `net/game-client.ts`: si faltan
`playerMaxHp`/`playerWeaponId`, `errors.push("bridge", …)` y se conserva el último frame bueno (nada de `NaN%` en silencio). No es
lógica de juego: es el canal de error del cliente. H2 → issue propio (el `getCombatant` del enemigo miente y el comentario que el
informe decía haber dejado no existe); H3 → issue propio (HUD ambiguo con máximo ≠ 100); H4/H5 anotados sin acción.
