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

# Tanda AB — «El ledger sabe de dónde salió cada dólar» (#426)

## El issue

#426: un evento del ledger es `{t, usd, what, service}` (`ai_server/spend_tracker.py`) y nada dice si
se pagó de verdad; limpiar el de #392 fue arqueología sobre el texto del prompt y QA demostró que un
prompt plausible entraba en el barrido. Se pide que `SPEND.add` registre la PROCEDENCIA (real, fixture,
fake-ai-server, banco), que `total_usd()` pueda dar el gasto real, y el candado natural: escribir un
evento sin procedencia falla, como hoy falla escribir en el ledger real desde `unittest`.

## Criterios de aceptación

1. Todo evento nuevo lleva procedencia obligatoria (campo cerrado, enum), y escribir sin ella falla.
2. `total_usd()` (o su equivalente) da el gasto REAL sin depender del texto del prompt; el resto
   filtrable por procedencia.
3. Los sitios que llaman a `SPEND.add` declaran la suya (fixtures, fake-ai-server, banco, real);
   censo por el árbol, no por `grep` del nombre.
4. Pre-producción: el ledger vivo (187 eventos, $37,54) NO se migra por script mudo; el arquitecto
   decide si los eventos viejos sin campo se marcan `desconocida` de una vez o se archivan como se hizo
   en T9 — y se escribe.
5. Tests Python en verde (`pytest ai_server`), fail-loud según la convención (`HTTPException`, nunca
   `return {"error"}`).

## Fuera de alcance

- Volver a limpiar el ledger.

## Reencuadre del crítico (REENCUADRADA, 2026-09-18), aceptado por el coordinador

Aceptado sin consultar porque corrige premisas y acota, no cambia el problema. Sustituye lo que nombra:



**Reencuadre (crítico, 2026-09-18).** La procedencia la dice el PROVEEDOR, no el proceso ni el
llamante: sprite-forge ya emite `api` (`"fixture"` en las fixtures canónicas; el nombre del proveedor
en la respuesta real) y `remote_generation.py:759-778` lo tira. fal/Meshy no tienen doble falso en el
árbol: su evento es real por construcción. El fake-ai-server y el banco **no escriben el ledger**
(`fake-ai-server.ts:552`; `e2e-sin-creditos` no levanta remote-gen).

Criterios corregidos:
1. Todo evento nuevo lleva procedencia obligatoria, con un conjunto CERRADO de valores **que tengan
   escritor** (hoy dos: real / fixture; ni `banco` ni `fake-ai-server`). En el adaptador de
   sprite-forge la procedencia sale de `api` de la respuesta, nunca de un literal.
2. `total_usd()` y `/dev/status` dan el gasto real sin mirar `what`; `calls[]` lleva el campo y el
   contrato TS (`remote-gen.ts:197-240`) y la copia del fake (`fake-ai-server.ts:552`) lo reflejan.
3. Censo de llamantes por el árbol (`ast`): los cuatro de hoy, y que un `add` nuevo sin procedencia
   falle al escribir.
4. Los 187 eventos sin campo se ARCHIVAN como en T9 (`archivo/cache/spend/`), no se migran ni se
   marcan `desconocida`; el arquitecto dice qué pasa con `archivar_gasto_de_test.py` y el paso 6 de
   `qa/el-ledger-de-gasto-no-lo-escribe-la-suite.mjs` (se jubilan o se declaran solo-legado).
5. Candado en negativo: un forge de mentira con `api: "fixture"` fuera de `unittest` y sin
   `NEFAN_SPEND_DIR` no suma al gasto real (hoy el guardia de proceso no cubre ese camino).

Retirar de «El issue» los «4 eventos de prompt `x`»: no existen en el ledger vivo.

