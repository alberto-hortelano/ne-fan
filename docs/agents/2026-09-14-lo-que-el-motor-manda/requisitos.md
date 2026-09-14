# Tanda B · «Lo que el motor manda»

## De dónde sale

Del triaje del backlog del 2026-09-10, cuyas doce decisiones contestó el usuario el 2026-09-14.
Su mensaje literal al entregarlas: **«Mutacion corriendo, decisiones respondidas»**.

Las respuestas están en `docs/agents/2026-09-10-triaje-del-backlog/decisiones.md` y se citan
literales abajo. **No se reabren**: el crítico verifica premisas y hechos del código, no vuelve a
plantear la elección.

## Qué entra

### 1 · #532 — el contrato de `spawn_entity` no distingue una llave de un carro

Respuesta literal: **«- R: c»**, sobre estas opciones:

- (a) `spawn_entity` gana `footprint` opcional
- (b) gana `kind: "item"`
- **(c) ELEGIDA — las dos.** (Era la recomendada.) «Toca zod, espejo Python y tool JSON.»

Hoy **todo `object` que spawnea el motor es un muro sólido de 1,5 m**: una «bolsa de monedas» es un
muro que no puedes atravesar.

### 2 · #524 — los spawns se reparten a 1,8 m fijos sin mirar su huella

Estaba **bloqueado por #532** y por eso entra detrás en la misma tanda: el propio triaje lo dejó
escrito — «hacer #524 antes es escribir un test que #532 reescribe». Con las cajas sólidas de #489,
un reparto ciego a la huella puede dejar al jugador encajonado.

### 3 · #529 — un enemigo inválido tumba el FRAME entero

Respuesta literal: **«- R: a»**, sobre estas opciones:

- **(a) ELEGIDA** (era la recomendada) — «Se cae solo él, los demás entran, y el motivo vuelve al
  motor y al registro — es lo que el cliente ya hace.»
- (b) descartada — seguir tirando el frame entero pero con un modal que diga qué enemigo y por qué.

Hoy el bridge tira el frame completo con «Fallo interno del juego» mientras **el cliente, para el
mismo caso, solo descarta al enemigo malo**: dos criterios para el mismo hecho, y el que manda es el
más destructivo.

## Criterio de aceptación (del jugador, no del código)

1. El motor spawnea una bolsa de monedas y **se puede pasar por encima**; spawnea un carro y **no**.
   Lo decide lo que el motor declara, no el `kind` por defecto.
2. Con varias entidades spawneadas en un turno, el jugador **no queda encajonado**: el reparto mira
   la huella de cada una (#524).
3. Si el motor manda un enemigo inválido junto a dos válidos, **entran los dos válidos**, el malo no,
   y el motivo llega al motor y al registro de errores. Ningún modal de «Fallo interno del juego».
4. El criterio del bridge y el del cliente para «enemigo inválido» son **el mismo**, y hay algo que
   se pone rojo si divergen.

## Fuera de alcance

- Soltar `engaged` o la correa del enemigo (#377, etiquetado `futuro`).
- La economía del combate (#325, `futuro`).

## Avisos para el crítico

- Verifica los cuerpos contra el código de HOY: aquí los issues caducan en horas.
- El contrato viaja por TRES sitios y los tres tienen candado: el zod de
  `src/contract/model-io/`, su **espejo Python** y el **tool JSON** de `data/contract/tools/`. La
  lección de #466 (2026-09-10) es literal: `npm run verify` **no corre la suite de Python**, así que
  una divergencia del espejo sale verde en local y roja en CI. Correr
  `NEFAN_SPEND_DIR=$(mktemp -d) python -m unittest discover -s ai_server/tests`.
- Pre-producción, cero compatibilidad: un campo que se sustituye se borra el mismo día, entero y en
  todos los procesos (`grep` a cero), tests incluidos.
- `ObstaculoAabb.dueno` es obligatorio desde la PR 5 de #241: lo del tile responde como la base y
  **solo los spawns de runtime son sólidos**. Cualquier plan que toque la colisión tiene que decir
  qué pasa con esa distinción.
- **Cero créditos**: motor falso (`e2e-sin-creditos`) y fixtures.

---

## Correcciones del coordinador tras la crítica (2026-09-14)

La crítica está en `critica.md`, al lado. Se acepta entera. Esto es lo que cambia, más las
decisiones que ella dejaba abiertas.

**§1 · la contradicción de #532, resuelta.** El cuerpo del issue se contradice al sumar (a) y (b):
(a) dice que un `object` sin footprint dejaría de ser sólido y (b) dice lo contrario. Con (c)
elegida, **la mitad viva es la de (b)**:

- `object` **conserva** su huella 3×3 por defecto y **sigue frenando**;
- `item` es la clase que NO frena — es lo que hace que una bolsa de monedas se pueda pisar;
- `footprint` (en **celdas**, que las convierte core: candado `cliente-no-convierte-celdas-a-metros`)
  solo afina el tamaño.

**Ningún spawn deja de ser sólido por omitir un campo.** Estamos en pre-producción y no se conserva
nada por ser antiguo, pero eso no es licencia para cambiar en silencio la conducta de lo que el
motor ya pone: lo que cambia es **lo que el motor PUEDE declarar**, no lo que pasa cuando no declara
nada.

**§1 · no son tres sitios, son siete, y tres no estaban escritos.** El contrato se escribe en UN
sitio (el zod de `src/contract/model-io/schemas.ts`) y el tool JSON y el prompt los genera
`npm run gen:contract`. A mano se tocan:

1. el **espejo Python**: `valid_kinds` **y la allow-list de `validate_narrative_reaction`**, que hoy
   tira en silencio cualquier campo nuevo — medido por el crítico;
2. el **resume** (`session/mundo-persistido.ts`): `CLASES_QUE_VUELVEN` no tiene `item`, y la huella se
   re-deriva del `type` ignorando lo declarado, así que un carro de `[6,6]` vuelve de 3×3;
3. el **materializador del cliente** (`world/materializar-spawn.ts`);
4. el **rastro de prosa** que quedaría mintiendo: `prompts/ui_systems.md:56`, la cabecera de
   `mundo-persistido.ts:432` y la del guion 91.

Y un aviso que vale su peso: **las fixtures compartidas comparan accept/reject, no si el campo
sobrevive**. Que el espejo Python tire `footprint` en silencio sale VERDE en las dos suites. Eso hay
que candarlo aparte, y es parte de la tanda.

**§3 · #529 se reduce al DESENLACE.** El criterio de «enemigo utilizable» ya es **uno solo** desde
#531/#530 (`parseHostileCombat`, candado en `test/architecture.test.ts:1174-1232` y guion 90): el
**criterio de aceptación 4 ya se cumple hoy** y aquí solo se vigila, no se construye. Y dos premisas
del issue son falsas: el motor **no** produce el bloque `combat` (lo deriva `combatForHostileRole`),
y «el motivo vuelve al motor» no tiene destinatario en ese borde — al otro lado del WS está el
cliente, no el modelo.

**Criterio de aceptación 3, reescrito**: si un frame de `add_combatants`/`load_room` trae un enemigo
inválido junto a dos válidos, **entran los dos válidos, el malo no, y el motivo llega al log del
bridge y al registro del jugador — sin modal**. Hoy ningún camino de jugador llega a ese modal (QA lo
alcanzó inyectando frames por el socket), así que el valor de #529 es coherencia y defensa en
profundidad, no dolor medido: **si hay que recortar la tanda, ésta es la pieza que espera.**

**§2 · #524, la mitad que no se sostiene.** «El jugador queda encajonado» no se aguanta: hay regla
«salir sí, entrar no». Lo demostrable es **el solape de cajas**: con `SEPARACION_M = 1.8`
(`consequence-handler.ts:186`) y radio de jugador 0,4 m, dos `object` dejan 0,3 m —intransitable—,
dos `building` **se solapan 0,4 m**, y un `npc` del mismo turno cae **dentro** de la caja del
edificio. Ése es el criterio, medido.

**Vecinos: uno entra y otro no, decidido ahora y no a mitad.**

- **#490 ENTRA** (el gate de `loadSession` acepta dos records de runtime con el mismo id). Vive en
  `loadSession`/`spawnsDeRuntime`, que es justo donde #532 obliga a entrar: hacerlo aquí es casi
  gratis y hacerlo después es abrir otra vez la misma puerta.
- **#509 y #497 NO entran.** Son el registro de errores donde #529 escribirá más líneas, pero son
  otro sujeto (uno es de pintado y el otro de ciclo de vida de la partida). Se quedan fuera **a
  propósito**, no por olvido.

**El guion que pide #532 no es el 91** (ese ya existe, es el de #489): el siguiente libre es el
**100**.

**Orden con las otras tandas**: B va **antes** que C, porque `etiquetas-del-mundo.ts:124` lee el
`sizeXZ` que esta tanda cambia. Con A no hay solape.
