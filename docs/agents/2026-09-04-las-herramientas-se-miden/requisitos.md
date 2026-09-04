# T10 — «Las herramientas se miden»

## La petición, literal

Hoy, 2026-09-04:

> Adelante con T10

Y el marco que la ordena, del 2026-09-02, también literal:

> Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero los plugins
> los podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso deben ser
> plugins y tienen baja prioridad en cuanto a calidad del codigo. Haz una seleccion de los issues
> centrales y marca los demas para mirar a futuro

T10 es la sexta tanda de la hoja de ruta `~/.claude/plans/federated-spinning-flamingo.md`. Las cinco
anteriores (T6, T7, T8, T9) están cerradas. Su nombre en el plan: **«Las herramientas se miden»**.

## Lo que se pide

Cerrar los issues del **instrumento de mutación**: lo que mide si los tests se enterarían de un
cambio. Cinco están en la tanda del plan, dos nacieron después de escribirlo y son del mismo aparato:

| # | Título corto | En el plan |
|---|---|---|
| #339 | `scene-validate` y `tile-edges` salen de `sin_mutar` | T10 |
| #340 | `src/narrative` está fuera de la totalidad | T10 |
| #383 | `status-labels` no cabe en el tope, y el gate no lo ve | T10 |
| #381 | el reparto pierde la atribución: su rango cuelga de un tag que la corrida adelanta | T10 |
| #404 | un fichero de `data/contract/` fuerza la corrida completa | T10 |
| #419 | los opcionales del wire no se prueban en su rama ausente | nacido el 04-09 |
| #420 | `local` puede sustituir un informe de CI sin que el guardia lo vea | nacido el 04-09 |

**Al crítico**: decide si #419 y #420 entran, si alguno de los siete sobra, y en qué orden. Los siete
tocan el mismo instrumento; el riesgo de la tanda no es que un plan sea malo, es que dos cambios del
mismo aparato se pisen.

## Restricciones que no se negocian

- **No se matan servidores ajenos.** En esta máquina trabajan varios agentes en paralelo. Prohibido
  `pkill vite`/`node` y prohibido matar por puerto. Se arranca con `./start.sh --preset <slug>` y se
  para con `./start.sh --parar`, desde el worktree propio y con `NEFAN_PORT_OFFSET` propio. `ss -ltn`
  antes de tocar nada.
- **Cero créditos.** Toda verificación con `e2e-sin-creditos` o `html-fixtures`. El ledger de gasto
  (`cache/spend/events.jsonl`) es material del usuario: no se abre para escribir, y `NEFAN_SPEND_DIR`
  existe desde #392 justo para eso.
- **La mutación se PIDE.** `npm run mutacion -- local <id>` está permitido y es el camino normal para
  un módulo que cabe en `tope_local`; la corrida completa la autoriza **una persona** desde Actions.
  Nadie lanza `npm run mutate` a pelo (dos quejas de CPU del usuario, 2026-08-25).
- **Pre-producción: cero compatibilidad hacia atrás.** Lo que se sustituye se borra el mismo día,
  entero, con `grep` a cero — prosa, comentarios y docs incluidos.
- **Ningún módulo nuevo se queda en `break: 0`.** Hoy `asset-store-contrato` lleva tres tandas así
  (#354, #380, #389): un suelo en 0 es un gate permanentemente verde. El cierre de T10 incluye subir
  el suelo de cada módulo que estrene, con la medida de la corrida posterior.
- **Candado, no prosa.** Un invariante verificable acaba en un checker que falla, no en una línea de
  `CLAUDE.md`. Y el candado hay que **verlo rojo** antes de darlo por bueno.

## Estado medido HOY (2026-09-04), sobre `main` = `e67ae4d`

No son los números de los issues: son los de hoy. Donde difieren, lo digo.

**El contrato** (`nefan-core/data/contract/mutation-targets.json`): 33 módulos, `tope_local` = 120,
`directorios_completos` = 5 (`src/plugins/dsl`, `src/scene/blueprint`, `src/scene/greybox`,
`src/store`, `src/world-map`), `sin_mutar` = 36 entradas.

**#339 — vigente sin cambios.** `scene-validate.ts` y `tile-edges.ts` siguen en `sin_mutar`, con el
motivo escrito «Pendiente de la tanda B (vaciar `sin_mutar` a módulos reales)» y el aviso del OOM
killer del 2026-08-21. Ninguno de los dos aparece en la huella (`AUSENTE`): nunca se han medido.

> **Crítica**: el «local si cabe, pedida si no» del issue es **FALSO**. `permisoLocal`
> (`scripts/mutacion-huella.ts:487-493`) rechaza el coste `undefined`, así que **una primera medida
> nunca se puede hacer en local**: un módulo estrenado exige corrida autorizada, no es una opción del
> plan. Lo mismo vale para `entidades-del-tile` de #419, que cuesta 121 — uno por encima del tope.

**#340 — REENCUADRADA.** `grep -c "src/narrative" mutation-targets.json` → **0**, como dice el issue.
Pero `src/narrative/` tiene hoy **9 ficheros**, no 10: `ai-client.ts`, `consequence-handler.ts`,
`narrative-state.ts`, `npc-records.ts`, `render-mode.ts`, `serialize-llm.ts`, `session-storage.ts`,
`speaker-resolve.ts`, `types.ts`. Y `registerSceneNpcs` es CRAP **59** hoy, no 49: ha empeorado.

> **Crítica**: el criterio de cierre del issue tiene trampa mecánica. El perímetro de la totalidad
> sale de la regla `core-puro-sin-node` de `arch-rules.json` (`mutation-plan.ts:239-258`), **que no
> nombra `src/narrative`**. Meterlo ahí rompería el build: `session-storage.ts` importa `node:fs`. La
> vía es `directorios_completos`, con precedente en `src/plugins/dsl` — y el **porqué** de esa
> elección va escrito en el `porque` de la entrada, o dentro de un mes parecerá arbitrario.

**#383 — el módulo sigue sin caber; el síntoma del gate está MUERTO.** La huella commiteada dice hoy
`total: 162` para `src/protocol/status-labels.ts` (corrida `33790710680`, entró con PR #418) — o sea
que `costeDe` ya lee 162 y **rechazaría** el `local`. El issue describía el gate ciego con 119, y esa
lectura ya no existe. Lo que **sí** sigue vigente: (a) 162 > 120, el módulo hay que partirlo, y la
costura está descrita en su propia cabecera (título/destino vs los cuatro traductores de
excepción→frase); (b) el problema estructural que el issue nombra al final —el gate mira la **última
huella**, así que un módulo que engorde DESPUÉS de la última corrida vuelve a pasar por debajo—. El
crítico tiene que decidir si (b) se hace aquí o es otro issue.

> **Crítica**: (a) sigue vigente y (b) **sale de la tanda a issue propio**. Dos correcciones al issue:
> `local` lee `leerHuella()` —el árbol— en `scripts/mutacion.ts:683`, no `git show HEAD:` (eso es de
> `repartir`, `:436`); y son **12** importadores, no ~10. Y un aviso medido: (b) **no** se arregla
> comparando blobs. Hoy 30 de 33 módulos tienen el blob idéntico a lo medido, pero sobre un árbol
> limpio; `local` se usa justo DESPUÉS de editar el módulo, así que ahí el blob difiere por
> construcción y ese gate apagaría el flujo que CLAUDE.md le pide al ingeniero.

**#381 — vigente, verificado en el código de hoy.** `commitsDelRango(plan, tag, corrida.sha)` sigue en
`scripts/mutacion.ts:438`, con `tag` = `mutacion-ultima`; y `.github/workflows/mutation.yml:144-153`
sigue moviendo ese tag al sha medido cuando la corrida es completa. Hoy el rango NO está vacío (12
commits sin medir) **porque la última corrida salió incompleta y el tag no se movió**: es un respiro
accidental, no un arreglo.

> **Crítica**: la opción 1 del issue (anclar en la huella) **no da un ancla única**: el `sha` va POR
> FICHERO y hoy hay dos distintos conviviendo (60 ficheros en `81a7ce0`, 4 en `7b817b9`).

**#404 — vigente y visible en una sola orden.** `npm run mutacion -- pendiente` imprime hoy **27+
líneas** «fuerza la completa», y la primera es `data/contract/client-file-size.json`. Las demás son
las fixtures de escena y de reacción. Resultado: «Se medirían 33 de 33 módulos (COMPLETA: el selector
no puede descartar nada) · 10353 mutantes».

> **Crítica: PREMATURA en esta tanda, y es el único con riesgo de dejar la herramienta más
> permisiva.** Su beneficio aquí es **cero medido**: el propio diff de T10 toca `scripts/` y
> `mutation-targets.json`, que son *tooling*, así que la corrida siguiente sale COMPLETA de todos
> modos. Y una lista `datos: {ruta → módulos}` a mano hace que el defecto de un fichero NUEVO de
> `data/contract/` sea el **silencio**; hoy es `todos`, caro y correcto. La vía honesta ya está
> escrita para el caso gemelo en el propio `afectado.ts` (`efectoDeSalida`, `:81-93`): «*lo que NO es
> instrumento se comprueba, no se declara*». Si acaba habiendo lista, necesita candado de totalidad
> como `sin_mutar`. Va a T11 o al final, solo.

**#419 — vigente, con los números en la huella.** `entidades-del-tile.ts`: 121 mutantes, **12 vivos**.
`scene-normalize.ts`: 231 mutantes, **8 vivos**. Los dos con `base: "incomparable"`, los dos de la
corrida `33790710680`. El primero cuesta 121 mutantes: **cruza `tope_local` por uno**.

> **Crítica: es lo único ROJO hoy** — los dos están por debajo de su suelo *ahora mismo*
> (`entidades-del-tile` 90,1 % contra break 96; `scene-normalize`, contando sus 313 mutantes,
> 97,4 % contra 98). Aserciones de ausencia que existen hoy: **una**
> (`entidades-del-tile.test.ts:188`); ninguna para `shape`, `volumeId`, `styleRef`, `role`, `combat`
> ni `place_id`. Va primero.

**#420 — vigente.** `verificaDescarga` compara **nombres de fichero** contra `modulos_con_informe`
(así lo dejó #418, arreglando otra cosa): un `local <id>` de un módulo que está en la corrida deja un
fichero con el nombre exacto que el manifiesto espera, así que ni falta ni sobra y pasa el guardia.

> **Crítica**: la procedencia **ya viaja y nadie la lee**: `projectRoot` vale
> `/home/runner/work/…` en los informes de CI (comprobado en tres).

**El ciclo, hoy**: tag `mutacion-ultima` = `7b817b9` (2026-09-02), 12 commits sin medir, 196 ficheros
cambiados, la próxima corrida sale COMPLETA (~10.353 mutantes, ~131 min).

**Por qué el tag no se ha movido, y no lo dice ningún issue** (hallazgo del crítico, verificado por el
coordinador): la corrida `33790710680` **salió INCOMPLETA** — `reports/mutation/corrida.json` dice 33
pedidos y **32 con informe**, y el caído es **`contrato-escena`**. Sus cuatro ficheros siguen medidos
en la corrida anterior (`33672454166` / `7b817b9`) y `entity-vocabulary.ts`, que metió #406, **nunca
se ha medido**. #347 y #349 se cerraron sobre este mismo módulo.

**Dato que el crítico no tenía**: la causa de esa caída **ya está arreglada en `main`**. Era el salto
fijo `../../ai_server` de `test/entity-vocabulary.test.ts`, que dentro del sandbox de Stryker no
existe; **PR #418** lo sustituyó por `raizDelRepo()` (`test/entity-vocabulary.test.ts:47`) y le puso
candado. La corrida nueva es, además, la única forma de comprobar que ese arreglo funciona de verdad.

**La corrida se pide ANTES de empezar** (sobre `e67ae4d`), y otra al mergear. La de antes no es para
medir: es para que el rango de la de después sean solo las 4-6 PR de esta tanda en vez de ~18 commits
y 200+ ficheros — si no, la atribución que #381 arregla vuelve a salir «todas para todo» y **no se
puede demostrar que quedó arreglada**.

## La decisión del usuario, tras leer la crítica (2026-09-04)

Dos preguntas, dos respuestas literales:

- Alcance → **«Seis issues, #404 a T11 (Recomendado)»**. La tanda es **#419, #420, #381, #339, #340 y
  #383(a)**. #404 sale con su motivo escrito. La parte (b) de #383 —el gate que mira la última huella
  y por tanto es ciego a lo que engorde después— sale a **issue propio**.
- Corrida → **«Ahora y otra al mergear (Recomendado)»**. La primera se autoriza sobre `e67ae4d`, antes
  de tocar nada.

## Criterio de aceptación

Del crítico, aceptado por el usuario:

1. Los dos módulos de #419 vuelven a su suelo **en una corrida autorizada, con el número y no con el
   argumento**.
2. Cada módulo nuevo sale de la corrida con su `break` puesto a la medida y **commiteado**:
   `break: 0` no es un final.
3. Los candados de #381 y #420 se han visto **rojos** antes de darse por buenos.
4. `contrato-escena` deja informe, o hay issue con dueño.
5. **Ningún umbral subido** — ni `tope_local`, ni un `break` a la baja.

Y lo que **no** vale, por regla de la casa: dar un candado por bueno sin haberlo visto rojo, y copiar
el número de un issue bajo el rótulo «medido».
