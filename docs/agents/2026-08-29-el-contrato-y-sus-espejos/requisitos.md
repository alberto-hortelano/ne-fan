# El contrato tiene espejos y ninguno manda

**Tanda**: 2026-08-29 (segunda del día) · rama `feature/el-contrato-y-sus-espejos`
**Issues**: #319, #203, #237, #259

---

## 1 · La petición del usuario, literal

> «Seguimos reduciendo el backlog, por donde prefieres seguir?»
>
> …y, elegida la tanda entre tres alternativas medidas:
>
> «El contrato y sus espejos (Recomendado)» — #319 #203 #237 #259

Lo que compró está en la descripción de la opción, y es el criterio de éxito:

> «Continúa lo que acabamos de construir: cerrar el lado Python del candado. #203 ya viene
> reencuadrado y medido, y sus dos candados NACEN ROJOS. #259 es el arriesgado y **puede
> quedarse fuera si al medir sale caro**.»

Esa última cláusula es una autorización explícita: **#259 se puede dejar fuera** si su medida
lo desaconseja. No es un permiso para abandonarlo por incómodo — hay que medirlo y decir el
número.

---

## 2 · El enunciado común

El repo cree tener una fuente única de verdad para el contrato del modelo: el zod
(`nefan-core/src/contract/model-io/scene-schema.ts`). **No la tiene.** Hay al menos cuatro
artefactos que describen el mismo contrato y ninguno manda sobre los demás:

| Artefacto | Quién lo consume |
|---|---|
| `src/contract/model-io/scene-schema.ts` (zod) | el pre-flight de narrative-mcp |
| `data/contract/tools/generate_scene.json` | **el motor narrativo** — y `ai_server` |
| `data/contract/prompts/scene_instructions.md` | el motor narrativo |
| `ai_server/narrative_schemas.py` | el camino de API directa |

**El dato que decide esta tanda, medido hoy**: `ai_server/narrative_schemas.py:44` hace
`_tool("generate_scene.json")`. O sea que **el proceso Python carga el JSON como fuente de
verdad, no el zod**. La «fuente única» no lo es en uno de los procesos.

Y la tanda anterior (`el-banco-no-puede-mentir`, PR #321) instaló **media pieza**: ató el motor
falso al contrato TypeScript y lo metió en CI. Nadie ata el contrato TypeScript a Python. #319
es esa mitad, y esta tanda existe en gran parte para no dejarla a medias.

---

## 3 · Los cuatro, con su medida de HOY

### #319 — nadie ata el contrato TS al servicio Python

`labs/narrative/fake-ai-server.ts:661` lleva `satisfies DevStatus`, y `typecheck:labs` corre en
CI. Eso cierra la dirección que produjo #309. **La contraria sigue abierta**: el productor real
construye la respuesta a mano.

```python
# ai_server/routers/cache_assets.py:52
for k in ("surface_model", "sprite_skin_model", "usd_eur_rate")
```

Una tupla de cadenas escritas a mano. Renombrar ahí no rompe nada: ni el typecheck nuevo, ni el
cliente, ni los tests de Python — que aseveran sobre las mismas cadenas escritas otra vez.

Segunda mitad medida: **el candado cubre formas, no rutas**. `POST /skin_sprite_sheet?x=1` da
404 en el motor falso y 200 en FastAPI.

### #203 — el guardia de deriva no cubre el contrato central

`test/contract-model-io.test.ts` recorre `CONTRACTS`, que tiene **tres** entradas
(`narrative_event`, `weapon_orient`, `weapon_verify`). En `data/contract/` hay ocho prompts y
cuatro tools. Queda fuera **el contrato central del juego**.

**Su reencuadre (crítico, 2026-08-23) sigue siendo la especificación** y evita el error caro: el
guardia fuerte «JSON == lo que renderiza el zod» **habría borrado campos buenos**. El alcance
correcto son dos candados baratos:

1. comparar el **conjunto de campos** de los tres artefactos en **ambas** direcciones;
2. un guardia **débil** sobre los cinco prompts huérfanos: que cada término que el prompt le
   promete al modelo exista en el zod.

**Ambos nacen rojos**, y cerrarlos —llevando el zod al JSON, no al revés— es parte del trabajo.

**CORRECCIÓN MEDIDA HOY, y el issue no lo sabe**: el reencuadre dice «cuatro campos vivos que el
zod no tiene». Hoy son **dos**:

```
EN EL JSON Y NO EN EL ZOD (top):    ['scatter_generators', 'scatter_zones']
EN EL JSON Y NO EN EL ZOD (entity): []   ← estaba `style_ref`
```

`vegetation_zones`, `role` y `style_ref` entraron en el zod con **#173**, que ya está cerrado.
El problema no ha caducado; la cifra sí. **Recontar antes de escribir el criterio.**

**Aviso sobre mi propia medida**: el listado inverso que saqué (`code`, `cols`, `message`,
`meters_per_cell`, `path`, `rows` en el zod y no en el JSON) sale de un `grep` **plano** sobre un
schema **anidado**, así que casi con seguridad son campos de sub-objetos y el número está
inflado. No lo uses sin rehacerlo bien.

### #237 — divergencia medida TS↔Python en el gate de escena

| Entrada | zod (pre-flight MCP) | ai_server |
|---|---|---|
| `entities[].description: ""` | RECHAZA (`.min(1)`) | acepta y la descarta en silencio |
| un tile con `size` | RECHAZA («un tile no lleva size») | acepta y hace `data.pop("size")` |

Hoy es inocuo porque el pre-flight corta antes en la vía MCP. Deja de serlo por la vía de API
directa (`llm_client.generate_scene`, sin pre-flight). Y el coste no es un rechazo de más: si
ai_server rechaza lo que el pre-flight aceptó, `llm_client.py` devuelve `None`, **el tile se
pierde y el jugador ve `narrative_status: error`** sin que el motor llegue a re-responder.

**El candado existe y está mal calibrado**: las fixtures compartidas
(`data/contract/fixtures/scene/`) ejecutan los dos procesos sobre el mismo set —el mecanismo
correcto— pero sus seis casos **se eligieron entre los que ya coincidían**. Prueban el acuerdo
donde ya lo había.

### #259 — `.passthrough()`: un campo retirado se cae en silencio

`EntitySchema` es `.passthrough()` y del lado Python hay una allow-list. Un campo que el modelo
emita y ya no exista **se descarta sin error, sin aviso y sin traza** — lo contrario de la
doctrina escrita del repo para la salida del LLM.

El candado de #199 protege el **código** (impide que un humano reintroduzca el término). No
protege del caso real: **el modelo emitiéndolo** porque lo vio en un ejemplo, un dump viejo o su
propio historial.

**Es el arriesgado, y su cuerpo dice por qué**: `.passthrough()` puede estar sosteniendo campos
que hoy viajan legítimamente sin estar declarados. **Hay que medir qué se cae hoy antes de
cerrar la puerta**, o el fail-loud nuevo empieza gritando por cosas que funcionan. Medido de
partida: hay **8 `.passthrough()` vivos** en `nefan-core/src/`.

---

## 4 · Criterios de aceptación

Escritos para poder salir ROJOS hoy. Cada uno dice cómo se comprueba y qué pasa hoy.

1. **Renombrar un campo en `ai_server/routers/cache_assets.py` rompe algo** —un test, un
   checker, un typecheck— en vez de dejar al motor falso y al cliente compilando contra un
   contrato obsoleto. *Hoy: no rompe nada en ningún proceso.*

2. **Un campo declarado en `generate_scene.json` y ausente del zod (o al revés) pone rojo un
   test**, en **ambas** direcciones. *Hoy: `scatter_generators` y `scatter_zones` están en el
   JSON, no en el zod, y las suites de contrato están verdes.*

3. **Los dos huecos se cierran llevando el zod al JSON**, no al revés, y no se borra ningún
   campo vivo. Verificable: los consumidores de esos campos
   (`scene-expand.ts`, `blueprint/scatter.ts`, `blueprint/fps-spec.ts`) siguen funcionando.

4. **Un término que un prompt le promete al modelo y no existe en el zod pone rojo el guardia
   débil.** *Hoy: el censo del crítico daba 3 promesas muertas de ~335 — recontar, porque puede
   haber caducado como caducaron los campos.*

5. **Las dos entradas de la tabla de #237 dan el MISMO veredicto en los dos procesos**, y cada
   una tiene su fixture en `data/contract/fixtures/scene/`. Decidir cuál de los dos lados tiene
   razón es parte del trabajo, y hay que escribir por qué.

6. **Las fixtures compartidas dejan de probar solo el acuerdo que ya había.** Verificable: al
   menos una fixture del set **falla** si se revierte el arreglo de #237.

7. **#259, si entra**: un campo desconocido en una entity produce un **error preciso hacia el
   modelo** («este campo se retiró, no lo emitas») en vez de una poda muda.
   **Precondición innegociable**: antes de cerrar la puerta, medir y escribir **qué se cae hoy**
   por `.passthrough()`. Si esa medida dice que sostiene tráfico legítimo, #259 **sale de la
   tanda** con el número escrito — el usuario lo autorizó expresamente.

8. **Nada de esto gasta créditos**, ni al implementar ni al verificar.

---

## 5 · Restricciones

- **No matar procesos ajenos.** Hay otras instancias de Claude en esta máquina. Nada de
  `pkill node`/`vite`/`python`, ni matar por puerto lo que no se arrancó.
- **Pre-producción: cero compatibilidad hacia atrás.** Lo que se sustituye se borra el mismo
  día, entero, `grep` a cero.
- **No regenerar el JSON desde el zod** ni tocar la prosa de `ground`/`volumes`: el crítico de
  #203 lo dejó fuera de alcance con su medida (2.094 líneas generadas frente a 215 a mano, y esa
  prosa le enseña la gramática al modelo).
- **Verificación barata**: el comando más barato que demuestre lo que toca.
- La batería de QA es de **39 guiones** desde la tanda anterior. La línea base se mide antes de
  tocar nada.

---

## 6 · Lo que NO es esta tanda

- No es meter el contrato de escena en `CONTRACTS` con el guardia fuerte. El crítico midió que
  **habría borrado campos buenos** y puesto rojo `contract-prompts.test.ts`.
- No es unificar zod y JSON en un solo artefacto generado. Es la tentación obvia y el crítico ya
  la descartó con números.
- No se toca el contrato de escena por gusto: cada cambio ahí puede rotar claves de caché de
  arte. Si algo lo hace, se dice y se mide antes.
