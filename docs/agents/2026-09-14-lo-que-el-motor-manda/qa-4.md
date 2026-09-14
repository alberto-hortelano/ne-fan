# QA · PR 4 de la tanda B — #529, el desenlace del enemigo inválido

**Veredicto: APTO CON HALLAZGOS.** El criterio de aceptación se cumple —y se cumple en el juego
arrancado, no solo en tests—: un frame de `add_combatants`/`load_room` con un enemigo inválido entre
dos válidos mete los dos válidos, deja fuera al malo, y el motivo llega al log del bridge y al
registro del jugador **sin modal**. El criterio 4 sigue verde **sin que `test/architecture.test.ts`
se haya tocado** (no aparece en el diff). Los cuatro hallazgos son de cobertura y de lo que LEE el
jugador; ninguno bloquea.

- Árbol de QA: `/home/al/code/ne-fan-qa529`, detached en `8f7d8eb3`. No se tocó `/home/al/code/ne-fan`
  ni `/home/al/code/ne-fan-529`.
- Batería: `node qa/run.mjs 90 129 130 41 42 49 50 54 57 125` → **10 en verde · 0 en rojo de 10**
  (`EXIT=0`), preset `e2e-sin-creditos`, motor falso, `gasto sesión 0,00 € · total 0,00 €` en pantalla
  y guardarraíl «cliente y bridge declaran fake:true». Log:
  `…/scratchpad/bateria-qa529.log`. Capturas: `qa/capturas/2026-09-14T16-40-12-473Z-860711/`.
- Entrego además el **guion 130** (`qa/guiones/130-un-lote-entero-invalido-avisa-igual-y-no-borra-lo-que-habia.mjs`,
  declarado en `qa/README.md`), que cierra el hueco del hallazgo **H1**.

---

## 1 · Criterios

Criterio literal que valida esta PR (requisitos §3, reescrito por el crítico): *«si un frame de
`add_combatants`/`load_room` trae un enemigo inválido junto a dos válidos, entran los dos válidos, el
malo no, y el motivo llega al log del bridge y al registro del jugador — sin modal»*.

| # | Criterio | | Evidencia |
|---|---|---|---|
| 1 | Entran los DOS válidos, el malo no — **`add_combatants`** | ✅ cumple | Guion 129 en el juego arrancado: `A · dados de alta tras el frame: ["bandido_1","qa129_bueno_a","qa129_bueno_b"]`, leído del `state_update` que contesta el bridge. Y en unidad sobre el bridge real: `test/bridge-enemigo-invalido.test.ts` (`sim.getCombatant("lobo_3")` ok, `getCombatant("roto_2") === undefined`, `store.state.enemies = ["lobo_1","lobo_3"]`) |
| 2 | Lo mismo por **`load_room`** | ✅ cumple | `test/bridge-enemigo-invalido.test.ts`, segundo `describe`, frame serializado por `intakeClientMessage` + `routeMessage`. **Probado en negativo por mí (S7)**: proyectando al store `msg.enemies` crudo en vez de `criba.altas` → 1 rojo. Sin guion de navegador (declarado por el ingeniero; ver §4) |
| 3 | El motivo llega al **log del bridge**, con el id de quién | ✅ cumple | Guion 129: `Bridge: enemigo "qa129_roto" descartado: combat.personality.preferred_attacks no es una lista de ataques no vacía`. Guion 130: **una línea por enemigo**, tres ids y tres motivos distintos |
| 4 | …y al **registro del jugador** | ✅ cumple | Captura `129-…-01-…png` y `130-…-01-…png`: panel «narrative» arriba a la derecha con el texto ENTERO. Guion 129/130 lo afirman leyendo `#error-log` |
| 5 | **Sin modal** | ✅ cumple | `rotuloDeStatus("combatientes")` → `{destino:"log"}` en los CUATRO contextos de pantalla (`test/status-rotulo.test.ts`), incluido el peor (`mundoVacio:true, overlayAbierto:true`) en `bridge-enemigo-invalido`. En el juego: `C · muro de fallo tras el frame: {"visible":false,…}` (129 y 130) y el `A3-bis` del guion 90, que era `⚠ HALLAZGO` y hoy es aserto |
| 6 | **Criterio 4** (un solo criterio de «enemigo utilizable») sigue verde **sin tocar su test** | ✅ cumple | `test/architecture.test.ts` NO está en el diff (`git show --stat`); `npm run verify` 2707/2707; guion 90 verde. La tabla de las dos puertas (11 casos + control) sigue entera en `test/hostil-desde-combat.test.ts`, hoy contra `cribarHostiles` |
| 7 | El **camino feliz** no se ha roto (regresión) | ✅ cumple | Batería 10/10 con los siete guiones de enemigo (41, 42, 49, 50, 54, 57, 125). Control en unidad («un lote entero bueno no manda ningún aviso») y en el juego (guion 130, bloque A: lote sano de dos entra entero y **cero** avisos de error) |
| 8 | **Todos** los enemigos del frame inválidos | ✅ cumple (conducta), ⚠️ candado incompleto | Producción CORRECTA: `avisarDeLosDescartados` está FUERA del `if (added > 0)` (`simulation.ts:331`). Medido en el juego con el guion 130: aviso «3 de 3», tres líneas en el log, sin muro, y los dos combatientes previos siguen dados de alta. **Pero ningún test de `npm run verify` lo mira** → hallazgo **H1** |
| 9 | **Ninguno** inválido / frame **vacío** | ✅ cumple | `cribarHostiles([])` → dos listas vacías y `avisoDeCriba` → `null` (test propio). Medido por mí sobre el bridge real: frame vacío por las DOS puertas → cero altas y **cero `narrative_status`** (ningún aviso en blanco) |
| 10 | **Dos inválidos y uno bueno** | ✅ cumple | `test/criba-de-hostiles.test.ts`: «dos malos entre un bueno: cada uno con SU motivo». En el juego, guion 130 lleva tres malos con tres motivos |
| 11 | El **mismo id repetido** en el frame | ✅ cumple | Medido por mí sobre el bridge real: `[bueno("lobo"), bueno("lobo")]` → un solo alta, store `["lobo"]`, sin aviso. `[bueno("lobo"), roto("lobo")]` → el bueno entra (hp 60) y el aviso dice «1 de 2»: honesto y sin efecto sobre el que entró |
| 12 | Un motivo de **familia distinta** a la de su fixture | ✅ cumple | El guion 130 usa TRES familias del parser (`preferred_attacks`, `max_health`, `weapon_id`); el guion 90 añade el error de TIPO (`health:"mucha"`) y la ausencia de `combat_range`; la tabla de `hostil-desde-combat.test.ts` cubre 11 casos **a través de `cribarHostiles`** |
| 13 | El candado del kind **es el tipo** (`never` + `Record`) | ✅ cumple, probado en negativo por mí | Borrando el `case "combatientes"`: `status-rotulo.ts(277,9): error TS2322: Type '"combatientes"' is not assignable to type 'never'`. Borrando su fila de `DETALLE_POR_DEFECTO`: `status-rotulo.ts(141,7): error TS2741: Property 'combatientes' is missing…` |
| 14 | El kind nuevo **no se cuela en el overlay** por ningún camino | ✅ cumple | Único camino a `muro.fallo` en el cliente es `pintarFalloDelMotor` → `rotuloDeStatus` (`main.ts:1047`); los otros dos `muro.*` son `mostrar` de `tile`/`scene` en `generating` y la pantalla de título. Con `destino:"log"` no se llama a `muro.fallo` |
| 15 | **§8 del plan**: los asertos que salen de `message-schema.test.ts` reaparecen sobre el handler, **uno a uno** | ✅ cumple | Ver §2. Y el intake NO se quedó sin puerta: borrando el zod de `id`/`position` (S8) hay 1 rojo |
| 16 | El resto del wire **no se ha aflojado** | ✅ cumple | El diff de `message-schema.ts` toca SOLO `EnemySpawnSchema` (y comentarios); los otros schemas, intactos. `intakeClientMessage` sigue contestando `kind:"protocolo"` a un frame ilegible |
| 17 | Cero créditos | ✅ cumple | Censo de la corrida: el gasto es del motor FALSO (`/generate_scene`, `/generate_surface_atlas`, `/skin_sprite_sheet` contra `127.0.0.1:18765`); HUD `total 0,00 €`; guardarraíl `fake:true` en cliente y bridge |

### Cifras declaradas, re-medidas por mí

| Cifra declarada | | Lo que mido |
|---|---|---|
| `verify` 2707 tests, 0 fail | ✅ | `ℹ tests 2707 · pass 2707 · fail 0` (`EXIT=0`) |
| base 2690 | ⚠️ no probado | Habría que sacar el árbol de `8f7d8eb3`; no es carga del criterio |
| Cobertura ~95,85 % (base 95,86-95,88) y CRAP 0 por encima del tope | ✅ | Mi corrida: **95.88 %** de 18.094 líneas · `Tope (no empeorar): CRAP ≤ 73 — 0 por encima` · `✔ dentro de los umbrales`. Dentro del ruido que él mismo midió, y por encima del suelo (95 %) |
| Deuda 62 supervivientes, `sin medir` 2 → 3 | ✅ | `npm run deuda`: `Mutación — supervivientes · 62` · `sin medir 3 de 58 módulos` |
| `status-rotulo` en local: 105 mutantes / 0 vivos | ⚠️ no probado | Ver §4: no la repito porque `npm run mutacion -- local` escribe `reports/mutation/` y eso bloquea el `traer` del coordinador |
| `npm run build` + `npm run lint` de `nefan-html` verdes | ✅ | `BUILD=0` · `LINT=0` (el diff no toca un solo fichero del cliente) |
| Batería de 9 guiones verdes | ✅ | 10/10 con el mío incluido |

---

## 2 · Los asertos que salieron del intake, uno a uno (riesgo §8 del plan)

| Aserto que había | Dónde está hoy | |
|---|---|---|
| `add_combatants con enemigo sin personality se rechaza` (motivo `enemies[0]: combat.personality ausente`) | El VEREDICTO y el MOTIVO: `hostil-desde-combat.test.ts`, caso «con la personalidad ausente» de la tabla de las dos puertas, que hoy pasa por `cribarHostiles` y exige además el id del enemigo. El DESENLACE: `bridge-enemigo-invalido.test.ts` | ✅ no se perdió |
| (no existía) el gate de FORMA | Nace: sin `id`, sin `position` y con `position.z` no numérico, **en las dos puertas** (`message-schema.test.ts`) | ✅ gana cobertura |
| `load_room pasa por el MISMO criterio` en su forma de zod | Sustituido: que los DOS HANDLERS llamen a la criba lo afirma `bridge-enemigo-invalido.test.ts` sobre el bridge real — y es lo que de verdad podía olvidarse. **Probado en negativo por el ingeniero (S2) y confirmado por mí (S7)** | ✅ equivalente o mejor |

Lo único que ya nadie afirma es el formateo `"enemies[0]: …"` para ese caso concreto; el formateador
sigue candado por los asertos nuevos (`/enemies\[0\]\.id/`, `/enemies\[0\]\.position\.z/`).

**La desviación declarada (la criba en core y no el bucle dos veces en el bridge) se sostiene** y no
esconde nada: `cribarHostiles` no juzga el bloque `combat`, se lo pregunta al mismo
`parseHostileCombat`; la regla `la-logica-de-juego-no-vuelve-al-cliente` sigue verde con el bridge en
sus `files`; y el módulo entra en `mutation-targets.json` con su batería y su `"sin medir"` contado.
El cambio en `arch-rules.json` es **solo prosa** (un único `why` reemplazado; ni un token).

---

## 3 · Hallazgos

### H1 · menor — el desenlace «no entra NINGUNO» no lo ve `npm run verify` (ni, por tanto, el CI)

**Qué pasa.** `handleAddCombatants` decide dos cosas: quién entra y si se avisa. El aviso vive FUERA
del `if (added > 0)`, que es lo correcto — pero **con al menos un enemigo bueno en el lote ese `if` se
cumple siempre**, así que el lote del criterio de aceptación (2 buenos + 1 malo) no distingue las dos
posiciones. Medido:

```
sabotaje: avisarDeLosDescartados(criba, ws, ctx) DENTRO del if (added > 0)
  node --import tsx --test test/criba-de-hostiles.test.ts \
       test/bridge-enemigo-invalido.test.ts test/message-schema.test.ts
  → ℹ tests 26 · pass 26 · fail 0        ← NADA se entera
  node qa/run.mjs 129 130
  → ✔ 129 (entero en verde)  ·  ✘ 130 (5 rojos)
  node qa/run.mjs 90
  → ✘ 90 (6 rojos, pero culpando al CRITERIO: «el bridge RECHAZA al hostil sin ataques»)
```

Con ese sabotaje, un lote en el que **no entra ninguno** deja al jugador sin la mitad de la noticia
(ni línea en el log del bridge, ni aviso, ni registro: `registro del jugador: — sin errores —`) justo
cuando más falta le hace. La conducta de HOY es correcta; lo que falta es el candado.

**Por qué menor y no importante**: producción está bien, y la batería local sí lo caza (guion 90 A2
manda un lote de UN enemigo malo, que es el mismo camino). Pero el rojo del 90 nombra el criterio, no
el desenlace, y **la batería de navegador no corre en CI**, así que en el runner esto sale verde.

**Reproducción desde el arranque**: `node qa/run.mjs 130` con el sabotaje puesto; sin él, verde.
**Qué esperaba el jugador**: que si no entra ninguno se lo digan igual (es el caso en el que el mundo
queda sin los enemigos que debía tener).
**Cerrado a medias por mí**: el guion **130** lo mide en el juego, con el lote de TRES malos y el
control del camino feliz. **Lo que falta y no hago yo**: un cuarto caso en
`test/bridge-enemigo-invalido.test.ts` —lote entero inválido por `add_combatants`: un aviso, tres
líneas de log, y los combatientes previos intactos— para que el candado viva también en CI.

### H2 · importante (no bloqueante) — lo que el jugador lee en la línea del juego nace CORTADO a media palabra

El aviso viaja entero al registro (bien), pero la **línea del juego** —el canal que el jugador mira
sin abrir nada— lo trunca a 100 caracteres sin elipsis (`nefan-html/src/main.ts:1049`,
`log(\`⚠ ${rotulo.detalle.slice(0, 100)}\`)`, tope escrito para los mensajes de `tile`). El mensaje de
este kind mide **131 caracteres con UN descartado y 242 con tres**, así que **siempre** se corta:

```
línea del juego (1 descartado, captura 129):
  ⚠ Enemigos que no entraron al mundo (1 de 3): «qa129_roto» (combat.personality.preferred_attacks no es
línea del juego (3 descartados, captura 130):
  ⚠ Enemigos que no entraron al mundo (3 de 3): «qa130_sin_ataques» (combat.personality.preferred_attack
```

En el segundo caso la frase muere a media palabra (`preferred_attack`) **y se lleva por delante a los
otros dos enemigos**: el jugador lee «3 de 3» y solo ve nombrado a uno. Como crítica de jugador: la
primera cláusula está bien escrita y en cristiano («Enemigos que no entraron al mundo (3 de 3)»); lo
que sigue es diagnóstico técnico que en el REGISTRO se defiende —es donde se depura, y es el string
que hace verdad «un solo criterio»— pero en la línea del juego aparece como una frase rota, que es
exactamente como se lee un bug.

**Reproducción**: `node qa/run.mjs 130` y mirar la captura
`qa/capturas/<run>/130-…-nadie-entra-y-aun-asi-se-dice.png`, abajo a la izquierda.
**Qué esperaba el jugador**: una frase entera. Mínimo, una elipsis; mejor, un titular corto en la
línea («2 enemigos no entraron al mundo — mira el registro») y el motivo verbatim solo en el registro.
**Dónde va el arreglo**: como el propio ingeniero dejó escrito, en **core y en las dos orillas a la
vez** (el texto corto puede salir de `avisoDeCriba`, que ya es quien redacta), nunca recortando el
motivo que compara el guion 90. No lo toco yo.

### H3 · menor (riesgo latente, no alcanzable hoy) — el kind nuevo viaja por la rama genérica de error del cliente, que tiene dos efectos escritos para fallos FATALES

`combatientes` cae en el `if (status.phase === "error")` final de `onStatusDeLaPartida`
(`main.ts:1019`), y antes de llegar ahí pasa por dos cosas pensadas para un fallo que TERMINA algo:

- `main.ts:948` — `travelLedger.fallo(status.placeId, status.message ?? "sin mensaje")`. Con
  `placeId` ausente (el de este kind lo es) la guarda `if (placeId && placeId !== this.cur.placeId)`
  no protege: **marca como fallido el viaje en vuelo** con el texto de los enemigos y lo CIERRA
  (`travel-ledger.ts:73-77` + `cerrado()`). La atribución sin `placeId` es DELIBERADA (lo dice la
  cabecera del método) y se escribió cuando todos los kinds eran fatales; con uno que no lo es, el
  ledger apunta como causa del viaje algo que no tiene nada que ver. **El jugador sí llega**: el
  teletransporte lo hace `main.ts:952-957` con el `spawn` del `ready`, y eso no depende del ledger —
  lo que se pierde es el registro del viaje (`spawnAplicado`), que es diagnóstico y es lo que leen
  los guiones.
- `main.ts:1020` — `hablar.yaContestaron()`, que levanta la espera de 30 s del saludo.

Hoy **no es alcanzable**: ningún camino de jugador manda un enemigo inválido (el cliente criba antes,
y el motor no escribe esos números). Pero el valor declarado de #529 es *defensa en profundidad*, y
esto es la puerta de al lado: el primer kind NO fatal que puede llegar en mitad de una partida hereda
los efectos de los fatales. **No probado en el navegador** (haría falta inyectar el frame en la
ventana exacta de un viaje en vuelo); lo doy como lectura de código, no como medida.

### H4 · menor — un aserto que no puede ponerse rojo por su causa

`test/criba-de-hostiles.test.ts` · *«los valores que entran son los del PARSER, no los del cable»*.
Medido: sustituyendo en `cribarHostiles` el bloque del parser (`r.hostil`) por los campos CRUDOS del
cable, **63 de 63** tests de los tres ficheros del sujeto siguen verdes. La razón es que
`parseHostileCombat` no convierte nada (`numero()` exige `typeof === "number"`), así que para todo lo
que pasa el criterio, cable y parser son idénticos. El diseño es el bueno —el día que el parser
normalice, usar el cable sería un fallo real— pero hoy ese aserto documenta una intención, no la
sujeta, y su nombre dice lo contrario. Sin acción obligatoria; queda dicho para que nadie lo cuente
como cobertura.

---

## 4 · Workarounds usados, y su veredicto

| Workaround | Veredicto |
|---|---|
| **Inyectar los frames por el socket del juego** (`addInitScript`, molde del 85/90/129) en vez de provocarlos jugando | **No es un hallazgo nuevo: es una limitación YA declarada** por el crítico (requisitos §3: «hoy ningún camino de jugador llega a ese modal») y por el ingeniero (§6 de `implementacion-4.md`). El obstáculo no lo tiene el jugador delante: lo que no existe es la forma de provocar el estado. Lo hereda mi guion 130 y lo dejo escrito en su cabecera |
| **Sabotajes sobre el código de producción** (9: S1-S4, S6-S9 y el borrado del `case`/`Record`) | Cada uno restaurado con `git checkout --` inmediatamente; `git status` limpio tras cada tanda y al terminar (solo quedan mi guion 130 y la fila del README). El árbol del ingeniero no se tocó |
| **Un fichero de test temporal** (`test/zz-qa-scratch-529.test.ts`) para medir id repetido, frame vacío y `load_room` todo-malo | Borrado en el mismo comando; era medición, no arreglo |
| Ningún `display:none`, ningún estado forzado en el DOM, ninguna pantalla saltada | — |

---

## 5 · No probado

- **La medida de mutación de `status-rotulo`** (105 mutantes / 0 vivos, break 100). No la repito: en
  esta casa `npm run mutacion -- local` escribe `reports/mutation/` y una corrida encima de una
  descarga **bloquea el `traer` del coordinador** (CLAUDE.md). El riesgo que cubriría está cubierto de
  otra forma: el kind nuevo y su destino los mide `test/status-rotulo.test.ts` (que ahora deriva las
  tres listas de kinds de un `Record` sobre la unión, así que un kind nuevo no puede colarse sin que
  las tres lo miren) y el sabotaje 3 del ingeniero, que reproduje por la vía del tipo.
- **La primera medida de `criba-de-hostiles`**: no se puede hacer en local por diseño; entra
  `"sin medir"` con su motivo y sube la deuda contada de 2 a 3 módulos, que es deuda ABIERTA.
- **`load_room` en el navegador**: no hay guion; el selector «Room» no fabrica enemigos rotos. Queda
  cubierto por `test/bridge-enemigo-invalido.test.ts` sobre el bridge real (con el frame serializado)
  y probado en negativo por mí (S7).
- **El número base de `verify` (2690)**: no re-medido; habría que sacar otro árbol.
- **Gasto real de créditos**: cero por construcción (motor falso), no por medida de una cuenta real.

---

## 6 · Qué entrego

- `qa/guiones/130-un-lote-entero-invalido-avisa-igual-y-no-borra-lo-que-habia.mjs` — cuatro bloques
  (control del camino feliz · ninguno entra · el aviso llega igual con «3 de 3», tres motivos de tres
  familias, una línea de log por enemigo, registro y sin muro · lo que había sigue). **Probado en
  negativo**: con `avisarDeLosDescartados` dentro del `if (added > 0)` salen **5 rojos** aquí mientras
  el 129 y los 26 tests de unidad del sujeto siguen verdes.
- `qa/README.md` — su fila, con la medida del negativo dentro.

## 7 · Veredicto

**APTO CON HALLAZGOS.** Se puede integrar. H1 pide un test de unidad (una vuelta corta al mismo
ingeniero, o un issue si la tanda corre prisa), H2 es una decisión de producto sobre el texto del
jugador —y el arreglo va en core, no aquí—, H3 y H4 quedan escritos para que nadie los cuente como
cubiertos.
