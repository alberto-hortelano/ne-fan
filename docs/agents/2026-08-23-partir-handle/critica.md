# VIGENTE — el tope SÍ baja (170 → ~127), pero baja a 126, no al objetivo, y el orden no es opcional

La afirmación que decidía el veredicto se sostiene, y con más holgura de la que la propia nota se
atreve a reclamar. Corrijo dos cosas que el issue da por buenas: el precedente **no** demuestra lo
que se le atribuye, y el suelo nuevo lo pone `expandScenePrimitives`, que está fuera de alcance.

## El problema real, en una frase

Los 27 endpoints del State API tienen su lógica de negocio dentro de un solo `if`-chain de 516
líneas que 23 commits han editado desde julio y que **tres tareas de la cola viva van a volver a
editar** — el tope de CRAP es el síntoma que lo señala, no el problema.

## La premisa, afirmación por afirmación

Tabla de CRAP de hoy (`npx tsx scripts/crap-score.ts --top 40` sobre el `coverage/lcov.info` de las
15:52; ni `state-http-server.ts` ni `scene-expand.ts` están tocados por el árbol sucio del ingeniero):

```
  158.4  158  98%  handle · bridge/state-http-server.ts:173
  126.0  126  99%  expandScenePrimitives · src/scene/scene-expand.ts:220
   69.2   49  80%  handle · services/asset-store/http-server.ts:76
```

| Afirmación | Verificación |
|---|---|
| `handle` sigue en complejidad 158 | **CIERTA**. 158, CRAP 158.4. La única deriva es la línea: el issue dice `:151`, hoy es `:173` |
| Es la peor de la casa | **CIERTA**. La segunda (126.0) está 32 puntos por debajo |
| «Es lo único que impide bajar el tope de CRAP» | **FALSA como está escrita**. El tope se ancla al peor valor: partiendo `handle` baja de 170 a **~127**, no al objetivo de 30. `expandScenePrimitives` (126.0) es el suelo siguiente, y el propio issue lo declara fuera de alcance |
| **«Los 10 puntos de holgura existen por `handle` y mueren con ella»** | **CIERTA, y por una razón más fuerte que la que da la nota.** El CRAP es cúbico en (1−cob): el spread medido de `handle` (158,4 / 158,4 / 159,0) equivale a 0,9 puntos de cobertura al 97,5 %; ese **mismo** ruido sobre `expandScenePrimitives`, que está al 99 %, mueve 15876·(0,019³−0,010³) = **0,11 puntos**. El ancla nueva no oscila: un tope de 127 aguanta con ~1 punto de margen en vez de 10. La holgura no migra: se evapora |
| «El precedente dice que sale bien» (PR #194) | **CIERTA para el CORTE, FALSA para el tope.** El tope era 170 **antes** de #194 (`git show 978b142^:…/quality-thresholds.json`) y 170 **después**: cuando se partió, `validateScene` ya no era el ancla — había caído de 196 a 129 al borrarse el plató, y la nota de entonces lo dice literal («no por trocearla, sino porque desaparecieron las ramas que solo servían a la variante `stage`»). Lo que #194 sí demuestra es que el corte colapsa el máximo: hoy **ninguna** de sus ocho pasadas aparece en el top-40 |
| «Una tabla ruta→handler» | La tabla **ya existe como dato**: `WorldStateApi` (`src/contracts/world-state.ts:238`), 27 endpoints con method + path, y `test/state-http-contract.test.ts` la recorre exigiendo rama real para cada uno. `handle` no despacha desde ella; la duplica a mano en 28 guardas `method === …` |
| «La red de caracterización existe antes de partir nada» | **EXISTE A MEDIAS**. Hay 838 líneas de test que levantan el server real (`state-http-server.test.ts` 468, `vocabulary.test.ts` 260, `state-http-contract.test.ts` 110) y cubren el 98 % de `handle`. Lo que **no** existe y no se puede pedir: medida de mutación — `bridge/` no está en el reparto (`grep "bridge/" data/contract/mutation-targets.json` = 0 líneas), y la totalidad de #229 solo cubre el perímetro `core-puro-sin-node`. La red de #194 fue un corpus congelado que pasaba contra el código **sin tocar**; aquí el equivalente es (method, path, body) → (status, body, mutated) |
| Los tres endpoints de mapa viven dentro (#179) | **CIERTA, y son cinco**: `GET /map` (:324), `GET /map/place/{id}` (:328), `POST /map/place` (:340), `POST /map/link` (:364), `POST /map/trigger` (:376) |
| `GET /sessions/asset_refs` hace doble parseo (#224) | **CIERTA**. `:290-311`: `sessionStorage.list()` —que ya parsea el `state.json` entero de cada save, el problema de #224— y luego un `read()` por save, que lo parsea otra vez. Son ~25 líneas de lógica de negocio dentro del router |

## El día después

- **Para quien juega**: nada, hoy. Es deuda declarada, con etiqueta `deuda`, y está bien que lo sea.
- **Qué mejora de verdad**: el gate pasa a proteger la banda 127–170, que hoy está desierta pero es
  exactamente donde caben las funciones nuevas que nadie quiere. Y las tres tareas de la cola que
  editan aquí dejan de hacerlo dentro de una cadena de 516 líneas.
- **Qué se vuelve más difícil**: leer el router de un tirón. Hoy `grep "/map/link"` lo lleva a uno al
  único sitio; con una tabla hay dos saltos. Es el precio conocido y lo pagó #194.
- **Qué hay que borrar y nadie borrará**: nada obvio. Pero si el corte deja la guarda de sesión
  (`x-nefan-session`, `:186-200`) duplicada por handler en vez de una vez antes del despacho, aparece
  un invariante de seguridad copiado 27 veces — eso sí es un empeoramiento, aunque el CRAP baje.
- **Qué parece arbitrario dentro de un mes**: que exista `WorldStateApi` con 27 endpoints tipados y
  el router no la use. Hoy ya lo parece.
- **La trampa que hay que nombrar antes**: la definición de hecho es un número, y hay tres formas de
  bajarlo sin arreglar nada (partir por líneas en vez de por concepto, esconder ramas en helpers
  compartidos, mover complejidad al `createStateHttpServer`). El aserto que no se puede falsear es
  que cada pieza se pueda **llamar sin levantar un servidor HTTP**.

## Conflictos

**No hay contradicción de fondo con nada; hay una colisión de orden con tres tandas vivas**, y las
tres editan dentro de `handle`:

| Issue | Qué toca dentro de `handle` | Estado |
|---|---|---|
| #179 salidas en vivo | `POST /map/link` (:364) — su crítico ya dictó que la difusión entre por **opción inyectada** (el molde `onProgress`, `:82`), no como rama | solo `critica.md`, sin plan |
| #195 grid mal formado | `POST /scene/validate` (:261) llama a `validateScene` **sin try/catch**: el 500 nace ahí | solo `critica.md`, sin plan |
| #224 título a 200 ms | `GET /sessions/asset_refs` (:290) es el segundo consumidor del corpus de saves | sin tanda abierta |

Ninguna ha empezado a implementarse, así que el orden barato es **#225 primero y las tres después**:
cada una aterriza en un handler de diez líneas en vez de rebasar un refactor de 27 rutas. Lo que **no**
se puede hacer es solaparlas: un diff sobre las 516 líneas y otro sobre `POST /map/link` no se
fusionan solos. El ingeniero que trabaja ahora en `feat/contrato-entity-npc` no toca este fichero
(`git status`: no aparece), así que no hay carrera con él.

Contra `CLAUDE.md` y `arch-rules.json`: cero. Ni una regla nombra `state-http-server.ts`, y el
contrato HTTP no se toca (fuera de alcance, correctamente).

## Coste contra valor

El trabajo es grande (688 líneas, 27 rutas) y la ganancia visible es un número que baja 43 puntos.
Vale la pena por lo que **no** se ve en el número: tres tareas de esta misma cola van a escribir ahí
esta semana, y 23 commits lo han hecho desde julio. Si no se hiciera nunca, el coste no es el gate:
es que el endpoint 28 se escribe igual que los 27 anteriores y `handle` llega a 170 sola.

Lo que **no** hay que hacer: tocar `expandScenePrimitives` en esta tanda para «rematar» el tope. Es
otro issue, otra batería de tests, y mezclarlo hace que un fallo no diga cuál de los dos lo causó.

## Qué le cambiaría a `requisitos.md`

1. Sustituir el criterio «el tope de CRAP baja sobre lo medido» por el número: **el tope baja de 170
   a ≤ 130** (peor valor previsto 126.0, `expandScenePrimitives`), con el margen **medido en tres
   pasadas**, no elegido. Y decir explícitamente que **no** se acerca al objetivo de 30: el suelo
   siguiente es 126 y está fuera de alcance.
2. Corregir el precedente: la PR #194 demuestra **el corte** (sus ocho pasadas desaparecieron del
   top-40), **no** la bajada del tope — el tope era 170 antes y después de ella.
3. Añadir a la definición de hecho: **cada pieza se invoca sin levantar un servidor HTTP**. Es lo
   que hace falsable «probable sola», y `bridge/` no está en el reparto de mutación, así que no hay
   score que lo demuestre por nosotros.
4. Añadir que la guarda de sesión `x-nefan-session` (`:186-200`) debe quedar **una vez**, antes del
   despacho: es un invariante de seguridad, y duplicarlo por handler empeora el fichero aunque el
   CRAP baje.
5. Añadir el orden como restricción, no como nota: **antes de #179, #195 y #224**, y sin solaparse
   con ninguna.
