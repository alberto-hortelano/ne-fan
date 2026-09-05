# Requisitos — T13 «La deuda que dejaron las tandas»

Fecha: 2026-09-05 · `main` = `e62a750` · árbol limpio · backlog 47 (35 núcleo + 12 `futuro`).

## Petición literal del usuario

Tras cerrar T11, el usuario preguntó «Y los 47 issues abiertos?». Se le presentaron agrupados y se le
propuso este orden: «cerrar primero los tres de T11 y los cinco de escena mientras el contexto está
fresco, porque son pequeños y cada uno tiene guion o medida ya escrita. Luego #439, que es lo único que
te está costando tiempo de reloj a ti. T12 y los programas después». Su respuesta literal:

> Me parece un buen orden, empieza con T11

(2026-09-05.) «Empieza con T11» = los tres issues nacidos en T11 van **primero** dentro de la tanda;
los cinco de escena, detrás. Esta tanda es la octava de la hoja de ruta que el usuario fijó el
2026-09-02, cuya petición literal fue:

> Vamos a centrarnos en ir cerrando issues. La parte central hay que dejarla bien pero los plugins los
> podemos dejar para mas adelante, el combate, el movimiento, el comercio... todo eso deben ser plugins
> y tienen baja prioridad en cuanto a calidad del codigo. Haz una seleccion de los issues centrales y
> marca los demas para mirar a futuro.

## Los ocho issues, en el orden pedido

| Orden | Issue | Nació en | Qué es |
|---|---|---|---|
| 1 | #451 | QA de #448 (T11) | un snapshot de 9 escenas con UNA injugable se tira entero; «Continuar» lo sustituye por uno de 1 |
| 2 | #452 | QA de #449 (T11) | los plugins escriben `player.inventory` por `PLAYER_WRITABLE` sin el gate del `id`; `loadSession` traga ítems sin `id` |
| 3 | #453 | QA de #449 (T11), preexistente | `POST /entity/player/inventory` sin sesión → 200; el fallo de guardar solo sale en el log |
| 4 | #405 | crítica de T7 | la rama «escena centrada en el origen» tiene tres sujetos vivos; `tile` no es obligatorio en el loader ni en los tests |
| 5 | #407 | T7 | `W` en `DEFAULT_SOLID_CHARS` sin productor; 52 grids literales en 5 tests lo usan como «sólido cualquiera» |
| 6 | #408 | QA-A de T7 | `place_anchors` con cuatro lectores y ningún productor real: solo lo escribe el banco |
| 7 | #410 | QA-B de T7 | la huella del TileStore incluye `exits`: `actualizarSalidas` la desfasa y una re-difusión re-deriva la colisión |
| 8 | #411 | QA-B de T7 | la regla `solo-el-bridge-normaliza-la-escena` dice «cliente 2D» y `max: 2` sin nombrar las dos llamadas legítimas |

Los cuerpos completos están en GitHub (`gh issue view N`); todos tienen 0 comentarios. Las cifras que
citan (líneas, contadores, «52 grids», «36 imports», «tres sujetos») se midieron entre el 03-09 y el
05-09 y **hay que remedirlas**: T7-T11 tocaron `scene-normalize`, `scene-schema`, `tile-store`,
`carga-de-tile`, `main.ts` y el dispatcher.

## Decisiones ya tomadas que esta tanda hereda

- **Los issues se cierran cuando el código está hecho y verificado** (2026-09-04). Ninguna tanda
  espera una corrida de mutación; un módulo nuevo del núcleo puro entra con `break: "sin medir"`.
- **Cero créditos** en toda verificación. Servidores ajenos no se tocan: `./start.sh --preset <slug>`
  con `NEFAN_PORT_OFFSET` propio, `--parar` para lo propio, `ss -ltn` antes.
- **Pre-producción, cero compatibilidad**: lo que se sustituye se borra el mismo día, con barrido de
  prosa (`grep` a cero). Los rastros confunden a los agentes. Corolario para #452: un save con ítems
  sin `id` NO se conserva; para #405: la rama centrada se borra, no se documenta como legacy.
- **Candado, no prosa.** Un invariante comprobable va a un test o guion que se pone rojo, probado EN
  NEGATIVO. Y «un caso de UN elemento no distingue una regla de su contraria» (tres apariciones en
  T10-T11): los tests nuevos llevan el caso que separa la regla de su inversa.
- **Fail-loud por capa**: en el bridge, cualquier fallo sobre algo que el cliente o el motor espera
  llega al cliente o al motor (#453 es exactamente esa convención rota).
- **La garantía va en el tipo** cuando se pueda hacer inexpresable el estado malo (#410 lo pide
  literalmente: que el overlay del wire no quepa en la huella por construcción).
- **El banco no puede mentir**: un camino que solo ejerce el banco y nunca el juego es un camino falso
  (#408).
- **El CI corre los siete candados headless de `qa/`**; los guiones de navegador siguen siendo corrida
  local. Cualquier guion nuevo declara a cuál de los dos grupos pertenece (`qa/README.md`).
- Solo se commitean `requisitos.md`, `critica.md`, `qa*.md`. Plan e implementación son efímeros.

## Relaciones conocidas entre los ocho (para el crítico y el arquitecto)

- **#405 → #411**: `max` de la regla baja a lo que #405 deje vivo (`loadRoom` sin grid es una de las
  dos llamadas). Si #405 se hace, #411 se cierra casi solo.
- **#405 → #407**: los 52 grids literales viven en los mismos tests cuyas fixtures #405 reescribe a
  128×128. Hacerlos por separado paga dos veces la misma reescritura.
- **#405 → #410**: `tile-store.ts` es sujeto de los dos.
- **#452 ↔ #361 (`futuro`)**: la whitelist de escrituras es de plugins y está aparcada. #452 pide solo
  el gate del `id` en el camino que ya existe, no rediseñar la whitelist.
- **#451 depende de una decisión de diseño** (servir la entrada y regenerar solo el tile injugable) y
  toca la cola de generación. Es el único de los ocho que puede ser una feature y no una corrección.
- **#453** cabe preguntarse si el State API debe aceptar mutaciones con `session_id = ""` en absoluto.

## Criterio de aceptación de la tanda

- Cada issue cerrado con su criterio de cierre literal cumplido y medido (o reencuadrado por el
  crítico con el visto bueno del usuario).
- `npm run verify` verde; `npm run deuda` sin crecer respecto a `e62a750` (83 = 15 + 11 + 57);
  ningún umbral bajado; `main.ts` y `title-screen.ts` sin subir (`client-file-size.json`).
- Lo retirado, con `grep` a cero y término en `campos-retirados-no-vuelven` donde toque.
- Cero créditos.

## Tras la crítica (2026-09-05, `critica.md`)

Siete de los ocho tienen sujeto vivo. Correcciones que sustituyen a lo escrito arriba:

- **#451 sale de la tanda** hasta que el usuario decida: la premisa es cierta (`world-snapshot.ts:138-147`
  lanza a la primera; `session.ts:476-489` degrada; `bootstrap-tile.ts:114` reescribe el snapshot con una
  escena) pero no hay medio arreglo barato. Opciones: (a) servir la entrada y regenerar solo los tiles
  injugables por la cola; (b) rechazar el snapshot entero pero NO sobreescribirlo hasta que el nuevo
  mundo tenga ≥ N escenas; (c) dejarlo así y cerrar el issue como decisión. La tanda son **siete**.
- **#411 es independiente de #405**: las dos llamadas legítimas son `nefan-html/src/main.ts`
  (`addTileRaw`, fixtures del selector) y `nefan-html/src/ui/style-apply.ts` (vista previa del
  snapshot). `carga-de-tile.ts` no llama a `formatDToWorld`. #405 no retira ninguna; `max` no baja.
- **#407 es independiente de #405**: 44 de sus **47** literales (no 52) viven en `scene-validate-pasadas`
  (30) y `terrain-collision` (14), que #405 no reescribe; `scene-expand` ya tiene 0. Cuatro comentarios
  citan `W`, no dos. Se retira, no se le da productor: los muros del juego son volúmenes del plan (`S`),
  no chars del grid. Coste oculto a medir por el ingeniero: si algún test distingue agua (`w`) de muro.
- **#405 es menor**: `scene-expand.test.ts` ya está en 128×128 con `tile`. Quedan `makeFormatD`
  (`scene-normalize.test.ts:26-40`, 43 tests: la PR cara), `escenaExpandidaDePrueba` (`helpers.ts:84-97`,
  10 consumidores) y 8 ficheros sin `tile:`. El comentario `types.ts:90-92` ya no existe. El camino
  no-grid del cliente no tiene fixture que lo ejerza (las 3 de `data/scenes/` llevan `tile`). No tocar
  la geometría «tile (0,0) centrado» de `tile.ts:40-51`: es viva, no legacy.
- **#408 no es un dilema: se retira.** El motor ya ancla lugares por otro canal, `map_upsert_place.anchor
  {tx,ty,rect}` (`narrative-mcp/server.ts:699-707`). Muere el campo en zod, Python, fake, lectores
  (`narrative-state.ts:685-696`, `bootstrap-place.ts:53-63`), `EMITTED_SCENE_FIELDS` y sus tests, y las 3
  fixtures `ancla_*.json`; término en `campos-retirados-no-vuelven`. Pendiente del visto bueno del usuario.
- **#453**: «sin sesión» es `session_id === ""` → 409 en todas las mutaciones del State API (precedente:
  `doc-routes.ts` responde 404). La sesión **provisional** (#279, `game-gen.ts:170`) tiene `session_id` y
  `save()` devuelve `{escrito:false}` sin lanzar: debe seguir en 200, con test en negativo. Un `onMutation`
  que lance → 500 con motivo.
- **#452**: gate por campo en `externalWriteAllowed`/`applyToState` (`dispatcher.ts:278-318`) con el molde
  `InventoryAddRequestSchema`; `loadSession` (`narrative-state.ts:565`) rechaza ítems sin `id`. Compatible
  con #361. El único plugin vivo que escribe inventario (`commerce.json:56`) ya emite `{id, from}`.
- **#410**: solo `exits` es overlay del wire (`wire-scene.ts:106`); `position_declared`/`combat` los emite
  core y entran en la huella. El cliente no tiene harness (#241): el test vive en core o en `qa/` headless.

**Corte**: #452, #453, #411, #407, #408 en paralelo, una PR cada uno (no comparten fichero).
**#405 → #410** en secuencia o apiladas (comparten `tile-store.ts`). Los dos «menores» de #451 (motivo del
`stale` en el título; `ok:true/stale` vs `ok:false`) pueden ir con #453 si el usuario quiere.

## Decisión del usuario (2026-09-05, tras la crítica)

Literal, por AskUserQuestion: **#451** «Fuera de la tanda, decidir después» · **#408** «Sí, retirar» ·
**Corte** «Sí, adelante»: cinco PR en paralelo (#452, #453, #411, #407, #408) y #405 → #410 apiladas.
La tanda son **siete issues en seis PR**. Los dos «menores» de #451 no entran: #451 queda entero para
la decisión posterior.
