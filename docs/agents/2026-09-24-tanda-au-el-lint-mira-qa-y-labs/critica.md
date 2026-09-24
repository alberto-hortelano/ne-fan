# Crítica — tanda AU (#733 #718)

**Veredicto: REENCUADRADA.** El problema de fondo es real y los dos issues lo atacan. Pero #733 es **más grande** de lo que dice: ni cabe en una ruta de `scripts.lint` ni en una config `.js` dentro de `qa/`. Y #718 tiene un candado vivo que afirma **lo contrario**: hay que darle la vuelta, y ninguno de los dos issues lo menciona.

## El problema real en una frase

El banco (`qa/`, 232 `.mjs`) y los benches Python (`labs/`, 12 `.py`) no pasan por ningún lint, así que el código muerto se acumula en ellos sin que nadie lo vea.

## La premisa, afirmación por afirmación (medido hoy, 2026-09-24, sobre 57addf93)

| Afirmación | Verificación |
|---|---|
| `lint` es `eslint src bridge services test scripts` | Cierto, `nefan-core/package.json:31` |
| El import muerto de `bajo-carga.mjs` se retiró | Cierto: `razonDeLaMedida` solo aparece en `qa/lib/carga.mjs:294,335,415` (su definición y dos usos) |
| «Meter `qa/**/*.mjs` en la corrida» | **Así escrito no se puede.** ESLint 10.6 busca la config desde el fichero hacia arriba. `npx eslint ../qa` lanzado desde `nefan-core` → «couldn't find an eslint.config». Con `-c eslint.config.js` → «outside of the base path». Hace falta una config cuyo directorio contenga `qa/`. Además, `qa/eslint.config.js` lo rechaza la lista blanca `EXTENSIONES_DEL_BANCO` (`nefan-core/test/qa-lib-tiene-quien-lo-mire.test.ts:131`: mjs, md, json, png, jpg). Y `qa/package.json` no tiene eslint |
| «Medir cuántos hallazgos hay» | Medido sobre una copia de `qa/` en un temporal. Con la config del paquete (`recommended` + TS): **3314 hallazgos en 221 de 232 ficheros**, de los que **3254 son `no-undef`** (window 1304, document 676, console 646, process 285…). Son ruido: el banco mezcla Node y cuerpos de `page.evaluate`. El resto: **18 `no-unused-vars` en 13 ficheros**, 38 `no-useless-assignment`, 3 `preserve-caught-error` y 1 `no-irregular-whitespace`. Con SOLO `no-unused-vars` salen los mismos 18 |
| Los 18 son «imports muertos» | **Solo 2 son imports** (`existsSync` en 163 y `esperarTituloListo` en 18). Los demás son helpers y constantes sin llamar: `caminoLibreAntes` (128), `posicion`/`vida` (93), `delWire` (89), `colorDelAviso` (52), `celdaAMundo` (05)… En 52 el helper sobra: su criterio se comprueba en línea (`52-*.mjs:95,200`). Los demás no los he clasificado. Un helper sin llamar en un guion puede ser **un aserto que se prometió y no se hace**, que es la familia de #356 |
| ruff solo corre sobre `ai_server/` y `labs/` solo pasa `compileall` | Cierto: `ai_server/lint.sh:62-63`, `ci.yml:170-174` |
| `ruff check labs` da 1 `F841` | Cierto, `labs/fps/gen.py:246` (`tex_dir`). Da ese mismo hallazgo con las reglas por defecto y con `--config ai_server/pyproject.toml` (E,F,W,B,UP) |
| «Una sola línea en `lint.sh`» | **Falso por omisión.** El guion `qa/guiones/162-…-se-pone-rojo.mjs:202-206` afirma que un E741 sembrado en `labs/` da **rc=0**. Corre en CI (`candados-headless`). Ampliar la ruta lo pone rojo, que es correcto, pero hay que invertirlo, no borrarlo. También afirman lo contrario la prosa de `ai_server/lint.sh:8-10` y de `ci.yml:170-171` y la línea 20 del mismo guion. Además, `labs/` no tiene config de ruff: sin decir nada recibe las reglas por defecto, no las de `ai_server` |

## El día después

- Para quien juega no cambia nada. Es deuda declarada, y así está bien.
- Un guion con un helper olvidado se pone rojo en `npm run lint`. A cambio, escribir un helper «para después» en un guion deja de ser gratis. Esa puerta hay que cerrarla.
- Qué **no** debe hacerse: encender `recommended` sobre `qa/` (3254 falsos positivos, o una lista de globals que nadie mantendrá); borrar a ciegas los 18 sin mirar si alguno era un aserto perdido; o dejar la prueba 3 de 162 «adaptada» de modo que ya no pueda ponerse rojo.
- `labs/` va a tener un lint con reglas distintas de las de `ai_server/`, salvo que alguien decida otra cosa. A los tres meses parecerá arbitrario si no se escribe por qué.

## Conflictos

- **Tanda AR (Node latest + retirar el reporter de #697):** toca `nefan-core/package.json:30` (`scripts.test`), y esta tanda toca la `:31` (`scripts.lint`). Git no fusiona hunks adyacentes: **el conflicto está garantizado**. Es trivial, pero hay que resolverlo a mano. `qa/guiones/165` no tiene ningún hallazgo de los 18. Sin embargo, todo `.mjs` que AR añada o edite bajo `qa/` entra en el lint nuevo. **Orden: AR primero.** AU rebasa y **vuelve a medir** los hallazgos antes de fijar ninguna cifra. ESLint 10 exige Node ≥20.19, así que subir Node no rompe nada.
- **#734** (reloj muerto del guion 07) y **#717** (`qa/lib/python.mjs` y el `.venv`): no se solapan.
- **`arch-rules.json`**: ninguna regla sobre el alcance del lint. La restricción real es la lista blanca de extensiones de `qa/` (ver la premisa).

## Coste contra valor

Medido en esta máquina, en frío:

| Pasada | Tiempo |
|---|---|
| `ruff check labs` | 0,02 s |
| `lint.sh` entero | 0,13 s |
| eslint sobre `qa/`, solo `no-unused-vars` (espree) | ~1,3 s de reloj |
| eslint sobre `qa/` con la config TS del paquete | ~2,8 s |
| `npm run lint` de hoy | 4,6-5,2 s |

El criterio 4 solo se cumple con el lint mínimo, no con la config TS. Si no se hiciera nunca, el coste es bajo y lento: helpers muertos que confunden a quien lee un guion, y la posibilidad de un aserto perdido que nadie ve. Merece la pena porque el mínimo es barato. #718 casi no cuesta nada, salvo el guion 162.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

> 1. (#733) `npm run lint` (y por tanto `verify` y CI) mira `qa/**/*.mjs` con **solo `no-unused-vars`** (`^_` exento, como en el paquete). Ni `recommended` ni `no-undef`: medido el 2026-09-24, dan 3314 hallazgos, 3254 de ellos globals del navegador y de Node. Restricciones medidas: ESLint 10 no lintará `qa/` con la config de `nefan-core` (queda fuera del base path), y bajo `qa/` no cabe un `.js` (`EXTENSIONES_DEL_BANCO`). Hoy salen **18** hallazgos en 13 ficheros; hay que volver a medir tras fusionar la tanda AR. **Cada uno se clasifica antes de tocarlo**: código muerto (se borra) o aserto prometido que no se hace (se hace, o se abre issue con el guion y la línea). Ninguno se borra sin esa línea en `implementacion.md`.
> 2. (#718) `ai_server/lint.sh` pasa ruff también sobre `labs/` y el `F841` de `labs/fps/gen.py:246` se limpia. Se decide y se escribe qué reglas recibe `labs/` (hoy, las de ruff por defecto, no las de `ai_server/pyproject.toml`; con cualquiera de las dos hay 1 hallazgo). **El guion 162 se invierte**: su prueba «E741 en `labs/` → rc=0» (`:202-206`, y la prosa de `:20`) pasa a exigir rojo. Se barre la prosa que dice lo contrario en `ai_server/lint.sh:8-10`, `ci.yml:170-171` y en la fila 162 de `qa/README.md`.
> 3. Igual que ahora, más: lo que el lint nuevo no mira se enumera, y como mínimo entra aquí `labs/**/*.{js,mjs}` (14 ficheros), que no los mira ningún eslint.
> 4. Se miden antes y después `npm run lint` y `verify`. Referencia de hoy: `npm run lint` 4,6-5,2 s; eslint sobre `qa/` 1,3 s con la regla sola y 2,8 s con la config TS.
> 5. Orden: detrás de la tanda AR. El conflicto en `nefan-core/package.json:30-31` se resuelve a mano al rebasar.
