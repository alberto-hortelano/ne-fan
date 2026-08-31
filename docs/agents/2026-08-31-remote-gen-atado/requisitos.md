# Requisitos — remote-gen atado por los dos lados (#318 + #319 + #256)

## Petición del usuario (literal)

La petición de fondo de la serie es:

> «Vamos a seguir priorizando reducir el numero de issues»

Sobre la hoja de ruta aprobada tras el triaje del 2026-08-30, el usuario arrancó esta tanda con:

> «la mutacion se esta ejecutando en github, sigue con la tanda 3»

La tanda 3 es: **«remote-gen atado por los dos lados» — #318 + #319 + #256**. La decisión de
emparejar #318 y #319 ya está escrita en ambos issues (comentario del 2026-08-29: mismo fichero
de contrato, mismo mecanismo, hacerlos por separado paga dos veces el candado). La corrida
completa de mutación está en vuelo en Actions (run 33397924513): si toca repartir supervivientes
a mitad de tanda, es asunto del coordinador, no de esta tanda.

## El problema real (una frase)

Las formas del contrato remote-gen se copian a mano en vez de importarse o compararse: el
cliente web se inventa en línea las respuestas de cinco sitios (dos de ellos el mismo endpoint
con formas distintas), el campo `cached` existe en el servicio, el fake y el cliente pero no en
el contrato, el productor Python construye `/dev/status` con una tupla de cadenas que nada
compara con el contrato TS, y `/backend_status` es un muñón sin cliente que agrega un único
valor.

## Fuentes de verdad

Los tres issues llevan comentarios (emparejamiento del 2026-08-29 y auditoría del 2026-08-30)
que corrigen o amplían sus cuerpos. Leer cuerpo + comentarios:

```bash
gh api repos/alberto-hortelano/ne-fan/issues/318 --jq '.body'
gh api repos/alberto-hortelano/ne-fan/issues/318/comments --jq '.[].body'
# ídem 319, 256
```

Resumen auditado (citas de la auditoría del 30-08 sobre `3f6feab`; HEAD hoy es `4bb014e`,
tandas 1 y 2 mergeadas — verificar si algo se movió):

### #318 — el cliente se redefine las respuestas a mano (censo real: CINCO sitios, DOS clientes del mismo endpoint)

Censo completo de `(await res.json()) as {` inline en `nefan-html/src`:

| Sitio | Endpoint | Forma inventada |
|---|---|---|
| `ui/style-apply.ts:438` | `POST /skin_sprite_sheet` | lee `cached` |
| `renderer/sprite-renderer.ts:149` | `POST /skin_sprite_sheet` | **otra forma distinta**: lee `hero_url` — y es el camino de juego real |
| `ui/style-apply.ts:375` | `POST /styles/{id}/complete` | `{ generated?, cost_usd? }` |
| `ui/title-screen.ts:1194` | `POST /styles/{id}/complete` | tercera redacción, **opcionalidad contradictoria** con la anterior |
| `ui/title-screen.ts:1157` | `POST /styles/upload` | 4 campos a mano |

- `StyleCompleteResponse` y `StyleUploadResponse` **existen** en el contrato y nadie los importa
  en esos sitios. Arreglar solo `style-apply.ts` deja el defecto entero en `sprite-renderer.ts`.
- `cached`: lo emite el servicio real (`ai_server/tests/test_sprite_forge_adapter.py:268,274,293,354`),
  lo consume el cliente para contabilidad VISIBLE (LED «reusado» vs «pintado»,
  `style-apply.ts:447`), lo emite el fake con la desviación escrita al lado
  (`labs/narrative/fake-ai-server.ts:904`, `satisfies SkinSpriteSheetResponse & { cached: boolean }`)
  — y `SkinSpriteSheetResponse` (`nefan-core/src/contracts/remote-gen.ts:88-105`) NO lo declara.
- Contraejemplos sanos que ya importan el contrato (el patrón a seguir): `fps-atlas.ts:178`,
  `style-apply.ts:187,196,400,537`, `sprite-renderer.ts:226`, `dev-status-panel.ts:113`,
  `portrait.ts:149`.

### #319 — nadie ata el contrato TS al servicio Python

- #309 ató el FAKE al contrato TS (`satisfies DevStatus`, typecheck de labs en CI). La dirección
  contraria sigue abierta: el productor real construye `/dev/status` a mano
  (`ai_server/routers/cache_assets.py:52`, tupla `("surface_model", "sprite_skin_model",
  "usd_eur_rate")`) y no conoce el contrato.
- **Corrección medida ya escrita en el issue**: el criterio original («renombrar un campo rompe
  algo») NACÍA VERDE — el crítico del 29-08 lo probó campo a campo: 5 de 7 campos ya rompen
  (`ai_server/tests/test_spend_tracker.py:59-84`); los dos que pasan callados son
  **`config.surface_model` y `config.sprite_skin_model`**. El criterio debe apuntar a esos dos.
- Mecanismo probable: fixtures compartidas que ejecutan los dos procesos, como el contrato de
  escena (`data/contract/fixtures/`, cerrado en #324). **Trampa documentada en #237**: allí las
  fixtures se eligieron entre los casos que YA coincidían — probaban el acuerdo donde ya lo
  había. No repetirla.
- Segunda mitad (familia, no núcleo): `POST /skin_sprite_sheet?x=1` → 404 en el fake (compara
  `req.url ===`) y 200 en FastAPI (ignora la query al enrutar). Barato de cerrar si el fake
  enruta por pathname; si no se hace, declararlo.

### #256 — `/backend_status` es un muñón

- La retirada está MEDIO ejecutada (auditoría 30-08): `meshy_3d` ya no existe,
  `generation.py:75-107` devuelve solo `{ai_vision}`, `BackendStatusResponse` ya es `{ai_vision}`
  (`narrative-llm.ts:102-104`). Sigue confirmado: **0 llamadas** en `nefan-html/src`.
- Queda el muñón: el endpoint sin cliente, y la línea de `docs/arquitectura/ia-servicios.md` que
  describe un «panel del title screen» que no existe.
- Decisión pendiente (§ Preguntas abiertas): retirar del todo o darle `dev-status-panel` como
  cliente.

## Criterios de aceptación (deben poder nacer rojos)

1. **`cached` entra al contrato**: declarado en `SkinSpriteSheetResponse` (lo emite el servicio
   real, lo consume el cliente para el LED — retirarlo rompería contabilidad visible sin
   beneficio). El `satisfies … & { cached: boolean }` del fake desaparece por innecesario.
2. **Los cinco sitios del censo importan el contrato** en vez de redefinirlo en línea: una
   divergencia rompe la compilación del cliente. Hoy nace rojo en el sentido de que el censo da
   5; al cierre, el censo de `(await res.json()) as {` inline en `nefan-html/src` da 0. Y
   (crítica, afinado A) ningún sitio del censo lee un campo que el contrato no declare ni
   re-tipa un campo del contrato con un cast lateral: los `error?: string` de
   `style-apply.ts:442` y `sprite-renderer.ts:153` (el servicio real NUNCA emite `error` con
   200 — fail-loud por HTTPException) y el `meta` tipado como `SpriteSheetMeta` donde el
   contrato dice `Record<string, unknown>` se resuelven con decisión explícita en el plan, no
   sobreviven como intersección o re-cast.
3. **La reaparición tiene candado**: un sitio nuevo que se redefina la respuesta en línea se
   pone rojo solo (mecanismo a decidir por el arquitecto: regla de arch-rules, test de censo…).
   Candado probado en negativo (introducir un `as {` inline → rojo → revertir).
4. **Los dos campos mudos rompen**: renombrar `config.surface_model` o
   `config.sprite_skin_model` en el **dict de salida** de `dev_status`
   (`cache_assets.py:67-68` — NO en la tupla de validación de `:52`, que ya rompe hoy con 500)
   rompe un test/checker/typecheck. Hoy pasa callado — el candado nace rojo con el estado
   actual del hueco, no verde. Mecanismo a elegir por el arquitecto pesando cerrar la instancia
   contra cerrar la clase (el repo tiene el patrón censo-de-claves en
   `test_sprite_forge_adapter.py:268`); las fixtures compartidas son UNA opción, no la probable
   — para dos campos de un endpoint de dev pueden ser desproporcionadas y arrastran la trampa
   de #237 (fixtures elegidas donde ya había acuerdo).
5. **El fake enruta como FastAPI** (pathname, no `req.url ===`) o la diferencia queda declarada
   con su porqué en el propio fake.
6. **`/backend_status` deja de ser un muñón** según la decisión de § Preguntas abiertas:
   retirado entero (endpoint + `BackendStatusResponse` + línea de `ia-servicios.md`) o con
   cliente real. En ambos casos: cero referencias muertas (`grep backend_status` limpio fuera de
   `archivo/`).
7. `npm run verify` verde (incluye typecheck de labs); tests Python verdes (vía del CI:
   `unittest discover ai_server/tests`); batería `node qa/run.mjs` con los mismos verdes que la
   base (el cliente cambia en caminos que los guiones de skin/estilo ejercitan); deuda sin
   crecer; PR con `Closes #318`, `Closes #319`, `Closes #256` (uno por línea, en inglés).

## Fuera de alcance

- El contrato de escena (#203/#237/#259 — CERRADOS por #324; sirven como precedente y como
  aviso de la trampa de fixtures, no como trabajo).
- Rediseñar `/dev/status` o el panel de dev más allá de lo que pida la decisión de #256.
- Los demás `as` del cliente que NO sean respuestas de red redefinidas (el censo es de
  `res.json()`).

## Decisión tomada (visto bueno del usuario, 2026-08-31)

**#256: `/backend_status` se RETIRA ENTERO** — endpoint, `BackendStatusResponse` y docs.
Premisa medida por la crítica: `/dev/status` lo monta remote-gen (:8768) y `ai_vision` lo
conoce ai_server (:8765); darle el panel como cliente cruzaría procesos por un valor que nadie
mira (0 llamadores en cliente, `qa/` y `labs/`). El grep del criterio 6 debe cazar todas las
referencias vivas, incluida `main.py:26` (`_SILENCED`) y las dos menciones en docs de
microservices.

Cita movida (para el arquitecto): el `satisfies … & { cached: boolean }` del fake está hoy en
`fake-ai-server.ts:576`, no en `:904`.

## Restricciones operativas

- Rama + PR; el hook `Stop` exige CI verde. El CI corre typecheck de labs y unittest Python —
  esta tanda SÍ tiene red en CI para sus dos candados principales; la batería sigue siendo local.
- Cero créditos: nada de servicios de imagen reales; el fake sirve `/skin_sprite_sheet`.
- No matar procesos ajenos; `qa/run.mjs` elige bloque libre; para pruebas manuales del cliente,
  `NEFAN_PORT_OFFSET` libre.
- `gh` 2.4: espera de CI con `until ! gh pr checks <N> 2>&1 | grep -q "pending"; do sleep 30; done`.
- Tests obsoletos se borran con el cambio, declarando la cobertura perdida.
