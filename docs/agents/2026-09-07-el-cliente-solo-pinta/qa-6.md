# QA — PR 6 de #241: el parser del enemigo hostil sale del cliente a core

**Veredicto: APTO.** Es un movimiento con ocho cambios de conducta declarados, y los ocho van en la dirección
que dice el informe: el criterio de hoy es la UNIÓN de los dos de la base. Lo medí ejecutando **los dos criterios de
`3cd77d82` (copiados verbatim del árbol de la base) contra los dos vivos de hoy**, sobre 49 bloques `combat` —el
que deriva `combatForHostileRole` (que es el del bandido del motor falso, comprobado en partida), el herido y el
muerto de save, el save pre-#326, una personalidad con campo de plugin y 44 variantes rotas—: **17 casos cambian de
veredicto; 16 caen en las 8 familias declaradas y el 17.º no está declarado** (`move_speed: Infinity`, § H2: la fila 8
dice que `aggro_radius` es «la única que va más allá de la unión» y no lo es). **Ningún productor real emite nada de
lo que hoy se rechaza**: la única fuente de un bloque
`combat` es `combatForHostileRole` (censo completo en § 2c), las fixtures de `data/scenes/` no traen ni un `combat`,
`combat_config.json` no contiene ninguna `personality` —los presets viven en `difficulty-presets.ts`, que siempre
pone `combat_range: 4.0` y tres ataques— y el motor falso declara `role:"hostile"` a secas. La desviación de alcance
(unificar el bloque entero y no solo `personality`) es **verdadera sobre la base y necesaria**: comprobado con el zod
de `3cd77d82`, `health: 0`, `maxHealth: 0` y `weaponId: ""` pasaban el borde WS. El candado nace rojo con **las 12
violaciones exactas** que declara el informe y se pone rojo hoy con un token reintroducido; la entrada de mutación
está y sin ella `npm test` cae «sin dueño»; maté dos mutantes a mano y caen con 4 y 2 rojos. En el juego real, con
stack propio y cero créditos: el bandido pega y recibe daño, y **el mismo bloque roto da el mismo string en el
registro del cliente y en el log del bridge**. Guion nuevo **90**, verde, probado en negativo (5 rojos en las dos
orillas). Batería completa: **`88 en verde · 0 en rojo de 88`** a la primera, sin retocar ningún guion.

**El hallazgo que importa es de experiencia y la PR lo agranda sin decirlo (H1)**: cuando el rechazo ocurre en el
BRIDGE, el jugador no lee el motivo —ese se queda en el log del servidor— sino un **modal a pantalla completa
«Fallo interno del juego» que vela la partida hasta que lo cierra**, y se descarta el **frame entero** (todos los
enemigos del lote). Los seis casos de VALOR que el borde antes aceptaba en silencio hoy llegan a ese modal. El
cliente, con el MISMO criterio, descarta UN enemigo y sigue jugando: el veredicto y el motivo son uno, **el desenlace
no**. Hoy ningún jugador puede provocarlo (su cliente filtra antes con el mismo criterio); cualquier otro cliente
—que es el motivo declarado de #241— sí. Y queda un rastro de prosa de la propia PR (H3): `entidades-del-tile.ts:293`
sigue diciendo que «esa puerta es del cliente», en el mismo fichero cuya nota de `:139` sí se corrigió.

Worktree `/home/al/code/ne-fan-241-6-qa`, HEAD desprendido `81b6cf34` sobre `main` `3cd77d82`. Stack propio:
`ss -ltn` antes → 22/53/80/631/3636 y los bloques ajenos 0/+100/+300 (`:3200`, `:3500`, `:10077`, `:10377`, `:18965`,
`:19265`); `NEFAN_PORT_OFFSET=600 ./start.sh --preset e2e-sin-creditos` → fake-ai `:19365`, bridge `:10477` (State API
`:10478`), cliente `:3600`; parado con `NEFAN_PORT_OFFSET=600 ./start.sh --parar` → `✅ stack cleaned` enumerando y
**respetando** lo ajeno (`⏭ :9877 :9878 … — AJENO, no se toca`, `⏭ :3000 … ne-fan-241-4-qa`, `⏭ :18765`). Ningún
`pkill`, ningún `kill` por puerto, ningún uso del Playwright MCP compartido: ojos con sonda propia
(`playwright-core` de `qa/node_modules`) y los guiones con `qa/run.mjs`, que eligió su bloque (+100).

**Sobre `dist`**: el encargo pedía comparar «sobre `dist` de la base y de hoy». No es donde vive la verdad para este
módulo: el bridge corre con `tsx` sobre `src` y el cliente resuelve `@nefan-core/src/...` a los `.ts` fuente
(`nefan-html/vite.config.ts:84`, `tsconfig.json:13`), así que **el banco ejecuta `src` con `tsx`, que es exactamente
el código que corren las dos puertas**. `dist` no interviene.

## 1 · Criterios de aceptación

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **Es un movimiento**: el criterio del cliente entero, sin perder una comprobación | ✅ cumple | Diff línea a línea `enemigo.ts@3cd77d82` → `hostil-desde-combat.ts`: `esObjeto`/`numero` idénticos (`:57-70`); el orden health → max_health → weapon_id → personality intacto (`:142-176`); los tres números de la personalidad y `preferred_attacks` con los MISMOS textos de motivo; la reescritura del objeto conserva `...v` (los campos de un plugin sobreviven — probado: `personality.mi_campo = {a:1}` sigue aceptándose). El cliente queda con `errors.push` y la `Entity`: **150 → 98 líneas** (`wc -l`), `nefan-html/src` **14 202 → 14 150** (−52) en 57 ficheros, exactamente lo declarado |
| **Desviación de alcance (a)**: ¿el bridge aceptaba de verdad `health: 0`, `maxHealth: 0`, `weaponId: ""`? | ✅ verdadera | `git show 3cd77d82:…/message-schema.ts:41-53` → `health: z.number()`, `maxHealth: z.number()`, `weaponId: z.string()`, sin `.positive()` ni `.min(1)`. **Ejecutado**, no leído: con el zod de la base, `add_combatants` con `health: 0` → `acepta`; `maxHealth: 0` → `acepta`; `weaponId: ""` → `acepta`; `preferred_attacks: []` → `acepta`; `aggression: Infinity` → `acepta` (`z.number()` admite `Infinity`); `personality` sin `combat_range` → `acepta`. El cliente de la base rechazaba las seis. Unificar solo `personality` (lo que decía el plan) habría dejado tres campos con dos criterios |
| **Los 8 casos declarados (b)**: reproducidos uno a uno base↔hoy | ✅ cumple (17 filas, § 2a) | Banco de 49 bloques × 4 criterios (cliente base, bridge base, cliente hoy, bridge hoy) ejecutando el código real de cada lado. 17 cambian de veredicto: `health 0/-5/Infinity`, `max_health 0`, `weapon_id ""`, `combat_range` ausente, `preferred_attacks []`, `aggression Infinity`, `reaction_time Infinity` (bridge más estricto); `difficulty 5`, `aggression_style 7`, `block_chance "0.3"`, `preferred_distance null`, `attack_cooldown_mult "1"` (cliente más estricto); `aggro_radius "diez"` y **`move_speed Infinity`** (los dos más estrictos — el segundo no está declarado, H2). Ninguna otra diferencia |
| …y **ningún productor real** emite algo que hoy se rechace | ✅ cumple | `combatForHostileRole` (`combat/hostiles.ts:64-79`) es la única fuente, con `buildPersonality` (`difficulty-presets.ts:28-42`) poniendo SIEMPRE `combat_range: 4.0` y `preferred_attacks: ["quick","medium","heavy"]`; sus dos llamantes son `scene-normalize.ts:261` (escena) y `consequence-handler.ts:124` (spawn). `data/scenes/*.json`: 23 personajes, **ningún `combat`** y ningún `role:"hostile"`. `data/combat_config.json`: **ninguna `personality`** (solo `attack_types`, `weapons`, `tactical_matrix`, `player`, `animations`, `transitions`). `labs/narrative/fake-scenes.ts:252` y `fake-ai-server.ts:493` declaran `role:"hostile"` sin bloque. `ai_server/**` y `narrative-mcp/**`: cero ocurrencias de `personality`/`weapon_id`/`max_health`. Sí emiten bloques hoy rechazables **cinco fixtures de test del bridge**, pero saltan el borde (§ H6) |
| **`.superRefine` (c)**: qué ve el jugador con un error de TIPO | ✅ cumple, y medido | Los errores de TIPO los caza el `z.object` antes que el criterio, así que dan mensaje de zod: `enemies[0].health: Expected number, received string` (medido, `health:"60"`), `…maxHealth: Required`, `…weaponId: Expected string, received number`, y con `combat` ausente entero `enemies[0].health: Required (y 2 problema(s) más)`. Son **11 de 49 casos** en los que las dos puertas dan motivos distintos, todos de tipo/ausencia; en los 38 restantes el string es idéntico. Al JUGADOR, en las dos variantes, le llega el mismo texto genérico («El juego mandó un mensaje que el servidor no reconoce») y el mismo modal: el motivo, sea de zod o del parser, **no sale del log del servidor** (H1) |
| **La fixture de `message-schema.test.ts` (d)**: ¿sigue midiendo? | ✅ cumple | Los dos cambios son honestos. (1) La fixture de «un frame válido de cada tipo pasa» gana `combat_range: 4`: se acomodó al criterio nuevo, pero **el sujeto del test no cambia** (que un frame válido pase) y la definición de «válido» es justo lo que la PR mueve, declarado en un comentario de 5 líneas dentro del test. (2) «add_combatants con enemigo sin personality se rechaza» pasa de `assert.match(res.error, /personality/)` a `assert.equal(res.error, "enemies[0]: combat.personality ausente")`: **es más fuerte**, no más laxo — ancla el motivo exacto, que es lo único que hace verdad «un solo criterio». Verificado que el test cae si el motivo cambia: mutante «cambiar el texto» → 6 rojos (§ 3) |
| **Regla `la-logica-de-juego-no-vuelve-al-cliente` nace ROJA** | ✅ cumple, reproducido | Revertido `enemigo.ts` a `3cd77d82` y corrido `test/architecture.test.ts`: `✖ [error] la-logica-de-juego-no-vuelve-al-cliente` con **12 violaciones**, en `nefan-html/src/scene/enemigo.ts:75, 77, 77, 85, 87, 87, 89, 91, 93, 94, 101, 107` — las mismas 12 líneas que declara `implementacion-6.md` § 2. Fichero restaurado, `git status` limpio |
| …y se pone ROJA con un token reintroducido hoy | ✅ cumple | Añadido `if (typeof combat.health !== "number") return null;` a `enemigo.ts:70` → `✖ … nefan-html/src/scene/enemigo.ts:70 — patrón prohibido: "combat.health"`, precedido del `why` **entero**, con el párrafo de la PR 6 («QUÉ ES UN ENEMIGO UTILIZABLE… el grupo caza la LECTURA CRUDA de los cuatro campos… NO caza leer el resultado ya comprobado»). Restaurado; `git status` limpio. **Limitación medida: H5** |
| Regla verde hoy y sin falsos positivos | ✅ cumple | `grep -rnE 'combat\.(health\|max_health\|weapon_id\|personality)\b' nefan-html/src nefan-core/bridge` → **0**. Los cuatro grupos juntos, **0** en cliente y bridge. La sonda propia del ingeniero en `architecture.test.ts` afirma además que `comprobado.hostil.health`, `combat: npc.combat`, el módulo de core y `precombat.health` NO saltan (los cuatro casos en verde) |
| **Mutación**: entrada `hostil-desde-combat` con `break: "sin medir"` | ✅ cumple | `mutation-targets.json`: `mutate: ["src/combat/hostil-desde-combat.ts"]`, `tests: ["test/hostil-desde-combat.test.ts", "test/message-schema.test.ts"]`, `break: "sin medir"`, con `porque` que nombra los mutantes que importan por su EFECTO (el NaN que no se puede matar, el hostil sin ataques, el muerto que resucita, la barra llena del herido de #326) |
| `npm run deuda` lo lista | ✅ cumple | `⚠️ sin medir 5 de 48 módulos (5 ficheros sin dato)`; `npm run mutacion -- pendiente` → `Se medirían 20 de 48 módulos · 2001 mutantes medidos antes + 5 módulo(s) sin base: hostil-desde-combat, politica-de-atlas, fusible-de-skins, gates-de-imagen, frontera`. `npm run mutacion -- local hostil-desde-combat` → `NO se mide aquí: no hay medida previa … podría ser de los caros` (rechazo esperado) |
| Sin la entrada, `npm test` cae «sin dueño» | ✅ cumple | Quitado el módulo del JSON (48 → 47) → `✖ cada fichero del perímetro puro tiene dueño… AssertionError: sin dueño en data/contract/mutation-targets.json: src/combat/hostil-desde-combat.ts` (`ℹ fail 1`). Devuelto; `git status` limpio |
| Dos mutantes a mano mueren | ✅ cumple (§ 3) | `preferred_attacks: []` aceptada → **2 rojos** («preferred_attacks vacía», «load_room pasa por el MISMO criterio»). El de «rango de `aggression`» **no existe como criterio** (ni antes ni hoy: 2.5 y −1 se aceptan, § H8), así que maté el equivalente real: quitar `Number.isFinite` de `numero()` → **4 rojos** («health NaN», «aggression Infinity», «reaction_time NaN», «move_speed Infinity»). Ficheros restaurados byte a byte |
| **Rastros** | ⚠️ **uno vivo (H3)** | `grep -rnE 'EnemyPersonalitySchema\|parsePersonality\|validarCombat' nefan-html/src nefan-core/src nefan-core/bridge qa docs/arquitectura` → solo `message-schema.ts:35,49` (el identificador sigue, ya sin criterio: hoy es `z.custom<EnemyPersonality>()`, y el comentario de `:31-34` lo dice) y la cabecera de mi guion 90. `parsePersonality` y `validarCombat`: **0 en todo el repo**. Las tres notas declaradas están corregidas (`entidades-del-tile.ts:139`, `mundo-persistido.ts:186`, guion `49:33`), pero **falta una cuarta** en el mismo fichero: `entidades-del-tile.ts:293` (H3) |
| **Flujo real**: el bandido pega y recibe daño | ✅ cumple | Sonda propia sobre el stack 600, partida `alta_fantasia` (`1788788020-8df941`, escena `tile_0_0`, personajes en vector): `✔ el jugador LLEGA andando a 1.6 m de bandido_1` (d=1.25), `✔ el bandido RECIBE daño — hp=41.55` (de 60). En la batería, el 41/42/49/54/57 en verde sin retocar |
| **Flujo real**: el MISMO motivo en las dos orillas | ✅ cumple | Guion 90 (§ 5): bridge → `Bridge: WS frame rejected (schema): enemies[0]: combat.personality.preferred_attacks no es una lista de ataques no vacía`; cliente, con el mismo bloque en el save del spawn de runtime → `enemigo "narr_npc_1788788965_0" descartado: combat.personality.preferred_attacks no es una lista de ataques no vacía`. **Idénticos**, y el guion lo afirma comparando los dos textos |
| …y el resto de la escena sigue (fail-loud sin caerse) | ✅ cumple | Guion 90 A4/B: tras tres frames rechazados el jugador anda >0,5 m y el mundo conserva `barkeep` y `bandido_1`; tras reanudar con el save saboteado, el Secuaz NO entra (`enemigos: [bandido_1]`) y el tabernero sí. **Matiz H1**: el frame rechazado se pierde entero, y en el bridge eso planta un modal |
| Un hostil válido de runtime se materializa y combate | ✅ cumple | Guion 90 B: `✔ el motor materializa a "Secuaz" (turno 2)`; en la sonda del stack 600, `{"id":"narr_npc_…","label":"Secuaz","hp":60,"maxHp":60}`. Y en el NEGATIVO del guion (criterio saboteado) el Secuaz roto entra con `hp 21.89` y se le puede pegar: la diferencia entre «entra» y «no entra» está medida por los dos lados |
| Guiones verdes sin retocar; batería completa | ✅ cumple | `88 en verde · 0 en rojo de 88` a la primera (§ 6). El único fichero de `qa/` que la PR toca es una línea de PROSA del guion 49 (ningún aserto) |
| `verify` / `crap` / cliente | ✅ cumple | `npm test`: `ℹ tests 2306 · suites 415 · pass 2306 · fail 0` (EXIT=0). `npm run crap -- --check`: `1288 funciones medidas · cobertura de líneas 89.1% · complejidad máxima 46 · Tope (no empeorar): CRAP ≤ 73 — 0 por encima · ✔ dentro de los umbrales`. `npm run deuda`: `82 items`, `Fronteras — deuda congelada · 13`, 58 supervivientes — igual que la base. Cobertura del módulo: `hostil-desde-combat.ts | 72.73 | 100.00 | 100.00`, con las líneas 1-53 «sin cubrir» = la cabecera y los `type` (la mentira conocida de V8); **ramas y funciones al 100 %** |

## 2 · Las tres verificaciones de fondo

### 2a · Tabla de equivalencia base ↔ hoy (49 bloques × 4 criterios, ejecutados)

Se ejecutaron **los criterios reales**: `enemigoDesdeCombat@3cd77d82` con `errors.push` sustituido por un espía (lo
único que se cambió del fichero), el `ClientMessageSchema@3cd77d82` verbatim, y los dos módulos vivos del árbol.
Resumen (`base-cli / base-bri → hoy-cli / hoy-bri`):

| Bloque | Base | Hoy | ¿Declarado? |
|---|---|---|---|
| `combatForHostileRole("hostile")`, herido de save (h=12), personalidad con campo de plugin, campos extra en el bloque | acepta / acepta | **acepta / acepta** | sin cambio |
| save pre-#326 (sin `max_health`), muerto de save por `spawnsDeRuntime`, `combat` ausente/null/lista/string, `health` ausente/NaN/texto, `max_health` NaN, `weapon_id` ausente/numérico, `personality` ausente/null/lista, `aggression` ausente/NaN/texto, `reaction_time` ausente, `combat_range` NaN, `preferred_attacks` ausente/no-lista/con número | rechaza / rechaza | **rechaza / rechaza** | sin cambio (el motivo del bridge cambia en 11 de ellos, § 1 fila (c)) |
| `health: 0`, `health: -5`, `health: Infinity`, `max_health: 0`, `weapon_id: ""`, `combat_range` ausente, `preferred_attacks: []`, `aggression: Infinity`, `reaction_time: Infinity` | rechaza / **acepta** | rechaza / **rechaza** | sí (filas 1-6; `-5` y los dos `Infinity` extra son la misma regla) |
| `difficulty: 5`, `aggression_style: 7`, `block_chance: "0.3"`, `preferred_distance: null`, `attack_cooldown_mult: "1"` | **acepta** / rechaza | **rechaza** / rechaza | sí (fila 7) |
| `aggro_radius: "diez"` | acepta / acepta | **rechaza / rechaza** | sí (fila 8) |
| **`move_speed: Infinity`** | **acepta / acepta** | **rechaza / rechaza** | **NO (H2)** |
| `preferred_attacks: ["volar"]`, `weapon_id: "excalibur"`, `health: 999 > max_health: 60`, `aggression: 2.5`, `aggression: -1`, `reaction_time: -0.5` | acepta / acepta | acepta / acepta | sin cambio (**hueco del criterio**, § H8) |

`casos 49 · con cambio de conducta 17 · divergencias entre puertas HOY 11`.

### 2b · Qué ve el jugador en cada caso (la pregunta (c) del encargo)

| Dónde ocurre | Motivo del parser | Qué lee el jugador | Qué pasa con lo demás |
|---|---|---|---|
| Puerta del **cliente** (escena, spawn, resume) | sí, íntegro | `enemigo "<id>" descartado: <motivo>` en el registro de errores | se descarta **ese** enemigo; el mundo sigue |
| Puerta del **bridge**, error de VALOR (el criterio de core) | sí, pero **solo en el log del servidor** | «Fallo interno del juego / El juego mandó un mensaje que el servidor no reconoce» en un **modal a pantalla completa** | se descarta el **frame entero**; la partida queda velada hasta cerrar el modal |
| Puerta del **bridge**, error de TIPO (el zod del sobre) | no: gana el mensaje de zod | el mismo modal, el mismo texto | idem |

### 2c · Censo de productores y consumidores (para «ningún productor real»)

- **Produce**: `combatForHostileRole` (`src/combat/hostiles.ts:64`) → `scene-normalize.ts:261` (escena) y
  `consequence-handler.ts:124` (spawn de runtime). **Reescriben parcialmente**: `mundo-persistido.ts:271` (health/max
  vivos sobre el bloque existente) y `narrative-state.ts:342-348` (`refreshCombatantsFromRuntime`), que es el único
  sitio capaz de dejar un bloque incompleto en el save — y lo hace: el `bandido_1` de la escena guarda
  `data.combat: {health, max_health}` sin arma ni personalidad. **No llega a la puerta del cliente** (`spawnsDeRuntime`
  solo materializa spawns de runtime, no `scene_init`), verificado reanudando: registro sin un solo descarte.
- **Consume/valida**: `parseHostileCombat` desde `enemigo.ts:64` (cliente) y `message-schema.ts:64` (borde WS). Las
  dos vías del cliente son `carga-de-tile.ts:224` y `materializar-spawn.ts:78`, ambas tras un guard
  `combat !== undefined`, así que un NPC sin bloque nunca llega al parser (confirmado: los 23 personajes de las
  fixtures no lo alcanzan).

## 3 · Candados probados en negativo (roto a propósito, mirado en rojo, restaurado)

| Sabotaje | Resultado |
|---|---|
| `enemigo.ts` revertido a `3cd77d82` (la copia del cliente vuelve) | `architecture.test.ts` → **1 fallo, 12 violaciones** en las 12 líneas declaradas |
| Token del grupo reintroducido hoy (`combat.health` en `enemigo.ts:70`) | `✖ … patrón prohibido: "combat.health"` con el `why` entero |
| `numero()` sin `Number.isFinite` | `hostil-desde-combat.test.ts` + `message-schema.test.ts` → **`fail 4`**: `health NaN`, `aggression Infinity (número, pero no usable)`, `reaction_time NaN`, `move_speed Infinity` |
| `attacks.length === 0` fuera del criterio | → **`fail 2`**: `preferred_attacks vacía` y `load_room pasa por el MISMO criterio que add_combatants` |
| Motivo cambiado (`combat.health inválido (…)` → otro texto) | reproducido por el ingeniero: 6 rojos. Confirmado aquí de otra forma: `message-schema.test.ts:120` clava el string exacto, así que cualquier cambio de texto lo parte |
| El mismo sabotaje de `preferred_attacks` con el JUEGO delante (guion 90) | **5 rojos en las dos orillas** (§ 5) |
| Entrada de mutación quitada | `✖ cada fichero del perímetro puro tiene dueño… sin dueño … src/combat/hostil-desde-combat.ts` |

Tras cada uno, `git status` limpio (solo el guion 90 y la fila del README).

## 4 · Hallazgos

**H1 · IMPORTANTE — el desenlace del rechazo no es el mismo en las dos puertas, y la PR agranda el peor.**
*(origen: conducta pre-existente #352; el ALCANCE es de esta PR. Destino: el ingeniero — una frase en la declaración;
la granularidad, issue propio.)*
Reproducción desde el arranque: `./start.sh --preset e2e-sin-creditos` → partida nueva → mandar por el socket del
juego `add_combatants` con un enemigo cuyo `personality.preferred_attacks` sea `[]` (o `maxHealth: 0`, o
`weaponId: ""`: los seis casos que el borde ACEPTABA antes de esta PR). El jugador esperaría, como máximo, lo que ya
pasa cuando el descarte es del cliente: una línea en el registro y seguir jugando. Lo que ocurre:
`{"visible":true,"titulo":"Fallo interno del juego","detalle":"El juego mandó un mensaje que el servidor no
reconoce.","salida":"Cerrar"}` — un modal a pantalla completa que vela la partida (captura
`90-A3-el-modal-que-ve-el-jugador.png`), y el frame se descarta **entero**, con los enemigos sanos que llevara.
El motivo del parser —lo que la PR presenta como «la misma frase»— **no llega al jugador por esta puerta**: se queda
en `console.error` del bridge (`ws-server.ts:290`). Ninguna de las dos cosas es un fallo introducido: `kind:"protocolo"`
→ `destino:"overlay"` es la decisión de `status-rotulo.ts:204` y el frame entero es cómo funciona un intake. Lo que
cambia es **cuántos frames llegan ahí**: de cero casos de valor a seis. Hoy es inalcanzable para un jugador (su
cliente filtra antes con el mismo criterio); para «los diferentes clientes» que motivan #241, no. Pido dos cosas: que
la declaración diga qué pasa cuando ocurre, y que se decida si el borde debe descartar el enemigo o el frame.

**H2 · MENOR — la tabla de conducta declara 8 filas y hay una novena familia.** *(origen: PR. Destino: una línea en
`implementacion-6.md` / el commit.)* La fila 8 afirma que `aggro_radius: "diez"` «es la única fila que va más allá de
la unión». Medido: **cualquier opcional NUMÉRICO con valor no finito** también — `move_speed: Infinity` lo aceptaban
el cliente de la base (no lo miraba) **y** el zod de la base (`z.number()` admite `Infinity`), y hoy lo rechazan las
dos puertas. Vale igual para `block_chance`, `preferred_distance`, `attack_cooldown_mult` y `aggro_radius`. Es
deliberado y correcto (el tipo promete `number` finito), y su coste práctico es cero (`buildPersonality` los pone
finitos siempre), pero la frase «la única» no se sostiene y esa clase de imprecisión es la que después se cita como
medida.

**H3 · MENOR — rastro vivo de la propia PR.** *(origen: PR. Destino: el ingeniero, una línea.)*
`nefan-core/src/session/entidades-del-tile.ts:292-293`:
```
/** Los personajes que declara la world scene de un tile (vecinos y hostiles:
 *  los separa la presencia de `combat`, y esa puerta es del cliente). */
```
El informe declara haber corregido «las tres notas que decían que lo valida el cliente»; son **cuatro**, y la que
queda está en el mismo fichero que una de las corregidas, 154 líneas más abajo. Hoy esa puerta es de core y la usan
las dos orillas.

**H4 · MENOR — el tipo sigue mintiendo: se puede compilar un enemigo que el runtime rechaza.** *(origen:
pre-existente, declarado por el ingeniero en § 7; la PR lo hace observable. Destino: issue.)* `EnemyPersonality.combat_range`
es opcional (`src/types.ts:55`) y `RoomEnemy.personality` es `EnemyPersonality` (`net/game-client.ts:52`), mientras el
criterio lo EXIGE. Medido: un fichero con un `RoomEnemy` sin `combat_range` pasa `npx tsc --noEmit` en `nefan-html`
con **EXIT=0**, y ese mismo objeto por el cable da `combat.personality necesita aggression, reaction_time y
combat_range numéricos`. `PersonalidadValidada` arregla la SALIDA del parser, no la entrada del contrato. Es
exactamente el patrón «la garantía va en el tipo»: mientras el tipo lo permita, alguien lo escribirá.

**H5 · MENOR — el candado caza la forma, no la lógica.** *(origen: PR / molde del programa. Destino: saberlo, no
arreglarlo.)* La regla busca la subcadena literal `combat.health|max_health|weapon_id|personality`. Probado: un parser
nuevo escrito como se escribe un parser sobre `unknown` en TS estricto —`const _x = (datos.combat as { health?:
number }).health`— **no la dispara** (arquitectura en verde con esa línea en el cliente). Sí la dispara la forma de la
copia retirada. O sea: el candado impide que vuelva ESTE parser, no que se escriba otro. El `why` lo dice a medias
(«el grupo caza la LECTURA CRUDA… que es exactamente cómo estaba escrito éste»); conviene que la próxima PR del
programa no lo dé por más de lo que es.

**H6 · MENOR — la batería del bridge no ejerce la puerta nueva, y sus fixtures ya no son representativas.**
*(origen: pre-existente. Destino: issue o nota.)* `test/bridge-tile.test.ts:265,288`, `test/bridge-routing.test.ts:85`,
`test/bridge-session.test.ts:1313` y `test/escena-servida.test.ts:28` construyen `add_combatants`/`load_room` con
personalidades **sin `combat_range`** (una, sin `reaction_time` ni `preferred_attacks`) y llaman a `routeMessage`
DIRECTAMENTE, saltando `intakeClientMessage`. Siguen verdes con datos que el cable ya rechaza. No miden el borde, así
que no es un fallo; pero nadie se enteraría si el borde y el handler divergieran, y quien lea esas fixtures creerá
que son frames válidos. Los únicos que ejercen la puerta son `hostil-desde-combat.test.ts` y `message-schema.test.ts`.

**H7 · MENOR — el aviso que lee el jugador es jerga de contrato.** *(origen: pre-existente; la PR lo consagra.
Destino: issue de UX.)* Crítica visual de `90-B-el-registro-dice-por-que-se-descarto.png`: el panel del registro
(esquina superior derecha) es legible, cabe en tres líneas, no tapa la barra de vida, ni el rótulo del bandido, ni el
prompt de interacción, ni la propuesta de frontera — la caja está bien. Lo que dice, no:
`enemigo "narr_npc_1788788279_0" descartado: combat.personality.preferred_attacks no es una lista de ataques no
vacía`. Un jugador lee un id interno y un campo de un JSON, y no puede saber qué enemigo perdió ni si le importa.
Antes era igual de técnico, pero ahora ese string es **el contrato compartido entre las dos orillas** y está clavado
en dos tests, así que reescribirlo para el jugador cuesta más: si va a haber una versión legible, el sitio es el
canal del cliente (`errors.push`), dejando el string del parser para el log.

**H8 · OBSERVACIÓN — el techo del criterio único.** Ni antes ni ahora se comprueba que los ataques EXISTAN
(`preferred_attacks: ["volar"]` se acepta), que el arma esté en el catálogo (`weapon_id: "excalibur"` se acepta), que
`health <= max_health` (999/60 se acepta: barra >100 %), ni que `aggression` esté en [0,1] (2.5 y −1 se aceptan) o
`reaction_time` sea positivo (−0.5 se acepta). No es regresión —el veredicto es idéntico al de la base en los seis
casos— y ampliarlo aquí habría sido cambiar de conducta sin pedirlo. Queda dicho porque «qué es un enemigo utilizable»
suena a más de lo que el módulo comprueba.

**H9 · OBSERVACIÓN — sigue habiendo un lector crudo del bloque en core.** `mundo-persistido.ts:190-213`
(`combateDeEntity`) lee `combat.health` y `combat.max_health` con su propio criterio (acepta `health: 0` y negativo; el
filtro de muertos está fuera, en `spawnsDeRuntime:484`). El comentario de la PR lo declara deliberado —«duplicar aquí
esa validación sería un tercer criterio»— y es defendible (solo decide si un enemigo VUELVE y con cuánta vida), pero
de facto es un criterio parcial más, y la regla `text` no puede verlo porque `nefan-core/src` está fuera de sus
`files` a propósito. Sin acción; que no se pierda.

## 5 · Guion nuevo: `qa/guiones/90-el-enemigo-que-no-sirve-se-rechaza-igual-en-las-dos-puertas.mjs`

Mide la frontera movida, que ningún guion cubría: los ocho del enemigo (29 35 38 41 42 49 54 57) miden al hostil que
SÍ sirve; el 41 es el único que mira dentro de `personality` y el 50 el único que fabrica un bloque roto, para otra
cosa. Tres bloques, 10 asertos, cero créditos (`aisla: ["saves","fake-ai"]`, `charMode: "vector"`):

- **A · el borde WS.** Los frames van **por el socket del juego** (un `addInitScript` guarda la instancia que abre el
  cliente, molde del 85), no por uno de laboratorio: los juzga el borde real con la sesión de la partida. A1: el
  enemigo que el core deriva **entra** (0 rechazos nuevos en el log, 0 avisos de error) — sin ese verde, «rechaza»
  sería un verde vacío. A2: `preferred_attacks: []` → `enemies[0]: combat.personality.preferred_attacks no es una
  lista de ataques no vacía` en el log + aviso `kind:"protocolo"` al jugador. A3: `maxHealth: 0` —de los seis que el
  borde ACEPTABA— → `enemies[0]: combat.max_health inválido (0)`. A3-bis: mide el modal y lo deja escrito como
  `⚠ HALLAZGO` (H1) sin ponerlo rojo, y lo cierra como el jugador. A4: tras los tres rechazos el jugador anda y la
  escena conserva sus NPC.
- **B · la puerta del cliente.** El enemigo roto se fabrica donde el juego lo guarda: el `data.combat` del spawn de
  runtime («Secuaz», turno 2 del motor falso) en el `state.json` del disco efímero, y se REANUDA por la tarjeta del
  título. Afirma el descarte, que el motivo **es el mismo string** que escribió el bridge en A2, que el roto no entra
  al mundo y que el resto de la escena sí.

Salida real (dentro de la batería):
```
✔ A1 · el enemigo que el core DERIVA entra por el cable: el borde no lo rechaza
✔ A2 · el borde WS RECHAZA al hostil sin ataques y lo dice con el motivo del criterio de core
✔ A2 · …y al jugador le llega el aviso de protocolo (fail-loud, no silencio)
✔ A3 · `maxHealth: 0` (que el borde ACEPTABA antes de esta PR…) hoy se rechaza con el motivo del parser
A3-bis · overlay tras los rechazos: {"visible":true,"titulo":"Fallo interno del juego",…,"salida":"Cerrar"}
✔ A4 · la escena sigue en pie tras tres frames rechazados: sus NPC y su hostil siguen ahí
✔ B · el cliente descarta al enemigo roto y escribe el motivo en el registro del jugador
B · registro: Errores (1) scene 3:49:25 PM enemigo "narr_npc_1788788965_0" descartado: combat.personality.preferred_attacks no es una lista de ataques no vacía
✔ B · …y el motivo es EL MISMO STRING que el bridge escribió en su log para ese bloque
✔ B · el enemigo con el bloque roto NO entra al mundo…
✔ B · …y el resto de la escena sí: el rechazo es de UN enemigo, no de la partida
```

**Probado en negativo** (sabotaje en `hostil-desde-combat.ts`: aceptar la lista vacía; restaurado byte a byte):
```
✘ A2 · el borde WS RECHAZA al hostil sin ataques … — (ninguna línea «WS frame rejected» nueva)
✘ A2 · …y al jugador le llega el aviso de protocolo — []
✘ ocurre: B · el cliente descarta al enemigo roto … — no ocurrió en 60000 ms · 397 sondeo(s)
✘ B · …y el motivo es EL MISMO STRING … — cliente: — sin errores — || bridge:
✘ B · el enemigo con el bloque roto NO entra al mundo… — [{"id":"bandido_1"…},{"id":"narr_npc_…","label":"Secuaz","hp":21.887}]
0 en verde · 1 en rojo de 1
```
Cinco rojos, y el último enseña justo lo que la PR impide: el hostil sin ataques **dentro** del mundo, con vida y
peleando. Fila añadida a `qa/README.md` (sin commitear, como el guion).

## 6 · Batería completa

```
· bloque de puertos +100 (bridge :9977, HTML :3100)
· disco efímero: /home/al/code/ne-fan-241-6-qa/qa/.tmp/2026-09-07T13-41-12-078Z-312111
88 en verde · 0 en rojo de 88 · capturas en /home/al/code/ne-fan-241-6-qa/qa/capturas/2026-09-07T13-41-12-078Z-312111
```
88 = los 87 del repo + el 90. **Ningún guion retocado**, ninguna repetición necesaria: ni la firma de #496 (el 80) ni
la de #467 aparecieron en esta corrida. Capturas del 90 en ese directorio
(`…-01-90-A3-el-modal-que-ve-el-jugador.png`, `…-02-90-A-el-borde-rechaza-y-la-partida-sigue.png`,
`…-03-90-B-el-registro-dice-por-que-se-descarto.png`).

## 7 · Workarounds usados y su veredicto

| Workaround | ¿Afecta al jugador? |
|---|---|
| **Espía del `WebSocket`** (`addInitScript`) para mandar `add_combatants` por el socket del juego (guion 90 A) | **No, y es la única forma honesta de ejercer el borde**: el criterio del bridge solo se ejerce mandándole un frame, y hoy el cliente no puede producir uno inválido porque su propia puerta lo filtra con el MISMO criterio. Lo que el jugador tendría delante si otro cliente lo hiciera está medido, no escondido (H1). No se toca ni una línea del cliente |
| **Sabotear el `state.json`** del spawn de runtime y reanudar (guion 90 B, y la sonda del stack 600) | **No**: es el estado real por el que hoy un bloque roto llega a la puerta del cliente (el motor no escribe los números; los deriva el core), y es el molde del 50 y del 87. Se fabrica el dato en su fuente, no en el cliente |
| **Copias verbatim de los dos criterios de `3cd77d82`** en el scratchpad para la tabla base↔hoy | **No**: fuera del árbol, con el único cambio de sustituir `errors.push` por un espía. Es la forma de ejecutar el «antes» en vez de suponerlo |
| Sonda manual con `NEFAN_PORT_OFFSET=600` que leyó (sin escribir) el `state.json` de `saves/` del worktree | **No**: lectura; el sabotaje del save solo se hizo en el disco efímero del runner. `git status` limpio al cerrar |

Ningún `display:none`, ningún estado sintético en el cliente, ninguna pantalla saltada.

## 8 · No probado

- **Mutación de `hostil-desde-combat`**: nace `break: "sin medir"` y `local` lo rechaza por coste desconocido
  (verificado). Los dos mutantes que maté a mano (§ 3) **no** son una medida: dicen que esos dos mueren, no cuántos
  sobreviven. Va en la autorización 2 del programa.
- **Gasto de créditos**: cero por construcción (motor falso, `charMode: "vector"`); el guardarraíl del runner lo
  confirma en cada guion (`⛨ cliente y bridge declaran fake:true`). No se probó nada contra servicios de pago.
- **La puerta con OTRO cliente**: no existe otro cliente hoy, así que H1 se razona sobre el borde, no se ejerce desde
  un segundo cliente real.
- **`load_room` con enemigos en el juego real**: el cliente solo lo usa con fixtures del selector Room, y ninguna trae
  `combat`. Que pasa por el mismo criterio lo mide `test/hostil-desde-combat.test.ts` («load_room pasa por el MISMO
  criterio») y mi banco, no un guion.
- **El campo `aggro_radius` fuera del zod del wire** (§ 7 del informe del ingeniero): no lo verifiqué en el sim, solo
  que el parser lo comprueba y que `intakeClientMessage` devuelve el objeto crudo.

## 9 · Estado del árbol al cerrar

`git status --short` → `M qa/README.md` (fila del guion 90) y `?? qa/guiones/90-…mjs`. Sin commitear, como pide el
encargo. Todos los sabotajes de esta validación (siete) fueron restaurados byte a byte y comprobados con `git status`
tras cada uno.

## Nota del coordinador al incorporar el informe (2026-09-07)

H1 (el bridge tumba el FRAME entero con el modal «Fallo interno del juego» ante un enemigo inválido, mientras el cliente descarta
al enemigo y sigue; la PR lleva a ese modal seis casos de valor que antes entraban en silencio) → declarado aquí y en la PR, y la
decisión «descartar el enemigo o el frame» va a issue propio: es diseño del borde, no un movimiento. H3 (la cuarta nota, en
`entidades-del-tile.ts`) barrida por el coordinador en la rama. H2 (la fila 8 del informe: `move_speed: Infinity` también va más allá
de la unión) queda anotado aquí: el informe del ingeniero es gitignored. H4 (el tipo `RoomEnemy` admite un `combat_range` ausente que
el borde rechaza) y H6 (cinco fixtures del bridge saltan el intake) → issue de contrato del wire del enemigo, junto a los tres huecos
que el ingeniero anotó (`aggro_radius` fuera del espejo zod, mensaje de zod en errores de tipo, `combat_range` opcional en el tipo).
