# QA — PR 8 de #241: la velocidad, el alcance de la `E`, la reaparición y `hablar-con-un-npc` salen de `main.ts`

**Veredicto: APTO.** Es un movimiento y lo es en el sentido fuerte: **cero diferencias base↔hoy en 100.014
comparaciones** de `puntoDeReaparicion` sobre las tres fixtures de `data/scenes/` (6.214 de ellas sobre punto
sólido), **11 trazas idénticas** de `HablarConUnNpc` (la clase de la base copiada del `git show` y ejecutada contra
la de `dist`) y **la misma aritmética exacta** de la velocidad (4,18 y 8,36 en las dos). En el juego real, con el
mismo método sobre `1f4ab084` y sobre esta rama, **andando 4,1800 m/s y esprintando 8,3600 m/s en las dos, tres
pasadas cada una**, y la escalera del borde de la `E` peldaño a peldaño idéntica (ofrece hasta 2,495 · deja de
ofrecer desde 2,505). La regla `la-logica-de-juego-no-vuelve-al-cliente` nace roja con los **cinco** tokens del grupo
8 y verde con los dos usos legítimos que la PR declara; `client-file-size.json` dice **1410**, que es el `wc -l`
exacto, y con la cifra vieja el candado se pone rojo con su mensaje; las dos entradas de mutación están y sin
cualquiera de ellas `npm test` cae «sin dueño»; maté tres mutantes a mano y caen con 5, 3 y 1 rojos. `npm run
verify` verde antes y después de siete sabotajes (2.387 tests, 0 fallos). **La promesa que la PR añade se cumple
medida**: con `speed_scale: 3.0` en `combat_config.json`, sin recompilar nada, el jugador anda a **5,70 m/s** y
esprinta a **11,40 m/s**. Guion nuevo **93**, verde con 16 asertos y probado en negativo (cuatro rojos con el
multiplicador de vuelta en el cliente). Batería completa: **`91 en verde · 0 en rojo de 91`**, a la primera y sin
retocar un solo guion.

**Lo que no cuadra y hay que corregir antes de que decida nada (H1)**: la §7 H1 del informe del ingeniero dice que
esta PR empeora la cobertura «0,107 puntos» (88,9587 % → 88,8516 %) y pide una decisión del usuario sobre el umbral
apoyada en esa cifra. **Medido por mí, la cifra no se reproduce en ninguna de las dos puntas**: la base
`1f4ab084` limpia da **88,8278 %** y esta rama da **88,8777 %** y **88,8191 %** en dos corridas del MISMO commit.
El instrumento varía ±0,06 puntos entre corridas, así que la diferencia base↔rama (±0,05) cae dentro de su propio
ruido y no es medible con una pasada. Lo que sí queda firme, y es la mitad que importa: **`npm run crap -- --check`
sale con código 1 en la base Y en la rama** — el rojo es preexistente, esta PR no lo trae. La decisión del usuario
sigue haciendo falta; el número con tres decimales, no.

**El segundo hallazgo es de alcance de la propia validación (H2)**: el escalón 1 de `puntoDeReaparicion` —la
pregunta «¿está libre donde caí?»— es **inobservable desde el juego**, así que ningún guion de navegador puede
candarlo. Se comprueba en negativo: saboteando `reaparicion.ts` para que devuelva `pos` **sin comprobar sólidos**
(el sabotaje que el encargo pedía ver rojo), el guion 93 **sigue verde**, medido. La causa es la que el ingeniero
declara en su H2 y confirmo entera: `CollisionSystem.collidesAt(x, z)` no es una consulta de punto sino «¿puedo
MOVERME de donde estoy a (x,z)?» (`world/collision.ts:74-84`, `desde = this.deps.getPlayerPos()`) y
`handleRespawnRequest` le pregunta por la posición del propio jugador. Esa mitad la candan los 8 casos de
`test/reaparicion.test.ts` (5 rojos con ese mismo sabotaje) y nada más; queda escrito en el guion y aquí para que
nadie lo cuente de más.

Worktree `/home/al/code/ne-fan-241-8-qa`, HEAD desprendido `fc8468f7` sobre `main` `1f4ab084`. Stack propio:
`ss -ltn` antes → 22/53/80/631/3636/4317 y nada del bloque +600; `NEFAN_PORT_OFFSET=600 ./start.sh --preset
e2e-sin-creditos` → fake-ai `:19365`, bridge `:10477` (State API `:10478`), cliente `:3600`; parado siempre con
`NEFAN_PORT_OFFSET=600 ./start.sh --parar`, que enumeró y **respetó** lo ajeno (`⏭ :10377 :10378 … — AJENO, no se
toca`, `⏭ :3500 … ne-fan-241-7-qa`, `⏭ :19265`, `⏭ :18765`). Ningún `pkill`, ningún `kill` por puerto, ningún uso
del Playwright MCP compartido: ojos con `playwright-core` de `qa/node_modules` y los guiones por `qa/run.mjs`, que
corrió en el bloque +600 con su disco efímero.

**Sobre `dist`**: la tabla de equivalencia se ejecutó contra `nefan-core/dist` (reconstruido en cada cambio de
commit), como pedía el encargo. Conviene saber que el juego NO pasa por ahí: el bridge corre con `tsx` sobre `src` y
el cliente resuelve `@nefan-core/src/…` a los `.ts` fuente, así que `dist` y `src` son el mismo código compilado dos
veces. Las medidas del juego real (§ 3) son sobre `src`.

## 1 · Criterios de aceptación

| # | Criterio (de los requisitos y del encargo) | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **Es un movimiento**: `puntoDeReaparicion` hace hoy lo mismo que las seis líneas de la base, dentro y fuera de sólidos y en los bordes de las tres fixtures | ✅ | Sonda `equivalencia.ts` (base copiada literal de `git show 1f4ab084:nefan-html/src/main.ts:546-553`): `robledo_tile 33338 · puerto_tile 33338 · zorder_test 33338 comparaciones` con y sin rect, malla de 0,5 m + los cuatro bordes exactos + ε de ±1 mm y ±25 cm + tres puntos fuera del tile → `TOTAL: 100014 comparaciones, 6214 sobre sólido · diferencias: 0` |
| 2 | …y el guard de `hablar-con-un-npc` es el de la base | ✅ | 11 trazas (cuatro `E` seguidas, los dos bordes del tope de 30 s, `yaContestaron` en el mismo frame, sin nadie delante, conversación abierta y cerrada, NPC sin nombre, cambio de NPC en la espera, frame sin pulsar, reloj hacia atrás) con la clase de la base y la de `dist`: `0 diferencias`, incluida la lista de saludos emitidos |
| 3 | …y `velocidadDelJugador` == `ARCADE_SPEED_SCALE × SPEED` de la base | ✅ | `andando base=4.18 hoy=4.18 IGUAL · sprint base=8.36 hoy=8.36 IGUAL` (igualdad exacta de coma flotante, no tolerancia) |
| 4 | La misma conducta EN EL JUEGO, base y rama, mismo método | ✅ | § 3. BASE `1f4ab084`: `4.1800 · 4.1800 · 4.1800` andando y `8.3600 · 8.3600 · 8.3600` esprintando. RAMA: `4.1800 · 4.1800 · 4.1800` y `8.3600 · 8.2991 · 8.3600` |
| 5 | La `E` ofrece hasta 2,495 y deja de ofrecer desde 2,505, en las dos | ✅ | Escalera de 8 peldaños con el NPC quieto, idéntica en base y rama: `2.4 sí · 2.45 sí · 2.49 sí · 2.495 sí / 2.505 no · 2.51 no · 2.55 no · 2.6 no` |
| 6 | Morir y `R` → reaparecer fuera de sólidos | ✅ | Rama: cayó en `(0.144, -1.643)`, volvió a `(0.144, -1.643)`, `sólido=false`, `hp=100` a la primera pulsación. Base: cayó en `(0.128, -1.642)`, volvió al mismo punto. Guion 93 bloque 4, con la solidez preguntada **desde 8,5 m** |
| 7 | `loadConfig` falla si faltan `speed_scale`/`interact_range_m`, sin default | ✅ | 12 casos ejecutados (§ 2b): los 8 que faltan o no son número finito LANZAN nombrando el campo; el mensaje junta todos (`player.speed_scale, player.interact_range_m debe(n) ser…`). Con `player` ausente o `null`: `combat config sin bloque 'player'` |
| 8 | La regla `la-logica-de-juego-no-vuelve-al-cliente` ROJA con un token del grupo 8 en un `.ts` del cliente | ✅ | Los cinco tokens en `main.ts` → `5 !== 0`, uno por línea: `:1413 ARCADE_SPEED_SCALE · :1414 INTERACT_RANGE_M · :1415 ESPERA_MAX_MS · :1416 esperaHasta · :1417 ".minX + under.rect.maxX) / 2"`. Los dos legítimos en las líneas siguientes (`rect.minX + TILE_SIZE_M / 2`, `(minX + maxX) / 2`) **no saltan** |
| 9 | …y su `why` trae el párrafo de la PR 8 | ✅ | `arch-rules.json:270` — párrafo «· PR 8 (2026-09-07): LAS TRES REGLAS SUELTAS DEL `main.ts` Y EL SALUDO», con qué era, dónde vive hoy y por qué vuelve; declara además por qué `yaContestaron`/`ultimoHablado` no son tokens |
| 10 | Árbol limpio después | ✅ | `git status --short` tras cada sabotaje; al cerrar solo `M qa/README.md` y `?? qa/guiones/93-…mjs` |
| 11 | `client-file-size.json` = 1410 exacto, y el candado rojo con la vieja | ✅ | `wc -l nefan-html/src/main.ts` → **1410**. Con 1417: `AssertionError: src/main.ts ADELGAZÓ a 1410 y su excepción sigue en 1417: le está regalando 7 línea(s) de recrecimiento` (`test/client-file-size.test.ts`, `fail 1`) |
| 12 | Entradas `reaparicion` y `hablar-con-un-npc` con `break: "sin medir"`; sin una, `npm test` cae «sin dueño» | ✅ | Las dos en `mutation-targets.json` (52 módulos). Quitando `reaparicion`: `sin dueño en data/contract/mutation-targets.json: src/simulation/reaparicion.ts`. Quitando `hablar-con-un-npc`: el mismo rojo con su fichero. Las dos devueltas |
| 13 | `paso-del-jugador` crecida con su suelo 97 | ✅ | Re-medido por mí: `ok paso-del-jugador 48 mutantes · 1 vivos · score 97.9% (break 97) · 8s`. Eran 46 mutantes en la huella: los dos nuevos de `velocidadDelJugador` MUEREN |
| 14 | `npm run deuda` las lista | ⚠️ | Las **cuenta** («sin medir 9 de 52 módulos (9 ficheros sin dato)») pero **no las nombra**: remite a `npm run mutacion -- pendiente`, que sí las da por nombre (`reaparicion`, `hablar-con-un-npc` entre los 9 sin base). Matiz, no defecto |
| 15 | Dos mutantes muertos a mano | ✅ | (a) reaparecer siempre donde cayó (`if (!solido…)` fuera) → **5 rojos** en `test/reaparicion.test.ts`, entre ellos «la pregunta de solidez se hace en el punto del cadáver». (b) guard de la espera (`now >= this.#esperaHasta` fuera) → **3 rojos**, entre ellos «a los 30 s exactos la E vuelve a funcionar». (c) extra: `interact_range_m` 2,5 → 2,6 en el config → **1 rojo** («el combat_config.json REAL carga y trae los cuatro números») |
| 16 | Rastros a cero | ✅ | `grep -rnE 'ARCADE_SPEED_SCALE\|INTERACT_RANGE_M\|MOUSE_SENS_RAD_PER_PX\|hablar-con-un-npc' nefan-html/src qa docs/arquitectura CLAUDE.md` → solo el `import` de core (`main.ts:63`), `mapa.md:23` (versión NUEVA) y las tres citas de `MOUSE_SENS_RAD_PER_PX` (H5, preexistentes). Grupo 8 completo en cliente + bridge: **0** |
| 17 | `mapa.md` y `ui.md` no cuentan la versión vieja | ✅ | `mapa.md:20-23` nombra `reaparicion` y `hablar-con-un-npc` en `simulation/` y `combat_config.json` con su bloque `player`. `ui.md`, `vistas.md` y `docs/combat.md`: cero menciones de las constantes o del fichero movido |
| 18 | «Editable sin recompilar» (CLAUDE.md) | ✅ | `speed_scale: 2.2 → 3.0` en el fichero, sin tocar código: `ANDANDO 5.7000 · SPRINT 11.4000` en las tres pasadas (= 1,9×3 y 3,8×3). JSON restaurado. **Es capacidad nueva**: en la base el 2,2 vivía en el cliente y exigía recompilar |
| 19 | Guiones verdes sin retocar | ✅ | `91 en verde · 0 en rojo de 91` (§ 6). El único guion tocado por la PR es el 79 y solo en un comentario |
| 20 | Cero créditos | ✅ | Guardarraíl del runner en los 91 (`⛨ cliente y bridge declaran fake:true`), `charMode: "vector"` donde se pudo, y el HUD de las capturas: `gasto sesión 0,00 € · total 0,00 €` |
| 21 | Guion nuevo de la frontera movida, probado en negativo | ✅ | `qa/guiones/93-la-velocidad-y-el-alcance-los-dice-el-config.mjs`, 16 asertos verdes, 3 negativos medidos (§ 5) |

## 2 · Las comprobaciones que pedía el encargo

### (a) 4,18 → 4,19 y 8,39 → 8,35: ¿ruido o cambio? — **ruido del método del ingeniero**

Su medida usa 180 fotogramas de tecla mantenida (≈ 6 s). A 8,36 m/s eso son **52 m**, y el tile mide 64: el jugador
llega al borde, la frontera direccional lo frena y el resto del muestreo promedia con un jugador parado. Lo medí:
con 180 frames salen `ANDANDO 3.8321 · SPRINT 1.7175` en una pasada y `SPRINT 4.2393` en otra — hasta un 50 % bajo,
con el mismo binario. Reduciendo el trayecto a lo que cabe en el campo libre (40-50 frames, con el rumbo elegido
por `probeCollide` a 30 m):

| | andando (3 pasadas) | esprintando (3 pasadas) |
|---|---|---|
| BASE `1f4ab084` | **4,1800 · 4,1800 · 4,1800** | **8,3600 · 8,3600 · 8,3600** |
| RAMA `fc8468f7` | **4,1800 · 4,1800 · 4,1800** | **8,3600 · 8,2991 · 8,3600** |

Teórico: 1,9 × 2,2 = 4,18 y 3,8 × 2,2 = 8,36. **No hay cambio**: hay un método que medía un muro. El guion 93
hereda la lección y **afirma** que el trayecto cupo en el campo libre, para que nadie vuelva a medir un choque.
La `E` ofrece **hasta 2,495 y deja desde 2,505 en las dos ramas**, peldaño a peldaño (criterio 5).

### (b) `loadConfig` fail-loud, sin default — **sí, y alcanza al bridge**

12 casos ejecutados contra `dist`:

```
LANZA · sin player            → CombatData: combat config sin bloque `player` (velocidades y alcance del jugador)
LANZA · sin speed_scale       → CombatData: player.speed_scale debe(n) ser número finito en combat_config.json
LANZA · sin interact_range_m  → CombatData: player.interact_range_m debe(n) ser número finito…
LANZA · sin los dos           → CombatData: player.speed_scale, player.interact_range_m debe(n) ser…
LANZA · null · "2.2" · NaN · Infinity · player={} · player=null
CARGA · interact_range_m = 0 · speed_scale = -1          ← números finitos: pasan (H5 de esta QA)
```

Y lo que el informe no dice: **el fail-loud tumba el arranque del BRIDGE**, no solo del cliente. Con
`speed_scale` borrado del fichero, `./start.sh --preset e2e-sin-creditos` termina en
`❌ bridge did not come up on :10477 within 30s`, y el motivo está en su log
(`ws-server.ts:62 → loadConfig → Error: CombatData: player.speed_scale debe(n) ser número finito`). Es lo correcto
—no arrancar con datos mentirosos— pero conviene que esté escrito: la puerta la cruzan tres procesos.

### (c) El superviviente de `paso-del-jugador` — **es el de siempre, y es equivalente en el juego**

Re-medido por mí, no leído del informe: `48 mutantes · 1 vivos · score 97.9% (break 97) · 8s`, y el vivo es

```
[Survived] EqualityOperator   src/simulation/paso-del-jugador.ts:85:7
-     if (flen < 1e-9) {
+     if (flen <= 1e-9) {
```

Estrictamente **no es equivalente**: difieren cuando `flen === 1e-9` exacto (el original sigue y normaliza; el
mutante lanza). Es **inalcanzable desde el juego**: `flen = Math.hypot(forward.x, forward.z)` y el único productor
de `forward` es `Mirada.ponYaw` (`mirada.ts:75`, `{x: sin(yaw), y: 0, z: cos(yaw)}`), cuya norma es 1 siempre. El
`porque` del módulo lo declara «EQUIVALENTE a efectos de suelo», que es la formulación correcta: matarlo exige
afirmar un comportamiento en el 1e-9 exacto que nadie necesita. Suelo 97 mantenido **medido**, no declarado.

### (d) La cifra de `client-file-size.json` — **exacta, y el candado la sujeta**

`wc -l nefan-html/src/main.ts` = **1410**; base = **1417**. Cliente entero: **14.188 → 14.112 líneas (−76)**,
**57 → 56 ficheros** — las tres cifras del informe, re-contadas con `git ls-tree` sobre la base. Con 1417 en el
JSON, `test/client-file-size.test.ts` cae con el mensaje literal del criterio 11.

### (e) Los cinco hallazgos preexistentes — **cuatro confirmados, uno confirmado y ampliado**

- **Escalón «centro del tile» inalcanzable** (H2 del informe): **confirmado** en código
  (`collision.ts:74-84`: `const desde = this.deps.getPlayerPos()`) y **medido en el juego**: «casa del leñador» es
  sólida vista desde fuera (`probeCollide` = `true`) y **deja de serlo con el jugador encima** (`false`). El guion
  93 lo registra en cada corrida. Consecuencia que amplío en H2 de esta QA: el escalón 1 tampoco es observable, y
  por eso el sabotaje «devuelve `pos` sin comprobar sólidos» no pone rojo ningún guion.
- **La `R` no llega con la conversación abierta** (H3): **confirmado y acotado**. No es un accidente: es un guard
  explícito y documentado (`keyboard-input-provider.ts:51`, «Con una conversación abierta, las teclas de juego
  (moverse, atacar, elegir ataque, E/R/Y/N) están suprimidas», #314). Y **no hay estado sin salida**: el botón
  «reaparecer» se ofrece siempre que el jugador está muerto, con o sin diálogo (`main.ts:684-686`, a diferencia del
  saludo, que sí se apaga). El defecto que queda es de affordance: el botón anuncia la tecla `R`, que en ese estado
  no hace nada.
- **`jump_velocity` sin lector** (H4): **confirmado**. `grep -rn jump_velocity` = 1 hit, el propio JSON. Y un
  matiz que el informe no da: tampoco está en `PlayerConfig`, así que `loadConfig` ni lo exige ni lo tipa — vive
  del cast, invisible para `tsc`.
- **`qa/guiones/79:63` cita `MOUSE_SENS_RAD_PER_PX`** (H5): **confirmado y ampliado a tres guiones**. El nombre no
  existe en el repo (es `SENSIBILIDAD_RAD_POR_PX`, `nefan-core/src/simulation/mirada.ts:21`) y está citado en
  `qa/guiones/10:30`, `qa/guiones/61:75` y `qa/guiones/79:64` — el informe solo nombra uno.
- **`docs/combat.md` sin el bloque `player`** (H6): confirmado (`grep` de `player`/`walk_speed` a cero en ese
  fichero), pese a ser el documento que promete «editable sin recompilar» — promesa que ahora es verdad y medible
  (criterio 18).

### (f) ¿Algún otro lector de `player` recibe campos que no espera? — **no**

Censo completo. `loadConfig` es la **única** puerta del `combat_config.json`, y la cruzan: el bridge
(`bridge/ws-server.ts:62`, leyendo el fichero de disco), el cliente dos veces (`main.ts:79` y
`ui/hud-de-combate.ts:21`, por el import de Vite), seis tests de core y los guiones 84 y 89. **Todos con el JSON
real**, así que ninguno se queda sin los cuatro números. Fuera de ahí: `grep -rniE 'combat_config|speed_scale|
interact_range|walk_speed' ai_server/` → **cero** (ningún espejo Python), y cero también en el motor falso y en
`labs/`. Los dos campos nuevos son inertes para quien no los lee (el tipo no es exacto: `jump_velocity` lleva
años ahí sin estar en `CombatConfig` y no rompe nada). El único efecto colateral real es el de (b): el bridge deja
de arrancar si el config no trae los cuatro, que es exactamente el fail-loud que se pidió.

## 3 · El flujo real, desde el arranque

`NEFAN_PORT_OFFSET=600 ./start.sh --preset e2e-sin-creditos`, título → nueva partida → jugar. Nada de escenarios
preparados: las medidas salen de la partida que arranca el preset.

- **Andar y esprintar**: § 2a. Con el config del árbol, 4,1800 y 8,3600 m/s; con `speed_scale: 3.0` en el fichero,
  5,7000 y 11,4000 m/s **sin recompilar** (criterio 18).
- **`E` a 2,4 y 2,6 m**: a 2,4 m el HUD ofrece `["hablar con Tabernero corpulento"]`; a 2,6 m la barra queda vacía
  (`[]`). Idéntico en base y rama, y el borde exacto entre 2,495 y 2,505.
- **Morir y `R`**: el bandido del bench mata al jugador (se le deja pegar, sin devolver el golpe), la `R` revive a
  la primera pulsación con vida llena y el jugador vuelve **exactamente** a donde cayó, en un punto que se puede
  pisar preguntado desde 8,5 m.
- **Config mutilado**: § 2b. El bridge no arranca; el cliente queda en una pantalla muerta (H6 de esta QA).

### Crítica visual (capturas de `qa/capturas/2026-09-07T17-46-51-962Z-614060/` y `…17-32-48-346Z-596653/`)

El **momento de morir** está bien resuelto como imagen: la pantalla se apaga a un marrón oscuro que sigue siendo
legible (se distinguen la barra, las columnas y el tabernero), la vida marca `0` con la barra vacía y aparece un
único botón centrado, «R reaparecer», que es la salida. La luz es única y coherente en las dos capturas —sol bajo,
sombras suaves, el damero es del motor falso y no del arte— y las escalas se sostienen: el bandido a 1,2 m ocupa
lo que ocupa un cuerpo a un paso, el árbol y la casa del leñador son plausibles entre sí.

Lo que chirría, y son dos cosas distintas:

1. **El registro habla en otro idioma que el resto del juego.** Bajo un HUD que dice «Vida», «reaparecer»,
   «Salidas», «Bandido de camino», el registro escribe `YOU DIED — press R to respawn`, `Respawned!` y seis
   `Player hit: -24.5 HP` seguidos. Es el texto que el jugador lee en el peor momento de la partida, y es el único
   sitio de la pantalla en inglés (H9).
2. **Reaparecer devuelve al jugador al mismo peligro**: en la captura del respawn el bandido está a un paso, con
   `60/60` de vida, y el jugador acaba de volver con 100. Es la conducta que la PR conserva a propósito
   —`puntoDeReaparicion` escalón 1— pero como experiencia es un bucle de muerte, y quien decida sobre el escalón 2
   (H2) debería decidir sobre esto a la vez (H10).

## 4 · Hallazgos

| # | Sev. | Origen | Qué |
|---|---|---|---|
| H1 | **importante** | de la PR (afirmación del informe) | La §7 H1 dice «esta PR empeora la cobertura 0,107 puntos (88,9587 → 88,8516)» y pide decisión del usuario sobre ese número. **No se reproduce**: base `1f4ab084` limpia = **88,8278 %**; rama = **88,8777 %** y **88,8191 %** en dos corridas del mismo commit (`crapRows().cobGlobal` tras `npm run coverage` completo en cada punta). El instrumento varía ±0,06 puntos consigo mismo, así que la diferencia base↔rama no es medible con una pasada, y con mis números la rama sale por **encima** de la base en una de las dos. **Lo verificado y firme: `crap --check` sale con exit 1 en la base Y en la rama** → el rojo es preexistente. **Reproducción**: `git checkout 1f4ab084 && cd nefan-core && npm run coverage && npx tsx -e "import {crapRows} from './scripts/crap-score.ts'; console.log(crapRows().cobGlobal)"`, y lo mismo en `fc8468f7`. **Qué esperaba**: que un número con cuatro decimales en un informe fuera reproducible. **Destino**: corregir la cifra en la PR antes de que sea el argumento de una decisión de umbral; la decisión sigue haciendo falta, el número no la sostiene |
| H2 | **importante** | preexistente, agrandado por tener módulo propio | El escalón 1 de `puntoDeReaparicion` (`if (!solido(pos))`) es **inobservable desde el juego**: `collidesAt` es una consulta de MOVIMIENTO desde la posición del jugador (`world/collision.ts:74-84`) y el respawn le pregunta por esa misma posición. **Medido**: saboteando `reaparicion.ts` para devolver `pos` sin comprobar sólidos, **el guion 93 sigue verde** y la partida se comporta igual. Los escalones 2 y 3 son inalcanzables por lo mismo (`casa del leñador`: sólida desde fuera, no con el jugador encima). **Consecuencia**: el módulo nuevo tiene una rama viva solo en el test unitario, y ningún guion de navegador puede candarla. **Repro**: partida nueva, morir dentro del bench, `R`. **Destino**: issue «¿debe la reaparición usar una consulta de punto?» — es una decisión de diseño, no cabía en una PR de movimiento, y la PR hace lo correcto conservando la conducta y escribiéndola |
| H3 | menor | preexistente (la PR barre uno de cuatro) | Rastro de prosa no barrido: `qa/guiones/37:70` dice «Rango de interacción del cliente (`main.ts`, `INTERACT_RANGE`)». Ni el nombre ni el sitio existen tras esta PR. La PR corrigió el rastro gemelo del guion 79 y dejó este. **Destino**: un renglón, con H4 |
| H4 | menor | preexistente | `MOUSE_SENS_RAD_PER_PX` no existe en el repo (es `SENSIBILIDAD_RAD_POR_PX`, `simulation/mirada.ts:21`) y está citado en **tres** guiones: `10:30`, `61:75`, `79:64`. El informe (su H5) nombra solo el 79 |
| H5 | menor | de la PR | `loadConfig` valida el TIPO pero no el RANGO: `speed_scale: -1` y `interact_range_m: 0` cargan sin quejarse (medido). Con `-1` el jugador anda hacia atrás; con `0` la `E` no alcanza a nadie y el juego se queda sin diálogo sin decir por qué. La base tampoco validaba, pero ahora el config **es** la fuente y el fail-loud existe: le falta medio paso |
| H6 | menor | de la PR (UX del fail-loud) | Con el config mutilado, lo que **ve** el jugador en el cliente es una pantalla muerta —solo el selector «Room» y los chips de dev—, sin título, sin juego, sin panel de errores; el motivo (`CombatData: player.speed_scale debe(n) ser número finito`) solo aparece en la consola del navegador, como `pageerror`. El error ocurre al evaluar el módulo, antes de que se monte nada, así que el fail-loud del arranque del cliente no llega a hablar. En el launcher, lo mismo: `❌ bridge did not come up on :10477 within 30s` sin el motivo, que está en el log. **Repro**: borrar `player.speed_scale` de `combat_config.json` y arrancar |
| H7 | menor | preexistente | `combat_config.json` trae `player.jump_velocity: 4.5` sin un solo lector, y ahora además **fuera** de `PlayerConfig`: `loadConfig` no lo exige ni lo tipa, vive del cast. No hay salto en el juego |
| H8 | menor | preexistente (#314) | Con una conversación abierta, la tecla `R` está suprimida a propósito junto al resto de teclas de juego, pero el botón de la barra —que sí funciona— sigue anunciando «R». No hay estado sin salida (el botón se ofrece siempre que el jugador está muerto); es una etiqueta que miente en ese estado |
| H9 | menor | preexistente | Los tres mensajes del morir y reaparecer están en inglés en un juego con la UI en español: `YOU DIED — press R to respawn` y `Player hit: -N HP` (`ui/eco-del-combate.ts:108,117`) y `Respawned!` (`main.ts:553`, la línea de al lado de lo que esta PR movió, idéntica en la base) |
| H10 | menor | preexistente (diseño) | Se reaparece exactamente donde te mataron, con el enemigo intacto al lado (medido: bandido `60/60` a 1,2 m, jugador a 100). Es la conducta que la PR conserva; como experiencia es un bucle de muerte y merece decidirse junto a H2 |

Ningún hallazgo bloqueante.

## 5 · El guion 93 y sus negativos

`qa/guiones/93-la-velocidad-y-el-alcance-los-dice-el-config.mjs` (+ fila en `qa/README.md`), **16 asertos, verde**.
Mide la frontera movida, no los números de hoy: medir 4,18 m/s y 2,5 m sale igual de verde con el multiplicador a
mano. Así que **sirve el config distinto** —`page.route` sobre el módulo que Vite entrega
(`/@fs/…/combat_config.json?import`), sin tocar el fichero del árbol— y mide el juego con él:

1. sin tocar nada: andando = `walk_speed × speed_scale`, esprintando = `sprint_speed × speed_scale`;
2. con `speed_scale × 1,5`: las dos velocidades × 1,5 (4,18 → **6,27**; 8,36 → **12,54**), afirmando además que el
   trayecto medido **cupo en el campo libre** (§ 2a: sin eso se mide un muro);
3. con `interact_range_m: 1,2`: el borde se mueve (ofrece a 1,15 · no a 1,25 · **no a 2,4**, que con el config real
   sí ofrece);
4. muriendo peleando y pulsando `R`: vuelve **exactamente** donde cayó y ese punto **se puede pisar**, preguntado
   con el jugador a 8,5 m —porque `collidesAt` con él encima siempre diría «libre»—. Y registra, sin ponerlo rojo,
   la medida de H2.

Negativos, un sabotaje por vez y restaurado byte a byte (`diff -q` en los tres):

| Sabotaje | Resultado |
|---|---|
| `main.ts`: el multiplicador y el alcance otra vez a mano (`(sprint ? 3.8 : 1.9) * 2.2`, `maxDistanceM: 2.5`) — como estaba antes de la PR | **4 rojos**: `andando … medido 4.1800` donde el config pedía 6,27; `esprintando … medido 8.3600` donde pedía 12,54; la `E` ofreciendo a 1,25 m y a 2,4 m con el config servido a 1,2 |
| `reaparicion.ts`: `if (!solido(...))` → `if (solido(...))` | **1 rojo**: `vuelve EXACTAMENTE donde cayó — cayó en (11.054, 0.138) · volvió a (0.000, 0.000) · 11.055 m` (el centro del tile) |
| `reaparicion.ts`: `return { x: pos.x, y: 0, z: pos.z }` como primera línea (el sabotaje que pedía el encargo) | **SIGUE VERDE** — H2. Esa mitad la candan los 8 casos de `test/reaparicion.test.ts` (5 rojos con el mismo sabotaje), no un guion de navegador. Dicho en la cabecera del 93 y en su fila del README |

## 6 · Batería completa

Sin retocar ningún guion, en el bloque +600, con su disco efímero:

```
91 en verde · 0 en rojo de 91 · capturas en /home/al/code/ne-fan-241-8-qa/qa/capturas/2026-09-07T17-50-52-687Z-620878
```

Ni un `⊘` ni un `✘`. El encargo anticipaba `75/80 con la firma de #496/#467` y **repetir sueltos**: no hizo falta,
la corrida salió limpia a la primera. Entra el 93 nuevo; el 92 es del worktree de la PR 7 y no está aquí.

`npm run verify` en `nefan-core`: **VERIFY=0**, `tests 2387 · pass 2387 · fail 0`, corrido al abrir y al cerrar (tras
los siete sabotajes). Cliente: `npx tsc --noEmit` = 0, `npm run lint` = 0.

## 7 · Workarounds usados

| Workaround | Veredicto |
|---|---|
| `setPlayerPos` para plantar al jugador a la distancia exacta del NPC | **No afecta al jugador**: lo que se mide es un UMBRAL, no un trayecto, y el guion afirma la distancia LEÍDA tras un frame (repitiendo el plantado hasta que el NPC, que pasea, deja la distancia pedida). Andar hasta un borde de 5 mm sería medir la suerte del paso |
| Preguntar la solidez del punto de respawn con el jugador movido 8,5 m | **Es un hallazgo, no un apaño**: H2. Sin él el aserto no valdría nada (con el jugador encima, todo punto parece libre). Está declarado en el guion y en el README |
| `page.route` reescribiendo el `combat_config.json` servido al cliente | Es el **instrumento** del candado, no un apaño: no toca el árbol, el bridge sigue leyendo el fichero de disco, y el guion **afirma** que la sustitución ocurrió (`cuenta.sustituciones`) para no salir verde midiendo el config de siempre |
| Editar `combat_config.json` en disco (a `speed_scale: 3.0`, y borrándolo) | Restaurado byte a byte desde copia; `git status` limpio después. Es la prueba de la promesa «editable sin recompilar» por la vía real, no simulada |
| `git checkout 1f4ab084` + `npm run build` + `npm run coverage`, y vuelta a `fc8468f7` | Necesario para medir base y rama con el mismo método (criterios 4 y H1). `qa/README.md` fue a `git stash` y volvió; el guion 93 es untracked y sobrevivió |
| La corrida `npm run mutacion -- local paso-del-jugador` dejó `nefan-core/reports/mutation/paso-del-jugador.json` | Gitignored, no entra en el commit. **Aviso al coordinador**: `npm run mutacion -- traer` vacía ese directorio antes de bajar el artefacto, así que no estorba al reparto; si se prefiere, se borra a mano |

## 8 · No probado

- **Gasto real de créditos**: cero por construcción (motor falso, guardarraíl `fake:true` en los 91 guiones, HUD
  `gasto sesión 0,00 €`). Nunca se tocó un servicio de pago: no se puede afirmar nada sobre coste real.
- **Los escalones 2 y 3 de `puntoDeReaparicion` en el juego**: inalcanzables (H2). Viven solo en
  `test/reaparicion.test.ts`.
- **Score de mutación de `reaparicion` y `hablar-con-un-npc`**: `permisoLocal` los rechaza por coste desconocido
  (medido: «NO se mide aquí: no hay medida previa»). Van en la autorización 2, como declara el plan.
- **`E` con una conversación abierta, en vivo**: cubierto por `test/hablar-con-un-npc.test.ts` («con conversación
  abierta no se ofrece ni pulsando»), por mi tabla de equivalencia (traza «con conversación abierta») y por el
  guion 83; no lo re-medí a mano en el navegador.
- **Otro cliente**: no existe hoy, así que el motivo declarado de #241 (lógica compartida entre clientes) se razona,
  no se ejerce.
- **La cifra exacta de cobertura como medida estable**: H1. Lo que puedo afirmar es el veredicto del gate
  (rojo en las dos puntas), no una diferencia de centésimas.

## 9 · Estado del árbol al cerrar

`git status --short` → `M qa/README.md` (fila del guion 93) y `?? qa/guiones/93-la-velocidad-y-el-alcance-los-dice-el-config.mjs`.
Sin commitear, como pide el encargo. Los siete sabotajes de esta validación (cifra vieja del tamaño, cinco tokens en
el cliente, entrada de mutación quitada ×2, `reaparicion.ts` ×2, `hablar-con-un-npc.ts`, `combat_config.json` ×3,
`main.ts` con el multiplicador de vuelta) fueron restaurados y comprobados con `git status` o `diff -q` tras cada uno.

## Nota del coordinador al incorporar el informe (2026-09-07)

H3 y H4 (rastros de prosa: `INTERACT_RANGE` de `main.ts` en el guion 37; `MOUSE_SENS_RAD_PER_PX de main.ts` en los guiones 10, 61 y 79)
barridos por el coordinador en la rama, solo comentarios. H1: la cobertura local sale roja sobre `main` y sobre la rama por igual → #525,
con la causa raíz ya escrita allí. H2 + H10 (el escalón «centro del tile» de la reaparición inobservable desde el juego, y el bucle de muerte
al reaparecer donde te mataron) → issue propio. H5 + H6 + H7 (`loadConfig` sin rango, pantalla muerta con el config mutilado,
`jump_velocity` sin lector) → issue propio. H8 + H9 (el botón anuncia «R» aunque la R no llegue con el diálogo abierto; «YOU DIED»,
«Respawned!» y «Player hit» en inglés) → comentario en #506.
