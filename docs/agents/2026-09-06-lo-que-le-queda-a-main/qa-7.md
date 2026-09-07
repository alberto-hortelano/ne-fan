# QA — corte 7 de #358: el HUD de combate sale de `main.ts` a `ui/hud-de-combate.ts`

**Veredicto: APTO CON HALLAZGOS.** El corte es un movimiento y no un cambio: las 43 líneas de sentencia del bloque
en la base `4169c08f` (`const config` `:83`, `const attackBar` `:360-361`, el oyente `:479`, el bloque «Sistema de
combate de la sesión» `:485-515` y `getSelectedParams` `:702-726`), normalizadas sin comentarios y con los renombrados
que declara el informe (`attackCatalog → catalogoDeAtaques`, `sessionCombatSystemId → idDelSistema`,
`renderAttackBar → pintarBarra`, `applySessionCombatSystem → aplicarSistema`, `getSelectedParams →
parametrosSeleccionados`, `attackBar → barra`, `input → deps.input()`, `playerWeaponId → deps.armaDelJugador`, `log →
deps.log`), son EXACTAMENTE las que hay dentro de `crearHudDeCombate`: el `diff` de los dos conjuntos ordenados solo
enseña la firma de la fábrica, el objeto que devuelve (`barra, aplicarSistema, parametrosSeleccionados, catalogo,
sistemaId`), el alias `const input = deps.input()` y el `if (id) log(...)` partido en tres líneas. En el juego, con
cero créditos y **teclado y ratón reales** (sin `?input=scripted`), todo lo que el HUD promete se recorre desde el
título: la barra nace con el catálogo estándar antes de que exista sesión; con `alta_fantasia` cinco botones
`1 Quick … 5 Precise`, cada tecla 1..5 elige el de su posición, 6/9/0 no cambian nada, el click en «Medium» elige por
el mismo camino, el click en el mundo captura el ratón y LMB ataca con el aro del ataque ELEGIDO (óptima 1,7 m con
«heavy», 1,3 m con «quick»: las cifras de `getEffectiveParams` de core para `short_sword`) y el bandido pierde vida
(60 → 47 → 31); con un juego `basic` fabricado a mano la barra se REPINTA en la misma página de 5 a «1 Golpe», las
teclas 2..5 dejan de hacer nada, el aro lleva los params sintéticos (1,0 m) y el golpe quita 15 fijos; reanudar cada
una de las dos partidas repinta la barra con el sistema congelado en el save; un juego con `systems.combat =
"noexiste"` no arranca y el jugador vuelve al título con el aviso, sin que la barra se quede vacía. `verify` 2.183/0,
`tsc`/`lint`/`build` verdes, trinquete exacto (1653), 10 `let`, módulo de 122 líneas, cero rastros de lo movido, los
19 guiones de la red y la batería completa sin retocar ninguno. **Los hallazgos no son del corte**: el arma del
jugador es una constante del cliente repetida dos veces (una de ellas muerta) mientras core tiene un reducer para
cambiarla que nadie despacha; el mensaje al jugador ante un sistema de combate desconocido dice «datos dañados»; y
dos observaciones de UX de la barra que ya estaban.

Worktree `/home/al/code/ne-fan-358-7-qa`, commit `bfcfca9f` sobre `4169c08f` (sin el corte 6, que va en paralelo).
Stack propio: `NEFAN_PORT_OFFSET=500 NEFAN_GAMES_DIR=<scratchpad>/qa7/games NEFAN_SAVES_DIR=… NEFAN_LOG_DIR=…
./start.sh --preset e2e-sin-creditos` → fake-ai `:19265`, bridge `:10377` (State API `:10378`), cliente `:3500`
(`ss -ltn` antes: solo 22/53/80/631/3636; `pgrep -af qa/run.mjs`: ninguna batería ajena). Parado con
`NEFAN_PORT_OFFSET=500 ./start.sh --parar` → `✅ stack cleaned` ANTES de correr el runner. Sonda propia
`<scratchpad>/qa7/ojos-qa-7.mjs` (salida en `ojos.log`, capturas en `qa7/capturas/`).

## 1 · Criterios de aceptación (de `requisitos.md` + el encargo del coordinador)

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento**: lo que sale de `main.ts` entra en el módulo sin cambiar de comportamiento | ✅ cumple | Diff normalizado del bloque (`sed -n '83p;360,361p;479p;485,515p;702,726p'` de la base vs `sed -n '20p;49,122p'` del módulo, comentarios fuera, renombrados aplicados, ordenado): 43 vs 55 líneas y las 12 de más son la firma, el `return {…}`, el alias `input` y el `if (id) {` partido. `git diff 4169c08f bfcfca9f -- main.ts`: −70/+11. Cero lógica nueva |
| La barra lleva el catálogo de la sesión estándar (5), `1..5` seleccionan, click en botón selecciona, LMB ataca y el enemigo pierde vida con el aro del ataque elegido | ✅ cumple | Sonda B (teclado real): `catálogo ["quick","heavy","medium","defensive","precise"] · sistema "standard" · botones ["1:Quick*",…,"5:Precise"]`; teclas 5→1: `[{"tecla":5,"activo":"attack:precise","elegido":"precise"},…]`; click en `[data-action="attack:medium"]` → `medium` elegido y activo; LMB con «heavy»: `aro 1.7 · core 1.7 · windup 29 f`, vida `60 → 47 en 1 click`; con «quick»: `aro 1.3 · core 1.3`, `47 → 31`; registro `["bandido_1 hit: -15.4 HP","Player hit: -13.5 HP",…,"bandido_1 hit: -13.7 HP"]`. Guion 84 repite los cinco aros contra core |
| Tecla fuera del catálogo (6, 9) | ✅ cumple | Sonda B: `6/9/0 → quick → quick · activos ["attack:quick"]`; sonda C con `basic`: `2/3/5 → strike → strike`. `setAttackBindings` reemplaza `attackKeys` entero (`Object.fromEntries`, `keyboard-input-provider.ts:147-149`): el mapeo viejo no sobrevive |
| Cambio de sesión: la barra se repinta con el catálogo nuevo | ✅ cumple | Sonda C: la página nace con 5 (título) y al entrar en `alta_basica` la barra es `["1:Golpe*"]`, `combatSystem "basic"`, proveedor con `strike` elegido, registro «Combate: basic (1 ataque)». Sonda D: reanudar `alta_basica` → 1 botón «Golpe»; reanudar `alta_fantasia` → 5. El camino A→B SIN recarga en la misma página solo existe vía muro con «Volver al título» (`volverAlTitulo` → `session.leave()`), no probado aquí (§5) |
| Sistema `basic`: un botón «Golpe» | ✅ cumple | Juego `alta_basica` fabricado en el scratchpad (copia de `alta_fantasia` con `systems: {combat: "basic"}`): `catálogo ["strike"] · botones ["1:Golpe*"]`; LMB `60 → 45 en 1 click` (−15,0 lo pone `BasicCombatSystem` en el sim); aro `optimalDistance 1` = `displayRange/2`. Captura `C-barra-golpe.png` |
| **Desviación (a)**: `config` cargado dentro del módulo, sin duplicar la carga | ✅ cumple | `grep -rn "loadConfig(" nefan-html/src` → **solo** `ui/hud-de-combate.ts:20`. `combat_config.json` se IMPORTA en dos ficheros (`main.ts:66` para `playerCfg` → `SPEED`, como en la base, y el módulo), pero es el mismo módulo ES (una instancia) y `loadConfig` se ejecuta una vez. Sin lector de `config` en `main.ts` (medido: el resto son la palabra en strings) |
| **Desviación (b)**: `pintarBarra()` fuera de la API por TDZ con `onAttackTypeChanged` síncrono; orden correcto al arrancar y al cambiar de sistema | ✅ cumple | `KeyboardInputProvider.setAttackBindings` (`:144-152`) llama `selectAttack(attackIds[0])` → `this.onAttackTypeChanged?.(typeId)` SÍNCRONO; el scripted igual (`:77-82`). Reproducido en Node con el mismo esqueleto: cablear `() => hud.pintar()` antes de `const hud = crear()` → `ReferenceError: Cannot access 'hud' before initialization` desde `setAttackBindings`. En el módulo el oyente se instala `:112` ANTES de `aplicarSistema("")` `:113`: mismo orden que la base (`:479` antes de `:515`). Orden observado: al título la barra ya tiene 5 con «quick» activo (sonda A y guion 84); al entrar en `basic` la barra pasa a 1 y el proveedor a `strike` en la misma llamada |
| **Lógica en el cliente**: hallazgo 1 del ingeniero (arma) y búsqueda de otra | ✅ medido (hallazgos H1, H2 en §2) | Ver §2. Nada nuevo del corte: el movimiento hace explícita la dep `armaDelJugador` |
| Cero rastros de lo movido fuera del módulo (código, `qa/`, `docs/arquitectura/`, CLAUDE.md; salvo `docs/agents/`) | ✅ cumple | `grep -rnE "attackCatalog\|sessionCombatSystemId\|getSelectedParams\|setAttackBindings\|rebuildActionBar\|applySessionCombatSystem\|renderAttackBar"` en `*.ts *.mjs *.md *.json *.py *.sh *.js *.html *.css` sin `node_modules/dist/qa/.tmp/qa/capturas/docs/agents/` y sin el módulo: `sessionCombatSystemId`, `getSelectedParams`, `applySessionCombatSystem`, `renderAttackBar`, `rebuildActionBar` → **0**. Lo que queda es API que NO se movió: `setAttackBindings` es el método del `InputProvider` (`input-provider.ts:62`, sus dos implementaciones y `plugins.md:28`), y `attackCatalog` es el NOMBRE de la dep del hook (`nefan-hook.ts:81,193`), su cableado (`main.ts:1164`) y el campo `state().attackCatalog` que leen los guiones 03/10/22/23/43. Prosa reapuntada: `plugins.md:27`, `ui.md:35`, `mapa.md:68-69`, `nefan-hook.ts:77-79` (leído en el diff) |
| Trinquete: `client-file-size.json` = `wc -l main.ts` = 1653; 10 `let`; módulo ≤ 450 | ✅ cumple | `wc -l`: base 1712 → **1653** (−59); `grep -c '^let '`: 12 → **10** (`devMenu`, `graphicsChip`, `scenesMode`, `charactersMode`, `input`, `gameClient`, `lastRenderError`, `ratonCapturadoAntesDelDialogo`, `lastTime`, `tituloEnMarcha`); JSON `"lineas": 1653` con la frase de crónica del corte 7 al final del `porque`; módulo **122** líneas |
| `npm run verify` (2183) | ✅ cumple | `ℹ tests 2183 · pass 2183 · fail 0 · verify exit=0`; `nefan-html`: `TSC_OK · lint exit=0 · ✓ built in 1.52s · build exit=0` |
| Guiones de la red en verde sin retocarlos; batería completa | ✅ cumple | §4: guion 84 nuevo; batería completa al final sin retocar ninguno (§4) |
| Ningún fichero nuevo > 450; patrón `Deps…` + fábrica, getter para el `let` del bootstrap | ✅ cumple | `DepsDelHudDeCombate { input(): Pick<InputProvider,4>; armaDelJugador; log }`; `input` cruza como pregunta (`() => input`); `barra` expuesta con un lector (seam `attackBar.snapshot()`) |
| El comentario «Espejo de applyRenderModes» viaja al módulo y lo barre el corte 8 | ✅ cumple (deuda con dueño) | `hud-de-combate.ts:53`; `plan-8.md` §5 lo nombra. No es rastro de «antes vivía en»: nombra una función VIVA de `main.ts` |

## 2 · Hallazgos

**H1 · importante (no es de este corte; candidato a issue, destino core/bridge) — el arma con la que el cliente pinta el
aro es una constante suya, y core tiene un camino para cambiarla que el cliente no oiría.** Medido:
- `main.ts:398` `const playerWeaponId = "short_sword"` → dep `armaDelJugador` (`:481`) → `parametrosSeleccionados()` →
  el aro del telegraph (`EcoDelCombate.paramsDelAtaque`). Segunda copia: `net/game-client.ts:175` `weaponId: "short_sword"`
  en `getCombatant("player")` — y esa está **muerta**: su único lector (`main.ts:760`, `handleRespawnRequest`) lee solo
  `.health`.
- La fuente es core: `store/game-store.ts:25` `weapon_id: "short_sword"`; el bridge crea el combatiente `player` con
  `ctx.store.state.player.weapon_id` (`handlers/session.ts:262`). Existe el reducer **`weapon_changed`**
  (`store/reducers.ts:92`, con test `store-reducers.test.ts:120`) y **ningún productor lo despacha** (`grep -rn
  weapon_changed nefan-core nefan-html/src` → solo el reducer y su test).
- El wire no lleva el arma del jugador: `StateUpdateMessage` (`protocol/messages.ts:296`) trae `playerHp` y los
  `enemies` (esos sí con `weaponId` en `load_room`/`add_combatants`), nada del arma propia.
- **Hoy no hay discrepancia observable** porque nadie cambia el arma: `armaDelJugador` = `weapon_id` del sim por
  coincidencia de dos literales. El día que un plugin despache `weapon_changed` (`war_hammer`), el sim pegará a 1,8 m
  óptimos con «quick» y el aro seguirá dibujando 1,3 m (`getEffectiveParams`: espada 1,3 / martillo 1,8; heavy 1,7 /
  2,5) sin que nada lo diga — la forma silenciosa. Camino que falta: el `weapon_id` del jugador en `session_started`/
  `state_update` y la dep del HUD como pregunta (`armaDelJugador(): string`), no como valor congelado al arrancar. El
  corte no podía hacer más que dejar la dep explícita; lo hizo.

**H2 · menor (no es de este corte) — la geometría del aro para ataques fuera de `combat_config.json` la inventa el
cliente.** `parametrosSeleccionados` `:99-106` deriva `optimal_distance = displayRange/2`, `distance_tolerance =
displayRange/2`, `area_radius = displayRange` de un `AttackSpec` que solo declara `displayRange`. Es presentación (el
sim de `basic` acierta con `d <= STRIKE.displayRange`, y el aro cubre `[0, displayRange]`: casan por construcción), pero
la REGLA de cómo se convierte un spec en aro vive en el cliente y no en core. Si un tercer sistema (`shooting`, cono
frontal) quiere otro aro, hoy tiene que tocar el cliente. Destino: un ayudante de core junto a `AttackSpec`
(`paramsDeTelegraph(spec)`), programa de plugins. Movido verbatim; anotado, no reubicado (regla del encargo).

**H3 · menor (no es de este corte; destino `status-motivo.ts`/bridge) — un sistema de combate desconocido se le cuenta
al jugador como «datos dañados».** Juego `alta_rota` (`systems.combat: "noexiste"`): el bridge rechaza en
`session.ts:387` con `sistema de combate desconocido "noexiste" (esperaba standard|basic|shooting)` (bridge.log:29) y
el cliente vuelve al título con el aviso rojo **«No se pudo empezar la partida. Los datos de ese mundo están dañados y no
se pueden leer.»** (captura `E-alta-rota.png`); el detalle preciso solo está en `#error-log` (`game_load_failed: …`).
Para un jugador que acaba de subir su mundo con un `systems.combat` mal escrito, «dañados y no se pueden leer» no le
dice qué corregir. Lo bueno, y esto sí es del corte: la barra sigue con el catálogo estándar (5) y no hay `pageerror`;
`aplicarSistema("noexiste")` **no es alcanzable** desde el cliente porque el bridge valida con el MISMO registro antes
de emitir `combat_system` (`session.ts:387,601`; también `game-gen.ts:180`).

**H4 · menor (UX pre-existente) — con el ratón capturado, el ataque activo es lo menos legible de la barra.** Captura
`84-…-02-tras-los-cinco-aros.png` (capturas de la corrida de QA, cuando el guion aún se llamaba 83) (y `B-tras-heavy.png`): `#game-ui[data-locked="true"] .nf-action { opacity: .75 }`
atenúa TODOS los botones, incluido el activo, justo en el único momento en que se pelea. El contorno naranja de
«5 Precise» sobre el camino gris apenas se distingue de los inactivos. `ui.md` lo documenta como «recordatorio de
teclas»; la observación es que el recordatorio de CUÁL está elegido es el que más se pierde. Destino: `game-ui.css`,
programa de UI; no de este corte.

**H5 · menor (layout pre-existente) — la última línea del registro de combate queda cortada por el borde inferior** a
1280×800 (`Combate: standard (5 ataques)` medio visible en todas las capturas, mías y del ingeniero). No lo toca el
corte; la pinta `main.ts` con tope de 8 líneas.

**Ruido del banco, no hallazgo**: en mi sonda `#error-log` acumuló dos entradas `sprite` («skin IA cancelada en "walk"
… fake-ai: paladin no tiene sheet walk/frontal_8 (esperado en bench: el cliente cancela la cola de ese skin)») porque
anduve hasta el bandido y los NPC caminaron; el ingeniero, que se teletransportó, no las vio. Es el motor falso
declarando que no tiene esa hoja, no el HUD.

## 3 · Adversarial (§5 del encargo)

| Situación | Resultado |
|---|---|
| Catálogo vacío | **Inalcanzable**: `combatRegistry.create` devuelve 5 (`standard`, de `config.attack_types`), 1 (`basic`, `[STRIKE]`) o 1 (`shooting`, `[SHOOT]`); y los dos proveedores lanzan fail-loud con lista vacía (`keyboard-input-provider.ts:146`, `scripted-input-provider.ts:79`) |
| Sistema desconocido | El bridge lo rechaza antes (H3); en el cliente `combatRegistry.create` lanzaría `unknown combat system "…" (available: …)` DENTRO del sink `combat`, que corre en `apply()` de `createClientSession` (`session-facets.ts:210`) y dejaría sin aplicar los sinks posteriores (`history`, `entrada`, `dialogo`). Igual que en la base; sin camino real |
| Selección antes de que llegue el catálogo | No hay ventana: la fábrica instala el catálogo estándar al construirse (`aplicarSistema("")`) y `session.enter` es síncrono tras `startSession`. Con el título delante las teclas de ataque no entran (#285): sonda A y guion 84, tecla 3 → sigue `quick` |
| LMB sin objetivo | Sonda B: media vuelta y LMB → episodio de telegraph 3 completo, `vida 31 → 31`, sin `pageerror` |
| Dos sesiones seguidas con sistemas distintos | Sonda C/D: `"" → basic` en la misma página (5 → 1, teclas 2..5 muertas), `basic` y `standard` reanudadas tras recarga (1 y 5). `standard → basic` sin recarga solo por el muro con «Volver al título» — no probado (§5) |
| Sink `combat` referencia `hud` (`const`, línea 481) desde `createClientSession` (línea 170) | Sin TDZ: `createClientSession` no llama a ningún sink al construirse (solo en `enter`/`leave`, `session-facets.ts:202-233`), y el primer `enter` llega del título, mucho después |

## 4 · Guion y batería

**Guion nuevo** `qa/guiones/84-el-aro-y-las-teclas-son-los-del-catalogo-de-la-sesion.mjs` (+ fila en `qa/README.md`):
partida real con el proveedor de TECLADO (`url.searchParams.delete("input")`, patrón del 37/43); afirma la barra al
título, el gate #285, sistema/catálogo/botones/registro de la sesión, teclas 5..1, 6/9/0, click en botón, captura de
ratón + `data-locked`, y para CADA uno de los cinco ataques un LMB cuyo `telegraphEpisode.optimalDistance` casa con
`getEffectiveParams(tipo, short_sword)` de `nefan-core/dist` (sin `dist` → `⊘` con el remedio). `node qa/run.mjs 84`:
```
✔ 84-el-aro-y-las-teclas-son-los-del-catalogo-de-la-sesion
1 en verde · 0 en rojo de 1 · capturas en …/qa/capturas/2026-09-06T20-36-54-381Z-462636
```
**En negativo** (revertido con `git checkout --` después; `git status` limpio salvo el guion y el README):
- `armaDelJugador: "unarmed"` en `main.ts:481` → `✘ el aro de «quick» … aro 1.2 · core 1.3`, y los otros cuatro
  (`1.6/1.7`, `1.6/1.7`, `0.9/1`, `1.4/1.5`) → `0 en verde · 1 en rojo`.
- `key: String(i + 2)` en `hud-de-combate.ts:69` → `✘ un botón por ataque del catálogo, en su orden y con su tecla
  1..N — [["2","attack:quick"],…]` → `0 en verde · 1 en rojo`.

**Batería completa** (`node qa/run.mjs` entero sobre `bfcfca9f` + el guion 84; stack propio ya parado, `puertos antes:
22 53 80 631 3636`, `pgrep -af qa/run.mjs` sin batería ajena; el runner tomó el bloque 0):
```
✘ 80-el-desplegable-room-dice-lo-que-se-ve
81 en verde · 1 en rojo de 82 · capturas en …/qa/capturas/2026-09-06T20-38-09-099Z-464518
exit=1
```
Los 81 —los diecinueve de la red del ingeniero (03/10/22/23/41/42/43/44/45/46/52/57/62/69/70/71/73/77/78), el 02 y el 84—
en verde. El rojo del 80 tiene la firma EXACTA de `qa-5.md` §6 / H5 del ingeniero: sus diez asertos anteriores verdes y
`✘ …ni deja una entrada de error — 4 → 5` (el panel de errores de una página sin sesión gana una entrada de otro origen
del bridge compartido). No toca el HUD de combate, y suelto sobre el mismo commit:
```
node qa/run.mjs 80 → ✔ 80-el-desplegable-room-dice-lo-que-se-ve · 1 en verde · 0 en rojo de 1   (…T20-45-57…)
```
Puertos del catálogo después: ninguno (solo 22/53/80/631/3636). No se retocó ningún guion.

## 5 · Workarounds y no probado

- **Workaround (declarado, no afecta al jugador)**: `setYaw` del hook para encarar al bandido antes de andar y de cada
  LMB (misma técnica que `qa/lib/combate.mjs`); el paseo fue con la W REAL apretada (0,68 m y 0,88 m al llegar), no con
  `setPlayerPos`. `raf=timer` en la URL (pump del banco en headless). El juego `basic` no existe en `data/games/`: lo
  fabriqué en el scratchpad (hallazgo 3 del ingeniero, que comparto: si el programa de plugins quiere candado de
  navegador para `basic`, hace falta un juego de bench con ese sistema).
- **No probado**: `standard → basic` en la MISMA página sin recarga (solo vía muro + «Volver al título»; el candado del
  reemplazo del mapeo viejo lo cubre `"" → basic`); el sistema `shooting` (ningún juego lo declara; mismo camino
  `aplicarSistema`); el fail-loud `parametrosSeleccionados: attack '…' is neither…` (el proveedor solo elige ids del
  catálogo instalado); el `hud.parametrosSeleccionados()` con el arma cambiada (H1: no hay productor).
- El corte 6 no está en esta base: `ratonCapturadoAntesDelDialogo` sigue entre los 10 `let`; con el 6 rebasado encima
  quedarán 9 y ≈ 1.547 líneas (proyección del ingeniero, no medida aquí).

## 6 · Nota del coordinador al incorporar el informe (2026-09-07)

El guion nació como `83-…` en el worktree de QA (base sin el corte 6) y **choca con el 83 del corte 6** (la conversación),
fusionado mientras esta QA corría: entra en la rama como **`84-el-aro-y-las-teclas-son-los-del-catalogo-de-la-sesion`**,
con su fila en `qa/README.md` y las referencias de este informe renumeradas. El rojo del 80 en la batería es la
intermitencia con causa raíz en **#496** (el bridge del guion anterior difunde a una página sin sesión), verde suelto.
Destinos de los hallazgos: H1/H2 → **#504**, H3 → **#481**, H4/H5 → **#506** (los tres comentados el 06-09).
