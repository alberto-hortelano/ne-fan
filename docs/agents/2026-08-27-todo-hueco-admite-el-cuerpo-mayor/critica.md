# REENCUADRADA

El agujero es real y lo he reproducido. Lo que está mal es el **tamaño** de la tarea: de sus
ocho criterios, tres son no-ops numéricos hoy, uno se apoya en un contrato que no existe, y el
único que carga valor —el flood-fill con cuerpo— **no cierra el issue tal como está escrito**.

## El problema real, en una frase

Nadie comprueba nunca si el plan que entrega el motor es transitable **para un cuerpo**; se
comprueba para un punto sin dimensión, y cada productor de huecos se defiende (o no) por su
cuenta con un número escrito a mano.

La solución que propone el issue —una constante derivada por sitio— ataca los productores que
alguien se acordó de enumerar. El problema está una capa más arriba: es una carencia del
**verificador**, no de los emisores.

## La premisa, afirmación por afirmación

| Afirmación del issue / requisitos | Verificación |
|---|---|
| Puerta de 1 m: pasa el jugador, nunca el NPC | **CIERTA.** Medido con `volumeCollisionGrid` + `createTerrainCollider` + BFS con cuerpo sobre edificio `cutaway` 24×16: `w=1` nadie sale · `w=2` (1 m) jugador sale, NPC queda en 2.880 celdas · `w=3` (1,5 m) salen los dos |
| Es aritmética, no azar | **CONFIRMADO.** `terrain-collision.ts:102-113` recorre `floor((x−r−o)/mpc) … floor((x+r−o)/mpc)` **inclusive**: un hueco de n celdas admite radio R sólo si `n·mpc > 2R`. R=0,4 → n≥2 · R=0,5 → n≥3 |
| `PLAYER_RADIUS_M = 0.4` exportada | Cierta — `src/scene/terrain-collision.ts:23` |
| `NPC_RADIUS = 0.5` privada | Cierta — `src/simulation/npc-behavior.ts:89`, sin `export`, 3 usos internos |
| `Math.ceil(1.1 / mpc)` literal mágico | Cierto — `src/scene/scene-expand.ts:263`. **Pero a mpc 0,5 vale 3 = exactamente el mínimo del NPC.** Está bien por casualidad, no por derivación |
| `doors[].w` sin suelo | Cierto — `src/scene/blueprint/volumes.ts:127`, `positive().max(16)`. `gate.w` igual (`volumes.ts:175`, `positive().max(24)`) |
| El flood-fill no tiene cuerpo | Cierto — `scene-validate.ts:595-624`, 4-conexo celda a celda |
| El flood-fill no ve los muros de `volumes` | **FALSO** (lo insinúa el comentario de `scene-validate.ts:535`). `buildWalkableMap` (`:359`) resta `planMask.solid(c,r)`, y `planCollisionGrid` incluye `volumeCollisionGrid`, que estampa el anillo `t=1.5` y talla la puerta. La máscara SÍ ve el agujero; lo que le falta es cuerpo |
| «La puerta más estrecha del corpus mide 1,5 m» | Cierta. Corpus entero: `alta_fantasia` `structures.doors[].width:3` (1,5 m) y `volumes` `w:4`; `cuentos_oscuros` `w:4`; `toledo_1200` `w:5`; `zorder_test` `w:4`; `robledo_tile`/`puerto_tile` sin puertas. `colonia_aster` no tiene `world/tile.json` |
| «El mínimo interior entrable es 6×6 jugador / 8×8 NPC» | **6×6 cierta, 8×8 falsa.** Medido en `cutaway` con puerta `w=4`: 6×6 el jugador entra y el NPC no cabe; **7×7 entran los dos** |
| Retirar el auto-ensanchado de `structures` «es un cambio de contrato con el motor» (pregunta 1) | **FALSO.** `structures` **no está** en `data/contract/tools/generate_scene.json` (`input_schema.properties` = biome, entities, ground, place_id, scatter_*, scene_description, scene_id, size, terrain, terrain_legend, tile, vegetation_zones, volumes) ni en el zod `scene-schema.ts`; sólo sobrevive por `.passthrough()` (`:124`), por `scene-expand.ts` y por **un** artefacto commiteado: `data/games/alta_fantasia/world/tile.json` → `scenes.tile_0_0.structures`, una `room` en `[52,48,24,16]` **redundante con el `building` cutaway del mismo rect**. No hay contrato que romper |
| «Nadie ha visto un NPC encerrado» | Cierta, y el prompt lo hace poco probable: `tile_instructions.md:122-123` documenta `w?=4` y no ofrece motivo para bajar |

## El día después

- **No sube ningún mínimo.** `minDoorCells` a mpc 0,5 ya es 3 = el mínimo del NPC. `PASO_LIBRE_CELDAS` ya es 3, y derivado de 0,5 da `ceil(2·0,5/0,5)+1 = 3`: **idéntico**. Luego `MIN_SEP_TREE` (5,16) no se mueve, la curva de densidad no se mueve, no hay corpus que regenerar, ninguna puerta declarada se ensancha y **ninguna clave de caché de arte rota**. El criterio 2 («si el mínimo sube de 3 a 4…») describe algo que no ocurre, y la pregunta 4 se responde sola: entra gratis y no cambia nada.
- **Queda torcido el candado que más se cree hecho.** Erosionar la máscara por el AABB (2·0,5/0,5 = **2** celdas) declara transitable la puerta `w=2` que el collider real bloquea: el corredor de puerta mide dw×3 celdas y contiene un bloque 2×2 libre. La erosión tiene que reproducir `floor(2R/mpc)+1` = **3**, o el candado nace verde sobre su propio caso. Es la cuarta de la semana.
- **Y queda torcido el veredicto.** Un NPC inalcanzable hoy es **warning**, no error (`scene-validate.ts:661`), y los warnings no rechazan (narrative-mcp los rotula «playable, but review»). Con el flood-fill con cuerpo pero la severidad intacta, el motor puede seguir entregando la escena que encierra al NPC. El criterio 4 **no cierra el issue** sin decidir también la severidad — y *eso* sí es el cambio de contrato, no lo de `structures`.
- **«El cuerpo mayor» es una ficción que el sim no honra.** `footprint` no aparece ni una vez en `src/simulation/` ni en `bridge/`: una criatura con `footprint:[8,8]` (el contrato pone `minimum: 1` y **ningún máximo**) se mueve como un círculo de 0,5 m. La fuente única del criterio 1 congelaría un número que el contrato ya contradice.
- **Enumerar los tres agujeros es el eje equivocado.** `prop`, `rock`, `tower`, `fountain`, `prism`, `custom` y `wall` estampan sólidos (`collision.ts:270-313`) sin ninguna regla de separación entre ellos; `gate.w` no tiene suelo igual que `doors[].w`. Dos props a 1,2 m pinzan un paso exactamente igual. Lo que los cubre a todos —incluidos los que nadie listó— es el chequeo agnóstico del productor, no tres constantes.
- **Se borrará mal.** El día que se derive el `1.1`, quien lea `scene-expand.ts` verá un expander vivo para una primitiva que el motor no puede declarar. Lo arbitrario dentro de un mes será por qué se invirtió trabajo en derivar el suelo de una puerta de una ruta muerta.

## Conflictos

- **#262 (abierto, medido)** — «el mercader que huye avanza 1 m en 30 s», y su hipótesis 1 es un NPC atascado contra geometría. Es el **mismo síntoma observable** que #289 (un NPC que no llega a ninguna parte), **está pasando de verdad** y sale del pathfinding, que `requisitos.md` pone explícitamente fuera de alcance. No es contradicción: es inversión de prioridad. Hacer #289 completo antes de #262 compra una garantía sobre huecos mientras el NPC no cruza campo abierto.
- **#187 (abierto)** — la huella declarada de `gate` y su colisión son **disjuntas**, congelado en `test/volume-metrics.test.ts:92-124`. La pregunta 2 («¿entra `gate`?») aterriza justo ahí: cualquier regla sobre el vano de un `gate` se decide con #187 delante, no antes.
- **#203 (abierto)** — `generate_scene.json` y el zod no tienen guardia de deriva. Poner suelo a `doors[].w` en el zod sin tocar `tile_instructions.md:122` (`w?=4`) crea exactamente esa deriva.
- **`CLAUDE.md`, «Pre-producción: cero compatibilidad»** — apunta a **borrar** `structures` entero el mismo día, no a derivarle un suelo mejor. Y **«Fail-loud al modelo»** respalda rechazar en vez de ensanchar, pero sólo sirve si el mensaje dice el mínimo: los textos del validador son contrato congelado por `test/scene-validate-golden.test.ts`.

## Coste contra valor

Hay dos tareas metidas en una. La barata —exportar el cuerpo, suelo en el zod a `doors[].w` y
`gate.w`, flood-fill con cuerpo **con la erosión correcta y la severidad decidida**— cierra el
único agujero alcanzable y no toca corpus, arte ni contrato de datos. La cara —derivar el `1.1`,
retirar el auto-ensanchado, ampliar vegetación, tres asertos de familia— no cambia **ningún
número** hoy y toca una ruta que el motor no puede usar.

No hacer nada: el fallo exige que el motor ofrezca `w:2` contra un prompt que dice `w?=4`, en un
edificio `cutaway`, con un NPC dentro. No ha pasado nunca. Pero cuando pase es permanente,
silencioso y se lee como ambiente — que es literalmente lo que llevaba semanas pasando en #262.
Por eso la mitad barata sí vale; la cara, no.

## Qué le cambiaría a `requisitos.md` (redactado para pegarse)

> **Alcance recortado.** Se hacen (1) `NPC_RADIUS` deja de ser privado y pasa a fuente única del
> cuerpo mayor; (3) suelo derivado en el zod para `doors[].w` **y `gate.w`**; (4) flood-fill de
> `validateScene` con cuerpo. **Se retiran** los criterios 2 y 5 y la pregunta 4.
>
> **Criterio 2 → se sustituye por**: `structures` no está en `generate_scene.json` ni en el zod;
> su único consumidor vivo es una `room` redundante en `data/games/alta_fantasia/world/tile.json`.
> El arquitecto decide entre borrar la ruta entera (línea de `CLAUDE.md`) o dejarla intacta.
> Derivarle el suelo al `1.1` **no** está entre las opciones: a mpc 0,5 ya vale 3, que es el
> mínimo del NPC. Ningún mínimo sube, ningún corpus se regenera, ninguna clave de caché rota.
>
> **Criterio 4 → se amplía**: la erosión debe reproducir `floor(2R/mpc)+1` (3 celdas a mpc 0,5),
> **no** el AABB (2), o el candado nace verde sobre la puerta de 1 m; y hay que decidir la
> **severidad**: hoy un NPC inalcanzable es warning (`scene-validate.ts:661`) y el motor lo
> ignora. Sin subirlo a error, el flood-fill con cuerpo no cierra el issue.
>
> **Criterio 5 → se sustituye por**: el candado no enumera productores. Se prueba en negativo con
> la puerta de 1 m y con **un pinzamiento que no sea una puerta** (dos `prop`/`rock` a 1,2 m),
> que es la clase que las tres constantes no cubrirían.
>
> **Pregunta 1 → resuelta**: no hay contrato con el motor que romper. La decisión rechazar-vs-
> ensanchar se toma sólo para la ruta `volumes`, y el mensaje debe decir el mínimo en metros.
>
> **Pregunta 2 → aplazada**: `gate.w` recibe el mismo suelo, pero cualquier cosa sobre su vano
> se decide con #187 delante (huella y colisión disjuntas, congeladas en un test).
>
> **Pregunta 4 → resuelta y cerrada**: `PASO_LIBRE_CELDAS` derivado de 0,5 da 3, el mismo valor
> que hoy. Se cambia la derivación por coherencia si sale gratis; no hay coste que acotar.
>
> **Orden**: #262 primero. Es el mismo síntoma (un NPC que no llega a ninguna parte), está
> medido en vivo y vive en el pathfinding que esta tarea excluye.
