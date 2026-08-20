# Requisitos — matar los supervivientes de mutación de `scene-normalize.ts`

**Fecha**: 2026-08-20 · **Rama**: `tests/mutantes-scene-normalize`

## Petición literal del usuario

> ahora el 2, es la primera tarea con equipo, tambien queremos saber que tal funciona el ciclo nuevo

«El 2» es el segundo punto de la lista que el coordinador le presentó al repasar el backlog,
citado también literalmente porque es lo que define el alcance:

> **`npm run mutate`** para refrescar la medida, y luego los supervivientes de
> `scene-normalize.ts`. Es el módulo por el que pasa *toda* escena hacia ambos clientes y sus
> tests no distinguen la mitad de los cambios: mucho más grave que cualquier CRAP alto con 98%
> de cobertura.

## Por qué esta tarea existe

`npm run deuda` daba `src/scene/scene-normalize.ts` con **206 mutantes vivos de 376 (score
45%)** pese a un 97% de cobertura de líneas. `formatDToWorld` es el paso por el que toda escena
del motor narrativo se convierte en world scene camino de los dos clientes: un test que no se
entera de que ese código cambia es un agujero en el contrato de render.

## Punto de partida (ya hecho por el coordinador, NO cuenta como trabajo de esta tanda)

Antes de lanzar el ciclo se descubrió que buena parte de ese 45% era **un instrumento mal
calibrado**, no deuda. Se corrigió en `main` (commit del paso 0) y en la rama:

1. `test:mutate` —la suite que Stryker corre por cada mutante— incluía seis ficheros, y de
   ellos **solo `scene-normalize.test.ts` tocaba el módulo**. Los tests que sí ejercen sus
   caminos ricos (`tile.test.ts`, `terrain-collision.test.ts`, `scene-expand.test.ts`) estaban
   fuera, así que sus asserts no podían matar nada. Añadirlos cuesta **0,01 s** por corrida
   (medido: 0,40 → 0,41 s).
2. `stryker.config.json` mutaba `src/combat/resolver.ts`, **fichero que no existe** — el real
   es `src/combat/combat-resolver.ts`. Ese objetivo nunca midió nada.
3. El `mutation.json` en disco era de una corrida **de un solo objetivo**, no de la completa.

**La línea base real es la de la corrida posterior a esas tres correcciones** (ver abajo). El
salto que produzcan por sí solas no es mérito de nadie: es el termómetro, no la fiebre.

### Línea base medida

`npm run mutate` completo tras calibrar, 2026-08-20 (16 min, salida real):

```
File                 |  % score | # killed | # timeout | # survived |
All files            |    63.91 |     1099 |        38 |        642 |
 combat-resolver.ts  |    68.29 |       28 |         0 |         13 |
 plugins/dsl         |    67.62 |      883 |        38 |        441 |
 scene-normalize.ts  |    50.00 |      188 |         0 |        188 |
```

**`scene-normalize.ts`: 188 supervivientes de 376 — score 50,00%.**

Dato que corrige la expectativa del coordinador, y que importa para juzgar el trabajo: la
calibración del instrumento subió el módulo de **45,21% a 50,00%**, o sea mató **18 de los 206
supervivientes**. El coordinador había supuesto que el salto sería notable; no lo fue. **El
grueso del hueco es deuda real, no medida mal hecha**, y hay que ganárselo escribiendo tests.

Efectos colaterales de la calibración, ambos esperados:
- `combat-resolver.ts` aparece medido **por primera vez**: 68,29%, 13 supervivientes. Fuera del
  alcance de esta tanda (queda anotado para el issue #168).
- El global sube de 62,20% a **63,91%**, por encima del `break: 60` actual.

## Criterios de aceptación

1. **La medida es honesta.** `test:mutate` incluye todos los ficheros de test que ejercen los
   módulos mutados; todo objetivo de `stryker.config.json` apunta a un fichero que existe.
   `npm run deuda` deja de avisar de «objetivos sin datos en el último report».
2. **Están muertos los supervivientes que revelan comportamiento observable**, por orden de
   consecuencia real. No hay número de score que cumplir: manda la consecuencia.
   - `normalizeTerrainFeatures` (L58-81) — **82 supervivientes, el 40% del fichero**. Hoy el
     bucle ni se ejecuta bajo `test:mutate`. Su salida la pinta el renderer 2D
     (`nefan-html/src/renderer/canvas-renderer.ts:1130`).
   - NPC completo (L223-225: `role`, `style_ref`, `description`) — **21 vivos y CERO muertos**.
     Consecuencia: son parte de la clave de caché del skin en
     `nefan-html/src/ui/style-apply.ts:227`. Si no viajan, el skin se paga dos veces.
   - Cola del literal de retorno (L256-327, 33 vivos): `world_rect`, `terrain_grid`,
     `scene_id`/`room_id`, `biome`, `style_ref`, `exits`, `ambient_event`. Nadie assertea nada
     de ahí hoy.
   - `resolveTerrainLegend` (L116-136): falta el caso `solid: false` y el char no-default. Da
     de comer a la colisión server-side de NPCs (`bridge/sim-collision.ts:136`).
   - Las tres líneas sin cubrir en lcov: los `throw` de 192, 197 y 234.
3. **Lo que quede vivo se enumera con su razón** en `implementacion.md`: equivalente,
   irrelevante para el comportamiento, o coste desproporcionado. El silencio no vale.
4. **Si un test confirma un bug, se arregla en esta misma tanda** y se declara. En concreto, la
   sospecha del criterio 2: si `role`/`style_ref`/`description` no viajan a la world scene y la
   clave de caché del skin diverge entre la partida y el batch de estilos, eso es gasto real de
   créditos y se corrige aquí.
5. **Sin regresión**: `npm run verify` verde · `npm run crap -- --check` sin crecer ·
   `npm run deuda` sin items nuevos fuera del módulo tocado · `architecture.test.ts` y
   `contract-model-io.test.ts` siguen verdes sin tocarlos.
6. **`thresholds.break` de `stryker.config.json` se sube al nuevo valor medido** (redondeando
   hacia abajo). Queda **explícitamente autorizado aquí**: el prompt del ingeniero prohíbe
   tocar umbrales por cuenta propia, y esta es la excepción por escrito que esa regla pide.
7. **Ningún test tautológico.** Los asserts salen de los criterios de verificación del plan y
   del comportamiento que los consumidores necesitan, no de leer la implementación. Un test
   escrito mirando el código que ya funciona solo demuestra que el código es el que es.

## Corrección del usuario tras ver el plan (punto de control, 2026-08-20)

El arquitecto encontró que los 82 supervivientes de `normalizeTerrainFeatures` defienden
`terrain_features`, un campo **ya retirado del contrato del modelo**
(`src/contract/model-io/scene-schema.ts:15`, `src/scene/scene-expand.ts:154`): hoy el suelo va
por `ground` y ninguna fixture lo trae. Sobrevive solo por saves anteriores a la retirada.

Se le presentaron al usuario tres salidas (testearlo como legacy / dejarlo vivo y abrir issue /
podarlo ya). **Decisión: podarlo ya en esta tanda.**

Esto **modifica los requisitos** en dos puntos, y manda sobre lo escrito arriba:

- El criterio 2 ya no pide matar los 82 supervivientes de `normalizeTerrainFeatures`: pide
  **eliminar el código que los produce**. Esos mutantes desaparecen del denominador, no se
  matan — el score sube porque hay menos código, y así debe declararse en `implementacion.md`.
  No es lo mismo y no vale presentarlo como tests ganados.
- Queda **levantada la prohibición de tocar `src/`** solo para esta poda. El resto del módulo
  sigue igual: para cualquier otro cambio de comportamiento en `formatDToWorld` se para y se
  consulta.

Consecuencia aceptada explícitamente por el usuario: **las partidas guardadas antes de la
retirada dejan de pintar sus ríos y caminos**. `nefan-html/src/renderer/canvas-renderer.ts:1130`
es quien los pinta hoy; la poda alcanza también a esa rama del renderer y a lo que dependa de
ella. El alcance exacto lo fija el arquitecto en la segunda versión del plan.

## Segunda corrección del usuario (2026-08-20, con la implementación ya en marcha)

Cita literal:

> Elimina la directiva de no borrar tests, no queremos mantener versiones antiguas, no nos
> importan los saves antiguos, hasta que no estemos en produccion no hace falta ningun tipo de
> compatibilidad, cuando haga falta crearemos versiones de los contratos. Ahora no queremos
> guardar legacy, hay que eliminarlo

Es una **política del proyecto**, no solo de esta tanda (queda recogida en `CLAUDE.md`). Efectos
sobre estos requisitos, que mandan sobre todo lo anterior:

- **Muere la regla «tests: reescribir, no borrar»** del plan. Un test cuyo sujeto es el formato
  retirado se borra, sin ceremonia.
- **La compatibilidad hacia atrás deja de ser un criterio.** Los saves antiguos no importan. Lo
  que exista solo para que un save viejo siga funcionando se borra también — incluido
  `test/scene-schema.test.ts:108`, que el plan v2 mandaba conservar para proteger el
  `.passthrough()` del gate.
- **La poda es total**: al terminar, `grep -rn terrain_features` sobre todo el repo da **cero**.
- Único matiz, que no es preservar legacy sino lo contrario: un test que usa el campo solo como
  fixture de entrada para probar algo vivo (tiles, costuras, `validateScene`) se pasa al formato
  vivo (`ground`) **o** se borra. No se deja un test vivo alimentado con un formato que ya no
  existe. Si se borra, la cobertura perdida **se declara** en `implementacion.md`: el usuario
  acepta perderla, no que aparezca por sorpresa en `npm run crap`.

Consecuencia para QA: **ya no hay ningún criterio sobre saves antiguos**. Que una partida
guardada antes de la poda pierda su río no es un hallazgo; que quede un solo `terrain_features`
en el árbol, sí.

## Fuera de alcance

- **Ampliar los objetivos de mutación a otros módulos** (`src/scene/blueprint/**`,
  `stage/greybox.ts`, `world-map/**`, `store/reducers.ts`). Eso es el **issue #168** y se queda
  ahí. Corregir el objetivo roto de combate no es ampliarlo: es que apunte a lo que ya decía.
- El resto de la cola de `npm run deuda`: catches silenciosos del cliente 2D, autoloads de
  Godot sin `must_get_node`, el CRAP de `validateScene`.
- **Refactorizar `formatDToWorld`** para bajarle el CRAP 60. Si el arquitecto ve un trozo que
  pide extracción, va a la sección de mejoras estructurales del plan, no a esta tanda.
- Commits y PR: no se commitea ni se abre PR sin que el usuario lo pida.

## Contexto que solo tiene el coordinador

- **Créditos**: cero gasto en esta tarea. La verificación de QA usa `node qa/run.mjs`, que
  levanta el **preset 5** (fake-ai-server, todo mockeado). Si algo pareciera exigir Imagen IA,
  es un hallazgo, no un paso.
- **Decisiones tomadas por el usuario en la conversación**, todas ya reflejadas arriba:
  - Objetivo de mutación: *«los que revelan comportamiento»*, sin número fijo (criterio 2).
  - Rol de QA: *«que lo fijado es lo REAL en el juego»* — QA valida que lo que los tests
    declaran es lo que el juego hace en el flujo real, no que las métricas cuadren (ver
    Verificación).
  - Bug de skins: *«si el test lo confirma, se arregla»* (criterio 4).
  - Las fricciones del propio ciclo se arreglaron **antes** de empezar, en `main`.
- **Segundo objetivo de la tarea, que no es del ingeniero**: el usuario quiere saber qué tal
  funciona el ciclo de equipo, que nunca se había ejecutado (no existe ni un `requisitos.md` en
  el historial del repo). La retro la escribe el coordinador observando; a los roles no les
  afecta y no deben optimizar para ella.

## Verificación esperada

- **De la medida**: salida real de `npm run mutate` antes y después, pegada en
  `implementacion.md`. No un resumen.
- **Del comportamiento** (esto es lo que pidió el usuario de QA): con `node qa/run.mjs` en el
  cliente 2D, comprobar que lo que los tests fijan se cumple en el juego — features de terreno
  pintadas, sólidos de la leyenda bloqueando de verdad al jugador, campos del NPC llegando
  enteros hasta el batch de estilos. Guion nuevo en `qa/guiones/`, **probado en negativo**:
  romper a mano lo que dice verificar y comprobar que se pone rojo.

## Preguntas abiertas

Ninguna bloqueante. Suposiciones por defecto si aparece duda:

- Si matar un superviviente exigiera cambiar el comportamiento de `formatDToWorld` (no solo
  añadir un test), **se para y se consulta**: el módulo lo consumen los dos clientes y el save.
- Si un mutante superviviente resulta equivalente, se documenta y se deja vivo. No se retuerce
  la implementación para hacerlo matable.

---

## Añadido en §3.5 (limpieza y endurecido), después del informe del ingeniero

El coordinador pasó `/simplify` sobre el diff (cuatro revisiones en paralelo: reuso,
simplificación, eficiencia, altitud) y aplicó lo que se sostuvo. **Esto también entra en el
alcance de QA**, porque toca ficheros que el juego usa:

1. **Tests colapsados sin perder asserts**: helpers subidos a ámbito de módulo (`conEntity`,
   `conNpc`, `refDelSkin` en `scene-normalize.test.ts`; `conLegend` en
   `terrain-collision.test.ts`), los tres casos de "el campo no viaja" convertidos en tabla, y
   un fixture compartido `test/fixtures/tiles.ts` que sustituye al mismo camino
   oeste(41)→este(52) copiado en tres ficheros. **La medida de mutación se repite después**: si
   la limpieza hubiera perdido un mutante muerto, no vale.
2. **`rasterizeFeature` → `rasterizePath`** en `src/scene/scene-expand.ts`: al retirar el campo
   muerto quedaba un parámetro `char` con un único valor posible (`"_"`). Agua y decks se
   pintan por área, no por polilínea.
3. **Comentarios obsoletos** del `canvas-renderer.ts` que seguían anunciando un paso de pintado
   que ya no existe.
4. **Dos candados nuevos, ambos probados en negativo** (romperlos a mano y ver el rojo):
   - `campos-retirados-no-vuelven` en `data/contract/arch-rules.json`: un campo retirado no
     reaparece en ninguno de los seis roots escaneados. Hoy vigila `terrain_features`. Convierte
     en ejecutable la mitad operativa de la directiva del usuario ("`grep` a cero"), que hasta
     ahora era prosa en `CLAUDE.md`.
   - `test/mutation-config.test.ts`: todo objetivo de `mutate` y todo fichero de `test:mutate`
     tienen que existir. Es el candado del fallo que originó esta tarea — un objetivo apuntando
     a un fichero inexistente medía el vacío EN VERDE.
5. **`npm run mutate` pasa `--force`** (mide en frío y reconstruye la caché) y la caché
   incremental vive en `npm run mutate:quick`. Motivo medido, no teórico: con
   `testRunner: "command"` Stryker no hashea los ficheros de test, así que vaciar dos ficheros
   de test y re-correr devolvía el score viejo en 3 s. El gate no puede dar verde sobre
   veredictos caducados.

**Lo que se dejó fuera a propósito** (va al backlog, no a esta tanda):

- Que el scatter de volúmenes derivados esquive los caminos y ríos de `ground`. Al borrar el
  campo muerto se fue con él un `nearBand` que ya no excluía nada (el saneador de `ai_server`
  reescribía el campo a `[]` en cada escena), así que **no hay regresión**: es una capacidad
  que nunca llegó a estar viva por esa vía. El helper vivo ya existe
  (`buildScatterExclusions` en `src/scene/blueprint/scatter.ts`).
- Partir la corrida de mutación por módulo para que cada objetivo corra solo los tests que
  pueden matarlo (medido: ~24 min de CPU frente a ~2 h, 5×).
- Retirar los shims legacy que los tests nuevos fijan de paso (`room_id`, `room_description`,
  `style_tag`). La nueva directiva de pre-producción los alcanza, pero son otra tanda: tocan
  Godot, `ai_server` y el cliente 2D.
