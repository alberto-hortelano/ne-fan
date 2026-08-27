# QA · Todo hueco admite el cuerpo mayor · rama `feature/hueco-cuerpo-mayor` (`2d8b87c`, `c83aecb`)

Validado contra la petición ORIGINAL en una frase: **que nadie pueda entregar un plan de escena
en el que un cuerpo —jugador o NPC— quede encerrado, y que el validador lo detecte con cuerpo en
vez de con un punto sin dimensión.** Manda el «Reencuadre» de `requisitos.md` (criterios 2 y 5 y
pregunta 4 retirados) y, dentro de `implementacion.md`, la sección «Revisión».

Todas las medidas de abajo son MÍAS: escenas propias, el corpus recorrido a mano, el bridge en
vivo y el juego arrancado desde el título. Las roturas se hicieron en un **worktree aparte**
(`git worktree add`), nunca en el árbol principal. Cero créditos: `e2e-sin-creditos` con motor
falso declarado por cliente y bridge.

## Criterios

| Criterio (de dónde sale) | | Evidencia |
|---|---|---|
| **A** · una sola fuente de verdad del cuerpo mayor, derivada y no escrita a mano (`NPC_RADIUS_M` exportado, `BODY_RADIUS_M = max(player, npc)`) | ✅ | `celdasLibresParaRadio` contrastada contra el COLLIDER REAL, no contra otra fórmula: barrido de `blocksCircle` sobre pasillos de 1..5 celdas → `R=0,4` pasa desde n=2 (fórmula: 2) · `R=0,5` desde n=3 (fórmula: 3). Borde: mpc 0,49→3 · 0,50→3 · 0,51→2. **En negativo** (worktree): `BODY_RADIUS_M = PLAYER_RADIUS_M` ⇒ **17 tests rojos** en 10 suites |
| **B** · suelo derivado en el zod para `doors[].w` y `gate.w`, con el mínimo EN METROS | ✅ | Contra el bridge VIVO (`POST /scene/validate`, el mismo endpoint del pre-flight): `doors[].w: 2` ⇒ `ok:false` · *«un vano de menos de 3 celdas (**1,5 m**) no lo cruza un NPC (su cuerpo mide 1 m…); ensancha el vano»*; `w: 3` ⇒ `ok:true`. `MIN_VANO_CELDAS = celdasLibresParaRadio(BODY_RADIUS_M, TILE_MPC) = 3`, derivado. **En negativo**: `.min(...)` → `.positive()` ⇒ 4 rojos |
| **C** · la erosión es `floor(2R/mpc)+1` = **3**, NO el AABB (2) | ✅ | El MISMO tile (pinzamiento de 1 m) juzgado por mí con los tres `k`: `k=1` → NPC alcanzable **true** · `k=2` (AABB) → **true** · `k=3` → **false** (16240 → 15994 celdas). Con 2 celdas el candado habría nacido verde sobre su propio caso. **En negativo**: `k = round(2R/mpc)` ⇒ 9 rojos, incluido el del bridge |
| **C** · el candado NO enumera productores: **pinzamiento que no es una puerta** (dos `prop` a 1,2 m) | ✅ | Escena propia, vano legal `w:4` pinzado por dos barriles a 1,0 m ⇒ `ok:false` con dos errores (*el vano … no lo cruza un cuerpo* + *el NPC "posadero" … no es alcanzable*). A 1,5 m el mismo tile es `ok:true`. Vano de 6 celdas pinzado a 2 libres ⇒ también error |
| **C** · la **puerta de 1 m** | ✅ | Rechazada por el zod antes de llegar al collider (arriba). Como vano ya tallado, el flood la caza igual (caso de arriba) |
| **C** · severidad: **error**, no aviso | ✅ | Tabla `SEVERIDAD` única (`scene-validate.ts:174`), `ok = errors.length === 0`. **En negativo**: `"hueco-sin-cuerpo": "error" → "aviso"` (UNA línea) ⇒ **15 rojos en 5 ficheros**; `"nace-en-solido"` → aviso ⇒ 8 rojos |
| **D** · el NPC que nace en celda sólida o en un hueco donde su cuerpo no cabe | ✅ | Escenas propias: NPC empotrado en un `prop` ⇒ *«nace en [60, 55], celda no transitable…»*; NPC en un **nicho de 1 celda** con vecina libre y alcanzable ⇒ *«un hueco donde su cuerpo no cabe: hacen falta 3 celdas…»*; control en campo abierto ⇒ `ok:true`. **En negativo**: devolver el predicado al punto (`isWalkable`) ⇒ 8 rojos, entre ellos *«un NPC en un NICHO de una celda es ERROR»* |
| **(auditoría pedida)** la unidad del veredicto de vanos pasa de la celda al **vano entero** — ¿se sostiene y no abre puerta trasera? | ✅ | **Se sostiene**: reproducido en `alta_fantasia/tile_0_0` — el vano `"s"` de `"taberna"` declara 4 celdas `[63..66]`, las tres primeras alcanzables y **`[66,63]` es SÓLIDA**; por celda, ese tile bueno saldría rechazado. **No abre puerta trasera**: un vano de 1 m entero da 0/4 celdas cubiertas ⇒ error; uno de 6 celdas pinzado a 2 libres ⇒ 0/6 ⇒ error. Un hueco libre de 3 celdas necesita 3 consecutivas para un ancla, así que ningún paso de 1 m puede quedar cubierto. **Pero el MOTIVO escrito es falso** → hallazgo 3 |
| Corpus: **4 mundos base + 3 fixtures** con `ok:true` | ✅ | Recorrido entero, no solo `tile_0_0`: **12 escenas de mundo + 3 fixtures = 15**, todas `ok:true`, 0 errores. Único aviso con contenido: la celda `[66,63]` de `alta_fantasia` |
| Corpus: **5 entities recolocadas** moviendo el dato, sin relajar el candado | ✅ | Las 5 están en disco donde dice el informe. Devolviendo cada una a su celda anterior: `barkeep [60,52]`, `npc_curandera [30,62]`, `npc_carbonero [104,40]`, `dentro_sur [87,91]` ⇒ *«celda no transitable»*; `colonia_aster player [64,96]` ⇒ *«el spawn del player … no es transitable»*. Diff de datos commiteado = **una celda** (`zorder_test`). Cero `passable:true`, cero excepciones, cero listas de exclusión en el diff |
| `npm run verify` verde · umbrales · deuda sin crecer | ✅ | Worktree limpio: build + typecheck + lint + **1577/1577**. `crap --check`: *«Tope CRAP ≤ 73 — 0 por encima · cobertura 89,8 % ✔ dentro de los umbrales»*. `npm run deuda`: **68 items**, el mismo número que reporta el ingeniero para `main` `c1e76b6`; `mutacion-huella.json` no se toca en el diff, así que la deuda de mutación no puede haberse movido |
| Flujo real desde el arranque | ✅ | `node qa/run.mjs` (levanta `--preset e2e-sin-creditos` él solo): **30 en verde · 0 en rojo de 30**. No reprodujo la intermitencia de `22-telegraph` que reporta el ingeniero. Y la partida que la batería NO toca (borra los snapshots de mundo): `./start.sh --preset e2e-sin-creditos` a mano, entrando a `alta_fantasia` por el título ⇒ partida en marcha, sin muro de error, el tabernero con su cuerpo libre y **20,98 m recorridos en 60 s** (contra los 0,72 m del tabernero empotrado que contaminó #247/#262/#284). Capturas: el tabernero está de pie junto al mostrador, no dentro |
| **Nadie puede ENTREGAR un plan con un cuerpo encerrado** | ❌ | Hay un camino donde NINGÚN chequeo de cuerpo corre: un tile sin cruces requeridos y sin entrada. Medido contra el bridge vivo y sobre el mundo embarcado → **hallazgo 1** |
| **Todo cuerpo cabe donde el corpus lo planta** (medido con el collider real, no con la máscara) | ❌ | 37 entities del corpus auditadas con `planCollisionGrid` + `terrain_grid` (el collider que comparten cliente y sim): **1 falla** — `halmar_molinero` de `robledo_tile` → **hallazgo 2**. Lo caza el guion nuevo |
| `narrative-mcp`: `isError` del cuerpo y no del estado HTTP | ⚠️ | Leído y correcto (`/scene/validate` contesta **200** también con `ok:false` — lo confirmé en vivo), pero el paquete no tiene batería y el servidor MCP no corre en el bench. **No probado** |
| Mutación de `blueprint-volumenes` | ⚠️ | 362 mutantes contra un tope local de 120: pedida y sin volver. **No probado** |

## Hallazgos

### 1 · IMPORTANTE — un tile sin costuras ni entrada no se comprueba: ni encierro, ni cuerpo, ni «nace en sólido»

`checkReachability` sale antes de correr el flood cuando no hay ni cruces requeridos ni entrada
(`scene-validate.ts:886-900`, aviso `no-verificado`), y **todos** los chequeos de NPC viven dentro
del flood. Resultado: un plan con un NPC empotrado en un `prop` se entrega como jugable.

**Reproducción** (desde el arranque, cero créditos):

```bash
NEFAN_PORT_OFFSET=900 ./start.sh --preset e2e-sin-creditos     # bridge :10777, State API :10778
curl -s -X POST http://127.0.0.1:10778/scene/validate -H 'content-type: application/json' \
  -d '{"scene":{"tile":{"tx":9,"ty":9},"scene_id":"tile_9_9","scene_description":"x","biome":"meadow",
       "volumes":[{"id":"mostrador","label":"mostrador","type":"prop","shape":"box","rect":[58,54,6,2]}],
       "entities":[{"id":"tabernero","kind":"npc","name":"T","cell":[60,55],"footprint":[1,1],"glyph":"n"}]}}'
```

```
ok: true · errores: [] · avisos: ["tile sin cruces de vecinos ni entrada conocida: alcanzabilidad no verificada"]
```

El NPC está DENTRO del prop y la escena pasa. Lo mismo con el pinzamiento de 1 m: `ok:true`.

**Y es un camino vivo, no teórico.** `bridge/handlers/game-gen.ts:192` genera el anillo 3×3 del
mundo con `generateTileScene(ctx, tx, ty)` **sin `approachEdge`**, o sea sin entrada. Reproduje el
orden real del `RING` sobre el snapshot embarcado de `alta_fantasia`:

```
tile_-1_-1: vecinos cargados=0 · cruces requeridos=0 · *** ALCANZABILIDAD NO VERIFICADA ***
tile_0_-1 : cruces requeridos=1 · flood corrido
tile_1_-1 : cruces requeridos=1 · flood corrido
tile_-1_0 : vecinos cargados=2 · cruces requeridos=0 · *** ALCANZABILIDAD NO VERIFICADA ***
tile_1_0  : flood corrido      tile_-1_1 : *** ALCANZABILIDAD NO VERIFICADA ***
tile_0_1  : flood corrido      tile_1_1  : flood corrido
```

**3 de los 8 tiles del mundo que se embarca no recibieron ni un chequeo de cuerpo.** Hoy no llevan
NPCs (0/0), así que no hay nadie encerrado; pero la garantía que compra la tanda no cubre el
camino por el que se fabrica el mundo. Lo que el jugador vería el día que ocurra es lo de siempre:
un NPC que no se mueve y se lee como ambiente.

No es una regresión de esta tanda (el `return` temprano ya estaba), y el reencuadre no lo pedía.
Es que el criterio 4, cumplido, no basta para la frase de la petición.

### 2 · IMPORTANTE — un cuerpo dentro de un sólido en una fixture COMMITEADA, y el candado nuevo no lo ve

`halmar_molinero` (`data/scenes/robledo_tile.json`, celda `[104, 52]`) está plantado pegado al muro
sur del molino (`derived_ent_molino`, rect `[98, 44, 10, 8]`, filas 44..51). Su celda es pisable y
`validateScene` da la fixture por buena — pero el collider COMPARTIDO por el cliente y por el sim
del bridge (`planCollisionGrid`) bloquea esa posición **para r=0,4 y para r=0,5**: media celda son
0,25 m, y cualquier cuerpo centrado ahí invade la celda sólida de al lado.

**Reproducción** (desde el arranque): `node qa/run.mjs 32` →

```
robledo_tile: … halmar_molinero@[20.25,-5.75] punto=false cuerpo=false
✘ en robledo_tile todo NPC tiene sitio para su CUERPO donde nace
```

Auditando el corpus entero con ese collider: **1 de 37 entities** falla, y es ésta. Las 5 que movió
el ingeniero salen todas limpias.

Es exactamente el residuo que `implementacion.md` declara y deja fuera de alcance («celda pisable»
≠ «aquí cabe un cuerpo»), pero está en datos que se sirven al jugador, y el criterio del corpus
(«las 3 fixtures dan `ok:true`») no puede verlo porque mide con la máscara, no con el collider. El
NPC no queda atrapado para siempre —`blocksMove` tiene semántica «salir sí, entrar no»—, pero
nace solapando un muro, el jugador no puede pisar donde él está y su primer movimiento hacia el
molino está bloqueado.

Arreglo del mismo tamaño que los otros cinco de la tanda: mover la entity (medido: `[104, 55]` deja
el aserto en verde). Decidir si además el validador debe exigirlo es la decisión de diseño que el
ingeniero declaró fuera de alcance.

### 3 · MENOR — el motivo escrito para «la unidad es el vano entero» es falso, y tapa un aviso que sí significa algo

La decisión es correcta (verificada arriba), pero la razón que la acompaña —congelada en dos
comentarios de código (`scene-validate.ts:571-576` y el docblock de `checkDoorsReachable`) y en la
sección «Revisión» de `implementacion.md`— dice:

> con cuerpo, las celdas del BORDE de un hueco quedan **siempre** sin cubrir […] así que «alguna
> celda de vano no alcanzable» es geometría normal y no dice nada

Medido: vanos limpios de 3, 4 y 6 celdas ⇒ **0 celdas sueltas** en los tres (un ancla de 3×3
cubre todas las celdas de un hueco de 3 o más). La celda suelta de `alta_fantasia` no es geometría
normal: es que ese rect declara **dos** puertas del mismo vano por dos rutas —la `room` de
`structures` con `width: 3` y el `building` cutaway con `w: 4`—, así que la cuarta celda del vano
declarado nunca se talla y sale sólida. O sea: el aviso está señalando la duplicación
`structures`/`volumes` que el crítico documentó, y el comentario enseña a leerlo como ruido.

### 4 · MENOR — un vano legal tapado por DENTRO no se reporta como vano

Con una barricada (`prop`) justo detrás de una puerta legal, las celdas del umbral siguen cubiertas
por anclas de fuera, así que `checkDoorsReachable` no dice nada. Si hay un NPC dentro, salta él
(`ok:false`, correcto). **Sin NPC dentro, el tile pasa `ok:true`** con un interior inalcanzable.
No contradice la petición (nadie queda encerrado si no hay nadie), pero conviene saber que el
chequeo de vanos contesta «se llega al umbral», no «se cruza».

### 5 · MENOR — `probeCollide` mide el cuerpo del JUGADOR, no el del NPC

`implementacion.md` acredita las cinco recolocaciones con *«probeCollide sobre la colisión REAL del
juego: solido:false»*. `probeCollide` sondea con `PLAYER_RADIUS` (0,4), no con el 0,5 del NPC
(`nefan-html/src/world/collision.ts:30`). Las cinco colocaciones son correctas igualmente (las
verifiqué con el collider compartido a r=0,5), pero la frase acredita menos de lo que dice. En el
guion nuevo el cuerpo de 0,5 se compone con cuatro sondeos de 0,4 a ±0,1, que da el AABB exacto.

### 6 · INFORMATIVO — el corpus verde de los mundos es el de ESTA máquina

3 de las 5 recolocaciones viven en `data/games/*/world/tile.json`, que `.gitignore:81` deja fuera.
El ingeniero lo declara (desviación 1) y mueve el candado a `bridge-tile.test.ts`, que es la
decisión correcta. Anotado aquí porque el mundo de un clon limpio se regenera por `generate_game`,
que es justo el camino del hallazgo 1: el arreglo de los datos no viaja y el camino que los produjo
sigue sin comprobar.

## El guion

`qa/guiones/32-nadie-nace-donde-no-cabe-su-cuerpo.mjs` — la mitad mecánica de esto, ejecutable:
las 3 fixtures commiteadas del selector «Room» y una partida real, midiendo con el collider REAL
del cliente si el cuerpo (0,5 m) cabe donde el juego planta a cada NPC, más el spawn del jugador y
que alguien con sitio se mueve de verdad.

Va en `qa/guiones/` porque es browser-driven y entra por el camino del jugador (título → selector →
partida). **Nace ROJO** por el hallazgo 2, a propósito y documentado en su cabecera; el resto de
sus asertos están en verde.

Probado en negativo, en el worktree:

| Sabotaje | Resultado |
|---|---|
| molinero movido a `[104, 55]` | paso 1 **entero en verde** — el rojo de hoy es el dato, no el guion |
| `dentro_sur` devuelto a `[87, 91]` (lo que arregló esta tanda) | **rojo** nombrando al NPC |
| umbral de movimiento a 0 | pasaría siempre ⇒ va PAREADO con el de cuerpo libre, y así está escrito |

Lo que NO metí en el guion, y por qué: el candado del validador contra el bridge vivo
(`POST /scene/validate` con el pinzamiento de 1 m) necesita **contexto de bootstrap**, y el bridge
conserva la sesión anterior entre guiones — medido: con una partida viva el mismo POST contesta
por costuras y por el `player` sobrante, y el error de cuerpo desaparece. Un aserto así sería
verde-o-rojo según el orden de la batería. Queda como medida de este informe.

## Workarounds usados

| Workaround | Veredicto |
|---|---|
| Worktree aparte (`git worktree add`) + symlinks de `node_modules` para romper el código sin tocar el árbol principal | Mío, no del usuario. Efecto colateral medido: los symlinks ponen rojo `repo-hygiene.test.ts` (*«un enlace a un destino gitignoreado»*); quitándolos, `npm run verify` sale verde entero. Ninguna de las roturas tocó el árbol principal |
| El worktree nace sin `nefan-html/public/sprites` (gitignoreado) y ahí el juego se NIEGA a empezar partida | Comportamiento correcto y ya candado (#255, guiones 27/29). Symlinké las hojas para poder correr el guion; no es un hallazgo |
| Arrancar el stack a mano con `NEFAN_PORT_OFFSET=900` para jugar el mundo PRE-GENERADO | Necesario: `qa/run.mjs` **borra** los snapshots de mundo del disco efímero (`limpiarMundos`), así que ningún guion de la batería juega los mundos embarcados. No es un apaño de la prueba, es un límite del banco — y es la razón por la que el corpus de mundos solo lo mira este informe |
| Ninguno para ver la feature | No hice falta ocultar overlays, forzar estado ni saltarme el título en ningún momento |

## No probado

- **La corrida de mutación de `blueprint-volumenes`** (362 mutantes > tope local 120): pedida por el
  ingeniero, no vuelta. No sé si los 6 tests del suelo del vano matan a sus mutantes.
- **`narrative-mcp` `isError`**: el paquete no tiene batería y el MCP no corre en el bench. Verifiqué
  la premisa (el endpoint contesta 200 con `ok:false`) y leí el arreglo; no lo ejercí.
- **El motor REAL re-respondiendo al rechazo** (pre-flight MCP, sin límite de reintentos): el bench
  no tiene motor. Con el motor real, un tile marginal ahora mata la exploración en el bridge, que
  lanza sin reintentar (`handlers/tile.ts:149`) — riesgo declarado en el plan §8.4, no observado.
- **Gasto de créditos**: cero por construcción, y comprobado por las dos vías (`stackSinCreditos`:
  cliente y bridge declaran `fake:true`). Nada de esta tanda toca generación de imagen.
- **La deuda contra `main`**: medí la rama (68 items, umbrales verdes); no volví a medir `c1e76b6`.
  El número coincide con el que reporta el ingeniero y la huella de mutación no está en el diff.

## Veredicto

**Apto con reservas.**

Lo que se pidió está hecho y, esta vez, **candado de verdad**: rompí uno a uno los seis mecanismos
(la erosión, la fuente del radio, el suelo del zod, la severidad, el predicado del NPC y el dato de
la fixture) y los seis se ponen rojos, con un radio de fallo que va de 4 a 17 tests. La trampa que
hundía la primera versión —erosionar por el AABB— la comprobé por mi cuenta: con `k=2` el
pinzamiento de 1 m **pasa**, y solo con `k=3` cae. El corpus está verde sin una sola excepción ni un
`passable:true` de conveniencia, y el juego arranca y se juega. La corrección que se me pidió
auditar —subir el aviso de puertas por VANO y no por celda— **se sostiene** (`[66,63]` es
efectivamente una celda sólida de un vano bueno) y **no abre puerta trasera**: un vano de 1 m
entero sigue siendo error por las dos vías.

Las reservas son dos, y ninguna es una regresión: la garantía tiene un camino sin vigilar —el que
fabrica los mundos que se embarcan— por el que un NPC empotrado pasa como jugable (hallazgo 1), y
queda un cuerpo dentro de un sólido en una fixture commiteada que el criterio del corpus, tal como
está escrito, no puede ver (hallazgo 2). Las dos caen en la frase de la petición; ninguna estaba en
el alcance aprobado. Si vuelven al mismo ingeniero, son un `it` en `bridge-tile` y una celda de
`robledo_tile`.
