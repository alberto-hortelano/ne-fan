# El contrato tiene espejos y ninguno manda

**Tanda**: 2026-08-29 (segunda del día) · rama `feature/el-contrato-y-sus-espejos`
**Issues**: #203, #237, #259  ·  *#319 salió tras la crítica: es el mismo trabajo que #318 y va con él*

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

## 2 · El enunciado común (CORREGIDO por la crítica)

Mi enunciado original decía que hay «cuatro espejos y ninguno manda». **Es falso, y el crítico
lo midió**: el zod **sí** manda. Python hace `_tool()` tres veces (`narrative_schemas.py:44`,
`:812`, `:895`) y **dos de los tres JSON los genera el zod** vía `CONTRACTS`, candados por
`contract-model-io.test.ts:44`. Consumir el JSON derivado **es el diseño correcto** y ya
funciona en 2 de 3.

El problema real, en una frase suya:

> `generate_scene.json` es el único artefacto de contrato **escrito a mano y fuera del
> codegen**, y de él cuelgan cuatro consumidores que nadie compara.

Y hay un **quinto espejo** que yo no había listado, que es el que de verdad muerde: los
vocabularios a mano de `narrative_schemas.py` (`RESERVED_TERRAIN:47`, `VALID_ENTITY_KINDS:53`,
`GROUND_KINDS:87`, `VOLUME_TYPES:95`) y la allow-list de `validate_scene_response:460`. **Ese**,
y no `GENERATE_SCENE_TOOL`, es el espejo de #237.

---

## 3 · Los tres, con la medida de la crítica

### #203 — el contrato central fuera del guardia · VIGENTE con alcance corregido

`CONTRACTS` tiene tres entradas y `generate_scene` no está entre ellas.

**El recuento honesto, hecho por el crítico** (mi grep plano estaba inflado, como avisé):

| Dirección | Resultado |
|---|---|
| JSON → zod | **2**, exactos: `scatter_generators`, `scatter_zones` |
| zod → JSON | **87 rutas**, y las 87 caen dentro de `ground`/`volumes`/`vegetation_zones` |
| `entities[]` | casa **12 a 12** |

Las 87 no son divergencia: el JSON declara esos tres como **prosa** (666/1502/1124 B de
`description`, cero `properties`), y esa prosa es lo que le enseña la gramática al modelo — el
§5 prohíbe tocarla.

**Consecuencia directa sobre el criterio**: un guardia «en ambas direcciones» sin acotar el
nivel **nace rojo por 87 motivos prohibidos**. Hay que acotarlo al nivel superior y a
`entities[]`.

### #237 — divergencia TS↔Python · REENCUADRADA

La divergencia es real y está verificada:

| Entrada | zod (pre-flight MCP) | ai_server |
|---|---|---|
| `entities[].description: ""` | RECHAZA (`.min(1)`) | acepta y la descarta en silencio |
| un tile con `size` | RECHAZA («un tile no lleva size») | acepta y hace `data.pop("size")` |

Coste real cuando muerde: si ai_server rechaza lo que el pre-flight aceptó, `llm_client.py`
devuelve `None`, **el tile se pierde y el jugador ve `narrative_status: error`**.

**Lo que cambia la pregunta, y no estaba en el issue**: los dos validadores **no vigilan la
misma población**. El zod **rechaza 20 de 20** tiles pre-generados de
`data/games/*/world/tile.json` — por `size` (20×), `terrain` (20×) y `style_ref` de escena
(18×). Su regla describe lo que el modelo **emite**; los tiles guardados son **post-expansión**.

**Alinear «cuál de los dos tiene razón» sin separar antes las dos poblaciones rompe el
arranque.** Eso es trabajo obligatorio, no un aviso.

El candado existe y está mal calibrado: las fixtures de `data/contract/fixtures/scene/`
ejecutan los dos procesos sobre el mismo set —el mecanismo correcto— pero sus seis casos **se
eligieron entre los que ya coincidían**.

### #259 — `.passthrough()` · VIGENTE, y ENTRA

El usuario autorizó dejarlo fuera si al medirlo salía caro. **La medida dice que entra**, y es
la más contundente de la crítica:

- **76.293 entities censadas**: ni una clave fuera de las 12 declaradas, salvo `scattered`, que
  ya está prohibido por `arch-rules`.
- La allow-list de Python es **idéntica al zod**, diff = ∅.

O sea que el `.passthrough()` de entity **no sostiene absolutamente nada**. La cláusula de
escape del §4 no se activa: cerrarlo no puede romper tráfico legítimo, porque no hay.

---

## 4 · Criterios de aceptación (reescritos tras la crítica)

El criterio 1 anterior salió con #319. El 2 estaba mal acotado y **habría nacido rojo por 87
motivos prohibidos**.

1. **Un campo declarado en `generate_scene.json` y ausente del zod pone rojo un test**, acotado
   al **nivel superior y a `entities[]`** — nunca dentro de `ground`/`volumes`/
   `vegetation_zones`, que el JSON declara como prosa a propósito.
   *Hoy: `scatter_generators` y `scatter_zones` están en el JSON, no en el zod, y las suites de
   contrato están verdes.*

2. **Los dos huecos se cierran llevando el zod al JSON**, no al revés, y no se borra ningún
   campo vivo. Verificable: los consumidores siguen funcionando (`scene-expand.ts:78,353`,
   `blueprint/scatter.ts:231-239`, `blueprint/fps-spec.ts:244`).

3. **Un término que un prompt le promete al modelo y no existe en el zod pone rojo el guardia
   débil.** *El censo del crítico anterior daba 3 de ~335; hay que recontarlo, porque las cifras
   de este issue ya han caducado una vez.*

4. **Las dos entradas de la tabla de #237 dan el MISMO veredicto en los dos procesos**, y cada
   una tiene su fixture. **Antes hay que separar las dos poblaciones** —lo que el modelo emite
   frente a lo que se carga de disco— y escribir cuál valida qué. Un arreglo que deje los 20
   tiles rechazados **rompe el arranque**.

5. **Las fixtures compartidas dejan de probar solo el acuerdo que ya había.** Verificable: al
   menos una fixture del set **falla** si se revierte el arreglo.

6. **Un campo desconocido en una entity produce un error preciso hacia el modelo** en vez de una
   poda muda. *Hoy: se cae en silencio. La medida dice que no hay tráfico legítimo que
   proteger (76.293 entities, cero claves extrañas).*

7. **Nada de esto gasta créditos**, ni al implementar ni al verificar.

8. **El riesgo de arte es cero y está medido, no razonado.** `validateContract`
   (`validate.ts:32-36`) hace `safeParse` y **tira el resultado**, así que el zod no reescribe
   ninguna escena. Comprobado además con el plan `varied`: con y sin scatter, `cells` da
   `23e82540af3acff1` **idéntico**. Si algún cambio de la tanda alterase eso, hay que pararlo y
   decirlo.

## 5 · Restricciones

- **No matar procesos ajenos.** Hay otras instancias de Claude en esta máquina. Nada de
  `pkill node`/`vite`/`python`, ni matar por puerto lo que no se arrancó.
- **Pre-producción: cero compatibilidad hacia atrás.** Lo que se sustituye se borra el mismo
  día, entero, `grep` a cero.
- **No regenerar el JSON desde el zod** ni tocar la prosa de `ground`/`volumes`: el crítico de
  #203 lo dejó fuera de alcance con su medida (2.094 líneas generadas frente a 215 a mano, y esa
  prosa le enseña la gramática al modelo).
- **Verificación barata**: el comando más barato que demuestre lo que toca.
- La batería de QA es de **38 guiones** (el fichero mayor se llama `39-` porque no hay `04-`: el número más alto NO es el recuento — me equivoqué dos veces con esto el mismo día). La línea base se mide antes de
  tocar nada — y **se declara de antemano que NO es estable**: #320 (el guion 34 es intermitente
  bajo carga, 1 rojo de cada 4 baterías) está abierto. Si aparece un 34 rojo, **no es de esta
  tanda**. Dicho antes, no después.

---

## 6 · Lo que NO es esta tanda

- No es meter el contrato de escena en `CONTRACTS` con el guardia fuerte. El crítico midió que
  **habría borrado campos buenos** y puesto rojo `contract-prompts.test.ts`.
- No es unificar zod y JSON en un solo artefacto generado. Es la tentación obvia y el crítico ya
  la descartó con números.
- No se toca el contrato de escena por gusto: cada cambio ahí puede rotar claves de caché de
  arte. Si algo lo hace, se dice y se mide antes.
