# Requisitos — retirar la escena suelta (Format D sin `tile` y sin `stage`)

**Fecha**: 2026-08-20 · **Rama**: `refactor/retirar-escena-suelta` · **Origen**: issue #172

## La petición del usuario, literal

La tarea nació de una revisión del backlog. Sobre el issue #172:

> «Analiza bien el bug 172, creo que no aplica ya que esa partida es antigua y podria
> tener datos incompatibles con el sistema actual, me parece que usa un sistema de mapas
> desechado. Si es asi eliminala, con todas sus referencias y el issue»

El análisis demostró que la hipótesis era **parcialmente falsa**: `robledo_village` no usa
un formato desechado, sino una variante del contrato que sigue viva y validada. Puesto ese
hallazgo delante del usuario, junto a la pregunta de si el modo de escena suelta debería
seguir existiendo, respondió:

> «Es lo primero, no deberia seguir existiendo»

Esa segunda frase es el encargo real: **no se elimina una fixture antigua, se retira una
variante del contrato de escena.**

## Contexto imprescindible

Format D tiene hoy **tres** variantes, elegidas en `narrative-mcp/server.ts:351-354` según
lo que traiga el `world_state`:

| Variante | Cómo se pide | Geometría |
|---|---|---|
| **tile** | `generate_tile` | `tile{tx,ty}` + `biome`; grid 128×128 @0.5 m = 64×64 m |
| **stage** | `stage_request` | `size`+`terrain` propios + bloque `stage` (proscenio) |
| **suelta** | ni una ni otra | `size`+`terrain` libres, `meters_per_cell` a elección del motor |

La tercera es la que se retira. **No es teórica**: el zod la exige
(`src/contract/model-io/scene-schema.ts:89-108`), el prompt se la pide al motor
(`scene_instructions.md:45-50`, hasta `60×40 @2 m` = 120×80 m), y `realizePlaceScene`
(`bridge/handlers/scene.ts:113-118`) la genera **sin validarla** en cualquier mundo que no
sea proscenio. En el save real `saves/1786993948-db4f10/state.json` el tile activo lleva
`place_id: "piedrahonda"` y tres exits con `realized_scene_id: null`: tres botones del
panel «Salidas» que hoy generan escenas sueltas dentro de un mundo de tiles.

El síntoma que abrió el issue: `nefan-html/src/renderer/projection.ts:78` descarta el
tamaño del rect y hornea siempre 64×64 m, así que de los 120×80 m de `robledo_village`
solo se pinta el cuadrante NW. Medido sobre la fixture real:

```
capa horneada: { x: -60, y: -40, w: 64, h: 64 }     rect real: 120 x 80 m
celdas DENTRO: { g: 897, d: 36, _: 56, s: 35 }
celdas FUERA:  { g: 1039, a: 14, w: 117, o: 9, _: 24, b: 5, d: 168 }
```

Las 117 celdas de agua caen fuera; la colisión las lee igual. De ahí el agua invisible.

## Decisiones ya tomadas por el usuario

No son propuestas: están decididas y el arquitecto parte de ellas.

1. **La variante suelta se retira entera**, aplicando la regla de pre-producción de
   `CLAUDE.md`: se borra el mismo día, en todos los procesos, `grep` a cero, con candado.
2. **Viaje**: el panel «Salidas» sigue existiendo, pero un destino sin realizar se
   resuelve **anclando el place a un tile** y generándolo con `generate_tile`. No se
   oculta el panel ni se limita a re-difundir lo ya realizado.
3. **Alcance ampliado** a tres cosas que cuelgan de la variante:
   - la **frontera legacy entera** (`runLegacyFrontier`, el mensaje
     `player_crossed_frontier` y todo su camino, incluido `handleFrontierAsTile`);
   - el **hardcode de 64 m** de `tileViewRect`;
   - `data/scenes/tavern_clearing.json`, world scene huérfana aún más vieja.
4. **La migración v3→v4 se conserva** (`src/narrative/migrations.ts`): es la rampa de
   salida del formato, no su soporte.
5. **QA se conserva entera** (decisión revisada, ver abajo): los guiones `01`, `03` y `07`
   migran a una fixture de tile nueva, y los guiones `02` y `06` **se salvan** haciendo que
   esa misma fixture lleve lo que necesitan.
6. **Candado en dos capas**: el zod exige `tile` o `stage` (fail-loud al modelo vía el
   pre-flight de `narrative-mcp/validators.ts`) **y** un test que recorra
   `data/scenes/**/*.json`. `arch-rules.json` no sirve: su motor solo sabe prohibir
   patrones de texto línea a línea (`src/contract/arch/check.ts:45-69`) y esto es una
   condición estructural sobre el documento.
7. **Tres PRs apiladas**, no una: el diff toca contrato, dos clientes, bridge, ai_server,
   prompts, fixtures y una decena de tests, y entero de una vez es irrevisable. El corte
   sigue el orden de ejecución del plan: **(1)** fake-ai-server a tiles + fixture nueva +
   candados + borrado; **(2)** viaje por anclaje (`place-anchor.ts`, contexto `place`,
   `spawn`); **(3)** `tileViewRect` y limpieza de la rama `!isGridTile`. CI verde de cada
   una antes de apilar la siguiente.

## Criterios de aceptación

1. Ninguna de las dos vías de validación (zod TS y su espejo Python
   `ai_server/narrative_schemas.py:603-631`) acepta una escena sin `tile` y sin `stage`.
   El error que llega al modelo dice qué falta y permite re-responder.
2. `narrative-mcp` ya no puede pedir la variante suelta: la tercera rama de
   `server.ts:351-354` desaparece y `scene_instructions.md` queda podado de lo que era
   exclusivo de ese modo (escalas `meters_per_cell`, presupuestos village/big town,
   `EXTERIOR CONTEXT`, los dos ejemplos completos, `EXTERIOR LINK RULE` y `FRONTIER`).
3. Un destino del panel «Salidas» sin escena realizada llega como **tile**, con el
   jugador colocado en él. Verificado andando en el juego, no leyendo JSON.
4. `grep -rn` a cero de `frontier_request`, `player_crossed_frontier`, `robledo_village`
   y `tavern_clearing`, salvo en los ficheros históricos declarados fuera de alcance.
5. El cliente 3D arranca offline sin bridge con una fixture viva y el jugador aparece en
   su `__player_start`.
6. `npm run verify` verde. `npm run mutate` no baja de `break: 72` (los tests alimentados
   con escena suelta sintética se **migran**, no se borran: cuatro de ellos son sujetos de
   mutación). `npm run crap` re-medido tras adelgazar `validateScene` —hoy el peor del
   repo con CRAP 204— y el techo de `quality-thresholds.json` **bajado**, no dejado igual.
7. Los guiones de QA supervivientes (`01`, `03`, `04`, `05`, `07`) en verde sobre el
   preset 5, con cero créditos gastados.
8. Los dos candados nuevos probados **en negativo**: se demuestra que fallan cuando deben.

## Cobertura de QA — decisión revisada

En la primera pasada se dieron por perdidos los guiones `02` (colisión desde la huella
declarada) y `06` (sólidos de la leyenda: el agua bloquea, el puente deja pasar,
`solid:false` abre un vado). El motivo declarado era que sostenerlos exigía autorar una
fixture nueva.

Al abrir el código, el arquitecto encontró que **ese trabajo hay que hacerlo igual**: el
criterio de aceptación 5 obliga a una fixture viva para que el cliente 3D arranque
offline. La fixture se paga una vez. Si además lleva un edificio como entity
`kind:"building"`, un `ground` con `water` + `deck` y un NPC descrito, los dos guiones
siguen vivos sin trabajo extra.

**Decisión del usuario tras conocerlo: salvarlos.** No hay pérdida de cobertura aceptada
en esta tarea. Si al implementar apareciera que alguno no se sostiene sobre un tile, es un
hallazgo que se reporta — no se borra el guion en silencio.

## Fuera de alcance

- **`generate_scene.json` y `scene_instructions.md` no están bajo codegen ni bajo guardia
  de deriva**: no figuran en `CONTRACTS` (`src/contract/model-io/schemas.ts:196-240`), así
  que nada avisa si el prompt y el zod divergen. Es deuda que este trabajo destapa;
  merece issue propio, no arreglarse aquí.
- `docs/agents/2026-08-20-mutantes-scene-normalize/qa.md` **no se toca**: es registro
  histórico de qué se verificó y cuándo.
- Saves en disco: pre-producción, no hay compatibilidad que mantener.

## Preguntas abiertas — las cierra el arquitecto

1. **De dónde sale el `(tx,ty)` del place destino** al anclarlo: `Place.approx_position`,
   el `edge` del link, el primer tile libre en esa dirección, u otra cosa. Restricción
   dura: la geometría de tiles vive en `src/scene/tile.ts` y **nadie la duplica**.
2. **Cómo se mueve al jugador** al tile recién anclado, y qué ve mientras se genera.
3. Qué pasa con el bucle de key places de `bridge/handlers/game-gen.ts:231-243`, que hoy
   corre en ambas ramas y pre-genera hasta 8 escenas sueltas por juego.
4. `labs/narrative/fake-ai-server.mjs` sirve escenas sueltas (`BUILTIN_SCENE` `:53-73`,
   `openFieldScene()` `:90-108`) y **es el motor del preset 5**, con el que corre toda la
   QA. Hay que migrarlo a tiles antes que nada o ningún guion arranca: ¿entra en el mismo
   paso o va primero?
5. `tileViewRect`: ¿se arregla para derivar el tamaño del rect, o se hace **fail-loud** la
   ruta de degradación de `main.ts:1220` (un plató con `stage` malformado cae al canvas
   oblicuo y hoy se pintaría recortado en silencio)? El proyecto es fail-loud por
   convención; decide cuál encaja.
