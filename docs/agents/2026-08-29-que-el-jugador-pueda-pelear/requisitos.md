# Que el jugador pueda pelear

**Tanda**: 2026-08-29 (tercera del día) · rama `feature/que-el-jugador-pueda-pelear`
**Issues**: #323, #322

---

## 1 · La petición del usuario, literal

> «Pasamos a la siguiente tanda»

…y, elegida entre tres alternativas medidas:

> «Que el jugador pueda pelear (Recomendado)» — #323 + #322

Lo que compró está en la descripción de la opción, y es el criterio de éxito:

> «Lo único del backlog que toca lo que el jugador VIVE, no la infraestructura. Empieza por un
> **playtest real**: si se confirma, este juego tiene combate y no tiene contra quién. 2 cierres,
> pero el más valioso del tablero.»
>
> «**PRIMER PASO: playtest, no rediseño.**»

Esa última línea es una instrucción, no un adorno. **Nadie diseña nada hasta que la premisa
esté verificada ejecutando el juego**, no leyendo el código.

---

## 2 · El enunciado

Este juego tiene un sistema de combate cuerpo a cuerpo en tiempo real —fórmula de calidad,
matriz táctica 5×7, cinco tipos de ataque, tres armas, IA por personalidad, todo en
`data/combat_config.json`— y, por lo que dice el código, **el motor narrativo no puede poner
un enemigo delante del jugador**.

**La maquinaria está entera.** Esto no es código que falte:

| Pieza | Estado |
|---|---|
| `reducers.ts:66` `enemy_damaged` · `:70` `enemy_died` | existe |
| `game-loop.ts:190` despacha el daño | existe |
| `bridge/context.ts:303` `dispatch("enemies_projected")` | existe |
| cliente: `sendLoadRoom(enemies)`, `sendAddCombatants(enemies)` | existe |

**Lo que está cortado es la entrada.** `bridge/context.ts:305` es la única vía que puebla
`GameStore.enemies`, y `projectEnemiesFromEntities` (`src/store/state-projection.ts:40`)
descarta todo lo que no sea `type === "enemy"`. El enum de `spawn_entity`
(`data/contract/tools/narrative_react.json`) es exactamente `["npc", "building", "object"]`.

`"enemy"` como tipo de entidad aparece en **dos ficheros del repo, y los dos son tests**, que
se la construyen a mano. Cero en `src/`, cero en `bridge/`, cero en datos, cero en `ai_server`.
Y `kind: "creature"` —la categoría roja que documenta `CLAUDE.md`— no aparece ni una vez en
`src/` ni en `bridge/`: no hay conversión de criatura a enemigo.

### Por qué 40 guiones en verde no lo cazaron

Porque **prueban todo alrededor del combate**:

- guiones 03, 22 y 23 comprueban el HUD, el telegraph y que el catálogo trae los cinco ataques
- de los tres guiones que mencionan `hp`, ninguno es de combate: son el de guardado (17), el de
  fixtures (25) y el del contrato (40)

**Ningún guion comprueba que algo pierda vida.** Y `state-projection.test.ts` valida una
proyección cuya entrada la producción no puede producir: se fabrica la entidad `type: "enemy"`
a mano, así que pasa siempre y no puede ponerse rojo por la razón que importa.

### Y el banco tampoco puede probarlo hoy

Medido al abrir la tanda:

```
grep spawn_entity labs/narrative/fake-ai-server.ts  → 0
grep -l spawn_entity qa/guiones/*.mjs               → 0
```

**El motor falso nunca emite `spawn_entity` y ningún guion lo ejerce.** El spawn dinámico es
una decisión de diseño central declarada en `CLAUDE.md` («las entidades se materializan en el
mundo en runtime sin recargar la escena») y **no lo prueba nada**.

---

## 3 · Los dos issues

### #323 — el motor narrativo no puede crear un enemigo

Todo lo anterior. Pendiente de **verificar ejecutando**, que es el primer criterio.

Cuando se confirme, la pregunta de diseño **no es «añadir `enemy` al enum»**. Es cuál de las
dos verdades sobra:

- si un NPC hostil es un `npc` **con bloque `combat`** — y entonces la proyección filtra por el
  campo equivocado. `ui_systems.md:54` dice *«hostile ones need the `combat` block»*, lo que
  apunta aquí;
- o si es un **tipo propio** — y entonces el enum y el prompt van por detrás.

Dato que inclina la balanza y hay que comprobar: `ui_systems.md` le promete al modelo un bloque
`combat` (`{health, weapon_id, personality}`) que **ningún tool JSON declara**, y
`state-projection.ts:43-47` ya lo lee (`data.combat.health`, `data.combat.weapon_id`). O sea
que media implementación de la primera opción ya está escrita.

### #322 — el prompt le enseña al modelo lo que el gate rechaza

`scene_instructions.md` **se contradice tres veces sobre el mismo campo**: la forma de arriba
(`:9-10`) enseña `size`/`terrain`, la línea 33 los prohíbe, y la checklist final (`:154-159`)
vuelve a pedirlos en cuatro de sus seis puntos — y una checklist es lo último que lee el modelo
antes de responder.

Va en esta tanda porque es la **misma familia que #323**: documentación dirigida al modelo que
le promete algo que el código no honra. En #322 le enseña un campo que el gate rechaza; en #323
le promete un bloque `combat` que ningún tool declara.

Aviso al hacerlo: los puntos de checklist **no se borran sin más**. `every entity has
id/kind/name/cell/footprint/glyph` y `no two entities share an id` siguen siendo válidos en el
tile. Hay que separar qué sigue aplicando al mundo continuo y qué murió con la escena «suelta».

---

---

## 3 bis · Reencuadre tras la crítica: la premisa se ejecutó, y mi diagnóstico era erróneo

**El criterio 1 está CUMPLIDO** — el crítico ejecutó una partida real de `alta_fantasia` con
cero créditos: 0 barras de enemigo, 0 frames `add_combatants`, 4 `state_update` con 0 enemigos,
y atacar no dañó nada. Las tres formas de declarar algo hostil, rechazadas o descartadas.

**El dato que define la tanda**: rastreados los `runs/`, los saves y **225 capturas**, hay un
solo rastro de combate en todo el repositorio — `runs/2026-07-10_22-05-00`, con **11
`attack_landed` del bandido AL jugador**, el enemigo quieto en `hp:200` y el jugador sin atacar
ni una vez. **Cero `enemy_damaged`. Nadie ha herido nunca a nada.**

### Mis dos errores de trazado, que cambian el arreglo

1. **«`bridge/context.ts:305` es la ÚNICA vía» es falso.** Hay tres dispatchers de
   `enemies_projected`: `context.ts:303`, `handlers/simulation.ts:143` y `:220`.

2. **Y esa vía ni siquiera es la que importa.** `getEnemyStates` (`context.ts:493-509`) exige
   *además* que el sim conozca al combatiente (`ctx.sim.getCombatant(e.id)`; sin él no emite
   nada), y **la proyección narrativa no toca el sim**. O sea que añadir `enemy` al enum —el
   arreglo que el issue insinuaba— **no habría servido de nada**.

**La vía viva es otra y está entera**: world scene → `objects[].combat` → cliente →
`add_combatants`. Lo único que falta es que alguien produzca `combat`.

### La dicotomía del §3 no existe: las dos opciones son el mismo fósil

| Commit | Fecha | Qué pasó |
|---|---|---|
| `cb8dcf6` | 2026-05-19 | `combat` se diseña como shape de `SpawnEnemyAction` del ScenarioRunner |
| `fd8ef5c` | 2026-07-06 | se borra el ScenarioRunner y **en el mismo diff se reetiqueta el comentario a «(spawn_entity consequences)»**, sin comprobarlo |
| `ui_systems.md:54` | un mes después | copia la etiqueta y se la promete al modelo |

El indicio de diseño que yo citaba es **una etiqueta que alguien cambió al borrar su
productor**. No se elige entre dos verdades: **se elige por dónde está la vía viva**, y es la
del cliente.

### Conflictos que hay que respetar

- **`EntitySchema` es `.strict()` con 12 campos desde ayer** (PR #324, argumento medido).
  Añadir un campo ahí no es gratis y hay que justificarlo.
- **`data/contract/fixtures/reaction/invalid/spawn_kind_invalido.json` exige** que
  `entity_kind:"creature"` se rechace. Cualquier salida que pase por `creature` choca con ella.

### #322 se queda, pero por barato, no por familia

El crítico tiene razón: su arreglo es prosa de un fichero y **no comparte una línea con #323**.
Se mantiene porque es barato y está medido, no porque sean la misma cosa. Y su **criterio 3 es
inalcanzable** — ver el criterio 6 de abajo.

---

## 4 · Criterios de aceptación

**El 1 es una precondición: si sale que la premisa es falsa, la tanda se para y se dice.**

1. **La premisa está verificada EJECUTANDO el juego, no leyendo el código.** Un guion que haga
   que el motor emita un `spawn_entity` de algo hostil y compruebe si llega a
   `GameStore.enemies`. **Cero créditos**: el motor falso basta, y hoy no emite `spawn_entity`,
   así que enseñarle a hacerlo es parte del trabajo.
   *Hoy: nadie sabe qué pasa, porque nada lo ejerce.*

2. **El motor narrativo puede crear una entidad hostil, y el jugador le quita vida.**
   Verificable de punta a punta: del contrato al `enemy_damaged`. *Hoy: `enemies` solo se puebla
   filtrando por un `type` que `spawn_entity` no puede emitir.*

3. **Hay un guion que lo ejerce desde el arranque** y que **no se fabrica la entidad a mano**.
   Ese es el defecto exacto de `state-projection.test.ts`: construye la entrada que la
   producción no puede producir.

4. **Un ataque que impacta reduce la vida del objetivo EN UNA PARTIDA REAL**, no en un test
   unitario que se fabrica al combatiente.
   *Corregido tras la crítica: mi redacción anterior **nacía verde** — `test/combat-systems.test.ts:189`
   ya lo comprueba. Lo que no existe es la comprobación de punta a punta, desde el arranque.*

5. **`scene_instructions.md` dice una sola cosa sobre `size`/`terrain`**, y es la de la línea
   33. La checklist final no pide verificar ningún campo que el gate rechace.

6. **Se dice por escrito por qué el guardia débil de #203 NO caza esta clase**, en vez de
   arreglarlo.
   *Corregido tras la crítica: yo había culpado al snake_case y **es la razón equivocada**. El
   guardia solo comprueba que el token **exista** en el zod, y `combat`, `size` y `terrain`
   existen a espuertas. Ampliar su regex no cazaría ninguno de los dos issues. Lo que hace falta
   es un guardia que compare lo que el prompt **promete** con lo que el contrato **acepta**, y
   eso es otra tarea. El criterio 3 de #322 es inalcanzable por lo mismo y hay que decirlo al
   cerrarlo.*

7. **Nada de esto gasta créditos**, ni al implementar ni al verificar.

---

## 5 · Restricciones

- **No matar procesos ajenos.** Hay otras instancias de Claude en esta máquina. Nada de
  `pkill node`/`vite`/`python`, ni matar por puerto lo que no se arrancó.
- **Cero créditos.** El motor falso y el preset `e2e-sin-creditos` bastan para todo esto.
- **No rediseñar el sistema de combate.** Existe, está probado en sus partes y no es el
  problema. El problema es que nada llega a él.
- **Pre-producción**: lo que se sustituye se borra el mismo día, `grep` a cero.
- La batería es de **39 guiones**. Escribí 40 y me lo corrigió el crítico: es la **tercera vez
  el mismo día** que me equivoco en este recuento (35→34, 39→38, 40→39). El comando es
  `ls qa/guiones/*.mjs | wc -l`; el nombre del último fichero NO es el recuento porque falta
  el `04-`. La línea base se mide antes de tocar nada.
- **#320 sigue abierto**: el guion 34 es intermitente bajo carga, 1 rojo de cada 4 baterías. Si
  aparece, no es de esta tanda. Dicho antes, no después.
  *Apostilla 2026-08-30: #308 y #320 CERRADOS — el 22 no era intermitente sino un guion que medía la fixture anterior, y el control del 34 pasaba en verde con tres de las cuatro teclas muertas. Ya no hay ajenos que declarar.*

---

## 6 · Lo que NO es esta tanda

- No es añadir `"enemy"` al enum y cerrar. Esa es una de las dos salidas y hay que **elegir con
  un argumento**, no por ser la más corta.
- No es tocar la fórmula de combate, la matriz táctica ni `combat_config.json`.
- No es #302 ni la revalidación de lo que el juego carga.
- No es rehacer `ui_systems.md` entero: solo lo que promete y no existe.
