**REENCUADRADA** — punto 1 reencuadrado (todo depende de UN fichero y rompe el suelo: lo decide el usuario) · punto 2 vigente (hoy no apretaría nada) · punto 3 reencuadrado (meter `scripts/` en `MEDIDA_CORE` rompe los dos gates; la mutación de `scripts/` es prematura)

## El problema real, en una frase

Hay código que ningún gate ve: en el core, casi solo `bridge/ws-server.ts`, y en `scripts/`, las herramientas que deciden los gates. Además, la foto del cliente solo puede subir de forma automática, nunca bajar.

## La premisa, afirmación por afirmación

Medido hoy (2026-09-29) sobre `feature/tanda-bj` (= `origin/main` d0cc2231). Pasos: `npm ci`, `npm run build`, `npm run coverage` (3650/3650 verdes) y `crapRows` con cada `Medida` desde un script de scratch que no se commitea.

1. **«`MEDIDA_CORE` usa `lo-cargado`»**: cierto (`scripts/crap-score.ts:76`).
2. **«Unos 16 ficheros sin cargar»**: hoy son **11 de 196**, con **329 líneas de código** (`Medicion.sinCargar`). La lista, con sus líneas de código:
   - `bridge/ws-server.ts` **220** (el bootstrap: importarlo levanta el bridge)
   - `src/index.ts` 53 (barril; SÍ se carga, pero como `dist/src/index.js`, y se descarta)
   - `src/contracts/remote-gen.ts` 30 · `narrative-llm.ts` 12 · `contracts/index.ts` 8 · `gateway.ts` 1
   - `src/world-map/index.ts` 5
   - con 0 líneas de código (solo tipos): `src/types.ts`, `src/protocol/messages.ts`, `src/combat/combat-system.ts`, `src/contracts/narrative-mcp-ws.ts`
3. **«Pasar a `el-arbol` puede mover el suelo y el tope»**: cierto, y los mueve los dos.

   | core | cobertura | funciones | > 73 | > 30 | peor |
   |---|---|---|---|---|---|
   | `lo-cargado` (hoy) | **96,35 %** de 19.146 | 1463 | 0 | 6 | 47,8 `handle` (asset-store) |
   | `el-arbol` | **94,73 %** de 19.475 | 1483 | **1** | 7 | **110,0 `register`** `bridge/ws-server.ts:233` (cx 10, 0 %) |
   | `el-arbol` sin `ws-server.ts` | **95,80 %** (cálculo: 18.447 / 19.255) | — | 0 | — | — |

   **El suelo cae 1,62 puntos y queda por debajo de 95. El tope lo rompe una sola función.** Las dos cosas salen del mismo fichero: los otros 10 ficheros suman 109 líneas y dejarían el suelo en 95,80. `register` no es cableado: son 60 líneas con cuatro ramas de log y un broadcast al cliente, dentro de un fichero que ningún test puede importar.
4. **«Una congelada que baja solo avisa; `--foto` imprime la foto»**: cierto (`crap-score.ts:589-594` y `:652`). No existe `--apretar` (grep a cero). **Medido hoy: 0 de las 45 congeladas sobran** (`npm run crap -- --check` en nefan-html: 0 rojas, sin aviso). Desde BF hubo 8 commits en `nefan-html/src` y ninguno bajó una congelada.
5. **«`scripts/` no está ni en `MEDIDA_CORE` ni en la mutación»**: cierto (`crap-score.ts:74`; `grep -c '"scripts/'` en `mutation-targets.json` da 0).
6. **«El medidor no se mide a sí mismo»**: **a medias**. Tiene tests propios (`crap-score`, `crap-del-cliente`, `deuda`, `afectado`, `especificador`, `ejercicio-de-bateria`, `mutacion-huella`, `mutacion-el-reloj-y-el-score`, …). Además, el job `candados-headless` corre en cada PR los `mutacion-*` en negativo, lanzándolos por `spawnSync` (`qa/mutacion-reparto-en-lotes.mjs:58`). Lo que le falta es CRAP y mutación, no tests.

## El día después

- **Para quien juega no cambia nada.** Es deuda declarada de tooling, y eso es legítimo.
- **Punto 1 como está escrito** (cambiar el literal a `"el-arbol"`): `npm run crap -- --check` queda ROJO en `main` por el suelo y por el tope. `npm run deuda` gana 20 funciones. Hay tres salidas, y las tres son del usuario:
  - (a) que `register` y el resto de la lógica de `ws-server.ts` sean alcanzables por un test;
  - (b) eximir `ws-server.ts` con motivo escrito;
  - (c) no cambiar el universo.

  **Bajar el 95 está prohibido por los requisitos**, y «congelar con foto como BF» **no existe en el core**: su gate es un suelo GLOBAL, no por función.
- **Punto 3 como está escrito** (añadir `scripts/` a los árboles de `MEDIDA_CORE`):

  | core + `scripts/` | cobertura | > 73 |
  |---|---|---|
  | `lo-cargado` | **93,44 %** | 4 (los `main`/`imprime` de CLI, al 0 %) |
  | `el-arbol` | **85,05 %** | **14** (`lotes` 420, `leeLaBase` 306, `main` de `mutate.ts` 306, …) |

  Por separado, `scripts/` son 29 ficheros y 5.874 líneas de código: un 30 % del core. Medido solo, da 79,25 % (`lo-cargado`) o 52,98 % (`el-arbol`). Mezclarlo en el mismo denominador **rompe el suelo o tapa con el core lo que pase en `scripts/`**, y viceversa. Además, esa cobertura **mentiría hacia abajo**: `mutacion-lotes.ts` sale al 0 % y CI lo ejerce en cada PR por subproceso, que el lcov no ve. Es el falso negativo que ya enseñó `ejercicio`.
- **Mutar `scripts/`**: el perímetro sale de `core-puro-sin-node` (`arch-rules.json:186`), y casi todo `scripts/` importa `node:fs`. El coste en mutantes no está medido, y `local` rechaza lo no cronometrado. No es algo que pueda cerrar esta tanda sin una corrida autorizada.

## Conflictos

- **Cola abierta**: ninguno. Las otras 7 son de juego o de playtest. #664 (el origen) está cerrado.
- **Requisitos contra sí mismos**: la vía de escape «se congela con foto» sirve para el tope, pero no para el suelo del core, que es global. Ver la redacción abajo.
- **Dependencia**: el punto 3, si mide `scripts/`, necesita su propia `Medida`, y esa pieza es la misma que toca el punto 1. Hacer el 1 y luego el 3 por separado paga dos veces el mismo cambio de `crap-score.ts`/`deuda.ts`.

## Coste contra valor

- **Punto 1**: el cambio mecánico es una línea. Todo el valor está en hacer visible `register` (CRAP 110, hoy invisible). **No hacerlo nunca** deja invisible ese fichero y ~110 líneas de barriles y contratos. El riesgo de no-monotonía que justificó `el-arbol` en el cliente aquí es pequeño: el fichero sin cargar más grande que un test puede importar (`remote-gen.ts`, 30 líneas) movería el suelo 0,16 puntos, con 1,35 de margen.
- **Punto 2**: barato. Hoy su efecto es cero, y su valor es el trinquete futuro. Lo que **no** debe hacer: añadir claves nuevas ni subir ninguna cifra. `--foto` sí haría las dos cosas si se escribiera tal cual: congelaría las rojas nuevas.
- **Punto 3**: el valor real está en las funciones que deciden un gate (`veredictoCliente`, `medirFuentes`, las siete de `comparar`), no en los `main`. **No debe hacerse añadiendo `scripts/` a `MEDIDA_CORE`**. La mutación es prematura hasta tener una medida de su coste.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **Medido por el crítico el 2026-09-29** (d0cc2231): el core tiene 11 de 196 ficheros sin cargar (329 líneas de código). `bridge/ws-server.ts` pone 220 de ellas y la única función que pasa de 73 (`register`, CRAP 110). Con `"el-arbol"` el suelo baja de 96,35 a **94,73 %**; sin ese fichero sería 95,80 %.
>
> 1. **Punto 1 — DECIDE EL USUARIO antes del arquitecto**, entre tres salidas:
>    - (a) hacer alcanzable por test la lógica de `ws-server.ts`;
>    - (b) eximir ese fichero con motivo escrito;
>    - (c) dejar el core en `lo-cargado`.
>
>    El suelo del core es global: «congelar con foto» no se aplica a él, y bajar el 95 sigue prohibido.
> 2. **Punto 2 — `--apretar`** solo puede BAJAR cifras o QUITAR entradas de `congeladas`. Nunca añade ni sube (eso es `--foto`). Hoy no aprieta nada (0 de 45 sobran), y el criterio de aceptación lo tiene que probar en negativo.
> 3. **Punto 3 — `scripts/` NO entra en los árboles de `MEDIDA_CORE`**: rompería el 95 (93,44 %) y el 73 (4 funciones). Si se mide, es con su propia medida y su propio umbral, sabiendo que la cobertura por lcov no ve lo que CI ejerce por subproceso. Su mutación queda fuera de esta tanda hasta tener su coste medido.
