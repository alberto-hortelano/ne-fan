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

4. **Un ataque que impacta reduce la vida del objetivo, y eso lo comprueba un test.**
   *Hoy: ningún guion comprueba que algo pierda vida.*

5. **`scene_instructions.md` dice una sola cosa sobre `size`/`terrain`**, y es la de la línea
   33. La checklist final no pide verificar ningún campo que el gate rechace.

6. **El guardia débil de #203 caza esta clase**, o se dice por qué no puede. Hoy no ve `combat`
   porque **no filtra lo que no es snake_case** — esa es la razón exacta por la que #323 llegó
   por un cabo suelto y no por el candado que se acababa de instalar.

7. **Nada de esto gasta créditos**, ni al implementar ni al verificar.

---

## 5 · Restricciones

- **No matar procesos ajenos.** Hay otras instancias de Claude en esta máquina. Nada de
  `pkill node`/`vite`/`python`, ni matar por puerto lo que no se arrancó.
- **Cero créditos.** El motor falso y el preset `e2e-sin-creditos` bastan para todo esto.
- **No rediseñar el sistema de combate.** Existe, está probado en sus partes y no es el
  problema. El problema es que nada llega a él.
- **Pre-producción**: lo que se sustituye se borra el mismo día, `grep` a cero.
- La batería es de **40 guiones** (`ls qa/guiones/*.mjs | wc -l`, no el número del último
  fichero — me equivoqué con eso dos veces hoy). La línea base se mide antes de tocar nada.
- **#320 sigue abierto**: el guion 34 es intermitente bajo carga, 1 rojo de cada 4 baterías. Si
  aparece, no es de esta tanda. Dicho antes, no después.

---

## 6 · Lo que NO es esta tanda

- No es añadir `"enemy"` al enum y cerrar. Esa es una de las dos salidas y hay que **elegir con
  un argumento**, no por ser la más corta.
- No es tocar la fórmula de combate, la matriz táctica ni `combat_config.json`.
- No es #302 ni la revalidación de lo que el juego carga.
- No es rehacer `ui_systems.md` entero: solo lo que promete y no existe.
