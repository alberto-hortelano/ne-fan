# OBSOLETA

La pregunta del issue tiene respuesta y la he medido: **el NPC llega a su objetivo de 16 m en
2,87 s**, en la geometría real del tile del bench y con la colisión del sim. No hay bug de
steering. El «1 m en 30 s» lo he reproducido exactamente —**0,72 m en 60 s**— y solo aparece con
el NPC naciendo dentro del prop, que es lo que arregló #290. El coordinador tiene razón; el
crítico de #289 estaba **citando** el cuerpo del issue, no midiendo (su «medido en vivo» es la
medida de antes de #290, la del tabernero empotrado). #262 se cierra con la prueba.

## El problema real, en una frase

Un NPC nacido dentro de la geometría no se mueve, y **nada en el pipeline lo detecta** — ni el
validador de escena, ni el sim, ni el save—, así que su parálisis se lee durante semanas como «la
huida está rota». #290 arregló el dato del bench, no la clase de fallo. El bench que propone el
issue mide el steering, que funciona: es el dial equivocado.

## La premisa, afirmación por afirmación

Método, para que se pueda desmentir: `createAmbientNpcBehavior` con el adaptador de colisión armado
como lo arma el bridge (`formatDToWorld` → `terrain_grid` + `__plan` → `planCollisionGrid` sobre
`tileWorldRect(0,0)`, igual que `bridge/sim-collision.ts:80-104`), el tile de bootstrap de
`labs/narrative/fake-ai-server.mjs` y su NPC del guion 15 (`barkeep`, `role: merchant`, `:284`).
Pelea fija a 8 m, 60 s a 1/60. **0,38 s de reloj**, sin stack.

| Afirmación | Verificación |
|---|---|
| «desplazamiento real ~1 m en 30 s» | **CADUCADA.** Con el spawn de HEAD: 8,05 → **16,03 m en 2,87 s**. Idéntico con seeds 1/5/42/99 |
| «1 m en 30 s» era el fenómeno | **CIERTA, y reproducida.** Devolviendo el `barkeep` a la celda `[60,52]` (dentro del `mostrador`): `nace en sólido = true`, y en 60 s recorre **0,72 m** y ahí se queda vibrando ±2 cm. Es el 0,97 / 1,06 / 0,7 del cuerpo y del comentario del 25 |
| Lectura (1): bug de steering, watchdog `STUCK_WINDOW_S` | **FALSA hoy.** En campo abierto y en el tile real el watchdog no entra: corre en línea recta a 2,8 m/s hasta el tope |
| Lectura (2): huida contenida a propósito | **CIERTA a medias, y está escrita.** El tope existe: `FLEE_EXTRA_DIST = 4` (`npc-behavior.ts:102`) y el corte en `dist >= perception_radius + FLEE_EXTRA_DIST` (`:568`). Pero no está «contenida para que el jugador alcance a quien huye»: 16 m es distancia de parada, y la alcanza sobrado |
| «el crítico de #289 lo midió en vivo» | **FALSA.** `docs/agents/2026-08-27-todo-hueco-admite-el-cuerpo-mayor/critica.md` cita #262 en su sección de conflictos; no hay medida propia. «Está pasando de verdad» hereda el número del cuerpo, que es el del NPC empotrado |
| «`atacarYVer` agota el cortafuegos de 30 s» (premisa de #261) | **CADUCADA también.** Cruza el umbral de 1,5 m en <1 s (a t=1 s lleva 2,80 m). El defecto estructural de #261 sigue en pie; su ejemplo, no |
| `footprint` no se lee en el sim | **CIERTA.** 0 apariciones en `src/simulation/` y 0 en `bridge/` |

**Y un hallazgo que no estaba en ninguna lectura**, medido en el tile real: alcanzados los 16 m el
NPC para; 4 s después (`COMBAT_CLEAR_SECONDS`) emite `npc_resumed`, vuelve a micro-wander alrededor
de `home` —que la huida **nunca** actualiza, al revés que `goto`/`visit` en `:555`— y **camina de
vuelta hacia la pelea** hasta los 12 m, donde vuelve a percibirla y huye otra vez. Ciclo límite de
~10 s, indefinido: 16,05 → 12,25 → 16,05 → … En 60 s de pelea son **7 `npc_fled_combat` + 6
`npc_resumed`** = **13 líneas de ambiente** sobre el mismo tabernero en el `NarrativeState`
(`bridge/handlers/simulation.ts:77,83`), y el jugador ve al que huye volver a la pelea cada 10 s.

## El día después

- **Si la tanda construye el bench del issue**: gasta cuatro contextos y 30-60 s de reloj en cada
  corrida de la batería para producir el número que ya está arriba, obtenido en 0,38 s. Y un guion
  que sigue a un NPC 30 s es justo la clase de instrumento que ha fallado cuatro veces esta semana,
  ahora dentro de la batería de todos.
- **Qué se puede tirar**: la idea de que la huida está rota, viva desde #247 y #284.
- **Qué quedará arbitrario en un mes** si se cierra sin más: por qué `npc-behavior.test.ts:151`
  asierta `> 3` a 1,6 s de huida —pasaría igual con el tope en 4 m— cuando el número es 16.

## Conflictos

- **#289 (abierto, siguiente en la cola) — se solapan, y hay que fusionar el residuo.** Medido:
  `validateScene` da veredicto **idéntico** para el tile que encierra al tabernero y para el que
  no (`ok: true`, 0 errores, `npcs 1/1 alcanzables`). La celda `[60,52]` sale sólida en la máscara
  (`plan.solid = true`), pero `checkNpcsReachable` (`scene-validate.ts:652-661`) se conforma con
  una **vecina** transitable, y aunque fallara sería *warning*. El motor real puede repetir en
  partida lo que #290 quitó del bench. Cae en la misma función y la misma decisión de severidad
  que el crítico de #289 ya pidió: hacerlo por separado paga dos veces.
- **#261 (abierto) — no bloquea, y su premisa también decayó.** Si el congelado es un test del sim
  (determinista, sin esperas), su defecto no puede aparecer por construcción; conviene avisar allí
  de que el ejemplo ya no se reproduce.
- **`CLAUDE.md`** — «Verificación barata» contradice frontalmente las respuestas por defecto de las
  preguntas 1 y 2 de `requisitos.md`; y «candado, no prosa» dice que cerrar #262 con un comentario
  y nada más deja la respuesta en prosa: tiene que quedar en un test.

## Coste contra valor

Hacer la tarea escrita: cuatro contextos y un bench nuevo para un número ya conocido. **No vale.**
No hacer nada: #262 sigue contaminando el diagnóstico de los vecinos y el residuo se queda sin
dueño hasta que aparezca en partida, donde es silencioso, permanente y se lee como ambiente. Lo
que sí vale, y es media hora de ingeniero: cerrar #262 con la prueba, congelar el número en
`test/npc-behavior.test.ts` y mandar el residuo a #289, que ya va detrás y toca esa misma función.

## Qué le cambiaría a `requisitos.md` (redactado para pegarse)

> **Veredicto: la medida ya está tomada y #262 se cierra.** El NPC alcanza su objetivo de
> `perception_radius + 4` = 16 m en **2,87 s** desde 8 m, en el tile real del bench y con la
> colisión del sim; el «1 m en 30 s» se reproduce **solo** con el NPC dentro del prop (0,72 m en
> 60 s), que es lo que arregló #290. La disyuntiva se resuelve así: (1) no; (2) sí, el tope está
> en `npc-behavior.ts:102` y `:568`, pero es distancia de parada, no contención.
>
> **Se retiran los criterios 1, 2 y 6 y las preguntas 1 y 2**: no se construye bench. La medida
> vive en el sim con la colisión real del tile, cuesta 0,38 s y no puede agotar un timeout.
> **Criterio 5 → se concreta.** Lo que se congela es `test/npc-behavior.test.ts`: el `> 3` de
> `:151` se sustituye por «llega a `perception_radius + FLEE_EXTRA_DIST`, y en menos de N s», con
> caso en negativo (`blocksMove: () => true` ⇒ rojo). Nada de umbrales nuevos en el guion 15.
>
> **Criterio nuevo: el residuo se enruta, no se hace aquí.** `validateScene` no distingue el tile
> que empotra al NPC del que no (medido: mismo `ok`, mismos errores, `npcs 1/1`), porque
> `checkNpcsReachable` (`scene-validate.ts:652-661`) acepta una celda vecina y solo avisa. Va a
> **#289**, junto a su decisión de severidad, no a un issue nuevo.
>
> **Hallazgo a reportar, sin arreglar**: el que huye vuelve. `home` no se actualiza al huir (sí en
> `:555` para `goto`/`visit`), así que tras `npc_resumed` el NPC camina de vuelta hasta los 12 m de
> la pelea y huye otra vez; ciclo de ~10 s y 13 eventos de ambiente en 60 s. Es diseño de conducta:
> se lleva al usuario, no se cambia en esta tanda. Para pegar en #262 al cerrarlo: el primer
> párrafo de este bloque.
