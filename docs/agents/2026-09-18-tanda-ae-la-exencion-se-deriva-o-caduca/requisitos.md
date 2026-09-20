## La petición, literal

El usuario, el 2026-09-18 (sesión nueva, `main` = `a25d8c2f`):

> «Mira los issues que hay en github y ve cerrandolos, si tienes alguna duda dejala apuntada para
> mas tarde y trabaja de forma autonoma con la estructura de agentes definida.»

Sigue en pie el mandato del 2026-09-17: «ve cerrando sin parar, si tienes bloqueo en alguno lo
apuntas pero sigue hasta reducir el numero al minimo».

Decisión del coordinador para esta jornada: **ciclo completo con fase de QA** (crítico → arquitecto →
ingeniero → QA), porque QA es quien lleva nueve tandas cazando los candados que cubren menos de lo
que prometen. El usuario no está mirando en tiempo real: las dudas se APUNTAN (en `requisitos.md`,
sección «Preguntas abiertas», con la suposición que se toma) y se sigue.

## Estado medido al abrir

- `main` = `a25d8c2f`, árbol limpio, un solo worktree, máquina en reposo (load 0,2).
- Backlog: **37 abiertos = 25 núcleo + 12 `futuro`**. Esta jornada abre 14 tandas EN PARALELO
  (S…AF) sobre los 19 issues de núcleo no bloqueados; las otras tandas tocan OTROS ficheros, pero
  dos pueden rozarse en `qa/README.md`, en `qa/run.mjs` y en la numeración de guiones (#680: el
  número de guion se elige al fusionar, no al escribir; hasta que la tanda U cande el prefijo
  único, un guion nuevo lleva el número que le toque en `main` EN EL MOMENTO DE FUSIONAR).
- Batería de navegador: NO medida hoy al abrir. Última conocida: 145 verde · 0 rojo · 1 ⊘ de 146
  sobre `900b5b71` (ayer por la mañana); desde entonces entraron los guiones 148 y 149. Quien
  toque `qa/` mide lo que toca, aislado y en par (tres corridas de cada) antes de la completa.
- Las dos últimas corridas de mutación (`35317748262` y `35354800866`) salen COMPLETAS con 0
  nuevos y **dos suelos rotos conocidos** (#675 `npc-director` 75,33 % < 81; #676
  `state-http-dispatch` 99,28 % < 100): el gate de mutación está en rojo por eso y no distingue
  un rojo nuevo. La tanda T los cierra.

## Restricciones de la casa que aplican a TODAS las tandas

- Cero créditos: motor falso, presets `e2e-sin-creditos` y `html-fixtures`. Nada que llame a
  Imagen IA ni al motor real.
- Nunca `--parar-todo`, nunca `pkill`, nunca matar por puerto: hay otros agentes en la máquina.
  Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --parar` desde el propio worktree. **Gotcha vivo (#684)**:
  con offset ≥ 1000 `--parar` MIENTE («nada que parar aquí» con el stack en pie); por eso hoy los
  offsets se reparten entre 100 y 900. Si te toca uno ≥ 1000, para por PID demostrando propiedad
  con `/proc/<pid>/cwd`.
- Ningún umbral se baja, y ninguno se sube para acomodar lo que acaba de crecer.
- Pre-producción: cero compatibilidad hacia atrás. Lo que se retira, se retira entero el mismo
  día (`grep` a cero en prosa, comentarios y docs).
- Un candado nuevo se prueba EN NEGATIVO (se reintroduce el defecto y se ve el rojo) y se declara
  por escrito lo que NO cubre. Un candado headless nuevo entra en `candados-headless` el día que nace.
- El worktree se monta con la receta de `docs/agents/README.md` (los cuatro `npm ci`, el build de
  `nefan-core`, las hojas de sprites). El fichero de salida de una corrida larga lleva el nombre
  del worktree.
- Cada afirmación factual del issue se VERIFICA contra el árbol antes de usarse como requisito:
  los cuerpos citan `fichero:línea` que caducan en horas.
- No se commitea en `main` ni se fusiona nada sin que el coordinador lo pida; el ingeniero trabaja
  en su rama y commitea en ella.

# Tanda AE — «Una exención no se cree: se deriva, o caduca» (#611)

## El issue

#611: las exenciones de `nefan-core/data/contract/esperas-que-conducen.json` piden sujeto, `porque` ≥
120 caracteres que nombre proceso o issue, ≥ 20 palabras sin tiradas. Cierra la perezosa (medido). NO
cierra la mentira elaborada (medido: 7 pass · 0 fail). Más forma sobre el texto está agotado. Dos vías:
(1) DERIVAR el sujeto del árbol (si la exención dice «depende de otro proceso», el predicado tiene que
tocar algo de ese proceso: `fetch`, `status()`, estado que solo escribe el bridge); (2) CADUCIDAD con
fecha renovable. La elección es de diseño. Dato reciente (#673 comentario): una exención de
`esperas-por-fotogramas.json` no citaba su issue («Tiene issue propio») — la misma enfermedad en el
contrato hermano.

## Criterios de aceptación

1. El crítico/arquitecto eligen entre derivar y caducar (o ambas) con el motivo escrito en `critica.md`;
   el coordinador toma la elección como decisión salvo que sea un reencuadre grande.
2. Lo elegido, implementado en `esperas-que-conducen.json` + su test, y evaluado también para
   `esperas-por-fotogramas.json` (mismo patrón de exención).
3. Probado en negativo con la MENTIRA ELABORADA del issue (la que hoy pasa 7·0): con el candado nuevo
   se pone rojo (derivación) o queda con fecha y la renovación es un acto explícito (caducidad).
4. Las exenciones honestas de hoy siguen pasando sin reescribirlas, o se reescriben las que no
   cumplen lo nuevo con su motivo.
5. `_lo_que_esto_NO_sujeta` (o equivalente) dice lo que sigue abierto, y se mide.

## Fuera de alcance

- Más requisitos de forma sobre el texto.

## Reencuadre del crítico (REENCUADRADA, 2026-09-18), aceptado por el coordinador

Decisión tomada: DERIVAR por clase de sujeto, SIN caducidad; la vía «por issue» se sujeta con el estado del issue (abierto). El 80 lleva una exención agotada por sus propios términos: se va o se reescribe con issue vivo. Sustituye lo que nombra:


**Decisión (crítica):** DERIVAR, por clase de sujeto. Cada exención declara `clase` ∈ {bridge, motor, game loop, issue} y el test comprueba que el PREDICADO de esa espera (inline o por referencia a una función del fichero, como ya hace `espera-de-fotogramas-con-dueno.test.ts`) lee algo de esa clase: bridge → `scene`; motor → `dialogue()`; game loop → `reloj()`/`fps()`. Cada nombre del mapa debe existir en `nefan-html/src/dev/nefan-hook.ts`. La regla es POSITIVA («toca algo del proceso nombrado»), nunca «no toca el mundo»: `TRAZA` del 133 lee `state().pos` y es honesta. La clase `issue` exige número, y su comprobación es que el issue esté ABIERTO, no una fecha; dónde corre (unitario vs `candados-headless`) lo decide el arquitecto. **No se añade caducidad.**

**Criterio 4, concretado:** la exención del guion 80 está agotada (#496, #497 y #545 cerrados el 2026-09-16; el fichero tocado en `59a3d765` y `b7b20650`): o el 80 pasa a `{sim}` y la exención se borra, o se reescribe con el issue vivo que hoy la sostenga.

**Criterio 2, acotado para `esperas-por-fotogramas.json`:** clases derivables: «cortafuegos mayor» (el presupuesto del sitio > `CORTAFUEGOS_MS` de `qa/lib/fotogramas.mjs:83`; el 69 lleva `30_000`, `69:305`) y «conducida en sim» (`{sim}` presente; `142:19`); vía issue (#673, guion 15); la clase «el contador es el sujeto» NO es derivable y queda declarada. Su zod sube al mismo listón que el de conducen.

**Criterio 5:** `_lo_que_esto_NO_sujeta` como clave zod obligatoria en los DOS contratos (patrón de `sondas-de-movimiento.json`), con al menos: lectura muerta, alias fuera del predicado (#686), clase no derivable del hermano; cada uno con su caso medido.

**Fuera de alcance, añadido:** retirar o no la regex de proceso y las veinte palabras de `porque` es decisión del arquitecto y se escribe; no se deja acumulada.

Decisión del coordinador sobre la pregunta pendiente al arquitecto: si la derivación sujeta el sujeto, la regex de proceso y las veinte palabras del porque se RETIRAN (no se acumulan capas); el arquitecto lo confirma o dice por qué no.

## Decisión del coordinador tras el plan (2026-09-18)
Opción A adoptada tal cual, incluidas las retiradas (regex de proceso, veinte palabras, tirada de ocho, campo `sujeto`, `linea_orientativa`) y la clave `fichero :: desc` del hermano. Se mide solo el 80 aislado ×3. El headless por issue entra en `candados-headless` con `GH_TOKEN`; si el runner no tiene token o red, el guion sale ROJO (no ⊘), como dice el plan. Offset propio: 500 (no debería hacer falta stack manual).
