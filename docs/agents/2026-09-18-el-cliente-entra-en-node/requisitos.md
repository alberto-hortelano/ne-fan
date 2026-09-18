# Tanda R — «El cliente entra en Node y en el banco» (#665 + #663, con #664 a decidir)

## La petición, literal

Mandato vigente del usuario (2026-09-17, sigue en pie):

> «Hay 48 issues abiertos, ve cerrando sin parar, si tienes bloqueo en alguno lo apuntas pero sigue
> hasta reducir el numero al minimo»

Y hoy, 2026-09-18, al reanudar:

> «Seguimos, ya ha acabado la mutacion»

Decisión del usuario para HOY: **ciclo completo con fase de QA**.

## Estado medido al abrir

- `main` = `900b5b71`, árbol limpio.
- Batería: **145 verde · 0 rojo · 1 ⊘ de 146**.
- El cliente estrenó banco de tests unitarios ayer (#636, PR #669): `nefan-html/test/`, corriendo con
  `node --import tsx --test`. **Gotcha medido ayer**: `tsx` está en `devDependencies` y un árbol sin
  `npm ci` da `npm test` en rojo con un síntoma que parece un defecto de código y no lo es.
- `main.ts` está en **1379** líneas, tope 1379 (se subió ayer una línea con motivo escrito). **Sin
  holgura.**
- Corrida de mutación `35317748262` en vuelo; no afecta a esta tanda si no se toca `nefan-core/src`.

## Los issues

### #665 — `main.ts` y `fixtures-del-selector.ts` siguen fuera de Node

Con #543 resuelto, los once módulos del título entran en Node (medido: 0/11 antes, 11/11 después).
**Quedan dos ficheros**, y por dos motivos que el issue pide no mezclar:

1. **`import.meta.glob`** (solo lo entiende Vite), en `src/main.ts` y `src/world/fixtures-del-selector.ts`.
   Sin un sustituto no hay forma de importarlos fuera del bundler. **Es el trabajo de verdad.**
2. **`src/main.ts:100` resuelve `serviceUrl("asset-store")` en el CUERPO del módulo**, exactamente la
   forma que `ui/titulo/atomos.ts` tenía hasta #543. Hoy no se nota porque el punto 1 ya lo deja fuera,
   pero el día que se resuelva el `glob` vuelve a dar `location is not defined`.

El issue dice explícitamente que el 2 **no se hace suelto**: se hace con el 1 o no se hace.

Medido el 2026-09-17 importando con `node --import tsx` los **72** `.ts` de `nefan-html/src` que no son
`.d.ts`: entran **70**, y los 2 que no son exactamente éstos.

**Aviso de alcance**: `main.ts` no tiene ni una línea de holgura contra su tope. Si la solución del
`glob` añade líneas a `main.ts`, hay que cortar antes o encontrar una que no las añada — **el umbral no
se sube para acomodar esto**, y si el arquitecto cree que debe subirse, lo dice con su motivo y lo decide
el coordinador, no el ingeniero.

### #663 — la séptima pareja de ids del título se queda fuera del banco

El primer sujeto del banco del cliente
(`nefan-html/test/los-ids-del-titulo-se-leen-donde-se-escriben.test.ts`) ata **6 de las 12** parejas del
censo de #555. La séptima está a la vista y no entró: `chasis.ts:352` lee `#ts-sessions` para decidir si
enseña la banda de «hay más partidas», y quien lo pinta es `ui/titulo/home.ts`.

El test lo cubriría con el mismo patrón (comparar la salida de una costura contra la de la otra), pero
exige extraerle a `home.ts` su esqueleto como función pura, y **`home.ts` está clavado en 450 líneas, o
sea EN el tope general de `client-file-size.json` y sin una línea de holgura**. Medido el 2026-09-17:
`wc -l` = 450, tope = 450.

**Qué NO es**: no es «trocear `home.ts`» como fin. El corte es el precio, no el objetivo; si al mirarlo
resulta que el corte honesto de `home.ts` es otro, ese vale igual mientras deje sitio para el esqueleto.
Con ella el banco cubriría **7 de 12**.

### #664 — el cliente no tiene ni cobertura ni CRAP (DECISIÓN, no implementación)

Este issue **dice por escrito que hoy no se hace**, y da la razón: con un puñado de tests cualquier
umbral sería inventado, que es el anti-patrón que `quality-thresholds.json` prohíbe. Define su señal de
actuar: **cuando el banco tenga sujetos de varios módulos distintos**, de forma que un suelo se pueda
MEDIR sobre una base y no sobre un caso.

Lo que se pide a esta tanda sobre #664 **no es implementarlo**: es medir si la señal ha llegado (¿cuántos
módulos distintos tiene por sujeto el banco del cliente al terminar esta tanda?) y, si no ha llegado,
dejar escrito el número de hoy en el issue para que la próxima vez se decida contra una base y no contra
una impresión. Si la señal SÍ ha llegado, el crítico lo dice y el coordinador decide.

## Por qué juntos

Los tres salen del mismo sitio: el §6 «Backlog» del plan de la tanda K (#636 + #543 + #555). Son la deuda
que dejó el estreno del banco del cliente, y la comparten: el banco no puede crecer (#663) ni medirse
(#664) mientras dos ficheros no entren en Node (#665).

**El crítico debe verificar esa premisa**, en concreto si #663 depende de verdad de #665 o son
independientes — de eso depende que vayan en una PR o en dos.

## Restricciones de la casa que aplican aquí

- Cero créditos.
- Nunca `--parar-todo` ni `pkill` ni matar por puerto. Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --parar`
  desde el propio worktree.
- **Ningún umbral se baja, y ninguno se sube para acomodar lo que acaba de crecer.** Aplica a
  `client-file-size.json` en los dos ficheros de esta tanda (`main.ts` 1379/1379, `home.ts` 450/450).
- Lógica en core, el cliente solo pinta: si al mover algo aparece una decisión de juego, va a
  `nefan-core`, no a otro fichero del cliente.
- Pre-producción: cero compatibilidad hacia atrás.
